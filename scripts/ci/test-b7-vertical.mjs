import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const databaseRequire = createRequire(new URL('../../packages/database/package.json', import.meta.url));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function refuse(message) {
  throw new Error(`B7 vertical test refused: ${message}`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) refuse(`${name} is required`);
  return value;
}

function parseUrl(name) {
  try {
    return new URL(required(name));
  } catch {
    refuse(`${name} must be a valid URL`);
  }
}

function run(command, args, label) {
  const child = spawnSync(command, args, { cwd: process.cwd(), env: process.env, stdio: 'inherit' });
  if (child.error || child.status !== 0) throw new Error(`${label} failed`);
}

function validateTargets() {
  if (process.env.B7_VERTICAL_TEST_MODE !== 'full') refuse('B7_VERTICAL_TEST_MODE must be explicitly set to full');
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
  }
  if (process.env.STORE_IDENTITY_PROVIDER !== 'MOCK' || process.env.STORE_PHONE_PROVIDER !== 'MOCK') {
    refuse('STORE_IDENTITY_PROVIDER and STORE_PHONE_PROVIDER must both be MOCK');
  }

  const database = parseUrl('DATABASE_URL');
  let username;
  let databaseName;
  try {
    username = decodeURIComponent(database.username);
    databaseName = decodeURIComponent(database.pathname.slice(1));
  } catch {
    refuse('DATABASE_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || !LOOPBACK_HOSTS.has(database.hostname) ||
    username !== 'mall_runtime' || !database.password || database.search !== '' || database.hash !== '' ||
    !/(?:^|[-_])(?:b7|store|identity|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B7 test database');
  }

  const direct = parseUrl('DIRECT_URL');
  let directUsername;
  try {
    directUsername = decodeURIComponent(direct.username);
  } catch {
    refuse('DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) || !LOOPBACK_HOSTS.has(direct.hostname) ||
    directUsername !== 'mall_migrator' || !direct.password || direct.search !== '' || direct.hash !== '' ||
    direct.hostname !== database.hostname || direct.port !== database.port || direct.pathname !== database.pathname) {
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same B7 database');
  }

  const redis = parseUrl('REDIS_URL');
  if (!['redis:', 'rediss:'].includes(redis.protocol) || !LOOPBACK_HOSTS.has(redis.hostname) ||
    !redis.password || redis.search !== '' || redis.hash !== '' || !/^\/[0-9]+$/.test(redis.pathname)) {
    refuse('REDIS_URL must be a password-protected loopback Redis database');
  }

  for (const name of [
    'AUDIT_IP_HASH_KEY_BASE64',
    'STORE_PHONE_AUTHORIZATION_VERSION',
    'STORE_PRIVACY_POLICY_VERSION',
    'STORE_USER_AGREEMENT_VERSION',
    'STORE_WECHAT_APP_ID',
  ]) required(name);
}

function createFixture(generateUlid, hmacStoreInviteCode, sha256Hex) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const loginCode = `mock:b7_vertical_${marker.toLowerCase()}`;
  const plainInviteCode = `b7-vertical-${marker}`;
  return {
    accountId: generateUlid(),
    agentAccountId: generateUlid(),
    agentId: generateUlid(),
    agentName: `B7 Vertical Agent ${marker}`,
    customerId: generateUlid(),
    initialNickname: `B7 Customer ${marker}`,
    inviteCodeHash: hmacStoreInviteCode(
      plainInviteCode,
      Buffer.from(required('AUTH_SECRET_HASH_KEY_BASE64'), 'base64'),
    ),
    inviteCodeId: generateUlid(),
    loginCode,
    marker,
    plainInviteCode,
    phoneCredential: `mock:phone:${['138', '0000', '0000'].join('')}`,
    replacementPhoneCredential: `mock:phone:${['139', '0000', '0001'].join('')}`,
    promotionAssetId: generateUlid(),
    updatedCity: '测试城市',
    updatedNickname: `B7 Updated ${marker}`,
    wechatOpenId: `mock_${sha256Hex(`${required('STORE_WECHAT_APP_ID')}\0${loginCode}`)}`,
  };
}

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b7-vertical',
    connectionTimeoutMs: 5_000,
    databaseUrl: process.env.DATABASE_URL,
    poolMax: 4,
  });
}

async function seedFixture(createDatabaseRuntime, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const now = new Date();
    await runtime.withPrismaTransaction(async (transaction) => {
      await transaction.account.create({
        data: {
          id: fixture.agentAccountId,
          role: 'AGENT_ADMIN',
          status: 'ACTIVE',
        },
      });
      await transaction.agentProfile.create({
        data: {
          account_id: fixture.agentAccountId,
          agent_no: `B7V-${fixture.marker}`,
          id: fixture.agentId,
          name: fixture.agentName,
          product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
          status: 'ACTIVE',
        },
      });
      await transaction.agentInviteCode.create({
        data: {
          agent_id: fixture.agentId,
          code_ciphertext: Buffer.from(fixture.plainInviteCode),
          code_hash: fixture.inviteCodeHash,
          code_last4: fixture.plainInviteCode.slice(-4),
          effective_at: new Date(now.getTime() - 60_000),
          encryption_key_id: 'b7-vertical-fixture',
          id: fixture.inviteCodeId,
          status: 'ACTIVE',
        },
      });
      await transaction.promotionAsset.create({
        data: {
          agent_id: fixture.agentId,
          authorization_version: 1,
          id: fixture.promotionAssetId,
          invite_code_id: fixture.inviteCodeId,
          public_url: 'https://example.invalid/b7-vertical',
          status: 'ACTIVE',
          target_type: 'STOREFRONT',
        },
      });
      await transaction.account.create({
        data: {
          id: fixture.accountId,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          wechat_open_id: fixture.wechatOpenId,
        },
      });
      await transaction.customerProfile.create({
        data: {
          account_id: fixture.accountId,
          id: fixture.customerId,
          nickname: fixture.initialNickname,
        },
      });
    });
  } finally {
    await runtime.disconnect();
  }
}

async function assertFixtureResults(createDatabaseRuntime, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const facts = await Promise.all([
      runtime.prisma.account.findUnique({ where: { id: fixture.accountId } }),
      runtime.prisma.customerProfile.findUnique({ where: { id: fixture.customerId } }),
      runtime.prisma.customerPhoneVerification.count({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.attributionCandidate.findMany({
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        where: {
          customer_id: fixture.customerId,
          promotion_asset_id: fixture.promotionAssetId,
        },
      }),
      runtime.prisma.customerAgentBinding.findFirst({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.highRiskOperationPreview.findFirst({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        where: { actor_account_id: fixture.accountId },
      }),
      runtime.prisma.accountDeletionRequest.findFirst({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        where: { account_id: fixture.accountId },
      }),
      runtime.prisma.authSession.findMany({ where: { account_id: fixture.accountId } }),
      runtime.prisma.consentRecord.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.outboxEvent.findFirst({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        where: { aggregate_id: fixture.accountId, aggregate_type: 'account' },
      }),
    ]);
    if (facts.length !== 10) throw new Error('B7 vertical database fact query shape changed');
    const [
      account,
      profile,
      phoneCount,
      candidates,
      binding,
      preview,
      deletion,
      sessions,
      consentCount,
      outbox,
    ] = facts;
    const candidate = candidates[0];
    if (!account || account.status !== 'ANONYMIZED' || account.deleted_at === null ||
      account.wechat_open_id !== null || account.wechat_union_id !== null || account.version !== 2 ||
      !profile || profile.nickname !== null || profile.avatar_url !== null || profile.city !== null ||
      profile.anonymized_at === null || profile.version !== 7 || phoneCount !== 0 ||
      candidates.length !== 1 || !candidate || candidate.status !== 'CONFIRMED' ||
      candidate.confirmed_at === null || candidate.candidate_token_hash !== null ||
      candidate.agent_id !== fixture.agentId || candidate.invite_code_id !== fixture.inviteCodeId ||
      !binding || binding.agent_id !== fixture.agentId || binding.ended_at === null ||
      binding.end_reason !== 'ACCOUNT_DELETED' ||
      !preview || preview.action !== 'ACCOUNT.ANONYMIZE' || preview.target_id !== fixture.accountId ||
      preview.consumed_at === null || !deletion || deletion.status !== 'COMPLETED' ||
      deletion.processing_at === null || deletion.completed_at === null || sessions.length !== 1 ||
      sessions.some((session) => session.revoked_at === null || session.refresh_token_hash !== null) ||
      consentCount !== 4 || !outbox || outbox.event_type !== 'account.anonymized' || outbox.status !== 'PENDING') {
      throw new Error('B7 vertical database facts do not match the completed browser flow');
    }
  } finally {
    await runtime.disconnect();
  }
}

async function deleteFixture(createDatabaseRuntime, fixture) {
  const { Pool } = databaseRequire('pg');
  const cleanupPool = new Pool({
    application_name: 'qingxu-b7-vertical-cleanup',
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let cleanupClient;
  let candidateIds = [];
  let sessionIds = [];
  try {
    cleanupClient = await cleanupPool.connect();
    await cleanupClient.query('BEGIN');
    const candidates = await cleanupClient.query(
      `SELECT id
       FROM public.attribution_candidate
       WHERE promotion_asset_id = $1
         AND (customer_id = $2 OR customer_id IS NULL)
       ORDER BY id`,
      [fixture.promotionAssetId, fixture.customerId],
    );
    candidateIds = candidates.rows.map(({ id }) => id);
    const sessions = await cleanupClient.query(
      'SELECT id FROM public.auth_session WHERE account_id = $1 ORDER BY id',
      [fixture.accountId],
    );
    sessionIds = sessions.rows.map(({ id }) => id);
    await cleanupClient.query(
      'DELETE FROM public.high_risk_operation_preview WHERE actor_account_id = $1',
      [fixture.accountId],
    );
    await cleanupClient.query(
      'DELETE FROM public.outbox_event WHERE aggregate_type = $1 AND aggregate_id = $2',
      ['account', fixture.accountId],
    );
    await cleanupClient.query(
      `DELETE FROM public.idempotency_record
       WHERE actor_id = $1
          OR resource_id IN (
            SELECT id FROM public.auth_session WHERE account_id = $1
          )
          OR resource_id IN ($1, $2, $3)
          OR resource_id::text = ANY($4::text[])`,
      [fixture.accountId, fixture.customerId, fixture.promotionAssetId, candidateIds],
    );
    await cleanupClient.query(
      `DELETE FROM public.audit_log
       WHERE actor_account_id = $1
          OR object_id IN ($1, $2, $3)
          OR object_id::text = ANY($4::text[])`,
      [fixture.accountId, fixture.customerId, fixture.promotionAssetId, candidateIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.binding_change_log WHERE customer_id = $1 OR actor_account_id = $2',
      [fixture.customerId, fixture.accountId],
    );
    await cleanupClient.query('DELETE FROM public.customer_agent_binding WHERE customer_id = $1', [fixture.customerId]);
    await cleanupClient.query(
      `DELETE FROM public.attribution_candidate
       WHERE promotion_asset_id = $1
         AND (customer_id = $2 OR customer_id IS NULL)`,
      [fixture.promotionAssetId, fixture.customerId],
    );
    await cleanupClient.query('DELETE FROM public.customer_phone_verification WHERE customer_id = $1', [fixture.customerId]);
    await cleanupClient.query('DELETE FROM public.account_deletion_request WHERE account_id = $1', [fixture.accountId]);
    await cleanupClient.query('DELETE FROM public.consent_record WHERE account_id = $1', [fixture.accountId]);
    await cleanupClient.query('DELETE FROM public.auth_session WHERE account_id = $1', [fixture.accountId]);
    await cleanupClient.query('DELETE FROM public.customer_profile WHERE id = $1', [fixture.customerId]);
    await cleanupClient.query('DELETE FROM public.account WHERE id = $1', [fixture.accountId]);
    await cleanupClient.query('DELETE FROM public.promotion_asset WHERE id = $1', [fixture.promotionAssetId]);
    await cleanupClient.query('DELETE FROM public.agent_invite_code WHERE id = $1', [fixture.inviteCodeId]);
    await cleanupClient.query('DELETE FROM public.agent_profile WHERE id = $1', [fixture.agentId]);
    await cleanupClient.query('DELETE FROM public.account WHERE id = $1', [fixture.agentAccountId]);
    await cleanupClient.query('COMMIT');
  } catch (error) {
    await cleanupClient?.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    cleanupClient?.release();
    await cleanupPool.end();
  }

  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const residual = await Promise.all([
      runtime.prisma.account.count({ where: { id: { in: [fixture.accountId, fixture.agentAccountId] } } }),
      runtime.prisma.customerProfile.count({ where: { id: fixture.customerId } }),
      runtime.prisma.agentProfile.count({ where: { id: fixture.agentId } }),
      runtime.prisma.agentInviteCode.count({ where: { id: fixture.inviteCodeId } }),
      runtime.prisma.promotionAsset.count({ where: { id: fixture.promotionAssetId } }),
      runtime.prisma.attributionCandidate.count({ where: { promotion_asset_id: fixture.promotionAssetId } }),
      runtime.prisma.authSession.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.consentRecord.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.customerPhoneVerification.count({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.customerAgentBinding.count({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.bindingChangeLog.count({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.accountDeletionRequest.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.highRiskOperationPreview.count({ where: { actor_account_id: fixture.accountId } }),
      runtime.prisma.auditLog.count({
        where: {
          OR: [
            { actor_account_id: fixture.accountId },
            { object_id: fixture.promotionAssetId },
            ...(candidateIds.length > 0 ? [{ object_id: { in: candidateIds } }] : []),
          ],
        },
      }),
      runtime.prisma.idempotencyRecord.count({
        where: {
          OR: [
            { actor_id: fixture.accountId },
            { resource_id: fixture.promotionAssetId },
            ...(sessionIds.length > 0 ? [{ resource_id: { in: sessionIds } }] : []),
            ...(candidateIds.length > 0 ? [{ resource_id: { in: candidateIds } }] : []),
          ],
        },
      }),
      runtime.prisma.outboxEvent.count({
        where: { aggregate_id: fixture.accountId, aggregate_type: 'account' },
      }),
    ]);
    if (residual.some((count) => count !== 0)) {
      throw new Error(`B7 vertical fixture residue: ${JSON.stringify(residual)}`);
    }
  } finally {
    await runtime.disconnect();
  }
}

async function clearRateLimitKeys(requireObserved) {
  const { createClient } = apiRequire('redis');
  const { hashIpAddress } = require('../../packages/platform-core/dist/index.js');
  const sourceHash = hashIpAddress(
    '127.0.0.1',
    Buffer.from(required('AUDIT_IP_HASH_KEY_BASE64'), 'base64'),
  );
  const requiredKeys = [
    `qingxu:store-auth:legal:rate-limit:source:${sourceHash}`,
    `qingxu:store-auth:login:rate-limit:source:${sourceHash}`,
  ];
  const keys = [
    ...requiredKeys,
    `qingxu:store-catalog:rate-limit:source:${sourceHash}`,
  ];
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    await redis.connect();
    const observed = await redis.mGet(keys);
    if (requireObserved && observed.slice(0, requiredKeys.length).some((value) => value === null)) {
      throw new Error(`Expected B7 Redis rate-limit facts were not all created: ${JSON.stringify(observed)}`);
    }
    await redis.del(keys);
    const residual = await redis.mGet(keys);
    if (residual.some((value) => value !== null)) {
      throw new Error(`Redis B7 rate-limit fixture keys remain: ${JSON.stringify(keys)}`);
    }
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

async function main() {
  validateTargets();
  run('pnpm', ['config:check'], 'runtime environment contract');
  run('pnpm', ['build:packages'], 'workspace package build');
  const { createDatabaseRuntime } = require('../../packages/database/dist/src/index.js');
  const { generateUlid, hmacStoreInviteCode, sha256Hex } = require('../../packages/platform-core/dist/index.js');
  const fixture = createFixture(generateUlid, hmacStoreInviteCode, sha256Hex);
  let executionError;
  try {
    await seedFixture(createDatabaseRuntime, fixture);
    Object.assign(process.env, {
      B7_VERTICAL_AGENT_NAME: fixture.agentName,
      B7_VERTICAL_CITY: fixture.updatedCity,
      B7_VERTICAL_INVITE_CODE: fixture.plainInviteCode,
      B7_VERTICAL_LOGIN_CODE: fixture.loginCode,
      B7_VERTICAL_NICKNAME: fixture.updatedNickname,
      B7_VERTICAL_PHONE_CREDENTIAL: fixture.phoneCredential,
      B7_VERTICAL_PROMOTION_ASSET_ID: fixture.promotionAssetId,
      B7_VERTICAL_REPLACEMENT_PHONE_CREDENTIAL: fixture.replacementPhoneCredential,
    });
    run(
      'pnpm',
      ['exec', 'playwright', 'test', '--config', 'playwright.b7-vertical.config.ts'],
      'B7 browser-to-infrastructure Playwright test',
    );
    await assertFixtureResults(createDatabaseRuntime, fixture);
  } catch (error) {
    executionError = error;
  }
  try {
    await clearRateLimitKeys(executionError === undefined);
  } catch (cleanupError) {
    executionError = executionError
      ? new AggregateError([executionError, cleanupError], 'B7 vertical execution and Redis cleanup failed')
      : cleanupError;
  }
  try {
    await deleteFixture(createDatabaseRuntime, fixture);
  } catch (cleanupError) {
    if (executionError) {
      throw new AggregateError([executionError, cleanupError], 'B7 vertical execution and fixture cleanup both failed');
    }
    throw cleanupError;
  }
  if (executionError) throw executionError;
  process.stdout.write(
    'B7.5 browser -> Nest -> PostgreSQL/Redis Mock Provider vertical smoke passed; exact fixture and rate-limit keys cleaned.\n',
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
