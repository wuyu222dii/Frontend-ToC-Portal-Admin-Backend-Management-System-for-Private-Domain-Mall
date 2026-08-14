<script setup lang="ts">
import { Key, RefreshRight } from '@element-plus/icons-vue';
import QRCode from 'qrcode';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import AuthShell from '../../components/auth/AuthShell.vue';
import OneTimeCodesDialog from '../../components/security/OneTimeCodesDialog.vue';
import { AdminApiError, beginTotpEnrollment, verifyTotpEnrollment } from '../../services/admin-auth';
import { authSession } from '../../stores/auth-session';
import { formatChinaTime } from '../../utils/time';

const router = useRouter();
const code = ref('');
const qrDataUrl = ref('');
const loading = ref(false);
const verifying = ref(false);
const errorMessage = ref('');
const enrollment = computed(() => authSession.state.enrollment);

async function loadEnrollment(): Promise<void> {
  if (loading.value) return;
  loading.value = true;
  errorMessage.value = '';
  code.value = '';
  qrDataUrl.value = '';
  authSession.state.enrollment = null;
  try {
    const value = await beginTotpEnrollment();
    authSession.state.enrollment = value;
    qrDataUrl.value = await QRCode.toDataURL(value.otpauth_uri, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 220,
    });
  } catch (error) {
    errorMessage.value = error instanceof AdminApiError ? error.message : '无法创建验证器绑定，请重试';
  } finally {
    loading.value = false;
  }
}

async function submit(): Promise<void> {
  if (verifying.value || !enrollment.value) return;
  errorMessage.value = '';
  if (!/^\d{6}$/.test(code.value)) {
    errorMessage.value = '请输入身份验证器生成的 6 位验证码';
    return;
  }
  verifying.value = true;
  try {
    const result = await verifyTotpEnrollment(enrollment.value.challenge_id, code.value);
    authSession.acceptSession(result.session);
    authSession.setRecoveryCodes(result.recoveryCodes);
    code.value = '';
    qrDataUrl.value = '';
  } catch (error) {
    code.value = '';
    if (error instanceof AdminApiError) {
      if (error.status === 429) errorMessage.value = '连续失败 5 次，绑定验证已锁定 15 分钟';
      else if (error.status === 409) errorMessage.value = '该验证码已使用或绑定状态已更新，请重新生成';
      else errorMessage.value = error.message;
    } else errorMessage.value = '验证未完成，请稍后重试';
  } finally {
    verifying.value = false;
  }
}

async function acknowledgeCodes(): Promise<void> {
  authSession.clearOneTimeValues();
  await router.replace('/catalog/brands');
}

async function restartLogin(): Promise<void> {
  authSession.clearSession();
  await router.replace('/login');
}

onMounted(loadEnrollment);
onBeforeUnmount(() => {
  code.value = '';
  qrDataUrl.value = '';
  authSession.state.enrollment = null;
});
</script>

<template>
  <AuthShell eyebrow="FIRST SIGN-IN" title="绑定身份验证器" subtitle="首次进入前，必须完成 30 秒动态验证器绑定">
    <div v-loading="loading" class="enroll-content">
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="绑定信息仅在本次 5 分钟流程中可见，请勿截图或转发。"
      />
      <template v-if="enrollment">
        <div class="enroll-qr-row">
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="身份验证器绑定二维码" class="enroll-qr">
          <div>
            <strong>用身份验证器扫描二维码</strong>
            <p>无法扫描时，可在身份验证器中手动打开下方绑定地址。</p>
            <details class="manual-uri">
              <summary>显示一次性手工绑定地址</summary>
              <code data-testid="one-time-otpauth-uri">{{ enrollment.otpauth_uri }}</code>
            </details>
            <small>有效至 {{ formatChinaTime(enrollment.expires_at) }}（北京时间）</small>
          </div>
        </div>
        <el-form class="auth-form enroll-form" label-position="top" @submit.prevent="submit">
          <el-form-item label="验证动态码">
            <el-input
              v-model="code"
              :prefix-icon="Key"
              autocomplete="one-time-code"
              inputmode="numeric"
              maxlength="6"
              name="totp-enroll-code"
              placeholder="000000"
              size="large"
            />
          </el-form-item>
          <p v-if="errorMessage" class="inline-error" role="alert">{{ errorMessage }}</p>
          <el-button native-type="submit" type="primary" size="large" class="auth-submit" :loading="verifying">验证并完成绑定</el-button>
          <div class="auth-link-row">
            <el-button link :icon="RefreshRight" @click="loadEnrollment">重新生成</el-button>
            <el-button link @click="restartLogin">重新登录</el-button>
          </div>
        </el-form>
      </template>
      <div v-else-if="errorMessage" class="enroll-load-error">
        <p role="alert">{{ errorMessage }}</p>
        <el-button type="primary" @click="loadEnrollment">重新生成绑定</el-button>
      </div>
    </div>
    <OneTimeCodesDialog :codes="authSession.state.recoveryCodes" @acknowledged="acknowledgeCodes" />
  </AuthShell>
</template>
