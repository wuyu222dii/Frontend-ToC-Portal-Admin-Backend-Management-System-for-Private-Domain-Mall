import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { canonicalJson } from './canonical-json';

const SECRET_KEY_BYTES = 32;
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function keyBuffer(key: Uint8Array): Buffer {
  if (!(key instanceof Uint8Array) || key.byteLength !== SECRET_KEY_BYTES) {
    throw new TypeError('Authentication HMAC keys must contain exactly 32 bytes');
  }
  return Buffer.from(key);
}

function normalizeRecoveryCode(code: string): string {
  return code.replaceAll('-', '').trim().toUpperCase();
}

export function hmacAuthenticationSecret(
  value: string,
  key: Uint8Array,
  domain: 'agent-refresh-token' | 'candidate-token' | 'challenge' | 'invite-code' | 'recovery-code' | 'refresh-token' | 'store-refresh-token' | 'totp-secret',
): string {
  const minimumLength = domain === 'invite-code' ? 1 : 8;
  if (typeof value !== 'string' || value.length < minimumLength || value.length > 2_048) {
    throw new TypeError('Authentication secrets have an invalid length');
  }
  const normalized = domain === 'recovery-code' ? normalizeRecoveryCode(value) : value;
  return createHmac('sha256', keyBuffer(key))
    .update(`qingxu-auth:v1:${domain}\0`, 'utf8')
    .update(normalized, 'utf8')
    .digest('hex');
}

export function hmacAuthenticationIdentity(
  value: unknown,
  key: Uint8Array,
  domain: 'admin-login-source' | 'admin-login-subject' | 'agent-login-source' | 'agent-login-subject' | 'store-mock-code',
): string {
  return createHmac('sha256', keyBuffer(key))
    .update(`qingxu-auth:v1:${domain}\0`, 'utf8')
    .update(canonicalJson(value), 'utf8')
    .digest('hex');
}

export function authenticationSecretHashMatches(
  value: string,
  expectedHash: string,
  key: Uint8Array,
  domain: 'agent-refresh-token' | 'candidate-token' | 'challenge' | 'invite-code' | 'recovery-code' | 'refresh-token' | 'store-refresh-token' | 'totp-secret',
): boolean {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actual = Buffer.from(hmacAuthenticationSecret(value, key, domain), 'hex');
  return timingSafeEqual(actual, Buffer.from(expectedHash, 'hex'));
}

export function generateOpaqueToken(prefix: 'cnd' | 'pat' | 'rfr'): string {
  return `${prefix}_${randomBytes(32).toString('base64url')}`;
}

export function generateRecoveryCodes(count = 10): readonly string[] {
  if (!Number.isInteger(count) || count < 8 || count > 20) {
    throw new TypeError('Recovery-code count must be between 8 and 20');
  }
  return Array.from({ length: count }, () => {
    const bytes = randomBytes(20);
    const raw = Array.from(bytes, (byte) => RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length]).join('');
    return raw.match(/.{1,5}/g)?.join('-') ?? raw;
  });
}
