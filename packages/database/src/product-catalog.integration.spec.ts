import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DatabaseTransaction } from './idempotency.repository';
import { ProductCatalogRepository, type CreateProductInput } from './product-catalog.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B4_PRODUCT_CATALOG_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B4_PRODUCT_CATALOG_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackOptions = mode === 'rollback'
  ? { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 60_000 }
  : undefined;
const rollbackSentinel = Object.freeze({ code: 'B4_PRODUCT_CATALOG_ROLLBACK_SENTINEL' });

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B4 product catalog database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B4 product catalog tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B4 product catalog tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b4-product-catalog-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B4 product catalog tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b4-product-catalog-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

databaseDescribe('B4 product catalog database integration', () => {
  let runtime: DatabaseRuntime;
  let repository: ProductCatalogRepository;
  let now: Date;

  beforeAll(async () => {
    runtime = runtimeForMode();
    now = new Date();
    repository = new ProductCatalogRepository(runtime.prisma, () => now);
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function createFoundation(
    transaction: DatabaseTransaction,
    actorId: string,
    brandId: string,
    categoryId: string,
    fileIds: readonly string[],
  ): Promise<void> {
    await transaction.account.create({
      data: { created_at: now, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE', updated_at: now },
    });
    await transaction.brand.create({
      data: {
        created_at: now,
        id: brandId,
        name: `B4 brand ${brandId}`,
        status: 'ACTIVE',
        updated_at: now,
      },
    });
    await transaction.category.create({
      data: {
        created_at: now,
        id: categoryId,
        name: `B4 category ${categoryId}`,
        status: 'ACTIVE',
        updated_at: now,
      },
    });
    for (const fileId of fileIds) {
      await transaction.fileAsset.create({
        data: {
          byte_size: 1_024n,
          created_at: now,
          created_by_id: actorId,
          id: fileId,
          mime_type: 'image/png',
          object_key: `public/${fileId}`,
          original_name: 'product.png',
          purpose: 'PRODUCT_IMAGE',
          sha256: 'a'.repeat(64),
          status: 'READY',
          visibility: 'PUBLIC',
        },
      });
    }
  }

  function productInput(
    actorId: string,
    brandId: string,
    categoryId: string,
    productId: string,
    spuCode: string,
    fileIds: readonly string[] = [],
  ): CreateProductInput {
    return {
      actorId,
      brandId,
      categoryId,
      id: productId,
      images: fileIds.map((fileId, sortOrder) => ({ fileId, sortOrder })),
      ingredients: null,
      introduction: null,
      isHot: false,
      isNew: false,
      name: `B4 product ${productId}`,
      spuCode,
      subtitle: null,
      usageMethod: null,
    };
  }

  async function createLifecycleFixture(options: { withImage?: boolean } = {}) {
    const actorId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    const skuId = generateUlid();
    const balanceId = generateUlid();
    const fileId = generateUlid();
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createFoundation(transaction, actorId, brandId, categoryId, [fileId]);
      await repository.createProductInTransaction(transaction, productInput(
        actorId,
        brandId,
        categoryId,
        productId,
        `SPU-${productId}`,
        options.withImage === false ? [] : [fileId],
      ));
      await repository.createSkuInTransaction(transaction, {
        code: `SKU-${skuId}`,
        id: skuId,
        inventoryBalanceId: balanceId,
        isRecommended: false,
        name: `Lifecycle SKU ${skuId}`,
        productId,
        retailPrice: '8.80',
        specification: null,
      });
    });
    return { actorId, balanceId, brandId, categoryId, fileId, productId, skuId };
  }

  async function createReservation(
    transaction: DatabaseTransaction,
    skuId: string,
    status: 'ACTIVE' | 'CONSUMED' | 'EXPIRED' | 'RELEASED',
    expiresAt: Date,
  ) {
    const customerAccountId = generateUlid();
    const customerId = generateUlid();
    const orderId = generateUlid();
    const reservationId = generateUlid();
    await transaction.account.create({
      data: {
        created_at: now,
        id: customerAccountId,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        updated_at: now,
      },
    });
    await transaction.customerProfile.create({
      data: {
        account_id: customerAccountId,
        created_at: now,
        id: customerId,
        registered_at: now,
        updated_at: now,
      },
    });
    await transaction.salesOrder.create({
      data: {
        created_at: now,
        customer_id: customerId,
        goods_amount: '8.80',
        id: orderId,
        order_no: `O${orderId}`,
        pay_expires_at: new Date(now.getTime() + 30 * 60_000),
        payable_amount: '8.80',
        source: 'CART',
        updated_at: now,
      },
    });
    await transaction.inventoryReservation.create({
      data: {
        created_at: now,
        expires_at: expiresAt,
        id: reservationId,
        order_id: orderId,
        status,
      },
    });
    await transaction.inventoryReservationItem.create({
      data: {
        created_at: now,
        id: generateUlid(),
        quantity: 2,
        reservation_id: reservationId,
        sku_id: skuId,
      },
    });
    return reservationId;
  }

  fullIt('persists CRUD, stable projections, zero inventory, gallery history, and reserved codes', async () => {
    const actorId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    const skuId = generateUlid();
    const balanceId = generateUlid();
    const firstFileId = generateUlid();
    const secondFileId = generateUlid();
    const spuCode = `SPU-${productId}`;
    const skuCode = `SKU-${skuId}`;

    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createFoundation(transaction, actorId, brandId, categoryId, [firstFileId, secondFileId]);
      await repository.createProductInTransaction(transaction, productInput(
        actorId,
        brandId,
        categoryId,
        productId,
        spuCode,
        [secondFileId, firstFileId],
      ));
      await repository.createSkuInTransaction(transaction, {
        code: skuCode,
        id: skuId,
        inventoryBalanceId: balanceId,
        isRecommended: true,
        name: 'B4 SKU',
        productId,
        retailPrice: '12.30',
        specification: { attributes: [{ name: 'Size', value: '500ml' }] },
      });
    });

    await expect(repository.getProduct(productId)).resolves.toMatchObject({
      images: [
        { fileId: secondFileId, isPrimary: true, sortOrder: 0 },
        { fileId: firstFileId, isPrimary: false, sortOrder: 1 },
      ],
      minimumActivePrice: null,
      skus: [{
        code: skuCode,
        inventory: { availableQty: 0, lockedQty: 0, physicalQty: 0 },
        status: 'INACTIVE',
      }],
      status: 'DRAFT',
      version: 1,
    });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) => repository.updateSkuInTransaction(
      transaction,
      {
        expectedVersion: 1,
        id: skuId,
        patch: { isRecommended: true, retailPrice: '9.90', specification: null },
      },
    ))).resolves.toMatchObject({ retailPrice: '9.90', specification: null, version: 2 });
    await runtime.prisma.sku.update({ where: { id: skuId }, data: { status: 'ACTIVE' } });
    await expect(repository.listProducts({ page: 1, pageSize: 100, recommended: true })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({
        activeSkuCount: 1,
        minimumActivePrice: '9.90',
        skuCount: 1,
      })]),
    });

    await runSerializableTransaction(runtime.prisma, (transaction) => repository.updateProductInTransaction(
      transaction,
      {
        actorId,
        expectedVersion: 1,
        id: productId,
        patch: { images: [{ fileId: firstFileId, sortOrder: 0 }], name: 'B4 renamed product' },
      },
    ));
    await expect(repository.getProduct(productId)).resolves.toMatchObject({
      images: [{ fileId: firstFileId, isPrimary: true, sortOrder: 0 }],
      name: 'B4 renamed product',
      version: 2,
    });
    await expect(Promise.all([
      runtime.prisma.productImage.count({ where: { deleted_at: null, product_id: productId } }),
      runtime.prisma.productImage.count({ where: { deleted_at: { not: null }, product_id: productId } }),
    ])).resolves.toEqual([1, 2]);
    await expect(runSerializableTransaction(runtime.prisma, (transaction) => repository.updateProductInTransaction(
      transaction,
      { actorId, expectedVersion: 1, id: productId, patch: { name: 'Stale' } },
    ))).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

    await runtime.prisma.sku.update({ data: { deleted_at: now, status: 'ARCHIVED' }, where: { id: skuId } });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) => repository.createSkuInTransaction(
      transaction,
      {
        code: skuCode,
        id: generateUlid(),
        inventoryBalanceId: generateUlid(),
        isRecommended: false,
        name: 'Reserved SKU',
        productId,
        retailPrice: '1.00',
        specification: null,
      },
    ))).rejects.toMatchObject({ code: 'SOFT_DELETED_KEY_RESERVED' });

    await runtime.prisma.product.update({
      data: { deleted_at: now, status: 'ARCHIVED' },
      where: { id: productId },
    });
    await expect(repository.listProducts({ page: 1, pageSize: 100 })).resolves.toMatchObject({
      items: expect.not.arrayContaining([expect.objectContaining({ product: expect.objectContaining({ id: productId }) })]),
    });
    await expect(repository.listProducts({ page: 1, pageSize: 100, status: 'ARCHIVED' })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ product: expect.objectContaining({ id: productId }) })]),
    });
    await expect(repository.getProduct(productId)).resolves.toMatchObject({ deletedAt: now, status: 'ARCHIVED' });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) => repository.createProductInTransaction(
      transaction,
      productInput(actorId, brandId, categoryId, generateUlid(), spuCode),
    ))).rejects.toMatchObject({ code: 'SOFT_DELETED_KEY_RESERVED' });
  });

  fullIt('serializes concurrent creation of one SPU code', async () => {
    const actorId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const code = `SPU-CONCURRENT-${generateUlid()}`;
    await runtime.withPrismaTransaction((transaction) => createFoundation(
      transaction,
      actorId,
      brandId,
      categoryId,
      [],
    ));
    const attempts = await Promise.allSettled([generateUlid(), generateUlid()].map((id) =>
      runSerializableTransaction(runtime.prisma, (transaction) => repository.createProductInTransaction(
        transaction,
        productInput(actorId, brandId, categoryId, id, code),
      ))));
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = attempts.find(({ status }) => status === 'rejected');
    expect(rejected).toMatchObject({ reason: { code: 'STATE_CONFLICT' }, status: 'rejected' });
    await expect(runtime.prisma.product.count({ where: { spu_code: code } })).resolves.toBe(1);
  });

  fullIt('serializes concurrent creation of one SKU code and keeps one balance aggregate', async () => {
    const actorId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    const code = `SKU-CONCURRENT-${generateUlid()}`;
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createFoundation(transaction, actorId, brandId, categoryId, []);
      await repository.createProductInTransaction(
        transaction,
        productInput(actorId, brandId, categoryId, productId, `SPU-${productId}`),
      );
    });

    const attempts = await Promise.allSettled([generateUlid(), generateUlid()].map((id) =>
      runSerializableTransaction(runtime.prisma, (transaction) => repository.createSkuInTransaction(
        transaction,
        {
          code,
          id,
          inventoryBalanceId: generateUlid(),
          isRecommended: false,
          name: `Concurrent SKU ${id}`,
          productId,
          retailPrice: '1.00',
          specification: null,
        },
      ))));
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.find(({ status }) => status === 'rejected'))
      .toMatchObject({ reason: { code: 'STATE_CONFLICT' }, status: 'rejected' });
    await expect(runtime.prisma.sku.findUnique({
      include: { inventory_balance: true },
      where: { code },
    })).resolves.toMatchObject({ code, inventory_balance: { locked_qty: 0, physical_qty: 0 } });
  });

  fullIt('rejects cross-owner images and rolls back gallery and SKU aggregate failures', async () => {
    const actorId = generateUlid();
    const otherActorId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    const firstFileId = generateUlid();
    const secondFileId = generateUlid();
    const otherActorFileId = generateUlid();

    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createFoundation(transaction, actorId, brandId, categoryId, [firstFileId, secondFileId]);
      await transaction.account.create({
        data: { created_at: now, id: otherActorId, role: 'SUPER_ADMIN', status: 'ACTIVE', updated_at: now },
      });
      await transaction.fileAsset.create({
        data: {
          byte_size: 1_024n,
          created_at: now,
          created_by_id: otherActorId,
          id: otherActorFileId,
          mime_type: 'image/png',
          object_key: `public/${otherActorFileId}`,
          original_name: 'other-product.png',
          purpose: 'PRODUCT_IMAGE',
          sha256: 'b'.repeat(64),
          status: 'READY',
          visibility: 'PUBLIC',
        },
      });
      await repository.createProductInTransaction(
        transaction,
        productInput(actorId, brandId, categoryId, productId, `SPU-${productId}`, [firstFileId]),
      );
    });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.updateProductInTransaction(transaction, {
        actorId,
        expectedVersion: 1,
        id: productId,
        patch: { images: [{ fileId: otherActorFileId, sortOrder: 0 }] },
      }))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(repository.getProduct(productId)).resolves.toMatchObject({
      images: [{ fileId: firstFileId, sortOrder: 0 }],
      version: 1,
    });

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await repository.updateProductInTransaction(transaction, {
        actorId,
        expectedVersion: 1,
        id: productId,
        patch: { images: [{ fileId: secondFileId, sortOrder: 0 }] },
      });
      throw rollbackSentinel;
    })).rejects.toBe(rollbackSentinel);
    await expect(repository.getProduct(productId)).resolves.toMatchObject({
      images: [{ fileId: firstFileId, sortOrder: 0 }],
      version: 1,
    });

    const firstSkuId = generateUlid();
    const secondSkuId = generateUlid();
    const balanceId = generateUlid();
    await runSerializableTransaction(runtime.prisma, (transaction) => repository.createSkuInTransaction(
      transaction,
      {
        code: `SKU-${firstSkuId}`,
        id: firstSkuId,
        inventoryBalanceId: balanceId,
        isRecommended: false,
        name: 'First SKU',
        productId,
        retailPrice: '2.00',
        specification: null,
      },
    ));
    await expect(runSerializableTransaction(runtime.prisma, (transaction) => repository.createSkuInTransaction(
      transaction,
      {
        code: `SKU-${secondSkuId}`,
        id: secondSkuId,
        inventoryBalanceId: balanceId,
        isRecommended: false,
        name: 'Second SKU',
        productId,
        retailPrice: '3.00',
        specification: null,
      },
    ))).rejects.toBeDefined();
    await expect(runtime.prisma.sku.count({ where: { id: secondSkuId } })).resolves.toBe(0);
  });

  fullIt('allows exactly one concurrent update for a product version', async () => {
    const actorId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createFoundation(transaction, actorId, brandId, categoryId, []);
      await repository.createProductInTransaction(
        transaction,
        productInput(actorId, brandId, categoryId, productId, `SPU-${productId}`),
      );
    });

    const attempts = await Promise.allSettled(['First update', 'Second update'].map((name) =>
      runSerializableTransaction(runtime.prisma, (transaction) => repository.updateProductInTransaction(
        transaction,
        { actorId, expectedVersion: 1, id: productId, patch: { name } },
      ))));
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(attempts.find(({ status }) => status === 'rejected'))
      .toMatchObject({ reason: { code: 'RESOURCE_VERSION_CONFLICT' } });
    await expect(repository.getProduct(productId)).resolves.toMatchObject({ version: 2 });
  });

  fullIt('runs the complete Product/SKU lifecycle while preserving publication and parent-child independence', async () => {
    const { productId, skuId } = await createLifecycleFixture();

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, targetId: skuId, targetType: 'SKU',
      }))).resolves.toMatchObject({ resource: { status: 'ACTIVE', version: 2 }, targetType: 'SKU' });
    const firstActivation = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, targetId: productId, targetType: 'PRODUCT',
      }));
    if (firstActivation.targetType !== 'PRODUCT') throw new TypeError('Expected a Product lifecycle result');
    expect(firstActivation).toMatchObject({ resource: { status: 'ACTIVE', version: 2 }, targetType: 'PRODUCT' });
    expect(firstActivation.resource.publishedAt).toBeInstanceOf(Date);
    const firstPublishedAt = firstActivation.resource.publishedAt;

    await runSerializableTransaction(runtime.prisma, (transaction) => repository.applyLifecycleInTransaction(
      transaction,
      { action: 'DEACTIVATE', expectedVersion: 2, targetId: productId, targetType: 'PRODUCT' },
    ));
    await expect(runtime.prisma.sku.findUnique({ where: { id: skuId } }))
      .resolves.toMatchObject({ status: 'ACTIVE', version: 2 });
    const reactivated = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 3, targetId: productId, targetType: 'PRODUCT',
      }));
    if (reactivated.targetType !== 'PRODUCT') throw new TypeError('Expected a Product lifecycle result');
    expect(reactivated.resource).toMatchObject({ publishedAt: firstPublishedAt, status: 'ACTIVE', version: 4 });

    await runSerializableTransaction(runtime.prisma, (transaction) => repository.applyLifecycleInTransaction(
      transaction,
      { action: 'DEACTIVATE', expectedVersion: 2, targetId: skuId, targetType: 'SKU' },
    ));
    await expect(runtime.prisma.product.findUnique({ where: { id: productId } }))
      .resolves.toMatchObject({ status: 'ACTIVE', version: 4 });
    await runSerializableTransaction(runtime.prisma, (transaction) => repository.applyLifecycleInTransaction(
      transaction,
      { action: 'DEACTIVATE', expectedVersion: 4, targetId: productId, targetType: 'PRODUCT' },
    ));
    const archivedProduct = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'SOFT_DELETE', expectedVersion: 5, targetId: productId, targetType: 'PRODUCT',
      }));
    if (archivedProduct.targetType !== 'PRODUCT') throw new TypeError('Expected a Product lifecycle result');
    expect(archivedProduct.resource).toMatchObject({ publishedAt: firstPublishedAt, status: 'ARCHIVED', version: 6 });
    expect(archivedProduct.resource.deletedAt).toBeInstanceOf(Date);
    await expect(runtime.prisma.sku.findUnique({ where: { id: skuId } }))
      .resolves.toMatchObject({ deleted_at: null, status: 'INACTIVE', version: 3 });

    const restoredProduct = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.restoreProductInTransaction(transaction, { expectedVersion: 6, id: productId }));
    expect(restoredProduct).toMatchObject({
      deletedAt: null,
      publishedAt: firstPublishedAt,
      status: 'DRAFT',
      version: 7,
    });
    await runSerializableTransaction(runtime.prisma, (transaction) => repository.applyLifecycleInTransaction(
      transaction,
      { action: 'SOFT_DELETE', expectedVersion: 3, targetId: skuId, targetType: 'SKU' },
    ));
    await expect(runtime.prisma.product.findUnique({ where: { id: productId } }))
      .resolves.toMatchObject({ deleted_at: null, status: 'DRAFT', version: 7 });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.restoreSkuInTransaction(transaction, { expectedVersion: 4, id: skuId })))
      .resolves.toMatchObject({ deletedAt: null, status: 'INACTIVE', version: 5 });
  });

  fullIt('returns publication impact and rejects image, active-SKU, and SKU-dependency errors without writes', async () => {
    const noImage = await createLifecycleFixture({ withImage: false });
    await runSerializableTransaction(runtime.prisma, (transaction) => repository.applyLifecycleInTransaction(
      transaction,
      { action: 'ACTIVATE', expectedVersion: 1, targetId: noImage.skuId, targetType: 'SKU' },
    ));
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, targetId: noImage.productId, targetType: 'PRODUCT',
      }))).rejects.toMatchObject({ code: 'PRODUCT_PRIMARY_IMAGE_REQUIRED' });
    await expect(runtime.prisma.product.findUnique({ where: { id: noImage.productId } }))
      .resolves.toMatchObject({ published_at: null, status: 'DRAFT', version: 1 });

    const noActiveSku = await createLifecycleFixture();
    const preview = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.getLifecyclePreviewImpactInTransaction(transaction, {
        action: 'ACTIVATE', targetId: noActiveSku.productId, targetType: 'PRODUCT',
      }));
    expect(preview).toMatchObject({
      activeSkuCount: 0,
      brandStatus: 'ACTIVE',
      categoryStatus: 'ACTIVE',
      validPublicImageCount: 1,
    });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, targetId: noActiveSku.productId, targetType: 'PRODUCT',
      }))).rejects.toMatchObject({ code: 'PRODUCT_ACTIVE_SKU_REQUIRED' });

    const activeSku = await createLifecycleFixture();
    await runSerializableTransaction(runtime.prisma, (transaction) => repository.applyLifecycleInTransaction(
      transaction,
      { action: 'ACTIVATE', expectedVersion: 1, targetId: activeSku.skuId, targetType: 'SKU' },
    ));
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'SOFT_DELETE', expectedVersion: 1, targetId: activeSku.productId, targetType: 'PRODUCT',
      }))).rejects.toMatchObject({ code: 'ACTIVE_SKU_DEPENDENCY' });
  });

  fullIt('treats ACTIVE reservation state as authoritative and rolls back a blocked soft delete', async () => {
    const fixture = await createLifecycleFixture();
    let reservationId = '';
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      reservationId = await createReservation(
        transaction,
        fixture.skuId,
        'ACTIVE',
        new Date(now.getTime() - 24 * 60 * 60_000),
      );
    });

    const impact = await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.getLifecyclePreviewImpactInTransaction(transaction, {
        action: 'SOFT_DELETE', targetId: fixture.productId, targetType: 'PRODUCT',
      }));
    expect(impact).toMatchObject({
      activeReservationCount: 1,
      activeReservationIds: [reservationId],
      activeReservationQuantity: 2,
    });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'SOFT_DELETE', expectedVersion: 1, targetId: fixture.productId, targetType: 'PRODUCT',
      }))).rejects.toMatchObject({ code: 'ACTIVE_INVENTORY_RESERVATION' });
    await expect(runtime.prisma.product.findUnique({ where: { id: fixture.productId } }))
      .resolves.toMatchObject({ deleted_at: null, published_at: null, status: 'DRAFT', version: 1 });

    for (const status of ['CONSUMED', 'RELEASED', 'EXPIRED'] as const) {
      await runtime.prisma.inventoryReservation.update({ data: { status }, where: { id: reservationId } });
      await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.getLifecyclePreviewImpactInTransaction(transaction, {
          action: 'SOFT_DELETE', targetId: fixture.productId, targetType: 'PRODUCT',
        }))).resolves.toMatchObject({
        activeReservationCount: 0,
        activeReservationIds: [],
        activeReservationQuantity: 0,
      });
    }
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.applyLifecycleInTransaction(transaction, {
        action: 'SOFT_DELETE', expectedVersion: 1, targetId: fixture.productId, targetType: 'PRODUCT',
      }))).resolves.toMatchObject({ resource: { status: 'ARCHIVED', version: 2 } });
  });

  fullIt('rolls back Product lifecycle status, version, deletion, and first publication together', async () => {
    const fixture = await createLifecycleFixture();
    await runSerializableTransaction(runtime.prisma, (transaction) => repository.applyLifecycleInTransaction(
      transaction,
      { action: 'ACTIVATE', expectedVersion: 1, targetId: fixture.skuId, targetType: 'SKU' },
    ));

    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await repository.applyLifecycleInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, targetId: fixture.productId, targetType: 'PRODUCT',
      });
      throw rollbackSentinel;
    })).rejects.toBe(rollbackSentinel);
    await expect(runtime.prisma.product.findUnique({ where: { id: fixture.productId } })).resolves.toMatchObject({
      deleted_at: null,
      published_at: null,
      status: 'DRAFT',
      version: 1,
    });
  });

  rollbackIt('leaves no Product, SKU, inventory, image, or foundation facts outside rollback-only smoke', async () => {
    const actorId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    const skuId = generateUlid();
    const balanceId = generateUlid();
    const fileId = generateUlid();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await createFoundation(transaction, actorId, brandId, categoryId, [fileId]);
      await repository.createProductInTransaction(
        transaction,
        productInput(actorId, brandId, categoryId, productId, `SPU-${productId}`, [fileId]),
      );
      await repository.createSkuInTransaction(transaction, {
        code: `SKU-${skuId}`,
        id: skuId,
        inventoryBalanceId: balanceId,
        isRecommended: false,
        name: 'Rollback SKU',
        productId,
        retailPrice: '1.00',
        specification: null,
      });
      throw rollbackSentinel;
    }, rollbackOptions)).rejects.toBe(rollbackSentinel);
    await expect(Promise.all([
      runtime.prisma.product.count({ where: { id: productId } }),
      runtime.prisma.sku.count({ where: { id: skuId } }),
      runtime.prisma.inventoryBalance.count({ where: { id: balanceId } }),
      runtime.prisma.productImage.count({ where: { product_id: productId } }),
      runtime.prisma.fileAsset.count({ where: { id: fileId } }),
      runtime.prisma.brand.count({ where: { id: brandId } }),
      runtime.prisma.category.count({ where: { id: categoryId } }),
      runtime.prisma.account.count({ where: { id: actorId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  }, 90_000);
});
