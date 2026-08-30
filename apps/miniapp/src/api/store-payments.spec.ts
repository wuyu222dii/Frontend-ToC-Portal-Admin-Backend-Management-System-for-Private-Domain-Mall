import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStorePaymentIntent, submitStoreMockPaymentResult } from './store-payments';

const mocks = vi.hoisted(() => ({ authenticatedRequest: vi.fn() }));

vi.mock('./store-identity', () => ({ authenticatedRequest: mocks.authenticatedRequest }));

const ORDER_ID = '01J00000000000000000000000';
const PAYMENT_INTENT_ID = '01J10000000000000000000000';

describe('B10 authenticated payment client', () => {
  afterEach(() => mocks.authenticatedRequest.mockReset());

  it('creates or reuses an intent without a provider body and with caller-stable facts', () => {
    void createStorePaymentIntent(ORDER_ID, 4, 'fixed-payment-key');

    expect(mocks.authenticatedRequest).toHaveBeenCalledWith(
      `/store/orders/${ORDER_ID}/payment-intents`,
      {
        decode: expect.any(Function),
        headers: { 'Idempotency-Key': 'fixed-payment-key', 'If-Match': '"4"' },
        method: 'POST',
      },
    );
  });

  it('submits only a closed Mock result and requires the exact 202 response', () => {
    void submitStoreMockPaymentResult(PAYMENT_INTENT_ID, { result: 'SUCCEEDED' }, 'fixed-result-key');

    expect(mocks.authenticatedRequest).toHaveBeenCalledWith(
      `/store/mock-payments/${PAYMENT_INTENT_ID}/result`,
      {
        data: { result: 'SUCCEEDED' },
        decode: expect.any(Function),
        expectedStatus: 202,
        headers: { 'Idempotency-Key': 'fixed-result-key' },
        method: 'POST',
      },
    );
  });

  it('rejects malformed IDs and versions before network execution', () => {
    expect(() => createStorePaymentIntent(ORDER_ID.toLowerCase(), 1, 'key'))
      .toThrow('order_id is invalid');
    expect(() => createStorePaymentIntent(ORDER_ID, 0, 'key')).toThrow('version is invalid');
    expect(() => submitStoreMockPaymentResult(PAYMENT_INTENT_ID.toLowerCase(), {
      result: 'FAILED',
    }, 'key')).toThrow('payment_intent_id is invalid');
    expect(() => submitStoreMockPaymentResult(PAYMENT_INTENT_ID, {
      result: 'SUCCEEDED_LATE',
    } as never, 'key')).toThrow('payment result is invalid');
    expect(() => submitStoreMockPaymentResult(PAYMENT_INTENT_ID, {
      result: 'SUCCEEDED', extra: true,
    } as never, 'key')).toThrow('payment result is invalid');
    expect(mocks.authenticatedRequest).not.toHaveBeenCalled();
  });
});
