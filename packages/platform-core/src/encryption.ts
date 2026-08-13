import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

import { isValidUlid } from './identifiers';

const ALGORITHM = 'aes-256-gcm';
const AUTH_TAG_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface EnvelopeEncryptionKey {
  keyId: string;
  key: Uint8Array;
}

export interface EncryptedEnvelope {
  version: 1;
  algorithm: 'AES-256-GCM';
  keyId: string;
  iv: string;
  ciphertext: string;
  authTag: string;
}

export type EnvelopeKeyResolver = (keyId: string) => Uint8Array;

declare const encryptionContextBrand: unique symbol;
export type EncryptionContext = string & { readonly [encryptionContextBrand]: true };

const ENCRYPTION_CONTEXT_SEGMENT = /^[a-z][a-z0-9_]{0,62}$/;

export function createEncryptionContext(
  tableName: string,
  recordId: string,
  fieldName: string,
): EncryptionContext {
  if (!ENCRYPTION_CONTEXT_SEGMENT.test(tableName) ||
    !isValidUlid(recordId) ||
    !ENCRYPTION_CONTEXT_SEGMENT.test(fieldName)) {
    throw new TypeError('Encryption context must use table:ULID:field identifiers');
  }
  return `${tableName}:${recordId}:${fieldName}` as EncryptionContext;
}

function validateKeyId(keyId: string): void {
  const hasControlCharacter = Array.from(keyId).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (keyId.length === 0 || keyId.length > 80 || keyId.trim() !== keyId || hasControlCharacter) {
    throw new TypeError('Encryption key ID must be 1 to 80 printable characters');
  }
}

function toKeyBuffer(key: Uint8Array): Buffer {
  if (key.byteLength !== KEY_BYTES) {
    throw new TypeError('AES-256-GCM keys must contain exactly 32 bytes');
  }

  return Buffer.from(key);
}

function toBytes(value: string | Uint8Array): Buffer {
  return typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
}

function authenticatedData(keyId: string, context: EncryptionContext): Buffer {
  const header = Buffer.from(`qingxu-envelope:v1:AES-256-GCM:${keyId}\0`, 'utf8');
  if (!/^[a-z][a-z0-9_]{0,62}:[0-9A-HJKMNP-TV-Z]{26}:[a-z][a-z0-9_]{0,62}$/.test(context)) {
    throw new TypeError('Encryption context is invalid');
  }
  return Buffer.concat([header, toBytes(context)]);
}

function decodeBase64Url(value: string, field: string, expectedLength?: number): Buffer {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) {
    throw new TypeError(`${field} is not valid base64url`);
  }

  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new TypeError(`${field} is not canonical base64url`);
  }
  if (expectedLength !== undefined && decoded.byteLength !== expectedLength) {
    throw new TypeError(`${field} must contain ${expectedLength} bytes`);
  }

  return decoded;
}

export function encryptEnvelope(
  plaintext: string | Uint8Array,
  encryptionKey: EnvelopeEncryptionKey,
  context: EncryptionContext,
): EncryptedEnvelope {
  validateKeyId(encryptionKey.keyId);
  const key = toKeyBuffer(encryptionKey.key);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  cipher.setAAD(authenticatedData(encryptionKey.keyId, context));
  const ciphertext = Buffer.concat([cipher.update(toBytes(plaintext)), cipher.final()]);

  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    keyId: encryptionKey.keyId,
    iv: iv.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
    authTag: cipher.getAuthTag().toString('base64url'),
  };
}

export function decryptEnvelope(
  envelope: EncryptedEnvelope,
  resolveKey: EnvelopeKeyResolver,
  context: EncryptionContext,
): Buffer {
  if (envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
    throw new TypeError('Unsupported encrypted envelope');
  }

  validateKeyId(envelope.keyId);
  const key = toKeyBuffer(resolveKey(envelope.keyId));
  const iv = decodeBase64Url(envelope.iv, 'Envelope IV', IV_BYTES);
  const authTag = decodeBase64Url(envelope.authTag, 'Envelope authentication tag', AUTH_TAG_BYTES);
  const ciphertext = decodeBase64Url(envelope.ciphertext, 'Envelope ciphertext');
  const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_BYTES });
  decipher.setAAD(authenticatedData(envelope.keyId, context));
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export function decryptEnvelopeText(
  envelope: EncryptedEnvelope,
  resolveKey: EnvelopeKeyResolver,
  context: EncryptionContext,
): string {
  return decryptEnvelope(envelope, resolveKey, context).toString('utf8');
}

export function hmacSha256IpAddress(ipAddress: string, hmacKey: string | Uint8Array): string {
  const normalizedIp = ipAddress.trim().toLowerCase();
  if (isIP(normalizedIp) === 0) {
    throw new TypeError('IP address must be an IPv4 or IPv6 literal');
  }

  const key = toBytes(hmacKey);
  if (key.byteLength < 32) {
    throw new TypeError('IP HMAC keys must contain at least 32 bytes');
  }

  return createHmac('sha256', key).update(normalizedIp, 'utf8').digest('hex');
}

export const hashIpAddress = hmacSha256IpAddress;
