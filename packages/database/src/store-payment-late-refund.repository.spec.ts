import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StorePaymentRepository,
  type StoreLatePaymentRefundOperation,
  type StorePaymentCallbackInput,
} from './store-payment.repository';

const NOW = new Date('2026-08-30T08:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() - offset);
const orderId = id(9_000);
const paymentIntentId = id(8_000);
const paymentAttemptId = id(7_000);
const orderItemId = id(6_000);
const reservationId = id(5_000);
const skuId = id(4_000);
const providerIntentId = 'mock_pi_late_refund_fixture';
const providerTransactionId = 'mock_tx_late_refund_fixture';

function rawResults(values: unknown[]) {
  const mock = vi.fn();
  for (const value of values) mock.mockResolvedValueOnce(value);
  return mock;
}

function callback(outcome: StorePaymentCallbackInput['outcome'] = 'SUCCEEDED'): StorePaymentCallbackInput {
  return {
    amount: '19.90',
    eventType: outcome === 'SUCCEEDED'
      ? 'payment.succeeded'
      : outcome === 'FAILED' ? 'payment.failed' : 'payment.cancelled',
    occurredAt: NOW,
    outcome,
    provider: 'MOCK',
    providerEventId: `mock_evt_late_refund_${outcome.toLowerCase()}`,
    providerIntentId,
    providerTransactionId: outcome === 'SUCCEEDED' ? providerTransactionId : null,
  };
}

function orderItem(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_reserved_amount: new Prisma.Decimal(0),
    aftersale_reserved_qty: 0,
    id: orderItemId,
    line_paid_amount: new Prisma.Decimal('19.90'),
    pre_shipment_refunded_qty: 0,
    product_id: id(3_000),
    quantity: 1,
    refunded_amount: new Prisma.Decimal(0),
    refunded_qty: 0,
    shipped_qty: 0,
    sku_id: skuId,
    unit_price: new Prisma.Decimal('19.90'),
    version: 1,
    ...overrides,
  };
}

function closedOrder(overrides: Record<string, unknown> = {}) {
  return {
    address_snapshot: { city: 'Auckland' },
    attribution_candidate: {
      binding_id: null,
      candidate_agent_id: null,
      finalization_result: null,
      finalized_at: null,
      id: id(2_900),
      submit_channel: 'DIRECT',
      submitted_at: new Date(NOW.getTime() - 120_000),
    },
    attribution_snapshot: null,
    close_reason: 'USER_CANCELLED',
    closed_at: new Date(NOW.getTime() - 10_000),
    completed_at: null,
    completion_reason: null,
    customer: { id: id(2_800), nickname: 'Fixture', phone_verifications: [] },
    customer_id: id(2_800),
    final_agent_id: null,
    final_channel: null,
    fulfillment_status: 'NOT_STARTED',
    goods_amount: new Prisma.Decimal('19.90'),
    id: orderId,
    inventory_reservation: {
      consumed_at: null,
      expires_at: new Date(NOW.getTime() - 30_000),
      id: reservationId,
      items: [{ id: id(2_700), quantity: 1, sku_id: skuId }],
      order_id: orderId,
      released_at: new Date(NOW.getTime() - 10_000),
      status: 'RELEASED',
    },
    items: [orderItem()],
    order_status: 'CLOSED',
    paid_amount: new Prisma.Decimal(0),
    paid_at: null,
    pay_expires_at: new Date(NOW.getTime() - 30_000),
    payable_amount: new Prisma.Decimal('19.90'),
    payment_resolution: 'NORMAL',
    payment_status: 'UNPAID',
    refunded_amount: new Prisma.Decimal(0),
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    shipping_amount: new Prisma.Decimal(0),
    version: 4,
    ...overrides,
  };
}

function paymentAttempt() {
  return {
    amount: new Prisma.Decimal('19.90'),
    failure_code: null,
    finished_at: NOW,
    id: paymentAttemptId,
    initiated_at: NOW,
    provider: 'MOCK',
    provider_payload: null,
    provider_transaction_id: providerTransactionId,
    status: 'SUCCEEDED_LATE',
  };
}

function intent(attempts: Record<string, unknown>[] = [], overrides: Record<string, unknown> = {}) {
  return {
    amount: new Prisma.Decimal('19.90'),
    attempts,
    close_attempt_count: 1,
    close_requested_at: new Date(NOW.getTime() - 20_000),
    closed_at: new Date(NOW.getTime() - 10_000),
    create_requested_at: new Date(NOW.getTime() - 180_000),
    created_at: new Date(NOW.getTime() - 180_000),
    expires_at: new Date(NOW.getTime() - 30_000),
    id: paymentIntentId,
    intent_no: `PI${paymentIntentId}`,
    last_error_code: null,
    last_reconciled_at: new Date(NOW.getTime() - 10_000),
    next_reconcile_at: null,
    opened_at: new Date(NOW.getTime() - 170_000),
    order_id: orderId,
    provider: 'MOCK',
    provider_intent_id: providerIntentId,
    provider_state: 'CLOSED',
    reconciliation_attempt_count: 1,
    status: 'CLOSED',
    succeeded_at: null,
    updated_at: new Date(NOW.getTime() - 10_000),
    version: 3,
    ...overrides,
  };
}

function pendingOrder(overrides: Record<string, unknown> = {}) {
  return closedOrder({
    paid_amount: new Prisma.Decimal('19.90'),
    paid_at: NOW,
    payment_resolution: 'LATE_SUCCESS_REFUND_PENDING',
    payment_status: 'PAID',
    refund_processing_status: 'REFUNDING',
    version: 5,
    ...overrides,
  });
}

function lateRefundOperation(refundVersion = 2): StoreLatePaymentRefundOperation {
  const refundId = id(2_600);
  return {
    amount: '19.90',
    orderId,
    paymentIntentId,
    provider: 'MOCK',
    providerIntentId,
    providerTransactionId,
    refundAttemptId: id(2_550),
    refundId,
    refundNo: `RF${refundId}`,
    refundVersion,
  };
}

function refundRecord(
  operation: StoreLatePaymentRefundOperation,
  status: 'FAILED' | 'PENDING' | 'PROCESSING' | 'SUCCEEDED',
) {
  const attemptStatus = status === 'PENDING' ? 'INITIATED' : status;
  return {
    aftersale_id: null,
    amount: new Prisma.Decimal(operation.amount),
    attempts: [{
      attempt_no: 1,
      failure_code: status === 'FAILED' ? 'PROVIDER_UNAVAILABLE' : null,
      finished_at: status === 'FAILED' || status === 'SUCCEEDED' ? NOW : null,
      id: operation.refundAttemptId,
      idempotency_key: `late-payment:${operation.refundId}:1`,
      provider: 'MOCK',
      provider_payload: null,
      provider_request_id: status === 'SUCCEEDED' ? 'mock_re_late_refund_fixture' : null,
      refund_id: operation.refundId,
      requested_at: NOW,
      status: attemptStatus,
    }],
    failed_at: status === 'FAILED' ? NOW : null,
    failure_code: status === 'FAILED' ? 'PROVIDER_UNAVAILABLE' : null,
    id: operation.refundId,
    is_late_payment_refund: true,
    items: [{
      aftersale_item_id: null,
      amount: new Prisma.Decimal('19.90'),
      auto_restock: false,
      commission_reversal: new Prisma.Decimal(0),
      id: id(2_500),
      order_item_id: orderItemId,
      quantity: 1,
      refund_id: operation.refundId,
    }],
    manual_compensation_id: null,
    order_id: orderId,
    origin_type: 'LATE_PAYMENT',
    provider: 'MOCK',
    provider_refund_id: status === 'SUCCEEDED' ? 'mock_rf_late_refund_fixture' : null,
    reason: 'LATE_PAYMENT_AUTOMATIC_FULL_REFUND',
    refund_no: operation.refundNo,
    requested_at: NOW,
    status,
    succeeded_at: status === 'SUCCEEDED' ? NOW : null,
    version: status === 'PENDING' ? 1 : status === 'PROCESSING' ? 2 : 3,
  };
}

function terminalOrder(result: 'FAILED' | 'SUCCEEDED') {
  if (result === 'FAILED') {
    return pendingOrder({
      payment_resolution: 'MANUAL_REQUIRED',
      refund_processing_status: 'FAILED',
      version: 6,
    });
  }
  return pendingOrder({
    items: [orderItem({
      pre_shipment_refunded_qty: 1,
      refunded_amount: new Prisma.Decimal('19.90'),
      refunded_qty: 1,
      version: 2,
    })],
    payment_resolution: 'LATE_SUCCESS_REFUNDED',
    refunded_amount: new Prisma.Decimal('19.90'),
    refund_processing_status: 'IDLE',
    refund_progress_status: 'FULL',
    version: 6,
  });
}

describe('StorePaymentRepository late payment refund', () => {
  const repository = new StorePaymentRepository();

  it('keeps a closed order closed and converges one full refund without inventory or commission writes', async () => {
    const prepareTransaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: orderItemId }],
        [{ id: paymentIntentId }],
        [],
        [{ transaction_time: NOW }],
      ]),
      inventoryLedger: { count: vi.fn().mockResolvedValue(0) },
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue(null) },
      orderItemCommissionSnapshot: { count: vi.fn().mockResolvedValue(0) },
      paymentAttempt: { create: vi.fn().mockResolvedValue({ id: paymentAttemptId }) },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: paymentIntentId, order_id: orderId })
          .mockResolvedValueOnce(intent()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      refund: { create: vi.fn().mockResolvedValue({}), findMany: vi.fn().mockResolvedValue([]) },
      refundAttempt: { create: vi.fn().mockResolvedValue({}) },
      refundItem: { create: vi.fn().mockResolvedValue({}) },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(closedOrder()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prepared = await repository.applyPaymentCallbackInTransaction(
      prepareTransaction as unknown as DatabaseTransaction,
      callback(),
    );
    expect(prepared).toMatchObject({
      after: {
        orderPaymentResolution: 'LATE_SUCCESS_REFUND_PENDING',
        orderPaymentStatus: 'PAID',
        orderStatus: 'CLOSED',
      },
      changed: true,
      kind: 'LATE_REFUND_REQUIRED',
    });
    expect(prepared.lateRefund).not.toBeNull();
    expect(prepareTransaction.paymentAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'SUCCEEDED_LATE' }),
    });
    expect(prepareTransaction.refund.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        amount: new Prisma.Decimal('19.90'),
        is_late_payment_refund: true,
        origin_type: 'LATE_PAYMENT',
        status: 'PENDING',
      }),
    });
    expect(prepareTransaction.refundAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ attempt_no: 1, status: 'INITIATED' }),
    });
    expect(prepareTransaction).not.toHaveProperty('inventoryBalance.updateMany');
    expect(prepareTransaction).not.toHaveProperty('commissionLedger.create');

    const operation = prepared.lateRefund!;
    const claimTransaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: operation.refundId }],
        [{ id: operation.refundAttemptId }],
        [{ id: paymentIntentId }],
        [{ id: paymentAttemptId }],
        [{ transaction_time: NOW }],
      ]),
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue(intent([paymentAttempt()], {
          provider_state: 'SUCCEEDED', status: 'SUCCEEDED', succeeded_at: NOW, version: 4,
        })),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(refundRecord(operation, 'PENDING')),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      refundAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      salesOrder: { findUnique: vi.fn().mockResolvedValue(pendingOrder()) },
    };
    const claimed = await repository.claimLatePaymentRefundInTransaction(
      claimTransaction as unknown as DatabaseTransaction,
      operation,
    );
    expect(claimed).toMatchObject({ kind: 'CLAIMED', operation: { refundVersion: 2 } });
    if (claimed.kind !== 'CLAIMED') throw new Error('Expected claimed refund');

    const processingRefund = refundRecord(claimed.operation, 'PROCESSING');
    const finalizeTransaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: operation.refundId }],
        [{ id: operation.refundAttemptId }],
        [{ id: paymentIntentId }],
        [{ id: paymentAttemptId }],
        [{ id: orderItemId }],
        [{ transaction_time: NOW }],
      ]),
      orderItem: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue(intent([paymentAttempt()], {
          provider_state: 'SUCCEEDED', status: 'SUCCEEDED', succeeded_at: NOW, version: 4,
        })),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(processingRefund),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      refundAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(pendingOrder()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const finalized = await repository.finalizeLatePaymentRefundInTransaction(
      finalizeTransaction as unknown as DatabaseTransaction,
      {
        operation: claimed.operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: NOW,
          providerEventId: 'mock_re_late_refund_fixture',
          providerRefundId: 'mock_rf_late_refund_fixture',
        },
      },
    );
    expect(finalized).toMatchObject({ changed: true, kind: 'REFUNDED' });
    expect(finalizeTransaction.orderItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        pre_shipment_refunded_qty: 1,
        refunded_amount: new Prisma.Decimal('19.90'),
        refunded_qty: 1,
      }),
    }));
    expect(finalizeTransaction.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payment_resolution: 'LATE_SUCCESS_REFUNDED',
        refund_processing_status: 'IDLE',
        refund_progress_status: 'FULL',
      }),
    }));
    expect(finalizeTransaction).not.toHaveProperty('inventoryBalance.updateMany');
    expect(finalizeTransaction).not.toHaveProperty('orderAttributionSnapshot.create');
  });

  it('atomically records a failed Provider refund and routes the closed order to manual review', async () => {
    const operation = lateRefundOperation();
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: operation.refundId }],
        [{ id: operation.refundAttemptId }],
        [{ id: paymentIntentId }],
        [{ id: paymentAttemptId }],
        [{ id: orderItemId }],
        [{ transaction_time: NOW }],
      ]),
      orderItem: { updateMany: vi.fn() },
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue(intent([paymentAttempt()], {
          provider_state: 'SUCCEEDED', status: 'SUCCEEDED', succeeded_at: NOW, version: 4,
        })),
      },
      refund: {
        findUnique: vi.fn().mockResolvedValue(refundRecord(operation, 'PROCESSING')),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      refundAttempt: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(pendingOrder()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await expect(repository.finalizeLatePaymentRefundInTransaction(
      transaction as unknown as DatabaseTransaction,
      {
        operation,
        result: { failureCode: 'PROVIDER_UNAVAILABLE', kind: 'FAILED', occurredAt: null },
      },
    )).resolves.toMatchObject({
      afterRefundStatus: 'FAILED',
      changed: true,
      kind: 'MANUAL_REQUIRED',
    });
    expect(transaction.refundAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ failure_code: 'PROVIDER_UNAVAILABLE', status: 'FAILED' }),
    }));
    expect(transaction.refund.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ failure_code: 'PROVIDER_UNAVAILABLE', status: 'FAILED' }),
    }));
    expect(transaction.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payment_resolution: 'MANUAL_REQUIRED',
        refund_processing_status: 'FAILED',
      }),
    }));
    expect(transaction.orderItem.updateMany).not.toHaveBeenCalled();
  });

  it('treats stale claim and finalize operations as terminal after another worker succeeds', async () => {
    const operation = lateRefundOperation(1);
    const successfulRefund = refundRecord(operation, 'SUCCEEDED');
    const successfulIntent = intent([paymentAttempt()], {
      provider_state: 'SUCCEEDED', status: 'SUCCEEDED', succeeded_at: NOW, version: 4,
    });
    const completedOrder = terminalOrder('SUCCEEDED');
    const claimTransaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: operation.refundId }],
        [{ id: operation.refundAttemptId }],
        [{ id: paymentIntentId }],
        [{ id: paymentAttemptId }],
        [{ transaction_time: NOW }],
      ]),
      paymentIntent: { findUnique: vi.fn().mockResolvedValue(successfulIntent) },
      refund: { findUnique: vi.fn().mockResolvedValue(successfulRefund), updateMany: vi.fn() },
      refundAttempt: { updateMany: vi.fn() },
      salesOrder: { findUnique: vi.fn().mockResolvedValue(completedOrder) },
    };
    await expect(repository.claimLatePaymentRefundInTransaction(
      claimTransaction as unknown as DatabaseTransaction,
      operation,
    )).resolves.toEqual({ kind: 'TERMINAL' });
    expect(claimTransaction.refund.updateMany).not.toHaveBeenCalled();

    const finalizeTransaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: operation.refundId }],
        [{ id: operation.refundAttemptId }],
        [{ id: paymentIntentId }],
        [{ id: paymentAttemptId }],
        [{ id: orderItemId }],
        [{ transaction_time: NOW }],
      ]),
      orderItem: { updateMany: vi.fn() },
      paymentIntent: { findUnique: vi.fn().mockResolvedValue(successfulIntent) },
      refund: { findUnique: vi.fn().mockResolvedValue(successfulRefund), updateMany: vi.fn() },
      refundAttempt: { updateMany: vi.fn() },
      salesOrder: { findUnique: vi.fn().mockResolvedValue(completedOrder), updateMany: vi.fn() },
    };
    await expect(repository.finalizeLatePaymentRefundInTransaction(
      finalizeTransaction as unknown as DatabaseTransaction,
      {
        operation,
        result: {
          kind: 'SUCCEEDED',
          occurredAt: NOW,
          providerEventId: 'mock_re_late_refund_fixture',
          providerRefundId: 'mock_rf_late_refund_fixture',
        },
      },
    )).resolves.toMatchObject({ changed: false, kind: 'REPLAY' });
    expect(finalizeTransaction.refund.updateMany).not.toHaveBeenCalled();
    expect(finalizeTransaction.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('ignores an out-of-order terminal event after a late success fact', async () => {
    const successful = paymentAttempt();
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: orderItemId }],
        [{ id: paymentIntentId }],
        [{ id: paymentAttemptId }],
        [{ transaction_time: NOW }],
      ]),
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue(null) },
      paymentAttempt: { create: vi.fn() },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: paymentIntentId, order_id: orderId })
          .mockResolvedValueOnce(intent([successful], { status: 'SUCCEEDED', version: 4 })),
      },
      salesOrder: { findUnique: vi.fn().mockResolvedValue(pendingOrder()) },
    };
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback('FAILED'),
    )).resolves.toMatchObject({ changed: false, kind: 'REPLAY', paymentAttemptId });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
  });
});
