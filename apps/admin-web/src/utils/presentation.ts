import type { Router } from 'vue-router';

import { AdminApiError } from '../services/admin-api';
import { authSession } from '../stores/auth-session';

export interface ReadableErrorOptions {
  readonly codeMessages?: Readonly<Record<string, string>>;
  readonly statusMessages?: Partial<Record<number, string>>;
}

export function readableError(
  error: unknown,
  fallback: string,
  options: ReadableErrorOptions = {},
): string {
  if (!(error instanceof AdminApiError)) return fallback;
  const codeMessage = options.codeMessages?.[error.code];
  if (codeMessage) return codeMessage;
  if (error.status === 0) return '网络连接失败，请检查网络后重试';
  const statusMessage = options.statusMessages?.[error.status];
  if (statusMessage) return statusMessage;
  if (error.status === 429) {
    return error.retryAfterSeconds
      ? `查询过于频繁，请在 ${error.retryAfterSeconds} 秒后重试`
      : '查询过于频繁，请稍后重试';
  }
  return fallback;
}

export function isAdminUnauthorized(error: unknown): boolean {
  return error instanceof AdminApiError && error.status === 401;
}

export function isAdminSessionExpired(error: unknown): boolean {
  return !authSession.state.session || isAdminUnauthorized(error);
}

export async function redirectToAdminLogin(router: Router): Promise<void> {
  authSession.clearSession();
  await router.replace('/login');
}

export async function handleSessionError(
  error: unknown,
  router: Router,
  onExpire?: () => void,
): Promise<boolean> {
  if (authSession.state.session && !isAdminUnauthorized(error)) return false;
  onExpire?.();
  await redirectToAdminLogin(router);
  return true;
}

export async function handleUnauthorized(
  error: unknown,
  router: Router,
  onExpire?: () => void,
): Promise<boolean> {
  if (!isAdminUnauthorized(error)) return false;
  onExpire?.();
  await redirectToAdminLogin(router);
  return true;
}
