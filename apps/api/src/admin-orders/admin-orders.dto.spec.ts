import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseAdminFulfillmentAddressAccessHeaders,
  parseAdminOrderId,
  parseAdminOrderListQuery,
  type AdminOrderFulfillmentStatusFilter,
  type AdminOrderPaymentStatusFilter,
  type AdminOrderRefundProcessingStatusFilter,
  type AdminOrderRefundProgressStatusFilter,
  type AdminOrderSort,
  type AdminOrderStatusFilter,
} from './admin-orders.dto';

const ORDER_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const AGENT_ID = '01J00000000000000000000003';

const ORDER_STATUSES: readonly AdminOrderStatusFilter[] = [
  'PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED',
];
const PAYMENT_STATUSES: readonly AdminOrderPaymentStatusFilter[] = ['UNPAID', 'PROCESSING', 'PAID'];
const REFUND_PROGRESS_STATUSES: readonly AdminOrderRefundProgressStatusFilter[] = ['NONE', 'PARTIAL', 'FULL'];
const REFUND_PROCESSING_STATUSES: readonly AdminOrderRefundProcessingStatusFilter[] = [
  'IDLE', 'REFUNDING', 'FAILED',
];
const FULFILLMENT_STATUSES: readonly AdminOrderFulfillmentStatusFilter[] = [
  'NOT_STARTED', 'READY_TO_SHIP', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED',
];
const SORTS: readonly AdminOrderSort[] = ['CREATED_DESC', 'PAID_DESC', 'AMOUNT_DESC'];

describe('B11.1 Admin order DTO', () => {
  it('applies the frozen list defaults', () => {
    expect(parseAdminOrderListQuery({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    });
  });

  it('maps every closed filter and converts Shanghai dates to a UTC half-open interval', () => {
    expect(parseAdminOrderListQuery({
      agent_id: AGENT_ID,
      customer_id: CUSTOMER_ID,
      date_from: '2026-08-25',
      date_to: '2026-08-26',
      fulfillment_status: 'IN_TRANSIT',
      max_amount: '9999999999999999.99',
      min_amount: '19.90',
      order_no: ' QX01J00000000000000000000008 ',
      order_status: 'SHIPPING',
      page: '3',
      page_size: '50',
      payment_status: 'PAID',
      refund_processing_status: 'REFUNDING',
      refund_progress_status: 'PARTIAL',
      sort: 'AMOUNT_DESC',
    })).toEqual({
      agentId: AGENT_ID,
      createdAtFrom: new Date('2026-08-24T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-08-26T16:00:00.000Z'),
      customerId: CUSTOMER_ID,
      fulfillmentStatus: 'IN_TRANSIT',
      maxAmount: '9999999999999999.99',
      minAmount: '19.90',
      orderNo: 'QX01J00000000000000000000008',
      orderStatus: 'SHIPPING',
      page: 3,
      pageSize: 50,
      paymentStatus: 'PAID',
      refundProcessingStatus: 'REFUNDING',
      refundProgressStatus: 'PARTIAL',
      sort: 'AMOUNT_DESC',
    });
  });

  it('accepts every value in the five closed status axes and sort set', () => {
    for (const status of ORDER_STATUSES) {
      expect(parseAdminOrderListQuery({ order_status: status }).orderStatus).toBe(status);
    }
    for (const status of PAYMENT_STATUSES) {
      expect(parseAdminOrderListQuery({ payment_status: status }).paymentStatus).toBe(status);
    }
    for (const status of REFUND_PROGRESS_STATUSES) {
      expect(parseAdminOrderListQuery({ refund_progress_status: status }).refundProgressStatus).toBe(status);
    }
    for (const status of REFUND_PROCESSING_STATUSES) {
      expect(parseAdminOrderListQuery({ refund_processing_status: status }).refundProcessingStatus).toBe(status);
    }
    for (const status of FULFILLMENT_STATUSES) {
      expect(parseAdminOrderListQuery({ fulfillment_status: status }).fulfillmentStatus).toBe(status);
    }
    for (const sort of SORTS) {
      expect(parseAdminOrderListQuery({ sort }).sort).toBe(sort);
    }
  });

  it('accepts a real leap day and equal non-negative amount bounds', () => {
    expect(parseAdminOrderListQuery({
      date_from: '2024-02-29',
      date_to: '2024-02-29',
      max_amount: '0.00',
      min_amount: '0.00',
    })).toMatchObject({
      createdAtFrom: new Date('2024-02-28T16:00:00.000Z'),
      createdAtToExclusive: new Date('2024-02-29T16:00:00.000Z'),
      maxAmount: '0.00',
      minAmount: '0.00',
    });
  });

  it.each([
    ['non-object query', null],
    ['unknown query field', { include_deleted: 'true' }],
    ['zero page', { page: '0' }],
    ['non-canonical page', { page: '01' }],
    ['oversized page size', { page_size: '101' }],
    ['duplicate query value', { sort: ['CREATED_DESC', 'PAID_DESC'] }],
    ['open order status', { order_status: 'ARCHIVED' }],
    ['open payment status', { payment_status: 'REFUNDED' }],
    ['open refund progress status', { refund_progress_status: 'PENDING' }],
    ['open refund processing status', { refund_processing_status: 'PENDING' }],
    ['open fulfillment status', { fulfillment_status: 'PENDING' }],
    ['open sort', { sort: 'CREATED_ASC' }],
    ['blank order number', { order_no: '  ' }],
    ['control character in order number', { order_no: 'QX\n01J00000000000000000000008' }],
    ['invalid customer ULID', { customer_id: 'customer' }],
    ['invalid agent ULID', { agent_id: 'agent' }],
    ['invalid leap date', { date_from: '2026-02-29' }],
    ['non-calendar date', { date_to: '26-08-2026' }],
    ['reversed dates', { date_from: '2026-08-27', date_to: '2026-08-26' }],
    ['integer amount', { min_amount: '19' }],
    ['leading-zero amount', { max_amount: '019.00' }],
    ['negative amount', { min_amount: '-0.01' }],
    ['amount above Decimal(18,2)', { max_amount: '10000000000000000.00' }],
    ['pagination offset above PostgreSQL integer', { page: '2147483647', page_size: '2' }],
    ['reversed amount bounds', { min_amount: '100.00', max_amount: '99.99' }],
  ])('rejects %s', (_label, value) => {
    expect(() => parseAdminOrderListQuery(value)).toThrowError(ApplicationError);
  });

  it('accepts only a ULID order path parameter', () => {
    expect(parseAdminOrderId(ORDER_ID)).toBe(ORDER_ID);
    expect(() => parseAdminOrderId('not-an-order')).toThrowError(ApplicationError);
  });

  it('normalizes the exact fulfillment purpose and reason headers', () => {
    expect(parseAdminFulfillmentAddressAccessHeaders(
      'ORDER_FULFILLMENT',
      '  Prepare the single parcel  ',
    )).toEqual({
      purpose: 'ORDER_FULFILLMENT',
      reason: 'Prepare the single parcel',
    });
    expect(parseAdminFulfillmentAddressAccessHeaders('ORDER_FULFILLMENT', '发货核对地址')).toEqual({
      purpose: 'ORDER_FULFILLMENT',
      reason: '发货核对地址',
    });
  });

  it.each([
    ['missing purpose', undefined, 'Prepare shipment'],
    ['wrong purpose', 'CUSTOMER_EXPORT', 'Prepare shipment'],
    ['duplicate purpose', ['ORDER_FULFILLMENT'], 'Prepare shipment'],
    ['missing reason', 'ORDER_FULFILLMENT', undefined],
    ['short trimmed reason', 'ORDER_FULFILLMENT', '  four  '],
    ['long reason', 'ORDER_FULFILLMENT', 'r'.repeat(201)],
    ['C0 control character', 'ORDER_FULFILLMENT', 'Ship\norder'],
    ['C1 control character', 'ORDER_FULFILLMENT', `Ship${String.fromCodePoint(0x85)}order`],
    ['duplicate reason', 'ORDER_FULFILLMENT', ['Prepare shipment']],
  ])('rejects %s', (_label, purpose, reason) => {
    expect(() => parseAdminFulfillmentAddressAccessHeaders(purpose, reason))
      .toThrowError(ApplicationError);
  });
});
