import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseStoreCartItemWriteBody,
  parseStoreCartMergeBody,
  parseStoreCartSkuId,
} from './store-cart.dto';

const skuId = '01J00000000000000000000000';
const secondSkuId = '01J00000000000000000000001';

describe('Store Cart request DTOs', () => {
  it('parses the closed item write shape', () => {
    expect(parseStoreCartItemWriteBody({ quantity: 99, selected: false })).toEqual({
      quantity: 99,
      selected: false,
    });
  });

  it.each([
    undefined,
    null,
    [],
    new Date(),
    {},
    { quantity: 1 },
    { selected: true },
    { quantity: 1, selected: true, status: 'ACTIVE' },
    { quantity: 0, selected: true },
    { quantity: 100, selected: true },
    { quantity: 1.5, selected: true },
    { quantity: '1', selected: true },
    { quantity: 1, selected: 1 },
  ])('rejects an invalid item write body', (body) => {
    expect(() => parseStoreCartItemWriteBody(body)).toThrowError(ApplicationError);
  });

  it('parses a closed merge request and maps wire field names', () => {
    expect(parseStoreCartMergeBody({
      items: [
        { quantity: 1, selected: true, sku_id: skuId },
        { quantity: 99, selected: false, sku_id: secondSkuId },
      ],
    })).toEqual({
      items: [
        { quantity: 1, selected: true, skuId },
        { quantity: 99, selected: false, skuId: secondSkuId },
      ],
    });
  });

  it('explicitly rejects duplicate sku_id values', () => {
    expect(() => parseStoreCartMergeBody({
      items: [
        { quantity: 1, selected: true, sku_id: skuId },
        { quantity: 2, selected: false, sku_id: skuId },
      ],
    })).toThrowError(ApplicationError);
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { items: [], extra: true },
    { items: [] },
    { items: 'not-an-array' },
    { items: Array.from({ length: 101 }, () => ({ quantity: 1, selected: true, sku_id: skuId })) },
    { items: [{ quantity: 1, selected: true }] },
    { items: [{ quantity: 1, selected: true, sku_id: 'not-an-ulid' }] },
    { items: [{ quantity: 1, selected: true, sku_id: skuId, extra: true }] },
    { items: [{ quantity: 0, selected: true, sku_id: skuId }] },
    { items: [{ quantity: 1, selected: 'true', sku_id: skuId }] },
  ])('rejects an invalid merge body', (body) => {
    expect(() => parseStoreCartMergeBody(body)).toThrowError(ApplicationError);
  });

  it('rejects sparse merge item arrays', () => {
    const items = new Array(1);
    expect(() => parseStoreCartMergeBody({ items })).toThrowError(ApplicationError);
  });

  it('accepts only a strict SKU ULID path value', () => {
    expect(parseStoreCartSkuId(skuId)).toBe(skuId);
    expect(() => parseStoreCartSkuId('../sku')).toThrowError(ApplicationError);
    expect(() => parseStoreCartSkuId(skuId.toLowerCase())).toThrowError(ApplicationError);
  });
});
