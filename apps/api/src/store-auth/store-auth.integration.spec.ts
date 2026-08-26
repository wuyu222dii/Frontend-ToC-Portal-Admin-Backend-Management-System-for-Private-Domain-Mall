import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  StoreAuthRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StoreWechatLoginInput } from './store-auth.dto';
import { StoreAuthService } from './store-auth.service';
import { StoreIdentityProvider } from './store-identity-provider';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B7_STORE_AUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B7_STORE_AUTH_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const rollbackOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const rollbackSentinel = Object.freeze({ code: 'B7_STORE_AUTH_API_ROLLBACK_SENTINEL' });

interface RollbackFixture {
  accountId: string;
  idempotencyKeys: string[];
  openId: string;
  requestIds: string[];
  sessionIds: string[];
}

interface FullCleanupConnection {
  database: string;
  host: string;
  password: string;
  port: string;
  username: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B7 Store auth API integration tests`);
  return value;
}

function integrationConfig(): PlatformRuntimeConfig {
  return {
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-b7-integration',
      issuer: 'qingxu-api-b7-integration',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: {
        current: { id: 'b7-auth-secret-v2', key: Buffer.alloc(32, 5) },
        previous: [{ id: 'b7-auth-secret-v1', key: Buffer.alloc(32, 6) }],
      },
      sessionTtlSeconds: 604_800,
      signingKeys: {
        current: { id: 'b7-auth-sign-v1', key: Buffer.alloc(32, 7) },
        previous: [],
      },
    },
    encryption: {
      fieldKeys: { current: { id: 'b7-field-v1', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: {
        current: { id: 'b7-idempotency-v1', key: Buffer.alloc(32, 2) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    store: {
      authTokenAudience: 'qingxu-store',
      identityProvider: 'MOCK',
      legalDocuments: {
        phoneAuthorization: {
          title: 'B7 Integration Phone Authorization',
          url: 'https://example.invalid/legal/phone-authorization',
          version: 'b7-integration-phone-v1',
        },
        privacyPolicy: {
          title: 'B7 Integration Privacy Policy',
          url: 'https://example.invalid/legal/privacy-policy',
          version: 'b7-integration-privacy-v1',
        },
        userAgreement: {
          title: 'B7 Integration User Agreement',
          url: 'https://example.invalid/legal/user-agreement',
          version: 'b7-integration-user-v1',
        },
      },
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
      phoneProvider: 'MOCK',
      wechatAppId: 'qingxu-b7-integration-app',
      wechatAppSecret: undefined,
    },
  } as unknown as PlatformRuntimeConfig;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B7 Store auth API tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B7 Store auth API DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B7 Store auth API tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b7-store-auth-api-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B7 Store auth API tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b7-store-auth-api-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function cleanupConnectionForFull(): FullCleanupConnection {
  const directUrl = new URL(requiredEnvironment('DIRECT_URL'));
  const runtimeUrl = new URL(requiredEnvironment('DATABASE_URL'));
  let username: string;
  let databaseName: string;
  let password: string;
  try {
    username = decodeURIComponent(directUrl.username);
    databaseName = decodeURIComponent(directUrl.pathname.slice(1));
    password = decodeURIComponent(directUrl.password);
  } catch {
    throw new TypeError('B7 Store auth API DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) || !LOOPBACK_HOSTS.has(directUrl.hostname) ||
    username !== 'mall_migrator' || !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B7 Store auth cleanup requires a query-free loopback mall_migrator test DB');
  }
  return {
    database: databaseName,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function cleanupFullFixture(connection: FullCleanupConnection, openId: string, idempotencyKey: string): void {
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_open_id=${openId}`,
    '-v', `fixture_idempotency_key=${idempotencyKey}`,
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGDATABASE: connection.database,
      PGHOST: connection.host,
      PGPASSWORD: connection.password,
      PGPORT: connection.port,
      PGSSLMODE: 'disable',
      PGUSER: connection.username,
    },
    input: `
BEGIN;
DELETE FROM public.audit_log WHERE idempotency_key = :'fixture_idempotency_key';
DELETE FROM public.idempotency_record WHERE idempotency_key = :'fixture_idempotency_key';
DELETE FROM public.auth_session
  WHERE account_id IN (SELECT id FROM public.account WHERE wechat_open_id = :'fixture_open_id');
DELETE FROM public.consent_record
  WHERE account_id IN (SELECT id FROM public.account WHERE wechat_open_id = :'fixture_open_id');
DELETE FROM public.customer_profile
  WHERE account_id IN (SELECT id FROM public.account WHERE wechat_open_id = :'fixture_open_id');
DELETE FROM public.account WHERE wechat_open_id = :'fixture_open_id';
COMMIT;
`,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '')
      .replaceAll(connection.password, '[redacted]')
      .replaceAll(openId, '[redacted]')
      .replaceAll(idempotencyKey, '[redacted]')
      .trim()
      .split('\n')
      .slice(-3)
      .join(' ');
    throw new TypeError(`Full B7 Store auth fixture cleanup failed${detail ? `: ${detail}` : ''}`);
  }
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function loginInput(config: PlatformRuntimeConfig, code: string): StoreWechatLoginInput {
  return {
    candidateToken: null,
    code,
    consents: [
      {
        accepted: true,
        documentVersion: config.store.legalDocuments.userAgreement.version,
        type: 'USER_AGREEMENT',
      },
      {
        accepted: true,
        documentVersion: config.store.legalDocuments.privacyPolicy.version,
        type: 'PRIVACY_POLICY',
      },
    ],
  };
}

function transactionBoundRuntime(
  runtime: DatabaseRuntime,
  transaction: DatabaseTransaction,
): DatabaseRuntime {
  const prisma = new Proxy(transaction as unknown as DatabaseRuntime['prisma'], {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...runtime, prisma };
}

function persistedText(value: unknown): string {
  return JSON.stringify(value, (_key, field) => typeof field === 'bigint' ? field.toString() : field);
}

integrationDescribe('B7.1 Store authentication service and PostgreSQL integration', () => {
  let config: PlatformRuntimeConfig;
  let cleanupConnection: FullCleanupConnection | undefined;
  let identityProvider: StoreIdentityProvider;
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    config = integrationConfig();
    runtime = runtimeForMode();
    await runtime.connect();
    if (mode === 'full') cleanupConnection = cleanupConnectionForFull();
    identityProvider = new StoreIdentityProvider(config);
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function assertNoFixtureFacts(fixture: RollbackFixture): Promise<void> {
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { id: fixture.accountId } }),
      runtime.prisma.account.count({ where: { wechat_open_id: fixture.openId } }),
      runtime.prisma.customerProfile.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.consentRecord.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.authSession.count({ where: { id: { in: fixture.sessionIds } } }),
      runtime.prisma.idempotencyRecord.count({
        where: { idempotency_key: { in: fixture.idempotencyKeys } },
      }),
      runtime.prisma.auditLog.count({ where: { request_id: { in: fixture.requestIds } } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0]);
  }

  it('keeps login, rotation, replay revocation, logout, audit and HASH_ONLY facts atomic and leaves no residue',
    async () => {
      const code = `mock:b7-api-${randomUUID()}`;
      const input = loginInput(config, code);
      const identity = await identityProvider.exchange(code);
      const keys: [string, string, string, string, string] = [
        randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(),
      ];
      const requestIds: [string, string, string, string, string] = [
        requestId(), requestId(), requestId(), requestId(), requestId(),
      ];
      let fixture: RollbackFixture | undefined;

      await expect(runtime.withPrismaTransaction(async (transaction) => {
        const boundRuntime = transactionBoundRuntime(runtime, transaction);
        const service = new StoreAuthService(config, boundRuntime, identityProvider);
        const repository = new StoreAuthRepository(boundRuntime.prisma);

        const login = await service.login(input, keys[0] as string, requestIds[0] as string, '127.0.0.1');
        expect(login).toMatchObject({
          candidate: null,
          confirmation_required: false,
          session: { assurance: 'WECHAT', role: 'CUSTOMER' },
        });
        const account = await transaction.account.findUniqueOrThrow({
          where: { wechat_open_id: identity.openId },
          include: { customer_profile: true },
        });
        expect(account).toMatchObject({
          role: 'CUSTOMER',
          status: 'ACTIVE',
          customer_profile: { anonymized_at: null },
        });
        const initialSession = await transaction.authSession.findFirstOrThrow({
          where: { account_id: account.id, revoked_at: null },
          orderBy: { created_at: 'desc' },
        });
        const initialIdempotency = await transaction.idempotencyRecord.findFirstOrThrow({
          where: { idempotency_key: keys[0] },
        });
        const initialAudit = await transaction.auditLog.findFirstOrThrow({
          where: { idempotency_key: keys[0] },
        });
        expect(initialIdempotency).toMatchObject({
          resource_id: initialSession.id,
          response_body: null,
          response_status: 200,
        });
        expect(initialIdempotency.response_body_hash).toMatch(/^[a-f0-9]{64}$/);
        expect(initialAudit).toMatchObject({
          action: 'LOGIN',
          actor_account_id: account.id,
          actor_role: 'CUSTOMER',
          after_json: null,
          before_json: null,
          object_id: initialSession.id,
          result: 'SUCCESS',
        });
        await expect(service.login(input, keys[0] as string, requestId(), '127.0.0.1'))
          .rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });
        await expect(Promise.all([
          transaction.authSession.count({ where: { account_id: account.id } }),
          transaction.idempotencyRecord.count({ where: { idempotency_key: keys[0] } }),
          transaction.auditLog.count({ where: { idempotency_key: keys[0] } }),
        ])).resolves.toEqual([1, 1, 1]);

        const refreshed = await service.refresh(
          { refreshToken: login.session.refresh_token },
          keys[1] as string,
          requestIds[1] as string,
          '127.0.0.1',
        );
        expect(refreshed).toMatchObject({ assurance: 'WECHAT', role: 'CUSTOMER' });
        expect(refreshed.refresh_token).not.toBe(login.session.refresh_token);
        const rotatedSession = await transaction.authSession.findFirstOrThrow({
          where: { account_id: account.id, revoked_at: null },
        });
        expect(rotatedSession).toMatchObject({
          rotation_counter: 1,
          session_family: initialSession.session_family,
        });
        expect(await transaction.authSession.findUniqueOrThrow({ where: { id: initialSession.id } }))
          .toMatchObject({ revoked_at: expect.any(Date) });
        await expect(Promise.all([
          transaction.authSession.count({ where: { id: rotatedSession.id } }),
          transaction.idempotencyRecord.count({ where: { idempotency_key: keys[1] } }),
          transaction.auditLog.count({ where: { idempotency_key: keys[1], object_id: rotatedSession.id } }),
        ])).resolves.toEqual([1, 1, 1]);

        await expect(service.refresh(
          { refreshToken: login.session.refresh_token },
          keys[1] as string,
          requestId(),
          '127.0.0.1',
        )).rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });
        expect(await transaction.authSession.count({
          where: { session_family: initialSession.session_family, revoked_at: null },
        })).toBe(1);

        await expect(service.refresh(
          { refreshToken: login.session.refresh_token },
          keys[2] as string,
          requestIds[2] as string,
          '127.0.0.1',
        )).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });
        expect(await transaction.authSession.count({
          where: { session_family: initialSession.session_family, revoked_at: null },
        })).toBe(0);
        const replayIdempotency = await transaction.idempotencyRecord.findFirstOrThrow({
          where: { idempotency_key: keys[2] },
        });
        expect(replayIdempotency).toMatchObject({ response_body: null, response_status: 401 });
        expect(await transaction.auditLog.count({
          where: {
            action: 'REFRESH',
            idempotency_key: keys[2],
            result: 'FAILURE',
            result_code: 'AUTH_REQUIRED',
          },
        })).toBe(1);

        const relogin = await service.login(input, keys[3] as string, requestIds[3] as string, '127.0.0.1');
        const logoutSessionRow = await transaction.authSession.findFirstOrThrow({
          where: { account_id: account.id, revoked_at: null },
          orderBy: { created_at: 'desc' },
        });
        const current = await repository.getCurrentSession({
          accessJti: logoutSessionRow.access_jti,
          sessionId: logoutSessionRow.id,
        });
        expect(current).not.toBeNull();
        await expect(service.logout(
          current as NonNullable<typeof current>,
          keys[4] as string,
          requestIds[4] as string,
          '127.0.0.1',
        )).resolves.toMatchObject({
          resource_id: logoutSessionRow.id,
          resource_type: 'session',
          status: 'REVOKED',
        });
        expect(await transaction.authSession.count({
          where: { session_family: logoutSessionRow.session_family, revoked_at: null },
        })).toBe(0);
        await expect(Promise.all([
          transaction.authSession.count({ where: { id: logoutSessionRow.id } }),
          transaction.idempotencyRecord.count({ where: { idempotency_key: keys[4] } }),
          transaction.auditLog.count({
            where: { idempotency_key: keys[4], action: 'LOGOUT', object_id: logoutSessionRow.id },
          }),
        ])).resolves.toEqual([1, 1, 1]);

        const idempotency = await transaction.idempotencyRecord.findMany({
          where: { idempotency_key: { in: keys } },
          orderBy: { created_at: 'asc' },
        });
        const audits = await transaction.auditLog.findMany({
          where: { idempotency_key: { in: keys } },
          orderBy: { occurred_at: 'asc' },
        });
        const consents = await transaction.consentRecord.findMany({
          where: { account_id: account.id },
          orderBy: { created_at: 'asc' },
        });
        const sessions = await transaction.authSession.findMany({
          where: { account_id: account.id },
          orderBy: { created_at: 'asc' },
        });
        expect(idempotency).toHaveLength(5);
        expect(audits).toHaveLength(5);
        expect(idempotency.every(({ request_hash, response_body, response_body_hash }) =>
          /^[a-f0-9]{64}$/.test(request_hash) && response_body === null &&
          response_body_hash !== null && /^[a-f0-9]{64}$/.test(response_body_hash))).toBe(true);
        expect(audits.every(({ before_json, after_json, ip_hash }) =>
          before_json === null && after_json === null && ip_hash !== null && /^[a-f0-9]{64}$/.test(ip_hash)))
          .toBe(true);
        const persisted = persistedText({ account, audits, consents, idempotency, sessions });
        for (const secret of [
          code,
          login.session.access_token,
          login.session.refresh_token,
          refreshed.access_token,
          refreshed.refresh_token,
          relogin.session.access_token,
          relogin.session.refresh_token,
        ]) {
          expect(persisted).not.toContain(secret);
        }
        expect(consents).toHaveLength(4);
        const sessionIds = sessions.map(({ id }) => id);
        expect(sessionIds).toHaveLength(3);
        expect(await transaction.authSession.count({
          where: { account_id: account.id, revoked_at: null },
        })).toBe(0);
        fixture = {
          accountId: account.id,
          idempotencyKeys: keys,
          openId: identity.openId,
          requestIds,
          sessionIds,
        };
        throw rollbackSentinel;
      }, rollbackOptions)).rejects.toBe(rollbackSentinel);

      if (!fixture) throw new TypeError('Rollback-only B7 Store auth API fixture was not created');
      await assertNoFixtureFacts(fixture);
    }, 120_000);

  fullIt('rolls back identity, consent and session writes when audit validation fails', async () => {
    const code = `mock:b7-api-audit-failure-${randomUUID()}`;
    const input = loginInput(config, code);
    const identity = await identityProvider.exchange(code);
    const key = randomUUID();
    const service = new StoreAuthService(config, runtime, identityProvider);

    await expect(service.login(input, key, 'invalid-request-id', '127.0.0.1'))
      .rejects.toThrow('Audit request ID must use the approved safe format');
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { wechat_open_id: identity.openId } }),
      runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: key } }),
      runtime.prisma.auditLog.count({ where: { idempotency_key: key } }),
    ])).resolves.toEqual([0, 0, 0]);
  }, 120_000);

  fullIt('serializes concurrent login with one idempotency key into at most one fact set', async () => {
    const code = `mock:b7-api-concurrent-${randomUUID()}`;
    const input = loginInput(config, code);
    const identity = await identityProvider.exchange(code);
    const key = randomUUID();
    const service = new StoreAuthService(config, runtime, identityProvider);
    const fixtureCleanup = cleanupConnection;
    if (!fixtureCleanup) throw new TypeError('Full B7 Store auth cleanup runtime is unavailable');

    try {
      const outcomes = await Promise.allSettled([
        service.login(input, key, requestId(), '127.0.0.1'),
        service.login(input, key, requestId(), '127.0.0.1'),
      ]);
      const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
      const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]).toMatchObject({
        reason: { code: 'STATE_CONFLICT', httpStatus: 409 },
      });
      const account = await runtime.prisma.account.findUniqueOrThrow({
        where: { wechat_open_id: identity.openId },
      });
      await expect(Promise.all([
        runtime.prisma.account.count({ where: { wechat_open_id: identity.openId } }),
        runtime.prisma.customerProfile.count({ where: { account_id: account.id } }),
        runtime.prisma.consentRecord.count({ where: { account_id: account.id } }),
        runtime.prisma.authSession.count({ where: { account_id: account.id } }),
        runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: key } }),
        runtime.prisma.auditLog.count({ where: { idempotency_key: key } }),
      ])).resolves.toEqual([1, 1, 2, 1, 1, 1]);
      const record = await runtime.prisma.idempotencyRecord.findFirstOrThrow({
        where: { idempotency_key: key },
      });
      expect(record).toMatchObject({ response_body: null, response_status: 200 });
    } finally {
      cleanupFullFixture(fixtureCleanup, identity.openId, key);
    }

    await expect(Promise.all([
      runtime.prisma.account.count({ where: { wechat_open_id: identity.openId } }),
      runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: key } }),
      runtime.prisma.auditLog.count({ where: { idempotency_key: key } }),
    ])).resolves.toEqual([0, 0, 0]);
  }, 120_000);
});
