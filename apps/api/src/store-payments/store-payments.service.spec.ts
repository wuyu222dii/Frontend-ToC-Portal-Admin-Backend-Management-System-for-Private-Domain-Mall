import { createHmac } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AuditRepository,
  CallbackInboxRepository,
  CurrentStoreSession,
  DatabaseRuntime,
  IdempotencyRepository,
  OutboxRepository,
  StoreOrderClosePaymentIntent,
  StoreOrderRepository,
  StoreOrderSnapshot,
  StorePaymentIntentSnapshot,
  StorePaymentRepository,
} from '@qingxu/database';
import { type MockPaymentCallback, type PaymentProviderPort, verifyMockPaymentCallback } from '@qingxu/payment';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorePaymentsService } from './store-payments.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const SESSION_ID = '01J00000000000000000000003';
const ORDER_ID = '01J00000000000000000000004';
const PAYMENT_INTENT_ID = '01J00000000000000000000005';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = 'req_00000000000000000000000000000001';
const IP = '127.0.0.1';
const SIGNING_KEY = Buffer.alloc(32, 91);

const session: CurrentStoreSession = {
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  accessJti: 'access:01J00000000000000000000006',
  customerId: CUSTOMER_ID,
  customerVersion: 1,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  sessionFamily: '01J00000000000000000000007',
  sessionId: SESSION_ID,
};

function intent(overrides: Partial<StorePaymentIntentSnapshot> = {}): StorePaymentIntentSnapshot {
  return {
    amount: '39.80',
    createRequestedAt: new Date('2026-08-29T00:00:00.000Z'),
    expiresAt: new Date('2099-08-29T00:30:00.000Z'),
    intentNo: `PI${PAYMENT_INTENT_ID}`,
    lastErrorCode: null,
    nextReconcileAt: new Date('2099-08-29T00:01:00.000Z'),
    openedAt: null,
    orderId: ORDER_ID,
    paymentIntentId: PAYMENT_INTENT_ID,
    provider: 'MOCK',
    providerIntentId: null,
    providerState: 'CREATE_REQUESTED',
    serverTime: new Date('2026-08-29T00:00:00.000Z'),
    status: 'CREATING',
    updatedAt: new Date('2026-08-29T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function order(overrides: Partial<StoreOrderSnapshot> = {}): StoreOrderSnapshot {
  return {
    amounts: { goods: '39.80', paid: '0.00', payable: '39.80', refunded: '0.00', shipping: '0.00' },
    closeReason: null,
    completionReason: null,
    createdAt: new Date('2026-08-29T00:00:00.000Z'),
    customerId: CUSTOMER_ID,
    fulfillmentStatus: 'NOT_STARTED',
    items: [],
    orderId: ORDER_ID,
    orderNo: `QX${ORDER_ID}`,
    orderStatus: 'PENDING_PAYMENT',
    payExpiresAt: new Date('2099-08-29T00:30:00.000Z'),
    paymentResolution: 'NORMAL',
    paymentStatus: 'PROCESSING',
    refundProcessingStatus: 'IDLE',
    refundProgressStatus: 'NONE',
    serverTime: new Date('2026-08-29T00:00:00.000Z'),
    source: 'BUY_NOW',
    updatedAt: new Date('2026-08-29T00:00:00.000Z'),
    version: 3,
    ...overrides,
  };
}

function closeIntent(overrides: Partial<StoreOrderClosePaymentIntent> = {}): StoreOrderClosePaymentIntent {
  return {
    amount: '39.80',
    closeRequestedAt: new Date('2026-08-29T00:01:00.000Z'),
    expiresAt: new Date('2099-08-29T00:30:00.000Z'),
    intentNo: `PI${PAYMENT_INTENT_ID}`,
    paymentIntentId: PAYMENT_INTENT_ID,
    provider: 'MOCK',
    providerIntentId: 'mock_intent_0001',
    status: 'CLOSE_PENDING',
    version: 2,
    ...overrides,
  };
}

function config(): PlatformRuntimeConfig {
  return {
    encryption: {
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 92) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 93),
    },
    environment: 'development',
    payment: { mockSigningKey: SIGNING_KEY, provider: 'MOCK', providerTimeoutMs: 1_000 },
  } as unknown as PlatformRuntimeConfig;
}

function signedCallback(result: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'): MockPaymentCallback {
  const occurredAt = '2026-08-29T00:02:00.000Z';
  const timestamp = String(Date.parse(occurredAt));
  const payload = {
    amount: '39.80',
    occurred_at: occurredAt,
    outcome: result,
    provider_event_id: 'mock_event_0001',
    provider_intent_id: 'mock_intent_0001',
    provider_transaction_id: result === 'SUCCEEDED' ? 'mock_transaction_0001' : null,
    version: 1 as const,
  };
  const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = createHmac('sha256', SIGNING_KEY)
    .update('qingxu:payment-mock:event-signature:v1\0', 'utf8')
    .update(timestamp, 'ascii')
    .update('\0', 'utf8')
    .update(rawBody)
    .digest('base64');
  return {
    eventType: result === 'SUCCEEDED'
      ? 'payment.succeeded'
      : result === 'FAILED' ? 'payment.failed' : 'payment.cancelled',
    headers: { mock_signature: signature, mock_timestamp: timestamp },
    payload,
    providerEventId: payload.provider_event_id,
    rawBody,
  };
}

interface Harness {
  audit: { append: ReturnType<typeof vi.fn> };
  callbackInbox: { receive: ReturnType<typeof vi.fn> };
  idempotency: {
    assertHashOnlyReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  orders: {
    claimOrderCloseInTransaction: ReturnType<typeof vi.fn>;
    finalizeOrderCloseInTransaction: ReturnType<typeof vi.fn>;
    getOwnedOrderForReplayInTransaction: ReturnType<typeof vi.fn>;
  };
  payments: {
    finalizeProviderOutcomeInTransaction: ReturnType<typeof vi.fn>;
    getOwnedPaymentIntentInTransaction: ReturnType<typeof vi.fn>;
    prepareOwnedPaymentIntentInTransaction: ReturnType<typeof vi.fn>;
    revalidateProviderCreateInTransaction: ReturnType<typeof vi.fn>;
  };
  provider: PaymentProviderPort & { submitResult: ReturnType<typeof vi.fn> };
  sequence: string[];
  service: StorePaymentsService;
}

function harness(): Harness {
  const sequence: string[] = [];
  const transaction = {};
  const prisma = {
    $transaction: vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
      sequence.push('transaction:start');
      try {
        return await work(transaction);
      } finally {
        sequence.push('transaction:end');
      }
    }),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const provider = {
    close: vi.fn(async () => {
      sequence.push('provider:close');
      return {
        capability: null, failureCode: null, occurredAt: new Date('2026-08-29T00:02:00.000Z'),
        outcome: 'CLOSED' as const, providerEventId: 'mock_close_event_0001',
        providerIntentId: 'mock_intent_0001', providerTransactionId: null,
      };
    }),
    create: vi.fn(async () => {
      sequence.push('provider:create');
      return {
        capability: null, failureCode: null, occurredAt: null, outcome: 'OPEN' as const,
        providerEventId: null, providerIntentId: 'mock_intent_0001', providerTransactionId: null,
      };
    }),
    query: vi.fn(),
    refund: vi.fn(),
    submitResult: vi.fn(),
  };
  const payments = {
    finalizeProviderOutcomeInTransaction: vi.fn(async () => {
      sequence.push('payment:finalize');
      return {
        changed: true,
        intent: intent({
          openedAt: new Date('2026-08-29T00:00:01.000Z'),
          providerIntentId: 'mock_intent_0001', providerState: 'OPEN', status: 'OPEN', version: 2,
        }),
      };
    }),
    getOwnedPaymentIntentInTransaction: vi.fn(),
    prepareOwnedPaymentIntentInTransaction: vi.fn(async () => {
      sequence.push('payment:prepare');
      return { created: true, intent: intent(), providerOperation: 'CREATE' as const };
    }),
    revalidateProviderCreateInTransaction: vi.fn(async () => {
      sequence.push('payment:revalidate');
      return intent();
    }),
  };
  const audit = { append: vi.fn(async () => sequence.push('audit')) };
  const callbackInbox = { receive: vi.fn(async () => ({ created: true })) };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(),
    claim: vi.fn(async () => {
      sequence.push('claim');
      return { kind: 'execute' as const };
    }),
    complete: vi.fn(async () => sequence.push('complete')),
  };
  const outbox = { append: vi.fn(async () => sequence.push('outbox')) };
  const orders = {
    claimOrderCloseInTransaction: vi.fn(),
    finalizeOrderCloseInTransaction: vi.fn(),
    getOwnedOrderForReplayInTransaction: vi.fn(),
  };
  const service = new StorePaymentsService(config(), database, provider);
  Object.assign(service as unknown as Record<string, unknown>, {
    audit: audit as unknown as AuditRepository,
    callbackInbox: callbackInbox as unknown as CallbackInboxRepository,
    idempotency: idempotency as unknown as IdempotencyRepository,
    outbox: outbox as unknown as OutboxRepository,
    orders: orders as unknown as StoreOrderRepository,
    payments: payments as unknown as StorePaymentRepository,
  });
  return { audit, callbackInbox, idempotency, orders, outbox, payments, provider, sequence, service };
}

function code(error: unknown): string | undefined {
  return error instanceof ApplicationError ? error.code : undefined;
}

describe('B10.1 Store payments service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('commits CREATING before calling Provider and finalizes OPEN in a second transaction', async () => {
    const current = harness();
    await expect(current.service.createOrReuseIntent(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toEqual({
      expires_at: '2099-08-29T00:30:00.000Z',
      intent_no: `PI${PAYMENT_INTENT_ID}`,
      intent_status: 'OPEN',
      last_error_code: null,
      next_reconcile_at: '2099-08-29T00:01:00.000Z',
      payment_intent_id: PAYMENT_INTENT_ID,
      provider_payload: null,
    });

    const firstTransactionEnd = current.sequence.indexOf('transaction:end');
    const providerCall = current.sequence.indexOf('provider:create');
    const secondTransactionStart = current.sequence.indexOf('transaction:start', firstTransactionEnd + 1);
    expect(firstTransactionEnd).toBeLessThan(providerCall);
    expect(providerCall).toBeLessThan(secondTransactionStart);
    expect(current.payments.prepareOwnedPaymentIntentInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ expectedVersion: 3, orderId: ORDER_ID, provider: 'MOCK' }),
    );
    expect(current.payments.finalizeProviderOutcomeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        result: expect.objectContaining({ nextReconcileAt: new Date('2026-08-29T00:01:00.000Z') }),
      }),
    );
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        resourceId: PAYMENT_INTENT_ID,
        responseForHash: { payment_intent_command_completed: { payment_intent_id: PAYMENT_INTENT_ID } },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      },
    );
    expect(current.audit.append).toHaveBeenCalledTimes(2);
    expect(current.outbox.append).toHaveBeenCalledTimes(2);
  });

  it('replays the current projection before repository preparation or Provider dispatch', async () => {
    const current = harness();
    const open = intent({ providerIntentId: 'mock_intent_0001', providerState: 'OPEN', status: 'OPEN', version: 7 });
    current.idempotency.claim.mockResolvedValueOnce({
      kind: 'replay',
      record: { resource_id: PAYMENT_INTENT_ID },
    });
    current.payments.getOwnedPaymentIntentInTransaction.mockResolvedValueOnce(open);

    await expect(current.service.createOrReuseIntent(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toMatchObject({ intent_status: 'OPEN', payment_intent_id: PAYMENT_INTENT_ID });
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ responseStatus: 200, storage: 'HASH_ONLY' }),
    );
    expect(current.payments.prepareOwnedPaymentIntentInTransaction).not.toHaveBeenCalled();
    expect(current.provider.create).not.toHaveBeenCalled();
    expect(current.provider.query).not.toHaveBeenCalled();
  });

  it('revalidates a recoverable CREATING intent before Provider create after query reports NOT_FOUND', async () => {
    const current = harness();
    current.payments.prepareOwnedPaymentIntentInTransaction.mockResolvedValueOnce({
      created: false,
      intent: intent(),
      providerOperation: 'QUERY',
    });
    current.provider.query = vi.fn(async () => ({
      capability: null, failureCode: null, occurredAt: null, outcome: 'NOT_FOUND' as const,
      providerEventId: null, providerIntentId: null, providerTransactionId: null,
    }));

    await current.service.createOrReuseIntent(session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP);
    expect(current.provider.query).toHaveBeenCalledWith({
      intentNo: `PI${PAYMENT_INTENT_ID}`,
      providerIntentId: null,
    });
    expect(current.payments.revalidateProviderCreateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        accountId: session.accountId,
        customerId: session.customerId,
        expectedIntentVersion: 1,
        orderId: ORDER_ID,
        paymentIntentId: PAYMENT_INTENT_ID,
        provider: 'MOCK',
      },
    );
    expect(current.provider.create).toHaveBeenCalledWith({
      amount: '39.80',
      expiresAt: new Date('2099-08-29T00:30:00.000Z'),
      intentNo: `PI${PAYMENT_INTENT_ID}`,
    });
  });

  it('does not create Provider capability when NOT_FOUND revalidation rejects a drifted legacy intent', async () => {
    const current = harness();
    current.payments.prepareOwnedPaymentIntentInTransaction.mockResolvedValueOnce({
      created: false,
      intent: intent(),
      providerOperation: 'QUERY',
    });
    current.provider.query = vi.fn(async () => ({
      capability: null, failureCode: null, occurredAt: null, outcome: 'NOT_FOUND' as const,
      providerEventId: null, providerIntentId: null, providerTransactionId: null,
    }));
    current.payments.revalidateProviderCreateInTransaction.mockRejectedValueOnce(
      new ApplicationError('PAYMENT_NOT_ALLOWED', 'Order cannot be paid'),
    );

    const error = await current.service.createOrReuseIntent(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    ).then(() => undefined, (cause: unknown) => cause);
    expect(code(error)).toBe('PAYMENT_NOT_ALLOWED');
    expect(current.provider.query).toHaveBeenCalledTimes(1);
    expect(current.provider.create).not.toHaveBeenCalled();
    expect(current.payments.finalizeProviderOutcomeInTransaction).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('recovers a Provider-created CREATING intent by query without issuing a second create', async () => {
    const current = harness();
    current.payments.prepareOwnedPaymentIntentInTransaction.mockResolvedValueOnce({
      created: false,
      intent: intent(),
      providerOperation: 'QUERY',
    });
    current.provider.query = vi.fn(async () => ({
      capability: null, failureCode: null, occurredAt: null, outcome: 'OPEN' as const,
      providerEventId: null, providerIntentId: 'mock_intent_0001', providerTransactionId: null,
    }));

    await expect(current.service.createOrReuseIntent(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toMatchObject({ intent_status: 'OPEN', payment_intent_id: PAYMENT_INTENT_ID });
    expect(current.provider.query).toHaveBeenCalledWith({
      intentNo: `PI${PAYMENT_INTENT_ID}`,
      providerIntentId: null,
    });
    expect(current.provider.create).not.toHaveBeenCalled();
  });

  it('fails closed and leaves idempotency incomplete when Provider state is unknown', async () => {
    const current = harness();
    current.provider.create = vi.fn(async () => ({
      capability: null, failureCode: 'PROVIDER_UNAVAILABLE' as const, occurredAt: null,
      outcome: 'UNKNOWN' as const, providerEventId: null, providerIntentId: null, providerTransactionId: null,
    }));
    current.payments.finalizeProviderOutcomeInTransaction.mockResolvedValueOnce({
      changed: true,
      intent: intent({ lastErrorCode: 'PROVIDER_UNAVAILABLE', version: 2 }),
    });

    const error = await current.service.createOrReuseIntent(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    ).then(() => undefined, (cause: unknown) => cause);
    expect(code(error)).toBe('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(current.payments.finalizeProviderOutcomeInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ result: expect.objectContaining({ kind: 'UNKNOWN' }) }),
    );
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('persists a verified Mock callback in Inbox and completes only a HASH_ONLY 202 fact', async () => {
    const current = harness();
    const open = intent({ providerIntentId: 'mock_intent_0001', providerState: 'OPEN', status: 'OPEN' });
    current.payments.getOwnedPaymentIntentInTransaction.mockResolvedValue(open);
    const callback = signedCallback('SUCCEEDED');
    current.provider.submitResult.mockResolvedValueOnce({
      callback,
      payment: {
        capability: null, failureCode: null, occurredAt: new Date(callback.payload.occurred_at),
        outcome: 'SUCCEEDED', providerEventId: callback.providerEventId,
        providerIntentId: callback.payload.provider_intent_id,
        providerTransactionId: callback.payload.provider_transaction_id,
      },
      submission: 'ACCEPTED',
    });

    await expect(current.service.submitMockResult(
      session,
      PAYMENT_INTENT_ID,
      { result: 'SUCCEEDED' },
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      IP,
    )).resolves.toMatchObject({ intent_status: 'OPEN', payment_intent_id: PAYMENT_INTENT_ID });
    expect(current.callbackInbox.receive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'payment.succeeded',
      provider: 'MOCK',
      providerEventId: 'mock_event_0001',
      signatureValid: true,
    }));
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      {
        resourceId: PAYMENT_INTENT_ID,
        responseForHash: {
          mock_payment_result_received: {
            payment_intent_id: PAYMENT_INTENT_ID,
            result: 'SUCCEEDED',
          },
        },
        responseStatus: 202,
        storage: 'HASH_ONLY',
      },
    );
  });

  it('rejects a conflicting Mock result before Inbox or idempotency completion', async () => {
    const current = harness();
    current.payments.getOwnedPaymentIntentInTransaction.mockResolvedValueOnce(intent({
      providerIntentId: 'mock_intent_0001', providerState: 'OPEN', status: 'OPEN',
    }));
    current.provider.submitResult.mockResolvedValueOnce({
      callback: null,
      payment: {
        capability: null, failureCode: 'REQUEST_MISMATCH', occurredAt: null,
        outcome: 'UNKNOWN', providerEventId: null, providerIntentId: null, providerTransactionId: null,
      },
      submission: 'CONFLICT',
    });

    const error = await current.service.submitMockResult(
      session, PAYMENT_INTENT_ID, { result: 'FAILED' }, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    ).then(() => undefined, (cause: unknown) => cause);
    expect(code(error)).toBe('PAYMENT_RESULT_CONFLICT');
    expect(current.callbackInbox.receive).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });
});

describe('B10.3 Store order cancellation orchestration', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('calls Provider only between transactions and returns a HASH_ONLY 202 while state is unknown', async () => {
    const current = harness();
    const before = order();
    const pendingIntent = closeIntent();
    current.orders.claimOrderCloseInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('order:claim');
      return {
        before,
        changed: true,
        kind: 'PROVIDER_REQUIRED' as const,
        mode: 'USER_CANCELLED' as const,
        order: before,
        paymentIntent: pendingIntent,
        providerOperation: 'CLOSE' as const,
        reservationId: '01J00000000000000000000008',
      };
    });
    vi.mocked(current.provider.close).mockImplementationOnce(async () => {
      current.sequence.push('provider:close');
      return {
        capability: null, failureCode: 'PROVIDER_UNAVAILABLE' as const, occurredAt: null,
        outcome: 'UNKNOWN' as const, providerEventId: null,
        providerIntentId: pendingIntent.providerIntentId, providerTransactionId: null,
      };
    });
    current.orders.finalizeOrderCloseInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('order:finalize');
      return {
        closeResult: null,
        kind: 'PENDING' as const,
        order: before,
        paymentIntent: closeIntent({ version: 3 }),
        reservationId: '01J00000000000000000000008',
      };
    });

    await expect(current.service.requestOrderCancellation(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toMatchObject({ kind: 'PENDING', statusCode: 202 });

    const firstTransactionEnd = current.sequence.indexOf('transaction:end');
    const providerCall = current.sequence.indexOf('provider:close');
    const secondTransactionStart = current.sequence.indexOf('transaction:start', firstTransactionEnd + 1);
    expect(firstTransactionEnd).toBeLessThan(providerCall);
    expect(providerCall).toBeLessThan(secondTransactionStart);
    expect(current.orders.finalizeOrderCloseInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        errorCode: 'PROVIDER_UNAVAILABLE',
        expectedIntentVersion: 2,
        outcome: 'UNKNOWN',
        paymentIntentId: PAYMENT_INTENT_ID,
      }),
    );
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.claim).toHaveBeenCalledTimes(2);
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ responseStatus: 202, storage: 'HASH_ONLY' }),
    );
  });

  it('persists a signed success callback atomically when Provider query recovers a lost callback', async () => {
    const current = harness();
    const before = order();
    const pendingIntent = closeIntent();
    current.orders.claimOrderCloseInTransaction.mockResolvedValueOnce({
      before,
      changed: true,
      kind: 'PROVIDER_REQUIRED',
      mode: 'USER_CANCELLED',
      order: before,
      paymentIntent: pendingIntent,
      providerOperation: 'CLOSE',
      reservationId: '01J00000000000000000000008',
    });
    vi.mocked(current.provider.close).mockResolvedValueOnce({
      capability: null,
      failureCode: null,
      occurredAt: new Date('2026-08-29T00:02:00.000Z'),
      outcome: 'SUCCEEDED',
      providerEventId: 'mock_event_recovered_0001',
      providerIntentId: 'mock_intent_0001',
      providerTransactionId: 'mock_transaction_recovered_0001',
    });
    current.orders.finalizeOrderCloseInTransaction.mockResolvedValueOnce({
      closeResult: null,
      kind: 'PAYMENT_CONFIRMED',
      order: before,
      paymentIntent: closeIntent({ version: 3 }),
      reservationId: '01J00000000000000000000008',
    });

    await expect(current.service.requestOrderCancellation(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toMatchObject({ kind: 'PAYMENT_CONFIRMED', statusCode: 202 });

    expect(current.callbackInbox.receive).toHaveBeenCalledOnce();
    const received = current.callbackInbox.receive.mock.calls[0]?.[1] as {
      eventType: 'payment.succeeded';
      headers: MockPaymentCallback['headers'];
      payload: MockPaymentCallback['payload'];
      providerEventId: string;
      rawBody: Uint8Array;
    };
    expect(received).toMatchObject({
      eventType: 'payment.succeeded',
      payload: {
        amount: '39.80',
        outcome: 'SUCCEEDED',
        provider_event_id: 'mock_event_recovered_0001',
        provider_transaction_id: 'mock_transaction_recovered_0001',
      },
      providerEventId: 'mock_event_recovered_0001',
    });
    expect(verifyMockPaymentCallback({ ...received }, SIGNING_KEY)).toBe(true);
    expect(Buffer.from(received.rawBody).toString('utf8')).not.toContain(ORDER_ID);
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ responseStatus: 202, storage: 'HASH_ONLY' }),
    );
  });

  it('atomically records audit, Outbox and HASH_ONLY completion after a definitive Provider close', async () => {
    const current = harness();
    const before = order();
    const closed = order({
      closeReason: 'USER_CANCELLED',
      orderStatus: 'CLOSED',
      paymentStatus: 'UNPAID',
      version: 4,
    });
    const pendingIntent = closeIntent();
    current.orders.claimOrderCloseInTransaction.mockResolvedValueOnce({
      before,
      changed: true,
      kind: 'PROVIDER_REQUIRED',
      mode: 'USER_CANCELLED',
      order: before,
      paymentIntent: pendingIntent,
      providerOperation: 'CLOSE',
      reservationId: '01J00000000000000000000008',
    });
    current.orders.finalizeOrderCloseInTransaction.mockResolvedValueOnce({
      closeResult: { before, changed: true, order: closed, reservationId: '01J00000000000000000000008' },
      kind: 'CLOSED',
      order: closed,
      paymentIntent: closeIntent({ status: 'CLOSED', version: 3 }),
      reservationId: '01J00000000000000000000008',
    });

    await expect(current.service.requestOrderCancellation(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toMatchObject({ kind: 'CLOSED', order: { orderStatus: 'CLOSED' }, statusCode: 200 });

    expect(current.audit.append).toHaveBeenCalledOnce();
    expect(current.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'CANCEL',
      after: { status: 'CLOSED', version: 4 },
      before: { status: 'PENDING_PAYMENT', version: 3 },
      objectId: ORDER_ID,
    }));
    expect(current.outbox.append).toHaveBeenCalledOnce();
    expect(current.outbox.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      aggregateId: ORDER_ID,
      eventType: 'order.closed',
    }));
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ responseStatus: 200, storage: 'HASH_ONLY' }),
    );
  });

  it('replays a completed pending command before If-Match or Provider dispatch', async () => {
    const current = harness();
    current.idempotency.claim.mockResolvedValueOnce({
      kind: 'replay',
      record: { resource_id: ORDER_ID, response_status: 202 },
    });
    current.orders.getOwnedOrderForReplayInTransaction.mockResolvedValueOnce(order());

    await expect(current.service.requestOrderCancellation(
      session, ORDER_ID, 1, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toMatchObject({ kind: 'PENDING', statusCode: 202 });

    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ resourceId: ORDER_ID, responseStatus: 202, storage: 'HASH_ONLY' }),
    );
    expect(current.orders.claimOrderCloseInTransaction).not.toHaveBeenCalled();
    expect(current.provider.close).not.toHaveBeenCalled();
    expect(current.provider.query).not.toHaveBeenCalled();
  });

  it('reclaims the idempotency lock after Provider I/O and replays the winner instead of stale finalization', async () => {
    const current = harness();
    const before = order();
    current.idempotency.claim
      .mockResolvedValueOnce({ kind: 'execute' })
      .mockResolvedValueOnce({
        kind: 'replay',
        record: { resource_id: ORDER_ID, response_status: 200 },
      });
    current.orders.claimOrderCloseInTransaction.mockResolvedValueOnce({
      before,
      changed: true,
      kind: 'PROVIDER_REQUIRED',
      mode: 'USER_CANCELLED',
      order: before,
      paymentIntent: closeIntent(),
      providerOperation: 'CLOSE',
      reservationId: '01J00000000000000000000008',
    });
    current.orders.getOwnedOrderForReplayInTransaction.mockResolvedValueOnce(before);
    vi.mocked(current.provider.close).mockResolvedValueOnce({
      capability: null,
      failureCode: null,
      occurredAt: new Date('2026-08-29T00:02:00.000Z'),
      outcome: 'SUCCEEDED',
      providerEventId: 'mock_event_concurrent_late_success',
      providerIntentId: 'mock_intent_0001',
      providerTransactionId: 'mock_transaction_concurrent_late_success',
    });

    await expect(current.service.requestOrderCancellation(
      session, ORDER_ID, 3, IDEMPOTENCY_KEY, REQUEST_ID, IP,
    )).resolves.toMatchObject({ kind: 'CLOSED', statusCode: 200 });

    expect(current.provider.close).toHaveBeenCalledOnce();
    expect(current.idempotency.claim).toHaveBeenCalledTimes(2);
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledOnce();
    expect(current.orders.finalizeOrderCloseInTransaction).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
    expect(current.callbackInbox.receive).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      eventType: 'payment.succeeded',
      providerEventId: 'mock_event_concurrent_late_success',
      signatureValid: true,
    }));
  });
});
