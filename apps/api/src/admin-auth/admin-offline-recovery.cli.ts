import { randomBytes } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

import { loadPlatformConfig } from '@qingxu/config';
import {
  AdminAuthRepository, AuditRepository, createDatabaseRuntime, runSerializableTransaction,
  type OfflineOperatorProof, type OfflineRecoveryCommand,
} from '@qingxu/database';
import {
  createEncryptionContext, decryptEnvelopeText, hashPassword, hmacAuthenticationSecret,
  isValidUlid, verifyPasswordHash, verifyTotpCode, type EncryptedEnvelope,
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

export function parseOfflineRecoveryArguments(args: readonly string[]) {
  const [command, resourceId, operatorId, detail, credentialType = 'TOTP'] = args;
  if (args.length < 4 || args.length > 5 || !resourceId || !operatorId || !detail ||
    !isValidUlid(resourceId) || !isValidUlid(operatorId) ||
    (credentialType !== 'TOTP' && credentialType !== 'RECOVERY_CODE')) throw new Error('Invalid recovery arguments');
  if (command === 'execute') {
    if (!/^[1-9][0-9]*$/.test(detail) || !Number.isSafeInteger(Number(detail))) throw new Error('Invalid recovery version');
    return { command, resourceId, operatorId, expectedRecoveryVersion: Number(detail), credentialType } as const;
  }
  if (!['request', 'approve', 'reject'].includes(command ?? '') || detail.trim().length < 2 || detail.length > 500) {
    throw new Error('Invalid recovery command or reason');
  }
  return { command: command as 'request' | 'approve' | 'reject', resourceId, operatorId, reason: detail.trim(), credentialType } as const;
}

function envelope(value: Uint8Array): EncryptedEnvelope {
  const parsed = JSON.parse(Buffer.from(value).toString('utf8')) as Record<string, unknown>;
  if (parsed.version !== 1 || parsed.algorithm !== 'AES-256-GCM' ||
    !['authTag', 'ciphertext', 'iv', 'keyId'].every((key) => typeof parsed[key] === 'string')) {
    throw new Error('TOTP secret is unreadable');
  }
  return parsed as unknown as EncryptedEnvelope;
}

async function operatorProof(config: ReturnType<typeof loadPlatformConfig>, database: ReturnType<typeof createDatabaseRuntime>,
  accountId: string, credentialType: 'TOTP' | 'RECOVERY_CODE'): Promise<OfflineOperatorProof> {
  const account = await database.prisma.account.findUnique({
    where: { id: accountId }, include: { totp_factors: { where: { status: 'ACTIVE' }, take: 1 } },
  });
  if (!account || account.role !== 'SUPER_ADMIN' || account.status !== 'ACTIVE' || account.deleted_at !== null || !account.password_hash) {
    throw new Error('Operator authentication failed');
  }
  const factor = account.totp_factors[0];
  let password = await readSecret('Operator password: ', 'OFFLINE_RECOVERY_OPERATOR_PASSWORD_FILE');
  let credential = await readSecret(`Operator ${credentialType}: `,
    credentialType === 'TOTP' ? 'OFFLINE_RECOVERY_OPERATOR_TOTP_FILE' : 'OFFLINE_RECOVERY_OPERATOR_RECOVERY_CODE_FILE');
  try {
    const passwordVerified = await verifyPasswordHash(account.password_hash, password);
    const proof: OfflineOperatorProof = { accountId, expectedVersion: account.version,
      expectedPasswordHash: account.password_hash, passwordVerified, credentialType, factorId: factor?.id ?? null };
    if (!passwordVerified || !factor) return proof;
    if (credentialType === 'RECOVERY_CODE') {
      proof.credentialHashCandidates = [config.authentication.secretHashKeys.current, ...config.authentication.secretHashKeys.previous]
        .map(({ key }) => hmacAuthenticationSecret(credential, key, 'recovery-code'));
    } else {
      const secret = decryptEnvelopeText(envelope(factor.secret_ciphertext), (keyId) => {
        const key = [config.encryption.fieldKeys.current, ...config.encryption.fieldKeys.previous].find((entry) => entry.id === keyId);
        if (!key) throw new Error('TOTP encryption key is unavailable');
        return key.key;
      }, createEncryptionContext('totp_factor', factor.id, 'secret_ciphertext'));
      const verification = await verifyTotpCode(secret, credential);
      if (verification.valid) proof.acceptedTimestep = verification.timestep;
    }
    return proof;
  } finally { password = ''; credential = ''; }
}

export async function offlineRecoveryMain(args = process.argv.slice(2)): Promise<void> {
  const parsed = parseOfflineRecoveryArguments(args);
  const config = loadPlatformConfig(process.env, { service: 'api', requireDatabase: true, requireEncryption: true, requireStorage: false });
  const database = createDatabaseRuntime({ applicationName: 'qingxu-admin-offline-recovery',
    allowInsecureLocalhost: config.database.allowInsecureLocalhost, connectionTimeoutMs: config.database.connectionTimeoutMs,
    databaseUrl: config.database.url, poolMax: 1, projectRef: config.database.projectRef, sslRootCertPath: config.database.sslRootCertPath });
  try {
    await database.connect();
    const operator = await operatorProof(config, database, parsed.operatorId, parsed.credentialType);
    let input: OfflineRecoveryCommand;
    if (parsed.command === 'execute') {
      let password = await readSecret('New target password: ', 'OFFLINE_RECOVERY_NEW_PASSWORD_FILE');
      let confirmation = process.env.OFFLINE_RECOVERY_NEW_PASSWORD_FILE ? password : await hiddenQuestion('Confirm target password: ');
      try {
        if (password !== confirmation || Array.from(password).length < 12 || Array.from(password).length > 128) {
          throw new Error('Invalid password or confirmation');
        }
        input = { command: 'execute', recoveryId: parsed.resourceId, operator,
          expectedRecoveryVersion: parsed.expectedRecoveryVersion, newPasswordHash: await hashPassword(password),
          credentialFingerprint: hmacAuthenticationSecret(password, config.authentication.secretHashKeys.current.key, 'security-reset-credential') };
      } finally { password = ''; confirmation = ''; }
    } else if (parsed.command === 'request') {
      input = { command: 'request', targetAccountId: parsed.resourceId, operator, reason: parsed.reason };
    } else {
      input = { command: parsed.command, recoveryId: parsed.resourceId, operator, reason: parsed.reason };
    }
    const repository = new AdminAuthRepository(database.prisma);
    const audit = new AuditRepository(config.encryption.ipHashKey);
    const requestId = `req_${randomBytes(16).toString('hex')}`;
    const result = await runSerializableTransaction(database.prisma,
      (transaction) => repository.runOfflineRecoveryInTransaction(transaction, input, audit, requestId));
    // Only committed, non-secret metadata reaches stdout, including uncertain command retries.
    process.stdout.write(`${JSON.stringify({ code: result.resultCode, ...(result.record ? {
      recovery_id: result.record.id, status: result.record.status, version: result.record.version,
      etag: `"${result.record.version}"`, expires_at: result.record.expiresAt.toISOString(),
    } : {}) })}\n`);
    if (result.kind !== 'success') process.exitCode = 1;
  } finally { await database.disconnect(); }
}

if (require.main === module) {
  offlineRecoveryMain().catch(() => { process.stderr.write('Offline recovery failed\n'); process.exitCode = 1; });
}
