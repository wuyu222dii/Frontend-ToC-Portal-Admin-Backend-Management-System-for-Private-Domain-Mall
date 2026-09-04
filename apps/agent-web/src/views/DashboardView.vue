<script setup lang="ts">
import { Link, Refresh } from '@element-plus/icons-vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import PageState from '../components/PageState.vue';
import PromotionDialog from '../components/PromotionDialog.vue';
import AgentShell from '../layouts/AgentShell.vue';
import type { AgentDashboard, AgentDashboardDays, AgentOrderListItem } from '../services/agent';
import { getAgentDashboard, listAgentOrders } from '../services/agent';
import { formatChinaDateTime, formatMoney, handleAuthError, loadErrorMessage } from '../utils/presentation';

const router = useRouter();
const dashboard = ref<AgentDashboard>();
const trendDays = ref<AgentDashboardDays>(7);
const recentOrders = ref<AgentOrderListItem[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const promotionOpen = ref(false);
let request = 0;
let controller: AbortController | undefined;

async function load(): Promise<void> {
  const sequence = ++request;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  errorMessage.value = '';
  try {
    const [summary, orders] = await Promise.all([
      getAgentDashboard(trendDays.value, controller.signal),
      listAgentOrders({ page: 1, pageSize: 5, sort: 'PAID_DESC' }, controller.signal),
    ]);
    if (sequence !== request) return;
    dashboard.value = summary;
    recentOrders.value = orders.items;
  } catch (error) {
    if (sequence !== request || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '经营概览');
  } finally {
    if (sequence === request) loading.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => { request += 1; controller?.abort(); });
</script>

<template>
  <AgentShell>
    <header class="page-heading">
      <div><h1>经营概览</h1><p>数据时区为中国标准时间，金额已扣除已完成退款。</p></div>
      <div class="page-actions">
        <el-button data-testid="dashboard-refresh" :icon="Refresh" :loading="loading" @click="load" title="刷新经营概览" />
        <el-button data-testid="agent-primary-action" :icon="Link" type="primary" @click="promotionOpen = true">推广商城</el-button>
      </div>
    </header>
    <PageState testid="dashboard-state" :error="errorMessage" :loading="loading" @retry="load">
      <template v-if="dashboard">
        <section class="metric-grid" data-testid="dashboard-metrics">
          <article class="metric"><small>今日净销售额</small><strong>{{ formatMoney(dashboard.today_net_sales_amount) }}</strong><span>本月 {{ formatMoney(dashboard.month_net_sales_amount) }}</span></article>
          <article class="metric"><small>今日有效订单</small><strong>{{ dashboard.today_paid_order_count }}</strong><span>剩余实付大于 0</span></article>
          <article class="metric"><small>当前归属客户</small><strong>{{ dashboard.attributed_customer_count }}</strong><span>仅当前有效绑定</span></article>
          <article class="metric"><small>待结算佣金</small><strong>{{ formatMoney(dashboard.expected_commission) }}</strong><span>支付时规则快照</span></article>
        </section>
        <section class="wallet-strip" data-testid="dashboard-wallet">
          <div><small>可用余额</small><strong>{{ formatMoney(dashboard.available_balance) }}</strong></div>
          <div><small>冻结余额</small><strong>{{ formatMoney(dashboard.frozen_balance) }}</strong></div>
          <div><small>负向余额</small><strong>{{ formatMoney(dashboard.negative_balance) }}</strong></div>
        </section>
        <div class="panel-grid" style="margin-top: 18px">
          <section class="panel">
            <div class="section-title"><h2>待办事项</h2><small>{{ dashboard.pending_withdrawal_count }} 笔提现处理中</small></div>
            <div class="todo-list">
              <RouterLink class="todo-item" to="/commissions"><span>佣金异常</span><strong>{{ dashboard.todo.commission_exception_count }}</strong></RouterLink>
              <RouterLink class="todo-item" to="/wallet"><span>提现事项</span><strong>{{ dashboard.todo.withdrawal_action_count }}</strong></RouterLink>
            </div>
          </section>
          <section class="panel">
            <div class="section-title"><h2>经营趋势</h2><el-segmented v-model="trendDays" data-testid="dashboard-trend-days" :options="[{ label: '7 日', value: 7 }, { label: '30 日', value: 30 }]" @change="load" /></div>
            <div v-if="dashboard.trend.length" class="mobile-list" style="display: block">
              <div v-for="point in dashboard.trend" :key="point.business_date" class="record-line">
                <span>{{ point.business_date }}</span><b>{{ formatMoney(point.net_sales_amount) }} · {{ point.paid_order_count }} 单</b>
              </div>
            </div>
            <div v-else class="empty-inline">暂无趋势数据</div>
          </section>
        </div>
        <section class="panel">
          <div class="section-title"><h2>最近归属订单</h2><RouterLink to="/orders">查看全部</RouterLink></div>
          <div v-if="!recentOrders.length" class="empty-inline">暂无归属订单</div>
          <el-table v-else class="data-table desktop-table" :data="recentOrders">
            <el-table-column label="订单号" prop="order_no" min-width="190" />
            <el-table-column label="客户" prop="customer_alias" min-width="130" />
            <el-table-column label="状态" prop="display_status" min-width="110" />
            <el-table-column label="实付" min-width="120"><template #default="scope">{{ formatMoney(scope.row.payable_amount) }}</template></el-table-column>
            <el-table-column label="支付时间" min-width="180"><template #default="scope">{{ formatChinaDateTime(scope.row.paid_at) }}</template></el-table-column>
          </el-table>
          <div v-if="recentOrders.length" class="mobile-list">
            <RouterLink v-for="order in recentOrders" :key="order.order_id" class="mobile-record" :to="{ name: 'orders', query: { order_id: order.order_id } }">
              <span class="record-head"><strong>{{ order.order_no }}</strong><span class="status-pill">{{ order.display_status }}</span></span>
              <span class="record-line"><span>{{ order.customer_alias }}</span><b>{{ formatMoney(order.payable_amount) }}</b></span>
            </RouterLink>
          </div>
        </section>
      </template>
    </PageState>
    <PromotionDialog v-model="promotionOpen" target-name="青序生活商城" target-type="STOREFRONT" />
  </AgentShell>
</template>
