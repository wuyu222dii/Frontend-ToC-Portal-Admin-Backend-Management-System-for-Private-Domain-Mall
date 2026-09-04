import type {
  CommissionRuleInput,
  CommissionRules,
  CommissionRuleSkuQuery,
  CommissionRuleSkuResult,
  CommissionRuleVersion,
  CommissionRuleVersionQuery,
  CommissionRuleVersionResult,
  HighRiskPreview,
  OrderCommissionExplanation,
} from '../types/admin-b13';
import { adminSessionRequest } from './admin-api';
import {
  decodeAdminCommissionRulesResponse,
  decodeAdminCommissionRuleSkuListResponse,
  decodeAdminCommissionRuleVersionListResponse,
  decodeAdminCommissionRuleVersionResponse,
  decodeAdminHighRiskPreviewResponse,
  decodeAdminOrderCommissionExplanationResponse,
} from './admin-b13-decoders';

export type {
  CommissionRuleInput,
  CommissionRules,
  CommissionRuleSkuQuery,
  CommissionRuleSkuResult,
  CommissionRuleVersion,
  CommissionRuleVersionQuery,
  CommissionRuleVersionResult,
  HighRiskPreview,
  OrderCommissionExplanation,
} from '../types/admin-b13';

const rulesPath = '/admin/commission-rules';
const versionsPath = '/admin/commission-rule-versions';

function addPage(search: URLSearchParams, query: { page?: number; pageSize?: number }): void {
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
}

export async function getAdminCommissionRules(signal?: AbortSignal): Promise<CommissionRules> {
  const response = await adminSessionRequest<unknown>(`${rulesPath}/current`, { expectedStatus: 200, signal });
  return decodeAdminCommissionRulesResponse(response);
}

export function buildAdminCommissionRuleSkuListPath(query: CommissionRuleSkuQuery = {}): string {
  const search = new URLSearchParams();
  addPage(search, query);
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.categoryId) search.set('category_id', query.categoryId);
  if (query.source) search.set('source', query.source);
  const path = `${rulesPath}/skus`;
  return search.size > 0 ? `${path}?${search.toString()}` : path;
}

export async function listAdminCommissionRuleSkus(
  query: CommissionRuleSkuQuery = {},
  signal?: AbortSignal,
): Promise<CommissionRuleSkuResult> {
  const response = await adminSessionRequest<unknown>(buildAdminCommissionRuleSkuListPath(query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminCommissionRuleSkuListResponse(response);
}

export async function previewAdminCommissionRules(
  input: CommissionRuleInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(`${versionsPath}/preview`, {
    body: input,
    expectedStatus: 200,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return decodeAdminHighRiskPreviewResponse(response, true);
}

export async function confirmAdminCommissionRules(
  input: CommissionRuleInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<CommissionRuleVersion> {
  const response = await adminSessionRequest<unknown>(versionsPath, {
    body: { ...input, confirmation_hash: preview.confirmation_hash, preview_token: preview.preview_token },
    expectedStatus: 200,
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
    signal,
  });
  return decodeAdminCommissionRuleVersionResponse(response);
}

export function buildAdminCommissionRuleVersionListPath(query: CommissionRuleVersionQuery = {}): string {
  const search = new URLSearchParams();
  addPage(search, query);
  if (query.status) search.set('status', query.status);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  return search.size > 0 ? `${versionsPath}?${search.toString()}` : versionsPath;
}

export async function listAdminCommissionRuleVersions(
  query: CommissionRuleVersionQuery = {},
  signal?: AbortSignal,
): Promise<CommissionRuleVersionResult> {
  const response = await adminSessionRequest<unknown>(buildAdminCommissionRuleVersionListPath(query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminCommissionRuleVersionListResponse(response);
}

export async function getAdminCommissionRuleVersion(
  versionId: string,
  signal?: AbortSignal,
): Promise<CommissionRuleVersion> {
  const response = await adminSessionRequest<unknown>(`${versionsPath}/${encodeURIComponent(versionId)}`, {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminCommissionRuleVersionResponse(response, versionId);
}

export async function getAdminOrderCommissionExplanation(
  orderId: string,
  signal?: AbortSignal,
): Promise<OrderCommissionExplanation> {
  const response = await adminSessionRequest<unknown>(
    `/admin/orders/${encodeURIComponent(orderId)}/commission-explanation`,
    { expectedStatus: 200, signal },
  );
  return decodeAdminOrderCommissionExplanationResponse(response, orderId);
}
