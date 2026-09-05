<script setup lang="ts">
import { Key } from '@element-plus/icons-vue';
import { computed, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';

import AuthShell from '../../components/auth/AuthShell.vue';
import { AdminApiError, loginWithRecoveryCode } from '../../services/admin-auth';
import { authSession } from '../../stores/auth-session';

const router = useRouter();
const recoveryCode = ref('');
const pending = ref(false);
const errorMessage = ref('');
const challengeId = computed(() => authSession.state.preauth?.challenge_id ?? '');

async function submit(): Promise<void> {
  if (pending.value) return;
  errorMessage.value = '';
  if (recoveryCode.value.trim().length < 8) {
    errorMessage.value = '请输入完整恢复码';
    return;
  }
  pending.value = true;
  try {
    const session = await loginWithRecoveryCode(challengeId.value, recoveryCode.value.trim());
    authSession.acceptSession(session);
    recoveryCode.value = '';
    await router.replace('/dashboard');
  } catch (error) {
    recoveryCode.value = '';
    if (error instanceof AdminApiError) {
      errorMessage.value = error.status === 429
        ? '连续失败 5 次，恢复验证已锁定 15 分钟'
        : '恢复码错误、已使用或已过期，请重试';
    } else errorMessage.value = '恢复验证未完成，请稍后重试';
  } finally {
    pending.value = false;
  }
}

onBeforeUnmount(() => { recoveryCode.value = ''; });
</script>

<template>
  <AuthShell eyebrow="ACCOUNT RECOVERY" title="使用恢复码" subtitle="恢复码只能使用一次，验证成功后将立即失效">
    <el-alert type="warning" :closable="false" show-icon title="若密码和恢复码均不可用，请联系技术支持走双人审批离线恢复。" />
    <el-form class="auth-form spaced-form" label-position="top" @submit.prevent="submit">
      <el-form-item label="单次恢复码">
        <el-input
          v-model="recoveryCode"
          :prefix-icon="Key"
          autocomplete="one-time-code"
          name="recovery-code"
          placeholder="请输入恢复码"
          size="large"
        />
      </el-form-item>
      <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
      <el-button native-type="submit" type="primary" size="large" class="auth-submit" :loading="pending">验证并登录</el-button>
      <div class="auth-link-row"><el-button link type="primary" @click="router.replace('/login/totp')">返回动态验证码</el-button></div>
    </el-form>
  </AuthShell>
</template>
