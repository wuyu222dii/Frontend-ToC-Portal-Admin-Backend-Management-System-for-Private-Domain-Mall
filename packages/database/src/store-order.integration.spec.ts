import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
  return {
    balanceId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    fileId: generateUlid(),
    imageId: generateUlid(),
    productId: generateUlid(),
    skuId: generateUlid(),
  };
}

function createCustomerFixture(): CustomerFixture {
  return {
    accountId: generateUlid(),
    addressId: generateUlid(),
    customerId: generateUlid(),
  };
}

function createCartFixture(): CartFixture {
  return {
    cartId: generateUlid(),
    selectedItemId: generateUlid(),
    unselectedBalanceId: generateUlid(),
    unselectedItemId: generateUlid(),
    unselectedSkuId: generateUlid(),
  };
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

databaseDescribe('B9 Store order database integration', () => {
  let runtime: DatabaseRuntime;
  let repository: StoreOrderRepository;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
    repository = new StoreOrderRepository(runtime.prisma);
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

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
