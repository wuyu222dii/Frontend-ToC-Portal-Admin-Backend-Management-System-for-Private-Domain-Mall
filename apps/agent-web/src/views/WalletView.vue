<script setup lang="ts">
import { CreditCard, Money, Refresh } from '@element-plus/icons-vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import BankAccountDialog from '../components/BankAccountDialog.vue';
import PageState from '../components/PageState.vue';
import WithdrawalDialog from '../components/WithdrawalDialog.vue';
import AgentShell from '../layouts/AgentShell.vue';
import type { AgentBankAccount, AgentWallet, AgentWithdrawal, AgentWithdrawalList, AgentWithdrawalQuery } from '../services/agent';
import { getAgentWallet, getAgentWithdrawal, listAgentBankAccounts, listAgentWithdrawals } from '../services/agent';
import { formatChinaDateTime, formatMoney, handleAuthError, loadErrorMessage } from '../utils/presentation';

const router = useRouter();
const wallet = ref<AgentWallet>();
const accounts = ref<AgentBankAccount[]>([]);
const withdrawals = ref<AgentWithdrawalList>();
const withdrawalNo = ref('');
const status = ref<AgentWithdrawalQuery['status']>();
const dates = ref<[string, string] | null>(null);
const minAmount = ref('');
const maxAmount = ref('');
const page = ref(1);
const detail = ref<AgentWithdrawal>();
const selectedId = ref('');
const bankOpen = ref(false);
const withdrawalOpen = ref(false);
const drawerOpen = ref(false);
const loading = ref(true);
const detailLoading = ref(false);
const errorMessage = ref('');
const detailError = ref('');
let sequence = 0;
let detailSequence = 0;
let controller: AbortController | undefined;
let detailController: AbortController | undefined;
const statusLabels: Record<string, string> = { PENDING: '待审核', APPROVED: '已审核，待打款', REJECTED: '已拒绝', PAID: '已打款' };
const blockedReasonLabels: Record<string, string> = {
  BANK_ACCOUNT_REQUIRED: '请先绑定有效的收款银行卡',
  INSUFFICIENT_BALANCE: '当前没有可提现余额',
  NEGATIVE_BALANCE: '当前为负余额，后续佣金将优先抵扣',
  WITHDRAWAL_IN_PROGRESS: '已有提现申请正在处理中',
  WITHDRAWAL_MINIMUM_NOT_MET: '当前可用余额未达到最低提现金额',
  WITHDRAWAL_RULE_UNAVAILABLE: '提现规则暂不可用，请联系总部',
};

function blockedReason(reason: string | null | undefined): string {
  return reason ? (blockedReasonLabels[reason] ?? '当前钱包状态不允许提交提现申请') : '当前钱包状态不允许提交提现申请';
}

async function load(): Promise<void> {
  const current = ++sequence;
  controller?.abort(); controller = new AbortController(); loading.value = true; errorMessage.value = '';
  try {
    const [walletResult, accountResult, withdrawalResult] = await Promise.all([getAgentWallet(controller.signal), listAgentBankAccounts(controller.signal), listAgentWithdrawals({ page: page.value, pageSize: 20, withdrawalNo: withdrawalNo.value.trim() || undefined, status: status.value, dateFrom: dates.value?.[0], dateTo: dates.value?.[1], minAmount: minAmount.value.trim() || undefined, maxAmount: maxAmount.value.trim() || undefined }, controller.signal)]);
    if (current !== sequence) return;
    wallet.value = walletResult; accounts.value = accountResult; withdrawals.value = withdrawalResult;
  } catch (error) {
    if (current !== sequence || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '钱包与提现');
  } finally { if (current === sequence) loading.value = false; }
}

async function openDetail(item: Pick<AgentWithdrawal, 'withdrawal_id'>): Promise<void> {
  selectedId.value = item.withdrawal_id; drawerOpen.value = true; detail.value = undefined; detailError.value = ''; detailLoading.value = true;
  const current = ++detailSequence;
  detailController?.abort(); detailController = new AbortController();
  try { const response = await getAgentWithdrawal(item.withdrawal_id, detailController.signal); if (current === detailSequence) detail.value = response; }
  catch (error) { if (current !== detailSequence || (error instanceof DOMException && error.name === 'AbortError')) return; if (await handleAuthError(error, router)) return; detailError.value = loadErrorMessage(error, '提现详情'); }
  finally { if (current === detailSequence) detailLoading.value = false; }
}

onMounted(load);
onBeforeUnmount(() => { sequence += 1; detailSequence += 1; controller?.abort(); detailController?.abort(); });
</script>

<template>
  <AgentShell>
    <header class="page-heading"><div><h1>钱包与提现</h1><p>提现审核期间金额冻结；实际规则与可提现状态以服务端结果为准。</p></div><div class="page-actions"><el-button data-testid="wallet-refresh" :icon="Refresh" :loading="loading" @click="load" /><el-button :icon="CreditCard" @click="bankOpen = true">收款卡</el-button><el-button data-testid="agent-primary-action" :disabled="!wallet?.withdrawal_allowed || !accounts.some((item) => item.is_active)" :icon="Money" type="primary" @click="withdrawalOpen = true">申请提现</el-button></div></header>
    <PageState testid="wallet-state" :error="errorMessage" :loading="loading" @retry="load">
      <template v-if="wallet">
        <section class="wallet-strip" style="margin-top: 0"><div><small>可用余额</small><strong>{{ formatMoney(wallet.available_balance) }}</strong></div><div><small>提现冻结</small><strong>{{ formatMoney(wallet.frozen_balance) }}</strong></div><div><small>钱包状态</small><strong>{{ wallet.is_negative ? '负向余额' : wallet.withdrawal_allowed ? '可申请提现' : '暂不可提现' }}</strong></div></section>
        <div v-if="!wallet.withdrawal_allowed" class="notice" data-testid="withdrawal-blocked" style="margin-top: 18px">{{ blockedReason(wallet.blocked_reason) }}</div>
        <div class="panel-grid" style="margin-top: 18px">
          <section class="panel"><div class="section-title"><h2>当前收款卡</h2><el-button data-testid="bank-account-open" link type="primary" @click="bankOpen = true">更换银行卡</el-button></div><div v-if="!accounts.length" class="empty-inline" data-testid="bank-accounts-state-empty">尚未绑定收款银行卡</div><div v-for="account in accounts" :key="account.bank_account_id" class="record-line"><span>{{ account.bank_name }} · {{ account.account_holder_masked }}</span><b>{{ account.account_number_masked }}</b></div></section>
          <section class="panel"><div class="section-title"><h2>资金说明</h2></div><div class="record-line"><span>提交提现</span><b>可用减少，冻结增加</b></div><div class="record-line"><span>审核拒绝</span><b>冻结退回可用</b></div><div class="record-line"><span>确认打款</span><b>冻结精确扣减</b></div></section>
        </div>
        <section class="panel">
          <div class="section-title"><h2>提现记录</h2><small>按申请事实查询</small></div>
          <div class="filter-bar"><el-input v-model="withdrawalNo" data-testid="withdrawals-number" clearable placeholder="提现编号" @keyup.enter="page = 1; load()" /><el-select v-model="status" data-testid="withdrawals-status" clearable placeholder="状态"><el-option v-for="(label, value) in statusLabels" :key="value" :label="label" :value="value" /></el-select><el-date-picker v-model="dates" data-testid="withdrawals-dates" end-placeholder="结束日期" range-separator="至" start-placeholder="开始日期" type="daterange" value-format="YYYY-MM-DD" /><div class="copy-row"><el-input v-model="minAmount" data-testid="withdrawals-min-amount" inputmode="decimal" placeholder="最低金额" /><el-input v-model="maxAmount" data-testid="withdrawals-max-amount" inputmode="decimal" placeholder="最高金额" /></div><div class="filter-actions"><el-button type="primary" @click="page = 1; load()">查询</el-button></div></div>
          <div v-if="!withdrawals?.items.length" class="empty-inline" data-testid="withdrawals-state-empty">暂无提现申请</div><template v-else><el-table class="data-table desktop-table" :data="withdrawals.items"><el-table-column label="申请编号" prop="withdrawal_no" min-width="210" /><el-table-column label="金额" min-width="120"><template #default="scope">{{ formatMoney(scope.row.amount) }}</template></el-table-column><el-table-column label="状态" min-width="105"><template #default="scope"><span class="status-pill" :class="{ success: scope.row.status === 'PAID', danger: scope.row.status === 'REJECTED', warning: scope.row.status === 'PENDING' }">{{ statusLabels[scope.row.status] }}</span></template></el-table-column><el-table-column label="收款卡快照" prop="bank_account_masked" min-width="180" /><el-table-column label="申请时间" min-width="175"><template #default="scope">{{ formatChinaDateTime(scope.row.created_at) }}</template></el-table-column><el-table-column fixed="right" label="操作" width="100"><template #default="scope"><el-button link type="primary" :data-testid="`withdrawal-detail-${scope.row.withdrawal_id}`" @click="openDetail(scope.row)">详情</el-button></template></el-table-column></el-table><div class="mobile-list"><button v-for="item in withdrawals.items" :key="item.withdrawal_id" class="mobile-record" :data-testid="`withdrawal-detail-${item.withdrawal_id}`" type="button" @click="openDetail(item)"><span class="record-head"><strong>{{ item.withdrawal_no }}</strong><span class="status-pill">{{ statusLabels[item.status] }}</span></span><span class="record-line"><span>{{ item.bank_account_masked }}</span><b>{{ formatMoney(item.amount) }}</b></span></button></div><div class="pagination-row"><el-pagination v-if="(withdrawals.pagination.total ?? 0) > 20" v-model:current-page="page" :page-size="20" :total="withdrawals.pagination.total" layout="prev, pager, next" @current-change="load" /></div></template>
        </section>
      </template>
    </PageState>
    <BankAccountDialog v-model="bankOpen" @saved="load" />
    <WithdrawalDialog v-if="wallet" v-model="withdrawalOpen" :accounts="accounts" :available-balance="wallet.available_balance" @created="load" />
    <el-drawer v-model="drawerOpen" data-testid="withdrawal-detail" destroy-on-close size="500px" title="提现详情"><PageState testid="withdrawal-detail-state" :error="detailError" :loading="detailLoading" @retry="openDetail({ withdrawal_id: selectedId })"><dl v-if="detail" class="detail-list"><dt>申请编号</dt><dd>{{ detail.withdrawal_no }}</dd><dt>状态</dt><dd>{{ statusLabels[detail.status] }}</dd><dt>金额</dt><dd>{{ formatMoney(detail.amount) }}</dd><dt>银行卡快照</dt><dd>{{ detail.bank_account_masked }}</dd><dt>申请时间</dt><dd>{{ formatChinaDateTime(detail.created_at) }}</dd><dt>审核时间</dt><dd>{{ formatChinaDateTime(detail.reviewed_at) }}</dd><dt>审核说明</dt><dd>{{ detail.review_reason || '暂无' }}</dd><dt>打款时间</dt><dd>{{ formatChinaDateTime(detail.paid_at) }}</dd><dt>付款凭证</dt><dd>{{ detail.proof_file_ids?.length ? `${detail.proof_file_ids.length} 份（由总部保管）` : '暂无' }}</dd></dl></PageState></el-drawer>
  </AgentShell>
</template>
