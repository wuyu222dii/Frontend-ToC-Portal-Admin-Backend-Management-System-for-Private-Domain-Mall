<script setup lang="ts">
import { Key, Lock, RefreshRight, SwitchButton, User } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import BusinessRulesPanel from '../../components/security/BusinessRulesPanel.vue';
import OneTimeCodesDialog from '../../components/security/OneTimeCodesDialog.vue';
import ReturnAddressPanel from '../../components/security/ReturnAddressPanel.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import {
  AdminApiError,
  changePassword,
  getCurrentAccount,
  logoutAll,
  previewSecurityReset,
  resetSecurity,
  rotateRecoveryCodes,
} from '../../services/admin-auth';
import { authSession } from '../../stores/auth-session';
import { formatChinaDateTime } from '../../utils/time';

const router = useRouter();
const loading = ref(true);
const loadError = ref('');
const passwordDialog = ref(false);
const rotateDialog = ref(false);
const passwordPending = ref(false);
const rotatePending = ref(false);
const logoutAllPending = ref(false);
const securityResetDialog = ref(false);
const securityResetPending = ref(false);
const securityResetError = ref('');
const securityResetPreview = ref<Awaited<ReturnType<typeof previewSecurityReset>> | null>(null);
const securityResetForm = reactive({ reason: '', resetPassword: true, resetTotp: true, credentialType: 'TOTP' as 'TOTP' | 'RECOVERY_CODE', credential: '', newPassword: '', confirmPassword: '' });
const passwordError = ref('');
const rotateError = ref('');
const passwordForm = reactive({ current: '', next: '', confirm: '' });
const totpCode = ref('');
const current = computed(() => authSession.state.current);

function clearPasswordForm(): void {
  passwordForm.current = '';
  passwordForm.next = '';
  passwordForm.confirm = '';
  passwordError.value = '';
}

function clearTotp(): void {
  totpCode.value = '';
  rotateError.value = '';
}

function clearSecurityReset(): void {
  securityResetError.value = '';
  securityResetPreview.value = null;
  securityResetForm.reason = '';
  securityResetForm.credential = '';
  securityResetForm.newPassword = '';
  securityResetForm.confirmPassword = '';
}

async function submitSecurityReset(): Promise<void> {
  securityResetError.value = '';
  if (!securityResetForm.resetPassword && !securityResetForm.resetTotp) { securityResetError.value = '至少选择一项重置内容'; return; }
  if (securityResetForm.reason.trim().length < 2) { securityResetError.value = '请填写重置原因'; return; }
  securityResetPending.value = true;
  try {
    if (!securityResetPreview.value) {
      securityResetPreview.value = await previewSecurityReset({ reason: securityResetForm.reason, resetPassword: securityResetForm.resetPassword, resetTotp: securityResetForm.resetTotp });
      return;
    }
    if (securityResetForm.credential.length < 6) { securityResetError.value = '请输入动态验证码或恢复码'; return; }
    if (securityResetForm.resetPassword && (securityResetForm.newPassword.length < 12 || securityResetForm.newPassword !== securityResetForm.confirmPassword)) { securityResetError.value = '新密码至少 12 位且两次输入必须一致'; return; }
    const version = current.value?.version;
    if (!version) throw new AdminApiError('账户版本不可用', { status: 409, code: 'STATE_CONFLICT' });
    await resetSecurity({ reason: securityResetForm.reason, resetPassword: securityResetForm.resetPassword, resetTotp: securityResetForm.resetTotp, credentialType: securityResetForm.credentialType, credential: securityResetForm.credential, newPassword: securityResetForm.resetPassword ? securityResetForm.newPassword : null, previewToken: securityResetPreview.value.preview_token, confirmationHash: securityResetPreview.value.confirmation_hash, version });
    securityResetDialog.value = false;
    clearSecurityReset();
    await router.replace('/login');
  } catch (error) {
    securityResetError.value = error instanceof AdminApiError ? error.message : '安全重置未完成';
    clearSecurityReset();
    authSession.clearSession();
    await router.replace('/login');
  } finally { securityResetPending.value = false; }
}

async function redirectIfSessionExpired(error: unknown): Promise<boolean> {
  if (!(error instanceof AdminApiError) || error.status !== 401) return false;
  authSession.clearSession();
  await router.replace('/login');
  return true;
}

async function loadCurrent(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  try {
    authSession.state.current = await getCurrentAccount();
  } catch (error) {
    if (error instanceof AdminApiError && error.status === 401) {
      authSession.clearSession();
      await router.replace('/login');
      return;
    }
    loadError.value = error instanceof AdminApiError ? error.message : '账户安全信息加载失败';
  } finally {
    loading.value = false;
  }
}

async function submitPassword(): Promise<void> {
  if (passwordPending.value) return;
  passwordError.value = '';
  if (passwordForm.current.length < 8) passwordError.value = '请输入当前密码';
  else if (passwordForm.next.length < 12) passwordError.value = '新密码至少 12 位';
  else if (passwordForm.next !== passwordForm.confirm) passwordError.value = '两次输入的新密码不一致';
  else if (passwordForm.current === passwordForm.next) passwordError.value = '新密码不能与当前密码相同';
  if (passwordError.value) return;

  passwordPending.value = true;
  try {
    await changePassword({ currentPassword: passwordForm.current, newPassword: passwordForm.next });
    passwordDialog.value = false;
    clearPasswordForm();
    ElMessage.success('密码已更新，其他会话已撤销');
  } catch (error) {
    if (await redirectIfSessionExpired(error)) return;
    passwordError.value = error instanceof AdminApiError ? error.message : '密码修改未完成';
  } finally {
    passwordPending.value = false;
  }
}

async function submitRotate(): Promise<void> {
  if (rotatePending.value) return;
  rotateError.value = '';
  if (!/^\d{6}$/.test(totpCode.value)) {
    rotateError.value = '请输入 6 位动态验证码';
    return;
  }
  rotatePending.value = true;
  try {
    const result = await rotateRecoveryCodes(totpCode.value);
    authSession.setRecoveryCodes(result.recovery_codes);
    rotateDialog.value = false;
    clearTotp();
  } catch (error) {
    if (await redirectIfSessionExpired(error)) return;
    totpCode.value = '';
    rotateError.value = error instanceof AdminApiError ? error.message : '恢复码轮换未完成';
  } finally {
    rotatePending.value = false;
  }
}

async function endAllSessions(): Promise<void> {
  if (logoutAllPending.value) return;
  try {
    await ElMessageBox.confirm(
      '包括当前浏览器在内的全部管理员会话都会立即失效。',
      '退出全部会话',
      { confirmButtonText: '确认退出全部', cancelButtonText: '取消', type: 'warning' },
    );
  } catch {
    return;
  }
  logoutAllPending.value = true;
  try {
    await logoutAll();
    authSession.clearSession();
    await router.replace('/login');
  } catch (error) {
    if (await redirectIfSessionExpired(error)) return;
    ElMessage.error(error instanceof AdminApiError ? error.message : '退出全部会话未完成');
  } finally {
    logoutAllPending.value = false;
  }
}

function acknowledgeCodes(): void {
  authSession.clearOneTimeValues();
  ElMessage.success('恢复码已从当前页面清除');
}

async function settingsAuthExpired(error: AdminApiError): Promise<void> {
  await redirectIfSessionExpired(error);
}

onMounted(loadCurrent);
onBeforeUnmount(() => {
  clearPasswordForm();
  clearTotp();
  authSession.clearOneTimeValues();
});
</script>

<template>
  <AdminShell>
    <section class="page-heading">
      <div>
        <p>系统设置 · ADM-16</p>
        <h1>账户与业务规则</h1>
        <span>管理超级管理员凭据、会话、经营规则和总部退货地址。</span>
      </div>
      <el-tag v-if="current" type="success" effect="plain">MFA 已启用</el-tag>
    </section>

    <section v-loading="loading" class="security-overview">
      <el-alert v-if="loadError" type="error" :closable="false" show-icon>
        <template #title>账户信息加载失败</template>
        <el-button link type="primary" @click="loadCurrent">重新加载</el-button>
      </el-alert>
      <template v-else-if="current">
        <article class="account-summary">
          <span class="security-icon green"><el-icon><User /></el-icon></span>
          <div>
            <small>当前账号</small>
            <strong>超级管理员</strong>
            <p>{{ current.account_id }} · 会话 {{ current.session_id }}</p>
          </div>
            <el-tag type="success">已启用</el-tag>
        </article>

        <div class="security-card-grid">
          <article class="security-card">
            <span class="security-icon blue"><el-icon><Lock /></el-icon></span>
            <div>
              <h2>登录密码</h2>
              <p>修改密码后，除当前会话外的其他会话将被撤销。</p>
              <small>新密码至少 12 位，输入内容不会预填或保存。</small>
            </div>
            <el-button @click="passwordDialog = true">修改密码</el-button>
          </article>
          <article class="security-card">
            <span class="security-icon purple"><el-icon><Key /></el-icon></span>
            <div>
              <h2>动态验证与恢复码</h2>
              <p>30 秒 TOTP 已绑定，恢复码每个只能使用一次。</p>
              <small>MFA 验证时间：{{ formatChinaDateTime(current.mfa_verified_at) }}（北京时间）</small>
            </div>
            <el-button @click="rotateDialog = true">轮换恢复码</el-button>
          </article>
          <article class="security-card danger-card">
            <span class="security-icon coral"><el-icon><SwitchButton /></el-icon></span>
            <div>
              <h2>会话安全</h2>
              <p>发现异常登录时，立即撤销当前账号的全部后台会话。</p>
              <small>全凭据丢失不提供网页恢复，请走双人审批离线流程。</small>
            </div>
            <el-button type="danger" plain :loading="logoutAllPending" @click="endAllSessions">退出全部会话</el-button>
          </article>
          <article class="security-card">
            <span class="security-icon coral"><el-icon><Lock /></el-icon></span>
            <div><h2>本人安全重置</h2><p>重置密码或动态验证后，全部后台会话立即失效。</p><small>需要当前动态验证码或一次性恢复码。</small></div>
            <el-button @click="securityResetDialog = true">开始重置</el-button>
          </article>
        </div>

        <BusinessRulesPanel @auth-expired="settingsAuthExpired" />
        <ReturnAddressPanel @auth-expired="settingsAuthExpired" />
      </template>
    </section>

    <el-dialog v-model="passwordDialog" title="修改登录密码" width="min(480px, calc(100vw - 32px))" @closed="clearPasswordForm">
      <el-form label-position="top" @submit.prevent="submitPassword">
        <el-form-item label="当前密码"><el-input v-model="passwordForm.current" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item label="新密码"><el-input v-model="passwordForm.next" type="password" show-password autocomplete="new-password" placeholder="至少 12 位" /></el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="passwordForm.confirm" type="password" show-password autocomplete="new-password" /></el-form-item>
        <p v-if="passwordError" class="inline-error" role="alert">{{ passwordError }}</p>
      </el-form>
      <template #footer><el-button @click="passwordDialog = false">取消</el-button><el-button type="primary" :loading="passwordPending" @click="submitPassword">确认修改</el-button></template>
    </el-dialog>

    <el-dialog v-model="rotateDialog" title="轮换全部恢复码" width="min(480px, calc(100vw - 32px))" @closed="clearTotp">
      <el-alert title="旧恢复码会立即全部失效，新恢复码只展示一次。" type="warning" :closable="false" show-icon />
      <el-form class="dialog-form" label-position="top" @submit.prevent="submitRotate">
        <el-form-item label="当前动态验证码"><el-input v-model="totpCode" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="000000" /></el-form-item>
        <p v-if="rotateError" class="inline-error" role="alert">{{ rotateError }}</p>
      </el-form>
      <template #footer><el-button @click="rotateDialog = false">取消</el-button><el-button type="primary" :icon="RefreshRight" :loading="rotatePending" @click="submitRotate">确认轮换</el-button></template>
    </el-dialog>

    <el-dialog v-model="securityResetDialog" title="本人安全重置" width="min(520px, calc(100vw - 32px))" @closed="clearSecurityReset">
      <el-form label-position="top">
        <el-form-item label="重置原因"><el-input v-model="securityResetForm.reason" maxlength="500" :disabled="Boolean(securityResetPreview)" /></el-form-item>
        <el-checkbox v-model="securityResetForm.resetPassword" :disabled="Boolean(securityResetPreview)">重置登录密码</el-checkbox>
        <el-checkbox v-model="securityResetForm.resetTotp" :disabled="Boolean(securityResetPreview)">重置动态验证</el-checkbox>
        <el-form-item v-if="securityResetForm.resetPassword" label="新密码"><el-input v-model="securityResetForm.newPassword" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-form-item v-if="securityResetForm.resetPassword" label="确认新密码"><el-input v-model="securityResetForm.confirmPassword" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-radio-group v-model="securityResetForm.credentialType"><el-radio value="TOTP">动态验证码</el-radio><el-radio value="RECOVERY_CODE">恢复码</el-radio></el-radio-group>
        <el-form-item label="当前凭据"><el-input v-model="securityResetForm.credential" autocomplete="one-time-code" /></el-form-item>
        <el-alert v-if="securityResetPreview" type="warning" :closable="false" title="预览已生成，确认后当前全部会话将立即失效。" />
        <p v-if="securityResetError" class="inline-error" role="alert">{{ securityResetError }}</p>
      </el-form>
      <template #footer><el-button @click="securityResetDialog = false">取消</el-button><el-button type="primary" :loading="securityResetPending" @click="submitSecurityReset">{{ securityResetPreview ? '确认重置' : '生成预览' }}</el-button></template>
    </el-dialog>

    <OneTimeCodesDialog :codes="authSession.state.recoveryCodes" @acknowledged="acknowledgeCodes" />
  </AdminShell>
</template>
