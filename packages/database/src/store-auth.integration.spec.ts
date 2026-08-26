import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import {
  StoreAuthRepository,
  type InitialStoreSessionMaterial,
  type StoreLoginConsentMaterial,
  type StoreSessionMaterial,
} from './store-auth.repository';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B7_STORE_AUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B7_STORE_AUTH_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 60_000,
};
const rollbackSentinel = Object.freeze({ code: 'B7_STORE_AUTH_ROLLBACK_SENTINEL' });

interface FixtureIds {
  accountIds: string[];
  consentIds: string[];
  customerIds: string[];
  sessionIds: string[];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B7 Store auth database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B7 Store auth tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B7 Store auth tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b7-store-auth-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B7 Store auth tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b7-store-auth-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionMaterial(
  now: Date,
  label: string,
  family = generateUlid(now.getTime()),
): InitialStoreSessionMaterial {
  return {
    id: generateUlid(now.getTime()),
    accessJti: `access:${generateUlid(now.getTime())}`,
    refreshTokenHash: digest(`refresh:${label}`),
    sessionFamily: family,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
  };
}

function consentTuple(now: Date, label: string): readonly [StoreLoginConsentMaterial, StoreLoginConsentMaterial] {
  return [
    {
      id: generateUlid(now.getTime()),
      type: 'USER_AGREEMENT',
      documentVersion: `b7-user-agreement-${label}`,
    },
    {
      id: generateUlid(now.getTime()),
      type: 'PRIVACY_POLICY',
      documentVersion: `b7-privacy-policy-${label}`,
    },
  ];
}

function transactionRepository(transaction: DatabaseTransaction, now: Date): StoreAuthRepository {
  return new StoreAuthRepository(transaction as unknown as PrismaClient, () => now);
}

databaseDescribe('B7 Store authentication database integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function assertNoFixtureFacts(ids: FixtureIds): Promise<void> {
    await expect(Promise.all([
      runtime.prisma.authSession.count({ where: { id: { in: ids.sessionIds } } }),
      runtime.prisma.consentRecord.count({ where: { id: { in: ids.consentIds } } }),
      runtime.prisma.customerProfile.count({ where: { id: { in: ids.customerIds } } }),
      runtime.prisma.account.count({ where: { id: { in: ids.accountIds } } }),
    ])).resolves.toEqual([0, 0, 0, 0]);
  }

  async function exerciseStoreAuthRollback(): Promise<void> {
    const now = new Date();
    const proposedAccountId = generateUlid(now.getTime());
    const proposedCustomerId = generateUlid(now.getTime());
    const reuseAccountId = generateUlid(now.getTime());
    const reuseCustomerId = generateUlid(now.getTime());
    const openId = `b7-openid-${generateUlid(now.getTime())}`;
    const firstConsents = consentTuple(now, 'first');
    const secondConsents = consentTuple(now, 'second');
    const firstSession = sessionMaterial(now, 'first');
    const rotatedSession: StoreSessionMaterial = sessionMaterial(now, 'rotated', firstSession.sessionFamily);
    const replayCandidate: StoreSessionMaterial = sessionMaterial(now, 'replay', firstSession.sessionFamily);
    const secondSession = sessionMaterial(now, 'second');
    const ids: FixtureIds = {
      accountIds: [proposedAccountId, reuseAccountId],
      consentIds: [...firstConsents, ...secondConsents].map(({ id }) => id),
      customerIds: [proposedCustomerId, reuseCustomerId],
      sessionIds: [firstSession.id, rotatedSession.id, replayCandidate.id, secondSession.id],
    };

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      const repository = transactionRepository(transaction, now);
      const resolved = await repository.resolveCustomerInTransaction(transaction, {
        accountId: proposedAccountId,
        customerId: proposedCustomerId,
        openId,
        unionId: `b7-union-${generateUlid(now.getTime())}`,
      });
      expect(resolved).toMatchObject({
        accountId: proposedAccountId,
        customerId: proposedCustomerId,
        created: true,
      });

      const reused = await repository.resolveCustomerInTransaction(transaction, {
        accountId: reuseAccountId,
        customerId: reuseCustomerId,
        openId,
      });
      expect(reused).toMatchObject({
        accountId: proposedAccountId,
        customerId: proposedCustomerId,
        created: false,
      });
      expect(await transaction.account.count({ where: { wechat_open_id: openId } })).toBe(1);
      expect(await transaction.customerProfile.count({ where: { account_id: proposedAccountId } })).toBe(1);

      await expect(repository.createLoginSessionInTransaction(transaction, {
        accountId: resolved.accountId,
        customerId: resolved.customerId,
        sourceTerminal: 'MP_WEIXIN',
        consents: firstConsents,
        session: firstSession,
      })).resolves.toMatchObject({
        accountId: proposedAccountId,
        customerId: proposedCustomerId,
        session: { assurance: 'WECHAT', restriction: 'NONE', rotation_counter: 0 },
      });
      await expect(repository.findRefreshActor([firstSession.refreshTokenHash]))
        .resolves.toBe(proposedAccountId);
      await expect(repository.getCurrentSession({
        sessionId: firstSession.id,
        accessJti: firstSession.accessJti,
      })).resolves.toMatchObject({
        accountId: proposedAccountId,
        customerId: proposedCustomerId,
        sessionFamily: firstSession.sessionFamily,
      });

      await expect(repository.rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: [firstSession.refreshTokenHash],
        session: rotatedSession,
      })).resolves.toEqual({
        kind: 'rotated',
        rotationCounter: 1,
        sessionFamily: firstSession.sessionFamily,
        sessionId: rotatedSession.id,
      });
      await expect(repository.getCurrentSession({
        sessionId: rotatedSession.id,
        accessJti: rotatedSession.accessJti,
      })).resolves.toMatchObject({ sessionFamily: firstSession.sessionFamily });

      await expect(repository.rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: [firstSession.refreshTokenHash],
        session: replayCandidate,
      })).resolves.toEqual({ kind: 'replay_detected', sessionFamily: firstSession.sessionFamily });
      expect(await transaction.authSession.count({
        where: { session_family: firstSession.sessionFamily, revoked_at: null },
      })).toBe(0);
      await expect(repository.getCurrentSession({
        sessionId: rotatedSession.id,
        accessJti: rotatedSession.accessJti,
      })).resolves.toBeNull();
      expect(await transaction.authSession.findUnique({ where: { id: replayCandidate.id } })).toBeNull();

      await repository.createLoginSessionInTransaction(transaction, {
        accountId: resolved.accountId,
        customerId: resolved.customerId,
        sourceTerminal: 'MP_WEIXIN',
        consents: secondConsents,
        session: secondSession,
      });
      await expect(repository.revokeCurrentSessionInTransaction(transaction, {
        accountId: resolved.accountId,
        sessionFamily: secondSession.sessionFamily,
        sessionId: secondSession.id,
      })).resolves.toEqual({ revoked: true });
      await expect(repository.getCurrentSession({
        sessionId: secondSession.id,
        accessJti: secondSession.accessJti,
      })).resolves.toBeNull();

      const account = await transaction.account.findUnique({
        where: { id: proposedAccountId },
        include: { customer_profile: true },
      });
      expect(account).toMatchObject({
        role: 'CUSTOMER',
        status: 'ACTIVE',
        login_name: null,
        password_hash: null,
        customer_profile: { id: proposedCustomerId, anonymized_at: null },
      });
      const consents = await transaction.consentRecord.findMany({
        where: { id: { in: ids.consentIds } },
      });
      expect(consents).toHaveLength(4);
      expect(consents.every(({ accepted, source_terminal }) => accepted && source_terminal === 'MP_WEIXIN'))
        .toBe(true);
      expect(consents.filter(({ consent_type }) => consent_type === 'USER_AGREEMENT')).toHaveLength(2);
      expect(consents.filter(({ consent_type }) => consent_type === 'PRIVACY_POLICY')).toHaveLength(2);
      expect(await transaction.authSession.count({
        where: { id: { in: [firstSession.id, rotatedSession.id, secondSession.id] } },
      })).toBe(3);
      expect(await transaction.authSession.count({
        where: {
          id: { in: [firstSession.id, rotatedSession.id, secondSession.id] },
          assurance: 'WECHAT',
          restriction: 'NONE',
          revoked_at: null,
        },
      })).toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await assertNoFixtureFacts(ids);
  }

  fullIt('uses PostgreSQL locks and leaves no Store identity or session facts after rollback', async () => {
    await exerciseStoreAuthRollback();
  }, 90_000);

  rollbackIt('executes Store identity and session rotation on Supabase without residue', async () => {
    await exerciseStoreAuthRollback();
  }, 90_000);
});
