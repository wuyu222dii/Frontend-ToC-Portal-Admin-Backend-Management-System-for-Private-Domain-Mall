import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import { AdminAuthRepository } from './admin-auth.repository';
import { lockReconciledAgentWalletInTransaction } from './agent-finance.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B136_ADMIN_REAUTH_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B136_ADMIN_REAUTH_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const rollbackSentinel = Object.freeze({ code: 'B136_ADMIN_REAUTH_ROLLBACK_SENTINEL' });
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 60_000,
};
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B13.6 Admin REAUTH database tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B13.6 Admin REAUTH tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let databaseName: string;
    let username: string;
    try {
      databaseName = decodeURIComponent(url.pathname.slice(1));
      username = decodeURIComponent(url.username);
    } catch {
      throw new TypeError('B13.6 Admin REAUTH DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B13.6 Admin REAUTH tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b136-admin-reauth-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B13.6 Admin REAUTH tests cannot use the ephemeral PostgreSQL capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b136-admin-reauth-rollback',
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

interface FixtureIds {
  adminAccountId: string;
  agentAccountId: string;
  agentId: string;
  bankAccountId: string;
  bankSnapshotIds: [string, string];
  challengeId: string;
  factorId: string;
  grantIds: [string, string];
  ledgerIds: [string, string, string];
  sessionIds: [string, string];
  walletId: string;
  withdrawalIds: [string, string];
}

function fixtureIds(): FixtureIds {
  return {
    adminAccountId: generateUlid(),
    agentAccountId: generateUlid(),
    agentId: generateUlid(),
    bankAccountId: generateUlid(),
    bankSnapshotIds: [generateUlid(), generateUlid()],
    challengeId: generateUlid(),
    factorId: generateUlid(),
    grantIds: [generateUlid(), generateUlid()],
    ledgerIds: [generateUlid(), generateUlid(), generateUlid()],
    sessionIds: [generateUlid(), generateUlid()],
    walletId: generateUlid(),
    withdrawalIds: [generateUlid(), generateUlid()],
  };
}

async function seedFixture(transaction: DatabaseTransaction, ids: FixtureIds, now: Date): Promise<void> {
  await transaction.account.createMany({
    data: [
      {
        created_at: now,
        id: ids.adminAccountId,
        login_name: `b136-admin-${ids.adminAccountId}`,
        must_change_password: false,
        password_hash: '$argon2id$v=19$m=65536,t=3,p=1$b136-fixture',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        id: ids.agentAccountId,
        login_name: `b136-agent-${ids.agentAccountId}`,
        must_change_password: false,
        password_hash: '$argon2id$v=19$m=65536,t=3,p=1$b136-fixture',
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
    ],
  });
  await transaction.agentProfile.create({
    data: {
      account_id: ids.agentAccountId,
      agent_no: `B136-${ids.agentId.slice(-20)}`,
      created_at: now,
      id: ids.agentId,
      name: 'B13.6 REAUTH Integration Agent',
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  const accountCiphertext = Buffer.from('b136-encrypted-bank-account');
  await transaction.agentBankAccount.create({
    data: {
      account_holder: 'B13.6 Fixture Holder',
      account_no_ciphertext: accountCiphertext,
      account_no_hash: digest('b136-bank-account'),
      account_no_last4: '3456',
      agent_id: ids.agentId,
      bank_name: 'B13.6 Fixture Bank',
      created_at: now,
      deleted_at: null,
      encryption_key_id: 'b136-field-key-v1',
      id: ids.bankAccountId,
      is_active: true,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.agentWallet.create({
    data: {
      agent_id: ids.agentId,
      available_balance: '-100.00',
      frozen_balance: '100.00',
      id: ids.walletId,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.totpFactor.create({
    data: {
      account_id: ids.adminAccountId,
      created_at: now,
      encryption_key_id: 'b136-field-key-v1',
      id: ids.factorId,
      label: 'B13.6 Integration Factor',
      last_used_timestep: 0n,
      secret_ciphertext: Buffer.from('b136-encrypted-secret'),
      secret_fingerprint: digest('b136-factor-secret'),
      status: 'ACTIVE',
      updated_at: now,
      verified_at: now,
    },
  });
  for (const [index, sessionId] of ids.sessionIds.entries()) {
    await transaction.authSession.create({
      data: {
        access_jti: `access:${generateUlid()}`,
        account_id: ids.adminAccountId,
        assurance: 'MFA',
        created_at: now,
        expires_at: new Date(now.getTime() + 60 * 60 * 1_000),
        id: sessionId,
        mfa_factor_id: ids.factorId,
        mfa_verified_at: now,
        refresh_token_hash: digest(`b136-refresh-${index}`),
        restriction: 'NONE',
        rotation_counter: 0,
        session_family: generateUlid(),
      },
    });
  }
  for (const index of [1, 0] as const) {
    const withdrawalId = ids.withdrawalIds[index];
    await transaction.withdrawal.create({
      data: {
        agent_id: ids.agentId,
        amount: '100.00',
        available_before: '200.00',
        created_at: now,
        frozen_after: '100.00',
        id: withdrawalId,
        status: 'PENDING',
        updated_at: now,
        version: 1,
        withdrawal_no: `B136${index}${withdrawalId.slice(-20)}`,
      },
    });
    await transaction.withdrawalBankSnapshot.create({
      data: {
        account_holder: 'B13.6 Fixture Holder',
        account_no_ciphertext: accountCiphertext,
        account_no_last4: '3456',
        bank_name: 'B13.6 Fixture Bank',
        created_at: now,
        encryption_key_id: 'b136-field-key-v1',
        id: ids.bankSnapshotIds[index]!,
        source_bank_account_id: ids.bankAccountId,
        withdrawal_id: withdrawalId,
      },
    });
    await transaction.commissionLedger.create({
      data: {
        agent_id: ids.agentId,
        available_change: '-100.00',
        expected_change: '0.00',
        frozen_change: '100.00',
        id: ids.ledgerIds[index]!,
        idempotency_key: `b136:withdrawal:${withdrawalId}:freeze`,
        ledger_type: 'WITHDRAWAL_FREEZE',
        occurred_at: now,
        reason: 'B13.6_REAUTH_FIXTURE_FREEZE',
        withdrawal_id: withdrawalId,
      },
    });
    await transaction.withdrawal.update({
      data: {
        review_reason: index === 1 ? 'Rejected fixture withdrawal' : null,
        reviewed_at: now,
        reviewed_by_id: ids.adminAccountId,
        status: index === 1 ? 'REJECTED' : 'APPROVED',
        updated_at: now,
        version: { increment: 1 },
      },
      where: { id: withdrawalId },
    });
    if (index === 1) {
      await transaction.commissionLedger.create({
        data: {
          agent_id: ids.agentId,
          available_change: '100.00',
          expected_change: '0.00',
          frozen_change: '-100.00',
          id: ids.ledgerIds[2],
          idempotency_key: `b136:withdrawal:${withdrawalId}:release`,
          ledger_type: 'WITHDRAWAL_RELEASE',
          occurred_at: now,
          reason: 'B13.6_REAUTH_FIXTURE_RELEASE',
          withdrawal_id: withdrawalId,
        },
      });
    }
  }
}

databaseDescribe('B13.6 Admin REAUTH PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  it('rolls back single-use grants, binding failures, expiry, challenge verification and the fifth-failure lock',
    async () => {
      const ids = fixtureIds();
      const initialNow = new Date();
      let now = initialNow;
      const currentSession = {
        accountId: ids.adminAccountId,
        currentSessionId: ids.sessionIds[0],
        factorId: ids.factorId,
      };
      try {
        await expect(runtime.withPrismaTransaction(async (transaction) => {
          const repository = new AdminAuthRepository(transactionBoundPrisma(transaction), () => now);
          await seedFixture(transaction, ids, initialNow);
          const firstHash = digest('b136-first-reauth-grant');
          const first = await repository.createPayoutReauthGrantInTransaction(transaction, {
            acceptedTimestep: 1n,
            ...currentSession,
            expectedAccountVersion: 1,
            expiresAt: new Date(initialNow.getTime() + 60_000),
            grantId: ids.grantIds[0],
            targetId: ids.withdrawalIds[0],
            tokenHash: firstHash,
          });
          expect(first).toEqual({
            expiresAt: new Date(initialNow.getTime() + 60_000),
            grantId: ids.grantIds[0],
          });
          await expect(repository.consumePayoutReauthGrantInTransaction(transaction, {
            ...currentSession,
            targetId: ids.withdrawalIds[0],
            tokenHashCandidates: [firstHash],
          })).resolves.toMatchObject({ grantId: ids.grantIds[0] });
          await expect(repository.consumePayoutReauthGrantInTransaction(transaction, {
            ...currentSession,
            targetId: ids.withdrawalIds[0],
            tokenHashCandidates: [firstHash],
          })).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });

          const secondHash = digest('b136-second-reauth-grant');
          await repository.createPayoutReauthGrantInTransaction(transaction, {
            acceptedTimestep: 2n,
            ...currentSession,
            expectedAccountVersion: 1,
            expiresAt: new Date(initialNow.getTime() + 60_000),
            grantId: ids.grantIds[1],
            targetId: ids.withdrawalIds[0],
            tokenHash: secondHash,
          });
          await expect(repository.consumePayoutReauthGrantInTransaction(transaction, {
            ...currentSession,
            currentSessionId: ids.sessionIds[1],
            targetId: ids.withdrawalIds[0],
            tokenHashCandidates: [secondHash],
          })).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
          await expect(repository.consumePayoutReauthGrantInTransaction(transaction, {
            ...currentSession,
            targetId: ids.withdrawalIds[1],
            tokenHashCandidates: [secondHash],
          })).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });

          const challengeHash = digest('b136-reauth-challenge');
          await repository.createReauthChallengeInTransaction(transaction, {
            accountId: ids.adminAccountId,
            challengeId: ids.challengeId,
            challengeTokenHash: challengeHash,
            currentSessionId: ids.sessionIds[0],
            expiresAt: new Date(initialNow.getTime() + 5 * 60_000),
            expectedAccountVersion: 1,
            factorId: ids.factorId,
            targetId: ids.withdrawalIds[0],
          });
          await expect(repository.getChallengeVerificationContext({
            accountId: ids.adminAccountId,
            challengeId: ids.challengeId,
            challengeTokenHashCandidates: [challengeHash],
            currentSessionId: ids.sessionIds[0],
            purpose: 'REAUTH',
          })).resolves.toMatchObject({ challengeId: ids.challengeId, purpose: 'REAUTH' });
          await expect(repository.completeReauthChallengeInTransaction(transaction, {
            acceptedTimestep: 3n,
            accountId: ids.adminAccountId,
            challengeId: ids.challengeId,
            challengeTokenHashCandidates: [challengeHash],
            currentSessionId: ids.sessionIds[0],
            expectedAccountVersion: 1,
            factorId: ids.factorId,
          })).resolves.toEqual({ verifiedAt: initialNow });

          now = new Date(initialNow.getTime() + 60_001);
          await expect(repository.consumePayoutReauthGrantInTransaction(transaction, {
            ...currentSession,
            targetId: ids.withdrawalIds[0],
            tokenHashCandidates: [secondHash],
          })).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });

          for (let attempt = 1; attempt <= 5; attempt += 1) {
            const result = await repository.recordPayoutReauthFailureInTransaction(transaction, {
              ...currentSession,
              expectedAccountVersion: 1,
              targetId: ids.withdrawalIds[0],
            });
            if (attempt < 5) expect(result).toEqual({ failedAttempts: attempt, kind: 'recorded' });
            else expect(result).toEqual({
              failedAttempts: 5,
              kind: 'locked',
              lockedUntil: new Date(now.getTime() + 15 * 60_000),
            });
          }
          await expect(repository.createReauthChallengeInTransaction(transaction, {
            accountId: ids.adminAccountId,
            challengeId: generateUlid(),
            challengeTokenHash: digest('b136-locked-challenge'),
            currentSessionId: ids.sessionIds[0],
            expiresAt: new Date(now.getTime() + 5 * 60_000),
            expectedAccountVersion: 1,
            factorId: ids.factorId,
          })).rejects.toMatchObject({ code: 'REAUTH_LOCKED' });
          await expect(transaction.mfaRateLimit.findUnique({
            where: { account_id_purpose: { account_id: ids.adminAccountId, purpose: 'REAUTH' } },
          })).resolves.toMatchObject({
            failed_attempts: 5,
            locked_until: new Date(now.getTime() + 15 * 60_000),
          });
          await expect(transaction.adminReauthAttempt.count({
            where: { account_id: ids.adminAccountId },
          })).resolves.toBe(7);
          const wallet = await lockReconciledAgentWalletInTransaction(transaction, ids.agentId);
          expect(wallet.id).toBe(ids.walletId);
          expect(wallet.available_balance.toFixed(2)).toBe('-100.00');
          expect(wallet.frozen_balance.toFixed(2)).toBe('100.00');
          await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
          throw rollbackSentinel;
        }, transactionOptions)).rejects.toBe(rollbackSentinel);
      } finally {
        const [accounts, agents, attempts, banks, challenges, grants, ledgers, snapshots, wallets, withdrawals] =
          await Promise.all([
          runtime.prisma.account.count({ where: { id: { in: [ids.adminAccountId, ids.agentAccountId] } } }),
          runtime.prisma.agentProfile.count({ where: { id: ids.agentId } }),
          runtime.prisma.adminReauthAttempt.count({ where: { account_id: ids.adminAccountId } }),
          runtime.prisma.agentBankAccount.count({ where: { id: ids.bankAccountId } }),
          runtime.prisma.mfaChallenge.count({ where: { id: ids.challengeId } }),
          runtime.prisma.adminReauthGrant.count({ where: { id: { in: ids.grantIds } } }),
          runtime.prisma.commissionLedger.count({ where: { id: { in: ids.ledgerIds } } }),
          runtime.prisma.withdrawalBankSnapshot.count({ where: { id: { in: ids.bankSnapshotIds } } }),
          runtime.prisma.agentWallet.count({ where: { id: ids.walletId } }),
          runtime.prisma.withdrawal.count({ where: { id: { in: ids.withdrawalIds } } }),
        ]);
        expect({ accounts, agents, attempts, banks, challenges, grants, ledgers, snapshots, wallets, withdrawals })
          .toEqual({
          accounts: 0,
          agents: 0,
          attempts: 0,
          banks: 0,
          challenges: 0,
          grants: 0,
          ledgers: 0,
          snapshots: 0,
          wallets: 0,
          withdrawals: 0,
        });
      }
    }, 120_000);
});
