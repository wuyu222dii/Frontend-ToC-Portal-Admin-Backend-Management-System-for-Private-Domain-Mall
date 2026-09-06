import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

import { loadPlatformConfig } from '@qingxu/config';
import {
  AdminAuthRepository,
  AuditRepository,
  createDatabaseRuntime,
  runSerializableTransaction,
} from '@qingxu/database';
import {
  createEncryptionContext,
  decryptEnvelopeText,
  generateUlid,
  hashPassword,
  hmacAuthenticationSecret,
  verifyPasswordHash,
  verifyTotpCode,
  type EncryptedEnvelope,
} from '@qingxu/platform-core';
import { readBootstrapPasswordFile } from './bootstrap-super-admin.cli.js';

function hiddenQuestion(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Offline recovery requires a TTY');
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  process.stderr.write(prompt);
  const readline = createInterface({ input: process.stdin, output: muted, terminal: true });
  return readline.question('').finally(() => { readline.close(); process.stderr.write('\n'); });
}

async function readSecret(prompt: string, fileEnv: string): Promise<string> {
  const path = process.env[fileEnv];
  return path ? readBootstrapPasswordFile(path) : hiddenQuestion(prompt);
}

function arg(index: number, label: string): string {
  const value = process.argv[index];
  if (!value || value.length > 500) throw new Error(`${label} is required`);
  return value;
}

function envelope(value: Uint8Array): EncryptedEnvelope {
  const parsed = JSON.parse(Buffer.from(value).toString('utf8')) as Record<string, unknown>;
  if (parsed.version !== 1 || parsed.algorithm !== 'AES-256-GCM' ||
    !['authTag', 'ciphertext', 'iv', 'keyId'].every((key) => typeof parsed[key] === 'string')) {
    throw new Error('TOTP secret is unreadable');
  }
  return parsed as unknown as EncryptedEnvelope;
}

async function operator(config: ReturnType<typeof loadPlatformConfig>, database: ReturnType<typeof createDatabaseRuntime>, accountId: string) {
  const account = await database.prisma.account.findUnique({
    where: { id: accountId }, include: { totp_factors: { where: { status: 'ACTIVE' }, take: 1 } },
  });
  const factor = account?.totp_factors[0];
  if (!account || account.role !== 'SUPER_ADMIN' || account.status !== 'ACTIVE' || !account.password_hash || !factor) {
    throw new Error('Operator account is unavailable');
  }
  const password = await readSecret('Operator password: ', 'OFFLINE_RECOVERY_OPERATOR_PASSWORD_FILE');
  const code = await readSecret('Operator TOTP: ', 'OFFLINE_RECOVERY_OPERATOR_TOTP_FILE');
  if (!(await verifyPasswordHash(account.password_hash, password))) throw new Error('Operator authentication failed');
  const secret = decryptEnvelopeText(envelope(factor.secret_ciphertext), (keyId) => {
    const key = [config.encryption.fieldKeys.current, ...config.encryption.fieldKeys.previous].find((entry) => entry.id === keyId);
    if (!key) throw new Error('TOTP encryption key is unavailable');
    return key.key;
  }, createEncryptionContext('totp_factor', factor.id, 'secret_ciphertext'));
  const verification = await verifyTotpCode(secret, code);
  if (!verification.valid) throw new Error('Operator authentication failed');
  return { account, factor, timestep: verification.timestep };
}

async function main(): Promise<void> {
  const command = arg(2, 'command');
  if (!['request', 'approve', 'reject', 'execute'].includes(command)) throw new Error('Command must be request, approve, reject, or execute');
  const config = loadPlatformConfig(process.env, { service: 'api', requireDatabase: true, requireEncryption: true, requireStorage: false });
  const database = createDatabaseRuntime({ applicationName: 'qingxu-admin-offline-recovery', allowInsecureLocalhost: config.database.allowInsecureLocalhost, connectionTimeoutMs: config.database.connectionTimeoutMs, databaseUrl: config.database.url, poolMax: 1, projectRef: config.database.projectRef, sslRootCertPath: config.database.sslRootCertPath });
  await database.connect();
  try {
    const repository = new AdminAuthRepository(database.prisma);
    const audit = new AuditRepository(config.encryption.ipHashKey);
    const requestId = `req_${createHash('sha256').update(`${Date.now()}:${Math.random()}`).digest('hex').slice(0, 32)}`;
    if (command === 'request') {
      const targetId = arg(3, 'target account ID');
      const requesterId = arg(4, 'requester account ID');
      const reason = arg(5, 'reason');
      const requester = await operator(config, database, requesterId);
      const recoveryId = generateUlid();
      const expiresAt = new Date(Date.now() + 30 * 60 * 1_000);
      await runSerializableTransaction(database.prisma, async (transaction) => {
        await repository.consumeOfflineOperatorTotpInTransaction(transaction, { accountId: requester.account.id, factorId: requester.factor.id, expectedVersion: requester.account.version, acceptedTimestep: requester.timestep });
        const created = await repository.createOfflineRecoveryInTransaction(transaction, { recoveryId, targetAccountId: targetId, requestedById: requesterId, reason, expiresAt });
        await audit.append(transaction, { action: 'CREATE', actorAccountId: requesterId, actorRole: 'SUPER_ADMIN', module: 'admin_auth', objectType: 'account', objectId: targetId, requestId, result: 'SUCCESS', resultCode: 'OFFLINE_RECOVERY_REQUESTED', summaryPolicy: 'NONE' });
        process.stdout.write(`Offline recovery requested: ${created.id}\n`);
      });
    } else if (command === 'approve' || command === 'reject') {
      const recoveryId = arg(3, 'recovery ID');
      const approverId = arg(4, 'approver account ID');
      const reason = arg(5, 'reason');
      const approver = await operator(config, database, approverId);
      await runSerializableTransaction(database.prisma, async (transaction) => {
        await repository.consumeOfflineOperatorTotpInTransaction(transaction, { accountId: approver.account.id, factorId: approver.factor.id, expectedVersion: approver.account.version, acceptedTimestep: approver.timestep });
        const result = await repository.decideOfflineRecoveryInTransaction(transaction, { recoveryId, approverId, decision: command === 'approve' ? 'APPROVED' : 'REJECTED', reason });
        await audit.append(transaction, { action: command === 'approve' ? 'APPROVE' : 'REJECT', actorAccountId: approverId, actorRole: 'SUPER_ADMIN', module: 'admin_auth', objectType: 'account', objectId: result.targetAccountId, requestId, result: 'SUCCESS', resultCode: 'OFFLINE_RECOVERY_DECIDED', summaryPolicy: 'NONE' });
        process.stdout.write(`Offline recovery ${result.status}: ${result.id}\n`);
      });
    } else {
      const recoveryId = arg(3, 'recovery ID');
      const executorId = arg(4, 'executor account ID');
      const expectedVersion = Number(arg(5, 'target account version'));
      if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw new Error('Target account version is invalid');
      const executor = await operator(config, database, executorId);
      const newPassword = await readSecret('New target password: ', 'OFFLINE_RECOVERY_NEW_PASSWORD_FILE');
      const confirmation = process.env.OFFLINE_RECOVERY_NEW_PASSWORD_FILE
        ? newPassword
        : await hiddenQuestion('Confirm target password: ');
      if (newPassword !== confirmation) throw new Error('Password confirmation does not match');
      const passwordHash = await hashPassword(newPassword);
      const fingerprint = hmacAuthenticationSecret(newPassword, config.authentication.secretHashKeys.current.key, 'security-reset-credential');
      await runSerializableTransaction(database.prisma, async (transaction) => {
        await repository.consumeOfflineOperatorTotpInTransaction(transaction, { accountId: executor.account.id, factorId: executor.factor.id, expectedVersion: executor.account.version, acceptedTimestep: executor.timestep });
        const result = await repository.executeOfflineRecoveryInTransaction(transaction, { recoveryId, executorId, expectedVersion, newPasswordHash: passwordHash, credentialFingerprint: fingerprint });
        await audit.append(transaction, { action: 'RESET', actorAccountId: executorId, actorRole: 'SUPER_ADMIN', module: 'admin_auth', objectType: 'account', objectId: recoveryId, requestId, result: 'SUCCESS', resultCode: 'OFFLINE_RECOVERY_EXECUTED', summaryPolicy: 'NONE' });
        process.stdout.write(`Offline recovery executed: version ${result.version}\n`);
      });
    }
  } finally { await database.disconnect(); }
}

main().catch(() => { process.stderr.write('Offline recovery failed\n'); process.exitCode = 1; });
