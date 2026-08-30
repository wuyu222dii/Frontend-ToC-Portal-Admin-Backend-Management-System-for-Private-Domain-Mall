import { ApplicationError } from './errors';

export type OrderDisplayStatus =
  | '待付款'
  | '待发货'
  | '运输中'
  | '已完成'
  | '退款处理中'
  | '部分退款'
  | '退款完成'
  | '退款异常待处理'
  | '已关闭'
  | '支付异常处理中';

export interface OrderDisplayStatusAxes {
  fulfillmentStatus: 'CANCELLED' | 'DELIVERED' | 'IN_TRANSIT' | 'NOT_STARTED' | 'READY_TO_SHIP' | 'SHIPPED';
  orderStatus: 'CLOSED' | 'COMPLETED' | 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'SHIPPING';
  paymentResolution: 'LATE_SUCCESS_REFUND_PENDING' | 'LATE_SUCCESS_REFUNDED' | 'MANUAL_REQUIRED' | 'NORMAL';
  paymentStatus: 'PAID' | 'PROCESSING' | 'UNPAID';
  refundProcessingStatus: 'FAILED' | 'IDLE' | 'REFUNDING';
  refundProgressStatus: 'FULL' | 'NONE' | 'PARTIAL';
}

export function projectOrderDisplayStatus(order: OrderDisplayStatusAxes): OrderDisplayStatus {
  if (order.paymentResolution === 'MANUAL_REQUIRED') return '支付异常处理中';
  if (order.refundProcessingStatus === 'FAILED') return '退款异常待处理';
  if (order.paymentResolution === 'LATE_SUCCESS_REFUND_PENDING' ||
    order.refundProcessingStatus === 'REFUNDING') return '退款处理中';
  if (order.paymentResolution === 'LATE_SUCCESS_REFUNDED' || order.refundProgressStatus === 'FULL') {
    return '退款完成';
  }
  if (order.refundProgressStatus === 'PARTIAL') return '部分退款';
  if (order.orderStatus === 'CLOSED') return '已关闭';
  if (order.orderStatus === 'PENDING_PAYMENT') return '待付款';
  if (order.orderStatus === 'PENDING_SHIPMENT' && order.fulfillmentStatus === 'READY_TO_SHIP') {
    return '待发货';
  }
  if (order.orderStatus === 'SHIPPING' || order.fulfillmentStatus === 'SHIPPED' ||
    order.fulfillmentStatus === 'IN_TRANSIT') return '运输中';
  if (order.orderStatus === 'COMPLETED' || order.fulfillmentStatus === 'DELIVERED') return '已完成';
  throw new ApplicationError('INTERNAL_ERROR', 'Stored order status axes cannot produce a display status');
}
