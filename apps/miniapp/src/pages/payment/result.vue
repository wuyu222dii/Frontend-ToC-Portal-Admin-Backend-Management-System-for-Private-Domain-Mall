<script setup lang="ts">
/* global uni */
import { onHide, onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import { createIdempotencyKey, getStoreOrder, submitStoreMockPaymentResult } from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreOrderDetail } from '../../types/store-orders';
import type { MockPaymentResultInput } from '../../types/store-payments';
import { clearCustomerSession } from '../../utils/customer-session';
import {
  clearPaymentFlow,
  peekPaymentFlow,
  type PaymentFlowMemory,
} from '../../utils/payment-flow-memory';
import {
  derivePaymentOutcome,
  shouldPollPaymentOutcome,
  type PaymentOutcome,
} from '../../utils/payment-result';
import { replaceWithLoginForAction } from '../../utils/protected-action';
import { openOrders } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'invalid' | 'not-found' | 'auth-required' | 'error' | 'rate-limited';
const state = ref<PageState>('loading');
const orderId = ref('');
const order = ref<StoreOrderDetail | null>(null);
const message = ref('');
const retryAfterSeconds = ref(0);
const slowRequest = ref(false);
const mockPending = ref<MockPaymentResultInput['result'] | null>(null);
const paymentFlow = ref<PaymentFlowMemory | null>(null);

let active = false;
let generation = 0;
let requestInFlight = false;
let pollTimer: ReturnType<typeof setTimeout> | undefined;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
const mockIdempotencyKeys = new Map<MockPaymentResultInput['result'], string>();

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

const outcome = computed<PaymentOutcome>(() => {
  const current = order.value;
  return current === null ? 'processing' : derivePaymentOutcome(current);
});

const statusCopy = computed(() => {
  const copy: Record<PaymentOutcome, { title: string; description: string }> = {
    processing: {
      title: '正在确认支付结果',
      description: '请以服务端订单状态为准，页面会自动刷新。',
    },
    success: { title: '支付成功', description: '订单已进入待发货阶段。' },
    failed: { title: '支付未完成', description: '订单仍可支付时，可回到详情重新发起。' },
    cancelled: { title: '支付已取消', description: '本次支付未完成，请查看订单当前可用操作。' },
    closing: { title: '正在确认关单', description: '库存预占仍保持，待支付服务确认后更新。' },
    timeout: { title: '订单已超时', description: '付款时间已过，订单已关闭。' },
    refunding: { title: '迟到支付退款中', description: '订单保持关闭，正在原路全额退款。' },
    refunded: { title: '迟到支付已退款', description: '全额退款已完成，订单不会进入履约。' },
    manual: { title: '支付异常处理中', description: '请勿重复支付或取消，工作人员将核对处理。' },
  };
  return copy[outcome.value];
});

const shouldPoll = computed(() => shouldPollPaymentOutcome(outcome.value));
const showMockControls = computed(() => import.meta.env.DEV && paymentFlow.value !== null &&
  paymentFlow.value.provider_payload === null);

function clearTimers() {
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  pollTimer = undefined;
  slowTimer = undefined;
}

function schedulePoll(delay = 1_500) {
  if (!active || !shouldPoll.value) return;
  if (pollTimer !== undefined) clearTimeout(pollTimer);
  pollTimer = setTimeout(() => void loadOrder(true), delay);
}

function requireLogin() {
  active = false;
  clearTimers();
  state.value = 'auth-required';
  clearCustomerSession();
  replaceWithLoginForAction({ type: 'PAYMENT_RESULT', order_id: orderId.value });
}

async function loadOrder(background = false) {
  if (!isUlid(orderId.value) || requestInFlight) return;
  const currentGeneration = ++generation;
  requestInFlight = true;
  retryAfterSeconds.value = 0;
  if (!background) {
    state.value = 'loading';
    message.value = '';
    slowRequest.value = false;
    slowTimer = setTimeout(() => {
      if (generation === currentGeneration && state.value === 'loading') slowRequest.value = true;
    }, 800);
  }
  try {
    const next = await getStoreOrder(orderId.value);
    if (generation !== currentGeneration) return;
    order.value = next;
    state.value = 'ready';
    message.value = '';
    if (!shouldPoll.value) {
      clearPaymentFlow(orderId.value);
      paymentFlow.value = null;
    }
    schedulePoll();
  } catch (error) {
    if (generation !== currentGeneration) return;
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 404) {
      state.value = 'not-found';
      order.value = null;
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      if (background && order.value !== null) {
        message.value = `刷新较频繁，将在 ${retryAfterSeconds.value} 秒后重试。`;
        schedulePoll(retryAfterSeconds.value * 1_000);
      } else {
        state.value = 'rate-limited';
      }
    } else if (background && order.value !== null) {
      message.value = '网络暂时中断，当前结果未确认，页面将继续重试。';
      schedulePoll(3_000);
    } else {
      state.value = 'error';
    }
  } finally {
    requestInFlight = false;
    if (generation === currentGeneration) {
      if (slowTimer !== undefined) clearTimeout(slowTimer);
      slowTimer = undefined;
      slowRequest.value = false;
    }
  }
}

async function submitMockResult(result: MockPaymentResultInput['result']) {
  const currentFlow = paymentFlow.value;
  if (!showMockControls.value || currentFlow === null || mockPending.value !== null) return;
  mockPending.value = result;
  const idempotencyKey = mockIdempotencyKeys.get(result) ?? createIdempotencyKey();
  mockIdempotencyKeys.set(result, idempotencyKey);
  try {
    await submitStoreMockPaymentResult(currentFlow.payment_intent_id, { result }, idempotencyKey);
    message.value = '模拟结果已提交，正在等待服务端处理。';
    await loadOrder(true);
  } catch (error) {
    if (error instanceof StoreApiError && [400, 401, 403, 404, 409, 422].includes(error.status)) {
      mockIdempotencyKeys.delete(result);
    }
    if (error instanceof StoreApiError && error.status === 401) requireLogin();
    else message.value = '模拟结果暂时无法确认，可使用同一选项重试。';
  } finally {
    mockPending.value = null;
  }
}

function viewOrder() {
  void uni.navigateBack({
    fail: () => {
      void uni.redirectTo({
        url: `/pages/orders/detail?order_id=${encodeURIComponent(orderId.value)}`,
      });
    },
  });
}

onLoad((query) => {
  orderId.value = typeof query?.order_id === 'string' ? query.order_id : '';
  if (!isUlid(orderId.value)) state.value = 'invalid';
});

onShow(() => {
  if (!isUlid(orderId.value)) return;
  active = true;
  paymentFlow.value = peekPaymentFlow(orderId.value);
  void loadOrder();
});

onHide(() => {
  active = false;
  clearTimers();
});

onUnload(() => {
  active = false;
  generation += 1;
  clearTimers();
});
</script>

<template>
  <QxStoreShell>
    <view class="payment-result-page">
      <QxAccountHeader title="支付结果" />

      <QxCatalogState
        v-if="state === 'loading'"
        kind="loading"
        title="正在查询支付结果"
        :description="slowRequest ? '网络响应较慢，仍在读取服务端订单状态。' : '正在读取订单、支付和退款状态。'"
      />
      <QxCatalogState
        v-else-if="state === 'invalid' || state === 'not-found'"
        kind="empty"
        title="订单不存在"
        description="订单编号无效，或该订单不属于当前账户。"
        action-label="返回订单列表"
        @action="openOrders"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        kind="empty"
        title="登录后确认结果"
        description="支付结果只对当前订单所有者开放。"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="支付结果暂时无法确认"
        description="请勿根据客户端提示重复支付，请重新查询服务端状态。"
        action-label="重新查询"
        @action="loadOrder()"
      />

      <view
        v-else-if="state === 'ready' && order"
        class="payment-result-page__body"
      >
        <section
          class="payment-result-status"
          :data-outcome="outcome"
        >
          <view
            class="payment-result-status__icon"
            aria-hidden="true"
          >
            {{ outcome === 'success' || outcome === 'refunded' ? '✓' : outcome === 'processing' || outcome === 'closing' || outcome === 'refunding' ? '…' : '!' }}
          </view>
          <text class="payment-result-status__title">
            {{ statusCopy.title }}
          </text>
          <text class="payment-result-status__description">
            {{ statusCopy.description }}
          </text>
          <text class="payment-result-status__order">
            {{ order.order_no }} · ¥{{ order.amounts.payable }}
          </text>
        </section>

        <text
          v-if="message"
          class="payment-result-notice"
          role="status"
        >
          {{ message }}
        </text>

        <section
          v-if="order.errors.length"
          class="payment-result-errors"
          aria-label="安全错误说明"
        >
          <text
            v-for="entry in order.errors"
            :key="`${entry.error_code}:${entry.occurred_at}`"
          >
            {{ entry.message }}
          </text>
        </section>

        <section
          v-if="showMockControls"
          class="payment-result-mock"
          aria-label="开发测试支付结果"
        >
          <text class="payment-result-mock__title">
            Development Mock
          </text>
          <view class="payment-result-mock__actions">
            <button
              :disabled="mockPending !== null"
              @click="submitMockResult('SUCCEEDED')"
            >
              成功
            </button>
            <button
              :disabled="mockPending !== null"
              @click="submitMockResult('FAILED')"
            >
              失败
            </button>
            <button
              :disabled="mockPending !== null"
              @click="submitMockResult('CANCELLED')"
            >
              取消
            </button>
          </view>
        </section>

        <view class="payment-result-actions">
          <button
            class="payment-result-actions__primary"
            @click="viewOrder"
          >
            查看订单详情
          </button>
          <button @click="loadOrder()">
            刷新状态
          </button>
        </view>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.payment-result-page { min-height: 100vh; background: var(--qx-store-background); }
.payment-result-page__body { display: grid; gap: 20rpx; padding: 28rpx 22rpx calc(48rpx + env(safe-area-inset-bottom)); }
.payment-result-status { display: flex; min-width: 0; flex-direction: column; align-items: center; padding: 46rpx 26rpx 38rpx; border-bottom: 1px solid var(--qx-store-line); text-align: center; }
.payment-result-status__icon { display: flex; width: 86rpx; height: 86rpx; align-items: center; justify-content: center; border: 2px solid var(--qx-store-brand); border-radius: 50%; color: var(--qx-store-brand-strong); font-size: 42rpx; font-weight: 800; }
.payment-result-status[data-outcome="failed"] .payment-result-status__icon,
.payment-result-status[data-outcome="cancelled"] .payment-result-status__icon,
.payment-result-status[data-outcome="timeout"] .payment-result-status__icon,
.payment-result-status[data-outcome="manual"] .payment-result-status__icon { color: var(--qx-store-danger); border-color: var(--qx-store-danger); }
.payment-result-status__title { margin-top: 22rpx; font-size: 34rpx; font-weight: 800; }
.payment-result-status__description { max-width: 620rpx; margin-top: 12rpx; color: var(--qx-store-text-soft); font-size: 21rpx; line-height: 1.6; overflow-wrap: anywhere; }
.payment-result-status__order { margin-top: 20rpx; color: var(--qx-store-muted); font-size: 18rpx; overflow-wrap: anywhere; }
.payment-result-notice, .payment-result-errors { display: block; padding: 18rpx 20rpx; border-radius: 8rpx; color: var(--qx-store-warning); background: #fff5df; font-size: 20rpx; line-height: 1.55; overflow-wrap: anywhere; }
.payment-result-errors { display: grid; gap: 8rpx; color: var(--qx-store-danger); background: #fff2f1; }
.payment-result-errors text { display: block; }
.payment-result-mock { padding: 20rpx; border: 1px dashed var(--qx-store-line); border-radius: 8rpx; background: var(--qx-store-surface); }
.payment-result-mock__title { display: block; color: var(--qx-store-muted); font-size: 18rpx; font-weight: 750; }
.payment-result-mock__actions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10rpx; margin-top: 14rpx; }
.payment-result-mock button { min-width: 0; min-height: 64rpx; padding: 0 8rpx; border: 1px solid var(--qx-store-line) !important; border-radius: 8rpx; background: #ffffff; font-size: 19rpx; }
.payment-result-actions { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, .72fr); gap: 12rpx; }
.payment-result-actions button { min-width: 0; min-height: 76rpx; border: 1px solid var(--qx-store-line) !important; border-radius: 9rpx; color: var(--qx-store-text); background: #ffffff; font-size: 21rpx; font-weight: 750; }
.payment-result-actions__primary { color: #ffffff !important; border-color: var(--qx-store-brand-strong) !important; background: var(--qx-store-brand-strong) !important; }
@media (max-width: 359px) { .payment-result-page__body { padding-inline: 16rpx; } .payment-result-actions { grid-template-columns: 1fr; } }
</style>
