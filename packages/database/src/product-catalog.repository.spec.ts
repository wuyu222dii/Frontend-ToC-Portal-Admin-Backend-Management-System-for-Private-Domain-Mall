import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { ProductCatalogRepository } from './product-catalog.repository';

const NOW = new Date('2026-08-24T08:00:00.000Z');
const actorId = generateUlid(NOW.getTime() - 10_000);
const brandId = generateUlid(NOW.getTime() - 9_000);
const categoryId = generateUlid(NOW.getTime() - 8_000);
const productId = generateUlid(NOW.getTime() - 7_000);
const skuId = generateUlid(NOW.getTime() - 6_000);
const inventoryBalanceId = generateUlid(NOW.getTime() - 5_000);
const imageFileId = generateUlid(NOW.getTime() - 4_000);

function fileRecord(id = imageFileId) {
  return {
    created_by_id: actorId,
    deleted_at: null,
    id,
    object_key: `public/${id}`,
    purpose: 'PRODUCT_IMAGE',
    status: 'READY',
    visibility: 'PUBLIC',
  };
}

function brandRecord(overrides: Record<string, unknown> = {}) {
  return {
    created_at: NOW,
    deleted_at: null,
    description: null,
    id: brandId,
    logo: null,
    logo_file_id: null,
    name: 'Brand A',
    sort_order: 0,
    status: 'ACTIVE',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function categoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    created_at: NOW,
    deleted_at: null,
    icon: null,
    icon_file_id: null,
    id: categoryId,
    name: 'Category A',
    sort_order: 0,
    status: 'ACTIVE',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function inventoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: inventoryBalanceId,
    locked_qty: 3,
    physical_qty: 10,
    sku_id: skuId,
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function skuRecord(overrides: Record<string, unknown> = {}) {
  return {
    code: 'SKU-001',
    created_at: NOW,
    deleted_at: null,
    id: skuId,
    inventory_balance: inventoryRecord(),
    is_recommended: true,
    name: 'SKU One',
    product_id: productId,
    retail_price: '19.90',
    spec_json: { attributes: [{ name: 'Size', value: '500ml' }] },
    status: 'ACTIVE',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function imageRecord(overrides: Record<string, unknown> = {}) {
  return {
    created_at: NOW,
    deleted_at: null,
    file: fileRecord(),
    file_id: imageFileId,
    id: generateUlid(NOW.getTime() - 3_000),
    product_id: productId,
    sort_order: 0,
    ...overrides,
  };
}

function productRecord(overrides: Record<string, unknown> = {}) {
  return {
    brand: brandRecord(),
    brand_id: brandId,
    category: categoryRecord(),
    category_id: categoryId,
    created_at: NOW,
    deleted_at: null,
    id: productId,
    images: [imageRecord()],
    ingredients: null,
    introduction: null,
    is_hot: false,
    is_new: true,
    name: 'Product One',
    published_at: NOW,
    sales_count: 12,
    skus: [skuRecord()],
    spu_code: 'SPU-001',
    status: 'ACTIVE',
    subtitle: 'Subtitle',
    updated_at: NOW,
    usage_method: null,
    version: 1,
    ...overrides,
  };
}

function harness() {
  let product = productRecord();
  let sku = skuRecord();
  const productDelegate = {
    count: vi.fn(async () => 1),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      product = productRecord({ ...data, images: [], skus: [] });
      return product;
    }),
    findMany: vi.fn(async () => [product]),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; spu_code?: string } }) => {
      if (where.spu_code !== undefined) return where.spu_code === product.spu_code ? product : null;
      return where.id === product.id ? product : null;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
      product = productRecord({ ...product, ...data, version: Number(product.version) + increment });
      return { count: 1 };
    }),
  };
  const skuDelegate = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      sku = skuRecord({ ...data, inventory_balance: null });
      return sku;
    }),
    findUnique: vi.fn(async ({ where }: { where: { code?: string; id?: string } }) => {
      if (where.code !== undefined) return where.code === sku.code ? sku : null;
      return where.id === sku.id ? { ...sku, product } : null;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
      sku = skuRecord({ ...sku, ...data, version: Number(sku.version) + increment });
      return { count: 1 };
    }),
  };
  const productImage = {
    createMany: vi.fn(async () => ({ count: 1 })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const inventoryBalance = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      sku = skuRecord({ ...sku, inventory_balance: inventoryRecord(data) });
      return inventoryRecord(data);
    }),
  };
  const fileAsset = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.map((id) => ({ id, object_key: `public/${id}` }))),
  };
  const brand = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === brandId ? brandRecord() : null),
  };
  const category = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === categoryId ? categoryRecord() : null),
  };
  const transactionStub = {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    brand,
    category,
    fileAsset,
    inventoryBalance,
    product: productDelegate,
    productImage,
    sku: skuDelegate,
  };
  const prisma = {
    product: {
      count: productDelegate.count,
      findMany: productDelegate.findMany,
      findUnique: productDelegate.findUnique,
    },
  };
  return {
    brand,
    category,
    fileAsset,
    inventoryBalance,
    prisma,
    productDelegate,
    productImage,
    repository: new ProductCatalogRepository(prisma as unknown as PrismaClient, () => NOW),
    setProduct: (record: ReturnType<typeof productRecord>) => { product = record; },
    setSku: (record: ReturnType<typeof skuRecord>) => { sku = record; },
    skuDelegate,
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

const createProductInput = {
  actorId,
  brandId,
  categoryId,
  id: productId,
  images: [{ fileId: imageFileId, sortOrder: 0 }],
  ingredients: null,
  introduction: null,
  isHot: false,
  isNew: true,
  name: 'Product One',
  spuCode: 'SPU-NEW',
  subtitle: null,
  usageMethod: null,
};

describe('ProductCatalogRepository', () => {
  it('uses stable null-last ordering, excludes archived by default, and returns one inventory snapshot', async () => {
    const { productDelegate, repository } = harness();
    await expect(repository.listProducts({
      keyword: 'SKU-001',
      page: 1,
      pageSize: 20,
      recommended: true,
    })).resolves.toMatchObject({
      items: [{
        activeSkuCount: 1,
        availableQty: 7,
        lockedQty: 3,
        minimumActivePrice: '19.90',
        physicalQty: 10,
        skuCount: 1,
      }],
      total: 1,
    });
    expect(productDelegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ published_at: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      where: expect.objectContaining({ deleted_at: null, status: { not: 'ARCHIVED' } }),
    }));

    await repository.listProducts({ page: 2, pageSize: 10, status: 'ARCHIVED' });
    expect(productDelegate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      skip: 10,
      where: expect.objectContaining({ deleted_at: { not: null }, status: 'ARCHIVED' }),
    }));
  });

  it('returns archived product details and requests all SKUs in stable order', async () => {
    const { productDelegate, repository, setProduct } = harness();
    setProduct(productRecord({ deleted_at: NOW, status: 'ARCHIVED' }));
    await expect(repository.getProduct(productId)).resolves.toMatchObject({
      deletedAt: NOW,
      id: productId,
      status: 'ARCHIVED',
      skus: [{ id: skuId, status: 'ACTIVE' }],
    });
    expect(productDelegate.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({
        images: expect.objectContaining({ orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] }),
        skus: expect.objectContaining({ orderBy: [{ created_at: 'asc' }, { id: 'asc' }] }),
      }),
      where: { id: productId },
    }));
  });

  it('treats a missing SKU inventory row as an internal invariant failure', async () => {
    const { repository, setProduct } = harness();
    setProduct(productRecord({ skus: [skuRecord({ inventory_balance: null })] }));
    await expect(repository.getProduct(productId)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('creates a fixed DRAFT product and validates the complete public image set before insertion', async () => {
    const { fileAsset, productDelegate, productImage, repository, transaction } = harness();
    await repository.createProductInTransaction(transaction, createProductInput);

    expect(fileAsset.findMany).toHaveBeenCalledWith({
      select: { id: true, object_key: true },
      where: {
        created_by_id: actorId,
        deleted_at: null,
        id: { in: [imageFileId] },
        purpose: 'PRODUCT_IMAGE',
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    expect(productDelegate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: productId,
        published_at: null,
        spu_code: 'SPU-NEW',
        status: 'DRAFT',
        version: 1,
      }),
    });
    expect(productImage.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        deleted_at: null,
        file_id: imageFileId,
        product_id: productId,
        sort_order: 0,
      })],
    });
  });

  it('atomically replaces the gallery and increments the product version', async () => {
    const secondFileId = generateUlid(NOW.getTime() - 2_000);
    const { productDelegate, productImage, repository, transaction } = harness();
    await repository.updateProductInTransaction(transaction, {
      actorId,
      expectedVersion: 1,
      id: productId,
      patch: { images: [{ fileId: secondFileId, sortOrder: 2 }], name: 'Renamed product' },
    });

    expect(productDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ name: 'Renamed product', version: { increment: 1 } }),
      where: { deleted_at: null, id: productId, version: 1 },
    }));
    expect(productImage.updateMany).toHaveBeenCalledWith({
      data: { deleted_at: NOW },
      where: { deleted_at: null, product_id: productId },
    });
    expect(productImage.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ file_id: secondFileId, product_id: productId, sort_order: 2 })],
    });
  });

  it('does not let an ordinary PATCH break an ACTIVE product publication prerequisite', async () => {
    const { brand, repository, transaction } = harness();
    brand.findUnique.mockResolvedValueOnce(brandRecord({ status: 'INACTIVE' }));
    await expect(repository.updateProductInTransaction(transaction, {
      actorId,
      expectedVersion: 1,
      id: productId,
      patch: { brandId },
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    await expect(repository.updateProductInTransaction(transaction, {
      actorId,
      expectedVersion: 1,
      id: productId,
      patch: { images: [] },
    })).rejects.toMatchObject({ code: 'PRODUCT_PRIMARY_IMAGE_REQUIRED' });
  });

  it('reserves archived product and SKU codes and rejects stale updates', async () => {
    const { productDelegate, repository, setProduct, setSku, skuDelegate, transaction } = harness();
    setProduct(productRecord({ deleted_at: NOW, spu_code: 'SPU-NEW', status: 'ARCHIVED' }));
    await expect(repository.createProductInTransaction(transaction, createProductInput))
      .rejects.toMatchObject({ code: 'SOFT_DELETED_KEY_RESERVED' });

    setProduct(productRecord({ status: 'DRAFT' }));
    productDelegate.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.updateProductInTransaction(transaction, {
      actorId,
      expectedVersion: 1,
      id: productId,
      patch: { name: 'Stale product' },
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

    setSku(skuRecord({ code: 'SKU-NEW', deleted_at: NOW, status: 'ARCHIVED' }));
    await expect(repository.createSkuInTransaction(transaction, {
      code: 'SKU-NEW',
      id: generateUlid(NOW.getTime() - 1_000),
      inventoryBalanceId: generateUlid(NOW.getTime() - 500),
      isRecommended: false,
      name: 'Archived code reuse',
      productId,
      retailPrice: '9.90',
      specification: null,
    })).rejects.toMatchObject({ code: 'SOFT_DELETED_KEY_RESERVED' });
    expect(skuDelegate.create).not.toHaveBeenCalled();
  });

  it('creates an INACTIVE SKU and its zero inventory balance in the caller transaction', async () => {
    const newSkuId = generateUlid(NOW.getTime() - 1_000);
    const newBalanceId = generateUlid(NOW.getTime() - 500);
    const { inventoryBalance, repository, skuDelegate, transaction } = harness();
    await repository.createSkuInTransaction(transaction, {
      code: 'SKU-NEW',
      id: newSkuId,
      inventoryBalanceId: newBalanceId,
      isRecommended: false,
      name: 'New SKU',
      productId,
      retailPrice: '9.90',
      specification: null,
    });

    expect(skuDelegate.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        code: 'SKU-NEW',
        id: newSkuId,
        product_id: productId,
        status: 'INACTIVE',
        version: 1,
      }),
    });
    expect(inventoryBalance.create).toHaveBeenCalledWith({
      data: {
        id: newBalanceId,
        locked_qty: 0,
        physical_qty: 0,
        sku_id: newSkuId,
        updated_at: NOW,
        version: 1,
      },
    });
  });

  it('updates only mutable SKU fields with optimistic locking', async () => {
    const { repository, skuDelegate, transaction } = harness();
    await repository.updateSkuInTransaction(transaction, {
      expectedVersion: 1,
      id: skuId,
      patch: { isRecommended: false, retailPrice: '29.90' },
    });
    expect(skuDelegate.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        is_recommended: false,
        retail_price: '29.90',
        version: { increment: 1 },
      }),
      where: { deleted_at: null, id: skuId, version: 1 },
    });
  });

  it('rejects duplicate image slots and unsupported immutable SKU fields before writes', async () => {
    const { productDelegate, repository, skuDelegate, transaction } = harness();
    await expect(repository.createProductInTransaction(transaction, {
      ...createProductInput,
      images: [
        { fileId: imageFileId, sortOrder: 0 },
        { fileId: generateUlid(), sortOrder: 0 },
      ],
    })).rejects.toThrow('sort order');
    expect(productDelegate.create).not.toHaveBeenCalled();

    await expect(repository.updateSkuInTransaction(transaction, {
      expectedVersion: 1,
      id: skuId,
      patch: { code: 'IMMUTABLE' } as never,
    })).rejects.toThrow('supported field');
    expect(skuDelegate.updateMany).not.toHaveBeenCalled();
  });
});
