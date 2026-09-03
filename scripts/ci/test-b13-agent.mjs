import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import { readConnection } from '../db/lib/connection.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const mode = process.env.B13_AGENT_AUTH_DATABASE_TEST_MODE;

function fail(message) {
  process.stderr.write(`B13 Agent database test refused: ${message}\n`);
  process.exit(1);
}

function parseUrl(name, label) {
  try {
    return new URL(process.env[name]);
  } catch {
    fail(`${name} must be a valid ${label} URL`);
  }
}

function decode(value, label) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail(`${label} contains invalid percent encoding`);
  }
}

function assertFullConnections() {
  const runtime = parseUrl('DATABASE_URL', 'PostgreSQL');
  const runtimeUsername = decode(runtime.username, 'DATABASE_URL username');
  const runtimePassword = decode(runtime.password, 'DATABASE_URL password');
  const database = decode(runtime.pathname.slice(1), 'DATABASE_URL database');
  if (!['postgres:', 'postgresql:'].includes(runtime.protocol) || !LOOPBACK_HOSTS.has(runtime.hostname) ||
    runtimeUsername !== 'mall_runtime' || runtimePassword.length === 0 ||
    runtime.search !== '' || runtime.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database)) {
    fail('DATABASE_URL must be a query-free loopback mall_runtime connection to an explicit test database');
  }

  const direct = parseUrl('DIRECT_URL', 'PostgreSQL');
  const directUsername = decode(direct.username, 'DIRECT_URL username');
  const directPassword = decode(direct.password, 'DIRECT_URL password');
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) || !LOOPBACK_HOSTS.has(direct.hostname) ||
    directUsername !== 'mall_migrator' || directPassword.length === 0 ||
    direct.search !== '' || direct.hash !== '' || direct.hostname !== runtime.hostname ||
    (direct.port || '5432') !== (runtime.port || '5432') || direct.pathname !== runtime.pathname) {
    fail('DIRECT_URL must be a query-free loopback mall_migrator connection to the same test database');
  }

  const redis = parseUrl('REDIS_URL', 'Redis');
  const redisPassword = decode(redis.password, 'REDIS_URL password');
  if (redis.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redis.hostname) || redis.username !== '' ||
    redisPassword.length < 12 || redis.search !== '' || redis.hash !== '' ||
    !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)) {
    fail('REDIS_URL must use a password-protected isolated loopback Redis database 1 through 15');
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
  fail('B13_AGENT_AUTH_DATABASE_TEST_MODE must be explicitly set to full or rollback');
}
if (!process.env.DATABASE_URL?.trim()) fail('DATABASE_URL is required for full or rollback mode');

if (mode === 'full') {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    fail('full mode requires NODE_ENV=test and the explicit ephemeral CI PostgreSQL capability');
  }
  if (!process.env.REDIS_URL?.trim()) fail('REDIS_URL is required for full mode');
  assertFullConnections();
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

process.env.B13_AGENT_AUTH_DATABASE_TEST_MODE = mode;
process.env.B132_AGENT_COMMERCE_DATABASE_TEST_MODE = mode;
process.env.B133_AGENT_OPERATIONS_DATABASE_TEST_MODE = mode;
process.env.B134_AGENT_FINANCE_DATABASE_TEST_MODE = mode;

run(['build:packages']);
run([
  '--filter',
  '@qingxu/api',
  'exec',
  'vitest',
  'run',
  '--no-file-parallelism',
  'src/agent-auth/agent-auth.integration.spec.ts',
]);
run([
  '--filter',
  '@qingxu/database',
  'exec',
  'vitest',
  'run',
  '--no-file-parallelism',
  'src/agent-commerce.integration.spec.ts',
]);
run([
  '--filter',
  '@qingxu/database',
  'exec',
  'vitest',
  'run',
  '--no-file-parallelism',
  'src/agent-operations.integration.spec.ts',
]);
run([
  '--filter',
  '@qingxu/database',
  'exec',
  'vitest',
  'run',
  '--no-file-parallelism',
  'src/commission.integration.spec.ts',
]);
run([
  '--filter',
  '@qingxu/api',
  'exec',
  'vitest',
  'run',
  '--no-file-parallelism',
  'src/admin-commissions/admin-commissions.integration.spec.ts',
]);

process.stdout.write(`B13 Agent ${mode} database checks passed.\n`);
