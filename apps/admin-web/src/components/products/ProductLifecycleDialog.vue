<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  confirmProductLifecycle,
  confirmSkuLifecycle,
  previewProductLifecycle,
  previewSkuLifecycle,
  restoreProduct,
  restoreSku,
} from '../../services/admin-products';
import type {
  CommandResponse,
  HighRiskPreview,
  ProductLifecycleAction,
  ProductStatus,
  SkuStatus,
} from '../../types/products';

type LifecycleKind = 'product' | 'sku';
type LifecycleStatus = ProductStatus | SkuStatus;
type DependencyCode =
  | 'ACTIVE_INVENTORY_RESERVATION'
  | 'ACTIVE_SKU_DEPENDENCY'
  | 'PRODUCT_ACTIVE_SKU_REQUIRED'
  | 'PRODUCT_PRIMARY_IMAGE_REQUIRED'
  | 'STATE_CONFLICT';

interface LifecycleTarget {
  id: string;
  kind: LifecycleKind;
  name: string;
  status: LifecycleStatus;
  version: number;
}

interface CommandAttempt {
  key: string;
  signature: string;
}

const props = defineProps<{
  initialAction?: ProductLifecycleAction | undefined;
  open: boolean;
  target: LifecycleTarget | null;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  completed: [result: CommandResponse['data']];
  conflict: [target: LifecycleTarget];
  repairRequested: [code: DependencyCode, target: LifecycleTarget];
  'update:open': [value: boolean];
}>();

const action = ref<ProductLifecycleAction>('ACTIVATE');
const reason = ref('');
const preview = ref<HighRiskPreview | null>(null);
const errorMessage = ref('');
const repairCode = ref<DependencyCode | null>(null);
const previewPending = ref(false);
const commandPending = ref(false);
let previewSequence = 0;
let previewController: AbortController | null = null;
let commandAttempt: CommandAttempt | null = null;

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && (previewPending.value || commandPending.value)) return;
    emit('update:open', value);
  },
});

const archived = computed(() => props.target?.status === 'ARCHIVED');
const actionOptions = computed<Array<{ label: string; value: ProductLifecycleAction }>>(() => {
  const status = props.target?.status;
  if (status === 'ACTIVE') return [{ label: '停用', value: 'DEACTIVATE' }];
  if (status === 'DRAFT' || status === 'INACTIVE') {
    return [
      { label: '启用', value: 'ACTIVATE' },
      { label: '归档', value: 'SOFT_DELETE' },
    ];
  }
  return [];
});
const actionLabel = computed(() => ({
  ACTIVATE: '启用',
  DEACTIVATE: '停用',
  SOFT_DELETE: '归档',
})[action.value]);
const repairLabel = computed(() => repairCode.value ? ({
  ACTIVE_INVENTORY_RESERVATION: '查看 SKU 库存摘要',
  ACTIVE_SKU_DEPENDENCY: '去停用相关 SKU',
  PRODUCT_ACTIVE_SKU_REQUIRED: '去维护 SKU',
  PRODUCT_PRIMARY_IMAGE_REQUIRED: '去补充商品图片',
  STATE_CONFLICT: '刷新关联资料',
})[repairCode.value] : '');

function statusLabel(status: LifecycleStatus): string {
  return ({ ACTIVE: '已启用', ARCHIVED: '已归档', DRAFT: '草稿', INACTIVE: '已停用' })[status];
}

function validReason(value: string): boolean {
  const length = Array.from(value).length;
  return length >= 2 && length <= 500;
}

function commandKey(signature: string): string {
  if (commandAttempt?.signature !== signature) commandAttempt = { key: newIdempotencyKey(), signature };
  return commandAttempt.key;
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 0 || error.status >= 500);
}

function dependencyMessage(code: string): string | null {
  return ({
    ACTIVE_INVENTORY_RESERVATION: '存在活动库存预占，请等待预占释放后重新生成影响预览。',
    ACTIVE_SKU_DEPENDENCY: '请先停用全部相关 SKU，再重新生成影响预览。',
    PRODUCT_ACTIVE_SKU_REQUIRED: '商品至少需要一个已启用 SKU，请先完成 SKU 资料并启用。',
    PRODUCT_PRIMARY_IMAGE_REQUIRED: '至少添加一张合法公开的商品图片后，才能启用商品。',
    STATE_CONFLICT: '品牌、分类或父商品当前状态不满足操作条件，请刷新关联资料后重试。',
  } as Record<string, string>)[code] ?? null;
}

function recognizedDependencyCode(code: string): DependencyCode | null {
  return dependencyMessage(code) ? code as DependencyCode : null;
}

function warningMessage(warning: string): string {
  const exact = dependencyMessage(warning);
  if (exact) return exact;
  if (warning.includes('库存预占')) return dependencyMessage('ACTIVE_INVENTORY_RESERVATION') as string;
  if (warning.includes('已启用 SKU') && /仍有|先停用/.test(warning)) {
    return dependencyMessage('ACTIVE_SKU_DEPENDENCY') as string;
  }
  if (warning.includes('已启用 SKU')) return dependencyMessage('PRODUCT_ACTIVE_SKU_REQUIRED') as string;
  if (warning.includes('商品图片') || warning.includes('公开图片')) {
    return dependencyMessage('PRODUCT_PRIMARY_IMAGE_REQUIRED') as string;
  }
  if (/品牌|分类|父商品|所属商品/.test(warning)) return dependencyMessage('STATE_CONFLICT') as string;
  return '存在需要处理的生命周期依赖，请核对后再确认。';
}

function metricLabel(key: string, fallback: string): string {
  return ({
    active_reservations: '活动库存预占',
    active_skus: '已启用 SKU',
    brand_status: '品牌状态',
    category_status: '分类状态',
    parent_product_status: '所属商品状态',
    public_images: '合法公开图片',
    status: '生命周期状态',
  } as Record<string, string>)[key] ?? fallback;
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof AdminApiError)) return fallback;
  const dependency = dependencyMessage(error.code);
  if (dependency) return dependency;
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权执行此生命周期操作';
  if (error.status === 404) return '记录不存在或已不可用，请刷新列表';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  if (error.status >= 500) return fallback;
  return '当前状态不允许执行该操作，请刷新后重试';
}

function clearPreview(): void {
  ++previewSequence;
  previewController?.abort();
  previewController = null;
  preview.value = null;
  previewPending.value = false;
  commandAttempt = null;
}

function clearState(): void {
  clearPreview();
  reason.value = '';
  errorMessage.value = '';
  repairCode.value = null;
  commandPending.value = false;
  const options = actionOptions.value;
  action.value = options[0]?.value ?? 'ACTIVATE';
}

function requestRepair(): void {
  const target = props.target;
  const code = repairCode.value;
  if (!target || !code) return;
  emit('update:open', false);
  emit('repairRequested', code, target);
  clearState();
}

function selectInitialAction(): void {
  const options = actionOptions.value;
  action.value = options.some((option) => option.value === props.initialAction)
    ? props.initialAction as ProductLifecycleAction
    : options[0]?.value ?? 'ACTIVATE';
}

function closeForConflict(target: LifecycleTarget): void {
  clearState();
  emit('update:open', false);
  emit('conflict', target);
}

function closeForAuth(error: AdminApiError): void {
  clearState();
  emit('update:open', false);
  emit('authExpired', error);
}

async function generatePreview(): Promise<void> {
  const target = props.target;
  const trimmedReason = reason.value.trim();
  if (!target || archived.value || previewPending.value || commandPending.value) return;
  errorMessage.value = '';
  repairCode.value = null;
  if (!validReason(trimmedReason)) {
    errorMessage.value = '操作原因须为 2–500 个字符';
    return;
  }

  clearPreview();
  const sequence = ++previewSequence;
  const controller = new AbortController();
  previewController = controller;
  previewPending.value = true;
  try {
    const input = { action: action.value, reason: trimmedReason };
    const result = target.kind === 'product'
      ? await previewProductLifecycle(target.id, input, newIdempotencyKey(), controller.signal)
      : await previewSkuLifecycle(target.id, input, newIdempotencyKey(), controller.signal);
    if (sequence === previewSequence) preview.value = result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (sequence !== previewSequence) return;
    if (error instanceof AdminApiError && error.status === 401) {
      closeForAuth(error);
      return;
    }
    if (error instanceof AdminApiError && error.status === 409) {
      closeForConflict(target);
      return;
    }
    errorMessage.value = readableError(error, '影响预览生成失败，请稍后重试');
  } finally {
    if (sequence === previewSequence) {
      previewPending.value = false;
      previewController = null;
    }
  }
}

async function confirmChange(): Promise<void> {
  const target = props.target;
  const currentPreview = preview.value;
  const trimmedReason = reason.value.trim();
  if (!target || !currentPreview || commandPending.value) return;
  const signature = JSON.stringify({
    action: action.value,
    confirmationHash: currentPreview.confirmation_hash,
    id: target.id,
    kind: target.kind,
    previewToken: currentPreview.preview_token,
    reason: trimmedReason,
  });
  commandPending.value = true;
  errorMessage.value = '';
  try {
    const input = { action: action.value, reason: trimmedReason };
    const key = commandKey(signature);
    const response = target.kind === 'product'
      ? await confirmProductLifecycle(target.id, input, currentPreview, key)
      : await confirmSkuLifecycle(target.id, input, currentPreview, key);
    commandAttempt = null;
    emit('update:open', false);
    emit('completed', response.data);
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
    if (!isUnknownOutcome(error)) commandAttempt = null;
    if (error instanceof AdminApiError && error.status === 422) {
      clearPreview();
      repairCode.value = recognizedDependencyCode(error.code);
    }
    errorMessage.value = readableError(error, `确认${actionLabel.value}失败，请稍后重试`);
  } finally {
    commandPending.value = false;
  }
}

async function restoreArchived(): Promise<void> {
  const target = props.target;
  const trimmedReason = reason.value.trim();
  if (!target || !archived.value || commandPending.value) return;
  errorMessage.value = '';
  if (!validReason(trimmedReason)) {
    errorMessage.value = '恢复原因须为 2–500 个字符';
    return;
  }
  const signature = JSON.stringify({
    id: target.id,
    kind: target.kind,
    reason: trimmedReason,
    version: target.version,
  });
  commandPending.value = true;
  try {
    const key = commandKey(signature);
    const response = target.kind === 'product'
      ? await restoreProduct(target.id, { reason: trimmedReason }, target.version, key)
      : await restoreSku(target.id, { reason: trimmedReason }, target.version, key);
    commandAttempt = null;
    emit('update:open', false);
    emit('completed', response.data);
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
    if (!isUnknownOutcome(error)) commandAttempt = null;
    errorMessage.value = readableError(error, '恢复失败，请稍后重试');
  } finally {
    commandPending.value = false;
  }
}

watch([action, reason], () => {
  if (preview.value) clearPreview();
  errorMessage.value = '';
  repairCode.value = null;
});

watch(
  [
    () => props.open,
    () => props.initialAction,
    () => props.target?.kind,
    () => props.target?.id,
    () => props.target?.status,
    () => props.target?.version,
  ],
  ([open]) => {
    clearState();
    if (open) selectInitialAction();
  },
);

onBeforeUnmount(clearState);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    data-testid="product-lifecycle-dialog"
    width="min(600px, calc(100vw - 28px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!previewPending && !commandPending"
    :show-close="!previewPending && !commandPending"
    destroy-on-close
    @closed="clearState"
  >
    <template #header>
      <div class="dialog-heading">
        <strong>{{ archived ? (target?.kind === 'product' ? '恢复商品' : '恢复 SKU') : '生命周期影响预览' }}</strong>
        <p v-if="target">
          {{ target.name }} · {{ statusLabel(target.status) }} · v{{ target.version }}
        </p>
      </div>
    </template>

    <div class="product-lifecycle-dialog">
      <el-alert
        v-if="archived"
        :title="target?.kind === 'product' ? '恢复后回到草稿' : '恢复后回到停用状态'"
        description="恢复不会自动启用，也不会级联修改所属商品或 SKU。"
        type="info"
        :closable="false"
        show-icon
      />

      <el-form label-position="top">
        <el-form-item
          v-if="!archived"
          label="生命周期动作"
          required
        >
          <el-select
            v-model="action"
            aria-label="生命周期动作"
            :disabled="previewPending || commandPending"
          >
            <el-option
              v-for="option in actionOptions"
              :key="option.value"
              v-bind="option"
            />
          </el-select>
        </el-form-item>
        <el-form-item
          :label="archived ? '恢复原因' : '操作原因'"
          required
        >
          <el-input
            v-model="reason"
            type="textarea"
            :rows="3"
            maxlength="500"
            show-word-limit
            :aria-label="archived ? '恢复原因' : '操作原因'"
            :disabled="commandPending"
          />
        </el-form-item>
      </el-form>

      <section
        v-if="preview"
        class="impact-preview"
        aria-label="影响预览结果"
      >
        <div class="impact-summary">
          <span>受影响记录</span>
          <strong>{{ preview.impact.affected_count }}</strong>
        </div>
        <dl
          v-if="preview.impact.metrics.length"
          class="impact-metrics"
        >
          <template
            v-for="metric in preview.impact.metrics"
            :key="metric.key"
          >
            <dt>{{ metricLabel(metric.key, metric.label) }}</dt>
            <dd>{{ metric.before ?? '—' }} → {{ metric.after ?? '—' }}</dd>
          </template>
        </dl>
        <el-alert
          v-for="warning in preview.impact.warnings"
          :key="warning"
          :title="warningMessage(warning)"
          type="warning"
          :closable="false"
          show-icon
        />
        <small>预览有效期至 {{ new Date(preview.expires_at).toLocaleString('zh-CN') }}</small>
      </section>

      <p
        v-if="errorMessage"
        class="form-error"
        role="alert"
      >
        {{ errorMessage }}
      </p>
      <div
        v-if="repairCode"
        class="repair-action"
      >
        <el-button
          type="primary"
          plain
          @click="requestRepair"
        >
          {{ repairLabel }}
        </el-button>
      </div>
    </div>

    <template #footer>
      <el-button
        :disabled="previewPending || commandPending"
        @click="dialogOpen = false"
      >
        取消
      </el-button>
      <el-button
        v-if="archived"
        type="primary"
        :loading="commandPending"
        @click="restoreArchived"
      >
        {{ target?.kind === 'product' ? '确认恢复为草稿' : '确认恢复为已停用' }}
      </el-button>
      <el-button
        v-else-if="!preview"
        type="primary"
        :loading="previewPending"
        :disabled="commandPending"
        @click="generatePreview"
      >
        生成影响预览
      </el-button>
      <el-button
        v-else
        type="primary"
        :loading="commandPending"
        @click="confirmChange"
      >
        确认{{ actionLabel }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-heading,
.product-lifecycle-dialog {
  display: grid;
  min-width: 0;
  gap: 14px;
}

.dialog-heading {
  gap: 3px;
}

.dialog-heading p {
  margin: 0;
  color: var(--admin-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.product-lifecycle-dialog :deep(.el-select) {
  width: 100%;
}

.impact-preview {
  display: grid;
  min-width: 0;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #f8faf9;
}

.impact-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--admin-text-soft);
  font-size: 12px;
}

.impact-summary strong {
  color: var(--admin-text);
  font-size: 20px;
}

.impact-metrics {
  display: grid;
  min-width: 0;
  margin: 0;
  grid-template-columns: minmax(0, 1fr) minmax(92px, auto);
}

.impact-metrics dt,
.impact-metrics dd {
  min-width: 0;
  margin: 0;
  padding: 7px 0;
  border-top: 1px solid var(--admin-border);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.impact-metrics dd {
  padding-left: 12px;
  color: var(--admin-text-soft);
  text-align: right;
}

.impact-preview > small {
  color: var(--admin-muted);
  font-size: 10px;
}

.form-error {
  margin: 0;
  padding: 10px 12px;
  border-left: 3px solid var(--admin-danger);
  background: #fff3f1;
  color: #9f3030;
  font-size: 12px;
  line-height: 1.55;
}

.repair-action {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 520px) {
  .impact-metrics {
    grid-template-columns: minmax(0, 1fr);
  }

  .impact-metrics dd {
    padding-top: 0;
    padding-left: 0;
    border-top: 0;
    text-align: left;
  }
}
</style>
