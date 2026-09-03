import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StorePaymentRepository,
  type StorePaymentCallbackInput,
} from './store-payment.repository';

const NOW = new Date('2026-08-29T10:00:00.000Z');
const PAYMENT_EXPIRY = new Date(NOW.getTime() + 20 * 60_000);
const orderId = generateUlid(NOW.getTime() - 8_000);
const intentId = generateUlid(NOW.getTime() - 7_000);
const customerId = generateUlid(NOW.getTime() - 6_000);
const productId = generateUlid(NOW.getTime() - 5_000);
const categoryId = generateUlid(NOW.getTime() - 4_000);
const skuId = generateUlid(NOW.getTime() - 3_000);
const orderItemId = generateUlid(NOW.getTime() - 2_000);
const reservationId = generateUlid(NOW.getTime() - 1_500);
const reservationItemId = generateUlid(NOW.getTime() - 1_400);
const balanceId = generateUlid(NOW.getTime() - 1_300);
const agentId = generateUlid(NOW.getTime() - 1_200);
const walletId = generateUlid(NOW.getTime() - 1_150);
const bindingId = generateUlid(NOW.getTime() - 1_100);
const ruleVersionId = generateUlid(NOW.getTime() - 1_000);
const providerIntentId = 'mock_pi_settlement_fixture';
const providerTransactionId = 'mock_tx_settlement_fixture';

function callback(overrides: Partial<StorePaymentCallbackInput> = {}): StorePaymentCallbackInput {
  return {
    amount: '19.90',
    eventType: 'payment.succeeded' as const,
    occurredAt: NOW,
    outcome: 'SUCCEEDED' as const,
    provider: 'MOCK' as const,
    providerEventId: 'mock_evt_settlement_fixture',
    providerIntentId,
    providerTransactionId,
    ...overrides,
  };
}

function intent(attempts: Array<Record<string, unknown>> = [], overrides: Record<string, unknown> = {}) {
  return {
    amount: new Prisma.Decimal('19.90'),
    attempts,
    close_attempt_count: 0,
    close_requested_at: null,
    closed_at: null,
    create_requested_at: new Date(NOW.getTime() - 60_000),
    created_at: new Date(NOW.getTime() - 60_000),
    expires_at: PAYMENT_EXPIRY,
    id: intentId,
    intent_no: `PI${intentId}`,
    last_error_code: null,
    last_reconciled_at: null,
    next_reconcile_at: new Date(NOW.getTime() + 60_000),
    opened_at: new Date(NOW.getTime() - 30_000),
    order_id: orderId,
    provider: 'MOCK',
    provider_intent_id: providerIntentId,
    provider_state: 'OPEN',
    reconciliation_attempt_count: 0,
    status: 'OPEN',
    succeeded_at: null,
    updated_at: NOW,
    version: 2,
    ...overrides,
  };
}

function successfulPaymentAttempt(overrides: Record<string, unknown> = {}) {
  return {
    amount: new Prisma.Decimal('19.90'),
    failure_code: null,
    finished_at: NOW,
    id: generateUlid(NOW.getTime() - 800),
    initiated_at: NOW,
    provider: 'MOCK',
    provider_payload: null,
    provider_transaction_id: providerTransactionId,
    status: 'SUCCEEDED',
    ...overrides,
  };
}

function orderItemFixture(overrides: Record<string, unknown> = {}) {
  return {
    aftersale_reserved_amount: new Prisma.Decimal('0.00'),
    aftersale_reserved_qty: 0,
    category_id: categoryId,
    id: orderItemId,
    line_paid_amount: new Prisma.Decimal('19.90'),
    pre_shipment_refunded_qty: 0,
    product_id: productId,
    quantity: 1,
    refunded_amount: new Prisma.Decimal('0.00'),
    refunded_qty: 0,
    shipped_qty: 0,
    sku_id: skuId,
    ...overrides,
  };
}

function order(overrides: Record<string, unknown> = {}) {
  return {
    address_snapshot: { city: 'Auckland' },
    attribution_candidate: {
      binding_id: null,
      candidate_agent_id: null,
      finalization_result: null,
      finalized_at: null,
      id: generateUlid(NOW.getTime() - 9_000),
      submit_channel: 'DIRECT',
      submitted_at: new Date(NOW.getTime() - 60_000),
    },
    attribution_snapshot: null,
    close_reason: null,
    closed_at: null,
    completed_at: null,
    completion_reason: null,
    customer: {
      id: customerId,
      nickname: 'Fixture Customer',
      phone_verifications: [],
    },
    customer_id: customerId,
    final_agent_id: null,
    final_channel: null,
    fulfillment_status: 'NOT_STARTED',
    goods_amount: new Prisma.Decimal('19.90'),
    id: orderId,
    inventory_reservation: null,
    items: [orderItemFixture()],
    order_status: 'PENDING_PAYMENT',
    paid_amount: new Prisma.Decimal('0.00'),
    paid_at: null,
    pay_expires_at: new Date(NOW.getTime() + 20 * 60_000),
    payable_amount: new Prisma.Decimal('19.90'),
    payment_resolution: 'NORMAL',
    payment_status: 'PROCESSING',
    refunded_amount: new Prisma.Decimal('0.00'),
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    shipping_amount: new Prisma.Decimal('0.00'),
    version: 3,
    ...overrides,
  };
}

function rawResults(values: unknown[]) {
  const mock = vi.fn();
  for (const value of values) mock.mockResolvedValueOnce(value);
  return mock;
}

function queryText(query: unknown): string {
  return (query as { strings?: readonly string[] }).strings?.join(' ') ?? String(query);
}

interface RuleEntryFixture {
  rate: string;
  targetId: string | null;
  targetKey: string;
  targetType: 'CATEGORY' | 'PLATFORM' | 'SKU';
}

function activeAgentOrder(overrides: Record<string, unknown> = {}) {
  return order({
    attribution_candidate: {
      binding_id: bindingId,
      candidate_agent_id: agentId,
      finalization_result: null,
      finalized_at: null,
      id: generateUlid(NOW.getTime() - 9_000),
      submit_channel: 'AGENT',
      submitted_at: new Date(NOW.getTime() - 60_000),
    },
    customer: {
      id: customerId,
      nickname: 'Fixture Customer',
      phone_verifications: [{ phone_last4: '4826' }],
    },
    inventory_reservation: {
      consumed_at: null,
      expires_at: PAYMENT_EXPIRY,
      id: reservationId,
      items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
      order_id: orderId,
      released_at: null,
      status: 'ACTIVE',
    },
    ...overrides,
  });
}

function agentSettlementHarness(
  rate: string,
  ruleEntries?: RuleEntryFixture[],
  options: {
    ruleStatus?: 'ARCHIVED' | 'PUBLISHED';
    walletRows?: Array<{ agent_id: string; id: string }>;
  } = {},
) {
  const reservation = {
    consumed_at: null,
    expires_at: PAYMENT_EXPIRY,
    id: reservationId,
    items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
    order_id: orderId,
    released_at: null,
    status: 'ACTIVE',
  };
  const transaction = {
    $queryRaw: rawResults([
      [{ id: agentId, version: 2 }],
      [{ id: orderId }],
      [{ id: orderItemId }],
      [{ id: intentId }],
      [],
      [{ id: bindingId }],
      [{ transaction_time: NOW }],
      [{ id: productId }],
      [{ id: skuId }],
      [{ id: balanceId }],
      [{ id: reservationId }],
      [{ id: reservationItemId }],
      [{ sku_id: skuId, total_quantity: 1n }],
      [{ id: ruleVersionId }],
      options.walletRows ?? [{ agent_id: agentId, id: walletId }],
    ]),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    agentCustomerPrivacyProjection: {
      create: vi.fn().mockResolvedValue({ id: 'privacy' }),
      findFirst: vi.fn().mockResolvedValue({ customer_alias: 'Existing alias' }),
    },
    agentProfile: {
      findUnique: vi.fn().mockResolvedValue({
        account: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' },
        deleted_at: null,
        id: agentId,
        status: 'ACTIVE',
        version: 2,
      }),
    },
    commissionLedger: { create: vi.fn().mockResolvedValue({ id: 'commission-ledger' }) },
    commissionRuleVersion: {
      findUnique: vi.fn().mockResolvedValue({
        created_at: NOW,
        created_by_id: agentId,
        effective_at: new Date(NOW.getTime() - 60_000),
        entries: (ruleEntries ?? [{
          rate,
          targetId: null,
          targetKey: 'PLATFORM',
          targetType: 'PLATFORM' as const,
        }]).map((entry, index) => ({
          configured_rate: new Prisma.Decimal(entry.rate),
          created_at: NOW,
          id: generateUlid(NOW.getTime() - 900 + index),
          rule_version_id: ruleVersionId,
          target_id: entry.targetId,
          target_key: entry.targetKey,
          target_type: entry.targetType,
        })),
        id: ruleVersionId,
        reason: 'Published fixture',
        status: options.ruleStatus ?? 'PUBLISHED',
        version_no: 1,
      }),
    },
    customerAgentBinding: {
      findUnique: vi.fn().mockResolvedValue({
        agent_id: agentId,
        customer_id: customerId,
        ended_at: null,
        id: bindingId,
        started_at: new Date(NOW.getTime() - 120_000),
      }),
    },
    inventoryBalance: {
      findMany: vi.fn().mockResolvedValueOnce([{ id: balanceId, sku_id: skuId }])
        .mockResolvedValueOnce([{
          id: balanceId,
          locked_qty: 1,
          physical_qty: 7,
          sku_id: skuId,
          version: 5,
        }]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    inventoryLedger: { create: vi.fn().mockResolvedValue({ id: 'inventory-ledger' }) },
    inventoryReservation: {
      findUnique: vi.fn().mockResolvedValue(reservation),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    orderAttributionCandidate: {
      findUnique: vi.fn().mockResolvedValue({ binding_id: bindingId, candidate_agent_id: agentId }),
      update: vi.fn().mockResolvedValue({ id: 'candidate' }),
    },
    orderAttributionSnapshot: { create: vi.fn().mockResolvedValue({ id: 'snapshot' }) },
    orderItemCommissionPosition: { create: vi.fn().mockResolvedValue({ id: 'position' }) },
    orderItemCommissionSnapshot: { create: vi.fn().mockResolvedValue({ id: 'commission-snapshot' }) },
    paymentAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt' }) },
    paymentIntent: {
      findUnique: vi.fn()
        .mockResolvedValueOnce({ id: intentId, order_id: orderId })
        .mockResolvedValueOnce(intent()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    salesOrder: {
      findUnique: vi.fn().mockResolvedValue(activeAgentOrder({ inventory_reservation: reservation })),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    sku: {
      findMany: vi.fn().mockResolvedValue([{
        id: skuId,
        product: { category: { id: categoryId, name: 'Current Category' }, id: productId, sales_count: 0 },
      }]),
    },
  };
  return transaction;
}

describe('StorePaymentRepository callback settlement', () => {
  const repository = new StorePaymentRepository();

  it.each([
    ['FAILED', 'payment.failed', 'PAYMENT_FAILED'],
    ['CANCELLED', 'payment.cancelled', 'PAYMENT_CANCELLED'],
  ] as const)('persists one %s attempt and returns the order to UNPAID without releasing inventory', async (
    outcome,
    eventType,
    failureCode,
  ) => {
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [],
        [{ id: intentId }],
        [],
        [{ transaction_time: NOW }],
      ]),
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue(null) },
      paymentAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt' }) },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: intentId, order_id: orderId })
          .mockResolvedValueOnce(intent()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(order()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const result = await repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      {
        ...callback(),
        eventType,
        outcome,
        providerTransactionId: null,
      },
    );
    expect(result).toMatchObject({
      after: { intentStatus: outcome, orderPaymentStatus: 'UNPAID' },
      changed: true,
      kind: 'TERMINAL',
    });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ failure_code: failureCode, status: outcome }),
    });
    expect(transaction.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ payment_status: 'UNPAID' }),
    }));
    expect(transaction).not.toHaveProperty('inventoryBalance.updateMany');
  });

  it('replays an exact terminal failure after the order has continued with a later payment', async () => {
    const failedAttempt = {
      amount: new Prisma.Decimal('19.90'),
      finished_at: NOW,
      id: generateUlid(NOW.getTime() - 500),
      provider: 'MOCK',
      provider_transaction_id: null,
      status: 'FAILED',
    };
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [],
        [{ id: intentId }],
        [{ id: failedAttempt.id }],
        [{ transaction_time: NOW }],
      ]),
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue(null) },
      paymentAttempt: { create: vi.fn() },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: intentId, order_id: orderId })
          .mockResolvedValueOnce(intent([failedAttempt], { status: 'FAILED' })),
      },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(order({
          fulfillment_status: 'READY_TO_SHIP',
          order_status: 'PENDING_SHIPMENT',
          paid_amount: new Prisma.Decimal('19.90'),
          payment_status: 'PAID',
        })),
        updateMany: vi.fn(),
      },
    };
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback({ eventType: 'payment.failed', outcome: 'FAILED', providerTransactionId: null }),
    )).resolves.toMatchObject({
      changed: false,
      kind: 'REPLAY',
      paymentAttemptId: failedAttempt.id,
    });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    expect(transaction.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['FAILED', 'payment.failed', 'PAYMENT_FAILED'],
    ['CANCELLED', 'payment.cancelled', 'PAYMENT_CANCELLED'],
  ] as const)('records the delayed %s callback fact after synchronous reconciliation reached the same terminal state', async (
    outcome,
    eventType,
    failureCode,
  ) => {
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [],
        [{ id: intentId }],
        [],
        [{ transaction_time: NOW }],
      ]),
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue(null) },
      paymentAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt' }) },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: intentId, order_id: orderId })
          .mockResolvedValueOnce(intent([], { status: outcome })),
        updateMany: vi.fn(),
      },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(order({ payment_status: 'UNPAID' })),
        updateMany: vi.fn(),
      },
    };
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback({ eventType, outcome, providerTransactionId: null }),
    )).resolves.toMatchObject({
      after: { intentStatus: outcome },
      before: { intentStatus: outcome },
      changed: true,
      kind: 'ATTEMPT_RECORDED',
    });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ failure_code: failureCode, status: outcome }),
    });
    expect(transaction.paymentIntent.updateMany).not.toHaveBeenCalled();
    expect(transaction.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('records a successful charge exactly once and enters MANUAL_REQUIRED without consuming inventory', async () => {
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [],
        [{ id: intentId }],
        [],
        [{ transaction_time: NOW }],
        [{ id: productId }],
        [{ id: skuId }],
        [],
      ]),
      agentProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      inventoryBalance: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryReservation: { findUnique: vi.fn().mockResolvedValue(null) },
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue({ candidate_agent_id: null }) },
      paymentAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt' }) },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: intentId, order_id: orderId })
          .mockResolvedValueOnce(intent()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(order()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([{
          id: skuId,
          product: { category: { id: categoryId, name: 'Category' }, id: productId, sales_count: 0 },
        }]),
      },
    };
    const result = await repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    );
    expect(result).toMatchObject({
      after: {
        intentStatus: 'SUCCEEDED',
        orderPaymentResolution: 'MANUAL_REQUIRED',
        orderPaymentStatus: 'PAID',
        orderStatus: 'PENDING_PAYMENT',
      },
      changed: true,
      kind: 'MANUAL_REQUIRED',
    });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        paid_amount: new Prisma.Decimal('19.90'),
        payment_resolution: 'MANUAL_REQUIRED',
        payment_status: 'PAID',
      }),
    }));
  });

  it('preserves a successful charge from a legacy empty order as MANUAL_REQUIRED', async () => {
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [],
        [{ id: intentId }],
        [],
        [{ transaction_time: NOW }],
      ]),
      agentProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      inventoryBalance: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryReservation: { findUnique: vi.fn().mockResolvedValue(null) },
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue({ candidate_agent_id: null }) },
      paymentAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt' }) },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: intentId, order_id: orderId })
          .mockResolvedValueOnce(intent()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      product: { updateMany: vi.fn() },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(order({ items: [] })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      sku: { findMany: vi.fn() },
    };
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ changed: true, kind: 'MANUAL_REQUIRED' });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.paymentIntent.updateMany).toHaveBeenCalledTimes(1);
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.sku.findMany).not.toHaveBeenCalled();
  });

  it('settles a direct payment by consuming the reservation and deducting physical and locked stock once', async () => {
    const reservation = {
      consumed_at: null,
      expires_at: PAYMENT_EXPIRY,
      id: reservationId,
      items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
      order_id: orderId,
      released_at: null,
      status: 'ACTIVE',
    };
    const balance = {
      id: balanceId,
      locked_qty: 1,
      physical_qty: 7,
      sku_id: skuId,
      version: 5,
    };
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [{ id: orderItemId }],
        [{ id: intentId }],
        [],
        [{ transaction_time: NOW }],
        [{ id: productId }],
        [{ id: skuId }],
        [{ id: balanceId }],
        [{ id: reservationId }],
        [{ id: reservationItemId }],
        [{ sku_id: skuId, total_quantity: 1n }],
      ]),
      agentCustomerPrivacyProjection: { create: vi.fn(), findFirst: vi.fn() },
      agentProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      commissionLedger: { create: vi.fn() },
      inventoryBalance: {
        findMany: vi.fn().mockResolvedValueOnce([{ id: balanceId, sku_id: skuId }])
          .mockResolvedValueOnce([balance]),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      inventoryLedger: { create: vi.fn().mockResolvedValue({ id: 'ledger' }) },
      inventoryReservation: {
        findUnique: vi.fn().mockResolvedValue(reservation),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      orderAttributionCandidate: {
        findUnique: vi.fn().mockResolvedValue({ candidate_agent_id: null }),
        update: vi.fn().mockResolvedValue({ id: 'candidate' }),
      },
      orderAttributionSnapshot: { create: vi.fn().mockResolvedValue({ id: 'snapshot' }) },
      orderItemCommissionPosition: { create: vi.fn() },
      orderItemCommissionSnapshot: { create: vi.fn() },
      paymentAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt' }) },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: intentId, order_id: orderId })
          .mockResolvedValueOnce(intent()),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      product: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(order({ inventory_reservation: reservation })),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([{
          id: skuId,
          product: { category: { id: categoryId, name: 'Category' }, id: productId, sales_count: 0 },
        }]),
      },
    };
    const result = await repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    );
    expect(result).toMatchObject({
      after: {
        intentStatus: 'SUCCEEDED',
        orderPaymentResolution: 'NORMAL',
        orderPaymentStatus: 'PAID',
        orderStatus: 'PENDING_SHIPMENT',
      },
      changed: true,
      commissionLedgerIds: [],
      commissionSnapshotIds: [],
      finalAgentId: null,
      finalChannel: 'DIRECT',
      kind: 'SETTLED',
      reservationId,
    });
    expect(transaction.inventoryBalance.updateMany).toHaveBeenCalledWith({
      data: {
        locked_qty: 0,
        physical_qty: 6,
        updated_at: NOW,
        version: { increment: 1 },
      },
      where: {
        id: balanceId,
        locked_qty: 1,
        physical_qty: 7,
        sku_id: skuId,
        version: 5,
      },
    });
    expect(transaction.inventoryLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        business_id: reservationId,
        ledger_type: 'ORDER_PAID_DEDUCT',
        locked_change: -1,
        physical_change: -1,
      }),
    });
    expect(transaction.inventoryReservation.updateMany).toHaveBeenCalledWith({
      data: { consumed_at: NOW, status: 'CONSUMED' },
      where: { id: reservationId, order_id: orderId, status: 'ACTIVE' },
    });
    expect(transaction.salesOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        fulfillment_status: 'READY_TO_SHIP',
        order_status: 'PENDING_SHIPMENT',
        payment_status: 'PAID',
      }),
    }));
    expect(transaction.orderItemCommissionSnapshot.create).not.toHaveBeenCalled();
    expect(transaction.agentCustomerPrivacyProjection.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'order item totals no longer close',
      orderOverrides: { goods_amount: new Prisma.Decimal('19.89') },
    },
    {
      label: 'the refund axes have moved',
      orderOverrides: {
        refunded_amount: new Prisma.Decimal('1.00'),
        refund_processing_status: 'REFUNDING',
        refund_progress_status: 'PARTIAL',
      },
    },
  ])('records success but requires manual resolution when $label', async ({ orderOverrides }) => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.salesOrder.findUnique.mockResolvedValue(activeAgentOrder(orderOverrides));
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({
      after: { orderPaymentResolution: 'MANUAL_REQUIRED', orderStatus: 'PENDING_PAYMENT' },
      changed: true,
      kind: 'MANUAL_REQUIRED',
    });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(transaction.orderAttributionSnapshot.create).not.toHaveBeenCalled();
  });

  it.each([
    { itemOverrides: { refunded_qty: 1 }, label: 'an item refunded quantity exists' },
    { itemOverrides: { pre_shipment_refunded_qty: 1 }, label: 'an item pre-shipment refund exists' },
    {
      itemOverrides: { refunded_amount: new Prisma.Decimal('0.01') },
      label: 'an item refunded amount exists',
    },
    { itemOverrides: { aftersale_reserved_qty: 1 }, label: 'an aftersale quantity is reserved' },
    {
      itemOverrides: { aftersale_reserved_amount: new Prisma.Decimal('0.01') },
      label: 'an aftersale amount is reserved',
    },
    { itemOverrides: { shipped_qty: 1 }, label: 'an item has shipped' },
  ])('keeps inventory locked and requires manual resolution when $label', async ({ itemOverrides }) => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.salesOrder.findUnique.mockResolvedValue(activeAgentOrder({
      items: [orderItemFixture(itemOverrides)],
    }));
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ changed: true, kind: 'MANUAL_REQUIRED' });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(transaction.inventoryReservation.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'consumed', reservationOverrides: { consumed_at: NOW } },
    { label: 'released', reservationOverrides: { released_at: NOW } },
  ])('requires manual resolution when an ACTIVE reservation is already $label', async ({ reservationOverrides }) => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.inventoryReservation.findUnique.mockResolvedValue({
      consumed_at: null,
      expires_at: PAYMENT_EXPIRY,
      id: reservationId,
      items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
      order_id: orderId,
      released_at: null,
      status: 'ACTIVE',
      ...reservationOverrides,
    });
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ changed: true, kind: 'MANUAL_REQUIRED' });
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(transaction.inventoryReservation.updateMany).not.toHaveBeenCalled();
  });

  it('requires manual resolution when a fresh success sees a pre-existing paid timestamp', async () => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.salesOrder.findUnique.mockResolvedValue(activeAgentOrder({
      paid_at: new Date(NOW.getTime() - 1),
    }));
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ changed: true, kind: 'MANUAL_REQUIRED' });
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
  });

  it('records success but requires manual resolution when payment expiries do not close', async () => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.paymentIntent.findUnique.mockReset()
      .mockResolvedValueOnce({ id: intentId, order_id: orderId })
      .mockResolvedValueOnce(intent([], { expires_at: new Date(PAYMENT_EXPIRY.getTime() + 1) }));
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ changed: true, kind: 'MANUAL_REQUIRED' });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
  });

  it('stops at an explicit SKU 0% rule before category and platform fallbacks', async () => {
    const transaction = agentSettlementHarness('0.0000', [
      { rate: '0.0000', targetId: skuId, targetKey: `SKU:${skuId}`, targetType: 'SKU' },
      { rate: '6.0000', targetId: categoryId, targetKey: `CATEGORY:${categoryId}`, targetType: 'CATEGORY' },
      { rate: '10.0000', targetId: null, targetKey: 'PLATFORM', targetType: 'PLATFORM' },
    ]);
    const result = await repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    );
    expect(result).toMatchObject({
      commissionLedgerIds: [],
      finalAgentId: agentId,
      finalChannel: 'AGENT',
      kind: 'SETTLED',
    });
    expect(result.commissionSnapshotIds).toHaveLength(1);
    expect(transaction.orderItemCommissionSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        category_id_snapshot: categoryId,
        category_name_snapshot: 'Current Category',
        effective_rate: new Prisma.Decimal('0.0000'),
        original_commission: new Prisma.Decimal('0.00'),
        source_type: 'SKU',
      }),
    });
    expect(transaction.orderItemCommissionPosition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expected_remaining: new Prisma.Decimal('0.00'), state: 'NONE' }),
    });
    expect(transaction.commissionLedger.create).not.toHaveBeenCalled();
    expect(transaction.$queryRawUnsafe.mock.calls.map((call) => call.slice(1))).toEqual([
      ['store-attribution-agent', JSON.stringify([agentId])],
      ['commission-rule-config', JSON.stringify(['singleton'])],
      ['agent-wallet', JSON.stringify([agentId])],
    ]);
    expect(transaction.agentCustomerPrivacyProjection.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        city: 'Auckland',
        customer_alias: 'Existing alias',
        phone_tail: '4826',
      }),
    });
  });

  it('prefers the current product category over platform and applies HALF_UP commission', async () => {
    const transaction = agentSettlementHarness('10.0000', [
      { rate: '10.0000', targetId: categoryId, targetKey: `CATEGORY:${categoryId}`, targetType: 'CATEGORY' },
      { rate: '5.0000', targetId: null, targetKey: 'PLATFORM', targetType: 'PLATFORM' },
    ]);
    transaction.agentCustomerPrivacyProjection.findFirst.mockResolvedValue(null);
    const result = await repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    );
    expect(result).toMatchObject({ finalAgentId: agentId, finalChannel: 'AGENT', kind: 'SETTLED' });
    expect(result.commissionLedgerIds).toHaveLength(1);
    expect(transaction.orderItemCommissionSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ source_type: 'CATEGORY' }),
    });
    expect(transaction.orderItemCommissionPosition.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ expected_remaining: new Prisma.Decimal('1.99'), state: 'EXPECTED' }),
    });
    expect(transaction.commissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        expected_change: new Prisma.Decimal('1.99'),
        ledger_type: 'EXPECTED_CREATED',
      }),
    });
    const projection = transaction.agentCustomerPrivacyProjection.create.mock.calls[0]?.[0].data;
    expect(projection.customer_alias).toMatch(/^customer_[a-z0-9]{26}$/);
    expect(projection.customer_alias).not.toContain(customerId.slice(-8).toLowerCase());
  });

  it('falls back to PLATFORM when no SKU or current category rule exists', async () => {
    const transaction = agentSettlementHarness('4.0000');
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ finalAgentId: agentId, kind: 'SETTLED' });
    expect(transaction.orderItemCommissionSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        effective_rate: new Prisma.Decimal('4.0000'),
        source_type: 'PLATFORM',
      }),
    });
  });

  it('downgrades to DIRECT when the candidate agent is disabled after intent creation', async () => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.agentProfile.findUnique.mockResolvedValue({
      account: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' },
      deleted_at: null,
      id: agentId,
      status: 'DISABLED',
      version: 2,
    });
    const result = await repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    );
    expect(result).toMatchObject({
      commissionLedgerIds: [],
      commissionSnapshotIds: [],
      finalAgentId: null,
      finalChannel: 'DIRECT',
      kind: 'SETTLED',
    });
    expect(transaction.commissionRuleVersion.findUnique).not.toHaveBeenCalled();
    expect(transaction.orderItemCommissionSnapshot.create).not.toHaveBeenCalled();
    expect(transaction.agentCustomerPrivacyProjection.create).not.toHaveBeenCalled();
  });

  it('records Provider success as MANUAL_REQUIRED when the active Agent wallet is missing', async () => {
    const transaction = agentSettlementHarness('10.0000', undefined, { walletRows: [] });

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({
      after: { orderPaymentResolution: 'MANUAL_REQUIRED', orderPaymentStatus: 'PAID' },
      changed: true,
      kind: 'MANUAL_REQUIRED',
    });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(transaction.orderItemCommissionSnapshot.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'pre-finalized attribution',
      overrides: {
        attribution_candidate: {
          binding_id: bindingId,
          candidate_agent_id: agentId,
          finalization_result: 'AGENT_CONFIRMED',
          finalized_at: NOW,
          id: generateUlid(NOW.getTime() - 9_000),
          submit_channel: 'AGENT',
          submitted_at: new Date(NOW.getTime() - 60_000),
        },
        attribution_snapshot: { id: generateUlid(NOW.getTime() - 700) },
      },
    },
    {
      label: 'multiple current phone facts',
      overrides: {
        customer: {
          id: customerId,
          nickname: 'Fixture Customer',
          phone_verifications: [{ phone_last4: '4826' }, { phone_last4: '7391' }],
        },
      },
    },
    {
      label: 'missing frozen address',
      overrides: { address_snapshot: null },
    },
  ])('records success as MANUAL_REQUIRED before inventory writes for $label', async ({ overrides }) => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.salesOrder.findUnique.mockReset().mockResolvedValue(order({
      attribution_candidate: {
        binding_id: bindingId,
        candidate_agent_id: agentId,
        finalization_result: null,
        finalized_at: null,
        id: generateUlid(NOW.getTime() - 9_000),
        submit_channel: 'AGENT',
        submitted_at: new Date(NOW.getTime() - 60_000),
      },
      customer: {
        id: customerId,
        nickname: 'Fixture Customer',
        phone_verifications: [{ phone_last4: '4826' }],
      },
      inventory_reservation: {
        expires_at: PAYMENT_EXPIRY,
        id: reservationId,
        items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
        order_id: orderId,
        status: 'ACTIVE',
      },
      ...overrides,
    }));

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({
      after: { orderPaymentResolution: 'MANUAL_REQUIRED', orderStatus: 'PENDING_PAYMENT' },
      changed: true,
      kind: 'MANUAL_REQUIRED',
    });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(transaction.orderAttributionSnapshot.create).not.toHaveBeenCalled();
    expect(transaction.agentCustomerPrivacyProjection.create).not.toHaveBeenCalled();
  });

  it('saturates the rebuildable product sales counter without suppressing payment settlement', async () => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.sku.findMany.mockResolvedValue([{
      id: skuId,
      product: {
        category: { id: categoryId, name: 'Current Category' },
        id: productId,
        sales_count: 2_147_483_647,
      },
    }]);

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ changed: true, kind: 'SETTLED' });
    expect(transaction.product.updateMany).toHaveBeenCalledWith({
      data: { sales_count: 2_147_483_647, updated_at: NOW },
      where: { id: productId, sales_count: 2_147_483_647 },
    });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryBalance.updateMany).toHaveBeenCalledTimes(1);
  });

  it('retries the callback transaction when the locked sales counter row is unexpectedly lost', async () => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.product.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['at', 20 * 60_000],
    ['after', 20 * 60_000 + 1],
  ] as const)('rejects a successful Provider event occurring %s the payment deadline', async (_label, offset) => {
    const transaction = agentSettlementHarness('10.0000');
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback({ occurredAt: new Date(NOW.getTime() + offset) }),
    )).rejects.toMatchObject({ code: 'PAYMENT_RESULT_CONFLICT' });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
  });

  it('settles when Provider succeeded before expiry even if Worker processes the event later', async () => {
    const transaction = agentSettlementHarness('10.0000', undefined, { ruleStatus: 'ARCHIVED' });
    const deadline = new Date(NOW.getTime() - 1_000);
    transaction.paymentIntent.findUnique.mockReset()
      .mockResolvedValueOnce({ id: intentId, order_id: orderId })
      .mockResolvedValueOnce(intent([], { expires_at: deadline }));
    transaction.inventoryReservation.findUnique.mockResolvedValue({
      consumed_at: null,
      expires_at: deadline,
      id: reservationId,
      items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
      order_id: orderId,
      released_at: null,
      status: 'ACTIVE',
    });
    transaction.salesOrder.findUnique.mockReset().mockResolvedValue(order({
      attribution_candidate: {
        binding_id: bindingId,
        candidate_agent_id: agentId,
        finalization_result: null,
        finalized_at: null,
        id: generateUlid(NOW.getTime() - 9_000),
        submit_channel: 'AGENT',
        submitted_at: new Date(NOW.getTime() - 60_000),
      },
      inventory_reservation: {
        expires_at: deadline,
        id: reservationId,
        items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
        order_id: orderId,
        status: 'ACTIVE',
      },
      pay_expires_at: deadline,
    }));

    const occurredAt = new Date(NOW.getTime() - 2_000);
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback({ occurredAt }),
    )).resolves.toMatchObject({ kind: 'SETTLED' });
    expect(transaction.paymentAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ finished_at: occurredAt, status: 'SUCCEEDED' }),
    });
    expect(transaction.orderItemCommissionSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        effective_rate: new Prisma.Decimal('10.0000'),
        rule_version_id: ruleVersionId,
      }),
    });
    const ruleLock = transaction.$queryRaw.mock.calls
      .map((call) => call[0])
      .find((query) => queryText(query).includes('FROM public.commission_rule_version')) as
      { strings: readonly string[]; values: readonly unknown[] } | undefined;
    expect(queryText(ruleLock)).toContain("status IN ('PUBLISHED', 'ARCHIVED')");
    expect(ruleLock?.values).toContainEqual(occurredAt);
  });

  it.each([
    { label: 'a missing candidate binding', mutate: 'NULL' },
    { label: 'a binding owned by another agent', mutate: 'MISMATCH' },
  ] as const)('keeps a successful payment in MANUAL_REQUIRED for $label', async ({ mutate }) => {
    const transaction = agentSettlementHarness('10.0000');
    if (mutate === 'NULL') {
      transaction.salesOrder.findUnique.mockReset().mockResolvedValue(order({
        attribution_candidate: {
          binding_id: null,
          candidate_agent_id: agentId,
          finalization_result: null,
          finalized_at: null,
          id: generateUlid(NOW.getTime() - 9_000),
          submit_channel: 'AGENT',
          submitted_at: new Date(NOW.getTime() - 60_000),
        },
        inventory_reservation: {
          expires_at: PAYMENT_EXPIRY,
          id: reservationId,
          items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
          order_id: orderId,
          status: 'ACTIVE',
        },
      }));
    } else {
      transaction.customerAgentBinding.findUnique.mockResolvedValue({
        agent_id: generateUlid(NOW.getTime() - 500),
        customer_id: customerId,
        ended_at: null,
        id: bindingId,
        started_at: new Date(NOW.getTime() - 120_000),
      });
    }

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({
      after: { orderPaymentResolution: 'MANUAL_REQUIRED' },
      changed: true,
      kind: 'MANUAL_REQUIRED',
    });
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(transaction.orderAttributionSnapshot.create).not.toHaveBeenCalled();
  });

  it('honors the submitted binding when it ended only after order submission', async () => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.customerAgentBinding.findUnique.mockResolvedValue({
      agent_id: agentId,
      customer_id: customerId,
      ended_at: new Date(NOW.getTime() - 30_000),
      id: bindingId,
      started_at: new Date(NOW.getTime() - 120_000),
    });

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ finalAgentId: agentId, finalChannel: 'AGENT', kind: 'SETTLED' });
    expect(transaction.orderAttributionSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ binding_id_snapshot: bindingId, final_channel: 'AGENT' }),
    });
  });

  it('compensates MANUAL_REQUIRED without duplicating the attempt or incrementing sales again', async () => {
    const successfulAttempt = successfulPaymentAttempt();
    const retryAt = new Date(NOW.getTime() + 60_000);
    const transaction = agentSettlementHarness('10.0000', undefined, { ruleStatus: 'ARCHIVED' });
    transaction.paymentIntent.findUnique.mockReset()
      .mockResolvedValueOnce({ id: intentId, order_id: orderId })
      .mockResolvedValueOnce(intent([successfulAttempt], {
        next_reconcile_at: null,
        provider_state: 'SUCCEEDED',
        status: 'SUCCEEDED',
        succeeded_at: NOW,
        version: 3,
      }));
    transaction.salesOrder.findUnique.mockResolvedValue(order({
      attribution_candidate: {
        binding_id: bindingId,
        candidate_agent_id: agentId,
        finalization_result: null,
        finalized_at: null,
        id: generateUlid(NOW.getTime() - 9_000),
        submit_channel: 'AGENT',
        submitted_at: new Date(NOW.getTime() - 60_000),
      },
      inventory_reservation: {
        expires_at: PAYMENT_EXPIRY,
        id: reservationId,
        items: [{ id: reservationItemId, quantity: 1, sku_id: skuId }],
        order_id: orderId,
        status: 'ACTIVE',
      },
      paid_amount: new Prisma.Decimal('19.90'),
      paid_at: NOW,
      payment_resolution: 'MANUAL_REQUIRED',
      payment_status: 'PAID',
      version: 4,
    }));
    transaction.sku.findMany.mockResolvedValue([{
      id: skuId,
      product: {
        category: { id: categoryId, name: 'Current Category' },
        id: productId,
        sales_count: 2_147_483_647,
      },
    }]);

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback({ occurredAt: retryAt }),
    )).resolves.toMatchObject({
      after: { orderPaymentResolution: 'NORMAL', orderStatus: 'PENDING_SHIPMENT', orderVersion: 5 },
      changed: true,
      kind: 'SETTLED',
      paymentAttemptId: successfulAttempt.id,
    });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    expect(transaction.paymentIntent.updateMany).not.toHaveBeenCalled();
    expect(transaction.product.updateMany).toHaveBeenCalledWith({
      data: { sales_count: 2_147_483_647, updated_at: NOW },
      where: { id: productId, sales_count: 2_147_483_647 },
    });
    expect(transaction.inventoryLedger.create).toHaveBeenCalledTimes(1);
    expect(transaction.commissionLedger.create).toHaveBeenCalledTimes(1);
    expect(transaction.inventoryReservation.updateMany).toHaveBeenCalledWith({
      data: { consumed_at: NOW, status: 'CONSUMED' },
      where: { id: reservationId, order_id: orderId, status: 'ACTIVE' },
    });
    expect(transaction.orderItemCommissionSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ rule_version_id: ruleVersionId }),
    });
    const ruleLock = transaction.$queryRaw.mock.calls
      .map((call) => call[0])
      .find((query) => queryText(query).includes('FROM public.commission_rule_version')) as
      { values: readonly unknown[] } | undefined;
    expect(ruleLock?.values).toContainEqual(NOW);
    expect(ruleLock?.values).not.toContainEqual(retryAt);
  });

  it('replays an exact success after fulfillment and refund state have advanced', async () => {
    const successfulAttempt = successfulPaymentAttempt({ id: generateUlid(NOW.getTime() - 750) });
    const transaction = agentSettlementHarness('10.0000');
    transaction.paymentIntent.findUnique.mockReset()
      .mockResolvedValueOnce({ id: intentId, order_id: orderId })
      .mockResolvedValueOnce(intent([successfulAttempt], {
        next_reconcile_at: null,
        provider_state: 'SUCCEEDED',
        status: 'SUCCEEDED',
        succeeded_at: NOW,
        version: 3,
      }));
    transaction.salesOrder.findUnique.mockResolvedValue(activeAgentOrder({
      completed_at: NOW,
      completion_reason: 'CUSTOMER_CONFIRMED',
      fulfillment_status: 'DELIVERED',
      order_status: 'COMPLETED',
      paid_amount: new Prisma.Decimal('19.90'),
      paid_at: NOW,
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refunded_amount: new Prisma.Decimal('19.90'),
      refund_progress_status: 'FULL',
    }));

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({
      changed: false,
      kind: 'REPLAY',
      paymentAttemptId: successfulAttempt.id,
    });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    {
      attemptOverrides: { initiated_at: null },
      label: 'missing initiation time',
    },
    {
      attemptOverrides: { initiated_at: new Date(NOW.getTime() - 1) },
      label: 'initiation and completion times differ',
    },
    {
      attemptOverrides: { failure_code: 'LEGACY_SUCCESS_ERROR' },
      label: 'success carries a failure code',
    },
    {
      attemptOverrides: { provider_payload: { raw: 'legacy-provider-payload' } },
      label: 'success retains a Provider payload',
    },
    {
      attemptOverrides: { finished_at: null },
      label: 'success has no completion time',
    },
    {
      intentOverrides: { provider_state: 'OPEN' },
      label: 'intent Provider state is not successful',
    },
    {
      intentOverrides: { succeeded_at: null },
      label: 'intent has no success time',
    },
    {
      intentOverrides: { succeeded_at: new Date(NOW.getTime() + 1) },
      label: 'intent and attempt success times differ',
    },
    {
      intentOverrides: { last_error_code: 'LEGACY_PROVIDER_ERROR' },
      label: 'successful intent retains an error',
    },
    {
      intentOverrides: { next_reconcile_at: new Date(NOW.getTime() + 60_000) },
      label: 'successful intent remains scheduled for reconciliation',
    },
    {
      callbackOverrides: {
        eventType: 'payment.failed' as const,
        outcome: 'FAILED' as const,
        providerTransactionId: null,
      },
      attemptOverrides: { provider_payload: { raw: 'legacy-provider-payload' } },
      label: 'a later terminal callback observes malformed success history',
    },
  ])('fails closed before writes when $label', async ({
    attemptOverrides = {},
    callbackOverrides = {},
    intentOverrides = {},
  }) => {
    const transaction = agentSettlementHarness('10.0000');
    transaction.paymentIntent.findUnique.mockReset()
      .mockResolvedValueOnce({ id: intentId, order_id: orderId })
      .mockResolvedValueOnce(intent([successfulPaymentAttempt(attemptOverrides)], {
        next_reconcile_at: null,
        provider_state: 'SUCCEEDED',
        status: 'SUCCEEDED',
        succeeded_at: NOW,
        version: 3,
        ...intentOverrides,
      }));
    transaction.salesOrder.findUnique.mockResolvedValue(activeAgentOrder({
      paid_amount: new Prisma.Decimal('19.90'),
      paid_at: NOW,
      payment_resolution: 'MANUAL_REQUIRED',
      payment_status: 'PAID',
      version: 4,
    }));

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(callbackOverrides),
    )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    expect(transaction.paymentIntent.updateMany).not.toHaveBeenCalled();
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.inventoryBalance.updateMany).not.toHaveBeenCalled();
    expect(transaction.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('retries a still-blocked manual settlement without duplicating attempt or sales count', async () => {
    const successfulAttempt = successfulPaymentAttempt({ id: generateUlid(NOW.getTime() - 1_000) });
    const transaction = {
      $queryRaw: rawResults([
        [{ id: orderId }],
        [],
        [{ id: intentId }],
        [],
        [{ transaction_time: NOW }],
        [{ id: productId }],
        [{ id: skuId }],
        [],
      ]),
      agentProfile: { findUnique: vi.fn().mockResolvedValue(null) },
      inventoryBalance: { findMany: vi.fn().mockResolvedValue([]) },
      inventoryReservation: { findUnique: vi.fn().mockResolvedValue(null) },
      orderAttributionCandidate: { findUnique: vi.fn().mockResolvedValue({ candidate_agent_id: null }) },
      paymentAttempt: { create: vi.fn() },
      paymentIntent: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: intentId, order_id: orderId })
          .mockResolvedValueOnce(intent([successfulAttempt], {
            next_reconcile_at: null,
            provider_state: 'SUCCEEDED',
            status: 'SUCCEEDED',
            succeeded_at: NOW,
            version: 3,
          })),
        updateMany: vi.fn(),
      },
      product: { updateMany: vi.fn() },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(order({
          paid_amount: new Prisma.Decimal('19.90'),
          paid_at: NOW,
          payment_resolution: 'MANUAL_REQUIRED',
          payment_status: 'PAID',
          version: 4,
        })),
        updateMany: vi.fn(),
      },
      sku: {
        findMany: vi.fn().mockResolvedValue([{
          id: skuId,
          product: { category: { id: categoryId, name: 'Category' }, id: productId, sales_count: 0 },
        }]),
      },
    };
    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({
      after: { orderPaymentResolution: 'MANUAL_REQUIRED' },
      changed: false,
      kind: 'REPLAY',
    });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    expect(transaction.paymentIntent.updateMany).not.toHaveBeenCalled();
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('replays a still-blocked manual settlement when catalog data remains incomplete', async () => {
    const successfulAttempt = successfulPaymentAttempt({ id: generateUlid(NOW.getTime() - 950) });
    const transaction = agentSettlementHarness('10.0000');
    transaction.paymentIntent.findUnique.mockReset()
      .mockResolvedValueOnce({ id: intentId, order_id: orderId })
      .mockResolvedValueOnce(intent([successfulAttempt], {
        next_reconcile_at: null,
        provider_state: 'SUCCEEDED',
        status: 'SUCCEEDED',
        succeeded_at: NOW,
        version: 3,
      }));
    transaction.salesOrder.findUnique.mockResolvedValue(activeAgentOrder({
      paid_amount: new Prisma.Decimal('19.90'),
      paid_at: NOW,
      payment_resolution: 'MANUAL_REQUIRED',
      payment_status: 'PAID',
      version: 4,
    }));
    transaction.sku.findMany.mockResolvedValue([]);

    await expect(repository.applyPaymentCallbackInTransaction(
      transaction as unknown as DatabaseTransaction,
      callback(),
    )).resolves.toMatchObject({ changed: false, kind: 'REPLAY' });
    expect(transaction.paymentAttempt.create).not.toHaveBeenCalled();
    expect(transaction.paymentIntent.updateMany).not.toHaveBeenCalled();
    expect(transaction.product.updateMany).not.toHaveBeenCalled();
    expect(transaction.salesOrder.updateMany).not.toHaveBeenCalled();
  });
});
