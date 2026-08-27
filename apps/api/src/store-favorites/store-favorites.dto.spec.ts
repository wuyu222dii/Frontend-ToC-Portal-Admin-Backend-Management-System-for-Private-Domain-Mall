import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseStoreFavoriteListQuery,
  parseStoreFavoriteProductId,
} from './store-favorites.dto';

const productId = '01J00000000000000000000000';

describe('Store Favorites request DTOs', () => {
  it('applies the frozen list defaults', () => {
    expect(parseStoreFavoriteListQuery({})).toEqual({ page: 1, pageSize: 20 });
  });

  it('parses closed pagination fields and trims the product-name keyword', () => {
    expect(parseStoreFavoriteListQuery({
      keyword: '  Facial Cleanser  ',
      page: '2',
      page_size: '100',
    })).toEqual({
      keyword: 'Facial Cleanser',
      page: 2,
      pageSize: 100,
    });
  });

  it('counts the normalized keyword by Unicode code point', () => {
    expect(parseStoreFavoriteListQuery({ keyword: `  ${'🌿'.repeat(200)}  ` }).keyword)
      .toBe('🌿'.repeat(200));
    expect(() => parseStoreFavoriteListQuery({ keyword: '🌿'.repeat(201) }))
      .toThrowError(ApplicationError);
  });

  it('accepts only a valid product ULID', () => {
    expect(parseStoreFavoriteProductId(productId)).toBe(productId);
    expect(() => parseStoreFavoriteProductId('../product')).toThrowError(ApplicationError);
  });

  it.each([
    () => parseStoreFavoriteListQuery(null),
    () => parseStoreFavoriteListQuery([]),
    () => parseStoreFavoriteListQuery(new Date()),
    () => parseStoreFavoriteListQuery({ keyword: '' }),
    () => parseStoreFavoriteListQuery({ keyword: '   ' }),
    () => parseStoreFavoriteListQuery({ keyword: 1 }),
    () => parseStoreFavoriteListQuery({ page: '0' }),
    () => parseStoreFavoriteListQuery({ page: '01' }),
    () => parseStoreFavoriteListQuery({ page: '2147483648' }),
    () => parseStoreFavoriteListQuery({ page_size: '0' }),
    () => parseStoreFavoriteListQuery({ page_size: '101' }),
    () => parseStoreFavoriteListQuery({ page_size: 20 }),
    () => parseStoreFavoriteListQuery({ status: 'ACTIVE' }),
  ])('rejects open or contract-invalid list input', (parse) => {
    expect(parse).toThrowError(ApplicationError);
  });
});
