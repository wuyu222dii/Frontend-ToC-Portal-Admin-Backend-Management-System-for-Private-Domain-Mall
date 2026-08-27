import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type AuditRepository,
  createDatabaseRuntime,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyRepository,
} from '@qingxu/database';
import { generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { StoreCartService } from './store-cart.service';

type DatabaseTestMode = 'full' | 'rollback';

const mode = process.env.B8_STORE_CART_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B8_STORE_CART_DATABASE_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const transactionOptions = {
  isolationLevel: 'Serializable' as const,
  maxWait: 15_000,
  timeout: 180_000,
};
const PRODUCTION_TRANSACTION_TIMEOUT_MS = 15_000;
const rollbackSentinel = Object.freeze({ code: 'B8_STORE_CART_ROLLBACK_SENTINEL' });
const publicBaseUrl = 'https://assets.example.invalid';

interface FullCleanupConnection {
  database: string;
  host: string;
  password: string;
  port: string;
  username: string;
}

interface CartFixture {
  accountIds: [string, string, string];
  activeBrandId: string;
  activeCategoryId: string;
  balanceIds: string[];
  bulkSkuIds: string[];
  cartIds: [string, string, string];
  customerIds: [string, string, string];
  fileIds: { invalid: string; valid: string };
  imageIds: { invalid: string; valid: string };
  inactiveBrandId: string;
  inactiveCategoryId: string;
  initialItemIds: Record<string, string>;
  names: { active: string; invalidImage: string };
  productIds: {
    active: string;
    archivedStatusOnly: string;
    inactiveBrand: string;
    inactiveCategory: string;
    invalidImage: string;
  };
  sessions: [CurrentStoreSession, CurrentStoreSession, CurrentStoreSession];
  skuIds: {
    archivedStatusOnly: string;
    brandInactive: string;
    categoryInactive: string;
    completeFault: string;
    deletedWrite: string;
    imageInvalid: string;
    inactive: string;
    inactiveWrite: string;
    insufficient: string;
    mergeExisting: string;
    mergeNew: string;
    missingStock: string;
    productArchivedStatusOnly: string;
    saleableSelected: string;
    saleableUnselected: string;
    auditFault: string;
  };
  unknownSkuId: string;
}

interface WorkflowKeys {
  auditFault: string;
  bulkMerge: string;
  completeFault: string;
  deletedWrite: string;
  inactiveWrite: string;
  merge: string;
  mergeUnknown: string;
  missingDelete: string;
  noOpPut: string;
  unknownPut: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B8 Store cart integration tests`);
  return value;
}

function integrationConfig(): PlatformRuntimeConfig {
  return {
    encryption: {
      idempotencyHashKeys: {
        current: { id: 'b82-cart-idempotency-v1', key: Buffer.alloc(32, 41) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 42),
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
      throw new TypeError('Full B8 Store cart tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B8 Store cart DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B8 Store cart tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b82-store-cart-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 8,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B8 Store cart tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b82-store-cart-rollback',
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
    throw new TypeError('B8 Store cart DIRECT_URL contains invalid percent encoding');
  }
  if (!['postgres:', 'postgresql:'].includes(directUrl.protocol) ||
    !LOOPBACK_HOSTS.has(directUrl.hostname) || username !== 'mall_migrator' || !directUrl.password ||
    directUrl.search !== '' || directUrl.hash !== '' ||
    !/(?:^|[-_])(?:test|ephemeral|ci)(?:[-_]|$)/i.test(databaseName) ||
    directUrl.hostname !== runtimeUrl.hostname ||
    (directUrl.port || '5432') !== (runtimeUrl.port || '5432') ||
    directUrl.pathname !== runtimeUrl.pathname) {
    throw new TypeError('Full B8 Store cart cleanup requires a query-free loopback mall_migrator test DB');
  }
  return {
    database: databaseName,
    host: directUrl.hostname === '[::1]' ? '::1' : directUrl.hostname,
    password,
    port: directUrl.port || '5432',
    username,
  };
}

function csv(values: readonly string[]): string {
  return values.join(',');
}

function cleanupFullFixture(connection: FullCleanupConnection, fixture: CartFixture): void {
  const productIds = Object.values(fixture.productIds);
  const skuIds = [...Object.values(fixture.skuIds), ...fixture.bulkSkuIds];
  const result = spawnSync('psql', [
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-v', `account_ids=${csv(fixture.accountIds)}`,
    '-v', `balance_ids=${csv(fixture.balanceIds)}`,
    '-v', `brand_ids=${csv([fixture.activeBrandId, fixture.inactiveBrandId])}`,
    '-v', `cart_ids=${csv(fixture.cartIds)}`,
    '-v', `category_ids=${csv([fixture.activeCategoryId, fixture.inactiveCategoryId])}`,
    '-v', `customer_ids=${csv(fixture.customerIds)}`,
    '-v', `file_ids=${csv(Object.values(fixture.fileIds))}`,
    '-v', `image_ids=${csv(Object.values(fixture.imageIds))}`,
    '-v', `product_ids=${csv(productIds)}`,
    '-v', `sku_ids=${csv(skuIds)}`,
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
DELETE FROM public.audit_log WHERE actor_account_id::text = ANY(string_to_array(:'account_ids', ','));
DELETE FROM public.idempotency_record WHERE actor_id::text = ANY(string_to_array(:'account_ids', ','));
DELETE FROM public.cart_item WHERE cart_id::text = ANY(string_to_array(:'cart_ids', ','));
DELETE FROM public.cart WHERE id::text = ANY(string_to_array(:'cart_ids', ','));
DELETE FROM public.inventory_balance WHERE id::text = ANY(string_to_array(:'balance_ids', ','));
DELETE FROM public.sku WHERE id::text = ANY(string_to_array(:'sku_ids', ','));
DELETE FROM public.product_image WHERE id::text = ANY(string_to_array(:'image_ids', ','));
DELETE FROM public.product WHERE id::text = ANY(string_to_array(:'product_ids', ','));
DELETE FROM public.file_asset WHERE id::text = ANY(string_to_array(:'file_ids', ','));
DELETE FROM public.customer_profile WHERE id::text = ANY(string_to_array(:'customer_ids', ','));
DELETE FROM public.account WHERE id::text = ANY(string_to_array(:'account_ids', ','));
DELETE FROM public.category WHERE id::text = ANY(string_to_array(:'category_ids', ','));
DELETE FROM public.brand WHERE id::text = ANY(string_to_array(:'brand_ids', ','));
COMMIT;
`,
  });
  if (result.error || result.status !== 0) {
    const fixtureValues = [
      ...fixture.accountIds,
      ...fixture.customerIds,
      ...productIds,
      ...skuIds,
      ...Object.values(fixture.fileIds),
    ];
    const detail = fixtureValues.reduce(
      (value, fixtureValue) => value.replaceAll(fixtureValue, '[redacted]'),
      (result.stderr || result.error?.message || '').replaceAll(connection.password, '[redacted]'),
    ).trim().split('\n').slice(-3).join(' ');
    throw new TypeError(`Full B8 Store cart fixture cleanup failed${detail ? `: ${detail}` : ''}`);
  }
}

function transactionBoundRuntime(
  runtime: DatabaseRuntime,
  transaction: DatabaseTransaction,
): DatabaseRuntime {
  let savepointSequence = 0;
  const prisma = new Proxy(transaction as unknown as DatabaseRuntime['prisma'], {
    get(target, property, receiver) {
      if (property === '$transaction') {
        return async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => {
          savepointSequence += 1;
          const savepoint = `b82_cart_command_${savepointSequence}`;
          await transaction.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
          try {
            const value = await work(transaction);
            await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
            return value;
          } catch (error) {
            await transaction.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await transaction.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
            throw error;
          }
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });
  return { ...runtime, prisma };
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function workflowKeys(): WorkflowKeys {
  return {
    auditFault: randomUUID(),
    bulkMerge: randomUUID(),
    completeFault: randomUUID(),
    deletedWrite: randomUUID(),
    inactiveWrite: randomUUID(),
    merge: randomUUID(),
    mergeUnknown: randomUUID(),
    missingDelete: randomUUID(),
    noOpPut: randomUUID(),
    unknownPut: randomUUID(),
  };
}

function storeSession(accountId: string, customerId: string, now: Date): CurrentStoreSession {
  return {
    accessJti: `b82-access-${randomUUID()}`,
    accountId,
    accountVersion: 1,
    customerId,
    customerVersion: 1,
    expiresAt: new Date(now.getTime() + 3_600_000),
    sessionFamily: generateUlid(),
    sessionId: generateUlid(),
  };
}

function createFixture(): CartFixture {
  const now = Date.now();
  const accountIds: [string, string, string] = [
    generateUlid(now),
    generateUlid(now + 1),
    generateUlid(now + 2),
  ];
  const customerIds: [string, string, string] = [
    generateUlid(now + 3),
    generateUlid(now + 4),
    generateUlid(now + 5),
  ];
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const skuNames = [
    'saleableSelected',
    'saleableUnselected',
    'insufficient',
    'missingStock',
    'inactive',
    'archivedStatusOnly',
    'productArchivedStatusOnly',
    'brandInactive',
    'categoryInactive',
    'imageInvalid',
    'inactiveWrite',
    'deletedWrite',
    'mergeExisting',
    'mergeNew',
    'auditFault',
    'completeFault',
  ] as const;
  const skuIds = Object.fromEntries(
    skuNames.map((name, index) => [name, generateUlid(now + 30 + index)]),
  ) as unknown as CartFixture['skuIds'];
  const initialSkuNames = [
    'saleableSelected',
    'saleableUnselected',
    'insufficient',
    'missingStock',
    'inactive',
    'archivedStatusOnly',
    'productArchivedStatusOnly',
    'brandInactive',
    'categoryInactive',
    'imageInvalid',
    'mergeExisting',
  ] as const;
  return {
    accountIds,
    activeBrandId: generateUlid(now + 6),
    activeCategoryId: generateUlid(now + 8),
    balanceIds: Array.from({ length: 14 }, (_, index) => generateUlid(now + 60 + index)),
    bulkSkuIds: Array.from({ length: 100 }, (_, index) => generateUlid(now + 200 + index)),
    cartIds: [generateUlid(now + 80), generateUlid(now + 81), generateUlid(now + 82)],
    customerIds,
    fileIds: { valid: generateUlid(now + 20), invalid: generateUlid(now + 21) },
    imageIds: { valid: generateUlid(now + 22), invalid: generateUlid(now + 23) },
    inactiveBrandId: generateUlid(now + 7),
    inactiveCategoryId: generateUlid(now + 9),
    initialItemIds: Object.fromEntries(
      initialSkuNames.map((name, index) => [name, generateUlid(now + 100 + index)]),
    ),
    names: {
      active: `B8 Cart Active Product ${suffix}`,
      invalidImage: `B8 Cart Invalid Image ${suffix}`,
    },
    productIds: {
      active: generateUlid(now + 10),
      archivedStatusOnly: generateUlid(now + 11),
      inactiveBrand: generateUlid(now + 12),
      inactiveCategory: generateUlid(now + 13),
      invalidImage: generateUlid(now + 14),
    },
    sessions: [
      storeSession(accountIds[0], customerIds[0], new Date(now)),
      storeSession(accountIds[1], customerIds[1], new Date(now)),
      storeSession(accountIds[2], customerIds[2], new Date(now)),
    ],
    skuIds,
    unknownSkuId: generateUlid(now + 900),
  };
}

async function seedFixture(transaction: DatabaseTransaction, fixture: CartFixture): Promise<void> {
  const now = new Date();
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
      wechat_open_id: `b82-cart-${index}-${randomUUID()}`,
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
  await transaction.brand.createMany({
    data: [
      {
        created_at: now,
        deleted_at: null,
        description: null,
        id: fixture.activeBrandId,
        logo_file_id: null,
        name: `B8 Cart Active Brand ${randomUUID()}`,
        sort_order: 0,
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        deleted_at: null,
        description: null,
        id: fixture.inactiveBrandId,
        logo_file_id: null,
        name: `B8 Cart Inactive Brand ${randomUUID()}`,
        sort_order: 1,
        status: 'INACTIVE',
        updated_at: now,
        version: 1,
      },
    ],
  });
  await transaction.category.createMany({
    data: [
      {
        created_at: now,
        deleted_at: null,
        icon_file_id: null,
        id: fixture.activeCategoryId,
        name: `B8 Cart Active Category ${randomUUID()}`,
        sort_order: 0,
        status: 'ACTIVE',
        updated_at: now,
        version: 1,
      },
      {
        created_at: now,
        deleted_at: null,
        icon_file_id: null,
        id: fixture.inactiveCategoryId,
        name: `B8 Cart Inactive Category ${randomUUID()}`,
        sort_order: 1,
        status: 'INACTIVE',
        updated_at: now,
        version: 1,
      },
    ],
  });
  await transaction.product.createMany({
    data: [
      [fixture.productIds.active, fixture.activeBrandId, fixture.activeCategoryId, fixture.names.active, 'ACTIVE'],
      [fixture.productIds.archivedStatusOnly, fixture.activeBrandId, fixture.activeCategoryId,
        `B8 Cart Archived Product ${randomUUID()}`, 'ARCHIVED'],
      [fixture.productIds.inactiveBrand, fixture.inactiveBrandId, fixture.activeCategoryId,
        `B8 Cart Inactive Brand Product ${randomUUID()}`, 'ACTIVE'],
      [fixture.productIds.inactiveCategory, fixture.activeBrandId, fixture.inactiveCategoryId,
        `B8 Cart Inactive Category Product ${randomUUID()}`, 'ACTIVE'],
      [fixture.productIds.invalidImage, fixture.activeBrandId, fixture.activeCategoryId,
        fixture.names.invalidImage, 'ACTIVE'],
    ].map(([id, brandId, categoryId, name, status], index) => ({
      brand_id: brandId!,
      category_id: categoryId!,
      created_at: now,
      deleted_at: null,
      id: id!,
      is_hot: false,
      is_new: false,
      name: name!,
      published_at: now,
      sales_count: 0,
      spu_code: `B82-SPU-${index}-${id}`,
      status: status as 'ACTIVE' | 'ARCHIVED',
      updated_at: now,
      version: 1,
    })),
  });

  const skuDefinitions: Array<{
    deletedAt?: Date | null;
    id: string;
    name: string;
    price: string;
    productId?: string;
    status?: 'ACTIVE' | 'ARCHIVED' | 'INACTIVE';
  }> = [
    { id: fixture.skuIds.saleableSelected, name: 'Saleable selected', price: '12.50' },
    { id: fixture.skuIds.saleableUnselected, name: 'Saleable unselected', price: '11.00' },
    { id: fixture.skuIds.insufficient, name: 'Insufficient stock', price: '9.00' },
    { id: fixture.skuIds.missingStock, name: 'Missing stock', price: '8.00' },
    { id: fixture.skuIds.inactive, name: 'Inactive SKU', price: '7.00', status: 'INACTIVE' },
    { id: fixture.skuIds.archivedStatusOnly, name: 'Archived status SKU', price: '6.00', status: 'ARCHIVED' },
    {
      id: fixture.skuIds.productArchivedStatusOnly,
      name: 'Archived product SKU',
      price: '5.00',
      productId: fixture.productIds.archivedStatusOnly,
    },
    {
      id: fixture.skuIds.brandInactive,
      name: 'Inactive brand SKU',
      price: '4.00',
      productId: fixture.productIds.inactiveBrand,
    },
    {
      id: fixture.skuIds.categoryInactive,
      name: 'Inactive category SKU',
      price: '3.00',
      productId: fixture.productIds.inactiveCategory,
    },
    {
      id: fixture.skuIds.imageInvalid,
      name: 'Invalid image SKU',
      price: '2.00',
      productId: fixture.productIds.invalidImage,
    },
    { id: fixture.skuIds.inactiveWrite, name: 'Writable inactive SKU', price: '15.00', status: 'INACTIVE' },
    {
      deletedAt: now,
      id: fixture.skuIds.deletedWrite,
      name: 'Writable deleted SKU',
      price: '16.00',
      status: 'ARCHIVED',
    },
    { id: fixture.skuIds.mergeExisting, name: 'Merge existing SKU', price: '17.00' },
    { id: fixture.skuIds.mergeNew, name: 'Merge new SKU', price: '18.00' },
    { id: fixture.skuIds.auditFault, name: 'Audit fault SKU', price: '19.00' },
    { id: fixture.skuIds.completeFault, name: 'Complete fault SKU', price: '20.00' },
  ];
  await transaction.sku.createMany({
    data: [
      ...skuDefinitions.map((sku, index) => ({
        code: `B82-SKU-${index}-${sku.id}`,
        created_at: now,
        deleted_at: sku.deletedAt ?? null,
        id: sku.id,
        is_recommended: false,
        name: sku.name,
        product_id: sku.productId ?? fixture.productIds.active,
        retail_price: sku.price,
        spec_json: { size: `${index + 1}00ml` },
        status: sku.status ?? 'ACTIVE' as const,
        updated_at: now,
        version: 1,
      })),
      ...fixture.bulkSkuIds.map((id, index) => ({
        code: `B82-BULK-SKU-${index}-${id}`,
        created_at: now,
        deleted_at: null,
        id,
        is_recommended: false,
        name: `Bulk merge SKU ${index + 1}`,
        product_id: fixture.productIds.active,
        retail_price: '1.00',
        spec_json: { bulk: index + 1 },
        status: 'ACTIVE' as const,
        updated_at: now,
        version: 1,
      })),
    ],
  });
  const balancedSkuIds = [
    fixture.skuIds.saleableSelected,
    fixture.skuIds.saleableUnselected,
    fixture.skuIds.insufficient,
    fixture.skuIds.inactive,
    fixture.skuIds.archivedStatusOnly,
    fixture.skuIds.productArchivedStatusOnly,
    fixture.skuIds.brandInactive,
    fixture.skuIds.categoryInactive,
    fixture.skuIds.imageInvalid,
    fixture.skuIds.inactiveWrite,
    fixture.skuIds.deletedWrite,
    fixture.skuIds.mergeExisting,
    fixture.skuIds.mergeNew,
    fixture.skuIds.auditFault,
  ];
  await transaction.inventoryBalance.createMany({
    data: balancedSkuIds.map((skuId, index) => ({
      id: fixture.balanceIds[index]!,
      locked_qty: 0,
      physical_qty: skuId === fixture.skuIds.insufficient ? 2 : 100,
      sku_id: skuId,
      updated_at: now,
      version: 1,
    })),
  });
  await transaction.fileAsset.createMany({
    data: [
      {
        byte_size: 128n,
        created_at: now,
        created_by_id: fixture.accountIds[0],
        deleted_at: null,
        id: fixture.fileIds.valid,
        mime_type: 'image/png',
        object_key: `public/${fixture.fileIds.valid}`,
        original_name: 'b8-cart-valid.png',
        purpose: 'PRODUCT_IMAGE',
        sha256: 'a'.repeat(64),
        status: 'READY',
        visibility: 'PUBLIC',
      },
      {
        byte_size: 128n,
        created_at: now,
        created_by_id: fixture.accountIds[0],
        deleted_at: null,
        id: fixture.fileIds.invalid,
        mime_type: 'image/png',
        object_key: `public/${fixture.fileIds.invalid}`,
        original_name: 'b8-cart-private.png',
        purpose: 'PRODUCT_IMAGE',
        sha256: 'b'.repeat(64),
        status: 'READY',
        visibility: 'PUBLIC',
      },
    ],
  });
  await transaction.productImage.createMany({
    data: [
      {
        created_at: now,
        deleted_at: null,
        file_id: fixture.fileIds.valid,
        id: fixture.imageIds.valid,
        product_id: fixture.productIds.active,
        sort_order: 0,
      },
      {
        created_at: now,
        deleted_at: null,
        file_id: fixture.fileIds.invalid,
        id: fixture.imageIds.invalid,
        product_id: fixture.productIds.invalidImage,
        sort_order: 0,
      },
    ],
  });
  await transaction.fileAsset.update({
    data: {
      object_key: `private/${fixture.fileIds.invalid}`,
      visibility: 'PRIVATE',
    },
    where: { id: fixture.fileIds.invalid },
  });
}

async function seedInitialCarts(transaction: DatabaseTransaction, fixture: CartFixture): Promise<void> {
  const now = new Date();
  const tiedAt = new Date(now.getTime() - 60_000);
  await transaction.cart.createMany({
    data: fixture.cartIds.map((id, index) => ({
      created_at: now,
      customer_id: fixture.customerIds[index]!,
      id,
      updated_at: now,
    })),
  });
  const quantities: Record<string, number> = {
    insufficient: 5,
    mergeExisting: 98,
    saleableSelected: 2,
  };
  const unselected = new Set(['imageInvalid', 'mergeExisting', 'saleableUnselected']);
  await transaction.cartItem.createMany({
    data: [
      ...Object.entries(fixture.initialItemIds).map(([name, id]) => ({
        cart_id: fixture.cartIds[0],
        created_at: tiedAt,
        id,
        quantity: quantities[name] ?? 1,
        selected: !unselected.has(name),
        sku_id: fixture.skuIds[name as keyof CartFixture['skuIds']],
        updated_at: tiedAt,
      })),
      {
        cart_id: fixture.cartIds[1],
        created_at: tiedAt,
        id: generateUlid(tiedAt.getTime() + 500),
        quantity: 1,
        selected: true,
        sku_id: fixture.skuIds.saleableSelected,
        updated_at: tiedAt,
      },
    ],
  });
}

async function assertNoFixtureFacts(runtime: DatabaseRuntime, fixture: CartFixture): Promise<void> {
  const productIds = Object.values(fixture.productIds);
  const skuIds = [...Object.values(fixture.skuIds), ...fixture.bulkSkuIds];
  await expect(Promise.all([
    runtime.prisma.account.count({ where: { id: { in: fixture.accountIds } } }),
    runtime.prisma.customerProfile.count({ where: { id: { in: fixture.customerIds } } }),
    runtime.prisma.cart.count({ where: { id: { in: fixture.cartIds } } }),
    runtime.prisma.cartItem.count({ where: { cart_id: { in: fixture.cartIds } } }),
    runtime.prisma.product.count({ where: { id: { in: productIds } } }),
    runtime.prisma.sku.count({ where: { id: { in: skuIds } } }),
    runtime.prisma.inventoryBalance.count({ where: { id: { in: fixture.balanceIds } } }),
    runtime.prisma.productImage.count({ where: { id: { in: Object.values(fixture.imageIds) } } }),
    runtime.prisma.fileAsset.count({ where: { id: { in: Object.values(fixture.fileIds) } } }),
    runtime.prisma.brand.count({ where: { id: { in: [fixture.activeBrandId, fixture.inactiveBrandId] } } }),
    runtime.prisma.category.count({
      where: { id: { in: [fixture.activeCategoryId, fixture.inactiveCategoryId] } },
    }),
    runtime.prisma.idempotencyRecord.count({ where: { actor_id: { in: fixture.accountIds } } }),
    runtime.prisma.auditLog.count({ where: { actor_account_id: { in: fixture.accountIds } } }),
  ])).resolves.toEqual(Array.from({ length: 13 }, () => 0));
}

function itemBySku(cart: Awaited<ReturnType<StoreCartService['getCart']>>, skuId: string) {
  return cart.items.find((item) => item.sku_id === skuId);
}

async function expectNoCommandFacts(
  database: DatabaseTransaction,
  fixture: CartFixture,
  key: string,
  skuId: string,
): Promise<void> {
  await expect(Promise.all([
    database.cartItem.count({ where: { cart_id: fixture.cartIds[0], sku_id: skuId } }),
    database.idempotencyRecord.count({ where: { actor_id: fixture.accountIds[0], idempotency_key: key } }),
    database.auditLog.count({ where: { actor_account_id: fixture.accountIds[0], idempotency_key: key } }),
  ])).resolves.toEqual([0, 0, 0]);
}

async function exerciseFaultRollback(
  config: PlatformRuntimeConfig,
  runtime: DatabaseRuntime,
  storage: ObjectStoragePort,
  database: DatabaseTransaction,
  fixture: CartFixture,
  keys: WorkflowKeys,
): Promise<void> {
  const auditFailureService = new StoreCartService(config, runtime, storage);
  const auditInternals = auditFailureService as unknown as { audit: AuditRepository };
  const auditFailure = vi.spyOn(auditInternals.audit, 'append')
    .mockRejectedValueOnce(new Error('b82 audit failure'));
  try {
    await expect(auditFailureService.putItem(
      fixture.sessions[0],
      fixture.skuIds.auditFault,
      { quantity: 1, selected: true },
      keys.auditFault,
      requestId(),
      '127.0.0.1',
    )).rejects.toThrow('b82 audit failure');
  } finally {
    auditFailure.mockRestore();
  }
  await expectNoCommandFacts(database, fixture, keys.auditFault, fixture.skuIds.auditFault);

  const completeFailureService = new StoreCartService(config, runtime, storage);
  const completeInternals = completeFailureService as unknown as { idempotency: IdempotencyRepository };
  const completeFailure = vi.spyOn(completeInternals.idempotency, 'complete')
    .mockRejectedValueOnce(new Error('b82 idempotency completion failure'));
  try {
    await expect(completeFailureService.putItem(
      fixture.sessions[0],
      fixture.skuIds.completeFault,
      { quantity: 1, selected: true },
      keys.completeFault,
      requestId(),
      '127.0.0.1',
    )).rejects.toThrow('b82 idempotency completion failure');
  } finally {
    completeFailure.mockRestore();
  }
  await expectNoCommandFacts(database, fixture, keys.completeFault, fixture.skuIds.completeFault);
}

async function exerciseMaximumMerge(
  service: StoreCartService,
  database: DatabaseTransaction,
  fixture: CartFixture,
  key: string,
): Promise<void> {
  const input = {
    items: fixture.bulkSkuIds.map((skuId, index) => ({
      quantity: 1,
      selected: index % 2 === 0,
      skuId,
    })),
  };

  const mergeStartedAt = Date.now();
  const merged = await service.mergeCart(
    fixture.sessions[2],
    input,
    key,
    requestId(),
    '127.0.0.1',
  );
  expect(Date.now() - mergeStartedAt).toBeLessThan(PRODUCTION_TRANSACTION_TIMEOUT_MS);
  expect(merged.cart_id).toBe(fixture.cartIds[2]);
  expect(merged.items).toHaveLength(100);
  expect(merged.items.every((item) => item.quantity === 1 && item.sale_status === 'OUT_OF_STOCK'))
    .toBe(true);
  expect(merged.total_amount).toBe('0.00');

  const replayStartedAt = Date.now();
  const replayed = await service.mergeCart(
    fixture.sessions[2],
    input,
    key,
    requestId(),
    '127.0.0.1',
  );
  expect(Date.now() - replayStartedAt).toBeLessThan(PRODUCTION_TRANSACTION_TIMEOUT_MS);
  expect(replayed.items).toHaveLength(100);
  await expect(database.cartItem.count({ where: { cart_id: fixture.cartIds[2] } })).resolves.toBe(100);
  await expect(database.auditLog.count({
    where: { actor_account_id: fixture.accountIds[2], idempotency_key: key },
  })).resolves.toBe(1);
  await expect(database.idempotencyRecord.findFirst({
    select: { resource_id: true, response_body: true },
    where: { actor_id: fixture.accountIds[2], idempotency_key: key },
  })).resolves.toEqual({ resource_id: null, response_body: null });
}

async function exerciseCartWorkflow(
  config: PlatformRuntimeConfig,
  serviceRuntime: DatabaseRuntime,
  storage: ObjectStoragePort,
  database: DatabaseTransaction,
  fixture: CartFixture,
  keys: WorkflowKeys,
): Promise<void> {
  const service = new StoreCartService(config, serviceRuntime, storage);
  const session = fixture.sessions[0];
  const otherSession = fixture.sessions[1];

  await expect(service.getCart(session)).resolves.toEqual({ cart_id: null, items: [], total_amount: '0.00' });
  await expect(Promise.all([
    database.cart.count({ where: { customer_id: fixture.customerIds[0] } }),
    database.cartItem.count({ where: { cart: { customer_id: fixture.customerIds[0] } } }),
  ])).resolves.toEqual([0, 0]);

  await expect(service.deleteItem(
    session, fixture.unknownSkuId, keys.missingDelete, requestId(), '127.0.0.1',
  )).resolves.toEqual({ cart_id: null, items: [], total_amount: '0.00' });
  await expect(database.cart.count({ where: { customer_id: fixture.customerIds[0] } })).resolves.toBe(0);
  await expect(database.auditLog.count({
    where: { actor_account_id: fixture.accountIds[0], idempotency_key: keys.missingDelete },
  })).resolves.toBe(0);

  await expect(service.putItem(
    session,
    fixture.unknownSkuId,
    { quantity: 1, selected: true },
    keys.unknownPut,
    requestId(),
    '127.0.0.1',
  )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', httpStatus: 404 });
  await expect(Promise.all([
    database.cart.count({ where: { customer_id: fixture.customerIds[0] } }),
    database.idempotencyRecord.count({ where: { idempotency_key: keys.unknownPut } }),
    database.auditLog.count({ where: { idempotency_key: keys.unknownPut } }),
  ])).resolves.toEqual([0, 0, 0]);

  await seedInitialCarts(database, fixture);
  const initial = await service.getCart(session);
  expect(initial.cart_id).toBe(fixture.cartIds[0]);
  const expectedOrder = Object.entries(fixture.initialItemIds)
    .sort(([, left], [, right]) => left.localeCompare(right))
    .map(([name]) => fixture.skuIds[name as keyof CartFixture['skuIds']]);
  expect(initial.items.map(({ sku_id }) => sku_id)).toEqual(expectedOrder);
  expect(initial.total_amount).toBe('25.00');
  expect(itemBySku(initial, fixture.skuIds.saleableSelected)).toMatchObject({
    available_stock: 100,
    primary_image_url: `${publicBaseUrl}/public/${fixture.fileIds.valid}`,
    quantity: 2,
    sale_status: 'SALEABLE',
    selected: true,
  });
  expect(itemBySku(initial, fixture.skuIds.saleableUnselected)?.sale_status).toBe('SALEABLE');
  expect(itemBySku(initial, fixture.skuIds.insufficient)).toMatchObject({
    available_stock: 2,
    quantity: 5,
    sale_status: 'INSUFFICIENT_STOCK',
  });
  expect(itemBySku(initial, fixture.skuIds.missingStock)).toMatchObject({
    available_stock: 0,
    sale_status: 'OUT_OF_STOCK',
  });
  expect(itemBySku(initial, fixture.skuIds.inactive)?.sale_status).toBe('INACTIVE');
  expect(itemBySku(initial, fixture.skuIds.archivedStatusOnly)?.sale_status).toBe('DELETED');
  expect(itemBySku(initial, fixture.skuIds.productArchivedStatusOnly)?.sale_status).toBe('DELETED');
  expect(itemBySku(initial, fixture.skuIds.brandInactive)?.sale_status).toBe('INACTIVE');
  expect(itemBySku(initial, fixture.skuIds.categoryInactive)?.sale_status).toBe('INACTIVE');
  expect(itemBySku(initial, fixture.skuIds.imageInvalid)).toMatchObject({
    primary_image_url: null,
    sale_status: 'SALEABLE',
  });

  const otherCart = await service.getCart(otherSession);
  expect(otherCart.cart_id).toBe(fixture.cartIds[1]);
  expect(otherCart.items.map(({ sku_id }) => sku_id)).toEqual([fixture.skuIds.saleableSelected]);
  await expect(service.getCart({ ...session, customerId: fixture.customerIds[1] }))
    .rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });

  await exerciseMaximumMerge(service, database, fixture, keys.bulkMerge);

  await expect(service.putItem(
    session,
    fixture.skuIds.saleableSelected,
    { quantity: 2, selected: true },
    keys.noOpPut,
    requestId(),
    '127.0.0.1',
  )).resolves.toMatchObject({ cart_id: fixture.cartIds[0], total_amount: '25.00' });
  await expect(database.auditLog.count({
    where: { actor_account_id: fixture.accountIds[0], idempotency_key: keys.noOpPut },
  })).resolves.toBe(0);

  const inactiveWrite = await service.putItem(
    session,
    fixture.skuIds.inactiveWrite,
    { quantity: 1, selected: true },
    keys.inactiveWrite,
    requestId(),
    '127.0.0.1',
  );
  expect(itemBySku(inactiveWrite, fixture.skuIds.inactiveWrite)?.sale_status).toBe('INACTIVE');
  const deletedWrite = await service.putItem(
    session,
    fixture.skuIds.deletedWrite,
    { quantity: 1, selected: true },
    keys.deletedWrite,
    requestId(),
    '127.0.0.1',
  );
  expect(itemBySku(deletedWrite, fixture.skuIds.deletedWrite)?.sale_status).toBe('DELETED');

  const beforeUnknownMerge = await database.cartItem.findUnique({
    select: { quantity: true, selected: true },
    where: {
      cart_id_sku_id: { cart_id: fixture.cartIds[0], sku_id: fixture.skuIds.mergeExisting },
    },
  });
  const beforeUnknownCount = await database.cartItem.count({ where: { cart_id: fixture.cartIds[0] } });
  await expect(service.mergeCart(
    session,
    {
      items: [
        { quantity: 2, selected: true, skuId: fixture.skuIds.mergeExisting },
        { quantity: 1, selected: true, skuId: fixture.unknownSkuId },
      ],
    },
    keys.mergeUnknown,
    requestId(),
    '127.0.0.1',
  )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND', httpStatus: 404 });
  await expect(database.cartItem.findUnique({
    select: { quantity: true, selected: true },
    where: {
      cart_id_sku_id: { cart_id: fixture.cartIds[0], sku_id: fixture.skuIds.mergeExisting },
    },
  })).resolves.toEqual(beforeUnknownMerge);
  await expect(Promise.all([
    database.cartItem.count({ where: { cart_id: fixture.cartIds[0] } }),
    database.idempotencyRecord.count({ where: { idempotency_key: keys.mergeUnknown } }),
    database.auditLog.count({ where: { idempotency_key: keys.mergeUnknown } }),
  ])).resolves.toEqual([beforeUnknownCount, 0, 0]);

  const mergeInput = {
    items: [
      { quantity: 2, selected: true, skuId: fixture.skuIds.mergeExisting },
      { quantity: 1, selected: false, skuId: fixture.skuIds.mergeNew },
    ],
  };
  const merged = await service.mergeCart(session, mergeInput, keys.merge, requestId(), '127.0.0.1');
  expect(itemBySku(merged, fixture.skuIds.mergeExisting)).toMatchObject({ quantity: 99, selected: true });
  expect(itemBySku(merged, fixture.skuIds.mergeNew)).toMatchObject({ quantity: 1, selected: false });
  const replayed = await service.mergeCart(session, mergeInput, keys.merge, requestId(), '127.0.0.1');
  expect(itemBySku(replayed, fixture.skuIds.mergeExisting)).toMatchObject({ quantity: 99, selected: true });
  await expect(database.auditLog.count({
    where: { actor_account_id: fixture.accountIds[0], idempotency_key: keys.merge },
  })).resolves.toBe(1);

  await expect(service.mergeCart(
    session,
    { items: [{ ...mergeInput.items[0]!, quantity: 1 }, mergeInput.items[1]!] },
    keys.merge,
    requestId(),
    '127.0.0.1',
  )).rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });
  await expect(service.mergeCart(
    session,
    { items: [...mergeInput.items].reverse() },
    keys.merge,
    requestId(),
    '127.0.0.1',
  )).rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });
  await expect(database.cartItem.findUnique({
    select: { quantity: true, selected: true },
    where: {
      cart_id_sku_id: { cart_id: fixture.cartIds[0], sku_id: fixture.skuIds.mergeExisting },
    },
  })).resolves.toEqual({ quantity: 99, selected: true });

  await exerciseFaultRollback(config, serviceRuntime, storage, database, fixture, keys);

  const idempotency = await database.idempotencyRecord.findMany({
    orderBy: { idempotency_key: 'asc' },
    where: { actor_id: fixture.accountIds[0] },
  });
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
  for (const skuId of Object.values(fixture.skuIds)) {
    expect(persistedPreferenceSafeFacts).not.toContain(skuId);
  }
  for (const productName of Object.values(fixture.names)) {
    expect(persistedPreferenceSafeFacts).not.toContain(productName);
  }
  expect(persistedPreferenceSafeFacts).not.toContain('"quantity"');
  expect(persistedPreferenceSafeFacts).not.toContain('"selected"');
}

integrationDescribe('B8.2 Store cart service and PostgreSQL integration', () => {
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

  rollbackIt('keeps the complete cart workflow atomic with transaction-bound runtime rollback', async () => {
    const fixture = createFixture();
    const keys = workflowKeys();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedFixture(transaction, fixture);
      const boundRuntime = transactionBoundRuntime(runtime, transaction);
      await exerciseCartWorkflow(config, boundRuntime, storage, transaction, fixture, keys);
      throw rollbackSentinel;
    }, transactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(runtime, fixture);
  }, 210_000);

  fullIt('commits the cart workflow and leaves no facts after exact migrator cleanup', async () => {
    const fixture = createFixture();
    const keys = workflowKeys();
    try {
      await runtime.withPrismaTransaction(
        (transaction) => seedFixture(transaction, fixture),
        transactionOptions,
      );
      await exerciseCartWorkflow(config, runtime, storage, runtime.prisma, fixture, keys);
    } finally {
      if (cleanupConnection) cleanupFullFixture(cleanupConnection, fixture);
    }
    await assertNoFixtureFacts(runtime, fixture);
  }, 210_000);
});
