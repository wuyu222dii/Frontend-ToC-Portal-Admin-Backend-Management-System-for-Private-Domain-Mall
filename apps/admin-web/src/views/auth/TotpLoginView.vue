<script setup lang="ts">
import { Key, Lock } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';

import AuthShell from '../../components/auth/AuthShell.vue';
import { AdminApiError, verifyLoginTotp } from '../../services/admin-auth';
import { authSession } from '../../stores/auth-session';
import { formatChinaTime } from '../../utils/time';

const router = useRouter();
const code = ref('');
const pending = ref(false);
const errorMessage = ref('');
const challengeId = computed(() => authSession.state.preauth?.challenge_id ?? '');
const expiresAt = computed(() => authSession.state.preauth?.expires_at ?? '');

async function submit(): Promise<void> {
  if (pending.value) return;
  errorMessage.value = '';
  if (!/^\d{6}$/.test(code.value)) {
    errorMessage.value = '请输入 6 位动态验证码';
    return;
  }
  if (!challengeId.value) {
    errorMessage.value = '验证挑战已失效，请重新登录';
    return;
  }
  pending.value = true;
  try {
    const session = await verifyLoginTotp(challengeId.value, code.value);
    authSession.acceptSession(session);
    code.value = '';
    await router.replace('/dashboard');
  } catch (error) {
    code.value = '';
    if (error instanceof AdminApiError) {
      if (error.status === 429) errorMessage.value = '连续失败 5 次，验证已锁定 15 分钟';
      else if (error.status === 401) errorMessage.value = '验证码错误、已使用或已过期，请重试';
      else if (error.status === 409) errorMessage.value = '验证码已使用或验证状态已更新，请重新登录';
      else errorMessage.value = error.message;
    } else errorMessage.value = '身份验证未完成，请稍后重试';
  } finally {
    pending.value = false;
  }
}

async function restart(): Promise<void> {
  code.value = '';
  authSession.clearPreauth();
  await router.replace('/login');
}

onBeforeUnmount(() => { code.value = ''; });
</script>

<template>
  <AuthShell eyebrow="SECOND FACTOR" title="验证登录身份" subtitle="输入身份验证器生成的 6 位动态验证码">
    <div class="auth-step-icon"><el-icon><Lock /></el-icon></div>
    <el-form class="auth-form" label-position="top" @submit.prevent="submit">
      <el-form-item label="动态验证码">
        <el-input
          v-model="code"
          :prefix-icon="Key"
          autocomplete="one-time-code"
          inputmode="numeric"
          maxlength="6"
          name="totp-code"
          placeholder="000000"
          size="large"
        />
      </el-form-item>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <p class="expiry-copy">本次验证将在 {{ formatChinaTime(expiresAt) }}（北京时间）前有效</p>
      <el-button native-type="submit" type="primary" size="large" class="auth-submit" :loading="pending">完成验证</el-button>
      <div class="auth-link-row">
        <el-button link type="primary" @click="router.push('/login/recovery')">使用恢复码</el-button>
        <el-button link @click="restart">重新登录</el-button>
      </div>
    </el-form>
  </AuthShell>
</template>
