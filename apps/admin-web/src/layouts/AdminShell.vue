<script setup lang="ts">
import {
  Box,
  Coin,
  CollectionTag,
  Document,
  Goods,
  Lock,
  Money,
  PictureFilled,
  PriceTag,
  Refresh,
  Service,
  SwitchButton,
  Tickets,
  User,
  UserFilled,
} from '@element-plus/icons-vue';
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
          to="/catalog/products"
          :class="{ active: ['products', 'product-new', 'product-detail'].includes(String(route.name)) }"
          title="商品管理"
        >
          <el-icon><Goods /></el-icon>
          <span>商品管理</span>
        </RouterLink>
        <RouterLink
          to="/catalog/brands"
          :class="{ active: route.name === 'brands' }"
          title="品牌管理"
        >
          <el-icon><PriceTag /></el-icon>
          <span>品牌管理</span>
        </RouterLink>
        <RouterLink
          to="/catalog/inventory"
          :class="{ active: route.name === 'inventory' }"
          title="库存管理"
        >
          <el-icon><Box /></el-icon>
          <span>库存管理</span>
        </RouterLink>
        <RouterLink
          to="/catalog/categories"
          :class="{ active: route.name === 'categories' }"
          title="分类管理"
        >
          <el-icon><CollectionTag /></el-icon>
          <span>分类管理</span>
        </RouterLink>
        <RouterLink
          to="/content/banners"
          :class="{ active: route.name === 'banners' }"
          title="Banner 管理"
        >
          <el-icon><PictureFilled /></el-icon>
          <span>Banner</span>
        </RouterLink>
        <RouterLink
          to="/customers"
          :class="{ active: ['customers', 'customer-detail'].includes(String(route.name)) }"
          title="客户管理"
        >
          <el-icon><User /></el-icon>
          <span>客户管理</span>
        </RouterLink>
        <RouterLink
          to="/orders"
          :class="{ active: ['orders', 'order-detail'].includes(String(route.name)) }"
          title="订单中心"
        >
          <el-icon><Tickets /></el-icon>
          <span>订单中心</span>
        </RouterLink>
        <RouterLink
          to="/orders/reconciliation"
          :class="{ active: route.name === 'payment-reconciliation' }"
          title="支付对账"
        >
          <el-icon><Refresh /></el-icon>
          <span>支付对账</span>
        </RouterLink>
        <RouterLink
          to="/aftersales"
          :class="{ active: ['aftersales', 'aftersale-detail'].includes(String(route.name)) }"
          title="售后管理"
        >
          <el-icon><Service /></el-icon>
          <span>售后管理</span>
        </RouterLink>
        <RouterLink
          to="/agents"
          :class="{ active: ['agents', 'agent-detail'].includes(String(route.name)) }"
          title="代理管理"
        >
          <el-icon><UserFilled /></el-icon>
          <span>代理管理</span>
        </RouterLink>
        <RouterLink
          to="/commission-rules"
          :class="{ active: route.name === 'commission-rules' }"
          title="佣金规则"
        >
          <el-icon><Coin /></el-icon>
          <span>佣金规则</span>
        </RouterLink>
        <RouterLink
          to="/withdrawals"
          :class="{ active: ['withdrawals', 'withdrawal-detail'].includes(String(route.name)) }"
          title="提现审核"
        >
          <el-icon><Money /></el-icon>
          <span>提现审核</span>
        </RouterLink>
        <RouterLink
          to="/audit-logs"
          :class="{ active: route.name === 'audit-logs' }"
          title="审计日志"
        >
          <el-icon><Document /></el-icon>
          <span>审计日志</span>
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
