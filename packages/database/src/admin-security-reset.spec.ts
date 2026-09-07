import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AdminAuthRepository, type OfflineOperatorProof, type OfflineRecoveryCommand } from './admin-auth.repository';
import { AuditRepository } from './audit.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

const databaseUrl = process.env.B19_TEST_DATABASE_URL;
const databaseDescribe = databaseUrl ? describe : describe.skip;
const passwordHash = '$argon2id$v=19$m=65536,t=3,p=1$b19-synthetic-fixture';
const changedHash = `${passwordHash}-changed`;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

interface Actor { id: string; factorId: string; sessionIds: string[]; codeHashes: string[] }

databaseDescribe('B19 security reset with real PostgreSQL guards', () => {
  let runtime: DatabaseRuntime;
  let repository: AdminAuthRepository;
  const audit = new AuditRepository(Buffer.alloc(32, 19));
  const run = (input: OfflineRecoveryCommand) => runSerializableTransaction(runtime.prisma,
    (tx) => repository.runOfflineRecoveryInTransaction(tx, input, audit, `req_${digest(generateUlid()).slice(0, 32)}`));
  const proof = (actor: Actor): OfflineOperatorProof => ({ accountId: actor.id, expectedVersion: 1,
    expectedPasswordHash: passwordHash, passwordVerified: true, factorId: actor.factorId,
    credentialType: 'RECOVERY_CODE', credentialHashCandidates: [actor.codeHashes.shift()!] });

  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (process.env.NODE_ENV !== 'test' || !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.pathname !== '/qingxu_b19_test' || url.username !== 'mall_runtime' || url.search || url.hash) {
      throw new Error('B19 checks require an explicitly selected isolated loopback test database');
    }
    runtime = createDatabaseRuntime({ databaseUrl: databaseUrl!, allowInsecureLocalhost: true,
      applicationName: 'qingxu-b19-targeted-check', connectionTimeoutMs: 3000, poolMax: 5 });
    await runtime.connect();
    repository = new AdminAuthRepository(runtime.prisma);
  });
  afterAll(async () => runtime?.disconnect());

  async function seedActor(tx: DatabaseTransaction): Promise<Actor> {
    const id = generateUlid();
    const factorId = generateUlid();
    const sessionIds = [generateUlid(), generateUlid()];
    const codeHashes = Array.from({ length: 16 }, (_, index) => digest(`${id}:${index}`));
    const now = new Date();
    await tx.account.create({ data: { id, login_name: `b19-${id}`, password_hash: passwordHash,
      role: 'SUPER_ADMIN', status: 'ACTIVE', must_change_password: false } });
    await tx.totpFactor.create({ data: { id: factorId, account_id: id, status: 'ACTIVE',
      label: 'B19 synthetic factor', secret_ciphertext: Buffer.from('b19-synthetic-ciphertext'),
      encryption_key_id: 'b19-test-key', secret_fingerprint: digest(factorId), verified_at: now } });
    await tx.totpRecoveryCode.createMany({ data: codeHashes.map((hash) => ({ id: generateUlid(), factor_id: factorId, code_hash: hash })) });
    for (const sessionId of sessionIds) {
      await tx.authSession.create({ data: { id: sessionId, account_id: id, assurance: 'MFA', restriction: 'NONE',
        access_jti: `b19:${sessionId}`, refresh_token_hash: digest(sessionId), session_family: generateUlid(),
        mfa_factor_id: factorId, mfa_verified_at: now, expires_at: new Date(now.getTime() + 3_600_000) } });
    }
    await tx.mfaChallenge.create({ data: { id: generateUlid(), account_id: id, factor_id: factorId,
      purpose: 'LOGIN', challenge_token_hash: digest(`${id}:challenge`), expires_at: new Date(now.getTime() + 300_000) } });
    return { id, factorId, sessionIds, codeHashes };
  }

  async function fixture(withGrant = false) {
    return runSerializableTransaction(runtime.prisma, async (tx) => {
      const target = await seedActor(tx);
      const requester = await seedActor(tx);
      const first = await seedActor(tx);
      const second = await seedActor(tx);
      const rejector = await seedActor(tx);
      let grantId: string | null = null;
      if (withGrant) {
        const now = new Date();
        const agentAccountId = generateUlid();
        const agentId = generateUlid();
        const bankId = generateUlid();
        const withdrawalId = generateUlid();
        const bank = { account_holder: 'B19 synthetic holder', bank_name: 'B19 fixture bank',
          account_no_ciphertext: Buffer.from('b19-synthetic-bank-ciphertext'), account_no_last4: '0019', encryption_key_id: 'b19-test-key' };
        await tx.account.create({ data: { id: agentAccountId, role: 'AGENT_ADMIN', status: 'ACTIVE',
          login_name: `b19-${agentAccountId}`, password_hash: passwordHash } });
        await tx.agentProfile.create({ data: { id: agentId, account_id: agentAccountId, agent_no: `B19${agentId}`, name: 'B19 synthetic agent' } });
        await tx.agentWallet.create({ data: { id: generateUlid(), agent_id: agentId, available_balance: '-1.00', frozen_balance: '1.00' } });
        await tx.agentBankAccount.create({ data: { id: bankId, agent_id: agentId, ...bank, account_no_hash: digest(bankId) } });
        await tx.withdrawal.create({ data: { id: withdrawalId, agent_id: agentId, withdrawal_no: `B19${withdrawalId}`,
          amount: '1.00', available_before: '1.00', frozen_after: '1.00' } });
        await tx.withdrawalBankSnapshot.create({ data: { id: generateUlid(), withdrawal_id: withdrawalId, source_bank_account_id: bankId, ...bank } });
        await tx.commissionLedger.create({ data: { id: generateUlid(), agent_id: agentId, withdrawal_id: withdrawalId,
          ledger_type: 'WITHDRAWAL_FREEZE', available_change: '-1.00', expected_change: '0.00', frozen_change: '1.00',
          reason: 'B19_SYNTHETIC_FIXTURE', idempotency_key: `b19:${withdrawalId}`, occurred_at: now } });
        await tx.withdrawal.update({ where: { id: withdrawalId }, data: { status: 'APPROVED', reviewed_by_id: target.id,
          reviewed_at: now, version: { increment: 1 } } });
        grantId = generateUlid();
        await tx.adminReauthGrant.create({ data: { id: grantId, account_id: target.id, session_id: target.sessionIds[0]!,
          action: 'PAYOUT_ACCOUNT_REVEAL', target_id: withdrawalId, token_hash: digest(grantId), created_at: now,
          expires_at: new Date(now.getTime() + 60_000) } });
      }
      return { target, requester, first, second, rejector, grantId };
    });
  }

  async function approvedTicket(f: Awaited<ReturnType<typeof fixture>>) {
    const requested = await run({ command: 'request', targetAccountId: f.target.id, reason: 'Synthetic recovery', operator: proof(f.requester) });
    expect(requested).toMatchObject({ kind: 'success', record: { targetAccountVersion: 1, version: 1 } });
    const recoveryId = requested.record!.id;
    expect((await run({ command: 'approve', recoveryId, reason: 'Synthetic approval', operator: proof(f.first) })).record?.version).toBe(2);
    const approved = await run({ command: 'approve', recoveryId, reason: 'Synthetic approval', operator: proof(f.second) });
    expect(approved).toMatchObject({ kind: 'success', record: { status: 'APPROVED', version: 3 } });
    return recoveryId;
  }

  it.each([[true, false], [false, true], [true, true]])('commits online reset password=%s totp=%s with an ACTIVE grant', async (resetPassword, resetTotp) => {
    const f = await fixture(true);
    const input = { accountId: f.target.id, currentSessionId: f.target.sessionIds[0]!, factorId: f.target.factorId,
      expectedVersion: 1, credentialType: 'RECOVERY_CODE' as const, credentialHashCandidates: [f.target.codeHashes[0]!],
      resetPassword, resetTotp, ...(resetPassword ? { newPasswordHash: changedHash } : {}) };
    await expect(runSerializableTransaction(runtime.prisma, (tx) => repository.resetSecurityInTransaction(tx, {
      ...input, accountId: f.requester.id,
    }))).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    await expect(runSerializableTransaction(runtime.prisma, (tx) => repository.resetSecurityInTransaction(tx, {
      ...input, expectedVersion: 2,
    }))).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    await expect(runSerializableTransaction(runtime.prisma, (tx) => repository.resetSecurityInTransaction(tx, input)))
      .resolves.toMatchObject({ kind: 'reset', version: 2 });
    expect(await runtime.prisma.adminReauthGrant.findUnique({ where: { id: f.grantId! } })).toMatchObject({ status: 'REVOKED', consumed_at: null });
    expect(await runtime.prisma.authSession.count({ where: { account_id: f.target.id, revoked_at: null } })).toBe(0);
    expect(await runtime.prisma.mfaChallenge.count({ where: { account_id: f.target.id, status: { not: 'EXPIRED' } } })).toBe(0);
    expect(await runtime.prisma.totpFactor.findUnique({ where: { id: f.target.factorId } })).toMatchObject({ status: resetTotp ? 'REVOKED' : 'ACTIVE' });
    expect(await runtime.prisma.totpRecoveryCode.count({ where: { factor_id: f.target.factorId, consumed_at: null } })).toBe(resetTotp ? 0 : 15);
    expect(await runtime.prisma.account.findUnique({ where: { id: f.target.id } })).toMatchObject({ password_hash: resetPassword ? changedHash : passwordHash });
    expect(await repository.getCurrentSession({ sessionId: f.target.sessionIds[0]!, accessJti: `b19:${f.target.sessionIds[0]}` })).toBeNull();
  });

  it('executes once, freezes both versions, revokes all credentials and rejects stale approvals and self-approval', async () => {
    const f = await fixture(true);
    expect((await run({ command: 'request', targetAccountId: f.target.id, reason: 'Forbidden self request', operator: proof(f.target) })).kind).toBe('conflict');
    const recoveryId = await approvedTicket(f);
    for (const actor of [f.target, f.requester, f.first]) {
      expect((await run({ command: 'approve', recoveryId, reason: 'Repeated approval', operator: proof(actor) })).kind).toBe('conflict');
    }
    const execute = { command: 'execute' as const, recoveryId, expectedRecoveryVersion: 3,
      newPasswordHash: changedHash, credentialFingerprint: digest('b19-new-credential') };
    expect((await run({ ...execute, expectedRecoveryVersion: 1, operator: proof(f.requester) })).resultCode).toBe('OFFLINE_RECOVERY_VERSION_CONFLICT');
    const outcomes = await Promise.all([run({ ...execute, operator: proof(f.requester) }), run({ ...execute, operator: proof(f.rejector) })]);
    expect(outcomes.map((result) => result.kind).sort()).toEqual(['success', 'terminal']);
    expect(await runtime.prisma.account.findUnique({ where: { id: f.target.id } })).toMatchObject({ version: 2, password_hash: changedHash });
    expect(await runtime.prisma.adminOfflineRecovery.findUnique({ where: { id: recoveryId } })).toMatchObject({ status: 'EXECUTED', version: 4 });
    expect(await runtime.prisma.adminReauthGrant.findUnique({ where: { id: f.grantId! } })).toMatchObject({ status: 'REVOKED', consumed_at: null });
    expect(await runtime.prisma.authSession.count({ where: { account_id: f.target.id, revoked_at: null } })).toBe(0);
    expect(await runtime.prisma.totpRecoveryCode.count({ where: { factor_id: f.target.factorId, consumed_at: null } })).toBe(0);
  });

  it('commits expiry and invalidation before errors and releases the one-active-ticket slot', async () => {
    for (const cause of ['clock', 'target-version', 'approver-disabled'] as const) {
      const f = await fixture();
      let recoveryId: string;
      if (cause === 'clock') {
        recoveryId = generateUlid();
        await runtime.prisma.adminOfflineRecovery.create({ data: { id: recoveryId, target_account_id: f.target.id,
          requested_by_id: f.requester.id, target_account_version: 1, reason: 'Expired synthetic history',
          created_at: new Date(Date.now() - 120_000), expires_at: new Date(Date.now() - 60_000) } });
      } else {
        recoveryId = await approvedTicket(f);
        await runtime.prisma.account.update({ where: { id: cause === 'target-version' ? f.target.id : f.first.id },
          data: { version: { increment: 1 }, ...(cause === 'approver-disabled' ? { status: 'DISABLED' as const } : {}) } });
      }
      const invalid = await run({ command: 'execute', recoveryId, expectedRecoveryVersion: 3,
        newPasswordHash: changedHash, credentialFingerprint: digest('b19-expired'), operator: proof(f.requester) });
      expect(invalid.kind).toBe('expired');
      expect(await runtime.prisma.adminOfflineRecovery.findUnique({ where: { id: recoveryId } })).toMatchObject({ status: 'EXPIRED' });
      expect((await run({ command: 'request', targetAccountId: f.target.id, reason: 'New synthetic request', operator: proof(f.requester) })).kind).toBe('success');
      expect(await runtime.prisma.adminOfflineRecovery.count({ where: { target_account_id: f.target.id,
        status: { in: ['PENDING_APPROVAL', 'APPROVED'] } } })).toBe(1);
    }
  });

  it('retires stale work during request and permits rejecting approved work without deleting approvals', async () => {
    const f = await fixture();
    const recoveryId = await approvedTicket(f);
    expect((await run({ command: 'reject', recoveryId, reason: 'Cancel synthetic recovery', operator: proof(f.rejector) })).record)
      .toMatchObject({ status: 'REJECTED', version: 4 });
    expect(await runtime.prisma.adminOfflineRecoveryApproval.count({ where: { recovery_id: recoveryId } })).toBe(3);
    const next = await run({ command: 'request', targetAccountId: f.target.id, reason: 'New synthetic recovery', operator: proof(f.requester) });
    await runtime.prisma.account.update({ where: { id: f.target.id }, data: { version: { increment: 1 } } });
    expect((await run({ command: 'request', targetAccountId: f.target.id, reason: 'Replace stale recovery', operator: proof(f.requester) })).record)
      .toMatchObject({ status: 'PENDING_APPROVAL', targetAccountVersion: 2 });
    expect(await runtime.prisma.adminOfflineRecovery.findUnique({ where: { id: next.record!.id } })).toMatchObject({ status: 'EXPIRED' });
  });

  it('atomically consumes TOTP/recovery codes and shares the five-failure fifteen-minute RECOVERY lock', async () => {
    const f = await fixture();
    const totp = { ...proof(f.requester), credentialType: 'TOTP' as const, acceptedTimestep: BigInt(Math.floor(Date.now() / 30_000)) };
    const request = { command: 'request' as const, targetAccountId: f.target.id, reason: 'Synthetic request' };
    expect((await run({ ...request, operator: totp })).kind).toBe('success');
    expect((await run({ ...request, operator: totp })).kind).toBe('invalid');
    const code = proof(f.first);
    expect((await run({ ...request, operator: code })).kind).toBe('conflict');
    expect((await run({ ...request, operator: code })).kind).toBe('invalid');
    const online = { accountId: f.first.id, currentSessionId: f.first.sessionIds[0]!, factorId: f.first.factorId,
      expectedVersion: 1, credentialType: 'RECOVERY_CODE' as const, credentialHashCandidates: code.credentialHashCandidates!,
      resetPassword: false, resetTotp: true };
    for (let attempt = 2; attempt <= 5; attempt++) {
      const failure = await runSerializableTransaction(runtime.prisma, (tx) => repository.resetSecurityInTransaction(tx, online));
      expect(failure.kind).toBe(attempt === 5 ? 'locked' : 'recorded');
    }
    const bucket = await runtime.prisma.mfaRateLimit.findUnique({ where: { account_id_purpose: { account_id: f.first.id, purpose: 'RECOVERY' } } });
    expect(bucket?.failed_attempts).toBe(5);
    expect(bucket!.locked_until!.getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect((await run({ ...request, operator: proof(f.first) })).kind).toBe('locked');
  });
});
