import { ApplicationError } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export interface StoreProfileUpdateInput {
  avatarUrl?: string | null;
  city?: string | null;
  nickname?: string | null;
}

export interface StorePhoneConsentInput {
  accepted: true;
  documentVersion: string;
  type: 'PHONE_AUTHORIZATION';
}

export interface StorePhoneAuthorizationInput {
  consent: StorePhoneConsentInput;
  providerCredential: string;
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
  const characters = typeof value === 'string' ? Array.from(value) : [];
  if (typeof value !== 'string' || characters.length < minimum || characters.length > maximum ||
    characters.some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function nullableTrimmedString(value: unknown, field: string, maximum: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  return boundedString(value.trim(), field, 1, maximum);
}

function nullableCredentialFreeHttpsUrl(value: unknown): string | null {
  if (value === null) return null;
  const raw = boundedString(value, 'avatar_url', 1, 500);
  if (raw !== raw.trim() || !raw.startsWith('https://')) return invalid('avatar_url is invalid');
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return invalid('avatar_url is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.length === 0 || parsed.username || parsed.password) {
    return invalid('avatar_url is invalid');
  }
  return raw;
}

function phoneConsent(value: unknown): StorePhoneConsentInput {
  const body = objectWithFields(value, ['type', 'document_version', 'accepted']);
  if (body.type !== 'PHONE_AUTHORIZATION' || body.accepted !== true) {
    return invalid('consent is invalid');
  }
  return {
    accepted: true,
    documentVersion: boundedString(body.document_version, 'document_version', 1, 80),
    type: 'PHONE_AUTHORIZATION',
  };
}

export function parseStoreProfileUpdateBody(value: unknown): StoreProfileUpdateInput {
  const body = objectWithFields(value, [], ['nickname', 'avatar_url', 'city']);
  if (Object.keys(body).length === 0) return invalid('Request body must contain at least one profile field');

  const result: StoreProfileUpdateInput = {};
  if ('nickname' in body) result.nickname = nullableTrimmedString(body.nickname, 'nickname', 80);
  if ('avatar_url' in body) result.avatarUrl = nullableCredentialFreeHttpsUrl(body.avatar_url);
  if ('city' in body) result.city = nullableTrimmedString(body.city, 'city', 120);
  return result;
}

export function parseStorePhoneAuthorizationBody(value: unknown): StorePhoneAuthorizationInput {
  const body = objectWithFields(value, ['provider_credential', 'consent']);
  return {
    consent: phoneConsent(body.consent),
    providerCredential: boundedString(body.provider_credential, 'provider_credential', 1, 512),
  };
}
