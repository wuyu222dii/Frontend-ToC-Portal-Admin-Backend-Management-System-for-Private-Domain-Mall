<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { AdminApiError } from '../../services/admin-api';
import { listAdminInventoryLedger } from '../../services/admin-inventory';
import type {
  InventoryItem,
  InventoryLedgerItem,
  InventoryLedgerQuery,
  InventoryLedgerType,
} from '../../types/inventory';
import { formatChinaDateTime } from '../../utils/time';

const props = defineProps<{
  item: InventoryItem | null;
  open: boolean;
}>();

const emit = defineEmits<{
  authExpired: [error: AdminApiError];
  'update:open': [value: boolean];
}>();

const items = ref<InventoryLedgerItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const ledgerType = ref<'' | InventoryLedgerType>('');
const dateFrom = ref('');
const dateTo = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
let requestSequence = 0;
let requestController: AbortController | null = null;

const dialogOpen = computed({
  get: () => props.open,
  set: (value: boolean) => emit('update:open', value),
});

const ledgerOptions: Array<{ label: string; value: '' | InventoryLedgerType }> = [
  { label: '全部流水类型', value: '' },
  { label: '初始导入', value: 'INITIAL' },
  { label: '人工增加', value: 'MANUAL_INCREASE' },
  { label: '人工减少', value: 'MANUAL_DECREASE' },
  { label: '支付扣减', value: 'ORDER_PAID_DEDUCT' },
  { label: '订单预占', value: 'ORDER_RESERVE' },
  { label: '订单释放', value: 'ORDER_RELEASE' },
  { label: '退款回库', value: 'REFUND_RESTOCK' },
  { label: '退货回库', value: 'RETURN_RESTOCK' },
  { label: '退货损坏', value: 'RETURN_DAMAGED' },
  { label: '库存补偿', value: 'COMPENSATION' },
];

function ledgerTypeLabel(value: InventoryLedgerType): string {
  return ledgerOptions.find((option) => option.value === value)?.label ?? value;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '库存流水加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权查看库存流水';
  if (error.status === 404) return 'SKU 不存在或已不可用，请刷新库存列表';
  if (error.status === 429) return '查询过于频繁，请稍后重试';
  return '库存流水加载失败，请稍后重试';
}

function validDateRange(): boolean {
  if (!dateFrom.value || !dateTo.value || dateFrom.value <= dateTo.value) return true;
  errorMessage.value = '开始日期不能晚于结束日期。日期按上海自然日计算。';
  return false;
}

async function loadLedger(): Promise<void> {
  const item = props.item;
  if (!item || !validDateRange()) return;
  const sequence = ++requestSequence;
  requestController?.abort();
  const controller = new AbortController();
  requestController = controller;
  loading.value = true;
  errorMessage.value = '';
  try {
    const query: InventoryLedgerQuery = { page: page.value, pageSize };
    if (ledgerType.value) query.ledgerType = ledgerType.value;
    if (dateFrom.value) query.dateFrom = dateFrom.value;
    if (dateTo.value) query.dateTo = dateTo.value;
    const result = await listAdminInventoryLedger(item.sku_id, query, controller.signal);
    if (sequence !== requestSequence) return;
    items.value = result.items;
    total.value = result.pagination.total;
    page.value = result.pagination.page;
  } catch (error) {
    if (isAbort(error) || sequence !== requestSequence) return;
    if (error instanceof AdminApiError && error.status === 401) {
      emit('update:open', false);
      emit('authExpired', error);
      return;
    }
    items.value = [];
    total.value = 0;
    errorMessage.value = readableError(error);
  } finally {
    if (sequence === requestSequence) loading.value = false;
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadLedger();
}

function resetFilters(): void {
  ledgerType.value = '';
  dateFrom.value = '';
  dateTo.value = '';
  page.value = 1;
  void loadLedger();
}

function changePage(value: number): void {
  page.value = value;
  void loadLedger();
}

function clearState(): void {
  ++requestSequence;
  requestController?.abort();
  requestController = null;
  items.value = [];
  loading.value = false;
  errorMessage.value = '';
  ledgerType.value = '';
  dateFrom.value = '';
  dateTo.value = '';
  page.value = 1;
  total.value = 0;
}

watch(
  [() => props.open, () => props.item?.sku_id],
  ([open]) => {
    clearState();
    if (open) void loadLedger();
  },
);

onBeforeUnmount(clearState);
</script>

<template>
  <el-dialog
    v-model="dialogOpen"
    data-testid="inventory-ledger-dialog"
    width="min(820px, calc(100vw - 28px))"
    destroy-on-close
    @closed="clearState"
  >
    <template #header>
      <div class="dialog-heading">
        <strong>SKU 库存流水</strong>
        <p v-if="item">
          {{ item.product_name }} · {{ item.sku_name }} · {{ item.sku_code }}
        </p>
      </div>
    </template>

    <div class="ledger-dialog">
      <section
        class="ledger-toolbar"
        aria-label="库存流水筛选"
      >
        <el-select
          v-model="ledgerType"
          data-testid="inventory-ledger-type"
          aria-label="库存流水类型"
          placeholder="全部流水类型"
        >
          <el-option
            v-for="option in ledgerOptions"
            :key="option.value || 'ALL'"
            v-bind="option"
          />
        </el-select>
        <el-date-picker
          v-model="dateFrom"
          data-testid="inventory-ledger-date-from"
          type="date"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          placeholder="开始日期"
          aria-label="库存流水开始日期"
        />
        <el-date-picker
          v-model="dateTo"
          data-testid="inventory-ledger-date-to"
          type="date"
          value-format="YYYY-MM-DD"
          format="YYYY-MM-DD"
          placeholder="结束日期（含当日）"
          aria-label="库存流水结束日期"
        />
        <div>
          <el-button
            type="primary"
            @click="applyFilters"
          >
            查询
          </el-button>
          <el-button @click="resetFilters">
            重置
          </el-button>
        </div>
      </section>
      <small class="timezone-note">日期按 Asia/Shanghai 自然日筛选，结束日期包含当日。</small>

      <div
        v-if="loading && !items.length"
        class="ledger-state"
        data-testid="inventory-ledger-loading"
      >
        <el-skeleton
          :rows="5"
          animated
        />
      </div>
      <div
        v-else-if="errorMessage"
        class="ledger-state"
        data-testid="inventory-ledger-error"
      >
        <el-alert
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
        />
        <el-button @click="loadLedger">
          重新加载
        </el-button>
      </div>
      <div
        v-else-if="!items.length"
        class="ledger-state empty"
        data-testid="inventory-ledger-empty"
      >
        <strong>暂无库存流水</strong>
        <span>零余额建立时可能暂无记录；后续库存变化会在此持续记录。</span>
      </div>
      <div
        v-else
        v-loading="loading"
        class="ledger-list"
        data-testid="inventory-ledger-list"
      >
        <article
          v-for="entry in items"
          :key="entry.ledger_id"
          class="ledger-entry"
          :data-testid="`inventory-ledger-row-${entry.ledger_id}`"
        >
          <header>
            <div>
              <strong>{{ ledgerTypeLabel(entry.ledger_type) }}</strong>
            </div>
            <time :datetime="entry.occurred_at">{{ formatChinaDateTime(entry.occurred_at) }}</time>
          </header>
          <div class="ledger-values">
            <div>
              <span>实物变化</span>
              <strong :class="{ decrease: entry.physical_change < 0 }">{{ signed(entry.physical_change) }}</strong>
              <small>{{ entry.physical_before }} → {{ entry.physical_after }}</small>
            </div>
            <div>
              <span>锁定变化</span>
              <strong :class="{ decrease: entry.locked_change < 0 }">{{ signed(entry.locked_change) }}</strong>
              <small>{{ entry.locked_before }} → {{ entry.locked_after }}</small>
            </div>
            <p>{{ entry.reason }}</p>
          </div>
          <small class="ledger-id">{{ entry.ledger_id }}</small>
        </article>
      </div>

      <footer
        v-if="total > pageSize && !errorMessage"
        class="ledger-pagination"
      >
        <span>第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 条</span>
        <el-pagination
          background
          layout="prev, pager, next"
          :current-page="page"
          :page-size="pageSize"
          :total="total"
          @current-change="changePage"
        />
      </footer>
    </div>
  </el-dialog>
</template>

<style scoped>
.dialog-heading,
.dialog-heading p {
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
.timezone-note,
.ledger-entry time,
.ledger-entry span,
.ledger-entry small,
.ledger-pagination {
  color: var(--admin-muted);
  font-size: 12px;
}

.ledger-dialog {
  display: grid;
  min-width: 0;
  gap: 12px;
}

.ledger-toolbar {
  display: grid;
  align-items: center;
  gap: 8px;
  grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) minmax(170px, 1fr) auto;
}

.ledger-toolbar :deep(.el-date-editor),
.ledger-toolbar :deep(.el-select) {
  width: 100%;
}

.ledger-toolbar > div:last-child {
  display: flex;
  gap: 6px;
}

.ledger-state {
  display: grid;
  min-height: 210px;
  align-content: center;
  gap: 12px;
}

.ledger-state.empty {
  justify-items: center;
  color: var(--admin-text-soft);
  text-align: center;
}

.ledger-list {
  display: grid;
  gap: 1px;
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: var(--admin-border);
}

.ledger-entry {
  display: grid;
  min-width: 0;
  gap: 10px;
  padding: 13px 14px;
  background: #fff;
}

.ledger-entry > header {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
}

.ledger-entry > header > div {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
}

.ledger-values {
  display: grid;
  align-items: center;
  gap: 12px;
  grid-template-columns: 110px 110px minmax(0, 1fr);
}

.ledger-values > div {
  display: grid;
  gap: 2px;
}

.ledger-values strong {
  color: var(--admin-brand);
}

.ledger-values strong.decrease {
  color: var(--admin-danger);
}

.ledger-values p {
  min-width: 0;
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--admin-text-soft);
  font-size: 13px;
}

.ledger-id {
  overflow-wrap: anywhere;
}

.ledger-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

@media (max-width: 760px) {
  .ledger-toolbar {
    grid-template-columns: 1fr 1fr;
  }

  .ledger-toolbar > :first-child,
  .ledger-toolbar > div:last-child {
    grid-column: 1 / -1;
  }

  .ledger-values {
    grid-template-columns: 1fr 1fr;
  }

  .ledger-values p {
    grid-column: 1 / -1;
  }
}

@media (max-width: 480px) {
  .ledger-toolbar,
  .ledger-values {
    grid-template-columns: 1fr;
  }

  .ledger-toolbar > :first-child,
  .ledger-toolbar > div:last-child,
  .ledger-values p {
    grid-column: auto;
  }

  .ledger-toolbar > div:last-child,
  .ledger-pagination {
    align-items: stretch;
    flex-direction: column;
  }

  .ledger-entry > header {
    flex-direction: column;
  }
}
</style>
