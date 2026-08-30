import { describe, expect, it } from 'vitest';

import type { StoreOrderDetail } from '../types/store-orders';
import { derivePaymentOutcome, shouldPollPaymentOutcome } from './payment-result';

function order(overrides: Partial<StoreOrderDetail> = {}): StoreOrderDetail {
  return {
    order_status: 'PENDING_PAYMENT',
    payment_status: 'UNPAID',
    refund_progress_status: 'NONE',
    refund_processing_status: 'IDLE',
    close_reason: null,
    payment_resolution: 'NORMAL',
    display_status: '待付款',
    payment_attempts: [],
    ...overrides,
  } as StoreOrderDetail;
}

describe('server-authoritative B10 payment result derivation', () => {
  it.each([
    [order(), 'processing'],
    [order({ payment_status: 'PAID', order_status: 'PENDING_SHIPMENT' }), 'success'],
    [order({ payment_attempts: [{ status: 'FAILED' } as never] }), 'failed'],
    [order({ payment_attempts: [{ status: 'CANCELLED' } as never] }), 'cancelled'],
    [order({ display_status: '关单确认中' }), 'closing'],
    [order({ order_status: 'CLOSED', close_reason: 'PAYMENT_TIMEOUT' }), 'timeout'],
    [order({ payment_resolution: 'LATE_SUCCESS_REFUND_PENDING' }), 'refunding'],
    [order({ payment_resolution: 'LATE_SUCCESS_REFUNDED', refund_progress_status: 'FULL' }), 'refunded'],
    [order({ payment_resolution: 'MANUAL_REQUIRED' }), 'manual'],
    [order({ refund_processing_status: 'FAILED' }), 'manual'],
  ] as const)('derives %s as %s', (projection, expected) => {
    expect(derivePaymentOutcome(projection)).toBe(expected);
  });

  it('polls only unresolved server states', () => {
    expect(shouldPollPaymentOutcome('processing')).toBe(true);
    expect(shouldPollPaymentOutcome('closing')).toBe(true);
    expect(shouldPollPaymentOutcome('refunding')).toBe(true);
    expect(shouldPollPaymentOutcome('success')).toBe(false);
    expect(shouldPollPaymentOutcome('failed')).toBe(false);
    expect(shouldPollPaymentOutcome('manual')).toBe(false);
  });
});
