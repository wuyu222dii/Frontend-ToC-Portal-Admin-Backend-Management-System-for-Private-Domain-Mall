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
