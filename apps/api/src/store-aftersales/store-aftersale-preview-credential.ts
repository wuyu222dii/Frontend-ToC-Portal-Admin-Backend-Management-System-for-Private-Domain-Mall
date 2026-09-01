import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import type { IdempotencyHashKeyConfig } from '@qingxu/config';
import {
  ApplicationError,
  canonicalJson,
  isValidUlid,
  sha256Hex,
} from '@qingxu/platform-core';

const DOMAIN = 'qingxu:store-aftersale-preview:v1';
const DIGEST = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const TOKEN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;
const TTL_SECONDS = 5 * 60;

interface AftersalePreviewTokenPayload {
  c: string;
  e: number;
  f: string;
  i: number;
  k: string;
  p: string;
  r: string;
  s: string;
  v: 1;
}

interface StoreAftersalePreviewCredentialBindingInput {
  customerId: string;
  request: unknown;
  sessionId: string;
}

export interface StoreAftersalePreviewCredentialInput
  extends StoreAftersalePreviewCredentialBindingInput {
  facts: unknown;
  previewIdempotencyKey: string;
}

export interface IssuedStoreAftersalePreviewCredential {
  confirmationHash: string;
  expiresAt: Date;
  issuedAt: Date;
  previewToken: string;
}

export interface AuthenticateStoreAftersalePreviewCredentialInput
  extends StoreAftersalePreviewCredentialBindingInput {
  confirmationHash: string;
  confirmIdempotencyKey: string;
  previewToken: string;
}

export interface VerifyStoreAftersalePreviewCredentialInput
  extends AuthenticateStoreAftersalePreviewCredentialInput {
  facts: unknown;
}

export interface VerifiedStoreAftersalePreviewCredential {
  expiresAt: Date;
  keyId: string;
}

export interface StoreAftersalePreviewCredentialKeyRing {
  current: IdempotencyHashKeyConfig;
  previous: readonly IdempotencyHashKeyConfig[];
}

interface StoreAftersalePreviewCredentialOptions {
  clock?: () => Date;
}

function mismatch(): ApplicationError {
  return new ApplicationError('AFTERSALE_PREVIEW_MISMATCH', 'Aftersale preview credential does not match');
}

function expired(): ApplicationError {
  return new ApplicationError('AFTERSALE_PREVIEW_EXPIRED', 'Aftersale preview credential has expired');
}

function requote(): ApplicationError {
  return new ApplicationError('AFTERSALE_REQUOTE_REQUIRED', 'Aftersale preview facts have changed');
}

type DerivationPurpose = 'confirmation' | 'preview-idempotency' | 'signature';

function derive(key: Uint8Array, purpose: DerivationPurpose): Buffer {
  return Buffer.from(hkdfSync(
    'sha256',
    Buffer.from(key),
    Buffer.alloc(0),
    Buffer.from(`${DOMAIN}\0${purpose}`, 'utf8'),
    32,
  ));
}

function signature(payload: string, key: Uint8Array): Buffer {
  return createHmac('sha256', derive(key, 'signature')).update(payload, 'ascii').digest();
}

function confirmation(payload: AftersalePreviewTokenPayload, token: string, key: Uint8Array): string {
  return createHmac('sha256', derive(key, 'confirmation'))
    .update(canonicalJson({ payload, token_hash: sha256Hex(token) }), 'utf8')
    .digest('hex');
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function bindingDigest(value: unknown): string {
  return Buffer.from(sha256Hex(canonicalJson(value)), 'hex').toString('base64url');
}

function normalizeIdempotencyKey(value: unknown, label: string): string {
  if (typeof value !== 'string' || !IDEMPOTENCY_KEY.test(value)) {
    throw new TypeError(`${label} must be an RFC 4122 UUID`);
  }
  return value.toLowerCase();
}

function idempotencyDigest(value: string, key: Uint8Array): string {
  return createHmac('sha256', derive(key, 'preview-idempotency')).update(value, 'ascii').digest('base64url');
}

function validPayload(value: unknown): value is AftersalePreviewTokenPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return false;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).sort().join(',') !== 'c,e,f,i,k,p,r,s,v') return false;
  return payload.v === 1 &&
    typeof payload.k === 'string' && KEY_ID.test(payload.k) &&
    typeof payload.c === 'string' && isValidUlid(payload.c) &&
    typeof payload.s === 'string' && isValidUlid(payload.s) &&
    typeof payload.i === 'number' && Number.isSafeInteger(payload.i) && payload.i > 0 &&
    typeof payload.e === 'number' && Number.isSafeInteger(payload.e) && payload.e > 0 &&
    payload.e - payload.i === TTL_SECONDS &&
    typeof payload.r === 'string' && DIGEST.test(payload.r) &&
    typeof payload.f === 'string' && DIGEST.test(payload.f) &&
    typeof payload.p === 'string' && DIGEST.test(payload.p);
}

function validateBindingIdentity(input: StoreAftersalePreviewCredentialBindingInput): void {
  if (!isValidUlid(input.customerId) || !isValidUlid(input.sessionId)) {
    throw new TypeError('Aftersale preview credential identifiers must be ULIDs');
  }
  canonicalJson(input.request);
}

function validateIssueInput(input: StoreAftersalePreviewCredentialInput): string {
  validateBindingIdentity(input);
  canonicalJson(input.facts);
  return normalizeIdempotencyKey(input.previewIdempotencyKey, 'Preview Idempotency-Key');
}

function normalizeKeys(ring: StoreAftersalePreviewCredentialKeyRing): readonly IdempotencyHashKeyConfig[] {
  if (!ring || typeof ring !== 'object' || !ring.current || !Array.isArray(ring.previous) ||
    ring.previous.length > 3) {
    throw new TypeError('Aftersale preview credential key ring is invalid');
  }
  const keys = [ring.current, ...ring.previous].map(({ id, key }) => {
    if (typeof id !== 'string' || !KEY_ID.test(id) || !(key instanceof Uint8Array) || key.byteLength < 32) {
      throw new TypeError('Aftersale preview credential key is invalid');
    }
    return { id, key: Buffer.from(key) };
  });
  if (new Set(keys.map(({ id }) => id)).size !== keys.length ||
    keys.some((entry, index) => keys.some((candidate, candidateIndex) =>
      index !== candidateIndex && entry.key.equals(candidate.key)))) {
    throw new TypeError('Aftersale preview credential keys must be unique');
  }
  return keys;
}

function currentDate(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Aftersale preview credential clock must return a valid Date');
  }
  return now;
}

export class StoreAftersalePreviewCredential {
  private readonly keys: readonly IdempotencyHashKeyConfig[];
  private readonly clock: () => Date;

  constructor(
    ring: StoreAftersalePreviewCredentialKeyRing,
    options: StoreAftersalePreviewCredentialOptions = {},
  ) {
    this.keys = normalizeKeys(ring);
    this.clock = options.clock ?? (() => new Date());
  }

  issue(input: StoreAftersalePreviewCredentialInput): IssuedStoreAftersalePreviewCredential {
    const previewIdempotencyKey = validateIssueInput(input);
    const current = this.keys[0]!;
    const now = currentDate(this.clock);
    const issuedAt = new Date(Math.floor(now.getTime() / 1_000) * 1_000);
    const expiresEpochSeconds = Math.floor(issuedAt.getTime() / 1_000) + TTL_SECONDS;
    const expiresAt = new Date(expiresEpochSeconds * 1_000);
    const payload: AftersalePreviewTokenPayload = {
      c: input.customerId,
      e: expiresEpochSeconds,
      f: bindingDigest(input.facts),
      i: Math.floor(issuedAt.getTime() / 1_000),
      k: current.id,
      p: idempotencyDigest(previewIdempotencyKey, current.key),
      r: bindingDigest(input.request),
      s: input.sessionId,
      v: 1,
    };
    const encodedPayload = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
    const previewToken = `${encodedPayload}.${signature(encodedPayload, current.key).toString('base64url')}`;
    if (previewToken.length > 512) throw new TypeError('Aftersale preview token exceeds the contract limit');
    return {
      confirmationHash: confirmation(payload, previewToken, current.key),
      expiresAt,
      issuedAt,
      previewToken,
    };
  }

  private authenticatePayload(input: AuthenticateStoreAftersalePreviewCredentialInput): {
    credential: VerifiedStoreAftersalePreviewCredential;
    payload: AftersalePreviewTokenPayload;
  } {
    validateBindingIdentity(input);
    const confirmIdempotencyKey = normalizeIdempotencyKey(
      input.confirmIdempotencyKey,
      'Confirm Idempotency-Key',
    );
    if (typeof input.previewToken !== 'string' || typeof input.confirmationHash !== 'string' ||
      !HASH.test(input.confirmationHash)) throw mismatch();
    const tokenMatch = TOKEN.exec(input.previewToken);
    if (!tokenMatch) throw mismatch();
    const encodedPayload = tokenMatch[1]!;
    const encodedSignature = tokenMatch[2]!;
    let parsed: unknown;
    try {
      const decoded = Buffer.from(encodedPayload, 'base64url');
      if (decoded.toString('base64url') !== encodedPayload) throw mismatch();
      parsed = JSON.parse(decoded.toString('utf8')) as unknown;
      if (canonicalJson(parsed) !== decoded.toString('utf8')) throw mismatch();
    } catch {
      throw mismatch();
    }
    if (!validPayload(parsed)) throw mismatch();
    const key = this.keys.find(({ id }) => id === parsed.k);
    if (!key) throw mismatch();
    let receivedSignature: Buffer;
    try {
      receivedSignature = Buffer.from(encodedSignature, 'base64url');
    } catch {
      throw mismatch();
    }
    if (receivedSignature.toString('base64url') !== encodedSignature ||
      !safeEqual(receivedSignature, signature(encodedPayload, key.key))) throw mismatch();
    if (parsed.c !== input.customerId || parsed.s !== input.sessionId ||
      parsed.r !== bindingDigest(input.request) ||
      !safeEqual(
        Buffer.from(input.confirmationHash, 'hex'),
        Buffer.from(confirmation(parsed, input.previewToken, key.key), 'hex'),
      ) ||
      safeEqual(
        Buffer.from(parsed.p, 'base64url'),
        Buffer.from(idempotencyDigest(confirmIdempotencyKey, key.key), 'base64url'),
      )) {
      throw mismatch();
    }
    const nowEpochSeconds = Math.floor(currentDate(this.clock).getTime() / 1_000);
    if (parsed.i > nowEpochSeconds) throw mismatch();
    if (nowEpochSeconds >= parsed.e) throw expired();
    return {
      credential: { expiresAt: new Date(parsed.e * 1_000), keyId: parsed.k },
      payload: parsed,
    };
  }

  authenticate(input: AuthenticateStoreAftersalePreviewCredentialInput): VerifiedStoreAftersalePreviewCredential {
    return this.authenticatePayload(input).credential;
  }

  verify(input: VerifyStoreAftersalePreviewCredentialInput): VerifiedStoreAftersalePreviewCredential {
    canonicalJson(input.facts);
    const authenticated = this.authenticatePayload(input);
    if (authenticated.payload.f !== bindingDigest(input.facts)) throw requote();
    return authenticated.credential;
  }
}
