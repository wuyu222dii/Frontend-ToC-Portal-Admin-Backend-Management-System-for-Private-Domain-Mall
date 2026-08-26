import { createHash, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const storageRequire = createRequire(new URL('../../packages/storage/package.json', import.meta.url));
const databaseRequire = createRequire(new URL('../../packages/database/package.json', import.meta.url));
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);
const PNG_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');
let s3Client;

function refuse(message) {
  throw new Error(`B6 vertical test refused: ${message}`);
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
  if (process.env.B6_VERTICAL_TEST_MODE !== 'full') refuse('B6_VERTICAL_TEST_MODE must be explicitly set to full');
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' || process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
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
    !/(?:^|[-_])(?:b6|store|catalog|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B6 test database');
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
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same B6 database');
  }
  const storage = parseUrl('S3_ENDPOINT');
  const publicBase = parseUrl('S3_PUBLIC_BASE_URL');
  const bucket = required('S3_BUCKET');
  if (storage.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storage.hostname) || storage.pathname !== '/' ||
    storage.username || storage.password || storage.search || storage.hash) {
    refuse('S3_ENDPOINT must be a credential-free loopback HTTP origin');
  }
  if (!/^mall-b[3-6]-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket) || publicBase.origin !== storage.origin ||
    publicBase.pathname.replace(/\/$/, '') !== `/${bucket}` || publicBase.username || publicBase.password ||
    publicBase.search || publicBase.hash) {
    refuse('S3_PUBLIC_BASE_URL must identify an isolated mall-b3 through mall-b6 bucket on S3_ENDPOINT');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') refuse('S3_FORCE_PATH_STYLE must be true');
  for (const name of ['S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY']) required(name);
}

function createFixture(generateUlid) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  return {
    brandId: generateUlid(),
    brandName: `B6 Vertical Brand ${marker}`,
    categoryId: generateUlid(),
    categoryName: `B6 Vertical Category ${marker}`,
    fileId: generateUlid(),
    imageId: generateUlid(),
    inventoryId: generateUlid(),
    productId: generateUlid(),
    productName: `B6 Vertical Product ${marker}`,
    skuCode: `B6V-SKU-${marker}`,
    skuId: generateUlid(),
    spuCode: `B6V-SPU-${marker}`,
    objectKey: '',
  };
}

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b6-vertical',
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
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY, secretAccessKey: process.env.S3_SECRET_KEY },
    });
  }
  return s3Client;
}

async function putFixtureObject(fixture) {
  const { PutObjectCommand } = storageRequire('@aws-sdk/client-s3');
  await storageClient().send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: fixture.objectKey,
    Body: PNG_BYTES,
    ContentLength: PNG_BYTES.length,
    ContentType: 'image/png',
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
      await transaction.fileAsset.create({
        data: {
          byte_size: BigInt(PNG_BYTES.length),
          created_at: now,
          id: fixture.fileId,
          mime_type: 'image/png',
          object_key: fixture.objectKey,
          original_name: 'b6-vertical.png',
          purpose: 'PRODUCT_IMAGE',
          sha256: PNG_SHA256,
          status: 'READY',
          visibility: 'PUBLIC',
        },
      });
      await transaction.brand.create({
        data: { created_at: now, id: fixture.brandId, name: fixture.brandName, sort_order: 0, status: 'ACTIVE', updated_at: now },
      });
      await transaction.category.create({
        data: { created_at: now, id: fixture.categoryId, name: fixture.categoryName, sort_order: 0, status: 'ACTIVE', updated_at: now },
      });
      await transaction.product.create({
        data: {
          brand_id: fixture.brandId,
          category_id: fixture.categoryId,
          created_at: now,
          id: fixture.productId,
          introduction: 'B6 vertical catalog fixture',
          is_hot: true,
          is_new: true,
          name: fixture.productName,
          published_at: now,
          sales_count: 7,
          spu_code: fixture.spuCode,
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.sku.create({
        data: {
          code: fixture.skuCode,
          created_at: now,
          id: fixture.skuId,
          is_recommended: true,
          name: 'B6 vertical 500ml',
          product_id: fixture.productId,
          retail_price: '39.00',
          spec_json: { attributes: [{ name: '容量', value: '500ml' }] },
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.inventoryBalance.create({
        data: { id: fixture.inventoryId, locked_qty: 0, physical_qty: 7, sku_id: fixture.skuId, updated_at: now },
      });
      await transaction.productImage.create({
        data: { created_at: now, file_id: fixture.fileId, id: fixture.imageId, product_id: fixture.productId, sort_order: 0 },
      });
    });
  } finally {
    await runtime.disconnect();
  }
}

async function deleteFixture(createDatabaseRuntime, fixture) {
  const { DeleteObjectCommand, HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  const client = storageClient();
  let objectError;
  try {
    await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: fixture.objectKey }));
    try {
      await client.send(new HeadObjectCommand({ Bucket: process.env.S3_BUCKET, Key: fixture.objectKey }));
      objectError = new Error(`MinIO fixture object remains after exact cleanup: ${fixture.objectKey}`);
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') objectError = error;
    }
  } catch (error) {
    objectError = error;
  }

  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  let databaseError;
  try {
    const { Pool } = databaseRequire('pg');
    const cleanupPool = new Pool({
      application_name: 'qingxu-b6-vertical-cleanup',
      connectionString: process.env.DIRECT_URL,
      connectionTimeoutMillis: 5_000,
      max: 1,
    });
    let cleanupClient;
    try {
      cleanupClient = await cleanupPool.connect();
      await cleanupClient.query('BEGIN');
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
    const residual = await Promise.all([
      runtime.prisma.productImage.count({ where: { id: fixture.imageId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: fixture.inventoryId } }),
      runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
      runtime.prisma.product.count({ where: { id: fixture.productId } }),
      runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      runtime.prisma.fileAsset.count({ where: { id: fixture.fileId } }),
    ]);
    if (residual.some((count) => count !== 0)) throw new Error(`B6 vertical fixture residue: ${JSON.stringify(residual)}`);
  } finally {
    await runtime.disconnect();
  }
  if (databaseError) throw databaseError;
  if (objectError) throw objectError;
}

async function clearRateLimitKey() {
  const { createClient } = apiRequire('redis');
  const { hashIpAddress } = require('../../packages/platform-core/dist/index.js');
  const key = `qingxu:store-catalog:rate-limit:source:${hashIpAddress(
    '127.0.0.1',
    Buffer.from(required('AUDIT_IP_HASH_KEY_BASE64'), 'base64'),
  )}`;
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    await redis.connect();
    await redis.del(key);
    const residual = await redis.get(key);
    if (residual !== null) throw new Error(`Redis B6 rate-limit fixture key remains: ${key}`);
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

async function main() {
  validateTargets();
  const minioReady = await globalThis.fetch(new URL('/minio/health/ready', required('S3_ENDPOINT'))).then((response) => response.ok).catch(() => false);
  if (!minioReady) refuse('MinIO readiness endpoint is unavailable');
  run('pnpm', ['config:check'], 'runtime environment contract');
  run('pnpm', ['build:packages'], 'workspace package build');
  const { createDatabaseRuntime } = require('../../packages/database/dist/src/index.js');
  const { generateUlid } = require('../../packages/platform-core/dist/index.js');
  const fixture = createFixture(generateUlid);
  fixture.objectKey = `public/${fixture.fileId}`;
  let executionError;
  try {
    await seedFixture(createDatabaseRuntime, fixture);
    Object.assign(process.env, {
      B6_VERTICAL_CATEGORY_NAME: fixture.categoryName,
      B6_VERTICAL_PRODUCT_ID: fixture.productId,
      B6_VERTICAL_PRODUCT_NAME: fixture.productName,
    });
    run('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.b6-vertical.config.ts'], 'B6 browser-to-infrastructure Playwright test');
  } catch (error) {
    executionError = error;
  }
  try {
    await clearRateLimitKey();
  } catch (cleanupError) {
    executionError = executionError
      ? new AggregateError([executionError, cleanupError], 'B6 vertical execution and rate-limit cleanup failed')
      : cleanupError;
  }
  try {
    await deleteFixture(createDatabaseRuntime, fixture);
  } catch (cleanupError) {
    if (executionError) throw new AggregateError([executionError, cleanupError], 'B6 vertical execution and fixture cleanup both failed');
    throw cleanupError;
  }
  if (executionError) throw executionError;
  process.stdout.write('B6.4 browser -> Nest -> PostgreSQL/MinIO vertical smoke passed; fixture and exact object cleaned.\n');
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(() => {
  s3Client?.destroy();
});
