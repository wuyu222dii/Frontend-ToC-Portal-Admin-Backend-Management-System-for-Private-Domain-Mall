import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

export const FILE_PURPOSES = [
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
  'AFTERSALE_EVIDENCE',
  'WITHDRAWAL_PROOF',
  'PROMOTION_QR',
] as const;

export type FilePurposeInput = (typeof FILE_PURPOSES)[number];
export type FileMimeTypeInput = 'image/jpeg' | 'image/png';

export interface UploadIntentInput {
  filename: string;
  mimeType: FileMimeTypeInput;
  purpose: FilePurposeInput;
  sha256: string;
  size: number;
}

export interface UploadCompleteInput {
  sha256: string;
  size: number;
}

type PlainBody = Record<string, unknown>;

function exactBody(value: unknown, fields: readonly string[]): PlainBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'Request body must be an object');
  }
  const body = value as PlainBody;
  if (Object.keys(body).length !== fields.length || fields.some((field) => !(field in body)) ||
    Object.keys(body).some((field) => !fields.includes(field))) {
    throw new ApplicationError('INVALID_ARGUMENT', 'Request body fields are invalid');
  }
  return body;
}

function sha256Field(body: PlainBody): string {
  const value = body.sha256;
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'sha256 is invalid');
  }
  return value;
}

function sizeField(body: PlainBody): number {
  const value = body.size;
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 5_242_880) {
    throw new ApplicationError('INVALID_ARGUMENT', 'size is invalid');
  }
  return Number(value);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function parseUploadIntentBody(value: unknown): UploadIntentInput {
  const body = exactBody(value, ['purpose', 'filename', 'mime_type', 'size', 'sha256']);
  if (typeof body.purpose !== 'string' || !(FILE_PURPOSES as readonly string[]).includes(body.purpose)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'purpose is invalid');
  }
  if (typeof body.filename !== 'string' || body.filename.length < 1 || body.filename.length > 255 ||
    body.filename.trim().length === 0 || hasControlCharacter(body.filename)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'filename is invalid');
  }
  if (body.mime_type !== 'image/jpeg' && body.mime_type !== 'image/png') {
    throw new ApplicationError('INVALID_ARGUMENT', 'mime_type is invalid');
  }
  return {
    filename: body.filename,
    mimeType: body.mime_type,
    purpose: body.purpose as FilePurposeInput,
    sha256: sha256Field(body),
    size: sizeField(body),
  };
}

export function parseUploadCompleteBody(value: unknown): UploadCompleteInput {
  const body = exactBody(value, ['sha256', 'size']);
  return { sha256: sha256Field(body), size: sizeField(body) };
}

export function parseFileId(value: string): string {
  if (!isValidUlid(value)) throw new ApplicationError('INVALID_ARGUMENT', 'file_id is invalid');
  return value;
}
