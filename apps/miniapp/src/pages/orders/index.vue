<script setup lang="ts">
import { onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import { listStoreOrders } from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreOrderListItem, StoreOrderListQuery } from '../../types/store-orders';
import { clearCustomerSession } from '../../utils/customer-session';
import { replaceWithLoginForAction } from '../../utils/protected-action';
import { openOrder } from '../../utils/store-navigation';

type OrderTab = 'ALL' | 'PENDING_PAYMENT' | 'CLOSED';
type PageState = 'loading' | 'ready' | 'empty' | 'auth-required' | 'error' | 'rate-limited';

const tabs: ReadonlyArray<{ key: OrderTab; label: string }> = [
  { key: 'ALL', label: '全部' },
  { key: 'PENDING_PAYMENT', label: '待付款' },
  { key: 'CLOSED', label: '已关闭' },
];

const activeTab = ref<OrderTab>('ALL');
const state = ref<PageState>('loading');
const orders = ref<StoreOrderListItem[]>([]);
const page = ref(1);
const total = ref(0);
const loadingMore = ref(false);
const retryAfterSeconds = ref(0);
const notice = ref('');
const slowRequest = ref(false);

let generation = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let authenticationRequired = false;

const hasMore = computed(() => orders.value.length < total.value);

function queryFor(tab: OrderTab, nextPage: number): StoreOrderListQuery {
  if (tab === 'PENDING_PAYMENT') {
    return { display_group: 'PENDING_PAYMENT', page: nextPage, page_size: 20 };
  }
  if (tab === 'CLOSED') return { order_status: 'CLOSED', page: nextPage, page_size: 20 };
  return { display_group: 'ALL', page: nextPage, page_size: 20 };
}

function requireLogin() {
  authenticationRequired = true;
  state.value = 'auth-required';
  clearCustomerSession();
  replaceWithLoginForAction({ type: 'ORDERS' });
}

function clearSlowTimer() {
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  slowTimer = undefined;
}

async function loadOrders(reset = true) {
  if (loadingMore.value) return;
  const currentGeneration = ++generation;
  const nextPage = reset ? 1 : page.value + 1;
  retryAfterSeconds.value = 0;
  notice.value = '';
  slowRequest.value = false;
  if (reset) {
    state.value = 'loading';
    orders.value = [];
    total.value = 0;
  } else {
    loadingMore.value = true;
  }
  clearSlowTimer();
  slowTimer = setTimeout(() => {
    if (generation === currentGeneration && (state.value === 'loading' || loadingMore.value)) {
      slowRequest.value = true;
    }
  }, 800);
  try {
    const result = await listStoreOrders(queryFor(activeTab.value, nextPage));
    if (generation !== currentGeneration) return;
    orders.value = reset ? result.items : [...orders.value, ...result.items];
    page.value = result.pagination.page;
    total.value = result.pagination.total;
    state.value = orders.value.length === 0 ? 'empty' : 'ready';
  } catch (error) {
    if (generation !== currentGeneration) return;
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      if (reset) state.value = 'rate-limited';
      else notice.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后继续加载。`;
    } else if (reset) {
      state.value = 'error';
    } else {
      notice.value = '下一页加载失败，已加载的订单会继续保留。';
    }
  } finally {
    if (generation === currentGeneration) {
      loadingMore.value = false;
      slowRequest.value = false;
      clearSlowTimer();
    }
  }
}

function selectTab(tab: OrderTab) {
  if (tab === activeTab.value || state.value === 'loading' || loadingMore.value) return;
  activeTab.value = tab;
  void loadOrders();
}

function createdAt(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function closeReason(order: StoreOrderListItem): string {
  if (order.close_reason === 'USER_CANCELLED') return '用户已取消';
  if (order.close_reason === 'PAYMENT_TIMEOUT') return '付款超时关闭';
  if (order.close_reason === 'FULL_REFUND_BEFORE_SHIPMENT') return '发货前全额退款关闭';
  return order.display_status;
}

onShow(() => {
  if (authenticationRequired) authenticationRequired = false;
  void loadOrders();
});

onUnload(() => {
  generation += 1;
  clearSlowTimer();
});
</script>

<template>
  <QxStoreShell>
    <view class="orders-page">
      <QxAccountHeader title="我的订单" />
      <view
        class="orders-tabs"
        role="tablist"
        aria-label="订单筛选"
      >
        <button
          v-for="tab in tabs"
          :key="tab.key"
          class="orders-tab"
          :class="{ 'orders-tab--active': activeTab === tab.key }"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :disabled="state === 'loading' || loadingMore"
          @click="selectTab(tab.key)"
        >
          {{ tab.label }}
        </button>
      </view>

      <QxCatalogState
        v-if="state === 'loading'"
        kind="loading"
        title="正在读取订单"
        :description="slowRequest ? '网络响应较慢，仍在读取本人订单。' : '正在读取最新订单状态。'"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        kind="empty"
        title="登录后查看订单"
        description="订单只对当前账户本人开放。"
        action-label="重新登录"
        @action="requireLogin"
      />
      <QxCatalogState
        v-else-if="state === 'empty'"
        kind="empty"
        title="暂无相关订单"
        description="当前筛选下还没有订单记录。"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="订单列表加载失败"
        description="暂时无法读取订单，请稍后重试。"
        action-label="重新加载"
        @action="loadOrders()"
      />

      <view
        v-else
        class="orders-page__body"
      >
        <text
          v-if="notice"
          class="orders-notice"
          role="status"
        >
          {{ notice }}
        </text>
        <article
          v-for="order in orders"
          :key="order.order_id"
          class="order-card"
        >
          <button
            class="order-card__heading"
            :aria-label="`查看订单 ${order.order_no}`"
            @click="openOrder(order.order_id)"
          >
            <view>
              <text class="order-card__number">
                {{ order.order_no }}
              </text>
              <text class="order-card__date">
                {{ createdAt(order.created_at) }}
              </text>
            </view>
            <text class="order-card__status">
              {{ closeReason(order) }}
            </text>
          </button>
          <button
            class="order-card__items"
            @click="openOrder(order.order_id)"
          >
            <view
              v-for="item in order.items.slice(0, 3)"
              :key="item.order_item_id"
              class="order-card__item"
            >
              <QxProductImage
                :src="item.primary_image_url"
                :alt="item.product_name"
                shape="square"
              />
              <view class="order-card__item-copy">
                <text>{{ item.product_name }}</text>
                <text>{{ item.sku_name }} · ×{{ item.quantity }}</text>
              </view>
              <text>¥{{ item.line_amount }}</text>
            </view>
            <text
              v-if="order.items.length > 3"
              class="order-card__more"
            >
              另有 {{ order.items.length - 3 }} 个规格
            </text>
          </button>
          <view class="order-card__footer">
            <text
              v-if="order.available_actions.includes('CANCEL')"
              class="order-card__available"
            >
              可取消
            </text>
            <text class="order-card__amount">
              应付 ¥{{ order.payable_amount }}
            </text>
            <button @click="openOrder(order.order_id)">
              查看详情
            </button>
          </view>
        </article>
        <button
          v-if="hasMore"
          class="orders-load-more"
          :disabled="loadingMore"
          @click="loadOrders(false)"
        >
          {{ loadingMore ? '正在加载…' : '加载更多' }}
        </button>
        <text
          v-else
          class="orders-end"
        >
          已显示全部订单
        </text>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.orders-page { min-height: 100vh; background: var(--qx-store-background); }
.orders-tabs { position: sticky; z-index: 18; top: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-bottom: 1px solid var(--qx-store-line); background: rgba(255,255,255,.98); }
.orders-tab { min-width: 0; min-height: 82rpx; border-bottom: 4rpx solid transparent !important; color: var(--qx-store-muted); background: transparent; font-size: 22rpx; }
.orders-tab--active { border-bottom-color: var(--qx-store-brand) !important; color: var(--qx-store-brand-strong); font-weight: 800; }
.orders-page__body { display: grid; gap: 16rpx; padding: 20rpx 20rpx calc(42rpx + env(safe-area-inset-bottom)); }
.orders-notice { display: block; padding: 18rpx 20rpx; border-radius: 9rpx; color: var(--qx-store-warning); background: #fff5df; font-size: 20rpx; line-height: 1.55; }
.order-card { min-width: 0; overflow: hidden; border: 1px solid var(--qx-store-line); border-radius: 12rpx; background: var(--qx-store-surface); }
.order-card__heading { display: flex; width: 100%; min-width: 0; align-items: center; justify-content: space-between; gap: 14rpx; padding: 20rpx 22rpx; border-bottom: 1px solid var(--qx-store-line); color: var(--qx-store-text); background: transparent; text-align: left; }
.order-card__heading view { min-width: 0; }
.order-card__number, .order-card__date { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.order-card__number { font-size: 21rpx; font-weight: 750; }
.order-card__date { margin-top: 6rpx; color: var(--qx-store-muted); font-size: 17rpx; }
.order-card__status { flex: 0 0 auto; color: var(--qx-store-brand-strong); font-size: 22rpx; font-weight: 750; }
.order-card__items { display: block; width: 100%; min-width: 0; padding: 0 22rpx; color: var(--qx-store-text); background: transparent; text-align: left; }
.order-card__item { display: grid; min-width: 0; grid-template-columns: 104rpx minmax(0, 1fr) auto; align-items: center; gap: 14rpx; padding: 16rpx 0; border-bottom: 1px solid var(--qx-store-line); }
.order-card__item-copy { min-width: 0; }
.order-card__item-copy text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.order-card__item-copy text:first-child { font-size: 22rpx; font-weight: 700; }
.order-card__item-copy text:last-child { margin-top: 6rpx; color: var(--qx-store-muted); font-size: 18rpx; }
.order-card__item > text { color: var(--qx-store-text-soft); font-size: 20rpx; }
.order-card__more { display: block; padding: 12rpx 0; color: var(--qx-store-muted); font-size: 18rpx; text-align: center; }
.order-card__footer { display: flex; min-width: 0; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 12rpx; padding: 16rpx 22rpx; }
.order-card__available { margin-right: auto; color: var(--qx-store-warning); font-size: 18rpx; }
.order-card__amount { min-width: 0; font-size: 22rpx; font-weight: 750; overflow-wrap: anywhere; }
.order-card__footer button { min-height: 58rpx; padding: 10rpx 20rpx; border: 1px solid var(--qx-store-brand) !important; border-radius: 8rpx; color: var(--qx-store-brand); background: #ffffff; font-size: 19rpx; }
.orders-load-more { width: 100%; min-height: 76rpx; border: 1px solid var(--qx-store-line) !important; border-radius: 9rpx; color: var(--qx-store-brand); background: #ffffff; font-size: 21rpx; }
.orders-end { display: block; padding: 20rpx; color: var(--qx-store-muted); font-size: 18rpx; text-align: center; }
@media (max-width: 359px) { .order-card__item { grid-template-columns: 88rpx minmax(0, 1fr); } .order-card__item > text { grid-column: 2; } }
</style>
