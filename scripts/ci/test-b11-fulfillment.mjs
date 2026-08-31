import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import { readConnection } from '../db/lib/connection.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const mode = process.env.B11_FULFILLMENT_DATABASE_TEST_MODE;

function fail(message) {
  process.stderr.write(`B11 fulfillment database test refused: ${message}\n`);
  process.exit(1);
}

function parseDatabaseUrl(name) {
  try {
    return new URL(process.env[name]);
  } catch {
    fail(`${name} must be a valid PostgreSQL URL`);
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
  const runtime = parseDatabaseUrl('DATABASE_URL');
  const runtimeUsername = decode(runtime.username, 'DATABASE_URL username');
  const database = decode(runtime.pathname.slice(1), 'DATABASE_URL database');
  if (!['postgres:', 'postgresql:'].includes(runtime.protocol) || !LOOPBACK_HOSTS.has(runtime.hostname) ||
    runtimeUsername !== 'mall_runtime' || !runtime.password || runtime.search !== '' || runtime.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database)) {
    fail('DATABASE_URL must be a query-free loopback mall_runtime connection to an explicit test database');
  }

  const direct = parseDatabaseUrl('DIRECT_URL');
  const directUsername = decode(direct.username, 'DIRECT_URL username');
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) || !LOOPBACK_HOSTS.has(direct.hostname) ||
    directUsername !== 'mall_migrator' || !direct.password || direct.search !== '' || direct.hash !== '' ||
    direct.hostname !== runtime.hostname || (direct.port || '5432') !== (runtime.port || '5432') ||
    direct.pathname !== runtime.pathname) {
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
  fail('B11_FULFILLMENT_DATABASE_TEST_MODE must be explicitly set to full or rollback');
}
if (!process.env.DATABASE_URL?.trim()) fail('DATABASE_URL is required for full or rollback mode');

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
  if (!process.env.PGSSLROOTCERT?.trim()) {
    fail('rollback mode requires PGSSLROOTCERT for the database integration runtime');
  }
}

process.env.B11_FULFILLMENT_DATABASE_TEST_MODE = mode;

run(['--filter', '@qingxu/platform-core', 'build']);
run(['--filter', '@qingxu/database', 'build']);

const tests = [
  'src/fulfillment-command.integration.spec.ts',
  'src/fulfillment-completion.integration.spec.ts',
];
if (mode === 'full') {
  tests.unshift(
    'src/fulfillment.repository.spec.ts',
    'src/fulfillment-command.repository.spec.ts',
    'src/fulfillment-completion.repository.spec.ts',
  );
}
// The two PostgreSQL suites contain their own command races. Running the files
// in parallel adds unrelated SERIALIZABLE predicate-lock conflicts between
// fixture setup transactions and makes the gate nondeterministic.
run(['--filter', '@qingxu/database', 'exec', 'vitest', 'run', '--no-file-parallelism', ...tests]);

process.stdout.write(`B11 fulfillment ${mode} database checks passed.\n`);
