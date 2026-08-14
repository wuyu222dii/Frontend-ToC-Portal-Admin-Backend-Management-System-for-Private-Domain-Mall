import { spawnSync } from 'node:child_process';
import process from 'node:process';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

function fail(message) {
  process.stderr.write(`B3 file API integration test refused: ${message}\n`);
  process.exit(1);
}

function parseUrl(name) {
  try {
    return new URL(process.env[name] ?? '');
  } catch {
    fail(`${name} must be a valid URL`);
  }
}

if (process.env.B3_FILE_API_TEST_MODE !== 'full') {
  fail('B3_FILE_API_TEST_MODE must be explicitly set to full');
}
if (process.env.B3_FILE_WORKER_TEST_MODE !== 'full') {
  fail('B3_FILE_WORKER_TEST_MODE must be explicitly set to full');
}
if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
  process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
  fail('the test requires the explicit ephemeral CI PostgreSQL capability and NODE_ENV=test');
}

const databaseUrl = parseUrl('DATABASE_URL');
let databaseRole;
let databaseName;
try {
  databaseRole = decodeURIComponent(databaseUrl.username);
  databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
} catch {
  fail('DATABASE_URL contains invalid percent encoding');
}
if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
  !LOOPBACK_HOSTS.has(databaseUrl.hostname) || databaseRole !== 'mall_runtime' ||
  !databaseUrl.password || databaseUrl.search !== '' || databaseUrl.hash !== '' ||
  !/(?:^|[-_])(?:b3\d*|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
  fail('full mode requires a query-free loopback mall_runtime B3 test database');
}

const redisUrl = parseUrl('REDIS_URL');
let redisPassword;
try {
  redisPassword = decodeURIComponent(redisUrl.password);
} catch {
  fail('REDIS_URL contains invalid percent encoding');
}
if (redisUrl.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redisUrl.hostname) ||
  redisPassword.length < 12 || redisUrl.search !== '' || redisUrl.hash !== '') {
  fail('full mode requires a query-free password-authenticated loopback Redis connection');
}

const storageUrl = parseUrl('S3_ENDPOINT');
const publicBaseUrl = parseUrl('S3_PUBLIC_BASE_URL');
const bucket = process.env.S3_BUCKET ?? '';
if (storageUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storageUrl.hostname) ||
  storageUrl.username !== '' || storageUrl.password !== '' || storageUrl.pathname !== '/' ||
  storageUrl.search !== '' || storageUrl.hash !== '') {
  fail('S3_ENDPOINT must be a credential-free loopback HTTP origin');
}
if (!bucket.startsWith('mall-b3-')) {
  fail('S3_BUCKET must identify an isolated mall-b3-* test bucket');
}
if (publicBaseUrl.origin !== storageUrl.origin ||
  publicBaseUrl.pathname.replace(/\/$/, '') !== `/${bucket}` ||
  publicBaseUrl.username !== '' || publicBaseUrl.password !== '' ||
  publicBaseUrl.search !== '' || publicBaseUrl.hash !== '') {
  fail('S3_PUBLIC_BASE_URL must identify the isolated test bucket on S3_ENDPOINT');
}
if (process.env.S3_FORCE_PATH_STYLE !== 'true') {
  fail('S3_FORCE_PATH_STYLE must be true for the isolated MinIO test');
}

for (const name of [
  'S3_REGION',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
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
]) {
  if (!process.env[name]?.trim()) fail(`${name} is required`);
}

for (const command of [
  ['--filter', '@qingxu/platform-core', 'build'],
  ['--filter', '@qingxu/config', 'build'],
  ['--filter', '@qingxu/database', 'build'],
  ['--filter', '@qingxu/storage', 'build'],
  ['--filter', '@qingxu/api', 'exec', 'vitest', 'run', 'src/files/files.integration.spec.ts'],
  ['--filter', '@qingxu/worker', 'exec', 'vitest', 'run', 'src/file-cleanup.integration.spec.ts'],
]) {
  const child = spawnSync('pnpm', command, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) fail(`command failed: pnpm ${command.join(' ')}`);
}

process.stdout.write('B3.1 file API and worker integration checks passed.\n');
