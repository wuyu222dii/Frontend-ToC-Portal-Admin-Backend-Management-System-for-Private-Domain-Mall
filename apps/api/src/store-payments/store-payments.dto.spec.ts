import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseStoreMockPaymentResultBody,
  parseStorePaymentIntentId,
} from './store-payments.dto';

const PAYMENT_INTENT_ID = '01J00000000000000000000001';

function errorCode(work: () => unknown): string | undefined {
  try {
    work();
  } catch (cause) {
    return cause instanceof ApplicationError ? cause.code : undefined;
  }
  return undefined;
}

describe('B10.1 Store payment DTOs', () => {
  it('accepts a ULID and the closed Mock result set', () => {
    expect(parseStorePaymentIntentId(PAYMENT_INTENT_ID)).toBe(PAYMENT_INTENT_ID);
    expect(['SUCCEEDED', 'FAILED', 'CANCELLED'].map((result) =>
      parseStoreMockPaymentResultBody({ result }))).toEqual([
      { result: 'SUCCEEDED' },
      { result: 'FAILED' },
      { result: 'CANCELLED' },
    ]);
  });

  it.each([
    ['non-ULID path', () => parseStorePaymentIntentId('payment-1')],
    ['open enum', () => parseStoreMockPaymentResultBody({ result: 'SUCCEEDED_LATE' })],
    ['extra field', () => parseStoreMockPaymentResultBody({ result: 'SUCCEEDED', transaction_id: 'client' })],
    ['missing field', () => parseStoreMockPaymentResultBody({})],
    ['array body', () => parseStoreMockPaymentResultBody([])],
  ])('rejects %s', (_label, work) => {
    expect(errorCode(work)).toBe('INVALID_ARGUMENT');
  });
});
