import type { MockPaymentResultInput, PaymentIntent } from '../types/store-payments';
import { authenticatedRequest } from './store-identity';
import { decodePaymentIntent } from './store-payment-decoders';

function ulidPath(value: string, field: string): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) throw new Error(`${field} is invalid`);
  return encodeURIComponent(value);
}

function versionHeader(version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error('version is invalid');
  return `"${version}"`;
}

function mockResult(input: MockPaymentResultInput): MockPaymentResultInput {
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.keys(input).length !== 1 || !Object.hasOwn(input, 'result') ||
    !['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(input.result)) {
    throw new Error('payment result is invalid');
  }
  return { result: input.result };
}

export function createStorePaymentIntent(
  orderId: string,
  orderVersion: number,
  idempotencyKey: string,
): Promise<PaymentIntent> {
  return authenticatedRequest(`/store/orders/${ulidPath(orderId, 'order_id')}/payment-intents`, {
    decode: decodePaymentIntent,
    headers: {
      'Idempotency-Key': idempotencyKey,
      'If-Match': versionHeader(orderVersion),
    },
    method: 'POST',
  });
}

export function submitStoreMockPaymentResult(
  paymentIntentId: string,
  input: MockPaymentResultInput,
  idempotencyKey: string,
): Promise<PaymentIntent> {
  return authenticatedRequest(
    `/store/mock-payments/${ulidPath(paymentIntentId, 'payment_intent_id')}/result`,
    {
      data: mockResult(input),
      decode: decodePaymentIntent,
      expectedStatus: 202,
      headers: { 'Idempotency-Key': idempotencyKey },
      method: 'POST',
    },
  );
}
