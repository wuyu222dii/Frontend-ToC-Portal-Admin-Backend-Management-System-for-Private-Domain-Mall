import type {
  CheckoutQuote,
  CheckoutQuoteInput,
  OrderSubmitInput,
  StoreOrder,
  StoreOrderDetail,
  StoreOrderList,
  StoreOrderListQuery,
} from '../types/store-orders';
import { authenticatedRequest, createIdempotencyKey } from './store-identity';
import {
  decodeCheckoutQuote,
  decodeStoreOrder,
  decodeStoreOrderDetail,
  decodeStoreOrderList,
} from './store-order-decoders';

function ulidPath(value: string, field: string): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) throw new Error(`${field} is invalid`);
  return encodeURIComponent(value);
}

function versionHeader(version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error('version is invalid');
  return `"${version}"`;
}

export function createCheckoutQuote(input: CheckoutQuoteInput): Promise<CheckoutQuote> {
  return authenticatedRequest('/store/checkout/quotes', {
    data: input,
    decode: decodeCheckoutQuote,
    method: 'POST',
  });
}

export function createStoreOrder(
  input: OrderSubmitInput,
  idempotencyKey: string,
): Promise<StoreOrder> {
  return authenticatedRequest('/store/orders', {
    data: input,
    decode: decodeStoreOrder,
    expectedStatus: 201,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export function listStoreOrders(query: StoreOrderListQuery = {}): Promise<StoreOrderList> {
  return authenticatedRequest('/store/orders', {
    decode: decodeStoreOrderList,
    query: {
      display_group: query.display_group,
      order_status: query.order_status,
      page: query.page,
      page_size: query.page_size,
    },
  });
}

export function getStoreOrder(orderId: string): Promise<StoreOrderDetail> {
  return authenticatedRequest(`/store/orders/${ulidPath(orderId, 'order_id')}`, {
    decode: decodeStoreOrderDetail,
  });
}

export function cancelStoreOrder(
  orderId: string,
  version: number,
  idempotencyKey = createIdempotencyKey(),
): Promise<StoreOrder> {
  return authenticatedRequest(`/store/orders/${ulidPath(orderId, 'order_id')}/cancel`, {
    decode: decodeStoreOrder,
    expectedStatus: [200, 202],
    headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': versionHeader(version) },
    method: 'POST',
  });
}
