import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import { readConnection } from '../db/lib/connection.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const mode = process.env.B7_STORE_AUTH_DATABASE_TEST_MODE;

function fail(message) {
  process.stderr.write(`B7 Store auth database test refused: ${message}\n`);
  process.exit(1);
}

function parseDatabaseUrl() {
  try {
    return new URL(process.env.DATABASE_URL ?? '');
  } catch {
    fail('DATABASE_URL must be a valid PostgreSQL URL');
  }
}

if (mode !== 'full' && mode !== 'rollback') {
  fail('B7_STORE_AUTH_DATABASE_TEST_MODE must be explicitly set to full or rollback');
}

if (mode === 'full') {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    fail('full mode requires NODE_ENV=test and the explicit ephemeral CI PostgreSQL capability');
  }
  const url = parseDatabaseUrl();
  let username;
  let database;
  try {
    username = decodeURIComponent(url.username);
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    fail('DATABASE_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname) ||
    username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database)) {
    fail('full mode requires a query-free loopback mall_runtime B7 test database');
  }
} else {
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    fail('rollback mode cannot use the ephemeral PostgreSQL capability');
  }
  const connection = readConnection('DATABASE_URL', 'runtime');
  if (!connection.sslrootcert) fail('rollback mode requires an explicit trusted CA');
}

process.env.B7_STORE_AUTH_DATABASE_TEST_MODE = mode;

for (const command of [
  ['--filter', '@qingxu/platform-core', 'build'],
  ['--filter', '@qingxu/config', 'build'],
  ['--filter', '@qingxu/database', 'build'],
  ['--filter', '@qingxu/database', 'exec', 'vitest', 'run', 'src/store-auth.integration.spec.ts'],
  ['--filter', '@qingxu/api', 'exec', 'vitest', 'run', 'src/store-auth/store-auth.integration.spec.ts'],
]) {
  const child = spawnSync('pnpm', command, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) fail(`command failed: pnpm ${command.join(' ')}`);
}

process.stdout.write('B7.1 Store auth database and API service checks passed.\n');
