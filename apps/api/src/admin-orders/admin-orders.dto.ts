import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const MAX_MONEY = '9999999999999999.99';
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const ORDER_STATUSES = ['PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED'] as const;
const PAYMENT_STATUSES = ['UNPAID', 'PROCESSING', 'PAID'] as const;
const REFUND_PROGRESS_STATUSES = ['NONE', 'PARTIAL', 'FULL'] as const;
const REFUND_PROCESSING_STATUSES = ['IDLE', 'REFUNDING', 'FAILED'] as const;
const FULFILLMENT_STATUSES = [
  'NOT_STARTED',
  'READY_TO_SHIP',
  'SHIPPED',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
] as const;
const ORDER_SORTS = ['CREATED_DESC', 'PAID_DESC', 'AMOUNT_DESC'] as const;

export type AdminOrderStatusFilter = (typeof ORDER_STATUSES)[number];
export type AdminOrderPaymentStatusFilter = (typeof PAYMENT_STATUSES)[number];
export type AdminOrderRefundProgressStatusFilter = (typeof REFUND_PROGRESS_STATUSES)[number];
export type AdminOrderRefundProcessingStatusFilter = (typeof REFUND_PROCESSING_STATUSES)[number];
export type AdminOrderFulfillmentStatusFilter = (typeof FULFILLMENT_STATUSES)[number];
export type AdminOrderSort = (typeof ORDER_SORTS)[number];

export interface AdminOrderListQuery {
  agentId?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  customerId?: string;
  fulfillmentStatus?: AdminOrderFulfillmentStatusFilter;
  maxAmount?: string;
  minAmount?: string;
  orderNo?: string;
  orderStatus?: AdminOrderStatusFilter;
  page: number;
  pageSize: number;
  paymentStatus?: AdminOrderPaymentStatusFilter;
  refundProcessingStatus?: AdminOrderRefundProcessingStatusFilter;
  refundProgressStatus?: AdminOrderRefundProgressStatusFilter;
  sort: AdminOrderSort;
}

export interface AdminFulfillmentAddressAccessHeaders {
  purpose: 'ORDER_FULFILLMENT';
  reason: string;
}

export interface AdminShipmentLineInput {
  orderItemId: string;
  quantity: number;
}

export interface AdminCreateShipmentInput {
  carrierCode: string;
  carrierName: string;
  items: AdminShipmentLineInput[];
  trackingNo: string;
}

export interface AdminCompleteOrderInput {
  completionReason: 'ADMIN_FORCED';
  reason: string;
}

interface AdminLogisticsEventBaseInput {
  description: string;
  location: string | null;
  occurredAt: string;
}

export interface AdminLogisticsStatusEventInput extends AdminLogisticsEventBaseInput {
  eventType: 'STATUS';
  statusCode: 'DELIVERED' | 'IN_TRANSIT';
}

export interface AdminLogisticsCorrectionEventInput extends AdminLogisticsEventBaseInput {
  carrierCode: string;
  carrierName: string;
  eventType: 'TRACKING_CORRECTION';
  reason: string;
  trackingNo: string;
}

export type AdminLogisticsEventInput =
  | AdminLogisticsCorrectionEventInput
  | AdminLogisticsStatusEventInput;

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid(`${label} must be a plain object`);
  }
  return value as PlainRecord;
}

function closedBody(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): PlainRecord {
  const body = plainRecord(value, 'Request body');
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !Object.hasOwn(body, field)) ||
    Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function normalizedText(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum || /\p{Cc}/u.test(normalized)) {
    return invalid(`${field} is invalid`);
  }
  return normalized;
}

function nullableLocation(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return invalid('location is invalid');
  const normalized = value.trim();
  if (normalized.length === 0) return null;
  return normalizedText(normalized, 'location', 1, 160);
}

function normalizedTimestamp(value: unknown): string {
  if (typeof value !== 'string' || !RFC3339.test(value)) return invalid('occurred_at is invalid');
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return invalid('occurred_at is invalid');
  return new Date(milliseconds).toISOString();
}

function positiveDatabaseInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > POSTGRES_INTEGER_MAX) {
    return invalid(`${field} is invalid`);
  }
  return Number(value);
}

function shipmentLine(value: unknown): AdminShipmentLineInput {
  const line = plainRecord(value, 'items item');
  if (Object.keys(line).length !== 2 || !Object.hasOwn(line, 'order_item_id') ||
    !Object.hasOwn(line, 'quantity')) return invalid('items item fields are invalid');
  if (!isValidUlid(line.order_item_id)) return invalid('order_item_id is invalid');
  return {
    orderItemId: line.order_item_id,
    quantity: positiveDatabaseInteger(line.quantity, 'quantity'),
  };
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function closedEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  fallback: T[number] | undefined,
  field: string,
): T[number] | undefined {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    return invalid(`${field} is invalid`);
  }
  return value as T[number];
}

function optionalUlid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function normalizedOrderNo(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return invalid('order_no is invalid');
  const normalized = value.trim();
  if (Array.from(normalized).length < 1 || /\p{Cc}/u.test(normalized)) {
    return invalid('order_no is invalid');
  }
  return normalized;
}

function strictUtcCalendarDate(value: unknown, field: 'date_from' | 'date_to'): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return parsed;
}

function shanghaiStart(value: unknown, field: 'date_from' | 'date_to', nextDay: boolean): Date {
  const utcCalendarDate = strictUtcCalendarDate(value, field);
  return new Date(utcCalendarDate.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? ONE_DAY_MS : 0));
}

function compareMoney(left: string, right: string): number {
  const [leftInteger = '', leftFraction = ''] = left.split('.');
  const [rightInteger = '', rightFraction = ''] = right.split('.');
  if (leftInteger.length !== rightInteger.length) return leftInteger.length < rightInteger.length ? -1 : 1;
  if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
}

function money(value: unknown, field: 'min_amount' | 'max_amount'): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !MONEY.test(value) || compareMoney(value, MAX_MONEY) > 0) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

export function parseAdminOrderId(value: string): string {
  if (!isValidUlid(value)) return invalid('order_id is invalid');
  return value;
}

export function parseAdminShipmentId(value: string): string {
  if (!isValidUlid(value)) return invalid('shipment_id is invalid');
  return value;
}

export function parseAdminCreateShipmentBody(value: unknown): AdminCreateShipmentInput {
  const body = closedBody(value, ['carrier_code', 'carrier_name', 'tracking_no', 'items']);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    return invalid('items is invalid');
  }
  const items = body.items.map(shipmentLine)
    .sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
  if (new Set(items.map(({ orderItemId }) => orderItemId)).size !== items.length) {
    return invalid('items order_item_id values must be unique');
  }
  return {
    carrierCode: normalizedText(body.carrier_code, 'carrier_code', 1, 40),
    carrierName: normalizedText(body.carrier_name, 'carrier_name', 1, 80),
    items,
    trackingNo: normalizedText(body.tracking_no, 'tracking_no', 1, 120),
  };
}

export function parseAdminCompleteOrderBody(value: unknown): AdminCompleteOrderInput {
  const body = closedBody(value, ['reason', 'completion_reason']);
  if (body.completion_reason !== 'ADMIN_FORCED') {
    return invalid('completion_reason is invalid');
  }
  return {
    completionReason: 'ADMIN_FORCED',
    reason: normalizedText(body.reason, 'reason', 2, 500),
  };
}

export function parseAdminLogisticsEventBody(value: unknown): AdminLogisticsEventInput {
  const discriminator = plainRecord(value, 'Request body').event_type;
  if (discriminator === 'STATUS') {
    const body = closedBody(
      value,
      ['event_type', 'status_code', 'description', 'occurred_at'],
      ['location'],
    );
    if (body.status_code !== 'IN_TRANSIT' && body.status_code !== 'DELIVERED') {
      return invalid('status_code is invalid');
    }
    return {
      description: normalizedText(body.description, 'description', 1, 300),
      eventType: 'STATUS',
      location: nullableLocation(body.location),
      occurredAt: normalizedTimestamp(body.occurred_at),
      statusCode: body.status_code,
    };
  }
  if (discriminator === 'TRACKING_CORRECTION') {
    const body = closedBody(
      value,
      [
        'event_type', 'carrier_code', 'carrier_name', 'tracking_no', 'reason', 'description',
        'occurred_at',
      ],
      ['location'],
    );
    return {
      carrierCode: normalizedText(body.carrier_code, 'carrier_code', 1, 40),
      carrierName: normalizedText(body.carrier_name, 'carrier_name', 1, 80),
      description: normalizedText(body.description, 'description', 1, 300),
      eventType: 'TRACKING_CORRECTION',
      location: nullableLocation(body.location),
      occurredAt: normalizedTimestamp(body.occurred_at),
      reason: normalizedText(body.reason, 'reason', 2, 500),
      trackingNo: normalizedText(body.tracking_no, 'tracking_no', 1, 120),
    };
  }
  return invalid('event_type is invalid');
}

export function parseAdminOrderListQuery(value: unknown): AdminOrderListQuery {
  const query = plainRecord(value, 'Query');
  const allowed = new Set([
    'page',
    'page_size',
    'order_no',
    'order_status',
    'payment_status',
    'refund_progress_status',
    'refund_processing_status',
    'fulfillment_status',
    'date_from',
    'date_to',
    'min_amount',
    'max_amount',
    'sort',
    'customer_id',
    'agent_id',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');

  const input: AdminOrderListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
    sort: closedEnum(query.sort, ORDER_SORTS, 'CREATED_DESC', 'sort') as AdminOrderSort,
  };
  if ((input.page - 1) * input.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }

  const agentId = optionalUlid(query.agent_id, 'agent_id');
  const customerId = optionalUlid(query.customer_id, 'customer_id');
  const fulfillmentStatus = closedEnum(
    query.fulfillment_status,
    FULFILLMENT_STATUSES,
    undefined,
    'fulfillment_status',
  );
  const maxAmount = money(query.max_amount, 'max_amount');
  const minAmount = money(query.min_amount, 'min_amount');
  const orderNo = normalizedOrderNo(query.order_no);
  const orderStatus = closedEnum(query.order_status, ORDER_STATUSES, undefined, 'order_status');
  const paymentStatus = closedEnum(query.payment_status, PAYMENT_STATUSES, undefined, 'payment_status');
  const refundProcessingStatus = closedEnum(
    query.refund_processing_status,
    REFUND_PROCESSING_STATUSES,
    undefined,
    'refund_processing_status',
  );
  const refundProgressStatus = closedEnum(
    query.refund_progress_status,
    REFUND_PROGRESS_STATUSES,
    undefined,
    'refund_progress_status',
  );

  if (agentId !== undefined) input.agentId = agentId;
  if (customerId !== undefined) input.customerId = customerId;
  if (fulfillmentStatus !== undefined) input.fulfillmentStatus = fulfillmentStatus;
  if (maxAmount !== undefined) input.maxAmount = maxAmount;
  if (minAmount !== undefined) input.minAmount = minAmount;
  if (orderNo !== undefined) input.orderNo = orderNo;
  if (orderStatus !== undefined) input.orderStatus = orderStatus;
  if (paymentStatus !== undefined) input.paymentStatus = paymentStatus;
  if (refundProcessingStatus !== undefined) input.refundProcessingStatus = refundProcessingStatus;
  if (refundProgressStatus !== undefined) input.refundProgressStatus = refundProgressStatus;
  if (query.date_from !== undefined) input.createdAtFrom = shanghaiStart(query.date_from, 'date_from', false);
  if (query.date_to !== undefined) input.createdAtToExclusive = shanghaiStart(query.date_to, 'date_to', true);

  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  if (minAmount !== undefined && maxAmount !== undefined && compareMoney(minAmount, maxAmount) > 0) {
    return invalid('min_amount must not be greater than max_amount');
  }
  return input;
}

export function parseAdminOrderEmptyQuery(value: unknown): void {
  const query = plainRecord(value, 'Query');
  if (Object.keys(query).length !== 0) return invalid('Query fields are invalid');
}

export function parseAdminFulfillmentAddressAccessHeaders(
  purposeValue: unknown,
  reasonValue: unknown,
): AdminFulfillmentAddressAccessHeaders {
  if (purposeValue !== 'ORDER_FULFILLMENT') return invalid('X-Access-Purpose is invalid');
  if (typeof reasonValue !== 'string') return invalid('X-Access-Reason is invalid');
  let decodedReason = reasonValue;
  if (reasonValue.startsWith("UTF-8''")) {
    try {
      decodedReason = decodeURIComponent(reasonValue.slice("UTF-8''".length));
    } catch {
      return invalid('X-Access-Reason is invalid');
    }
  }
  const reason = decodedReason.trim();
  const length = Array.from(reason).length;
  if (length < 5 || length > 200 || /\p{Cc}/u.test(reason)) {
    return invalid('X-Access-Reason is invalid');
  }
  return { purpose: 'ORDER_FULFILLMENT', reason };
}
