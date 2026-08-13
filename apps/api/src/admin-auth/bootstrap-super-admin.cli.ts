import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

import { loadPlatformConfig } from '@qingxu/config';
import {
  AdminAuthRepository,
  AuditRepository,
  createDatabaseRuntime,
  runSerializableTransaction,
} from '@qingxu/database';
import { generateUlid, hashPassword } from '@qingxu/platform-core';

function validateLoginName(value: string): string {
  const hasControl = Array.from(value).some((character) => {
    const code = character.codePointAt(0);
    return code !== undefined && (code <= 0x1f || code === 0x7f);
  });
  if (value.length < 1 || value.length > 80 || value.trim() !== value || hasControl) {
    throw new Error('Bootstrap login name must be 1 to 80 printable characters without outer spaces');
  }
  return value;
}

const PASSWORD_FILE_ERROR =
  'Bootstrap password file must be a single non-empty UTF-8 line in a private regular file';

export function assertSecureBootstrapInvocation(
  argv: readonly string[],
  source: NodeJS.ProcessEnv,
): void {
  if (argv.length !== 2) {
    throw new Error('Bootstrap does not accept command-line arguments');
  }
  if (Object.prototype.hasOwnProperty.call(source, 'ADMIN_BOOTSTRAP_PASSWORD')) {
    throw new Error('Bootstrap does not accept plaintext password environment variables');
  }
}

export async function readBootstrapPasswordFile(path: string): Promise<string> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch {
    throw new Error(PASSWORD_FILE_ERROR);
  }
  try {
    const metadata = await file.stat();
    const ownerMismatch = typeof process.geteuid === 'function' && metadata.uid !== process.geteuid();
    if (!metadata.isFile() || metadata.nlink !== 1 || ownerMismatch ||
      metadata.size === 0 || metadata.size > 4_096 || (metadata.mode & 0o077) !== 0) {
      throw new Error(PASSWORD_FILE_ERROR);
    }
    const bytes = await file.readFile();
    if (bytes.byteLength === 0 || bytes.byteLength > 4_096 || bytes.byteLength !== metadata.size) {
      throw new Error(PASSWORD_FILE_ERROR);
    }
    let content: string;
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error(PASSWORD_FILE_ERROR);
    }
    const password = content.endsWith('\r\n')
      ? content.slice(0, -2)
      : content.endsWith('\n') ? content.slice(0, -1) : content;
    const containsForbiddenLineCharacter = Array.from(password)
      .some((character) => character === '\0' || character === '\r' || character === '\n');
    if (password.length === 0 || containsForbiddenLineCharacter) throw new Error(PASSWORD_FILE_ERROR);
    return password;
  } finally {
    await file.close();
  }
}

async function hiddenQuestion(prompt: string): Promise<string> {
  if (!process.stdin.isTTY) throw new Error('Interactive bootstrap requires a TTY');
  const muted = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  process.stderr.write(prompt);
  const readline = createInterface({ input: process.stdin, output: muted, terminal: true });
  try { return await readline.question(''); } finally { readline.close(); process.stderr.write('\n'); }
}

async function bootstrapPassword(): Promise<string> {
  const path = process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE;
  if (path) return readBootstrapPasswordFile(path);
  const password = await hiddenQuestion('Bootstrap password: ');
  const confirmation = await hiddenQuestion('Confirm password: ');
  if (password !== confirmation) throw new Error('Bootstrap password confirmation does not match');
  return password;
}

async function bootstrapLoginName(): Promise<string> {
  const configured = process.env.ADMIN_BOOTSTRAP_LOGIN_NAME;
  if (configured !== undefined) return validateLoginName(configured);
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  try { return validateLoginName(await readline.question('Bootstrap login name: ')); } finally { readline.close(); }
}

export async function bootstrapSuperAdmin(): Promise<string> {
  assertSecureBootstrapInvocation(process.argv, process.env);
  const config = loadPlatformConfig(process.env, { service: 'api', requireDatabase: true, requireEncryption: true });
  const database = createDatabaseRuntime({
    applicationName: 'qingxu-admin-bootstrap',
    allowInsecureLocalhost: config.database.allowInsecureLocalhost,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    databaseUrl: config.database.url,
    poolMax: 1,
    projectRef: config.database.projectRef,
    sslRootCertPath: config.database.sslRootCertPath,
  });
  await database.connect();
  try {
    const loginName = await bootstrapLoginName();
    const passwordHash = await hashPassword(await bootstrapPassword());
    const accountId = generateUlid();
    const requestId = `req_${randomBytes(16).toString('hex')}`;
    const repository = new AdminAuthRepository(database.prisma);
    const audit = new AuditRepository(config.encryption.ipHashKey);
    await runSerializableTransaction(database.prisma, async (transaction) => {
      await repository.bootstrapSuperAdminInTransaction(transaction, { accountId, loginName, passwordHash });
      await audit.append(transaction, {
        action: 'CREATE',
        actorAccountId: accountId,
        actorRole: 'SUPER_ADMIN',
        module: 'admin_auth',
        objectId: accountId,
        objectType: 'account',
        requestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'NONE',
      });
    });
    return accountId;
  } finally {
    await database.disconnect();
  }
}

if (require.main === module) {
  bootstrapSuperAdmin()
    .then((accountId) => process.stdout.write(`Super administrator created: ${accountId}\n`))
    .catch(() => { process.stderr.write('Super administrator bootstrap failed\n'); process.exitCode = 1; });
}
