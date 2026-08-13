import type { components } from '@qingxu/contracts';

export type ErrorResponse = components['schemas']['ErrorResponse'];
export type AuthPreauthData = components['schemas']['AuthPreauthData'];
export type AdminAuthSession = components['schemas']['AdminAuthSessionData'];
export type AdminAccountCurrent = components['schemas']['AdminAccountCurrentView'];
export type TotpEnrollData = components['schemas']['TotpEnrollResponse']['data'];
export type RecoveryCodesData = components['schemas']['RotateRecoveryCodesResponse']['data'];

export interface LoginInput {
  loginName: string;
  password: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

