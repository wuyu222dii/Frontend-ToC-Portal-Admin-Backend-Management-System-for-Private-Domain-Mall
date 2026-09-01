import type { components } from '@qingxu/contracts';

import type {
  AdminAftersaleCommand,
  AdminAftersaleDetail,
  AdminAftersaleListItem,
  AdminAftersaleListResult,
  HighRiskPreview,
  ManualCompensationResult,
  RefundResult,
  RefundRetryResult,
  ReturnAddress,
} from './admin-aftersales-types';

type RecordValue = Record<string, unknown>;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const CONFIRMATION_HASH = /^[a-f0-9]{64}$/;
const ETAG = /^"[1-9][0-9]*"$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const AFTERSALE_TYPES = ['REFUND_ONLY', 'RETURN_REFUND'] as const;
const AFTERSALE_STATUSES = [
  'PENDING_REVIEW', 'REJECTED', 'REFUNDING', 'WAITING_RETURN', 'WAITING_RECEIPT',
  'RETURN_EXCEPTION', 'REFUNDING_AFTER_RETURN', 'REJECTED_AFTER_RETURN', 'REFUND_FAILED',
  'COMPLETED', 'CANCELLED',
] as const;
const ORDER_STATUSES = ['PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED'] as const;
const PAYMENT_STATUSES = ['UNPAID', 'PROCESSING', 'PAID'] as const;
const REFUND_PROGRESS = ['NONE', 'PARTIAL', 'FULL'] as const;
const REFUND_PROCESSING = ['IDLE', 'REFUNDING', 'FAILED'] as const;
const FULFILLMENT_STATUSES = [
  'NOT_STARTED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED',
] as const;
const PAYMENT_RESOLUTIONS = [
  'NORMAL', 'LATE_SUCCESS_REFUND_PENDING', 'LATE_SUCCESS_REFUNDED', 'MANUAL_REQUIRED',
] as const;

function invalid(path: string): never {
  throw new TypeError(`Invalid Admin aftersale response at ${path}`);
}

function record(value: unknown, path: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(path);
  return value as RecordValue;
}

function exact(value: RecordValue, required: readonly string[], path: string, optional: readonly string[] = []): void {
  const allowed = new Set([...required, ...optional]);
  if (required.some((key) => !Object.hasOwn(value, key)) || Object.keys(value).some((key) => !allowed.has(key))) {
    invalid(path);
  }
}

function string(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) return invalid(path);
  return value;
}

function nullableString(value: unknown, path: string): string | null {
  return value === null ? null : string(value, path);
}

function ulid(value: unknown, path: string): string {
  const result = string(value, path);
  return ULID.test(result) ? result : invalid(path);
}

function integer(value: unknown, path: string, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) return invalid(path);
  return Number(value);
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) return invalid(path);
  return value as Values[number];
}

function nullableOneOf<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] | null {
  return value === null ? null : oneOf(value, values, path);
}

function dateTime(value: unknown, path: string): string {
  const result = string(value, path);
  const match = RFC3339.exec(result);
  if (match === null) return invalid(path);
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (monthDays[month - 1] ?? 0) ||
    Number(hourText) > 23 || Number(minuteText) > 59 || Number(secondText) > 59 ||
    Number(offsetHourText ?? 0) > 23 || Number(offsetMinuteText ?? 0) > 59 ||
    !Number.isFinite(Date.parse(result))) return invalid(path);
  return result;
}

function nullableDateTime(value: unknown, path: string): string | null {
  return value === null ? null : dateTime(value, path);
}

function money(value: unknown, path: string): string {
  const result = string(value, path);
  return MONEY.test(result) ? result : invalid(path);
}

function positiveMoney(value: unknown, path: string): string {
  const result = string(value, path);
  return POSITIVE_MONEY.test(result) ? result : invalid(path);
}

function array<T>(value: unknown, path: string, read: (item: unknown, itemPath: string) => T): T[] {
  if (!Array.isArray(value)) return invalid(path);
  return value.map((item, index) => read(item, `${path}[${index}]`));
}

function unique(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) invalid(path);
}

function envelopeData(value: unknown): unknown {
  const response = record(value, 'response');
  exact(response, ['code', 'message', 'data', 'request_id'], 'response');
  oneOf(response.code, ['OK'] as const, 'response.code');
  oneOf(response.message, ['success'] as const, 'response.message');
  string(response.request_id, 'response.request_id');
  return response.data;
}

function assertExpectedId(actual: string, expected: string | undefined, path: string): void {
  if (expected !== undefined && actual !== expected) invalid(path);
}

function readSafeError(value: unknown, path: string): components['schemas']['SafeDomainErrorView'] {
  const result = record(value, path);
  exact(result, ['error_code', 'message', 'retryable', 'occurred_at'], path);
  if (typeof result.retryable !== 'boolean') return invalid(`${path}.retryable`);
  return {
    error_code: string(result.error_code, `${path}.error_code`),
    message: string(result.message, `${path}.message`),
    occurred_at: dateTime(result.occurred_at, `${path}.occurred_at`),
    retryable: result.retryable,
  };
}

function readOrderState(value: unknown, path: string): components['schemas']['OrderStateAxesView'] {
  const result = record(value, path);
  exact(result, [
    'order_status', 'payment_status', 'refund_progress_status', 'refund_processing_status',
    'fulfillment_status', 'close_reason', 'completion_reason', 'payment_resolution', 'display_status',
  ], path);
  return {
    close_reason: nullableOneOf(
      result.close_reason,
      ['USER_CANCELLED', 'PAYMENT_TIMEOUT', 'FULL_REFUND_BEFORE_SHIPMENT'] as const,
      `${path}.close_reason`,
    ),
    completion_reason: nullableOneOf(
      result.completion_reason,
      ['CUSTOMER_CONFIRMED', 'ADMIN_FORCED', 'FULL_REFUND_AFTER_SHIPMENT'] as const,
      `${path}.completion_reason`,
    ),
    display_status: string(result.display_status, `${path}.display_status`),
    fulfillment_status: oneOf(result.fulfillment_status, FULFILLMENT_STATUSES, `${path}.fulfillment_status`),
    order_status: oneOf(result.order_status, ORDER_STATUSES, `${path}.order_status`),
    payment_resolution: oneOf(result.payment_resolution, PAYMENT_RESOLUTIONS, `${path}.payment_resolution`),
    payment_status: oneOf(result.payment_status, PAYMENT_STATUSES, `${path}.payment_status`),
    refund_processing_status: oneOf(result.refund_processing_status, REFUND_PROCESSING, `${path}.refund_processing_status`),
    refund_progress_status: oneOf(result.refund_progress_status, REFUND_PROGRESS, `${path}.refund_progress_status`),
  };
}

function readInspectionLine(value: unknown, path: string): components['schemas']['ReturnInspectionLine'] {
  const result = record(value, path);
  exact(result, [
    'order_item_id', 'received_qty', 'approved_refund_qty', 'restock_qty', 'damaged_qty', 'scrap_qty',
    'return_to_customer_qty',
  ], path, ['note']);
  const received = integer(result.received_qty, `${path}.received_qty`, 0, 99);
  const approved = integer(result.approved_refund_qty, `${path}.approved_refund_qty`, 0, 99);
  const restock = integer(result.restock_qty, `${path}.restock_qty`, 0, 99);
  const damaged = integer(result.damaged_qty, `${path}.damaged_qty`, 0, 99);
  const scrap = integer(result.scrap_qty, `${path}.scrap_qty`, 0, 99);
  const returned = integer(result.return_to_customer_qty, `${path}.return_to_customer_qty`, 0, 99);
  if (approved + returned !== received || restock + damaged + scrap !== approved) invalid(path);
  const line: components['schemas']['ReturnInspectionLine'] = {
    approved_refund_qty: approved,
    damaged_qty: damaged,
    order_item_id: ulid(result.order_item_id, `${path}.order_item_id`),
    received_qty: received,
    restock_qty: restock,
    return_to_customer_qty: returned,
    scrap_qty: scrap,
  };
  if (Object.hasOwn(result, 'note')) line.note = nullableString(result.note, `${path}.note`);
  return line;
}

function readInspectionResolution(
  result: 'ABNORMAL' | 'PASS',
  resolutionValue: unknown,
  reasonValue: unknown,
  resolvedAtValue: unknown,
  path: string,
) {
  const resolution = nullableOneOf(
    resolutionValue,
    ['CONTINUE_REFUND', 'REJECT_AFTER_RETURN'] as const,
    `${path}.resolution`,
  );
  const resolutionReason = nullableString(reasonValue, `${path}.resolution_reason`);
  const resolvedAt = nullableDateTime(resolvedAtValue, `${path}.resolved_at`);
  if ((resolution === null) !== (resolutionReason === null) ||
    (resolution === null) !== (resolvedAt === null) ||
    (result === 'PASS' && resolution !== null)) {
    invalid(`${path}.resolution`);
  }
  return { resolution, resolutionReason, resolvedAt };
}

function readInspection(value: unknown, path: string): components['schemas']['ReturnInspectionDetailView'] {
  const result = record(value, path);
  exact(result, [
    'inspection_id', 'result', 'abnormal_reason', 'evidence_file_ids', 'items', 'inspected_by',
    'inspected_at', 'resolution', 'resolution_reason', 'resolved_at',
  ], path);
  const operator = record(result.inspected_by, `${path}.inspected_by`);
  exact(operator, ['account_id', 'display_name'], `${path}.inspected_by`);
  const inspectionResult = oneOf(result.result, ['PASS', 'ABNORMAL'] as const, `${path}.result`);
  const abnormalReason = nullableString(result.abnormal_reason, `${path}.abnormal_reason`);
  if ((inspectionResult === 'PASS' && abnormalReason !== null) ||
    (inspectionResult === 'ABNORMAL' && abnormalReason === null)) invalid(`${path}.abnormal_reason`);
  const evidence = array(result.evidence_file_ids, `${path}.evidence_file_ids`, ulid);
  unique(evidence, `${path}.evidence_file_ids`);
  const items = array(result.items, `${path}.items`, readInspectionLine);
  unique(items.map(({ order_item_id }) => order_item_id), `${path}.items`);
  const resolution = readInspectionResolution(
    inspectionResult,
    result.resolution,
    result.resolution_reason,
    result.resolved_at,
    path,
  );
  return {
    abnormal_reason: abnormalReason,
    evidence_file_ids: evidence,
    inspected_at: dateTime(result.inspected_at, `${path}.inspected_at`),
    inspected_by: {
      account_id: ulid(operator.account_id, `${path}.inspected_by.account_id`),
      display_name: string(operator.display_name, `${path}.inspected_by.display_name`),
    },
    inspection_id: ulid(result.inspection_id, `${path}.inspection_id`),
    items,
    resolution: resolution.resolution,
    resolution_reason: resolution.resolutionReason,
    resolved_at: resolution.resolvedAt,
    result: inspectionResult,
  };
}

function readCommandInspection(
  value: unknown,
  path: string,
): NonNullable<AdminAftersaleCommand['inspection']> {
  const result = record(value, path);
  exact(result, [
    'inspection_id', 'result', 'items', 'inspected_by', 'inspected_at', 'resolution',
    'resolution_reason', 'resolved_at',
  ], path, ['abnormal_reason', 'evidence_file_ids']);
  const operator = record(result.inspected_by, `${path}.inspected_by`);
  exact(operator, ['account_id', 'display_name'], `${path}.inspected_by`);
  const items = array(result.items, `${path}.items`, readInspectionLine);
  unique(items.map(({ order_item_id }) => order_item_id), `${path}.items`);
  const inspectionResult = oneOf(result.result, ['PASS', 'ABNORMAL'] as const, `${path}.result`);
  const resolution = readInspectionResolution(
    inspectionResult,
    result.resolution,
    result.resolution_reason,
    result.resolved_at,
    path,
  );
  const inspection: NonNullable<AdminAftersaleCommand['inspection']> = {
    inspected_at: dateTime(result.inspected_at, `${path}.inspected_at`),
    inspected_by: {
      account_id: ulid(operator.account_id, `${path}.inspected_by.account_id`),
      display_name: string(operator.display_name, `${path}.inspected_by.display_name`),
    },
    inspection_id: ulid(result.inspection_id, `${path}.inspection_id`),
    items,
    resolution: resolution.resolution,
    resolution_reason: resolution.resolutionReason,
    resolved_at: resolution.resolvedAt,
    result: inspectionResult,
  };
  if (Object.hasOwn(result, 'abnormal_reason')) {
    const abnormalReason = nullableString(result.abnormal_reason, `${path}.abnormal_reason`);
    if ((inspectionResult === 'PASS' && abnormalReason !== null) ||
      (inspectionResult === 'ABNORMAL' && abnormalReason === null)) {
      invalid(`${path}.abnormal_reason`);
    }
    inspection.abnormal_reason = abnormalReason;
  }
  if (Object.hasOwn(result, 'evidence_file_ids')) {
    const evidence = array(result.evidence_file_ids, `${path}.evidence_file_ids`, ulid);
    unique(evidence, `${path}.evidence_file_ids`);
    inspection.evidence_file_ids = evidence;
  }
  return inspection;
}

function readRefundAttempt(
  value: unknown,
  path: string,
): components['schemas']['RefundAttemptDetailView'] & { origin_type: 'AFTERSALE' } {
  const result = record(value, path);
  exact(result, [
    'refund_id', 'refund_no', 'attempt_no', 'origin_type', 'status', 'amount', 'last_error', 'created_at',
    'updated_at',
  ], path);
  return {
    amount: money(result.amount, `${path}.amount`),
    attempt_no: integer(result.attempt_no, `${path}.attempt_no`, 1),
    created_at: dateTime(result.created_at, `${path}.created_at`),
    last_error: result.last_error === null ? null : readSafeError(result.last_error, `${path}.last_error`),
    origin_type: oneOf(result.origin_type, ['AFTERSALE'] as const, `${path}.origin_type`),
    refund_id: ulid(result.refund_id, `${path}.refund_id`),
    refund_no: string(result.refund_no, `${path}.refund_no`),
    status: oneOf(result.status, ['INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED'] as const, `${path}.status`),
    updated_at: dateTime(result.updated_at, `${path}.updated_at`),
  };
}

function readAftersaleItem(value: unknown, path: string): components['schemas']['AftersaleItemDetailView'] {
  const result = record(value, path);
  exact(result, [
    'aftersale_item_id', 'order_item_id', 'product_name', 'sku_name', 'requested_quantity',
    'allocated_amount', 'reserved_quantity', 'reserved_amount', 'approved_refund_quantity',
    'refunded_quantity',
  ], path);
  return {
    aftersale_item_id: ulid(result.aftersale_item_id, `${path}.aftersale_item_id`),
    allocated_amount: money(result.allocated_amount, `${path}.allocated_amount`),
    approved_refund_quantity: result.approved_refund_quantity === null
      ? null
      : integer(result.approved_refund_quantity, `${path}.approved_refund_quantity`, 0, 99),
    order_item_id: ulid(result.order_item_id, `${path}.order_item_id`),
    product_name: string(result.product_name, `${path}.product_name`),
    refunded_quantity: integer(result.refunded_quantity, `${path}.refunded_quantity`, 0, 99),
    requested_quantity: integer(result.requested_quantity, `${path}.requested_quantity`, 1, 99),
    reserved_amount: money(result.reserved_amount, `${path}.reserved_amount`),
    reserved_quantity: integer(result.reserved_quantity, `${path}.reserved_quantity`, 0, 99),
    sku_name: string(result.sku_name, `${path}.sku_name`),
  };
}

function readReturnAddressSnapshot(value: unknown, path: string): components['schemas']['ReturnAddressSnapshotView'] {
  const result = record(value, path);
  exact(result, ['recipient_name', 'phone', 'province', 'city', 'district', 'detail'], path);
  return {
    city: string(result.city, `${path}.city`),
    detail: string(result.detail, `${path}.detail`),
    district: string(result.district, `${path}.district`),
    phone: string(result.phone, `${path}.phone`),
    province: string(result.province, `${path}.province`),
    recipient_name: string(result.recipient_name, `${path}.recipient_name`),
  };
}

function readReturnShipment(value: unknown, path: string): components['schemas']['ReturnShipmentDetailView'] {
  const result = record(value, path);
  exact(result, ['carrier_code', 'carrier_name', 'tracking_no', 'submitted_at'], path);
  return {
    carrier_code: string(result.carrier_code, `${path}.carrier_code`),
    carrier_name: string(result.carrier_name, `${path}.carrier_name`),
    submitted_at: dateTime(result.submitted_at, `${path}.submitted_at`),
    tracking_no: string(result.tracking_no, `${path}.tracking_no`),
  };
}

function readTimeline(value: unknown, path: string): components['schemas']['AftersaleTimelineEventView'] {
  const result = record(value, path);
  exact(result, ['event_id', 'event', 'from_status', 'to_status', 'operator_role', 'occurred_at'], path);
  return {
    event: string(result.event, `${path}.event`),
    event_id: ulid(result.event_id, `${path}.event_id`),
    from_status: nullableString(result.from_status, `${path}.from_status`),
    occurred_at: dateTime(result.occurred_at, `${path}.occurred_at`),
    operator_role: oneOf(
      result.operator_role,
      ['CUSTOMER', 'SUPER_ADMIN', 'SYSTEM', 'PAYMENT_PROVIDER'] as const,
      `${path}.operator_role`,
    ),
    to_status: string(result.to_status, `${path}.to_status`),
  };
}

function readInventoryImpact(value: unknown, path: string): components['schemas']['InventoryImpactView'] {
  const result = record(value, path);
  exact(result, ['sku_id', 'reserved_change', 'available_change', 'on_hand_change', 'reason'], path);
  return {
    available_change: integer(result.available_change, `${path}.available_change`, Number.MIN_SAFE_INTEGER),
    on_hand_change: integer(result.on_hand_change, `${path}.on_hand_change`, Number.MIN_SAFE_INTEGER),
    reason: string(result.reason, `${path}.reason`),
    reserved_change: integer(result.reserved_change, `${path}.reserved_change`, Number.MIN_SAFE_INTEGER),
    sku_id: ulid(result.sku_id, `${path}.sku_id`),
  };
}

function readCommissionImpact(value: unknown, path: string): components['schemas']['CommissionImpactSummaryView'] {
  const result = record(value, path);
  exact(result, [
    'commission_snapshot_id', 'order_item_id', 'original_commission', 'expected_remaining',
    'reversed_total', 'latest_state',
  ], path);
  return {
    commission_snapshot_id: ulid(result.commission_snapshot_id, `${path}.commission_snapshot_id`),
    expected_remaining: money(result.expected_remaining, `${path}.expected_remaining`),
    latest_state: oneOf(result.latest_state, ['NONE', 'EXPECTED', 'CANCELLED', 'AVAILABLE'] as const, `${path}.latest_state`),
    order_item_id: ulid(result.order_item_id, `${path}.order_item_id`),
    original_commission: money(result.original_commission, `${path}.original_commission`),
    reversed_total: money(result.reversed_total, `${path}.reversed_total`),
  };
}

function readListItem(value: unknown, path: string): AdminAftersaleListItem {
  const result = record(value, path);
  exact(result, [
    'aftersale_id', 'aftersale_no', 'order_id', 'type', 'status', 'requested_amount', 'customer_id',
    'customer_alias', 'agent_id', 'created_at', 'version',
  ], path);
  return {
    aftersale_id: ulid(result.aftersale_id, `${path}.aftersale_id`),
    aftersale_no: string(result.aftersale_no, `${path}.aftersale_no`),
    agent_id: result.agent_id === null ? null : ulid(result.agent_id, `${path}.agent_id`),
    created_at: dateTime(result.created_at, `${path}.created_at`),
    customer_alias: string(result.customer_alias, `${path}.customer_alias`),
    customer_id: ulid(result.customer_id, `${path}.customer_id`),
    order_id: ulid(result.order_id, `${path}.order_id`),
    requested_amount: positiveMoney(result.requested_amount, `${path}.requested_amount`),
    status: oneOf(result.status, AFTERSALE_STATUSES, `${path}.status`),
    type: oneOf(result.type, AFTERSALE_TYPES, `${path}.type`),
    version: integer(result.version, `${path}.version`, 1),
  };
}

export function decodeAdminAftersaleListResponse(value: unknown): AdminAftersaleListResult {
  const data = record(envelopeData(value), 'response.data');
  exact(data, ['items', 'pagination'], 'response.data');
  const items = array(data.items, 'response.data.items', readListItem);
  unique(items.map(({ aftersale_id }) => aftersale_id), 'response.data.items');
  const pagination = record(data.pagination, 'response.data.pagination');
  exact(pagination, ['page', 'page_size', 'total'], 'response.data.pagination');
  return {
    items,
    pagination: {
      page: integer(pagination.page, 'response.data.pagination.page', 1),
      pageSize: integer(pagination.page_size, 'response.data.pagination.page_size', 1, 100),
      total: integer(pagination.total, 'response.data.pagination.total'),
    },
  };
}

export function decodeAdminAftersaleDetailResponse(
  value: unknown,
  expectedAftersaleId?: string,
): AdminAftersaleDetail {
  const data = record(envelopeData(value), 'response.data');
  exact(data, [
    'aftersale_id', 'aftersale_no', 'order', 'customer', 'type', 'status', 'reason', 'items',
    'application_evidence_file_ids', 'return_address_snapshot', 'return_shipment', 'inspection',
    'refund_attempts', 'available_actions', 'timeline', 'errors', 'inventory_impact',
    'commission_impact', 'created_at', 'version',
  ], 'response.data');
  const aftersaleId = ulid(data.aftersale_id, 'response.data.aftersale_id');
  assertExpectedId(aftersaleId, expectedAftersaleId, 'response.data.aftersale_id');
  const order = record(data.order, 'response.data.order');
  exact(order, ['order_id', 'order_no', 'state'], 'response.data.order');
  const customer = record(data.customer, 'response.data.customer');
  exact(customer, ['customer_id', 'customer_alias', 'nickname_masked', 'phone_masked'], 'response.data.customer');
  const items = array(data.items, 'response.data.items', readAftersaleItem);
  unique(items.map(({ aftersale_item_id }) => aftersale_item_id), 'response.data.items');
  unique(items.map(({ order_item_id }) => order_item_id), 'response.data.items');
  const evidence = array(data.application_evidence_file_ids, 'response.data.application_evidence_file_ids', ulid);
  unique(evidence, 'response.data.application_evidence_file_ids');
  const refundAttempts = array(data.refund_attempts, 'response.data.refund_attempts', readRefundAttempt);
  unique(
    refundAttempts.map(({ refund_id, attempt_no }) => `${refund_id}:${attempt_no}`),
    'response.data.refund_attempts',
  );
  const actions = array(data.available_actions, 'response.data.available_actions', (action, path) => oneOf(
    action,
    ['APPROVE', 'REJECT', 'RECORD_INSPECTION', 'CONTINUE_REFUND', 'REJECT_AFTER_RETURN', 'CREATE_REFUND', 'RETRY_REFUND', 'VIEW_ORDER'] as const,
    path,
  ));
  unique(actions, 'response.data.available_actions');
  const timeline = array(data.timeline, 'response.data.timeline', readTimeline);
  unique(timeline.map(({ event_id }) => event_id), 'response.data.timeline');
  const inventoryImpact = array(data.inventory_impact, 'response.data.inventory_impact', readInventoryImpact);
  unique(inventoryImpact.map(({ sku_id }) => sku_id), 'response.data.inventory_impact');
  const commissionImpact = array(data.commission_impact, 'response.data.commission_impact', readCommissionImpact);
  unique(commissionImpact.map(({ commission_snapshot_id }) => commission_snapshot_id), 'response.data.commission_impact');
  return {
    aftersale_id: aftersaleId,
    aftersale_no: string(data.aftersale_no, 'response.data.aftersale_no'),
    application_evidence_file_ids: evidence,
    available_actions: actions,
    commission_impact: commissionImpact,
    created_at: dateTime(data.created_at, 'response.data.created_at'),
    customer: {
      customer_alias: string(customer.customer_alias, 'response.data.customer.customer_alias'),
      customer_id: ulid(customer.customer_id, 'response.data.customer.customer_id'),
      nickname_masked: nullableString(customer.nickname_masked, 'response.data.customer.nickname_masked'),
      phone_masked: nullableString(customer.phone_masked, 'response.data.customer.phone_masked'),
    },
    errors: array(data.errors, 'response.data.errors', readSafeError),
    inspection: data.inspection === null ? null : readInspection(data.inspection, 'response.data.inspection'),
    inventory_impact: inventoryImpact,
    items,
    order: {
      order_id: ulid(order.order_id, 'response.data.order.order_id'),
      order_no: string(order.order_no, 'response.data.order.order_no'),
      state: readOrderState(order.state, 'response.data.order.state'),
    },
    reason: string(data.reason, 'response.data.reason'),
    refund_attempts: refundAttempts,
    return_address_snapshot: data.return_address_snapshot === null
      ? null
      : readReturnAddressSnapshot(data.return_address_snapshot, 'response.data.return_address_snapshot'),
    return_shipment: data.return_shipment === null
      ? null
      : readReturnShipment(data.return_shipment, 'response.data.return_shipment'),
    status: oneOf(data.status, AFTERSALE_STATUSES, 'response.data.status'),
    timeline,
    type: oneOf(data.type, AFTERSALE_TYPES, 'response.data.type'),
    version: integer(data.version, 'response.data.version', 1),
  };
}

export function decodeAdminAftersaleCommandResponse(
  value: unknown,
  expectedAftersaleId?: string,
): AdminAftersaleCommand {
  const data = record(envelopeData(value), 'response.data');
  exact(data, [
    'aftersale_id', 'aftersale_no', 'order_id', 'type', 'status', 'items', 'inspection',
    'refund_id', 'version',
  ], 'response.data');
  const aftersaleId = ulid(data.aftersale_id, 'response.data.aftersale_id');
  assertExpectedId(aftersaleId, expectedAftersaleId, 'response.data.aftersale_id');
  const items = array(data.items, 'response.data.items', (value, path) => {
    const item = record(value, path);
    exact(item, [
      'aftersale_item_id', 'order_item_id', 'quantity', 'allocated_amount', 'reserved_quantity',
      'reserved_amount',
    ], path, ['approved_refund_qty']);
    const result: AdminAftersaleCommand['items'][number] = {
      aftersale_item_id: ulid(item.aftersale_item_id, `${path}.aftersale_item_id`),
      allocated_amount: money(item.allocated_amount, `${path}.allocated_amount`),
      order_item_id: ulid(item.order_item_id, `${path}.order_item_id`),
      quantity: integer(item.quantity, `${path}.quantity`, 1, 99),
      reserved_amount: money(item.reserved_amount, `${path}.reserved_amount`),
      reserved_quantity: integer(item.reserved_quantity, `${path}.reserved_quantity`, 0, 99),
    };
    if (Object.hasOwn(item, 'approved_refund_qty')) {
      result.approved_refund_qty = item.approved_refund_qty === null
        ? null
        : integer(item.approved_refund_qty, `${path}.approved_refund_qty`, 0, 99);
    }
    return result;
  });
  unique(items.map(({ aftersale_item_id }) => aftersale_item_id), 'response.data.items');
  unique(items.map(({ order_item_id }) => order_item_id), 'response.data.items');
  return {
    aftersale_id: aftersaleId,
    aftersale_no: string(data.aftersale_no, 'response.data.aftersale_no'),
    inspection: data.inspection === null ? null : readCommandInspection(data.inspection, 'response.data.inspection'),
    items,
    order_id: ulid(data.order_id, 'response.data.order_id'),
    refund_id: data.refund_id === null ? null : ulid(data.refund_id, 'response.data.refund_id'),
    status: oneOf(data.status, AFTERSALE_STATUSES, 'response.data.status'),
    type: oneOf(data.type, AFTERSALE_TYPES, 'response.data.type'),
    version: integer(data.version, 'response.data.version', 1),
  };
}

export function decodeHighRiskPreviewResponse(value: unknown): HighRiskPreview {
  const data = record(envelopeData(value), 'response.data');
  exact(data, ['preview_token', 'confirmation_hash', 'resource_etag', 'expires_at', 'impact'], 'response.data');
  const confirmationHash = string(data.confirmation_hash, 'response.data.confirmation_hash');
  if (!CONFIRMATION_HASH.test(confirmationHash)) invalid('response.data.confirmation_hash');
  const resourceEtag = string(data.resource_etag, 'response.data.resource_etag');
  if (!ETAG.test(resourceEtag)) invalid('response.data.resource_etag');
  const impact = record(data.impact, 'response.data.impact');
  exact(impact, ['affected_count', 'metrics', 'warnings'], 'response.data.impact');
  const metrics = array(impact.metrics, 'response.data.impact.metrics', (value, path) => {
    const metric = record(value, path);
    exact(metric, ['key', 'label', 'before', 'after'], path);
    return {
      after: nullableString(metric.after, `${path}.after`),
      before: nullableString(metric.before, `${path}.before`),
      key: string(metric.key, `${path}.key`),
      label: string(metric.label, `${path}.label`),
    };
  });
  unique(metrics.map(({ key }) => key), 'response.data.impact.metrics');
  return {
    confirmation_hash: confirmationHash,
    expires_at: dateTime(data.expires_at, 'response.data.expires_at'),
    impact: {
      affected_count: integer(impact.affected_count, 'response.data.impact.affected_count'),
      metrics,
      warnings: array(impact.warnings, 'response.data.impact.warnings', string),
    },
    preview_token: string(data.preview_token, 'response.data.preview_token'),
    resource_etag: resourceEtag,
  };
}

export function decodeRefundResponse(
  value: unknown,
  expectedRefundId?: string,
  expectedItems?: readonly { aftersale_item_id: string; quantity: number }[],
): RefundResult {
  const data = record(envelopeData(value), 'response.data');
  exact(data, ['refund_id', 'refund_no', 'origin_type', 'status', 'amount', 'items'], 'response.data');
  const refundId = ulid(data.refund_id, 'response.data.refund_id');
  assertExpectedId(refundId, expectedRefundId, 'response.data.refund_id');
  const items = array(data.items, 'response.data.items', (value, path) => {
    const item = record(value, path);
    exact(item, ['order_item_id', 'aftersale_item_id', 'quantity', 'server_allocated_amount'], path);
    return {
      aftersale_item_id: ulid(item.aftersale_item_id, `${path}.aftersale_item_id`),
      order_item_id: ulid(item.order_item_id, `${path}.order_item_id`),
      quantity: integer(item.quantity, `${path}.quantity`, 1, 99),
      server_allocated_amount: positiveMoney(item.server_allocated_amount, `${path}.server_allocated_amount`),
    };
  });
  if (items.length === 0) invalid('response.data.items');
  unique(items.map(({ aftersale_item_id }) => aftersale_item_id), 'response.data.items');
  unique(items.map(({ order_item_id }) => order_item_id), 'response.data.items');
  if (expectedItems !== undefined) {
    const expected = new Map(expectedItems.map((item) => [item.aftersale_item_id, item.quantity]));
    if (expected.size !== expectedItems.length || expected.size !== items.length ||
      items.some((item) => expected.get(item.aftersale_item_id) !== item.quantity)) {
      invalid('response.data.items');
    }
  }
  return {
    amount: positiveMoney(data.amount, 'response.data.amount'),
    items,
    origin_type: oneOf(data.origin_type, ['AFTERSALE'] as const, 'response.data.origin_type'),
    refund_id: refundId,
    refund_no: string(data.refund_no, 'response.data.refund_no'),
    status: oneOf(data.status, ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const, 'response.data.status'),
  };
}

export function decodeManualCompensationResponse(
  value: unknown,
  expectedOrderId?: string,
  expectedRefundId?: string,
  expectedOrderItemId?: string,
  expectedAmount?: string,
): ManualCompensationResult {
  const data = record(envelopeData(value), 'response.data');
  exact(data, [
    'compensation_id', 'compensation_no', 'origin_type', 'refund_id', 'refund_no', 'order_id',
    'order_item_id', 'status', 'amount', 'reserved_amount', 'refunded_amount', 'commission_reversal',
    'version',
  ], 'response.data');
  const orderId = ulid(data.order_id, 'response.data.order_id');
  const refundId = ulid(data.refund_id, 'response.data.refund_id');
  assertExpectedId(orderId, expectedOrderId, 'response.data.order_id');
  assertExpectedId(refundId, expectedRefundId, 'response.data.refund_id');
  const orderItemId = ulid(data.order_item_id, 'response.data.order_item_id');
  assertExpectedId(orderItemId, expectedOrderItemId, 'response.data.order_item_id');
  const amount = positiveMoney(data.amount, 'response.data.amount');
  if (expectedAmount !== undefined && amount !== expectedAmount) invalid('response.data.amount');
  return {
    amount,
    commission_reversal: money(data.commission_reversal, 'response.data.commission_reversal'),
    compensation_id: ulid(data.compensation_id, 'response.data.compensation_id'),
    compensation_no: string(data.compensation_no, 'response.data.compensation_no'),
    order_id: orderId,
    order_item_id: orderItemId,
    origin_type: oneOf(data.origin_type, ['MANUAL_COMPENSATION'] as const, 'response.data.origin_type'),
    refunded_amount: money(data.refunded_amount, 'response.data.refunded_amount'),
    refund_id: refundId,
    refund_no: string(data.refund_no, 'response.data.refund_no'),
    reserved_amount: money(data.reserved_amount, 'response.data.reserved_amount'),
    status: oneOf(data.status, ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'CANCELLED'] as const, 'response.data.status'),
    version: integer(data.version, 'response.data.version', 1),
  };
}

export function decodeRefundRetryResponse(value: unknown, expectedRefundId: string): RefundRetryResult {
  const response = record(value, 'response');
  exact(response, ['code', 'message', 'data', 'request_id'], 'response');
  oneOf(response.code, ['OK'] as const, 'response.code');
  oneOf(response.message, ['success'] as const, 'response.message');
  string(response.request_id, 'response.request_id');
  const data = record(response.data, 'response.data');
  if (data.origin_type === 'AFTERSALE') return decodeRefundResponse(value, expectedRefundId);
  if (data.origin_type === 'MANUAL_COMPENSATION') {
    return decodeManualCompensationResponse(value, undefined, expectedRefundId);
  }
  return invalid('response.data.origin_type');
}

export function decodeReturnAddressResponse(value: unknown): ReturnAddress {
  const data = record(envelopeData(value), 'response.data');
  exact(data, [
    'version_id', 'version_no', 'recipient_name', 'phone_masked', 'province', 'city', 'district',
    'detail_masked', 'effective_at', 'version',
  ], 'response.data');
  const versionNo = integer(data.version_no, 'response.data.version_no', 1);
  const version = integer(data.version, 'response.data.version', 1);
  if (version !== versionNo) invalid('response.data.version');
  return {
    city: string(data.city, 'response.data.city'),
    detail_masked: string(data.detail_masked, 'response.data.detail_masked'),
    district: string(data.district, 'response.data.district'),
    effective_at: dateTime(data.effective_at, 'response.data.effective_at'),
    phone_masked: string(data.phone_masked, 'response.data.phone_masked'),
    province: string(data.province, 'response.data.province'),
    recipient_name: string(data.recipient_name, 'response.data.recipient_name'),
    version,
    version_id: ulid(data.version_id, 'response.data.version_id'),
    version_no: versionNo,
  };
}
