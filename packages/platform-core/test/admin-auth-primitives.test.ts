import { randomBytes } from 'node:crypto';

import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';

import {
  authenticationSecretHashMatches,
  createTotpSecret,
  generateRecoveryCodes,
  hashPassword,
  hmacAuthenticationSecret,
  signAccessToken,
  signPreAuthToken,
  verifyAccessToken,
  verifyPasswordHash,
  verifyPreAuthToken,
  verifyTotpCode,
  type AuthTokenConfiguration,
} from '../src';

const configuration: AuthTokenConfiguration = {
  audience: 'qingxu-admin-test',
  issuer: 'qingxu-api-test',
  keys: {
    current: { id: 'auth-v2', key: Buffer.alloc(32, 7) },
    previous: [{ id: 'auth-v1', key: Buffer.alloc(32, 9) }],
  },
};

describe('administrator authentication primitives', () => {
  it('hashes administrator passwords with Argon2id and verifies without throwing on malformed hashes', async () => {
    const password = 'local-test-password-only';
    const passwordHash = await hashPassword(password);

    expect(passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPasswordHash(passwordHash, password)).resolves.toBe(true);
    await expect(verifyPasswordHash(passwordHash, `${password}-wrong`)).resolves.toBe(false);
    await expect(verifyPasswordHash('not-a-hash', password)).resolves.toBe(false);
  });

  it('generates unique recovery codes and verifies only their keyed digests', () => {
    const key = randomBytes(32);
    const codes = generateRecoveryCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const digest = hmacAuthenticationSecret(codes[0] as string, key, 'recovery-code');
    expect(authenticationSecretHashMatches(codes[0] as string, digest, key, 'recovery-code')).toBe(true);
    expect(authenticationSecretHashMatches(codes[1] as string, digest, key, 'recovery-code')).toBe(false);
    const totpDigest = hmacAuthenticationSecret('ABCDEFGHIJKLMNOP', key, 'totp-secret');
    expect(authenticationSecretHashMatches('ABCDEFGHIJKLMNOP', totpDigest, key, 'totp-secret')).toBe(true);
  });

  it('accepts RFC 6238 current and adjacent time steps and reports the accepted timestep', async () => {
    const secret = createTotpSecret();
    const now = new Date('2026-08-13T02:00:00.000Z');
    for (const offset of [-30_000, 0, 30_000]) {
      const token = await generate({ secret, epoch: Math.floor((now.getTime() + offset) / 1_000) });
      const result = await verifyTotpCode(secret, token, now);
      expect(result).toEqual({ valid: true, timestep: BigInt(Math.floor((now.getTime() + offset) / 30_000)) });
    }
    await expect(verifyTotpCode(secret, '000000', now)).resolves.toMatchObject({ valid: false });
  });

  it('signs narrowly scoped pre-auth and strict MFA access tokens', () => {
    const preAuth = signPreAuthToken(configuration, {
      accountId: '01J00000000000000000000000',
      accountVersion: 3,
      challengeId: null,
      nextAction: 'ENROLL_TOTP',
      tokenId: '01J00000000000000000000001',
    }, 300);
    expect(verifyPreAuthToken(configuration, preAuth.token)).toMatchObject({
      accountId: '01J00000000000000000000000',
      nextAction: 'ENROLL_TOTP',
    });

    const access = signAccessToken(configuration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'SUPER_ADMIN',
      permissions: [],
      assurance: 'MFA',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000003',
    }, 900);
    expect(verifyAccessToken(configuration, access.token)).toMatchObject({
      assurance: 'MFA',
      role: 'SUPER_ADMIN',
      restriction: 'NONE',
    });
    expect(() => signPreAuthToken(configuration, {
      accountId: '01J00000000000000000000000',
      accountVersion: 3,
      challengeId: '01J00000000000000000000001',
      nextAction: 'ENROLL_TOTP',
      tokenId: '01J00000000000000000000002',
    }, 300)).toThrow('Pre-authentication token state is invalid');
  });
});
