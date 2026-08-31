import type { components } from '@qingxu/contracts';

export type AdminOrderListItem = components['schemas']['AdminOrderListItem'];
export type AdminOrderDetail = components['schemas']['AdminOrderDetailResponse']['data'];
export type AdminOrderCommandResult = components['schemas']['AdminOrderResponse']['data'];
export type AdminFulfillmentAddress = components['schemas']['AdminFulfillmentAddressResponse']['data'];
export type ShipmentView = components['schemas']['ShipmentView'];
export type LogisticsView = components['schemas']['LogisticsResponse']['data'];
export type CreateShipmentInput = components['schemas']['CreateShipmentRequest'];
export type LogisticsEventInput = components['schemas']['LogisticsEventRequest'];

export interface AdminOrderListQuery {
  page?: number;
  pageSize?: number;
  orderNo?: string;
  orderStatus?: AdminOrderListItem['order_status'];
  paymentStatus?: AdminOrderListItem['payment_status'];
  refundProgressStatus?: AdminOrderListItem['refund_progress_status'];
  refundProcessingStatus?: AdminOrderListItem['refund_processing_status'];
  fulfillmentStatus?: AdminOrderListItem['fulfillment_status'];
  dateFrom?: string;
  dateTo?: string;
  minAmount?: string;
  maxAmount?: string;
  sort?: 'CREATED_DESC' | 'PAID_DESC' | 'AMOUNT_DESC';
  customerId?: string;
  agentId?: string;
}

export interface AdminOrderListResult {
  items: AdminOrderListItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}
