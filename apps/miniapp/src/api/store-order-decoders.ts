import type {
  CheckoutQuote,
  CheckoutQuoteBlocker,
  CheckoutQuoteLine,
  StoreOrder,
  StoreOrderCompactItem,
  StoreOrderDetail,
  StoreOrderList,
  StoreOrderListItem,
} from '../types/store-orders';
import type { StoreAddressSummary } from '../types/store-shopping';
import { StoreEnvelopeFormatError } from './store-client';

type RecordValue = Record<string, unknown>;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const moneyPattern = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const positiveMoneyPattern = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const confirmationHashPattern = /^[a-f0-9]{64}$/;
const phonePattern = /^[0-9]{11}$/;
const orderStatuses = new Set(['PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED']);
const paymentStatuses = new Set(['UNPAID', 'PROCESSING', 'PAID']);
const refundProgressStatuses = new Set(['NONE', 'PARTIAL', 'FULL']);
const refundProcessingStatuses = new Set(['IDLE', 'REFUNDING', 'FAILED']);
const fulfillmentStatuses = new Set(['NOT_STARTED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED']);
const closeReasons = new Set(['USER_CANCELLED', 'PAYMENT_TIMEOUT', 'FULL_REFUND_BEFORE_SHIPMENT']);
const completionReasons = new Set(['CUSTOMER_CONFIRMED', 'ADMIN_FORCED', 'FULL_REFUND_AFTER_SHIPMENT']);
const paymentResolutions = new Set(['NORMAL', 'LATE_SUCCESS_REFUND_PENDING', 'LATE_SUCCESS_REFUNDED', 'MANUAL_REQUIRED']);
const orderActions = new Set(['PAY', 'CANCEL']);
const commandDisplayStatuses = new Set([
  '待付款', '待发货', '运输中', '已完成', '退款处理中', '部分退款', '退款完成',
  '退款异常待处理', '已关闭', '支付处理中', '支付确认中', '关单确认中', '支付异常处理中',
]);
const blockers = new Set<CheckoutQuoteBlocker>([
  'CART_SELECTION_CHANGED', 'ITEM_UNAVAILABLE', 'INSUFFICIENT_STOCK',
]);

function invalid(): never {
  throw new StoreEnvelopeFormatError();
}

function record(value: unknown, keys: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const current = value as RecordValue;
  const actual = Object.keys(current);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(current, key))) invalid();
  return current;
}

function text(value: unknown, minimum = 1, maximum = 2_048): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<string>): T {
  const current = text(value);
  if (!values.has(current)) invalid();
  return current as T;
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

function dateTime(value: unknown): string {
  const current = text(value);
  if (!Number.isFinite(Date.parse(current))) invalid();
  return current;
}

function money(value: unknown, positive = false): string {
  const current = text(value);
  if (!(positive ? positiveMoneyPattern : moneyPattern).test(current)) invalid();
  return current;
}

function absoluteUrl(value: unknown): string {
  const current = text(value);
  const match = /^https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#][^\s]*)?$/i.exec(current);
  if (!match) invalid();
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) invalid();
  }
  return current;
}

function nullable<T>(value: unknown, decoder: (input: unknown) => T): T | null {
  return value === null ? null : decoder(value);
}

function skuSpec(value: unknown): CheckoutQuoteLine['spec_json'] {
  if (value === null) return null;
  const current = record(value, ['attributes']);
  if (!Array.isArray(current.attributes)) invalid();
  return {
    attributes: current.attributes.map((entry) => {
      const attribute = record(entry, ['name', 'value']);
      return { name: text(attribute.name), value: text(attribute.value) };
    }),
  };
}

function addressSummary(value: unknown): StoreAddressSummary {
  const current = record(value, [
    'address_id', 'recipient_name_masked', 'phone_masked', 'province', 'city', 'district',
    'detail_masked', 'is_default', 'version',
  ]);
  return {
    address_id: ulid(current.address_id),
    recipient_name_masked: text(current.recipient_name_masked, 1, 80),
    phone_masked: text(current.phone_masked, 1, 32),
    province: text(current.province, 1, 80),
    city: text(current.city, 1, 80),
    district: text(current.district, 1, 80),
    detail_masked: text(current.detail_masked, 1, 300),
    is_default: booleanValue(current.is_default),
    version: integer(current.version, 1),
  };
}

function quoteLine(value: unknown): CheckoutQuoteLine {
  const current = record(value, [
    'product_id', 'product_name', 'sku_id', 'sku_name', 'spec_json', 'primary_image_url',
    'quantity', 'unit_price', 'line_amount', 'available_stock', 'saleable',
  ]);
  return {
    product_id: ulid(current.product_id),
    product_name: text(current.product_name, 1, 200),
    sku_id: ulid(current.sku_id),
    sku_name: text(current.sku_name, 1, 200),
    spec_json: skuSpec(current.spec_json),
    primary_image_url: nullable(current.primary_image_url, absoluteUrl),
    quantity: integer(current.quantity, 1, 99),
    unit_price: money(current.unit_price, true),
    line_amount: money(current.line_amount, true),
    available_stock: integer(current.available_stock),
    saleable: booleanValue(current.saleable),
  };
}

export function decodeCheckoutQuote(value: unknown): CheckoutQuote {
  const current = record(value, [
    'quote_id', 'source', 'address', 'items', 'goods_amount', 'shipping_amount',
    'payable_amount', 'can_submit', 'blockers', 'quote_token', 'confirmation_hash',
    'expires_at', 'server_time',
  ]);
  if (!Array.isArray(current.items) || current.items.length < 1 || current.items.length > 100 ||
    !Array.isArray(current.blockers)) invalid();
  const canSubmit = booleanValue(current.can_submit);
  const decodedBlockers = current.blockers.map((entry) => enumValue<CheckoutQuoteBlocker>(entry, blockers));
  const quoteToken = nullable(current.quote_token, (entry) => text(entry, 32, 512));
  const confirmationHash = nullable(current.confirmation_hash, (entry) => {
    const hash = text(entry, 64, 64);
    if (!confirmationHashPattern.test(hash)) invalid();
    return hash;
  });
  const expiresAt = nullable(current.expires_at, dateTime);
  if (new Set(decodedBlockers).size !== decodedBlockers.length ||
    (canSubmit && (decodedBlockers.length !== 0 || quoteToken === null || confirmationHash === null || expiresAt === null)) ||
    (!canSubmit && (decodedBlockers.length === 0 || quoteToken !== null || confirmationHash !== null || expiresAt !== null))) {
    invalid();
  }
  const source = enumValue<'CART' | 'BUY_NOW'>(current.source, new Set(['CART', 'BUY_NOW']));
  if (source === 'BUY_NOW' && current.items.length !== 1) invalid();
  const shippingAmount = money(current.shipping_amount);
  if (shippingAmount !== '0.00') invalid();
  return {
    quote_id: ulid(current.quote_id),
    source,
    address: addressSummary(current.address),
    items: current.items.map(quoteLine),
    goods_amount: money(current.goods_amount),
    shipping_amount: '0.00',
    payable_amount: money(current.payable_amount),
    can_submit: canSubmit,
    blockers: decodedBlockers,
    quote_token: quoteToken,
    confirmation_hash: confirmationHash,
    expires_at: expiresAt,
    server_time: dateTime(current.server_time),
  } as CheckoutQuote;
}

function axes(current: RecordValue) {
  return {
    order_status: enumValue<StoreOrder['order_status']>(current.order_status, orderStatuses),
    payment_status: enumValue<StoreOrder['payment_status']>(current.payment_status, paymentStatuses),
    refund_progress_status: enumValue<StoreOrder['refund_progress_status']>(current.refund_progress_status, refundProgressStatuses),
    refund_processing_status: enumValue<StoreOrder['refund_processing_status']>(current.refund_processing_status, refundProcessingStatuses),
    fulfillment_status: enumValue<StoreOrder['fulfillment_status']>(current.fulfillment_status, fulfillmentStatuses),
    close_reason: nullable(current.close_reason, (entry) => enumValue<NonNullable<StoreOrder['close_reason']>>(entry, closeReasons)),
    completion_reason: nullable(current.completion_reason, (entry) => enumValue<NonNullable<StoreOrder['completion_reason']>>(entry, completionReasons)),
    payment_resolution: enumValue<StoreOrder['payment_resolution']>(current.payment_resolution, paymentResolutions),
    display_status: text(current.display_status, 1, 80),
  };
}

function amounts(value: unknown): StoreOrder['amounts'] {
  const current = record(value, ['goods', 'shipping', 'payable', 'paid', 'refunded']);
  return {
    goods: money(current.goods), shipping: money(current.shipping), payable: money(current.payable),
    paid: money(current.paid), refunded: money(current.refunded),
  };
}

function orderItem(value: unknown): StoreOrder['items'][number] {
  const current = record(value, [
    'order_item_id', 'product_id', 'sku_id', 'product_name', 'sku_name', 'unit_price',
    'quantity', 'line_amount', 'refunded_quantity', 'reserved_aftersale_quantity', 'shipped_quantity',
  ]);
  return {
    order_item_id: ulid(current.order_item_id), product_id: ulid(current.product_id),
    sku_id: ulid(current.sku_id), product_name: text(current.product_name, 1, 200),
    sku_name: text(current.sku_name, 1, 200), unit_price: money(current.unit_price),
    quantity: integer(current.quantity, 1), line_amount: money(current.line_amount),
    refunded_quantity: integer(current.refunded_quantity),
    reserved_aftersale_quantity: integer(current.reserved_aftersale_quantity),
    shipped_quantity: integer(current.shipped_quantity),
  };
}

function decodeStoreOrderProjection(value: unknown, enforceCommandDisplayStatus: boolean): StoreOrder {
  const current = record(value, [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'pay_expires_at', 'server_time', 'amounts', 'items',
  ]);
  if (!Array.isArray(current.items) || current.items.length < 1) invalid();
  const orderId = ulid(current.order_id);
  const orderNo = text(current.order_no, 28, 28);
  if (orderNo !== `QX${orderId}`) invalid();
  const decodedAxes = axes(current);
  if (enforceCommandDisplayStatus && !commandDisplayStatuses.has(decodedAxes.display_status)) invalid();
  return {
    order_id: orderId, order_no: orderNo, ...decodedAxes,
    pay_expires_at: dateTime(current.pay_expires_at), server_time: dateTime(current.server_time),
    amounts: amounts(current.amounts), items: current.items.map(orderItem),
  } as StoreOrder;
}

export function decodeStoreOrder(value: unknown): StoreOrder {
  return decodeStoreOrderProjection(value, true);
}

function compactItem(value: unknown): StoreOrderCompactItem {
  const current = record(value, [
    'order_item_id', 'product_id', 'sku_id', 'product_name', 'sku_name',
    'primary_image_url', 'quantity', 'line_amount',
  ]);
  return {
    order_item_id: ulid(current.order_item_id), product_id: ulid(current.product_id),
    sku_id: ulid(current.sku_id), product_name: text(current.product_name, 1, 200),
    sku_name: text(current.sku_name, 1, 200),
    primary_image_url: nullable(current.primary_image_url, absoluteUrl),
    quantity: integer(current.quantity, 1), line_amount: money(current.line_amount),
  };
}

function listItem(value: unknown): StoreOrderListItem {
  const current = record(value, [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'payable_amount', 'items', 'pay_expires_at',
    'available_actions', 'aftersale_summary', 'created_at',
  ]);
  if (!Array.isArray(current.items) || current.items.length < 1 || !Array.isArray(current.available_actions) ||
    current.available_actions.some((entry) => typeof entry !== 'string' || !orderActions.has(entry)) ||
    new Set(current.available_actions).size !== current.available_actions.length) invalid();
  const aftersale = record(current.aftersale_summary, [
    'active_count', 'latest_aftersale_id', 'latest_status', 'refunded_amount',
  ]);
  const latestStatuses = new Set([
    'PENDING_REVIEW', 'REJECTED', 'REFUNDING', 'WAITING_RETURN', 'WAITING_RECEIPT',
    'RETURN_EXCEPTION', 'REFUNDING_AFTER_RETURN', 'REJECTED_AFTER_RETURN', 'REFUND_FAILED',
    'COMPLETED', 'CANCELLED',
  ]);
  const orderId = ulid(current.order_id);
  const orderNo = text(current.order_no, 28, 28);
  if (orderNo !== `QX${orderId}`) invalid();
  return {
    order_id: orderId, order_no: orderNo, ...axes(current), payable_amount: money(current.payable_amount),
    items: current.items.map(compactItem), pay_expires_at: nullable(current.pay_expires_at, dateTime),
    available_actions: current.available_actions as StoreOrderListItem['available_actions'],
    aftersale_summary: {
      active_count: integer(aftersale.active_count),
      latest_aftersale_id: nullable(aftersale.latest_aftersale_id, ulid),
      latest_status: nullable(aftersale.latest_status, (entry) => enumValue(entry, latestStatuses)),
      refunded_amount: money(aftersale.refunded_amount),
    } as StoreOrderListItem['aftersale_summary'],
    created_at: dateTime(current.created_at),
  } as StoreOrderListItem;
}

export function decodeStoreOrderList(value: unknown): StoreOrderList {
  const current = record(value, ['items', 'pagination']);
  if (!Array.isArray(current.items)) invalid();
  const pagination = record(current.pagination, ['page', 'page_size', 'total']);
  return {
    items: current.items.map(listItem),
    pagination: {
      page: integer(pagination.page, 1), page_size: integer(pagination.page_size, 1, 100),
      total: integer(pagination.total),
    },
  };
}

function safeDomainError(value: unknown): StoreOrderDetail['errors'][number] {
  const current = record(value, ['error_code', 'message', 'retryable', 'occurred_at']);
  return {
    error_code: text(current.error_code),
    message: text(current.message),
    retryable: booleanValue(current.retryable),
    occurred_at: dateTime(current.occurred_at),
  };
}

function paymentAttempt(value: unknown): StoreOrderDetail['payment_attempts'][number] {
  const current = record(value, [
    'payment_attempt_id', 'intent_no', 'status', 'amount', 'provider_transaction_id_masked',
    'last_error', 'created_at', 'updated_at',
  ]);
  return {
    payment_attempt_id: ulid(current.payment_attempt_id),
    intent_no: text(current.intent_no),
    status: enumValue(current.status, new Set([
      'INITIATED', 'SUCCEEDED', 'SUCCEEDED_LATE', 'FAILED', 'CANCELLED',
    ])),
    amount: money(current.amount),
    provider_transaction_id_masked: nullable(current.provider_transaction_id_masked, text),
    last_error: nullable(current.last_error, safeDomainError),
    created_at: dateTime(current.created_at),
    updated_at: dateTime(current.updated_at),
  } as StoreOrderDetail['payment_attempts'][number];
}

function refundAttempt(value: unknown): StoreOrderDetail['refund_attempts'][number] {
  const current = record(value, [
    'refund_id', 'refund_no', 'attempt_no', 'origin_type', 'status', 'amount',
    'last_error', 'created_at', 'updated_at',
  ]);
  return {
    refund_id: ulid(current.refund_id),
    refund_no: text(current.refund_no),
    attempt_no: integer(current.attempt_no, 1),
    origin_type: enumValue(current.origin_type, new Set([
      'AFTERSALE', 'LATE_PAYMENT', 'MANUAL_COMPENSATION',
    ])),
    status: enumValue(current.status, new Set(['INITIATED', 'PROCESSING', 'SUCCEEDED', 'FAILED'])),
    amount: money(current.amount),
    last_error: nullable(current.last_error, safeDomainError),
    created_at: dateTime(current.created_at),
    updated_at: dateTime(current.updated_at),
  } as StoreOrderDetail['refund_attempts'][number];
}

export function decodeStoreOrderDetail(value: unknown): StoreOrderDetail {
  const current = record(value, [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'pay_expires_at', 'server_time', 'amounts', 'items',
    'shipping_address', 'available_actions', 'timeline', 'packages', 'aftersales',
    'payment_attempts', 'refund_attempts', 'errors', 'version',
  ]);
  if (!Array.isArray(current.items) || current.items.length < 1 ||
    !Array.isArray(current.available_actions) ||
    current.available_actions.some((entry) => typeof entry !== 'string' || !orderActions.has(entry)) ||
    new Set(current.available_actions).size !== current.available_actions.length ||
    !Array.isArray(current.timeline) || !Array.isArray(current.errors) ||
    !Array.isArray(current.packages) || current.packages.length !== 0 ||
    !Array.isArray(current.aftersales) || current.aftersales.length !== 0 ||
    !Array.isArray(current.payment_attempts) || !Array.isArray(current.refund_attempts)) invalid();
  const base = decodeStoreOrderProjection(Object.fromEntries(Object.entries(current).filter(([key]) => [
    'order_id', 'order_no', 'order_status', 'payment_status', 'refund_progress_status',
    'refund_processing_status', 'fulfillment_status', 'close_reason', 'completion_reason',
    'payment_resolution', 'display_status', 'pay_expires_at', 'server_time', 'amounts', 'items',
  ].includes(key))), false);
  const address = record(current.shipping_address, ['recipient_name', 'phone', 'province', 'city', 'district', 'detail']);
  const phone = text(address.phone, 11, 11);
  if (!phonePattern.test(phone)) invalid();
  return {
    ...base,
    shipping_address: {
      recipient_name: text(address.recipient_name, 1, 80), phone,
      province: text(address.province, 1, 80), city: text(address.city, 1, 80),
      district: text(address.district, 1, 80), detail: text(address.detail, 1, 300),
    },
    available_actions: current.available_actions as StoreOrderDetail['available_actions'],
    timeline: current.timeline.map((entry) => {
      const event = record(entry, ['event_id', 'axis', 'event', 'from_status', 'to_status', 'occurred_at']);
      return {
        event_id: text(event.event_id),
        axis: enumValue(event.axis, new Set(['ORDER', 'PAYMENT', 'REFUND', 'FULFILLMENT', 'AFTERSALE'])),
        event: text(event.event), from_status: nullable(event.from_status, text),
        to_status: text(event.to_status), occurred_at: dateTime(event.occurred_at),
      } as StoreOrderDetail['timeline'][number];
    }),
    packages: [], aftersales: [],
    payment_attempts: current.payment_attempts.map(paymentAttempt),
    refund_attempts: current.refund_attempts.map(refundAttempt),
    errors: current.errors.map(safeDomainError),
    version: integer(current.version, 1),
  } as StoreOrderDetail;
}
