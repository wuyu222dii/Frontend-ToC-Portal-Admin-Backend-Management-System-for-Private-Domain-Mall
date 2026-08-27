<script setup lang="ts">
/* global uni */
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import { getStoreProduct } from '../../api';
import { StoreApiError, type StoreCancelableRequest } from '../../api/store-client';
import QxBottomNav from '../../components/storefront/QxBottomNav.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxPrice from '../../components/storefront/QxPrice.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreProductDetail } from '../../types/store-catalog';
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
  openHome,
  openProduct,
  showLoginPrompt,
} from '../../utils/store-navigation';

const cart = ref<GuestCart>({ version: 1, items: [] });
const viewItems = ref<GuestCartViewItem[]>([]);
const refreshing = ref(false);
const storageFailure = ref(false);

let currentRequest: StoreCancelableRequest<StoreProductDetail> | undefined;
let refreshGeneration = 0;

const readyItems = computed(() => viewItems.value.filter(
  (view) => view.availability === 'ready' || view.availability === 'unverified',
));
const unavailableItems = computed(() => viewItems.value.filter(
  (view) => view.availability === 'sold-out' || view.availability === 'invalid',
));
const cartSections = computed(() => [
  { key: 'current', title: '购物车商品', items: readyItems.value },
  { key: 'unavailable', title: '售罄或失效', items: unavailableItems.value },
].filter((section) => section.items.length > 0));
const eligibleItems = computed(() => viewItems.value.filter(
  (view) => view.availability === 'ready',
));
const selectedItems = computed(() => eligibleItems.value.filter((view) => view.item.selected));
const allSelected = computed(() => eligibleItems.value.length > 0 &&
  eligibleItems.value.every((view) => view.item.selected));
const totalAmount = computed(() => guestCartTotalAmount(viewItems.value));
const refreshErrorCount = computed(() => viewItems.value.filter((view) => view.refresh_error).length);

function synchronizeViews(): void {
  const previous = new Map(viewItems.value.map((view) => [view.item.snapshot.sku_id, view]));
  viewItems.value = cart.value.items.map((item) => {
    const current = previous.get(item.snapshot.sku_id);
    return current === undefined ? unverifiedGuestCartView(item) : { ...current, item };
  });
}

function saveMutation(next: GuestCart): boolean {
  try {
    cart.value = saveGuestCart(next);
    storageFailure.value = false;
    synchronizeViews();
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
  const generation = ++refreshGeneration;
  currentRequest?.abort();
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
}

function toggleItem(view: GuestCartViewItem): void {
  if (view.availability !== 'ready') return;
  saveMutation(setGuestCartItemSelected(
    cart.value,
    view.item.snapshot.sku_id,
    !view.item.selected,
  ));
}

function toggleAll(): void {
  const nextSelected = !allSelected.value;
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
  saveMutation(setGuestCartQuantity(cart.value, view.item.snapshot.sku_id, quantity));
}

function removeItem(view: GuestCartViewItem): void {
  void uni.showModal({
    cancelText: '取消',
    confirmText: '删除',
    content: '确认从购物车删除这个规格吗？',
    title: '删除商品',
    success: (result) => {
      if (!result.confirm) return;
      saveMutation(removeGuestCartItem(cart.value, view.item.snapshot.sku_id));
    },
  });
}

function statusText(view: GuestCartViewItem): string {
  if (view.availability === 'invalid') return '商品已下架或规格已失效';
  if (view.availability === 'sold-out') return '当前规格已售罄';
  if (view.refresh_error) return '刷新失败，商品仍保留在购物车';
  if (view.availability === 'unverified') return '正在确认最新价格与库存';
  if (view.price_changed && view.stock_changed) return '价格与库存已更新';
  if (view.price_changed) return '价格已更新';
  if (view.stock_changed) return '库存已更新';
  return `库存 ${view.available_stock ?? 0} 件`;
}

function checkout(): void {
  if (selectedItems.value.length === 0) {
    void uni.showToast({ icon: 'none', title: '请选择可购买商品' });
    return;
  }
  showLoginPrompt({ type: 'CHECKOUT' });
}

onShow(() => {
  void refreshCart();
});

function cancelRefresh(): void {
  refreshGeneration += 1;
  currentRequest?.abort();
  currentRequest = undefined;
  refreshing.value = false;
}

onHide(cancelRefresh);
onUnload(cancelRefresh);
</script>

<template>
  <QxStoreShell with-bottom-nav>
    <view class="cart-page">
      <header class="cart-header">
        <text class="cart-header__title">
          购物车
        </text>
        <button
          class="cart-header__refresh"
          aria-label="刷新购物车"
          :disabled="refreshing"
          title="刷新最新价格与库存"
          @click="refreshCart"
        >
          ↻
        </button>
      </header>

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
        <text>
          {{ refreshErrorCount }} 件商品刷新失败，已保留原购物车记录。
        </text>
        <button @click="refreshCart">
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
        v-if="cart.items.length === 0"
        class="cart-empty"
        kind="empty"
        title="购物车还是空的"
        description="去挑选需要的商品，选择规格后即可加入。"
        action-label="去逛逛"
        @action="openHome"
      />

      <section
        v-for="section in cartSections"
        v-else
        :key="section.key"
        class="cart-section"
      >
        <view class="cart-section__heading">
          <text>{{ section.title }}</text>
          <text>{{ section.items.length }} 件</text>
        </view>

        <view class="cart-list">
          <article
            v-for="view in section.items"
            :key="view.item.snapshot.sku_id"
            class="cart-item"
            :class="`cart-item--${view.availability}`"
          >
            <button
              class="cart-item__check"
              :class="{ 'cart-item__check--selected': view.item.selected && view.availability === 'ready' }"
              :aria-label="view.item.selected ? '取消选择商品' : '选择商品'"
              :aria-pressed="view.item.selected && view.availability === 'ready'"
              :disabled="view.availability !== 'ready'"
              @click="toggleItem(view)"
            >
              <text aria-hidden="true">
                {{ view.item.selected && view.availability === 'ready' ? '✓' : '' }}
              </text>
            </button>

            <button
              class="cart-item__image"
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
              <text class="cart-item__spec">
                {{ view.item.snapshot.spec_label }}
              </text>
              <view class="cart-item__price-row">
                <QxPrice
                  :amount="view.item.snapshot.retail_price"
                  :is-salable="view.availability === 'ready' || (view.availability === 'unverified' && view.item.snapshot.is_salable)"
                  :show-availability="view.availability === 'sold-out'"
                />
                <text
                  class="cart-item__status"
                  :class="{ 'cart-item__status--warning': view.availability !== 'ready' || view.price_changed || view.stock_changed }"
                >
                  {{ statusText(view) }}
                </text>
              </view>
              <view class="cart-item__controls">
                <view
                  class="cart-stepper"
                  aria-label="商品数量"
                >
                  <button
                    aria-label="减少数量"
                    :disabled="view.availability !== 'ready' || view.item.quantity <= 1"
                    @click="changeQuantity(view, -1)"
                  >
                    −
                  </button>
                  <text>{{ view.item.quantity }}</text>
                  <button
                    aria-label="增加数量"
                    :disabled="view.availability !== 'ready' || view.available_stock === null || view.item.quantity >= Math.min(99, view.available_stock)"
                    @click="changeQuantity(view, 1)"
                  >
                    +
                  </button>
                </view>
                <button
                  class="cart-item__delete"
                  aria-label="删除商品"
                  title="删除"
                  @click="removeItem(view)"
                >
                  ×
                </button>
              </view>
            </view>
          </article>
        </view>
      </section>

      <view
        v-if="cart.items.length > 0"
        class="cart-summary"
      >
        <button
          class="cart-summary__select-all"
          :disabled="eligibleItems.length === 0"
          :aria-pressed="allSelected"
          @click="toggleAll"
        >
          <text
            class="cart-summary__check"
            :class="{ 'cart-summary__check--selected': allSelected }"
            aria-hidden="true"
          >
            {{ allSelected ? '✓' : '' }}
          </text>
          全选
        </button>
        <view class="cart-summary__total">
          <text>合计</text>
          <text>¥{{ totalAmount }}</text>
        </view>
        <button
          class="cart-summary__checkout"
          :disabled="selectedItems.length === 0"
          @click="checkout"
        >
          去结算{{ selectedItems.length > 0 ? ` (${selectedItems.length})` : '' }}
        </button>
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
  min-height: 100vh;
  padding-bottom: 132rpx;
  background: var(--qx-store-background);
}
.cart-header {
  position: sticky; z-index: 20; top: 0; display: grid;
  min-height: calc(92rpx + env(safe-area-inset-top));
  grid-template-columns: 80rpx minmax(0, 1fr) 80rpx; align-items: end;
  padding-top: env(safe-area-inset-top); border-bottom: 1px solid var(--qx-store-line);
  background: rgba(255, 255, 255, 0.97);
}
.cart-header__title {
  display: flex; min-height: 88rpx; grid-column: 2; align-items: center; justify-content: center;
  font-size: 30rpx; font-weight: 750;
}
.cart-header__refresh {
  display: flex; width: 80rpx; min-height: 88rpx; grid-column: 3; grid-row: 1;
  align-items: center; justify-content: center; color: var(--qx-store-brand);
  background: transparent; font-size: 36rpx;
}
.cart-header__refresh[disabled] { color: var(--qx-store-muted); }
.cart-notice {
  display: flex; min-height: 66rpx; align-items: center; justify-content: space-between;
  gap: 16rpx; padding: 12rpx 24rpx; border-bottom: 1px solid var(--qx-store-line);
  font-size: 20rpx; line-height: 1.5;
}
.cart-notice button { flex: 0 0 auto; color: var(--qx-store-brand-strong); background: transparent; font-weight: 700; }
.cart-notice--info { color: var(--qx-store-info); background: var(--qx-store-info-soft); }
.cart-notice--warning { color: var(--qx-store-warning); background: var(--qx-store-warning-soft); }
.cart-notice--danger { color: var(--qx-store-danger); background: var(--qx-store-accent-soft); }
.cart-empty { min-height: 650rpx; }
.cart-section { padding: 0 20rpx 20rpx; }
.cart-section__heading {
  display: flex; min-height: 72rpx; align-items: center; justify-content: space-between;
  color: var(--qx-store-text-soft); font-size: 21rpx; font-weight: 700;
}
.cart-section__heading text:last-child { color: var(--qx-store-muted); font-weight: 500; }
.cart-list { display: grid; gap: 14rpx; }
.cart-item {
  display: grid; min-width: 0; grid-template-columns: 52rpx 168rpx minmax(0, 1fr);
  gap: 14rpx; padding: 20rpx 18rpx; border: 1px solid var(--qx-store-line);
  border-radius: 12rpx; background: var(--qx-store-surface);
}
.cart-item--sold-out, .cart-item--invalid { background: #f3f5f3; }
.cart-item__check {
  display: flex; width: 40rpx; height: 40rpx; align-self: center; align-items: center;
  justify-content: center; border: 1px solid var(--qx-store-line-strong) !important;
  border-radius: 50%; color: #ffffff; background: #ffffff; font-size: 22rpx;
}
.cart-item__check--selected { border-color: var(--qx-store-brand) !important; background: var(--qx-store-brand); }
.cart-item__check[disabled] { background: var(--qx-store-line); opacity: 0.76; }
.cart-item__image { width: 168rpx; height: 168rpx; overflow: hidden; border-radius: 10rpx; background: transparent; }
.cart-item__body { display: flex; min-width: 0; flex-direction: column; }
.cart-item__name {
  display: block; width: 100%; overflow: hidden; color: var(--qx-store-text); background: transparent;
  font-size: 23rpx; font-weight: 700; line-height: 1.4; text-align: left;
  text-overflow: ellipsis; white-space: nowrap;
}
.cart-item__spec {
  display: block; width: 100%; margin-top: 8rpx; overflow: hidden; color: var(--qx-store-muted);
  font-size: 18rpx; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap;
}
.cart-item__price-row { min-width: 0; margin-top: 12rpx; }
.cart-item__status {
  display: block; margin-top: 5rpx; overflow-wrap: anywhere; color: var(--qx-store-muted);
  font-size: 17rpx; line-height: 1.35;
}
.cart-item__status--warning { color: var(--qx-store-warning); }
.cart-item--invalid .cart-item__status, .cart-item--sold-out .cart-item__status { color: var(--qx-store-danger); }
.cart-item__controls {
  display: flex; align-items: flex-end; justify-content: space-between; gap: 12rpx; margin-top: auto; padding-top: 10rpx;
}
.cart-stepper {
  display: grid; width: 164rpx; height: 50rpx; grid-template-columns: 50rpx minmax(0, 1fr) 50rpx;
  align-items: center; overflow: hidden; border: 1px solid var(--qx-store-line); border-radius: 8rpx; text-align: center;
}
.cart-stepper button { height: 48rpx; color: var(--qx-store-text); background: var(--qx-store-surface-soft); font-size: 24rpx; }
.cart-stepper button[disabled] { color: var(--qx-store-muted); opacity: 0.48; }
.cart-stepper text { font-size: 19rpx; font-weight: 700; }
.cart-item__delete {
  display: flex; width: 48rpx; height: 48rpx; flex: 0 0 auto; align-items: center; justify-content: center;
  color: var(--qx-store-muted); background: transparent; font-size: 30rpx;
}
.cart-summary {
  position: fixed; z-index: 26; right: 0; bottom: calc(108rpx + env(safe-area-inset-bottom)); left: 0;
  display: grid; width: 100%; max-width: 414px; min-height: 104rpx;
  grid-template-columns: 148rpx minmax(0, 1fr) 190rpx; align-items: center; gap: 10rpx;
  margin: 0 auto; padding: 10rpx 20rpx; border-top: 1px solid var(--qx-store-line);
  background: rgba(255, 255, 255, 0.98);
}
.cart-summary__select-all {
  display: flex; min-width: 0; align-items: center; gap: 10rpx; color: var(--qx-store-text-soft);
  background: transparent; font-size: 20rpx; white-space: nowrap;
}
.cart-summary__select-all[disabled] { color: var(--qx-store-muted); }
.cart-summary__check {
  display: flex; width: 34rpx; height: 34rpx; flex: 0 0 auto; align-items: center; justify-content: center;
  border: 1px solid var(--qx-store-line-strong); border-radius: 50%; color: #ffffff; font-size: 18rpx;
}
.cart-summary__check--selected { border-color: var(--qx-store-brand); background: var(--qx-store-brand); }
.cart-summary__total { min-width: 0; text-align: right; }
.cart-summary__total text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cart-summary__total text:first-child { color: var(--qx-store-muted); font-size: 17rpx; }
.cart-summary__total text:last-child { margin-top: 2rpx; color: var(--qx-store-danger); font-size: 25rpx; font-weight: 750; }
.cart-summary__checkout {
  min-width: 0; min-height: 72rpx; border-radius: 10rpx; color: #ffffff;
  background: var(--qx-store-brand); font-size: 22rpx; font-weight: 700;
}
.cart-summary__checkout[disabled] { background: var(--qx-store-muted); opacity: 0.64; }

@media (max-width: 359px) {
  .cart-item { grid-template-columns: 44rpx 140rpx minmax(0, 1fr); gap: 10rpx; padding: 16rpx 12rpx; }
  .cart-item__image { width: 140rpx; height: 140rpx; }
  .cart-summary { grid-template-columns: 132rpx minmax(0, 1fr) 162rpx; padding: 10rpx 14rpx; }
}
</style>
