import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseSecurityResetConfirmBody, parseSecurityResetPreviewBody } from './admin-auth.dto';
import { AdminAccountSecurityController } from './admin-account-security.controller';
import { AdminAuthService } from './admin-auth.service';
import { parseOfflineRecoveryArguments } from './admin-offline-recovery.cli';
import { decodeAdminHighRiskPreviewResponse, decodeSecurityResetResponse } from '../../../admin-web/src/services/admin-b13-decoders';
import { resetSecurity } from '../../../admin-web/src/services/admin-auth';
import { authSession } from '../../../admin-web/src/stores/auth-session';

const ACCOUNT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const previewBody = { reason: 'routine rotation', reset_password: true, reset_totp: false };
const confirmBody = { ...previewBody, credential_type: 'RECOVERY_CODE', credential: 'synthetic-recovery-code',
  new_password: 'Synthetic-password-19', preview_token: 'pvw_1234567890123456', confirmation_hash: 'a'.repeat(64) };
const success = { code: 'OK', message: 'success', request_id: 'req_'.concat('1'.repeat(32)),
  data: { account_id: ACCOUNT_ID, password_reset: false, totp_reset: true, sessions_revoked_at: '2026-09-07T00:00:00.000Z', version: 2 } };

afterEach(() => { vi.unstubAllGlobals(); authSession.clearSession(); });

describe('HR-15 security reset decoding', () => {
  it('keeps preview closed and credential-free', () => {
    expect(parseSecurityResetPreviewBody({ reason: 'routine rotation', reset_password: true, reset_totp: false }))
      .toEqual({ reason: 'routine rotation', resetPassword: true, resetTotp: false });
    expect(() => parseSecurityResetPreviewBody({ reason: 'x', reset_password: false, reset_totp: false }))
      .toThrow();
    for (const field of ['credential', 'credential_type', 'new_password', 'preview_token', 'unknown']) {
      expect(() => parseSecurityResetPreviewBody({ ...previewBody, [field]: 'forbidden' })).toThrow();
    }
  });

  it('requires new_password only for password reset and rejects unknown fields', () => {
    expect(() => parseSecurityResetConfirmBody({ ...confirmBody, unknown: 'forbidden' })).toThrow();
    expect(() => parseSecurityResetConfirmBody({ ...confirmBody, new_password: 'x'.repeat(129) })).toThrow();
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

  it('rejects cross-account calls before invoking either service method', () => {
    const auth = { previewSecurityReset: vi.fn(), resetSecurity: vi.fn() };
    const controller = new AdminAccountSecurityController(auth as never);
    const request = { accessSession: { accountId: ACCOUNT_ID } } as never;
    expect(() => controller.preview(OTHER_ID, previewBody, 'key', request)).toThrow(expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }));
    expect(() => controller.reset(OTHER_ID, confirmBody, 1, 'key', request)).toThrow(expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }));
    expect(auth.previewSecurityReset).not.toHaveBeenCalled();
    expect(auth.resetSecurity).not.toHaveBeenCalled();
  });

  it('strictly decodes preview/reset envelopes and rejects sensitive or mismatched fields', () => {
    const preview = { ...success, data: { preview_token: confirmBody.preview_token, confirmation_hash: confirmBody.confirmation_hash,
      resource_etag: '"1"', expires_at: '2026-09-07T00:00:00.000Z', impact: { affected_count: 1, metrics: [], warnings: [] } } };
    expect(decodeAdminHighRiskPreviewResponse(preview).resource_etag).toBe('"1"');
    expect(decodeSecurityResetResponse(success, ACCOUNT_ID)).toEqual(success.data);
    expect(() => decodeSecurityResetResponse(success, OTHER_ID)).toThrow();
    for (const field of ['password', 'credential', 'token']) {
      expect(() => decodeSecurityResetResponse({ ...success, data: { ...success.data, [field]: 'forbidden' } }, ACCOUNT_ID)).toThrow();
      expect(() => decodeAdminHighRiskPreviewResponse({ ...preview, data: { ...preview.data, [field]: 'forbidden' } })).toThrow();
    }
  });

  it('parses CLI recovery-code selection and uses the recovery version, never secret arguments', () => {
    expect(parseOfflineRecoveryArguments(['execute', ACCOUNT_ID, OTHER_ID, '3', 'RECOVERY_CODE']))
      .toMatchObject({ command: 'execute', expectedRecoveryVersion: 3, credentialType: 'RECOVERY_CODE' });
    for (const version of ['0', '1.2', '9007199254740993', '"3"']) {
      expect(() => parseOfflineRecoveryArguments(['execute', ACCOUNT_ID, OTHER_ID, version])).toThrow();
    }
    expect(() => parseOfflineRecoveryArguments(['execute', ACCOUNT_ID, OTHER_ID, '3', '123456'])).toThrow();
    expect(() => parseOfflineRecoveryArguments(['request', ACCOUNT_ID, OTHER_ID, 'reason', 'TOTP', 'password'])).toThrow();
  });

  it.each([403, 429])('commits credential failure with HTTP %s and replays it without consuming again', async (status) => {
    const auth = { resetSecurityInTransaction: vi.fn(async () => ({ kind: status === 429 ? 'locked' : 'recorded' })) };
    const complete = vi.fn();
    const claim = vi.fn().mockResolvedValueOnce({ kind: 'claimed' })
      .mockResolvedValueOnce({ kind: 'replay', record: { response_status: status, response_body: null } });
    const service = Object.assign(Object.create(AdminAuthService.prototype) as AdminAuthService, {
      database: { prisma: { $transaction: async (work: (tx: object) => unknown) => work({}) } },
      config: { authentication: { secretHashKeys: { current: { key: Buffer.alloc(32, 19) }, previous: [] } } },
      auth, audit: { append: vi.fn() }, idempotency: { claim, complete },
      previews: { consumeInTransaction: vi.fn() },
    });
    const input = parseSecurityResetConfirmBody({ ...confirmBody, reset_password: false, reset_totp: true, new_password: undefined });
    const session = { accountId: ACCOUNT_ID, accountVersion: 1 } as never;
    const error = { code: status === 429 ? 'RATE_LIMITED' : 'PERMISSION_DENIED' };
    await expect(service.resetSecurity(session, input, 1, 'key', success.request_id)).rejects.toMatchObject(error);
    expect(complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ responseStatus: status, storage: 'HASH_ONLY' }));
    await expect(service.resetSecurity(session, input, 1, 'key', success.request_id)).rejects.toMatchObject(error);
    expect(auth.resetSecurityInTransaction).toHaveBeenCalledTimes(1);
  });

  it('caches only the redacted success and does not consume credentials on identical replay', async () => {
    const response = { ...success, data: { ...success.data } };
    const auth = { resetSecurityInTransaction: vi.fn(async () => ({ kind: 'reset', version: 2, sessionsRevokedAt: new Date(success.data.sessions_revoked_at) })) };
    const complete = vi.fn();
    const service = Object.assign(Object.create(AdminAuthService.prototype) as AdminAuthService, {
      database: { prisma: { $transaction: async (work: (tx: object) => unknown) => work({}) } },
      config: { authentication: { secretHashKeys: { current: { key: Buffer.alloc(32, 19) }, previous: [] } } },
      auth, audit: { append: vi.fn() },
      idempotency: { claim: vi.fn().mockResolvedValueOnce({ kind: 'claimed' }).mockResolvedValueOnce({ kind: 'replay', record: { response_body: response, response_status: 200 } }),
        complete, securityResetReplay: vi.fn(() => response) }, previews: { consumeInTransaction: vi.fn() },
    });
    const input = parseSecurityResetConfirmBody({ ...confirmBody, reset_password: false, reset_totp: true, new_password: undefined });
    await service.resetSecurity({ accountId: ACCOUNT_ID } as never, input, 1, 'key', success.request_id);
    const cached = complete.mock.calls[0]![2];
    expect(cached).toMatchObject({ policy: 'SECURITY_RESET_RESPONSE', storage: 'CACHEABLE', responseBody: response });
    expect(JSON.stringify(cached)).not.toContain(input.credential);
    await service.resetSecurity({ accountId: ACCOUNT_ID } as never, input, 1, 'key', success.request_id);
    expect(auth.resetSecurityInTransaction).toHaveBeenCalledTimes(1);
  });

  it('sends the preview ETag without refresh and never clears a newer login on a late response', async () => {
    const session = { account_id: ACCOUNT_ID, session_id: ACCOUNT_ID, role: 'SUPER_ADMIN', assurance: 'MFA', restriction: 'NONE', access_token: 'synthetic-access' } as const;
    authSession.acceptSession(session as never);
    authSession.state.current = { account_id: ACCOUNT_ID, version: 99 } as never;
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((done) => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const pending = resetSecurity({ accountId: ACCOUNT_ID, sessionId: ACCOUNT_ID, reason: 'Synthetic reset',
      resetPassword: false, resetTotp: true, credentialType: 'RECOVERY_CODE', credential: 'synthetic-code', newPassword: null,
      previewToken: confirmBody.preview_token, confirmationHash: confirmBody.confirmation_hash, resourceEtag: '"1"' });
    const headers = new Headers((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get('If-Match')).toBe('"1"');
    authSession.acceptSession({ ...session, session_id: OTHER_ID } as never);
    resolve(new Response(JSON.stringify(success), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    await pending;
    expect(authSession.state.session?.session_id).toBe(OTHER_ID);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
