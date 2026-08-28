import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CustomerSession } from '../types/store-identity';
import { clearCustomerSession, saveCustomerSession } from '../utils/customer-session';
import {
  createStoreAddress,
  deleteStoreAddress,
  getFavoriteState,
  listFavorites,
  mergeStoreCart,
  putFavorite,
  putStoreCartItem,
  updateStoreAddress,
} from './store-shopping';

const session: CustomerSession = {
  access_token: 'shopping-access-token-1234',
  refresh_token: 'shopping-refresh-token-123',
  role: 'CUSTOMER',
  assurance: 'WECHAT',
  access_expires_at: '2030-01-01T00:00:00.000Z',
  refresh_expires_at: '2030-02-01T00:00:00.000Z',
};
const PRODUCT_ID = '01J00000000000000000000000';
const SKU_ID = '01J10000000000000000000000';
const ADDRESS_ID = '01J20000000000000000000000';

function requestEnvironment() {
  const requests: UniNamespace.RequestOptions[] = [];
  vi.stubGlobal('uni', {
    getStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    request(options: UniNamespace.RequestOptions) {
      requests.push(options);
      return { abort() {} } as UniNamespace.RequestTask;
    },
    setStorageSync: vi.fn(),
  });
  saveCustomerSession(session);
  return requests;
}

describe('B8 shopping authenticated client', () => {
  afterEach(() => {
    clearCustomerSession();
    vi.unstubAllGlobals();
  });

  it('encodes favorite search and uses PUT with a stable caller key', () => {
    const requests = requestEnvironment();
    void listFavorites({ keyword: '洗 护', page: 2, page_size: 20 });
    void putFavorite(PRODUCT_ID, '00000000-0000-4000-8000-000000000001');
    expect(requests[0]).toMatchObject({
      method: 'GET',
      url: '/api/v1/store/favorites?keyword=%E6%B4%97%20%E6%8A%A4&page=2&page_size=20',
    });
    expect(requests[1]).toMatchObject({
      method: 'PUT',
      url: `/api/v1/store/favorites/${PRODUCT_ID}`,
      header: expect.objectContaining({
        Authorization: `Bearer ${session.access_token}`,
        'Idempotency-Key': '00000000-0000-4000-8000-000000000001',
      }),
    });
  });

  it('sends exact cart and address mutation contracts', () => {
    const requests = requestEnvironment();
    void putStoreCartItem(SKU_ID, { quantity: 3, selected: true }, 'cart-write-key');
    void mergeStoreCart({ items: [{ sku_id: SKU_ID, quantity: 2, selected: false }] }, 'merge-key');
    void createStoreAddress({
      recipient_name: '张三', phone: '13800000000', province: '浙江省', city: '杭州市',
      district: '西湖区', detail: '文一路 1 号', is_default: true,
    }, 'address-create-key');
    void updateStoreAddress(ADDRESS_ID, {
      recipient_name: '张三', phone: '13800000000', province: '浙江省', city: '杭州市',
      district: '西湖区', detail: '文一路 2 号', is_default: true,
    }, 4, 'address-update-key');
    void deleteStoreAddress(ADDRESS_ID, 5, 'address-delete-key');

    expect(requests[0]).toMatchObject({
      data: { quantity: 3, selected: true }, method: 'PUT',
      url: `/api/v1/store/cart/items/${SKU_ID}`,
    });
    expect(requests[1]).toMatchObject({
      data: { items: [{ sku_id: SKU_ID, quantity: 2, selected: false }] },
      method: 'POST', url: '/api/v1/store/cart/merge',
    });
    expect(requests[2]).toMatchObject({ method: 'POST', url: '/api/v1/store/addresses' });
    expect(requests[3]?.header).toMatchObject({
      'Idempotency-Key': 'address-update-key', 'If-Match': '"4"',
    });
    expect(requests[4]?.header).toMatchObject({
      'Idempotency-Key': 'address-delete-key', 'If-Match': '"5"',
    });
  });

  it('rejects malformed path identifiers before starting a request', () => {
    const requests = requestEnvironment();
    expect(() => putFavorite('not-a-product')).toThrow('product_id is invalid');
    expect(() => putFavorite(PRODUCT_ID.toLowerCase())).toThrow('product_id is invalid');
    expect(() => updateStoreAddress('not-an-address', {
      recipient_name: '张三', phone: '13800000000', province: '浙江省', city: '杭州市',
      district: '西湖区', detail: '文一路 2 号', is_default: false,
    }, 1)).toThrow('address_id is invalid');
    expect(requests).toHaveLength(0);
  });

  it('rejects a favorite state for a different product target', async () => {
    const requests = requestEnvironment();
    const pending = getFavoriteState(PRODUCT_ID);
    requests[0]?.success?.({
      data: {
        code: 'OK', message: 'success',
        data: { product_id: SKU_ID, is_favorite: true }, request_id: 'req_wrong_target',
      },
      statusCode: 200,
      header: {},
      cookies: [],
    });
    await expect(pending).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
      status: 502,
    });
  });
});
