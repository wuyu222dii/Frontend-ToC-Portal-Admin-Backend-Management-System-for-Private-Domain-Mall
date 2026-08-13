<script setup lang="ts">
import { House, Lock, SwitchButton, User } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { AdminApiError, logout } from '../services/admin-auth';
import { authSession } from '../stores/auth-session';

const route = useRoute();
const router = useRouter();
const loggingOut = ref(false);

async function endCurrentSession(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await logout();
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.status !== 401) {
      ElMessage.warning('服务端注销未确认，本机登录状态已清除');
    }
  } finally {
    authSession.clearSession();
    loggingOut.value = false;
    await router.replace('/login');
  }
}
</script>

<template>
  <div class="admin-shell">
    <aside class="admin-sidebar">
      <div class="sidebar-brand">
        <span class="wordmark-symbol" aria-hidden="true">青</span>
        <span class="sidebar-brand-copy">
          <strong>青序生活</strong>
          <small>总部管理后台</small>
        </span>
      </div>
      <nav aria-label="总部后台导航" class="admin-nav">
        <RouterLink
          to="/workspace"
          :class="{ active: route.name === 'workspace' }"
          title="工作台"
        >
          <el-icon><House /></el-icon>
          <span>工作台</span>
        </RouterLink>
        <RouterLink
          to="/settings/account/security"
          :class="{ active: route.name === 'security' }"
          title="账户安全"
        >
          <el-icon><Lock /></el-icon>
          <span>账户安全</span>
        </RouterLink>
      </nav>
      <button
        class="sidebar-logout"
        type="button"
        :disabled="loggingOut"
        title="退出登录"
        @click="endCurrentSession"
      >
        <el-icon><SwitchButton /></el-icon>
        <span>{{ loggingOut ? '正在退出' : '退出登录' }}</span>
      </button>
    </aside>

    <div class="admin-main">
      <header class="admin-topbar">
        <div>
          <p>青序生活商城</p>
          <strong>{{ route.meta.title ?? '总部工作台' }}</strong>
        </div>
        <RouterLink to="/settings/account/security" class="account-chip" aria-label="打开账户安全">
          <span class="account-avatar"><el-icon><User /></el-icon></span>
          <span>
            <strong>超级管理员</strong>
            <small>MFA 已验证</small>
          </span>
        </RouterLink>
      </header>
      <main class="admin-content">
        <slot />
      </main>
    </div>
  </div>
</template>

