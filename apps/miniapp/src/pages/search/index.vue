<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { onLoad, onReachBottom } from '@dcloudio/uni-app';

import {
  StoreApiError,
  listStoreBrands,
  listStoreCategories,
  listStoreProducts,
  type StoreCancelableRequest,
} from '../../api';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxProductCard from '../../components/storefront/QxProductCard.vue';
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
  clearSearchHistory,
  loadSearchHistory,
  normalizeSearchTerm,
  saveSearchTerm,
} from '../../utils/search-history';
import { goBackOrHome, openProduct } from '../../utils/store-navigation';

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

const keywordInput = ref('');
const committedKeyword = ref('');
const validationMessage = ref('');
const history = ref<string[]>([]);
const hasSearched = ref(false);
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

const keywordLength = computed(() => Array.from(keywordInput.value.trim()).length);
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
    keyword: committedKeyword.value,
    page,
    page_size: PAGE_SIZE,
    sort: selectedSort.value,
  };
  if (selectedCategoryId.value !== '') query.category_id = selectedCategoryId.value;
  if (selectedBrandId.value !== '') query.brand_id = selectedBrandId.value;
  return query;
}

function loadProducts(append = false): void {
  if (committedKeyword.value === '') return;
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
  if (!hasSearched.value) return;
  loadProducts(false);
}

function showHistory(): void {
  productsGeneration += 1;
  productsRequest?.abort();
  committedKeyword.value = '';
  hasSearched.value = false;
  products.value = [];
  total.value = 0;
  currentPage.value = 1;
  loadingMore.value = false;
  productsState.value = 'idle';
  productsRetryAfter.value = 0;
  loadMoreFailure.value = null;
  loadMoreRetryAfter.value = 0;
}

function executeSearch(term: string, resetFilters: boolean): void {
  if (resetFilters) {
    selectedCategoryId.value = '';
    selectedBrandId.value = '';
    selectedSort.value = 'COMPREHENSIVE';
  }
  keywordInput.value = term;
  committedKeyword.value = term;
  validationMessage.value = '';
  history.value = saveSearchTerm(history.value, term);
  hasSearched.value = true;
  loadProducts(false);
}

function submitSearch(): void {
  const trimmed = keywordInput.value.trim();
  if (trimmed === '') {
    validationMessage.value = '';
    showHistory();
    return;
  }

  const term = normalizeSearchTerm(trimmed);
  if (term === null) {
    validationMessage.value = '请输入 1–200 个字符的商品名称。';
    return;
  }

  executeSearch(term, term !== committedKeyword.value);
}

function searchHistoryTerm(term: string): void {
  executeSearch(term, true);
}

function clearInput(): void {
  keywordInput.value = '';
  validationMessage.value = '';
}

function removeHistory(): void {
  clearSearchHistory();
  history.value = [];
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

function goBack(): void {
  goBackOrHome();
}

watch(keywordInput, (value) => {
  validationMessage.value = '';
  if (value.trim() === '' && hasSearched.value) showHistory();
});

onLoad((query) => {
  history.value = loadSearchHistory();
  loadCategories();
  loadBrands();

  const routeKeyword = query?.keyword;
  if (typeof routeKeyword !== 'string') return;
  keywordInput.value = routeKeyword;
  const term = normalizeSearchTerm(routeKeyword);
  if (term !== null) {
    executeSearch(term, true);
  } else if (routeKeyword.trim() !== '') {
    validationMessage.value = '请输入 1–200 个字符的商品名称。';
  }
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
  <QxStoreShell surface="white">
    <view class="search-page">
      <view class="search-header">
        <button
          class="search-header__back"
          aria-label="返回"
          @click="goBack"
        >
          <text aria-hidden="true">
            ‹
          </text>
        </button>
        <view class="search-field">
          <text
            class="search-field__icon"
            aria-hidden="true"
          >
            ⌕
          </text>
          <input
            v-model="keywordInput"
            class="search-field__input"
            type="text"
            confirm-type="search"
            placeholder="搜索商品名称"
            :focus="false"
            @confirm="submitSearch"
          >
          <button
            v-if="keywordInput.length > 0"
            class="search-field__clear"
            aria-label="清空搜索词"
            @click="clearInput"
          >
            <text aria-hidden="true">
              ×
            </text>
          </button>
        </view>
        <button
          class="search-header__submit"
          @click="submitSearch"
        >
          搜索
        </button>
      </view>

      <view
        v-if="validationMessage"
        class="validation-message"
        role="alert"
      >
        <text>{{ validationMessage }}</text>
        <text>{{ keywordLength }}/200</text>
      </view>

      <view
        v-if="!hasSearched"
        class="history-view"
      >
        <view class="history-heading">
          <view>
            <text class="history-heading__eyebrow">
              RECENT
            </text>
            <text class="history-heading__title">
              最近搜索
            </text>
          </view>
          <button
            v-if="history.length > 0"
            class="history-heading__clear"
            @click="removeHistory"
          >
            清空
          </button>
        </view>
        <view
          v-if="history.length > 0"
          class="history-list"
        >
          <button
            v-for="term in history"
            :key="term"
            class="history-chip"
            @click="searchHistoryTerm(term)"
          >
            {{ term }}
          </button>
        </view>
        <QxCatalogState
          v-else
          kind="empty"
          title="暂无搜索记录"
          description="输入商品名称开始查找。"
          :compact="true"
        />
      </view>

      <view
        v-else
        class="results-view"
      >
        <view class="result-heading">
          <view class="result-heading__copy">
            <text class="result-heading__eyebrow">
              SEARCH RESULTS
            </text>
            <text class="result-heading__title">
              “{{ committedKeyword }}”
            </text>
          </view>
          <text class="result-heading__count">
            {{ resultCopy }}
          </text>
        </view>

        <view class="filter-panel">
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
              分类
            </text>
            <scroll-view
              v-if="categoriesState !== 'error' && categoriesState !== 'rate-limited'"
              class="filter-scroll"
              scroll-x
              :show-scrollbar="false"
            >
              <view class="filter-row">
                <button
                  class="filter-chip"
                  :class="{ 'filter-chip--active': selectedCategoryId === '' }"
                  @click="selectCategory('')"
                >
                  全部分类
                </button>
                <button
                  v-for="category in categories"
                  :key="category.category_id"
                  class="filter-chip"
                  :class="{
                    'filter-chip--active': selectedCategoryId === category.category_id,
                  }"
                  @click="selectCategory(category.category_id)"
                >
                  {{ category.name }}
                </button>
                <text
                  v-if="categoriesState === 'loading'"
                  class="filter-loading"
                >
                  分类加载中
                </text>
              </view>
            </scroll-view>
            <QxCatalogState
              v-else
              :kind="categoriesState"
              title="分类筛选暂不可用"
              description="仍可按商品名称查看搜索结果。"
              :retry-after-seconds="categoriesRetryAfter"
              :compact="true"
              @action="loadCategories"
            />
          </view>

          <view class="filter-group filter-group--last">
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
              description="仍可按商品名称查看搜索结果。"
              :retry-after-seconds="brandsRetryAfter"
              :compact="true"
              @action="loadBrands"
            />
          </view>
        </view>

        <QxCatalogState
          v-if="productsState === 'loading'"
          kind="loading"
          title="正在搜索商品"
        />
        <QxCatalogState
          v-else-if="productsState === 'error' || productsState === 'rate-limited'"
          :kind="productsState"
          :retry-after-seconds="productsRetryAfter"
          @action="loadProducts(false)"
        />
        <QxCatalogState
          v-else-if="productsState === 'ready' && products.length === 0"
          kind="empty"
          title="没有找到相关商品"
          description="试试更换商品名称或筛选条件。"
        />
        <template v-else-if="productsState === 'ready'">
          <view class="product-list">
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
            description="已加载的搜索结果仍可继续浏览。"
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
            已展示全部搜索结果
          </text>
        </template>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.search-page {
  min-height: 100vh;
  background: var(--qx-store-surface, #ffffff);
}

.search-header {
  position: sticky;
  z-index: 14;
  top: 0;
  display: grid;
  min-height: 120rpx;
  grid-template-columns: 64rpx minmax(0, 1fr) 82rpx;
  align-items: center;
  gap: 12rpx;
  padding: calc(18rpx + env(safe-area-inset-top)) 24rpx 18rpx;
  border-bottom: 1px solid var(--qx-store-line, #e4e8e5);
  background: rgba(255, 255, 255, 0.98);
}

.search-header__back,
.search-field__clear {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--qx-store-text-soft, #5f6762);
  background: transparent;
}

.search-header__back {
  width: 64rpx;
  height: 64rpx;
  font-size: 54rpx;
  line-height: 1;
}

.search-field {
  display: grid;
  min-width: 0;
  min-height: 76rpx;
  grid-template-columns: 44rpx minmax(0, 1fr) 52rpx;
  align-items: center;
  padding: 0 10rpx 0 18rpx;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 12rpx;
  background: var(--qx-store-background, #f6f8f6);
}

.search-field__icon {
  color: var(--qx-store-muted, #8d9690);
  font-size: 28rpx;
}

.search-field__input {
  width: 100%;
  min-width: 0;
  height: 72rpx;
  color: var(--qx-store-text, #202522);
  font-size: 25rpx;
}

.search-field__clear {
  width: 52rpx;
  height: 52rpx;
  font-size: 34rpx;
}

.search-header__submit {
  min-width: 0;
  min-height: 64rpx;
  margin: 0;
  color: var(--qx-store-brand, #496859);
  background: transparent;
  font-size: 24rpx;
  font-weight: 800;
  white-space: nowrap;
}

.validation-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 18rpx 28rpx;
  color: var(--qx-store-danger, #b84848);
  background: var(--qx-store-accent-soft, #f7e7e2);
  font-size: 21rpx;
  line-height: 1.4;
}

.history-view,
.results-view {
  padding: 36rpx 28rpx 56rpx;
}

.history-heading,
.result-heading {
  display: flex;
  min-width: 0;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24rpx;
}

.history-heading {
  margin-bottom: 28rpx;
}

.history-heading__eyebrow,
.history-heading__title,
.result-heading__eyebrow,
.result-heading__title,
.result-heading__count {
  display: block;
}

.history-heading__eyebrow,
.result-heading__eyebrow {
  color: var(--qx-store-brand, #496859);
  font-size: 18rpx;
  font-weight: 800;
}

.history-heading__title,
.result-heading__title {
  margin-top: 8rpx;
  color: var(--qx-store-text, #202522);
  font-size: 32rpx;
  font-weight: 800;
  line-height: 1.3;
}

.history-heading__clear {
  min-height: 60rpx;
  margin: 0;
  padding: 0 10rpx;
  color: var(--qx-store-muted, #8d9690);
  background: transparent;
  font-size: 22rpx;
}

.history-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16rpx;
}

.history-chip {
  max-width: 100%;
  min-height: 64rpx;
  overflow: hidden;
  margin: 0;
  padding: 0 22rpx;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 10rpx;
  color: var(--qx-store-text-soft, #5f6762);
  background: var(--qx-store-background, #f6f8f6);
  font-size: 22rpx;
  line-height: 64rpx;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-heading {
  margin-bottom: 28rpx;
}

.result-heading__copy {
  min-width: 0;
}

.result-heading__title {
  max-width: 540rpx;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-heading__count {
  flex: 0 0 auto;
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
}

.filter-panel {
  margin: 0 -28rpx 28rpx;
  padding: 24rpx 28rpx 4rpx;
  border-top: 1px solid var(--qx-store-line, #e4e8e5);
  border-bottom: 1px solid var(--qx-store-line, #e4e8e5);
  background: var(--qx-store-background, #f6f8f6);
}

.filter-group {
  min-width: 0;
  margin-bottom: 22rpx;
}

.filter-group--last {
  margin-bottom: 20rpx;
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

.filter-loading {
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
}

.product-list {
  margin: 0 -28rpx;
}

.load-more {
  width: 100%;
  min-height: 76rpx;
  margin-top: 28rpx;
  border: 1px solid var(--qx-store-line-strong, #cfd6d1);
  border-radius: 10rpx;
  color: var(--qx-store-brand, #496859);
  background: var(--qx-store-surface, #ffffff);
  font-size: 22rpx;
  font-weight: 700;
}

.load-more[disabled] {
  color: var(--qx-store-muted, #8d9690);
  background: var(--qx-store-background, #f6f8f6);
}

.list-end {
  display: block;
  padding: 36rpx 0 8rpx;
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
  text-align: center;
}

@media (min-width: 768px) {
  .history-view,
  .results-view {
    padding-right: 20px;
    padding-left: 20px;
  }

  .filter-panel,
  .product-list {
    margin-right: -20px;
    margin-left: -20px;
  }

  .filter-panel {
    padding-right: 20px;
    padding-left: 20px;
  }
}
</style>
