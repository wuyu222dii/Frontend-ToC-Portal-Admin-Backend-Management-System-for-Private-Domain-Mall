<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import PageState from '../components/PageState.vue';
import AgentShell from '../layouts/AgentShell.vue';
import type { AgentCommissionDetail, AgentCommissionList, AgentCommissionQuery } from '../services/agent';
import { getAgentCommission, listAgentCommissions } from '../services/agent';
import { formatChinaDateTime, formatMoney, formatRate, handleAuthError, loadErrorMessage, ruleSourceLabel } from '../utils/presentation';

const route = useRoute();
const router = useRouter();
const orderNo = ref('');
const state = ref<AgentCommissionQuery['state']>();
const ledgerType = ref<AgentCommissionQuery['ledgerType']>();
const dates = ref<[string, string] | null>(null);
const page = ref(1);
const data = ref<AgentCommissionList>();
const detail = ref<AgentCommissionDetail>();
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

const ledgerLabels: Record<string, string> = { EXPECTED_CREATED: '计入待结算', EXPECTED_REDUCED: '待结算减少', EXPECTED_CANCELLED: '待结算取消', AVAILABLE_CREDIT: '转入可用', REFUND_DEBIT: '退款冲减' };
const stateLabels: Record<string, string> = { NONE: '无佣金', EXPECTED: '待结算', CANCELLED: '已取消', AVAILABLE: '已入账' };

async function load(): Promise<void> {
  const sequence = ++listSeq;
  listController?.abort(); listController = new AbortController(); loading.value = true; errorMessage.value = '';
  try {
    const response = await listAgentCommissions({ page: page.value, pageSize: 20, orderNo: orderNo.value.trim() || undefined, state: state.value, ledgerType: ledgerType.value, dateFrom: dates.value?.[0], dateTo: dates.value?.[1] }, listController.signal);
    if (sequence === listSeq) data.value = response;
  } catch (error) {
    if (sequence !== listSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '佣金明细');
  } finally { if (sequence === listSeq) loading.value = false; }
}

async function openDetail(id: string): Promise<void> {
  selectedId.value = id; drawerOpen.value = true; detail.value = undefined; detailError.value = ''; detailLoading.value = true;
  const sequence = ++detailSeq;
  detailController?.abort(); detailController = new AbortController();
  try {
    const response = await getAgentCommission(id, detailController.signal);
    if (sequence === detailSeq) detail.value = response;
  } catch (error) {
    if (sequence !== detailSeq || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    detailError.value = loadErrorMessage(error, '佣金解释');
  } finally { if (sequence === detailSeq) detailLoading.value = false; }
}

function search(): void { page.value = 1; void load(); }
onMounted(async () => { await load(); const id = typeof route.query.snapshot_id === 'string' ? route.query.snapshot_id : ''; if (id) await openDetail(id); });
onBeforeUnmount(() => { listSeq += 1; detailSeq += 1; listController?.abort(); detailController?.abort(); });
</script>

<template>
  <AgentShell>
    <header class="page-heading"><div><h1>佣金明细</h1><p>每一笔佣金都按支付时冻结的规则版本解释，退款按原快照冲减。</p></div><div class="page-actions"><el-button data-testid="commissions-refresh" :icon="Refresh" :loading="loading" @click="load" /><el-button data-testid="agent-primary-action" :icon="Search" type="primary" @click="search">查询</el-button></div></header>
    <section class="panel">
      <div class="filter-bar"><el-input v-model="orderNo" data-testid="commissions-order" clearable placeholder="订单号" @keyup.enter="search" /><el-select v-model="state" data-testid="commissions-state-filter" clearable placeholder="佣金状态"><el-option v-for="(label, value) in stateLabels" :key="value" :label="label" :value="value" /></el-select><el-select v-model="ledgerType" data-testid="commissions-type" clearable placeholder="流水类型"><el-option v-for="(label, value) in ledgerLabels" :key="value" :label="label" :value="value" /></el-select><el-date-picker v-model="dates" data-testid="commissions-dates" end-placeholder="结束日期" range-separator="至" start-placeholder="开始日期" type="daterange" value-format="YYYY-MM-DD" /><div class="filter-actions"><el-button :icon="Search" type="primary" @click="search">查询</el-button></div></div>
      <PageState testid="commissions-state" :empty="!data?.items.length" empty-message="暂无佣金流水" :error="errorMessage" :loading="loading" @retry="load">
        <el-table class="data-table desktop-table" :data="data?.items"><el-table-column label="时间" min-width="175"><template #default="scope">{{ formatChinaDateTime(scope.row.occurred_at) }}</template></el-table-column><el-table-column label="订单 / 商品" min-width="220"><template #default="scope"><strong>{{ scope.row.order_no }}</strong><br><small>{{ scope.row.product_name }} · {{ scope.row.sku_name }}</small></template></el-table-column><el-table-column label="计佣基数" min-width="120"><template #default="scope">{{ formatMoney(scope.row.commission_base) }}</template></el-table-column><el-table-column label="支付比例" min-width="130"><template #default="scope">{{ scope.row.effective_rate === '0.0000' ? '无佣金' : formatRate(scope.row.effective_rate) }}<br><small>支付快照</small></template></el-table-column><el-table-column label="流水 / 状态" min-width="135"><template #default="scope">{{ ledgerLabels[scope.row.ledger_type] }}<br><small>{{ stateLabels[scope.row.position_state] }}</small></template></el-table-column><el-table-column label="待结算 / 可用变动" min-width="170"><template #default="scope">{{ formatMoney(scope.row.expected_change) }} / {{ formatMoney(scope.row.available_change) }}</template></el-table-column><el-table-column label="原因 / 退款" min-width="190"><template #default="scope">{{ scope.row.reason }}<br><small>{{ scope.row.refund_id || '无关联退款' }}</small></template></el-table-column><el-table-column fixed="right" label="操作" width="100"><template #default="scope"><el-button link type="primary" :data-testid="`commission-detail-${scope.row.commission_snapshot_id}`" @click="openDetail(scope.row.commission_snapshot_id)">解释</el-button></template></el-table-column></el-table>
        <div class="mobile-list"><button v-for="item in data?.items" :key="item.ledger_id" class="mobile-record" :data-testid="`commission-detail-${item.commission_snapshot_id}`" type="button" @click="openDetail(item.commission_snapshot_id)"><span class="record-head"><strong>{{ item.product_name }}</strong><span class="status-pill">{{ stateLabels[item.position_state] }}</span></span><span class="record-line"><span>{{ item.order_no }} · {{ item.sku_name }}</span><b>{{ formatChinaDateTime(item.occurred_at) }}</b></span><span class="record-line"><span>{{ ledgerLabels[item.ledger_type] }} · {{ item.effective_rate === '0.0000' ? '无佣金' : formatRate(item.effective_rate) }}</span><b>{{ formatMoney(item.available_change) }}</b></span><span class="record-line"><span>基数 {{ formatMoney(item.commission_base) }}</span><b>待结算 {{ formatMoney(item.expected_change) }}</b></span><span class="record-line"><span>{{ item.reason }}</span><b>{{ item.refund_id || '无关联退款' }}</b></span></button></div>
        <div class="pagination-row"><el-pagination v-if="(data?.pagination.total ?? 0) > 20" v-model:current-page="page" :page-size="20" :total="data?.pagination.total" layout="prev, pager, next" @current-change="load" /></div>
      </PageState>
    </section>
    <el-drawer v-model="drawerOpen" data-testid="commission-detail" destroy-on-close size="600px" title="佣金解释">
      <PageState testid="commission-detail-state" :error="detailError" :loading="detailLoading" @retry="openDetail(selectedId)">
        <template v-if="detail">
          <dl class="detail-list"><dt>订单号</dt><dd>{{ detail.order_no }}</dd><dt>商品 / SKU</dt><dd>{{ detail.item.product_name }} / {{ detail.item.sku_name }}</dd><dt>有效比例</dt><dd>{{ detail.item.effective_rate === '0.0000' ? '无佣金（0%）' : formatRate(detail.item.effective_rate) }}</dd><dt>规则来源</dt><dd>{{ ruleSourceLabel(detail.item.rule_source) }} · v{{ detail.item.rule_version_no }}</dd><dt>计佣基数</dt><dd>{{ formatMoney(detail.item.commission_base) }}</dd><dt>原始佣金</dt><dd>{{ formatMoney(detail.item.original_commission) }}</dd><dt>剩余待结算</dt><dd>{{ formatMoney(detail.item.expected_remaining) }}</dd><dt>累计冲减</dt><dd>{{ formatMoney(detail.item.reversal_total) }}</dd></dl>
          <section class="detail-section"><h3>规则命中路径</h3><div v-for="path in detail.item.hit_path" :key="path" class="record-line"><span>{{ path }}</span></div></section>
          <section class="detail-section"><h3>账本流水</h3><div v-if="!detail.item.ledger.length" class="empty-inline">0% 佣金没有资金流水</div><div v-for="entry in detail.item.ledger" :key="entry.ledger_id" class="panel" style="margin-top: 10px"><div class="record-head"><strong>{{ ledgerLabels[entry.ledger_type] }}</strong><b>{{ formatMoney(entry.available_change) }}</b></div><p class="dialog-note">待结算 {{ formatMoney(entry.expected_change) }} · 冻结 {{ formatMoney(entry.frozen_change) }}</p><small>{{ formatChinaDateTime(entry.occurred_at) }} · {{ entry.reason }}</small></div></section>
        </template>
      </PageState>
    </el-drawer>
  </AgentShell>
</template>
