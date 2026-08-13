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
  if (authSession.state.session) return '/workspace';
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
      component: () => import('../views/security/EmptyWorkspaceView.vue'),
      meta: { access: 'session', title: '工作台' },
      name: 'workspace',
      path: '/workspace',
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
