<script setup lang="ts">
import { Warning } from '@element-plus/icons-vue';
import { computed, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  previewAdminManualCompensation,
  previewAdminRefundRetry,
  type HighRiskPreview,
  type ManualCompensationInput,
} from '../../services/admin-aftersales';
import {
  AdminRefundCommandJournalError,
  executeAdminRefundCommandJournal,
  isCertainAdminRefundCommandFailure,
  prepareAdminRefundCommandJournal,
  previewFromAdminRefundCommand,
  recoverAdminRefundCommandJournal,
  recoverVolatileAdminRefundCommand,
  type AdminRefundCommandJournal,
} from '../../services/admin-refund-command-journal';
import type { AdminOrderDetail } from '../../types/orders';

export type OrderRefundCommandMode = 'MANUAL_COMPENSATION' | 'RETRY_REFUND';

const props = defineProps<{
  mode: OrderRefundCommandMode;
  open: boolean;
  order: AdminOrderDetail;
}>();

const emit = defineEmits<{
  'auth-expired': [error: AdminApiError];
  completed: [message: string];
  conflict: [];
  'update:open': [value: boolean];
}>();

const reason = ref('');
const orderItemId = ref('');
const amount = ref('');
const preview = ref<HighRiskPreview | null>(null);
const pending = ref(false);
const uncertain = ref(false);
const reasonRecoveryRequired = ref(false);
const journalRecoveryBlocked = ref(false);
const errorMessage = ref('');
const activeJournal = ref<AdminRefundCommandJournal | null>(null);
let previewAttempt: { key: string; signature: string } | null = null;
let restoreSequence = 0;

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && (pending.value || uncertain.value)) return;
    emit('update:open', value);
  },
});
const title = computed(() => props.mode === 'MANUAL_COMPENSATION' ? '创建纯金额补偿' : '重试失败退款');
const latestFailedRefund = computed(() => {
  const latestByRefund = new Map<string, AdminOrderDetail['refund_attempts'][number]>();
  for (const attempt of props.order.refund_attempts) {
    if (attempt.origin_type === 'LATE_PAYMENT') continue;
    const current = latestByRefund.get(attempt.refund_id);
    if (current === undefined || attempt.attempt_no > current.attempt_no) {
      latestByRefund.set(attempt.refund_id, attempt);
    }
  }
  return [...latestByRefund.values()]
    .filter(({ status }) => status === 'FAILED')
    .sort((left, right) => {
      const updatedDifference = Date.parse(right.updated_at) - Date.parse(left.updated_at);
      return updatedDifference || left.refund_id.localeCompare(right.refund_id);
    })[0] ?? null;
});
const validMoney = computed(() => /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/.test(amount.value.trim()));
const valid = computed(() => {
  const reasonLength = Array.from(reason.value.trim()).length;
  if (pending.value || journalRecoveryBlocked.value || reasonLength < 2 || reasonLength > 500) return false;
  if (activeJournal.value !== null) {
    return activeJournal.value.mode === props.mode && activeJournal.value.order_id === props.order.order_id;
  }
  if (props.mode === 'RETRY_REFUND') return latestFailedRefund.value !== null;
  return orderItemId.value.length > 0 && validMoney.value;
});

function reset(): void {
  const currentRestore = ++restoreSequence;
  reason.value = '';
  orderItemId.value = props.order.items[0]?.order_item_id ?? '';
  amount.value = '';
  preview.value = null;
  pending.value = false;
  uncertain.value = false;
  reasonRecoveryRequired.value = false;
  journalRecoveryBlocked.value = false;
  errorMessage.value = '';
  activeJournal.value = null;
  previewAttempt = null;
  if (props.open) void restorePendingJournal(currentRestore);
}

async function restorePendingJournal(currentRestore: number): Promise<void> {
  try {
    const journal = await recoverAdminRefundCommandJournal();
    if (currentRestore !== restoreSequence || !props.open || journal === null ||
      journal.mode !== props.mode || journal.order_id !== props.order.order_id) return;
    const volatile = recoverVolatileAdminRefundCommand(journal);
    activeJournal.value = journal;
    reason.value = volatile?.input.reason ?? '';
    reasonRecoveryRequired.value = volatile === null;
    if (journal.mode === 'MANUAL_COMPENSATION') {
      orderItemId.value = journal.order_item_id;
      amount.value = journal.amount;
    }
    preview.value = volatile?.preview ?? previewFromAdminRefundCommand(journal);
    uncertain.value = true;
    errorMessage.value = volatile === null
      ? '上次确认原因未保存在浏览器中，请输入完全相同的原因后继续核验。'
      : '上次请求结果尚未确认，原确认操作已恢复。';
  } catch (error) {
    if (currentRestore !== restoreSequence) return;
    pending.value = false;
    uncertain.value = false;
    reasonRecoveryRequired.value = false;
    journalRecoveryBlocked.value = true;
    errorMessage.value = error instanceof AdminRefundCommandJournalError
      ? '无法安全读取待确认资金操作，当前禁止发起新的确认。'
      : '暂时无法核验待确认资金操作，请稍后重试。';
  }
}

function businessBody(): ManualCompensationInput | { reason: string } {
  if (props.mode === 'RETRY_REFUND') return { reason: reason.value.trim() };
  return {
    amount: amount.value.trim(),
    order_item_id: orderItemId.value,
    reason: reason.value.trim(),
  };
}

function signature(): string {
  return JSON.stringify({
    body: businessBody(),
    mode: props.mode,
    order: props.order.order_id,
    refund: props.mode === 'RETRY_REFUND' ? latestFailedRefund.value?.refund_id ?? null : null,
    stage: 'PREVIEW',
    version: props.order.version,
  });
}

function stablePreviewKey(): string {
  const value = signature();
  if (previewAttempt?.signature !== value) previewAttempt = { key: newIdempotencyKey(), signature: value };
  return previewAttempt.key;
}

function clearPreview(): void {
  preview.value = null;
  previewAttempt = null;
  uncertain.value = false;
  reasonRecoveryRequired.value = false;
  errorMessage.value = '';
}

function readableError(error: unknown): string {
  if (error instanceof AdminRefundCommandJournalError) {
    if (error.code === 'REQUEST_MISMATCH') return '输入的原因与上次确认不一致，未发送请求';
    if (error.code === 'PENDING_COMMAND') return '已有资金操作等待核验，请先恢复原确认操作';
    return '无法安全保存或读取确认操作，未发送请求';
  }
  if (!(error instanceof AdminApiError)) return '服务响应无法确认，请保持内容不变后重试';
  if (error.status === 0) return '网络连接中断，结果尚未确认；请保持内容不变后重试';
  if (error.status === 403) return '当前账号无权执行该资金操作';
  if (error.status === 404) return '订单或退款事实已不存在';
  if (error.status === 422) return error.code === 'AFTERSALE_QUOTA_EXCEEDED'
    ? '订单项剩余可补偿金额不足，请刷新订单'
    : '当前业务条件不满足该操作';
  if (error.status === 429) return error.retryAfterSeconds
    ? `操作过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '操作过于频繁，请稍后重试';
  return '资金操作未完成，请刷新订单后重试';
}

function handleError(error: unknown, stage: 'CONFIRM' | 'PREVIEW'): void {
  if (error instanceof AdminApiError && error.status === 401) {
    uncertain.value = activeJournal.value !== null;
    emit('auth-expired', error);
    return;
  }
  if (error instanceof AdminApiError && error.status === 409 &&
    error.code !== 'SESSION_CHANGED' && error.code !== 'STATE_CONFLICT') {
    activeJournal.value = null;
    reasonRecoveryRequired.value = false;
    emit('conflict');
    return;
  }
  if (stage === 'PREVIEW') {
    const responseCannotBeReplayed = !(error instanceof AdminApiError) || error.status === 0 || error.status >= 500;
    previewAttempt = null;
    uncertain.value = false;
    errorMessage.value = responseCannotBeReplayed
      ? '预览结果无法安全重放，请重新生成预览'
      : readableError(error);
    return;
  }
  uncertain.value = !(error instanceof AdminApiError) || error.status === 0 || error.status >= 500;
  if (error instanceof AdminRefundCommandJournalError ||
    (error instanceof AdminApiError && ['SESSION_CHANGED', 'STATE_CONFLICT'].includes(error.code)) ||
    (error instanceof AdminApiError && [401, 429].includes(error.status))) {
    uncertain.value = activeJournal.value !== null;
  } else if (isCertainAdminRefundCommandFailure(error)) {
    activeJournal.value = null;
    preview.value = null;
    previewAttempt = null;
    reasonRecoveryRequired.value = false;
  }
  errorMessage.value = readableError(error);
}

async function requestPreview(): Promise<void> {
  if (!valid.value) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    const key = stablePreviewKey();
    if (props.mode === 'MANUAL_COMPENSATION') {
      preview.value = await previewAdminManualCompensation(
        props.order.order_id,
        businessBody() as ManualCompensationInput,
        key,
      );
    } else if (latestFailedRefund.value) {
      preview.value = await previewAdminRefundRetry(
        latestFailedRefund.value.refund_id,
        businessBody() as { reason: string },
        key,
      );
    }
    previewAttempt = null;
    activeJournal.value = null;
    uncertain.value = false;
    reasonRecoveryRequired.value = false;
  } catch (error) {
    handleError(error, 'PREVIEW');
  } finally {
    pending.value = false;
  }
}

async function confirm(): Promise<void> {
  const currentPreview = preview.value;
  if (!valid.value || !currentPreview) return;
  pending.value = true;
  errorMessage.value = '';
  try {
    let journal = activeJournal.value;
    if (journal === null) {
      if (props.mode === 'MANUAL_COMPENSATION') {
        journal = await prepareAdminRefundCommandJournal({
          mode: props.mode,
          order_id: props.order.order_id,
          input: businessBody() as ManualCompensationInput,
          preview: currentPreview,
        });
      } else if (latestFailedRefund.value) {
        journal = await prepareAdminRefundCommandJournal({
          mode: props.mode,
          order_id: props.order.order_id,
          refund_id: latestFailedRefund.value.refund_id,
          input: businessBody() as { reason: string },
          preview: currentPreview,
        });
      } else return;
      activeJournal.value = journal;
    }
    await executeAdminRefundCommandJournal(journal, reason.value.trim());
    activeJournal.value = null;
    emit('update:open', false);
    emit('completed', props.mode === 'MANUAL_COMPENSATION' ? '金额补偿已创建并进入退款处理' : '退款重试已提交');
    reset();
  } catch (error) {
    handleError(error, 'CONFIRM');
  } finally {
    pending.value = false;
  }
}

function submit(): void {
  if (preview.value) void confirm();
  else void requestPreview();
}

watch([() => props.open, () => props.mode, () => props.order.version], reset);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    :data-testid="`order-refund-command-${mode.toLowerCase()}`"
    width="min(580px, calc(100vw - 24px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!pending && !uncertain"
    :show-close="!pending && !uncertain"
    destroy-on-close
    @closed="reset"
  >
    <template #header>
      <div class="command-heading">
        <el-icon><Warning /></el-icon><div><strong>{{ title }}</strong><p>{{ order.order_no }} · v{{ order.version }}</p></div>
      </div>
    </template>
    <div class="command-body">
      <el-alert
        v-if="uncertain"
        title="上次请求结果尚未确认"
        description="请使用原确认操作继续核验；重新登录后仍会恢复同一幂等键。"
        type="warning"
        :closable="false"
        show-icon
      />
      <fieldset :disabled="pending || journalRecoveryBlocked">
        <el-form label-position="top">
          <template v-if="mode === 'MANUAL_COMPENSATION'">
            <el-form-item
              label="订单商品"
              required
            >
              <el-select
                v-model="orderItemId"
                class="full-width"
                :disabled="uncertain || preview !== null"
                placeholder="选择需要补偿的订单项"
              >
                <el-option
                  v-for="item in order.items"
                  :key="item.order_item_id"
                  :label="`${item.product_name} · ${item.sku_name}`"
                  :value="item.order_item_id"
                />
              </el-select>
            </el-form-item>
            <el-form-item
              label="补偿金额"
              required
            >
              <el-input
                v-model="amount"
                :disabled="uncertain || preview !== null"
                inputmode="decimal"
                placeholder="0.01"
                maxlength="19"
              >
                <template #prepend>
                  ¥
                </template>
              </el-input>
            </el-form-item>
          </template>
          <el-alert
            v-else-if="latestFailedRefund"
            :title="`将重试 ${latestFailedRefund.refund_no}，金额 ¥${latestFailedRefund.amount}`"
            type="info"
            :closable="false"
          />
          <el-form-item
            class="reason-field"
            label="操作原因"
            required
          >
            <el-input
              v-model="reason"
              :disabled="(uncertain || preview !== null) && !reasonRecoveryRequired"
              data-testid="order-refund-command-recovery-reason"
              type="textarea"
              :rows="3"
              maxlength="500"
              show-word-limit
              placeholder="请输入 2–500 个字符"
            />
          </el-form-item>
        </el-form>
      </fieldset>

      <section
        v-if="preview"
        class="preview-impact"
        data-testid="order-refund-command-preview"
      >
        <header><strong>服务端影响预览</strong><span>有效至 {{ new Date(preview.expires_at).toLocaleTimeString() }}</span></header>
        <div
          v-for="metric in preview.impact.metrics"
          :key="metric.key"
        >
          <span>{{ metric.label }}</span><strong>{{ metric.before ?? '—' }} → {{ metric.after ?? '—' }}</strong>
        </div>
        <p
          v-for="warning in preview.impact.warnings"
          :key="warning"
        >
          {{ warning }}
        </p>
        <el-button
          v-if="!uncertain"
          text
          @click="clearPreview"
        >
          返回修改
        </el-button>
      </section>
      <p
        v-if="errorMessage"
        class="form-error"
        role="alert"
      >
        {{ errorMessage }}
      </p>
    </div>
    <template #footer>
      <el-button
        :disabled="pending || uncertain"
        @click="dialogOpen = false"
      >
        取消
      </el-button>
      <el-button
        type="primary"
        :loading="pending"
        :disabled="!valid"
        data-testid="order-refund-command-submit"
        @click="submit"
      >
        {{ preview ? '确认执行' : '预览影响' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.command-heading { display: flex; align-items: center; gap: 12px; }
.command-heading > .el-icon { width: 34px; height: 34px; border-radius: 6px; color: var(--admin-danger); background: #fff0ef; font-size: 19px; }
.command-heading div { display: grid; gap: 3px; }
.command-heading strong { font-size: 16px; }
.command-heading p { margin: 0; color: var(--admin-muted); font-size: 11px; }
.command-body { display: grid; gap: 16px; }
fieldset { min-width: 0; margin: 0; padding: 0; border: 0; }
.full-width { width: 100%; }
.reason-field { margin-top: 14px; }
.preview-impact { display: grid; gap: 10px; padding: 15px; border: 1px solid #b9d2c6; border-radius: 7px; background: #f2f8f5; }
.preview-impact header, .preview-impact > div { display: flex; min-width: 0; align-items: center; justify-content: space-between; gap: 12px; }
.preview-impact header span, .preview-impact > div { color: var(--admin-text-soft); font-size: 12px; }
.preview-impact p, .form-error { margin: 0; color: var(--admin-danger); font-size: 12px; }
@media (max-width: 520px) { .preview-impact header { align-items: flex-start; flex-direction: column; } }
</style>
