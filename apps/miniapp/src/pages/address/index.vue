<script setup lang="ts">
/* global uni */
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';

import {
  deleteStoreAddress,
  getStoreAddress,
  listStoreAddresses,
  updateStoreAddress,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { AddressWriteInput, StoreAddressDetail, StoreAddressSummary } from '../../types/store-shopping';
import {
  clearCustomerSession,
  hasRefreshableCustomerSession,
} from '../../utils/customer-session';
import { openLoginForAction } from '../../utils/protected-action';

type PageState = 'loading' | 'ready' | 'empty' | 'auth-required' | 'error' | 'rate-limited';

const state = ref<PageState>('loading');
const addresses = ref<StoreAddressSummary[]>([]);
const pendingAction = ref<string | null>(null);
const message = ref('');
const retryAfterSeconds = ref(0);
let loadGeneration = 0;
let authenticationRequired = false;

function requireLogin() {
  authenticationRequired = true;
  state.value = 'auth-required';
  clearCustomerSession();
  openLoginForAction({ type: 'ADDRESS_LIST' });
}

function retryLogin() {
  requireLogin();
}

function addressInput(detail: StoreAddressDetail): AddressWriteInput {
  return {
    recipient_name: detail.recipient_name,
    phone: detail.phone,
    province: detail.province,
    city: detail.city,
    district: detail.district,
    detail: detail.detail,
    is_default: detail.is_default,
  };
}

function openEditor(addressId?: string) {
  if (pendingAction.value !== null) return;
  const query = addressId === undefined ? '' : `?address_id=${encodeURIComponent(addressId)}`;
  void uni.navigateTo({ url: `/pages/address/edit${query}` });
}

async function loadAddresses(successMessage = '') {
  const generation = ++loadGeneration;
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  message.value = '';
  try {
    const next = await listStoreAddresses();
    if (generation !== loadGeneration) return;
    addresses.value = next;
    state.value = next.length === 0 ? 'empty' : 'ready';
    message.value = successMessage;
  } catch (error) {
    if (generation !== loadGeneration) return;
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
      return;
    }
    if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      state.value = 'rate-limited';
    } else {
      state.value = 'error';
    }
  }
}

async function refreshAfterMutationError(error: unknown, action: 'default' | 'delete') {
  if (error instanceof StoreApiError && error.status === 401) {
    requireLogin();
    return;
  }
  if (error instanceof StoreApiError && error.status === 404) {
    await loadAddresses('该地址已不存在，已刷新列表。');
    return;
  }
  if (error instanceof StoreApiError && error.status === 409) {
    await loadAddresses(action === 'default'
      ? '地址已发生变化，已刷新列表，请重新确认默认地址。'
      : '地址已发生变化，已刷新列表，请重新确认删除。');
    return;
  }
  if (error instanceof StoreApiError && error.status === 429) {
    message.value = `请求较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后重试。`;
    return;
  }
  message.value = action === 'default'
    ? '设置默认地址失败，当前列表已保留，请稍后重试。'
    : '删除地址失败，当前列表已保留，请稍后重试。';
}

async function setDefault(address: StoreAddressSummary) {
  if (pendingAction.value !== null || address.is_default) return;
  pendingAction.value = `default:${address.address_id}`;
  message.value = '';
  try {
    // The summary is masked, so the full owner-only detail must be read before PATCH.
    const detail = await getStoreAddress(address.address_id);
    await updateStoreAddress(address.address_id, {
      ...addressInput(detail),
      is_default: true,
    }, detail.version);
    await loadAddresses('已设为默认地址。');
  } catch (error) {
    await refreshAfterMutationError(error, 'default');
  } finally {
    pendingAction.value = null;
  }
}

async function performDelete(address: StoreAddressSummary) {
  if (pendingAction.value !== null) return;
  pendingAction.value = `delete:${address.address_id}`;
  message.value = '';
  try {
    await deleteStoreAddress(address.address_id, address.version);
    await loadAddresses('地址已删除，默认地址已按服务端结果更新。');
  } catch (error) {
    await refreshAfterMutationError(error, 'delete');
  } finally {
    pendingAction.value = null;
  }
}

function confirmDelete(address: StoreAddressSummary) {
  if (pendingAction.value !== null) return;
  void uni.showModal({
    cancelText: '取消',
    confirmColor: '#b84848',
    confirmText: '删除',
    content: address.is_default
      ? '删除后不可恢复，服务端会按稳定顺序提升下一条默认地址。'
      : '删除后不可恢复。',
    title: '删除收货地址',
    success: (result) => {
      if (result.confirm) void performDelete(address);
    },
  });
}

onShow(() => {
  if (authenticationRequired) {
    if (!hasRefreshableCustomerSession()) return;
    authenticationRequired = false;
  }
  void loadAddresses();
});
</script>

<template>
  <QxStoreShell>
    <view class="qx-account-page address-page">
      <QxAccountHeader title="收货地址" />

      <QxCatalogState
        v-if="state === 'loading'"
        kind="loading"
        title="正在读取地址"
        description="正在加载本人的脱敏地址摘要。"
      />
      <QxCatalogState
        v-else-if="state === 'auth-required'"
        kind="empty"
        title="登录后查看地址"
        description="你已取消登录，地址列表不会反复跳转。"
        action-label="去登录"
        @action="retryLogin"
      />
      <QxCatalogState
        v-else-if="state === 'empty'"
        kind="empty"
        title="暂无收货地址"
        description="新增后可在后续下单时使用。"
        action-label="新增地址"
        @action="openEditor()"
      />
      <QxCatalogState
        v-else-if="state !== 'ready'"
        :kind="state === 'rate-limited' ? 'rate-limited' : 'error'"
        :retry-after-seconds="retryAfterSeconds"
        title="地址列表加载失败"
        description="暂时无法读取收货地址，请稍后重试。"
        action-label="重新加载"
        @action="loadAddresses()"
      />

      <view
        v-else
        class="address-page__body"
      >
        <text
          v-if="message"
          class="qx-account-notice"
          role="status"
        >
          {{ message }}
        </text>

        <view
          class="address-list"
          aria-label="本人收货地址"
        >
          <article
            v-for="address in addresses"
            :key="address.address_id"
            class="address-card"
            :class="{ 'address-card--default': address.is_default }"
          >
            <view class="address-card__summary">
              <view class="address-card__heading">
                <text class="address-card__recipient">
                  {{ address.recipient_name_masked }}
                </text>
                <text class="address-card__phone">
                  {{ address.phone_masked }}
                </text>
                <text
                  v-if="address.is_default"
                  class="address-card__badge"
                >
                  默认
                </text>
              </view>
              <text class="address-card__region">
                {{ address.province }} {{ address.city }} {{ address.district }}
              </text>
              <text class="address-card__detail">
                {{ address.detail_masked }}
              </text>
            </view>

            <view class="address-card__actions">
              <button
                class="address-card__action"
                :aria-label="address.is_default ? '当前默认地址' : `将 ${address.recipient_name_masked} 的地址设为默认`"
                :disabled="pendingAction !== null || address.is_default"
                @click="setDefault(address)"
              >
                {{ pendingAction === `default:${address.address_id}` ? '设置中…' : address.is_default ? '当前默认' : '设为默认' }}
              </button>
              <button
                class="address-card__action"
                :aria-label="`编辑 ${address.recipient_name_masked} 的地址`"
                :disabled="pendingAction !== null"
                @click="openEditor(address.address_id)"
              >
                编辑
              </button>
              <button
                class="address-card__action address-card__action--danger"
                :aria-label="`删除 ${address.recipient_name_masked} 的地址`"
                :disabled="pendingAction !== null"
                @click="confirmDelete(address)"
              >
                {{ pendingAction === `delete:${address.address_id}` ? '删除中…' : '删除' }}
              </button>
            </view>
          </article>
        </view>

        <button
          class="qx-account-button address-page__create"
          :disabled="pendingAction !== null"
          @click="openEditor()"
        >
          新增收货地址
        </button>
      </view>
    </view>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.address-page__body {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 20rpx;
  padding: 24rpx 24rpx calc(40rpx + env(safe-area-inset-bottom));
}

.address-list {
  display: grid;
  width: 100%;
  gap: 18rpx;
}

.address-card {
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--qx-store-line);
  border-radius: 12rpx;
  background: var(--qx-store-surface);
}

.address-card--default {
  border-color: #9ebcac;
}

.address-card__summary {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 10rpx;
  padding: 26rpx 28rpx;
}

.address-card__heading {
  display: flex;
  min-width: 0;
  align-items: center;
  flex-wrap: wrap;
  gap: 10rpx 16rpx;
}

.address-card__recipient {
  min-width: 0;
  font-size: 28rpx;
  font-weight: 800;
  overflow-wrap: anywhere;
}

.address-card__phone,
.address-card__region,
.address-card__detail {
  color: var(--qx-store-text-soft);
  font-size: 23rpx;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.address-card__badge {
  flex: 0 0 auto;
  padding: 4rpx 10rpx;
  border-radius: 6rpx;
  color: var(--qx-store-brand-strong);
  background: var(--qx-store-surface-soft);
  font-size: 20rpx;
  font-weight: 700;
}

.address-card__actions {
  display: grid;
  width: 100%;
  border-top: 1px solid var(--qx-store-line);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.address-card__action {
  display: flex;
  min-width: 0;
  min-height: 76rpx;
  align-items: center;
  justify-content: center;
  padding: 12rpx 8rpx;
  border-right: 1px solid var(--qx-store-line);
  color: var(--qx-store-text-soft);
  background: var(--qx-store-surface);
  font-size: 21rpx;
  line-height: 1.35;
  text-align: center;
  white-space: normal;
  overflow-wrap: anywhere;
}

.address-card__action:last-child {
  border-right: 0;
}

.address-card__action--danger {
  color: var(--qx-store-danger);
}

.address-card__action[disabled] {
  color: var(--qx-store-muted);
  background: var(--qx-store-background);
}

.address-page__create {
  margin-top: 4rpx;
}
</style>
