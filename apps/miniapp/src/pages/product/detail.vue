<script setup lang="ts">
/* global uni */
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import {
  createIdempotencyKey,
  deleteFavorite,
  getFavoriteState,
  getStoreProduct,
  mergeStoreCart,
  putFavorite,
} from '../../api';
import { StoreApiError, type StoreCancelableRequest } from '../../api/store-client';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxIcon from '../../components/storefront/QxIcon.vue';
import QxPrice from '../../components/storefront/QxPrice.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxStepper from '../../components/storefront/QxStepper.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import QxTag from '../../components/storefront/QxTag.vue';
import type { StoreProductDetail, StoreSku } from '../../types/store-catalog';
import {
  addOrMergeGuestCartItem,
  loadGuestCart,
  saveGuestCart,
  setGuestCartQuantity,
} from '../../utils/guest-cart';
import { guestCartSnapshot } from '../../utils/guest-cart-refresh';
import { hasRefreshableCustomerSession } from '../../utils/customer-session';
import { isUlid } from '../../utils/ids';
import { goBackOrHome, openCheckout, openHome, showLoginPrompt } from '../../utils/store-navigation';

type DetailState = 'loading' | 'ready' | 'not-found' | 'error' | 'rate-limited';
type DetailTab = 'introduction' | 'ingredients' | 'usage_method';

const state = ref<DetailState>('loading');
const product = ref<StoreProductDetail | null>(null);
const productId = ref('');
const selectedSkuId = ref('');
const quantity = ref(1);
const sheetOpen = ref(false);
const sheetPurpose = ref<'select' | 'cart'>('select');
const currentImage = ref(0);
const activeTab = ref<DetailTab>('introduction');
const retryAfterSeconds = ref(0);
const slowRequest = ref(false);
const favoriteState = ref<boolean | null>(null);
const favoriteStateLoading = ref(false);
const favoriteStateError = ref(false);
const favoritePending = ref(false);
const cartPending = ref(false);

let currentRequest: StoreCancelableRequest<StoreProductDetail> | undefined;
let requestGeneration = 0;
let favoriteStateGeneration = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let customerCartAuthoritative = hasRefreshableCustomerSession();
let pendingCartAdd: {
  fingerprint: string;
  idempotencyKey: string;
} | null = null;

const selectedSku = computed(() => product.value?.skus.find(
  (sku) => sku.sku_id === selectedSkuId.value,
) ?? null);
const allSoldOut = computed(() => product.value?.skus.every((sku) => !sku.is_salable) ?? true);
const currentSkuSalable = computed(() => selectedSku.value?.is_salable ?? false);
const quantityMaximum = computed(() => selectedSku.value?.is_salable
  ? Math.min(99, selectedSku.value.available_stock)
  : 0);
const pageErrorKind = computed(() => state.value === 'rate-limited' ? 'rate-limited' : 'error');
const currentTabText = computed(() => product.value?.[activeTab.value] ?? null);
const loadingDescription = computed(() => slowRequest.value
  ? '网络响应较慢，正在继续加载。'
  : '正在读取商品与库存信息。');

const detailTabs: ReadonlyArray<{ key: DetailTab; label: string }> = [
  { key: 'introduction', label: '商品介绍' },
  { key: 'ingredients', label: '成分说明' },
  { key: 'usage_method', label: '使用方法' },
];

function clearSlowTimer() {
  if (slowTimer !== undefined) {
    clearTimeout(slowTimer);
    slowTimer = undefined;
  }
}

function initialSku(skus: readonly StoreSku[]): StoreSku | undefined {
  return skus.find((sku) => sku.is_recommended && sku.is_salable)
    ?? skus.find((sku) => sku.is_salable)
    ?? skus.find((sku) => sku.is_recommended)
    ?? skus[0];
}

function selectSku(sku: StoreSku) {
  if (cartPending.value) return;
  selectedSkuId.value = sku.sku_id;
  quantity.value = sku.is_salable ? 1 : 0;
  pendingCartAdd = null;
}

function skuDescription(sku: StoreSku): string {
  const attributes = sku.spec_json?.attributes ?? [];
  return attributes.length > 0
    ? attributes.map((attribute) => `${attribute.name}：${attribute.value}`).join(' · ')
    : sku.name;
}

async function loadProduct() {
  if (!isUlid(productId.value)) {
    state.value = 'not-found';
    return;
  }
  const generation = ++requestGeneration;
  currentRequest?.abort();
  clearSlowTimer();
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  slowRequest.value = false;
  slowTimer = setTimeout(() => {
    if (generation === requestGeneration && state.value === 'loading') slowRequest.value = true;
  }, 800);

  const request = getStoreProduct(productId.value);
  currentRequest = request;
  try {
    const result = await request.promise;
    if (generation !== requestGeneration) return;
    product.value = result;
    const sku = initialSku(result.skus);
    selectedSkuId.value = sku?.sku_id ?? '';
    quantity.value = sku?.is_salable ? 1 : 0;
    state.value = 'ready';
    void loadFavoriteState();
  } catch (error) {
    if (generation !== requestGeneration || (error instanceof StoreApiError && error.aborted)) return;
    product.value = null;
    if (error instanceof StoreApiError && error.status === 404) {
      state.value = 'not-found';
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      state.value = 'rate-limited';
    } else {
      state.value = 'error';
    }
  } finally {
    if (generation === requestGeneration) {
      currentRequest = undefined;
      clearSlowTimer();
    }
  }
}

async function loadFavoriteState() {
  const generation = ++favoriteStateGeneration;
  if (!isUlid(productId.value) || !hasRefreshableCustomerSession()) {
    favoriteState.value = null;
    favoriteStateLoading.value = false;
    favoriteStateError.value = false;
    return;
  }
  favoriteStateLoading.value = true;
  favoriteStateError.value = false;
  try {
    const result = await getFavoriteState(productId.value);
    if (generation !== favoriteStateGeneration) return;
    favoriteState.value = result.is_favorite;
  } catch (error) {
    if (generation !== favoriteStateGeneration) return;
    favoriteState.value = null;
    favoriteStateError.value = !(error instanceof StoreApiError && error.status === 401);
  } finally {
    if (generation === favoriteStateGeneration) favoriteStateLoading.value = false;
  }
}

function changeQuantity(delta: number) {
  if (cartPending.value) return;
  const maximum = quantityMaximum.value;
  if (maximum === 0) return;
  quantity.value = Math.min(maximum, Math.max(1, quantity.value + delta));
  pendingCartAdd = null;
}

function setSheetQuantity(value: number) {
  changeQuantity(value - quantity.value);
}

function openSkuSheet(purpose: 'select' | 'cart') {
  if (!product.value || product.value.skus.length === 0) return;
  sheetPurpose.value = purpose;
  sheetOpen.value = true;
}

async function confirmSkuSelection() {
  const currentProduct = product.value;
  const currentSku = selectedSku.value;
  if (!currentProduct || !currentSku?.is_salable || quantity.value < 1 || cartPending.value) return;
  if (sheetPurpose.value === 'cart') {
    const authenticated = hasRefreshableCustomerSession();
    if (authenticated) customerCartAuthoritative = true;
    if (customerCartAuthoritative && !authenticated) {
      showLoginPrompt({
        type: 'CART_ADD',
        product_id: productId.value,
        sku_id: currentSku.sku_id,
        quantity: quantity.value,
      });
      return;
    }
    cartPending.value = true;
    try {
      if (customerCartAuthoritative) {
        const input = {
          items: [{ sku_id: currentSku.sku_id, quantity: quantity.value, selected: true }],
        };
        const fingerprint = JSON.stringify(input);
        if (pendingCartAdd?.fingerprint !== fingerprint) {
          pendingCartAdd = { fingerprint, idempotencyKey: createIdempotencyKey() };
        }
        await mergeStoreCart(input, pendingCartAdd.idempotencyKey);
        pendingCartAdd = null;
      } else {
        const merged = addOrMergeGuestCartItem(
          loadGuestCart(),
          guestCartSnapshot(currentProduct, currentSku),
          quantity.value,
        );
        const mergedItem = merged.items.find((item) => item.snapshot.sku_id === currentSku.sku_id);
        const maximum = Math.min(99, currentSku.available_stock);
        const capped = mergedItem === undefined || mergedItem.quantity <= maximum
          ? merged
          : setGuestCartQuantity(merged, currentSku.sku_id, maximum);
        saveGuestCart(capped);
      }
      void uni.showToast({ icon: 'success', title: '已加入购物车' });
    } catch (error) {
      if (error instanceof StoreApiError &&
        (error.status === 409 || error.code === 'CART_ITEM_LIMIT_EXCEEDED')) {
        pendingCartAdd = null;
      }
      if (error instanceof StoreApiError && error.status === 401) {
        customerCartAuthoritative = true;
        showLoginPrompt({
          type: 'CART_ADD',
          product_id: productId.value,
          sku_id: currentSku.sku_id,
          quantity: quantity.value,
        });
      }
      const title = error instanceof StoreApiError && error.status === 401
        ? '登录已失效，请重新登录'
        : error instanceof StoreApiError && error.code === 'CART_ITEM_LIMIT_EXCEEDED'
          ? '购物车商品种类已达上限'
          : customerCartAuthoritative
            ? '服务端购物车暂不可用，请重试'
            : '本地存储不可用，加购失败';
      void uni.showToast({ icon: 'none', title });
      return;
    } finally {
      cartPending.value = false;
    }
  }
  sheetOpen.value = false;
}

function buyNow() {
  const sku = selectedSku.value;
  if (allSoldOut.value || !sku?.is_salable || quantity.value < 1) return;
  const action = {
    type: 'BUY_NOW' as const,
    product_id: productId.value,
    sku_id: sku.sku_id,
    quantity: quantity.value,
  };
  if (!hasRefreshableCustomerSession()) {
    showLoginPrompt(action);
    return;
  }
  openCheckout({
    source: 'BUY_NOW',
    product_id: action.product_id,
    sku_id: action.sku_id,
    quantity: action.quantity,
  });
}

async function favoriteProduct() {
  if (state.value !== 'ready' || product.value === null || favoritePending.value ||
    favoriteStateLoading.value) return;
  if (!hasRefreshableCustomerSession()) {
    showLoginPrompt({ type: 'FAVORITE', product_id: productId.value });
    return;
  }
  if (favoriteStateError.value) {
    await loadFavoriteState();
    if (favoriteStateError.value) {
      void uni.showToast({ icon: 'none', title: '收藏状态加载失败，请重试' });
    }
    return;
  }
  favoriteStateGeneration += 1;
  favoriteStateLoading.value = false;
  favoritePending.value = true;
  const nextFavorite = favoriteState.value !== true;
  try {
    const result = nextFavorite
      ? await putFavorite(productId.value, createIdempotencyKey())
      : await deleteFavorite(productId.value, createIdempotencyKey());
    favoriteState.value = result.is_favorite;
    favoriteStateError.value = false;
    void uni.showToast({ icon: 'none', title: result.is_favorite ? '已收藏' : '已取消收藏' });
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 409) {
      await loadFavoriteState();
      void uni.showToast({ icon: 'none', title: '收藏状态已变化，请再次操作' });
    } else if (error instanceof StoreApiError && error.status === 401) {
      favoriteState.value = null;
      showLoginPrompt({ type: 'FAVORITE', product_id: productId.value });
    } else {
      void uni.showToast({ icon: 'none', title: '收藏操作失败，请重试' });
    }
  } finally {
    favoritePending.value = false;
  }
}

function goBack() {
  goBackOrHome();
}

function returnHome() {
  openHome();
}

onLoad((query) => {
  productId.value = typeof query?.product_id === 'string' ? query.product_id : '';
  void loadProduct();
});

onShow(() => {
  if (hasRefreshableCustomerSession()) customerCartAuthoritative = true;
  if (state.value === 'ready' && !favoritePending.value) void loadFavoriteState();
});

onUnload(() => {
  requestGeneration += 1;
  favoriteStateGeneration += 1;
  currentRequest?.abort();
  clearSlowTimer();
});
</script>

<template>
  <QxStoreShell surface="white">
    <view class="detail-page">
      <header class="detail-header">
        <button
          class="detail-header__button"
          aria-label="返回"
          @click="goBack"
        >
          <QxIcon
            name="back"
            :size="40"
          />
        </button>
        <text class="detail-header__title">
          商品详情
        </text>
        <button
          class="detail-header__button"
          :aria-label="favoriteStateError ? '重新加载收藏状态' : '收藏'"
          :aria-pressed="favoriteState === true"
          :disabled="state !== 'ready' || product === null || favoritePending || favoriteStateLoading"
          @click="favoriteProduct"
        >
          <QxIcon
            :name="favoriteStateError ? 'reload' : favoriteState === true ? 'heart-fill' : 'heart'"
            :size="40"
          />
        </button>
      </header>

      <QxCatalogState
        v-if="state === 'loading'"
        class="detail-page__state"
        kind="loading"
        :description="loadingDescription"
      />
      <QxCatalogState
        v-else-if="state === 'not-found'"
        class="detail-page__state"
        kind="empty"
        title="商品不存在"
        description="商品可能已下架，返回首页看看其他商品。"
        action-label="返回首页"
        @action="returnHome"
      />
      <QxCatalogState
        v-else-if="state !== 'ready'"
        class="detail-page__state"
        :kind="pageErrorKind"
        :title="state === 'rate-limited' ? '浏览得有些快' : '商品加载失败'"
        description="暂时无法读取商品详情，请稍后重试。"
        action-label="重新加载"
        :retry-after-seconds="retryAfterSeconds"
        @action="loadProduct"
      />

      <template v-else-if="product">
        <section
          class="detail-gallery"
          aria-label="商品图集"
        >
          <swiper
            v-if="product.images.length > 0"
            class="detail-gallery__swiper"
            :current="currentImage"
            indicator-active-color="#496859"
            indicator-color="#cfd6d1"
            indicator-dots
            @change="currentImage = $event.detail.current"
          >
            <swiper-item
              v-for="image in product.images"
              :key="`${image.sort_order}-${image.url}`"
            >
              <QxProductImage
                :src="image.url"
                :alt="product.name"
                shape="hero"
                :lazy="false"
              />
            </swiper-item>
          </swiper>
          <QxProductImage
            v-else
            :src="null"
            :alt="product.name"
            shape="hero"
          />
        </section>

        <section class="detail-summary">
          <view class="detail-summary__labels">
            <QxTag
              v-if="product.is_hot"
              tone="hot"
            >
              热销
            </QxTag>
            <QxTag
              v-if="product.is_new"
              tone="new"
            >
              新品
            </QxTag>
            <text class="detail-summary__brand">
              {{ product.brand.name }}
            </text>
          </view>
          <text class="detail-summary__name">
            {{ product.name }}
          </text>
          <text
            v-if="product.subtitle"
            class="detail-summary__subtitle"
          >
            {{ product.subtitle }}
          </text>
          <view class="detail-summary__meta">
            <QxPrice
              :amount="selectedSku?.retail_price ?? null"
              :is-salable="selectedSku?.is_salable ?? false"
              size="large"
            />
            <text class="detail-summary__sales">
              已售 {{ product.net_sales_count }}
            </text>
          </view>
        </section>

        <section class="detail-choice">
          <button
            class="detail-choice__row"
            @click="openSkuSheet('select')"
          >
            <text class="detail-choice__label">
              规格
            </text>
            <view class="detail-choice__value">
              <text>{{ selectedSku ? skuDescription(selectedSku) : '暂无可选规格' }}</text>
              <QxIcon
                name="chevron"
                :size="28"
              />
            </view>
          </button>
          <view class="detail-choice__row">
            <text class="detail-choice__label">
              库存
            </text>
            <text class="detail-choice__stock">
              {{ selectedSku?.is_salable ? `剩余 ${selectedSku.available_stock} 件` : '当前规格已售罄' }}
            </text>
          </view>
        </section>

        <section class="detail-copy">
          <view
            class="detail-tabs"
            role="tablist"
            aria-label="商品说明"
          >
            <button
              v-for="tab in detailTabs"
              :key="tab.key"
              class="detail-tab"
              :class="{ 'detail-tab--active': activeTab === tab.key }"
              role="tab"
              :aria-selected="activeTab === tab.key"
              @click="activeTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </view>
          <text class="detail-copy__text">
            {{ currentTabText || '暂无相关内容。' }}
          </text>
        </section>

        <view class="detail-actions">
          <button
            class="detail-actions__favorite"
            :aria-label="favoriteStateError ? '重新加载收藏状态' : favoriteState === true ? '取消收藏' : '收藏商品'"
            :aria-pressed="favoriteState === true"
            :disabled="favoritePending || favoriteStateLoading"
            @click="favoriteProduct"
          >
            <QxIcon
              :name="favoriteStateError ? 'reload' : favoriteState === true ? 'heart-fill' : 'heart'"
              :size="40"
            />
          </button>
          <button
            class="detail-actions__secondary"
            :disabled="allSoldOut || cartPending"
            @click="openSkuSheet('cart')"
          >
            {{ allSoldOut ? '暂时售罄' : '加入购物车' }}
          </button>
          <button
            class="detail-actions__primary"
            :disabled="!currentSkuSalable"
            @click="buyNow"
          >
            {{ allSoldOut ? '暂时售罄' : currentSkuSalable ? '立即购买' : '当前规格售罄' }}
          </button>
        </view>
      </template>

      <view
        v-if="sheetOpen && product"
        class="sku-sheet"
        role="dialog"
        aria-modal="true"
      >
        <button
          class="sku-sheet__mask"
          aria-label="关闭规格选择"
          :disabled="cartPending"
          @click="sheetOpen = false"
        />
        <view class="sku-sheet__panel">
          <view
            class="sku-sheet__handle"
            aria-hidden="true"
          />
          <view class="sku-sheet__heading">
            <view class="sku-sheet__product">
              <text class="sku-sheet__title">
                选择规格
              </text>
              <QxPrice
                :amount="selectedSku?.retail_price ?? null"
                :is-salable="selectedSku?.is_salable ?? false"
              />
            </view>
            <button
              class="sku-sheet__close"
              aria-label="关闭"
              :disabled="cartPending"
              @click="sheetOpen = false"
            >
              <QxIcon
                name="close"
                :size="32"
              />
            </button>
          </view>

          <scroll-view
            class="sku-sheet__body"
            scroll-y
          >
            <text class="sku-sheet__section-title">
              全部规格
            </text>
            <view class="sku-options">
              <button
                v-for="sku in product.skus"
                :key="sku.sku_id"
                class="sku-option"
                :class="{
                  'sku-option--active': selectedSkuId === sku.sku_id,
                  'sku-option--sold-out': !sku.is_salable,
                }"
                :aria-pressed="selectedSkuId === sku.sku_id"
                :disabled="cartPending"
                @click="selectSku(sku)"
              >
                <view class="sku-option__copy">
                  <text class="sku-option__name">
                    {{ skuDescription(sku) }}
                  </text>
                  <text class="sku-option__code">
                    {{ sku.code }}
                  </text>
                </view>
                <view class="sku-option__meta">
                  <text>¥{{ sku.retail_price }}</text>
                  <text>{{ sku.is_salable ? `库存 ${sku.available_stock}` : '售罄' }}</text>
                </view>
              </button>
            </view>

            <view class="sku-quantity">
              <view>
                <text class="sku-sheet__section-title">
                  购买数量
                </text>
                <text class="sku-quantity__hint">
                  {{ quantityMaximum > 0 ? `最多可选 ${quantityMaximum} 件` : '当前规格不可购买' }}
                </text>
              </view>
              <QxStepper
                :value="quantity"
                :min="1"
                :max="Math.max(1, quantityMaximum)"
                :disabled="cartPending || quantityMaximum === 0"
                @change="setSheetQuantity"
              />
            </view>
          </scroll-view>

          <button
            class="sku-sheet__confirm"
            :disabled="!selectedSku?.is_salable || quantity < 1 || cartPending"
            @click="confirmSkuSelection"
          >
            {{ cartPending ? '正在加入…' : selectedSku?.is_salable ? (sheetPurpose === 'cart' ? '加入购物车' : '确认规格') : '该规格已售罄' }}
          </button>
        </view>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.detail-page {
  min-height: 100vh; padding-bottom: calc(124rpx + env(safe-area-inset-bottom));
  background: var(--qx-store-background);
}
.detail-header {
  position: sticky; z-index: 20; top: 0; display: grid;
  min-height: calc(92rpx + env(safe-area-inset-top));
  grid-template-columns: 88rpx minmax(0, 1fr) 88rpx; align-items: end;
  padding-top: env(safe-area-inset-top);
  background: rgba(255, 255, 255, 0.97);
}
.detail-header__button, .detail-header__title {
  display: flex; min-height: 88rpx; align-items: center; justify-content: center;
}
.detail-header__button { color: var(--qx-store-text); background: transparent; font-size: 46rpx; }
.detail-header__title {
  overflow: hidden; font-size: 28rpx; font-weight: 600; text-overflow: ellipsis; white-space: nowrap;
}
.detail-page__state { min-height: 650rpx; }
.detail-gallery { background: var(--qx-store-surface); }
.detail-gallery__swiper { width: 100%; height: 790rpx; }
.detail-summary, .detail-choice, .detail-copy {
  background: var(--qx-store-surface);
}
.detail-summary { padding: 30rpx 28rpx 34rpx; }
.detail-summary__labels { display: flex; min-width: 0; align-items: center; gap: 10rpx; }
.detail-summary__brand {
  min-width: 0; overflow: hidden; color: var(--qx-store-brand); font-size: 20rpx;
  font-weight: 700; text-overflow: ellipsis; white-space: nowrap;
}
.detail-summary__name, .detail-summary__subtitle { display: block; width: 100%; }
.detail-summary__name { margin-top: 18rpx; font-size: 38rpx; font-weight: 600; line-height: 1.35; }
.detail-summary__subtitle {
  margin-top: 12rpx; color: var(--qx-store-text-soft); font-size: 23rpx; line-height: 1.55;
}
.detail-summary__meta {
  display: flex; min-width: 0; align-items: flex-end; justify-content: space-between;
  gap: 16rpx; margin-top: 26rpx;
}
.detail-summary__sales { flex: 0 0 auto; color: var(--qx-store-muted); font-size: 20rpx; }
.detail-choice, .detail-copy { margin-top: 12rpx; }
.detail-choice__row {
  display: flex; width: 100%; min-height: 92rpx; align-items: center; gap: 24rpx;
  padding: 0 28rpx; color: var(--qx-store-text);
  background: transparent; text-align: left;
  box-shadow: 0 1rpx 0 var(--qx-store-line);
}
.detail-choice__label {
  width: 70rpx; flex: 0 0 auto; color: var(--qx-store-muted); font-size: 22rpx;
}
.detail-choice__value {
  display: flex; min-width: 0; flex: 1; align-items: center; justify-content: space-between;
  gap: 16rpx; font-size: 23rpx;
}
.detail-choice__value text:first-child {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.detail-choice__stock { color: var(--qx-store-text-soft); font-size: 23rpx; }
.detail-tabs {
  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
}
.detail-tab {
  min-height: 84rpx; color: var(--qx-store-muted); background: transparent; font-size: 22rpx;
}
.detail-tab--active {
  border-bottom: 4rpx solid var(--qx-store-brand); color: var(--qx-store-brand-strong); font-weight: 700;
}
.detail-copy__text {
  display: block; min-height: 240rpx; padding: 30rpx 28rpx 50rpx;
  color: var(--qx-store-text-soft); font-size: 24rpx; line-height: 1.8; white-space: pre-wrap;
}
.detail-actions {
  position: fixed; z-index: 25; right: 0; bottom: 0; left: 0; display: grid;
  width: 100%; max-width: 414px; min-height: calc(110rpx + env(safe-area-inset-bottom));
  grid-template-columns: 82rpx minmax(0, 1fr) minmax(0, 1fr); gap: 12rpx;
  margin: 0 auto; padding: 12rpx 20rpx calc(12rpx + env(safe-area-inset-bottom));
  box-shadow: 0 -2rpx 0 var(--qx-store-line); background: rgba(255, 255, 255, 0.98);
}
.detail-actions button {
  min-width: 0; min-height: 76rpx; border-radius: var(--qx-store-radius, 16rpx); font-size: 23rpx; font-weight: 600;
}
.detail-actions__favorite {
  display: flex; align-items: center; justify-content: center;
  color: var(--qx-store-brand); background: var(--qx-store-brand-soft);
}
.detail-actions__secondary {
  border: 1px solid var(--qx-store-brand) !important; color: var(--qx-store-brand); background: #ffffff;
}
.detail-actions__primary, .sku-sheet__confirm { color: #ffffff; background: var(--qx-store-brand); }
.detail-actions button[disabled], .sku-sheet__confirm[disabled] {
  color: #ffffff; background: var(--qx-store-muted); opacity: 0.62;
}
.sku-sheet {
  position: fixed; z-index: 60; inset: 0; width: 100%; max-width: 414px; height: 100vh; margin: 0 auto;
}
.sku-sheet__mask {
  position: absolute; inset: 0; width: 100%; height: 100%; background: rgba(13, 22, 18, 0.55);
}
.sku-sheet__panel {
  position: absolute; right: 0; bottom: 0; left: 0; display: flex; width: 100%; max-height: 82vh;
  flex-direction: column; overflow: hidden; border-radius: 16rpx 16rpx 0 0; background: #ffffff;
}
.sku-sheet__handle {
  width: 64rpx; height: 8rpx; flex: 0 0 auto; margin: 14rpx auto 4rpx;
  border-radius: 4rpx; background: var(--qx-store-line-strong);
}
.sku-sheet__heading {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 18rpx;
  padding: 20rpx 26rpx 22rpx; border-bottom: 1px solid var(--qx-store-line);
}
.sku-sheet__product { min-width: 0; }
.sku-sheet__title, .sku-sheet__section-title, .sku-quantity__hint { display: block; }
.sku-sheet__title { margin-bottom: 12rpx; font-size: 30rpx; font-weight: 600; }
.sku-sheet__close {
  display: flex; width: 64rpx; height: 64rpx; flex: 0 0 auto; align-items: center;
  justify-content: center; color: var(--qx-store-text-soft); background: var(--qx-store-surface-soft); font-size: 38rpx;
}
.sku-sheet__body { min-height: 0; flex: 1; padding: 26rpx; }
.sku-sheet__section-title { font-size: 24rpx; font-weight: 700; }
.sku-options { display: grid; gap: 12rpx; margin-top: 18rpx; }
.sku-option {
  display: flex; width: 100%; min-height: 88rpx; align-items: center; justify-content: space-between;
  gap: 16rpx; padding: 16rpx 18rpx; border-radius: 28rpx;
  color: var(--qx-store-text); background: var(--qx-store-surface-soft); text-align: left;
}
.sku-option--active { color: var(--qx-store-brand-strong); background: var(--qx-store-brand-soft); }
.sku-option--sold-out { color: var(--qx-store-muted); background: #f5f6f5; text-decoration: line-through; }
.sku-option--sold-out .sku-option__meta text:last-child { text-decoration: none; }
.sku-option__copy, .sku-option__name, .sku-option__code, .sku-option__meta {
  display: block; min-width: 0;
}
.sku-option__copy { flex: 1; }
.sku-option__name { font-size: 22rpx; font-weight: 650; line-height: 1.45; }
.sku-option__code, .sku-option__meta {
  margin-top: 5rpx; color: var(--qx-store-muted); font-size: 18rpx; line-height: 1.35;
}
.sku-option__meta { flex: 0 0 auto; text-align: right; }
.sku-option__meta text { display: block; }
.sku-quantity {
  display: flex; align-items: center; justify-content: space-between; gap: 20rpx; margin: 28rpx 0 34rpx;
}
.sku-quantity__hint { margin-top: 6rpx; color: var(--qx-store-muted); font-size: 18rpx; }
.sku-sheet__confirm {
  min-height: 82rpx; flex: 0 0 auto; margin: 10rpx 26rpx calc(18rpx + env(safe-area-inset-bottom));
  border-radius: 10rpx; font-size: 24rpx; font-weight: 700;
}
</style>
