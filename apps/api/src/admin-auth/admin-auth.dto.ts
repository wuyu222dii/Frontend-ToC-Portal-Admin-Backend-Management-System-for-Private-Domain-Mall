import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

type PlainBody = Record<string, unknown>;

function objectWithFields(value: unknown, required: readonly string[], optional: readonly string[] = []): PlainBody {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new ApplicationError('INVALID_ARGUMENT', 'Request body must be an object');
  }
  const body = value as PlainBody;
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !(field in body)) || Object.keys(body).some((field) => !allowed.has(field))) {
    throw new ApplicationError('INVALID_ARGUMENT', 'Request body fields are invalid');
  }
  return body;
}

function stringField(body: PlainBody, field: string, minimum = 0, maximum?: number): string {
  const value = body[field];
  const length = typeof value === 'string' ? Array.from(value).length : -1;
  if (typeof value !== 'string' || length < minimum || (maximum !== undefined && length > maximum)) {
    throw new ApplicationError('INVALID_ARGUMENT', `${field} is invalid`);
  }
  return value;
}

function ulidField(body: PlainBody, field: string): string {
  const value = stringField(body, field, 1);
  if (!isValidUlid(value)) throw new ApplicationError('INVALID_ARGUMENT', `${field} is invalid`);
  return value;
}

export function parseLoginBody(value: unknown) {
  const body = objectWithFields(value, ['login_name', 'password']);
  return {
    loginName: stringField(body, 'login_name', 1, 80),
    password: stringField(body, 'password', 8, 128),
  };
}

export function parseRefreshBody(value: unknown) {
  const body = objectWithFields(value, ['refresh_token']);
  return { refreshToken: stringField(body, 'refresh_token', 20, 512) };
}

export function parseChangePasswordBody(value: unknown) {
  const body = objectWithFields(value, ['current_password', 'new_password']);
  return {
    currentPassword: stringField(body, 'current_password', 8, 128),
    newPassword: stringField(body, 'new_password', 12, 128),
  };
}

export function parseEnrollBody(value: unknown) {
  const body = objectWithFields(value, [], ['label']);
  return body.label === undefined ? {} : { label: stringField(body, 'label', 0, 80) };
}

export function parseTotpVerifyBody(value: unknown) {
  const body = objectWithFields(value, ['challenge_id', 'totp_code']);
  const totpCode = stringField(body, 'totp_code', 6, 6);
  if (!/^\d{6}$/.test(totpCode)) throw new ApplicationError('INVALID_ARGUMENT', 'totp_code is invalid');
  return { challengeId: ulidField(body, 'challenge_id'), totpCode };
}

export function parseMfaChallengeBody(value: unknown) {
  const body = objectWithFields(value, ['purpose'], ['target_id']);
  if (body.purpose !== 'REAUTH') throw new ApplicationError('INVALID_ARGUMENT', 'purpose is invalid');
  if (body.target_id === undefined) return { purpose: 'REAUTH' as const };
  if (body.target_id === null) return { purpose: 'REAUTH' as const, targetId: null };
  return { purpose: 'REAUTH' as const, targetId: ulidField(body, 'target_id') };
}

export function parsePayoutReauthBody(value: unknown) {
  const body = objectWithFields(value, ['action', 'withdrawal_id', 'totp_code']);
  if (body.action !== 'PAYOUT_ACCOUNT_REVEAL') {
    throw new ApplicationError('INVALID_ARGUMENT', 'action is invalid');
  }
  const totpCode = stringField(body, 'totp_code', 6, 6);
  if (!/^\d{6}$/.test(totpCode)) throw new ApplicationError('INVALID_ARGUMENT', 'totp_code is invalid');
  return {
    action: 'PAYOUT_ACCOUNT_REVEAL' as const,
    withdrawalId: ulidField(body, 'withdrawal_id'),
    totpCode,
  };
}

export function parseTotpBody(value: unknown) {
  const body = objectWithFields(value, ['totp_code']);
  const totpCode = stringField(body, 'totp_code', 6, 6);
  if (!/^\d{6}$/.test(totpCode)) throw new ApplicationError('INVALID_ARGUMENT', 'totp_code is invalid');
  return { totpCode };
}

export function parseRecoveryBody(value: unknown) {
  const body = objectWithFields(value, ['challenge_id', 'recovery_code']);
  return { challengeId: ulidField(body, 'challenge_id'), recoveryCode: stringField(body, 'recovery_code', 8, 2_048) };
}

export function parseChallengeId(value: string): string {
  if (!isValidUlid(value)) throw new ApplicationError('INVALID_ARGUMENT', 'challenge_id is invalid');
  return value;
}
