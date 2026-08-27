<script setup lang="ts">
/* global uni */
import { onUnload } from '@dcloudio/uni-app';
import { computed, onBeforeUnmount, ref } from 'vue';

import { confirmAccountDeletion, previewAccountDeletion } from '../../api';
import { StoreApiError } from '../../api/store-client';
import QxAccountHeader from '../../components/storefront/QxAccountHeader.vue';
import QxStoreShell from '../../components/storefront/QxStoreShell.vue';
import type { DeletionPreview, DeletionResult } from '../../types/store-identity';
import { clearCustomerSession } from '../../utils/customer-session';
import { openLoginForAction } from '../../utils/protected-action';

const impactLabels: Record<DeletionPreview['impacts'][number], string> = {
  REVOKE_ALL_SESSIONS: '撤销所有设备会话',
  END_SERVICE_AGENT_BINDING: '结束当前服务代理绑定',
  INVALIDATE_ATTRIBUTION_CANDIDATES: '使待确认推广候选失效',
  ANONYMIZE_ACCOUNT_PROFILE: '匿名化账户与本人资料',
  DELETE_NON_TRANSACTIONAL_PII: '删除允许清理的非交易个人信息',
  ANONYMIZE_AGENT_HISTORY: '匿名化代理历史隐私投影',
  RETAIN_REQUIRED_TRANSACTION_FACTS: '按合规要求保留必要交易事实',
};

const blockerLabels: Record<string, string> = {
  ORDER: '未完成订单',
  AFTERSALE: '进行中售后',
  PAYMENT: '未结清支付',
  REFUND: '未结清退款',
  FINANCIAL_ANOMALY: '财务异常',
};

const acknowledged = ref(false);
const preview = ref<DeletionPreview | null>(null);
const result = ref<DeletionResult | null>(null);
const pending = ref(false);
const message = ref('');
const retryAfterSeconds = ref(0);
const uncertainResult = ref(false);
const now = ref(Date.now());
let countdown: ReturnType<typeof setInterval> | undefined;

const remainingSeconds = computed(() => {
  const expiresAt = preview.value?.eligible ? Date.parse(preview.value.expires_at) : 0;
  return Math.max(0, Math.ceil((expiresAt - now.value) / 1000));
});
const canConfirm = computed(() => acknowledged.value && preview.value?.eligible === true &&
  remainingSeconds.value > 0 && !pending.value);

function startCountdown() {
  stopCountdown();
  now.value = Date.now();
  countdown = setInterval(() => {
    now.value = Date.now();
    if (preview.value?.eligible && remainingSeconds.value === 0) {
      preview.value = null;
      message.value = '删除资格已过期，请重新检查。';
      stopCountdown();
    }
  }, 1000);
}

function stopCountdown() {
  if (countdown !== undefined) {
    clearInterval(countdown);
    countdown = undefined;
  }
}

function requireLogin() {
  preview.value = null;
  stopCountdown();
  clearCustomerSession();
  openLoginForAction({ type: 'PROFILE' });
}

async function checkEligibility(afterBlock = false) {
  if (!acknowledged.value || pending.value) return;
  pending.value = true;
  uncertainResult.value = false;
  message.value = '';
  retryAfterSeconds.value = 0;
  try {
    const nextPreview = await previewAccountDeletion();
    if (!acknowledged.value) {
      clearCapability();
      message.value = '已取消删除确认，请重新勾选并检查删除资格。';
      return;
    }
    preview.value = nextPreview;
    if (preview.value.eligible) startCountdown();
    else stopCountdown();
    if (afterBlock) message.value = '删除资格已变化，请先处理下列阻断事项。';
  } catch (error) {
    preview.value = null;
    stopCountdown();
    if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 429) {
      retryAfterSeconds.value = error.retryAfterSeconds ?? 1;
      message.value = `请求较频繁，请在 ${retryAfterSeconds.value} 秒后重试。`;
    } else {
      message.value = '暂时无法检查删除资格，请稍后重试。';
    }
  } finally {
    pending.value = false;
  }
}

function askForConfirmation() {
  if (!canConfirm.value || preview.value?.eligible !== true) return;
  void uni.showModal({
    cancelText: '取消',
    confirmColor: '#b84848',
    confirmText: '确认删除',
    content: '账号删除不可撤销，全部设备会话会立即失效。',
    title: '确认删除账号',
    success: (modalResult) => {
      if (modalResult.confirm) void submitDeletion();
    },
  });
}

async function submitDeletion() {
  const current = preview.value;
  if (!acknowledged.value || current?.eligible !== true ||
    remainingSeconds.value === 0 || pending.value) return;
  pending.value = true;
  message.value = '';
  try {
    result.value = await confirmAccountDeletion({
      acknowledged: true,
      preview_token: current.preview_token,
      confirmation_hash: current.confirmation_hash,
    }, current.account_version);
    preview.value = null;
    stopCountdown();
  } catch (error) {
    if (error instanceof StoreApiError && error.status === 422 &&
      error.code === 'ACCOUNT_DELETION_BLOCKED') {
      clearCapability();
      pending.value = false;
      await checkEligibility(true);
    } else if (error instanceof StoreApiError && error.status === 409) {
      preview.value = null;
      stopCountdown();
      message.value = '删除资格或账户版本已经变化，请重新检查后确认。';
    } else if (error instanceof StoreApiError && error.status === 401) {
      requireLogin();
    } else if (error instanceof StoreApiError && error.status === 429) {
      message.value = `请求较频繁，请在 ${error.retryAfterSeconds ?? 1} 秒后重试。`;
    } else {
      preview.value = null;
      stopCountdown();
      clearCustomerSession();
      uncertainResult.value = true;
      message.value = '提交结果未知，请勿重复提交。当前会话已清除；请返回首页，如需确认请联系平台客服。';
    }
  } finally {
    pending.value = false;
  }
}

function returnHome() {
  void uni.reLaunch({ url: '/pages/index/index' });
}

function clearCapability() {
  preview.value = null;
  stopCountdown();
}

function toggleAcknowledgement() {
  if (pending.value) return;
  acknowledged.value = !acknowledged.value;
  if (!acknowledged.value) {
    clearCapability();
    message.value = '已取消删除确认，请重新勾选并检查删除资格。';
  }
}

onBeforeUnmount(clearCapability);
onUnload(clearCapability);
</script>

<template>
  <QxStoreShell>
    <view class="qx-account-page">
      <QxAccountHeader title="账号删除" />
      <view v-if="result" class="deletion-complete" role="status">
        <view class="deletion-complete__mark" aria-hidden="true">✓</view>
        <text class="deletion-complete__title">账号已删除</text>
        <text class="qx-account-muted">所有设备会话已失效，本页不会保留删除能力或登录凭证。</text>
        <button class="qx-account-button" @click="returnHome">返回首页</button>
      </view>
      <view v-else class="qx-account-page__body">
        <view class="qx-account-panel">
          <text class="qx-account-panel__heading">删除账号的影响</text>
          <view class="deletion-list">
            <text v-for="label in Object.values(impactLabels)" :key="label">• {{ label }}</text>
          </view>
        </view>

        <label class="qx-account-check deletion-acknowledgement">
          <checkbox
            :checked="acknowledged"
            aria-label="知晓账号删除影响"
            color="#b84848"
            :disabled="pending"
            @click="toggleAcknowledgement"
          />
          <text>我已知晓账号删除不可撤销，并理解必要交易、协议和审计事实会按合规要求保留。</text>
        </label>

        <button
          class="qx-account-button qx-account-button--secondary"
          :disabled="!acknowledged || pending"
          @click="checkEligibility()"
        >
          {{ pending && !preview ? '正在检查…' : '检查删除资格' }}
        </button>

        <view v-if="preview" class="qx-account-panel">
          <text class="qx-account-panel__heading">
            {{ preview.eligible ? '当前可以删除账号' : '当前暂不可删除账号' }}
          </text>
          <view v-if="!preview.eligible" class="deletion-list deletion-list--blockers">
            <text v-for="blocker in preview.blockers" :key="blocker.resource_type">
              {{ blockerLabels[blocker.resource_type] }}：{{ blocker.count }} 项
            </text>
          </view>
          <view v-else class="deletion-eligible">
            <text class="qx-account-muted">确认能力将在 {{ remainingSeconds }} 秒后失效。</text>
            <button
              class="qx-account-button qx-account-button--danger"
              :disabled="!canConfirm"
              @click="askForConfirmation"
            >
              {{ remainingSeconds === 0 ? '资格已过期，请重新检查' : '确认删除账号' }}
            </button>
          </view>
        </view>

        <text v-if="message" class="qx-account-notice qx-account-notice--error" role="alert">
          {{ message }}
        </text>
        <button
          v-if="uncertainResult"
          class="qx-account-button qx-account-button--secondary"
          @click="returnHome"
        >
          返回首页
        </button>
      </view>
    </view>
  </QxStoreShell>
</template>

<style src="../../styles/account.css"></style>

<style scoped>
.deletion-list,
.deletion-eligible {
  display: flex;
  flex-direction: column;
  gap: 14rpx;
  padding: 28rpx;
  color: var(--qx-store-text-soft);
  font-size: 22rpx;
  line-height: 1.55;
}

.deletion-list--blockers {
  color: var(--qx-store-danger);
  font-weight: 700;
}

.deletion-acknowledgement {
  padding: 20rpx 4rpx;
}

.deletion-complete {
  display: flex;
  min-height: 70vh;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24rpx;
  padding: 48rpx 32rpx;
  text-align: center;
}

.deletion-complete__mark {
  display: flex;
  width: 104rpx;
  height: 104rpx;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: #ffffff;
  background: var(--qx-store-brand);
  font-size: 48rpx;
}

.deletion-complete__title {
  font-size: 36rpx;
  font-weight: 800;
}

.deletion-complete .qx-account-button {
  max-width: 480rpx;
}
</style>
