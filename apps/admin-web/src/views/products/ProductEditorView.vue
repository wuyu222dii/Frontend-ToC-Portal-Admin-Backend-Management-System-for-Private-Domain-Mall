<script setup lang="ts">
import {
  ArrowLeft,
  CirclePlus,
  Edit,
  RefreshLeft,
  View,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ProductImagesEditor from '../../components/products/ProductImagesEditor.vue';
import ProductLifecycleDialog from '../../components/products/ProductLifecycleDialog.vue';
import SkuEditorDialog from '../../components/products/SkuEditorDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import {
  createAdminProduct,
  getAdminProduct,
  listActiveCatalogOptions,
  updateAdminProduct,
} from '../../services/admin-products';
import { authSession } from '../../stores/auth-session';
import type {
  BrandReference,
  CategoryReference,
  ProductCreateRequest,
  ProductDetail,
  ProductImage,
  ProductStatus,
  ProductUpdateRequest,
  Sku,
  SkuStatus,
} from '../../types/products';

interface CommandAttempt {
  key: string;
  signature: string;
}

interface LifecycleTarget {
  id: string;
  kind: 'product' | 'sku';
  name: string;
  status: ProductStatus | SkuStatus;
  version: number;
}

const route = useRoute();
const router = useRouter();
const detail = ref<ProductDetail | null>(null);
const brands = ref<BrandReference[]>([]);
const categories = ref<CategoryReference[]>([]);
const images = ref<ProductImage[]>([]);
const loading = ref(true);
const loadError = ref('');
const saving = ref(false);
const saveError = ref('');
const optionsError = ref('');
const imagesUploading = ref(false);
const activeTab = ref('details');
const skuDialogOpen = ref(false);
const selectedSku = ref<Sku | null>(null);
const lifecycleOpen = ref(false);
const lifecycleTarget = ref<LifecycleTarget | null>(null);
const savedFormSignature = ref('');
const zeroInventorySkuIds = new Set<string>();
let loadSequence = 0;
let loadController: AbortController | null = null;
let saveAttempt: CommandAttempt | null = null;
let successFeedback: ReturnType<typeof ElMessage.success> | null = null;

const form = reactive({
  brandId: '',
  categoryId: '',
  ingredients: '',
  introduction: '',
  name: '',
  spuCode: '',
  subtitle: '',
  usageMethod: '',
});

const isNew = computed(() => route.name === 'product-new');
const archived = computed(() => detail.value?.status === 'ARCHIVED');
const productId = computed(() => isNew.value ? '' : String(route.params.product_id ?? ''));
const pageTitle = computed(() => {
  if (isNew.value) return '新增商品';
  if (archived.value) return '查看归档商品';
  return '编辑商品';
});
const brandOptions = computed(() => {
  const values = [...brands.value];
  const current = detail.value?.brand;
  if (current && !values.some((value) => value.brand_id === current.brand_id)) values.unshift(current);
  return values;
});
const categoryOptions = computed(() => {
  const values = [...categories.value];
  const current = detail.value?.category;
  if (current && !values.some((value) => value.category_id === current.category_id)) values.unshift(current);
  return values;
});
const productDirty = computed(() => Boolean(detail.value) && savedFormSignature.value !== productFormSignature());

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function isUnknownOutcome(error: unknown): boolean {
  return error instanceof AdminApiError && (error.status === 0 || error.status >= 500);
}

function statusLabel(value: ProductStatus | SkuStatus): string {
  return ({ ACTIVE: '已启用', ARCHIVED: '已归档', DRAFT: '草稿', INACTIVE: '已停用' })[value];
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof AdminApiError)) return fallback;
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问或修改商品';
  if (error.status === 404) return '商品不存在或已不可用';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  if (error.code === 'SOFT_DELETED_KEY_RESERVED') return '该编码由归档记录保留，请恢复原记录';
  if (error.status === 409) return 'SPU 编码已存在，或关联资料状态已变化；请检查编码、品牌和分类';
  if (error.status === 400 || error.status === 422) return '商品资料不符合要求，请检查必填项和图片';
  if (error.status >= 500) return fallback;
  return fallback;
}

function showSuccess(message: string): void {
  successFeedback?.close();
  successFeedback = ElMessage.success({ duration: 1500, message });
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  clearSensitiveState();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

function clearForm(): void {
  form.brandId = '';
  form.categoryId = '';
  form.ingredients = '';
  form.introduction = '';
  form.name = '';
  form.spuCode = '';
  form.subtitle = '';
  form.usageMethod = '';
  images.value = [];
  detail.value = null;
  savedFormSignature.value = '';
  saveError.value = '';
  saveAttempt = null;
}

function fillForm(value: ProductDetail): void {
  detail.value = value;
  form.brandId = value.brand.brand_id;
  form.categoryId = value.category.category_id;
  form.ingredients = value.ingredients ?? '';
  form.introduction = value.introduction ?? '';
  form.name = value.name;
  form.spuCode = value.spu_code;
  form.subtitle = value.subtitle ?? '';
  form.usageMethod = value.usage_method ?? '';
  images.value = value.images.map((image) => ({ ...image }));
  savedFormSignature.value = productFormSignature();
}

async function loadEditor(): Promise<void> {
  const sequence = ++loadSequence;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  loading.value = true;
  loadError.value = '';
  optionsError.value = '';
  closeDialogs();
  clearForm();
  try {
    const referencesPromise = listActiveCatalogOptions(controller.signal);
    if (isNew.value) {
      const references = await referencesPromise;
      if (sequence !== loadSequence) return;
      brands.value = references.brands;
      categories.value = references.categories;
      form.brandId = references.brands[0]?.brand_id ?? '';
      form.categoryId = references.categories[0]?.category_id ?? '';
    } else {
      const [referencesResult, productResult] = await Promise.allSettled([
        referencesPromise,
        getAdminProduct(productId.value, controller.signal),
      ]);
      if (sequence !== loadSequence) return;
      if (productResult.status === 'rejected') throw productResult.reason;
      fillForm(productResult.value);
      if (referencesResult.status === 'fulfilled') {
        brands.value = referencesResult.value.brands;
        categories.value = referencesResult.value.categories;
      } else if (!(await handleSessionError(referencesResult.reason))) {
        optionsError.value = readableError(referencesResult.reason, '可选品牌与分类加载失败，当前资料仍可查看');
      }
    }
  } catch (error) {
    if (isAbort(error) || sequence !== loadSequence) return;
    if (await handleSessionError(error)) return;
    loadError.value = readableError(error, '商品详情加载失败，请稍后重试');
  } finally {
    if (sequence === loadSequence) loading.value = false;
  }
}

function nullable(value: string): string | null {
  return value.trim() || null;
}

function validateProduct(): string | null {
  if (isNew.value && (form.spuCode.trim().length < 1 || form.spuCode.trim().length > 80)) {
    return 'SPU 编码须为 1–80 个字符';
  }
  if (form.name.trim().length < 1 || form.name.trim().length > 200) return '商品名称须为 1–200 个字符';
  if (!form.brandId) return '请选择品牌';
  if (!form.categoryId) return '请选择一级分类';
  if (form.subtitle.length > 300) return '副标题不能超过 300 个字符';
  if (form.introduction.length > 5000) return '商品介绍不能超过 5000 个字符';
  if (form.ingredients.length > 10000) return '成分说明不能超过 10000 个字符';
  if (form.usageMethod.length > 5000) return '使用方法不能超过 5000 个字符';
  if (images.value.length > 8) return '商品图集最多 8 张';
  return null;
}

function updateBody(): ProductUpdateRequest {
  return {
    brand_id: form.brandId,
    category_id: form.categoryId,
    images: images.value.map((image, index) => ({ file_id: image.file_id, sort_order: index })),
    ingredients: nullable(form.ingredients),
    introduction: nullable(form.introduction),
    name: form.name.trim(),
    subtitle: nullable(form.subtitle),
    usage_method: nullable(form.usageMethod),
  };
}

function productFormSignature(): string {
  return JSON.stringify({
    ...updateBody(),
    spu_code: form.spuCode.trim().toUpperCase(),
  });
}

function warnUnsavedChanges(): void {
  ElMessage.warning(imagesUploading.value
    ? '商品图片仍在上传，请等待上传完成并保存资料'
    : '商品资料有未保存修改，请先保存后再维护 SKU 或生命周期');
}

function beforeLeaveTab(nextName: string | number, currentName: string | number): boolean {
  if (currentName === 'details' && nextName === 'skus' && (productDirty.value || imagesUploading.value)) {
    warnUnsavedChanges();
    return false;
  }
  return true;
}

function commandKey(signature: string): string {
  if (saveAttempt?.signature !== signature) saveAttempt = { key: newIdempotencyKey(), signature };
  return saveAttempt.key;
}

async function saveProduct(): Promise<void> {
  if (saving.value || imagesUploading.value || archived.value) return;
  saveError.value = validateProduct() ?? '';
  if (saveError.value) return;
  const current = detail.value;
  const common = updateBody();
  const input: ProductCreateRequest | ProductUpdateRequest = isNew.value
    ? {
        ...common,
        images: common.images ?? [],
        initial_status: 'DRAFT',
        spu_code: form.spuCode.trim().toUpperCase(),
      } as ProductCreateRequest
    : common;
  const signature = JSON.stringify({
    id: current?.product_id ?? null,
    input,
    version: current?.version ?? null,
  });
  saving.value = true;
  try {
    const key = commandKey(signature);
    if (isNew.value) {
      await createAdminProduct(input as ProductCreateRequest, key);
      saveAttempt = null;
      showSuccess('商品已创建为草稿');
      await router.replace('/catalog/products');
    } else if (current) {
      const saved = await updateAdminProduct(current.product_id, input, current.version, key);
      saveAttempt = null;
      fillForm(saved);
      showSuccess('商品资料已保存');
    }
  } catch (error) {
    if (await handleSessionError(error)) return;
    if (!isUnknownOutcome(error)) saveAttempt = null;
    if (error instanceof AdminApiError && error.status === 409 && current) {
      await loadEditor();
      ElMessage.warning('商品已被其他操作更新，已载入最新资料，请重新确认修改');
      return;
    }
    saveError.value = readableError(error, '商品保存结果尚未确认，可保持内容不变后重试');
  } finally {
    saving.value = false;
  }
}

function openSkuEditor(sku: Sku | null): void {
  selectedSku.value = sku;
  skuDialogOpen.value = true;
}

async function skuSaved(saved: Sku): Promise<void> {
  if (!detail.value?.skus.some((sku) => sku.sku_id === saved.sku_id)) zeroInventorySkuIds.add(saved.sku_id);
  skuDialogOpen.value = false;
  selectedSku.value = null;
  showSuccess('SKU 资料已保存');
  await refreshDetail();
  activeTab.value = 'skus';
}

async function skuConflict(): Promise<void> {
  skuDialogOpen.value = false;
  selectedSku.value = null;
  await refreshDetail();
  activeTab.value = 'skus';
  ElMessage.warning('SKU 或所属商品状态已变化，已刷新最新详情，请重新编辑');
}

function openLifecycle(kind: 'product' | 'sku', item: ProductDetail | Sku): void {
  if (kind === 'product' && (productDirty.value || imagesUploading.value)) {
    warnUnsavedChanges();
    return;
  }
  lifecycleTarget.value = kind === 'product'
    ? {
        id: (item as ProductDetail).product_id,
        kind,
        name: (item as ProductDetail).name,
        status: (item as ProductDetail).status,
        version: (item as ProductDetail).version,
      }
    : {
        id: (item as Sku).sku_id,
        kind,
        name: (item as Sku).name,
        status: (item as Sku).status,
        version: (item as Sku).version,
      };
  lifecycleOpen.value = true;
}

async function lifecycleRepairRequested(code: string): Promise<void> {
  closeDialogs();
  if (code === 'STATE_CONFLICT') {
    await refreshDetail();
    return;
  }
  activeTab.value = code === 'PRODUCT_PRIMARY_IMAGE_REQUIRED' ? 'details' : 'skus';
  await nextTick();
  const selector = activeTab.value === 'details' ? '[data-testid="product-images-editor"]' : '.sku-section';
  document.querySelector<HTMLElement>(selector)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeDialogs(): void {
  skuDialogOpen.value = false;
  selectedSku.value = null;
  lifecycleOpen.value = false;
  lifecycleTarget.value = null;
}

async function lifecycleCompleted(): Promise<void> {
  closeDialogs();
  showSuccess('生命周期已更新');
  await refreshDetail();
}

async function lifecycleConflict(): Promise<void> {
  closeDialogs();
  await refreshDetail();
  ElMessage.warning('状态或版本已变化，已刷新商品详情，请重新预览并确认');
}

async function refreshDetail(): Promise<void> {
  if (!productId.value) return;
  const current = await getAdminProduct(productId.value).catch(async (error: unknown) => {
    if (!(await handleSessionError(error))) ElMessage.error(readableError(error, '商品详情刷新失败'));
    return null;
  });
  if (current) fillForm(current);
}

function clearSensitiveState(): void {
  ++loadSequence;
  loadController?.abort();
  loadController = null;
  closeDialogs();
  clearForm();
  successFeedback?.close();
  successFeedback = null;
}

function lifecycleActionLabel(status: ProductStatus | SkuStatus): string {
  return status === 'ACTIVE' ? '停用' : '影响预览';
}

watch(() => route.fullPath, () => {
  activeTab.value = route.query.tab === 'skus' ? 'skus' : 'details';
  void loadEditor();
});

onMounted(() => {
  activeTab.value = route.query.tab === 'skus' ? 'skus' : 'details';
  void loadEditor();
});
onBeforeUnmount(clearSensitiveState);
</script>

<template>
  <AdminShell>
    <div
      class="product-editor-page"
      data-testid="product-editor-page"
    >
      <header class="editor-heading">
        <el-button
          circle
          :icon="ArrowLeft"
          aria-label="返回商品列表"
          title="返回商品列表"
          @click="router.push('/catalog/products')"
        />
        <div>
          <p>商品中心 · ADM-04</p>
          <div>
            <h1>{{ pageTitle }}</h1>
            <span
              v-if="detail"
              class="status-badge"
              :class="`is-${detail.status.toLowerCase()}`"
            >
              {{ statusLabel(detail.status) }}
            </span>
          </div>
          <small v-if="detail">{{ detail.spu_code }} · v{{ detail.version }}</small>
          <small v-else>保存后生成商品记录；固定创建为草稿。</small>
        </div>
        <div
          v-if="!loading && !loadError"
          class="heading-actions"
        >
          <el-button
            v-if="detail && !archived"
            @click="openLifecycle('product', detail)"
          >
            <el-icon><View /></el-icon>
            {{ lifecycleActionLabel(detail.status) }}
          </el-button>
          <el-button
            v-if="detail && archived"
            type="primary"
            @click="openLifecycle('product', detail)"
          >
            <el-icon><RefreshLeft /></el-icon>
            恢复商品
          </el-button>
        </div>
      </header>

      <section
        v-if="loading"
        class="editor-state"
      >
        <el-skeleton
          :rows="10"
          animated
        />
      </section>
      <section
        v-else-if="loadError"
        class="editor-state"
      >
        <el-alert
          :title="loadError"
          type="error"
          :closable="false"
          show-icon
        />
        <el-button @click="loadEditor">
          重新加载
        </el-button>
      </section>
      <template v-else>
        <el-alert
          v-if="isNew"
          class="editor-alert"
          title="新商品固定保存为草稿"
          description="商品创建后可继续维护 SKU；启用须单独完成影响预览与确认。"
          type="info"
          :closable="false"
          show-icon
        />
        <el-alert
          v-else-if="archived"
          class="editor-alert"
          title="归档商品只读"
          description="恢复为草稿后才能修改资料；恢复不会级联恢复 SKU。"
          type="warning"
          :closable="false"
          show-icon
        />
        <el-alert
          v-if="optionsError"
          class="editor-alert"
          :title="optionsError"
          type="warning"
          :closable="false"
          show-icon
        />

        <section class="editor-workspace">
          <el-tabs
            v-model="activeTab"
            :before-leave="beforeLeaveTab"
          >
            <el-tab-pane
              label="基本资料"
              name="details"
            >
              <form
                class="product-form"
                @submit.prevent="saveProduct"
              >
                <ProductImagesEditor
                  v-model="images"
                  :disabled="archived || saving"
                  @uploading="imagesUploading = $event"
                  @auth-expired="handleSessionError"
                />

                <el-form label-position="top">
                  <div class="product-form-grid">
                    <el-form-item
                      label="商品名称"
                      required
                    >
                      <el-input
                        v-model="form.name"
                        maxlength="200"
                        show-word-limit
                        :disabled="archived || saving"
                        aria-label="商品名称"
                      />
                    </el-form-item>
                    <el-form-item
                      label="SPU 编码"
                      required
                    >
                      <el-input
                        v-model="form.spuCode"
                        maxlength="80"
                        :disabled="!isNew || archived || saving"
                        aria-label="SPU 编码"
                      />
                    </el-form-item>
                    <el-form-item
                      label="品牌"
                      required
                    >
                      <el-select
                        v-model="form.brandId"
                        :disabled="archived || saving"
                        aria-label="品牌"
                      >
                        <el-option
                          v-for="brand in brandOptions"
                          :key="brand.brand_id"
                          :label="brand.name"
                          :value="brand.brand_id"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item
                      label="一级分类"
                      required
                    >
                      <el-select
                        v-model="form.categoryId"
                        :disabled="archived || saving"
                        aria-label="一级分类"
                      >
                        <el-option
                          v-for="category in categoryOptions"
                          :key="category.category_id"
                          :label="category.name"
                          :value="category.category_id"
                        />
                      </el-select>
                    </el-form-item>
                    <el-form-item
                      class="full-field"
                      label="副标题"
                    >
                      <el-input
                        v-model="form.subtitle"
                        maxlength="300"
                        show-word-limit
                        :disabled="archived || saving"
                        aria-label="副标题"
                      />
                    </el-form-item>
                    <el-form-item
                      class="full-field"
                      label="商品介绍"
                    >
                      <el-input
                        v-model="form.introduction"
                        type="textarea"
                        :rows="4"
                        maxlength="5000"
                        show-word-limit
                        :disabled="archived || saving"
                        aria-label="商品介绍"
                      />
                    </el-form-item>
                    <el-form-item
                      class="full-field"
                      label="成分说明"
                    >
                      <el-input
                        v-model="form.ingredients"
                        type="textarea"
                        :rows="4"
                        maxlength="10000"
                        show-word-limit
                        :disabled="archived || saving"
                        aria-label="成分说明"
                      />
                    </el-form-item>
                    <el-form-item
                      class="full-field"
                      label="使用方法"
                    >
                      <el-input
                        v-model="form.usageMethod"
                        type="textarea"
                        :rows="4"
                        maxlength="5000"
                        show-word-limit
                        :disabled="archived || saving"
                        aria-label="使用方法"
                      />
                    </el-form-item>
                  </div>
                </el-form>

                <p
                  v-if="saveError"
                  class="form-error"
                  role="alert"
                >
                  {{ saveError }}
                </p>
                <div
                  v-if="!archived"
                  class="form-actions"
                >
                  <el-button @click="router.push('/catalog/products')">
                    取消
                  </el-button>
                  <el-button
                    native-type="submit"
                    type="primary"
                    :loading="saving"
                    :disabled="imagesUploading"
                  >
                    保存商品资料
                  </el-button>
                </div>
              </form>
            </el-tab-pane>

            <el-tab-pane
              label="SKU 与价格"
              name="skus"
              :disabled="isNew"
            >
              <section class="sku-section">
                <header>
                  <div>
                    <strong>SKU 与只读库存</strong>
                    <span>SKU 独立维护生命周期；本阶段不提供库存写入。</span>
                  </div>
                  <el-button
                    v-if="detail && !archived"
                    type="primary"
                    @click="openSkuEditor(null)"
                  >
                    <el-icon><CirclePlus /></el-icon>
                    新增 SKU
                  </el-button>
                </header>
                <div
                  v-if="!detail?.skus.length"
                  class="sku-empty"
                >
                  <strong>暂无 SKU</strong>
                  <span>先创建停用 SKU，完善价格后再单独启用。</span>
                </div>
                <div
                  v-else
                  class="sku-list"
                >
                  <article
                    v-for="sku in detail.skus"
                    :key="sku.sku_id"
                    class="sku-row"
                    :data-testid="`sku-row-${sku.sku_id}`"
                  >
                    <div class="sku-identity">
                      <strong>{{ sku.name }}</strong>
                      <small>{{ sku.code }}</small>
                      <span v-if="sku.spec_json">
                        {{ sku.spec_json.attributes.map((attribute) => `${attribute.name}: ${attribute.value}`).join(' · ') }}
                      </span>
                    </div>
                    <div class="sku-price">
                      <span>零售价</span>
                      <strong>¥{{ sku.retail_price }}</strong>
                    </div>
                    <div class="sku-inventory">
                      <span>只读库存</span>
                      <template v-if="zeroInventorySkuIds.has(sku.sku_id)">
                        <small>实物 0</small>
                        <small>锁定 0</small>
                      </template>
                      <small>可售 {{ sku.available_stock }}</small>
                    </div>
                    <div class="sku-flags">
                      <span
                        class="status-badge"
                        :class="`is-${sku.status.toLowerCase()}`"
                      >{{ statusLabel(sku.status) }}</span>
                      <small v-if="sku.is_recommended">推荐 SKU</small>
                    </div>
                    <div
                      v-if="!archived"
                      class="sku-actions"
                    >
                      <el-button
                        v-if="sku.status !== 'ARCHIVED'"
                        link
                        type="primary"
                        @click="openSkuEditor(sku)"
                      >
                        <el-icon><Edit /></el-icon>
                        编辑 SKU
                      </el-button>
                      <el-button
                        v-if="sku.status !== 'ARCHIVED'"
                        link
                        type="primary"
                        @click="openLifecycle('sku', sku)"
                      >
                        {{ lifecycleActionLabel(sku.status) }}
                      </el-button>
                      <el-button
                        v-if="sku.status === 'ARCHIVED'"
                        link
                        type="primary"
                        @click="openLifecycle('sku', sku)"
                      >
                        <el-icon><RefreshLeft /></el-icon>
                        恢复 SKU
                      </el-button>
                    </div>
                  </article>
                </div>
              </section>
            </el-tab-pane>
          </el-tabs>
        </section>
      </template>
    </div>

    <SkuEditorDialog
      v-model:open="skuDialogOpen"
      :product-id="productId"
      :sku="selectedSku"
      :parent-archived="archived"
      @saved="skuSaved"
      @conflict="skuConflict"
      @auth-expired="handleSessionError"
    />
    <ProductLifecycleDialog
      v-model:open="lifecycleOpen"
      :target="lifecycleTarget"
      @completed="lifecycleCompleted"
      @conflict="lifecycleConflict"
      @auth-expired="handleSessionError"
      @repair-requested="lifecycleRepairRequested"
    />
  </AdminShell>
</template>

<style scoped>
.product-editor-page {
  min-width: 0;
}

.editor-heading {
  display: grid;
  min-width: 0;
  align-items: start;
  gap: 14px;
  margin-bottom: 20px;
  grid-template-columns: 34px minmax(0, 1fr) auto;
}

.editor-heading > div:nth-child(2) {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.editor-heading p,
.editor-heading h1,
.editor-heading small {
  margin: 0;
}

.editor-heading p {
  color: var(--admin-brand);
  font-size: 11px;
  font-weight: 700;
}

.editor-heading h1 {
  font-size: 25px;
  line-height: 1.25;
}

.editor-heading small {
  color: var(--admin-muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}

.editor-heading > div > div {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.heading-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.heading-actions .el-button + .el-button {
  margin-left: 0;
}

.editor-alert {
  margin-bottom: 12px;
}

.editor-state,
.editor-workspace {
  min-width: 0;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(20 45 34 / 4%);
}

.editor-state {
  display: grid;
  min-height: 420px;
  align-content: center;
  justify-items: center;
  gap: 14px;
  padding: 24px;
}

.editor-state > * {
  width: min(100%, 760px);
}

.editor-workspace {
  padding: 0 20px 22px;
}

.editor-workspace :deep(.el-tabs__header) {
  margin-bottom: 20px;
}

.product-form {
  display: grid;
  min-width: 0;
  gap: 22px;
}

.product-form-grid {
  display: grid;
  min-width: 0;
  gap: 0 16px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.product-form-grid .full-field {
  grid-column: 1 / -1;
}

.product-form :deep(.el-select) {
  width: 100%;
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

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding-top: 16px;
  border-top: 1px solid var(--admin-border);
}

.form-actions .el-button + .el-button {
  margin-left: 0;
}

.sku-section {
  display: grid;
  min-width: 0;
  gap: 14px;
}

.sku-section > header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.sku-section > header > div {
  display: grid;
  gap: 4px;
}

.sku-section > header strong,
.sku-identity strong,
.sku-price strong {
  font-size: 13px;
}

.sku-section > header span,
.sku-identity small,
.sku-identity span,
.sku-price span,
.sku-inventory span,
.sku-inventory small,
.sku-flags small {
  color: var(--admin-muted);
  font-size: 10px;
}

.sku-empty {
  display: grid;
  min-height: 220px;
  align-content: center;
  justify-items: center;
  gap: 6px;
  border: 1px dashed var(--admin-border);
  border-radius: 7px;
  color: var(--admin-muted);
}

.sku-empty strong {
  color: var(--admin-text);
  font-size: 13px;
}

.sku-empty span {
  font-size: 11px;
}

.sku-list {
  display: grid;
  min-width: 0;
  gap: 8px;
}

.sku-row {
  display: grid;
  min-width: 0;
  align-items: center;
  gap: 12px;
  padding: 13px;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  grid-template-columns: minmax(190px, 1.25fr) minmax(90px, 0.55fr) minmax(110px, 0.65fr) minmax(100px, 0.6fr) minmax(150px, 0.8fr);
}

.sku-identity,
.sku-price,
.sku-inventory,
.sku-flags {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.sku-identity > * {
  overflow-wrap: anywhere;
}

.sku-actions {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 4px 8px;
}

.sku-actions .el-button + .el-button {
  margin-left: 0;
}

.status-badge {
  display: inline-flex;
  width: fit-content;
  min-height: 24px;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
}

.status-badge.is-active { color: #27624f; background: #e5f1eb; }
.status-badge.is-inactive { color: #655f53; background: #f0eee9; }
.status-badge.is-draft { color: #806227; background: #f7efd9; }
.status-badge.is-archived { color: #777; background: #ededed; }

@media (max-width: 900px) {
  .editor-heading {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .heading-actions {
    justify-content: flex-start;
    grid-column: 2;
  }

  .sku-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .sku-identity,
  .sku-actions {
    grid-column: 1 / -1;
  }
}

@media (max-width: 600px) {
  .editor-heading {
    align-items: start;
  }

  .heading-actions {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
  }

  .heading-actions .el-button {
    width: 100%;
  }

  .editor-workspace {
    padding-right: 12px;
    padding-left: 12px;
  }

  .sku-section > header {
    align-items: stretch;
    flex-direction: column;
  }

  .sku-row {
    grid-template-columns: minmax(0, 1fr);
  }

  .sku-identity,
  .sku-actions {
    grid-column: auto;
  }

  .form-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 360px) {
  .product-form-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .product-form-grid .full-field {
    grid-column: auto;
  }
}
</style>
