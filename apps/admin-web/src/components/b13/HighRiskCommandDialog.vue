<script setup lang="ts">
import { Warning } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import type { HighRiskPreview } from '../../types/admin-b13';

const props = withDefaults(defineProps<{
  confirmLabel?: string;
  danger?: boolean;
  description: string;
  open: boolean;
  previewCommand: (reason: string, key: string, signal: AbortSignal) => Promise<HighRiskPreview>;
  confirmCommand: (
    reason: string,
    preview: HighRiskPreview,
    key: string,
    signal: AbortSignal,
  ) => Promise<unknown>;
  reasonRequired?: boolean;
  title: string;
}>(), {
  confirmLabel: '确认执行',
  danger: false,
  reasonRequired: true,
});

const emit = defineEmits<{
  'auth-expired': [error: AdminApiError];
  'completed': [result: unknown];
  'conflict': [];
  'update:open': [value: boolean];
}>();

const reason = ref('');
const preview = ref<HighRiskPreview | null>(null);
const pending = ref(false);
const slow = ref(false);
const uncertain = ref(false);
const errorMessage = ref('');
let controller: AbortController | null = null;
let slowTimer: ReturnType<typeof setTimeout> | null = null;
let confirmKey = '';

const reasonValid = computed(() => {
  if (!props.reasonRequired) return true;
  const value = reason.value.trim();
  return Array.from(value).length >= 2 && Array.from(value).length <= 500 && !/\p{Cc}/u.test(value);
});

const previewExpired = computed(() => preview.value !== null && Date.parse(preview.value.expires_at) <= Date.now());

function clearSlowTimer(): void {
  if (slowTimer !== null) clearTimeout(slowTimer);
  slowTimer = null;
  slow.value = false;
}

function startSlowTimer(): void {
  clearSlowTimer();
  slowTimer = setTimeout(() => { slow.value = true; }, 1_200);
}

function clearState(): void {
  controller?.abort();
  controller = null;
  clearSlowTimer();
  reason.value = '';
  preview.value = null;
  pending.value = false;
  uncertain.value = false;
  errorMessage.value = '';
  confirmKey = '';
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '服务响应无法安全确认，请稍后重试';
  if (error.status === 0) return '网络连接中断，操作结果尚未确认';
  if (error.status === 403) return '当前账号无权执行此操作';
  if (error.status === 404) return '目标资源不存在或已不可访问';
  if (error.status === 409) return '资源状态已经变化，请刷新后重新操作';
  if (error.status === 422) return '当前业务状态不允许此操作';
  if (error.status === 429) return error.retryAfterSeconds
    ? `操作过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '操作过于频繁，请稍后重试';
  if (error.status >= 500) return '服务暂时不可用，操作结果尚未确认';
  return error.message || '操作未完成，请稍后重试';
}

function isUncertain(error: unknown): boolean {
  return !(error instanceof AdminApiError) || error.status === 0 || error.status >= 500;
}

async function runPreview(): Promise<void> {
  if (pending.value || !reasonValid.value) return;
  pending.value = true;
  uncertain.value = false;
  errorMessage.value = '';
  controller?.abort();
  const current = new AbortController();
  controller = current;
  startSlowTimer();
  try {
    const result = await props.previewCommand(reason.value.trim(), newIdempotencyKey(), current.signal);
    if (Date.parse(result.expires_at) <= Date.now()) {
      errorMessage.value = '预览已过期，请重新生成';
      return;
    }
    preview.value = result;
    confirmKey = '';
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    if (error instanceof AdminApiError && (error.status === 404 || error.status === 409)) {
      emit('conflict');
      return;
    }
    errorMessage.value = isUncertain(error)
      ? '预览结果无法安全重放，请重新生成预览'
      : readableError(error);
  } finally {
    if (controller === current) {
      controller = null;
      pending.value = false;
      clearSlowTimer();
    }
  }
}

async function runConfirm(): Promise<void> {
  const currentPreview = preview.value;
  if (pending.value || currentPreview === null) return;
  if (Date.parse(currentPreview.expires_at) <= Date.now()) {
    preview.value = null;
    confirmKey = '';
    errorMessage.value = '预览已过期，请重新生成';
    return;
  }
  if (!confirmKey) confirmKey = newIdempotencyKey();
  pending.value = true;
  errorMessage.value = '';
  controller?.abort();
  const current = new AbortController();
  controller = current;
  startSlowTimer();
  try {
    const result = await props.confirmCommand(reason.value.trim(), currentPreview, confirmKey, current.signal);
    clearState();
    emit('update:open', false);
    emit('completed', result);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('auth-expired', error);
      return;
    }
    if (error instanceof AdminApiError && (error.status === 404 || error.status === 409)) {
      clearState();
      emit('update:open', false);
      emit('conflict');
      return;
    }
    uncertain.value = isUncertain(error);
    if (!uncertain.value) confirmKey = '';
    errorMessage.value = readableError(error);
  } finally {
    if (controller === current) {
      controller = null;
      pending.value = false;
      clearSlowTimer();
    }
  }
}

function revise(): void {
  preview.value = null;
  confirmKey = '';
  uncertain.value = false;
  errorMessage.value = '';
}

function close(): void {
  if (pending.value || uncertain.value) return;
  clearState();
  emit('update:open', false);
}

function abandon(): void {
  clearState();
  emit('update:open', false);
  emit('conflict');
}

watch(() => props.open, (open) => {
  if (!open) clearState();
}, { immediate: true });
onBeforeUnmount(clearState);
</script>

<template>
  <el-dialog
    :model-value="open"
    :title="title"
    width="min(560px, calc(100vw - 28px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!pending && !uncertain"
    :show-close="!pending && !uncertain"
    destroy-on-close
    @close="close"
  >
    <p class="b13-dialog-description">{{ description }}</p>
    <el-alert
      v-if="slow"
      title="请求仍在处理，请勿重复操作或关闭页面"
      type="info"
      :closable="false"
      show-icon
    />
    <el-alert
      v-if="uncertain"
      title="服务响应中断，请使用原请求标识重试确认，或放弃并刷新服务端状态。"
      type="warning"
      :closable="false"
      show-icon
    />
    <slot :locked="pending || preview !== null" />
    <el-form v-if="preview === null" label-position="top" class="dialog-form">
      <el-form-item v-if="reasonRequired" label="操作原因">
        <el-input
          v-model="reason"
          type="textarea"
          :rows="3"
          maxlength="500"
          show-word-limit
          placeholder="说明本次操作原因"
          :disabled="pending"
        />
      </el-form-item>
    </el-form>
    <section v-else class="b13-preview" data-testid="b13-command-preview">
      <div class="b13-preview-title">
        <el-icon><Warning /></el-icon>
        <strong>请核对操作影响</strong>
      </div>
      <p v-if="reasonRequired">原因：{{ reason.trim() }}</p>
      <dl>
        <template v-for="metric in preview.impact.metrics" :key="metric.key">
          <dt>{{ metric.label }}</dt>
          <dd>{{ metric.before ?? '无' }} → {{ metric.after ?? '无' }}</dd>
        </template>
      </dl>
      <ul v-if="preview.impact.warnings.length">
        <li v-for="warning in preview.impact.warnings" :key="warning">{{ warning }}</li>
      </ul>
      <small>影响 {{ preview.impact.affected_count }} 项 · 预览到期 {{ previewExpired ? '已过期' : '前有效' }}</small>
    </section>
    <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
    <template #footer>
      <el-button v-if="uncertain" :disabled="pending" @click="abandon">放弃并刷新</el-button>
      <el-button v-else :disabled="pending" @click="close">取消</el-button>
      <el-button v-if="preview !== null && !uncertain" :disabled="pending" @click="revise">返回修改</el-button>
      <el-button
        :type="danger ? 'danger' : 'primary'"
        :loading="pending"
        :disabled="preview === null ? !reasonValid : previewExpired"
        @click="preview === null ? runPreview() : runConfirm()"
      >
        {{ preview === null ? '生成操作预览' : (uncertain ? '使用原请求重试确认' : confirmLabel) }}
      </el-button>
    </template>
  </el-dialog>
</template>
