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
  throw new Error(`B12 vertical test refused: ${message}`);
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
  result = result.replace(/([?&]X-Amz-[A-Za-z-]+=)[^&\s"'<>]+/giu, '$1[REDACTED]');
  return result.split(/\r?\n/u).filter(Boolean).slice(-50).join('\n').slice(-8_000) ||
    'No non-sensitive Playwright diagnostic was available.';
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

function idempotencyScope(route) {
  const digest = createHash('sha256').update(JSON.stringify({ method: 'POST', route })).digest('hex');
  return `idempotency:v1:${digest}`;
}

function containsGeneratedAdminSecret(text) {
  return text.includes('otpauth://') ||
    /\b[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}\b/u.test(text) ||
    /[?&]X-Amz-(?:Credential|Signature)=[^&\s"'<>]+/iu.test(text);
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
      throw new Error('B12 protected aftersale data leaked into an isolated Playwright artifact');
    }
  }
}

async function readEphemeralPlaywrightSecrets(path) {
  const value = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(value) || value.length > 32 || value.some((item) =>
    typeof item !== 'string' || item.length < 6 || item.length > 2_048)) {
    throw new Error('B12 Playwright ephemeral-secret manifest is invalid');
  }
  return value;
}

function validateTargets() {
  if (process.env.B12_VERTICAL_TEST_MODE !== 'full') {
    refuse('B12_VERTICAL_TEST_MODE must be explicitly set to full');
  }
  if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
    process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
    refuse('NODE_ENV=test, CI=true and the explicit ephemeral PostgreSQL capability are required');
  }
  if (process.env.STORE_IDENTITY_PROVIDER !== 'MOCK' || process.env.STORE_PHONE_PROVIDER !== 'MOCK' ||
    process.env.STORE_PAYMENT_PROVIDER !== 'MOCK') {
    refuse('B12 vertical requires the Mock identity, phone and payment providers');
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
    refuse('DATABASE_URL must be a query-free loopback mall_runtime B12 test database');
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
  if (!/^mall-b(?:[3-9]|1[0-2])-(?:ci|local|test)(?:-[a-z0-9-]+)?$/.test(bucket) ||
    publicBase.origin !== storage.origin ||
    publicBase.pathname.replace(/\/$/, '') !== `/${bucket}` || publicBase.username ||
    publicBase.password || publicBase.search || publicBase.hash) {
    refuse('S3_PUBLIC_BASE_URL must identify an isolated B3 through B12 test bucket on S3_ENDPOINT');
  }
  if (process.env.S3_FORCE_PATH_STYLE !== 'true') refuse('S3_FORCE_PATH_STYLE must be true');

  const ports = [
    testPort('B12_VERTICAL_API_PORT', '3000'),
    testPort('B12_VERTICAL_WORKER_PORT', '3001'),
    testPort('B12_VERTICAL_MINIAPP_PORT', '5173'),
    testPort('B12_VERTICAL_ADMIN_PORT', '5175'),
  ];
  if (ports[0] !== '3000') refuse('B12_VERTICAL_API_PORT must be 3000 for the Admin Vite proxy');
  if (new Set(ports).size !== ports.length) refuse('B12 vertical service ports must be distinct');

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
    applicationName: 'qingxu-b12-vertical',
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
  const loginCode = `mock:b12_vertical_${marker.toLowerCase()}`;
  const adminPassword = `B12-Vertical-${randomBytes(24).toString('base64url')}!`;
  const fileId = generateUlid();
  return {
    adminAccountId: generateUlid(),
    adminLogin: `b12-vertical-${marker.toLowerCase()}`,
    adminPassword,
    agentAccountId: generateUlid(),
    agentId: generateUlid(),
    agentWalletId: generateUlid(),
    addressSnapshotId: generateUlid(),
    attributionCandidateId: generateUlid(),
    attributionSnapshotId: generateUlid(),
    brandId: generateUlid(),
    brandName: `B12 Vertical Brand ${marker}`,
    businessRuleId: generateUlid(),
    carrierName: `B12 Development Carrier ${marker}`,
    categoryId: generateUlid(),
    categoryName: `B12 Vertical Category ${marker}`,
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
    productName: `B12 Vertical Product ${marker}`,
    rawAddressDetail: `Development address ${marker}`,
    rawPhone: ['100', '0000', marker.replace(/\D/g, '').padEnd(4, '0').slice(0, 4)].join(''),
    rawRecipient: `Development Recipient ${marker}`,
    returnAddressVersionId: generateUlid(),
    returnAddressRecipient: `Return Recipient ${marker}`,
    returnAddressPhone: ['200', '0000', marker.replace(/\D/g, '').padEnd(4, '0').slice(0, 4)].join(''),
    returnAddressProvince: `Return Province ${marker}`,
    returnAddressCity: `Return City ${marker}`,
    returnAddressDistrict: `Return District ${marker}`,
    returnAddressDetail: `Return address ${marker}`,
    returnCarrierCode: 'B12CARRIER',
    returnCarrierName: `B12 Return Carrier ${marker}`,
    returnTrackingNo: `B12-RETURN-${marker}`,
    shipmentId: generateUlid(),
    shipmentItemId: generateUlid(),
    skuCode: `B12V-SKU-${marker}`,
    skuId: generateUlid(),
    skuName: `B12 Vertical SKU ${marker}`,
    spuCode: `B12V-SPU-${marker}`,
    trackingNo: `B12-TRACK-${marker}`,
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
    if (publishedCount !== 0) refuse('the isolated B12 database already contains a PUBLISHED business rule');
    const publishedReturnAddressCount = await runtime.prisma.returnAddressVersion.count({ where: { status: 'PUBLISHED' } });
    if (publishedReturnAddressCount !== 0) refuse('the isolated B12 database already contains a PUBLISHED return address');
    await putFixtureObject(fixture);
    const passwordHash = await hashPassword(fixture.adminPassword);
    const agentPasswordHash = await hashPassword(`B12-Agent-${fixture.marker}!`);
    const auth = new AdminAuthRepository(runtime.prisma);
    const now = new Date();
    const expiredCreatedAt = new Date(now.getTime() - 31 * 60_000);
    const expiredPayExpiresAt = new Date(expiredCreatedAt.getTime() + 30 * 60_000);
    const {
      createEncryptionContext,
      createStoreOrderAddressSecurityMaterial,
      encryptEnvelope,
    } =
      require('../../packages/platform-core/dist/index.js');
    const fieldEncryptionKey = {
      id: required('FIELD_ENCRYPTION_KEY_ID'),
      key: Buffer.from(required('FIELD_ENCRYPTION_KEY_BASE64'), 'base64'),
    };
    const mainAddress = createStoreOrderAddressSecurityMaterial({
      detail: fixture.rawAddressDetail,
      phone: fixture.rawPhone,
      snapshotId: fixture.addressSnapshotId,
    }, fieldEncryptionKey);
    const expiredAddress = createStoreOrderAddressSecurityMaterial({
      detail: `Expired ${fixture.rawAddressDetail}`,
      phone: fixture.rawPhone,
      snapshotId: fixture.expiredAddressSnapshotId,
    }, fieldEncryptionKey);
    const serializeEnvelope = (envelope) => Buffer.from(JSON.stringify(envelope), 'utf8');
    const returnAddressPhoneCiphertext = serializeEnvelope(encryptEnvelope(
      fixture.returnAddressPhone,
      { key: fieldEncryptionKey.key, keyId: fieldEncryptionKey.id },
      createEncryptionContext('return_address_version', fixture.returnAddressVersionId, 'phone_ciphertext'),
    ));
    const returnAddressDetailCiphertext = serializeEnvelope(encryptEnvelope(
      fixture.returnAddressDetail,
      { key: fieldEncryptionKey.key, keyId: fieldEncryptionKey.id },
      createEncryptionContext('return_address_version', fixture.returnAddressVersionId, 'detail_ciphertext'),
    ));

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
          login_name: `b12-agent-${fixture.marker.toLowerCase()}`,
          password_hash: agentPasswordHash,
          role: 'AGENT_ADMIN',
          status: 'ACTIVE',
        },
      });
      await transaction.customerProfile.create({
        data: {
          account_id: fixture.customerAccountId,
          id: fixture.customerId,
          nickname: `B12 Customer ${fixture.marker}`,
        },
      });
      await transaction.agentProfile.create({
        data: {
          account_id: fixture.agentAccountId,
          agent_no: `B12-${fixture.marker}`,
          id: fixture.agentId,
          name: `B12 Development Agent ${fixture.marker}`,
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
          original_name: 'b12-vertical.png',
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
          sales_count: 2,
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
          retail_price: '10.00',
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
      const returnAddressVersion = await transaction.returnAddressVersion.aggregate({ _max: { version_no: true } });
      await transaction.commissionRuleVersion.create({
        data: {
          created_by_id: fixture.adminAccountId,
          effective_at: now,
          id: fixture.commissionRuleId,
          reason: 'B12 vertical frozen positive commission rule',
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
          reason: 'B12 vertical completion rule',
          status: 'PUBLISHED',
          version_no: (ruleVersion._max.version_no ?? 0) + 1,
        },
      });
      await transaction.returnAddressVersion.create({
        data: {
          city: fixture.returnAddressCity,
          created_at: now,
          created_by_id: fixture.adminAccountId,
          detail_ciphertext: returnAddressDetailCiphertext,
          district: fixture.returnAddressDistrict,
          effective_at: now,
          encryption_key_id: fieldEncryptionKey.id,
          id: fixture.returnAddressVersionId,
          phone_ciphertext: returnAddressPhoneCiphertext,
          phone_last4: fixture.returnAddressPhone.slice(-4),
          province: fixture.returnAddressProvince,
          reason: 'B12 vertical return address fixture',
          recipient_name: fixture.returnAddressRecipient,
          status: 'PUBLISHED',
          version_no: (returnAddressVersion._max.version_no ?? 0) + 1,
        },
      });
      await transaction.salesOrder.create({
        data: {
          created_at: now,
          customer_id: fixture.customerId,
          final_agent_id: fixture.agentId,
          final_channel: 'AGENT',
          fulfillment_status: 'DELIVERED',
          goods_amount: '20.00',
          id: fixture.orderId,
          order_no: `QX${fixture.orderId}`,
          order_status: 'SHIPPING',
          paid_amount: '20.00',
          paid_at: now,
          pay_expires_at: new Date(now.getTime() + 30 * 60_000),
          payable_amount: '20.00',
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
          line_paid_amount: '20.00',
          order_id: fixture.orderId,
          product_id: fixture.productId,
          product_name_snapshot: fixture.productName,
          quantity: 2,
          shipped_qty: 2,
          sku_code_snapshot: fixture.skuCode,
          sku_id: fixture.skuId,
          sku_name_snapshot: fixture.skuName,
          unit_price: '10.00',
        },
      });
      await transaction.shipment.create({
        data: {
          carrier_code: 'B12ORIGINAL',
          carrier_name: fixture.carrierName,
          created_at: now,
          delivered_at: now,
          id: fixture.shipmentId,
          items: {
            create: {
              created_at: now,
              id: fixture.shipmentItemId,
              order_item_id: fixture.orderItemId,
              quantity: 2,
            },
          },
          order_id: fixture.orderId,
          shipped_at: now,
          status: 'DELIVERED',
          tracking_no: fixture.trackingNo,
          updated_at: now,
          version: 1,
        },
      });
      await transaction.orderItemCommissionSnapshot.create({
        data: {
          agent_id: fixture.agentId,
          category_id_snapshot: fixture.categoryId,
          category_name_snapshot: fixture.categoryName,
          commission_base: '20.00',
          effective_rate: '10.0000',
          id: fixture.commissionSnapshotId,
          order_item_id: fixture.orderItemId,
          original_commission: '2.00',
          product_id_snapshot: fixture.productId,
          rule_version_id: fixture.commissionRuleId,
          sku_id_snapshot: fixture.skuId,
          source_type: 'PLATFORM',
        },
      });
      await transaction.orderItemCommissionPosition.create({
        data: {
          expected_remaining: '2.00',
          id: fixture.commissionPositionId,
          original_commission: '2.00',
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
          amount: '20.00',
          create_requested_at: now,
          expires_at: new Date(now.getTime() + 30 * 60_000),
          id: fixture.paymentIntentId,
          intent_no: `PI${fixture.paymentIntentId}`,
          order_id: fixture.orderId,
          provider: 'MOCK',
          provider_intent_id: `b12-provider-${fixture.marker}`,
          provider_state: 'SUCCEEDED',
          status: 'SUCCEEDED',
          succeeded_at: now,
          version: 2,
        },
      });
      await transaction.paymentAttempt.create({
        data: {
          amount: '20.00',
          finished_at: now,
          id: fixture.paymentAttemptId,
          payment_intent_id: fixture.paymentIntentId,
          provider: 'MOCK',
          provider_transaction_id: `b12-transaction-${fixture.marker}`,
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
    if (keys.length !== 0) refuse('the isolated B12 Redis database is not empty before the test');
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
    if (residual.length !== 0) throw new Error('B12 isolated Redis facts remain after cleanup');
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
    throw new Error('B12 MinIO fixture object no longer matches its exact content facts');
  }

  const runtime = databaseRuntime(createDatabaseRuntime);
  await runtime.connect();
  try {
    const aftersales = await runtime.prisma.aftersale.findMany({
      include: {
        evidence: { include: { file: true } },
        items: true,
        return_address: true,
        return_inspection: { include: { items: true } },
        return_shipment: true,
        refunds: { include: { attempts: true, items: true } },
      },
      where: { order_id: fixture.orderId },
    });
    const aftersale = aftersales.length === 1 ? aftersales[0] : undefined;
    const [order, balance, product, position, wallet] = await Promise.all([
      runtime.prisma.salesOrder.findUnique({ include: { items: true }, where: { id: fixture.orderId } }),
      runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.inventoryId } }),
      runtime.prisma.product.findUnique({ where: { id: fixture.productId } }),
      runtime.prisma.orderItemCommissionPosition.findUnique({ where: { id: fixture.commissionPositionId } }),
      runtime.prisma.agentWallet.findUnique({ where: { id: fixture.agentWalletId } }),
    ]);
    const refund = aftersale?.refunds[0];
    const returnAddress = aftersale?.return_address;
    const returnShipment = aftersale?.return_shipment;
    const returnInspection = aftersale?.return_inspection;
    const applicationEvidence = aftersale?.evidence.filter((evidence) =>
      evidence.purpose === 'APPLICATION' && evidence.return_inspection_id === null) ?? [];
    if (aftersales.length !== 1 || !aftersale ||
      aftersale.type !== 'RETURN_REFUND' || aftersale.status !== 'COMPLETED' ||
      aftersale.items.length !== 1 ||
      aftersale.items[0]?.requested_qty !== 2 || aftersale.items[0]?.refunded_qty !== 2 ||
      aftersale.items[0]?.reserved_qty !== 2 || aftersale.items[0]?.requested_amount.toFixed(2) !== '20.00' ||
      !refund || aftersale.refunds.length !== 1 || refund.status !== 'SUCCEEDED' ||
      refund.amount.toFixed(2) !== '20.00' || refund.attempts.length !== 1 ||
      refund.attempts[0]?.status !== 'SUCCEEDED' || refund.items.length !== 1 ||
      refund.items[0]?.quantity !== 2 || refund.items[0]?.amount.toFixed(2) !== '20.00' ||
      !returnAddress || returnAddress.source_version_id !== fixture.returnAddressVersionId ||
      !returnShipment || returnShipment.carrier_code !== fixture.returnCarrierCode ||
      returnShipment.carrier_name !== fixture.returnCarrierName ||
      returnShipment.tracking_no !== fixture.returnTrackingNo ||
      returnShipment.submitted_at === null || returnShipment.received_at === null ||
      !returnInspection || returnInspection.status !== 'PASS' || returnInspection.evidence_count !== 0 ||
      JSON.stringify(returnInspection.evidence_manifest) !== '[]' || returnInspection.resolution !== null ||
      returnInspection.items.length !== 1 || returnInspection.items[0]?.order_item_id !== fixture.orderItemId ||
      returnInspection.items[0]?.received_qty !== 2 || returnInspection.items[0]?.approved_refund_qty !== 2 ||
      returnInspection.items[0]?.restock_qty !== 2 || returnInspection.items[0]?.damaged_qty !== 0 ||
      returnInspection.items[0]?.scrap_qty !== 0 || returnInspection.items[0]?.return_to_customer_qty !== 0) {
      throw new Error(`B12 return-refund facts did not converge exactly once: ${JSON.stringify({
        aftersaleCount: aftersales.length,
        aftersaleItems: aftersale?.items.map((item) => ({
          amount: item.requested_amount.toFixed(2),
          refunded: item.refunded_qty,
          requested: item.requested_qty,
          reserved: item.reserved_qty,
        })) ?? null,
        aftersaleStatus: aftersale?.status ?? null,
        refundAmount: refund?.amount.toFixed(2) ?? null,
        refundAttemptStatuses: refund?.attempts.map(({ status }) => status) ?? null,
        refundItems: refund?.items.map((item) => ({ amount: item.amount.toFixed(2), quantity: item.quantity })) ?? null,
        refundStatus: refund?.status ?? null,
        returnAddressSource: returnAddress?.source_version_id ?? null,
        returnInspection: returnInspection === undefined ? null : {
          evidenceCount: returnInspection.evidence_count,
          items: returnInspection.items,
          manifest: returnInspection.evidence_manifest,
          resolution: returnInspection.resolution,
          status: returnInspection.status,
        },
        returnShipment: returnShipment === undefined ? null : {
          carrierCode: returnShipment.carrier_code,
          carrierName: returnShipment.carrier_name,
          receivedAt: returnShipment.received_at,
          submittedAt: returnShipment.submitted_at,
          trackingNo: returnShipment.tracking_no,
        },
      })}`);
    }
    if (applicationEvidence.length !== 1 ||
      applicationEvidence[0]?.file.created_by_id !== fixture.customerAccountId ||
      applicationEvidence[0]?.file.purpose !== 'AFTERSALE_EVIDENCE' ||
      applicationEvidence[0]?.file.status !== 'READY' ||
      applicationEvidence[0]?.file.visibility !== 'PRIVATE' ||
      applicationEvidence[0]?.file.object_key !== `private/${applicationEvidence[0]?.file_id}` ||
      applicationEvidence[0]?.file.mime_type !== 'image/png' ||
      applicationEvidence[0]?.file.byte_size !== BigInt(PNG_BYTES.length) ||
      applicationEvidence[0]?.file.sha256 !== PNG_SHA256) {
      throw new Error('B12 customer-owned private application evidence was not bound exactly once');
    }
    const privateObject = await storageClient().send(new HeadObjectCommand({
      Bucket: required('S3_BUCKET'),
      Key: applicationEvidence[0].file.object_key,
    }));
    if (privateObject.ContentLength !== PNG_BYTES.length || privateObject.ContentType !== 'image/png' ||
      privateObject.Metadata?.sha256 !== PNG_SHA256) {
      throw new Error('B12 private application evidence object does not match its immutable file facts');
    }
    if (!order || order.order_status !== 'COMPLETED' || order.close_reason !== null ||
      order.completion_reason !== 'FULL_REFUND_AFTER_SHIPMENT' || order.fulfillment_status !== 'DELIVERED' ||
      order.refund_progress_status !== 'FULL' || order.refund_processing_status !== 'IDLE' ||
      order.refunded_amount.toFixed(2) !== '20.00' || order.items.length !== 1 ||
      order.items[0]?.refunded_qty !== 2 || order.items[0]?.aftersale_reserved_qty !== 0 ||
      order.items[0]?.shipped_qty !== 2 || order.items[0]?.pre_shipment_refunded_qty !== 0 ||
      !balance || balance.physical_qty !== 10 || !product || product.sales_count !== 0) {
      throw new Error('B12 shipped return-refund order, inventory and sales facts did not converge');
    }
    if (!position || position.state !== 'CANCELLED' || position.expected_remaining.toFixed(2) !== '0.00' ||
      position.reversed_total.toFixed(2) !== '2.00' || !wallet ||
      wallet.available_balance.toFixed(2) !== '1.00' || wallet.frozen_balance.toFixed(2) !== '0.00') {
      throw new Error('B12 commission position did not reverse the expected amount exactly once');
    }
    const [inventoryLedgers, commissionLedgers] = await Promise.all([
      runtime.prisma.inventoryLedger.findMany({
        where: { business_id: refund.id, ledger_type: 'RETURN_RESTOCK' },
      }),
      runtime.prisma.commissionLedger.findMany({ where: { refund_id: refund.id } }),
    ]);
    if (inventoryLedgers.length !== 1 || commissionLedgers.length !== 1 ||
      commissionLedgers[0]?.ledger_type !== 'EXPECTED_CANCELLED') {
      throw new Error('B12 return inventory and commission reversal facts were not written exactly once');
    }
    if (Buffer.from(returnAddress.detail_ciphertext).toString('utf8').includes(fixture.returnAddressDetail) ||
      Buffer.from(returnAddress.phone_ciphertext).toString('utf8').includes(fixture.returnAddressPhone)) {
      throw new Error('B12 return address snapshot contains plaintext protected fields');
    }
    const callbackRows = await runtime.prisma.callbackInbox.findMany({
      where: { event_type: 'refund.succeeded', provider: 'MOCK' },
    });
    const refundAttemptId = refund.attempts[0]?.id;
    const associatedCallbacks = callbackRows.filter((callback) => {
      if (typeof callback.payload !== 'object' || callback.payload === null || Array.isArray(callback.payload)) return false;
      return callback.payload.refund_attempt_id === refundAttemptId &&
        callback.provider_event_id === refund.attempts[0]?.provider_request_id;
    });
    if (callbackRows.length !== 1 || associatedCallbacks.length !== 1 ||
      associatedCallbacks[0]?.status !== 'PROCESSED' || associatedCallbacks[0]?.signature_valid !== true ||
      associatedCallbacks[0]?.retry_count !== 0 || associatedCallbacks[0]?.processed_at === null) {
      throw new Error(`B12 refund callback Inbox did not converge exactly once: ${JSON.stringify({
        callbackRows: callbackRows.map((callback) => ({
          attemptId: typeof callback.payload === 'object' && callback.payload !== null && !Array.isArray(callback.payload)
            ? callback.payload.refund_attempt_id : null,
          id: callback.id,
          processedAt: callback.processed_at,
          retryCount: callback.retry_count,
          signatureValid: callback.signature_valid,
          status: callback.status,
        })),
        refundAttemptId,
      })}`);
    }
    const resourceIds = [
      fixture.orderId,
      aftersale.id,
      applicationEvidence[0].file_id,
      refund.id,
      ...refund.attempts.map(({ id }) => id),
      ...inventoryLedgers.map(({ id }) => id),
      ...commissionLedgers.map(({ id }) => id),
    ];
    const scopes = {
      approve: idempotencyScope('/admin/aftersales/{aftersale_id}/approve'),
      refundConfirm: idempotencyScope('/admin/aftersales/{aftersale_id}/refunds'),
      refundPreview: idempotencyScope('/admin/aftersales/{aftersale_id}/refund-preview'),
      returnInspection: idempotencyScope('/admin/aftersales/{aftersale_id}/return-inspections'),
      returnShipment: idempotencyScope('/store/aftersales/{aftersale_id}/return-shipment'),
      storeCreate: idempotencyScope('/store/aftersales'),
    };
    const [audits, idempotency, outbox] = await Promise.all([
      runtime.prisma.auditLog.findMany({
        where: { OR: [{ actor_account_id: { in: [fixture.adminAccountId, fixture.customerAccountId] } },
          { object_id: { in: resourceIds } }] },
      }),
      runtime.prisma.idempotencyRecord.findMany({
        where: {
          actor_id: { in: [fixture.adminAccountId, fixture.customerAccountId] },
          scope: { in: Object.values(scopes) },
        },
      }),
      runtime.prisma.outboxEvent.findMany({ where: { aggregate_id: { in: resourceIds } } }),
    ]);
    const actualIdempotency = idempotency.map((fact) => [
      fact.actor_id,
      fact.scope,
      String(fact.response_status),
      fact.resource_id ?? 'null',
    ].join('|')).sort();
    const expectedIdempotency = [
      [fixture.customerAccountId, scopes.storeCreate, '200', 'null'],
      [fixture.customerAccountId, scopes.storeCreate, '201', aftersale.id],
      [fixture.customerAccountId, scopes.returnShipment, '200', aftersale.id],
      [fixture.adminAccountId, scopes.approve, '200', aftersale.id],
      [fixture.adminAccountId, scopes.returnInspection, '200', aftersale.id],
      [fixture.adminAccountId, scopes.refundPreview, '200', aftersale.id],
      [fixture.adminAccountId, scopes.refundConfirm, '200', refund.id],
    ].map((fact) => fact.join('|')).sort();
    if (JSON.stringify(actualIdempotency) !== JSON.stringify(expectedIdempotency) ||
      idempotency.some((fact) => fact.response_body !== null ||
        !/^[a-f0-9]{64}$/.test(fact.response_body_hash ?? ''))) {
      throw new Error('B12 write commands did not persist HASH_ONLY idempotency facts');
    }
    const actualOutbox = outbox.map((fact) => [
      fact.aggregate_type,
      fact.aggregate_id,
      fact.event_type,
    ].join('|')).sort();
    const expectedOutbox = [
      ['file', applicationEvidence[0].file_id, 'file.staging_cleanup_requested'],
      ['refund', refund.id, 'refund.execution.requested'],
      ['refund', refund.id, 'refund.succeeded'],
      ['order', fixture.orderId, 'order.refund.succeeded'],
      ['inventory', inventoryLedgers[0].id, 'inventory.refund.restocked'],
      ['commission', commissionLedgers[0].id, 'commission.refund.reversed'],
    ].map((fact) => fact.join('|')).sort();
    if (JSON.stringify(actualOutbox) !== JSON.stringify(expectedOutbox)) {
      throw new Error('B12 refund Outbox facts did not converge exactly once');
    }
    const auditedObjectIds = new Set([aftersale.id, applicationEvidence[0].file_id, refund.id]);
    const auditFacts = audits.filter((fact) => auditedObjectIds.has(fact.object_id)).map((fact) => ({
      action: fact.action,
      actorId: fact.actor_account_id,
      hasIdempotencyKey: fact.idempotency_key !== null,
      module: fact.module,
      objectId: fact.object_id,
      objectType: fact.object_type,
      result: fact.result,
      resultCode: fact.result_code,
    })).sort((left, right) => left.objectId.localeCompare(right.objectId) ||
      left.action.localeCompare(right.action) || String(left.actorId).localeCompare(String(right.actorId)));
    const expectedAuditFacts = [
      {
        action: 'CREATE', actorId: fixture.customerAccountId, hasIdempotencyKey: true, module: 'file',
        objectId: applicationEvidence[0].file_id, objectType: 'file', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'COMPLETE', actorId: fixture.customerAccountId, hasIdempotencyKey: true, module: 'file',
        objectId: applicationEvidence[0].file_id, objectType: 'file', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'READ_SENSITIVE', actorId: fixture.adminAccountId, hasIdempotencyKey: false, module: 'file',
        objectId: applicationEvidence[0].file_id, objectType: 'file', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'CREATE', actorId: fixture.customerAccountId, hasIdempotencyKey: true, module: 'aftersale',
        objectId: aftersale.id, objectType: 'aftersale', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'APPROVE', actorId: fixture.adminAccountId, hasIdempotencyKey: true, module: 'aftersale',
        objectId: aftersale.id, objectType: 'aftersale', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'UPDATE', actorId: fixture.customerAccountId, hasIdempotencyKey: true, module: 'aftersale',
        objectId: aftersale.id, objectType: 'aftersale', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'RECORD_INSPECTION', actorId: fixture.adminAccountId, hasIdempotencyKey: true,
        module: 'aftersale', objectId: aftersale.id, objectType: 'aftersale', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'REFUND', actorId: fixture.adminAccountId, hasIdempotencyKey: true, module: 'refund',
        objectId: refund.id, objectType: 'refund', result: 'SUCCESS', resultCode: 'OK',
      },
      {
        action: 'REFUND', actorId: null, hasIdempotencyKey: false, module: 'refund',
        objectId: refund.id, objectType: 'refund', result: 'SUCCESS', resultCode: 'OK',
      },
    ].sort((left, right) => left.objectId.localeCompare(right.objectId) ||
      left.action.localeCompare(right.action) || String(left.actorId).localeCompare(String(right.actorId)));
    if (JSON.stringify(auditFacts) !== JSON.stringify(expectedAuditFacts)) {
      throw new Error(`B12 audit facts did not persist exactly once: ${JSON.stringify({
        actual: auditFacts,
        expected: expectedAuditFacts,
      })}`);
    }
    const protectedFacts = JSON.stringify({ audits, idempotency, outbox });
    for (const value of [
      fixture.rawPhone,
      fixture.rawAddressDetail,
      fixture.rawRecipient,
      fixture.returnAddressPhone,
      fixture.returnAddressDetail,
      fixture.returnAddressRecipient,
      fixture.returnCarrierName,
      fixture.returnTrackingNo,
    ]) {
      if (protectedFacts.includes(value)) throw new Error('B12 protected data leaked into durable diagnostics');
    }
  } finally {
    await runtime.disconnect();
  }
}

async function deleteFixture(createDatabaseRuntime, fixture, dynamicFileIds = []) {
  const errors = [];
  const { DeleteObjectCommand, HeadObjectCommand } = storageRequire('@aws-sdk/client-s3');
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b12-vertical-cleanup',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let evidenceAssets = dynamicFileIds.map((id) => ({ id, object_key: `private/${id}` }));
  try {
    const result = await pool.query(
      `SELECT id::text, object_key
       FROM public.file_asset
       WHERE created_by_id = $1 AND purpose = 'AFTERSALE_EVIDENCE'`,
      [fixture.customerAccountId],
    );
    evidenceAssets = [...new Map([...evidenceAssets, ...result.rows].map((asset) => [asset.id, asset])).values()];
  } catch (error) {
    errors.push(error);
  }
  const objectKeys = new Set([
    fixture.objectKey,
    ...evidenceAssets.flatMap(({ id, object_key: objectKey }) => [objectKey, `private/${id}`, `staging/${id}`]),
  ]);
  for (const objectKey of objectKeys) {
    try {
      await storageClient().send(new DeleteObjectCommand({ Bucket: required('S3_BUCKET'), Key: objectKey }));
      try {
        await storageClient().send(new HeadObjectCommand({ Bucket: required('S3_BUCKET'), Key: objectKey }));
        errors.push(new Error('B12 MinIO object remains after exact deletion'));
      } catch (error) {
        if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== 'NotFound' && error?.name !== 'NoSuchKey') {
          errors.push(error);
        }
      }
    } catch (error) {
      errors.push(error);
    }
  }

  let client;
  let resourceIdsForResidual = [
    fixture.orderId,
    fixture.expiredOrderId,
    fixture.businessRuleId,
    fixture.commissionRuleId,
    fixture.returnAddressVersionId,
  ];
  let aftersaleIdsForResidual = [];
  let callbackIdsForResidual = [];
  const evidenceFileIdsForResidual = evidenceAssets.map(({ id }) => id);
  let refundIdsForResidual = [];
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const orderIds = [fixture.orderId, fixture.expiredOrderId];
    const accountIds = [fixture.adminAccountId, fixture.customerAccountId, fixture.agentAccountId];
    const aftersaleRows = await client.query(
      'SELECT id::text FROM public.aftersale WHERE order_id::text = ANY($1::text[])', [orderIds],
    );
    const aftersaleIds = aftersaleRows.rows.map(({ id }) => id);
    aftersaleIdsForResidual = aftersaleIds;
    const refundRows = await client.query(
      'SELECT id::text FROM public.refund WHERE order_id::text = ANY($1::text[])', [orderIds],
    );
    const refundIds = refundRows.rows.map(({ id }) => id);
    refundIdsForResidual = refundIds;
    const refundAttemptRows = await client.query(
      `SELECT id::text, provider_request_id
       FROM public.refund_attempt
       WHERE refund_id::text = ANY($1::text[])`,
      [refundIds],
    );
    const refundAttemptIds = refundAttemptRows.rows.map(({ id }) => id);
    const providerEventIds = refundAttemptRows.rows
      .map(({ provider_request_id: providerEventId }) => providerEventId)
      .filter((providerEventId) => typeof providerEventId === 'string');
    const callbackRows = await client.query(
      `SELECT id::text FROM public.callback_inbox
       WHERE provider = 'MOCK'
         AND (payload->>'refund_no' = ANY($1::text[])
           OR payload->>'refund_attempt_id' = ANY($2::text[])
           OR provider_event_id = ANY($3::text[]))`,
      [refundIds.map((id) => `RF${id}`), refundAttemptIds, providerEventIds],
    );
    const callbackIds = callbackRows.rows.map(({ id }) => id);
    callbackIdsForResidual = callbackIds;
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
      ...aftersaleIds,
      ...evidenceFileIdsForResidual,
      ...refundIds,
      ...refundAttemptIds,
      ...callbackIds,
      fixture.businessRuleId,
      fixture.commissionRuleId,
      fixture.returnAddressVersionId,
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
    await client.query('DELETE FROM public.callback_inbox WHERE id::text = ANY($1::text[])', [callbackIds]);
    await client.query('DELETE FROM public.logistics_event WHERE shipment_id::text = ANY($1::text[])', [shipmentIds]);
    await client.query('DELETE FROM public.shipment_item WHERE shipment_id::text = ANY($1::text[])', [shipmentIds]);
    await client.query('DELETE FROM public.shipment WHERE id::text = ANY($1::text[])', [shipmentIds]);
    await client.query(
      'DELETE FROM public.payment_attempt WHERE payment_intent_id IN (SELECT id FROM public.payment_intent WHERE order_id::text = ANY($1::text[]))',
      [orderIds],
    );
    await client.query('DELETE FROM public.payment_intent WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query(
      'DELETE FROM public.commission_ledger WHERE agent_id = $1 OR refund_id::text = ANY($2::text[])',
      [fixture.agentId, refundIds],
    );
    await client.query('DELETE FROM public.refund_item WHERE refund_id::text = ANY($1::text[])', [refundIds]);
    await client.query('DELETE FROM public.refund_attempt WHERE refund_id::text = ANY($1::text[])', [refundIds]);
    await client.query('DELETE FROM public.refund WHERE id::text = ANY($1::text[])', [refundIds]);
    await client.query(
      `DELETE FROM public.return_inspection_item
       WHERE inspection_id IN (SELECT id FROM public.return_inspection WHERE aftersale_id::text = ANY($1::text[]))`,
      [aftersaleIds],
    );
    await client.query('DELETE FROM public.aftersale_evidence WHERE aftersale_id::text = ANY($1::text[])',
      [aftersaleIds]);
    await client.query('DELETE FROM public.return_inspection WHERE aftersale_id::text = ANY($1::text[])',
      [aftersaleIds]);
    await client.query('DELETE FROM public.return_shipment WHERE aftersale_id::text = ANY($1::text[])',
      [aftersaleIds]);
    await client.query('DELETE FROM public.return_address_snapshot WHERE aftersale_id::text = ANY($1::text[])',
      [aftersaleIds]);
    await client.query('DELETE FROM public.aftersale_item WHERE aftersale_id::text = ANY($1::text[])',
      [aftersaleIds]);
    await client.query('DELETE FROM public.aftersale WHERE id::text = ANY($1::text[])', [aftersaleIds]);
    await client.query('DELETE FROM public.file_asset WHERE id::text = ANY($1::text[])',
      [evidenceFileIdsForResidual]);
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
    await client.query('DELETE FROM public.return_address_version WHERE id = $1', [fixture.returnAddressVersionId]);
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
      aftersale: await runtime.prisma.aftersale.count({ where: { id: { in: aftersaleIdsForResidual } } }),
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
      callbackInbox: await runtime.prisma.callbackInbox.count({ where: { id: { in: callbackIdsForResidual } } }),
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
      file: await runtime.prisma.fileAsset.count({
        where: { id: { in: [fixture.fileId, ...evidenceFileIdsForResidual] } },
      }),
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
      refund: await runtime.prisma.refund.count({ where: { id: { in: refundIdsForResidual } } }),
      refundAttempt: await runtime.prisma.refundAttempt.count({
        where: { refund_id: { in: refundIdsForResidual } },
      }),
      reservation: await runtime.prisma.inventoryReservation.count({ where: { order_id: { in: orderIds } } }),
      reservationItem: await runtime.prisma.inventoryReservationItem.count({
        where: { reservation: { order_id: { in: orderIds } } },
      }),
      returnAddressVersion: await runtime.prisma.returnAddressVersion.count({
        where: { id: fixture.returnAddressVersionId },
      }),
      shipment: await runtime.prisma.shipment.count({ where: { order_id: { in: orderIds } } }),
      shipmentItem: await runtime.prisma.shipmentItem.count({
        where: { shipment: { order_id: { in: orderIds } } },
      }),
      sku: await runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
    };
    const remaining = Object.fromEntries(Object.entries(residual).filter(([, count]) => count !== 0));
    if (Object.keys(remaining).length > 0) errors.push(new Error(`B12 fixture residue: ${JSON.stringify(remaining)}`));
  } catch (error) {
    errors.push(error);
  } finally {
    await runtime.disconnect().catch(() => undefined);
  }
  if (errors.length > 0) throw new AggregateError(errors, 'B12 exact fixture cleanup failed');
}

async function main() {
  validateTargets();
  process.env.API_PORT = testPort('B12_VERTICAL_API_PORT', '3000');
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
  const protectedValues = [...new Set([
    ...environmentProtectedValues(),
    fixture.adminLogin,
    fixture.adminPassword,
    fixture.loginCode,
    fixture.rawAddressDetail,
    fixture.rawPhone,
    fixture.rawRecipient,
    fixture.carrierName,
    fixture.returnAddressDetail,
    fixture.returnAddressPhone,
    fixture.returnAddressRecipient,
    fixture.returnAddressProvince,
    fixture.returnAddressCity,
    fixture.returnAddressDistrict,
    fixture.returnCarrierCode,
    fixture.returnCarrierName,
    fixture.returnTrackingNo,
    fixture.trackingNo,
    fixture.wechatOpenId,
  ])];
  let primaryError;
  const cleanupErrors = [];
  let dynamicFileIds = [];
  let cleanupRequired = false;
  let playwrightWorkspace;
  let redisBaselineReady = false;
  try {
    await assertRedisEmpty();
    redisBaselineReady = true;
    cleanupRequired = true;
    await seedFixture(createDatabaseRuntime, AdminAuthRepository, hashPassword, fixture);
    playwrightWorkspace = await mkdtemp(join(tmpdir(), 'qingxu-b12-playwright-'));
    const playwrightEphemeralSecretPath = join(playwrightWorkspace, 'ephemeral-secrets.json');
    const playwrightOutputDirectory = join(playwrightWorkspace, 'output');
    const playwrightFixturePath = join(playwrightWorkspace, 'fixture.json');
    await mkdir(playwrightOutputDirectory, { mode: 0o700 });
    await writeFile(playwrightEphemeralSecretPath, '[]', { mode: 0o600 });
    await writeFile(playwrightFixturePath, JSON.stringify({
      adminLogin: fixture.adminLogin,
      adminPassword: fixture.adminPassword,
      customerLoginCode: fixture.loginCode,
      orderId: fixture.orderId,
      orderItemId: fixture.orderItemId,
      productName: fixture.productName,
      publicImageUrl: `${required('S3_PUBLIC_BASE_URL').replace(/\/$/u, '')}/${fixture.objectKey}`,
      returnAddressVersionId: fixture.returnAddressVersionId,
      returnAddressRecipient: fixture.returnAddressRecipient,
      returnAddressPhone: fixture.returnAddressPhone,
      returnAddressProvince: fixture.returnAddressProvince,
      returnAddressCity: fixture.returnAddressCity,
      returnAddressDistrict: fixture.returnAddressDistrict,
      returnAddressDetail: fixture.returnAddressDetail,
      returnCarrierCode: fixture.returnCarrierCode,
      returnCarrierName: fixture.returnCarrierName,
      returnTrackingNo: fixture.returnTrackingNo,
    }), { mode: 0o600 });
    Object.assign(process.env, {
      B12_VERTICAL_ADMIN_ORIGIN: `http://127.0.0.1:${testPort('B12_VERTICAL_ADMIN_PORT', '5175')}`,
      B12_VERTICAL_API_ORIGIN: `http://127.0.0.1:${testPort('B12_VERTICAL_API_PORT', '3000')}`,
      B12_VERTICAL_EPHEMERAL_SECRET_PATH: playwrightEphemeralSecretPath,
      B12_VERTICAL_FIXTURE_PATH: playwrightFixturePath,
      B12_VERTICAL_MINIAPP_ORIGIN: `http://127.0.0.1:${testPort('B12_VERTICAL_MINIAPP_PORT', '5173')}`,
      B12_VERTICAL_OUTPUT_DIR: playwrightOutputDirectory,
      B12_VERTICAL_WORKER_ORIGIN: `http://127.0.0.1:${testPort('B12_VERTICAL_WORKER_PORT', '3001')}`,
    });
    const playwright = runCaptured('pnpm', [
      'exec', 'playwright', 'test', '--config', 'playwright.b12-vertical.config.ts',
    ]);
    const ephemeralSecrets = await readEphemeralPlaywrightSecrets(playwrightEphemeralSecretPath);
    dynamicFileIds = ephemeralSecrets.filter((value) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value));
    const diagnosticSecrets = [...protectedValues, ...ephemeralSecrets];
    if (diagnosticSecrets.some((value) => value && playwright.output.includes(value)) ||
      containsGeneratedAdminSecret(playwright.output)) {
      throw new Error('B12 protected fixture data leaked into captured browser diagnostics');
    }
    let artifactError;
    try {
      await assertNoSensitivePlaywrightArtifacts(playwrightOutputDirectory, diagnosticSecrets);
    } catch (error) {
      artifactError = error;
    }
    if (playwright.failed) {
      const testError = new Error(`B12 browser-to-infrastructure Playwright test failed:\n${
        sanitizeDiagnostic(playwright.output, diagnosticSecrets)}`);
      if (artifactError) {
        throw new AggregateError([testError, artifactError], 'B12 Playwright failed with a protected artifact');
      }
      throw testError;
    }
    if (artifactError) throw artifactError;
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
        await deleteFixture(createDatabaseRuntime, fixture, dynamicFileIds);
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
    throw new AggregateError([primaryError, ...cleanupErrors], 'B12 vertical test and cleanup failed');
  }
  if (primaryError) throw primaryError;
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'B12 vertical cleanup failed');
  process.stdout.write('B12 browser-to-Nest/PostgreSQL/Redis/MinIO/Worker aftersale test passed and cleaned.\n');
}

main().catch((error) => {
  process.stderr.write(`${formatError(error)}\n`);
  process.exit(1);
});
