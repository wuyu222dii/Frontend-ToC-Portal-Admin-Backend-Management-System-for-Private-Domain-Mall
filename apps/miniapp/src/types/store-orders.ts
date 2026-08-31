import type { components } from '@qingxu/contracts';

export type OrderLineInput = components['schemas']['OrderLineInput'];
export type CheckoutQuoteInput = components['schemas']['CheckoutQuoteRequest'];
export type CheckoutQuote = components['schemas']['CheckoutQuoteResponse']['data'];
export type CheckoutQuoteLine = components['schemas']['CheckoutQuoteLine'];
export type CheckoutQuoteBlocker = components['schemas']['CheckoutQuoteBlocker'];
export type OrderSubmitInput = components['schemas']['OrderSubmitRequest'];
export type StoreOrder = components['schemas']['StoreOrderResponse']['data'];
export type StoreOrderCompactItem = components['schemas']['StoreOrderCompactItem'];
export type StoreOrderListItem = components['schemas']['StoreOrderListItem'];
export type StoreOrderList = components['schemas']['StoreOrderListResponse']['data'];
export type StoreOrderDetail = components['schemas']['StoreOrderDetailResponse']['data'];
export type StoreOrderPackage = components['schemas']['OrderPackageDetailView'];
export type StoreLogisticsEvent = components['schemas']['LogisticsEventView'];
export type StoreShipment = components['schemas']['ShipmentView'];
export type StoreLogistics = components['schemas']['LogisticsResponse']['data'];

export interface StoreOrderListQuery {
  readonly page?: number;
  readonly page_size?: number;
  readonly display_group?: 'ALL' | 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'SHIPPING' | 'COMPLETED' | 'REFUND_AFTERSALE';
  readonly order_status?: 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'SHIPPING' | 'COMPLETED' | 'CLOSED';
}
