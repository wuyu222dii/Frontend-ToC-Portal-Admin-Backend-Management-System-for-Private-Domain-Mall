import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type AuditRepository,
  type CallbackInboxRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type OutboxRepository,
  type Prisma,
  type StoreOrderCloseClaimResult,
  type StoreOrderCloseProviderInput,
  runSerializableTransaction,
  type StoreOrderCloseResult,
  type StoreOrderTimeoutCandidatePage,
  type StoreOrderTimeoutIntegrityCursor,
  type StoreOrderTimeoutIntegrityIssue,
  type StoreOrderRepository,
} from '@qingxu/database';
import {
  createSignedMockPaymentSuccessCallback,
  type PaymentProviderIntentResult,
  type PaymentProviderPort,
  verifyMockPaymentCallback,
} from '@qingxu/payment';

import { DATABASE_RUNTIME } from './database-runtime.provider';
import { CALLBACK_INBOX_REPOSITORY, OUTBOX_REPOSITORY, WORKER_CONFIG } from './outbox-dispatcher.service';

export const ORDER_TIMEOUT_REPOSITORY = Symbol('ORDER_TIMEOUT_REPOSITORY');
export const ORDER_TIMEOUT_AUDIT_REPOSITORY = Symbol('ORDER_TIMEOUT_AUDIT_REPOSITORY');
export const ORDER_TIMEOUT_PAYMENT_PROVIDER = Symbol('ORDER_TIMEOUT_PAYMENT_PROVIDER');

export type OrderTimeoutRepository = Pick<StoreOrderRepository,
  'expireNextOrderInTransaction' | 'listExpiredOrderIntegrityIssues'
> & Partial<Pick<StoreOrderRepository,
  'claimNextOrderCloseInTransaction' | 'finalizeOrderCloseInTransaction' | 'listExpiredOrderCandidates'
>>;
export type OrderTimeoutAuditRepository = Pick<AuditRepository, 'append'>;
export type OrderTimeoutOutboxRepository = Pick<OutboxRepository, 'append'>;
export type OrderTimeoutPaymentProvider = Pick<PaymentProviderPort, 'query' | 'close'>;
export type OrderTimeoutCallbackInboxRepository = Pick<CallbackInboxRepository, 'receive'>;

@Injectable()
export class OrderTimeoutService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(OrderTimeoutService.name);
  private integrityCursor: StoreOrderTimeoutIntegrityCursor | undefined;
  private integrityCycleIssueKeys = new Set<string>();
  private reportedIntegrityIssueKeys = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopping = false;

  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(WORKER_CONFIG) private readonly config: PlatformRuntimeConfig,
    @Inject(ORDER_TIMEOUT_REPOSITORY) private readonly orders: OrderTimeoutRepository,
    @Inject(ORDER_TIMEOUT_AUDIT_REPOSITORY) private readonly audit: OrderTimeoutAuditRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OrderTimeoutOutboxRepository,
    @Optional() @Inject(ORDER_TIMEOUT_PAYMENT_PROVIDER)
    private readonly paymentProvider?: OrderTimeoutPaymentProvider,
    @Optional() @Inject(CALLBACK_INBOX_REPOSITORY)
    private readonly callbacks?: OrderTimeoutCallbackInboxRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
  }

  async pollOnce(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.reconcileBatch();
      await this.reportIntegrityIssues();
      await this.expireBatch();
    } catch {
      this.logger.error({ code: 'ORDER_TIMEOUT_POLL_FAILED' });
    } finally {
      this.running = false;
    }
  }

  private async reportIntegrityIssues(): Promise<void> {
    // The candidate page, rather than the issue page, owns the cursor. This
    // means healthy orders advance the scan and cannot hide a later violation.
    if (this.orders.listExpiredOrderCandidates) {
      await this.reportIntegrityIssuesWithCandidateCursor();
      return;
    }
    let issues: StoreOrderTimeoutIntegrityIssue[];
    try {
      issues = await this.database.withPrismaTransaction(
        (transaction) => this.orders.listExpiredOrderIntegrityIssues(transaction, {
          ...(this.integrityCursor === undefined ? {} : { after: this.integrityCursor }),
          limit: this.config.worker.batchSize,
        }),
        { isolationLevel: 'RepeatableRead' },
      );
    } catch {
      this.logger.error({ code: 'ORDER_TIMEOUT_INTEGRITY_SCAN_FAILED' });
      return;
    }
    for (const issue of issues) {
      const issueKey = `${issue.orderId}:${issue.issue}`;
      this.integrityCycleIssueKeys.add(issueKey);
      if (this.reportedIntegrityIssueKeys.has(issueKey)) continue;
      this.logger.error({
        code: 'ORDER_TIMEOUT_INTEGRITY_VIOLATION',
        issue: issue.issue,
        orderId: issue.orderId,
      });
    }
    const lastIssue = issues.at(-1);
    if (issues.length === this.config.worker.batchSize && lastIssue !== undefined) {
      this.integrityCursor = {
        orderId: lastIssue.orderId,
        payExpiresAt: new Date(lastIssue.payExpiresAt),
      };
      return;
    }
    this.reportedIntegrityIssueKeys = this.integrityCycleIssueKeys;
    this.integrityCycleIssueKeys = new Set<string>();
    this.integrityCursor = undefined;
  }

  private async reportIntegrityIssuesWithCandidateCursor(): Promise<void> {
    const after = this.integrityCursor;
    let page: StoreOrderTimeoutCandidatePage;
    let issues: StoreOrderTimeoutIntegrityIssue[];
    try {
      const result = await this.database.withPrismaTransaction(async (transaction) => {
        const candidates = await this.orders.listExpiredOrderCandidates!(transaction, {
          ...(after === undefined ? {} : { after }),
          limit: this.config.worker.batchSize,
        });
        // Keep the existing integrity query as the read-only diagnostic. It
        // uses the same starting cursor, while the candidate page determines
        // whether the cycle is complete.
        const integrity = await this.orders.listExpiredOrderIntegrityIssues(transaction, {
          ...(after === undefined ? {} : { after }),
          limit: this.config.worker.batchSize,
        });
        return { candidates, integrity };
      }, { isolationLevel: 'RepeatableRead' });
      page = result.candidates;
      issues = result.integrity;
    } catch {
      this.logger.error({ code: 'ORDER_TIMEOUT_INTEGRITY_SCAN_FAILED' });
      return;
    }
    this.recordIntegrityIssues(issues);
    this.integrityCursor = page.nextCursor === null ? undefined : page.nextCursor;
    if (page.nextCursor === null) {
      this.reportedIntegrityIssueKeys = this.integrityCycleIssueKeys;
      this.integrityCycleIssueKeys = new Set<string>();
    }
  }

  private recordIntegrityIssues(issues: readonly StoreOrderTimeoutIntegrityIssue[]): void {
    for (const issue of issues) {
      const issueKey = `${issue.orderId}:${issue.issue}`;
      this.integrityCycleIssueKeys.add(issueKey);
      if (this.reportedIntegrityIssueKeys.has(issueKey)) continue;
      this.logger.error({
        code: 'ORDER_TIMEOUT_INTEGRITY_VIOLATION',
        issue: issue.issue,
        orderId: issue.orderId,
      });
    }
  }

  /**
   * Reconcile one order at a time. Database claim/finalize phases are kept
   * separate from Provider I/O so a slow or unavailable Provider never holds
   * row locks. A definitive non-payable result reuses the same atomic close
   * and inventory-release path as orders without a payment intent.
   */
  private async reconcileBatch(): Promise<void> {
    if (!this.paymentProvider || !this.orders.claimNextOrderCloseInTransaction ||
      !this.orders.finalizeOrderCloseInTransaction) return;

    for (let processed = 0; processed < this.config.worker.batchSize; processed += 1) {
      let claim: StoreOrderCloseClaimResult | { kind: 'NONE' };
      try {
        claim = await runSerializableTransaction(this.database.prisma, async (transaction) => {
          const result = await this.orders.claimNextOrderCloseInTransaction!(transaction);
          // A payment-free close has already released the reservation inside
          // this transaction; keep its audit and Outbox facts atomic with it.
          if (result.kind === 'CLOSED' && result.changed) {
            await this.appendCloseFacts(transaction, {
              before: result.before,
              changed: result.changed,
              order: result.order,
              reservationId: result.reservationId,
            });
          }
          return result;
        });
      } catch {
        this.logger.error({ code: 'ORDER_TIMEOUT_RECONCILIATION_CLAIM_FAILED' });
        return;
      }
      if (claim.kind === 'NONE') return;
      if (claim.kind === 'SKIPPED') continue;
      if (claim.kind === 'CLOSED') {
        continue;
      }
      if (claim.paymentIntent === null || claim.providerOperation === null) {
        this.logger.error({ code: 'ORDER_TIMEOUT_RECONCILIATION_FACTS_INVALID' });
        continue;
      }

      let providerInput: StoreOrderCloseProviderInput;
      try {
        providerInput = await this.providerCloseInput(claim);
      } catch {
        this.logger.error({ code: 'ORDER_TIMEOUT_RECONCILIATION_FACTS_INVALID' });
        continue;
      }
      try {
        const finalized = await runSerializableTransaction(this.database.prisma, async (transaction) => {
          const result = await this.orders.finalizeOrderCloseInTransaction!(transaction, providerInput);
          if (result.kind === 'PAYMENT_CONFIRMED') {
            await this.persistRecoveredMockSuccess(transaction, result.paymentIntent, providerInput);
          }
          if (result.kind === 'CLOSED' && result.closeResult?.changed) {
            await this.appendCloseFacts(transaction, result.closeResult);
          }
          return result;
        });
        if (finalized.kind === 'PAYMENT_CONFIRMED') {
          this.logger.log({ code: 'ORDER_TIMEOUT_PAYMENT_CONFIRMED_QUEUED_FOR_SETTLEMENT' });
        }
      } catch {
        this.logger.error({ code: 'ORDER_TIMEOUT_RECONCILIATION_FINALIZE_FAILED' });
      }
    }
  }

  private async providerCloseInput(claim: StoreOrderCloseClaimResult): Promise<StoreOrderCloseProviderInput> {
    const intent = claim.paymentIntent;
    if (intent === null || claim.providerOperation === null) {
      throw new Error('Order close Provider facts are unavailable');
    }
    let result: PaymentProviderIntentResult;
    try {
      const locate = { intentNo: intent.intentNo, providerIntentId: intent.providerIntentId };
      result = claim.providerOperation === 'QUERY'
        ? await this.paymentProvider!.query(locate)
        : await this.paymentProvider!.close(locate);
      if (claim.providerOperation === 'QUERY' && result.outcome === 'OPEN' &&
        result.providerIntentId !== null) {
        result = await this.paymentProvider!.close({
          intentNo: intent.intentNo,
          providerIntentId: result.providerIntentId,
        });
      }
    } catch {
      result = {
        capability: null,
        failureCode: 'PROVIDER_UNAVAILABLE',
        occurredAt: null,
        outcome: 'UNKNOWN',
        providerEventId: null,
        providerIntentId: intent.providerIntentId,
        providerTransactionId: null,
      };
    }
    return {
      ...(result.failureCode === null ? {} : { errorCode: result.failureCode }),
      expectedIntentVersion: intent.version,
      ...(result.occurredAt === null ? {} : { occurredAt: result.occurredAt }),
      outcome: result.outcome,
      orderId: claim.order.orderId,
      paymentIntentId: intent.paymentIntentId,
      ...(result.providerEventId === null ? {} : { providerEventId: result.providerEventId }),
      ...(result.providerIntentId === null ? {} : { providerIntentId: result.providerIntentId }),
      providerState: result.outcome,
      ...(result.providerTransactionId === null ? {} : { providerTransactionId: result.providerTransactionId }),
    };
  }

  private async persistRecoveredMockSuccess(
    transaction: DatabaseTransaction,
    intent: NonNullable<StoreOrderCloseClaimResult['paymentIntent']>,
    providerInput: StoreOrderCloseProviderInput,
  ): Promise<void> {
    const signingKey = this.config.payment.mockSigningKey;
    if (!this.callbacks || intent.provider !== 'MOCK' || this.config.payment.provider !== 'MOCK' ||
      (this.config.environment !== 'development' && this.config.environment !== 'test') || signingKey === undefined) {
      throw new Error('Recovered payment success cannot be verified');
    }
    const callback = createSignedMockPaymentSuccessCallback(signingKey, intent.amount, {
      capability: null,
      failureCode: null,
      occurredAt: providerInput.occurredAt ?? null,
      outcome: 'SUCCEEDED',
      providerEventId: providerInput.providerEventId ?? null,
      providerIntentId: providerInput.providerIntentId ?? null,
      providerTransactionId: providerInput.providerTransactionId ?? null,
    });
    if (!verifyMockPaymentCallback(callback, signingKey)) {
      throw new Error('Recovered payment success signature is invalid');
    }
    await this.callbacks.receive(transaction, {
      eventType: callback.eventType,
      headers: callback.headers,
      payload: callback.payload as unknown as Prisma.InputJsonValue,
      provider: 'MOCK',
      providerEventId: callback.providerEventId,
      rawBody: callback.rawBody,
      signatureValid: true,
    });
  }

  private async expireBatch(): Promise<void> {
    for (let processed = 0; processed < this.config.worker.batchSize; processed += 1) {
      const kind = await runSerializableTransaction(this.database.prisma, async (transaction) => {
        const result = await this.orders.expireNextOrderInTransaction(transaction);
        if (result.kind === 'closed') await this.appendCloseFacts(transaction, result.result);
        return result.kind;
      });
      if (kind === 'none') return;
    }
  }

  private async appendCloseFacts(
    transaction: DatabaseTransaction,
    result: StoreOrderCloseResult,
  ): Promise<void> {
    await this.audit.append(transaction, {
      action: 'CANCEL',
      after: { status: result.order.orderStatus, version: result.order.version },
      before: { status: result.before.orderStatus, version: result.before.version },
      module: 'order',
      objectId: result.order.orderId,
      objectType: 'order',
      requestId: `trace_${randomUUID().replaceAll('-', '')}`,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
    await this.outbox.append(transaction, {
      aggregateId: result.order.orderId,
      aggregateType: 'order',
      eventType: 'order.closed',
      payload: {
        event_version: 1,
        resource_id: result.order.orderId,
        resource_type: 'order',
        resource_version: result.order.version,
      },
    });
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.pollOnce().finally(() => this.schedule(this.config.worker.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }
}
