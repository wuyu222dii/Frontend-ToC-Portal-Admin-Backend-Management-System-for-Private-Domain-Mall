import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import { generateUlid, sha256Hex } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StorePhoneProvider } from './store-phone-provider';
import { StoreProfileService } from './store-profile.service';

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
const rollbackSentinel = Object.freeze({ code: 'B7_STORE_PROFILE_ROLLBACK_SENTINEL' });

interface CustomerFixture {
  accountId: string;
  customerId: string;
  openId: string;
  session: CurrentStoreSession;
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
  if (!value) throw new TypeError(`${name} is required for B7 Store profile integration tests`);
  return value;
}

function integrationConfig(): PlatformRuntimeConfig {
  return {
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-b72-integration',
      issuer: 'qingxu-api-b72-integration',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: {
        current: { id: 'b72-auth-secret-v1', key: Buffer.alloc(32, 5) },
        previous: [],
      },
      sessionTtlSeconds: 604_800,
      signingKeys: {
        current: { id: 'b72-auth-sign-v1', key: Buffer.alloc(32, 6) },
        previous: [],
      },
    },
    encryption: {
      fieldKeys: {
        current: { id: 'b72-field-v2', key: Buffer.alloc(32, 1) },
        previous: [{ id: 'b72-field-v1', key: Buffer.alloc(32, 2) }],
      },
      idempotencyHashKeys: {
        current: { id: 'b72-idempotency-v1', key: Buffer.alloc(32, 3) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 4),
    },
    environment: 'test',
    store: {
      authTokenAudience: 'qingxu-store',
      identityProvider: 'MOCK',
      legalDocuments: {
        phoneAuthorization: {
          title: 'B7.2 Integration Phone Authorization',
          url: 'https://example.invalid/legal/phone-authorization',
          version: 'b72-integration-phone-v1',
        },
        privacyPolicy: {
          title: 'B7.2 Integration Privacy Policy',
          url: 'https://example.invalid/legal/privacy-policy',
          version: 'b72-integration-privacy-v1',
        },
        userAgreement: {
          title: 'B7.2 Integration User Agreement',
          url: 'https://example.invalid/legal/user-agreement',
          version: 'b72-integration-user-v1',
        },
      },
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
      customerRateLimitMax: 120,
      customerRateLimitWindowSeconds: 60,
      phoneHashKeys: {
        current: { id: 'b72-phone-hash-v2', key: Buffer.alloc(32, 7) },
        previous: [{ id: 'b72-phone-hash-v1', key: Buffer.alloc(32, 8) }],
      },
      phoneProvider: 'MOCK',
      wechatAppId: 'qingxu-b72-integration-app',
      wechatAppSecret: undefined,
    },
  } as unknown as PlatformRuntimeConfig;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B7 Store profile tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B7 Store profile DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B7 Store profile tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b72-store-profile-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B7 Store profile tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b72-store-profile-rollback',
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
    throw new TypeError('B7 Store profile DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) || !LOOPBACK_HOSTS.has(directUrl.hostname) ||
    username !== 'mall_migrator' || !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B7 Store profile cleanup requires a query-free loopback mall_migrator test DB');
  }
  return {
    database: databaseName,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function cleanupFullFixture(connection: FullCleanupConnection, accountId: string): void {
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_account_id=${accountId}`,
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
DELETE FROM public.audit_log WHERE actor_account_id = :'fixture_account_id';
DELETE FROM public.idempotency_record WHERE actor_id = :'fixture_account_id';
DELETE FROM public.customer_phone_verification
  WHERE customer_id IN (SELECT id FROM public.customer_profile WHERE account_id = :'fixture_account_id');
DELETE FROM public.consent_record WHERE account_id = :'fixture_account_id';
DELETE FROM public.auth_session WHERE account_id = :'fixture_account_id';
DELETE FROM public.customer_profile WHERE account_id = :'fixture_account_id';
DELETE FROM public.account WHERE id = :'fixture_account_id';
COMMIT;
`,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '')
      .replaceAll(connection.password, '[redacted]')
      .replaceAll(accountId, '[redacted]')
      .trim()
      .split('\n')
      .slice(-3)
      .join(' ');
    throw new TypeError(`Full B7 Store profile fixture cleanup failed${detail ? `: ${detail}` : ''}`);
  }
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
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

async function createCustomer(transaction: DatabaseTransaction): Promise<CustomerFixture> {
  const accountId = generateUlid();
  const customerId = generateUlid();
  const openId = `b72_${randomUUID()}`;
  const now = new Date();
  await transaction.account.create({
    data: {
      created_at: now,
      deleted_at: null,
      id: accountId,
      last_login_at: now,
      login_name: null,
      must_change_password: false,
      password_hash: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: now,
      version: 9,
      wechat_open_id: openId,
      wechat_union_id: null,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: accountId,
      created_at: now,
      id: customerId,
      registered_at: now,
      updated_at: now,
      version: 1,
    },
  });
  return {
    accountId,
    customerId,
    openId,
    session: {
      accessJti: `b72-access-${randomUUID()}`,
      accountId,
      accountVersion: 9,
      customerId,
      customerVersion: 1,
      expiresAt: new Date(now.getTime() + 3_600_000),
      sessionFamily: generateUlid(),
      sessionId: generateUlid(),
    },
  };
}

function phoneAuthorization(config: PlatformRuntimeConfig, phone: string) {
  return {
    consent: {
      accepted: true as const,
      documentVersion: config.store.legalDocuments.phoneAuthorization.version,
      type: 'PHONE_AUTHORIZATION' as const,
    },
    providerCredential: `mock:phone:${phone}`,
  };
}

integrationDescribe('B7.2 Store profile service and PostgreSQL integration', () => {
  let cleanupConnection: FullCleanupConnection | undefined;
  let config: PlatformRuntimeConfig;
  let provider: StorePhoneProvider;
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    config = integrationConfig();
    runtime = runtimeForMode();
    await runtime.connect();
    if (mode === 'full') cleanupConnection = cleanupConnectionForFull();
    provider = new StorePhoneProvider(config);
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('keeps profile, reauthorization, revocation, audit and HASH_ONLY facts atomic with outer rollback',
    async () => {
      const keys = Array.from({ length: 5 }, () => randomUUID());
      const requestIds = Array.from({ length: 5 }, () => requestId());
      let fixture: CustomerFixture | undefined;

      await expect(runtime.withPrismaTransaction(async (transaction) => {
        fixture = await createCustomer(transaction);
        const boundRuntime = transactionBoundRuntime(runtime, transaction);
        const service = new StoreProfileService(config, boundRuntime, provider);
        const session = fixture.session;

        await expect(service.getProfile(session)).resolves.toEqual({
          avatar_url: null,
          city: null,
          customer_id: fixture.customerId,
          nickname: null,
          phone_masked: null,
          phone_source: null,
          phone_tail: null,
          phone_verified_at: null,
          version: 1,
        });
        await expect(service.getProfile({ ...session, customerId: generateUlid() }))
          .rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });

        const patched = await service.updateProfile(session, {
          avatarUrl: 'https://images.example.invalid/customer/avatar.png',
          city: 'Auckland',
          nickname: 'B7.2 Customer',
        }, 1, keys[0]!, requestIds[0]!, '127.0.0.1');
        expect(patched).toMatchObject({ nickname: 'B7.2 Customer', phone_masked: null, version: 2 });
        await expect(service.updateProfile(session, { nickname: 'B7.2 Customer' }, 1,
          keys[0]!, requestId(), '127.0.0.1'))
          .rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });

        const stalePhone = '13800006820';
        await expect(service.authorizePhone(session, phoneAuthorization(config, stalePhone), 1,
          keys[1]!, requestIds[1]!, '127.0.0.1'))
          .rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT', httpStatus: 409 });
        await expect(Promise.all([
          transaction.customerPhoneVerification.count({ where: { customer_id: fixture.customerId } }),
          transaction.consentRecord.count({ where: { account_id: fixture.accountId } }),
          transaction.idempotencyRecord.count({ where: { idempotency_key: keys[1]! } }),
          transaction.auditLog.count({ where: { request_id: requestIds[1]! } }),
        ])).resolves.toEqual([0, 0, 0, 0]);

        const firstPhone = '13800006821';
        const authorized = await service.authorizePhone(session, phoneAuthorization(config, firstPhone), 2,
          keys[2]!, requestIds[2]!, '127.0.0.1');
        expect(authorized).toMatchObject({
          phone_masked: '138 **** 6821',
          phone_source: 'MOCK',
          phone_tail: '6821',
          version: 3,
        });
        const secondPhone = '13900007932';
        const reauthorized = await service.authorizePhone(session, phoneAuthorization(config, secondPhone), 3,
          keys[3]!, requestIds[3]!, '127.0.0.1');
        expect(reauthorized).toMatchObject({
          phone_masked: '139 **** 7932',
          phone_source: 'MOCK',
          phone_tail: '7932',
          version: 4,
        });
        const revoked = await service.revokePhone(session, 4, keys[4]!, requestIds[4]!, '127.0.0.1');
        expect(revoked).toMatchObject({ phone_masked: null, phone_source: null, phone_tail: null, version: 5 });

        const profile = await transaction.customerProfile.findUniqueOrThrow({ where: { id: fixture.customerId } });
        const phones = await transaction.customerPhoneVerification.findMany({
          where: { customer_id: fixture.customerId },
          orderBy: { created_at: 'asc' },
        });
        const consents = await transaction.consentRecord.findMany({ where: { account_id: fixture.accountId } });
        const idempotency = await transaction.idempotencyRecord.findMany({
          where: { actor_id: fixture.accountId },
        });
        const audits = await transaction.auditLog.findMany({ where: { actor_account_id: fixture.accountId } });
        expect(profile.version).toBe(5);
        expect(phones).toHaveLength(2);
        expect(phones.every(({ revoked_at }) => revoked_at !== null)).toBe(true);
        expect(consents).toHaveLength(2);
        expect(consents.every(({ consent_type, accepted }) =>
          consent_type === 'PHONE_AUTHORIZATION' && accepted)).toBe(true);
        expect(idempotency).toHaveLength(4);
        expect(idempotency.every(({ response_body, request_hash, response_body_hash }) =>
          response_body === null && /^[a-f0-9]{64}$/.test(request_hash) &&
          response_body_hash !== null && /^[a-f0-9]{64}$/.test(response_body_hash))).toBe(true);
        expect(audits).toHaveLength(4);
        expect(audits.map(({ action }) => action).sort()).toEqual(['REVOKE', 'UPDATE', 'VERIFY', 'VERIFY']);
        expect(audits.every(({ before_json, after_json, ip_hash }) =>
          before_json !== null && after_json !== null && ip_hash !== null)).toBe(true);
        expect(phones[0]?.phone_hash).not.toBe(sha256Hex(firstPhone));
        expect(phones[1]?.phone_hash).not.toBe(sha256Hex(secondPhone));
        const persisted = JSON.stringify({ audits, consents, idempotency, phones }, (_key, value) =>
          typeof value === 'bigint' ? value.toString() : value);
        for (const secret of [firstPhone, secondPhone, stalePhone, ...[
          phoneAuthorization(config, firstPhone).providerCredential,
          phoneAuthorization(config, secondPhone).providerCredential,
        ]]) expect(persisted).not.toContain(secret);
        throw rollbackSentinel;
      }, rollbackOptions)).rejects.toBe(rollbackSentinel);

      if (!fixture) throw new TypeError('Rollback-only B7 Store profile fixture was not created');
      await expect(Promise.all([
        runtime.prisma.account.count({ where: { id: fixture.accountId } }),
        runtime.prisma.account.count({ where: { wechat_open_id: fixture.openId } }),
        runtime.prisma.customerProfile.count({ where: { id: fixture.customerId } }),
        runtime.prisma.customerPhoneVerification.count({ where: { customer_id: fixture.customerId } }),
        runtime.prisma.consentRecord.count({ where: { account_id: fixture.accountId } }),
        runtime.prisma.idempotencyRecord.count({ where: { actor_id: fixture.accountId } }),
        runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0]);
    }, 120_000);

  fullIt('rolls back a profile mutation when audit validation fails', async () => {
    let fixture: CustomerFixture | undefined;
    try {
      fixture = await runtime.withPrismaTransaction((transaction) => createCustomer(transaction), rollbackOptions);
      const key = randomUUID();
      const service = new StoreProfileService(config, runtime, provider);
      await expect(service.updateProfile(fixture.session, { nickname: 'Must Roll Back' }, 1,
        key, 'invalid-request-id', '127.0.0.1'))
        .rejects.toThrow('Audit request ID must use the approved safe format');
      await expect(runtime.prisma.customerProfile.findUniqueOrThrow({ where: { id: fixture.customerId } }))
        .resolves.toMatchObject({ nickname: null, version: 1 });
      await expect(Promise.all([
        runtime.prisma.idempotencyRecord.count({ where: { actor_id: fixture.accountId } }),
        runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      ])).resolves.toEqual([0, 0]);
    } finally {
      if (fixture && cleanupConnection) cleanupFullFixture(cleanupConnection, fixture.accountId);
    }
  }, 90_000);

  fullIt('rolls back a profile mutation when the current phone fails integrity validation', async () => {
    let fixture: CustomerFixture | undefined;
    try {
      fixture = await runtime.withPrismaTransaction((transaction) => createCustomer(transaction), rollbackOptions);
      const service = new StoreProfileService(config, runtime, provider);
      await service.authorizePhone(
        fixture.session,
        phoneAuthorization(config, '13800006821'),
        1,
        randomUUID(),
        requestId(),
        '127.0.0.1',
      );
      const phone = await runtime.prisma.customerPhoneVerification.findFirstOrThrow({
        where: { customer_id: fixture.customerId, revoked_at: null },
      });
      await runtime.prisma.customerPhoneVerification.update({
        data: { phone_ciphertext: new Uint8Array(Buffer.from('{}')) },
        where: { id: phone.id },
      });

      const failedKey = randomUUID();
      const failedRequestId = requestId();
      await expect(service.updateProfile(
        fixture.session,
        { nickname: 'Must Not Commit' },
        2,
        failedKey,
        failedRequestId,
        '127.0.0.1',
      )).rejects.toMatchObject({ code: 'INTERNAL_ERROR', httpStatus: 500 });
      await expect(runtime.prisma.customerProfile.findUniqueOrThrow({ where: { id: fixture.customerId } }))
        .resolves.toMatchObject({ nickname: null, version: 2 });
      await expect(Promise.all([
        runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: failedKey } }),
        runtime.prisma.auditLog.count({ where: { request_id: failedRequestId } }),
      ])).resolves.toEqual([0, 0]);
    } finally {
      if (fixture && cleanupConnection) cleanupFullFixture(cleanupConnection, fixture.accountId);
    }
  }, 90_000);

  fullIt('serializes same-key and same-version phone/profile races to one committed fact set', async () => {
    let fixture: CustomerFixture | undefined;
    try {
      fixture = await runtime.withPrismaTransaction((transaction) => createCustomer(transaction), rollbackOptions);
      const service = new StoreProfileService(config, runtime, provider);
      const sameKey = randomUUID();
      const authorization = phoneAuthorization(config, '13800006821');
      const sameKeyResults = await Promise.allSettled([
        service.authorizePhone(fixture.session, authorization, 1, sameKey, requestId(), '127.0.0.1'),
        service.authorizePhone(fixture.session, authorization, 1, sameKey, requestId(), '127.0.0.1'),
      ]);
      expect(sameKeyResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const sameKeyFailure = sameKeyResults.find(({ status }) => status === 'rejected');
      expect(sameKeyFailure).toMatchObject({ reason: { code: 'STATE_CONFLICT', httpStatus: 409 } });
      await expect(Promise.all([
        runtime.prisma.customerProfile.findUniqueOrThrow({ where: { id: fixture.customerId } }),
        runtime.prisma.customerPhoneVerification.count({ where: { customer_id: fixture.customerId } }),
        runtime.prisma.consentRecord.count({ where: { account_id: fixture.accountId } }),
        runtime.prisma.idempotencyRecord.count({ where: { actor_id: fixture.accountId } }),
        runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      ])).resolves.toEqual([
        expect.objectContaining({ version: 2 }),
        1,
        1,
        1,
        1,
      ]);

      const raceResults = await Promise.allSettled([
        service.updateProfile(fixture.session, { nickname: 'Race Winner' }, 2,
          randomUUID(), requestId(), '127.0.0.1'),
        service.authorizePhone(fixture.session, phoneAuthorization(config, '13900007932'), 2,
          randomUUID(), requestId(), '127.0.0.1'),
      ]);
      expect(raceResults.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
      const raceFailure = raceResults.find(({ status }) => status === 'rejected');
      expect(raceFailure).toMatchObject({ reason: { code: 'RESOURCE_VERSION_CONFLICT', httpStatus: 409 } });
      await expect(runtime.prisma.customerProfile.findUniqueOrThrow({ where: { id: fixture.customerId } }))
        .resolves.toMatchObject({ version: 3 });
      expect(await runtime.prisma.customerPhoneVerification.count({
        where: { customer_id: fixture.customerId, revoked_at: null },
      })).toBe(1);
      await expect(Promise.all([
        runtime.prisma.idempotencyRecord.count({ where: { actor_id: fixture.accountId } }),
        runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      ])).resolves.toEqual([2, 2]);
    } finally {
      if (fixture && cleanupConnection) cleanupFullFixture(cleanupConnection, fixture.accountId);
    }
  }, 90_000);
});
