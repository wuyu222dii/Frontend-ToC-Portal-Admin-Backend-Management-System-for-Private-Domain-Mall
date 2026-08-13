<script setup lang="ts">
import { Key, Lock, RefreshRight, SwitchButton, User } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import OneTimeCodesDialog from '../../components/security/OneTimeCodesDialog.vue';
import AdminShell from '../../layouts/AdminShell.vue';
import {
  AdminApiError,
  changePassword,
  getCurrentAccount,
  logoutAll,
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
        <h1>账户安全</h1>
        <span>管理当前超级管理员密码、动态验证和会话。</span>
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
        </div>
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

    <OneTimeCodesDialog :codes="authSession.state.recoveryCodes" @acknowledged="acknowledgeCodes" />
  </AdminShell>
</template>
