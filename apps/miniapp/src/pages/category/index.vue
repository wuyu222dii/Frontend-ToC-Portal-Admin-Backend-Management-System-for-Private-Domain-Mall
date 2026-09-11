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

const filterOpen = ref(false);

const selectedCategoryName = computed(() => {
  if (selectedCategoryId.value === '') return '全部商品';
  return categories.value.find((item) => item.category_id === selectedCategoryId.value)?.name
    ?? '所选分类';
});
const hasMore = computed(() => products.value.length < total.value);
const catalogCountCopy = computed(() => {
  if (selectedCategoryId.value === '') return `全品类共 ${total.value} 件`;
  return `${selectedCategoryName.value} 共 ${total.value} 件`;
});
const isPriceSort = computed(() => (
  selectedSort.value === 'PRICE_ASC' || selectedSort.value === 'PRICE_DESC'
));
const priceSortMark = computed(() => {
  if (selectedSort.value === 'PRICE_ASC') return '↑';
  if (selectedSort.value === 'PRICE_DESC') return '↓';
  return '⇅';
});
const heroTitle = computed(() => (
  selectedCategoryId.value === ''
    ? '沙龙专研 · 纯净洗护系统'
    : selectedCategoryName.value
));
const heroDesc = computed(() => (
  selectedCategoryId.value === ''
    ? '按分类挑选头皮与发丝护理'
    : catalogCountCopy.value
));

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

function selectPriceSort(): void {
  selectSort(selectedSort.value === 'PRICE_ASC' ? 'PRICE_DESC' : 'PRICE_ASC');
}

function toggleFilter(): void {
  filterOpen.value = !filterOpen.value;
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
      <view
        class="category-header-slot"
        aria-hidden="true"
      />
      <view
        class="category-header"
        aria-label="商品分类"
      >
        <view class="category-header__title-row">
          <view class="category-header__copy">
            <text class="category-header__title">
              商品分类
            </text>
            <text class="category-header__count">
              {{ catalogCountCopy }}
            </text>
          </view>
        </view>
        <view class="category-header__search">
          <QxSearchTrigger
            variant="pill"
            surface="cream"
            label="搜索控油蓬松、生姜修护、鱼子酱发膜..."
            hint="专研推荐"
            @activate="openSearch()"
          />
        </view>
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
            hover-class="category-rail__item--pressed"
            @click="selectCategory('')"
          >
            全部商品
          </button>
          <button
            v-for="category in categories"
            :key="category.category_id"
            class="category-rail__item"
            :class="{
              'category-rail__item--active': selectedCategoryId === category.category_id,
            }"
            hover-class="category-rail__item--pressed"
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
          <view class="category-toolbar">
            <view class="category-toolbar__sorts">
              <button
                class="category-toolbar__item"
                :class="{ 'category-toolbar__item--active': selectedSort === 'COMPREHENSIVE' }"
                @click="selectSort('COMPREHENSIVE')"
              >
                综合
              </button>
              <button
                class="category-toolbar__item"
                :class="{ 'category-toolbar__item--active': selectedSort === 'HOT' }"
                @click="selectSort('HOT')"
              >
                销量
              </button>
              <button
                class="category-toolbar__item"
                :class="{ 'category-toolbar__item--active': selectedSort === 'NEWEST' }"
                @click="selectSort('NEWEST')"
              >
                新品
              </button>
              <button
                class="category-toolbar__item"
                :class="{ 'category-toolbar__item--active': isPriceSort }"
                @click="selectPriceSort"
              >
                价格
                <text class="category-toolbar__mark">
                  {{ priceSortMark }}
                </text>
              </button>
            </view>
            <button
              class="category-toolbar__filter"
              :class="{ 'category-toolbar__filter--open': filterOpen || selectedBrandId !== '' }"
              @click="toggleFilter"
            >
              筛选
            </button>
          </view>

          <view
            v-if="filterOpen"
            class="category-brands"
          >
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

          <view class="category-hero">
            <view class="category-hero__copy">
              <text class="category-hero__chip">
                SALON CARE
              </text>
              <text class="category-hero__title">
                {{ heroTitle }}
              </text>
              <text class="category-hero__desc">
                {{ heroDesc }}
              </text>
            </view>
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
                v-for="(product, index) in products"
                :key="product.product_id"
                :product="product"
                :rank="selectedSort === 'HOT' ? index + 1 : 0"
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
            <view
              v-else-if="products.length > 0"
              class="category-footnote"
            >
              <text class="category-footnote__en">
                ZEFENG CARE LUXURY SALON SYSTEM
              </text>
              <text class="category-footnote__zh">
                沙龙级专研配方 · 无硅油低敏呵护
              </text>
            </view>
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
  min-height: 100%;
  background: #fbf9f5;
}

.category-header-slot {
  height: calc(var(--qx-nav-bar, 96rpx) + 108rpx);
}

.category-header {
  position: fixed;
  z-index: 20;
  top: 0;
  right: 0;
  left: 0;
  width: 100%;
  border-bottom: 1px solid rgba(242, 236, 227, 0.6);
  background: #fbf9f5;
}

/* #ifndef MP-WEIXIN */
.category-header {
  max-width: 414px;
  margin: 0 auto;
}
/* #endif */

.category-header__title-row {
  box-sizing: border-box;
  display: flex;
  min-height: var(--qx-nav-bar, 96rpx);
  align-items: center;
  padding-top: var(--qx-status-bar, 8rpx);
  padding-right: var(--qx-capsule-right, 32rpx);
  padding-left: var(--qx-capsule-gap, 32rpx);
}

.category-header__copy {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: baseline;
  gap: 16rpx;
}

.category-header__title {
  color: #1f1c18;
  font-size: 40rpx;
  font-weight: 700;
  line-height: 1.2;
  letter-spacing: -0.4rpx;
}

.category-header__count {
  min-width: 0;
  overflow: hidden;
  color: #9e958b;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-header__search {
  padding: 12rpx 32rpx 20rpx;
}

.category-notice {
  padding: 20rpx 20rpx 0;
}

.category-layout {
  display: flex;
  min-height: calc(100vh - 220rpx);
  align-items: stretch;
}

.category-rail {
  position: sticky;
  top: calc(var(--qx-nav-bar, 96rpx) + 108rpx);
  width: 176rpx;
  height: calc(100vh - var(--qx-nav-bar, 96rpx) - 108rpx - 124rpx - var(--qx-safe-bottom-pad, env(safe-area-inset-bottom, 0px)));
  flex: 0 0 176rpx;
  padding: 12rpx 0;
  border-right: 1px solid #ece6db;
  background: #f4f0e8;
}

.category-rail__item {
  position: relative;
  display: flex;
  width: 100%;
  min-height: 88rpx;
  align-items: center;
  margin: 0;
  padding: 20rpx 16rpx 20rpx 28rpx;
  color: #6e665d;
  background: transparent;
  font-size: 24rpx;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  word-break: break-word;
}

.category-rail__item--pressed {
  color: #241f1a;
}

.category-rail__item--active {
  color: #241f1a;
  background: #fbf9f5;
  font-weight: 700;
  border-radius: 0 16rpx 16rpx 0;
  box-shadow: 0 4rpx 20rpx rgba(181, 138, 70, 0.05);
}

.category-rail__item--active::before {
  position: absolute;
  top: 20rpx;
  bottom: 20rpx;
  left: 0;
  width: 7rpx;
  border-radius: 0 8rpx 8rpx 0;
  background: #b58a46;
  content: '';
}

.category-rail__loading,
.filter-loading {
  display: block;
  color: var(--qx-store-muted, #9A9286);
  font-size: 19rpx;
  text-align: center;
}

.category-rail__loading {
  padding: 24rpx 10rpx;
}

.category-content {
  min-width: 0;
  flex: 1;
  background: #fbf9f5;
}

.category-toolbar {
  position: sticky;
  z-index: 8;
  top: calc(var(--qx-nav-bar, 96rpx) + 108rpx);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  padding: 16rpx 20rpx;
  border-bottom: 1px solid #f0ebe0;
  background: rgba(251, 249, 245, 0.94);
}

.category-toolbar__sorts {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 22rpx;
}

.category-toolbar__item {
  display: flex;
  min-width: 0;
  align-items: center;
  padding: 0;
  color: #7a7268;
  background: transparent;
  font-size: 22rpx;
  font-weight: 400;
  line-height: 1.3;
}

.category-toolbar__item--active {
  color: #a57c3a;
  font-weight: 700;
}

.category-toolbar__mark {
  margin-left: 4rpx;
  color: #b0a79b;
  font-size: 18rpx;
  line-height: 1;
}

.category-toolbar__item--active .category-toolbar__mark {
  color: #a57c3a;
}

.category-toolbar__filter {
  flex: 0 0 auto;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
  color: #554e45;
  background: #f1ece3;
  font-size: 20rpx;
  line-height: 1.3;
}

.category-toolbar__filter--open {
  color: #a57c3a;
  background: #f6efd9;
  font-weight: 600;
}

.category-brands {
  padding: 16rpx 20rpx 8rpx;
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
  min-height: 52rpx;
  flex: 0 0 auto;
  margin: 0;
  padding: 0 18rpx;
  border-radius: 28rpx;
  color: var(--qx-store-text-soft, #6B6458);
  background: #ffffff;
  font-size: 20rpx;
  line-height: 52rpx;
  white-space: nowrap;
}

.filter-chip--active {
  color: #8a6a24;
  background: #f6efd9;
  font-weight: 600;
}

.category-hero {
  display: flex;
  align-items: center;
  margin: 20rpx 20rpx 0;
  padding: 20rpx 22rpx;
  overflow: hidden;
  border-radius: 24rpx;
  color: #ffffff;
  background:
    radial-gradient(circle at 92% 120%, rgba(212, 175, 55, 0.18), transparent 46%),
    linear-gradient(135deg, #2d2721 0%, #433930 50%, #29221c 100%);
}

.category-hero__copy {
  min-width: 0;
}

.category-hero__chip {
  display: inline-flex;
  padding: 4rpx 12rpx;
  border: 1px solid rgba(200, 160, 100, 0.5);
  border-radius: 8rpx;
  color: #e8ceab;
  background: rgba(200, 160, 100, 0.3);
  font-size: 18rpx;
  font-weight: 500;
  line-height: 1.3;
}

.category-hero__title {
  display: block;
  margin-top: 8rpx;
  overflow: hidden;
  color: #ffffff;
  font-size: 24rpx;
  font-weight: 700;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-hero__desc {
  display: block;
  margin-top: 6rpx;
  overflow: hidden;
  color: #d0c5b6;
  font-size: 20rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.category-content :deep(.qx-catalog-state) {
  margin: 20rpx;
}

.product-grid {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 20rpx;
  padding: 20rpx 20rpx 8rpx;
}

.load-more {
  width: calc(100% - 40rpx);
  min-height: 76rpx;
  margin: 8rpx 20rpx 24rpx;
  border: 1px solid #e8e2d6;
  border-radius: 16rpx;
  color: #c4a35a;
  background: #ffffff;
  font-size: 22rpx;
  font-weight: 700;
}

.load-more[disabled] {
  color: #9a9286;
  background: #f3efe8;
}

.category-footnote {
  padding: 24rpx 20rpx 40rpx;
  text-align: center;
}

.category-footnote__en,
.category-footnote__zh {
  display: block;
  color: #b8afa3;
  font-size: 18rpx;
  line-height: 1.5;
  letter-spacing: 0.12em;
}

.category-footnote__zh {
  margin-top: 6rpx;
  color: #c4bdb1;
  letter-spacing: 0;
}

@media (min-width: 768px) {
  .category-header__title-row {
    padding-right: 20px;
    padding-left: 20px;
  }

  .category-header__search {
    padding-right: 20px;
    padding-left: 20px;
  }
}
</style>
