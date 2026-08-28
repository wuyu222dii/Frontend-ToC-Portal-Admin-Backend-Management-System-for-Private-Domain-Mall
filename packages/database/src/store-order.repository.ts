import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock, acquireTransactionLocks } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StoreCheckoutRepository,
  type StoreCheckoutAddressFact,
  type StoreCheckoutLineInput,
  type StoreCheckoutQuoteInput,
  type StoreCheckoutQuoteSnapshot,
  type StoreCheckoutSource,
} from './store-checkout.repository';

const ORDER_ITEM_LIMIT = 100;
const ORDER_QUANTITY_LIMIT = 99;
const PAYMENT_TIMEOUT_MS = 30 * 60 * 1_000;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const PHONE_LAST4 = /^[0-9]{4}$/;

export type StoreOrderSubmitInput = StoreCheckoutQuoteInput;

export interface StoreOrderAddressSnapshotMaterial {
  detailCiphertext: Uint8Array;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
}

export interface StoreOrderCreateHooks {
  protectAddress(
    addressSnapshotId: string,
    address: StoreCheckoutAddressFact,
  ): StoreOrderAddressSnapshotMaterial;
  verifyQuote(snapshot: StoreCheckoutQuoteSnapshot): void;
}

export interface StoreOrderReplayInput {
  accountId: string;
  customerId: string;
  orderId: string;
}

export interface StoreOrderItemSnapshot {
  brandName: string;
  categoryId: string;
  categoryName: string;
  createdAt: Date;
  lineAmount: string;
  orderItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  refundedAmount: string;
  refundedQuantity: number;
  reservedAftersaleAmount: string;
  reservedAftersaleQuantity: number;
  shippedQuantity: number;
  skuCode: string;
  skuId: string;
  skuName: string;
  unitPrice: string;
  version: number;
}

export interface StoreOrderSnapshot {
  amounts: {
    goods: string;
    paid: string;
    payable: string;
    refunded: string;
    shipping: string;
  };
  closeReason: 'FULL_REFUND_BEFORE_SHIPMENT' | 'PAYMENT_TIMEOUT' | 'USER_CANCELLED' | null;
  completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED' | 'FULL_REFUND_AFTER_SHIPMENT' | null;
  createdAt: Date;
  customerId: string;
  fulfillmentStatus: 'CANCELLED' | 'DELIVERED' | 'IN_TRANSIT' | 'NOT_STARTED' | 'READY_TO_SHIP' | 'SHIPPED';
  items: StoreOrderItemSnapshot[];
  orderId: string;
  orderNo: string;
  orderStatus: 'CLOSED' | 'COMPLETED' | 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'SHIPPING';
  payExpiresAt: Date;
  paymentResolution: 'LATE_SUCCESS_REFUND_PENDING' | 'LATE_SUCCESS_REFUNDED' | 'MANUAL_REQUIRED' | 'NORMAL';
  paymentStatus: 'PAID' | 'PROCESSING' | 'UNPAID';
  refundProcessingStatus: 'FAILED' | 'IDLE' | 'REFUNDING';
  refundProgressStatus: 'FULL' | 'NONE' | 'PARTIAL';
  serverTime: Date;
  source: StoreCheckoutSource;
  updatedAt: Date;
  version: number;
}

export interface StoreOrderCreationResult {
  attribution: {
    bindingId: string | null;
    candidateAgentId: string | null;
    candidateId: string;
    submitChannel: 'AGENT' | 'DIRECT';
  };
  inventory: Array<{
    balanceId: string;
    lockedAfter: number;
    lockedBefore: number;
    physicalQty: number;
    skuId: string;
    version: number;
  }>;
  order: StoreOrderSnapshot;
  removedCartItemCount: number;
  reservation: {
    expiresAt: Date;
    reservationId: string;
    status: 'ACTIVE';
  };
}

interface StoreOrderAttribution {
  bindingId: string | null;
  candidateAgentId: string | null;
  submitChannel: 'AGENT' | 'DIRECT';
}

interface HierarchyCandidate {
  id: string;
  inventory_balance: { id: string } | null;
  product: { brand_id: string; category_id: string; id: string };
  product_id: string;
}

interface HierarchyFact {
  balanceId: string | null;
  brandId: string;
  categoryId: string;
  productId: string;
  skuId: string;
}

const ORDER_WITH_ITEMS = {
  items: {
    orderBy: [
      { created_at: 'asc' },
      { id: 'asc' },
    ] satisfies Prisma.OrderItemOrderByWithRelationInput[],
  },
} satisfies Prisma.SalesOrderInclude;

type StoreOrderRecord = Prisma.SalesOrderGetPayload<{ include: typeof ORDER_WITH_ITEMS }>;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactKeys(
  value: unknown,
  fields: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!plainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const expected = new Set(fields);
  const keys = Object.keys(value);
  if (keys.length !== expected.size || keys.some((key) => !expected.has(key))) {
    throw new TypeError(`${label} contains unsupported or missing fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireQuantity(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > ORDER_QUANTITY_LIMIT) {
    throw new TypeError(`${label} must be an integer between 1 and ${ORDER_QUANTITY_LIMIT}`);
  }
}

function compareSku(left: { skuId: string }, right: { skuId: string }): number {
  return left.skuId < right.skuId ? -1 : left.skuId > right.skuId ? 1 : 0;
}

function validateSubmitInput(input: StoreOrderSubmitInput): StoreCheckoutLineInput[] {
  requireExactKeys(input, ['accountId', 'addressId', 'customerId', 'items', 'source'], 'Store order input');
  requireUlid(input.accountId, 'Store order Account ID');
  requireUlid(input.customerId, 'Store order Customer ID');
  requireUlid(input.addressId, 'Store order address ID');
  if (input.source !== 'CART' && input.source !== 'BUY_NOW') throw new TypeError('Store order source is invalid');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > ORDER_ITEM_LIMIT) {
    throw new TypeError(`Store order items must contain 1 to ${ORDER_ITEM_LIMIT} entries`);
  }
  if (input.source === 'BUY_NOW' && input.items.length !== 1) {
    throw new TypeError('BUY_NOW order must contain exactly one item');
  }
  const skuIds = new Set<string>();
  const items = input.items.map((item) => {
    requireExactKeys(item, ['quantity', 'skuId'], 'Store order item');
    requireUlid(item.skuId, 'Store order SKU ID');
    requireQuantity(item.quantity, 'Store order quantity');
    if (skuIds.has(item.skuId)) throw new TypeError('Store order SKU IDs must be unique');
    skuIds.add(item.skuId);
    return { quantity: item.quantity, skuId: item.skuId };
  });
  return items.sort(compareSku);
}

function validateReplayInput(input: StoreOrderReplayInput): void {
  requireExactKeys(input, ['accountId', 'customerId', 'orderId'], 'Store order replay input');
  requireUlid(input.accountId, 'Store order replay Account ID');
  requireUlid(input.customerId, 'Store order replay Customer ID');
  requireUlid(input.orderId, 'Store order replay order ID');
}

function validateHooks(hooks: StoreOrderCreateHooks): void {
  requireExactKeys(hooks, ['protectAddress', 'verifyQuote'], 'Store order hooks');
  if (typeof hooks.protectAddress !== 'function' || typeof hooks.verifyQuote !== 'function') {
    throw new TypeError('Store order hooks must be functions');
  }
}

function internalError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function orderNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Order not found');
}

function requoteRequired(message = 'Checkout facts changed; request a new quote'): ApplicationError {
  return new ApplicationError('CHECKOUT_REQUOTE_REQUIRED', message);
}

function uniqueSortedUlids(values: readonly string[], label: string): string[] {
  values.forEach((value) => {
    if (!isValidUlid(value)) throw internalError(`${label} contains an invalid ID`);
  });
  return [...new Set(values)].sort();
}

function hierarchyFacts(
  candidates: readonly HierarchyCandidate[],
  requestedSkuIds: readonly string[],
): HierarchyFact[] | null {
  if (candidates.length !== requestedSkuIds.length) return null;
  const bySkuId = new Map<string, HierarchyCandidate>();
  for (const candidate of candidates) {
    if (!isValidUlid(candidate.id) || !isValidUlid(candidate.product_id) ||
      !isValidUlid(candidate.product.id) || !isValidUlid(candidate.product.brand_id) ||
      !isValidUlid(candidate.product.category_id) ||
      (candidate.inventory_balance !== null && !isValidUlid(candidate.inventory_balance.id))) {
      throw internalError('Store order catalog hierarchy contains an invalid ID');
    }
    if (candidate.product.id !== candidate.product_id || bySkuId.has(candidate.id)) {
      throw internalError('Store order catalog hierarchy is inconsistent');
    }
    bySkuId.set(candidate.id, candidate);
  }
  const facts: HierarchyFact[] = [];
  for (const skuId of requestedSkuIds) {
    const candidate = bySkuId.get(skuId);
    if (!candidate) return null;
    facts.push({
      balanceId: candidate.inventory_balance?.id ?? null,
      brandId: candidate.product.brand_id,
      categoryId: candidate.product.category_id,
      productId: candidate.product_id,
      skuId,
    });
  }
  return facts;
}

function sameHierarchyFacts(left: readonly HierarchyFact[], right: readonly HierarchyFact[]): boolean {
  return left.length === right.length && left.every((fact, index) => {
    const current = right[index];
    return current !== undefined && fact.balanceId === current.balanceId && fact.brandId === current.brandId &&
      fact.categoryId === current.categoryId && fact.productId === current.productId && fact.skuId === current.skuId;
  });
}

function safeStoredText(value: string, maximum: number, label: string): string {
  const characters = typeof value === 'string' ? Array.from(value) : [];
  if (typeof value !== 'string' || value.trim().length === 0 || characters.length < 1 ||
    characters.length > maximum ||
    characters.some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })) {
    throw internalError(`${label} is invalid`);
  }
  return value;
}

function safeVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POSTGRES_INTEGER) {
    throw internalError(`${label} version is invalid`);
  }
  return value;
}

function safeCounter(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_POSTGRES_INTEGER) {
    throw internalError(`${label} is invalid`);
  }
  return value;
}

function safeDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internalError(`${label} is invalid`);
  return new Date(value);
}

function safeMoney(value: Prisma.Decimal, label: string, positive = false): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || (positive && !value.greaterThan(0)) ||
    value.decimalPlaces() > 2 || value.greaterThan('9999999999999999.99')) {
    throw internalError(`${label} is invalid`);
  }
  return value.toFixed(2);
}

function isThenable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'then' in value &&
    typeof (value as { then?: unknown }).then === 'function';
}

function protectedAddressMaterial(value: StoreOrderAddressSnapshotMaterial): StoreOrderAddressSnapshotMaterial {
  requireExactKeys(
    value,
    ['detailCiphertext', 'encryptionKeyId', 'phoneCiphertext', 'phoneLast4'],
    'Store order protected address',
  );
  if (!(value.detailCiphertext instanceof Uint8Array) || value.detailCiphertext.byteLength < 1 ||
    !(value.phoneCiphertext instanceof Uint8Array) || value.phoneCiphertext.byteLength < 1 ||
    typeof value.encryptionKeyId !== 'string' || value.encryptionKeyId.length < 1 ||
    value.encryptionKeyId.length > 80 || /[^\x20-\x7e]/.test(value.encryptionKeyId) ||
    typeof value.phoneLast4 !== 'string' || !PHONE_LAST4.test(value.phoneLast4)) {
    throw internalError('Store order protected address is invalid');
  }
  return {
    detailCiphertext: Buffer.from(value.detailCiphertext),
    encryptionKeyId: value.encryptionKeyId,
    phoneCiphertext: Buffer.from(value.phoneCiphertext),
    phoneLast4: value.phoneLast4,
  };
}

function orderItemSnapshot(record: StoreOrderRecord['items'][number]): StoreOrderItemSnapshot {
  const unitPrice = safeMoney(record.unit_price, 'Stored order item unit price', true);
  const lineAmount = safeMoney(record.line_paid_amount, 'Stored order item line amount', true);
  const quantity = safeCounter(record.quantity, 'Stored order item quantity');
  if (quantity < 1 || !new Prisma.Decimal(unitPrice).mul(quantity).equals(lineAmount)) {
    throw internalError('Stored order item amount is inconsistent');
  }
  return {
    brandName: safeStoredText(record.brand_name_snapshot, 120, 'Stored order item brand name'),
    categoryId: record.category_id,
    categoryName: safeStoredText(record.category_name_snapshot, 120, 'Stored order item category name'),
    createdAt: safeDate(record.created_at, 'Stored order item creation time'),
    lineAmount,
    orderItemId: record.id,
    productId: record.product_id,
    productName: safeStoredText(record.product_name_snapshot, 200, 'Stored order item product name'),
    quantity,
    refundedAmount: safeMoney(record.refunded_amount, 'Stored order item refunded amount'),
    refundedQuantity: safeCounter(record.refunded_qty, 'Stored order item refunded quantity'),
    reservedAftersaleAmount: safeMoney(
      record.aftersale_reserved_amount,
      'Stored order item reserved aftersale amount',
    ),
    reservedAftersaleQuantity: safeCounter(
      record.aftersale_reserved_qty,
      'Stored order item reserved aftersale quantity',
    ),
    shippedQuantity: safeCounter(record.shipped_qty, 'Stored order item shipped quantity'),
    skuCode: safeStoredText(record.sku_code_snapshot, 80, 'Stored order item SKU code'),
    skuId: record.sku_id,
    skuName: safeStoredText(record.sku_name_snapshot, 160, 'Stored order item SKU name'),
    unitPrice,
    version: safeVersion(record.version, 'Stored order item'),
  };
}

function orderSnapshot(record: StoreOrderRecord, serverTime: Date): StoreOrderSnapshot {
  const goods = safeMoney(record.goods_amount, 'Stored order goods amount');
  const shipping = safeMoney(record.shipping_amount, 'Stored order shipping amount');
  const payable = safeMoney(record.payable_amount, 'Stored order payable amount');
  if (!new Prisma.Decimal(goods).plus(shipping).equals(payable)) {
    throw internalError('Stored order amount is inconsistent');
  }
  return {
    amounts: {
      goods,
      paid: safeMoney(record.paid_amount, 'Stored order paid amount'),
      payable,
      refunded: safeMoney(record.refunded_amount, 'Stored order refunded amount'),
      shipping,
    },
    closeReason: record.close_reason,
    completionReason: record.completion_reason,
    createdAt: safeDate(record.created_at, 'Stored order creation time'),
    customerId: record.customer_id,
    fulfillmentStatus: record.fulfillment_status,
    items: record.items.map(orderItemSnapshot),
    orderId: record.id,
    orderNo: record.order_no,
    orderStatus: record.order_status,
    payExpiresAt: safeDate(record.pay_expires_at, 'Stored order payment expiry'),
    paymentResolution: record.payment_resolution,
    paymentStatus: record.payment_status,
    refundProcessingStatus: record.refund_processing_status,
    refundProgressStatus: record.refund_progress_status,
    serverTime: safeDate(serverTime, 'Store order server time'),
    source: record.source,
    updatedAt: safeDate(record.updated_at, 'Stored order update time'),
    version: safeVersion(record.version, 'Stored order'),
  };
}

export class StoreOrderRepository {
  private readonly checkout: StoreCheckoutRepository;

  constructor(prisma: PrismaClient) {
    this.checkout = new StoreCheckoutRepository(prisma);
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const value = rows[0]?.transaction_time;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw internalError('Database transaction clock is unavailable');
    }
    return new Date(value);
  }

  private async acquireCustomerLocks(
    transaction: DatabaseTransaction,
    input: Pick<StoreOrderSubmitInput, 'accountId' | 'customerId'>,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'store-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [input.customerId]);
    const account = await transaction.account.findUnique({
      where: { id: input.accountId },
      select: {
        customer_profile: { select: { account_id: true, anonymized_at: true, id: true } },
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
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

  private async acquireCartLocks(
    transaction: DatabaseTransaction,
    input: StoreOrderSubmitInput,
    requestedItems: readonly StoreCheckoutLineInput[],
  ): Promise<string | null> {
    if (input.source === 'BUY_NOW') return null;
    await acquireTransactionLock(transaction, 'store-cart', [input.customerId]);
    const cart = await transaction.cart.findUnique({
      where: { customer_id: input.customerId },
      select: { id: true },
    });
    if (!cart) return null;
    const selected = await transaction.cartItem.findMany({
      orderBy: [{ sku_id: 'asc' }],
      select: { sku_id: true },
      where: { cart_id: cart.id, selected: true },
    });
    const itemSkuIds = uniqueSortedUlids(
      [...requestedItems.map(({ skuId }) => skuId), ...selected.map(({ sku_id }) => sku_id)],
      'Store order cart item lock set',
    );
    await acquireTransactionLocks(transaction, itemSkuIds.map((skuId) => ({
      namespace: 'store-cart-item',
      parts: [cart.id, skuId],
    })));
    return cart.id;
  }

  private async acquireAddressLocks(transaction: DatabaseTransaction, input: StoreOrderSubmitInput): Promise<void> {
    await acquireTransactionLock(transaction, 'store-address-set', [input.customerId]);
    await acquireTransactionLock(transaction, 'store-address', [input.addressId]);
  }

  private async readAttribution(
    transaction: DatabaseTransaction,
    customerId: string,
  ): Promise<StoreOrderAttribution> {
    await acquireTransactionLock(transaction, 'store-attribution-binding', [customerId]);
    const initial = await transaction.customerAgentBinding.findMany({
      orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
      select: { agent_id: true, id: true },
      take: 2,
      where: { customer_id: customerId, ended_at: null },
    });
    if (initial.length > 1) throw internalError('Customer has multiple current service-agent bindings');
    const binding = initial[0];
    if (!binding) return { bindingId: null, candidateAgentId: null, submitChannel: 'DIRECT' };
    requireUlid(binding.id, 'Store order binding ID');
    requireUlid(binding.agent_id, 'Store order candidate agent ID');
    await acquireTransactionLock(transaction, 'store-attribution-agent', [binding.agent_id]);
    const current = await transaction.customerAgentBinding.findMany({
      orderBy: [{ started_at: 'asc' }, { id: 'asc' }],
      select: {
        agent: {
          select: {
            account: { select: { deleted_at: true, role: true, status: true } },
            deleted_at: true,
            id: true,
            status: true,
          },
        },
        agent_id: true,
        id: true,
      },
      take: 2,
      where: { customer_id: customerId, ended_at: null },
    });
    if (current.length > 1) throw internalError('Customer has multiple current service-agent bindings');
    const locked = current[0];
    if (!locked || locked.id !== binding.id || locked.agent_id !== binding.agent_id ||
      locked.agent.id !== binding.agent_id || locked.agent.status !== 'ACTIVE' ||
      locked.agent.deleted_at !== null || locked.agent.account.role !== 'AGENT_ADMIN' ||
      locked.agent.account.status !== 'ACTIVE' || locked.agent.account.deleted_at !== null) {
      return { bindingId: null, candidateAgentId: null, submitChannel: 'DIRECT' };
    }
    return {
      bindingId: locked.id,
      candidateAgentId: locked.agent_id,
      submitChannel: 'AGENT',
    };
  }

  private async acquireCatalogAndInventoryLocks(
    transaction: DatabaseTransaction,
    requestedItems: readonly StoreCheckoutLineInput[],
  ): Promise<void> {
    const skuIds = requestedItems.map(({ skuId }) => skuId);
    const candidates = await transaction.sku.findMany({
      select: {
        id: true,
        inventory_balance: { select: { id: true } },
        product: { select: { brand_id: true, category_id: true, id: true } },
        product_id: true,
      },
      where: { id: { in: skuIds } },
    }) as HierarchyCandidate[];
    const orderedLocks = [
      ...uniqueSortedUlids(candidates.map(({ product }) => product.brand_id), 'Store order brand lock set')
        .map((id) => ({ namespace: 'master-data-brand', parts: [id] })),
      ...uniqueSortedUlids(candidates.map(({ product }) => product.category_id), 'Store order category lock set')
        .map((id) => ({ namespace: 'master-data-category', parts: [id] })),
      ...uniqueSortedUlids(candidates.map(({ product_id }) => product_id), 'Store order product lock set')
        .map((id) => ({ namespace: 'master-data-product', parts: [id] })),
      ...uniqueSortedUlids(skuIds, 'Store order SKU lock set')
        .map((id) => ({ namespace: 'product-catalog-sku', parts: [id] })),
      ...uniqueSortedUlids(
        candidates.flatMap(({ inventory_balance }) => inventory_balance ? [inventory_balance.id] : []),
        'Store order inventory balance lock set',
      ).map((id) => ({ namespace: 'inventory-balance', parts: [id] })),
    ];
    await acquireTransactionLocks(transaction, orderedLocks);
    const lockedCandidates = await transaction.sku.findMany({
      select: {
        id: true,
        inventory_balance: { select: { id: true } },
        product: { select: { brand_id: true, category_id: true, id: true } },
        product_id: true,
      },
      where: { id: { in: skuIds } },
    }) as HierarchyCandidate[];
    const initialFacts = hierarchyFacts(candidates, skuIds);
    const lockedFacts = hierarchyFacts(lockedCandidates, skuIds);
    if (initialFacts === null || lockedFacts === null || !sameHierarchyFacts(initialFacts, lockedFacts)) {
      throw requoteRequired('Checkout catalog hierarchy changed; request a new quote');
    }
  }

  private assertCreateSnapshot(
    snapshot: StoreCheckoutQuoteSnapshot,
    input: StoreOrderSubmitInput,
    lockedCartId: string | null,
  ): void {
    if (!snapshot.canSubmit || snapshot.blockers.length !== 0 || snapshot.source !== input.source ||
      snapshot.address.addressId !== input.addressId || snapshot.address.customerId !== input.customerId ||
      snapshot.shippingAmount !== '0.00' || snapshot.goodsAmount !== snapshot.payableAmount ||
      (input.source === 'CART' && snapshot.cart.cartId !== lockedCartId)) {
      throw requoteRequired();
    }
    const requested = [...input.items].sort(compareSku);
    if (snapshot.items.length !== requested.length) throw requoteRequired();
    for (const [index, item] of snapshot.items.entries()) {
      const expected = requested[index];
      if (!expected || item.skuId !== expected.skuId || item.quantity !== expected.quantity || !item.saleable ||
        item.inventoryBalanceId === null || item.inventoryVersion === null || item.physicalQty === null ||
        item.lockedQty === null || item.availableStock < item.quantity ||
        item.physicalQty - item.lockedQty !== item.availableStock) {
        throw requoteRequired();
      }
      safeStoredText(item.productName, 200, 'Store order product name');
      safeStoredText(item.brandName, 120, 'Store order brand name');
      safeStoredText(item.categoryName, 120, 'Store order category name');
      safeStoredText(item.skuName, 160, 'Store order SKU name');
      safeStoredText(item.skuCode, 80, 'Store order SKU code');
      safeVersion(item.inventoryVersion, 'Store order inventory');
    }
  }

  private async readOwnedOrder(
    transaction: DatabaseTransaction,
    customerId: string,
    orderId: string,
    serverTime: Date,
  ): Promise<StoreOrderSnapshot> {
    const order = await transaction.salesOrder.findFirst({
      include: ORDER_WITH_ITEMS,
      where: { customer_id: customerId, id: orderId },
    });
    if (!order) throw orderNotFound();
    return orderSnapshot(order, serverTime);
  }

  async createOrderInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderSubmitInput,
    hooks: StoreOrderCreateHooks,
  ): Promise<StoreOrderCreationResult> {
    const requestedItems = validateSubmitInput(input);
    validateHooks(hooks);
    await this.acquireCustomerLocks(transaction, input);
    const lockedCartId = await this.acquireCartLocks(transaction, input, requestedItems);
    await this.acquireAddressLocks(transaction, input);
    const attribution = await this.readAttribution(transaction, input.customerId);
    await this.acquireCatalogAndInventoryLocks(transaction, requestedItems);

    const snapshot = await this.checkout.quoteInTransaction(transaction, input);
    const verification = hooks.verifyQuote(snapshot);
    if (verification !== undefined || isThenable(verification)) {
      throw new TypeError('Store order quote verification must be synchronous and return void');
    }
    this.assertCreateSnapshot(snapshot, input, lockedCartId);

    const occurredAt = await this.transactionTime(transaction);
    const payExpiresAt = new Date(occurredAt.getTime() + PAYMENT_TIMEOUT_MS);
    const orderId = generateUlid(occurredAt.getTime());
    const addressSnapshotId = generateUlid(occurredAt.getTime());
    const attributionCandidateId = generateUlid(occurredAt.getTime());
    const reservationId = generateUlid(occurredAt.getTime());
    const addressMaterialValue = hooks.protectAddress(addressSnapshotId, snapshot.address);
    if (isThenable(addressMaterialValue)) {
      throw new TypeError('Store order address protection must be synchronous');
    }
    const addressMaterial = protectedAddressMaterial(addressMaterialValue);

    await transaction.salesOrder.create({
      data: {
        aftersale_expires_at: null,
        business_rule_version_id: null,
        close_reason: null,
        closed_at: null,
        completed_at: null,
        completion_reason: null,
        created_at: occurredAt,
        customer_id: input.customerId,
        final_agent_id: null,
        final_channel: null,
        fulfillment_status: 'NOT_STARTED',
        goods_amount: new Prisma.Decimal(snapshot.goodsAmount),
        id: orderId,
        order_no: `QX${orderId}`,
        order_status: 'PENDING_PAYMENT',
        paid_amount: new Prisma.Decimal(0),
        paid_at: null,
        pay_expires_at: payExpiresAt,
        payable_amount: new Prisma.Decimal(snapshot.payableAmount),
        payment_resolution: 'NORMAL',
        payment_status: 'UNPAID',
        refund_processing_status: 'IDLE',
        refund_progress_status: 'NONE',
        refunded_amount: new Prisma.Decimal(0),
        shipping_amount: new Prisma.Decimal(snapshot.shippingAmount),
        source: input.source,
        updated_at: occurredAt,
        version: 1,
      },
      select: { id: true },
    });

    const itemWrites = snapshot.items.map((item) => ({
      aftersale_reserved_amount: new Prisma.Decimal(0),
      aftersale_reserved_qty: 0,
      brand_name_snapshot: item.brandName,
      category_id: item.categoryId,
      category_name_snapshot: item.categoryName,
      created_at: occurredAt,
      id: generateUlid(occurredAt.getTime()),
      line_paid_amount: new Prisma.Decimal(item.lineAmount),
      order_id: orderId,
      pre_shipment_refunded_qty: 0,
      product_id: item.productId,
      product_name_snapshot: item.productName,
      quantity: item.quantity,
      refunded_amount: new Prisma.Decimal(0),
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: item.skuCode,
      sku_id: item.skuId,
      sku_name_snapshot: item.skuName,
      unit_price: new Prisma.Decimal(item.unitPrice),
      version: 1,
    }));
    const createdItems = await transaction.orderItem.createMany({ data: itemWrites });
    if (createdItems.count !== itemWrites.length) throw internalError('Store order item insert count is invalid');

    await transaction.orderAddressSnapshot.create({
      data: {
        city: safeStoredText(snapshot.address.city, 80, 'Store order address city'),
        created_at: occurredAt,
        detail_ciphertext: Buffer.from(addressMaterial.detailCiphertext),
        district: safeStoredText(snapshot.address.district, 80, 'Store order address district'),
        encryption_key_id: addressMaterial.encryptionKeyId,
        id: addressSnapshotId,
        order_id: orderId,
        phone_ciphertext: Buffer.from(addressMaterial.phoneCiphertext),
        phone_last4: addressMaterial.phoneLast4,
        province: safeStoredText(snapshot.address.province, 80, 'Store order address province'),
        recipient_name: safeStoredText(snapshot.address.recipientName, 80, 'Store order address recipient'),
      },
      select: { id: true },
    });
    await transaction.orderAttributionCandidate.create({
      data: {
        binding_id: attribution.bindingId,
        candidate_agent_id: attribution.candidateAgentId,
        finalization_result: null,
        finalized_at: null,
        id: attributionCandidateId,
        order_id: orderId,
        submit_channel: attribution.submitChannel,
        submitted_at: occurredAt,
      },
      select: { id: true },
    });
    await transaction.inventoryReservation.create({
      data: {
        consumed_at: null,
        created_at: occurredAt,
        expires_at: payExpiresAt,
        id: reservationId,
        order_id: orderId,
        released_at: null,
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    const reservationItems = snapshot.items.map((item) => ({
      created_at: occurredAt,
      id: generateUlid(occurredAt.getTime()),
      quantity: item.quantity,
      reservation_id: reservationId,
      sku_id: item.skuId,
    }));
    const createdReservationItems = await transaction.inventoryReservationItem.createMany({
      data: reservationItems,
    });
    if (createdReservationItems.count !== reservationItems.length) {
      throw internalError('Store order reservation item insert count is invalid');
    }

    const inventory: StoreOrderCreationResult['inventory'] = [];
    const ledgerWrites: Prisma.InventoryLedgerCreateManyInput[] = [];
    for (const item of [...snapshot.items].sort(compareSku)) {
      const balanceId = item.inventoryBalanceId;
      const version = item.inventoryVersion;
      const physicalQty = item.physicalQty;
      const lockedQty = item.lockedQty;
      if (balanceId === null || version === null || physicalQty === null || lockedQty === null) {
        throw requoteRequired();
      }
      const lockedAfter = lockedQty + item.quantity;
      if (lockedAfter > physicalQty || lockedAfter > MAX_POSTGRES_INTEGER) throw requoteRequired();
      const updated = await transaction.inventoryBalance.updateMany({
        data: { locked_qty: lockedAfter, updated_at: occurredAt, version: { increment: 1 } },
        where: {
          id: balanceId,
          locked_qty: lockedQty,
          physical_qty: physicalQty,
          sku_id: item.skuId,
          version,
        },
      });
      if (updated.count !== 1) throw requoteRequired();
      inventory.push({
        balanceId,
        lockedAfter,
        lockedBefore: lockedQty,
        physicalQty,
        skuId: item.skuId,
        version: version + 1,
      });
      ledgerWrites.push({
        actor_account_id: input.accountId,
        business_id: reservationId,
        id: generateUlid(occurredAt.getTime()),
        ledger_type: 'ORDER_RESERVE' as const,
        locked_after: lockedAfter,
        locked_change: item.quantity,
        occurred_at: occurredAt,
        physical_after: physicalQty,
        physical_change: 0,
        reason: 'ORDER_RESERVE',
        sku_id: item.skuId,
      });
    }
    const createdLedgers = await transaction.inventoryLedger.createMany({ data: ledgerWrites });
    if (createdLedgers.count !== ledgerWrites.length) {
      throw internalError('Store order inventory ledger insert count is invalid');
    }

    let removedCartItemCount = 0;
    if (input.source === 'CART') {
      if (lockedCartId === null) throw requoteRequired();
      const deleted = await transaction.cartItem.deleteMany({
        where: {
          OR: requestedItems.map(({ quantity, skuId }) => ({ quantity, sku_id: skuId })),
          cart_id: lockedCartId,
          selected: true,
        },
      });
      if (deleted.count !== requestedItems.length) throw requoteRequired();
      removedCartItemCount = deleted.count;
      const touched = await transaction.cart.updateMany({
        data: { updated_at: occurredAt },
        where: { customer_id: input.customerId, id: lockedCartId },
      });
      if (touched.count !== 1) throw requoteRequired();
    }

    return {
      attribution: {
        ...attribution,
        candidateId: attributionCandidateId,
      },
      inventory,
      order: await this.readOwnedOrder(transaction, input.customerId, orderId, occurredAt),
      removedCartItemCount,
      reservation: { expiresAt: payExpiresAt, reservationId, status: 'ACTIVE' },
    };
  }

  async getOwnedOrderForReplayInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderReplayInput,
  ): Promise<StoreOrderSnapshot> {
    validateReplayInput(input);
    await this.acquireCustomerLocks(transaction, input);
    await acquireTransactionLock(transaction, 'store-order', [input.orderId]);
    const serverTime = await this.transactionTime(transaction);
    return this.readOwnedOrder(transaction, input.customerId, input.orderId, serverTime);
  }
}
