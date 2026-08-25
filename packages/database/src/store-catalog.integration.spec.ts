import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { StoreCatalogRepository } from './store-catalog.repository';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B6_STORE_CATALOG_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B6_STORE_CATALOG_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackOptions = mode === 'rollback'
  ? { isolationLevel: 'RepeatableRead' as const, maxWait: 15_000, timeout: 60_000 }
  : undefined;
const fixtureTransactionOptions = {
  isolationLevel: 'RepeatableRead' as const,
  maxWait: 15_000,
  timeout: 60_000,
};
const rollbackSentinel = Object.freeze({ code: 'B6_STORE_CATALOG_ROLLBACK_SENTINEL' });
const ALLOWED_ORIGIN = 'https://mall.example.test';

interface FixtureIds {
  activeBrandId: string;
  inactiveBrandId: string;
  activeCategoryId: string;
  inactiveCategoryId: string;
  salableProductId: string;
  soldOutProductId: string;
  hiddenProductId: string;
  inactiveBrandProductId: string;
  inactiveCategoryProductId: string;
  inactiveSkuOnlyProductId: string;
  activeSkuId: string;
  zeroSkuId: string;
  missingBalanceSkuId: string;
  inactiveSkuId: string;
  soldOutSkuId: string;
  hiddenSkuId: string;
  inactiveBrandProductSkuId: string;
  inactiveCategoryProductSkuId: string;
  inactiveOnlySkuId: string;
  balanceIds: string[];
  fileIds: string[];
  imageIds: string[];
  bannerIds: string[];
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B6 Store catalog database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B6 Store catalog tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B6 Store catalog tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b6-store-catalog-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B6 Store catalog tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b6-store-catalog-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function createFixtureIds(): FixtureIds {
  return {
    activeBrandId: generateUlid(),
    inactiveBrandId: generateUlid(),
    activeCategoryId: generateUlid(),
    inactiveCategoryId: generateUlid(),
    salableProductId: generateUlid(),
    soldOutProductId: generateUlid(),
    hiddenProductId: generateUlid(),
    inactiveBrandProductId: generateUlid(),
    inactiveCategoryProductId: generateUlid(),
    inactiveSkuOnlyProductId: generateUlid(),
    activeSkuId: generateUlid(),
    zeroSkuId: generateUlid(),
    missingBalanceSkuId: generateUlid(),
    inactiveSkuId: generateUlid(),
    soldOutSkuId: generateUlid(),
    hiddenSkuId: generateUlid(),
    inactiveBrandProductSkuId: generateUlid(),
    inactiveCategoryProductSkuId: generateUlid(),
    inactiveOnlySkuId: generateUlid(),
    balanceIds: [generateUlid(), generateUlid(), generateUlid()],
    fileIds: Array.from({ length: 7 }, () => generateUlid()),
    imageIds: [generateUlid(), generateUlid(), generateUlid()],
    bannerIds: Array.from({ length: 8 }, () => generateUlid()),
  };
}

function transactionBoundRepository(transaction: DatabaseTransaction, now: Date): StoreCatalogRepository {
  const client = {
    $transaction: async (work: (nested: DatabaseTransaction) => unknown) => work(transaction),
  } as unknown as PrismaClient;
  return new StoreCatalogRepository(client, [ALLOWED_ORIGIN], () => now);
}

databaseDescribe('B6 Store catalog database integration', () => {
  let runtime: DatabaseRuntime;
  let now: Date;

  beforeAll(async () => {
    runtime = runtimeForMode();
    now = new Date();
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function createFile(
    transaction: DatabaseTransaction,
    id: string,
    purpose: 'BANNER' | 'BRAND_LOGO' | 'CATEGORY_ICON' | 'PRODUCT_IMAGE',
    visibility: 'PRIVATE' | 'PUBLIC' = 'PUBLIC',
  ): Promise<void> {
    await transaction.fileAsset.create({
      data: {
        byte_size: 1_024n,
        created_at: now,
        id,
        mime_type: 'image/png',
        object_key: `${visibility === 'PUBLIC' ? 'public' : 'private'}/${id}`,
        original_name: `${purpose.toLowerCase()}.png`,
        purpose,
        sha256: 'a'.repeat(64),
        status: 'READY',
        visibility,
      },
    });
  }

  async function seedFixture(transaction: DatabaseTransaction, ids: FixtureIds): Promise<void> {
    const [logoFileId, iconFileId, productImageFileId, privateImageFileId, bannerFileId,
      wrongBannerFileId, pendingImageFileId] = ids.fileIds;
    if (!logoFileId || !iconFileId || !productImageFileId || !privateImageFileId ||
      !bannerFileId || !wrongBannerFileId || !pendingImageFileId) {
      throw new Error('B6 fixture file IDs are incomplete');
    }
    await createFile(transaction, logoFileId, 'BRAND_LOGO');
    await createFile(transaction, iconFileId, 'CATEGORY_ICON');
    await createFile(transaction, productImageFileId, 'PRODUCT_IMAGE');
    await createFile(transaction, privateImageFileId, 'PRODUCT_IMAGE');
    await createFile(transaction, bannerFileId, 'BANNER');
    await createFile(transaction, wrongBannerFileId, 'BANNER');
    await createFile(transaction, pendingImageFileId, 'PRODUCT_IMAGE');
    await transaction.brand.createMany({
      data: [
        {
          created_at: now,
          id: ids.activeBrandId,
          logo_file_id: logoFileId,
          name: `B6 active brand ${ids.activeBrandId}`,
          sort_order: 0,
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          created_at: now,
          id: ids.inactiveBrandId,
          name: `B6 inactive brand ${ids.inactiveBrandId}`,
          sort_order: 1,
          status: 'INACTIVE',
          updated_at: now,
        },
      ],
    });
    await transaction.category.createMany({
      data: [
        {
          created_at: now,
          icon_file_id: iconFileId,
          id: ids.activeCategoryId,
          name: `B6 active category ${ids.activeCategoryId}`,
          sort_order: 0,
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          created_at: now,
          id: ids.inactiveCategoryId,
          name: `B6 inactive category ${ids.inactiveCategoryId}`,
          sort_order: 1,
          status: 'INACTIVE',
          updated_at: now,
        },
      ],
    });
    await transaction.product.createMany({
      data: [
        {
          brand_id: ids.activeBrandId,
          category_id: ids.activeCategoryId,
          created_at: now,
          id: ids.salableProductId,
          is_hot: true,
          is_new: false,
          name: `B6 Literal%_\\Serum ${ids.salableProductId}`,
          published_at: new Date(now.getTime() - 60_000),
          sales_count: 500,
          spu_code: `B6-SPU-${ids.salableProductId}`,
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          brand_id: ids.activeBrandId,
          category_id: ids.activeCategoryId,
          created_at: now,
          id: ids.soldOutProductId,
          is_hot: false,
          is_new: true,
          name: `B6 sold out ${ids.soldOutProductId}`,
          published_at: now,
          sales_count: 20,
          spu_code: `B6-SPU-${ids.soldOutProductId}`,
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          brand_id: ids.activeBrandId,
          category_id: ids.activeCategoryId,
          created_at: now,
          id: ids.hiddenProductId,
          name: `B6 hidden ${ids.hiddenProductId}`,
          spu_code: `B6-SPU-${ids.hiddenProductId}`,
          status: 'INACTIVE',
          updated_at: now,
        },
        {
          brand_id: ids.inactiveBrandId,
          category_id: ids.activeCategoryId,
          created_at: now,
          id: ids.inactiveBrandProductId,
          name: `B6 inactive brand product ${ids.inactiveBrandProductId}`,
          published_at: now,
          spu_code: `B6-SPU-${ids.inactiveBrandProductId}`,
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          brand_id: ids.activeBrandId,
          category_id: ids.inactiveCategoryId,
          created_at: now,
          id: ids.inactiveCategoryProductId,
          name: `B6 inactive category product ${ids.inactiveCategoryProductId}`,
          published_at: now,
          spu_code: `B6-SPU-${ids.inactiveCategoryProductId}`,
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          brand_id: ids.activeBrandId,
          category_id: ids.activeCategoryId,
          created_at: now,
          id: ids.inactiveSkuOnlyProductId,
          name: `B6 inactive SKU only product ${ids.inactiveSkuOnlyProductId}`,
          published_at: now,
          spu_code: `B6-SPU-${ids.inactiveSkuOnlyProductId}`,
          status: 'ACTIVE',
          updated_at: now,
        },
      ],
    });
    await transaction.sku.createMany({
      data: [
        {
          code: `B6-SKU-${ids.activeSkuId}`,
          created_at: new Date(now.getTime() - 5_000),
          id: ids.activeSkuId,
          is_recommended: true,
          name: 'B6 salable SKU',
          product_id: ids.salableProductId,
          retail_price: '19.90',
          spec_json: { attributes: [{ name: 'Size', value: '500ml' }] },
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.zeroSkuId}`,
          created_at: new Date(now.getTime() - 4_000),
          id: ids.zeroSkuId,
          name: 'B6 zero SKU',
          product_id: ids.salableProductId,
          retail_price: '10.00',
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.missingBalanceSkuId}`,
          created_at: new Date(now.getTime() - 3_000),
          id: ids.missingBalanceSkuId,
          name: 'B6 missing balance SKU',
          product_id: ids.salableProductId,
          retail_price: '15.00',
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.inactiveSkuId}`,
          created_at: new Date(now.getTime() - 2_000),
          id: ids.inactiveSkuId,
          name: 'B6 inactive SKU',
          product_id: ids.salableProductId,
          retail_price: '1.00',
          status: 'INACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.soldOutSkuId}`,
          created_at: now,
          id: ids.soldOutSkuId,
          name: 'B6 sold out SKU',
          product_id: ids.soldOutProductId,
          retail_price: '9.00',
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.hiddenSkuId}`,
          created_at: now,
          id: ids.hiddenSkuId,
          name: 'B6 hidden product SKU',
          product_id: ids.hiddenProductId,
          retail_price: '8.00',
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.inactiveBrandProductSkuId}`,
          created_at: now,
          id: ids.inactiveBrandProductSkuId,
          name: 'B6 inactive brand product SKU',
          product_id: ids.inactiveBrandProductId,
          retail_price: '6.00',
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.inactiveCategoryProductSkuId}`,
          created_at: now,
          id: ids.inactiveCategoryProductSkuId,
          name: 'B6 inactive category product SKU',
          product_id: ids.inactiveCategoryProductId,
          retail_price: '5.00',
          status: 'ACTIVE',
          updated_at: now,
        },
        {
          code: `B6-SKU-${ids.inactiveOnlySkuId}`,
          created_at: now,
          id: ids.inactiveOnlySkuId,
          name: 'B6 inactive-only SKU',
          product_id: ids.inactiveSkuOnlyProductId,
          retail_price: '4.00',
          status: 'INACTIVE',
          updated_at: now,
        },
      ],
    });
    const [activeBalanceId, zeroBalanceId, hiddenBalanceId] = ids.balanceIds;
    if (!activeBalanceId || !zeroBalanceId || !hiddenBalanceId) {
      throw new Error('B6 fixture balance IDs are incomplete');
    }
    await transaction.inventoryBalance.createMany({
      data: [
        { id: activeBalanceId, locked_qty: 2, physical_qty: 7, sku_id: ids.activeSkuId, updated_at: now },
        { id: zeroBalanceId, locked_qty: 0, physical_qty: 0, sku_id: ids.zeroSkuId, updated_at: now },
        { id: hiddenBalanceId, locked_qty: 0, physical_qty: 5, sku_id: ids.hiddenSkuId, updated_at: now },
      ],
    });
    const [validImageId, privateImageId, pendingImageId] = ids.imageIds;
    if (!validImageId || !privateImageId || !pendingImageId) {
      throw new Error('B6 fixture image IDs are incomplete');
    }
    await transaction.productImage.createMany({
      data: [
        {
          created_at: now,
          file_id: privateImageFileId,
          id: privateImageId,
          product_id: ids.salableProductId,
          sort_order: 0,
        },
        {
          created_at: now,
          file_id: pendingImageFileId,
          id: pendingImageId,
          product_id: ids.salableProductId,
          sort_order: 1,
        },
        {
          created_at: now,
          file_id: productImageFileId,
          id: validImageId,
          product_id: ids.salableProductId,
          sort_order: 2,
        },
      ],
    });
    await transaction.fileAsset.update({
      data: { object_key: `private/${privateImageFileId}`, visibility: 'PRIVATE' },
      where: { id: privateImageFileId },
    });
    await transaction.fileAsset.update({
      data: { status: 'PENDING' },
      where: { id: pendingImageFileId },
    });
    const [noneBannerId, productBannerId, hiddenTargetBannerId, invalidFileBannerId,
      allowedUrlBannerId, disallowedUrlBannerId, futureBannerId, endedBannerId] = ids.bannerIds;
    if (!noneBannerId || !productBannerId || !hiddenTargetBannerId || !invalidFileBannerId ||
      !allowedUrlBannerId || !disallowedUrlBannerId || !futureBannerId || !endedBannerId) {
      throw new Error('B6 fixture Banner IDs are incomplete');
    }
    await transaction.banner.createMany({
      data: [
        {
          created_at: now,
          file_id: bannerFileId,
          id: noneBannerId,
          sort_order: 0,
          status: 'ACTIVE',
          target_type: 'NONE',
          title: 'B6 none',
          updated_at: now,
        },
        {
          created_at: now,
          file_id: bannerFileId,
          id: productBannerId,
          sort_order: 1,
          status: 'ACTIVE',
          target_id: ids.salableProductId,
          target_type: 'PRODUCT',
          title: 'B6 product',
          updated_at: now,
        },
        {
          created_at: now,
          file_id: bannerFileId,
          id: hiddenTargetBannerId,
          sort_order: 2,
          status: 'ACTIVE',
          target_id: ids.inactiveBrandProductId,
          target_type: 'PRODUCT',
          title: 'B6 hidden target',
          updated_at: now,
        },
        {
          created_at: now,
          file_id: wrongBannerFileId,
          id: invalidFileBannerId,
          sort_order: 3,
          status: 'ACTIVE',
          target_type: 'NONE',
          title: 'B6 invalid file',
          updated_at: now,
        },
        {
          created_at: now,
          file_id: bannerFileId,
          id: allowedUrlBannerId,
          sort_order: 4,
          status: 'ACTIVE',
          target_type: 'URL',
          target_url: `${ALLOWED_ORIGIN}/campaign`,
          title: 'B6 allowed URL',
          updated_at: now,
        },
        {
          created_at: now,
          file_id: bannerFileId,
          id: disallowedUrlBannerId,
          sort_order: 5,
          status: 'ACTIVE',
          target_type: 'URL',
          target_url: 'https://other.example.test/campaign',
          title: 'B6 disallowed URL',
          updated_at: now,
        },
        {
          created_at: now,
          file_id: bannerFileId,
          id: futureBannerId,
          sort_order: 6,
          starts_at: new Date(now.getTime() + 1),
          status: 'ACTIVE',
          target_type: 'NONE',
          title: 'B6 future',
          updated_at: now,
        },
        {
          created_at: now,
          ends_at: now,
          file_id: bannerFileId,
          id: endedBannerId,
          sort_order: 7,
          status: 'ACTIVE',
          target_type: 'NONE',
          title: 'B6 ended',
          updated_at: now,
        },
      ],
    });
    await transaction.fileAsset.update({
      data: { purpose: 'PRODUCT_IMAGE' },
      where: { id: wrongBannerFileId },
    });
  }

  async function assertCatalogFacts(catalog: StoreCatalogRepository, ids: FixtureIds): Promise<void> {
    const brands = await catalog.listBrands();
    const categories = await catalog.listCategories();
    expect(brands.find(({ id }) => id === ids.activeBrandId)?.logoObjectKey).toBe(`public/${ids.fileIds[0]}`);
    expect(brands.some(({ id }) => id === ids.inactiveBrandId)).toBe(false);
    expect(categories.find(({ id }) => id === ids.activeCategoryId)?.iconObjectKey)
      .toBe(`public/${ids.fileIds[1]}`);
    expect(categories.some(({ id }) => id === ids.inactiveCategoryId)).toBe(false);

    const literalSearch = await catalog.listProducts({
      brandId: ids.activeBrandId,
      categoryId: ids.activeCategoryId,
      keyword: 'literal%_\\serum',
      page: 1,
      pageSize: 20,
      sort: 'PRICE_ASC',
    });
    expect(literalSearch.total).toBe(1);
    expect(literalSearch.items[0]).toMatchObject({
      id: ids.salableProductId,
      isSalable: true,
      minimumActivePrice: '10.00',
      primaryImage: { isPrimary: true, objectKey: `public/${ids.fileIds[2]}`, sortOrder: 2 },
    });

    const priceOrder = await catalog.listProducts({
      brandId: ids.activeBrandId,
      categoryId: ids.activeCategoryId,
      page: 1,
      pageSize: 20,
      sort: 'PRICE_ASC',
    });
    const fixtureOrder = priceOrder.items
      .filter(({ id }) => id === ids.salableProductId || id === ids.soldOutProductId)
      .map(({ id }) => id);
    expect(fixtureOrder).toEqual([ids.soldOutProductId, ids.salableProductId]);
    expect(priceOrder.items.find(({ id }) => id === ids.soldOutProductId))
      .toMatchObject({ isSalable: false, minimumActivePrice: '9.00' });

    const expectedOrders = new Map([
      ['COMPREHENSIVE', [ids.salableProductId, ids.soldOutProductId]],
      ['HOT', [ids.salableProductId, ids.soldOutProductId]],
      ['NEWEST', [ids.soldOutProductId, ids.salableProductId]],
      ['PRICE_ASC', [ids.soldOutProductId, ids.salableProductId]],
      ['PRICE_DESC', [ids.salableProductId, ids.soldOutProductId]],
    ] as const);
    for (const [sort, expected] of expectedOrders) {
      const result = await catalog.listProducts({
        brandId: ids.activeBrandId,
        categoryId: ids.activeCategoryId,
        page: 1,
        pageSize: 20,
        sort,
      });
      expect(result.items
        .filter(({ id }) => id === ids.salableProductId || id === ids.soldOutProductId)
        .map(({ id }) => id)).toEqual(expected);
    }
    const firstPage = await catalog.listProducts({
      brandId: ids.activeBrandId,
      categoryId: ids.activeCategoryId,
      page: 1,
      pageSize: 1,
      sort: 'PRICE_ASC',
    });
    const repeatedFirstPage = await catalog.listProducts({
      brandId: ids.activeBrandId,
      categoryId: ids.activeCategoryId,
      page: 1,
      pageSize: 1,
      sort: 'PRICE_ASC',
    });
    const secondPage = await catalog.listProducts({
      brandId: ids.activeBrandId,
      categoryId: ids.activeCategoryId,
      page: 2,
      pageSize: 1,
      sort: 'PRICE_ASC',
    });
    expect(firstPage.total).toBe(2);
    expect(firstPage.items.map(({ id }) => id)).toEqual([ids.soldOutProductId]);
    expect(repeatedFirstPage.items.map(({ id }) => id)).toEqual([ids.soldOutProductId]);
    expect(secondPage.items.map(({ id }) => id)).toEqual([ids.salableProductId]);

    const detail = await catalog.getProduct(ids.salableProductId);
    expect(detail?.skus.map(({ id }) => id)).toEqual([
      ids.activeSkuId,
      ids.zeroSkuId,
      ids.missingBalanceSkuId,
    ]);
    expect(detail?.skus.map(({ availableStock, isSalable }) => ({ availableStock, isSalable })))
      .toEqual([
        { availableStock: 5, isSalable: true },
        { availableStock: 0, isSalable: false },
        { availableStock: 0, isSalable: false },
      ]);
    await expect(catalog.getProduct(ids.hiddenProductId)).resolves.toBeNull();
    await expect(catalog.getProduct(ids.inactiveBrandProductId)).resolves.toBeNull();
    await expect(catalog.getProduct(ids.inactiveCategoryProductId)).resolves.toBeNull();
    await expect(catalog.getProduct(ids.inactiveSkuOnlyProductId)).resolves.toBeNull();
  }

  async function assertNoFixtureFacts(ids: FixtureIds): Promise<void> {
    await expect(Promise.all([
      runtime.prisma.banner.count({ where: { id: { in: ids.bannerIds } } }),
      runtime.prisma.productImage.count({ where: { id: { in: ids.imageIds } } }),
      runtime.prisma.inventoryBalance.count({ where: { id: { in: ids.balanceIds } } }),
      runtime.prisma.sku.count({
        where: {
          id: {
            in: [ids.activeSkuId, ids.zeroSkuId, ids.missingBalanceSkuId, ids.inactiveSkuId,
              ids.soldOutSkuId, ids.hiddenSkuId, ids.inactiveBrandProductSkuId,
              ids.inactiveCategoryProductSkuId, ids.inactiveOnlySkuId],
          },
        },
      }),
      runtime.prisma.product.count({
        where: {
          id: {
            in: [ids.salableProductId, ids.soldOutProductId, ids.hiddenProductId,
              ids.inactiveBrandProductId, ids.inactiveCategoryProductId, ids.inactiveSkuOnlyProductId],
          },
        },
      }),
      runtime.prisma.category.count({
        where: { id: { in: [ids.activeCategoryId, ids.inactiveCategoryId] } },
      }),
      runtime.prisma.brand.count({ where: { id: { in: [ids.activeBrandId, ids.inactiveBrandId] } } }),
      runtime.prisma.fileAsset.count({ where: { id: { in: ids.fileIds } } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  }

  fullIt('enforces public visibility, literal search, stable price order, inventory fail-safe and home targets', async () => {
    const ids = createFixtureIds();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedFixture(transaction, ids);
      const catalog = transactionBoundRepository(transaction, now);
      await assertCatalogFacts(catalog, ids);
      const [banners, homeCategories, hotProducts, newProducts] = await Promise.all([
        catalog.listHomeBanners(),
        catalog.listHomeCategories(),
        catalog.listHomeHotProducts(),
        catalog.listHomeNewProducts(),
      ]);
      const fixtureBannerIds = banners.map(({ id }) => id).filter((id) => ids.bannerIds.includes(id));
      expect(fixtureBannerIds).toEqual([ids.bannerIds[0], ids.bannerIds[1], ids.bannerIds[4]]);
      expect(homeCategories.some(({ id }) => id === ids.activeCategoryId)).toBe(true);
      expect(hotProducts.some(({ id }) => id === ids.salableProductId)).toBe(true);
      expect(newProducts.some(({ id }) => id === ids.soldOutProductId)).toBe(true);
      throw rollbackSentinel;
    }, fixtureTransactionOptions)).rejects.toBe(rollbackSentinel);
    await assertNoFixtureFacts(ids);
  }, 90_000);

  rollbackIt('executes all public repository reads and leaves no fixture facts after rollback', async () => {
    const ids = createFixtureIds();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await seedFixture(transaction, ids);
      const catalog = transactionBoundRepository(transaction, now);
      await assertCatalogFacts(catalog, ids);
      await Promise.all([
        catalog.listHomeBanners(),
        catalog.listHomeCategories(),
        catalog.listHomeHotProducts(),
        catalog.listHomeNewProducts(),
      ]);
      throw rollbackSentinel;
    }, rollbackOptions)).rejects.toBe(rollbackSentinel);

    await assertNoFixtureFacts(ids);
  }, 90_000);
});
