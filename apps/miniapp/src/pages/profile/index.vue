<script setup lang="ts">
/* global uni */
import { onShow } from '@dcloudio/uni-app';
import { ref } from 'vue';

import { getCustomerProfile, getServiceAgent, logoutCustomer } from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxBottomNav from '../../components/storefront/QxBottomNav.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxCell from '../../components/storefront/QxCell.vue';
import QxCells from '../../components/storefront/QxCells.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { CustomerProfile, ServiceAgent } from '../../types/store-identity';
import { clearCustomerSession } from '../../utils/customer-session';
import { clearOrderSubmitJournal } from '../../utils/order-submit-journal';
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
        try {
          clearOrderSubmitJournal();
        } catch {
          // Session removal still wins if local order journal cleanup is unavailable.
        }
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
            {{ profile.nickname?.slice(0, 1) || '泽' }}
          </view>
          <view class="profile-summary__copy">
            <text class="profile-summary__name">
              {{ profile.nickname || '泽枫用户' }}
            </text>
            <text class="qx-account-muted">
              {{ profile.city || '尚未填写城市' }}
            </text>
          </view>
        </section>

        <QxCells>
          <QxCell
            title="编辑资料"
            icon="edit"
            chevron
            @select="openPage('/pages/profile/edit')"
          />
          <QxCell
            title="账户手机号"
            :value="profile.phone_masked || '未授权'"
            icon="phone"
            chevron
            @select="openPage('/pages/profile/phone')"
          />
          <QxCell
            title="服务代理"
            :value="serviceAgent?.display_name || '未绑定'"
            icon="user"
            chevron
            @select="openPage('/pages/profile/agent')"
          />
        </QxCells>

        <QxCells>
          <QxCell
            title="商品收藏"
            icon="heart"
            chevron
            @select="openPage('/pages/favorites/index')"
          />
          <QxCell
            title="收货地址"
            icon="location"
            chevron
            @select="openPage('/pages/address/index')"
          />
          <QxCell
            title="我的订单"
            icon="order"
            chevron
            @select="openPage('/pages/orders/index')"
          />
        </QxCells>

        <QxCells>
          <QxCell
            title="账号与隐私"
            icon="shield"
            chevron
            @select="openPage('/pages/profile/privacy')"
          />
          <QxCell
            :title="logoutPending ? '正在退出…' : '退出登录'"
            danger
            center
            @select="confirmLogout"
          />
        </QxCells>
      </view>
    </view>
    <template #bottom>
      <QxBottomNav active="profile" @select="handleBottomNavigation" />
    </template>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.qx-account-page__body {
  gap: 16rpx;
  padding-right: 0;
  padding-left: 0;
}

.profile-summary {
  display: flex;
  min-height: 152rpx;
  align-items: center;
  gap: 24rpx;
  margin: 0 24rpx;
  padding: 28rpx;
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
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
