import { generateUlid } from '@qingxu/platform-core';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import { AdminAftersaleRepository } from './admin-aftersale.repository';
import { buildStagingObjectKey, FileAssetRepository } from './file-asset.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B12_STORE_AFTERSALE_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B12_STORE_AFTERSALE_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 60_000,
};
const rollbackSentinel = Object.freeze({ code: 'B123_ADMIN_AFTERSALE_RETURN_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FixtureIds {
  actorAccountId: string;
  aftersaleId: string;
  aftersaleItemId: string;
  brandId: string;
  categoryId: string;
  customerAccountId: string;
  customerId: string;
  evidenceFileId: string;
  extraEvidenceFileId: string;
  otherActorAccountId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  returnAddressSnapshotId: string;
  returnAddressVersionId: string;
  returnShipmentId: string;
  skuId: string;
}

interface FixtureRegistry {
  accountIds: Set<string>;
  brandIds: Set<string>;
  categoryIds: Set<string>;
  customerIds: Set<string>;
  fileIds: Set<string>;
  orderIds: Set<string>;
  productIds: Set<string>;
  returnAddressVersionIds: Set<string>;
  skuIds: Set<string>;
}

interface AdditionalAftersaleItemIds {
  aftersaleItemId: string;
  orderItemId: string;
  skuId: string;
}

const registered: FixtureRegistry = {
  accountIds: new Set(),
  brandIds: new Set(),
  categoryIds: new Set(),
  customerIds: new Set(),
  fileIds: new Set(),
  orderIds: new Set(),
  productIds: new Set(),
  returnAddressVersionIds: new Set(),
  skuIds: new Set(),
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B12.3 Admin aftersale return database tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B12.3 Admin aftersale return tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      throw new TypeError('Full B12.3 Admin aftersale return tests require loopback PostgreSQL');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b123-admin-aftersale-return-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B12.3 Admin aftersale return tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b123-admin-aftersale-return-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function fullCleanupConnectionString(): string {
  const directUrl = new URL(requiredEnvironment('DIRECT_URL'));
  const runtimeUrl = new URL(requiredEnvironment('DATABASE_URL'));
  let database: string;
  let directUsername: string;
  let runtimeUsername: string;
  try {
    database = decodeURIComponent(directUrl.pathname.slice(1));
    directUsername = decodeURIComponent(directUrl.username);
    runtimeUsername = decodeURIComponent(runtimeUrl.username);
  } catch {
    throw new TypeError('B12.3 Admin aftersale return cleanup URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !['postgres:', 'postgresql:'].includes(runtimeUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || !LOOPBACK_HOSTS.has(runtimeUrl.hostname) ||
    directUsername !== 'mall_migrator' || runtimeUsername !== 'mall_runtime' ||
    !directUrl.password || !runtimeUrl.password || directUrl.search !== '' || directUrl.hash !== '' ||
    runtimeUrl.search !== '' || runtimeUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('B12.3 Admin aftersale cleanup requires the matching loopback mall_migrator test database');
  }
  return directUrl.toString();
}

function fixtureIds(): FixtureIds {
  const ids: FixtureIds = {
    actorAccountId: generateUlid(),
    aftersaleId: generateUlid(),
    aftersaleItemId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    customerAccountId: generateUlid(),
    customerId: generateUlid(),
    evidenceFileId: generateUlid(),
    extraEvidenceFileId: generateUlid(),
    otherActorAccountId: generateUlid(),
    orderId: generateUlid(),
    orderItemId: generateUlid(),
    productId: generateUlid(),
    returnAddressSnapshotId: generateUlid(),
    returnAddressVersionId: generateUlid(),
    returnShipmentId: generateUlid(),
    skuId: generateUlid(),
  };
  [ids.actorAccountId, ids.customerAccountId, ids.otherActorAccountId]
    .forEach((id) => registered.accountIds.add(id));
  registered.brandIds.add(ids.brandId);
  registered.categoryIds.add(ids.categoryId);
  registered.customerIds.add(ids.customerId);
  [ids.evidenceFileId, ids.extraEvidenceFileId].forEach((id) => registered.fileIds.add(id));
  registered.orderIds.add(ids.orderId);
  registered.productIds.add(ids.productId);
  registered.returnAddressVersionIds.add(ids.returnAddressVersionId);
  registered.skuIds.add(ids.skuId);
  return ids;
}

async function seedFixture(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  createdAt: Date,
): Promise<void> {
  await transaction.account.createMany({
    data: [{
      created_at: createdAt,
      id: ids.customerAccountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: createdAt,
      wechat_open_id: `b123-openid-${ids.customerAccountId}`,
    }, ...[ids.actorAccountId, ids.otherActorAccountId].map((accountId) => ({
      created_at: createdAt,
      id: accountId,
      login_name: `b123-admin-${accountId}`,
      password_hash: 'b123-integration-password-hash',
      role: 'SUPER_ADMIN' as const,
      status: 'ACTIVE' as const,
      updated_at: createdAt,
    }))],
  });
  await transaction.customerProfile.create({
    data: {
      account_id: ids.customerAccountId,
      created_at: createdAt,
      id: ids.customerId,
      registered_at: createdAt,
      updated_at: createdAt,
    },
  });
  await transaction.brand.create({
    data: {
      created_at: createdAt,
      id: ids.brandId,
      name: `B123 Brand ${ids.brandId}`,
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  await transaction.category.create({
    data: {
      created_at: createdAt,
      id: ids.categoryId,
      name: `B123 Category ${ids.categoryId}`,
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  await transaction.product.create({
    data: {
      brand_id: ids.brandId,
      category_id: ids.categoryId,
      created_at: createdAt,
      id: ids.productId,
      name: `B123 Product ${ids.productId}`,
      published_at: createdAt,
      spu_code: `B123-SPU-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B123-SKU-${ids.skuId}`,
      created_at: createdAt,
      id: ids.skuId,
      name: 'B123 SKU',
      product_id: ids.productId,
      retail_price: new Prisma.Decimal('12.50'),
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  await transaction.salesOrder.create({
    data: {
      created_at: createdAt,
      customer_id: ids.customerId,
      fulfillment_status: 'SHIPPED',
      goods_amount: new Prisma.Decimal('25.00'),
      id: ids.orderId,
      order_no: `QX${ids.orderId}`,
      order_status: 'SHIPPING',
      paid_amount: new Prisma.Decimal('25.00'),
      paid_at: createdAt,
      pay_expires_at: new Date(createdAt.getTime() + 30 * 60 * 1_000),
      payable_amount: new Prisma.Decimal('25.00'),
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      refunded_amount: new Prisma.Decimal('0.00'),
      shipping_amount: new Prisma.Decimal('0.00'),
      source: 'BUY_NOW',
      updated_at: createdAt,
      version: 1,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: new Prisma.Decimal('25.00'),
      aftersale_reserved_qty: 2,
      brand_name_snapshot: `B123 Brand ${ids.brandId}`,
      category_id: ids.categoryId,
      category_name_snapshot: `B123 Category ${ids.categoryId}`,
      created_at: createdAt,
      id: ids.orderItemId,
      line_paid_amount: new Prisma.Decimal('25.00'),
      order_id: ids.orderId,
      product_id: ids.productId,
      product_name_snapshot: `B123 Product ${ids.productId}`,
      quantity: 2,
      shipped_qty: 2,
      sku_code_snapshot: `B123-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B123 SKU',
      unit_price: new Prisma.Decimal('12.50'),
      version: 1,
    },
  });
  await transaction.aftersale.create({
    data: {
      aftersale_no: `AS${ids.aftersaleId}`,
      created_at: createdAt,
      customer_id: ids.customerId,
      id: ids.aftersaleId,
      order_id: ids.orderId,
      reason_code: 'QUALITY_ISSUE',
      reason_text: 'B12.3 integration return exception',
      review_reason: 'B12.3 integration approved return',
      reviewed_at: createdAt,
      reviewed_by_id: ids.actorAccountId,
      status: 'WAITING_RECEIPT',
      type: 'RETURN_REFUND',
      updated_at: createdAt,
      version: 3,
    },
  });
  await transaction.aftersaleItem.create({
    data: {
      aftersale_id: ids.aftersaleId,
      created_at: createdAt,
      id: ids.aftersaleItemId,
      order_item_id: ids.orderItemId,
      requested_amount: new Prisma.Decimal('25.00'),
      requested_qty: 2,
      reserved_amount: new Prisma.Decimal('25.00'),
      reserved_qty: 2,
    },
  });
  const maxAddressVersion = await transaction.returnAddressVersion.aggregate({ _max: { version_no: true } });
  await transaction.returnAddressVersion.create({
    data: {
      city: 'B12.3 City',
      created_at: createdAt,
      created_by_id: ids.actorAccountId,
      detail_ciphertext: Buffer.from('b123-return-address-detail'),
      district: 'B12.3 District',
      encryption_key_id: 'b123-address-key',
      id: ids.returnAddressVersionId,
      phone_ciphertext: Buffer.from('b123-return-address-phone'),
      phone_last4: '+ 31',
      province: 'B12.3 Province',
      reason: 'B12.3 integration address version',
      recipient_name: 'B12.3 Recipient',
      status: 'DRAFT',
      version_no: (maxAddressVersion._max.version_no ?? 0) + 1,
    },
  });
  await transaction.returnAddressSnapshot.create({
    data: {
      aftersale_id: ids.aftersaleId,
      captured_at: createdAt,
      city: 'B12.3 City',
      detail_ciphertext: Buffer.from('b123-return-address-detail'),
      district: 'B12.3 District',
      encryption_key_id: 'b123-address-key',
      id: ids.returnAddressSnapshotId,
      phone_ciphertext: Buffer.from('b123-return-address-phone'),
      phone_last4: '+ 31',
      province: 'B12.3 Province',
      recipient_name: 'B12.3 Recipient',
      source_version_id: ids.returnAddressVersionId,
    },
  });
  await transaction.returnShipment.create({
    data: {
      aftersale_id: ids.aftersaleId,
      carrier_code: 'B123',
      carrier_name: 'B12.3 Fixture Carrier',
      created_at: createdAt,
      id: ids.returnShipmentId,
      submitted_at: createdAt,
      tracking_no: `B123-RETURN-${ids.returnShipmentId}`,
    },
  });
  await transaction.fileAsset.createMany({
    data: [ids.evidenceFileId, ids.extraEvidenceFileId].map((fileId, index) => ({
      byte_size: 1_024n,
      created_at: createdAt,
      created_by_id: ids.actorAccountId,
      id: fileId,
      mime_type: 'image/png',
      object_key: `private/${fileId}`,
      original_name: `b123-inspection-${index + 1}.png`,
      purpose: 'AFTERSALE_EVIDENCE' as const,
      sha256: `${index === 0 ? 'a' : 'b'}`.repeat(64),
      status: 'READY' as const,
      visibility: 'PRIVATE' as const,
    })),
  });
}

async function addAftersaleItem(
  transaction: DatabaseTransaction,
  ids: FixtureIds,
  createdAt: Date,
): Promise<AdditionalAftersaleItemIds> {
  const additional = {
    aftersaleItemId: generateUlid(),
    orderItemId: generateUlid(),
    skuId: generateUlid(),
  };
  registered.skuIds.add(additional.skuId);
  await transaction.sku.create({
    data: {
      code: `B123-SKU-${additional.skuId}`,
      created_at: createdAt,
      id: additional.skuId,
      name: 'B123 Additional SKU',
      product_id: ids.productId,
      retail_price: new Prisma.Decimal('12.50'),
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: new Prisma.Decimal('12.50'),
      aftersale_reserved_qty: 1,
      brand_name_snapshot: `B123 Brand ${ids.brandId}`,
      category_id: ids.categoryId,
      category_name_snapshot: `B123 Category ${ids.categoryId}`,
      created_at: createdAt,
      id: additional.orderItemId,
      line_paid_amount: new Prisma.Decimal('12.50'),
      order_id: ids.orderId,
      product_id: ids.productId,
      product_name_snapshot: `B123 Product ${ids.productId}`,
      quantity: 1,
      shipped_qty: 1,
      sku_code_snapshot: `B123-SKU-${additional.skuId}`,
      sku_id: additional.skuId,
      sku_name_snapshot: 'B123 Additional SKU',
      unit_price: new Prisma.Decimal('12.50'),
      version: 1,
    },
  });
  await transaction.aftersaleItem.create({
    data: {
      aftersale_id: ids.aftersaleId,
      created_at: createdAt,
      id: additional.aftersaleItemId,
      order_item_id: additional.orderItemId,
      requested_amount: new Prisma.Decimal('12.50'),
      requested_qty: 1,
      reserved_amount: new Prisma.Decimal('12.50'),
      reserved_qty: 1,
    },
  });
  return additional;
}

function inspectionInput(ids: FixtureIds) {
  return {
    abnormalReason: 'Outer seal is damaged',
    actorAccountId: ids.actorAccountId,
    aftersaleId: ids.aftersaleId,
    evidenceFileIds: [ids.evidenceFileId],
    expectedVersion: 3,
    items: [{
      approvedRefundQuantity: 1,
      damagedQuantity: 0,
      note: 'One item retained after sealed inspection',
      orderItemId: ids.orderItemId,
      receivedQuantity: 2,
      restockQuantity: 1,
      returnToCustomerQuantity: 1,
      scrapQuantity: 0,
    }],
    result: 'ABNORMAL' as const,
  };
}

function hasPostgresCode(value: unknown, code: string, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.code === code || record.originalCode === code || record.sqlState === code) return true;
  return Object.values(record).some((nested) => hasPostgresCode(nested, code, seen));
}

function hasPostgresMessage(value: unknown, message: string, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (['message', 'originalMessage', 'detail'].some((key) =>
    typeof record[key] === 'string' && record[key].includes(message))) return true;
  return Object.values(record).some((nested) => hasPostgresMessage(nested, message, seen));
}

function expectPostgresError(error: unknown, code: string, message: string): void {
  expect(hasPostgresCode(error, code)).toBe(true);
  expect(hasPostgresMessage(error, message)).toBe(true);
}

async function expectPostgresFailureAtSavepoint(
  transaction: DatabaseTransaction,
  savepoint: string,
  prepare: () => Promise<unknown>,
  triggerFailure: () => Promise<unknown>,
  code: string,
  message: string,
): Promise<void> {
  if (!/^[a-z][a-z0-9_]+$/.test(savepoint)) throw new TypeError('Database test savepoint name is invalid');
  await transaction.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
  await prepare();
  let failure: unknown;
  try {
    await triggerFailure();
  } catch (error) {
    failure = error;
  }
  await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
  await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
  expect(failure).toBeDefined();
  expectPostgresError(failure, code, message);
}

async function runSerializable<T>(
  runtime: DatabaseRuntime,
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runtime.prisma.$transaction(work, transactionOptions);
    } catch (error) {
      if (attempt >= 5 || !hasPostgresCode(error, '40001')) throw error;
    }
  }
}

async function raceOnIndependentConnections<T, U>(
  runtime: DatabaseRuntime,
  left: (transaction: DatabaseTransaction) => Promise<T>,
  right: (transaction: DatabaseTransaction) => Promise<U>,
): Promise<[PromiseSettledResult<T>, PromiseSettledResult<U>]> {
  let arrivals = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const backendPids: number[] = [];
  const participant = <V>(work: (transaction: DatabaseTransaction) => Promise<V>) => {
    let synchronized = false;
    return runSerializable(runtime, async (transaction) => {
      if (!synchronized) {
        const rows = await transaction.$queryRaw<Array<{ pid: number }>>(Prisma.sql`SELECT pg_backend_pid() AS pid`);
        const pid = rows[0]?.pid;
        if (!Number.isSafeInteger(pid) || Number(pid) < 1) {
          throw new TypeError('B12.3 Admin aftersale race backend PID is invalid');
        }
        backendPids.push(pid as number);
        synchronized = true;
        arrivals += 1;
        if (arrivals === 2) release?.();
        await gate;
      }
      return work(transaction);
    });
  };
  const results = await Promise.allSettled([participant(left), participant(right)]);
  if (new Set(backendPids).size !== 2) {
    throw new TypeError(`B12.3 Admin aftersale race did not use two connections: ${JSON.stringify(backendPids)}`);
  }
  return results as [PromiseSettledResult<T>, PromiseSettledResult<U>];
}

async function cleanupFullFixtures(runtime: DatabaseRuntime, connectionString: string): Promise<void> {
  const accountIds = [...registered.accountIds];
  const brandIds = [...registered.brandIds];
  const categoryIds = [...registered.categoryIds];
  const customerIds = [...registered.customerIds];
  const fileIds = [...registered.fileIds];
  const orderIds = [...registered.orderIds];
  const productIds = [...registered.productIds];
  const returnAddressVersionIds = [...registered.returnAddressVersionIds];
  const skuIds = [...registered.skuIds];
  const pool = new Pool({
    application_name: 'qingxu-b123-admin-aftersale-return-cleanup',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM public.aftersale_evidence
       WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.return_inspection_item
       WHERE inspection_id IN (
         SELECT ri.id FROM public.return_inspection ri
         JOIN public.aftersale a ON a.id = ri.aftersale_id
         WHERE a.order_id::text = ANY($1::text[])
       )`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.return_inspection
       WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.return_shipment
       WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.return_address_snapshot
       WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.aftersale_item
       WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query('DELETE FROM public.aftersale WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.return_address_version WHERE id::text = ANY($1::text[])', [
      returnAddressVersionIds,
    ]);
    await client.query('DELETE FROM public.file_asset WHERE id::text = ANY($1::text[])', [fileIds]);
    await client.query('DELETE FROM public.order_item WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.sku WHERE id::text = ANY($1::text[])', [skuIds]);
    await client.query('DELETE FROM public.product WHERE id::text = ANY($1::text[])', [productIds]);
    await client.query('DELETE FROM public.category WHERE id::text = ANY($1::text[])', [categoryIds]);
    await client.query('DELETE FROM public.brand WHERE id::text = ANY($1::text[])', [brandIds]);
    await client.query('DELETE FROM public.customer_profile WHERE id::text = ANY($1::text[])', [customerIds]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [accountIds]);
    await client.query('COMMIT');
  } catch (error) {
    if (client !== undefined) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
  const residues = await Promise.all([
    runtime.prisma.aftersale.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.fileAsset.count({ where: { id: { in: fileIds } } }),
    runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
    runtime.prisma.account.count({ where: { id: { in: accountIds } } }),
    runtime.prisma.returnAddressVersion.count({ where: { id: { in: returnAddressVersionIds } } }),
  ]);
  if (residues.some((count) => count !== 0)) {
    throw new TypeError(`B12.3 Admin aftersale full fixture residue: ${JSON.stringify(residues)}`);
  }
}

databaseDescribe('B12.3 Admin aftersale return database integration', () => {
  let runtime: DatabaseRuntime;
  let cleanupConnectionString: string | undefined;

  beforeAll(async () => {
    if (mode === 'full') cleanupConnectionString = fullCleanupConnectionString();
    runtime = runtimeForMode();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => {
    if (runtime === undefined) return;
    try {
      if (mode === 'full') {
        if (cleanupConnectionString === undefined) {
          throw new TypeError('B12.3 Admin aftersale cleanup connection was not initialized');
        }
        await cleanupFullFixtures(runtime, cleanupConnectionString);
      }
    } finally {
      await runtime.disconnect();
    }
  }, 30_000);

  it('seals an abnormal inspection, enforces its deferred manifest, and continues the approved quota', async () => {
    const ids = fixtureIds();
    const repository = new AdminAftersaleRepository(runtime.prisma, Buffer.alloc(32, 31));

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedFixture(transaction, ids, new Date());
      await expect(repository.recordReturnInspectionInTransaction(transaction, {
        ...inspectionInput(ids),
        items: [{
          approvedRefundQuantity: 2,
          damagedQuantity: 0,
          orderItemId: ids.orderItemId,
          receivedQuantity: 2,
          restockQuantity: 2,
          returnToCustomerQuantity: 0,
          scrapQuantity: 0,
        }],
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      const inspected = await repository.recordReturnInspectionInTransaction(transaction, inspectionInput(ids));
      expect(inspected.aftersale).toMatchObject({
        inspection: {
          evidenceFileIds: [ids.evidenceFileId],
          items: [{ approvedRefundQuantity: 1, receivedQuantity: 2, returnToCustomerQuantity: 1 }],
          result: 'ABNORMAL',
        },
        status: 'RETURN_EXCEPTION',
        version: 4,
      });

      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
      const inspectionId = inspected.aftersale.inspection?.inspectionId;
      if (inspectionId === undefined) throw new TypeError('Sealed inspection ID is missing');
      expect(inspectionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
      await expectPostgresFailureAtSavepoint(
        transaction,
        'b123_manifest_guard',
        () => transaction.aftersaleEvidence.create({
          data: {
            aftersale_id: ids.aftersaleId,
            file_id: ids.extraEvidenceFileId,
            id: generateUlid(),
            purpose: 'INSPECTION',
            return_inspection_id: inspectionId,
          },
        }),
        () => transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE'),
        'P0001',
        'inspection evidence must exactly match the sealed manifest',
      );
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');

      const continued = await repository.continueRefundAfterReturnInTransaction(transaction, {
        actorAccountId: ids.actorAccountId,
        aftersaleId: ids.aftersaleId,
        expectedVersion: 4,
        reason: 'Continue the approved refund after exception review',
      });
      expect(continued.aftersale).toMatchObject({
        inspection: { resolution: 'CONTINUE_REFUND' },
        status: 'REFUNDING_AFTER_RETURN',
        version: 5,
      });
      expect(await transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } })).toMatchObject({
        aftersale_reserved_qty: 1,
      });
      expect((await transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
        .aftersale_reserved_amount.toFixed(2)).toBe('12.50');
      expect(await transaction.inventoryLedger.count({ where: { business_id: ids.aftersaleId } })).toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    expect(await runtime.prisma.aftersale.count({ where: { id: ids.aftersaleId } })).toBe(0);
    expect(await runtime.prisma.salesOrder.count({ where: { id: ids.orderId } })).toBe(0);
    expect(await runtime.prisma.account.count({ where: { id: { in: [
      ids.actorAccountId,
      ids.customerAccountId,
      ids.otherActorAccountId,
    ] } } })).toBe(0);
  }, 90_000);

  it('commits PASS with an empty manifest and denies runtime mutation of sealed decisions and items', async () => {
    const ids = fixtureIds();
    const repository = new AdminAftersaleRepository(runtime.prisma, Buffer.alloc(32, 33));

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedFixture(transaction, ids, new Date());
      const passed = await repository.recordReturnInspectionInTransaction(transaction, {
        actorAccountId: ids.actorAccountId,
        aftersaleId: ids.aftersaleId,
        evidenceFileIds: [],
        expectedVersion: 3,
        items: [{
          approvedRefundQuantity: 2,
          damagedQuantity: 0,
          orderItemId: ids.orderItemId,
          receivedQuantity: 2,
          restockQuantity: 2,
          returnToCustomerQuantity: 0,
          scrapQuantity: 0,
        }],
        result: 'PASS',
      });
      expect(passed.aftersale).toMatchObject({
        inspection: { evidenceFileIds: [], result: 'PASS' },
        status: 'REFUNDING_AFTER_RETURN',
        version: 4,
      });
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const inspection = await transaction.returnInspection.findUniqueOrThrow({
        include: { evidence: true, items: true },
        where: { aftersale_id: ids.aftersaleId },
      });
      expect(inspection.evidence_manifest).toEqual([]);
      expect(inspection.evidence_count).toBe(0);
      expect(inspection.evidence).toHaveLength(0);
      expect(inspection.items).toHaveLength(1);

      await expectPostgresFailureAtSavepoint(
        transaction,
        'b123_decision_immutable',
        async () => undefined,
        () => transaction.returnInspection.update({
          data: { status: 'ABNORMAL' },
          where: { id: inspection.id },
        }),
        '42501',
        'permission denied for table return_inspection',
      );
      await expectPostgresFailureAtSavepoint(
        transaction,
        'b123_item_immutable',
        async () => undefined,
        () => transaction.returnInspectionItem.update({
          data: { received_qty: 1 },
          where: { id: inspection.items[0]!.id },
        }),
        '42501',
        'permission denied for table return_inspection_item',
      );
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  it('requires exact multi-item coverage and accepts a sealed zero-receipt abnormal result', async () => {
    const ids = fixtureIds();
    const repository = new AdminAftersaleRepository(runtime.prisma, Buffer.alloc(32, 34));

    await expect(runtime.prisma.$transaction(async (transaction) => {
      const createdAt = new Date();
      await seedFixture(transaction, ids, createdAt);
      const additional = await addAftersaleItem(transaction, ids, createdAt);
      const shortReceipt = {
        approvedRefundQuantity: 1,
        damagedQuantity: 0,
        orderItemId: ids.orderItemId,
        receivedQuantity: 1,
        restockQuantity: 1,
        returnToCustomerQuantity: 0,
        scrapQuantity: 0,
      };
      const zeroReceipt = {
        approvedRefundQuantity: 0,
        damagedQuantity: 0,
        orderItemId: additional.orderItemId,
        receivedQuantity: 0,
        restockQuantity: 0,
        returnToCustomerQuantity: 0,
        scrapQuantity: 0,
      };
      const base = {
        abnormalReason: 'One returned line was missing from the package',
        actorAccountId: ids.actorAccountId,
        aftersaleId: ids.aftersaleId,
        evidenceFileIds: [ids.evidenceFileId],
        expectedVersion: 3,
        result: 'ABNORMAL' as const,
      };

      await expect(repository.recordReturnInspectionInTransaction(transaction, {
        ...base,
        items: [shortReceipt],
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      await expect(repository.recordReturnInspectionInTransaction(transaction, {
        ...base,
        items: [
          { ...shortReceipt, approvedRefundQuantity: 2 },
          zeroReceipt,
        ],
      })).rejects.toThrow('frozen disposition equations');

      const inspected = await repository.recordReturnInspectionInTransaction(transaction, {
        ...base,
        items: [zeroReceipt, shortReceipt],
      });
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      expect(inspected.aftersale).toMatchObject({
        inspection: {
          evidenceFileIds: [ids.evidenceFileId],
          result: 'ABNORMAL',
        },
        status: 'RETURN_EXCEPTION',
      });
      expect(inspected.aftersale.inspection?.items).toEqual(expect.arrayContaining([
        expect.objectContaining({ orderItemId: ids.orderItemId, receivedQuantity: 1 }),
        expect.objectContaining({ orderItemId: additional.orderItemId, receivedQuantity: 0 }),
      ]));
      expect(await transaction.returnInspectionItem.count({
        where: { inspection: { aftersale_id: ids.aftersaleId } },
      })).toBe(2);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  it('rejects inspection evidence whose real file purpose is not AFTERSALE_EVIDENCE', async () => {
    const ids = fixtureIds();
    const repository = new AdminAftersaleRepository(runtime.prisma, Buffer.alloc(32, 35));

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedFixture(transaction, ids, new Date());
      await transaction.fileAsset.update({
        data: {
          object_key: `public/${ids.extraEvidenceFileId}`,
          purpose: 'PRODUCT_IMAGE',
          visibility: 'PUBLIC',
        },
        where: { id: ids.extraEvidenceFileId },
      });
      await expect(repository.recordReturnInspectionInTransaction(transaction, {
        ...inspectionInput(ids),
        evidenceFileIds: [ids.extraEvidenceFileId],
      })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(await transaction.returnInspection.count({ where: { aftersale_id: ids.aftersaleId } })).toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  it('deterministically rejects after return against the exact sealed preview and releases all quota', async () => {
    const ids = fixtureIds();
    const repository = new AdminAftersaleRepository(runtime.prisma, Buffer.alloc(32, 36));

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedFixture(transaction, ids, new Date());
      await repository.recordReturnInspectionInTransaction(transaction, inspectionInput(ids));
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      const impact = await repository.previewRejectAfterReturnInTransaction(transaction, {
        aftersaleId: ids.aftersaleId,
      });
      const verified: typeof impact[] = [];
      const rejected = await repository.rejectAfterReturnInTransaction(transaction, {
        actorAccountId: ids.otherActorAccountId,
        aftersaleId: ids.aftersaleId,
        expectedVersion: 4,
        reason: 'Reject the sealed returned goods after deterministic review',
      }, {
        verifyPreview: (current) => { verified.push(current); },
      });
      expect(verified).toEqual([impact]);
      expect(rejected.aftersale).toMatchObject({
        inspection: { resolution: 'REJECT_AFTER_RETURN' },
        status: 'REJECTED_AFTER_RETURN',
        version: 5,
      });
      expect(await transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } })).toMatchObject({
        aftersale_reserved_qty: 0,
      });
      expect((await transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
        .aftersale_reserved_amount.toFixed(2)).toBe('0.00');
      expect(await transaction.inventoryLedger.count({ where: { business_id: ids.aftersaleId } })).toBe(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
  }, 90_000);

  fullIt('serializes upload completion against inspection without attaching a pending file', async () => {
    const ids = fixtureIds();
    const repository = new AdminAftersaleRepository(runtime.prisma, Buffer.alloc(32, 37));
    const files = new FileAssetRepository(runtime.prisma);
    await runSerializable(runtime, async (transaction) => {
      await seedFixture(transaction, ids, new Date());
      await transaction.fileAsset.update({
        data: { object_key: buildStagingObjectKey(ids.evidenceFileId), status: 'PENDING' },
        where: { id: ids.evidenceFileId },
      });
    });

    const outcomes = await raceOnIndependentConnections(
      runtime,
      (transaction) => repository.recordReturnInspectionInTransaction(transaction, inspectionInput(ids)),
      (transaction) => files.markReadyInTransaction(transaction, {
        actorId: ids.actorAccountId,
        expectedByteSize: 1_024n,
        expectedSha256: 'a'.repeat(64),
        fileId: ids.evidenceFileId,
        measuredByteSize: 1_024n,
        measuredMimeType: 'image/png',
        measuredSha256: 'a'.repeat(64),
      }),
    );
    expect(outcomes[1].status).toBe('fulfilled');
    const file = await runtime.prisma.fileAsset.findUniqueOrThrow({ where: { id: ids.evidenceFileId } });
    expect(file).toMatchObject({
      object_key: `private/${ids.evidenceFileId}`,
      status: 'READY',
      visibility: 'PRIVATE',
    });
    const inspection = await runtime.prisma.returnInspection.findUnique({ where: { aftersale_id: ids.aftersaleId } });
    const evidenceCount = await runtime.prisma.aftersaleEvidence.count({
      where: { aftersale_id: ids.aftersaleId, file_id: ids.evidenceFileId },
    });
    if (outcomes[0].status === 'fulfilled') {
      expect(inspection?.status).toBe('ABNORMAL');
      expect(evidenceCount).toBe(1);
    } else {
      expect((outcomes[0].reason as { code?: string }).code).toBe('STATE_CONFLICT');
      expect(inspection).toBeNull();
      expect(evidenceCount).toBe(0);
    }
  }, 90_000);

  fullIt('serializes continue-refund against reject-after-return without double releasing quota', async () => {
    const ids = fixtureIds();
    const repository = new AdminAftersaleRepository(runtime.prisma, Buffer.alloc(32, 32));
    await runSerializable(runtime, async (transaction) => {
      await seedFixture(transaction, ids, new Date());
      await repository.recordReturnInspectionInTransaction(transaction, inspectionInput(ids));
      await transaction.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
    });
    const impact = await runtime.prisma.$transaction(
      (transaction) => repository.previewRejectAfterReturnInTransaction(transaction, { aftersaleId: ids.aftersaleId }),
      { isolationLevel: 'RepeatableRead' },
    );

    const outcomes = await raceOnIndependentConnections(
      runtime,
      (transaction) => repository.continueRefundAfterReturnInTransaction(transaction, {
        actorAccountId: ids.actorAccountId,
        aftersaleId: ids.aftersaleId,
        expectedVersion: 4,
        reason: 'Continue the approved refund after concurrent review',
      }),
      (transaction) => repository.rejectAfterReturnInTransaction(transaction, {
        actorAccountId: ids.otherActorAccountId,
        aftersaleId: ids.aftersaleId,
        expectedVersion: 4,
        reason: 'Reject the return after concurrent review',
      }, {
        verifyPreview: (current) => expect(current).toEqual(impact),
      }),
    );
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected') as PromiseRejectedResult | undefined;
    expect((rejected?.reason as { code?: string }).code).toBe('RESOURCE_VERSION_CONFLICT');

    const current = await runtime.prisma.aftersale.findUniqueOrThrow({
      select: {
        return_inspection: { select: { resolution: true, version: true } },
        status: true,
        version: true,
      },
      where: { id: ids.aftersaleId },
    });
    expect(current.version).toBe(5);
    expect(current.return_inspection?.version).toBe(2);
    const orderItem = await runtime.prisma.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } });
    if (current.status === 'REFUNDING_AFTER_RETURN') {
      expect(current.return_inspection?.resolution).toBe('CONTINUE_REFUND');
      expect(orderItem.aftersale_reserved_qty).toBe(1);
      expect(orderItem.aftersale_reserved_amount.toFixed(2)).toBe('12.50');
    } else {
      expect(current.status).toBe('REJECTED_AFTER_RETURN');
      expect(current.return_inspection?.resolution).toBe('REJECT_AFTER_RETURN');
      expect(orderItem.aftersale_reserved_qty).toBe(0);
      expect(orderItem.aftersale_reserved_amount.toFixed(2)).toBe('0.00');
    }
    expect(await runtime.prisma.inventoryLedger.count({ where: { business_id: ids.aftersaleId } })).toBe(0);
  }, 90_000);
});
