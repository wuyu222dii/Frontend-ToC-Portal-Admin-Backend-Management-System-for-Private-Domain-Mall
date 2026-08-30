import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  DatabaseRuntime,
  PaymentReconciliationActionFacts,
  PaymentReconciliationCurrentProjection,
  PaymentReconciliationTask,
  StoreLatePaymentRefundOperation,
} from '@qingxu/database';
import type { PaymentProviderPort } from '@qingxu/payment';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import {
  type AdminPaymentReconciliationResult,
  AdminPaymentsService,
} from './admin-payments.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const factorId = '01J00000000000000000000002';
const orderId = '01J00000000000000000000003';
const paymentIntentId = '01J00000000000000000000004';
const refundId = '01J00000000000000000000005';
const refundAttemptId = '01J00000000000000000000006';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const nextReconcileAt = new Date('2026-08-30T01:02:03.000Z');

function config(): PlatformRuntimeConfig {
  return {
    encryption: {
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { mockSigningKey: Buffer.alloc(32, 4), provider: 'MOCK', providerTimeoutMs: 1_000 },
  } as unknown as PlatformRuntimeConfig;
}

function requestContext(): AdminCatalogRequestContext {
  return {
    accessSession: {
      accountId,
      accountVersion: 1,
      accessJti: 'access-jti',
      expiresAt: new Date('2026-08-30T02:00:00.000Z'),
      factorEncryptionKeyId: 'field-v1',
      factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-08-30T00:00:00.000Z'),
      sessionFamily: '01J00000000000000000000007',
      sessionId,
    },
    principal: {
      accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId,
    },
    requestId,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function intentTask(overrides: Partial<PaymentReconciliationTask> = {}): PaymentReconciliationTask {
  return {
    lastErrorCode: 'PROVIDER_UNKNOWN',
    nextReconcileAt,
    orderId,
    paymentIntentId,
    paymentResolution: null,
    reconciliationAttemptCount: 2,
    referenceNo: `PI${paymentIntentId}`,
    refundId: null,
    status: 'OPEN',
    taskType: 'PAYMENT_INTENT',
    version: 3,
    ...overrides,
  } as PaymentReconciliationTask;
}

function pendingCurrent(task: PaymentReconciliationTask = intentTask()): PaymentReconciliationCurrentProjection {
  return { kind: 'PENDING', task };
}

function convergedCurrent(
  overrides: Partial<Extract<PaymentReconciliationCurrentProjection, { kind: 'CONVERGED' }>['projection']> = {},
): PaymentReconciliationCurrentProjection {
  return {
    kind: 'CONVERGED',
    projection: {
      lastErrorCode: null,
      orderId,
      outcome: 'CONVERGED',
      paymentIntentId,
      paymentIntentStatus: 'CLOSED',
      paymentResolution: 'NORMAL',
      refundId: null,
      refundStatus: null,
      version: 4,
      ...overrides,
    } as Extract<PaymentReconciliationCurrentProjection, { kind: 'CONVERGED' }>['projection'],
  };
}

function paymentAction(overrides: Record<string, unknown> = {}): PaymentReconciliationActionFacts {
  return {
    amount: '39.80',
    intentNo: `PI${paymentIntentId}`,
    kind: 'PAYMENT_INTENT',
    orderId,
    paymentIntentId,
    provider: 'MOCK',
    providerIntentId: 'mock_intent_0001',
    status: 'OPEN',
    version: 3,
    ...overrides,
  };
}

function lateRefundOperation(overrides: Partial<StoreLatePaymentRefundOperation> = {}): StoreLatePaymentRefundOperation {
  return {
    amount: '39.80',
    orderId,
    paymentIntentId,
    provider: 'MOCK',
    providerIntentId: 'mock_intent_0001',
    providerTransactionId: 'mock_transaction_0001',
    refundAttemptId,
    refundId,
    refundNo: `RF${refundId}`,
    refundVersion: 4,
    ...overrides,
  };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  callbacks: {
    receive: ReturnType<typeof vi.fn>;
    receiveForReconciliation: ReturnType<typeof vi.fn>;
  };
  idempotency: {
    assertHashOnlyReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  orders: {
    finalizeOrderCloseInTransaction: ReturnType<typeof vi.fn>;
    repairTerminalOrderCloseInTransaction: ReturnType<typeof vi.fn>;
  };
  payments: {
    claimLatePaymentRefundInTransaction: ReturnType<typeof vi.fn>;
    finalizeLatePaymentRefundInTransaction: ReturnType<typeof vi.fn>;
    finalizeProviderOutcomeInTransaction: ReturnType<typeof vi.fn>;
  };
  reconciliations: {
    findCurrentByPaymentIntentId: ReturnType<typeof vi.fn>;
    listTasks: ReturnType<typeof vi.fn>;
    prepareLatePaymentRefundRetryInTransaction: ReturnType<typeof vi.fn>;
    readActionFacts: ReturnType<typeof vi.fn>;
  };
  withReconciliationOwner: (
    paymentIntentId: string,
    work: () => Promise<AdminPaymentReconciliationResult>,
  ) => Promise<AdminPaymentReconciliationResult>;
}

function harness() {
  const transaction = {};
  let transactionDepth = 0;
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => {
        transactionDepth += 1;
        try {
          return await work(transaction);
        } finally {
          transactionDepth -= 1;
        }
      }),
    },
  } as unknown as DatabaseRuntime;
  const provider = {
    close: vi.fn(),
    create: vi.fn(),
    query: vi.fn(),
    refund: vi.fn(),
  } as unknown as PaymentProviderPort;
  const service = new AdminPaymentsService(config(), database, provider);
  const internals = service as unknown as ServiceInternals;
  internals.audit = { append: vi.fn().mockResolvedValue({}) };
  internals.callbacks = {
    receive: vi.fn().mockResolvedValue({ created: true }),
    receiveForReconciliation: vi.fn().mockResolvedValue({ created: true, requeued: false }),
  };
  internals.idempotency = {
    assertHashOnlyReplay: vi.fn(),
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  internals.outbox = { append: vi.fn().mockResolvedValue({}) };
  internals.orders = {
    finalizeOrderCloseInTransaction: vi.fn(),
    repairTerminalOrderCloseInTransaction: vi.fn(),
  };
  internals.payments = {
    claimLatePaymentRefundInTransaction: vi.fn(),
    finalizeLatePaymentRefundInTransaction: vi.fn(),
    finalizeProviderOutcomeInTransaction: vi.fn().mockResolvedValue({
      changed: true,
      intent: { status: 'OPEN', version: 4 },
    }),
  };
  internals.reconciliations = {
    findCurrentByPaymentIntentId: vi.fn().mockResolvedValue(pendingCurrent()),
    listTasks: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    prepareLatePaymentRefundRetryInTransaction: vi.fn(),
    readActionFacts: vi.fn(),
  };
  internals.withReconciliationOwner = vi.fn(async (_paymentIntentId, work) => work());
  return {
    database,
    internals,
    provider: provider as PaymentProviderPort & {
      close: ReturnType<typeof vi.fn>;
      query: ReturnType<typeof vi.fn>;
      refund: ReturnType<typeof vi.fn>;
    },
    service,
    transaction,
    transactionDepth: () => transactionDepth,
  };
}

describe('B10.5 Admin payment reconciliation service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('maps all reconciliation task variants to the closed public list projection', async () => {
    const current = harness();
    const settlementTask: PaymentReconciliationTask = {
      lastErrorCode: 'SETTLEMENT_REQUIRES_REVIEW',
      nextReconcileAt: null,
      orderId: '01J00000000000000000000008',
      paymentIntentId: '01J00000000000000000000009',
      paymentResolution: 'MANUAL_REQUIRED',
      reconciliationAttemptCount: 1,
      referenceNo: 'PI01J00000000000000000000009',
      refundId: null,
      status: 'SUCCEEDED',
      taskType: 'PAYMENT_SETTLEMENT',
      version: 5,
    };
    const refundTask: PaymentReconciliationTask = {
      lastErrorCode: 'PROVIDER_UNAVAILABLE',
      nextReconcileAt: new Date('2026-08-30T01:03:03.000Z'),
      orderId: '01J0000000000000000000000A',
      paymentIntentId: '01J0000000000000000000000B',
      paymentResolution: 'MANUAL_REQUIRED',
      reconciliationAttemptCount: 3,
      referenceNo: 'RF01J0000000000000000000000C',
      refundId: '01J0000000000000000000000C',
      status: 'FAILED',
      taskType: 'LATE_PAYMENT_REFUND',
      version: 6,
    };
    current.internals.reconciliations.listTasks.mockResolvedValue({
      items: [intentTask(), settlementTask, refundTask],
      total: 3,
    });

    await expect(current.service.listTasks({ page: 2, pageSize: 50 })).resolves.toEqual({
      items: [
        {
          last_error_code: 'PROVIDER_UNKNOWN',
          next_reconcile_at: '2026-08-30T01:02:03.000Z',
          order_id: orderId,
          payment_intent_id: paymentIntentId,
          payment_resolution: null,
          reconciliation_attempt_count: 2,
          reference_no: `PI${paymentIntentId}`,
          refund_id: null,
          status: 'OPEN',
          task_type: 'PAYMENT_INTENT',
          version: 3,
        },
        {
          last_error_code: 'SETTLEMENT_REQUIRES_REVIEW',
          next_reconcile_at: null,
          order_id: '01J00000000000000000000008',
          payment_intent_id: '01J00000000000000000000009',
          payment_resolution: 'MANUAL_REQUIRED',
          reconciliation_attempt_count: 1,
          reference_no: 'PI01J00000000000000000000009',
          refund_id: null,
          status: 'SUCCEEDED',
          task_type: 'PAYMENT_SETTLEMENT',
          version: 5,
        },
        {
          last_error_code: 'PROVIDER_UNAVAILABLE',
          next_reconcile_at: '2026-08-30T01:03:03.000Z',
          order_id: '01J0000000000000000000000A',
          payment_intent_id: '01J0000000000000000000000B',
          payment_resolution: 'MANUAL_REQUIRED',
          reconciliation_attempt_count: 3,
          reference_no: 'RF01J0000000000000000000000C',
          refund_id: '01J0000000000000000000000C',
          status: 'FAILED',
          task_type: 'LATE_PAYMENT_REFUND',
          version: 6,
        },
      ],
      pagination: { page: 2, page_size: 50, total: 3 },
    });
    expect(current.internals.reconciliations.listTasks).toHaveBeenCalledWith({ page: 2, pageSize: 50 });
  });

  it('returns the current pending projection on HASH_ONLY replay without touching Provider or action facts', async () => {
    const current = harness();
    const record = { resource_id: paymentIntentId, response_status: 202 };
    current.internals.idempotency.claim.mockResolvedValue({ kind: 'replay', record });
    current.internals.reconciliations.findCurrentByPaymentIntentId.mockResolvedValue(pendingCurrent());

    await expect(current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Retry provider status' }, idempotencyKey,
    )).resolves.toEqual({
      data: {
        last_error_code: 'PROVIDER_UNKNOWN',
        next_reconcile_at: '2026-08-30T01:02:03.000Z',
        order_id: orderId,
        payment_intent_id: paymentIntentId,
        payment_resolution: null,
        reconciliation_attempt_count: 2,
        reference_no: `PI${paymentIntentId}`,
        refund_id: null,
        status: 'OPEN',
        task_type: 'PAYMENT_INTENT',
        version: 3,
      },
      statusCode: 202,
    });
    expect(current.internals.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: paymentIntentId,
      responseForHash: { reconciliation: { payment_intent_id: paymentIntentId } },
      responseStatus: 202,
      storage: 'HASH_ONLY',
    });
    expect(current.internals.reconciliations.readActionFacts).not.toHaveBeenCalled();
    expect(current.provider.query).not.toHaveBeenCalled();
    expect(current.provider.close).not.toHaveBeenCalled();
    expect(current.provider.refund).not.toHaveBeenCalled();
    expect(current.internals.payments.finalizeProviderOutcomeInTransaction).not.toHaveBeenCalled();
    expect(current.internals.idempotency.complete).not.toHaveBeenCalled();
    expect(current.internals.audit.append).not.toHaveBeenCalled();
  });

  it('keeps UNKNOWN Provider results pending and records a 202 HASH_ONLY completion', async () => {
    const current = harness();
    const action = paymentAction();
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);
    current.provider.query.mockImplementation(async () => {
      expect(current.transactionDepth()).toBe(0);
      return {
        capability: null,
        failureCode: null,
        occurredAt: null,
        outcome: 'UNKNOWN',
        providerEventId: null,
        providerIntentId: action.providerIntentId,
        providerTransactionId: null,
      };
    });

    const result = await current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Retry provider status' }, idempotencyKey,
    );

    expect(result.statusCode).toBe(202);
    expect(result.data).toMatchObject({
      payment_intent_id: paymentIntentId,
      status: 'OPEN',
      task_type: 'PAYMENT_INTENT',
    });
    expect(current.provider.query).toHaveBeenCalledOnce();
    expect(current.internals.payments.finalizeProviderOutcomeInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        expectedVersion: 3,
        orderId,
        paymentIntentId,
        provider: 'MOCK',
        result: expect.objectContaining({
          errorCode: 'PROVIDER_UNKNOWN',
          kind: 'UNKNOWN',
          nextReconcileAt: expect.any(Date),
          providerState: 'UNKNOWN',
        }),
      }),
    );
    expect(current.internals.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.any(Object),
      {
        resourceId: paymentIntentId,
        responseForHash: { reconciliation: { payment_intent_id: paymentIntentId } },
        responseStatus: 202,
        storage: 'HASH_ONLY',
      },
    );
    expect(current.internals.audit.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'RETRY',
        module: 'payment',
        objectId: paymentIntentId,
        reason: 'Retry provider status',
        result: 'SUCCESS',
      }),
    );
  });

  it('requeues a verified successful callback so a MANUAL_REQUIRED settlement can be compensated', async () => {
    const current = harness();
    const action: PaymentReconciliationActionFacts = {
      amount: '39.80',
      intentNo: `PI${paymentIntentId}`,
      kind: 'PAYMENT_SETTLEMENT',
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      providerIntentId: 'mock_intent_0001',
      status: 'SUCCEEDED',
      version: 4,
    };
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);
    current.provider.query.mockResolvedValue({
      capability: null,
      failureCode: null,
      occurredAt: new Date('2026-08-30T01:03:30.000Z'),
      outcome: 'SUCCEEDED',
      providerEventId: 'mock_event_reconcile_0001',
      providerIntentId: action.providerIntentId,
      providerTransactionId: 'mock_transaction_reconcile_0001',
    });

    const result = await current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Retry settlement' }, idempotencyKey,
    );

    expect(result.statusCode).toBe(202);
    expect(current.internals.callbacks.receiveForReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'payment.succeeded',
        provider: 'MOCK',
        providerEventId: 'mock_event_reconcile_0001',
        signatureValid: true,
      }),
    );
    expect(current.internals.payments.finalizeProviderOutcomeInTransaction).not.toHaveBeenCalled();
  });

  it('returns an exact 200 convergence projection when no action remains', async () => {
    const current = harness();
    current.internals.reconciliations.readActionFacts.mockResolvedValue(null);
    current.internals.reconciliations.findCurrentByPaymentIntentId.mockResolvedValue(convergedCurrent());

    await expect(current.service.reconcile(
      requestContext(), paymentIntentId, {}, idempotencyKey,
    )).resolves.toEqual({
      data: {
        last_error_code: null,
        order_id: orderId,
        outcome: 'CONVERGED',
        payment_intent_id: paymentIntentId,
        payment_intent_status: 'CLOSED',
        payment_resolution: 'NORMAL',
        refund_id: null,
        refund_status: null,
        version: 4,
      },
      statusCode: 200,
    });
    expect(current.provider.query).not.toHaveBeenCalled();
    expect(current.internals.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.any(Object),
      expect.objectContaining({ responseStatus: 200, storage: 'HASH_ONLY' }),
    );
  });

  it('retries a FAILED late refund with a new attempt and performs Provider I/O outside transactions', async () => {
    const current = harness();
    const operation = lateRefundOperation();
    const claimedOperation = lateRefundOperation({ refundVersion: 5 });
    const action: PaymentReconciliationActionFacts = {
      amount: '39.80',
      intentNo: `PI${paymentIntentId}`,
      kind: 'LATE_PAYMENT_REFUND',
      lateRefundOperation: null,
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      providerIntentId: 'mock_intent_0001',
      refundId,
      refundStatus: 'FAILED',
      status: 'SUCCEEDED',
      version: 4,
    };
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);
    current.internals.reconciliations.prepareLatePaymentRefundRetryInTransaction.mockResolvedValue({
      afterOrderStatus: 'CLOSED',
      afterOrderVersion: 7,
      afterRefundStatus: 'PENDING',
      afterRefundVersion: 4,
      beforeOrderStatus: 'CLOSED',
      beforeOrderVersion: 6,
      beforeRefundStatus: 'FAILED',
      beforeRefundVersion: 3,
      operation,
    });
    current.internals.payments.claimLatePaymentRefundInTransaction.mockResolvedValue({
      kind: 'CLAIMED', operation: claimedOperation,
    });
    current.provider.refund.mockImplementation(async () => {
      expect(current.transactionDepth()).toBe(0);
      return {
        failureCode: null,
        occurredAt: new Date('2026-08-30T01:04:00.000Z'),
        outcome: 'SUCCEEDED',
        providerEventId: 'mock_refund_event_0001',
        providerRefundId: 'mock_refund_0001',
      };
    });
    current.internals.payments.finalizeLatePaymentRefundInTransaction.mockResolvedValue({
      afterOrderVersion: 8,
      afterRefundStatus: 'SUCCEEDED',
      afterRefundVersion: 6,
      beforeOrderVersion: 7,
      beforeRefundStatus: 'PROCESSING',
      beforeRefundVersion: 5,
      changed: true,
      kind: 'REFUNDED',
      orderId,
      refundId,
    });
    current.internals.reconciliations.findCurrentByPaymentIntentId.mockResolvedValue(convergedCurrent({
      paymentIntentStatus: 'SUCCEEDED',
      paymentResolution: 'LATE_SUCCESS_REFUNDED',
      refundId,
      refundStatus: 'SUCCEEDED',
      version: 6,
    }));

    const result = await current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Retry late refund' }, idempotencyKey,
    );

    expect(result).toMatchObject({ statusCode: 200, data: { payment_resolution: 'LATE_SUCCESS_REFUNDED' } });
    expect(current.internals.reconciliations.prepareLatePaymentRefundRetryInTransaction)
      .toHaveBeenCalledWith(current.transaction, { paymentIntentId });
    expect(current.internals.payments.claimLatePaymentRefundInTransaction)
      .toHaveBeenCalledWith(current.transaction, operation);
    expect(current.provider.refund).toHaveBeenCalledWith({
      amount: '39.80',
      providerIntentId: 'mock_intent_0001',
      providerTransactionId: 'mock_transaction_0001',
      refundNo: `RF${refundId}`,
    });
    expect(current.internals.payments.finalizeLatePaymentRefundInTransaction).toHaveBeenCalledWith(
      current.transaction,
      {
        operation: claimedOperation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: new Date('2026-08-30T01:04:00.000Z'),
          providerEventId: 'mock_refund_event_0001',
          providerRefundId: 'mock_refund_0001',
        },
      },
    );
    expect(current.internals.outbox.append).toHaveBeenCalledTimes(5);
    expect(current.internals.outbox.append).toHaveBeenCalledWith(current.transaction, {
      aggregateId: refundId,
      aggregateType: 'refund',
      eventType: 'refund.succeeded',
      payload: {
        event_version: 1,
        resource_id: refundId,
        resource_type: 'refund',
        resource_version: 6,
      },
    });
    expect(current.internals.audit.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'REFUND',
        after: { status: 'PENDING', version: 4 },
        before: { status: 'FAILED', version: 3 },
        module: 'refund',
        objectId: refundId,
      }),
    );
    expect(current.internals.audit.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'REFUND',
        after: { status: 'PROCESSING', version: 5 },
        before: { status: 'PENDING', version: 4 },
        module: 'refund',
        objectId: refundId,
      }),
    );
    expect(current.internals.audit.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'REFUND',
        after: { status: 'SUCCEEDED', version: 6 },
        before: { status: 'PROCESSING', version: 5 },
        module: 'refund',
        objectId: refundId,
      }),
    );
  });

  it.each([
    ['payment intent', paymentAction({ provider: 'WECHAT' })],
    ['late refund', {
      ...paymentAction({ provider: 'WECHAT', status: 'SUCCEEDED', version: 4 }),
      kind: 'LATE_PAYMENT_REFUND',
      lateRefundOperation: null,
      providerIntentId: 'wechat_intent_0001',
      refundId,
      refundStatus: 'FAILED',
    } as PaymentReconciliationActionFacts],
  ])('fails closed before Provider I/O when a stored %s uses a different Provider', async (_label, action) => {
    const current = harness();
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);

    await expect(current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Retry stored provider' }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'PAYMENT_CONFIGURATION_UNAVAILABLE' });

    expect(current.provider.query).not.toHaveBeenCalled();
    expect(current.provider.close).not.toHaveBeenCalled();
    expect(current.provider.refund).not.toHaveBeenCalled();
    expect(current.internals.payments.finalizeProviderOutcomeInTransaction).not.toHaveBeenCalled();
    expect(current.internals.reconciliations.prepareLatePaymentRefundRetryInTransaction).not.toHaveBeenCalled();
    expect(current.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('repairs a terminal close orphan locally without querying or rewriting Provider state', async () => {
    const current = harness();
    const action = paymentAction({ kind: 'TERMINAL_CLOSE_REPAIR', status: 'CLOSED', version: 5 });
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);
    current.internals.orders.repairTerminalOrderCloseInTransaction.mockResolvedValue({
      before: { orderId, orderStatus: 'PENDING_PAYMENT', version: 8 },
      changed: true,
      order: { orderId, orderStatus: 'CLOSED', version: 9 },
      reservationId: '01J0000000000000000000000D',
    });
    current.internals.reconciliations.findCurrentByPaymentIntentId.mockResolvedValue(convergedCurrent({
      paymentIntentStatus: 'CLOSED',
      version: 5,
    }));

    await expect(current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Repair interrupted local close' }, idempotencyKey,
    )).resolves.toMatchObject({ statusCode: 200, data: { payment_intent_status: 'CLOSED' } });

    expect(current.internals.orders.repairTerminalOrderCloseInTransaction).toHaveBeenCalledWith(
      current.transaction,
      { expectedIntentVersion: 5, orderId, paymentIntentId },
    );
    expect(current.provider.query).not.toHaveBeenCalled();
    expect(current.provider.close).not.toHaveBeenCalled();
    expect(current.internals.payments.finalizeProviderOutcomeInTransaction).not.toHaveBeenCalled();
    expect(current.internals.audit.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'CANCEL',
        after: { status: 'CLOSED', version: 9 },
        before: { status: 'PENDING_PAYMENT', version: 8 },
        module: 'order',
        objectId: orderId,
      }),
    );
    expect(current.internals.outbox.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({ aggregateId: orderId, eventType: 'order.closed' }),
    );
  });

  it('finalizes CLOSE_PENDING through the order close repository with atomic audits and Outbox facts', async () => {
    const current = harness();
    const action = paymentAction({ kind: 'PAYMENT_INTENT', status: 'CLOSE_PENDING', version: 5 });
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);
    current.provider.query.mockResolvedValue({
      capability: null,
      failureCode: null,
      occurredAt: null,
      outcome: 'OPEN',
      providerEventId: null,
      providerIntentId: 'mock_intent_0001',
      providerTransactionId: null,
    });
    current.provider.close.mockResolvedValue({
      capability: null,
      failureCode: null,
      occurredAt: new Date('2026-08-30T01:05:00.000Z'),
      outcome: 'CLOSED',
      providerEventId: 'mock_close_event_0001',
      providerIntentId: 'mock_intent_0001',
      providerTransactionId: null,
    });
    current.internals.orders.finalizeOrderCloseInTransaction.mockResolvedValue({
      closeResult: {
        before: { orderId, orderStatus: 'PENDING_PAYMENT', version: 8 },
        changed: true,
        order: { orderId, orderStatus: 'CLOSED', version: 9 },
        reservationId: '01J0000000000000000000000D',
      },
      kind: 'CLOSED',
      order: { orderId, orderStatus: 'CLOSED', version: 9 },
      paymentIntent: { paymentIntentId, status: 'CLOSED', version: 6 },
      reservationId: '01J0000000000000000000000D',
    });
    current.internals.reconciliations.findCurrentByPaymentIntentId.mockResolvedValue(convergedCurrent({
      paymentIntentStatus: 'CLOSED',
      version: 6,
    }));

    await expect(current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Close stuck payment' }, idempotencyKey,
    )).resolves.toMatchObject({ statusCode: 200, data: { payment_intent_status: 'CLOSED' } });

    expect(current.internals.orders.finalizeOrderCloseInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        expectedIntentVersion: 5,
        orderId,
        outcome: 'CLOSED',
        paymentIntentId,
      }),
    );
    expect(current.internals.payments.finalizeProviderOutcomeInTransaction).not.toHaveBeenCalled();
    expect(current.internals.audit.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'CANCEL',
        after: { status: 'CLOSED', version: 9 },
        before: { status: 'PENDING_PAYMENT', version: 8 },
        module: 'order',
        objectId: orderId,
      }),
    );
    expect(current.internals.outbox.append).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({ aggregateId: orderId, eventType: 'order.closed' }),
    );
  });

  it('rejects a mismatched Provider locator before close or local persistence', async () => {
    const current = harness();
    const action = paymentAction({ kind: 'PAYMENT_INTENT', status: 'CLOSE_PENDING', version: 5 });
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);
    current.provider.query.mockResolvedValue({
      capability: null,
      failureCode: null,
      occurredAt: null,
      outcome: 'OPEN',
      providerEventId: null,
      providerIntentId: 'mock_intent_different',
      providerTransactionId: null,
    });

    await expect(current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Reject mismatched locator' }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'PAYMENT_RESULT_CONFLICT' });

    expect(current.provider.close).not.toHaveBeenCalled();
    expect(current.internals.orders.finalizeOrderCloseInTransaction).not.toHaveBeenCalled();
    expect(current.internals.payments.finalizeProviderOutcomeInTransaction).not.toHaveBeenCalled();
    expect(current.internals.callbacks.receive).not.toHaveBeenCalled();
    expect(current.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('queues a recovered CLOSE_PENDING success in the same transaction as the local observation', async () => {
    const current = harness();
    const action = paymentAction({ kind: 'PAYMENT_INTENT', status: 'CLOSE_PENDING', version: 5 });
    current.internals.reconciliations.readActionFacts.mockResolvedValue(action);
    const providerResult = {
      capability: null,
      failureCode: null,
      occurredAt: new Date('2026-08-30T01:06:00.000Z'),
      outcome: 'SUCCEEDED' as const,
      providerEventId: 'mock_success_event_0001',
      providerIntentId: 'mock_intent_0001',
      providerTransactionId: 'mock_transaction_0001',
    };
    current.provider.query.mockResolvedValue(providerResult);
    current.internals.orders.finalizeOrderCloseInTransaction.mockResolvedValue({
      closeResult: null,
      kind: 'PAYMENT_CONFIRMED',
      order: { orderId, orderStatus: 'PENDING_PAYMENT', version: 8 },
      paymentIntent: { paymentIntentId, status: 'CLOSE_PENDING', version: 6 },
      reservationId: '01J0000000000000000000000D',
    });

    await expect(current.service.reconcile(
      requestContext(), paymentIntentId, { reason: 'Confirm close outcome' }, idempotencyKey,
    )).resolves.toMatchObject({ statusCode: 202 });

    expect(current.internals.callbacks.receive).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        eventType: 'payment.succeeded',
        providerEventId: 'mock_success_event_0001',
        signatureValid: true,
      }),
    );
    expect(current.internals.callbacks.receiveForReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'payment.succeeded',
        providerEventId: 'mock_success_event_0001',
        signatureValid: true,
      }),
    );
  });

  it('enters every reconciliation command through the payment-intent owner boundary', async () => {
    const current = harness();
    current.internals.reconciliations.readActionFacts.mockResolvedValue(null);
    current.internals.reconciliations.findCurrentByPaymentIntentId.mockResolvedValue(convergedCurrent());

    await current.service.reconcile(requestContext(), paymentIntentId, {}, idempotencyKey);

    expect(current.internals.withReconciliationOwner).toHaveBeenCalledWith(paymentIntentId, expect.any(Function));
  });
});
