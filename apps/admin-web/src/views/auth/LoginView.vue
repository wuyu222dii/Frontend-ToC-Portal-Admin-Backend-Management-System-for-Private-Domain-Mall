<script setup lang="ts">
import { Lock, User } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';

import AuthShell from '../../components/auth/AuthShell.vue';
import { AdminApiError, login } from '../../services/admin-auth';
import { authSession } from '../../stores/auth-session';

const router = useRouter();
const rememberedLogin = authSession.readRememberedLogin();
const loginName = ref(rememberedLogin);
const password = ref('');
const remember = ref(rememberedLogin.length > 0);
const pending = ref(false);
const errorMessage = ref('');
const lockedSeconds = ref(0);
let lockTimer: ReturnType<typeof setInterval> | undefined;

const lockText = computed(() => {
  const minutes = Math.ceil(lockedSeconds.value / 60);
  return lockedSeconds.value > 0 ? `尝试次数过多，请 ${minutes} 分钟后重试` : '';
});

function beginLockCountdown(seconds: number): void {
  if (lockTimer !== undefined) clearInterval(lockTimer);
  lockedSeconds.value = Math.max(1, seconds);
  lockTimer = setInterval(() => {
    lockedSeconds.value = Math.max(0, lockedSeconds.value - 1);
    if (lockedSeconds.value === 0 && lockTimer !== undefined) clearInterval(lockTimer);
  }, 1_000);
}

async function submit(): Promise<void> {
  if (pending.value || lockedSeconds.value > 0) return;
  errorMessage.value = '';
  if (!loginName.value.trim() || password.value.length < 8) {
    errorMessage.value = '请输入账号和至少 8 位登录密码';
    return;
  }
  pending.value = true;
  try {
    const response = await login({ loginName: loginName.value.trim(), password: password.value });
    authSession.rememberLogin(loginName.value.trim(), remember.value);
    authSession.acceptPreauth(response.data);
    password.value = '';
    await router.replace(response.data.next_action === 'VERIFY_TOTP'
      ? '/login/totp'
      : '/settings/account/security/enroll');
  } catch (error) {
    password.value = '';
    if (error instanceof AdminApiError) {
      if (error.status === 429) {
        beginLockCountdown(error.retryAfterSeconds ?? 15 * 60);
        errorMessage.value = lockText.value;
      } else if (error.status === 401 || error.status === 403 || error.status === 404) {
        errorMessage.value = '账号或密码错误，请重试';
      } else {
        errorMessage.value = error.message;
      }
    } else {
      errorMessage.value = '登录未完成，请稍后重试';
    }
  } finally {
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
    eyebrow="HQ SUPER ADMIN"
    title="欢迎回来"
    subtitle="使用超级管理员账号登录总部管理后台"
  >
    <el-form class="auth-form" label-position="top" @submit.prevent="submit">
      <el-form-item label="超级管理员账号">
        <el-input
          v-model="loginName"
          :prefix-icon="User"
          autocomplete="username"
          name="username"
          placeholder="请输入超级管理员账号"
          size="large"
        />
      </el-form-item>
      <el-form-item label="登录密码">
        <el-input
          v-model="password"
          :prefix-icon="Lock"
          autocomplete="current-password"
          name="password"
          placeholder="请输入至少 8 位登录密码"
          show-password
          size="large"
          type="password"
        />
      </el-form-item>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ lockedSeconds > 0 ? lockText : errorMessage }}</p>
      <div class="auth-options">
        <el-checkbox v-model="remember">记住账号</el-checkbox>
        <el-popover placement="bottom-end" trigger="click" width="260">
          <template #reference>
            <el-button link type="primary">忘记密码</el-button>
          </template>
          <p class="support-copy">请联系技术支持发起受控恢复。密码和 TOTP 均丢失时，只能走双人审批离线流程。</p>
        </el-popover>
      </div>
      <el-button
        native-type="submit"
        type="primary"
        size="large"
        class="auth-submit"
        :disabled="lockedSeconds > 0"
        :loading="pending"
      >
        登录总部管理后台
      </el-button>
      <div class="auth-security-note">
        <el-icon><Lock /></el-icon>
        <span>密码验证后仍需完成动态验证，才会创建后台会话。</span>
      </div>
    </el-form>
  </AuthShell>
</template>
