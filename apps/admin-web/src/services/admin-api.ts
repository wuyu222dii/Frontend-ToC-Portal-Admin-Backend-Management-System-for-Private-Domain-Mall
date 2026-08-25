import type { components } from '@qingxu/contracts';

import { authSession } from '../stores/auth-session';
import type { AdminAuthSession, ErrorResponse } from '../types/auth';

export type AdminApiMethod = 'DELETE' | 'GET' | 'POST' | 'PATCH';

export interface AdminApiRequestOptions {
  method?: AdminApiMethod;
  body?: unknown;
  auth?: 'access' | 'preauth';
  idempotencyKey?: string;
  ifMatch?: string;
  signal?: AbortSignal | undefined;
}

let refreshInFlight: Promise<AdminAuthSession> | null = null;

export class AdminApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;

  constructor(
    message: string,
    options: { status: number; code?: string; requestId?: string; retryAfterSeconds?: number },
  ) {
    super(message);
    this.name = 'AdminApiError';
    this.status = options.status;
    this.code = options.code ?? 'NETWORK_ERROR';
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function bearer(kind: 'access' | 'preauth'): string | undefined {
  return kind === 'access'
    ? authSession.state.session?.access_token
    : authSession.state.preauth?.pre_auth_token;
}

export async function adminApiRequest<T>(
  path: string,
  options: AdminApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.auth !== undefined) {
    const token = bearer(options.auth);
    if (!token) throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  if (options.ifMatch) headers.set('If-Match', options.ifMatch);

  let response: Response;
  try {
    const init: RequestInit = {
      cache: 'no-store',
      credentials: 'omit',
      headers,
      method: options.method ?? 'GET',
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal) init.signal = options.signal;
    response = await fetch(`/api/v1${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AdminApiError('网络连接失败，请检查网络后重试', { status: 0 });
  }

  const retryAfter = Number(response.headers.get('retry-after'));
  const payload = await response.json().catch(() => null) as T | ErrorResponse | null;
  if (!response.ok) {
    const error = payload as ErrorResponse | null;
    const errorOptions: {
      status: number;
      code?: string;
      requestId?: string;
      retryAfterSeconds?: number;
    } = { status: response.status };
    if (error?.code) errorOptions.code = error.code;
    if (error?.request_id) errorOptions.requestId = error.request_id;
    if (Number.isFinite(retryAfter) && retryAfter > 0) errorOptions.retryAfterSeconds = retryAfter;
    throw new AdminApiError(error?.message || '请求未完成，请稍后重试', errorOptions);
  }
  if (payload === null) throw new AdminApiError('服务响应格式不正确', { status: 502, code: 'INVALID_RESPONSE' });
  return payload as T;
}

export function refreshAdminSession(): Promise<AdminAuthSession> {
  const refreshToken = authSession.state.session?.refresh_token;
  if (!refreshToken) throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  return adminApiRequest<components['schemas']['AdminAuthSessionResponse']>('/admin/auth/refresh', {
    body: { refresh_token: refreshToken },
    idempotencyKey: newIdempotencyKey(),
    method: 'POST',
  }).then((response) => response.data);
}

async function retryWithCurrentSession<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.status !== 401) throw error;
    authSession.clearSession();
    throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  }
}

export async function withSessionRefresh<T>(operation: () => Promise<T>): Promise<T> {
  const attemptedAccessToken = authSession.state.session?.access_token;
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.status !== 401 || !authSession.state.session?.refresh_token) {
      throw error;
    }
  }
  if (authSession.state.session?.access_token !== attemptedAccessToken) return retryWithCurrentSession(operation);
  try {
    const pendingRefresh = refreshInFlight ??= refreshAdminSession();
    try {
      authSession.acceptSession(await pendingRefresh);
    } finally {
      if (refreshInFlight === pendingRefresh) refreshInFlight = null;
    }
  } catch {
    authSession.clearSession();
    throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  }
  return retryWithCurrentSession(operation);
}

export function adminSessionRequest<T>(
  path: string,
  options: Omit<AdminApiRequestOptions, 'auth'> = {},
): Promise<T> {
  return withSessionRefresh(() => adminApiRequest<T>(path, { ...options, auth: 'access' }));
}
