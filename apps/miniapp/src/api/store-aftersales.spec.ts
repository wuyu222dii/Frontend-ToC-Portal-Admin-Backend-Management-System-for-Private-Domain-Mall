import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelStoreAftersale,
  confirmStoreAftersale,
  getStoreAftersale,
  listStoreAftersales,
  previewStoreAftersale,
  submitStoreAftersaleReturnShipment,
} from './store-aftersales';

const mocks = vi.hoisted(() => ({
  authenticatedRequest: vi.fn(),
  createIdempotencyKey: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
}));

vi.mock('./store-identity', () => ({
  authenticatedRequest: mocks.authenticatedRequest,
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

const AFTERSALE_ID = '01J00000000000000000000000';
const ORDER_ID = '01J10000000000000000000000';
const ORDER_ITEM_ID = '01J20000000000000000000000';
const FILE_ID = '01J30000000000000000000000';

const previewInput = {
  action: 'PREVIEW' as const,
  order_id: ORDER_ID,
  type: 'RETURN_REFUND' as const,
  reason_code: 'ITEM_DAMAGED' as const,
  items: [{ order_item_id: ORDER_ITEM_ID, quantity: 1 }],
  evidence_file_ids: [FILE_ID],
};

describe('B12 authenticated Store aftersale client', () => {
  afterEach(() => {
    mocks.authenticatedRequest.mockReset();
    mocks.createIdempotencyKey.mockClear();
  });

  it('uses distinct exact 200 and 201 requests for preview and confirm', () => {
    void previewStoreAftersale(previewInput, 'preview-key');
    void confirmStoreAftersale({
      ...previewInput,
      action: 'CONFIRM',
      preview_token: 'preview-token-at-least-16',
      confirmation_hash: 'a'.repeat(64),
    }, 'confirm-key');

    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(1, '/store/aftersales', {
      data: previewInput,
      decode: expect.any(Function),
      expectedStatus: 200,
      headers: { 'Idempotency-Key': 'preview-key' },
      method: 'POST',
    });
    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(2, '/store/aftersales', {
      data: {
        ...previewInput,
        action: 'CONFIRM',
        preview_token: 'preview-token-at-least-16',
        confirmation_hash: 'a'.repeat(64),
      },
      decode: expect.any(Function),
      expectedStatus: 201,
      headers: { 'Idempotency-Key': 'confirm-key' },
      method: 'POST',
    });
  });

  it('encodes list filters and validates one detail path', () => {
    void listStoreAftersales({
      page: 2,
      page_size: 10,
      order_id: ORDER_ID,
      status: 'WAITING_RETURN',
      type: 'RETURN_REFUND',
      date_from: '2026-09-01',
      date_to: '2026-09-02',
    });
    void getStoreAftersale(AFTERSALE_ID);

    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(1, '/store/aftersales', {
      decode: expect.any(Function),
      query: {
        page: 2, page_size: 10, order_id: ORDER_ID, status: 'WAITING_RETURN',
        type: 'RETURN_REFUND', date_from: '2026-09-01', date_to: '2026-09-02',
      },
    });
    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(
      2,
      `/store/aftersales/${AFTERSALE_ID}`,
      { decode: expect.any(Function) },
    );
  });

  it('sends cancel and return shipment with If-Match and stable keys', () => {
    void cancelStoreAftersale(AFTERSALE_ID, 3, { reason: '  no longer needed  ' }, 'cancel-key');
    void submitStoreAftersaleReturnShipment(AFTERSALE_ID, {
      carrier_code: ' SF ',
      carrier_name: ' 顺丰速运 ',
      tracking_no: ' SF/001-1 ',
    }, 4, 'shipment-key');

    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(
      1,
      `/store/aftersales/${AFTERSALE_ID}/cancel`,
      {
        data: { reason: 'no longer needed' },
        decode: expect.any(Function),
        expectedStatus: 200,
        headers: { 'Idempotency-Key': 'cancel-key', 'If-Match': '"3"' },
        method: 'POST',
      },
    );
    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(
      2,
      `/store/aftersales/${AFTERSALE_ID}/return-shipment`,
      {
        data: { carrier_code: 'SF', carrier_name: '顺丰速运', tracking_no: 'SF/001-1' },
        decode: expect.any(Function),
        expectedStatus: 200,
        headers: { 'Idempotency-Key': 'shipment-key', 'If-Match': '"4"' },
        method: 'POST',
      },
    );
  });

  it('generates one key for each write when the caller omits it', () => {
    void previewStoreAftersale(previewInput);
    void cancelStoreAftersale(AFTERSALE_ID, 1);
    void submitStoreAftersaleReturnShipment(AFTERSALE_ID, {
      carrier_code: 'SF', carrier_name: '顺丰', tracking_no: 'SF001',
    }, 1);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(3);
  });

  it.each([
    () => previewStoreAftersale({
      ...previewInput,
      items: [
        { order_item_id: ORDER_ITEM_ID, quantity: 1 },
        { order_item_id: ORDER_ITEM_ID, quantity: 1 },
      ],
    }),
    () => previewStoreAftersale({ ...previewInput, evidence_file_ids: [FILE_ID, FILE_ID] }),
    () => confirmStoreAftersale({
      ...previewInput, action: 'CONFIRM', preview_token: 'short', confirmation_hash: 'a'.repeat(64),
    }, 'key'),
    () => listStoreAftersales({ status: 'OPEN' } as never),
    () => listStoreAftersales({ date_from: '2026-02-30' }),
    () => getStoreAftersale(AFTERSALE_ID.toLowerCase()),
    () => cancelStoreAftersale(AFTERSALE_ID, 0),
    () => submitStoreAftersaleReturnShipment(AFTERSALE_ID, {
      carrier_code: 'SF', carrier_name: '顺丰', tracking_no: '../unsafe',
    }, 1),
  ])('rejects malformed input before network execution', (operation) => {
    expect(operation).toThrow();
    expect(mocks.authenticatedRequest).not.toHaveBeenCalled();
  });
});
