import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import { readConnection } from '../db/lib/connection.mjs';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const mode = process.env.B8_STORE_SHOPPING_DATABASE_TEST_MODE;

function fail(message) {
  process.stderr.write(`B8 Store shopping database test refused: ${message}\n`);
  process.exit(1);
}

function parseUrl(name) {
  try {
    return new URL(process.env[name] ?? '');
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

function assertFullConnection(name, expectedRole) {
  const url = parseUrl(name);
  const username = decode(url.username, `${name} username`);
  const database = decode(url.pathname.slice(1), `${name} database`);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
    username !== expectedRole || !url.password || url.search !== '' || url.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database)) {
    fail(`${name} must be a query-free loopback ${expectedRole} connection to an explicit test database`);
  }
  return url;
}

if (mode !== 'full' && mode !== 'rollback') {
  fail('B8_STORE_SHOPPING_DATABASE_TEST_MODE must be explicitly set to full or rollback');
}

if (mode === 'full') {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    fail('full mode requires NODE_ENV=test and the explicit ephemeral CI PostgreSQL capability');
  }
  const runtimeUrl = assertFullConnection('DATABASE_URL', 'mall_runtime');
  const directUrl = assertFullConnection('DIRECT_URL', 'mall_migrator');
  if (directUrl.hostname !== runtimeUrl.hostname ||
    (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    fail('DATABASE_URL and DIRECT_URL must target the same loopback test database');
  }
} else {
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    fail('rollback mode cannot use the ephemeral PostgreSQL capability');
  }
  const connection = readConnection('DATABASE_URL', 'runtime');
  if (!connection.sslrootcert) fail('rollback mode requires an explicit trusted CA');
}

process.env.B8_STORE_FAVORITES_DATABASE_TEST_MODE = mode;
process.env.B8_STORE_CART_DATABASE_TEST_MODE = mode;
process.env.B8_STORE_ADDRESS_DATABASE_TEST_MODE = mode;
process.env.B7_STORE_AUTH_DATABASE_TEST_MODE = mode;

for (const command of [
  ['--filter', '@qingxu/platform-core', 'build'],
  ['--filter', '@qingxu/config', 'build'],
  ['--filter', '@qingxu/database', 'build'],
  ['--filter', '@qingxu/storage', 'build'],
  [
    '--filter', '@qingxu/database', 'exec', 'vitest', 'run',
    'src/store-favorites.repository.spec.ts',
    'src/store-cart.repository.spec.ts',
    'src/store-address.repository.spec.ts',
    'src/store-privacy.repository.spec.ts',
  ],
  ['--filter', '@qingxu/api', 'exec', 'vitest', 'run', 'src/store-favorites/store-favorites.integration.spec.ts'],
  ['--filter', '@qingxu/api', 'exec', 'vitest', 'run', 'src/store-cart/store-cart.integration.spec.ts'],
  ['--filter', '@qingxu/api', 'exec', 'vitest', 'run', 'src/store-address/store-address.integration.spec.ts'],
  ['--filter', '@qingxu/database', 'exec', 'vitest', 'run', 'src/store-privacy.integration.spec.ts'],
  ['--filter', '@qingxu/api', 'exec', 'vitest', 'run', 'src/store-privacy/store-privacy.integration.spec.ts'],
]) {
  const child = spawnSync('pnpm', command, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) fail(`command failed: pnpm ${command.join(' ')}`);
}

process.stdout.write(
  'B8.1-B8.5 Store favorites, cart, address and account-deletion cleanup checks passed.\n',
);
