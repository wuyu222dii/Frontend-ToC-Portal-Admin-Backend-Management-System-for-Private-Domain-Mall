import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { loadPlatformConfig, type PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAuthRepository,
  runSerializableTransaction,
  type InitialAdminSessionMaterial,
  type DatabaseRuntime,
} from '@qingxu/database';
import { generateUlid, hashIpAddress, hashPassword, signAccessToken } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ApiRuntimeModule } from '../api-runtime.module';
import { AdminAuthController } from './admin-auth.controller';
import { AdminLoginRateLimiter } from './admin-login-rate-limiter';
import { AdminAuthService } from './admin-auth.service';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

const mode = process.env.B2_DATABASE_TEST_MODE;
if (mode !== undefined && mode !== 'full') {
  throw new TypeError('B2 API integration tests support only B2_DATABASE_TEST_MODE=full');
}
const integrationDescribe = mode === 'full' ? describe : describe.skip;

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new TypeError('TOTP enrollment returned an invalid Base32 secret');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

function currentTotp(secret: string, now = new Date()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fff_ffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

function expectNoStore(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionMaterial(label: string, family = generateUlid()): InitialAdminSessionMaterial {
  return {
    accessJti: `access:${generateUlid()}`,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    id: generateUlid(),
    refreshTokenHash: digest(`refresh:${label}:${randomUUID()}`),
    sessionFamily: family,
  };
}

function loopbackSourceKeys(config: PlatformRuntimeConfig): string[] {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].map((ipAddress) =>
    `qingxu:admin-login:source:${hashIpAddress(ipAddress, config.encryption.ipHashKey)}`);
}

async function clearLoopbackSourceLimits(redis: ApiRedisClient, config: PlatformRuntimeConfig): Promise<void> {
  const sources = loopbackSourceKeys(config);
  const keys = [...sources, ...sources.map((key) =>
    key.replace(':admin-login:source:', ':admin-login:inflight:source:'))];
  await redis.eval(`for _, key in ipairs(KEYS) do redis.call('DEL', key) end return #KEYS`, {
    arguments: [],
    keys,
  });
}

async function loopbackSourceFailures(redis: ApiRedisClient, config: PlatformRuntimeConfig): Promise<number> {
  const result = await redis.eval(
    `local total = 0
     for _, key in ipairs(KEYS) do total = total + tonumber(redis.call('HGET', key, 'failures') or '0') end
     return total`,
    { arguments: [], keys: loopbackSourceKeys(config) },
  );
  return Number(result);
}

integrationDescribe('B2 administrator authentication PostgreSQL API integration', () => {
  let app: INestApplication;
  let config: PlatformRuntimeConfig;
  let database: DatabaseRuntime;
  let redis: ApiRedisClient;
  let accountId: string;
  let loginName: string;
  let password: string;

  beforeAll(async () => {
    config = loadPlatformConfig(process.env, { service: 'api' });
    Reflect.defineMetadata('design:paramtypes', [Object, Object, AdminLoginRateLimiter], AdminAuthService);
    Reflect.defineMetadata('design:paramtypes', [AdminAuthService], AdminAuthController);
    const moduleRef = await Test.createTestingModule({
      imports: [ApiRuntimeModule.register(config)],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
    database = app.get(API_DATABASE_RUNTIME);
    redis = app.get(API_REDIS_CLIENT);
    await clearLoopbackSourceLimits(redis, config);

    const existing = await database.prisma.account.findFirst({
      where: { role: 'SUPER_ADMIN' },
      orderBy: { created_at: 'asc' },
    });
    accountId = existing?.id ?? generateUlid();
    loginName = `b2-api-${generateUlid()}`.slice(0, 80);
    password = `B2-${randomBytes(24).toString('base64url')}!`;
    const passwordHash = await hashPassword(password);
    if (!existing) {
      const repository = new AdminAuthRepository(database.prisma);
      await runSerializableTransaction(database.prisma, (transaction) =>
        repository.bootstrapSuperAdminInTransaction(transaction, { accountId, loginName, passwordHash }));
      return;
    }

    const now = new Date();
    await runSerializableTransaction(database.prisma, async (transaction) => {
      await transaction.authSession.updateMany({
        where: { account_id: accountId, revoked_at: null },
        data: { revoked_at: now },
      });
      await transaction.mfaChallenge.updateMany({
        where: { account_id: accountId, status: { in: ['PENDING', 'LOCKED'] } },
        data: { status: 'EXPIRED' },
      });
      await transaction.totpFactor.updateMany({
        where: { account_id: accountId, status: { in: ['PENDING', 'ACTIVE'] } },
        data: { status: 'REVOKED', revoked_at: now, updated_at: now },
      });
      await transaction.mfaRateLimit.updateMany({
        where: { account_id: accountId },
        data: { failed_attempts: 0, locked_until: null, updated_at: now, version: { increment: 1 } },
      });
      await transaction.account.update({
        where: { id: accountId },
        data: {
          deleted_at: null,
          login_name: loginName,
          must_change_password: false,
          password_hash: passwordHash,
          status: 'ACTIVE',
          updated_at: now,
          version: { increment: 1 },
        },
      });
    });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  }, 30_000);

  async function createAuthenticatedSession() {
    const factor = await database.prisma.totpFactor.findFirst({
      where: { account_id: accountId, status: 'ACTIVE' },
      orderBy: { created_at: 'desc' },
    });
    if (!factor) throw new TypeError('B2 API integration requires an active TOTP factor');
    const material = sessionMaterial('authenticated-fixture');
    const now = new Date();
    await database.prisma.authSession.create({
      data: {
        access_jti: material.accessJti,
        account_id: accountId,
        assurance: 'MFA',
        created_at: now,
        expires_at: material.expiresAt,
        id: material.id,
        mfa_factor_id: factor.id,
        mfa_verified_at: now,
        refresh_token_hash: material.refreshTokenHash,
        restriction: 'NONE',
        rotation_counter: 0,
        session_family: material.sessionFamily,
      },
    });
    const signed = signAccessToken({
      audience: config.authentication.audience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, {
      accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: material.id,
      tokenId: material.accessJti,
    }, config.authentication.accessTokenTtlSeconds);
    return { accessToken: signed.token, factor, material };
  }

  it('enrolls MFA, rotates refresh safely, and revokes a family on old-token replay', async () => {
    const keys = Array.from({ length: 5 }, () => randomUUID());
    const login = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .set('Idempotency-Key', keys[0] as string)
      .send({ login_name: loginName, password })
      .expect(200);
    expectNoStore(login);
    expect(login.body.data).toMatchObject({
      assurance: 'PASSWORD_ONLY',
      challenge_id: null,
      mfa_required: true,
      next_action: 'ENROLL_TOTP',
    });
    const preAuthToken = login.body.data.pre_auth_token as string;

    const enrollment = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/mfa/totp/enroll')
      .set('Authorization', `Bearer ${preAuthToken}`)
      .set('Idempotency-Key', keys[1] as string)
      .send({ label: 'B2 API integration' })
      .expect(200);
    expectNoStore(enrollment);
    const challengeId = enrollment.body.data.challenge_id as string;
    const enrollmentUri = new URL(enrollment.body.data.otpauth_uri as string);
    const secret = enrollmentUri.searchParams.get('secret');
    expect(secret).toBeTruthy();
    const totpCode = currentTotp(secret as string);

    const verification = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/mfa/totp/enroll/verify')
      .set('Authorization', `Bearer ${preAuthToken}`)
      .set('Idempotency-Key', keys[2] as string)
      .send({ challenge_id: challengeId, totp_code: totpCode })
      .expect(200);
    expectNoStore(verification);
    expect(verification.body.data.recovery_codes).toHaveLength(10);
    const recoveryCodes = verification.body.data.recovery_codes as string[];
    const accessToken = verification.body.data.session.access_token as string;
    const firstRefreshToken = verification.body.data.session.refresh_token as string;

    const current = await request(app.getHttpServer())
      .get('/api/v1/admin/auth/current')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(current.body.data).toMatchObject({ account_id: accountId, assurance: 'MFA', role: 'SUPER_ADMIN' });

    const refreshed = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/refresh')
      .set('Idempotency-Key', keys[3] as string)
      .send({ refresh_token: firstRefreshToken })
      .expect(200);
    expectNoStore(refreshed);
    const rotatedAccessToken = refreshed.body.data.access_token as string;

    const sameRequestReplay = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/refresh')
      .set('Idempotency-Key', keys[3] as string)
      .send({ refresh_token: firstRefreshToken })
      .expect(409);
    expectNoStore(sameRequestReplay);
    expect(sameRequestReplay.body.code).toBe('STATE_CONFLICT');
    await request(app.getHttpServer())
      .get('/api/v1/admin/auth/current')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(200);

    const oldTokenReplay = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/refresh')
      .set('Idempotency-Key', keys[4] as string)
      .send({ refresh_token: firstRefreshToken })
      .expect(401);
    expectNoStore(oldTokenReplay);
    expect(oldTokenReplay.body.code).toBe('AUTH_REQUIRED');
    await request(app.getHttpServer())
      .get('/api/v1/admin/auth/current')
      .set('Authorization', `Bearer ${rotatedAccessToken}`)
      .expect(401);

    const idempotency = await database.prisma.idempotencyRecord.findMany({
      where: { idempotency_key: { in: keys } },
    });
    expect(idempotency).toHaveLength(keys.length);
    expect(idempotency.every(({ response_body, response_body_hash }) =>
      response_body === null && /^[a-f0-9]{64}$/.test(response_body_hash ?? ''))).toBe(true);

    const audit = await database.prisma.auditLog.findMany({
      where: { actor_account_id: accountId, module: 'admin_auth', idempotency_key: { in: keys } },
    });
    expect(audit).toHaveLength(keys.length);
    expect(audit.every(({ after_json, before_json, ip_hash, reason }) =>
      after_json === null && before_json === null && reason === null && /^[a-f0-9]{64}$/.test(ip_hash ?? ''))).toBe(true);
    const persistedSecurityFacts = JSON.stringify({ audit, idempotency });
    for (const sensitiveValue of [
      password,
      preAuthToken,
      secret,
      totpCode,
      firstRefreshToken,
      refreshed.body.data.refresh_token,
      ...recoveryCodes,
    ]) {
      expect(persistedSecurityFacts).not.toContain(sensitiveValue);
    }
  }, 60_000);

  it('revokes every active family member for both refresh and logout commit orders', async () => {
    const factor = await database.prisma.totpFactor.findFirst({
      where: { account_id: accountId, status: 'ACTIVE' },
      orderBy: { created_at: 'desc' },
    });
    if (!factor) throw new TypeError('B2 API integration requires an active TOTP factor');
    const repository = new AdminAuthRepository(database.prisma);

    const rotateFirst = sessionMaterial('rotate-first');
    await database.prisma.authSession.create({
      data: {
        access_jti: rotateFirst.accessJti,
        account_id: accountId,
        assurance: 'MFA',
        created_at: new Date(),
        expires_at: rotateFirst.expiresAt,
        id: rotateFirst.id,
        mfa_factor_id: factor.id,
        mfa_verified_at: new Date(),
        refresh_token_hash: rotateFirst.refreshTokenHash,
        restriction: 'NONE',
        rotation_counter: 0,
        session_family: rotateFirst.sessionFamily,
      },
    });
    const rotateFirstChild = sessionMaterial('rotate-first-child', rotateFirst.sessionFamily);
    await expect(runSerializableTransaction(database.prisma, (transaction) =>
      repository.rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: [rotateFirst.refreshTokenHash],
        session: rotateFirstChild,
      }))).resolves.toMatchObject({ kind: 'rotated', sessionId: rotateFirstChild.id });
    await expect(runSerializableTransaction(database.prisma, (transaction) =>
      repository.revokeSessionInTransaction(transaction, {
        accountId,
        sessionFamily: rotateFirst.sessionFamily,
        sessionId: rotateFirst.id,
      }))).resolves.toEqual({ revoked: true });
    expect(await database.prisma.authSession.count({
      where: { revoked_at: null, session_family: rotateFirst.sessionFamily },
    })).toBe(0);

    const logoutFirst = sessionMaterial('logout-first');
    await database.prisma.authSession.create({
      data: {
        access_jti: logoutFirst.accessJti,
        account_id: accountId,
        assurance: 'MFA',
        created_at: new Date(),
        expires_at: logoutFirst.expiresAt,
        id: logoutFirst.id,
        mfa_factor_id: factor.id,
        mfa_verified_at: new Date(),
        refresh_token_hash: logoutFirst.refreshTokenHash,
        restriction: 'NONE',
        rotation_counter: 0,
        session_family: logoutFirst.sessionFamily,
      },
    });
    await expect(runSerializableTransaction(database.prisma, (transaction) =>
      repository.revokeSessionInTransaction(transaction, {
        accountId,
        sessionFamily: logoutFirst.sessionFamily,
        sessionId: logoutFirst.id,
      }))).resolves.toEqual({ revoked: true });
    await expect(runSerializableTransaction(database.prisma, (transaction) =>
      repository.rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: [logoutFirst.refreshTokenHash],
        session: sessionMaterial('logout-first-child', logoutFirst.sessionFamily),
      }))).resolves.toEqual({ kind: 'replay_detected', sessionFamily: logoutFirst.sessionFamily });
    expect(await database.prisma.authSession.count({
      where: { revoked_at: null, session_family: logoutFirst.sessionFamily },
    })).toBe(0);
  }, 30_000);

  it('replays known, unknown, and disabled login failures without changing their outcomes or counters', async () => {
    await clearLoopbackSourceLimits(redis, config);
    const disabledId = generateUlid();
    const disabledLogin = `disabled-${generateUlid()}`;
    const disabledPassword = `B2-${randomBytes(24).toString('base64url')}!`;
    const wrongPassword = `B2-${randomBytes(24).toString('base64url')}!`;
    await database.prisma.account.create({
      data: {
        id: disabledId,
        login_name: disabledLogin,
        password_hash: await hashPassword(disabledPassword),
        role: 'SUPER_ADMIN',
        status: 'DISABLED',
      },
    });
    const cases = [
      { loginName, password: wrongPassword },
      { loginName: `missing-replay-${generateUlid()}`, password: 'B2-invalid-password' },
      { loginName: disabledLogin, password: disabledPassword },
    ];

    const beforeConcurrent = await loopbackSourceFailures(redis, config);
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .set('Idempotency-Key', randomUUID())
      .send({ login_name: loginName, password: wrongPassword })));
    expect(concurrent.map(({ status }) => status).sort()).toEqual([401, 409, 409, 409, 409, 409]);
    expect(concurrent.filter(({ status }) => status === 409)
      .every(({ body }) => body.code === 'STATE_CONFLICT')).toBe(true);
    expect(await loopbackSourceFailures(redis, config)).toBe(beforeConcurrent + 1);

    for (const loginCase of cases) {
      const key = randomUUID();
      const before = await loopbackSourceFailures(redis, config);
      const first = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/login')
        .set('Idempotency-Key', key)
        .send({ login_name: loginCase.loginName, password: loginCase.password });
      const afterFirst = await loopbackSourceFailures(redis, config);
      const replay = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/login')
        .set('Idempotency-Key', key)
        .send({ login_name: loginCase.loginName, password: loginCase.password });
      const afterReplay = await loopbackSourceFailures(redis, config);

      expect(first.status).toBe(401);
      expect(replay.status).toBe(first.status);
      expect(replay.body.code).toBe(first.body.code);
      expect(afterFirst).toBe(before + 1);
      expect(afterReplay).toBe(afterFirst);
      expectNoStore(first);
      expectNoStore(replay);
      const record = await database.prisma.idempotencyRecord.findFirst({
        where: { actor_id: '00000000000000000000000000', idempotency_key: key },
      });
      expect(record).toMatchObject({ response_body: null, response_status: 401 });
    }
  }, 60_000);

  it('serializes logout-all against old pre-auth completion in both commit orders', async () => {
    const repository = new AdminAuthRepository(database.prisma);
    const factor = await database.prisma.totpFactor.findFirst({
      where: { account_id: accountId, status: 'ACTIVE' },
      orderBy: { created_at: 'desc' },
    });
    if (!factor) throw new TypeError('B2 API integration requires an active TOTP factor');

    for (const order of ['completion-first', 'logout-first'] as const) {
      const account = await database.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
      const source = sessionMaterial(`${order}-source`);
      const now = new Date();
      await database.prisma.authSession.create({
        data: {
          access_jti: source.accessJti,
          account_id: accountId,
          assurance: 'MFA',
          created_at: now,
          expires_at: source.expiresAt,
          id: source.id,
          mfa_factor_id: factor.id,
          mfa_verified_at: now,
          refresh_token_hash: source.refreshTokenHash,
          restriction: 'NONE',
          rotation_counter: 0,
          session_family: source.sessionFamily,
        },
      });
      const challengeId = generateUlid();
      const challengeHash = digest(`${order}-challenge-${randomUUID()}`);
      await runSerializableTransaction(database.prisma, (transaction) =>
        repository.createLoginChallengeInTransaction(transaction, {
          accountId,
          challengeId,
          challengeTokenHash: challengeHash,
          expectedAccountVersion: account.version,
          expiresAt: new Date(Date.now() + 5 * 60 * 1_000),
        }));
      const lateSession = sessionMaterial(`${order}-late`);
      const complete = () => runSerializableTransaction(database.prisma, (transaction) =>
        repository.completeLoginTotpInTransaction(transaction, {
          acceptedTimestep: (factor.last_used_timestep ?? 0n) + BigInt(order === 'completion-first' ? 10 : 20),
          accountId,
          challengeId,
          challengeTokenHashCandidates: [challengeHash],
          expectedAccountVersion: account.version,
          session: lateSession,
        }));
      const logoutAll = (expectedVersion: number) => runSerializableTransaction(database.prisma, (transaction) =>
        repository.revokeAllSessionsInTransaction(transaction, { accountId, expectedVersion }));

      if (order === 'completion-first') {
        await expect(complete()).resolves.toMatchObject({ id: lateSession.id });
        await expect(logoutAll(account.version)).resolves.toMatchObject({ version: account.version + 1 });
      } else {
        await expect(logoutAll(account.version)).resolves.toMatchObject({ version: account.version + 1 });
        await expect(complete()).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      }
      expect(await database.prisma.authSession.count({
        where: { account_id: accountId, revoked_at: null },
      })).toBe(0);
      const storedLateSession = await database.prisma.authSession.findUnique({ where: { id: lateSession.id } });
      if (order === 'completion-first') expect(storedLateSession?.revoked_at).toBeInstanceOf(Date);
      else expect(storedLateSession).toBeNull();
    }
  }, 60_000);

  it('rejects old pre-auth after password change and recovery rotation after logout', async () => {
    await clearLoopbackSourceLimits(redis, config);
    const oldPassword = password;
    const oldPreAuth = await request(app.getHttpServer())
      .post('/api/v1/admin/auth/login')
      .set('Idempotency-Key', randomUUID())
      .send({ login_name: loginName, password: oldPassword })
      .expect(200);
    expect(oldPreAuth.body.data.next_action).toBe('VERIFY_TOTP');
    const oldPreAuthToken = oldPreAuth.body.data.pre_auth_token as string;
    const oldChallengeId = oldPreAuth.body.data.challenge_id as string;
    const session = await createAuthenticatedSession();
    const nextPassword = `B2-${randomBytes(24).toString('base64url')}!`;
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ current_password: oldPassword, new_password: nextPassword })
      .expect(200);
    password = nextPassword;

    const stalePreAuth = await request(app.getHttpServer())
      .post(`/api/v1/admin/auth/mfa/challenges/${oldChallengeId}/verify`)
      .set('Authorization', `Bearer ${oldPreAuthToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({ challenge_id: oldChallengeId, totp_code: '000000' });
    expect(stalePreAuth.status).toBe(401);
    expect(stalePreAuth.body.code).toBe('AUTH_REQUIRED');
    expectNoStore(stalePreAuth);

    const logoutFixture = await createAuthenticatedSession();
    await request(app.getHttpServer())
      .post('/api/v1/admin/auth/logout')
      .set('Authorization', `Bearer ${logoutFixture.accessToken}`)
      .set('Idempotency-Key', randomUUID())
      .send({})
      .expect(200);
    const factorBefore = await database.prisma.totpFactor.findUniqueOrThrow({
      where: { id: logoutFixture.factor.id },
    });
    const persistedCodesBefore = await database.prisma.totpRecoveryCode.findMany({
      where: { factor_id: logoutFixture.factor.id },
      orderBy: { id: 'asc' },
    });
    const currentAccount = await database.prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const replacementCodes = Array.from({ length: 8 }, (_, index) => ({
      codeHash: digest(`logout-wins-recovery-${index}-${randomUUID()}`),
      id: generateUlid(),
    }));
    const repository = new AdminAuthRepository(database.prisma);
    await expect(runSerializableTransaction(database.prisma, (transaction) =>
      repository.rotateRecoveryCodesInTransaction(transaction, {
        acceptedTimestep: (factorBefore.last_used_timestep ?? 0n) + 100n,
        accountId,
        currentSessionId: logoutFixture.material.id,
        expectedAccountVersion: currentAccount.version,
        factorId: logoutFixture.factor.id,
        recoveryCodes: replacementCodes,
      }))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(await database.prisma.totpRecoveryCode.findMany({
      where: { factor_id: logoutFixture.factor.id },
      orderBy: { id: 'asc' },
    })).toEqual(persistedCodesBefore);
    expect(await database.prisma.totpFactor.findUniqueOrThrow({ where: { id: logoutFixture.factor.id } }))
      .toMatchObject({ last_used_timestep: factorBefore.last_used_timestep });
    await request(app.getHttpServer())
      .get('/api/v1/admin/auth/current')
      .set('Authorization', `Bearer ${logoutFixture.accessToken}`)
      .expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/auth/current')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .expect(200);
  }, 60_000);

  it('locks an unresolved login subject on its fifth failed attempt', async () => {
    await clearLoopbackSourceLimits(redis, config);
    const unknownLogin = `missing-${generateUlid()}`;
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/login')
        .set('Idempotency-Key', randomUUID())
        .send({ login_name: unknownLogin, password: 'B2-invalid-password' });
      const expectedStatus = attempt < 5 ? 401 : 429;
      expect(response.status).toBe(expectedStatus);
      expect(response.body.code).toBe(attempt < 5 ? 'AUTH_REQUIRED' : 'RATE_LIMITED');
      expectNoStore(response);
      if (attempt === 5) expect(response.headers['retry-after']).toBe('900');
    }
  }, 30_000);

  it('locks a source after twenty distinct unresolved logins and blocks every login name', async () => {
    await clearLoopbackSourceLimits(redis, config);
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/login')
        .set('Idempotency-Key', randomUUID())
        .send({
          login_name: `missing-${attempt}-${generateUlid()}`,
          password: 'B2-invalid-password',
        });
      expect(response.status).toBe(attempt < 20 ? 401 : 429);
      expect(response.body.code).toBe(attempt < 20 ? 'AUTH_REQUIRED' : 'RATE_LIMITED');
      expectNoStore(response);
      if (attempt === 20) expect(response.headers['retry-after']).toBe('900');
    }

    for (const blockedLogin of [loginName, `missing-after-lock-${generateUlid()}`]) {
      const response = await request(app.getHttpServer())
        .post('/api/v1/admin/auth/login')
        .set('Idempotency-Key', randomUUID())
        .send({ login_name: blockedLogin, password });
      expect(response.status).toBe(429);
      expect(response.body.code).toBe('RATE_LIMITED');
      expect(response.headers['retry-after']).toBe('900');
      expectNoStore(response);
    }
  }, 60_000);
});
