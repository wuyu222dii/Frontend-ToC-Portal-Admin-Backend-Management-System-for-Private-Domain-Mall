<script setup lang="ts">
/* global uni */
import { onLoad } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import {
  authorizeCustomerPhone,
  getCustomerProfile,
  getLegalDocuments,
  revokeCustomerPhone,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { CustomerProfile, LegalDocuments } from '../../types/store-identity';
import { clearCustomerSession } from '../../utils/customer-session';
import { openLoginForAction } from '../../utils/protected-action';
import { isSafeHttpsUrl } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'error' | 'rate-limited';

const state = ref<PageState>('loading');
const profile = ref<CustomerProfile | null>(null);
const documents = ref<LegalDocuments | null>(null);
const consentAccepted = ref(false);
const mockCredential = ref('');
const mockControlsEnabled = import.meta.env.DEV;
const pending = ref(false);
const message = ref('');
const retryAfterSeconds = ref(0);

const hasPhone = computed(() => profile.value?.phone_masked !== null &&
  profile.value?.phone_masked !== undefined);
const authorizationLabel = computed(() => hasPhone.value
  ? '重新授权账户手机号'
  : '授权账户手机号');

function requireLogin() {
  clearCustomerSession();
  openLoginForAction({ type: 'PROFILE' });
}

async function loadPage(conflict = false) {
  state.value = 'loading';
  retryAfterSeconds.value = 0;
  try {
    const [nextProfile, nextDocuments] = await Promise.all([
      getCustomerProfile(),
      getLegalDocuments(),
    ]);
    profile.value = nextProfile;
    documents.value = nextDocuments;
    state.value = 'ready';
    if (conflict) {
      consentAccepted.value = false;
      message.value = '账户或授权说明已经变化，已刷新最新内容，请重新确认。';
    }
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

function openPhoneDocument() {
  const url = documents.value?.phone_authorization.content_url;
  if (!url || !isSafeHttpsUrl(url)) return;
  // #ifdef H5
  window.open(url, '_blank', 'noopener,noreferrer');
  // #endif
  // #ifndef H5
  void uni.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
  // #endif
}

async function authorize(credential: string) {
  const currentProfile = profile.value;
  const currentDocuments = documents.value;
  if (pending.value || !consentAccepted.value || currentProfile === null ||
    currentDocuments === null || credential.trim().length === 0) return;
  const providerCredential = credential.trim();
  const wasAuthorized = hasPhone.value;
  mockCredential.value = '';
  pending.value = true;
  message.value = '';
  try {
    profile.value = await authorizeCustomerPhone({
      provider_credential: providerCredential,
      consent: {
        type: 'PHONE_AUTHORIZATION',
        document_version: currentDocuments.phone_authorization.document_version,
        accepted: true,
      },
    }, currentProfile.version);
    consentAccepted.value = false;
    message.value = wasAuthorized ? '账户手机号已更新。' : '账户手机号已授权。';
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 409) {
      await loadPage(true);
    } else if (error instanceof StoreApiError && error.status === 429) {
      message.value = `请求较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后重试。`;
    } else {
      message.value = '手机号授权失败，请重新获取凭证后重试。';
    }
  } finally {
    mockCredential.value = '';
    pending.value = false;
  }
}

function submitMockAuthorization() {
  void authorize(mockCredential.value);
}

function handlePhoneCredential(event: { detail?: { code?: string; errMsg?: string } }) {
  const code = event.detail?.code;
  if (!code) {
    message.value = '未取得手机号授权凭证。';
    return;
  }
  void authorize(code);
}

function confirmRevoke() {
  const current = profile.value;
  if (current === null || !hasPhone.value || pending.value) return;
  void uni.showModal({
    cancelText: '取消',
    confirmColor: '#b84848',
    confirmText: '撤回授权',
    content: '撤回后不影响收货地址或历史交易快照。',
    title: '撤回账户手机号授权',
    success: async (result) => {
      if (!result.confirm) return;
      pending.value = true;
      message.value = '';
      try {
        profile.value = await revokeCustomerPhone(current.version);
        consentAccepted.value = false;
        message.value = '账户手机号授权已撤回。';
      } catch (error) {
        if (error instanceof StoreApiError && error.status === 401) {
          requireLogin();
        } else if (error instanceof StoreApiError && error.status === 409) {
          await loadPage(true);
        } else {
          message.value = '撤回失败，请稍后重试。';
        }
      } finally {
        pending.value = false;
      }
    },
  });
}

onLoad(() => {
  void loadPage();
});
</script>

<template>
  <QxStoreShell>
    <view class="qx-account-page">
      <QxAccountHeader title="手机号授权" />
      <QxCatalogState
        v-if="state !== 'ready'"
        :kind="state === 'loading' ? 'loading' : state"
        :retry-after-seconds="retryAfterSeconds"
        title="手机号状态加载失败"
        description="暂时无法读取最新授权状态。"
        action-label="重新加载"
        @action="loadPage"
      />
      <view v-else-if="profile && documents" class="qx-account-page__body">
        <view class="qx-account-panel">
          <text class="qx-account-panel__heading">账户手机号</text>
          <view class="phone-status">
            <text class="phone-status__value">{{ profile.phone_masked || '未授权' }}</text>
            <text class="qx-account-muted">
              {{ hasPhone ? `来源 ${profile.phone_source} · 已验证` : '独立于收货地址，自愿授权' }}
            </text>
          </view>
        </view>

        <!-- #ifdef H5 -->
        <label v-if="mockControlsEnabled" class="qx-account-field">
          <text class="qx-account-field__label">Mock 手机号凭证</text>
          <input
            v-model="mockCredential"
            aria-label="Mock 手机号凭证"
            class="qx-account-field__input"
            maxlength="512"
            password
            placeholder="请输入 development Mock 凭证"
          >
        </label>
        <!-- #endif -->

        <!-- #ifdef H5 -->
        <text v-if="!mockControlsEnabled" class="qx-account-notice qx-account-notice--error">
          当前 H5 构建未启用 development Mock 手机号授权。
        </text>
        <!-- #endif -->

        <label class="qx-account-check">
          <checkbox
            :checked="consentAccepted"
            aria-label="手机号授权说明"
            color="#496859"
            @click="consentAccepted = !consentAccepted"
          />
          <text>
            我已阅读并同意
            <button class="qx-account-link" @click.stop="openPhoneDocument">
              {{ documents.phone_authorization.title }}
            </button>
          </text>
        </label>

        <!-- #ifdef H5 -->
        <button
          class="qx-account-button"
          :disabled="pending || !mockControlsEnabled || !consentAccepted || mockCredential.trim().length === 0"
          @click="submitMockAuthorization"
        >
          {{ pending ? '正在提交…' : authorizationLabel }}
        </button>
        <!-- #endif -->
        <!-- #ifndef H5 -->
        <button
          class="qx-account-button"
          :disabled="pending || !consentAccepted"
          open-type="getPhoneNumber"
          @getphonenumber="handlePhoneCredential"
        >
          {{ pending ? '正在提交…' : authorizationLabel }}
        </button>
        <!-- #endif -->

        <button
          v-if="hasPhone"
          class="qx-account-button qx-account-button--secondary phone-revoke"
          :disabled="pending"
          @click="confirmRevoke"
        >
          撤回授权
        </button>
        <text v-if="message" class="qx-account-notice" role="status">
          {{ message }}
        </text>
        <text class="qx-account-notice">
          账户手机号不会从收货地址复制；撤回或重新授权也不会改写历史订单。
        </text>
      </view>
    </view>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.phone-status {
  display: flex;
  flex-direction: column;
  gap: 10rpx;
  padding: 28rpx;
}

.phone-status__value {
  font-size: 32rpx;
  font-weight: 800;
}

.phone-revoke {
  color: var(--qx-store-danger);
  border-color: #d9a9a0;
}
</style>
