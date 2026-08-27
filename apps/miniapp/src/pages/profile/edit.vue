<script setup lang="ts">
/* global uni */
import { onLoad } from '@dcloudio/uni-app';
import { ref } from 'vue';

import { getCustomerProfile, updateCustomerProfile } from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { CustomerProfile } from '../../types/store-identity';
import { clearCustomerSession } from '../../utils/customer-session';
import { openLoginForAction } from '../../utils/protected-action';

type PageState = 'loading' | 'ready' | 'error' | 'rate-limited';

const state = ref<PageState>('loading');
const profile = ref<CustomerProfile | null>(null);
const nickname = ref('');
const city = ref('');
const avatarUrl = ref('');
const pending = ref(false);
const message = ref('');
const retryAfterSeconds = ref(0);

function applyProfile(next: CustomerProfile) {
  profile.value = next;
  nickname.value = next.nickname ?? '';
  city.value = next.city ?? '';
  avatarUrl.value = next.avatar_url ?? '';
}

function requireLogin() {
  clearCustomerSession();
  openLoginForAction({ type: 'PROFILE' });
}

async function loadProfile(conflict = false) {
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  try {
    applyProfile(await getCustomerProfile());
    state.value = 'ready';
    if (conflict) message.value = '资料已经变化，已刷新为最新内容，请重新修改后保存。';
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

function normalizedOptional(value: string): string | null {
  const normalized = value.trim();
  return normalized.length === 0 ? null : normalized;
}

async function saveProfile() {
  const current = profile.value;
  if (current === null || pending.value) return;
  pending.value = true;
  message.value = '';
  try {
    const next = await updateCustomerProfile({
      nickname: normalizedOptional(nickname.value),
      city: normalizedOptional(city.value),
      avatar_url: normalizedOptional(avatarUrl.value),
    }, current.version);
    applyProfile(next);
    void uni.showToast({ icon: 'success', title: '资料已保存' });
    setTimeout(() => void uni.navigateBack(), 250);
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 409) {
      await loadProfile(true);
    } else if (error instanceof StoreApiError && error.status === 429) {
      message.value = `请求较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后重试。`;
    } else {
      message.value = error instanceof StoreApiError && error.status === 400
        ? '请检查昵称、城市和头像地址后重试。'
        : '资料保存失败，请稍后重试。';
    }
  } finally {
    pending.value = false;
  }
}

onLoad(() => {
  void loadProfile();
});
</script>

<template>
  <QxStoreShell>
    <view class="qx-account-page">
      <QxAccountHeader title="编辑资料" />
      <QxCatalogState
        v-if="state !== 'ready'"
        :kind="state === 'loading' ? 'loading' : state"
        :retry-after-seconds="retryAfterSeconds"
        title="资料加载失败"
        description="暂时无法读取最新资料。"
        action-label="重新加载"
        @action="loadProfile"
      />
      <view v-else class="qx-account-page__body">
        <label class="qx-account-field">
          <text class="qx-account-field__label">昵称</text>
          <input
            v-model="nickname"
            aria-label="昵称"
            class="qx-account-field__input"
            maxlength="80"
            placeholder="填写昵称"
          >
        </label>
        <label class="qx-account-field">
          <text class="qx-account-field__label">城市</text>
          <input
            v-model="city"
            aria-label="城市"
            class="qx-account-field__input"
            maxlength="120"
            placeholder="填写所在城市"
          >
        </label>
        <label class="qx-account-field">
          <text class="qx-account-field__label">头像 HTTPS 地址</text>
          <input
            v-model="avatarUrl"
            aria-label="头像 HTTPS 地址"
            class="qx-account-field__input"
            maxlength="500"
            placeholder="可选"
          >
        </label>
        <text v-if="message" class="qx-account-notice" role="status">
          {{ message }}
        </text>
        <button class="qx-account-button" :disabled="pending" @click="saveProfile">
          {{ pending ? '正在保存…' : '保存资料' }}
        </button>
      </view>
    </view>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>
