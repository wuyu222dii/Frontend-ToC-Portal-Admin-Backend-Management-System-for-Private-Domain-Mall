<script setup lang="ts">
import { Refresh, Search, View } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { listAdminCustomers } from '../../services/admin-customers';
import { AdminApiError } from '../../services/admin-api';
import { authSession } from '../../stores/auth-session';
import type { AdminCustomer, AdminCustomerListQuery } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

const route = useRoute();
const router = useRouter();
const items = ref<AdminCustomer[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const page = ref(1);
const pageSize = 20;
const total = ref(0);
const keyword = ref('');
const agentId = ref('');
const bindingStatus = ref<AdminCustomerListQuery['bindingStatus'] | ''>('');
const dateRange = ref<[string, string] | null>(null);
let sequence = 0;
let controller: AbortController | null = null;

function routeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const lockedAgentId = computed(() => routeText(route.query.agent_id));
const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

function bindingLabel(item: AdminCustomer): string {
  return item.binding?.agent_name ?? '总部直营';
}

function query(): AdminCustomerListQuery {
  const value: AdminCustomerListQuery = { page: page.value, pageSize };
  if (keyword.value.trim()) value.keyword = keyword.value.trim();
  const effectiveAgentId = lockedAgentId.value || agentId.value.trim();
  if (effectiveAgentId) value.agentId = effectiveAgentId;
  if (bindingStatus.value) value.bindingStatus = bindingStatus.value;
  if (dateRange.value) [value.dateFrom, value.dateTo] = dateRange.value;
  return value;
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '客户列表加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 403) return '当前账号无权访问客户管理';
  if (error.status === 429) return '查询过于频繁，请稍后重试';
  if (error.status === 400) return '筛选条件无效，请检查后重试';
  return '客户列表加载失败，请稍后重试';
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
    const result = await listAdminCustomers(query(), current.signal);
    if (currentSequence !== sequence) return;
    items.value = result.items;
    page.value = result.pagination.page;
    total.value = result.pagination.total;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleExpired(error)) return;
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
  keyword.value = '';
  agentId.value = lockedAgentId.value;
  bindingStatus.value = '';
  dateRange.value = null;
  page.value = 1;
  void load();
}

function changePage(next: number): void {
  page.value = next;
  void load();
}

watch(lockedAgentId, (value) => {
  agentId.value = value;
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
    <div class="b13-page" data-testid="admin-customer-list-page">
      <section class="page-heading">
        <div>
          <p>客户经营 · ADM-14</p>
          <h1>客户管理</h1>
          <span>查看总部直营与代理归属，历史支付快照不随当前归属变化。</span>
        </div>
      </section>

      <el-alert
        v-if="lockedAgentId"
        data-testid="customer-agent-lock"
        type="info"
        :closable="false"
        show-icon
        :title="`已锁定代理 ${lockedAgentId}`"
      />

      <section class="b13-filters" aria-label="客户筛选">
        <el-input v-model="keyword" clearable placeholder="客户别名 / 掩码昵称" @keyup.enter="search">
          <template #prefix><el-icon><Search /></el-icon></template>
        </el-input>
        <el-select v-model="bindingStatus" clearable placeholder="全部归属">
          <el-option label="当前代理归属" value="BOUND" />
          <el-option label="总部直营" value="UNBOUND" />
          <el-option label="历史归属结束" value="ENDED" />
        </el-select>
        <el-input
          v-model="agentId"
          :clearable="!lockedAgentId"
          :disabled="Boolean(lockedAgentId)"
          data-testid="customer-agent-filter"
          placeholder="代理 ULID"
          @keyup.enter="search"
        />
        <el-date-picker
          v-model="dateRange"
          type="daterange"
          value-format="YYYY-MM-DD"
          start-placeholder="注册开始"
          end-placeholder="注册结束"
        />
        <div class="b13-filter-actions">
          <el-button type="primary" data-testid="customer-search" @click="search"><el-icon><Search /></el-icon>查询</el-button>
          <el-button data-testid="customer-reset" @click="reset"><el-icon><Refresh /></el-icon>重置</el-button>
        </div>
      </section>

      <section class="b13-results">
        <header>
          <div><strong>{{ total }} 位客户</strong><span>按注册时间倒序</span></div>
          <el-button text :loading="loading" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
        </header>
        <el-alert v-if="errorMessage" :title="errorMessage" type="error" :closable="false" show-icon>
          <template #default><el-button link type="primary" @click="load">重新加载</el-button></template>
        </el-alert>
        <div v-else-if="loading" class="b13-state"><el-skeleton :rows="7" animated /></div>
        <el-empty v-else-if="items.length === 0" description="没有符合条件的客户" />
        <template v-else>
          <div class="b13-table-wrap">
            <el-table :data="items" min-width="980">
              <el-table-column label="客户" min-width="180">
                <template #default="scope"><strong>{{ scope.row.customer_alias }}</strong><small>{{ scope.row.nickname_masked ?? '未设置昵称' }} · {{ scope.row.phone_masked ?? '无手机号' }}</small></template>
              </el-table-column>
              <el-table-column label="当前归属" min-width="150">
                <template #default="scope"><el-tag :type="scope.row.binding ? 'success' : 'info'" effect="plain">{{ bindingLabel(scope.row) }}</el-tag></template>
              </el-table-column>
              <el-table-column prop="consumption_amount" label="累计消费" min-width="120" />
              <el-table-column prop="consumption_count" label="订单数" width="90" />
              <el-table-column prop="last_product_name" label="最近商品" min-width="150" />
              <el-table-column label="注册时间" min-width="170"><template #default="scope">{{ formatChinaDateTime(scope.row.registered_at) }}</template></el-table-column>
              <el-table-column label="操作" width="92" fixed="right"><template #default="scope"><el-button link type="primary" @click="router.push(`/customers/${scope.row.customer_id}`)"><el-icon><View /></el-icon>详情</el-button></template></el-table-column>
            </el-table>
          </div>
          <div class="b13-pagination">
            <span>第 {{ page }} / {{ totalPages }} 页</span>
            <el-pagination small layout="prev, pager, next" :page-size="pageSize" :total="total" :current-page="page" @current-change="changePage" />
          </div>
        </template>
      </section>
    </div>
  </AdminShell>
</template>

<style scoped>
.b13-page { display: grid; gap: 18px; }
.b13-filters { display: grid; grid-template-columns: minmax(180px, 1.3fr) minmax(150px, .8fr) minmax(190px, 1fr) minmax(250px, 1.2fr) auto; gap: 10px; align-items: center; }
.b13-filter-actions { display: flex; gap: 8px; }
.b13-results { min-width: 0; border-top: 1px solid var(--admin-border); background: #fff; }
.b13-results > header { display: flex; min-height: 64px; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--admin-border); }
.b13-results > header div { display: grid; gap: 3px; }
.b13-results > header span, :deep(.el-table small) { display: block; color: var(--admin-muted); font-size: 11px; }
.b13-state { padding: 24px; }
.b13-table-wrap { overflow-x: auto; }
.b13-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px 18px; color: var(--admin-muted); font-size: 12px; }
@media (max-width: 1180px) { .b13-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .b13-filter-actions { grid-column: 1 / -1; } }
@media (max-width: 620px) { .b13-filters { grid-template-columns: 1fr; } .b13-filter-actions { grid-column: auto; } .b13-filter-actions .el-button { flex: 1; } .b13-pagination { align-items: flex-start; flex-direction: column; } }
</style>
