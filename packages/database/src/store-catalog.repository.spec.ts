import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { StoreCatalogRepository } from './store-catalog.repository';

const NOW = new Date('2026-08-25T10:00:00.000Z');
const brandId = generateUlid(NOW.getTime() - 9_000);
const categoryId = generateUlid(NOW.getTime() - 8_000);
const productId = generateUlid(NOW.getTime() - 7_000);
const skuId = generateUlid(NOW.getTime() - 6_000);
const secondSkuId = generateUlid(NOW.getTime() - 5_000);
const logoId = generateUlid(NOW.getTime() - 4_000);
const iconId = generateUlid(NOW.getTime() - 3_000);
const imageId = generateUlid(NOW.getTime() - 2_000);
const secondImageId = generateUlid(NOW.getTime() - 1_000);

function fileRecord(id: string, purpose: string, overrides: Record<string, unknown> = {}) {
  return {
    deleted_at: null,
    id,
    object_key: `public/${id}`,
    purpose,
    status: 'READY',
    visibility: 'PUBLIC',
    ...overrides,
  };
}

function brandRecord(overrides: Record<string, unknown> = {}) {
  return {
    description: 'Brand description',
    id: brandId,
    logo: fileRecord(logoId, 'BRAND_LOGO'),
    name: 'Brand One',
    sort_order: 1,
    ...overrides,
  };
}

function categoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    icon: fileRecord(iconId, 'CATEGORY_ICON'),
    id: categoryId,
    name: 'Category One',
    sort_order: 2,
    ...overrides,
  };
}

function productRow(overrides: Record<string, unknown> = {}) {
  return {
    brand_id: brandId,
    category_id: categoryId,
    id: productId,
    ingredients: 'Ingredients',
    introduction: 'Introduction',
    is_hot: true,
    is_new: false,
    is_salable: false,
    minimum_active_price: new Prisma.Decimal('19.90'),
    name: '100%_\\Serum',
    published_at: NOW,
    sales_count: 12,
    spu_code: 'SPU-001',
    subtitle: 'Subtitle',
    usage_method: 'Use gently',
    ...overrides,
  };
}

function imageRecord(options: {
  id?: string;
  fileId?: string;
  sortOrder?: number;
  fileOverrides?: Record<string, unknown>;
} = {}) {
  const fileId = options.fileId ?? imageId;
  return {
    file: fileRecord(fileId, 'PRODUCT_IMAGE', options.fileOverrides),
    file_id: fileId,
    id: options.id ?? generateUlid(NOW.getTime() - 500),
    product_id: productId,
    sort_order: options.sortOrder ?? 0,
  };
}

function skuRecord(options: {
  id?: string;
  balance?: { physical_qty: number; locked_qty: number } | null;
  price?: string;
} = {}) {
  const id = options.id ?? skuId;
  return {
    code: `SKU-${id}`,
    id,
    inventory_balance: options.balance === undefined
      ? { locked_qty: 2, physical_qty: 7 }
      : options.balance,
    is_recommended: id === skuId,
    name: `SKU ${id}`,
    product_id: productId,
    retail_price: new Prisma.Decimal(options.price ?? '19.90'),
    spec_json: { attributes: [{ name: 'Size', value: '500ml' }] },
  };
}

function sqlText(query: unknown): string {
  return (query as { strings: readonly string[] }).strings.join('?');
}

function sqlValues(query: unknown): readonly unknown[] {
  return (query as { values: readonly unknown[] }).values;
}

function harness() {
  let rows = [productRow()];
  let total = 1n;
  let brands = [brandRecord()];
  let categories = [categoryRecord()];
  let images = [imageRecord()];
  let skus = [skuRecord()];
  let banners: Record<string, unknown>[] = [];
  let publicProductIds = [productId];
  const queryRaw = vi.fn(async (query: unknown) => {
    const text = sqlText(query);
    if (text.includes('COUNT(*)::bigint')) return [{ total }];
    if (text.includes('SELECT DISTINCT p.id')) return publicProductIds.map((id) => ({ id }));
    return rows;
  });
  const transactionStub = {
    $queryRaw: queryRaw,
    banner: { findMany: vi.fn(async () => banners) },
    brand: { findMany: vi.fn(async () => brands) },
    category: { findMany: vi.fn(async () => categories) },
    productImage: { findMany: vi.fn(async () => images) },
    sku: { findMany: vi.fn(async () => skus) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => unknown) =>
      work(transactionStub as unknown as DatabaseTransaction)),
  };
  return {
    prisma,
    queryRaw,
    repository: new StoreCatalogRepository(
      prisma as unknown as PrismaClient,
      ['https://mall.example.test'],
      () => NOW,
    ),
    setBanners: (value: Record<string, unknown>[]) => { banners = value; },
    setBrands: (value: ReturnType<typeof brandRecord>[]) => { brands = value; },
    setCategories: (value: ReturnType<typeof categoryRecord>[]) => { categories = value; },
    setImages: (value: ReturnType<typeof imageRecord>[]) => { images = value; },
    setPublicProductIds: (value: string[]) => { publicProductIds = value; },
    setRows: (value: ReturnType<typeof productRow>[]) => { rows = value; },
    setSkus: (value: ReturnType<typeof skuRecord>[]) => { skus = value; },
    setTotal: (value: bigint) => { total = value; },
    transactionStub,
  };
}

describe('StoreCatalogRepository', () => {
  it('requires HTTPS origin-only Banner allowlist entries and a valid clock', () => {
    const prisma = {} as PrismaClient;
    expect(() => new StoreCatalogRepository(prisma, ['http://mall.example.test']))
      .toThrow('must be HTTPS origins');
    expect(() => new StoreCatalogRepository(prisma, ['https://mall.example.test/path']))
      .toThrow('must be HTTPS origins');
    expect(() => new StoreCatalogRepository(prisma, [], () => new Date(Number.NaN)))
      .toThrow('clock must return a valid Date');
  });

  it('rejects unsupported fields, invalid pagination/filter values and keyword boundaries', async () => {
    const { repository } = harness();
    await expect(repository.listProducts({ page: 0, pageSize: 20 })).rejects.toThrow('positive integer');
    await expect(repository.listProducts({ page: 1, pageSize: 101 })).rejects.toThrow('between 1 and 100');
    await expect(repository.listProducts({ page: 1, pageSize: 20, keyword: '   ' }))
      .rejects.toThrow('1 to 200');
    await expect(repository.listProducts({ page: 1, pageSize: 20, keyword: '🌿'.repeat(201) }))
      .rejects.toThrow('1 to 200');
    await expect(repository.listProducts({ page: 1, pageSize: 20, brandId: 'bad' }))
      .rejects.toThrow('must be a ULID');
    await expect(repository.listProducts({ page: 1, pageSize: 20, sort: 'POPULAR' as never }))
      .rejects.toThrow('sort is invalid');
    await expect(repository.listProducts({ page: 1, pageSize: 20, status: 'ACTIVE' } as never))
      .rejects.toThrow('unsupported fields');
    await expect(repository.getProduct('../product')).rejects.toThrow('must be a ULID');
  });

  it('uses literal case-insensitive name search, parameterized filters and stable comprehensive sorting', async () => {
    const { prisma, queryRaw, repository } = harness();
    const result = await repository.listProducts({
      brandId,
      categoryId,
      keyword: '  100%_\\SERUM  ',
      page: 2,
      pageSize: 20,
      sort: 'COMPREHENSIVE',
    });

    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of queryRaw.mock.calls) {
      expect(sqlText(query)).toContain('p.name ILIKE');
      expect(sqlText(query)).toContain("ESCAPE '\\'");
      expect(sqlValues(query)).toContain('%100\\%\\_\\\\SERUM%');
      expect(sqlValues(query)).toContain(brandId);
      expect(sqlValues(query)).toContain(categoryId);
    }
    const pageQuery = queryRaw.mock.calls[1]?.[0];
    expect(sqlText(pageQuery)).toContain('e.is_hot DESC');
    expect(sqlText(pageQuery)).toContain('e.is_new DESC');
    expect(sqlText(pageQuery)).toContain('e.sales_count DESC');
    expect(sqlText(pageQuery)).toContain('e.published_at DESC NULLS LAST');
    expect(sqlText(pageQuery)).toContain('e.id ASC');
    expect(sqlValues(pageQuery)).toEqual(expect.arrayContaining([20, 20]));
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('batch-assembles only valid public files and does not query SKU details for a list', async () => {
    const { repository, setBrands, setImages, transactionStub } = harness();
    setBrands([brandRecord({ logo: fileRecord(logoId, 'PRODUCT_IMAGE') })]);
    setImages([
      imageRecord({ fileOverrides: { status: 'PENDING' }, sortOrder: 0 }),
      imageRecord({ fileId: secondImageId, id: secondImageId, sortOrder: 1 }),
    ]);

    const result = await repository.listProducts({ page: 1, pageSize: 20 });

    expect(result.items[0]).toMatchObject({
      brand: { logoObjectKey: null },
      isSalable: false,
      minimumActivePrice: '19.90',
      primaryImage: {
        isPrimary: true,
        objectKey: `public/${secondImageId}`,
        sortOrder: 1,
      },
    });
    expect(transactionStub.brand.findMany).toHaveBeenCalledTimes(1);
    expect(transactionStub.category.findMany).toHaveBeenCalledTimes(1);
    expect(transactionStub.productImage.findMany).toHaveBeenCalledTimes(1);
    expect(transactionStub.sku.findMany).not.toHaveBeenCalled();
  });

  it('returns every ACTIVE SKU in stable query order and treats missing or exhausted balances as unsalable', async () => {
    const { repository, setSkus, transactionStub } = harness();
    setSkus([
      skuRecord({ balance: { locked_qty: 2, physical_qty: 7 }, id: skuId }),
      skuRecord({ balance: null, id: secondSkuId, price: '29.00' }),
    ]);

    const detail = await repository.getProduct(productId);

    expect(detail?.skus).toEqual([
      expect.objectContaining({ availableStock: 5, id: skuId, isSalable: true, retailPrice: '19.90' }),
      expect.objectContaining({ availableStock: 0, id: secondSkuId, isSalable: false, retailPrice: '29.00' }),
    ]);
    expect(transactionStub.sku.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      where: { deleted_at: null, product_id: { in: [productId] }, status: 'ACTIVE' },
    }));
  });

  it('returns null for a product outside the public eligibility boundary without association queries', async () => {
    const { repository, setRows, transactionStub } = harness();
    setRows([]);
    await expect(repository.getProduct(productId)).resolves.toBeNull();
    expect(transactionStub.brand.findMany).not.toHaveBeenCalled();
    expect(transactionStub.productImage.findMany).not.toHaveBeenCalled();
    expect(transactionStub.sku.findMany).not.toHaveBeenCalled();
  });

  it('returns all ACTIVE brands/categories in stable order and suppresses invalid optional media', async () => {
    const { repository, setCategories, transactionStub } = harness();
    setCategories([categoryRecord({ icon: fileRecord(iconId, 'CATEGORY_ICON', { visibility: 'PRIVATE' }) })]);

    await expect(repository.listBrands()).resolves.toEqual([
      expect.objectContaining({ id: brandId, logoObjectKey: `public/${logoId}` }),
    ]);
    await expect(repository.listCategories()).resolves.toEqual([
      expect.objectContaining({ iconObjectKey: null, id: categoryId }),
    ]);
    expect(transactionStub.brand.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      where: { deleted_at: null, status: 'ACTIVE' },
    }));
    expect(transactionStub.category.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      where: { deleted_at: null, status: 'ACTIVE' },
    }));
  });

  it('independently queries bounded HOT and NEW home sections with their contract ordering', async () => {
    const { prisma, queryRaw, repository } = harness();
    await repository.listHomeHotProducts();
    await repository.listHomeNewProducts();

    expect(queryRaw).toHaveBeenCalledTimes(2);
    const hotQuery = queryRaw.mock.calls[0]?.[0];
    const newQuery = queryRaw.mock.calls[1]?.[0];
    expect(sqlText(hotQuery)).toContain('p.is_hot = TRUE');
    expect(sqlText(hotQuery)).toContain('e.sales_count DESC, e.id ASC');
    expect(sqlValues(hotQuery)).toEqual(expect.arrayContaining([4, 0]));
    expect(sqlText(newQuery)).toContain('p.is_new = TRUE');
    expect(sqlText(newQuery)).toContain('e.published_at DESC NULLS LAST, e.id ASC');
    expect(sqlValues(newQuery)).toEqual(expect.arrayContaining([4, 0]));
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
  });

  it('filters Banner files and malformed or unavailable targets before applying the ten-item limit', async () => {
    const validProductBannerId = generateUlid(NOW.getTime() + 1_000);
    const unavailableProductId = generateUlid(NOW.getTime() + 2_000);
    const invalidCategoryId = generateUlid(NOW.getTime() + 3_000);
    const bannerFileId = generateUlid(NOW.getTime() + 4_000);
    const banner = (overrides: Record<string, unknown> = {}) => ({
      file: fileRecord(bannerFileId, 'BANNER'),
      file_id: bannerFileId,
      id: generateUlid(),
      sort_order: 0,
      target_id: null,
      target_type: 'NONE',
      target_url: null,
      title: 'Banner',
      ...overrides,
    });
    const validNone = Array.from({ length: 9 }, (_, index) => banner({ sort_order: index }));
    const records = [
      banner({ id: validProductBannerId, sort_order: -3, target_id: productId, target_type: 'PRODUCT' }),
      banner({ sort_order: -2, target_id: unavailableProductId, target_type: 'PRODUCT' }),
      banner({ sort_order: -1, target_id: invalidCategoryId, target_type: 'CATEGORY' }),
      banner({ sort_order: 9, target_type: 'URL', target_url: 'https://mall.example.test/sale' }),
      banner({ sort_order: 10, target_type: 'URL', target_url: 'https://evil.example.test' }),
      banner({ file: fileRecord(bannerFileId, 'PRODUCT_IMAGE'), sort_order: 11 }),
      ...validNone,
    ];
    const { prisma, repository, setBanners, setCategories, setPublicProductIds, transactionStub } = harness();
    setBanners(records);
    setCategories([]);
    setPublicProductIds([productId]);

    const result = await repository.listHomeBanners();

    expect(result).toHaveLength(10);
    expect(result.map(({ id }) => id)).toContain(validProductBannerId);
    expect(result.some(({ targetUrl }) => targetUrl === 'https://mall.example.test/sale')).toBe(true);
    expect(result.some(({ targetId }) => targetId === unavailableProductId)).toBe(false);
    expect(result.some(({ targetId }) => targetId === invalidCategoryId)).toBe(false);
    expect(transactionStub.banner.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      where: expect.objectContaining({ deleted_at: null, status: 'ACTIVE' }),
    }));
    expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });
});
