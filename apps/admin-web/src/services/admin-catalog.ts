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
  AdminApiError,
  adminSessionRequest,
  newIdempotencyKey,
} from './admin-api';

type BrandResponse = components['schemas']['BrandResponse'];
type BrandListResponse = components['schemas']['BrandListResponse'];
type CategoryResponse = components['schemas']['CategoryResponse'];
type CategoryListResponse = components['schemas']['CategoryListResponse'];
type HighRiskPreviewResponse = components['schemas']['HighRiskPreviewResponse'];
type CommandResponse = components['schemas']['CommandResponse'];
type UploadIntentResponse = components['schemas']['FileUploadIntentResponse'];
type UploadCompleteResponse = components['schemas']['FileUploadCompleteResponse'];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

function collectionPath(kind: CatalogKind): '/admin/brands' | '/admin/categories' {
  return kind === 'brand' ? '/admin/brands' : '/admin/categories';
}

function itemPath(kind: CatalogKind, id: string): string {
  return `${collectionPath(kind)}/${encodeURIComponent(id)}`;
}

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export function safePublicAssetUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname))) return url.href;
  } catch {
    // Unsafe or malformed media URLs are deliberately ignored.
  }
  return null;
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

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateImage(file: File): void {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) {
    throw new AdminApiError('仅支持 JPEG 或 PNG 图片', { status: 422, code: 'UNSUPPORTED_FILE_TYPE' });
  }
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    throw new AdminApiError('图片大小必须在 1 Byte 至 5 MiB 之间', { status: 422, code: 'FILE_SIZE_OUT_OF_RANGE' });
  }
}

export async function uploadCatalogAsset(
  kind: CatalogKind,
  file: File,
  signal?: AbortSignal,
): Promise<UploadedCatalogAsset> {
  validateImage(file);
  const digest = await sha256(file);
  const intent = await adminSessionRequest<UploadIntentResponse>('/files/upload-intents', {
    body: {
      filename: file.name,
      mime_type: file.type,
      purpose: kind === 'brand' ? 'BRAND_LOGO' : 'CATEGORY_ICON',
      sha256: digest,
      size: file.size,
    },
    idempotencyKey: newIdempotencyKey(),
    method: 'POST',
    signal,
  });

  const uploadHeaders = new Headers();
  for (const header of intent.data.upload_headers) uploadHeaders.set(header.name, header.value);
  const uploadUrl = safePublicAssetUrl(intent.data.upload_url);
  if (!uploadUrl) {
    throw new AdminApiError('服务端返回了不安全的上传地址', { status: 502, code: 'INVALID_UPLOAD_URL' });
  }
  let uploaded: Response;
  try {
    const uploadInit: RequestInit = {
      body: file,
      cache: 'no-store',
      credentials: 'omit',
      headers: uploadHeaders,
      method: 'PUT',
      referrerPolicy: 'no-referrer',
    };
    if (signal) uploadInit.signal = signal;
    uploaded = await fetch(uploadUrl, uploadInit);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AdminApiError('图片上传失败，请重新选择后再试', { status: 0, code: 'UPLOAD_NETWORK_ERROR' });
  }
  if (!uploaded.ok) {
    throw new AdminApiError('对象存储未接受图片，请重新选择后再试', {
      status: uploaded.status,
      code: 'UPLOAD_REJECTED',
    });
  }

  const completeKey = newIdempotencyKey();
  const completeOperation = () => adminSessionRequest<UploadCompleteResponse>(
      `/files/${encodeURIComponent(intent.data.file_id)}/complete`,
      {
      body: { sha256: digest, size: file.size },
      idempotencyKey: completeKey,
      method: 'POST',
      signal,
    },
  );
  let complete: UploadCompleteResponse;
  try {
    complete = await completeOperation();
  } catch (error) {
    if (!(error instanceof AdminApiError) || (error.status !== 0 && error.status < 500)) throw error;
    complete = await completeOperation();
  }
  const publicUrl = safePublicAssetUrl(complete.data.public_url);
  if (!publicUrl) {
    throw new AdminApiError('服务端未返回安全的公开素材地址', { status: 502, code: 'INVALID_UPLOAD_URL' });
  }
  return {
    fileId: complete.data.file_id,
    publicUrl,
  };
}
