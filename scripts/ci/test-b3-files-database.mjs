import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

import { readConnection } from '../db/lib/connection.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);
const mode = process.env.B3_FILE_DATABASE_TEST_MODE;

function fail(message) {
  process.stderr.write(`B3 file database test refused: ${message}\n`);
  process.exit(1);
}

if (mode !== 'full' && mode !== 'rollback') {
  fail('B3_FILE_DATABASE_TEST_MODE must be explicitly set to full or rollback');
}

if (mode === 'full') {
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    fail('full mode requires NODE_ENV=test and the explicit ephemeral CI PostgreSQL capability');
  }
  let url;
  try {
    url = new URL(process.env.DATABASE_URL ?? '');
  } catch {
    fail('DATABASE_URL must be a valid PostgreSQL URL');
  }
  let username;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    fail('DATABASE_URL contains an invalid runtime role');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOCAL_HOSTS.has(url.hostname) ||
    username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '') {
    fail('full mode requires a query-free loopback mall_runtime connection');
  }
} else {
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    fail('rollback mode cannot use the ephemeral PostgreSQL capability');
  }
  const connection = readConnection('DATABASE_URL', 'runtime');
  if (!connection.sslrootcert) fail('rollback mode requires an explicit trusted CA');
}

for (const command of [
  ['--filter', '@qingxu/platform-core', 'build'],
  ['--filter', '@qingxu/database', 'generate'],
  ['--filter', '@qingxu/database', 'exec', 'vitest', 'run', 'src/file-asset.integration.spec.ts'],
]) {
  const child = spawnSync('pnpm', command, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) fail(`command failed: pnpm ${command.join(' ')}`);
}
