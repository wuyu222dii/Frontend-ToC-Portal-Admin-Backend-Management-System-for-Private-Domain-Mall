<script setup lang="ts">
/* global uni */
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import {
  cancelStoreOrder,
  confirmStoreOrderReceipt,
  createIdempotencyKey,
  getStoreOrder,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { StoreOrderDetail, StoreOrderPackage } from '../../types/store-orders';
import type { PaymentProviderCapability } from '../../types/store-payments';
import { clearCustomerSession } from '../../utils/customer-session';
import { rememberPaymentFlow } from '../../utils/payment-flow-memory';
import {
  PaymentSubmitJournalError,
  executePaymentSubmitJournal,
  loadPaymentSubmitJournal,
  preparePaymentSubmitJournal,
  type PaymentSubmitJournal,
} from '../../utils/payment-submit-journal';
import { replaceWithLoginForAction } from '../../utils/protected-action';
import { openOrderLogistics, openPaymentResult } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'invalid' | 'not-found' | 'auth-required' | 'error' | 'rate-limited';

const state = ref<PageState>('loading');
const orderId = ref('');
const order = ref<StoreOrderDetail | null>(null);
const retryAfterSeconds = ref(0);
const message = ref('');
const slowRequest = ref(false);
const cancelPending = ref(false);
const paymentPending = ref(false);
const pendingPaymentJournal = ref<PaymentSubmitJournal | null>(null);
const remainingSeconds = ref(0);
const receiptPending = ref(false);
const receiptConfirmationOpen = ref(false);

let generation = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let localPayDeadline = 0;
let authenticationRequired = false;
let cancelCommand: { fingerprint: string; idempotencyKey: string } | null = null;
let receiptCommand: { fingerprint: string; idempotencyKey: string } | null = null;

const commandPending = computed(() => cancelPending.value || paymentPending.value || receiptPending.value);
const canCancel = computed(() => order.value?.available_actions.includes('CANCEL') === true &&
  remainingSeconds.value > 0 && !commandPending.value);
const hasPendingPayment = computed(() => pendingPaymentJournal.value?.order_id === orderId.value);
const canPay = computed(() => order.value?.available_actions.includes('PAY') === true &&
  remainingSeconds.value > 0 && !commandPending.value && !hasPendingPayment.value);
const canRetryPayment = computed(() => hasPendingPayment.value && !commandPending.value);
const canConfirmReceipt = computed(() =>
  order.value?.available_actions.includes('CONFIRM_RECEIPT') === true && !commandPending.value);
const hasLogisticsSurface = computed(() =>
  order.value?.available_actions.includes('VIEW_LOGISTICS') === true);
const primaryPackage = computed(() => order.value?.packages[0] ?? null);
const hasOrderActions = computed(() => order.value !== null && (
  order.value.available_actions.includes('PAY') ||
  order.value.available_actions.includes('CANCEL') ||
  order.value.available_actions.includes('CONFIRM_RECEIPT') || hasPendingPayment.value
));
const paymentButtonText = computed(() => {
  if (paymentPending.value) return '正在确认…';
  if (hasPendingPayment.value) return '继续确认支付请求';
  return order.value?.payment_attempts.length ? '继续支付' : '支付订单';
});
const countdownText = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60);
  const seconds = remainingSeconds.value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});
const actionHint = computed(() => order.value?.available_actions.includes('CONFIRM_RECEIPT') === true
  ? '请核对包裹信息后确认收货'
  : remainingSeconds.value > 0
    ? `付款剩余 ${countdownText.value}`
    : '付款期限已到，请刷新状态');

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

function clearTimers() {
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  slowTimer = undefined;
  countdownTimer = undefined;
}

function updateCountdown() {
  remainingSeconds.value = Math.max(0, Math.ceil((localPayDeadline - Date.now()) / 1_000));
  if (remainingSeconds.value === 0 && countdownTimer !== undefined) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
  }
}

function startCountdown(next: StoreOrderDetail) {
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  localPayDeadline = Date.now() + Math.max(0, Date.parse(next.pay_expires_at) - Date.parse(next.server_time));
  updateCountdown();
  if (remainingSeconds.value > 0) countdownTimer = setInterval(updateCountdown, 1_000);
}

function refreshPendingPaymentJournal() {
  try {
    pendingPaymentJournal.value = loadPaymentSubmitJournal();
  } catch (error) {
    pendingPaymentJournal.value = null;
    if (error instanceof PaymentSubmitJournalError) {
      message.value = '无法安全读取待处理支付请求，请检查本地存储后重试。';
    }
  }
}

function requireLogin() {
  authenticationRequired = true;
  state.value = 'auth-required';
  clearCustomerSession();
  replaceWithLoginForAction({ type: 'ORDER_DETAIL', order_id: orderId.value });
}

async function loadOrder(successMessage = '') {
  if (!isUlid(orderId.value)) {
    if (!isUlid(orderId.value)) state.value = 'invalid';
    return;
  }
  const currentGeneration = ++generation;
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  message.value = '';
  slowRequest.value = false;
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  slowTimer = setTimeout(() => {
    if (generation === currentGeneration && state.value === 'loading') slowRequest.value = true;
  }, 800);
  try {
    const next = await getStoreOrder(orderId.value);
    if (generation !== currentGeneration) return;
    order.value = next;
    state.value = 'ready';
    message.value = successMessage;
    startCountdown(next);
    refreshPendingPaymentJournal();
  } catch (error) {
    if (generation !== currentGeneration) return;
    order.value = null;
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
      if (slowTimer !== undefined) clearTimeout(slowTimer);
      slowTimer = undefined;
      slowRequest.value = false;
    }
  }
}

function formattedDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function closeReason(next: StoreOrderDetail): string {
  if (next.close_reason === 'USER_CANCELLED') return '用户取消订单';
  if (next.close_reason === 'PAYMENT_TIMEOUT') return '付款超时关闭';
  if (next.close_reason === 'FULL_REFUND_BEFORE_SHIPMENT') return '发货前全额退款关闭';
  if (next.completion_reason === 'CUSTOMER_CONFIRMED') return '已确认收货';
  if (next.completion_reason === 'ADMIN_FORCED') return '已由总部完成履约';
  if (next.completion_reason === 'FULL_REFUND_AFTER_SHIPMENT') return '发货后全额退款已完成';
  return next.display_status;
}

function timelineTitle(event: StoreOrderDetail['timeline'][number]): string {
  if (event.event === 'ORDER_CREATED') return '订单已创建';
  if (event.event === 'USER_CANCELLED') return '订单已取消';
  if (event.event === 'PAYMENT_TIMEOUT') return '付款超时关闭';
  if (event.event === 'SHIPMENT_SHIPPED') return '包裹已发出';
  if (event.event === 'SHIPMENT_IN_TRANSIT') return '包裹运输中';
  if (event.event === 'SHIPMENT_DELIVERED') return '包裹已送达';
  if (event.event === 'TRACKING_CORRECTION') return '承运信息已更新';
  return event.event.replaceAll('_', ' ');
}

function shipmentStatusText(status: StoreOrderPackage['status']): string {
  if (status === 'SHIPPED') return '已发出';
  if (status === 'IN_TRANSIT') return '运输中';
  return '已送达';
}

function latestPaymentText(next: StoreOrderDetail): string {
  const attempt = next.payment_attempts.at(-1);
  if (attempt === undefined) return '尚未发起支付';
  if (attempt.status === 'SUCCEEDED') return '支付已确认';
  if (attempt.status === 'SUCCEEDED_LATE') return '迟到支付已收到，正在处理退款';
  if (attempt.status === 'FAILED') return '支付未完成，可重新发起';
  if (attempt.status === 'CANCELLED') return '已取消本次支付';
  return '正在确认支付结果';
}

function latestRefundText(next: StoreOrderDetail): string {
  const refund = next.refund_attempts.at(-1);
  if (refund?.status === 'SUCCEEDED') return '迟到支付已全额退款';
  if (refund?.status === 'FAILED') return '迟到支付退款异常，正在人工处理';
  return '迟到支付正在全额退款';
}

function invokeProviderCapability(capability: PaymentProviderCapability | null): Promise<void> {
  if (capability === null) return Promise.resolve();
  let completion = Promise.resolve();
  // #ifdef MP-WEIXIN
  completion = new Promise((resolve) => {
    uni.requestPayment({
      provider: 'wxpay',
      timeStamp: capability.time_stamp,
      nonceStr: capability.nonce_str,
      package: capability.package,
      signType: capability.sign_type,
      paySign: capability.pay_sign,
      complete: () => resolve(),
    });
  });
  // #endif
  return completion;
}

async function performPayment() {
  const current = order.value;
  if (current === null || commandPending.value || (!canPay.value && !canRetryPayment.value)) return;
  paymentPending.value = true;
  message.value = '';
  try {
    const journal = pendingPaymentJournal.value ??
      preparePaymentSubmitJournal(current.order_id, current.version);
    pendingPaymentJournal.value = journal;
    const intent = await executePaymentSubmitJournal(journal);
    pendingPaymentJournal.value = null;
    rememberPaymentFlow(current.order_id, intent);
    await invokeProviderCapability(intent.provider_payload);
    openPaymentResult(current.order_id);
  } catch (error) {
    refreshPendingPaymentJournal();
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 404) {
      state.value = 'not-found';
      order.value = null;
    } else if (error instanceof StoreApiError && error.status === 409) {
      await loadOrder('订单或支付状态已变化，已刷新详情；如仍可支付，请重新确认。');
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后使用当前支付请求重试。`;
    } else if (error instanceof StoreApiError && [400, 403, 422].includes(error.status)) {
      await loadOrder('当前支付条件不再满足，已刷新订单状态。');
    } else if (error instanceof PaymentSubmitJournalError && error.code === 'PENDING_COMMAND') {
      message.value = '已有另一笔支付请求等待确认，请返回对应订单继续。';
    } else if (error instanceof PaymentSubmitJournalError) {
      message.value = '无法安全保存支付重试信息，本次未发起支付。';
    } else {
      message.value = '支付请求结果暂时无法确认，请使用同一按钮继续确认，不要重复下单。';
    }
  } finally {
    paymentPending.value = false;
  }
}

async function performCancel() {
  const current = order.value;
  if (current === null || cancelPending.value || !canCancel.value) return;
  const fingerprint = `${current.order_id}:${current.version}`;
  if (cancelCommand?.fingerprint !== fingerprint) {
    cancelCommand = { fingerprint, idempotencyKey: createIdempotencyKey() };
  }
  cancelPending.value = true;
  message.value = '';
  try {
    const result = await cancelStoreOrder(current.order_id, current.version, cancelCommand.idempotencyKey);
    cancelCommand = null;
    await loadOrder(result.order_status === 'CLOSED'
      ? '订单已取消，服务端已确认关闭。'
      : '正在向支付服务确认关单，订单和库存预占仍保持，请稍后刷新。');
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      cancelCommand = null;
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 404) {
      cancelCommand = null;
      state.value = 'not-found';
      order.value = null;
    } else if (error instanceof StoreApiError && error.status === 409) {
      cancelCommand = null;
      const copy = error.code === 'ORDER_NOT_CANCELLABLE'
        ? '订单当前已不可取消，已刷新最新状态。'
        : '订单版本已变化，已刷新详情；如仍可取消，请重新确认。';
      await loadOrder(copy);
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后使用同一取消操作重试。`;
    } else if (error instanceof StoreApiError && [400, 403, 422].includes(error.status)) {
      cancelCommand = null;
      await loadOrder('取消条件不再满足，已刷新最新状态。');
    } else {
      message.value = '取消结果暂时无法确认，请使用当前页面的同一操作重试。';
    }
  } finally {
    cancelPending.value = false;
  }
}

function confirmCancel() {
  if (!canCancel.value) return;
  void uni.showModal({
    cancelText: '保留订单',
    confirmColor: '#b84848',
    confirmText: '确认取消',
    content: '将请求取消订单。如已有支付请求，需要等待支付服务确认关单后才会释放库存。',
    title: '取消待付款订单',
    success: (result) => {
      if (result.confirm) void performCancel();
    },
  });
}

async function performConfirmReceipt() {
  const current = order.value;
  if (current === null || receiptPending.value || !canConfirmReceipt.value) return;
  const fingerprint = `${current.order_id}:${current.version}`;
  if (receiptCommand?.fingerprint !== fingerprint) {
    receiptCommand = { fingerprint, idempotencyKey: createIdempotencyKey() };
  }
  receiptConfirmationOpen.value = false;
  receiptPending.value = true;
  message.value = '';
  try {
    const result = await confirmStoreOrderReceipt(
      current.order_id,
      current.version,
      receiptCommand.idempotencyKey,
    );
    receiptCommand = null;
    order.value = result;
    state.value = 'ready';
    message.value = '已确认收货，订单状态已由服务端更新。';
    startCountdown(result);
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      receiptCommand = null;
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 404) {
      receiptCommand = null;
      state.value = 'not-found';
      order.value = null;
    } else if (error instanceof StoreApiError && error.status === 409) {
      receiptCommand = null;
      await loadOrder('订单状态已变化，已刷新；请根据最新状态重新点击确认收货。');
    } else if (error instanceof StoreApiError && [400, 403, 422].includes(error.status)) {
      receiptCommand = null;
      await loadOrder('当前收货条件不再满足，已刷新最新状态。');
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后使用当前确认收货操作重试。`;
    } else {
      message.value = '确认收货结果暂时无法确认，请使用当前页面的同一操作重试。';
    }
  } finally {
    receiptPending.value = false;
  }
}

function openReceiptConfirmation() {
  if (!canConfirmReceipt.value) return;
  receiptConfirmationOpen.value = true;
}

function closeReceiptConfirmation() {
  if (receiptPending.value) return;
  receiptConfirmationOpen.value = false;
}

onLoad((query) => {
  orderId.value = typeof query?.order_id === 'string' ? query.order_id : '';
  if (!isUlid(orderId.value)) state.value = 'invalid';
});

onShow(() => {
  if (!isUlid(orderId.value)) return;
  if (authenticationRequired) authenticationRequired = false;
  void loadOrder();
});

onUnload(() => {
  generation += 1;
  clearTimers();
});
</script>

<template>
  <QxStoreShell>
    <view class="order-detail-page">
      <QxAccountHeader title="订单详情" />

      <QxCatalogState
        v-if="state === 'loading'"
        data-testid="order-detail-state-loading"
        kind="loading"
        title="正在读取订单"
        :description="slowRequest ? '网络响应较慢，仍在读取本人订单详情。' : '正在读取订单、地址和状态时间线。'"
      />
      <QxCatalogState
        v-else-if="state === 'invalid' || state === 'not-found'"
        data-testid="order-detail-state-not-found"
        kind="empty"
        title="订单不存在"
        description="订单编号无效，或该订单不属于当前账户。"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        data-testid="order-detail-state-auth-required"
        kind="empty"
        title="登录后查看订单"
        description="订单详情只对当前账户本人开放。"
        action-label="重新登录"
        @action="requireLogin"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        :data-testid="state === 'rate-limited' ? 'order-detail-state-rate-limited' : 'order-detail-state-error'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="订单详情加载失败"
        description="暂时无法读取订单，请稍后重试。"
        action-label="重新加载"
        @action="loadOrder()"
      />

      <view
        v-else-if="state === 'ready' && order"
        class="order-detail-page__body"
        data-testid="order-detail-state-ready"
      >
        <text
          v-if="message"
          class="order-detail-notice"
          role="status"
        >
          {{ message }}
        </text>

        <section class="order-status-panel">
          <view>
            <text class="order-status-panel__status">
              {{ order.display_status }}
            </text>
            <text class="order-status-panel__number">
              {{ order.order_no }}
            </text>
          </view>
          <view
            v-if="order.order_status === 'PENDING_PAYMENT'"
            class="order-status-panel__countdown"
          >
            <text>{{ remainingSeconds > 0 ? '付款剩余' : '付款期限已到' }}</text>
            <text v-if="remainingSeconds > 0">
              {{ countdownText }}
            </text>
          </view>
          <text
            v-else
            class="order-status-panel__reason"
          >
            {{ closeReason(order) }}
          </text>
        </section>

        <section
          class="order-detail-panel"
          aria-label="冻结收货地址"
        >
          <text class="order-detail-panel__title">
            收货地址
          </text>
          <text class="order-address__person">
            {{ order.shipping_address.recipient_name }} · {{ order.shipping_address.phone }}
          </text>
          <text class="order-address__detail">
            {{ order.shipping_address.province }} {{ order.shipping_address.city }} {{ order.shipping_address.district }} {{ order.shipping_address.detail }}
          </text>
        </section>

        <section
          class="order-detail-panel"
          aria-label="订单商品"
        >
          <text class="order-detail-panel__title">
            商品明细
          </text>
          <article
            v-for="item in order.items"
            :key="item.order_item_id"
            class="order-detail-item"
          >
            <view
              class="order-detail-item__placeholder"
              aria-hidden="true"
            >
              商品
            </view>
            <view class="order-detail-item__body">
              <text class="order-detail-item__name">
                {{ item.product_name }}
              </text>
              <text class="order-detail-item__sku">
                {{ item.sku_name }} · ×{{ item.quantity }}
              </text>
              <view class="order-detail-item__amount">
                <text>¥{{ item.unit_price }}</text><text>小计 ¥{{ item.line_amount }}</text>
              </view>
            </view>
          </article>
        </section>

        <section
          class="order-detail-panel order-detail-amounts"
          aria-label="订单金额"
        >
          <view><text>商品金额</text><text>¥{{ order.amounts.goods }}</text></view>
          <view><text>运费</text><text>¥{{ order.amounts.shipping }}</text></view>
          <view class="order-detail-amounts__total">
            <text>应付金额</text><text>¥{{ order.amounts.payable }}</text>
          </view>
        </section>

        <section
          v-if="hasLogisticsSurface"
          class="order-detail-panel order-logistics"
          aria-label="物流信息"
          data-testid="order-logistics-section"
        >
          <view class="order-logistics__heading">
            <text class="order-detail-panel__title">
              物流信息
            </text>
            <text v-if="primaryPackage">
              {{ shipmentStatusText(primaryPackage.status) }}
            </text>
          </view>
          <view
            v-if="primaryPackage"
            class="order-logistics__summary"
          >
            <view>
              <text>承运方</text>
              <text>{{ primaryPackage.carrier_name }}</text>
            </view>
            <view>
              <text>运单号</text>
              <text>{{ primaryPackage.tracking_no }}</text>
            </view>
            <view v-if="primaryPackage.shipped_at">
              <text>发货时间</text>
              <text>{{ formattedDate(primaryPackage.shipped_at) }}</text>
            </view>
          </view>
          <text
            v-else
            class="order-logistics__empty"
          >
            包裹详情正在同步，可进入物流页刷新。
          </text>
          <button
            class="order-logistics__open"
            data-testid="order-logistics-open"
            @click="openOrderLogistics(order.order_id)"
          >
            查看完整物流
          </button>
        </section>

        <section
          v-if="order.payment_attempts.length || order.refund_attempts.length || order.errors.length"
          class="order-detail-panel payment-status-detail"
          aria-label="支付处理状态"
        >
          <text class="order-detail-panel__title">
            支付处理
          </text>
          <text class="payment-status-detail__summary">
            {{ latestPaymentText(order) }}
          </text>
          <text
            v-if="order.refund_attempts.length"
            class="payment-status-detail__line"
          >
            {{ latestRefundText(order) }}
          </text>
          <text
            v-for="entry in order.errors"
            :key="`${entry.error_code}:${entry.occurred_at}`"
            class="payment-status-detail__error"
          >
            {{ entry.message }}
          </text>
        </section>

        <section
          class="order-detail-panel"
          aria-label="订单进度"
        >
          <text class="order-detail-panel__title">
            订单进度
          </text>
          <view class="order-timeline">
            <view
              v-for="event in order.timeline"
              :key="event.event_id"
              class="order-timeline__event"
            >
              <view class="order-timeline__dot" />
              <view>
                <text>{{ timelineTitle(event) }}</text>
                <text>{{ formattedDate(event.occurred_at) }}</text>
              </view>
            </view>
          </view>
        </section>
      </view>

      <view
        v-if="state === 'ready' && order && hasOrderActions"
        class="order-detail-actions"
      >
        <text>{{ actionHint }}</text>
        <view class="order-detail-actions__commands">
          <button
            v-if="order.available_actions.includes('CANCEL')"
            class="order-detail-actions__cancel"
            :disabled="!canCancel"
            @click="confirmCancel"
          >
            {{ cancelPending ? '正在取消…' : '取消订单' }}
          </button>
          <button
            v-if="order.available_actions.includes('PAY') || hasPendingPayment"
            class="order-detail-actions__pay"
            :disabled="!canPay && !canRetryPayment"
            @click="performPayment"
          >
            {{ paymentButtonText }}
          </button>
          <button
            v-if="order.available_actions.includes('CONFIRM_RECEIPT')"
            class="order-detail-actions__receipt"
            data-testid="confirm-receipt-button"
            :disabled="!canConfirmReceipt"
            @click="openReceiptConfirmation"
          >
            {{ receiptPending ? '正在确认…' : '确认收货' }}
          </button>
        </view>
      </view>

      <view
        v-if="receiptConfirmationOpen"
        class="receipt-confirmation"
        data-testid="confirm-receipt-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="确认收货"
        @click.self="closeReceiptConfirmation"
      >
        <view class="receipt-confirmation__panel">
          <text class="receipt-confirmation__title">
            确认已收到商品？
          </text>
          <text class="receipt-confirmation__copy">
            确认后订单将完成，请先核对包裹和商品。系统不会自动确认收货。
          </text>
          <view class="receipt-confirmation__actions">
            <button
              data-testid="confirm-receipt-dialog-cancel"
              :disabled="receiptPending"
              @click="closeReceiptConfirmation"
            >
              暂不确认
            </button>
            <button
              class="receipt-confirmation__submit"
              data-testid="confirm-receipt-dialog-submit"
              :disabled="receiptPending"
              @click="performConfirmReceipt"
            >
              {{ receiptPending ? '正在提交…' : '确认收货' }}
            </button>
          </view>
        </view>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.order-detail-page { min-height: 100vh; padding-bottom: calc(124rpx + env(safe-area-inset-bottom)); background: var(--qx-store-background); }
.order-detail-page__body { display: grid; gap: 18rpx; padding: 22rpx 22rpx 42rpx; }
.order-detail-notice { display: block; padding: 18rpx 20rpx; border-radius: 9rpx; color: var(--qx-store-warning); background: #fff5df; font-size: 20rpx; line-height: 1.55; }
.order-status-panel { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 18rpx; padding: 28rpx; border-radius: 12rpx; color: #ffffff; background: var(--qx-store-brand-strong); }
.order-status-panel > view:first-child { min-width: 0; }
.order-status-panel__status, .order-status-panel__number, .order-status-panel__countdown text { display: block; }
.order-status-panel__status { font-size: 34rpx; font-weight: 800; }
.order-status-panel__number { margin-top: 8rpx; overflow: hidden; color: #d9e6df; font-size: 18rpx; text-overflow: ellipsis; white-space: nowrap; }
.order-status-panel__countdown { flex: 0 0 auto; text-align: right; }
.order-status-panel__countdown text:first-child { font-size: 18rpx; }
.order-status-panel__countdown text:last-child { margin-top: 5rpx; font-size: 28rpx; font-weight: 800; }
.order-status-panel__reason { max-width: 44%; font-size: 20rpx; line-height: 1.45; text-align: right; overflow-wrap: anywhere; }
.order-detail-panel { min-width: 0; padding: 24rpx; border: 1px solid var(--qx-store-line); border-radius: 12rpx; background: var(--qx-store-surface); }
.order-detail-panel__title { display: block; margin-bottom: 18rpx; font-size: 24rpx; font-weight: 800; }
.order-address__person, .order-address__detail { display: block; overflow-wrap: anywhere; }
.order-address__person { font-size: 24rpx; font-weight: 750; }
.order-address__detail { margin-top: 10rpx; color: var(--qx-store-text-soft); font-size: 21rpx; line-height: 1.6; }
.order-detail-item { display: grid; min-width: 0; grid-template-columns: 112rpx minmax(0, 1fr); gap: 16rpx; padding: 18rpx 0; border-bottom: 1px solid var(--qx-store-line); }
.order-detail-item:last-child { padding-bottom: 0; border-bottom: 0; }
.order-detail-item__placeholder { display: flex; width: 112rpx; height: 112rpx; align-items: center; justify-content: center; border-radius: 9rpx; color: var(--qx-store-muted); background: var(--qx-store-surface-soft); font-size: 18rpx; }
.order-detail-item__body { display: flex; min-width: 0; flex-direction: column; }
.order-detail-item__name { overflow: hidden; font-size: 22rpx; font-weight: 750; text-overflow: ellipsis; white-space: nowrap; }
.order-detail-item__sku { margin-top: 7rpx; color: var(--qx-store-muted); font-size: 18rpx; overflow-wrap: anywhere; }
.order-detail-item__amount { display: flex; min-width: 0; justify-content: space-between; gap: 12rpx; margin-top: auto; padding-top: 8rpx; font-size: 19rpx; }
.order-detail-amounts { display: grid; gap: 14rpx; }
.order-detail-amounts view { display: flex; min-width: 0; justify-content: space-between; gap: 18rpx; color: var(--qx-store-text-soft); font-size: 21rpx; }
.order-detail-amounts__total { padding-top: 14rpx; border-top: 1px solid var(--qx-store-line); color: var(--qx-store-text) !important; font-size: 25rpx !important; font-weight: 800; }
.order-detail-amounts__total text:last-child { color: var(--qx-store-danger); }
.order-logistics { display: grid; gap: 18rpx; }
.order-logistics__heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 16rpx; }
.order-logistics__heading .order-detail-panel__title { margin-bottom: 0; }
.order-logistics__heading > text:last-child { flex: 0 0 auto; color: var(--qx-store-brand-strong); font-size: 19rpx; font-weight: 750; }
.order-logistics__summary { display: grid; gap: 12rpx; }
.order-logistics__summary view { display: grid; min-width: 0; grid-template-columns: 116rpx minmax(0, 1fr); gap: 12rpx; font-size: 20rpx; }
.order-logistics__summary view text:first-child { color: var(--qx-store-muted); }
.order-logistics__summary view text:last-child { overflow-wrap: anywhere; }
.order-logistics__empty { color: var(--qx-store-muted); font-size: 19rpx; line-height: 1.55; }
.order-logistics__open { width: 100%; min-height: 64rpx; border: 1px solid var(--qx-store-brand) !important; border-radius: 8rpx; color: var(--qx-store-brand); background: #ffffff; font-size: 20rpx; }
.payment-status-detail { display: grid; gap: 10rpx; }
.payment-status-detail__summary, .payment-status-detail__line, .payment-status-detail__error { display: block; font-size: 20rpx; line-height: 1.55; overflow-wrap: anywhere; }
.payment-status-detail__summary { font-weight: 750; }
.payment-status-detail__line { color: var(--qx-store-warning); }
.payment-status-detail__error { color: var(--qx-store-danger); }
.order-timeline { display: grid; gap: 0; }
.order-timeline__event { display: grid; min-width: 0; grid-template-columns: 24rpx minmax(0, 1fr); gap: 12rpx; padding-bottom: 20rpx; }
.order-timeline__event:last-child { padding-bottom: 0; }
.order-timeline__dot { width: 16rpx; height: 16rpx; margin-top: 5rpx; border-radius: 50%; background: var(--qx-store-brand); }
.order-timeline__event text { display: block; overflow-wrap: anywhere; }
.order-timeline__event text:first-child { font-size: 21rpx; font-weight: 700; }
.order-timeline__event text:last-child { margin-top: 5rpx; color: var(--qx-store-muted); font-size: 17rpx; }
.order-detail-actions { position: fixed; z-index: 28; right: 0; bottom: 0; left: 0; display: grid; width: 100%; max-width: 414px; min-height: calc(108rpx + env(safe-area-inset-bottom)); grid-template-columns: minmax(0, 1fr) minmax(176rpx, auto); align-items: center; gap: 14rpx; margin: 0 auto; padding: 12rpx 20rpx calc(12rpx + env(safe-area-inset-bottom)); border-top: 1px solid var(--qx-store-line); background: rgba(255,255,255,.98); }
.order-detail-actions > text { min-width: 0; color: var(--qx-store-muted); font-size: 19rpx; line-height: 1.4; overflow-wrap: anywhere; }
.order-detail-actions__commands { display: flex; min-width: 0; gap: 10rpx; }
.order-detail-actions button { min-width: 0; min-height: 72rpx; padding: 0 20rpx; border-radius: 9rpx; font-size: 21rpx; font-weight: 750; white-space: nowrap; }
.order-detail-actions__cancel { border: 1px solid var(--qx-store-danger) !important; color: var(--qx-store-danger); background: #ffffff; }
.order-detail-actions__pay, .order-detail-actions__receipt { border: 1px solid var(--qx-store-brand-strong) !important; color: #ffffff; background: var(--qx-store-brand-strong); }
.order-detail-actions button[disabled] { color: var(--qx-store-muted); border-color: var(--qx-store-line) !important; }
.receipt-confirmation { position: fixed; z-index: 60; inset: 0; display: flex; width: 100%; max-width: 414px; align-items: flex-end; margin: 0 auto; padding: 20rpx 20rpx calc(20rpx + env(safe-area-inset-bottom)); background: rgba(20, 29, 25, .48); }
.receipt-confirmation__panel { width: 100%; min-width: 0; padding: 28rpx; border-radius: 12rpx; background: #ffffff; box-shadow: 0 18rpx 50rpx rgba(20, 29, 25, .18); }
.receipt-confirmation__title, .receipt-confirmation__copy { display: block; overflow-wrap: anywhere; }
.receipt-confirmation__title { font-size: 28rpx; font-weight: 800; }
.receipt-confirmation__copy { margin-top: 14rpx; color: var(--qx-store-text-soft); font-size: 20rpx; line-height: 1.6; }
.receipt-confirmation__actions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12rpx; margin-top: 24rpx; }
.receipt-confirmation__actions button { min-width: 0; min-height: 72rpx; padding: 0 14rpx; border: 1px solid var(--qx-store-line) !important; border-radius: 8rpx; color: var(--qx-store-text-soft); background: #ffffff; font-size: 21rpx; }
.receipt-confirmation__actions .receipt-confirmation__submit { border-color: var(--qx-store-brand-strong) !important; color: #ffffff; background: var(--qx-store-brand-strong); }
@media (max-width: 359px) { .order-status-panel { padding: 22rpx; } .order-detail-actions { grid-template-columns: 1fr; padding-inline: 14rpx; } .order-detail-actions > text { display: none; } .order-detail-actions__commands { width: 100%; } .order-detail-actions button { flex: 1; } }
</style>
