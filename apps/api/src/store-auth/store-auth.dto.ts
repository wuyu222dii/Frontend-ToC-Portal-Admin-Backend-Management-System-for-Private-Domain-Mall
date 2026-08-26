import { ApplicationError } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export interface StoreConsentInput {
  accepted: true;
  documentVersion: string;
  type: 'PRIVACY_POLICY' | 'USER_AGREEMENT';
}

export interface StoreWechatLoginInput {
  candidateToken: string | null;
  code: string;
  consents: readonly [StoreConsentInput, StoreConsentInput];
}

export interface StoreRefreshInput {
  refreshToken: string;
}

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function objectWithFields(value: unknown, required: readonly string[], optional: readonly string[] = []): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Request body must be an object');
  }
  const body = value as PlainRecord;
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !(field in body)) || Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function boundedString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || Array.from(value).length < minimum || Array.from(value).length > maximum) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function consent(value: unknown, expectedType: StoreConsentInput['type']): StoreConsentInput {
  const body = objectWithFields(value, ['type', 'document_version', 'accepted']);
  if (body.type !== expectedType || body.accepted !== true) return invalid('consents are invalid');
  return {
    accepted: true,
    documentVersion: boundedString(body.document_version, 'document_version', 1, 80),
    type: expectedType,
  };
}

export function parseStoreWechatLoginBody(value: unknown): StoreWechatLoginInput {
  const body = objectWithFields(value, ['code', 'consents'], ['candidate_token']);
  if (!Array.isArray(body.consents) || body.consents.length !== 2) return invalid('consents are invalid');
  const candidate = body.candidate_token;
  if (candidate !== undefined && candidate !== null && typeof candidate !== 'string') {
    return invalid('candidate_token is invalid');
  }
  return {
    candidateToken: candidate === undefined || candidate === null
      ? null
      : boundedString(candidate, 'candidate_token', 32, 512),
    code: boundedString(body.code, 'code', 1, 512),
    consents: [
      consent(body.consents[0], 'USER_AGREEMENT'),
      consent(body.consents[1], 'PRIVACY_POLICY'),
    ],
  };
}

export function parseStoreRefreshBody(value: unknown): StoreRefreshInput {
  const body = objectWithFields(value, ['refresh_token']);
  return { refreshToken: boundedString(body.refresh_token, 'refresh_token', 20, 512) };
}

export function parseStoreEmptyBody(value: unknown): void {
  if (value === undefined) return;
  const body = objectWithFields(value, []);
  if (Object.keys(body).length !== 0) return invalid('Request body fields are invalid');
}

export function parseStoreAuthEmptyQuery(value: unknown): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) ||
    Object.keys(value).length !== 0) {
    return invalid('Query fields are invalid');
  }
}
