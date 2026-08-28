import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { StoreCheckoutRepository } from './store-checkout.repository';

const NOW = new Date('2026-08-28T10:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 30_000);
const customerId = generateUlid(NOW.getTime() - 29_000);
const addressId = generateUlid(NOW.getTime() - 28_000);
const cartId = generateUlid(NOW.getTime() - 27_000);
const brandId = generateUlid(NOW.getTime() - 26_000);
const categoryId = generateUlid(NOW.getTime() - 25_000);
const productId = generateUlid(NOW.getTime() - 24_000);
const secondProductId = generateUlid(NOW.getTime() - 23_000);
const skuId = generateUlid(NOW.getTime() - 22_000);
const secondSkuId = generateUlid(NOW.getTime() - 21_000);
const balanceId = generateUlid(NOW.getTime() - 20_000);
const secondBalanceId = generateUlid(NOW.getTime() - 19_000);
const imageId = generateUlid(NOW.getTime() - 18_000);
const imageFileId = generateUlid(NOW.getTime() - 17_000);

interface CheckoutRow {
  brand_id: string;
  brand_name: string;
  brand_status: string;
  brand_deleted_at: Date | null;
  brand_version: number;
  category_id: string;
  category_name: string;
  category_status: string;
  category_deleted_at: Date | null;
  category_version: number;
  inventory_balance_id: string | null;
  inventory_version: number | null;
  locked_qty: number | null;
  physical_qty: number | null;
  available_stock: bigint;
  primary_image_id: string | null;
  primary_image_file_id: string | null;
  primary_image_object_key: string | null;
  product_id: string;
  product_name: string;
  product_status: string;
  product_deleted_at: Date | null;
  product_version: number;
  retail_price: Prisma.Decimal;
  sku_id: string;
  sku_code: string;
  sku_name: string;
  sku_status: string;
  sku_deleted_at: Date | null;
  sku_version: number;
  spec_json: Prisma.JsonValue | null;
}

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
    wechat_open_id: 'openid-checkout-customer',
  };
}

function addressRecord() {
  return {
    city: 'Auckland',
    customer_id: customerId,
    detail_ciphertext: Buffer.from('detail-ciphertext'),
    district: 'Central',
    encryption_key_id: 'field-current',
    id: addressId,
    is_default: true,
    phone_ciphertext: Buffer.from('phone-ciphertext'),
    phone_hash: 'a'.repeat(64),
    phone_last4: '6789',
    province: 'Auckland',
    recipient_name: 'Checkout Recipient',
    version: 3,
  };
}

function checkoutRow(overrides: Partial<CheckoutRow> = {}): CheckoutRow {
  return {
    available_stock: 8n,
    brand_deleted_at: null,
    brand_id: brandId,
    brand_name: 'Checkout Brand',
    brand_status: 'ACTIVE',
    brand_version: 2,
    category_deleted_at: null,
    category_id: categoryId,
    category_name: 'Checkout Category',
    category_status: 'ACTIVE',
    category_version: 4,
    inventory_balance_id: balanceId,
    inventory_version: 6,
    locked_qty: 2,
    physical_qty: 10,
    primary_image_file_id: imageFileId,
    primary_image_id: imageId,
    primary_image_object_key: `public/${imageFileId}`,
    product_deleted_at: null,
    product_id: productId,
    product_name: 'Checkout Product',
    product_status: 'ACTIVE',
    product_version: 5,
    retail_price: new Prisma.Decimal('19.90'),
    sku_deleted_at: null,
    sku_code: 'CHECKOUT-SKU',
    sku_id: skuId,
    sku_name: 'Checkout SKU',
    sku_status: 'ACTIVE',
    sku_version: 7,
    spec_json: { size: '500ml' },
    ...overrides,
  };
}

function sqlText(query: unknown): string {
  return (query as { strings: readonly string[] }).strings.join('?');
}

function sqlValues(query: unknown): readonly unknown[] {
  return (query as { values: readonly unknown[] }).values;
}

function harness() {
  let account: ReturnType<typeof activeAccount> | null = activeAccount();
  let address: ReturnType<typeof addressRecord> | null = addressRecord();
  let cart: { id: string } | null = { id: cartId };
  let selectedItems = [
    { quantity: 2, sku_id: skuId },
    { quantity: 1, sku_id: secondSkuId },
  ].sort((left, right) => left.sku_id < right.sku_id ? -1 : left.sku_id > right.sku_id ? 1 : 0);
  let rows = [
    checkoutRow(),
    checkoutRow({
      available_stock: 3n,
      inventory_balance_id: secondBalanceId,
      inventory_version: 2,
      locked_qty: 2,
      physical_qty: 5,
      product_id: secondProductId,
      product_name: 'Second Checkout Product',
      retail_price: new Prisma.Decimal('5.25'),
      sku_id: secondSkuId,
      sku_name: 'Second Checkout SKU',
    }),
  ];
  const transactionStub = {
    $queryRaw: vi.fn(async () => rows),
    account: { findUnique: vi.fn(async () => account) },
    cart: { findUnique: vi.fn(async () => cart) },
    cartItem: { findMany: vi.fn(async () => selectedItems) },
    customerAddress: { findFirst: vi.fn(async () => address) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => unknown) =>
      work(transactionStub as unknown as DatabaseTransaction)),
  };
  return {
    prisma,
    repository: new StoreCheckoutRepository(prisma as unknown as PrismaClient),
    setAccount: (value: ReturnType<typeof activeAccount> | null) => { account = value; },
    setAddress: (value: ReturnType<typeof addressRecord> | null) => { address = value; },
    setCart: (value: { id: string } | null) => { cart = value; },
    setRows: (value: CheckoutRow[]) => { rows = value; },
    setSelectedItems: (value: { quantity: number; sku_id: string }[]) => { selectedItems = value; },
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

function cartQuoteInput() {
  return {
    accountId,
    addressId,
    customerId,
    items: [
      { quantity: 1, skuId: secondSkuId },
      { quantity: 2, skuId },
    ],
    source: 'CART' as const,
  };
}

describe('StoreCheckoutRepository', () => {
  it('strictly validates the closed quote input and canonicalizes unique SKU lines', async () => {
    const state = harness();
    await expect(state.repository.quote({ ...cartQuoteInput(), extra: true } as never))
      .rejects.toThrow('invalid fields');
    await expect(state.repository.quote({ ...cartQuoteInput(), accountId: 'bad' }))
      .rejects.toThrow('must be a ULID');
    await expect(state.repository.quote({ ...cartQuoteInput(), source: 'ORDER' as never }))
      .rejects.toThrow('source is invalid');
    await expect(state.repository.quote({ ...cartQuoteInput(), items: [] }))
      .rejects.toThrow('1 to 100');
    await expect(state.repository.quote({
      ...cartQuoteInput(),
      source: 'BUY_NOW',
    })).rejects.toThrow('exactly one');
    await expect(state.repository.quote({
      ...cartQuoteInput(),
      items: [{ quantity: 1, skuId }, { quantity: 2, skuId }],
    })).rejects.toThrow('must be unique');
    await expect(state.repository.quote({
      ...cartQuoteInput(),
      items: [{ quantity: 100, skuId }],
    })).rejects.toThrow('between 1 and 99');
  });

  it('returns one Repeatable Read quote snapshot with security material, exact CART facts and Decimal totals', async () => {
    const state = harness();
    const result = await state.repository.quote(cartQuoteInput());

    expect(result).toMatchObject({
      address: {
        addressId,
        customerId,
        encryptionKeyId: 'field-current',
        isDefault: true,
        phoneHash: 'a'.repeat(64),
        phoneLast4: '6789',
        version: 3,
      },
      blockers: [],
      canSubmit: true,
      cart: {
        cartId,
        selectedItems: [
          { quantity: 2, skuId },
          { quantity: 1, skuId: secondSkuId },
        ].sort((left, right) => left.skuId < right.skuId ? -1 : left.skuId > right.skuId ? 1 : 0),
        selectionMatches: true,
      },
      goodsAmount: '45.05',
      payableAmount: '45.05',
      shippingAmount: '0.00',
      source: 'CART',
    });
    expect(Buffer.from(result.address.phoneCiphertext).toString()).toBe('phone-ciphertext');
    expect(Buffer.from(result.address.detailCiphertext).toString()).toBe('detail-ciphertext');
    expect(result.items.map(({ skuId: id }) => id)).toEqual([skuId, secondSkuId].sort());
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        availableStock: 8,
        brandName: 'Checkout Brand',
        categoryName: 'Checkout Category',
        inventoryBalanceId: balanceId,
        inventoryVersion: 6,
        lineAmount: '39.80',
        primaryImageFileId: imageFileId,
        primaryImageId: imageId,
        primaryImageObjectKey: `public/${imageFileId}`,
        productVersion: 5,
        saleable: true,
        lockedQty: 2,
        physicalQty: 10,
        skuCode: 'CHECKOUT-SKU',
        skuId,
        skuVersion: 7,
        unitPrice: '19.90',
      }),
    ]));
    expect(state.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(state.transactionStub.$queryRaw).toHaveBeenCalledTimes(1);
    expect(state.transactionStub.account.findUnique).toHaveBeenCalledTimes(1);
    expect(state.transactionStub.customerAddress.findFirst).toHaveBeenCalledTimes(1);
    expect(state.transactionStub.cart.findUnique).toHaveBeenCalledTimes(1);
    expect(state.transactionStub.cartItem.findMany).toHaveBeenCalledTimes(1);
    const query = state.transactionStub.$queryRaw.mock.calls[0]?.[0];
    expect(sqlText(query)).toContain("fa.status = 'READY'");
    expect(sqlText(query)).toContain("fa.visibility = 'PUBLIC'");
    expect(sqlText(query)).toContain("fa.purpose = 'PRODUCT_IMAGE'");
    expect(sqlText(query)).toContain("fa.object_key = 'public/' || fa.id");
    expect(sqlText(query)).toContain('ORDER BY s.id ASC');
    expect(sqlValues(query)).toEqual(expect.arrayContaining([skuId, secondSkuId]));
  });

  it('returns stable blockers for a changed CART, known unavailable item and fail-safe stock', async () => {
    const state = harness();
    state.setSelectedItems([{ quantity: 1, sku_id: skuId }]);
    state.setRows([
      checkoutRow({
        brand_status: 'INACTIVE',
        primary_image_file_id: null,
        primary_image_id: null,
        primary_image_object_key: null,
      }),
      checkoutRow({
        available_stock: 0n,
        inventory_balance_id: null,
        inventory_version: null,
        locked_qty: null,
        physical_qty: null,
        product_id: secondProductId,
        retail_price: new Prisma.Decimal('5.25'),
        sku_id: secondSkuId,
      }),
    ]);

    const result = await state.repository.quote(cartQuoteInput());

    expect(result.canSubmit).toBe(false);
    expect(result.blockers).toEqual([
      'CART_SELECTION_CHANGED',
      'ITEM_UNAVAILABLE',
      'INSUFFICIENT_STOCK',
    ]);
    expect(result.items.find((item) => item.skuId === skuId)).toMatchObject({
      primaryImageObjectKey: null,
      saleable: false,
    });
    expect(result.items.find((item) => item.skuId === secondSkuId)).toMatchObject({
      availableStock: 0,
      inventoryBalanceId: null,
      inventoryVersion: null,
      saleable: false,
    });
  });

  it('does not read a CART for BUY_NOW and still evaluates catalog and inventory facts', async () => {
    const state = harness();
    state.setRows([checkoutRow()]);

    const result = await state.repository.quote({
      accountId,
      addressId,
      customerId,
      items: [{ quantity: 2, skuId }],
      source: 'BUY_NOW',
    });

    expect(result.cart).toEqual({ cartId: null, selectedItems: [], selectionMatches: true });
    expect(result.canSubmit).toBe(true);
    expect(state.transactionStub.cart.findUnique).not.toHaveBeenCalled();
    expect(state.transactionStub.cartItem.findMany).not.toHaveBeenCalled();
  });

  it('rejects an inactive CUSTOMER, a missing or cross-customer address, and an unknown SKU as not found', async () => {
    const inactive = harness();
    inactive.setAccount({ ...activeAccount(), status: 'DISABLED' });
    await expect(inactive.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(inactive.transactionStub.customerAddress.findFirst).not.toHaveBeenCalled();

    const address = harness();
    address.setAddress(null);
    await expect(address.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(address.transactionStub.$queryRaw).not.toHaveBeenCalled();

    const sku = harness();
    sku.setRows([checkoutRow()]);
    await expect(sku.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('fails closed on corrupt address, cart, version, price and stock projections', async () => {
    const address = harness();
    address.setAddress({ ...addressRecord(), phone_hash: 'bad' });
    await expect(address.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const cart = harness();
    cart.setSelectedItems([{ quantity: 0, sku_id: skuId }]);
    await expect(cart.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const version = harness();
    version.setRows([checkoutRow({ product_version: 0 }), checkoutRow({ sku_id: secondSkuId })]);
    await expect(version.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const price = harness();
    price.setRows([
      checkoutRow({ retail_price: new Prisma.Decimal(0) }),
      checkoutRow({ sku_id: secondSkuId }),
    ]);
    await expect(price.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const stock = harness();
    stock.setRows([
      checkoutRow({ available_stock: BigInt(Number.MAX_SAFE_INTEGER) + 1n }),
      checkoutRow({ sku_id: secondSkuId }),
    ]);
    await expect(stock.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const amount = harness();
    amount.setRows([
      checkoutRow({ retail_price: new Prisma.Decimal('9999999999999999.99') }),
      checkoutRow({ sku_id: secondSkuId }),
    ]);
    await expect(amount.repository.quote(cartQuoteInput()))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('returns CART_SELECTION_CHANGED when no server cart exists without hiding a valid quote projection', async () => {
    const state = harness();
    state.setCart(null);

    const result = await state.repository.quote(cartQuoteInput());

    expect(result.cart).toEqual({ cartId: null, selectedItems: [], selectionMatches: false });
    expect(result.blockers).toEqual(['CART_SELECTION_CHANGED']);
    expect(result.items).toHaveLength(2);
    expect(state.transactionStub.cartItem.findMany).not.toHaveBeenCalled();
  });
});
