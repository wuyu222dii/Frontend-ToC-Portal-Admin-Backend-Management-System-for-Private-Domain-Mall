<script setup lang="ts">
/* global uni */
import { onLoad, onUnload } from '@dcloudio/uni-app';
import { computed, ref } from 'vue';

import { getAttributionCandidate, getLegalDocuments, loginWithWechat } from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { AttributionCandidate, LegalDocuments } from '../../types/store-identity';
import { clearCandidateToken, peekCandidateToken } from '../../utils/attribution-candidate';
import {
  clearProtectedAction,
  openCandidateDecisionPage,
  resumeProtectedAction,
} from '../../utils/protected-action';
import { isSafeHttpsUrl } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'error' | 'rate-limited';

const state = ref<PageState>('loading');
const documents = ref<LegalDocuments | null>(null);
const agreementAccepted = ref(false);
const privacyAccepted = ref(false);
const pending = ref(false);
const errorMessage = ref('');
const retryAfterSeconds = ref(0);
const mockCode = ref('');
const sourceCandidate = ref<AttributionCandidate | null>(null);
const sourceCandidateError = ref('');
const sourceCandidateReady = ref(true);
const loginMechanismAvailable = ref(true);
const mockCodeRequired = ref(false);
const authenticationCompleted = ref(false);
const candidateNavigationPending = ref(false);
const candidateNavigationFailed = ref(false);
const mockControlsEnabled = import.meta.env.DEV;
let preserveProtectedActionOnUnload = false;
let resumeCandidateDecisionAfterLogin = false;

const canLogin = computed(() => state.value === 'ready' && documents.value !== null &&
  agreementAccepted.value && privacyAccepted.value && loginMechanismAvailable.value &&
  (!mockCodeRequired.value || mockCode.value.trim().length > 0) &&
  sourceCandidateReady.value &&
  !authenticationCompleted.value &&
  !pending.value);

function errorCopy(error: unknown): string {
  if (error instanceof StoreApiError && error.status === 429) {
    return `请求较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后重试。`;
  }
  if (error instanceof StoreApiError && error.code === 'CONSENT_VERSION_MISMATCH') {
    return '协议版本已经更新，请重新阅读并勾选。';
  }
  if (error instanceof StoreApiError && error.code === 'ATTRIBUTION_CANDIDATE_MISMATCH') {
    return '推广候选已失效，本次不会建立该服务关系，请再次点击登录。';
  }
  if (error instanceof StoreApiError && error.status === 409) return '登录状态冲突，请重试。';
  if (error instanceof StoreApiError && error.status === 401) return '微信登录凭证无效，请重试。';
  return '暂时无法登录，请检查网络后重试。';
}

async function loadDocuments() {
  state.value = 'loading';
  errorMessage.value = '';
  retryAfterSeconds.value = 0;
  try {
    documents.value = await getLegalDocuments();
    state.value = 'ready';
  } catch (error) {
    documents.value = null;
    if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      state.value = 'rate-limited';
    } else {
      state.value = 'error';
    }
  }
}

async function loadSourceCandidate() {
  if (peekCandidateToken() === null) return;
  sourceCandidateReady.value = false;
  sourceCandidateError.value = '';
  try {
    const candidate = await getAttributionCandidate();
    sourceCandidate.value = candidate;
    if (candidate === null) {
      clearCandidateToken();
      sourceCandidateError.value = '推广候选已失效，本次登录不会建立该服务关系。';
    }
    sourceCandidateReady.value = true;
  } catch (error) {
    sourceCandidate.value = null;
    if (error instanceof StoreApiError && (error.status === 401 ||
      (error.status === 409 && error.code === 'ATTRIBUTION_CANDIDATE_MISMATCH'))) {
      clearCandidateToken();
      sourceCandidateError.value = '推广候选已过期，本次登录不会建立该服务关系。';
      sourceCandidateReady.value = true;
    } else {
      sourceCandidateError.value = '暂时无法验证推广来源，请重试后再登录。';
    }
  }
}

function openDocument(url: string) {
  if (!isSafeHttpsUrl(url)) return;
  // #ifdef H5
  window.open(url, '_blank', 'noopener,noreferrer');
  // #endif
  // #ifndef H5
  void uni.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
  // #endif
}

function platformLoginCode(): Promise<string> {
  // #ifdef H5
  if (!mockControlsEnabled) return Promise.reject(new Error('Mock login is disabled'));
  return Promise.resolve(mockCode.value.trim());
  // #endif
  // #ifndef H5
  // eslint-disable-next-line no-unreachable
  return new Promise((resolve, reject) => {
    uni.login({
      provider: 'weixin',
      success: (result) => result.code ? resolve(result.code) : reject(new Error('missing code')),
      fail: reject,
    });
  });
  // #endif
}

async function submitLogin() {
  const currentDocuments = documents.value;
  if (!canLogin.value || currentDocuments === null) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const code = await platformLoginCode();
    mockCode.value = '';
    const result = await loginWithWechat({
      code,
      consents: [
        {
          type: 'USER_AGREEMENT',
          document_version: currentDocuments.user_agreement.document_version,
          accepted: true,
        },
        {
          type: 'PRIVACY_POLICY',
          document_version: currentDocuments.privacy_policy.document_version,
          accepted: true,
        },
      ],
    });
    if (result.confirmation_required || resumeCandidateDecisionAfterLogin) {
      preserveProtectedActionOnUnload = true;
      authenticationCompleted.value = true;
      openCandidateDecision();
    } else {
      resumeProtectedAction();
    }
  } catch (error) {
    errorMessage.value = errorCopy(error);
    if (error instanceof StoreApiError && error.code === 'CONSENT_VERSION_MISMATCH') {
      agreementAccepted.value = false;
      privacyAccepted.value = false;
      await loadDocuments();
      errorMessage.value = '协议版本已经更新，请重新阅读并勾选。';
    } else if (error instanceof StoreApiError &&
      error.code === 'ATTRIBUTION_CANDIDATE_MISMATCH') {
      clearCandidateToken();
      sourceCandidate.value = null;
      sourceCandidateReady.value = true;
      sourceCandidateError.value = '推广候选已失效，本次登录不会建立该服务关系。';
    }
  } finally {
    mockCode.value = '';
    pending.value = false;
  }
}

function openCandidateDecision() {
  preserveProtectedActionOnUnload = true;
  candidateNavigationPending.value = true;
  candidateNavigationFailed.value = false;
  errorMessage.value = '';
  openCandidateDecisionPage({
    onFailure: () => {
      preserveProtectedActionOnUnload = false;
      candidateNavigationPending.value = false;
      candidateNavigationFailed.value = true;
      errorMessage.value = '登录已成功但确认页未打开，请点击下方按钮继续。';
    },
    onSuccess: () => {
      candidateNavigationPending.value = false;
    },
  });
}

onLoad((query) => {
  resumeCandidateDecisionAfterLogin = query?.resume_candidate === '1';
  // #ifdef H5
  loginMechanismAvailable.value = mockControlsEnabled;
  mockCodeRequired.value = mockControlsEnabled;
  // #endif
  void loadDocuments();
  void loadSourceCandidate();
});
onUnload(() => {
  if (!preserveProtectedActionOnUnload) clearProtectedAction();
});
</script>

<template>
  <QxStoreShell surface="white">
    <view class="qx-account-page login-page">
      <QxAccountHeader title="微信登录" />
      <QxCatalogState
        v-if="state !== 'ready'"
        :kind="state === 'loading' ? 'loading' : state"
        :retry-after-seconds="retryAfterSeconds"
        title="协议加载失败"
        description="登录前需要读取当前协议版本。"
        action-label="重新加载"
        @action="loadDocuments"
      />
      <view v-else class="qx-account-page__body login-page__body">
        <view class="login-brand" aria-label="青序生活">
          <view class="login-brand__mark" aria-hidden="true">
            青
          </view>
          <text class="login-brand__title">
            欢迎来到青序生活
          </text>
          <text class="qx-account-muted">
            登录后可管理本人资料、账户手机号和服务关系。
          </text>
        </view>

        <!-- #ifdef H5 -->
        <label v-if="mockControlsEnabled" class="qx-account-field">
          <text class="qx-account-field__label">Mock 微信 code</text>
          <input
            v-model="mockCode"
            aria-label="Mock 微信 code"
            class="qx-account-field__input"
            maxlength="512"
            password
          >
        </label>
        <!-- #endif -->

        <text v-if="sourceCandidate" class="qx-account-notice">
          本次登录来自 {{ sourceCandidate.display_name }} 的推广内容，登录后需确认或拒绝服务关系。
        </text>
        <view v-if="sourceCandidateError" class="qx-account-notice qx-account-notice--error">
          <text>{{ sourceCandidateError }}</text>
          <button
            v-if="!sourceCandidateReady"
            class="qx-account-link"
            @click="loadSourceCandidate"
          >
            重新读取推广来源
          </button>
        </view>

        <text v-if="!loginMechanismAvailable" class="qx-account-notice qx-account-notice--error">
          当前 H5 构建未启用 development Mock 登录。
        </text>

        <view v-if="documents" class="login-consents">
          <label class="qx-account-check">
            <checkbox
              :checked="agreementAccepted"
              aria-label="用户协议"
              color="#496859"
              @click="agreementAccepted = !agreementAccepted"
            />
            <text>
              我已阅读并同意
              <button
                class="qx-account-link"
                @click.stop="openDocument(documents.user_agreement.content_url)"
              >
                {{ documents.user_agreement.title }}
              </button>
            </text>
          </label>
          <label class="qx-account-check">
            <checkbox
              :checked="privacyAccepted"
              aria-label="隐私政策"
              color="#496859"
              @click="privacyAccepted = !privacyAccepted"
            />
            <text>
              我已阅读并同意
              <button
                class="qx-account-link"
                @click.stop="openDocument(documents.privacy_policy.content_url)"
              >
                {{ documents.privacy_policy.title }}
              </button>
            </text>
          </label>
        </view>

        <text v-if="errorMessage" class="qx-account-notice qx-account-notice--error" role="alert">
          {{ errorMessage }}
        </text>
        <button
          v-if="!authenticationCompleted"
          class="qx-account-button"
          :disabled="!canLogin"
          @click="submitLogin"
        >
          {{ pending ? '正在登录…' : '微信授权登录' }}
        </button>
        <button
          v-else-if="candidateNavigationFailed"
          class="qx-account-button"
          :disabled="candidateNavigationPending"
          @click="openCandidateDecision"
        >
          {{ candidateNavigationPending ? '正在打开…' : '打开服务关系确认页' }}
        </button>
        <text class="qx-account-notice">
          账户手机号是独立且自愿的授权项，登录不会读取收货地址手机号，也不会自动授权账户手机号。
        </text>
      </view>
    </view>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.login-page__body {
  padding-top: 72rpx;
}

.login-brand {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 14rpx;
  padding: 16rpx 0 28rpx;
  text-align: center;
}

.login-brand__mark {
  display: flex;
  width: 104rpx;
  height: 104rpx;
  align-items: center;
  justify-content: center;
  border-radius: 12rpx;
  color: #ffffff;
  background: var(--qx-store-brand);
  font-size: 48rpx;
}

.login-brand__title {
  font-size: 34rpx;
  font-weight: 800;
}

.login-consents {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
</style>
