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
