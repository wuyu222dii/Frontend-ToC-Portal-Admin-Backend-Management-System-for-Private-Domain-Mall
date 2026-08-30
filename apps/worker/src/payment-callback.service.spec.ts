import type {
  DatabaseRuntime,
  DatabaseTransaction,
  StoreLatePaymentRefundFinalizeInput,
  StoreLatePaymentRefundOperation,
  StorePaymentCallbackResult,
} from '@qingxu/database';
import type { PaymentProviderPort } from '@qingxu/payment';
import { describe, expect, it, vi } from 'vitest';

import type { WorkerCallbackHandler } from './outbox-dispatcher.service';
import {
  MOCK_PAYMENT_CALLBACK_EVENT_TYPES,
  PaymentCallbackService,
  decodeMockPaymentCallback,
  type MockPaymentCallbackOutcome,
  type PaymentCallbackAuditRepository,
  type PaymentCallbackOutboxRepository,
  type WorkerPaymentCallbackRepository,
} from './payment-callback.service';

const TRANSACTION = { marker: 'payment-transaction' } as unknown as DatabaseTransaction;
const OCCURRED_AT = '2026-08-29T08:00:00.000Z';
const PAYMENT_INTENT_ID = '01K00000000000000000000003';
const ORDER_ID = '01K00000000000000000000004';
const COMMISSION_ID = '01K00000000000000000000005';
const REFUND_ID = '01K0000000000000000000000A';
const REFUND_ATTEMPT_ID = '01K0000000000000000000000B';

function callbackEvent(
  outcome: MockPaymentCallbackOutcome = 'SUCCEEDED',
): Parameters<WorkerCallbackHandler>[0] {
  const eventType = outcome === 'SUCCEEDED'
    ? 'payment.succeeded'
    : outcome === 'FAILED' ? 'payment.failed' : 'payment.cancelled';
  const payload = {
    amount: '12.34',
    occurred_at: OCCURRED_AT,
    outcome,
    provider_event_id: 'mock_ev_0123456789abcdef',
    provider_intent_id: 'mock_pi_0123456789abcdef',
    provider_transaction_id: outcome === 'SUCCEEDED' ? 'mock_tx_0123456789abcdef' : null,
    version: 1,
  };
  return {
    error_message: null,
    event_type: eventType,
    headers: {
      mock_signature: 'signed-callback-value',
      mock_timestamp: String(Date.parse(OCCURRED_AT)),
    },
    id: '01K00000000000000000000002',
    payload,
    processed_at: null,
    provider: 'MOCK',
    provider_event_id: payload.provider_event_id,
    provider_serial_no: null,
    raw_body: Buffer.from(JSON.stringify(payload), 'utf8'),
    received_at: new Date(OCCURRED_AT),
    retry_count: 0,
    signature_nonce: null,
    signature_timestamp: String(Date.parse(OCCURRED_AT)),
    signature_valid: true,
    status: 'RECEIVED',
    verified_at: new Date(OCCURRED_AT),
  };
}

function callbackResult(outcome: MockPaymentCallbackOutcome = 'SUCCEEDED'): StorePaymentCallbackResult {
  const terminalStatus = outcome === 'FAILED' ? 'FAILED' : 'CANCELLED';
  return {
    after: {
      intentStatus: outcome === 'SUCCEEDED' ? 'SUCCEEDED' : terminalStatus,
      intentVersion: 3,
      orderPaymentResolution: 'NORMAL',
      orderPaymentStatus: outcome === 'SUCCEEDED' ? 'PAID' : 'UNPAID',
      orderStatus: outcome === 'SUCCEEDED' ? 'PENDING_SHIPMENT' : 'PENDING_PAYMENT',
      orderVersion: 4,
    },
    before: {
      intentStatus: 'OPEN',
      intentVersion: 2,
      orderPaymentResolution: 'NORMAL',
      orderPaymentStatus: 'PROCESSING',
      orderStatus: 'PENDING_PAYMENT',
      orderVersion: 3,
    },
    changed: true,
    commissionLedgerIds: outcome === 'SUCCEEDED' ? [COMMISSION_ID] : [],
    commissionSnapshotIds: outcome === 'SUCCEEDED' ? [COMMISSION_ID] : [],
    finalAgentId: outcome === 'SUCCEEDED' ? '01K00000000000000000000006' : null,
    finalChannel: outcome === 'SUCCEEDED' ? 'AGENT' : null,
    inventoryLedgerIds: outcome === 'SUCCEEDED' ? ['01K00000000000000000000007'] : [],
    kind: outcome === 'SUCCEEDED' ? 'SETTLED' : 'TERMINAL',
    lateRefund: null,
    orderId: ORDER_ID,
    outcome,
    paymentAttemptId: '01K00000000000000000000008',
    paymentIntentId: PAYMENT_INTENT_ID,
    providerEventId: 'mock_ev_0123456789abcdef',
    reservationId: '01K00000000000000000000009',
  };
}

function lateRefundResult(changed = true): StorePaymentCallbackResult {
  const operation = {
    amount: '12.34',
    orderId: ORDER_ID,
    paymentIntentId: PAYMENT_INTENT_ID,
    provider: 'MOCK' as const,
    providerIntentId: 'mock_pi_0123456789abcdef',
    providerTransactionId: 'mock_tx_0123456789abcdef',
    refundAttemptId: REFUND_ATTEMPT_ID,
    refundId: REFUND_ID,
    refundNo: `RF${REFUND_ID}`,
    refundVersion: 1,
  };
  return {
    ...callbackResult(),
    after: {
      intentStatus: 'SUCCEEDED',
      intentVersion: 3,
      orderPaymentResolution: 'LATE_SUCCESS_REFUND_PENDING',
      orderPaymentStatus: 'PAID',
      orderStatus: 'CLOSED',
      orderVersion: 5,
    },
    before: {
      intentStatus: changed ? 'CLOSED' : 'SUCCEEDED',
      intentVersion: changed ? 2 : 3,
      orderPaymentResolution: changed ? 'NORMAL' : 'LATE_SUCCESS_REFUND_PENDING',
      orderPaymentStatus: changed ? 'UNPAID' : 'PAID',
      orderStatus: 'CLOSED',
      orderVersion: changed ? 4 : 5,
    },
    changed,
    commissionLedgerIds: [],
    commissionSnapshotIds: [],
    finalAgentId: null,
    finalChannel: null,
    inventoryLedgerIds: [],
    kind: 'LATE_REFUND_REQUIRED',
    lateRefund: operation,
    reservationId: '01K00000000000000000000009',
  };
}

function createMocks(outcome: MockPaymentCallbackOutcome = 'SUCCEEDED') {
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => Promise<unknown>) => work(TRANSACTION)),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const payments = {
    applyPaymentCallbackInTransaction: vi.fn(async () => callbackResult(outcome)),
    claimLatePaymentRefundInTransaction: vi.fn(async (
      _transaction: DatabaseTransaction,
      operation: StoreLatePaymentRefundOperation,
    ) => ({
      kind: 'CLAIMED' as const,
      operation: { ...operation, refundVersion: operation.refundVersion + 1 },
    })),
    finalizeLatePaymentRefundInTransaction: vi.fn(async (
      _transaction: DatabaseTransaction,
      input: StoreLatePaymentRefundFinalizeInput,
    ) => ({
      afterOrderVersion: 6,
      afterRefundStatus: input.result.kind === 'SUCCEEDED' ? 'SUCCEEDED' as const : 'FAILED' as const,
      afterRefundVersion: 3,
      beforeOrderVersion: 5,
      beforeRefundStatus: 'PROCESSING' as const,
      beforeRefundVersion: 2,
      changed: true,
      kind: input.result.kind === 'SUCCEEDED' ? 'REFUNDED' as const : 'MANUAL_REQUIRED' as const,
      orderId: ORDER_ID,
      refundId: REFUND_ID,
    })),
  } as unknown as WorkerPaymentCallbackRepository;
  const audit = { append: vi.fn(async () => ({})) } as unknown as PaymentCallbackAuditRepository;
  const outbox = { append: vi.fn(async () => ({})) } as unknown as PaymentCallbackOutboxRepository;
  const provider = {
    refund: vi.fn(async () => ({
      failureCode: null,
      occurredAt: new Date(OCCURRED_AT),
      outcome: 'SUCCEEDED' as const,
      providerEventId: 'mock_re_0123456789abcdef',
      providerRefundId: 'mock_rf_0123456789abcdef',
    })),
  } as unknown as Pick<PaymentProviderPort, 'refund'>;
  return { audit, database, outbox, payments, prisma, provider };
}

function createService(mocks = createMocks()): PaymentCallbackService {
  return new PaymentCallbackService(mocks.database, mocks.payments, mocks.audit, mocks.outbox, mocks.provider);
}

describe('PaymentCallbackService', () => {
  it('registers only the three closed MOCK result handlers', () => {
    const mocks = createMocks();
    const registrations = createService(mocks).registrations();

    expect(registrations.map(({ eventType, provider }) => ({ eventType, provider }))).toEqual(
      MOCK_PAYMENT_CALLBACK_EVENT_TYPES.map((eventType) => ({ eventType, provider: 'MOCK' })),
    );
  });

  it.each([
    ['SUCCEEDED', 'payment.succeeded', 'mock_tx_0123456789abcdef'],
    ['FAILED', 'payment.failed', null],
    ['CANCELLED', 'payment.cancelled', null],
  ] as const)('decodes and applies a %s result in one Serializable transaction', async (
    outcome,
    eventType,
    providerTransactionId,
  ) => {
    const mocks = createMocks(outcome);

    await createService(mocks).handle(callbackEvent(outcome));

    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 15_000,
    });
    expect(mocks.payments.applyPaymentCallbackInTransaction).toHaveBeenCalledWith(TRANSACTION, {
      amount: '12.34',
      eventType,
      occurredAt: new Date(OCCURRED_AT),
      outcome,
      provider: 'MOCK',
      providerEventId: 'mock_ev_0123456789abcdef',
      providerIntentId: 'mock_pi_0123456789abcdef',
      providerTransactionId,
    });
    expect(mocks.audit.append).toHaveBeenCalledWith(TRANSACTION, expect.objectContaining({
      action: 'PAY',
      after: { status: outcome === 'SUCCEEDED' ? 'SUCCEEDED' : outcome, version: 3 },
      before: { status: 'OPEN', version: 2 },
      module: 'payment',
      objectId: PAYMENT_INTENT_ID,
      objectType: 'payment',
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    }));
    expect(mocks.outbox.append).toHaveBeenCalledWith(TRANSACTION, expect.objectContaining({
      aggregateId: PAYMENT_INTENT_ID,
      aggregateType: 'payment',
      eventType,
    }));
  });

  it.each([
    ['unsigned', (event: ReturnType<typeof callbackEvent>) => ({ ...event, signature_valid: false })],
    ['wrong provider', (event: ReturnType<typeof callbackEvent>) => ({ ...event, provider: 'WECHAT' })],
    ['wrong event type', (event: ReturnType<typeof callbackEvent>) => ({ ...event, event_type: 'payment.failed' })],
    ['wrong event ID', (event: ReturnType<typeof callbackEvent>) => ({ ...event, provider_event_id: 'mock_ev_other' })],
    ['wrong timestamp', (event: ReturnType<typeof callbackEvent>) => ({ ...event, signature_timestamp: '0' })],
    ['unknown signature header', (event: ReturnType<typeof callbackEvent>) => ({
      ...event,
      headers: { ...(event.headers as Record<string, unknown>), authorization: 'not-allowed' },
    })],
    ['unknown field', (event: ReturnType<typeof callbackEvent>) => {
      const raw = JSON.parse(Buffer.from(event.raw_body).toString('utf8')) as Record<string, unknown>;
      raw.unsupported = 'not-allowed';
      return { ...event, raw_body: Buffer.from(JSON.stringify(raw), 'utf8') };
    }],
    ['stored payload mismatch', (event: ReturnType<typeof callbackEvent>) => ({
      ...event,
      payload: { ...(event.payload as Record<string, unknown>), amount: '12.35' },
    })],
    ['invalid transaction ID', (event: ReturnType<typeof callbackEvent>) => {
      const raw = JSON.parse(Buffer.from(event.raw_body).toString('utf8')) as Record<string, unknown>;
      raw.provider_transaction_id = null;
      return { ...event, payload: raw, raw_body: Buffer.from(JSON.stringify(raw), 'utf8') };
    }],
  ])('fails closed before a database transaction for %s callbacks', async (_label, mutate) => {
    const mocks = createMocks();
    const event = mutate(callbackEvent()) as Parameters<WorkerCallbackHandler>[0];

    await expect(createService(mocks).handle(event))
      .rejects.toThrow('Mock payment callback is invalid');
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.payments.applyPaymentCallbackInTransaction).not.toHaveBeenCalled();
  });

  it('propagates authoritative repository mismatches so the Inbox remains retryable', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction)
      .mockRejectedValue(new Error('PAYMENT_CALLBACK_MISMATCH'));

    await expect(createService(mocks).handle(callbackEvent()))
      .rejects.toThrow('PAYMENT_CALLBACK_MISMATCH');
    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
  });

  it('allows a post-commit Inbox retry to converge on the repository unique fact', async () => {
    const mocks = createMocks();
    let appliedFacts = 0;
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction).mockImplementation(async () => {
      if (appliedFacts === 0) {
        appliedFacts += 1;
        return callbackResult();
      }
      return { ...callbackResult(), changed: false, kind: 'REPLAY' };
    });
    const service = createService(mocks);

    await service.handle(callbackEvent());
    await service.handle(callbackEvent());

    expect(mocks.payments.applyPaymentCallbackInTransaction).toHaveBeenCalledTimes(2);
    expect(appliedFacts).toBe(1);
    expect(mocks.audit.append).toHaveBeenCalledTimes(2);
    expect(mocks.outbox.append).toHaveBeenCalledTimes(3);
  });

  it('accepts a delayed terminal attempt fact without repeating state audit or outbox events', async () => {
    const mocks = createMocks('FAILED');
    const reconciled = callbackResult('FAILED');
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction)
      .mockResolvedValueOnce({
        ...reconciled,
        after: reconciled.after,
        before: reconciled.after,
        changed: true,
        kind: 'ATTEMPT_RECORDED',
      })
      .mockResolvedValueOnce({
        ...reconciled,
        after: reconciled.after,
        before: reconciled.after,
        changed: false,
        kind: 'REPLAY',
      });
    const service = createService(mocks);

    await service.handle(callbackEvent('FAILED'));
    await service.handle(callbackEvent('FAILED'));

    expect(mocks.audit.append).not.toHaveBeenCalled();
    expect(mocks.outbox.append).not.toHaveBeenCalled();
  });

  it('emits order and commission facts only for a fully settled payment', async () => {
    const mocks = createMocks();

    await createService(mocks).handle(callbackEvent());

    expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
      'payment.succeeded',
      'order.paid',
      'commission.expected.created',
    ]);
  });

  it('does not emit a commission event for a zero-percent snapshot without an EXPECTED ledger', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction).mockResolvedValue({
      ...callbackResult(),
      commissionLedgerIds: [],
    });

    await createService(mocks).handle(callbackEvent());

    expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
      'payment.succeeded',
      'order.paid',
    ]);
  });

  it('routes manual settlement to review without emitting fulfillment or commission facts', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction).mockResolvedValue({
      ...callbackResult(),
      after: {
        ...callbackResult().after,
        orderPaymentResolution: 'MANUAL_REQUIRED',
        orderStatus: 'PENDING_PAYMENT',
      },
      commissionLedgerIds: [],
      commissionSnapshotIds: [],
      finalAgentId: null,
      finalChannel: null,
      kind: 'MANUAL_REQUIRED',
    });

    await createService(mocks).handle(callbackEvent());

    expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
      'payment.succeeded',
      'order.payment_manual_required',
    ]);
    expect(vi.mocked(mocks.audit.append).mock.calls.map(([, input]) => input.objectType)).toEqual([
      'payment',
      'order',
    ]);
    expect(mocks.audit.append).toHaveBeenLastCalledWith(TRANSACTION, expect.objectContaining({
      action: 'PAY',
      after: { status: 'PENDING_PAYMENT', version: 4 },
      before: { status: 'PENDING_PAYMENT', version: 3 },
      module: 'payment',
      objectId: ORDER_ID,
      objectType: 'order',
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    }));
  });

  it('does not repeat the payment success fact when manual settlement is later compensated', async () => {
    const mocks = createMocks();
    const initial = callbackResult();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction).mockResolvedValue({
      ...initial,
      before: {
        ...initial.before,
        intentStatus: 'SUCCEEDED',
        intentVersion: 3,
        orderPaymentResolution: 'MANUAL_REQUIRED',
        orderPaymentStatus: 'PAID',
      },
      after: {
        ...initial.after,
        intentStatus: 'SUCCEEDED',
        intentVersion: 3,
      },
    });

    await createService(mocks).handle(callbackEvent());

    expect(vi.mocked(mocks.audit.append).mock.calls.map(([, input]) => input.objectType)).toEqual(['order']);
    expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
      'order.paid',
      'commission.expected.created',
    ]);
  });

  it.each(['FAILED', 'CANCELLED'] as const)(
    'does not invent an order event for a %s terminal result',
    async (outcome) => {
      const mocks = createMocks(outcome);

      await createService(mocks).handle(callbackEvent(outcome));

      expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
        outcome === 'FAILED' ? 'payment.failed' : 'payment.cancelled',
      ]);
    },
  );

  it('commits a late-payment fact before calling Provider and then finalizes the full refund', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction).mockResolvedValue(lateRefundResult());

    await createService(mocks).handle(callbackEvent());

    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(mocks.payments.applyPaymentCallbackInTransaction).toHaveBeenCalledBefore(
      vi.mocked(mocks.payments.claimLatePaymentRefundInTransaction),
    );
    expect(mocks.payments.claimLatePaymentRefundInTransaction).toHaveBeenCalledBefore(
      vi.mocked(mocks.provider.refund),
    );
    expect(mocks.provider.refund).toHaveBeenCalledBefore(
      vi.mocked(mocks.payments.finalizeLatePaymentRefundInTransaction),
    );
    expect(mocks.provider.refund).toHaveBeenCalledWith({
      amount: '12.34',
      providerIntentId: 'mock_pi_0123456789abcdef',
      providerTransactionId: 'mock_tx_0123456789abcdef',
      refundNo: `RF${REFUND_ID}`,
    });
    expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
      'payment.succeeded',
      'order.late_payment_refund_pending',
      'refund.created',
      'refund.succeeded',
      'order.late_payment_refunded',
    ]);
    expect(vi.mocked(mocks.outbox.append).mock.calls.flatMap(([, input]) =>
      Object.keys(input.payload))).not.toContain('provider_refund_id');
  });

  it('moves an unknown or thrown Provider refund to MANUAL_REQUIRED without leaking the exception', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction).mockResolvedValue(lateRefundResult());
    vi.mocked(mocks.provider.refund).mockRejectedValue(new Error('provider payload must stay private'));

    await createService(mocks).handle(callbackEvent());

    expect(mocks.payments.finalizeLatePaymentRefundInTransaction).toHaveBeenCalledWith(
      TRANSACTION,
      expect.objectContaining({
        result: { failureCode: 'PROVIDER_UNAVAILABLE', kind: 'FAILED', occurredAt: null },
      }),
    );
    expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
      'payment.succeeded',
      'order.late_payment_refund_pending',
      'refund.created',
      'refund.manual_required',
      'order.payment_manual_required',
    ]);
    expect(JSON.stringify(vi.mocked(mocks.audit.append).mock.calls)).not.toContain('provider payload');
    expect(JSON.stringify(vi.mocked(mocks.outbox.append).mock.calls)).not.toContain('provider payload');
  });

  it('maps an explicit Provider UNKNOWN result to a failed refund fact for manual review', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction).mockResolvedValue(lateRefundResult());
    vi.mocked(mocks.provider.refund).mockResolvedValue({
      failureCode: 'PROVIDER_UNAVAILABLE',
      occurredAt: null,
      outcome: 'UNKNOWN',
      providerEventId: null,
      providerRefundId: null,
    });

    await createService(mocks).handle(callbackEvent());

    expect(mocks.payments.finalizeLatePaymentRefundInTransaction).toHaveBeenCalledWith(
      TRANSACTION,
      expect.objectContaining({
        result: { failureCode: 'PROVIDER_UNAVAILABLE', kind: 'FAILED', occurredAt: null },
      }),
    );
    expect(vi.mocked(mocks.outbox.append).mock.calls.map(([, input]) => input.eventType)).toEqual([
      'payment.succeeded',
      'order.late_payment_refund_pending',
      'refund.created',
      'refund.manual_required',
      'order.payment_manual_required',
    ]);
  });

  it('retries the same Provider refund after local finalization loses its response', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.payments.applyPaymentCallbackInTransaction)
      .mockResolvedValueOnce(lateRefundResult())
      .mockResolvedValueOnce(lateRefundResult(false));
    vi.mocked(mocks.payments.finalizeLatePaymentRefundInTransaction)
      .mockRejectedValueOnce(new Error('database response lost'));
    const service = createService(mocks);

    await expect(service.handle(callbackEvent())).rejects.toThrow('database response lost');
    await expect(service.handle(callbackEvent())).resolves.toBeUndefined();

    expect(mocks.provider.refund).toHaveBeenCalledTimes(2);
    expect(vi.mocked(mocks.provider.refund).mock.calls[0]?.[0])
      .toEqual(vi.mocked(mocks.provider.refund).mock.calls[1]?.[0]);
    expect(mocks.payments.finalizeLatePaymentRefundInTransaction).toHaveBeenCalledTimes(2);
  });
});

describe('decodeMockPaymentCallback', () => {
  it('uses the signed raw body rather than trusting a mutable JSON projection', () => {
    const event = callbackEvent();
    const decoded = decodeMockPaymentCallback(event);

    expect(decoded.providerEventId).toBe(event.provider_event_id);
    expect(decoded.occurredAt).toEqual(new Date(OCCURRED_AT));
  });
});
