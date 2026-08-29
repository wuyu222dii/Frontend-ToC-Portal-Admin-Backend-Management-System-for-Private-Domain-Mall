import { generateUlid } from '@qingxu/platform-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { Prisma } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { InventoryRepository } from './inventory.repository';
import { ProductCatalogRepository } from './product-catalog.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import {
  StoreOrderRepository,
  type StoreOrderAddressSnapshotMaterial,
  type StoreOrderCreateHooks,
} from './store-order.repository';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B9_STORE_ORDER_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B9_STORE_ORDER_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const rollbackSentinel = Object.freeze({ code: 'B9_STORE_ORDER_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const fullFixtureIds = {
  accountIds: new Set<string>(),
  addressIds: new Set<string>(),
  balanceIds: new Set<string>(),
  brandIds: new Set<string>(),
  cartIds: new Set<string>(),
  categoryIds: new Set<string>(),
  customerIds: new Set<string>(),
  fileIds: new Set<string>(),
  imageIds: new Set<string>(),
  productIds: new Set<string>(),
  skuIds: new Set<string>(),
};
const PAYMENT_INTENT_STATUSES = [
  'CREATING',
  'OPEN',
  'CLOSE_PENDING',
  'CLOSED',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'EXPIRED',
] as const;

interface CatalogFixture {
  balanceId: string;
  brandId: string;
  categoryId: string;
  fileId: string;
  imageId: string;
  productId: string;
  skuId: string;
}

interface CustomerFixture {
  accountId: string;
  addressId: string;
  customerId: string;
}

interface CartFixture {
  cartId: string;
  selectedItemId: string;
  unselectedBalanceId: string;
  unselectedItemId: string;
  unselectedSkuId: string;
}

interface CreatedOrderFacts {
  attributionCandidateId: string;
  orderId: string;
  reservationId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B9 Store order database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B9 Store order tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B9 Store order tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b92-store-order-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B9 Store order tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b92-store-order-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function createCatalogFixture(): CatalogFixture {
  const fixture = {
    balanceId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    fileId: generateUlid(),
    imageId: generateUlid(),
    productId: generateUlid(),
    skuId: generateUlid(),
  };
  if (mode === 'full') {
    fullFixtureIds.balanceIds.add(fixture.balanceId);
    fullFixtureIds.brandIds.add(fixture.brandId);
    fullFixtureIds.categoryIds.add(fixture.categoryId);
    fullFixtureIds.fileIds.add(fixture.fileId);
    fullFixtureIds.imageIds.add(fixture.imageId);
    fullFixtureIds.productIds.add(fixture.productId);
    fullFixtureIds.skuIds.add(fixture.skuId);
  }
  return fixture;
}

function createCustomerFixture(): CustomerFixture {
  const fixture = {
    accountId: generateUlid(),
    addressId: generateUlid(),
    customerId: generateUlid(),
  };
  if (mode === 'full') {
    fullFixtureIds.accountIds.add(fixture.accountId);
    fullFixtureIds.addressIds.add(fixture.addressId);
    fullFixtureIds.customerIds.add(fixture.customerId);
  }
  return fixture;
}

function createCartFixture(): CartFixture {
  const fixture = {
    cartId: generateUlid(),
    selectedItemId: generateUlid(),
    unselectedBalanceId: generateUlid(),
    unselectedItemId: generateUlid(),
    unselectedSkuId: generateUlid(),
  };
  if (mode === 'full') {
    fullFixtureIds.balanceIds.add(fixture.unselectedBalanceId);
    fullFixtureIds.cartIds.add(fixture.cartId);
    fullFixtureIds.skuIds.add(fixture.unselectedSkuId);
  }
  return fixture;
}

function fullCleanupConnectionString(): string {
  const directUrl = new URL(requiredEnvironment('DIRECT_URL'));
  const runtimeUrl = new URL(requiredEnvironment('DATABASE_URL'));
  let database: string;
  let username: string;
  try {
    database = decodeURIComponent(directUrl.pathname.slice(1));
    username = decodeURIComponent(directUrl.username);
  } catch {
    throw new TypeError('B9 Store order cleanup URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || username !== 'mall_migrator' || !directUrl.password ||
    directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(database) ||
    directUrl.hostname !== runtimeUrl.hostname || (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('B9 Store order cleanup requires the matching loopback mall_migrator test database');
  }
  return directUrl.toString();
}

async function cleanupFullFixtures(runtime: DatabaseRuntime): Promise<void> {
  const accountIds = [...fullFixtureIds.accountIds];
  const addressIds = [...fullFixtureIds.addressIds];
  const balanceIds = [...fullFixtureIds.balanceIds];
  const brandIds = [...fullFixtureIds.brandIds];
  const cartIds = [...fullFixtureIds.cartIds];
  const categoryIds = [...fullFixtureIds.categoryIds];
  const customerIds = [...fullFixtureIds.customerIds];
  const fileIds = [...fullFixtureIds.fileIds];
  const imageIds = [...fullFixtureIds.imageIds];
  const productIds = [...fullFixtureIds.productIds];
  const skuIds = [...fullFixtureIds.skuIds];
  const pool = new Pool({
    application_name: 'qingxu-b9-store-order-cleanup',
    connectionString: fullCleanupConnectionString(),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const orders = await client.query<{ id: string }>(
      'SELECT id::text FROM public.sales_order WHERE customer_id::text = ANY($1::text[])',
      [customerIds],
    );
    const orderIds = orders.rows.map(({ id }) => id);
    const reservations = await client.query<{ id: string }>(
      'SELECT id::text FROM public.inventory_reservation WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    const reservationIds = reservations.rows.map(({ id }) => id);
    const paymentIntents = await client.query<{ id: string }>(
      'SELECT id::text FROM public.payment_intent WHERE order_id::text = ANY($1::text[])',
      [orderIds],
    );
    const paymentIntentIds = paymentIntents.rows.map(({ id }) => id);
    await client.query(
      'DELETE FROM public.payment_attempt WHERE payment_intent_id::text = ANY($1::text[])',
      [paymentIntentIds],
    );
    await client.query('DELETE FROM public.payment_intent WHERE id::text = ANY($1::text[])', [paymentIntentIds]);
    await client.query(
      `DELETE FROM public.audit_log
       WHERE actor_account_id::text = ANY($1::text[])
          OR (object_type = 'order' AND object_id = ANY($2::text[]))`,
      [accountIds, orderIds],
    );
    await client.query(
      `DELETE FROM public.idempotency_record
       WHERE actor_id::text = ANY($1::text[]) OR resource_id::text = ANY($2::text[])`,
      [accountIds, orderIds],
    );
    await client.query(
      `DELETE FROM public.outbox_event
       WHERE aggregate_type = 'order' AND aggregate_id::text = ANY($1::text[])`,
      [orderIds],
    );
    await client.query(
      `DELETE FROM public.inventory_ledger
       WHERE sku_id::text = ANY($1::text[]) OR business_id::text = ANY($2::text[])`,
      [skuIds, reservationIds],
    );
    await client.query(
      'DELETE FROM public.inventory_reservation_item WHERE reservation_id::text = ANY($1::text[])',
      [reservationIds],
    );
    await client.query(
      'DELETE FROM public.inventory_reservation WHERE id::text = ANY($1::text[])',
      [reservationIds],
    );
    for (const table of ['order_attribution_candidate', 'order_address_snapshot', 'order_item']) {
      await client.query(`DELETE FROM public.${table} WHERE order_id::text = ANY($1::text[])`, [orderIds]);
    }
    await client.query('DELETE FROM public.sales_order WHERE id::text = ANY($1::text[])', [orderIds]);
    await client.query('DELETE FROM public.cart_item WHERE cart_id::text = ANY($1::text[])', [cartIds]);
    await client.query('DELETE FROM public.cart WHERE id::text = ANY($1::text[])', [cartIds]);
    await client.query('DELETE FROM public.customer_address WHERE id::text = ANY($1::text[])', [addressIds]);
    await client.query('DELETE FROM public.customer_profile WHERE id::text = ANY($1::text[])', [customerIds]);
    await client.query('DELETE FROM public.account WHERE id::text = ANY($1::text[])', [accountIds]);
    await client.query('DELETE FROM public.product_image WHERE id::text = ANY($1::text[])', [imageIds]);
    await client.query('DELETE FROM public.inventory_balance WHERE id::text = ANY($1::text[])', [balanceIds]);
    await client.query('DELETE FROM public.sku WHERE id::text = ANY($1::text[])', [skuIds]);
    await client.query('DELETE FROM public.product WHERE id::text = ANY($1::text[])', [productIds]);
    await client.query('DELETE FROM public.file_asset WHERE id::text = ANY($1::text[])', [fileIds]);
    await client.query('DELETE FROM public.category WHERE id::text = ANY($1::text[])', [categoryIds]);
    await client.query('DELETE FROM public.brand WHERE id::text = ANY($1::text[])', [brandIds]);
    await client.query('COMMIT');

    const residual = await Promise.all([
      runtime.prisma.salesOrder.count({ where: { customer_id: { in: customerIds } } }),
      runtime.prisma.inventoryLedger.count({ where: { sku_id: { in: skuIds } } }),
      runtime.prisma.customerAddress.count({ where: { id: { in: addressIds } } }),
      runtime.prisma.customerProfile.count({ where: { id: { in: customerIds } } }),
      runtime.prisma.account.count({ where: { id: { in: accountIds } } }),
      runtime.prisma.productImage.count({ where: { id: { in: imageIds } } }),
      runtime.prisma.inventoryBalance.count({ where: { id: { in: balanceIds } } }),
      runtime.prisma.sku.count({ where: { id: { in: skuIds } } }),
      runtime.prisma.product.count({ where: { id: { in: productIds } } }),
      runtime.prisma.fileAsset.count({ where: { id: { in: fileIds } } }),
      runtime.prisma.category.count({ where: { id: { in: categoryIds } } }),
      runtime.prisma.brand.count({ where: { id: { in: brandIds } } }),
    ]);
    if (residual.some((count) => count !== 0)) {
      throw new TypeError(`B9 Store order full fixture residue: ${JSON.stringify(residual)}`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function seedCustomer(
  transaction: DatabaseTransaction,
  fixture: CustomerFixture,
  marker: string,
): Promise<void> {
  const now = new Date();
  await transaction.account.create({
    data: {
      created_at: now,
      id: fixture.accountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: now,
      wechat_open_id: `b92-order-openid-${marker}-${fixture.accountId}`,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: fixture.accountId,
      created_at: now,
      id: fixture.customerId,
      registered_at: now,
      updated_at: now,
    },
  });
  await transaction.customerAddress.create({
    data: {
      city: 'Auckland',
      created_at: now,
      customer_id: fixture.customerId,
      detail_ciphertext: Buffer.from(`b92-order-detail-${marker}`),
      district: 'Central',
      encryption_key_id: 'b92-order-source-key',
      id: fixture.addressId,
      is_default: true,
      phone_ciphertext: Buffer.from(`b92-order-phone-${marker}`),
      phone_hash: 'b'.repeat(64),
      phone_last4: '2468',
      province: 'Auckland',
      recipient_name: `B9 Order Recipient ${marker}`,
      updated_at: now,
    },
  });
}

async function seedCatalog(
  transaction: DatabaseTransaction,
  fixture: CatalogFixture,
  options: { lockedQty?: number; physicalQty?: number } = {},
): Promise<void> {
  const now = new Date();
  await transaction.brand.create({
    data: {
      created_at: now,
      id: fixture.brandId,
      name: `B92 Order Brand ${fixture.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: fixture.categoryId,
      name: `B92 Order Category ${fixture.categoryId}`,
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
      name: `B92 Order Product ${fixture.productId}`,
      published_at: now,
      spu_code: `B92-SPU-${fixture.productId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.fileAsset.create({
    data: {
      byte_size: 1_024n,
      created_at: now,
      id: fixture.fileId,
      mime_type: 'image/png',
      object_key: `public/${fixture.fileId}`,
      original_name: 'b92-order-product.png',
      purpose: 'PRODUCT_IMAGE',
      sha256: 'c'.repeat(64),
      status: 'READY',
      visibility: 'PUBLIC',
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
  await transaction.sku.create({
    data: {
      code: `B92-SKU-${fixture.skuId}`,
      created_at: now,
      id: fixture.skuId,
      name: 'B92 Order SKU',
      product_id: fixture.productId,
      retail_price: '12.50',
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: fixture.balanceId,
      locked_qty: options.lockedQty ?? 0,
      physical_qty: options.physicalQty ?? 5,
      sku_id: fixture.skuId,
      updated_at: now,
      version: 1,
    },
  });
}

async function seedCart(
  transaction: DatabaseTransaction,
  customer: CustomerFixture,
  catalog: CatalogFixture,
  fixture: CartFixture,
): Promise<void> {
  const now = new Date();
  await transaction.sku.create({
    data: {
      code: `B92-SKU-${fixture.unselectedSkuId}`,
      created_at: now,
      id: fixture.unselectedSkuId,
      name: 'B92 Unselected SKU',
      product_id: catalog.productId,
      retail_price: '4.00',
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: fixture.unselectedBalanceId,
      locked_qty: 0,
      physical_qty: 4,
      sku_id: fixture.unselectedSkuId,
      updated_at: now,
      version: 1,
    },
  });
  await transaction.cart.create({
    data: { created_at: now, customer_id: customer.customerId, id: fixture.cartId, updated_at: now },
  });
  await transaction.cartItem.createMany({
    data: [
      {
        cart_id: fixture.cartId,
        created_at: now,
        id: fixture.selectedItemId,
        quantity: 2,
        selected: true,
        sku_id: catalog.skuId,
        updated_at: now,
      },
      {
        cart_id: fixture.cartId,
        created_at: now,
        id: fixture.unselectedItemId,
        quantity: 4,
        selected: false,
        sku_id: fixture.unselectedSkuId,
        updated_at: now,
      },
    ],
  });
}

async function seedPendingOrder(
  transaction: DatabaseTransaction,
  customer: CustomerFixture,
  catalog: CatalogFixture,
  createdAt: Date,
): Promise<CreatedOrderFacts> {
  const payExpiresAt = new Date(createdAt.getTime() + 30 * 60 * 1_000);
  const orderId = generateUlid(createdAt.getTime());
  const orderItemId = generateUlid(createdAt.getTime());
  const addressSnapshotId = generateUlid(createdAt.getTime());
  const attributionCandidateId = generateUlid(createdAt.getTime());
  const reservationId = generateUlid(createdAt.getTime());
  const reservationItemId = generateUlid(createdAt.getTime());
  const ledgerId = generateUlid(createdAt.getTime());
  const balance = await transaction.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
  const lockedAfter = balance.locked_qty + 1;
  if (lockedAfter > balance.physical_qty) throw new TypeError('B9 pending order fixture has insufficient stock');

  await transaction.salesOrder.create({
    data: {
      close_reason: null,
      completion_reason: null,
      created_at: createdAt,
      customer_id: customer.customerId,
      fulfillment_status: 'NOT_STARTED',
      goods_amount: new Prisma.Decimal('12.50'),
      id: orderId,
      order_no: `QX${orderId}`,
      order_status: 'PENDING_PAYMENT',
      paid_amount: new Prisma.Decimal(0),
      pay_expires_at: payExpiresAt,
      payable_amount: new Prisma.Decimal('12.50'),
      payment_resolution: 'NORMAL',
      payment_status: 'UNPAID',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'NONE',
      refunded_amount: new Prisma.Decimal(0),
      shipping_amount: new Prisma.Decimal(0),
      source: 'BUY_NOW',
      updated_at: createdAt,
      version: 1,
    },
  });
  await transaction.orderItem.create({
    data: {
      aftersale_reserved_amount: new Prisma.Decimal(0),
      aftersale_reserved_qty: 0,
      brand_name_snapshot: `B92 Order Brand ${catalog.brandId}`,
      category_id: catalog.categoryId,
      category_name_snapshot: `B92 Order Category ${catalog.categoryId}`,
      created_at: createdAt,
      id: orderItemId,
      line_paid_amount: new Prisma.Decimal('12.50'),
      order_id: orderId,
      pre_shipment_refunded_qty: 0,
      product_id: catalog.productId,
      product_name_snapshot: `B92 Order Product ${catalog.productId}`,
      quantity: 1,
      refunded_amount: new Prisma.Decimal(0),
      refunded_qty: 0,
      shipped_qty: 0,
      sku_code_snapshot: `B92-SKU-${catalog.skuId}`,
      sku_id: catalog.skuId,
      sku_name_snapshot: 'B92 Order SKU',
      unit_price: new Prisma.Decimal('12.50'),
      version: 1,
    },
  });
  await transaction.orderAddressSnapshot.create({
    data: {
      city: 'Auckland',
      created_at: createdAt,
      detail_ciphertext: Buffer.from(`b92-pending-detail-${addressSnapshotId}`),
      district: 'Central',
      encryption_key_id: 'b92-order-snapshot-key',
      id: addressSnapshotId,
      order_id: orderId,
      phone_ciphertext: Buffer.from(`b92-pending-phone-${addressSnapshotId}`),
      phone_last4: '2468',
      province: 'Auckland',
      recipient_name: `B9 Order Recipient ${customer.customerId}`,
    },
  });
  await transaction.orderAttributionCandidate.create({
    data: {
      id: attributionCandidateId,
      order_id: orderId,
      submit_channel: 'DIRECT',
      submitted_at: createdAt,
    },
  });
  await transaction.inventoryReservation.create({
    data: {
      created_at: createdAt,
      expires_at: payExpiresAt,
      id: reservationId,
      order_id: orderId,
      status: 'ACTIVE',
    },
  });
  await transaction.inventoryReservationItem.create({
    data: {
      created_at: createdAt,
      id: reservationItemId,
      quantity: 1,
      reservation_id: reservationId,
      sku_id: catalog.skuId,
    },
  });
  const updated = await transaction.inventoryBalance.updateMany({
    data: { locked_qty: lockedAfter, updated_at: createdAt, version: { increment: 1 } },
    where: {
      id: catalog.balanceId,
      locked_qty: balance.locked_qty,
      physical_qty: balance.physical_qty,
      sku_id: catalog.skuId,
      version: balance.version,
    },
  });
  if (updated.count !== 1) throw new TypeError('B9 pending order fixture lost its inventory balance');
  await transaction.inventoryLedger.create({
    data: {
      actor_account_id: customer.accountId,
      business_id: reservationId,
      id: ledgerId,
      ledger_type: 'ORDER_RESERVE',
      locked_after: lockedAfter,
      locked_change: 1,
      occurred_at: createdAt,
      physical_after: balance.physical_qty,
      physical_change: 0,
      reason: 'ORDER_RESERVE',
      sku_id: catalog.skuId,
    },
  });
  return { attributionCandidateId, orderId, reservationId };
}

function createHooks(): StoreOrderCreateHooks {
  return {
    protectAddress: (addressSnapshotId, address): StoreOrderAddressSnapshotMaterial => ({
      detailCiphertext: Buffer.from(`b92-protected-detail-${addressSnapshotId}`),
      encryptionKeyId: 'b92-order-snapshot-key',
      phoneCiphertext: Buffer.from(`b92-protected-phone-${addressSnapshotId}`),
      phoneLast4: address.phoneLast4,
    }),
    verifyQuote: () => undefined,
  };
}

function buyNowInput(customer: CustomerFixture, catalog: CatalogFixture) {
  return {
    accountId: customer.accountId,
    addressId: customer.addressId,
    customerId: customer.customerId,
    items: [{ quantity: 1, skuId: catalog.skuId }],
    source: 'BUY_NOW' as const,
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

async function runSerializableWithoutDeadlockRetry<T>(
  database: DatabaseRuntime,
  work: (transaction: DatabaseTransaction) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await database.prisma.$transaction(work, transactionOptions);
    } catch (error) {
      if (hasPostgresCode(error, '40P01') || attempt >= 5 || !hasPostgresCode(error, '40001')) throw error;
    }
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

databaseDescribe('B9 Store order database integration', () => {
  let runtime: DatabaseRuntime;
  let repository: StoreOrderRepository;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
    repository = new StoreOrderRepository(runtime.prisma);
  }, 30_000);

  afterAll(async () => {
    try {
      if (mode === 'full') await cleanupFullFixtures(runtime);
    } finally {
      await runtime?.disconnect();
    }
  }, 30_000);

  it('creates every CART order fact atomically and leaves no fixture facts after rollback', async () => {
    const catalog = createCatalogFixture();
    const customer = createCustomerFixture();
    const cart = createCartFixture();
    let created: CreatedOrderFacts | undefined;

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedCustomer(transaction, customer, customer.customerId);
      await seedCatalog(transaction, catalog, { lockedQty: 1, physicalQty: 5 });
      await seedCart(transaction, customer, catalog, cart);

      const result = await repository.createOrderInTransaction(transaction, {
        accountId: customer.accountId,
        addressId: customer.addressId,
        customerId: customer.customerId,
        items: [{ quantity: 2, skuId: catalog.skuId }],
        source: 'CART',
      }, createHooks());
      created = {
        attributionCandidateId: result.attribution.candidateId,
        orderId: result.order.orderId,
        reservationId: result.reservation.reservationId,
      };

      const order = await transaction.salesOrder.findUnique({ where: { id: result.order.orderId } });
      expect(order).toMatchObject({
        customer_id: customer.customerId,
        fulfillment_status: 'NOT_STARTED',
        order_no: `QX${result.order.orderId}`,
        order_status: 'PENDING_PAYMENT',
        payment_status: 'UNPAID',
        source: 'CART',
        version: 1,
      });
      expect(order?.goods_amount.toFixed(2)).toBe('25.00');
      expect(order?.shipping_amount.toFixed(2)).toBe('0.00');
      expect(order?.payable_amount.toFixed(2)).toBe('25.00');

      const items = await transaction.orderItem.findMany({ where: { order_id: result.order.orderId } });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        brand_name_snapshot: `B92 Order Brand ${catalog.brandId}`,
        category_id: catalog.categoryId,
        category_name_snapshot: `B92 Order Category ${catalog.categoryId}`,
        product_id: catalog.productId,
        product_name_snapshot: `B92 Order Product ${catalog.productId}`,
        quantity: 2,
        sku_code_snapshot: `B92-SKU-${catalog.skuId}`,
        sku_id: catalog.skuId,
        sku_name_snapshot: 'B92 Order SKU',
        version: 1,
      });
      expect(items[0]?.unit_price.toFixed(2)).toBe('12.50');
      expect(items[0]?.line_paid_amount.toFixed(2)).toBe('25.00');

      const address = await transaction.orderAddressSnapshot.findUnique({
        where: { order_id: result.order.orderId },
      });
      expect(address).toMatchObject({
        city: 'Auckland',
        district: 'Central',
        encryption_key_id: 'b92-order-snapshot-key',
        phone_last4: '2468',
        province: 'Auckland',
        recipient_name: `B9 Order Recipient ${customer.customerId}`,
      });
      expect(Buffer.from(address?.phone_ciphertext ?? []).toString())
        .toBe(`b92-protected-phone-${address?.id}`);
      expect(Buffer.from(address?.detail_ciphertext ?? []).toString())
        .toBe(`b92-protected-detail-${address?.id}`);

      await expect(transaction.orderAttributionCandidate.findUnique({
        where: { order_id: result.order.orderId },
      })).resolves.toMatchObject({
        binding_id: null,
        candidate_agent_id: null,
        finalization_result: null,
        id: result.attribution.candidateId,
        submit_channel: 'DIRECT',
      });
      await expect(transaction.inventoryReservation.findUnique({
        where: { order_id: result.order.orderId },
      })).resolves.toMatchObject({
        consumed_at: null,
        expires_at: result.order.payExpiresAt,
        id: result.reservation.reservationId,
        released_at: null,
        status: 'ACTIVE',
      });
      await expect(transaction.inventoryReservationItem.findMany({
        where: { reservation_id: result.reservation.reservationId },
      })).resolves.toMatchObject([{ quantity: 2, sku_id: catalog.skuId }]);
      await expect(transaction.inventoryBalance.findUnique({ where: { id: catalog.balanceId } }))
        .resolves.toMatchObject({ locked_qty: 3, physical_qty: 5, version: 2 });
      await expect(transaction.inventoryLedger.findMany({
        where: { business_id: result.reservation.reservationId },
      })).resolves.toMatchObject([{
        actor_account_id: customer.accountId,
        ledger_type: 'ORDER_RESERVE',
        locked_after: 3,
        locked_change: 2,
        physical_after: 5,
        physical_change: 0,
        reason: 'ORDER_RESERVE',
        sku_id: catalog.skuId,
      }]);
      await expect(transaction.cartItem.findMany({
        orderBy: [{ sku_id: 'asc' }],
        where: { cart_id: cart.cartId },
      })).resolves.toMatchObject([{
        id: cart.unselectedItemId,
        quantity: 4,
        selected: false,
        sku_id: cart.unselectedSkuId,
      }]);
      expect(result.removedCartItemCount).toBe(1);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    if (!created) throw new TypeError('B9 Store order rollback fixture did not create an order');
    await expect(Promise.all([
      runtime.prisma.salesOrder.count({ where: { id: created.orderId } }),
      runtime.prisma.orderItem.count({ where: { order_id: created.orderId } }),
      runtime.prisma.orderAddressSnapshot.count({ where: { order_id: created.orderId } }),
      runtime.prisma.orderAttributionCandidate.count({ where: { id: created.attributionCandidateId } }),
      runtime.prisma.inventoryReservation.count({ where: { id: created.reservationId } }),
      runtime.prisma.inventoryReservationItem.count({ where: { reservation_id: created.reservationId } }),
      runtime.prisma.inventoryLedger.count({ where: { business_id: created.reservationId } }),
      runtime.prisma.cartItem.count({ where: { id: { in: [cart.selectedItemId, cart.unselectedItemId] } } }),
      runtime.prisma.cart.count({ where: { id: cart.cartId } }),
      runtime.prisma.inventoryBalance.count({
        where: { id: { in: [catalog.balanceId, cart.unselectedBalanceId] } },
      }),
      runtime.prisma.sku.count({ where: { id: { in: [catalog.skuId, cart.unselectedSkuId] } } }),
      runtime.prisma.productImage.count({ where: { id: catalog.imageId } }),
      runtime.prisma.fileAsset.count({ where: { id: catalog.fileId } }),
      runtime.prisma.product.count({ where: { id: catalog.productId } }),
      runtime.prisma.category.count({ where: { id: catalog.categoryId } }),
      runtime.prisma.brand.count({ where: { id: catalog.brandId } }),
      runtime.prisma.customerAddress.count({ where: { id: customer.addressId } }),
      runtime.prisma.customerProfile.count({ where: { id: customer.customerId } }),
      runtime.prisma.account.count({ where: { id: customer.accountId } }),
    ])).resolves.toEqual(Array.from({ length: 19 }, () => 0));
  }, 120_000);

  it('reads owned orders, closes by customer and timeout, and leaves no B9.3 facts after rollback', async () => {
    const catalog = createCatalogFixture();
    const owner = createCustomerFixture();
    const otherCustomer = createCustomerFixture();
    const created: CreatedOrderFacts[] = [];

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 5 });
      await seedCustomer(transaction, owner, `owner-${owner.customerId}`);
      await seedCustomer(transaction, otherCustomer, `other-${otherCustomer.customerId}`);

      const cancellable = await repository.createOrderInTransaction(
        transaction,
        buyNowInput(owner, catalog),
        createHooks(),
      );
      created.push({
        attributionCandidateId: cancellable.attribution.candidateId,
        orderId: cancellable.order.orderId,
        reservationId: cancellable.reservation.reservationId,
      });
      created.push(await seedPendingOrder(
        transaction,
        owner,
        catalog,
        new Date(Date.now() - 60 * 60 * 1_000),
      ));
      const cancelFacts = created[0];
      const timeoutFacts = created[1];
      if (!cancelFacts || !timeoutFacts) throw new TypeError('B9.3 rollback orders were not created');

      const listInput = {
        customerId: owner.customerId,
        displayGroup: 'ALL' as const,
        page: 1,
        pageSize: 20,
        sort: 'CREATED_DESC' as const,
      };
      const list = await repository.listOwnedOrdersInTransaction(transaction, listInput);
      expect(list.total).toBe(2);
      expect(list.items.map(({ order }) => order.orderId).sort())
        .toEqual(created.map(({ orderId }) => orderId).sort());
      expect(new Map(list.items.map(({ canCancel, order }) => [order.orderId, canCancel])))
        .toEqual(new Map([
          [cancelFacts.orderId, true],
          [timeoutFacts.orderId, false],
        ]));
      expect(list.items.flatMap(({ itemImages }) => itemImages))
        .toEqual(expect.arrayContaining([
          { objectKey: `public/${catalog.fileId}`, orderItemId: expect.any(String) },
        ]));

      const expectImagesHidden = async (): Promise<void> => {
        const hidden = await repository.listOwnedOrdersInTransaction(transaction, listInput);
        expect(hidden.items).toHaveLength(2);
        expect(hidden.items.flatMap(({ itemImages }) => itemImages)
          .every(({ objectKey }) => objectKey === null)).toBe(true);
      };
      await transaction.fileAsset.update({
        data: { object_key: `public/not-${catalog.fileId}` },
        where: { id: catalog.fileId },
      });
      await expectImagesHidden();
      await transaction.fileAsset.update({
        data: { object_key: `public/${catalog.fileId}`, status: 'REJECTED' },
        where: { id: catalog.fileId },
      });
      await expectImagesHidden();
      await transaction.fileAsset.update({
        data: { status: 'READY', visibility: 'PRIVATE' },
        where: { id: catalog.fileId },
      });
      await expectImagesHidden();
      await transaction.fileAsset.update({
        data: { purpose: 'BRAND_LOGO', visibility: 'PUBLIC' },
        where: { id: catalog.fileId },
      });
      await expectImagesHidden();
      await transaction.fileAsset.update({
        data: { purpose: 'PRODUCT_IMAGE' },
        where: { id: catalog.fileId },
      });

      await expect(repository.listOwnedOrdersInTransaction(transaction, {
        customerId: otherCustomer.customerId,
        displayGroup: 'ALL',
        page: 1,
        pageSize: 20,
        sort: 'CREATED_DESC',
      })).resolves.toEqual({ items: [], total: 0 });

      const detail = await repository.getOwnedOrderDetailInTransaction(transaction, {
        customerId: owner.customerId,
        orderId: cancelFacts.orderId,
      });
      expect(detail).toMatchObject({
        address: {
          city: 'Auckland',
          district: 'Central',
          phoneLast4: '2468',
          province: 'Auckland',
          recipientName: `B9 Order Recipient owner-${owner.customerId}`,
        },
        canCancel: true,
        closedAt: null,
        order: { customerId: owner.customerId, orderId: cancelFacts.orderId, version: 1 },
      });
      await expect(repository.getOwnedOrderDetailInTransaction(transaction, {
        customerId: otherCustomer.customerId,
        orderId: cancelFacts.orderId,
      })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

      const cancelled = await repository.cancelOwnedOrderInTransaction(transaction, {
        accountId: owner.accountId,
        customerId: owner.customerId,
        expectedVersion: 1,
        orderId: cancelFacts.orderId,
      });
      expect(cancelled).toMatchObject({
        changed: true,
        order: {
          closeReason: 'USER_CANCELLED',
          fulfillmentStatus: 'NOT_STARTED',
          orderStatus: 'CLOSED',
          version: 2,
        },
        reservationId: cancelFacts.reservationId,
      });

      const expired = await repository.expireNextOrderInTransaction(transaction);
      expect(expired).toMatchObject({
        kind: 'closed',
        result: {
          changed: true,
          order: {
            closeReason: 'PAYMENT_TIMEOUT',
            fulfillmentStatus: 'NOT_STARTED',
            orderId: timeoutFacts.orderId,
            orderStatus: 'CLOSED',
            version: 2,
          },
          reservationId: timeoutFacts.reservationId,
        },
      });
      await expect(repository.expireNextOrderInTransaction(transaction)).resolves.toEqual({ kind: 'none' });

      await expect(transaction.inventoryReservation.findMany({
        orderBy: [{ id: 'asc' }],
        where: { id: { in: created.map(({ reservationId }) => reservationId) } },
      })).resolves.toMatchObject([
        expect.objectContaining({ released_at: expect.any(Date), status: expect.any(String) }),
        expect.objectContaining({ released_at: expect.any(Date), status: expect.any(String) }),
      ]);
      const reservations = await transaction.inventoryReservation.findMany({
        where: { id: { in: created.map(({ reservationId }) => reservationId) } },
      });
      expect(new Map(reservations.map(({ id, status }) => [id, status]))).toEqual(new Map([
        [cancelFacts.reservationId, 'RELEASED'],
        [timeoutFacts.reservationId, 'EXPIRED'],
      ]));

      const releases = await transaction.inventoryLedger.findMany({
        orderBy: [{ business_id: 'asc' }, { sku_id: 'asc' }],
        where: {
          business_id: { in: created.map(({ reservationId }) => reservationId) },
          ledger_type: 'ORDER_RELEASE',
        },
      });
      expect(releases).toHaveLength(2);
      for (const facts of created) {
        expect(releases.filter(({ business_id, sku_id }) =>
          business_id === facts.reservationId && sku_id === catalog.skuId)).toHaveLength(1);
      }
      expect(releases).toEqual(expect.arrayContaining([
        expect.objectContaining({
          actor_account_id: owner.accountId,
          locked_change: -1,
          physical_change: 0,
          reason: 'USER_CANCELLED',
        }),
        expect.objectContaining({
          actor_account_id: null,
          locked_change: -1,
          physical_change: 0,
          reason: 'PAYMENT_TIMEOUT',
        }),
      ]));
      const balance = await transaction.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
      expect(balance).toMatchObject({ locked_qty: 0, physical_qty: 5 });
      expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
      expect(balance.locked_qty).toBeGreaterThanOrEqual(0);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    expect(created).toHaveLength(2);
    await expect(Promise.all([
      runtime.prisma.salesOrder.count({ where: { id: { in: created.map(({ orderId }) => orderId) } } }),
      runtime.prisma.orderItem.count({ where: { order_id: { in: created.map(({ orderId }) => orderId) } } }),
      runtime.prisma.orderAddressSnapshot.count({
        where: { order_id: { in: created.map(({ orderId }) => orderId) } },
      }),
      runtime.prisma.orderAttributionCandidate.count({
        where: { id: { in: created.map(({ attributionCandidateId }) => attributionCandidateId) } },
      }),
      runtime.prisma.inventoryReservation.count({
        where: { id: { in: created.map(({ reservationId }) => reservationId) } },
      }),
      runtime.prisma.inventoryReservationItem.count({
        where: { reservation_id: { in: created.map(({ reservationId }) => reservationId) } },
      }),
      runtime.prisma.inventoryLedger.count({
        where: { business_id: { in: created.map(({ reservationId }) => reservationId) } },
      }),
      runtime.prisma.inventoryBalance.count({ where: { id: catalog.balanceId } }),
      runtime.prisma.sku.count({ where: { id: catalog.skuId } }),
      runtime.prisma.productImage.count({ where: { id: catalog.imageId } }),
      runtime.prisma.fileAsset.count({ where: { id: catalog.fileId } }),
      runtime.prisma.product.count({ where: { id: catalog.productId } }),
      runtime.prisma.category.count({ where: { id: catalog.categoryId } }),
      runtime.prisma.brand.count({ where: { id: catalog.brandId } }),
      runtime.prisma.customerAddress.count({
        where: { id: { in: [owner.addressId, otherCustomer.addressId] } },
      }),
      runtime.prisma.customerProfile.count({
        where: { id: { in: [owner.customerId, otherCustomer.customerId] } },
      }),
      runtime.prisma.account.count({ where: { id: { in: [owner.accountId, otherCustomer.accountId] } } }),
    ])).resolves.toEqual(Array.from({ length: 17 }, () => 0));
  }, 120_000);

  it('alerts on aggregate reservation corruption and leaves timeout facts untouched after rollback', async () => {
    const catalog = createCatalogFixture();
    const customer = createCustomerFixture();
    const created: CreatedOrderFacts[] = [];

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 5 });
      await seedCustomer(transaction, customer, `integrity-${customer.customerId}`);
      const cancellable = await repository.createOrderInTransaction(
        transaction,
        buyNowInput(customer, catalog),
        createHooks(),
      );
      created.push({
        attributionCandidateId: cancellable.attribution.candidateId,
        orderId: cancellable.order.orderId,
        reservationId: cancellable.reservation.reservationId,
      });
      created.push(await seedPendingOrder(
        transaction,
        customer,
        catalog,
        new Date('2001-01-01T00:00:01.000Z'),
      ));

      const overLockedBalance = await transaction.inventoryBalance.update({
        data: { locked_qty: 3, version: { increment: 1 } },
        where: { id: catalog.balanceId },
      });
      expect(overLockedBalance).toMatchObject({ locked_qty: 3, physical_qty: 5, version: 4 });

      const overLockedIssues = await repository.listExpiredOrderIntegrityIssues(transaction, { limit: 100 });
      expect(overLockedIssues.filter(({ orderId }) => created.some((facts) => facts.orderId === orderId)))
        .toEqual([expect.objectContaining({
          issue: 'INVENTORY_BALANCE_INVALID',
          orderId: created[1]!.orderId,
        })]);

      await expect(repository.cancelOwnedOrderInTransaction(transaction, {
        accountId: customer.accountId,
        customerId: customer.customerId,
        expectedVersion: 1,
        orderId: created[0]!.orderId,
      })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

      const underLockedBalance = await transaction.inventoryBalance.update({
        data: { locked_qty: 1, version: { increment: 1 } },
        where: { id: catalog.balanceId },
      });
      expect(underLockedBalance).toMatchObject({ locked_qty: 1, physical_qty: 5, version: 5 });
      const underLockedIssues = await repository.listExpiredOrderIntegrityIssues(transaction, { limit: 100 });
      expect(underLockedIssues.filter(({ orderId }) => created.some((facts) => facts.orderId === orderId)))
        .toEqual([expect.objectContaining({
          issue: 'INVENTORY_BALANCE_INVALID',
          orderId: created[1]!.orderId,
        })]);

      await expect(repository.expireNextOrderInTransaction(transaction)).resolves.toEqual({ kind: 'none' });
      const orders = await transaction.salesOrder.findMany({
        where: { id: { in: created.map(({ orderId }) => orderId) } },
      });
      expect(new Map(orders.map((order) => [order.id, {
        closeReason: order.close_reason,
        status: order.order_status,
        version: order.version,
      }]))).toEqual(new Map(created.map(({ orderId }) => [orderId, {
        closeReason: null,
        status: 'PENDING_PAYMENT',
        version: 1,
      }])));
      const reservations = await transaction.inventoryReservation.findMany({
        where: { id: { in: created.map(({ reservationId }) => reservationId) } },
      });
      expect(new Map(reservations.map((reservation) => [reservation.id, {
        releasedAt: reservation.released_at,
        status: reservation.status,
      }]))).toEqual(new Map(created.map(({ reservationId }) => [reservationId, {
        releasedAt: null,
        status: 'ACTIVE',
      }])));
      await expect(transaction.inventoryLedger.count({
        where: {
          business_id: { in: created.map(({ reservationId }) => reservationId) },
          ledger_type: 'ORDER_RELEASE',
        },
      })).resolves.toBe(0);
      await expect(transaction.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } }))
        .resolves.toMatchObject({ locked_qty: 1, physical_qty: 5, version: 5 });
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);

    expect(created).toHaveLength(2);
    await expect(Promise.all([
      runtime.prisma.salesOrder.count({ where: { id: { in: created.map(({ orderId }) => orderId) } } }),
      runtime.prisma.orderItem.count({ where: { order_id: { in: created.map(({ orderId }) => orderId) } } }),
      runtime.prisma.orderAddressSnapshot.count({
        where: { order_id: { in: created.map(({ orderId }) => orderId) } },
      }),
      runtime.prisma.orderAttributionCandidate.count({
        where: { id: { in: created.map(({ attributionCandidateId }) => attributionCandidateId) } },
      }),
      runtime.prisma.inventoryReservation.count({
        where: { id: { in: created.map(({ reservationId }) => reservationId) } },
      }),
      runtime.prisma.inventoryReservationItem.count({
        where: { reservation_id: { in: created.map(({ reservationId }) => reservationId) } },
      }),
      runtime.prisma.inventoryLedger.count({
        where: { business_id: { in: created.map(({ reservationId }) => reservationId) } },
      }),
      runtime.prisma.inventoryBalance.count({ where: { id: catalog.balanceId } }),
      runtime.prisma.sku.count({ where: { id: catalog.skuId } }),
      runtime.prisma.productImage.count({ where: { id: catalog.imageId } }),
      runtime.prisma.fileAsset.count({ where: { id: catalog.fileId } }),
      runtime.prisma.product.count({ where: { id: catalog.productId } }),
      runtime.prisma.category.count({ where: { id: catalog.categoryId } }),
      runtime.prisma.brand.count({ where: { id: catalog.brandId } }),
      runtime.prisma.customerAddress.count({ where: { id: customer.addressId } }),
      runtime.prisma.customerProfile.count({ where: { id: customer.customerId } }),
      runtime.prisma.account.count({ where: { id: customer.accountId } }),
    ])).resolves.toEqual(Array.from({ length: 17 }, () => 0));
  }, 120_000);

  fullIt('fails closed for every payment intent status in customer cancellation and timeout claiming', async () => {
    const catalog = createCatalogFixture();
    const created: Array<{
      cancelIntentId: string;
      cancelOrderId: string;
      cancelReservationId: string;
      customer: CustomerFixture;
      status: (typeof PAYMENT_INTENT_STATUSES)[number];
      timeoutIntentId: string;
      timeoutOrderId: string;
      timeoutReservationId: string;
    }> = [];
    await runtime.withPrismaTransaction(
      (transaction) => seedCatalog(transaction, catalog, { physicalQty: 40 }),
      transactionOptions,
    );

    for (const status of PAYMENT_INTENT_STATUSES) {
      const customer = createCustomerFixture();
      const facts = await runtime.withPrismaTransaction(async (transaction) => {
        await seedCustomer(transaction, customer, `${status}-${customer.customerId}`);
        const cancellable = await repository.createOrderInTransaction(
          transaction,
          buyNowInput(customer, catalog),
          createHooks(),
        );
        const expiredCreatedAt = new Date(Date.now() - 60 * 60 * 1_000);
        const expired = await seedPendingOrder(transaction, customer, catalog, expiredCreatedAt);
        const cancelIntentId = generateUlid();
        const timeoutIntentId = generateUlid();
        await transaction.paymentIntent.createMany({
          data: [{
            amount: '12.50',
            create_requested_at: cancellable.order.serverTime,
            expires_at: new Date(cancellable.order.serverTime.getTime() + 60 * 60 * 1_000),
            id: cancelIntentId,
            intent_no: `B9PI${cancelIntentId}`,
            order_id: cancellable.order.orderId,
            provider: 'MOCK',
            status,
            updated_at: cancellable.order.serverTime,
            version: 1,
          }, {
            amount: '12.50',
            create_requested_at: expiredCreatedAt,
            expires_at: new Date(expiredCreatedAt.getTime() + 60 * 60 * 1_000),
            id: timeoutIntentId,
            intent_no: `B9PI${timeoutIntentId}`,
            order_id: expired.orderId,
            provider: 'MOCK',
            status,
            updated_at: expiredCreatedAt,
            version: 1,
          }],
        });
        return {
          cancelIntentId,
          cancelOrderId: cancellable.order.orderId,
          cancelReservationId: cancellable.reservation.reservationId,
          customer,
          status,
          timeoutIntentId,
          timeoutOrderId: expired.orderId,
          timeoutReservationId: expired.reservationId,
        };
      }, transactionOptions);
      created.push(facts);

      await expect(runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
        repository.cancelOwnedOrderInTransaction(transaction, {
          accountId: customer.accountId,
          customerId: customer.customerId,
          expectedVersion: 1,
          orderId: facts.cancelOrderId,
        }))).rejects.toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
      await expect(runSerializableWithoutDeadlockRetry(
        runtime,
        (transaction) => repository.expireNextOrderInTransaction(transaction),
      )).resolves.toEqual({ kind: 'none' });
    }

    for (const facts of created) {
      for (const [intentId, orderId, reservationId] of [
        [facts.cancelIntentId, facts.cancelOrderId, facts.cancelReservationId],
        [facts.timeoutIntentId, facts.timeoutOrderId, facts.timeoutReservationId],
      ] as const) {
        await expect(runtime.prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } }))
          .resolves.toMatchObject({ order_id: orderId, status: facts.status });
        await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } }))
          .resolves.toMatchObject({ close_reason: null, order_status: 'PENDING_PAYMENT', version: 1 });
        await expect(runtime.prisma.inventoryReservation.findUniqueOrThrow({ where: { id: reservationId } }))
          .resolves.toMatchObject({ released_at: null, status: 'ACTIVE' });
      }
    }
    const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
    expect(balance).toMatchObject({ locked_qty: PAYMENT_INTENT_STATUSES.length * 2, physical_qty: 40 });
    expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
    expect(balance.locked_qty).toBeGreaterThanOrEqual(0);
    await expect(runtime.prisma.inventoryLedger.count({
      where: {
        business_id: {
          in: created.flatMap(({ cancelReservationId, timeoutReservationId }) =>
            [cancelReservationId, timeoutReservationId]),
        },
        ledger_type: 'ORDER_RELEASE',
      },
    })).resolves.toBe(0);
  }, 120_000);

  fullIt('allows exactly one close while cancellation races multiple timeout workers', async () => {
    const catalog = createCatalogFixture();
    const customer = createCustomerFixture();
    const expiresAt = new Date(Date.now() + 5_000);
    const createdAt = new Date(expiresAt.getTime() - 30 * 60 * 1_000);
    const facts = await runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 5 });
      await seedCustomer(transaction, customer, customer.customerId);
      return seedPendingOrder(transaction, customer, catalog, createdAt);
    }, transactionOptions);

    let cancelAttemptCount = 0;
    let resolveCancelReady: () => void = () => undefined;
    const cancelReady = new Promise<void>((resolve) => {
      resolveCancelReady = resolve;
    });
    let releaseCancel: () => void = () => undefined;
    const cancelGate = new Promise<void>((resolve) => {
      releaseCancel = resolve;
    });
    const cancelPromise = runSerializableWithoutDeadlockRetry(runtime, async (transaction) => {
      cancelAttemptCount += 1;
      if (cancelAttemptCount === 1) {
        const clocks = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(Prisma.sql`
          SELECT transaction_timestamp() AS transaction_time
        `);
        const transactionTime = clocks[0]?.transaction_time;
        resolveCancelReady();
        expect(transactionTime).toBeInstanceOf(Date);
        expect(transactionTime?.getTime()).toBeLessThan(expiresAt.getTime());
        await cancelGate;
      }
      return repository.cancelOwnedOrderInTransaction(transaction, {
        accountId: customer.accountId,
        customerId: customer.customerId,
        expectedVersion: 1,
        orderId: facts.orderId,
      });
    });
    await Promise.race([
      cancelReady,
      cancelPromise.then(() => undefined, () => undefined),
    ]);
    await wait(Math.max(expiresAt.getTime() - Date.now() + 100, 25));

    const workerPromises = Array.from({ length: 4 }, () => runSerializableWithoutDeadlockRetry(
      runtime,
      (transaction) => repository.expireNextOrderInTransaction(transaction),
    ));
    const cancelAttemptPromise = Promise.allSettled([cancelPromise]);
    const workerAttemptsPromise = Promise.allSettled(workerPromises);
    releaseCancel();
    const [[cancelAttempt], workerAttempts] = await Promise.all([
      cancelAttemptPromise,
      workerAttemptsPromise,
    ]);
    if (!cancelAttempt) throw new TypeError('B9.3 cancellation race did not settle');
    expect([cancelAttempt, ...workerAttempts].some((attempt) =>
      attempt.status === 'rejected' && hasPostgresCode(attempt.reason, '40P01'))).toBe(false);
    expect(workerAttempts.every(({ status }) => status === 'fulfilled')).toBe(true);
    if (cancelAttempt.status === 'rejected') {
      expect(cancelAttempt.reason).toMatchObject({ code: 'ORDER_NOT_CANCELLABLE' });
    }
    const cancellationWins = cancelAttempt.status === 'fulfilled' && cancelAttempt.value.changed ? 1 : 0;
    const timeoutWins = workerAttempts.filter((attempt) =>
      attempt.status === 'fulfilled' && attempt.value.kind === 'closed').length;
    expect(cancellationWins + timeoutWins).toBe(1);

    const order = await runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: facts.orderId } });
    expect(order).toMatchObject({
      fulfillment_status: 'NOT_STARTED',
      order_status: 'CLOSED',
      version: 2,
    });
    expect(['PAYMENT_TIMEOUT', 'USER_CANCELLED']).toContain(order.close_reason);
    const reservation = await runtime.prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: facts.reservationId },
    });
    expect(reservation).toMatchObject({
      status: order.close_reason === 'USER_CANCELLED' ? 'RELEASED' : 'EXPIRED',
    });
    expect(reservation.released_at).toBeInstanceOf(Date);

    const releases = await runtime.prisma.inventoryLedger.findMany({
      where: {
        business_id: facts.reservationId,
        ledger_type: 'ORDER_RELEASE',
        sku_id: catalog.skuId,
      },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({
      actor_account_id: order.close_reason === 'USER_CANCELLED' ? customer.accountId : null,
      locked_after: 0,
      locked_change: -1,
      physical_after: 5,
      physical_change: 0,
      reason: order.close_reason,
    });
    const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
    expect(balance).toMatchObject({ locked_qty: 0, physical_qty: 5, version: 3 });
    expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
    expect(balance.locked_qty).toBeGreaterThanOrEqual(0);

    const repeatWorkers = await Promise.allSettled(Array.from({ length: 4 }, () =>
      runSerializableWithoutDeadlockRetry(
        runtime,
        (transaction) => repository.expireNextOrderInTransaction(transaction),
      )));
    expect(repeatWorkers.some((attempt) =>
      attempt.status === 'rejected' && hasPostgresCode(attempt.reason, '40P01'))).toBe(false);
    expect(repeatWorkers.every((attempt) =>
      attempt.status === 'fulfilled' && attempt.value.kind === 'none')).toBe(true);
    await expect(runtime.prisma.inventoryLedger.count({
      where: {
        business_id: facts.reservationId,
        ledger_type: 'ORDER_RELEASE',
        sku_id: catalog.skuId,
      },
    })).resolves.toBe(1);
  }, 120_000);

  fullIt('converges without deadlock when order cancellation races an inventory adjustment', async () => {
    const catalog = createCatalogFixture();
    const customer = createCustomerFixture();
    const facts = await runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 5 });
      await seedCustomer(transaction, customer, customer.customerId);
      const created = await repository.createOrderInTransaction(
        transaction,
        buyNowInput(customer, catalog),
        createHooks(),
      );
      return {
        orderId: created.order.orderId,
        reservationId: created.reservation.reservationId,
      };
    }, transactionOptions);
    const inventory = new InventoryRepository(runtime.prisma);
    const adjustmentLedgerId = generateUlid();

    const attempts = await Promise.allSettled([
      runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
        repository.cancelOwnedOrderInTransaction(transaction, {
          accountId: customer.accountId,
          customerId: customer.customerId,
          expectedVersion: 1,
          orderId: facts.orderId,
        })),
      runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
        inventory.applyAdjustmentInTransaction(transaction, {
          actorId: customer.accountId,
          expectedVersion: 2,
          ledgerId: adjustmentLedgerId,
          physicalDelta: 1,
          reason: 'B9 close concurrency integration adjustment',
          skuId: catalog.skuId,
        })),
    ]);
    expect(attempts.some(({ status, ...attempt }) =>
      status === 'rejected' && hasPostgresCode(attempt.reason, '40P01'))).toBe(false);
    expect(attempts[0]).toMatchObject({ status: 'fulfilled', value: { changed: true } });
    if (attempts[1]?.status === 'rejected') {
      expect(attempts[1].reason).toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    }
    const adjustmentSucceeded = attempts[1]?.status === 'fulfilled';

    await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: facts.orderId } }))
      .resolves.toMatchObject({
        close_reason: 'USER_CANCELLED',
        fulfillment_status: 'NOT_STARTED',
        order_status: 'CLOSED',
        version: 2,
      });
    await expect(runtime.prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: facts.reservationId },
    })).resolves.toMatchObject({ released_at: expect.any(Date), status: 'RELEASED' });
    const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
    expect(balance).toMatchObject({
      locked_qty: 0,
      physical_qty: adjustmentSucceeded ? 6 : 5,
      version: adjustmentSucceeded ? 4 : 3,
    });
    expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
    expect(balance.locked_qty).toBeGreaterThanOrEqual(0);
    await expect(runtime.prisma.inventoryLedger.count({
      where: {
        business_id: facts.reservationId,
        ledger_type: 'ORDER_RELEASE',
        sku_id: catalog.skuId,
      },
    })).resolves.toBe(1);
    await expect(runtime.prisma.inventoryLedger.count({
      where: { id: adjustmentLedgerId, ledger_type: 'MANUAL_INCREASE', sku_id: catalog.skuId },
    })).resolves.toBe(adjustmentSucceeded ? 1 : 0);
  }, 120_000);

  fullIt('converges without deadlock when order cancellation races Product and SKU deactivation', async () => {
    for (const targetType of ['PRODUCT', 'SKU'] as const) {
      const catalog = createCatalogFixture();
      const customer = createCustomerFixture();
      const facts = await runtime.withPrismaTransaction(async (transaction) => {
        await seedCatalog(transaction, catalog, { physicalQty: 5 });
        await seedCustomer(transaction, customer, `${targetType}-${customer.customerId}`);
        const created = await repository.createOrderInTransaction(
          transaction,
          buyNowInput(customer, catalog),
          createHooks(),
        );
        return {
          orderId: created.order.orderId,
          reservationId: created.reservation.reservationId,
        };
      }, transactionOptions);
      const products = new ProductCatalogRepository(runtime.prisma);
      const targetId = targetType === 'PRODUCT' ? catalog.productId : catalog.skuId;

      const attempts = await Promise.allSettled([
        runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
          repository.cancelOwnedOrderInTransaction(transaction, {
            accountId: customer.accountId,
            customerId: customer.customerId,
            expectedVersion: 1,
            orderId: facts.orderId,
          })),
        runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
          products.applyLifecycleInTransaction(transaction, {
            action: 'DEACTIVATE',
            expectedVersion: 1,
            targetId,
            targetType,
          })),
      ]);
      expect(attempts.some(({ status, ...attempt }) =>
        status === 'rejected' && hasPostgresCode(attempt.reason, '40P01'))).toBe(false);
      expect(attempts).toMatchObject([
        { status: 'fulfilled', value: { changed: true } },
        { status: 'fulfilled' },
      ]);

      await expect(runtime.prisma.salesOrder.findUniqueOrThrow({ where: { id: facts.orderId } }))
        .resolves.toMatchObject({
          close_reason: 'USER_CANCELLED',
          fulfillment_status: 'NOT_STARTED',
          order_status: 'CLOSED',
          version: 2,
        });
      await expect(runtime.prisma.inventoryReservation.findUniqueOrThrow({
        where: { id: facts.reservationId },
      })).resolves.toMatchObject({ released_at: expect.any(Date), status: 'RELEASED' });
      const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({
        where: { id: catalog.balanceId },
      });
      expect(balance).toMatchObject({ locked_qty: 0, physical_qty: 5, version: 3 });
      expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
      expect(balance.locked_qty).toBeGreaterThanOrEqual(0);
      await expect(targetType === 'PRODUCT'
        ? runtime.prisma.product.findUniqueOrThrow({ where: { id: targetId } })
        : runtime.prisma.sku.findUniqueOrThrow({ where: { id: targetId } }))
        .resolves.toMatchObject({ status: 'INACTIVE', version: 2 });
      await expect(runtime.prisma.inventoryLedger.count({
        where: {
          business_id: facts.reservationId,
          ledger_type: 'ORDER_RELEASE',
          sku_id: catalog.skuId,
        },
      })).resolves.toBe(1);
    }
  }, 120_000);

  fullIt('allows at most one order to reserve the same final unit and preserves the balance invariant', async () => {
    const catalog = createCatalogFixture();
    const customers = [createCustomerFixture(), createCustomerFixture()];
    await runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 1 });
      for (const customer of customers) await seedCustomer(transaction, customer, customer.customerId);
    }, transactionOptions);

    const attempts = await Promise.allSettled(customers.map((customer) =>
      runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
        repository.createOrderInTransaction(transaction, buyNowInput(customer, catalog), createHooks()))));
    const fulfilled = attempts.filter((attempt) => attempt.status === 'fulfilled');
    const rejected = attempts.filter((attempt) => attempt.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ reason: { code: 'CHECKOUT_REQUOTE_REQUIRED' } });

    const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
    expect(balance).toMatchObject({ locked_qty: 1, physical_qty: 1, version: 2 });
    expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
    expect(balance.locked_qty).toBeGreaterThanOrEqual(0);
    await expect(runtime.prisma.salesOrder.count({
      where: { customer_id: { in: customers.map(({ customerId }) => customerId) } },
    })).resolves.toBe(1);
    await expect(runtime.prisma.inventoryReservation.count({
      where: { order: { customer_id: { in: customers.map(({ customerId }) => customerId) } }, status: 'ACTIVE' },
    })).resolves.toBe(1);
    await expect(runtime.prisma.inventoryLedger.count({
      where: { ledger_type: 'ORDER_RESERVE', sku_id: catalog.skuId },
    })).resolves.toBe(1);
  }, 120_000);

  fullIt('does not deadlock with a concurrent inventory adjustment using the shared hierarchy lock order', async () => {
    const catalog = createCatalogFixture();
    const customer = createCustomerFixture();
    await runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 5 });
      await seedCustomer(transaction, customer, customer.customerId);
    }, transactionOptions);
    const inventory = new InventoryRepository(runtime.prisma);

    const attempts = await Promise.allSettled([
      runSerializableWithoutDeadlockRetry(
        runtime,
        (transaction) => repository.createOrderInTransaction(
          transaction,
          buyNowInput(customer, catalog),
          createHooks(),
        ),
      ),
      runSerializableWithoutDeadlockRetry(
        runtime,
        (transaction) => inventory.applyAdjustmentInTransaction(transaction, {
          actorId: customer.accountId,
          expectedVersion: 1,
          ledgerId: generateUlid(),
          physicalDelta: 1,
          reason: 'B9 order concurrency integration adjustment',
          skuId: catalog.skuId,
        }),
      ),
    ]);
    expect(attempts.some(({ status, ...attempt }) =>
      status === 'rejected' && hasPostgresCode(attempt.reason, '40P01'))).toBe(false);
    expect(attempts[0]).toMatchObject({ status: 'fulfilled' });
    if (attempts[1]?.status === 'rejected') {
      expect(attempts[1].reason).toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    }

    const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
    expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
    expect(balance.locked_qty).toBeGreaterThanOrEqual(0);
    await expect(runtime.prisma.salesOrder.count({ where: { customer_id: customer.customerId } })).resolves.toBe(1);
    await expect(runtime.prisma.inventoryReservation.count({
      where: { order: { customer_id: customer.customerId }, status: 'ACTIVE' },
    })).resolves.toBe(1);
    await expect(runtime.prisma.inventoryLedger.count({
      where: { ledger_type: 'ORDER_RESERVE', sku_id: catalog.skuId },
    })).resolves.toBe(1);
  }, 120_000);

  fullIt('converges without deadlock when product deactivation races the final order check', async () => {
    const catalog = createCatalogFixture();
    const customer = createCustomerFixture();
    await runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 5 });
      await seedCustomer(transaction, customer, customer.customerId);
    }, transactionOptions);
    const products = new ProductCatalogRepository(runtime.prisma);

    const attempts = await Promise.allSettled([
      runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
        repository.createOrderInTransaction(transaction, buyNowInput(customer, catalog), createHooks())),
      runSerializableWithoutDeadlockRetry(runtime, (transaction) => products.applyLifecycleInTransaction(transaction, {
        action: 'DEACTIVATE',
        expectedVersion: 1,
        targetId: catalog.productId,
        targetType: 'PRODUCT',
      })),
    ]);

    expect(attempts.some(({ status, ...attempt }) =>
      status === 'rejected' && hasPostgresCode(attempt.reason, '40P01'))).toBe(false);
    expect(attempts[1]).toMatchObject({ status: 'fulfilled' });
    if (attempts[0]?.status === 'rejected') {
      expect(attempts[0].reason).toMatchObject({ code: 'CHECKOUT_REQUOTE_REQUIRED' });
    }
    const orderCount = await runtime.prisma.salesOrder.count({ where: { customer_id: customer.customerId } });
    const reservationCount = await runtime.prisma.inventoryReservation.count({
      where: { order: { customer_id: customer.customerId }, status: 'ACTIVE' },
    });
    const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
    await expect(runtime.prisma.product.findUniqueOrThrow({ where: { id: catalog.productId } }))
      .resolves.toMatchObject({ status: 'INACTIVE', version: 2 });
    expect(orderCount).toBe(attempts[0]?.status === 'fulfilled' ? 1 : 0);
    expect(reservationCount).toBe(orderCount);
    expect(balance.locked_qty).toBe(orderCount);
    expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
  }, 120_000);

  fullIt('converges without deadlock when SKU deactivation races the final order check', async () => {
    const catalog = createCatalogFixture();
    const customer = createCustomerFixture();
    await runtime.withPrismaTransaction(async (transaction) => {
      await seedCatalog(transaction, catalog, { physicalQty: 5 });
      await seedCustomer(transaction, customer, customer.customerId);
    }, transactionOptions);
    const products = new ProductCatalogRepository(runtime.prisma);

    const attempts = await Promise.allSettled([
      runSerializableWithoutDeadlockRetry(runtime, (transaction) =>
        repository.createOrderInTransaction(transaction, buyNowInput(customer, catalog), createHooks())),
      runSerializableWithoutDeadlockRetry(runtime, (transaction) => products.applyLifecycleInTransaction(transaction, {
        action: 'DEACTIVATE',
        expectedVersion: 1,
        targetId: catalog.skuId,
        targetType: 'SKU',
      })),
    ]);

    expect(attempts.some(({ status, ...attempt }) =>
      status === 'rejected' && hasPostgresCode(attempt.reason, '40P01'))).toBe(false);
    expect(attempts[1]).toMatchObject({ status: 'fulfilled' });
    if (attempts[0]?.status === 'rejected') {
      expect(attempts[0].reason).toMatchObject({ code: 'CHECKOUT_REQUOTE_REQUIRED' });
    }
    const orderCount = await runtime.prisma.salesOrder.count({ where: { customer_id: customer.customerId } });
    const reservationCount = await runtime.prisma.inventoryReservation.count({
      where: { order: { customer_id: customer.customerId }, status: 'ACTIVE' },
    });
    const balance = await runtime.prisma.inventoryBalance.findUniqueOrThrow({ where: { id: catalog.balanceId } });
    await expect(runtime.prisma.sku.findUniqueOrThrow({ where: { id: catalog.skuId } }))
      .resolves.toMatchObject({ status: 'INACTIVE', version: 2 });
    expect(orderCount).toBe(attempts[0]?.status === 'fulfilled' ? 1 : 0);
    expect(reservationCount).toBe(orderCount);
    expect(balance.locked_qty).toBe(orderCount);
    expect(balance.physical_qty).toBeGreaterThanOrEqual(balance.locked_qty);
  }, 120_000);
});
