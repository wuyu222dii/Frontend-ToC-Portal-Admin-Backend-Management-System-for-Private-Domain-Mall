import type { components, operations } from '@qingxu/contracts';

export type StoreBanner = components['schemas']['StoreBannerView'];
export type StoreCategory = components['schemas']['StoreCategoryView'];
export type StoreBrand = components['schemas']['StoreBrandView'];
export type StoreProductImage = components['schemas']['StoreProductImageView'];
export type StoreSku = components['schemas']['StoreSkuView'];
export type StoreProductListItem = components['schemas']['StoreProductListItem'];
export type StoreProductDetail = components['schemas']['StoreProductDetailView'];

export type StoreHomeData = components['schemas']['HomeResponse']['data'];
export type StoreCategoryListData = components['schemas']['StoreCategoryListResponse']['data'];
export type StoreBrandListData = components['schemas']['StoreBrandListResponse']['data'];
export type StoreProductListData = components['schemas']['StoreProductListResponse']['data'];
export type StoreProductListQuery = NonNullable<
  operations['getStoreProducts']['parameters']['query']
>;

export type StoreErrorDetail = components['schemas']['ErrorDetail'];
export type StoreErrorResponse = components['schemas']['ErrorResponse'];
