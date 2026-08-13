import type { components } from '@qingxu/contracts';

import { authSession } from '../stores/auth-session';
import type {
  AdminAccountCurrent,
  AdminAuthSession,
  AuthPreauthData,
  ChangePasswordInput,
  ErrorResponse,
  LoginInput,
  RecoveryCodesData,
  TotpEnrollData,
} from '../types/auth';

type CommandResponse = components['schemas']['CommandResponse'];
type JsonRecord = Record<string, unknown>;

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

function idempotencyKey(): string {
  return crypto.randomUUID();
}

function bearer(kind: 'access' | 'preauth'): string | undefined {
  return kind === 'access'
    ? authSession.state.session?.access_token
    : authSession.state.preauth?.pre_auth_token;
}

async function request<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: JsonRecord;
    auth?: 'access' | 'preauth';
    idempotent?: boolean;
    idempotencyKey?: string;
  } = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' });
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (options.auth !== undefined) {
    const token = bearer(options.auth);
    if (!token) throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
  else if (options.idempotent) headers.set('Idempotency-Key', idempotencyKey());

  let response: Response;
  try {
    const init: RequestInit = {
      cache: 'no-store',
      credentials: 'omit',
      headers,
      method: options.method ?? 'GET',
    };
    if (options.body !== undefined) init.body = JSON.stringify(options.body);
    response = await fetch(`/api/v1${path}`, init);
  } catch {
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

export function login(input: LoginInput): Promise<{ data: AuthPreauthData }> {
  return request('/admin/auth/login', {
    body: { login_name: input.loginName, password: input.password },
    idempotent: true,
    method: 'POST',
  });
}

export async function verifyLoginTotp(challengeId: string, code: string): Promise<AdminAuthSession> {
  const response = await request<components['schemas']['AdminMfaChallengeVerifyResponse']>(
    `/admin/auth/mfa/challenges/${encodeURIComponent(challengeId)}/verify`,
    {
      auth: 'preauth',
      body: { challenge_id: challengeId, totp_code: code },
      idempotent: true,
      method: 'POST',
    },
  );
  if (!('access_token' in response.data)) {
    throw new AdminApiError('身份验证用途不匹配，请重新登录', { status: 409, code: 'MFA_PURPOSE_MISMATCH' });
  }
  return response.data;
}

export async function loginWithRecoveryCode(challengeId: string, recoveryCode: string): Promise<AdminAuthSession> {
  const response = await request<components['schemas']['AdminAuthSessionResponse']>('/admin/auth/mfa/recovery', {
    auth: 'preauth',
    body: { challenge_id: challengeId, recovery_code: recoveryCode },
    idempotent: true,
    method: 'POST',
  });
  return response.data;
}

export async function beginTotpEnrollment(): Promise<TotpEnrollData> {
  const response = await request<components['schemas']['TotpEnrollResponse']>('/admin/auth/mfa/totp/enroll', {
    auth: 'preauth',
    body: {},
    idempotent: true,
    method: 'POST',
  });
  return response.data;
}

export async function verifyTotpEnrollment(challengeId: string, code: string): Promise<{
  session: AdminAuthSession;
  recoveryCodes: string[];
}> {
  const response = await request<components['schemas']['TotpEnrollVerifyResponse']>(
    '/admin/auth/mfa/totp/enroll/verify',
    {
      auth: 'preauth',
      body: { challenge_id: challengeId, totp_code: code },
      idempotent: true,
      method: 'POST',
    },
  );
  return { recoveryCodes: response.data.recovery_codes, session: response.data.session };
}

export async function getCurrentAccount(): Promise<AdminAccountCurrent> {
  return withSessionRefresh(async () => {
    const response = await request<components['schemas']['AdminAccountCurrentResponse']>('/admin/auth/current', {
      auth: 'access',
    });
    return response.data;
  });
}

export async function refreshSession(): Promise<AdminAuthSession> {
  const refreshToken = authSession.state.session?.refresh_token;
  if (!refreshToken) throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  const response = await request<components['schemas']['AdminAuthSessionResponse']>('/admin/auth/refresh', {
    body: { refresh_token: refreshToken },
    idempotent: true,
    method: 'POST',
  });
  return response.data;
}

async function withSessionRefresh<T>(operation: () => Promise<T>): Promise<T> {
  const attemptedAccessToken = authSession.state.session?.access_token;
  try {
    return await operation();
  } catch (error) {
    if (!(error instanceof AdminApiError) || error.status !== 401 || !authSession.state.session?.refresh_token) {
      throw error;
    }
  }
  if (authSession.state.session?.access_token !== attemptedAccessToken) return operation();
  try {
    const pendingRefresh = refreshInFlight ??= refreshSession();
    try {
      authSession.acceptSession(await pendingRefresh);
    } finally {
      if (refreshInFlight === pendingRefresh) refreshInFlight = null;
    }
    return await operation();
  } catch (error) {
    authSession.clearSession();
    throw error;
  }
}

export function changePassword(input: ChangePasswordInput): Promise<CommandResponse> {
  const requestKey = idempotencyKey();
  return withSessionRefresh(() => request('/admin/auth/change-password', {
      auth: 'access',
      body: { current_password: input.currentPassword, new_password: input.newPassword },
      idempotencyKey: requestKey,
      method: 'POST',
    }));
}

export async function rotateRecoveryCodes(code: string): Promise<RecoveryCodesData> {
  const requestKey = idempotencyKey();
  const response = await withSessionRefresh(() => request<components['schemas']['RotateRecoveryCodesResponse']>(
      '/admin/auth/mfa/recovery-codes/rotate',
      {
        auth: 'access',
        body: { totp_code: code },
        idempotencyKey: requestKey,
        method: 'POST',
      },
    ));
  return response.data;
}

export function logout(): Promise<CommandResponse> {
  const requestKey = idempotencyKey();
  return withSessionRefresh(() => request('/admin/auth/logout', {
      auth: 'access',
      idempotencyKey: requestKey,
      method: 'POST',
    }));
}

export function logoutAll(): Promise<CommandResponse> {
  const requestKey = idempotencyKey();
  return withSessionRefresh(() => request('/admin/auth/logout-all', {
      auth: 'access',
      idempotencyKey: requestKey,
      method: 'POST',
    }));
}
