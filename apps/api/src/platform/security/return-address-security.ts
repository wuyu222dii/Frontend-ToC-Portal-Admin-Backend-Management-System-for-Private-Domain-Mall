import { timingSafeEqual } from 'node:crypto';

import type { SecurityKeyConfig, SecurityKeyRingConfig } from '@qingxu/config';
import {
  createEncryptionContext,
  decryptEnvelopeText,
  encryptEnvelope,
  type EncryptedEnvelope,
  isValidUlid,
} from '@qingxu/platform-core';

const CIPHERTEXT_MAX_BYTES = 8_192;
const KEY_BYTES = 32;
const KEY_ID_MAX_LENGTH = 80;
const PHONE_PATTERN = /^[0-9+ -]{6,30}$/;

type ReturnAddressTable = 'return_address_snapshot' | 'return_address_version';

export interface ReturnAddressSecurityMaterial {
  detailCiphertext: Uint8Array;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
  recordId: string;
}

export interface VerifiedReturnAddressSecurityMaterial {
  detail: string;
  detailMasked: string;
  phone: string;
  phoneMasked: string;
  requiresFieldKeyUpgrade: boolean;
}

function plainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function exactKeys(value: Record<string, unknown>, expectedFields: readonly string[], label: string): void {
  const expected = new Set(expectedFields);
  if (Object.keys(value).length !== expected.size ||
    Object.keys(value).some((field) => !expected.has(field))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function validateKey(key: SecurityKeyConfig, label: string): void {
  if (typeof key !== 'object' || key === null || typeof key.id !== 'string' ||
    key.id.length < 1 || key.id.length > KEY_ID_MAX_LENGTH || key.id.trim() !== key.id ||
    /\p{Cc}/u.test(key.id) || !(key.key instanceof Uint8Array) || key.key.byteLength !== KEY_BYTES) {
    throw new TypeError(`${label} is invalid`);
  }
}

function validateKeyRing(keyRing: SecurityKeyRingConfig): readonly SecurityKeyConfig[] {
  if (typeof keyRing !== 'object' || keyRing === null || !keyRing.current ||
    !Array.isArray(keyRing.previous)) {
    throw new TypeError('Field encryption key ring is invalid');
  }
  const keys = [keyRing.current, ...keyRing.previous];
  keys.forEach((key) => validateKey(key, 'Field encryption key'));
  if (new Set(keys.map(({ id }) => id)).size !== keys.length || keys.some((key, index) =>
    keys.some((candidate, candidateIndex) => index !== candidateIndex &&
      timingSafeEqual(Buffer.from(key.key), Buffer.from(candidate.key))))) {
    throw new TypeError('Field encryption key ring is invalid');
  }
  return keys;
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
  plainObject(parsed, label);
  exactKeys(parsed, ['algorithm', 'authTag', 'ciphertext', 'iv', 'keyId', 'version'], label);
  if (parsed.version !== 1 || parsed.algorithm !== 'AES-256-GCM' ||
    !['authTag', 'ciphertext', 'iv', 'keyId'].every((field) => typeof parsed[field] === 'string')) {
    throw new TypeError(`${label} is invalid`);
  }
  return parsed as unknown as EncryptedEnvelope;
}

function serializeEnvelope(envelope: EncryptedEnvelope): Buffer {
  return Buffer.from(JSON.stringify(envelope), 'utf8');
}

export function normalizeReturnAddressPhone(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Return address phone must be a string');
  const normalized = value.trim();
  if (!PHONE_PATTERN.test(normalized)) {
    throw new TypeError('Return address phone must match the contract format');
  }
  return normalized;
}

export function normalizeReturnAddressDetail(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Return address detail must be a string');
  const normalized = value.trim();
  if (Array.from(normalized).length < 1 || Array.from(normalized).length > 300 || /\p{Cc}/u.test(value)) {
    throw new TypeError('Return address detail is invalid');
  }
  return normalized;
}

export function maskReturnAddressPhone(value: string): string {
  const phone = normalizeReturnAddressPhone(value);
  return `*** ${phone.slice(-4)}`;
}

export function maskReturnAddressDetail(value: string): string {
  const detail = normalizeReturnAddressDetail(value);
  return `${Array.from(detail).slice(0, 4).join('')} ****`;
}

function createMaterial(
  table: ReturnAddressTable,
  recordId: string,
  phoneValue: string,
  detailValue: string,
  fieldKey: SecurityKeyConfig,
): ReturnAddressSecurityMaterial {
  if (!isValidUlid(recordId)) throw new TypeError('Return address record ID must be a ULID');
  validateKey(fieldKey, 'Field encryption key');
  const phone = normalizeReturnAddressPhone(phoneValue);
  const detail = normalizeReturnAddressDetail(detailValue);
  const encryptionKey = { key: fieldKey.key, keyId: fieldKey.id };
  return {
    detailCiphertext: serializeEnvelope(encryptEnvelope(
      detail,
      encryptionKey,
      createEncryptionContext(table, recordId, 'detail_ciphertext'),
    )),
    encryptionKeyId: fieldKey.id,
    phoneCiphertext: serializeEnvelope(encryptEnvelope(
      phone,
      encryptionKey,
      createEncryptionContext(table, recordId, 'phone_ciphertext'),
    )),
    phoneLast4: phone.slice(-4),
    recordId,
  };
}

function verifyMaterial(
  table: ReturnAddressTable,
  material: ReturnAddressSecurityMaterial,
  fieldKeys: SecurityKeyRingConfig,
): VerifiedReturnAddressSecurityMaterial {
  plainObject(material, 'Stored return address security material');
  exactKeys(material, [
    'detailCiphertext',
    'encryptionKeyId',
    'phoneCiphertext',
    'phoneLast4',
    'recordId',
  ], 'Stored return address security material');
  if (!isValidUlid(material.recordId) || typeof material.encryptionKeyId !== 'string' ||
    typeof material.phoneLast4 !== 'string' || Array.from(material.phoneLast4).length !== 4) {
    throw new TypeError('Stored return address security material is invalid');
  }
  const keys = validateKeyRing(fieldKeys);
  const phoneEnvelope = parseEnvelope(material.phoneCiphertext, 'Stored return address phone ciphertext');
  const detailEnvelope = parseEnvelope(material.detailCiphertext, 'Stored return address detail ciphertext');
  if (phoneEnvelope.keyId !== material.encryptionKeyId || detailEnvelope.keyId !== material.encryptionKeyId) {
    throw new TypeError('Stored return address encryption key is inconsistent');
  }
  const resolveKey = (keyId: string): Uint8Array => {
    const key = keys.find((candidate) => candidate.id === keyId);
    if (!key) throw new TypeError('Stored return address encryption key is unavailable');
    return key.key;
  };
  const phonePlaintext = decryptEnvelopeText(
    phoneEnvelope,
    resolveKey,
    createEncryptionContext(table, material.recordId, 'phone_ciphertext'),
  );
  const detailPlaintext = decryptEnvelopeText(
    detailEnvelope,
    resolveKey,
    createEncryptionContext(table, material.recordId, 'detail_ciphertext'),
  );
  const phone = normalizeReturnAddressPhone(phonePlaintext);
  const detail = normalizeReturnAddressDetail(detailPlaintext);
  if (phone !== phonePlaintext || detail !== detailPlaintext || phone.slice(-4) !== material.phoneLast4) {
    throw new TypeError('Stored return address plaintext metadata is inconsistent');
  }
  return {
    detail,
    detailMasked: maskReturnAddressDetail(detail),
    phone,
    phoneMasked: maskReturnAddressPhone(phone),
    requiresFieldKeyUpgrade: material.encryptionKeyId !== fieldKeys.current.id,
  };
}

export function createReturnAddressVersionSecurityMaterial(
  input: { detail: string; phone: string; versionId: string },
  fieldKey: SecurityKeyConfig,
): ReturnAddressSecurityMaterial {
  plainObject(input, 'Return address version security input');
  exactKeys(input, ['detail', 'phone', 'versionId'], 'Return address version security input');
  return createMaterial('return_address_version', input.versionId, input.phone, input.detail, fieldKey);
}

export function verifyReturnAddressVersionSecurityMaterial(
  material: ReturnAddressSecurityMaterial,
  fieldKeys: SecurityKeyRingConfig,
): VerifiedReturnAddressSecurityMaterial {
  return verifyMaterial('return_address_version', material, fieldKeys);
}

export function createReturnAddressSnapshotSecurityMaterial(
  input: { detail: string; phone: string; snapshotId: string },
  fieldKey: SecurityKeyConfig,
): ReturnAddressSecurityMaterial {
  plainObject(input, 'Return address snapshot security input');
  exactKeys(input, ['detail', 'phone', 'snapshotId'], 'Return address snapshot security input');
  return createMaterial('return_address_snapshot', input.snapshotId, input.phone, input.detail, fieldKey);
}

export function verifyReturnAddressSnapshotSecurityMaterial(
  material: ReturnAddressSecurityMaterial,
  fieldKeys: SecurityKeyRingConfig,
): VerifiedReturnAddressSecurityMaterial {
  return verifyMaterial('return_address_snapshot', material, fieldKeys);
}
