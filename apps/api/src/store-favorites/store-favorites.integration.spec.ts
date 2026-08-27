import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import { generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { StoreFavoritesService } from './store-favorites.service';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B8_STORE_FAVORITES_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B8_STORE_FAVORITES_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 90_000,
};
const rollbackSentinel = Object.freeze({ code: 'B8_STORE_FAVORITES_ROLLBACK_SENTINEL' });
const publicBaseUrl = 'https://assets.example.invalid';

interface FullCleanupConnection {
  database: string;
  host: string;
  password: string;
  port: string;
  username: string;
}

interface FavoriteFixture {
  accountIds: [string, string];
  balanceIds: string[];
  brandId: string;
  categoryId: string;
  customerIds: [string, string];
  favoriteIds: {
    otherCustomer: string;
    saleable: string;
    soldOut: string;
    unavailable: string;
  };
  fileId: string;
  imageIds: string[];
  names: {
    saleable: string;
    soldOut: string;
    target: string;
    unavailable: string;
  };
  productIds: {
    saleable: string;
    soldOut: string;
    target: string;
    unavailable: string;
  };
  sessions: [CurrentStoreSession, CurrentStoreSession];
  skuIds: string[];
}

interface WorkflowIdentifiers {
  keys: {
    create: string;
    delete: string;
    duplicateCreate: string;
    missingDelete: string;
    unavailable: string;
  };
  requestIds: {
    conflict: string;
    create: string;
    createReplay: string;
    delete: string;
    deleteReplay: string;
    duplicateCreate: string;
    missingDelete: string;
    unavailable: string;
  };
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B8 Store favorites integration tests`);
  return value;
}

function integrationConfig(): PlatformRuntimeConfig {
  return {
    encryption: {
      idempotencyHashKeys: {
        current: { id: 'b81-favorite-idempotency-v1', key: Buffer.alloc(32, 31) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 32),
    },
    environment: 'test',
  } as unknown as PlatformRuntimeConfig;
}

function objectStorage(): ObjectStoragePort {
  return {
    publicUrl(objectKey: string): string {
      if (!objectKey.startsWith('public/')) throw new TypeError('Integration public URL key is not public');
      return `${publicBaseUrl}/${objectKey}`;
    },
  } as unknown as ObjectStoragePort;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B8 Store favorites tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B8 Store favorites DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B8 Store favorites tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b81-store-favorites-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B8 Store favorites tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b81-store-favorites-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function cleanupConnectionForFull(): FullCleanupConnection {
  const directUrl = new URL(requiredEnvironment('DIRECT_URL'));
  const runtimeUrl = new URL(requiredEnvironment('DATABASE_URL'));
  let username: string;
  let databaseName: string;
  let password: string;
  try {
    username = decodeURIComponent(directUrl.username);
    databaseName = decodeURIComponent(directUrl.pathname.slice(1));
    password = decodeURIComponent(directUrl.password);
  } catch {
    throw new TypeError('B8 Store favorites DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || username !== 'mall_migrator' || !directUrl.password ||
    directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname ||
    (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B8 Store favorites cleanup requires a query-free loopback mall_migrator test DB');
  }
  return {
    database: databaseName,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function cleanupFullFixture(connection: FullCleanupConnection, fixture: FavoriteFixture): void {
  const [accountA, accountB] = fixture.accountIds;
  const [customerA, customerB] = fixture.customerIds;
  const products = Object.values(fixture.productIds);
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `account_a=${accountA}`,
    '-v', `account_b=${accountB}`,
    '-v', `customer_a=${customerA}`,
    '-v', `customer_b=${customerB}`,
    '-v', `brand_id=${fixture.brandId}`,
    '-v', `category_id=${fixture.categoryId}`,
    '-v', `file_id=${fixture.fileId}`,
    ...products.flatMap((id, index) => ['-v', `product_${index}=${id}`]),
    ...fixture.skuIds.flatMap((id, index) => ['-v', `sku_${index}=${id}`]),
    ...fixture.balanceIds.flatMap((id, index) => ['-v', `balance_${index}=${id}`]),
    ...fixture.imageIds.flatMap((id, index) => ['-v', `image_${index}=${id}`]),
  ], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PGDATABASE: connection.database,
      PGHOST: connection.host,
      PGPASSWORD: connection.password,
      PGPORT: connection.port,
      PGSSLMODE: 'disable',
      PGUSER: connection.username,
    },
    input: `
BEGIN;
DELETE FROM public.audit_log WHERE actor_account_id IN (:'account_a', :'account_b');
DELETE FROM public.idempotency_record WHERE actor_id IN (:'account_a', :'account_b');
DELETE FROM public.favorite WHERE customer_id IN (:'customer_a', :'customer_b');
DELETE FROM public.product_image WHERE id IN (:'image_0', :'image_1');
DELETE FROM public.inventory_balance WHERE id IN (:'balance_0', :'balance_1', :'balance_2', :'balance_3');
DELETE FROM public.sku WHERE id IN (:'sku_0', :'sku_1', :'sku_2', :'sku_3');
DELETE FROM public.product WHERE id IN (:'product_0', :'product_1', :'product_2', :'product_3');
DELETE FROM public.file_asset WHERE id = :'file_id';
DELETE FROM public.customer_profile WHERE id IN (:'customer_a', :'customer_b');
DELETE FROM public.account WHERE id IN (:'account_a', :'account_b');
DELETE FROM public.category WHERE id = :'category_id';
DELETE FROM public.brand WHERE id = :'brand_id';
COMMIT;
`,
  });
  if (result.error || result.status !== 0) {
    const fixtureValues = [
      ...fixture.accountIds,
      ...fixture.customerIds,
      ...products,
      ...fixture.skuIds,
      fixture.brandId,
      fixture.categoryId,
      fixture.fileId,
    ];
    const detail = fixtureValues.reduce(
      (value, fixtureValue) => value.replaceAll(fixtureValue, '[redacted]'),
      (result.stderr || result.error?.message || '').replaceAll(connection.password, '[redacted]'),
    ).trim().split('\n').slice(-3).join(' ');
    throw new TypeError(`Full B8 Store favorites fixture cleanup failed${detail ? `: ${detail}` : ''}`);
  }
}

function transactionBoundRuntime(
  runtime: DatabaseRuntime,
  transaction: DatabaseTransaction,
): DatabaseRuntime {
  const prisma = new Proxy(transaction as unknown as DatabaseRuntime['prisma'], {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction);
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...runtime, prisma };
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function workflowIdentifiers(): WorkflowIdentifiers {
  return {
    keys: {
      create: randomUUID(),
      delete: randomUUID(),
      duplicateCreate: randomUUID(),
      missingDelete: randomUUID(),
      unavailable: randomUUID(),
    },
    requestIds: {
      conflict: requestId(),
      create: requestId(),
      createReplay: requestId(),
      delete: requestId(),
      deleteReplay: requestId(),
      duplicateCreate: requestId(),
      missingDelete: requestId(),
      unavailable: requestId(),
    },
  };
}

function storeSession(accountId: string, customerId: string, now: Date): CurrentStoreSession {
  return {
    accessJti: `b81-access-${randomUUID()}`,
    accountId,
    accountVersion: 1,
    customerId,
    customerVersion: 1,
    expiresAt: new Date(now.getTime() + 3_600_000),
    sessionFamily: generateUlid(),
    sessionId: generateUlid(),
  };
}

function createFixture(): FavoriteFixture {
  const now = Date.now();
  const accountIds: [string, string] = [generateUlid(now), generateUlid(now + 1)];
  const customerIds: [string, string] = [generateUlid(now + 2), generateUlid(now + 3)];
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  return {
    accountIds,
    balanceIds: Array.from({ length: 4 }, (_, index) => generateUlid(now + 30 + index)),
    brandId: generateUlid(now + 4),
    categoryId: generateUlid(now + 5),
    customerIds,
    favoriteIds: {
      otherCustomer: generateUlid(now + 43),
      saleable: generateUlid(now + 40),
      soldOut: generateUlid(now + 41),
      unavailable: generateUlid(now + 42),
    },
    fileId: generateUlid(now + 20),
    imageIds: [generateUlid(now + 21), generateUlid(now + 22)],
    names: {
      saleable: `B8 Literal%_\\Serum ${suffix}`,
      soldOut: `B8 Sold Out ${suffix}`,
      target: `B8 Other Customer ${suffix}`,
      unavailable: `B8 Unavailable ${suffix}`,
    },
    productIds: {
      saleable: generateUlid(now + 10),
      soldOut: generateUlid(now + 11),
      target: generateUlid(now + 12),
      unavailable: generateUlid(now + 13),
    },
    sessions: [
      storeSession(accountIds[0], customerIds[0], new Date(now)),
      storeSession(accountIds[1], customerIds[1], new Date(now)),
    ],
    skuIds: Array.from({ length: 4 }, (_, index) => generateUlid(now + 25 + index)),
  };
}

async function seedFixture(transaction: DatabaseTransaction, fixture: FavoriteFixture): Promise<void> {
  const now = new Date();
  const tiedAt = new Date(now.getTime() - 60_000);
  await transaction.account.createMany({
    data: fixture.accountIds.map((id, index) => ({
      created_at: now,
      deleted_at: null,
      id,
      last_login_at: now,
      login_name: null,
      must_change_password: false,
      password_hash: null,
      role: 'CUSTOMER' as const,
      status: 'ACTIVE' as const,
      updated_at: now,
      version: 1,
      wechat_open_id: `b81-favorite-${index}-${randomUUID()}`,
      wechat_union_id: null,
    })),
  });
  await transaction.customerProfile.createMany({
    data: fixture.customerIds.map((id, index) => ({
      account_id: fixture.accountIds[index]!,
      created_at: now,
      id,
      registered_at: now,
      updated_at: now,
      version: 1,
    })),
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      deleted_at: null,
      description: null,
      id: fixture.brandId,
      logo_file_id: null,
      name: `B8 Favorite Brand ${randomUUID()}`,
      sort_order: 0,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      deleted_at: null,
      icon_file_id: null,
      id: fixture.categoryId,
      name: `B8 Favorite Category ${randomUUID()}`,
      sort_order: 0,
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    },
  });
  const productEntries = Object.entries(fixture.productIds) as Array<
    [keyof FavoriteFixture['productIds'], string]
  >;
  await transaction.product.createMany({
    data: productEntries.map(([kind, id], index) => ({
      brand_id: fixture.brandId,
      category_id: fixture.categoryId,
      created_at: now,
      deleted_at: null,
      id,
      is_hot: false,
      is_new: false,
      name: fixture.names[kind],
      published_at: kind === 'unavailable' ? null : now,
      sales_count: 0,
      spu_code: `B81-SPU-${index}-${id}`,
      status: kind === 'unavailable' ? 'INACTIVE' as const : 'ACTIVE' as const,
      updated_at: now,
      version: 1,
    })),
  });
  await transaction.sku.createMany({
    data: productEntries.map(([, productId], index) => ({
      code: `B81-SKU-${index}-${fixture.skuIds[index]!}`,
      created_at: now,
      deleted_at: null,
      id: fixture.skuIds[index]!,
      is_recommended: index === 0,
      name: `B8 Favorite SKU ${index}`,
      product_id: productId,
      retail_price: index === 0 ? '19.90' : index === 1 ? '9.00' : '29.00',
      spec_json: { size: `${index + 1}00ml` },
      status: 'ACTIVE',
      updated_at: now,
      version: 1,
    })),
  });
  await transaction.inventoryBalance.createMany({
    data: fixture.skuIds.map((skuId, index) => ({
      id: fixture.balanceIds[index]!,
      locked_qty: index === 1 ? 0 : 1,
      physical_qty: index === 1 ? 0 : 8,
      sku_id: skuId,
      updated_at: now,
      version: 1,
    })),
  });
  await transaction.fileAsset.create({
    data: {
      byte_size: 128n,
      created_at: now,
      created_by_id: fixture.accountIds[0],
      deleted_at: null,
      id: fixture.fileId,
      mime_type: 'image/png',
      object_key: `public/${fixture.fileId}`,
      original_name: 'b8-favorite.png',
      purpose: 'PRODUCT_IMAGE',
      sha256: 'a'.repeat(64),
      status: 'READY',
      visibility: 'PUBLIC',
    },
  });
  await transaction.productImage.createMany({
    data: [
      {
        created_at: now,
        deleted_at: null,
        file_id: fixture.fileId,
        id: fixture.imageIds[0]!,
        product_id: fixture.productIds.saleable,
        sort_order: 0,
      },
      {
        created_at: now,
        deleted_at: null,
        file_id: fixture.fileId,
        id: fixture.imageIds[1]!,
        product_id: fixture.productIds.unavailable,
        sort_order: 0,
      },
    ],
  });
  await transaction.favorite.createMany({
    data: [
      {
        created_at: tiedAt,
        customer_id: fixture.customerIds[0],
        id: fixture.favoriteIds.saleable,
        product_id: fixture.productIds.saleable,
      },
      {
        created_at: tiedAt,
        customer_id: fixture.customerIds[0],
        id: fixture.favoriteIds.soldOut,
        product_id: fixture.productIds.soldOut,
      },
      {
        created_at: tiedAt,
        customer_id: fixture.customerIds[0],
        id: fixture.favoriteIds.unavailable,
        product_id: fixture.productIds.unavailable,
      },
      {
        created_at: tiedAt,
        customer_id: fixture.customerIds[1],
        id: fixture.favoriteIds.otherCustomer,
        product_id: fixture.productIds.target,
      },
    ],
  });
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, fixture: FavoriteFixture): Promise<void> {
  const products = Object.values(fixture.productIds);
  await expect(Promise.all([
    runtime.prisma.account.count({ where: { id: { in: fixture.accountIds } } }),
    runtime.prisma.customerProfile.count({ where: { id: { in: fixture.customerIds } } }),
    runtime.prisma.favorite.count({
      where: { OR: [{ customer_id: { in: fixture.customerIds } }, { product_id: { in: products } }] },
    }),
    runtime.prisma.product.count({ where: { id: { in: products } } }),
    runtime.prisma.sku.count({ where: { id: { in: fixture.skuIds } } }),
    runtime.prisma.inventoryBalance.count({ where: { id: { in: fixture.balanceIds } } }),
    runtime.prisma.productImage.count({ where: { id: { in: fixture.imageIds } } }),
    runtime.prisma.fileAsset.count({ where: { id: fixture.fileId } }),
    runtime.prisma.brand.count({ where: { id: fixture.brandId } }),
    runtime.prisma.category.count({ where: { id: fixture.categoryId } }),
    runtime.prisma.idempotencyRecord.count({ where: { actor_id: { in: fixture.accountIds } } }),
    runtime.prisma.auditLog.count({ where: { actor_account_id: { in: fixture.accountIds } } }),
  ])).resolves.toEqual(Array.from({ length: 12 }, () => 0));
}

async function exerciseFavoriteWorkflow(
  service: StoreFavoritesService,
  database: DatabaseTransaction,
  fixture: FavoriteFixture,
  identifiers: WorkflowIdentifiers,
): Promise<void> {
  const session = fixture.sessions[0];
  const otherSession = fixture.sessions[1];
  const productForFavorite = new Map([
    [fixture.favoriteIds.saleable, fixture.productIds.saleable],
    [fixture.favoriteIds.soldOut, fixture.productIds.soldOut],
    [fixture.favoriteIds.unavailable, fixture.productIds.unavailable],
  ]);
  const stableFavoriteIds = [...productForFavorite.keys()].sort().reverse();

  const initial = await service.listFavorites(session, { page: 1, pageSize: 20 });
  expect(initial.pagination).toEqual({ page: 1, page_size: 20, total: 3 });
  expect(initial.items.map(({ favorite_id }) => favorite_id)).toEqual(stableFavoriteIds);
  expect(initial.items.map(({ product }) => product.product_id)).toEqual(
    stableFavoriteIds.map((favoriteId) => productForFavorite.get(favoriteId)),
  );
  const saleable = initial.items.find(({ product }) => product.product_id === fixture.productIds.saleable);
  const soldOut = initial.items.find(({ product }) => product.product_id === fixture.productIds.soldOut);
  const unavailable = initial.items.find(
    ({ product }) => product.product_id === fixture.productIds.unavailable,
  );
  expect(saleable?.product).toEqual({
    availability: 'SALEABLE',
    is_salable: true,
    minimum_active_price: '19.90',
    name: fixture.names.saleable,
    primary_image_url: `${publicBaseUrl}/public/${fixture.fileId}`,
    product_id: fixture.productIds.saleable,
  });
  expect(soldOut?.product).toMatchObject({
    availability: 'OUT_OF_STOCK',
    is_salable: false,
    minimum_active_price: '9.00',
    primary_image_url: null,
  });
  expect(unavailable?.product).toEqual({
    availability: 'UNAVAILABLE',
    is_salable: false,
    minimum_active_price: null,
    name: fixture.names.unavailable,
    primary_image_url: null,
    product_id: fixture.productIds.unavailable,
  });

  const literal = await service.listFavorites(session, {
    keyword: '  literal%_\\serum  ',
    page: 1,
    pageSize: 20,
  });
  expect(literal.pagination.total).toBe(1);
  expect(literal.items.map(({ product }) => product.product_id)).toEqual([fixture.productIds.saleable]);
  const pageOne = await service.listFavorites(session, { page: 1, pageSize: 1 });
  const pageTwo = await service.listFavorites(session, { page: 2, pageSize: 1 });
  const repeatedPageOne = await service.listFavorites(session, { page: 1, pageSize: 1 });
  expect(pageOne.items[0]?.favorite_id).toBe(stableFavoriteIds[0]);
  expect(pageTwo.items[0]?.favorite_id).toBe(stableFavoriteIds[1]);
  expect(repeatedPageOne.items).toEqual(pageOne.items);

  const otherCustomer = await service.listFavorites(otherSession, { page: 1, pageSize: 20 });
  expect(otherCustomer.pagination.total).toBe(1);
  expect(otherCustomer.items[0]?.product.product_id).toBe(fixture.productIds.target);
  await expect(service.getFavoriteState(session, fixture.productIds.target)).resolves.toEqual({
    is_favorite: false,
    product_id: fixture.productIds.target,
  });
  await expect(service.getFavoriteState(
    { ...session, customerId: fixture.customerIds[1] },
    fixture.productIds.target,
  )).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });

  await expect(service.putFavorite(
    session,
    fixture.productIds.unavailable,
    identifiers.keys.unavailable,
    identifiers.requestIds.unavailable,
    '127.0.0.1',
  )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', httpStatus: 404 });
  await expect(Promise.all([
    database.idempotencyRecord.count({ where: { idempotency_key: identifiers.keys.unavailable } }),
    database.auditLog.count({ where: { request_id: identifiers.requestIds.unavailable } }),
  ])).resolves.toEqual([0, 0]);

  await expect(service.putFavorite(
    session,
    fixture.productIds.target,
    identifiers.keys.create,
    identifiers.requestIds.create,
    '127.0.0.1',
  )).resolves.toEqual({ is_favorite: true, product_id: fixture.productIds.target });
  await expect(service.putFavorite(
    session,
    fixture.productIds.target,
    identifiers.keys.duplicateCreate,
    identifiers.requestIds.duplicateCreate,
    '127.0.0.1',
  )).resolves.toEqual({ is_favorite: true, product_id: fixture.productIds.target });
  await expect(Promise.all([
    database.favorite.count({
      where: { customer_id: fixture.customerIds[0], product_id: fixture.productIds.target },
    }),
    database.auditLog.count({ where: { actor_account_id: fixture.accountIds[0] } }),
  ])).resolves.toEqual([1, 1]);

  await expect(service.putFavorite(
    session,
    fixture.productIds.saleable,
    identifiers.keys.create,
    identifiers.requestIds.conflict,
    '127.0.0.1',
  )).rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });

  await expect(service.deleteFavorite(
    session,
    fixture.productIds.target,
    identifiers.keys.delete,
    identifiers.requestIds.delete,
    '127.0.0.1',
  )).resolves.toEqual({ is_favorite: false, product_id: fixture.productIds.target });
  await expect(service.deleteFavorite(
    session,
    fixture.productIds.target,
    identifiers.keys.delete,
    identifiers.requestIds.deleteReplay,
    '127.0.0.1',
  )).resolves.toEqual({ is_favorite: false, product_id: fixture.productIds.target });
  await expect(service.deleteFavorite(
    session,
    fixture.productIds.target,
    identifiers.keys.missingDelete,
    identifiers.requestIds.missingDelete,
    '127.0.0.1',
  )).resolves.toEqual({ is_favorite: false, product_id: fixture.productIds.target });
  await expect(service.putFavorite(
    session,
    fixture.productIds.target,
    identifiers.keys.create,
    identifiers.requestIds.createReplay,
    '127.0.0.1',
  )).resolves.toEqual({ is_favorite: false, product_id: fixture.productIds.target });

  await expect(Promise.all([
    database.favorite.count({
      where: { customer_id: fixture.customerIds[0], product_id: fixture.productIds.target },
    }),
    database.auditLog.count({ where: { actor_account_id: fixture.accountIds[0] } }),
  ])).resolves.toEqual([0, 2]);

  const idempotency = await database.idempotencyRecord.findMany({
    orderBy: { idempotency_key: 'asc' },
    where: { actor_id: fixture.accountIds[0] },
  });
  expect(idempotency).toHaveLength(4);
  expect(idempotency.map(({ idempotency_key }) => idempotency_key).sort()).toEqual([
    identifiers.keys.create,
    identifiers.keys.delete,
    identifiers.keys.duplicateCreate,
    identifiers.keys.missingDelete,
  ].sort());
  for (const record of idempotency) {
    expect(record.response_body).toBeNull();
    expect(record.response_body_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(record.resource_id).toBeNull();
    expect(record.response_status).toBe(200);
  }

  const audits = await database.auditLog.findMany({
    orderBy: { occurred_at: 'asc' },
    where: { actor_account_id: fixture.accountIds[0] },
  });
  expect(audits).toHaveLength(2);
  expect(audits.map(({ idempotency_key }) => idempotency_key).sort()).toEqual([
    identifiers.keys.create,
    identifiers.keys.delete,
  ].sort());
  for (const audit of audits) {
    expect(audit).toMatchObject({
      action: 'UPDATE',
      actor_role: 'CUSTOMER',
      after_json: null,
      before_json: null,
      module: 'customer',
      object_id: fixture.customerIds[0],
      object_type: 'customer',
      result: 'SUCCESS',
      result_code: 'OK',
    });
    expect(audit.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  }
  const persistedPreferenceSafeFacts = JSON.stringify({ audits, idempotency });
  for (const productId of Object.values(fixture.productIds)) {
    expect(persistedPreferenceSafeFacts).not.toContain(productId);
  }
  for (const name of Object.values(fixture.names)) {
    expect(persistedPreferenceSafeFacts).not.toContain(name);
  }
}

integrationDescribe('B8.1 Store favorites service and PostgreSQL integration', () => {
  let cleanupConnection: FullCleanupConnection | undefined;
  let config: PlatformRuntimeConfig;
  let runtime: DatabaseRuntime;
  let storage: ObjectStoragePort;

  beforeAll(async () => {
    config = integrationConfig();
    runtime = runtimeForMode();
    await runtime.connect();
    if (mode === 'full') cleanupConnection = cleanupConnectionForFull();
    storage = objectStorage();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  rollbackIt('keeps the complete favorite workflow atomic with transaction-bound runtime rollback',
    async () => {
      const fixture = createFixture();
      const identifiers = workflowIdentifiers();
      await expect(runtime.withPrismaTransaction(async (transaction) => {
        await seedFixture(transaction, fixture);
        const boundRuntime = transactionBoundRuntime(runtime, transaction);
        const service = new StoreFavoritesService(config, boundRuntime, storage);
        await exerciseFavoriteWorkflow(service, transaction, fixture, identifiers);
        throw rollbackSentinel;
      }, transactionOptions)).rejects.toBe(rollbackSentinel);
      await assertNoFixtureFacts(runtime, fixture);
    }, 90_000);

  fullIt('commits the complete favorite workflow and leaves no facts after exact migrator cleanup',
    async () => {
      const fixture = createFixture();
      const identifiers = workflowIdentifiers();
      try {
        await runtime.withPrismaTransaction(
          (transaction) => seedFixture(transaction, fixture),
          transactionOptions,
        );
        const service = new StoreFavoritesService(config, runtime, storage);
        await exerciseFavoriteWorkflow(service, runtime.prisma, fixture, identifiers);
      } finally {
        if (cleanupConnection) cleanupFullFixture(cleanupConnection, fixture);
      }
      await assertNoFixtureFacts(runtime, fixture);
    }, 90_000);
});
