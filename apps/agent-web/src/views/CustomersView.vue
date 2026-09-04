<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import PageState from '../components/PageState.vue';
import AgentShell from '../layouts/AgentShell.vue';
import type { AgentCustomerDetail, AgentCustomerList, AgentCustomerListItem } from '../services/agent';
import { getAgentCustomer, listAgentCustomers } from '../services/agent';
import { formatChinaDateTime, formatMoney, handleAuthError, loadErrorMessage } from '../utils/presentation';

const router = useRouter();
const keyword = ref('');
const dates = ref<[string, string] | null>(null);
const page = ref(1);
const data = ref<AgentCustomerList>();
const detail = ref<AgentCustomerDetail>();
const selected = ref<AgentCustomerListItem>();
const drawerOpen = ref(false);
const loading = ref(true);
const detailLoading = ref(false);
const errorMessage = ref('');
const detailError = ref('');
let listSeq = 0;
let detailSeq = 0;
let listController: AbortController | undefined;
let detailController: AbortController | undefined;

async function load(): Promise<void> {
  const sequence = ++listSeq;
  listController?.abort();
  listController = new AbortController();
  loading.value = true;
  errorMessage.value = '';
  try {
    const response = await listAgentCustomers({ page: page.value, pageSize: 20, keyword: keyword.value.trim() || undefined, dateFrom: dates.value?.[0], dateTo: dates.value?.[1] }, listController.signal);
    if (sequence === listSeq) data.value = response;
  } catch (error) {
    if (sequence !== listSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '客户列表');
  } finally { if (sequence === listSeq) loading.value = false; }
}

async function openDetail(customer: AgentCustomerListItem): Promise<void> {
  selected.value = customer;
  drawerOpen.value = true;
  detail.value = undefined;
  detailError.value = '';
  detailLoading.value = true;
  const sequence = ++detailSeq;
  detailController?.abort();
  detailController = new AbortController();
  try {
    const response = await getAgentCustomer(customer.customer_id, detailController.signal);
    if (sequence === detailSeq) detail.value = response;
  } catch (error) {
    if (sequence !== detailSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    detailError.value = loadErrorMessage(error, '客户详情');
  } finally { if (sequence === detailSeq) detailLoading.value = false; }
}

function search(): void { page.value = 1; void load(); }
onMounted(load);
onBeforeUnmount(() => { listSeq += 1; detailSeq += 1; listController?.abort(); detailController?.abort(); });
</script>

<template>
  <AgentShell>
    <header class="page-heading"><div><h1>我的客户</h1><p>仅展示当前仍归属您的客户，不包含已结束的历史绑定。</p></div><div class="page-actions"><el-button data-testid="customers-refresh" :icon="Refresh" :loading="loading" @click="load" /><el-button data-testid="agent-primary-action" :icon="Search" type="primary" @click="search">查询</el-button></div></header>
    <section class="panel">
      <div class="filter-bar three">
        <el-input v-model="keyword" data-testid="customers-keyword" clearable placeholder="客户编号、昵称或手机尾号" @keyup.enter="search" />
        <el-date-picker v-model="dates" data-testid="customers-dates" end-placeholder="结束日期" range-separator="至" start-placeholder="开始日期" type="daterange" value-format="YYYY-MM-DD" />
        <span></span><div class="filter-actions"><el-button :icon="Search" type="primary" @click="search">查询</el-button></div>
      </div>
      <PageState testid="customers-state" :empty="!data?.items.length" empty-message="暂无当前归属客户" :error="errorMessage" :loading="loading" @retry="load">
        <el-table class="data-table desktop-table" :data="data?.items">
          <el-table-column label="客户" min-width="175"><template #default="scope"><strong>{{ scope.row.customer_alias }}</strong><br><small>{{ scope.row.nickname_masked || '未设置昵称' }}</small></template></el-table-column>
          <el-table-column label="地区 / 手机尾号" min-width="140"><template #default="scope">{{ scope.row.city || '暂无' }} · {{ scope.row.phone_tail || '未绑定' }}</template></el-table-column>
          <el-table-column label="当前归属开始" min-width="180"><template #default="scope">{{ formatChinaDateTime(scope.row.binding_started_at) }}</template></el-table-column>
          <el-table-column label="消费" min-width="130"><template #default="scope">{{ formatMoney(scope.row.consumption_amount) }}<br><small>{{ scope.row.consumption_count }} 单</small></template></el-table-column>
          <el-table-column fixed="right" label="操作" width="100"><template #default="scope"><el-button link type="primary" :data-testid="`customer-detail-${scope.row.customer_id}`" @click="openDetail(scope.row)">详情</el-button></template></el-table-column>
        </el-table>
        <div class="mobile-list">
          <button v-for="customer in data?.items" :key="customer.customer_id" class="mobile-record" :data-testid="`customer-detail-${customer.customer_id}`" type="button" @click="openDetail(customer)"><span class="record-head"><strong>{{ customer.customer_alias }}</strong><span class="status-pill success">当前归属</span></span><span class="record-line"><span>{{ customer.nickname_masked || '未设置昵称' }} · {{ customer.city || '暂无' }}</span><b>{{ formatMoney(customer.consumption_amount) }}</b></span><span class="record-line"><span>手机尾号 {{ customer.phone_tail || '未绑定' }}</span><b>{{ customer.consumption_count }} 单</b></span><span class="record-line"><span>归属自 {{ formatChinaDateTime(customer.binding_started_at) }}</span></span></button>
        </div>
        <div class="pagination-row"><el-pagination v-if="(data?.pagination.total ?? 0) > 20" v-model:current-page="page" :page-size="20" :total="data?.pagination.total" layout="prev, pager, next" @current-change="load" /></div>
      </PageState>
    </section>
    <el-drawer v-model="drawerOpen" data-testid="customer-detail" destroy-on-close size="540px" title="客户经营详情">
      <PageState testid="customer-detail-state" :error="detailError" :loading="detailLoading" @retry="selected && openDetail(selected)">
        <template v-if="detail">
          <dl class="detail-list"><dt>客户编号</dt><dd>{{ detail.customer.customer_alias }}</dd><dt>昵称</dt><dd>{{ detail.customer.nickname_masked || '未设置' }}</dd><dt>手机尾号</dt><dd>{{ detail.customer.phone_tail || '未绑定' }}</dd><dt>城市</dt><dd>{{ detail.customer.city || '暂无' }}</dd><dt>当前归属开始</dt><dd>{{ formatChinaDateTime(detail.binding_period.started_at) }}</dd><dt>累计消费</dt><dd>{{ formatMoney(detail.customer.consumption_amount) }} / {{ detail.customer.consumption_count }} 单</dd></dl>
          <el-button data-testid="customer-orders-link" style="width: 100%; margin-top: 20px" type="primary" @click="router.push({ name: 'orders', query: { customer_id: detail.customer.customer_id } })">查看当前归属期订单</el-button>
          <section class="detail-section"><h3>当前归属期订单</h3><div v-if="!detail.orders.length" class="empty-inline">暂无归属订单</div><button v-for="order in detail.orders" :key="order.order_id" class="mobile-record" type="button" @click="router.push({ name: 'orders', query: { order_id: order.order_id, customer_id: detail.customer.customer_id } })"><span class="record-head"><strong>{{ order.order_no }}</strong><span class="status-pill">{{ order.display_status }}</span></span><span class="record-line"><span>{{ formatChinaDateTime(order.paid_at) }}</span><b>{{ formatMoney(order.payable_amount) }}</b></span></button></section>
          <section class="detail-section"><h3>最近购买商品</h3><div v-if="!detail.recent_products.length" class="empty-inline">暂无商品记录</div><div v-for="product in detail.recent_products" :key="`${product.product_id}-${product.sku_id}`" class="record-line"><span>{{ product.product_name }} · {{ product.sku_name }}</span><b>{{ formatChinaDateTime(product.last_purchased_at) }}</b></div></section>
        </template>
      </PageState>
    </el-drawer>
  </AgentShell>
</template>
