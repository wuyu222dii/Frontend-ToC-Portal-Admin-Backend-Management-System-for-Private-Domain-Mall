import { describe, expect, it } from 'vitest';

import {
  parseStoreOrderId,
  parseStoreOrderListQuery,
  parseStoreOrderSubmitBody,
} from './store-orders.dto';

const ADDRESS_ID = '01J00000000000000000000001';
const SKU_ID = '01J00000000000000000000002';
const OTHER_SKU_ID = '01J00000000000000000000003';
const QUOTE_ID = '01J00000000000000000000004';
const ORDER_ID = '01J00000000000000000000005';

function body(overrides: Record<string, unknown> = {}) {
  return {
    address_id: ADDRESS_ID,
    confirmation_hash: 'a'.repeat(64),
    items: [{ quantity: 1, sku_id: SKU_ID }],
    quote_id: QUOTE_ID,
    quote_token: 'q'.repeat(32),
    source: 'BUY_NOW',
    ...overrides,
  };
}

describe('B9.2 Store order submit DTO', () => {
  it('accepts the closed BUY_NOW shape and maps wire fields', () => {
    expect(parseStoreOrderSubmitBody(body())).toEqual({
      addressId: ADDRESS_ID,
      confirmationHash: 'a'.repeat(64),
      items: [{ quantity: 1, skuId: SKU_ID }],
      quoteId: QUOTE_ID,
      quoteToken: 'q'.repeat(32),
      source: 'BUY_NOW',
    });
  });

  it('accepts a CART request with unique SKU lines', () => {
    expect(parseStoreOrderSubmitBody(body({
      items: [
        { quantity: 2, sku_id: SKU_ID },
        { quantity: 3, sku_id: OTHER_SKU_ID },
      ],
      source: 'CART',
    })).items).toHaveLength(2);
  });

  it.each([
    ['non-object body', null],
    ['unknown field', body({ extra: true })],
    ['missing field', (() => { const value = body(); delete (value as Partial<typeof value>).quote_token; return value; })()],
    ['invalid source', body({ source: 'UNKNOWN' })],
    ['invalid address', body({ address_id: 'address' })],
    ['invalid quote ID', body({ quote_id: 'quote' })],
    ['empty items', body({ items: [] })],
    ['duplicate SKU', body({
      items: [{ quantity: 1, sku_id: SKU_ID }, { quantity: 2, sku_id: SKU_ID }],
      source: 'CART',
    })],
    ['invalid quantity', body({ items: [{ quantity: 0, sku_id: SKU_ID }] })],
    ['multiple BUY_NOW items', body({
      items: [{ quantity: 1, sku_id: SKU_ID }, { quantity: 1, sku_id: OTHER_SKU_ID }],
    })],
    ['short quote token', body({ quote_token: 'q'.repeat(31) })],
    ['long quote token', body({ quote_token: 'q'.repeat(513) })],
    ['uppercase confirmation hash', body({ confirmation_hash: 'A'.repeat(64) })],
    ['short confirmation hash', body({ confirmation_hash: 'a'.repeat(63) })],
  ])('rejects %s', (_label, value) => {
    expect(() => parseStoreOrderSubmitBody(value))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});

describe('B9.3 Store order read and cancellation DTO', () => {
  it('applies the frozen list defaults', () => {
    expect(parseStoreOrderListQuery({})).toEqual({
      displayGroup: 'ALL',
      page: 1,
      pageSize: 20,
      sort: 'CREATED_DESC',
    });
  });

  it('maps every closed filter and converts Shanghai dates to a UTC half-open interval', () => {
    expect(parseStoreOrderListQuery({
      date_from: '2026-08-25',
      date_to: '2026-08-26',
      display_group: 'REFUND_AFTERSALE',
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
      createdAtFrom: new Date('2026-08-24T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-08-26T16:00:00.000Z'),
      displayGroup: 'REFUND_AFTERSALE',
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

  it('accepts the same natural day and exact equal amount bounds', () => {
    expect(parseStoreOrderListQuery({
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
    ['open display group', { display_group: 'CLOSED' }],
    ['open order status', { order_status: 'ARCHIVED' }],
    ['open payment status', { payment_status: 'REFUNDED' }],
    ['open refund progress', { refund_progress_status: 'PENDING' }],
    ['open refund processing', { refund_processing_status: 'PENDING' }],
    ['open fulfillment status', { fulfillment_status: 'PENDING' }],
    ['open sort', { sort: 'CREATED_ASC' }],
    ['blank order number', { order_no: '  ' }],
    ['control character in order number', { order_no: 'QX\n01J00000000000000000000008' }],
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
    expect(() => parseStoreOrderListQuery(value))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('accepts only a ULID order path parameter', () => {
    expect(parseStoreOrderId(ORDER_ID)).toBe(ORDER_ID);
    expect(() => parseStoreOrderId('not-an-order'))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
