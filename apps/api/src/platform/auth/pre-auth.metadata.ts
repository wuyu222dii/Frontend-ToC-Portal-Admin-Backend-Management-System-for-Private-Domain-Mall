import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PRE_AUTH_ACTION = Symbol('required-pre-auth-action');
export const ADMIN_MFA_CHALLENGE_AUTHENTICATION = Symbol('admin-mfa-challenge-authentication');

export type PreAuthAction = 'ENROLL_TOTP' | 'VERIFY_TOTP';

export const RequirePreAuth = (action: PreAuthAction) =>
  SetMetadata(REQUIRED_PRE_AUTH_ACTION, action);

export const RequireAdminMfaChallengeAuthentication = () =>
  SetMetadata(ADMIN_MFA_CHALLENGE_AUTHENTICATION, true);
