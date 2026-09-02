import jwt, { type JwtPayload } from 'jsonwebtoken';

import type { RbacPrincipal } from './rbac';

export interface AuthSigningKey {
  id: string;
  key: Uint8Array;
}

export interface AuthSigningKeyRing {
  current: AuthSigningKey;
  previous: readonly AuthSigningKey[];
}

export interface AuthTokenConfiguration {
  audience: string;
  issuer: string;
  keys: AuthSigningKeyRing;
}

export interface PreAuthClaims {
  accountId: string;
  accountVersion: number;
  challengeId: string | null;
  nextAction: 'ENROLL_TOTP' | 'VERIFY_TOTP';
}

export interface VerifiedPreAuthClaims extends PreAuthClaims {
  expiresAt: Date;
  tokenId: string;
}

export interface VerifiedAccessClaims extends RbacPrincipal {
  expiresAt: Date;
  tokenId: string;
}

const KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const CLAIM_FIELDS = new Set(['account_version', 'assurance', 'aud', 'challenge_id', 'exp', 'iat',
  'iss', 'jti', 'next_action', 'permissions', 'restriction', 'role', 'sid', 'sub', 'token_use']);

function validateConfiguration(configuration: AuthTokenConfiguration): readonly AuthSigningKey[] {
  if (!/^[A-Za-z0-9._:/-]{3,120}$/.test(configuration.issuer) ||
    !/^[A-Za-z0-9._:/-]{3,120}$/.test(configuration.audience)) {
    throw new TypeError('Authentication token issuer or audience is invalid');
  }
  const keys = [configuration.keys.current, ...configuration.keys.previous];
  if (keys.length > 4 || new Set(keys.map(({ id }) => id)).size !== keys.length) {
    throw new TypeError('Authentication signing key ring is invalid');
  }
  for (const entry of keys) {
    if (!KEY_ID.test(entry.id) || !(entry.key instanceof Uint8Array) || entry.key.byteLength !== 32) {
      throw new TypeError('Authentication signing keys are invalid');
    }
  }
  return keys;
}

function signingKey(configuration: AuthTokenConfiguration, keyId: string): Buffer {
  const keys = validateConfiguration(configuration);
  const selected = keys.find(({ id }) => id === keyId);
  if (!selected) throw new TypeError('Authentication token key is not active');
  return Buffer.from(selected.key);
}

function currentKey(configuration: AuthTokenConfiguration): AuthSigningKey {
  validateConfiguration(configuration);
  return configuration.keys.current;
}

function assertLifetime(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 31 * 24 * 60 * 60) {
    throw new TypeError('Authentication token lifetime is invalid');
  }
}

export function signPreAuthToken(
  configuration: AuthTokenConfiguration,
  claims: PreAuthClaims & { tokenId: string },
  lifetimeSeconds: number,
  now: Date = new Date(),
): { expiresAt: Date; token: string } {
  assertLifetime(lifetimeSeconds);
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Authentication token clock is invalid');
  }
  if ((claims.nextAction === 'ENROLL_TOTP' && claims.challengeId !== null) ||
    (claims.nextAction === 'VERIFY_TOTP' && typeof claims.challengeId !== 'string')) {
    throw new TypeError('Pre-authentication token state is invalid');
  }
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const key = currentKey(configuration);
  const token = jwt.sign({
    account_version: claims.accountVersion,
    challenge_id: claims.challengeId,
    next_action: claims.nextAction,
    token_use: 'admin_pre_auth',
    iat: issuedAt,
  }, Buffer.from(key.key), {
    algorithm: 'HS256',
    audience: configuration.audience,
    expiresIn: lifetimeSeconds,
    issuer: configuration.issuer,
    jwtid: claims.tokenId,
    keyid: key.id,
    subject: claims.accountId,
  });
  return { token, expiresAt: new Date((issuedAt + lifetimeSeconds) * 1_000) };
}

export function signAccessToken(
  configuration: AuthTokenConfiguration,
  principal: RbacPrincipal & { tokenId: string },
  lifetimeSeconds: number,
  now: Date = new Date(),
): { expiresAt: Date; token: string } {
  assertLifetime(lifetimeSeconds);
  if (principal.role !== 'SUPER_ADMIN' || principal.assurance !== 'MFA' ||
    principal.restriction !== 'NONE') {
    throw new TypeError('Administrator access token principal is invalid');
  }
  return signScopedAccessToken(configuration, principal, lifetimeSeconds, now);
}

export function signStoreAccessToken(
  configuration: AuthTokenConfiguration,
  principal: RbacPrincipal & { tokenId: string },
  lifetimeSeconds: number,
  now: Date = new Date(),
): { expiresAt: Date; token: string } {
  assertLifetime(lifetimeSeconds);
  if (principal.role !== 'CUSTOMER' || principal.assurance !== 'WECHAT' ||
    principal.restriction !== 'NONE' || principal.permissions.length !== 0) {
    throw new TypeError('Store access token principal is invalid');
  }
  return signScopedAccessToken(configuration, principal, lifetimeSeconds, now);
}

/**
 * Signs an access token for the isolated first-level agent realm. Agent tokens
 * intentionally carry no RBAC permissions and use PASSWORD assurance for both
 * regular and temporary-password sessions.
 */
export function signAgentAccessToken(
  configuration: AuthTokenConfiguration,
  principal: RbacPrincipal & { tokenId: string },
  lifetimeSeconds: number,
  now: Date = new Date(),
): { expiresAt: Date; token: string } {
  assertLifetime(lifetimeSeconds);
  if (principal.role !== 'AGENT_ADMIN' || principal.assurance !== 'PASSWORD' ||
    (principal.restriction !== 'NONE' && principal.restriction !== 'CHANGE_PASSWORD_ONLY') ||
    principal.permissions.length !== 0) {
    throw new TypeError('Agent access token principal is invalid');
  }
  return signScopedAccessToken(configuration, principal, lifetimeSeconds, now);
}

function signScopedAccessToken(
  configuration: AuthTokenConfiguration,
  principal: RbacPrincipal & { tokenId: string },
  lifetimeSeconds: number,
  now: Date,
): { expiresAt: Date; token: string } {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Authentication token clock is invalid');
  }
  const issuedAt = Math.floor(now.getTime() / 1_000);
  const key = currentKey(configuration);
  const token = jwt.sign({
    assurance: principal.assurance,
    permissions: principal.permissions,
    restriction: principal.restriction,
    role: principal.role,
    sid: principal.sessionId,
    token_use: 'access',
    iat: issuedAt,
  }, Buffer.from(key.key), {
    algorithm: 'HS256',
    audience: configuration.audience,
    expiresIn: lifetimeSeconds,
    issuer: configuration.issuer,
    jwtid: principal.tokenId,
    keyid: key.id,
    subject: principal.accountId,
  });
  return { token, expiresAt: new Date((issuedAt + lifetimeSeconds) * 1_000) };
}

function verifyJwt(configuration: AuthTokenConfiguration, token: string): JwtPayload {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4_096) {
    throw new TypeError('Authentication token is invalid');
  }
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || decoded.header.alg !== 'HS256' || decoded.header.typ !== 'JWT' ||
    typeof decoded.header.kid !== 'string') {
    throw new TypeError('Authentication token header is invalid');
  }
  const payload = jwt.verify(token, signingKey(configuration, decoded.header.kid), {
    algorithms: ['HS256'],
    audience: configuration.audience,
    issuer: configuration.issuer,
  });
  if (typeof payload === 'string') throw new TypeError('Authentication token payload is invalid');
  if (Object.keys(payload).some((key) => !CLAIM_FIELDS.has(key))) {
    throw new TypeError('Authentication token contains unsupported claims');
  }
  return payload;
}

function baseClaims(payload: JwtPayload): { accountId: string; expiresAt: Date; tokenId: string } {
  if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string' ||
    typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp)) {
    throw new TypeError('Authentication token claims are invalid');
  }
  return { accountId: payload.sub, tokenId: payload.jti, expiresAt: new Date(payload.exp * 1_000) };
}

export function verifyPreAuthToken(
  configuration: AuthTokenConfiguration,
  token: string,
): VerifiedPreAuthClaims {
  const payload = verifyJwt(configuration, token);
  const base = baseClaims(payload);
  if (payload.token_use !== 'admin_pre_auth' ||
    (payload.next_action !== 'ENROLL_TOTP' && payload.next_action !== 'VERIFY_TOTP') ||
    !Number.isSafeInteger(payload.account_version) || Number(payload.account_version) < 1 ||
    !(payload.challenge_id === null || typeof payload.challenge_id === 'string') ||
    (payload.next_action === 'ENROLL_TOTP' && payload.challenge_id !== null) ||
    (payload.next_action === 'VERIFY_TOTP' && typeof payload.challenge_id !== 'string')) {
    throw new TypeError('Pre-authentication token claims are invalid');
  }
  return {
    ...base,
    accountVersion: Number(payload.account_version),
    challengeId: payload.challenge_id,
    nextAction: payload.next_action,
  };
}

export function verifyAccessToken(
  configuration: AuthTokenConfiguration,
  token: string,
): VerifiedAccessClaims {
  const payload = verifyJwt(configuration, token);
  const base = baseClaims(payload);
  if (payload.token_use !== 'access' || typeof payload.sid !== 'string' ||
    payload.role !== 'SUPER_ADMIN' || payload.assurance !== 'MFA' || payload.restriction !== 'NONE' ||
    !Array.isArray(payload.permissions) || payload.permissions.some((item) => typeof item !== 'string')) {
    throw new TypeError('Access token claims are invalid');
  }
  return {
    ...base,
    accountId: base.accountId,
    sessionId: payload.sid,
    role: 'SUPER_ADMIN',
    assurance: 'MFA',
    restriction: 'NONE',
    permissions: payload.permissions,
  };
}

export function verifyStoreAccessToken(
  configuration: AuthTokenConfiguration,
  token: string,
): VerifiedAccessClaims {
  const payload = verifyJwt(configuration, token);
  const base = baseClaims(payload);
  if (payload.token_use !== 'access' || typeof payload.sid !== 'string' ||
    payload.role !== 'CUSTOMER' || payload.assurance !== 'WECHAT' || payload.restriction !== 'NONE' ||
    !Array.isArray(payload.permissions) || payload.permissions.length !== 0) {
    throw new TypeError('Store access token claims are invalid');
  }
  return {
    ...base,
    accountId: base.accountId,
    sessionId: payload.sid,
    role: 'CUSTOMER',
    assurance: 'WECHAT',
    restriction: 'NONE',
    permissions: [],
  };
}

export function verifyAgentAccessToken(
  configuration: AuthTokenConfiguration,
  token: string,
): VerifiedAccessClaims {
  const payload = verifyJwt(configuration, token);
  const base = baseClaims(payload);
  if (payload.token_use !== 'access' || typeof payload.sid !== 'string' ||
    payload.role !== 'AGENT_ADMIN' || payload.assurance !== 'PASSWORD' ||
    (payload.restriction !== 'NONE' && payload.restriction !== 'CHANGE_PASSWORD_ONLY') ||
    !Array.isArray(payload.permissions) || payload.permissions.length !== 0) {
    throw new TypeError('Agent access token claims are invalid');
  }
  return {
    ...base,
    accountId: base.accountId,
    sessionId: payload.sid,
    role: 'AGENT_ADMIN',
    assurance: 'PASSWORD',
    restriction: payload.restriction,
    permissions: [],
  };
}
