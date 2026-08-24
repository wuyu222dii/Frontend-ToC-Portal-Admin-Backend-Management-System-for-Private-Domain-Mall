import type { components } from '@qingxu/contracts';

import {
  AdminApiError,
  adminSessionRequest,
  newIdempotencyKey,
} from './admin-api';

type UploadIntentRequest = components['schemas']['UploadIntentRequest'];
type UploadCompleteRequest = components['schemas']['UploadCompleteRequest'];
type UploadIntentResponse = components['schemas']['FileUploadIntentResponse'];
type UploadCompleteResponse = components['schemas']['FileUploadCompleteResponse'];

export type AdminImagePurpose = UploadIntentRequest['purpose'];
export type UploadedAdminImage = UploadCompleteResponse['data'];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set<UploadIntentRequest['mime_type']>(['image/jpeg', 'image/png']);
const PUBLIC_IMAGE_PURPOSES = new Set<AdminImagePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
]);

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

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function validateImage(file: File): asserts file is File & { type: UploadIntentRequest['mime_type'] } {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type as UploadIntentRequest['mime_type'])) {
    throw new AdminApiError('仅支持 JPEG 或 PNG 图片', { status: 422, code: 'UNSUPPORTED_FILE_TYPE' });
  }
  if (file.size < 1 || file.size > MAX_IMAGE_BYTES) {
    throw new AdminApiError('图片大小必须在 1 Byte 至 5 MiB 之间', { status: 422, code: 'FILE_SIZE_OUT_OF_RANGE' });
  }
}

export async function uploadAdminImage(
  purpose: AdminImagePurpose,
  file: File,
  signal?: AbortSignal,
): Promise<UploadedAdminImage> {
  validateImage(file);
  const digest = await sha256(file);
  const intentBody: UploadIntentRequest = {
    filename: file.name,
    mime_type: file.type,
    purpose,
    sha256: digest,
    size: file.size,
  };
  const intent = await adminSessionRequest<UploadIntentResponse>('/files/upload-intents', {
    body: intentBody,
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

  const completeBody: UploadCompleteRequest = { sha256: digest, size: file.size };
  const completeKey = newIdempotencyKey();
  const completeOperation = () => adminSessionRequest<UploadCompleteResponse>(
    `/files/${encodeURIComponent(intent.data.file_id)}/complete`,
    {
      body: completeBody,
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
  if ((complete.data.public_url !== null || PUBLIC_IMAGE_PURPOSES.has(purpose)) && !publicUrl) {
    throw new AdminApiError('服务端未返回安全的公开素材地址', { status: 502, code: 'INVALID_UPLOAD_URL' });
  }
  return { ...complete.data, public_url: publicUrl };
}
