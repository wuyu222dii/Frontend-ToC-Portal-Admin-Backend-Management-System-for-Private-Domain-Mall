import { agentAuthSession } from '../stores/auth-session';
import type {
  AgentErrorResponse,
  AgentSession,
} from '../types/agent';
import {
  AgentResponseFormatError,
  decodeAgentSession,
  decodeErrorResponse,
  decodeSuccessEnvelope,
} from './agent-decoders';

export type AgentApiMethod = 'GET' | 'POST';

export interface AgentRequestOptions<T> {
  method?: AgentApiMethod;
  body?: unknown;
  expectedStatus?: number;
  idempotencyKey?: string;
  signal?: AbortSignal | undefined;
  decode: (value: unknown, path?: string) => T;
}

export class AgentApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId: string | null;
  readonly retryAfterSeconds: number | null;
  readonly details: AgentErrorResponse['details'];

  constructor(
    message: string,
    options: {
      status: number;
      code?: string | undefined;
      requestId?: string | undefined;
      retryAfterSeconds?: number | undefined;
      details?: AgentErrorResponse['details'] | undefined;
    },
  ) {
    super(message);
    this.name = 'AgentApiError';
    this.status = options.status;
    this.code = options.code ?? 'NETWORK_ERROR';
    this.requestId = options.requestId ?? null;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.details = options.details;
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function sessionChanged(): AgentApiError {
  return new AgentApiError('登录状态已经变化，请重新发起操作', {
    status: 409,
    code: 'SESSION_CHANGED',
  });
}

function authRequired(): AgentApiError {
  return new AgentApiError('登录状态已失效，请重新登录', {
    status: 401,
    code: 'AUTH_REQUIRED',
  });
}

function passwordChangeRequired(): AgentApiError {
  return new AgentApiError('请先修改初始密码', {
    status: 403,
    code: 'PASSWORD_CHANGE_REQUIRED',
  });
}

function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get('retry-after');
  if (value === null || !/^[1-9]\d*$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) ? seconds : undefined;
}

async function requestOnce<T>(
  path: string,
  options: AgentRequestOptions<T>,
  accessToken?: string,
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (accessToken !== undefined) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.idempotencyKey !== undefined) headers.set('Idempotency-Key', options.idempotencyKey);

  let response: Response;
  try {
    const init: RequestInit = {
      cache: 'no-store',
      credentials: 'omit',
      headers,
      method: options.method ?? 'GET',
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    if (options.signal !== undefined) init.signal = options.signal;
    response = await fetch(`/api/v1${path}`, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new AgentApiError('网络连接失败，请检查网络后重试', { status: 0 });
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    try {
      const error = decodeErrorResponse(payload);
      throw new AgentApiError(error.message, {
        status: response.status,
        code: error.code,
        requestId: error.request_id,
        retryAfterSeconds: retryAfterSeconds(response.headers),
        details: error.details,
      });
    } catch (error) {
      if (error instanceof AgentApiError) throw error;
      throw new AgentApiError('服务响应格式不正确', {
        status: 502,
        code: 'INVALID_RESPONSE',
        retryAfterSeconds: retryAfterSeconds(response.headers),
      });
    }
  }

  if (options.expectedStatus !== undefined && response.status !== options.expectedStatus) {
    throw new AgentApiError('服务响应状态不正确', { status: 502, code: 'INVALID_RESPONSE' });
  }
  try {
    return decodeSuccessEnvelope(payload, options.decode);
  } catch (error) {
    if (!(error instanceof AgentResponseFormatError)) throw error;
    throw new AgentApiError('服务响应格式不正确', { status: 502, code: 'INVALID_RESPONSE' });
  }
}

export function agentPublicRequest<T>(
  path: string,
  options: AgentRequestOptions<T>,
): Promise<T> {
  return requestOnce(path, options);
}

const refreshInFlight = new Map<string, Promise<AgentSession>>();
const refreshKeys = new WeakMap<AgentSession, string>();

function currentDescendsFrom(previous: AgentSession): boolean {
  return agentAuthSession.descendsFrom(previous);
}

function terminalRefreshFailure(error: unknown): error is AgentApiError {
  return error instanceof AgentApiError && (
    error.status === 401 || (error.status === 409 && error.code === 'STATE_CONFLICT')
  );
}

function refreshSessionFor(session: AgentSession): Promise<AgentSession> {
  const key = `${session.account_id}:${session.session_id}`;
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  const idempotencyKey = refreshKeys.get(session) ?? newIdempotencyKey();
  refreshKeys.set(session, idempotencyKey);
  const pending = requestOnce('/agent/auth/refresh', {
    method: 'POST',
    body: { refresh_token: session.refresh_token },
    expectedStatus: 200,
    idempotencyKey,
    decode: decodeAgentSession,
  }).then((next) => {
    if (
      next.account_id !== session.account_id ||
      next.session_id === session.session_id ||
      next.access_token === session.access_token ||
      next.refresh_token === session.refresh_token
    ) {
      throw new AgentApiError('服务响应中的代理会话不匹配', {
        status: 502,
        code: 'INVALID_RESPONSE',
      });
    }
    if (agentAuthSession.matchesSession(session)) {
      if (!agentAuthSession.replaceSession(session, next)) throw sessionChanged();
    } else if (!currentDescendsFrom(session)) {
      throw sessionChanged();
    }
    refreshKeys.delete(session);
    return next;
  }).catch((error: unknown) => {
    if (terminalRefreshFailure(error)) refreshKeys.delete(session);
    throw error;
  }).finally(() => refreshInFlight.delete(key));
  refreshInFlight.set(key, pending);
  return pending;
}

async function retryWithCurrentSession<T>(
  path: string,
  options: AgentRequestOptions<T>,
  ancestor: AgentSession,
): Promise<T> {
  const current = agentAuthSession.state.session;
  if (!current || !currentDescendsFrom(ancestor)) throw sessionChanged();
  try {
    const result = await requestOnce(path, options, current.access_token);
    if (!currentDescendsFrom(ancestor)) throw sessionChanged();
    return result;
  } catch (error) {
    if (!currentDescendsFrom(ancestor)) throw sessionChanged();
    if (!(error instanceof AgentApiError) || error.status !== 401) throw error;
    if (!agentAuthSession.matchesSession(current)) {
      return retryWithCurrentSession(path, options, ancestor);
    }
    agentAuthSession.clearSession(current);
    throw authRequired();
  }
}

export async function agentSessionRequest<T>(
  path: string,
  options: AgentRequestOptions<T>,
): Promise<T> {
  const attempted = agentAuthSession.state.session;
  if (!attempted) {
    if (agentAuthSession.state.restrictedSession) throw passwordChangeRequired();
    throw authRequired();
  }

  try {
    const result = await requestOnce(path, options, attempted.access_token);
    if (!currentDescendsFrom(attempted)) throw sessionChanged();
    return result;
  } catch (error) {
    if (error instanceof AgentApiError && error.code === 'SESSION_CHANGED') throw error;
    if (!(error instanceof AgentApiError) || error.status !== 401) {
      if (!currentDescendsFrom(attempted)) throw sessionChanged();
      throw error;
    }
  }

  if (currentDescendsFrom(attempted) && !agentAuthSession.matchesSession(attempted)) {
    return retryWithCurrentSession(path, options, attempted);
  }
  if (!agentAuthSession.matchesSession(attempted)) throw sessionChanged();

  try {
    await refreshSessionFor(attempted);
  } catch (error) {
    if (!agentAuthSession.matchesSession(attempted)) throw sessionChanged();
    if (!terminalRefreshFailure(error)) throw error;
    agentAuthSession.clearSession(attempted);
    throw authRequired();
  }

  if (!currentDescendsFrom(attempted)) throw sessionChanged();
  return retryWithCurrentSession(path, options, attempted);
}

export async function agentRestrictedRequest<T>(
  path: string,
  options: AgentRequestOptions<T>,
): Promise<T> {
  const attempted = agentAuthSession.state.restrictedSession;
  if (!attempted) throw authRequired();
  try {
    const result = await requestOnce(path, options, attempted.access_token);
    if (!agentAuthSession.matchesRestrictedSession(attempted)) throw sessionChanged();
    return result;
  } catch (error) {
    if (!agentAuthSession.matchesRestrictedSession(attempted)) throw sessionChanged();
    throw error;
  }
}

export async function agentEitherSessionRequest<T>(
  path: string,
  options: AgentRequestOptions<T>,
): Promise<T> {
  if (agentAuthSession.state.session) return agentSessionRequest(path, options);
  return agentRestrictedRequest(path, options);
}
