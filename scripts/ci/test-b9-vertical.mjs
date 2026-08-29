import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const CAPABILITY_FINGERPRINT_DOMAIN = 'qingxu:b9-vertical-capability:v1\0';
let s3Client;

function refuse(message) {
  throw new Error(`B9 vertical test refused: ${message}`);
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

function runCaptured(command, args) {
  const child = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 512 * 1_024,
    stdio: 'pipe',
  });
  return {
    failed: child.error !== undefined || child.status !== 0,
    output: `${child.stdout ?? ''}${child.stderr ?? ''}`,
  };
}

function fingerprintCapability(value, key) {
  return createHmac('sha256', key)
    .update(CAPABILITY_FINGERPRINT_DOMAIN, 'utf8')
    .update(value, 'utf8')
    .digest('hex');
}

async function readCapabilityFingerprints(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('B9 vertical capability fingerprint artifact is missing or invalid');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((item) =>
    typeof item !== 'object' || item === null || Array.isArray(item) ||
    Object.keys(item).sort().join(',') !== 'digest,length' ||
    typeof item.length !== 'number' || !Number.isSafeInteger(item.length) ||
    item.length < 32 || item.length > 4_096 ||
    typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest))) {
    throw new Error('B9 vertical capability fingerprint artifact violates its closed schema');
  }
  return parsed;
}

function assertNoCapabilityFingerprint(text, fingerprints, key, location) {
  for (const { digest, length } of fingerprints) {
    if (text.length < length) continue;
    for (let offset = 0; offset <= text.length - length; offset += 1) {
      const candidate = text.slice(offset, offset + length);
      if (fingerprintCapability(candidate, key) === digest) {
        throw new Error(`B9 vertical checkout capability leaked into ${location}`);
      }
    }
  }
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
  if (process.env.B9_VERTICAL_TEST_MODE !== 'full') {
    refuse('B9_VERTICAL_TEST_MODE must be explicitly set to full');
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
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B9 test database');
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
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same B9 database');
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
  if (!/^mall-b[3-9]-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket) ||
    publicBase.origin !== storage.origin ||
    publicBase.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBase.username || publicBase.password || publicBase.search || publicBase.hash) {
    refuse('S3_PUBLIC_BASE_URL must identify an isolated B3 through B9 bucket on S3_ENDPOINT');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') refuse('S3_FORCE_PATH_STYLE must be true');

  const ports = [
    testPort('B9_VERTICAL_API_PORT', '3000'),
    testPort('B9_VERTICAL_WORKER_PORT', '3001'),
    testPort('B9_VERTICAL_WEB_PORT', '5173'),
  ];
  if (new Set(ports).size !== ports.length) refuse('B9 vertical API, Worker and web ports must be different');
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
  const loginCode = `mock:b9_vertical_${marker.toLowerCase()}`;
  return {
    accountId: generateUlid(),
    brandId: generateUlid(),
    brandName: `B9 Vertical Brand ${marker}`,
    categoryId: generateUlid(),
    categoryName: `B9 Vertical Category ${marker}`,
    customerId: generateUlid(),
    expiredAddressSnapshotId: generateUlid(),
    expiredAttributionId: generateUlid(),
    expiredCreatedAuditId: generateUlid(),
    expiredCreatedOutboxId: generateUlid(),
    expiredOrderId: generateUlid(),
    expiredOrderItemId: generateUlid(),
    expiredReservationId: generateUlid(),
    expiredReservationItemId: generateUlid(),
    expiredReserveLedgerId: generateUlid(),
    fileId: generateUlid(),
    imageId: generateUlid(),
    inventoryId: generateUlid(),
    loginCode,
    marker,
    objectKey: '',
    productId: generateUlid(),
    productName: `B9 Vertical Product ${marker}`,
    skuCode: `B9V-SKU-${marker}`,
    skuId: generateUlid(),
    spuCode: `B9V-SPU-${marker}`,
    wechatOpenId: `mock_${sha256Hex(`${required('STORE_WECHAT_APP_ID')}\0${loginCode}`)}`,
  };
}

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b9-vertical',
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
    const expiredCreatedAt = new Date(now.getTime() - 31 * 60 * 1_000);
    const expiredPayExpiresAt = new Date(expiredCreatedAt.getTime() + 30 * 60 * 1_000);
    const { createStoreOrderAddressSecurityMaterial } =
      require('../../packages/platform-core/dist/index.js');
    const expiredAddress = createStoreOrderAddressSecurityMaterial({
      detail: '文一路 99 号 B9 纵向测试',
      phone: ['137', '0000', '0009'].join(''),
      snapshotId: fixture.expiredAddressSnapshotId,
    }, {
      id: required('FIELD_ENCRYPTION_KEY_ID'),
      key: Buffer.from(required('FIELD_ENCRYPTION_KEY_BASE64'), 'base64'),
    });
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
          nickname: `B9 Customer ${fixture.marker}`,
        },
      });
      await transaction.fileAsset.create({
        data: {
          byte_size: BigInt(PNG_BYTES.length),
          created_at: now,
          id: fixture.fileId,
          mime_type: 'image/png',
          object_key: fixture.objectKey,
          original_name: 'b9-vertical.png',
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
          introduction: 'B9 vertical order fixture',
          is_hot: true,
          is_new: true,
          name: fixture.productName,
          published_at: now,
          sales_count: 9,
          spu_code: fixture.spuCode,
          status: 'ACTIVE',
          subtitle: 'B9 browser to Worker verification',
          updated_at: now,
        },
      });
      await transaction.sku.create({
        data: {
          code: fixture.skuCode,
          created_at: now,
          id: fixture.skuId,
          is_recommended: true,
          name: 'B9 vertical 500ml',
          product_id: fixture.productId,
          retail_price: '49.00',
          spec_json: { attributes: [{ name: 'Volume', value: '500ml' }] },
          status: 'ACTIVE',
          updated_at: now,
        },
      });
      await transaction.inventoryBalance.create({
        data: {
          id: fixture.inventoryId,
          locked_qty: 1,
          physical_qty: 8,
          sku_id: fixture.skuId,
          updated_at: expiredCreatedAt,
          version: 2,
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
      await transaction.salesOrder.create({
        data: {
          created_at: expiredCreatedAt,
          customer_id: fixture.customerId,
          goods_amount: '49.00',
          id: fixture.expiredOrderId,
          order_no: `QX${fixture.expiredOrderId}`,
          paid_amount: '0.00',
          pay_expires_at: expiredPayExpiresAt,
          payable_amount: '49.00',
          refunded_amount: '0.00',
          shipping_amount: '0.00',
          source: 'BUY_NOW',
          updated_at: expiredCreatedAt,
        },
      });
      await transaction.orderItem.create({
        data: {
          aftersale_reserved_amount: '0.00',
          aftersale_reserved_qty: 0,
          brand_name_snapshot: fixture.brandName,
          category_id: fixture.categoryId,
          category_name_snapshot: fixture.categoryName,
          created_at: expiredCreatedAt,
          id: fixture.expiredOrderItemId,
          line_paid_amount: '49.00',
          order_id: fixture.expiredOrderId,
          pre_shipment_refunded_qty: 0,
          product_id: fixture.productId,
          product_name_snapshot: fixture.productName,
          quantity: 1,
          refunded_amount: '0.00',
          refunded_qty: 0,
          shipped_qty: 0,
          sku_code_snapshot: fixture.skuCode,
          sku_id: fixture.skuId,
          sku_name_snapshot: 'B9 vertical 500ml',
          unit_price: '49.00',
        },
      });
      await transaction.orderAddressSnapshot.create({
        data: {
          city: '杭州市',
          created_at: expiredCreatedAt,
          detail_ciphertext: expiredAddress.detailCiphertext,
          district: '西湖区',
          encryption_key_id: expiredAddress.encryptionKeyId,
          id: fixture.expiredAddressSnapshotId,
          order_id: fixture.expiredOrderId,
          phone_ciphertext: expiredAddress.phoneCiphertext,
          phone_last4: expiredAddress.phoneLast4,
          province: '浙江省',
          recipient_name: '纵向用户',
        },
      });
      await transaction.orderAttributionCandidate.create({
        data: {
          id: fixture.expiredAttributionId,
          order_id: fixture.expiredOrderId,
          submit_channel: 'DIRECT',
          submitted_at: expiredCreatedAt,
        },
      });
      await transaction.inventoryReservation.create({
        data: {
          created_at: expiredCreatedAt,
          expires_at: expiredPayExpiresAt,
          id: fixture.expiredReservationId,
          order_id: fixture.expiredOrderId,
          status: 'ACTIVE',
        },
      });
      await transaction.inventoryReservationItem.create({
        data: {
          created_at: expiredCreatedAt,
          id: fixture.expiredReservationItemId,
          quantity: 1,
          reservation_id: fixture.expiredReservationId,
          sku_id: fixture.skuId,
        },
      });
      await transaction.inventoryLedger.create({
        data: {
          actor_account_id: fixture.accountId,
          business_id: fixture.expiredReservationId,
          id: fixture.expiredReserveLedgerId,
          ledger_type: 'ORDER_RESERVE',
          locked_after: 1,
          locked_change: 1,
          occurred_at: expiredCreatedAt,
          physical_after: 8,
          physical_change: 0,
          reason: 'ORDER_RESERVE',
          sku_id: fixture.skuId,
        },
      });
      await transaction.auditLog.create({
        data: {
          action: 'CREATE',
          actor_account_id: fixture.accountId,
          actor_role: 'CUSTOMER',
          after_json: { status: 'PENDING_PAYMENT', version: 1 },
          id: fixture.expiredCreatedAuditId,
          module: 'order',
          object_id: fixture.expiredOrderId,
          object_type: 'order',
          occurred_at: expiredCreatedAt,
          request_id: `b9-vertical-seed-${fixture.marker}`,
          result: 'SUCCESS',
          result_code: 'OK',
        },
      });
      await transaction.outboxEvent.create({
        data: {
          aggregate_id: fixture.expiredOrderId,
          aggregate_type: 'order',
          created_at: expiredCreatedAt,
          event_type: 'order.created',
          id: fixture.expiredCreatedOutboxId,
          payload: {
            event_version: 1,
            resource_id: fixture.expiredOrderId,
            resource_type: 'order',
            resource_version: 1,
          },
        },
      });
    });
  } finally {
    await runtime.disconnect();
  }
}

async function assertFixtureResults(createDatabaseRuntime, fixture, capabilityFingerprints, capabilityKey) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const orders = await runtime.prisma.salesOrder.findMany({
      include: {
        address_snapshot: true,
        attribution_candidate: true,
        inventory_reservation: { include: { items: true } },
        items: true,
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      where: { customer_id: fixture.customerId },
    });
    if (orders.length !== 2) throw new Error('B9 vertical expected one API order and one expired fixture order');
    const orderIds = orders.map(({ id }) => id);
    const reservationIds = orders.flatMap(({ inventory_reservation: reservation }) =>
      reservation ? [reservation.id] : []);
    const [balance, ledgers, audits, outbox, sessions, addresses, accountIdempotency] = await Promise.all([
      runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.inventoryId } }),
      runtime.prisma.inventoryLedger.findMany({
        orderBy: [{ business_id: 'asc' }, { ledger_type: 'asc' }],
        where: { business_id: { in: reservationIds }, sku_id: fixture.skuId },
      }),
      runtime.prisma.auditLog.findMany({
        where: { object_id: { in: orderIds }, object_type: 'order' },
      }),
      runtime.prisma.outboxEvent.findMany({ where: { aggregate_id: { in: orderIds }, aggregate_type: 'order' } }),
      runtime.prisma.authSession.findMany({ where: { account_id: fixture.accountId } }),
      runtime.prisma.customerAddress.findMany({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.idempotencyRecord.findMany({ where: { actor_id: fixture.accountId } }),
    ]);
    const loginIdempotency = await runtime.prisma.idempotencyRecord.findMany({
      where: {
        actor_id: LOGIN_IDEMPOTENCY_ACTOR,
        resource_id: { in: sessions.map(({ id }) => id) },
      },
    });
    const byReason = new Map(orders.map((order) => [order.close_reason, order]));
    const cancelled = byReason.get('USER_CANCELLED');
    const expired = byReason.get('PAYMENT_TIMEOUT');
    if (!cancelled || !expired || orders.some((order) =>
      order.order_status !== 'CLOSED' || order.payment_status !== 'UNPAID' || order.version !== 2 ||
      order.items.length !== 1 || order.items[0]?.sku_id !== fixture.skuId ||
      order.address_snapshot === null || order.attribution_candidate === null ||
      order.inventory_reservation === null || order.inventory_reservation.items.length !== 1)) {
      throw new Error('B9 vertical order projections do not match cancel and timeout flows');
    }
    if (cancelled.inventory_reservation?.status !== 'RELEASED' ||
      expired.inventory_reservation?.status !== 'EXPIRED' ||
      reservationIds.length !== 2 || !balance || balance.physical_qty !== 8 ||
      balance.locked_qty !== 0 || balance.version !== 5 || ledgers.length !== 4) {
      throw new Error('B9 vertical reservation or inventory facts are invalid');
    }
    for (const reservationId of reservationIds) {
      const types = ledgers.filter(({ business_id: businessId }) => businessId === reservationId)
        .map(({ ledger_type: type }) => type).sort();
      if (types.join(',') !== 'ORDER_RELEASE,ORDER_RESERVE') {
        throw new Error('B9 vertical reservation ledger pair is incomplete');
      }
    }
    if (audits.length !== 4 || outbox.length !== 4 ||
      outbox.filter(({ event_type: type }) => type === 'order.created').length !== 2 ||
      outbox.filter(({ event_type: type }) => type === 'order.closed').length !== 2 ||
      sessions.length !== 1 || addresses.length !== 1 || accountIdempotency.length !== 3 ||
      loginIdempotency.length !== 1) {
      throw new Error('B9 vertical audit, Outbox, session or idempotency facts are invalid');
    }
    const address = addresses[0];
    const phone = ['137', '0000', '0009'].join('');
    const detail = '文一路 99 号 B9 纵向测试';
    if (!address || Buffer.from(address.phone_ciphertext).includes(Buffer.from(phone)) ||
      Buffer.from(address.detail_ciphertext).includes(Buffer.from(detail)) ||
      orders.some((order) => !order.address_snapshot ||
        Buffer.from(order.address_snapshot.phone_ciphertext).includes(Buffer.from(phone)) ||
        Buffer.from(order.address_snapshot.detail_ciphertext).includes(Buffer.from(detail)))) {
      throw new Error('B9 vertical address or frozen order snapshot is not encrypted');
    }
    const idempotency = [...accountIdempotency, ...loginIdempotency];
    if (idempotency.some((record) => record.response_body !== null ||
      !/^[a-f0-9]{64}$/.test(record.request_hash) ||
      !/^[a-f0-9]{64}$/.test(record.response_body_hash))) {
      throw new Error('B9 vertical idempotency facts are not HASH_ONLY');
    }
    const protectedFacts = JSON.stringify({ audits, idempotency, outbox });
    assertNoCapabilityFingerprint(
      protectedFacts,
      capabilityFingerprints,
      capabilityKey,
      'durable audit, idempotency or Outbox metadata',
    );
    for (const value of ['纵向用户', phone, detail, 'quote_token']) {
      if (protectedFacts.includes(value)) {
        throw new Error('B9 vertical PII or quote capability leaked into durable metadata');
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
    let observationError;
    try {
      const observed = await redis.mGet(keys);
      if (requireObserved && observed.some((value) => value === null)) {
        observationError = new Error('Expected B9 Redis rate-limit facts were not all created');
      }
    } catch {
      observationError = new Error('B9 Redis rate-limit fact inspection failed');
    }
    let cleanupError;
    try {
      await redis.del(keys);
      const residual = await redis.mGet(keys);
      if (residual.some((value) => value !== null)) {
        cleanupError = new Error('Redis B9 rate-limit fixture keys remain after cleanup');
      }
    } catch {
      cleanupError = new Error('B9 Redis rate-limit fixture cleanup failed');
    }
    if (observationError && cleanupError) {
      throw new AggregateError([observationError, cleanupError], 'B9 Redis observation and cleanup failed');
    }
    if (observationError) throw observationError;
    if (cleanupError) throw cleanupError;
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

async function deleteFixture(createDatabaseRuntime, fixture) {
  const { DeleteObjectCommand, HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  let objectError;
  try {
    await storageClient().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: fixture.objectKey }));
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
    application_name: 'qingxu-b9-vertical-cleanup',
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let cleanupClient;
  let databaseError;
  let orderIds = [];
  let reservationIds = [];
  let resourceIds = [];
  try {
    cleanupClient = await cleanupPool.connect();
    await cleanupClient.query('BEGIN');
    const orders = await cleanupClient.query(
      'SELECT id::text FROM public.sales_order WHERE customer_id = $1',
      [fixture.customerId],
    );
    orderIds = orders.rows.map(({ id }) => id);
    const reservations = await cleanupClient.query(
      'SELECT id::text FROM public.inventory_reservation WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    reservationIds = reservations.rows.map(({ id }) => id);
    const resources = await cleanupClient.query(
      `SELECT id::text FROM public.auth_session WHERE account_id = $1
       UNION ALL SELECT id::text FROM public.customer_address WHERE customer_id = $2`,
      [fixture.accountId, fixture.customerId],
    );
    resourceIds = [...resources.rows.map(({ id }) => id), ...orderIds];
    await cleanupClient.query(
      `DELETE FROM public.audit_log
       WHERE actor_account_id = $1 OR object_id::text = ANY($2::text[])`,
      [fixture.accountId, resourceIds],
    );
    await cleanupClient.query(
      `DELETE FROM public.idempotency_record
       WHERE actor_id = $1 OR resource_id::text = ANY($2::text[])`,
      [fixture.accountId, resourceIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.outbox_event WHERE aggregate_id::text = ANY($1::text[])',
      [orderIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.inventory_ledger WHERE sku_id = $1 AND business_id::text = ANY($2::text[])',
      [fixture.skuId, reservationIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.inventory_reservation_item WHERE reservation_id::text = ANY($1::text[])',
      [reservationIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.inventory_reservation WHERE id::text = ANY($1::text[])',
      [reservationIds],
    );
    for (const table of ['order_attribution_candidate', 'order_address_snapshot', 'order_item']) {
      await cleanupClient.query(`DELETE FROM public.${table} WHERE order_id::text = ANY($1::text[])`, [orderIds]);
    }
    await cleanupClient.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [orderIds]);
    await cleanupClient.query(
      `DELETE FROM public.cart_item
       WHERE cart_id IN (SELECT id FROM public.cart WHERE customer_id = $1)`,
      [fixture.customerId],
    );
    await cleanupClient.query('DELETE FROM public.cart WHERE customer_id = $1', [fixture.customerId]);
    await cleanupClient.query('DELETE FROM public.favorite WHERE customer_id = $1', [fixture.customerId]);
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
      runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
      runtime.prisma.inventoryReservation.count({ where: { id: { in: reservationIds } } }),
      runtime.prisma.inventoryReservationItem.count({ where: { reservation_id: { in: reservationIds } } }),
      runtime.prisma.orderItem.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.orderAddressSnapshot.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.orderAttributionCandidate.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      runtime.prisma.auditLog.count({
        where: { OR: [{ actor_account_id: fixture.accountId }, { object_id: { in: resourceIds } }] },
      }),
      runtime.prisma.idempotencyRecord.count({
        where: { OR: [{ actor_id: fixture.accountId }, { resource_id: { in: resourceIds } }] },
      }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: { in: orderIds } } }),
      runtime.prisma.productImage.count({ where: { id: fixture.imageId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: fixture.inventoryId } }),
      runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
      runtime.prisma.product.count({ where: { id: fixture.productId } }),
      runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      runtime.prisma.fileAsset.count({ where: { id: fixture.fileId } }),
    ]);
    if (residual.some((count) => count !== 0)) {
      throw new Error(`B9 vertical fixture residue: ${JSON.stringify(residual)}`);
    }
  } finally {
    await runtime.disconnect();
  }
  if (databaseError) throw databaseError;
  if (objectError) throw objectError;
}

async function main() {
  const mode = process.env.B9_VERTICAL_TEST_MODE?.trim();
  if (mode !== 'full') refuse('B9_VERTICAL_TEST_MODE must be explicitly set to full');
  validateTargets();
  const apiPort = testPort('B9_VERTICAL_API_PORT', '3000');
  const workerPort = testPort('B9_VERTICAL_WORKER_PORT', '3001');
  const webPort = testPort('B9_VERTICAL_WEB_PORT', '5173');
  Object.assign(process.env, {
    B9_VERTICAL_API_PORT: apiPort,
    B9_VERTICAL_WEB_PORT: webPort,
    B9_VERTICAL_WORKER_PORT: workerPort,
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
  const capabilityDirectory = await mkdtemp(join(tmpdir(), 'qingxu-b9-vertical-capability-'));
  const capabilityArtifactPath = join(capabilityDirectory, 'fingerprints.json');
  const capabilityKey = randomBytes(32);
  Object.assign(process.env, {
    B9_VERTICAL_CAPABILITY_ARTIFACT_PATH: capabilityArtifactPath,
    B9_VERTICAL_CAPABILITY_HMAC_KEY_BASE64: capabilityKey.toString('base64'),
  });
  let executionError;
  try {
    try {
      await seedFixture(createDatabaseRuntime, fixture);
      Object.assign(process.env, {
        B9_VERTICAL_ACCOUNT_ID: fixture.accountId,
        B9_VERTICAL_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
        B9_VERTICAL_EXPIRED_ORDER_ID: fixture.expiredOrderId,
        B9_VERTICAL_LOGIN_CODE: fixture.loginCode,
        B9_VERTICAL_PRODUCT_ID: fixture.productId,
        B9_VERTICAL_PRODUCT_NAME: fixture.productName,
        B9_VERTICAL_SKU_ID: fixture.skuId,
        B9_VERTICAL_WORKER_ORIGIN: `http://127.0.0.1:${workerPort}`,
      });
      const playwright = runCaptured(
        'pnpm',
        ['exec', 'playwright', 'test', '--config', 'playwright.b9-vertical.config.ts'],
      );
      let capabilityFingerprints;
      try {
        capabilityFingerprints = await readCapabilityFingerprints(capabilityArtifactPath);
      } catch (error) {
        if (playwright.failed) {
          throw new Error(
            'B9 browser-to-Worker Playwright test failed; captured output was suppressed and the capability artifact was unavailable',
          );
        }
        throw error;
      }
      assertNoCapabilityFingerprint(
        playwright.output,
        capabilityFingerprints,
        capabilityKey,
        'captured API, Worker or browser test output',
      );
      if (playwright.failed) {
        throw new Error(
          'B9 browser-to-Worker Playwright test failed; captured output was suppressed to protect checkout capabilities',
        );
      }
      await assertFixtureResults(
        createDatabaseRuntime,
        fixture,
        capabilityFingerprints,
        capabilityKey,
      );
    } catch (error) {
      executionError = error;
    }
    try {
      await clearRateLimitKeys(fixture, executionError === undefined);
    } catch (cleanupError) {
      executionError = executionError
        ? new AggregateError([executionError, cleanupError], 'B9 vertical execution and Redis cleanup failed')
        : cleanupError;
    }
    try {
      await deleteFixture(createDatabaseRuntime, fixture);
    } catch (cleanupError) {
      executionError = executionError
        ? new AggregateError(
          [executionError, cleanupError],
          'B9 vertical execution and PostgreSQL/MinIO cleanup both failed',
        )
        : cleanupError;
    }
  } finally {
    try {
      await rm(capabilityDirectory, { force: true, recursive: true });
    } catch (cleanupError) {
      executionError = executionError
        ? new AggregateError(
          [executionError, cleanupError],
          'B9 vertical execution and capability artifact cleanup both failed',
        )
        : cleanupError;
    } finally {
      capabilityKey.fill(0);
      delete process.env.B9_VERTICAL_CAPABILITY_ARTIFACT_PATH;
      delete process.env.B9_VERTICAL_CAPABILITY_HMAC_KEY_BASE64;
    }
  }
  if (executionError) throw executionError;
  process.stdout.write(
    'B9.5 browser -> Nest -> PostgreSQL/Redis/MinIO -> Worker vertical smoke passed; exact fixture, keys and object cleaned.\n',
  );
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exitCode = 1;
}).finally(() => {
  s3Client?.destroy();
});
