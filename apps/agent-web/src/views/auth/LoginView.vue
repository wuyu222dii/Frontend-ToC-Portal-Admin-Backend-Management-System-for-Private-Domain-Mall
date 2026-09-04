<script setup lang="ts">
import { Lock, User } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';

import AuthShell from '../../components/AuthShell.vue';
import {
  AgentApiError,
  agentAuthSession,
  loginAgent,
  newIdempotencyKey,
} from '../../services/agent';

const router = useRouter();
const loginName = ref(agentAuthSession.rememberedLogin.value);
const password = ref('');
const remember = ref(loginName.value.length > 0);
const pending = ref(false);
const errorMessage = ref('');
const lockedSeconds = ref(0);
let lockTimer: ReturnType<typeof setInterval> | undefined;

const lockText = computed(() => lockedSeconds.value > 0
  ? `尝试过于频繁，请在 ${lockedSeconds.value} 秒后重试`
  : '');

function beginCountdown(seconds: number): void {
  if (lockTimer !== undefined) clearInterval(lockTimer);
  lockedSeconds.value = Math.max(1, seconds);
  lockTimer = setInterval(() => {
    lockedSeconds.value = Math.max(0, lockedSeconds.value - 1);
    if (lockedSeconds.value === 0 && lockTimer !== undefined) clearInterval(lockTimer);
  }, 1_000);
}

function readableError(error: unknown): string {
  if (!(error instanceof AgentApiError)) return '登录未完成，请检查网络后重试';
  if (error.status === 429) {
    beginCountdown(error.retryAfterSeconds ?? 60);
    return lockText.value;
  }
  if ([401, 403, 404].includes(error.status)) return '账号或密码错误，请重试；账号停用请联系总部';
  if (error.status === 409) return '登录请求正在处理中，请稍后重试';
  return '登录服务暂不可用，请稍后重试';
}

async function submit(): Promise<void> {
  if (pending.value || lockedSeconds.value > 0) return;
  errorMessage.value = '';
  const normalizedLogin = loginName.value.trim();
  if (!normalizedLogin || password.value.length < 8) {
    errorMessage.value = '请输入代理账号和至少 8 位密码';
    return;
  }
  pending.value = true;
  try {
    const result = await loginAgent(
      { login_name: normalizedLogin, password: password.value },
      newIdempotencyKey(),
    );
    agentAuthSession.rememberLogin(normalizedLogin, remember.value);
    if (result.restriction === 'CHANGE_PASSWORD_ONLY') {
      agentAuthSession.acceptRestricted(result);
      await router.replace('/change-password');
    } else {
      agentAuthSession.acceptSession(result);
      await router.replace('/dashboard');
    }
  } catch (error) {
    errorMessage.value = readableError(error);
  } finally {
    password.value = '';
    pending.value = false;
  }
}

onBeforeUnmount(() => {
  password.value = '';
  if (lockTimer !== undefined) clearInterval(lockTimer);
});
</script>

<template>
  <AuthShell
    eyebrow="PARTNER SIGN IN"
    title="登录代理工作台"
    subtitle="使用总部为您开通的一级代理账号"
  >
    <el-form class="auth-form" label-position="top" data-testid="agent-login-form" @submit.prevent="submit">
      <el-form-item label="代理账号">
        <el-input
          v-model="loginName"
          :prefix-icon="User"
          autocomplete="username"
          data-testid="agent-login-name"
          name="username"
          placeholder="请输入代理账号"
          size="large"
        />
      </el-form-item>
      <el-form-item label="登录密码">
        <el-input
          v-model="password"
          :prefix-icon="Lock"
          autocomplete="current-password"
          data-testid="agent-login-password"
          name="password"
          placeholder="请输入登录密码"
          show-password
          size="large"
          type="password"
        />
      </el-form-item>
      <p v-if="errorMessage" class="inline-error" data-testid="agent-login-error" role="alert">
        {{ lockedSeconds > 0 ? lockText : errorMessage }}
      </p>
      <div class="security-callout compact">
        <el-icon><Lock /></el-icon>
        <span><strong>首次登录安全校验</strong>临时密码登录后必须立即设置新密码。</span>
      </div>
      <div class="auth-options">
        <el-checkbox v-model="remember">记住账号</el-checkbox>
        <span>忘记密码请联系总部</span>
      </div>
      <el-button
        class="auth-submit"
        data-testid="agent-login-submit"
        :disabled="lockedSeconds > 0"
        :loading="pending"
        native-type="submit"
        size="large"
        type="primary"
      >
        登录工作台
      </el-button>
    </el-form>
  </AuthShell>
</template>
