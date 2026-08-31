import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const apiRequire = createRequire(new URL('../../apps/api/package.json', import.meta.url));
const databaseRequire = createRequire(new URL('../../packages/database/package.json', import.meta.url));
const storageRequire = createRequire(new URL('../../packages/storage/package.json', import.meta.url));
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);
const PNG_SHA256 = createHash('sha256').update(PNG_BYTES).digest('hex');
let s3Client;

function refuse(message) {
  throw new Error(`B11 vertical test refused: ${message}`);
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

function testPort(name, fallback) {
  const value = process.env[name]?.trim() || fallback;
  if (!/^[0-9]{4,5}$/.test(value) || Number(value) < 1_024 || Number(value) > 65_535) {
    refuse(`${name} must be an unprivileged TCP port`);
  }
  return value;
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
    maxBuffer: 1024 * 1_024,
    stdio: 'pipe',
  });
  return {
    failed: child.error !== undefined || child.status !== 0,
    output: `${child.stdout ?? ''}${child.stderr ?? ''}`,
  };
}

function formatError(error) {
  if (error instanceof AggregateError) {
    return [error.message, ...error.errors.map((item) => formatError(item))].join('\n');
  }
  return error instanceof Error ? error.stack ?? error.message : String(error);
}

function sanitizeDiagnostic(text, protectedValues) {
  let result = text;
  for (const value of protectedValues) {
    if (value) result = result.replaceAll(value, '[REDACTED]');
  }
  return result.split(/\r?\n/u).filter(Boolean).slice(-50).join('\n').slice(-8_000) ||
    'No non-sensitive Playwright diagnostic was available.';
}

function containsGeneratedAdminSecret(text) {
  return text.includes('otpauth://') || /\b[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}\b/u.test(text);
}

async function artifactFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await artifactFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function assertNoSensitivePlaywrightArtifacts(directory, protectedValues) {
  for (const path of await artifactFiles(directory)) {
    const content = await readFile(path);
    const text = content.toString('utf8');
    if (protectedValues.some((value) => value && content.includes(Buffer.from(value))) ||
      containsGeneratedAdminSecret(text)) {
      throw new Error('B11 protected fulfillment data leaked into an isolated Playwright artifact');
    }
  }
}

async function readEphemeralPlaywrightSecrets(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(value) || value.length > 20 || value.some((item) =>
    typeof item !== 'string' || item.length < 6 || item.length > 160)) {
    throw new Error('B11 Playwright ephemeral-secret manifest is invalid');
  }
  return value;
}

function validateTargets() {
  if (process.env.B11_VERTICAL_TEST_MODE !== 'full') {
    refuse('B11_VERTICAL_TEST_MODE must be explicitly set to full');
  }
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
  }
  if (process.env.STORE_IDENTITY_PROVIDER !== 'MOCK' || process.env.STORE_PHONE_PROVIDER !== 'MOCK' ||
    process.env.STORE_PAYMENT_PROVIDER !== 'MOCK') {
    refuse('B11 vertical requires the Mock identity, phone and payment providers');
  }

  const database = parseUrl('DATABASE_URL');
  const direct = parseUrl('DIRECT_URL');
  let databaseName;
  let runtimeRole;
  let migratorRole;
  try {
    databaseName = decodeURIComponent(database.pathname.slice(1));
    runtimeRole = decodeURIComponent(database.username);
    migratorRole = decodeURIComponent(direct.username);
  } catch {
    refuse('PostgreSQL URLs contain invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
    !LOOPBACK_HOSTS.has(database.hostname) || runtimeRole !== 'mall_runtime' ||
    !database.password || database.search || database.hash ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/iu.test(databaseName)) {
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B11 test database');
  }
  if (!['postgres:', 'postgresql:'].includes(direct.protocol) ||
    !LOOPBACK_HOSTS.has(direct.hostname) || migratorRole !== 'mall_migrator' ||
    !direct.password || direct.search || direct.hash || direct.hostname !== database.hostname ||
    (direct.port || '5432') !== (database.port || '5432') || direct.pathname !== database.pathname) {
    refuse('DIRECT_URL must be a query-free loopback mall_migrator connection to the same database');
  }

  const redis = parseUrl('REDIS_URL');
  let redisPassword;
  try {
    redisPassword = decodeURIComponent(redis.password);
  } catch {
    refuse('REDIS_URL contains invalid percent encoding');
  }
  if (redis.protocol !== 'redis:' || !LOOPBACK_HOSTS.has(redis.hostname) ||
    redisPassword.length < 12 || redis.search || redis.hash ||
    !/^\/(?:[1-9]|1[0-5])$/.test(redis.pathname)) {
    refuse('REDIS_URL must use a password-protected isolated loopback database 1 through 15');
  }

  const storage = parseUrl('S3_ENDPOINT');
  const publicBase = parseUrl('S3_PUBLIC_BASE_URL');
  const bucket = required('S3_BUCKET');
  if (storage.protocol !== 'http:' || !LOOPBACK_HOSTS.has(storage.hostname) ||
    storage.pathname !== '/' || storage.username || storage.password || storage.search || storage.hash) {
    refuse('S3_ENDPOINT must be a credential-free loopback HTTP origin');
  }
  if (!/^mall-b(?:[3-9]|10|11)-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket) ||
    publicBase.origin !== storage.origin ||
    publicBase.pathname.replace(/\/$/, '') !== `/${bucket}` || publicBase.username ||
    publicBase.password || publicBase.search || publicBase.hash) {
    refuse('S3_PUBLIC_BASE_URL must identify an isolated B3 through B11 test bucket on S3_ENDPOINT');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') refuse('S3_FORCE_PATH_STYLE must be true');

  const ports = [
    testPort('B11_VERTICAL_API_PORT', '3000'),
    testPort('B11_VERTICAL_WORKER_PORT', '3001'),
    testPort('B11_VERTICAL_MINIAPP_PORT', '5173'),
    testPort('B11_VERTICAL_ADMIN_PORT', '5175'),
  ];
  if (ports[0] !== '3000') refuse('B11_VERTICAL_API_PORT must be 3000 for the Admin Vite proxy');
  if (new Set(ports).size !== ports.length) refuse('B11 vertical service ports must be distinct');

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

function databaseRuntime(createDatabaseRuntime) {
  return createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b11-vertical',
    connectionTimeoutMs: 5_000,
    databaseUrl: required('DATABASE_URL'),
    poolMax: 4,
  });
}

function storageClient() {
  const { S3Client } = storageRequire('@aws-sdk/client-s3');
  if (!s3Client) {
    s3Client = new S3Client({
      credentials: {
        accessKeyId: required('S3_ACCESS_KEY'),
        secretAccessKey: required('S3_SECRET_KEY'),
      },
      endpoint: required('S3_ENDPOINT'),
      forcePathStyle: true,
      region: required('S3_REGION'),
    });
  }
  return s3Client;
}

function createFixture(generateUlid, sha256Hex) {
  const marker = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const loginCode = `mock:b11_vertical_${marker.toLowerCase()}`;
  const adminPassword = `B11-Vertical-${randomBytes(24).toString('base64url')}!`;
  const fileId = generateUlid();
  return {
    adminAccountId: generateUlid(),
    adminLogin: `b11-vertical-${marker.toLowerCase()}`,
    adminPassword,
    agentAccountId: generateUlid(),
    agentId: generateUlid(),
    agentWalletId: generateUlid(),
    addressSnapshotId: generateUlid(),
    attributionCandidateId: generateUlid(),
    attributionSnapshotId: generateUlid(),
    brandId: generateUlid(),
    brandName: `B11 Vertical Brand ${marker}`,
    businessRuleId: generateUlid(),
    carrierName: `B11 Development Carrier ${marker}`,
    categoryId: generateUlid(),
    categoryName: `B11 Vertical Category ${marker}`,
    commissionPositionId: generateUlid(),
    commissionRuleId: generateUlid(),
    commissionSnapshotId: generateUlid(),
    customerAccountId: generateUlid(),
    customerId: generateUlid(),
    expiredAddressSnapshotId: generateUlid(),
    expiredAttributionCandidateId: generateUlid(),
    expiredOrderId: generateUlid(),
    expiredOrderItemId: generateUlid(),
    expiredReservationId: generateUlid(),
    expiredReservationItemId: generateUlid(),
    expiredReserveLedgerId: generateUlid(),
    fileId,
    imageId: generateUlid(),
    inventoryId: generateUlid(),
    loginCode,
    marker,
    objectKey: `public/${fileId}`,
    orderId: generateUlid(),
    orderItemId: generateUlid(),
    paymentAttemptId: generateUlid(),
    paymentIntentId: generateUlid(),
    productId: generateUlid(),
    productName: `B11 Vertical Product ${marker}`,
    rawAddressDetail: `Development address ${marker}`,
    rawPhone: ['100', '0000', marker.replace(/\D/g, '').padEnd(4, '0').slice(0, 4)].join(''),
    rawRecipient: `Development Recipient ${marker}`,
    skuCode: `B11V-SKU-${marker}`,
    skuId: generateUlid(),
    skuName: `B11 Vertical SKU ${marker}`,
    spuCode: `B11V-SPU-${marker}`,
    trackingNo: `B11-TRACK-${marker}`,
    wechatOpenId: `mock_${sha256Hex(`${required('STORE_WECHAT_APP_ID')}\0${loginCode}`)}`,
  };
}

async function putFixtureObject(fixture) {
  const { PutObjectCommand } = storageRequire('@aws-sdk/client-s3');
  await storageClient().send(new PutObjectCommand({
    Body: PNG_BYTES,
    Bucket: required('S3_BUCKET'),
    ContentLength: PNG_BYTES.length,
    ContentType: 'image/png',
    Key: fixture.objectKey,
    Metadata: { sha256: PNG_SHA256 },
  }));
}

async function seedFixture(createDatabaseRuntime, AdminAuthRepository, hashPassword, fixture) {
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const publishedCount = await runtime.prisma.businessRuleVersion.count({ where: { status: 'PUBLISHED' } });
    if (publishedCount !== 0) refuse('the isolated B11 database already contains a PUBLISHED business rule');
    await putFixtureObject(fixture);
    const passwordHash = await hashPassword(fixture.adminPassword);
    const agentPasswordHash = await hashPassword(`B11-Agent-${fixture.marker}!`);
    const auth = new AdminAuthRepository(runtime.prisma);
    const now = new Date();
    const expiredCreatedAt = new Date(now.getTime() - 31 * 60_000);
    const expiredPayExpiresAt = new Date(expiredCreatedAt.getTime() + 30 * 60_000);
    const { createStoreOrderAddressSecurityMaterial } =
      require('../../packages/platform-core/dist/index.js');
    const mainAddress = createStoreOrderAddressSecurityMaterial({
      detail: fixture.rawAddressDetail,
      phone: fixture.rawPhone,
      snapshotId: fixture.addressSnapshotId,
    }, {
      id: required('FIELD_ENCRYPTION_KEY_ID'),
      key: Buffer.from(required('FIELD_ENCRYPTION_KEY_BASE64'), 'base64'),
    });
    const expiredAddress = createStoreOrderAddressSecurityMaterial({
      detail: `Expired ${fixture.rawAddressDetail}`,
      phone: fixture.rawPhone,
      snapshotId: fixture.expiredAddressSnapshotId,
    }, {
      id: required('FIELD_ENCRYPTION_KEY_ID'),
      key: Buffer.from(required('FIELD_ENCRYPTION_KEY_BASE64'), 'base64'),
    });

    await runtime.withPrismaTransaction(async (transaction) => {
      await auth.bootstrapSuperAdminInTransaction(transaction, {
        accountId: fixture.adminAccountId,
        loginName: fixture.adminLogin,
        passwordHash,
      });
      await transaction.account.create({
        data: {
          id: fixture.customerAccountId,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          wechat_open_id: fixture.wechatOpenId,
        },
      });
      await transaction.account.create({
        data: {
          id: fixture.agentAccountId,
          login_name: `b11-agent-${fixture.marker.toLowerCase()}`,
          password_hash: agentPasswordHash,
          role: 'AGENT_ADMIN',
          status: 'ACTIVE',
        },
      });
      await transaction.customerProfile.create({
        data: {
          account_id: fixture.customerAccountId,
          id: fixture.customerId,
          nickname: `B11 Customer ${fixture.marker}`,
        },
      });
      await transaction.agentProfile.create({
        data: {
          account_id: fixture.agentAccountId,
          agent_no: `B11-${fixture.marker}`,
          id: fixture.agentId,
          name: `B11 Development Agent ${fixture.marker}`,
          product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
          status: 'ACTIVE',
        },
      });
      await transaction.agentWallet.create({
        data: {
          agent_id: fixture.agentId,
          available_balance: '1.00',
          frozen_balance: '0.00',
          id: fixture.agentWalletId,
          version: 1,
        },
      });
      await transaction.fileAsset.create({
        data: {
          byte_size: BigInt(PNG_BYTES.length),
          id: fixture.fileId,
          mime_type: 'image/png',
          object_key: fixture.objectKey,
          original_name: 'b11-vertical.png',
          purpose: 'PRODUCT_IMAGE',
          sha256: PNG_SHA256,
          status: 'READY',
          visibility: 'PUBLIC',
        },
      });
      await transaction.brand.create({
        data: { id: fixture.brandId, name: fixture.brandName, sort_order: 0, status: 'ACTIVE' },
      });
      await transaction.category.create({
        data: { id: fixture.categoryId, name: fixture.categoryName, sort_order: 0, status: 'ACTIVE' },
      });
      await transaction.product.create({
        data: {
          brand_id: fixture.brandId,
          category_id: fixture.categoryId,
          id: fixture.productId,
          name: fixture.productName,
          published_at: now,
          sales_count: 11,
          spu_code: fixture.spuCode,
          status: 'ACTIVE',
        },
      });
      await transaction.sku.create({
        data: {
          code: fixture.skuCode,
          id: fixture.skuId,
          name: fixture.skuName,
          product_id: fixture.productId,
          retail_price: '49.00',
          status: 'ACTIVE',
        },
      });
      await transaction.productImage.create({
        data: { file_id: fixture.fileId, id: fixture.imageId, product_id: fixture.productId, sort_order: 0 },
      });
      await transaction.inventoryBalance.create({
        data: { id: fixture.inventoryId, locked_qty: 1, physical_qty: 8, sku_id: fixture.skuId, version: 2 },
      });
      const ruleVersion = await transaction.businessRuleVersion.aggregate({ _max: { version_no: true } });
      const commissionRuleVersion = await transaction.commissionRuleVersion.aggregate({ _max: { version_no: true } });
      await transaction.commissionRuleVersion.create({
        data: {
          created_by_id: fixture.adminAccountId,
          effective_at: now,
          id: fixture.commissionRuleId,
          reason: 'B11 vertical frozen positive commission rule',
          status: 'DRAFT',
          version_no: (commissionRuleVersion._max.version_no ?? 0) + 1,
        },
      });
      await transaction.businessRuleVersion.create({
        data: {
          aftersale_window_days: 5,
          created_by_id: fixture.adminAccountId,
          effective_at: new Date(now.getTime() - 60_000),
          id: fixture.businessRuleId,
          legal_record_retention_years: 10,
          minimum_withdrawal_amount: '100.00',
          order_payment_timeout_minutes: 30,
          reason: 'B11 vertical completion rule',
          status: 'PUBLISHED',
          version_no: (ruleVersion._max.version_no ?? 0) + 1,
        },
      });
      await transaction.salesOrder.create({
        data: {
          created_at: now,
          customer_id: fixture.customerId,
          final_agent_id: fixture.agentId,
          final_channel: 'AGENT',
          fulfillment_status: 'READY_TO_SHIP',
          goods_amount: '49.00',
          id: fixture.orderId,
          order_no: `QX${fixture.orderId}`,
          order_status: 'PENDING_SHIPMENT',
          paid_amount: '49.00',
          paid_at: now,
          pay_expires_at: new Date(now.getTime() + 30 * 60_000),
          payable_amount: '49.00',
          payment_resolution: 'NORMAL',
          payment_status: 'PAID',
          refunded_amount: '0.00',
          shipping_amount: '0.00',
          source: 'BUY_NOW',
          updated_at: now,
          version: 1,
        },
      });
      await transaction.orderItem.create({
        data: {
          brand_name_snapshot: fixture.brandName,
          category_id: fixture.categoryId,
          category_name_snapshot: fixture.categoryName,
          id: fixture.orderItemId,
          line_paid_amount: '49.00',
          order_id: fixture.orderId,
          product_id: fixture.productId,
          product_name_snapshot: fixture.productName,
          quantity: 1,
          sku_code_snapshot: fixture.skuCode,
          sku_id: fixture.skuId,
          sku_name_snapshot: fixture.skuName,
          unit_price: '49.00',
        },
      });
      await transaction.orderItemCommissionSnapshot.create({
        data: {
          agent_id: fixture.agentId,
          category_id_snapshot: fixture.categoryId,
          category_name_snapshot: fixture.categoryName,
          commission_base: '49.00',
          effective_rate: '10.0000',
          id: fixture.commissionSnapshotId,
          order_item_id: fixture.orderItemId,
          original_commission: '4.90',
          product_id_snapshot: fixture.productId,
          rule_version_id: fixture.commissionRuleId,
          sku_id_snapshot: fixture.skuId,
          source_type: 'PLATFORM',
        },
      });
      await transaction.orderItemCommissionPosition.create({
        data: {
          expected_remaining: '4.90',
          id: fixture.commissionPositionId,
          original_commission: '4.90',
          reversed_total: '0.00',
          snapshot_id: fixture.commissionSnapshotId,
          state: 'EXPECTED',
          version: 1,
        },
      });
      await transaction.orderAddressSnapshot.create({
        data: {
          city: 'Development City',
          detail_ciphertext: mainAddress.detailCiphertext,
          district: 'Development District',
          encryption_key_id: mainAddress.encryptionKeyId,
          id: fixture.addressSnapshotId,
          order_id: fixture.orderId,
          phone_ciphertext: mainAddress.phoneCiphertext,
          phone_last4: mainAddress.phoneLast4,
          province: 'Development Province',
          recipient_name: fixture.rawRecipient,
        },
      });
      await transaction.orderAttributionCandidate.create({
        data: {
          candidate_agent_id: fixture.agentId,
          finalization_result: 'AGENT',
          finalized_at: now,
          id: fixture.attributionCandidateId,
          order_id: fixture.orderId,
          submit_channel: 'AGENT',
          submitted_at: now,
        },
      });
      await transaction.orderAttributionSnapshot.create({
        data: {
          captured_at: now,
          agent_id_snapshot: fixture.agentId,
          final_channel: 'AGENT',
          id: fixture.attributionSnapshotId,
          order_id: fixture.orderId,
        },
      });
      await transaction.paymentIntent.create({
        data: {
          amount: '49.00',
          create_requested_at: now,
          expires_at: new Date(now.getTime() + 30 * 60_000),
          id: fixture.paymentIntentId,
          intent_no: `PI${fixture.paymentIntentId}`,
          order_id: fixture.orderId,
          provider: 'MOCK',
          provider_intent_id: `b11-provider-${fixture.marker}`,
          provider_state: 'SUCCEEDED',
          status: 'SUCCEEDED',
          succeeded_at: now,
          version: 2,
        },
      });
      await transaction.paymentAttempt.create({
        data: {
          amount: '49.00',
          finished_at: now,
          id: fixture.paymentAttemptId,
          payment_intent_id: fixture.paymentIntentId,
          provider: 'MOCK',
          provider_transaction_id: `b11-transaction-${fixture.marker}`,
          status: 'SUCCEEDED',
        },
      });

      await transaction.salesOrder.create({
        data: {
          created_at: expiredCreatedAt,
          customer_id: fixture.customerId,
          goods_amount: '49.00',
          id: fixture.expiredOrderId,
          order_no: `QX${fixture.expiredOrderId}`,
          pay_expires_at: expiredPayExpiresAt,
          payable_amount: '49.00',
          shipping_amount: '0.00',
          source: 'BUY_NOW',
          updated_at: expiredCreatedAt,
        },
      });
      await transaction.orderItem.create({
        data: {
          brand_name_snapshot: fixture.brandName,
          category_id: fixture.categoryId,
          category_name_snapshot: fixture.categoryName,
          created_at: expiredCreatedAt,
          id: fixture.expiredOrderItemId,
          line_paid_amount: '49.00',
          order_id: fixture.expiredOrderId,
          product_id: fixture.productId,
          product_name_snapshot: fixture.productName,
          quantity: 1,
          sku_code_snapshot: fixture.skuCode,
          sku_id: fixture.skuId,
          sku_name_snapshot: fixture.skuName,
          unit_price: '49.00',
        },
      });
      await transaction.orderAddressSnapshot.create({
        data: {
          city: 'Development City',
          created_at: expiredCreatedAt,
          detail_ciphertext: expiredAddress.detailCiphertext,
          district: 'Development District',
          encryption_key_id: expiredAddress.encryptionKeyId,
          id: fixture.expiredAddressSnapshotId,
          order_id: fixture.expiredOrderId,
          phone_ciphertext: expiredAddress.phoneCiphertext,
          phone_last4: expiredAddress.phoneLast4,
          province: 'Development Province',
          recipient_name: fixture.rawRecipient,
        },
      });
      await transaction.orderAttributionCandidate.create({
        data: {
          id: fixture.expiredAttributionCandidateId,
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
          actor_account_id: fixture.customerAccountId,
          business_id: fixture.expiredReservationId,
          id: fixture.expiredReserveLedgerId,
          ledger_type: 'ORDER_RESERVE',
          locked_after: 1,
          locked_change: 1,
          physical_after: 8,
          physical_change: 0,
          reason: 'ORDER_RESERVE',
          sku_id: fixture.skuId,
        },
      });
    });
  } finally {
    await runtime.disconnect();
  }
}

async function scanRedisKeys(redis) {
  const keys = [];
  for await (const batch of redis.scanIterator({ MATCH: '*', COUNT: 100 })) {
    if (Array.isArray(batch)) keys.push(...batch);
    else keys.push(batch);
  }
  return keys;
}

async function assertRedisEmpty() {
  const { createClient } = apiRequire('redis');
  const redis = createClient({ url: required('REDIS_URL') });
  try {
    await redis.connect();
    const keys = await scanRedisKeys(redis);
    if (keys.length !== 0) refuse('the isolated B11 Redis database is not empty before the test');
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

async function clearRedis() {
  const { createClient } = apiRequire('redis');
  const redis = createClient({ url: required('REDIS_URL') });
  try {
    await redis.connect();
    const keys = await scanRedisKeys(redis);
    // Fixed-window rate-limit facts may expire during the real five-minute PII timer check.
    if (keys.length > 0) await redis.del(keys);
    const residual = await scanRedisKeys(redis);
    if (residual.length !== 0) throw new Error('B11 isolated Redis facts remain after cleanup');
  } finally {
    if (redis.isOpen) await redis.quit();
  }
}

async function assertFixture(createDatabaseRuntime, fixture) {
  const { HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  const object = await storageClient().send(new HeadObjectCommand({
    Bucket: required('S3_BUCKET'),
    Key: fixture.objectKey,
  }));
  if (object.ContentLength !== PNG_BYTES.length || object.ContentType !== 'image/png') {
    throw new Error('B11 MinIO fixture object no longer matches its exact content facts');
  }

  const { deriveIdempotencyScope } = require('../../packages/database/dist/src/index.js');
  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const [order, expiredOrder, audits, commissionLedgers, commissionPosition, wallet] =
      await Promise.all([
      runtime.prisma.salesOrder.findUnique({
        include: { items: true, shipment: { include: { events: true, items: true } } },
        where: { id: fixture.orderId },
      }),
      runtime.prisma.salesOrder.findUnique({
        include: { inventory_reservation: true },
        where: { id: fixture.expiredOrderId },
      }),
      runtime.prisma.auditLog.findMany({
        where: {
          OR: [
            { actor_account_id: { in: [fixture.adminAccountId, fixture.customerAccountId] } },
            { object_id: { in: [fixture.orderId, fixture.expiredOrderId] } },
          ],
        },
      }),
      runtime.prisma.commissionLedger.findMany({
        where: {
          agent_id: fixture.agentId,
          ledger_type: 'AVAILABLE_CREDIT',
          snapshot_id: fixture.commissionSnapshotId,
        },
      }),
      runtime.prisma.orderItemCommissionPosition.findUnique({ where: { id: fixture.commissionPositionId } }),
      runtime.prisma.agentWallet.findUnique({ where: { id: fixture.agentWalletId } }),
    ]);
    const commissionLedger = commissionLedgers[0];
    const shipment = order?.shipment;
    const scopes = {
      confirmReceipt: deriveIdempotencyScope({
        method: 'POST',
        route: '/store/orders/{order_id}/confirm-receipt',
      }),
      createShipment: deriveIdempotencyScope({
        method: 'POST',
        route: '/admin/orders/{order_id}/shipments',
      }),
      updateShipment: deriveIdempotencyScope({
        method: 'POST',
        route: '/admin/shipments/{shipment_id}/events',
      }),
    };
    const idempotency = shipment ? await runtime.prisma.idempotencyRecord.findMany({
      orderBy: [{ actor_id: 'asc' }, { scope: 'asc' }],
      where: {
        OR: [
          { actor_id: fixture.adminAccountId, resource_id: shipment.id, scope: scopes.createShipment },
          { actor_id: fixture.adminAccountId, resource_id: shipment.id, scope: scopes.updateShipment },
          { actor_id: fixture.customerAccountId, resource_id: fixture.orderId, scope: scopes.confirmReceipt },
        ],
      },
    }) : [];
    const outbox = await runtime.prisma.outboxEvent.findMany({
      where: {
        aggregate_id: {
          in: [
            fixture.orderId,
            fixture.expiredOrderId,
            ...(shipment ? [shipment.id] : []),
            ...commissionLedgers.map(({ id }) => id),
          ],
        },
      },
    });
    if (!order || order.order_status !== 'COMPLETED' || order.payment_status !== 'PAID' ||
      order.fulfillment_status !== 'DELIVERED' || order.completion_reason !== 'CUSTOMER_CONFIRMED' ||
      order.business_rule_version_id !== fixture.businessRuleId || order.completed_at === null ||
      order.aftersale_expires_at === null || order.aftersale_expires_at <= order.completed_at ||
      order.aftersale_expires_at.getTime() - order.completed_at.getTime() !== 5 * 86_400_000 ||
      order.items.length !== 1 || order.items[0]?.shipped_qty !== 1 || !shipment ||
      shipment.status !== 'DELIVERED' || shipment.delivered_at === null || shipment.items.length !== 1 ||
      shipment.events.length !== 1 || shipment.events[0]?.status_code !== 'IN_TRANSIT') {
      throw new Error('B11 main order did not converge to the exact customer-confirmed delivery facts');
    }
    if (!expiredOrder || expiredOrder.order_status !== 'CLOSED' ||
      expiredOrder.close_reason !== 'PAYMENT_TIMEOUT' ||
      expiredOrder.inventory_reservation?.status !== 'EXPIRED') {
      throw new Error('B11 Worker did not converge the expired order and reservation');
    }
    if (commissionLedgers.length !== 1 || !commissionLedger ||
      commissionLedger.available_change.toFixed(2) !== '4.90' ||
      commissionLedger.expected_change.toFixed(2) !== '-4.90' ||
      commissionLedger.reason !== 'ORDER_COMPLETED' || !commissionPosition ||
      commissionPosition.state !== 'AVAILABLE' || commissionPosition.expected_remaining.toFixed(2) !== '0.00' ||
      commissionPosition.available_at === null || commissionPosition.version !== 2 || !wallet ||
      wallet.available_balance.toFixed(2) !== '5.90' || wallet.frozen_balance.toFixed(2) !== '0.00' ||
      wallet.version !== 2) {
      throw new Error('B11 positive commission and wallet facts did not converge exactly once');
    }
    const idempotencyFacts = idempotency.map((record) => ({
      actorId: record.actor_id,
      hasResponseHash: /^[a-f0-9]{64}$/.test(record.response_body_hash ?? ''),
      resourceId: record.resource_id,
      responseBody: record.response_body,
      responseStatus: record.response_status,
      scope: record.scope,
    }));
    const expectedIdempotencyFacts = [
      {
        actorId: fixture.adminAccountId,
        hasResponseHash: true,
        resourceId: shipment.id,
        responseBody: null,
        responseStatus: 201,
        scope: scopes.createShipment,
      },
      {
        actorId: fixture.adminAccountId,
        hasResponseHash: true,
        resourceId: shipment.id,
        responseBody: null,
        responseStatus: 200,
        scope: scopes.updateShipment,
      },
      {
        actorId: fixture.customerAccountId,
        hasResponseHash: true,
        resourceId: fixture.orderId,
        responseBody: null,
        responseStatus: 200,
        scope: scopes.confirmReceipt,
      },
    ].sort((left, right) => left.actorId.localeCompare(right.actorId) || left.scope.localeCompare(right.scope));
    if (JSON.stringify(idempotencyFacts) !== JSON.stringify(expectedIdempotencyFacts)) {
      throw new Error('B11 write commands did not persist the exact three HASH_ONLY idempotency facts');
    }

    const auditFacts = audits.filter((audit) => audit.module === 'fulfillment' &&
      [fixture.orderId, shipment.id].includes(audit.object_id)).map((audit) => ({
      action: audit.action,
      actorId: audit.actor_account_id,
      hasIdempotencyKey: audit.idempotency_key !== null,
      objectId: audit.object_id,
      objectType: audit.object_type,
      result: audit.result,
      resultCode: audit.result_code,
    })).sort((left, right) => String(left.actorId).localeCompare(String(right.actorId)) ||
      left.action.localeCompare(right.action) || left.objectId.localeCompare(right.objectId));
    const expectedAuditFacts = [
      {
        action: 'CREATE', actorId: fixture.adminAccountId, hasIdempotencyKey: true,
        objectId: shipment.id, objectType: 'shipment', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'UPDATE', actorId: fixture.adminAccountId, hasIdempotencyKey: true,
        objectId: shipment.id, objectType: 'shipment', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'READ_SENSITIVE', actorId: fixture.adminAccountId, hasIdempotencyKey: false,
        objectId: fixture.orderId, objectType: 'order', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'CONFIRM', actorId: fixture.customerAccountId, hasIdempotencyKey: true,
        objectId: fixture.orderId, objectType: 'order', result: 'SUCCESS', resultCode: 'OK',
      },
    ].sort((left, right) => left.actorId.localeCompare(right.actorId) ||
      left.action.localeCompare(right.action) || left.objectId.localeCompare(right.objectId));
    if (JSON.stringify(auditFacts) !== JSON.stringify(expectedAuditFacts)) {
      throw new Error('B11 fulfillment audit facts were not persisted exactly once');
    }

    const expectedOutboxFacts = [
      [shipment.id, 'shipment.created'],
      [shipment.id, 'shipment.updated'],
      [fixture.orderId, 'order.completed'],
      [fixture.expiredOrderId, 'order.closed'],
      [commissionLedger.id, 'commission.available.credited'],
    ].sort(([leftAggregate, leftType], [rightAggregate, rightType]) =>
      leftAggregate.localeCompare(rightAggregate) || leftType.localeCompare(rightType));
    const outboxFacts = outbox.map(({ aggregate_id: aggregateId, event_type: eventType }) =>
      [aggregateId, eventType]).sort(([leftAggregate, leftType], [rightAggregate, rightType]) =>
      leftAggregate.localeCompare(rightAggregate) || leftType.localeCompare(rightType));
    if (JSON.stringify(outboxFacts) !== JSON.stringify(expectedOutboxFacts)) {
      throw new Error('B11 fulfillment Outbox facts were not persisted exactly once');
    }
    const protectedFacts = JSON.stringify({ audits, idempotency, outbox });
    for (const value of [fixture.rawPhone, fixture.rawAddressDetail, fixture.rawRecipient, fixture.trackingNo]) {
      if (protectedFacts.includes(value)) throw new Error('B11 protected fulfillment data leaked into durable diagnostics');
    }
  } finally {
    await runtime.disconnect();
  }
}

async function deleteFixture(createDatabaseRuntime, fixture) {
  const errors = [];
  const { DeleteObjectCommand, HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  try {
    await storageClient().send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: fixture.objectKey }));
    try {
      await storageClient().send(new HeadObjectCommand({ Bucket: required('S3_BUCKET'), Key: fixture.objectKey }));
      errors.push(new Error('B11 MinIO object remains after exact deletion'));
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') {
        errors.push(error);
      }
    }
  } catch (error) {
    errors.push(error);
  }

  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b11-vertical-cleanup',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let client;
  let resourceIdsForResidual = [
    fixture.orderId,
    fixture.expiredOrderId,
    fixture.businessRuleId,
    fixture.commissionRuleId,
  ];
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const orderIds = [fixture.orderId, fixture.expiredOrderId];
    const accountIds = [fixture.adminAccountId, fixture.customerAccountId, fixture.agentAccountId];
    const shipmentRows = await client.query(
      'SELECT id::text FROM public.shipment WHERE order_id::text = ANY($1::text[])', [orderIds],
    );
    const shipmentIds = shipmentRows.rows.map(({ id }) => id);
    const eventRows = await client.query(
      'SELECT id::text FROM public.logistics_event WHERE shipment_id::text = ANY($1::text[])', [shipmentIds],
    );
    const eventIds = eventRows.rows.map(({ id }) => id);
    const commissionRows = await client.query(
      'SELECT id::text FROM public.commission_ledger WHERE agent_id = $1', [fixture.agentId],
    );
    const commissionLedgerIds = commissionRows.rows.map(({ id }) => id);
    const inventoryRows = await client.query(
      'SELECT id::text FROM public.inventory_ledger WHERE sku_id = $1', [fixture.skuId],
    );
    const inventoryLedgerIds = inventoryRows.rows.map(({ id }) => id);
    const resourceIds = [
      ...accountIds,
      ...orderIds,
      ...shipmentIds,
      ...eventIds,
      ...commissionLedgerIds,
      ...inventoryLedgerIds,
      fixture.businessRuleId,
      fixture.commissionRuleId,
    ];
    resourceIdsForResidual = resourceIds;
    const factorRows = await client.query(
      'SELECT id::text FROM public.totp_factor WHERE account_id = $1', [fixture.adminAccountId],
    );
    const factorIds = factorRows.rows.map(({ id }) => id);
    const sessionRows = await client.query(
      'SELECT id::text FROM public.auth_session WHERE account_id::text = ANY($1::text[])', [accountIds],
    );
    const sessionIds = sessionRows.rows.map(({ id }) => id);
    resourceIds.push(...sessionIds);

    await client.query(
      `DELETE FROM public.outbox_event
       WHERE aggregate_id::text = ANY($1::text[])`,
      [resourceIds],
    );
    await client.query(
      'DELETE FROM public.audit_log WHERE actor_account_id::text = ANY($1::text[]) OR object_id = ANY($2::text[])',
      [accountIds, resourceIds],
    );
    await client.query(
      `DELETE FROM public.idempotency_record
       WHERE actor_id::text = ANY($1::text[]) OR resource_id::text = ANY($2::text[])`,
      [accountIds, resourceIds],
    );
    await client.query('DELETE FROM public.high_risk_operation_preview WHERE actor_account_id = $1',
      [fixture.adminAccountId]);
    await client.query('DELETE FROM public.admin_reauth_grant WHERE account_id = $1', [fixture.adminAccountId]);
    await client.query('DELETE FROM public.admin_reauth_attempt WHERE account_id = $1', [fixture.adminAccountId]);
    await client.query('DELETE FROM public.totp_recovery_code WHERE factor_id::text = ANY($1::text[])', [factorIds]);
    await client.query('DELETE FROM public.mfa_challenge WHERE account_id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.auth_session WHERE account_id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.totp_factor WHERE account_id = $1', [fixture.adminAccountId]);
    await client.query('DELETE FROM public.mfa_rate_limit WHERE account_id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.consent_record WHERE account_id = $1', [fixture.customerAccountId]);
    await client.query('DELETE FROM public.logistics_event WHERE shipment_id::text = ANY($1::text[])', [shipmentIds]);
    await client.query('DELETE FROM public.shipment_item WHERE shipment_id::text = ANY($1::text[])', [shipmentIds]);
    await client.query('DELETE FROM public.shipment WHERE id::text = ANY($1::text[])', [shipmentIds]);
    await client.query(
      'DELETE FROM public.payment_attempt WHERE payment_intent_id IN (SELECT id FROM public.payment_intent WHERE order_id::text = ANY($1::text[]))',
      [orderIds],
    );
    await client.query('DELETE FROM public.payment_intent WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.commission_ledger WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.order_item_commission_position WHERE id = $1',
      [fixture.commissionPositionId]);
    await client.query('DELETE FROM public.order_item_commission_snapshot WHERE id = $1',
      [fixture.commissionSnapshotId]);
    await client.query('DELETE FROM public.inventory_ledger WHERE sku_id = $1', [fixture.skuId]);
    await client.query(
      'DELETE FROM public.inventory_reservation_item WHERE reservation_id IN (SELECT id FROM public.inventory_reservation WHERE order_id::text = ANY($1::text[]))',
      [orderIds],
    );
    await client.query('DELETE FROM public.inventory_reservation WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_attribution_snapshot WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_attribution_candidate WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_address_snapshot WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_item WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.business_rule_version WHERE id = $1', [fixture.businessRuleId]);
    await client.query('DELETE FROM public.commission_rule_version WHERE id = $1', [fixture.commissionRuleId]);
    await client.query('DELETE FROM public.product_image WHERE product_id = $1', [fixture.productId]);
    await client.query('DELETE FROM public.inventory_balance WHERE sku_id = $1', [fixture.skuId]);
    await client.query('DELETE FROM public.sku WHERE id = $1', [fixture.skuId]);
    await client.query('DELETE FROM public.product WHERE id = $1', [fixture.productId]);
    await client.query('DELETE FROM public.file_asset WHERE id = $1', [fixture.fileId]);
    await client.query('DELETE FROM public.brand WHERE id = $1', [fixture.brandId]);
    await client.query('DELETE FROM public.category WHERE id = $1', [fixture.categoryId]);
    await client.query('DELETE FROM public.agent_wallet WHERE agent_id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.agent_profile WHERE id = $1', [fixture.agentId]);
    await client.query('DELETE FROM public.customer_profile WHERE id = $1', [fixture.customerId]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [accountIds]);
    await client.query('COMMIT');
  } catch (error) {
    await client?.query('ROLLBACK').catch(() => undefined);
    errors.push(error);
  } finally {
    client?.release();
    await pool.end();
  }

  const runtime = databaseRuntime(createDatabaseRuntime);
  try {
    await runtime.connect();
    const accountIds = [fixture.adminAccountId, fixture.customerAccountId, fixture.agentAccountId];
    const orderIds = [fixture.orderId, fixture.expiredOrderId];
    const residual = {
      account: await runtime.prisma.account.count({
        where: { id: { in: accountIds } },
      }),
      addressSnapshot: await runtime.prisma.orderAddressSnapshot.count({ where: { order_id: { in: orderIds } } }),
      agentProfile: await runtime.prisma.agentProfile.count({ where: { id: fixture.agentId } }),
      agentWallet: await runtime.prisma.agentWallet.count({ where: { id: fixture.agentWalletId } }),
      adminReauthAttempt: await runtime.prisma.adminReauthAttempt.count({
        where: { account_id: fixture.adminAccountId },
      }),
      adminReauthGrant: await runtime.prisma.adminReauthGrant.count({
        where: { account_id: fixture.adminAccountId },
      }),
      audit: await runtime.prisma.auditLog.count({
        where: {
          OR: [
            { actor_account_id: { in: accountIds } },
            { object_id: { in: resourceIdsForResidual } },
          ],
        },
      }),
      authSession: await runtime.prisma.authSession.count({ where: { account_id: { in: accountIds } } }),
      brand: await runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      businessRule: await runtime.prisma.businessRuleVersion.count({ where: { id: fixture.businessRuleId } }),
      category: await runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      commissionLedger: await runtime.prisma.commissionLedger.count({ where: { agent_id: fixture.agentId } }),
      commissionPosition: await runtime.prisma.orderItemCommissionPosition.count({
        where: { id: fixture.commissionPositionId },
      }),
      commissionRuleVersion: await runtime.prisma.commissionRuleVersion.count({
        where: { id: fixture.commissionRuleId },
      }),
      commissionSnapshot: await runtime.prisma.orderItemCommissionSnapshot.count({
        where: { id: fixture.commissionSnapshotId },
      }),
      consent: await runtime.prisma.consentRecord.count({ where: { account_id: fixture.customerAccountId } }),
      customerProfile: await runtime.prisma.customerProfile.count({ where: { id: fixture.customerId } }),
      file: await runtime.prisma.fileAsset.count({ where: { id: fixture.fileId } }),
      idempotency: await runtime.prisma.idempotencyRecord.count({
        where: {
          OR: [
            { actor_id: { in: accountIds } },
            { resource_id: { in: resourceIdsForResidual } },
          ],
        },
      }),
      highRiskPreview: await runtime.prisma.highRiskOperationPreview.count({
        where: { actor_account_id: fixture.adminAccountId },
      }),
      inventoryBalance: await runtime.prisma.inventoryBalance.count({ where: { id: fixture.inventoryId } }),
      inventoryLedger: await runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      logisticsEvent: await runtime.prisma.logisticsEvent.count({
        where: { shipment: { order_id: { in: orderIds } } },
      }),
      mfaChallenge: await runtime.prisma.mfaChallenge.count({ where: { account_id: { in: accountIds } } }),
      mfaFactor: await runtime.prisma.totpFactor.count({ where: { account_id: fixture.adminAccountId } }),
      mfaRateLimit: await runtime.prisma.mfaRateLimit.count({ where: { account_id: { in: accountIds } } }),
      mfaRecoveryCode: await runtime.prisma.totpRecoveryCode.count({
        where: { factor: { account_id: fixture.adminAccountId } },
      }),
      order: await runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
      orderAttributionCandidate: await runtime.prisma.orderAttributionCandidate.count({
        where: { order_id: { in: orderIds } },
      }),
      orderAttributionSnapshot: await runtime.prisma.orderAttributionSnapshot.count({
        where: { order_id: { in: orderIds } },
      }),
      orderItem: await runtime.prisma.orderItem.count({ where: { order_id: { in: orderIds } } }),
      outbox: await runtime.prisma.outboxEvent.count({
        where: { aggregate_id: { in: resourceIdsForResidual } },
      }),
      paymentAttempt: await runtime.prisma.paymentAttempt.count({
        where: { payment_intent: { order_id: { in: orderIds } } },
      }),
      paymentIntent: await runtime.prisma.paymentIntent.count({ where: { order_id: { in: orderIds } } }),
      product: await runtime.prisma.product.count({ where: { id: fixture.productId } }),
      productImage: await runtime.prisma.productImage.count({ where: { id: fixture.imageId } }),
      reservation: await runtime.prisma.inventoryReservation.count({ where: { order_id: { in: orderIds } } }),
      reservationItem: await runtime.prisma.inventoryReservationItem.count({
        where: { reservation: { order_id: { in: orderIds } } },
      }),
      shipment: await runtime.prisma.shipment.count({ where: { order_id: { in: orderIds } } }),
      shipmentItem: await runtime.prisma.shipmentItem.count({
        where: { shipment: { order_id: { in: orderIds } } },
      }),
      sku: await runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
    };
    const remaining = Object.fromEntries(Object.entries(residual).filter(([, count]) => count !== 0));
    if (Object.keys(remaining).length > 0) errors.push(new Error(`B11 fixture residue: ${JSON.stringify(remaining)}`));
  } catch (error) {
    errors.push(error);
  } finally {
    await runtime.disconnect().catch(() => undefined);
  }
  if (errors.length > 0) throw new AggregateError(errors, 'B11 exact fixture cleanup failed');
}

async function main() {
  validateTargets();
  process.env.API_PORT = testPort('B11_VERTICAL_API_PORT', '3000');
  const minioHealth = new URL('/minio/health/ready', required('S3_ENDPOINT'));
  const minioResponse = await globalThis.fetch(minioHealth, {
    signal: globalThis.AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!minioResponse?.ok) refuse('MinIO readiness endpoint is unavailable');

  run('pnpm', ['config:check'], 'runtime environment contract');
  run('pnpm', ['build:packages'], 'workspace package build');
  const { AdminAuthRepository, createDatabaseRuntime } =
    require('../../packages/database/dist/src/index.js');
  const { generateUlid, hashPassword, sha256Hex } =
    require('../../packages/platform-core/dist/index.js');
  const fixture = createFixture(generateUlid, sha256Hex);
  const protectedValues = [
    fixture.adminLogin,
    fixture.adminPassword,
    fixture.loginCode,
    fixture.rawAddressDetail,
    fixture.rawPhone,
    fixture.rawRecipient,
    fixture.trackingNo,
    fixture.wechatOpenId,
  ];
  let primaryError;
  const cleanupErrors = [];
  let cleanupRequired = false;
  let playwrightWorkspace;
  let redisBaselineReady = false;
  try {
    await assertRedisEmpty();
    redisBaselineReady = true;
    cleanupRequired = true;
    await seedFixture(createDatabaseRuntime, AdminAuthRepository, hashPassword, fixture);
    playwrightWorkspace = await mkdtemp(join(tmpdir(), 'qingxu-b11-playwright-'));
    const playwrightEphemeralSecretPath = join(playwrightWorkspace, 'ephemeral-secrets.json');
    const playwrightOutputDirectory = join(playwrightWorkspace, 'output');
    const playwrightFixturePath = join(playwrightWorkspace, 'fixture.json');
    await mkdir(playwrightOutputDirectory, { mode: 0o700 });
    await writeFile(playwrightEphemeralSecretPath, '[]', { mode: 0o600 });
    await writeFile(playwrightFixturePath, JSON.stringify({
      adminLogin: fixture.adminLogin,
      adminPassword: fixture.adminPassword,
      carrierName: fixture.carrierName,
      customerLoginCode: fixture.loginCode,
      expiredOrderId: fixture.expiredOrderId,
      orderId: fixture.orderId,
      productName: fixture.productName,
      rawAddressDetail: fixture.rawAddressDetail,
      rawPhone: fixture.rawPhone,
      rawRecipient: fixture.rawRecipient,
      trackingNo: fixture.trackingNo,
    }), { mode: 0o600 });
    Object.assign(process.env, {
      B11_VERTICAL_ADMIN_ORIGIN: `http://127.0.0.1:${testPort('B11_VERTICAL_ADMIN_PORT', '5175')}`,
      B11_VERTICAL_API_ORIGIN: `http://127.0.0.1:${testPort('B11_VERTICAL_API_PORT', '3000')}`,
      B11_VERTICAL_EPHEMERAL_SECRET_PATH: playwrightEphemeralSecretPath,
      B11_VERTICAL_FIXTURE_PATH: playwrightFixturePath,
      B11_VERTICAL_MINIAPP_ORIGIN: `http://127.0.0.1:${testPort('B11_VERTICAL_MINIAPP_PORT', '5173')}`,
      B11_VERTICAL_OUTPUT_DIR: playwrightOutputDirectory,
      B11_VERTICAL_WORKER_ORIGIN: `http://127.0.0.1:${testPort('B11_VERTICAL_WORKER_PORT', '3001')}`,
    });
    const playwright = runCaptured('pnpm', [
      'exec', 'playwright', 'test', '--config', 'playwright.b11-vertical.config.ts',
    ]);
    const diagnosticSecrets = [
      ...protectedValues,
      ...await readEphemeralPlaywrightSecrets(playwrightEphemeralSecretPath),
    ];
    if (diagnosticSecrets.some((value) => value && playwright.output.includes(value)) ||
      containsGeneratedAdminSecret(playwright.output)) {
      throw new Error('B11 protected fixture data leaked into captured browser diagnostics');
    }
    await assertNoSensitivePlaywrightArtifacts(playwrightOutputDirectory, diagnosticSecrets);
    if (playwright.failed) {
      throw new Error(`B11 browser-to-infrastructure Playwright test failed:\n${
        sanitizeDiagnostic(playwright.output, diagnosticSecrets)}`);
    }
    await assertFixture(createDatabaseRuntime, fixture);
  } catch (error) {
    primaryError = error;
  } finally {
    if (redisBaselineReady) {
      try {
        await clearRedis();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (cleanupRequired) {
      try {
        await deleteFixture(createDatabaseRuntime, fixture);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    if (playwrightWorkspace) {
      try {
        await rm(playwrightWorkspace, { force: true, recursive: true });
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    s3Client?.destroy();
    s3Client = undefined;
  }
  if (primaryError && cleanupErrors.length > 0) {
    throw new AggregateError([primaryError, ...cleanupErrors], 'B11 vertical test and cleanup failed');
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'B11 vertical cleanup failed');
  process.stdout.write('B11 browser-to-Nest/PostgreSQL/Redis/MinIO/Worker fulfillment test passed and cleaned.\n');
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
});
