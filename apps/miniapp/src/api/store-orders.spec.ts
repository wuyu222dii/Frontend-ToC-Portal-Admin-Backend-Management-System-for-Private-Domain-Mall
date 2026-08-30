import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cancelStoreOrder,
  createCheckoutQuote,
  createStoreOrder,
  getStoreOrder,
  listStoreOrders,
} from './store-orders';

const mocks = vi.hoisted(() => ({
  authenticatedRequest: vi.fn(),
  createIdempotencyKey: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
}));

vi.mock('./store-identity', () => ({
  authenticatedRequest: mocks.authenticatedRequest,
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

const ADDRESS_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const QUOTE_ID = '01J20000000000000000000000';
const ORDER_ID = '01J30000000000000000000000';

const quoteInput = {
  source: 'CART' as const,
  address_id: ADDRESS_ID,
  items: [{ sku_id: SKU_ID, quantity: 2 }],
};

const submitInput = {
  ...quoteInput,
  quote_id: QUOTE_ID,
  quote_token: 'quote-token-at-least-twenty-characters',
  confirmation_hash: 'a'.repeat(64),
};

describe('B9 authenticated order client', () => {
  afterEach(() => {
    mocks.authenticatedRequest.mockReset();
    mocks.createIdempotencyKey.mockClear();
  });

  it('sends the exact quote body without an idempotency key', () => {
    void createCheckoutQuote(quoteInput);

    expect(mocks.authenticatedRequest).toHaveBeenCalledWith('/store/checkout/quotes', {
      data: quoteInput,
      decode: expect.any(Function),
      method: 'POST',
    });
  });

  it('requires an exact 201 and caller-stable idempotency key for order creation', () => {
    void createStoreOrder(submitInput, 'fixed-order-key');

    expect(mocks.authenticatedRequest).toHaveBeenCalledWith('/store/orders', {
      data: submitInput,
      decode: expect.any(Function),
      expectedStatus: 201,
      headers: { 'Idempotency-Key': 'fixed-order-key' },
      method: 'POST',
    });
  });

  it('encodes list filters and targets one validated order', () => {
    void listStoreOrders({
      display_group: 'PENDING_PAYMENT',
      order_status: 'PENDING_PAYMENT',
      page: 2,
      page_size: 10,
    });
    void getStoreOrder(ORDER_ID);

    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(1, '/store/orders', {
      decode: expect.any(Function),
      query: {
        display_group: 'PENDING_PAYMENT', order_status: 'PENDING_PAYMENT', page: 2, page_size: 10,
      },
    });
    expect(mocks.authenticatedRequest).toHaveBeenNthCalledWith(
      2,
      `/store/orders/${ORDER_ID}`,
      { decode: expect.any(Function) },
    );
  });

  it('sends cancellation without a body and with fixed If-Match and idempotency headers', () => {
    void cancelStoreOrder(ORDER_ID, 4, 'fixed-cancel-key');

    expect(mocks.authenticatedRequest).toHaveBeenCalledWith(`/store/orders/${ORDER_ID}/cancel`, {
      decode: expect.any(Function),
      expectedStatus: [200, 202],
      headers: { 'Idempotency-Key': 'fixed-cancel-key', 'If-Match': '"4"' },
      method: 'POST',
    });
  });

  it('generates one cancel key only when the caller does not provide one', () => {
    void cancelStoreOrder(ORDER_ID, 1);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledOnce();
    expect(mocks.authenticatedRequest).toHaveBeenCalledWith(
      `/store/orders/${ORDER_ID}/cancel`,
      expect.objectContaining({
        headers: {
          'Idempotency-Key': '123e4567-e89b-42d3-a456-426614174000',
          'If-Match': '"1"',
        },
      }),
    );
  });

  it('rejects malformed identifiers and versions before network execution', () => {
    expect(() => getStoreOrder('not-an-order')).toThrow('order_id is invalid');
    expect(() => cancelStoreOrder(ORDER_ID.toLowerCase(), 1)).toThrow('order_id is invalid');
    expect(() => cancelStoreOrder(ORDER_ID, 0)).toThrow('version is invalid');
    expect(() => cancelStoreOrder(ORDER_ID, 1.5)).toThrow('version is invalid');
    expect(mocks.authenticatedRequest).not.toHaveBeenCalled();
  });
});
