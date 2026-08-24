import type { components } from '@qingxu/contracts';

import type {
  ActiveProductReferences,
  AdminProductListData,
  AdminProductListResponse,
  BrandReference,
  CategoryReference,
  CommandResponse,
  HighRiskPreview,
  HighRiskPreviewResponse,
  ProductCreateRequest,
  ProductDetail,
  ProductDetailResponse,
  ProductLifecycleRequest,
  ProductListQuery,
  ProductUpdateRequest,
  RestoreRequest,
  Sku,
  SkuCreateRequest,
  SkuLifecycleRequest,
  SkuResponse,
  SkuUpdateRequest,
} from '../types/products';
import { adminSessionRequest, newIdempotencyKey } from './admin-api';

type BrandListResponse = components['schemas']['BrandListResponse'];
type CategoryListResponse = components['schemas']['CategoryListResponse'];

function versionEtag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new TypeError('Resource version must be a positive integer');
  return `"${version}"`;
}

function productPath(productId: string): string {
  return `/admin/products/${encodeURIComponent(productId)}`;
}

function skuPath(skuId: string): string {
  return `/admin/skus/${encodeURIComponent(skuId)}`;
}

export async function listAdminProducts(
  query: ProductListQuery = {},
  signal?: AbortSignal,
): Promise<AdminProductListData> {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.brandId) search.set('brand_id', query.brandId);
  if (query.categoryId) search.set('category_id', query.categoryId);
  if (query.status) search.set('status', query.status);
  if (query.recommended !== undefined) search.set('recommended', String(query.recommended));
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  const response = await adminSessionRequest<AdminProductListResponse>(`/admin/products${suffix}`, { signal });
  return response.data;
}

export async function getAdminProduct(productId: string, signal?: AbortSignal): Promise<ProductDetail> {
  const response = await adminSessionRequest<ProductDetailResponse>(productPath(productId), { signal });
  return response.data;
}

export async function createAdminProduct(
  input: ProductCreateRequest,
  idempotencyKey = newIdempotencyKey(),
): Promise<ProductDetail> {
  const response = await adminSessionRequest<ProductDetailResponse>('/admin/products', {
    body: input,
    idempotencyKey,
    method: 'POST',
  });
  return response.data;
}

export async function updateAdminProduct(
  productId: string,
  input: ProductUpdateRequest,
  version: number,
  idempotencyKey = newIdempotencyKey(),
): Promise<ProductDetail> {
  const response = await adminSessionRequest<ProductDetailResponse>(productPath(productId), {
    body: input,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'PATCH',
  });
  return response.data;
}

export async function createAdminSku(
  productId: string,
  input: SkuCreateRequest,
  idempotencyKey = newIdempotencyKey(),
): Promise<Sku> {
  const response = await adminSessionRequest<SkuResponse>(`${productPath(productId)}/skus`, {
    body: input,
    idempotencyKey,
    method: 'POST',
  });
  return response.data;
}

export async function updateAdminSku(
  skuId: string,
  input: SkuUpdateRequest,
  version: number,
  idempotencyKey = newIdempotencyKey(),
): Promise<Sku> {
  const response = await adminSessionRequest<SkuResponse>(skuPath(skuId), {
    body: input,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'PATCH',
  });
  return response.data;
}

async function previewLifecycle(
  path: string,
  input: ProductLifecycleRequest | SkuLifecycleRequest,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  const response = await adminSessionRequest<HighRiskPreviewResponse>(`${path}/lifecycle-preview`, {
    body: input,
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return response.data;
}

async function confirmLifecycle(
  path: string,
  input: ProductLifecycleRequest | SkuLifecycleRequest,
  preview: HighRiskPreview,
  idempotencyKey: string,
): Promise<CommandResponse> {
  return adminSessionRequest(`${path}/lifecycle-changes`, {
    body: {
      ...input,
      confirmation_hash: preview.confirmation_hash,
      preview_token: preview.preview_token,
    },
    idempotencyKey,
    ifMatch: preview.resource_etag,
    method: 'POST',
  });
}

async function restoreLifecycle(
  path: string,
  input: RestoreRequest,
  version: number,
  idempotencyKey: string,
): Promise<CommandResponse> {
  return adminSessionRequest(path + '/restore', {
    body: input,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'POST',
  });
}

export function previewProductLifecycle(
  productId: string,
  input: ProductLifecycleRequest,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  return previewLifecycle(productPath(productId), input, idempotencyKey, signal);
}

export function confirmProductLifecycle(
  productId: string,
  input: ProductLifecycleRequest,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
): Promise<CommandResponse> {
  return confirmLifecycle(productPath(productId), input, preview, idempotencyKey);
}

export function restoreProduct(
  productId: string,
  input: RestoreRequest,
  version: number,
  idempotencyKey = newIdempotencyKey(),
): Promise<CommandResponse> {
  return restoreLifecycle(productPath(productId), input, version, idempotencyKey);
}

export function previewSkuLifecycle(
  skuId: string,
  input: SkuLifecycleRequest,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<HighRiskPreview> {
  return previewLifecycle(skuPath(skuId), input, idempotencyKey, signal);
}

export function confirmSkuLifecycle(
  skuId: string,
  input: SkuLifecycleRequest,
  preview: HighRiskPreview,
  idempotencyKey = newIdempotencyKey(),
): Promise<CommandResponse> {
  return confirmLifecycle(skuPath(skuId), input, preview, idempotencyKey);
}

export function restoreSku(
  skuId: string,
  input: RestoreRequest,
  version: number,
  idempotencyKey = newIdempotencyKey(),
): Promise<CommandResponse> {
  return restoreLifecycle(skuPath(skuId), input, version, idempotencyKey);
}

async function listAllActive<T extends BrandReference | CategoryReference>(
  path: '/admin/brands' | '/admin/categories',
  signal?: AbortSignal,
): Promise<T[]> {
  const items: T[] = [];
  let page = 1;
  while (true) {
    const search = new URLSearchParams({ page: String(page), page_size: '100', status: 'ACTIVE' });
    const response = path === '/admin/brands'
      ? await adminSessionRequest<BrandListResponse>(`${path}?${search}`, { signal })
      : await adminSessionRequest<CategoryListResponse>(`${path}?${search}`, { signal });
    const current = response.data.items as T[];
    items.push(...current);
    if (items.length >= response.data.pagination.total || current.length === 0) return items;
    page += 1;
  }
}

export async function listActiveCatalogOptions(signal?: AbortSignal): Promise<ActiveProductReferences> {
  const [brands, categories] = await Promise.all([
    listAllActive<BrandReference>('/admin/brands', signal),
    listAllActive<CategoryReference>('/admin/categories', signal),
  ]);
  return { brands, categories };
}
