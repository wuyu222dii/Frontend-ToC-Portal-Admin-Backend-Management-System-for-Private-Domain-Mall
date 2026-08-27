import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  createEncryptionContext,
  decryptEnvelopeText,
  type EncryptedEnvelope,
} from './encryption';

const PHONE_PATTERN = /^[0-9]{11}$/;
const KEY_BYTES = 32;
const HMAC_DOMAIN = 'qingxu:store-account-phone:v1\0';
const HEX_64 = /^[a-f0-9]{64}$/;

export interface StorePhoneSecurityKey {
  id: string;
  key: Uint8Array;
}

export interface StorePhoneSecurityKeyRing {
  current: StorePhoneSecurityKey;
  previous: readonly StorePhoneSecurityKey[];
}

export interface StoredStorePhoneMaterial {
  encryptionKeyId: string;
  id: string;
  phoneCiphertext: Uint8Array;
  phoneHash: string;
  phoneLast4: string;
}

export interface VerifiedStoredStorePhone {
  currentPhoneHash: string;
  masked: string;
  requiresHashUpgrade: boolean;
}

function exactEnvelope(value: Uint8Array): EncryptedEnvelope {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > 4_096) {
    throw new TypeError('Stored account phone ciphertext is invalid');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value).toString('utf8'));
  } catch {
    throw new TypeError('Stored account phone ciphertext is invalid');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('Stored account phone ciphertext is invalid');
  }
  const record = parsed as Record<string, unknown>;
  const fields = ['algorithm', 'authTag', 'ciphertext', 'iv', 'keyId', 'version'];
  if (Object.keys(record).length !== fields.length ||
    Object.keys(record).some((field) => !fields.includes(field)) ||
    record.version !== 1 || record.algorithm !== 'AES-256-GCM' ||
    !['authTag', 'ciphertext', 'iv', 'keyId'].every((field) => typeof record[field] === 'string')) {
    throw new TypeError('Stored account phone ciphertext is invalid');
  }
  return record as unknown as EncryptedEnvelope;
}

function requireKeyRing(value: StorePhoneSecurityKeyRing, label: string): void {
  if (typeof value !== 'object' || value === null || !value.current || !Array.isArray(value.previous)) {
    throw new TypeError(`${label} key ring is invalid`);
  }
  const keys = [value.current, ...value.previous];
  if (keys.some(({ id, key }) => typeof id !== 'string' || id.length < 1 || id.length > 80 || id.trim() !== id ||
    !(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) ||
    new Set(keys.map(({ id }) => id)).size !== keys.length) {
    throw new TypeError(`${label} key ring is invalid`);
  }
}

export function normalizeStoreAccountPhone(value: string): string {
  if (typeof value !== 'string' || !PHONE_PATTERN.test(value)) {
    throw new TypeError('Store account phone must contain exactly 11 ASCII digits');
  }
  return value;
}

export function hmacStoreAccountPhone(value: string, key: Uint8Array): string {
  const normalized = normalizeStoreAccountPhone(value);
  if (!(key instanceof Uint8Array) || key.byteLength !== KEY_BYTES) {
    throw new TypeError('Store account phone HMAC keys must contain exactly 32 bytes');
  }
  return createHmac('sha256', Buffer.from(key))
    .update(HMAC_DOMAIN, 'utf8')
    .update(normalized, 'utf8')
    .digest('hex');
}

export function maskStoreAccountPhone(value: string): string {
  const normalized = normalizeStoreAccountPhone(value);
  return `${normalized.slice(0, 3)} **** ${normalized.slice(-4)}`;
}

export function verifyStoredStorePhoneMaterial(
  material: StoredStorePhoneMaterial,
  fieldKeys: StorePhoneSecurityKeyRing,
  phoneHashKeys: StorePhoneSecurityKeyRing,
): VerifiedStoredStorePhone {
  requireKeyRing(fieldKeys, 'Field encryption');
  requireKeyRing(phoneHashKeys, 'Store phone HMAC');
  if (typeof material !== 'object' || material === null ||
    typeof material.id !== 'string' ||
    typeof material.encryptionKeyId !== 'string' ||
    typeof material.phoneLast4 !== 'string' || !/^[0-9]{4}$/.test(material.phoneLast4) ||
    typeof material.phoneHash !== 'string' || !HEX_64.test(material.phoneHash)) {
    throw new TypeError('Stored account phone material is invalid');
  }
  const envelope = exactEnvelope(material.phoneCiphertext);
  if (envelope.keyId !== material.encryptionKeyId) {
    throw new TypeError('Stored account phone encryption key is inconsistent');
  }
  const plaintext = decryptEnvelopeText(envelope, (keyId) => {
    const key = [fieldKeys.current, ...fieldKeys.previous].find((candidate) => candidate.id === keyId);
    if (!key) throw new TypeError('Stored account phone encryption key is unavailable');
    return key.key;
  }, createEncryptionContext('customer_phone_verification', material.id, 'phone_ciphertext'));
  const normalized = normalizeStoreAccountPhone(plaintext);
  if (normalized.slice(-4) !== material.phoneLast4) {
    throw new TypeError('Stored account phone tail is inconsistent');
  }
  const expected = Buffer.from(material.phoneHash, 'hex');
  const hashes = [phoneHashKeys.current, ...phoneHashKeys.previous]
    .map(({ id, key }) => ({ hash: hmacStoreAccountPhone(normalized, key), id }));
  const matched = hashes.find(({ hash }) => timingSafeEqual(Buffer.from(hash, 'hex'), expected));
  if (!matched) throw new TypeError('Stored account phone HMAC is invalid');
  const currentPhoneHash = hashes[0]!.hash;
  return {
    currentPhoneHash,
    masked: maskStoreAccountPhone(normalized),
    requiresHashUpgrade: matched.id !== phoneHashKeys.current.id,
  };
}
