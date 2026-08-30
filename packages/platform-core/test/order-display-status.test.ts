import { describe, expect, it } from 'vitest';

import {
  projectOrderDisplayStatus,
  type OrderDisplayStatusAxes,
} from '../src';

const base: OrderDisplayStatusAxes = {
  fulfillmentStatus: 'NOT_STARTED',
  orderStatus: 'PENDING_PAYMENT',
  paymentResolution: 'NORMAL',
  paymentStatus: 'UNPAID',
  refundProcessingStatus: 'IDLE',
  refundProgressStatus: 'NONE',
};

describe('order display status', () => {
  it.each([
    [{
      orderStatus: 'CLOSED',
      paymentResolution: 'MANUAL_REQUIRED',
      refundProcessingStatus: 'FAILED',
      refundProgressStatus: 'FULL',
    }, '支付异常处理中'],
    [{
      orderStatus: 'CLOSED',
      paymentResolution: 'LATE_SUCCESS_REFUND_PENDING',
      refundProcessingStatus: 'FAILED',
      refundProgressStatus: 'FULL',
    }, '退款异常待处理'],
    [{
      orderStatus: 'CLOSED',
      paymentResolution: 'LATE_SUCCESS_REFUND_PENDING',
      refundProgressStatus: 'FULL',
    }, '退款处理中'],
    [{ orderStatus: 'CLOSED', refundProcessingStatus: 'REFUNDING', refundProgressStatus: 'FULL' }, '退款处理中'],
    [{
      orderStatus: 'CLOSED',
      paymentResolution: 'LATE_SUCCESS_REFUNDED',
      refundProgressStatus: 'PARTIAL',
    }, '退款完成'],
    [{ orderStatus: 'CLOSED', refundProgressStatus: 'FULL' }, '退款完成'],
    [{ orderStatus: 'CLOSED', refundProgressStatus: 'PARTIAL' }, '部分退款'],
    [{ fulfillmentStatus: 'DELIVERED', orderStatus: 'CLOSED' }, '已关闭'],
    [{
      fulfillmentStatus: 'SHIPPED',
      orderStatus: 'PENDING_PAYMENT',
      paymentStatus: 'PROCESSING',
    }, '待付款'],
    [{ fulfillmentStatus: 'READY_TO_SHIP', orderStatus: 'PENDING_SHIPMENT' }, '待发货'],
    [{ fulfillmentStatus: 'DELIVERED', orderStatus: 'SHIPPING' }, '运输中'],
    [{ fulfillmentStatus: 'SHIPPED', orderStatus: 'PENDING_SHIPMENT' }, '运输中'],
    [{ fulfillmentStatus: 'IN_TRANSIT', orderStatus: 'PENDING_SHIPMENT' }, '运输中'],
    [{ orderStatus: 'COMPLETED' }, '已完成'],
    [{ fulfillmentStatus: 'DELIVERED', orderStatus: 'PENDING_SHIPMENT' }, '已完成'],
  ] satisfies Array<[Partial<OrderDisplayStatusAxes>, string]>)('applies the frozen priority for %o', (overrides, expected) => {
    expect(projectOrderDisplayStatus({ ...base, ...overrides })).toBe(expected);
  });

  it('fails closed when PENDING_SHIPMENT is not READY_TO_SHIP', () => {
    expect(() => projectOrderDisplayStatus({
      ...base,
      fulfillmentStatus: 'NOT_STARTED',
      orderStatus: 'PENDING_SHIPMENT',
    })).toThrow(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
  });
});
