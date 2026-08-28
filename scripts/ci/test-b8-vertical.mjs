import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const databaseRequire = createRequire(new URL('../../packages/database/package.json', import.meta.url));
const storageRequire = createRequire(new URL('../../packages/storage/package.json', import.meta.url));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOGIN_IDEMPOTENCY_ACTOR = '00000000000000000000000000';
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);
const PNG_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');
let s3Client;

function refuse(message) {
  throw new Error(`B8 vertical test refused: ${message}`);
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
  const child = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error || child.status !== 0) throw new Error(`${label} failed`);
}

function formatError(error) {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map((item) => formatError(item))].join('\n');
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function testPort(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[0-9]{2,5}$/.test(value) || Number(value) < 1_024 || Number(value) > 65_535) {
    refuse(`${name} must be an unprivileged TCP port`);
  }
  return value;
}

function validateTargets() {
  if (process.env.B8_VERTICAL_TEST_MODE !== 'full') {
    refuse('B8_VERTICAL_TEST_MODE must be explicitly set to full');
  }
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
  }
  if (process.env.STORE_IDENTITY_PROVIDER !== 'MOCK' || process.env.STORE_PHONE_PROVIDER !== 'MOCK') {
    refuse('STORE_IDENTITY_PROVIDER and STORE_PHONE_PROVIDER must both be MOCK');
  }

  const database = parseUrl('DATABASE_URL');
  let databaseName;
  let databaseRole;
  try {
    databaseName = decodeURIComponent(database.pathname.slice(1));
    databaseRole = decodeURIComponent(database.username);
  } catch {
    refuse('DATABASE_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
    !LOOPBACK_HOSTS.has(database.hostname) || databaseRole !== 'mall_runtime' ||
    !database.password || database.search !== '' || database.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B8 test database');
  }

  const direct = parseUrl('DIRECT_URL');
  let directRole;
  try {
    directRole = decodeURIComponent(direct.username);
  } catch {
    refuse('DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) ||
    !LOOPBACK_HOSTS.has(direct.hostname) || directRole !== 'mall_migrator' ||
    !direct.password || direct.search !== '' || direct.hash !== '' ||
    direct.hostname !== database.hostname || direct.port !== database.port ||
    direct.pathname !== database.pathname) {
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same B8 database');
  }

  const redis = parseUrl('REDIS_URL');
  let redisPassword;
  try {
    redisPassword = decodeURIComponent(redis.password);
  } catch {
    refuse('REDIS_URL contains invalid percent encoding');
  }
  if (redis.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redis.hostname) ||
    redisPassword.length < 12 || redis.search !== '' || redis.hash !== '' ||
    !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)) {
    refuse('REDIS_URL must be a password-protected loopback Redis database 1 through 15 reserved for this test');
  }

  const storage = parseUrl('S3_ENDPOINT');
  const publicBase = parseUrl('S3_PUBLIC_BASE_URL');
  const bucket = required('S3_BUCKET');
  if (storage.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storage.hostname) ||
    storage.pathname !== '/' || storage.username || storage.password || storage.search || storage.hash) {
    refuse('S3_ENDPOINT must be a credential-free loopback HTTP origin');
  }
  if (!/^mall-b[3-8]-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket) ||
    publicBase.origin !== storage.origin ||
    publicBase.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBase.username || publicBase.password || publicBase.search || publicBase.hash) {
    refuse('S3_PUBLIC_BASE_URL must identify an isolated B3 through B8 bucket on S3_ENDPOINT');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') refuse('S3_FORCE_PATH_STYLE must be true');
  const apiPort = testPort('B8_VERTICAL_API_PORT', '3000');
  const webPort = testPort('B8_VERTICAL_WEB_PORT', '5173');
  if (apiPort === webPort) refuse('B8 vertical API and web ports must be different');
  for (const name of [
    'AUDIT_IP_HASH_KEY_BASE64',
    'FIELD_ENCRYPTION_KEY_BASE64',
    'FIELD_ENCRYPTION_KEY_ID',
    'IDEMPOTENCY_HASH_KEY_BASE64',
    'S3_ACCESS_KEY',
    'S3_REGION',
    'S3_SECRET_KEY',
    'STORE_PHONE_HASH_KEY_BASE64',
    'STORE_WECHAT_APP_ID',
  ]) required(name);
}

function createFixture(generateUlid, sha256Hex) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const loginCode = `mock:b8_vertical_${marker.toLowerCase()}`;
  return {
    accountId: generateUlid(),
    brandId: generateUlid(),
    brandName: `B8 Vertical Brand ${marker}`,
    categoryId: generateUlid(),
    categoryName: `B8 Vertical Category ${marker}`,
    customerId: generateUlid(),
    fileId: generateUlid(),
    imageId: generateUlid(),
    inventoryId: generateUlid(),
    loginCode,
    marker,
    objectKey: '',
    productId: generateUlid(),
    productName: `B8 Vertical Product ${marker}`,
    skuCode: `B8V-SKU-${marker}`,
    skuId: generateUlid(),
    spuCode: `B8V-SPU-${marker}`,
    wechatOpenId: `mock_${sha256Hex(`${required('STORE_WECHAT_APP_ID')}\0${loginCode}`)}`,
  };
}

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b8-vertical',
    connectionTimeoutMs: 5_000,
    databaseUrl: process.env.DATABASE_URL,
    poolMax: 4,
  });
}

function storageClient() {
  const { S3Client } = storageRequire('@aws-sdk/client-s3');
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      region: process.env.S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY,
        secretAccessKey: process.env.S3_SECRET_KEY,
      },
    });
  }
  return s3Client;
}

async function putFixtureObject(fixture) {
  const { PutObjectCommand } = storageRequire('@aws-sdk/client-s3');
  await storageClient().send(new PutObjectCommand({
    Body: PNG_BYTES,
    Bucket: process.env.S3_BUCKET,
    ContentLength: PNG_BYTES.length,
    ContentType: 'image/png',
    Key: fixture.objectKey,
    Metadata: { sha256: PNG_SHA256 },
  }));
}

async function seedFixture(createDatabaseRuntime, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    await putFixtureObject(fixture);
    const now = new Date();
    await runtime.withPrismaTransaction(async (transaction) => {
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
          nickname: `B8 Customer ${fixture.marker}`,
        },
      });
      await transaction.fileAsset.create({
        data: {
          byte_size: BigInt(PNG_BYTES.length),
          created_at: now,
          id: fixture.fileId,
          mime_type: 'image/png',
          object_key: fixture.objectKey,
          original_name: 'b8-vertical.png',
          purpose: 'PRODUCT_IMAGE',
          sha256: PNG_SHA256,
          status: 'READY',
          visibility: 'PUBLIC',
        },
      });
      await transaction.brand.create({
        data: {
          created_at: now,
          id: fixture.brandId,
          name: fixture.brandName,
          sort_order: 0,
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.category.create({
        data: {
          created_at: now,
          id: fixture.categoryId,
          name: fixture.categoryName,
          sort_order: 0,
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.product.create({
        data: {
          brand_id: fixture.brandId,
          category_id: fixture.categoryId,
          created_at: now,
          id: fixture.productId,
          introduction: 'B8 vertical shopping fixture',
          is_hot: true,
          is_new: true,
          name: fixture.productName,
          published_at: now,
          sales_count: 8,
          spu_code: fixture.spuCode,
          status: 'ACTIVE',
          subtitle: 'B8 browser to infrastructure verification',
          updated_at: now,
        },
      });
      await transaction.sku.create({
        data: {
          code: fixture.skuCode,
          created_at: now,
          id: fixture.skuId,
          is_recommended: true,
          name: 'B8 vertical 500ml',
          product_id: fixture.productId,
          retail_price: '39.00',
          spec_json: { attributes: [{ name: 'Volume', value: '500ml' }] },
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.inventoryBalance.create({
        data: {
          id: fixture.inventoryId,
          locked_qty: 0,
          physical_qty: 8,
          sku_id: fixture.skuId,
          updated_at: now,
        },
      });
      await transaction.productImage.create({
        data: {
          created_at: now,
          file_id: fixture.fileId,
          id: fixture.imageId,
          product_id: fixture.productId,
          sort_order: 0,
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
    const [account, favorites, cart, addresses, sessions, consentCount, audits] = await Promise.all([
      runtime.prisma.account.findUnique({ where: { id: fixture.accountId } }),
      runtime.prisma.favorite.findMany({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.cart.findUnique({
        include: { items: { orderBy: [{ created_at: 'asc' }, { id: 'asc' }] } },
        where: { customer_id: fixture.customerId },
      }),
      runtime.prisma.customerAddress.findMany({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.authSession.findMany({ where: { account_id: fixture.accountId } }),
      runtime.prisma.consentRecord.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.auditLog.findMany({ where: { actor_account_id: fixture.accountId } }),
    ]);
    const sessionIds = sessions.map(({ id }) => id);
    const [accountIdempotency, loginIdempotency] = await Promise.all([
      runtime.prisma.idempotencyRecord.findMany({ where: { actor_id: fixture.accountId } }),
      runtime.prisma.idempotencyRecord.findMany({
        where: {
          actor_id: LOGIN_IDEMPOTENCY_ACTOR,
          resource_id: { in: sessionIds },
        },
      }),
    ]);
    const address = addresses[0];
    const cartItem = cart?.items[0];
    if (!account || account.wechat_open_id !== fixture.wechatOpenId || account.last_login_at === null ||
      favorites.length !== 1 || favorites[0]?.product_id !== fixture.productId ||
      !cart || cart.items.length !== 1 || !cartItem || cartItem.sku_id !== fixture.skuId ||
      cartItem.quantity !== 2 || cartItem.selected !== false ||
      addresses.length !== 1 || !address || address.deleted_at !== null || !address.is_default ||
      address.version !== 1 || address.phone_last4 !== '0008' || consentCount !== 2 ||
      sessions.length !== 1 || accountIdempotency.length !== 4 || loginIdempotency.length !== 1 ||
      audits.length < 5) {
      throw new Error('B8 vertical database facts do not match the completed browser flow');
    }
    const phone = ['138', '0000', '0008'].join('');
    const detail = '文一路 88 号 B8 纵向测试';
    const phoneCiphertext = Buffer.from(address.phone_ciphertext);
    const detailCiphertext = Buffer.from(address.detail_ciphertext);
    if (phoneCiphertext.includes(Buffer.from(phone)) || detailCiphertext.includes(Buffer.from(detail)) ||
      address.phone_hash === phone || !/^[a-f0-9]{64}$/.test(address.phone_hash) ||
      address.encryption_key_id !== required('FIELD_ENCRYPTION_KEY_ID')) {
      throw new Error('B8 vertical address protection facts are invalid');
    }
    const idempotency = [...accountIdempotency, ...loginIdempotency];
    if (idempotency.some((record) => record.response_body !== null ||
      !/^[a-f0-9]{64}$/.test(record.request_hash) ||
      !/^[a-f0-9]{64}$/.test(record.response_body_hash))) {
      throw new Error('B8 vertical idempotency facts are not HASH_ONLY');
    }
    const preferenceSafeFacts = JSON.stringify({ audits, idempotency });
    for (const value of ['纵向用户', phone, detail]) {
      if (preferenceSafeFacts.includes(value)) {
        throw new Error('B8 vertical PII leaked into audit or idempotency facts');
      }
    }
  } finally {
    await runtime.disconnect();
  }
}

async function clearRateLimitKeys(fixture, requireObserved) {
  const { createClient } = apiRequire('redis');
  const { hashIpAddress } = require('../../packages/platform-core/dist/index.js');
  const ipKey = Buffer.from(required('AUDIT_IP_HASH_KEY_BASE64'), 'base64');
  const sourceHash = hashIpAddress('127.0.0.1', ipKey);
  const customerDigest = createHmac('sha256', ipKey)
    .update('qingxu:store-customer-rate-limit:v1', 'utf8')
    .update('\0', 'utf8')
    .update(fixture.customerId, 'utf8')
    .update('\0', 'utf8')
    .update('127.0.0.1', 'utf8')
    .digest('hex');
  const keys = [
    `qingxu:store-auth:legal:rate-limit:source:${sourceHash}`,
    `qingxu:store-auth:login:rate-limit:source:${sourceHash}`,
    `qingxu:store-catalog:rate-limit:source:${sourceHash}`,
    `qingxu:store-customer:rate-limit:subject:${customerDigest}`,
  ];
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    await redis.connect();
    const observed = await redis.mGet(keys);
    const requiredObserved = [observed[0], observed[1], observed[3]];
    if (requireObserved && requiredObserved.some((value) => value === null)) {
      throw new Error(`Expected B8 Redis rate-limit facts were not created: ${JSON.stringify(observed)}`);
    }
    await redis.del(keys);
    const residual = await redis.mGet(keys);
    if (residual.some((value) => value !== null)) {
      throw new Error(`Redis B8 rate-limit fixture keys remain: ${JSON.stringify(keys)}`);
    }
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

async function deleteFixture(createDatabaseRuntime, fixture) {
  const { DeleteObjectCommand, HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  let objectError;
  try {
    await storageClient().send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: fixture.objectKey,
    }));
    try {
      await storageClient().send(new HeadObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: fixture.objectKey,
      }));
      objectError = new Error(`MinIO fixture object remains after exact cleanup: ${fixture.objectKey}`);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' &&
        error?.name !== 'NoSuchKey') objectError = error;
    }
  } catch (error) {
    objectError = error;
  }

  const { Pool } = databaseRequire('pg');
  const cleanupPool = new Pool({
    application_name: 'qingxu-b8-vertical-cleanup',
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let cleanupClient;
  let databaseError;
  let resourceIds = [];
  try {
    cleanupClient = await cleanupPool.connect();
    await cleanupClient.query('BEGIN');
    const resources = await cleanupClient.query(
      `SELECT id::text
       FROM public.auth_session
       WHERE account_id = $1
       UNION ALL
       SELECT id::text
       FROM public.customer_address
       WHERE customer_id = $2`,
      [fixture.accountId, fixture.customerId],
    );
    resourceIds = resources.rows.map(({ id }) => id);
    await cleanupClient.query(
      `DELETE FROM public.audit_log
       WHERE actor_account_id = $1
          OR object_id::text = ANY($2::text[])`,
      [fixture.accountId, resourceIds],
    );
    await cleanupClient.query(
      `DELETE FROM public.idempotency_record
       WHERE actor_id = $1
          OR resource_id::text = ANY($2::text[])`,
      [fixture.accountId, resourceIds],
    );
    await cleanupClient.query('DELETE FROM public.favorite WHERE customer_id = $1', [fixture.customerId]);
    await cleanupClient.query(
      `DELETE FROM public.cart_item
       WHERE cart_id IN (SELECT id FROM public.cart WHERE customer_id = $1)`,
      [fixture.customerId],
    );
    await cleanupClient.query('DELETE FROM public.cart WHERE customer_id = $1', [fixture.customerId]);
    await cleanupClient.query('DELETE FROM public.customer_address WHERE customer_id = $1', [fixture.customerId]);
    await cleanupClient.query('DELETE FROM public.consent_record WHERE account_id = $1', [fixture.accountId]);
    await cleanupClient.query('DELETE FROM public.auth_session WHERE account_id = $1', [fixture.accountId]);
    await cleanupClient.query('DELETE FROM public.customer_profile WHERE id = $1', [fixture.customerId]);
    await cleanupClient.query('DELETE FROM public.account WHERE id = $1', [fixture.accountId]);
    await cleanupClient.query('DELETE FROM public.product_image WHERE id = $1', [fixture.imageId]);
    await cleanupClient.query('DELETE FROM public.inventory_balance WHERE id = $1', [fixture.inventoryId]);
    await cleanupClient.query('DELETE FROM public.sku WHERE id = $1', [fixture.skuId]);
    await cleanupClient.query('DELETE FROM public.product WHERE id = $1', [fixture.productId]);
    await cleanupClient.query('DELETE FROM public.brand WHERE id = $1', [fixture.brandId]);
    await cleanupClient.query('DELETE FROM public.category WHERE id = $1', [fixture.categoryId]);
    await cleanupClient.query('DELETE FROM public.file_asset WHERE id = $1', [fixture.fileId]);
    await cleanupClient.query('COMMIT');
  } catch (error) {
    databaseError = error;
    await cleanupClient?.query('ROLLBACK').catch(() => undefined);
  } finally {
    cleanupClient?.release();
    await cleanupPool.end();
  }

  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const residual = await Promise.all([
      runtime.prisma.account.count({ where: { id: fixture.accountId } }),
      runtime.prisma.customerProfile.count({ where: { id: fixture.customerId } }),
      runtime.prisma.authSession.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.consentRecord.count({ where: { account_id: fixture.accountId } }),
      runtime.prisma.favorite.count({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.cart.count({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.customerAddress.count({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      runtime.prisma.idempotencyRecord.count({
        where: {
          OR: [
            { actor_id: fixture.accountId },
            ...(resourceIds.length > 0 ? [{ resource_id: { in: resourceIds } }] : []),
          ],
        },
      }),
      runtime.prisma.productImage.count({ where: { id: fixture.imageId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: fixture.inventoryId } }),
      runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
      runtime.prisma.product.count({ where: { id: fixture.productId } }),
      runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      runtime.prisma.fileAsset.count({ where: { id: fixture.fileId } }),
    ]);
    if (residual.some((count) => count !== 0)) {
      throw new Error(`B8 vertical fixture residue: ${JSON.stringify(residual)}`);
    }
  } finally {
    await runtime.disconnect();
  }
  if (databaseError) throw databaseError;
  if (objectError) throw objectError;
}

async function main() {
  const mode = process.env.B8_VERTICAL_TEST_MODE?.trim();
  if (!mode) {
    process.stdout.write('B8.5 vertical smoke designed skip: set B8_VERTICAL_TEST_MODE=full only for explicit ephemeral loopback infrastructure.\n');
    return;
  }
  if (mode !== 'full') refuse('B8_VERTICAL_TEST_MODE must be full when provided');
  validateTargets();
  const apiPort = testPort('B8_VERTICAL_API_PORT', '3000');
  const webPort = testPort('B8_VERTICAL_WEB_PORT', '5173');
  Object.assign(process.env, {
    B8_VERTICAL_API_PORT: apiPort,
    B8_VERTICAL_WEB_PORT: webPort,
  });
  const minioReady = await globalThis.fetch(
    new URL('/minio/health/ready', required('S3_ENDPOINT')),
  ).then((response) => response.ok).catch(() => false);
  if (!minioReady) refuse('MinIO readiness endpoint is unavailable');
  run('pnpm', ['config:check'], 'runtime environment contract');
  run('pnpm', ['build:packages'], 'workspace package build');
  const { createDatabaseRuntime } = require('../../packages/database/dist/src/index.js');
  const { generateUlid, sha256Hex } = require('../../packages/platform-core/dist/index.js');
  const fixture = createFixture(generateUlid, sha256Hex);
  fixture.objectKey = `public/${fixture.fileId}`;
  let executionError;
  try {
    await seedFixture(createDatabaseRuntime, fixture);
    Object.assign(process.env, {
      B8_VERTICAL_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
      B8_VERTICAL_LOGIN_CODE: fixture.loginCode,
      B8_VERTICAL_PRODUCT_ID: fixture.productId,
      B8_VERTICAL_PRODUCT_NAME: fixture.productName,
      B8_VERTICAL_SKU_ID: fixture.skuId,
    });
    run(
      'pnpm',
      ['exec', 'playwright', 'test', '--config', 'playwright.b8-vertical.config.ts'],
      'B8 browser-to-infrastructure Playwright test',
    );
    await assertFixtureResults(createDatabaseRuntime, fixture);
  } catch (error) {
    executionError = error;
  }
  try {
    await clearRateLimitKeys(fixture, executionError === undefined);
  } catch (cleanupError) {
    executionError = executionError
      ? new AggregateError([executionError, cleanupError], 'B8 vertical execution and Redis cleanup failed')
      : cleanupError;
  }
  try {
    await deleteFixture(createDatabaseRuntime, fixture);
  } catch (cleanupError) {
    if (executionError) {
      throw new AggregateError(
        [executionError, cleanupError],
        'B8 vertical execution and PostgreSQL/MinIO cleanup both failed',
      );
    }
    throw cleanupError;
  }
  if (executionError) throw executionError;
  process.stdout.write(
    'B8.5 browser -> Nest -> PostgreSQL/Redis/MinIO vertical smoke passed; exact fixture, keys and object cleaned.\n',
  );
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}).finally(() => {
  s3Client?.destroy();
});
