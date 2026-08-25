import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { InventoryRepository } from './inventory.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

type IntegrationMode = 'full' | 'rollback';

const mode = process.env.B5_INVENTORY_DATABASE_TEST_MODE as IntegrationMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B5_INVENTORY_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackOptions = mode === 'rollback'
  ? { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 90_000 }
  : undefined;
const rollbackSentinel = Object.freeze({ code: 'B5_INVENTORY_DATABASE_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface CatalogFixture {
  actorId: string;
  balanceId: string;
  brandId: string;
  categoryId: string;
  marker: string;
  productId: string;
  skuId: string;
}

interface ReservationFixture {
  customerAccountId: string;
  customerId: string;
  itemId: string;
  orderId: string;
  reservationId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B5 Inventory database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B5 Inventory database tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B5 Inventory DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:b5|inventory|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B5 Inventory tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b5-inventory-database-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B5 Inventory database tests cannot use the ephemeral PostgreSQL capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b5-inventory-database-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

async function seedCatalog(
  transaction: DatabaseTransaction,
  options: {
    actorId?: string;
    lockedQty?: number;
    marker?: string;
    physicalQty?: number;
    productName?: string;
    skuStatus?: 'ACTIVE' | 'ARCHIVED' | 'INACTIVE';
  } = {},
): Promise<CatalogFixture> {
  const now = new Date();
  const fixture: CatalogFixture = {
    actorId: options.actorId ?? generateUlid(),
    balanceId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    marker: options.marker ?? generateUlid(),
    productId: generateUlid(),
    skuId: generateUlid(),
  };
  if (options.actorId === undefined) {
    await transaction.account.create({
      data: {
        created_at: now,
        id: fixture.actorId,
        login_name: `b5-inventory-${fixture.actorId}`,
        password_hash: `integration:${fixture.actorId}`,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: now,
      },
    });
  }
  await transaction.brand.create({
    data: {
      created_at: now,
      id: fixture.brandId,
      name: `B5 Inventory brand ${fixture.marker} ${fixture.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: fixture.categoryId,
      name: `B5 Inventory category ${fixture.marker} ${fixture.categoryId}`,
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
      name: options.productName ?? `B5 Inventory product ${fixture.marker}`,
      spu_code: `B5-SPU-${fixture.productId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  const skuStatus = options.skuStatus ?? 'ACTIVE';
  await transaction.sku.create({
    data: {
      code: `B5-SKU-${fixture.skuId}`,
      created_at: now,
      deleted_at: skuStatus === 'ARCHIVED' ? now : null,
      id: fixture.skuId,
      name: `B5 Inventory SKU ${fixture.marker}`,
      product_id: fixture.productId,
      retail_price: '8.80',
      status: skuStatus,
      updated_at: now,
    },
  });
  await transaction.inventoryBalance.create({
    data: {
      id: fixture.balanceId,
      locked_qty: options.lockedQty ?? 0,
      physical_qty: options.physicalQty ?? 10,
      sku_id: fixture.skuId,
      updated_at: now,
      version: 1,
    },
  });
  return fixture;
}

async function seedReservation(
  transaction: DatabaseTransaction,
  skuId: string,
  quantity: number,
  status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'RELEASED',
): Promise<ReservationFixture> {
  const now = new Date();
  const fixture: ReservationFixture = {
    customerAccountId: generateUlid(),
    customerId: generateUlid(),
    itemId: generateUlid(),
    orderId: generateUlid(),
    reservationId: generateUlid(),
  };
  await transaction.account.create({
    data: {
      created_at: now,
      id: fixture.customerAccountId,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.customerProfile.create({
    data: {
      account_id: fixture.customerAccountId,
      created_at: now,
      id: fixture.customerId,
      registered_at: now,
      updated_at: now,
    },
  });
  await transaction.salesOrder.create({
    data: {
      created_at: now,
      customer_id: fixture.customerId,
      goods_amount: '8.80',
      id: fixture.orderId,
      order_no: `B5${fixture.orderId}`,
      pay_expires_at: new Date(now.getTime() + 30 * 60_000),
      payable_amount: '8.80',
      source: 'CART',
      updated_at: now,
    },
  });
  await transaction.inventoryReservation.create({
    data: {
      created_at: now,
      expires_at: new Date(now.getTime() + 15 * 60_000),
      id: fixture.reservationId,
      order_id: fixture.orderId,
      status,
    },
  });
  await transaction.inventoryReservationItem.create({
    data: {
      created_at: now,
      id: fixture.itemId,
      quantity,
      reservation_id: fixture.reservationId,
      sku_id: skuId,
    },
  });
  return fixture;
}

integrationDescribe('B5.2 Inventory repository and PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;
  let repository: InventoryRepository;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
    repository = new InventoryRepository(runtime.prisma);
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  fullIt('projects stable inventory rows and reports ACTIVE reservations without double subtraction', async () => {
    const marker = generateUlid();
    const [second, first] = await runtime.withPrismaTransaction(async (transaction) => {
      const secondFixture = await seedCatalog(transaction, {
        marker,
        productName: `B ${marker}`,
      });
      const firstFixture = await seedCatalog(transaction, {
        lockedQty: 3,
        marker,
        physicalQty: 10,
        productName: `A ${marker}`,
      });
      await seedReservation(transaction, firstFixture.skuId, 3, 'ACTIVE');
      await seedReservation(transaction, firstFixture.skuId, 2, 'RELEASED');
      return [secondFixture, firstFixture] as const;
    });

    const result = await repository.listInventory({ keyword: marker, page: 1, pageSize: 20 });
    expect(result.total).toBe(2);
    expect(result.items.map(({ skuId }) => skuId)).toEqual([first.skuId, second.skuId]);
    expect(result.items[0]).toMatchObject({
      activeReservationQty: 3,
      availableQty: 7,
      lockedQty: 3,
      physicalQty: 10,
      productName: `A ${marker}`,
      version: 1,
    });
    await expect(repository.listInventory({
      categoryId: first.categoryId,
      page: 1,
      pageSize: 20,
    })).resolves.toMatchObject({ items: [{ skuId: first.skuId }], total: 1 });
  }, 60_000);

  fullIt('previews warnings and commits positive and negative changes with an append-only ledger', async () => {
    const fixture = await runtime.withPrismaTransaction(async (transaction) => {
      const seeded = await seedCatalog(transaction, { lockedQty: 3, physicalQty: 10 });
      await seedReservation(transaction, seeded.skuId, 3, 'ACTIVE');
      return seeded;
    });

    const warning = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.getAdjustmentImpactInTransaction(transaction, {
        physicalDelta: -8,
        skuId: fixture.skuId,
      }));
    expect(warning).toMatchObject({
      activeReservationQty: 3,
      availableAfter: -1,
      availableBefore: 7,
      physicalAfter: 2,
      physicalBefore: 10,
      warnings: ['STOCK_INSUFFICIENT'],
    });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyAdjustmentInTransaction(transaction, {
        actorId: fixture.actorId,
        expectedVersion: 1,
        ledgerId: generateUlid(),
        physicalDelta: -8,
        reason: 'Blocked below locked stock',
        skuId: fixture.skuId,
      }))).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT' });

    const increased = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyAdjustmentInTransaction(transaction, {
        actorId: fixture.actorId,
        expectedVersion: 1,
        ledgerId: generateUlid(),
        physicalDelta: 5,
        reason: 'Cycle count increase',
        skuId: fixture.skuId,
      }));
    expect(increased).toMatchObject({
      impact: { physicalAfter: 15, version: 2 },
      ledger: { physicalBefore: 10, physicalChange: 5, type: 'MANUAL_INCREASE' },
    });
    const decreased = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyAdjustmentInTransaction(transaction, {
        actorId: fixture.actorId,
        expectedVersion: 2,
        ledgerId: generateUlid(),
        physicalDelta: -4,
        reason: 'Cycle count decrease',
        skuId: fixture.skuId,
      }));
    expect(decreased).toMatchObject({
      impact: { physicalAfter: 11, version: 3 },
      ledger: { physicalBefore: 15, physicalChange: -4, type: 'MANUAL_DECREASE' },
    });

    const allLedger = await repository.listLedger({ page: 1, pageSize: 20, skuId: fixture.skuId });
    expect(allLedger.total).toBe(2);
    expect(new Set(allLedger.items.map(({ type }) => type))).toEqual(
      new Set(['MANUAL_INCREASE', 'MANUAL_DECREASE']),
    );
    const increases = await repository.listLedger({
      ledgerType: 'MANUAL_INCREASE',
      occurredAtFrom: new Date(Date.now() - 60_000),
      occurredAtToExclusive: new Date(Date.now() + 60_000),
      page: 1,
      pageSize: 20,
      skuId: fixture.skuId,
    });
    expect(increases).toMatchObject({ items: [{ physicalChange: 5, type: 'MANUAL_INCREASE' }], total: 1 });
    await expect(runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }))
      .resolves.toMatchObject({ locked_qty: 3, physical_qty: 11, version: 3 });
  }, 60_000);

  fullIt('rejects archived inventory, integer overflow, and concurrent stale versions', async () => {
    const [archived, maximum, concurrent] = await runtime.withPrismaTransaction(async (transaction) => [
      await seedCatalog(transaction, { skuStatus: 'ARCHIVED' }),
      await seedCatalog(transaction, { physicalQty: 2_147_483_647 }),
      await seedCatalog(transaction, { physicalQty: 10 }),
    ] as const);

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.getAdjustmentImpactInTransaction(transaction, { physicalDelta: 1, skuId: archived.skuId })))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.getAdjustmentImpactInTransaction(transaction, { physicalDelta: 1, skuId: maximum.skuId })))
      .rejects.toMatchObject({ code: 'INVENTORY_QUANTITY_OUT_OF_RANGE' });

    const attempts = await Promise.allSettled([1, 2].map((sequence) =>
      runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.applyAdjustmentInTransaction(transaction, {
          actorId: concurrent.actorId,
          expectedVersion: 1,
          ledgerId: generateUlid(),
          physicalDelta: sequence,
          reason: `Concurrent adjustment ${sequence}`,
          skuId: concurrent.skuId,
        }))));
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(attempts.find(({ status }) => status === 'rejected')).toMatchObject({
      reason: { code: 'RESOURCE_VERSION_CONFLICT' },
    });
    await expect(runtime.prisma.inventoryLedger.count({ where: { sku_id: concurrent.skuId } })).resolves.toBe(1);
  }, 60_000);

  rollbackIt('leaves no inventory or fixture facts after the rollback-only sentinel', async () => {
    let catalog: CatalogFixture | undefined;
    let reservation: ReservationFixture | undefined;
    let ledgerId: string | undefined;
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      catalog = await seedCatalog(transaction, { lockedQty: 2, physicalQty: 10 });
      reservation = await seedReservation(transaction, catalog.skuId, 2, 'ACTIVE');
      ledgerId = generateUlid();
      const transactionRepository = new InventoryRepository(transaction as unknown as PrismaClient);
      await transactionRepository.getAdjustmentImpactInTransaction(transaction, {
        physicalDelta: 2,
        skuId: catalog.skuId,
      });
      await transactionRepository.applyAdjustmentInTransaction(transaction, {
        actorId: catalog.actorId,
        expectedVersion: 1,
        ledgerId,
        physicalDelta: 2,
        reason: 'Rollback-only inventory adjustment',
        skuId: catalog.skuId,
      });
      throw rollbackSentinel;
    }, rollbackOptions)).rejects.toBe(rollbackSentinel);
    if (!catalog || !reservation || !ledgerId) {
      throw new TypeError('Rollback-only B5 Inventory fixture was not created');
    }
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { id: { in: [catalog.actorId, reservation.customerAccountId] } } }),
      runtime.prisma.brand.count({ where: { id: catalog.brandId } }),
      runtime.prisma.category.count({ where: { id: catalog.categoryId } }),
      runtime.prisma.product.count({ where: { id: catalog.productId } }),
      runtime.prisma.sku.count({ where: { id: catalog.skuId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: catalog.balanceId } }),
      runtime.prisma.inventoryReservation.count({ where: { id: reservation.reservationId } }),
      runtime.prisma.inventoryReservationItem.count({ where: { id: reservation.itemId } }),
      runtime.prisma.inventoryLedger.count({ where: { id: ledgerId } }),
      runtime.prisma.salesOrder.count({ where: { id: reservation.orderId } }),
      runtime.prisma.customerProfile.count({ where: { id: reservation.customerId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }, 120_000);
});
