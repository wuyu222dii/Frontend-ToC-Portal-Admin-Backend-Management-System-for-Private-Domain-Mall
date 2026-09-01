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
const ORDER_CLOSE_RECONCILE_DELAY_MS = 60_000;
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

export type StoreOrderDisplayGroup =
  | 'ALL'
  | 'COMPLETED'
  | 'PENDING_PAYMENT'
  | 'PENDING_SHIPMENT'
  | 'REFUND_AFTERSALE'
  | 'SHIPPING';

export type StoreOrderListSort = 'AMOUNT_DESC' | 'CREATED_DESC' | 'PAID_DESC';

export interface StoreOrderListInput {
  customerId: string;
  page: number;
  pageSize: number;
  displayGroup: StoreOrderDisplayGroup;
  sort: StoreOrderListSort;
  orderNo?: string;
  orderStatus?: StoreOrderSnapshot['orderStatus'];
  paymentStatus?: StoreOrderSnapshot['paymentStatus'];
  refundProgressStatus?: StoreOrderSnapshot['refundProgressStatus'];
  refundProcessingStatus?: StoreOrderSnapshot['refundProcessingStatus'];
  fulfillmentStatus?: StoreOrderSnapshot['fulfillmentStatus'];
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  minAmount?: string;
  maxAmount?: string;
}

export interface StoreOrderListItemSnapshot {
  aftersaleSummary: {
    activeCount: number;
    latestAftersaleId: string | null;
    latestStatus:
      | 'CANCELLED'
      | 'COMPLETED'
      | 'PENDING_REVIEW'
      | 'REFUND_FAILED'
      | 'REFUNDING'
      | 'REFUNDING_AFTER_RETURN'
      | 'REJECTED'
      | 'REJECTED_AFTER_RETURN'
      | 'RETURN_EXCEPTION'
      | 'WAITING_RECEIPT'
      | 'WAITING_RETURN'
      | null;
    refundedAmount: string;
  };
  canApplyAftersale: boolean;
  canCancel: boolean;
  canPay: boolean;
  itemImages: Array<{ objectKey: string | null; orderItemId: string }>;
  order: StoreOrderSnapshot;
}

export interface StoreOrderListResult {
  items: StoreOrderListItemSnapshot[];
  total: number;
}

export interface StoreOrderAddressSnapshot {
  city: string;
  detailCiphertext: Uint8Array;
  district: string;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
  province: string;
  recipientName: string;
  snapshotId: string;
}

export interface StoreOrderDetailSnapshot {
  address: StoreOrderAddressSnapshot;
  aftersales: StoreOrderAftersaleSnapshot[];
  canApplyAftersale: boolean;
  canCancel: boolean;
  canPay: boolean;
  closedAt: Date | null;
  order: StoreOrderSnapshot;
  paymentAttempts: StoreOrderPaymentAttemptSnapshot[];
  refundAttempts: StoreOrderRefundAttemptSnapshot[];
}

export interface StoreOrderAftersaleSnapshot {
  aftersaleId: string;
  aftersaleNo: string;
  createdAt: Date;
  requestedAmount: string;
  status:
    | 'CANCELLED'
    | 'COMPLETED'
    | 'PENDING_REVIEW'
    | 'REFUND_FAILED'
    | 'REFUNDING'
    | 'REFUNDING_AFTER_RETURN'
    | 'REJECTED'
    | 'REJECTED_AFTER_RETURN'
    | 'RETURN_EXCEPTION'
    | 'WAITING_RECEIPT'
    | 'WAITING_RETURN';
  type: 'REFUND_ONLY' | 'RETURN_REFUND';
}

export interface StoreOrderPaymentAttemptSnapshot {
  amount: string;
  createdAt: Date;
  failureCode: string | null;
  intentNo: string;
  paymentAttemptId: string;
  providerTransactionId: string | null;
  status: 'CANCELLED' | 'FAILED' | 'INITIATED' | 'SUCCEEDED' | 'SUCCEEDED_LATE';
  updatedAt: Date;
}

export interface StoreOrderRefundAttemptSnapshot {
  amount: string;
  attemptNo: number;
  createdAt: Date;
  failureCode: string | null;
  originType: 'AFTERSALE' | 'LATE_PAYMENT' | 'MANUAL_COMPENSATION';
  refundId: string;
  refundNo: string;
  status: 'FAILED' | 'INITIATED' | 'PROCESSING' | 'SUCCEEDED';
  updatedAt: Date;
}

export interface StoreOrderReadInput {
  customerId: string;
  orderId: string;
}

export interface StoreOrderCancelInput extends StoreOrderReplayInput {
  expectedVersion: number;
}

export interface StoreOrderCloseResult {
  before: StoreOrderSnapshot;
  changed: boolean;
  order: StoreOrderSnapshot;
  reservationId: string | null;
}

export type StoreOrderTimeoutResult =
  | { kind: 'closed'; result: StoreOrderCloseResult }
  | { kind: 'skipped' }
  | { kind: 'none' };

export type StoreOrderTimeoutIntegrityCode =
  | 'ACTIVE_RESERVATION_MISSING'
  | 'INVENTORY_BALANCE_INVALID'
  | 'ORDER_ITEMS_MISSING'
  | 'ORDER_RESERVATION_ITEMS_MISMATCH';

export interface StoreOrderTimeoutIntegrityCursor {
  orderId: string;
  payExpiresAt: Date;
}

export interface StoreOrderTimeoutIntegrityIssue extends StoreOrderTimeoutIntegrityCursor {
  issue: StoreOrderTimeoutIntegrityCode;
}

/**
 * A bounded, stable view of every order eligible for timeout processing.  This
 * deliberately differs from the integrity-issue scan: an order without an
 * integrity issue must still advance the cursor so a later problematic order
 * cannot be skipped.  Callers should pass `nextCursor` back as `after` until
 * it is null, then start a new cycle.
 */
export interface StoreOrderTimeoutCandidate {
  orderId: string;
  payExpiresAt: Date;
}

export interface StoreOrderTimeoutCandidatePage {
  items: StoreOrderTimeoutCandidate[];
  nextCursor: StoreOrderTimeoutIntegrityCursor | null;
}

export type StoreOrderCloseMode = 'PAYMENT_TIMEOUT' | 'USER_CANCELLED';

/**
 * The close workflow is deliberately split around the Provider call.  These
 * records contain only the immutable identifiers and state required by the
 * caller to perform that external operation; Provider payloads and secrets
 * never cross the database boundary.
 */
export interface StoreOrderClosePaymentIntent {
  amount: string;
  closeRequestedAt: Date | null;
  expiresAt: Date;
  intentNo: string;
  paymentIntentId: string;
  provider: 'MOCK' | 'WECHAT';
  providerIntentId: string | null;
  status: 'CANCELLED' | 'CLOSED' | 'CLOSE_PENDING' | 'CREATING' | 'EXPIRED' | 'FAILED' | 'OPEN' | 'SUCCEEDED';
  version: number;
}

export type StoreOrderCloseClaimKind = 'CLOSED' | 'PROVIDER_REQUIRED' | 'PENDING' | 'SKIPPED';

export interface StoreOrderCloseClaimInput {
  accountId?: string;
  customerId?: string;
  expectedVersion?: number;
  mode: StoreOrderCloseMode;
  orderId: string;
}

export interface StoreOrderCloseClaimResult {
  before: StoreOrderSnapshot;
  changed: boolean;
  kind: StoreOrderCloseClaimKind;
  mode: StoreOrderCloseMode;
  order: StoreOrderSnapshot;
  paymentIntent: StoreOrderClosePaymentIntent | null;
  providerOperation: 'CLOSE' | 'QUERY' | null;
  reservationId: string | null;
}

export type StoreOrderCloseClaimNextResult = StoreOrderCloseClaimResult | { kind: 'NONE' };

export type StoreOrderCloseProviderOutcome =
  | 'CANCELLED'
  | 'CLOSED'
  | 'EXPIRED'
  | 'FAILED'
  | 'NOT_FOUND'
  | 'OPEN'
  | 'SUCCEEDED'
  | 'UNKNOWN';

export interface StoreOrderCloseProviderInput {
  occurredAt?: Date | null;
  outcome: StoreOrderCloseProviderOutcome;
  paymentIntentId: string;
  providerEventId?: string | null;
  providerIntentId?: string | null;
  providerState?: string | null;
  providerTransactionId?: string | null;
  errorCode?: string | null;
  nextReconcileAt?: Date | null;
  orderId: string;
  expectedIntentVersion: number;
}

export interface StoreOrderTerminalCloseRepairInput {
  expectedIntentVersion: number;
  orderId: string;
  paymentIntentId: string;
}

export type StoreOrderCloseFinalizeKind = 'CLOSED' | 'PAYMENT_CONFIRMED' | 'PENDING';

export interface StoreOrderCloseFinalizeResult {
  kind: StoreOrderCloseFinalizeKind;
  order: StoreOrderSnapshot;
  paymentIntent: StoreOrderClosePaymentIntent;
  reservationId: string | null;
  closeResult: StoreOrderCloseResult | null;
}

interface LockedPaymentIntentForClose {
  amount: Prisma.Decimal;
  close_attempt_count: number;
  close_requested_at: Date | null;
  closed_at: Date | null;
  expires_at: Date;
  id: string;
  intent_no: string;
  last_error_code: string | null;
  next_reconcile_at: Date | null;
  order_id: string;
  provider: 'MOCK' | 'WECHAT';
  provider_intent_id: string | null;
  provider_state: string | null;
  reconciliation_attempt_count: number;
  status: StoreOrderClosePaymentIntent['status'];
  updated_at: Date;
  version: number;
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

const ORDER_READ_INCLUDE = {
  _count: {
    select: {
      aftersales: {
        where: {
          status: { notIn: ['CANCELLED', 'COMPLETED', 'REJECTED', 'REJECTED_AFTER_RETURN'] },
          type: { in: ['REFUND_ONLY', 'RETURN_REFUND'] },
        },
      },
    },
  },
  aftersales: {
    orderBy: [
      { created_at: 'desc' },
      { id: 'desc' },
    ] satisfies Prisma.AftersaleOrderByWithRelationInput[],
    select: { id: true, status: true },
    take: 1,
    where: { type: { in: ['REFUND_ONLY', 'RETURN_REFUND'] } },
  },
  inventory_reservation: { select: { id: true, status: true } },
  items: ORDER_WITH_ITEMS.items,
  payment_intents: {
    orderBy: [
      { created_at: 'asc' },
      { id: 'asc' },
    ] satisfies Prisma.PaymentIntentOrderByWithRelationInput[],
    select: {
      attempts: { select: { status: true } },
      id: true,
      status: true,
    },
  },
} satisfies Prisma.SalesOrderInclude;

const ORDER_DETAIL_INCLUDE = {
  ...ORDER_READ_INCLUDE,
  address_snapshot: {
    select: {
      city: true,
      detail_ciphertext: true,
      district: true,
      encryption_key_id: true,
      id: true,
      phone_ciphertext: true,
      phone_last4: true,
      province: true,
      recipient_name: true,
    },
  },
  aftersales: {
    orderBy: [
      { created_at: 'asc' },
      { id: 'asc' },
    ] satisfies Prisma.AftersaleOrderByWithRelationInput[],
    select: {
      aftersale_no: true,
      created_at: true,
      id: true,
      items: {
        select: { requested_amount: true },
      },
      status: true,
      type: true,
    },
    where: { type: { in: ['REFUND_ONLY', 'RETURN_REFUND'] } },
  },
  payment_intents: {
    orderBy: [
      { created_at: 'asc' },
      { id: 'asc' },
    ] satisfies Prisma.PaymentIntentOrderByWithRelationInput[],
    select: {
      attempts: {
        orderBy: [
          { initiated_at: 'asc' },
          { id: 'asc' },
        ] satisfies Prisma.PaymentAttemptOrderByWithRelationInput[],
        select: {
          amount: true,
          failure_code: true,
          finished_at: true,
          id: true,
          initiated_at: true,
          provider_transaction_id: true,
          status: true,
        },
      },
      id: true,
      intent_no: true,
      status: true,
    },
  },
  refunds: {
    orderBy: [
      { requested_at: 'asc' },
      { id: 'asc' },
    ] satisfies Prisma.RefundOrderByWithRelationInput[],
    select: {
      amount: true,
      attempts: {
        orderBy: [
          { attempt_no: 'asc' },
          { id: 'asc' },
        ] satisfies Prisma.RefundAttemptOrderByWithRelationInput[],
        select: {
          attempt_no: true,
          failure_code: true,
          finished_at: true,
          id: true,
          requested_at: true,
          status: true,
        },
      },
      id: true,
      origin_type: true,
      refund_no: true,
    },
    where: { is_late_payment_refund: true, origin_type: 'LATE_PAYMENT' },
  },
} satisfies Prisma.SalesOrderInclude;

type StoreOrderReadRecord = Prisma.SalesOrderGetPayload<{ include: typeof ORDER_READ_INCLUDE }>;
type StoreOrderDetailRecord = Prisma.SalesOrderGetPayload<{ include: typeof ORDER_DETAIL_INCLUDE }>;

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

function validateReadInput(input: StoreOrderReadInput): void {
  requireExactKeys(input, ['customerId', 'orderId'], 'Store order read input');
  requireUlid(input.customerId, 'Store order read Customer ID');
  requireUlid(input.orderId, 'Store order read order ID');
}

function validateCancelInput(input: StoreOrderCancelInput): void {
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'expectedVersion', 'orderId'],
    'Store order cancellation input',
  );
  requireUlid(input.accountId, 'Store order cancellation Account ID');
  requireUlid(input.customerId, 'Store order cancellation Customer ID');
  requireUlid(input.orderId, 'Store order cancellation order ID');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
    input.expectedVersion > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Store order cancellation version is invalid');
  }
}

function validateCloseClaimInput(input: StoreOrderCloseClaimInput): void {
  if (!plainObject(input)) throw new TypeError('Store order close claim input must be a plain object');
  const keys = Object.keys(input);
  const allowed = new Set(['accountId', 'customerId', 'expectedVersion', 'mode', 'orderId']);
  if (keys.some((key) => !allowed.has(key))) {
    throw new TypeError('Store order close claim input contains unsupported fields');
  }
  requireUlid(input.orderId, 'Store order close order ID');
  if (input.accountId !== undefined) requireUlid(input.accountId, 'Store order close Account ID');
  if (input.customerId !== undefined) requireUlid(input.customerId, 'Store order close Customer ID');
  if ((input.accountId === undefined) !== (input.customerId === undefined)) {
    throw new TypeError('Store order close owner must include Account ID and Customer ID together');
  }
  if (input.expectedVersion !== undefined &&
    (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
      input.expectedVersion > MAX_POSTGRES_INTEGER)) {
    throw new TypeError('Store order close expected version is invalid');
  }
  if (input.mode !== 'PAYMENT_TIMEOUT' && input.mode !== 'USER_CANCELLED') {
    throw new TypeError('Store order close mode is invalid');
  }
}

function validateCloseProviderInput(input: StoreOrderCloseProviderInput): void {
  if (!plainObject(input)) throw new TypeError('Store order close Provider input must be a plain object');
  const allowed = new Set([
    'errorCode',
    'expectedIntentVersion',
    'nextReconcileAt',
    'occurredAt',
    'outcome',
    'paymentIntentId',
    'providerEventId',
    'providerIntentId',
    'providerState',
    'providerTransactionId',
    'orderId',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError('Store order close Provider input contains unsupported fields');
  }
  requireUlid(input.orderId, 'Store order close Provider order ID');
  requireUlid(input.paymentIntentId, 'Store order close Provider payment intent ID');
  if (!Number.isSafeInteger(input.expectedIntentVersion) || input.expectedIntentVersion < 1 ||
    input.expectedIntentVersion > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Store order close Provider intent version is invalid');
  }
  const outcomes: readonly StoreOrderCloseProviderOutcome[] = [
    'CANCELLED', 'CLOSED', 'EXPIRED', 'FAILED', 'NOT_FOUND', 'OPEN', 'SUCCEEDED', 'UNKNOWN',
  ];
  if (!outcomes.includes(input.outcome)) throw new TypeError('Store order close Provider outcome is invalid');
  for (const [label, value, maximum] of [
    ['Provider close event ID', input.providerEventId, 128],
    ['Provider close intent ID', input.providerIntentId, 128],
    ['Provider close transaction ID', input.providerTransactionId, 128],
    ['Provider close error code', input.errorCode, 120],
    ['Provider close state', input.providerState, 80],
  ] as const) {
    if (value !== undefined && value !== null &&
      (typeof value !== 'string' || value.length < 1 || value.length > maximum ||
        Array.from(value).some((character) => {
          const codePoint = character.codePointAt(0);
          return codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f;
        }))) {
      throw new TypeError(`${label} is invalid`);
    }
  }
  for (const [label, value] of [
    ['Provider close occurredAt', input.occurredAt],
    ['Provider close nextReconcileAt', input.nextReconcileAt],
  ] as const) {
    if (value !== undefined && value !== null &&
      (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
      throw new TypeError(`${label} is invalid`);
    }
  }
}

function validateTerminalCloseRepairInput(input: StoreOrderTerminalCloseRepairInput): void {
  requireExactKeys(
    input,
    ['expectedIntentVersion', 'orderId', 'paymentIntentId'],
    'Store order terminal close repair input',
  );
  requireUlid(input.orderId, 'Store order terminal close repair order ID');
  requireUlid(input.paymentIntentId, 'Store order terminal close repair payment intent ID');
  if (!Number.isSafeInteger(input.expectedIntentVersion) || input.expectedIntentVersion < 1 ||
    input.expectedIntentVersion > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Store order terminal close repair intent version is invalid');
  }
}

const DISPLAY_GROUPS = new Set<StoreOrderDisplayGroup>([
  'ALL',
  'COMPLETED',
  'PENDING_PAYMENT',
  'PENDING_SHIPMENT',
  'REFUND_AFTERSALE',
  'SHIPPING',
]);
const LIST_SORTS = new Set<StoreOrderListSort>(['AMOUNT_DESC', 'CREATED_DESC', 'PAID_DESC']);
const ORDER_STATUSES = new Set<StoreOrderSnapshot['orderStatus']>([
  'CLOSED',
  'COMPLETED',
  'PENDING_PAYMENT',
  'PENDING_SHIPMENT',
  'SHIPPING',
]);
const PAYMENT_STATUSES = new Set<StoreOrderSnapshot['paymentStatus']>(['PAID', 'PROCESSING', 'UNPAID']);
const REFUND_PROGRESS_STATUSES = new Set<StoreOrderSnapshot['refundProgressStatus']>([
  'FULL',
  'NONE',
  'PARTIAL',
]);
const REFUND_PROCESSING_STATUSES = new Set<StoreOrderSnapshot['refundProcessingStatus']>([
  'FAILED',
  'IDLE',
  'REFUNDING',
]);
const FULFILLMENT_STATUSES = new Set<StoreOrderSnapshot['fulfillmentStatus']>([
  'CANCELLED',
  'DELIVERED',
  'IN_TRANSIT',
  'NOT_STARTED',
  'READY_TO_SHIP',
  'SHIPPED',
]);
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;

function validateListInput(input: StoreOrderListInput): void {
  if (!plainObject(input)) throw new TypeError('Store order list input must be a plain object');
  const allowed = new Set([
    'createdAtFrom',
    'createdAtToExclusive',
    'customerId',
    'displayGroup',
    'fulfillmentStatus',
    'maxAmount',
    'minAmount',
    'orderNo',
    'orderStatus',
    'page',
    'pageSize',
    'paymentStatus',
    'refundProcessingStatus',
    'refundProgressStatus',
    'sort',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new TypeError('Store order list input contains unsupported fields');
  }
  requireUlid(input.customerId, 'Store order list Customer ID');
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_POSTGRES_INTEGER ||
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Store order pagination is invalid');
  }
  if ((input.page - 1) * input.pageSize > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Store order pagination offset is invalid');
  }
  if (!DISPLAY_GROUPS.has(input.displayGroup) || !LIST_SORTS.has(input.sort)) {
    throw new TypeError('Store order list grouping or sort is invalid');
  }
  if (input.orderNo !== undefined && (typeof input.orderNo !== 'string' || input.orderNo.length < 1 ||
    input.orderNo.trim() !== input.orderNo || Array.from(input.orderNo).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    }))) {
    throw new TypeError('Store order number filter is invalid');
  }
  if (input.orderStatus !== undefined && !ORDER_STATUSES.has(input.orderStatus)) {
    throw new TypeError('Store order status filter is invalid');
  }
  if (input.paymentStatus !== undefined && !PAYMENT_STATUSES.has(input.paymentStatus)) {
    throw new TypeError('Store order payment status filter is invalid');
  }
  if (input.refundProgressStatus !== undefined && !REFUND_PROGRESS_STATUSES.has(input.refundProgressStatus)) {
    throw new TypeError('Store order refund progress filter is invalid');
  }
  if (input.refundProcessingStatus !== undefined &&
    !REFUND_PROCESSING_STATUSES.has(input.refundProcessingStatus)) {
    throw new TypeError('Store order refund processing filter is invalid');
  }
  if (input.fulfillmentStatus !== undefined && !FULFILLMENT_STATUSES.has(input.fulfillmentStatus)) {
    throw new TypeError('Store order fulfillment status filter is invalid');
  }
  for (const [label, value] of [
    ['Store order start time', input.createdAtFrom],
    ['Store order end time', input.createdAtToExclusive],
  ] as const) {
    if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
      throw new TypeError(`${label} is invalid`);
    }
  }
  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Store order date range is invalid');
  }
  for (const [label, value] of [
    ['Store order minimum amount', input.minAmount],
    ['Store order maximum amount', input.maxAmount],
  ] as const) {
    if (value !== undefined && (!MONEY.test(value) || new Prisma.Decimal(value).greaterThan('9999999999999999.99'))) {
      throw new TypeError(`${label} is invalid`);
    }
  }
  if (input.minAmount !== undefined && input.maxAmount !== undefined &&
    new Prisma.Decimal(input.minAmount).greaterThan(input.maxAmount)) {
    throw new TypeError('Store order amount range is invalid');
  }
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

function orderNotCancellable(): ApplicationError {
  return new ApplicationError('ORDER_NOT_CANCELLABLE', 'Order cannot be cancelled');
}

function orderVersionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Order version changed');
}

function paymentResultConflict(): ApplicationError {
  return new ApplicationError('PAYMENT_RESULT_CONFLICT', 'Payment Provider result conflicts with the close state');
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

type StoreOrderActionRecord = StoreOrderReadRecord | StoreOrderDetailRecord;

function paymentActionBaseEligible(record: StoreOrderActionRecord, serverTime: Date): boolean {
  return record.order_status === 'PENDING_PAYMENT' &&
    record.refund_progress_status === 'NONE' && record.refund_processing_status === 'IDLE' &&
    record.fulfillment_status === 'NOT_STARTED' && record.close_reason === null &&
    record.completion_reason === null && record.payment_resolution === 'NORMAL' &&
    record.pay_expires_at.getTime() > serverTime.getTime() &&
    record.inventory_reservation?.status === 'ACTIVE';
}

function hasSuccessfulPayment(record: StoreOrderActionRecord): boolean {
  return record.payment_intents.some((intent) => intent.status === 'SUCCEEDED' ||
    intent.attempts.some((attempt) => attempt.status === 'SUCCEEDED' || attempt.status === 'SUCCEEDED_LATE'));
}

function activePaymentIntents(record: StoreOrderActionRecord) {
  return record.payment_intents.filter(({ status }) =>
    status === 'CREATING' || status === 'OPEN' || status === 'CLOSE_PENDING');
}

function canCancelOrder(record: StoreOrderActionRecord, serverTime: Date): boolean {
  return paymentActionBaseEligible(record, serverTime) && record.payment_status === 'UNPAID' &&
    !hasSuccessfulPayment(record) && activePaymentIntents(record).length === 0;
}

function canPayOrder(record: StoreOrderActionRecord, serverTime: Date): boolean {
  if (!paymentActionBaseEligible(record, serverTime) || hasSuccessfulPayment(record)) return false;
  const active = activePaymentIntents(record);
  if (active.length > 1 || active.some(({ status }) => status === 'CLOSE_PENDING')) return false;
  if (active.length === 1) {
    return (active[0]?.status === 'CREATING' || active[0]?.status === 'OPEN') &&
      (record.payment_status === 'UNPAID' || record.payment_status === 'PROCESSING');
  }
  return record.payment_status === 'UNPAID';
}

function canApplyAftersale(record: StoreOrderActionRecord, serverTime: Date): boolean {
  if (record.payment_status !== 'PAID' || record.payment_resolution !== 'NORMAL') return false;
  const withinWindow = ((record.order_status === 'PENDING_SHIPMENT' || record.order_status === 'SHIPPING') &&
      record.completed_at === null) ||
    (record.order_status === 'COMPLETED' && record.completed_at !== null &&
      record.aftersale_expires_at !== null &&
      record.aftersale_expires_at.getTime() >= serverTime.getTime());
  if (!withinWindow) return false;
  return record.items.some((item) =>
    item.quantity - item.refunded_qty - item.aftersale_reserved_qty > 0 &&
    item.line_paid_amount.minus(item.refunded_amount).minus(item.aftersale_reserved_amount).greaterThan(0));
}

function paymentAttemptSnapshots(record: StoreOrderDetailRecord): StoreOrderPaymentAttemptSnapshot[] {
  return record.payment_intents.flatMap((intent) => {
    requireUlid(intent.id, 'Stored payment intent ID');
    const intentNo = safeStoredText(intent.intent_no, 32, 'Stored payment intent number');
    return intent.attempts.map((attempt) => {
      requireUlid(attempt.id, 'Stored payment attempt ID');
      const createdAt = safeDate(attempt.initiated_at, 'Stored payment attempt creation time');
      return {
        amount: safeMoney(attempt.amount, 'Stored payment attempt amount'),
        createdAt,
        failureCode: attempt.failure_code === null
          ? null
          : safeStoredText(attempt.failure_code, 80, 'Stored payment failure code'),
        intentNo,
        paymentAttemptId: attempt.id,
        providerTransactionId: attempt.provider_transaction_id === null
          ? null
          : safeStoredText(attempt.provider_transaction_id, 128, 'Stored payment transaction ID'),
        status: attempt.status,
        updatedAt: attempt.finished_at === null
          ? createdAt
          : safeDate(attempt.finished_at, 'Stored payment attempt update time'),
      };
    });
  });
}

function refundAttemptSnapshots(record: StoreOrderDetailRecord): StoreOrderRefundAttemptSnapshot[] {
  return record.refunds.flatMap((refund) => {
    requireUlid(refund.id, 'Stored refund ID');
    const amount = safeMoney(refund.amount, 'Stored refund amount');
    const refundNo = safeStoredText(refund.refund_no, 32, 'Stored refund number');
    return refund.attempts.map((attempt) => {
      requireUlid(attempt.id, 'Stored refund attempt ID');
      const attemptNo = safeCounter(attempt.attempt_no, 'Stored refund attempt number');
      if (attemptNo < 1) throw internalError('Stored refund attempt number is invalid');
      const createdAt = safeDate(attempt.requested_at, 'Stored refund attempt creation time');
      return {
        amount,
        attemptNo,
        createdAt,
        failureCode: attempt.failure_code === null
          ? null
          : safeStoredText(attempt.failure_code, 80, 'Stored refund failure code'),
        originType: refund.origin_type,
        refundId: refund.id,
        refundNo,
        status: attempt.status,
        updatedAt: attempt.finished_at === null
          ? createdAt
          : safeDate(attempt.finished_at, 'Stored refund attempt update time'),
      };
    });
  });
}

function aftersaleSummary(record: StoreOrderReadRecord): StoreOrderListItemSnapshot['aftersaleSummary'] {
  const latest = record.aftersales[0];
  return {
    activeCount: record._count.aftersales,
    latestAftersaleId: latest?.id ?? null,
    latestStatus: latest?.status ?? null,
    refundedAmount: safeMoney(record.refunded_amount, 'Stored order refunded amount'),
  };
}

function aftersaleSnapshots(record: StoreOrderDetailRecord): StoreOrderAftersaleSnapshot[] {
  return record.aftersales.map((aftersale) => {
    requireUlid(aftersale.id, 'Stored aftersale ID');
    if (aftersale.type !== 'REFUND_ONLY' && aftersale.type !== 'RETURN_REFUND') {
      throw internalError('Stored customer aftersale type is invalid');
    }
    return {
      aftersaleId: aftersale.id,
      aftersaleNo: safeStoredText(aftersale.aftersale_no, 32, 'Stored aftersale number'),
      createdAt: safeDate(aftersale.created_at, 'Stored aftersale creation time'),
      requestedAmount: safeMoney(
        aftersale.items.reduce(
          (total, item) => total.plus(item.requested_amount),
          new Prisma.Decimal(0),
        ),
        'Stored aftersale requested amount',
        true,
      ),
      status: aftersale.status,
      type: aftersale.type,
    };
  });
}

function addressSnapshot(record: NonNullable<StoreOrderDetailRecord['address_snapshot']>): StoreOrderAddressSnapshot {
  requireUlid(record.id, 'Stored order address snapshot ID');
  if (!(record.detail_ciphertext instanceof Uint8Array) || record.detail_ciphertext.byteLength < 1 ||
    !(record.phone_ciphertext instanceof Uint8Array) || record.phone_ciphertext.byteLength < 1 ||
    typeof record.phone_last4 !== 'string' || !PHONE_LAST4.test(record.phone_last4)) {
    throw internalError('Stored order address snapshot material is invalid');
  }
  return {
    city: safeStoredText(record.city, 80, 'Stored order address city'),
    detailCiphertext: Buffer.from(record.detail_ciphertext),
    district: safeStoredText(record.district, 80, 'Stored order address district'),
    encryptionKeyId: safeStoredText(record.encryption_key_id, 80, 'Stored order address key ID'),
    phoneCiphertext: Buffer.from(record.phone_ciphertext),
    phoneLast4: record.phone_last4,
    province: safeStoredText(record.province, 80, 'Stored order address province'),
    recipientName: safeStoredText(record.recipient_name, 80, 'Stored order address recipient'),
    snapshotId: record.id,
  };
}

function displayGroupWhere(displayGroup: StoreOrderDisplayGroup): Prisma.SalesOrderWhereInput {
  if (displayGroup === 'ALL') return {};
  if (displayGroup === 'PENDING_PAYMENT') return { order_status: 'PENDING_PAYMENT' };
  if (displayGroup === 'PENDING_SHIPMENT') return { order_status: 'PENDING_SHIPMENT' };
  if (displayGroup === 'SHIPPING') return { order_status: 'SHIPPING' };
  if (displayGroup === 'COMPLETED') return { order_status: 'COMPLETED' };
  return {
    OR: [
      { aftersales: { some: {} } },
      { refund_processing_status: { not: 'IDLE' } },
      { refund_progress_status: { not: 'NONE' } },
    ],
  };
}

function listWhere(input: StoreOrderListInput): Prisma.SalesOrderWhereInput {
  return {
    AND: [
      displayGroupWhere(input.displayGroup),
      {
        customer_id: input.customerId,
        ...(input.orderNo === undefined ? {} : { order_no: input.orderNo }),
        ...(input.orderStatus === undefined ? {} : { order_status: input.orderStatus }),
        ...(input.paymentStatus === undefined ? {} : { payment_status: input.paymentStatus }),
        ...(input.refundProgressStatus === undefined
          ? {}
          : { refund_progress_status: input.refundProgressStatus }),
        ...(input.refundProcessingStatus === undefined
          ? {}
          : { refund_processing_status: input.refundProcessingStatus }),
        ...(input.fulfillmentStatus === undefined
          ? {}
          : { fulfillment_status: input.fulfillmentStatus }),
        ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined
          ? {}
          : {
              created_at: {
                ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
                ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
              },
            }),
        ...(input.minAmount === undefined && input.maxAmount === undefined
          ? {}
          : {
              payable_amount: {
                ...(input.minAmount === undefined ? {} : { gte: new Prisma.Decimal(input.minAmount) }),
                ...(input.maxAmount === undefined ? {} : { lte: new Prisma.Decimal(input.maxAmount) }),
              },
            }),
      },
    ],
  };
}

function listOrderBy(sort: StoreOrderListSort): Prisma.SalesOrderOrderByWithRelationInput[] {
  if (sort === 'AMOUNT_DESC') return [{ payable_amount: 'desc' }, { id: 'desc' }];
  if (sort === 'PAID_DESC') return [{ paid_at: { nulls: 'last', sort: 'desc' } }, { id: 'desc' }];
  return [{ created_at: 'desc' }, { id: 'desc' }];
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

  private async primaryImageKeys(
    transaction: DatabaseTransaction,
    productIds: readonly string[],
  ): Promise<Map<string, string>> {
    const uniqueProductIds = uniqueSortedUlids(productIds, 'Store order product image set');
    if (uniqueProductIds.length === 0) return new Map();
    const images = await transaction.productImage.findMany({
      orderBy: [{ product_id: 'asc' }, { sort_order: 'asc' }, { id: 'asc' }],
      select: { file: { select: { id: true, object_key: true } }, product_id: true },
      where: {
        deleted_at: null,
        file: {
          deleted_at: null,
          purpose: 'PRODUCT_IMAGE',
          status: 'READY',
          visibility: 'PUBLIC',
        },
        product_id: { in: uniqueProductIds },
      },
    });
    const result = new Map<string, string>();
    for (const image of images) {
      if (!result.has(image.product_id) && isValidUlid(image.file.id) &&
        image.file.object_key === `public/${image.file.id}`) {
        result.set(image.product_id, image.file.object_key);
      }
    }
    return result;
  }

  async listOwnedOrdersInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderListInput,
  ): Promise<StoreOrderListResult> {
    validateListInput(input);
    const where = listWhere(input);
    const serverTime = await this.transactionTime(transaction);
    const total = await transaction.salesOrder.count({ where });
    const records = await transaction.salesOrder.findMany({
      include: ORDER_READ_INCLUDE,
      orderBy: listOrderBy(input.sort),
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      where,
    });
    const imageKeys = await this.primaryImageKeys(
      transaction,
      records.flatMap(({ items }) => items.map(({ product_id }) => product_id)),
    );
    return {
      items: records.map((record) => {
        const order = orderSnapshot(record, serverTime);
        return {
          aftersaleSummary: aftersaleSummary(record),
          canApplyAftersale: canApplyAftersale(record, serverTime),
          canCancel: canCancelOrder(record, serverTime),
          canPay: canPayOrder(record, serverTime),
          itemImages: order.items.map((item) => ({
            objectKey: imageKeys.get(item.productId) ?? null,
            orderItemId: item.orderItemId,
          })),
          order,
        };
      }),
      total,
    };
  }

  async getOwnedOrderDetailInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderReadInput,
  ): Promise<StoreOrderDetailSnapshot> {
    validateReadInput(input);
    const serverTime = await this.transactionTime(transaction);
    const record = await transaction.salesOrder.findFirst({
      include: ORDER_DETAIL_INCLUDE,
      where: { customer_id: input.customerId, id: input.orderId },
    });
    if (!record) throw orderNotFound();
    if (!record.address_snapshot) throw internalError('Stored order address snapshot is missing');
    return {
      address: addressSnapshot(record.address_snapshot),
      aftersales: aftersaleSnapshots(record),
      canApplyAftersale: canApplyAftersale(record, serverTime),
      canCancel: canCancelOrder(record, serverTime),
      canPay: canPayOrder(record, serverTime),
      closedAt: record.closed_at === null ? null : safeDate(record.closed_at, 'Stored order closure time'),
      order: orderSnapshot(record, serverTime),
      paymentAttempts: paymentAttemptSnapshots(record),
      refundAttempts: refundAttemptSnapshots(record),
    };
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

  private async lockOwnedOrder(
    transaction: DatabaseTransaction,
    customerId: string,
    orderId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.sales_order
      WHERE id = ${orderId} AND customer_id = ${customerId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  private async lockNextExpiredOrder(transaction: DatabaseTransaction): Promise<string | null> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT so.id
      FROM public.sales_order AS so
      WHERE so.order_status = 'PENDING_PAYMENT'
        AND so.payment_status = 'UNPAID'
        AND so.refund_progress_status = 'NONE'
        AND so.refund_processing_status = 'IDLE'
        AND so.fulfillment_status = 'NOT_STARTED'
        AND so.close_reason IS NULL
        AND so.completion_reason IS NULL
        AND so.payment_resolution = 'NORMAL'
        AND so.pay_expires_at <= transaction_timestamp()
        AND NOT EXISTS (
          SELECT 1 FROM public.payment_intent AS pi WHERE pi.order_id = so.id
        )
        AND (
          SELECT jsonb_agg(jsonb_build_array(oi.sku_id, oi.quantity) ORDER BY oi.sku_id)
          FROM public.order_item AS oi
          WHERE oi.order_id = so.id
        ) = (
          SELECT jsonb_agg(jsonb_build_array(iri.sku_id, iri.quantity) ORDER BY iri.sku_id)
          FROM public.inventory_reservation AS ir
          INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
          WHERE ir.order_id = so.id AND ir.status = 'ACTIVE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.inventory_reservation AS ir
          INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
          LEFT JOIN public.inventory_balance AS ib ON ib.sku_id = iri.sku_id
          WHERE ir.order_id = so.id
            AND ir.status = 'ACTIVE'
            AND (
              ib.id IS NULL
              OR ib.physical_qty < ib.locked_qty
              OR ib.locked_qty <> (
                SELECT COALESCE(SUM(active_iri.quantity), 0)
                FROM public.inventory_reservation AS active_ir
                INNER JOIN public.inventory_reservation_item AS active_iri
                  ON active_iri.reservation_id = active_ir.id
                WHERE active_ir.status = 'ACTIVE' AND active_iri.sku_id = iri.sku_id
              )
            )
        )
      ORDER BY so.pay_expires_at ASC, so.id ASC
      FOR UPDATE OF so SKIP LOCKED
      LIMIT 1
    `);
    const orderId = rows[0]?.id;
    if (orderId === undefined) return null;
    requireUlid(orderId, 'Expired Store order ID');
    return orderId;
  }

  private async lockPaymentIntents(
    transaction: DatabaseTransaction,
    orderId: string,
  ): Promise<LockedPaymentIntentForClose[]> {
    const rows = await transaction.$queryRaw<LockedPaymentIntentForClose[]>(Prisma.sql`
      SELECT id,
             intent_no,
             order_id,
             provider::text AS provider,
             provider_intent_id,
             status::text AS status,
             amount,
             expires_at,
             close_requested_at,
             close_attempt_count,
             closed_at,
             last_error_code,
             next_reconcile_at,
             provider_state,
             reconciliation_attempt_count,
             updated_at,
             version
      FROM public.payment_intent
      WHERE order_id = ${orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    rows.forEach((row) => {
      requireUlid(row.id, 'Store order payment intent ID');
      requireUlid(row.order_id, 'Store order payment intent order ID');
      if (row.order_id !== orderId || typeof row.intent_no !== 'string' ||
        row.intent_no.length < 1 || row.intent_no.length > 32 || !/^[\x20-\x7e]+$/.test(row.intent_no)) {
        throw internalError('Store order payment intent identity is invalid');
      }
      if (row.provider !== 'MOCK' && row.provider !== 'WECHAT') {
        throw internalError('Store order payment intent Provider is invalid');
      }
      for (const [label, value, maximum] of [
        ['Store order provider intent ID', row.provider_intent_id, 128],
        ['Store order provider state', row.provider_state, 80],
        ['Store order payment error code', row.last_error_code, 120],
      ] as const) {
        if (value !== null &&
          (typeof value !== 'string' || value.length < 1 || value.length > maximum ||
            Array.from(value).some((character) => {
              const codePoint = character.codePointAt(0);
              return codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f;
            }))) {
          throw internalError(`${label} is invalid`);
        }
      }
      if (!Number.isSafeInteger(row.version) || row.version < 1 || row.version > MAX_POSTGRES_INTEGER ||
        !Number.isSafeInteger(row.close_attempt_count) || row.close_attempt_count < 0 ||
        row.close_attempt_count > MAX_POSTGRES_INTEGER ||
        !Prisma.Decimal.isDecimal(row.amount) || !Number.isFinite(row.amount.toNumber()) || row.amount.isNegative() ||
        !(row.expires_at instanceof Date) || !Number.isFinite(row.expires_at.getTime()) ||
        (row.close_requested_at !== null &&
          (!(row.close_requested_at instanceof Date) || !Number.isFinite(row.close_requested_at.getTime()))) ||
        (row.closed_at !== null &&
          (!(row.closed_at instanceof Date) || !Number.isFinite(row.closed_at.getTime()))) ||
        (row.next_reconcile_at !== null &&
          (!(row.next_reconcile_at instanceof Date) || !Number.isFinite(row.next_reconcile_at.getTime()))) ||
        !(row.updated_at instanceof Date) || !Number.isFinite(row.updated_at.getTime()) ||
        !Number.isSafeInteger(row.reconciliation_attempt_count) || row.reconciliation_attempt_count < 0 ||
        row.reconciliation_attempt_count > MAX_POSTGRES_INTEGER ||
        !['CANCELLED', 'CLOSED', 'CLOSE_PENDING', 'CREATING', 'EXPIRED', 'FAILED', 'OPEN', 'SUCCEEDED']
          .includes(row.status)) {
        throw internalError('Store order payment intent facts are invalid');
      }
    });
    return rows;
  }

  private closePaymentIntentSnapshot(
    intent: LockedPaymentIntentForClose,
  ): StoreOrderClosePaymentIntent {
    return {
      amount: new Prisma.Decimal(intent.amount).toFixed(2),
      closeRequestedAt: intent.close_requested_at === null ? null : new Date(intent.close_requested_at),
      expiresAt: new Date(intent.expires_at),
      intentNo: intent.intent_no,
      paymentIntentId: intent.id,
      provider: intent.provider,
      providerIntentId: intent.provider_intent_id,
      status: intent.status,
      version: intent.version,
    };
  }

  private async paymentIntentHasSuccessfulAttempt(
    transaction: DatabaseTransaction,
    paymentIntentIds: readonly string[],
  ): Promise<boolean> {
    if (paymentIntentIds.length === 0) return false;
    const rows = await transaction.$queryRaw<Array<{ payment_intent_id: string }>>(Prisma.sql`
      SELECT payment_intent_id
      FROM public.payment_attempt
      WHERE payment_intent_id IN (${Prisma.join(paymentIntentIds)})
        AND status IN ('SUCCEEDED'::public."PaymentAttemptStatus", 'SUCCEEDED_LATE'::public."PaymentAttemptStatus")
      GROUP BY payment_intent_id
      ORDER BY payment_intent_id ASC
    `);
    rows.forEach(({ payment_intent_id }) => requireUlid(payment_intent_id, 'Store order payment attempt intent ID'));
    return rows.length > 0;
  }

  private validateTerminalPaymentIntents(
    intents: readonly LockedPaymentIntentForClose[],
    orderPayExpiresAt: Date,
  ): void {
    for (const intent of intents) {
      if (!['CANCELLED', 'CLOSED', 'EXPIRED', 'FAILED'].includes(intent.status)) {
        throw orderNotCancellable();
      }
      if (intent.expires_at.getTime() !== orderPayExpiresAt.getTime() || intent.closed_at === null ||
        !Number.isFinite(intent.closed_at.getTime())) {
        throw orderNotCancellable();
      }
    }
  }

  private async lockReleaseInventory(
    transaction: DatabaseTransaction,
    orderId: string,
    expectedItems: readonly StoreOrderItemSnapshot[],
  ): Promise<{
    balances: Array<{
      id: string;
      lockedQty: number;
      physicalQty: number;
      skuId: string;
      version: number;
    }>;
    items: Array<{ quantity: number; skuId: string }>;
    reservationId: string;
  }> {
    const candidate = await transaction.inventoryReservation.findUnique({
      include: { items: { orderBy: [{ sku_id: 'asc' }, { id: 'asc' }] } },
      where: { order_id: orderId },
    });
    if (!candidate || candidate.status !== 'ACTIVE' || candidate.items.length < 1) {
      throw orderNotCancellable();
    }
    requireUlid(candidate.id, 'Store order reservation ID');
    const items = candidate.items.map((item) => {
      requireUlid(item.sku_id, 'Store order reservation SKU ID');
      requireQuantity(item.quantity, 'Store order reservation quantity');
      return { quantity: item.quantity, skuId: item.sku_id };
    });
    if (new Set(items.map(({ skuId }) => skuId)).size !== items.length) {
      throw internalError('Store order reservation contains duplicate SKUs');
    }
    const expected = [...expectedItems]
      .map(({ quantity, skuId }) => ({ quantity, skuId }))
      .sort(compareSku);
    if (items.length !== expected.length || items.some((item, index) => {
      const orderItem = expected[index];
      return orderItem === undefined || item.skuId !== orderItem.skuId || item.quantity !== orderItem.quantity;
    })) {
      throw internalError('Store order reservation does not match its order items');
    }
    const skuIds = items.map(({ skuId }) => skuId).sort();
    const candidates = await transaction.sku.findMany({
      select: { id: true, inventory_balance: { select: { id: true } } },
      where: { id: { in: skuIds } },
    });
    if (candidates.length !== skuIds.length || candidates.some(({ inventory_balance }) => !inventory_balance)) {
      throw internalError('Store order release inventory hierarchy is incomplete');
    }
    const balanceIds = uniqueSortedUlids(
      candidates.flatMap(({ inventory_balance }) => inventory_balance ? [inventory_balance.id] : []),
      'Store order release balance set',
    );
    await acquireTransactionLocks(transaction, [
      ...skuIds.map((id) => ({ namespace: 'product-catalog-sku', parts: [id] })),
      ...balanceIds.map((id) => ({ namespace: 'inventory-balance', parts: [id] })),
      { namespace: 'inventory-reservation', parts: [candidate.id] },
    ]);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.sku
      WHERE id IN (${Prisma.join(skuIds)})
      ORDER BY id ASC
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.inventory_balance
      WHERE id IN (${Prisma.join(balanceIds)})
      ORDER BY id ASC
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.inventory_reservation
      WHERE id = ${candidate.id}
      FOR UPDATE
    `);

    const lockedReservation = await transaction.inventoryReservation.findUnique({
      include: { items: { orderBy: [{ sku_id: 'asc' }, { id: 'asc' }] } },
      where: { id: candidate.id },
    });
    if (!lockedReservation || lockedReservation.order_id !== orderId || lockedReservation.status !== 'ACTIVE' ||
      lockedReservation.items.length !== items.length || lockedReservation.items.some((item, index) => {
        const expected = items[index];
        return expected === undefined || item.sku_id !== expected.skuId || item.quantity !== expected.quantity;
      })) {
      throw orderNotCancellable();
    }
    const balanceRecords = await transaction.inventoryBalance.findMany({
      orderBy: [{ id: 'asc' }],
      where: { id: { in: balanceIds }, sku_id: { in: skuIds } },
    });
    if (balanceRecords.length !== items.length) {
      throw internalError('Store order release balances changed while locking');
    }
    const activeReservationTotals = await transaction.$queryRaw<Array<{
      sku_id: string;
      total_quantity: bigint;
    }>>(Prisma.sql`
      SELECT iri.sku_id, SUM(iri.quantity)::bigint AS total_quantity
      FROM public.inventory_reservation AS ir
      INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
      WHERE ir.status = 'ACTIVE' AND iri.sku_id IN (${Prisma.join(skuIds)})
      GROUP BY iri.sku_id
      ORDER BY iri.sku_id ASC
    `);
    if (activeReservationTotals.length !== items.length) {
      throw internalError('Store order release active reservation totals are incomplete');
    }
    const activeQuantityBySkuId = new Map(activeReservationTotals.map(({ sku_id: aggregateSkuId, total_quantity }) => {
      if (!isValidUlid(aggregateSkuId) || typeof total_quantity !== 'bigint' || total_quantity < 1n ||
        total_quantity > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw internalError('Store order release active reservation totals are invalid');
      }
      return [aggregateSkuId, Number(total_quantity)] as const;
    }));
    if (activeQuantityBySkuId.size !== items.length) {
      throw internalError('Store order release active reservation totals contain duplicate SKUs');
    }
    const bySkuId = new Map(balanceRecords.map((balance) => [balance.sku_id, balance]));
    return {
      balances: items.map(({ skuId }) => {
        const balance = bySkuId.get(skuId);
        const activeQuantity = activeQuantityBySkuId.get(skuId);
        if (!balance || !isValidUlid(balance.id) || !Number.isSafeInteger(balance.physical_qty) ||
          !Number.isSafeInteger(balance.locked_qty) || !Number.isSafeInteger(balance.version) ||
          activeQuantity === undefined || balance.physical_qty < balance.locked_qty ||
          balance.locked_qty !== activeQuantity || balance.locked_qty < 0 || balance.version < 1) {
          throw internalError('Store order release balance is invalid');
        }
        return {
          id: balance.id,
          lockedQty: balance.locked_qty,
          physicalQty: balance.physical_qty,
          skuId,
          version: balance.version,
        };
      }),
      items,
      reservationId: candidate.id,
    };
  }

  private async closeLockedOrder(
    transaction: DatabaseTransaction,
    input: {
      accountId?: string;
      expectedVersion?: number;
      mode: StoreOrderCloseMode;
      orderId: string;
      repairTerminalClose?: boolean;
      /**
       * The timestamp at which the close decision was made.  Provider I/O is
       * deliberately outside the transaction, so a user cancellation that
       * was valid before expiry may be finalized after the order expires.
       */
      requestedAt?: Date;
    },
  ): Promise<StoreOrderCloseResult | null> {
    const occurredAt = await this.transactionTime(transaction);
    const record = await transaction.salesOrder.findUnique({
      include: ORDER_READ_INCLUDE,
      where: { id: input.orderId },
    });
    if (!record) throw orderNotFound();
    const before = orderSnapshot(record, occurredAt);
    const alreadyClosedForMode = record.order_status === 'CLOSED' && record.close_reason === input.mode &&
      record.closed_at instanceof Date && Number.isFinite(record.closed_at.getTime());
    if (alreadyClosedForMode &&
      (input.repairTerminalClose !== true || record.inventory_reservation?.status !== 'ACTIVE')) {
      return { before, changed: false, order: before, reservationId: null };
    }
    if (record.order_status === 'CLOSED' && !alreadyClosedForMode) {
      if (input.repairTerminalClose === true) {
        throw internalError('Store order terminal close facts conflict with the requested repair mode');
      }
      if (input.mode === 'PAYMENT_TIMEOUT') return null;
      throw orderNotCancellable();
    }
    const baseEligible = record.order_status === 'PENDING_PAYMENT' && record.payment_status === 'UNPAID' &&
      record.refund_progress_status === 'NONE' && record.refund_processing_status === 'IDLE' &&
      record.fulfillment_status === 'NOT_STARTED' && record.close_reason === null &&
      record.completion_reason === null && record.payment_resolution === 'NORMAL';
    const closedRepairEligible = input.repairTerminalClose === true && alreadyClosedForMode &&
      record.payment_status === 'UNPAID' && record.refund_progress_status === 'NONE' &&
      record.refund_processing_status === 'IDLE' && record.fulfillment_status === 'NOT_STARTED' &&
      record.completion_reason === null && record.payment_resolution === 'NORMAL' &&
      record.inventory_reservation?.status === 'ACTIVE';
    const requestedAt = input.requestedAt ?? occurredAt;
    if (!(requestedAt instanceof Date) || !Number.isFinite(requestedAt.getTime()) ||
      requestedAt.getTime() > occurredAt.getTime()) {
      throw internalError('Store order close request timestamp is invalid');
    }
    const timeEligible = input.mode === 'USER_CANCELLED'
      ? record.pay_expires_at.getTime() > requestedAt.getTime()
      : record.pay_expires_at.getTime() <= requestedAt.getTime();
    if ((!baseEligible && !closedRepairEligible) || !timeEligible) {
      if (input.mode === 'PAYMENT_TIMEOUT') return null;
      throw orderNotCancellable();
    }
    const paymentIntents = await this.lockPaymentIntents(transaction, input.orderId);
    if (await this.paymentIntentHasSuccessfulAttempt(transaction, paymentIntents.map(({ id }) => id))) {
      if (input.mode === 'PAYMENT_TIMEOUT') return null;
      throw orderNotCancellable();
    }
    const activePaymentIntents = paymentIntents.filter(({ status }) =>
      status === 'CREATING' || status === 'OPEN' || status === 'CLOSE_PENDING');
    if (activePaymentIntents.length > 0) {
      if (input.mode === 'PAYMENT_TIMEOUT') return null;
      throw orderNotCancellable();
    }
    this.validateTerminalPaymentIntents(paymentIntents, record.pay_expires_at);
    if (input.expectedVersion !== undefined && record.version !== input.expectedVersion) {
      throw orderVersionConflict();
    }
    const release = await this.lockReleaseInventory(transaction, input.orderId, before.items);
    const reservationStatus = input.mode === 'PAYMENT_TIMEOUT' ? 'EXPIRED' : 'RELEASED';
    if (!alreadyClosedForMode) {
      const updatedOrder = await transaction.salesOrder.updateMany({
        data: {
          close_reason: input.mode,
          closed_at: occurredAt,
          order_status: 'CLOSED',
          updated_at: occurredAt,
          version: { increment: 1 },
        },
        where: {
          close_reason: null,
          id: input.orderId,
          order_status: 'PENDING_PAYMENT',
          payment_status: 'UNPAID',
          version: record.version,
        },
      });
      if (updatedOrder.count !== 1) throw internalError('Store order close update lost its locked row');
    }
    const updatedReservation = await transaction.inventoryReservation.updateMany({
      data: { released_at: occurredAt, status: reservationStatus },
      where: { id: release.reservationId, order_id: input.orderId, status: 'ACTIVE' },
    });
    if (updatedReservation.count !== 1) throw internalError('Store order reservation release lost its locked row');

    const quantityBySkuId = new Map(release.items.map((item) => [item.skuId, item.quantity]));
    const ledgerWrites: Prisma.InventoryLedgerCreateManyInput[] = [];
    for (const balance of [...release.balances].sort(compareSku)) {
      const quantity = quantityBySkuId.get(balance.skuId);
      if (quantity === undefined || balance.lockedQty < quantity) {
        throw internalError('Store order release exceeds locked inventory');
      }
      const lockedAfter = balance.lockedQty - quantity;
      const updated = await transaction.inventoryBalance.updateMany({
        data: { locked_qty: lockedAfter, updated_at: occurredAt, version: { increment: 1 } },
        where: {
          id: balance.id,
          locked_qty: balance.lockedQty,
          physical_qty: balance.physicalQty,
          sku_id: balance.skuId,
          version: balance.version,
        },
      });
      if (updated.count !== 1) throw internalError('Store order release balance update lost its locked row');
      ledgerWrites.push({
        ...(input.accountId === undefined ? {} : { actor_account_id: input.accountId }),
        business_id: release.reservationId,
        id: generateUlid(occurredAt.getTime()),
        ledger_type: 'ORDER_RELEASE',
        locked_after: lockedAfter,
        locked_change: -quantity,
        occurred_at: occurredAt,
        physical_after: balance.physicalQty,
        physical_change: 0,
        reason: input.mode,
        sku_id: balance.skuId,
      });
    }
    const createdLedgers = await transaction.inventoryLedger.createMany({ data: ledgerWrites });
    if (createdLedgers.count !== ledgerWrites.length) {
      throw internalError('Store order release ledger insert count is invalid');
    }
    return {
      before,
      changed: true,
      order: await this.readOwnedOrder(transaction, record.customer_id, input.orderId, occurredAt),
      reservationId: release.reservationId,
    };
  }

  private async lockCloseOrderRows(
    transaction: DatabaseTransaction,
    orderId: string,
    customerId?: string,
  ): Promise<void> {
    const rows = customerId === undefined
      ? await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM public.sales_order WHERE id = ${orderId} FOR UPDATE
        `)
      : await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id FROM public.sales_order
          WHERE id = ${orderId} AND customer_id = ${customerId}
          FOR UPDATE
        `);
    if (rows.length !== 1 || rows[0]?.id !== orderId) throw orderNotFound();
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.order_item
      WHERE order_id = ${orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
  }

  private closeModeForTimestamp(
    closeRequestedAt: Date | null,
    payExpiresAt: Date,
    fallback: StoreOrderCloseMode,
  ): StoreOrderCloseMode {
    if (closeRequestedAt === null) return fallback;
    if (!(closeRequestedAt instanceof Date) || !Number.isFinite(closeRequestedAt.getTime())) {
      throw internalError('Store order close request timestamp is invalid');
    }
    return closeRequestedAt.getTime() < payExpiresAt.getTime() ? 'USER_CANCELLED' : 'PAYMENT_TIMEOUT';
  }

  /**
   * First phase of cancellation/timeout.  It performs no Provider I/O.  An
   * active intent is claimed by changing it to CLOSE_PENDING and returning
   * only the stable Provider lookup facts; callers must perform query/close
   * outside the database transaction and invoke finalizeOrderCloseInTransaction
   * with the result.
   */
  async claimOrderCloseInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderCloseClaimInput,
  ): Promise<StoreOrderCloseClaimResult> {
    validateCloseClaimInput(input);
    if (input.accountId !== undefined && input.customerId !== undefined) {
      await this.acquireCustomerLocks(transaction, {
        accountId: input.accountId,
        customerId: input.customerId,
      });
    }
    await this.lockCloseOrderRows(transaction, input.orderId, input.customerId);
    const occurredAt = await this.transactionTime(transaction);
    const record = await transaction.salesOrder.findUnique({
      include: ORDER_READ_INCLUDE,
      where: { id: input.orderId },
    });
    if (!record) throw orderNotFound();
    if (input.customerId !== undefined && record.customer_id !== input.customerId) throw orderNotFound();
    const before = orderSnapshot(record, occurredAt);
    if (input.expectedVersion !== undefined && record.version !== input.expectedVersion) {
      throw orderVersionConflict();
    }
    if (record.order_status === 'CLOSED' && record.close_reason === 'USER_CANCELLED' &&
      input.mode === 'USER_CANCELLED') {
      return {
        before,
        changed: false,
        kind: 'CLOSED',
        mode: 'USER_CANCELLED',
        order: before,
        paymentIntent: null,
        providerOperation: null,
        reservationId: null,
      };
    }
    // Inspect the locked intent before applying the wall-clock eligibility
    // check.  A user cancellation may have been claimed before expiry and
    // then wait on Provider I/O; its original decision remains valid even if
    // this retry arrives after `pay_expires_at`.
    const intents = await this.lockPaymentIntents(transaction, input.orderId);
    const active = intents.filter(({ status }) =>
      status === 'CREATING' || status === 'OPEN' || status === 'CLOSE_PENDING');
    if (active.length > 1) throw internalError('Store order has multiple active payment intents');
    const existingCloseRequestedAt = active[0]?.close_requested_at ?? null;
    const existingMode = existingCloseRequestedAt === null
      ? null
      : this.closeModeForTimestamp(existingCloseRequestedAt, record.pay_expires_at, input.mode);
    const eligibilityMode = existingMode ?? input.mode;
    const requestedTimeEligible = input.mode === 'USER_CANCELLED'
      ? (record.pay_expires_at.getTime() > occurredAt.getTime() || existingMode === 'USER_CANCELLED')
      : (eligibilityMode === 'USER_CANCELLED'
        ? existingMode === 'USER_CANCELLED'
        : record.pay_expires_at.getTime() <= occurredAt.getTime());
    if (!requestedTimeEligible) {
      if (input.mode === 'PAYMENT_TIMEOUT') {
        return {
          before,
          changed: false,
          kind: 'SKIPPED',
          mode: input.mode,
          order: before,
          paymentIntent: null,
          providerOperation: null,
          reservationId: null,
        };
      }
      throw orderNotCancellable();
    }
    const baseEligible = record.order_status === 'PENDING_PAYMENT' &&
      (record.payment_status === 'UNPAID' || record.payment_status === 'PROCESSING') &&
      record.refund_progress_status === 'NONE' && record.refund_processing_status === 'IDLE' &&
      record.fulfillment_status === 'NOT_STARTED' && record.close_reason === null &&
      record.completion_reason === null && record.payment_resolution === 'NORMAL';
    if (!baseEligible) {
      if (input.mode === 'PAYMENT_TIMEOUT') return {
        before,
        changed: false,
        kind: 'SKIPPED',
        mode: input.mode,
        order: before,
        paymentIntent: null,
        providerOperation: null,
        reservationId: null,
      };
      throw orderNotCancellable();
    }

    const successful = await this.paymentIntentHasSuccessfulAttempt(transaction, intents.map(({ id }) => id));
    if (successful || intents.some(({ status }) => status === 'SUCCEEDED')) {
      if (input.mode === 'PAYMENT_TIMEOUT') return {
        before,
        changed: false,
        kind: 'SKIPPED',
        mode: input.mode,
        order: before,
        paymentIntent: null,
        providerOperation: null,
        reservationId: record.inventory_reservation?.id ?? null,
      };
      throw orderNotCancellable();
    }
    if (active.length === 1) {
      const intent = active[0]!;
      if (intent.expires_at.getTime() !== record.pay_expires_at.getTime()) {
        throw orderNotCancellable();
      }
      const mode = this.closeModeForTimestamp(intent.close_requested_at, record.pay_expires_at, input.mode);
      if (intent.close_requested_at !== null && mode !== input.mode) {
        // A timeout worker may win the race after a user request (or vice
        // versa).  Return the already claimed state instead of overwriting
        // the original close reason.
        const current = this.closePaymentIntentSnapshot(intent);
        return {
          before,
          changed: false,
          kind: 'PENDING',
          mode,
          order: before,
          paymentIntent: current,
          providerOperation: intent.provider_intent_id === null ? 'QUERY' : 'CLOSE',
          reservationId: record.inventory_reservation?.id ?? null,
        };
      }
      let current = intent;
      let changed = false;
      if (intent.status !== 'CLOSE_PENDING' || intent.close_requested_at === null) {
        const updated = await transaction.paymentIntent.updateMany({
          data: {
            close_requested_at: intent.close_requested_at ?? occurredAt,
            close_attempt_count: { increment: 1 },
            last_error_code: null,
            next_reconcile_at: new Date(occurredAt.getTime() + ORDER_CLOSE_RECONCILE_DELAY_MS),
            provider_state: intent.provider_state ?? (intent.status === 'CREATING' ? 'CLOSE_REQUESTED' : 'OPEN'),
            status: 'CLOSE_PENDING',
            updated_at: occurredAt,
            version: { increment: 1 },
          },
          where: { id: intent.id, order_id: input.orderId, version: intent.version },
        });
        if (updated.count !== 1) throw internalError('Store order close claim lost its payment intent');
        current = {
          ...intent,
          close_requested_at: intent.close_requested_at ?? occurredAt,
          close_attempt_count: intent.close_attempt_count + 1,
          last_error_code: null,
          next_reconcile_at: new Date(occurredAt.getTime() + ORDER_CLOSE_RECONCILE_DELAY_MS),
          provider_state: intent.provider_state ?? (intent.status === 'CREATING' ? 'CLOSE_REQUESTED' : 'OPEN'),
          status: 'CLOSE_PENDING',
          updated_at: occurredAt,
          version: intent.version + 1,
        };
        changed = true;
      }
      const currentOrder = changed
        ? await transaction.salesOrder.findUnique({ include: ORDER_READ_INCLUDE, where: { id: input.orderId } })
        : record;
      if (!currentOrder) throw internalError('Store order close claim order disappeared');
      return {
        before,
        changed,
        kind: changed ? 'PROVIDER_REQUIRED' : 'PENDING',
        mode,
        order: orderSnapshot(currentOrder, occurredAt),
        paymentIntent: this.closePaymentIntentSnapshot(current),
        providerOperation: current.provider_intent_id === null ? 'QUERY' : 'CLOSE',
        reservationId: currentOrder.inventory_reservation?.id ?? null,
      };
    }

    this.validateTerminalPaymentIntents(intents, record.pay_expires_at);
    if (record.payment_status !== 'UNPAID') {
      if (input.mode === 'PAYMENT_TIMEOUT') return {
        before,
        changed: false,
        kind: 'SKIPPED',
        mode: input.mode,
        order: before,
        paymentIntent: null,
        providerOperation: null,
        reservationId: record.inventory_reservation?.id ?? null,
      };
      throw orderNotCancellable();
    }
    const closed = await this.closeLockedOrder(transaction, {
      ...(input.accountId === undefined ? {} : { accountId: input.accountId }),
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      mode: input.mode,
      orderId: input.orderId,
    });
    if (closed === null) return {
      before,
      changed: false,
      kind: 'SKIPPED',
      mode: input.mode,
      order: before,
      paymentIntent: null,
      providerOperation: null,
      reservationId: null,
    };
    return {
      before: closed.before,
      changed: closed.changed,
      kind: 'CLOSED',
      mode: input.mode,
      order: closed.order,
      paymentIntent: null,
      providerOperation: null,
      reservationId: closed.reservationId,
    };
  }

  /**
   * Claim one due timeout/reconciliation candidate.  The locator is kept
   * intentionally small and deterministic; payment intents that are active
   * but not yet due are left for a later reconciliation pass.  The returned
   * claim contains only stable Provider lookup facts and never performs I/O.
   */
  async claimNextOrderCloseInTransaction(
    transaction: DatabaseTransaction,
  ): Promise<StoreOrderCloseClaimNextResult> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT so.id
      FROM public.sales_order AS so
      WHERE so.order_status = 'PENDING_PAYMENT'
        AND so.payment_status IN ('UNPAID', 'PROCESSING')
        AND so.refund_progress_status = 'NONE'
        AND so.refund_processing_status = 'IDLE'
        AND so.fulfillment_status = 'NOT_STARTED'
        AND so.close_reason IS NULL
        AND so.completion_reason IS NULL
        AND so.payment_resolution = 'NORMAL'
        AND (
          (
            so.pay_expires_at <= transaction_timestamp()
            AND so.payment_status = 'UNPAID'
            AND NOT EXISTS (
              SELECT 1 FROM public.payment_intent AS no_active
              WHERE no_active.order_id = so.id
                AND no_active.status IN ('CREATING', 'OPEN', 'CLOSE_PENDING')
            )
          )
          OR EXISTS (
            SELECT 1 FROM public.payment_intent AS due
            WHERE due.order_id = so.id
              AND due.status IN ('CREATING', 'OPEN', 'CLOSE_PENDING')
              AND due.provider_state IS DISTINCT FROM 'SUCCEEDED'
              -- An active intent is reconciled before expiry only after a
              -- user has explicitly requested cancellation.  Otherwise the
              -- timeout worker must wait for expiry; selecting an early OPEN
              -- intent would repeatedly return SKIPPED and starve later due
              -- orders in the deterministic queue.
              AND (
                (
                  due.status IN ('CREATING', 'OPEN')
                  AND so.pay_expires_at <= transaction_timestamp()
                )
                OR (
                  due.status = 'CLOSE_PENDING'
                  AND due.close_requested_at IS NOT NULL
                  AND (
                    due.next_reconcile_at IS NULL
                    OR due.next_reconcile_at <= transaction_timestamp()
                  )
                )
              )
          )
        )
        -- A malformed reservation is reported by the read-only integrity
        -- scan and must not prevent later healthy orders from being claimed.
        AND (
          SELECT jsonb_agg(jsonb_build_array(oi.sku_id, oi.quantity) ORDER BY oi.sku_id)
          FROM public.order_item AS oi
          WHERE oi.order_id = so.id
        ) = (
          SELECT jsonb_agg(jsonb_build_array(iri.sku_id, iri.quantity) ORDER BY iri.sku_id)
          FROM public.inventory_reservation AS ir
          INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
          WHERE ir.order_id = so.id AND ir.status = 'ACTIVE'
        )
        AND NOT EXISTS (
          SELECT 1
          FROM public.inventory_reservation AS ir
          INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
          LEFT JOIN public.inventory_balance AS ib ON ib.sku_id = iri.sku_id
          WHERE ir.order_id = so.id
            AND ir.status = 'ACTIVE'
            AND (
              ib.id IS NULL
              OR ib.physical_qty < ib.locked_qty
              OR ib.locked_qty <> (
                SELECT COALESCE(SUM(active_iri.quantity), 0)
                FROM public.inventory_reservation AS active_ir
                INNER JOIN public.inventory_reservation_item AS active_iri
                  ON active_iri.reservation_id = active_ir.id
                WHERE active_ir.status = 'ACTIVE' AND active_iri.sku_id = iri.sku_id
              )
            )
        )
      ORDER BY so.pay_expires_at ASC, so.id ASC
      FOR UPDATE OF so SKIP LOCKED
      LIMIT 1
    `);
    if (rows.length > 1) throw internalError('Expired Store order claim returned too many rows');
    const orderId = rows[0]?.id;
    if (orderId === undefined) return { kind: 'NONE' };
    requireUlid(orderId, 'Next Store order close ID');
    return this.claimOrderCloseInTransaction(transaction, {
      mode: 'PAYMENT_TIMEOUT',
      orderId,
    });
  }

  /**
   * Final phase of the close workflow.  This method accepts only normalized
   * Provider outcome fields and performs all local state changes atomically.
   * Unknown/open/success outcomes retain the reservation; definitive
   * non-payable outcomes transition the intent and then reuse the same
   * order/inventory release routine as a payment-free close.
   */
  async finalizeOrderCloseInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderCloseProviderInput,
  ): Promise<StoreOrderCloseFinalizeResult> {
    validateCloseProviderInput(input);
    await this.lockCloseOrderRows(transaction, input.orderId);
    const intents = await this.lockPaymentIntents(transaction, input.orderId);
    const intent = intents.find(({ id }) => id === input.paymentIntentId);
    if (!intent || intent.status !== 'CLOSE_PENDING') throw orderNotCancellable();
    if (intent.version !== input.expectedIntentVersion) throw orderVersionConflict();
    // Provider timestamps are untrusted observations.  Every persisted close
    // fact must use the database transaction clock so a future or stale
    // Provider clock can never move local order/inventory time backwards or
    // forwards.  `input.occurredAt` is still shape-validated above for callers
    // that retain it for transport compatibility, but is intentionally not
    // used for any local state transition.
    const occurredAt = await this.transactionTime(transaction);
    const record = await transaction.salesOrder.findUnique({
      include: ORDER_READ_INCLUDE,
      where: { id: input.orderId },
    });
    if (!record) throw orderNotFound();
    const mode = this.closeModeForTimestamp(intent.close_requested_at, record.pay_expires_at, 'PAYMENT_TIMEOUT');
    const providerIntentId = input.providerIntentId ?? intent.provider_intent_id;
    if (providerIntentId !== null &&
      (providerIntentId.length < 1 || providerIntentId.length > 128 || !/^[\x20-\x7e]+$/.test(providerIntentId))) {
      throw new TypeError('Provider intent ID is invalid');
    }
    if (intent.provider_intent_id !== null && input.providerIntentId !== undefined &&
      input.providerIntentId !== null && input.providerIntentId !== intent.provider_intent_id) {
      throw paymentResultConflict();
    }

    if (input.outcome === 'UNKNOWN' || input.outcome === 'OPEN') {
      const nextReconcileAt = input.nextReconcileAt ?? new Date(occurredAt.getTime() + 60_000);
      if (nextReconcileAt.getTime() <= occurredAt.getTime() ||
        nextReconcileAt.getTime() > occurredAt.getTime() + 24 * 60 * 60 * 1_000) {
        throw new TypeError('Provider close reconciliation time is invalid');
      }
      const updated = await transaction.paymentIntent.updateMany({
        data: {
          last_error_code: input.errorCode ?? (input.outcome === 'UNKNOWN' ? 'PROVIDER_UNKNOWN' : null),
          last_reconciled_at: occurredAt,
          next_reconcile_at: nextReconcileAt,
          provider_intent_id: providerIntentId,
          provider_state: input.providerState ?? input.outcome,
          ...(input.outcome === 'UNKNOWN' ? { reconciliation_attempt_count: { increment: 1 } } : {}),
          updated_at: occurredAt,
          version: { increment: 1 },
        },
        where: { id: intent.id, order_id: input.orderId, version: intent.version },
      });
      if (updated.count !== 1) throw internalError('Store order close Provider update lost its locked row');
      const updatedIntent = await transaction.paymentIntent.findUnique({ where: { id: intent.id } });
      if (!updatedIntent) throw internalError('Updated Store order close payment intent is unavailable');
      const updatedOrder = await transaction.salesOrder.findUnique({ include: ORDER_READ_INCLUDE, where: { id: input.orderId } });
      if (!updatedOrder) throw internalError('Updated Store order close order is unavailable');
      return {
        kind: 'PENDING',
        order: orderSnapshot(updatedOrder, occurredAt),
        paymentIntent: this.closePaymentIntentSnapshot({
          ...intent,
          close_requested_at: intent.close_requested_at,
          closed_at: updatedIntent.closed_at,
          provider_intent_id: updatedIntent.provider_intent_id,
          provider_state: updatedIntent.provider_state,
          status: 'CLOSE_PENDING',
          version: updatedIntent.version,
        }),
        reservationId: updatedOrder.inventory_reservation?.id ?? null,
        closeResult: null,
      };
    }

    if (input.outcome === 'SUCCEEDED') {
      // Keep CLOSE_PENDING until the signed/provider callback is consumed by
      // the payment settlement worker.  This preserves the reservation and
      // prevents a query response from being mistaken for a local payment
      // fact.
      const updated = await transaction.paymentIntent.updateMany({
        data: {
          last_error_code: null,
          last_reconciled_at: occurredAt,
          next_reconcile_at: null,
          provider_intent_id: providerIntentId,
          provider_state: input.providerState ?? 'SUCCEEDED',
          updated_at: occurredAt,
          version: { increment: 1 },
        },
        where: { id: intent.id, order_id: input.orderId, version: intent.version },
      });
      if (updated.count !== 1) throw internalError('Store order close success update lost its locked row');
      const updatedIntent = await transaction.paymentIntent.findUnique({ where: { id: intent.id } });
      if (!updatedIntent) throw internalError('Updated Store order close payment intent is unavailable');
      const updatedOrder = await transaction.salesOrder.findUnique({ include: ORDER_READ_INCLUDE, where: { id: input.orderId } });
      if (!updatedOrder) throw internalError('Updated Store order close order is unavailable');
      return {
        kind: 'PAYMENT_CONFIRMED',
        order: orderSnapshot(updatedOrder, occurredAt),
        paymentIntent: this.closePaymentIntentSnapshot({
          ...intent,
          closed_at: updatedIntent.closed_at,
          provider_intent_id: updatedIntent.provider_intent_id,
          provider_state: updatedIntent.provider_state,
          status: 'CLOSE_PENDING',
          version: updatedIntent.version,
        }),
        reservationId: updatedOrder.inventory_reservation?.id ?? null,
        closeResult: null,
      };
    }

    const targetStatus = input.outcome === 'NOT_FOUND'
      ? (mode === 'PAYMENT_TIMEOUT' ? 'EXPIRED' : 'CANCELLED')
      : input.outcome;
    const intentChanged = await transaction.paymentIntent.updateMany({
      data: {
        closed_at: occurredAt,
        last_error_code: input.errorCode ?? (input.outcome === 'FAILED' ? 'PAYMENT_FAILED' : null),
        last_reconciled_at: occurredAt,
        next_reconcile_at: null,
        provider_intent_id: providerIntentId,
        provider_state: input.providerState ?? input.outcome,
        status: targetStatus,
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: { id: intent.id, order_id: input.orderId, version: intent.version },
    });
    if (intentChanged.count !== 1) throw internalError('Store order close terminal update lost its locked row');
    const orderAfterIntent = await transaction.salesOrder.findUnique({ where: { id: input.orderId } });
    if (!orderAfterIntent) throw orderNotFound();
    let orderVersion = orderAfterIntent.version;
    if (orderAfterIntent.payment_status !== 'UNPAID') {
      const changed = await transaction.salesOrder.updateMany({
        data: { payment_status: 'UNPAID', updated_at: occurredAt, version: { increment: 1 } },
        where: { id: input.orderId, payment_status: orderAfterIntent.payment_status, version: orderAfterIntent.version },
      });
      if (changed.count !== 1) throw internalError('Store order close payment status update lost its locked row');
      orderVersion += 1;
    }
    const closed = await this.closeLockedOrder(transaction, {
      mode,
      orderId: input.orderId,
      expectedVersion: orderVersion,
      requestedAt: intent.close_requested_at ?? occurredAt,
    });
    if (closed === null) throw internalError('Store order close terminal result was not eligible');
    const updatedIntent = await transaction.paymentIntent.findUnique({ where: { id: intent.id } });
    if (!updatedIntent) throw internalError('Updated Store order close payment intent is unavailable');
    return {
      kind: 'CLOSED',
      order: closed.order,
      paymentIntent: this.closePaymentIntentSnapshot({
        ...intent,
        closed_at: updatedIntent.closed_at,
        provider_intent_id: updatedIntent.provider_intent_id,
        provider_state: updatedIntent.provider_state,
        status: targetStatus,
        version: updatedIntent.version,
      }),
      reservationId: closed.reservationId,
      closeResult: closed,
    };
  }

  /**
   * Repairs the local half of a close that already reached a definitive
   * non-payment Provider state.  No Provider state is changed here: the
   * locked terminal intent is only the authority to finish the order and
   * inventory transition that an earlier process failed to commit.
   */
  async repairTerminalOrderCloseInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderTerminalCloseRepairInput,
  ): Promise<StoreOrderCloseResult> {
    validateTerminalCloseRepairInput(input);
    await this.lockCloseOrderRows(transaction, input.orderId);
    const intents = await this.lockPaymentIntents(transaction, input.orderId);
    const intent = intents.find(({ id }) => id === input.paymentIntentId);
    if (!intent || !['CANCELLED', 'CLOSED', 'EXPIRED', 'FAILED'].includes(intent.status) ||
      intent.close_requested_at === null) {
      throw orderNotCancellable();
    }
    if (intent.version !== input.expectedIntentVersion) throw orderVersionConflict();
    if (await this.paymentIntentHasSuccessfulAttempt(transaction, intents.map(({ id }) => id))) {
      throw paymentResultConflict();
    }

    const occurredAt = await this.transactionTime(transaction);
    const record = await transaction.salesOrder.findUnique({
      include: ORDER_READ_INCLUDE,
      where: { id: input.orderId },
    });
    if (!record) throw orderNotFound();
    const beforeRepair = orderSnapshot(record, occurredAt);
    const mode = this.closeModeForTimestamp(intent.close_requested_at, record.pay_expires_at, 'PAYMENT_TIMEOUT');
    if (record.payment_status === 'PROCESSING') {
      const changed = await transaction.salesOrder.updateMany({
        data: { payment_status: 'UNPAID', updated_at: occurredAt, version: { increment: 1 } },
        where: {
          id: input.orderId,
          payment_status: 'PROCESSING',
          version: record.version,
        },
      });
      if (changed.count !== 1) throw internalError('Store order terminal close payment status repair lost its locked row');
    } else if (record.payment_status !== 'UNPAID') {
      throw paymentResultConflict();
    }

    const closed = await this.closeLockedOrder(transaction, {
      mode,
      orderId: input.orderId,
      repairTerminalClose: true,
      requestedAt: intent.close_requested_at,
    });
    if (closed === null) throw internalError('Store order terminal close repair was not eligible');
    return { ...closed, before: beforeRepair };
  }

  async cancelOwnedOrderInTransaction(
    transaction: DatabaseTransaction,
    input: StoreOrderCancelInput,
  ): Promise<StoreOrderCloseResult> {
    validateCancelInput(input);
    await this.acquireCustomerLocks(transaction, input);
    if (!await this.lockOwnedOrder(transaction, input.customerId, input.orderId)) throw orderNotFound();
    const result = await this.closeLockedOrder(transaction, {
      accountId: input.accountId,
      expectedVersion: input.expectedVersion,
      mode: 'USER_CANCELLED',
      orderId: input.orderId,
    });
    if (result === null) throw internalError('Store order cancellation returned no result');
    return result;
  }

  async listExpiredOrderIntegrityIssues(
    transaction: DatabaseTransaction,
    input: { after?: StoreOrderTimeoutIntegrityCursor; limit: number },
  ): Promise<StoreOrderTimeoutIntegrityIssue[]> {
    if (Object.keys(input).some((key) => key !== 'after' && key !== 'limit')) {
      throw new TypeError('Store order timeout integrity scan contains unsupported fields');
    }
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new TypeError('Store order timeout integrity scan limit must be between 1 and 100');
    }
    if (input.after !== undefined) {
      requireExactKeys(input.after, ['orderId', 'payExpiresAt'], 'Store order timeout integrity cursor');
      requireUlid(input.after.orderId, 'Store order timeout integrity cursor Order ID');
      if (!(input.after.payExpiresAt instanceof Date) || !Number.isFinite(input.after.payExpiresAt.getTime())) {
        throw new TypeError('Store order timeout integrity cursor expiry is invalid');
      }
    }
    const cursorFilter = input.after === undefined ? Prisma.sql`` : Prisma.sql`
      AND (so.pay_expires_at, so.id::text) >
        (${input.after.payExpiresAt}::timestamptz, ${input.after.orderId}::text)
    `;
    const rows = await transaction.$queryRaw<Array<{
      issue_code: string;
      order_id: string;
      pay_expires_at: Date;
    }>>(Prisma.sql`
      WITH expired_orders AS (
        SELECT so.id, so.pay_expires_at
        FROM public.sales_order AS so
        WHERE so.order_status = 'PENDING_PAYMENT'
          AND so.payment_status IN ('UNPAID', 'PROCESSING')
          AND so.refund_progress_status = 'NONE'
          AND so.refund_processing_status = 'IDLE'
          AND so.fulfillment_status = 'NOT_STARTED'
          AND so.close_reason IS NULL
          AND so.completion_reason IS NULL
          AND so.payment_resolution = 'NORMAL'
          AND so.pay_expires_at <= transaction_timestamp()
          ${cursorFilter}
        ORDER BY so.pay_expires_at ASC, so.id ASC
        LIMIT ${input.limit}
      ), integrity_issues AS (
        SELECT
          expired.id AS order_id,
          expired.pay_expires_at,
          CASE
            WHEN NOT EXISTS (
              SELECT 1 FROM public.order_item AS oi WHERE oi.order_id = expired.id
            ) THEN 'ORDER_ITEMS_MISSING'
            WHEN NOT EXISTS (
              SELECT 1
              FROM public.inventory_reservation AS ir
              WHERE ir.order_id = expired.id AND ir.status = 'ACTIVE'
            ) THEN 'ACTIVE_RESERVATION_MISSING'
            WHEN (
              SELECT jsonb_agg(jsonb_build_array(oi.sku_id, oi.quantity) ORDER BY oi.sku_id)
              FROM public.order_item AS oi
              WHERE oi.order_id = expired.id
            ) IS DISTINCT FROM (
              SELECT jsonb_agg(jsonb_build_array(iri.sku_id, iri.quantity) ORDER BY iri.sku_id)
              FROM public.inventory_reservation AS ir
              INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
              WHERE ir.order_id = expired.id AND ir.status = 'ACTIVE'
            ) THEN 'ORDER_RESERVATION_ITEMS_MISMATCH'
            WHEN EXISTS (
              SELECT 1
              FROM public.inventory_reservation AS ir
              INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
              LEFT JOIN public.inventory_balance AS ib ON ib.sku_id = iri.sku_id
              WHERE ir.order_id = expired.id
                AND ir.status = 'ACTIVE'
                AND (
                  ib.id IS NULL
                  OR ib.physical_qty < ib.locked_qty
                  OR ib.locked_qty <> (
                    SELECT COALESCE(SUM(active_iri.quantity), 0)
                    FROM public.inventory_reservation AS active_ir
                    INNER JOIN public.inventory_reservation_item AS active_iri
                      ON active_iri.reservation_id = active_ir.id
                    WHERE active_ir.status = 'ACTIVE' AND active_iri.sku_id = iri.sku_id
                  )
                )
            ) THEN 'INVENTORY_BALANCE_INVALID'
            ELSE NULL
          END AS issue_code
        FROM expired_orders AS expired
      )
      SELECT order_id, pay_expires_at, issue_code
      FROM integrity_issues
      WHERE issue_code IS NOT NULL
      ORDER BY pay_expires_at ASC, order_id ASC
    `);
    const issueCodes = new Set<StoreOrderTimeoutIntegrityCode>([
      'ACTIVE_RESERVATION_MISSING',
      'INVENTORY_BALANCE_INVALID',
      'ORDER_ITEMS_MISSING',
      'ORDER_RESERVATION_ITEMS_MISMATCH',
    ]);
    return rows.map((row) => {
      if (!isValidUlid(row.order_id) || !(row.pay_expires_at instanceof Date) ||
        !Number.isFinite(row.pay_expires_at.getTime()) ||
        !issueCodes.has(row.issue_code as StoreOrderTimeoutIntegrityCode)) {
        throw internalError('Store order timeout integrity scan returned an invalid row');
      }
      return {
        issue: row.issue_code as StoreOrderTimeoutIntegrityCode,
        orderId: row.order_id,
        payExpiresAt: new Date(row.pay_expires_at),
      };
    });
  }

  /**
   * Enumerate every timeout candidate in `(pay_expires_at, id)` order.  The
   * query intentionally does not inspect payment intents or reservation
   * integrity; those facts are resolved by the close claim itself.  Keeping
   * the candidate scan independent means a clean order advances the cursor
   * just like a corrupt one and prevents the old "only issues are paged"
   * starvation bug (TR-020).
   */
  async listExpiredOrderCandidates(
    transaction: DatabaseTransaction,
    input: { after?: StoreOrderTimeoutIntegrityCursor; limit: number },
  ): Promise<StoreOrderTimeoutCandidatePage> {
    if (!plainObject(input)) throw new TypeError('Store order timeout candidate input must be a plain object');
    const keys = Object.keys(input);
    if (keys.some((key) => key !== 'after' && key !== 'limit')) {
      throw new TypeError('Store order timeout candidate input contains unsupported fields');
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new TypeError('Store order timeout candidate limit must be between 1 and 100');
    }
    if (input.after !== undefined) {
      requireExactKeys(input.after, ['orderId', 'payExpiresAt'], 'Store order timeout candidate cursor');
      requireUlid(input.after.orderId, 'Store order timeout candidate cursor Order ID');
      if (!(input.after.payExpiresAt instanceof Date) || !Number.isFinite(input.after.payExpiresAt.getTime())) {
        throw new TypeError('Store order timeout candidate cursor expiry is invalid');
      }
    }
    const cursorFilter = input.after === undefined ? Prisma.sql`` : Prisma.sql`
      AND (so.pay_expires_at, so.id::text) >
        (${input.after.payExpiresAt}::timestamptz, ${input.after.orderId}::text)
    `;
    const rows = await transaction.$queryRaw<Array<{
      order_id: string;
      pay_expires_at: Date;
    }>>(Prisma.sql`
      SELECT so.id AS order_id, so.pay_expires_at
      FROM public.sales_order AS so
      WHERE so.order_status = 'PENDING_PAYMENT'
        AND so.payment_status IN ('UNPAID', 'PROCESSING')
        AND so.refund_progress_status = 'NONE'
        AND so.refund_processing_status = 'IDLE'
        AND so.fulfillment_status = 'NOT_STARTED'
        AND so.close_reason IS NULL
        AND so.completion_reason IS NULL
        AND so.payment_resolution = 'NORMAL'
        AND so.pay_expires_at <= transaction_timestamp()
        ${cursorFilter}
      ORDER BY so.pay_expires_at ASC, so.id ASC
      LIMIT ${input.limit + 1}
    `);
    if (rows.length > input.limit + 1) {
      throw internalError('Store order timeout candidate query returned too many rows');
    }
    const candidates = rows.map((row) => {
      requireUlid(row.order_id, 'Expired Store order candidate ID');
      if (!(row.pay_expires_at instanceof Date) || !Number.isFinite(row.pay_expires_at.getTime())) {
        throw internalError('Expired Store order candidate expiry is invalid');
      }
      return { orderId: row.order_id, payExpiresAt: new Date(row.pay_expires_at) };
    });
    const hasMore = candidates.length > input.limit;
    const items = hasMore ? candidates.slice(0, input.limit) : candidates;
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last !== undefined
        ? { orderId: last.orderId, payExpiresAt: new Date(last.payExpiresAt) }
        : null,
    };
  }

  async expireNextOrderInTransaction(transaction: DatabaseTransaction): Promise<StoreOrderTimeoutResult> {
    const orderId = await this.lockNextExpiredOrder(transaction);
    if (orderId === null) return { kind: 'none' };
    const result = await this.closeLockedOrder(transaction, { mode: 'PAYMENT_TIMEOUT', orderId });
    return result === null ? { kind: 'skipped' } : { kind: 'closed', result };
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
