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
const paymentRequire = createRequire(new URL('../../packages/payment/package.json', import.meta.url));
const storageRequire = createRequire(new URL('../../packages/storage/package.json', import.meta.url));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOGIN_IDEMPOTENCY_ACTOR = '00000000000000000000000000';
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);
const PNG_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');
const CAPABILITY_FINGERPRINT_DOMAIN = 'qingxu:b10-vertical-capability:v1\0';
let s3Client;

class SafeDiagnosticError extends Error {
  constructor(message) {
    super(message);
    this.name = 'SafeDiagnosticError';
  }
}

function refuse(message) {
  throw new Error(`B10 vertical test refused: ${message}`);
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

function secretRepresentations(base64Value) {
  const bytes = Buffer.from(base64Value, 'base64');
  const decimalBytes = [...bytes];
  const spacedHex = decimalBytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return [...new Set([
    base64Value,
    bytes.toString('hex'),
    spacedHex,
    `<Buffer ${spacedHex}>`,
    JSON.stringify(bytes),
    JSON.stringify(decimalBytes),
    decimalBytes.join(','),
  ])];
}

function environmentProtectedValues() {
  const secretName = /(?:ACCESS_KEY|AUTHORIZATION|CREDENTIAL|DATABASE_URL|DIRECT_URL|ENCRYPTION|HASH_KEY|PASSWORD|PRIVATE_KEY|REDIS_URL|SECRET|SIGNING|TOKEN)/u;
  const values = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (!secretName.test(name) || typeof value !== 'string' || value.length < 6) continue;
    values.push(value);
    if (name.endsWith('_BASE64')) values.push(...secretRepresentations(value));
  }
  return values;
}

async function readCapabilityFingerprints(path) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('B10 vertical capability fingerprint artifact is missing or invalid');
  }
  if (!Array.isArray(parsed) || parsed.length !== 2 || parsed.some((item) =>
    typeof item !== 'object' || item === null || Array.isArray(item) ||
    Object.keys(item).sort().join(',') !== 'digest,length' ||
    typeof item.length !== 'number' || !Number.isSafeInteger(item.length) ||
    item.length < 32 || item.length > 4_096 ||
    typeof item.digest !== 'string' || !/^[a-f0-9]{64}$/.test(item.digest))) {
    throw new Error('B10 vertical capability fingerprint artifact violates its closed schema');
  }
  return parsed;
}

function assertNoCapabilityFingerprint(text, fingerprints, key, location) {
  for (const { digest, length } of fingerprints) {
    if (text.includes(digest)) {
      throw new Error(`B10 vertical protected fingerprint leaked into ${location}`);
    }
    if (text.length < length) continue;
    for (let offset = 0; offset <= text.length - length; offset += 1) {
      const candidate = text.slice(offset, offset + length);
      if (fingerprintCapability(candidate, key) === digest) {
        throw new Error(`B10 vertical checkout capability leaked into ${location}`);
      }
    }
  }
}

function protectedFingerprints(values, key) {
  return [...new Set(values)]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .map((value) => ({ digest: fingerprintCapability(value, key), value }));
}

function assertNoKnownProtectedValues(text, protectedValues, location) {
  for (const [index, { digest, value }] of protectedValues.entries()) {
    if (text.includes(value) || text.includes(digest)) {
      const leakingLine = text.split(/\r?\n/u)
        .find((line) => line.includes(value) || line.includes(digest)) ?? '';
      let sanitizedLine = leakingLine;
      for (const protectedValue of protectedValues) {
        sanitizedLine = sanitizedLine
          .replaceAll(protectedValue.value, '[REDACTED]')
          .replaceAll(protectedValue.digest, '[REDACTED]');
      }
      throw new Error(
        `B10 vertical protected diagnostic class ${index} leaked into ${location}; context: ${
          sanitizedLine.slice(0, 500) || '[REDACTED]'}`,
      );
    }
  }
}

function minimalSanitizedDiagnostic(text, protectedValues) {
  let sanitized = text;
  for (const { digest, value } of protectedValues) {
    sanitized = sanitized.replaceAll(value, '[REDACTED]').replaceAll(digest, '[REDACTED]');
  }
  const lines = sanitized.split(/\r?\n/u).map((line) => line.trimEnd()).filter(Boolean);
  const minimal = lines.slice(-40).join('\n').slice(-6_000);
  return minimal || 'No non-sensitive Playwright diagnostic was available.';
}

function testPort(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[0-9]{2,5}$/.test(value) || Number(value) < 1_024 || Number(value) > 65_535) {
    refuse(`${name} must be an unprivileged TCP port`);
  }
  return value;
}

function validateTargets() {
  if (process.env.B10_VERTICAL_TEST_MODE !== 'full') {
    refuse('B10_VERTICAL_TEST_MODE must be explicitly set to full');
  }
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
  }
  if (process.env.STORE_IDENTITY_PROVIDER !== 'MOCK' || process.env.STORE_PHONE_PROVIDER !== 'MOCK') {
    refuse('STORE_IDENTITY_PROVIDER and STORE_PHONE_PROVIDER must both be MOCK');
  }
  if (process.env.STORE_PAYMENT_PROVIDER !== 'MOCK') {
    refuse('STORE_PAYMENT_PROVIDER must be MOCK');
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
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B10 test database');
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
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same B10 database');
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
  if (!/^mall-b(?:[3-9]|10)-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket) ||
    publicBase.origin !== storage.origin ||
    publicBase.pathname.replace(/\/$/, '') !== `/${bucket}` ||
    publicBase.username || publicBase.password || publicBase.search || publicBase.hash) {
    refuse('S3_PUBLIC_BASE_URL must identify an isolated B3 through B10 bucket on S3_ENDPOINT');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') refuse('S3_FORCE_PATH_STYLE must be true');

  const ports = [
    testPort('B10_VERTICAL_API_PORT', '3000'),
    testPort('B10_VERTICAL_WORKER_PORT', '3001'),
    testPort('B10_VERTICAL_WEB_PORT', '5173'),
  ];
  if (new Set(ports).size !== ports.length) refuse('B10 vertical API, Worker and web ports must be different');
  for (const name of [
    'AUDIT_IP_HASH_KEY_BASE64',
    'FIELD_ENCRYPTION_KEY_BASE64',
    'FIELD_ENCRYPTION_KEY_ID',
    'IDEMPOTENCY_HASH_KEY_BASE64',
    'PAYMENT_MOCK_SIGNING_KEY_BASE64',
    'PAYMENT_PROVIDER_TIMEOUT_MS',
    'S3_ACCESS_KEY',
    'S3_REGION',
    'S3_SECRET_KEY',
    'STORE_PHONE_HASH_KEY_BASE64',
    'STORE_WECHAT_APP_ID',
  ]) required(name);
}

function createFixture(generateUlid, sha256Hex) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const loginCode = `mock:b10_vertical_${marker.toLowerCase()}`;
  const expiredPaymentIntentId = generateUlid();
  return {
    accountId: generateUlid(),
    brandId: generateUlid(),
    brandName: `B10 Vertical Brand ${marker}`,
    categoryId: generateUlid(),
    categoryName: `B10 Vertical Category ${marker}`,
    customerId: generateUlid(),
    expiredAddressSnapshotId: generateUlid(),
    expiredAttributionId: generateUlid(),
    expiredCreatedAuditId: generateUlid(),
    expiredCreatedOutboxId: generateUlid(),
    expiredOrderId: generateUlid(),
    expiredOrderItemId: generateUlid(),
    expiredPaymentIntentId,
    expiredReservationId: generateUlid(),
    expiredReservationItemId: generateUlid(),
    expiredReserveLedgerId: generateUlid(),
    expiredIntentNo: `PI${expiredPaymentIntentId}`,
    fileId: generateUlid(),
    imageId: generateUlid(),
    inventoryId: generateUlid(),
    loginCode,
    marker,
    objectKey: '',
    productId: generateUlid(),
    productName: `B10 Vertical Product ${marker}`,
    skuCode: `B10V-SKU-${marker}`,
    skuId: generateUlid(),
    spuCode: `B10V-SPU-${marker}`,
    wechatOpenId: `mock_${sha256Hex(`${required('STORE_WECHAT_APP_ID')}\0${loginCode}`)}`,
  };
}

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b10-vertical',
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

async function createExpiredMockProviderIntent(fixture, expiresAt) {
  const { createClient } = apiRequire('redis');
  const { RedisMockPaymentProvider } = paymentRequire('@qingxu/payment');
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    await redis.connect();
    const provider = new RedisMockPaymentProvider({
      environment: 'test',
      signingKey: Buffer.from(required('PAYMENT_MOCK_SIGNING_KEY_BASE64'), 'base64'),
      timeoutMs: Number(required('PAYMENT_PROVIDER_TIMEOUT_MS')),
    }, redis);
    const result = await provider.create({
      amount: '49.00',
      expiresAt,
      intentNo: fixture.expiredIntentNo,
    });
    if (result.outcome !== 'OPEN' || result.providerIntentId === null) {
      throw new Error('B10 vertical expired Mock Provider intent was not opened');
    }
    return result.providerIntentId;
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

async function seedFixture(createDatabaseRuntime, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    await putFixtureObject(fixture);
    const now = new Date();
    const expiredCreatedAt = new Date(now.getTime() - 31 * 60 * 1_000);
    const expiredPayExpiresAt = new Date(expiredCreatedAt.getTime() + 30 * 60 * 1_000);
    const expiredProviderIntentId = await createExpiredMockProviderIntent(fixture, expiredPayExpiresAt);
    const { createStoreOrderAddressSecurityMaterial } =
      require('../../packages/platform-core/dist/index.js');
    const expiredAddress = createStoreOrderAddressSecurityMaterial({
      detail: '文一路 99 号 B10 纵向测试',
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
          nickname: `B10 Customer ${fixture.marker}`,
        },
      });
      await transaction.fileAsset.create({
        data: {
          byte_size: BigInt(PNG_BYTES.length),
          created_at: now,
          id: fixture.fileId,
          mime_type: 'image/png',
          object_key: fixture.objectKey,
          original_name: 'b10-vertical.png',
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
          introduction: 'B10 vertical order fixture',
          is_hot: true,
          is_new: true,
          name: fixture.productName,
          published_at: now,
          sales_count: 9,
          spu_code: fixture.spuCode,
          status: 'ACTIVE',
          subtitle: 'B10 browser to Worker verification',
          updated_at: now,
        },
      });
      await transaction.sku.create({
        data: {
          code: fixture.skuCode,
          created_at: now,
          id: fixture.skuId,
          is_recommended: true,
          name: 'B10 vertical 500ml',
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
          payment_status: 'PROCESSING',
          refunded_amount: '0.00',
          shipping_amount: '0.00',
          source: 'BUY_NOW',
          updated_at: expiredCreatedAt,
          version: 2,
        },
      });
      await transaction.paymentIntent.create({
        data: {
          amount: '49.00',
          create_requested_at: expiredCreatedAt,
          created_at: expiredCreatedAt,
          expires_at: expiredPayExpiresAt,
          id: fixture.expiredPaymentIntentId,
          intent_no: fixture.expiredIntentNo,
          next_reconcile_at: expiredPayExpiresAt,
          opened_at: expiredCreatedAt,
          order_id: fixture.expiredOrderId,
          provider: 'MOCK',
          provider_intent_id: expiredProviderIntentId,
          provider_state: 'OPEN',
          status: 'OPEN',
          updated_at: expiredCreatedAt,
          version: 2,
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
          sku_name_snapshot: 'B10 vertical 500ml',
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
          request_id: `b10-vertical-seed-${fixture.marker}`,
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
        attribution_snapshot: true,
        inventory_reservation: { include: { items: true } },
        items: true,
        payment_intents: { include: { attempts: true } },
        refunds: { include: { attempts: true, items: true } },
      },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      where: { customer_id: fixture.customerId },
    });
    if (orders.length !== 2) throw new Error('B10 vertical expected one API order and one expired fixture order');
    const orderIds = orders.map(({ id }) => id);
    const reservationIds = orders.flatMap(({ inventory_reservation: reservation }) =>
      reservation ? [reservation.id] : []);
    const paymentIntentIds = orders.flatMap(({ payment_intents: intents }) => intents.map(({ id }) => id));
    const refundIds = orders.flatMap(({ refunds }) => refunds.map(({ id }) => id));
    const [
      balance,
      ledgers,
      orderAudits,
      paymentAudits,
      orderOutbox,
      paymentOutbox,
      refundAudits,
      refundOutbox,
      sessions,
      addresses,
      addressAudits,
      accountIdempotency,
      callbacks,
      product,
      commissionSnapshots,
    ] = await Promise.all([
      runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.inventoryId } }),
      runtime.prisma.inventoryLedger.findMany({
        orderBy: [{ business_id: 'asc' }, { ledger_type: 'asc' }],
        where: { business_id: { in: reservationIds }, sku_id: fixture.skuId },
      }),
      runtime.prisma.auditLog.findMany({
        where: { object_id: { in: orderIds }, object_type: 'order' },
      }),
      runtime.prisma.auditLog.findMany({
        where: { object_id: { in: paymentIntentIds }, object_type: 'payment' },
      }),
      runtime.prisma.outboxEvent.findMany({
        where: { aggregate_id: { in: orderIds }, aggregate_type: 'order' },
      }),
      runtime.prisma.outboxEvent.findMany({
        where: { aggregate_id: { in: paymentIntentIds }, aggregate_type: 'payment' },
      }),
      runtime.prisma.auditLog.findMany({
        where: { object_id: { in: refundIds }, object_type: 'refund' },
      }),
      runtime.prisma.outboxEvent.findMany({
        where: { aggregate_id: { in: refundIds }, aggregate_type: 'refund' },
      }),
      runtime.prisma.authSession.findMany({ where: { account_id: fixture.accountId } }),
      runtime.prisma.customerAddress.findMany({ where: { customer_id: fixture.customerId } }),
      runtime.prisma.auditLog.findMany({
        where: { actor_account_id: fixture.accountId, object_type: 'address' },
      }),
      runtime.prisma.idempotencyRecord.findMany({ where: { actor_id: fixture.accountId } }),
      runtime.prisma.callbackInbox.findMany({ where: { provider: 'MOCK' } }),
      runtime.prisma.product.findUnique({ where: { id: fixture.productId } }),
      runtime.prisma.orderItemCommissionSnapshot.count({
        where: { order_item_id: { in: orders.flatMap(({ items }) => items.map(({ id }) => id)) } },
      }),
    ]);
    const loginIdempotency = await runtime.prisma.idempotencyRecord.findMany({
      where: {
        actor_id: LOGIN_IDEMPOTENCY_ACTOR,
        resource_id: { in: sessions.map(({ id }) => id) },
      },
    });
    const byReason = new Map(orders.map((order) => [order.close_reason, order]));
    const paid = byReason.get(null);
    const expired = byReason.get('PAYMENT_TIMEOUT');
    if (!paid || !expired || orders.some((order) =>
      order.items.length !== 1 || order.items[0]?.sku_id !== fixture.skuId ||
      order.address_snapshot === null || order.attribution_candidate === null ||
      order.inventory_reservation === null || order.inventory_reservation.items.length !== 1)) {
      throw new Error('B10 vertical order projections are incomplete');
    }
    const paidIntent = paid.payment_intents[0];
    const paidAttempt = paidIntent?.attempts[0];
    const expiredIntent = expired.payment_intents[0];
    const expiredAttempt = expiredIntent?.attempts[0];
    const expiredRefund = expired.refunds[0];
    const expiredRefundAttempt = expiredRefund?.attempts[0];
    if (paid.order_status !== 'PENDING_SHIPMENT' || paid.payment_status !== 'PAID' ||
      paid.payment_resolution !== 'NORMAL' || paid.fulfillment_status !== 'READY_TO_SHIP' ||
      paid.final_channel !== 'DIRECT' || paid.version !== 3 || paid.paid_amount.toFixed(2) !== '49.00' ||
      paid.inventory_reservation?.status !== 'CONSUMED' || paid.inventory_reservation.consumed_at === null ||
      paid.attribution_snapshot?.final_channel !== 'DIRECT' || paidIntent?.status !== 'SUCCEEDED' ||
      paidIntent.version !== 3 || paidIntent.provider !== 'MOCK' || paidIntent.attempts.length !== 1 ||
      paidAttempt?.status !== 'SUCCEEDED' || paidAttempt.provider_transaction_id === null) {
      throw new Error('B10 vertical payment did not converge to the settled projection');
    }
    if (expired.order_status !== 'CLOSED' || expired.payment_status !== 'PAID' ||
      expired.payment_resolution !== 'LATE_SUCCESS_REFUNDED' || expired.close_reason !== 'PAYMENT_TIMEOUT' ||
      expired.refund_progress_status !== 'FULL' || expired.refund_processing_status !== 'IDLE' ||
      expired.paid_amount.toFixed(2) !== '49.00' || expired.refunded_amount.toFixed(2) !== '49.00' ||
      expired.inventory_reservation?.status !== 'EXPIRED' || expired.payment_intents.length !== 1 ||
      expiredIntent?.status !== 'SUCCEEDED' || expiredIntent.id !== fixture.expiredPaymentIntentId ||
      expiredIntent.attempts.length !== 1 || expiredAttempt?.status !== 'SUCCEEDED_LATE' ||
      expired.refunds.length !== 1 || expiredRefund?.origin_type !== 'LATE_PAYMENT' ||
      expiredRefund.status !== 'SUCCEEDED' || expiredRefund.items.length !== 1 ||
      expiredRefund.attempts.length !== 1 || expiredRefundAttempt?.status !== 'SUCCEEDED' ||
      reservationIds.length !== 2 || !balance || balance.physical_qty !== 7 ||
      balance.locked_qty !== 0 || balance.version !== 5 || ledgers.length !== 4) {
      throw new Error('B10 vertical reservation or inventory facts are invalid');
    }
    const paidLedgerTypes = ledgers.filter(({ business_id: id }) => id === paid.inventory_reservation?.id)
      .map(({ ledger_type: type }) => type).sort();
    const expiredLedgerTypes = ledgers.filter(({ business_id: id }) => id === fixture.expiredReservationId)
      .map(({ ledger_type: type }) => type).sort();
    if (paidLedgerTypes.join(',') !== 'ORDER_PAID_DEDUCT,ORDER_RESERVE' ||
      expiredLedgerTypes.join(',') !== 'ORDER_RELEASE,ORDER_RESERVE') {
      throw new Error('B10 vertical reservation ledger facts are incomplete');
    }
    const callback = callbacks.find(({ payload }) =>
      typeof payload === 'object' && payload !== null && !Array.isArray(payload) &&
      payload.provider_intent_id === paidIntent.provider_intent_id);
    const expiredCallback = callbacks.find(({ payload }) =>
      typeof payload === 'object' && payload !== null && !Array.isArray(payload) &&
      payload.provider_intent_id === expiredIntent.provider_intent_id);
    if (!callback || !expiredCallback || [callback, expiredCallback].some((item) =>
      item.event_type !== 'payment.succeeded' || item.status !== 'PROCESSED' ||
      item.signature_valid !== true || item.retry_count !== 0 || item.processed_at === null) ||
      product?.sales_count !== 10 || commissionSnapshots !== 0 || orderAudits.length !== 6 ||
      paymentAudits.length !== 4 || refundAudits.length !== 2 ||
      orderOutbox.length !== 6 || paymentOutbox.length !== 4 || refundOutbox.length !== 2 ||
      orderOutbox.filter(({ event_type: type }) => type === 'order.created').length !== 2 ||
      orderOutbox.filter(({ event_type: type }) => type === 'order.closed').length !== 1 ||
      orderOutbox.filter(({ event_type: type }) => type === 'order.paid').length !== 1 ||
      orderOutbox.filter(({ event_type: type }) => type === 'order.late_payment_refund_pending').length !== 1 ||
      orderOutbox.filter(({ event_type: type }) => type === 'order.late_payment_refunded').length !== 1 ||
      sessions.length !== 1 || addresses.length !== 1 || addressAudits.length !== 1 ||
      addressAudits[0]?.object_id !== addresses[0]?.id || accountIdempotency.length !== 4 ||
      loginIdempotency.length !== 1 || paymentIntentIds.length !== 2 || refundIds.length !== 1) {
      throw new Error('B10 vertical payment, audit, Outbox, session or idempotency facts are invalid');
    }
    const address = addresses[0];
    const phone = ['137', '0000', '0009'].join('');
    const detail = '文一路 99 号 B10 纵向测试';
    if (!address || Buffer.from(address.phone_ciphertext).includes(Buffer.from(phone)) ||
      Buffer.from(address.detail_ciphertext).includes(Buffer.from(detail)) ||
      orders.some((order) => !order.address_snapshot ||
        Buffer.from(order.address_snapshot.phone_ciphertext).includes(Buffer.from(phone)) ||
        Buffer.from(order.address_snapshot.detail_ciphertext).includes(Buffer.from(detail)))) {
      throw new Error('B10 vertical address or frozen order snapshot is not encrypted');
    }
    const idempotency = [...accountIdempotency, ...loginIdempotency];
    if (idempotency.some((record) => record.response_body !== null ||
      !/^[a-f0-9]{64}$/.test(record.request_hash) ||
      !/^[a-f0-9]{64}$/.test(record.response_body_hash))) {
      throw new Error('B10 vertical idempotency facts are not HASH_ONLY');
    }
    const protectedFacts = JSON.stringify({
      audits: [...orderAudits, ...paymentAudits, ...refundAudits, ...addressAudits],
      idempotency,
      outbox: [...orderOutbox, ...paymentOutbox, ...refundOutbox],
    });
    assertNoCapabilityFingerprint(
      protectedFacts,
      capabilityFingerprints,
      capabilityKey,
      'durable audit, idempotency or Outbox metadata',
    );
    assertNoKnownProtectedValues(
      protectedFacts,
      protectedFingerprints(
        secretRepresentations(required('PAYMENT_MOCK_SIGNING_KEY_BASE64')),
        capabilityKey,
      ),
      'durable audit, idempotency or Outbox metadata',
    );
    for (const value of [
      fixture.customerId,
      fixture.loginCode,
      fixture.wechatOpenId,
      '纵向用户',
      phone,
      detail,
      'quote_token',
    ]) {
      if (protectedFacts.includes(value)) {
        throw new Error('B10 vertical PII or quote capability leaked into durable metadata');
      }
    }
    for (const providerReference of [
      paidIntent.provider_intent_id,
      paidAttempt.provider_transaction_id,
      callback.provider_event_id,
      expiredIntent.provider_intent_id,
      expiredAttempt.provider_transaction_id,
      expiredCallback.provider_event_id,
      expiredRefund.provider_refund_id,
    ]) {
      if (providerReference !== null && protectedFacts.includes(providerReference)) {
        throw new Error('B10 vertical Provider payload leaked into durable metadata');
      }
    }
  } finally {
    await runtime.disconnect();
  }
}

async function readDiagnosticProtectedValues(createDatabaseRuntime, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  const values = new Set([
    fixture.accountId,
    fixture.customerId,
    fixture.loginCode,
    fixture.wechatOpenId,
    '纵向用户',
    '文一路 99 号 B10 纵向测试',
    ['137', '0000', '0009'].join(''),
    ...secretRepresentations(required('PAYMENT_MOCK_SIGNING_KEY_BASE64')),
    ...environmentProtectedValues(),
  ]);
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0) values.add(value);
    else if (value !== null && value !== undefined) {
      const serialized = JSON.stringify(value);
      if (serialized.length >= 8) values.add(serialized);
    }
  };
  const addSensitiveLeaves = (value, key = '') => {
    if (Array.isArray(value)) {
      for (const item of value) addSensitiveLeaves(item, key);
      return;
    }
    if (typeof value === 'object' && value !== null) {
      for (const [childKey, childValue] of Object.entries(value)) {
        addSensitiveLeaves(childValue, childKey);
      }
      return;
    }
    if (typeof value === 'string' &&
      /(?:signature|nonce|secret|token|authorization|raw[_-]?body|(?:provider|payment|refund|session).*[_-]id)/iu
        .test(key)) add(value);
  };
  try {
    const sessions = await runtime.prisma.authSession.findMany({
      select: { id: true, session_family: true },
      where: { account_id: fixture.accountId },
    });
    for (const session of sessions) {
      add(session.id);
      add(session.session_family);
    }
    const orders = await runtime.prisma.salesOrder.findMany({
      include: {
        payment_intents: { include: { attempts: true } },
        refunds: { include: { attempts: true } },
      },
      where: { customer_id: fixture.customerId },
    });
    const providerIntentIds = [];
    for (const order of orders) {
      for (const intent of order.payment_intents) {
        add(intent.provider_intent_id);
        if (intent.provider_intent_id !== null) providerIntentIds.push(intent.provider_intent_id);
        for (const attempt of intent.attempts) {
          add(attempt.provider_transaction_id);
          add(attempt.provider_payload);
          addSensitiveLeaves(attempt.provider_payload);
        }
      }
      for (const refund of order.refunds) {
        add(refund.provider_refund_id);
        for (const attempt of refund.attempts) {
          add(attempt.provider_request_id);
          add(attempt.provider_payload);
          addSensitiveLeaves(attempt.provider_payload);
        }
      }
    }
    const callbacks = await runtime.prisma.callbackInbox.findMany({ where: { provider: 'MOCK' } });
    for (const callback of callbacks) {
      if (typeof callback.payload !== 'object' || callback.payload === null ||
        Array.isArray(callback.payload) ||
        !providerIntentIds.includes(callback.payload.provider_intent_id)) continue;
      add(callback.provider_event_id);
      add(Buffer.from(callback.raw_body).toString('utf8'));
      add(callback.headers);
      add(callback.payload);
      addSensitiveLeaves(callback.headers);
      addSensitiveLeaves(callback.payload);
      add(callback.signature_nonce);
      add(callback.provider_serial_no);
    }
    return [...values];
  } finally {
    await runtime.disconnect();
  }
}

async function clearRedisKeys(createDatabaseRuntime, fixture) {
  const { createClient } = apiRequire('redis');
  const { hashIpAddress } = require('../../packages/platform-core/dist/index.js');
  const { mockPaymentIntentStateKey, mockPaymentRefundStateKey } = paymentRequire('@qingxu/payment');
  const ipKey = Buffer.from(required('AUDIT_IP_HASH_KEY_BASE64'), 'base64');
  const paymentKey = Buffer.from(required('PAYMENT_MOCK_SIGNING_KEY_BASE64'), 'base64');
  const sourceHash = hashIpAddress('127.0.0.1', ipKey);
  const customerDigest = createHmac('sha256', ipKey)
    .update('qingxu:store-customer-rate-limit:v1', 'utf8')
    .update('\0', 'utf8')
    .update(fixture.customerId, 'utf8')
    .update('\0', 'utf8')
    .update('127.0.0.1', 'utf8')
    .digest('hex');
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  let intentNos;
  let refundNos;
  try {
    intentNos = (await runtime.prisma.paymentIntent.findMany({
      select: { intent_no: true },
      where: { order: { customer_id: fixture.customerId } },
    })).map(({ intent_no: intentNo }) => intentNo);
    refundNos = (await runtime.prisma.refund.findMany({
      select: { refund_no: true },
      where: { order: { customer_id: fixture.customerId } },
    })).map(({ refund_no: refundNo }) => refundNo);
  } finally {
    await runtime.disconnect();
  }
  const keys = [...new Set([
    `qingxu:store-auth:legal:rate-limit:source:${sourceHash}`,
    `qingxu:store-auth:login:rate-limit:source:${sourceHash}`,
    `qingxu:store-catalog:rate-limit:source:${sourceHash}`,
    `qingxu:store-customer:rate-limit:subject:${customerDigest}`,
    ...[fixture.expiredIntentNo, ...intentNos]
      .map((intentNo) => mockPaymentIntentStateKey(paymentKey, intentNo)),
    ...refundNos.map((refundNo) => mockPaymentRefundStateKey(paymentKey, refundNo)),
  ])];
  const redis = createClient({ url: process.env.REDIS_URL });
  try {
    await redis.connect();
    // Fixed-window facts can expire at an aligned boundary before this long flow finishes.
    let cleanupError;
    try {
      await redis.del(keys);
      const residual = await redis.mGet(keys);
      if (residual.some((value) => value !== null)) {
        cleanupError = new Error('Redis B10 rate-limit or Mock Provider fixture keys remain after cleanup');
      }
    } catch {
      cleanupError = new Error('B10 Redis fixture cleanup failed');
    }
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
    application_name: 'qingxu-b10-vertical-cleanup',
    connectionString: process.env.DIRECT_URL,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let cleanupClient;
  let databaseError;
  let orderIds = [];
  let orderItemIds = [];
  let reservationIds = [];
  let paymentIntentIds = [];
  let callbackIds = [];
  let refundIds = [];
  let attributionSnapshotIds = [];
  let commissionSnapshotIds = [];
  let resourceIds = [];
  try {
    cleanupClient = await cleanupPool.connect();
    await cleanupClient.query('BEGIN');
    const orders = await cleanupClient.query(
      'SELECT id::text FROM public.sales_order WHERE customer_id = $1',
      [fixture.customerId],
    );
    orderIds = orders.rows.map(({ id }) => id);
    const orderItems = await cleanupClient.query(
      'SELECT id::text FROM public.order_item WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    orderItemIds = orderItems.rows.map(({ id }) => id);
    const reservations = await cleanupClient.query(
      'SELECT id::text FROM public.inventory_reservation WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    reservationIds = reservations.rows.map(({ id }) => id);
    const paymentIntents = await cleanupClient.query(
      `SELECT id::text, provider_intent_id
       FROM public.payment_intent WHERE order_id::text = ANY($1::text[])`,
      [orderIds],
    );
    paymentIntentIds = paymentIntents.rows.map(({ id }) => id);
    const providerIntentIds = paymentIntents.rows
      .map(({ provider_intent_id: providerIntentId }) => providerIntentId)
      .filter((providerIntentId) => typeof providerIntentId === 'string');
    const callbacks = await cleanupClient.query(
      `SELECT id::text FROM public.callback_inbox
       WHERE provider = 'MOCK' AND payload->>'provider_intent_id' = ANY($1::text[])`,
      [providerIntentIds],
    );
    callbackIds = callbacks.rows.map(({ id }) => id);
    const refunds = await cleanupClient.query(
      'SELECT id::text FROM public.refund WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    refundIds = refunds.rows.map(({ id }) => id);
    const attributionSnapshots = await cleanupClient.query(
      'SELECT id::text FROM public.order_attribution_snapshot WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    attributionSnapshotIds = attributionSnapshots.rows.map(({ id }) => id);
    const commissionSnapshots = await cleanupClient.query(
      `SELECT id::text FROM public.order_item_commission_snapshot
       WHERE order_item_id::text = ANY($1::text[])`,
      [orderItemIds],
    );
    commissionSnapshotIds = commissionSnapshots.rows.map(({ id }) => id);
    const resources = await cleanupClient.query(
      `SELECT id::text FROM public.auth_session WHERE account_id = $1
       UNION ALL SELECT id::text FROM public.customer_address WHERE customer_id = $2`,
      [fixture.accountId, fixture.customerId],
    );
    resourceIds = [
      ...resources.rows.map(({ id }) => id),
      ...orderIds,
      ...paymentIntentIds,
      ...refundIds,
      ...commissionSnapshotIds,
    ];
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
      [resourceIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.callback_inbox WHERE id::text = ANY($1::text[])',
      [callbackIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.payment_attempt WHERE payment_intent_id::text = ANY($1::text[])',
      [paymentIntentIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.payment_intent WHERE id::text = ANY($1::text[])',
      [paymentIntentIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.commission_ledger WHERE snapshot_id::text = ANY($1::text[]) OR refund_id::text = ANY($2::text[])',
      [commissionSnapshotIds, refundIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.order_item_commission_position WHERE snapshot_id::text = ANY($1::text[])',
      [commissionSnapshotIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.order_item_commission_snapshot WHERE id::text = ANY($1::text[])',
      [commissionSnapshotIds],
    );
    await cleanupClient.query('DELETE FROM public.refund_attempt WHERE refund_id::text = ANY($1::text[])', [refundIds]);
    await cleanupClient.query('DELETE FROM public.refund_item WHERE refund_id::text = ANY($1::text[])', [refundIds]);
    await cleanupClient.query('DELETE FROM public.refund WHERE id::text = ANY($1::text[])', [refundIds]);
    await cleanupClient.query(
      'DELETE FROM public.agent_customer_privacy_projection WHERE attribution_snapshot_id::text = ANY($1::text[])',
      [attributionSnapshotIds],
    );
    await cleanupClient.query(
      'DELETE FROM public.order_attribution_snapshot WHERE id::text = ANY($1::text[])',
      [attributionSnapshotIds],
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
    await cleanupClient.query('DELETE FROM public.manual_compensation WHERE order_id::text = ANY($1::text[])', [orderIds]);
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
      runtime.prisma.paymentIntent.count({ where: { id: { in: paymentIntentIds } } }),
      runtime.prisma.paymentAttempt.count({ where: { payment_intent_id: { in: paymentIntentIds } } }),
      runtime.prisma.callbackInbox.count({ where: { id: { in: callbackIds } } }),
      runtime.prisma.refund.count({ where: { id: { in: refundIds } } }),
      runtime.prisma.inventoryReservation.count({ where: { id: { in: reservationIds } } }),
      runtime.prisma.inventoryReservationItem.count({ where: { reservation_id: { in: reservationIds } } }),
      runtime.prisma.orderItem.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.orderAddressSnapshot.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.orderAttributionCandidate.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.orderAttributionSnapshot.count({ where: { id: { in: attributionSnapshotIds } } }),
      runtime.prisma.orderItemCommissionSnapshot.count({ where: { id: { in: commissionSnapshotIds } } }),
      runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      runtime.prisma.auditLog.count({
        where: { OR: [{ actor_account_id: fixture.accountId }, { object_id: { in: resourceIds } }] },
      }),
      runtime.prisma.idempotencyRecord.count({
        where: { OR: [{ actor_id: fixture.accountId }, { resource_id: { in: resourceIds } }] },
      }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: { in: resourceIds } } }),
      runtime.prisma.productImage.count({ where: { id: fixture.imageId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: fixture.inventoryId } }),
      runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
      runtime.prisma.product.count({ where: { id: fixture.productId } }),
      runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      runtime.prisma.fileAsset.count({ where: { id: fixture.fileId } }),
    ]);
    if (residual.some((count) => count !== 0)) {
      throw new Error(`B10 vertical fixture residue: ${JSON.stringify(residual)}`);
    }
  } finally {
    await runtime.disconnect();
  }
  if (databaseError) throw databaseError;
  if (objectError) throw objectError;
}

async function main() {
  const mode = process.env.B10_VERTICAL_TEST_MODE?.trim();
  if (mode !== 'full') refuse('B10_VERTICAL_TEST_MODE must be explicitly set to full');
  validateTargets();
  const apiPort = testPort('B10_VERTICAL_API_PORT', '3000');
  const workerPort = testPort('B10_VERTICAL_WORKER_PORT', '3001');
  const webPort = testPort('B10_VERTICAL_WEB_PORT', '5173');
  Object.assign(process.env, {
    B10_VERTICAL_API_PORT: apiPort,
    B10_VERTICAL_WEB_PORT: webPort,
    B10_VERTICAL_WORKER_PORT: workerPort,
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
  const capabilityDirectory = await mkdtemp(join(tmpdir(), 'qingxu-b10-vertical-capability-'));
  const capabilityArtifactPath = join(capabilityDirectory, 'fingerprints.json');
  const capabilityKey = randomBytes(32);
  Object.assign(process.env, {
    B10_VERTICAL_CAPABILITY_ARTIFACT_PATH: capabilityArtifactPath,
    B10_VERTICAL_CAPABILITY_HMAC_KEY_BASE64: capabilityKey.toString('base64'),
  });
  let executionError;
  try {
    try {
      await seedFixture(createDatabaseRuntime, fixture);
      Object.assign(process.env, {
        B10_VERTICAL_ACCOUNT_ID: fixture.accountId,
        B10_VERTICAL_API_ORIGIN: `http://127.0.0.1:${apiPort}`,
        B10_VERTICAL_CUSTOMER_ID: fixture.customerId,
        B10_VERTICAL_EXPIRED_ORDER_ID: fixture.expiredOrderId,
        B10_VERTICAL_EXPIRED_PAYMENT_INTENT_ID: fixture.expiredPaymentIntentId,
        B10_VERTICAL_EXPIRED_PAYMENT_INTENT_NO: fixture.expiredIntentNo,
        B10_VERTICAL_LOGIN_CODE: fixture.loginCode,
        B10_VERTICAL_PRODUCT_ID: fixture.productId,
        B10_VERTICAL_PRODUCT_NAME: fixture.productName,
        B10_VERTICAL_SKU_ID: fixture.skuId,
        B10_VERTICAL_WECHAT_OPEN_ID: fixture.wechatOpenId,
        B10_VERTICAL_WORKER_ORIGIN: `http://127.0.0.1:${workerPort}`,
      });
      const playwright = runCaptured(
        'pnpm',
        ['exec', 'playwright', 'test', '--config', 'playwright.b10-vertical.config.ts'],
      );
      let capabilityFingerprints;
      let diagnosticProtectedValues;
      try {
        capabilityFingerprints = await readCapabilityFingerprints(capabilityArtifactPath);
        diagnosticProtectedValues = protectedFingerprints(
          await readDiagnosticProtectedValues(createDatabaseRuntime, fixture),
          capabilityKey,
        );
      } catch (error) {
        if (playwright.failed) {
          throw new Error(
            'B10 browser-to-Worker Playwright test failed; captured output was suppressed because protected-value scanning was unavailable',
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
      assertNoKnownProtectedValues(
        playwright.output,
        diagnosticProtectedValues,
        'captured API, Worker or browser test output',
      );
      if (playwright.failed) {
        throw new SafeDiagnosticError(
          `B10 browser-to-Worker Playwright test failed after protected-value scanning:\n${
            minimalSanitizedDiagnostic(playwright.output, diagnosticProtectedValues)}`,
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
      await clearRedisKeys(createDatabaseRuntime, fixture);
    } catch (cleanupError) {
      executionError = executionError
        ? new AggregateError([executionError, cleanupError], 'B10 vertical execution and Redis cleanup failed')
        : cleanupError;
    }
    try {
      await deleteFixture(createDatabaseRuntime, fixture);
    } catch (cleanupError) {
      executionError = executionError
        ? new AggregateError(
          [executionError, cleanupError],
          'B10 vertical execution and PostgreSQL/MinIO cleanup both failed',
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
          'B10 vertical execution and capability artifact cleanup both failed',
        )
        : cleanupError;
    } finally {
      capabilityKey.fill(0);
      delete process.env.B10_VERTICAL_CAPABILITY_ARTIFACT_PATH;
      delete process.env.B10_VERTICAL_CAPABILITY_HMAC_KEY_BASE64;
    }
  }
  if (executionError) throw executionError;
  process.stdout.write(
    'B10.6 browser -> Nest -> PostgreSQL/Redis/MinIO -> Worker/Mock Provider vertical smoke passed; exact fixture, keys and object cleaned.\n',
  );
}

main().catch((error) => {
  const message = error instanceof SafeDiagnosticError
    ? error.message
    : 'B10 vertical smoke failed; detailed diagnostics were withheld to protect credentials and fixture identifiers.';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}).finally(() => {
  s3Client?.destroy();
});
