<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  confirmInventoryAdjustment,
  previewInventoryAdjustment,
} from '../../services/admin-inventory';
import type {
  InventoryAdjustmentInput,
  InventoryAdjustmentPreview,
  InventoryItem,
} from '../../types/inventory';

interface CommandAttempt {
  key: string;
  signature: string;
}

const POSTGRES_INTEGER_MIN = -2_147_483_648;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

const props = defineProps<{
  item: InventoryItem | null;
  open: boolean;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  completed: [];
  conflict: [];
  'update:open': [value: boolean];
}>();

const physicalDelta = ref<number | undefined>();
const reason = ref('');
const preview = ref<InventoryAdjustmentPreview | null>(null);
const previewPending = ref(false);
const confirmPending = ref(false);
const unknownOutcome = ref(false);
const errorMessage = ref('');
const errorCode = ref('');
const now = ref(Date.now());
let previewSequence = 0;
let previewController: AbortController | null = null;
let commandAttempt: CommandAttempt | null = null;
let clock: ReturnType<typeof setInterval> | null = null;

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && (previewPending.value || confirmPending.value || unknownOutcome.value)) return;
    emit('update:open', value);
  },
});

const expiresInSeconds = computed(() => {
  if (!preview.value) return 0;
  const remaining = new Date(preview.value.expires_at).getTime() - now.value;
  return Math.max(0, Math.ceil(remaining / 1_000));
});

const previewExpired = computed(() => Boolean(preview.value) && expiresInSeconds.value === 0);

function validReason(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 2 && length <= 500;
}

function validDelta(value: number | undefined): value is number {
  return Number.isInteger(value) && value !== 0 && Number(value) >= POSTGRES_INTEGER_MIN &&
    Number(value) <= POSTGRES_INTEGER_MAX;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 0 || error.status >= 500);
}

function readableError(error: unknown, fallback: string, stage: 'preview' | 'confirm'): string {
  if (!(error instanceof AdminApiError)) return fallback;
  if (error.code === 'STOCK_INSUFFICIENT') {
    return '调整后的实物库存不能小于锁定库存。余额与流水均未改变，请修改调整量后重新预览。';
  }
  if (error.code === 'INVENTORY_QUANTITY_OUT_OF_RANGE') {
    return '调整结果超出库存整数范围。余额与流水均未改变，请修改调整量后重新预览。';
  }
  if (error.status === 0) return stage === 'preview'
    ? '网络连接失败，影响预览未生成；请重新预览。'
    : '网络连接失败，结果尚未确认；请保持当前内容不变并重试确认。';
  if (error.status === 403) return '当前账号无权调整库存';
  if (error.status === 404) return 'SKU 不存在或已不可用，请刷新库存列表';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  if (error.status >= 500) return stage === 'preview'
    ? '服务暂时不可用，影响预览未生成；请稍后重新预览。'
    : '服务结果尚未确认；请使用当前按钮重试，系统不会重复调整库存。';
  return fallback;
}

function stopClock(): void {
  if (clock !== null) clearInterval(clock);
  clock = null;
}

function startClock(): void {
  stopClock();
  now.value = Date.now();
  clock = setInterval(() => {
    now.value = Date.now();
    if (previewExpired.value && !confirmPending.value && !unknownOutcome.value) {
      clearPreview();
      errorCode.value = 'PREVIEW_EXPIRED';
      errorMessage.value = '影响预览已过期，请重新生成后再确认。';
    }
  }, 1_000);
}

function clearPreview(): void {
  ++previewSequence;
  previewController?.abort();
  previewController = null;
  preview.value = null;
  previewPending.value = false;
  commandAttempt = null;
  unknownOutcome.value = false;
  stopClock();
}

function clearState(): void {
  clearPreview();
  physicalDelta.value = undefined;
  reason.value = '';
  errorMessage.value = '';
  errorCode.value = '';
  confirmPending.value = false;
  now.value = Date.now();
}

function closeForAuth(error: AdminApiError): void {
  clearState();
  emit('update:open', false);
  emit('authExpired', error);
}

function closeForConflict(): void {
  clearState();
  emit('update:open', false);
  emit('conflict');
}

function input(): InventoryAdjustmentInput | null {
  const delta = physicalDelta.value;
  const trimmedReason = reason.value.trim();
  if (!validDelta(delta)) {
    errorCode.value = 'VALIDATION_ERROR';
    errorMessage.value = '实物库存变化量必须是非零 int32 整数。';
    return null;
  }
  if (!validReason(trimmedReason)) {
    errorCode.value = 'VALIDATION_ERROR';
    errorMessage.value = '调整原因须为 2–500 个字符。';
    return null;
  }
  return { physical_delta: delta, reason: trimmedReason };
}

async function generatePreview(): Promise<void> {
  const item = props.item;
  if (!item || item.sku_status === 'ARCHIVED' || previewPending.value || confirmPending.value) return;
  errorCode.value = '';
  errorMessage.value = '';
  const adjustment = input();
  if (!adjustment) return;

  clearPreview();
  const sequence = ++previewSequence;
  const controller = new AbortController();
  previewController = controller;
  previewPending.value = true;
  try {
    const result = await previewInventoryAdjustment(
      item.sku_id,
      adjustment,
      newIdempotencyKey(),
      controller.signal,
    );
    if (sequence !== previewSequence) return;
    preview.value = result;
    startClock();
  } catch (error) {
    if (isAbort(error) || sequence !== previewSequence) return;
    if (error instanceof AdminApiError && error.status === 401) {
      closeForAuth(error);
      return;
    }
    if (error instanceof AdminApiError && error.status === 409) {
      closeForConflict();
      return;
    }
    errorCode.value = error instanceof AdminApiError ? error.code : 'UNKNOWN_ERROR';
    errorMessage.value = readableError(error, '影响预览生成失败，请稍后重试', 'preview');
  } finally {
    if (sequence === previewSequence) {
      previewPending.value = false;
      previewController = null;
    }
  }
}

function commandKey(signature: string): string {
  if (commandAttempt?.signature !== signature) commandAttempt = { key: newIdempotencyKey(), signature };
  return commandAttempt.key;
}

async function confirmAdjustment(): Promise<void> {
  const item = props.item;
  const currentPreview = preview.value;
  if (!item || !currentPreview || (previewExpired.value && !unknownOutcome.value) || confirmPending.value) return;
  const adjustment = input();
  if (!adjustment) return;
  const signature = JSON.stringify({
    confirmationHash: currentPreview.confirmation_hash,
    physicalDelta: adjustment.physical_delta,
    previewToken: currentPreview.preview_token,
    reason: adjustment.reason,
    resourceEtag: currentPreview.resource_etag,
    skuId: item.sku_id,
  });
  confirmPending.value = true;
  errorCode.value = '';
  errorMessage.value = '';
  try {
    await confirmInventoryAdjustment(
      item.sku_id,
      adjustment,
      currentPreview,
      commandKey(signature),
    );
    commandAttempt = null;
    unknownOutcome.value = false;
    emit('update:open', false);
    emit('completed');
    clearState();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) {
      closeForAuth(error);
      return;
    }
    if (error instanceof AdminApiError && error.status === 409) {
      closeForConflict();
      return;
    }
    unknownOutcome.value = isUnknownOutcome(error);
    if (!unknownOutcome.value) commandAttempt = null;
    errorCode.value = error instanceof AdminApiError ? error.code : 'UNKNOWN_ERROR';
    if (error instanceof AdminApiError && error.status === 422) clearPreview();
    errorMessage.value = readableError(error, '库存调整失败，请修改输入后重新预览', 'confirm');
  } finally {
    confirmPending.value = false;
  }
}

watch([physicalDelta, reason], () => {
  if (preview.value) clearPreview();
  errorCode.value = '';
  errorMessage.value = '';
});

watch(
  [() => props.open, () => props.item?.sku_id, () => props.item?.version],
  () => clearState(),
);

onBeforeUnmount(clearState);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    data-testid="inventory-adjustment-dialog"
    width="min(640px, calc(100vw - 28px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!previewPending && !confirmPending && !unknownOutcome"
    :show-close="!previewPending && !confirmPending && !unknownOutcome"
    destroy-on-close
    @closed="clearState"
  >
    <template #header>
      <div class="dialog-heading">
        <strong>库存调整影响预览</strong>
        <p v-if="item">
          {{ item.product_name }} · {{ item.sku_name }} · {{ item.sku_code }}
        </p>
      </div>
    </template>

    <div
      v-if="item"
      class="adjustment-dialog"
    >
      <div
        class="balance-summary"
        aria-label="当前库存余额"
      >
        <div><span>实物</span><strong>{{ item.physical_qty }}</strong></div>
        <div><span>锁定</span><strong>{{ item.locked_qty }}</strong></div>
        <div><span>活动预占</span><strong>{{ item.active_reservation_qty }}</strong></div>
        <div><span>可售</span><strong>{{ item.available_qty }}</strong></div>
        <div><span>版本</span><strong>v{{ item.version }}</strong></div>
      </div>

      <el-alert
        v-if="item.sku_status === 'ARCHIVED'"
        title="归档 SKU 只允许查看库存流水"
        description="请先在商品管理中将 SKU 恢复为停用状态，再发起库存调整。"
        type="warning"
        :closable="false"
        show-icon
      />

      <el-form
        v-else
        label-position="top"
        class="adjustment-form"
      >
        <el-form-item
          label="实物库存变化量"
          required
        >
          <el-input-number
            v-model="physicalDelta"
            data-testid="inventory-delta-input"
            :min="POSTGRES_INTEGER_MIN"
            :max="POSTGRES_INTEGER_MAX"
            :step="1"
            step-strictly
            controls-position="right"
            aria-label="实物库存变化量"
            :disabled="previewPending || confirmPending || unknownOutcome"
          />
          <small>填写非零整数；锁定库存由交易流程维护，不会被人工调整。</small>
        </el-form-item>
        <el-form-item
          label="调整原因"
          required
        >
          <el-input
            v-model="reason"
            data-testid="inventory-adjustment-reason"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            aria-label="调整原因"
            :disabled="previewPending || confirmPending || unknownOutcome"
          />
        </el-form-item>
      </el-form>

      <section
        v-if="preview"
        class="impact-preview"
        data-testid="inventory-adjustment-preview"
        aria-label="库存调整影响预览"
      >
        <header>
          <div>
            <strong>调整前后</strong>
            <span>影响 1 个 SKU</span>
          </div>
          <span :class="{ expired: previewExpired }">剩余 {{ expiresInSeconds }} 秒</span>
        </header>
        <div class="impact-grid">
          <div><span>实物</span><strong>{{ preview.impact.physical_before }} → {{ preview.impact.physical_after }}</strong></div>
          <div><span>锁定</span><strong>{{ preview.impact.locked_before }} → {{ preview.impact.locked_after }}</strong></div>
          <div><span>可售</span><strong>{{ preview.impact.available_before }} → {{ preview.impact.available_after }}</strong></div>
        </div>
        <el-alert
          v-for="warning in preview.impact.warnings"
          :key="warning"
          :title="warning === 'STOCK_INSUFFICIENT'
            ? '调整后实物库存低于锁定库存，确认将被阻断且不会写入流水。'
            : warning"
          type="warning"
          :closable="false"
          show-icon
        />
        <small>确认前请复核调整后余额；数据发生变化时系统会要求重新预览。</small>
      </section>

      <p
        v-if="errorMessage"
        class="form-error"
        role="alert"
        :data-error-code="errorCode"
        data-testid="inventory-adjustment-error"
      >
        {{ errorMessage }}
      </p>
    </div>

    <template #footer>
      <el-button
        :disabled="previewPending || confirmPending || unknownOutcome"
        @click="dialogOpen = false"
      >
        取消
      </el-button>
      <el-button
        v-if="!preview"
        type="primary"
        :loading="previewPending"
        :disabled="item?.sku_status === 'ARCHIVED' || confirmPending"
        data-testid="inventory-preview-button"
        @click="generatePreview"
      >
        生成影响预览
      </el-button>
      <el-button
        v-else
        type="primary"
        :loading="confirmPending"
        :disabled="(previewExpired && !unknownOutcome) || previewPending"
        data-testid="inventory-confirm-button"
        @click="confirmAdjustment"
      >
        {{ unknownOutcome ? '重试确认调整' : '确认库存调整' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-heading,
.dialog-heading p,
.adjustment-form small,
.impact-preview small {
  margin: 0;
}

.dialog-heading {
  display: grid;
  gap: 4px;
}

.dialog-heading strong {
  font-size: 17px;
}

.dialog-heading p,
.adjustment-form small,
.impact-preview small {
  color: var(--admin-muted);
  font-size: 12px;
}

.adjustment-dialog {
  display: grid;
  gap: 18px;
}

.balance-summary {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

.balance-summary > div {
  display: grid;
  min-width: 0;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  background: #f7faf8;
}

.balance-summary span,
.impact-grid span {
  color: var(--admin-muted);
  font-size: 11px;
}

.balance-summary strong {
  overflow-wrap: anywhere;
  font-size: 17px;
}

.adjustment-form :deep(.el-input-number) {
  width: 100%;
}

.adjustment-form :deep(.el-form-item:last-child) {
  margin-bottom: 0;
}

.impact-preview {
  display: grid;
  gap: 12px;
  padding: 14px;
  border: 1px solid #b9cec4;
  border-radius: 7px;
  background: #f4f9f6;
}

.impact-preview > header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.impact-preview > header > div {
  display: grid;
  gap: 2px;
}

.impact-preview > header span {
  color: var(--admin-brand);
  font-size: 12px;
  font-weight: 700;
}

.impact-preview > header span.expired {
  color: var(--admin-danger);
}

.impact-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.impact-grid > div {
  display: grid;
  min-width: 0;
  gap: 5px;
  padding: 10px;
  border-left: 3px solid var(--admin-brand);
  background: #fff;
}

.impact-grid strong {
  overflow-wrap: anywhere;
  font-size: 14px;
}

.form-error {
  margin: 0;
  color: var(--admin-danger);
  font-size: 13px;
}

@media (max-width: 640px) {
  .balance-summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .impact-grid {
    grid-template-columns: 1fr;
  }
}
</style>
