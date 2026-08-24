import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function refuse(message) {
  throw new Error(`B4 vertical test refused: ${message}`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) refuse(`${name} is required`);
  return value;
}

function parseUrl(name) {
  try {
    return new URL(required(name));
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('B4 vertical test refused:')) throw error;
    refuse(`${name} must be a valid URL`);
  }
}

function run(command, args, label) {
  const child = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) {
    throw new Error(`${label} failed${child.status === null ? '' : ` with exit code ${child.status}`}`);
  }
}

function formatError(error) {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map((item) => formatError(item))].join('\n');
  }
  return error instanceof Error ? error.message : 'B4 vertical test failed';
}

function assertTargets() {
  if (process.env.B4_VERTICAL_TEST_MODE !== 'full') {
    refuse('B4_VERTICAL_TEST_MODE must be explicitly set to full');
  }
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
  }

  const databaseUrl = parseUrl('DATABASE_URL');
  let databaseRole;
  let databaseName;
  try {
    databaseRole = decodeURIComponent(databaseUrl.username);
    databaseName = decodeURIComponent(databaseUrl.pathname.slice(1));
  } catch {
    refuse('DATABASE_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol) ||
    !LOOPBACK_HOSTS.has(databaseUrl.hostname) || databaseRole !== 'mall_runtime' ||
    !databaseUrl.password || databaseUrl.search !== '' || databaseUrl.hash !== '' ||
    !/(?:^|[-_])(?:b4|vertical|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B4 test database');
  }
  const directUrl = parseUrl('DIRECT_URL');
  let directRole;
  try {
    directRole = decodeURIComponent(directUrl.username);
  } catch {
    refuse('DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || directRole !== 'mall_migrator' ||
    !directUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    directUrl.hostname !== databaseUrl.hostname || directUrl.port !== databaseUrl.port ||
    directUrl.pathname !== databaseUrl.pathname) {
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same B4 test database');
  }

  const redisUrl = parseUrl('REDIS_URL');
  let redisPassword;
  try {
    redisPassword = decodeURIComponent(redisUrl.password);
  } catch {
    refuse('REDIS_URL contains invalid percent encoding');
  }
  if (redisUrl.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redisUrl.hostname) ||
    redisPassword.length < 12 || redisUrl.search !== '' || redisUrl.hash !== '') {
    refuse('REDIS_URL must be a query-free password-authenticated loopback connection');
  }

  const storageUrl = parseUrl('S3_ENDPOINT');
  const publicBaseUrl = parseUrl('S3_PUBLIC_BASE_URL');
  const bucket = required('S3_BUCKET');
  if (storageUrl.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storageUrl.hostname) ||
    storageUrl.username !== '' || storageUrl.password !== '' || storageUrl.pathname !== '/' ||
    storageUrl.search !== '' || storageUrl.hash !== '') {
    refuse('S3_ENDPOINT must be a credential-free loopback HTTP origin');
  }
  if (!/^mall-(?:b3|b4)-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket)) {
    refuse('S3_BUCKET must be an isolated mall-b3-* or mall-b4-* CI/local/test bucket');
  }
  if (publicBaseUrl.origin !== storageUrl.origin ||
    publicBaseUrl.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBaseUrl.username !== '' || publicBaseUrl.password !== '' ||
    publicBaseUrl.search !== '' || publicBaseUrl.hash !== '') {
    refuse('S3_PUBLIC_BASE_URL must identify S3_BUCKET on S3_ENDPOINT');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') {
    refuse('S3_FORCE_PATH_STYLE must be true for isolated MinIO');
  }
  if (process.env.API_PORT && process.env.API_PORT !== '3000') {
    refuse('API_PORT must be 3000 because the admin development proxy is fixed to that port');
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
  ]) required(name);
}

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b4-vertical',
    connectionTimeoutMs: 5_000,
    databaseUrl: process.env.DATABASE_URL,
    poolMax: 4,
  });
}

function createFixture(generateUlid) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return {
    accountId: generateUlid(),
    brandId: generateUlid(),
    brandName: `B4 Vertical Brand ${marker}`,
    categoryId: generateUlid(),
    categoryName: `B4 Vertical Category ${marker}`,
    loginName: `b4-vertical-${marker.toLowerCase()}`,
    password: `B4-Vertical-${randomBytes(24).toString('base64url')}!`,
    productName: `B4 Vertical Product ${marker}`,
    skuCode: `B4V-SKU-${marker}`,
    skuName: `B4 Vertical SKU ${marker}`,
    spuCode: `B4V-SPU-${marker}`,
  };
}

async function seedFixture(createDatabaseRuntime, AdminAuthRepository, hashPassword, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  try {
    await runtime.connect();
    const passwordHash = await hashPassword(fixture.password);
    const auth = new AdminAuthRepository(runtime.prisma);
    await runtime.withPrismaTransaction(async (transaction) => {
      await auth.bootstrapSuperAdminInTransaction(transaction, {
        accountId: fixture.accountId,
        loginName: fixture.loginName,
        passwordHash,
      });
      await transaction.brand.create({
        data: { id: fixture.brandId, name: fixture.brandName, sort_order: 0, status: 'ACTIVE' },
      });
      await transaction.category.create({
        data: { id: fixture.categoryId, name: fixture.categoryName, sort_order: 0, status: 'ACTIVE' },
      });
    });
  } finally {
    await runtime.disconnect();
  }
}

async function verifyFixture(createDatabaseRuntime, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  try {
    await runtime.connect();
    const product = await runtime.prisma.product.findUnique({
      where: { spu_code: fixture.spuCode },
      include: {
        images: {
          where: { deleted_at: null },
          include: { file: true },
          orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        },
        skus: {
          where: { code: fixture.skuCode },
          include: { inventory_balance: true },
        },
      },
    });
    if (!product || product.status !== 'DRAFT' || product.name !== fixture.productName) {
      throw new Error('PostgreSQL did not persist the expected DRAFT Product');
    }
    const image = product.images[0];
    if (product.images.length !== 1 || !image || image.file.status !== 'READY' ||
      image.file.visibility !== 'PUBLIC' || image.file.purpose !== 'PRODUCT_IMAGE' ||
      image.file.object_key !== `public/${image.file_id}`) {
      throw new Error('PostgreSQL did not persist the expected READY public Product image');
    }
    const sku = product.skus[0];
    if (product.skus.length !== 1 || !sku || sku.status !== 'INACTIVE' || sku.name !== fixture.skuName ||
      !sku.inventory_balance || sku.inventory_balance.physical_qty !== 0 ||
      sku.inventory_balance.locked_qty !== 0) {
      throw new Error('PostgreSQL did not persist the expected INACTIVE SKU with zero inventory');
    }
    process.stdout.write(JSON.stringify({
      file_id: image.file_id,
      product_id: product.id,
      sku_id: sku.id,
      status: 'passed',
    }) + '\n');
  } finally {
    await runtime.disconnect();
  }
}

function storageRuntime(createS3ObjectStorage) {
  return createS3ObjectStorage({
    accessKey: process.env.S3_ACCESS_KEY,
    bucket: process.env.S3_BUCKET,
    endpoint: process.env.S3_ENDPOINT,
    forcePathStyle: true,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL,
    region: process.env.S3_REGION,
    secretKey: process.env.S3_SECRET_KEY,
  });
}

async function cleanupFixture(createDatabaseRuntime, createS3ObjectStorage, ObjectStorageError, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const products = await runtime.prisma.product.findMany({
      where: { OR: [{ spu_code: fixture.spuCode }, { brand_id: fixture.brandId }, { category_id: fixture.categoryId }] },
      select: { id: true },
    });
    const productIds = products.map(({ id }) => id);
    const skus = await runtime.prisma.sku.findMany({
      where: { OR: [{ code: fixture.skuCode }, { product_id: { in: productIds } }] },
      select: { id: true },
    });
    const skuIds = skus.map(({ id }) => id);
    const files = await runtime.prisma.fileAsset.findMany({
      where: { created_by_id: fixture.accountId },
      select: { id: true, object_key: true },
    });
    const fileIds = files.map(({ id }) => id);
    const factors = await runtime.prisma.totpFactor.findMany({
      where: { account_id: fixture.accountId },
      select: { id: true },
    });
    const factorIds = factors.map(({ id }) => id);
    const sessions = await runtime.prisma.authSession.findMany({
      where: { account_id: fixture.accountId },
      select: { id: true },
    });
    const sessionIds = sessions.map(({ id }) => id);
    const challenges = await runtime.prisma.mfaChallenge.findMany({
      where: { account_id: fixture.accountId },
      select: { id: true },
    });
    const challengeIds = challenges.map(({ id }) => id);
    const resourceIds = [
      fixture.accountId,
      fixture.brandId,
      fixture.categoryId,
      ...productIds,
      ...skuIds,
      ...fileIds,
      ...factorIds,
      ...sessionIds,
      ...challengeIds,
    ];

    const objectKeys = new Set(files.flatMap((file) => [
      file.object_key,
      `staging/${file.id}`,
      `public/${file.id}`,
      `private/${file.id}`,
    ]));
    const storage = storageRuntime(createS3ObjectStorage);
    let objectCleanupError;
    try {
      for (const key of objectKeys) await storage.deleteIfExists(key);
      for (const key of objectKeys) {
        try {
          await storage.inspectAndHash({ key, maxBytes: 5_242_880 });
        } catch (error) {
          if (error instanceof ObjectStorageError && error.code === 'OBJECT_NOT_FOUND') continue;
          throw error;
        }
        throw new Error(`MinIO fixture object remains after exact cleanup: ${key}`);
      }
    } catch (error) {
      objectCleanupError = error;
    }

    const databaseRequire = createRequire(new URL('../../packages/database/package.json', import.meta.url));
    const { Pool } = databaseRequire('pg');
    const cleanupPool = new Pool({
      application_name: 'qingxu-b4-vertical-cleanup',
      connectionString: process.env.DIRECT_URL,
      connectionTimeoutMillis: 5_000,
      max: 1,
    });
    let cleanupClient;
    try {
      cleanupClient = await cleanupPool.connect();
      await cleanupClient.query('BEGIN');
      await cleanupClient.query('DELETE FROM public.high_risk_operation_preview WHERE actor_account_id = $1',
        [fixture.accountId]);
      await cleanupClient.query('DELETE FROM public.admin_reauth_grant WHERE account_id = $1', [fixture.accountId]);
      await cleanupClient.query('DELETE FROM public.admin_reauth_attempt WHERE account_id = $1', [fixture.accountId]);
      await cleanupClient.query('DELETE FROM public.totp_recovery_code WHERE factor_id = ANY($1::text[])', [factorIds]);
      await cleanupClient.query('DELETE FROM public.mfa_challenge WHERE account_id = $1', [fixture.accountId]);
      await cleanupClient.query('DELETE FROM public.auth_session WHERE account_id = $1', [fixture.accountId]);
      await cleanupClient.query('DELETE FROM public.totp_factor WHERE account_id = $1', [fixture.accountId]);
      await cleanupClient.query('DELETE FROM public.mfa_rate_limit WHERE account_id = $1', [fixture.accountId]);
      await cleanupClient.query(
        'DELETE FROM public.product_image WHERE product_id = ANY($1::text[]) OR file_id = ANY($2::text[])',
        [productIds, fileIds],
      );
      await cleanupClient.query('DELETE FROM public.inventory_balance WHERE sku_id = ANY($1::text[])', [skuIds]);
      await cleanupClient.query('DELETE FROM public.sku WHERE id = ANY($1::text[])', [skuIds]);
      await cleanupClient.query('DELETE FROM public.product WHERE id = ANY($1::text[])', [productIds]);
      await cleanupClient.query('DELETE FROM public.file_asset WHERE id = ANY($1::text[])', [fileIds]);
      await cleanupClient.query(
        'DELETE FROM public.idempotency_record WHERE actor_id = $1 OR resource_id = ANY($2::text[])',
        [fixture.accountId, resourceIds],
      );
      await cleanupClient.query('DELETE FROM public.outbox_event WHERE aggregate_id = ANY($1::text[])', [resourceIds]);
      await cleanupClient.query(
        'DELETE FROM public.audit_log WHERE actor_account_id = $1 OR object_id = ANY($2::text[])',
        [fixture.accountId, resourceIds],
      );
      await cleanupClient.query('DELETE FROM public.brand WHERE id = $1', [fixture.brandId]);
      await cleanupClient.query('DELETE FROM public.category WHERE id = $1', [fixture.categoryId]);
      await cleanupClient.query('DELETE FROM public.account WHERE id = $1', [fixture.accountId]);
      await cleanupClient.query('COMMIT');
    } catch (error) {
      await cleanupClient?.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      cleanupClient?.release();
      await cleanupPool.end();
    }

    const residualCounts = {
      account: await runtime.prisma.account.count({ where: { id: fixture.accountId } }),
      audit: await runtime.prisma.auditLog.count({
        where: { OR: [{ actor_account_id: fixture.accountId }, { object_id: { in: resourceIds } }] },
      }),
      brand: await runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      category: await runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      file: await runtime.prisma.fileAsset.count({
        where: { OR: [{ id: { in: fileIds } }, { created_by_id: fixture.accountId }] },
      }),
      idempotency: await runtime.prisma.idempotencyRecord.count({
        where: { OR: [{ actor_id: fixture.accountId }, { resource_id: { in: resourceIds } }] },
      }),
      inventory: await runtime.prisma.inventoryBalance.count({ where: { sku_id: { in: skuIds } } }),
      mfaChallenge: await runtime.prisma.mfaChallenge.count({ where: { account_id: fixture.accountId } }),
      mfaFactor: await runtime.prisma.totpFactor.count({ where: { account_id: fixture.accountId } }),
      mfaRateLimit: await runtime.prisma.mfaRateLimit.count({ where: { account_id: fixture.accountId } }),
      mfaRecoveryCode: await runtime.prisma.totpRecoveryCode.count({ where: { factor_id: { in: factorIds } } }),
      outbox: await runtime.prisma.outboxEvent.count({ where: { aggregate_id: { in: resourceIds } } }),
      preview: await runtime.prisma.highRiskOperationPreview.count({
        where: { actor_account_id: fixture.accountId },
      }),
      product: await runtime.prisma.product.count({ where: { id: { in: productIds } } }),
      productImage: await runtime.prisma.productImage.count({
        where: { OR: [{ product_id: { in: productIds } }, { file_id: { in: fileIds } }] },
      }),
      session: await runtime.prisma.authSession.count({ where: { account_id: fixture.accountId } }),
      sku: await runtime.prisma.sku.count({ where: { id: { in: skuIds } } }),
    };
    const residual = Object.entries(residualCounts).filter(([, count]) => count !== 0);
    if (residual.length) throw new Error(`B4 vertical fixture residue: ${JSON.stringify(Object.fromEntries(residual))}`);
    if (objectCleanupError) throw objectCleanupError;
    process.stdout.write('B4 vertical fixture and exact MinIO objects cleaned.\n');
  } finally {
    await runtime.disconnect();
  }
}

async function main() {
  assertTargets();
  process.env.API_PORT = '3000';
  const minioHealth = new URL('/minio/health/ready', required('S3_ENDPOINT'));
  const minioResponse = await globalThis.fetch(minioHealth, {
    signal: globalThis.AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!minioResponse?.ok) refuse('MinIO readiness endpoint is unavailable');

  run('pnpm', ['config:check'], 'runtime environment contract');
  run('pnpm', ['build:packages'], 'workspace package build');
  const { AdminAuthRepository, createDatabaseRuntime } = require('../../packages/database/dist/src/index.js');
  const { generateUlid, hashPassword } = require('../../packages/platform-core/dist/index.js');
  const { createS3ObjectStorage, ObjectStorageError } = require('../../packages/storage/dist/index.js');
  const fixture = createFixture(generateUlid);

  let executionError;
  try {
    await seedFixture(createDatabaseRuntime, AdminAuthRepository, hashPassword, fixture);
    Object.assign(process.env, {
      B4_VERTICAL_BRAND_NAME: fixture.brandName,
      B4_VERTICAL_CATEGORY_NAME: fixture.categoryName,
      B4_VERTICAL_LOGIN_NAME: fixture.loginName,
      B4_VERTICAL_PASSWORD: fixture.password,
      B4_VERTICAL_PRODUCT_NAME: fixture.productName,
      B4_VERTICAL_SKU_CODE: fixture.skuCode,
      B4_VERTICAL_SKU_NAME: fixture.skuName,
      B4_VERTICAL_SPU_CODE: fixture.spuCode,
    });
    run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.b4-vertical.config.ts'],
      'browser-to-infrastructure Playwright test');
    await verifyFixture(createDatabaseRuntime, fixture);
  } catch (error) {
    executionError = error;
  }
  try {
    await cleanupFixture(createDatabaseRuntime, createS3ObjectStorage, ObjectStorageError, fixture);
  } catch (cleanupError) {
    if (executionError) throw new AggregateError([executionError, cleanupError],
      'B4 vertical execution and fixture cleanup both failed');
    throw cleanupError;
  }
  if (executionError) throw executionError;
  process.stdout.write('B4.4 browser -> Nest -> PostgreSQL/Redis/MinIO vertical smoke passed.\n');
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
