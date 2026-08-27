import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import {
  generateUlid,
  hmacStoreInviteCode,
  storeCandidateTokenHashCandidates,
} from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StoreAttributionService } from './store-attribution.service';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B7_STORE_AUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B7_STORE_AUTH_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackSentinel = Object.freeze({ code: 'B7_STORE_ATTRIBUTION_API_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const ANONYMOUS_ACTOR = '00000000000000000000000000';

interface Fixture {
  accountIds: [string, string, string];
  agentId: string;
  customerIds: [string, string];
  inviteCode: string;
  inviteId: string;
  promotionAssetId: string;
  sessions: [CurrentStoreSession, CurrentStoreSession];
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
  if (!value) throw new TypeError(`${name} is required for B7 Store attribution API integration tests`);
  return value;
}

function config(): PlatformRuntimeConfig {
  return {
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-b73-integration',
      issuer: 'qingxu-api-b73-integration',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: {
        current: { id: 'b73-auth-secret-v2', key: Buffer.alloc(32, 73) },
        previous: [{ id: 'b73-auth-secret-v1', key: Buffer.alloc(32, 72) }],
      },
      sessionTtlSeconds: 604_800,
      signingKeys: {
        current: { id: 'b73-auth-sign-v1', key: Buffer.alloc(32, 71) },
        previous: [],
      },
    },
    encryption: {
      fieldKeys: {
        current: { id: 'b73-field-v1', key: Buffer.alloc(32, 70) },
        previous: [],
      },
      idempotencyHashKeys: {
        current: { id: 'b73-idempotency-v1', key: Buffer.alloc(32, 69) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 68),
    },
    environment: 'test',
  } as unknown as PlatformRuntimeConfig;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B7 Store attribution API tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B7 Store attribution API DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B7 Store attribution API tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b73-store-attribution-api-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 6,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B7 Store attribution API tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b73-store-attribution-api-rollback',
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
    throw new TypeError('B7 Store attribution API DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) || !LOOPBACK_HOSTS.has(directUrl.hostname) ||
    username !== 'mall_migrator' || !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B7 Store attribution API cleanup requires a matching mall_migrator test DB');
  }
  return {
    database: databaseName,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function cleanupFullFixture(connection: FullCleanupConnection, fixture: Fixture, key: string): void {
  const [agentAccountId, firstCustomerAccountId, secondCustomerAccountId] = fixture.accountIds;
  const [firstCustomerId, secondCustomerId] = fixture.customerIds;
  const result = spawnSync('psql', [
    '-X', '-v', 'ON_ERROR_STOP=1',
    '-v', `agent_account_id=${agentAccountId}`,
    '-v', `first_customer_account_id=${firstCustomerAccountId}`,
    '-v', `second_customer_account_id=${secondCustomerAccountId}`,
    '-v', `first_customer_id=${firstCustomerId}`,
    '-v', `second_customer_id=${secondCustomerId}`,
    '-v', `promotion_asset_id=${fixture.promotionAssetId}`,
    '-v', `invite_id=${fixture.inviteId}`,
    '-v', `agent_id=${fixture.agentId}`,
    '-v', `idempotency_key=${key}`,
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
DELETE FROM public.audit_log WHERE idempotency_key = :'idempotency_key';
DELETE FROM public.idempotency_record WHERE idempotency_key = :'idempotency_key';
DELETE FROM public.binding_change_log
  WHERE customer_id IN (:'first_customer_id', :'second_customer_id');
DELETE FROM public.customer_agent_binding
  WHERE customer_id IN (:'first_customer_id', :'second_customer_id');
DELETE FROM public.attribution_candidate WHERE promotion_asset_id = :'promotion_asset_id';
DELETE FROM public.promotion_asset WHERE id = :'promotion_asset_id';
DELETE FROM public.agent_invite_code WHERE id = :'invite_id';
DELETE FROM public.customer_profile WHERE id IN (:'first_customer_id', :'second_customer_id');
DELETE FROM public.agent_profile WHERE id = :'agent_id';
DELETE FROM public.account WHERE id IN (
  :'agent_account_id', :'first_customer_account_id', :'second_customer_account_id'
);
COMMIT;
`,
  });
  if (result.error || result.status !== 0) {
    const detail = (result.stderr || result.error?.message || '')
      .replaceAll(connection.password, '[redacted]')
      .trim()
      .split('\n')
      .slice(-3)
      .join(' ');
    throw new TypeError(`Full B7 Store attribution API fixture cleanup failed${detail ? `: ${detail}` : ''}`);
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

function newFixture(): Fixture {
  const accountIds = [generateUlid(), generateUlid(), generateUlid()] as [string, string, string];
  const customerIds = [generateUlid(), generateUlid()] as [string, string];
  const now = new Date();
  return {
    accountIds,
    agentId: generateUlid(),
    customerIds,
    inviteCode: `B73-${randomUUID()}`,
    inviteId: generateUlid(),
    promotionAssetId: generateUlid(),
    sessions: customerIds.map((customerId, index) => ({
      accessJti: `b73-access-${randomUUID()}`,
      accountId: accountIds[index + 1]!,
      accountVersion: 1,
      customerId,
      customerVersion: 1,
      expiresAt: new Date(now.getTime() + 3_600_000),
      sessionFamily: generateUlid(),
      sessionId: generateUlid(),
    })) as [CurrentStoreSession, CurrentStoreSession],
  };
}

async function createFixture(
  transaction: DatabaseTransaction,
  fixture: Fixture,
  runtimeConfig: PlatformRuntimeConfig,
): Promise<void> {
  const now = new Date();
  const suffix = randomUUID();
  const previousSecret = runtimeConfig.authentication.secretHashKeys.previous[0];
  if (!previousSecret) throw new TypeError('B7 Store attribution fixture requires a previous HMAC key');
  await transaction.account.create({
    data: {
      created_at: now,
      deleted_at: null,
      id: fixture.accountIds[0],
      login_name: `b73-api-agent-${suffix}`,
      must_change_password: false,
      password_hash: 'b73-api-integration-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentProfile.create({
    data: {
      account_id: fixture.accountIds[0],
      agent_no: `B73-${suffix.replaceAll('-', '').slice(0, 20)}`,
      created_at: now,
      deleted_at: null,
      id: fixture.agentId,
      name: 'B7.3 API Integration Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentInviteCode.create({
    data: {
      agent_id: fixture.agentId,
      code_ciphertext: Buffer.from('b73-api-integration-invite-ciphertext'),
      code_hash: hmacStoreInviteCode(fixture.inviteCode, previousSecret.key),
      code_last4: fixture.inviteCode.slice(-4),
      created_at: now,
      effective_at: new Date(now.getTime() - 60_000),
      encryption_key_id: runtimeConfig.encryption.fieldKeys.current.id,
      ended_at: null,
      expires_at: new Date(now.getTime() + 3_600_000),
      id: fixture.inviteId,
      status: 'ACTIVE',
    },
  });
  await transaction.promotionAsset.create({
    data: {
      agent_id: fixture.agentId,
      authorization_version: 1,
      created_at: now,
      expires_at: new Date(now.getTime() + 3_600_000),
      id: fixture.promotionAssetId,
      invite_code_id: fixture.inviteId,
      public_url: 'https://store.example.invalid/',
      revoked_at: null,
      status: 'ACTIVE',
      target_product_id: null,
      target_type: 'STOREFRONT',
    },
  });
  for (const [index, customerId] of fixture.customerIds.entries()) {
    await transaction.account.create({
      data: {
        created_at: now,
        deleted_at: null,
        id: fixture.accountIds[index + 1]!,
        last_login_at: now,
        login_name: null,
        must_change_password: false,
        password_hash: null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
        wechat_open_id: `b73-api-${index}-${suffix}`,
        wechat_union_id: null,
      },
    });
    await transaction.customerProfile.create({
      data: {
        account_id: fixture.accountIds[index + 1]!,
        created_at: now,
        id: customerId,
        registered_at: now,
        updated_at: now,
        version: 1,
      },
    });
  }
}

function candidateBranch(response: Awaited<ReturnType<StoreAttributionService['createCandidate']>>) {
  if (!response.candidate || typeof response.candidate_token !== 'string') {
    throw new TypeError('Expected a token-bearing Store attribution candidate branch');
  }
  return { candidate: response.candidate, token: response.candidate_token };
}

function persistedText(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => typeof nested === 'bigint' ? nested.toString() : nested);
}

async function assertNoFixtureFacts(
  runtime: DatabaseRuntime,
  fixture: Fixture,
  keys: readonly string[],
  requestIds: readonly string[],
): Promise<void> {
  await expect(Promise.all([
    runtime.prisma.account.count({ where: { id: { in: fixture.accountIds } } }),
    runtime.prisma.agentProfile.count({ where: { id: fixture.agentId } }),
    runtime.prisma.agentInviteCode.count({ where: { id: fixture.inviteId } }),
    runtime.prisma.promotionAsset.count({ where: { id: fixture.promotionAssetId } }),
    runtime.prisma.attributionCandidate.count({ where: { promotion_asset_id: fixture.promotionAssetId } }),
    runtime.prisma.customerAgentBinding.count({ where: { customer_id: { in: fixture.customerIds } } }),
    runtime.prisma.bindingChangeLog.count({ where: { customer_id: { in: fixture.customerIds } } }),
    runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: { in: [...keys] } } }),
    runtime.prisma.auditLog.count({ where: { request_id: { in: [...requestIds] } } }),
  ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
}

integrationDescribe('B7.3 Store attribution API service and PostgreSQL integration', () => {
  let cleanupConnection: FullCleanupConnection | undefined;
  let runtime: DatabaseRuntime;
  let runtimeConfig: PlatformRuntimeConfig;

  beforeAll(async () => {
    runtimeConfig = config();
    runtime = runtimeForMode();
    await runtime.connect();
    if (mode === 'full') cleanupConnection = cleanupConnectionForFull();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('keeps all three branches, replacement, confirm/reject, audit and HASH_ONLY facts in outer rollback',
    async () => {
      const fixture = newFixture();
      const keys = Array.from({ length: 8 }, () => randomUUID());
      const requestIds = Array.from({ length: 8 }, () => requestId());
      const rawTokens: string[] = [];

      await expect(runtime.withPrismaTransaction(async (transaction) => {
        await createFixture(transaction, fixture, runtimeConfig);
        const service = new StoreAttributionService(
          runtimeConfig,
          transactionBoundRuntime(runtime, transaction),
        );
        const target = { inviteCode: fixture.inviteCode, promotionAssetId: fixture.promotionAssetId };

        const first = candidateBranch(await service.createCandidate(
          { kind: 'ANONYMOUS' }, target, keys[0]!, requestIds[0]!, '127.0.0.1',
        ));
        rawTokens.push(first.token);
        expect(first.candidate).toMatchObject({
          agent_id: fixture.agentId,
          attribution_eligible: true,
          confirmation_required: true,
          remaining_seconds: expect.any(Number),
        });
        expect(first.candidate.remaining_seconds).toBeGreaterThan(0);
        expect(first.candidate.remaining_seconds).toBeLessThanOrEqual(1_800);
        const firstHashes = storeCandidateTokenHashCandidates(
          first.token,
          runtimeConfig.authentication.secretHashKeys,
        );
        await expect(service.getCurrentCandidate({
          kind: 'CANDIDATE_TOKEN', tokenHashCandidates: firstHashes,
        })).resolves.toMatchObject({ candidate_id: first.candidate.candidate_id });

        const replacement = candidateBranch(await service.createCandidate(
          { kind: 'CANDIDATE_TOKEN', tokenHashCandidates: firstHashes },
          target,
          keys[1]!,
          requestIds[1]!,
          '127.0.0.1',
        ));
        rawTokens.push(replacement.token);
        expect(replacement.candidate.candidate_id).not.toBe(first.candidate.candidate_id);
        await expect(service.getCurrentCandidate({
          kind: 'CANDIDATE_TOKEN', tokenHashCandidates: firstHashes,
        })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });
        await expect(service.createCandidate(
          { kind: 'CANDIDATE_TOKEN', tokenHashCandidates: firstHashes },
          target,
          keys[0]!,
          requestId(),
          '127.0.0.1',
        )).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });
        await expect(service.getCurrentCandidate({
          kind: 'CANDIDATE_TOKEN',
          tokenHashCandidates: storeCandidateTokenHashCandidates(
            replacement.token,
            runtimeConfig.authentication.secretHashKeys,
          ),
        })).resolves.toMatchObject({ candidate_id: replacement.candidate.candidate_id });

        await transaction.agentInviteCode.update({
          data: { status: 'DISABLED' },
          where: { id: fixture.inviteId },
        });
        await expect(service.createCandidate(
          { kind: 'ANONYMOUS' }, target, keys[2]!, requestIds[2]!, '127.0.0.1',
        )).resolves.toEqual({
          candidate: null,
          candidate_token: null,
          public_fallback: {
            attribution_eligible: false,
            public_target_url: 'https://store.example.invalid/',
          },
          service_agent: null,
        });
        await transaction.agentInviteCode.update({
          data: { status: 'ACTIVE' },
          where: { id: fixture.inviteId },
        });

        const firstCustomerCandidate = await service.createCandidate(
          { kind: 'CUSTOMER', session: fixture.sessions[0] },
          target,
          keys[3]!,
          requestIds[3]!,
          '127.0.0.1',
        );
        expect(firstCustomerCandidate).toMatchObject({
          candidate: { agent_id: fixture.agentId },
          candidate_token: null,
          public_fallback: null,
          service_agent: null,
        });
        await expect(service.getCurrentCandidate({
          kind: 'CUSTOMER', session: fixture.sessions[0],
        })).resolves.toMatchObject({ candidate_id: firstCustomerCandidate.candidate?.candidate_id });

        const confirmed = await service.confirmCandidate(
          fixture.sessions[0], keys[4]!, requestIds[4]!, '127.0.0.1',
        );
        expect(confirmed).toMatchObject({ agent_id: fixture.agentId, display_name: 'B7.3 API Integration Agent' });
        await expect(service.getServiceAgent(fixture.sessions[0])).resolves.toEqual(confirmed);
        await expect(service.createCandidate(
          { kind: 'CUSTOMER', session: fixture.sessions[0] },
          target,
          keys[5]!,
          requestIds[5]!,
          '127.0.0.1',
        )).resolves.toEqual({
          candidate: null,
          candidate_token: null,
          public_fallback: null,
          service_agent: confirmed,
        });

        const secondCustomerCandidate = await service.createCandidate(
          { kind: 'CUSTOMER', session: fixture.sessions[1] },
          target,
          keys[6]!,
          requestIds[6]!,
          '127.0.0.1',
        );
        const rejected = await service.rejectCandidate(
          fixture.sessions[1], keys[7]!, requestIds[7]!, '127.0.0.1',
        );
        expect(rejected).toMatchObject({
          candidate_id: secondCustomerCandidate.candidate?.candidate_id,
          status: 'REJECTED',
        });
        await expect(service.getCurrentCandidate({
          kind: 'CUSTOMER', session: fixture.sessions[1],
        })).resolves.toBeNull();
        await expect(service.getServiceAgent(fixture.sessions[1])).resolves.toBeNull();

        await expect(service.createCandidate(
          { kind: 'ANONYMOUS' }, target, keys[0]!, requestId(), '127.0.0.1',
        )).rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });

        const candidates = await transaction.attributionCandidate.findMany({
          where: { promotion_asset_id: fixture.promotionAssetId },
          orderBy: { created_at: 'asc' },
        });
        const idempotency = await transaction.idempotencyRecord.findMany({
          where: { idempotency_key: { in: keys } },
          orderBy: { created_at: 'asc' },
        });
        const audits = await transaction.auditLog.findMany({
          where: { request_id: { in: requestIds } },
          orderBy: { occurred_at: 'asc' },
        });
        const bindings = await transaction.customerAgentBinding.findMany({
          where: { customer_id: { in: fixture.customerIds } },
        });
        const changes = await transaction.bindingChangeLog.findMany({
          where: { customer_id: { in: fixture.customerIds } },
        });
        expect(candidates).toHaveLength(4);
        expect(candidates.map(({ status }) => status).sort())
          .toEqual(['ACTIVE', 'CONFIRMED', 'INVALIDATED', 'REJECTED']);
        expect(bindings).toHaveLength(1);
        expect(changes).toHaveLength(1);
        expect(idempotency).toHaveLength(8);
        expect(idempotency.every(({ request_hash, response_body, response_body_hash }) =>
          /^[a-f0-9]{64}$/.test(request_hash) && response_body === null &&
          response_body_hash !== null && /^[a-f0-9]{64}$/.test(response_body_hash))).toBe(true);
        expect(audits).toHaveLength(8);
        expect(audits.map(({ action }) => action).sort()).toEqual([
          'CONFIRM', 'CREATE', 'CREATE', 'CREATE', 'CREATE', 'CREATE', 'CREATE', 'REJECT',
        ]);
        expect(audits.every(({ before_json, after_json, ip_hash }) =>
          before_json === null && after_json === null && ip_hash !== null && /^[a-f0-9]{64}$/.test(ip_hash)))
          .toBe(true);
        expect(audits.filter(({ actor_account_id }) => actor_account_id === null)).toHaveLength(3);
        expect(idempotency.filter(({ actor_id }) => actor_id === ANONYMOUS_ACTOR)).toHaveLength(3);

        const persisted = persistedText({ audits, candidates, idempotency });
        expect(persisted).not.toContain(fixture.inviteCode);
        for (const token of rawTokens) expect(persisted).not.toContain(token);
        throw rollbackSentinel;
      }, transactionOptions)).rejects.toBe(rollbackSentinel);

      await assertNoFixtureFacts(runtime, fixture, keys, requestIds);
    }, 120_000);

  fullIt('rolls back candidate and HASH_ONLY facts when audit validation fails', async () => {
    const fixture = newFixture();
    const key = randomUUID();
    try {
      await runtime.withPrismaTransaction(
        (transaction) => createFixture(transaction, fixture, runtimeConfig),
        transactionOptions,
      );
      const service = new StoreAttributionService(runtimeConfig, runtime);
      await expect(service.createCandidate(
        { kind: 'ANONYMOUS' },
        { inviteCode: fixture.inviteCode, promotionAssetId: fixture.promotionAssetId },
        key,
        'invalid-request-id',
        '127.0.0.1',
      )).rejects.toThrow('Audit request ID must use the approved safe format');
      await expect(Promise.all([
        runtime.prisma.attributionCandidate.count({
          where: { promotion_asset_id: fixture.promotionAssetId },
        }),
        runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: key } }),
        runtime.prisma.auditLog.count({ where: { idempotency_key: key } }),
      ])).resolves.toEqual([0, 0, 0]);
    } finally {
      if (cleanupConnection) cleanupFullFixture(cleanupConnection, fixture, key);
    }
  }, 90_000);
});
