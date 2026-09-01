import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type AdminRefundFinalizeResult,
  type AdminRefundProviderOperation,
  type AdminRefundRepository,
  type AuditRepository,
  type CallbackInboxRepository,
  type DatabaseRuntime,
  type OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import {
  createSignedMockRefundCallback,
  decodeMockRefundCallback,
  type MockRefundCallback,
  type PaymentProviderPort,
  type PaymentProviderRefundResult,
  type PaymentRefundQueryPort,
} from '@qingxu/payment';

import { DATABASE_RUNTIME } from './database-runtime.provider';
import {
  CALLBACK_INBOX_REPOSITORY,
  OUTBOX_REPOSITORY,
  type CallbackHandlerRegistration,
  type OutboxHandlerRegistration,
  type WorkerCallbackHandler,
  type WorkerOutboxHandler,
  WORKER_CONFIG,
} from './outbox-dispatcher.service';

export const REFUND_EXECUTION_REQUESTED_EVENT = 'refund.execution.requested';
export const MOCK_REFUND_CALLBACK_EVENT_TYPES = ['refund.succeeded', 'refund.failed'] as const;

export const REFUND_PROCESSING_REPOSITORY = Symbol('REFUND_PROCESSING_REPOSITORY');
export const REFUND_PROCESSING_AUDIT_REPOSITORY = Symbol('REFUND_PROCESSING_AUDIT_REPOSITORY');
export const REFUND_PROCESSING_PAYMENT_PROVIDER = Symbol('REFUND_PROCESSING_PAYMENT_PROVIDER');

export type WorkerRefundRepository = Pick<AdminRefundRepository,
  | 'claimRefundAttemptInTransaction'
  | 'finalizeRefundAttemptInTransaction'
  | 'getRefundInTransaction'
  | 'isHistoricalRefundAttemptReplayInTransaction'>;
export type RefundProcessingAuditRepository = Pick<AuditRepository, 'append'>;
export type RefundProcessingOutboxRepository = Pick<OutboxRepository, 'append'>;
export type RefundProcessingInboxRepository = Pick<CallbackInboxRepository, 'receiveForReconciliation'>;
export type RefundProcessingProvider = PaymentProviderPort & PaymentRefundQueryPort;

type CallbackInboxEvent = Parameters<WorkerCallbackHandler>[0];
type ExecutionOutboxEvent = Parameters<WorkerOutboxHandler>[0];
type RefundInboxInput = Parameters<RefundProcessingInboxRepository['receiveForReconciliation']>[0];
type RefundInboxPayload = Exclude<RefundInboxInput['payload'], undefined>;

function resourcePayload(resourceType: string, resourceId: string, version: number) {
  return {
    event_version: 1 as const,
    resource_id: resourceId,
    resource_type: resourceType,
    resource_version: version,
  };
}

function requestId(reference: string): string {
  return `req_${createHash('sha256').update(reference).digest('hex').slice(0, 32)}`;
}

function executionReference(event: ExecutionOutboxEvent): { refundId: string; resourceVersion: number } {
  if (event.aggregate_type !== 'refund' || event.event_type !== REFUND_EXECUTION_REQUESTED_EVENT ||
    typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload) ||
    Object.getPrototypeOf(event.payload) !== Object.prototype || Object.keys(event.payload).length !== 4 ||
    !Object.keys(event.payload).every((key) =>
      key === 'event_version' || key === 'resource_id' || key === 'resource_type' || key === 'resource_version')) {
    throw new Error('Refund execution Outbox fact is invalid');
  }
  const payload = event.payload as Record<string, unknown>;
  if (payload.event_version !== 1 || payload.resource_type !== 'refund' ||
    payload.resource_id !== event.aggregate_id || typeof payload.resource_id !== 'string' ||
    !Number.isSafeInteger(payload.resource_version) || Number(payload.resource_version) < 1 ||
    Number(payload.resource_version) > 2_147_483_647) {
    throw new Error('Refund execution Outbox payload is invalid');
  }
  return { refundId: payload.resource_id, resourceVersion: Number(payload.resource_version) };
}

function terminalProviderResult(result: PaymentProviderRefundResult): PaymentProviderRefundResult {
  if ((result.outcome !== 'SUCCEEDED' && result.outcome !== 'FAILED') ||
    result.failureCode !== null || result.providerRefundId === null || result.providerEventId === null ||
    !(result.occurredAt instanceof Date) || !Number.isFinite(result.occurredAt.getTime())) {
    throw new Error('Refund Provider has not returned a terminal authoritative fact');
  }
  return result;
}

function callbackEnvelope(event: CallbackInboxEvent): MockRefundCallback {
  if (event.provider !== 'MOCK' || event.signature_valid !== true ||
    event.status !== 'RECEIVED' || event.signature_nonce !== null || event.provider_serial_no !== null ||
    (event.event_type !== 'refund.succeeded' && event.event_type !== 'refund.failed') ||
    typeof event.headers !== 'object' || event.headers === null || Array.isArray(event.headers) ||
    (event.headers as Record<string, unknown>).mock_timestamp !== event.signature_timestamp ||
    typeof event.payload !== 'object' || event.payload === null || Array.isArray(event.payload)) {
    throw new Error('Mock refund Inbox fact is invalid');
  }
  return {
    eventType: event.event_type,
    headers: event.headers as MockRefundCallback['headers'],
    payload: event.payload as unknown as MockRefundCallback['payload'],
    providerEventId: event.provider_event_id,
    rawBody: Buffer.from(event.raw_body),
  };
}

function positiveVersion(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647;
}

function assertFinalizationResult(
  operation: AdminRefundProviderOperation,
  outcome: 'FAILED' | 'SUCCEEDED',
  result: AdminRefundFinalizeResult,
): void {
  const expectedStatus = outcome === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED';
  if (!Array.isArray(result.inventoryLedgerFacts) || !Array.isArray(result.commissionLedgerIds)) {
    throw new Error('Refund finalization repository result is invalid');
  }
  const inventoryLedgerIds = result.inventoryLedgerFacts.map((fact) => fact.ledgerId);
  const inventoryFactsValid = result.inventoryLedgerFacts.every((fact) =>
    typeof fact === 'object' && fact !== null && !Array.isArray(fact) &&
    Object.keys(fact).length === 2 && typeof fact.ledgerId === 'string' &&
    (fact.ledgerType === 'REFUND_RESTOCK' || fact.ledgerType === 'RETURN_RESTOCK' ||
      fact.ledgerType === 'RETURN_DAMAGED'));
  const ledgerIds = [...inventoryLedgerIds, ...result.commissionLedgerIds];
  if (result.refundId !== operation.refundId || result.orderId !== operation.orderId ||
    !positiveVersion(result.beforeRefundVersion) || !positiveVersion(result.afterRefundVersion) ||
    !positiveVersion(result.beforeOrderVersion) || !positiveVersion(result.afterOrderVersion) ||
    !inventoryFactsValid || ledgerIds.some((id) => typeof id !== 'string') ||
    new Set(ledgerIds).size !== ledgerIds.length ||
    (result.changed && (
      result.kind !== outcome || result.beforeRefundStatus !== 'PROCESSING' ||
      result.afterRefundStatus !== expectedStatus ||
      result.afterRefundVersion !== result.beforeRefundVersion + 1 ||
      result.afterOrderVersion !== result.beforeOrderVersion + 1
    )) || (!result.changed && (
      result.kind !== 'REPLAY' || result.afterRefundStatus !== result.beforeRefundStatus ||
      result.afterRefundStatus !== expectedStatus ||
      result.afterRefundVersion !== result.beforeRefundVersion ||
      result.afterOrderVersion !== result.beforeOrderVersion
    )) || (outcome === 'FAILED' && ledgerIds.length > 0)) {
    throw new Error('Refund finalization repository result is invalid');
  }
}

@Injectable()
export class RefundProcessingService {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(WORKER_CONFIG) private readonly config: PlatformRuntimeConfig,
    @Inject(REFUND_PROCESSING_REPOSITORY) private readonly refunds: WorkerRefundRepository,
    @Inject(REFUND_PROCESSING_AUDIT_REPOSITORY)
    private readonly audit: RefundProcessingAuditRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: RefundProcessingOutboxRepository,
    @Inject(CALLBACK_INBOX_REPOSITORY) private readonly inbox: RefundProcessingInboxRepository,
    @Inject(REFUND_PROCESSING_PAYMENT_PROVIDER) private readonly provider: RefundProcessingProvider,
  ) {}

  registrations(): {
    callbacks: readonly CallbackHandlerRegistration[];
    outbox: readonly OutboxHandlerRegistration[];
  } {
    return {
      callbacks: MOCK_REFUND_CALLBACK_EVENT_TYPES.map((eventType) => ({
        eventType,
        handle: (event: CallbackInboxEvent) => this.handleCallback(event),
        provider: 'MOCK' as const,
        retryAfterExhaustion: true,
      })),
      outbox: [{
        eventType: REFUND_EXECUTION_REQUESTED_EVENT,
        handle: (event: ExecutionOutboxEvent) => this.handleExecution(event),
        retryAfterExhaustion: true,
      }],
    };
  }

  async handleExecution(event: ExecutionOutboxEvent): Promise<void> {
    const { refundId, resourceVersion } = executionReference(event);
    const operation = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      const refund = await this.refunds.getRefundInTransaction(transaction, { refundId });
      if (!positiveVersion(refund.version) || refund.version < resourceVersion) {
        throw new Error('Refund execution Outbox version is ahead of the authoritative refund');
      }
      const initialExecution = refund.status === 'PENDING' && refund.version === resourceVersion;
      const claimedRecovery = refund.status === 'PROCESSING' && refund.version === resourceVersion + 1;
      if (!initialExecution && !claimedRecovery) {
        if (refund.version > resourceVersion) return null;
        throw new Error('Refund execution Outbox state does not match its version');
      }
      return this.refunds.claimRefundAttemptInTransaction(transaction, {
        refundAttemptId: refund.attemptId,
        refundId,
      });
    });
    if (operation === null) return;
    if (operation.provider !== 'MOCK') throw new Error('Ordinary refund Provider is not enabled');

    const queried = await this.provider.queryRefund({
      providerRefundId: operation.providerRefundId,
      refundNo: operation.refundNo,
    });
    const observed = queried.outcome === 'NOT_FOUND' || queried.outcome === 'FAILED'
      ? await this.provider.refund({
          amount: operation.amount,
          providerIntentId: operation.providerIntentId,
          providerTransactionId: operation.providerTransactionId,
          providerRequestId: operation.attemptId,
          refundNo: operation.refundNo,
        })
      : queried;
    const terminal = terminalProviderResult(observed);
    if (operation.providerRefundId !== null && operation.providerRefundId !== terminal.providerRefundId) {
      throw new Error('Refund Provider identity conflicts with the stable refund');
    }
    const signingKey = this.mockSigningKey();
    const callback = createSignedMockRefundCallback(signingKey, {
      amount: operation.amount,
      attemptNo: operation.attemptNo,
      refundAttemptId: operation.attemptId,
      refundNo: operation.refundNo,
    }, terminal);
    await this.inbox.receiveForReconciliation({
      eventType: callback.eventType,
      headers: callback.headers,
      payload: callback.payload as unknown as RefundInboxPayload,
      provider: 'MOCK',
      providerEventId: callback.providerEventId,
      rawBody: callback.rawBody,
      signatureValid: true,
    });
  }

  async handleCallback(event: CallbackInboxEvent): Promise<void> {
    const payload = decodeMockRefundCallback(callbackEnvelope(event), this.mockSigningKey());
    const finalization = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      const historicalReplay = await this.refunds.isHistoricalRefundAttemptReplayInTransaction(transaction, {
        amount: payload.amount,
        attemptNo: payload.attempt_no,
        outcome: payload.outcome,
        providerEventId: payload.provider_event_id,
        providerRefundId: payload.provider_refund_id,
        refundAttemptId: payload.refund_attempt_id,
        refundId: payload.refund_no.slice(2),
        refundNo: payload.refund_no,
      });
      if (historicalReplay) return null;
      const operation = await this.refunds.claimRefundAttemptInTransaction(transaction, {
        refundAttemptId: payload.refund_attempt_id,
        refundId: payload.refund_no.slice(2),
      });
      if (operation.provider !== 'MOCK' || operation.refundId !== payload.refund_no.slice(2) ||
        operation.refundNo !== payload.refund_no || operation.attemptId !== payload.refund_attempt_id ||
        operation.attemptNo !== payload.attempt_no || operation.amount !== payload.amount ||
        (operation.providerRefundId !== null && operation.providerRefundId !== payload.provider_refund_id)) {
        throw new Error('Mock refund callback does not match the authoritative refund attempt');
      }
      const result = await this.refunds.finalizeRefundAttemptInTransaction(transaction, {
        operation,
        result: payload.outcome === 'SUCCEEDED'
          ? {
              kind: 'SUCCEEDED',
              occurredAt: new Date(payload.occurred_at),
              providerEventId: payload.provider_event_id,
              providerRefundId: payload.provider_refund_id,
            }
          : {
              failureCode: 'PROVIDER_FAILED',
              kind: 'FAILED',
              occurredAt: new Date(payload.occurred_at),
              providerEventId: payload.provider_event_id,
              providerRefundId: payload.provider_refund_id,
            },
      });
      assertFinalizationResult(operation, payload.outcome, result);
      await this.recordFinalization(transaction, payload.provider_event_id, result);
      return result;
    });
    if (finalization === null) return;
    if (finalization.kind === 'PROCESSING') throw new Error('Refund result has not converged');
  }

  private async recordFinalization(
    transaction: Parameters<RefundProcessingAuditRepository['append']>[0],
    providerEventId: string,
    result: AdminRefundFinalizeResult,
  ): Promise<void> {
    if (!result.changed) return;
    const eventType = result.kind === 'SUCCEEDED' ? 'refund.succeeded' : 'refund.failed';
    await this.audit.append(transaction, {
      action: 'REFUND',
      after: { status: result.afterRefundStatus, version: result.afterRefundVersion },
      before: { status: result.beforeRefundStatus, version: result.beforeRefundVersion },
      module: 'refund',
      objectId: result.refundId,
      objectType: 'refund',
      requestId: requestId(providerEventId),
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
    await this.outbox.append(transaction, {
      aggregateId: result.refundId,
      aggregateType: 'refund',
      eventType,
      payload: resourcePayload('refund', result.refundId, result.afterRefundVersion),
    });
    await this.outbox.append(transaction, {
      aggregateId: result.orderId,
      aggregateType: 'order',
      eventType: result.kind === 'SUCCEEDED' ? 'order.refund.succeeded' : 'order.refund.failed',
      payload: resourcePayload('order', result.orderId, result.afterOrderVersion),
    });
    for (const fact of [...result.inventoryLedgerFacts].sort((left, right) =>
      left.ledgerId.localeCompare(right.ledgerId))) {
      await this.outbox.append(transaction, {
        aggregateId: fact.ledgerId,
        aggregateType: 'inventory',
        eventType: fact.ledgerType === 'RETURN_DAMAGED'
          ? 'inventory.refund.disposition.recorded'
          : 'inventory.refund.restocked',
        payload: resourcePayload('inventory', fact.ledgerId, 1),
      });
    }
    for (const ledgerId of [...result.commissionLedgerIds].sort()) {
      await this.outbox.append(transaction, {
        aggregateId: ledgerId,
        aggregateType: 'commission',
        eventType: 'commission.refund.reversed',
        payload: resourcePayload('commission', ledgerId, 1),
      });
    }
  }

  private mockSigningKey(): Uint8Array {
    if ((this.config.environment !== 'development' && this.config.environment !== 'test') ||
      this.config.payment.provider !== 'MOCK' || this.config.payment.mockSigningKey === undefined) {
      throw new Error('Mock refund processing is not enabled');
    }
    return this.config.payment.mockSigningKey;
  }
}
