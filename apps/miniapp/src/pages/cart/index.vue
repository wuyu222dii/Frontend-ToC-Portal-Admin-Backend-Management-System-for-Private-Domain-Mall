<script setup lang="ts">
/* global uni */
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import {
  createIdempotencyKey,
  deleteStoreCartItem,
  getStoreCart,
  getStoreHome,
  getStoreProduct,
  putStoreCartItem,
} from '../../api';
import { StoreApiError, type StoreCancelableRequest } from '../../api/store-client';
import QxBottomNav from '../../components/storefront/QxBottomNav.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxCheck from '../../components/storefront/QxCheck.vue';
import QxIcon from '../../components/storefront/QxIcon.vue';
import QxPrice from '../../components/storefront/QxPrice.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxStepper from '../../components/storefront/QxStepper.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type {
  StoreHomeData,
  StoreProductDetail,
  StoreProductListItem,
} from '../../types/store-catalog';
import type { StoreCart, StoreCartItem } from '../../types/store-shopping';
import { hasRefreshableCustomerSession } from '../../utils/customer-session';
import {
  consumeConfirmedGuestCartMergeSnapshots,
  synchronizeGuestCartAfterAuthentication,
} from '../../utils/guest-cart-merge-journal';
import {
  loadGuestCart,
  removeGuestCartItem,
  saveGuestCart,
  setGuestCartItemSelected,
  setGuestCartQuantity,
  type GuestCart,
  type GuestCartItem,
} from '../../utils/guest-cart';
import {
  guestCartTotalAmount,
  invalidGuestCartView,
  refreshGuestCartItem,
  unverifiedGuestCartView,
  type GuestCartViewItem,
} from '../../utils/guest-cart-refresh';
import {
  handleBottomNavigation,
  openCheckout,
  openHome,
  openProduct,
  showLoginPrompt,
} from '../../utils/store-navigation';

const cart = ref<GuestCart>({ version: 1, items: [] });
const viewItems = ref<GuestCartViewItem[]>([]);
const refreshing = ref(false);
const storageFailure = ref(false);
const mode = ref<'customer' | 'guest'>('guest');
const serverCart = ref<StoreCart | null>(null);
const serverLoadError = ref<'auth-required' | 'error' | 'rate-limited' | null>(null);
const serverRetryAfterSeconds = ref(0);
const serverStatuses = ref(new Map<string, StoreCartItem['sale_status']>());
const serverMutationPending = ref(false);
const manageMode = ref(false);
const recommendations = ref<StoreProductListItem[]>([]);

let currentRequest: StoreCancelableRequest<StoreProductDetail> | undefined;
let homeRequest: StoreCancelableRequest<StoreHomeData> | undefined;
let refreshGeneration = 0;
let homeGeneration = 0;
let customerModeRequired = false;

const readyItems = computed(() => viewItems.value.filter(
  (view) => view.availability === 'ready' || view.availability === 'unverified',
));
const unavailableItems = computed(() => viewItems.value.filter(
  (view) => view.availability === 'sold-out' || view.availability === 'invalid',
));
const eligibleItems = computed(() => viewItems.value.filter((view) =>
  view.availability === 'ready' && (mode.value === 'guest' ||
    serverStatuses.value.get(view.item.snapshot.sku_id) === 'SALEABLE')));
const selectedItems = computed(() => eligibleItems.value.filter((view) => view.item.selected));
const allSelected = computed(() => eligibleItems.value.length > 0 &&
  eligibleItems.value.every((view) => view.item.selected));
const totalAmount = computed(() => mode.value === 'customer'
  ? serverCart.value?.total_amount ?? '0.00'
  : guestCartTotalAmount(viewItems.value));
const refreshErrorCount = computed(() => viewItems.value.filter((view) => view.refresh_error).length);
const cartItemCount = computed(() => viewItems.value.length);
const selectedCount = computed(() => selectedItems.value.length);

function synchronizeViews(): void {
  const previous = new Map(viewItems.value.map((view) => [view.item.snapshot.sku_id, view]));
  viewItems.value = cart.value.items.map((item) => {
    const current = previous.get(item.snapshot.sku_id);
    return current === undefined ? unverifiedGuestCartView(item) : { ...current, item };
  });
}

function serverSpecLabel(item: StoreCartItem): string {
  const attributes = item.spec_json?.attributes ?? [];
  return attributes.length > 0
    ? attributes.map((attribute) => `${attribute.name}：${attribute.value}`).join(' · ')
    : item.sku_name;
}

function serverAvailability(item: StoreCartItem): GuestCartViewItem['availability'] {
  if (item.sale_status === 'SALEABLE' || item.sale_status === 'INSUFFICIENT_STOCK') return 'ready';
  if (item.sale_status === 'OUT_OF_STOCK') return 'sold-out';
  return 'invalid';
}

function applyServerCart(next: StoreCart, confirmedItems: readonly GuestCartItem[] = []): void {
  const confirmed = new Map(confirmedItems.map((item) => [item.snapshot.sku_id, item]));
  mode.value = 'customer';
  serverCart.value = next;
  serverStatuses.value = new Map(next.items.map((item) => [item.sku_id, item.sale_status]));
  viewItems.value = next.items.map((item) => {
    const previous = confirmed.get(item.sku_id);
    return {
      availability: serverAvailability(item),
      available_stock: item.available_stock,
      item: {
        quantity: item.quantity,
        selected: item.selected,
        snapshot: {
          product_id: item.product_id,
          product_name: item.product_name,
          sku_id: item.sku_id,
          sku_name: item.sku_name,
          spec_label: serverSpecLabel(item),
          image_url: item.primary_image_url,
          retail_price: item.retail_price,
          available_stock: item.available_stock,
          is_salable: item.sale_status === 'SALEABLE',
        },
      },
      price_changed: previous !== undefined && previous.snapshot.retail_price !== item.retail_price,
      refresh_error: false,
      stock_changed: previous !== undefined &&
        (previous.snapshot.available_stock !== item.available_stock ||
          previous.snapshot.is_salable !== (item.sale_status === 'SALEABLE')),
    };
  });
  if (next.items.length === 0) manageMode.value = false;
}

function saveMutation(next: GuestCart): boolean {
  try {
    cart.value = saveGuestCart(next);
    storageFailure.value = false;
    synchronizeViews();
    if (cart.value.items.length === 0) manageMode.value = false;
    return true;
  } catch {
    storageFailure.value = true;
    void uni.showToast({ icon: 'none', title: '本地存储不可用，修改未保存' });
    return false;
  }
}

function setProductViews(
  productId: string,
  projector: (item: GuestCartItem) => GuestCartViewItem,
): void {
  const currentItems = new Map(cart.value.items.map((item) => [item.snapshot.sku_id, item]));
  viewItems.value = viewItems.value
    .filter((view) => currentItems.has(view.item.snapshot.sku_id))
    .map((view) => {
      const current = currentItems.get(view.item.snapshot.sku_id);
      if (current === undefined) return view;
      return current.snapshot.product_id === productId
        ? projector(current)
        : { ...view, item: current };
    });
}

function applyProduct(productId: string, product: StoreProductDetail): void {
  const replacements = new Map<string, GuestCartItem>();
  const projected = new Map<string, GuestCartViewItem>();
  for (const item of cart.value.items) {
    if (item.snapshot.product_id !== productId) continue;
    const result = refreshGuestCartItem(item, product);
    if (result === null) {
      projected.set(item.snapshot.sku_id, invalidGuestCartView(item));
      continue;
    }
    replacements.set(item.snapshot.sku_id, result.item);
    projected.set(item.snapshot.sku_id, result.view);
  }

  cart.value = {
    ...cart.value,
    items: cart.value.items.map((item) => replacements.get(item.snapshot.sku_id) ?? item),
  };
  setProductViews(productId, (item) => projected.get(item.snapshot.sku_id) ?? invalidGuestCartView(item));
}

function markProductUnavailable(productId: string): void {
  setProductViews(productId, invalidGuestCartView);
}

function markProductRefreshFailed(productId: string): void {
  setProductViews(productId, (item) => unverifiedGuestCartView(item, true));
}

async function refreshCart(): Promise<void> {
  if (serverMutationPending.value) return;
  const generation = ++refreshGeneration;
  currentRequest?.abort();
  serverLoadError.value = null;
  serverRetryAfterSeconds.value = 0;
  const authenticated = hasRefreshableCustomerSession();
  if (authenticated) {
    customerModeRequired = true;
  }
  if (customerModeRequired && !authenticated) {
    mode.value = 'customer';
    serverCart.value = null;
    viewItems.value = [];
    refreshing.value = false;
    serverLoadError.value = 'auth-required';
    return;
  }
  if (authenticated) {
    mode.value = 'customer';
    refreshing.value = true;
    storageFailure.value = false;
    viewItems.value = [];
    try {
      const merged = await synchronizeGuestCartAfterAuthentication();
      const next = merged ?? await getStoreCart();
      const confirmed = await consumeConfirmedGuestCartMergeSnapshots();
      if (generation !== refreshGeneration) return;
      applyServerCart(next, confirmed);
    } catch (error) {
      if (generation !== refreshGeneration) return;
      serverCart.value = null;
      viewItems.value = [];
      if (error instanceof StoreApiError && error.status === 429) {
        serverRetryAfterSeconds.value = error.retryAfterSeconds ?? 1;
        serverLoadError.value = 'rate-limited';
      } else {
        serverLoadError.value = 'error';
        if (error instanceof StoreApiError && error.status === 401) {
          serverLoadError.value = 'auth-required';
          showLoginPrompt({ type: 'CART' });
        }
      }
    } finally {
      if (generation === refreshGeneration) refreshing.value = false;
    }
    if (generation === refreshGeneration && serverLoadError.value === null) {
      loadRecommendations();
    }
    return;
  }

  mode.value = 'guest';
  serverCart.value = null;
  serverStatuses.value = new Map();
  cart.value = loadGuestCart();
  viewItems.value = cart.value.items.map((item) => unverifiedGuestCartView(item));
  refreshing.value = cart.value.items.length > 0;
  storageFailure.value = false;

  const productIds = [...new Set(cart.value.items.map((item) => item.snapshot.product_id))];
  for (const productId of productIds) {
    if (generation !== refreshGeneration) return;
    if (!cart.value.items.some((item) => item.snapshot.product_id === productId)) continue;

    const request = getStoreProduct(productId);
    currentRequest = request;
    try {
      const product = await request.promise;
      if (generation !== refreshGeneration) return;
      applyProduct(productId, product);
    } catch (error) {
      if (generation !== refreshGeneration || (error instanceof StoreApiError && error.aborted)) return;
      if (error instanceof StoreApiError && error.status === 404) {
        markProductUnavailable(productId);
      } else {
        markProductRefreshFailed(productId);
      }
    } finally {
      if (generation === refreshGeneration) currentRequest = undefined;
    }
  }

  if (generation !== refreshGeneration) return;
  refreshing.value = false;
  try {
    cart.value = saveGuestCart(cart.value);
  } catch {
    storageFailure.value = true;
  }
  loadRecommendations();
}

function mutationPending(): boolean {
  return serverMutationPending.value;
}

async function applyServerMutation(
  operation: () => Promise<StoreCart>,
): Promise<void> {
  if (serverMutationPending.value) return;
  serverMutationPending.value = true;
  try {
    applyServerCart(await operation());
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 409) {
      void uni.showToast({ icon: 'none', title: '购物车已变化，请重新操作' });
    } else if (error instanceof StoreApiError && error.status === 401) {
      serverLoadError.value = 'error';
      showLoginPrompt({ type: 'CART' });
    } else if (error instanceof StoreApiError && error.code === 'CART_ITEM_LIMIT_EXCEEDED') {
      void uni.showToast({ icon: 'none', title: '购物车商品种类已达上限' });
    } else {
      void uni.showToast({ icon: 'none', title: '购物车更新失败，请重试' });
    }
    if (!(error instanceof StoreApiError && error.status === 401)) {
      try {
        applyServerCart(await getStoreCart());
      } catch (refreshError) {
        serverLoadError.value = refreshError instanceof StoreApiError && refreshError.status === 429
          ? 'rate-limited'
          : 'error';
        serverRetryAfterSeconds.value = refreshError instanceof StoreApiError
          ? refreshError.retryAfterSeconds ?? 0
          : 0;
      }
    }
  } finally {
    serverMutationPending.value = false;
  }
}

function toggleItem(view: GuestCartViewItem): void {
  if (view.availability !== 'ready') return;
  if (mode.value === 'customer') {
    void applyServerMutation(() => putStoreCartItem(
      view.item.snapshot.sku_id,
      { quantity: view.item.quantity, selected: !view.item.selected },
      createIdempotencyKey(),
    ));
    return;
  }
  saveMutation(setGuestCartItemSelected(
    cart.value,
    view.item.snapshot.sku_id,
    !view.item.selected,
  ));
}

function toggleAll(): void {
  const nextSelected = !allSelected.value;
  if (mode.value === 'customer') {
    const candidates = viewItems.value.filter((view) =>
      view.availability === 'ready' && view.item.selected !== nextSelected);
    void applyServerMutation(async () => {
      let latest: StoreCart | null = null;
      for (const view of candidates) {
        latest = await putStoreCartItem(view.item.snapshot.sku_id, {
          quantity: view.item.quantity,
          selected: nextSelected,
        }, createIdempotencyKey());
      }
      return latest ?? await getStoreCart();
    });
    return;
  }
  const eligibleIds = new Set(eligibleItems.value.map((view) => view.item.snapshot.sku_id));
  let next = cart.value;
  for (const item of cart.value.items) {
    next = setGuestCartItemSelected(
      next,
      item.snapshot.sku_id,
      nextSelected && eligibleIds.has(item.snapshot.sku_id),
    );
  }
  saveMutation(next);
}

function changeQuantity(view: GuestCartViewItem, delta: number): void {
  if (view.availability !== 'ready' || view.available_stock === null) return;
  const maximum = Math.min(99, view.available_stock);
  const quantity = Math.min(maximum, Math.max(1, view.item.quantity + delta));
  if (quantity === view.item.quantity) return;
  if (mode.value === 'customer') {
    void applyServerMutation(() => putStoreCartItem(
      view.item.snapshot.sku_id,
      { quantity, selected: view.item.selected },
      createIdempotencyKey(),
    ));
    return;
  }
  saveMutation(setGuestCartQuantity(cart.value, view.item.snapshot.sku_id, quantity));
}

function setCartQuantity(view: GuestCartViewItem, value: number): void {
  changeQuantity(view, value - view.item.quantity);
}

function removeItem(view: GuestCartViewItem): void {
  void uni.showModal({
    cancelText: '取消',
    confirmText: '删除',
    content: '确认从购物车删除这个规格吗？',
    title: '删除商品',
    success: (result) => {
      if (!result.confirm) return;
      if (mode.value === 'customer') {
        void applyServerMutation(() => deleteStoreCartItem(
          view.item.snapshot.sku_id,
          createIdempotencyKey(),
        ));
        return;
      }
      saveMutation(removeGuestCartItem(cart.value, view.item.snapshot.sku_id));
    },
  });
}

function statusText(view: GuestCartViewItem): string {
  const serverStatus = mode.value === 'customer'
    ? serverStatuses.value.get(view.item.snapshot.sku_id)
    : undefined;
  if (serverStatus === 'INSUFFICIENT_STOCK') return `库存仅剩 ${view.available_stock ?? 0} 件，请减少数量`;
  if (serverStatus === 'INACTIVE') return '当前规格已下架';
  if (serverStatus === 'DELETED') return '当前规格已失效';
  if (view.availability === 'invalid') return '商品已下架或规格已失效';
  if (view.availability === 'sold-out') return '当前规格已售罄';
  if (view.refresh_error) return '刷新失败，商品仍保留在购物车';
  if (view.availability === 'unverified') return '正在确认最新价格与库存';
  if (view.price_changed && view.stock_changed) return '价格与库存已更新';
  if (view.price_changed) return '价格已更新';
  if (view.stock_changed) return '库存已更新';
  return `库存 ${view.available_stock ?? 0} 件`;
}

function showItemStatus(view: GuestCartViewItem): boolean {
  if (view.availability !== 'ready') return true;
  if (view.refresh_error || view.price_changed || view.stock_changed) return true;
  if (mode.value !== 'customer') return false;
  return serverStatuses.value.get(view.item.snapshot.sku_id) === 'INSUFFICIENT_STOCK';
}

function itemKicker(view: GuestCartViewItem): string {
  const skuName = view.item.snapshot.sku_name.trim();
  const specLabel = view.item.snapshot.spec_label.trim();
  if (skuName !== '' && skuName !== specLabel) return skuName;
  return '';
}

function unavailableOverlay(view: GuestCartViewItem): string {
  return view.availability === 'sold-out' ? '已售罄' : '已失效';
}

function recommendCorner(product: StoreProductListItem): string {
  if (product.is_hot) return '热销';
  if (product.is_new) return '新品';
  return '';
}

function recommendKicker(product: StoreProductListItem): string {
  return product.subtitle?.trim() || product.brand.name;
}

function toggleManage(): void {
  manageMode.value = !manageMode.value;
}

function clearUnavailable(): void {
  const items = unavailableItems.value;
  if (items.length === 0 || mutationPending()) return;
  void uni.showModal({
    cancelText: '取消',
    confirmText: '清空',
    content: `确认删除 ${items.length} 件失效商品吗？`,
    title: '清空失效商品',
    success: (result) => {
      if (!result.confirm) return;
      if (mode.value === 'customer') {
        void applyServerMutation(async () => {
          let latest: StoreCart | null = null;
          for (const view of items) {
            latest = await deleteStoreCartItem(
              view.item.snapshot.sku_id,
              createIdempotencyKey(),
            );
          }
          return latest ?? await getStoreCart();
        });
        return;
      }
      let next = cart.value;
      for (const view of items) {
        next = removeGuestCartItem(next, view.item.snapshot.sku_id);
      }
      saveMutation(next);
    },
  });
}

function loadRecommendations(): void {
  homeRequest?.abort();
  const generation = ++homeGeneration;
  const request = getStoreHome();
  homeRequest = request;
  void request.promise
    .then((data) => {
      if (generation !== homeGeneration) return;
      const cartIds = new Set(viewItems.value.map((view) => view.item.snapshot.product_id));
      const seen = new Set<string>();
      const next: StoreProductListItem[] = [];
      const pools = [...data.hot_products, ...data.new_products];
      for (const product of pools) {
        if (!product.is_salable) continue;
        if (cartIds.has(product.product_id) || seen.has(product.product_id)) continue;
        seen.add(product.product_id);
        next.push(product);
        if (next.length >= 4) break;
      }
      recommendations.value = next;
    })
    .catch((error) => {
      if (generation !== homeGeneration) return;
      if (error instanceof StoreApiError && error.aborted) return;
      recommendations.value = [];
    });
}

function checkout(): void {
  if (selectedItems.value.length === 0) {
    void uni.showToast({ icon: 'none', title: '请选择可购买商品' });
    return;
  }
  if (!hasRefreshableCustomerSession()) {
    showLoginPrompt({ type: 'CHECKOUT' });
    return;
  }
  openCheckout({ source: 'CART' });
}

function retryCartLogin(): void {
  showLoginPrompt({ type: 'CART' });
}

function retryServerCart(): void {
  if (serverLoadError.value === 'auth-required') {
    retryCartLogin();
    return;
  }
  void refreshCart();
}

onShow(() => {
  void refreshCart();
});

function cancelRefresh(): void {
  refreshGeneration += 1;
  homeGeneration += 1;
  currentRequest?.abort();
  currentRequest = undefined;
  homeRequest?.abort();
  homeRequest = undefined;
  refreshing.value = false;
}

onHide(cancelRefresh);
onUnload(cancelRefresh);
</script>

<template>
  <QxStoreShell with-bottom-nav>
    <view
      class="cart-page"
      :class="{ 'cart-page--checkout': viewItems.length > 0 && !serverLoadError }"
    >
      <view
        class="cart-header-slot"
        aria-hidden="true"
      />
      <view class="cart-header">
        <view class="cart-header__title-row">
          <text class="cart-header__title">
            购物车
          </text>
          <text
            v-if="cartItemCount > 0"
            class="cart-header__count"
          >
            ({{ cartItemCount }})
          </text>
        </view>
      </view>

      <view
        v-if="refreshing"
        class="cart-notice cart-notice--info"
      >
        正在确认最新价格与库存
      </view>
      <view
        v-if="refreshErrorCount > 0"
        class="cart-notice cart-notice--warning"
      >
        <text class="cart-notice__copy">
          {{ refreshErrorCount }} 件商品刷新失败，已保留原购物车记录。
        </text>
        <button
          class="cart-notice__action"
          @click="refreshCart"
        >
          重试
        </button>
      </view>
      <view
        v-if="storageFailure"
        class="cart-notice cart-notice--danger"
      >
        本地存储暂不可用，本次刷新或修改可能未保存。
      </view>

      <QxCatalogState
        v-if="serverLoadError"
        :kind="serverLoadError === 'auth-required' ? 'empty' : serverLoadError"
        :retry-after-seconds="serverRetryAfterSeconds"
        :title="serverLoadError === 'auth-required' ? '登录后查看购物车' : '服务端购物车加载失败'"
        :description="serverLoadError === 'auth-required'
          ? '你已取消登录，本页不会回退到游客购物车。'
          : '登录后的购物车以服务端为准，请重试恢复最新数据。'"
        :action-label="serverLoadError === 'auth-required' ? '去登录' : '重新加载'"
        @action="retryServerCart"
      />

      <template v-else>
        <QxCatalogState
          v-if="viewItems.length === 0 && !refreshing"
          class="cart-empty"
          kind="empty"
          title="购物车还是空的"
          description="挑选规格后即可加入。"
          action-label="去逛逛"
          @action="openHome"
        />

        <view
          v-if="viewItems.length > 0"
          class="cart-toolbar"
        >
          <text class="cart-toolbar__hint">
            已按沙龙专研系列整理
          </text>
          <button
            class="cart-toolbar__manage"
            :aria-pressed="manageMode"
            @click="toggleManage"
          >
            {{ manageMode ? '完成' : '管理' }}
          </button>
        </view>

        <view
          v-if="readyItems.length > 0"
          class="cart-list"
        >
          <view
            v-for="view in readyItems"
            :key="view.item.snapshot.sku_id"
            class="cart-item"
            :class="`cart-item--${view.availability}`"
          >
            <button
              class="cart-item__check"
              :aria-label="view.item.selected ? '取消选择商品' : '选择商品'"
              :aria-pressed="view.item.selected && view.availability === 'ready'"
              :disabled="view.availability !== 'ready' || serverMutationPending"
              @click="toggleItem(view)"
            >
              <QxCheck
                :checked="view.item.selected && view.availability === 'ready'"
                :disabled="view.availability !== 'ready' || serverMutationPending"
              />
            </button>

            <button
              class="cart-item__media"
              :aria-label="`查看${view.item.snapshot.product_name}`"
              @click="openProduct(view.item.snapshot.product_id)"
            >
              <QxProductImage
                :src="view.item.snapshot.image_url"
                :alt="view.item.snapshot.product_name"
                shape="square"
              />
            </button>

            <view class="cart-item__body">
              <button
                class="cart-item__name"
                @click="openProduct(view.item.snapshot.product_id)"
              >
                {{ view.item.snapshot.product_name }}
              </button>
              <text
                v-if="itemKicker(view)"
                class="cart-item__kicker"
              >
                {{ itemKicker(view) }}
              </text>
              <button
                v-if="view.item.snapshot.spec_label"
                class="cart-item__spec"
                :aria-label="`查看${view.item.snapshot.product_name}规格`"
                @click="openProduct(view.item.snapshot.product_id)"
              >
                <text class="cart-item__spec-text">
                  {{ view.item.snapshot.spec_label }}
                </text>
                <view class="cart-item__spec-caret">
                  <QxIcon
                    name="chevron"
                    :size="18"
                    color="#8C827A"
                  />
                </view>
              </button>
              <text
                v-if="showItemStatus(view)"
                class="cart-item__status"
                :class="{
                  'cart-item__status--warning': view.availability !== 'ready'
                    || view.price_changed
                    || view.stock_changed
                    || view.refresh_error,
                }"
              >
                {{ statusText(view) }}
              </text>
              <view class="cart-item__footer">
                <QxPrice
                  class="cart-item__price"
                  :amount="view.item.snapshot.retail_price"
                  :is-salable="view.availability === 'ready'
                    || (view.availability === 'unverified' && view.item.snapshot.is_salable)"
                  :show-availability="false"
                />
                <view class="cart-item__actions">
                  <QxStepper
                    size="compact"
                    :value="view.item.quantity"
                    :min="1"
                    :max="view.available_stock === null ? 1 : Math.min(99, view.available_stock)"
                    :disabled="view.availability !== 'ready' || mutationPending()"
                    @change="(value) => setCartQuantity(view, value)"
                  />
                  <button
                    v-if="manageMode"
                    class="cart-item__delete"
                    aria-label="删除商品"
                    :disabled="mutationPending()"
                    @click="removeItem(view)"
                  >
                    <QxIcon
                      name="trash"
                      :size="28"
                      color="#8C827A"
                    />
                  </button>
                </view>
              </view>
            </view>
          </view>
        </view>

        <view
          v-if="unavailableItems.length > 0"
          class="cart-inactive"
        >
          <view class="cart-inactive__head">
            <text class="cart-inactive__title">
              失效商品 ({{ unavailableItems.length }}件)
            </text>
            <button
              class="cart-inactive__clear"
              :disabled="mutationPending()"
              @click="clearUnavailable"
            >
              <QxIcon
                name="trash"
                :size="22"
                color="#8C827A"
              />
              <text class="cart-inactive__clear-text">
                一键清空
              </text>
            </button>
          </view>
          <view
            v-for="view in unavailableItems"
            :key="view.item.snapshot.sku_id"
            class="cart-inactive__item"
          >
            <view
              class="cart-item__dead-check"
              aria-hidden="true"
            >
              <QxIcon
                name="close"
                :size="18"
                color="#ffffff"
              />
            </view>
            <button
              class="cart-inactive__media"
              :aria-label="`查看${view.item.snapshot.product_name}`"
              @click="openProduct(view.item.snapshot.product_id)"
            >
              <QxProductImage
                :src="view.item.snapshot.image_url"
                :alt="view.item.snapshot.product_name"
                shape="square"
              />
              <view class="cart-inactive__mask">
                <text class="cart-inactive__badge">
                  {{ unavailableOverlay(view) }}
                </text>
              </view>
            </button>
            <view class="cart-inactive__body">
              <view class="cart-inactive__row">
                <text class="cart-inactive__name">
                  {{ view.item.snapshot.product_name }}
                </text>
                <button
                  class="cart-item__delete"
                  aria-label="删除失效商品"
                  :disabled="mutationPending()"
                  @click="removeItem(view)"
                >
                  <QxIcon
                    name="close"
                    :size="24"
                    color="#8C827A"
                  />
                </button>
              </view>
              <text class="cart-inactive__reason">
                {{ statusText(view) }}
              </text>
              <QxPrice
                class="cart-inactive__price"
                :amount="view.item.snapshot.retail_price"
                :is-salable="false"
                :show-availability="false"
                size="small"
              />
            </view>
          </view>
        </view>

        <view
          v-if="recommendations.length > 0"
          class="cart-recs"
        >
          <view class="cart-recs__heading">
            <view class="cart-recs__rule" />
            <text class="cart-recs__title">
              沙龙专研 · 猜你喜欢
            </text>
            <view class="cart-recs__rule" />
          </view>
          <text class="cart-recs__sub">
            高定洗护搭配 · 奢润加倍
          </text>
          <view class="cart-recs__grid">
            <view
              v-for="product in recommendations"
              :key="product.product_id"
              class="cart-rec"
              hover-class="cart-rec--pressed"
              :aria-label="product.name"
              @click="openProduct(product.product_id)"
            >
              <view class="cart-rec__media">
                <text
                  v-if="recommendCorner(product)"
                  class="cart-rec__corner"
                >
                  {{ recommendCorner(product) }}
                </text>
                <QxProductImage
                  :src="product.primary_image?.url ?? null"
                  :alt="product.name"
                  shape="square"
                />
              </view>
              <text class="cart-rec__name">
                {{ product.name }}
              </text>
              <text
                v-if="recommendKicker(product)"
                class="cart-rec__kicker"
              >
                {{ recommendKicker(product) }}
              </text>
              <view class="cart-rec__footer">
                <QxPrice
                  class="cart-rec__price"
                  :amount="product.minimum_active_price"
                  :is-salable="product.is_salable"
                  :show-availability="false"
                  size="small"
                />
                <view
                  class="cart-rec__add"
                  aria-hidden="true"
                >
                  <QxIcon
                    name="plus"
                    :size="22"
                    color="#ffffff"
                  />
                </view>
              </view>
            </view>
          </view>
        </view>
      </template>

      <view
        v-if="viewItems.length > 0 && !serverLoadError"
        class="cart-summary"
      >
        <view class="cart-summary__bar">
          <button
            class="cart-summary__select-all"
            :class="{
              'cart-summary__select-all--disabled': eligibleItems.length === 0 || serverMutationPending,
            }"
            :disabled="eligibleItems.length === 0 || serverMutationPending"
            :aria-pressed="allSelected"
            @click="toggleAll"
          >
            <QxCheck
              :checked="allSelected"
              :disabled="eligibleItems.length === 0 || serverMutationPending"
            />
            <text class="cart-summary__select-label">
              全选
            </text>
          </button>
          <view class="cart-summary__pay">
            <view class="cart-summary__total">
              <text class="cart-summary__label">
                合计:
              </text>
              <QxPrice
                class="cart-summary__amount"
                :amount="totalAmount"
                size="large"
                :show-availability="false"
              />
            </view>
            <text
              v-if="selectedCount > 0"
              class="cart-summary__hint"
            >
              已选 {{ selectedCount }} 件
            </text>
          </view>
          <button
            class="cart-summary__checkout"
            :class="{
              'cart-summary__checkout--disabled': selectedCount === 0 || serverMutationPending,
            }"
            :disabled="selectedCount === 0 || serverMutationPending"
            @click="checkout"
          >
            <text class="cart-summary__checkout-text">
              去结算
            </text>
            <text
              v-if="selectedCount > 0"
              class="cart-summary__badge"
            >
              {{ selectedCount }}
            </text>
          </button>
        </view>
      </view>
    </view>

    <template #bottom>
      <QxBottomNav
        active="cart"
        @select="handleBottomNavigation"
      />
    </template>
  </QxStoreShell>
</template>

<style scoped>
.cart-page {
  min-height: 100%;
  background: #fbf9f5;
}

.cart-page--checkout {
  padding-bottom: 200rpx;
}

.cart-header-slot {
  height: var(--qx-nav-bar, 96rpx);
}

.cart-header {
  position: fixed;
  z-index: 20;
  top: 0;
  right: 0;
  left: 0;
  width: 100%;
  border-bottom: 1px solid rgba(240, 236, 228, 0.4);
  background: rgba(251, 249, 245, 0.96);
}

/* #ifndef MP-WEIXIN */
.cart-header,
.cart-summary {
  max-width: 414px;
  margin-right: auto;
  margin-left: auto;
}
/* #endif */

.cart-header__title-row {
  box-sizing: border-box;
  display: flex;
  min-height: var(--qx-nav-bar, 96rpx);
  align-items: center;
  justify-content: center;
  padding-top: var(--qx-status-bar, 8rpx);
  padding-right: var(--qx-capsule-right, 32rpx);
  padding-left: var(--qx-capsule-gap, 32rpx);
}

.cart-header__title {
  color: #2a2421;
  font-size: 32rpx;
  font-weight: 600;
  letter-spacing: 1rpx;
}

.cart-header__count {
  margin-left: 8rpx;
  color: #8c827a;
  font-size: 24rpx;
  font-weight: 400;
}

.cart-notice {
  display: flex;
  min-height: 66rpx;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx 32rpx;
  font-size: 22rpx;
  line-height: 1.5;
}

.cart-notice__copy {
  min-width: 0;
  flex: 1;
}

.cart-notice__action {
  flex: 0 0 auto;
  color: #8a6a24;
  background: transparent;
  font-weight: 700;
}

.cart-notice--info {
  color: #2a2421;
  border-bottom: 1px solid #f2e5d0;
  background: linear-gradient(90deg, #fbf4ea 0%, #faf0df 100%);
}

.cart-notice--warning {
  color: #b45309;
  background: #f6e8d0;
}

.cart-notice--danger {
  color: #b84848;
  background: #f7e7e2;
}

.cart-empty {
  min-height: 420rpx;
}

.cart-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24rpx 32rpx 8rpx;
}

.cart-toolbar__hint {
  color: #8c827a;
  font-size: 22rpx;
}

.cart-toolbar__manage {
  padding: 4rpx 16rpx;
  border-radius: 8rpx;
  color: #2a2421;
  background: transparent;
  font-size: 22rpx;
  font-weight: 500;
}

.cart-list {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 8rpx 24rpx 0;
}

.cart-item {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 24rpx;
  padding: 28rpx;
  border: 1px solid rgba(240, 236, 228, 0.7);
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 40rpx -4rpx rgba(42, 36, 33, 0.04);
}

.cart-item__check,
.cart-item__dead-check {
  display: flex;
  width: 40rpx;
  height: 40rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin-top: 60rpx;
  padding: 0;
  background: transparent;
}

.cart-item__dead-check {
  border-radius: 50%;
  background: #e5e0d8;
}

.cart-item__media {
  position: relative;
  width: 160rpx;
  height: 160rpx;
  flex: 0 0 auto;
  overflow: hidden;
  padding: 8rpx;
  border: 1px solid rgba(240, 236, 228, 0.5);
  border-radius: 24rpx;
  background: #fbf9f5;
}

.cart-item__body {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-self: stretch;
}

.cart-item__name {
  display: block;
  width: 100%;
  overflow: hidden;
  padding: 0;
  color: #2a2421;
  background: transparent;
  font-size: 26rpx;
  font-weight: 500;
  line-height: 1.35;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cart-item__kicker {
  display: block;
  margin-top: 6rpx;
  overflow: hidden;
  color: #8c827a;
  font-size: 22rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cart-item__spec {
  display: inline-flex;
  max-width: 100%;
  align-items: center;
  align-self: flex-start;
  margin-top: 12rpx;
  padding: 4rpx 16rpx;
  border: 1px solid #f0ece4;
  border-radius: 999rpx;
  background: #fbf9f5;
}

.cart-item__spec-text {
  min-width: 0;
  overflow: hidden;
  color: #8c827a;
  font-size: 20rpx;
  line-height: 1.4;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cart-item__spec-caret {
  width: 20rpx;
  height: 20rpx;
  margin-left: 4rpx;
  transform: rotate(90deg);
}

.cart-item__status {
  display: block;
  margin-top: 8rpx;
  overflow-wrap: anywhere;
  color: #8c827a;
  font-size: 20rpx;
  line-height: 1.35;
}

.cart-item__status--warning {
  color: #b45309;
}

.cart-item__footer {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: auto;
  padding-top: 16rpx;
}

.cart-item__price :deep(.qx-price__currency) {
  color: #c5a059;
  font-size: 22rpx;
  font-weight: 600;
}

.cart-item__price :deep(.qx-price__value) {
  color: #2a2421;
  font-size: 32rpx;
  font-weight: 700;
  letter-spacing: -0.4rpx;
}

.cart-item__actions {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 8rpx;
}

.cart-item__delete {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  color: #8c827a;
  background: transparent;
}

.cart-inactive {
  margin: 28rpx 24rpx 0;
  padding: 28rpx;
  border: 1px solid rgba(240, 236, 228, 0.6);
  border-radius: 32rpx;
  background: rgba(255, 255, 255, 0.7);
}

.cart-inactive__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 16rpx;
  border-bottom: 1px solid rgba(240, 236, 228, 0.4);
}

.cart-inactive__title {
  color: #8c827a;
  font-size: 22rpx;
  font-weight: 500;
}

.cart-inactive__clear {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 0;
  color: #8c827a;
  background: transparent;
}

.cart-inactive__clear-text {
  font-size: 22rpx;
}

.cart-inactive__item {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  gap: 24rpx;
  padding-top: 24rpx;
  opacity: 0.72;
}

.cart-inactive__media {
  position: relative;
  width: 144rpx;
  height: 144rpx;
  flex: 0 0 auto;
  overflow: hidden;
  padding: 0;
  border: 1px solid #f0ece4;
  border-radius: 24rpx;
  background: #f3f0ea;
}

.cart-inactive__mask {
  position: absolute;
  z-index: 2;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.25);
}

.cart-inactive__badge {
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  color: #ffffff;
  background: rgba(0, 0, 0, 0.6);
  font-size: 18rpx;
  font-weight: 500;
}

.cart-inactive__body {
  min-width: 0;
  flex: 1;
}

.cart-inactive__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8rpx;
}

.cart-inactive__name {
  min-width: 0;
  overflow: hidden;
  color: #8c827a;
  font-size: 24rpx;
  font-weight: 400;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.cart-inactive__reason {
  display: block;
  margin-top: 6rpx;
  color: #a39992;
  font-size: 20rpx;
  line-height: 1.4;
}

.cart-inactive__price {
  margin-top: 16rpx;
}

.cart-inactive__price :deep(.qx-price__amount) {
  color: #8c827a;
}

.cart-recs {
  padding: 40rpx 24rpx 32rpx;
}

.cart-recs__heading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16rpx;
}

.cart-recs__rule {
  width: 40rpx;
  height: 2rpx;
  background: #e8d5b5;
}

.cart-recs__title {
  color: #c5a059;
  font-size: 22rpx;
  font-weight: 500;
  letter-spacing: 4rpx;
}

.cart-recs__sub {
  display: block;
  margin-top: 8rpx;
  color: #8c827a;
  font-size: 20rpx;
  text-align: center;
}

.cart-recs__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20rpx;
  margin-top: 28rpx;
}

.cart-rec {
  display: flex;
  min-width: 0;
  flex-direction: column;
  padding: 20rpx;
  border: 1px solid rgba(240, 236, 228, 0.6);
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 40rpx -4rpx rgba(42, 36, 33, 0.04);
}

.cart-rec--pressed {
  opacity: 0.88;
}

.cart-rec__media {
  position: relative;
  width: 100%;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  margin-bottom: 16rpx;
  border-radius: 24rpx;
  background: #f6f4ef;
}

.cart-rec__corner {
  position: absolute;
  z-index: 2;
  top: 12rpx;
  left: 12rpx;
  padding: 4rpx 12rpx;
  border-radius: 8rpx;
  color: #966e33;
  background: rgba(184, 142, 79, 0.15);
  font-size: 18rpx;
  font-weight: 500;
}

.cart-rec__name,
.cart-rec__kicker {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 1;
}

.cart-rec__name {
  color: #2a2421;
  font-size: 24rpx;
  font-weight: 500;
  line-height: 1.4;
}

.cart-rec__kicker {
  margin-top: 6rpx;
  color: #8c827a;
  font-size: 20rpx;
  line-height: 1.4;
}

.cart-rec__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12rpx;
  margin-top: auto;
  padding-top: 16rpx;
  border-top: 1px solid rgba(240, 236, 228, 0.4);
}

.cart-rec__price :deep(.qx-price__currency) {
  color: #c5a059;
}

.cart-rec__price :deep(.qx-price__value) {
  color: #2a2421;
}

.cart-rec__add {
  display: flex;
  width: 48rpx;
  height: 48rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: #c5a059;
}

.cart-summary {
  position: fixed;
  z-index: 26;
  right: 0;
  bottom: calc(108rpx + constant(safe-area-inset-bottom));
  bottom: calc(108rpx + env(safe-area-inset-bottom));
  bottom: calc(108rpx + var(--qx-safe-bottom-pad, env(safe-area-inset-bottom, 0px)));
  left: 0;
  width: 100%;
  padding: 0 24rpx 16rpx;
}

.cart-summary__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
  padding: 16rpx;
  border: 1px solid rgba(240, 236, 228, 0.8);
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 -8rpx 48rpx rgba(42, 36, 33, 0.06);
}

.cart-summary__select-all {
  display: flex;
  min-width: 0;
  flex: 0 0 auto;
  align-items: center;
  gap: 12rpx;
  padding: 0 8rpx;
  color: #2a2421;
  background: transparent;
}

.cart-summary__select-label {
  color: #2a2421;
  font-size: 24rpx;
  font-weight: 500;
}

.cart-summary__select-all--disabled {
  color: #8c827a;
}

.cart-summary__select-all--disabled .cart-summary__select-label {
  color: #8c827a;
}

.cart-summary__pay {
  min-width: 0;
  flex: 1;
  text-align: right;
}

.cart-summary__total {
  display: flex;
  align-items: baseline;
  justify-content: flex-end;
  gap: 4rpx;
}

.cart-summary__label {
  color: #8c827a;
  font-size: 22rpx;
}

.cart-summary__amount :deep(.qx-price),
.cart-summary__amount :deep(.qx-price__amount),
.cart-summary__amount :deep(.qx-price__currency),
.cart-summary__amount :deep(.qx-price__value) {
  color: #c5a059;
}

.cart-summary__amount :deep(.qx-price__currency) {
  font-size: 24rpx;
  font-weight: 700;
}

.cart-summary__amount :deep(.qx-price__value) {
  font-size: 36rpx;
  font-weight: 700;
  letter-spacing: -0.6rpx;
}

.cart-summary__hint {
  display: block;
  margin-top: 4rpx;
  color: #8c827a;
  font-size: 18rpx;
}

.cart-summary__checkout {
  display: flex;
  min-width: 160rpx;
  min-height: 80rpx;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  gap: 8rpx;
  padding: 0 28rpx;
  border-radius: 24rpx;
  color: #ffffff;
  background: linear-gradient(135deg, #c5a059 0%, #b88e4f 100%);
  box-shadow: 0 8rpx 28rpx rgba(184, 142, 79, 0.28);
  font-size: 24rpx;
  font-weight: 500;
}

.cart-summary__checkout--disabled {
  background: #c8c2b8;
  box-shadow: none;
  opacity: 0.72;
}

.cart-summary__checkout-text {
  color: #ffffff;
}

.cart-summary__badge {
  min-width: 32rpx;
  padding: 2rpx 10rpx;
  border-radius: 999rpx;
  color: #ffffff;
  background: rgba(255, 255, 255, 0.25);
  font-size: 20rpx;
  font-weight: 700;
  line-height: 1.3;
  text-align: center;
}

@media (max-width: 359px) {
  .cart-item {
    gap: 16rpx;
    padding: 20rpx;
  }

  .cart-item__media {
    width: 136rpx;
    height: 136rpx;
  }

  .cart-inactive__media {
    width: 120rpx;
    height: 120rpx;
  }

  .cart-summary__checkout {
    min-width: 140rpx;
    padding: 0 20rpx;
  }
}
</style>
