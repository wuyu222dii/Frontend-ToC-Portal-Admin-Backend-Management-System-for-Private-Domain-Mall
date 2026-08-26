import { describe, expect, it } from 'vitest';

import type { StoreProductDetail } from '../types/store-catalog';
import type { GuestCartItem } from './guest-cart';
import {
  guestCartTotalAmount,
  invalidGuestCartView,
  refreshGuestCartItem,
  unverifiedGuestCartView,
} from './guest-cart-refresh';

const item: GuestCartItem = {
  quantity: 4,
  selected: true,
  snapshot: {
    product_id: 'product-1',
    product_name: '旧商品名',
    sku_id: 'sku-1',
    sku_name: '旧规格',
    spec_label: '容量：300ml',
    image_url: null,
    retail_price: '10.10',
    available_stock: 8,
    is_salable: true,
  },
};

function detail(overrides: Partial<StoreProductDetail> = {}): StoreProductDetail {
  return {
    product_id: 'product-1',
    spu_code: 'SPU-1',
    name: '当前商品名',
    subtitle: null,
    introduction: null,
    ingredients: null,
    usage_method: null,
    brand: { brand_id: 'brand-1', name: '品牌', description: null, logo_url: null, sort_order: 0 },
    category: { category_id: 'category-1', name: '分类', icon_url: null, sort_order: 0 },
    images: [{ url: 'https://assets.example.test/current.png', sort_order: 0, is_primary: true }],
    skus: [{
      sku_id: 'sku-1',
      code: 'SKU-1',
      name: '当前规格',
      spec_json: { attributes: [{ name: '容量', value: '500ml' }] },
      retail_price: '12.30',
      is_recommended: true,
      available_stock: 2,
      is_salable: true,
    }],
    net_sales_count: 0,
    is_hot: false,
    is_new: false,
    ...overrides,
  };
}

describe('guest cart refresh projection', () => {
  it('updates the display snapshot, detects changes and clamps quantity to current stock', () => {
    const result = refreshGuestCartItem(item, detail());
    expect(result).not.toBeNull();
    expect(result?.item).toMatchObject({
      quantity: 2,
      selected: true,
      snapshot: {
        product_name: '当前商品名',
        spec_label: '容量：500ml',
        retail_price: '12.30',
        available_stock: 2,
      },
    });
    expect(result?.view).toMatchObject({
      availability: 'ready',
      price_changed: true,
      stock_changed: true,
    });
  });

  it('returns null for a missing SKU and keeps sold-out quantity as display-only history', () => {
    expect(refreshGuestCartItem(item, detail({ skus: [] }))).toBeNull();
    const result = refreshGuestCartItem(item, detail({
      skus: [{ ...detail().skus[0]!, available_stock: 0, is_salable: false }],
    }));
    expect(result?.item.quantity).toBe(4);
    expect(result?.view.availability).toBe('sold-out');
  });

  it('uses integer cents and excludes invalid, unverified, sold-out and unselected lines', () => {
    const ready = refreshGuestCartItem({
      ...item,
      quantity: 3,
      snapshot: { ...item.snapshot, retail_price: '0.10' },
    }, detail({
      skus: [{ ...detail().skus[0]!, retail_price: '0.10', available_stock: 9 }],
    }))!.view;
    const unselected = { ...ready, item: { ...ready.item, selected: false } };
    expect(guestCartTotalAmount([
      ready,
      unselected,
      invalidGuestCartView(item),
      unverifiedGuestCartView(item, true),
      { ...ready, availability: 'sold-out' },
    ])).toBe('0.30');
  });
});
