import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreCatalogService } from './store-catalog.service';

const brandId = '01J00000000000000000000000';
const categoryId = '01J00000000000000000000001';
const productId = '01J00000000000000000000002';
const skuId = '01J00000000000000000000003';
const bannerId = '01J00000000000000000000004';

const brand = {
  description: 'Daily care',
  id: brandId,
  logoObjectKey: 'public/brands/logo.png',
  name: 'Qingxu',
  sortOrder: 2,
};
const category = {
  iconObjectKey: 'public/categories/icon.png',
  id: categoryId,
  name: 'Facial care',
  sortOrder: 3,
};
const primaryImage = {
  isPrimary: true,
  objectKey: 'public/products/primary.png',
  sortOrder: 0,
};
const listProduct = {
  brand,
  category,
  id: productId,
  isHot: true,
  isNew: false,
  isSalable: false,
  minimumActivePrice: '19.90',
  name: 'Daily cleanser',
  netSalesCount: 12,
  primaryImage,
  spuCode: 'SPU-001',
  subtitle: 'Gentle wash',
};
const banner = {
  id: bannerId,
  imageObjectKey: 'public/banners/hero.png',
  sortOrder: 1,
  targetId: productId,
  targetType: 'PRODUCT' as const,
  targetUrl: null,
  title: 'Daily care',
};

function catalogMock() {
  return {
    getProduct: vi.fn(),
    listBrands: vi.fn().mockResolvedValue([brand]),
    listCategories: vi.fn().mockResolvedValue([category]),
    listHomeBanners: vi.fn().mockResolvedValue([banner]),
    listHomeCategories: vi.fn().mockResolvedValue([category]),
    listHomeHotProducts: vi.fn().mockResolvedValue([listProduct]),
    listHomeNewProducts: vi.fn().mockResolvedValue([listProduct]),
    listProducts: vi.fn().mockResolvedValue({ items: [listProduct], total: 1 }),
  };
}

function storageMock() {
  return {
    publicUrl: vi.fn((key: string) => `https://assets.example/${key}`),
  };
}

function createService() {
  const service = new StoreCatalogService();
  const catalog = catalogMock();
  const storage = storageMock();
  Object.assign(service, { catalog, storage });
  return { catalog, service, storage };
}

describe('StoreCatalogService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps public brands, categories and object keys without management fields', async () => {
    const { service, storage } = createService();

    await expect(service.listBrands()).resolves.toEqual({
      items: [{
        brand_id: brandId,
        description: 'Daily care',
        logo_url: 'https://assets.example/public/brands/logo.png',
        name: 'Qingxu',
        sort_order: 2,
      }],
    });
    await expect(service.listCategories()).resolves.toEqual({
      items: [{
        category_id: categoryId,
        icon_url: 'https://assets.example/public/categories/icon.png',
        name: 'Facial care',
        sort_order: 3,
      }],
    });
    expect(storage.publicUrl).toHaveBeenCalledWith('public/brands/logo.png');
    expect(storage.publicUrl).toHaveBeenCalledWith('public/categories/icon.png');
  });

  it('passes normalized filters to the repository and maps the frozen product projection', async () => {
    const { catalog, service } = createService();

    await expect(service.listProducts({
      brandId,
      categoryId,
      keyword: 'Daily',
      page: 2,
      pageSize: 10,
      sort: 'PRICE_ASC',
    })).resolves.toEqual({
      items: [{
        brand: {
          brand_id: brandId,
          description: 'Daily care',
          logo_url: 'https://assets.example/public/brands/logo.png',
          name: 'Qingxu',
          sort_order: 2,
        },
        category: {
          category_id: categoryId,
          icon_url: 'https://assets.example/public/categories/icon.png',
          name: 'Facial care',
          sort_order: 3,
        },
        is_hot: true,
        is_new: false,
        is_salable: false,
        minimum_active_price: '19.90',
        name: 'Daily cleanser',
        net_sales_count: 12,
        primary_image: {
          is_primary: true,
          sort_order: 0,
          url: 'https://assets.example/public/products/primary.png',
        },
        product_id: productId,
        spu_code: 'SPU-001',
        subtitle: 'Gentle wash',
      }],
      pagination: { page: 2, page_size: 10, total: 1 },
    });
    expect(catalog.listProducts).toHaveBeenCalledWith({
      brandId,
      categoryId,
      keyword: 'Daily',
      page: 2,
      pageSize: 10,
      sort: 'PRICE_ASC',
    });
  });

  it('maps all public detail fields, SKU specification and zero-stock salability', async () => {
    const { catalog, service } = createService();
    catalog.getProduct.mockResolvedValue({
      brand,
      category,
      id: productId,
      images: [primaryImage],
      ingredients: 'Water',
      introduction: 'A gentle cleanser',
      isHot: false,
      isNew: true,
      name: 'Daily cleanser',
      netSalesCount: 12,
      skus: [{
        availableStock: 0,
        code: 'SKU-001',
        id: skuId,
        isRecommended: true,
        isSalable: false,
        name: '500 ml',
        retailPrice: '19.90',
        specification: { attributes: [{ name: 'Volume', value: '500 ml' }] },
      }],
      spuCode: 'SPU-001',
      subtitle: 'Gentle wash',
      usageMethod: 'Use with water',
    });

    await expect(service.getProduct(productId)).resolves.toEqual({
      brand: {
        brand_id: brandId,
        description: 'Daily care',
        logo_url: 'https://assets.example/public/brands/logo.png',
        name: 'Qingxu',
        sort_order: 2,
      },
      category: {
        category_id: categoryId,
        icon_url: 'https://assets.example/public/categories/icon.png',
        name: 'Facial care',
        sort_order: 3,
      },
      images: [{
        is_primary: true,
        sort_order: 0,
        url: 'https://assets.example/public/products/primary.png',
      }],
      ingredients: 'Water',
      introduction: 'A gentle cleanser',
      is_hot: false,
      is_new: true,
      name: 'Daily cleanser',
      net_sales_count: 12,
      product_id: productId,
      skus: [{
        available_stock: 0,
        code: 'SKU-001',
        is_recommended: true,
        is_salable: false,
        name: '500 ml',
        retail_price: '19.90',
        sku_id: skuId,
        spec_json: { attributes: [{ name: 'Volume', value: '500 ml' }] },
      }],
      spu_code: 'SPU-001',
      subtitle: 'Gentle wash',
      usage_method: 'Use with water',
    });
  });

  it('returns RESOURCE_NOT_FOUND for a product excluded from the public projection', async () => {
    const { catalog, service } = createService();
    catalog.getProduct.mockResolvedValue(null);

    await expect(service.getProduct(productId)).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it.each([0, 1, 2, 3])(
    'keeps home available when %i of four independent sections fail',
    async (failureCount) => {
      const { catalog, service } = createService();
      const sectionMethods = [
        catalog.listHomeBanners,
        catalog.listHomeCategories,
        catalog.listHomeHotProducts,
        catalog.listHomeNewProducts,
      ];
      for (const method of sectionMethods.slice(0, failureCount)) {
        method.mockRejectedValue(new Error('section unavailable'));
      }

      const result = await service.getHome();
      const statuses = Object.values(result.section_status);
      expect(statuses.filter((status) => status === 'UNAVAILABLE')).toHaveLength(failureCount);
      expect(result.banners).toHaveLength(failureCount >= 1 ? 0 : 1);
      expect(result.categories).toHaveLength(failureCount >= 2 ? 0 : 1);
      expect(result.hot_products).toHaveLength(failureCount >= 3 ? 0 : 1);
      expect(result.new_products).toHaveLength(1);
    },
  );

  it('returns INTERNAL_ERROR only when all four home sections fail', async () => {
    const { catalog, service } = createService();
    catalog.listHomeBanners.mockRejectedValue(new Error('banners unavailable'));
    catalog.listHomeCategories.mockRejectedValue(new Error('categories unavailable'));
    catalog.listHomeHotProducts.mockRejectedValue(new Error('hot products unavailable'));
    catalog.listHomeNewProducts.mockRejectedValue(new Error('new products unavailable'));

    await expect(service.getHome()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('isolates an object URL mapping failure to the affected home section', async () => {
    const { service, storage } = createService();
    storage.publicUrl.mockImplementation((key: string) => {
      if (key === 'public/banners/hero.png') throw new Error('invalid public object key');
      return `https://assets.example/${key}`;
    });

    await expect(service.getHome()).resolves.toMatchObject({
      banners: [],
      categories: [expect.objectContaining({ category_id: categoryId })],
      hot_products: [expect.objectContaining({ product_id: productId })],
      new_products: [expect.objectContaining({ product_id: productId })],
      section_status: {
        banners: 'UNAVAILABLE',
        categories: 'READY',
        hot_products: 'READY',
        new_products: 'READY',
      },
    });
  });

  it('rejects a malformed persisted Banner target and SKU specification', async () => {
    const { catalog, service } = createService();
    catalog.listHomeBanners.mockResolvedValue([{
      ...banner,
      targetId: productId,
      targetType: 'URL',
      targetUrl: 'https://shop.example/item',
    }]);
    const home = await service.getHome();
    expect(home.section_status.banners).toBe('UNAVAILABLE');

    catalog.getProduct.mockResolvedValue({
      brand,
      category,
      id: productId,
      images: [],
      ingredients: null,
      introduction: null,
      isHot: false,
      isNew: false,
      name: 'Daily cleanser',
      netSalesCount: 0,
      skus: [{
        availableStock: 1,
        code: 'SKU-001',
        id: skuId,
        isRecommended: false,
        isSalable: true,
        name: '500 ml',
        retailPrice: '19.90',
        specification: { attributes: [] },
      }],
      spuCode: 'SPU-001',
      subtitle: null,
      usageMethod: null,
    });
    await expect(service.getProduct(productId)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
