<script setup lang="ts">
import {
  ArrowLeft,
  ArrowRight,
  CirclePlus,
  Edit,
  Picture,
  Refresh,
  RefreshLeft,
  Search,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import ProductLifecycleDialog from '../../components/products/ProductLifecycleDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import {
  listActiveCatalogOptions,
  listAdminProducts,
} from '../../services/admin-products';
import { authSession } from '../../stores/auth-session';
import type {
  AdminProductListItem,
  BrandReference,
  CategoryReference,
  ProductLifecycleAction,
  ProductListQuery,
  ProductStatus,
} from '../../types/products';

type StatusFilter = '' | ProductStatus;

interface LifecycleTarget {
  id: string;
  kind: 'product';
  name: string;
  status: ProductStatus;
  version: number;
}

const router = useRouter();
const items = ref<AdminProductListItem[]>([]);
const brands = ref<BrandReference[]>([]);
const categories = ref<CategoryReference[]>([]);
const loading = ref(false);
const listError = ref('');
const optionsError = ref('');
const keyword = ref('');
const brandId = ref('');
const categoryId = ref('');
const status = ref<StatusFilter>('');
const recommendedOnly = ref(false);
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const lifecycleOpen = ref(false);
const lifecycleTarget = ref<LifecycleTarget | null>(null);
const lifecycleInitialAction = ref<ProductLifecycleAction | undefined>();
let listSequence = 0;
let listController: AbortController | null = null;
let optionsController: AbortController | null = null;

const statusOptions: Array<{ label: string; value: StatusFilter }> = [
  { label: '默认（不含已归档）', value: '' },
  { label: '草稿', value: 'DRAFT' },
  { label: '已启用', value: 'ACTIVE' },
  { label: '已停用', value: 'INACTIVE' },
  { label: '已归档', value: 'ARCHIVED' },
];

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function statusLabel(value: ProductStatus): string {
  return ({ ACTIVE: '已启用', ARCHIVED: '已归档', DRAFT: '草稿', INACTIVE: '已停用' })[value];
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof AdminApiError)) return fallback;
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问商品管理';
  if (error.status === 404) return '商品不存在或已不可用，请刷新列表';
  if (error.status === 429) return '操作过于频繁，请稍后重试';
  return fallback;
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  items.value = [];
  total.value = 0;
  closeLifecycle();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function loadOptions(): Promise<void> {
  optionsController?.abort();
  const controller = new AbortController();
  optionsController = controller;
  optionsError.value = '';
  try {
    const result = await listActiveCatalogOptions(controller.signal);
    if (controller !== optionsController) return;
    brands.value = result.brands;
    categories.value = result.categories;
  } catch (error) {
    if (isAbort(error) || controller !== optionsController) return;
    if (await handleSessionError(error)) return;
    optionsError.value = readableError(error, '品牌与分类选项加载失败');
  } finally {
    if (controller === optionsController) optionsController = null;
  }
}

async function loadProducts(): Promise<void> {
  const sequence = ++listSequence;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  loading.value = true;
  listError.value = '';
  try {
    const query: ProductListQuery = {
      page: page.value,
      pageSize,
    };
    const trimmedKeyword = keyword.value.trim();
    if (brandId.value) query.brandId = brandId.value;
    if (categoryId.value) query.categoryId = categoryId.value;
    if (trimmedKeyword) query.keyword = trimmedKeyword;
    if (recommendedOnly.value) query.recommended = true;
    if (status.value) query.status = status.value;
    const result = await listAdminProducts(query, controller.signal);
    if (sequence !== listSequence) return;
    items.value = result.items;
    total.value = result.pagination.total;
    page.value = result.pagination.page;
  } catch (error) {
    if (isAbort(error) || sequence !== listSequence) return;
    if (await handleSessionError(error)) return;
    items.value = [];
    total.value = 0;
    listError.value = readableError(error, '商品列表加载失败，请稍后重试');
  } finally {
    if (sequence === listSequence) loading.value = false;
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadProducts();
}

function resetFilters(): void {
  keyword.value = '';
  brandId.value = '';
  categoryId.value = '';
  status.value = '';
  recommendedOnly.value = false;
  page.value = 1;
  void loadProducts();
}

function changePage(value: number): void {
  page.value = value;
  void loadProducts();
}

function editLabel(item: AdminProductListItem): string {
  return item.product.status === 'ARCHIVED' ? '查看商品' : '编辑商品';
}

function openLifecycle(item: AdminProductListItem, initialAction?: ProductLifecycleAction): void {
  lifecycleTarget.value = {
    id: item.product.product_id,
    kind: 'product',
    name: item.product.name,
    status: item.product.status,
    version: item.product.version,
  };
  lifecycleInitialAction.value = initialAction;
  lifecycleOpen.value = true;
}

function closeLifecycle(): void {
  lifecycleOpen.value = false;
  lifecycleTarget.value = null;
  lifecycleInitialAction.value = undefined;
}

async function lifecycleCompleted(): Promise<void> {
  closeLifecycle();
  ElMessage.success('商品生命周期已更新');
  await loadProducts();
}

async function lifecycleConflict(): Promise<void> {
  closeLifecycle();
  await loadProducts();
  ElMessage.warning('商品状态或版本已变化，已刷新最新数据，请重新预览并确认');
}

async function lifecycleAuthExpired(error: AdminApiError): Promise<void> {
  await handleSessionError(error);
}

function lifecycleRepairRequested(code: string, target: { id: string }): void {
  closeLifecycle();
  const tab = code === 'PRODUCT_PRIMARY_IMAGE_REQUIRED' || code === 'STATE_CONFLICT' ? 'details' : 'skus';
  void router.push({
    name: 'product-detail',
    params: { product_id: target.id },
    query: { tab },
  });
}

onMounted(() => {
  void loadOptions();
  void loadProducts();
});

onBeforeUnmount(() => {
  ++listSequence;
  listController?.abort();
  optionsController?.abort();
  closeLifecycle();
});
</script>

<template>
  <AdminShell>
    <div
      class="product-list-page"
      data-testid="product-list-page"
    >
      <section class="page-heading">
        <div>
          <p>商品中心 · ADM-03</p>
          <h1>商品管理</h1>
          <span>维护商品资料、SKU 价格与生命周期；库存仅作只读汇总。</span>
        </div>
        <el-button
          type="primary"
          @click="router.push('/catalog/products/new')"
        >
          <el-icon><CirclePlus /></el-icon>
          新增商品
        </el-button>
      </section>

      <el-alert
        v-if="optionsError"
        class="options-alert"
        :title="optionsError"
        type="warning"
        :closable="false"
        show-icon
      />

      <section
        class="product-toolbar"
        aria-label="商品筛选"
      >
        <el-input
          v-model="keyword"
          clearable
          aria-label="商品关键词"
          placeholder="商品名称、SPU 或 SKU 编码"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select
          v-model="brandId"
          clearable
          aria-label="品牌筛选"
          placeholder="全部品牌"
        >
          <el-option
            v-for="brand in brands"
            :key="brand.brand_id"
            :label="brand.name"
            :value="brand.brand_id"
          />
        </el-select>
        <el-select
          v-model="categoryId"
          clearable
          aria-label="分类筛选"
          placeholder="全部分类"
        >
          <el-option
            v-for="category in categories"
            :key="category.category_id"
            :label="category.name"
            :value="category.category_id"
          />
        </el-select>
        <el-select
          v-model="status"
          aria-label="状态筛选"
          placeholder="默认状态"
        >
          <el-option
            v-for="option in statusOptions"
            :key="option.value || 'DEFAULT'"
            v-bind="option"
          />
        </el-select>
        <label class="recommended-filter">
          <input
            v-model="recommendedOnly"
            type="checkbox"
            aria-label="仅含推荐 SKU"
          >
          <span>仅含推荐 SKU</span>
        </label>
        <div class="toolbar-actions">
          <el-button
            type="primary"
            @click="applyFilters"
          >
            <el-icon><Search /></el-icon>
            查询商品
          </el-button>
          <el-button @click="resetFilters">
            <el-icon><Refresh /></el-icon>
            重置筛选
          </el-button>
        </div>
      </section>

      <section
        class="product-list"
        :class="{ refreshing: loading && items.length }"
      >
        <header class="product-list-heading">
          <div>
            <strong>共 {{ total }} 个商品</strong>
            <span>默认不显示归档记录</span>
          </div>
          <el-button
            :icon="Refresh"
            :loading="loading"
            @click="loadProducts"
          >
            重新加载
          </el-button>
        </header>

        <div
          v-if="loading && !items.length"
          class="product-state"
          data-testid="product-list-loading"
        >
          <el-skeleton
            :rows="6"
            animated
          />
        </div>
        <div
          v-else-if="listError"
          class="product-state"
          data-testid="product-list-error"
        >
          <el-alert
            :title="listError"
            type="error"
            :closable="false"
            show-icon
          />
        </div>
        <div
          v-else-if="!items.length"
          class="product-state empty"
          data-testid="product-list-empty"
        >
          <el-icon><Picture /></el-icon>
          <strong>没有符合条件的商品</strong>
          <span>调整筛选条件后再试，或新建一个草稿商品。</span>
          <el-button @click="resetFilters">
            清除筛选
          </el-button>
        </div>
        <div
          v-else
          v-loading="loading"
          class="product-table"
          role="table"
          aria-label="商品列表"
        >
          <div
            class="product-table-header"
            role="row"
          >
            <span role="columnheader">商品信息</span>
            <span role="columnheader">最低活动价</span>
            <span role="columnheader">SKU / 库存摘要</span>
            <span role="columnheader">净销量</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">操作</span>
          </div>
          <article
            v-for="item in items"
            :key="item.product.product_id"
            class="product-row"
            role="row"
            :data-testid="`product-row-${item.product.product_id}`"
          >
            <div
              class="product-identity"
              role="cell"
            >
              <img
                v-if="item.product.primary_image"
                :src="item.product.primary_image.url"
                :alt="`${item.product.name}主图`"
                referrerpolicy="no-referrer"
              >
              <span
                v-else
                class="product-image-placeholder"
                aria-hidden="true"
              ><el-icon><Picture /></el-icon></span>
              <div>
                <strong>{{ item.product.name }}</strong>
                <small>{{ item.product.spu_code }}</small>
                <small>{{ item.product.brand.name }} · {{ item.product.category.name }}</small>
              </div>
            </div>
            <div
              class="product-price"
              role="cell"
              data-label="最低活动价"
            >
              <strong v-if="item.product.minimum_active_price">¥{{ item.product.minimum_active_price }}</strong>
              <span v-else>暂无活动价</span>
            </div>
            <div
              class="inventory-summary"
              role="cell"
              data-label="SKU / 库存摘要"
            >
              <strong>{{ item.sku_count }} SKU</strong>
              <span>{{ item.active_sku_count }} 个已启用</span>
              <div>
                <small>实物 {{ item.physical_stock }}</small>
                <small>锁定 {{ item.locked_stock }}</small>
                <small>可售 {{ item.available_stock }}</small>
              </div>
            </div>
            <div
              class="product-sales"
              role="cell"
              data-label="净销量"
            >
              <strong>{{ item.product.net_sales_count }}</strong>
            </div>
            <div
              role="cell"
              data-label="状态"
            >
              <span
                class="product-status"
                :class="`is-${item.product.status.toLowerCase()}`"
              >
                {{ statusLabel(item.product.status) }}
              </span>
            </div>
            <div
              class="product-actions"
              role="cell"
            >
              <el-button
                link
                type="primary"
                @click="router.push(`/catalog/products/${encodeURIComponent(item.product.product_id)}`)"
              >
                <el-icon><Edit /></el-icon>
                {{ editLabel(item) }}
              </el-button>
              <template v-if="item.product.status !== 'ARCHIVED'">
                <el-button
                  v-if="item.product.status !== 'ACTIVE'"
                  link
                  type="primary"
                  @click="openLifecycle(item, 'ACTIVATE')"
                >
                  启用
                </el-button>
                <el-button
                  v-if="item.product.status === 'ACTIVE'"
                  link
                  type="primary"
                  @click="openLifecycle(item, 'DEACTIVATE')"
                >
                  停用
                </el-button>
                <el-button
                  v-if="item.product.status !== 'ACTIVE'"
                  link
                  type="danger"
                  @click="openLifecycle(item, 'SOFT_DELETE')"
                >
                  归档
                </el-button>
              </template>
              <el-button
                v-else
                link
                type="primary"
                @click="openLifecycle(item)"
              >
                <el-icon><RefreshLeft /></el-icon>
                恢复商品
              </el-button>
            </div>
          </article>
        </div>

        <footer
          v-if="total > pageSize && !listError"
          class="product-pagination"
        >
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <div>
            <el-button
              circle
              :icon="ArrowLeft"
              :disabled="page <= 1 || loading"
              aria-label="上一页"
              title="上一页"
              @click="changePage(page - 1)"
            />
            <el-button
              circle
              :icon="ArrowRight"
              :disabled="page >= totalPages || loading"
              aria-label="下一页"
              title="下一页"
              @click="changePage(page + 1)"
            />
          </div>
        </footer>
      </section>
    </div>

    <ProductLifecycleDialog
      v-model:open="lifecycleOpen"
      :initial-action="lifecycleInitialAction"
      :target="lifecycleTarget"
      @completed="lifecycleCompleted"
      @conflict="lifecycleConflict"
      @auth-expired="lifecycleAuthExpired"
      @repair-requested="lifecycleRepairRequested"
    />
  </AdminShell>
</template>

<style scoped>
.product-list-page,
.product-list {
  min-width: 0;
}

.options-alert {
  margin-bottom: 14px;
}

.product-toolbar,
.product-list {
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 1px 2px rgb(20 45 34 / 4%);
}

.product-toolbar {
  display: grid;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding: 14px;
  grid-template-columns: minmax(220px, 1.5fr) repeat(3, minmax(132px, 0.7fr));
}

.product-toolbar :deep(.el-select),
.product-toolbar :deep(.el-input) {
  width: 100%;
}

.recommended-filter {
  display: inline-flex;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  color: var(--admin-text-soft);
  cursor: pointer;
  font-size: 12px;
}

.recommended-filter input {
  width: 18px;
  height: 18px;
  margin: 0;
  accent-color: var(--admin-brand);
}

.toolbar-actions {
  display: flex;
  gap: 8px;
  grid-column: 1 / -1;
}

.toolbar-actions .el-button + .el-button {
  margin-left: 0;
}

.product-list {
  overflow: hidden;
}

.product-list.refreshing {
  opacity: 0.82;
}

.product-list-heading {
  display: flex;
  min-height: 52px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--admin-border);
}

.product-list-heading > div {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.product-list-heading strong {
  font-size: 13px;
}

.product-list-heading span {
  color: var(--admin-muted);
  font-size: 11px;
}

.product-state {
  display: grid;
  min-height: 320px;
  align-content: center;
  justify-items: center;
  gap: 14px;
  padding: 28px;
  text-align: center;
}

.product-state > .el-alert,
.product-state > .el-skeleton {
  width: min(100%, 700px);
}

.product-state.empty > .el-icon {
  color: #9aac9f;
  font-size: 34px;
}

.product-state.empty > span {
  color: var(--admin-muted);
  font-size: 12px;
}

.product-table {
  min-width: 0;
}

.product-table-header,
.product-row {
  display: grid;
  min-width: 0;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  grid-template-columns: minmax(230px, 1.55fr) minmax(100px, 0.6fr) minmax(205px, 1fr) minmax(70px, 0.4fr) minmax(82px, 0.45fr) minmax(190px, 0.9fr);
}

.product-table-header {
  min-height: 42px;
  padding-top: 9px;
  padding-bottom: 9px;
  color: var(--admin-muted);
  background: #f8faf9;
  font-size: 11px;
  font-weight: 650;
}

.product-row {
  min-height: 88px;
  border-top: 1px solid var(--admin-border);
}

.product-row:first-of-type {
  border-top: 0;
}

.product-identity {
  display: grid;
  min-width: 0;
  align-items: center;
  gap: 11px;
  grid-template-columns: 52px minmax(0, 1fr);
}

.product-identity > img,
.product-image-placeholder {
  width: 52px;
  height: 52px;
  border: 1px solid var(--admin-border);
  border-radius: 6px;
  background: #eef4f1;
  object-fit: cover;
}

.product-image-placeholder {
  display: grid;
  color: #81958b;
  place-items: center;
}

.product-identity > div,
.inventory-summary {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.product-identity strong,
.product-identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.product-identity strong,
.inventory-summary > strong,
.product-sales strong,
.product-price strong {
  font-size: 13px;
}

.product-identity small,
.inventory-summary span,
.product-price span {
  color: var(--admin-muted);
  font-size: 11px;
}

.inventory-summary > div {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 9px;
}

.inventory-summary small {
  color: var(--admin-text-soft);
  font-size: 10px;
}

.product-status {
  display: inline-flex;
  min-height: 24px;
  align-items: center;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
}

.product-status.is-active { color: #27624f; background: #e5f1eb; }
.product-status.is-inactive { color: #655f53; background: #f0eee9; }
.product-status.is-draft { color: #806227; background: #f7efd9; }
.product-status.is-archived { color: #777; background: #ededed; }

.product-actions {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 7px;
}

.product-actions .el-button + .el-button {
  margin-left: 0;
}

.product-pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 14px 16px;
  border-top: 1px solid var(--admin-border);
}

.product-pagination > span {
  color: var(--admin-muted);
  font-size: 11px;
}

.product-pagination > div {
  display: flex;
  gap: 6px;
}

.product-pagination :deep(.el-button + .el-button) {
  margin-left: 0;
}

@media (max-width: 1180px) {
  .product-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .product-table-header {
    display: none;
  }

  .product-table {
    display: grid;
    gap: 10px;
    padding: 12px;
  }

  .product-row {
    border: 1px solid var(--admin-border);
    border-radius: 7px;
    grid-template-columns: minmax(220px, 1.4fr) repeat(2, minmax(120px, 0.7fr));
  }

  .product-row:first-of-type {
    border-top: 1px solid var(--admin-border);
  }

  .product-actions {
    grid-column: 1 / -1;
  }
}

@media (max-width: 680px) {
  .product-toolbar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .product-toolbar > :first-child,
  .toolbar-actions {
    grid-column: 1 / -1;
  }

  .toolbar-actions {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .product-list-heading > div {
    display: grid;
    gap: 3px;
  }

  .product-table {
    padding: 10px;
  }

  .product-row {
    align-items: start;
    padding: 13px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .product-identity,
  .inventory-summary,
  .product-actions {
    grid-column: 1 / -1;
  }

  .product-row > [data-label]::before {
    display: block;
    margin-bottom: 3px;
    color: var(--admin-muted);
    content: attr(data-label);
    font-size: 9px;
  }

  .product-actions {
    padding-top: 7px;
    border-top: 1px solid var(--admin-border);
  }

  .product-pagination {
    justify-content: center;
  }
}

@media (max-width: 420px) {
  .toolbar-actions {
    grid-template-columns: minmax(0, 1fr);
  }

  .toolbar-actions .el-button {
    width: 100%;
  }
}

@media (max-width: 360px) {
  .product-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .product-toolbar > :first-child,
  .toolbar-actions {
    grid-column: auto;
  }
}
</style>
