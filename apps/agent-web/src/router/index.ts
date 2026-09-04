import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';

import { AgentApiError, agentAuthSession, getAgentCurrent } from '../services/agent';
import LoginView from '../views/auth/LoginView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    access: 'anonymous' | 'restricted' | 'session';
    title?: string;
  }
}

function requiredRoute(): string {
  if (agentAuthSession.state.session) return '/dashboard';
  if (agentAuthSession.state.restrictedSession) return '/change-password';
  return '/login';
}

let currentRequest: ReturnType<typeof getAgentCurrent> | undefined;

async function guard(to: RouteLocationNormalized): Promise<true | string | { path: string; query?: Record<string, string> }> {
  const required = requiredRoute();
  if (to.meta.access === 'anonymous') return required === '/login' ? true : required;
  if (to.meta.access === 'restricted') return required === '/change-password' ? true : required;
  if (required !== '/dashboard') return required;
  if (to.name === 'session-error' || agentAuthSession.state.current) return true;
  try {
    currentRequest ??= getAgentCurrent();
    await currentRequest;
    return true;
  } catch (error) {
    if (error instanceof AgentApiError && error.status === 401) {
      agentAuthSession.clear();
      return '/login';
    }
    return { path: '/session-error', query: { redirect: to.fullPath } };
  } finally {
    currentRequest = undefined;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ left: 0, top: 0 }),
  routes: [
    { path: '/', redirect: () => requiredRoute() },
    { component: LoginView, meta: { access: 'anonymous', title: '登录' }, name: 'login', path: '/login' },
    {
      component: () => import('../views/auth/ChangePasswordView.vue'),
      meta: { access: 'restricted', title: '设置新密码' },
      name: 'change-password',
      path: '/change-password',
    },
    {
      component: () => import('../views/SessionErrorView.vue'),
      meta: { access: 'session', title: '连接工作台' },
      name: 'session-error',
      path: '/session-error',
    },
    {
      component: () => import('../views/DashboardView.vue'),
      meta: { access: 'session', title: '经营概览' },
      name: 'dashboard',
      path: '/dashboard',
    },
    {
      component: () => import('../views/ProductsView.vue'),
      meta: { access: 'session', title: '推广中心' },
      name: 'products',
      path: '/products',
    },
    {
      component: () => import('../views/CustomersView.vue'),
      meta: { access: 'session', title: '我的客户' },
      name: 'customers',
      path: '/customers',
    },
    {
      component: () => import('../views/OrdersView.vue'),
      meta: { access: 'session', title: '归属订单' },
      name: 'orders',
      path: '/orders',
    },
    {
      component: () => import('../views/CommissionsView.vue'),
      meta: { access: 'session', title: '佣金明细' },
      name: 'commissions',
      path: '/commissions',
    },
    {
      component: () => import('../views/WalletView.vue'),
      meta: { access: 'session', title: '钱包与提现' },
      name: 'wallet',
      path: '/wallet',
    },
    {
      component: () => import('../views/AccountView.vue'),
      meta: { access: 'session', title: '账户与安全' },
      name: 'account',
      path: '/account',
    },
    { path: '/:pathMatch(.*)*', redirect: () => requiredRoute() },
  ],
});

router.beforeEach(guard);
