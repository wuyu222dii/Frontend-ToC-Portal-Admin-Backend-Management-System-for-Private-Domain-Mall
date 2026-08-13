import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  AdminAuthRepository,
  type InitialAdminSessionMaterial,
  type RecoveryCodeMaterial,
} from './admin-auth.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B2_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B2_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackSentinel = Object.freeze({ code: 'B2_ROLLBACK_SENTINEL' });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B2 database integration tests`);
  return value;
}

function createIntegrationRuntime(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B2 database tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new TypeError('Full B2 database tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      applicationName: 'qingxu-b2-integration',
      allowInsecureLocalhost: true,
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 16,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B2 database tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b2-rollback',
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

function passwordHash(label: string): string {
  return `$argon2id$v=19$m=65536,t=3,p=1$${digest(label)}`;
}

function sessionMaterial(
  now: Date,
  label: string,
  family = generateUlid(now.getTime()),
): InitialAdminSessionMaterial {
  return {
    id: generateUlid(now.getTime()),
    accessJti: `access:${generateUlid(now.getTime())}`,
    refreshTokenHash: digest(`refresh:${label}`),
    sessionFamily: family,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
  };
}

function recoveryCodes(label: string): RecoveryCodeMaterial[] {
  return Array.from({ length: 8 }, (_, index) => ({
    id: generateUlid(),
    codeHash: digest(`recovery:${label}:${index}`),
  }));
}

databaseDescribe('B2 administrator authentication database integration', () => {
  let runtime: DatabaseRuntime;
  let now = new Date('2026-08-13T01:00:00.000Z');
  let repository: AdminAuthRepository;
  let accountId: string;
  let accountVersion: number;
  let factorId: string;
  let issuedRecoveryCodes: RecoveryCodeMaterial[];

  beforeAll(async () => {
    runtime = createIntegrationRuntime();
    repository = new AdminAuthRepository(runtime.prisma, () => now);
    await runtime.connect();
  }, 30_000);

  afterAll(async () => {
    await runtime?.disconnect();
  }, 30_000);

  rollbackIt('rolls back B2 account, factor, challenge, recovery-code, and session facts on Supabase', async () => {
    const rollbackAccountId = generateUlid(now.getTime());
    const rollbackFactorId = generateUlid(now.getTime());
    const rollbackChallengeId = generateUlid(now.getTime());
    const rollbackCodes = recoveryCodes('rollback');
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await transaction.account.create({
        data: {
          id: rollbackAccountId,
          role: 'SUPER_ADMIN',
          status: 'ACTIVE',
          login_name: `rollback-${generateUlid()}`.slice(0, 80),
          password_hash: passwordHash('rollback'),
          created_at: now,
          updated_at: now,
        },
      });
      await repository.createEnrollmentInTransaction(transaction, {
        accountId: rollbackAccountId,
        factorId: rollbackFactorId,
        challengeId: rollbackChallengeId,
        challengeTokenHash: digest('rollback-challenge'),
        label: 'Rollback authenticator',
        secretCiphertext: Buffer.from('encrypted-test-secret'),
        secretFingerprint: digest('rollback-secret'),
        encryptionKeyId: 'integration-key-v1',
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: 1,
      });
      await repository.completeEnrollmentInTransaction(transaction, {
        accountId: rollbackAccountId,
        challengeId: rollbackChallengeId,
        challengeTokenHashCandidates: [digest('rollback-challenge')],
        factorId: rollbackFactorId,
        acceptedTimestep: 1n,
        recoveryCodes: rollbackCodes,
        session: sessionMaterial(now, 'rollback'),
        expectedAccountVersion: 1,
      });
      throw rollbackSentinel;
    })).rejects.toBe(rollbackSentinel);

    expect(await runtime.prisma.account.count({ where: { id: rollbackAccountId } })).toBe(0);
    expect(await runtime.prisma.totpFactor.count({ where: { id: rollbackFactorId } })).toBe(0);
  }, 30_000);

  fullIt('allows exactly one concurrent bootstrap super administrator', async () => {
    const candidates = [
      { accountId: generateUlid(now.getTime()), loginName: `bootstrap-a-${generateUlid()}`.slice(0, 80) },
      { accountId: generateUlid(now.getTime()), loginName: `bootstrap-b-${generateUlid()}`.slice(0, 80) },
    ];
    const attempts = await Promise.allSettled(candidates.map((candidate, index) =>
      runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.bootstrapSuperAdminInTransaction(transaction, {
          ...candidate,
          passwordHash: passwordHash(`bootstrap-${index}`),
        }), { maxAttempts: 5, initialDelayMs: 5 })));
    const fulfilled = attempts.filter((result) => result.status === 'fulfilled');
    const rejected = attempts.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { code: 'STATE_CONFLICT' } });
    const admins = await runtime.prisma.account.findMany({ where: { role: 'SUPER_ADMIN' } });
    expect(admins).toHaveLength(1);
    accountId = admins[0]?.id as string;
    accountVersion = admins[0]?.version as number;
  }, 30_000);

  fullIt('atomically enrolls TOTP, stores hashed recovery codes, and creates an MFA session', async () => {
    factorId = generateUlid(now.getTime());
    const challengeId = generateUlid(now.getTime());
    issuedRecoveryCodes = recoveryCodes('initial');
    const session = sessionMaterial(now, 'enroll');
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await repository.createEnrollmentInTransaction(transaction, {
        accountId,
        factorId,
        challengeId,
        challengeTokenHash: digest('enroll-challenge'),
        label: 'Integration authenticator',
        secretCiphertext: Buffer.from('encrypted-integration-secret'),
        secretFingerprint: digest('integration-secret'),
        encryptionKeyId: 'integration-key-v1',
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      });
      await repository.completeEnrollmentInTransaction(transaction, {
        accountId,
        challengeId,
        challengeTokenHashCandidates: [digest('enroll-challenge')],
        factorId,
        acceptedTimestep: 100n,
        recoveryCodes: issuedRecoveryCodes,
        session,
        expectedAccountVersion: accountVersion,
      });
    });
    const [factor, codes, storedSession] = await Promise.all([
      runtime.prisma.totpFactor.findUnique({ where: { id: factorId } }),
      runtime.prisma.totpRecoveryCode.findMany({ where: { factor_id: factorId } }),
      runtime.prisma.authSession.findUnique({ where: { id: session.id } }),
    ]);
    expect(factor).toMatchObject({ status: 'ACTIVE', last_used_timestep: 100n });
    expect(codes).toHaveLength(8);
    expect(codes.every(({ code_hash }) => /^[a-f0-9]{64}$/.test(code_hash))).toBe(true);
    expect(storedSession).toMatchObject({ assurance: 'MFA', restriction: 'NONE', mfa_factor_id: factorId });
  }, 30_000);

  fullIt('persists five failures across challenges, locks for fifteen minutes, and blocks challenge renewal', async () => {
    expect(await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.recordAuthenticationFailureInTransaction(transaction, {
        accountId,
        expectedAccountVersion: accountVersion,
        purpose: 'LOGIN',
      }))).toEqual({ kind: 'recorded', failedAttempts: 1 });
    const firstChallengeId = generateUlid(now.getTime());
    await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: firstChallengeId,
        challengeTokenHash: digest('login-failure-one'),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      }));
    for (let attempt = 2; attempt <= 2; attempt += 1) {
      const result = await runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.recordAuthenticationFailureInTransaction(transaction, {
          accountId,
          challengeId: firstChallengeId,
          expectedAccountVersion: accountVersion,
          purpose: 'LOGIN',
        }));
      expect(result).toEqual({ kind: 'recorded', failedAttempts: attempt });
    }

    const secondChallengeId = generateUlid(now.getTime());
    await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: secondChallengeId,
        challengeTokenHash: digest('login-failure-two'),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      }));
    for (let attempt = 3; attempt <= 5; attempt += 1) {
      const result = await runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.recordAuthenticationFailureInTransaction(transaction, {
          accountId,
          challengeId: secondChallengeId,
          expectedAccountVersion: accountVersion,
          purpose: 'LOGIN',
        }));
      if (attempt < 5) expect(result).toEqual({ kind: 'recorded', failedAttempts: attempt });
      else expect(result).toEqual({
        kind: 'locked',
        failedAttempts: 5,
        lockedUntil: new Date(now.getTime() + 15 * 60 * 1_000),
      });
    }
    const rate = await runtime.prisma.mfaRateLimit.findUnique({
      where: { account_id_purpose: { account_id: accountId, purpose: 'LOGIN' } },
    });
    expect(rate).toMatchObject({ failed_attempts: 5, locked_until: new Date(now.getTime() + 15 * 60 * 1_000) });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: generateUlid(now.getTime()),
        challengeTokenHash: digest('must-be-blocked'),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      }))).rejects.toMatchObject({ code: 'RATE_LIMITED' });

    now = new Date(now.getTime() + 15 * 60 * 1_000 + 1);
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: generateUlid(now.getTime()),
        challengeTokenHash: digest('after-lock-expiry'),
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      }))).resolves.toMatchObject({ status: 'PENDING' });
  }, 30_000);

  fullIt('accepts a TOTP timestep once and rejects its replay through a later challenge', async () => {
    const acceptedChallengeId = generateUlid(now.getTime());
    const acceptedTokenHash = digest('accepted-timestep');
    const acceptedSession = sessionMaterial(now, 'accepted-timestep');
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: acceptedChallengeId,
        challengeTokenHash: acceptedTokenHash,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      });
      await repository.completeLoginTotpInTransaction(transaction, {
        accountId,
        challengeId: acceptedChallengeId,
        challengeTokenHashCandidates: [digest('old-key-accepted-timestep'), acceptedTokenHash],
        acceptedTimestep: 101n,
        session: acceptedSession,
        expectedAccountVersion: accountVersion,
      });
    });

    const replayChallengeId = generateUlid(now.getTime());
    const replayTokenHash = digest('replayed-timestep');
    await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: replayChallengeId,
        challengeTokenHash: replayTokenHash,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      }));
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.completeLoginTotpInTransaction(transaction, {
        accountId,
        challengeId: replayChallengeId,
        challengeTokenHashCandidates: [digest('old-key-replayed-timestep'), replayTokenHash],
        acceptedTimestep: 101n,
        session: sessionMaterial(now, 'must-not-exist'),
        expectedAccountVersion: accountVersion,
      }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(await runtime.prisma.totpFactor.findUnique({ where: { id: factorId } }))
      .toMatchObject({ last_used_timestep: 101n });
  }, 30_000);

  fullIt('consumes a recovery code once and cannot use it for a later login', async () => {
    const recoveryCode = issuedRecoveryCodes[0] as RecoveryCodeMaterial;
    const firstChallengeId = generateUlid(now.getTime());
    const firstTokenHash = digest('recovery-first');
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: firstChallengeId,
        challengeTokenHash: firstTokenHash,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      });
      const result = await repository.completeLoginRecoveryInTransaction(transaction, {
        accountId,
        challengeId: firstChallengeId,
        challengeTokenHashCandidates: [digest('old-key-recovery-first'), firstTokenHash],
        recoveryCodeHashCandidates: [digest('old-key-recovery-code'), recoveryCode.codeHash],
        session: sessionMaterial(now, 'recovery-first'),
        expectedAccountVersion: accountVersion,
      });
      expect(result).toMatchObject({ kind: 'authenticated' });
    });
    expect(await runtime.prisma.totpRecoveryCode.findUnique({ where: { id: recoveryCode.id } }))
      .toMatchObject({ consumed_at: now });

    const replayChallengeId = generateUlid(now.getTime());
    const replayTokenHash = digest('recovery-replay');
    await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createLoginChallengeInTransaction(transaction, {
        accountId,
        challengeId: replayChallengeId,
        challengeTokenHash: replayTokenHash,
        expiresAt: new Date(now.getTime() + 5 * 60 * 1_000),
        expectedAccountVersion: accountVersion,
      }));
    const failedSession = sessionMaterial(now, 'recovery-must-not-exist');
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.completeLoginRecoveryInTransaction(transaction, {
        accountId,
        challengeId: replayChallengeId,
        challengeTokenHashCandidates: [replayTokenHash],
        recoveryCodeHashCandidates: [recoveryCode.codeHash],
        session: failedSession,
        expectedAccountVersion: accountVersion,
      }))).resolves.toEqual({ kind: 'recorded', failedAttempts: 1 });
    expect(await runtime.prisma.mfaRateLimit.findUnique({
      where: { account_id_purpose: { account_id: accountId, purpose: 'LOGIN' } },
    })).toMatchObject({ failed_attempts: 1, locked_until: null });
    expect(await runtime.prisma.authSession.findUnique({
      where: { id: failedSession.id },
    })).toBeNull();
  }, 30_000);

  fullIt('rotates refresh sessions and revokes the whole family when an old token is replayed', async () => {
    const source = await runtime.prisma.authSession.findFirst({
      where: { account_id: accountId, revoked_at: null },
      orderBy: { created_at: 'desc' },
    });
    expect(source?.refresh_token_hash).toBeTruthy();
    const next = sessionMaterial(now, 'refresh-next', source?.session_family);
    const rotated = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: [digest('old-key-refresh'), source?.refresh_token_hash as string],
        session: next,
      }));
    expect(rotated).toMatchObject({ kind: 'rotated', rotationCounter: (source?.rotation_counter ?? 0) + 1 });
    expect(await repository.getCurrentSession({ sessionId: next.id, accessJti: next.accessJti }))
      .toMatchObject({ accountId, sessionFamily: source?.session_family });

    const replay = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: [source?.refresh_token_hash as string],
        session: sessionMaterial(now, 'refresh-must-not-exist', source?.session_family),
      }));
    expect(replay).toEqual({ kind: 'replay_detected', sessionFamily: source?.session_family });
    expect(await runtime.prisma.authSession.count({
      where: { session_family: source?.session_family, revoked_at: null },
    })).toBe(0);
    await expect(repository.getCurrentSession({ sessionId: next.id, accessJti: next.accessJti }))
      .resolves.toBeNull();
  }, 30_000);
});
