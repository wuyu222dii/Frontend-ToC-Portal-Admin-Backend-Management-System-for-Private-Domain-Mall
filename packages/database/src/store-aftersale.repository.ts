import {
  ApplicationError,
  generateUlid,
  isValidUlid,
  type OrderDisplayStatusAxes,
} from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const AFTERSALE_ITEM_LIMIT = 100;
const AFTERSALE_QUANTITY_LIMIT = 99;
const AFTERSALE_EVIDENCE_LIMIT = 9;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const APPLICATION_EVIDENCE_PURPOSE = 'APPLICATION';
const INSPECTION_EVIDENCE_PURPOSE = 'INSPECTION';

const AFTERSALE_TYPES = new Set<StoreAftersaleType>(['REFUND_ONLY', 'RETURN_REFUND']);
const AFTERSALE_REASON_CODES = new Set<StoreAftersaleReasonCode>([
  'ITEM_DAMAGED',
  'ITEM_NOT_AS_DESCRIBED',
  'MISSING_ITEM',
  'OTHER',
  'QUALITY_ISSUE',
  'UNSHIPPED_NO_LONGER_NEEDED',
  'WRONG_ITEM',
]);
const AFTERSALE_STATUSES = new Set<StoreAftersaleStatus>([
  'CANCELLED',
  'COMPLETED',
  'PENDING_REVIEW',
  'REFUND_FAILED',
  'REFUNDING',
  'REFUNDING_AFTER_RETURN',
  'REJECTED',
  'REJECTED_AFTER_RETURN',
  'RETURN_EXCEPTION',
  'WAITING_RECEIPT',
  'WAITING_RETURN',
]);
const ACTIVE_REFUND_STATUSES = new Set(['PENDING', 'PROCESSING']);
const FULFILLMENT_STATUSES = new Set<OrderDisplayStatusAxes['fulfillmentStatus']>([
  'CANCELLED',
  'DELIVERED',
  'IN_TRANSIT',
  'NOT_STARTED',
  'READY_TO_SHIP',
  'SHIPPED',
]);
const ORDER_STATUSES = new Set<OrderDisplayStatusAxes['orderStatus']>([
  'CLOSED',
  'COMPLETED',
  'PENDING_PAYMENT',
  'PENDING_SHIPMENT',
  'SHIPPING',
]);
const PAYMENT_RESOLUTIONS = new Set<OrderDisplayStatusAxes['paymentResolution']>([
  'LATE_SUCCESS_REFUND_PENDING',
  'LATE_SUCCESS_REFUNDED',
  'MANUAL_REQUIRED',
  'NORMAL',
]);
const PAYMENT_STATUSES = new Set<OrderDisplayStatusAxes['paymentStatus']>([
  'PAID',
  'PROCESSING',
  'UNPAID',
]);
const REFUND_PROCESSING_STATUSES = new Set<OrderDisplayStatusAxes['refundProcessingStatus']>([
  'FAILED',
  'IDLE',
  'REFUNDING',
]);
const REFUND_PROGRESS_STATUSES = new Set<OrderDisplayStatusAxes['refundProgressStatus']>([
  'FULL',
  'NONE',
  'PARTIAL',
]);

export type StoreAftersaleType = 'REFUND_ONLY' | 'RETURN_REFUND';
export type StoreAftersaleReasonCode =
  | 'ITEM_DAMAGED'
  | 'ITEM_NOT_AS_DESCRIBED'
  | 'MISSING_ITEM'
  | 'OTHER'
  | 'QUALITY_ISSUE'
  | 'UNSHIPPED_NO_LONGER_NEEDED'
  | 'WRONG_ITEM';
export type StoreAftersaleStatus =
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
export type StoreAftersaleBlocker =
  | 'ORDER_NOT_ELIGIBLE'
  | 'ITEM_UNAVAILABLE'
  | 'AFTERSALE_QUOTA_EXCEEDED'
  | 'EVIDENCE_UNAVAILABLE';
export type StoreAftersaleAvailableAction = 'CANCEL' | 'SUBMIT_RETURN_SHIPMENT' | 'VIEW_ORDER';
export type StoreAftersaleRefundProgressStatus = 'NONE' | 'PARTIAL' | 'FULL';
export type StoreAftersaleRefundProcessingStatus = 'IDLE' | 'REFUNDING' | 'FAILED';

export interface StoreAftersaleIdentityInput {
  accountId: string;
  customerId: string;
}

export interface StoreAftersaleLineInput {
  orderItemId: string;
  quantity: number;
}

export interface StoreAftersalePreviewInput extends StoreAftersaleIdentityInput {
  evidenceFileIds?: readonly string[];
  items: readonly StoreAftersaleLineInput[];
  orderId: string;
  reasonCode: StoreAftersaleReasonCode;
  reasonText?: string | null;
  type: StoreAftersaleType;
}

export interface StoreAftersalePreviewItemFact {
  allocatedAmount: string;
  linePaidAmount: string | null;
  orderItemId: string;
  orderItemVersion: number | null;
  refundedAmount: string | null;
  refundedQuantity: number | null;
  remainingRefundableAmount: string;
  remainingRefundableQuantity: number;
  requestedQuantity: number;
  reservedAmount: string | null;
  reservedQuantity: number | null;
  unitPrice: string | null;
}

export interface StoreAftersaleEvidenceFact {
  attachedAftersaleIds: readonly string[];
  createdByAccountId: string | null;
  fileId: string;
  objectKey: string | null;
  purpose: string | null;
  status: string | null;
  valid: boolean;
  visibility: string | null;
}

export interface StoreAftersalePreviewSnapshot {
  blockers: StoreAftersaleBlocker[];
  canSubmit: boolean;
  customerId: string;
  evidence: StoreAftersaleEvidenceFact[];
  items: StoreAftersalePreviewItemFact[];
  order: {
    aftersaleExpiresAt: Date | null;
    fulfillmentStatus: string;
    orderId: string;
    orderStatus: string;
    orderVersion: number;
    paymentResolution: string;
    paymentStatus: string;
  };
  reasonCode: StoreAftersaleReasonCode;
  reasonText: string | null;
  requestedAmount: string;
  serverTime: Date;
  type: StoreAftersaleType;
}

export interface StoreAftersaleConfirmHooks {
  verifyPreview(snapshot: StoreAftersalePreviewSnapshot): void;
}

export interface StoreAftersaleListInput extends StoreAftersaleIdentityInput {
  aftersaleNo?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  orderId?: string;
  page: number;
  pageSize: number;
  status?: StoreAftersaleStatus;
  type?: StoreAftersaleType;
}

export interface StoreAftersaleListItemSnapshot {
  aftersaleId: string;
  aftersaleNo: string;
  availableActions: StoreAftersaleAvailableAction[];
  createdAt: Date;
  orderId: string;
  refundProcessingStatus: StoreAftersaleRefundProcessingStatus;
  refundProgressStatus: StoreAftersaleRefundProgressStatus;
  requestedAmount: string;
  status: StoreAftersaleStatus;
  type: StoreAftersaleType;
  version: number;
}

export interface StoreAftersaleListResult {
  items: StoreAftersaleListItemSnapshot[];
  total: number;
}

export interface StoreAftersaleReadInput extends StoreAftersaleIdentityInput {
  aftersaleId: string;
}

export interface StoreAftersaleRefundAttemptSnapshot {
  amount: string;
  attemptNo: number;
  createdAt: Date;
  failureCode: string | null;
  refundId: string;
  refundNo: string;
  status: 'FAILED' | 'INITIATED' | 'PROCESSING' | 'SUCCEEDED';
  updatedAt: Date;
}

export interface StoreAftersaleDetailItemSnapshot {
  aftersaleItemId: string;
  allocatedAmount: string;
  approvedRefundQuantity: number | null;
  orderItemId: string;
  productName: string;
  refundedQuantity: number;
  requestedQuantity: number;
  reservedAmount: string;
  reservedQuantity: number;
  skuName: string;
}

export interface StoreAftersaleDetailSnapshot extends StoreAftersaleListItemSnapshot {
  cancelledAt: Date | null;
  completedAt: Date | null;
  evidenceFileIds: string[];
  inspection: null | {
    abnormalReason: string | null;
    evidenceFileIds: string[];
    inspectedAt: Date;
    inspectionId: string;
    items: Array<{
      approvedRefundQuantity: number;
      damagedQuantity: number;
      orderItemId: string;
      receivedQuantity: number;
      restockQuantity: number;
      returnToCustomerQuantity: number;
      scrapQuantity: number;
    }>;
    resolution: 'CONTINUE_REFUND' | 'REJECT_AFTER_RETURN' | null;
    resolutionReason: string | null;
    resolvedAt: Date | null;
    result: 'ABNORMAL' | 'PASS';
  };
  items: StoreAftersaleDetailItemSnapshot[];
  order: OrderDisplayStatusAxes & {
    orderId: string;
    orderNo: string;
    paidAt: Date | null;
    payableAmount: string;
    version: number;
  };
  reasonCode: StoreAftersaleReasonCode;
  reasonText: string | null;
  refundAttempts: StoreAftersaleRefundAttemptSnapshot[];
  returnAddress: null | {
    city: string;
    detailCiphertext: Uint8Array;
    district: string;
    encryptionKeyId: string;
    phoneCiphertext: Uint8Array;
    phoneLast4: string;
    province: string;
    recipientName: string;
    snapshotId: string;
    sourceVersionId: string;
  };
  returnShipment: null | {
    carrierCode: string;
    carrierName: string;
    submittedAt: Date;
    trackingNo: string;
  };
  reviewedAt: Date | null;
  timeline: StoreAftersaleTimelineFact[];
  updatedAt: Date;
}

export interface StoreAftersaleTimelineFact {
  action: string;
  actorRole: 'AGENT_ADMIN' | 'CUSTOMER' | 'SUPER_ADMIN' | null;
  auditId: string;
  fromStatus: StoreAftersaleStatus | null;
  occurredAt: Date;
  toStatus: StoreAftersaleStatus;
}

export interface StoreAftersaleAuditState {
  status: StoreAftersaleStatus;
  version: number;
}

export interface StoreAftersaleConfirmResult {
  aftersale: StoreAftersaleDetailSnapshot;
  audit: { after: StoreAftersaleAuditState; before: null };
}

export interface StoreAftersaleCancelInput extends StoreAftersaleReadInput {
  expectedVersion: number;
}

export interface StoreAftersaleCancelResult {
  aftersale: StoreAftersaleDetailSnapshot;
  audit: { after: StoreAftersaleAuditState; before: StoreAftersaleAuditState };
  changed: true;
}

export interface StoreAftersaleReturnShipmentInput extends StoreAftersaleReadInput {
  carrierCode: string;
  carrierName: string;
  expectedVersion: number;
  trackingNo: string;
}

export interface StoreAftersaleReturnShipmentResult {
  aftersale: StoreAftersaleDetailSnapshot;
  audit: { after: StoreAftersaleAuditState; before: StoreAftersaleAuditState };
  shipmentId: string;
}

const LIST_INCLUDE = {
  items: {
    select: { refunded_amount: true, requested_amount: true },
  },
  refunds: {
    select: { status: true },
  },
  return_shipment: {
    select: { id: true },
  },
} satisfies Prisma.AftersaleInclude;

const DETAIL_INCLUDE = {
  evidence: {
    orderBy: [{ file_id: 'asc' as const }],
    select: { aftersale_id: true, file_id: true, purpose: true, return_inspection_id: true },
  },
  items: {
    orderBy: [{ order_item_id: 'asc' as const }, { id: 'asc' as const }],
    select: {
      id: true,
      order_item: {
        select: { product_name_snapshot: true, sku_name_snapshot: true },
      },
      order_item_id: true,
      refunded_amount: true,
      refunded_qty: true,
      requested_amount: true,
      requested_qty: true,
      reserved_amount: true,
      reserved_qty: true,
    },
  },
  order: {
    select: {
      fulfillment_status: true,
      id: true,
      order_no: true,
      order_status: true,
      paid_at: true,
      payable_amount: true,
      payment_resolution: true,
      payment_status: true,
      refund_processing_status: true,
      refund_progress_status: true,
      version: true,
    },
  },
  refunds: {
    orderBy: [{ requested_at: 'asc' as const }, { id: 'asc' as const }],
    select: {
      amount: true,
      attempts: {
        orderBy: [{ attempt_no: 'asc' as const }, { id: 'asc' as const }],
        select: {
          attempt_no: true,
          failure_code: true,
          finished_at: true,
          requested_at: true,
          status: true,
        },
      },
      id: true,
      refund_no: true,
      status: true,
    },
  },
  return_address: {
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
      source_version_id: true,
    },
  },
  return_inspection: {
    select: {
      abnormal_reason: true,
      evidence: {
        orderBy: [{ file_id: 'asc' as const }],
        select: { aftersale_id: true, file_id: true, purpose: true, return_inspection_id: true },
      },
      id: true,
      inspected_at: true,
      items: {
        orderBy: [{ order_item_id: 'asc' as const }, { id: 'asc' as const }],
        select: {
          approved_refund_qty: true,
          damaged_qty: true,
          order_item_id: true,
          received_qty: true,
          restock_qty: true,
          return_to_customer_qty: true,
          scrap_qty: true,
        },
      },
      resolution: true,
      resolution_note: true,
      resolved_at: true,
      status: true,
    },
  },
  return_shipment: {
    select: {
      carrier_code: true,
      carrier_name: true,
      id: true,
      submitted_at: true,
      tracking_no: true,
    },
  },
} satisfies Prisma.AftersaleInclude;

type StoreAftersaleListRecord = Prisma.AftersaleGetPayload<{ include: typeof LIST_INCLUDE }>;
type StoreAftersaleDetailRecord = Prisma.AftersaleGetPayload<{ include: typeof DETAIL_INCLUDE }>;

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function requireExactKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  if (!plainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireVersion(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} must be a positive PostgreSQL integer`);
  }
}

function requireDate(value: unknown, label: string): asserts value is Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${label} must be a date`);
}

function normalizeReasonText(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw new TypeError('Store aftersale OTHER reason requires reason text');
    return null;
  }
  if (typeof value !== 'string') throw new TypeError('Store aftersale reason text must be a string or null');
  const normalized = value.trim();
  const characters = Array.from(normalized);
  if (characters.length < 2 || characters.length > 500 || characters.some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || point === 0x7f);
  })) {
    throw new TypeError('Store aftersale reason text must contain 2 to 500 characters without controls');
  }
  return normalized;
}

function sortedUniqueUlids(values: unknown, limit: number, label: string): string[] {
  if (!Array.isArray(values) || values.length > limit) {
    throw new TypeError(`${label} must contain at most ${limit} entries`);
  }
  const result = values.map((value) => {
    requireUlid(value, `${label} entry`);
    return value;
  }).sort();
  if (result.some((value, index) => index > 0 && result[index - 1] === value)) {
    throw new TypeError(`${label} entries must be unique`);
  }
  return result;
}

interface NormalizedPreviewInput extends Omit<StoreAftersalePreviewInput, 'evidenceFileIds' | 'items' | 'reasonText'> {
  evidenceFileIds: string[];
  items: StoreAftersaleLineInput[];
  reasonText: string | null;
}

function validateIdentity(input: StoreAftersaleIdentityInput, allowed: readonly string[], label: string): void {
  requireExactKeys(input, allowed, ['accountId', 'customerId'], label);
  requireUlid(input.accountId, `${label} Account ID`);
  requireUlid(input.customerId, `${label} Customer ID`);
}

function validatePreviewInput(input: StoreAftersalePreviewInput): NormalizedPreviewInput {
  validateIdentity(
    input,
    ['accountId', 'customerId', 'evidenceFileIds', 'items', 'orderId', 'reasonCode', 'reasonText', 'type'],
    'Store aftersale preview input',
  );
  requireUlid(input.orderId, 'Store aftersale Order ID');
  if (!AFTERSALE_TYPES.has(input.type)) throw new TypeError('Store aftersale type is invalid');
  if (!AFTERSALE_REASON_CODES.has(input.reasonCode)) throw new TypeError('Store aftersale reason code is invalid');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > AFTERSALE_ITEM_LIMIT) {
    throw new TypeError(`Store aftersale items must contain 1 to ${AFTERSALE_ITEM_LIMIT} entries`);
  }
  const items = input.items.map((item) => {
    requireExactKeys(item, ['orderItemId', 'quantity'], ['orderItemId', 'quantity'], 'Store aftersale item');
    requireUlid(item.orderItemId, 'Store aftersale Order Item ID');
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > AFTERSALE_QUANTITY_LIMIT) {
      throw new TypeError(`Store aftersale quantity must be between 1 and ${AFTERSALE_QUANTITY_LIMIT}`);
    }
    return { orderItemId: item.orderItemId, quantity: item.quantity };
  }).sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
  if (items.some((item, index) => index > 0 && items[index - 1]?.orderItemId === item.orderItemId)) {
    throw new TypeError('Store aftersale Order Item IDs must be unique');
  }
  const evidenceFileIds = sortedUniqueUlids(
    input.evidenceFileIds ?? [],
    AFTERSALE_EVIDENCE_LIMIT,
    'Store aftersale evidence file IDs',
  );
  const reasonText = normalizeReasonText(input.reasonText, input.reasonCode === 'OTHER');
  return { ...input, evidenceFileIds, items, reasonText };
}

function validateListInput(input: StoreAftersaleListInput): void {
  validateIdentity(
    input,
    [
      'accountId', 'aftersaleNo', 'createdAtFrom', 'createdAtToExclusive', 'customerId',
      'orderId', 'page', 'pageSize', 'status', 'type',
    ],
    'Store aftersale list input',
  );
  if (!Number.isSafeInteger(input.page) || input.page < 1 ||
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Store aftersale pagination is invalid');
  }
  if (input.aftersaleNo !== undefined) {
    const aftersaleNoLength = typeof input.aftersaleNo === 'string'
      ? Array.from(input.aftersaleNo.trim()).length
      : 0;
    if (aftersaleNoLength < 1 || aftersaleNoLength > 32) {
      throw new TypeError('Store aftersale number filter is invalid');
    }
  }
  if (input.orderId !== undefined) requireUlid(input.orderId, 'Store aftersale Order filter ID');
  if (input.status !== undefined && !AFTERSALE_STATUSES.has(input.status)) {
    throw new TypeError('Store aftersale status filter is invalid');
  }
  if (input.type !== undefined && !AFTERSALE_TYPES.has(input.type)) {
    throw new TypeError('Store aftersale type filter is invalid');
  }
  if (input.createdAtFrom !== undefined) requireDate(input.createdAtFrom, 'Store aftersale start date');
  if (input.createdAtToExclusive !== undefined) requireDate(input.createdAtToExclusive, 'Store aftersale end date');
  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Store aftersale date range is invalid');
  }
}

function validateReadInput(input: StoreAftersaleReadInput): void {
  validateIdentity(input, ['accountId', 'aftersaleId', 'customerId'], 'Store aftersale read input');
  requireUlid(input.aftersaleId, 'Store aftersale ID');
}

function validateCancelInput(input: StoreAftersaleCancelInput): void {
  validateIdentity(
    input,
    ['accountId', 'aftersaleId', 'customerId', 'expectedVersion'],
    'Store aftersale cancel input',
  );
  requireUlid(input.aftersaleId, 'Store aftersale ID');
  requireVersion(input.expectedVersion, 'Store aftersale expected version');
}

function normalizeReturnShipmentInput(
  input: StoreAftersaleReturnShipmentInput,
): StoreAftersaleReturnShipmentInput {
  validateIdentity(
    input,
    ['accountId', 'aftersaleId', 'carrierCode', 'carrierName', 'customerId', 'expectedVersion', 'trackingNo'],
    'Store aftersale return shipment input',
  );
  requireUlid(input.aftersaleId, 'Store aftersale ID');
  requireVersion(input.expectedVersion, 'Store aftersale expected version');
  const carrierCode = typeof input.carrierCode === 'string' ? input.carrierCode.trim() : '';
  const carrierName = typeof input.carrierName === 'string' ? input.carrierName.trim() : '';
  const trackingNo = typeof input.trackingNo === 'string' ? input.trackingNo.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(carrierCode)) {
    throw new TypeError('Store return shipment carrier code is invalid');
  }
  if (Array.from(carrierName).length < 1 || Array.from(carrierName).length > 80 ||
    Array.from(carrierName).some((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && (point <= 0x1f || point === 0x7f);
    })) {
    throw new TypeError('Store return shipment carrier name is invalid');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(trackingNo)) {
    throw new TypeError('Store return shipment tracking number is invalid');
  }
  return { ...input, carrierCode, carrierName, trackingNo };
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Store aftersale was not found');
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function requoteRequired(message: string): ApplicationError {
  return new ApplicationError('AFTERSALE_REQUOTE_REQUIRED', message);
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Store aftersale version changed');
}

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError(
    'INTERNAL_ERROR',
    message,
    [],
    cause === undefined ? undefined : { cause },
  );
}

function safeUlid(value: string, label: string): string {
  if (!isValidUlid(value)) throw internal(`${label} ID is invalid`);
  return value;
}

function safeVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} version is invalid`);
  }
  return value;
}

function safeCounter(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} counter is invalid`);
  }
  return value;
}

function safeDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function safeNullableDate(value: Date | null, label: string): Date | null {
  return value === null ? null : safeDate(value, label);
}

function safeMoney(value: Prisma.Decimal, label: string, positive = false): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || (positive && !value.greaterThan(0)) ||
    value.greaterThan(MAX_MONEY) || value.decimalPlaces() > 2) {
    throw internal(`${label} amount is invalid`);
  }
  return value.toFixed(2);
}

function safeStoredText(value: string, maximum: number, label: string): string {
  const characters = typeof value === 'string' ? Array.from(value) : [];
  if (typeof value !== 'string' || characters.length < 1 || characters.length > maximum ||
    characters.some((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && (point <= 0x1f || point === 0x7f);
    })) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function safeOrderAxis<T extends string>(value: string, allowed: ReadonlySet<T>, label: string): T {
  if (!allowed.has(value as T)) throw internal(`${label} is invalid`);
  return value as T;
}

function refundAxes(record: Pick<StoreAftersaleListRecord, 'items' | 'refunds'>): {
  processing: StoreAftersaleRefundProcessingStatus;
  progress: StoreAftersaleRefundProgressStatus;
  requestedAmount: string;
} {
  const requested = record.items.reduce(
    (total, item) => total.plus(item.requested_amount),
    new Prisma.Decimal(0),
  );
  const refunded = record.items.reduce(
    (total, item) => total.plus(item.refunded_amount),
    new Prisma.Decimal(0),
  );
  if (!requested.greaterThan(0) || refunded.isNegative() || refunded.greaterThan(requested)) {
    throw internal('Stored aftersale refund totals are invalid');
  }
  const progress: StoreAftersaleRefundProgressStatus = refunded.isZero()
    ? 'NONE'
    : refunded.equals(requested) ? 'FULL' : 'PARTIAL';
  const processing: StoreAftersaleRefundProcessingStatus = record.refunds.some(({ status }) => status === 'FAILED')
    ? 'FAILED'
    : record.refunds.some(({ status }) => ACTIVE_REFUND_STATUSES.has(status)) ? 'REFUNDING' : 'IDLE';
  return { processing, progress, requestedAmount: requested.toFixed(2) };
}

function availableActions(
  status: StoreAftersaleStatus,
  hasReturnShipment: boolean,
): StoreAftersaleAvailableAction[] {
  const actions: StoreAftersaleAvailableAction[] = [];
  if (status === 'PENDING_REVIEW' || (status === 'WAITING_RETURN' && !hasReturnShipment)) actions.push('CANCEL');
  if (status === 'WAITING_RETURN' && !hasReturnShipment) actions.push('SUBMIT_RETURN_SHIPMENT');
  actions.push('VIEW_ORDER');
  return actions;
}

function listSnapshot(record: StoreAftersaleListRecord): StoreAftersaleListItemSnapshot {
  const type = record.type as StoreAftersaleType;
  const status = record.status as StoreAftersaleStatus;
  if (!AFTERSALE_TYPES.has(type) || !AFTERSALE_STATUSES.has(status)) {
    throw internal('Stored Store aftersale type or status is invalid');
  }
  const axes = refundAxes(record);
  return {
    aftersaleId: safeUlid(record.id, 'Stored aftersale'),
    aftersaleNo: safeStoredText(record.aftersale_no, 32, 'Stored aftersale number'),
    availableActions: availableActions(status, record.return_shipment !== null),
    createdAt: safeDate(record.created_at, 'Stored aftersale creation time'),
    orderId: safeUlid(record.order_id, 'Stored aftersale Order'),
    refundProcessingStatus: axes.processing,
    refundProgressStatus: axes.progress,
    requestedAmount: axes.requestedAmount,
    status,
    type,
    version: safeVersion(record.version, 'Stored aftersale'),
  };
}

function auditState(snapshot: Pick<StoreAftersaleDetailSnapshot, 'status' | 'version'>): StoreAftersaleAuditState {
  return { status: snapshot.status, version: snapshot.version };
}

function detailSnapshot(record: StoreAftersaleDetailRecord): StoreAftersaleDetailSnapshot {
  const list = listSnapshot(record);
  const reasonCode = record.reason_code as StoreAftersaleReasonCode;
  if (!AFTERSALE_REASON_CODES.has(reasonCode)) throw internal('Stored aftersale reason code is invalid');
  if (record.reason_text !== null) safeStoredText(record.reason_text, 500, 'Stored aftersale reason text');
  const storedAftersaleId = safeUlid(record.id, 'Stored aftersale');
  const storedInspectionId = record.return_inspection === null
    ? null
    : safeUlid(record.return_inspection.id, 'Stored aftersale inspection');
  for (const evidence of record.evidence) {
    const applicationEvidence = evidence.return_inspection_id === null &&
      evidence.purpose === APPLICATION_EVIDENCE_PURPOSE;
    const inspectionEvidence = storedInspectionId !== null &&
      evidence.aftersale_id === storedAftersaleId &&
      evidence.return_inspection_id === storedInspectionId &&
      evidence.purpose === INSPECTION_EVIDENCE_PURPOSE;
    if (!applicationEvidence && !inspectionEvidence) {
      throw internal('Stored aftersale evidence envelope is invalid');
    }
  }
  const inspectionItems = new Map(
    record.return_inspection?.items.map((item) => [item.order_item_id, item]) ?? [],
  );
  if (inspectionItems.size !== (record.return_inspection?.items.length ?? 0)) {
    throw internal('Stored aftersale inspection items are duplicated');
  }
  const items = record.items.map((item) => {
    const inspected = inspectionItems.get(item.order_item_id);
    return {
      aftersaleItemId: safeUlid(item.id, 'Stored aftersale item'),
      allocatedAmount: safeMoney(item.requested_amount, 'Stored aftersale requested', true),
      approvedRefundQuantity: inspected === undefined
        ? null
        : safeCounter(inspected.approved_refund_qty, 'Stored inspection approved refund'),
      orderItemId: safeUlid(item.order_item_id, 'Stored aftersale Order Item'),
      productName: safeStoredText(item.order_item.product_name_snapshot, 200, 'Stored aftersale product name'),
      refundedQuantity: safeCounter(item.refunded_qty, 'Stored aftersale refunded quantity'),
      requestedQuantity: safeCounter(item.requested_qty, 'Stored aftersale requested quantity'),
      reservedAmount: safeMoney(item.reserved_amount, 'Stored aftersale reserved', true),
      reservedQuantity: safeCounter(item.reserved_qty, 'Stored aftersale reserved quantity'),
      skuName: safeStoredText(item.order_item.sku_name_snapshot, 160, 'Stored aftersale SKU name'),
    };
  });
  if (items.length < 1 || items.some((item) => item.requestedQuantity < 1 || item.reservedQuantity < 1)) {
    throw internal('Stored aftersale items are invalid');
  }
  const refundAttempts = record.refunds.flatMap((refund) => {
    const amount = safeMoney(refund.amount, 'Stored aftersale refund', true);
    const refundId = safeUlid(refund.id, 'Stored aftersale refund');
    const refundNo = safeStoredText(refund.refund_no, 32, 'Stored aftersale refund number');
    return refund.attempts.map((attempt) => {
      const attemptNo = safeCounter(attempt.attempt_no, 'Stored aftersale refund attempt');
      if (attemptNo < 1) throw internal('Stored aftersale refund attempt number is invalid');
      return ({
      amount,
      attemptNo,
      createdAt: safeDate(attempt.requested_at, 'Stored aftersale refund attempt creation time'),
      failureCode: attempt.failure_code === null
        ? null
        : safeStoredText(attempt.failure_code, 80, 'Stored aftersale refund failure code'),
      refundId,
      refundNo,
      status: attempt.status,
      updatedAt: attempt.finished_at === null
        ? safeDate(attempt.requested_at, 'Stored aftersale refund attempt creation time')
        : safeDate(attempt.finished_at, 'Stored aftersale refund attempt update time'),
      } satisfies StoreAftersaleRefundAttemptSnapshot);
    });
  });
  const returnAddress = record.return_address === null ? null : {
    city: safeStoredText(record.return_address.city, 80, 'Stored aftersale return city'),
    detailCiphertext: Buffer.from(record.return_address.detail_ciphertext),
    district: safeStoredText(record.return_address.district, 80, 'Stored aftersale return district'),
    encryptionKeyId: safeStoredText(
      record.return_address.encryption_key_id,
      80,
      'Stored aftersale return encryption key',
    ),
    phoneCiphertext: Buffer.from(record.return_address.phone_ciphertext),
    phoneLast4: record.return_address.phone_last4,
    province: safeStoredText(record.return_address.province, 80, 'Stored aftersale return province'),
    recipientName: safeStoredText(record.return_address.recipient_name, 80, 'Stored aftersale return recipient'),
    snapshotId: safeUlid(record.return_address.id, 'Stored aftersale return address snapshot'),
    sourceVersionId: safeUlid(record.return_address.source_version_id, 'Stored aftersale return address source version'),
  };
  if (returnAddress !== null && (returnAddress.phoneCiphertext.byteLength < 1 ||
    returnAddress.detailCiphertext.byteLength < 1 || !/^[0-9+ -]{4}$/.test(returnAddress.phoneLast4))) {
    throw internal('Stored aftersale return address material is invalid');
  }
  const inspection = record.return_inspection === null ? null : {
    abnormalReason: record.return_inspection.abnormal_reason,
    evidenceFileIds: record.return_inspection.evidence.map((evidence) => {
      if (evidence.aftersale_id !== storedAftersaleId ||
        evidence.return_inspection_id !== storedInspectionId ||
        evidence.purpose !== INSPECTION_EVIDENCE_PURPOSE) {
        throw internal('Stored aftersale inspection evidence envelope is invalid');
      }
      return safeUlid(evidence.file_id, 'Stored aftersale inspection evidence');
    }),
    inspectedAt: safeDate(record.return_inspection.inspected_at, 'Stored aftersale inspection time'),
    inspectionId: safeUlid(record.return_inspection.id, 'Stored aftersale inspection'),
    items: record.return_inspection.items.map((item) => ({
      approvedRefundQuantity: safeCounter(item.approved_refund_qty, 'Stored inspection approved refund'),
      damagedQuantity: safeCounter(item.damaged_qty, 'Stored inspection damaged'),
      orderItemId: safeUlid(item.order_item_id, 'Stored inspection Order Item'),
      receivedQuantity: safeCounter(item.received_qty, 'Stored inspection received'),
      restockQuantity: safeCounter(item.restock_qty, 'Stored inspection restock'),
      returnToCustomerQuantity: safeCounter(item.return_to_customer_qty, 'Stored inspection return to customer'),
      scrapQuantity: safeCounter(item.scrap_qty, 'Stored inspection scrap'),
    })),
    resolution: record.return_inspection.resolution,
    resolutionReason: record.return_inspection.resolution_note,
    resolvedAt: safeNullableDate(record.return_inspection.resolved_at, 'Stored aftersale inspection resolution time'),
    result: record.return_inspection.status,
  };
  return {
    ...list,
    cancelledAt: safeNullableDate(record.cancelled_at, 'Stored aftersale cancellation time'),
    completedAt: safeNullableDate(record.completed_at, 'Stored aftersale completion time'),
    evidenceFileIds: record.evidence.filter(({ return_inspection_id }) => return_inspection_id === null)
      .map(({ file_id }) => safeUlid(file_id, 'Stored aftersale application evidence')),
    inspection,
    items,
    order: {
      fulfillmentStatus: safeOrderAxis(
        record.order.fulfillment_status,
        FULFILLMENT_STATUSES,
        'Stored aftersale Order fulfillment status',
      ),
      orderId: safeUlid(record.order.id, 'Stored aftersale Order'),
      orderNo: safeStoredText(record.order.order_no, 32, 'Stored aftersale Order number'),
      orderStatus: safeOrderAxis(
        record.order.order_status,
        ORDER_STATUSES,
        'Stored aftersale Order status',
      ),
      paidAt: safeNullableDate(record.order.paid_at, 'Stored aftersale Order payment time'),
      payableAmount: safeMoney(record.order.payable_amount, 'Stored aftersale Order payable'),
      paymentResolution: safeOrderAxis(
        record.order.payment_resolution,
        PAYMENT_RESOLUTIONS,
        'Stored aftersale Order payment resolution',
      ),
      paymentStatus: safeOrderAxis(
        record.order.payment_status,
        PAYMENT_STATUSES,
        'Stored aftersale Order payment status',
      ),
      refundProcessingStatus: safeOrderAxis(
        record.order.refund_processing_status,
        REFUND_PROCESSING_STATUSES,
        'Stored aftersale Order refund processing status',
      ),
      refundProgressStatus: safeOrderAxis(
        record.order.refund_progress_status,
        REFUND_PROGRESS_STATUSES,
        'Stored aftersale Order refund progress status',
      ),
      version: safeVersion(record.order.version, 'Stored aftersale Order'),
    },
    reasonCode,
    reasonText: record.reason_text,
    refundAttempts,
    returnAddress,
    returnShipment: record.return_shipment === null ? null : {
      carrierCode: safeStoredText(record.return_shipment.carrier_code, 40, 'Stored return carrier code'),
      carrierName: safeStoredText(record.return_shipment.carrier_name, 80, 'Stored return carrier name'),
      submittedAt: safeDate(record.return_shipment.submitted_at, 'Stored return shipment time'),
      trackingNo: safeStoredText(record.return_shipment.tracking_no, 120, 'Stored return tracking number'),
    },
    reviewedAt: safeNullableDate(record.reviewed_at, 'Stored aftersale review time'),
    timeline: [],
    updatedAt: safeDate(record.updated_at, 'Stored aftersale update time'),
  };
}

function storedAuditState(value: Prisma.JsonValue | null, label: string): StoreAftersaleAuditState | null {
  if (value === null) return null;
  if (!plainObject(value) || Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, 'status') ||
    !Object.prototype.hasOwnProperty.call(value, 'version')) {
    throw internal(`${label} summary is invalid`);
  }
  const status = value.status;
  if (typeof status !== 'string' || !AFTERSALE_STATUSES.has(status as StoreAftersaleStatus)) {
    throw internal(`${label} status is invalid`);
  }
  const version = value.version;
  if (typeof version !== 'number') throw internal(`${label} version is invalid`);
  return {
    status: status as StoreAftersaleStatus,
    version: safeVersion(version, `${label} version`),
  };
}

function isThenable(value: unknown): boolean {
  return typeof value === 'object' && value !== null && 'then' in value &&
    typeof (value as { then?: unknown }).then === 'function';
}

export class StoreAftersaleRepository {
  constructor(private readonly prisma: PrismaClient) {}

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

  private async assertActiveCustomer(
    client: Pick<DatabaseTransaction, 'account'>,
    identity: StoreAftersaleIdentityInput,
  ): Promise<void> {
    const account = await client.account.findUnique({
      where: { id: identity.accountId },
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
      account.wechat_open_id === null || !customer || customer.id !== identity.customerId ||
      customer.account_id !== identity.accountId || customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
  }

  private async acquireIdentityLocks(
    transaction: DatabaseTransaction,
    identity: StoreAftersaleIdentityInput,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'store-auth-account', [identity.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [identity.customerId]);
    await this.assertActiveCustomer(transaction, identity);
  }

  private async readPreviewSnapshot(
    transaction: DatabaseTransaction,
    input: NormalizedPreviewInput,
    identityAlreadyChecked: boolean,
  ): Promise<StoreAftersalePreviewSnapshot> {
    if (!identityAlreadyChecked) await this.assertActiveCustomer(transaction, input);
    const serverTime = await this.transactionTime(transaction);
    const order = await transaction.salesOrder.findFirst({
      where: { customer_id: input.customerId, id: input.orderId },
      select: {
        aftersale_expires_at: true,
        completed_at: true,
        fulfillment_status: true,
        id: true,
        items: {
          orderBy: [{ id: 'asc' }],
          select: {
            aftersale_reserved_amount: true,
            aftersale_reserved_qty: true,
            id: true,
            line_paid_amount: true,
            quantity: true,
            refunded_amount: true,
            refunded_qty: true,
            unit_price: true,
            version: true,
          },
        },
        order_status: true,
        payment_resolution: true,
        payment_status: true,
        version: true,
      },
    });
    if (!order) throw notFound();
    const orderVersion = safeVersion(order.version, 'Stored aftersale preview Order');
    const completedAt = safeNullableDate(order.completed_at, 'Stored aftersale preview Order completion');
    const aftersaleExpiresAt = safeNullableDate(
      order.aftersale_expires_at,
      'Stored aftersale preview expiry',
    );
    const orderEligible = order.payment_status === 'PAID' && order.payment_resolution === 'NORMAL' && (
      ((order.order_status === 'PENDING_SHIPMENT' || order.order_status === 'SHIPPING') && completedAt === null) ||
      (order.order_status === 'COMPLETED' && completedAt !== null && aftersaleExpiresAt !== null &&
        aftersaleExpiresAt.getTime() >= serverTime.getTime())
    );

    const storedItems = new Map(order.items.map((item) => [item.id, item]));
    if (storedItems.size !== order.items.length) throw internal('Stored Order Items are duplicated');
    let itemUnavailable = false;
    let quotaExceeded = false;
    const items = input.items.map((requested): StoreAftersalePreviewItemFact => {
      const item = storedItems.get(requested.orderItemId);
      if (!item) {
        itemUnavailable = true;
        return {
          allocatedAmount: '0.00',
          linePaidAmount: null,
          orderItemId: requested.orderItemId,
          orderItemVersion: null,
          refundedAmount: null,
          refundedQuantity: null,
          remainingRefundableAmount: '0.00',
          remainingRefundableQuantity: 0,
          requestedQuantity: requested.quantity,
          reservedAmount: null,
          reservedQuantity: null,
          unitPrice: null,
        };
      }
      safeUlid(item.id, 'Stored aftersale preview Order Item');
      const quantity = safeCounter(item.quantity, 'Stored Order Item quantity');
      const refundedQuantity = safeCounter(item.refunded_qty, 'Stored Order Item refunded quantity');
      const reservedQuantity = safeCounter(item.aftersale_reserved_qty, 'Stored Order Item aftersale reservation');
      const unitPrice = new Prisma.Decimal(safeMoney(item.unit_price, 'Stored Order Item unit price', true));
      const linePaid = new Prisma.Decimal(safeMoney(item.line_paid_amount, 'Stored Order Item paid', true));
      const refundedAmount = new Prisma.Decimal(safeMoney(item.refunded_amount, 'Stored Order Item refunded'));
      const reservedAmount = new Prisma.Decimal(safeMoney(
        item.aftersale_reserved_amount,
        'Stored Order Item aftersale reservation',
      ));
      const remainingQuantity = quantity - refundedQuantity - reservedQuantity;
      const remainingAmount = linePaid.minus(refundedAmount).minus(reservedAmount);
      if (remainingQuantity < 0 || remainingAmount.isNegative()) {
        throw internal('Stored Order Item aftersale counters are inconsistent');
      }
      const calculated = unitPrice.mul(requested.quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      const allocated = requested.quantity === remainingQuantity ? remainingAmount : calculated;
      if (requested.quantity > remainingQuantity || allocated.greaterThan(remainingAmount) ||
        allocated.isNegative() || allocated.greaterThan(MAX_MONEY)) {
        quotaExceeded = true;
      }
      return {
        allocatedAmount: allocated.isNegative() ? '0.00' : allocated.toFixed(2),
        linePaidAmount: linePaid.toFixed(2),
        orderItemId: item.id,
        orderItemVersion: safeVersion(item.version, 'Stored aftersale preview Order Item'),
        refundedAmount: refundedAmount.toFixed(2),
        refundedQuantity,
        remainingRefundableAmount: remainingAmount.toFixed(2),
        remainingRefundableQuantity: remainingQuantity,
        requestedQuantity: requested.quantity,
        reservedAmount: reservedAmount.toFixed(2),
        reservedQuantity,
        unitPrice: unitPrice.toFixed(2),
      };
    });

    const files = input.evidenceFileIds.length === 0 ? [] : await transaction.fileAsset.findMany({
      where: { id: { in: input.evidenceFileIds } },
      orderBy: [{ id: 'asc' }],
      select: {
        aftersale_evidence: {
          orderBy: [{ aftersale_id: 'asc' }],
          select: { aftersale_id: true },
        },
        created_by_id: true,
        deleted_at: true,
        id: true,
        object_key: true,
        purpose: true,
        status: true,
        visibility: true,
      },
    });
    const fileMap = new Map(files.map((file) => [file.id, file]));
    if (fileMap.size !== files.length) throw internal('Stored aftersale evidence files are duplicated');
    let evidenceUnavailable = false;
    const evidence = input.evidenceFileIds.map((fileId): StoreAftersaleEvidenceFact => {
      const file = fileMap.get(fileId);
      const attachedAftersaleIds = file?.aftersale_evidence.map(({ aftersale_id }) =>
        safeUlid(aftersale_id, 'Stored evidence aftersale')) ?? [];
      const valid = file !== undefined && file.created_by_id === input.accountId && file.deleted_at === null &&
        file.status === 'READY' && file.visibility === 'PRIVATE' && file.purpose === 'AFTERSALE_EVIDENCE' &&
        file.object_key === `private/${file.id}` && attachedAftersaleIds.length === 0;
      evidenceUnavailable ||= !valid;
      return {
        attachedAftersaleIds,
        createdByAccountId: file?.created_by_id ?? null,
        fileId,
        objectKey: file?.object_key ?? null,
        purpose: file?.purpose ?? null,
        status: file?.status ?? null,
        valid,
        visibility: file?.visibility ?? null,
      };
    });

    const blockers: StoreAftersaleBlocker[] = [];
    if (!orderEligible) blockers.push('ORDER_NOT_ELIGIBLE');
    if (itemUnavailable) blockers.push('ITEM_UNAVAILABLE');
    if (quotaExceeded) blockers.push('AFTERSALE_QUOTA_EXCEEDED');
    if (evidenceUnavailable) blockers.push('EVIDENCE_UNAVAILABLE');
    const requestedAmount = items.reduce(
      (total, item) => total.plus(item.allocatedAmount),
      new Prisma.Decimal(0),
    );
    if (requestedAmount.greaterThan(MAX_MONEY)) throw internal('Store aftersale requested total is invalid');
    return {
      blockers,
      canSubmit: blockers.length === 0,
      customerId: input.customerId,
      evidence,
      items,
      order: {
        aftersaleExpiresAt,
        fulfillmentStatus: order.fulfillment_status,
        orderId: safeUlid(order.id, 'Stored aftersale preview Order'),
        orderStatus: order.order_status,
        orderVersion,
        paymentResolution: order.payment_resolution,
        paymentStatus: order.payment_status,
      },
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      requestedAmount: requestedAmount.toFixed(2),
      serverTime,
      type: input.type,
    };
  }

  async previewInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAftersalePreviewInput,
  ): Promise<StoreAftersalePreviewSnapshot> {
    return this.readPreviewSnapshot(transaction, validatePreviewInput(input), false);
  }

  async preview(input: StoreAftersalePreviewInput): Promise<StoreAftersalePreviewSnapshot> {
    const normalized = validatePreviewInput(input);
    return this.prisma.$transaction(
      (transaction) => this.readPreviewSnapshot(transaction, normalized, false),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async lockOrderEnvelope(
    transaction: DatabaseTransaction,
    customerId: string,
    orderId: string,
  ): Promise<void> {
    const lockedOrders = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.sales_order
      WHERE id = ${orderId} AND customer_id = ${customerId}
      FOR UPDATE
    `);
    if (lockedOrders.length !== 1 || lockedOrders[0]?.id !== orderId) throw notFound();
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.order_item
      WHERE order_id = ${orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.aftersale
      WHERE order_id = ${orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT ai.id
      FROM public.aftersale_item AS ai
      INNER JOIN public.aftersale AS a ON a.id = ai.aftersale_id
      WHERE a.order_id = ${orderId}
      ORDER BY ai.id ASC
      FOR UPDATE OF ai
    `);
  }

  private async lockEvidence(
    transaction: DatabaseTransaction,
    fileIds: readonly string[],
  ): Promise<void> {
    if (fileIds.length === 0) return;
    await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM public.file_asset
      WHERE id IN (${Prisma.join(fileIds)})
      ORDER BY id ASC
      FOR UPDATE
    `);
  }

  async confirmAftersaleInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAftersalePreviewInput,
    hooks: StoreAftersaleConfirmHooks,
  ): Promise<StoreAftersaleConfirmResult> {
    const normalized = validatePreviewInput(input);
    requireExactKeys(hooks, ['verifyPreview'], ['verifyPreview'], 'Store aftersale confirm hooks');
    if (typeof hooks.verifyPreview !== 'function') throw new TypeError('Store aftersale preview verifier is required');
    await this.acquireIdentityLocks(transaction, normalized);
    await this.lockOrderEnvelope(transaction, normalized.customerId, normalized.orderId);
    await this.lockEvidence(transaction, normalized.evidenceFileIds);
    const snapshot = await this.readPreviewSnapshot(transaction, normalized, true);
    const verification = hooks.verifyPreview(snapshot);
    if (verification !== undefined || isThenable(verification)) {
      throw new TypeError('Store aftersale preview verification must be synchronous and return void');
    }
    if (!snapshot.canSubmit) {
      throw requoteRequired('Store aftersale facts changed; request a new preview');
    }
    const occurredAt = await this.transactionTime(transaction);
    const aftersaleId = generateUlid(occurredAt.getTime());
    for (const item of snapshot.items) {
      if (item.orderItemVersion === null || item.refundedQuantity === null || item.reservedQuantity === null ||
        item.refundedAmount === null || item.reservedAmount === null) {
        throw internal('Store aftersale confirmed item facts are incomplete');
      }
      const reservedAfter = item.reservedQuantity + item.requestedQuantity;
      const reservedAmountAfter = new Prisma.Decimal(item.reservedAmount).plus(item.allocatedAmount);
      if (reservedAfter > MAX_POSTGRES_INTEGER || reservedAmountAfter.greaterThan(MAX_MONEY)) {
        throw new ApplicationError('AFTERSALE_QUOTA_EXCEEDED', 'Store aftersale quota is exceeded');
      }
      const updated = await transaction.orderItem.updateMany({
        data: {
          aftersale_reserved_amount: reservedAmountAfter,
          aftersale_reserved_qty: reservedAfter,
          version: { increment: 1 },
        },
        where: {
          aftersale_reserved_amount: new Prisma.Decimal(item.reservedAmount),
          aftersale_reserved_qty: item.reservedQuantity,
          id: item.orderItemId,
          order_id: normalized.orderId,
          refunded_amount: new Prisma.Decimal(item.refundedAmount),
          refunded_qty: item.refundedQuantity,
          version: item.orderItemVersion,
        },
      });
      if (updated.count !== 1) throw requoteRequired('Store aftersale quota changed; request a new preview');
    }
    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: {
        customer_id: normalized.customerId,
        id: normalized.orderId,
        version: snapshot.order.orderVersion,
      },
    });
    if (orderChanged.count !== 1) {
      throw requoteRequired('Store aftersale Order changed; request a new preview');
    }
    await transaction.aftersale.create({
      data: {
        aftersale_no: `AS${aftersaleId}`,
        cancelled_at: null,
        completed_at: null,
        created_at: occurredAt,
        customer_id: normalized.customerId,
        id: aftersaleId,
        order_id: normalized.orderId,
        reason_code: normalized.reasonCode,
        reason_text: normalized.reasonText,
        review_reason: null,
        reviewed_at: null,
        reviewed_by_id: null,
        status: 'PENDING_REVIEW',
        type: normalized.type,
        updated_at: occurredAt,
        version: 1,
      },
      select: { id: true },
    });
    const itemWrites = snapshot.items.map((item) => ({
      aftersale_id: aftersaleId,
      created_at: occurredAt,
      id: generateUlid(occurredAt.getTime()),
      order_item_id: item.orderItemId,
      refunded_amount: new Prisma.Decimal(0),
      refunded_qty: 0,
      requested_amount: new Prisma.Decimal(item.allocatedAmount),
      requested_qty: item.requestedQuantity,
      reserved_amount: new Prisma.Decimal(item.allocatedAmount),
      reserved_qty: item.requestedQuantity,
    }));
    const createdItems = await transaction.aftersaleItem.createMany({ data: itemWrites });
    if (createdItems.count !== itemWrites.length) throw internal('Store aftersale item insert count is invalid');
    if (normalized.evidenceFileIds.length > 0) {
      const evidenceWrites = normalized.evidenceFileIds.map((fileId) => ({
        aftersale_id: aftersaleId,
        created_at: occurredAt,
        file_id: fileId,
        id: generateUlid(occurredAt.getTime()),
        purpose: APPLICATION_EVIDENCE_PURPOSE,
        return_inspection_id: null,
      }));
      const createdEvidence = await transaction.aftersaleEvidence.createMany({ data: evidenceWrites });
      if (createdEvidence.count !== evidenceWrites.length) {
        throw internal('Store aftersale evidence insert count is invalid');
      }
    }
    const aftersale = await this.readOwnedDetail(transaction, normalized.customerId, aftersaleId);
    return { aftersale, audit: { after: auditState(aftersale), before: null } };
  }

  private listWhere(input: StoreAftersaleListInput): Prisma.AftersaleWhereInput {
    return {
      customer_id: input.customerId,
      type: input.type === undefined ? { in: ['REFUND_ONLY', 'RETURN_REFUND'] } : input.type,
      ...(input.aftersaleNo === undefined ? {} : { aftersale_no: input.aftersaleNo.trim() }),
      ...(input.orderId === undefined ? {} : { order_id: input.orderId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined ? {} : {
        created_at: {
          ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
          ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
        },
      }),
    };
  }

  async listOwnedAftersalesInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAftersaleListInput,
  ): Promise<StoreAftersaleListResult> {
    validateListInput(input);
    await this.assertActiveCustomer(transaction, input);
    const where = this.listWhere(input);
    const [total, records] = await Promise.all([
      transaction.aftersale.count({ where }),
      transaction.aftersale.findMany({
        include: LIST_INCLUDE,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
    ]);
    return { items: records.map(listSnapshot), total };
  }

  async listOwnedAftersales(input: StoreAftersaleListInput): Promise<StoreAftersaleListResult> {
    return this.prisma.$transaction(
      (transaction) => this.listOwnedAftersalesInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async readOwnedDetail(
    transaction: DatabaseTransaction,
    customerId: string,
    aftersaleId: string,
  ): Promise<StoreAftersaleDetailSnapshot> {
    const record = await transaction.aftersale.findFirst({
      include: DETAIL_INCLUDE,
      where: {
        customer_id: customerId,
        id: aftersaleId,
        type: { in: ['REFUND_ONLY', 'RETURN_REFUND'] },
      },
    });
    if (!record) throw notFound();
    const audits = await transaction.auditLog.findMany({
      orderBy: [{ occurred_at: 'asc' }, { id: 'asc' }],
      select: {
        action: true,
        actor_role: true,
        after_json: true,
        before_json: true,
        id: true,
        occurred_at: true,
      },
      where: {
        module: 'aftersale',
        object_id: aftersaleId,
        object_type: 'aftersale',
        result: 'SUCCESS',
      },
    });
    const timeline = audits.map((audit) => {
      const before = storedAuditState(audit.before_json, 'Stored aftersale audit before');
      const after = storedAuditState(audit.after_json, 'Stored aftersale audit after') ??
        (() => { throw internal('Stored aftersale audit after status is missing'); })();
      return {
        fact: {
          action: safeStoredText(audit.action, 120, 'Stored aftersale audit action'),
          actorRole: audit.actor_role,
          auditId: safeUlid(audit.id, 'Stored aftersale audit'),
          fromStatus: before?.status ?? null,
          occurredAt: safeDate(audit.occurred_at, 'Stored aftersale audit time'),
          toStatus: after.status,
        },
        version: after.version,
      };
    }).sort((left, right) => {
      if (left.version !== right.version) return left.version < right.version ? -1 : 1;
      const occurredAtDifference = left.fact.occurredAt.getTime() - right.fact.occurredAt.getTime();
      return occurredAtDifference === 0
        ? left.fact.auditId.localeCompare(right.fact.auditId)
        : occurredAtDifference;
    });
    const snapshot = detailSnapshot(record);
    return {
      ...snapshot,
      timeline: timeline.map(({ fact }) => fact),
    };
  }

  async getOwnedAftersaleDetailInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAftersaleReadInput,
  ): Promise<StoreAftersaleDetailSnapshot> {
    validateReadInput(input);
    await this.assertActiveCustomer(transaction, input);
    return this.readOwnedDetail(transaction, input.customerId, input.aftersaleId);
  }

  async getOwnedAftersaleDetail(input: StoreAftersaleReadInput): Promise<StoreAftersaleDetailSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.getOwnedAftersaleDetailInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getOwnedAftersaleForReplayInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAftersaleReadInput,
  ): Promise<StoreAftersaleDetailSnapshot> {
    validateReadInput(input);
    await this.acquireIdentityLocks(transaction, input);
    const candidate = await transaction.aftersale.findFirst({
      where: { customer_id: input.customerId, id: input.aftersaleId },
      select: { order_id: true },
    });
    if (!candidate) throw notFound();
    await this.lockOrderEnvelope(transaction, input.customerId, candidate.order_id);
    return this.readOwnedDetail(transaction, input.customerId, input.aftersaleId);
  }

  async cancelOwnedAftersaleInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAftersaleCancelInput,
  ): Promise<StoreAftersaleCancelResult> {
    validateCancelInput(input);
    await this.acquireIdentityLocks(transaction, input);
    const candidate = await transaction.aftersale.findFirst({
      where: { customer_id: input.customerId, id: input.aftersaleId },
      select: { order_id: true },
    });
    if (!candidate) throw notFound();
    await this.lockOrderEnvelope(transaction, input.customerId, candidate.order_id);
    const current = await transaction.aftersale.findFirst({
      where: { customer_id: input.customerId, id: input.aftersaleId },
      select: {
        id: true,
        items: {
          orderBy: [{ order_item_id: 'asc' }],
          select: {
            order_item_id: true,
            refunded_amount: true,
            refunded_qty: true,
            reserved_amount: true,
            reserved_qty: true,
          },
        },
        order_id: true,
        refunds: { select: { id: true } },
        return_shipment: { select: { id: true } },
        status: true,
        version: true,
      },
    });
    if (!current) throw notFound();
    const currentOrder = await transaction.salesOrder.findUnique({
      select: { id: true, version: true },
      where: { id: current.order_id },
    });
    if (!currentOrder || currentOrder.id !== current.order_id) {
      throw internal('Stored aftersale Order envelope is missing');
    }
    const orderVersion = safeVersion(currentOrder.version, 'Stored aftersale Order');
    const currentStatus = current.status as StoreAftersaleStatus;
    if (!AFTERSALE_STATUSES.has(currentStatus)) throw internal('Stored aftersale status is invalid');
    const before: StoreAftersaleAuditState = {
      status: currentStatus,
      version: safeVersion(current.version, 'Stored aftersale'),
    };
    if (before.version !== input.expectedVersion) throw versionConflict();
    if (current.status !== 'PENDING_REVIEW' &&
      !(current.status === 'WAITING_RETURN' && current.return_shipment === null)) {
      throw stateConflict('Store aftersale cannot be cancelled in its current state');
    }
    if (current.refunds.length > 0) throw stateConflict('Store aftersale with refund facts cannot be cancelled');
    if (current.items.length < 1) throw internal('Stored aftersale has no items');
    const orderItemIds = current.items.map(({ order_item_id }) =>
      safeUlid(order_item_id, 'Stored aftersale Order Item'));
    if (new Set(orderItemIds).size !== orderItemIds.length) {
      throw internal('Stored aftersale items are duplicated');
    }
    const orderItems = await transaction.orderItem.findMany({
      orderBy: [{ id: 'asc' }],
      select: {
        aftersale_reserved_amount: true,
        aftersale_reserved_qty: true,
        id: true,
        order_id: true,
        version: true,
      },
      where: { id: { in: orderItemIds }, order_id: current.order_id },
    });
    const orderItemsById = new Map(orderItems.map((item) => [item.id, item]));
    if (orderItemsById.size !== orderItemIds.length) {
      throw internal('Stored aftersale item is outside its Order envelope');
    }
    const occurredAt = await this.transactionTime(transaction);
    for (const item of current.items) {
      const reservedQuantity = safeCounter(item.reserved_qty, 'Stored aftersale reserved quantity');
      const refundedQuantity = safeCounter(item.refunded_qty, 'Stored aftersale refunded quantity');
      const reservedAmount = new Prisma.Decimal(safeMoney(item.reserved_amount, 'Stored aftersale reserved', true));
      const refundedAmount = new Prisma.Decimal(safeMoney(item.refunded_amount, 'Stored aftersale refunded'));
      const releaseQuantity = reservedQuantity - refundedQuantity;
      const releaseAmount = reservedAmount.minus(refundedAmount);
      if (releaseQuantity < 1 || !releaseAmount.greaterThan(0)) {
        throw internal('Cancellable aftersale has no releasable quota');
      }
      const orderItem = orderItemsById.get(item.order_item_id);
      if (!orderItem) throw internal('Stored aftersale item is outside its Order envelope');
      const reservedAfter = orderItem.aftersale_reserved_qty - releaseQuantity;
      const reservedAmountAfter = orderItem.aftersale_reserved_amount.minus(releaseAmount);
      if (reservedAfter < 0 || reservedAmountAfter.isNegative()) {
        throw internal('Stored Order Item aftersale reservation cannot be released');
      }
      const updated = await transaction.orderItem.updateMany({
        data: {
          aftersale_reserved_amount: reservedAmountAfter,
          aftersale_reserved_qty: reservedAfter,
          version: { increment: 1 },
        },
        where: {
          aftersale_reserved_amount: orderItem.aftersale_reserved_amount,
          aftersale_reserved_qty: orderItem.aftersale_reserved_qty,
          id: item.order_item_id,
          order_id: current.order_id,
          version: orderItem.version,
        },
      });
      if (updated.count !== 1) throw stateConflict('Store aftersale quota changed during cancellation');
    }
    const changed = await transaction.aftersale.updateMany({
      data: {
        cancelled_at: occurredAt,
        status: 'CANCELLED',
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: {
        id: current.id,
        status: current.status,
        version: current.version,
      },
    });
    if (changed.count !== 1) throw stateConflict('Store aftersale changed during cancellation');
    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: {
        customer_id: input.customerId,
        id: current.order_id,
        version: orderVersion,
      },
    });
    if (orderChanged.count !== 1) throw stateConflict('Store aftersale Order changed during cancellation');
    const aftersale = await this.readOwnedDetail(transaction, input.customerId, input.aftersaleId);
    return { aftersale, audit: { after: auditState(aftersale), before }, changed: true };
  }

  async submitReturnShipmentInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAftersaleReturnShipmentInput,
  ): Promise<StoreAftersaleReturnShipmentResult> {
    const normalized = normalizeReturnShipmentInput(input);
    await this.acquireIdentityLocks(transaction, normalized);
    const candidate = await transaction.aftersale.findFirst({
      where: { customer_id: normalized.customerId, id: normalized.aftersaleId },
      select: { order_id: true },
    });
    if (!candidate) throw notFound();
    await this.lockOrderEnvelope(transaction, normalized.customerId, candidate.order_id);
    const current = await transaction.aftersale.findFirst({
      where: { customer_id: normalized.customerId, id: normalized.aftersaleId },
      select: {
        id: true,
        order_id: true,
        refunds: { select: { id: true } },
        return_address: { select: { id: true } },
        return_inspection: { select: { id: true } },
        return_shipment: { select: { id: true } },
        status: true,
        type: true,
        version: true,
      },
    });
    if (!current) throw notFound();
    const before: StoreAftersaleAuditState = {
      status: current.status as StoreAftersaleStatus,
      version: safeVersion(current.version, 'Stored aftersale'),
    };
    if (!AFTERSALE_STATUSES.has(before.status)) throw internal('Stored aftersale status is invalid');
    if (before.version !== normalized.expectedVersion) throw versionConflict();
    if (current.type !== 'RETURN_REFUND' || current.status !== 'WAITING_RETURN' ||
      current.return_shipment !== null) {
      throw stateConflict('Store aftersale cannot accept return shipment in its current state');
    }
    if (current.return_address === null) throw internal('Returnable aftersale address snapshot is missing');
    if (current.return_inspection !== null || current.refunds.length > 0) {
      throw stateConflict('Store aftersale already has downstream processing facts');
    }
    const order = await transaction.salesOrder.findUnique({
      where: { id: current.order_id },
      select: { customer_id: true, id: true, version: true },
    });
    if (!order || order.customer_id !== normalized.customerId) {
      throw internal('Stored aftersale Order envelope is missing');
    }
    const orderVersion = safeVersion(order.version, 'Stored aftersale Order');
    const occurredAt = await this.transactionTime(transaction);
    const shipmentId = generateUlid(occurredAt.getTime());
    await transaction.returnShipment.create({
      data: {
        aftersale_id: current.id,
        carrier_code: normalized.carrierCode,
        carrier_name: normalized.carrierName,
        created_at: occurredAt,
        id: shipmentId,
        received_at: null,
        submitted_at: occurredAt,
        tracking_no: normalized.trackingNo,
      },
      select: { id: true },
    });
    const changed = await transaction.aftersale.updateMany({
      data: { status: 'WAITING_RECEIPT', updated_at: occurredAt, version: { increment: 1 } },
      where: { id: current.id, status: 'WAITING_RETURN', version: current.version },
    });
    if (changed.count !== 1) throw stateConflict('Store aftersale changed during return shipment submission');
    const orderChanged = await transaction.salesOrder.updateMany({
      data: { updated_at: occurredAt, version: { increment: 1 } },
      where: {
        customer_id: normalized.customerId,
        id: current.order_id,
        version: orderVersion,
      },
    });
    if (orderChanged.count !== 1) throw stateConflict('Store aftersale Order changed during return shipment submission');
    const aftersale = await this.readOwnedDetail(transaction, normalized.customerId, normalized.aftersaleId);
    return { aftersale, audit: { after: auditState(aftersale), before }, shipmentId };
  }
}
