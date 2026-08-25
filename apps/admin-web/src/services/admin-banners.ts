import type { components } from '@qingxu/contracts';

import type {
  BannerEditorInput,
  BannerItem,
  BannerListQuery,
  BannerListResult,
  BannerStatusAction,
  UploadedBannerAsset,
} from '../types/banners';
import { adminSessionRequest, newIdempotencyKey } from './admin-api';
import { uploadAdminImage } from './admin-files';

type BannerCreateRequest = components['schemas']['BannerCreateRequest'];
type BannerUpdateRequest = components['schemas']['BannerUpdateRequest'];
type BannerResponse = components['schemas']['BannerResponse'];
type BannerListResponse = components['schemas']['BannerListResponse'];
type ClosedReasonRequest = components['schemas']['ClosedReasonRequest'];

function bannerPath(bannerId: string): string {
  return `/admin/banners/${encodeURIComponent(bannerId)}`;
}

function versionEtag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('Resource version must be a positive integer');
  }
  return `"${version}"`;
}

function targetRequest(input: BannerEditorInput):
  | { target_type: 'NONE' }
  | { target_type: 'PRODUCT' | 'CATEGORY'; target_id: string }
  | { target_type: 'URL'; target_url: string } {
  if (input.target.targetType === 'NONE') return { target_type: 'NONE' };
  if (input.target.targetType === 'URL') {
    return { target_type: 'URL', target_url: input.target.targetUrl };
  }
  return { target_id: input.target.targetId, target_type: input.target.targetType };
}

function createRequest(input: BannerEditorInput): BannerCreateRequest {
  return {
    ends_at: input.endsAt,
    file_id: input.fileId,
    initial_status: 'DRAFT',
    sort_order: input.sortOrder,
    starts_at: input.startsAt,
    title: input.title,
    ...targetRequest(input),
  };
}

function updateRequest(input: BannerEditorInput): BannerUpdateRequest {
  return {
    ends_at: input.endsAt,
    file_id: input.fileId,
    sort_order: input.sortOrder,
    starts_at: input.startsAt,
    title: input.title,
    ...targetRequest(input),
  };
}

export async function listAdminBanners(
  query: BannerListQuery = {},
  signal?: AbortSignal,
): Promise<BannerListResult> {
  const search = new URLSearchParams();
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.pageSize !== undefined) search.set('page_size', String(query.pageSize));
  if (query.keyword) search.set('keyword', query.keyword);
  if (query.status) search.set('status', query.status);
  const suffix = search.size > 0 ? `?${search.toString()}` : '';
  const response = await adminSessionRequest<BannerListResponse>(`/admin/banners${suffix}`, { signal });
  return {
    items: response.data.items,
    pagination: {
      page: response.data.pagination.page,
      pageSize: response.data.pagination.page_size,
      total: response.data.pagination.total,
    },
  };
}

export async function createAdminBanner(
  input: BannerEditorInput,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<BannerItem> {
  const response = await adminSessionRequest<BannerResponse>('/admin/banners', {
    body: createRequest(input),
    idempotencyKey,
    method: 'POST',
    signal,
  });
  return response.data;
}

export async function updateAdminBanner(
  bannerId: string,
  input: BannerEditorInput,
  version: number,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<BannerItem> {
  const response = await adminSessionRequest<BannerResponse>(bannerPath(bannerId), {
    body: updateRequest(input),
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'PATCH',
    signal,
  });
  return response.data;
}

export async function changeAdminBannerStatus(
  bannerId: string,
  action: BannerStatusAction,
  version: number,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<BannerItem> {
  const body: components['schemas']['BannerStatusAction'] = { action };
  const response = await adminSessionRequest<BannerResponse>(bannerPath(bannerId), {
    body,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'PATCH',
    signal,
  });
  return response.data;
}

export async function archiveAdminBanner(
  bannerId: string,
  reason: string,
  version: number,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<BannerItem> {
  const body: ClosedReasonRequest = { reason };
  const response = await adminSessionRequest<BannerResponse>(bannerPath(bannerId), {
    body,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'DELETE',
    signal,
  });
  return response.data;
}

export async function restoreAdminBanner(
  bannerId: string,
  reason: string,
  version: number,
  idempotencyKey = newIdempotencyKey(),
  signal?: AbortSignal,
): Promise<BannerItem> {
  const body: ClosedReasonRequest = { reason };
  const response = await adminSessionRequest<BannerResponse>(`${bannerPath(bannerId)}/restore`, {
    body,
    idempotencyKey,
    ifMatch: versionEtag(version),
    method: 'POST',
    signal,
  });
  return response.data;
}

export async function uploadBannerAsset(
  file: File,
  signal?: AbortSignal,
): Promise<UploadedBannerAsset> {
  const complete = await uploadAdminImage('BANNER', file, signal);
  return { fileId: complete.file_id, publicUrl: complete.public_url };
}
