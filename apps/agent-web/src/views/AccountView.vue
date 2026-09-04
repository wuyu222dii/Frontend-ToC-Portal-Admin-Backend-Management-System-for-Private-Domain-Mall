<script setup lang="ts">
import { Key, Refresh, SwitchButton } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import BankAccountDialog from '../components/BankAccountDialog.vue';
import PageState from '../components/PageState.vue';
import AgentShell from '../layouts/AgentShell.vue';
import type { AgentBankAccount, AgentPasswordChangeInput } from '../services/agent';
import { AgentApiError, agentAuthSession, changeAgentPassword, getAgentCurrent, listAgentBankAccounts, logoutAllAgent, newIdempotencyKey } from '../services/agent';
import { handleAuthError, loadErrorMessage } from '../utils/presentation';

const router = useRouter();
const current = computed(() => agentAuthSession.state.current);
const accounts = ref<AgentBankAccount[]>([]);
const loading = ref(true);
const errorMessage = ref('');
const bankOpen = ref(false);
const passwordOpen = ref(false);
const currentPassword = ref('');
const newPassword = ref('');
const confirmation = ref('');
const passwordPending = ref(false);
const passwordUncertain = ref(false);
const passwordError = ref('');
const logoutPending = ref(false);
let sequence = 0;
let controller: AbortController | undefined;
let passwordIntent: { body: AgentPasswordChangeInput; key: string } | undefined;

function clearPassword(): void {
  currentPassword.value = '';
  newPassword.value = '';
  confirmation.value = '';
  passwordError.value = '';
  passwordUncertain.value = false;
  passwordIntent = undefined;
}

async function load(): Promise<void> {
  const active = ++sequence;
  controller?.abort(); controller = new AbortController(); loading.value = true; errorMessage.value = '';
  try {
    const [, bankAccounts] = await Promise.all([getAgentCurrent(controller.signal), listAgentBankAccounts(controller.signal)]);
    if (active !== sequence) return;
    accounts.value = bankAccounts;
  } catch (error) {
    if (active !== sequence || (error instanceof DOMException && error.name === 'AbortError')) return;
    if (await handleAuthError(error, router)) return;
    errorMessage.value = loadErrorMessage(error, '账户信息');
  } finally { if (active === sequence) loading.value = false; }
}

async function submitPassword(): Promise<void> {
  if (passwordPending.value) return;
  passwordError.value = '';
  if (!passwordIntent) {
    if (currentPassword.value.length < 8 || newPassword.value.length < 12 || newPassword.value !== confirmation.value) { passwordError.value = '新密码至少 12 位，且两次输入必须一致'; return; }
    if (currentPassword.value === newPassword.value) { passwordError.value = '新密码不能与当前密码相同'; return; }
    passwordIntent = {
      body: { current_password: currentPassword.value, new_password: newPassword.value },
      key: newIdempotencyKey(),
    };
  }
  passwordPending.value = true;
  try {
    await changeAgentPassword(passwordIntent.body, passwordIntent.key);
    clearPassword();
    passwordOpen.value = false;
    agentAuthSession.clear();
    ElMessage.success('登录密码已更新，请重新登录');
    await router.replace('/login');
  } catch (error) {
    if (await handleAuthError(error, router)) return;
    if (!(error instanceof AgentApiError) || error.status === 0 || error.status >= 500) {
      passwordUncertain.value = true;
      passwordError.value = '修改结果未确认，请保留此页面并使用原请求重试';
    } else {
      const message = error.status === 429
        ? '操作过于频繁，请稍后重试'
        : [400, 409, 422].includes(error.status)
          ? '当前密码或新密码不符合要求，请重新输入'
          : '密码修改未完成，请稍后重试';
      clearPassword();
      passwordError.value = message;
    }
  } finally { passwordPending.value = false; }
}

async function logoutAll(): Promise<void> {
  if (logoutPending.value) return;
  logoutPending.value = true;
  try { await logoutAllAgent(newIdempotencyKey()); }
  catch (error) { if (!(error instanceof AgentApiError) || error.status !== 401) ElMessage.warning('服务端会话撤销未确认，本机状态已清除'); }
  finally { agentAuthSession.clear(); logoutPending.value = false; await router.replace('/login'); }
}

onMounted(load);
onBeforeUnmount(() => { sequence += 1; controller?.abort(); clearPassword(); });
</script>

<template>
  <AgentShell>
    <header class="page-heading"><div><h1>账户与安全</h1><p>查看代理身份、商品授权模式，并维护登录密码与收款账户。</p></div><div class="page-actions"><el-button data-testid="account-refresh" :icon="Refresh" :loading="loading" @click="load" /><el-button data-testid="agent-primary-action" :icon="Key" type="primary" @click="passwordOpen = true">修改密码</el-button></div></header>
    <PageState testid="account-state" :error="errorMessage" :loading="loading" @retry="load">
      <div v-if="current" class="panel-grid">
        <section class="panel"><div class="section-title"><h2>代理身份</h2><span class="status-pill success">{{ current.status === 'ACTIVE' ? '正常' : '已停用' }}</span></div><dl class="detail-list"><dt>代理名称</dt><dd>{{ current.name }}</dd><dt>代理编号</dt><dd>{{ current.agent_no }}</dd><dt>商品授权</dt><dd>{{ current.product_authorization_mode === 'ALL_ACTIVE_PRODUCTS' ? '全部上架商品' : '指定商品白名单' }}</dd></dl><p class="dialog-note">商品白名单只限制可推广范围；已绑定客户购买其他商品，仍按全体代理统一规则计佣。</p></section>
        <section class="panel"><div class="section-title"><h2>会话安全</h2></div><p class="dialog-note">修改密码后需重新登录。发现异常登录时，可立即撤销本账号全部会话。</p><el-button data-testid="account-logout-all" :icon="SwitchButton" :loading="logoutPending" type="danger" plain @click="logoutAll">退出全部设备</el-button></section>
      </div>
      <section class="panel"><div class="section-title"><h2>收款银行卡</h2><el-button data-testid="bank-account-open" link type="primary" @click="bankOpen = true">{{ accounts.length ? '更换银行卡' : '绑定银行卡' }}</el-button></div><div v-if="!accounts.length" class="empty-inline" data-testid="account-bank-empty">尚未绑定银行卡</div><div v-for="account in accounts" :key="account.bank_account_id" class="record-line"><span>{{ account.bank_name }} · {{ account.account_holder_masked }}</span><b>{{ account.account_number_masked }}</b></div></section>
    </PageState>
    <BankAccountDialog v-model="bankOpen" @saved="load" />
    <el-dialog v-model="passwordOpen" data-testid="account-password-dialog" :close-on-click-modal="!passwordPending && !passwordUncertain" :close-on-press-escape="!passwordPending && !passwordUncertain" :show-close="!passwordPending && !passwordUncertain" destroy-on-close title="修改登录密码" width="500px" @closed="clearPassword">
      <el-form data-testid="account-password-form" label-position="top" @submit.prevent="submitPassword"><el-form-item label="当前密码"><el-input v-model="currentPassword" autocomplete="current-password" data-testid="account-current-password" :disabled="passwordUncertain" show-password type="password" /></el-form-item><el-form-item label="新密码"><el-input v-model="newPassword" autocomplete="new-password" data-testid="account-new-password" :disabled="passwordUncertain" show-password type="password" /></el-form-item><el-form-item label="确认新密码"><el-input v-model="confirmation" autocomplete="new-password" data-testid="account-confirm-password" :disabled="passwordUncertain" show-password type="password" /></el-form-item><p v-if="passwordError" class="inline-error" data-testid="account-password-error" role="alert">{{ passwordError }}</p></el-form>
      <template #footer><div class="dialog-actions"><el-button v-if="!passwordUncertain" :disabled="passwordPending" @click="passwordOpen = false">取消</el-button><el-button data-testid="account-password-submit" :loading="passwordPending" type="primary" @click="submitPassword">{{ passwordUncertain ? '使用原请求重试' : '确认修改' }}</el-button></div></template>
    </el-dialog>
  </AgentShell>
</template>
