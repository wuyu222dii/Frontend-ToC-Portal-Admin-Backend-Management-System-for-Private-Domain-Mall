import { afterEach, describe, expect, it } from 'vitest';

import type { PaymentIntent } from '../types/store-payments';
import { clearPaymentFlow, peekPaymentFlow, rememberPaymentFlow } from './payment-flow-memory';

const ORDER_ID = '01J00000000000000000000000';
const OTHER_ORDER_ID = '01J10000000000000000000000';
const PAYMENT_INTENT_ID = '01J20000000000000000000000';

const intent = {
  payment_intent_id: PAYMENT_INTENT_ID,
  provider_payload: {
    app_id: 'wx-development',
    time_stamp: '1788000000',
    nonce_str: 'nonce',
    package: 'prepay_id=development',
    sign_type: 'RSA',
    pay_sign: 'signature',
    expires_at: '2026-08-30T01:05:00.000Z',
  },
} as PaymentIntent;

describe('volatile payment capability memory', () => {
  afterEach(() => clearPaymentFlow());

  it('keeps a capability only in module memory and returns independent copies', () => {
    const remembered = rememberPaymentFlow(ORDER_ID, intent);
    const first = peekPaymentFlow(ORDER_ID);
    expect(first).toEqual(remembered);
    expect(first).not.toBe(remembered);
    expect(first?.provider_payload).not.toBe(remembered.provider_payload);
    expect(peekPaymentFlow(OTHER_ORDER_ID)).toBeNull();
  });

  it('clears only the matching flow', () => {
    rememberPaymentFlow(ORDER_ID, intent);
    clearPaymentFlow(OTHER_ORDER_ID);
    expect(peekPaymentFlow(ORDER_ID)).not.toBeNull();
    clearPaymentFlow(ORDER_ID);
    expect(peekPaymentFlow()).toBeNull();
  });
});
