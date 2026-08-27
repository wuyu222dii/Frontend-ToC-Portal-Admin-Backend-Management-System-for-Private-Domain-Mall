import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  generateStoreCandidateToken,
  generateUlid,
  hmacStoreCandidateToken,
  hmacStoreInviteCode,
} from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import type { DatabaseTransaction } from './idempotency.repository';
import { StoreAttributionRepository } from './store-attribution.repository';
import { runSerializableTransaction } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B7_STORE_AUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B7_STORE_AUTH_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackSentinel = Object.freeze({ code: 'B7_STORE_ATTRIBUTION_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FixtureIds {
  accountIds: string[];
  agentId: string;
  bindingId: string;
  candidateIds: string[];
  changeLogId: string;
  customerIds: string[];
  inviteId: string;
  promotionAssetId: string;
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
  if (!value) throw new TypeError(`${name} is required for B7 Store attribution integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B7 Store attribution tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B7 Store attribution DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B7 Store attribution tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b73-store-attribution-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 6,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B7 Store attribution tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b73-store-attribution-rollback',
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
  let database: string;
  let password: string;
  try {
    username = decodeURIComponent(directUrl.username);
    database = decodeURIComponent(directUrl.pathname.slice(1));
    password = decodeURIComponent(directUrl.password);
  } catch {
    throw new TypeError('B7 Store attribution DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) || !LOOPBACK_HOSTS.has(directUrl.hostname) ||
    username !== 'mall_migrator' || !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B7 Store attribution cleanup requires a matching loopback mall_migrator test DB');
  }
  return {
    database,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function cleanupFullFixture(connection: FullCleanupConnection, ids: FixtureIds): void {
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `fixture_agent_id=${ids.agentId}`,
    '-v', `fixture_customer_one=${ids.customerIds[0]!}`,
    '-v', `fixture_customer_two=${ids.customerIds[1]!}`,
    '-v', `fixture_account_one=${ids.accountIds[0]!}`,
    '-v', `fixture_account_two=${ids.accountIds[1]!}`,
    '-v', `fixture_account_three=${ids.accountIds[2]!}`,
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
DELETE FROM public.binding_change_log
 WHERE customer_id IN (:'fixture_customer_one', :'fixture_customer_two');
DELETE FROM public.customer_agent_binding
 WHERE customer_id IN (:'fixture_customer_one', :'fixture_customer_two');
DELETE FROM public.attribution_candidate
 WHERE customer_id IN (:'fixture_customer_one', :'fixture_customer_two')
    OR agent_id = :'fixture_agent_id';
DELETE FROM public.promotion_asset WHERE agent_id = :'fixture_agent_id';
DELETE FROM public.agent_invite_code WHERE agent_id = :'fixture_agent_id';
DELETE FROM public.customer_profile WHERE id IN (:'fixture_customer_one', :'fixture_customer_two');
DELETE FROM public.agent_profile WHERE id = :'fixture_agent_id';
DELETE FROM public.account
 WHERE id IN (:'fixture_account_one', :'fixture_account_two', :'fixture_account_three');
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
    throw new TypeError(`Full B7 Store attribution fixture cleanup failed${detail ? `: ${detail}` : ''}`);
  }
}

function transactionBoundPrisma(transaction: DatabaseTransaction): PrismaClient {
  return new Proxy(transaction as unknown as PrismaClient, {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

function newFixtureIds(): FixtureIds {
  return {
    accountIds: [generateUlid(), generateUlid(), generateUlid()],
    agentId: generateUlid(),
    bindingId: generateUlid(),
    candidateIds: Array.from({ length: 4 }, () => generateUlid()),
    changeLogId: generateUlid(),
    customerIds: [generateUlid(), generateUlid()],
    inviteId: generateUlid(),
    promotionAssetId: generateUlid(),
  };
}

function findPostgresCode(error: unknown, seen = new Set<object>()): string | undefined {
  if (typeof error !== 'object' || error === null || seen.has(error)) return undefined;
  seen.add(error);
  const record = error as Record<string, unknown>;
  for (const key of ['originalCode', 'sqlState', 'code']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && /^\d{5}$/.test(candidate)) return candidate;
  }
  for (const value of Object.values(record)) {
    const nested = findPostgresCode(value, seen);
    if (nested) return nested;
  }
  return undefined;
}

async function expectDatabaseFailure(
  work: () => Promise<unknown>,
  expectedPostgresCode: '23505' | '23514',
): Promise<void> {
  let failure: unknown;
  try {
    await work();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeDefined();
  expect(findPostgresCode(failure)).toBe(expectedPostgresCode);
}

async function createFixture(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  now: Date,
  inviteHash: string,
): Promise<void> {
  const suffix = randomUUID();
  const agentSuffix = suffix.replaceAll('-', '').slice(0, 20);
  await transaction.account.create({
    data: {
      created_at: now,
      deleted_at: null,
      id: ids.accountIds[0]!,
      login_name: `b73-agent-${suffix}`,
      must_change_password: false,
      password_hash: 'b73-integration-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentProfile.create({
    data: {
      account_id: ids.accountIds[0]!,
      agent_no: `B73-${agentSuffix}`,
      created_at: now,
      deleted_at: null,
      id: ids.agentId,
      name: 'B7.3 Integration Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentInviteCode.create({
    data: {
      agent_id: ids.agentId,
      code_ciphertext: Buffer.from('b73-integration-invite-ciphertext'),
      code_hash: inviteHash,
      code_last4: 'B073',
      created_at: now,
      effective_at: new Date(now.getTime() - 60_000),
      encryption_key_id: 'b73-integration-field-v1',
      ended_at: null,
      expires_at: new Date(now.getTime() + 3_600_000),
      id: ids.inviteId,
      status: 'ACTIVE',
    },
  });
  await transaction.promotionAsset.create({
    data: {
      agent_id: ids.agentId,
      authorization_version: 1,
      created_at: now,
      expires_at: new Date(now.getTime() + 3_600_000),
      id: ids.promotionAssetId,
      invite_code_id: ids.inviteId,
      public_url: 'https://store.example.invalid/',
      revoked_at: null,
      status: 'ACTIVE',
      target_product_id: null,
      target_type: 'STOREFRONT',
    },
  });
  for (const [index, customerId] of ids.customerIds.entries()) {
    const accountId = ids.accountIds[index + 1]!;
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
        version: 1,
        wechat_open_id: `b73-${index}-${suffix}`,
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
  }
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, ids: FixtureIds): Promise<void> {
  const [accounts, agents, invites, assets, candidates, bindings, changes] = await Promise.all([
    runtime.prisma.account.count({ where: { id: { in: ids.accountIds } } }),
    runtime.prisma.agentProfile.count({ where: { id: ids.agentId } }),
    runtime.prisma.agentInviteCode.count({ where: { id: ids.inviteId } }),
    runtime.prisma.promotionAsset.count({ where: { id: ids.promotionAssetId } }),
    runtime.prisma.attributionCandidate.count({ where: { id: { in: ids.candidateIds } } }),
    runtime.prisma.customerAgentBinding.count({ where: { id: ids.bindingId } }),
    runtime.prisma.bindingChangeLog.count({ where: { id: ids.changeLogId } }),
  ]);
  expect([accounts, agents, invites, assets, candidates, bindings, changes]).toEqual([0, 0, 0, 0, 0, 0, 0]);
}

integrationDescribe('B7.3 Store attribution repository PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('keeps replacement, migration, rejection, confirmation and binding projection atomic with rollback',
    async () => {
      const ids = newFixtureIds();
      const now = new Date();
      const secretKey = Buffer.alloc(32, 73);
      const inviteCode = `B73-${randomUUID()}`;
      const inviteHash = hmacStoreInviteCode(inviteCode, secretKey);
      const firstToken = generateStoreCandidateToken();
      const secondToken = generateStoreCandidateToken();
      const firstTokenHash = hmacStoreCandidateToken(firstToken, secretKey);
      const secondTokenHash = hmacStoreCandidateToken(secondToken, secretKey);

      await expect(runtime.withPrismaTransaction(async (transaction) => {
        await createFixture(transaction, ids, now, inviteHash);
        const repository = new StoreAttributionRepository(transactionBoundPrisma(transaction), () => new Date(now));
        const target = { inviteCodeHashCandidates: [inviteHash], promotionAssetId: ids.promotionAssetId };

        const first = await repository.createAnonymousCandidateInTransaction(transaction, {
          ...target,
          candidateId: ids.candidateIds[0]!,
          candidateTokenHash: firstTokenHash,
        });
        expect(first).toMatchObject({ kind: 'candidate', candidate: { id: ids.candidateIds[0] } });
        await expect(repository.getAnonymousCandidate([firstTokenHash])).resolves.toMatchObject({
          id: ids.candidateIds[0],
        });

        const replacement = await repository.createAnonymousCandidateInTransaction(transaction, {
          ...target,
          candidateId: ids.candidateIds[1]!,
          candidateTokenHash: secondTokenHash,
          replacementTokenHashCandidates: [firstTokenHash],
        });
        expect(replacement).toMatchObject({ kind: 'candidate', candidate: { id: ids.candidateIds[1] } });
        await expect(repository.getAnonymousCandidate([firstTokenHash])).resolves.toBeNull();

        const migrated = await repository.migrateAnonymousCandidateInTransaction(transaction, {
          accountId: ids.accountIds[1]!,
          customerId: ids.customerIds[0]!,
          tokenHashCandidates: [secondTokenHash],
        });
        expect(migrated).toMatchObject({ kind: 'candidate', candidate: { id: ids.candidateIds[1] } });
        const migratedFact = await transaction.attributionCandidate.findUniqueOrThrow({
          where: { id: ids.candidateIds[1] },
        });
        expect(migratedFact).toMatchObject({
          candidate_token_hash: null,
          customer_id: ids.customerIds[0],
          status: 'ACTIVE',
        });

        const confirmed = await repository.confirmCurrentCandidateInTransaction(transaction, {
          accountId: ids.accountIds[1]!,
          bindingChangeLogId: ids.changeLogId,
          bindingId: ids.bindingId,
          customerId: ids.customerIds[0]!,
        });
        expect(confirmed).toMatchObject({ agentId: ids.agentId, displayName: 'B7.3 Integration Agent' });
        await expect(repository.confirmCurrentCandidateInTransaction(transaction, {
          accountId: ids.accountIds[1]!,
          bindingChangeLogId: generateUlid(),
          bindingId: generateUlid(),
          customerId: ids.customerIds[0]!,
        })).resolves.toEqual(confirmed);
        expect(await transaction.bindingChangeLog.count({ where: { customer_id: ids.customerIds[0] } })).toBe(1);
        expect((await transaction.customerProfile.findUniqueOrThrow({
          where: { id: ids.customerIds[0] },
        })).version).toBe(2);

        await transaction.agentProfile.update({
          where: { id: ids.agentId },
          data: { status: 'DISABLED', updated_at: now, version: { increment: 1 } },
        });
        await expect(repository.getCurrentServiceAgent({
          accountId: ids.accountIds[1]!,
          customerId: ids.customerIds[0]!,
        })).resolves.toEqual(confirmed);
        await expect(repository.createCustomerCandidateInTransaction(transaction, {
          accountId: ids.accountIds[1]!,
          candidateId: ids.candidateIds[2]!,
          customerId: ids.customerIds[0]!,
          inviteCodeHashCandidates: [inviteHash],
          promotionAssetId: generateUlid(),
        })).resolves.toEqual({ kind: 'service_agent', serviceAgent: confirmed });

        await transaction.agentProfile.update({
          where: { id: ids.agentId },
          data: { status: 'ACTIVE', updated_at: now, version: { increment: 1 } },
        });
        const customerCandidate = await repository.createCustomerCandidateInTransaction(transaction, {
          ...target,
          accountId: ids.accountIds[2]!,
          candidateId: ids.candidateIds[2]!,
          customerId: ids.customerIds[1]!,
        });
        expect(customerCandidate).toMatchObject({ kind: 'candidate', candidate: { id: ids.candidateIds[2] } });
        const rejected = await repository.rejectCurrentCandidateInTransaction(transaction, {
          accountId: ids.accountIds[2]!,
          customerId: ids.customerIds[1]!,
        });
        expect(rejected).toEqual({ candidateId: ids.candidateIds[2], rejectedAt: now });
        expect((await transaction.customerProfile.findUniqueOrThrow({
          where: { id: ids.customerIds[1] },
        })).version).toBe(1);

        await transaction.agentInviteCode.update({
          where: { id: ids.inviteId },
          data: { status: 'DISABLED' },
        });
        await expect(repository.createAnonymousCandidateInTransaction(transaction, {
          ...target,
          candidateId: ids.candidateIds[3]!,
          candidateTokenHash: hmacStoreCandidateToken(generateStoreCandidateToken(), secretKey),
        })).resolves.toEqual({
          kind: 'public_fallback',
          publicTargetUrl: 'https://store.example.invalid/',
        });
        expect(await transaction.attributionCandidate.count({ where: { id: ids.candidateIds[3] } })).toBe(0);

        throw rollbackSentinel;
      }, transactionOptions)).rejects.toBe(rollbackSentinel);
      await assertNoFixtureFacts(runtime, ids);
    }, 90_000);

  it('enforces the three current-fact partial unique indexes and candidate subject CHECK', async () => {
    const cases: Array<{
      expectedCode: '23505' | '23514';
      write: (transaction: DatabaseTransaction, ids: FixtureIds, now: Date, tokenHash: string) => Promise<unknown>;
    }> = [
      {
        expectedCode: '23505',
        write: async (transaction, ids, now, tokenHash) => {
          const base = {
            agent_id: ids.agentId,
            confirmed_at: null,
            created_at: now,
            customer_id: null,
            expires_at: new Date(now.getTime() + 60_000),
            invalid_reason: null,
            invite_code_id: ids.inviteId,
            promotion_asset_id: ids.promotionAssetId,
            status: 'ACTIVE' as const,
            updated_at: now,
          };
          await transaction.attributionCandidate.create({
            data: { ...base, candidate_token_hash: tokenHash, id: ids.candidateIds[0]! },
          });
          return transaction.attributionCandidate.create({
            data: { ...base, candidate_token_hash: tokenHash, id: ids.candidateIds[1]! },
          });
        },
      },
      {
        expectedCode: '23505',
        write: async (transaction, ids, now) => {
          const base = {
            agent_id: ids.agentId,
            candidate_token_hash: null,
            confirmed_at: null,
            created_at: now,
            customer_id: ids.customerIds[0]!,
            expires_at: new Date(now.getTime() + 60_000),
            invalid_reason: null,
            invite_code_id: ids.inviteId,
            promotion_asset_id: ids.promotionAssetId,
            status: 'ACTIVE' as const,
            updated_at: now,
          };
          await transaction.attributionCandidate.create({ data: { ...base, id: ids.candidateIds[0]! } });
          return transaction.attributionCandidate.create({ data: { ...base, id: ids.candidateIds[1]! } });
        },
      },
      {
        expectedCode: '23505',
        write: async (transaction, ids, now) => {
          await transaction.customerAgentBinding.create({
            data: {
              agent_id: ids.agentId,
              created_at: now,
              customer_id: ids.customerIds[0]!,
              ended_at: null,
              id: ids.bindingId,
              started_at: now,
            },
          });
          return transaction.customerAgentBinding.create({
            data: {
              agent_id: ids.agentId,
              created_at: now,
              customer_id: ids.customerIds[0]!,
              ended_at: null,
              id: generateUlid(),
              started_at: now,
            },
          });
        },
      },
      {
        expectedCode: '23514',
        write: (transaction, ids, now, tokenHash) => transaction.attributionCandidate.create({
          data: {
            agent_id: ids.agentId,
            candidate_token_hash: tokenHash,
            confirmed_at: null,
            created_at: now,
            customer_id: ids.customerIds[0]!,
            expires_at: new Date(now.getTime() + 60_000),
            id: ids.candidateIds[0]!,
            invalid_reason: null,
            invite_code_id: ids.inviteId,
            promotion_asset_id: ids.promotionAssetId,
            status: 'ACTIVE',
            updated_at: now,
          },
        }),
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const ids = newFixtureIds();
      const now = new Date();
      const key = Buffer.alloc(32, 80 + index);
      const inviteHash = hmacStoreInviteCode(`B73-CONSTRAINT-${index}`, key);
      const tokenHash = hmacStoreCandidateToken(generateStoreCandidateToken(), key);
      await expectDatabaseFailure(() => runtime.withPrismaTransaction(async (transaction) => {
        await createFixture(transaction, ids, now, inviteHash);
        await testCase.write(transaction, ids, now, tokenHash);
      }, transactionOptions), testCase.expectedCode);
      await assertNoFixtureFacts(runtime, ids);
    }
  }, 90_000);

  fullIt('serializes two independent confirmation transactions and persists only the winning binding', async () => {
    const ids = newFixtureIds();
    const cleanup = cleanupConnectionForFull();
    const now = new Date();
    const key = Buffer.alloc(32, 91);
    const inviteHash = hmacStoreInviteCode(`B73-CONCURRENT-${randomUUID()}`, key);
    const repository = new StoreAttributionRepository(runtime.prisma);
    const secondBindingId = generateUlid();
    try {
      await runtime.withPrismaTransaction(async (transaction) => {
        await createFixture(transaction, ids, now, inviteHash);
        await repository.createCustomerCandidateInTransaction(transaction, {
          accountId: ids.accountIds[1]!,
          candidateId: ids.candidateIds[0]!,
          customerId: ids.customerIds[0]!,
          inviteCodeHashCandidates: [inviteHash],
          promotionAssetId: ids.promotionAssetId,
        });
      }, transactionOptions);

      const confirm = (bindingId: string, bindingChangeLogId: string) =>
        runSerializableTransaction(runtime.prisma, (transaction) =>
          repository.confirmCurrentCandidateInTransaction(transaction, {
            accountId: ids.accountIds[1]!,
            bindingChangeLogId,
            bindingId,
            customerId: ids.customerIds[0]!,
          }), { maxAttempts: 5, initialDelayMs: 5 });
      const [first, second] = await Promise.all([
        confirm(ids.bindingId, ids.changeLogId),
        confirm(secondBindingId, generateUlid()),
      ]);
      expect(second).toEqual(first);
      expect(first).toMatchObject({ agentId: ids.agentId, displayName: 'B7.3 Integration Agent' });
      const [bindings, changes, candidate, customer] = await Promise.all([
        runtime.prisma.customerAgentBinding.findMany({
          where: { customer_id: ids.customerIds[0], ended_at: null },
        }),
        runtime.prisma.bindingChangeLog.findMany({ where: { customer_id: ids.customerIds[0] } }),
        runtime.prisma.attributionCandidate.findUniqueOrThrow({ where: { id: ids.candidateIds[0] } }),
        runtime.prisma.customerProfile.findUniqueOrThrow({ where: { id: ids.customerIds[0] } }),
      ]);
      expect(bindings).toHaveLength(1);
      expect(changes).toHaveLength(1);
      expect(candidate.status).toBe('CONFIRMED');
      expect(customer.version).toBe(2);
    } finally {
      cleanupFullFixture(cleanup, ids);
    }
    await assertNoFixtureFacts(runtime, ids);
    expect(await runtime.prisma.customerAgentBinding.count({
      where: { id: secondBindingId },
    })).toBe(0);
  }, 90_000);
});
