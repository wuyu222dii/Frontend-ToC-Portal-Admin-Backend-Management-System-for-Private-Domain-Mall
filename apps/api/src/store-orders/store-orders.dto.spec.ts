import { describe, expect, it } from 'vitest';

import { parseStoreOrderSubmitBody } from './store-orders.dto';

const ADDRESS_ID = '01J00000000000000000000001';
const SKU_ID = '01J00000000000000000000002';
const OTHER_SKU_ID = '01J00000000000000000000003';
const QUOTE_ID = '01J00000000000000000000004';

function body(overrides: Record<string, unknown> = {}) {
  return {
    address_id: ADDRESS_ID,
    confirmation_hash: 'a'.repeat(64),
    items: [{ quantity: 1, sku_id: SKU_ID }],
    quote_id: QUOTE_ID,
    quote_token: 'q'.repeat(32),
    source: 'BUY_NOW',
    ...overrides,
  };
}

describe('B9.2 Store order submit DTO', () => {
  it('accepts the closed BUY_NOW shape and maps wire fields', () => {
    expect(parseStoreOrderSubmitBody(body())).toEqual({
      addressId: ADDRESS_ID,
      confirmationHash: 'a'.repeat(64),
      items: [{ quantity: 1, skuId: SKU_ID }],
      quoteId: QUOTE_ID,
      quoteToken: 'q'.repeat(32),
      source: 'BUY_NOW',
    });
  });

  it('accepts a CART request with unique SKU lines', () => {
    expect(parseStoreOrderSubmitBody(body({
      items: [
        { quantity: 2, sku_id: SKU_ID },
        { quantity: 3, sku_id: OTHER_SKU_ID },
      ],
      source: 'CART',
    })).items).toHaveLength(2);
  });

  it.each([
    ['non-object body', null],
    ['unknown field', body({ extra: true })],
    ['missing field', (() => { const value = body(); delete (value as Partial<typeof value>).quote_token; return value; })()],
    ['invalid source', body({ source: 'UNKNOWN' })],
    ['invalid address', body({ address_id: 'address' })],
    ['invalid quote ID', body({ quote_id: 'quote' })],
    ['empty items', body({ items: [] })],
    ['duplicate SKU', body({
      items: [{ quantity: 1, sku_id: SKU_ID }, { quantity: 2, sku_id: SKU_ID }],
      source: 'CART',
    })],
    ['invalid quantity', body({ items: [{ quantity: 0, sku_id: SKU_ID }] })],
    ['multiple BUY_NOW items', body({
      items: [{ quantity: 1, sku_id: SKU_ID }, { quantity: 1, sku_id: OTHER_SKU_ID }],
    })],
    ['short quote token', body({ quote_token: 'q'.repeat(31) })],
    ['long quote token', body({ quote_token: 'q'.repeat(513) })],
    ['uppercase confirmation hash', body({ confirmation_hash: 'A'.repeat(64) })],
    ['short confirmation hash', body({ confirmation_hash: 'a'.repeat(63) })],
  ])('rejects %s', (_label, value) => {
    expect(() => parseStoreOrderSubmitBody(value))
      .toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
