import type {
  StoreBrandListData,
  StoreCategoryListData,
  StoreHomeData,
  StoreProductDetail,
  StoreProductListData,
  StoreProductListQuery,
} from '../types/store-catalog';
import { type StoreCancelableRequest, storeApiGet } from './store-client';

export function getStoreHome(): StoreCancelableRequest<StoreHomeData> {
  return storeApiGet('/store/home');
}

export function listStoreCategories(): StoreCancelableRequest<StoreCategoryListData> {
  return storeApiGet('/store/categories');
}

export function listStoreBrands(): StoreCancelableRequest<StoreBrandListData> {
  return storeApiGet('/store/brands');
}

export function listStoreProducts(
  query: StoreProductListQuery = {},
): StoreCancelableRequest<StoreProductListData> {
  return storeApiGet('/store/products', query);
}

export function getStoreProduct(productId: string): StoreCancelableRequest<StoreProductDetail> {
  return storeApiGet(`/store/products/${encodeURIComponent(productId)}`);
}
