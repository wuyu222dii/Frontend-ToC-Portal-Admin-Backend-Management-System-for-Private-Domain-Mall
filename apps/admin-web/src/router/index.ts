import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router';

import { authSession } from '../stores/auth-session';
import LoginView from '../views/auth/LoginView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    access: 'anonymous' | 'enroll' | 'preauth-totp' | 'session';
    title?: string;
  }
}

function requiredRoute(): string {
  if (authSession.state.session) return '/dashboard';
  if (authSession.state.preauth?.next_action === 'VERIFY_TOTP') return '/login/totp';
  if (authSession.state.preauth?.next_action === 'ENROLL_TOTP') return '/settings/account/security/enroll';
  return '/login';
}

function guard(to: RouteLocationNormalized): true | string {
  const required = requiredRoute();
  if (to.meta.access === 'anonymous') return required === '/login' ? true : required;
  if (to.meta.access === 'preauth-totp') return required === '/login/totp' ? true : required;
  if (to.meta.access === 'enroll') return required === '/settings/account/security/enroll' ? true : required;
  return authSession.state.session ? true : required;
}

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: () => ({ left: 0, top: 0 }),
  routes: [
    { path: '/', redirect: () => requiredRoute() },
    { component: LoginView, meta: { access: 'anonymous', title: '登录' }, name: 'login', path: '/login' },
    {
      component: () => import('../views/auth/TotpLoginView.vue'),
      meta: { access: 'preauth-totp', title: '动态验证' },
      name: 'login-totp',
      path: '/login/totp',
    },
    {
      component: () => import('../views/auth/RecoveryLoginView.vue'),
      meta: { access: 'preauth-totp', title: '恢复登录' },
      name: 'login-recovery',
      path: '/login/recovery',
    },
    {
      component: () => import('../views/security/TotpEnrollView.vue'),
      meta: { access: 'enroll', title: '绑定动态验证' },
      name: 'security-enroll',
      path: '/settings/account/security/enroll',
    },
    {
      component: () => import('../views/dashboard/DashboardView.vue'),
      meta: { access: 'session', title: '数据看板' },
      name: 'dashboard',
      path: '/dashboard',
    },
    {
      component: () => import('../views/catalog/BrandsView.vue'),
      meta: { access: 'session', title: '品牌管理' },
      name: 'brands',
      path: '/catalog/brands',
    },
    {
      component: () => import('../views/catalog/CategoriesView.vue'),
      meta: { access: 'session', title: '分类管理' },
      name: 'categories',
      path: '/catalog/categories',
    },
    {
      component: () => import('../views/products/ProductListView.vue'),
      meta: { access: 'session', title: '商品管理' },
      name: 'products',
      path: '/catalog/products',
    },
    {
      component: () => import('../views/products/ProductEditorView.vue'),
      meta: { access: 'session', title: '新增商品' },
      name: 'product-new',
      path: '/catalog/products/new',
    },
    {
      component: () => import('../views/products/ProductEditorView.vue'),
      meta: { access: 'session', title: '商品编辑' },
      name: 'product-detail',
      path: '/catalog/products/:product_id',
    },
    {
      component: () => import('../views/inventory/InventoryListView.vue'),
      meta: { access: 'session', title: '库存管理' },
      name: 'inventory',
      path: '/catalog/inventory',
    },
    {
      component: () => import('../views/banners/BannerListView.vue'),
      meta: { access: 'session', title: 'Banner 管理' },
      name: 'banners',
      path: '/content/banners',
    },
    {
      component: () => import('../views/customers/CustomerListView.vue'),
      meta: { access: 'session', title: '客户管理' },
      name: 'customers',
      path: '/customers',
    },
    {
      component: () => import('../views/customers/CustomerDetailView.vue'),
      meta: { access: 'session', title: '客户详情' },
      name: 'customer-detail',
      path: '/customers/:customer_id',
    },
    {
      component: () => import('../views/orders/OrderListView.vue'),
      meta: { access: 'session', title: '订单中心' },
      name: 'orders',
      path: '/orders',
    },
    {
      component: () => import('../views/orders/OrderDetailView.vue'),
      meta: { access: 'session', title: '订单详情' },
      name: 'order-detail',
      path: '/orders/:order_id',
    },
    {
      component: () => import('../views/aftersales/AftersaleListView.vue'),
      meta: { access: 'session', title: '售后管理' },
      name: 'aftersales',
      path: '/aftersales',
    },
    {
      component: () => import('../views/aftersales/AftersaleDetailView.vue'),
      meta: { access: 'session', title: '售后详情' },
      name: 'aftersale-detail',
      path: '/aftersales/:aftersale_id',
    },
    {
      component: () => import('../views/agents/AgentListView.vue'),
      meta: { access: 'session', title: '代理管理' },
      name: 'agents',
      path: '/agents',
    },
    {
      component: () => import('../views/agents/AgentDetailView.vue'),
      meta: { access: 'session', title: '代理详情' },
      name: 'agent-detail',
      path: '/agents/:agent_id',
    },
    {
      component: () => import('../views/finance/CommissionRulesView.vue'),
      meta: { access: 'session', title: '佣金规则' },
      name: 'commission-rules',
      path: '/commission-rules',
    },
    {
      component: () => import('../views/finance/WithdrawalListView.vue'),
      meta: { access: 'session', title: '提现审核' },
      name: 'withdrawals',
      path: '/withdrawals',
    },
    {
      component: () => import('../views/finance/WithdrawalDetailView.vue'),
      meta: { access: 'session', title: '提现详情' },
      name: 'withdrawal-detail',
      path: '/withdrawals/:withdrawal_id',
    },
    {
      component: () => import('../views/payments/PaymentReconciliationView.vue'),
      meta: { access: 'session', title: '支付对账' },
      name: 'payment-reconciliation',
      path: '/orders/reconciliation',
    },
    {
      component: () => import('../views/audit/AuditListView.vue'),
      meta: { access: 'session', title: '审计日志' },
      name: 'audit-logs',
      path: '/audit-logs',
    },
    {
      component: () => import('../views/security/SecurityHomeView.vue'),
      meta: { access: 'session', title: '账户安全' },
      name: 'security',
      path: '/settings/account/security',
    },
    { path: '/:pathMatch(.*)*', redirect: () => requiredRoute() },
  ],
});

router.beforeEach(guard);

router.afterEach((to) => {
  if (to.name !== 'security-enroll') authSession.state.enrollment = null;
  if (to.name !== 'security') authSession.clearOneTimeValues();
});
