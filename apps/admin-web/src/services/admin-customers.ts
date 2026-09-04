import type {
  AdminCustomer,
  AdminCustomerDetail,
  AdminCustomerListQuery,
  AdminCustomerListResult,
  CustomerTransferInput,
  HighRiskPreview,
} from '../types/admin-b13';
import { adminSessionRequest } from './admin-api';
import {
  decodeAdminCustomerDetailResponse,
  decodeAdminCustomerListResponse,
  decodeAdminCustomerResponse,
  decodeAdminHighRiskPreviewResponse,
} from './admin-b13-decoders';

export type {
  AdminCustomer,
  AdminCustomerDetail,
  AdminCustomerListQuery,
  AdminCustomerListResult,
  CustomerTransferInput,
  HighRiskPreview,
} from '../types/admin-b13';

const customersPath = '/admin/customers';

export function buildAdminCustomerListPath(query: AdminCustomerListQuery = {}): string {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.bindingStatus) search.set('binding_status', query.bindingStatus);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  if (query.agentId) search.set('agent_id', query.agentId);
  if (query.minConsumption) search.set('min_consumption', query.minConsumption);
  if (query.maxConsumption) search.set('max_consumption', query.maxConsumption);
  return search.size > 0 ? `${customersPath}?${search.toString()}` : customersPath;
}

export async function listAdminCustomers(
  query: AdminCustomerListQuery = {},
  signal?: AbortSignal,
): Promise<AdminCustomerListResult> {
  const response = await adminSessionRequest<unknown>(buildAdminCustomerListPath(query), {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminCustomerListResponse(response);
}

export async function getAdminCustomer(customerId: string, signal?: AbortSignal): Promise<AdminCustomerDetail> {
  const response = await adminSessionRequest<unknown>(`${customersPath}/${encodeURIComponent(customerId)}`, {
    expectedStatus: 200,
    signal,
  });
  return decodeAdminCustomerDetailResponse(response, customerId);
}

export async function previewAdminCustomerTransfer(
  customerId: string,
  input: CustomerTransferInput,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<unknown>(
    `${customersPath}/${encodeURIComponent(customerId)}/attribution-transfer-preview`,
    { body: input, expectedStatus: 200, idempotencyKey, method: 'POST', signal },
  );
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function confirmAdminCustomerTransfer(
  customerId: string,
  input: CustomerTransferInput,
  preview: HighRiskPreview,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdminCustomer> {
  const response = await adminSessionRequest<unknown>(
    `${customersPath}/${encodeURIComponent(customerId)}/attribution-transfers`,
    {
      body: {
        ...input,
        confirmation_hash: preview.confirmation_hash,
        preview_token: preview.preview_token,
      },
      expectedStatus: 200,
      idempotencyKey,
      ifMatch: preview.resource_etag,
      method: 'POST',
      signal,
    },
  );
  return decodeAdminCustomerResponse(response, customerId);
}
