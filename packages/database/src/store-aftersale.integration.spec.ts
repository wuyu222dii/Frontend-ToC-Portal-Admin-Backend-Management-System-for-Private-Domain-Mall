import { randomUUID } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import { AuditRepository } from './audit.repository';
import { FulfillmentRepository } from './fulfillment.repository';
import {
  IdempotencyRepository,
  type DatabaseTransaction,
  type IdempotencyClaim,
} from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { StoreAftersaleRepository } from './store-aftersale.repository';

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
const rollbackSentinel = Object.freeze({ code: 'B12_STORE_AFTERSALE_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FixtureIds {
  accountId: string;
  adminAccountId: string;
  brandId: string;
  categoryId: string;
  customerId: string;
  evidenceFileId: string;
  otherAccountId: string;
  otherCustomerId: string;
  orderId: string;
  orderItemId: string;
  productId: string;
  secondOrderId: string;
  secondOrderItemId: string;
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
  shipmentIds: Set<string>;
  skuIds: Set<string>;
}

const registered: FixtureRegistry = {
  accountIds: new Set(),
  brandIds: new Set(),
  categoryIds: new Set(),
  customerIds: new Set(),
  fileIds: new Set(),
  orderIds: new Set(),
  productIds: new Set(),
  shipmentIds: new Set(),
  skuIds: new Set(),
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B12 Store aftersale database tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B12 Store aftersale tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B12 Store aftersale tests require loopback PostgreSQL');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b121-store-aftersale-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 4,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B12 Store aftersale tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b121-store-aftersale-rollback',
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
    throw new TypeError('B12 Store aftersale cleanup URL contains invalid percent encoding');
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
    throw new TypeError('B12 Store aftersale cleanup requires the matching loopback mall_migrator test database');
  }
  return directUrl.toString();
}

function registerFixture(ids: FixtureIds): void {
  [ids.accountId, ids.adminAccountId, ids.otherAccountId].forEach((id) => registered.accountIds.add(id));
  registered.brandIds.add(ids.brandId);
  registered.categoryIds.add(ids.categoryId);
  [ids.customerId, ids.otherCustomerId].forEach((id) => registered.customerIds.add(id));
  registered.fileIds.add(ids.evidenceFileId);
  [ids.orderId, ids.secondOrderId].forEach((id) => registered.orderIds.add(id));
  registered.productIds.add(ids.productId);
  registered.skuIds.add(ids.skuId);
}

function fixtureIds(): FixtureIds {
  const ids = {
    accountId: generateUlid(),
    adminAccountId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    customerId: generateUlid(),
    evidenceFileId: generateUlid(),
    otherAccountId: generateUlid(),
    otherCustomerId: generateUlid(),
    orderId: generateUlid(),
    orderItemId: generateUlid(),
    productId: generateUlid(),
    secondOrderId: generateUlid(),
    secondOrderItemId: generateUlid(),
    skuId: generateUlid(),
  };
  registerFixture(ids);
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
      id: ids.accountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: createdAt,
      wechat_open_id: `b121-openid-${ids.accountId}`,
    }, {
      created_at: createdAt,
      id: ids.otherAccountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: createdAt,
      wechat_open_id: `b121-openid-${ids.otherAccountId}`,
    }, {
      created_at: createdAt,
      id: ids.adminAccountId,
      login_name: `b121-admin-${ids.adminAccountId}`,
      password_hash: 'b121-integration-password-hash',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: createdAt,
    }],
  });
  await transaction.customerProfile.create({
    data: {
      account_id: ids.accountId,
      created_at: createdAt,
      id: ids.customerId,
      registered_at: createdAt,
      updated_at: createdAt,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: ids.otherAccountId,
      created_at: createdAt,
      id: ids.otherCustomerId,
      registered_at: createdAt,
      updated_at: createdAt,
    },
  });
  await transaction.brand.create({
    data: {
      created_at: createdAt,
      id: ids.brandId,
      name: `B121 Brand ${ids.brandId}`,
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  await transaction.category.create({
    data: {
      created_at: createdAt,
      id: ids.categoryId,
      name: `B121 Category ${ids.categoryId}`,
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
      name: `B121 Product ${ids.productId}`,
      published_at: createdAt,
      spu_code: `B121-SPU-${ids.productId}`,
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  await transaction.sku.create({
    data: {
      code: `B121-SKU-${ids.skuId}`,
      created_at: createdAt,
      id: ids.skuId,
      name: 'B121 SKU',
      product_id: ids.productId,
      retail_price: new Prisma.Decimal('12.50'),
      status: 'ACTIVE',
      updated_at: createdAt,
    },
  });
  const orderData = (orderId: string) => ({
      aftersale_expires_at: null,
      close_reason: null,
      completed_at: null,
      completion_reason: null,
      created_at: createdAt,
      customer_id: ids.customerId,
      fulfillment_status: 'READY_TO_SHIP',
      goods_amount: new Prisma.Decimal('25.00'),
      id: orderId,
      order_no: `QX${orderId}`,
      order_status: 'PENDING_SHIPMENT',
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
  });
  await transaction.salesOrder.createMany({
    data: [orderData(ids.orderId), orderData(ids.secondOrderId)],
  });
  const orderItemData = (orderId: string, orderItemId: string) => ({
      aftersale_reserved_amount: new Prisma.Decimal('0.00'),
      aftersale_reserved_qty: 0,
      brand_name_snapshot: `B121 Brand ${ids.brandId}`,
      category_id: ids.categoryId,
      category_name_snapshot: `B121 Category ${ids.categoryId}`,
      created_at: createdAt,
      id: orderItemId,
      line_paid_amount: new Prisma.Decimal('25.00'),
      order_id: orderId,
      pre_shipment_refunded_qty: 0,
      product_id: ids.productId,
      product_name_snapshot: `B121 Product ${ids.productId}`,
      quantity: 2,
      refunded_amount: new Prisma.Decimal('0.00'),
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: `B121-SKU-${ids.skuId}`,
      sku_id: ids.skuId,
      sku_name_snapshot: 'B121 SKU',
      unit_price: new Prisma.Decimal('12.50'),
      version: 1,
  });
  await transaction.orderItem.createMany({
    data: [
      orderItemData(ids.orderId, ids.orderItemId),
      orderItemData(ids.secondOrderId, ids.secondOrderItemId),
    ],
  });
  await transaction.fileAsset.create({
    data: {
      byte_size: 1_024n,
      created_at: createdAt,
      created_by_id: ids.accountId,
      id: ids.evidenceFileId,
      mime_type: 'image/png',
      object_key: `private/${ids.evidenceFileId}`,
      original_name: 'b121-evidence.png',
      purpose: 'AFTERSALE_EVIDENCE',
      sha256: 'd'.repeat(64),
      status: 'READY',
      visibility: 'PRIVATE',
    },
  });
}

function claim(
  actorId: string,
  idempotencyKey: string,
  action: 'CANCEL' | 'CONFIRM',
  ids: Pick<FixtureIds, 'evidenceFileId' | 'orderId' | 'orderItemId'>,
  aftersaleId?: string,
): IdempotencyClaim {
  return {
    actorId,
    idempotencyKey,
    request: {
      body: action === 'CONFIRM' ? {
        action,
        evidence_file_ids: [ids.evidenceFileId],
        items: [{ order_item_id: ids.orderItemId, quantity: 2 }],
        order_id: ids.orderId,
        reason_code: 'QUALITY_ISSUE',
        reason_text: 'fixture quality issue',
        type: 'REFUND_ONLY',
      } : {},
      method: 'POST',
      pathParameters: action === 'CANCEL' ? { aftersale_id: aftersaleId } : {},
      route: action === 'CANCEL'
        ? '/store/aftersales/{aftersale_id}/cancel'
        : '/store/aftersales',
    },
  };
}

function previewInput(
  ids: FixtureIds,
  target: 'first' | 'second' = 'first',
  evidenceFileIds: readonly string[] = [ids.evidenceFileId],
) {
  return {
    accountId: ids.accountId,
    customerId: ids.customerId,
    evidenceFileIds,
    items: [{
      orderItemId: target === 'first' ? ids.orderItemId : ids.secondOrderItemId,
      quantity: 2,
    }],
    orderId: target === 'first' ? ids.orderId : ids.secondOrderId,
    reasonCode: 'QUALITY_ISSUE' as const,
    reasonText: 'fixture quality issue',
    type: 'REFUND_ONLY' as const,
  };
}

function shipmentInput(ids: FixtureIds, target: 'first' | 'second', expectedOrderVersion: number) {
  const shipmentId = generateUlid();
  registered.shipmentIds.add(shipmentId);
  return {
    actorAccountId: ids.adminAccountId,
    carrierCode: 'MANUAL',
    carrierName: 'B12.1 Manual Carrier',
    expectedOrderVersion,
    items: [{
      orderItemId: target === 'first' ? ids.orderItemId : ids.secondOrderItemId,
      quantity: 2,
      shipmentItemId: generateUlid(),
    }],
    orderId: target === 'first' ? ids.orderId : ids.secondOrderId,
    shipmentId,
    trackingNo: `B121-TRACK-${shipmentId}`,
  };
}

function hasPostgresCode(value: unknown, code: string, seen = new Set<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false;
  seen.add(value);
  const record = value as Record<string, unknown>;
  if (record.code === code || record.originalCode === code || record.sqlState === code) return true;
  return ['cause', 'driverAdapterError', 'meta', 'originalError']
    .some((key) => hasPostgresCode(record[key], code, seen));
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
          throw new TypeError('B12 Store aftersale race backend PID is invalid');
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
    throw new TypeError(`B12 Store aftersale race did not use two connections: ${JSON.stringify(backendPids)}`);
  }
  return results as [PromiseSettledResult<T>, PromiseSettledResult<U>];
}

function errorCode(result: PromiseSettledResult<unknown>): string | null {
  if (result.status === 'fulfilled' || typeof result.reason !== 'object' || result.reason === null) return null;
  const code = (result.reason as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

async function cleanupFullFixtures(runtime: DatabaseRuntime, connectionString: string): Promise<void> {
  const accountIds = [...registered.accountIds];
  const brandIds = [...registered.brandIds];
  const categoryIds = [...registered.categoryIds];
  const customerIds = [...registered.customerIds];
  const fileIds = [...registered.fileIds];
  const orderIds = [...registered.orderIds];
  const productIds = [...registered.productIds];
  const shipmentIds = [...registered.shipmentIds];
  const skuIds = [...registered.skuIds];
  const pool = new Pool({
    application_name: 'qingxu-b121-store-aftersale-cleanup',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM public.audit_log
       WHERE object_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.aftersale_evidence
       WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.aftersale_item
       WHERE aftersale_id IN (SELECT id FROM public.aftersale WHERE order_id::text = ANY($1::text[]))`,
      [orderIds],
    );
    await client.query('DELETE FROM public.aftersale WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query(
      `DELETE FROM public.shipment_item
       WHERE shipment_id::text = ANY($1::text[])
          OR shipment_id IN (SELECT id FROM public.shipment WHERE order_id::text = ANY($2::text[]))`,
      [shipmentIds, orderIds],
    );
    await client.query(
      'DELETE FROM public.shipment WHERE id::text = ANY($1::text[]) OR order_id::text = ANY($2::text[])',
      [shipmentIds, orderIds],
    );
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
    runtime.prisma.shipment.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.fileAsset.count({ where: { id: { in: fileIds } } }),
    runtime.prisma.orderItem.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
    runtime.prisma.account.count({ where: { id: { in: accountIds } } }),
  ]);
  if (residues.some((count) => count !== 0)) {
    throw new TypeError(`B12 Store aftersale full fixture residue: ${JSON.stringify(residues)}`);
  }
}

databaseDescribe('B12 Store aftersale database integration', () => {
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
          throw new TypeError('B12 Store aftersale cleanup connection was not initialized');
        }
        await cleanupFullFixtures(runtime, cleanupConnectionString);
      }
    } finally {
      await runtime.disconnect();
    }
  }, 30_000);

  it('atomically reserves, audits and records HASH_ONLY creation, then cancels with exact release', async () => {
    const ids = fixtureIds();
    const createdAt = new Date();
    const idempotency = new IdempotencyRepository({
      current: { id: 'b121-idempotency-current', key: Buffer.alloc(32, 41) },
      previous: [],
    }, () => createdAt);
    const audit = new AuditRepository(Buffer.alloc(32, 42), () => createdAt);
    const repository = new StoreAftersaleRepository(runtime.prisma);
    let createdAftersaleId: string | null = null;

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedFixture(transaction, ids, createdAt);
      const preview = await repository.previewInTransaction(transaction, previewInput(ids));
      expect(preview).toMatchObject({ canSubmit: true, requestedAmount: '25.00' });

      const createKey = randomUUID();
      const createClaim = claim(ids.accountId, createKey, 'CONFIRM', ids);
      expect(await idempotency.claim(transaction, createClaim)).toEqual({ kind: 'execute' });
      const created = await repository.confirmAftersaleInTransaction(transaction, previewInput(ids), {
        verifyPreview: (current) => {
          expect(current.requestedAmount).toBe(preview.requestedAmount);
          expect(current.items).toEqual(preview.items);
          expect(current.evidence).toEqual(preview.evidence);
        },
      });
      createdAftersaleId = created.aftersale.aftersaleId;
      await audit.append(transaction, {
        action: 'CREATE',
        actorAccountId: ids.accountId,
        actorRole: 'CUSTOMER',
        after: created.audit.after,
        idempotencyKey: createKey,
        module: 'aftersale',
        objectId: created.aftersale.aftersaleId,
        objectType: 'aftersale',
        requestId: `req_${'a'.repeat(32)}`,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'STATUS_VERSION',
      });
      const createResponse = {
        aftersale_id: created.aftersale.aftersaleId,
        aftersale_no: created.aftersale.aftersaleNo,
      };
      await idempotency.complete(transaction, createClaim, {
        resourceId: created.aftersale.aftersaleId,
        responseForHash: createResponse,
        responseStatus: 201,
        storage: 'HASH_ONLY',
      });

      const reserved = await transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } });
      expect(reserved.aftersale_reserved_qty).toBe(2);
      expect(reserved.aftersale_reserved_amount.toFixed(2)).toBe('25.00');
      expect(reserved.version).toBe(2);
      expect((await transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } })).version).toBe(2);
      expect(await transaction.aftersaleEvidence.count({
        where: { aftersale_id: created.aftersale.aftersaleId, file_id: ids.evidenceFileId },
      })).toBe(1);
      const createFact = await transaction.idempotencyRecord.findUniqueOrThrow({
        where: {
          actor_id_scope_idempotency_key: {
            actor_id: ids.accountId,
            idempotency_key: createKey,
            scope: (await transaction.idempotencyRecord.findFirstOrThrow({
              where: { actor_id: ids.accountId, idempotency_key: createKey },
            })).scope,
          },
        },
      });
      expect(createFact.response_body).toBeNull();
      expect(createFact.resource_id).toBe(created.aftersale.aftersaleId);

      await expect(repository.getOwnedAftersaleDetailInTransaction(transaction, {
        accountId: ids.otherAccountId,
        aftersaleId: created.aftersale.aftersaleId,
        customerId: ids.otherCustomerId,
      })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

      const second = await repository.confirmAftersaleInTransaction(
        transaction,
        previewInput(ids, 'second', []),
        {
          verifyPreview: (current) => {
            expect(current.canSubmit).toBe(true);
          },
        },
      );
      const expectedListOrder = [created.aftersale.aftersaleId, second.aftersale.aftersaleId]
        .sort((left, right) => right.localeCompare(left));
      const firstPage = await repository.listOwnedAftersalesInTransaction(transaction, {
        accountId: ids.accountId,
        customerId: ids.customerId,
        page: 1,
        pageSize: 1,
      });
      const secondPage = await repository.listOwnedAftersalesInTransaction(transaction, {
        accountId: ids.accountId,
        customerId: ids.customerId,
        page: 2,
        pageSize: 1,
      });
      expect(firstPage).toMatchObject({ items: [{ aftersaleId: expectedListOrder[0] }], total: 2 });
      expect(secondPage).toMatchObject({ items: [{ aftersaleId: expectedListOrder[1] }], total: 2 });

      const cancelKey = randomUUID();
      const cancelClaim = claim(
        ids.accountId,
        cancelKey,
        'CANCEL',
        ids,
        created.aftersale.aftersaleId,
      );
      expect(await idempotency.claim(transaction, cancelClaim)).toEqual({ kind: 'execute' });
      const cancelled = await repository.cancelOwnedAftersaleInTransaction(transaction, {
        accountId: ids.accountId,
        aftersaleId: created.aftersale.aftersaleId,
        customerId: ids.customerId,
        expectedVersion: 1,
      });
      await audit.append(transaction, {
        action: 'CANCEL',
        actorAccountId: ids.accountId,
        actorRole: 'CUSTOMER',
        after: cancelled.audit.after,
        before: cancelled.audit.before,
        idempotencyKey: cancelKey,
        module: 'aftersale',
        objectId: cancelled.aftersale.aftersaleId,
        objectType: 'aftersale',
        requestId: `req_${'b'.repeat(32)}`,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'STATUS_VERSION',
      });
      const cancelResponse = { aftersale_id: cancelled.aftersale.aftersaleId, cancelled: true };
      await idempotency.complete(transaction, cancelClaim, {
        resourceId: cancelled.aftersale.aftersaleId,
        responseForHash: cancelResponse,
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      const replay = await idempotency.claim(transaction, cancelClaim);
      expect(replay.kind).toBe('replay');
      if (replay.kind === 'replay') {
        idempotency.assertHashOnlyReplay(replay.record, {
          resourceId: cancelled.aftersale.aftersaleId,
          responseForHash: cancelResponse,
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
      }

      const released = await transaction.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } });
      expect(released.aftersale_reserved_qty).toBe(0);
      expect(released.aftersale_reserved_amount.toFixed(2)).toBe('0.00');
      expect(released.version).toBe(3);
      expect(cancelled.aftersale).toMatchObject({ status: 'CANCELLED', version: 2 });
      expect((await transaction.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } })).version).toBe(3);
      expect(await transaction.aftersaleEvidence.count({
        where: { aftersale_id: cancelled.aftersale.aftersaleId, file_id: ids.evidenceFileId },
      })).toBe(1);
      expect(await transaction.auditLog.count({
        where: { object_id: cancelled.aftersale.aftersaleId, object_type: 'aftersale' },
      })).toBe(2);
      const detail = await repository.getOwnedAftersaleDetailInTransaction(transaction, {
        accountId: ids.accountId,
        aftersaleId: cancelled.aftersale.aftersaleId,
        customerId: ids.customerId,
      });
      expect(detail.timeline.map(({ action, fromStatus, toStatus }) => ({ action, fromStatus, toStatus })))
        .toEqual([
          { action: 'CREATE', fromStatus: null, toStatus: 'PENDING_REVIEW' },
          { action: 'CANCEL', fromStatus: 'PENDING_REVIEW', toStatus: 'CANCELLED' },
        ]);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    expect(createdAftersaleId).not.toBeNull();
    const residues = await Promise.all([
      runtime.prisma.aftersale.count({ where: { id: createdAftersaleId ?? undefined } }),
      runtime.prisma.orderItem.count({ where: { id: { in: [ids.orderItemId, ids.secondOrderItemId] } } }),
      runtime.prisma.fileAsset.count({ where: { id: ids.evidenceFileId } }),
      runtime.prisma.salesOrder.count({ where: { id: { in: [ids.orderId, ids.secondOrderId] } } }),
      runtime.prisma.customerProfile.count({ where: { id: { in: [ids.customerId, ids.otherCustomerId] } } }),
      runtime.prisma.account.count({
        where: { id: { in: [ids.accountId, ids.otherAccountId, ids.adminAccountId] } },
      }),
    ]);
    expect(residues).toEqual([0, 0, 0, 0, 0, 0]);
  }, 90_000);

  fullIt('serializes competing quota confirmations on two independent connections', async () => {
    const ids = fixtureIds();
    const createdAt = new Date();
    await runSerializable(runtime, (transaction) => seedFixture(transaction, ids, createdAt));
    const repository = new StoreAftersaleRepository(runtime.prisma);

    const attempts = await raceOnIndependentConnections(
      runtime,
      (transaction) => repository.confirmAftersaleInTransaction(
        transaction,
        previewInput(ids, 'first', []),
        { verifyPreview: () => undefined },
      ),
      (transaction) => repository.confirmAftersaleInTransaction(
        transaction,
        previewInput(ids, 'first', []),
        { verifyPreview: () => undefined },
      ),
    );

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(errorCode(attempts.find(({ status }) => status === 'rejected')!))
      .toBe('AFTERSALE_REQUOTE_REQUIRED');
    await expect(runtime.prisma.aftersale.count({ where: { order_id: ids.orderId } })).resolves.toBe(1);
    await expect(runtime.prisma.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
      .resolves.toMatchObject({ aftersale_reserved_qty: 2, version: 2 });
    await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }))
      .resolves.toMatchObject({ version: 2 });
  }, 120_000);

  fullIt('allows one cross-Order attachment for the same evidence on two independent connections', async () => {
    const ids = fixtureIds();
    await runSerializable(runtime, (transaction) => seedFixture(transaction, ids, new Date()));
    const repository = new StoreAftersaleRepository(runtime.prisma);

    const attempts = await raceOnIndependentConnections(
      runtime,
      (transaction) => repository.confirmAftersaleInTransaction(
        transaction,
        previewInput(ids, 'first'),
        { verifyPreview: () => undefined },
      ),
      (transaction) => repository.confirmAftersaleInTransaction(
        transaction,
        previewInput(ids, 'second'),
        { verifyPreview: () => undefined },
      ),
    );

    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(errorCode(attempts.find(({ status }) => status === 'rejected')!))
      .toBe('AFTERSALE_REQUOTE_REQUIRED');
    await expect(runtime.prisma.aftersaleEvidence.count({ where: { file_id: ids.evidenceFileId } }))
      .resolves.toBe(1);
    await expect(runtime.prisma.aftersale.count({
      where: { order_id: { in: [ids.orderId, ids.secondOrderId] } },
    })).resolves.toBe(1);
    const items = await runtime.prisma.orderItem.findMany({
      orderBy: [{ id: 'asc' }],
      select: { aftersale_reserved_qty: true },
      where: { id: { in: [ids.orderItemId, ids.secondOrderItemId] } },
    });
    expect(items.reduce((total, item) => total + item.aftersale_reserved_qty, 0)).toBe(2);
  }, 120_000);

  fullIt('converges confirmation and shipment creation without deadlock', async () => {
    const ids = fixtureIds();
    await runSerializable(runtime, (transaction) => seedFixture(transaction, ids, new Date()));
    const aftersales = new StoreAftersaleRepository(runtime.prisma);
    const fulfillment = new FulfillmentRepository(runtime.prisma);
    const shipment = shipmentInput(ids, 'first', 1);

    const [confirmation, shipping] = await raceOnIndependentConnections(
      runtime,
      (transaction) => aftersales.confirmAftersaleInTransaction(
        transaction,
        previewInput(ids, 'first', []),
        { verifyPreview: () => undefined },
      ),
      (transaction) => fulfillment.createShipmentInTransaction(transaction, shipment),
    );

    expect(confirmation.status).toBe('fulfilled');
    if (shipping.status === 'rejected') {
      expect(['ACTIVE_AFTERSALE_BLOCKS_SHIPMENT', 'RESOURCE_VERSION_CONFLICT'])
        .toContain(errorCode(shipping));
    }
    const order = await runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } });
    const shipmentCount = await runtime.prisma.shipment.count({ where: { order_id: ids.orderId } });
    expect(await runtime.prisma.aftersale.count({ where: { order_id: ids.orderId } })).toBe(1);
    if (shipping.status === 'fulfilled') {
      expect(order).toMatchObject({ order_status: 'SHIPPING', version: 3 });
      expect(shipmentCount).toBe(1);
    } else {
      expect(order).toMatchObject({ order_status: 'PENDING_SHIPMENT', version: 2 });
      expect(shipmentCount).toBe(0);
    }
  }, 120_000);

  fullIt('serializes cancellation ahead of shipment and permits a fresh-version retry', async () => {
    const ids = fixtureIds();
    await runSerializable(runtime, (transaction) => seedFixture(transaction, ids, new Date()));
    const aftersales = new StoreAftersaleRepository(runtime.prisma);
    const fulfillment = new FulfillmentRepository(runtime.prisma);
    const created = await runSerializable(runtime, (transaction) =>
      aftersales.confirmAftersaleInTransaction(
        transaction,
        previewInput(ids, 'first', []),
        { verifyPreview: () => undefined },
      ));
    const shipment = shipmentInput(ids, 'first', 2);

    const [cancellation, shipping] = await raceOnIndependentConnections(
      runtime,
      (transaction) => aftersales.cancelOwnedAftersaleInTransaction(transaction, {
        accountId: ids.accountId,
        aftersaleId: created.aftersale.aftersaleId,
        customerId: ids.customerId,
        expectedVersion: 1,
      }),
      (transaction) => fulfillment.createShipmentInTransaction(transaction, shipment),
    );

    expect(cancellation.status).toBe('fulfilled');
    expect(shipping.status).toBe('rejected');
    expect(['ACTIVE_AFTERSALE_BLOCKS_SHIPMENT', 'RESOURCE_VERSION_CONFLICT'])
      .toContain(errorCode(shipping));
    await expect(runtime.prisma.aftersale.findUniqueOrThrow({
      where: { id: created.aftersale.aftersaleId },
    })).resolves.toMatchObject({ status: 'CANCELLED', version: 2 });
    await expect(runtime.prisma.orderItem.findUniqueOrThrow({ where: { id: ids.orderItemId } }))
      .resolves.toMatchObject({ aftersale_reserved_qty: 0, version: 3 });
    await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: ids.orderId } }))
      .resolves.toMatchObject({ order_status: 'PENDING_SHIPMENT', version: 3 });
    await expect(runSerializable(
      runtime,
      (transaction) => fulfillment.createShipmentInTransaction(transaction, {
        ...shipment,
        expectedOrderVersion: 3,
      }),
    )).resolves.toMatchObject({ kind: 'created', orderVersion: 4 });
  }, 120_000);
});
