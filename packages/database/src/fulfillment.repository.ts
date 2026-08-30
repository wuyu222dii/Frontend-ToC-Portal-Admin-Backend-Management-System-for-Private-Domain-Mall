import { ApplicationError, isValidUlid } from '@qingxu/platform-core';
import { createHmac } from 'node:crypto';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type {
  AftersaleStatus,
  AttributionChannel,
  FulfillmentStatus,
  OrderCloseReason,
  OrderCompletionReason,
  OrderSource,
  OrderStatus,
  PaymentResolution,
  PaymentStatus,
  RefundProcessingStatus,
  RefundProgressStatus,
  ShipmentStatus,
} from '../.generated/prisma/enums';
import type { DatabaseTransaction } from './idempotency.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const PHONE_LAST4 = /^[0-9]{4}$/;
const CUSTOMER_ALIAS_HMAC_DOMAIN = 'qingxu:admin-fulfillment-customer-alias:v1';
const ACTIVE_AFTERSALE_STATUSES = new Set<AftersaleStatus>([
  'PENDING_REVIEW',
  'REFUNDING',
  'WAITING_RETURN',
  'WAITING_RECEIPT',
  'RETURN_EXCEPTION',
  'REFUNDING_AFTER_RETURN',
  'REFUND_FAILED',
]);

export type FulfillmentOrderListSort = 'AMOUNT_DESC' | 'CREATED_DESC' | 'PAID_DESC';

export interface AdminFulfillmentOrderListInput {
  agentId?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  customerId?: string;
  fulfillmentStatus?: FulfillmentStatus;
  maxAmount?: string;
  minAmount?: string;
  orderNo?: string;
  orderStatus?: OrderStatus;
  page: number;
  pageSize: number;
  paymentStatus?: PaymentStatus;
  refundProcessingStatus?: RefundProcessingStatus;
  refundProgressStatus?: RefundProgressStatus;
  sort: FulfillmentOrderListSort;
}

export interface FulfillmentOrderReadInput {
  orderId: string;
}

export interface OwnedFulfillmentReadInput extends FulfillmentOrderReadInput {
  customerId: string;
}

export interface OwnedFulfillmentListInput {
  customerId: string;
  orderIds: readonly string[];
}

export interface FulfillmentOrderAmounts {
  goods: string;
  paid: string;
  payable: string;
  refunded: string;
  shipping: string;
}

export interface FulfillmentOrderItemProjection {
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

export interface FulfillmentOrderProjection {
  aftersaleExpiresAt: Date | null;
  amounts: FulfillmentOrderAmounts;
  businessRuleVersionId: string | null;
  closeReason: OrderCloseReason | null;
  closedAt: Date | null;
  completedAt: Date | null;
  completionReason: OrderCompletionReason | null;
  createdAt: Date;
  customerId: string;
  finalAgentId: string | null;
  finalChannel: AttributionChannel | null;
  fulfillmentStatus: FulfillmentStatus;
  items: FulfillmentOrderItemProjection[];
  orderId: string;
  orderNo: string;
  orderStatus: OrderStatus;
  paidAt: Date | null;
  payExpiresAt: Date;
  paymentResolution: PaymentResolution;
  paymentStatus: PaymentStatus;
  refundProcessingStatus: RefundProcessingStatus;
  refundProgressStatus: RefundProgressStatus;
  source: OrderSource;
  updatedAt: Date;
  version: number;
}

export interface AdminFulfillmentOrderListItem {
  agentId: string | null;
  agentName: string | null;
  createdAt: Date;
  customerAlias: string;
  customerId: string;
  fulfillmentStatus: FulfillmentStatus;
  orderId: string;
  orderNo: string;
  orderStatus: OrderStatus;
  paidAt: Date | null;
  payableAmount: string;
  paymentResolution: PaymentResolution;
  paymentStatus: PaymentStatus;
  recipientPhoneMasked: string | null;
  refundProcessingStatus: RefundProcessingStatus;
  refundProgressStatus: RefundProgressStatus;
  version: number;
}

export interface AdminFulfillmentOrderListResult {
  items: AdminFulfillmentOrderListItem[];
  total: number;
}

export interface FulfillmentLogisticsEventProjection {
  actorAccountId: string | null;
  carrierCode: string | null;
  carrierName: string | null;
  createdAt: Date;
  description: string;
  eventId: string;
  eventKey: string;
  eventType: 'STATUS' | 'TRACKING_CORRECTION';
  location: string | null;
  occurredAt: Date;
  reason: string | null;
  source: string;
  statusCode: ShipmentStatus | null;
  trackingNo: string | null;
}

export interface FulfillmentShipmentItemProjection {
  orderItemId: string;
  productName: string;
  quantity: number;
  shipmentItemId: string;
  skuId: string;
  skuName: string;
}

export interface FulfillmentShipmentProjection {
  carrierCode: string;
  carrierName: string;
  createdAt: Date;
  deliveredAt: Date | null;
  events: FulfillmentLogisticsEventProjection[];
  items: FulfillmentShipmentItemProjection[];
  orderId: string;
  shipmentId: string;
  shippedAt: Date;
  status: ShipmentStatus;
  trackingNo: string;
  updatedAt: Date;
  version: number;
}

export interface AdminFulfillmentCustomerProjection {
  customerAlias: string;
  customerId: string;
  nicknameMasked: string | null;
  phoneMasked: string | null;
}

export interface AdminFulfillmentAttributionProjection {
  agentId: string | null;
  agentName: string | null;
  frozenAt: Date | null;
  source: AttributionChannel;
}

export interface MaskedFulfillmentAddressProjection {
  detailMasked: string;
  phoneMasked: string;
  recipientNameMasked: string;
  regionSummary: string;
}

export interface FulfillmentPaymentAttemptProjection {
  amount: string;
  createdAt: Date;
  failureCode: string | null;
  intentNo: string;
  paymentAttemptId: string;
  providerTransactionIdMasked: string | null;
  status: 'CANCELLED' | 'FAILED' | 'INITIATED' | 'SUCCEEDED' | 'SUCCEEDED_LATE';
  updatedAt: Date;
}

export interface FulfillmentRefundAttemptProjection {
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

export interface FulfillmentAftersaleProjection {
  aftersaleId: string;
  aftersaleNo: string;
  createdAt: Date;
  requestedAmount: string;
  status: AftersaleStatus;
  type: 'AMOUNT_COMPENSATION' | 'REFUND_ONLY' | 'RETURN_REFUND';
  version: number;
}

export interface FulfillmentInventoryImpactProjection {
  availableChange: number;
  onHandChange: number;
  reasons: string[];
  reservedChange: number;
  skuId: string;
}

export interface FulfillmentCommissionImpactProjection {
  commissionSnapshotId: string;
  expectedRemaining: string;
  latestState: 'AVAILABLE' | 'CANCELLED' | 'EXPECTED' | 'NONE';
  orderItemId: string;
  originalCommission: string;
  reversedTotal: string;
}

export interface FulfillmentActionEligibility {
  activeAftersaleCount: number;
  canAddLogisticsEvent: boolean;
  canComplete: boolean;
  canReadFulfillmentAddress: boolean;
  canShip: boolean;
  hasUnresolvedPayment: boolean;
}

export interface AdminFulfillmentOrderDetail {
  addressMasked: MaskedFulfillmentAddressProjection;
  aftersales: FulfillmentAftersaleProjection[];
  attribution: AdminFulfillmentAttributionProjection;
  commissionImpact: FulfillmentCommissionImpactProjection[];
  customer: AdminFulfillmentCustomerProjection;
  eligibility: FulfillmentActionEligibility;
  inventoryImpact: FulfillmentInventoryImpactProjection[];
  order: FulfillmentOrderProjection;
  paymentAttempts: FulfillmentPaymentAttemptProjection[];
  refundAttempts: FulfillmentRefundAttemptProjection[];
  shipment: FulfillmentShipmentProjection | null;
}

/**
 * Internal-only encrypted address material. It may only be consumed by the
 * purpose-bound fulfillment address service and must never be logged or used
 * by the ordinary Admin list/detail projections.
 */
export interface AdminFulfillmentAddressMaterial {
  city: string;
  detailCiphertext: Uint8Array;
  district: string;
  eligibleForRead: boolean;
  encryptionKeyId: string;
  fulfillmentStatus: FulfillmentStatus;
  orderId: string;
  orderNo: string;
  orderStatus: OrderStatus;
  paymentResolution: PaymentResolution;
  paymentStatus: PaymentStatus;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
  province: string;
  recipientName: string;
  snapshotAt: Date;
  snapshotId: string;
}

export interface OwnedFulfillmentProjection {
  canConfirmReceipt: boolean;
  canViewLogistics: boolean;
  customerId: string;
  fulfillmentStatus: FulfillmentStatus;
  orderId: string;
  orderStatus: OrderStatus;
  paymentResolution: PaymentResolution;
  paymentStatus: PaymentStatus;
  shipment: FulfillmentShipmentProjection | null;
  version: number;
}

const ORDER_ITEM_SELECT = {
  aftersale_reserved_amount: true,
  aftersale_reserved_qty: true,
  brand_name_snapshot: true,
  category_id: true,
  category_name_snapshot: true,
  created_at: true,
  id: true,
  line_paid_amount: true,
  pre_shipment_refunded_qty: true,
  product_id: true,
  product_name_snapshot: true,
  quantity: true,
  refunded_amount: true,
  refunded_qty: true,
  shipped_qty: true,
  sku_code_snapshot: true,
  sku_id: true,
  sku_name_snapshot: true,
  unit_price: true,
  version: true,
} satisfies Prisma.OrderItemSelect;

const SHIPMENT_INCLUDE = {
  events: {
    orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }] satisfies Prisma.LogisticsEventOrderByWithRelationInput[],
  },
  items: {
    orderBy: [{ order_item_id: 'asc' }, { id: 'asc' }] satisfies Prisma.ShipmentItemOrderByWithRelationInput[],
    include: {
      order_item: {
        select: {
          id: true,
          order_id: true,
          product_name_snapshot: true,
          sku_id: true,
          sku_name_snapshot: true,
        },
      },
    },
  },
} satisfies Prisma.ShipmentInclude;

const ADMIN_LIST_INCLUDE = {
  address_snapshot: { select: { phone_last4: true } },
  attribution_snapshot: {
    select: {
      privacy_projection: { select: { customer_alias: true } },
    },
  },
  final_agent: { select: { id: true, name: true } },
} satisfies Prisma.SalesOrderInclude;

const ADMIN_DETAIL_INCLUDE = {
  address_snapshot: {
    select: {
      city: true,
      district: true,
      id: true,
      phone_last4: true,
      province: true,
      recipient_name: true,
    },
  },
  aftersales: {
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }] satisfies Prisma.AftersaleOrderByWithRelationInput[],
    select: {
      aftersale_no: true,
      created_at: true,
      id: true,
      items: {
        orderBy: [{ order_item_id: 'asc' }, { id: 'asc' }] satisfies Prisma.AftersaleItemOrderByWithRelationInput[],
        select: { requested_amount: true },
      },
      status: true,
      type: true,
      version: true,
    },
  },
  attribution_snapshot: {
    select: {
      captured_at: true,
      final_channel: true,
      privacy_projection: {
        select: { customer_alias: true, nickname_masked: true, phone_tail: true },
      },
    },
  },
  customer: { select: { id: true, nickname: true } },
  final_agent: { select: { id: true, name: true } },
  inventory_reservation: { select: { id: true } },
  items: {
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }] satisfies Prisma.OrderItemOrderByWithRelationInput[],
    select: {
      ...ORDER_ITEM_SELECT,
      commission_snapshot: {
        select: {
          id: true,
          original_commission: true,
          position: {
            select: {
              expected_remaining: true,
              reversed_total: true,
              state: true,
            },
          },
        },
      },
    },
  },
  payment_intents: {
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }] satisfies Prisma.PaymentIntentOrderByWithRelationInput[],
    select: {
      attempts: {
        orderBy: [{ initiated_at: 'asc' }, { id: 'asc' }] satisfies Prisma.PaymentAttemptOrderByWithRelationInput[],
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
    orderBy: [{ requested_at: 'asc' }, { id: 'asc' }] satisfies Prisma.RefundOrderByWithRelationInput[],
    select: {
      amount: true,
      attempts: {
        orderBy: [{ attempt_no: 'asc' }, { id: 'asc' }] satisfies Prisma.RefundAttemptOrderByWithRelationInput[],
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
  },
  shipment: { include: SHIPMENT_INCLUDE },
} satisfies Prisma.SalesOrderInclude;

const OWNED_FULFILLMENT_SELECT = {
  aftersales: { select: { id: true, status: true } },
  customer_id: true,
  fulfillment_status: true,
  id: true,
  order_status: true,
  payment_resolution: true,
  payment_status: true,
  shipment: { include: SHIPMENT_INCLUDE },
  version: true,
} satisfies Prisma.SalesOrderSelect;

type AdminListRecord = Prisma.SalesOrderGetPayload<{ include: typeof ADMIN_LIST_INCLUDE }>;
type AdminDetailRecord = Prisma.SalesOrderGetPayload<{ include: typeof ADMIN_DETAIL_INCLUDE }>;
type FulfillmentItemRecord = Prisma.OrderItemGetPayload<{ select: typeof ORDER_ITEM_SELECT }>;
type ShipmentRecord = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;
type OwnedFulfillmentRecord = Prisma.SalesOrderGetPayload<{ select: typeof OWNED_FULFILLMENT_SELECT }>;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Order not found');
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!plainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function safeUlid(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isValidUlid(value)) throw internal(`${label} is invalid`);
  return value;
}

function safeText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 ||
    Array.from(value).length > maximum || Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f;
    })) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function safeNullableText(value: unknown, maximum: number, label: string): string | null {
  if (value === null) return null;
  return safeText(value, maximum, label);
}

function safeDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function safeNullableDate(value: unknown, label: string): Date | null {
  return value === null ? null : safeDate(value, label);
}

function safeCount(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return Number(value);
}

function safeMoney(value: unknown, label: string): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || value.decimalPlaces() > 2 ||
    value.greaterThan('9999999999999999.99')) {
    throw internal(`${label} is invalid`);
  }
  return value.toFixed(2);
}

function maskedName(value: string): string {
  const characters = Array.from(safeText(value, 80, 'Stored recipient name'));
  return `${characters[0]}**`;
}

function maskedNickname(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return `${Array.from(safeText(normalized, 80, 'Stored customer nickname'))[0]}**`;
}

function maskedPhone(last4: string | null): string | null {
  if (last4 === null) return null;
  if (!PHONE_LAST4.test(last4)) throw internal('Stored phone tail is invalid');
  return `*** **** ${last4}`;
}

function maskedReference(value: string | null): string | null {
  if (value === null) return null;
  const safe = safeText(value, 128, 'Stored Provider transaction reference');
  if (safe.length <= 8) return '****';
  return `${safe.slice(0, 4)}****${safe.slice(-4)}`;
}

function customerAlias(
  record: Pick<AdminListRecord, 'attribution_snapshot' | 'customer_id'>,
  aliasHmacKey: Uint8Array | null,
): string {
  const alias = record.attribution_snapshot?.privacy_projection?.customer_alias;
  if (alias !== undefined && alias !== null) return safeText(alias, 80, 'Stored customer alias');
  if (aliasHmacKey === null) throw internal('Stored customer alias is missing and alias HMAC key is unavailable');
  const customerId = safeUlid(record.customer_id, 'Stored customer ID');
  const digest = createHmac('sha256', aliasHmacKey)
    .update(CUSTOMER_ALIAS_HMAC_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(customerId, 'utf8')
    .digest('hex');
  return `customer_${digest.slice(0, 26)}`;
}

function validateReadInput(input: FulfillmentOrderReadInput): void {
  requireExactKeys(input, ['orderId'], ['orderId'], 'Fulfillment order read input');
  requireUlid(input.orderId, 'Fulfillment order ID');
}

function validateOwnedReadInput(input: OwnedFulfillmentReadInput): void {
  requireExactKeys(input, ['customerId', 'orderId'], ['customerId', 'orderId'], 'Owned fulfillment read input');
  requireUlid(input.customerId, 'Owned fulfillment Customer ID');
  requireUlid(input.orderId, 'Owned fulfillment order ID');
}

function validateOwnedListInput(input: OwnedFulfillmentListInput): void {
  requireExactKeys(
    input,
    ['customerId', 'orderIds'],
    ['customerId', 'orderIds'],
    'Owned fulfillment list input',
  );
  requireUlid(input.customerId, 'Owned fulfillment list Customer ID');
  if (!Array.isArray(input.orderIds) || input.orderIds.length > 100) {
    throw new TypeError('Owned fulfillment order IDs must contain 0 to 100 entries');
  }
  const unique = new Set<string>();
  for (const orderId of input.orderIds) {
    requireUlid(orderId, 'Owned fulfillment list order ID');
    if (unique.has(orderId)) throw new TypeError('Owned fulfillment list order IDs must be unique');
    unique.add(orderId);
  }
}

const ORDER_STATUSES = new Set<OrderStatus>([
  'CLOSED', 'COMPLETED', 'PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING',
]);
const PAYMENT_STATUSES = new Set<PaymentStatus>(['PAID', 'PROCESSING', 'UNPAID']);
const REFUND_PROGRESS_STATUSES = new Set<RefundProgressStatus>(['FULL', 'NONE', 'PARTIAL']);
const REFUND_PROCESSING_STATUSES = new Set<RefundProcessingStatus>(['FAILED', 'IDLE', 'REFUNDING']);
const FULFILLMENT_STATUSES = new Set<FulfillmentStatus>([
  'CANCELLED', 'DELIVERED', 'IN_TRANSIT', 'NOT_STARTED', 'READY_TO_SHIP', 'SHIPPED',
]);
const LIST_SORTS = new Set<FulfillmentOrderListSort>(['AMOUNT_DESC', 'CREATED_DESC', 'PAID_DESC']);

function validateListInput(input: AdminFulfillmentOrderListInput): void {
  const allowed = [
    'agentId', 'createdAtFrom', 'createdAtToExclusive', 'customerId', 'fulfillmentStatus', 'maxAmount',
    'minAmount', 'orderNo', 'orderStatus', 'page', 'pageSize', 'paymentStatus', 'refundProcessingStatus',
    'refundProgressStatus', 'sort',
  ] as const;
  requireExactKeys(input, allowed, ['page', 'pageSize', 'sort'], 'Admin fulfillment order list input');
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_POSTGRES_INTEGER ||
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100 ||
    (input.page - 1) * input.pageSize > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Admin fulfillment order pagination is invalid');
  }
  if (!LIST_SORTS.has(input.sort)) throw new TypeError('Admin fulfillment order sort is invalid');
  if (input.customerId !== undefined) requireUlid(input.customerId, 'Admin fulfillment Customer ID');
  if (input.agentId !== undefined) requireUlid(input.agentId, 'Admin fulfillment Agent ID');
  if (input.orderNo !== undefined && (typeof input.orderNo !== 'string' || input.orderNo.trim() !== input.orderNo ||
    input.orderNo.length < 1 || input.orderNo.length > 32)) {
    throw new TypeError('Admin fulfillment order number is invalid');
  }
  if (input.orderStatus !== undefined && !ORDER_STATUSES.has(input.orderStatus)) {
    throw new TypeError('Admin fulfillment order status is invalid');
  }
  if (input.paymentStatus !== undefined && !PAYMENT_STATUSES.has(input.paymentStatus)) {
    throw new TypeError('Admin fulfillment payment status is invalid');
  }
  if (input.refundProgressStatus !== undefined && !REFUND_PROGRESS_STATUSES.has(input.refundProgressStatus)) {
    throw new TypeError('Admin fulfillment refund progress status is invalid');
  }
  if (input.refundProcessingStatus !== undefined &&
    !REFUND_PROCESSING_STATUSES.has(input.refundProcessingStatus)) {
    throw new TypeError('Admin fulfillment refund processing status is invalid');
  }
  if (input.fulfillmentStatus !== undefined && !FULFILLMENT_STATUSES.has(input.fulfillmentStatus)) {
    throw new TypeError('Admin fulfillment status is invalid');
  }
  for (const [label, value] of [
    ['created-at lower bound', input.createdAtFrom],
    ['created-at upper bound', input.createdAtToExclusive],
  ] as const) {
    if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
      throw new TypeError(`Admin fulfillment ${label} is invalid`);
    }
  }
  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Admin fulfillment date range is invalid');
  }
  for (const [label, value] of [['minimum', input.minAmount], ['maximum', input.maxAmount]] as const) {
    if (value !== undefined && (!MONEY.test(value) || new Prisma.Decimal(value).greaterThan('9999999999999999.99'))) {
      throw new TypeError(`Admin fulfillment ${label} amount is invalid`);
    }
  }
  if (input.minAmount !== undefined && input.maxAmount !== undefined &&
    new Prisma.Decimal(input.minAmount).greaterThan(input.maxAmount)) {
    throw new TypeError('Admin fulfillment amount range is invalid');
  }
}

function listWhere(input: AdminFulfillmentOrderListInput): Prisma.SalesOrderWhereInput {
  return {
    ...(input.agentId === undefined ? {} : { final_agent_id: input.agentId }),
    ...(input.customerId === undefined ? {} : { customer_id: input.customerId }),
    ...(input.fulfillmentStatus === undefined ? {} : { fulfillment_status: input.fulfillmentStatus }),
    ...(input.orderNo === undefined ? {} : { order_no: input.orderNo }),
    ...(input.orderStatus === undefined ? {} : { order_status: input.orderStatus }),
    ...(input.paymentStatus === undefined ? {} : { payment_status: input.paymentStatus }),
    ...(input.refundProcessingStatus === undefined
      ? {}
      : { refund_processing_status: input.refundProcessingStatus }),
    ...(input.refundProgressStatus === undefined
      ? {}
      : { refund_progress_status: input.refundProgressStatus }),
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
  };
}

function listOrderBy(sort: FulfillmentOrderListSort): Prisma.SalesOrderOrderByWithRelationInput[] {
  if (sort === 'AMOUNT_DESC') return [{ payable_amount: 'desc' }, { id: 'desc' }];
  if (sort === 'PAID_DESC') return [{ paid_at: { nulls: 'last', sort: 'desc' } }, { id: 'desc' }];
  return [{ created_at: 'desc' }, { id: 'desc' }];
}

function orderItem(record: FulfillmentItemRecord): FulfillmentOrderItemProjection {
  const quantity = safeCount(record.quantity, 'Stored order item quantity', 1);
  const unitPrice = safeMoney(record.unit_price, 'Stored order item unit price');
  const lineAmount = safeMoney(record.line_paid_amount, 'Stored order item line amount');
  if (!new Prisma.Decimal(unitPrice).mul(quantity).equals(lineAmount)) {
    throw internal('Stored order item amount is inconsistent');
  }
  const refundedQuantity = safeCount(record.refunded_qty, 'Stored order item refunded quantity');
  const reservedAftersaleQuantity = safeCount(
    record.aftersale_reserved_qty,
    'Stored order item reserved aftersale quantity',
  );
  const shippedQuantity = safeCount(record.shipped_qty, 'Stored order item shipped quantity');
  const preShipmentRefundedQuantity = safeCount(
    record.pre_shipment_refunded_qty,
    'Stored order item pre-shipment refunded quantity',
  );
  if (refundedQuantity > quantity || reservedAftersaleQuantity > quantity - refundedQuantity ||
    preShipmentRefundedQuantity > refundedQuantity || shippedQuantity > quantity - preShipmentRefundedQuantity) {
    throw internal('Stored order item counters are inconsistent');
  }
  return {
    brandName: safeText(record.brand_name_snapshot, 120, 'Stored order item brand name'),
    categoryId: safeUlid(record.category_id, 'Stored order item category ID'),
    categoryName: safeText(record.category_name_snapshot, 120, 'Stored order item category name'),
    createdAt: safeDate(record.created_at, 'Stored order item creation time'),
    lineAmount,
    orderItemId: safeUlid(record.id, 'Stored order item ID'),
    productId: safeUlid(record.product_id, 'Stored order item product ID'),
    productName: safeText(record.product_name_snapshot, 200, 'Stored order item product name'),
    quantity,
    refundedAmount: safeMoney(record.refunded_amount, 'Stored order item refunded amount'),
    refundedQuantity,
    reservedAftersaleAmount: safeMoney(
      record.aftersale_reserved_amount,
      'Stored order item reserved aftersale amount',
    ),
    reservedAftersaleQuantity,
    shippedQuantity,
    skuCode: safeText(record.sku_code_snapshot, 80, 'Stored order item SKU code'),
    skuId: safeUlid(record.sku_id, 'Stored order item SKU ID'),
    skuName: safeText(record.sku_name_snapshot, 160, 'Stored order item SKU name'),
    unitPrice,
    version: safeCount(record.version, 'Stored order item version', 1),
  };
}

function orderProjection(record: AdminDetailRecord): FulfillmentOrderProjection {
  const goods = safeMoney(record.goods_amount, 'Stored order goods amount');
  const shipping = safeMoney(record.shipping_amount, 'Stored order shipping amount');
  const payable = safeMoney(record.payable_amount, 'Stored order payable amount');
  if (!new Prisma.Decimal(goods).plus(shipping).equals(payable)) {
    throw internal('Stored order amount is inconsistent');
  }
  return {
    aftersaleExpiresAt: safeNullableDate(record.aftersale_expires_at, 'Stored order aftersale expiry'),
    amounts: {
      goods,
      paid: safeMoney(record.paid_amount, 'Stored order paid amount'),
      payable,
      refunded: safeMoney(record.refunded_amount, 'Stored order refunded amount'),
      shipping,
    },
    businessRuleVersionId: record.business_rule_version_id === null
      ? null
      : safeUlid(record.business_rule_version_id, 'Stored business rule version ID'),
    closeReason: record.close_reason,
    closedAt: safeNullableDate(record.closed_at, 'Stored order closure time'),
    completedAt: safeNullableDate(record.completed_at, 'Stored order completion time'),
    completionReason: record.completion_reason,
    createdAt: safeDate(record.created_at, 'Stored order creation time'),
    customerId: safeUlid(record.customer_id, 'Stored customer ID'),
    finalAgentId: record.final_agent_id === null ? null : safeUlid(record.final_agent_id, 'Stored final Agent ID'),
    finalChannel: record.final_channel,
    fulfillmentStatus: record.fulfillment_status,
    items: record.items.map((item) => orderItem(item)),
    orderId: safeUlid(record.id, 'Stored order ID'),
    orderNo: safeText(record.order_no, 32, 'Stored order number'),
    orderStatus: record.order_status,
    paidAt: safeNullableDate(record.paid_at, 'Stored order paid time'),
    payExpiresAt: safeDate(record.pay_expires_at, 'Stored order payment expiry'),
    paymentResolution: record.payment_resolution,
    paymentStatus: record.payment_status,
    refundProcessingStatus: record.refund_processing_status,
    refundProgressStatus: record.refund_progress_status,
    source: record.source,
    updatedAt: safeDate(record.updated_at, 'Stored order update time'),
    version: safeCount(record.version, 'Stored order version', 1),
  };
}

function logisticsEvent(record: ShipmentRecord['events'][number]): FulfillmentLogisticsEventProjection {
  if (record.event_type !== 'STATUS' && record.event_type !== 'TRACKING_CORRECTION') {
    throw internal('Stored logistics event type is invalid');
  }
  if (record.status_code !== null && record.status_code !== 'SHIPPED' &&
    record.status_code !== 'IN_TRANSIT' && record.status_code !== 'DELIVERED') {
    throw internal('Stored logistics status code is invalid');
  }
  if ((record.event_type === 'STATUS') !== (record.status_code !== null)) {
    throw internal('Stored logistics event shape is inconsistent');
  }
  return {
    actorAccountId: record.actor_account_id === null
      ? null
      : safeUlid(record.actor_account_id, 'Stored logistics actor Account ID'),
    carrierCode: safeNullableText(record.carrier_code, 40, 'Stored logistics carrier code'),
    carrierName: safeNullableText(record.carrier_name, 80, 'Stored logistics carrier name'),
    createdAt: safeDate(record.created_at, 'Stored logistics event creation time'),
    description: safeText(record.description, 300, 'Stored logistics description'),
    eventId: safeUlid(record.id, 'Stored logistics event ID'),
    eventKey: safeText(record.event_key, 80, 'Stored logistics event key'),
    eventType: record.event_type,
    location: safeNullableText(record.location, 160, 'Stored logistics location'),
    occurredAt: safeDate(record.occurred_at, 'Stored logistics event occurrence time'),
    reason: safeNullableText(record.reason, 500, 'Stored logistics reason'),
    source: safeText(record.source, 30, 'Stored logistics source'),
    statusCode: record.status_code,
    trackingNo: safeNullableText(record.tracking_no, 120, 'Stored logistics tracking number'),
  };
}

function shipmentProjection(record: ShipmentRecord): FulfillmentShipmentProjection {
  const orderId = safeUlid(record.order_id, 'Stored shipment order ID');
  if (record.items.length < 1) throw internal('Stored shipment has no items');
  const items = record.items.map((item) => {
    if (item.order_item.order_id !== orderId) throw internal('Stored shipment item belongs to another order');
    return {
      orderItemId: safeUlid(item.order_item.id, 'Stored shipment order item ID'),
      productName: safeText(item.order_item.product_name_snapshot, 200, 'Stored shipment product name'),
      quantity: safeCount(item.quantity, 'Stored shipment item quantity', 1),
      shipmentItemId: safeUlid(item.id, 'Stored shipment item ID'),
      skuId: safeUlid(item.order_item.sku_id, 'Stored shipment SKU ID'),
      skuName: safeText(item.order_item.sku_name_snapshot, 160, 'Stored shipment SKU name'),
    };
  });
  const shippedAt = safeDate(record.shipped_at, 'Stored shipment dispatch time');
  const deliveredAt = safeNullableDate(record.delivered_at, 'Stored shipment delivery time');
  if ((record.status === 'DELIVERED') !== (deliveredAt !== null) ||
    (deliveredAt !== null && deliveredAt.getTime() < shippedAt.getTime())) {
    throw internal('Stored shipment delivery facts are inconsistent');
  }
  return {
    carrierCode: safeText(record.carrier_code, 40, 'Stored shipment carrier code'),
    carrierName: safeText(record.carrier_name, 80, 'Stored shipment carrier name'),
    createdAt: safeDate(record.created_at, 'Stored shipment creation time'),
    deliveredAt,
    events: record.events.map(logisticsEvent),
    items,
    orderId,
    shipmentId: safeUlid(record.id, 'Stored shipment ID'),
    shippedAt,
    status: record.status,
    trackingNo: safeText(record.tracking_no, 120, 'Stored shipment tracking number'),
    updatedAt: safeDate(record.updated_at, 'Stored shipment update time'),
    version: safeCount(record.version, 'Stored shipment version', 1),
  };
}

function hasActiveAftersale(records: readonly { status: AftersaleStatus }[]): boolean {
  return records.some(({ status }) => ACTIVE_AFTERSALE_STATUSES.has(status));
}

function readEligible(record: {
  fulfillment_status: FulfillmentStatus;
  order_status: OrderStatus;
  payment_resolution: PaymentResolution;
  payment_status: PaymentStatus;
  shipment: { status: ShipmentStatus } | null;
}): boolean {
  if (record.payment_status !== 'PAID' || record.payment_resolution !== 'NORMAL') return false;
  if (record.order_status === 'PENDING_SHIPMENT' && record.fulfillment_status === 'READY_TO_SHIP') {
    return record.shipment === null;
  }
  if (record.order_status !== 'SHIPPING' || record.shipment === null) return false;
  return (record.fulfillment_status === 'SHIPPED' || record.fulfillment_status === 'IN_TRANSIT') &&
    record.shipment.status === record.fulfillment_status;
}

function actionEligibility(record: AdminDetailRecord): FulfillmentActionEligibility {
  const activeAftersaleCount = record.aftersales.filter(({ status }) =>
    ACTIVE_AFTERSALE_STATUSES.has(status)).length;
  const hasUnresolvedPayment = record.payment_resolution !== 'NORMAL';
  const shipment = record.shipment;
  const canComplete = record.payment_status === 'PAID' && !hasUnresolvedPayment &&
    record.order_status === 'SHIPPING' && activeAftersaleCount === 0 && shipment !== null &&
    (shipment.status === 'SHIPPED' || shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED');
  return {
    activeAftersaleCount,
    canAddLogisticsEvent: record.order_status === 'SHIPPING' && shipment !== null,
    canComplete,
    canReadFulfillmentAddress: readEligible(record),
    canShip: record.order_status === 'PENDING_SHIPMENT' && record.payment_status === 'PAID' &&
      !hasUnresolvedPayment && record.fulfillment_status === 'READY_TO_SHIP' &&
      activeAftersaleCount === 0 && shipment === null,
    hasUnresolvedPayment,
  };
}

function paymentAttempts(record: AdminDetailRecord): FulfillmentPaymentAttemptProjection[] {
  return record.payment_intents.flatMap((intent) => {
    const intentNo = safeText(intent.intent_no, 32, 'Stored payment intent number');
    return intent.attempts.map((attempt) => ({
      amount: safeMoney(attempt.amount, 'Stored payment attempt amount'),
      createdAt: safeDate(attempt.initiated_at, 'Stored payment attempt creation time'),
      failureCode: safeNullableText(attempt.failure_code, 80, 'Stored payment attempt failure code'),
      intentNo,
      paymentAttemptId: safeUlid(attempt.id, 'Stored payment attempt ID'),
      providerTransactionIdMasked: maskedReference(attempt.provider_transaction_id),
      status: attempt.status,
      updatedAt: attempt.finished_at === null
        ? safeDate(attempt.initiated_at, 'Stored payment attempt creation time')
        : safeDate(attempt.finished_at, 'Stored payment attempt update time'),
    }));
  });
}

function refundAttempts(record: AdminDetailRecord): FulfillmentRefundAttemptProjection[] {
  return record.refunds.flatMap((refund) => {
    const amount = safeMoney(refund.amount, 'Stored refund amount');
    const refundNo = safeText(refund.refund_no, 32, 'Stored refund number');
    const refundId = safeUlid(refund.id, 'Stored refund ID');
    return refund.attempts.map((attempt) => ({
      amount,
      attemptNo: safeCount(attempt.attempt_no, 'Stored refund attempt number', 1),
      createdAt: safeDate(attempt.requested_at, 'Stored refund attempt creation time'),
      failureCode: safeNullableText(attempt.failure_code, 80, 'Stored refund attempt failure code'),
      originType: refund.origin_type,
      refundId,
      refundNo,
      status: attempt.status,
      updatedAt: attempt.finished_at === null
        ? safeDate(attempt.requested_at, 'Stored refund attempt creation time')
        : safeDate(attempt.finished_at, 'Stored refund attempt update time'),
    }));
  });
}

function aftersales(record: AdminDetailRecord): FulfillmentAftersaleProjection[] {
  return record.aftersales.map((aftersale) => ({
    aftersaleId: safeUlid(aftersale.id, 'Stored aftersale ID'),
    aftersaleNo: safeText(aftersale.aftersale_no, 32, 'Stored aftersale number'),
    createdAt: safeDate(aftersale.created_at, 'Stored aftersale creation time'),
    requestedAmount: aftersale.items.reduce(
      (sum, item) => sum.plus(safeMoney(item.requested_amount, 'Stored aftersale requested amount')),
      new Prisma.Decimal(0),
    ).toFixed(2),
    status: aftersale.status,
    type: aftersale.type,
    version: safeCount(aftersale.version, 'Stored aftersale version', 1),
  }));
}

function commissionImpact(record: AdminDetailRecord): FulfillmentCommissionImpactProjection[] {
  return record.items.flatMap((item) => {
    const snapshot = item.commission_snapshot;
    if (snapshot === null) return [];
    const position = snapshot.position;
    return [{
      commissionSnapshotId: safeUlid(snapshot.id, 'Stored commission snapshot ID'),
      expectedRemaining: position === null
        ? '0.00'
        : safeMoney(position.expected_remaining, 'Stored expected commission remainder'),
      latestState: position?.state ?? 'NONE',
      orderItemId: safeUlid(item.id, 'Stored commission order item ID'),
      originalCommission: safeMoney(snapshot.original_commission, 'Stored original commission'),
      reversedTotal: position === null
        ? '0.00'
        : safeMoney(position.reversed_total, 'Stored reversed commission total'),
    }];
  });
}

function inventoryImpact(records: Array<{
  ledger_type: string;
  locked_change: number;
  physical_change: number;
  sku_id: string;
}>): FulfillmentInventoryImpactProjection[] {
  const aggregate = new Map<string, FulfillmentInventoryImpactProjection>();
  for (const record of records) {
    const skuId = safeUlid(record.sku_id, 'Stored inventory ledger SKU ID');
    const lockedChange = safeCount(
      Math.abs(record.locked_change),
      'Stored inventory locked change magnitude',
    ) * Math.sign(record.locked_change);
    const physicalChange = safeCount(
      Math.abs(record.physical_change),
      'Stored inventory physical change magnitude',
    ) * Math.sign(record.physical_change);
    const current = aggregate.get(skuId) ?? {
      availableChange: 0,
      onHandChange: 0,
      reasons: [],
      reservedChange: 0,
      skuId,
    };
    current.reservedChange += lockedChange;
    current.onHandChange += physicalChange;
    current.availableChange += physicalChange - lockedChange;
    const reason = safeText(record.ledger_type, 80, 'Stored inventory ledger type');
    if (!current.reasons.includes(reason)) current.reasons.push(reason);
    aggregate.set(skuId, current);
  }
  return [...aggregate.values()].sort((left, right) => left.skuId.localeCompare(right.skuId));
}

function ownedFulfillmentProjection(record: OwnedFulfillmentRecord): OwnedFulfillmentProjection {
  const shipment = record.shipment === null ? null : shipmentProjection(record.shipment);
  const activeAftersale = hasActiveAftersale(record.aftersales);
  return {
    canConfirmReceipt: record.payment_status === 'PAID' && record.payment_resolution === 'NORMAL' &&
      record.order_status === 'SHIPPING' && !activeAftersale && shipment !== null &&
      (shipment.status === 'SHIPPED' || shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED'),
    canViewLogistics: shipment !== null,
    customerId: safeUlid(record.customer_id, 'Stored customer ID'),
    fulfillmentStatus: record.fulfillment_status,
    orderId: safeUlid(record.id, 'Stored order ID'),
    orderStatus: record.order_status,
    paymentResolution: record.payment_resolution,
    paymentStatus: record.payment_status,
    shipment,
    version: safeCount(record.version, 'Stored order version', 1),
  };
}

export class FulfillmentRepository {
  private readonly aliasHmacKey: Uint8Array | null;

  constructor(private readonly prisma: PrismaClient, aliasHmacKey?: Uint8Array) {
    if (aliasHmacKey !== undefined &&
      (!(aliasHmacKey instanceof Uint8Array) || aliasHmacKey.byteLength < 32)) {
      throw new TypeError('Fulfillment customer alias HMAC key must contain at least 32 bytes');
    }
    this.aliasHmacKey = aliasHmacKey === undefined ? null : Buffer.from(aliasHmacKey);
  }

  async listAdminOrdersInTransaction(
    transaction: DatabaseTransaction,
    input: AdminFulfillmentOrderListInput,
  ): Promise<AdminFulfillmentOrderListResult> {
    validateListInput(input);
    const where = listWhere(input);
    const total = await transaction.salesOrder.count({ where });
    const records = await transaction.salesOrder.findMany({
      include: ADMIN_LIST_INCLUDE,
      orderBy: listOrderBy(input.sort),
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
      where,
    });
    return {
      items: records.map((record) => ({
        agentId: record.final_agent === null
          ? null
          : safeUlid(record.final_agent.id, 'Stored final Agent ID'),
        agentName: record.final_agent === null
          ? null
          : safeText(record.final_agent.name, 120, 'Stored final Agent name'),
        createdAt: safeDate(record.created_at, 'Stored order creation time'),
        customerAlias: customerAlias(record, this.aliasHmacKey),
        customerId: safeUlid(record.customer_id, 'Stored customer ID'),
        fulfillmentStatus: record.fulfillment_status,
        orderId: safeUlid(record.id, 'Stored order ID'),
        orderNo: safeText(record.order_no, 32, 'Stored order number'),
        orderStatus: record.order_status,
        paidAt: safeNullableDate(record.paid_at, 'Stored order paid time'),
        payableAmount: safeMoney(record.payable_amount, 'Stored order payable amount'),
        paymentResolution: record.payment_resolution,
        paymentStatus: record.payment_status,
        recipientPhoneMasked: maskedPhone(record.address_snapshot?.phone_last4 ?? null),
        refundProcessingStatus: record.refund_processing_status,
        refundProgressStatus: record.refund_progress_status,
        version: safeCount(record.version, 'Stored order version', 1),
      })),
      total: safeCount(total, 'Stored order total'),
    };
  }

  listAdminOrders(input: AdminFulfillmentOrderListInput): Promise<AdminFulfillmentOrderListResult> {
    return this.prisma.$transaction(
      (transaction) => this.listAdminOrdersInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getAdminOrderDetailInTransaction(
    transaction: DatabaseTransaction,
    input: FulfillmentOrderReadInput,
  ): Promise<AdminFulfillmentOrderDetail> {
    validateReadInput(input);
    const record = await transaction.salesOrder.findUnique({
      include: ADMIN_DETAIL_INCLUDE,
      where: { id: input.orderId },
    });
    if (record === null) throw notFound();
    if (record.address_snapshot === null) throw internal('Stored order address snapshot is missing');
    const privacy = record.attribution_snapshot?.privacy_projection;
    const address = record.address_snapshot;
    const ledgers = record.inventory_reservation === null
      ? []
      : await transaction.inventoryLedger.findMany({
          orderBy: [{ sku_id: 'asc' }, { occurred_at: 'asc' }, { id: 'asc' }],
          select: { ledger_type: true, locked_change: true, physical_change: true, sku_id: true },
          where: { business_id: record.inventory_reservation.id },
        });
    return {
      addressMasked: {
        detailMasked: '***',
        phoneMasked: maskedPhone(address.phone_last4) ?? '***',
        recipientNameMasked: maskedName(address.recipient_name),
        regionSummary: [address.province, address.city, address.district]
          .map((value) => safeText(value, 80, 'Stored order address region'))
          .join(' '),
      },
      aftersales: aftersales(record),
      attribution: {
        agentId: record.final_agent === null
          ? null
          : safeUlid(record.final_agent.id, 'Stored final Agent ID'),
        agentName: record.final_agent === null
          ? null
          : safeText(record.final_agent.name, 120, 'Stored final Agent name'),
        frozenAt: record.attribution_snapshot === null
          ? null
          : safeDate(record.attribution_snapshot.captured_at, 'Stored attribution capture time'),
        source: record.final_channel ?? 'DIRECT',
      },
      commissionImpact: commissionImpact(record),
      customer: {
        customerAlias: customerAlias(record, this.aliasHmacKey),
        customerId: safeUlid(record.customer.id, 'Stored customer ID'),
        nicknameMasked: privacy?.nickname_masked === undefined || privacy.nickname_masked === null
          ? maskedNickname(record.customer.nickname)
          : safeText(privacy.nickname_masked, 80, 'Stored masked customer nickname'),
        phoneMasked: maskedPhone(privacy?.phone_tail ?? address.phone_last4),
      },
      eligibility: actionEligibility(record),
      inventoryImpact: inventoryImpact(ledgers),
      order: orderProjection(record),
      paymentAttempts: paymentAttempts(record),
      refundAttempts: refundAttempts(record),
      shipment: record.shipment === null ? null : shipmentProjection(record.shipment),
    };
  }

  getAdminOrderDetail(input: FulfillmentOrderReadInput): Promise<AdminFulfillmentOrderDetail> {
    return this.prisma.$transaction(
      (transaction) => this.getAdminOrderDetailInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getAdminFulfillmentAddressMaterialInTransaction(
    transaction: DatabaseTransaction,
    input: FulfillmentOrderReadInput,
  ): Promise<AdminFulfillmentAddressMaterial> {
    validateReadInput(input);
    const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.sales_order
      WHERE id = ${input.orderId}
      FOR UPDATE
    `);
    if (locked.length !== 1 || locked[0]?.id !== input.orderId) throw notFound();
    const record = await transaction.salesOrder.findUnique({
      select: {
        address_snapshot: {
          select: {
            city: true,
            created_at: true,
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
        fulfillment_status: true,
        id: true,
        order_no: true,
        order_status: true,
        payment_resolution: true,
        payment_status: true,
        shipment: { select: { status: true } },
      },
      where: { id: input.orderId },
    });
    if (record === null) throw internal('Locked order disappeared during fulfillment address read');
    const address = record.address_snapshot;
    if (address === null || !(address.phone_ciphertext instanceof Uint8Array) ||
      address.phone_ciphertext.byteLength < 1 || !(address.detail_ciphertext instanceof Uint8Array) ||
      address.detail_ciphertext.byteLength < 1 || !PHONE_LAST4.test(address.phone_last4)) {
      throw internal('Stored order address snapshot material is invalid');
    }
    return {
      city: safeText(address.city, 80, 'Stored order address city'),
      detailCiphertext: Buffer.from(address.detail_ciphertext),
      district: safeText(address.district, 80, 'Stored order address district'),
      eligibleForRead: readEligible(record),
      encryptionKeyId: safeText(address.encryption_key_id, 80, 'Stored order address key ID'),
      fulfillmentStatus: record.fulfillment_status,
      orderId: safeUlid(record.id, 'Stored order ID'),
      orderNo: safeText(record.order_no, 32, 'Stored order number'),
      orderStatus: record.order_status,
      paymentResolution: record.payment_resolution,
      paymentStatus: record.payment_status,
      phoneCiphertext: Buffer.from(address.phone_ciphertext),
      phoneLast4: address.phone_last4,
      province: safeText(address.province, 80, 'Stored order address province'),
      recipientName: safeText(address.recipient_name, 80, 'Stored order address recipient'),
      snapshotAt: safeDate(address.created_at, 'Stored order address snapshot time'),
      snapshotId: safeUlid(address.id, 'Stored order address snapshot ID'),
    };
  }

  getAdminFulfillmentAddressMaterial(
    input: FulfillmentOrderReadInput,
  ): Promise<AdminFulfillmentAddressMaterial> {
    return this.prisma.$transaction(
      (transaction) => this.getAdminFulfillmentAddressMaterialInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getOwnedFulfillmentProjectionInTransaction(
    transaction: DatabaseTransaction,
    input: OwnedFulfillmentReadInput,
  ): Promise<OwnedFulfillmentProjection> {
    validateOwnedReadInput(input);
    const record = await transaction.salesOrder.findFirst({
      select: OWNED_FULFILLMENT_SELECT,
      where: { customer_id: input.customerId, id: input.orderId },
    });
    if (record === null) throw notFound();
    return ownedFulfillmentProjection(record);
  }

  getOwnedFulfillmentProjection(input: OwnedFulfillmentReadInput): Promise<OwnedFulfillmentProjection> {
    return this.prisma.$transaction(
      (transaction) => this.getOwnedFulfillmentProjectionInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async listOwnedFulfillmentProjectionsInTransaction(
    transaction: DatabaseTransaction,
    input: OwnedFulfillmentListInput,
  ): Promise<Map<string, OwnedFulfillmentProjection>> {
    validateOwnedListInput(input);
    if (input.orderIds.length === 0) return new Map();
    const records = await transaction.salesOrder.findMany({
      orderBy: [{ id: 'asc' }],
      select: OWNED_FULFILLMENT_SELECT,
      where: { customer_id: input.customerId, id: { in: [...input.orderIds] } },
    });
    const available = new Map(records.map((record) => {
      const projection = ownedFulfillmentProjection(record);
      return [projection.orderId, projection] as const;
    }));
    return new Map(input.orderIds.flatMap((orderId) => {
      const projection = available.get(orderId);
      return projection === undefined ? [] : [[orderId, projection] as const];
    }));
  }

  listOwnedFulfillmentProjections(
    input: OwnedFulfillmentListInput,
  ): Promise<Map<string, OwnedFulfillmentProjection>> {
    return this.prisma.$transaction(
      (transaction) => this.listOwnedFulfillmentProjectionsInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
