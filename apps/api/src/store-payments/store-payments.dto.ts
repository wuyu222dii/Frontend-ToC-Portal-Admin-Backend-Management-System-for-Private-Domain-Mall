import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const MOCK_RESULTS = ['SUCCEEDED', 'FAILED', 'CANCELLED'] as const;

export type StoreMockPaymentResult = (typeof MOCK_RESULTS)[number];

export interface StoreMockPaymentResultRequest {
  result: StoreMockPaymentResult;
}

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

export function parseStorePaymentIntentId(value: string): string {
  if (!isValidUlid(value)) return invalid('payment_intent_id is invalid');
  return value;
}

export function parseStoreMockPaymentResultBody(value: unknown): StoreMockPaymentResultRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Request body must be a plain object');
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !Object.prototype.hasOwnProperty.call(record, 'result') ||
    typeof record.result !== 'string' || !(MOCK_RESULTS as readonly string[]).includes(record.result)) {
    return invalid('Request body fields are invalid');
  }
  return { result: record.result as StoreMockPaymentResult };
}
