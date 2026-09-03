import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseAgentCustomerListQuery,
  parseAgentOperationsResourceId,
  parseAgentOrderListQuery,
} from './agent-operations.dto';

describe('Agent operations DTO', () => {
  it('strictly parses customer pagination and Shanghai inclusive calendar dates', () => {
    expect(parseAgentCustomerListQuery({
      date_from: '2026-09-01',
      date_to: '2026-09-03',
      keyword: '  customer_abc  ',
      page: '2',
      page_size: '50',
    })).toEqual({
      boundAtFrom: new Date('2026-08-31T16:00:00.000Z'),
      boundAtToExclusive: new Date('2026-09-03T16:00:00.000Z'),
      keyword: 'customer_abc',
      page: 2,
      pageSize: 50,
    });
    expect(() => parseAgentCustomerListQuery({ binding_status: 'ENDED' })).toThrow();
    expect(() => parseAgentCustomerListQuery({ date_from: '2026-09-04', date_to: '2026-09-03' })).toThrow();
  });

  it('parses all order filters without accepting unsupported state axes', () => {
    const customerId = generateUlid(new Date('2026-09-03T00:00:00.000Z').getTime());
    expect(parseAgentOrderListQuery({
      customer_id: customerId,
      fulfillment_status: 'SHIPPED',
      has_aftersale: 'false',
      max_amount: '99.90',
      min_amount: '10.00',
      order_status: 'SHIPPING',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'PARTIAL',
      sort: 'AMOUNT_DESC',
    })).toMatchObject({
      customerId,
      fulfillmentStatus: 'SHIPPED',
      hasAftersale: false,
      maxAmount: '99.90',
      minAmount: '10.00',
      orderStatus: 'SHIPPING',
      page: 1,
      pageSize: 20,
      refundProcessingStatus: 'IDLE',
      refundProgressStatus: 'PARTIAL',
      sort: 'AMOUNT_DESC',
    });
    expect(() => parseAgentOrderListQuery({ payment_status: 'UNPAID' })).toThrow();
    expect(() => parseAgentOrderListQuery({ has_aftersale: '1' })).toThrow();
    expect(() => parseAgentOrderListQuery({ min_amount: '10.01', max_amount: '10.00' })).toThrow();
  });

  it('requires ULIDs for both resource paths', () => {
    const resourceId = generateUlid(new Date('2026-09-03T00:00:00.000Z').getTime());
    expect(parseAgentOperationsResourceId(resourceId, 'order_id')).toBe(resourceId);
    expect(() => parseAgentOperationsResourceId('other-agent-order', 'order_id')).toThrow();
  });
});
