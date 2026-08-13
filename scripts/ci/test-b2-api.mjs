import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function fail(message) {
  process.stderr.write(`B2 API integration test refused: ${message}\n`);
  process.exit(1);
}

if (process.env.B2_DATABASE_TEST_MODE !== 'full') {
  fail('B2_DATABASE_TEST_MODE must be explicitly set to full');
}
if (process.env.CI !== 'true' || process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1' ||
  process.env.NODE_ENV !== 'test') {
  fail('the test requires the explicit ephemeral CI PostgreSQL capability and NODE_ENV=test');
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

let redisUrl;
try {
  redisUrl = new URL(process.env.REDIS_URL ?? '');
} catch {
  fail('REDIS_URL must be a valid Redis URL');
}
if (redisUrl.protocol !== 'redis:' || !LOCAL_HOSTS.has(redisUrl.hostname) || !redisUrl.password ||
  redisUrl.search !== '' || redisUrl.hash !== '') {
  fail('full mode requires a query-free password-authenticated loopback Redis connection');
}

for (const name of [
  'FIELD_ENCRYPTION_KEY_BASE64',
  'FIELD_ENCRYPTION_KEY_ID',
  'FIELD_PREVIOUS_ENCRYPTION_KEYS_JSON',
  'AUDIT_IP_HASH_KEY_BASE64',
  'IDEMPOTENCY_HASH_KEY_BASE64',
  'IDEMPOTENCY_HASH_KEY_ID',
  'IDEMPOTENCY_PREVIOUS_HASH_KEYS_JSON',
  'AUTH_SIGNING_KEY_BASE64',
  'AUTH_SIGNING_KEY_ID',
  'AUTH_PREVIOUS_SIGNING_KEYS_JSON',
  'AUTH_SECRET_HASH_KEY_BASE64',
  'AUTH_SECRET_HASH_KEY_ID',
  'AUTH_PREVIOUS_SECRET_HASH_KEYS_JSON',
  'AUTH_TOKEN_ISSUER',
  'AUTH_TOKEN_AUDIENCE',
  'REDIS_URL',
]) {
  if (!process.env[name]?.trim()) fail(`${name} is required`);
}

for (const command of [
  ['--filter', '@qingxu/platform-core', 'build'],
  ['--filter', '@qingxu/config', 'build'],
  ['--filter', '@qingxu/database', 'build'],
  ['--filter', '@qingxu/api', 'exec', 'vitest', 'run', 'src/admin-auth/admin-auth.integration.spec.ts'],
]) {
  const child = spawnSync('pnpm', command, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) fail(`command failed: pnpm ${command.join(' ')}`);
}
