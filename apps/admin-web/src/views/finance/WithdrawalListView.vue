<script setup lang="ts">
import { Refresh, Search, View } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError } from '../../services/admin-api';
import { listAdminWithdrawals } from '../../services/admin-withdrawals';
import { authSession } from '../../stores/auth-session';
import type { AdminWithdrawal, AdminWithdrawalListQuery } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

const route = useRoute();
const router = useRouter();
const items = ref<AdminWithdrawal[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const withdrawalNo = ref('');
const agentId = ref('');
const status = ref<AdminWithdrawalListQuery['status'] | ''>('');
const amountRange = ref<[string, string]>(['', '']);
const dateRange = ref<[string, string] | null>(null);
let sequence = 0;
let controller: AbortController | null = null;

function routeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const lockedAgentId = computed(() => routeText(route.query.agent_id));
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));
const statusOptions: ReadonlyArray<{ label: string; value: NonNullable<AdminWithdrawalListQuery['status']> }> = [
  { label: '待审核', value: 'PENDING' },
  { label: '待付款', value: 'APPROVED' },
  { label: '已拒绝', value: 'REJECTED' },
  { label: '已付款', value: 'PAID' },
];
const linkedStatus = computed<AdminWithdrawalListQuery['status'] | ''>(() => {
  const value = routeText(route.query.status);
  return statusOptions.some((option) => option.value === value)
    ? value as NonNullable<AdminWithdrawalListQuery['status']>
    : '';
});

function statusLabel(value: AdminWithdrawal['status']): string {
  return statusOptions.find((option) => option.value === value)?.label ?? value;
}

function statusTone(value: AdminWithdrawal['status']): 'danger' | 'info' | 'success' | 'warning' {
  if (value === 'PAID') return 'success';
  if (value === 'REJECTED') return 'info';
  return value === 'PENDING' ? 'danger' : 'warning';
}

function rowClassName({ row }: { row: AdminWithdrawal }): string {
  return row.status === 'PENDING' || row.status === 'APPROVED' ? 'attention-row' : '';
}

function query(): AdminWithdrawalListQuery {
  const value: AdminWithdrawalListQuery = { page: page.value, pageSize };
  if (withdrawalNo.value.trim()) value.withdrawalNo = withdrawalNo.value.trim();
  const effectiveAgentId = lockedAgentId.value || agentId.value.trim();
  if (effectiveAgentId) value.agentId = effectiveAgentId;
  if (status.value) value.status = status.value;
  if (amountRange.value[0].trim()) value.minAmount = amountRange.value[0].trim();
  if (amountRange.value[1].trim()) value.maxAmount = amountRange.value[1].trim();
  if (dateRange.value) [value.dateFrom, value.dateTo] = dateRange.value;
  return value;
}

async function handleExpired(error: unknown): Promise<boolean> {
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
    const result = await listAdminWithdrawals(query(), current.signal);
    if (currentSequence !== sequence) return;
    items.value = result.items;
    page.value = result.pagination.page;
    total.value = result.pagination.total;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleExpired(error)) return;
    items.value = [];
    total.value = 0;
    errorMessage.value = error instanceof AdminApiError && error.status === 403
      ? '当前账号无权访问提现审核'
      : error instanceof AdminApiError && error.status === 0
        ? '网络连接失败，请检查网络后重试'
        : error instanceof AdminApiError && error.status === 400
          ? '筛选条件无效，请检查后重试'
          : '提现列表加载失败，请稍后重试';
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function search(): void { page.value = 1; void load(); }
function reset(): void { withdrawalNo.value = ''; agentId.value = lockedAgentId.value; status.value = ''; amountRange.value = ['', '']; dateRange.value = null; page.value = 1; void load(); }
function changePage(next: number): void { page.value = next; void load(); }

watch([lockedAgentId, linkedStatus], ([linkedAgentId, linkedWithdrawalStatus]) => {
  agentId.value = linkedAgentId;
  status.value = linkedWithdrawalStatus;
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
    <div class="withdrawals-page" data-testid="admin-withdrawal-list-page">
      <section class="page-heading"><div><p>代理资金 · ADM-20</p><h1>提现审核</h1><span>优先处理待审核与待付款申请，银行卡仅显示申请时冻结的掩码快照。</span></div></section>
      <el-alert v-if="lockedAgentId" data-testid="withdrawal-agent-lock" type="info" :closable="false" show-icon :title="`已锁定代理 ${lockedAgentId}`" />
      <section class="withdrawal-filters">
        <el-input v-model="withdrawalNo" clearable placeholder="提现单号" @keyup.enter="search"><template #prefix><el-icon><Search /></el-icon></template></el-input>
        <el-select v-model="status" clearable placeholder="全部状态"><el-option v-for="option in statusOptions" :key="option.value" :label="option.label" :value="option.value" /></el-select>
        <el-input v-model="agentId" :clearable="!lockedAgentId" :disabled="Boolean(lockedAgentId)" data-testid="withdrawal-agent-filter" placeholder="代理 ULID" @keyup.enter="search" />
        <div class="amount-filter"><el-input v-model="amountRange[0]" inputmode="decimal" placeholder="最低金额" /><span>至</span><el-input v-model="amountRange[1]" inputmode="decimal" placeholder="最高金额" /></div>
        <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始日期" end-placeholder="结束日期" />
        <div class="withdrawal-filter-actions"><el-button type="primary" @click="search"><el-icon><Search /></el-icon>查询</el-button><el-button data-testid="withdrawal-reset" @click="reset"><el-icon><Refresh /></el-icon>重置</el-button></div>
      </section>
      <section class="withdrawal-results">
        <header><div><strong>{{ total }} 笔提现申请</strong><span>待审核与待付款状态优先标记</span></div><el-button text :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button></header>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon><template #default><el-button link type="primary" @click="load">重新加载</el-button></template></el-alert>
        <div v-else-if="loading" class="withdrawal-state"><el-skeleton :rows="7" animated /></div>
        <el-empty v-else-if="items.length === 0" description="没有符合条件的提现申请" />
        <template v-else>
          <div class="table-scroll"><el-table :data="items" :row-class-name="rowClassName">
            <el-table-column label="提现单" min-width="185"><template #default="scope"><strong>{{ scope.row.withdrawal_no }}</strong><small>{{ formatChinaDateTime(scope.row.created_at) }}</small></template></el-table-column>
            <el-table-column label="代理" min-width="160"><template #default="scope">{{ scope.row.agent_name }}<small>{{ scope.row.agent_no }}</small></template></el-table-column>
            <el-table-column label="金额" width="120"><template #default="scope"><strong>¥{{ scope.row.amount }}</strong></template></el-table-column>
            <el-table-column label="状态" width="105"><template #default="scope"><el-tag :type="statusTone(scope.row.status)">{{ statusLabel(scope.row.status) }}</el-tag></template></el-table-column>
            <el-table-column label="收款账户" min-width="190"><template #default="scope">{{ scope.row.payout_account_snapshot.bank_name }}<small>{{ scope.row.payout_account_snapshot.account_number_masked }}</small></template></el-table-column>
            <el-table-column label="凭证" width="90"><template #default="scope">{{ scope.row.proof_file_ids.length }} 个</template></el-table-column>
            <el-table-column label="操作" width="92" fixed="right"><template #default="scope"><el-button link type="primary" @click="router.push(`/withdrawals/${scope.row.withdrawal_id}`)"><el-icon><View /></el-icon>处理</el-button></template></el-table-column>
          </el-table></div>
          <div class="withdrawal-pagination"><span>第 {{ page }} / {{ totalPages }} 页</span><el-pagination small layout="prev, pager, next" :page-size="pageSize" :total="total" :current-page="page" @current-change="changePage" /></div>
        </template>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.withdrawals-page { display: grid; gap: 18px; }
.withdrawal-filters { display: grid; grid-template-columns: 1fr .75fr 1fr 1.4fr 1.35fr auto; gap: 10px; align-items: center; }
.amount-filter, .withdrawal-filter-actions { display: flex; align-items: center; gap: 7px; }
.amount-filter span { color: var(--admin-muted); font-size: 11px; }
.withdrawal-results { min-width: 0; border-top: 1px solid var(--admin-border); background: #fff; }
.withdrawal-results > header { display: flex; min-height: 64px; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--admin-border); }
.withdrawal-results > header div { display: grid; gap: 3px; }
.withdrawal-results span, :deep(.el-table small) { display: block; color: var(--admin-muted); font-size: 11px; }
.withdrawal-state { padding: 24px; }
.table-scroll { overflow-x: auto; }
:deep(.attention-row td.el-table__cell) { background: #fffbf1; }
.withdrawal-pagination { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; color: var(--admin-muted); font-size: 12px; }
@media (max-width: 1180px) { .withdrawal-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .withdrawal-filter-actions { grid-column: 1 / -1; } }
@media (max-width: 620px) { .withdrawal-filters { grid-template-columns: 1fr; } .withdrawal-filter-actions { grid-column: auto; } .withdrawal-filter-actions .el-button { flex: 1; } .withdrawal-pagination { align-items: flex-start; flex-direction: column; } }
</style>
