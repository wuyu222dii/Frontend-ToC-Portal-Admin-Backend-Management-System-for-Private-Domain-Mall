import { describe, expect, it } from 'vitest';

import { parseSecurityResetConfirmBody, parseSecurityResetPreviewBody } from './admin-auth.dto';

describe('HR-15 security reset decoding', () => {
  it('keeps preview closed and credential-free', () => {
    expect(parseSecurityResetPreviewBody({ reason: 'routine rotation', reset_password: true, reset_totp: false }))
      .toEqual({ reason: 'routine rotation', resetPassword: true, resetTotp: false });
    expect(() => parseSecurityResetPreviewBody({ reason: 'x', reset_password: false, reset_totp: false }))
      .toThrow();
  });

  it('requires new_password only for password reset and rejects unknown fields', () => {
    expect(parseSecurityResetConfirmBody({
      reason: 'routine rotation', reset_password: true, reset_totp: true,
      credential_type: 'TOTP', credential: '123456', new_password: 'A-secure-password-123',
      preview_token: 'pvw_1234567890123456', confirmation_hash: 'a'.repeat(64),
    }).newPassword).toBe('A-secure-password-123');
    expect(() => parseSecurityResetConfirmBody({
      reason: 'routine rotation', reset_password: true, reset_totp: false,
      credential_type: 'TOTP', credential: '123456', preview_token: 'pvw_1234567890123456', confirmation_hash: 'a'.repeat(64),
    })).toThrow();
    expect(() => parseSecurityResetConfirmBody({
      reason: 'routine rotation', reset_password: false, reset_totp: true,
      credential_type: 'TOTP', credential: '123456', new_password: 'A-secure-password-123',
      preview_token: 'pvw_1234567890123456', confirmation_hash: 'a'.repeat(64),
    })).toThrow();
  });
});
