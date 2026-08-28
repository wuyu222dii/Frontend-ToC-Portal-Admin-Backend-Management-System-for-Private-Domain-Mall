import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

import type { IdempotencyHashKeyConfig } from '@qingxu/config';
import {
  ApplicationError,
  canonicalJson,
  isValidUlid,
  sha256Hex,
} from '@qingxu/platform-core';

const DOMAIN = 'qingxu:store-checkout-quote:v1';
const DIGEST = /^[A-Za-z0-9_-]{43}$/;
const HASH = /^[a-f0-9]{64}$/;
const KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const TOKEN = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/;
const TTL_SECONDS = 5 * 60;

interface QuoteTokenPayload {
  c: string;
  e: number;
  f: string;
  i: number;
  k: string;
  q: string;
  r: string;
  s: string;
  v: 1;
}

export interface StoreCheckoutQuoteCredentialInput {
  customerId: string;
  facts: unknown;
  quoteId: string;
  request: unknown;
  sessionId: string;
}

export interface IssuedStoreCheckoutQuoteCredential {
  confirmationHash: string;
  expiresAt: Date;
  issuedAt: Date;
  quoteToken: string;
}

export interface VerifyStoreCheckoutQuoteCredentialInput extends StoreCheckoutQuoteCredentialInput {
  confirmationHash: string;
  quoteToken: string;
}

export interface AuthenticateStoreCheckoutQuoteCredentialInput
  extends Omit<StoreCheckoutQuoteCredentialInput, 'facts'> {
  confirmationHash: string;
  quoteToken: string;
}

export interface VerifiedStoreCheckoutQuoteCredential {
  expiresAt: Date;
  keyId: string;
  quoteId: string;
}

export interface StoreCheckoutQuoteCredentialKeyRing {
  current: IdempotencyHashKeyConfig;
  previous: readonly IdempotencyHashKeyConfig[];
}

interface StoreCheckoutQuoteCredentialOptions {
  clock?: () => Date;
}

function mismatch(): ApplicationError {
  return new ApplicationError('CHECKOUT_QUOTE_MISMATCH', 'Checkout quote credential does not match');
}

function expired(): ApplicationError {
  return new ApplicationError('CHECKOUT_QUOTE_EXPIRED', 'Checkout quote credential has expired');
}

function requote(): ApplicationError {
  return new ApplicationError('CHECKOUT_REQUOTE_REQUIRED', 'Checkout quote facts have changed');
}

function derive(key: Uint8Array, purpose: 'confirmation' | 'signature'): Buffer {
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

function confirmation(payload: QuoteTokenPayload, token: string, key: Uint8Array): string {
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

function validPayload(value: unknown): value is QuoteTokenPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) return false;
  const payload = value as Record<string, unknown>;
  if (Object.keys(payload).sort().join(',') !== 'c,e,f,i,k,q,r,s,v') return false;
  return payload.v === 1 &&
    typeof payload.k === 'string' && KEY_ID.test(payload.k) &&
    typeof payload.c === 'string' && isValidUlid(payload.c) &&
    typeof payload.s === 'string' && isValidUlid(payload.s) &&
    typeof payload.q === 'string' && isValidUlid(payload.q) &&
    typeof payload.i === 'number' && Number.isSafeInteger(payload.i) && payload.i > 0 &&
    typeof payload.e === 'number' && Number.isSafeInteger(payload.e) && payload.e > 0 &&
    payload.e - payload.i === TTL_SECONDS &&
    typeof payload.r === 'string' && DIGEST.test(payload.r) &&
    typeof payload.f === 'string' && DIGEST.test(payload.f);
}

function validateAuthenticationIdentity(
  input: Pick<StoreCheckoutQuoteCredentialInput, 'customerId' | 'quoteId' | 'request' | 'sessionId'>,
): void {
  if (!isValidUlid(input.customerId) || !isValidUlid(input.sessionId) || !isValidUlid(input.quoteId)) {
    throw new TypeError('Checkout quote credential identifiers must be ULIDs');
  }
  canonicalJson(input.request);
}

function validateIdentity(input: StoreCheckoutQuoteCredentialInput): void {
  validateAuthenticationIdentity(input);
  canonicalJson(input.facts);
}

function normalizeKeys(ring: StoreCheckoutQuoteCredentialKeyRing): readonly IdempotencyHashKeyConfig[] {
  if (!ring || typeof ring !== 'object' || !ring.current || !Array.isArray(ring.previous) ||
    ring.previous.length > 3) {
    throw new TypeError('Checkout quote credential key ring is invalid');
  }
  const keys = [ring.current, ...ring.previous].map(({ id, key }) => {
    if (typeof id !== 'string' || !KEY_ID.test(id) || !(key instanceof Uint8Array) || key.byteLength < 32) {
      throw new TypeError('Checkout quote credential key is invalid');
    }
    return { id, key: Buffer.from(key) };
  });
  if (new Set(keys.map(({ id }) => id)).size !== keys.length ||
    keys.some((entry, index) => keys.some((candidate, candidateIndex) =>
      index !== candidateIndex && entry.key.equals(candidate.key)))) {
    throw new TypeError('Checkout quote credential keys must be unique');
  }
  return keys;
}

function currentDate(clock: () => Date): Date {
  const now = clock();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Checkout quote credential clock must return a valid Date');
  }
  return now;
}

export class StoreCheckoutQuoteCredential {
  private readonly keys: readonly IdempotencyHashKeyConfig[];
  private readonly clock: () => Date;

  constructor(
    ring: StoreCheckoutQuoteCredentialKeyRing,
    options: StoreCheckoutQuoteCredentialOptions = {},
  ) {
    this.keys = normalizeKeys(ring);
    this.clock = options.clock ?? (() => new Date());
  }

  issue(input: StoreCheckoutQuoteCredentialInput): IssuedStoreCheckoutQuoteCredential {
    validateIdentity(input);
    const current = this.keys[0]!;
    const now = currentDate(this.clock);
    const issuedAt = new Date(Math.floor(now.getTime() / 1_000) * 1_000);
    const expiresEpochSeconds = Math.floor(issuedAt.getTime() / 1_000) + TTL_SECONDS;
    const expiresAt = new Date(expiresEpochSeconds * 1_000);
    const payload: QuoteTokenPayload = {
      c: input.customerId,
      e: expiresEpochSeconds,
      f: bindingDigest(input.facts),
      i: Math.floor(issuedAt.getTime() / 1_000),
      k: current.id,
      q: input.quoteId,
      r: bindingDigest(input.request),
      s: input.sessionId,
      v: 1,
    };
    const encodedPayload = Buffer.from(canonicalJson(payload), 'utf8').toString('base64url');
    const quoteToken = `${encodedPayload}.${signature(encodedPayload, current.key).toString('base64url')}`;
    if (quoteToken.length > 512) throw new TypeError('Checkout quote token exceeds the contract limit');
    return {
      confirmationHash: confirmation(payload, quoteToken, current.key),
      expiresAt,
      issuedAt,
      quoteToken,
    };
  }

  private authenticatePayload(input: AuthenticateStoreCheckoutQuoteCredentialInput): {
    credential: VerifiedStoreCheckoutQuoteCredential;
    key: IdempotencyHashKeyConfig;
    payload: QuoteTokenPayload;
  } {
    if (typeof input.quoteToken !== 'string' || typeof input.confirmationHash !== 'string' ||
      !HASH.test(input.confirmationHash)) throw mismatch();
    const tokenMatch = TOKEN.exec(input.quoteToken);
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
    if (receivedSignature.toString('base64url') !== encodedSignature) throw mismatch();
    if (!safeEqual(receivedSignature, signature(encodedPayload, key.key))) throw mismatch();
    const expected: Omit<QuoteTokenPayload, 'e' | 'f' | 'i' | 'k' | 'v'> = {
      c: input.customerId,
      q: input.quoteId,
      r: bindingDigest(input.request),
      s: input.sessionId,
    };
    if (parsed.c !== expected.c || parsed.q !== expected.q ||
      parsed.r !== expected.r || parsed.s !== expected.s ||
      !safeEqual(Buffer.from(input.confirmationHash, 'hex'), Buffer.from(confirmation(parsed, input.quoteToken, key.key), 'hex'))) {
      throw mismatch();
    }
    const nowEpochSeconds = Math.floor(currentDate(this.clock).getTime() / 1_000);
    if (parsed.i > nowEpochSeconds) throw mismatch();
    if (nowEpochSeconds >= parsed.e) throw expired();
    return {
      credential: { expiresAt: new Date(parsed.e * 1_000), keyId: parsed.k, quoteId: parsed.q },
      key,
      payload: parsed,
    };
  }

  authenticate(input: AuthenticateStoreCheckoutQuoteCredentialInput): VerifiedStoreCheckoutQuoteCredential {
    validateAuthenticationIdentity(input);
    return this.authenticatePayload(input).credential;
  }

  verify(input: VerifyStoreCheckoutQuoteCredentialInput): VerifiedStoreCheckoutQuoteCredential {
    validateIdentity(input);
    const authenticated = this.authenticatePayload(input);
    if (authenticated.payload.f !== bindingDigest(input.facts)) throw requote();
    return authenticated.credential;
  }
}
