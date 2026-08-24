<script setup lang="ts">
import { Delete, Plus } from '@element-plus/icons-vue';
import { computed, reactive, ref, watch } from 'vue';

import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import { createAdminSku, updateAdminSku } from '../../services/admin-products';
import type { Sku, SkuCreateRequest, SkuUpdateRequest } from '../../types/products';

interface AttributeRow {
  key: number;
  name: string;
  value: string;
}

interface CommandAttempt {
  key: string;
  signature: string;
}

const props = defineProps<{
  open: boolean;
  parentArchived?: boolean;
  productId: string;
  sku: Sku | null;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  conflict: [skuId: string | null];
  saved: [sku: Sku];
  'update:open': [value: boolean];
}>();

const saving = ref(false);
const errorMessage = ref('');
const form = reactive({
  attributes: [] as AttributeRow[],
  code: '',
  isRecommended: false,
  name: '',
  retailPrice: '',
});
let attributeKey = 0;
let commandAttempt: CommandAttempt | null = null;

const readOnly = computed(() => props.parentArchived === true || props.sku?.status === 'ARCHIVED');
const editing = computed(() => props.sku !== null);
const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && saving.value) return;
    emit('update:open', value);
  },
});

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function addAttribute(name = '', value = ''): void {
  if (readOnly.value) return;
  form.attributes.push({ key: ++attributeKey, name, value });
}

function removeAttribute(index: number): void {
  if (readOnly.value) return;
  form.attributes.splice(index, 1);
}

function resetForm(): void {
  commandAttempt = null;
  errorMessage.value = '';
  saving.value = false;
  form.code = props.sku?.code ?? '';
  form.name = props.sku?.name ?? '';
  form.retailPrice = props.sku?.retail_price ?? '';
  form.isRecommended = props.sku?.is_recommended ?? false;
  form.attributes.splice(0);
  attributeKey = 0;
  for (const attribute of props.sku?.spec_json?.attributes ?? []) {
    form.attributes.push({ key: ++attributeKey, name: attribute.name, value: attribute.value });
  }
}

function validate(): string | null {
  const code = form.code.trim();
  const name = form.name.trim();
  if (!editing.value && (codePointLength(code) < 1 || codePointLength(code) > 80)) {
    return 'SKU 编码须为 1–80 个字符';
  }
  if (codePointLength(name) < 1 || codePointLength(name) > 160) return 'SKU 名称须为 1–160 个字符';
  if (!/^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/.test(form.retailPrice.trim())) {
    return '零售价须大于 0，并使用两位小数，例如 59.00';
  }
  const identities = new Set<string>();
  for (const attribute of form.attributes) {
    const attributeName = attribute.name.trim();
    const attributeValue = attribute.value.trim();
    if (codePointLength(attributeName) < 1 || codePointLength(attributeName) > 80) {
      return '规格名称须为 1–80 个字符';
    }
    if (codePointLength(attributeValue) < 1 || codePointLength(attributeValue) > 160) {
      return '规格值须为 1–160 个字符';
    }
    const identity = JSON.stringify([attributeName, attributeValue]);
    if (identities.has(identity)) return '不能添加完全相同的规格项';
    identities.add(identity);
  }
  return null;
}

function specification(): NonNullable<SkuCreateRequest['spec_json']> | null {
  if (!form.attributes.length) return null;
  return {
    attributes: form.attributes.map((attribute) => ({
      name: attribute.name.trim(),
      value: attribute.value.trim(),
    })),
  };
}

function attemptKey(signature: string): string {
  if (commandAttempt?.signature !== signature) commandAttempt = { key: newIdempotencyKey(), signature };
  return commandAttempt.key;
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 0 || error.status >= 500);
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return 'SKU 保存失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权保存 SKU';
  if (error.status === 404) return 'SKU 或所属商品不存在，请刷新商品详情';
  if (error.code === 'SOFT_DELETED_KEY_RESERVED') return '该 SKU 编码由归档记录保留，请恢复原记录';
  if (error.status === 409) return 'SKU 编码已存在，或所属商品状态已变化；请检查编码和商品资料';
  if (error.status === 422) return 'SKU 内容不符合要求，请检查名称、价格和规格';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  if (error.status >= 500) return 'SKU 保存结果尚未确认，可保持内容不变后重试';
  return 'SKU 当前状态不允许保存，请刷新商品详情';
}

async function submit(): Promise<void> {
  if (saving.value || readOnly.value) return;
  errorMessage.value = validate() ?? '';
  if (errorMessage.value) return;

  const common = {
    is_recommended: form.isRecommended,
    name: form.name.trim(),
    retail_price: form.retailPrice.trim(),
    spec_json: specification(),
  };
  const input: SkuCreateRequest | SkuUpdateRequest = props.sku
    ? common
    : {
        ...common,
        code: form.code.trim().toUpperCase(),
        initial_status: 'INACTIVE' as const,
      };
  const signature = JSON.stringify({
    input,
    productId: props.productId,
    skuId: props.sku?.sku_id ?? null,
    version: props.sku?.version ?? null,
  });
  saving.value = true;
  try {
    const key = attemptKey(signature);
    const saved = props.sku
      ? await updateAdminSku(props.sku.sku_id, input as SkuUpdateRequest, props.sku.version, key)
      : await createAdminSku(props.productId, input as SkuCreateRequest, key);
    commandAttempt = null;
    emit('saved', saved);
    emit('update:open', false);
    resetForm();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) {
      commandAttempt = null;
      emit('update:open', false);
      emit('authExpired', error);
      return;
    }
    if (props.sku && error instanceof AdminApiError && error.status === 409) {
      commandAttempt = null;
      emit('update:open', false);
      emit('conflict', props.sku?.sku_id ?? null);
      return;
    }
    if (!isUnknownOutcome(error)) commandAttempt = null;
    errorMessage.value = readableError(error);
  } finally {
    saving.value = false;
  }
}

watch(
  [() => props.open, () => props.sku?.sku_id, () => props.sku?.version, () => props.productId],
  ([open]) => {
    if (open) resetForm();
  },
);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    data-testid="sku-editor-dialog"
    width="min(680px, calc(100vw - 28px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!saving"
    :show-close="!saving"
    destroy-on-close
    @closed="resetForm"
  >
    <template #header>
      <div class="dialog-heading">
        <strong>{{ editing ? (readOnly ? '查看归档 SKU' : '编辑 SKU') : '新增 SKU' }}</strong>
        <p v-if="sku">
          {{ sku.code }} · {{ sku.status }} · v{{ sku.version }}
        </p>
        <p v-else>
          新建 SKU 固定保存为停用状态，并建立零值库存余额。
        </p>
      </div>
    </template>

    <form
      class="sku-editor-dialog"
      @submit.prevent="submit"
    >
      <el-alert
        v-if="readOnly"
        title="归档记录只读"
        description="请先通过生命周期操作恢复 SKU，再修改资料。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-alert
        v-else-if="editing"
        :title="`当前状态 ${sku?.status ?? 'INACTIVE'} · v${sku?.version ?? 1}`"
        description="普通编辑不会改变生命周期状态；SKU 编码创建后不可修改。"
        type="info"
        :closable="false"
      />
      <el-alert
        v-else
        title="新 SKU 固定为已停用"
        description="创建后库存摘要为：实物 0 · 锁定 0 · 可售 0。"
        type="info"
        :closable="false"
        show-icon
      />

      <el-form label-position="top">
        <div class="form-grid">
          <el-form-item
            label="SKU 编码"
            required
          >
            <el-input
              v-model="form.code"
              maxlength="80"
              :disabled="editing || readOnly || saving"
              aria-label="SKU 编码"
              placeholder="例如 CLEAN-120"
            />
          </el-form-item>
          <el-form-item
            label="SKU 名称"
            required
          >
            <el-input
              v-model="form.name"
              maxlength="160"
              :disabled="readOnly || saving"
              aria-label="SKU 名称"
              placeholder="例如 120g 单支装"
            />
          </el-form-item>
          <el-form-item
            label="零售价"
            required
          >
            <el-input
              v-model="form.retailPrice"
              maxlength="19"
              inputmode="decimal"
              :disabled="readOnly || saving"
              aria-label="零售价"
              placeholder="59.00"
            >
              <template #prepend>
                ¥
              </template>
            </el-input>
          </el-form-item>
          <el-form-item label="SKU 推荐">
            <label class="recommend-checkbox">
              <input
                v-model="form.isRecommended"
                type="checkbox"
                :disabled="readOnly || saving"
                aria-label="推荐 SKU"
              >
              <span>加入推荐 SKU</span>
            </label>
          </el-form-item>
        </div>

        <section
          class="specification-editor"
          aria-label="SKU 规格属性"
        >
          <header>
            <div>
              <strong>规格属性</strong>
              <span>可选；同一规格项不可重复。</span>
            </div>
            <el-button
              v-if="!readOnly"
              :icon="Plus"
              :disabled="saving"
              @click="addAttribute()"
            >
              添加规格
            </el-button>
          </header>
          <div
            v-if="form.attributes.length"
            class="attribute-list"
          >
            <div
              v-for="(attribute, index) in form.attributes"
              :key="attribute.key"
              class="attribute-row"
            >
              <el-input
                v-model="attribute.name"
                maxlength="80"
                :disabled="readOnly || saving"
                :aria-label="`规格名称 ${index + 1}`"
                placeholder="规格名称"
              />
              <el-input
                v-model="attribute.value"
                maxlength="160"
                :disabled="readOnly || saving"
                :aria-label="`规格值 ${index + 1}`"
                placeholder="规格值"
              />
              <el-button
                v-if="!readOnly"
                circle
                type="danger"
                plain
                :icon="Delete"
                :disabled="saving"
                :aria-label="`删除规格 ${index + 1}`"
                title="删除规格"
                @click="removeAttribute(index)"
              />
            </div>
          </div>
          <p v-else>
            暂无规格属性
          </p>
        </section>
      </el-form>

      <p
        v-if="errorMessage"
        class="form-error"
        role="alert"
      >
        {{ errorMessage }}
      </p>
    </form>

    <template #footer>
      <el-button
        :disabled="saving"
        @click="dialogOpen = false"
      >
        {{ readOnly ? '关闭' : '取消' }}
      </el-button>
      <el-button
        v-if="!readOnly"
        type="primary"
        :loading="saving"
        @click="submit"
      >
        保存 SKU
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.dialog-heading,
.sku-editor-dialog {
  display: grid;
  min-width: 0;
  gap: 16px;
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

.form-grid {
  display: grid;
  min-width: 0;
  gap: 0 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.recommend-checkbox {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  color: var(--admin-text-soft);
  cursor: pointer;
  font-size: 12px;
}

.recommend-checkbox input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--admin-brand);
}

.specification-editor {
  display: grid;
  min-width: 0;
  gap: 12px;
  margin-top: 6px;
  padding-top: 16px;
  border-top: 1px solid var(--admin-border);
}

.specification-editor > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.specification-editor > header > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.specification-editor strong {
  font-size: 13px;
}

.specification-editor span,
.specification-editor > p {
  margin: 0;
  color: var(--admin-muted);
  font-size: 11px;
}

.attribute-list {
  display: grid;
  min-width: 0;
  gap: 8px;
}

.attribute-row {
  display: grid;
  min-width: 0;
  align-items: center;
  gap: 8px;
  grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr) 34px;
}

.attribute-row :deep(.el-button) {
  margin: 0;
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

@media (max-width: 600px) {
  .form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .specification-editor > header {
    align-items: stretch;
    flex-direction: column;
  }

  .attribute-row {
    align-items: start;
    grid-template-columns: minmax(0, 1fr) 34px;
  }

  .attribute-row > :first-child {
    grid-column: 1 / -1;
  }
}
</style>
