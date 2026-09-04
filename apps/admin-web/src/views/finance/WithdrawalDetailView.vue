<script setup lang="ts">
import { ArrowLeft, CopyDocument, Refresh, Upload } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import HighRiskCommandDialog from '../../components/b13/HighRiskCommandDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import { AdminApiError, newIdempotencyKey } from '../../services/admin-api';
import { uploadAdminImage } from '../../services/admin-files';
import {
  attachAdminWithdrawalProofs,
  confirmAdminWithdrawalApproval,
  confirmAdminWithdrawalPaid,
  confirmAdminWithdrawalRejection,
  getAdminWithdrawal,
  previewAdminWithdrawalApproval,
  previewAdminWithdrawalPaid,
  previewAdminWithdrawalRejection,
  reauthAdminPayoutAccount,
  revealAdminPayoutAccount,
} from '../../services/admin-withdrawals';
import { authSession } from '../../stores/auth-session';
import type { AdminWithdrawal, HighRiskPreview, PayoutAccountReveal } from '../../types/admin-b13';
import { formatChinaDateTime } from '../../utils/time';

type CommandMode = 'APPROVE' | 'PAID' | 'REJECT';
type ProofAttachAttempt = { fileId: string; idempotencyKey: string };
const route = useRoute();
const router = useRouter();
const detail = ref<AdminWithdrawal | null>(null);
const loading = ref(false);
const errorMessage = ref('');
const commandOpen = ref(false);
const commandMode = ref<CommandMode>('APPROVE');
const uploading = ref(false);
const reauthOpen = ref(false);
const reauthPending = ref(false);
const reauthError = ref('');
const totpCode = ref('');
const payout = ref<PayoutAccountReveal | null>(null);
const proofAttachAttempt = ref<ProofAttachAttempt | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
let sequence = 0;
let controller: AbortController | null = null;
let commandController: AbortController | null = null;
let reauthController: AbortController | null = null;
let reauthSequence = 0;
let payoutTimer: ReturnType<typeof setTimeout> | null = null;

const withdrawalId = computed(() => String(route.params.withdrawal_id ?? ''));
const commandTitle = computed(() => ({ APPROVE: '批准提现申请', PAID: '标记提现已付款', REJECT: '拒绝提现申请' })[commandMode.value]);
const commandDescription = computed(() => ({
  APPROVE: '批准后冻结金额保持不变，申请进入待付款状态。',
  PAID: '凭证齐全后精确扣减冻结余额；这是不可逆资金确认。',
  REJECT: '拒绝后冻结金额会原样解冻回代理可用余额。',
})[commandMode.value]);

function clearPayout(): void {
  if (payoutTimer !== null) clearTimeout(payoutTimer);
  payoutTimer = null;
  payout.value = null;
  totpCode.value = '';
  reauthError.value = '';
}

function closeReauth(): void {
  ++reauthSequence;
  reauthController?.abort();
  reauthController = null;
  reauthPending.value = false;
  reauthOpen.value = false;
  clearPayout();
}

async function handleExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  ++sequence;
  controller?.abort();
  commandController?.abort();
  commandOpen.value = false;
  closeReauth();
  proofAttachAttempt.value = null;
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
  clearPayout();
  try {
    const result = await getAdminWithdrawal(withdrawalId.value, current.signal);
    if (currentSequence !== sequence) return;
    detail.value = result;
    if (proofAttachAttempt.value && result.proof_file_ids.includes(proofAttachAttempt.value.fileId)) {
      proofAttachAttempt.value = null;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    if (currentSequence !== sequence || await handleExpired(error)) return;
    detail.value = null;
    errorMessage.value = error instanceof AdminApiError && error.status === 404
      ? '提现申请不存在或已不可访问'
      : error instanceof AdminApiError && error.status === 403
        ? '当前账号无权查看该提现申请'
        : error instanceof AdminApiError && error.status === 0
          ? '网络连接失败，请检查网络后重试'
          : '提现详情加载失败，请稍后重试';
  } finally {
    if (currentSequence === sequence) {
      loading.value = false;
      controller = null;
    }
  }
}

function openCommand(mode: CommandMode): void {
  if (mode === 'PAID' && !detail.value?.proof_file_ids.length) return;
  commandMode.value = mode;
  commandOpen.value = true;
}

function paidProofFileIds(): string[] {
  return detail.value?.proof_file_ids ?? [];
}

function previewCommand(reason: string, key: string, signal: AbortSignal): Promise<HighRiskPreview> {
  if (commandMode.value === 'APPROVE') return previewAdminWithdrawalApproval(withdrawalId.value, key, signal);
  if (commandMode.value === 'REJECT') return previewAdminWithdrawalRejection(withdrawalId.value, { reason }, key, signal);
  return previewAdminWithdrawalPaid(withdrawalId.value, { proof_file_ids: paidProofFileIds() }, key, signal);
}

async function confirmCommand(reason: string, preview: HighRiskPreview, key: string, signal: AbortSignal): Promise<unknown> {
  if (commandMode.value === 'APPROVE') return confirmAdminWithdrawalApproval(withdrawalId.value, preview, key, signal);
  if (commandMode.value === 'REJECT') return confirmAdminWithdrawalRejection(withdrawalId.value, { reason }, preview, key, signal);
  return confirmAdminWithdrawalPaid(withdrawalId.value, { proof_file_ids: paidProofFileIds() }, preview, key, signal);
}

async function commandCompleted(): Promise<void> {
  ElMessage.success(commandMode.value === 'APPROVE' ? '提现申请已批准' : commandMode.value === 'REJECT' ? '提现申请已拒绝并解冻余额' : '提现已标记付款');
  await load();
}

async function commandConflict(): Promise<void> {
  commandOpen.value = false;
  await load();
  ElMessage.warning('提现状态或版本已变化，已刷新最新投影');
}

function chooseProof(): void {
  if (!uploading.value && proofAttachAttempt.value === null) fileInput.value?.click();
}

async function attachPendingProof(signal: AbortSignal): Promise<void> {
  const attempt = proofAttachAttempt.value;
  if (!attempt) return;
  const targetWithdrawalId = withdrawalId.value;
  const result = await attachAdminWithdrawalProofs(
    targetWithdrawalId,
    { file_ids: [attempt.fileId] },
    attempt.idempotencyKey,
    signal,
  );
  if (withdrawalId.value !== targetWithdrawalId || proofAttachAttempt.value !== attempt) return;
  detail.value = result;
  proofAttachAttempt.value = null;
  ElMessage.success('付款凭证已上传并绑定');
}

async function reportProofFailure(error: unknown): Promise<void> {
  if (error instanceof DOMException && error.name === 'AbortError') return;
  if (await handleExpired(error)) return;
  if (proofAttachAttempt.value) {
    ElMessage.error('凭证已上传，但绑定结果尚未确认；请使用原请求重试');
    return;
  }
  ElMessage.error(error instanceof AdminApiError && error.status === 422
    ? '凭证必须为 JPEG/PNG 且不超过 5 MiB'
    : '付款凭证上传未完成');
}

async function uploadProof(event: Event): Promise<void> {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];
  target.value = '';
  if (!file || uploading.value) return;
  uploading.value = true;
  const current = new AbortController();
  commandController = current;
  try {
    const targetWithdrawalId = withdrawalId.value;
    const uploaded = await uploadAdminImage('WITHDRAWAL_PROOF', file, current.signal);
    if (withdrawalId.value !== targetWithdrawalId) return;
    proofAttachAttempt.value = { fileId: uploaded.file_id, idempotencyKey: newIdempotencyKey() };
    await attachPendingProof(current.signal);
  } catch (error) {
    await reportProofFailure(error);
  } finally {
    if (commandController === current) commandController = null;
    uploading.value = false;
  }
}

async function retryProofAttach(): Promise<void> {
  if (uploading.value || proofAttachAttempt.value === null) return;
  uploading.value = true;
  const current = new AbortController();
  commandController = current;
  try {
    await attachPendingProof(current.signal);
  } catch (error) {
    await reportProofFailure(error);
  } finally {
    if (commandController === current) commandController = null;
    uploading.value = false;
  }
}

async function revealPayout(): Promise<void> {
  if (reauthPending.value || !detail.value || !/^\d{6}$/.test(totpCode.value)) return;
  const currentSequence = ++reauthSequence;
  reauthPending.value = true;
  reauthError.value = '';
  reauthController?.abort();
  const current = new AbortController();
  reauthController = current;
  try {
    const reauth = await reauthAdminPayoutAccount(withdrawalId.value, totpCode.value, newIdempotencyKey(), current.signal);
    if (currentSequence !== reauthSequence || !reauthOpen.value) return;
    totpCode.value = '';
    const revealed = await revealAdminPayoutAccount(withdrawalId.value, reauth.reauth_grant, detail.value.version, newIdempotencyKey(), current.signal);
    if (currentSequence !== reauthSequence || !reauthOpen.value) return;
    const remaining = Math.min(60_000, Date.parse(revealed.expires_at) - Date.now());
    if (!Number.isFinite(remaining) || remaining <= 0) {
      clearPayout();
      reauthError.value = '单次授权已失效，请重新验证';
      return;
    }
    payout.value = revealed;
    payoutTimer = setTimeout(() => { clearPayout(); reauthOpen.value = false; }, remaining);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return;
    totpCode.value = '';
    if (await handleExpired(error)) return;
    reauthError.value = error instanceof AdminApiError && error.code === 'REAUTH_LOCKED'
      ? '动态验证失败次数过多，当前账号已暂时锁定'
      : error instanceof AdminApiError && error.status === 403
        ? '动态验证码无效或单次授权已失效'
        : '收款账户读取未完成，请重新验证';
  } finally {
    if (reauthController === current) reauthController = null;
    if (currentSequence === reauthSequence) reauthPending.value = false;
  }
}

async function copyAndClear(): Promise<void> {
  if (!payout.value) return;
  let copied = false;
  try {
    await navigator.clipboard.writeText(payout.value.account_number);
    copied = true;
  } catch {
    copied = false;
  } finally {
    clearPayout();
    reauthOpen.value = false;
  }
  if (copied) ElMessage.success('账号已复制并从页面清除');
  else ElMessage.error('复制失败，账号已从页面清除');
}

async function authExpired(error: AdminApiError): Promise<void> { await handleExpired(error); }

watch(withdrawalId, () => {
  commandController?.abort();
  commandController = null;
  commandOpen.value = false;
  closeReauth();
  proofAttachAttempt.value = null;
  detail.value = null;
  void load();
}, { immediate: true });
sessionStorage.removeItem('qingxu.admin.withdrawal-paid.v1');
onBeforeUnmount(() => {
  ++sequence;
  controller?.abort();
  commandController?.abort();
  reauthController?.abort();
  commandOpen.value = false;
  reauthOpen.value = false;
  proofAttachAttempt.value = null;
  clearPayout();
});
</script>

<template>
  <AdminShell>
    <div class="withdrawal-detail" data-testid="admin-withdrawal-detail-page">
      <section class="detail-heading"><div><el-button text @click="router.push('/withdrawals')"><el-icon><ArrowLeft /></el-icon>返回提现列表</el-button><p>代理资金 · ADM-21</p><h1>{{ detail?.withdrawal_no || '提现详情' }}</h1><span v-if="detail">申请版本 {{ detail.version }} · {{ detail.agent_no }} · {{ detail.agent_name }}</span></div><el-button :loading="loading" :disabled="commandOpen || reauthOpen" @click="load"><el-icon><Refresh /></el-icon>刷新</el-button></section>
      <div v-if="loading" class="detail-state"><el-skeleton :rows="10" animated /></div>
      <div v-else-if="errorMessage" class="detail-state centered"><strong>{{ errorMessage }}</strong><el-button type="primary" @click="load">重新加载</el-button></div>
      <template v-else-if="detail">
        <section class="withdrawal-summary"><div><small>申请金额</small><strong>¥{{ detail.amount }}</strong><span>{{ formatChinaDateTime(detail.created_at) }}</span></div><div><small>当前状态</small><strong>{{ detail.status }}</strong><span>{{ detail.review_reason ?? '无审核备注' }}</span></div><div><small>冻结前 / 后</small><strong>¥{{ detail.request_balance_snapshot.frozen_before }} → ¥{{ detail.request_balance_snapshot.frozen_after }}</strong><span>申请时不可变余额快照</span></div></section>

        <section class="withdrawal-actions"><div><el-button v-if="detail.status === 'PENDING'" type="primary" data-testid="withdrawal-approve-open" @click="openCommand('APPROVE')">批准申请</el-button><el-button v-if="detail.status === 'PENDING'" type="danger" plain @click="openCommand('REJECT')">拒绝并解冻</el-button><el-button v-if="detail.status === 'APPROVED'" @click="reauthOpen = true">TOTP 查看完整收款账号</el-button><el-button v-if="detail.status === 'APPROVED'" :icon="Upload" :loading="uploading" :disabled="proofAttachAttempt !== null" @click="chooseProof">上传付款凭证</el-button><el-button v-if="detail.status === 'APPROVED' && proofAttachAttempt" :loading="uploading" data-testid="withdrawal-proof-retry" @click="retryProofAttach">使用原请求重试绑定</el-button><el-button v-if="detail.status === 'APPROVED'" type="primary" :disabled="detail.proof_file_ids.length === 0 || proofAttachAttempt !== null" data-testid="withdrawal-paid-open" @click="openCommand('PAID')">标记已付款</el-button></div><small>所有资金命令都以服务端状态、版本和预览事实为准。</small></section>

        <section class="withdrawal-grid"><article><header><div><p>申请时冻结事实</p><h2>余额快照</h2></div></header><dl><dt>可用余额</dt><dd>¥{{ detail.request_balance_snapshot.available_before }} → ¥{{ detail.request_balance_snapshot.available_after }}</dd><dt>冻结余额</dt><dd>¥{{ detail.request_balance_snapshot.frozen_before }} → ¥{{ detail.request_balance_snapshot.frozen_after }}</dd><dt>快照时间</dt><dd>{{ formatChinaDateTime(detail.request_balance_snapshot.captured_at) }}</dd></dl></article><article><header><div><p>不可变银行卡快照</p><h2>收款账户</h2></div></header><dl><dt>开户名</dt><dd>{{ detail.payout_account_snapshot.account_holder_masked }}</dd><dt>银行</dt><dd>{{ detail.payout_account_snapshot.bank_name }}</dd><dt>账号</dt><dd>{{ detail.payout_account_snapshot.account_number_masked }}</dd><dt>快照时间</dt><dd>{{ formatChinaDateTime(detail.payout_account_snapshot.snapshot_at) }}</dd></dl></article></section>

        <section class="proof-panel"><header><div><p>付款事实</p><h2>付款凭证</h2></div><el-tag effect="plain">{{ detail.proof_file_ids.length }} 个</el-tag></header><el-alert v-if="proofAttachAttempt" data-testid="withdrawal-proof-uncertain" title="凭证已上传，绑定结果尚未确认；仅可使用原请求重试。" type="warning" :closable="false" show-icon /><el-empty v-if="detail.proof_file_ids.length === 0" description="批准后上传付款凭证，方可标记已付款" :image-size="56" /><ul v-else><li v-for="fileId in detail.proof_file_ids" :key="fileId"><code>{{ fileId }}</code><span>私有凭证</span></li></ul><input ref="fileInput" class="hidden-file" type="file" accept="image/jpeg,image/png" aria-label="选择付款凭证" :disabled="proofAttachAttempt !== null" @change="uploadProof" /></section>
      </template>
    </div>

    <HighRiskCommandDialog v-model:open="commandOpen" :title="commandTitle" :description="commandDescription" :danger="commandMode === 'REJECT' || commandMode === 'PAID'" :reason-required="commandMode === 'REJECT'" :confirm-label="commandMode === 'PAID' ? '确认已付款' : commandMode === 'REJECT' ? '确认拒绝' : '确认批准'" :preview-command="previewCommand" :confirm-command="confirmCommand" @completed="commandCompleted" @conflict="commandConflict" @auth-expired="authExpired" />

    <el-dialog
      v-model="reauthOpen"
      title="受控查看收款账号"
      width="min(500px, calc(100vw - 28px))"
      :close-on-click-modal="false"
      destroy-on-close
      @close="closeReauth"
    >
      <template v-if="payout">
        <el-alert title="账号最多显示 60 秒，仅本次授权有效；复制后立即清除。" type="warning" :closable="false" show-icon />
        <div class="payout-secret">
          <span>{{ payout.account_holder }} · {{ payout.bank_name }}</span>
          <code data-testid="payout-account-number">{{ payout.account_number }}</code>
        </div>
      </template>
      <el-form v-else label-position="top" @submit.prevent="revealPayout">
        <el-form-item label="当前 TOTP 动态验证码">
          <el-input
            v-model="totpCode"
            maxlength="6"
            inputmode="numeric"
            autocomplete="one-time-code"
            placeholder="000000"
          />
        </el-form-item>
        <p v-if="reauthError" class="inline-error" role="alert">{{ reauthError }}</p>
      </el-form>
      <template #footer>
        <el-button :disabled="reauthPending" @click="closeReauth">关闭并清除</el-button>
        <el-button v-if="payout" type="primary" :icon="CopyDocument" @click="copyAndClear">复制账号并清除</el-button>
        <el-button v-else type="primary" :loading="reauthPending" :disabled="!/^\d{6}$/.test(totpCode)" @click="revealPayout">验证并单次查看</el-button>
      </template>
    </el-dialog>
  </AdminShell>
</template>

<style scoped>
.withdrawal-detail { display: grid; gap: 18px; }
.withdrawal-summary { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border: 1px solid var(--admin-border); background: #fff; }
.withdrawal-summary > div { display: grid; gap: 5px; padding: 18px; border-right: 1px solid var(--admin-border); }
.withdrawal-summary > div:last-child { border-right: 0; }
.withdrawal-summary small, .withdrawal-summary span, .withdrawal-actions small { color: var(--admin-muted); font-size: 11px; }
.withdrawal-summary strong { font-size: 19px; }
.withdrawal-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 14px; border-left: 3px solid var(--admin-brand); background: #fff; }
.withdrawal-actions > div { display: flex; flex-wrap: wrap; gap: 8px; }
.withdrawal-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
.withdrawal-grid article, .proof-panel { padding: 18px; border-top: 1px solid var(--admin-border); background: #fff; }
.withdrawal-grid header, .proof-panel > header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.withdrawal-grid p, .proof-panel p { margin: 0; color: var(--admin-brand); font-size: 11px; font-weight: 700; }
.withdrawal-grid h2, .proof-panel h2 { margin: 4px 0 0; font-size: 17px; }
.withdrawal-grid dl { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
.withdrawal-grid dt { color: var(--admin-muted); font-size: 12px; }
.withdrawal-grid dd { margin: 0; text-align: right; }
.proof-panel ul { display: grid; gap: 6px; padding: 0; list-style: none; }
.proof-panel li { display: flex; justify-content: space-between; gap: 10px; padding: 10px 12px; background: #f6f9f7; }
.proof-panel code { overflow-wrap: anywhere; }
.proof-panel li span { color: var(--admin-muted); font-size: 11px; }
.hidden-file { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.payout-secret { display: grid; gap: 10px; margin-top: 18px; padding: 16px; border: 1px solid var(--admin-border); background: #f6f9f7; }
.payout-secret code { overflow-wrap: anywhere; font-size: 18px; }
@media (max-width: 760px) { .withdrawal-summary, .withdrawal-grid { grid-template-columns: 1fr; } .withdrawal-summary > div { border-right: 0; border-bottom: 1px solid var(--admin-border); } .withdrawal-actions { align-items: stretch; flex-direction: column; } }
</style>
