import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { PaymentReconciliationRepository } from './payment-reconciliation.repository';

const NOW = new Date('2026-08-30T10:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() - offset);
const orderId = id(9_000);
const paymentIntentId = id(8_000);
const refundId = id(7_000);
const refundAttemptId = id(6_000);
const paymentAttemptId = id(5_000);
const orderItemId = id(4_000);
const providerIntentId = 'mock_pi_reconciliation_fixture';
const providerTransactionId = 'mock_tx_reconciliation_fixture';

function sqlText(query: unknown): string {
  return (query as { strings: readonly string[] }).strings.join('?');
}

function sqlValues(query: unknown): readonly unknown[] {
  return (query as { values: readonly unknown[] }).values;
}

function transactionHarness(results: unknown[]) {
  const queryRaw = vi.fn();
  for (const result of results) queryRaw.mockResolvedValueOnce(result);
  const transaction = { $queryRaw: queryRaw };
  const prisma = {
    $transaction: vi.fn(async (work: (value: unknown) => unknown) => work(transaction)),
  };
  return {
    prisma,
    queryRaw,
    repository: new PaymentReconciliationRepository(prisma as unknown as PrismaClient),
  };
}

function intentTaskRow(overrides: Record<string, unknown> = {}) {
  return {
    last_error_code: null,
    next_reconcile_at: NOW,
    order_id: orderId,
    payment_intent_id: paymentIntentId,
    payment_resolution: null,
    reconciliation_attempt_count: 1,
    reference_no: `PI${paymentIntentId}`,
    refund_id: null,
    status: 'OPEN',
    task_type: 'PAYMENT_INTENT',
    version: 2,
    ...overrides,
  };
}

function settlementTaskRow(overrides: Record<string, unknown> = {}) {
  return intentTaskRow({
    last_error_code: 'PAYMENT_CONFIGURATION_UNAVAILABLE',
    next_reconcile_at: null,
    payment_resolution: 'MANUAL_REQUIRED',
    reconciliation_attempt_count: 2,
    status: 'SUCCEEDED',
    task_type: 'PAYMENT_SETTLEMENT',
    version: 3,
    ...overrides,
  });
}

function refundTaskRow(overrides: Record<string, unknown> = {}) {
  return intentTaskRow({
    last_error_code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    next_reconcile_at: NOW,
    payment_resolution: 'MANUAL_REQUIRED',
    reconciliation_attempt_count: 1,
    reference_no: `RF${refundId}`,
    refund_id: refundId,
    status: 'FAILED',
    task_type: 'LATE_PAYMENT_REFUND',
    version: 3,
    ...overrides,
  });
}

function actionRow(overrides: Record<string, unknown> = {}) {
  return {
    amount: new Prisma.Decimal('19.90'),
    close_requested_at: null,
    has_active_reservation: false,
    intent_no: `PI${paymentIntentId}`,
    intent_status: 'SUCCEEDED',
    intent_version: 4,
    order_id: orderId,
    order_status: 'CLOSED',
    payment_intent_id: paymentIntentId,
    payment_resolution: 'LATE_SUCCESS_REFUND_PENDING',
    provider: 'MOCK',
    provider_intent_id: providerIntentId,
    provider_transaction_id: providerTransactionId,
    refund_amount: new Prisma.Decimal('19.90'),
    refund_attempt_id: refundAttemptId,
    refund_attempt_provider: 'MOCK',
    refund_attempt_status: 'INITIATED',
    refund_id: refundId,
    refund_no: `RF${refundId}`,
    refund_provider: 'MOCK',
    refund_status: 'PENDING',
    refund_version: 2,
    ...overrides,
  };
}

describe('PaymentReconciliationRepository reads', () => {
  it('strictly validates exact filters, pagination, dates and error codes', async () => {
    const { repository } = transactionHarness([]);
    await expect(repository.listTasks({ page: 0, pageSize: 20 }))
      .rejects.toThrow('positive PostgreSQL integer');
    await expect(repository.listTasks({ page: 1, pageSize: 101 }))
      .rejects.toThrow('between 1 and 100');
    await expect(repository.listTasks({ dueBefore: new Date(Number.NaN), page: 1, pageSize: 20 }))
      .rejects.toThrow('due-before time is invalid');
    await expect(repository.listTasks({ lastErrorCode: 'unsafe error', page: 1, pageSize: 20 }))
      .rejects.toThrow('error code is invalid');
    await expect(repository.listTasks({ page: 1, pageSize: 20, provider: 'MOCK' } as never))
      .rejects.toThrow('invalid fields');
    await expect(repository.findCurrentByPaymentIntentId(paymentIntentId.toLowerCase()))
      .rejects.toThrow('must be a ULID');
  });

  it('lists all three safe branches with parameterized filters and deterministic Repeatable Read pagination', async () => {
    const { prisma, queryRaw, repository } = transactionHarness([
      [{ total: 3n }],
      [intentTaskRow(), settlementTaskRow(), refundTaskRow()],
    ]);
    const dueBefore = new Date(NOW.getTime() + 60_000);

    const result = await repository.listTasks({
      dueBefore,
      intentStatus: 'OPEN',
      lastErrorCode: 'PAYMENT_PROVIDER_UNAVAILABLE',
      page: 2,
      pageSize: 20,
      paymentResolution: 'MANUAL_REQUIRED',
      refundStatus: 'FAILED',
      taskType: 'LATE_PAYMENT_REFUND',
    });

    expect(result.total).toBe(3);
    expect(result.items.map(({ taskType }) => taskType)).toEqual([
      'PAYMENT_INTENT',
      'PAYMENT_SETTLEMENT',
      'LATE_PAYMENT_REFUND',
    ]);
    for (const item of result.items) {
      expect(item).not.toHaveProperty('provider');
      expect(item).not.toHaveProperty('providerIntentId');
      expect(item).not.toHaveProperty('providerTransactionId');
      expect(item).not.toHaveProperty('customerId');
      expect(item).not.toHaveProperty('providerPayload');
    }
    expect(result.items[2]).toEqual({
      lastErrorCode: 'PAYMENT_PROVIDER_UNAVAILABLE',
      nextReconcileAt: NOW,
      orderId,
      paymentIntentId,
      paymentResolution: 'MANUAL_REQUIRED',
      reconciliationAttemptCount: 1,
      referenceNo: `RF${refundId}`,
      refundId,
      status: 'FAILED',
      taskType: 'LATE_PAYMENT_REFUND',
      version: 3,
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const pageQuery = queryRaw.mock.calls[1]?.[0];
    expect(sqlText(pageQuery)).toContain(
      'ORDER BY next_reconcile_at ASC NULLS LAST, task_type ASC, payment_intent_id ASC, refund_id ASC NULLS FIRST',
    );
    expect(sqlText(pageQuery)).not.toContain('PAYMENT_PROVIDER_UNAVAILABLE');
    expect(sqlText(pageQuery)).not.toContain(paymentIntentId);
    expect(sqlValues(pageQuery)).toEqual(expect.arrayContaining([
      'LATE_PAYMENT_REFUND',
      'OPEN',
      'FAILED',
      'MANUAL_REQUIRED',
      'PAYMENT_PROVIDER_UNAVAILABLE',
      dueBefore,
      20,
    ]));
    expect(sqlText(pageQuery)).not.toContain('provider_transaction_id');
    expect(sqlText(pageQuery)).not.toContain('provider_payload');
    expect(sqlText(pageQuery)).not.toContain('customer_id');
    expect(sqlText(pageQuery)).toContain('ORDER_CLOSE_INCOMPLETE');
    expect(sqlText(pageQuery)).toContain('orphan_reservation');
  });

  it('returns an exact pending task before attempting a converged projection', async () => {
    const { queryRaw, repository } = transactionHarness([[intentTaskRow()]]);

    await expect(repository.findCurrentByPaymentIntentId(paymentIntentId)).resolves.toEqual({
      kind: 'PENDING',
      task: expect.objectContaining({ paymentIntentId, status: 'OPEN', taskType: 'PAYMENT_INTENT' }),
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlValues(queryRaw.mock.calls[0]?.[0])).toContain(paymentIntentId);
    expect(sqlText(queryRaw.mock.calls[0]?.[0])).not.toContain(paymentIntentId);
  });

  it('returns contract-shaped normal and late-refund converged projections', async () => {
    const normal = transactionHarness([
      [],
      [{
        close_requested_at: null,
        has_active_reservation: false,
        intent_last_error_code: null,
        intent_status: 'SUCCEEDED',
        intent_version: 5,
        order_id: orderId,
        order_status: 'PENDING_SHIPMENT',
        payment_intent_id: paymentIntentId,
        payment_resolution: 'NORMAL',
        refund_failure_code: null,
        refund_id: null,
        refund_status: null,
        refund_version: null,
      }],
    ]);
    await expect(normal.repository.findCurrentByPaymentIntentId(paymentIntentId)).resolves.toEqual({
      kind: 'CONVERGED',
      projection: {
        lastErrorCode: null,
        orderId,
        outcome: 'CONVERGED',
        paymentIntentId,
        paymentIntentStatus: 'SUCCEEDED',
        paymentResolution: 'NORMAL',
        refundId: null,
        refundStatus: null,
        version: 5,
      },
    });

    const late = transactionHarness([
      [],
      [{
        close_requested_at: NOW,
        has_active_reservation: false,
        intent_last_error_code: null,
        intent_status: 'SUCCEEDED',
        intent_version: 4,
        order_id: orderId,
        order_status: 'CLOSED',
        payment_intent_id: paymentIntentId,
        payment_resolution: 'LATE_SUCCESS_REFUNDED',
        refund_failure_code: null,
        refund_id: refundId,
        refund_status: 'SUCCEEDED',
        refund_version: 5,
      }],
    ]);
    await expect(late.repository.findCurrentByPaymentIntentId(paymentIntentId)).resolves.toMatchObject({
      kind: 'CONVERGED',
      projection: {
        paymentIntentStatus: 'SUCCEEDED',
        paymentResolution: 'LATE_SUCCESS_REFUNDED',
        refundId,
        refundStatus: 'SUCCEEDED',
        version: 5,
      },
    });
  });

  it('requires a closed order with no active reservation before a requested close is converged', async () => {
    const row = {
      close_requested_at: NOW,
      has_active_reservation: false,
      intent_last_error_code: null,
      intent_status: 'CLOSED',
      intent_version: 5,
      order_id: orderId,
      order_status: 'CLOSED',
      payment_intent_id: paymentIntentId,
      payment_resolution: 'NORMAL',
      refund_failure_code: null,
      refund_id: null,
      refund_status: null,
      refund_version: null,
    };
    const orderStillOpen = transactionHarness([[], [{ ...row, order_status: 'PENDING_PAYMENT' }]]);
    await expect(orderStillOpen.repository.findCurrentByPaymentIntentId(paymentIntentId)).resolves.toBeNull();

    const reservationStillActive = transactionHarness([[], [{ ...row, has_active_reservation: true }]]);
    await expect(reservationStillActive.repository.findCurrentByPaymentIntentId(paymentIntentId)).resolves.toBeNull();

    const fullyClosed = transactionHarness([[], [row]]);
    await expect(fullyClosed.repository.findCurrentByPaymentIntentId(paymentIntentId)).resolves.toMatchObject({
      kind: 'CONVERGED',
      projection: {
        paymentIntentStatus: 'CLOSED',
        paymentResolution: 'NORMAL',
      },
    });
    const convergedQuery = fullyClosed.queryRaw.mock.calls[1]?.[0];
    expect(sqlText(convergedQuery)).toContain('pi.close_requested_at');
    expect(sqlText(convergedQuery)).toContain('so.order_status::text AS order_status');
    expect(sqlText(convergedQuery)).toContain("active_reservation.status = 'ACTIVE'");
  });

  it('keeps Provider locators only in the internal action union and requires retry for a failed refund', async () => {
    const pending = transactionHarness([[actionRow()]]);
    await expect(pending.repository.readActionFacts(paymentIntentId)).resolves.toEqual({
      amount: '19.90',
      intentNo: `PI${paymentIntentId}`,
      kind: 'LATE_PAYMENT_REFUND',
      lateRefundOperation: {
        amount: '19.90',
        orderId,
        paymentIntentId,
        provider: 'MOCK',
        providerIntentId,
        providerTransactionId,
        refundAttemptId,
        refundId,
        refundNo: `RF${refundId}`,
        refundVersion: 2,
      },
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      providerIntentId,
      refundId,
      refundStatus: 'PENDING',
      status: 'SUCCEEDED',
      version: 4,
    });

    const failed = transactionHarness([[actionRow({
      refund_attempt_status: 'FAILED',
      refund_status: 'FAILED',
    })]]);
    await expect(failed.repository.readActionFacts(paymentIntentId)).resolves.toMatchObject({
      kind: 'LATE_PAYMENT_REFUND',
      lateRefundOperation: null,
      refundStatus: 'FAILED',
    });

    const converged = transactionHarness([[actionRow({
      payment_resolution: 'LATE_SUCCESS_REFUNDED',
      refund_attempt_status: 'SUCCEEDED',
      refund_status: 'SUCCEEDED',
    })]]);
    await expect(converged.repository.readActionFacts(paymentIntentId)).resolves.toBeNull();
  });

  it('surfaces a terminal close orphan as an internal local-repair action without changing the public task enum', async () => {
    const orphan = transactionHarness([[actionRow({
      close_requested_at: NOW,
      has_active_reservation: true,
      intent_status: 'CLOSED',
      order_status: 'PENDING_PAYMENT',
      payment_resolution: 'NORMAL',
      provider_transaction_id: null,
      refund_amount: null,
      refund_attempt_id: null,
      refund_attempt_provider: null,
      refund_attempt_status: null,
      refund_id: null,
      refund_no: null,
      refund_provider: null,
      refund_status: null,
      refund_version: null,
    })]]);

    await expect(orphan.repository.readActionFacts(paymentIntentId)).resolves.toEqual({
      amount: '19.90',
      intentNo: `PI${paymentIntentId}`,
      kind: 'TERMINAL_CLOSE_REPAIR',
      orderId,
      paymentIntentId,
      provider: 'MOCK',
      providerIntentId,
      status: 'CLOSED',
      version: 4,
    });

    const repaired = transactionHarness([[actionRow({
      close_requested_at: NOW,
      has_active_reservation: false,
      intent_status: 'CLOSED',
      order_status: 'CLOSED',
      payment_resolution: 'NORMAL',
      provider_transaction_id: null,
      refund_amount: null,
      refund_attempt_id: null,
      refund_attempt_provider: null,
      refund_attempt_status: null,
      refund_id: null,
      refund_no: null,
      refund_provider: null,
      refund_status: null,
      refund_version: null,
    })]]);
    await expect(repaired.repository.readActionFacts(paymentIntentId)).resolves.toBeNull();
  });
});

function retryHarness(overrides: {
  order?: Record<string, unknown>;
  refund?: Record<string, unknown>;
} = {}) {
  const previousAttempt = {
    attempt_no: 1,
    failure_code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    finished_at: NOW,
    id: refundAttemptId,
    idempotency_key: `late-payment:${refundId}:1`,
    provider: 'MOCK',
    provider_payload: null,
    provider_request_id: null,
    status: 'FAILED',
  };
  const intent = {
    amount: new Prisma.Decimal('19.90'),
    attempts: [{
      amount: new Prisma.Decimal('19.90'),
      failure_code: null,
      finished_at: NOW,
      id: paymentAttemptId,
      provider: 'MOCK',
      provider_transaction_id: providerTransactionId,
      status: 'SUCCEEDED_LATE',
    }],
    id: paymentIntentId,
    intent_no: `PI${paymentIntentId}`,
    order_id: orderId,
    provider: 'MOCK',
    provider_intent_id: providerIntentId,
    provider_state: 'SUCCEEDED',
    status: 'SUCCEEDED',
    succeeded_at: NOW,
    version: 4,
  };
  const order = {
    final_agent_id: null,
    final_channel: null,
    fulfillment_status: 'NOT_STARTED',
    goods_amount: new Prisma.Decimal('19.90'),
    id: orderId,
    items: [{
      aftersale_reserved_amount: new Prisma.Decimal(0),
      aftersale_reserved_qty: 0,
      id: orderItemId,
      line_paid_amount: new Prisma.Decimal('19.90'),
      pre_shipment_refunded_qty: 0,
      quantity: 1,
      refunded_amount: new Prisma.Decimal(0),
      refunded_qty: 0,
      shipped_qty: 0,
    }],
    order_status: 'CLOSED',
    paid_amount: new Prisma.Decimal('19.90'),
    payable_amount: new Prisma.Decimal('19.90'),
    payment_resolution: 'MANUAL_REQUIRED',
    payment_status: 'PAID',
    refunded_amount: new Prisma.Decimal(0),
    refund_processing_status: 'FAILED',
    refund_progress_status: 'NONE',
    shipping_amount: new Prisma.Decimal(0),
    version: 6,
    ...overrides.order,
  };
  const refund = {
    aftersale_id: null,
    amount: new Prisma.Decimal('19.90'),
    attempts: [previousAttempt],
    failed_at: NOW,
    failure_code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    id: refundId,
    is_late_payment_refund: true,
    items: [{
      aftersale_item_id: null,
      amount: new Prisma.Decimal('19.90'),
      auto_restock: false,
      commission_reversal: new Prisma.Decimal(0),
      order_item_id: orderItemId,
      quantity: 1,
    }],
    manual_compensation_id: null,
    order_id: orderId,
    origin_type: 'LATE_PAYMENT',
    provider: 'MOCK',
    provider_refund_id: null,
    reason: 'LATE_PAYMENT_AUTOMATIC_FULL_REFUND',
    refund_no: `RF${refundId}`,
    status: 'FAILED',
    version: 3,
    ...overrides.refund,
  };
  const queryRaw = vi.fn()
    .mockResolvedValueOnce([{ id: orderId }])
    .mockResolvedValueOnce([{ id: refundId }])
    .mockResolvedValueOnce([{ id: refundAttemptId }])
    .mockResolvedValueOnce([{ id: paymentIntentId }])
    .mockResolvedValueOnce([{ id: paymentAttemptId }])
    .mockResolvedValueOnce([{ transaction_time: NOW }]);
  const paymentIntent = {
    findUnique: vi.fn()
      .mockResolvedValueOnce({ order_id: orderId })
      .mockResolvedValueOnce(intent),
  };
  const refundModel = {
    findUnique: vi.fn().mockResolvedValue(refund),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const refundAttempt = { create: vi.fn().mockResolvedValue({}) };
  const salesOrder = {
    findUnique: vi.fn().mockResolvedValue(order),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const transaction = {
    $queryRaw: queryRaw,
    paymentIntent,
    refund: refundModel,
    refundAttempt,
    salesOrder,
  };
  return {
    queryRaw,
    refundAttempt,
    refundModel,
    repository: new PaymentReconciliationRepository({} as PrismaClient),
    salesOrder,
    transaction: transaction as unknown as DatabaseTransaction,
  };
}

describe('PaymentReconciliationRepository late refund retry', () => {
  it('locks facts, appends one attempt, reuses refund_no and resets FAILED to pending without Provider I/O', async () => {
    const state = retryHarness();

    const result = await state.repository.prepareLatePaymentRefundRetryInTransaction(state.transaction, {
      paymentIntentId,
    });

    expect(result).toEqual({
      afterOrderStatus: 'CLOSED',
      afterOrderVersion: 7,
      afterRefundStatus: 'PENDING',
      afterRefundVersion: 4,
      beforeOrderStatus: 'CLOSED',
      beforeOrderVersion: 6,
      beforeRefundStatus: 'FAILED',
      beforeRefundVersion: 3,
      operation: {
        amount: '19.90',
        orderId,
        paymentIntentId,
        provider: 'MOCK',
        providerIntentId,
        providerTransactionId,
        refundAttemptId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        refundId,
        refundNo: `RF${refundId}`,
        refundVersion: 4,
      },
    });
    expect(state.refundModel.updateMany).toHaveBeenCalledWith({
      data: {
        failed_at: null,
        failure_code: null,
        status: 'PENDING',
        updated_at: NOW,
        version: { increment: 1 },
      },
      where: { id: refundId, status: 'FAILED', version: 3 },
    });
    expect(state.salesOrder.updateMany).toHaveBeenCalledWith({
      data: {
        payment_resolution: 'LATE_SUCCESS_REFUND_PENDING',
        refund_processing_status: 'REFUNDING',
        updated_at: NOW,
        version: { increment: 1 },
      },
      where: { id: orderId, payment_resolution: 'MANUAL_REQUIRED', version: 6 },
    });
    expect(state.refundAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attempt_no: 2,
        failure_code: null,
        id: result.operation.refundAttemptId,
        idempotency_key: `late-payment:${refundId}:2`,
        provider: 'MOCK',
        provider_payload: Prisma.DbNull,
        provider_request_id: null,
        refund_id: refundId,
        requested_at: NOW,
        status: 'INITIATED',
      }),
    });
    const lockSql = state.queryRaw.mock.calls.slice(0, 5).map(([query]) => sqlText(query));
    expect(lockSql).toEqual([
      expect.stringContaining('FROM public.sales_order'),
      expect.stringContaining('FROM public.refund'),
      expect.stringContaining('FROM public.refund_attempt'),
      expect.stringContaining('FROM public.payment_intent'),
      expect.stringContaining('FROM public.payment_attempt'),
    ]);
    expect(state.transaction).not.toHaveProperty('provider');
    expect(state.transaction).not.toHaveProperty('mockProvider');
  });

  it('fails closed before writes when the refund is not a complete FAILED late-payment fact', async () => {
    const state = retryHarness({ refund: { status: 'SUCCEEDED' } });

    await expect(state.repository.prepareLatePaymentRefundRetryInTransaction(state.transaction, {
      paymentIntentId,
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(state.refundModel.updateMany).not.toHaveBeenCalled();
    expect(state.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(state.refundAttempt.create).not.toHaveBeenCalled();
  });

  it('rejects open retry input before reading or locking facts', async () => {
    const state = retryHarness();

    await expect(state.repository.prepareLatePaymentRefundRetryInTransaction(state.transaction, {
      paymentIntentId,
      provider: 'MOCK',
    } as never)).rejects.toThrow('contains invalid fields');
    expect(state.queryRaw).not.toHaveBeenCalled();
    expect(state.refundModel.updateMany).not.toHaveBeenCalled();
    expect(state.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(state.refundAttempt.create).not.toHaveBeenCalled();
  });
});
