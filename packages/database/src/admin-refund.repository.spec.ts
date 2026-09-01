import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import {
  AdminRefundRepository,
  type AdminRefundProviderOperation,
} from './admin-refund.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-09-01T12:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const actorId = id(-20_000);
const customerId = id(-19_000);
const orderId = id(-18_000);
const orderItemId = id(-17_000);
const productId = id(-16_000);
const skuId = id(-15_000);
const aftersaleId = id(-14_000);
const aftersaleItemId = id(-13_000);
const refundId = id(-12_000);
const attemptId = id(-11_000);
const oldAttemptId = id(-10_000);
const paymentIntentId = id(-9_000);
const paymentAttemptId = id(-8_000);

function sqlText(query: unknown): string {
  return (query as { strings?: readonly string[] }).strings?.join('?') ?? '';
}

function refundHeader(
  status: 'FAILED' | 'PROCESSING' | 'SUCCEEDED',
  providerRefundId = status === 'PROCESSING' ? null : 'mock_refund_fixture',
) {
  return {
    aftersale_id: aftersaleId,
    aftersale_status: status === 'FAILED' ? 'REFUND_FAILED' : status === 'SUCCEEDED' ? 'COMPLETED' : 'REFUNDING',
    aftersale_type: 'REFUND_ONLY',
    aftersale_version: 4,
    amount: new Prisma.Decimal('25.00'),
    customer_id: customerId,
    failure_code: status === 'FAILED' ? 'PROVIDER_UNAVAILABLE' : null,
    failed_at: status === 'FAILED' ? NOW : null,
    id: refundId,
    is_late_payment_refund: false,
    manual_compensation_id: null,
    manual_compensation_status: null,
    manual_compensation_version: null,
    order_id: orderId,
    origin_type: 'AFTERSALE',
    provider: 'MOCK',
    provider_refund_id: providerRefundId,
    refund_no: `RF${refundId}`,
    status,
    succeeded_at: status === 'SUCCEEDED' ? NOW : null,
    version: 3,
  };
}

function orderRow() {
  return {
    close_reason: null,
    closed_at: null,
    completed_at: null,
    completion_reason: null,
    customer_id: customerId,
    fulfillment_status: 'READY_TO_SHIP',
    id: orderId,
    order_status: 'PENDING_SHIPMENT',
    paid_amount: new Prisma.Decimal('25.00'),
    payment_resolution: 'NORMAL',
    payment_status: 'PAID',
    refund_processing_status: 'REFUNDING',
    refund_progress_status: 'NONE',
    refunded_amount: new Prisma.Decimal('0.00'),
    version: 7,
  };
}

function attempt(
  targetId: string,
  attemptNo: number,
  status: 'FAILED' | 'PROCESSING' | 'SUCCEEDED',
) {
  return {
    attempt_no: attemptNo,
    failure_code: status === 'FAILED' ? 'PROVIDER_FAILED' : null,
    finished_at: status === 'PROCESSING' ? null : NOW,
    id: targetId,
    idempotency_key: `fixture-attempt-${attemptNo}`,
    provider: 'MOCK',
    provider_request_id: status === 'PROCESSING' ? null : `mock_event_${attemptNo}`,
    refund_id: refundId,
    status,
  };
}

function transactionHarness(input: {
  attempts: ReturnType<typeof attempt>[];
  providerRefundId?: string;
  refundStatus: 'FAILED' | 'PROCESSING' | 'SUCCEEDED';
}) {
  const queryRaw = vi.fn(async (query: unknown) => {
    const text = sqlText(query);
    if (text.includes('FROM public.account')) return [{
      deleted_at: null,
      has_password: true,
      id: actorId,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
    }];
    if (text.includes('FROM public.refund AS refund') && text.includes('order_row')) {
      return [refundHeader(input.refundStatus, input.providerRefundId)];
    }
    if (text.includes('FROM public.refund_attempt') && text.includes('attempt_no')) return input.attempts;
    if (text.includes('FROM public.payment_intent AS intent') && text.includes("attempt.status = 'SUCCEEDED'")) {
      return [{
        amount: new Prisma.Decimal('25.00'),
        payment_attempt_id: paymentAttemptId,
        payment_intent_id: paymentIntentId,
        provider: 'MOCK',
        provider_intent_id: 'mock_intent_fixture',
        provider_transaction_id: 'mock_transaction_fixture',
      }];
    }
    if (text.includes('SELECT id, customer_id, order_status::text')) return [orderRow()];
    if (text.includes('SELECT id FROM public.sales_order') && text.includes('FOR UPDATE')) return [{ id: orderId }];
    if (text.includes('SELECT DISTINCT snapshot.agent_id')) return [];
    if (text.includes('transaction_timestamp')) return [{ transaction_time: NOW }];
    return [];
  });
  const transaction = {
    $queryRaw: queryRaw,
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    commissionLedger: { findMany: vi.fn(async () => []) },
    inventoryLedger: { findMany: vi.fn(async () => []) },
    refundAttempt: { create: vi.fn() },
  };
  return {
    queryRaw,
    transaction: transaction as unknown as DatabaseTransaction,
    transactionStub: transaction,
  };
}

function operation(overrides: Partial<AdminRefundProviderOperation> = {}): AdminRefundProviderOperation {
  return {
    amount: '25.00',
    attemptId,
    attemptNo: 1,
    orderId,
    originType: 'AFTERSALE',
    provider: 'MOCK',
    providerIntentId: 'mock_intent_fixture',
    providerRefundId: null,
    providerTransactionId: 'mock_transaction_fixture',
    refundId,
    refundNo: `RF${refundId}`,
    refundVersion: 3,
    ...overrides,
  };
}

describe('AdminRefundRepository', () => {
  it.each([
    ['SUCCEEDED' as const, 'SUCCEEDED' as const],
    ['FAILED' as const, 'FAILED' as const],
  ])('reclaims the latest %s attempt so a crash-gap can reach finalize replay', async (refundStatus, attemptStatus) => {
    const harness = transactionHarness({
      attempts: [attempt(attemptId, 1, attemptStatus)],
      refundStatus,
    });
    const repository = new AdminRefundRepository({} as PrismaClient);

    await expect(repository.claimRefundAttemptInTransaction(harness.transaction, {
      refundAttemptId: attemptId,
      refundId,
    })).resolves.toMatchObject({
      attemptId,
      attemptNo: 1,
      providerRefundId: 'mock_refund_fixture',
      refundId,
      refundVersion: 3,
    });
  });

  it('rejects an old terminal attempt after a newer retry attempt exists', async () => {
    const harness = transactionHarness({
      attempts: [attempt(oldAttemptId, 1, 'FAILED'), attempt(attemptId, 2, 'PROCESSING')],
      providerRefundId: 'mock_refund_fixture',
      refundStatus: 'PROCESSING',
    });
    const repository = new AdminRefundRepository({} as PrismaClient);

    await expect(repository.claimRefundAttemptInTransaction(harness.transaction, {
      refundAttemptId: oldAttemptId,
      refundId,
    })).rejects.toMatchObject({ code: 'PAYMENT_RESULT_CONFLICT' });
  });

  it('keeps UNKNOWN results in PROCESSING without changing business facts', async () => {
    const harness = transactionHarness({
      attempts: [attempt(attemptId, 1, 'PROCESSING')],
      refundStatus: 'PROCESSING',
    });
    const repository = new AdminRefundRepository({} as PrismaClient);

    await expect(repository.finalizeRefundAttemptInTransaction(harness.transaction, {
      operation: operation(),
      result: { kind: 'UNKNOWN' },
    })).resolves.toMatchObject({
      afterOrderVersion: 7,
      afterRefundStatus: 'PROCESSING',
      afterRefundVersion: 3,
      changed: false,
      commissionLedgerIds: [],
      inventoryLedgerFacts: [],
      kind: 'PROCESSING',
    });
  });

  it('absorbs only an exact terminal callback for a historical attempt', async () => {
    const harness = transactionHarness({
      attempts: [attempt(oldAttemptId, 1, 'FAILED'), attempt(attemptId, 2, 'PROCESSING')],
      providerRefundId: 'mock_refund_fixture',
      refundStatus: 'PROCESSING',
    });
    const repository = new AdminRefundRepository({} as PrismaClient);
    const input = {
      amount: '25.00',
      attemptNo: 1,
      outcome: 'FAILED' as const,
      providerEventId: 'mock_event_1',
      providerRefundId: 'mock_refund_fixture',
      refundAttemptId: oldAttemptId,
      refundId,
      refundNo: `RF${refundId}`,
    };

    await expect(repository.isHistoricalRefundAttemptReplayInTransaction(harness.transaction, input))
      .resolves.toBe(true);
    await expect(repository.isHistoricalRefundAttemptReplayInTransaction(harness.transaction, {
      ...input,
      providerEventId: 'mock_event_conflict',
    })).rejects.toMatchObject({ code: 'PAYMENT_RESULT_CONFLICT' });
  });

  it('rejects a retry attempt key already used by the stable refund before inserting', async () => {
    const harness = transactionHarness({
      attempts: [attempt(attemptId, 1, 'FAILED')],
      refundStatus: 'FAILED',
    });
    const repository = new AdminRefundRepository({} as PrismaClient);

    await expect(repository.prepareRetryRefundInTransaction(harness.transaction, {
      actorAccountId: actorId,
      attemptIdempotencyKey: 'fixture-attempt-1',
      expectedVersion: 3,
      reason: 'retry the failed refund',
      refundId,
    }, { verifyPreview: vi.fn() })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(harness.transactionStub.refundAttempt.create).not.toHaveBeenCalled();
  });

  it('requires an aftersale refund request to exactly cover every remaining frozen item', async () => {
    const line = {
      aftersale_item_id: aftersaleItemId,
      aftersale_refunded_amount: new Prisma.Decimal('0.00'),
      aftersale_refunded_qty: 0,
      aftersale_reserved_amount: new Prisma.Decimal('25.00'),
      aftersale_reserved_qty: 2,
      approved_refund_qty: null,
      committed_commission_reversal: new Prisma.Decimal('0.00'),
      committed_refund_amount: new Prisma.Decimal('0.00'),
      commission_available_at: null,
      commission_base: null,
      commission_effective_rate: null,
      commission_expected_remaining: null,
      commission_original: null,
      commission_position_id: null,
      commission_position_state: null,
      commission_position_version: null,
      commission_reversed_total: null,
      commission_snapshot_agent_id: null,
      commission_snapshot_id: null,
      damaged_qty: null,
      inspection_resolution: null,
      inspection_status: null,
      inventory_balance_id: id(-7_000),
      inventory_locked_qty: 0,
      inventory_physical_qty: 3,
      inventory_version: 2,
      line_paid_amount: new Prisma.Decimal('25.00'),
      order_id: orderId,
      order_item_aftersale_reserved_amount: new Prisma.Decimal('25.00'),
      order_item_aftersale_reserved_qty: 2,
      order_item_id: orderItemId,
      order_item_pre_shipment_refunded_qty: 0,
      order_item_refunded_amount: new Prisma.Decimal('0.00'),
      order_item_refunded_qty: 0,
      order_item_shipped_qty: 0,
      order_item_version: 4,
      product_id: productId,
      product_sales_count: 2,
      product_version: 3,
      quantity: 2,
      restock_qty: null,
      return_to_customer_qty: null,
      scrap_qty: null,
      sku_id: skuId,
      unit_price: new Prisma.Decimal('12.50'),
      wallet_available_balance: null,
      wallet_frozen_balance: null,
      wallet_id: null,
      wallet_version: null,
    };
    const transaction = {
      $queryRaw: vi.fn(async (query: unknown) => {
        const text = sqlText(query);
        if (text.includes('FROM public.account')) return [{
          deleted_at: null, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE',
        }];
        if (text.includes('FROM public.aftersale AS a') && text.includes('refund_id')) return [{
          customer_id: customerId,
          id: aftersaleId,
          order_id: orderId,
          refund_id: null,
          status: 'REFUNDING',
          type: 'REFUND_ONLY',
          version: 3,
        }];
        if (text.includes('SELECT id, customer_id, order_status::text')) return [orderRow()];
        if (text.includes('FROM public.payment_intent AS intent')) return [{
          amount: new Prisma.Decimal('25.00'),
          payment_attempt_id: paymentAttemptId,
          payment_intent_id: paymentIntentId,
          provider: 'MOCK',
          provider_intent_id: 'mock_intent_fixture',
          provider_transaction_id: 'mock_transaction_fixture',
        }];
        if (text.includes('FROM public.aftersale_item AS ai')) return [line];
        throw new Error(`Unexpected SQL: ${text}`);
      }),
    };
    const repository = new AdminRefundRepository({} as PrismaClient);

    await expect(repository.previewAftersaleRefundInTransaction(
      transaction as unknown as DatabaseTransaction,
      {
        actorAccountId: actorId,
        aftersaleId,
        items: [{ aftersaleItemId, quantity: 1 }],
        reason: 'fixture refund',
      },
    )).rejects.toMatchObject({ code: 'AFTERSALE_QUOTA_EXCEEDED' });
  });

  it('prices an abnormal returned-goods refund from the approved quantity instead of the original reservation', async () => {
    const line = {
      aftersale_item_id: aftersaleItemId,
      aftersale_refunded_amount: new Prisma.Decimal('0.00'),
      aftersale_refunded_qty: 0,
      aftersale_reserved_amount: new Prisma.Decimal('25.00'),
      aftersale_reserved_qty: 2,
      approved_refund_qty: 1,
      committed_commission_reversal: new Prisma.Decimal('0.00'),
      committed_refund_amount: new Prisma.Decimal('0.00'),
      commission_available_at: null,
      commission_base: null,
      commission_effective_rate: null,
      commission_expected_remaining: null,
      commission_original: null,
      commission_position_id: null,
      commission_position_state: null,
      commission_position_version: null,
      commission_reversed_total: null,
      commission_snapshot_agent_id: null,
      commission_snapshot_id: null,
      damaged_qty: 0,
      inspection_resolution: 'CONTINUE_REFUND',
      inspection_status: 'ABNORMAL',
      inventory_balance_id: id(-7_000),
      inventory_locked_qty: 0,
      inventory_physical_qty: 3,
      inventory_version: 2,
      line_paid_amount: new Prisma.Decimal('25.00'),
      order_id: orderId,
      order_item_aftersale_reserved_amount: new Prisma.Decimal('12.50'),
      order_item_aftersale_reserved_qty: 1,
      order_item_id: orderItemId,
      order_item_pre_shipment_refunded_qty: 0,
      order_item_refunded_amount: new Prisma.Decimal('0.00'),
      order_item_refunded_qty: 0,
      order_item_shipped_qty: 2,
      order_item_version: 5,
      product_id: productId,
      product_sales_count: 2,
      product_version: 3,
      quantity: 2,
      restock_qty: 1,
      return_to_customer_qty: 1,
      scrap_qty: 0,
      sku_id: skuId,
      unit_price: new Prisma.Decimal('12.50'),
      wallet_available_balance: null,
      wallet_frozen_balance: null,
      wallet_id: null,
      wallet_version: null,
    };
    const transaction = {
      $queryRaw: vi.fn(async (query: unknown) => {
        const text = sqlText(query);
        if (text.includes('FROM public.account')) return [{
          deleted_at: null, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE',
        }];
        if (text.includes('FROM public.aftersale AS a') && text.includes('refund_id')) return [{
          customer_id: customerId,
          id: aftersaleId,
          order_id: orderId,
          refund_id: null,
          status: 'REFUNDING_AFTER_RETURN',
          type: 'RETURN_REFUND',
          version: 5,
        }];
        if (text.includes('SELECT id, customer_id, order_status::text')) return [orderRow()];
        if (text.includes('FROM public.payment_intent AS intent')) return [{
          amount: new Prisma.Decimal('25.00'),
          payment_attempt_id: paymentAttemptId,
          payment_intent_id: paymentIntentId,
          provider: 'MOCK',
          provider_intent_id: 'mock_intent_fixture',
          provider_transaction_id: 'mock_transaction_fixture',
        }];
        if (text.includes('FROM public.aftersale_item AS ai')) return [line];
        throw new Error(`Unexpected SQL: ${text}`);
      }),
    };
    const repository = new AdminRefundRepository({} as PrismaClient);

    await expect(repository.previewAftersaleRefundInTransaction(
      transaction as unknown as DatabaseTransaction,
      {
        actorAccountId: actorId,
        aftersaleId,
        items: [{ aftersaleItemId, quantity: 1 }],
        reason: 'refund the approved returned quantity',
      },
    )).resolves.toMatchObject({
      affectedCount: 1,
      amount: '12.50',
      items: [{
        aftersaleItemId,
        amount: '12.50',
        autoRestock: false,
        commissionReversal: '0.00',
        inventoryRestockQuantity: 1,
        orderItemId,
        quantity: 1,
        skuId,
      }],
      resourceVersion: 5,
    });
  });
});
