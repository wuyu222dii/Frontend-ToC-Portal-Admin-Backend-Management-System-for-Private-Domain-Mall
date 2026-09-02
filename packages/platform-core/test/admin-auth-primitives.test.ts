import { randomBytes } from 'node:crypto';

import { generate } from 'otplib';
import { describe, expect, it } from 'vitest';

import {
  authenticationSecretHashMatches,
  createTotpSecret,
  generateRecoveryCodes,
  hashPassword,
  hmacAuthenticationIdentity,
  hmacAuthenticationSecret,
  signAccessToken,
  signAgentAccessToken,
  signStoreAccessToken,
  signPreAuthToken,
  verifyAccessToken,
  verifyAgentAccessToken,
  verifyStoreAccessToken,
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

  it('keeps Agent refresh and login rate-limit digests isolated from other authentication realms', () => {
    const key = Buffer.alloc(32, 23);
    const refreshToken = 'rfr_agent_test_token_material';
    const agentRefreshHash = hmacAuthenticationSecret(refreshToken, key, 'agent-refresh-token');

    expect(agentRefreshHash).not.toBe(hmacAuthenticationSecret(refreshToken, key, 'refresh-token'));
    expect(agentRefreshHash).not.toBe(hmacAuthenticationSecret(refreshToken, key, 'store-refresh-token'));
    expect(authenticationSecretHashMatches(refreshToken, agentRefreshHash, key, 'agent-refresh-token')).toBe(true);
    expect(authenticationSecretHashMatches(refreshToken, agentRefreshHash, key, 'refresh-token')).toBe(false);
    expect(hmacAuthenticationIdentity('agent@example.test', key, 'agent-login-subject'))
      .not.toBe(hmacAuthenticationIdentity('agent@example.test', key, 'admin-login-subject'));
    expect(hmacAuthenticationIdentity({ ip: '203.0.113.10' }, key, 'agent-login-source'))
      .not.toBe(hmacAuthenticationIdentity({ ip: '203.0.113.10' }, key, 'admin-login-source'));
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

  it('keeps administrator and Store access tokens isolated by audience, role and assurance', () => {
    const storeConfiguration: AuthTokenConfiguration = { ...configuration, audience: 'qingxu-store' };
    const storeAccess = signStoreAccessToken(storeConfiguration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'CUSTOMER',
      permissions: [],
      assurance: 'WECHAT',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000003',
    }, 900);
    expect(verifyStoreAccessToken(storeConfiguration, storeAccess.token)).toMatchObject({
      assurance: 'WECHAT',
      permissions: [],
      role: 'CUSTOMER',
    });
    expect(() => signAccessToken(storeConfiguration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'CUSTOMER',
      permissions: [],
      assurance: 'WECHAT',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000003',
    }, 900)).toThrow('Administrator access token principal is invalid');
    expect(() => verifyAccessToken(storeConfiguration, storeAccess.token)).toThrow();
    expect(() => verifyStoreAccessToken(configuration, storeAccess.token)).toThrow();

    const adminAccess = signAccessToken(configuration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'SUPER_ADMIN',
      permissions: [],
      assurance: 'MFA',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000004',
    }, 900);
    expect(() => verifyStoreAccessToken(configuration, adminAccess.token)).toThrow();
    expect(() => signStoreAccessToken(configuration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'SUPER_ADMIN',
      permissions: [],
      assurance: 'MFA',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000004',
    }, 900)).toThrow('Store access token principal is invalid');
  });

  it('keeps Agent access tokens isolated and supports restricted temporary sessions', () => {
    const agentConfiguration: AuthTokenConfiguration = { ...configuration, audience: 'qingxu-agent-web' };
    const agentAccess = signAgentAccessToken(agentConfiguration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'AGENT_ADMIN',
      permissions: [],
      assurance: 'PASSWORD',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000003',
    }, 900);
    expect(verifyAgentAccessToken(agentConfiguration, agentAccess.token)).toMatchObject({
      assurance: 'PASSWORD',
      role: 'AGENT_ADMIN',
      restriction: 'NONE',
      permissions: [],
    });

    const restrictedAccess = signAgentAccessToken(agentConfiguration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000004',
      role: 'AGENT_ADMIN',
      permissions: [],
      assurance: 'PASSWORD',
      restriction: 'CHANGE_PASSWORD_ONLY',
      tokenId: 'access:01J00000000000000000000005',
    }, 300);
    expect(verifyAgentAccessToken(agentConfiguration, restrictedAccess.token)).toMatchObject({
      role: 'AGENT_ADMIN',
      restriction: 'CHANGE_PASSWORD_ONLY',
    });

    expect(() => verifyAccessToken(configuration, agentAccess.token)).toThrow();
    expect(() => verifyStoreAccessToken({ ...configuration, audience: 'qingxu-store' }, agentAccess.token))
      .toThrow();
    expect(() => verifyAgentAccessToken(configuration, agentAccess.token)).toThrow();

    const adminAccess = signAccessToken(configuration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'SUPER_ADMIN',
      permissions: [],
      assurance: 'MFA',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000007',
    }, 900);
    const storeConfiguration = { ...configuration, audience: 'qingxu-store' };
    const storeAccess = signStoreAccessToken(storeConfiguration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'CUSTOMER',
      permissions: [],
      assurance: 'WECHAT',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000008',
    }, 900);
    expect(() => verifyAgentAccessToken(agentConfiguration, adminAccess.token)).toThrow();
    expect(() => verifyAgentAccessToken(agentConfiguration, storeAccess.token)).toThrow();

    expect(() => signAgentAccessToken(agentConfiguration, {
      accountId: '01J00000000000000000000000',
      sessionId: '01J00000000000000000000002',
      role: 'SUPER_ADMIN',
      permissions: [],
      assurance: 'MFA',
      restriction: 'NONE',
      tokenId: 'access:01J00000000000000000000006',
    }, 900)).toThrow('Agent access token principal is invalid');
  });
});
