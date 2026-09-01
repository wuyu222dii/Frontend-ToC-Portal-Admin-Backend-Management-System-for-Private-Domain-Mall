import type {
  StoreAftersale,
  StoreAftersaleDetail,
  StoreAftersaleList,
  StoreAftersaleListItem,
  StoreAftersalePreview,
} from '../types/store-aftersales';
import { StoreEnvelopeFormatError } from './store-client';

type RecordValue = Record<string, unknown>;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const moneyPattern = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const positiveMoneyPattern = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const confirmationHashPattern = /^[a-f0-9]{64}$/;
const rfc3339Pattern = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const aftersaleTypes = new Set(['REFUND_ONLY', 'RETURN_REFUND']);
const aftersaleStatuses = new Set([
  'PENDING_REVIEW', 'REJECTED', 'REFUNDING', 'WAITING_RETURN', 'WAITING_RECEIPT',
  'RETURN_EXCEPTION', 'REFUNDING_AFTER_RETURN', 'REJECTED_AFTER_RETURN', 'REFUND_FAILED',
  'COMPLETED', 'CANCELLED',
]);
const aftersaleActions = new Set(['CANCEL', 'SUBMIT_RETURN_SHIPMENT', 'VIEW_ORDER']);
const previewBlockers = new Set([
  'ORDER_NOT_ELIGIBLE', 'ITEM_UNAVAILABLE', 'AFTERSALE_QUOTA_EXCEEDED', 'EVIDENCE_UNAVAILABLE',
]);
const refundProgressStatuses = new Set(['NONE', 'PARTIAL', 'FULL']);
const refundProcessingStatuses = new Set(['IDLE', 'REFUNDING', 'FAILED']);
const inspectionResults = new Set(['PASS', 'ABNORMAL']);
const inspectionResolutions = new Set(['CONTINUE_REFUND', 'REJECT_AFTER_RETURN']);
const operatorRoles = new Set(['CUSTOMER', 'SUPER_ADMIN', 'SYSTEM', 'PAYMENT_PROVIDER']);
const refundStatuses = new Set(['INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED']);

function invalid(): never {
  throw new StoreEnvelopeFormatError();
}

function record(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const current = value as RecordValue;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (!requiredKeys.every((key) => Object.hasOwn(current, key)) ||
    Object.keys(current).some((key) => !allowed.has(key))) invalid();
  return current;
}

function text(value: unknown, minimum = 1, maximum = 2_048): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function ulid(value: unknown): string {
  const current = text(value, 26, 26);
  if (!ulidPattern.test(current)) invalid();
  return current;
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) invalid();
  return Number(value);
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<string>): T {
  const current = text(value);
  if (!values.has(current)) invalid();
  return current as T;
}

function nullable<T>(value: unknown, decoder: (input: unknown) => T): T | null {
  return value === null ? null : decoder(value);
}

function money(value: unknown, positive = false): string {
  const current = text(value);
  if (!(positive ? positiveMoneyPattern : moneyPattern).test(current)) invalid();
  return current;
}

function timestamp(value: unknown): string {
  const current = text(value);
  const match = rfc3339Pattern.exec(current);
  if (match === null) invalid();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (monthDays[month - 1] ?? 0) ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
    !Number.isFinite(Date.parse(current))) invalid();
  return current;
}

function uniqueStrings(values: unknown, allowed: ReadonlySet<string>): string[] {
  if (!Array.isArray(values)) invalid();
  const result = values.map((value) => enumValue(value, allowed));
  if (new Set(result).size !== result.length) invalid();
  return result;
}

function aftersaleIdentity(current: RecordValue): { aftersale_id: string; aftersale_no: string } {
  const aftersaleId = ulid(current.aftersale_id);
  const aftersaleNo = text(current.aftersale_no, 1, 32);
  if (aftersaleNo !== `AS${aftersaleId}`) invalid();
  return { aftersale_id: aftersaleId, aftersale_no: aftersaleNo };
}

function previewItem(value: unknown): StoreAftersalePreview['items'][number] {
  const current = record(value, [
    'order_item_id', 'requested_quantity', 'remaining_refundable_quantity',
    'allocated_amount', 'remaining_refundable_amount',
  ]);
  return {
    order_item_id: ulid(current.order_item_id),
    requested_quantity: integer(current.requested_quantity, 1, 99),
    remaining_refundable_quantity: integer(current.remaining_refundable_quantity, 0, 99),
    allocated_amount: money(current.allocated_amount),
    remaining_refundable_amount: money(current.remaining_refundable_amount),
  };
}

export function decodeStoreAftersalePreview(value: unknown): StoreAftersalePreview {
  const current = record(value, [
    'can_submit', 'blockers', 'items', 'requested_amount', 'preview_token',
    'confirmation_hash', 'expires_at',
  ]);
  if (!Array.isArray(current.items) || current.items.length < 1 || current.items.length > 100) invalid();
  const items = current.items.map(previewItem);
  if (new Set(items.map(({ order_item_id }) => order_item_id)).size !== items.length) invalid();
  const canSubmit = booleanValue(current.can_submit);
  const blockers = uniqueStrings(current.blockers, previewBlockers) as StoreAftersalePreview['blockers'];
  const previewToken = nullable(current.preview_token, (entry) => text(entry, 16, 512));
  const confirmationHash = nullable(current.confirmation_hash, (entry) => {
    const hash = text(entry, 64, 64);
    if (!confirmationHashPattern.test(hash)) invalid();
    return hash;
  });
  const expiresAt = nullable(current.expires_at, timestamp);
  if ((canSubmit && (blockers.length !== 0 || previewToken === null ||
      confirmationHash === null || expiresAt === null)) ||
    (!canSubmit && (blockers.length === 0 || previewToken !== null ||
      confirmationHash !== null || expiresAt !== null))) invalid();
  return {
    can_submit: canSubmit,
    blockers,
    items,
    requested_amount: money(current.requested_amount),
    preview_token: previewToken,
    confirmation_hash: confirmationHash,
    expires_at: expiresAt,
  } as StoreAftersalePreview;
}

function optionalNullableInteger(
  current: RecordValue,
  key: string,
): number | null | undefined {
  if (!Object.hasOwn(current, key)) return undefined;
  return nullable(current[key], (entry) => integer(entry));
}

function summaryItem(value: unknown): StoreAftersale['items'][number] {
  const optional = [
    'inspection_result', 'received_qty', 'restock_qty', 'damaged_qty', 'scrap_qty',
    'return_to_customer_qty',
  ];
  const current = record(value, [
    'aftersale_item_id', 'order_item_id', 'quantity', 'allocated_amount', 'approved_refund_qty',
  ], optional);
  const result: StoreAftersale['items'][number] = {
    aftersale_item_id: ulid(current.aftersale_item_id),
    order_item_id: ulid(current.order_item_id),
    quantity: integer(current.quantity, 1),
    allocated_amount: money(current.allocated_amount),
    approved_refund_qty: nullable(current.approved_refund_qty, (entry) => integer(entry)),
  };
  if (Object.hasOwn(current, 'inspection_result')) {
    result.inspection_result = nullable(
      current.inspection_result,
      (entry) => enumValue(entry, inspectionResults),
    );
  }
  for (const key of [
    'received_qty', 'restock_qty', 'damaged_qty', 'scrap_qty', 'return_to_customer_qty',
  ] as const) {
    const decoded = optionalNullableInteger(current, key);
    if (decoded !== undefined) result[key] = decoded;
  }
  return result;
}

export function decodeStoreAftersale(value: unknown): StoreAftersale {
  const current = record(value, [
    'aftersale_id', 'aftersale_no', 'type', 'status', 'items',
  ], ['timeline']);
  if (!Array.isArray(current.items) || current.items.length < 1) invalid();
  const items = current.items.map(summaryItem);
  if (new Set(items.map(({ aftersale_item_id }) => aftersale_item_id)).size !== items.length ||
    new Set(items.map(({ order_item_id }) => order_item_id)).size !== items.length) invalid();
  const result: StoreAftersale = {
    ...aftersaleIdentity(current),
    type: enumValue(current.type, aftersaleTypes),
    status: enumValue(current.status, aftersaleStatuses),
    items,
  };
  if (Object.hasOwn(current, 'timeline')) {
    if (!Array.isArray(current.timeline)) invalid();
    result.timeline = current.timeline.map((value) => {
      const event = record(value, ['event', 'occurred_at']);
      return { event: text(event.event), occurred_at: timestamp(event.occurred_at) };
    });
  }
  return result;
}

function listItem(value: unknown): StoreAftersaleListItem {
  const current = record(value, [
    'aftersale_id', 'aftersale_no', 'order_id', 'type', 'status', 'refund_progress_status',
    'refund_processing_status', 'available_actions', 'requested_amount', 'created_at',
  ]);
  return {
    ...aftersaleIdentity(current),
    order_id: ulid(current.order_id),
    type: enumValue(current.type, aftersaleTypes),
    status: enumValue(current.status, aftersaleStatuses),
    refund_progress_status: enumValue(current.refund_progress_status, refundProgressStatuses),
    refund_processing_status: enumValue(current.refund_processing_status, refundProcessingStatuses),
    available_actions: uniqueStrings(current.available_actions, aftersaleActions) as StoreAftersaleListItem['available_actions'],
    requested_amount: money(current.requested_amount, true),
    created_at: timestamp(current.created_at),
  };
}

export function decodeStoreAftersaleList(value: unknown): StoreAftersaleList {
  const current = record(value, ['items', 'pagination']);
  if (!Array.isArray(current.items)) invalid();
  const items = current.items.map(listItem);
  if (new Set(items.map(({ aftersale_id }) => aftersale_id)).size !== items.length) invalid();
  const pagination = record(current.pagination, ['page', 'page_size', 'total']);
  return {
    items,
    pagination: {
      page: integer(pagination.page, 1),
      page_size: integer(pagination.page_size, 1, 100),
      total: integer(pagination.total),
    },
  };
}

function safeDomainError(value: unknown): StoreAftersaleDetail['errors'][number] {
  const current = record(value, ['error_code', 'message', 'retryable', 'occurred_at']);
  return {
    error_code: text(current.error_code),
    message: text(current.message),
    retryable: booleanValue(current.retryable),
    occurred_at: timestamp(current.occurred_at),
  };
}

function refundAttempt(value: unknown): StoreAftersaleDetail['refund_attempts'][number] {
  const current = record(value, [
    'refund_id', 'refund_no', 'attempt_no', 'origin_type', 'status', 'amount',
    'last_error', 'created_at', 'updated_at',
  ]);
  if (current.origin_type !== 'AFTERSALE') invalid();
  return {
    refund_id: ulid(current.refund_id),
    refund_no: text(current.refund_no),
    attempt_no: integer(current.attempt_no, 1),
    origin_type: 'AFTERSALE',
    status: enumValue(current.status, refundStatuses),
    amount: money(current.amount),
    last_error: nullable(current.last_error, safeDomainError),
    created_at: timestamp(current.created_at),
    updated_at: timestamp(current.updated_at),
  };
}

function detailItem(value: unknown): StoreAftersaleDetail['items'][number] {
  const current = record(value, [
    'aftersale_item_id', 'order_item_id', 'product_name', 'sku_name', 'requested_quantity',
    'allocated_amount', 'reserved_quantity', 'reserved_amount', 'approved_refund_quantity',
    'refunded_quantity',
  ]);
  return {
    aftersale_item_id: ulid(current.aftersale_item_id),
    order_item_id: ulid(current.order_item_id),
    product_name: text(current.product_name),
    sku_name: text(current.sku_name),
    requested_quantity: integer(current.requested_quantity, 1),
    allocated_amount: money(current.allocated_amount),
    reserved_quantity: integer(current.reserved_quantity),
    reserved_amount: money(current.reserved_amount),
    approved_refund_quantity: nullable(current.approved_refund_quantity, (entry) => integer(entry)),
    refunded_quantity: integer(current.refunded_quantity),
  };
}

function returnAddress(value: unknown): NonNullable<StoreAftersaleDetail['return_address']> {
  const current = record(value, [
    'recipient_name', 'phone', 'province', 'city', 'district', 'detail',
  ]);
  return {
    recipient_name: text(current.recipient_name),
    phone: text(current.phone),
    province: text(current.province),
    city: text(current.city),
    district: text(current.district),
    detail: text(current.detail),
  };
}

function returnShipment(value: unknown): NonNullable<StoreAftersaleDetail['return_shipment']> {
  const current = record(value, ['carrier_code', 'carrier_name', 'tracking_no', 'submitted_at']);
  const carrierCode = text(current.carrier_code, 1, 40);
  const carrierName = text(current.carrier_name, 1, 80);
  const trackingNo = text(current.tracking_no, 1, 120);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(carrierCode) ||
    carrierName.trim().length === 0 || hasControlCharacter(carrierName) ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(trackingNo)) invalid();
  return {
    carrier_code: carrierCode,
    carrier_name: carrierName,
    tracking_no: trackingNo,
    submitted_at: timestamp(current.submitted_at),
  };
}

function inspection(value: unknown): NonNullable<StoreAftersaleDetail['inspection']> {
  const current = record(value, [
    'inspection_id', 'result', 'abnormal_reason', 'evidence_file_ids', 'items', 'inspected_at',
    'resolution', 'resolution_reason', 'resolved_at',
  ]);
  if (!Array.isArray(current.evidence_file_ids) || current.evidence_file_ids.length > 9 ||
    !Array.isArray(current.items) || current.items.length < 1) invalid();
  const evidenceFileIds = current.evidence_file_ids.map(ulid);
  if (new Set(evidenceFileIds).size !== evidenceFileIds.length) invalid();
  const items = current.items.map((value) => {
    const item = record(value, [
      'order_item_id', 'received_qty', 'approved_refund_qty', 'restock_qty', 'damaged_qty',
      'scrap_qty', 'return_to_customer_qty',
    ]);
    const receivedQty = integer(item.received_qty);
    const approvedRefundQty = integer(item.approved_refund_qty);
    const restockQty = integer(item.restock_qty);
    const damagedQty = integer(item.damaged_qty);
    const scrapQty = integer(item.scrap_qty);
    const returnToCustomerQty = integer(item.return_to_customer_qty);
    if (approvedRefundQty + returnToCustomerQty !== receivedQty ||
      restockQty + damagedQty + scrapQty !== approvedRefundQty) invalid();
    return {
      order_item_id: ulid(item.order_item_id),
      received_qty: receivedQty,
      approved_refund_qty: approvedRefundQty,
      restock_qty: restockQty,
      damaged_qty: damagedQty,
      scrap_qty: scrapQty,
      return_to_customer_qty: returnToCustomerQty,
    };
  });
  if (new Set(items.map(({ order_item_id }) => order_item_id)).size !== items.length) invalid();
  const result = enumValue<'PASS' | 'ABNORMAL'>(current.result, inspectionResults);
  const abnormalReason = nullable(current.abnormal_reason, text);
  if ((result === 'PASS' && abnormalReason !== null) ||
    (result === 'ABNORMAL' && abnormalReason === null)) invalid();
  const resolution = nullable(
    current.resolution,
    (entry) => enumValue<'CONTINUE_REFUND' | 'REJECT_AFTER_RETURN'>(entry, inspectionResolutions),
  );
  const resolutionReason = nullable(current.resolution_reason, text);
  const resolvedAt = nullable(current.resolved_at, timestamp);
  if ((resolution === null) !== (resolutionReason === null) ||
    (resolution === null) !== (resolvedAt === null) ||
    (result === 'PASS' && resolution !== null)) invalid();
  return {
    inspection_id: ulid(current.inspection_id),
    result,
    abnormal_reason: abnormalReason,
    evidence_file_ids: evidenceFileIds,
    items,
    inspected_at: timestamp(current.inspected_at),
    resolution,
    resolution_reason: resolutionReason,
    resolved_at: resolvedAt,
  };
}

function timelineEvent(value: unknown): StoreAftersaleDetail['timeline'][number] {
  const current = record(value, [
    'event_id', 'event', 'from_status', 'to_status', 'operator_role', 'occurred_at',
  ]);
  return {
    event_id: ulid(current.event_id),
    event: text(current.event),
    from_status: nullable(current.from_status, (entry) => enumValue(entry, aftersaleStatuses)),
    to_status: enumValue(current.to_status, aftersaleStatuses),
    operator_role: enumValue(current.operator_role, operatorRoles),
    occurred_at: timestamp(current.occurred_at),
  } as StoreAftersaleDetail['timeline'][number];
}

function assertStableTimeline(events: readonly StoreAftersaleDetail['timeline'][number][]): void {
  const ids = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined || ids.has(event.event_id)) invalid();
    ids.add(event.event_id);
    const previous = events[index - 1];
    if (previous !== undefined) {
      const previousTime = Date.parse(previous.occurred_at);
      const currentTime = Date.parse(event.occurred_at);
      if (previousTime > currentTime ||
        (previousTime === currentTime && previous.event_id > event.event_id)) invalid();
    }
  }
}

export function decodeStoreAftersaleDetail(value: unknown): StoreAftersaleDetail {
  const current = record(value, [
    'aftersale_id', 'aftersale_no', 'order', 'type', 'status', 'reason', 'items',
    'return_address', 'return_shipment', 'inspection', 'refund_attempts', 'available_actions',
    'timeline', 'errors', 'created_at', 'version',
  ]);
  if (!Array.isArray(current.items) || current.items.length < 1 ||
    !Array.isArray(current.refund_attempts) || !Array.isArray(current.timeline) ||
    !Array.isArray(current.errors)) invalid();
  const items = current.items.map(detailItem);
  if (new Set(items.map(({ aftersale_item_id }) => aftersale_item_id)).size !== items.length ||
    new Set(items.map(({ order_item_id }) => order_item_id)).size !== items.length) invalid();
  const refundAttempts = current.refund_attempts.map(refundAttempt);
  if (new Set(refundAttempts.map(({ refund_id, attempt_no }) => `${refund_id}:${attempt_no}`)).size !==
    refundAttempts.length) invalid();
  const timeline = current.timeline.map(timelineEvent);
  assertStableTimeline(timeline);
  const order = record(current.order, [
    'order_id', 'order_no', 'display_status', 'payable_amount', 'paid_at',
  ]);
  const orderId = ulid(order.order_id);
  const orderNo = text(order.order_no, 28, 28);
  if (orderNo !== `QX${orderId}`) invalid();
  return {
    ...aftersaleIdentity(current),
    order: {
      order_id: orderId,
      order_no: orderNo,
      display_status: text(order.display_status),
      payable_amount: money(order.payable_amount),
      paid_at: nullable(order.paid_at, timestamp),
    },
    type: enumValue(current.type, aftersaleTypes),
    status: enumValue(current.status, aftersaleStatuses),
    reason: text(current.reason),
    items,
    return_address: nullable(current.return_address, returnAddress),
    return_shipment: nullable(current.return_shipment, returnShipment),
    inspection: nullable(current.inspection, inspection),
    refund_attempts: refundAttempts,
    available_actions: uniqueStrings(current.available_actions, aftersaleActions) as StoreAftersaleDetail['available_actions'],
    timeline,
    errors: current.errors.map(safeDomainError),
    created_at: timestamp(current.created_at),
    version: integer(current.version, 1),
  };
}
