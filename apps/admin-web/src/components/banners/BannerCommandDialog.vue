<script setup lang="ts">
import type { components } from '@qingxu/contracts';
import { computed, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  archiveAdminBanner,
  changeAdminBannerStatus,
  restoreAdminBanner,
} from '../../services/admin-banners';

type Banner = components['schemas']['BannerView'];
type BannerCommand = 'ACTIVATE' | 'ARCHIVE' | 'DEACTIVATE' | 'RESTORE';

interface CommandAttempt {
  key: string;
  signature: string;
}

const props = defineProps<{
  command: BannerCommand | null;
  open: boolean;
  target: Banner | null;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  completed: [banner: Banner];
  conflict: [target: Banner];
  'update:open': [value: boolean];
}>();

const reason = ref('');
const pending = ref(false);
const errorMessage = ref('');
const unknownOutcome = ref(false);
let attempt: CommandAttempt | null = null;

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && (pending.value || unknownOutcome.value)) return;
    emit('update:open', value);
  },
});

const needsReason = computed(() => props.command === 'ARCHIVE' || props.command === 'RESTORE');
const actionLabel = computed(() => ({
  ACTIVATE: '启用',
  ARCHIVE: '归档',
  DEACTIVATE: '停用',
  RESTORE: '恢复',
} as const)[props.command ?? 'ACTIVATE']);
const targetStatusLabel = computed(() => ({
  ACTIVATE: '已启用',
  ARCHIVE: '已归档',
  DEACTIVATE: '已停用',
  RESTORE: '草稿',
} as const)[props.command ?? 'ACTIVATE']);

function characterLength(value: string): number {
  return Array.from(value).length;
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 0 || error.status >= 500);
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return `${actionLabel.value} Banner 失败，请稍后重试`;
  if (error.status === 0) return '网络连接失败，操作结果尚未确认；可保持内容不变后重试';
  if (error.status === 403) return `当前账号无权${actionLabel.value} Banner`;
  if (error.status === 404) return 'Banner 不存在或已不可用，请刷新列表';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  if (error.status >= 500) return '服务暂时不可用，操作结果尚未确认；可保持内容不变后重试';
  return `当前状态不允许${actionLabel.value} Banner，请刷新后重试`;
}

function commandKey(signature: string): string {
  if (attempt?.signature !== signature) attempt = { key: newIdempotencyKey(), signature };
  return attempt.key;
}

function clearState(): void {
  reason.value = '';
  pending.value = false;
  errorMessage.value = '';
  unknownOutcome.value = false;
  attempt = null;
}

function closeForAuth(error: AdminApiError): void {
  const target = props.target;
  clearState();
  emit('update:open', false);
  if (target) emit('authExpired', error);
}

function closeForConflict(target: Banner): void {
  clearState();
  emit('update:open', false);
  emit('conflict', target);
}

async function submit(): Promise<void> {
  const target = props.target;
  const command = props.command;
  if (!target || !command || pending.value) return;

  const trimmedReason = reason.value.trim();
  errorMessage.value = '';
  if (needsReason.value && (characterLength(trimmedReason) < 2 || characterLength(trimmedReason) > 500)) {
    errorMessage.value = `${command === 'RESTORE' ? '恢复' : '归档'}原因须为 2–500 个字符`;
    return;
  }

  const signature = JSON.stringify({
    bannerId: target.banner_id,
    command,
    reason: needsReason.value ? trimmedReason : null,
    version: target.version,
  });
  pending.value = true;
  try {
    const key = commandKey(signature);
    let result: Banner;
    if (command === 'ACTIVATE' || command === 'DEACTIVATE') {
      result = await changeAdminBannerStatus(target.banner_id, command, target.version, key);
    } else if (command === 'ARCHIVE') {
      result = await archiveAdminBanner(target.banner_id, trimmedReason, target.version, key);
    } else {
      result = await restoreAdminBanner(target.banner_id, trimmedReason, target.version, key);
    }
    attempt = null;
    unknownOutcome.value = false;
    emit('update:open', false);
    emit('completed', result);
    clearState();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) {
      closeForAuth(error);
      return;
    }
    if (error instanceof AdminApiError && error.status === 409) {
      closeForConflict(target);
      return;
    }
    unknownOutcome.value = isUnknownOutcome(error);
    if (!unknownOutcome.value) attempt = null;
    errorMessage.value = readableError(error);
  } finally {
    pending.value = false;
  }
}

watch(
  [() => props.open, () => props.command, () => props.target?.banner_id, () => props.target?.version],
  () => clearState(),
);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    data-testid="banner-command-dialog"
    width="min(520px, calc(100vw - 28px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!pending && !unknownOutcome"
    :show-close="!pending && !unknownOutcome"
    destroy-on-close
    @closed="clearState"
  >
    <template #header>
      <div class="dialog-heading">
        <strong>{{ actionLabel }} Banner</strong>
        <p v-if="target">
          {{ target.title }} · v{{ target.version }}
        </p>
      </div>
    </template>

    <div class="banner-command-dialog">
      <el-alert
        :title="`${actionLabel}后状态为${targetStatusLabel}`"
        :description="command === 'RESTORE'
          ? '恢复固定回到草稿，后续启用需要重新确认。'
          : command === 'ARCHIVE'
            ? '归档记录仅在显式筛选已归档时返回。'
            : '资料与生命周期彼此独立，本操作不会修改 Banner 资料。'"
        :type="command === 'ARCHIVE' ? 'warning' : 'info'"
        :closable="false"
        show-icon
      />
      <el-alert
        v-if="unknownOutcome"
        title="操作结果尚未确认"
        description="为避免重复执行，当前操作已暂时锁定。请使用下方按钮重试。"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-form
        v-if="needsReason"
        class="command-form"
        label-position="top"
      >
        <el-form-item
          :label="command === 'RESTORE' ? '恢复原因' : '归档原因'"
          required
        >
          <el-input
            v-model="reason"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            :aria-label="command === 'RESTORE' ? '恢复原因' : '归档原因'"
            :disabled="pending || unknownOutcome"
            @input="errorMessage = ''"
          />
        </el-form-item>
      </el-form>

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
        :disabled="pending || unknownOutcome"
        @click="dialogOpen = false"
      >
        取消
      </el-button>
      <el-button
        :type="command === 'ARCHIVE' ? 'danger' : 'primary'"
        :loading="pending"
        data-testid="banner-command-submit"
        @click="submit"
      >
        {{ unknownOutcome ? `重试确认${actionLabel}` : `确认${actionLabel}` }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.banner-command-dialog {
  display: grid;
  min-width: 0;
  gap: 16px;
}

.dialog-heading {
  display: grid;
  gap: 4px;
}

.dialog-heading strong {
  font-size: 16px;
}

.dialog-heading p {
  min-width: 0;
  margin: 0;
  overflow: hidden;
  color: var(--admin-muted);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.command-form {
  margin-top: 2px;
}

.command-form :deep(.el-form-item) {
  margin-bottom: 0;
}

.form-error {
  margin: 0;
  color: var(--admin-danger);
  font-size: 12px;
  line-height: 1.55;
}
</style>
