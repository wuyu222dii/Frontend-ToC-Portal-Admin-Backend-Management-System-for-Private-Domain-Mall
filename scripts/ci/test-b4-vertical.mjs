import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { basename } from 'node:path';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const VERTICAL_STAGE = basename(process.argv[1] ?? '') === 'test-b5-vertical.mjs' ? 'B5' : 'B4';
const VERTICAL_MODE_NAME = `${VERTICAL_STAGE}_VERTICAL_TEST_MODE`;
const OTHER_VERTICAL_MODE_NAME = `${VERTICAL_STAGE === 'B5' ? 'B4' : 'B5'}_VERTICAL_TEST_MODE`;
const EXPECTED_IMAGE_BYTE_SIZE = 68n;
const EXPECTED_IMAGE_SHA256 = '25f526ccd5c301880be1ceff8e6b725ea6f8509aaaaed330c9a9a94648536106';

function refuse(message) {
  throw new Error(`${VERTICAL_STAGE} vertical test refused: ${message}`);
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
    if (error instanceof Error && error.message.startsWith(`${VERTICAL_STAGE} vertical test refused:`)) throw error;
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
  return error instanceof Error ? error.message : `${VERTICAL_STAGE} vertical test failed`;
}

function assertTargets() {
  if (process.env[VERTICAL_MODE_NAME] !== 'full') {
    refuse(`${VERTICAL_MODE_NAME} must be explicitly set to full`);
  }
  if (process.env[OTHER_VERTICAL_MODE_NAME] === 'full') {
    refuse(`${OTHER_VERTICAL_MODE_NAME} must not also be set to full`);
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
    !/(?:^|[-_])(?:b4|b5|vertical|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
    refuse(`DATABASE_URL must be a query-free loopback mall_runtime ${VERTICAL_STAGE} test database`);
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
    refuse(`DIRECT_URL must be a query-free loopback mall_migrator connection to the same ${VERTICAL_STAGE} test database`);
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
  if (!/^mall-(?:b3|b4|b5)-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket)) {
    refuse('S3_BUCKET must be an isolated mall-b3-*, mall-b4-* or mall-b5-* CI/local/test bucket');
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
    applicationName: `qingxu-${VERTICAL_STAGE.toLowerCase()}-vertical`,
    connectionTimeoutMs: 5_000,
    databaseUrl: process.env.DATABASE_URL,
    poolMax: 4,
  });
}

function createFixture(generateUlid) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const stage = VERTICAL_STAGE;
  return {
    accountId: generateUlid(),
    brandId: generateUlid(),
    bannerTitle: `${stage} Vertical Banner ${marker}`,
    brandName: `${stage} Vertical Brand ${marker}`,
    categoryId: generateUlid(),
    categoryName: `${stage} Vertical Category ${marker}`,
    loginName: `${stage.toLowerCase()}-vertical-${marker.toLowerCase()}`,
    password: `${stage}-Vertical-${randomBytes(24).toString('base64url')}!`,
    productName: `${stage} Vertical Product ${marker}`,
    skuCode: `${stage}V-SKU-${marker}`,
    skuName: `${stage} Vertical SKU ${marker}`,
    spuCode: `${stage}V-SPU-${marker}`,
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

async function verifyFixture(createDatabaseRuntime, createS3ObjectStorage, fixture) {
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
      image.file.object_key !== `public/${image.file_id}` || image.file.mime_type !== 'image/png' ||
      image.file.byte_size !== EXPECTED_IMAGE_BYTE_SIZE || image.file.sha256 !== EXPECTED_IMAGE_SHA256) {
      throw new Error('PostgreSQL did not persist the expected READY public Product image');
    }
    const sku = product.skus[0];
    const expectedPhysicalQty = VERTICAL_STAGE === 'B5' ? 7 : 0;
    if (product.skus.length !== 1 || !sku || sku.status !== 'INACTIVE' || sku.name !== fixture.skuName ||
      !sku.inventory_balance || sku.inventory_balance.physical_qty !== expectedPhysicalQty ||
      sku.inventory_balance.locked_qty !== 0) {
      throw new Error(`PostgreSQL did not persist the expected INACTIVE SKU with ${expectedPhysicalQty} inventory`);
    }
    let banner;
    let ledger;
    if (VERTICAL_STAGE === 'B5') {
      banner = await runtime.prisma.banner.findFirst({
        where: { title: fixture.bannerTitle },
        include: { file: true },
      });
      if (!banner || banner.status !== 'ACTIVE' || banner.target_type !== 'NONE' || banner.version !== 2 ||
        banner.file.status !== 'READY' || banner.file.visibility !== 'PUBLIC' || banner.file.purpose !== 'BANNER' ||
        banner.file.object_key !== `public/${banner.file_id}` || banner.file.mime_type !== 'image/png' ||
        banner.file.byte_size !== EXPECTED_IMAGE_BYTE_SIZE || banner.file.sha256 !== EXPECTED_IMAGE_SHA256 ||
        banner.file.object_key === image.file.object_key) {
        throw new Error('PostgreSQL did not persist the expected ACTIVE Banner with a READY public image');
      }
      const storage = storageRuntime(createS3ObjectStorage);
      for (const key of [image.file.object_key, banner.file.object_key]) {
        const inspected = await storage.inspectAndHash({ key, maxBytes: Number(EXPECTED_IMAGE_BYTE_SIZE) });
        if (inspected.byteSize !== Number(EXPECTED_IMAGE_BYTE_SIZE) || inspected.mimeType !== 'image/png' ||
          inspected.sha256Hex !== EXPECTED_IMAGE_SHA256) {
          throw new Error(`MinIO final object did not match the expected PNG: ${key}`);
        }
      }
      const balance = await runtime.prisma.inventoryBalance.findUnique({ where: { sku_id: sku.id } });
      if (!balance || balance.physical_qty !== 7 || balance.locked_qty !== 0 || balance.version !== 2) {
        throw new Error('PostgreSQL did not persist the expected adjusted Inventory balance');
      }
      ledger = await runtime.prisma.inventoryLedger.findMany({ where: { sku_id: sku.id } });
      if (ledger.length !== 1 || ledger[0]?.ledger_type !== 'MANUAL_INCREASE' ||
        ledger[0].physical_change !== 7 || ledger[0].physical_after !== 7 ||
        ledger[0].reason !== 'B5 vertical inventory verification') {
        throw new Error('PostgreSQL did not persist exactly one expected Inventory ledger entry');
      }

      const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
      const { createClient } = apiRequire('redis');
      const redis = createClient({ url: process.env.REDIS_URL });
      try {
        await redis.connect();
        const leaseKeys = [image.file_id, banner.file_id].map((fileId) => `file-object:v1:${fileId}`);
        const leases = await redis.mGet(leaseKeys);
        if (leases.some((value) => value !== null)) {
          throw new Error('Redis retained a file completion owner lease');
        }
      } finally {
        if (redis.isOpen) await redis.quit();
      }
    }
    process.stdout.write(JSON.stringify({
      banner_id: banner?.id,
      file_id: image.file_id,
      inventory_ledger_id: ledger?.[0]?.id,
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
    const banners = await runtime.prisma.banner.findMany({
      where: { title: fixture.bannerTitle },
      select: { id: true },
    });
    const bannerIds = banners.map(({ id }) => id);
    const ledgers = await runtime.prisma.inventoryLedger.findMany({
      where: { sku_id: { in: skuIds } },
      select: { id: true },
    });
    const ledgerIds = ledgers.map(({ id }) => id);
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
      ...bannerIds,
      ...productIds,
      ...skuIds,
      ...ledgerIds,
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

    let redisCleanupError;
    if (fileIds.length) {
      const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
      const { createClient } = apiRequire('redis');
      const redis = createClient({ url: process.env.REDIS_URL });
      const leaseKeys = fileIds.map((fileId) => `file-object:v1:${fileId}`);
      try {
        await redis.connect();
        await redis.del(leaseKeys);
        const leases = await redis.mGet(leaseKeys);
        if (leases.some((value) => value !== null)) {
          throw new Error('Redis fixture file completion lease remains after exact cleanup');
        }
      } catch (error) {
        redisCleanupError = error;
      } finally {
        if (redis.isOpen) await redis.quit();
      }
    }

    const databaseRequire = createRequire(new URL('../../packages/database/package.json', import.meta.url));
    const { Pool } = databaseRequire('pg');
    const cleanupPool = new Pool({
      application_name: `qingxu-${VERTICAL_STAGE.toLowerCase()}-vertical-cleanup`,
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
      await cleanupClient.query('DELETE FROM public.banner WHERE id = ANY($1::text[])', [bannerIds]);
      await cleanupClient.query(
        'DELETE FROM public.product_image WHERE product_id = ANY($1::text[]) OR file_id = ANY($2::text[])',
        [productIds, fileIds],
      );
      await cleanupClient.query('DELETE FROM public.inventory_ledger WHERE sku_id = ANY($1::text[])', [skuIds]);
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
      banner: await runtime.prisma.banner.count({ where: { id: { in: bannerIds } } }),
      category: await runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      file: await runtime.prisma.fileAsset.count({
        where: { OR: [{ id: { in: fileIds } }, { created_by_id: fixture.accountId }] },
      }),
      idempotency: await runtime.prisma.idempotencyRecord.count({
        where: { OR: [{ actor_id: fixture.accountId }, { resource_id: { in: resourceIds } }] },
      }),
      inventory: await runtime.prisma.inventoryBalance.count({ where: { sku_id: { in: skuIds } } }),
      inventoryLedger: await runtime.prisma.inventoryLedger.count({ where: { id: { in: ledgerIds } } }),
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
    if (residual.length) {
      throw new Error(`${VERTICAL_STAGE} vertical fixture residue: ${JSON.stringify(Object.fromEntries(residual))}`);
    }
    const infrastructureCleanupErrors = [objectCleanupError, redisCleanupError].filter(Boolean);
    if (infrastructureCleanupErrors.length) {
      throw new AggregateError(infrastructureCleanupErrors, `${VERTICAL_STAGE} infrastructure cleanup failed`);
    }
    process.stdout.write(`${VERTICAL_STAGE} vertical fixture and exact MinIO objects cleaned.\n`);
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
      [`${VERTICAL_STAGE}_VERTICAL_BANNER_TITLE`]: fixture.bannerTitle,
      [`${VERTICAL_STAGE}_VERTICAL_BRAND_NAME`]: fixture.brandName,
      [`${VERTICAL_STAGE}_VERTICAL_CATEGORY_NAME`]: fixture.categoryName,
      [`${VERTICAL_STAGE}_VERTICAL_LOGIN_NAME`]: fixture.loginName,
      [`${VERTICAL_STAGE}_VERTICAL_PASSWORD`]: fixture.password,
      [`${VERTICAL_STAGE}_VERTICAL_PRODUCT_NAME`]: fixture.productName,
      [`${VERTICAL_STAGE}_VERTICAL_SKU_CODE`]: fixture.skuCode,
      [`${VERTICAL_STAGE}_VERTICAL_SKU_NAME`]: fixture.skuName,
      [`${VERTICAL_STAGE}_VERTICAL_SPU_CODE`]: fixture.spuCode,
    });
    const playwrightConfig = VERTICAL_STAGE === 'B5'
      ? 'playwright.b5-vertical.config.ts'
      : 'playwright.b4-vertical.config.ts';
    run('pnpm', ['exec', 'playwright', 'test', '--config', playwrightConfig],
      'browser-to-infrastructure Playwright test');
    await verifyFixture(createDatabaseRuntime, createS3ObjectStorage, fixture);
  } catch (error) {
    executionError = error;
  }
  try {
    await cleanupFixture(createDatabaseRuntime, createS3ObjectStorage, ObjectStorageError, fixture);
  } catch (cleanupError) {
    if (executionError) throw new AggregateError([executionError, cleanupError],
      `${VERTICAL_STAGE} vertical execution and fixture cleanup both failed`);
    throw cleanupError;
  }
  if (executionError) throw executionError;
  process.stdout.write(`${VERTICAL_STAGE}.4 browser -> Nest -> PostgreSQL/Redis/MinIO vertical smoke passed.\n`);
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
});
