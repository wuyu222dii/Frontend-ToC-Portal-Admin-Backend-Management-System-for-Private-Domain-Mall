import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  CallbackInboxRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  PaymentReconciliationRepository,
  type PaymentReconciliationActionFacts,
  type PaymentReconciliationConvergedProjection,
  type PaymentReconciliationCurrentProjection,
  type PaymentReconciliationLateRefundRetryResult,
  type PaymentReconciliationTask,
  type Prisma,
  type ReceiveCallbackInput,
  runSerializableTransaction,
  StoreOrderRepository,
  type StoreOrderCloseFinalizeResult,
  type StoreOrderCloseProviderInput,
  StorePaymentRepository,
  type StorePaymentProviderFinalization,
  withBoundedSessionAdvisoryLock,
} from '@qingxu/database';
import {
  createSignedMockPaymentSuccessCallback,
  type PaymentProviderIntentResult,
  type PaymentProviderPort,
  type PaymentProviderRefundResult,
  verifyMockPaymentCallback,
} from '@qingxu/payment';
import { ApplicationError } from '@qingxu/platform-core';

import { catalogRequestIp, type AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { PAYMENT_PROVIDER } from '../store-payments/store-payments.service';
import type {
  PaymentReconciliationListInput,
  PaymentReconciliationRequest,
} from './admin-payments.dto';

const RECONCILE_ROUTE = '/admin/payment-intents/{payment_intent_id}/reconcile';
const RECONCILE_DELAY_MS = 60_000;
const RECONCILE_OWNER_LOCK_NAMESPACE = 'admin-payment-reconciliation';

export interface AdminPaymentReconciliationResult {
  data: Record<string, unknown>;
  statusCode: 200 | 202;
}

type ProviderReconciliationAction = Exclude<
  PaymentReconciliationActionFacts,
  { kind: 'LATE_PAYMENT_REFUND' } | { kind: 'TERMINAL_CLOSE_REPAIR' }
>;

interface ReconciliationStateAuditInput {
  action: 'CANCEL' | 'REFUND' | 'RETRY';
  after: { status: string; version: number };
  before: { status: string; version: number };
  idempotencyKey: string;
  module: 'order' | 'payment' | 'refund';
  objectId: string;
  objectType: 'order' | 'payment' | 'refund';
  reason: string | undefined;
}

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError(
    'INTERNAL_ERROR',
    message,
    [],
    cause === undefined ? undefined : { cause },
  );
}

function providerUnavailable(): ApplicationError {
  return new ApplicationError('PAYMENT_PROVIDER_UNAVAILABLE', 'Payment Provider is unavailable');
}

function configurationUnavailable(): ApplicationError {
  return new ApplicationError('PAYMENT_CONFIGURATION_UNAVAILABLE', 'Payment configuration is unavailable');
}

function resultConflict(): ApplicationError {
  return new ApplicationError('PAYMENT_RESULT_CONFLICT', 'Payment Provider result conflicts with stored facts');
}

function validReference(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 128 && /^[\x20-\x7e]+$/.test(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function normalizeRefundResult(result: PaymentProviderRefundResult) {
  if (result.outcome === 'SUCCEEDED' && result.failureCode === null && validReference(result.providerRefundId) &&
    validReference(result.providerEventId) && validDate(result.occurredAt)) {
    return {
      kind: 'SUCCEEDED' as const,
      occurredAt: result.occurredAt,
      providerEventId: result.providerEventId,
      providerRefundId: result.providerRefundId,
    };
  }
  return {
    failureCode: result.failureCode ?? 'INVALID_PROVIDER_STATE',
    kind: 'FAILED' as const,
    occurredAt: validDate(result.occurredAt) ? result.occurredAt : null,
  };
}

@Injectable()
export class AdminPaymentsService {
  private readonly audit!: AuditRepository;
  private readonly callbacks!: CallbackInboxRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly orders!: StoreOrderRepository;
  private readonly outbox!: OutboxRepository;
  private readonly payments = new StorePaymentRepository();
  private readonly reconciliations!: PaymentReconciliationRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(PAYMENT_PROVIDER) private readonly provider?: PaymentProviderPort,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.callbacks = new CallbackInboxRepository(database);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.orders = new StoreOrderRepository(database.prisma);
      this.outbox = new OutboxRepository(database);
      this.reconciliations = new PaymentReconciliationRepository(database.prisma);
    }
  }

  async listTasks(input: PaymentReconciliationListInput) {
    const result = await this.repository().listTasks(input);
    return {
      items: result.items.map((task) => this.taskView(task)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async reconcile(
    request: AdminCatalogRequestContext,
    paymentIntentId: string,
    input: PaymentReconciliationRequest,
    idempotencyKey: string,
  ): Promise<AdminPaymentReconciliationResult> {
    return this.withReconciliationOwner(paymentIntentId, () =>
      this.reconcileOwned(request, paymentIntentId, input, idempotencyKey));
  }

  private async reconcileOwned(
    request: AdminCatalogRequestContext,
    paymentIntentId: string,
    input: PaymentReconciliationRequest,
    idempotencyKey: string,
  ): Promise<AdminPaymentReconciliationResult> {
    const claim = this.claim(request.principal.accountId, paymentIntentId, input, idempotencyKey);
    const replay = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind !== 'replay') return false;
      if (claimed.record.resource_id !== paymentIntentId) {
        throw internal('Payment reconciliation idempotency resource is invalid');
      }
      this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
        resourceId: paymentIntentId,
        responseForHash: this.idempotencyResponse(paymentIntentId),
        responseStatus: claimed.record.response_status,
        storage: 'HASH_ONLY',
      });
      return true;
    });
    if (replay) return this.currentResult(paymentIntentId);

    const action = await this.repository().readActionFacts(paymentIntentId);
    if (action === null) {
      const current = await this.current(paymentIntentId);
      return this.complete(request, claim, current, input.reason, idempotencyKey, paymentIntentId);
    }

    if (action.kind === 'LATE_PAYMENT_REFUND') {
      await this.reconcileLateRefund(request, action, input.reason, idempotencyKey);
    } else if (action.kind === 'TERMINAL_CLOSE_REPAIR') {
      await this.reconcileTerminalCloseRepair(request, action, input.reason, idempotencyKey);
    } else {
      await this.reconcilePayment(request, action, input.reason, idempotencyKey);
    }
    const current = await this.current(paymentIntentId);
    return this.complete(request, claim, current, input.reason, idempotencyKey, paymentIntentId);
  }

  private async reconcilePayment(
    request: AdminCatalogRequestContext,
    action: ProviderReconciliationAction,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    this.assertConfiguredProvider(action.provider);
    const result = await this.queryOrClose(action);
    if (action.kind === 'PAYMENT_INTENT' && action.status === 'CLOSE_PENDING') {
      await this.reconcileClosePending(request, action, result, reason, idempotencyKey);
      return;
    }
    if (result.outcome === 'SUCCEEDED') {
      await this.persistMockSuccess(action, result);
      return;
    }
    if (action.kind === 'PAYMENT_SETTLEMENT') return;
    const finalization = this.paymentFinalization(action, result);
    await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const finalized = await this.payments.finalizeProviderOutcomeInTransaction(transaction, {
        expectedVersion: action.version,
        orderId: action.orderId,
        paymentIntentId: action.paymentIntentId,
        provider: action.provider,
        result: finalization,
      });
      if (!finalized.changed) return;
      await this.appendStateAudit(transaction, request, {
        action: 'RETRY',
        after: { status: finalized.intent.status, version: finalized.intent.version },
        before: { status: action.status, version: action.version },
        idempotencyKey,
        module: 'payment',
        objectId: action.paymentIntentId,
        objectType: 'payment',
        reason,
      });
      await this.outboxRepository().append(transaction, {
        aggregateId: action.paymentIntentId,
        aggregateType: 'payment',
        eventType: 'payment.intent.updated',
        payload: this.resourcePayload('payment', action.paymentIntentId, finalized.intent.version),
      });
    });
  }

  private async reconcileTerminalCloseRepair(
    request: AdminCatalogRequestContext,
    action: Extract<PaymentReconciliationActionFacts, { kind: 'TERMINAL_CLOSE_REPAIR' }>,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const repaired = await this.orderRepository().repairTerminalOrderCloseInTransaction(transaction, {
        expectedIntentVersion: action.version,
        orderId: action.orderId,
        paymentIntentId: action.paymentIntentId,
      });
      if (!repaired.changed) return;
      await this.appendStateAudit(transaction, request, {
        action: 'CANCEL',
        after: { status: repaired.order.orderStatus, version: repaired.order.version },
        before: { status: repaired.before.orderStatus, version: repaired.before.version },
        idempotencyKey,
        module: 'order',
        objectId: action.orderId,
        objectType: 'order',
        reason,
      });
      await this.outboxRepository().append(transaction, {
        aggregateId: action.orderId,
        aggregateType: 'order',
        eventType: 'order.closed',
        payload: this.resourcePayload('order', action.orderId, repaired.order.version),
      });
    });
  }

  private async reconcileClosePending(
    request: AdminCatalogRequestContext,
    action: Extract<PaymentReconciliationActionFacts, { kind: 'PAYMENT_INTENT' }>,
    providerResult: PaymentProviderIntentResult,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    const callbackInput = providerResult.outcome === 'SUCCEEDED'
      ? this.mockSuccessCallbackInput(action, providerResult)
      : null;
    const input: StoreOrderCloseProviderInput = {
      errorCode: providerResult.failureCode,
      expectedIntentVersion: action.version,
      occurredAt: providerResult.occurredAt,
      orderId: action.orderId,
      outcome: providerResult.outcome,
      paymentIntentId: action.paymentIntentId,
      providerEventId: providerResult.providerEventId,
      providerIntentId: providerResult.providerIntentId,
      providerState: providerResult.outcome,
      providerTransactionId: providerResult.providerTransactionId,
    };
    const finalized = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const finalized = await this.orderRepository().finalizeOrderCloseInTransaction(transaction, input);
      await this.appendClosePendingFacts(
        transaction,
        request,
        action,
        finalized,
        reason,
        idempotencyKey,
      );
      if (finalized.kind === 'PAYMENT_CONFIRMED') {
        if (callbackInput === null) throw internal('Confirmed payment callback facts are unavailable');
        await this.callbackRepository().receive(transaction, callbackInput);
      }
      return finalized;
    });
    if (finalized.kind === 'PAYMENT_CONFIRMED') {
      if (callbackInput === null) throw internal('Confirmed payment callback facts are unavailable');
      // The transactional receive protects a new success observation. After
      // commit, the synchronized path also recovers an older FAILED/PROCESSED
      // Inbox fact without racing the callback worker that may still own it.
      await this.callbackRepository().receiveForReconciliation(callbackInput);
    }
  }

  private async appendClosePendingFacts(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    action: Extract<PaymentReconciliationActionFacts, { kind: 'PAYMENT_INTENT' }>,
    finalized: StoreOrderCloseFinalizeResult,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    if (finalized.paymentIntent.version !== action.version) {
      await this.appendStateAudit(transaction, request, {
        action: 'RETRY',
        after: { status: finalized.paymentIntent.status, version: finalized.paymentIntent.version },
        before: { status: action.status, version: action.version },
        idempotencyKey,
        module: 'payment',
        objectId: action.paymentIntentId,
        objectType: 'payment',
        reason,
      });
      await this.outboxRepository().append(transaction, {
        aggregateId: action.paymentIntentId,
        aggregateType: 'payment',
        eventType: 'payment.intent.updated',
        payload: this.resourcePayload('payment', action.paymentIntentId, finalized.paymentIntent.version),
      });
    }
    if (finalized.kind !== 'CLOSED' || finalized.closeResult?.changed !== true) return;
    await this.appendStateAudit(transaction, request, {
      action: 'CANCEL',
      after: {
        status: finalized.closeResult.order.orderStatus,
        version: finalized.closeResult.order.version,
      },
      before: {
        status: finalized.closeResult.before.orderStatus,
        version: finalized.closeResult.before.version,
      },
      idempotencyKey,
      module: 'order',
      objectId: action.orderId,
      objectType: 'order',
      reason,
    });
    await this.outboxRepository().append(transaction, {
      aggregateId: action.orderId,
      aggregateType: 'order',
      eventType: 'order.closed',
      payload: this.resourcePayload('order', action.orderId, finalized.closeResult.order.version),
    });
  }

  private async queryOrClose(
    action: ProviderReconciliationAction,
  ): Promise<PaymentProviderIntentResult> {
    const provider = this.paymentProvider();
    const locate = { intentNo: action.intentNo, providerIntentId: action.providerIntentId };
    try {
      let result = this.authoritativeProviderIntentResult(
        action.providerIntentId,
        await provider.query(locate),
      );
      if (action.status === 'CLOSE_PENDING' && result.outcome === 'OPEN') {
        if (result.providerIntentId === null) throw resultConflict();
        const providerIntentId = result.providerIntentId;
        result = this.authoritativeProviderIntentResult(
          providerIntentId,
          await provider.close({ intentNo: action.intentNo, providerIntentId }),
        );
      }
      return result;
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      return {
        capability: null,
        failureCode: 'PROVIDER_UNAVAILABLE',
        occurredAt: null,
        outcome: 'UNKNOWN',
        providerEventId: null,
        providerIntentId: action.providerIntentId,
        providerTransactionId: null,
      };
    }
  }

  private authoritativeProviderIntentResult(
    authoritativeProviderIntentId: string | null,
    result: PaymentProviderIntentResult,
  ): PaymentProviderIntentResult {
    if (authoritativeProviderIntentId === null) return result;
    if (result.providerIntentId !== null && result.providerIntentId !== authoritativeProviderIntentId) {
      throw resultConflict();
    }
    return result.providerIntentId === null
      ? { ...result, providerIntentId: authoritativeProviderIntentId }
      : result;
  }

  private paymentFinalization(
    action: Extract<PaymentReconciliationActionFacts, { kind: 'PAYMENT_INTENT' }>,
    result: PaymentProviderIntentResult,
  ): StorePaymentProviderFinalization {
    const nextReconcileAt = new Date(Date.now() + RECONCILE_DELAY_MS);
    if (result.outcome === 'OPEN' && validReference(result.providerIntentId)) {
      return {
        kind: 'OPEN',
        nextReconcileAt,
        providerIntentId: result.providerIntentId,
        providerState: 'OPEN',
      };
    }
    if (result.outcome === 'FAILED' || result.outcome === 'CANCELLED' || result.outcome === 'CLOSED' ||
      result.outcome === 'NOT_FOUND') {
      return {
        errorCode: result.failureCode ?? (result.outcome === 'NOT_FOUND' ? 'PROVIDER_NOT_FOUND' : null),
        kind: 'TERMINAL',
        providerIntentId: result.providerIntentId,
        providerState: result.outcome,
        status: result.outcome === 'NOT_FOUND' ? 'CLOSED' : result.outcome,
      };
    }
    return {
      errorCode: result.failureCode ?? 'PROVIDER_UNKNOWN',
      kind: 'UNKNOWN',
      nextReconcileAt,
      providerState: result.outcome,
    };
  }

  private async reconcileLateRefund(
    request: AdminCatalogRequestContext,
    action: Extract<PaymentReconciliationActionFacts, { kind: 'LATE_PAYMENT_REFUND' }>,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    this.assertConfiguredProvider(action.provider);
    let operation = action.lateRefundOperation;
    if (action.refundStatus === 'FAILED') {
      const prepared = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
        const retry = await this.repository().prepareLatePaymentRefundRetryInTransaction(transaction, {
          paymentIntentId: action.paymentIntentId,
        });
        await this.appendLateRefundRetryFacts(transaction, request, retry, reason, idempotencyKey);
        return retry;
      });
      operation = prepared.operation;
    }
    if (operation === null) throw internal('Late payment refund operation is unavailable');
    const claimed = await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const result = await this.payments.claimLatePaymentRefundInTransaction(transaction, operation!);
      if (result.kind === 'CLAIMED' && result.operation.refundVersion !== operation!.refundVersion) {
        await this.appendStateAudit(transaction, request, {
          action: 'REFUND',
          after: { status: 'PROCESSING', version: result.operation.refundVersion },
          before: { status: 'PENDING', version: operation!.refundVersion },
          idempotencyKey,
          module: 'refund',
          objectId: result.operation.refundId,
          objectType: 'refund',
          reason,
        });
        await this.outboxRepository().append(transaction, {
          aggregateId: result.operation.refundId,
          aggregateType: 'refund',
          eventType: 'refund.processing',
          payload: this.resourcePayload('refund', result.operation.refundId, result.operation.refundVersion),
        });
      }
      return result;
    });
    if (claimed.kind === 'TERMINAL') return;
    let providerResult: PaymentProviderRefundResult;
    try {
      providerResult = await this.paymentProvider().refund({
        amount: claimed.operation.amount,
        providerIntentId: claimed.operation.providerIntentId,
        providerTransactionId: claimed.operation.providerTransactionId,
        refundNo: claimed.operation.refundNo,
      });
    } catch {
      providerResult = {
        failureCode: 'PROVIDER_UNAVAILABLE',
        occurredAt: null,
        outcome: 'UNKNOWN',
        providerEventId: null,
        providerRefundId: null,
      };
    }
    await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const result = await this.payments.finalizeLatePaymentRefundInTransaction(transaction, {
        operation: claimed.operation,
        result: normalizeRefundResult(providerResult),
      });
      if (!result.changed) return;
      await this.appendStateAudit(transaction, request, {
        action: 'REFUND',
        after: { status: result.afterRefundStatus, version: result.afterRefundVersion },
        before: { status: result.beforeRefundStatus, version: result.beforeRefundVersion },
        idempotencyKey,
        module: 'refund',
        objectId: result.refundId,
        objectType: 'refund',
        reason,
      });
      await this.appendStateAudit(transaction, request, {
        action: 'REFUND',
        after: { status: 'CLOSED', version: result.afterOrderVersion },
        before: { status: 'CLOSED', version: result.beforeOrderVersion },
        idempotencyKey,
        module: 'payment',
        objectId: result.orderId,
        objectType: 'order',
        reason,
      });
      await this.outboxRepository().append(transaction, {
        aggregateId: result.refundId,
        aggregateType: 'refund',
        eventType: result.kind === 'REFUNDED' ? 'refund.succeeded' : 'refund.manual_required',
        payload: this.resourcePayload('refund', result.refundId, result.afterRefundVersion),
      });
      await this.outboxRepository().append(transaction, {
        aggregateId: result.orderId,
        aggregateType: 'order',
        eventType: result.kind === 'REFUNDED'
          ? 'order.late_payment_refunded'
          : 'order.payment_manual_required',
        payload: this.resourcePayload('order', result.orderId, result.afterOrderVersion),
      });
    });
  }

  private async persistMockSuccess(
    action: ProviderReconciliationAction,
    result: PaymentProviderIntentResult,
  ): Promise<void> {
    await this.callbackRepository().receiveForReconciliation(this.mockSuccessCallbackInput(action, result));
  }

  private mockSuccessCallbackInput(
    action: ProviderReconciliationAction,
    result: PaymentProviderIntentResult,
  ): ReceiveCallbackInput {
    const config = this.runtimeConfig();
    const signingKey = config.payment.mockSigningKey;
    if (action.provider !== 'MOCK' || config.payment.provider !== 'MOCK' || signingKey === undefined ||
      (config.environment !== 'development' && config.environment !== 'test')) {
      throw providerUnavailable();
    }
    const callback = createSignedMockPaymentSuccessCallback(signingKey, action.amount, result);
    if (!verifyMockPaymentCallback(callback, signingKey)) throw providerUnavailable();
    return {
      eventType: callback.eventType,
      headers: callback.headers,
      payload: callback.payload as unknown as Prisma.InputJsonValue,
      provider: 'MOCK',
      providerEventId: callback.providerEventId,
      rawBody: callback.rawBody,
      signatureValid: true,
    };
  }

  private async appendLateRefundRetryFacts(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    retry: PaymentReconciliationLateRefundRetryResult,
    reason: string | undefined,
    idempotencyKey: string,
  ): Promise<void> {
    await this.appendStateAudit(transaction, request, {
      action: 'REFUND',
      after: { status: retry.afterRefundStatus, version: retry.afterRefundVersion },
      before: { status: retry.beforeRefundStatus, version: retry.beforeRefundVersion },
      idempotencyKey,
      module: 'refund',
      objectId: retry.operation.refundId,
      objectType: 'refund',
      reason,
    });
    await this.appendStateAudit(transaction, request, {
      action: 'REFUND',
      after: { status: retry.afterOrderStatus, version: retry.afterOrderVersion },
      before: { status: retry.beforeOrderStatus, version: retry.beforeOrderVersion },
      idempotencyKey,
      module: 'payment',
      objectId: retry.operation.orderId,
      objectType: 'order',
      reason,
    });
    await this.outboxRepository().append(transaction, {
      aggregateId: retry.operation.refundId,
      aggregateType: 'refund',
      eventType: 'refund.retry_requested',
      payload: this.resourcePayload('refund', retry.operation.refundId, retry.afterRefundVersion),
    });
    await this.outboxRepository().append(transaction, {
      aggregateId: retry.operation.orderId,
      aggregateType: 'order',
      eventType: 'order.late_payment_refund_pending',
      payload: this.resourcePayload('order', retry.operation.orderId, retry.afterOrderVersion),
    });
  }

  private appendStateAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    input: ReconciliationStateAuditInput,
  ): Promise<unknown> {
    const ipAddress = catalogRequestIp(request);
    return this.auditRepository().append(transaction, {
      action: input.action,
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: input.after,
      before: input.before,
      idempotencyKey: input.idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: input.module,
      objectId: input.objectId,
      objectType: input.objectType,
      ...(input.reason !== undefined && Array.from(input.reason).length >= 2 ? { reason: input.reason } : {}),
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private assertConfiguredProvider(provider: PaymentReconciliationActionFacts['provider']): void {
    if (provider !== this.runtimeConfig().payment.provider) throw configurationUnavailable();
  }

  private async withReconciliationOwner<T>(paymentIntentId: string, work: () => Promise<T>): Promise<T> {
    const lockTimeoutMs = Math.min(60_000, this.runtimeConfig().payment.providerTimeoutMs * 2);
    const locked = await withBoundedSessionAdvisoryLock(
      this.runtime().coordinationPool,
      RECONCILE_OWNER_LOCK_NAMESPACE,
      paymentIntentId,
      lockTimeoutMs,
      async () => work(),
    );
    if (!locked.acquired) throw providerUnavailable();
    return locked.value;
  }

  private async complete(
    request: AdminCatalogRequestContext,
    claim: IdempotencyClaim,
    current: PaymentReconciliationCurrentProjection,
    reason: string | undefined,
    idempotencyKey: string,
    paymentIntentId: string,
  ): Promise<AdminPaymentReconciliationResult> {
    const statusCode = current.kind === 'CONVERGED' ? 200 as const : 202 as const;
    await runSerializableTransaction(this.runtime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: paymentIntentId,
          responseForHash: this.idempotencyResponse(paymentIntentId),
          responseStatus: claimed.record.response_status,
          storage: 'HASH_ONLY',
        });
        return;
      }
      const ipAddress = catalogRequestIp(request);
      await this.auditRepository().append(transaction, {
        action: 'RETRY',
        actorAccountId: request.principal.accountId,
        actorRole: request.principal.role,
        idempotencyKey,
        ...(ipAddress === undefined ? {} : { ipAddress }),
        module: 'payment',
        objectId: paymentIntentId,
        objectType: 'payment',
        ...(reason !== undefined && Array.from(reason).length >= 2 ? { reason } : {}),
        requestId: request.requestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'NONE',
      });
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: paymentIntentId,
        responseForHash: this.idempotencyResponse(paymentIntentId),
        responseStatus: statusCode,
        storage: 'HASH_ONLY',
      });
    });
    return { data: this.currentView(current), statusCode };
  }

  private async currentResult(paymentIntentId: string): Promise<AdminPaymentReconciliationResult> {
    const current = await this.current(paymentIntentId);
    return {
      data: this.currentView(current),
      statusCode: current.kind === 'CONVERGED' ? 200 : 202,
    };
  }

  private async current(paymentIntentId: string): Promise<PaymentReconciliationCurrentProjection> {
    const current = await this.repository().findCurrentByPaymentIntentId(paymentIntentId);
    if (current === null) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Payment reconciliation task not found');
    }
    return current;
  }

  private taskView(task: PaymentReconciliationTask) {
    return {
      last_error_code: task.lastErrorCode,
      next_reconcile_at: task.nextReconcileAt?.toISOString() ?? null,
      order_id: task.orderId,
      payment_intent_id: task.paymentIntentId,
      payment_resolution: task.paymentResolution,
      reconciliation_attempt_count: task.reconciliationAttemptCount,
      reference_no: task.referenceNo,
      refund_id: task.refundId,
      status: task.status,
      task_type: task.taskType,
      version: task.version,
    };
  }

  private convergedView(projection: PaymentReconciliationConvergedProjection) {
    return {
      last_error_code: projection.lastErrorCode,
      order_id: projection.orderId,
      outcome: projection.outcome,
      payment_intent_id: projection.paymentIntentId,
      payment_intent_status: projection.paymentIntentStatus,
      payment_resolution: projection.paymentResolution,
      refund_id: projection.refundId,
      refund_status: projection.refundStatus,
      version: projection.version,
    };
  }

  private currentView(current: PaymentReconciliationCurrentProjection) {
    return current.kind === 'CONVERGED' ? this.convergedView(current.projection) : this.taskView(current.task);
  }

  private claim(
    actorId: string,
    paymentIntentId: string,
    input: PaymentReconciliationRequest,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: input.reason === undefined ? {} : { reason: input.reason },
        method: 'POST',
        pathParameters: { payment_intent_id: paymentIntentId },
        route: RECONCILE_ROUTE,
      },
    };
  }

  private idempotencyResponse(paymentIntentId: string) {
    return { reconciliation: { payment_intent_id: paymentIntentId } };
  }

  private resourcePayload(resourceType: string, resourceId: string, resourceVersion: number) {
    return {
      event_version: 1 as const,
      resource_id: resourceId,
      resource_type: resourceType,
      resource_version: resourceVersion,
    };
  }

  private repository(): PaymentReconciliationRepository {
    if (!this.reconciliations) throw internal('Payment reconciliation repository is unavailable');
    return this.reconciliations;
  }

  private orderRepository(): StoreOrderRepository {
    if (!this.orders) throw internal('Payment reconciliation Order repository is unavailable');
    return this.orders;
  }

  private runtime(): DatabaseRuntime {
    if (!this.database) throw internal('Payment reconciliation database is unavailable');
    return this.database;
  }

  private runtimeConfig(): PlatformRuntimeConfig {
    if (!this.config) throw internal('Payment reconciliation configuration is unavailable');
    return this.config;
  }

  private paymentProvider(): PaymentProviderPort {
    if (!this.provider) throw providerUnavailable();
    return this.provider;
  }

  private idempotencyRepository(): IdempotencyRepository {
    if (!this.idempotency) throw internal('Payment reconciliation idempotency is unavailable');
    return this.idempotency;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw internal('Payment reconciliation audit is unavailable');
    return this.audit;
  }

  private callbackRepository(): CallbackInboxRepository {
    if (!this.callbacks) throw internal('Payment reconciliation Inbox is unavailable');
    return this.callbacks;
  }

  private outboxRepository(): OutboxRepository {
    if (!this.outbox) throw internal('Payment reconciliation Outbox is unavailable');
    return this.outbox;
  }
}
