import { SetMetadata } from '@nestjs/common';

export const REQUIRED_PRE_AUTH_ACTION = Symbol('required-pre-auth-action');

export type PreAuthAction = 'ENROLL_TOTP' | 'VERIFY_TOTP';

export const RequirePreAuth = (action: PreAuthAction) =>
  SetMetadata(REQUIRED_PRE_AUTH_ACTION, action);
