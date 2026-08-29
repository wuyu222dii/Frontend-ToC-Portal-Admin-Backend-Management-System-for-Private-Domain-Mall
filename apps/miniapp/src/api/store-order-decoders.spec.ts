import { describe, expect, it } from 'vitest';

import { StoreEnvelopeFormatError } from './store-client';
import {
  decodeCheckoutQuote,
  decodeStoreOrder,
  decodeStoreOrderDetail,
  decodeStoreOrderList,
} from './store-order-decoders';

const PRODUCT_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const ADDRESS_ID = '01J20000000000000000000000';
const QUOTE_ID = '01J30000000000000000000000';
const ORDER_ID = '01J40000000000000000000000';
const ORDER_ITEM_ID = '01J50000000000000000000000';
const AFTERSALE_ID = '01J60000000000000000000000';
const HASH = 'a'.repeat(64);
const PHONE = ['100', '0000', '0000'].join('');

function readyQuote() {
  return {
    quote_id: QUOTE_ID,
    source: 'CART',
    address: {
      address_id: ADDRESS_ID,
      recipient_name_masked: '张*',
      phone_masked: '100 **** 0000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail_masked: '文*路',
      is_default: true,
      version: 3,
    },
    items: [{
      product_id: PRODUCT_ID,
      product_name: '青序洗护套装',
      sku_id: SKU_ID,
      sku_name: '标准装',
      spec_json: { attributes: [{ name: '容量', value: '500ml' }] },
      primary_image_url: 'https://assets.example.test/public/product.png',
      quantity: 2,
      unit_price: '39.00',
      line_amount: '78.00',
      available_stock: 8,
      saleable: true,
    }],
    goods_amount: '78.00',
    shipping_amount: '0.00',
    payable_amount: '78.00',
    can_submit: true,
    blockers: [],
    quote_token: 'quote-token-at-least-twenty-characters',
    confirmation_hash: HASH,
    expires_at: '2026-08-29T01:05:00.000Z',
    server_time: '2026-08-29T01:00:00.000Z',
  };
}

function storeOrder() {
  return {
    order_id: ORDER_ID,
    order_no: `QX${ORDER_ID}`,
    order_status: 'PENDING_PAYMENT',
    payment_status: 'UNPAID',
    refund_progress_status: 'NONE',
    refund_processing_status: 'IDLE',
    fulfillment_status: 'NOT_STARTED',
    close_reason: null,
    completion_reason: null,
    payment_resolution: 'NORMAL',
    display_status: '待付款',
    pay_expires_at: '2026-08-29T01:30:00.000Z',
    server_time: '2026-08-29T01:00:00.000Z',
    amounts: {
      goods: '78.00', shipping: '0.00', payable: '78.00', paid: '0.00', refunded: '0.00',
    },
    items: [{
      order_item_id: ORDER_ITEM_ID,
      product_id: PRODUCT_ID,
      sku_id: SKU_ID,
      product_name: '青序洗护套装',
      sku_name: '标准装',
      unit_price: '39.00',
      quantity: 2,
      line_amount: '78.00',
      refunded_quantity: 0,
      reserved_aftersale_quantity: 0,
      shipped_quantity: 0,
    }],
  };
}

function compactItem() {
  return {
    order_item_id: ORDER_ITEM_ID,
    product_id: PRODUCT_ID,
    sku_id: SKU_ID,
    product_name: '青序洗护套装',
    sku_name: '标准装',
    primary_image_url: null,
    quantity: 2,
    line_amount: '78.00',
  };
}

function listItem() {
  const order = storeOrder();
  return {
    order_id: order.order_id,
    order_no: order.order_no,
    order_status: order.order_status,
    payment_status: order.payment_status,
    refund_progress_status: order.refund_progress_status,
    refund_processing_status: order.refund_processing_status,
    fulfillment_status: order.fulfillment_status,
    close_reason: order.close_reason,
    completion_reason: order.completion_reason,
    payment_resolution: order.payment_resolution,
    display_status: order.display_status,
    payable_amount: order.amounts.payable,
    items: [compactItem()],
    pay_expires_at: order.pay_expires_at,
    available_actions: ['CANCEL'],
    aftersale_summary: {
      active_count: 1,
      latest_aftersale_id: AFTERSALE_ID,
      latest_status: 'PENDING_REVIEW',
      refunded_amount: '0.00',
    },
    created_at: '2026-08-29T01:00:00.000Z',
  };
}

function orderDetail() {
  return {
    ...storeOrder(),
    shipping_address: {
      recipient_name: '张三',
      phone: PHONE,
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail: '文一路 1 号',
    },
    available_actions: ['CANCEL'],
    timeline: [{
      event_id: 'order-created',
      axis: 'ORDER',
      event: 'CREATED',
      from_status: null,
      to_status: 'PENDING_PAYMENT',
      occurred_at: '2026-08-29T01:00:00.000Z',
    }],
    packages: [],
    aftersales: [],
    payment_attempts: [],
    refund_attempts: [],
    errors: [],
    version: 1,
  };
}

describe('B9 checkout quote decoder', () => {
  it('accepts exact ready and blocked capabilities', () => {
    expect(decodeCheckoutQuote(readyQuote())).toEqual(readyQuote());

    const blocked = {
      ...readyQuote(),
      can_submit: false,
      blockers: ['INSUFFICIENT_STOCK'],
      quote_token: null,
      confirmation_hash: null,
      expires_at: null,
    };
    expect(decodeCheckoutQuote(blocked)).toEqual(blocked);
  });

  it.each([
    { ...readyQuote(), extra: true },
    { ...readyQuote(), quote_token: null },
    { ...readyQuote(), quote_token: 'x'.repeat(31) },
    { ...readyQuote(), quote_token: 'x'.repeat(513) },
    { ...readyQuote(), confirmation_hash: null },
    { ...readyQuote(), blockers: ['ITEM_UNAVAILABLE'] },
    {
      ...readyQuote(), can_submit: false, blockers: [], quote_token: null,
      confirmation_hash: null, expires_at: null,
    },
    {
      ...readyQuote(), can_submit: false, blockers: ['ITEM_UNAVAILABLE'],
      quote_token: 'capability-must-not-survive-blocker', confirmation_hash: null, expires_at: null,
    },
    {
      ...readyQuote(), can_submit: false, blockers: ['ITEM_UNAVAILABLE', 'ITEM_UNAVAILABLE'],
      quote_token: null, confirmation_hash: null, expires_at: null,
    },
    { ...readyQuote(), shipping_amount: '1.00' },
    { ...readyQuote(), items: [{ ...readyQuote().items[0], extra: true }] },
    { ...readyQuote(), source: 'BUY_NOW', items: [readyQuote().items[0], readyQuote().items[0]] },
  ])('rejects field drift or a contradictory quote capability', (value) => {
    expect(() => decodeCheckoutQuote(value)).toThrow(StoreEnvelopeFormatError);
  });
});

describe('B9 order response decoders', () => {
  it('accepts exact create, list and detail projections', () => {
    expect(decodeStoreOrder(storeOrder())).toEqual(storeOrder());
    expect(decodeStoreOrderList({
      items: [listItem()],
      pagination: { page: 1, page_size: 20, total: 1 },
    })).toEqual({
      items: [listItem()],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
    expect(decodeStoreOrderDetail(orderDetail())).toEqual(orderDetail());
  });

  it.each([
    { ...storeOrder(), extra: true },
    { ...storeOrder(), order_no: `QX${PRODUCT_ID}` },
    { ...storeOrder(), order_status: 'UNKNOWN' },
    { ...storeOrder(), display_status: '未知命令状态' },
    { ...storeOrder(), items: [] },
    { ...storeOrder(), amounts: { ...storeOrder().amounts, payable: '78' } },
  ])('rejects malformed create-order projections', (value) => {
    expect(() => decodeStoreOrder(value)).toThrow(StoreEnvelopeFormatError);
  });

  it('rejects list and detail surfaces that expose unsupported B10 actions or payloads', () => {
    expect(() => decodeStoreOrderList({
      items: [{ ...listItem(), available_actions: ['PAY'] }],
      pagination: { page: 1, page_size: 20, total: 1 },
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeStoreOrderDetail({
      ...orderDetail(),
      packages: [{ package_id: 'future' }],
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeStoreOrderDetail({
      ...orderDetail(),
      shipping_address: { ...orderDetail().shipping_address, phone: 'not-ascii' },
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeStoreOrderDetail({
      ...orderDetail(),
      timeline: [{ ...orderDetail().timeline[0], extra: true }],
    })).toThrow(StoreEnvelopeFormatError);
  });

  it('keeps detail display copy server-driven while command responses stay closed', () => {
    const detail = { ...orderDetail(), display_status: '待付款·请尽快处理' };
    expect(decodeStoreOrderDetail(detail).display_status).toBe(detail.display_status);
  });
});
