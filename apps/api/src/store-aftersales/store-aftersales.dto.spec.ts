import { describe, expect, it } from 'vitest';

import {
  parseStoreAftersaleCancelBody,
  parseStoreAftersaleCreateBody,
  parseStoreAftersaleId,
  parseStoreAftersaleListQuery,
  parseStoreAftersaleReturnShipmentBody,
} from './store-aftersales.dto';

const ORDER_ID = '01J00000000000000000000001';
const ORDER_ITEM_ID = '01J00000000000000000000002';
const OTHER_ORDER_ITEM_ID = '01J00000000000000000000003';
const FILE_ID = '01J00000000000000000000004';
const OTHER_FILE_ID = '01J00000000000000000000005';
const AFTERSALE_ID = '01J00000000000000000000006';

function preview(overrides: Record<string, unknown> = {}) {
  return {
    action: 'PREVIEW',
    evidence_file_ids: [OTHER_FILE_ID, FILE_ID],
    items: [
      { order_item_id: OTHER_ORDER_ITEM_ID, quantity: 1 },
      { order_item_id: ORDER_ITEM_ID, quantity: 2 },
    ],
    order_id: ORDER_ID,
    reason_code: 'ITEM_DAMAGED',
    reason_text: '  outer packaging damaged  ',
    type: 'RETURN_REFUND',
    ...overrides,
  };
}

function confirm(overrides: Record<string, unknown> = {}) {
  return {
    ...preview(),
    action: 'CONFIRM',
    confirmation_hash: 'a'.repeat(64),
    preview_token: 'p'.repeat(16),
    ...overrides,
  };
}

function expectInvalid(
  value: unknown,
  parser: (input: unknown) => unknown = parseStoreAftersaleCreateBody,
): void {
  expect(() => parser(value)).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
}

describe('B12.1 Store aftersale DTO', () => {
  it('normalizes the closed PREVIEW request and canonicalizes item and evidence order', () => {
    expect(parseStoreAftersaleCreateBody(preview())).toEqual({
      action: 'PREVIEW',
      evidenceFileIds: [FILE_ID, OTHER_FILE_ID],
      items: [
        { orderItemId: ORDER_ITEM_ID, quantity: 2 },
        { orderItemId: OTHER_ORDER_ITEM_ID, quantity: 1 },
      ],
      orderId: ORDER_ID,
      reasonCode: 'ITEM_DAMAGED',
      reasonText: 'outer packaging damaged',
      type: 'RETURN_REFUND',
    });
  });

  it('normalizes optional fields and accepts the exact CONFIRM shape', () => {
    expect(parseStoreAftersaleCreateBody(confirm({
      evidence_file_ids: undefined,
      reason_text: undefined,
      type: 'REFUND_ONLY',
    }))).toEqual({
      action: 'CONFIRM',
      confirmationHash: 'a'.repeat(64),
      evidenceFileIds: [],
      items: [
        { orderItemId: ORDER_ITEM_ID, quantity: 2 },
        { orderItemId: OTHER_ORDER_ITEM_ID, quantity: 1 },
      ],
      orderId: ORDER_ID,
      previewToken: 'p'.repeat(16),
      reasonCode: 'ITEM_DAMAGED',
      reasonText: null,
      type: 'REFUND_ONLY',
    });
  });

  it('requires a valid reason_text for OTHER and rejects control characters before trimming', () => {
    expect(parseStoreAftersaleCreateBody(preview({
      reason_code: 'OTHER',
      reason_text: '  changed my mind  ',
    }))).toMatchObject({ reasonCode: 'OTHER', reasonText: 'changed my mind' });
    expectInvalid(preview({ reason_code: 'OTHER', reason_text: undefined }));
    expectInvalid(preview({ reason_code: 'OTHER', reason_text: null }));
    expectInvalid(preview({ reason_text: ' damaged\n' }));
    expectInvalid(preview({ reason_text: ' '.repeat(3) }));
    expectInvalid(preview({ reason_text: 'x'.repeat(501) }));
  });

  it.each([
    ['non-object', null],
    ['invalid action', preview({ action: 'CREATE' })],
    ['unknown PREVIEW field', preview({ preview_token: 'p'.repeat(16) })],
    ['unknown field', preview({ amount: '1.00' })],
    ['missing order', (() => {
      const value: Partial<ReturnType<typeof preview>> = preview();
      delete value.order_id;
      return value;
    })()],
    ['invalid order', preview({ order_id: 'order' })],
    ['invalid type', preview({ type: 'EXCHANGE' })],
    ['invalid reason code', preview({ reason_code: 'UNKNOWN' })],
    ['empty items', preview({ items: [] })],
    ['too many items', preview({ items: Array.from({ length: 101 }, (_, index) => ({
      order_item_id: `${String(index).padStart(2, '0')}J0000000000000000000000`, quantity: 1,
    })) })],
    ['open item', preview({ items: [{ order_item_id: ORDER_ITEM_ID, quantity: 1, amount: '1.00' }] })],
    ['invalid item ID', preview({ items: [{ order_item_id: 'item', quantity: 1 }] })],
    ['zero quantity', preview({ items: [{ order_item_id: ORDER_ITEM_ID, quantity: 0 }] })],
    ['fractional quantity', preview({ items: [{ order_item_id: ORDER_ITEM_ID, quantity: 1.5 }] })],
    ['excess quantity', preview({ items: [{ order_item_id: ORDER_ITEM_ID, quantity: 100 }] })],
    ['duplicate items', preview({ items: [
      { order_item_id: ORDER_ITEM_ID, quantity: 1 },
      { order_item_id: ORDER_ITEM_ID, quantity: 2 },
    ] })],
    ['too many evidence files', preview({ evidence_file_ids: Array(10).fill(FILE_ID) })],
    ['invalid evidence file', preview({ evidence_file_ids: ['file'] })],
    ['duplicate evidence files', preview({ evidence_file_ids: [FILE_ID, FILE_ID] })],
    ['missing CONFIRM token', (() => {
      const value: Partial<ReturnType<typeof confirm>> = confirm();
      delete value.preview_token;
      return value;
    })()],
    ['short CONFIRM token', confirm({ preview_token: 'p'.repeat(15) })],
    ['long CONFIRM token', confirm({ preview_token: 'p'.repeat(513) })],
    ['invalid confirmation hash', confirm({ confirmation_hash: 'A'.repeat(64) })],
  ])('rejects %s', (_label, value) => expectInvalid(value));

  it('parses path IDs and a closed list query with Shanghai date boundaries', () => {
    expect(parseStoreAftersaleId(AFTERSALE_ID)).toBe(AFTERSALE_ID);
    expect(parseStoreAftersaleListQuery({
      aftersale_no: '  AS-100  ',
      date_from: '2026-08-31',
      date_to: '2026-09-01',
      order_id: ORDER_ID,
      page: '2',
      page_size: '50',
      status: 'PENDING_REVIEW',
      type: 'RETURN_REFUND',
    })).toEqual({
      aftersaleNo: 'AS-100',
      createdAtFrom: new Date('2026-08-30T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-01T16:00:00.000Z'),
      orderId: ORDER_ID,
      page: 2,
      pageSize: 50,
      status: 'PENDING_REVIEW',
      type: 'RETURN_REFUND',
    });
    expect(parseStoreAftersaleListQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseStoreAftersaleListQuery({ aftersale_no: `  ${'售'.repeat(32)}  ` })).toEqual({
      aftersaleNo: '售'.repeat(32),
      page: 1,
      pageSize: 20,
    });
  });

  it.each([
    ['invalid path', () => parseStoreAftersaleId('aftersale')],
    ['unknown query', () => parseStoreAftersaleListQuery({ sort: 'CREATED_DESC' })],
    ['array query', () => parseStoreAftersaleListQuery({ status: ['PENDING_REVIEW'] })],
    ['invalid page', () => parseStoreAftersaleListQuery({ page: '0' })],
    ['invalid page size', () => parseStoreAftersaleListQuery({ page_size: '101' })],
    ['offset overflow', () => parseStoreAftersaleListQuery({ page: '2147483647', page_size: '100' })],
    ['blank number', () => parseStoreAftersaleListQuery({ aftersale_no: '  ' })],
    ['overlong number', () => parseStoreAftersaleListQuery({ aftersale_no: 'A'.repeat(33) })],
    ['control character', () => parseStoreAftersaleListQuery({ aftersale_no: 'AS\n1' })],
    ['invalid order ID', () => parseStoreAftersaleListQuery({ order_id: 'order' })],
    ['invalid status', () => parseStoreAftersaleListQuery({ status: 'OPEN' })],
    ['invalid type', () => parseStoreAftersaleListQuery({ type: 'EXCHANGE' })],
    ['invalid calendar date', () => parseStoreAftersaleListQuery({ date_from: '2026-02-30' })],
    ['reversed dates', () => parseStoreAftersaleListQuery({ date_from: '2026-09-02', date_to: '2026-09-01' })],
  ])('rejects %s at the read boundary', (_label, parse) => {
    expect(parse).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('parses the closed optional cancellation reason', () => {
    expect(parseStoreAftersaleCancelBody({})).toEqual({});
    expect(parseStoreAftersaleCancelBody({ reason: '  no longer needed  ' })).toEqual({
      reason: 'no longer needed',
    });
  });

  it.each([
    null,
    { reason: null },
    { reason: ' ' },
    { reason: 'cancel\n' },
    { reason: 'x'.repeat(501) },
    { reason: 'valid reason', status: 'CANCELLED' },
  ])('rejects an invalid cancellation body', (value) => {
    expectInvalid(value, parseStoreAftersaleCancelBody);
  });

  it('normalizes the closed return shipment request', () => {
    expect(parseStoreAftersaleReturnShipmentBody({
      carrier_code: '  NZ-POST  ',
      carrier_name: '  NZ Post  ',
      tracking_no: '  TRACK/001  ',
    })).toEqual({
      carrierCode: 'NZ-POST',
      carrierName: 'NZ Post',
      trackingNo: 'TRACK/001',
    });
  });

  it.each([
    null,
    {},
    { carrier_code: 'NZ POST', carrier_name: 'NZ Post', tracking_no: 'TRACK1' },
    { carrier_code: 'NZ', carrier_name: ' ', tracking_no: 'TRACK1' },
    { carrier_code: 'NZ', carrier_name: 'NZ\nPost', tracking_no: 'TRACK1' },
    { carrier_code: 'NZ', carrier_name: 'NZ Post', tracking_no: 'TRACK 1' },
    { carrier_code: 'NZ', carrier_name: 'NZ Post', tracking_no: 'TRACK1', extra: true },
  ])('rejects an invalid return shipment body', (value) => {
    expectInvalid(value, parseStoreAftersaleReturnShipmentBody);
  });
});
