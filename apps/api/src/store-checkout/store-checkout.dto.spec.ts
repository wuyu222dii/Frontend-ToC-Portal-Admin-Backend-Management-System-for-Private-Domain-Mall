import { describe, expect, it } from 'vitest';

import { parseStoreCheckoutQuoteBody } from './store-checkout.dto';

const ADDRESS_ID = '01J00000000000000000000001';
const SKU_ID = '01J00000000000000000000002';
const OTHER_SKU_ID = '01J00000000000000000000003';

function body(source: 'BUY_NOW' | 'CART' = 'CART') {
  return {
    address_id: ADDRESS_ID,
    items: [{ quantity: 2, sku_id: SKU_ID }],
    source,
  };
}

describe('B9.1 Store checkout quote DTO', () => {
  it('normalizes an exact CART request', () => {
    expect(parseStoreCheckoutQuoteBody(body())).toEqual({
      addressId: ADDRESS_ID,
      items: [{ quantity: 2, skuId: SKU_ID }],
      source: 'CART',
    });
  });

  it('accepts BUY_NOW only with exactly one item', () => {
    expect(parseStoreCheckoutQuoteBody(body('BUY_NOW'))).toMatchObject({ source: 'BUY_NOW' });
    expect(() => parseStoreCheckoutQuoteBody({
      ...body('BUY_NOW'),
      items: [{ quantity: 1, sku_id: SKU_ID }, { quantity: 1, sku_id: OTHER_SKU_ID }],
    })).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it.each([
    [{ ...body(), extra: true }],
    [{ ...body(), address_id: 'not-a-ulid' }],
    [{ ...body(), source: 'ORDER' }],
    [{ ...body(), items: [] }],
    [{ ...body(), items: [{ quantity: 0, sku_id: SKU_ID }] }],
    [{ ...body(), items: [{ quantity: 100, sku_id: SKU_ID }] }],
    [{ ...body(), items: [{ quantity: 1.5, sku_id: SKU_ID }] }],
    [{ ...body(), items: [{ quantity: 1, sku_id: 'not-a-ulid' }] }],
    [{ ...body(), items: [{ quantity: 1, sku_id: SKU_ID, selected: true }] }],
    [{ ...body(), items: [{ quantity: 1, sku_id: SKU_ID }, { quantity: 2, sku_id: SKU_ID }] }],
  ])('rejects an invalid or non-closed request body', (value) => {
    expect(() => parseStoreCheckoutQuoteBody(value)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' }),
    );
  });
});
