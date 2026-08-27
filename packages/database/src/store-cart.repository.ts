import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock, acquireTransactionLocks } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const CART_ITEM_LIMIT = 100;
const CART_QUANTITY_LIMIT = 99;

export type StoreCartSaleStatus =
  | 'SALEABLE'
  | 'INSUFFICIENT_STOCK'
  | 'OUT_OF_STOCK'
  | 'INACTIVE'
  | 'DELETED';

export interface StoreCartIdentityInput {
  accountId: string;
  customerId: string;
}

export interface StoreCartItemWriteInput extends StoreCartIdentityInput {
  quantity: number;
  selected: boolean;
  skuId: string;
}

export interface StoreCartMergeItemInput {
  quantity: number;
  selected: boolean;
  skuId: string;
}

export interface StoreCartMergeInput extends StoreCartIdentityInput {
  items: readonly StoreCartMergeItemInput[];
}

export interface StoreCartItemSnapshot {
  availableStock: number;
  primaryImageObjectKey: string | null;
  productId: string;
  productName: string;
  quantity: number;
  retailPrice: string;
  saleStatus: StoreCartSaleStatus;
  selected: boolean;
  skuId: string;
  skuName: string;
  specification: Prisma.JsonValue | null;
}

export interface StoreCartSnapshot {
  cartId: string | null;
  items: StoreCartItemSnapshot[];
  totalAmount: string;
}

export interface StoreCartMutationResult {
  cart: StoreCartSnapshot;
  changed: boolean;
}

interface CartProjectionRow {
  available_stock: bigint;
  cart_item_id: string;
  is_active: boolean;
  is_deleted: boolean;
  primary_image_object_key: string | null;
  product_id: string;
  product_name: string;
  quantity: number;
  retail_price: Prisma.Decimal;
  selected: boolean;
  sku_id: string;
  sku_name: string;
  spec_json: Prisma.JsonValue | null;
}

type CartClient = Pick<DatabaseTransaction, 'account'>;

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

function validateIdentity(input: StoreCartIdentityInput): void {
  requirePlainObject(input, 'Store cart identity');
  requireExactKeys(input, ['accountId', 'customerId'], ['accountId', 'customerId'], 'Store cart identity');
  requireUlid(input.accountId, 'Store cart Account ID');
  requireUlid(input.customerId, 'Store cart Customer ID');
}

function validateQuantity(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > CART_QUANTITY_LIMIT) {
    throw new TypeError(`${label} must be an integer between 1 and ${CART_QUANTITY_LIMIT}`);
  }
}

function validateSelected(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
}

function validateItemWriteInput(input: StoreCartItemWriteInput): void {
  requirePlainObject(input, 'Store cart item write input');
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'quantity', 'selected', 'skuId'],
    ['accountId', 'customerId', 'quantity', 'selected', 'skuId'],
    'Store cart item write input',
  );
  requireUlid(input.accountId, 'Store cart Account ID');
  requireUlid(input.customerId, 'Store cart Customer ID');
  requireUlid(input.skuId, 'Store cart SKU ID');
  validateQuantity(input.quantity, 'Store cart quantity');
  validateSelected(input.selected, 'Store cart selected');
}

function validateMergeInput(input: StoreCartMergeInput): void {
  requirePlainObject(input, 'Store cart merge input');
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'items'],
    ['accountId', 'customerId', 'items'],
    'Store cart merge input',
  );
  requireUlid(input.accountId, 'Store cart Account ID');
  requireUlid(input.customerId, 'Store cart Customer ID');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > CART_ITEM_LIMIT) {
    throw new TypeError(`Store cart merge items must contain 1 to ${CART_ITEM_LIMIT} entries`);
  }
  const skuIds = new Set<string>();
  for (const item of input.items) {
    requirePlainObject(item, 'Store cart merge item');
    requireExactKeys(
      item,
      ['quantity', 'selected', 'skuId'],
      ['quantity', 'selected', 'skuId'],
      'Store cart merge item',
    );
    requireUlid(item.skuId, 'Store cart merge SKU ID');
    validateQuantity(item.quantity, 'Store cart merge quantity');
    validateSelected(item.selected, 'Store cart merge selected');
    if (skuIds.has(item.skuId)) throw new TypeError('Store cart merge SKU IDs must be unique');
    skuIds.add(item.skuId);
  }
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function cartItemLimitExceeded(): ApplicationError {
  return new ApplicationError('CART_ITEM_LIMIT_EXCEEDED', 'Store cart contains too many distinct SKUs');
}

function assertStoredCartItem(item: { quantity: number; selected: boolean }): void {
  if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > CART_QUANTITY_LIMIT ||
    typeof item.selected !== 'boolean') {
    throw new ApplicationError('INTERNAL_ERROR', 'Stored cart item is invalid');
  }
}

function safeAvailableStock(value: bigint): number {
  const stock = Number(value);
  if (!Number.isSafeInteger(stock) || stock < 0) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store cart inventory projection is invalid');
  }
  return stock;
}

function safeMoney(value: Prisma.Decimal): string {
  if (!Prisma.Decimal.isDecimal(value) || !value.greaterThan(0) || value.decimalPlaces() > 2) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store cart price projection is invalid');
  }
  return value.toFixed(2);
}

function cartItemSnapshot(row: CartProjectionRow): StoreCartItemSnapshot {
  if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || row.quantity > CART_QUANTITY_LIMIT ||
    typeof row.selected !== 'boolean' || typeof row.is_active !== 'boolean' ||
    typeof row.is_deleted !== 'boolean') {
    throw new ApplicationError('INTERNAL_ERROR', 'Store cart item projection is invalid');
  }
  const availableStock = safeAvailableStock(row.available_stock);
  let saleStatus: StoreCartSaleStatus;
  if (row.is_deleted) saleStatus = 'DELETED';
  else if (!row.is_active) saleStatus = 'INACTIVE';
  else if (availableStock === 0) saleStatus = 'OUT_OF_STOCK';
  else if (row.quantity > availableStock) saleStatus = 'INSUFFICIENT_STOCK';
  else saleStatus = 'SALEABLE';
  return {
    availableStock,
    primaryImageObjectKey: row.primary_image_object_key,
    productId: row.product_id,
    productName: row.product_name,
    quantity: row.quantity,
    retailPrice: safeMoney(row.retail_price),
    saleStatus,
    selected: row.selected,
    skuId: row.sku_id,
    skuName: row.sku_name,
    specification: row.spec_json,
  };
}

function cartSnapshot(cartId: string | null, rows: readonly CartProjectionRow[]): StoreCartSnapshot {
  const items = rows.map(cartItemSnapshot);
  const total = rows.reduce((amount, row, index) => {
    if (!row.selected || items[index]?.saleStatus !== 'SALEABLE') return amount;
    return amount.plus(row.retail_price.mul(row.quantity));
  }, new Prisma.Decimal(0));
  return { cartId, items, totalAmount: total.toFixed(2) };
}

export class StoreCartRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Store cart clock must return a valid Date');
    }
    return value;
  }

  private async assertActiveCustomer(
    client: CartClient,
    identity: StoreCartIdentityInput,
  ): Promise<void> {
    const account = await client.account.findUnique({
      where: { id: identity.accountId },
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
      account.wechat_open_id === null || !customer || customer.id !== identity.customerId ||
      customer.account_id !== identity.accountId || customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
  }

  private async projectCart(
    transaction: DatabaseTransaction,
    cartId: string | null,
  ): Promise<StoreCartSnapshot> {
    if (cartId === null) return cartSnapshot(null, []);
    const rows = await transaction.$queryRaw<CartProjectionRow[]>(Prisma.sql`
      SELECT
        ci.id AS cart_item_id,
        ci.sku_id,
        s.product_id,
        p.name AS product_name,
        s.name AS sku_name,
        s.spec_json,
        ci.quantity,
        ci.selected,
        s.retail_price,
        GREATEST(
          COALESCE(ib.physical_qty, 0)::bigint - COALESCE(ib.locked_qty, 0)::bigint,
          0::bigint
        ) AS available_stock,
        (
          s.status = 'ARCHIVED'::"SkuStatus" OR s.deleted_at IS NOT NULL
          OR p.status = 'ARCHIVED'::"EntityStatus" OR p.deleted_at IS NOT NULL
        ) AS is_deleted,
        (
          s.status = 'ACTIVE'::"SkuStatus" AND s.deleted_at IS NULL
          AND p.status = 'ACTIVE'::"EntityStatus" AND p.deleted_at IS NULL
          AND b.status = 'ACTIVE'::"EntityStatus" AND b.deleted_at IS NULL
          AND c.status = 'ACTIVE'::"EntityStatus" AND c.deleted_at IS NULL
        ) AS is_active,
        public_image.object_key AS primary_image_object_key
      FROM "cart_item" AS ci
      INNER JOIN "sku" AS s ON s.id = ci.sku_id
      INNER JOIN "product" AS p ON p.id = s.product_id
      INNER JOIN "brand" AS b ON b.id = p.brand_id
      INNER JOIN "category" AS c ON c.id = p.category_id
      LEFT JOIN "inventory_balance" AS ib ON ib.sku_id = s.id
      LEFT JOIN LATERAL (
        SELECT fa.object_key
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
      WHERE ci.cart_id = ${cartId}
      ORDER BY ci.created_at ASC, ci.id ASC
    `);
    return cartSnapshot(cartId, rows);
  }

  private async acquireIdentityAndCartLocks(
    transaction: DatabaseTransaction,
    identity: StoreCartIdentityInput,
  ): Promise<{ id: string } | null> {
    await acquireTransactionLock(transaction, 'store-auth-account', [identity.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [identity.customerId]);
    await acquireTransactionLock(transaction, 'store-cart', [identity.customerId]);
    await this.assertActiveCustomer(transaction, identity);
    return transaction.cart.findUnique({
      where: { customer_id: identity.customerId },
      select: { id: true },
    });
  }

  private async acquireSkuLocks(
    transaction: DatabaseTransaction,
    skuIds: readonly string[],
  ): Promise<void> {
    const orderedSkuIds = [...new Set(skuIds)].sort();
    await acquireTransactionLocks(transaction, orderedSkuIds.map((skuId) => ({
      namespace: 'product-catalog-sku',
      parts: [skuId],
    })));
  }

  private async acquireItemLocks(
    transaction: DatabaseTransaction,
    cartId: string,
    skuIds: readonly string[],
  ): Promise<void> {
    const orderedSkuIds = [...new Set(skuIds)].sort();
    await acquireTransactionLocks(transaction, orderedSkuIds.map((skuId) => ({
      namespace: 'store-cart-item',
      parts: [cartId, skuId],
    })));
  }

  private async createCart(transaction: DatabaseTransaction, customerId: string): Promise<{ id: string }> {
    const now = this.currentTime();
    return transaction.cart.create({
      data: {
        created_at: now,
        customer_id: customerId,
        id: generateUlid(now.getTime()),
        updated_at: now,
      },
      select: { id: true },
    });
  }

  private async touchCart(transaction: DatabaseTransaction, cartId: string, now: Date): Promise<void> {
    await transaction.cart.update({ data: { updated_at: now }, where: { id: cartId } });
  }

  async getCart(input: StoreCartIdentityInput): Promise<StoreCartSnapshot> {
    validateIdentity(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertActiveCustomer(transaction, input);
      const cart = await transaction.cart.findUnique({
        where: { customer_id: input.customerId },
        select: { id: true },
      });
      return this.projectCart(transaction, cart?.id ?? null);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getCartForMutationInTransaction(
    transaction: DatabaseTransaction,
    input: StoreCartIdentityInput,
  ): Promise<StoreCartSnapshot> {
    validateIdentity(input);
    const cart = await this.acquireIdentityAndCartLocks(transaction, input);
    if (!cart) return cartSnapshot(null, []);
    const items = await transaction.cartItem.findMany({
      where: { cart_id: cart.id },
      select: { sku_id: true },
    });
    const skuIds = items.map(({ sku_id }) => sku_id);
    await this.acquireSkuLocks(transaction, skuIds);
    await this.acquireItemLocks(transaction, cart.id, skuIds);
    return this.projectCart(transaction, cart.id);
  }

  async putItemInTransaction(
    transaction: DatabaseTransaction,
    input: StoreCartItemWriteInput,
  ): Promise<StoreCartMutationResult> {
    validateItemWriteInput(input);
    let cart = await this.acquireIdentityAndCartLocks(transaction, input);
    await this.acquireSkuLocks(transaction, [input.skuId]);
    const sku = await transaction.sku.findUnique({ where: { id: input.skuId }, select: { id: true } });
    if (!sku) throw new ApplicationError('RESOURCE_NOT_FOUND', 'SKU not found');

    if (cart === null) cart = await this.createCart(transaction, input.customerId);
    await this.acquireItemLocks(transaction, cart.id, [input.skuId]);

    const existing = await transaction.cartItem.findUnique({
      where: { cart_id_sku_id: { cart_id: cart.id, sku_id: input.skuId } },
      select: { id: true, quantity: true, selected: true },
    });
    if (existing) assertStoredCartItem(existing);
    if (existing && existing.quantity === input.quantity && existing.selected === input.selected) {
      return { changed: false, cart: await this.projectCart(transaction, cart!.id) };
    }
    if (!existing && await transaction.cartItem.count({ where: { cart_id: cart.id } }) >= CART_ITEM_LIMIT) {
      throw cartItemLimitExceeded();
    }

    const now = this.currentTime();
    if (existing) {
      await transaction.cartItem.update({
        data: { quantity: input.quantity, selected: input.selected, updated_at: now },
        where: { id: existing.id },
      });
    } else {
      await transaction.cartItem.create({
        data: {
          cart_id: cart.id,
          created_at: now,
          id: generateUlid(now.getTime()),
          quantity: input.quantity,
          selected: input.selected,
          sku_id: input.skuId,
          updated_at: now,
        },
      });
    }
    await this.touchCart(transaction, cart.id, now);
    return { changed: true, cart: await this.projectCart(transaction, cart.id) };
  }

  async deleteItemInTransaction(
    transaction: DatabaseTransaction,
    input: StoreCartIdentityInput & { skuId: string },
  ): Promise<StoreCartMutationResult> {
    requirePlainObject(input, 'Store cart item delete input');
    requireExactKeys(
      input,
      ['accountId', 'customerId', 'skuId'],
      ['accountId', 'customerId', 'skuId'],
      'Store cart item delete input',
    );
    requireUlid(input.accountId, 'Store cart Account ID');
    requireUlid(input.customerId, 'Store cart Customer ID');
    requireUlid(input.skuId, 'Store cart SKU ID');
    const cart = await this.acquireIdentityAndCartLocks(transaction, input);
    if (!cart) return { changed: false, cart: cartSnapshot(null, []) };
    await this.acquireSkuLocks(transaction, [input.skuId]);
    await this.acquireItemLocks(transaction, cart.id, [input.skuId]);
    const deleted = await transaction.cartItem.deleteMany({
      where: { cart_id: cart.id, sku_id: input.skuId },
    });
    if (deleted.count > 0) await this.touchCart(transaction, cart.id, this.currentTime());
    return { changed: deleted.count > 0, cart: await this.projectCart(transaction, cart.id) };
  }

  async mergeCartInTransaction(
    transaction: DatabaseTransaction,
    input: StoreCartMergeInput,
  ): Promise<StoreCartMutationResult> {
    validateMergeInput(input);
    let cart = await this.acquireIdentityAndCartLocks(transaction, input);
    const orderedItems = [...input.items].sort((left, right) =>
      left.skuId < right.skuId ? -1 : left.skuId > right.skuId ? 1 : 0);
    const skuIds = orderedItems.map(({ skuId }) => skuId);
    await this.acquireSkuLocks(transaction, skuIds);
    const skus = await transaction.sku.findMany({
      where: { id: { in: skuIds } },
      select: { id: true },
    });
    if (skus.length !== skuIds.length || skus.some(({ id }) => !skuIds.includes(id))) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'SKU not found');
    }

    if (cart === null) cart = await this.createCart(transaction, input.customerId);
    await this.acquireItemLocks(transaction, cart.id, skuIds);

    const existingItems = await transaction.cartItem.findMany({
      where: { cart_id: cart.id, sku_id: { in: skuIds } },
      select: { id: true, quantity: true, selected: true, sku_id: true },
    });
    existingItems.forEach(assertStoredCartItem);
    const existingBySku = new Map(existingItems.map((item) => [item.sku_id, item]));
    const existingCount = await transaction.cartItem.count({ where: { cart_id: cart.id } });
    const additions = orderedItems.filter(({ skuId }) => !existingBySku.has(skuId)).length;
    if (existingCount + additions > CART_ITEM_LIMIT) throw cartItemLimitExceeded();

    const now = this.currentTime();
    const updates: { id: string; quantity: number; selected: boolean }[] = [];
    const additionsToCreate: {
      cart_id: string;
      created_at: Date;
      id: string;
      quantity: number;
      selected: boolean;
      sku_id: string;
      updated_at: Date;
    }[] = [];
    let createdOffset = 1;
    for (const item of orderedItems) {
      const existing = existingBySku.get(item.skuId);
      if (existing) {
        const quantity = Math.min(CART_QUANTITY_LIMIT, existing.quantity + item.quantity);
        const selected = existing.selected || item.selected;
        if (quantity === existing.quantity && selected === existing.selected) continue;
        updates.push({ id: existing.id, quantity, selected });
      } else {
        additionsToCreate.push({
          cart_id: cart.id,
          created_at: now,
          id: generateUlid(now.getTime() + createdOffset),
          quantity: item.quantity,
          selected: item.selected,
          sku_id: item.skuId,
          updated_at: now,
        });
        createdOffset += 1;
      }
    }
    if (updates.length > 0) {
      const updated = await transaction.$executeRaw(Prisma.sql`
        UPDATE "cart_item" AS item
        SET
          quantity = incoming.quantity,
          selected = incoming.selected,
          updated_at = ${now}
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb)
          AS incoming(id character(26), quantity integer, selected boolean)
        WHERE item.id = incoming.id
          AND item.cart_id = ${cart.id}
      `);
      if (updated !== updates.length) {
        throw new ApplicationError('INTERNAL_ERROR', 'Store cart batch update count is invalid');
      }
    }
    if (additionsToCreate.length > 0) {
      const created = await transaction.cartItem.createMany({ data: additionsToCreate });
      if (created.count !== additionsToCreate.length) {
        throw new ApplicationError('INTERNAL_ERROR', 'Store cart batch insert count is invalid');
      }
    }
    const changed = updates.length > 0 || additionsToCreate.length > 0;
    if (changed) await this.touchCart(transaction, cart.id, now);
    return { changed, cart: await this.projectCart(transaction, cart.id) };
  }
}
