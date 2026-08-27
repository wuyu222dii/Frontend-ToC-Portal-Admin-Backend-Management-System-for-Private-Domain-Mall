import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  createEncryptionContext,
  decryptEnvelopeText,
  encryptEnvelope,
  type EncryptedEnvelope,
} from './encryption';
import { isValidUlid } from './identifiers';

const ADDRESS_PHONE_HMAC_DOMAIN = 'qingxu:store-address-phone:v1\0';
const CIPHERTEXT_MAX_BYTES = 8_192;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const KEY_BYTES = 32;
const KEY_ID_MAX_LENGTH = 80;
const PHONE_LAST4_PATTERN = /^[0-9]{4}$/;
const PHONE_PATTERN = /^[0-9]{11}$/;

export interface StoreAddressSecurityKey {
  id: string;
  key: Uint8Array;
}

export interface StoreAddressSecurityKeyRing {
  current: StoreAddressSecurityKey;
  previous: readonly StoreAddressSecurityKey[];
}

export interface StoreAddressSecurityMaterial {
  addressId: string;
  detailCiphertext: Uint8Array;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneHash: string;
  phoneLast4: string;
}

export interface VerifiedStoreAddressSecurityMaterial {
  currentPhoneHash: string;
  detail: string;
  detailMasked: string;
  phone: string;
  phoneMasked: string;
  requiresFieldKeyUpgrade: boolean;
  requiresPhoneHashUpgrade: boolean;
}

function requirePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function requireExactKeys(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !expected.has(key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function hasControlCharacter(value: string): boolean {
  return /\p{Cc}/u.test(value);
}

function normalizeText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length < 1 || Array.from(normalized).length > maximumLength || hasControlCharacter(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function validateKey(value: StoreAddressSecurityKey, label: string): void {
  if (typeof value !== 'object' || value === null || typeof value.id !== 'string' ||
    value.id.length < 1 || value.id.length > KEY_ID_MAX_LENGTH || value.id.trim() !== value.id ||
    hasControlCharacter(value.id) || !(value.key instanceof Uint8Array) || value.key.byteLength !== KEY_BYTES) {
    throw new TypeError(`${label} is invalid`);
  }
}

function validateKeyRing(value: StoreAddressSecurityKeyRing, label: string): readonly StoreAddressSecurityKey[] {
  if (typeof value !== 'object' || value === null || !value.current || !Array.isArray(value.previous)) {
    throw new TypeError(`${label} key ring is invalid`);
  }
  const keys = [value.current, ...value.previous];
  keys.forEach((key) => validateKey(key, label));
  if (new Set(keys.map(({ id }) => id)).size !== keys.length || keys.some((key, index) =>
    keys.some((candidate, candidateIndex) => index !== candidateIndex &&
      timingSafeEqual(Buffer.from(key.key), Buffer.from(candidate.key))))) {
    throw new TypeError(`${label} key ring is invalid`);
  }
  return keys;
}

function serializeEnvelope(envelope: EncryptedEnvelope): Buffer {
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

function parseEnvelope(value: Uint8Array, label: string): EncryptedEnvelope {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > CIPHERTEXT_MAX_BYTES) {
    throw new TypeError(`${label} is invalid`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value).toString('utf8'));
  } catch {
    throw new TypeError(`${label} is invalid`);
  }
  requirePlainObject(parsed, label);
  const fields = ['algorithm', 'authTag', 'ciphertext', 'iv', 'keyId', 'version'] as const;
  requireExactKeys(parsed, fields, label);
  if (parsed.version !== 1 || parsed.algorithm !== 'AES-256-GCM' ||
    !['authTag', 'ciphertext', 'iv', 'keyId'].every((field) => typeof parsed[field] === 'string')) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed as unknown as EncryptedEnvelope;
}

export function normalizeStoreAddressPhone(value: string): string {
  if (typeof value !== 'string' || !PHONE_PATTERN.test(value)) {
    throw new TypeError('Store address phone must contain exactly 11 ASCII digits');
  }
  return value;
}

export function normalizeStoreAddressDetail(value: string): string {
  return normalizeText(value, 'Store address detail', 300);
}

export function normalizeStoreAddressRecipient(value: string): string {
  return normalizeText(value, 'Store address recipient', 80);
}

export function hmacStoreAddressPhone(value: string, key: Uint8Array): string {
  const phone = normalizeStoreAddressPhone(value);
  if (!(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) {
    throw new TypeError('Store address phone HMAC keys must contain exactly 32 bytes');
  }
  return createHmac('sha256', Buffer.from(key))
    .update(ADDRESS_PHONE_HMAC_DOMAIN, 'utf8')
    .update(phone, 'utf8')
    .digest('hex');
}

export function maskStoreAddressPhone(value: string): string {
  const phone = normalizeStoreAddressPhone(value);
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`;
}

export function maskStoreAddressRecipient(value: string): string {
  const recipient = normalizeStoreAddressRecipient(value);
  const characters = Array.from(recipient);
  return `${characters[0]}${'*'.repeat(Math.max(1, characters.length - 1))}`;
}

export function maskStoreAddressDetail(value: string): string {
  const detail = normalizeStoreAddressDetail(value);
  const firstSegment = detail.split(/\s/u, 1)[0]!;
  return `${Array.from(firstSegment).slice(0, 4).join('')} ****`;
}

export function createStoreAddressSecurityMaterial(
  input: { addressId: string; detail: string; phone: string },
  fieldKey: StoreAddressSecurityKey,
  phoneHashKey: StoreAddressSecurityKey,
): StoreAddressSecurityMaterial {
  requirePlainObject(input, 'Store address security input');
  requireExactKeys(input, ['addressId', 'detail', 'phone'], 'Store address security input');
  if (!isValidUlid(input.addressId)) throw new TypeError('Store address ID must be a ULID');
  validateKey(fieldKey, 'Field encryption key');
  validateKey(phoneHashKey, 'Store address phone HMAC key');
  const phone = normalizeStoreAddressPhone(input.phone);
  const detail = normalizeStoreAddressDetail(input.detail);
  const envelopeKey = { key: fieldKey.key, keyId: fieldKey.id };
  const phoneEnvelope = encryptEnvelope(phone, envelopeKey,
    createEncryptionContext('customer_address', input.addressId, 'phone_ciphertext'));
  const detailEnvelope = encryptEnvelope(detail, envelopeKey,
    createEncryptionContext('customer_address', input.addressId, 'detail_ciphertext'));
  return {
    addressId: input.addressId,
    detailCiphertext: serializeEnvelope(detailEnvelope),
    encryptionKeyId: fieldKey.id,
    phoneCiphertext: serializeEnvelope(phoneEnvelope),
    phoneHash: hmacStoreAddressPhone(phone, phoneHashKey.key),
    phoneLast4: phone.slice(-4),
  };
}

export function verifyStoreAddressSecurityMaterial(
  material: StoreAddressSecurityMaterial,
  fieldKeys: StoreAddressSecurityKeyRing,
  phoneHashKeys: StoreAddressSecurityKeyRing,
): VerifiedStoreAddressSecurityMaterial {
  requirePlainObject(material, 'Stored address security material');
  requireExactKeys(material, [
    'addressId',
    'detailCiphertext',
    'encryptionKeyId',
    'phoneCiphertext',
    'phoneHash',
    'phoneLast4',
  ], 'Stored address security material');
  if (!isValidUlid(material.addressId) || typeof material.encryptionKeyId !== 'string' ||
    typeof material.phoneHash !== 'string' || !HASH_PATTERN.test(material.phoneHash) ||
    typeof material.phoneLast4 !== 'string' || !PHONE_LAST4_PATTERN.test(material.phoneLast4)) {
    throw new TypeError('Stored address security material is invalid');
  }
  const availableFieldKeys = validateKeyRing(fieldKeys, 'Field encryption');
  const availablePhoneHashKeys = validateKeyRing(phoneHashKeys, 'Store address phone HMAC');
  const phoneEnvelope = parseEnvelope(material.phoneCiphertext, 'Stored address phone ciphertext');
  const detailEnvelope = parseEnvelope(material.detailCiphertext, 'Stored address detail ciphertext');
  if (phoneEnvelope.keyId !== material.encryptionKeyId || detailEnvelope.keyId !== material.encryptionKeyId) {
    throw new TypeError('Stored address encryption key is inconsistent');
  }
  const resolveFieldKey = (keyId: string): Uint8Array => {
    const key = availableFieldKeys.find((candidate) => candidate.id === keyId);
    if (!key) throw new TypeError('Stored address encryption key is unavailable');
    return key.key;
  };
  const phonePlaintext = decryptEnvelopeText(
    phoneEnvelope,
    resolveFieldKey,
    createEncryptionContext('customer_address', material.addressId, 'phone_ciphertext'),
  );
  const detailPlaintext = decryptEnvelopeText(
    detailEnvelope,
    resolveFieldKey,
    createEncryptionContext('customer_address', material.addressId, 'detail_ciphertext'),
  );
  const phone = normalizeStoreAddressPhone(phonePlaintext);
  const detail = normalizeStoreAddressDetail(detailPlaintext);
  if (phone !== phonePlaintext || detail !== detailPlaintext || phone.slice(-4) !== material.phoneLast4) {
    throw new TypeError('Stored address plaintext metadata is inconsistent');
  }
  const storedHash = Buffer.from(material.phoneHash, 'hex');
  const candidates = availablePhoneHashKeys.map(({ id, key }) => ({
    hash: hmacStoreAddressPhone(phone, key),
    id,
  }));
  const matched = candidates.find(({ hash }) => timingSafeEqual(Buffer.from(hash, 'hex'), storedHash));
  if (!matched) throw new TypeError('Stored address phone HMAC is invalid');
  return {
    currentPhoneHash: candidates[0]!.hash,
    detail,
    detailMasked: maskStoreAddressDetail(detail),
    phone,
    phoneMasked: maskStoreAddressPhone(phone),
    requiresFieldKeyUpgrade: material.encryptionKeyId !== fieldKeys.current.id,
    requiresPhoneHashUpgrade: matched.id !== phoneHashKeys.current.id,
  };
}
