import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthController } from './admin-auth.controller';
import type { AdminAuthRequestContext } from './admin-auth.request';
import type { AdminAuthService } from './admin-auth.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const challengeId = '01J00000000000000000000002';

function context(): AdminAuthRequestContext {
  return {
    accessSession: {
      accountId, accountVersion: 1, accessJti: 'access-jti-1234567890', expiresAt: new Date(),
      factorEncryptionKeyId: 'key-id', factorId: '01J00000000000000000000003',
      factorLastUsedTimestep: null, factorSecretCiphertext: new Uint8Array(), mfaVerifiedAt: new Date(),
      sessionFamily: '01J00000000000000000000004', sessionId,
    },
    authorizationToken: 'pre-auth-token',
    preAuth: {
      accountId, accountVersion: 1, challengeId, expiresAt: new Date(), nextAction: 'VERIFY_TOTP',
      tokenId: '01J00000000000000000000005',
    },
    principal: { accountId, assurance: 'MFA', permissions: [], restriction: 'NONE', role: 'SUPER_ADMIN', sessionId },
    requestId: 'req_0123456789abcdef0123456789abcdef',
  };
}

describe('AdminAuthController', () => {
  it('keeps the B2 LOGIN challenge path and body bound to the same identifier', async () => {
    const service = {
      verifyLogin: vi.fn().mockRejectedValue(new ApplicationError('INVALID_ARGUMENT', 'mismatch')),
    } as unknown as AdminAuthService;
    const controller = new AdminAuthController(service);
    await expect(controller.verifyLogin(challengeId, {
      challenge_id: challengeId,
      totp_code: '123456',
    }, '00000000-0000-4000-8000-000000000000', context())).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('uses closed runtime DTOs', () => {
    const service = { login: vi.fn() } as unknown as AdminAuthService;
    const controller = new AdminAuthController(service);
    expect(() => controller.login({ login_name: 'admin', password: '12345678', extra: true },
      '00000000-0000-4000-8000-000000000000', context())).toThrowError(ApplicationError);
    expect(service.login).not.toHaveBeenCalled();
  });

  it('enforces the shared credential length bounds before service dispatch', () => {
    const service = { login: vi.fn() } as unknown as AdminAuthService;
    const controller = new AdminAuthController(service);
    expect(() => controller.login({ login_name: 'admin', password: 'p'.repeat(129) },
      '00000000-0000-4000-8000-000000000000', context())).toThrowError(ApplicationError);
    expect(() => controller.login({ login_name: 'a'.repeat(81), password: 'password123' },
      '00000000-0000-4000-8000-000000000000', context())).toThrowError(ApplicationError);
    expect(service.login).not.toHaveBeenCalled();
  });

  it('counts shared string bounds as Unicode code points', () => {
    const service = { login: vi.fn() } as unknown as AdminAuthService;
    const controller = new AdminAuthController(service);
    const loginName = '\u{1F642}'.repeat(80);
    const request = context();
    controller.login({ login_name: loginName, password: 'password123' },
      '00000000-0000-4000-8000-000000000000', request);
    expect(service.login).toHaveBeenCalledWith(
      { loginName, password: 'password123' },
      '00000000-0000-4000-8000-000000000000',
      request.requestId,
      undefined,
    );
  });
});
