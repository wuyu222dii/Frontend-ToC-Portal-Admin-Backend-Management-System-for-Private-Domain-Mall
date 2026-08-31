import type { components } from '@qingxu/contracts';

import type {
  AdminFulfillmentAddress,
  AdminOrderCommandResult,
  AdminOrderDetail,
  AdminOrderListItem,
  AdminOrderListResult,
  LogisticsView,
  ShipmentView,
} from '../types/orders';

type RecordValue = Record<string, unknown>;

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;

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
const SHIPMENT_STATUSES = ['SHIPPED', 'IN_TRANSIT', 'DELIVERED'] as const;

function invalid(path: string): never {
  throw new Error(`Invalid admin order response at ${path}`);
}

function record(value: unknown, path: string): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(path);
  return value as RecordValue;
}

function exact(
  value: RecordValue,
  required: readonly string[],
  path: string,
  optional: readonly string[] = [],
): void {
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

function integer(
  value: unknown,
  path: string,
  minimum = 0,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) return invalid(path);
  return Number(value);
}

function dateTime(value: unknown, path: string): string {
  const result = string(value, path);
  const match = RFC3339.exec(result);
  if (match === null) return invalid(path);
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

function array<T>(value: unknown, path: string, read: (item: unknown, itemPath: string) => T): T[] {
  if (!Array.isArray(value)) return invalid(path);
  return value.map((item, index) => read(item, `${path}[${index}]`));
}

function envelopeData(value: unknown, path = 'response'): unknown {
  const response = record(value, path);
  exact(response, ['code', 'message', 'data', 'request_id'], path);
  oneOf(response.code, ['OK'] as const, `${path}.code`);
  oneOf(response.message, ['success'] as const, `${path}.message`);
  string(response.request_id, `${path}.request_id`);
  return response.data;
}

function readAmounts(value: unknown, path: string): components['schemas']['OrderAmountsDetailView'] {
  const result = record(value, path);
  exact(result, ['goods', 'shipping', 'payable', 'paid', 'refunded'], path);
  return {
    goods: money(result.goods, `${path}.goods`),
    paid: money(result.paid, `${path}.paid`),
    payable: money(result.payable, `${path}.payable`),
    refunded: money(result.refunded, `${path}.refunded`),
    shipping: money(result.shipping, `${path}.shipping`),
  };
}

function readOrderItem(value: unknown, path: string): components['schemas']['OrderItemView'] {
  const result = record(value, path);
  exact(result, [
    'order_item_id', 'product_id', 'sku_id', 'product_name', 'sku_name', 'unit_price', 'quantity',
    'line_amount', 'refunded_quantity', 'reserved_aftersale_quantity', 'shipped_quantity',
  ], path);
  return {
    line_amount: money(result.line_amount, `${path}.line_amount`),
    order_item_id: ulid(result.order_item_id, `${path}.order_item_id`),
    product_id: ulid(result.product_id, `${path}.product_id`),
    product_name: string(result.product_name, `${path}.product_name`),
    quantity: integer(result.quantity, `${path}.quantity`, 1),
    refunded_quantity: integer(result.refunded_quantity, `${path}.refunded_quantity`),
    reserved_aftersale_quantity: integer(result.reserved_aftersale_quantity, `${path}.reserved_aftersale_quantity`),
    shipped_quantity: integer(result.shipped_quantity, `${path}.shipped_quantity`),
    sku_id: ulid(result.sku_id, `${path}.sku_id`),
    sku_name: string(result.sku_name, `${path}.sku_name`),
    unit_price: money(result.unit_price, `${path}.unit_price`),
  };
}

function readLogisticsEvent(value: unknown, path: string): components['schemas']['LogisticsEventView'] {
  const result = record(value, path);
  exact(result, ['event_id', 'event_key', 'event_type', 'description', 'occurred_at'], path, [
    'status_code', 'carrier_code', 'carrier_name', 'tracking_no', 'reason', 'location',
  ]);
  const eventType = oneOf(result.event_type, ['STATUS', 'TRACKING_CORRECTION'] as const, `${path}.event_type`);
  const event = {
    description: string(result.description, `${path}.description`),
    event_id: ulid(result.event_id, `${path}.event_id`),
    event_key: string(result.event_key, `${path}.event_key`),
    event_type: eventType,
    occurred_at: dateTime(result.occurred_at, `${path}.occurred_at`),
  } as components['schemas']['LogisticsEventView'];
  if (Object.hasOwn(result, 'status_code')) {
    event.status_code = nullableOneOf(result.status_code, SHIPMENT_STATUSES, `${path}.status_code`);
  }
  for (const key of ['carrier_code', 'carrier_name', 'tracking_no', 'reason', 'location'] as const) {
    if (Object.hasOwn(result, key)) event[key] = nullableString(result[key], `${path}.${key}`);
  }
  return event;
}

function assertStableEvents(
  events: readonly components['schemas']['LogisticsEventView'][],
  path: string,
): void {
  const eventIds = new Set<string>();
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event === undefined || eventIds.has(event.event_id)) invalid(path);
    eventIds.add(event.event_id);
    const previous = events[index - 1];
    if (previous === undefined) continue;
    const previousTime = Date.parse(previous.occurred_at);
    const eventTime = Date.parse(event.occurred_at);
    if (previousTime > eventTime || (previousTime === eventTime && previous.event_id >= event.event_id)) {
      invalid(path);
    }
  }
}

function readShipmentItem(value: unknown, path: string): components['schemas']['ShipmentItemView'] {
  const result = record(value, path);
  exact(result, ['order_item_id', 'quantity'], path);
  return {
    order_item_id: ulid(result.order_item_id, `${path}.order_item_id`),
    quantity: integer(result.quantity, `${path}.quantity`, 1),
  };
}

function readShipment(value: unknown, path: string): ShipmentView {
  const result = record(value, path);
  exact(result, [
    'shipment_id', 'order_id', 'status', 'carrier_code', 'carrier_name', 'tracking_no', 'shipped_at',
    'items', 'version',
  ], path, ['delivered_at']);
  const items = array(result.items, `${path}.items`, readShipmentItem);
  if (items.length < 1 || new Set(items.map(({ order_item_id }) => order_item_id)).size !== items.length) {
    invalid(`${path}.items`);
  }
  const shipment: ShipmentView = {
    carrier_code: string(result.carrier_code, `${path}.carrier_code`),
    carrier_name: string(result.carrier_name, `${path}.carrier_name`),
    items,
    order_id: ulid(result.order_id, `${path}.order_id`),
    shipment_id: ulid(result.shipment_id, `${path}.shipment_id`),
    shipped_at: dateTime(result.shipped_at, `${path}.shipped_at`),
    status: oneOf(result.status, SHIPMENT_STATUSES, `${path}.status`),
    tracking_no: string(result.tracking_no, `${path}.tracking_no`),
    version: integer(result.version, `${path}.version`, 1),
  };
  if (Object.hasOwn(result, 'delivered_at')) {
    shipment.delivered_at = nullableDateTime(result.delivered_at, `${path}.delivered_at`);
  }
  return shipment;
}

function readPackageItem(value: unknown, path: string): components['schemas']['OrderPackageItemView'] {
  const result = record(value, path);
  exact(result, ['order_item_id', 'sku_id', 'product_name', 'sku_name', 'quantity'], path);
  return {
    order_item_id: ulid(result.order_item_id, `${path}.order_item_id`),
    product_name: string(result.product_name, `${path}.product_name`),
    quantity: integer(result.quantity, `${path}.quantity`, 1),
    sku_id: ulid(result.sku_id, `${path}.sku_id`),
    sku_name: string(result.sku_name, `${path}.sku_name`),
  };
}

function readPackage(value: unknown, path: string): components['schemas']['OrderPackageDetailView'] {
  const result = record(value, path);
  exact(result, [
    'shipment_id', 'carrier_name', 'tracking_no', 'status', 'items', 'events', 'shipped_at', 'delivered_at',
    'version',
  ], path);
  const items = array(result.items, `${path}.items`, readPackageItem);
  if (items.length < 1 || new Set(items.map(({ order_item_id }) => order_item_id)).size !== items.length) {
    invalid(`${path}.items`);
  }
  const events = array(result.events, `${path}.events`, readLogisticsEvent);
  assertStableEvents(events, `${path}.events`);
  return {
    carrier_name: string(result.carrier_name, `${path}.carrier_name`),
    delivered_at: nullableDateTime(result.delivered_at, `${path}.delivered_at`),
    events,
    items,
    shipment_id: ulid(result.shipment_id, `${path}.shipment_id`),
    shipped_at: nullableDateTime(result.shipped_at, `${path}.shipped_at`),
    status: oneOf(result.status, SHIPMENT_STATUSES, `${path}.status`),
    tracking_no: string(result.tracking_no, `${path}.tracking_no`),
    version: integer(result.version, `${path}.version`, 1),
  };
}

function readTimeline(value: unknown, path: string): components['schemas']['OrderStateTimelineEventView'] {
  const result = record(value, path);
  exact(result, ['event_id', 'axis', 'event', 'from_status', 'to_status', 'occurred_at'], path);
  return {
    axis: oneOf(result.axis, ['ORDER', 'PAYMENT', 'REFUND', 'FULFILLMENT', 'AFTERSALE'] as const, `${path}.axis`),
    event: string(result.event, `${path}.event`),
    event_id: string(result.event_id, `${path}.event_id`),
    from_status: nullableString(result.from_status, `${path}.from_status`),
    occurred_at: dateTime(result.occurred_at, `${path}.occurred_at`),
    to_status: string(result.to_status, `${path}.to_status`),
  };
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

function readPaymentAttempt(value: unknown, path: string): components['schemas']['PaymentAttemptDetailView'] {
  const result = record(value, path);
  exact(result, [
    'payment_attempt_id', 'intent_no', 'status', 'amount', 'provider_transaction_id_masked',
    'last_error', 'created_at', 'updated_at',
  ], path);
  return {
    amount: money(result.amount, `${path}.amount`),
    created_at: dateTime(result.created_at, `${path}.created_at`),
    intent_no: string(result.intent_no, `${path}.intent_no`),
    last_error: result.last_error === null ? null : readSafeError(result.last_error, `${path}.last_error`),
    payment_attempt_id: ulid(result.payment_attempt_id, `${path}.payment_attempt_id`),
    provider_transaction_id_masked: nullableString(
      result.provider_transaction_id_masked,
      `${path}.provider_transaction_id_masked`,
    ),
    status: oneOf(
      result.status,
      ['INITIATED', 'SUCCEEDED', 'SUCCEEDED_LATE', 'FAILED', 'CANCELLED'] as const,
      `${path}.status`,
    ),
    updated_at: dateTime(result.updated_at, `${path}.updated_at`),
  };
}

function readRefundAttempt(value: unknown, path: string): components['schemas']['RefundAttemptDetailView'] {
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
    origin_type: oneOf(
      result.origin_type,
      ['AFTERSALE', 'LATE_PAYMENT', 'MANUAL_COMPENSATION'] as const,
      `${path}.origin_type`,
    ),
    refund_id: ulid(result.refund_id, `${path}.refund_id`),
    refund_no: string(result.refund_no, `${path}.refund_no`),
    status: oneOf(result.status, ['INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED'] as const, `${path}.status`),
    updated_at: dateTime(result.updated_at, `${path}.updated_at`),
  };
}

function readAftersale(value: unknown, path: string): components['schemas']['OrderAftersaleSummaryView'] {
  const result = record(value, path);
  exact(result, ['aftersale_id', 'aftersale_no', 'type', 'status', 'requested_amount', 'created_at'], path);
  return {
    aftersale_id: ulid(result.aftersale_id, `${path}.aftersale_id`),
    aftersale_no: string(result.aftersale_no, `${path}.aftersale_no`),
    created_at: dateTime(result.created_at, `${path}.created_at`),
    requested_amount: money(result.requested_amount, `${path}.requested_amount`),
    status: string(result.status, `${path}.status`),
    type: oneOf(result.type, ['REFUND_ONLY', 'RETURN_REFUND'] as const, `${path}.type`),
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

function readListItem(value: unknown, path: string): AdminOrderListItem {
  const result = record(value, path);
  exact(result, [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'display_status', 'payable_amount', 'customer_id',
    'customer_alias', 'agent_id', 'agent_name', 'created_at', 'version',
  ], path, ['recipient_phone_masked']);
  const item: AdminOrderListItem = {
    agent_id: result.agent_id === null ? null : ulid(result.agent_id, `${path}.agent_id`),
    agent_name: nullableString(result.agent_name, `${path}.agent_name`),
    created_at: dateTime(result.created_at, `${path}.created_at`),
    customer_alias: string(result.customer_alias, `${path}.customer_alias`),
    customer_id: ulid(result.customer_id, `${path}.customer_id`),
    display_status: string(result.display_status, `${path}.display_status`),
    fulfillment_status: oneOf(result.fulfillment_status, FULFILLMENT_STATUSES, `${path}.fulfillment_status`),
    order_id: ulid(result.order_id, `${path}.order_id`),
    order_no: string(result.order_no, `${path}.order_no`),
    order_status: oneOf(result.order_status, ORDER_STATUSES, `${path}.order_status`),
    payable_amount: money(result.payable_amount, `${path}.payable_amount`),
    payment_status: oneOf(result.payment_status, PAYMENT_STATUSES, `${path}.payment_status`),
    refund_processing_status: oneOf(result.refund_processing_status, REFUND_PROCESSING, `${path}.refund_processing_status`),
    refund_progress_status: oneOf(result.refund_progress_status, REFUND_PROGRESS, `${path}.refund_progress_status`),
    version: integer(result.version, `${path}.version`, 1),
  };
  if (Object.hasOwn(result, 'recipient_phone_masked')) {
    item.recipient_phone_masked = nullableString(result.recipient_phone_masked, `${path}.recipient_phone_masked`);
  }
  return item;
}

export function decodeAdminOrderListResponse(value: unknown): AdminOrderListResult {
  const data = record(envelopeData(value), 'response.data');
  exact(data, ['items', 'pagination'], 'response.data');
  const pagination = record(data.pagination, 'response.data.pagination');
  exact(pagination, ['page', 'page_size', 'total'], 'response.data.pagination');
  return {
    items: array(data.items, 'response.data.items', readListItem),
    pagination: {
      page: integer(pagination.page, 'response.data.pagination.page', 1),
      pageSize: integer(pagination.page_size, 'response.data.pagination.page_size', 1, 100),
      total: integer(pagination.total, 'response.data.pagination.total'),
    },
  };
}

export function decodeAdminOrderDetailResponse(value: unknown, expectedOrderId?: string): AdminOrderDetail {
  const data = record(envelopeData(value), 'response.data');
  exact(data, [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'pay_expires_at', 'amounts', 'customer', 'attribution',
    'items', 'shipping_address_masked', 'available_actions', 'timeline', 'packages', 'aftersales',
    'payment_attempts', 'refund_attempts', 'errors', 'inventory_impact', 'commission_impact', 'version',
  ], 'response.data');

  const customer = record(data.customer, 'response.data.customer');
  exact(customer, ['customer_id', 'customer_alias', 'nickname_masked', 'phone_masked'], 'response.data.customer');
  const attribution = record(data.attribution, 'response.data.attribution');
  exact(attribution, ['agent_id', 'agent_name', 'source', 'frozen_at'], 'response.data.attribution');
  const address = record(data.shipping_address_masked, 'response.data.shipping_address_masked');
  exact(address, ['recipient_name_masked', 'phone_masked', 'region_summary', 'detail_masked'], 'response.data.shipping_address_masked');
  const packages = array(data.packages, 'response.data.packages', readPackage);
  if (packages.length > 1) invalid('response.data.packages');
  const availableActions = array(
    data.available_actions,
    'response.data.available_actions',
    (action, path) => oneOf(
      action,
      ['SHIP', 'ADD_LOGISTICS_EVENT', 'COMPLETE', 'RECONCILE_PAYMENT', 'RETRY_REFUND', 'MANUAL_COMPENSATION', 'READ_FULFILLMENT_ADDRESS'] as const,
      path,
    ),
  );
  if (new Set(availableActions).size !== availableActions.length) {
    invalid('response.data.available_actions');
  }
  const orderId = ulid(data.order_id, 'response.data.order_id');
  if (expectedOrderId !== undefined && orderId !== expectedOrderId) invalid('response.data.order_id');

  return {
    aftersales: array(data.aftersales, 'response.data.aftersales', readAftersale),
    amounts: readAmounts(data.amounts, 'response.data.amounts'),
    attribution: {
      agent_id: attribution.agent_id === null ? null : ulid(attribution.agent_id, 'response.data.attribution.agent_id'),
      agent_name: nullableString(attribution.agent_name, 'response.data.attribution.agent_name'),
      frozen_at: nullableDateTime(attribution.frozen_at, 'response.data.attribution.frozen_at'),
      source: oneOf(attribution.source, ['DIRECT', 'AGENT'] as const, 'response.data.attribution.source'),
    },
    available_actions: availableActions,
    close_reason: nullableOneOf(
      data.close_reason,
      ['USER_CANCELLED', 'PAYMENT_TIMEOUT', 'FULL_REFUND_BEFORE_SHIPMENT'] as const,
      'response.data.close_reason',
    ),
    commission_impact: array(data.commission_impact, 'response.data.commission_impact', readCommissionImpact),
    completion_reason: nullableOneOf(
      data.completion_reason,
      ['CUSTOMER_CONFIRMED', 'ADMIN_FORCED', 'FULL_REFUND_AFTER_SHIPMENT'] as const,
      'response.data.completion_reason',
    ),
    customer: {
      customer_alias: string(customer.customer_alias, 'response.data.customer.customer_alias'),
      customer_id: ulid(customer.customer_id, 'response.data.customer.customer_id'),
      nickname_masked: nullableString(customer.nickname_masked, 'response.data.customer.nickname_masked'),
      phone_masked: nullableString(customer.phone_masked, 'response.data.customer.phone_masked'),
    },
    display_status: string(data.display_status, 'response.data.display_status'),
    errors: array(data.errors, 'response.data.errors', readSafeError),
    fulfillment_status: oneOf(data.fulfillment_status, FULFILLMENT_STATUSES, 'response.data.fulfillment_status'),
    inventory_impact: array(data.inventory_impact, 'response.data.inventory_impact', readInventoryImpact),
    items: array(data.items, 'response.data.items', readOrderItem),
    order_id: orderId,
    order_no: string(data.order_no, 'response.data.order_no'),
    order_status: oneOf(data.order_status, ORDER_STATUSES, 'response.data.order_status'),
    packages,
    pay_expires_at: dateTime(data.pay_expires_at, 'response.data.pay_expires_at'),
    payment_attempts: array(data.payment_attempts, 'response.data.payment_attempts', readPaymentAttempt),
    payment_resolution: oneOf(data.payment_resolution, PAYMENT_RESOLUTIONS, 'response.data.payment_resolution'),
    payment_status: oneOf(data.payment_status, PAYMENT_STATUSES, 'response.data.payment_status'),
    refund_attempts: array(data.refund_attempts, 'response.data.refund_attempts', readRefundAttempt),
    refund_processing_status: oneOf(data.refund_processing_status, REFUND_PROCESSING, 'response.data.refund_processing_status'),
    refund_progress_status: oneOf(data.refund_progress_status, REFUND_PROGRESS, 'response.data.refund_progress_status'),
    shipping_address_masked: {
      detail_masked: string(address.detail_masked, 'response.data.shipping_address_masked.detail_masked'),
      phone_masked: string(address.phone_masked, 'response.data.shipping_address_masked.phone_masked'),
      recipient_name_masked: string(address.recipient_name_masked, 'response.data.shipping_address_masked.recipient_name_masked'),
      region_summary: string(address.region_summary, 'response.data.shipping_address_masked.region_summary'),
    },
    timeline: array(data.timeline, 'response.data.timeline', readTimeline),
    version: integer(data.version, 'response.data.version', 1),
  };
}

export function decodeAdminOrderCommandResponse(value: unknown, expectedOrderId?: string): AdminOrderCommandResult {
  const data = record(envelopeData(value), 'response.data');
  exact(data, [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'amounts', 'items', 'address_snapshot',
    'payment_attempts', 'aftersale_ids', 'version',
  ], 'response.data', ['customer_id']);
  const address = record(data.address_snapshot, 'response.data.address_snapshot');
  exact(address, ['recipient_name_masked', 'phone_masked', 'region_summary', 'detail_masked'], 'response.data.address_snapshot');
  const paymentAttempts = array(data.payment_attempts, 'response.data.payment_attempts', (value, path) => {
    const attempt = record(value, path);
    exact(attempt, ['payment_attempt_id', 'status', 'created_at'], path);
    return {
      created_at: dateTime(attempt.created_at, `${path}.created_at`),
      payment_attempt_id: ulid(attempt.payment_attempt_id, `${path}.payment_attempt_id`),
      status: string(attempt.status, `${path}.status`),
    };
  });
  const aftersaleIds = array(data.aftersale_ids, 'response.data.aftersale_ids', ulid);
  if (new Set(aftersaleIds).size !== aftersaleIds.length) invalid('response.data.aftersale_ids');
  const orderId = ulid(data.order_id, 'response.data.order_id');
  if (expectedOrderId !== undefined && orderId !== expectedOrderId) invalid('response.data.order_id');
  const result: AdminOrderCommandResult = {
    address_snapshot: {
      detail_masked: string(address.detail_masked, 'response.data.address_snapshot.detail_masked'),
      phone_masked: string(address.phone_masked, 'response.data.address_snapshot.phone_masked'),
      recipient_name_masked: string(address.recipient_name_masked, 'response.data.address_snapshot.recipient_name_masked'),
      region_summary: string(address.region_summary, 'response.data.address_snapshot.region_summary'),
    },
    aftersale_ids: aftersaleIds,
    amounts: readAmounts(data.amounts, 'response.data.amounts'),
    close_reason: nullableOneOf(
      data.close_reason,
      ['USER_CANCELLED', 'PAYMENT_TIMEOUT', 'FULL_REFUND_BEFORE_SHIPMENT'] as const,
      'response.data.close_reason',
    ),
    completion_reason: nullableOneOf(
      data.completion_reason,
      ['CUSTOMER_CONFIRMED', 'ADMIN_FORCED', 'FULL_REFUND_AFTER_SHIPMENT'] as const,
      'response.data.completion_reason',
    ),
    display_status: string(data.display_status, 'response.data.display_status'),
    fulfillment_status: oneOf(data.fulfillment_status, FULFILLMENT_STATUSES, 'response.data.fulfillment_status'),
    items: array(data.items, 'response.data.items', readOrderItem),
    order_id: orderId,
    order_no: string(data.order_no, 'response.data.order_no'),
    order_status: oneOf(data.order_status, ORDER_STATUSES, 'response.data.order_status'),
    payment_attempts: paymentAttempts,
    payment_resolution: oneOf(data.payment_resolution, PAYMENT_RESOLUTIONS, 'response.data.payment_resolution'),
    payment_status: oneOf(data.payment_status, PAYMENT_STATUSES, 'response.data.payment_status'),
    refund_processing_status: oneOf(data.refund_processing_status, REFUND_PROCESSING, 'response.data.refund_processing_status'),
    refund_progress_status: oneOf(data.refund_progress_status, REFUND_PROGRESS, 'response.data.refund_progress_status'),
    version: integer(data.version, 'response.data.version', 1),
  };
  if (Object.hasOwn(data, 'customer_id')) result.customer_id = ulid(data.customer_id, 'response.data.customer_id');
  return result;
}

export function decodeAdminFulfillmentAddressResponse(
  value: unknown,
  expectedOrderId?: string,
): AdminFulfillmentAddress {
  const data = record(envelopeData(value), 'response.data');
  exact(data, [
    'order_id', 'order_no', 'snapshot_id', 'recipient_name', 'phone', 'province', 'city', 'district',
    'detail', 'snapshot_at', 'purpose', 'access_expires_at',
  ], 'response.data');
  const orderId = ulid(data.order_id, 'response.data.order_id');
  if (expectedOrderId !== undefined && orderId !== expectedOrderId) invalid('response.data.order_id');
  return {
    access_expires_at: dateTime(data.access_expires_at, 'response.data.access_expires_at'),
    city: string(data.city, 'response.data.city'),
    detail: string(data.detail, 'response.data.detail'),
    district: string(data.district, 'response.data.district'),
    order_id: orderId,
    order_no: string(data.order_no, 'response.data.order_no'),
    phone: string(data.phone, 'response.data.phone'),
    province: string(data.province, 'response.data.province'),
    purpose: oneOf(data.purpose, ['ORDER_FULFILLMENT'] as const, 'response.data.purpose'),
    recipient_name: string(data.recipient_name, 'response.data.recipient_name'),
    snapshot_at: dateTime(data.snapshot_at, 'response.data.snapshot_at'),
    snapshot_id: ulid(data.snapshot_id, 'response.data.snapshot_id'),
  };
}

export function decodeShipmentResponse(value: unknown, expectedOrderId?: string): ShipmentView {
  const shipment = readShipment(envelopeData(value), 'response.data');
  if (expectedOrderId !== undefined && shipment.order_id !== expectedOrderId) {
    invalid('response.data.order_id');
  }
  return shipment;
}

export function decodeLogisticsResponse(value: unknown, expectedShipmentId?: string): LogisticsView {
  const data = record(envelopeData(value), 'response.data');
  exact(data, ['shipment', 'events'], 'response.data');
  const events = array(data.events, 'response.data.events', readLogisticsEvent);
  assertStableEvents(events, 'response.data.events');
  const result: LogisticsView = {
    events,
    shipment: data.shipment === null ? null : readShipment(data.shipment, 'response.data.shipment'),
  };
  if (expectedShipmentId !== undefined && result.shipment?.shipment_id !== expectedShipmentId) {
    invalid('response.data.shipment.shipment_id');
  }
  return result;
}
