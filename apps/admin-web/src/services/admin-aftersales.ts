import { adminSessionRequest, newIdempotencyKey } from './admin-api';
import {
  decodeAdminAftersaleCommandResponse,
  decodeAdminAftersaleDetailResponse,
  decodeAdminAftersaleListResponse,
  decodeHighRiskPreviewResponse,
  decodeManualCompensationResponse,
  decodeRefundResponse,
  decodeRefundRetryResponse,
} from './admin-aftersales-decoders';
import type {
  AdminAftersaleCommand,
  AdminAftersaleDetail,
  AdminAftersaleListQuery,
  AdminAftersaleListResult,
  AftersaleApproveInput,
  AftersaleRejectInput,
  ContinueRefundInput,
  HighRiskConfirmationFields,
  HighRiskPreview,
  ManualCompensationInput,
  ManualCompensationResult,
  RefundItemsInput,
  RefundResult,
  RefundRetryInput,
  RefundRetryResult,
  RejectAfterReturnInput,
  ReturnInspectionInput,
} from './admin-aftersales-types';

export type {
  AdminAftersaleCommand,
  AdminAftersaleDetail,
  AdminAftersaleListItem,
  AdminAftersaleListQuery,
  AdminAftersaleListResult,
  AftersaleApproveInput,
  AftersaleRejectInput,
  ContinueRefundInput,
  HighRiskPreview,
  ManualCompensationInput,
  ManualCompensationResult,
  RefundItemsInput,
  RefundResult,
  RefundRetryInput,
  RefundRetryResult,
  RejectAfterReturnInput,
  ReturnInspectionInput,
} from './admin-aftersales-types';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const aftersalesPath = '/admin/aftersales';

function identifier(value: string, label: string): string {
  if (!ULID.test(value)) throw new TypeError(`${label} must be a ULID`);
  return value;
}

function versionEtag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('Resource version must be a positive integer');
  return `"${version}"`;
}

function aftersalePath(aftersaleId: string): string {
  return `${aftersalesPath}/${encodeURIComponent(identifier(aftersaleId, 'aftersaleId'))}`;
}

function refundPath(refundId: string): string {
  return `/admin/refunds/${encodeURIComponent(identifier(refundId, 'refundId'))}`;
}

function orderPath(orderId: string): string {
  return `/admin/orders/${encodeURIComponent(identifier(orderId, 'orderId'))}`;
}

function confirmation<T extends object>(input: T, preview: HighRiskPreview): T & HighRiskConfirmationFields {
  return {
    ...input,
    confirmation_hash: preview.confirmation_hash,
    preview_token: preview.preview_token,
  };
}

export function buildAdminAftersaleListPath(query: AdminAftersaleListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.aftersaleNo) search.set('aftersale_no', query.aftersaleNo);
  if (query.orderId) search.set('order_id', query.orderId);
  if (query.status) search.set('status', query.status);
  if (query.type) search.set('type', query.type);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  if (query.customerId) search.set('customer_id', query.customerId);
  return search.size > 0 ? `${aftersalesPath}?${search.toString()}` : aftersalesPath;
}

export async function listAdminAftersales(
  query: AdminAftersaleListQuery = {},
  signal?: AbortSignal,
): Promise<AdminAftersaleListResult> {
  const response = await adminSessionRequest<unknown>(buildAdminAftersaleListPath(query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminAftersaleListResponse(response);
}

export async function getAdminAftersale(
  aftersaleId: string,
  signal?: AbortSignal,
): Promise<AdminAftersaleDetail> {
  const response = await adminSessionRequest<unknown>(aftersalePath(aftersaleId), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminAftersaleDetailResponse(response, aftersaleId);
}

export async function approveAdminAftersale(
  aftersaleId: string,
  input: AftersaleApproveInput,
  version: number,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<AdminAftersaleCommand> {
  const response = await adminSessionRequest<unknown>(`${aftersalePath(aftersaleId)}/approve`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'POST',
    signal,
  });
  return decodeAdminAftersaleCommandResponse(response, aftersaleId);
}

export async function previewAdminAftersaleRejection(
  aftersaleId: string,
  input: AftersaleRejectInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${aftersalePath(aftersaleId)}/reject-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeHighRiskPreviewResponse(response);
}

export async function confirmAdminAftersaleRejection(
  aftersaleId: string,
  input: AftersaleRejectInput,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<AdminAftersaleCommand> {
  const response = await adminSessionRequest<unknown>(`${aftersalePath(aftersaleId)}/reject`, {
    body: confirmation(input, preview),
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminAftersaleCommandResponse(response, aftersaleId);
}

export async function recordAdminReturnInspection(
  aftersaleId: string,
  input: ReturnInspectionInput,
  version: number,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<AdminAftersaleCommand> {
  const response = await adminSessionRequest<unknown>(`${aftersalePath(aftersaleId)}/return-inspections`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'POST',
    signal,
  });
  return decodeAdminAftersaleCommandResponse(response, aftersaleId);
}

export async function continueAdminRefundAfterReturn(
  aftersaleId: string,
  input: ContinueRefundInput,
  version: number,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<AdminAftersaleCommand> {
  const response = await adminSessionRequest<unknown>(
    `${aftersalePath(aftersaleId)}/return-resolution/continue-refund`,
    {
      body: input,
      expectedStatus: 200,
      idempotencyKey,
      ifMatch: versionEtag(version),
      method: 'POST',
      signal,
    },
  );
  return decodeAdminAftersaleCommandResponse(response, aftersaleId);
}

export async function previewAdminRejectionAfterReturn(
  aftersaleId: string,
  input: RejectAfterReturnInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(
    `${aftersalePath(aftersaleId)}/return-resolution/reject-preview`,
    { body: input, expectedStatus: 200, idempotencyKey, method: 'POST', signal },
  );
  return decodeHighRiskPreviewResponse(response);
}

export async function confirmAdminRejectionAfterReturn(
  aftersaleId: string,
  input: RejectAfterReturnInput,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<AdminAftersaleCommand> {
  const response = await adminSessionRequest<unknown>(
    `${aftersalePath(aftersaleId)}/return-resolution/reject`,
    {
      body: confirmation(input, preview),
      expectedStatus: 200,
      idempotencyKey,
      ifMatch: preview.resource_etag,
      method: 'POST',
      signal,
    },
  );
  return decodeAdminAftersaleCommandResponse(response, aftersaleId);
}

export async function previewAdminAftersaleRefund(
  aftersaleId: string,
  input: RefundItemsInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${aftersalePath(aftersaleId)}/refund-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeHighRiskPreviewResponse(response);
}

export async function confirmAdminAftersaleRefund(
  aftersaleId: string,
  input: RefundItemsInput,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<RefundResult> {
  const response = await adminSessionRequest<unknown>(`${aftersalePath(aftersaleId)}/refunds`, {
    body: confirmation(input, preview),
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeRefundResponse(response, undefined, input.items);
}

export async function previewAdminRefundRetry(
  refundId: string,
  input: RefundRetryInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${refundPath(refundId)}/retry-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeHighRiskPreviewResponse(response);
}

export async function confirmAdminRefundRetry(
  refundId: string,
  input: RefundRetryInput,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<RefundRetryResult> {
  const response = await adminSessionRequest<unknown>(`${refundPath(refundId)}/retry`, {
    body: confirmation(input, preview),
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeRefundRetryResponse(response, refundId);
}

export async function previewAdminManualCompensation(
  orderId: string,
  input: ManualCompensationInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(
    `${orderPath(orderId)}/manual-compensations/preview`,
    { body: input, expectedStatus: 200, idempotencyKey, method: 'POST', signal },
  );
  return decodeHighRiskPreviewResponse(response);
}

export async function confirmAdminManualCompensation(
  orderId: string,
  input: ManualCompensationInput,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<ManualCompensationResult> {
  const response = await adminSessionRequest<unknown>(`${orderPath(orderId)}/manual-compensations`, {
    body: confirmation(input, preview),
    expectedStatus: 201,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeManualCompensationResponse(response, orderId, undefined, input.order_item_id, input.amount);
}
