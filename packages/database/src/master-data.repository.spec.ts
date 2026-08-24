import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { acquireMasterDataHierarchyLocks, MasterDataRepository } from './master-data.repository';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const actorId = generateUlid(NOW.getTime() - 9_000);
const otherActorId = generateUlid(NOW.getTime() - 8_000);
const brandId = generateUlid(NOW.getTime() - 7_000);
const categoryId = generateUlid(NOW.getTime() - 6_000);
const fileId = generateUlid(NOW.getTime() - 5_000);
const productA = generateUlid(NOW.getTime() - 4_000);
const productB = generateUlid(NOW.getTime() - 3_000);
const skuA = generateUlid(NOW.getTime() - 2_000);
const skuB = generateUlid(NOW.getTime() - 1_000);
const reservationA = generateUlid(NOW.getTime());
const reservationB = generateUlid(NOW.getTime() + 1_000);

function publicFile(purpose: 'BRAND_LOGO' | 'CATEGORY_ICON' = 'BRAND_LOGO') {
  return {
    created_by_id: actorId,
    deleted_at: null,
    id: fileId,
    object_key: `public/${fileId}`,
    purpose,
    status: 'READY',
    visibility: 'PUBLIC',
  };
}

function brandRecord(overrides: Record<string, unknown> = {}) {
  return {
    created_at: NOW,
    deleted_at: null,
    description: 'Description',
    id: brandId,
    logo: publicFile(),
    logo_file_id: fileId,
    name: 'Brand A',
    sort_order: 2,
    status: 'DRAFT',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function categoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    created_at: NOW,
    deleted_at: null,
    icon: publicFile('CATEGORY_ICON'),
    icon_file_id: fileId,
    id: categoryId,
    name: 'Category A',
    sort_order: 1,
    status: 'DRAFT',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function harness() {
  let brand = brandRecord();
  let category = categoryRecord();
  const brandDelegate = {
    count: vi.fn(async () => 1),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      brand = brandRecord({ ...data, logo: data.logo_file_id ? publicFile() : null });
      return brand;
    }),
    findMany: vi.fn(async () => [brand]),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; name?: string } }) => {
      if (where.name !== undefined) return where.name === brand.name ? brand : null;
      return where.id === brand.id ? brand : null;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
      brand = brandRecord({
        ...brand,
        ...data,
        logo: data.logo_file_id === null ? null : brand.logo,
        version: Number(brand.version) + increment,
      });
      return { count: 1 };
    }),
  };
  const categoryDelegate = {
    count: vi.fn(async () => 1),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      category = categoryRecord({ ...data, icon: data.icon_file_id ? publicFile('CATEGORY_ICON') : null });
      return category;
    }),
    findMany: vi.fn(async () => [category]),
    findUnique: vi.fn(async ({ where }: { where: { id?: string; name?: string } }) => {
      if (where.name !== undefined) return where.name === category.name ? category : null;
      return where.id === category.id ? category : null;
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
      category = categoryRecord({ ...category, ...data, version: Number(category.version) + increment });
      return { count: 1 };
    }),
  };
  const fileAsset = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      where.created_by_id === actorId ? { id: fileId } : null),
  };
  const product = {
    findMany: vi.fn(async () => [] as { id: string }[]),
  };
  const transaction = {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    brand: brandDelegate,
    category: categoryDelegate,
    fileAsset,
    product,
  };
  const prisma = {
    brand: { count: brandDelegate.count, findMany: brandDelegate.findMany, findUnique: brandDelegate.findUnique },
    category: {
      count: categoryDelegate.count,
      findMany: categoryDelegate.findMany,
      findUnique: categoryDelegate.findUnique,
    },
  };
  return {
    brandDelegate,
    categoryDelegate,
    fileAsset,
    product,
    prisma,
    repository: new MasterDataRepository(prisma as unknown as PrismaClient, () => NOW),
    setBrand: (value: ReturnType<typeof brandRecord>) => { brand = value; },
    setCategory: (value: ReturnType<typeof categoryRecord>) => { category = value; },
    transaction: transaction as unknown as DatabaseTransaction,
    transactionStub: transaction,
  };
}

describe('MasterDataRepository', () => {
  it('locks brand, category, product, SKU and reservation layers in stable ID order', async () => {
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    } as unknown as DatabaseTransaction;

    await acquireMasterDataHierarchyLocks(transaction, {
      brandIds: [brandId, brandId],
      categoryIds: [categoryId],
      productIds: [productB, productA, productB],
      reservationIds: [reservationB, reservationA, reservationA],
      skuIds: [skuB, skuA, skuB],
    });

    expect(vi.mocked(transaction.$queryRawUnsafe).mock.calls.map((call) => call.at(-1))).toEqual([
      JSON.stringify([brandId]),
      JSON.stringify([categoryId]),
      JSON.stringify([productA]),
      JSON.stringify([productB]),
      JSON.stringify([skuA]),
      JSON.stringify([skuB]),
      JSON.stringify([reservationA]),
      JSON.stringify([reservationB]),
    ]);
  });

  it('uses stable list ordering and excludes archived records unless explicitly requested', async () => {
    const { brandDelegate, categoryDelegate, repository } = harness();
    await repository.listBrands({ page: 1, pageSize: 20 });
    expect(brandDelegate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      where: { deleted_at: null, status: { not: 'ARCHIVED' } },
    }));

    await repository.listCategories({ page: 2, pageSize: 10, status: 'ARCHIVED' });
    expect(categoryDelegate.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      skip: 10,
      where: { deleted_at: { not: null }, status: 'ARCHIVED' },
    }));
  });

  it('returns archived details and only exposes a verified public object key', async () => {
    const { repository, setBrand } = harness();
    setBrand(brandRecord({ deleted_at: NOW, status: 'ARCHIVED' }));
    await expect(repository.getBrand(brandId)).resolves.toMatchObject({
      deletedAt: NOW,
      logoObjectKey: `public/${fileId}`,
      status: 'ARCHIVED',
    });
    setBrand(brandRecord({ logo: publicFile('CATEGORY_ICON') }));
    await expect(repository.getBrand(brandId)).resolves.toMatchObject({ logoObjectKey: null });
  });

  it('creates fixed DRAFT records and scopes attached files to the actor', async () => {
    const { brandDelegate, fileAsset, repository, transaction } = harness();
    await repository.createBrandInTransaction(transaction, {
      actorId,
      description: null,
      id: generateUlid(NOW.getTime() - 2_000),
      logoFileId: fileId,
      name: 'Brand B',
      sortOrder: 0,
    });
    expect(fileAsset.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        created_by_id: actorId,
        deleted_at: null,
        id: fileId,
        object_key: `public/${fileId}`,
        purpose: 'BRAND_LOGO',
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    expect(brandDelegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({ status: 'DRAFT', version: 1 }) });

    await expect(repository.createCategoryInTransaction(transaction, {
      actorId: otherActorId,
      iconFileId: fileId,
      id: generateUlid(NOW.getTime() - 1_000),
      name: 'Category B',
      sortOrder: 0,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it.each([
    { archived: true, code: 'SOFT_DELETED_KEY_RESERVED' },
    { archived: false, code: 'STATE_CONFLICT' },
  ])('maps globally reserved names to the correct conflict ($code)', async ({ archived, code }) => {
    const { repository, setBrand, transaction } = harness();
    setBrand(brandRecord(archived ? { deleted_at: NOW, status: 'ARCHIVED' } : { status: 'ACTIVE' }));
    await expect(repository.createBrandInTransaction(transaction, {
      actorId,
      description: null,
      id: generateUlid(),
      logoFileId: null,
      name: 'Brand A',
      sortOrder: 0,
    })).rejects.toMatchObject({ code });
  });

  it('applies optimistic locking and increments version for ordinary updates', async () => {
    const { brandDelegate, repository, setBrand, transaction } = harness();
    await expect(repository.updateBrandInTransaction(transaction, {
      actorId,
      expectedVersion: 1,
      id: brandId,
      patch: { description: null, sortOrder: 8 },
    })).resolves.toMatchObject({ description: null, sortOrder: 8, version: 2 });
    expect(brandDelegate.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { deleted_at: null, id: brandId, version: 1 },
    }));

    setBrand(brandRecord({ version: 3 }));
    await expect(repository.updateBrandInTransaction(transaction, {
      actorId,
      expectedVersion: 2,
      id: brandId,
      patch: { sortOrder: 9 },
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
  });

  it.each([
    { action: 'ACTIVATE' as const, status: 'DRAFT', next: 'ACTIVE' },
    { action: 'ACTIVATE' as const, status: 'INACTIVE', next: 'ACTIVE' },
    { action: 'DEACTIVATE' as const, status: 'ACTIVE', next: 'INACTIVE' },
    { action: 'SOFT_DELETE' as const, status: 'DRAFT', next: 'ARCHIVED' },
    { action: 'SOFT_DELETE' as const, status: 'INACTIVE', next: 'ARCHIVED' },
  ])('allows $status -> $action -> $next', async ({ action, next, status }) => {
    const { repository, setBrand, transaction } = harness();
    setBrand(brandRecord({ status }));
    const result = await repository.applyLifecycleInTransaction(transaction, {
      action,
      expectedVersion: 1,
      targetId: brandId,
      targetType: 'BRAND',
    });
    expect(result.resource).toMatchObject({ status: next, version: 2 });
    expect(result.resource.deletedAt === null).toBe(action !== 'SOFT_DELETE');
  });

  it.each([
    { action: 'ACTIVATE' as const, status: 'ACTIVE' },
    { action: 'DEACTIVATE' as const, status: 'DRAFT' },
    { action: 'SOFT_DELETE' as const, status: 'ACTIVE' },
    { action: 'ACTIVATE' as const, status: 'ARCHIVED', deleted_at: NOW },
  ])('rejects illegal $status -> $action transitions', async ({ action, deleted_at = null, status }) => {
    const { repository, setCategory, transaction } = harness();
    setCategory(categoryRecord({ deleted_at, status }));
    await expect(repository.getLifecyclePreviewImpactInTransaction(transaction, {
      action,
      targetId: categoryId,
      targetType: 'CATEGORY',
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('returns active dependencies during preview but blocks confirmation with sorted product locks', async () => {
    const { product, repository, setBrand, transaction, transactionStub } = harness();
    setBrand(brandRecord({ status: 'ACTIVE' }));
    product.findMany.mockResolvedValue([{ id: productA }, { id: productB }]);
    await expect(repository.getLifecyclePreviewImpactInTransaction(transaction, {
      action: 'DEACTIVATE',
      targetId: brandId,
      targetType: 'BRAND',
    })).resolves.toMatchObject({ activeProductCount: 2, activeProductIds: [productA, productB] });
    expect(transactionStub.$queryRawUnsafe.mock.calls.map((call) => call.at(-1))).toEqual(expect.arrayContaining([
      JSON.stringify([brandId]),
      JSON.stringify([productA]),
      JSON.stringify([productB]),
    ]));
    await expect(repository.applyLifecycleInTransaction(transaction, {
      action: 'DEACTIVATE',
      expectedVersion: 1,
      targetId: brandId,
      targetType: 'BRAND',
    })).rejects.toMatchObject({ code: 'ACTIVE_PRODUCT_DEPENDENCY' });
  });

  it('restores only a soft-deleted archived record to DRAFT with a new version', async () => {
    const { repository, setCategory, transaction } = harness();
    setCategory(categoryRecord({ deleted_at: NOW, status: 'ARCHIVED', version: 4 }));
    await expect(repository.restoreCategoryInTransaction(transaction, {
      expectedVersion: 4,
      id: categoryId,
    })).resolves.toMatchObject({ deletedAt: null, status: 'DRAFT', version: 5 });

    setCategory(categoryRecord({ status: 'INACTIVE', version: 4 }));
    await expect(repository.restoreCategoryInTransaction(transaction, {
      expectedVersion: 4,
      id: categoryId,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});
