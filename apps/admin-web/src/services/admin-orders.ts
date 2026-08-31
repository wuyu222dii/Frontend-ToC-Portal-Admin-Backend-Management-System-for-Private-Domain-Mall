import type {
  AdminFulfillmentAddress,
  AdminOrderCommandResult,
  AdminOrderDetail,
  AdminOrderListQuery,
  AdminOrderListResult,
  CreateShipmentInput,
  LogisticsEventInput,
  LogisticsView,
  ShipmentView,
} from '../types/orders';
import { adminSessionRequest } from './admin-api';
import {
  decodeAdminFulfillmentAddressResponse,
  decodeAdminOrderCommandResponse,
  decodeAdminOrderDetailResponse,
  decodeAdminOrderListResponse,
  decodeLogisticsResponse,
  decodeShipmentResponse,
} from './admin-orders-decoders';

const ordersPath = '/admin/orders';

export function buildAdminOrderListPath(query: AdminOrderListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.orderNo) search.set('order_no', query.orderNo);
  if (query.orderStatus) search.set('order_status', query.orderStatus);
  if (query.paymentStatus) search.set('payment_status', query.paymentStatus);
  if (query.refundProgressStatus) search.set('refund_progress_status', query.refundProgressStatus);
  if (query.refundProcessingStatus) search.set('refund_processing_status', query.refundProcessingStatus);
  if (query.fulfillmentStatus) search.set('fulfillment_status', query.fulfillmentStatus);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  if (query.minAmount) search.set('min_amount', query.minAmount);
  if (query.maxAmount) search.set('max_amount', query.maxAmount);
  if (query.sort) search.set('sort', query.sort);
  if (query.customerId) search.set('customer_id', query.customerId);
  if (query.agentId) search.set('agent_id', query.agentId);
  return search.size > 0 ? `${ordersPath}?${search.toString()}` : ordersPath;
}

export async function listAdminOrders(
  query: AdminOrderListQuery = {},
  signal?: AbortSignal,
): Promise<AdminOrderListResult> {
  const response = await adminSessionRequest<unknown>(buildAdminOrderListPath(query), { expectedStatus: 200, signal });
  return decodeAdminOrderListResponse(response);
}

export async function getAdminOrder(orderId: string, signal?: AbortSignal): Promise<AdminOrderDetail> {
  const response = await adminSessionRequest<unknown>(`${ordersPath}/${encodeURIComponent(orderId)}`, {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminOrderDetailResponse(response, orderId);
}

export async function getAdminFulfillmentAddress(
  orderId: string,
  reason: string,
  signal?: AbortSignal,
): Promise<AdminFulfillmentAddress> {
  const response = await adminSessionRequest<unknown>(
    `${ordersPath}/${encodeURIComponent(orderId)}/fulfillment-address`,
    {
      expectedStatus: 200,
      headers: {
        'X-Access-Purpose': 'ORDER_FULFILLMENT',
        'X-Access-Reason': `UTF-8''${encodeURIComponent(reason)}`,
      },
      signal,
    },
  );
  return decodeAdminFulfillmentAddressResponse(response, orderId);
}

export async function createAdminShipment(
  orderId: string,
  input: CreateShipmentInput,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<ShipmentView> {
  const response = await adminSessionRequest<unknown>(
    `${ordersPath}/${encodeURIComponent(orderId)}/shipments`,
    {
      body: input,
      expectedStatus: 201,
      idempotencyKey,
      ifMatch: `"${version}"`,
      method: 'POST',
      signal,
    },
  );
  return decodeShipmentResponse(response, orderId);
}

export async function appendAdminLogisticsEvent(
  shipmentId: string,
  input: LogisticsEventInput,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<LogisticsView> {
  const response = await adminSessionRequest<unknown>(
    `/admin/shipments/${encodeURIComponent(shipmentId)}/events`,
    {
      body: input,
      expectedStatus: 200,
      idempotencyKey,
      ifMatch: `"${version}"`,
      method: 'POST',
      signal,
    },
  );
  return decodeLogisticsResponse(response, shipmentId);
}

export async function completeAdminOrder(
  orderId: string,
  reason: string,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminOrderCommandResult> {
  const response = await adminSessionRequest<unknown>(
    `${ordersPath}/${encodeURIComponent(orderId)}/complete`,
    {
      body: { completion_reason: 'ADMIN_FORCED', reason },
      expectedStatus: 200,
      idempotencyKey,
      ifMatch: `"${version}"`,
      method: 'POST',
      signal,
    },
  );
  return decodeAdminOrderCommandResponse(response, orderId);
}
