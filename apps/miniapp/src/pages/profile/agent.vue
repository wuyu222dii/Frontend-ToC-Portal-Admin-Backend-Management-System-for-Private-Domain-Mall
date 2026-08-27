<script setup lang="ts">
/* global getCurrentPages, uni */
import { onLoad, onShow, onUnload } from '@dcloudio/uni-app';
import { onBeforeUnmount, ref } from 'vue';

import {
  confirmAttributionCandidate,
  createAttributionCandidate,
  getAttributionCandidate,
  getServiceAgent,
  rejectAttributionCandidate,
} from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxCatalogState from '../../components/storefront/QxCatalogState.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { AttributionCandidate, ServiceAgent } from '../../types/store-identity';
import { clearCandidateToken, peekCandidateToken } from '../../utils/attribution-candidate';
import { clearCustomerSession, hasRefreshableCustomerSession } from '../../utils/customer-session';
import {
  clearProtectedAction,
  openLoginForAction,
  peekProtectedAction,
  replaceWithLoginForCandidateDecision,
  resumeProtectedAction,
} from '../../utils/protected-action';
import { isSafeHttpsUrl, openHome } from '../../utils/store-navigation';

type PageState = 'loading' | 'ready' | 'error' | 'rate-limited';

const state = ref<PageState>('loading');
const candidate = ref<AttributionCandidate | null>(null);
const serviceAgent = ref<ServiceAgent | null>(null);
const publicFallbackUrl = ref<string | null>(null);
const pending = ref(false);
const message = ref('');
const retryAfterSeconds = ref(0);
const candidateRemainingSeconds = ref(0);
let promotionInput: { invite_code: string; promotion_asset_id: string } | null = null;
let candidateTimer: ReturnType<typeof setInterval> | undefined;
let candidateExpiresAt = 0;
let skipInitialShowReload = true;
let clearsHandoffOnUnload = false;

const signedIn = ref(hasRefreshableCustomerSession());

function requireLogin() {
  const action = peekProtectedAction();
  if (action === null) {
    openLoginForAction({ type: 'SERVICE_AGENT' });
    return;
  }
  const previousClearOnUnload = clearsHandoffOnUnload;
  clearsHandoffOnUnload = false;
  replaceWithLoginForCandidateDecision({
    onFailure: () => {
      clearsHandoffOnUnload = previousClearOnUnload;
      message.value = '会话已失效，暂时无法打开登录页，请重试。';
    },
  });
}

function replaceWithPublicTargetOrHome(publicTargetUrl: string | null) {
  if (publicTargetUrl === null || !isSafeHttpsUrl(publicTargetUrl)) {
    openHome();
    return;
  }
  // #ifdef H5
  window.location.assign(publicTargetUrl);
  // #endif
  // #ifndef H5
  void uni.reLaunch({
    url: `/pages/webview/index?url=${encodeURIComponent(publicTargetUrl)}`,
  });
  // #endif
}

function returnAfterCandidateDecision(publicTargetUrl: string | null) {
  if (clearsHandoffOnUnload || peekProtectedAction() !== null) {
    clearsHandoffOnUnload = false;
    resumeProtectedAction();
    return;
  }
  if (getCurrentPages().length <= 1) {
    replaceWithPublicTargetOrHome(publicTargetUrl);
    return;
  }
  void uni.navigateBack({
    fail: () => replaceWithPublicTargetOrHome(publicTargetUrl),
  });
}

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value);
}

function stopCandidateTimer() {
  if (candidateTimer !== undefined) {
    clearInterval(candidateTimer);
    candidateTimer = undefined;
  }
}

function applyCandidate(next: AttributionCandidate | null) {
  stopCandidateTimer();
  candidateExpiresAt = next === null ? 0 : Date.parse(next.expires_at);
  candidateRemainingSeconds.value = next === null
    ? 0
    : Math.max(0, Math.ceil((candidateExpiresAt - Date.now()) / 1000));
  if (next === null) {
    candidate.value = null;
    return;
  }
  if (candidateRemainingSeconds.value === 0) {
    candidate.value = null;
    clearCandidateToken();
    message.value = '推广候选已过期，请重新打开有效推广链接。';
    return;
  }
  candidate.value = next;
  candidateTimer = setInterval(() => {
    candidateRemainingSeconds.value = Math.max(
      0,
      Math.ceil((candidateExpiresAt - Date.now()) / 1000),
    );
    if (candidateRemainingSeconds.value === 0) {
      stopCandidateTimer();
      candidate.value = null;
      clearCandidateToken();
      message.value = '推广候选已过期，请重新打开有效推广链接。';
    }
  }, 1000);
}

async function loadCurrentRelationship() {
  if (!signedIn.value) {
    if (peekCandidateToken() === null) {
      requireLogin();
      return;
    }
    applyCandidate(await getAttributionCandidate());
    return;
  }
  const [currentAgent, currentCandidate] = await Promise.all([
    getServiceAgent(),
    getAttributionCandidate(),
  ]);
  serviceAgent.value = currentAgent;
  applyCandidate(currentAgent === null ? currentCandidate : null);
}

async function loadPage(conflict = false, decisionTargetUrl: string | null = null) {
  signedIn.value = hasRefreshableCustomerSession();
  state.value = 'loading';
  message.value = '';
  retryAfterSeconds.value = 0;
  publicFallbackUrl.value = null;
  try {
    if (promotionInput !== null) {
      const created = await createAttributionCandidate(promotionInput);
      applyCandidate(created.candidate);
      serviceAgent.value = created.service_agent;
      publicFallbackUrl.value = created.public_fallback?.public_target_url ?? null;
      promotionInput = null;
      if (created.service_agent !== null) {
        state.value = 'ready';
        returnAfterCandidateDecision(null);
        return;
      }
    } else {
      await loadCurrentRelationship();
    }
    state.value = 'ready';
    if (clearsHandoffOnUnload && candidate.value === null) {
      returnAfterCandidateDecision(decisionTargetUrl);
      return;
    }
    if (conflict && candidate.value === null) {
      returnAfterCandidateDecision(decisionTargetUrl);
      return;
    }
    if (conflict) message.value = '服务关系已经变化，已刷新为最新结果。';
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 401) {
      if (signedIn.value) {
        clearCustomerSession();
        requireLogin();
      } else {
        clearCandidateToken();
        applyCandidate(null);
        message.value = '推广候选已过期，请重新打开有效推广链接。';
        state.value = 'ready';
      }
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

async function confirmRelationship() {
  if (candidate.value === null || pending.value) return;
  const decisionTargetUrl = candidate.value.public_target_url;
  signedIn.value = hasRefreshableCustomerSession();
  if (!signedIn.value) {
    requireLogin();
    return;
  }
  pending.value = true;
  message.value = '';
  try {
    serviceAgent.value = await confirmAttributionCandidate();
    applyCandidate(null);
    void uni.showToast({ icon: 'success', title: '服务关系已确认' });
    returnAfterCandidateDecision(decisionTargetUrl);
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 409) {
      await loadPage(true, decisionTargetUrl);
    } else if (error instanceof StoreApiError && error.status === 401) {
      clearCustomerSession();
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 429) {
      message.value = `请求较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后重试。`;
    } else {
      message.value = '确认失败，请稍后重试。';
    }
  } finally {
    pending.value = false;
  }
}

async function rejectRelationship() {
  if (candidate.value === null || pending.value) return;
  const decisionTargetUrl = candidate.value.public_target_url;
  signedIn.value = hasRefreshableCustomerSession();
  if (!signedIn.value) {
    requireLogin();
    return;
  }
  pending.value = true;
  message.value = '';
  try {
    await rejectAttributionCandidate();
    applyCandidate(null);
    void uni.showToast({ icon: 'none', title: '已暂不绑定' });
    returnAfterCandidateDecision(decisionTargetUrl);
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 409) {
      await loadPage(true, decisionTargetUrl);
    } else if (error instanceof StoreApiError && error.status === 401) {
      clearCustomerSession();
      requireLogin();
    } else {
      message.value = '暂时无法处理，请稍后重试。';
    }
  } finally {
    pending.value = false;
  }
}

function openPublicTarget(url: string | null) {
  if (!url || !isSafeHttpsUrl(url)) return;
  // #ifdef H5
  window.open(url, '_blank', 'noopener,noreferrer');
  // #endif
  // #ifndef H5
  void uni.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
  // #endif
}

function openFallback() {
  openPublicTarget(publicFallbackUrl.value);
}

onLoad((query) => {
  clearsHandoffOnUnload = query?.source === 'login';
  const inviteCode = typeof query?.invite_code === 'string' ? query.invite_code : '';
  const promotionAssetId = typeof query?.promotion_asset_id === 'string'
    ? query.promotion_asset_id
    : '';
  if ((inviteCode.length > 0 || promotionAssetId.length > 0) &&
    (inviteCode.length < 1 || inviteCode.length > 128 || !isUlid(promotionAssetId))) {
    state.value = 'error';
    message.value = '推广链接格式无效。';
    return;
  }
  if (inviteCode.length > 0) {
    promotionInput = { invite_code: inviteCode, promotion_asset_id: promotionAssetId };
  }
  void loadPage();
});

onBeforeUnmount(stopCandidateTimer);
onShow(() => {
  signedIn.value = hasRefreshableCustomerSession();
  if (skipInitialShowReload) {
    skipInitialShowReload = false;
    if (candidate.value !== null) applyCandidate(candidate.value);
    return;
  }
  void loadPage();
});
onUnload(() => {
  stopCandidateTimer();
  if (clearsHandoffOnUnload) clearProtectedAction();
});
</script>

<template>
  <QxStoreShell>
    <view class="qx-account-page">
      <QxAccountHeader title="服务代理" />
      <QxCatalogState
        v-if="state !== 'ready'"
        :kind="state === 'loading' ? 'loading' : state"
        :retry-after-seconds="retryAfterSeconds"
        title="服务关系加载失败"
        description="暂时无法读取最新服务关系。"
        action-label="重新加载"
        @action="loadPage"
      />
      <view v-else class="qx-account-page__body">
        <section v-if="serviceAgent" class="agent-hero" aria-label="当前服务代理">
          <text class="agent-hero__eyebrow">CURRENT SERVICE AGENT</text>
          <text class="agent-hero__name">{{ serviceAgent.display_name }}</text>
          <text class="agent-hero__status">服务关系已确认</text>
          <text class="agent-hero__meta">代理编号 {{ serviceAgent.agent_id }}</text>
          <text class="agent-hero__meta">绑定于 {{ serviceAgent.bound_at }}</text>
        </section>

        <view v-else-if="candidate" class="qx-account-panel">
          <text class="qx-account-panel__heading">待确认服务关系</text>
          <view class="agent-candidate">
            <text class="agent-candidate__name">{{ candidate.display_name }}</text>
            <text class="qx-account-muted">代理编号 {{ candidate.agent_id }}</text>
            <text class="qx-account-muted">剩余 {{ candidateRemainingSeconds }} 秒</text>
            <button
              class="qx-account-link"
              @click="openPublicTarget(candidate.public_target_url)"
            >
              查看推广内容
            </button>
          </view>
          <view class="agent-candidate__actions">
            <button
              class="qx-account-button"
              :disabled="pending"
              @click="confirmRelationship"
            >
              {{ signedIn ? '确认服务关系' : '登录后确认' }}
            </button>
            <button
              class="qx-account-button qx-account-button--secondary"
              :disabled="pending"
              @click="rejectRelationship"
            >
              暂不绑定
            </button>
          </view>
        </view>

        <view v-else-if="publicFallbackUrl" class="qx-account-panel agent-empty">
          <text class="qx-account-panel__heading">推广归因不可用</text>
          <text class="qx-account-muted">该公开内容仍可浏览，但不会建立服务关系。</text>
          <button class="qx-account-button qx-account-button--secondary" @click="openFallback">
            继续浏览公开内容
          </button>
        </view>

        <view v-else class="qx-account-panel agent-empty">
          <text class="qx-account-panel__heading">暂无服务代理</text>
          <text class="qx-account-muted">通过有效代理推广入口登录后，可明确确认服务关系。</text>
        </view>

        <text v-if="message" class="qx-account-notice" role="status">
          {{ message }}
        </text>
        <text class="qx-account-notice">
          商品价格、发货和售后由总部商城统一负责；服务代理关系不会改变这些权益。
        </text>
      </view>
    </view>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.agent-hero {
  display: flex;
  min-height: 224rpx;
  flex-direction: column;
  justify-content: center;
  gap: 12rpx;
  padding: 32rpx;
  border-radius: 12rpx;
  color: #ffffff;
  background: var(--qx-store-brand-strong);
}

.agent-hero__eyebrow,
.agent-hero__meta {
  color: #dbe7e0;
  font-size: 20rpx;
}

.agent-hero__status {
  align-self: flex-start;
  padding: 6rpx 12rpx;
  border-radius: 8rpx;
  color: #173b31;
  background: #dbe7e0;
  font-size: 20rpx;
  font-weight: 700;
}

.agent-hero__name,
.agent-candidate__name {
  font-size: 34rpx;
  font-weight: 800;
}

.agent-candidate,
.agent-empty {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding: 28rpx;
}

.agent-candidate__actions {
  display: grid;
  gap: 16rpx;
  padding: 0 28rpx 28rpx;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
</style>
