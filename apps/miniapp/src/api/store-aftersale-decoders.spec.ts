import { describe, expect, it } from 'vitest';

import { StoreEnvelopeFormatError } from './store-client';
import {
  decodeStoreAftersale,
  decodeStoreAftersaleDetail,
  decodeStoreAftersaleList,
  decodeStoreAftersalePreview,
} from './store-aftersale-decoders';

const AFTERSALE_ID = '01J00000000000000000000000';
const AFTERSALE_ITEM_ID = '01J10000000000000000000000';
const ORDER_ID = '01J20000000000000000000000';
const ORDER_ITEM_ID = '01J30000000000000000000000';
const REFUND_ID = '01J40000000000000000000000';
const INSPECTION_ID = '01J50000000000000000000000';
const FILE_ID = '01J60000000000000000000000';
const EVENT_ID = '01J70000000000000000000000';
const TIME = '2026-09-01T01:02:03.000Z';

function preview() {
  return {
    can_submit: true,
    blockers: [],
    items: [{
      order_item_id: ORDER_ITEM_ID,
      requested_quantity: 1,
      remaining_refundable_quantity: 2,
      allocated_amount: '39.00',
      remaining_refundable_amount: '78.00',
    }],
    requested_amount: '39.00',
    preview_token: 'preview-token-at-least-16',
    confirmation_hash: 'a'.repeat(64),
    expires_at: TIME,
  };
}

function summary() {
  return {
    aftersale_id: AFTERSALE_ID,
    aftersale_no: `AS${AFTERSALE_ID}`,
    type: 'RETURN_REFUND',
    status: 'WAITING_RECEIPT',
    items: [{
      aftersale_item_id: AFTERSALE_ITEM_ID,
      order_item_id: ORDER_ITEM_ID,
      quantity: 1,
      allocated_amount: '39.00',
      approved_refund_qty: 1,
    }],
  };
}

function listItem() {
  return {
    aftersale_id: AFTERSALE_ID,
    aftersale_no: `AS${AFTERSALE_ID}`,
    order_id: ORDER_ID,
    type: 'RETURN_REFUND',
    status: 'WAITING_RECEIPT',
    refund_progress_status: 'NONE',
    refund_processing_status: 'IDLE',
    available_actions: ['VIEW_ORDER'],
    requested_amount: '39.00',
    created_at: TIME,
  };
}

function detail() {
  return {
    aftersale_id: AFTERSALE_ID,
    aftersale_no: `AS${AFTERSALE_ID}`,
    order: {
      order_id: ORDER_ID,
      order_no: `QX${ORDER_ID}`,
      display_status: '运输中',
      payable_amount: '78.00',
      paid_at: TIME,
    },
    type: 'RETURN_REFUND',
    status: 'RETURN_EXCEPTION',
    reason: '商品破损',
    items: [{
      aftersale_item_id: AFTERSALE_ITEM_ID,
      order_item_id: ORDER_ITEM_ID,
      product_name: '洗护套装',
      sku_name: '标准装',
      requested_quantity: 1,
      allocated_amount: '39.00',
      reserved_quantity: 1,
      reserved_amount: '39.00',
      approved_refund_quantity: 1,
      refunded_quantity: 0,
    }],
    return_address: {
      recipient_name: '总部收件',
      phone: '40000000000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail: '文一路 1 号',
    },
    return_shipment: {
      carrier_code: 'SF',
      carrier_name: '顺丰速运',
      tracking_no: 'SF/001-1',
      submitted_at: TIME,
    },
    inspection: {
      inspection_id: INSPECTION_ID,
      result: 'ABNORMAL',
      abnormal_reason: '验货数量异常',
      evidence_file_ids: [FILE_ID],
      items: [{
        order_item_id: ORDER_ITEM_ID,
        received_qty: 1,
        approved_refund_qty: 1,
        restock_qty: 0,
        damaged_qty: 1,
        scrap_qty: 0,
        return_to_customer_qty: 0,
      }],
      inspected_at: TIME,
      resolution: null,
      resolution_reason: null,
      resolved_at: null,
    },
    refund_attempts: [{
      refund_id: REFUND_ID,
      refund_no: `RF${REFUND_ID}`,
      attempt_no: 1,
      origin_type: 'AFTERSALE',
      status: 'FAILED',
      amount: '39.00',
      last_error: {
        error_code: 'REFUND_FAILED',
        message: '退款未完成',
        retryable: true,
        occurred_at: TIME,
      },
      created_at: TIME,
      updated_at: TIME,
    }],
    available_actions: ['VIEW_ORDER'],
    timeline: [{
      event_id: EVENT_ID,
      event: 'INSPECTION_RECORDED',
      from_status: 'WAITING_RECEIPT',
      to_status: 'RETURN_EXCEPTION',
      operator_role: 'SUPER_ADMIN',
      occurred_at: TIME,
    }],
    errors: [],
    created_at: TIME,
    version: 3,
  };
}

describe('B12 Store aftersale decoders', () => {
  it('accepts exact ready and blocked preview capabilities', () => {
    expect(decodeStoreAftersalePreview(preview())).toEqual(preview());
    const blocked = {
      ...preview(),
      can_submit: false,
      blockers: ['AFTERSALE_QUOTA_EXCEEDED'],
      preview_token: null,
      confirmation_hash: null,
      expires_at: null,
    };
    expect(decodeStoreAftersalePreview(blocked)).toEqual(blocked);
  });

  it.each([
    { ...preview(), extra: true },
    { ...preview(), blockers: ['ITEM_UNAVAILABLE'] },
    { ...preview(), confirmation_hash: 'A'.repeat(64) },
    { ...preview(), requested_amount: '39' },
    { ...preview(), expires_at: '2026-09-01 01:02:03Z' },
    { ...preview(), items: [preview().items[0], preview().items[0]] },
    {
      ...preview(), can_submit: false, blockers: [], preview_token: null,
      confirmation_hash: null, expires_at: null,
    },
  ])('rejects malformed or contradictory previews', (value) => {
    expect(() => decodeStoreAftersalePreview(value)).toThrow(StoreEnvelopeFormatError);
  });

  it('accepts exact summary, list and detail projections', () => {
    expect(decodeStoreAftersale(summary())).toEqual(summary());
    expect(decodeStoreAftersaleList({
      items: [listItem()],
      pagination: { page: 1, page_size: 20, total: 1 },
    })).toEqual({ items: [listItem()], pagination: { page: 1, page_size: 20, total: 1 } });
    expect(decodeStoreAftersaleDetail(detail())).toEqual(detail());
  });

  it.each([
    { ...summary(), status: 'OPEN' },
    { ...summary(), aftersale_no: `XX${AFTERSALE_ID}` },
    { ...summary(), items: [summary().items[0], summary().items[0]] },
    { ...summary(), items: [{ ...summary().items[0], allocated_amount: '-1.00' }] },
  ])('rejects malformed summary projections', (value) => {
    expect(() => decodeStoreAftersale(value)).toThrow(StoreEnvelopeFormatError);
  });

  it.each([
    { ...detail(), extra: true },
    { ...detail(), available_actions: ['VIEW_ORDER', 'VIEW_ORDER'] },
    { ...detail(), refund_attempts: [{ ...detail().refund_attempts[0], origin_type: 'LATE_PAYMENT' }] },
    { ...detail(), timeline: [{ ...detail().timeline[0], operator_role: 'ADMIN' }] },
    { ...detail(), inspection: { ...detail().inspection, evidence_file_ids: [FILE_ID, FILE_ID] } },
    {
      ...detail(), inspection: {
        ...detail().inspection,
        items: [{ ...detail().inspection.items[0], restock_qty: 1 }],
      },
    },
    {
      ...detail(), inspection: {
        ...detail().inspection,
        items: [{
          ...detail().inspection.items[0],
          approved_refund_qty: 0,
          damaged_qty: 0,
          restock_qty: 1,
        }],
      },
    },
    {
      ...detail(), inspection: {
        ...detail().inspection,
        abnormal_reason: null,
        items: [{
          ...detail().inspection.items[0],
          damaged_qty: 0,
          restock_qty: 1,
        }],
        resolution: 'CONTINUE_REFUND',
        resolution_reason: '不应处置 PASS 验货',
        resolved_at: TIME,
        result: 'PASS',
      },
    },
    {
      ...detail(), inspection: {
        ...detail().inspection,
        resolution: 'CONTINUE_REFUND',
        resolution_reason: null,
        resolved_at: TIME,
      },
    },
  ])('rejects field drift, invalid enums, or duplicate and inconsistent facts', (value) => {
    expect(() => decodeStoreAftersaleDetail(value)).toThrow(StoreEnvelopeFormatError);
  });
});
