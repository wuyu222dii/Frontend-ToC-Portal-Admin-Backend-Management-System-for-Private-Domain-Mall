import type { components } from '@qingxu/contracts';

import {
  AdminApiError,
  adminApiRequest as request,
  newIdempotencyKey as idempotencyKey,
  refreshAdminSession,
  withSessionRefresh,
} from './admin-api';
import type {
  AdminAccountCurrent,
  AdminAuthSession,
  AuthPreauthData,
  ChangePasswordInput,
  LoginInput,
  RecoveryCodesData,
  TotpEnrollData,
} from '../types/auth';
import { authSession } from '../stores/auth-session';
import { decodeAdminHighRiskPreviewResponse, decodeSecurityResetResponse } from './admin-b13-decoders';

type CommandResponse = components['schemas']['CommandResponse'];
export { AdminApiError } from './admin-api';

export function login(input: LoginInput): Promise<{ data: AuthPreauthData }> {
  return request('/admin/auth/login', {
    body: { login_name: input.loginName, password: input.password },
    idempotencyKey: idempotencyKey(),
    method: 'POST',
  });
}

export async function verifyLoginTotp(challengeId: string, code: string): Promise<AdminAuthSession> {
  const response = await request<components['schemas']['AdminMfaChallengeVerifyResponse']>(
    `/admin/auth/mfa/challenges/${encodeURIComponent(challengeId)}/verify`,
    {
      auth: 'preauth',
      body: { challenge_id: challengeId, totp_code: code },
      idempotencyKey: idempotencyKey(),
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
    idempotencyKey: idempotencyKey(),
    method: 'POST',
  });
  return response.data;
}

export async function beginTotpEnrollment(): Promise<TotpEnrollData> {
  const response = await request<components['schemas']['TotpEnrollResponse']>('/admin/auth/mfa/totp/enroll', {
    auth: 'preauth',
    body: {},
    idempotencyKey: idempotencyKey(),
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
      idempotencyKey: idempotencyKey(),
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
  return refreshAdminSession();
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

export type SecurityResetPreview = components['schemas']['HighRiskPreviewResponse']['data'];

export async function previewSecurityReset(input: { reason: string; resetPassword: boolean; resetTotp: boolean },
  signal?: AbortSignal): Promise<SecurityResetPreview> {
  const account = authSession.state.current;
  const session = authSession.state.session;
  if (!account || !session) throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  const response = await request<unknown>(`/admin/admin-accounts/${encodeURIComponent(account.account_id)}/security-reset-preview`, {
    auth: 'access',
    body: { reason: input.reason, reset_password: input.resetPassword, reset_totp: input.resetTotp },
    idempotencyKey: idempotencyKey(), method: 'POST', signal,
  });
  if (authSession.state.session?.session_id !== session.session_id || authSession.state.session.account_id !== session.account_id) {
    throw new AdminApiError('登录状态已经变化', { status: 409, code: 'SESSION_CHANGED' });
  }
  return decodeAdminHighRiskPreviewResponse(response);
}

export async function resetSecurity(input: {
  reason: string; resetPassword: boolean; resetTotp: boolean; credentialType: 'TOTP' | 'RECOVERY_CODE';
  credential: string; newPassword: string | null; previewToken: string; confirmationHash: string; resourceEtag: string;
  accountId: string; sessionId: string;
}, signal?: AbortSignal): Promise<components['schemas']['SecurityResetResponse']['data']> {
  const account = authSession.state.current;
  const session = authSession.state.session;
  if (!account || !session) throw new AdminApiError('登录状态已失效，请重新登录', { status: 401, code: 'AUTH_REQUIRED' });
  if (session.account_id !== input.accountId || session.session_id !== input.sessionId || account.account_id !== input.accountId) {
    throw new AdminApiError('登录状态已经变化', { status: 409, code: 'SESSION_CHANGED' });
  }
  if (!/^"[1-9][0-9]*"$/.test(input.resourceEtag)) throw new AdminApiError('预览版本无效', { status: 409, code: 'STATE_CONFLICT' });
  try {
    const response = await request<unknown>(`/admin/admin-accounts/${encodeURIComponent(account.account_id)}/security-resets`, {
      auth: 'access',
      body: {
        reason: input.reason, reset_password: input.resetPassword, reset_totp: input.resetTotp,
        credential_type: input.credentialType, credential: input.credential,
        ...(input.newPassword === null ? {} : { new_password: input.newPassword }),
        preview_token: input.previewToken, confirmation_hash: input.confirmationHash,
      },
      ifMatch: input.resourceEtag,
      idempotencyKey: idempotencyKey(), method: 'POST', signal,
    });
    const data = decodeSecurityResetResponse(response, account.account_id);
    if (data.password_reset !== input.resetPassword || data.totp_reset !== input.resetTotp ||
      data.version !== Number(input.resourceEtag.slice(1, -1)) + 1) {
      throw new AdminApiError('服务响应不匹配，请重新登录核对结果', { status: 502, code: 'INVALID_RESPONSE' });
    }
    return data;
  } finally {
    if (authSession.state.session?.session_id === session.session_id && authSession.state.session.account_id === session.account_id) {
      authSession.clearSession();
    }
  }
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
