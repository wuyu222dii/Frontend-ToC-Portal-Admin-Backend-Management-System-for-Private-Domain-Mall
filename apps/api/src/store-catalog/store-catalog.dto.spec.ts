import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseStoreEmptyQuery,
  parseStoreProductId,
  parseStoreProductListQuery,
} from './store-catalog.dto';

const brandId = '01J00000000000000000000000';
const categoryId = '01J00000000000000000000001';
const productId = '01J00000000000000000000002';

describe('Store Catalog request DTOs', () => {
  it('applies frozen product list defaults', () => {
    expect(parseStoreProductListQuery({})).toEqual({
      page: 1,
      pageSize: 20,
      sort: 'COMPREHENSIVE',
    });
  });

  it('trims a product-name keyword and parses every closed filter', () => {
    expect(parseStoreProductListQuery({
      brand_id: brandId,
      category_id: categoryId,
      keyword: '  Facial Cleanser  ',
      page: '2',
      page_size: '100',
      sort: 'PRICE_DESC',
    })).toEqual({
      brandId,
      categoryId,
      keyword: 'Facial Cleanser',
      page: 2,
      pageSize: 100,
      sort: 'PRICE_DESC',
    });
  });

  it.each(['COMPREHENSIVE', 'HOT', 'NEWEST', 'PRICE_ASC', 'PRICE_DESC'] as const)(
    'accepts the %s sort',
    (sort) => expect(parseStoreProductListQuery({ sort })).toMatchObject({ sort }),
  );

  it('counts the normalized keyword by Unicode code point', () => {
    expect(parseStoreProductListQuery({ keyword: `  ${'🌿'.repeat(200)}  ` }).keyword)
      .toBe('🌿'.repeat(200));
    expect(() => parseStoreProductListQuery({ keyword: '🌿'.repeat(201) }))
      .toThrowError(ApplicationError);
  });

  it('accepts only an empty query on non-list endpoints and validates product ULIDs', () => {
    expect(parseStoreEmptyQuery({})).toBeUndefined();
    expect(parseStoreProductId(productId)).toBe(productId);
  });

  it.each([
    () => parseStoreEmptyQuery({ page: '1' }),
    () => parseStoreProductListQuery({ keyword: '' }),
    () => parseStoreProductListQuery({ keyword: '   ' }),
    () => parseStoreProductListQuery({ page: '0' }),
    () => parseStoreProductListQuery({ page: '01' }),
    () => parseStoreProductListQuery({ page_size: '101' }),
    () => parseStoreProductListQuery({ sort: 'POPULAR' }),
    () => parseStoreProductListQuery({ brand_id: 'not-an-ulid' }),
    () => parseStoreProductListQuery({ category_id: [categoryId] }),
    () => parseStoreProductListQuery({ status: 'ACTIVE' }),
    () => parseStoreProductId('../product'),
  ])('rejects open or contract-invalid input', (parse) => {
    expect(parse).toThrowError(ApplicationError);
  });
});
