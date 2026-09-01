import type { components } from '@qingxu/contracts';

import type {
  StoreAftersaleEvidenceImageInput,
  StoreUploadedAftersaleEvidence,
} from '../types/store-files';
import {
  customerSessionGeneration,
  loadCustomerRefreshCredential,
} from '../utils/customer-session';
import { StoreApiError, StoreEnvelopeFormatError } from './store-client';
import { authenticatedRequest, createIdempotencyKey } from './store-identity';

type UploadIntentInput = components['schemas']['UploadIntentRequest'];
type UploadIntent = components['schemas']['FileUploadIntentResponse']['data'];
type UploadCompleteInput = components['schemas']['UploadCompleteRequest'];
type RecordValue = Record<string, unknown>;

const maxImageBytes = 5 * 1024 * 1024;
const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const rfc3339Pattern = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const sha256Constants = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function invalidEnvelope(): never {
  throw new StoreEnvelopeFormatError();
}

function exactRecord(value: unknown, required: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalidEnvelope();
  const current = value as RecordValue;
  if (Object.keys(current).length !== required.length ||
    !required.every((key) => Object.hasOwn(current, key))) invalidEnvelope();
  return current;
}

function text(value: unknown, minimum = 1, maximum = 2_048): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalidEnvelope();
  return value;
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function ulid(value: unknown): string {
  const current = text(value, 26, 26);
  if (!ulidPattern.test(current)) invalidEnvelope();
  return current;
}

function timestamp(value: unknown): string {
  const current = text(value);
  const match = rfc3339Pattern.exec(current);
  if (match === null) invalidEnvelope();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > (monthDays[month - 1] ?? 0) ||
    hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 ||
    !Number.isFinite(Date.parse(current))) invalidEnvelope();
  return current;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256HexBytes(input: Uint8Array): string {
  const bitLength = input.length * 8;
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const paddedView = new DataView(padded.buffer);
  paddedView.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  paddedView.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      words[index] = paddedView.getUint32(offset + index * 4);
    }
    for (let index = 16; index < 64; index += 1) {
      const word15 = words[index - 15] ?? 0;
      const word2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(word15, 7) ^ rotateRight(word15, 18) ^ (word15 >>> 3);
      const sigma1 = rotateRight(word2, 17) ^ rotateRight(word2, 19) ^ (word2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let a = state[0] ?? 0;
    let b = state[1] ?? 0;
    let c = state[2] ?? 0;
    let d = state[3] ?? 0;
    let e = state[4] ?? 0;
    let f = state[5] ?? 0;
    let g = state[6] ?? 0;
    let h = state[7] ?? 0;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choice = (e & f) ^ (~e & g);
      const first = (h + sigma1 + choice + (sha256Constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const second = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + first) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (first + second) >>> 0;
    }
    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }
  return [...state].map((word) => word.toString(16).padStart(8, '0')).join('');
}

function loopback(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized.endsWith('.localhost') ||
    normalized === '127.0.0.1' || normalized === '[::1]';
}

export function safeStoreUploadUrl(value: unknown): string {
  const current = text(value);
  const match = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?][^\s#]*)?$/i.exec(current);
  if (match === null || match[1] === undefined || match[2] === undefined) invalidEnvelope();
  if (match[3] !== undefined) {
    const port = Number(match[3]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) invalidEnvelope();
  }
  if (match[1].toLowerCase() !== 'https' && !loopback(match[2])) invalidEnvelope();
  return current;
}

function decodeIntent(value: unknown, mimeType: string, digest: string): UploadIntent {
  const current = exactRecord(value, [
    'file_id', 'purpose', 'status', 'upload_url', 'upload_headers', 'expires_at',
  ]);
  if (current.purpose !== 'AFTERSALE_EVIDENCE' || current.status !== 'PENDING' ||
    !Array.isArray(current.upload_headers) || current.upload_headers.length !== 2) invalidEnvelope();
  const headers = current.upload_headers.map((value) => {
    const header = exactRecord(value, ['name', 'value']);
    return { name: text(header.name, 1, 128), value: text(header.value, 1, 512) };
  });
  const normalizedHeaders = new Map(headers.map(({ name, value }) => [name.toLowerCase(), value]));
  if (normalizedHeaders.size !== headers.length || normalizedHeaders.get('content-type') !== mimeType ||
    normalizedHeaders.get('x-amz-meta-sha256') !== digest) invalidEnvelope();
  return {
    file_id: ulid(current.file_id),
    purpose: 'AFTERSALE_EVIDENCE',
    status: 'PENDING',
    upload_url: safeStoreUploadUrl(current.upload_url),
    upload_headers: headers,
    expires_at: timestamp(current.expires_at),
  };
}

function decodeComplete(value: unknown, fileId: string): StoreUploadedAftersaleEvidence {
  const current = exactRecord(value, [
    'file_id', 'purpose', 'status', 'public_url', 'completed_at',
  ]);
  if (ulid(current.file_id) !== fileId || current.purpose !== 'AFTERSALE_EVIDENCE' ||
    current.status !== 'READY' || current.public_url !== null) invalidEnvelope();
  return {
    file_id: fileId,
    purpose: 'AFTERSALE_EVIDENCE',
    status: 'READY',
    public_url: null,
    completed_at: timestamp(current.completed_at),
  };
}

function imageBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value.slice();
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  throw new StoreApiError('图片内容无效', { status: 422, code: 'INVALID_FILE_CONTENT' });
}

function normalizedImage(input: StoreAftersaleEvidenceImageInput): {
  bytes: Uint8Array;
  filename: string;
  mimeType: UploadIntentInput['mime_type'];
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.keys(input).length !== 3 ||
    !['bytes', 'filename', 'mime_type'].every((key) => Object.hasOwn(input, key))) {
    throw new StoreApiError('图片参数无效', { status: 422, code: 'INVALID_FILE_INPUT' });
  }
  if (input.mime_type !== 'image/jpeg' && input.mime_type !== 'image/png') {
    throw new StoreApiError('仅支持 JPEG 或 PNG 图片', { status: 422, code: 'UNSUPPORTED_FILE_TYPE' });
  }
  if (typeof input.filename !== 'string' || hasControlCharacter(input.filename)) {
    throw new StoreApiError('图片文件名无效', { status: 422, code: 'INVALID_FILE_NAME' });
  }
  const filename = input.filename.trim();
  if (filename.length < 1 || filename.length > 255) {
    throw new StoreApiError('图片文件名无效', { status: 422, code: 'INVALID_FILE_NAME' });
  }
  const bytes = imageBytes(input.bytes);
  if (bytes.byteLength < 1 || bytes.byteLength > maxImageBytes) {
    throw new StoreApiError('图片大小必须在 1 Byte 至 5 MiB 之间', {
      status: 422,
      code: 'FILE_SIZE_OUT_OF_RANGE',
    });
  }
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10]
    .every((byte, index) => bytes[index] === byte);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if ((input.mime_type === 'image/png' && !png) || (input.mime_type === 'image/jpeg' && !jpeg)) {
    throw new StoreApiError('图片格式与文件内容不一致', { status: 422, code: 'FILE_CONTENT_MISMATCH' });
  }
  return { bytes, filename, mimeType: input.mime_type };
}

function rawPut(intent: UploadIntent, bytes: Uint8Array): Promise<void> {
  const headers = Object.fromEntries(intent.upload_headers.map(({ name, value }) => [name, value]));
  return new Promise((resolve, reject) => {
    try {
      uni.request({
        url: intent.upload_url,
        method: 'PUT',
        data: bytes.buffer,
        dataType: 'text',
        responseType: 'text',
        withCredentials: false,
        header: headers,
        success(response) {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve();
          else reject(new StoreApiError('对象存储未接受图片', {
            status: response.statusCode,
            code: 'UPLOAD_REJECTED',
          }));
        },
        fail(result) {
          reject(new StoreApiError('图片上传失败', {
            status: 0,
            code: /abort/i.test(result.errMsg) ? 'REQUEST_ABORTED' : 'UPLOAD_NETWORK_ERROR',
            aborted: /abort/i.test(result.errMsg),
          }));
        },
      });
    } catch {
      reject(new StoreApiError('图片上传失败', { status: 0, code: 'UPLOAD_NETWORK_ERROR' }));
    }
  });
}

function completeKey(value: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 ||
    hasControlCharacter(value)) {
    throw new Error('complete idempotency key is invalid');
  }
  return value;
}

interface UploadSessionBinding {
  readonly generation: number;
}

function captureUploadSession(): UploadSessionBinding {
  const credential = loadCustomerRefreshCredential();
  if (credential === null) {
    throw new StoreApiError('请先登录', { status: 401, code: 'AUTH_REQUIRED' });
  }
  return {
    generation: customerSessionGeneration(),
  };
}

function assertUploadSession(binding: UploadSessionBinding): void {
  const credential = loadCustomerRefreshCredential();
  if (customerSessionGeneration() !== binding.generation || credential === null) {
    throw new StoreApiError('登录状态已经变化，请重新上传', {
      status: 409,
      code: 'SESSION_CHANGED',
    });
  }
}

export async function uploadStoreAftersaleEvidence(
  input: StoreAftersaleEvidenceImageInput,
  completeIdempotencyKey = createIdempotencyKey(),
): Promise<StoreUploadedAftersaleEvidence> {
  const image = normalizedImage(input);
  const digest = sha256HexBytes(image.bytes);
  if (!sha256Pattern.test(digest)) {
    throw new StoreApiError('无法校验图片完整性', { status: 422, code: 'INVALID_FILE_HASH' });
  }
  const sessionBinding = captureUploadSession();
  const intentBody: UploadIntentInput = {
    purpose: 'AFTERSALE_EVIDENCE',
    filename: image.filename,
    mime_type: image.mimeType,
    size: image.bytes.byteLength,
    sha256: digest,
  };
  const intent = await authenticatedRequest('/files/upload-intents', {
    data: intentBody,
    decode: (value) => decodeIntent(value, image.mimeType, digest),
    expectedStatus: 200,
    headers: { 'Idempotency-Key': createIdempotencyKey() },
    method: 'POST',
  });
  assertUploadSession(sessionBinding);
  await rawPut(intent, image.bytes);

  const key = completeKey(completeIdempotencyKey);
  const completeBody: UploadCompleteInput = { sha256: digest, size: image.bytes.byteLength };
  const operation = () => {
    assertUploadSession(sessionBinding);
    return authenticatedRequest(`/files/${encodeURIComponent(intent.file_id)}/complete`, {
      data: completeBody,
      decode: (value) => decodeComplete(value, intent.file_id),
      expectedStatus: 200,
      headers: { 'Idempotency-Key': key },
      method: 'POST',
    });
  };
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof StoreApiError) || (error.status !== 0 && error.status < 500)) throw error;
    return operation();
  }
}
