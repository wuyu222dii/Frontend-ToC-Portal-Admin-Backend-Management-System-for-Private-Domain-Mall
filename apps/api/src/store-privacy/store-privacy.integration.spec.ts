import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  StoreAuthRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import { generateUlid, sha256Hex } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StorePrivacyService } from './store-privacy.service';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B7_STORE_AUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B7_STORE_AUTH_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const rollbackOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const rollbackSentinel = Object.freeze({ code: 'B7_STORE_PRIVACY_API_ROLLBACK_SENTINEL' });

interface Fixture {
  accountId: string;
  customerId: string;
  session: CurrentStoreSession;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B7 Store privacy integration tests`);
  return value;
}

function integrationConfig(): PlatformRuntimeConfig {
  return {
    encryption: {
      idempotencyHashKeys: {
        current: { id: 'b74-idempotency-v2', key: Buffer.alloc(32, 61) },
        previous: [{ id: 'b74-idempotency-v1', key: Buffer.alloc(32, 62) }],
      },
      ipHashKey: Buffer.alloc(32, 63),
    },
  } as unknown as PlatformRuntimeConfig;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B7 Store privacy tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B7 Store privacy DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B7 Store privacy tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b74-store-privacy-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B7 Store privacy tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b74-store-privacy-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
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

async function createFixture(transaction: DatabaseTransaction): Promise<Fixture> {
  const now = new Date();
  const accountId = generateUlid();
  const customerId = generateUlid();
  const session: CurrentStoreSession = {
    accessJti: `b74-access-${randomUUID()}`,
    accountId,
    accountVersion: 4,
    customerId,
    customerVersion: 2,
    expiresAt: new Date(now.getTime() + 3_600_000),
    sessionFamily: generateUlid(),
    sessionId: generateUlid(),
  };
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
      version: session.accountVersion,
      wechat_open_id: `b74_${randomUUID()}`,
      wechat_union_id: `b74_union_${randomUUID()}`,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: accountId,
      avatar_url: 'https://images.example.invalid/b74/customer.png',
      city: 'Auckland',
      created_at: now,
      id: customerId,
      nickname: 'B7.4 Customer',
      registered_at: now,
      updated_at: now,
      version: session.customerVersion,
    },
  });
  await transaction.authSession.create({
    data: {
      access_jti: session.accessJti,
      account_id: accountId,
      assurance: 'WECHAT',
      created_at: now,
      expires_at: session.expiresAt,
      id: session.sessionId,
      last_seen_at: now,
      mfa_factor_id: null,
      mfa_verified_at: null,
      refresh_token_hash: sha256Hex(`b74-refresh-${randomUUID()}`),
      restriction: 'NONE',
      revoked_at: null,
      rotation_counter: 0,
      session_family: session.sessionFamily,
    },
  });
  return { accountId, customerId, session };
}

async function assertNoFixtureFacts(
  runtime: DatabaseRuntime,
  fixture: Fixture,
  keys: readonly string[],
  requestIds: readonly string[],
): Promise<void> {
  await expect(Promise.all([
    runtime.prisma.account.count({ where: { id: fixture.accountId } }),
    runtime.prisma.customerProfile.count({ where: { id: fixture.customerId } }),
    runtime.prisma.authSession.count({ where: { account_id: fixture.accountId } }),
    runtime.prisma.accountDeletionRequest.count({ where: { account_id: fixture.accountId } }),
    runtime.prisma.highRiskOperationPreview.count({ where: { actor_account_id: fixture.accountId } }),
    runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: { in: [...keys] } } }),
    runtime.prisma.auditLog.count({ where: { request_id: { in: [...requestIds] } } }),
    runtime.prisma.outboxEvent.count({ where: { aggregate_id: fixture.accountId } }),
  ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
}

integrationDescribe('B7.4 Store privacy API service and PostgreSQL integration', () => {
  let config: PlatformRuntimeConfig;
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    config = integrationConfig();
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('completes deletion atomically, invalidates the capability/session and leaves no outer-transaction residue',
    async () => {
      const keys = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
      const requestIds = [requestId(), requestId(), requestId(), requestId()];
      let fixture: Fixture | undefined;
      let rawPreviewToken = '';

      await expect(runtime.withPrismaTransaction(async (transaction) => {
        fixture = await createFixture(transaction);
        const boundRuntime = transactionBoundRuntime(runtime, transaction);
        const service = new StorePrivacyService(config, boundRuntime);
        const preview = await service.previewDeletion(
          fixture.session, { acknowledged: true }, keys[0]!, requestIds[0]!, '127.0.0.1',
        );
        expect(preview).toMatchObject({
          account_version: 4,
          blockers: [],
          confirmation_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          eligible: true,
          expires_at: expect.any(String),
          preview_token: expect.stringMatching(/^pvw_[A-Za-z0-9_-]{43}$/),
        });
        if (!preview.eligible) throw new TypeError('Expected eligible deletion preview');
        rawPreviewToken = preview.preview_token;

        await expect(service.confirmDeletion(fixture.session, {
          acknowledged: true,
          confirmationHash: `${preview.confirmation_hash.slice(0, 63)}${preview.confirmation_hash.endsWith('0') ? '1' : '0'}`,
          previewToken: preview.preview_token,
        }, preview.account_version, keys[1]!, requestIds[1]!, '127.0.0.1'))
          .rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH', httpStatus: 409 });

        const completed = await service.confirmDeletion(fixture.session, {
          acknowledged: true,
          confirmationHash: preview.confirmation_hash,
          previewToken: preview.preview_token,
        }, preview.account_version, keys[2]!, requestIds[2]!, '127.0.0.1');
        expect(completed).toMatchObject({
          completed_at: expect.any(String),
          request_id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
          status: 'COMPLETED',
          submitted_at: expect.any(String),
        });

        await expect(service.confirmDeletion(fixture.session, {
          acknowledged: true,
          confirmationHash: preview.confirmation_hash,
          previewToken: preview.preview_token,
        }, preview.account_version, keys[3]!, requestIds[3]!, '127.0.0.1'))
          .rejects.toMatchObject({ code: 'PREVIEW_EXPIRED', httpStatus: 409 });

        const [account, profile, sessionRow, deletion, capability, idempotency, audits, outbox] = await Promise.all([
          transaction.account.findUniqueOrThrow({ where: { id: fixture.accountId } }),
          transaction.customerProfile.findUniqueOrThrow({ where: { id: fixture.customerId } }),
          transaction.authSession.findUniqueOrThrow({ where: { id: fixture.session.sessionId } }),
          transaction.accountDeletionRequest.findUniqueOrThrow({ where: { id: completed.request_id } }),
          transaction.highRiskOperationPreview.findFirstOrThrow({ where: { actor_account_id: fixture.accountId } }),
          transaction.idempotencyRecord.findMany({ where: { actor_id: fixture.accountId } }),
          transaction.auditLog.findMany({ where: { actor_account_id: fixture.accountId } }),
          transaction.outboxEvent.findMany({ where: { aggregate_id: fixture.accountId } }),
        ]);
        expect(account).toMatchObject({
          deleted_at: expect.any(Date),
          status: 'ANONYMIZED',
          version: 5,
          wechat_open_id: null,
          wechat_union_id: null,
        });
        expect(profile).toMatchObject({
          anonymized_at: expect.any(Date), avatar_url: null, city: null, nickname: null, version: 3,
        });
        expect(sessionRow).toMatchObject({ refresh_token_hash: null, revoked_at: expect.any(Date) });
        expect(deletion).toMatchObject({ completed_at: expect.any(Date), status: 'COMPLETED' });
        expect(capability.consumed_at).toBeInstanceOf(Date);
        expect(capability.preview_token_hash).not.toBe(rawPreviewToken);
        expect(idempotency).toHaveLength(2);
        expect(idempotency.every(({ response_body }) => response_body === null)).toBe(true);
        expect(audits).toHaveLength(2);
        expect(outbox).toHaveLength(1);
        expect(outbox[0]).toMatchObject({ aggregate_type: 'account', event_type: 'account.anonymized' });
        await expect(new StoreAuthRepository(boundRuntime.prisma).getCurrentSession({
          accessJti: fixture.session.accessJti,
          sessionId: fixture.session.sessionId,
        })).resolves.toBeNull();
        expect(JSON.stringify([capability, idempotency])).not.toContain(rawPreviewToken);
        throw rollbackSentinel;
      }, rollbackOptions)).rejects.toBe(rollbackSentinel);

      if (!fixture) throw new TypeError('B7.4 Store privacy fixture was not created');
      await assertNoFixtureFacts(runtime, fixture, keys, requestIds);
    }, 90_000);
});
