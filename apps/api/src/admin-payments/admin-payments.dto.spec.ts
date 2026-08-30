import { describe, expect, it } from 'vitest';

import {
  parsePaymentIntentId,
  parsePaymentReconciliationBody,
  parsePaymentReconciliationListQuery,
} from './admin-payments.dto';

const PAYMENT_INTENT_ID = '01J00000000000000000000001';

describe('Admin payment reconciliation DTO', () => {
  it('parses the closed query contract', () => {
    expect(parsePaymentReconciliationListQuery({
      due_before: '2026-08-30T00:00:00.000Z',
      intent_status: 'OPEN',
      last_error_code: 'PROVIDER_UNAVAILABLE',
      page: '2',
      page_size: '50',
      payment_resolution: 'MANUAL_REQUIRED',
      refund_status: 'FAILED',
      task_type: 'LATE_PAYMENT_REFUND',
    })).toEqual({
      dueBefore: new Date('2026-08-30T00:00:00.000Z'),
      intentStatus: 'OPEN',
      lastErrorCode: 'PROVIDER_UNAVAILABLE',
      page: 2,
      pageSize: 50,
      paymentResolution: 'MANUAL_REQUIRED',
      refundStatus: 'FAILED',
      taskType: 'LATE_PAYMENT_REFUND',
    });
  });

  it('rejects unknown query fields and malformed values', () => {
    expect(() => parsePaymentReconciliationListQuery({ provider: 'MOCK' })).toThrow();
    expect(() => parsePaymentReconciliationListQuery({ due_before: '2026-08-30T00:00:00+12:00' }))
      .toThrow();
    expect(() => parsePaymentReconciliationListQuery({ page_size: '101' })).toThrow();
  });

  it('accepts only a ULID path and a closed optional-reason body', () => {
    expect(parsePaymentIntentId(PAYMENT_INTENT_ID)).toBe(PAYMENT_INTENT_ID);
    expect(parsePaymentReconciliationBody({})).toEqual({});
    expect(parsePaymentReconciliationBody({ reason: '' })).toEqual({ reason: '' });
    expect(() => parsePaymentIntentId('not-a-ulid')).toThrow();
    expect(() => parsePaymentReconciliationBody({ target_status: 'SUCCEEDED' })).toThrow();
  });
});
