<script setup lang="ts">
import { Box, Refresh, Search, View } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import InventoryAdjustmentDialog from '../../components/inventory/InventoryAdjustmentDialog.vue';
import InventoryLedgerDialog from '../../components/inventory/InventoryLedgerDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import { listAdminInventory } from '../../services/admin-inventory';
import { listActiveCatalogOptions } from '../../services/admin-products';
import { authSession } from '../../stores/auth-session';
import type { InventoryItem, InventoryListQuery } from '../../types/inventory';
import type { CategoryReference } from '../../types/products';

const router = useRouter();
const items = ref<InventoryItem[]>([]);
const categories = ref<CategoryReference[]>([]);
const loading = ref(false);
const listError = ref('');
const optionsError = ref('');
const keyword = ref('');
const categoryId = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const adjustmentOpen = ref(false);
const adjustmentItem = ref<InventoryItem | null>(null);
const ledgerOpen = ref(false);
const ledgerItem = ref<InventoryItem | null>(null);
let listSequence = 0;
let listController: AbortController | null = null;
let optionsController: AbortController | null = null;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function statusLabel(status: InventoryItem['sku_status']): string {
  return ({ ACTIVE: '已启用', ARCHIVED: '已归档', INACTIVE: '已停用' })[status];
}

function readableError(error: unknown, fallback: string): string {
  if (!(error instanceof AdminApiError)) return fallback;
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问库存中心';
  if (error.status === 429) return '查询过于频繁，请稍后重试';
  return fallback;
}

function closeDialogs(): void {
  adjustmentOpen.value = false;
  adjustmentItem.value = null;
  ledgerOpen.value = false;
  ledgerItem.value = null;
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  ++listSequence;
  listController?.abort();
  optionsController?.abort();
  items.value = [];
  total.value = 0;
  closeDialogs();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function loadCategories(): Promise<void> {
  optionsController?.abort();
  const controller = new AbortController();
  optionsController = controller;
  optionsError.value = '';
  try {
    const result = await listActiveCatalogOptions(controller.signal);
    if (controller !== optionsController) return;
    categories.value = result.categories;
  } catch (error) {
    if (isAbort(error) || controller !== optionsController) return;
    if (await handleSessionError(error)) return;
    optionsError.value = readableError(error, '分类选项加载失败，仍可使用关键词查询库存');
  } finally {
    if (controller === optionsController) optionsController = null;
  }
}

async function loadInventory(): Promise<void> {
  const sequence = ++listSequence;
  listController?.abort();
  const controller = new AbortController();
  listController = controller;
  loading.value = true;
  listError.value = '';
  try {
    const query: InventoryListQuery = { page: page.value, pageSize };
    const trimmedKeyword = keyword.value.trim();
    if (trimmedKeyword) query.keyword = trimmedKeyword;
    if (categoryId.value) query.categoryId = categoryId.value;
    const result = await listAdminInventory(query, controller.signal);
    if (sequence !== listSequence) return;
    items.value = result.items;
    total.value = result.pagination.total;
    page.value = result.pagination.page;
  } catch (error) {
    if (isAbort(error) || sequence !== listSequence) return;
    if (await handleSessionError(error)) return;
    items.value = [];
    total.value = 0;
    listError.value = readableError(error, '库存列表加载失败，请稍后重试');
  } finally {
    if (sequence === listSequence) loading.value = false;
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadInventory();
}

function resetFilters(): void {
  keyword.value = '';
  categoryId.value = '';
  page.value = 1;
  void loadInventory();
}

function changePage(value: number): void {
  page.value = value;
  void loadInventory();
}

function openAdjustment(item: InventoryItem): void {
  if (item.sku_status === 'ARCHIVED') return;
  ledgerOpen.value = false;
  ledgerItem.value = null;
  adjustmentItem.value = item;
  adjustmentOpen.value = true;
}

function openLedger(item: InventoryItem): void {
  adjustmentOpen.value = false;
  adjustmentItem.value = null;
  ledgerItem.value = item;
  ledgerOpen.value = true;
}

async function adjustmentCompleted(): Promise<void> {
  adjustmentOpen.value = false;
  adjustmentItem.value = null;
  ElMessage.success('库存已调整，余额版本与流水已更新');
  await loadInventory();
}

async function adjustmentConflict(): Promise<void> {
  adjustmentOpen.value = false;
  adjustmentItem.value = null;
  await loadInventory();
  ElMessage.warning('SKU 状态或余额版本已变化，已刷新最新库存，请重新预览后确认');
}

async function authExpired(error: AdminApiError): Promise<void> {
  await handleSessionError(error);
}

onMounted(() => {
  void loadCategories();
  void loadInventory();
});

onBeforeUnmount(() => {
  ++listSequence;
  listController?.abort();
  optionsController?.abort();
  closeDialogs();
});
</script>

<template>
  <AdminShell>
    <div
      class="inventory-page"
      data-testid="inventory-page"
    >
      <section class="page-heading">
        <div>
          <p>商品中心 · ADM-08</p>
          <h1>库存中心</h1>
          <span>按 SKU 查看实物、锁定、活动预占、可售与只追加库存流水。</span>
        </div>
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
        class="inventory-toolbar"
        aria-label="库存筛选"
      >
        <el-input
          v-model="keyword"
          clearable
          data-testid="inventory-search"
          aria-label="库存关键词"
          placeholder="商品名称、SKU 名称或编码"
          @keyup.enter="applyFilters"
          @clear="applyFilters"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select
          v-model="categoryId"
          clearable
          filterable
          data-testid="inventory-category-filter"
          aria-label="库存分类筛选"
          placeholder="全部有效分类"
        >
          <el-option
            v-for="category in categories"
            :key="category.category_id"
            :label="category.name"
            :value="category.category_id"
          />
        </el-select>
        <div class="toolbar-actions">
          <el-button
            type="primary"
            data-testid="inventory-apply-filters"
            @click="applyFilters"
          >
            <el-icon><Search /></el-icon>
            查询库存
          </el-button>
          <el-button
            data-testid="inventory-reset-filters"
            @click="resetFilters"
          >
            <el-icon><Refresh /></el-icon>
            重置筛选
          </el-button>
        </div>
      </section>

      <el-alert
        class="formula-note"
        title="可售库存 = 实物库存 - 锁定库存"
        description="活动预占仅用于复核锁定事实，不会从可售库存中再次扣减。归档 SKU 仍可查看余额与流水，但不能人工调整。"
        type="info"
        :closable="false"
        show-icon
      />

      <section
        class="inventory-list"
        :class="{ refreshing: loading && items.length }"
      >
        <header class="inventory-list-heading">
          <div>
            <strong>共 {{ total }} 个 SKU</strong>
            <span>当前第 {{ page }} 页，每页 {{ pageSize }} 条</span>
          </div>
          <el-button
            :icon="Refresh"
            :loading="loading"
            @click="loadInventory"
          >
            重新加载
          </el-button>
        </header>

        <div
          v-if="loading && !items.length"
          class="inventory-state"
          data-testid="inventory-loading"
        >
          <el-skeleton
            :rows="6"
            animated
          />
        </div>
        <div
          v-else-if="listError"
          class="inventory-state"
          data-testid="inventory-error"
        >
          <el-alert
            :title="listError"
            type="error"
            :closable="false"
            show-icon
          />
          <el-button @click="loadInventory">
            重新加载
          </el-button>
        </div>
        <div
          v-else-if="!items.length"
          class="inventory-state empty"
          data-testid="inventory-empty"
        >
          <el-icon><Box /></el-icon>
          <strong>没有符合条件的库存记录</strong>
          <span>调整商品或 SKU 关键词、分类条件后再试。</span>
          <el-button @click="resetFilters">
            清除筛选
          </el-button>
        </div>
        <div
          v-else
          v-loading="loading"
          class="inventory-table"
          role="table"
          aria-label="SKU 库存列表"
          data-testid="inventory-table"
        >
          <div
            class="inventory-table-header"
            role="row"
          >
            <span role="columnheader">商品 / SKU</span>
            <span role="columnheader">状态</span>
            <span role="columnheader">实物</span>
            <span role="columnheader">锁定</span>
            <span role="columnheader">活动预占</span>
            <span role="columnheader">可售</span>
            <span role="columnheader">版本</span>
            <span role="columnheader">操作</span>
          </div>
          <article
            v-for="item in items"
            :key="item.sku_id"
            class="inventory-row"
            :class="{ archived: item.sku_status === 'ARCHIVED' }"
            role="row"
            :data-testid="`inventory-row-${item.sku_id}`"
          >
            <div
              class="inventory-identity"
              role="cell"
            >
              <span
                class="sku-mark"
                aria-hidden="true"
              >SKU</span>
              <div>
                <strong :title="item.product_name">{{ item.product_name }}</strong>
                <span>{{ item.sku_name }}</span>
                <small>{{ item.sku_code }}</small>
              </div>
            </div>
            <div
              role="cell"
              data-label="状态"
            >
              <span
                class="status-badge"
                :class="`is-${item.sku_status.toLowerCase()}`"
              >
                {{ statusLabel(item.sku_status) }}
              </span>
              <small v-if="item.sku_status === 'ARCHIVED'">只读</small>
            </div>
            <div
              class="quantity-cell"
              role="cell"
              data-label="实物"
            >
              <strong>{{ item.physical_qty }}</strong>
            </div>
            <div
              class="quantity-cell"
              role="cell"
              data-label="锁定"
            >
              <strong>{{ item.locked_qty }}</strong>
            </div>
            <div
              class="quantity-cell"
              role="cell"
              data-label="活动预占"
            >
              <strong>{{ item.active_reservation_qty }}</strong>
              <small>仅复核</small>
            </div>
            <div
              class="quantity-cell available"
              role="cell"
              data-label="可售"
            >
              <strong>{{ item.available_qty }}</strong>
              <small>{{ item.physical_qty }} - {{ item.locked_qty }}</small>
            </div>
            <div
              class="version-cell"
              role="cell"
              data-label="版本"
            >
              v{{ item.version }}
            </div>
            <div
              class="inventory-actions"
              role="cell"
            >
              <el-button
                v-if="item.sku_status !== 'ARCHIVED'"
                link
                type="primary"
                :data-testid="`inventory-adjust-${item.sku_id}`"
                @click="openAdjustment(item)"
              >
                调整
              </el-button>
              <el-button
                link
                type="primary"
                :data-testid="`inventory-ledger-${item.sku_id}`"
                @click="openLedger(item)"
              >
                <el-icon><View /></el-icon>
                查看流水
              </el-button>
            </div>
          </article>
        </div>

        <footer
          v-if="total > pageSize && !listError"
          class="inventory-pagination"
        >
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <el-pagination
            background
            layout="prev, pager, next"
            :current-page="page"
            :page-size="pageSize"
            :total="total"
            @current-change="changePage"
          />
        </footer>
      </section>
    </div>

    <InventoryAdjustmentDialog
      v-model:open="adjustmentOpen"
      :item="adjustmentItem"
      @completed="adjustmentCompleted"
      @conflict="adjustmentConflict"
      @auth-expired="authExpired"
    />
    <InventoryLedgerDialog
      v-model:open="ledgerOpen"
      :item="ledgerItem"
      @auth-expired="authExpired"
    />
  </AdminShell>
</template>

<style scoped>
.inventory-page {
  min-width: 0;
}

.options-alert,
.formula-note {
  margin-bottom: 14px;
}

.inventory-toolbar {
  display: grid;
  align-items: center;
  gap: 10px;
  padding: 14px 0;
  border-top: 1px solid var(--admin-border);
  grid-template-columns: minmax(220px, 1fr) minmax(180px, 260px) auto;
}

.toolbar-actions {
  display: flex;
  gap: 8px;
}

.inventory-list {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
}

.inventory-list.refreshing {
  opacity: 0.82;
}

.inventory-list-heading,
.inventory-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
}

.inventory-list-heading {
  border-bottom: 1px solid var(--admin-border);
}

.inventory-list-heading > div {
  display: grid;
  gap: 2px;
}

.inventory-list-heading span,
.inventory-pagination,
.inventory-identity span,
.inventory-identity small,
.quantity-cell small,
.inventory-row [data-label="状态"] small {
  color: var(--admin-muted);
  font-size: 12px;
}

.inventory-state {
  display: grid;
  min-height: 300px;
  align-content: center;
  gap: 14px;
  padding: 24px;
}

.inventory-state.empty {
  justify-items: center;
  color: var(--admin-text-soft);
  text-align: center;
}

.inventory-state.empty > .el-icon {
  color: var(--admin-muted);
  font-size: 34px;
}

.inventory-table {
  min-width: 0;
}

.inventory-table-header,
.inventory-row {
  display: grid;
  align-items: center;
  gap: 12px;
  grid-template-columns: minmax(230px, 2fr) 84px repeat(4, minmax(64px, 0.55fr)) 60px minmax(140px, auto);
}

.inventory-table-header {
  padding: 10px 16px;
  color: var(--admin-muted);
  background: #f7faf8;
  font-size: 11px;
  font-weight: 700;
}

.inventory-row {
  min-width: 0;
  padding: 13px 16px;
  border-top: 1px solid var(--admin-border);
}

.inventory-row.archived {
  background: #fafbfa;
}

.inventory-identity {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 10px;
}

.inventory-identity > div {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.inventory-identity strong,
.inventory-identity span,
.inventory-identity small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sku-mark {
  display: grid;
  width: 42px;
  height: 42px;
  flex: 0 0 42px;
  border: 1px solid #bfd2c9;
  border-radius: 6px;
  color: var(--admin-brand);
  background: #eff6f2;
  font-size: 10px;
  font-weight: 700;
  place-items: center;
}

.inventory-row [data-label="状态"],
.quantity-cell {
  display: grid;
  min-width: 0;
  gap: 2px;
}

.status-badge {
  display: inline-flex;
  width: fit-content;
  align-items: center;
  padding: 3px 7px;
  border-radius: 4px;
  color: var(--admin-text-soft);
  background: #edf1ef;
  font-size: 11px;
  font-weight: 700;
}

.status-badge.is-active {
  color: #27654f;
  background: #e5f3ed;
}

.status-badge.is-archived {
  color: #7b4545;
  background: #f5eaea;
}

.quantity-cell strong {
  overflow-wrap: normal;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.quantity-cell.available strong {
  color: var(--admin-brand);
}

.version-cell {
  color: var(--admin-text-soft);
  font-size: 12px;
}

.inventory-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 2px;
}

.inventory-pagination {
  border-top: 1px solid var(--admin-border);
}

@media (max-width: 1180px) {
  .inventory-toolbar {
    grid-template-columns: 1fr 1fr;
  }

  .toolbar-actions {
    grid-column: 1 / -1;
  }

  .inventory-list {
    overflow: visible;
    border: 0;
    border-radius: 0;
    background: transparent;
  }

  .inventory-list-heading,
  .inventory-pagination {
    padding-right: 0;
    padding-left: 0;
  }

  .inventory-list-heading {
    border-bottom: 0;
  }

  .inventory-table-header {
    display: none;
  }

  .inventory-table {
    display: grid;
    gap: 10px;
    padding: 0;
    background: transparent;
  }

  .inventory-row {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 12px;
    padding: 14px;
    border: 1px solid var(--admin-border);
    border-radius: 7px;
    background: #fff;
  }

  .inventory-identity,
  .inventory-actions {
    grid-column: 1 / -1;
  }

  .inventory-row [data-label]::before {
    color: var(--admin-muted);
    content: attr(data-label);
    font-size: 10px;
    font-weight: 700;
  }

  .inventory-actions {
    align-items: center;
    flex-direction: row;
  }

  .version-cell {
    display: grid;
    gap: 2px;
  }

  .inventory-pagination {
    border-top: 0;
  }
}

@media (max-width: 560px) {
  .inventory-toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-actions {
    display: grid;
    grid-column: auto;
    grid-template-columns: 1fr 1fr;
  }

  .inventory-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .inventory-list-heading,
  .inventory-pagination {
    align-items: flex-start;
    flex-direction: column;
  }

  .inventory-pagination :deep(.el-pagination) {
    max-width: 100%;
    overflow-x: auto;
  }
}
</style>
