import { describe, expect, it } from 'vitest';

import { StoreEnvelopeFormatError } from './store-client';
import { decodePaymentIntent } from './store-payment-decoders';

const PAYMENT_INTENT_ID = '01J00000000000000000000000';

function paymentIntent() {
  return {
    payment_intent_id: PAYMENT_INTENT_ID,
    intent_no: `PI${PAYMENT_INTENT_ID}`,
    intent_status: 'OPEN',
    provider_payload: {
      app_id: 'wx-development',
      time_stamp: '1788000000',
      nonce_str: 'one-time-nonce',
      package: 'prepay_id=development-prepay',
      sign_type: 'RSA',
      pay_sign: 'one-time-signature',
      expires_at: '2026-08-30T01:05:00.000Z',
    },
    expires_at: '2026-08-30T01:05:00.000Z',
    next_reconcile_at: null,
    last_error_code: null,
  };
}

describe('B10 payment intent decoder', () => {
  it('accepts the exact closed payment intent and capability projection', () => {
    expect(decodePaymentIntent(paymentIntent())).toEqual(paymentIntent());
    expect(decodePaymentIntent({ ...paymentIntent(), provider_payload: null })).toEqual({
      ...paymentIntent(), provider_payload: null,
    });
  });

  it.each([
    { ...paymentIntent(), extra: true },
    { ...paymentIntent(), payment_intent_id: PAYMENT_INTENT_ID.toLowerCase() },
    { ...paymentIntent(), intent_status: 'SUCCEEDED_LATE' },
    { ...paymentIntent(), expires_at: 'not-a-date' },
    { ...paymentIntent(), next_reconcile_at: 'not-a-date' },
    { ...paymentIntent(), last_error_code: '' },
    { ...paymentIntent(), provider_payload: { ...paymentIntent().provider_payload, extra: true } },
    { ...paymentIntent(), provider_payload: { ...paymentIntent().provider_payload, time_stamp: '1.5' } },
    { ...paymentIntent(), provider_payload: { ...paymentIntent().provider_payload, package: 'order=unsafe' } },
    { ...paymentIntent(), provider_payload: { ...paymentIntent().provider_payload, sign_type: 'MD5' } },
    { ...paymentIntent(), provider_payload: { ...paymentIntent().provider_payload, expires_at: 'soon' } },
  ])('rejects malformed or capability-polluted payment data', (value) => {
    expect(() => decodePaymentIntent(value)).toThrow(StoreEnvelopeFormatError);
  });
});
