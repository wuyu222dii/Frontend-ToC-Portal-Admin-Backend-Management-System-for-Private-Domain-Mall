<script setup lang="ts">
import { ArrowLeft, Refresh, Right } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import HighRiskCommandDialog from '../../components/b13/HighRiskCommandDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { listAdminAgents } from '../../services/admin-agents';
import { AdminApiError } from '../../services/admin-api';
import {
  confirmAdminCustomerTransfer,
  getAdminCustomer,
  previewAdminCustomerTransfer,
} from '../../services/admin-customers';
import { authSession } from '../../stores/auth-session';
import type { AdminAgentListItem, AdminCustomerDetail, CustomerTransferInput, HighRiskPreview } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

const route = useRoute();
const router = useRouter();
const detail = ref<AdminCustomerDetail | null>(null);
const agents = ref<AdminAgentListItem[]>([]);
const loading = ref(false);
const errorMessage = ref('');
const transferOpen = ref(false);
const targetAgentId = ref<string | null>(null);
let sequence = 0;
let controller: AbortController | null = null;

const customerId = computed(() => String(route.params.customer_id ?? ''));
const currentAgent = computed(() => detail.value?.customer.binding?.agent_id ?? null);

async function listAllActiveAgents(signal: AbortSignal): Promise<AdminAgentListItem[]> {
  const items: AdminAgentListItem[] = [];
  let page = 1;
  while (true) {
    const result = await listAdminAgents({ page, pageSize: 100, status: 'ACTIVE' }, signal);
    items.push(...result.items);
    if (items.length >= result.pagination.total || result.items.length === 0) return items;
    page += 1;
  }
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '客户详情加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 400) return '客户标识无效';
  if (error.status === 403) return '当前账号无权查看该客户';
  if (error.status === 404) return '客户不存在或已不可访问';
  return '客户详情加载失败，请稍后重试';
}

async function handleExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  controller?.abort();
  transferOpen.value = false;
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
    const [customer, activeAgents] = await Promise.all([
      getAdminCustomer(customerId.value, current.signal),
      listAllActiveAgents(current.signal),
    ]);
    if (currentSequence !== sequence) return;
    detail.value = customer;
    agents.value = activeAgents.filter((agent) => agent.agent_id !== currentAgent.value);
    targetAgentId.value = customer.customer.binding?.agent_id ?? null;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleExpired(error)) return;
    detail.value = null;
    agents.value = [];
    errorMessage.value = readableError(error);
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function transferInput(reason: string): CustomerTransferInput {
  return { reason, target_agent_id: targetAgentId.value };
}

function previewTransfer(reason: string, key: string, signal: AbortSignal): Promise<HighRiskPreview> {
  return previewAdminCustomerTransfer(customerId.value, transferInput(reason), key, signal);
}

function confirmTransfer(
  reason: string,
  preview: HighRiskPreview,
  key: string,
  signal: AbortSignal,
): Promise<unknown> {
  return confirmAdminCustomerTransfer(customerId.value, transferInput(reason), preview, key, signal);
}

async function completed(): Promise<void> {
  ElMessage.success(targetAgentId.value ? '客户未来订单归属已转移' : '客户已转为总部直营');
  await load();
}

async function conflict(): Promise<void> {
  transferOpen.value = false;
  await load();
  ElMessage.warning('客户归属版本已变化，已刷新最新状态');
}

async function authExpired(error: AdminApiError): Promise<void> {
  await handleExpired(error);
}

watch(customerId, () => {
  transferOpen.value = false;
  detail.value = null;
  void load();
}, { immediate: true });
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
  transferOpen.value = false;
});
</script>

<template>
  <AdminShell>
    <div class="customer-detail" data-testid="admin-customer-detail-page">
      <section class="detail-heading">
        <div>
          <el-button text @click="router.push('/customers')"><el-icon><ArrowLeft /></el-icon>返回客户列表</el-button>
          <p>客户经营 · ADM-15</p>
          <h1>{{ detail?.customer.customer_alias || '客户详情' }}</h1>
          <span v-if="detail">客户版本 {{ detail.customer.version }} · 历史订单快照不会随当前归属改变</span>
        </div>
        <el-button :loading="loading" :disabled="transferOpen" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button>
      </section>

      <div v-if="loading" class="detail-state"><el-skeleton :rows="10" animated /></div>
      <div v-else-if="errorMessage" class="detail-state centered"><strong>{{ errorMessage }}</strong><el-button type="primary" @click="load">重新加载</el-button></div>
      <template v-else-if="detail">
        <section class="customer-summary">
          <div><small>掩码账户</small><strong>{{ detail.customer.nickname_masked ?? '未设置昵称' }}</strong><span>{{ detail.customer.phone_masked ?? '无手机号' }} · {{ detail.customer.city ?? '城市未知' }}</span></div>
          <div><small>累计消费</small><strong>¥{{ detail.customer.consumption_amount }}</strong><span>{{ detail.customer.consumption_count }} 笔订单</span></div>
          <div><small>当前归属</small><strong>{{ detail.customer.binding?.agent_name ?? '总部直营' }}</strong><span>{{ detail.customer.binding ? `绑定于 ${formatChinaDateTime(detail.customer.binding.started_at)}` : '后续订单不计代理佣金' }}</span></div>
        </section>

        <section class="attribution-command">
          <div>
            <p>未来订单归属</p>
            <h2>转移代理或转为直营</h2>
            <span>仅影响确认后的新订单；既有订单、佣金与绑定历史保持不变。</span>
          </div>
          <div class="attribution-controls">
            <el-select v-model="targetAgentId" clearable placeholder="总部直营" filterable>
              <el-option label="总部直营" :value="null" />
              <el-option v-for="agent in agents" :key="agent.agent_id" :label="`${agent.agent_no} · ${agent.name}`" :value="agent.agent_id" />
            </el-select>
            <el-button type="primary" :disabled="targetAgentId === currentAgent" data-testid="customer-transfer-open" @click="transferOpen = true">预览变更<el-icon><Right /></el-icon></el-button>
          </div>
        </section>

        <section class="detail-section">
          <header><div><p>历史支付快照</p><h2>客户订单</h2></div><el-tag effect="plain">{{ detail.orders.length }} 笔</el-tag></header>
          <el-empty v-if="detail.orders.length === 0" description="暂无订单" />
          <div v-else class="detail-table-wrap">
            <el-table :data="detail.orders">
              <el-table-column prop="order_no" label="订单号" min-width="190" />
              <el-table-column prop="display_status" label="状态" min-width="120" />
              <el-table-column prop="payable_amount" label="应付金额" min-width="120"><template #default="scope">¥{{ scope.row.payable_amount }}</template></el-table-column>
              <el-table-column label="支付时间" min-width="170"><template #default="scope">{{ scope.row.paid_at ? formatChinaDateTime(scope.row.paid_at) : '未支付' }}</template></el-table-column>
              <el-table-column label="操作" width="90"><template #default="scope"><el-button link type="primary" @click="router.push(`/orders/${scope.row.order_id}`)">查看</el-button></template></el-table-column>
            </el-table>
          </div>
        </section>

        <section class="detail-section">
          <header><div><p>不可变记录</p><h2>归属历史</h2></div></header>
          <el-empty v-if="detail.binding_history.length === 0" description="暂无代理归属历史" />
          <div v-else class="history-list">
            <article v-for="binding in detail.binding_history" :key="binding.binding_id">
              <div><strong>{{ binding.agent_name ?? '总部直营' }}</strong><span>{{ binding.started_at ? formatChinaDateTime(binding.started_at) : '-' }} 至 {{ binding.ended_at ? formatChinaDateTime(binding.ended_at) : '当前' }}</span></div>
              <p>{{ binding.change_reason ?? binding.end_reason ?? '首次自然绑定' }}</p>
            </article>
          </div>
        </section>
      </template>
    </div>

    <HighRiskCommandDialog
      v-model:open="transferOpen"
      title="确认客户归属变更"
      :description="targetAgentId ? '客户将转移到所选一级代理，变更只作用于未来订单。' : '客户将转为总部直营，变更只作用于未来订单。'"
      confirm-label="确认变更归属"
      :preview-command="previewTransfer"
      :confirm-command="confirmTransfer"
      @completed="completed"
      @conflict="conflict"
      @auth-expired="authExpired"
    />
  </AdminShell>
</template>

<style scoped>
.customer-detail { display: grid; gap: 18px; }
.customer-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--admin-border); background: #fff; }
.customer-summary > div { display: grid; gap: 6px; padding: 20px; border-right: 1px solid var(--admin-border); }
.customer-summary > div:last-child { border-right: 0; }
.customer-summary small, .customer-summary span, .attribution-command span, .history-list span { color: var(--admin-muted); font-size: 12px; }
.customer-summary strong { font-size: 19px; }
.attribution-command { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px; border-left: 3px solid var(--admin-brand); background: #fff; }
.attribution-command p, .detail-section header p { margin: 0; color: var(--admin-brand); font-size: 11px; font-weight: 700; }
.attribution-command h2, .detail-section h2 { margin: 5px 0; font-size: 18px; }
.attribution-controls { display: flex; width: min(100%, 480px); gap: 10px; }
.attribution-controls .el-select { flex: 1; }
.detail-section { min-width: 0; background: #fff; border-top: 1px solid var(--admin-border); }
.detail-section > header { display: flex; min-height: 66px; align-items: center; justify-content: space-between; padding: 0 18px; border-bottom: 1px solid var(--admin-border); }
.detail-table-wrap { overflow-x: auto; }
.history-list { display: grid; }
.history-list article { display: flex; justify-content: space-between; gap: 16px; padding: 15px 18px; border-bottom: 1px solid var(--admin-border); }
.history-list article div { display: grid; gap: 4px; }
.history-list p { margin: 0; color: var(--admin-text-soft); font-size: 12px; }
@media (max-width: 760px) { .customer-summary { grid-template-columns: 1fr; } .customer-summary > div { border-right: 0; border-bottom: 1px solid var(--admin-border); } .attribution-command { align-items: stretch; flex-direction: column; } .attribution-controls { flex-direction: column; } .history-list article { flex-direction: column; } }
</style>
