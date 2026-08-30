import type { PaymentIntent, PaymentProviderCapability } from '../types/store-payments';
import { StoreEnvelopeFormatError } from './store-client';

type RecordValue = Record<string, unknown>;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const intentStatuses = new Set([
  'CREATING', 'OPEN', 'CLOSE_PENDING', 'CLOSED', 'FAILED', 'CANCELLED', 'EXPIRED', 'SUCCEEDED',
]);

function invalid(): never {
  throw new StoreEnvelopeFormatError();
}

function record(value: unknown, keys: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const current = value as RecordValue;
  const actual = Object.keys(current);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(current, key))) invalid();
  return current;
}

function text(value: unknown, minimum = 1, maximum = 2_048): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function dateTime(value: unknown): string {
  const current = text(value);
  if (!Number.isFinite(Date.parse(current))) invalid();
  return current;
}

function nullable<T>(value: unknown, decoder: (input: unknown) => T): T | null {
  return value === null ? null : decoder(value);
}

function capability(value: unknown): PaymentProviderCapability {
  const current = record(value, [
    'app_id', 'time_stamp', 'nonce_str', 'package', 'sign_type', 'pay_sign', 'expires_at',
  ]);
  const timeStamp = text(current.time_stamp);
  const packageValue = text(current.package);
  if (!/^[0-9]+$/.test(timeStamp) || !packageValue.startsWith('prepay_id=') || current.sign_type !== 'RSA') {
    invalid();
  }
  return {
    app_id: text(current.app_id),
    time_stamp: timeStamp,
    nonce_str: text(current.nonce_str),
    package: packageValue,
    sign_type: 'RSA',
    pay_sign: text(current.pay_sign),
    expires_at: dateTime(current.expires_at),
  };
}

export function decodePaymentIntent(value: unknown): PaymentIntent {
  const current = record(value, [
    'payment_intent_id', 'intent_no', 'intent_status', 'provider_payload',
    'expires_at', 'next_reconcile_at', 'last_error_code',
  ]);
  const paymentIntentId = text(current.payment_intent_id, 26, 26);
  const intentStatus = text(current.intent_status);
  if (!ulidPattern.test(paymentIntentId) || !intentStatuses.has(intentStatus)) invalid();
  return {
    payment_intent_id: paymentIntentId,
    intent_no: text(current.intent_no),
    intent_status: intentStatus as PaymentIntent['intent_status'],
    provider_payload: nullable(current.provider_payload, capability),
    expires_at: dateTime(current.expires_at),
    next_reconcile_at: nullable(current.next_reconcile_at, dateTime),
    last_error_code: nullable(current.last_error_code, text),
  };
}
