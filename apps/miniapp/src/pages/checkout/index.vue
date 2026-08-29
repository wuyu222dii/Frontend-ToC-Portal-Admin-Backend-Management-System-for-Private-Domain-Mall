<script setup lang="ts">
/* global uni */
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import {
  createCheckoutQuote,
  getCustomerProfile,
  getStoreCart,
  listStoreAddresses,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxPrice from '../../components/storefront/QxPrice.vue';
import QxProductImage from '../../components/storefront/QxProductImage.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type {
  CheckoutQuote,
  CheckoutQuoteBlocker,
  CheckoutQuoteInput,
  OrderSubmitInput,
} from '../../types/store-orders';
import type { StoreAddressSummary } from '../../types/store-shopping';
import { clearCustomerSession } from '../../utils/customer-session';
import {
  clearOrderSubmitJournal,
  executeOrderSubmitJournal,
  loadOrderSubmitJournal,
  OrderSubmitJournalError,
  prepareOrderSubmitJournal,
  type OrderSubmitJournal,
} from '../../utils/order-submit-journal';
import { replaceWithLoginForAction, type ProtectedAction } from '../../utils/protected-action';

type CheckoutIntent =
  | { readonly source: 'CART' }
  | { readonly source: 'BUY_NOW'; readonly product_id: string; readonly sku_id: string; readonly quantity: number };
type PageState = 'loading' | 'ready' | 'address-required' | 'empty' | 'invalid' | 'auth-required' | 'error' | 'rate-limited' | 'recovery' | 'submit-conflict';

const state = ref<PageState>('loading');
const intent = ref<CheckoutIntent | null>(null);
const addresses = ref<StoreAddressSummary[]>([]);
const selectedAddressId = ref('');
const quote = ref<CheckoutQuote | null>(null);
const quoteInput = ref<CheckoutQuoteInput | null>(null);
const customerId = ref('');
const retryAfterSeconds = ref(0);
const message = ref('');
const slowRequest = ref(false);
const submitting = ref(false);
const remainingSeconds = ref(0);
const pendingJournal = ref<OrderSubmitJournal | null>(null);

let generation = 0;
let slowTimer: ReturnType<typeof setTimeout> | undefined;
let countdownTimer: ReturnType<typeof setInterval> | undefined;
let localQuoteDeadline = 0;
let authenticationRequired = false;

const canSubmit = computed(() => state.value === 'ready' && quote.value?.can_submit === true &&
  quote.value.quote_token !== null && quote.value.confirmation_hash !== null &&
  quote.value.expires_at !== null && remainingSeconds.value > 0 && !submitting.value);
const canRefreshExpiredQuote = computed(() => state.value === 'ready' &&
  quote.value?.can_submit === true && remainingSeconds.value === 0 && !submitting.value);
const countdownText = computed(() => {
  const minutes = Math.floor(remainingSeconds.value / 60);
  const seconds = remainingSeconds.value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

const blockerCopy: Record<CheckoutQuoteBlocker, string> = {
  CART_SELECTION_CHANGED: '购物车选择已经变化，请返回购物车确认后重新报价。',
  ITEM_UNAVAILABLE: '部分商品或规格已失效，请调整后重新报价。',
  INSUFFICIENT_STOCK: '部分商品库存不足，请减少数量后重新报价。',
};

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
}

function parseIntent(query: Record<string, string | undefined> | undefined): CheckoutIntent | null {
  if (query?.source === 'CART') return { source: 'CART' };
  if (query?.source !== 'BUY_NOW' || typeof query.product_id !== 'string' ||
    typeof query.sku_id !== 'string' || typeof query.quantity !== 'string' ||
    !isUlid(query.product_id) || !isUlid(query.sku_id) || !/^(?:[1-9]|[1-9][0-9])$/.test(query.quantity)) {
    return null;
  }
  return {
    source: 'BUY_NOW',
    product_id: query.product_id,
    sku_id: query.sku_id,
    quantity: Number(query.quantity),
  };
}

function protectedAction(): ProtectedAction {
  const current = intent.value;
  if (current?.source === 'BUY_NOW') return { type: 'BUY_NOW', ...current };
  return { type: 'CHECKOUT' };
}

function clearTimers() {
  if (slowTimer !== undefined) clearTimeout(slowTimer);
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  slowTimer = undefined;
  countdownTimer = undefined;
}

function clearQuote() {
  quote.value = null;
  quoteInput.value = null;
  localQuoteDeadline = 0;
  remainingSeconds.value = 0;
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  countdownTimer = undefined;
}

function updateCountdown() {
  remainingSeconds.value = Math.max(0, Math.ceil((localQuoteDeadline - Date.now()) / 1_000));
  if (remainingSeconds.value === 0 && countdownTimer !== undefined) {
    clearInterval(countdownTimer);
    countdownTimer = undefined;
    message.value = '报价已过期，请重新获取报价后再次确认。';
  }
}

function startCountdown(next: CheckoutQuote) {
  if (next.expires_at === null) return;
  localQuoteDeadline = Date.now() + Math.max(0, Date.parse(next.expires_at) - Date.parse(next.server_time));
  updateCountdown();
  if (remainingSeconds.value > 0) countdownTimer = setInterval(updateCountdown, 1_000);
}

function requireLogin() {
  authenticationRequired = true;
  state.value = 'auth-required';
  clearCustomerSession();
  replaceWithLoginForAction(protectedAction());
}

function selectInitialAddress(next: StoreAddressSummary[]) {
  if (next.some(({ address_id }) => address_id === selectedAddressId.value)) return;
  selectedAddressId.value = next.find(({ is_default }) => is_default)?.address_id ?? next[0]?.address_id ?? '';
}

async function requestedItems(): Promise<CheckoutQuoteInput['items']> {
  const current = intent.value;
  if (current?.source === 'BUY_NOW') {
    return [{ sku_id: current.sku_id, quantity: current.quantity }];
  }
  const cart = await getStoreCart();
  return cart.items.filter(({ selected }) => selected).map(({ sku_id, quantity }) => ({ sku_id, quantity }));
}

function applyLoadError(error: unknown) {
  if (error instanceof StoreApiError && error.status === 401) {
    requireLogin();
  } else if (error instanceof StoreApiError && error.status === 429) {
    retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
    state.value = 'rate-limited';
  } else if (error instanceof StoreApiError && error.status === 404) {
    state.value = 'empty';
    message.value = '地址或商品已发生变化，请返回检查后重试。';
  } else {
    state.value = 'error';
  }
}

async function loadCheckout(successMessage = '') {
  if (intent.value === null || submitting.value) return;
  const currentGeneration = ++generation;
  clearQuote();
  clearTimers();
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  message.value = '';
  slowRequest.value = false;
  slowTimer = setTimeout(() => {
    if (generation === currentGeneration && state.value === 'loading') slowRequest.value = true;
  }, 800);
  try {
    const profile = await getCustomerProfile();
    if (currentGeneration !== generation) return;
    customerId.value = profile.customer_id;
    const journal = loadOrderSubmitJournal();
    if (journal !== null) {
      if (journal.customer_id !== profile.customer_id) {
        clearOrderSubmitJournal(journal);
      } else {
        pendingJournal.value = journal;
        state.value = 'recovery';
        message.value = '上次提交结果尚未确认，请使用原请求继续确认，避免重复下单。';
        return;
      }
    }
    pendingJournal.value = null;
    const [nextAddresses, items] = await Promise.all([listStoreAddresses(), requestedItems()]);
    if (currentGeneration !== generation) return;
    addresses.value = nextAddresses;
    if (nextAddresses.length === 0) {
      state.value = 'address-required';
      return;
    }
    if (items.length === 0) {
      state.value = 'empty';
      message.value = intent.value.source === 'CART' ? '当前没有已选购物车商品。' : '购买商品已失效。';
      return;
    }
    selectInitialAddress(nextAddresses);
    const input: CheckoutQuoteInput = {
      source: intent.value.source,
      address_id: selectedAddressId.value,
      items,
    } as CheckoutQuoteInput;
    const nextQuote = await createCheckoutQuote(input);
    if (currentGeneration !== generation) return;
    quoteInput.value = input;
    quote.value = nextQuote;
    state.value = 'ready';
    message.value = successMessage;
    if (nextQuote.can_submit) startCountdown(nextQuote);
  } catch (error) {
    if (currentGeneration === generation) applyLoadError(error);
  } finally {
    if (currentGeneration === generation) {
      if (slowTimer !== undefined) clearTimeout(slowTimer);
      slowTimer = undefined;
      slowRequest.value = false;
    }
  }
}

function selectAddress(addressId: string) {
  if (submitting.value || addressId === selectedAddressId.value) return;
  selectedAddressId.value = addressId;
  void loadCheckout();
}

function manageAddresses() {
  if (submitting.value) return;
  void uni.navigateTo({ url: '/pages/address/index' });
}

function returnToCart() {
  void uni.redirectTo({ url: '/pages/cart/index' });
}

function openOrders() {
  void uni.navigateTo({ url: '/pages/orders/index' });
}

function orderDetail(orderId: string) {
  clearQuote();
  void uni.redirectTo({ url: `/pages/orders/detail?order_id=${encodeURIComponent(orderId)}` });
}

function handleSubmitError(error: unknown): string | null {
  if (error instanceof StoreApiError && error.status === 401) {
    pendingJournal.value = null;
    requireLogin();
    return null;
  }
  if (error instanceof StoreApiError && error.status === 429) {
    retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
    state.value = 'recovery';
    message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后使用原请求重试。`;
    return null;
  }
  if (error instanceof StoreApiError && error.status === 409) {
    pendingJournal.value = null;
    clearQuote();
    if (['CHECKOUT_QUOTE_EXPIRED', 'CHECKOUT_QUOTE_MISMATCH', 'CHECKOUT_REQUOTE_REQUIRED'].includes(error.code)) {
      return '报价依据已变化，必须重新报价并再次确认。';
    } else {
      state.value = 'submit-conflict';
      message.value = '订单提交状态冲突。请先查看订单列表确认结果，不要更换幂等键重复提交。';
    }
    return null;
  }
  if (error instanceof StoreApiError && [400, 403, 404, 422].includes(error.status)) {
    pendingJournal.value = null;
    clearQuote();
    return '订单条件不再满足，请重新报价后确认。';
  }
  state.value = 'recovery';
  message.value = '提交结果暂时无法确认。请保留当前页面并使用原请求重试，不要重新下单。';
  return null;
}

async function executeJournal(journal: OrderSubmitJournal) {
  if (submitting.value || customerId.value.length === 0) return;
  submitting.value = true;
  pendingJournal.value = journal;
  let reloadMessage: string | null = null;
  try {
    const order = await executeOrderSubmitJournal(customerId.value, journal);
    pendingJournal.value = null;
    orderDetail(order.order_id);
  } catch (error) {
    reloadMessage = handleSubmitError(error);
  } finally {
    submitting.value = false;
  }
  if (reloadMessage !== null) void loadCheckout(reloadMessage);
}

function retryPendingSubmission() {
  const journal = pendingJournal.value;
  if (journal !== null) void executeJournal(journal);
}

function confirmSubmit() {
  const currentQuote = quote.value;
  const currentInput = quoteInput.value;
  if (!canSubmit.value || currentQuote === null || currentInput === null ||
    currentQuote.quote_token === null || currentQuote.confirmation_hash === null) return;
  void uni.showModal({
    cancelText: '再检查一下',
    confirmText: '确认下单',
    content: '提交后将预占库存 30 分钟，并创建待付款订单。',
    title: '确认订单信息',
    success: (result) => {
      if (!result.confirm || !canSubmit.value) return;
      const request: OrderSubmitInput = {
        ...currentInput,
        quote_id: currentQuote.quote_id,
        quote_token: currentQuote.quote_token as string,
        confirmation_hash: currentQuote.confirmation_hash as string,
      } as OrderSubmitInput;
      try {
        const journal = prepareOrderSubmitJournal(customerId.value, request);
        void executeJournal(journal);
      } catch (error) {
        if (error instanceof OrderSubmitJournalError && error.code === 'PENDING_COMMAND') {
          pendingJournal.value = loadOrderSubmitJournal();
          state.value = 'recovery';
          message.value = '已有一笔提交等待确认，请先恢复该请求。';
        } else {
          message.value = '本地恢复记录写入失败，本次未发送下单请求。';
        }
      }
    },
  });
}

function primaryAction() {
  if (canRefreshExpiredQuote.value) {
    void loadCheckout('已重新读取最新订单信息，请再次确认。');
    return;
  }
  confirmSubmit();
}

onLoad((query) => {
  intent.value = parseIntent(query as Record<string, string | undefined> | undefined);
  if (intent.value === null) state.value = 'invalid';
});

onShow(() => {
  if (intent.value === null) return;
  if (authenticationRequired) {
    authenticationRequired = false;
  }
  void loadCheckout();
});

onUnload(() => {
  generation += 1;
  clearTimers();
});
</script>

<template>
  <QxStoreShell>
    <view class="checkout-page">
      <QxAccountHeader title="确认订单" />

      <QxCatalogState
        v-if="state === 'loading'"
        kind="loading"
        title="正在确认订单信息"
        :description="slowRequest ? '网络响应较慢，仍在读取最新价格和库存。' : '正在读取地址、商品、价格和库存。'"
      />
      <QxCatalogState
        v-else-if="state === 'invalid'"
        kind="empty"
        title="结算请求无效"
        description="请从购物车或商品详情重新发起结算。"
        action-label="返回购物车"
        @action="returnToCart"
      />
      <QxCatalogState
        v-else-if="state === 'address-required'"
        kind="empty"
        title="请先添加收货地址"
        description="订单需要一条当前账户下的有效收货地址。"
        action-label="管理收货地址"
        @action="manageAddresses"
      />
      <QxCatalogState
        v-else-if="state === 'empty'"
        kind="empty"
        title="没有可结算内容"
        :description="message || '请返回购物车或商品详情重新选择。'"
        action-label="返回购物车"
        @action="returnToCart"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        kind="empty"
        title="登录后继续结算"
        description="登录完成后会恢复到报价页，不会自动提交订单。"
        action-label="重新登录"
        @action="requireLogin"
      />
      <QxCatalogState
        v-else-if="state === 'error' || state === 'rate-limited'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="订单信息加载失败"
        description="暂时无法读取最新结算信息，请稍后重试。"
        action-label="重新加载"
        @action="loadCheckout()"
      />

      <view
        v-else-if="state === 'recovery'"
        class="checkout-page__body checkout-recovery"
      >
        <section
          class="checkout-panel checkout-recovery__panel"
          role="status"
        >
          <text class="checkout-panel__title">
            确认上次提交结果
          </text>
          <text class="checkout-copy">
            {{ message }}
          </text>
          <button
            class="checkout-button"
            :disabled="submitting"
            @click="retryPendingSubmission"
          >
            {{ submitting ? '正在确认…' : '使用原请求继续确认' }}
          </button>
          <button
            class="checkout-link"
            :disabled="submitting"
            @click="openOrders"
          >
            先查看我的订单
          </button>
        </section>
      </view>

      <QxCatalogState
        v-else-if="state === 'submit-conflict'"
        kind="error"
        title="需要先确认订单结果"
        :description="message"
        action-label="查看我的订单"
        @action="openOrders"
      />

      <view
        v-else-if="state === 'ready' && quote"
        class="checkout-page__body"
      >
        <text
          v-if="message"
          class="checkout-notice"
          role="status"
        >
          {{ message }}
        </text>

        <section
          class="checkout-panel"
          aria-label="选择收货地址"
        >
          <view class="checkout-panel__heading">
            <text class="checkout-panel__title">
              收货地址
            </text>
            <button
              class="checkout-link"
              :disabled="submitting"
              @click="manageAddresses"
            >
              管理
            </button>
          </view>
          <view class="checkout-addresses">
            <button
              v-for="address in addresses"
              :key="address.address_id"
              class="checkout-address"
              :class="{ 'checkout-address--active': selectedAddressId === address.address_id }"
              :aria-pressed="selectedAddressId === address.address_id"
              :disabled="submitting"
              @click="selectAddress(address.address_id)"
            >
              <view class="checkout-address__heading">
                <text>{{ address.recipient_name_masked }}</text>
                <text>{{ address.phone_masked }}</text>
                <text
                  v-if="address.is_default"
                  class="checkout-badge"
                >
                  默认
                </text>
              </view>
              <text>{{ address.province }} {{ address.city }} {{ address.district }}</text>
              <text>{{ address.detail_masked }}</text>
            </button>
          </view>
        </section>

        <section
          class="checkout-panel"
          aria-label="订单商品"
        >
          <text class="checkout-panel__title">
            商品明细
          </text>
          <article
            v-for="item in quote.items"
            :key="item.sku_id"
            class="checkout-item"
          >
            <QxProductImage
              :src="item.primary_image_url"
              :alt="item.product_name"
              shape="square"
            />
            <view class="checkout-item__body">
              <text class="checkout-item__name">
                {{ item.product_name }}
              </text>
              <text class="checkout-item__sku">
                {{ item.sku_name }} · ×{{ item.quantity }}
              </text>
              <text
                v-if="!item.saleable"
                class="checkout-item__warning"
              >
                当前项目不可提交
              </text>
              <view class="checkout-item__amount">
                <QxPrice :amount="item.unit_price" />
                <text>小计 ¥{{ item.line_amount }}</text>
              </view>
            </view>
          </article>
        </section>

        <section
          v-if="quote.blockers.length > 0"
          class="checkout-panel checkout-blockers"
          role="alert"
        >
          <text class="checkout-panel__title">
            需要处理后再提交
          </text>
          <text
            v-for="blocker in quote.blockers"
            :key="blocker"
            class="checkout-copy"
          >
            {{ blockerCopy[blocker] }}
          </text>
          <button
            class="checkout-button checkout-button--secondary"
            @click="loadCheckout()"
          >
            重新读取并报价
          </button>
        </section>

        <section
          class="checkout-panel checkout-amounts"
          aria-label="金额汇总"
        >
          <view><text>商品金额</text><text>¥{{ quote.goods_amount }}</text></view>
          <view><text>运费</text><text>¥{{ quote.shipping_amount }}</text></view>
          <view class="checkout-amounts__total">
            <text>应付金额</text><text>¥{{ quote.payable_amount }}</text>
          </view>
        </section>
      </view>

      <view
        v-if="state === 'ready' && quote"
        class="checkout-actions"
      >
        <view class="checkout-actions__summary">
          <text>应付 ¥{{ quote.payable_amount }}</text>
          <text v-if="quote.can_submit">
            报价剩余 {{ countdownText }}
          </text>
          <text v-else>
            请先处理阻断项
          </text>
        </view>
        <button
          :disabled="!canSubmit && !canRefreshExpiredQuote"
          @click="primaryAction"
        >
          {{ submitting ? '正在提交…' : remainingSeconds === 0 && quote.can_submit ? '重新报价后提交' : '提交待付款订单' }}
        </button>
      </view>
    </view>
  </QxStoreShell>
</template>

<style scoped>
.checkout-page { min-height: 100vh; padding-bottom: calc(132rpx + env(safe-area-inset-bottom)); background: var(--qx-store-background); }
.checkout-page__body { display: grid; gap: 18rpx; padding: 22rpx 22rpx 40rpx; }
.checkout-panel { min-width: 0; padding: 24rpx; border: 1px solid var(--qx-store-line); border-radius: 12rpx; background: var(--qx-store-surface); }
.checkout-panel__heading { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 16rpx; }
.checkout-panel__title { display: block; font-size: 25rpx; font-weight: 800; }
.checkout-link { min-height: 52rpx; color: var(--qx-store-brand); background: transparent; font-size: 21rpx; }
.checkout-addresses { display: grid; gap: 12rpx; margin-top: 18rpx; }
.checkout-address { display: flex; width: 100%; min-width: 0; flex-direction: column; gap: 7rpx; padding: 18rpx; border: 1px solid var(--qx-store-line) !important; border-radius: 9rpx; color: var(--qx-store-text-soft); background: var(--qx-store-surface); font-size: 21rpx; line-height: 1.45; text-align: left; overflow-wrap: anywhere; }
.checkout-address--active { border-color: var(--qx-store-brand) !important; background: var(--qx-store-surface-soft); }
.checkout-address__heading { display: flex; min-width: 0; flex-wrap: wrap; gap: 8rpx 14rpx; color: var(--qx-store-text); font-size: 23rpx; font-weight: 750; }
.checkout-badge { padding: 2rpx 8rpx; border-radius: 5rpx; color: var(--qx-store-brand-strong); background: #dcebe3; font-size: 17rpx; }
.checkout-item { display: grid; min-width: 0; grid-template-columns: 132rpx minmax(0, 1fr); gap: 16rpx; padding: 20rpx 0; border-bottom: 1px solid var(--qx-store-line); }
.checkout-item:last-child { padding-bottom: 0; border-bottom: 0; }
.checkout-item__body { display: flex; min-width: 0; flex-direction: column; }
.checkout-item__name { overflow: hidden; font-size: 23rpx; font-weight: 750; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.checkout-item__sku { margin-top: 7rpx; color: var(--qx-store-muted); font-size: 19rpx; line-height: 1.45; overflow-wrap: anywhere; }
.checkout-item__warning { margin-top: 6rpx; color: var(--qx-store-danger); font-size: 18rpx; }
.checkout-item__amount { display: flex; min-width: 0; align-items: flex-end; justify-content: space-between; gap: 10rpx; margin-top: auto; padding-top: 10rpx; font-size: 19rpx; }
.checkout-blockers { border-color: #e7c3ba; background: var(--qx-store-accent-soft); }
.checkout-copy { display: block; margin-top: 12rpx; color: var(--qx-store-text-soft); font-size: 21rpx; line-height: 1.6; overflow-wrap: anywhere; }
.checkout-button { width: 100%; min-height: 78rpx; margin-top: 22rpx; border-radius: 9rpx; color: #ffffff; background: var(--qx-store-brand); font-size: 23rpx; font-weight: 750; }
.checkout-button[disabled] { background: var(--qx-store-muted); }
.checkout-button--secondary { border: 1px solid var(--qx-store-brand); color: var(--qx-store-brand); background: #ffffff; }
.checkout-amounts { display: grid; gap: 14rpx; }
.checkout-amounts view { display: flex; min-width: 0; justify-content: space-between; gap: 20rpx; color: var(--qx-store-text-soft); font-size: 22rpx; }
.checkout-amounts__total { padding-top: 16rpx; border-top: 1px solid var(--qx-store-line); color: var(--qx-store-text) !important; font-size: 27rpx !important; font-weight: 800; }
.checkout-amounts__total text:last-child { color: var(--qx-store-danger); }
.checkout-notice { display: block; padding: 18rpx 20rpx; border-radius: 9rpx; font-size: 20rpx; line-height: 1.55; }
.checkout-notice { color: var(--qx-store-danger); background: var(--qx-store-accent-soft); }
.checkout-actions { position: fixed; z-index: 30; right: 0; bottom: 0; left: 0; display: grid; width: 100%; max-width: 414px; min-height: calc(112rpx + env(safe-area-inset-bottom)); grid-template-columns: minmax(0, 1fr) 216rpx; align-items: center; gap: 14rpx; margin: 0 auto; padding: 12rpx 20rpx calc(12rpx + env(safe-area-inset-bottom)); border-top: 1px solid var(--qx-store-line); background: rgba(255,255,255,.98); }
.checkout-actions__summary { min-width: 0; }
.checkout-actions__summary text { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.checkout-actions__summary text:first-child { color: var(--qx-store-danger); font-size: 25rpx; font-weight: 800; }
.checkout-actions__summary text:last-child { margin-top: 4rpx; color: var(--qx-store-muted); font-size: 17rpx; }
.checkout-actions button { min-width: 0; min-height: 76rpx; border-radius: 9rpx; color: #ffffff; background: var(--qx-store-brand); font-size: 21rpx; font-weight: 750; white-space: normal; }
.checkout-actions button[disabled] { background: var(--qx-store-muted); opacity: .7; }
.checkout-recovery { min-height: 600rpx; align-content: center; }
.checkout-recovery__panel { text-align: center; }
.checkout-recovery .checkout-link { width: 100%; margin-top: 10rpx; }
@media (max-width: 359px) { .checkout-actions { grid-template-columns: minmax(0, 1fr) 182rpx; padding-inline: 14rpx; } .checkout-item { grid-template-columns: 112rpx minmax(0, 1fr); } }
</style>
