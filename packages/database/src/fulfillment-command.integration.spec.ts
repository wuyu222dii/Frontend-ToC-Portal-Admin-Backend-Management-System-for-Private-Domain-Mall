import { generateUlid } from '@qingxu/platform-core';
import { Pool, type PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseTransaction } from './idempotency.repository';
import { FulfillmentRepository } from './fulfillment.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B11_FULFILLMENT_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B11_FULFILLMENT_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const rollbackSentinel = Object.freeze({ code: 'B11_FULFILLMENT_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FulfillmentFixture {
  actorId: string;
  brandId: string;
  categoryId: string;
  customerAccountId: string;
  customerId: string;
  now: Date;
  orderId: string;
  orderItemIds: [string, string];
  productId: string;
  skuIds: [string, string];
}

interface FixtureRegistry {
  accountIds: Set<string>;
  brandIds: Set<string>;
  categoryIds: Set<string>;
  customerIds: Set<string>;
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
  orderIds: new Set(),
  productIds: new Set(),
  shipmentIds: new Set(),
  skuIds: new Set(),
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B11 fulfillment database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B11 fulfillment tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let database: string;
    let username: string;
    try {
      database = decodeURIComponent(url.pathname.slice(1));
      username = decodeURIComponent(url.username);
    } catch {
      throw new TypeError('Full B11 fulfillment runtime URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database)) {
      throw new TypeError('Full B11 fulfillment tests require a loopback mall_runtime test database');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b112-fulfillment-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B11 fulfillment tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b112-fulfillment-rollback',
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
    throw new TypeError('B11 fulfillment cleanup URL contains invalid percent encoding');
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
    throw new TypeError('B11 fulfillment cleanup requires the matching loopback mall_migrator test database');
  }
  return directUrl.toString();
}

function registerFixture(fixture: FulfillmentFixture): void {
  registered.accountIds.add(fixture.actorId);
  registered.accountIds.add(fixture.customerAccountId);
  registered.brandIds.add(fixture.brandId);
  registered.categoryIds.add(fixture.categoryId);
  registered.customerIds.add(fixture.customerId);
  registered.orderIds.add(fixture.orderId);
  registered.productIds.add(fixture.productId);
  fixture.skuIds.forEach((id) => registered.skuIds.add(id));
}

function createFixture(offset = 0): FulfillmentFixture {
  const now = new Date(Date.now() - 5 * 60_000 + offset);
  const fixture: FulfillmentFixture = {
    actorId: generateUlid(now.getTime() + 1),
    brandId: generateUlid(now.getTime() + 5),
    categoryId: generateUlid(now.getTime() + 6),
    customerAccountId: generateUlid(now.getTime() + 2),
    customerId: generateUlid(now.getTime() + 3),
    now,
    orderId: generateUlid(now.getTime() + 10),
    orderItemIds: [generateUlid(now.getTime() + 11), generateUlid(now.getTime() + 12)],
    productId: generateUlid(now.getTime() + 7),
    skuIds: [generateUlid(now.getTime() + 8), generateUlid(now.getTime() + 9)],
  };
  registerFixture(fixture);
  return fixture;
}

async function seedFixture(
  transaction: DatabaseTransaction,
  fixture: FulfillmentFixture,
  options: { partialPreShipmentRefund?: boolean } = {},
): Promise<void> {
  const partialRefund = options.partialPreShipmentRefund === true;
  const refundedAmount = partialRefund ? '10.00' : '0.00';
  await transaction.account.createMany({
    data: [{
      created_at: fixture.now,
      id: fixture.actorId,
      login_name: `b112-admin-${fixture.actorId}`,
      password_hash: 'b112-integration-password-hash',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: fixture.now,
      version: 1,
    }, {
      created_at: fixture.now,
      id: fixture.customerAccountId,
      login_name: `b112-customer-${fixture.customerAccountId}`,
      password_hash: 'b112-integration-password-hash',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: fixture.now,
      version: 1,
    }],
  });
  await transaction.customerProfile.create({
    data: {
      account_id: fixture.customerAccountId,
      created_at: fixture.now,
      id: fixture.customerId,
      nickname: 'B11.2 Integration Customer',
      registered_at: fixture.now,
      updated_at: fixture.now,
      version: 1,
    },
  });
  await transaction.brand.create({
    data: {
      created_at: fixture.now,
      id: fixture.brandId,
      name: `B112 Brand ${fixture.brandId}`,
      sort_order: 0,
      status: 'ACTIVE',
      updated_at: fixture.now,
      version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: fixture.now,
      id: fixture.categoryId,
      name: `B112 Category ${fixture.categoryId}`,
      sort_order: 0,
      status: 'ACTIVE',
      updated_at: fixture.now,
      version: 1,
    },
  });
  await transaction.product.create({
    data: {
      brand_id: fixture.brandId,
      category_id: fixture.categoryId,
      created_at: fixture.now,
      id: fixture.productId,
      name: 'B11.2 Integration Product',
      published_at: fixture.now,
      sales_count: 0,
      spu_code: `B112-SPU-${fixture.productId}`,
      status: 'ACTIVE',
      updated_at: fixture.now,
      version: 1,
    },
  });
  await transaction.sku.createMany({
    data: fixture.skuIds.map((skuId, index) => ({
      code: `B112-SKU-${skuId}`,
      created_at: fixture.now,
      id: skuId,
      name: `B11.2 Integration SKU ${index + 1}`,
      product_id: fixture.productId,
      retail_price: '10.00',
      status: 'ACTIVE' as const,
      updated_at: fixture.now,
      version: 1,
    })),
  });
  await transaction.salesOrder.create({
    data: {
      created_at: fixture.now,
      customer_id: fixture.customerId,
      fulfillment_status: 'READY_TO_SHIP',
      goods_amount: '50.00',
      id: fixture.orderId,
      order_no: `QX${fixture.orderId}`,
      order_status: 'PENDING_SHIPMENT',
      paid_amount: '50.00',
      paid_at: new Date(fixture.now.getTime() + 60_000),
      pay_expires_at: new Date(fixture.now.getTime() + 30 * 60_000),
      payable_amount: '50.00',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: partialRefund ? 'PARTIAL' : 'NONE',
      refunded_amount: refundedAmount,
      shipping_amount: '0.00',
      source: 'BUY_NOW',
      updated_at: fixture.now,
      version: 1,
    },
  });
  await transaction.orderItem.createMany({
    data: [{
      aftersale_reserved_amount: '0.00',
      aftersale_reserved_qty: 0,
      brand_name_snapshot: 'B11.2 Integration Brand',
      category_id: fixture.categoryId,
      category_name_snapshot: 'B11.2 Integration Category',
      created_at: fixture.now,
      id: fixture.orderItemIds[0],
      line_paid_amount: '30.00',
      order_id: fixture.orderId,
      pre_shipment_refunded_qty: partialRefund ? 1 : 0,
      product_id: fixture.productId,
      product_name_snapshot: 'B11.2 Integration Product',
      quantity: 3,
      refunded_amount: partialRefund ? '10.00' : '0.00',
      refunded_qty: partialRefund ? 1 : 0,
      shipped_qty: 0,
      sku_code_snapshot: `B112-SKU-${fixture.skuIds[0]}`,
      sku_id: fixture.skuIds[0],
      sku_name_snapshot: 'B11.2 Integration SKU 1',
      unit_price: '10.00',
      version: 1,
    }, {
      aftersale_reserved_amount: '0.00',
      aftersale_reserved_qty: 0,
      brand_name_snapshot: 'B11.2 Integration Brand',
      category_id: fixture.categoryId,
      category_name_snapshot: 'B11.2 Integration Category',
      created_at: fixture.now,
      id: fixture.orderItemIds[1],
      line_paid_amount: '20.00',
      order_id: fixture.orderId,
      pre_shipment_refunded_qty: 0,
      product_id: fixture.productId,
      product_name_snapshot: 'B11.2 Integration Product',
      quantity: 2,
      refunded_amount: '0.00',
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: `B112-SKU-${fixture.skuIds[1]}`,
      sku_id: fixture.skuIds[1],
      sku_name_snapshot: 'B11.2 Integration SKU 2',
      unit_price: '10.00',
      version: 1,
    }],
  });
}

function shipmentInput(fixture: FulfillmentFixture, shipmentId: string) {
  const shipmentItemIds = [generateUlid(), generateUlid()] as const;
  return {
    actorAccountId: fixture.actorId,
    carrierCode: 'MANUAL',
    carrierName: 'B11.2 Manual Carrier',
    expectedOrderVersion: 1,
    items: [{
      orderItemId: fixture.orderItemIds[0],
      quantity: 2,
      shipmentItemId: shipmentItemIds[0],
    }, {
      orderItemId: fixture.orderItemIds[1],
      quantity: 2,
      shipmentItemId: shipmentItemIds[1],
    }],
    orderId: fixture.orderId,
    shipmentId,
    trackingNo: `B112-TRACK-${shipmentId}`,
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

function observedErrorCodes(
  value: unknown,
  codes = new Set<string>(),
  seen = new Set<object>(),
): readonly string[] {
  if (typeof value !== 'object' || value === null || seen.has(value)) return [...codes].sort();
  seen.add(value);
  const record = value as Record<string, unknown>;
  for (const key of ['code', 'originalCode', 'sqlState']) {
    if (typeof record[key] === 'string') codes.add(record[key]);
  }
  for (const key of ['cause', 'driverAdapterError', 'meta', 'originalError']) {
    observedErrorCodes(record[key], codes, seen);
  }
  return [...codes].sort();
}

async function expectBusinessError(promise: Promise<unknown>, expectedCode: string): Promise<void> {
  const noError = Symbol('no-error');
  let caught: unknown = noError;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  if (caught === noError) throw new TypeError(`Expected ${expectedCode}, but the command succeeded`);
  expect(caught, `Expected ${expectedCode}; observed codes: ${JSON.stringify(observedErrorCodes(caught))}`)
    .toMatchObject({ code: expectedCode });
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

async function cleanupFullFixtures(runtime: DatabaseRuntime, connectionString: string): Promise<void> {
  const accountIds = [...registered.accountIds];
  const brandIds = [...registered.brandIds];
  const categoryIds = [...registered.categoryIds];
  const customerIds = [...registered.customerIds];
  const orderIds = [...registered.orderIds];
  const productIds = [...registered.productIds];
  const shipmentIds = [...registered.shipmentIds];
  const skuIds = [...registered.skuIds];
  const pool = new Pool({
    application_name: 'qingxu-b112-fulfillment-cleanup',
    connectionString,
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM public.logistics_event
       WHERE shipment_id::text = ANY($1::text[])
          OR shipment_id IN (SELECT id FROM public.shipment WHERE order_id::text = ANY($2::text[]))`,
      [shipmentIds, orderIds],
    );
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
    await client.query('DELETE FROM public.aftersale WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.order_item WHERE order_id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.sku WHERE id::text = ANY($1::text[])', [skuIds]);
    await client.query('DELETE FROM public.product WHERE id::text = ANY($1::text[])', [productIds]);
    await client.query('DELETE FROM public.category WHERE id::text = ANY($1::text[])', [categoryIds]);
    await client.query('DELETE FROM public.brand WHERE id::text = ANY($1::text[])', [brandIds]);
    await client.query('DELETE FROM public.customer_profile WHERE id::text = ANY($1::text[])', [customerIds]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [accountIds]);
    await client.query('COMMIT');

    const residual = await Promise.all([
      runtime.prisma.logisticsEvent.count({ where: { shipment: { order_id: { in: orderIds } } } }),
      runtime.prisma.shipment.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.orderItem.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.aftersale.count({ where: { order_id: { in: orderIds } } }),
      runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
      runtime.prisma.sku.count({ where: { id: { in: skuIds } } }),
      runtime.prisma.product.count({ where: { id: { in: productIds } } }),
      runtime.prisma.category.count({ where: { id: { in: categoryIds } } }),
      runtime.prisma.brand.count({ where: { id: { in: brandIds } } }),
      runtime.prisma.customerProfile.count({ where: { id: { in: customerIds } } }),
      runtime.prisma.account.count({ where: { id: { in: accountIds } } }),
    ]);
    if (residual.some((count) => count !== 0)) {
      throw new TypeError(`B11 fulfillment full fixture residue: ${JSON.stringify(residual)}`);
    }
  } catch (error) {
    if (client !== undefined) await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, fixtures: readonly FulfillmentFixture[]): Promise<void> {
  const orderIds = fixtures.map(({ orderId }) => orderId);
  const accountIds = fixtures.flatMap(({ actorId, customerAccountId }) => [actorId, customerAccountId]);
  await expect(Promise.all([
    runtime.prisma.logisticsEvent.count({ where: { shipment: { order_id: { in: orderIds } } } }),
    runtime.prisma.shipment.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.orderItem.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.aftersale.count({ where: { order_id: { in: orderIds } } }),
    runtime.prisma.salesOrder.count({ where: { id: { in: orderIds } } }),
    runtime.prisma.account.count({ where: { id: { in: accountIds } } }),
  ])).resolves.toEqual([0, 0, 0, 0, 0, 0]);
}

databaseDescribe('B11.2 fulfillment command database integration', () => {
  // These tests own repository facts only. API integration owns the enclosing
  // idempotency, audit, and Outbox transaction composition.
  let runtime: DatabaseRuntime;
  let repository: FulfillmentRepository;
  let cleanupConnectionString: string | undefined;
  let runtimeConnected = false;

  beforeAll(async () => {
    if (mode === 'full') cleanupConnectionString = fullCleanupConnectionString();
    runtime = runtimeForMode();
    await runtime.connect();
    runtimeConnected = true;
    repository = new FulfillmentRepository(runtime.prisma);
  }, 30_000);

  afterAll(async () => {
    if (runtime === undefined) return;
    try {
      if (mode === 'full' && runtimeConnected) {
        if (cleanupConnectionString === undefined) {
          throw new TypeError('B11 fulfillment cleanup connection was not initialized');
        }
        await cleanupFullFixtures(runtime, cleanupConnectionString);
      }
    } finally {
      await runtime.disconnect();
    }
  }, 30_000);

  it('atomically ships exact remaining quantities, blocks active aftersales, and leaves no facts after rollback', async () => {
    const partial = createFixture(0);
    const blocked = createFixture(1_000);
    const shipmentId = generateUlid();
    registered.shipmentIds.add(shipmentId);

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await seedFixture(transaction, partial, { partialPreShipmentRefund: true });
      const created = await repository.createShipmentInTransaction(
        transaction,
        shipmentInput(partial, shipmentId),
      );
      expect(created).toMatchObject({ kind: 'created', orderVersion: 2, shipment: { status: 'SHIPPED' } });
      expect(created.shipment.events).toEqual([]);
      expect(created.shipment.items.map(({ orderItemId, quantity }) => ({ orderItemId, quantity })))
        .toEqual([
          { orderItemId: partial.orderItemIds[0], quantity: 2 },
          { orderItemId: partial.orderItemIds[1], quantity: 2 },
        ]);
      await expect(transaction.salesOrder.findUniqueOrThrow({ where: { id: partial.orderId } }))
        .resolves.toMatchObject({
          fulfillment_status: 'SHIPPED',
          order_status: 'SHIPPING',
          version: 2,
        });
      await expect(transaction.orderItem.findMany({
        orderBy: [{ id: 'asc' }],
        where: { order_id: partial.orderId },
      })).resolves.toMatchObject([
        { pre_shipment_refunded_qty: 1, quantity: 3, shipped_qty: 2, version: 2 },
        { pre_shipment_refunded_qty: 0, quantity: 2, shipped_qty: 2, version: 2 },
      ]);

      await seedFixture(transaction, blocked);
      await transaction.aftersale.create({
        data: {
          aftersale_no: `AS${blocked.orderId}`,
          created_at: blocked.now,
          customer_id: blocked.customerId,
          id: generateUlid(),
          order_id: blocked.orderId,
          reason_code: 'B112_ACTIVE_TEST',
          status: 'PENDING_REVIEW',
          type: 'REFUND_ONLY',
          updated_at: blocked.now,
          version: 1,
        },
      });
      const blockedShipmentId = generateUlid();
      registered.shipmentIds.add(blockedShipmentId);
      await expect(repository.createShipmentInTransaction(
        transaction,
        shipmentInput(blocked, blockedShipmentId),
      )).rejects.toMatchObject({ code: 'ACTIVE_AFTERSALE_BLOCKS_SHIPMENT' });
      await expect(transaction.shipment.count({ where: { order_id: blocked.orderId } })).resolves.toBe(0);
      await expect(transaction.orderItem.findMany({
        orderBy: [{ id: 'asc' }],
        select: { shipped_qty: true, version: true },
        where: { order_id: blocked.orderId },
      })).resolves.toEqual([{ shipped_qty: 0, version: 1 }, { shipped_qty: 0, version: 1 }]);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    await assertNoFixtureFacts(runtime, [partial, blocked]);
  }, 120_000);

  fullIt('converges after a shipment transaction fails after applying repository facts', async () => {
    const fixture = createFixture(1_500);
    await runtime.prisma.$transaction((transaction) => seedFixture(transaction, fixture, {
      partialPreShipmentRefund: true,
    }), transactionOptions);
    const shipmentId = generateUlid();
    registered.shipmentIds.add(shipmentId);
    const input = shipmentInput(fixture, shipmentId);

    await expect(runtime.prisma.$transaction(async (transaction) => {
      await expect(repository.createShipmentInTransaction(transaction, input))
        .resolves.toMatchObject({ kind: 'created', shipment: { shipmentId } });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await expect(runtime.prisma.shipment.count({ where: { order_id: fixture.orderId } })).resolves.toBe(0);
    await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: fixture.orderId } }))
      .resolves.toMatchObject({ fulfillment_status: 'READY_TO_SHIP', order_status: 'PENDING_SHIPMENT', version: 1 });
    await expect(runtime.prisma.orderItem.findMany({
      orderBy: [{ id: 'asc' }],
      select: { shipped_qty: true, version: true },
      where: { order_id: fixture.orderId },
    })).resolves.toEqual([{ shipped_qty: 0, version: 1 }, { shipped_qty: 0, version: 1 }]);

    await expect(runSerializable(
      runtime,
      (transaction) => repository.createShipmentInTransaction(transaction, input),
    )).resolves.toMatchObject({ kind: 'created', orderVersion: 2, shipment: { shipmentId } });
    await expect(runSerializable(
      runtime,
      (transaction) => repository.createShipmentInTransaction(transaction, input),
    )).resolves.toMatchObject({ kind: 'winner', orderVersion: 2, shipment: { shipmentId } });
  }, 120_000);

  fullIt('converges package and STATUS races, preserves corrections, and returns a stable timeline', async () => {
    const fixture = createFixture(2_000);
    await runtime.prisma.$transaction((transaction) => seedFixture(transaction, fixture, {
      partialPreShipmentRefund: true,
    }), transactionOptions);
    const shipmentIds = [generateUlid(), generateUlid()] as const;
    shipmentIds.forEach((id) => registered.shipmentIds.add(id));
    const createInputs = shipmentIds.map((id) => shipmentInput(fixture, id));

    const createAttempts = await Promise.allSettled(createInputs.map((input) =>
      runSerializable(runtime, (transaction) => repository.createShipmentInTransaction(transaction, input))));
    const created = createAttempts.filter((attempt) =>
      attempt.status === 'fulfilled' && attempt.value.kind === 'created');
    const rejected = createAttempts.filter((attempt) => attempt.status === 'rejected');
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { code: 'SHIPMENT_STATE_CONFLICT' } });
    const winnerInput = createInputs.find(({ shipmentId: id }) =>
      id === (created[0] as PromiseFulfilledResult<Awaited<ReturnType<
        FulfillmentRepository['createShipmentInTransaction']
      >>>).value.shipment.shipmentId);
    if (winnerInput === undefined) throw new TypeError('Created shipment input could not be identified');
    await expect(runSerializable(
      runtime,
      (transaction) => repository.createShipmentInTransaction(transaction, winnerInput),
    )).resolves.toMatchObject({ kind: 'winner', shipment: { shipmentId: winnerInput.shipmentId } });
    await expect(runtime.prisma.shipment.count({ where: { order_id: fixture.orderId } })).resolves.toBe(1);

    const occurredAt = new Date(Date.now() + 1_000);
    await expectBusinessError(runSerializable(runtime, (transaction) =>
      repository.appendLogisticsEventInTransaction(transaction, {
        actorAccountId: fixture.actorId,
        event: {
          description: 'B11.2 illegal direct delivery',
          eventType: 'STATUS',
          location: null,
          occurredAt,
          statusCode: 'DELIVERED',
        },
        eventId: generateUlid(),
        eventKey: `b112-illegal-delivery-${generateUlid()}`,
        expectedShipmentVersion: 1,
        shipmentId: winnerInput.shipmentId,
      })), 'SHIPMENT_STATE_CONFLICT');
    await expect(runtime.prisma.logisticsEvent.count({ where: { shipment_id: winnerInput.shipmentId } }))
      .resolves.toBe(0);
    const statusInputs = [generateUlid(), generateUlid()].map((id, index) => ({
      actorAccountId: fixture.actorId,
      event: {
        description: `B11.2 transit race ${index + 1}`,
        eventType: 'STATUS' as const,
        location: 'B11.2 Sorting Centre',
        occurredAt,
        statusCode: 'IN_TRANSIT' as const,
      },
      eventId: id,
      eventKey: `b112-transit-${id}`,
      expectedShipmentVersion: 1,
      shipmentId: winnerInput.shipmentId,
    }));
    const statusAttempts = await Promise.allSettled(statusInputs.map((input) =>
      runSerializable(runtime, (transaction) => repository.appendLogisticsEventInTransaction(transaction, input))));
    expect(statusAttempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1);
    expect(statusAttempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1);
    expect(statusAttempts.find((attempt) => attempt.status === 'rejected'))
      .toMatchObject({ reason: { code: 'RESOURCE_VERSION_CONFLICT' } });
    const winningStatusAttempt = statusAttempts.find((attempt) => attempt.status === 'fulfilled');
    if (winningStatusAttempt?.status !== 'fulfilled') {
      throw new TypeError('Winning status event could not be identified');
    }
    const winningStatusInput = statusInputs.find(({ eventId }) =>
      eventId === winningStatusAttempt.value.event.eventId);
    if (winningStatusInput === undefined) throw new TypeError('Winning status input could not be identified');
    await expect(runSerializable(
      runtime,
      (transaction) => repository.appendLogisticsEventInTransaction(transaction, winningStatusInput),
    )).resolves.toMatchObject({
      event: { eventId: winningStatusInput.eventId },
      kind: 'winner',
      shipment: { status: 'IN_TRANSIT', version: 2 },
    });
    await expect(runSerializable(
      runtime,
      (transaction) => repository.appendLogisticsEventInTransaction(transaction, {
        ...winningStatusInput,
        event: { ...winningStatusInput.event, description: 'Conflicting payload for the same event key' },
      }),
    )).rejects.toMatchObject({ code: 'SHIPMENT_STATE_CONFLICT' });
    await expect(runtime.prisma.logisticsEvent.count({ where: { shipment_id: winnerInput.shipmentId } }))
      .resolves.toBe(1);

    const correctionId = generateUlid();
    const correction = {
      actorAccountId: fixture.actorId,
      event: {
        carrierCode: 'CORRECTED',
        carrierName: 'B11.2 Corrected Carrier',
        description: 'Corrected tracking after label verification',
        eventType: 'TRACKING_CORRECTION' as const,
        location: null,
        occurredAt,
        reason: 'Verified against the physical parcel label',
        trackingNo: 'B112-CORRECTED-TRACK',
      },
      eventId: correctionId,
      eventKey: `b112-correction-${correctionId}`,
      expectedShipmentVersion: 2,
      shipmentId: winnerInput.shipmentId,
    };
    const corrected = await runSerializable(
      runtime,
      (transaction) => repository.appendLogisticsEventInTransaction(transaction, correction),
    );
    expect(corrected).toMatchObject({
      event: { eventType: 'TRACKING_CORRECTION', reason: correction.event.reason },
      shipment: {
        carrierCode: 'CORRECTED',
        status: 'IN_TRANSIT',
        trackingNo: 'B112-CORRECTED-TRACK',
        version: 3,
      },
    });
    const deliveredId = generateUlid();
    const deliveredAt = new Date(occurredAt.getTime() + 1_000);
    const delivered = await runSerializable(runtime, (transaction) =>
      repository.appendLogisticsEventInTransaction(transaction, {
        actorAccountId: fixture.actorId,
        event: {
          description: 'B11.2 parcel delivered',
          eventType: 'STATUS',
          location: 'B11.2 Recipient',
          occurredAt: deliveredAt,
          statusCode: 'DELIVERED',
        },
        eventId: deliveredId,
        eventKey: `b112-delivered-${deliveredId}`,
        expectedShipmentVersion: 3,
        shipmentId: winnerInput.shipmentId,
      }));
    expect(delivered.shipment).toMatchObject({ deliveredAt, status: 'DELIVERED', version: 4 });
    expect(delivered.shipment.events).toHaveLength(3);
    expect(delivered.shipment.events.map(({ eventId: id }) => id)).toEqual([
      ...delivered.shipment.events.slice(0, 2).map(({ eventId: id }) => id).sort(),
      deliveredId,
    ]);
    const transit = delivered.shipment.events.find(({ eventId, eventType }) => eventType === 'STATUS' &&
      eventId !== deliveredId);
    expect(transit).toMatchObject({
      carrierCode: null,
      carrierName: null,
      reason: null,
      statusCode: 'IN_TRANSIT',
      trackingNo: null,
    });
    expect(delivered.shipment.events.find(({ eventId: id }) => id === correctionId)).toMatchObject({
      carrierCode: 'CORRECTED',
      eventType: 'TRACKING_CORRECTION',
      reason: correction.event.reason,
      statusCode: null,
      trackingNo: 'B112-CORRECTED-TRACK',
    });
    await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: fixture.orderId } }))
      .resolves.toMatchObject({ fulfillment_status: 'DELIVERED', order_status: 'SHIPPING', version: 4 });
  }, 120_000);
});
