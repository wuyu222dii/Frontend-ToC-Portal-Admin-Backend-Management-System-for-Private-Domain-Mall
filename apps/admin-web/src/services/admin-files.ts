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
type FileDownloadUrlResponse = components['schemas']['FileDownloadUrlResponse'];
type UploadIntent = UploadIntentResponse['data'];

export type AdminImagePurpose = UploadIntentRequest['purpose'];
export type UploadedAdminImage = UploadCompleteResponse['data'];
export type AdminFileDownloadUrl = FileDownloadUrlResponse['data'];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set<UploadIntentRequest['mime_type']>(['image/jpeg', 'image/png']);
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;
const PUBLIC_IMAGE_PURPOSES = new Set<AdminImagePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
]);

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function isDateTime(value: string): boolean {
  if (!RFC3339.test(value) || !Number.isFinite(Date.parse(value))) return false;
  const [date, timeWithOffset] = value.split(/[Tt]/, 2);
  const [yearText, monthText, dayText] = date?.split('-') ?? [];
  const [hourText, minuteText, secondAndOffset] = timeWithOffset?.split(':', 3) ?? [];
  const secondText = secondAndOffset?.slice(0, 2);
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (monthDays[month - 1] ?? 0) &&
    Number(hourText) <= 23 && Number(minuteText) <= 59 && Number(secondText) <= 59;
}

function invalidUploadResponse(path: string): never {
  throw new TypeError(`Invalid file upload response at ${path}`);
}

function exactUploadRecord(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidUploadResponse(path);
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== keys.length || keys.some((key) => !Object.hasOwn(record, key))) {
    invalidUploadResponse(path);
  }
  return record;
}

function uploadHeader(value: unknown, index: number): { name: string; value: string } {
  const header = exactUploadRecord(value, ['name', 'value'], `response.data.upload_headers[${index}]`);
  if (typeof header.name !== 'string' || header.name.length < 1 || header.name.length > 128 ||
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(header.name) ||
    typeof header.value !== 'string' || header.value.length < 1 || header.value.length > 512 ||
    /[\r\n]/.test(header.value)) {
    invalidUploadResponse(`response.data.upload_headers[${index}]`);
  }
  return { name: header.name, value: header.value };
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

export function decodeAdminFileUploadIntentResponse(
  value: unknown,
  expected: Pick<UploadIntentRequest, 'mime_type' | 'purpose' | 'sha256'>,
): UploadIntent {
  const envelope = exactUploadRecord(value, ['code', 'message', 'data', 'request_id'], 'response');
  if (envelope.code !== 'OK' || envelope.message !== 'success' ||
    typeof envelope.request_id !== 'string' || envelope.request_id.length === 0) {
    invalidUploadResponse('response');
  }
  const data = exactUploadRecord(envelope.data, [
    'file_id', 'purpose', 'status', 'upload_url', 'upload_headers', 'expires_at',
  ], 'response.data');
  if (typeof data.file_id !== 'string' || !ULID.test(data.file_id) ||
    data.purpose !== expected.purpose || data.status !== 'PENDING' ||
    typeof data.expires_at !== 'string' || !isDateTime(data.expires_at) ||
    !Array.isArray(data.upload_headers) || data.upload_headers.length !== 2) {
    invalidUploadResponse('response.data');
  }
  const uploadUrl = typeof data.upload_url === 'string' ? safePublicAssetUrl(data.upload_url) : null;
  if (uploadUrl === null) invalidUploadResponse('response.data.upload_url');
  const uploadHeaders = data.upload_headers.map(uploadHeader);
  const normalizedHeaders = new Map(uploadHeaders.map(({ name, value }) => [name.toLowerCase(), value]));
  if (normalizedHeaders.size !== uploadHeaders.length ||
    normalizedHeaders.get('content-type') !== expected.mime_type ||
    normalizedHeaders.get('x-amz-meta-sha256') !== expected.sha256) {
    invalidUploadResponse('response.data.upload_headers');
  }
  return {
    expires_at: data.expires_at,
    file_id: data.file_id,
    purpose: expected.purpose,
    status: 'PENDING',
    upload_headers: uploadHeaders,
    upload_url: uploadUrl,
  };
}

export function decodeAdminFileUploadCompleteResponse(
  value: unknown,
  expected: { fileId: string; purpose: AdminImagePurpose },
): UploadedAdminImage {
  const envelope = exactUploadRecord(value, ['code', 'message', 'data', 'request_id'], 'response');
  if (envelope.code !== 'OK' || envelope.message !== 'success' ||
    typeof envelope.request_id !== 'string' || envelope.request_id.length === 0) {
    invalidUploadResponse('response');
  }
  const data = exactUploadRecord(envelope.data, [
    'file_id', 'purpose', 'status', 'public_url', 'completed_at',
  ], 'response.data');
  if (typeof data.file_id !== 'string' || !ULID.test(data.file_id) || data.file_id !== expected.fileId ||
    data.purpose !== expected.purpose || data.status !== 'READY' ||
    typeof data.completed_at !== 'string' || !isDateTime(data.completed_at)) {
    invalidUploadResponse('response.data');
  }
  const publicPurpose = PUBLIC_IMAGE_PURPOSES.has(expected.purpose);
  const publicUrl = typeof data.public_url === 'string' ? safePublicAssetUrl(data.public_url) : null;
  if ((publicPurpose && publicUrl === null) || (!publicPurpose && data.public_url !== null)) {
    invalidUploadResponse('response.data.public_url');
  }
  return {
    completed_at: data.completed_at,
    file_id: expected.fileId,
    public_url: publicUrl,
    purpose: expected.purpose,
    status: 'READY',
  };
}

export function decodeAdminFileDownloadUrlResponse(
  value: unknown,
  expectedFileId?: string,
): AdminFileDownloadUrl {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Invalid file download response at response');
  }
  const envelope = value as Record<string, unknown>;
  const envelopeKeys = new Set(['code', 'message', 'data', 'request_id']);
  if (Object.keys(envelope).length !== envelopeKeys.size ||
    Object.keys(envelope).some((key) => !envelopeKeys.has(key)) ||
    envelope.code !== 'OK' || envelope.message !== 'success' ||
    typeof envelope.request_id !== 'string' || envelope.request_id.length === 0 ||
    typeof envelope.data !== 'object' || envelope.data === null || Array.isArray(envelope.data)) {
    throw new TypeError('Invalid file download response at response');
  }
  const data = envelope.data as Record<string, unknown>;
  const dataKeys = new Set(['file_id', 'download_url', 'expires_at']);
  if (Object.keys(data).length !== dataKeys.size || Object.keys(data).some((key) => !dataKeys.has(key)) ||
    typeof data.file_id !== 'string' || !ULID.test(data.file_id) ||
    (expectedFileId !== undefined && data.file_id !== expectedFileId) ||
    typeof data.expires_at !== 'string' || !isDateTime(data.expires_at)) {
    throw new TypeError('Invalid file download response at response.data');
  }
  const downloadUrl = typeof data.download_url === 'string' ? safePublicAssetUrl(data.download_url) : null;
  if (downloadUrl === null) throw new TypeError('Invalid file download response at response.data.download_url');
  return { download_url: downloadUrl, expires_at: data.expires_at, file_id: data.file_id };
}

export async function getAdminFileDownloadUrl(
  fileId: string,
  signal?: AbortSignal,
): Promise<AdminFileDownloadUrl> {
  if (!ULID.test(fileId)) throw new TypeError('fileId must be a ULID');
  const response = await adminSessionRequest<unknown>(
    `/files/${encodeURIComponent(fileId)}/download-url`,
    { expectedStatus: 200, signal },
  );
  return decodeAdminFileDownloadUrlResponse(response, fileId);
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
  const intentResponse = await adminSessionRequest<unknown>('/files/upload-intents', {
    body: intentBody,
    expectedStatus: 200,
    idempotencyKey: newIdempotencyKey(),
    method: 'POST',
    signal,
  });
  const intent = decodeAdminFileUploadIntentResponse(intentResponse, intentBody);

  const uploadHeaders = new Headers();
  for (const header of intent.upload_headers) uploadHeaders.set(header.name, header.value);

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
    uploaded = await fetch(intent.upload_url, uploadInit);
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
  const completeOperation = async () => {
    const response = await adminSessionRequest<unknown>(
      `/files/${encodeURIComponent(intent.file_id)}/complete`,
      {
        body: completeBody,
        expectedStatus: 200,
        idempotencyKey: completeKey,
        method: 'POST',
        signal,
      },
    );
    return decodeAdminFileUploadCompleteResponse(response, { fileId: intent.file_id, purpose });
  };
  let complete: UploadedAdminImage;
  try {
    complete = await completeOperation();
  } catch (error) {
    if (!(error instanceof AdminApiError) || (error.status !== 0 && error.status < 500)) throw error;
    complete = await completeOperation();
  }

  return complete;
}
