<script setup lang="ts">
/* global uni */
import { onReachBottom, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import {
  deleteFavorite,
  listFavorites,
  StoreApiError,
  type Favorite,
} from '../../api';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxPrice from '../../components/storefront/QxPrice.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import {
  clearCustomerSession,
  hasRefreshableCustomerSession,
} from '../../utils/customer-session';
import { openLoginForAction } from '../../utils/protected-action';
import { openProduct } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'auth-required' | 'error' | 'rate-limited';
type LoadFailure = 'error' | 'rate-limited';

const PAGE_SIZE = 20;

const state = ref<PageState>('loading');
const favorites = ref<Favorite[]>([]);
const keywordInput = ref('');
const committedKeyword = ref('');
const validationMessage = ref('');
const message = ref('');
const currentPage = ref(1);
const total = ref(0);
const retryAfterSeconds = ref(0);
const loadingMore = ref(false);
const loadMoreFailure = ref<LoadFailure | null>(null);
const loadMoreRetryAfter = ref(0);
const pendingProductIds = ref<ReadonlySet<string>>(new Set());

let requestGeneration = 0;
let redirectingToLogin = false;
let authenticationRequired = false;

const keywordLength = computed(() => Array.from(keywordInput.value.trim()).length);
const hasMore = computed(() => favorites.value.length < total.value);

function requireLogin(): void {
  if (redirectingToLogin) return;
  redirectingToLogin = true;
  authenticationRequired = true;
  requestGeneration += 1;
  state.value = 'auth-required';
  clearCustomerSession();
  openLoginForAction({ type: 'FAVORITES' });
}

function retryLogin(): void {
  redirectingToLogin = false;
  requireLogin();
}

function favoriteQuery(page: number): {
  keyword?: string;
  page: number;
  page_size: number;
} {
  return {
    ...(committedKeyword.value === '' ? {} : { keyword: committedKeyword.value }),
    page,
    page_size: PAGE_SIZE,
  };
}

function loadFailure(error: unknown): {
  state: LoadFailure;
  retryAfterSeconds: number;
} | null {
  if (error instanceof StoreApiError && error.status === 401) {
    requireLogin();
    return null;
  }
  if (error instanceof StoreApiError && error.status === 429) {
    return {
      state: 'rate-limited',
      retryAfterSeconds: error.retryAfterSeconds ?? 1,
    };
  }
  return { state: 'error', retryAfterSeconds: 0 };
}

async function loadFavoritePage(append = false): Promise<void> {
  if (append && (loadingMore.value || !hasMore.value || state.value !== 'ready')) return;

  const generation = ++requestGeneration;
  const requestedPage = append ? currentPage.value + 1 : 1;
  message.value = '';
  retryAfterSeconds.value = 0;

  if (append) {
    loadingMore.value = true;
    loadMoreFailure.value = null;
    loadMoreRetryAfter.value = 0;
  } else {
    state.value = 'loading';
    favorites.value = [];
    currentPage.value = 1;
    total.value = 0;
    loadingMore.value = false;
    loadMoreFailure.value = null;
    loadMoreRetryAfter.value = 0;
  }

  try {
    const result = await listFavorites(favoriteQuery(requestedPage));
    if (generation !== requestGeneration) return;
    favorites.value = append ? [...favorites.value, ...result.items] : result.items;
    currentPage.value = result.pagination.page;
    total.value = result.pagination.total;
    state.value = 'ready';
  } catch (error) {
    if (generation !== requestGeneration) return;
    const failure = loadFailure(error);
    if (failure === null) return;
    if (append && favorites.value.length > 0) {
      state.value = 'ready';
      loadMoreFailure.value = failure.state;
      loadMoreRetryAfter.value = failure.retryAfterSeconds;
    } else {
      state.value = failure.state;
      retryAfterSeconds.value = failure.retryAfterSeconds;
    }
  } finally {
    if (generation === requestGeneration) loadingMore.value = false;
  }
}

function submitSearch(): void {
  const trimmed = keywordInput.value.trim();
  const length = Array.from(trimmed).length;
  if (length > 200) {
    validationMessage.value = '请输入不超过 200 个字符的商品名称。';
    return;
  }
  validationMessage.value = '';
  committedKeyword.value = trimmed;
  void loadFavoritePage(false);
}

function clearSearch(): void {
  keywordInput.value = '';
  validationMessage.value = '';
  if (committedKeyword.value === '') return;
  committedKeyword.value = '';
  void loadFavoritePage(false);
}

function loadNextPage(): void {
  void loadFavoritePage(true);
}

function availabilityCopy(favorite: Favorite): string {
  if (favorite.product.availability === 'SALEABLE') return '可购买';
  if (favorite.product.availability === 'OUT_OF_STOCK') return '暂时售罄';
  return '商品已失效';
}

function openFavorite(favorite: Favorite): void {
  if (favorite.product.availability === 'UNAVAILABLE') {
    void uni.showToast({ icon: 'none', title: '商品当前不可用' });
    return;
  }
  openProduct(favorite.product.product_id);
}

function setProductPending(productId: string, pending: boolean): void {
  const next = new Set(pendingProductIds.value);
  if (pending) next.add(productId);
  else next.delete(productId);
  pendingProductIds.value = next;
}

async function removeFavorite(favorite: Favorite): Promise<void> {
  const productId = favorite.product.product_id;
  if (pendingProductIds.value.has(productId)) return;
  setProductPending(productId, true);
  message.value = '';
  try {
    await deleteFavorite(productId);
    await loadFavoritePage(false);
    void uni.showToast({ icon: 'success', title: '已取消收藏' });
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 409) {
      await loadFavoritePage(false);
      message.value = '收藏状态已变化，已刷新最新结果。';
    } else if (error instanceof StoreApiError && error.status === 429) {
      message.value = `操作较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后重试。`;
    } else {
      message.value = '取消收藏失败，请稍后重试。';
    }
  } finally {
    setProductPending(productId, false);
  }
}

onShow(() => {
  redirectingToLogin = false;
  if (authenticationRequired) {
    if (!hasRefreshableCustomerSession()) return;
    authenticationRequired = false;
  }
  void loadFavoritePage(false);
});

onReachBottom(loadNextPage);

onUnload(() => {
  requestGeneration += 1;
});
</script>

<template>
  <QxStoreShell>
    <view class="favorites-page">
      <QxAccountHeader title="商品收藏" />

      <view class="favorites-search">
        <view class="favorites-search__field">
          <text
            class="favorites-search__icon"
            aria-hidden="true"
          >
            ⌕
          </text>
          <input
            v-model="keywordInput"
            class="favorites-search__input"
            type="text"
            confirm-type="search"
            placeholder="搜索收藏的商品名称"
            @confirm="submitSearch"
          >
          <button
            v-if="keywordInput.length > 0"
            class="favorites-search__clear"
            aria-label="清空搜索词"
            @click="clearSearch"
          >
            ×
          </button>
        </view>
        <button
          class="favorites-search__submit"
          @click="submitSearch"
        >
          搜索
        </button>
      </view>

      <view
        v-if="validationMessage"
        class="favorites-validation"
        role="alert"
      >
        <text>{{ validationMessage }}</text>
        <text>{{ keywordLength }}/200</text>
      </view>

      <text
        v-if="message"
        class="favorites-message"
        role="status"
      >
        {{ message }}
      </text>

      <QxCatalogState
        v-if="state === 'loading'"
        class="favorites-state"
        kind="loading"
        title="正在读取收藏"
        description="正在同步商品的最新状态。"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        class="favorites-state"
        kind="empty"
        title="登录后查看收藏"
        description="你已取消登录，收藏页不会反复跳转。"
        action-label="去登录"
        @action="retryLogin"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        class="favorites-state"
        :kind="state"
        :retry-after-seconds="retryAfterSeconds"
        title="收藏加载失败"
        description="暂时无法读取收藏，请稍后重试。"
        action-label="重新加载"
        @action="loadFavoritePage(false)"
      />
      <QxCatalogState
        v-else-if="favorites.length === 0"
        class="favorites-state"
        kind="empty"
        :title="committedKeyword ? '没有匹配的收藏' : '还没有收藏商品'"
        :description="committedKeyword ? '换个商品名称再试试。' : '在商品详情收藏后，可以在这里快速找到。'"
      />

      <template v-else>
        <view class="favorites-summary">
          <text>{{ committedKeyword ? `“${committedKeyword}”` : '全部收藏' }}</text>
          <text>{{ total }} 件</text>
        </view>
        <view class="favorites-list">
          <article
            v-for="favorite in favorites"
            :key="favorite.favorite_id"
            class="favorite-item"
            :class="`favorite-item--${favorite.product.availability.toLowerCase()}`"
          >
            <button
              class="favorite-item__product"
              :aria-label="favorite.product.availability === 'UNAVAILABLE'
                ? `${favorite.product.name}，商品已失效`
                : `查看${favorite.product.name}`"
              :disabled="favorite.product.availability === 'UNAVAILABLE'"
              @click="openFavorite(favorite)"
            >
              <view class="favorite-item__image">
                <QxProductImage
                  :src="favorite.product.primary_image_url"
                  :alt="favorite.product.name"
                  shape="fill"
                />
              </view>
              <view class="favorite-item__body">
                <text class="favorite-item__name">
                  {{ favorite.product.name }}
                </text>
                <text
                  class="favorite-item__availability"
                  :class="{ 'favorite-item__availability--warning': !favorite.product.is_salable }"
                >
                  {{ availabilityCopy(favorite) }}
                </text>
                <QxPrice
                  :amount="favorite.product.minimum_active_price"
                  :is-salable="favorite.product.is_salable"
                  :sold-out-text="favorite.product.availability === 'UNAVAILABLE' ? '价格不可用' : '暂时售罄'"
                  size="small"
                />
              </view>
            </button>
            <button
              class="favorite-item__remove"
              :aria-label="`取消收藏${favorite.product.name}`"
              :disabled="pendingProductIds.has(favorite.product.product_id)"
              @click="removeFavorite(favorite)"
            >
              {{ pendingProductIds.has(favorite.product.product_id) ? '…' : '♡' }}
            </button>
          </article>
        </view>

        <QxCatalogState
          v-if="loadMoreFailure"
          :kind="loadMoreFailure"
          :retry-after-seconds="loadMoreRetryAfter"
          title="下一页加载失败"
          description="已加载的收藏仍可继续查看。"
          :compact="true"
          @action="loadNextPage"
        />
        <button
          v-else-if="hasMore"
          class="favorites-load-more"
          :disabled="loadingMore"
          @click="loadNextPage"
        >
          {{ loadingMore ? '加载中…' : '加载更多' }}
        </button>
        <text
          v-else
          class="favorites-end"
        >
          已展示全部收藏
        </text>
      </template>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.favorites-page {
  min-height: 100vh;
  background: var(--qx-store-background, #f4f7f5);
}

.favorites-search {
  position: sticky;
  z-index: 12;
  top: 0;
  display: grid;
  min-height: 104rpx;
  grid-template-columns: minmax(0, 1fr) 80rpx;
  align-items: center;
  gap: 12rpx;
  padding: 14rpx 24rpx;
  border-bottom: 1px solid var(--qx-store-line, #e4e8e5);
  background: rgba(255, 255, 255, 0.98);
}

.favorites-search__field {
  display: grid;
  min-width: 0;
  min-height: 72rpx;
  grid-template-columns: 42rpx minmax(0, 1fr) 48rpx;
  align-items: center;
  padding: 0 8rpx 0 16rpx;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 10rpx;
  background: var(--qx-store-surface, #ffffff);
}

.favorites-search__icon {
  color: var(--qx-store-muted, #8d9690);
  font-size: 25rpx;
}

.favorites-search__input {
  width: 100%;
  min-width: 0;
  height: 68rpx;
  color: var(--qx-store-text, #202522);
  font-size: 23rpx;
}

.favorites-search__clear,
.favorites-search__submit {
  margin: 0;
  color: var(--qx-store-brand, #496859);
  background: transparent;
}

.favorites-search__clear {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  align-items: center;
  justify-content: center;
  color: var(--qx-store-muted, #8d9690);
  font-size: 30rpx;
}

.favorites-search__submit {
  min-width: 0;
  min-height: 64rpx;
  font-size: 23rpx;
  font-weight: 750;
  white-space: nowrap;
}

.favorites-validation,
.favorites-message {
  display: flex;
  min-height: 62rpx;
  align-items: center;
  justify-content: space-between;
  gap: 14rpx;
  padding: 12rpx 24rpx;
  font-size: 20rpx;
  line-height: 1.45;
}

.favorites-validation {
  color: var(--qx-store-danger, #b84848);
  background: var(--qx-store-accent-soft, #f7e7e2);
}

.favorites-message {
  color: var(--qx-store-brand-strong, #315f50);
  background: var(--qx-store-surface-soft, #edf3ef);
}

.favorites-state {
  min-height: 620rpx;
}

.favorites-summary {
  display: flex;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 18rpx;
  padding: 24rpx 24rpx 14rpx;
  color: var(--qx-store-muted, #8d9690);
  font-size: 20rpx;
}

.favorites-summary text:first-child {
  min-width: 0;
  overflow: hidden;
  color: var(--qx-store-text-soft, #5f6762);
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.favorites-list {
  display: grid;
  gap: 14rpx;
  padding: 0 20rpx 24rpx;
}

.favorite-item {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) 72rpx;
  align-items: center;
  gap: 8rpx;
  padding: 16rpx;
  border: 1px solid var(--qx-store-line, #e4e8e5);
  border-radius: 12rpx;
  background: var(--qx-store-surface, #ffffff);
}

.favorite-item--unavailable {
  background: #f4f6f4;
}

.favorite-item__product {
  display: grid;
  min-width: 0;
  grid-template-columns: 156rpx minmax(0, 1fr);
  align-items: center;
  gap: 18rpx;
  margin: 0;
  color: var(--qx-store-text, #202522);
  background: transparent;
  text-align: left;
}

.favorite-item__product[disabled] {
  opacity: 0.72;
}

.favorite-item__image {
  width: 156rpx;
  height: 156rpx;
  overflow: hidden;
  border-radius: 10rpx;
}

.favorite-item__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  align-items: flex-start;
}

.favorite-item__name {
  display: -webkit-box;
  width: 100%;
  overflow: hidden;
  font-size: 24rpx;
  font-weight: 750;
  line-height: 1.45;
  overflow-wrap: anywhere;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.favorite-item__availability {
  display: block;
  margin: 10rpx 0 16rpx;
  color: var(--qx-store-brand, #496859);
  font-size: 19rpx;
}

.favorite-item__availability--warning {
  color: var(--qx-store-danger, #b84848);
}

.favorite-item__remove {
  display: flex;
  width: 64rpx;
  height: 64rpx;
  align-items: center;
  justify-content: center;
  margin: 0;
  border-radius: 50%;
  color: var(--qx-store-accent, #e27766);
  background: var(--qx-store-surface-soft, #edf3ef);
  font-size: 34rpx;
}

.favorite-item__remove[disabled] {
  color: var(--qx-store-muted, #8d9690);
  opacity: 0.62;
}

.favorites-load-more {
  display: block;
  width: calc(100% - 40rpx);
  min-height: 76rpx;
  margin: 0 20rpx 28rpx;
  border: 1px solid var(--qx-store-line-strong, #cfd6d1);
  border-radius: 10rpx;
  color: var(--qx-store-brand, #496859);
  background: var(--qx-store-surface, #ffffff);
  font-size: 22rpx;
  font-weight: 700;
}

.favorites-load-more[disabled] {
  color: var(--qx-store-muted, #8d9690);
}

.favorites-end {
  display: block;
  padding: 12rpx 24rpx calc(36rpx + env(safe-area-inset-bottom));
  color: var(--qx-store-muted, #8d9690);
  font-size: 19rpx;
  text-align: center;
}

@media (max-width: 359px) {
  .favorite-item {
    grid-template-columns: minmax(0, 1fr) 60rpx;
    padding: 12rpx;
  }

  .favorite-item__product {
    grid-template-columns: 132rpx minmax(0, 1fr);
    gap: 12rpx;
  }

  .favorite-item__image {
    width: 132rpx;
    height: 132rpx;
  }

  .favorite-item__remove {
    width: 56rpx;
    height: 56rpx;
  }
}
</style>
