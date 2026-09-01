import type { components } from '@qingxu/contracts';

import { authSession } from '../stores/auth-session';
import type { AdminAuthSession, ErrorResponse } from '../types/auth';

export type AdminApiMethod = 'DELETE' | 'GET' | 'POST' | 'PATCH';

export interface AdminApiRequestOptions {
  method?: AdminApiMethod;
  body?: unknown;
  auth?: 'access' | 'preauth';
  expectedStatus?: number | readonly number[];
  idempotencyKey?: string;
  ifMatch?: string;
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal | undefined;
}

const refreshInFlight = new Map<string, Promise<AdminAuthSession>>();

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

function sameAdminSession(
  current: AdminAuthSession | null,
  expected: AdminAuthSession,
): current is AdminAuthSession {
  return current?.account_id === expected.account_id && current.session_id === expected.session_id;
}

function sessionChangedError(): AdminApiError {
  return new AdminApiError('登录状态已经变化，请重新发起操作', {
    status: 409,
    code: 'SESSION_CHANGED',
  });
}

function refreshIdentity(session: AdminAuthSession): string {
  return `${session.account_id}:${session.session_id}:${session.refresh_token}`;
}

export async function adminApiRequest<T>(
  path: string,
  options: AdminApiRequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  for (const [name, value] of Object.entries(options.headers ?? {})) headers.set(name, value);
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
  const expectedStatuses = options.expectedStatus === undefined
    ? null
    : Array.isArray(options.expectedStatus) ? options.expectedStatus : [options.expectedStatus];
  if (expectedStatuses !== null && !expectedStatuses.includes(response.status)) {
    throw new AdminApiError('服务响应状态不正确', { status: 502, code: 'INVALID_RESPONSE' });
  }
  if (payload === null) throw new AdminApiError('服务响应格式不正确', { status: 502, code: 'INVALID_RESPONSE' });
  return payload as T;
}

function refreshAdminSessionFor(session: AdminAuthSession): Promise<AdminAuthSession> {
  const identity = refreshIdentity(session);
  const existing = refreshInFlight.get(identity);
  if (existing) return existing;
  const pending = adminApiRequest<components['schemas']['AdminAuthSessionResponse']>('/admin/auth/refresh', {
    body: { refresh_token: session.refresh_token },
    idempotencyKey: newIdempotencyKey(),
    method: 'POST',
  }).then((response) => {
    if (!sameAdminSession(response.data, session)) {
      throw new AdminApiError('服务响应中的管理员会话不匹配', {
        status: 502,
        code: 'INVALID_RESPONSE',
      });
    }
    return response.data;
  }).finally(() => {
    refreshInFlight.delete(identity);
  });
  refreshInFlight.set(identity, pending);
  return pending;
}

export function refreshAdminSession(): Promise<AdminAuthSession> {
  const session = authSession.state.session;
  if (!session) throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  return refreshAdminSessionFor(session).then(
    (refreshed) => {
      if (!sameAdminSession(authSession.state.session, session)) throw sessionChangedError();
      return refreshed;
    },
    (error: unknown) => {
      if (!sameAdminSession(authSession.state.session, session)) throw sessionChangedError();
      throw error;
    },
  );
}

async function retryWithCurrentSession<T>(
  operation: () => Promise<T>,
  session: AdminAuthSession,
): Promise<T> {
  if (!sameAdminSession(authSession.state.session, session)) throw sessionChangedError();
  try {
    const result = await operation();
    if (!sameAdminSession(authSession.state.session, session)) throw sessionChangedError();
    return result;
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'SESSION_CHANGED') throw error;
    if (!sameAdminSession(authSession.state.session, session)) throw sessionChangedError();
    if (!(error instanceof AdminApiError) || error.status !== 401) throw error;
    authSession.clearSession();
    throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  }
}

export async function withSessionRefresh<T>(operation: () => Promise<T>): Promise<T> {
  const attemptedSession = authSession.state.session;
  try {
    const result = await operation();
    if (attemptedSession && !sameAdminSession(authSession.state.session, attemptedSession)) {
      throw sessionChangedError();
    }
    return result;
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'SESSION_CHANGED') throw error;
    if (!(error instanceof AdminApiError) || error.status !== 401 || !attemptedSession) throw error;
  }
  if (!sameAdminSession(authSession.state.session, attemptedSession)) throw sessionChangedError();
  if (authSession.state.session.access_token !== attemptedSession.access_token) {
    return retryWithCurrentSession(operation, attemptedSession);
  }
  try {
    const refreshed = await refreshAdminSessionFor(attemptedSession);
    if (!sameAdminSession(authSession.state.session, attemptedSession)) throw sessionChangedError();
    if (authSession.state.session.refresh_token === attemptedSession.refresh_token) {
      authSession.acceptSession(refreshed);
    }
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'SESSION_CHANGED') throw error;
    if (!sameAdminSession(authSession.state.session, attemptedSession)) throw sessionChangedError();
    authSession.clearSession();
    throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  }
  return retryWithCurrentSession(operation, attemptedSession);
}

export function adminSessionRequest<T>(
  path: string,
  options: Omit<AdminApiRequestOptions, 'auth'> = {},
): Promise<T> {
  return withSessionRefresh(() => adminApiRequest<T>(path, { ...options, auth: 'access' }));
}
