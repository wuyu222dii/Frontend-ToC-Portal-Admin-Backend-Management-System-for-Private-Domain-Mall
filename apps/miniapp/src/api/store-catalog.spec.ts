import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getStoreHome,
  getStoreProduct,
  listStoreBrands,
  listStoreCategories,
  listStoreProducts,
} from './store-catalog';

describe('Store catalog endpoints', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('maps all five public GET operations to their frozen paths', () => {
    const urls: string[] = [];
    vi.stubGlobal('uni', {
      request(options: UniNamespace.RequestOptions) {
        urls.push(options.url);
        return { abort() {} } as UniNamespace.RequestTask;
      },
    });

    getStoreHome();
    listStoreCategories();
    listStoreBrands();
    listStoreProducts({ page: 3, page_size: 10, sort: 'NEWEST' });
    getStoreProduct('01JTEST/unsafe');

    expect(urls).toEqual([
      '/api/v1/store/home',
      '/api/v1/store/categories',
      '/api/v1/store/brands',
      '/api/v1/store/products?page=3&page_size=10&sort=NEWEST',
      '/api/v1/store/products/01JTEST%2Funsafe',
    ]);
  });
});
