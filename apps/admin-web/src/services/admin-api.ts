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
const refreshKeys = new WeakMap<AdminAuthSession, string>();

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

export function versionEtag(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError('Resource version must be a positive integer');
  }
  return `"${version}"`;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseAdminSuccessEnvelope<T>(payload: unknown): T {
  if (!isPlainRecord(payload) ||
    payload.code !== 'OK' ||
    typeof payload.message !== 'string' ||
    typeof payload.request_id !== 'string' ||
    payload.request_id.length === 0 ||
    !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    throw new AdminApiError('服务响应格式不正确', { status: 502, code: 'INVALID_RESPONSE' });
  }
  return payload as T;
}

function bearer(kind: 'access' | 'preauth'): string | undefined {
  return kind === 'access'
    ? authSession.state.session?.access_token
    : authSession.state.preauth?.pre_auth_token;
}

function sessionChangedError(): AdminApiError {
  return new AdminApiError('登录状态已经变化，请重新发起操作', {
    status: 409,
    code: 'SESSION_CHANGED',
  });
}

function authRequiredError(): AdminApiError {
  return new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
}

function refreshIdentity(session: AdminAuthSession): string {
  return `${session.account_id}:${session.session_id}:${session.refresh_token}`;
}

function currentDescendsFrom(previous: AdminAuthSession): boolean {
  return authSession.descendsFrom(previous);
}

function terminalRefreshFailure(error: unknown): error is AdminApiError {
  return error instanceof AdminApiError && (
    error.status === 401 || (error.status === 409 && error.code === 'STATE_CONFLICT')
  );
}

function isRotatedAdminSession(previous: AdminAuthSession, next: AdminAuthSession): boolean {
  return (
    next.account_id === previous.account_id &&
    next.session_id !== previous.session_id &&
    next.access_token !== previous.access_token &&
    next.refresh_token !== previous.refresh_token &&
    next.role === 'SUPER_ADMIN' &&
    next.assurance === 'MFA' &&
    next.restriction === 'NONE' &&
    next.mfa_required === false
  );
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
  return parseAdminSuccessEnvelope<T>(payload);
}

function refreshAdminSessionFor(session: AdminAuthSession): Promise<AdminAuthSession> {
  const identity = refreshIdentity(session);
  const existing = refreshInFlight.get(identity);
  if (existing) return existing;
  const idempotencyKey = refreshKeys.get(session) ?? newIdempotencyKey();
  refreshKeys.set(session, idempotencyKey);
  const pending = adminApiRequest<components['schemas']['AdminAuthSessionResponse']>('/admin/auth/refresh', {
    body: { refresh_token: session.refresh_token },
    idempotencyKey,
    method: 'POST',
  }).then((response) => {
    const next = response.data;
    if (!isRotatedAdminSession(session, next)) {
      throw new AdminApiError('服务响应中的管理员会话不匹配', {
        status: 502,
        code: 'INVALID_RESPONSE',
      });
    }
    if (authSession.matchesSession(session)) {
      if (!authSession.replaceSession(session, next)) throw sessionChangedError();
    } else if (!currentDescendsFrom(session)) {
      throw sessionChangedError();
    }
    refreshKeys.delete(session);
    return next;
  }).catch((error: unknown) => {
    if (terminalRefreshFailure(error)) refreshKeys.delete(session);
    throw error;
  }).finally(() => {
    refreshInFlight.delete(identity);
  });
  refreshInFlight.set(identity, pending);
  return pending;
}

export function refreshAdminSession(): Promise<AdminAuthSession> {
  const session = authSession.state.session;
  if (!session) throw authRequiredError();
  return refreshAdminSessionFor(session).then(
    (refreshed) => {
      if (!currentDescendsFrom(session)) throw sessionChangedError();
      return refreshed;
    },
    (error: unknown) => {
      if (!authSession.matchesSession(session) && !currentDescendsFrom(session)) {
        throw sessionChangedError();
      }
      throw error;
    },
  );
}

async function retryWithCurrentSession<T>(
  operation: () => Promise<T>,
  ancestor: AdminAuthSession,
): Promise<T> {
  const current = authSession.state.session;
  if (!current || !currentDescendsFrom(ancestor)) throw sessionChangedError();
  try {
    const result = await operation();
    if (!currentDescendsFrom(ancestor)) throw sessionChangedError();
    return result;
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'SESSION_CHANGED') throw error;
    if (!currentDescendsFrom(ancestor)) throw sessionChangedError();
    if (!(error instanceof AdminApiError) || error.status !== 401) throw error;
    if (!authSession.matchesSession(current)) {
      return retryWithCurrentSession(operation, ancestor);
    }
    authSession.clearSession();
    throw authRequiredError();
  }
}

export async function withSessionRefresh<T>(operation: () => Promise<T>): Promise<T> {
  const attemptedSession = authSession.state.session;
  try {
    const result = await operation();
    if (attemptedSession && !currentDescendsFrom(attemptedSession)) {
      throw sessionChangedError();
    }
    return result;
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'SESSION_CHANGED') throw error;
    if (!(error instanceof AdminApiError) || error.status !== 401 || !attemptedSession) throw error;
  }
  if (currentDescendsFrom(attemptedSession) && !authSession.matchesSession(attemptedSession)) {
    return retryWithCurrentSession(operation, attemptedSession);
  }
  if (!authSession.matchesSession(attemptedSession)) throw sessionChangedError();
  try {
    await refreshAdminSessionFor(attemptedSession);
  } catch (error) {
    if (error instanceof AdminApiError && error.code === 'SESSION_CHANGED') throw error;
    if (!authSession.matchesSession(attemptedSession)) throw sessionChangedError();
    if (!terminalRefreshFailure(error)) throw error;
    authSession.clearSession();
    throw authRequiredError();
  }
  if (!currentDescendsFrom(attemptedSession)) throw sessionChangedError();
  return retryWithCurrentSession(operation, attemptedSession);
}

export function adminSessionRequest<T>(
  path: string,
  options: Omit<AdminApiRequestOptions, 'auth'> = {},
): Promise<T> {
  return withSessionRefresh(() => adminApiRequest<T>(path, { ...options, auth: 'access' }));
}
