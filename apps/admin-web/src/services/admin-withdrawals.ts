import type {
  AdminWithdrawal,
  AdminWithdrawalListQuery,
  AdminWithdrawalListResult,
  HighRiskPreview,
  MarkPaidInput,
  PayoutAccountReveal,
  PayoutReauth,
  ReasonInput,
  WithdrawalProofInput,
} from '../types/admin-b13';
import { adminSessionRequest } from './admin-api';
import {
  decodeAdminHighRiskPreviewResponse,
  decodeAdminPayoutAccountRevealResponse,
  decodeAdminPayoutReauthResponse,
  decodeAdminWithdrawalListResponse,
  decodeAdminWithdrawalResponse,
} from './admin-b13-decoders';

export type {
  AdminWithdrawal,
  AdminWithdrawalListQuery,
  AdminWithdrawalListResult,
  HighRiskPreview,
  MarkPaidInput,
  PayoutAccountReveal,
  PayoutReauth,
  ReasonInput,
  WithdrawalProofInput,
} from '../types/admin-b13';

const withdrawalsPath = '/admin/withdrawals';

function withdrawalPath(withdrawalId: string): string {
  return `${withdrawalsPath}/${encodeURIComponent(withdrawalId)}`;
}

export function buildAdminWithdrawalListPath(query: AdminWithdrawalListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.agentId) search.set('agent_id', query.agentId);
  if (query.withdrawalNo) search.set('withdrawal_no', query.withdrawalNo);
  if (query.status) search.set('status', query.status);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  if (query.minAmount) search.set('min_amount', query.minAmount);
  if (query.maxAmount) search.set('max_amount', query.maxAmount);
  return search.size > 0 ? `${withdrawalsPath}?${search.toString()}` : withdrawalsPath;
}

export async function listAdminWithdrawals(
  query: AdminWithdrawalListQuery = {},
  signal?: AbortSignal,
): Promise<AdminWithdrawalListResult> {
  const response = await adminSessionRequest<unknown>(buildAdminWithdrawalListPath(query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminWithdrawalListResponse(response);
}

export async function getAdminWithdrawal(
  withdrawalId: string,
  signal?: AbortSignal,
): Promise<AdminWithdrawal> {
  const response = await adminSessionRequest<unknown>(withdrawalPath(withdrawalId), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminWithdrawalResponse(response, withdrawalId);
}

export async function previewAdminWithdrawalApproval(
  withdrawalId: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/approve-preview`, {
    body: {},
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminWithdrawalApproval(
  withdrawalId: string,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminWithdrawal> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/approve`, {
    body: { confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminWithdrawalResponse(response, withdrawalId);
}

export async function previewAdminWithdrawalRejection(
  withdrawalId: string,
  input: ReasonInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/reject-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminWithdrawalRejection(
  withdrawalId: string,
  input: ReasonInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminWithdrawal> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/reject`, {
    body: { ...input, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminWithdrawalResponse(response, withdrawalId);
}

export async function reauthAdminPayoutAccount(
  withdrawalId: string,
  totpCode: string,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PayoutReauth> {
  const response = await adminSessionRequest<unknown>('/admin/auth/reauth', {
    body: { action: 'PAYOUT_ACCOUNT_REVEAL', withdrawal_id: withdrawalId, totp_code: totpCode },
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminPayoutReauthResponse(response, withdrawalId);
}

export async function revealAdminPayoutAccount(
  withdrawalId: string,
  reauthGrant: string,
  version: number,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PayoutAccountReveal> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/payout-account-reveal`, {
    body: { reauth_grant: reauthGrant },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: `"${version}"`,
    method: 'POST',
    signal,
  });
  return decodeAdminPayoutAccountRevealResponse(response);
}

export async function attachAdminWithdrawalProofs(
  withdrawalId: string,
  input: WithdrawalProofInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminWithdrawal> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/proofs`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminWithdrawalResponse(response, withdrawalId);
}

export async function previewAdminWithdrawalPaid(
  withdrawalId: string,
  input: MarkPaidInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/mark-paid-preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminWithdrawalPaid(
  withdrawalId: string,
  input: MarkPaidInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminWithdrawal> {
  const response = await adminSessionRequest<unknown>(`${withdrawalPath(withdrawalId)}/mark-paid`, {
    body: { ...input, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminWithdrawalResponse(response, withdrawalId);
}
