import type { INestApplication } from '@nestjs/common';
import { ApplicationError } from '@qingxu/platform-core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../app.module';
import { configureApi } from '../platform/http/configure-api';
import { StoreCatalogRateLimitGuard } from './store-catalog-rate-limit.guard';
import { StoreCatalogService } from './store-catalog.service';

const brandId = '01J00000000000000000000000';
const categoryId = '01J00000000000000000000001';
const productId = '01J00000000000000000000002';
const getHome = vi.fn();
const listCategories = vi.fn();
const listBrands = vi.fn();
const listProducts = vi.fn();
const getProduct = vi.fn();
const canActivate = vi.fn().mockReturnValue(true);

const service = { getHome, getProduct, listBrands, listCategories, listProducts };

function readyHome() {
  return {
    banners: [],
    categories: [],
    hot_products: [],
    new_products: [],
    section_status: {
      banners: 'READY',
      categories: 'READY',
      hot_products: 'READY',
      new_products: 'READY',
    },
  };
}

describe('B6.1 anonymous Store Catalog HTTP surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(StoreCatalogService)
      .useValue(service)
      .overrideGuard(StoreCatalogRateLimitGuard)
      .useValue({ canActivate })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    canActivate.mockReturnValue(true);
    getHome.mockResolvedValue(readyHome());
    listCategories.mockResolvedValue({ items: [] });
    listBrands.mockResolvedValue({ items: [] });
    listProducts.mockResolvedValue({
      items: [],
      pagination: { page: 1, page_size: 20, total: 0 },
    });
    getProduct.mockResolvedValue({ product_id: productId });
  });

  afterAll(async () => app.close());

  it.each([
    ['home', '/api/v1/store/home'],
    ['categories', '/api/v1/store/categories'],
    ['brands', '/api/v1/store/brands'],
    ['products', '/api/v1/store/products'],
    ['product detail', `/api/v1/store/products/${productId}`],
  ])('serves %s without an Authorization header through the common envelope', async (_name, path) => {
    const response = await request(app.getHttpServer()).get(path).expect(200);

    expect(response.body).toMatchObject({ code: 'OK', message: 'success' });
    expect(response.body.request_id).toMatch(/^req_[0-9a-f]{32}$/);
    expect(response.headers['x-request-id']).toBe(response.body.request_id);
    expect(canActivate).toHaveBeenCalled();
  });

  it('normalizes and closes the product list query before service dispatch', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/store/products?keyword=%20Daily%20&brand_id=${brandId}` +
        `&category_id=${categoryId}&page=2&page_size=50&sort=PRICE_DESC`)
      .expect(200);

    expect(listProducts).toHaveBeenCalledWith({
      brandId,
      categoryId,
      keyword: 'Daily',
      page: 2,
      pageSize: 50,
      sort: 'PRICE_DESC',
    });
  });

  it('returns a partial-home response as 200 with the unavailable section explicit', async () => {
    getHome.mockResolvedValue({
      ...readyHome(),
      section_status: {
        ...readyHome().section_status,
        banners: 'UNAVAILABLE',
      },
    });

    const response = await request(app.getHttpServer()).get('/api/v1/store/home').expect(200);
    expect(response.body.data.banners).toEqual([]);
    expect(response.body.data.section_status.banners).toBe('UNAVAILABLE');
  });

  it.each([
    ['/api/v1/store/home?unknown=1', 'getHome'],
    ['/api/v1/store/categories?page=1', 'listCategories'],
    ['/api/v1/store/brands?status=ACTIVE', 'listBrands'],
    [`/api/v1/store/products/${productId}?unknown=1`, 'getProduct'],
    ['/api/v1/store/products?status=ACTIVE', 'listProducts'],
    ['/api/v1/store/products?keyword=%20%20%20', 'listProducts'],
    ['/api/v1/store/products?sort=POPULAR', 'listProducts'],
  ])('rejects contract-open query %s before %s dispatch', async (path, method) => {
    const response = await request(app.getHttpServer()).get(path).expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(service[method as keyof typeof service]).not.toHaveBeenCalled();
  });

  it('rejects an invalid product ULID before detail dispatch', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/products/not-an-ulid')
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(getProduct).not.toHaveBeenCalled();
  });

  it('maps an excluded public product to the common 404 envelope', async () => {
    getProduct.mockRejectedValue(new ApplicationError('RESOURCE_NOT_FOUND', 'Product not found'));

    const response = await request(app.getHttpServer())
      .get(`/api/v1/store/products/${productId}`)
      .expect(404);

    expect(response.body.code).toBe('RESOURCE_NOT_FOUND');
    expect(response.body.request_id).toBe(response.headers['x-request-id']);
  });

  it('maps four-section home failure to the common 500 envelope', async () => {
    getHome.mockRejectedValue(new ApplicationError('INTERNAL_ERROR', 'Store catalog home is unavailable'));

    const response = await request(app.getHttpServer()).get('/api/v1/store/home').expect(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
  });
});
