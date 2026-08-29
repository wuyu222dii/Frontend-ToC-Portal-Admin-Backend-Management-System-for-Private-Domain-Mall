import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import { readConnection } from '../db/lib/connection.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const mode = process.env.B9_STORE_ORDER_DATABASE_TEST_MODE;

function fail(message) {
  process.stderr.write(`B9 Store order database test refused: ${message}\n`);
  process.exit(1);
}

function parseDatabaseUrl() {
  try {
    return new URL(process.env.DATABASE_URL);
  } catch {
    fail('DATABASE_URL must be a valid PostgreSQL URL');
  }
}

function decode(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(`${label} contains invalid percent encoding`);
  }
}

function assertFullConnection() {
  const url = parseDatabaseUrl();
  const username = decode(url.username, 'DATABASE_URL username');
  const database = decode(url.pathname.slice(1), 'DATABASE_URL database');
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
    username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database)) {
    fail('DATABASE_URL must be a query-free loopback mall_runtime connection to an explicit test database');
  }
  let direct;
  try {
    direct = new URL(process.env.DIRECT_URL);
  } catch {
    fail('DIRECT_URL must be a valid PostgreSQL URL in full mode');
  }
  const directUsername = decode(direct.username, 'DIRECT_URL username');
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) || !LOOPBACK_HOSTS.has(direct.hostname) ||
    directUsername !== 'mall_migrator' || !direct.password || direct.search !== '' || direct.hash !== '' ||
    direct.hostname !== url.hostname || (direct.port || '5432') !== (url.port || '5432') ||
    direct.pathname !== url.pathname) {
    fail('DIRECT_URL must be a query-free loopback mall_migrator connection to the same test database');
  }
}

function run(command) {
  const child = spawnSync('pnpm', command, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) fail(`command failed: pnpm ${command.join(' ')}`);
}

if (mode !== 'full' && mode !== 'rollback') {
  fail('B9_STORE_ORDER_DATABASE_TEST_MODE must be explicitly set to full or rollback');
}
if (!process.env.DATABASE_URL?.trim()) {
  fail('DATABASE_URL is required for full or rollback mode');
}

if (mode === 'full') {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    fail('full mode requires NODE_ENV=test and the explicit ephemeral CI PostgreSQL capability');
  }
  assertFullConnection();
} else {
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    fail('rollback mode cannot use the ephemeral PostgreSQL capability');
  }
  let connection;
  try {
    connection = readConnection('DATABASE_URL', 'runtime');
  } catch (error) {
    fail(error instanceof Error ? error.message : 'DATABASE_URL validation failed');
  }
  if (!connection.sslrootcert) fail('rollback mode requires an explicit trusted CA');
}

process.env.B9_STORE_CHECKOUT_DATABASE_TEST_MODE = mode;
process.env.B9_STORE_ORDER_DATABASE_TEST_MODE = mode;

run(['--filter', '@qingxu/platform-core', 'build']);
run(['--filter', '@qingxu/config', 'build']);
run(['--filter', '@qingxu/database', 'build']);

const tests = [
  'src/store-checkout.integration.spec.ts',
  'src/store-order.integration.spec.ts',
];
if (mode === 'full') {
  tests.unshift(
    'src/store-checkout.repository.spec.ts',
    'src/store-order.repository.spec.ts',
  );
}
run(['--filter', '@qingxu/database', 'exec', 'vitest', 'run', ...tests]);

process.stdout.write(`B9.1-B9.3 Store checkout and order ${mode} database checks passed.\n`);
