<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import PageState from '../components/PageState.vue';
import AgentShell from '../layouts/AgentShell.vue';
import type { AgentOrderDetail, AgentOrderList, AgentOrderListItem, AgentOrderQuery } from '../services/agent';
import { getAgentOrder, listAgentOrders } from '../services/agent';
import { formatChinaDateTime, formatMoney, formatRate, handleAuthError, loadErrorMessage, ruleSourceLabel, sumNonNegativeMoney } from '../utils/presentation';

const route = useRoute();
const router = useRouter();
const orderNo = ref('');
const orderStatus = ref<AgentOrderQuery['orderStatus']>();
const refundProgressStatus = ref<AgentOrderQuery['refundProgressStatus']>();
const refundProcessingStatus = ref<AgentOrderQuery['refundProcessingStatus']>();
const fulfillmentStatus = ref<AgentOrderQuery['fulfillmentStatus']>();
const hasAftersale = ref<'all' | 'yes' | 'no'>('all');
const dates = ref<[string, string] | null>(null);
const minAmount = ref('');
const maxAmount = ref('');
const sort = ref<AgentOrderQuery['sort']>('CREATED_DESC');
const customerId = ref(typeof route.query.customer_id === 'string' ? route.query.customer_id : '');
const page = ref(1);
const data = ref<AgentOrderList>();
const detail = ref<AgentOrderDetail>();
const selectedId = ref('');
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
  listController?.abort(); listController = new AbortController();
  loading.value = true; errorMessage.value = '';
  try {
    const response = await listAgentOrders({
      page: page.value,
      pageSize: 20,
      customerId: customerId.value || undefined,
      orderNo: orderNo.value.trim() || undefined,
      orderStatus: orderStatus.value,
      refundProgressStatus: refundProgressStatus.value,
      refundProcessingStatus: refundProcessingStatus.value,
      fulfillmentStatus: fulfillmentStatus.value,
      hasAftersale: hasAftersale.value === 'all' ? undefined : hasAftersale.value === 'yes',
      dateFrom: dates.value?.[0],
      dateTo: dates.value?.[1],
      minAmount: minAmount.value.trim() || undefined,
      maxAmount: maxAmount.value.trim() || undefined,
      sort: sort.value,
    }, listController.signal);
    if (sequence === listSeq) data.value = response;
  } catch (error) {
    if (sequence !== listSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '归属订单');
  } finally { if (sequence === listSeq) loading.value = false; }
}

async function openDetail(order: Pick<AgentOrderListItem, 'order_id'>): Promise<void> {
  selectedId.value = order.order_id;
  drawerOpen.value = true; detail.value = undefined; detailError.value = ''; detailLoading.value = true;
  const sequence = ++detailSeq;
  detailController?.abort(); detailController = new AbortController();
  try {
    const response = await getAgentOrder(order.order_id, detailController.signal);
    if (sequence === detailSeq) detail.value = response;
  } catch (error) {
    if (sequence !== detailSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    detailError.value = loadErrorMessage(error, '订单详情');
  } finally { if (sequence === detailSeq) detailLoading.value = false; }
}

function search(): void { page.value = 1; void load(); }
function clearCustomer(): void { customerId.value = ''; void router.replace({ name: 'orders', query: {} }); }
function itemSummary(order: AgentOrderListItem): string {
  return order.items.map((item) => `${item.product_name} / ${item.sku_name}`).join('；');
}
function aftersaleSummary(order: AgentOrderListItem): string {
  return order.aftersale_summary.latest_status ?? '无售后';
}
function commissionItemSummary(item: AgentOrderDetail['commission_items'][number]): string {
  const orderItem = detail.value?.items.find(({ order_item_id: id }) => id === item.order_item_id);
  return orderItem ? `${orderItem.product_name} / ${orderItem.sku_name}` : `订单项 ${item.order_item_id}`;
}

onMounted(async () => {
  await load();
  const id = typeof route.query.order_id === 'string' ? route.query.order_id : '';
  if (id) await openDetail({ order_id: id });
});
watch(() => route.query.customer_id, (value) => { customerId.value = typeof value === 'string' ? value : ''; search(); });
onBeforeUnmount(() => { listSeq += 1; detailSeq += 1; listController?.abort(); detailController?.abort(); });
</script>

<template>
  <AgentShell>
    <header class="page-heading"><div><h1>归属订单</h1><p>只读展示支付时最终归属为您的订单快照，不随客户后续转移改变。</p></div><div class="page-actions"><el-button data-testid="orders-refresh" :icon="Refresh" :loading="loading" @click="load" /><el-button data-testid="agent-primary-action" :icon="Search" type="primary" @click="search">查询</el-button></div></header>
    <div class="notice" style="margin-bottom: 18px">代理端不能发货、退款或修改订单状态；所有订单动作由总部与商城履约系统处理。</div>
    <section class="panel">
      <div v-if="customerId" class="notice" data-testid="orders-customer-filter" style="margin-bottom: 14px">正在查看指定客户当前归属期订单。<el-button link type="primary" @click="clearCustomer">清除筛选</el-button></div>
      <div class="filter-bar">
        <el-input v-model="orderNo" data-testid="orders-number" clearable placeholder="订单号" @keyup.enter="search" />
        <el-select v-model="orderStatus" data-testid="orders-status" clearable placeholder="订单轴"><el-option label="待发货" value="PENDING_SHIPMENT" /><el-option label="履约中" value="SHIPPING" /><el-option label="已完成" value="COMPLETED" /><el-option label="已关闭" value="CLOSED" /></el-select>
        <el-select v-model="refundProgressStatus" data-testid="orders-refund-progress" clearable placeholder="退款进度"><el-option label="未退款" value="NONE" /><el-option label="部分退款" value="PARTIAL" /><el-option label="全额退款" value="FULL" /></el-select>
        <el-select v-model="refundProcessingStatus" data-testid="orders-refund-processing" clearable placeholder="退款处理"><el-option label="无处理中" value="IDLE" /><el-option label="退款中" value="REFUNDING" /><el-option label="退款失败" value="FAILED" /></el-select>
        <el-select v-model="fulfillmentStatus" data-testid="orders-fulfillment" clearable placeholder="履约状态"><el-option label="未开始" value="NOT_STARTED" /><el-option label="待发货" value="READY_TO_SHIP" /><el-option label="已发货" value="SHIPPED" /><el-option label="运输中" value="IN_TRANSIT" /><el-option label="已送达" value="DELIVERED" /><el-option label="已取消" value="CANCELLED" /></el-select>
        <el-select v-model="hasAftersale" data-testid="orders-aftersale"><el-option label="全部售后状态" value="all" /><el-option label="存在售后" value="yes" /><el-option label="从未售后" value="no" /></el-select>
        <el-date-picker v-model="dates" data-testid="orders-dates" end-placeholder="结束日期" range-separator="至" start-placeholder="支付开始" type="daterange" value-format="YYYY-MM-DD" />
        <div class="copy-row"><el-input v-model="minAmount" data-testid="orders-min-amount" inputmode="decimal" placeholder="最低金额" /><el-input v-model="maxAmount" data-testid="orders-max-amount" inputmode="decimal" placeholder="最高金额" /></div>
        <el-select v-model="sort" data-testid="orders-sort"><el-option label="创建时间倒序" value="CREATED_DESC" /><el-option label="支付时间倒序" value="PAID_DESC" /><el-option label="金额倒序" value="AMOUNT_DESC" /></el-select>
        <div class="filter-actions"><el-button :icon="Search" type="primary" @click="search">查询</el-button></div>
      </div>
      <PageState testid="orders-state" :empty="!data?.items.length" empty-message="暂无符合条件的归属订单" :error="errorMessage" :loading="loading" @retry="load">
        <el-table class="data-table desktop-table" :data="data?.items">
          <el-table-column label="订单号" prop="order_no" min-width="205" /><el-table-column label="客户 / 城市" min-width="145"><template #default="scope">{{ scope.row.customer_alias }}<br><small>{{ scope.row.customer_city || '暂无' }}</small></template></el-table-column><el-table-column label="商品 / SKU" min-width="210"><template #default="scope">{{ itemSummary(scope.row) }}</template></el-table-column><el-table-column label="状态 / 售后" min-width="150"><template #default="scope"><span class="status-pill">{{ scope.row.display_status }}</span><br><small>{{ aftersaleSummary(scope.row) }}</small></template></el-table-column><el-table-column label="实付" min-width="120"><template #default="scope">{{ formatMoney(scope.row.payable_amount) }}</template></el-table-column><el-table-column label="支付时间" min-width="175"><template #default="scope">{{ formatChinaDateTime(scope.row.paid_at) }}</template></el-table-column><el-table-column fixed="right" label="操作" width="100"><template #default="scope"><el-button link type="primary" :data-testid="`order-detail-${scope.row.order_id}`" @click="openDetail(scope.row)">详情</el-button></template></el-table-column>
        </el-table>
        <div class="mobile-list"><button v-for="order in data?.items" :key="order.order_id" class="mobile-record" :data-testid="`order-detail-${order.order_id}`" type="button" @click="openDetail(order)"><span class="record-head"><strong>{{ order.order_no }}</strong><span class="status-pill">{{ order.display_status }}</span></span><span class="record-line"><span>{{ itemSummary(order) }}</span><b>{{ formatMoney(order.payable_amount) }}</b></span><span class="record-line"><span>{{ order.customer_alias }} · {{ order.customer_city || '暂无' }}</span><b>{{ formatChinaDateTime(order.paid_at) }}</b></span><span class="record-line"><span>售后 {{ aftersaleSummary(order) }}</span><b>{{ order.fulfillment_status }}</b></span></button></div>
        <div class="pagination-row"><el-pagination v-if="(data?.pagination.total ?? 0) > 20" v-model:current-page="page" :page-size="20" :total="data?.pagination.total" layout="prev, pager, next" @current-change="load" /></div>
      </PageState>
    </section>
    <el-drawer v-model="drawerOpen" data-testid="order-detail" destroy-on-close size="600px" title="订单详情">
      <PageState testid="order-detail-state" :error="detailError" :loading="detailLoading" @retry="openDetail({ order_id: selectedId })">
        <template v-if="detail">
          <dl class="detail-list"><dt>订单号</dt><dd>{{ detail.order_no }}</dd><dt>展示状态</dt><dd><span class="status-pill">{{ detail.display_status }}</span></dd><dt>订单 / 履约轴</dt><dd>{{ detail.order_status }} / {{ detail.fulfillment_status }}</dd><dt>退款进度 / 处理</dt><dd>{{ detail.refund_progress_status }} / {{ detail.refund_processing_status }}</dd><dt>支付处置</dt><dd>{{ detail.payment_resolution }}</dd><dt>关闭原因</dt><dd>{{ detail.close_reason || '不适用' }}</dd><dt>完成原因</dt><dd>{{ detail.completion_reason || '不适用' }}</dd><dt>支付金额</dt><dd>{{ formatMoney(detail.payable_amount) }}</dd><dt>支付时间</dt><dd>{{ formatChinaDateTime(detail.paid_at) }}</dd><dt>客户</dt><dd>{{ detail.customer_snapshot.customer_alias }} · {{ detail.customer_snapshot.nickname_masked || '未设置昵称' }}</dd><dt>地区</dt><dd>{{ detail.customer_snapshot.address_summary_masked || detail.customer_snapshot.city || '暂无' }}</dd></dl>
          <section class="detail-section"><h3>商品明细</h3><div v-for="item in detail.items" :key="item.order_item_id" class="panel" style="margin-top: 10px"><div class="record-head"><strong>{{ item.product_name }} · {{ item.sku_name }}</strong><b>{{ formatMoney(item.line_amount) }}</b></div><p class="dialog-note">{{ formatMoney(item.unit_price) }} × {{ item.quantity }}，已退 {{ item.refunded_quantity }}</p></div></section>
          <section class="detail-section"><div class="section-title"><h3>佣金快照</h3><strong data-testid="order-commission-total">合计 {{ formatMoney(sumNonNegativeMoney(detail.commission_items.map(({ original_commission }) => original_commission))) }}</strong></div><div v-for="item in detail.commission_items" :key="item.commission_snapshot_id" class="panel" style="margin-top: 10px"><div class="record-head"><strong>{{ commissionItemSummary(item) }}</strong><span class="status-pill">{{ item.effective_rate === '0.0000' ? '无佣金' : formatRate(item.effective_rate) }}</span></div><div class="record-line"><span>{{ ruleSourceLabel(item.rule_source) }} · {{ item.state }}</span><b>{{ formatMoney(item.original_commission) }}</b></div><el-button link type="primary" @click="router.push({ name: 'commissions', query: { snapshot_id: item.commission_snapshot_id } })">查看佣金解释</el-button></div></section>
          <section class="detail-section"><h3>售后摘要</h3><div v-if="!detail.aftersales.length" class="empty-inline">暂无售后记录</div><div v-for="aftersale in detail.aftersales" :key="aftersale.aftersale_id" class="panel" style="margin-top: 10px"><div class="record-head"><strong>{{ aftersale.aftersale_no }}</strong><span class="status-pill">{{ aftersale.status }}</span></div><p class="dialog-note">{{ aftersale.type }} · {{ formatMoney(aftersale.requested_amount) }} · {{ formatChinaDateTime(aftersale.created_at) }}</p></div></section>
          <section class="detail-section"><h3>支付、退款、履约与售后事件</h3><div v-for="event in detail.timeline" :key="event.event_id" class="record-line"><span>{{ event.axis }} · {{ event.event_code }} · {{ event.from_status || '起始' }} → {{ event.to_status }}</span><b>{{ formatChinaDateTime(event.occurred_at) }}</b></div><div v-if="!detail.timeline.length" class="empty-inline">暂无事件</div></section>
        </template>
      </PageState>
    </el-drawer>
  </AgentShell>
</template>
