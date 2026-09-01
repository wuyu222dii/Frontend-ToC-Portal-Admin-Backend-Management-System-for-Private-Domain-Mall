import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AdminRefundFinalizeResult,
  AdminRefundProviderOperation,
  AdminRefundSnapshot,
  DatabaseRuntime,
  DatabaseTransaction,
} from '@qingxu/database';
import { createSignedMockRefundCallback } from '@qingxu/payment';
import { describe, expect, it, vi } from 'vitest';

import type { WorkerCallbackHandler, WorkerOutboxHandler } from './outbox-dispatcher.service';
import {
  MOCK_REFUND_CALLBACK_EVENT_TYPES,
  REFUND_EXECUTION_REQUESTED_EVENT,
  RefundProcessingService,
  type RefundProcessingAuditRepository,
  type RefundProcessingInboxRepository,
  type RefundProcessingOutboxRepository,
  type RefundProcessingProvider,
  type WorkerRefundRepository,
} from './refund-processing.service';

const TRANSACTION = { marker: 'refund-transaction' } as unknown as DatabaseTransaction;
const SIGNING_KEY = Buffer.alloc(32, 73);
const REFUND_ID = '01K00000000000000000000001';
const ATTEMPT_ID = '01K00000000000000000000002';
const ORDER_ID = '01K00000000000000000000003';
const OCCURRED_AT = new Date('2026-09-01T09:00:00.000Z');
const PROVIDER_REFUND_ID = 'mock_rf_0123456789abcdef';
const PROVIDER_EVENT_ID = 'mock_re_0123456789abcdef';

const config = {
  environment: 'test',
  payment: { mockSigningKey: SIGNING_KEY, provider: 'MOCK' },
} as PlatformRuntimeConfig;

function snapshot(): AdminRefundSnapshot {
  return {
    aftersaleId: '01K00000000000000000000004',
    amount: '12.34',
    attemptId: ATTEMPT_ID,
    attemptNo: 1,
    compensationId: null,
    compensationNo: null,
    items: [],
    orderId: ORDER_ID,
    originType: 'AFTERSALE',
    refundId: REFUND_ID,
    refundNo: `RF${REFUND_ID}`,
    status: 'PENDING',
    version: 1,
  };
}

function operation(): AdminRefundProviderOperation {
  return {
    amount: '12.34',
    attemptId: ATTEMPT_ID,
    attemptNo: 1,
    orderId: ORDER_ID,
    originType: 'AFTERSALE',
    provider: 'MOCK',
    providerIntentId: 'mock_pi_0123456789abcdef',
    providerRefundId: null,
    providerTransactionId: 'mock_tx_0123456789abcdef',
    refundId: REFUND_ID,
    refundNo: `RF${REFUND_ID}`,
    refundVersion: 2,
  };
}

function finalization(kind: 'FAILED' | 'SUCCEEDED' = 'SUCCEEDED'): AdminRefundFinalizeResult {
  return {
    afterOrderVersion: 7,
    afterRefundStatus: kind,
    afterRefundVersion: 3,
    beforeOrderVersion: 6,
    beforeRefundStatus: 'PROCESSING',
    beforeRefundVersion: 2,
    changed: true,
    commissionLedgerIds: kind === 'SUCCEEDED' ? ['01K00000000000000000000005'] : [],
    inventoryLedgerFacts: kind === 'SUCCEEDED' ? [
      { ledgerId: '01K00000000000000000000006', ledgerType: 'RETURN_RESTOCK' },
      { ledgerId: '01K00000000000000000000010', ledgerType: 'RETURN_DAMAGED' },
    ] : [],
    kind,
    orderId: ORDER_ID,
    refundId: REFUND_ID,
  };
}

function replayFinalization(kind: 'FAILED' | 'SUCCEEDED' = 'SUCCEEDED'): AdminRefundFinalizeResult {
  const terminal = finalization(kind);
  return {
    ...terminal,
    afterOrderVersion: terminal.beforeOrderVersion,
    afterRefundVersion: terminal.beforeRefundVersion,
    beforeRefundStatus: kind,
    changed: false,
    commissionLedgerIds: [],
    inventoryLedgerFacts: [],
    kind: 'REPLAY',
  };
}

function executionEvent(resourceVersion = 1): Parameters<WorkerOutboxHandler>[0] {
  return {
    aggregate_id: REFUND_ID,
    aggregate_type: 'refund',
    created_at: OCCURRED_AT,
    error_message: null,
    event_type: REFUND_EXECUTION_REQUESTED_EVENT,
    id: '01K00000000000000000000007',
    next_retry_at: null,
    payload: {
      event_version: 1,
      resource_id: REFUND_ID,
      resource_type: 'refund',
      resource_version: resourceVersion,
    },
    published_at: null,
    retry_count: 0,
    status: 'PENDING',
  };
}

function callbackEvent(
  outcome: 'FAILED' | 'SUCCEEDED' = 'SUCCEEDED',
): Parameters<WorkerCallbackHandler>[0] {
  const callback = createSignedMockRefundCallback(SIGNING_KEY, {
    amount: '12.34',
    attemptNo: 1,
    refundAttemptId: ATTEMPT_ID,
    refundNo: `RF${REFUND_ID}`,
  }, {
    failureCode: null,
    occurredAt: OCCURRED_AT,
    outcome,
    providerEventId: PROVIDER_EVENT_ID,
    providerRefundId: PROVIDER_REFUND_ID,
  });
  return {
    error_message: null,
    event_type: callback.eventType,
    headers: callback.headers,
    id: '01K00000000000000000000008',
    payload: callback.payload as unknown as Parameters<WorkerCallbackHandler>[0]['payload'],
    processed_at: null,
    provider: 'MOCK',
    provider_event_id: callback.providerEventId,
    provider_serial_no: null,
    raw_body: Buffer.from(callback.rawBody),
    received_at: OCCURRED_AT,
    retry_count: 0,
    signature_nonce: null,
    signature_timestamp: callback.headers.mock_timestamp,
    signature_valid: true,
    status: 'RECEIVED',
    verified_at: OCCURRED_AT,
  };
}

function harness() {
  let transactionDepth = 0;
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => Promise<unknown>) => {
      transactionDepth += 1;
      try {
        return await work(TRANSACTION);
      } finally {
        transactionDepth -= 1;
      }
    }),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const refunds = {
    claimRefundAttemptInTransaction: vi.fn(async () => operation()),
    finalizeRefundAttemptInTransaction: vi.fn(async (_transaction, input) =>
      finalization(input.result.kind === 'FAILED' ? 'FAILED' : 'SUCCEEDED')),
    getRefundInTransaction: vi.fn(async () => snapshot()),
    isHistoricalRefundAttemptReplayInTransaction: vi.fn(async () => false),
  } as unknown as WorkerRefundRepository;
  const audit = { append: vi.fn(async () => ({})) } as unknown as RefundProcessingAuditRepository;
  const outbox = { append: vi.fn(async () => ({})) } as unknown as RefundProcessingOutboxRepository;
  const inbox = {
    receiveForReconciliation: vi.fn(async () => {
      expect(transactionDepth).toBe(0);
      return { created: true, inbox: {}, requeued: false };
    }),
  } as unknown as RefundProcessingInboxRepository;
  const provider = {
    queryRefund: vi.fn(async () => {
      expect(transactionDepth).toBe(0);
      return {
        failureCode: null,
        occurredAt: null,
        outcome: 'NOT_FOUND' as const,
        providerEventId: null,
        providerRefundId: null,
      };
    }),
    refund: vi.fn(async () => {
      expect(transactionDepth).toBe(0);
      return {
        failureCode: null,
        occurredAt: OCCURRED_AT,
        outcome: 'SUCCEEDED' as const,
        providerEventId: PROVIDER_EVENT_ID,
        providerRefundId: PROVIDER_REFUND_ID,
      };
    }),
  } as unknown as RefundProcessingProvider;
  const service = new RefundProcessingService(database, config, refunds, audit, outbox, inbox, provider);
  return { audit, inbox, outbox, prisma, provider, refunds, service };
}

describe('RefundProcessingService', () => {
  it('registers one execution handler and two closed Mock result handlers', () => {
    const registrations = harness().service.registrations();
    expect(registrations.outbox.map(({ eventType }) => eventType))
      .toEqual([REFUND_EXECUTION_REQUESTED_EVENT]);
    expect(registrations.callbacks.map(({ eventType }) => eventType))
      .toEqual(MOCK_REFUND_CALLBACK_EVENT_TYPES);
    expect(registrations.outbox.every(({ retryAfterExhaustion }) => retryAfterExhaustion === true)).toBe(true);
    expect(registrations.callbacks.every(({ retryAfterExhaustion }) => retryAfterExhaustion === true)).toBe(true);
  });

  it('claims first, calls Provider outside the transaction, and persists a signed Inbox fact', async () => {
    const current = harness();
    await current.service.handleExecution(executionEvent());

    expect(current.refunds.getRefundInTransaction).toHaveBeenCalledWith(TRANSACTION, { refundId: REFUND_ID });
    expect(current.refunds.claimRefundAttemptInTransaction).toHaveBeenCalledWith(TRANSACTION, {
      refundAttemptId: ATTEMPT_ID,
      refundId: REFUND_ID,
    });
    expect(current.provider.queryRefund).toHaveBeenCalledWith({
      providerRefundId: null,
      refundNo: `RF${REFUND_ID}`,
    });
    expect(current.provider.refund).toHaveBeenCalledWith({
      amount: '12.34',
      providerIntentId: 'mock_pi_0123456789abcdef',
      providerTransactionId: 'mock_tx_0123456789abcdef',
      providerRequestId: ATTEMPT_ID,
      refundNo: `RF${REFUND_ID}`,
    });
    expect(current.inbox.receiveForReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'refund.succeeded',
      provider: 'MOCK',
      providerEventId: PROVIDER_EVENT_ID,
      signatureValid: true,
    }));
  });

  it('resumes the same attempt after a committed claim and a lost Worker response', async () => {
    const current = harness();
    vi.mocked(current.refunds.getRefundInTransaction).mockResolvedValue({
      ...snapshot(),
      status: 'PROCESSING',
      version: 2,
    });

    await current.service.handleExecution(executionEvent(1));

    expect(current.refunds.claimRefundAttemptInTransaction).toHaveBeenCalledWith(TRANSACTION, {
      refundAttemptId: ATTEMPT_ID,
      refundId: REFUND_ID,
    });
    expect(current.provider.refund).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: ATTEMPT_ID,
    }));
  });

  it('publishes a stale attempt event without claiming or executing the newer attempt', async () => {
    const current = harness();
    vi.mocked(current.refunds.getRefundInTransaction).mockResolvedValue({
      ...snapshot(),
      attemptId: '01K00000000000000000000009',
      attemptNo: 2,
      status: 'PENDING',
      version: 4,
    });

    await expect(current.service.handleExecution(executionEvent(1))).resolves.toBeUndefined();

    expect(current.refunds.claimRefundAttemptInTransaction).not.toHaveBeenCalled();
    expect(current.provider.queryRefund).not.toHaveBeenCalled();
    expect(current.provider.refund).not.toHaveBeenCalled();
    expect(current.inbox.receiveForReconciliation).not.toHaveBeenCalled();
  });

  it('fails closed when the event version is ahead or has an impossible same-version state', async () => {
    const future = harness();
    await expect(future.service.handleExecution(executionEvent(2)))
      .rejects.toThrow('version is ahead');
    expect(future.refunds.claimRefundAttemptInTransaction).not.toHaveBeenCalled();
    expect(future.provider.queryRefund).not.toHaveBeenCalled();

    const impossible = harness();
    vi.mocked(impossible.refunds.getRefundInTransaction).mockResolvedValue({
      ...snapshot(),
      status: 'FAILED',
    });
    await expect(impossible.service.handleExecution(executionEvent(1)))
      .rejects.toThrow('state does not match');
    expect(impossible.refunds.claimRefundAttemptInTransaction).not.toHaveBeenCalled();
    expect(impossible.provider.queryRefund).not.toHaveBeenCalled();
  });

  it('recovers an existing Provider result without issuing a second refund', async () => {
    const current = harness();
    vi.mocked(current.provider.queryRefund).mockResolvedValue({
      failureCode: null,
      occurredAt: OCCURRED_AT,
      outcome: 'SUCCEEDED',
      providerEventId: PROVIDER_EVENT_ID,
      providerRefundId: PROVIDER_REFUND_ID,
    });

    await current.service.handleExecution(executionEvent());
    expect(current.provider.refund).not.toHaveBeenCalled();
    expect(current.inbox.receiveForReconciliation).toHaveBeenCalledOnce();
  });

  it('uses the current attempt to retry a failed Provider fact and converges on the returned result', async () => {
    const current = harness();
    vi.mocked(current.provider.queryRefund).mockResolvedValue({
      failureCode: null,
      occurredAt: OCCURRED_AT,
      outcome: 'FAILED',
      providerEventId: PROVIDER_EVENT_ID,
      providerRefundId: PROVIDER_REFUND_ID,
    });

    await current.service.handleExecution(executionEvent());
    expect(current.provider.refund).toHaveBeenCalledWith(expect.objectContaining({
      providerRequestId: ATTEMPT_ID,
      refundNo: `RF${REFUND_ID}`,
    }));
    expect(current.inbox.receiveForReconciliation).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'refund.succeeded',
      providerEventId: PROVIDER_EVENT_ID,
    }));
  });

  it('keeps UNKNOWN fail-closed so the same Outbox fact is retried', async () => {
    const current = harness();
    vi.mocked(current.provider.queryRefund).mockResolvedValue({
      failureCode: 'PROVIDER_UNAVAILABLE',
      occurredAt: null,
      outcome: 'UNKNOWN',
      providerEventId: null,
      providerRefundId: null,
    });

    await expect(current.service.handleExecution(executionEvent()))
      .rejects.toThrow('terminal authoritative fact');
    expect(current.provider.refund).not.toHaveBeenCalled();
    expect(current.inbox.receiveForReconciliation).not.toHaveBeenCalled();
  });

  it('rejects a terminal shape carrying an integration failure code', async () => {
    const current = harness();
    vi.mocked(current.provider.queryRefund).mockResolvedValue({
      failureCode: 'INVALID_PROVIDER_STATE',
      occurredAt: OCCURRED_AT,
      outcome: 'SUCCEEDED',
      providerEventId: PROVIDER_EVENT_ID,
      providerRefundId: PROVIDER_REFUND_ID,
    });

    await expect(current.service.handleExecution(executionEvent()))
      .rejects.toThrow('terminal authoritative fact');
    expect(current.inbox.receiveForReconciliation).not.toHaveBeenCalled();
  });

  it.each(['SUCCEEDED', 'FAILED'] as const)(
    'verifies and atomically converges a %s Inbox result',
    async (outcome) => {
      const current = harness();
      await current.service.handleCallback(callbackEvent(outcome));

      expect(current.refunds.claimRefundAttemptInTransaction).toHaveBeenCalledWith(TRANSACTION, {
        refundAttemptId: ATTEMPT_ID,
        refundId: REFUND_ID,
      });
      expect(current.refunds.finalizeRefundAttemptInTransaction).toHaveBeenCalledWith(
        TRANSACTION,
        expect.objectContaining({
          operation: expect.objectContaining({ refundId: REFUND_ID }),
          result: expect.objectContaining({ kind: outcome }),
        }),
      );
      expect(current.audit.append).toHaveBeenCalledOnce();
      expect(current.outbox.append).toHaveBeenCalledWith(TRANSACTION, expect.objectContaining({
        eventType: outcome === 'SUCCEEDED' ? 'refund.succeeded' : 'refund.failed',
      }));
      if (outcome === 'SUCCEEDED') {
        expect(current.outbox.append).toHaveBeenCalledWith(TRANSACTION, expect.objectContaining({
          aggregateId: '01K00000000000000000000006',
          eventType: 'inventory.refund.restocked',
        }));
        expect(current.outbox.append).toHaveBeenCalledWith(TRANSACTION, expect.objectContaining({
          aggregateId: '01K00000000000000000000010',
          eventType: 'inventory.refund.disposition.recorded',
        }));
      }
    },
  );

  it('absorbs an exact delayed callback for a historical attempt without replaying money facts', async () => {
    const current = harness();
    vi.mocked(current.refunds.isHistoricalRefundAttemptReplayInTransaction).mockResolvedValue(true);

    await expect(current.service.handleCallback(callbackEvent('FAILED'))).resolves.toBeUndefined();

    expect(current.refunds.isHistoricalRefundAttemptReplayInTransaction).toHaveBeenCalledWith(
      TRANSACTION,
      {
        amount: '12.34',
        attemptNo: 1,
        outcome: 'FAILED',
        providerEventId: PROVIDER_EVENT_ID,
        providerRefundId: PROVIDER_REFUND_ID,
        refundAttemptId: ATTEMPT_ID,
        refundId: REFUND_ID,
        refundNo: `RF${REFUND_ID}`,
      },
    );
    expect(current.refunds.claimRefundAttemptInTransaction).not.toHaveBeenCalled();
    expect(current.refunds.finalizeRefundAttemptInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
  });

  it('rejects callback tampering before any money fact is finalized', async () => {
    const current = harness();
    const event = callbackEvent();
    event.raw_body = Buffer.from(event.raw_body);
    event.raw_body[0] = event.raw_body[0]! ^ 1;

    await expect(current.service.handleCallback(event)).rejects.toThrow('callback');
    expect(current.refunds.finalizeRefundAttemptInTransaction).not.toHaveBeenCalled();
  });

  it('rejects inconsistent Inbox metadata and stale attempt routing before finalization', async () => {
    const metadata = harness();
    const metadataEvent = callbackEvent();
    metadataEvent.signature_timestamp = String(Number(metadataEvent.signature_timestamp) + 1);
    await expect(metadata.service.handleCallback(metadataEvent)).rejects.toThrow('Inbox fact is invalid');
    expect(metadata.refunds.claimRefundAttemptInTransaction).not.toHaveBeenCalled();

    const stale = harness();
    vi.mocked(stale.refunds.claimRefundAttemptInTransaction).mockResolvedValue({
      ...operation(),
      attemptId: '01K00000000000000000000009',
    });
    await expect(stale.service.handleCallback(callbackEvent()))
      .rejects.toThrow('authoritative refund attempt');
    expect(stale.refunds.finalizeRefundAttemptInTransaction).not.toHaveBeenCalled();
  });

  it('accepts an exact repository replay without duplicating audit or Outbox facts', async () => {
    const current = harness();
    vi.mocked(current.refunds.finalizeRefundAttemptInTransaction).mockResolvedValue(replayFinalization());

    await current.service.handleCallback(callbackEvent());
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
  });

  it('rejects a malformed finalization projection inside the transaction', async () => {
    const current = harness();
    vi.mocked(current.refunds.finalizeRefundAttemptInTransaction).mockResolvedValue({
      ...finalization(),
      afterRefundVersion: 99,
    });

    await expect(current.service.handleCallback(callbackEvent()))
      .rejects.toThrow('repository result is invalid');
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
  });
});
