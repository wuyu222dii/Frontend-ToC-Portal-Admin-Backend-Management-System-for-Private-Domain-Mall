<script setup lang="ts">
import { Document, Refresh, Search, View } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import { listAdminOrders } from '../../services/admin-orders';
import { authSession } from '../../stores/auth-session';
import type { AdminOrderListItem, AdminOrderListQuery } from '../../types/orders';
import { formatChinaDateTime } from '../../utils/time';

const route = useRoute();
const router = useRouter();
const items = ref<AdminOrderListItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const orderNo = ref('');
const orderStatus = ref<AdminOrderListItem['order_status'] | ''>('');
const paymentStatus = ref<AdminOrderListItem['payment_status'] | ''>('');
const fulfillmentStatus = ref<AdminOrderListItem['fulfillment_status'] | ''>('');
const refundStatus = ref<AdminOrderListItem['refund_processing_status'] | ''>('');
const customerId = ref('');
const agentId = ref('');
const amountRange = ref<[string, string]>(['', '']);
const dateRange = ref<[string, string] | null>(null);
const sort = ref<NonNullable<AdminOrderListQuery['sort']>>('CREATED_DESC');
const expandedFilters = ref(false);
function routeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const lockedAgentId = computed(() => routeText(route.query.agent_id));
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
let sequence = 0;
let controller: AbortController | null = null;

const orderStatusOptions = [
  { label: '待付款', value: 'PENDING_PAYMENT' },
  { label: '待发货', value: 'PENDING_SHIPMENT' },
  { label: '运输中', value: 'SHIPPING' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已关闭', value: 'CLOSED' },
] as const;
const paymentStatusOptions = [
  { label: '未支付', value: 'UNPAID' },
  { label: '处理中', value: 'PROCESSING' },
  { label: '已支付', value: 'PAID' },
] as const;
const fulfillmentStatusOptions = [
  { label: '未开始', value: 'NOT_STARTED' },
  { label: '待发货', value: 'READY_TO_SHIP' },
  { label: '已发货', value: 'SHIPPED' },
  { label: '运输中', value: 'IN_TRANSIT' },
  { label: '已送达', value: 'DELIVERED' },
  { label: '已取消', value: 'CANCELLED' },
] as const;

const linkedOrderStatus = computed<AdminOrderListItem['order_status'] | ''>(() => {
  const value = routeText(route.query.order_status);
  return orderStatusOptions.some((option) => option.value === value)
    ? value as AdminOrderListItem['order_status']
    : '';
});
const linkedFulfillmentStatus = computed<AdminOrderListItem['fulfillment_status'] | ''>(() => {
  const value = routeText(route.query.fulfillment_status);
  return fulfillmentStatusOptions.some((option) => option.value === value)
    ? value as AdminOrderListItem['fulfillment_status']
    : '';
});

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '订单列表加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问订单中心';
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '查询过于频繁，请稍后重试';
  }
  return '订单列表加载失败，请稍后重试';
}

async function handleSessionError(error: unknown): Promise<boolean> {
  if (authSession.state.session && (!(error instanceof AdminApiError) || error.status !== 401)) return false;
  ++sequence;
  controller?.abort();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

function query(): AdminOrderListQuery {
  const value: AdminOrderListQuery = { page: page.value, pageSize, sort: sort.value };
  if (orderNo.value.trim()) value.orderNo = orderNo.value.trim();
  if (orderStatus.value) value.orderStatus = orderStatus.value;
  if (paymentStatus.value) value.paymentStatus = paymentStatus.value;
  if (fulfillmentStatus.value) value.fulfillmentStatus = fulfillmentStatus.value;
  if (refundStatus.value) value.refundProcessingStatus = refundStatus.value;
  if (customerId.value.trim()) value.customerId = customerId.value.trim();
  const effectiveAgentId = lockedAgentId.value || agentId.value.trim();
  if (effectiveAgentId) value.agentId = effectiveAgentId;
  if (dateRange.value) [value.dateFrom, value.dateTo] = dateRange.value;
  if (amountRange.value[0].trim()) value.minAmount = amountRange.value[0].trim();
  if (amountRange.value[1].trim()) value.maxAmount = amountRange.value[1].trim();
  return value;
}

async function loadOrders(): Promise<void> {
  const currentSequence = ++sequence;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listAdminOrders(query(), current.signal);
    if (currentSequence !== sequence) return;
    items.value = result.items;
    page.value = result.pagination.page;
    total.value = result.pagination.total;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleSessionError(error)) return;
    items.value = [];
    total.value = 0;
    errorMessage.value = readableError(error);
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function applyFilters(): void {
  page.value = 1;
  void loadOrders();
}

function resetFilters(): void {
  orderNo.value = '';
  orderStatus.value = '';
  paymentStatus.value = '';
  fulfillmentStatus.value = '';
  refundStatus.value = '';
  customerId.value = '';
  agentId.value = lockedAgentId.value;
  amountRange.value = ['', ''];
  dateRange.value = null;
  sort.value = 'CREATED_DESC';
  page.value = 1;
  void loadOrders();
}

function changePage(value: number): void {
  page.value = value;
  void loadOrders();
}

function statusClass(item: AdminOrderListItem): string {
  if (item.order_status === 'COMPLETED') return 'success';
  if (item.order_status === 'CLOSED' || item.refund_processing_status === 'FAILED') return 'danger';
  if (item.order_status === 'SHIPPING') return 'info';
  return 'pending';
}

watch([lockedAgentId, linkedOrderStatus, linkedFulfillmentStatus], ([linkedAgentId, linkedOrder, linkedFulfillment]) => {
  agentId.value = linkedAgentId;
  orderStatus.value = linkedOrder;
  fulfillmentStatus.value = linkedFulfillment;
  page.value = 1;
  void loadOrders();
}, { immediate: true });
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
});
</script>

<template>
  <AdminShell>
    <div
      class="orders-page"
      data-testid="admin-orders-page"
    >
      <section class="page-heading">
        <div>
          <p>订单履约 · ADM-09</p>
          <h1>订单中心</h1>
          <span>查询订单经营投影，并进入受控履约处理。</span>
        </div>
      </section>

      <el-alert
        v-if="lockedAgentId"
        data-testid="order-agent-lock"
        type="info"
        :closable="false"
        show-icon
        :title="`已锁定代理 ${lockedAgentId}`"
      />

      <section
        class="orders-filters"
        data-testid="admin-orders-filters"
        aria-label="订单筛选"
      >
        <el-input
          v-model="orderNo"
          clearable
          data-testid="order-no-filter"
          placeholder="订单号"
          @keyup.enter="applyFilters"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select
          v-model="orderStatus"
          clearable
          data-testid="order-status-filter"
          placeholder="全部订单状态"
        >
          <el-option
            v-for="option in orderStatusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-select
          v-model="paymentStatus"
          clearable
          data-testid="order-payment-filter"
          placeholder="全部支付状态"
        >
          <el-option
            v-for="option in paymentStatusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-select
          v-model="fulfillmentStatus"
          clearable
          data-testid="order-fulfillment-filter"
          placeholder="全部履约状态"
        >
          <el-option
            v-for="option in fulfillmentStatusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-button
          data-testid="order-more-filters"
          @click="expandedFilters = !expandedFilters"
        >
          {{ expandedFilters ? '收起筛选' : '更多筛选' }}
        </el-button>
        <div class="filter-actions">
          <el-button
            type="primary"
            data-testid="order-apply-filters"
            @click="applyFilters"
          >
            <el-icon><Search /></el-icon>查询
          </el-button>
          <el-button
            data-testid="order-reset-filters"
            @click="resetFilters"
          >
            <el-icon><Refresh /></el-icon>重置
          </el-button>
        </div>

        <div
          v-if="expandedFilters"
          class="expanded-filters"
          data-testid="order-expanded-filters"
        >
          <el-input
            v-model="customerId"
            clearable
            data-testid="order-customer-filter"
            placeholder="客户 ULID"
          />
          <el-input
            v-model="agentId"
            :clearable="!lockedAgentId"
            :disabled="Boolean(lockedAgentId)"
            data-testid="order-agent-filter"
            placeholder="最终代理 ULID"
          />
          <el-date-picker
            v-model="dateRange"
            data-testid="order-date-filter"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="创建开始日"
            end-placeholder="创建结束日"
          />
          <div class="amount-range">
            <el-input
              v-model="amountRange[0]"
              data-testid="order-min-amount-filter"
              placeholder="最低金额 0.00"
            />
            <span>至</span>
            <el-input
              v-model="amountRange[1]"
              data-testid="order-max-amount-filter"
              placeholder="最高金额 0.00"
            />
          </div>
          <el-select
            v-model="refundStatus"
            clearable
            data-testid="order-refund-filter"
            placeholder="全部退款处理状态"
          >
            <el-option
              label="空闲"
              value="IDLE"
            />
            <el-option
              label="退款中"
              value="REFUNDING"
            />
            <el-option
              label="退款失败"
              value="FAILED"
            />
          </el-select>
          <el-select
            v-model="sort"
            data-testid="order-sort-filter"
            placeholder="排序"
          >
            <el-option
              label="按创建时间"
              value="CREATED_DESC"
            />
            <el-option
              label="按支付时间"
              value="PAID_DESC"
            />
            <el-option
              label="按金额"
              value="AMOUNT_DESC"
            />
          </el-select>
        </div>
      </section>

      <section
        class="orders-list"
        data-testid="admin-orders-list"
      >
        <header class="orders-list-heading">
          <div>
            <strong>订单记录</strong>
            <span>共 {{ total }} 条</span>
          </div>
          <el-button
            text
            :loading="loading"
            aria-label="刷新订单"
            @click="loadOrders"
          >
            <el-icon><Refresh /></el-icon>
          </el-button>
        </header>

        <div
          v-if="loading"
          class="orders-state"
          data-testid="admin-orders-loading"
        >
          <el-skeleton
            :rows="7"
            animated
          />
        </div>
        <div
          v-else-if="errorMessage"
          class="orders-state centered"
          data-testid="admin-orders-error"
        >
          <el-icon><Document /></el-icon>
          <strong>{{ errorMessage }}</strong>
          <el-button
            type="primary"
            @click="loadOrders"
          >
            重新加载
          </el-button>
        </div>
        <div
          v-else-if="items.length === 0"
          class="orders-state centered"
          data-testid="admin-orders-empty"
        >
          <el-icon><Document /></el-icon>
          <strong>没有符合条件的订单</strong>
          <span>调整筛选条件后重新查询。</span>
        </div>
        <div
          v-else
          class="orders-table"
        >
          <div
            class="orders-table-header"
            aria-hidden="true"
          >
            <span>订单</span><span>客户 / 代理</span><span>金额</span><span>状态</span><span>履约</span><span>创建时间</span><span>操作</span>
          </div>
          <article
            v-for="item in items"
            :key="item.order_id"
            class="order-row"
            :data-testid="`admin-order-row-${item.order_id}`"
          >
            <div
              class="order-identity"
              data-label="订单"
            >
              <strong>{{ item.order_no }}</strong>
              <small>{{ item.order_id }}</small>
            </div>
            <div data-label="客户 / 代理">
              <strong>{{ item.customer_alias }}</strong>
              <small>{{ item.agent_name || '直营订单' }}</small>
            </div>
            <div data-label="金额">
              <strong>¥{{ item.payable_amount }}</strong>
            </div>
            <div data-label="状态">
              <span
                class="status-badge"
                :class="statusClass(item)"
              >{{ item.display_status }}</span>
              <small>{{ item.payment_status }} · {{ item.refund_progress_status }}</small>
            </div>
            <div data-label="履约">
              <strong>{{ item.fulfillment_status }}</strong>
            </div>
            <div data-label="创建时间">
              <span>{{ formatChinaDateTime(item.created_at) }}</span>
            </div>
            <div
              class="order-row-actions"
              data-label="操作"
            >
              <el-button
                type="primary"
                plain
                :data-testid="`admin-order-open-${item.order_id}`"
                @click="router.push(`/orders/${item.order_id}`)"
              >
                <el-icon><View /></el-icon>查看
              </el-button>
            </div>
          </article>
        </div>

        <footer
          v-if="total > pageSize && !errorMessage"
          class="orders-pagination"
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
  </AdminShell>
</template>

<style scoped>
.orders-page {
  min-width: 0;
}

.orders-filters {
  display: grid;
  align-items: center;
  gap: 10px;
  padding: 14px 0;
  border-top: 1px solid var(--admin-border);
  grid-template-columns: minmax(180px, 1.2fr) repeat(3, minmax(145px, 0.8fr)) auto auto;
}

.filter-actions,
.amount-range {
  display: flex;
  align-items: center;
  gap: 8px;
}

.expanded-filters {
  display: grid;
  gap: 10px;
  grid-column: 1 / -1;
  grid-template-columns: repeat(2, minmax(160px, 1fr)) minmax(260px, 1.4fr) minmax(270px, 1.4fr) minmax(150px, 0.8fr) minmax(150px, 0.8fr);
}

.expanded-filters :deep(.el-date-editor) {
  width: 100%;
}

.orders-list {
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 7px;
  background: #fff;
}

.orders-list-heading,
.orders-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 13px 16px;
}

.orders-list-heading {
  border-bottom: 1px solid var(--admin-border);
}

.orders-list-heading > div {
  display: grid;
  gap: 2px;
}

.orders-list-heading span,
.orders-pagination,
.order-row small,
.order-row span {
  color: var(--admin-muted);
  font-size: 11px;
}

.orders-state {
  display: grid;
  min-height: 300px;
  align-content: center;
  gap: 14px;
  padding: 24px;
}

.orders-state.centered {
  justify-items: center;
  color: var(--admin-text-soft);
  text-align: center;
}

.orders-state.centered > .el-icon {
  color: var(--admin-muted);
  font-size: 34px;
}

.orders-table-header,
.order-row {
  display: grid;
  align-items: center;
  gap: 12px;
  grid-template-columns: minmax(210px, 1.5fr) minmax(140px, 1fr) 90px minmax(125px, 0.9fr) minmax(105px, 0.8fr) minmax(130px, 0.9fr) 92px;
}

.orders-table-header {
  padding: 10px 16px;
  color: var(--admin-muted);
  background: #f7faf8;
  font-size: 11px;
  font-weight: 700;
}

.order-row {
  padding: 13px 16px;
  border-top: 1px solid var(--admin-border);
}

.order-row > div {
  display: grid;
  min-width: 0;
  gap: 3px;
}

.order-row strong,
.order-row span,
.order-row small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.order-identity small {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.status-badge {
  display: inline-flex;
  width: fit-content;
  padding: 3px 7px;
  border-radius: 4px;
  color: var(--admin-text-soft) !important;
  background: #edf1ef;
  font-weight: 700;
}

.status-badge.success { color: #27654f !important; background: #e5f3ed; }
.status-badge.danger { color: #8c4141 !important; background: #f5eaea; }
.status-badge.info { color: #315f91 !important; background: #eaf2fa; }
.status-badge.pending { color: #8b651e !important; background: #fbf1df; }

.order-row-actions {
  display: flex !important;
}

.orders-pagination {
  border-top: 1px solid var(--admin-border);
}

@media (max-width: 1180px) {
  .orders-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .filter-actions {
    justify-content: flex-end;
  }

  .expanded-filters {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .orders-list {
    overflow: visible;
    border: 0;
    background: transparent;
  }

  .orders-table-header {
    display: none;
  }

  .orders-table {
    display: grid;
    gap: 10px;
  }

  .order-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    border: 1px solid var(--admin-border);
    border-radius: 7px;
    background: #fff;
  }

  .order-identity,
  .order-row-actions {
    grid-column: 1 / -1;
  }

  .order-row [data-label]::before {
    color: var(--admin-muted);
    content: attr(data-label);
    font-size: 10px;
    font-weight: 700;
  }
}

@media (max-width: 620px) {
  .orders-filters,
  .expanded-filters,
  .order-row {
    grid-template-columns: 1fr;
  }

  .filter-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .amount-range {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
  }

  .order-identity,
  .order-row-actions {
    grid-column: auto;
  }

  .orders-list-heading,
  .orders-pagination {
    padding-right: 0;
    padding-left: 0;
  }

  .orders-pagination {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
