import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';

const CHECKOUT_ITEM_LIMIT = 100;
const CHECKOUT_QUANTITY_LIMIT = 99;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const PHONE_LAST4_PATTERN = /^[0-9]{4}$/;

export type StoreCheckoutSource = 'CART' | 'BUY_NOW';
export type StoreCheckoutBlocker =
  | 'CART_SELECTION_CHANGED'
  | 'ITEM_UNAVAILABLE'
  | 'INSUFFICIENT_STOCK';

export interface StoreCheckoutLineInput {
  skuId: string;
  quantity: number;
}

export interface StoreCheckoutQuoteInput {
  accountId: string;
  customerId: string;
  addressId: string;
  source: StoreCheckoutSource;
  items: readonly StoreCheckoutLineInput[];
}

export interface StoreCheckoutAddressFact {
  addressId: string;
  customerId: string;
  version: number;
  recipientName: string;
  phoneCiphertext: Uint8Array;
  phoneHash: string;
  phoneLast4: string;
  province: string;
  city: string;
  district: string;
  detailCiphertext: Uint8Array;
  encryptionKeyId: string;
  isDefault: boolean;
}

export interface StoreCheckoutCartItemFact {
  skuId: string;
  quantity: number;
}

export interface StoreCheckoutCartFact {
  cartId: string | null;
  selectedItems: StoreCheckoutCartItemFact[];
  selectionMatches: boolean;
}

export interface StoreCheckoutLineFact {
  productId: string;
  productVersion: number;
  productName: string;
  brandId: string;
  brandVersion: number;
  categoryId: string;
  categoryVersion: number;
  skuId: string;
  skuVersion: number;
  skuName: string;
  specification: Prisma.JsonValue | null;
  primaryImageId: string | null;
  primaryImageFileId: string | null;
  primaryImageObjectKey: string | null;
  quantity: number;
  unitPrice: string;
  lineAmount: string;
  inventoryBalanceId: string | null;
  inventoryVersion: number | null;
  availableStock: number;
  saleable: boolean;
}

export interface StoreCheckoutQuoteSnapshot {
  source: StoreCheckoutSource;
  address: StoreCheckoutAddressFact;
  cart: StoreCheckoutCartFact;
  items: StoreCheckoutLineFact[];
  goodsAmount: string;
  shippingAmount: '0.00';
  payableAmount: string;
  blockers: StoreCheckoutBlocker[];
  canSubmit: boolean;
}

interface CheckoutLineRow {
  brand_id: string;
  brand_status: string;
  brand_deleted_at: Date | null;
  brand_version: number;
  category_id: string;
  category_status: string;
  category_deleted_at: Date | null;
  category_version: number;
  inventory_balance_id: string | null;
  inventory_version: number | null;
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
  sku_name: string;
  sku_status: string;
  sku_deleted_at: Date | null;
  sku_version: number;
  spec_json: Prisma.JsonValue | null;
}

type CheckoutClient = Pick<
  DatabaseTransaction,
  'account' | 'cart' | 'cartItem' | 'customerAddress' | '$queryRaw'
>;

function requirePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireQuantity(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > CHECKOUT_QUANTITY_LIMIT) {
    throw new TypeError(`Store checkout quantity must be an integer between 1 and ${CHECKOUT_QUANTITY_LIMIT}`);
  }
}

function compareUlids(left: { skuId: string }, right: { skuId: string }): number {
  return left.skuId < right.skuId ? -1 : left.skuId > right.skuId ? 1 : 0;
}

function validateQuoteInput(input: StoreCheckoutQuoteInput): StoreCheckoutLineInput[] {
  requirePlainObject(input, 'Store checkout quote input');
  requireExactKeys(
    input,
    ['accountId', 'addressId', 'customerId', 'items', 'source'],
    ['accountId', 'addressId', 'customerId', 'items', 'source'],
    'Store checkout quote input',
  );
  requireUlid(input.accountId, 'Store checkout Account ID');
  requireUlid(input.customerId, 'Store checkout Customer ID');
  requireUlid(input.addressId, 'Store checkout address ID');
  if (input.source !== 'CART' && input.source !== 'BUY_NOW') {
    throw new TypeError('Store checkout source is invalid');
  }
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > CHECKOUT_ITEM_LIMIT) {
    throw new TypeError(`Store checkout items must contain 1 to ${CHECKOUT_ITEM_LIMIT} entries`);
  }
  if (input.source === 'BUY_NOW' && input.items.length !== 1) {
    throw new TypeError('BUY_NOW checkout must contain exactly one item');
  }
  const skuIds = new Set<string>();
  const items = input.items.map((item) => {
    requirePlainObject(item, 'Store checkout item');
    requireExactKeys(item, ['quantity', 'skuId'], ['quantity', 'skuId'], 'Store checkout item');
    requireUlid(item.skuId, 'Store checkout SKU ID');
    requireQuantity(item.quantity);
    if (skuIds.has(item.skuId)) throw new TypeError('Store checkout SKU IDs must be unique');
    skuIds.add(item.skuId);
    return { quantity: item.quantity, skuId: item.skuId };
  });
  return items.sort(compareUlids);
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function resourceNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Checkout resource not found');
}

function internalError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function safeVersion(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 1) throw internalError(`${label} version is invalid`);
  return value;
}

function safeMoney(value: Prisma.Decimal, label: string): Prisma.Decimal {
  if (!Prisma.Decimal.isDecimal(value) || !value.greaterThan(0) || value.greaterThan(MAX_MONEY) ||
    value.decimalPlaces() > 2) {
    throw internalError(`${label} price is invalid`);
  }
  return value;
}

function formatCalculatedMoney(value: Prisma.Decimal, label: string): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || value.greaterThan(MAX_MONEY) ||
    value.decimalPlaces() > 2) {
    throw internalError(`${label} amount is invalid`);
  }
  return value.toFixed(2);
}

function safeAvailableStock(value: bigint): number {
  const stock = Number(value);
  if (!Number.isSafeInteger(stock) || stock < 0) {
    throw internalError('Store checkout inventory projection is invalid');
  }
  return stock;
}

function safeFactUlid(value: string, label: string): string {
  if (!isValidUlid(value)) throw internalError(`${label} ID is invalid`);
  return value;
}

function cartSelectionsMatch(
  requested: readonly StoreCheckoutLineInput[],
  selected: readonly StoreCheckoutCartItemFact[],
): boolean {
  return requested.length === selected.length && requested.every((item, index) => {
    const cartItem = selected[index];
    return cartItem?.skuId === item.skuId && cartItem.quantity === item.quantity;
  });
}

export class StoreCheckoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async assertActiveCustomer(
    client: CheckoutClient,
    input: Pick<StoreCheckoutQuoteInput, 'accountId' | 'customerId'>,
  ): Promise<void> {
    const account = await client.account.findUnique({
      where: { id: input.accountId },
      select: {
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
        customer_profile: { select: { account_id: true, anonymized_at: true, id: true } },
      },
    });
    const customer = account?.customer_profile;
    if (!account || account.role !== 'CUSTOMER' || account.status !== 'ACTIVE' ||
      account.deleted_at !== null || account.login_name !== null || account.password_hash !== null ||
      account.wechat_open_id === null || !customer || customer.id !== input.customerId ||
      customer.account_id !== input.accountId || customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
  }

  private async readAddress(
    client: CheckoutClient,
    input: Pick<StoreCheckoutQuoteInput, 'addressId' | 'customerId'>,
  ): Promise<StoreCheckoutAddressFact> {
    const address = await client.customerAddress.findFirst({
      where: { customer_id: input.customerId, deleted_at: null, id: input.addressId },
      select: {
        city: true,
        customer_id: true,
        detail_ciphertext: true,
        district: true,
        encryption_key_id: true,
        id: true,
        is_default: true,
        phone_ciphertext: true,
        phone_hash: true,
        phone_last4: true,
        province: true,
        recipient_name: true,
        version: true,
      },
    });
    if (!address) throw resourceNotFound();
    const version = safeVersion(address.version, 'Store checkout address');
    if (version === null || !HASH_PATTERN.test(address.phone_hash) ||
      !PHONE_LAST4_PATTERN.test(address.phone_last4) ||
      !(address.phone_ciphertext instanceof Uint8Array) || address.phone_ciphertext.byteLength < 1 ||
      !(address.detail_ciphertext instanceof Uint8Array) || address.detail_ciphertext.byteLength < 1 ||
      typeof address.is_default !== 'boolean') {
      throw internalError('Store checkout address projection is invalid');
    }
    return {
      addressId: address.id,
      city: address.city,
      customerId: address.customer_id,
      detailCiphertext: Buffer.from(address.detail_ciphertext),
      district: address.district,
      encryptionKeyId: address.encryption_key_id,
      isDefault: address.is_default,
      phoneCiphertext: Buffer.from(address.phone_ciphertext),
      phoneHash: address.phone_hash,
      phoneLast4: address.phone_last4,
      province: address.province,
      recipientName: address.recipient_name,
      version,
    };
  }

  private async readCart(
    client: CheckoutClient,
    input: Pick<StoreCheckoutQuoteInput, 'customerId' | 'source'>,
    requestedItems: readonly StoreCheckoutLineInput[],
  ): Promise<StoreCheckoutCartFact> {
    if (input.source === 'BUY_NOW') {
      return { cartId: null, selectedItems: [], selectionMatches: true };
    }
    const cart = await client.cart.findUnique({
      where: { customer_id: input.customerId },
      select: { id: true },
    });
    if (!cart) return { cartId: null, selectedItems: [], selectionMatches: false };
    const records = await client.cartItem.findMany({
      where: { cart_id: cart.id, selected: true },
      orderBy: { sku_id: 'asc' },
      select: { quantity: true, sku_id: true },
    });
    if (records.length > CHECKOUT_ITEM_LIMIT) {
      throw internalError('Store checkout selected cart item count is invalid');
    }
    const selectedItems = records.map((record) => {
      if (!Number.isSafeInteger(record.quantity) || record.quantity < 1 ||
        record.quantity > CHECKOUT_QUANTITY_LIMIT || !isValidUlid(record.sku_id)) {
        throw internalError('Store checkout selected cart item is invalid');
      }
      return { quantity: record.quantity, skuId: record.sku_id };
    }).sort(compareUlids);
    return {
      cartId: cart.id,
      selectedItems,
      selectionMatches: cartSelectionsMatch(requestedItems, selectedItems),
    };
  }

  private async readLines(
    client: CheckoutClient,
    requestedItems: readonly StoreCheckoutLineInput[],
  ): Promise<{ items: StoreCheckoutLineFact[]; unavailable: boolean; insufficient: boolean }> {
    const skuIds = requestedItems.map(({ skuId }) => skuId);
    const rows = await client.$queryRaw<CheckoutLineRow[]>(Prisma.sql`
      SELECT
        s.id AS sku_id,
        s.version AS sku_version,
        s.name AS sku_name,
        s.spec_json,
        s.retail_price,
        s.status::text AS sku_status,
        s.deleted_at AS sku_deleted_at,
        p.id AS product_id,
        p.version AS product_version,
        p.name AS product_name,
        p.status::text AS product_status,
        p.deleted_at AS product_deleted_at,
        b.id AS brand_id,
        b.version AS brand_version,
        b.status::text AS brand_status,
        b.deleted_at AS brand_deleted_at,
        c.id AS category_id,
        c.version AS category_version,
        c.status::text AS category_status,
        c.deleted_at AS category_deleted_at,
        ib.id AS inventory_balance_id,
        ib.version AS inventory_version,
        GREATEST(
          COALESCE(ib.physical_qty, 0)::bigint - COALESCE(ib.locked_qty, 0)::bigint,
          0::bigint
        ) AS available_stock,
        public_image.image_id AS primary_image_id,
        public_image.file_id AS primary_image_file_id,
        public_image.object_key AS primary_image_object_key
      FROM "sku" AS s
      INNER JOIN "product" AS p ON p.id = s.product_id
      INNER JOIN "brand" AS b ON b.id = p.brand_id
      INNER JOIN "category" AS c ON c.id = p.category_id
      LEFT JOIN "inventory_balance" AS ib ON ib.sku_id = s.id
      LEFT JOIN LATERAL (
        SELECT pi.id AS image_id, fa.id AS file_id, fa.object_key
        FROM "product_image" AS pi
        INNER JOIN "file_asset" AS fa ON fa.id = pi.file_id
        WHERE pi.product_id = p.id
          AND pi.deleted_at IS NULL
          AND fa.deleted_at IS NULL
          AND fa.status = 'READY'::"FileStatus"
          AND fa.visibility = 'PUBLIC'::"FileVisibility"
          AND fa.purpose = 'PRODUCT_IMAGE'::"FilePurpose"
          AND fa.object_key = 'public/' || fa.id
        ORDER BY pi.sort_order ASC, pi.id ASC
        LIMIT 1
      ) AS public_image ON TRUE
      WHERE s.id IN (${Prisma.join(skuIds)})
      ORDER BY s.id ASC
    `);
    if (rows.length !== requestedItems.length) throw resourceNotFound();
    const rowBySkuId = new Map(rows.map((row) => [row.sku_id, row]));
    if (rowBySkuId.size !== rows.length || skuIds.some((skuId) => !rowBySkuId.has(skuId))) {
      throw resourceNotFound();
    }

    let unavailable = false;
    let insufficient = false;
    const items = requestedItems.map((requested) => {
      const row = rowBySkuId.get(requested.skuId);
      if (!row) throw resourceNotFound();
      const productVersion = safeVersion(row.product_version, 'Store checkout product');
      const brandVersion = safeVersion(row.brand_version, 'Store checkout brand');
      const categoryVersion = safeVersion(row.category_version, 'Store checkout category');
      const skuVersion = safeVersion(row.sku_version, 'Store checkout SKU');
      const inventoryVersion = safeVersion(row.inventory_version, 'Store checkout inventory');
      if (productVersion === null || brandVersion === null || categoryVersion === null || skuVersion === null) {
        throw internalError('Store checkout catalog version is invalid');
      }
      const brandId = safeFactUlid(row.brand_id, 'Store checkout brand');
      const categoryId = safeFactUlid(row.category_id, 'Store checkout category');
      const productId = safeFactUlid(row.product_id, 'Store checkout product');
      const skuId = safeFactUlid(row.sku_id, 'Store checkout SKU');
      if ((row.inventory_balance_id === null) !== (inventoryVersion === null)) {
        throw internalError('Store checkout inventory identity is inconsistent');
      }
      const inventoryBalanceId = row.inventory_balance_id === null
        ? null
        : safeFactUlid(row.inventory_balance_id, 'Store checkout inventory');
      const imageValues = [row.primary_image_id, row.primary_image_file_id, row.primary_image_object_key];
      const imageMissing = imageValues.every((value) => value === null);
      const imageComplete = imageValues.every((value) => value !== null);
      if (!imageMissing && !imageComplete) {
        throw internalError('Store checkout primary image identity is inconsistent');
      }
      const primaryImageId = row.primary_image_id === null
        ? null
        : safeFactUlid(row.primary_image_id, 'Store checkout primary image');
      const primaryImageFileId = row.primary_image_file_id === null
        ? null
        : safeFactUlid(row.primary_image_file_id, 'Store checkout primary image file');
      if (primaryImageFileId !== null && row.primary_image_object_key !== `public/${primaryImageFileId}`) {
        throw internalError('Store checkout primary image key is invalid');
      }
      const unitPrice = safeMoney(row.retail_price, 'Store checkout SKU');
      const lineAmount = formatCalculatedMoney(
        unitPrice.mul(requested.quantity),
        'Store checkout line',
      );
      const availableStock = safeAvailableStock(row.available_stock);
      const publiclyAvailable = row.sku_status === 'ACTIVE' && row.sku_deleted_at === null &&
        row.product_status === 'ACTIVE' && row.product_deleted_at === null &&
        row.brand_status === 'ACTIVE' && row.brand_deleted_at === null &&
        row.category_status === 'ACTIVE' && row.category_deleted_at === null &&
        primaryImageId !== null && primaryImageFileId !== null && row.primary_image_object_key !== null;
      const hasStock = availableStock >= requested.quantity;
      unavailable ||= !publiclyAvailable;
      insufficient ||= !hasStock;
      return {
        availableStock,
        brandId,
        brandVersion,
        categoryId,
        categoryVersion,
        inventoryBalanceId,
        inventoryVersion,
        lineAmount,
        primaryImageFileId,
        primaryImageId,
        primaryImageObjectKey: row.primary_image_object_key,
        productId,
        productName: row.product_name,
        productVersion,
        quantity: requested.quantity,
        saleable: publiclyAvailable && hasStock,
        skuId,
        skuName: row.sku_name,
        skuVersion,
        specification: row.spec_json,
        unitPrice: unitPrice.toFixed(2),
      } satisfies StoreCheckoutLineFact;
    });
    return { insufficient, items, unavailable };
  }

  async quoteInTransaction(
    transaction: DatabaseTransaction,
    input: StoreCheckoutQuoteInput,
  ): Promise<StoreCheckoutQuoteSnapshot> {
    const requestedItems = validateQuoteInput(input);
    await this.assertActiveCustomer(transaction, input);
    const address = await this.readAddress(transaction, input);
    const cart = await this.readCart(transaction, input, requestedItems);
    const lines = await this.readLines(transaction, requestedItems);
    const blockers: StoreCheckoutBlocker[] = [];
    if (!cart.selectionMatches) blockers.push('CART_SELECTION_CHANGED');
    if (lines.unavailable) blockers.push('ITEM_UNAVAILABLE');
    if (lines.insufficient) blockers.push('INSUFFICIENT_STOCK');
    const goodsAmount = formatCalculatedMoney(lines.items.reduce(
      (total, item) => total.plus(item.lineAmount),
      new Prisma.Decimal(0),
    ), 'Store checkout goods');
    return {
      address,
      blockers,
      canSubmit: blockers.length === 0,
      cart,
      goodsAmount,
      items: lines.items,
      payableAmount: goodsAmount,
      shippingAmount: '0.00',
      source: input.source,
    };
  }

  async quote(input: StoreCheckoutQuoteInput): Promise<StoreCheckoutQuoteSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.quoteInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
