import { ApplicationError } from '@qingxu/platform-core';
import { REQUIRED_ROLES } from '../platform/access/rbac.metadata';
import { CUSTOMER_OR_SUPER_ADMIN } from '../platform/auth/customer-or-super-admin.metadata';
import { describe, expect, it, vi } from 'vitest';

import { FilesController } from './files.controller';
import type { FilesRequestContext } from './files.request';
import type { FileAssetsService } from './files.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const fileId = '01J00000000000000000000002';

function context(): FilesRequestContext {
  return {
    accessSession: {
      accountId, accountVersion: 1, accessJti: 'access-jti', expiresAt: new Date(),
      factorEncryptionKeyId: 'key', factorId: '01J00000000000000000000003', factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(), mfaVerifiedAt: new Date(),
      sessionFamily: '01J00000000000000000000004', sessionId,
    },
    principal: { accountId, assurance: 'MFA', permissions: [], restriction: 'NONE', role: 'SUPER_ADMIN', sessionId },
    requestId: 'req_0123456789abcdef0123456789abcdef',
  };
}

describe('FilesController', () => {
  it('admits only headquarters administrators and CUSTOMER evidence actors at the route boundary', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, FilesController)).toEqual(['CUSTOMER', 'SUPER_ADMIN']);
    expect(Reflect.getMetadata(CUSTOMER_OR_SUPER_ADMIN, FilesController)).toBe(true);
  });

  it('binds the authenticated request actor and parsed path without accepting owner input', () => {
    const service = { completeUpload: vi.fn().mockResolvedValue({}) } as unknown as FileAssetsService;
    const controller = new FilesController(service);
    const request = context();
    controller.completeUpload(fileId, { sha256: 'a'.repeat(64), size: 1 },
      '00000000-0000-4000-8000-000000000000', request);
    expect(service.completeUpload).toHaveBeenCalledWith(request, fileId,
      { sha256: 'a'.repeat(64), size: 1 }, '00000000-0000-4000-8000-000000000000');
  });

  it('rejects traversal before invoking the service', () => {
    const service = { downloadUrl: vi.fn() } as unknown as FileAssetsService;
    const controller = new FilesController(service);
    expect(() => controller.downloadUrl('../private/object', context())).toThrowError(ApplicationError);
    expect(service.downloadUrl).not.toHaveBeenCalled();
  });
});
