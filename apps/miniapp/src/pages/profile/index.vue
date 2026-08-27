<script setup lang="ts">
/* global uni */
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';

import { getCustomerProfile, getServiceAgent, logoutCustomer } from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxBottomNav from '../../components/storefront/QxBottomNav.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { CustomerProfile, ServiceAgent } from '../../types/store-identity';
import { clearCustomerSession } from '../../utils/customer-session';
import { openLoginForAction } from '../../utils/protected-action';
import { handleBottomNavigation } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'error' | 'rate-limited';

const state = ref<PageState>('loading');
const profile = ref<CustomerProfile | null>(null);
const serviceAgent = ref<ServiceAgent | null>(null);
const retryAfterSeconds = ref(0);
const logoutPending = ref(false);

function requireLogin() {
  clearCustomerSession();
  openLoginForAction({ type: 'PROFILE' });
}

async function loadProfile() {
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  try {
    const [nextProfile, nextAgent] = await Promise.all([
      getCustomerProfile(),
      getServiceAgent(),
    ]);
    profile.value = nextProfile;
    serviceAgent.value = nextAgent;
    state.value = 'ready';
  } catch (error) {
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

function openPage(path: string) {
  void uni.navigateTo({ url: path });
}

function showUnavailable(title: string) {
  void uni.showModal({
    confirmText: '知道了',
    content: '此功能将在后续阶段开放。',
    showCancel: false,
    title,
  });
}

function confirmLogout() {
  if (logoutPending.value) return;
  void uni.showModal({
    cancelText: '取消',
    confirmText: '退出',
    content: '退出只会撤销当前设备会话。',
    title: '退出登录',
    success: async (result) => {
      if (!result.confirm) return;
      logoutPending.value = true;
      try {
        await logoutCustomer();
      } catch {
        clearCustomerSession();
      } finally {
        logoutPending.value = false;
        void uni.reLaunch({ url: '/pages/index/index' });
      }
    },
  });
}

onShow(() => {
  void loadProfile();
});
</script>

<template>
  <QxStoreShell with-bottom-nav>
    <view class="qx-account-page">
      <QxAccountHeader :back="false" title="个人中心" />
      <QxCatalogState
        v-if="state !== 'ready'"
        :kind="state === 'loading' ? 'loading' : state"
        :retry-after-seconds="retryAfterSeconds"
        title="个人资料加载失败"
        description="暂时无法读取本人资料，请稍后重试。"
        action-label="重新加载"
        @action="loadProfile"
      />
      <view v-else-if="profile" class="qx-account-page__body">
        <section class="profile-summary" aria-label="本人资料摘要">
          <image
            v-if="profile.avatar_url"
            class="profile-summary__avatar"
            :src="profile.avatar_url"
            mode="aspectFill"
          />
          <view v-else class="profile-summary__avatar profile-summary__avatar--fallback">
            {{ profile.nickname?.slice(0, 1) || '青' }}
          </view>
          <view class="profile-summary__copy">
            <text class="profile-summary__name">
              {{ profile.nickname || '青序用户' }}
            </text>
            <text class="qx-account-muted">
              {{ profile.city || '尚未填写城市' }}
            </text>
          </view>
        </section>

        <view class="qx-account-panel">
          <text class="qx-account-panel__heading">账户资料</text>
          <button aria-label="编辑资料" class="qx-account-row" @click="openPage('/pages/profile/edit')">
            <text>编辑资料</text><text class="qx-account-row__value">›</text>
          </button>
          <button aria-label="账户手机号" class="qx-account-row" @click="openPage('/pages/profile/phone')">
            <text>账户手机号</text>
            <text class="qx-account-row__value">{{ profile.phone_masked || '未授权' }} ›</text>
          </button>
          <button aria-label="服务代理" class="qx-account-row" @click="openPage('/pages/profile/agent')">
            <text>服务代理</text>
            <text class="qx-account-row__value">{{ serviceAgent?.display_name || '未绑定' }} ›</text>
          </button>
        </view>

        <view class="qx-account-panel">
          <text class="qx-account-panel__heading">消费服务</text>
          <button class="qx-account-row" @click="showUnavailable('收藏尚未开放')">
            <text>商品收藏</text><text class="qx-account-row__value">尚未开放</text>
          </button>
          <button class="qx-account-row" @click="showUnavailable('收货地址尚未开放')">
            <text>收货地址</text><text class="qx-account-row__value">尚未开放</text>
          </button>
          <button class="qx-account-row" @click="showUnavailable('订单尚未开放')">
            <text>我的订单</text><text class="qx-account-row__value">尚未开放</text>
          </button>
        </view>

        <view class="qx-account-panel">
          <text class="qx-account-panel__heading">隐私与会话</text>
          <button aria-label="账号与隐私" class="qx-account-row" @click="openPage('/pages/profile/privacy')">
            <text>账号与隐私</text><text class="qx-account-row__value">›</text>
          </button>
          <button class="qx-account-row profile-logout" @click="confirmLogout">
            <text>{{ logoutPending ? '正在退出…' : '退出登录' }}</text>
          </button>
        </view>
      </view>
    </view>
    <template #bottom>
      <QxBottomNav active="profile" @select="handleBottomNavigation" />
    </template>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.profile-summary {
  display: flex;
  min-height: 152rpx;
  align-items: center;
  gap: 24rpx;
  padding: 24rpx 28rpx;
  border: 1px solid var(--qx-store-line);
  border-radius: 12rpx;
  background: var(--qx-store-surface);
}

.profile-summary__avatar {
  width: 92rpx;
  height: 92rpx;
  flex: 0 0 auto;
  border-radius: 50%;
}

.profile-summary__avatar--fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--qx-store-brand-strong);
  background: var(--qx-store-surface-soft);
  font-size: 38rpx;
}

.profile-summary__copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 8rpx;
}

.profile-summary__name {
  overflow: hidden;
  font-size: 30rpx;
  font-weight: 800;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-logout {
  justify-content: center;
  color: var(--qx-store-danger);
  text-align: center;
}
</style>
