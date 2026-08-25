<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { onLoad, onReachBottom } from '@dcloudio/uni-app';

import {
  StoreApiError,
  listStoreBrands,
  listStoreCategories,
  listStoreProducts,
  type StoreCancelableRequest,
} from '../../api';
import QxBottomNav from '../../components/storefront/QxBottomNav.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxProductCard from '../../components/storefront/QxProductCard.vue';
import QxSearchTrigger from '../../components/storefront/QxSearchTrigger.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type {
  StoreBrand,
  StoreBrandListData,
  StoreCategory,
  StoreCategoryListData,
  StoreProductListData,
  StoreProductListItem,
  StoreProductListQuery,
} from '../../types/store-catalog';
import {
  handleBottomNavigation,
  openProduct,
  openSearch,
} from '../../utils/store-navigation';

type ProductSort = NonNullable<StoreProductListQuery['sort']>;
type RequestState = 'idle' | 'loading' | 'ready' | 'error' | 'rate-limited';

const PAGE_SIZE = 20;
const SORT_OPTIONS = [
  { label: '综合', value: 'COMPREHENSIVE' },
  { label: '热销', value: 'HOT' },
  { label: '最新', value: 'NEWEST' },
  { label: '价格低到高', value: 'PRICE_ASC' },
  { label: '价格高到低', value: 'PRICE_DESC' },
] as const satisfies ReadonlyArray<{ label: string; value: ProductSort }>;

const categories = ref<StoreCategory[]>([]);
const brands = ref<StoreBrand[]>([]);
const products = ref<StoreProductListItem[]>([]);
const selectedCategoryId = ref('');
const selectedBrandId = ref('');
const selectedSort = ref<ProductSort>('COMPREHENSIVE');
const currentPage = ref(1);
const total = ref(0);
const categoriesState = ref<RequestState>('idle');
const brandsState = ref<RequestState>('idle');
const productsState = ref<RequestState>('idle');
const categoriesRetryAfter = ref(0);
const brandsRetryAfter = ref(0);
const productsRetryAfter = ref(0);
const loadingMore = ref(false);
const loadMoreFailure = ref<'error' | 'rate-limited' | null>(null);
const loadMoreRetryAfter = ref(0);

let categoriesRequest: StoreCancelableRequest<StoreCategoryListData> | undefined;
let brandsRequest: StoreCancelableRequest<StoreBrandListData> | undefined;
let productsRequest: StoreCancelableRequest<StoreProductListData> | undefined;
let categoriesGeneration = 0;
let brandsGeneration = 0;
let productsGeneration = 0;

const selectedCategoryName = computed(() => {
  if (selectedCategoryId.value === '') return '全部商品';
  return categories.value.find((item) => item.category_id === selectedCategoryId.value)?.name
    ?? '所选分类';
});
const hasMore = computed(() => products.value.length < total.value);
const resultCopy = computed(() => `${total.value} 件商品`);

function requestFailure(error: unknown): {
  state: 'error' | 'rate-limited';
  retryAfterSeconds: number;
} | null {
  if (error instanceof StoreApiError && error.aborted) return null;
  if (error instanceof StoreApiError && error.status === 429) {
    return {
      state: 'rate-limited',
      retryAfterSeconds: error.retryAfterSeconds ?? 1,
    };
  }
  return { state: 'error', retryAfterSeconds: 0 };
}

function loadCategories(): void {
  categoriesRequest?.abort();
  const generation = ++categoriesGeneration;
  categoriesState.value = 'loading';
  categoriesRetryAfter.value = 0;
  const request = listStoreCategories();
  categoriesRequest = request;

  void request.promise
    .then((data) => {
      if (generation !== categoriesGeneration) return;
      categories.value = data.items;
      categoriesState.value = 'ready';
      if (selectedCategoryId.value !== '' &&
        !data.items.some((item) => item.category_id === selectedCategoryId.value)) {
        selectedCategoryId.value = '';
        loadProducts(false);
      }
    })
    .catch((error: unknown) => {
      if (generation !== categoriesGeneration) return;
      const failure = requestFailure(error);
      if (failure === null) return;
      categoriesState.value = failure.state;
      categoriesRetryAfter.value = failure.retryAfterSeconds;
    });
}

function loadBrands(): void {
  brandsRequest?.abort();
  const generation = ++brandsGeneration;
  brandsState.value = 'loading';
  brandsRetryAfter.value = 0;
  const request = listStoreBrands();
  brandsRequest = request;

  void request.promise
    .then((data) => {
      if (generation !== brandsGeneration) return;
      brands.value = data.items;
      brandsState.value = 'ready';
    })
    .catch((error: unknown) => {
      if (generation !== brandsGeneration) return;
      const failure = requestFailure(error);
      if (failure === null) return;
      brandsState.value = failure.state;
      brandsRetryAfter.value = failure.retryAfterSeconds;
    });
}

function productQuery(page: number): StoreProductListQuery {
  const query: StoreProductListQuery = {
    page,
    page_size: PAGE_SIZE,
    sort: selectedSort.value,
  };
  if (selectedCategoryId.value !== '') query.category_id = selectedCategoryId.value;
  if (selectedBrandId.value !== '') query.brand_id = selectedBrandId.value;
  return query;
}

function loadProducts(append = false): void {
  if (append && (loadingMore.value || !hasMore.value)) return;

  productsRequest?.abort();
  const generation = ++productsGeneration;
  const requestedPage = append ? currentPage.value + 1 : 1;
  if (append) {
    loadingMore.value = true;
    loadMoreFailure.value = null;
    loadMoreRetryAfter.value = 0;
  } else {
    products.value = [];
    total.value = 0;
    currentPage.value = 1;
    loadingMore.value = false;
    productsState.value = 'loading';
    loadMoreFailure.value = null;
    loadMoreRetryAfter.value = 0;
  }
  productsRetryAfter.value = 0;
  const request = listStoreProducts(productQuery(requestedPage));
  productsRequest = request;

  void request.promise
    .then((data) => {
      if (generation !== productsGeneration) return;
      products.value = append ? [...products.value, ...data.items] : data.items;
      currentPage.value = data.pagination.page;
      total.value = data.pagination.total;
      productsState.value = 'ready';
      loadMoreFailure.value = null;
    })
    .catch((error: unknown) => {
      if (generation !== productsGeneration) return;
      const failure = requestFailure(error);
      if (failure === null) return;
      if (append && products.value.length > 0) {
        productsState.value = 'ready';
        loadMoreFailure.value = failure.state;
        loadMoreRetryAfter.value = failure.retryAfterSeconds;
      } else {
        productsState.value = failure.state;
        productsRetryAfter.value = failure.retryAfterSeconds;
      }
    })
    .finally(() => {
      if (generation === productsGeneration) loadingMore.value = false;
    });
}

function resetAndLoadProducts(): void {
  loadProducts(false);
}

function selectCategory(categoryId: string): void {
  if (categoryId === selectedCategoryId.value) return;
  selectedCategoryId.value = categoryId;
  resetAndLoadProducts();
}

function selectBrand(brandId: string): void {
  if (brandId === selectedBrandId.value) return;
  selectedBrandId.value = brandId;
  resetAndLoadProducts();
}

function selectSort(sort: ProductSort): void {
  if (sort === selectedSort.value) return;
  selectedSort.value = sort;
  resetAndLoadProducts();
}

function loadNextPage(): void {
  if (productsState.value !== 'ready' || !hasMore.value) return;
  loadProducts(true);
}

function retryProducts(): void {
  loadProducts(false);
}

onLoad((query) => {
  const categoryId = query?.category_id;
  selectedCategoryId.value = typeof categoryId === 'string' ? categoryId.trim() : '';
  loadCategories();
  loadBrands();
  loadProducts(false);
});

onReachBottom(loadNextPage);

onBeforeUnmount(() => {
  categoriesGeneration += 1;
  brandsGeneration += 1;
  productsGeneration += 1;
  categoriesRequest?.abort();
  brandsRequest?.abort();
  productsRequest?.abort();
});
</script>

<template>
  <QxStoreShell :with-bottom-nav="true">
    <view class="category-page">
      <view class="category-header">
        <view class="category-header__title-row">
          <view>
            <text class="category-header__eyebrow">
              CATALOG
            </text>
            <text class="category-header__title">
              商品分类
            </text>
          </view>
          <text class="category-header__count">
            {{ resultCopy }}
          </text>
        </view>
        <QxSearchTrigger @activate="openSearch()" />
      </view>

      <view
        v-if="categoriesState === 'error' || categoriesState === 'rate-limited'"
        class="category-notice"
      >
        <QxCatalogState
          :kind="categoriesState"
          title="分类加载失败"
          description="仍可浏览全部商品，重试后可按分类筛选。"
          :retry-after-seconds="categoriesRetryAfter"
          :compact="true"
          @action="loadCategories"
        />
      </view>

      <view class="category-layout">
        <scroll-view
          class="category-rail"
          scroll-y
          :show-scrollbar="false"
        >
          <button
            class="category-rail__item"
            :class="{ 'category-rail__item--active': selectedCategoryId === '' }"
            @click="selectCategory('')"
          >
            全部
          </button>
          <button
            v-for="category in categories"
            :key="category.category_id"
            class="category-rail__item"
            :class="{
              'category-rail__item--active': selectedCategoryId === category.category_id,
            }"
            @click="selectCategory(category.category_id)"
          >
            {{ category.name }}
          </button>
          <text
            v-if="categoriesState === 'loading'"
            class="category-rail__loading"
          >
            分类加载中
          </text>
        </scroll-view>

        <view class="category-content">
          <view class="category-content__heading">
            <text class="category-content__title">
              {{ selectedCategoryName }}
            </text>
            <text class="category-content__summary">
              {{ resultCopy }}
            </text>
          </view>

          <view class="filter-group">
            <text class="filter-group__label">
              排序
            </text>
            <scroll-view
              class="filter-scroll"
              scroll-x
              :show-scrollbar="false"
            >
              <view class="filter-row">
                <button
                  v-for="option in SORT_OPTIONS"
                  :key="option.value"
                  class="filter-chip"
                  :class="{ 'filter-chip--active': selectedSort === option.value }"
                  @click="selectSort(option.value)"
                >
                  {{ option.label }}
                </button>
              </view>
            </scroll-view>
          </view>

          <view class="filter-group">
            <text class="filter-group__label">
              品牌
            </text>
            <scroll-view
              v-if="brandsState !== 'error' && brandsState !== 'rate-limited'"
              class="filter-scroll"
              scroll-x
              :show-scrollbar="false"
            >
              <view class="filter-row">
                <button
                  class="filter-chip"
                  :class="{ 'filter-chip--active': selectedBrandId === '' }"
                  @click="selectBrand('')"
                >
                  全部品牌
                </button>
                <button
                  v-for="brand in brands"
                  :key="brand.brand_id"
                  class="filter-chip"
                  :class="{ 'filter-chip--active': selectedBrandId === brand.brand_id }"
                  @click="selectBrand(brand.brand_id)"
                >
                  {{ brand.name }}
                </button>
                <text
                  v-if="brandsState === 'loading'"
                  class="filter-loading"
                >
                  品牌加载中
                </text>
              </view>
            </scroll-view>
            <QxCatalogState
              v-else
              :kind="brandsState"
              title="品牌筛选暂不可用"
              description="商品列表仍可正常浏览。"
              :retry-after-seconds="brandsRetryAfter"
              :compact="true"
              @action="loadBrands"
            />
          </view>

          <QxCatalogState
            v-if="productsState === 'loading'"
            kind="loading"
            title="正在加载商品"
          />
          <QxCatalogState
            v-else-if="productsState === 'error' || productsState === 'rate-limited'"
            :kind="productsState"
            :retry-after-seconds="productsRetryAfter"
            @action="retryProducts"
          />
          <QxCatalogState
            v-else-if="productsState === 'ready' && products.length === 0"
            kind="empty"
            title="没有找到商品"
            description="试试其他分类、品牌或排序。"
          />
          <template v-else-if="productsState === 'ready'">
            <view class="product-grid">
              <QxProductCard
                v-for="product in products"
                :key="product.product_id"
                :product="product"
                variant="list"
                @select="openProduct"
              />
            </view>
            <QxCatalogState
              v-if="loadMoreFailure"
              :kind="loadMoreFailure"
              title="下一页加载失败"
              description="已加载的商品仍可继续浏览。"
              :retry-after-seconds="loadMoreRetryAfter"
              :compact="true"
              @action="loadNextPage"
            />
            <button
              v-else-if="hasMore"
              class="load-more"
              :disabled="loadingMore"
              @click="loadNextPage"
            >
              {{ loadingMore ? '加载中…' : '加载更多' }}
            </button>
            <text
              v-else-if="products.length > 0"
              class="list-end"
            >
              已展示全部商品
            </text>
          </template>
        </view>
      </view>
    </view>

    <template #bottom>
      <QxBottomNav
        active="category"
        @select="handleBottomNavigation"
      />
    </template>
  </QxStoreShell>
</template>

<style scoped>
.category-page {
  min-height: 100vh;
  background: var(--qx-store-background, #f6f8f6);
}

.category-header {
  position: sticky;
  z-index: 12;
  top: 0;
  padding: calc(24rpx + env(safe-area-inset-top)) 28rpx 24rpx;
  border-bottom: 1px solid var(--qx-store-line, #e4e8e5);
  background: rgba(246, 248, 246, 0.97);
}

.category-header__title-row,
.category-content__heading {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20rpx;
}

.category-header__title-row {
  margin-bottom: 22rpx;
}

.category-header__eyebrow,
.category-header__title,
.category-header__count,
.category-content__title,
.category-content__summary {
  display: block;
}

.category-header__eyebrow {
  color: var(--qx-store-brand, #496859);
  font-size: 18rpx;
  font-weight: 800;
}

.category-header__title {
  margin-top: 6rpx;
  color: var(--qx-store-brand-strong, #173b31);
  font-size: 38rpx;
  font-weight: 800;
  line-height: 1.25;
}

.category-header__count,
.category-content__summary {
  flex: 0 0 auto;
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
}

.category-notice {
  padding: 20rpx 20rpx 0;
}

.category-layout {
  display: grid;
  min-height: calc(100vh - 220rpx);
  grid-template-columns: 176rpx minmax(0, 1fr);
  align-items: start;
}

.category-rail {
  position: sticky;
  top: 220rpx;
  width: 176rpx;
  height: calc(100vh - 220rpx - 108rpx - env(safe-area-inset-bottom));
  border-right: 1px solid var(--qx-store-line, #e4e8e5);
  background: var(--qx-store-surface-soft, #edf3ef);
}

.category-rail__item {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 104rpx;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 16rpx 18rpx;
  color: var(--qx-store-text-soft, #5f6762);
  background: transparent;
  font-size: 22rpx;
  line-height: 1.35;
  text-align: center;
  word-break: break-word;
}

.category-rail__item--active {
  color: var(--qx-store-brand-strong, #173b31);
  background: var(--qx-store-surface, #ffffff);
  font-weight: 800;
}

.category-rail__item--active::before {
  position: absolute;
  top: 22rpx;
  bottom: 22rpx;
  left: 0;
  width: 6rpx;
  border-radius: 0 6rpx 6rpx 0;
  background: var(--qx-store-accent, #e27766);
  content: '';
}

.category-rail__loading,
.filter-loading {
  display: block;
  color: var(--qx-store-muted, #8d9690);
  font-size: 19rpx;
  text-align: center;
}

.category-rail__loading {
  padding: 24rpx 10rpx;
}

.category-content {
  min-width: 0;
  padding: 28rpx 20rpx 48rpx;
}

.category-content__heading {
  margin-bottom: 24rpx;
}

.category-content__title {
  min-width: 0;
  overflow: hidden;
  color: var(--qx-store-text, #202522);
  font-size: 30rpx;
  font-weight: 800;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filter-group {
  min-width: 0;
  margin-bottom: 24rpx;
}

.filter-group__label {
  display: block;
  margin-bottom: 12rpx;
  color: var(--qx-store-muted, #8d9690);
  font-size: 19rpx;
  font-weight: 700;
}

.filter-scroll {
  width: 100%;
  white-space: nowrap;
}

.filter-row {
  display: inline-flex;
  min-width: 100%;
  align-items: center;
  gap: 12rpx;
  padding-right: 12rpx;
}

.filter-chip {
  min-height: 58rpx;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 18rpx;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 10rpx;
  color: var(--qx-store-text-soft, #5f6762);
  background: var(--qx-store-surface, #ffffff);
  font-size: 20rpx;
  line-height: 58rpx;
  white-space: nowrap;
}

.filter-chip--active {
  border-color: var(--qx-store-brand, #496859);
  color: #ffffff;
  background: var(--qx-store-brand, #496859);
  font-weight: 700;
}

.product-grid {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr);
  gap: 16rpx;
}

.load-more {
  width: 100%;
  min-height: 76rpx;
  margin-top: 24rpx;
  border: 1px solid var(--qx-store-line-strong, #cfd6d1);
  border-radius: 10rpx;
  color: var(--qx-store-brand, #496859);
  background: var(--qx-store-surface, #ffffff);
  font-size: 22rpx;
  font-weight: 700;
}

.load-more[disabled] {
  color: var(--qx-store-muted, #8d9690);
  background: var(--qx-store-surface-soft, #edf3ef);
}

.list-end {
  display: block;
  padding: 32rpx 0 8rpx;
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
  text-align: center;
}

@media (min-width: 768px) {
  .category-header {
    padding-right: 20px;
    padding-left: 20px;
  }

  .category-content {
    padding-right: 16px;
    padding-left: 16px;
  }
}
</style>
