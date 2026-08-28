import { describe, expect, it } from 'vitest';

import { StoreEnvelopeFormatError } from './store-client';
import {
  decodeFavoriteList,
  decodeFavoriteState,
  decodeStoreAddressDetail,
  decodeStoreAddressList,
  decodeStoreCart,
} from './store-shopping-decoders';

const PRODUCT_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const FAVORITE_ID = '01J20000000000000000000000';
const ADDRESS_ID = '01J30000000000000000000000';

const cart = {
  cart_id: '01J40000000000000000000000',
  items: [{
    sku_id: SKU_ID,
    product_id: PRODUCT_ID,
    product_name: '青序洗护套装',
    sku_name: '标准装',
    spec_json: { attributes: [{ name: '容量', value: '500ml' }] },
    primary_image_url: 'http://127.0.0.1:9002/mall-development/public/item.png',
    quantity: 2,
    selected: true,
    retail_price: '39.00',
    available_stock: 8,
    sale_status: 'SALEABLE',
  }],
  total_amount: '78.00',
};

describe('B8 shopping response decoders', () => {
  it('accepts exact favorite, cart and address projections', () => {
    expect(decodeFavoriteList({
      items: [{
        favorite_id: FAVORITE_ID,
        created_at: '2026-08-28T01:00:00.000Z',
        product: {
          product_id: PRODUCT_ID,
          name: '青序洗护套装',
          primary_image_url: null,
          minimum_active_price: null,
          is_salable: false,
          availability: 'UNAVAILABLE',
        },
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    }).items[0]?.favorite_id).toBe(FAVORITE_ID);
    expect(decodeFavoriteState({ product_id: PRODUCT_ID, is_favorite: true }))
      .toEqual({ product_id: PRODUCT_ID, is_favorite: true });
    expect(decodeStoreCart(cart)).toEqual(cart);
    expect(decodeStoreAddressList([{
      address_id: ADDRESS_ID,
      recipient_name_masked: '张*',
      phone_masked: '138 **** 0000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail_masked: '文*路',
      is_default: true,
      version: 1,
    }])).toHaveLength(1);
    expect(decodeStoreAddressDetail({
      address_id: ADDRESS_ID,
      recipient_name: '张三',
      phone: '13800000000',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail: '文一路 1 号',
      is_default: true,
      version: 2,
    }).phone).toBe('13800000000');
  });

  it.each([
    { ...cart, extra: true },
    { ...cart, cart_id: 'invalid' },
    { ...cart, total_amount: '78' },
    { ...cart, items: [{ ...cart.items[0], sale_status: 'UNKNOWN' }] },
    { ...cart, items: [{ ...cart.items[0], quantity: 100 }] },
    { ...cart, cart_id: null },
  ])('rejects malformed cart data', (value) => {
    expect(() => decodeStoreCart(value)).toThrow(StoreEnvelopeFormatError);
  });

  it('rejects PII and favorite shape drift', () => {
    expect(() => decodeStoreAddressDetail({
      address_id: ADDRESS_ID,
      recipient_name: '张三',
      phone: '１３８００００００００',
      province: '浙江省',
      city: '杭州市',
      district: '西湖区',
      detail: '文一路 1 号',
      is_default: true,
      version: 1,
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeFavoriteState({
      product_id: PRODUCT_ID,
      is_favorite: true,
      version: 1,
    })).toThrow(StoreEnvelopeFormatError);
    expect(() => decodeStoreCart({
      ...cart,
      items: [{ ...cart.items[0], retail_price: '99999999999999999.00' }],
    })).toThrow(StoreEnvelopeFormatError);
  });
});
