<script setup lang="ts">
import { Refresh, Search, View } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import {
  listAdminAftersales,
  type AdminAftersaleListItem,
  type AdminAftersaleListQuery,
} from '../../services/admin-aftersales';
import { authSession } from '../../stores/auth-session';
import { formatChinaDateTime } from '../../utils/time';

const route = useRoute();
const router = useRouter();
const items = ref<AdminAftersaleListItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const aftersaleNo = ref('');
const orderId = ref('');
const customerId = ref('');
const status = ref<AdminAftersaleListItem['status'] | ''>('');
const type = ref<AdminAftersaleListItem['type'] | ''>('');
const dateRange = ref<[string, string] | null>(null);
let sequence = 0;
let controller: AbortController | null = null;

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const statusOptions: ReadonlyArray<{ label: string; value: AdminAftersaleListItem['status'] }> = [
  { label: '待审核', value: 'PENDING_REVIEW' },
  { label: '已拒绝', value: 'REJECTED' },
  { label: '退款处理中', value: 'REFUNDING' },
  { label: '待退货', value: 'WAITING_RETURN' },
  { label: '待收货', value: 'WAITING_RECEIPT' },
  { label: '验货异常', value: 'RETURN_EXCEPTION' },
  { label: '退货退款中', value: 'REFUNDING_AFTER_RETURN' },
  { label: '验货后拒绝', value: 'REJECTED_AFTER_RETURN' },
  { label: '退款失败', value: 'REFUND_FAILED' },
  { label: '已完成', value: 'COMPLETED' },
  { label: '已取消', value: 'CANCELLED' },
];

const linkedStatus = computed<AdminAftersaleListItem['status'] | ''>(() => {
  const value = typeof route.query.status === 'string' ? route.query.status.trim() : '';
  return statusOptions.some((option) => option.value === value)
    ? value as AdminAftersaleListItem['status']
    : '';
});

function statusLabel(value: AdminAftersaleListItem['status']): string {
  return statusOptions.find((option) => option.value === value)?.label ?? value;
}

function statusTone(value: AdminAftersaleListItem['status']): 'danger' | 'info' | 'success' | 'warning' {
  if (value === 'COMPLETED') return 'success';
  if (['REJECTED', 'REJECTED_AFTER_RETURN', 'CANCELLED'].includes(value)) return 'info';
  if (['REFUND_FAILED', 'RETURN_EXCEPTION'].includes(value)) return 'danger';
  return 'warning';
}

function query(): AdminAftersaleListQuery {
  const result: AdminAftersaleListQuery = { page: page.value, pageSize };
  if (aftersaleNo.value.trim()) result.aftersaleNo = aftersaleNo.value.trim();
  if (orderId.value.trim()) result.orderId = orderId.value.trim();
  if (customerId.value.trim()) result.customerId = customerId.value.trim();
  if (status.value) result.status = status.value;
  if (type.value) result.type = type.value;
  if (dateRange.value) [result.dateFrom, result.dateTo] = dateRange.value;
  return result;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '售后列表加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问售后管理';
  if (error.status === 429) return error.retryAfterSeconds
    ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '查询过于频繁，请稍后重试';
  if (error.status === 400) return '筛选条件无效，请检查后重试';
  return '售后列表加载失败，请稍后重试';
}

async function redirectIfExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  controller?.abort();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function load(): Promise<void> {
  const currentSequence = ++sequence;
  controller?.abort();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  errorMessage.value = '';
  try {
    const result = await listAdminAftersales(query(), current.signal);
    if (currentSequence !== sequence) return;
    items.value = result.items;
    page.value = result.pagination.page;
    total.value = result.pagination.total;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await redirectIfExpired(error)) return;
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

function search(): void {
  page.value = 1;
  void load();
}

function reset(): void {
  aftersaleNo.value = '';
  orderId.value = '';
  customerId.value = '';
  status.value = '';
  type.value = '';
  dateRange.value = null;
  page.value = 1;
  void load();
}

function changePage(next: number): void {
  page.value = next;
  void load();
}

watch(linkedStatus, (value) => {
  status.value = value;
  page.value = 1;
  void load();
}, { immediate: true });
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
});
</script>

<template>
  <AdminShell>
    <div
      class="aftersales-page"
      data-testid="admin-aftersales-page"
    >
      <section class="page-heading">
        <div>
          <p>服务管理 · ADM-12</p>
          <h1>售后管理</h1>
          <span>集中处理审核、退货验收与退款，不在列表暴露敏感地址或证据链接。</span>
        </div>
      </section>

      <section
        class="aftersale-filters"
        aria-label="售后筛选"
        data-testid="aftersale-filters"
      >
        <el-input
          v-model="aftersaleNo"
          clearable
          placeholder="售后单号"
          @keyup.enter="search"
        >
          <template #prefix>
            <el-icon><Search /></el-icon>
          </template>
        </el-input>
        <el-select
          v-model="type"
          clearable
          placeholder="全部类型"
        >
          <el-option
            label="仅退款"
            value="REFUND_ONLY"
          />
          <el-option
            label="退货退款"
            value="RETURN_REFUND"
          />
        </el-select>
        <el-select
          v-model="status"
          clearable
          placeholder="全部状态"
        >
          <el-option
            v-for="option in statusOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="开始日期"
          end-placeholder="结束日期"
        />
        <el-input
          v-model="orderId"
          clearable
          placeholder="订单 ULID"
          @keyup.enter="search"
        />
        <el-input
          v-model="customerId"
          clearable
          placeholder="客户 ULID"
          @keyup.enter="search"
        />
        <div class="filter-actions">
          <el-button
            type="primary"
            data-testid="aftersale-search"
            @click="search"
          >
            <el-icon><Search /></el-icon>查询
          </el-button>
          <el-button
            data-testid="aftersale-reset"
            @click="reset"
          >
            <el-icon><Refresh /></el-icon>重置
          </el-button>
        </div>
      </section>

      <section
        class="aftersale-results"
        data-testid="aftersale-results"
      >
        <header>
          <div><strong>{{ total }} 笔售后申请</strong><span>按申请时间倒序</span></div>
          <el-button
            text
            :loading="loading"
            aria-label="刷新售后列表"
            @click="load"
          >
            <el-icon><Refresh /></el-icon>刷新
          </el-button>
        </header>

        <el-alert
          v-if="errorMessage"
          :title="errorMessage"
          type="error"
          :closable="false"
          show-icon
        >
          <template #default>
            <el-button
              link
              type="primary"
              @click="load"
            >
              重新加载
            </el-button>
          </template>
        </el-alert>
        <el-table
          v-else
          v-loading="loading"
          :data="items"
          row-key="aftersale_id"
          empty-text="当前筛选下暂无售后申请"
        >
          <el-table-column
            label="售后单"
            min-width="210"
          >
            <template #default="{ row }">
              <div class="primary-cell">
                <strong>{{ row.aftersale_no }}</strong><span>订单 {{ row.order_id }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="客户"
            min-width="150"
          >
            <template #default="{ row }">
              <div class="primary-cell">
                <strong>{{ row.customer_alias }}</strong><span>{{ row.customer_id }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column
            label="类型"
            min-width="110"
          >
            <template #default="{ row }">
              {{ row.type === 'RETURN_REFUND' ? '退货退款' : '仅退款' }}
            </template>
          </el-table-column>
          <el-table-column
            label="申请金额"
            min-width="110"
          >
            <template #default="{ row }">
              <strong class="money">¥{{ row.requested_amount }}</strong>
            </template>
          </el-table-column>
          <el-table-column
            label="状态"
            min-width="130"
          >
            <template #default="{ row }">
              <el-tag
                :type="statusTone(row.status)"
                effect="plain"
              >
                {{ statusLabel(row.status) }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column
            label="申请时间"
            min-width="170"
          >
            <template #default="{ row }">
              {{ formatChinaDateTime(row.created_at) }}
            </template>
          </el-table-column>
          <el-table-column
            fixed="right"
            label="操作"
            width="100"
          >
            <template #default="{ row }">
              <el-button
                link
                type="primary"
                :data-testid="`open-aftersale-${row.aftersale_id}`"
                @click="router.push(`/aftersales/${row.aftersale_id}`)"
              >
                <el-icon><View /></el-icon>详情
              </el-button>
            </template>
          </el-table-column>
        </el-table>

        <footer v-if="total > pageSize">
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <el-pagination
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
.aftersales-page { min-width: 0; }
.aftersale-filters { display: grid; grid-template-columns: repeat(3, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; padding: 16px; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; }
.filter-actions { display: flex; justify-content: flex-end; gap: 8px; }
.aftersale-results { min-width: 0; overflow: hidden; border: 1px solid var(--admin-border); border-radius: 7px; background: #fff; }
.aftersale-results > header, .aftersale-results > footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 16px; }
.aftersale-results > header { border-bottom: 1px solid var(--admin-border); }
.aftersale-results > footer { border-top: 1px solid var(--admin-border); color: var(--admin-muted); font-size: 12px; }
.aftersale-results > header > div { display: flex; align-items: baseline; gap: 10px; }
.aftersale-results > header span, .primary-cell span { color: var(--admin-muted); font-size: 11px; }
.primary-cell { display: grid; min-width: 0; gap: 4px; }
.primary-cell strong, .primary-cell span { overflow-wrap: anywhere; }
.money { color: var(--admin-danger); }
.aftersale-filters :deep(.el-date-editor) { width: 100%; min-width: 0; }
.aftersale-results :deep(.el-alert) { margin: 14px; }
@media (max-width: 1024px) { .aftersale-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 680px) { .aftersale-filters { grid-template-columns: minmax(0, 1fr); padding: 12px; } .filter-actions { justify-content: stretch; } .filter-actions .el-button { flex: 1; } .aftersale-results > header > div { display: grid; gap: 2px; } .aftersale-results > footer { align-items: flex-start; flex-direction: column; } }
</style>
