<script setup lang="ts">
import {
  ArrowRight,
  Refresh,
  Search,
  View,
} from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router';

import AdminShell from '../../layouts/AdminShell.vue';
import { getAdminAgent, listAdminAgents, type AdminAgentListQuery } from '../../services/admin-agents';
import {
  getAdminDashboard,
  listAdminCustomerRanking,
  listAdminDailySales,
  listAdminMonthlySales,
  listAdminProductRanking,
  type AdminDashboardData,
  type AnalyticsScope,
  type CustomerRankingReportData,
  type DailySalesReportData,
  type MonthlySalesReportData,
  type ProductRankingReportData,
} from '../../services/admin-analytics';
import { AdminApiError } from '../../services/admin-api';
import { authSession } from '../../stores/auth-session';
import type { AdminAgent } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

type DashboardView = 'overview' | 'daily' | 'monthly' | 'products' | 'customers';
type Channel = AnalyticsScope | 'AGENT_ONE';
type AgentOption = Pick<AdminAgent, 'agent_id' | 'agent_no' | 'name' | 'status'>;

const views: ReadonlyArray<{ label: string; value: DashboardView }> = [
  { label: '概览', value: 'overview' },
  { label: '日报', value: 'daily' },
  { label: '月报', value: 'monthly' },
  { label: '商品排行', value: 'products' },
  { label: '客户排行', value: 'customers' },
];
const channels: ReadonlyArray<{ label: string; value: Channel }> = [
  { label: '全店', value: 'GLOBAL' },
  { label: '总部直营', value: 'DIRECT' },
  { label: '全部代理', value: 'AGENT' },
  { label: '指定代理', value: 'AGENT_ONE' },
];
const viewValues = new Set(views.map(({ value }) => value));
const channelValues = new Set(channels.map(({ value }) => value));
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^(\d{4})-(\d{2})$/;
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_PAGE = Math.floor(2_147_483_647 / 20) + 1;
const numberFormat = new Intl.NumberFormat('zh-CN');

const route = useRoute();
const router = useRouter();
const activeView = ref<DashboardView>('overview');
const channel = ref<Channel>('GLOBAL');
const agentId = ref('');
const dateRange = ref<[string, string] | null>(null);
const monthRange = ref<[string, string] | null>(null);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const errorMessage = ref('');
const dashboard = ref<AdminDashboardData | null>(null);
const dailyReport = ref<DailySalesReportData | null>(null);
const monthlyReport = ref<MonthlySalesReportData | null>(null);
const productReport = ref<ProductRankingReportData | null>(null);
const customerReport = ref<CustomerRankingReportData | null>(null);
const agentOptions = ref<AgentOption[]>([]);
const agentLoading = ref(false);
const agentOptionsError = ref('');
let requestSequence = 0;
let requestController: AbortController | null = null;
let agentSequence = 0;
let agentController: AbortController | null = null;

const selectedScope = computed<AnalyticsScope>(() => channel.value === 'AGENT_ONE' ? 'AGENT' : channel.value);
const selectionRequired = computed(() => channel.value === 'AGENT_ONE' && agentId.value.length === 0);
const currentReport = computed(() => {
  if (activeView.value === 'daily') return dailyReport.value;
  if (activeView.value === 'monthly') return monthlyReport.value;
  if (activeView.value === 'products') return productReport.value;
  if (activeView.value === 'customers') return customerReport.value;
  return null;
});
const totalPages = computed(() => Math.max(1, Math.ceil((currentReport.value?.pagination.total ?? 0) / pageSize)));
const currentAsOf = computed(() => dashboard.value?.as_of ?? currentReport.value?.as_of ?? '');

function routeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validDate(value: string): boolean {
  const parts = DATE.exec(value);
  if (!parts) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return date.getUTCFullYear() === Number(parts[1]) &&
    date.getUTCMonth() + 1 === Number(parts[2]) && date.getUTCDate() === Number(parts[3]);
}

function validMonth(value: string): boolean {
  const parts = MONTH.exec(value);
  return parts !== null && Number(parts[2]) >= 1 && Number(parts[2]) <= 12;
}

function validDateRange(from: string, to: string): boolean {
  if (!validDate(from) || !validDate(to)) return false;
  const fromTime = Date.parse(`${from}T00:00:00Z`);
  const toTime = Date.parse(`${to}T00:00:00Z`);
  return fromTime <= toTime && (toTime - fromTime) / DAY_MS + 1 <= 366;
}

function validMonthRange(from: string, to: string): boolean {
  if (!validMonth(from) || !validMonth(to)) return false;
  const [fromYear = 0, fromMonth = 0] = from.split('-').map(Number);
  const [toYear = 0, toMonth = 0] = to.split('-').map(Number);
  const difference = (toYear * 12 + toMonth) - (fromYear * 12 + fromMonth);
  return difference >= 0 && difference < 60;
}

function positivePage(value: string): number {
  return /^[1-9]\d*$/.test(value) && Number(value) <= MAX_PAGE ? Number(value) : 1;
}

function routeQuery(): LocationQueryRaw {
  const query: LocationQueryRaw = { scope: selectedScope.value, view: activeView.value };
  if (channel.value === 'AGENT_ONE') {
    query.agent_mode = 'ONE';
    if (agentId.value) query.agent_id = agentId.value;
  }
  if (dateRange.value) [query.date_from, query.date_to] = dateRange.value;
  if (monthRange.value) [query.month_from, query.month_to] = monthRange.value;
  if (page.value > 1) query.page = String(page.value);
  return query;
}

function sameRouteQuery(query: LocationQueryRaw): boolean {
  const keys = Object.keys(query);
  const currentKeys = Object.keys(route.query);
  return keys.length === currentKeys.length && keys.every((key) => routeText(route.query[key]) === query[key]);
}

function hydrateFromRoute(): LocationQueryRaw {
  const requestedView = routeText(route.query.view) as DashboardView;
  activeView.value = viewValues.has(requestedView) ? requestedView : 'overview';

  const requestedScope = routeText(route.query.scope) as AnalyticsScope;
  const scope: AnalyticsScope = ['GLOBAL', 'DIRECT', 'AGENT'].includes(requestedScope) ? requestedScope : 'GLOBAL';
  const requestedAgentId = routeText(route.query.agent_id).toUpperCase();
  const hasAgent = scope === 'AGENT' && ULID.test(requestedAgentId);
  channel.value = scope === 'AGENT' && (hasAgent || routeText(route.query.agent_mode) === 'ONE')
    ? 'AGENT_ONE'
    : scope;
  agentId.value = hasAgent ? requestedAgentId : '';

  const from = routeText(route.query.date_from);
  const to = routeText(route.query.date_to);
  dateRange.value = validDateRange(from, to) ? [from, to] : null;
  const monthFrom = routeText(route.query.month_from);
  const monthTo = routeText(route.query.month_to);
  monthRange.value = validMonthRange(monthFrom, monthTo) ? [monthFrom, monthTo] : null;
  page.value = positivePage(routeText(route.query.page));
  return routeQuery();
}

function clearResults(): void {
  dashboard.value = null;
  dailyReport.value = null;
  monthlyReport.value = null;
  productReport.value = null;
  customerReport.value = null;
}

function analyticsQuery(): {
  page: number;
  page_size: number;
  scope: AnalyticsScope;
  agent_id?: string;
  date_from?: string;
  date_to?: string;
} {
  const query: {
    page: number;
    page_size: number;
    scope: AnalyticsScope;
    agent_id?: string;
    date_from?: string;
    date_to?: string;
  } = { page: page.value, page_size: pageSize, scope: selectedScope.value };
  if (channel.value === 'AGENT_ONE' && agentId.value) query.agent_id = agentId.value;
  if (dateRange.value) [query.date_from, query.date_to] = dateRange.value;
  return query;
}

function readableError(error: unknown): string {
  if (error instanceof TypeError) return '服务响应格式不正确，已停止展示旧数据';
  if (!(error instanceof AdminApiError)) return '经营数据加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 400) return '筛选条件无效，请检查日期范围后重试';
  if (error.status === 403) return '当前账号无权访问经营分析';
  if (error.status === 404) return '指定代理不存在或已不可访问';
  if (error.status === 422) return '当前筛选条件无法处理，请调整后重试';
  if (error.status === 429) return error.retryAfterSeconds
    ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '查询过于频繁，请稍后重试';
  return '经营数据加载失败，请稍后重试';
}

async function handleExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++requestSequence;
  requestController?.abort();
  agentController?.abort();
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function load(): Promise<void> {
  const currentSequence = ++requestSequence;
  requestController?.abort();
  clearResults();
  errorMessage.value = '';
  if (activeView.value !== 'overview' && selectionRequired.value) {
    loading.value = false;
    return;
  }
  const controller = new AbortController();
  requestController = controller;
  loading.value = true;
  try {
    if (activeView.value === 'overview') {
      const result = await getAdminDashboard(controller.signal);
      if (currentSequence === requestSequence) dashboard.value = result;
    } else if (activeView.value === 'daily') {
      const result = await listAdminDailySales(analyticsQuery(), controller.signal);
      if (currentSequence === requestSequence) dailyReport.value = result;
    } else if (activeView.value === 'monthly') {
      const query = {
        page: page.value,
        page_size: pageSize,
        scope: selectedScope.value,
        ...(channel.value === 'AGENT_ONE' ? { agent_id: agentId.value } : {}),
        ...(monthRange.value ? { month_from: monthRange.value[0], month_to: monthRange.value[1] } : {}),
      };
      const result = await listAdminMonthlySales(query, controller.signal);
      if (currentSequence === requestSequence) monthlyReport.value = result;
    } else if (activeView.value === 'products') {
      const result = await listAdminProductRanking(analyticsQuery(), controller.signal);
      if (currentSequence === requestSequence) productReport.value = result;
    } else {
      const result = await listAdminCustomerRanking(analyticsQuery(), controller.signal);
      if (currentSequence === requestSequence) customerReport.value = result;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== requestSequence || await handleExpired(error)) return;
    clearResults();
    errorMessage.value = readableError(error);
  } finally {
    if (currentSequence === requestSequence) {
      loading.value = false;
      requestController = null;
    }
  }
}

async function loadAgentOptions(keyword = ''): Promise<void> {
  if (channel.value !== 'AGENT_ONE') return;
  const currentSequence = ++agentSequence;
  agentController?.abort();
  const controller = new AbortController();
  agentController = controller;
  agentLoading.value = true;
  agentOptionsError.value = '';
  try {
    const query: AdminAgentListQuery = { page: 1, pageSize: 100 };
    if (keyword.trim()) query.keyword = keyword.trim();
    const result = await listAdminAgents(query, controller.signal);
    const options: AgentOption[] = result.items;
    if (!keyword.trim() && agentId.value && !options.some((agent) => agent.agent_id === agentId.value)) {
      const detail = await getAdminAgent(agentId.value, controller.signal);
      options.unshift(detail.agent);
    }
    if (currentSequence !== agentSequence) return;
    agentOptions.value = options;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== agentSequence || await handleExpired(error)) return;
    agentOptions.value = [];
    agentOptionsError.value = '代理选项加载失败，可输入编号或名称重试';
  } finally {
    if (currentSequence === agentSequence) {
      agentLoading.value = false;
      agentController = null;
    }
  }
}

async function replaceQuery(): Promise<void> {
  const query = routeQuery();
  if (sameRouteQuery(query)) await load();
  else {
    ++requestSequence;
    requestController?.abort();
    requestController = null;
    clearResults();
    await router.replace({ name: 'dashboard', query });
  }
}

function selectView(value: DashboardView): void {
  if (value === activeView.value) return;
  activeView.value = value;
  page.value = 1;
  void replaceQuery();
}

function selectChannel(value: Channel): void {
  if (!channelValues.has(value) || value === channel.value) return;
  channel.value = value;
  page.value = 1;
  if (value !== 'AGENT_ONE') agentId.value = '';
  void replaceQuery();
}

function applyFilters(): void {
  if (selectionRequired.value) return;
  page.value = 1;
  void replaceQuery();
}

function changeAgent(): void {
  page.value = 1;
  void replaceQuery();
}

function moveTab(value: DashboardView, offset: number): void {
  const index = views.findIndex((item) => item.value === value);
  const next = views[(index + offset + views.length) % views.length];
  if (!next) return;
  selectView(next.value);
  document.getElementById(`dashboard-tab-${next.value}`)?.focus();
}

function resetFilters(): void {
  channel.value = 'GLOBAL';
  agentId.value = '';
  dateRange.value = null;
  monthRange.value = null;
  page.value = 1;
  void replaceQuery();
}

function changePage(value: number): void {
  page.value = value;
  void replaceQuery();
}

function count(value: number): string {
  return numberFormat.format(value);
}

function money(value: string): string {
  return `¥${value}`;
}

function negative(value: string): boolean {
  return value.startsWith('-');
}

watch(() => route.fullPath, async () => {
  const canonical = hydrateFromRoute();
  if (!sameRouteQuery(canonical)) {
    ++requestSequence;
    ++agentSequence;
    requestController?.abort();
    agentController?.abort();
    requestController = null;
    agentController = null;
    agentLoading.value = false;
    clearResults();
    await router.replace({ name: 'dashboard', query: canonical });
    return;
  }
  if (channel.value === 'AGENT_ONE') void loadAgentOptions();
  else {
    ++agentSequence;
    agentController?.abort();
    agentOptions.value = [];
    agentOptionsError.value = '';
  }
  await load();
}, { immediate: true });

onBeforeUnmount(() => {
  ++requestSequence;
  ++agentSequence;
  requestController?.abort();
  agentController?.abort();
});
</script>

<template>
  <AdminShell>
    <div class="dashboard-page" data-testid="admin-dashboard-page">
      <section class="page-heading dashboard-heading">
        <div>
          <p>总部经营 · ADM-02</p>
          <h1>数据看板</h1>
          <span>{{ currentAsOf ? `数据截至 ${formatChinaDateTime(currentAsOf)}（北京时间）` : '实时读取权威经营事实' }}</span>
        </div>
        <el-button
          circle
          :icon="Refresh"
          :loading="loading"
          aria-label="刷新当前数据"
          title="刷新当前数据"
          @click="replaceQuery"
        />
      </section>

      <nav class="dashboard-tabs" role="tablist" aria-label="经营分析视图">
        <button
          v-for="item in views"
          :id="`dashboard-tab-${item.value}`"
          :key="item.value"
          type="button"
          role="tab"
          :aria-controls="activeView === item.value ? `dashboard-panel-${item.value}` : undefined"
          :aria-selected="activeView === item.value"
          :class="{ active: activeView === item.value }"
          :tabindex="activeView === item.value ? 0 : -1"
          @click="selectView(item.value)"
          @keydown.left.prevent="moveTab(item.value, -1)"
          @keydown.right.prevent="moveTab(item.value, 1)"
        >{{ item.label }}</button>
      </nav>

      <section
        v-if="activeView !== 'overview'"
        class="analytics-filters"
        aria-label="经营数据筛选"
      >
        <div class="filter-field scope-field">
          <span>渠道范围</span>
          <div class="scope-switch" role="group" aria-label="渠道范围">
            <button
              v-for="item in channels"
              :key="item.value"
              type="button"
              :class="{ active: channel === item.value }"
              :aria-pressed="channel === item.value"
              @click="selectChannel(item.value)"
            >{{ item.label }}</button>
          </div>
        </div>

        <label v-if="channel === 'AGENT_ONE'" class="filter-field">
          <span>指定代理</span>
          <el-select
            v-model="agentId"
            clearable
            filterable
            remote
            reserve-keyword
            :loading="agentLoading"
            :remote-method="loadAgentOptions"
            placeholder="输入代理编号或名称"
            @change="changeAgent"
          >
            <el-option
              v-for="agent in agentOptions"
              :key="agent.agent_id"
              :label="`${agent.name} · ${agent.agent_no}${agent.status === 'DISABLED' ? '（已停用）' : ''}`"
              :value="agent.agent_id"
            />
          </el-select>
          <small v-if="agentOptionsError" class="filter-error">{{ agentOptionsError }}</small>
        </label>

        <label v-if="activeView === 'monthly'" class="filter-field">
          <span>业务月份</span>
          <el-date-picker
            v-model="monthRange"
            type="monthrange"
            value-format="YYYY-MM"
            range-separator="至"
            start-placeholder="默认当前月"
            end-placeholder="默认当前月"
            unlink-panels
          />
        </label>
        <label v-else class="filter-field">
          <span>业务日期</span>
          <el-date-picker
            v-model="dateRange"
            type="daterange"
            value-format="YYYY-MM-DD"
            range-separator="至"
            start-placeholder="使用接口默认日期"
            end-placeholder="使用接口默认日期"
            unlink-panels
          />
        </label>

        <div class="filter-actions">
          <el-button type="primary" :disabled="selectionRequired" :loading="loading" @click="applyFilters">
            <el-icon><Search /></el-icon>查询
          </el-button>
          <el-button :disabled="loading" @click="resetFilters">重置</el-button>
        </div>
        <p v-if="selectionRequired" class="selection-hint">请选择代理后查询指定渠道数据。</p>
      </section>

      <div
        :id="`dashboard-panel-${activeView}`"
        class="dashboard-panel"
        role="tabpanel"
        :aria-labelledby="`dashboard-tab-${activeView}`"
      >
        <section class="dashboard-state" aria-live="polite">
          <el-alert
            v-if="errorMessage"
            type="error"
            :closable="false"
            show-icon
            :title="errorMessage"
            role="alert"
          >
            <template #default><el-button link type="primary" @click="replaceQuery">重新加载</el-button></template>
          </el-alert>
          <el-skeleton v-else-if="loading" :rows="9" animated />
          <el-empty v-else-if="selectionRequired" description="请选择代理后查询指定渠道数据" />
        </section>

        <section
          v-if="activeView === 'overview' && dashboard && !loading && !errorMessage"
          class="overview-content"
        >
        <div class="primary-metrics" aria-label="销售概览">
          <div><span>今日净销售额</span><strong :class="{ negative: negative(dashboard.today_sales_amount) }">{{ money(dashboard.today_sales_amount) }}</strong></div>
          <div><span>本月净销售额</span><strong :class="{ negative: negative(dashboard.month_sales_amount) }">{{ money(dashboard.month_sales_amount) }}</strong></div>
          <div><span>累计净销售额</span><strong :class="{ negative: negative(dashboard.total_sales_amount) }">{{ money(dashboard.total_sales_amount) }}</strong></div>
          <button type="button" @click="router.push({ name: 'agents' })"><span>本月代理净销售额</span><strong :class="{ negative: negative(dashboard.month_agent_net_sales_amount) }">{{ money(dashboard.month_agent_net_sales_amount) }}</strong><ArrowRight /></button>
        </div>

        <div class="fact-strip" aria-label="经营事实">
          <div><span>今日创建订单</span><strong>{{ count(dashboard.today_created_order_count) }}</strong></div>
          <div><span>今日有效支付</span><strong>{{ count(dashboard.today_effective_paid_order_count) }}</strong></div>
          <button type="button" @click="router.push({ name: 'customers' })"><span>当前客户</span><strong>{{ count(dashboard.customer_total_snapshot) }}</strong></button>
          <div><span>今日新增注册</span><strong>{{ count(dashboard.new_registration_count) }}</strong></div>
          <button type="button" @click="router.push({ name: 'customers' })"><span>本月新增绑定</span><strong>{{ count(dashboard.new_binding_count) }}</strong></button>
          <button type="button" @click="router.push({ name: 'agents' })"><span>本月活跃代理</span><strong>{{ count(dashboard.active_agent_count) }}</strong></button>
          <button type="button" @click="router.push({ name: 'withdrawals', query: { status: 'PENDING' } })"><span>待审核提现</span><strong>{{ count(dashboard.pending_withdrawal_count) }}</strong></button>
        </div>

        <section class="todo-band" aria-labelledby="dashboard-todo-title">
          <header><div><h2 id="dashboard-todo-title">经营待办</h2><p>进入现有业务列表继续处理</p></div></header>
          <div>
            <button type="button" @click="router.push({ name: 'orders', query: { order_status: 'PENDING_SHIPMENT', fulfillment_status: 'READY_TO_SHIP' } })"><span><strong>待发货订单</strong><small>按待发货状态打开订单中心</small></span><ArrowRight /></button>
            <button type="button" @click="router.push({ name: 'aftersales', query: { status: 'PENDING_REVIEW' } })"><span><strong>待审核售后</strong><small>进入售后审核队列</small></span><ArrowRight /></button>
            <button type="button" @click="router.push({ name: 'withdrawals', query: { status: 'PENDING' } })"><span><strong>待审核提现</strong><small>{{ count(dashboard.pending_withdrawal_count) }} 笔等待处理</small></span><ArrowRight /></button>
          </div>
        </section>

        <section class="report-band" aria-labelledby="overview-ranking-title">
          <header>
            <div><h2 id="overview-ranking-title">本月商品净销量</h2><p>按服务端排名展示前五项</p></div>
            <el-button link type="primary" @click="selectView('products')">查看完整排行<el-icon><ArrowRight /></el-icon></el-button>
          </header>
          <el-empty v-if="dashboard.product_ranking.length === 0" description="本月暂无商品销售数据" />
          <div v-else class="table-wrap">
            <el-table :data="dashboard.product_ranking.slice(0, 5)">
              <el-table-column prop="rank" label="排名" width="72" />
              <el-table-column label="商品 / SKU" min-width="230"><template #default="scope"><strong>{{ scope.row.product_name }}</strong><small>{{ scope.row.sku_name }}</small></template></el-table-column>
              <el-table-column prop="net_units" label="净销量" width="100" />
              <el-table-column label="净销售额" min-width="130"><template #default="scope"><strong :class="{ negative: negative(scope.row.net_sales_amount) }">{{ money(scope.row.net_sales_amount) }}</strong></template></el-table-column>
              <el-table-column label="操作" width="76"><template #default="scope"><el-button link type="primary" aria-label="查看商品" @click="router.push({ name: 'product-detail', params: { product_id: scope.row.product_id }, query: { tab: 'skus' } })"><el-icon><View /></el-icon></el-button></template></el-table-column>
            </el-table>
          </div>
        </section>
        </section>

        <section
          v-else-if="activeView === 'daily' && dailyReport && !loading && !errorMessage"
          class="report-band"
        >
        <header><div><h2>日销售报表</h2><p>日期倒序 · {{ dailyReport.data_freshness === 'REALTIME' ? '实时数据' : dailyReport.data_freshness }}</p></div></header>
        <el-empty v-if="dailyReport.rows.length === 0" description="当前范围没有日报数据" />
        <div v-else class="table-wrap"><el-table :data="dailyReport.rows">
          <el-table-column prop="business_date" label="业务日期" width="118" />
          <el-table-column label="净销售 / 收退" min-width="175"><template #default="scope"><strong :class="{ negative: negative(scope.row.net_sales_amount) }">{{ money(scope.row.net_sales_amount) }}</strong><small>收 {{ money(scope.row.paid_amount) }} · 退 {{ money(scope.row.refunded_amount) }}</small></template></el-table-column>
          <el-table-column label="订单" min-width="135"><template #default="scope"><strong>{{ count(scope.row.paid_order_count) }} 笔有效支付</strong><small>{{ count(scope.row.created_order_count) }} 笔创建</small></template></el-table-column>
          <el-table-column label="商品件数" min-width="145"><template #default="scope"><strong>净 {{ count(scope.row.net_units) }}</strong><small>售 {{ count(scope.row.paid_units) }} · 退 {{ count(scope.row.refunded_units) }}</small></template></el-table-column>
          <el-table-column label="客户变化" min-width="145"><template #default="scope"><strong>注册 {{ count(scope.row.new_registration_count) }}</strong><small>绑定 {{ count(scope.row.new_binding_count) }}</small></template></el-table-column>
          <el-table-column v-if="selectedScope === 'GLOBAL'" label="全局快照" min-width="145"><template #default="scope"><strong>客户 {{ count(scope.row.customer_total_snapshot) }}</strong><small>活跃代理 {{ count(scope.row.active_agent_count) }}</small></template></el-table-column>
        </el-table></div>
        </section>

        <section
          v-else-if="activeView === 'monthly' && monthlyReport && !loading && !errorMessage"
          class="report-band"
        >
        <header><div><h2>月销售报表</h2><p>月份倒序 · 实时数据</p></div></header>
        <el-empty v-if="monthlyReport.rows.length === 0" description="当前范围没有月报数据" />
        <div v-else class="table-wrap"><el-table :data="monthlyReport.rows">
          <el-table-column prop="business_month" label="业务月份" width="110" />
          <el-table-column label="净销售 / 收退" min-width="175"><template #default="scope"><strong :class="{ negative: negative(scope.row.net_sales_amount) }">{{ money(scope.row.net_sales_amount) }}</strong><small>收 {{ money(scope.row.paid_amount) }} · 退 {{ money(scope.row.refunded_amount) }}</small></template></el-table-column>
          <el-table-column label="订单" min-width="135"><template #default="scope"><strong>{{ count(scope.row.paid_order_count) }} 笔有效支付</strong><small>{{ count(scope.row.created_order_count) }} 笔创建</small></template></el-table-column>
          <el-table-column label="商品件数" min-width="145"><template #default="scope"><strong>净 {{ count(scope.row.net_units) }}</strong><small>售 {{ count(scope.row.paid_units) }} · 退 {{ count(scope.row.refunded_units) }}</small></template></el-table-column>
          <el-table-column label="客户变化" min-width="145"><template #default="scope"><strong>注册 {{ count(scope.row.new_registration_count) }}</strong><small>绑定 {{ count(scope.row.new_binding_count) }}</small></template></el-table-column>
          <el-table-column v-if="selectedScope === 'GLOBAL'" label="全局快照" min-width="145"><template #default="scope"><strong>客户 {{ count(scope.row.customer_total_snapshot) }}</strong><small>活跃代理 {{ count(scope.row.active_agent_count) }}</small></template></el-table-column>
        </el-table></div>
        </section>

        <section
          v-else-if="activeView === 'products' && productReport && !loading && !errorMessage"
          class="report-band"
        >
        <header><div><h2>商品销量排行</h2><p>按净销量倒序，SKU 标识稳定收口</p></div></header>
        <el-empty v-if="productReport.rows.length === 0" description="当前范围没有商品销售数据" />
        <div v-else class="table-wrap"><el-table :data="productReport.rows">
          <el-table-column prop="rank" label="排名" width="72" />
          <el-table-column label="商品 / SKU" min-width="240"><template #default="scope"><strong>{{ scope.row.product_name }}</strong><small>{{ scope.row.sku_name }}</small></template></el-table-column>
          <el-table-column label="净件数" width="98"><template #default="scope"><strong>{{ count(scope.row.net_units) }}</strong></template></el-table-column>
          <el-table-column label="支付 / 退款件数" min-width="145"><template #default="scope">{{ count(scope.row.paid_units) }} / {{ count(scope.row.refunded_units) }}</template></el-table-column>
          <el-table-column label="净销售额" min-width="130"><template #default="scope"><strong :class="{ negative: negative(scope.row.net_sales_amount) }">{{ money(scope.row.net_sales_amount) }}</strong></template></el-table-column>
          <el-table-column label="支付 / 退款额" min-width="190"><template #default="scope">{{ money(scope.row.paid_amount) }} / {{ money(scope.row.refunded_amount) }}</template></el-table-column>
          <el-table-column label="操作" width="76" fixed="right"><template #default="scope"><el-button link type="primary" aria-label="查看商品" @click="router.push({ name: 'product-detail', params: { product_id: scope.row.product_id }, query: { tab: 'skus' } })"><el-icon><View /></el-icon></el-button></template></el-table-column>
        </el-table></div>
        </section>

        <section
          v-else-if="activeView === 'customers' && customerReport && !loading && !errorMessage"
          class="report-band"
        >
        <header><div><h2>客户消费排行</h2><p>仅展示批准的客户代号与掩码昵称</p></div></header>
        <el-empty v-if="customerReport.rows.length === 0" description="当前范围没有客户消费数据" />
        <div v-else class="table-wrap"><el-table :data="customerReport.rows">
          <el-table-column prop="rank" label="排名" width="72" />
          <el-table-column label="客户" min-width="190"><template #default="scope"><strong>{{ scope.row.customer_alias }}</strong><small>{{ scope.row.nickname_masked ?? '未设置昵称' }}</small></template></el-table-column>
          <el-table-column label="有效支付订单" min-width="130"><template #default="scope">{{ count(scope.row.paid_order_count) }}</template></el-table-column>
          <el-table-column label="净消费" min-width="130"><template #default="scope"><strong :class="{ negative: negative(scope.row.net_consumption_amount) }">{{ money(scope.row.net_consumption_amount) }}</strong></template></el-table-column>
          <el-table-column label="支付 / 退款" min-width="190"><template #default="scope">{{ money(scope.row.paid_amount) }} / {{ money(scope.row.refunded_amount) }}</template></el-table-column>
          <el-table-column label="操作" width="76"><template #default="scope"><el-button link type="primary" aria-label="查看客户" @click="router.push({ name: 'customer-detail', params: { customer_id: scope.row.customer_id } })"><el-icon><View /></el-icon></el-button></template></el-table-column>
        </el-table></div>
        </section>

        <footer v-if="activeView !== 'overview' && currentReport && currentReport.pagination.total > 0 && !loading && !errorMessage" class="report-pagination">
          <span>第 {{ page }} / {{ totalPages }} 页 · 共 {{ count(currentReport.pagination.total) }} 条</span>
          <el-pagination small layout="prev, pager, next" :page-size="pageSize" :total="currentReport.pagination.total" :current-page="page" @current-change="changePage" />
        </footer>
      </div>
    </div>
  </AdminShell>
</template>

<style scoped>
.dashboard-page { display: grid; gap: 18px; }
.dashboard-heading { margin-bottom: 0; }
.dashboard-tabs { display: flex; min-width: 0; overflow-x: auto; border-bottom: 1px solid var(--admin-border); }
.dashboard-tabs button { position: relative; min-width: 84px; min-height: 44px; padding: 0 16px; border: 0; color: var(--admin-muted); background: transparent; cursor: pointer; font-size: 13px; font-weight: 650; white-space: nowrap; }
.dashboard-tabs button::after { position: absolute; right: 16px; bottom: -1px; left: 16px; height: 2px; background: transparent; content: ''; }
.dashboard-tabs button:hover, .dashboard-tabs button.active { color: var(--admin-brand); }
.dashboard-tabs button.active::after { background: var(--admin-brand); }
.analytics-filters { display: grid; align-items: end; gap: 12px; grid-template-columns: minmax(360px, 1.4fr) minmax(260px, 1fr) auto; }
.filter-field { display: grid; min-width: 0; gap: 7px; }
.filter-field > span { color: var(--admin-text-soft); font-size: 12px; font-weight: 650; }
.scope-field { grid-column: 1 / -1; }
.scope-switch { display: flex; width: fit-content; max-width: 100%; overflow-x: auto; border: 1px solid var(--admin-border); border-radius: 6px; background: #fff; }
.scope-switch button { min-width: 92px; min-height: 36px; padding: 0 13px; border: 0; border-right: 1px solid var(--admin-border); color: var(--admin-text-soft); background: transparent; cursor: pointer; font-size: 12px; white-space: nowrap; }
.scope-switch button:last-child { border-right: 0; }
.scope-switch button.active { color: #fff; background: var(--admin-brand); }
.filter-actions { display: flex; align-items: center; }
.selection-hint, .filter-error { margin: 0; color: var(--admin-danger); font-size: 11px; }
.selection-hint { grid-column: 1 / -1; }
.dashboard-panel { display: grid; min-width: 0; gap: 18px; }
.dashboard-state:empty { display: none; }
.overview-content { display: grid; gap: 18px; }
.primary-metrics, .fact-strip { display: grid; overflow: hidden; border: 1px solid var(--admin-border); background: #fff; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.primary-metrics > div, .primary-metrics > button, .fact-strip > div, .fact-strip > button { display: grid; min-width: 0; min-height: 102px; align-content: center; gap: 8px; padding: 18px; border: 0; border-right: 1px solid var(--admin-border); color: inherit; background: transparent; text-align: left; }
.primary-metrics > :last-child { border-right: 0; }
.primary-metrics button, .fact-strip button { position: relative; cursor: pointer; }
.primary-metrics button:hover, .fact-strip button:hover { background: #f4f8f6; }
.primary-metrics button > svg { position: absolute; top: 16px; right: 16px; width: 15px; color: var(--admin-muted); }
.primary-metrics span, .fact-strip span { color: var(--admin-muted); font-size: 12px; }
.primary-metrics strong { overflow-wrap: anywhere; font-size: 23px; line-height: 1.2; }
.fact-strip { grid-template-columns: repeat(7, minmax(0, 1fr)); }
.fact-strip > div, .fact-strip > button { min-height: 82px; padding: 14px; border-bottom: 0; }
.fact-strip > :last-child { border-right: 0; }
.fact-strip strong { font-size: 18px; }
.todo-band, .report-band { min-width: 0; border-top: 1px solid var(--admin-border); background: #fff; }
.todo-band > header, .report-band > header { display: flex; min-height: 64px; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; border-bottom: 1px solid var(--admin-border); }
.todo-band h2, .report-band h2 { margin: 0; font-size: 15px; }
.todo-band p, .report-band p { margin: 4px 0 0; color: var(--admin-muted); font-size: 11px; }
.todo-band > div { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); }
.todo-band button { display: flex; min-height: 78px; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 18px; border: 0; border-right: 1px solid var(--admin-border); background: #fff; cursor: pointer; text-align: left; }
.todo-band button:last-child { border-right: 0; }
.todo-band button:hover { background: #f4f8f6; }
.todo-band button span, :deep(.el-table small) { display: grid; gap: 4px; }
.todo-band small, :deep(.el-table small) { color: var(--admin-muted); font-size: 11px; font-weight: 400; }
.todo-band svg { width: 15px; flex: 0 0 15px; color: var(--admin-muted); }
.table-wrap { max-width: 100%; overflow-x: auto; }
.report-pagination { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 16px; padding: 8px 18px; border-top: 1px solid var(--admin-border); background: #fff; color: var(--admin-muted); font-size: 12px; }
.negative { color: var(--admin-danger); }
:deep(.el-date-editor), :deep(.el-select) { width: 100%; }
:deep(.el-table strong) { display: block; }
@media (max-width: 1180px) {
  .analytics-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filter-actions { grid-column: 1 / -1; }
  .primary-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .primary-metrics > :nth-child(2) { border-right: 0; }
  .primary-metrics > :nth-child(-n + 2) { border-bottom: 1px solid var(--admin-border); }
  .fact-strip { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .fact-strip > :nth-child(4) { border-right: 0; }
  .fact-strip > :nth-child(-n + 4) { border-bottom: 1px solid var(--admin-border); }
}
@media (max-width: 820px) {
  .dashboard-page { gap: 14px; }
  .analytics-filters, .primary-metrics, .fact-strip, .todo-band > div { grid-template-columns: 1fr; }
  .scope-field, .filter-actions, .selection-hint { grid-column: auto; }
  .filter-actions .el-button { flex: 1; }
  .primary-metrics > div, .primary-metrics > button, .fact-strip > div, .fact-strip > button, .todo-band button { min-height: 72px; border-right: 0; border-bottom: 1px solid var(--admin-border); }
  .primary-metrics > :last-child, .fact-strip > :last-child, .todo-band button:last-child { border-bottom: 0; }
  .primary-metrics > :nth-child(2) { border-bottom: 1px solid var(--admin-border); }
  .report-pagination { align-items: flex-start; flex-direction: column; }
}
</style>
