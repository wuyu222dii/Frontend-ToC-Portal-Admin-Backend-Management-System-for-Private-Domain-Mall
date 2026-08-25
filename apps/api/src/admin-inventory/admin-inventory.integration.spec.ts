import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  acquireMasterDataHierarchyLocks,
  createDatabaseRuntime,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  type InventoryRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { AdminInventoryService } from './admin-inventory.service';

type IntegrationMode = 'full' | 'rollback';

const mode = process.env.B5_INVENTORY_API_TEST_MODE as IntegrationMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B5_INVENTORY_API_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackOptions = mode === 'rollback'
  ? { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 90_000 }
  : undefined;
const rollbackSentinel = Object.freeze({ code: 'B5_INVENTORY_API_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface InventoryFixture {
  accountId: string;
  balanceId: string;
  brandId: string;
  categoryId: string;
  customerAccountId?: string;
  customerId?: string;
  factorId: string;
  marker: string;
  orderId?: string;
  productId: string;
  reservationId?: string;
  reservationItemId?: string;
  sessionId: string;
  skuId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B5 Inventory API integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B5 Inventory API tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B5 Inventory API DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:b5|inventory|api|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B5 Inventory API tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b5-inventory-api-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B5 Inventory API tests cannot use the ephemeral PostgreSQL capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b5-inventory-api-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function config(): PlatformRuntimeConfig {
  return {
    authentication: {} as PlatformRuntimeConfig['authentication'],
    banner: { targetOrigins: [] },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      fieldKeys: { current: { id: 'b5-inventory-field', key: Buffer.alloc(32, 0x61) }, previous: [] },
      idempotencyHashKeys: {
        current: { id: 'b5-inventory-idempotency', key: Buffer.alloc(32, 0x62) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 0x63),
    },
    environment: 'test',
    port: 3000,
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

function requestContext(fixture: InventoryFixture): AdminCatalogRequestContext {
  const now = new Date();
  return {
    accessSession: {
      accountId: fixture.accountId,
      accountVersion: 1,
      accessJti: `access:${fixture.sessionId}`,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      factorEncryptionKeyId: 'b5-inventory-field',
      factorId: fixture.factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(32),
      mfaVerifiedAt: now,
      sessionFamily: fixture.sessionId,
      sessionId: fixture.sessionId,
    },
    principal: {
      accountId: fixture.accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: fixture.sessionId,
    },
    requestId: `req_${randomUUID().replaceAll('-', '')}`,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

async function seedFixture(
  transaction: DatabaseTransaction,
  options: {
    lockedQty?: number;
    physicalQty?: number;
    reservationQty?: number;
    skuStatus?: 'ACTIVE' | 'ARCHIVED' | 'INACTIVE';
  } = {},
): Promise<InventoryFixture> {
  const now = new Date();
  const fixture: InventoryFixture = {
    accountId: generateUlid(),
    balanceId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    factorId: generateUlid(),
    marker: generateUlid(),
    productId: generateUlid(),
    sessionId: generateUlid(),
    skuId: generateUlid(),
  };
  await transaction.account.create({
    data: {
      created_at: now,
      id: fixture.accountId,
      login_name: `b5-inventory-api-${fixture.accountId}`,
      password_hash: `integration:${fixture.accountId}`,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.totpFactor.create({
    data: {
      account_id: fixture.accountId,
      created_at: now,
      encryption_key_id: 'b5-inventory-field',
      id: fixture.factorId,
      label: 'B5 Inventory API integration',
      secret_ciphertext: Buffer.alloc(32, 0x64),
      secret_fingerprint: '6'.repeat(64),
      status: 'ACTIVE',
      updated_at: now,
      verified_at: now,
    },
  });
  await transaction.authSession.create({
    data: {
      access_jti: `access:${fixture.sessionId}`,
      account_id: fixture.accountId,
      assurance: 'MFA',
      created_at: now,
      expires_at: new Date(now.getTime() + 60 * 60_000),
      id: fixture.sessionId,
      mfa_factor_id: fixture.factorId,
      mfa_verified_at: now,
      refresh_token_hash: `refresh:${fixture.sessionId}`,
      restriction: 'NONE',
      session_family: generateUlid(),
    },
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      id: fixture.brandId,
      name: `B5 Inventory API brand ${fixture.marker}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: fixture.categoryId,
      name: `B5 Inventory API category ${fixture.marker}`,
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
      name: `B5 Inventory API product ${fixture.marker}`,
      spu_code: `B5-API-SPU-${fixture.productId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  const skuStatus = options.skuStatus ?? 'ACTIVE';
  await transaction.sku.create({
    data: {
      code: `B5-API-SKU-${fixture.skuId}`,
      created_at: now,
      deleted_at: skuStatus === 'ARCHIVED' ? now : null,
      id: fixture.skuId,
      name: `B5 Inventory API SKU ${fixture.marker}`,
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

  if (options.reservationQty !== undefined) {
    fixture.customerAccountId = generateUlid();
    fixture.customerId = generateUlid();
    fixture.orderId = generateUlid();
    fixture.reservationId = generateUlid();
    fixture.reservationItemId = generateUlid();
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
        status: 'ACTIVE',
      },
    });
    await transaction.inventoryReservationItem.create({
      data: {
        created_at: now,
        id: fixture.reservationItemId,
        quantity: options.reservationQty,
        reservation_id: fixture.reservationId,
        sku_id: fixture.skuId,
      },
    });
  }
  return fixture;
}

function transactionBoundRuntime(runtime: DatabaseRuntime, transaction: DatabaseTransaction): DatabaseRuntime {
  const prisma = {
    $transaction: async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction),
  } as unknown as DatabaseRuntime['prisma'];
  return { ...runtime, prisma };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function preview(
  service: AdminInventoryService,
  fixture: InventoryFixture,
  physicalDelta: number,
  reason: string,
) {
  return service.previewAdjustment(
    requestContext(fixture), fixture.skuId, { physicalDelta, reason }, randomUUID(),
  );
}

integrationDescribe('B5.2 Inventory service and PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;
  let service: AdminInventoryService;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
    service = new AdminInventoryService(config(), runtime);
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  fullIt('executes preview and adjustment with exact replay, ledger, audit and outbox atomicity', async () => {
    const fixture = await runtime.withPrismaTransaction((transaction) => seedFixture(transaction, {
      lockedQty: 3,
      physicalQty: 10,
      reservationQty: 3,
    }));
    const listed = await service.listInventory({ keyword: fixture.marker, page: 1, pageSize: 20 });
    expect(listed).toMatchObject({
      items: [{
        active_reservation_qty: 3,
        available_qty: 7,
        locked_qty: 3,
        physical_qty: 10,
        sku_id: fixture.skuId,
        version: 1,
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    });

    const blockedReason = 'Do not reduce below locked stock';
    const blocked = await preview(service, fixture, -8, blockedReason);
    expect(blocked.impact).toMatchObject({
      available_after: -1,
      available_before: 7,
      physical_after: 2,
      physical_before: 10,
      warnings: ['STOCK_INSUFFICIENT'],
    });
    const blockedRecord = await runtime.prisma.highRiskOperationPreview.findFirstOrThrow({
      where: { confirmation_hash: blocked.confirmation_hash, target_id: fixture.skuId },
    });
    const blockedConfirmKey = randomUUID();
    await expect(service.confirmAdjustment(requestContext(fixture), fixture.skuId, {
      confirmationHash: blocked.confirmation_hash,
      physicalDelta: -8,
      previewToken: blocked.preview_token,
      reason: blockedReason,
    }, 1, blockedConfirmKey)).rejects.toMatchObject({ code: 'STOCK_INSUFFICIENT', httpStatus: 422 });
    await expect(Promise.all([
      runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }),
      runtime.prisma.highRiskOperationPreview.findUnique({ where: { id: blockedRecord.id } }),
      runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: blockedConfirmKey } }),
      runtime.prisma.auditLog.count({ where: { idempotency_key: blockedConfirmKey } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: fixture.skuId } }),
    ])).resolves.toEqual([
      expect.objectContaining({ physical_qty: 10, version: 1 }),
      expect.objectContaining({ consumed_at: null }),
      0,
      0,
      0,
    ]);

    const increaseReason = 'Cycle count increase';
    const increasePreview = await preview(service, fixture, 5, increaseReason);
    const increaseKey = randomUUID();
    const increased = await service.confirmAdjustment(requestContext(fixture), fixture.skuId, {
      confirmationHash: increasePreview.confirmation_hash,
      physicalDelta: 5,
      previewToken: increasePreview.preview_token,
      reason: increaseReason,
    }, 1, increaseKey);
    expect(increased.envelope.data).toMatchObject({
      resource_id: fixture.skuId,
      resource_type: 'inventory',
      status: 'SUCCEEDED',
      version: 2,
    });
    const replayed = await service.confirmAdjustment(requestContext(fixture), fixture.skuId, {
      confirmationHash: increasePreview.confirmation_hash,
      physicalDelta: 5,
      previewToken: increasePreview.preview_token,
      reason: increaseReason,
    }, 1, increaseKey);
    expect(replayed.envelope).toEqual(increased.envelope);

    const decreaseReason = 'Cycle count decrease';
    const decreasePreview = await preview(service, fixture, -4, decreaseReason);
    const decreaseKey = randomUUID();
    await expect(service.confirmAdjustment(requestContext(fixture), fixture.skuId, {
      confirmationHash: decreasePreview.confirmation_hash,
      physicalDelta: -4,
      previewToken: decreasePreview.preview_token,
      reason: decreaseReason,
    }, 2, decreaseKey)).resolves.toMatchObject({ envelope: { data: { version: 3 } } });

    const ledger = await service.listLedger(fixture.skuId, {
      occurredAtFrom: new Date(Date.now() - 60_000),
      occurredAtToExclusive: new Date(Date.now() + 60_000),
      page: 1,
      pageSize: 20,
    });
    expect(ledger.pagination.total).toBe(2);
    expect(new Set(ledger.items.map(({ ledger_type: type }) => type))).toEqual(
      new Set(['MANUAL_INCREASE', 'MANUAL_DECREASE']),
    );
    expect(ledger.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ physical_before: 10, physical_change: 5, reason: increaseReason }),
      expect.objectContaining({ physical_before: 15, physical_change: -4, reason: decreaseReason }),
    ]));
    await expect(Promise.all([
      runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }),
      runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      runtime.prisma.auditLog.count({ where: { idempotency_key: { in: [increaseKey, decreaseKey] } } }),
      runtime.prisma.outboxEvent.count({
        where: { aggregate_id: fixture.skuId, event_type: 'inventory.adjusted' },
      }),
      runtime.prisma.idempotencyRecord.count({
        where: { idempotency_key: { in: [increaseKey, decreaseKey] } },
      }),
    ])).resolves.toEqual([
      expect.objectContaining({ locked_qty: 3, physical_qty: 11, version: 3 }),
      2,
      2,
      2,
      2,
    ]);
  }, 90_000);

  fullIt('rejects archived inventory and PostgreSQL integer overflow during preview', async () => {
    const [archived, maximum] = await runtime.withPrismaTransaction(async (transaction) => [
      await seedFixture(transaction, { skuStatus: 'ARCHIVED' }),
      await seedFixture(transaction, { physicalQty: 2_147_483_647 }),
    ] as const);
    await expect(preview(service, archived, 1, 'Archived inventory adjustment'))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });
    await expect(preview(service, maximum, 1, 'Overflow inventory adjustment'))
      .rejects.toMatchObject({ code: 'INVENTORY_QUANTITY_OUT_OF_RANGE', httpStatus: 422 });
    await expect(Promise.all([
      runtime.prisma.highRiskOperationPreview.count({
        where: { target_id: { in: [archived.skuId, maximum.skuId] } },
      }),
      runtime.prisma.idempotencyRecord.count({
        where: { actor_id: { in: [archived.accountId, maximum.accountId] } },
      }),
    ])).resolves.toEqual([0, 0]);
  }, 60_000);

  fullIt('rejects tampered and expired confirmations without consuming previews or writing facts', async () => {
    const [tamperedFixture, expiredFixture] = await runtime.withPrismaTransaction(async (transaction) => [
      await seedFixture(transaction),
      await seedFixture(transaction),
    ] as const);

    const tamperedReason = 'Bound inventory adjustment request';
    const tamperedPreview = await preview(service, tamperedFixture, 2, tamperedReason);
    const tamperedKey = randomUUID();
    await expect(service.confirmAdjustment(requestContext(tamperedFixture), tamperedFixture.skuId, {
      confirmationHash: tamperedPreview.confirmation_hash,
      physicalDelta: 3,
      previewToken: tamperedPreview.preview_token,
      reason: tamperedReason,
    }, 1, tamperedKey)).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH', httpStatus: 409 });

    let previewClock = new Date();
    const expiringConfig = config();
    const expiringService = new AdminInventoryService(expiringConfig, runtime);
    Object.assign(expiringService as unknown as { previews: HighRiskPreviewRepository }, {
      previews: new HighRiskPreviewRepository(
        runtime.prisma,
        expiringConfig.encryption.idempotencyHashKeys,
        () => previewClock,
      ),
    });
    const expiredReason = 'Inventory adjustment awaiting confirmation';
    const expiredPreview = await preview(expiringService, expiredFixture, 2, expiredReason);
    previewClock = new Date(previewClock.getTime() + 60_001);
    const expiredKey = randomUUID();
    await expect(expiringService.confirmAdjustment(requestContext(expiredFixture), expiredFixture.skuId, {
      confirmationHash: expiredPreview.confirmation_hash,
      physicalDelta: 2,
      previewToken: expiredPreview.preview_token,
      reason: expiredReason,
    }, 1, expiredKey)).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED', httpStatus: 409 });

    await expect(Promise.all([
      runtime.prisma.highRiskOperationPreview.count({
        where: { consumed_at: null, target_id: { in: [tamperedFixture.skuId, expiredFixture.skuId] } },
      }),
      runtime.prisma.idempotencyRecord.count({
        where: { idempotency_key: { in: [tamperedKey, expiredKey] } },
      }),
      runtime.prisma.inventoryLedger.count({
        where: { sku_id: { in: [tamperedFixture.skuId, expiredFixture.skuId] } },
      }),
      runtime.prisma.auditLog.count({
        where: { idempotency_key: { in: [tamperedKey, expiredKey] } },
      }),
      runtime.prisma.outboxEvent.count({
        where: { aggregate_id: { in: [tamperedFixture.skuId, expiredFixture.skuId] } },
      }),
    ])).resolves.toEqual([2, 0, 0, 0, 0]);
  }, 60_000);

  fullIt('allows exactly one concurrent confirmation to consume the same preview token', async () => {
    const fixture = await runtime.withPrismaTransaction((transaction) => seedFixture(transaction));
    const reason = 'One confirmation must win for this token';
    const issued = await preview(service, fixture, 2, reason);
    const confirmKeys = [randomUUID(), randomUUID()] as const;
    const input = {
      confirmationHash: issued.confirmation_hash,
      physicalDelta: 2,
      previewToken: issued.preview_token,
      reason,
    };
    const outcomes = await Promise.allSettled(confirmKeys.map((key) =>
      service.confirmAdjustment(requestContext(fixture), fixture.skuId, input, 1, key)));
    const winners = outcomes.flatMap((outcome, index) => outcome.status === 'fulfilled' ? [index] : []);
    expect(winners).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ code: 'PREVIEW_EXPIRED', httpStatus: 409 }) }),
    ]);
    const winner = winners[0];
    if (winner === undefined) throw new TypeError('Same-token confirmation had no winner');
    expect(outcomes[winner]).toMatchObject({ status: 'fulfilled', value: { envelope: { data: { version: 2 } } } });
    await expect(Promise.all([
      runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      runtime.prisma.auditLog.count({ where: { idempotency_key: { in: [...confirmKeys] } } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: fixture.skuId } }),
      runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: { in: [...confirmKeys] } } }),
      runtime.prisma.highRiskOperationPreview.count({
        where: { consumed_at: { not: null }, target_id: fixture.skuId },
      }),
    ])).resolves.toEqual([1, 1, 1, 1, 1]);
  }, 90_000);

  fullIt('allows one of two preview tokens bound to the same version to commit', async () => {
    const fixture = await runtime.withPrismaTransaction((transaction) => seedFixture(transaction));
    const reasons = ['First same-version adjustment', 'Second same-version adjustment'] as const;
    const issued = await Promise.all(reasons.map((reason) => preview(service, fixture, 1, reason)));
    const confirmKeys = [randomUUID(), randomUUID()] as const;
    const outcomes = await Promise.allSettled(issued.map((entry, index) =>
      service.confirmAdjustment(requestContext(fixture), fixture.skuId, {
        confirmationHash: entry.confirmation_hash,
        physicalDelta: 1,
        previewToken: entry.preview_token,
        reason: reasons[index] as string,
      }, 1, confirmKeys[index] as string)));
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toEqual([
      expect.objectContaining({
        reason: expect.objectContaining({ code: 'RESOURCE_VERSION_CONFLICT', httpStatus: 409 }),
      }),
    ]);
    await expect(Promise.all([
      runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }),
      runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      runtime.prisma.highRiskOperationPreview.count({
        where: { consumed_at: { not: null }, target_id: fixture.skuId },
      }),
      runtime.prisma.highRiskOperationPreview.count({
        where: { consumed_at: null, target_id: fixture.skuId },
      }),
      runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: { in: [...confirmKeys] } } }),
    ])).resolves.toEqual([
      expect.objectContaining({ physical_qty: 11, version: 2 }),
      1,
      1,
      1,
      1,
    ]);
  }, 90_000);

  fullIt('serializes a concurrent reservation release before confirmation without partial facts', async () => {
    const fixture = await runtime.withPrismaTransaction((transaction) => seedFixture(transaction, {
      lockedQty: 8,
      physicalQty: 10,
      reservationQty: 8,
    }));
    if (fixture.reservationId === undefined) {
      throw new TypeError('Concurrent reservation fixture is incomplete');
    }
    const reservationId = fixture.reservationId;
    const reason = 'Adjustment racing a reservation release';
    const issued = await preview(service, fixture, 2, reason);
    const writerReady = deferred();
    const releaseWriter = deferred();
    const applyEntered = deferred();
    const raceService = new AdminInventoryService(config(), runtime);
    const inventory = (raceService as unknown as { inventory: InventoryRepository }).inventory;
    const originalApply = inventory.applyAdjustmentInTransaction.bind(inventory);
    inventory.applyAdjustmentInTransaction = async (...args) => {
      applyEntered.resolve();
      return originalApply(...args);
    };

    const reservationWriter = runSerializableTransaction(runtime.prisma, async (transaction) => {
      await acquireMasterDataHierarchyLocks(transaction, {
        inventoryBalanceIds: [fixture.balanceId],
        reservationIds: [reservationId],
        skuIds: [fixture.skuId],
      });
      const [balance, reservation] = await Promise.all([
        transaction.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }),
        transaction.inventoryReservation.findUnique({ where: { id: reservationId } }),
      ]);
      if (balance?.locked_qty !== 8 || balance.version !== 1 || reservation?.status !== 'ACTIVE') {
        throw new TypeError('Concurrent reservation facts changed before their locked re-read');
      }
      const reservationUpdate = await transaction.inventoryReservation.updateMany({
        data: { status: 'RELEASED' },
        where: { id: reservationId, status: 'ACTIVE' },
      });
      const balanceUpdate = await transaction.inventoryBalance.updateMany({
        data: { locked_qty: 0, updated_at: new Date(), version: { increment: 1 } },
        where: { id: fixture.balanceId, locked_qty: 8, physical_qty: 10, version: 1 },
      });
      if (reservationUpdate.count !== 1 || balanceUpdate.count !== 1) {
        throw new TypeError('Concurrent reservation release lost its conditional update');
      }
      writerReady.resolve();
      await releaseWriter.promise;
    });
    await writerReady.promise;

    const confirmationKey = randomUUID();
    const confirmation = expect(raceService.confirmAdjustment(requestContext(fixture), fixture.skuId, {
      confirmationHash: issued.confirmation_hash,
      physicalDelta: 2,
      previewToken: issued.preview_token,
      reason,
    }, 1, confirmationKey)).rejects.toMatchObject({
      code: 'RESOURCE_VERSION_CONFLICT',
      httpStatus: 409,
    });
    await applyEntered.promise;
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseWriter.resolve();
    await Promise.all([reservationWriter, confirmation]);

    await expect(Promise.all([
      runtime.prisma.inventoryBalance.findUnique({ where: { id: fixture.balanceId } }),
      runtime.prisma.inventoryReservation.findUnique({ where: { id: reservationId } }),
      runtime.prisma.highRiskOperationPreview.findFirst({ where: { target_id: fixture.skuId } }),
      runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: confirmationKey } }),
      runtime.prisma.auditLog.count({ where: { idempotency_key: confirmationKey } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: fixture.skuId } }),
    ])).resolves.toEqual([
      expect.objectContaining({ locked_qty: 0, physical_qty: 10, version: 2 }),
      expect.objectContaining({ status: 'RELEASED' }),
      expect.objectContaining({ consumed_at: null }),
      0,
      0,
      0,
      0,
    ]);
  }, 90_000);

  rollbackIt('leaves no inventory command or fixture facts after the rollback-only sentinel', async () => {
    let fixture: InventoryFixture | undefined;
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      fixture = await seedFixture(transaction, { lockedQty: 2, physicalQty: 10, reservationQty: 2 });
      const rollbackService = new AdminInventoryService(
        config(), transactionBoundRuntime(runtime, transaction),
      );
      const reason = 'Rollback-only inventory adjustment';
      const issued = await preview(rollbackService, fixture, 2, reason);
      await rollbackService.confirmAdjustment(requestContext(fixture), fixture.skuId, {
        confirmationHash: issued.confirmation_hash,
        physicalDelta: 2,
        previewToken: issued.preview_token,
        reason,
      }, 1, randomUUID());
      throw rollbackSentinel;
    }, rollbackOptions)).rejects.toBe(rollbackSentinel);
    if (!fixture || !fixture.reservationId || !fixture.reservationItemId) {
      throw new TypeError('Rollback-only B5 Inventory API fixture was not created');
    }
    const reservationId = fixture.reservationId;
    const reservationItemId = fixture.reservationItemId;
    const relatedAccounts = [fixture.accountId, fixture.customerAccountId].filter(
      (value): value is string => value !== undefined,
    );
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { id: { in: relatedAccounts } } }),
      runtime.prisma.totpFactor.count({ where: { id: fixture.factorId } }),
      runtime.prisma.authSession.count({ where: { id: fixture.sessionId } }),
      runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
      runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
      runtime.prisma.product.count({ where: { id: fixture.productId } }),
      runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: fixture.balanceId } }),
      runtime.prisma.inventoryReservation.count({ where: { id: reservationId } }),
      runtime.prisma.inventoryReservationItem.count({ where: { id: reservationItemId } }),
      runtime.prisma.inventoryLedger.count({ where: { sku_id: fixture.skuId } }),
      runtime.prisma.highRiskOperationPreview.count({ where: { actor_account_id: fixture.accountId } }),
      runtime.prisma.idempotencyRecord.count({ where: { actor_id: fixture.accountId } }),
      runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: fixture.skuId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }, 120_000);
});
