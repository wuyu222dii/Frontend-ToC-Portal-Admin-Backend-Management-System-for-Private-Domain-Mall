import type {
  PaymentReconciliationActionResult,
  PaymentReconciliationListQuery,
  PaymentReconciliationListResult,
} from '../types/payments';
import { adminSessionRequest } from './admin-api';
import {
  decodePaymentReconciliationActionResponse,
  decodePaymentReconciliationListResponse,
} from './admin-payments-decoders';

const reconciliationTasksPath = '/admin/payment-intents/reconciliation-tasks';

export function buildPaymentReconciliationListPath(query: PaymentReconciliationListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.taskType) search.set('task_type', query.taskType);
  if (query.intentStatus) search.set('intent_status', query.intentStatus);
  if (query.refundStatus) search.set('refund_status', query.refundStatus);
  if (query.paymentResolution) search.set('payment_resolution', query.paymentResolution);
  if (query.lastErrorCode) search.set('last_error_code', query.lastErrorCode);
  if (query.dueBefore) search.set('due_before', query.dueBefore);
  return search.size > 0 ? `${reconciliationTasksPath}?${search.toString()}` : reconciliationTasksPath;
}

export async function listPaymentReconciliationTasks(
  query: PaymentReconciliationListQuery = {},
  signal?: AbortSignal,
): Promise<PaymentReconciliationListResult> {
  const response = await adminSessionRequest<unknown>(buildPaymentReconciliationListPath(query), { signal });
  return decodePaymentReconciliationListResponse(response);
}

export async function reconcilePaymentIntent(
  paymentIntentId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PaymentReconciliationActionResult> {
  const response = await adminSessionRequest<unknown>(
    `/admin/payment-intents/${encodeURIComponent(paymentIntentId)}/reconcile`,
    {
      body: {},
      idempotencyKey,
      method: 'POST',
      signal,
    },
  );
  return decodePaymentReconciliationActionResponse(response);
}
