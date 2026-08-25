<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';

import BannerAssetUpload from './BannerAssetUpload.vue';
import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  createAdminBanner,
  updateAdminBanner,
} from '../../services/admin-banners';
import {
  listActiveCatalogOptions,
  listAdminProducts,
} from '../../services/admin-products';
import type {
  BannerEditorInput,
  BannerItem,
  BannerTargetType,
  UploadedBannerAsset,
} from '../../types/banners';
import type {
  CategoryReference,
  ProductSummary,
} from '../../types/products';

interface CommandAttempt {
  key: string;
  signature: string;
}

const props = defineProps<{
  item: BannerItem | null;
  open: boolean;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  conflict: [target: BannerItem | null];
  saved: [banner: BannerItem];
  'update:open': [value: boolean];
}>();

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => {
    if (!value && (saving.value || assetUploading.value || unknownOutcome.value)) return;
    emit('update:open', value);
  },
});

const form = reactive({
  endsAt: '',
  fileId: null as string | null,
  imageUrl: null as string | null,
  sortOrder: 0,
  startsAt: '',
  targetId: '',
  targetType: 'NONE' as BannerTargetType,
  targetUrl: '',
  title: '',
});
const products = ref<ProductSummary[]>([]);
const categories = ref<CategoryReference[]>([]);
const productReferencesLoaded = ref(false);
const categoryReferencesLoaded = ref(false);
const referencesLoading = ref(false);
const referencesError = ref('');
const saving = ref(false);
const assetUploading = ref(false);
const errorMessage = ref('');
const unknownOutcome = ref(false);
let referenceSequence = 0;
let referenceController: AbortController | null = null;
let attempt: CommandAttempt | null = null;

const shanghaiInputFormatter = new Intl.DateTimeFormat('en-CA', {
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
  hourCycle: 'h23',
  minute: '2-digit',
  month: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
});

const editing = computed(() => props.item !== null);
const editorLocked = computed(() => saving.value || unknownOutcome.value);
const unavailableTarget = computed(() => {
  if (!form.targetId) return false;
  if (form.targetType === 'PRODUCT') {
    if (!productReferencesLoaded.value) return false;
    return !products.value.some((product) => product.product_id === form.targetId);
  }
  if (form.targetType === 'CATEGORY') {
    if (!categoryReferencesLoaded.value) return false;
    return !categories.value.some((category) => category.category_id === form.targetId);
  }
  return false;
});

function characterLength(value: string): number {
  return Array.from(value).length;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 0 || error.status >= 500);
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return 'Banner 资料保存失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，保存结果尚未确认；可保持内容不变后重试';
  if (error.status === 403) return '当前账号无权保存 Banner';
  if (error.status === 404) return 'Banner 或关联目标不存在，请刷新列表';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  if (error.code === 'FILE_CONTENT_MISMATCH') return '图片内容校验不一致，请重新选择后再试';
  if (error.code === 'STATE_CONFLICT') return 'Banner 图片、跳转目标或当前状态已不可用，请修正资料后重试';
  if (error.status === 400 || error.status === 422) return 'Banner 资料不符合要求，请检查图片、目标和投放时间';
  if (error.status >= 500) return '服务暂时不可用，保存结果尚未确认；可保持内容不变后重试';
  return 'Banner 资料保存失败，请稍后重试';
}

function shanghaiInput(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  const parts = Object.fromEntries(
    shanghaiInputFormatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute || !parts.second) return '';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

function toRfc3339(value: string): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(`${value}+08:00`);
  if (Number.isNaN(date.valueOf()) || shanghaiInput(date.toISOString()) !== value) return null;
  return date.toISOString();
}

function fillForm(item: BannerItem | null): void {
  form.title = item?.title ?? '';
  form.fileId = item?.file_id ?? null;
  form.imageUrl = item?.image_url ?? null;
  form.sortOrder = item?.sort_order ?? 0;
  form.startsAt = shanghaiInput(item?.starts_at ?? null);
  form.endsAt = shanghaiInput(item?.ends_at ?? null);
  form.targetType = item?.target_type ?? 'NONE';
  form.targetId = item?.target_id ?? '';
  form.targetUrl = item?.target_url ?? '';
}

function clearState(): void {
  ++referenceSequence;
  referenceController?.abort();
  referenceController = null;
  referencesLoading.value = false;
  referencesError.value = '';
  products.value = [];
  categories.value = [];
  productReferencesLoaded.value = false;
  categoryReferencesLoaded.value = false;
  saving.value = false;
  assetUploading.value = false;
  errorMessage.value = '';
  unknownOutcome.value = false;
  attempt = null;
}

async function listAllActiveProducts(signal: AbortSignal): Promise<ProductSummary[]> {
  const result: ProductSummary[] = [];
  let page = 1;
  while (true) {
    const response = await listAdminProducts({ page, pageSize: 100, status: 'ACTIVE' }, signal);
    result.push(...response.items.map((item) => item.product));
    if (result.length >= response.pagination.total || response.items.length === 0) return result;
    page += 1;
  }
}

async function loadReferences(): Promise<void> {
  const sequence = ++referenceSequence;
  referenceController?.abort();
  const controller = new AbortController();
  referenceController = controller;
  referencesLoading.value = true;
  referencesError.value = '';
  const [productResult, catalogResult] = await Promise.allSettled([
    listAllActiveProducts(controller.signal),
    listActiveCatalogOptions(controller.signal),
  ]);
  if (sequence !== referenceSequence) return;

  const failures = [productResult, catalogResult]
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason as unknown);
  if (failures.some(isAbort)) return;
  const authError = failures.find((error) => error instanceof AdminApiError && error.status === 401);
  if (authError instanceof AdminApiError) {
    closeForAuth(authError);
    return;
  }

  products.value = productResult.status === 'fulfilled' ? productResult.value : [];
  categories.value = catalogResult.status === 'fulfilled' ? catalogResult.value.categories : [];
  productReferencesLoaded.value = productResult.status === 'fulfilled';
  categoryReferencesLoaded.value = catalogResult.status === 'fulfilled';
  if (failures.length) referencesError.value = '部分跳转目标加载失败；可使用不跳转或 HTTPS 地址后保存';
  referencesLoading.value = false;
  referenceController = null;
}

function changeTargetType(): void {
  form.targetId = '';
  form.targetUrl = '';
  errorMessage.value = '';
}

function changeAsset(asset: UploadedBannerAsset): void {
  form.fileId = asset.fileId;
  form.imageUrl = asset.publicUrl;
  errorMessage.value = '';
}

function removeAsset(): void {
  form.fileId = null;
  form.imageUrl = null;
  errorMessage.value = '';
}

function validUrl(value: string): boolean {
  if (characterLength(value) > 500) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function buildInput(): BannerEditorInput | null {
  const title = form.title.trim();
  if (characterLength(title) < 1 || characterLength(title) > 160) {
    errorMessage.value = 'Banner 标题须为 1–160 个字符';
    return null;
  }
  if (!form.fileId) {
    errorMessage.value = '请选择并完成 Banner 图片上传';
    return null;
  }
  if (!Number.isSafeInteger(form.sortOrder) || form.sortOrder < 0 || form.sortOrder > 2_147_483_647) {
    errorMessage.value = '排序须为非负整数';
    return null;
  }

  const startsAt = props.item && form.startsAt === shanghaiInput(props.item.starts_at)
    ? props.item.starts_at
    : toRfc3339(form.startsAt);
  const endsAt = props.item && form.endsAt === shanghaiInput(props.item.ends_at)
    ? props.item.ends_at
    : toRfc3339(form.endsAt);
  if ((form.startsAt && !startsAt) || (form.endsAt && !endsAt)) {
    errorMessage.value = '投放时间格式不正确';
    return null;
  }
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errorMessage.value = '结束时间必须晚于开始时间';
    return null;
  }

  let target: BannerEditorInput['target'];
  if (form.targetType === 'NONE') target = { targetType: 'NONE' };
  else if (form.targetType === 'URL') {
    const targetUrl = form.targetUrl.trim();
    if (!validUrl(targetUrl)) {
      errorMessage.value = '跳转地址须为不含账号信息的 HTTPS 地址，最长 500 个字符';
      return null;
    }
    target = { targetType: 'URL', targetUrl };
  } else {
    if (!form.targetId) {
      errorMessage.value = `请选择${form.targetType === 'PRODUCT' ? '商品' : '分类'}跳转目标`;
      return null;
    }
    if (unavailableTarget.value) {
      errorMessage.value = '当前关联目标已不可用，请选择新的已启用目标后保存';
      return null;
    }
    target = { targetId: form.targetId, targetType: form.targetType };
  }

  return {
    endsAt,
    fileId: form.fileId,
    sortOrder: form.sortOrder,
    startsAt,
    target,
    title,
  };
}

function commandKey(signature: string): string {
  if (attempt?.signature !== signature) attempt = { key: newIdempotencyKey(), signature };
  return attempt.key;
}

function closeForAuth(error: AdminApiError): void {
  clearState();
  emit('update:open', false);
  emit('authExpired', error);
}

function closeForConflict(target: BannerItem | null): void {
  clearState();
  emit('update:open', false);
  emit('conflict', target);
}

async function save(): Promise<void> {
  if (saving.value || assetUploading.value) return;
  errorMessage.value = '';
  const input = buildInput();
  if (!input) return;

  const current = props.item;
  const signature = JSON.stringify({
    bannerId: current?.banner_id ?? null,
    input,
    version: current?.version ?? null,
  });
  saving.value = true;
  try {
    const key = commandKey(signature);
    const saved = current
      ? await updateAdminBanner(current.banner_id, input, current.version, key)
      : await createAdminBanner(input, key);
    attempt = null;
    unknownOutcome.value = false;
    emit('update:open', false);
    emit('saved', saved);
    clearState();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) {
      closeForAuth(error);
      return;
    }
    if (current && error instanceof AdminApiError && error.code === 'RESOURCE_VERSION_CONFLICT') {
      closeForConflict(current);
      return;
    }
    unknownOutcome.value = isUnknownOutcome(error);
    if (!unknownOutcome.value) attempt = null;
    if (error instanceof AdminApiError && error.code === 'STATE_CONFLICT') void loadReferences();
    errorMessage.value = readableError(error);
  } finally {
    saving.value = false;
  }
}

watch(
  [() => props.open, () => props.item?.banner_id, () => props.item?.version],
  ([open]) => {
    clearState();
    fillForm(open ? props.item : null);
    if (open) void loadReferences();
  },
);

onBeforeUnmount(clearState);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    data-testid="banner-editor-dialog"
    width="min(760px, calc(100vw - 28px))"
    :close-on-click-modal="false"
    :close-on-press-escape="!saving && !assetUploading && !unknownOutcome"
    :show-close="!saving && !assetUploading && !unknownOutcome"
    destroy-on-close
    @closed="clearState"
  >
    <template #header>
      <div class="dialog-heading">
        <strong>{{ editing ? '编辑 Banner' : '新建 Banner' }}</strong>
        <p>{{ editing ? `${item?.title} · v${item?.version}` : '新 Banner 固定保存为草稿' }}</p>
      </div>
    </template>

    <div class="banner-editor-dialog">
      <el-alert
        v-if="!editing"
        title="创建后固定为草稿"
        description="资料保存不会启用 Banner；启用需从列表单独确认。"
        type="info"
        :closable="false"
        show-icon
      />
      <el-alert
        v-if="referencesError"
        :title="referencesError"
        type="warning"
        :closable="false"
        show-icon
      />
      <el-alert
        v-if="unknownOutcome"
        title="保存结果尚未确认"
        description="为避免重复保存，资料已暂时锁定。请保持当前内容不变并使用下方按钮重试。"
        type="warning"
        :closable="false"
        show-icon
      />

      <BannerAssetUpload
        :file-id="form.fileId"
        :image-url="form.imageUrl"
        :disabled="editorLocked"
        @change="changeAsset"
        @remove="removeAsset"
        @uploading="assetUploading = $event"
        @auth-expired="closeForAuth"
      />

      <el-form
        class="editor-form"
        label-position="top"
      >
        <div class="editor-form-grid">
          <el-form-item
            class="full-field"
            label="Banner 标题"
            required
          >
            <el-input
              v-model="form.title"
              maxlength="160"
              show-word-limit
              aria-label="Banner 标题"
              :disabled="editorLocked"
              @input="errorMessage = ''"
            />
          </el-form-item>

          <el-form-item
            label="展示顺序"
            required
          >
            <el-input-number
              v-model="form.sortOrder"
              :min="0"
              :max="2147483647"
              :precision="0"
              controls-position="right"
              aria-label="Banner 展示顺序"
              :disabled="editorLocked"
              @change="errorMessage = ''"
            />
          </el-form-item>

          <el-form-item
            label="跳转类型"
            required
          >
            <el-select
              v-model="form.targetType"
              aria-label="Banner 跳转类型"
              :disabled="editorLocked"
              @change="changeTargetType"
            >
              <el-option
                label="不跳转"
                value="NONE"
              />
              <el-option
                label="商品"
                value="PRODUCT"
              />
              <el-option
                label="一级分类"
                value="CATEGORY"
              />
              <el-option
                label="HTTPS 地址"
                value="URL"
              />
            </el-select>
          </el-form-item>

          <el-form-item
            v-if="form.targetType === 'PRODUCT'"
            class="full-field"
            label="跳转商品"
            required
          >
            <el-select
              v-model="form.targetId"
              filterable
              aria-label="Banner 跳转商品"
              placeholder="选择已启用商品"
              :loading="referencesLoading"
              :disabled="editorLocked"
              @change="errorMessage = ''"
            >
              <el-option
                v-if="unavailableTarget"
                :label="`当前目标不可用 · ${form.targetId}`"
                :value="form.targetId"
                disabled
              />
              <el-option
                v-for="product in products"
                :key="product.product_id"
                :label="`${product.name} · ${product.spu_code}`"
                :value="product.product_id"
              />
            </el-select>
          </el-form-item>

          <el-form-item
            v-if="form.targetType === 'CATEGORY'"
            class="full-field"
            label="跳转分类"
            required
          >
            <el-select
              v-model="form.targetId"
              filterable
              aria-label="Banner 跳转分类"
              placeholder="选择已启用分类"
              :loading="referencesLoading"
              :disabled="editorLocked"
              @change="errorMessage = ''"
            >
              <el-option
                v-if="unavailableTarget"
                :label="`当前目标不可用 · ${form.targetId}`"
                :value="form.targetId"
                disabled
              />
              <el-option
                v-for="category in categories"
                :key="category.category_id"
                :label="category.name"
                :value="category.category_id"
              />
            </el-select>
          </el-form-item>

          <el-alert
            v-if="unavailableTarget"
            class="full-field target-warning"
            title="当前关联目标已不在可用列表中"
            :description="`原目标 ID ${form.targetId} 已保留；请选择新的已启用目标，或取消编辑。`"
            type="warning"
            :closable="false"
            show-icon
          />

          <el-form-item
            v-if="form.targetType === 'URL'"
            class="full-field"
            label="HTTPS 跳转地址"
            required
          >
            <el-input
              v-model="form.targetUrl"
              maxlength="500"
              aria-label="Banner HTTPS 跳转地址"
              placeholder="https://mall.example.com/path"
              :disabled="editorLocked"
              @input="errorMessage = ''"
            />
          </el-form-item>

          <el-form-item label="开始时间（北京时间）">
            <el-date-picker
              v-model="form.startsAt"
              type="datetime"
              format="YYYY-MM-DD HH:mm:ss"
              value-format="YYYY-MM-DDTHH:mm:ss"
              aria-label="Banner 开始时间"
              placeholder="不限"
              :disabled="editorLocked"
              @change="errorMessage = ''"
            />
          </el-form-item>

          <el-form-item label="结束时间（北京时间）">
            <el-date-picker
              v-model="form.endsAt"
              type="datetime"
              format="YYYY-MM-DD HH:mm:ss"
              value-format="YYYY-MM-DDTHH:mm:ss"
              aria-label="Banner 结束时间"
              placeholder="不限"
              :disabled="editorLocked"
              @change="errorMessage = ''"
            />
          </el-form-item>
        </div>
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
        :disabled="saving || assetUploading || unknownOutcome"
        @click="dialogOpen = false"
      >
        取消
      </el-button>
      <el-button
        type="primary"
        :loading="saving"
        :disabled="assetUploading"
        data-testid="banner-editor-submit"
        @click="save"
      >
        {{ unknownOutcome ? '重试确认保存' : editing ? '保存 Banner 资料' : '创建草稿 Banner' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.banner-editor-dialog {
  display: grid;
  min-width: 0;
  gap: 18px;
}

.dialog-heading {
  display: grid;
  min-width: 0;
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

.editor-form {
  min-width: 0;
}

.editor-form-grid {
  display: grid;
  min-width: 0;
  gap: 0 14px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.full-field {
  grid-column: 1 / -1;
}

.editor-form :deep(.el-select),
.editor-form :deep(.el-input-number),
.editor-form :deep(.el-date-editor) {
  width: 100%;
}

.target-warning {
  margin-bottom: 18px;
}

.form-error {
  margin: -4px 0 0;
  color: var(--admin-danger);
  font-size: 12px;
  line-height: 1.55;
}

@media (max-width: 620px) {
  .editor-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .full-field {
    grid-column: auto;
  }
}
</style>
