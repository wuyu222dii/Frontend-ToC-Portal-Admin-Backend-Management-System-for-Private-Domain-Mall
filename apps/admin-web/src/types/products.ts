import type { components } from '@qingxu/contracts';

export type ProductCreateRequest = components['schemas']['ProductCreateRequest'];
export type ProductUpdateRequest = components['schemas']['ProductUpdateRequest'];
export type SkuCreateRequest = components['schemas']['SkuCreateRequest'];
export type SkuUpdateRequest = components['schemas']['SkuUpdateRequest'];
export type ProductLifecycleRequest = components['schemas']['ProductLifecycleAction'];
export type SkuLifecycleRequest = components['schemas']['SkuLifecycleAction'];
export type ProductLifecycleConfirmationRequest = ProductLifecycleRequest &
  components['schemas']['HighRiskConfirmationFields'];
export type SkuLifecycleConfirmationRequest = SkuLifecycleRequest &
  components['schemas']['HighRiskConfirmationFields'];
export type RestoreRequest = components['schemas']['ClosedReasonRequest'];

export type AdminProductListResponse = components['schemas']['AdminProductListResponse'];
export type ProductDetailResponse = components['schemas']['ProductDetailResponse'];
export type SkuResponse = components['schemas']['SkuResponse'];
export type HighRiskPreviewResponse = components['schemas']['HighRiskPreviewResponse'];
export type CommandResponse = components['schemas']['CommandResponse'];

export type AdminProductListData = AdminProductListResponse['data'];
export type AdminProductListItem = AdminProductListData['items'][number];
export type ProductDetail = ProductDetailResponse['data'];
export type ProductSummary = AdminProductListItem['product'];
export type ProductStatus = ProductSummary['status'];
export type ProductImage = ProductDetail['images'][number];
export type Sku = SkuResponse['data'];
export type SkuStatus = Sku['status'];
export type HighRiskPreview = HighRiskPreviewResponse['data'];
export type ProductLifecycleAction = ProductLifecycleRequest['action'];
export type SkuLifecycleAction = SkuLifecycleRequest['action'];
export type BrandReference = components['schemas']['BrandView'];
export type CategoryReference = components['schemas']['CategoryView'];

type Pagination = components['schemas']['PaginationView'];

export interface ProductListQuery {
  page?: Pagination['page'];
  pageSize?: Pagination['page_size'];
  keyword?: ProductSummary['name'];
  brandId?: BrandReference['brand_id'];
  categoryId?: CategoryReference['category_id'];
  status?: ProductStatus;
  recommended?: Sku['is_recommended'];
}

export interface ActiveProductReferences {
  brands: BrandReference[];
  categories: CategoryReference[];
}
