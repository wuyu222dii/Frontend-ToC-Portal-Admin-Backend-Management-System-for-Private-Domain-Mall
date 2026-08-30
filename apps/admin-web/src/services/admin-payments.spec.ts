import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaymentReconciliationTask } from '../types/payments';
import {
  beginPaymentReconciliationAttempt,
  markPaymentReconciliationAttemptUncertain,
} from '../utils/payment-reconciliation-attempt';
import {
  decodePaymentReconciliationActionResponse,
  decodePaymentReconciliationListResponse,
} from './admin-payments-decoders';

const adminSessionRequest = vi.hoisted(() => vi.fn());

vi.mock('./admin-api', () => ({ adminSessionRequest }));

import {
  buildPaymentReconciliationListPath,
  listPaymentReconciliationTasks,
  reconcilePaymentIntent,
} from './admin-payments';

const paymentIntentId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const orderId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const refundId = '01ARZ3NDEKTSV4RRFFQ69G5FAX';

const paymentIntentTask: PaymentReconciliationTask = {
  last_error_code: null,
  next_reconcile_at: '2026-08-30T02:00:00.000Z',
  order_id: orderId,
  payment_intent_id: paymentIntentId,
  payment_resolution: null,
  reconciliation_attempt_count: 1,
  reference_no: 'PI-LOCAL-001',
  refund_id: null,
  status: 'OPEN',
  task_type: 'PAYMENT_INTENT',
  version: 2,
};

const settlementTask: PaymentReconciliationTask = {
  last_error_code: 'PAYMENT_CONFIGURATION_UNAVAILABLE',
  next_reconcile_at: null,
  order_id: orderId,
  payment_intent_id: paymentIntentId,
  payment_resolution: 'MANUAL_REQUIRED',
  reconciliation_attempt_count: 2,
  reference_no: 'PI-LOCAL-001',
  refund_id: null,
  status: 'SUCCEEDED',
  task_type: 'PAYMENT_SETTLEMENT',
  version: 3,
};

const refundTask: PaymentReconciliationTask = {
  last_error_code: 'PAYMENT_PROVIDER_UNAVAILABLE',
  next_reconcile_at: '2026-08-30T02:05:00.000Z',
  order_id: orderId,
  payment_intent_id: paymentIntentId,
  payment_resolution: 'LATE_SUCCESS_REFUND_PENDING',
  reconciliation_attempt_count: 3,
  reference_no: 'RF-LOCAL-001',
  refund_id: refundId,
  status: 'FAILED',
  task_type: 'LATE_PAYMENT_REFUND',
  version: 4,
};

function listEnvelope(items: unknown[] = [paymentIntentTask]) {
  return {
    code: 'OK',
    data: { items, pagination: { page: 1, page_size: 20, total: items.length } },
    message: 'success',
    request_id: 'req_admin_reconciliation',
  };
}

describe('ADM-10 strict payment reconciliation decoders', () => {
  it('accepts all three closed task branches', () => {
    const result = decodePaymentReconciliationListResponse(
      listEnvelope([paymentIntentTask, settlementTask, refundTask]),
    );

    expect(result.items.map(({ task_type }) => task_type)).toEqual([
      'PAYMENT_INTENT',
      'PAYMENT_SETTLEMENT',
      'LATE_PAYMENT_REFUND',
    ]);
    expect(result.pagination).toEqual({ page: 1, pageSize: 20, total: 3 });
  });

  it('rejects undeclared payment fields instead of leaking them into the UI', () => {
    const unsafeTask = { ...paymentIntentTask, provider_transaction_id: 'not-allowed' };
    expect(() => decodePaymentReconciliationListResponse(listEnvelope([unsafeTask]))).toThrow(
      'response.data.items[0]',
    );
  });

  it('rejects cross-branch status and refund combinations', () => {
    expect(() => decodePaymentReconciliationListResponse(
      listEnvelope([{ ...paymentIntentTask, status: 'SUCCEEDED' }]),
    )).toThrow('response.data.items[0].status');
    expect(() => decodePaymentReconciliationListResponse(
      listEnvelope([{ ...settlementTask, refund_id: refundId }]),
    )).toThrow('response.data.items[0].refund_id');
  });

  it('decodes exact 202 pending and 200 converged envelopes', () => {
    expect(decodePaymentReconciliationActionResponse({
      code: 'ACCEPTED',
      data: refundTask,
      message: 'accepted',
      request_id: 'req_pending',
    })).toEqual({ data: refundTask, kind: 'PENDING', requestId: 'req_pending' });

    const converged = {
      last_error_code: null,
      order_id: orderId,
      outcome: 'CONVERGED',
      payment_intent_id: paymentIntentId,
      payment_intent_status: 'CLOSED',
      payment_resolution: 'NORMAL',
      refund_id: null,
      refund_status: null,
      version: 5,
    } as const;
    expect(decodePaymentReconciliationActionResponse({
      code: 'OK',
      data: converged,
      message: 'success',
      request_id: 'req_converged',
    })).toEqual({ data: converged, kind: 'CONVERGED', requestId: 'req_converged' });

    const lateRefundConverged = {
      last_error_code: null,
      order_id: orderId,
      outcome: 'CONVERGED',
      payment_intent_id: paymentIntentId,
      payment_intent_status: 'SUCCEEDED',
      payment_resolution: 'LATE_SUCCESS_REFUNDED',
      refund_id: refundId,
      refund_status: 'SUCCEEDED',
      version: 6,
    } as const;
    expect(decodePaymentReconciliationActionResponse({
      code: 'OK',
      data: lateRefundConverged,
      message: 'success',
      request_id: 'req_late_refund_converged',
    })).toEqual({
      data: lateRefundConverged,
      kind: 'CONVERGED',
      requestId: 'req_late_refund_converged',
    });
  });
});

describe('ADM-10 payment reconciliation client', () => {
  beforeEach(() => adminSessionRequest.mockReset());

  it('serializes only frozen list filters', async () => {
    adminSessionRequest.mockResolvedValueOnce(listEnvelope());
    const signal = new AbortController().signal;

    await listPaymentReconciliationTasks({
      dueBefore: '2026-08-30T02:00:00.000Z',
      intentStatus: 'OPEN',
      lastErrorCode: 'PAYMENT_PROVIDER_UNAVAILABLE',
      page: 2,
      pageSize: 40,
      paymentResolution: 'MANUAL_REQUIRED',
      refundStatus: 'FAILED',
      taskType: 'PAYMENT_INTENT',
    }, signal);

    const [path, options] = adminSessionRequest.mock.calls[0] as [string, { signal: AbortSignal }];
    const url = new URL(path, 'https://admin.test');
    expect(url.pathname).toBe('/admin/payment-intents/reconciliation-tasks');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      due_before: '2026-08-30T02:00:00.000Z',
      intent_status: 'OPEN',
      last_error_code: 'PAYMENT_PROVIDER_UNAVAILABLE',
      page: '2',
      page_size: '40',
      payment_resolution: 'MANUAL_REQUIRED',
      refund_status: 'FAILED',
      task_type: 'PAYMENT_INTENT',
    });
    expect(options.signal).toBe(signal);
  });

  it('uses the caller-owned idempotency key for an exact reconcile retry', async () => {
    adminSessionRequest.mockResolvedValueOnce({
      code: 'ACCEPTED',
      data: paymentIntentTask,
      message: 'accepted',
      request_id: 'req_pending',
    });
    const signal = new AbortController().signal;

    await expect(reconcilePaymentIntent(paymentIntentId, 'd9428888-122b-4c83-8f44-35df3c4c17c6', signal))
      .resolves.toEqual({ data: paymentIntentTask, kind: 'PENDING', requestId: 'req_pending' });

    expect(adminSessionRequest).toHaveBeenCalledWith(
      `/admin/payment-intents/${paymentIntentId}/reconcile`,
      {
        body: {},
        idempotencyKey: 'd9428888-122b-4c83-8f44-35df3c4c17c6',
        method: 'POST',
        signal,
      },
    );
  });

  it('does not add an empty query marker', () => {
    expect(buildPaymentReconciliationListPath()).toBe('/admin/payment-intents/reconciliation-tasks');
  });
});

describe('ADM-10 reconcile attempt ownership', () => {
  it('reuses the exact key only after a network-uncertain result', () => {
    const first = beginPaymentReconciliationAttempt(undefined, () => 'first-key');
    expect(first).not.toBeNull();
    const uncertain = markPaymentReconciliationAttemptUncertain(first!);

    const retry = beginPaymentReconciliationAttempt(uncertain, () => 'must-not-be-used');
    expect(retry).toEqual({ idempotencyKey: 'first-key', inFlight: true, uncertain: true });
  });

  it('blocks a duplicate in-flight click and uses a new key after an explicit response', () => {
    const inFlight = beginPaymentReconciliationAttempt(undefined, () => 'first-key');
    expect(beginPaymentReconciliationAttempt(inFlight!, () => 'second-key')).toBeNull();
    expect(beginPaymentReconciliationAttempt(undefined, () => 'second-key')).toEqual({
      idempotencyKey: 'second-key',
      inFlight: true,
      uncertain: false,
    });
  });
});
