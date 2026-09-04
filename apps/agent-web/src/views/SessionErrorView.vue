<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AgentShell from '../layouts/AgentShell.vue';
import { AgentApiError, agentAuthSession, getAgentCurrent } from '../services/agent';

const route = useRoute();
const router = useRouter();
const pending = ref(false);
const message = ref('代理身份加载失败，经营数据尚未发起请求。');

async function retry(): Promise<void> {
  if (pending.value) return;
  pending.value = true;
  try {
    await getAgentCurrent();
    const target = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
      ? route.query.redirect
      : '/dashboard';
    await router.replace(target);
  } catch (error) {
    if (error instanceof AgentApiError && error.status === 401) {
      agentAuthSession.clear();
      await router.replace('/login');
      return;
    }
    message.value = error instanceof AgentApiError && error.status === 429
      ? '请求过于频繁，请稍后重试。'
      : '仍无法加载代理身份，请检查网络后重试。';
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <AgentShell>
    <div class="page-state centered" data-testid="session-current-error" role="alert">
      <strong>{{ message }}</strong>
      <el-button data-testid="session-current-retry" :icon="Refresh" :loading="pending" type="primary" @click="retry">重新连接</el-button>
    </div>
  </AgentShell>
</template>
