import type { StoreOrderDetail } from '../types/store-orders';

export type PaymentOutcome =
  | 'processing'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'closing'
  | 'timeout'
  | 'refunding'
  | 'refunded'
  | 'manual';

export function derivePaymentOutcome(order: StoreOrderDetail): PaymentOutcome {
  if (order.payment_resolution === 'MANUAL_REQUIRED' || order.refund_processing_status === 'FAILED') {
    return 'manual';
  }
  if (order.payment_resolution === 'LATE_SUCCESS_REFUNDED' || order.refund_progress_status === 'FULL') {
    return 'refunded';
  }
  if (order.payment_resolution === 'LATE_SUCCESS_REFUND_PENDING' ||
    order.refund_processing_status === 'REFUNDING') return 'refunding';
  if (order.payment_status === 'PAID' && order.order_status !== 'CLOSED') return 'success';
  if (order.order_status === 'CLOSED') {
    if (order.close_reason === 'PAYMENT_TIMEOUT') return 'timeout';
    return order.payment_status === 'PAID' ? 'manual' : 'cancelled';
  }
  if (order.display_status.includes('关单')) return 'closing';
  const latestAttempt = order.payment_attempts.at(-1);
  if (latestAttempt?.status === 'FAILED') return 'failed';
  if (latestAttempt?.status === 'CANCELLED') return 'cancelled';
  return 'processing';
}

export function shouldPollPaymentOutcome(outcome: PaymentOutcome): boolean {
  return outcome === 'processing' || outcome === 'closing' || outcome === 'refunding';
}
