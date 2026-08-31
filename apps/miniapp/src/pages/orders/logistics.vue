<script setup lang="ts">
/* global uni */
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { ref } from 'vue';

import { getStoreOrder, getStoreOrderLogistics } from '../../api';
import { StoreApiError, StoreEnvelopeFormatError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreLogistics, StoreLogisticsEvent, StoreShipment } from '../../types/store-orders';
import { clearCustomerSession } from '../../utils/customer-session';
import { replaceWithLoginForAction } from '../../utils/protected-action';

type PageState = 'loading' | 'ready' | 'empty' | 'invalid' | 'not-found' |
  'auth-required' | 'error' | 'rate-limited';

interface ShipmentDisplayItem {
  order_item_id: string;
  product_name: string;
  quantity: number;
  sku_name: string;
}

const state = ref<PageState>('loading');
const orderId = ref('');
const logistics = ref<StoreLogistics | null>(null);
const shipmentItems = ref<ShipmentDisplayItem[]>([]);
const retryAfterSeconds = ref(0);
const slowRequest = ref(false);
const copyPending = ref(false);

let generation = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let authenticationRequired = false;

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

function clearSlowTimer() {
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  slowTimer = undefined;
}

function requireLogin() {
  authenticationRequired = true;
  state.value = 'auth-required';
  clearCustomerSession();
  replaceWithLoginForAction({ type: 'ORDER_LOGISTICS', order_id: orderId.value });
}

function mapShipmentItems(
  shipment: StoreShipment,
  order: Awaited<ReturnType<typeof getStoreOrder>>,
): ShipmentDisplayItem[] {
  if (order.order_id !== orderId.value || !order.available_actions.includes('VIEW_LOGISTICS')) {
    throw new StoreEnvelopeFormatError();
  }
  const orderItems = new Map<string, { product_name: string; sku_name: string }>();
  for (const item of order.items) {
    if (orderItems.has(item.order_item_id)) throw new StoreEnvelopeFormatError();
    orderItems.set(item.order_item_id, {
      product_name: item.product_name,
      sku_name: item.sku_name,
    });
  }
  return shipment.items.map((item) => {
    const orderItem = orderItems.get(item.order_item_id);
    if (!orderItem) throw new StoreEnvelopeFormatError();
    return {
      order_item_id: item.order_item_id,
      product_name: orderItem.product_name,
      quantity: item.quantity,
      sku_name: orderItem.sku_name,
    };
  });
}

async function loadLogistics() {
  if (!isUlid(orderId.value)) {
    state.value = 'invalid';
    return;
  }
  const currentGeneration = ++generation;
  state.value = 'loading';
  logistics.value = null;
  shipmentItems.value = [];
  retryAfterSeconds.value = 0;
  slowRequest.value = false;
  clearSlowTimer();
  slowTimer = setTimeout(() => {
    if (generation === currentGeneration && state.value === 'loading') slowRequest.value = true;
  }, 800);
  try {
    const result = await getStoreOrderLogistics(orderId.value);
    if (generation !== currentGeneration) return;
    if (result.shipment === null) {
      state.value = 'empty';
      return;
    }
    const order = await getStoreOrder(orderId.value);
    if (generation !== currentGeneration) return;
    const displayItems = mapShipmentItems(result.shipment, order);
    logistics.value = result;
    shipmentItems.value = displayItems;
    state.value = 'ready';
  } catch (error) {
    if (generation !== currentGeneration) return;
    logistics.value = null;
    shipmentItems.value = [];
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 404) {
      state.value = 'not-found';
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      state.value = 'rate-limited';
    } else {
      state.value = 'error';
    }
  } finally {
    if (generation === currentGeneration) {
      clearSlowTimer();
      slowRequest.value = false;
    }
  }
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function shipmentStatusText(status: StoreShipment['status']): string {
  if (status === 'SHIPPED') return '已发出';
  if (status === 'IN_TRANSIT') return '运输中';
  return '已送达';
}

function logisticsEventTitle(event: StoreLogisticsEvent): string {
  if (event.event_type === 'TRACKING_CORRECTION') return '承运信息已更新';
  if (event.status_code === 'SHIPPED') return '包裹已发出';
  if (event.status_code === 'IN_TRANSIT') return '包裹运输中';
  if (event.status_code === 'DELIVERED') return '包裹已送达';
  return '物流进度已更新';
}

function copyTrackingNumber() {
  const trackingNumber = logistics.value?.shipment?.tracking_no;
  if (!trackingNumber || copyPending.value) return;
  copyPending.value = true;
  uni.setClipboardData({
    data: trackingNumber,
    fail: () => {
      void uni.showToast({ icon: 'none', title: '复制失败，请稍后重试' });
    },
    success: () => {
      void uni.showToast({ icon: 'none', title: '运单号已复制' });
    },
    complete: () => {
      copyPending.value = false;
    },
  });
}

onLoad((query) => {
  orderId.value = typeof query?.order_id === 'string' ? query.order_id : '';
  if (!isUlid(orderId.value)) state.value = 'invalid';
});

onShow(() => {
  if (!isUlid(orderId.value)) return;
  if (authenticationRequired) authenticationRequired = false;
  void loadLogistics();
});

onUnload(() => {
  generation += 1;
  clearSlowTimer();
  logistics.value = null;
  shipmentItems.value = [];
});
</script>

<template>
  <QxStoreShell>
    <view
      class="logistics-page"
      data-testid="logistics-page"
    >
      <QxAccountHeader title="物流详情" />

      <QxCatalogState
        v-if="state === 'loading'"
        data-testid="logistics-state-loading"
        kind="loading"
        title="正在读取物流"
        :description="slowRequest ? '网络响应较慢，仍在读取本人订单物流。' : '正在读取最新人工物流节点。'"
      />
      <QxCatalogState
        v-else-if="state === 'invalid' || state === 'not-found'"
        data-testid="logistics-state-not-found"
        kind="empty"
        title="物流信息不存在"
        description="订单编号无效，或该订单不属于当前账户。"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        data-testid="logistics-state-auth-required"
        kind="empty"
        title="登录后查看物流"
        description="订单物流只对当前账户本人开放。"
        action-label="重新登录"
        @action="requireLogin"
      />
      <QxCatalogState
        v-else-if="state === 'empty'"
        data-testid="logistics-state-empty"
        kind="empty"
        title="暂无包裹信息"
        description="订单尚未建立包裹，不会伪造物流进度。"
        action-label="刷新"
        action-testid="logistics-refresh"
        @action="loadLogistics"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        :data-testid="state === 'rate-limited' ? 'logistics-state-rate-limited' : 'logistics-state-error'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="物流加载失败"
        description="暂时无法读取物流，请稍后重试。"
        action-label="重新加载"
        action-testid="logistics-retry"
        @action="loadLogistics"
      />

      <view
        v-else-if="state === 'ready' && logistics?.shipment"
        class="logistics-page__body"
        data-testid="logistics-state-ready"
      >
        <section class="shipment-summary">
          <view class="shipment-summary__heading">
            <view>
              <text class="shipment-summary__status">
                {{ shipmentStatusText(logistics.shipment.status) }}
              </text>
              <text class="shipment-summary__carrier">
                {{ logistics.shipment.carrier_name }}
              </text>
            </view>
            <button
              data-testid="logistics-refresh"
              @click="loadLogistics"
            >
              刷新
            </button>
          </view>
          <view class="shipment-summary__tracking">
            <view>
              <text>运单号</text>
              <text>{{ logistics.shipment.tracking_no }}</text>
            </view>
            <button
              data-testid="logistics-copy-tracking"
              :disabled="copyPending"
              @click="copyTrackingNumber"
            >
              {{ copyPending ? '复制中…' : '复制' }}
            </button>
          </view>
          <view class="shipment-summary__dates">
            <view>
              <text>发货时间</text><text>{{ formattedDate(logistics.shipment.shipped_at) }}</text>
            </view>
            <view v-if="logistics.shipment.delivered_at">
              <text>送达时间</text><text>{{ formattedDate(logistics.shipment.delivered_at) }}</text>
            </view>
          </view>
        </section>

        <section class="shipment-items">
          <text class="logistics-section-title">
            包裹商品
          </text>
          <view
            v-for="item in shipmentItems"
            :key="item.order_item_id"
            class="shipment-item"
            :data-testid="`logistics-item-${item.order_item_id}`"
          >
            <text>{{ item.product_name }}</text>
            <text>{{ item.sku_name }} · ×{{ item.quantity }}</text>
          </view>
        </section>

        <section
          class="shipment-timeline"
          data-testid="logistics-timeline"
        >
          <text class="logistics-section-title">
            物流进度
          </text>
          <view
            v-for="event in logistics.events"
            :key="event.event_id"
            class="shipment-event"
            :data-testid="`logistics-event-${event.event_id}`"
          >
            <view class="shipment-event__dot" />
            <view>
              <text class="shipment-event__title">
                {{ logisticsEventTitle(event) }}
              </text>
              <text class="shipment-event__description">
                {{ event.description }}
              </text>
              <text
                v-if="event.location"
                class="shipment-event__meta"
              >
                {{ event.location }}
              </text>
              <text class="shipment-event__meta">
                {{ formattedDate(event.occurred_at) }}
              </text>
            </view>
          </view>
          <text
            v-if="logistics.events.length === 0"
            class="shipment-timeline__empty"
          >
            包裹已建立，暂无后续人工物流节点。
          </text>
        </section>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.logistics-page { min-height: 100vh; background: var(--qx-store-background); }
.logistics-page__body { display: grid; gap: 18rpx; padding: 22rpx 22rpx calc(42rpx + env(safe-area-inset-bottom)); }
.shipment-summary, .shipment-items, .shipment-timeline { min-width: 0; padding: 24rpx; border: 1px solid var(--qx-store-line); border-radius: 12rpx; background: var(--qx-store-surface); }
.shipment-summary { display: grid; gap: 20rpx; }
.shipment-summary__heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 16rpx; }
.shipment-summary__heading > view { min-width: 0; }
.shipment-summary__status, .shipment-summary__carrier { display: block; overflow-wrap: anywhere; }
.shipment-summary__status { color: var(--qx-store-brand-strong); font-size: 31rpx; font-weight: 800; }
.shipment-summary__carrier { margin-top: 7rpx; color: var(--qx-store-muted); font-size: 19rpx; }
.shipment-summary__heading button, .shipment-summary__tracking button { flex: 0 0 auto; min-height: 58rpx; padding: 8rpx 18rpx; border: 1px solid var(--qx-store-brand) !important; border-radius: 8rpx; color: var(--qx-store-brand); background: #ffffff; font-size: 19rpx; }
.shipment-summary__tracking { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 14rpx; padding: 16rpx; border-radius: 8rpx; background: var(--qx-store-surface-soft); }
.shipment-summary__tracking view { min-width: 0; }
.shipment-summary__tracking text { display: block; overflow-wrap: anywhere; }
.shipment-summary__tracking text:first-child { color: var(--qx-store-muted); font-size: 17rpx; }
.shipment-summary__tracking text:last-child { margin-top: 5rpx; font-size: 21rpx; font-weight: 750; }
.shipment-summary__dates { display: grid; gap: 10rpx; }
.shipment-summary__dates view { display: grid; min-width: 0; grid-template-columns: 116rpx minmax(0, 1fr); gap: 12rpx; font-size: 19rpx; }
.shipment-summary__dates text:first-child { color: var(--qx-store-muted); }
.shipment-items { display: grid; gap: 10rpx; }
.logistics-section-title { display: block; margin-bottom: 8rpx; font-size: 24rpx; font-weight: 800; }
.shipment-item { display: grid; min-width: 0; gap: 4rpx; padding: 12rpx 0; border-top: 1px solid var(--qx-store-line); }
.shipment-item text { display: block; overflow-wrap: anywhere; }
.shipment-item text:first-child { font-size: 20rpx; font-weight: 750; }
.shipment-item text:last-child { color: var(--qx-store-text-soft); font-size: 18rpx; line-height: 1.5; }
.shipment-timeline { display: grid; gap: 0; }
.shipment-event { display: grid; min-width: 0; grid-template-columns: 24rpx minmax(0, 1fr); gap: 12rpx; padding: 16rpx 0 22rpx; }
.shipment-event:last-of-type { padding-bottom: 0; }
.shipment-event__dot { width: 16rpx; height: 16rpx; margin-top: 5rpx; border-radius: 50%; background: var(--qx-store-brand); }
.shipment-event text { display: block; overflow-wrap: anywhere; }
.shipment-event__title { font-size: 21rpx; font-weight: 750; }
.shipment-event__description { margin-top: 5rpx; color: var(--qx-store-text-soft); font-size: 19rpx; line-height: 1.5; }
.shipment-event__meta { margin-top: 4rpx; color: var(--qx-store-muted); font-size: 17rpx; }
.shipment-timeline__empty { padding-top: 12rpx; color: var(--qx-store-muted); font-size: 19rpx; line-height: 1.55; }
@media (max-width: 359px) { .shipment-summary__heading { align-items: flex-start; } .shipment-summary__dates view { grid-template-columns: 1fr; gap: 4rpx; } }
</style>
