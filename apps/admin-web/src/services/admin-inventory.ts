import type { components } from '@qingxu/contracts';

import type {
  InventoryAdjustmentCommand,
  InventoryAdjustmentInput,
  InventoryAdjustmentPreview,
  InventoryLedgerQuery,
  InventoryLedgerResult,
  InventoryListQuery,
  InventoryListResult,
} from '../types/inventory';
import { adminSessionRequest, newIdempotencyKey } from './admin-api';

type InventoryListResponse = components['schemas']['InventoryListResponse'];
type InventoryAdjustmentPreviewResponse = components['schemas']['InventoryAdjustmentPreviewResponse'];
type InventoryAdjustmentCommandResponse = components['schemas']['InventoryAdjustmentCommandResponse'];
type InventoryLedgerResponse = components['schemas']['InventoryLedgerResponse'];

function inventoryPath(skuId: string): string {
  return `/admin/inventory/${encodeURIComponent(skuId)}`;
}

export async function listAdminInventory(
  query: InventoryListQuery = {},
  signal?: AbortSignal,
): Promise<InventoryListResult> {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.categoryId) search.set('category_id', query.categoryId);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  const response = await adminSessionRequest<InventoryListResponse>(`/admin/inventory${suffix}`, { signal });
  return {
    items: response.data.items,
    pagination: {
      page: response.data.pagination.page,
      pageSize: response.data.pagination.page_size,
      total: response.data.pagination.total,
    },
  };
}

export async function previewInventoryAdjustment(
  skuId: string,
  input: InventoryAdjustmentInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<InventoryAdjustmentPreview> {
  const response = await adminSessionRequest<InventoryAdjustmentPreviewResponse>(
    `${inventoryPath(skuId)}/adjustment-preview`,
    {
      body: input,
      idempotencyKey,
      method: 'POST',
      signal,
    },
  );
  return response.data;
}

export async function confirmInventoryAdjustment(
  skuId: string,
  input: InventoryAdjustmentInput,
  preview: InventoryAdjustmentPreview,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<InventoryAdjustmentCommand> {
  const body: InventoryAdjustmentInput & components['schemas']['HighRiskConfirmationFields'] = {
    ...input,
    confirmation_hash: preview.confirmation_hash,
    preview_token: preview.preview_token,
  };
  const response = await adminSessionRequest<InventoryAdjustmentCommandResponse>(
    `${inventoryPath(skuId)}/adjustments`,
    {
      body,
      idempotencyKey,
      ifMatch: preview.resource_etag,
      method: 'POST',
      signal,
    },
  );
  return response.data;
}

export async function listAdminInventoryLedger(
  skuId: string,
  query: InventoryLedgerQuery = {},
  signal?: AbortSignal,
): Promise<InventoryLedgerResult> {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.ledgerType) search.set('ledger_type', query.ledgerType);
  if (query.dateFrom) search.set('date_from', query.dateFrom);
  if (query.dateTo) search.set('date_to', query.dateTo);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  const response = await adminSessionRequest<InventoryLedgerResponse>(
    `${inventoryPath(skuId)}/ledger${suffix}`,
    { signal },
  );
  return {
    items: response.data.items,
    pagination: {
      page: response.data.pagination.page,
      pageSize: response.data.pagination.page_size,
      total: response.data.pagination.total,
    },
  };
}
