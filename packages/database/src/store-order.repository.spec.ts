import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { StoreCheckoutRepository, type StoreCheckoutQuoteSnapshot } from './store-checkout.repository';
import { StoreOrderRepository } from './store-order.repository';

const NOW = new Date('2026-08-28T12:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const accountId = id(-30_000);
const customerId = id(-29_000);
const addressId = id(-28_000);
const cartId = id(-27_000);
const bindingId = id(-26_000);
const agentId = id(-25_000);
const brandId = id(-24_000);
const categoryId = id(-23_000);
const productId = id(-22_000);
const secondProductId = id(-21_000);
const skuId = id(-20_000);
const secondSkuId = id(-19_000);
const balanceId = id(-18_000);
const secondBalanceId = id(-17_000);
const imageId = id(-16_000);
const imageFileId = id(-15_000);

function activeAccount() {
  return {
    customer_profile: {
      account_id: accountId,
      anonymized_at: null,
      id: customerId,
    },
    deleted_at: null,
    login_name: null,
    password_hash: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    wechat_open_id: 'openid-b92-order',
  };
}

function activeBinding() {
  return {
    agent: {
      account: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' },
      deleted_at: null,
      id: agentId,
      status: 'ACTIVE',
    },
    agent_id: agentId,
    id: bindingId,
  };
}

function quoteSnapshot(source: 'BUY_NOW' | 'CART' = 'CART'): StoreCheckoutQuoteSnapshot {
  const items = [
    {
      availableStock: 8,
      brandId,
      brandName: 'Order Brand',
      brandVersion: 2,
      categoryId,
      categoryName: 'Order Category',
      categoryVersion: 3,
      inventoryBalanceId: balanceId,
      inventoryVersion: 6,
      lineAmount: '39.80',
      lockedQty: 2,
      physicalQty: 10,
      primaryImageFileId: imageFileId,
      primaryImageId: imageId,
      primaryImageObjectKey: `public/${imageFileId}`,
      productId,
      productName: 'Order Product',
      productVersion: 4,
      quantity: 2,
      saleable: true,
      skuCode: 'ORDER-SKU-A',
      skuId,
      skuName: 'Order SKU A',
      skuVersion: 5,
      specification: { size: '500ml' },
      unitPrice: '19.90',
    },
    {
      availableStock: 4,
      brandId,
      brandName: 'Order Brand',
      brandVersion: 2,
      categoryId,
      categoryName: 'Order Category',
      categoryVersion: 3,
      inventoryBalanceId: secondBalanceId,
      inventoryVersion: 7,
      lineAmount: '5.25',
      lockedQty: 1,
      physicalQty: 5,
      primaryImageFileId: imageFileId,
      primaryImageId: imageId,
      primaryImageObjectKey: `public/${imageFileId}`,
      productId: secondProductId,
      productName: 'Second Order Product',
      productVersion: 4,
      quantity: 1,
      saleable: true,
      skuCode: 'ORDER-SKU-B',
      skuId: secondSkuId,
      skuName: 'Order SKU B',
      skuVersion: 5,
      specification: null,
      unitPrice: '5.25',
    },
  ].sort((left, right) => left.skuId < right.skuId ? -1 : left.skuId > right.skuId ? 1 : 0);
  const chosen = source === 'BUY_NOW' ? [items[0]!] : items;
  const goodsAmount = source === 'BUY_NOW' ? chosen[0]!.lineAmount : '45.05';
  return {
    address: {
      addressId,
      city: 'Auckland',
      customerId,
      detailCiphertext: Buffer.from('address-detail-source'),
      district: 'Central',
      encryptionKeyId: 'field-current',
      isDefault: true,
      phoneCiphertext: Buffer.from('address-phone-source'),
      phoneHash: 'a'.repeat(64),
      phoneLast4: '6789',
      province: 'Auckland',
      recipientName: 'Order Recipient',
      version: 3,
    },
    blockers: [],
    canSubmit: true,
    cart: {
      cartId: source === 'CART' ? cartId : null,
      selectedItems: chosen.map(({ quantity, skuId: selectedSkuId }) => ({
        quantity,
        skuId: selectedSkuId,
      })),
      selectionMatches: true,
    },
    goodsAmount,
    items: chosen,
    payableAmount: goodsAmount,
    shippingAmount: '0.00',
    source,
  };
}

function orderRecord(
  orderId: string,
  orderWrite: Record<string, unknown>,
  itemWrites: Record<string, unknown>[],
) {
  return {
    aftersale_expires_at: null,
    business_rule_version_id: null,
    close_reason: null,
    closed_at: null,
    completed_at: null,
    completion_reason: null,
    created_at: orderWrite.created_at,
    customer_id: customerId,
    final_agent_id: null,
    final_channel: null,
    fulfillment_status: 'NOT_STARTED',
    goods_amount: orderWrite.goods_amount,
    id: orderId,
    items: itemWrites,
    order_no: `QX${orderId}`,
    order_status: 'PENDING_PAYMENT',
    paid_amount: new Prisma.Decimal(0),
    paid_at: null,
    pay_expires_at: orderWrite.pay_expires_at,
    payable_amount: orderWrite.payable_amount,
    payment_resolution: 'NORMAL',
    payment_status: 'UNPAID',
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    refunded_amount: new Prisma.Decimal(0),
    shipping_amount: new Prisma.Decimal(0),
    source: orderWrite.source,
    updated_at: orderWrite.updated_at,
    version: 1,
  };
}

function closeOrderRecord(overrides: Record<string, unknown> = {}) {
  const closeOrderId = id(-8_000);
  const closeItemId = id(-7_000);
  const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1_000);
  return {
    _count: { aftersales: 0 },
    aftersale_expires_at: null,
    aftersales: [],
    business_rule_version_id: null,
    close_reason: null,
    closed_at: null,
    completed_at: null,
    completion_reason: null,
    created_at: new Date(NOW.getTime() - 60_000),
    customer_id: customerId,
    final_agent_id: null,
    final_channel: null,
    fulfillment_status: 'NOT_STARTED',
    goods_amount: new Prisma.Decimal('19.90'),
    id: closeOrderId,
    inventory_reservation: { id: id(-6_000), status: 'ACTIVE' },
    items: [{
      aftersale_reserved_amount: new Prisma.Decimal('0.00'),
      aftersale_reserved_qty: 0,
      brand_name_snapshot: 'Close Brand',
      category_id: categoryId,
      category_name_snapshot: 'Close Category',
      created_at: new Date(NOW.getTime() - 50_000),
      id: closeItemId,
      line_paid_amount: new Prisma.Decimal('19.90'),
      pre_shipment_refunded_qty: 0,
      product_id: productId,
      product_name_snapshot: 'Close Product',
      quantity: 1,
      refunded_amount: new Prisma.Decimal('0.00'),
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: 'CLOSE-SKU',
      sku_id: skuId,
      sku_name_snapshot: 'Close SKU',
      unit_price: new Prisma.Decimal('19.90'),
      version: 1,
    }],
    order_no: `QX${closeOrderId}`,
    order_status: 'PENDING_PAYMENT',
    paid_amount: new Prisma.Decimal('0.00'),
    paid_at: null,
    pay_expires_at: expiresAt,
    payable_amount: new Prisma.Decimal('19.90'),
    payment_intents: [],
    payment_resolution: 'NORMAL',
    payment_status: 'UNPAID',
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    refunded_amount: new Prisma.Decimal('0.00'),
    shipping_amount: new Prisma.Decimal('0.00'),
    source: 'BUY_NOW',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function paidOwnedOrderDetailRecord(overrides: Record<string, unknown> = {}) {
  const aftersaleId = id(-4_500);
  const addressSnapshotId = id(-4_400);
  const record = closeOrderRecord({
    address_snapshot: {
      city: 'Auckland',
      detail_ciphertext: Buffer.from('protected-detail'),
      district: 'Central',
      encryption_key_id: 'field-current',
      id: addressSnapshotId,
      phone_ciphertext: Buffer.from('protected-phone'),
      phone_last4: '6789',
      province: 'Auckland',
      recipient_name: 'Order Recipient',
    },
    aftersales: [{
      aftersale_no: `AS${aftersaleId}`,
      created_at: new Date(NOW.getTime() - 30_000),
      id: aftersaleId,
      items: [{ requested_amount: new Prisma.Decimal('9.95') }],
      status: 'PENDING_REVIEW',
      type: 'REFUND_ONLY',
    }],
    fulfillment_status: 'READY_TO_SHIP',
    order_status: 'PENDING_SHIPMENT',
    paid_amount: new Prisma.Decimal('19.90'),
    paid_at: new Date(NOW.getTime() - 60_000),
    payment_status: 'PAID',
    refunds: [],
  });
  return { ...record, ...overrides };
}

function closeIntentRecord(orderId: string, overrides: Record<string, unknown> = {}) {
  const intentId = id(-5_000);
  return {
    amount: new Prisma.Decimal('19.90'),
    close_attempt_count: 0,
    close_requested_at: null,
    closed_at: null,
    expires_at: new Date(NOW.getTime() + 30 * 60 * 1_000),
    id: intentId,
    intent_no: `PI${intentId}`,
    last_error_code: null,
    next_reconcile_at: null,
    order_id: orderId,
    provider: 'MOCK',
    provider_intent_id: 'mock-close-intent',
    provider_state: 'OPEN',
    reconciliation_attempt_count: 0,
    status: 'OPEN',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function harness(options: {
  catalogDrift?: boolean;
  catalogMissingAfterLock?: boolean;
  inactiveAgent?: boolean;
  inventoryUpdateCount?: number;
} = {}) {
  const locks: Array<{ namespace: string; parts: string[] }> = [];
  let skuReadCount = 0;
  let orderWrite: Record<string, unknown> = {};
  let itemWrites: Record<string, unknown>[] = [];
  const initialBinding = { agent_id: agentId, id: bindingId };
  const lockedBinding = activeBinding();
  if (options.inactiveAgent) lockedBinding.agent.status = 'INACTIVE';
  const transactionStub = {
    $queryRaw: vi.fn().mockResolvedValue([{ transaction_time: NOW }]),
    $queryRawUnsafe: vi.fn(async (_query: string, ...values: unknown[]) => {
      if (values.length === 2) {
        locks.push({ namespace: String(values[0]), parts: JSON.parse(String(values[1])) as string[] });
      } else {
        const encoded = JSON.parse(String(values[0])) as Array<{ namespace: string; parts: string }>;
        locks.push(...encoded.map((entry) => ({
          namespace: entry.namespace,
          parts: JSON.parse(entry.parts) as string[],
        })));
      }
      return [{ acquired: 1 }];
    }),
    account: { findUnique: vi.fn().mockResolvedValue(activeAccount()) },
    cart: {
      findUnique: vi.fn().mockResolvedValue({ id: cartId }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    cartItem: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
      findMany: vi.fn().mockResolvedValue([
        { sku_id: skuId },
        { sku_id: secondSkuId },
      ].sort((left, right) => left.sku_id < right.sku_id ? -1 : left.sku_id > right.sku_id ? 1 : 0)),
    },
    customerAgentBinding: {
      findMany: vi.fn()
        .mockResolvedValueOnce([initialBinding])
        .mockResolvedValueOnce([lockedBinding]),
    },
    inventoryBalance: {
      updateMany: vi.fn().mockResolvedValue({ count: options.inventoryUpdateCount ?? 1 }),
    },
    inventoryLedger: { createMany: vi.fn().mockImplementation(async ({ data }) => ({ count: data.length })) },
    inventoryReservation: { create: vi.fn().mockResolvedValue({}) },
    inventoryReservationItem: {
      createMany: vi.fn().mockImplementation(async ({ data }) => ({ count: data.length })),
    },
    orderAddressSnapshot: { create: vi.fn().mockResolvedValue({}) },
    orderAttributionCandidate: { create: vi.fn().mockResolvedValue({}) },
    orderItem: {
      createMany: vi.fn().mockImplementation(async ({ data }) => {
        itemWrites = data;
        return { count: data.length };
      }),
    },
    salesOrder: {
      create: vi.fn().mockImplementation(async ({ data }) => {
        orderWrite = data;
        return { id: data.id };
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }) =>
        orderRecord(where.id, orderWrite, itemWrites)),
    },
    sku: {
      findMany: vi.fn().mockImplementation(async ({ where }) => {
        skuReadCount += 1;
        const requestedSkuIds = where.id.in as string[];
        return [
          {
            id: skuId,
            inventory_balance: { id: balanceId },
            product: { brand_id: brandId, category_id: categoryId, id: productId },
            product_id: productId,
          },
          {
            id: secondSkuId,
            inventory_balance: {
              id: options.catalogDrift && skuReadCount === 2 ? id(-10_000) : secondBalanceId,
            },
            product: { brand_id: brandId, category_id: categoryId, id: secondProductId },
            product_id: secondProductId,
          },
        ].filter(({ id: candidateId }) => requestedSkuIds.includes(candidateId) &&
          !(options.catalogMissingAfterLock && skuReadCount === 2 && candidateId === secondSkuId));
      }),
    },
  };
  return {
    locks,
    repository: new StoreOrderRepository({} as PrismaClient),
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

function cartInput() {
  return {
    accountId,
    addressId,
    customerId,
    items: [
      { quantity: 2, skuId },
      { quantity: 1, skuId: secondSkuId },
    ],
    source: 'CART' as const,
  };
}

function hooks() {
  return {
    protectAddress: vi.fn(() => ({
      detailCiphertext: Buffer.from('protected-order-detail'),
      encryptionKeyId: 'field-current',
      phoneCiphertext: Buffer.from('protected-order-phone'),
      phoneLast4: '6789',
    })),
    verifyQuote: vi.fn(),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('StoreOrderRepository', () => {
  it.each([
    ['PENDING_SHIPMENT before completion', {}, true],
    ['SHIPPING before completion', { fulfillment_status: 'SHIPPED', order_status: 'SHIPPING' }, true],
    ['COMPLETED inside aftersale window', {
      aftersale_expires_at: new Date(NOW.getTime() + 1_000),
      completed_at: new Date(NOW.getTime() - 1_000),
      fulfillment_status: 'DELIVERED',
      order_status: 'COMPLETED',
    }, true],
    ['COMPLETED after aftersale window', {
      aftersale_expires_at: new Date(NOW.getTime() - 1),
      completed_at: new Date(NOW.getTime() - 2_000),
      fulfillment_status: 'DELIVERED',
      order_status: 'COMPLETED',
    }, false],
    ['PENDING_SHIPMENT with a completion timestamp', { completed_at: NOW }, false],
    ['SHIPPING with a completion timestamp', {
      completed_at: NOW,
      fulfillment_status: 'SHIPPED',
      order_status: 'SHIPPING',
    }, false],
    ['COMPLETED without a completion timestamp', {
      aftersale_expires_at: new Date(NOW.getTime() + 1_000),
      fulfillment_status: 'DELIVERED',
      order_status: 'COMPLETED',
    }, false],
    ['CLOSED order', { order_status: 'CLOSED' }, false],
    ['non-normal payment resolution', { payment_resolution: 'MANUAL_REQUIRED' }, false],
  ] as const)('projects APPLY_AFTERSALE eligibility for %s', async (_label, overrides, expected) => {
    const record = paidOwnedOrderDetailRecord(overrides);
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ transaction_time: NOW }]),
      salesOrder: { findFirst: vi.fn().mockResolvedValue(record) },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);

    await expect(repository.getOwnedOrderDetailInTransaction(transaction, {
      customerId,
      orderId: record.id,
    })).resolves.toMatchObject({
      aftersales: [{
        aftersaleId: record.aftersales[0]!.id,
        requestedAmount: '9.95',
        status: 'PENDING_REVIEW',
        type: 'REFUND_ONLY',
      }],
      canApplyAftersale: expected,
    });
  });

  it('does not expose APPLY_AFTERSALE when every order item has exhausted quantity or amount', async () => {
    const base = paidOwnedOrderDetailRecord();
    const record = paidOwnedOrderDetailRecord({
      items: base.items.map((item) => ({
        ...item,
        aftersale_reserved_amount: item.line_paid_amount,
        aftersale_reserved_qty: item.quantity,
      })),
    });
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ transaction_time: NOW }]),
      salesOrder: { findFirst: vi.fn().mockResolvedValue(record) },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);

    await expect(repository.getOwnedOrderDetailInTransaction(transaction, {
      customerId,
      orderId: record.id,
    })).resolves.toMatchObject({ canApplyAftersale: false });
  });

  it('queries only customer aftersales in the frozen detail order and excludes all terminal states from active count',
    async () => {
      const record = paidOwnedOrderDetailRecord();
      const findFirst = vi.fn().mockResolvedValue(record);
      const transaction = {
        $queryRaw: vi.fn().mockResolvedValue([{ transaction_time: NOW }]),
        salesOrder: { findFirst },
      } as unknown as DatabaseTransaction;
      const repository = new StoreOrderRepository({} as PrismaClient);

      await repository.getOwnedOrderDetailInTransaction(transaction, {
        customerId,
        orderId: record.id,
      });

      const query = findFirst.mock.calls[0]?.[0] as {
        include: {
          _count: { select: { aftersales: { where: unknown } } };
          aftersales: { orderBy: unknown; where: unknown };
        };
      };
      expect(query.include.aftersales).toMatchObject({
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        where: { type: { in: ['REFUND_ONLY', 'RETURN_REFUND'] } },
      });
      expect(query.include._count.select.aftersales.where).toEqual({
        status: { notIn: ['CANCELLED', 'COMPLETED', 'REJECTED', 'REJECTED_AFTER_RETURN'] },
        type: { in: ['REFUND_ONLY', 'RETURN_REFUND'] },
      });
    });

  it('finds timeout integrity violations with one bounded read-only statement', async () => {
    const orderId = id(-14_000);
    const secondOrderId = id(-13_000);
    const firstExpiry = new Date('2026-08-29T00:01:00.000Z');
    const secondExpiry = new Date('2026-08-29T00:02:00.000Z');
    const queryRaw = vi.fn().mockResolvedValue([
      { issue_code: 'ORDER_RESERVATION_ITEMS_MISMATCH', order_id: orderId, pay_expires_at: firstExpiry },
      { issue_code: 'INVENTORY_BALANCE_INVALID', order_id: secondOrderId, pay_expires_at: secondExpiry },
    ]);
    const transaction = { $queryRaw: queryRaw } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);

    await expect(repository.listExpiredOrderIntegrityIssues(transaction, { limit: 20 })).resolves.toEqual([
      { issue: 'ORDER_RESERVATION_ITEMS_MISMATCH', orderId, payExpiresAt: firstExpiry },
      { issue: 'INVENTORY_BALANCE_INVALID', orderId: secondOrderId, payExpiresAt: secondExpiry },
    ]);

    const query = queryRaw.mock.calls[0]![0] as { strings: readonly string[]; values: readonly unknown[] };
    const statement = query.strings.join('?');
    expect(statement).toContain("so.order_status = 'PENDING_PAYMENT'");
    expect(statement).toContain('so.pay_expires_at <= transaction_timestamp()');
    expect(statement).toContain('IS DISTINCT FROM');
    expect(statement).toContain('LEFT JOIN public.inventory_balance');
    expect(statement).toContain('SUM(active_iri.quantity)');
    expect(statement).toContain("active_ir.status = 'ACTIVE' AND active_iri.sku_id = iri.sku_id");
    expect(statement).toContain('ib.locked_qty <>');
    expect(statement.indexOf('LIMIT ?')).toBeLessThan(statement.indexOf('WHERE issue_code IS NOT NULL'));
    expect(statement).not.toMatch(/\b(?:DELETE|INSERT|UPDATE)\b/i);
    expect(query.values).toEqual([20]);
  });

  it('rejects invalid timeout integrity scan bounds and malformed database rows', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      {
        issue_code: 'CUSTOMER_PRIVATE_FACT',
        order_id: id(-14_000),
        pay_expires_at: new Date('2026-08-29T00:01:00.000Z'),
      },
    ]);
    const transaction = { $queryRaw: queryRaw } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);

    await expect(repository.listExpiredOrderIntegrityIssues(transaction, { limit: 0 }))
      .rejects.toThrow('scan limit must be between 1 and 100');
    expect(queryRaw).not.toHaveBeenCalled();
    await expect(repository.listExpiredOrderIntegrityIssues(transaction, { limit: 1 }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('requires each balance to cover every ACTIVE reservation for the SKU before timeout claiming', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = { $queryRaw: queryRaw } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);

    await expect(repository.expireNextOrderInTransaction(transaction)).resolves.toEqual({ kind: 'none' });

    const query = queryRaw.mock.calls[0]![0] as { strings: readonly string[] };
    const statement = query.strings.join('?');
    expect(statement).toContain('SUM(active_iri.quantity)');
    expect(statement).toContain("active_ir.status = 'ACTIVE' AND active_iri.sku_id = iri.sku_id");
    expect(statement).not.toContain('ib.locked_qty < iri.quantity');
  });

  it('pages every expired candidate with a stable cursor, including clean orders', async () => {
    const firstOrderId = id(-12_000);
    const secondOrderId = id(-11_000);
    const thirdOrderId = id(-10_000);
    const firstExpiry = new Date('2026-08-29T00:01:00.000Z');
    const secondExpiry = new Date('2026-08-29T00:02:00.000Z');
    const thirdExpiry = new Date('2026-08-29T00:03:00.000Z');
    const queryRaw = vi.fn().mockResolvedValue([
      { order_id: firstOrderId, pay_expires_at: firstExpiry },
      { order_id: secondOrderId, pay_expires_at: secondExpiry },
      { order_id: thirdOrderId, pay_expires_at: thirdExpiry },
    ]);
    const transaction = { $queryRaw: queryRaw } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);

    await expect(repository.listExpiredOrderCandidates(transaction, { limit: 2 })).resolves.toEqual({
      items: [
        { orderId: firstOrderId, payExpiresAt: firstExpiry },
        { orderId: secondOrderId, payExpiresAt: secondExpiry },
      ],
      nextCursor: { orderId: secondOrderId, payExpiresAt: secondExpiry },
    });
    const query = queryRaw.mock.calls[0]![0] as { strings: readonly string[]; values: readonly unknown[] };
    const statement = query.strings.join('?');
    expect(statement).toContain("so.payment_status IN ('UNPAID', 'PROCESSING')");
    expect(statement).toContain('ORDER BY so.pay_expires_at ASC, so.id ASC');
    expect(statement).not.toContain('WHERE issue_code IS NOT NULL');
    expect(statement).not.toMatch(/\b(?:DELETE|INSERT|UPDATE)\b/i);
    expect(query.values).toEqual([3]);
  });

  it('rejects malformed timeout candidate rows and cursor bounds', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { order_id: id(-12_000), pay_expires_at: new Date('invalid') },
    ]);
    const transaction = { $queryRaw: queryRaw } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    await expect(repository.listExpiredOrderCandidates(transaction, { limit: 0 }))
      .rejects.toThrow('candidate limit must be between 1 and 100');
    expect(queryRaw).not.toHaveBeenCalled();
    await expect(repository.listExpiredOrderCandidates(transaction, { limit: 1 }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('claims an active OPEN payment intent without touching the reservation', async () => {
    const record = closeOrderRecord();
    const intent = closeIntentRecord(record.id);
    const transactionStub = {
      paymentIntent: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValueOnce(record).mockResolvedValueOnce({
          ...record,
          payment_intents: [{ id: intent.id }],
        }),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    const internals = repository as unknown as {
      acquireCustomerLocks: ReturnType<typeof vi.fn>;
      lockCloseOrderRows: ReturnType<typeof vi.fn>;
      lockPaymentIntents: ReturnType<typeof vi.fn>;
      paymentIntentHasSuccessfulAttempt: ReturnType<typeof vi.fn>;
      transactionTime: ReturnType<typeof vi.fn>;
    };
    internals.acquireCustomerLocks = vi.fn().mockResolvedValue(undefined);
    internals.lockCloseOrderRows = vi.fn().mockResolvedValue(undefined);
    internals.lockPaymentIntents = vi.fn().mockResolvedValue([intent]);
    internals.paymentIntentHasSuccessfulAttempt = vi.fn().mockResolvedValue(false);
    internals.transactionTime = vi.fn().mockResolvedValue(NOW);
    // Assigning through the structural view lets this test isolate the
    // transaction orchestration without weakening production visibility.
    const result = await repository.claimOrderCloseInTransaction(transactionStub, {
      accountId,
      customerId,
      expectedVersion: 1,
      mode: 'USER_CANCELLED',
      orderId: record.id,
    });
    expect(result).toMatchObject({
      changed: true,
      kind: 'PROVIDER_REQUIRED',
      mode: 'USER_CANCELLED',
      paymentIntent: {
        paymentIntentId: intent.id,
        status: 'CLOSE_PENDING',
        version: 2,
      },
      providerOperation: 'CLOSE',
    });
    expect(transactionStub.paymentIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        next_reconcile_at: new Date(NOW.getTime() + 60_000),
        status: 'CLOSE_PENDING',
        version: { increment: 1 },
      }),
      where: { id: intent.id, order_id: record.id, version: 1 },
    }));
  });

  it('continues a pre-expiry user cancellation after the order has expired', async () => {
    const expiresAt = new Date(NOW.getTime() - 30 * 60 * 1_000);
    const closeRequestedAt = new Date(expiresAt.getTime() - 1_000);
    const record = closeOrderRecord({ pay_expires_at: expiresAt });
    const intent = closeIntentRecord(record.id, {
      close_requested_at: closeRequestedAt,
      expires_at: expiresAt,
      status: 'CLOSE_PENDING',
      version: 2,
    });
    const transactionStub = {
      salesOrder: { findUnique: vi.fn().mockResolvedValue(record) },
      paymentIntent: { updateMany: vi.fn() },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    const internals = repository as unknown as {
      acquireCustomerLocks: ReturnType<typeof vi.fn>;
      lockCloseOrderRows: ReturnType<typeof vi.fn>;
      lockPaymentIntents: ReturnType<typeof vi.fn>;
      paymentIntentHasSuccessfulAttempt: ReturnType<typeof vi.fn>;
      transactionTime: ReturnType<typeof vi.fn>;
    };
    internals.acquireCustomerLocks = vi.fn().mockResolvedValue(undefined);
    internals.lockCloseOrderRows = vi.fn().mockResolvedValue(undefined);
    internals.lockPaymentIntents = vi.fn().mockResolvedValue([intent]);
    internals.paymentIntentHasSuccessfulAttempt = vi.fn().mockResolvedValue(false);
    internals.transactionTime = vi.fn().mockResolvedValue(NOW);

    await expect(repository.claimOrderCloseInTransaction(transactionStub, {
      accountId,
      customerId,
      expectedVersion: record.version,
      mode: 'USER_CANCELLED',
      orderId: record.id,
    })).resolves.toMatchObject({
      changed: false,
      kind: 'PENDING',
      mode: 'USER_CANCELLED',
      paymentIntent: { status: 'CLOSE_PENDING', version: 2 },
    });
    expect(transactionStub.paymentIntent.updateMany).not.toHaveBeenCalled();
  });

  it('records UNKNOWN Provider close results as pending and preserves the reservation', async () => {
    const record = closeOrderRecord();
    const intent = closeIntentRecord(record.id, {
      close_requested_at: NOW,
      status: 'CLOSE_PENDING',
      version: 2,
    });
    const updatedIntent = {
      ...intent,
      last_error_code: 'PROVIDER_UNKNOWN',
      last_reconciled_at: NOW,
      next_reconcile_at: new Date(NOW.getTime() + 60_000),
      provider_state: 'UNKNOWN',
      reconciliation_attempt_count: 1,
      updated_at: NOW,
      version: 3,
    };
    const transactionStub = {
      $queryRaw: vi.fn().mockResolvedValue([{ transaction_time: NOW }]),
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue(updatedIntent),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(record),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    const internals = repository as unknown as {
      lockCloseOrderRows: ReturnType<typeof vi.fn>;
      lockPaymentIntents: ReturnType<typeof vi.fn>;
    };
    internals.lockCloseOrderRows = vi.fn().mockResolvedValue(undefined);
    internals.lockPaymentIntents = vi.fn().mockResolvedValue([intent]);
    const result = await repository.finalizeOrderCloseInTransaction(transactionStub, {
      errorCode: 'PROVIDER_UNKNOWN',
      expectedIntentVersion: 2,
      orderId: record.id,
      outcome: 'UNKNOWN',
      paymentIntentId: intent.id,
      providerIntentId: intent.provider_intent_id,
      // A Provider clock is not authoritative.  The repository must persist
      // the database transaction timestamp instead of this future observation.
      occurredAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1_000),
    });
    expect(result).toMatchObject({
      kind: 'PENDING',
      order: { orderId: record.id, orderStatus: 'PENDING_PAYMENT' },
      paymentIntent: { status: 'CLOSE_PENDING', version: 3 },
      reservationId: record.inventory_reservation.id,
      closeResult: null,
    });
    expect(transactionStub.paymentIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        last_error_code: 'PROVIDER_UNKNOWN',
        last_reconciled_at: NOW,
        next_reconcile_at: expect.any(Date),
        updated_at: NOW,
      }),
    }));
  });

  it('uses the database clock and preserves a pre-expiry user-cancel decision after Provider delay', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1_000);
    const closeRequestedAt = new Date(NOW.getTime() + 5 * 60 * 1_000);
    const transactionNow = new Date(expiresAt.getTime() + 5 * 60 * 1_000);
    const record = closeOrderRecord({ pay_expires_at: expiresAt });
    const intent = closeIntentRecord(record.id, {
      close_requested_at: closeRequestedAt,
      expires_at: expiresAt,
      status: 'CLOSE_PENDING',
      version: 2,
    });
    const updatedIntent = {
      ...intent,
      closed_at: transactionNow,
      status: 'CANCELLED',
      version: 3,
    };
    const transactionStub = {
      paymentIntent: {
        findUnique: vi.fn().mockResolvedValue(updatedIntent),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValueOnce(record).mockResolvedValueOnce(record),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    const internals = repository as unknown as {
      closeLockedOrder: ReturnType<typeof vi.fn>;
      lockCloseOrderRows: ReturnType<typeof vi.fn>;
      lockPaymentIntents: ReturnType<typeof vi.fn>;
      transactionTime: ReturnType<typeof vi.fn>;
    };
    internals.closeLockedOrder = vi.fn().mockResolvedValue({
      before: {},
      changed: true,
      order: {},
      reservationId: record.inventory_reservation.id,
    });
    internals.lockCloseOrderRows = vi.fn().mockResolvedValue(undefined);
    internals.lockPaymentIntents = vi.fn().mockResolvedValue([intent]);
    internals.transactionTime = vi.fn().mockResolvedValue(transactionNow);

    await expect(repository.finalizeOrderCloseInTransaction(transactionStub, {
      expectedIntentVersion: intent.version,
      occurredAt: new Date(transactionNow.getTime() + 24 * 60 * 60 * 1_000),
      orderId: record.id,
      outcome: 'NOT_FOUND',
      paymentIntentId: intent.id,
      providerIntentId: intent.provider_intent_id,
    })).resolves.toMatchObject({ kind: 'CLOSED' });

    expect(internals.closeLockedOrder).toHaveBeenCalledWith(transactionStub, {
      expectedVersion: record.version,
      mode: 'USER_CANCELLED',
      orderId: record.id,
      requestedAt: closeRequestedAt,
    });
    expect(transactionStub.paymentIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        closed_at: transactionNow,
        last_reconciled_at: transactionNow,
        updated_at: transactionNow,
      }),
    }));
  });

  it('repairs a terminal intent whose original close did not reach the order and reservation', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1_000);
    const closeRequestedAt = new Date(NOW.getTime() - 1_000);
    const record = closeOrderRecord({ payment_status: 'PROCESSING', pay_expires_at: expiresAt });
    const intent = closeIntentRecord(record.id, {
      close_requested_at: closeRequestedAt,
      closed_at: NOW,
      expires_at: expiresAt,
      status: 'CANCELLED',
      version: 3,
    });
    const repaired = {
      before: { orderId: record.id },
      changed: true,
      order: { orderId: record.id, orderStatus: 'CLOSED' },
      reservationId: record.inventory_reservation.id,
    };
    const transactionStub = {
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(record),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    const internals = repository as unknown as {
      closeLockedOrder: ReturnType<typeof vi.fn>;
      lockCloseOrderRows: ReturnType<typeof vi.fn>;
      lockPaymentIntents: ReturnType<typeof vi.fn>;
      paymentIntentHasSuccessfulAttempt: ReturnType<typeof vi.fn>;
      transactionTime: ReturnType<typeof vi.fn>;
    };
    internals.closeLockedOrder = vi.fn().mockResolvedValue(repaired);
    internals.lockCloseOrderRows = vi.fn().mockResolvedValue(undefined);
    internals.lockPaymentIntents = vi.fn().mockResolvedValue([intent]);
    internals.paymentIntentHasSuccessfulAttempt = vi.fn().mockResolvedValue(false);
    internals.transactionTime = vi.fn().mockResolvedValue(NOW);

    await expect(repository.repairTerminalOrderCloseInTransaction(transactionStub, {
      expectedIntentVersion: intent.version,
      orderId: record.id,
      paymentIntentId: intent.id,
    })).resolves.toMatchObject({
      ...repaired,
      before: {
        orderId: record.id,
        orderStatus: 'PENDING_PAYMENT',
        paymentStatus: 'PROCESSING',
        version: record.version,
      },
    });

    expect(transactionStub.salesOrder.updateMany).toHaveBeenCalledWith({
      data: { payment_status: 'UNPAID', updated_at: NOW, version: { increment: 1 } },
      where: { id: record.id, payment_status: 'PROCESSING', version: record.version },
    });
    expect(internals.closeLockedOrder).toHaveBeenCalledWith(transactionStub, {
      mode: 'USER_CANCELLED',
      orderId: record.id,
      repairTerminalClose: true,
      requestedAt: closeRequestedAt,
    });
  });

  it('releases an ACTIVE reservation left behind on an already closed order without closing it twice', async () => {
    const expiresAt = new Date(NOW.getTime() + 30 * 60 * 1_000);
    const closeRequestedAt = new Date(NOW.getTime() - 1_000);
    const record = closeOrderRecord({
      close_reason: 'USER_CANCELLED',
      closed_at: NOW,
      order_status: 'CLOSED',
      pay_expires_at: expiresAt,
    });
    const intent = closeIntentRecord(record.id, {
      close_requested_at: closeRequestedAt,
      closed_at: NOW,
      expires_at: expiresAt,
      status: 'CANCELLED',
      version: 3,
    });
    const projected = { orderId: record.id, orderStatus: 'CLOSED' };
    const transactionStub = {
      inventoryBalance: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inventoryLedger: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      inventoryReservation: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      salesOrder: {
        findUnique: vi.fn().mockResolvedValue(record),
        updateMany: vi.fn(),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    const internals = repository as unknown as {
      lockCloseOrderRows: ReturnType<typeof vi.fn>;
      lockPaymentIntents: ReturnType<typeof vi.fn>;
      lockReleaseInventory: ReturnType<typeof vi.fn>;
      paymentIntentHasSuccessfulAttempt: ReturnType<typeof vi.fn>;
      readOwnedOrder: ReturnType<typeof vi.fn>;
      transactionTime: ReturnType<typeof vi.fn>;
    };
    internals.lockCloseOrderRows = vi.fn().mockResolvedValue(undefined);
    internals.lockPaymentIntents = vi.fn().mockResolvedValue([intent]);
    internals.lockReleaseInventory = vi.fn().mockResolvedValue({
      balances: [{ id: balanceId, lockedQty: 1, physicalQty: 5, skuId, version: 2 }],
      items: [{ quantity: 1, skuId }],
      reservationId: record.inventory_reservation.id,
    });
    internals.paymentIntentHasSuccessfulAttempt = vi.fn().mockResolvedValue(false);
    internals.readOwnedOrder = vi.fn().mockResolvedValue(projected);
    internals.transactionTime = vi.fn().mockResolvedValue(NOW);

    await expect(repository.repairTerminalOrderCloseInTransaction(transactionStub, {
      expectedIntentVersion: intent.version,
      orderId: record.id,
      paymentIntentId: intent.id,
    })).resolves.toMatchObject({
      changed: true,
      order: projected,
      reservationId: record.inventory_reservation.id,
    });

    expect(transactionStub.salesOrder.updateMany).not.toHaveBeenCalled();
    expect(transactionStub.inventoryReservation.updateMany).toHaveBeenCalledWith({
      data: { released_at: NOW, status: 'RELEASED' },
      where: { id: record.inventory_reservation.id, order_id: record.id, status: 'ACTIVE' },
    });
    expect(transactionStub.inventoryBalance.updateMany).toHaveBeenCalledWith({
      data: { locked_qty: 0, updated_at: NOW, version: { increment: 1 } },
      where: { id: balanceId, locked_qty: 1, physical_qty: 5, sku_id: skuId, version: 2 },
    });
    expect(transactionStub.inventoryLedger.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        business_id: record.inventory_reservation.id,
        ledger_type: 'ORDER_RELEASE',
        locked_after: 0,
        locked_change: -1,
        reason: 'USER_CANCELLED',
        sku_id: skuId,
      })],
    });
  });

  it('fails closed when a terminal order repair target is stale or has a successful payment fact', async () => {
    const record = closeOrderRecord();
    const intent = closeIntentRecord(record.id, {
      close_requested_at: NOW,
      closed_at: NOW,
      status: 'FAILED',
      version: 3,
    });
    const transactionStub = {
      salesOrder: { findUnique: vi.fn().mockResolvedValue(record), updateMany: vi.fn() },
    } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);
    const internals = repository as unknown as {
      lockCloseOrderRows: ReturnType<typeof vi.fn>;
      lockPaymentIntents: ReturnType<typeof vi.fn>;
      paymentIntentHasSuccessfulAttempt: ReturnType<typeof vi.fn>;
    };
    internals.lockCloseOrderRows = vi.fn().mockResolvedValue(undefined);
    internals.lockPaymentIntents = vi.fn().mockResolvedValue([intent]);
    internals.paymentIntentHasSuccessfulAttempt = vi.fn().mockResolvedValue(false);

    await expect(repository.repairTerminalOrderCloseInTransaction(transactionStub, {
      expectedIntentVersion: intent.version - 1,
      orderId: record.id,
      paymentIntentId: intent.id,
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

    internals.paymentIntentHasSuccessfulAttempt.mockResolvedValue(true);
    await expect(repository.repairTerminalOrderCloseInTransaction(transactionStub, {
      expectedIntentVersion: intent.version,
      orderId: record.id,
      paymentIntentId: intent.id,
    })).rejects.toMatchObject({ code: 'PAYMENT_RESULT_CONFLICT' });
    expect(transactionStub.salesOrder.updateMany).not.toHaveBeenCalled();
  });

  it('does not select an early OPEN intent for timeout reconciliation', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = { $queryRaw: queryRaw } as unknown as DatabaseTransaction;
    const repository = new StoreOrderRepository({} as PrismaClient);

    await expect(repository.claimNextOrderCloseInTransaction(transaction)).resolves.toEqual({ kind: 'NONE' });

    const query = queryRaw.mock.calls[0]![0] as { strings: readonly string[] };
    const statement = query.strings.join('?');
    expect(statement).toContain("due.status IN ('CREATING', 'OPEN')");
    expect(statement).toContain("due.status = 'CLOSE_PENDING'");
    expect(statement).toContain('due.next_reconcile_at <= transaction_timestamp()');
    expect(statement).not.toContain('OR so.pay_expires_at <= transaction_timestamp()\n              )');
    expect(statement).toContain('FOR UPDATE OF so SKIP LOCKED');
  });

  it('creates one CART order, reserves exact inventory and follows the shared lock order', async () => {
    const state = harness();
    const snapshot = quoteSnapshot();
    vi.spyOn(StoreCheckoutRepository.prototype, 'quoteInTransaction').mockResolvedValue(snapshot);
    const createHooks = hooks();

    const result = await state.repository.createOrderInTransaction(
      state.transaction,
      cartInput(),
      createHooks,
    );

    expect(createHooks.verifyQuote).toHaveBeenCalledWith(snapshot);
    expect(createHooks.protectAddress).toHaveBeenCalledWith(expect.any(String), snapshot.address);
    expect(state.locks.map(({ namespace }) => namespace)).toEqual([
      'store-auth-account',
      'store-auth-customer',
      'store-cart',
      'store-cart-item',
      'store-cart-item',
      'store-address-set',
      'store-address',
      'store-attribution-binding',
      'store-attribution-agent',
      'master-data-brand',
      'master-data-category',
      'master-data-product',
      'master-data-product',
      'product-catalog-sku',
      'product-catalog-sku',
      'inventory-balance',
      'inventory-balance',
    ]);
    expect(state.transactionStub.salesOrder.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        created_at: NOW,
        order_no: expect.stringMatching(/^QX[0-9A-HJKMNP-TV-Z]{26}$/),
        pay_expires_at: new Date(NOW.getTime() + 30 * 60 * 1_000),
      }),
    }));
    expect(state.transactionStub.orderAttributionCandidate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        binding_id: bindingId,
        candidate_agent_id: agentId,
        submit_channel: 'AGENT',
      }),
    }));
    expect(state.transactionStub.inventoryBalance.updateMany).toHaveBeenNthCalledWith(1, {
      data: { locked_qty: 4, updated_at: NOW, version: { increment: 1 } },
      where: { id: balanceId, locked_qty: 2, physical_qty: 10, sku_id: skuId, version: 6 },
    });
    expect(state.transactionStub.inventoryLedger.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          business_id: result.reservation.reservationId,
          ledger_type: 'ORDER_RESERVE',
          locked_after: 4,
          locked_change: 2,
          sku_id: skuId,
        }),
      ]),
    });
    expect(state.transactionStub.cartItem.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { quantity: 2, sku_id: skuId },
          { quantity: 1, sku_id: secondSkuId },
        ],
        cart_id: cartId,
        selected: true,
      },
    });
    expect(result).toMatchObject({
      attribution: { bindingId, candidateAgentId: agentId, submitChannel: 'AGENT' },
      removedCartItemCount: 2,
      reservation: { expiresAt: new Date(NOW.getTime() + 30 * 60 * 1_000), status: 'ACTIVE' },
    });

    const generatedIds = [
      result.order.orderId,
      result.attribution.candidateId,
      result.reservation.reservationId,
      ...result.order.items.map(({ orderItemId }) => orderItemId),
      ...((state.transactionStub.inventoryReservationItem.createMany.mock.calls[0]![0] as {
        data: Array<{ id: string }>;
      }).data.map(({ id: generatedId }) => generatedId)),
      ...((state.transactionStub.inventoryLedger.createMany.mock.calls[0]![0] as {
        data: Array<{ id: string }>;
      }).data.map(({ id: generatedId }) => generatedId)),
    ];
    expect(new Set(generatedIds).size).toBe(generatedIds.length);
  });

  it('degrades an inactive bound agent to DIRECT without blocking a BUY_NOW order', async () => {
    const state = harness({ inactiveAgent: true });
    const snapshot = quoteSnapshot('BUY_NOW');
    vi.spyOn(StoreCheckoutRepository.prototype, 'quoteInTransaction').mockResolvedValue(snapshot);
    const createHooks = hooks();
    const item = snapshot.items[0]!;

    const result = await state.repository.createOrderInTransaction(state.transaction, {
      accountId,
      addressId,
      customerId,
      items: [{ quantity: item.quantity, skuId: item.skuId }],
      source: 'BUY_NOW',
    }, createHooks);

    expect(result.attribution).toMatchObject({
      bindingId: null,
      candidateAgentId: null,
      submitChannel: 'DIRECT',
    });
    expect(state.transactionStub.orderAttributionCandidate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        binding_id: null,
        candidate_agent_id: null,
        submit_channel: 'DIRECT',
      }),
    }));
    expect(state.transactionStub.cart.findUnique).not.toHaveBeenCalled();
    expect(state.transactionStub.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('preserves credential error precedence when the locked checkout snapshot also drifted', async () => {
    const state = harness();
    const snapshot = quoteSnapshot();
    snapshot.canSubmit = false;
    snapshot.blockers = ['INSUFFICIENT_STOCK'];
    const createHooks = hooks();
    createHooks.verifyQuote.mockImplementation(() => {
      throw new ApplicationError('CHECKOUT_QUOTE_EXPIRED', 'Checkout quote expired');
    });
    vi.spyOn(StoreCheckoutRepository.prototype, 'quoteInTransaction').mockResolvedValue(snapshot);

    await expect(state.repository.createOrderInTransaction(state.transaction, cartInput(), createHooks))
      .rejects.toMatchObject({ code: 'CHECKOUT_QUOTE_EXPIRED', httpStatus: 409 });

    expect(createHooks.verifyQuote).toHaveBeenCalledWith(snapshot);
    expect(state.transactionStub.salesOrder.create).not.toHaveBeenCalled();
    expect(state.transactionStub.inventoryBalance.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed on inventory CAS drift before ledgers or CART deletion', async () => {
    const state = harness({ inventoryUpdateCount: 0 });
    vi.spyOn(StoreCheckoutRepository.prototype, 'quoteInTransaction').mockResolvedValue(quoteSnapshot());

    await expect(state.repository.createOrderInTransaction(state.transaction, cartInput(), hooks()))
      .rejects.toMatchObject({ code: 'CHECKOUT_REQUOTE_REQUIRED', httpStatus: 409 });
    expect(state.transactionStub.inventoryLedger.createMany).not.toHaveBeenCalled();
    expect(state.transactionStub.cartItem.deleteMany).not.toHaveBeenCalled();
  });

  it('fails closed when the catalog hierarchy changes after deriving the lock set', async () => {
    const state = harness({ catalogDrift: true });
    const quote = vi.spyOn(StoreCheckoutRepository.prototype, 'quoteInTransaction')
      .mockResolvedValue(quoteSnapshot());

    await expect(state.repository.createOrderInTransaction(state.transaction, cartInput(), hooks()))
      .rejects.toMatchObject({ code: 'CHECKOUT_REQUOTE_REQUIRED', httpStatus: 409 });
    expect(state.transactionStub.sku.findMany).toHaveBeenCalledTimes(2);
    expect(quote).not.toHaveBeenCalled();
    expect(state.transactionStub.salesOrder.create).not.toHaveBeenCalled();
  });

  it('fails closed when a requested SKU disappears after deriving the lock set', async () => {
    const state = harness({ catalogMissingAfterLock: true });
    const quote = vi.spyOn(StoreCheckoutRepository.prototype, 'quoteInTransaction')
      .mockResolvedValue(quoteSnapshot());

    await expect(state.repository.createOrderInTransaction(state.transaction, cartInput(), hooks()))
      .rejects.toMatchObject({ code: 'CHECKOUT_REQUOTE_REQUIRED', httpStatus: 409 });
    expect(quote).not.toHaveBeenCalled();
    expect(state.transactionStub.salesOrder.create).not.toHaveBeenCalled();
  });

  it('reauthenticates an idempotent replay, locks the order and returns its current projection', async () => {
    const state = harness();
    const replayOrderId = id(-1_000);
    const replayItemId = id(-900);
    const orderWrite = {
      created_at: NOW,
      goods_amount: new Prisma.Decimal('19.90'),
      pay_expires_at: new Date(NOW.getTime() + 30 * 60 * 1_000),
      payable_amount: new Prisma.Decimal('19.90'),
      source: 'BUY_NOW',
      updated_at: NOW,
    };
    const itemWrite = {
      aftersale_reserved_amount: new Prisma.Decimal(0),
      aftersale_reserved_qty: 0,
      brand_name_snapshot: 'Replay Brand',
      category_id: categoryId,
      category_name_snapshot: 'Replay Category',
      created_at: NOW,
      id: replayItemId,
      line_paid_amount: new Prisma.Decimal('19.90'),
      order_id: replayOrderId,
      pre_shipment_refunded_qty: 0,
      product_id: productId,
      product_name_snapshot: 'Replay Product',
      quantity: 1,
      refunded_amount: new Prisma.Decimal(0),
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: 'REPLAY-SKU',
      sku_id: skuId,
      sku_name_snapshot: 'Replay SKU',
      unit_price: new Prisma.Decimal('19.90'),
      version: 1,
    };
    state.transactionStub.salesOrder.findFirst.mockResolvedValueOnce(
      orderRecord(replayOrderId, orderWrite, [itemWrite]),
    );

    const replay = await state.repository.getOwnedOrderForReplayInTransaction(state.transaction, {
      accountId,
      customerId,
      orderId: replayOrderId,
    });

    expect(state.transactionStub.account.findUnique).toHaveBeenCalledTimes(1);
    expect(state.locks.map(({ namespace }) => namespace)).toEqual([
      'store-auth-account',
      'store-auth-customer',
      'store-order',
    ]);
    expect(state.transactionStub.salesOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { customer_id: customerId, id: replayOrderId },
    }));
    expect(replay).toMatchObject({
      customerId,
      orderId: replayOrderId,
      orderStatus: 'PENDING_PAYMENT',
      serverTime: NOW,
    });
  });
});
