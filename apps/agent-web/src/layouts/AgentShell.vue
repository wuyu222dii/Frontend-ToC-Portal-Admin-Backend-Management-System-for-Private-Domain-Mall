<script setup lang="ts">
import {
  Coin,
  DataAnalysis,
  Goods,
  Menu,
  Money,
  MoreFilled,
  Setting,
  SwitchButton,
  Tickets,
  User,
  UserFilled,
} from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { AgentApiError, agentAuthSession, logoutAgent, newIdempotencyKey } from '../services/agent';

const route = useRoute();
const router = useRouter();
const loggingOut = ref(false);
const moreOpen = ref(false);

const routes = [
  { icon: DataAnalysis, label: '经营概览', mobileLabel: '概览', name: 'dashboard', path: '/dashboard' },
  { icon: Goods, label: '推广中心', mobileLabel: '推广', name: 'products', path: '/products' },
  { icon: UserFilled, label: '我的客户', mobileLabel: '客户', name: 'customers', path: '/customers' },
  { icon: Tickets, label: '归属订单', mobileLabel: '订单', name: 'orders', path: '/orders' },
  { icon: Coin, label: '佣金明细', mobileLabel: '佣金', name: 'commissions', path: '/commissions' },
  { icon: Money, label: '钱包与提现', mobileLabel: '钱包', name: 'wallet', path: '/wallet' },
  { icon: Setting, label: '账户与安全', mobileLabel: '账户', name: 'account', path: '/account' },
] as const;

const mobileRoutes = [routes[0], routes[1], routes[3], routes[5]];
const moreRoutes = [routes[2], routes[4], routes[6]];
const moreActive = computed(() => moreRoutes.some((item) => item.name === route.name));

async function navigate(path: string): Promise<void> {
  moreOpen.value = false;
  await router.push(path);
}

async function logout(): Promise<void> {
  if (loggingOut.value) return;
  loggingOut.value = true;
  try {
    await logoutAgent(newIdempotencyKey());
  } catch (error) {
    if (!(error instanceof AgentApiError) || error.status !== 401) {
      ElMessage.warning('服务端注销未确认，本机登录状态已清除');
    }
  } finally {
    agentAuthSession.clear();
    loggingOut.value = false;
    await router.replace('/login');
  }
}
</script>

<template>
  <div class="agent-shell">
    <aside class="agent-sidebar">
      <div class="sidebar-brand">
        <span class="wordmark-symbol" aria-hidden="true">青</span>
        <span class="sidebar-brand-copy"><strong>青序伙伴</strong><small>一级代理工作台</small></span>
      </div>
      <nav class="agent-nav" aria-label="代理工作台导航">
        <RouterLink
          v-for="item in routes"
          :key="item.name"
          :class="{ active: route.name === item.name }"
          :data-testid="`agent-nav-${item.name}`"
          :title="item.label"
          :to="item.path"
        >
          <el-icon><component :is="item.icon" /></el-icon><span>{{ item.label }}</span>
        </RouterLink>
      </nav>
      <button class="sidebar-logout" data-testid="agent-logout" :disabled="loggingOut" type="button" @click="logout">
        <el-icon><SwitchButton /></el-icon><span>{{ loggingOut ? '正在退出' : '退出登录' }}</span>
      </button>
    </aside>

    <div class="agent-main">
      <header class="agent-topbar">
        <div class="topbar-title">
          <el-icon><Menu /></el-icon>
          <span><small>青序伙伴</small><strong>{{ route.meta.title }}</strong></span>
        </div>
        <RouterLink class="account-link" to="/account" title="账户与安全">
          <span class="account-avatar"><el-icon><User /></el-icon></span>
          <span><strong>一级代理</strong><small>安全会话</small></span>
        </RouterLink>
      </header>
      <main class="agent-content">
        <slot />
      </main>
    </div>

    <nav class="mobile-nav" aria-label="代理端移动导航" data-testid="agent-mobile-navigation">
      <RouterLink
        v-for="item in mobileRoutes"
        :key="item.name"
        :aria-current="route.name === item.name ? 'page' : undefined"
        :class="{ active: route.name === item.name }"
        :data-testid="`agent-mobile-nav-${item.name}`"
        :to="item.path"
      >
        <el-icon><component :is="item.icon" /></el-icon><span>{{ item.mobileLabel }}</span>
      </RouterLink>
      <button
        :aria-current="moreActive ? 'page' : undefined"
        :class="{ active: moreActive }"
        data-testid="agent-mobile-nav-more"
        type="button"
        @click="moreOpen = true"
      >
        <el-icon><MoreFilled /></el-icon><span>更多</span>
      </button>
    </nav>

    <el-drawer v-model="moreOpen" class="mobile-more" direction="btt" size="auto" title="更多功能">
      <nav class="more-links" aria-label="代理端更多功能">
        <button v-for="item in moreRoutes" :key="item.name" :data-testid="`agent-more-${item.name}`" type="button" @click="navigate(item.path)">
          <el-icon><component :is="item.icon" /></el-icon>
          <span><strong>{{ item.label }}</strong><small>进入{{ item.label }}</small></span>
        </button>
        <button class="danger-link" :disabled="loggingOut" type="button" @click="logout">
          <el-icon><SwitchButton /></el-icon><span><strong>退出登录</strong><small>结束当前代理会话</small></span>
        </button>
      </nav>
    </el-drawer>
  </div>
</template>
