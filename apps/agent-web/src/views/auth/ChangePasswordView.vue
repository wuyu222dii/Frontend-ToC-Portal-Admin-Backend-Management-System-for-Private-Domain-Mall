<script setup lang="ts">
import { Lock, SwitchButton } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';

import AuthShell from '../../components/AuthShell.vue';
import type { AgentPasswordChangeInput } from '../../services/agent';
import {
  AgentApiError,
  agentAuthSession,
  changeTemporaryAgentPassword,
  logoutAgent,
  newIdempotencyKey,
} from '../../services/agent';

const router = useRouter();
const currentPassword = ref('');
const newPassword = ref('');
const confirmation = ref('');
const pending = ref(false);
const loggingOut = ref(false);
const uncertain = ref(false);
const errorMessage = ref('');
let intent: { body: AgentPasswordChangeInput; key: string } | undefined;

function clearSecrets(): void {
  currentPassword.value = '';
  newPassword.value = '';
  confirmation.value = '';
  uncertain.value = false;
  intent = undefined;
}

function readableError(error: unknown): string {
  if (!(error instanceof AgentApiError)) return '密码修改未完成，请检查网络后重试';
  if (error.status === 401) return '临时会话已失效，请重新登录';
  if (error.status === 409) return '账户状态已变化，请重新登录';
  if (error.status === 429) return error.retryAfterSeconds
    ? `操作过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
    : '操作过于频繁，请稍后重试';
  if (error.status === 400 || error.status === 422) return '当前密码或新密码不符合要求，请重新输入';
  return '密码修改服务暂不可用，请稍后重试';
}

async function submit(): Promise<void> {
  if (pending.value || loggingOut.value) return;
  errorMessage.value = '';
  if (!intent) {
    if (currentPassword.value.length < 8 || newPassword.value.length < 12 || newPassword.value !== confirmation.value) {
      errorMessage.value = '新密码至少 12 位，且两次输入必须一致';
      return;
    }
    if (currentPassword.value === newPassword.value) {
      errorMessage.value = '新密码不能与临时密码相同';
      return;
    }
    intent = {
      body: { current_password: currentPassword.value, new_password: newPassword.value },
      key: newIdempotencyKey(),
    };
  }
  pending.value = true;
  try {
    const result = await changeTemporaryAgentPassword(intent.body, intent.key);
    agentAuthSession.acceptSession(result);
    clearSecrets();
    await router.replace('/dashboard');
  } catch (error) {
    const unknown = !(error instanceof AgentApiError) || error.status === 0 || error.status >= 500;
    if (unknown) {
      uncertain.value = true;
      errorMessage.value = '修改结果未确认，请保留此页面并使用原请求重试';
    } else {
      const message = readableError(error);
      clearSecrets();
      errorMessage.value = message;
    }
    if (error instanceof AgentApiError && [401, 409].includes(error.status)) {
      agentAuthSession.clear();
      await router.replace('/login');
    }
  } finally {
    pending.value = false;
  }
}

async function logout(): Promise<void> {
  if (pending.value || loggingOut.value) return;
  const attempted = agentAuthSession.state.restrictedSession;
  if (!attempted) {
    await router.replace('/login');
    return;
  }
  loggingOut.value = true;
  try {
    await logoutAgent(newIdempotencyKey());
  } catch (error) {
    if (!(error instanceof AgentApiError) || error.status !== 401) {
      ElMessage.warning('服务端注销未确认，本机登录状态已清除');
    }
  } finally {
    clearSecrets();
    agentAuthSession.clearRestrictedSession(attempted);
    loggingOut.value = false;
    await router.replace('/login');
  }
}

onBeforeUnmount(clearSecrets);
</script>

<template>
  <AuthShell
    eyebrow="FIRST SIGN IN"
    title="设置新的登录密码"
    subtitle="临时会话只允许完成本次改密，成功后才可访问经营数据"
  >
    <div class="security-callout">
      <el-icon><Lock /></el-icon>
      <span><strong>必须完成首次改密</strong>请使用至少 12 位的新密码，且不要复用临时密码。</span>
    </div>
    <el-form class="auth-form" label-position="top" data-testid="agent-forced-password-form" @submit.prevent="submit">
      <el-form-item label="当前临时密码">
        <el-input
          v-model="currentPassword"
          autocomplete="current-password"
          data-testid="agent-current-password"
          :disabled="uncertain"
          show-password
          type="password"
        />
      </el-form-item>
      <el-form-item label="新密码">
        <el-input
          v-model="newPassword"
          autocomplete="new-password"
          data-testid="agent-new-password"
          :disabled="uncertain"
          show-password
          type="password"
        />
      </el-form-item>
      <el-form-item label="确认新密码">
        <el-input
          v-model="confirmation"
          autocomplete="new-password"
          data-testid="agent-confirm-password"
          :disabled="uncertain"
          show-password
          type="password"
        />
      </el-form-item>
      <p v-if="errorMessage" class="inline-error" data-testid="agent-forced-password-error" role="alert">
        {{ errorMessage }}
      </p>
      <el-button
        class="auth-submit"
        data-testid="agent-forced-password-submit"
        :loading="pending"
        native-type="submit"
        size="large"
        type="primary"
      >
        {{ uncertain ? '使用原请求重试' : '设置密码并进入工作台' }}
      </el-button>
      <el-button
        data-testid="agent-restricted-logout"
        :disabled="pending"
        :icon="SwitchButton"
        :loading="loggingOut"
        style="width: 100%; margin-top: 12px"
        @click="logout"
      >
        退出并切换账号
      </el-button>
    </el-form>
  </AuthShell>
</template>
