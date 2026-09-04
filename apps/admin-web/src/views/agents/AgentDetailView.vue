<script setup lang="ts">
import { ArrowLeft, CopyDocument, EditPen, Key, Refresh, SwitchButton } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import HighRiskCommandDialog from '../../components/b13/HighRiskCommandDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import {
  confirmAdminAgentDisable,
  confirmAdminAgentInviteRotation,
  confirmAdminAgentInviteStatus,
  confirmAdminAgentPasswordReset,
  getAdminAgent,
  getAdminAgentProductAuthorization,
  listAdminAgentCommissions,
  listAdminAgentWalletLedger,
  previewAdminAgentDisable,
  previewAdminAgentInviteRotation,
  previewAdminAgentInviteStatus,
  previewAdminAgentPasswordReset,
  reactivateAdminAgent,
  updateAdminAgent,
  updateAdminAgentProductAuthorization,
} from '../../services/admin-agents';
import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import { listAdminProducts } from '../../services/admin-products';
import { authSession } from '../../stores/auth-session';
import type {
  AdminAgentCommissionResult,
  AdminAgentDetail,
  AdminAgentWalletLedgerResult,
  AgentPasswordResetResult,
  HighRiskPreview,
  InviteRotationResult,
  ProductAuthorization,
} from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

type CommandMode = 'DISABLE' | 'INVITE_ROTATE' | 'INVITE_STATUS' | 'PASSWORD_RESET';

const route = useRoute();
const router = useRouter();
const detail = ref<AdminAgentDetail | null>(null);
const authorization = ref<ProductAuthorization | null>(null);
const commissions = ref<AdminAgentCommissionResult | null>(null);
const walletLedger = ref<AdminAgentWalletLedgerResult | null>(null);
const commissionPage = ref(1);
const walletPage = ref(1);
const ledgerPageSize = 20;
const productOptions = ref<Array<{ id: string; label: string }>>([]);
const loading = ref(false);
const errorMessage = ref('');
const editOpen = ref(false);
const authOpen = ref(false);
const commandOpen = ref(false);
const commandMode = ref<CommandMode>('DISABLE');
const saving = ref(false);
const saveError = ref('');
const inviteExpiry = ref('');
const passwordDisclosure = ref<AgentPasswordResetResult | null>(null);
const inviteDisclosure = ref<InviteRotationResult | null>(null);
const editForm = reactive({ clearContactPhone: false, contactName: '', contactPhone: '', name: '' });
const authForm = reactive<{ mode: ProductAuthorization['mode']; productIds: string[] }>({ mode: 'ALL_ACTIVE_PRODUCTS', productIds: [] });
let sequence = 0;
let controller: AbortController | null = null;
let saveController: AbortController | null = null;
let disclosureTimer: ReturnType<typeof setTimeout> | null = null;

const agentId = computed(() => String(route.params.agent_id ?? ''));
const commissionTotalPages = computed(() => Math.max(1, Math.ceil((commissions.value?.pagination.total ?? 0) / ledgerPageSize)));
const walletTotalPages = computed(() => Math.max(1, Math.ceil((walletLedger.value?.pagination.total ?? 0) / ledgerPageSize)));
const editValid = computed(() => {
  const nameLength = Array.from(editForm.name.trim()).length;
  const contactLength = Array.from(editForm.contactName.trim()).length;
  return nameLength >= 1 && nameLength <= 120 && contactLength <= 80 &&
    (editForm.clearContactPhone || editForm.contactPhone.trim() === '' || /^[0-9]{11}$/.test(editForm.contactPhone.trim()));
});
const commandTitle = computed(() => ({
  DISABLE: '停用一级代理',
  INVITE_ROTATE: '轮换推广邀请码',
  INVITE_STATUS: detail.value?.invite_code?.status === 'ACTIVE' ? '停用推广邀请码' : '启用推广邀请码',
  PASSWORD_RESET: '重置代理密码',
})[commandMode.value]);
const commandDescription = computed(() => ({
  DISABLE: '代理将立即停止登录和新归属，既有订单、绑定和佣金事实保持不变。',
  INVITE_ROTATE: '旧邀请码会立即失效，完整新邀请码只在首次响应中展示。',
  INVITE_STATUS: '只改变后续推广绑定资格，不改写已有绑定或历史佣金。',
  PASSWORD_RESET: '现有代理会话会全部撤销，临时密码只在首次响应中展示。',
})[commandMode.value]);

async function listAllActiveProductOptions(signal: AbortSignal): Promise<Array<{ id: string; label: string }>> {
  const options: Array<{ id: string; label: string }> = [];
  let page = 1;
  while (true) {
    const result = await listAdminProducts({ page, pageSize: 100, status: 'ACTIVE' }, signal);
    options.push(...result.items.map((item) => ({
      id: item.product.product_id,
      label: `${item.product.spu_code} · ${item.product.name}`,
    })));
    if (options.length >= result.pagination.total || result.items.length === 0) return options;
    page += 1;
  }
}

function readableError(error: unknown): string {
  if (!(error instanceof AdminApiError)) return '代理详情加载失败，请稍后重试';
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  if (error.status === 400) return '代理标识无效';
  if (error.status === 403) return '当前账号无权查看该代理';
  if (error.status === 404) return '代理不存在或已不可访问';
  return '代理详情加载失败，请稍后重试';
}

async function handleExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  controller?.abort();
  saveController?.abort();
  closeSensitive();
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
    const [agent, productAuth, commissionResult, walletResult, products] = await Promise.all([
      getAdminAgent(agentId.value, current.signal),
      getAdminAgentProductAuthorization(agentId.value, current.signal),
      listAdminAgentCommissions(agentId.value, { page: commissionPage.value, pageSize: ledgerPageSize }, current.signal),
      listAdminAgentWalletLedger(agentId.value, { page: walletPage.value, pageSize: ledgerPageSize }, current.signal),
      listAllActiveProductOptions(current.signal),
    ]);
    if (currentSequence !== sequence) return;
    detail.value = agent;
    authorization.value = productAuth;
    commissions.value = commissionResult;
    walletLedger.value = walletResult;
    commissionPage.value = commissionResult.pagination.page;
    walletPage.value = walletResult.pagination.page;
    productOptions.value = products;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleExpired(error)) return;
    detail.value = null;
    authorization.value = null;
    commissions.value = null;
    walletLedger.value = null;
    errorMessage.value = readableError(error);
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function openEdit(): void {
  const value = detail.value?.agent;
  if (!value) return;
  editForm.name = value.name;
  editForm.contactName = value.contact_name ?? '';
  editForm.contactPhone = '';
  editForm.clearContactPhone = false;
  saveError.value = '';
  editOpen.value = true;
}

function openAuthorization(): void {
  if (!authorization.value) return;
  authForm.mode = authorization.value.mode;
  authForm.productIds = [...authorization.value.product_ids];
  saveError.value = '';
  authOpen.value = true;
}

async function saveEdit(): Promise<void> {
  if (saving.value || !detail.value || !editValid.value) return;
  saving.value = true;
  saveError.value = '';
  const current = new AbortController();
  saveController = current;
  try {
    await updateAdminAgent(agentId.value, {
      contact_name: editForm.contactName.trim() || null,
      ...(editForm.clearContactPhone
        ? { contact_phone: null }
        : editForm.contactPhone.trim() ? { contact_phone: editForm.contactPhone.trim() } : {}),
      name: editForm.name.trim(),
    }, detail.value.agent.version, newIdempotencyKey(), current.signal);
    editOpen.value = false;
    ElMessage.success('代理资料已更新');
    await load();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (await handleExpired(error)) return;
    saveError.value = error instanceof AdminApiError && error.status === 409 ? '代理版本已变化，请刷新后重试' : '资料更新未完成';
  } finally {
    if (saveController === current) saveController = null;
    saving.value = false;
  }
}

async function saveAuthorization(): Promise<void> {
  if (saving.value || !authorization.value) return;
  saving.value = true;
  saveError.value = '';
  const current = new AbortController();
  saveController = current;
  try {
    authorization.value = await updateAdminAgentProductAuthorization(agentId.value, {
      mode: authForm.mode,
      product_ids: authForm.mode === 'CUSTOM_WHITELIST' ? [...authForm.productIds] : [],
    }, authorization.value.version, newIdempotencyKey(), current.signal);
    authOpen.value = false;
    ElMessage.success('商品授权已更新');
    await load();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (await handleExpired(error)) return;
    saveError.value = error instanceof AdminApiError && error.status === 409 ? '授权版本已变化，请刷新后重试' : '商品授权更新未完成';
  } finally {
    if (saveController === current) saveController = null;
    saving.value = false;
  }
}

function changeCommissionPage(next: number): void {
  commissionPage.value = next;
  void load();
}

function changeWalletPage(next: number): void {
  walletPage.value = next;
  void load();
}

function openCommand(mode: CommandMode): void {
  commandMode.value = mode;
  inviteExpiry.value = '';
  commandOpen.value = true;
}

function expiry(): string | null {
  return inviteExpiry.value ? new Date(inviteExpiry.value).toISOString() : null;
}

function previewCommand(reason: string, key: string, signal: AbortSignal): Promise<HighRiskPreview> {
  if (commandMode.value === 'DISABLE') {
    return previewAdminAgentDisable(agentId.value, { reason, target_status: 'DISABLED' }, key, signal);
  }
  if (commandMode.value === 'PASSWORD_RESET') {
    return previewAdminAgentPasswordReset(agentId.value, { reason }, key, signal);
  }
  if (commandMode.value === 'INVITE_ROTATE') {
    return previewAdminAgentInviteRotation(agentId.value, { expires_at: expiry(), reason }, key, signal);
  }
  const status = detail.value?.invite_code?.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  return previewAdminAgentInviteStatus(agentId.value, { expires_at: expiry(), reason, status }, key, signal);
}

function confirmCommand(reason: string, preview: HighRiskPreview, key: string, signal: AbortSignal): Promise<unknown> {
  if (commandMode.value === 'DISABLE') {
    return confirmAdminAgentDisable(agentId.value, { reason, target_status: 'DISABLED' }, preview, key, signal);
  }
  if (commandMode.value === 'PASSWORD_RESET') {
    return confirmAdminAgentPasswordReset(agentId.value, { reason }, preview, key, signal);
  }
  if (commandMode.value === 'INVITE_ROTATE') {
    return confirmAdminAgentInviteRotation(agentId.value, { expires_at: expiry(), reason }, preview, key, signal);
  }
  const status = detail.value?.invite_code?.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
  return confirmAdminAgentInviteStatus(agentId.value, { expires_at: expiry(), reason, status }, preview, key, signal);
}

function armDisclosureTimer(expiresAt: string | null): void {
  if (disclosureTimer !== null) clearTimeout(disclosureTimer);
  const disclosureDeadline = Date.now() + 10 * 60_000;
  const businessDeadline = expiresAt ? Date.parse(expiresAt) : disclosureDeadline;
  disclosureTimer = setTimeout(closeSensitive, Math.max(0, Math.min(disclosureDeadline, businessDeadline) - Date.now()));
}

async function commandCompleted(result: unknown): Promise<void> {
  if (commandMode.value === 'PASSWORD_RESET') {
    passwordDisclosure.value = result as AgentPasswordResetResult;
    armDisclosureTimer(passwordDisclosure.value.expires_at);
  } else if (commandMode.value === 'INVITE_ROTATE') {
    inviteDisclosure.value = result as InviteRotationResult;
    armDisclosureTimer(inviteDisclosure.value.new_invite_code?.expires_at ?? null);
  } else {
    ElMessage.success('代理状态已更新');
  }
  await load();
}

async function commandConflict(): Promise<void> {
  commandOpen.value = false;
  await load();
  ElMessage.warning('代理状态或版本已变化，已刷新最新投影');
}

async function reactivate(): Promise<void> {
  if (!detail.value) return;
  try {
    await ElMessageBox.confirm('恢复登录与后续经营能力，历史事实保持不变。', '重新启用代理', { type: 'warning' });
  } catch { return; }
  try {
    await reactivateAdminAgent(agentId.value, detail.value.agent.version, newIdempotencyKey());
    ElMessage.success('代理已重新启用');
    await load();
  } catch (error) {
    if (await handleExpired(error)) return;
    ElMessage.error(error instanceof AdminApiError && error.status === 409 ? '代理版本已变化，已刷新' : '重新启用未完成');
    await load();
  }
}

function closeSensitive(): void {
  if (disclosureTimer !== null) clearTimeout(disclosureTimer);
  disclosureTimer = null;
  passwordDisclosure.value = null;
  inviteDisclosure.value = null;
  inviteExpiry.value = '';
}

async function copySecret(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
  ElMessage.success('已复制，请通过受控渠道交接');
}

async function authExpired(error: AdminApiError): Promise<void> { await handleExpired(error); }

watch(agentId, () => {
  commandOpen.value = false;
  closeSensitive();
  detail.value = null;
  commissionPage.value = 1;
  walletPage.value = 1;
  void load();
}, { immediate: true });
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
  saveController?.abort();
  commandOpen.value = false;
  closeSensitive();
});
</script>

<template>
  <AdminShell>
    <div class="agent-detail" data-testid="admin-agent-detail-page">
      <section class="detail-heading">
        <div><el-button text @click="router.push('/agents')"><el-icon><ArrowLeft /></el-icon>返回代理列表</el-button><p>代理经营 · ADM-19</p><h1>{{ detail?.agent.name || '代理详情' }}</h1><span v-if="detail">{{ detail.agent.agent_no }} · 版本 {{ detail.agent.version }}</span></div>
        <div class="heading-actions"><el-button :loading="loading" :disabled="commandOpen" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button><el-button v-if="detail?.agent.status === 'ACTIVE'" type="danger" plain @click="openCommand('DISABLE')"><el-icon><SwitchButton /></el-icon>停用</el-button><el-button v-else-if="detail" type="primary" @click="reactivate">重新启用</el-button></div>
      </section>
      <div v-if="loading" class="detail-state"><el-skeleton :rows="11" animated /></div>
      <div v-else-if="errorMessage" class="detail-state centered"><strong>{{ errorMessage }}</strong><el-button type="primary" @click="load">重新加载</el-button></div>
      <template v-else-if="detail">
        <section class="agent-overview">
          <div><small>代理状态</small><strong>{{ detail.agent.status === 'ACTIVE' ? '正常经营' : '已停用' }}</strong><span>{{ detail.agent.contact_name ?? '未设置联系人' }} · 尾号 {{ detail.agent.contact_phone_tail ?? '无' }}</span></div>
          <div><small>净销售额</small><strong>¥{{ detail.operating_summary.net_sales_amount }}</strong><span>{{ detail.operating_summary.paid_order_count }} 笔支付订单</span></div>
          <div><small>活跃客户</small><strong>{{ detail.operating_summary.active_customer_count }}</strong><span>新增绑定 {{ detail.operating_summary.new_binding_count }}</span></div>
          <div><small>可用 / 冻结</small><strong>¥{{ detail.wallet_summary.available_balance }}</strong><span>冻结 ¥{{ detail.wallet_summary.frozen_balance }}</span></div>
        </section>

        <section class="agent-toolbar">
          <div><el-button @click="openEdit"><el-icon><EditPen /></el-icon>编辑资料</el-button><el-button @click="openAuthorization">商品授权</el-button><el-button @click="openCommand('PASSWORD_RESET')"><el-icon><Key /></el-icon>重置密码</el-button></div>
          <div><RouterLink :to="{ path: '/customers', query: { agent_id: agentId } }">客户下钻</RouterLink><RouterLink :to="{ path: '/orders', query: { agent_id: agentId } }">订单下钻</RouterLink><RouterLink :to="{ path: '/withdrawals', query: { agent_id: agentId } }">提现下钻</RouterLink><RouterLink :to="{ path: '/audit-logs', query: { target_type: 'agent', target_id: agentId } }">审计下钻</RouterLink></div>
        </section>

        <section class="agent-grid">
          <article class="agent-panel invite-panel"><header><div><p>推广入口</p><h2>邀请码</h2></div><el-tag :type="detail.invite_code?.status === 'ACTIVE' ? 'success' : 'info'">{{ detail.invite_code?.status ?? '未签发' }}</el-tag></header><template v-if="detail.invite_code"><strong class="masked-code">{{ detail.invite_code.code_masked }}</strong><span>{{ detail.invite_code.expires_at ? `有效至 ${formatChinaDateTime(detail.invite_code.expires_at)}` : '长期有效' }}</span><div><el-button @click="openCommand('INVITE_ROTATE')">轮换邀请码</el-button><el-button @click="openCommand('INVITE_STATUS')">{{ detail.invite_code.status === 'ACTIVE' ? '停用' : '启用' }}</el-button></div></template><el-empty v-else description="暂无邀请码" :image-size="54" /></article>
          <article class="agent-panel"><header><div><p>提现概览</p><h2>资金审核</h2></div></header><dl><dt>待审核</dt><dd>{{ detail.withdrawal_summary.pending_count }}</dd><dt>已批准</dt><dd>{{ detail.withdrawal_summary.approved_count }}</dd><dt>累计已付</dt><dd>¥{{ detail.withdrawal_summary.total_paid_amount }}</dd></dl><el-button link type="primary" @click="router.push({ path: '/withdrawals', query: { agent_id: agentId } })">查看代理提现</el-button></article>
        </section>

        <section class="agent-panel wide"><header><div><p>佣金事实</p><h2>佣金流水</h2></div><el-tag effect="plain">{{ commissions?.pagination.total ?? 0 }} 条</el-tag></header><el-empty v-if="!commissions?.items.length" description="暂无佣金流水" :image-size="54" /><div v-else class="table-scroll"><el-table :data="commissions.items"><el-table-column prop="order_no" label="订单" min-width="170" /><el-table-column prop="sku_name" label="SKU" min-width="150" /><el-table-column prop="rule_source" label="规则来源" min-width="110" /><el-table-column label="有效比例" width="100"><template #default="scope">{{ scope.row.effective_rate }}%</template></el-table-column><el-table-column label="佣金变化" width="115"><template #default="scope">¥{{ scope.row.available_change }}</template></el-table-column><el-table-column label="发生时间" min-width="170"><template #default="scope">{{ formatChinaDateTime(scope.row.occurred_at) }}</template></el-table-column></el-table></div><footer v-if="(commissions?.pagination.total ?? 0) > ledgerPageSize" class="ledger-pagination" data-testid="agent-commission-pagination"><span>第 {{ commissionPage }} / {{ commissionTotalPages }} 页</span><el-pagination small layout="prev, pager, next" :page-size="ledgerPageSize" :total="commissions?.pagination.total ?? 0" :current-page="commissionPage" @current-change="changeCommissionPage" /></footer></section>
        <section class="agent-panel wide"><header><div><p>钱包事实</p><h2>钱包流水</h2></div><el-tag effect="plain">{{ walletLedger?.pagination.total ?? 0 }} 条</el-tag></header><el-empty v-if="!walletLedger?.items.length" description="暂无钱包流水" :image-size="54" /><div v-else class="table-scroll"><el-table :data="walletLedger.items"><el-table-column prop="ledger_type" label="类型" min-width="170" /><el-table-column label="可用变化" width="110"><template #default="scope">¥{{ scope.row.available_change }}</template></el-table-column><el-table-column label="冻结变化" width="110"><template #default="scope">¥{{ scope.row.frozen_change }}</template></el-table-column><el-table-column prop="reference_type" label="关联事实" min-width="130" /><el-table-column label="发生时间" min-width="170"><template #default="scope">{{ formatChinaDateTime(scope.row.occurred_at) }}</template></el-table-column></el-table></div><footer v-if="(walletLedger?.pagination.total ?? 0) > ledgerPageSize" class="ledger-pagination" data-testid="agent-wallet-pagination"><span>第 {{ walletPage }} / {{ walletTotalPages }} 页</span><el-pagination small layout="prev, pager, next" :page-size="ledgerPageSize" :total="walletLedger?.pagination.total ?? 0" :current-page="walletPage" @current-change="changeWalletPage" /></footer></section>
      </template>
    </div>

    <el-dialog v-model="editOpen" title="编辑代理资料" width="min(520px, calc(100vw - 28px))" destroy-on-close><el-form label-position="top"><el-form-item label="代理名称"><el-input v-model="editForm.name" maxlength="120" /></el-form-item><el-form-item label="联系人"><el-input v-model="editForm.contactName" maxlength="80" /></el-form-item><el-form-item label="更新联系电话（留空保持原值）" :error="!editForm.clearContactPhone && editForm.contactPhone && !/^[0-9]{11}$/.test(editForm.contactPhone.trim()) ? '请输入 11 位数字' : ''"><el-input v-model="editForm.contactPhone" maxlength="11" inputmode="numeric" autocomplete="off" :disabled="editForm.clearContactPhone" /></el-form-item><el-checkbox v-model="editForm.clearContactPhone">清除现有联系电话</el-checkbox><p v-if="saveError" class="inline-error">{{ saveError }}</p></el-form><template #footer><el-button :disabled="saving" @click="editOpen = false">取消</el-button><el-button type="primary" :loading="saving" :disabled="!editValid" @click="saveEdit">保存</el-button></template></el-dialog>

    <el-dialog v-model="authOpen" title="商品授权" width="min(620px, calc(100vw - 28px))" destroy-on-close><el-form label-position="top"><el-form-item label="授权模式"><el-segmented v-model="authForm.mode" :options="[{ label: '全部在售商品', value: 'ALL_ACTIVE_PRODUCTS' }, { label: '指定商品白名单', value: 'CUSTOM_WHITELIST' }]" /></el-form-item><el-form-item v-if="authForm.mode === 'CUSTOM_WHITELIST'" label="授权商品"><el-select v-model="authForm.productIds" multiple filterable collapse-tags placeholder="选择当前在售商品"><el-option v-for="product in productOptions" :key="product.id" :label="product.label" :value="product.id" /></el-select></el-form-item><p v-if="saveError" class="inline-error">{{ saveError }}</p></el-form><template #footer><el-button :disabled="saving" @click="authOpen = false">取消</el-button><el-button type="primary" :loading="saving" @click="saveAuthorization">保存授权</el-button></template></el-dialog>

    <HighRiskCommandDialog v-model:open="commandOpen" :title="commandTitle" :description="commandDescription" :danger="commandMode === 'DISABLE'" :confirm-label="commandMode === 'DISABLE' ? '确认停用' : '确认执行'" :preview-command="previewCommand" :confirm-command="confirmCommand" @completed="commandCompleted" @conflict="commandConflict" @auth-expired="authExpired">
      <template v-if="commandMode === 'INVITE_ROTATE' || commandMode === 'INVITE_STATUS'" #default="{ locked }">
        <el-form label-position="top" class="dialog-form">
          <el-form-item label="邀请码有效期（可选）">
            <el-date-picker v-model="inviteExpiry" type="datetime" value-format="YYYY-MM-DDTHH:mm:ssZ" placeholder="长期有效" :disabled="locked" />
          </el-form-item>
        </el-form>
      </template>
    </HighRiskCommandDialog>

    <el-dialog :model-value="passwordDisclosure !== null || inviteDisclosure !== null" title="一次性凭据交接" width="min(560px, calc(100vw - 28px))" :close-on-click-modal="false" destroy-on-close @close="closeSensitive"><el-alert v-if="passwordDisclosure?.disclosure_state === 'REPLAY_REDACTED' || inviteDisclosure?.disclosure_state === 'REPLAY_REDACTED'" title="请求已被幂等重放，秘密不会再次披露；如仍需凭据，请重新签发。" type="info" :closable="false" show-icon /><div v-else class="secret-box"><el-alert title="仅本次展示；关闭、离页或到期后立即清除。" type="warning" :closable="false" show-icon /><div v-if="passwordDisclosure?.temporary_password"><span>临时密码</span><code>{{ passwordDisclosure.temporary_password }}</code><el-button :icon="CopyDocument" @click="copySecret(passwordDisclosure.temporary_password)">复制</el-button></div><div v-if="inviteDisclosure?.new_invite_code"><span>新邀请码</span><code>{{ inviteDisclosure.new_invite_code.code }}</code><el-button :icon="CopyDocument" @click="copySecret(inviteDisclosure.new_invite_code.code)">复制</el-button></div></div><template #footer><el-button type="primary" @click="closeSensitive">已完成交接并清除</el-button></template></el-dialog>
  </AdminShell>
</template>

<style scoped>
.agent-detail { display: grid; gap: 18px; }
.heading-actions, .agent-toolbar, .agent-toolbar > div, .invite-panel > div { display: flex; flex-wrap: wrap; gap: 8px; }
.agent-overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); border: 1px solid var(--admin-border); background: #fff; }
.agent-overview > div { display: grid; gap: 5px; padding: 18px; border-right: 1px solid var(--admin-border); }
.agent-overview > div:last-child { border-right: 0; }
.agent-overview small, .agent-overview span, .agent-panel > span { color: var(--admin-muted); font-size: 11px; }
.agent-overview strong { font-size: 19px; }
.agent-toolbar { justify-content: space-between; padding: 14px; border-left: 3px solid var(--admin-brand); background: #fff; }
.agent-toolbar a { padding: 8px 4px; color: var(--admin-brand); font-size: 12px; font-weight: 700; }
.agent-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.agent-panel { min-width: 0; padding: 18px; border-top: 1px solid var(--admin-border); background: #fff; }
.agent-panel > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.agent-panel p { margin: 0; color: var(--admin-brand); font-size: 11px; font-weight: 700; }
.agent-panel h2 { margin: 4px 0 0; font-size: 17px; }
.masked-code { display: block; margin: 10px 0 4px; font-family: ui-monospace, monospace; font-size: 22px; }
.agent-panel dl { display: grid; grid-template-columns: 1fr auto; gap: 10px; }
.agent-panel dt { color: var(--admin-muted); font-size: 12px; }
.agent-panel dd { margin: 0; font-weight: 700; }
.table-scroll { overflow-x: auto; }
.ledger-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 14px; color: var(--admin-muted); font-size: 12px; }
.secret-box { display: grid; gap: 14px; }
.secret-box > div { display: grid; grid-template-columns: 90px minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 12px; border: 1px solid var(--admin-border); }
.secret-box code { overflow-wrap: anywhere; }
@media (max-width: 900px) { .agent-overview { grid-template-columns: repeat(2, minmax(0, 1fr)); } .agent-overview > div:nth-child(2) { border-right: 0; } .agent-grid { grid-template-columns: 1fr; } }
@media (max-width: 600px) { .agent-overview { grid-template-columns: 1fr; } .agent-overview > div { border-right: 0; border-bottom: 1px solid var(--admin-border); } .agent-toolbar { flex-direction: column; } .secret-box > div { grid-template-columns: 1fr auto; } .secret-box span { grid-column: 1 / -1; } }
</style>
