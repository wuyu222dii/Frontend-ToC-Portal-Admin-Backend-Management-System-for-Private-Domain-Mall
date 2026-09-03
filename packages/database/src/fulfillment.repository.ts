import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';
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
  PaymentAttemptStatus,
  PaymentIntentStatus,
  PaymentResolution,
  PaymentStatus,
  RefundProcessingStatus,
  RefundProgressStatus,
  RefundStatus,
  ShipmentStatus,
} from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
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
const AFTERSALE_STATUSES = new Set<AftersaleStatus>([
  ...ACTIVE_AFTERSALE_STATUSES,
  'CANCELLED',
  'COMPLETED',
  'REJECTED',
  'REJECTED_AFTER_RETURN',
]);
const ACTIVE_REFUND_STATUSES = new Set<RefundStatus>(['FAILED', 'PENDING', 'PROCESSING']);
const REFUND_STATUSES = new Set<RefundStatus>(['CANCELLED', 'FAILED', 'PENDING', 'PROCESSING', 'SUCCEEDED']);
const PAYMENT_INTENT_STATUSES = new Set<PaymentIntentStatus>([
  'CANCELLED', 'CLOSED', 'CLOSE_PENDING', 'CREATING', 'EXPIRED', 'FAILED', 'OPEN', 'SUCCEEDED',
]);
const ACTIVE_PAYMENT_INTENT_STATUSES = new Set<PaymentIntentStatus>(['CLOSE_PENDING', 'CREATING', 'OPEN']);
const PAYMENT_ATTEMPT_STATUSES = new Set<PaymentAttemptStatus>([
  'CANCELLED', 'FAILED', 'INITIATED', 'SUCCEEDED', 'SUCCEEDED_LATE',
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

export interface FulfillmentShipmentReadInput {
  orderId?: string;
  shipmentId: string;
}

export interface OwnedFulfillmentReadInput extends FulfillmentOrderReadInput {
  customerId: string;
}

export interface OwnedFulfillmentListInput {
  customerId: string;
  orderIds: readonly string[];
}

export interface FulfillmentShipmentLineInput {
  orderItemId: string;
  quantity: number;
  shipmentItemId: string;
}

export interface CreateFulfillmentShipmentInput {
  actorAccountId: string;
  carrierCode: string;
  carrierName: string;
  expectedOrderVersion: number;
  items: readonly FulfillmentShipmentLineInput[];
  orderId: string;
  shipmentId: string;
  trackingNo: string;
}

export interface FulfillmentStatusEventInput {
  description: string;
  eventType: 'STATUS';
  location: string | null;
  occurredAt: Date;
  statusCode: 'DELIVERED' | 'IN_TRANSIT';
}

export interface FulfillmentTrackingCorrectionEventInput {
  carrierCode: string;
  carrierName: string;
  description: string;
  eventType: 'TRACKING_CORRECTION';
  location: string | null;
  occurredAt: Date;
  reason: string;
  trackingNo: string;
}

export interface AppendFulfillmentLogisticsEventInput {
  actorAccountId: string;
  event: FulfillmentStatusEventInput | FulfillmentTrackingCorrectionEventInput;
  eventId: string;
  eventKey: string;
  expectedShipmentVersion: number;
  shipmentId: string;
}

export type CompletionActorInput =
  | { actorAccountId: string; kind: 'ADMIN' }
  | { accountId: string; customerId: string; kind: 'CUSTOMER' };

export interface CompleteFulfillmentOrderInput {
  actor: CompletionActorInput;
  completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED';
  expectedOrderVersion: number;
  orderId: string;
}

export interface CompletedOrderReplayInput {
  actor: CompletionActorInput;
  completionReason: 'ADMIN_FORCED' | 'CUSTOMER_CONFIRMED';
  orderId: string;
}

export interface FulfillmentCompletionState {
  fulfillmentStatus: FulfillmentStatus;
  orderStatus: OrderStatus;
  orderVersion: number;
  shipmentStatus: ShipmentStatus;
  shipmentVersion: number;
}

export interface FulfillmentCommissionCredit {
  ledgerId: string;
  version: number;
}

export interface CompleteFulfillmentOrderResult {
  after: FulfillmentCompletionState;
  aftersaleExpiresAt: Date;
  before: FulfillmentCompletionState;
  businessRuleVersionId: string;
  commissionCredits: FulfillmentCommissionCredit[];
  completedAt: Date;
  orderId: string;
  shipmentId: string;
}

export interface CompletedOrderReplayResult {
  aftersaleExpiresAt: Date;
  businessRuleVersionId: string;
  completedAt: Date;
  completionReason: OrderCompletionReason;
  orderId: string;
  orderVersion: number;
  shipmentId: string;
  shipmentStatus: ShipmentStatus;
  shipmentVersion: number;
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

export interface CreateFulfillmentShipmentResult {
  kind: 'created' | 'winner';
  orderVersion: number;
  shipment: FulfillmentShipmentProjection;
}

export interface AppendFulfillmentLogisticsEventResult {
  event: FulfillmentLogisticsEventProjection;
  kind: 'applied' | 'winner';
  shipment: FulfillmentShipmentProjection;
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
      status: true,
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
  payment_intents: {
    orderBy: [{ id: 'asc' }] satisfies Prisma.PaymentIntentOrderByWithRelationInput[],
    select: {
      attempts: {
        orderBy: [{ id: 'asc' }] satisfies Prisma.PaymentAttemptOrderByWithRelationInput[],
        select: { status: true },
      },
      id: true,
      status: true,
    },
  },
  refund_processing_status: true,
  refunds: {
    orderBy: [{ id: 'asc' }] satisfies Prisma.RefundOrderByWithRelationInput[],
    select: { id: true, status: true },
  },
  shipment: { include: SHIPMENT_INCLUDE },
  version: true,
} satisfies Prisma.SalesOrderSelect;

const SHIPMENT_COMMAND_ORDER_SELECT = {
  fulfillment_status: true,
  id: true,
  order_status: true,
  payment_resolution: true,
  payment_status: true,
  version: true,
} satisfies Prisma.SalesOrderSelect;

const LOGISTICS_COMMAND_ORDER_SELECT = {
  fulfillment_status: true,
  id: true,
  order_status: true,
  payment_resolution: true,
  payment_status: true,
  version: true,
} satisfies Prisma.SalesOrderSelect;

const COMPLETION_ORDER_SELECT = {
  aftersale_expires_at: true,
  business_rule_version_id: true,
  close_reason: true,
  closed_at: true,
  completed_at: true,
  completion_reason: true,
  customer_id: true,
  final_agent_id: true,
  final_channel: true,
  fulfillment_status: true,
  id: true,
  order_status: true,
  payment_resolution: true,
  payment_status: true,
  refund_processing_status: true,
  version: true,
} satisfies Prisma.SalesOrderSelect;

const COMPLETION_COMMISSION_INCLUDE = {
  order_item: { select: { id: true, order_id: true } },
  position: true,
} satisfies Prisma.OrderItemCommissionSnapshotInclude;

type AdminListRecord = Prisma.SalesOrderGetPayload<{ include: typeof ADMIN_LIST_INCLUDE }>;
type AdminDetailRecord = Prisma.SalesOrderGetPayload<{ include: typeof ADMIN_DETAIL_INCLUDE }>;
type FulfillmentItemRecord = Prisma.OrderItemGetPayload<{ select: typeof ORDER_ITEM_SELECT }>;
type ShipmentRecord = Prisma.ShipmentGetPayload<{ include: typeof SHIPMENT_INCLUDE }>;
type OwnedFulfillmentRecord = Prisma.SalesOrderGetPayload<{ select: typeof OWNED_FULFILLMENT_SELECT }>;
type ShipmentCommandOrderRecord = Prisma.SalesOrderGetPayload<{ select: typeof SHIPMENT_COMMAND_ORDER_SELECT }>;
type LogisticsCommandOrderRecord = Prisma.SalesOrderGetPayload<{ select: typeof LOGISTICS_COMMAND_ORDER_SELECT }>;
type CompletionOrderRecord = Prisma.SalesOrderGetPayload<{ select: typeof COMPLETION_ORDER_SELECT }>;

interface LockedOrderItemRow {
  id: string;
  pre_shipment_refunded_qty: number;
  quantity: number;
  shipped_qty: number;
  version: number;
}

interface LockedAftersaleRow {
  id: string;
  status: string;
}

interface LockedAdminActorRow {
  deleted_at: Date | null;
  has_password: boolean;
  id: string;
  role: string;
  status: string;
}

interface LockedBusinessRuleRow {
  aftersale_window_days: number;
  effective_at: Date | null;
  id: string;
}

interface LockedRefundRow {
  id: string;
  status: RefundStatus;
}

interface LockedPaymentIntentRow {
  id: string;
  status: PaymentIntentStatus;
  succeeded_at: Date | null;
}

interface LockedPaymentAttemptRow {
  id: string;
  payment_intent_id: string;
  status: PaymentAttemptStatus;
}

interface LockedWalletRow {
  agent_id: string;
  available_balance: Prisma.Decimal;
  frozen_balance: Prisma.Decimal;
  id: string;
  version: number;
}

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Order not found');
}

function shipmentNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Shipment not found');
}

function shipmentStateConflict(message = 'Shipment state conflicts with this request'): ApplicationError {
  return new ApplicationError('SHIPMENT_STATE_CONFLICT', message);
}

function orderVersionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Order version changed');
}

function shipmentVersionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Shipment version changed');
}

function shipmentItemsMismatch(): ApplicationError {
  return new ApplicationError(
    'SHIPMENT_ITEMS_MISMATCH',
    'Shipment items do not match the complete remaining fulfillment set',
  );
}

function activeAftersaleBlocksShipment(): ApplicationError {
  return new ApplicationError('ACTIVE_AFTERSALE_BLOCKS_SHIPMENT', 'Active aftersale activity blocks shipment');
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active administrator account is required');
}

function completionAuthenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active completion actor is required');
}

function orderNotReceivable(message = 'The order cannot be confirmed as received'): ApplicationError {
  return new ApplicationError('ORDER_NOT_RECEIVABLE', message);
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

function requirePositiveVersion(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) >= MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} must be a positive supported version`);
  }
}

function requireRequestText(value: unknown, minimum: number, maximum: number, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new TypeError(`${label} must be trimmed text`);
  }
  const characters = Array.from(value);
  if (characters.length < minimum || characters.length > maximum || characters.some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint === undefined || codePoint <= 0x1f || codePoint === 0x7f;
  })) {
    throw new TypeError(`${label} has an invalid length or control character`);
  }
}

function requireDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${label} must be a valid Date`);
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

function validateShipmentReadInput(input: FulfillmentShipmentReadInput): void {
  requireExactKeys(input, ['orderId', 'shipmentId'], ['shipmentId'], 'Fulfillment shipment read input');
  requireUlid(input.shipmentId, 'Fulfillment shipment ID');
  if (input.orderId !== undefined) requireUlid(input.orderId, 'Fulfillment shipment order ID');
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

function validateCreateShipmentInput(input: CreateFulfillmentShipmentInput): void {
  requireExactKeys(
    input,
    [
      'actorAccountId', 'carrierCode', 'carrierName', 'expectedOrderVersion', 'items', 'orderId',
      'shipmentId', 'trackingNo',
    ],
    [
      'actorAccountId', 'carrierCode', 'carrierName', 'expectedOrderVersion', 'items', 'orderId',
      'shipmentId', 'trackingNo',
    ],
    'Create fulfillment shipment input',
  );
  requireUlid(input.actorAccountId, 'Shipment actor Account ID');
  requireUlid(input.orderId, 'Shipment order ID');
  requireUlid(input.shipmentId, 'Shipment ID');
  requirePositiveVersion(input.expectedOrderVersion, 'Expected order version');
  requireRequestText(input.carrierCode, 1, 40, 'Shipment carrier code');
  requireRequestText(input.carrierName, 1, 80, 'Shipment carrier name');
  requireRequestText(input.trackingNo, 1, 120, 'Shipment tracking number');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
    throw new TypeError('Shipment items must contain 1 to 100 entries');
  }
  const shipmentItemIds = new Set<string>();
  for (const item of input.items) {
    requireExactKeys(
      item,
      ['orderItemId', 'quantity', 'shipmentItemId'],
      ['orderItemId', 'quantity', 'shipmentItemId'],
      'Shipment item input',
    );
    requireUlid(item.orderItemId, 'Shipment order item ID');
    requireUlid(item.shipmentItemId, 'Shipment item ID');
    const quantity = item.quantity;
    if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) ||
      quantity < 1 || quantity > MAX_POSTGRES_INTEGER) {
      throw new TypeError('Shipment item quantity must be a positive supported integer');
    }
    if (shipmentItemIds.has(item.shipmentItemId)) throw new TypeError('Shipment item IDs must be unique');
    shipmentItemIds.add(item.shipmentItemId);
  }
}

function validateLogisticsEventInput(input: AppendFulfillmentLogisticsEventInput): void {
  requireExactKeys(
    input,
    ['actorAccountId', 'event', 'eventId', 'eventKey', 'expectedShipmentVersion', 'shipmentId'],
    ['actorAccountId', 'event', 'eventId', 'eventKey', 'expectedShipmentVersion', 'shipmentId'],
    'Append fulfillment logistics event input',
  );
  requireUlid(input.actorAccountId, 'Logistics actor Account ID');
  requireUlid(input.eventId, 'Logistics event ID');
  requireUlid(input.shipmentId, 'Logistics shipment ID');
  requirePositiveVersion(input.expectedShipmentVersion, 'Expected shipment version');
  requireRequestText(input.eventKey, 1, 80, 'Logistics event key');
  if (!plainObject(input.event) ||
    (input.event.eventType !== 'STATUS' && input.event.eventType !== 'TRACKING_CORRECTION')) {
    throw new TypeError('Logistics event must use a closed event type');
  }
  if (input.event.eventType === 'STATUS') {
    requireExactKeys(
      input.event,
      ['description', 'eventType', 'location', 'occurredAt', 'statusCode'],
      ['description', 'eventType', 'location', 'occurredAt', 'statusCode'],
      'Logistics status event',
    );
    if (input.event.statusCode !== 'IN_TRANSIT' && input.event.statusCode !== 'DELIVERED') {
      throw new TypeError('Logistics status event target is invalid');
    }
  } else {
    requireExactKeys(
      input.event,
      [
        'carrierCode', 'carrierName', 'description', 'eventType', 'location', 'occurredAt', 'reason',
        'trackingNo',
      ],
      [
        'carrierCode', 'carrierName', 'description', 'eventType', 'location', 'occurredAt', 'reason',
        'trackingNo',
      ],
      'Logistics tracking correction event',
    );
    requireRequestText(input.event.carrierCode, 1, 40, 'Corrected carrier code');
    requireRequestText(input.event.carrierName, 1, 80, 'Corrected carrier name');
    requireRequestText(input.event.trackingNo, 1, 120, 'Corrected tracking number');
    requireRequestText(input.event.reason, 2, 500, 'Tracking correction reason');
  }
  requireRequestText(input.event.description, 1, 300, 'Logistics event description');
  if (input.event.location !== null) {
    requireRequestText(input.event.location, 1, 160, 'Logistics event location');
  }
  requireDate(input.event.occurredAt, 'Logistics event occurrence time');
}

function validateCompletionActor(actor: CompletionActorInput): void {
  if (!plainObject(actor) || (actor.kind !== 'ADMIN' && actor.kind !== 'CUSTOMER')) {
    throw new TypeError('Completion actor must use a closed actor kind');
  }
  if (actor.kind === 'ADMIN') {
    requireExactKeys(actor, ['actorAccountId', 'kind'], ['actorAccountId', 'kind'], 'Admin completion actor');
    requireUlid(actor.actorAccountId, 'Completion actor Account ID');
    return;
  }
  requireExactKeys(
    actor,
    ['accountId', 'customerId', 'kind'],
    ['accountId', 'customerId', 'kind'],
    'Customer completion actor',
  );
  requireUlid(actor.accountId, 'Completion customer Account ID');
  requireUlid(actor.customerId, 'Completion Customer ID');
}

function validateCompletionReason(
  actor: CompletionActorInput,
  completionReason: CompleteFulfillmentOrderInput['completionReason'],
): void {
  const expected = actor.kind === 'ADMIN' ? 'ADMIN_FORCED' : 'CUSTOMER_CONFIRMED';
  if (completionReason !== expected) {
    throw new TypeError('Completion reason does not match the closed actor kind');
  }
}

function validateCompleteOrderInput(input: CompleteFulfillmentOrderInput): void {
  requireExactKeys(
    input,
    ['actor', 'completionReason', 'expectedOrderVersion', 'orderId'],
    ['actor', 'completionReason', 'expectedOrderVersion', 'orderId'],
    'Complete fulfillment order input',
  );
  validateCompletionActor(input.actor);
  validateCompletionReason(input.actor, input.completionReason);
  requirePositiveVersion(input.expectedOrderVersion, 'Expected completion order version');
  requireUlid(input.orderId, 'Completion order ID');
}

function validateCompletedOrderReplayInput(input: CompletedOrderReplayInput): void {
  requireExactKeys(
    input,
    ['actor', 'completionReason', 'orderId'],
    ['actor', 'completionReason', 'orderId'],
    'Completed order replay input',
  );
  validateCompletionActor(input.actor);
  validateCompletionReason(input.actor, input.completionReason);
  requireUlid(input.orderId, 'Completed replay order ID');
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

function hasResolvedSuccessfulPayment(records: readonly {
  attempts: readonly { status: PaymentAttemptStatus }[];
  status: PaymentIntentStatus;
}[]): boolean {
  if (records.some(({ status }) => ACTIVE_PAYMENT_INTENT_STATUSES.has(status))) return false;
  const succeeded = records.filter(({ status }) => status === 'SUCCEEDED');
  if (succeeded.length !== 1) return false;
  let successfulAttempts = 0;
  for (const intent of records) {
    for (const attempt of intent.attempts) {
      if (attempt.status === 'INITIATED' || attempt.status === 'SUCCEEDED_LATE') return false;
      if (attempt.status === 'SUCCEEDED') {
        if (intent.status !== 'SUCCEEDED') return false;
        successfulAttempts += 1;
      }
    }
  }
  return successfulAttempts === 1 && succeeded[0]?.attempts.filter(({ status }) => status === 'SUCCEEDED').length === 1;
}

function hasActiveRefund(records: readonly { status: RefundStatus }[]): boolean {
  return records.some(({ status }) => ACTIVE_REFUND_STATUSES.has(status));
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
  const hasUnresolvedPayment = record.payment_resolution !== 'NORMAL' ||
    !hasResolvedSuccessfulPayment(record.payment_intents) || record.refund_processing_status !== 'IDLE' ||
    hasActiveRefund(record.refunds);
  const shipment = record.shipment;
  const canComplete = record.payment_status === 'PAID' && !hasUnresolvedPayment &&
    record.order_status === 'SHIPPING' && activeAftersaleCount === 0 && shipment !== null &&
    record.fulfillment_status === shipment.status &&
    (shipment.status === 'SHIPPED' || shipment.status === 'IN_TRANSIT' || shipment.status === 'DELIVERED');
  return {
    activeAftersaleCount,
    canAddLogisticsEvent: record.payment_status === 'PAID' && !hasUnresolvedPayment &&
      record.order_status === 'SHIPPING' && shipment !== null &&
      record.fulfillment_status === shipment.status,
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
  const unresolvedPayment = record.payment_resolution !== 'NORMAL' ||
    !hasResolvedSuccessfulPayment(record.payment_intents) || record.refund_processing_status !== 'IDLE' ||
    hasActiveRefund(record.refunds);
  return {
    canConfirmReceipt: record.payment_status === 'PAID' && !unresolvedPayment &&
      record.order_status === 'SHIPPING' && !activeAftersale && shipment !== null &&
      record.fulfillment_status === shipment.status &&
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

function validateShipmentCommandOrder(record: ShipmentCommandOrderRecord): number {
  safeUlid(record.id, 'Stored shipment command order ID');
  const version = safeCount(record.version, 'Stored shipment command order version', 1);
  if (record.payment_status !== 'PAID' || record.payment_resolution !== 'NORMAL' ||
    record.order_status !== 'PENDING_SHIPMENT' || record.fulfillment_status !== 'READY_TO_SHIP') {
    throw shipmentStateConflict('Order is not in the exact state required for shipment');
  }
  return version;
}

function validateLogisticsCommandOrder(record: LogisticsCommandOrderRecord, shipment: ShipmentRecord): number {
  safeUlid(record.id, 'Stored logistics command order ID');
  const version = safeCount(record.version, 'Stored logistics command order version', 1);
  if (record.payment_status !== 'PAID' || record.payment_resolution !== 'NORMAL' ||
    record.order_status !== 'SHIPPING' || record.fulfillment_status !== shipment.status) {
    throw shipmentStateConflict('Order and shipment are not in a consistent shipping state');
  }
  return version;
}

function exactShipmentItems(
  shipment: FulfillmentShipmentProjection,
  items: readonly FulfillmentShipmentLineInput[],
): boolean {
  if (shipment.items.length !== items.length) return false;
  const expected = [...items].sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
  return shipment.items.every((item, index) => {
    const candidate = expected[index];
    return candidate !== undefined && item.orderItemId === candidate.orderItemId &&
      item.quantity === candidate.quantity && item.shipmentItemId === candidate.shipmentItemId;
  });
}

function isCreateShipmentWinner(
  shipment: FulfillmentShipmentProjection,
  input: CreateFulfillmentShipmentInput,
  orderVersion: number,
): boolean {
  return shipment.shipmentId === input.shipmentId && shipment.orderId === input.orderId &&
    shipment.status === 'SHIPPED' && shipment.version === 1 && shipment.deliveredAt === null &&
    shipment.events.length === 0 && shipment.carrierCode === input.carrierCode &&
    shipment.carrierName === input.carrierName && shipment.trackingNo === input.trackingNo &&
    orderVersion === input.expectedOrderVersion + 1 && exactShipmentItems(shipment, input.items);
}

function logisticsEventMatchesInput(
  event: FulfillmentLogisticsEventProjection,
  input: AppendFulfillmentLogisticsEventInput,
): boolean {
  if (event.eventId !== input.eventId || event.eventKey !== input.eventKey ||
    event.actorAccountId !== input.actorAccountId || event.source !== 'MANUAL' ||
    event.description !== input.event.description || event.location !== input.event.location ||
    event.occurredAt.getTime() !== input.event.occurredAt.getTime()) return false;
  if (input.event.eventType === 'STATUS') {
    return event.eventType === 'STATUS' && event.statusCode === input.event.statusCode &&
      event.carrierCode === null && event.carrierName === null && event.trackingNo === null && event.reason === null;
  }
  return event.eventType === 'TRACKING_CORRECTION' && event.statusCode === null &&
    event.carrierCode === input.event.carrierCode && event.carrierName === input.event.carrierName &&
    event.trackingNo === input.event.trackingNo && event.reason === input.event.reason;
}

function assertStatusTransition(current: ShipmentStatus, next: 'DELIVERED' | 'IN_TRANSIT'): void {
  const valid = (current === 'SHIPPED' && next === 'IN_TRANSIT') ||
    (current === 'IN_TRANSIT' && next === 'DELIVERED');
  if (!valid) throw shipmentStateConflict('Logistics status must advance exactly one state');
}

export class FulfillmentRepository {
  private readonly aliasHmacKey: Uint8Array | null;

  constructor(
    private readonly prisma: PrismaClient,
    aliasHmacKey?: Uint8Array,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (aliasHmacKey !== undefined &&
      (!(aliasHmacKey instanceof Uint8Array) || aliasHmacKey.byteLength < 32)) {
      throw new TypeError('Fulfillment customer alias HMAC key must contain at least 32 bytes');
    }
    this.aliasHmacKey = aliasHmacKey === undefined ? null : Buffer.from(aliasHmacKey);
    this.currentTime();
  }

  private currentTime(): Date {
    const current = this.now();
    if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
      throw new TypeError('Fulfillment clock must return a valid Date');
    }
    return new Date(current);
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const value = rows[0]?.transaction_time;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw internal('Database transaction clock is unavailable');
    }
    return new Date(value);
  }

  private async lockActor(transaction: DatabaseTransaction, actorAccountId: string): Promise<void> {
    const rows = await transaction.$queryRaw<LockedAdminActorRow[]>(Prisma.sql`
      SELECT id, role, status, deleted_at, password_hash IS NOT NULL AS has_password
      FROM public.account
      WHERE id = ${actorAccountId}
      FOR UPDATE
    `);
    const actor = rows[0];
    if (rows.length !== 1 || actor?.id !== actorAccountId || actor.role !== 'SUPER_ADMIN' ||
      actor.status !== 'ACTIVE' || actor.deleted_at !== null || actor.has_password !== true) {
      throw authenticationRequired();
    }
  }

  private async lockCompletionActor(
    transaction: DatabaseTransaction,
    actor: CompletionActorInput,
  ): Promise<void> {
    if (actor.kind === 'ADMIN') {
      await this.lockActor(transaction, actor.actorAccountId);
      return;
    }
    await acquireTransactionLock(transaction, 'store-auth-account', [actor.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [actor.customerId]);
    const account = await transaction.account.findUnique({
      select: {
        customer_profile: { select: { account_id: true, anonymized_at: true, id: true } },
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
      },
      where: { id: actor.accountId },
    });
    const customer = account?.customer_profile;
    if (!account || account.role !== 'CUSTOMER' || account.status !== 'ACTIVE' ||
      account.deleted_at !== null || account.login_name !== null || account.password_hash !== null ||
      account.wechat_open_id === null || !customer || customer.id !== actor.customerId ||
      customer.account_id !== actor.accountId || customer.anonymized_at !== null) {
      throw completionAuthenticationRequired();
    }
  }

  private async lockCompletionOrder(
    transaction: DatabaseTransaction,
    actor: CompletionActorInput,
    orderId: string,
  ): Promise<CompletionOrderRecord> {
    const locked = actor.kind === 'CUSTOMER'
      ? await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM public.sales_order
          WHERE id = ${orderId} AND customer_id = ${actor.customerId}
          FOR UPDATE
        `)
      : await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT id
          FROM public.sales_order
          WHERE id = ${orderId}
          FOR UPDATE
        `);
    if (locked.length !== 1 || locked[0]?.id !== orderId) throw notFound();
    const order = await transaction.salesOrder.findUnique({
      select: COMPLETION_ORDER_SELECT,
      where: { id: orderId },
    });
    if (order === null || order.id !== orderId ||
      (actor.kind === 'CUSTOMER' && order.customer_id !== actor.customerId)) {
      throw notFound();
    }
    return order;
  }

  private async lockCompletionWallets(
    transaction: DatabaseTransaction,
    agentIds: readonly string[],
  ): Promise<Map<string, LockedWalletRow>> {
    const orderedAgentIds = [...new Set(agentIds)].sort();
    for (const agentId of orderedAgentIds) {
      await acquireTransactionLock(transaction, 'agent-wallet', [agentId]);
    }
    if (orderedAgentIds.length === 0) return new Map();
    const wallets = await transaction.$queryRaw<LockedWalletRow[]>(Prisma.sql`
      SELECT id, agent_id, available_balance, frozen_balance, version
      FROM public.agent_wallet
      WHERE agent_id IN (${Prisma.join(orderedAgentIds)})
      ORDER BY agent_id ASC
      FOR UPDATE
    `);
    if (wallets.length !== orderedAgentIds.length) {
      throw internal('A frozen commission Agent wallet is missing');
    }
    const mapped = new Map<string, LockedWalletRow>();
    for (const wallet of wallets) {
      const agentId = safeUlid(wallet.agent_id, 'Stored commission wallet Agent ID');
      safeUlid(wallet.id, 'Stored commission wallet ID');
      const version = safeCount(wallet.version, 'Stored commission wallet version', 1);
      if (!Prisma.Decimal.isDecimal(wallet.available_balance) || wallet.available_balance.decimalPlaces() > 2 ||
        wallet.available_balance.abs().greaterThan('9999999999999999.99') ||
        !Prisma.Decimal.isDecimal(wallet.frozen_balance) || wallet.frozen_balance.isNegative() ||
        wallet.frozen_balance.decimalPlaces() > 2 ||
        wallet.frozen_balance.greaterThan('9999999999999999.99') || mapped.has(agentId)) {
        throw internal('Stored commission wallet facts are invalid');
      }
      mapped.set(agentId, { ...wallet, version });
    }
    if (orderedAgentIds.some((agentId) => !mapped.has(agentId))) {
      throw internal('A frozen commission Agent wallet is missing');
    }
    return mapped;
  }

  private async readShipmentInTransaction(
    transaction: DatabaseTransaction,
    shipmentId: string,
  ): Promise<ShipmentRecord> {
    const shipment = await transaction.shipment.findUnique({
      include: SHIPMENT_INCLUDE,
      where: { id: shipmentId },
    });
    if (shipment === null) throw shipmentNotFound();
    return shipment;
  }

  async getCompletedOrderForReplayInTransaction(
    transaction: DatabaseTransaction,
    input: CompletedOrderReplayInput,
  ): Promise<CompletedOrderReplayResult> {
    validateCompletedOrderReplayInput(input);
    await this.lockCompletionActor(transaction, input.actor);
    const order = await this.lockCompletionOrder(transaction, input.actor, input.orderId);
    const lockedShipment = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.shipment
      WHERE order_id = ${input.orderId}
      FOR UPDATE
    `);
    const shipmentId = lockedShipment[0]?.id;
    if (lockedShipment.length !== 1 || shipmentId === undefined) {
      throw internal('Completed order shipment facts are missing');
    }
    const shipment = await transaction.shipment.findUnique({
      select: { delivered_at: true, id: true, status: true, version: true },
      where: { id: shipmentId },
    });
    const replayCompletionReason = order.completion_reason;
    const compatibleCompletionReason = replayCompletionReason === input.completionReason ||
      replayCompletionReason === 'FULL_REFUND_AFTER_SHIPMENT';
    if (shipment === null || shipment.status !== 'DELIVERED' || shipment.delivered_at === null ||
      order.order_status !== 'COMPLETED' || order.fulfillment_status !== 'DELIVERED' ||
      replayCompletionReason === null || !compatibleCompletionReason || order.completed_at === null ||
      order.aftersale_expires_at === null || order.business_rule_version_id === null ||
      order.close_reason !== null || order.closed_at !== null) {
      throw internal('HASH_ONLY completion replay facts are inconsistent');
    }
    return {
      aftersaleExpiresAt: safeDate(order.aftersale_expires_at, 'Stored replay aftersale expiry'),
      businessRuleVersionId: safeUlid(order.business_rule_version_id, 'Stored replay business rule ID'),
      completedAt: safeDate(order.completed_at, 'Stored replay completion time'),
      completionReason: replayCompletionReason,
      orderId: safeUlid(order.id, 'Stored replay order ID'),
      orderVersion: safeCount(order.version, 'Stored replay order version', 1),
      shipmentId: safeUlid(shipment.id, 'Stored replay shipment ID'),
      shipmentStatus: shipment.status,
      shipmentVersion: safeCount(shipment.version, 'Stored replay shipment version', 1),
    };
  }

  async completeOrderInTransaction(
    transaction: DatabaseTransaction,
    input: CompleteFulfillmentOrderInput,
  ): Promise<CompleteFulfillmentOrderResult> {
    validateCompleteOrderInput(input);
    await this.lockCompletionActor(transaction, input.actor);
    const order = await this.lockCompletionOrder(transaction, input.actor, input.orderId);
    const orderVersion = safeCount(order.version, 'Stored completion order version', 1);
    if (order.payment_status !== 'PAID' || order.payment_resolution !== 'NORMAL' ||
      order.refund_processing_status !== 'IDLE' || order.order_status !== 'SHIPPING' ||
      order.close_reason !== null || order.closed_at !== null || order.completion_reason !== null ||
      order.completed_at !== null || order.aftersale_expires_at !== null ||
      order.business_rule_version_id !== null) {
      throw orderNotReceivable();
    }
    if (orderVersion !== input.expectedOrderVersion) throw orderVersionConflict();

    const orderItems = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.order_item
      WHERE order_id = ${input.orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    if (orderItems.length === 0 || new Set(orderItems.map(({ id }) => id)).size !== orderItems.length ||
      orderItems.some(({ id }) => !isValidUlid(id))) {
      throw internal('Completion order item facts are invalid');
    }

    const paymentIntents = await transaction.$queryRaw<LockedPaymentIntentRow[]>(Prisma.sql`
      SELECT id, status, succeeded_at
      FROM public.payment_intent
      WHERE order_id = ${input.orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    let succeededPaymentIntents = 0;
    let succeededPaymentIntentId: string | null = null;
    const paymentIntentIds = new Set<string>();
    for (const intent of paymentIntents) {
      const intentId = safeUlid(intent.id, 'Stored completion payment intent ID');
      if (paymentIntentIds.has(intentId)) throw internal('Stored completion payment intent IDs are duplicated');
      paymentIntentIds.add(intentId);
      if (!PAYMENT_INTENT_STATUSES.has(intent.status)) {
        throw internal('Stored completion payment intent status is invalid');
      }
      if (intent.status === 'SUCCEEDED') {
        succeededPaymentIntents += 1;
        succeededPaymentIntentId = intentId;
        if (intent.succeeded_at === null) throw internal('Successful payment intent is missing its completion time');
        safeDate(intent.succeeded_at, 'Stored successful payment intent time');
      } else if (intent.succeeded_at !== null) {
        throw internal('Non-successful payment intent contains a success time');
      }
    }
    if (paymentIntents.some(({ status }) => ACTIVE_PAYMENT_INTENT_STATUSES.has(status))) {
      throw orderNotReceivable();
    }
    if (succeededPaymentIntents !== 1) {
      throw internal('Paid completion order must have exactly one successful payment intent');
    }
    const paymentAttempts = await transaction.$queryRaw<LockedPaymentAttemptRow[]>(Prisma.sql`
      SELECT attempt.id, attempt.payment_intent_id, attempt.status
      FROM public.payment_attempt AS attempt
      INNER JOIN public.payment_intent AS intent ON intent.id = attempt.payment_intent_id
      WHERE intent.order_id = ${input.orderId}
      ORDER BY attempt.id ASC
      FOR UPDATE OF attempt
    `);
    let successfulPaymentAttempts = 0;
    for (const attempt of paymentAttempts) {
      safeUlid(attempt.id, 'Stored completion payment attempt ID');
      const intentId = safeUlid(attempt.payment_intent_id, 'Stored completion attempt intent ID');
      if (!paymentIntentIds.has(intentId) || !PAYMENT_ATTEMPT_STATUSES.has(attempt.status)) {
        throw internal('Stored completion payment attempt facts are invalid');
      }
      if (attempt.status === 'INITIATED' || attempt.status === 'SUCCEEDED_LATE') throw orderNotReceivable();
      if (attempt.status === 'SUCCEEDED') {
        successfulPaymentAttempts += 1;
        if (intentId !== succeededPaymentIntentId) {
          throw internal('Successful payment attempt belongs to a non-successful intent');
        }
      }
    }
    if (successfulPaymentAttempts !== 1) {
      throw internal('Paid completion order must have exactly one successful payment attempt');
    }

    const aftersales = await transaction.$queryRaw<LockedAftersaleRow[]>(Prisma.sql`
      SELECT id, status
      FROM public.aftersale
      WHERE order_id = ${input.orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    for (const aftersale of aftersales) {
      safeUlid(aftersale.id, 'Stored completion aftersale ID');
      if (!AFTERSALE_STATUSES.has(aftersale.status as AftersaleStatus)) {
        throw internal('Stored completion aftersale status is invalid');
      }
    }
    if (aftersales.some(({ status }) => ACTIVE_AFTERSALE_STATUSES.has(status as AftersaleStatus))) {
      throw orderNotReceivable();
    }

    const refunds = await transaction.$queryRaw<LockedRefundRow[]>(Prisma.sql`
      SELECT id, status
      FROM public.refund
      WHERE order_id = ${input.orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    for (const refund of refunds) {
      safeUlid(refund.id, 'Stored completion refund ID');
      if (!REFUND_STATUSES.has(refund.status)) throw internal('Stored completion refund status is invalid');
    }
    if (refunds.some(({ status }) => ACTIVE_REFUND_STATUSES.has(status))) throw orderNotReceivable();

    const lockedShipments = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.shipment
      WHERE order_id = ${input.orderId}
      FOR UPDATE
    `);
    const shipmentId = lockedShipments[0]?.id;
    if (lockedShipments.length !== 1 || shipmentId === undefined || !isValidUlid(shipmentId)) {
      throw orderNotReceivable();
    }
    const shipment = await transaction.shipment.findUnique({
      select: { delivered_at: true, id: true, shipped_at: true, status: true, version: true },
      where: { id: shipmentId },
    });
    if (shipment === null || shipment.id !== shipmentId ||
      (shipment.status !== 'SHIPPED' && shipment.status !== 'IN_TRANSIT' && shipment.status !== 'DELIVERED') ||
      order.fulfillment_status !== shipment.status) {
      throw orderNotReceivable();
    }
    const shipmentVersion = safeCount(shipment.version, 'Stored completion shipment version', 1);
    const shippedAt = safeDate(shipment.shipped_at, 'Stored completion shipment dispatch time');
    if ((shipment.status === 'DELIVERED') !== (shipment.delivered_at !== null)) {
      throw internal('Stored completion shipment delivery facts are inconsistent');
    }

    const serverTime = await this.transactionTime(transaction);
    if (serverTime.getTime() < shippedAt.getTime()) {
      throw internal('Database completion time precedes shipment dispatch');
    }
    const rules = await transaction.$queryRaw<LockedBusinessRuleRow[]>(Prisma.sql`
      SELECT id, aftersale_window_days, effective_at
      FROM public.business_rule_version
      WHERE status = 'PUBLISHED'
      ORDER BY id ASC
      FOR UPDATE
    `);
    const rule = rules[0];
    if (rules.length !== 1 || rule === undefined || !isValidUlid(rule.id) ||
      !Number.isSafeInteger(rule.aftersale_window_days) || rule.aftersale_window_days < 1 ||
      rule.aftersale_window_days > 365 || rule.effective_at === null ||
      safeDate(rule.effective_at, 'Stored completion business rule effective time').getTime() > serverTime.getTime()) {
      throw internal('A unique effective PUBLISHED business rule is required for completion');
    }
    const aftersaleExpiresAt = new Date(
      serverTime.getTime() + rule.aftersale_window_days * 24 * 60 * 60 * 1_000,
    );
    if (!Number.isFinite(aftersaleExpiresAt.getTime())) throw internal('Completion aftersale expiry is invalid');

    const lockedPositions = await transaction.$queryRaw<Array<{ id: string; snapshot_id: string }>>(Prisma.sql`
      SELECT position.id, position.snapshot_id
      FROM public.order_item_commission_position AS position
      INNER JOIN public.order_item_commission_snapshot AS snapshot ON snapshot.id = position.snapshot_id
      INNER JOIN public.order_item AS item ON item.id = snapshot.order_item_id
      WHERE item.order_id = ${input.orderId}
      ORDER BY snapshot.id ASC, position.id ASC
      FOR UPDATE OF position
    `);
    if (lockedPositions.some(({ id, snapshot_id: snapshotId }) =>
      !isValidUlid(id) || !isValidUlid(snapshotId))) {
      throw internal('Stored completion commission position IDs are invalid');
    }
    const commissions = await transaction.orderItemCommissionSnapshot.findMany({
      include: COMPLETION_COMMISSION_INCLUDE,
      orderBy: [{ id: 'asc' }],
      where: { order_item: { order_id: input.orderId } },
    });
    const lockedPositionIds = new Set(lockedPositions.map(({ id }) => id));
    if (order.final_channel === 'DIRECT') {
      if (order.final_agent_id !== null || commissions.length !== 0 || lockedPositions.length !== 0) {
        throw internal('Stored DIRECT completion commission facts are inconsistent');
      }
    } else if (order.final_channel === 'AGENT') {
      if (order.final_agent_id === null || !isValidUlid(order.final_agent_id) ||
        commissions.length !== orderItems.length || lockedPositions.length !== commissions.length) {
        throw internal('Stored AGENT completion commission facts are incomplete');
      }
    } else {
      throw internal('Stored completion attribution is missing');
    }

    const expectedCommissions: Array<{
      agentId: string;
      amount: Prisma.Decimal;
      positionId: string;
      positionVersion: number;
      snapshotId: string;
    }> = [];
    for (const commission of commissions) {
      const snapshotId = safeUlid(commission.id, 'Stored completion commission snapshot ID');
      const agentId = safeUlid(commission.agent_id, 'Stored completion commission Agent ID');
      if (commission.order_item.order_id !== input.orderId ||
        (order.final_agent_id !== null && agentId !== order.final_agent_id) || commission.position === null ||
        !lockedPositionIds.has(commission.position.id) || commission.position.snapshot_id !== snapshotId) {
        throw internal('Stored completion commission ownership is inconsistent');
      }
      const position = commission.position;
      const positionId = safeUlid(position.id, 'Stored completion commission position ID');
      const positionVersion = safeCount(position.version, 'Stored completion commission position version', 1);
      safeMoney(commission.original_commission, 'Stored completion commission snapshot amount');
      safeMoney(position.original_commission, 'Stored completion position original amount');
      safeMoney(position.expected_remaining, 'Stored completion expected commission amount');
      safeMoney(position.reversed_total, 'Stored completion reversed commission amount');
      if (!position.original_commission.equals(commission.original_commission) ||
        !position.original_commission.equals(position.expected_remaining.add(position.reversed_total))) {
        throw internal('Stored completion commission amounts do not close');
      }
      if (position.state === 'NONE') {
        if (!position.original_commission.isZero() || position.available_at !== null) {
          throw internal('Stored NONE commission position is inconsistent');
        }
        continue;
      }
      if (position.state === 'CANCELLED') {
        if (!position.expected_remaining.isZero() || position.available_at !== null) {
          throw internal('Stored CANCELLED commission position is inconsistent');
        }
        continue;
      }
      if (position.state !== 'EXPECTED' || position.available_at !== null) {
        throw internal('Stored commission position is not eligible for completion');
      }
      expectedCommissions.push({
        agentId,
        amount: position.expected_remaining,
        positionId,
        positionVersion,
        snapshotId,
      });
    }

    const positiveAgentIds = expectedCommissions
      .filter(({ amount }) => !amount.isZero())
      .map(({ agentId }) => agentId);
    const wallets = await this.lockCompletionWallets(transaction, positiveAgentIds);
    const walletCredits = new Map<string, Prisma.Decimal>();
    const commissionCredits: FulfillmentCommissionCredit[] = [];
    for (const commission of expectedCommissions) {
      const changed = await transaction.orderItemCommissionPosition.updateMany({
        data: {
          available_at: serverTime,
          expected_remaining: new Prisma.Decimal(0),
          state: 'AVAILABLE',
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: {
          expected_remaining: commission.amount,
          id: commission.positionId,
          state: 'EXPECTED',
          version: commission.positionVersion,
        },
      });
      if (changed.count !== 1) throw internal('Commission position changed after its completion lock');
      if (commission.amount.isZero()) continue;

      const ledgerId = generateUlid(serverTime.getTime());
      const idempotencyKey = `complete:${input.orderId}:${commission.snapshotId}`;
      const inserted = await transaction.commissionLedger.createMany({
        data: [{
          agent_id: commission.agentId,
          available_change: commission.amount,
          expected_change: commission.amount.negated(),
          frozen_change: new Prisma.Decimal(0),
          id: ledgerId,
          idempotency_key: idempotencyKey,
          ledger_type: 'AVAILABLE_CREDIT',
          occurred_at: serverTime,
          reason: 'ORDER_COMPLETED',
          snapshot_id: commission.snapshotId,
        }],
        skipDuplicates: true,
      });
      if (inserted.count !== 1) {
        const winner = await transaction.commissionLedger.findUnique({
          where: {
            agent_id_idempotency_key: {
              agent_id: commission.agentId,
              idempotency_key: idempotencyKey,
            },
          },
        });
        if (winner !== null && winner.snapshot_id === commission.snapshotId &&
          winner.ledger_type === 'AVAILABLE_CREDIT' && winner.expected_change.equals(commission.amount.negated()) &&
          winner.available_change.equals(commission.amount) && winner.frozen_change.isZero()) {
          throw orderNotReceivable('Commission completion was already recorded');
        }
        throw internal('Commission completion ledger key conflicts with another fact');
      }
      walletCredits.set(
        commission.agentId,
        (walletCredits.get(commission.agentId) ?? new Prisma.Decimal(0)).add(commission.amount),
      );
      commissionCredits.push({ ledgerId, version: commission.positionVersion + 1 });
    }

    for (const [agentId, amount] of [...walletCredits.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const wallet = wallets.get(agentId);
      if (wallet === undefined) throw internal('A frozen commission Agent wallet is missing');
      if (wallet.available_balance.add(amount).abs().greaterThan('9999999999999999.99')) {
        throw internal('Commission wallet balance would exceed the supported range');
      }
      const changed = await transaction.agentWallet.updateMany({
        data: {
          available_balance: { increment: amount },
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: wallet.id, version: wallet.version },
      });
      if (changed.count !== 1) throw internal('Commission wallet changed after its completion lock');
    }

    let completedShipmentVersion = shipmentVersion;
    if (shipment.status !== 'DELIVERED') {
      const shipmentChanged = await transaction.shipment.updateMany({
        data: {
          delivered_at: serverTime,
          status: 'DELIVERED',
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: shipmentId, status: shipment.status, version: shipmentVersion },
      });
      if (shipmentChanged.count !== 1) throw internal('Shipment changed after its completion lock');
      completedShipmentVersion += 1;
    }
    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        aftersale_expires_at: aftersaleExpiresAt,
        business_rule_version_id: rule.id,
        completed_at: serverTime,
        completion_reason: input.completionReason,
        fulfillment_status: 'DELIVERED',
        order_status: 'COMPLETED',
        updated_at: serverTime,
        version: { increment: 1 },
      },
      where: {
        business_rule_version_id: null,
        close_reason: null,
        closed_at: null,
        completed_at: null,
        completion_reason: null,
        id: input.orderId,
        order_status: 'SHIPPING',
        payment_resolution: 'NORMAL',
        payment_status: 'PAID',
        refund_processing_status: 'IDLE',
        version: orderVersion,
      },
    });
    if (orderChanged.count !== 1) throw internal('Order changed after its completion lock');

    return {
      after: {
        fulfillmentStatus: 'DELIVERED',
        orderStatus: 'COMPLETED',
        orderVersion: orderVersion + 1,
        shipmentStatus: 'DELIVERED',
        shipmentVersion: completedShipmentVersion,
      },
      aftersaleExpiresAt,
      before: {
        fulfillmentStatus: order.fulfillment_status,
        orderStatus: order.order_status,
        orderVersion,
        shipmentStatus: shipment.status,
        shipmentVersion,
      },
      businessRuleVersionId: rule.id,
      commissionCredits,
      completedAt: serverTime,
      orderId: input.orderId,
      shipmentId,
    };
  }

  async createShipmentInTransaction(
    transaction: DatabaseTransaction,
    input: CreateFulfillmentShipmentInput,
  ): Promise<CreateFulfillmentShipmentResult> {
    validateCreateShipmentInput(input);
    await this.lockActor(transaction, input.actorAccountId);
    const lockedOrder = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.sales_order
      WHERE id = ${input.orderId}
      FOR UPDATE
    `);
    if (lockedOrder.length !== 1 || lockedOrder[0]?.id !== input.orderId) throw notFound();
    const order = await transaction.salesOrder.findUnique({
      select: SHIPMENT_COMMAND_ORDER_SELECT,
      where: { id: input.orderId },
    });
    if (order === null) throw internal('Locked shipment order disappeared');
    const lockedItems = await transaction.$queryRaw<LockedOrderItemRow[]>(Prisma.sql`
      SELECT id, quantity, pre_shipment_refunded_qty, shipped_qty, version
      FROM public.order_item
      WHERE order_id = ${input.orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    const lockedAftersales = await transaction.$queryRaw<LockedAftersaleRow[]>(Prisma.sql`
      SELECT id, status::text AS status
      FROM public.aftersale
      WHERE order_id = ${input.orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    const lockedShipment = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.shipment
      WHERE order_id = ${input.orderId}
      FOR UPDATE
    `);
    const currentOrderVersion = safeCount(order.version, 'Stored shipment command order version', 1);
    if (lockedShipment.length > 0) {
      if (lockedShipment.length !== 1 || !isValidUlid(lockedShipment[0]!.id)) {
        throw internal('Stored unique shipment lock result is invalid');
      }
      const winner = shipmentProjection(await this.readShipmentInTransaction(transaction, lockedShipment[0]!.id));
      if (!isCreateShipmentWinner(winner, input, currentOrderVersion)) throw shipmentStateConflict();
      return { kind: 'winner', orderVersion: currentOrderVersion, shipment: winner };
    }
    const validatedOrderVersion = validateShipmentCommandOrder(order);
    if (validatedOrderVersion !== input.expectedOrderVersion) throw orderVersionConflict();
    if (lockedAftersales.some((record) => {
      safeUlid(record.id, 'Stored locked aftersale ID');
      if (!AFTERSALE_STATUSES.has(record.status as AftersaleStatus)) {
        throw internal('Stored locked aftersale status is invalid');
      }
      return ACTIVE_AFTERSALE_STATUSES.has(record.status as AftersaleStatus);
    })) throw activeAftersaleBlocksShipment();

    const remaining = lockedItems.map((record) => {
      const orderItemId = safeUlid(record.id, 'Stored locked order item ID');
      const quantity = safeCount(record.quantity, 'Stored locked order item quantity', 1);
      const refunded = safeCount(
        record.pre_shipment_refunded_qty,
        'Stored locked pre-shipment refunded quantity',
      );
      const shipped = safeCount(record.shipped_qty, 'Stored locked shipped quantity');
      safeCount(record.version, 'Stored locked order item version', 1);
      if (refunded + shipped > quantity) throw internal('Stored order item fulfillment counters are invalid');
      return { orderItemId, quantity: quantity - refunded - shipped, record };
    }).filter(({ quantity }) => quantity > 0);
    const requested = new Map<string, FulfillmentShipmentLineInput>();
    for (const item of input.items) {
      if (requested.has(item.orderItemId)) throw shipmentItemsMismatch();
      requested.set(item.orderItemId, item);
    }
    if (remaining.length !== requested.size || remaining.some(({ orderItemId, quantity }) =>
      requested.get(orderItemId)?.quantity !== quantity)) throw shipmentItemsMismatch();

    const currentTime = this.currentTime();
    for (const item of remaining) {
      const changed = await transaction.orderItem.updateMany({
        data: { shipped_qty: { increment: item.quantity }, version: { increment: 1 } },
        where: {
          id: item.orderItemId,
          order_id: input.orderId,
          pre_shipment_refunded_qty: item.record.pre_shipment_refunded_qty,
          quantity: item.record.quantity,
          shipped_qty: item.record.shipped_qty,
          version: item.record.version,
        },
      });
      if (changed.count !== 1) throw shipmentStateConflict('Order item fulfillment facts changed');
    }
    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        fulfillment_status: 'SHIPPED',
        order_status: 'SHIPPING',
        updated_at: currentTime,
        version: { increment: 1 },
      },
      where: {
        fulfillment_status: 'READY_TO_SHIP',
        id: input.orderId,
        order_status: 'PENDING_SHIPMENT',
        payment_resolution: 'NORMAL',
        payment_status: 'PAID',
        version: input.expectedOrderVersion,
      },
    });
    if (orderChanged.count !== 1) throw shipmentStateConflict('Order state changed while creating shipment');
    const created = await transaction.shipment.create({
      data: {
        carrier_code: input.carrierCode,
        carrier_name: input.carrierName,
        created_at: currentTime,
        delivered_at: null,
        id: input.shipmentId,
        items: {
          create: [...input.items]
            .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId))
            .map((item) => ({
              created_at: currentTime,
              id: item.shipmentItemId,
              order_item_id: item.orderItemId,
              quantity: item.quantity,
            })),
        },
        order_id: input.orderId,
        shipped_at: currentTime,
        status: 'SHIPPED',
        tracking_no: input.trackingNo,
        updated_at: currentTime,
        version: 1,
      },
      include: SHIPMENT_INCLUDE,
    });
    const projection = shipmentProjection(created);
    return { kind: 'created', orderVersion: input.expectedOrderVersion + 1, shipment: projection };
  }

  async getAdminShipmentInTransaction(
    transaction: DatabaseTransaction,
    input: FulfillmentShipmentReadInput,
  ): Promise<FulfillmentShipmentProjection> {
    validateShipmentReadInput(input);
    const shipment = await this.readShipmentInTransaction(transaction, input.shipmentId);
    if (input.orderId !== undefined && shipment.order_id !== input.orderId) throw shipmentNotFound();
    return shipmentProjection(shipment);
  }

  getAdminShipment(input: FulfillmentShipmentReadInput): Promise<FulfillmentShipmentProjection> {
    return this.prisma.$transaction(
      (transaction) => this.getAdminShipmentInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async appendLogisticsEventInTransaction(
    transaction: DatabaseTransaction,
    input: AppendFulfillmentLogisticsEventInput,
  ): Promise<AppendFulfillmentLogisticsEventResult> {
    validateLogisticsEventInput(input);
    await this.lockActor(transaction, input.actorAccountId);
    const candidate = await transaction.shipment.findUnique({
      select: { order_id: true },
      where: { id: input.shipmentId },
    });
    if (candidate === null) throw shipmentNotFound();
    const orderId = safeUlid(candidate.order_id, 'Stored logistics order ID');
    const lockedOrder = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.sales_order
      WHERE id = ${orderId}
      FOR UPDATE
    `);
    if (lockedOrder.length !== 1 || lockedOrder[0]?.id !== orderId) {
      throw internal('Shipment order disappeared while locking logistics command');
    }
    const lockedShipment = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.shipment
      WHERE id = ${input.shipmentId} AND order_id = ${orderId}
      FOR UPDATE
    `);
    if (lockedShipment.length !== 1 || lockedShipment[0]?.id !== input.shipmentId) throw shipmentNotFound();
    // The append-only event table intentionally denies UPDATE to mall_runtime.
    // The locked shipment row serializes commands; this ordered read observes the
    // event set without requesting an impermissible row lock.
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.logistics_event
      WHERE shipment_id = ${input.shipmentId}
      ORDER BY occurred_at ASC, id ASC
    `);
    const currentRecord = await this.readShipmentInTransaction(transaction, input.shipmentId);
    const current = shipmentProjection(currentRecord);
    const existingEvent = current.events.find(({ eventKey }) => eventKey === input.eventKey);
    if (existingEvent !== undefined) {
      if (!logisticsEventMatchesInput(existingEvent, input)) throw shipmentStateConflict();
      return { event: existingEvent, kind: 'winner', shipment: current };
    }
    if (current.version !== input.expectedShipmentVersion) throw shipmentVersionConflict();
    const order = await transaction.salesOrder.findUnique({
      select: LOGISTICS_COMMAND_ORDER_SELECT,
      where: { id: orderId },
    });
    if (order === null) throw internal('Locked logistics order disappeared');
    const orderVersion = validateLogisticsCommandOrder(order, currentRecord);
    if (input.event.eventType === 'STATUS' && input.event.statusCode === 'DELIVERED' &&
      input.event.occurredAt.getTime() < current.shippedAt.getTime()) {
      throw shipmentStateConflict('Delivered time cannot precede shipment');
    }
    if (current.events.some(({ eventId }) => eventId === input.eventId)) throw shipmentStateConflict();

    const currentTime = this.currentTime();
    if (input.event.eventType === 'STATUS') {
      assertStatusTransition(current.status, input.event.statusCode);
      const shipmentChanged = await transaction.shipment.updateMany({
        data: {
          ...(input.event.statusCode === 'DELIVERED' ? { delivered_at: input.event.occurredAt } : {}),
          status: input.event.statusCode,
          updated_at: currentTime,
          version: { increment: 1 },
        },
        where: { id: input.shipmentId, status: current.status, version: current.version },
      });
      if (shipmentChanged.count !== 1) throw shipmentVersionConflict();
      const orderChanged = await transaction.salesOrder.updateMany({
        data: {
          fulfillment_status: input.event.statusCode,
          updated_at: currentTime,
          version: { increment: 1 },
        },
        where: {
          fulfillment_status: current.status,
          id: orderId,
          order_status: 'SHIPPING',
          payment_resolution: 'NORMAL',
          payment_status: 'PAID',
          version: orderVersion,
        },
      });
      if (orderChanged.count !== 1) throw shipmentStateConflict('Order state changed during logistics update');
    } else {
      const shipmentChanged = await transaction.shipment.updateMany({
        data: {
          carrier_code: input.event.carrierCode,
          carrier_name: input.event.carrierName,
          tracking_no: input.event.trackingNo,
          updated_at: currentTime,
          version: { increment: 1 },
        },
        where: { id: input.shipmentId, status: current.status, version: current.version },
      });
      if (shipmentChanged.count !== 1) throw shipmentVersionConflict();
    }
    await transaction.logisticsEvent.create({
      data: {
        actor_account_id: input.actorAccountId,
        carrier_code: input.event.eventType === 'TRACKING_CORRECTION' ? input.event.carrierCode : null,
        carrier_name: input.event.eventType === 'TRACKING_CORRECTION' ? input.event.carrierName : null,
        created_at: currentTime,
        description: input.event.description,
        event_key: input.eventKey,
        event_type: input.event.eventType,
        id: input.eventId,
        location: input.event.location,
        occurred_at: input.event.occurredAt,
        reason: input.event.eventType === 'TRACKING_CORRECTION' ? input.event.reason : null,
        shipment_id: input.shipmentId,
        source: 'MANUAL',
        status_code: input.event.eventType === 'STATUS' ? input.event.statusCode : null,
        tracking_no: input.event.eventType === 'TRACKING_CORRECTION' ? input.event.trackingNo : null,
      },
    });
    const refreshed = shipmentProjection(await this.readShipmentInTransaction(transaction, input.shipmentId));
    const appended = refreshed.events.find(({ eventId }) => eventId === input.eventId);
    if (appended === undefined || !logisticsEventMatchesInput(appended, input)) {
      throw internal('Committed logistics event could not be re-read exactly');
    }
    return { event: appended, kind: 'applied', shipment: refreshed };
  }

  async listAdminOrdersInTransaction(
    transaction: DatabaseTransaction,
    input: AdminFulfillmentOrderListInput,
  ): Promise<AdminFulfillmentOrderListResult> {
    validateListInput(input);
    if (input.agentId !== undefined) {
      const agent = await transaction.agentProfile.findUnique({
        select: { id: true },
        where: { id: input.agentId },
      });
      if (agent === null) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Agent not found');
    }
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
