import { ApplicationError } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export interface StoreDeletionPreviewInput {
  acknowledged: true;
}

export interface StoreDeletionConfirmInput extends StoreDeletionPreviewInput {
  confirmationHash: string;
  previewToken: string;
}

const SHA256 = /^[a-f0-9]{64}$/;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function closedBody(value: unknown, required: readonly string[]): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Request body must be an object');
  }
  const body = value as PlainRecord;
  const allowed = new Set(required);
  if (required.some((field) => !Object.hasOwn(body, field)) ||
    Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function acknowledged(value: unknown): true {
  if (value !== true) return invalid('acknowledged is invalid');
  return true;
}

function boundedString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const length = Array.from(value).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return value;
}

export function parseStoreDeletionPreviewBody(value: unknown): StoreDeletionPreviewInput {
  const body = closedBody(value, ['acknowledged']);
  return { acknowledged: acknowledged(body.acknowledged) };
}

export function parseStoreDeletionConfirmBody(value: unknown): StoreDeletionConfirmInput {
  const body = closedBody(value, ['acknowledged', 'preview_token', 'confirmation_hash']);
  const confirmationHash = boundedString(body.confirmation_hash, 'confirmation_hash', 64, 64);
  if (!SHA256.test(confirmationHash)) return invalid('confirmation_hash is invalid');
  return {
    acknowledged: acknowledged(body.acknowledged),
    confirmationHash,
    previewToken: boundedString(body.preview_token, 'preview_token', 32, 512),
  };
}
