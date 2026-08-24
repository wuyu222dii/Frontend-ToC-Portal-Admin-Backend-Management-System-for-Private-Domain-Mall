import type { components } from '@qingxu/contracts';

import type {
  BrandView,
  CatalogEditorInput,
  CatalogKind,
  CatalogListQuery,
  CatalogListResult,
  CategoryView,
  HighRiskPreview,
  MasterDataAction,
  MasterDataItem,
  UploadedCatalogAsset,
} from '../types/catalog';
import {
  adminSessionRequest,
  newIdempotencyKey,
} from './admin-api';
import { safePublicAssetUrl, uploadAdminImage } from './admin-files';

export { safePublicAssetUrl } from './admin-files';

type BrandResponse = components['schemas']['BrandResponse'];
type BrandListResponse = components['schemas']['BrandListResponse'];
type CategoryResponse = components['schemas']['CategoryResponse'];
type CategoryListResponse = components['schemas']['CategoryListResponse'];
type HighRiskPreviewResponse = components['schemas']['HighRiskPreviewResponse'];
type CommandResponse = components['schemas']['CommandResponse'];

function collectionPath(kind: CatalogKind): '/admin/brands' | '/admin/categories' {
  return kind === 'brand' ? '/admin/brands' : '/admin/categories';
}

function itemPath(kind: CatalogKind, id: string): string {
  return `${collectionPath(kind)}/${encodeURIComponent(id)}`;
}

function normalizeBrand(item: BrandView): MasterDataItem {
  return {
    assetFileId: item.logo_file_id,
    assetUrl: safePublicAssetUrl(item.logo_url),
    description: item.description,
    id: item.brand_id,
    kind: 'brand',
    name: item.name,
    sortOrder: item.sort_order,
    status: item.status,
    version: item.version,
  };
}

function normalizeCategory(item: CategoryView): MasterDataItem {
  return {
    assetFileId: item.icon_file_id ?? null,
    assetUrl: safePublicAssetUrl(item.icon_url),
    description: null,
    id: item.category_id,
    kind: 'category',
    name: item.name,
    sortOrder: item.sort_order,
    status: item.status,
    version: item.version,
  };
}

export async function listMasterData(kind: CatalogKind, query: CatalogListQuery): Promise<CatalogListResult> {
  const search = new URLSearchParams({ page: String(query.page), page_size: String(query.pageSize) });
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.status) search.set('status', query.status);
  if (kind === 'brand') {
    const response = await adminSessionRequest<BrandListResponse>(`${collectionPath(kind)}?${search}`, {
      signal: query.signal,
    });
    return {
      items: response.data.items.map(normalizeBrand),
      pagination: {
        page: response.data.pagination.page,
        pageSize: response.data.pagination.page_size,
        total: response.data.pagination.total,
      },
    };
  }
  const response = await adminSessionRequest<CategoryListResponse>(`${collectionPath(kind)}?${search}`, {
    signal: query.signal,
  });
  return {
    items: response.data.items.map(normalizeCategory),
    pagination: {
      page: response.data.pagination.page,
      pageSize: response.data.pagination.page_size,
      total: response.data.pagination.total,
    },
  };
}

export async function getMasterData(
  kind: CatalogKind,
  id: string,
  signal?: AbortSignal,
): Promise<MasterDataItem> {
  if (kind === 'brand') {
    const response = await adminSessionRequest<BrandResponse>(itemPath(kind, id), { signal });
    return normalizeBrand(response.data);
  }
  const response = await adminSessionRequest<CategoryResponse>(itemPath(kind, id), { signal });
  return normalizeCategory(response.data);
}

export async function createMasterData(
  kind: CatalogKind,
  input: CatalogEditorInput,
  idempotencyKey = newIdempotencyKey(),
): Promise<MasterDataItem> {
  if (kind === 'brand') {
    const response = await adminSessionRequest<BrandResponse>(collectionPath(kind), {
      body: {
        description: input.description,
        initial_status: 'DRAFT',
        logo_file_id: input.assetFileId,
        name: input.name,
        sort_order: input.sortOrder,
      },
      idempotencyKey,
      method: 'POST',
    });
    return normalizeBrand(response.data);
  }
  const response = await adminSessionRequest<CategoryResponse>(collectionPath(kind), {
    body: {
      icon_file_id: input.assetFileId,
      initial_status: 'DRAFT',
      name: input.name,
      sort_order: input.sortOrder,
    },
    idempotencyKey,
    method: 'POST',
  });
  return normalizeCategory(response.data);
}

export async function updateMasterData(
  item: MasterDataItem,
  input: CatalogEditorInput,
  idempotencyKey = newIdempotencyKey(),
): Promise<MasterDataItem> {
  const common = { name: input.name, sort_order: input.sortOrder };
  if (item.kind === 'brand') {
    const response = await adminSessionRequest<BrandResponse>(itemPath(item.kind, item.id), {
      body: { ...common, description: input.description, logo_file_id: input.assetFileId },
      idempotencyKey,
      ifMatch: `"${item.version}"`,
      method: 'PATCH',
    });
    return normalizeBrand(response.data);
  }
  const response = await adminSessionRequest<CategoryResponse>(itemPath(item.kind, item.id), {
    body: { ...common, icon_file_id: input.assetFileId },
    idempotencyKey,
    ifMatch: `"${item.version}"`,
    method: 'PATCH',
  });
  return normalizeCategory(response.data);
}

export async function previewMasterDataLifecycle(
  item: MasterDataItem,
  action: MasterDataAction,
  reason: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<HighRiskPreviewResponse>(
    `${itemPath(item.kind, item.id)}/lifecycle-preview`,
    {
      body: { action, reason },
      idempotencyKey: newIdempotencyKey(),
      method: 'POST',
      signal,
    },
  );
  return response.data;
}

export function confirmMasterDataLifecycle(
  item: MasterDataItem,
  action: MasterDataAction,
  reason: string,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
): Promise<CommandResponse> {
  return adminSessionRequest(`${itemPath(item.kind, item.id)}/lifecycle-changes`, {
    body: {
      action,
      confirmation_hash: preview.confirmation_hash,
      preview_token: preview.preview_token,
      reason,
    },
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
  });
}

export function restoreMasterData(
  item: MasterDataItem,
  reason: string,
  idempotencyKey = newIdempotencyKey(),
): Promise<CommandResponse> {
  return adminSessionRequest(`${itemPath(item.kind, item.id)}/restore`, {
    body: { reason },
    idempotencyKey,
    ifMatch: `"${item.version}"`,
    method: 'POST',
  });
}

export async function uploadCatalogAsset(
  kind: CatalogKind,
  file: File,
  signal?: AbortSignal,
): Promise<UploadedCatalogAsset> {
  const complete = await uploadAdminImage(kind === 'brand' ? 'BRAND_LOGO' : 'CATEGORY_ICON', file, signal);
  return {
    fileId: complete.file_id,
    publicUrl: complete.public_url,
  };
}
