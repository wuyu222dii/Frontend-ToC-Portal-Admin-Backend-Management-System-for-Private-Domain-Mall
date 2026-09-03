import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { CacheableFileUploadCompleteResponse, DatabaseRuntime, FileAssetSnapshot } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FileObjectLeaseManager } from './file-object-lease';
import type { UploadIntentInput } from './files.dto';
import { FileAssetsService } from './files.service';
import type { FilesRequestContext } from './files.request';

const accountId = '01J00000000000000000000000';
const agentId = '01J00000000000000000000005';
const sessionId = '01J00000000000000000000001';
const fileId = '01J00000000000000000000002';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const sha256 = 'a'.repeat(64);

function request(role: 'CUSTOMER' | 'SUPER_ADMIN' = 'SUPER_ADMIN'): FilesRequestContext {
  if (role === 'CUSTOMER') {
    return {
      principal: { accountId, assurance: 'WECHAT', permissions: [], restriction: 'NONE', role, sessionId },
      requestId,
      storeSession: {
        accountId, accountVersion: 1, accessJti: 'access-jti', customerId: accountId,
        customerVersion: 1, expiresAt: new Date(), sessionFamily: '01J00000000000000000000004', sessionId,
      },
    };
  }
  return {
    accessSession: {
      accountId, accountVersion: 1, accessJti: 'access-jti', expiresAt: new Date(),
      factorEncryptionKeyId: 'key', factorId: '01J00000000000000000000003', factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(), mfaVerifiedAt: new Date(),
      sessionFamily: '01J00000000000000000000004', sessionId,
    },
    principal: { accountId, assurance: 'MFA', permissions: [], restriction: 'NONE', role, sessionId },
    requestId,
  };
}

function agentRequest(): FilesRequestContext {
  return {
    agentSession: { accountId, agentId, restriction: 'NONE', sessionId },
    principal: {
      accountId, assurance: 'PASSWORD', permissions: [], restriction: 'NONE', role: 'AGENT_ADMIN', sessionId,
    },
    requestId,
  } as unknown as FilesRequestContext;
}

function asset(overrides: Partial<FileAssetSnapshot> = {}): FileAssetSnapshot {
  return {
    byteSize: 12n, createdAt: new Date('2026-08-14T00:00:00.000Z'), createdById: accountId,
    deletedAt: null, id: fileId, mimeType: 'image/png', objectKey: `staging/${fileId}`,
    originalName: 'logo.png', purpose: 'BRAND_LOGO', sha256, status: 'PENDING', visibility: 'PRIVATE',
    ...overrides,
  };
}

function config(): PlatformRuntimeConfig {
  return {
    banner: { targetOrigins: [] },
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    authentication: {} as PlatformRuntimeConfig['authentication'],
    agent: {} as PlatformRuntimeConfig['agent'],
    store: {} as PlatformRuntimeConfig['store'],
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank', key: Buffer.alloc(32, 4) }, previous: [] },
      fieldKeys: { current: { id: 'field', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { provider: 'MOCK', mockSigningKey: Buffer.alloc(32, 4), providerTimeoutMs: 5_000 },
    port: 3000, redis: { url: 'redis://unused' }, service: 'api',
    storage: {
      accessKey: 'local-access-key-value', bucket: 'mall-test', endpoint: 'http://127.0.0.1:9000',
      forcePathStyle: true, maxUploadBytes: 5_242_880, pendingCleanupAgeSeconds: 86_400,
      privateDownloadTtlSeconds: 300, publicBaseUrl: 'http://127.0.0.1:9000/mall-test',
      region: 'us-east-1', secretKey: 'local-secret-key-value', uploadTtlSeconds: 900,
    },
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

interface ServiceInternals {
  agentCommerce: { getAgentPromotionQrDownloadable: ReturnType<typeof vi.fn> };
  assets: { createPendingInTransaction: ReturnType<typeof vi.fn>;
    getAdminDownloadable: ReturnType<typeof vi.fn>;
    getOwned: ReturnType<typeof vi.fn>;
    markReadyInTransaction: ReturnType<typeof vi.fn> };
  audit: { append: ReturnType<typeof vi.fn> };
  idempotency: { claim: ReturnType<typeof vi.fn>; complete: ReturnType<typeof vi.fn>;
    fileUploadCompleteReplay: ReturnType<typeof vi.fn> };
  outbox: { append: ReturnType<typeof vi.fn> };
}

function fixture(claimResults: unknown[] = [{ kind: 'execute' }]) {
  const transaction = {};
  const prisma = { $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)) };
  const database = { prisma } as unknown as DatabaseRuntime;
  const storage = {
    copyIfAbsent: vi.fn().mockResolvedValue({
      copied: true,
      verified: { byteSize: 12, etag: '"0123456789abcdef0123456789abcdef"', mimeType: 'image/png', sha256Hex: sha256 },
    }),
    deleteIfExists: vi.fn().mockResolvedValue(undefined),
    inspectAndHash: vi.fn().mockResolvedValue({
      byteSize: 12, etag: '"0123456789abcdef0123456789abcdef"', mimeType: 'image/png', sha256Hex: sha256,
    }),
    presignGet: vi.fn().mockResolvedValue({
      expiresAt: new Date('2026-08-14T00:05:00.000Z'), headers: [], url: 'https://storage.test/private/file',
    }),
    presignPut: vi.fn().mockResolvedValue({
      expiresAt: new Date('2026-08-14T00:15:00.000Z'),
      headers: [{ name: 'content-type', value: 'image/png' }], url: 'https://storage.test/upload',
    }),
    publicUrl: vi.fn().mockReturnValue('https://cdn.test/public/file'),
  } as unknown as ObjectStoragePort;
  const release = vi.fn().mockResolvedValue(undefined);
  const assertOwned = vi.fn().mockResolvedValue(undefined);
  const leases = { acquire: vi.fn().mockResolvedValue({ assertOwned, release }) } as unknown as FileObjectLeaseManager;
  const service = new FileAssetsService(config(), database, storage, leases);
  const internals = service as unknown as ServiceInternals;
  internals.agentCommerce = { getAgentPromotionQrDownloadable: vi.fn() };
  const claim = vi.fn();
  for (const value of claimResults) claim.mockResolvedValueOnce(value);
  internals.assets = {
    createPendingInTransaction: vi.fn().mockImplementation((_transaction, input: { id: string }) =>
      Promise.resolve(asset({ id: input.id, objectKey: `staging/${input.id}` }))),
    getAdminDownloadable: vi.fn().mockResolvedValue(asset({
      objectKey: `private/${fileId}`,
      purpose: 'AFTERSALE_EVIDENCE',
      status: 'READY',
      visibility: 'PRIVATE',
    })),
    getOwned: vi.fn().mockResolvedValue(asset()),
    markReadyInTransaction: vi.fn().mockResolvedValue({
      asset: asset({ objectKey: `public/${fileId}`, status: 'READY', visibility: 'PUBLIC' }),
      completedAt: new Date('2026-08-14T00:01:00.000Z'),
    }),
  };
  internals.audit = { append: vi.fn().mockResolvedValue({}) };
  internals.idempotency = { claim, complete: vi.fn().mockResolvedValue({}), fileUploadCompleteReplay: vi.fn() };
  internals.outbox = { append: vi.fn().mockResolvedValue({}) };
  return { assertOwned, internals, leases, release, service, storage };
}

function envelope(): CacheableFileUploadCompleteResponse {
  return {
    code: 'OK', data: { completed_at: '2026-08-14T00:01:00.000Z', file_id: fileId,
      public_url: 'https://cdn.test/public/file', purpose: 'BRAND_LOGO', status: 'READY' },
    message: 'success', request_id: requestId,
  };
}

describe('FileAssetsService orchestration', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-08-14T00:01:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores an upload intent, audit and HASH_ONLY fact in one transaction', async () => {
    const f = fixture();
    const result = await f.service.createUploadIntent(request(), {
      filename: 'logo.png', mimeType: 'image/png', purpose: 'BRAND_LOGO', sha256, size: 12,
    }, idempotencyKey);
    expect(result).toMatchObject({ purpose: 'BRAND_LOGO', status: 'PENDING', upload_url: 'https://storage.test/upload' });
    expect(f.internals.assets.createPendingInTransaction).toHaveBeenCalledOnce();
    expect(f.internals.audit.append).toHaveBeenCalledOnce();
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ storage: 'HASH_ONLY' }));
  });

  it('keeps server-generated PROMOTION_QR outside every external upload path', async () => {
    const deniedIntent = fixture();
    await expect(deniedIntent.service.createUploadIntent(request(), {
      filename: 'promotion-qr.png', mimeType: 'image/png', purpose: 'PROMOTION_QR', sha256, size: 12,
    } as unknown as UploadIntentInput, idempotencyKey)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(deniedIntent.storage.presignPut).not.toHaveBeenCalled();
    expect(deniedIntent.internals.assets.createPendingInTransaction).not.toHaveBeenCalled();

    const deniedComplete = fixture([{ kind: 'execute' }]);
    deniedComplete.internals.assets.getOwned.mockResolvedValue(asset({ purpose: 'PROMOTION_QR' }));
    await expect(deniedComplete.service.completeUpload(
      request(), fileId, { sha256, size: 12 }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(deniedComplete.leases.acquire).not.toHaveBeenCalled();
    expect(deniedComplete.storage.inspectAndHash).not.toHaveBeenCalled();

    const deniedReplay = fixture([{ kind: 'replay', record: {} }]);
    deniedReplay.internals.idempotency.fileUploadCompleteReplay.mockReturnValue({
      ...envelope(),
      data: { ...envelope().data, public_url: null, purpose: 'PROMOTION_QR' },
    });
    await expect(deniedReplay.service.completeUpload(
      request(), fileId, { sha256, size: 12 }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(deniedReplay.leases.acquire).not.toHaveBeenCalled();
  });

  it('allows CUSTOMER actors only for their own AFTERSALE_EVIDENCE lifecycle', async () => {
    const allowed = fixture();
    await expect(allowed.service.createUploadIntent(request('CUSTOMER'), {
      filename: 'evidence.png', mimeType: 'image/png', purpose: 'AFTERSALE_EVIDENCE', sha256, size: 12,
    }, idempotencyKey)).resolves.toMatchObject({ purpose: 'AFTERSALE_EVIDENCE', status: 'PENDING' });

    const deniedIntent = fixture();
    await expect(deniedIntent.service.createUploadIntent(request('CUSTOMER'), {
      filename: 'logo.png', mimeType: 'image/png', purpose: 'BRAND_LOGO', sha256, size: 12,
    }, idempotencyKey)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deniedIntent.storage.presignPut).not.toHaveBeenCalled();
    expect(deniedIntent.internals.assets.createPendingInTransaction).not.toHaveBeenCalled();

    const deniedComplete = fixture([{ kind: 'execute' }]);
    await expect(deniedComplete.service.completeUpload(
      request('CUSTOMER'), fileId, { sha256, size: 12 }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deniedComplete.leases.acquire).not.toHaveBeenCalled();
    expect(deniedComplete.storage.inspectAndHash).not.toHaveBeenCalled();

    const deniedDownload = fixture();
    deniedDownload.internals.assets.getOwned.mockResolvedValue(asset({
      objectKey: `private/${fileId}`, purpose: 'WITHDRAWAL_PROOF', status: 'READY', visibility: 'PRIVATE',
    }));
    await expect(deniedDownload.service.downloadUrl(request('CUSTOMER'), fileId))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(deniedDownload.storage.presignGet).not.toHaveBeenCalled();
  });

  it('reauthorizes CUSTOMER purpose before returning an exact cached completion replay', async () => {
    const denied = fixture([{ kind: 'replay', record: {} }]);
    denied.internals.idempotency.fileUploadCompleteReplay.mockReturnValue(envelope());
    await expect(denied.service.completeUpload(
      request('CUSTOMER'), fileId, { sha256, size: 12 }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(denied.leases.acquire).not.toHaveBeenCalled();
  });

  it('replays exact cached completion without acquiring a lease or touching storage', async () => {
    const f = fixture([{ kind: 'replay', record: {} }]);
    f.internals.idempotency.fileUploadCompleteReplay.mockReturnValue(envelope());
    await expect(f.service.completeUpload(request(), fileId, { sha256, size: 12 }, idempotencyKey))
      .resolves.toBeDefined();
    expect(f.leases.acquire).not.toHaveBeenCalled();
    expect(f.storage.inspectAndHash).not.toHaveBeenCalled();
  });

  it('verifies and copies outside the READY transaction, then caches one exact response', async () => {
    const f = fixture([{ kind: 'execute' }, { kind: 'execute' }]);
    await f.service.completeUpload(request(), fileId, { sha256, size: 12 }, idempotencyKey);
    expect(f.storage.inspectAndHash).toHaveBeenCalledWith({ key: `staging/${fileId}`, maxBytes: 5_242_880 });
    expect(f.storage.copyIfAbsent).toHaveBeenCalledBefore(f.internals.assets.markReadyInTransaction);
    expect(f.assertOwned).toHaveBeenCalledTimes(2);
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ policy: 'FILE_UPLOAD_COMPLETE', storage: 'CACHEABLE' }));
    expect(f.storage.deleteIfExists).toHaveBeenCalledWith(`staging/${fileId}`);
    expect(f.internals.outbox.append).toHaveBeenCalledWith(expect.anything(), {
      aggregateId: fileId,
      aggregateType: 'file',
      availableAt: new Date('2026-08-15T00:16:00.000Z'),
      eventType: 'file.staging_cleanup_requested',
      payload: {
        event_version: 1,
        resource_id: fileId,
        resource_type: 'file',
        resource_version: 1,
      },
    });
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('rejects a measured mismatch, never copies it, and releases the owner lease', async () => {
    const f = fixture();
    vi.mocked(f.storage.inspectAndHash).mockResolvedValue({
      byteSize: 11, etag: '"0123456789abcdef0123456789abcdef"', mimeType: 'image/png', sha256Hex: sha256,
    });
    await expect(f.service.completeUpload(request(), fileId, { sha256, size: 12 }, idempotencyKey))
      .rejects.toMatchObject({ code: 'FILE_CONTENT_MISMATCH' } satisfies Partial<ApplicationError>);
    expect(f.storage.copyIfAbsent).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('rejects a final-copy mismatch before the READY transaction', async () => {
    const f = fixture();
    vi.mocked(f.storage.copyIfAbsent).mockResolvedValue({
      copied: true,
      verified: {
        byteSize: 12,
        etag: '"fedcba9876543210fedcba9876543210"',
        mimeType: 'image/png',
        sha256Hex: 'b'.repeat(64),
      },
    });
    await expect(f.service.completeUpload(request(), fileId, { sha256, size: 12 }, idempotencyKey))
      .rejects.toMatchObject({ code: 'FILE_CONTENT_MISMATCH' } satisfies Partial<ApplicationError>);
    expect(f.internals.assets.markReadyInTransaction).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledOnce();
  });

  it('keeps completion successful when immediate staging deletion fails and retains delayed cleanup', async () => {
    const f = fixture([{ kind: 'execute' }, { kind: 'execute' }]);
    const errorLog = vi.spyOn((f.service as unknown as {
      logger: { error(value: unknown): void };
    }).logger, 'error').mockImplementation(() => undefined);
    vi.mocked(f.storage.deleteIfExists).mockRejectedValue(new Error('provider-secret-detail'));
    await expect(f.service.completeUpload(request(), fileId, { sha256, size: 12 }, idempotencyKey))
      .resolves.toBeDefined();
    expect(f.internals.assets.markReadyInTransaction).toHaveBeenCalledOnce();
    expect(f.internals.outbox.append).toHaveBeenCalledOnce();
    expect(f.storage.deleteIfExists).toHaveBeenCalledWith(`staging/${fileId}`);
    expect(f.release).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith({
      error_code: 'FILE_STAGING_DELETE_FAILED', file_id: fileId, service: 'api',
    });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('provider-secret-detail');
  });

  it('converges after copy succeeds but the first READY transaction fails', async () => {
    const f = fixture([
      { kind: 'execute' }, { kind: 'execute' },
      { kind: 'execute' }, { kind: 'execute' },
    ]);
    f.internals.assets.markReadyInTransaction
      .mockRejectedValueOnce(new ApplicationError('INTERNAL_ERROR', 'injected commit failure'))
      .mockResolvedValueOnce({
        asset: asset({ objectKey: `public/${fileId}`, status: 'READY', visibility: 'PUBLIC' }),
        completedAt: new Date('2026-08-14T00:01:00.000Z'),
      });
    vi.mocked(f.storage.copyIfAbsent)
      .mockResolvedValueOnce({
        copied: true,
        verified: {
          byteSize: 12, etag: '"0123456789abcdef0123456789abcdef"',
          mimeType: 'image/png', sha256Hex: sha256,
        },
      })
      .mockResolvedValueOnce({
        copied: false,
        verified: {
          byteSize: 12, etag: '"fedcba9876543210fedcba9876543210"',
          mimeType: 'image/png', sha256Hex: sha256,
        },
      });

    await expect(f.service.completeUpload(request(), fileId, { sha256, size: 12 }, idempotencyKey))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' } satisfies Partial<ApplicationError>);
    expect(f.storage.deleteIfExists).not.toHaveBeenCalled();

    await expect(f.service.completeUpload(request(), fileId, { sha256, size: 12 }, idempotencyKey))
      .resolves.toBeDefined();
    expect(f.storage.inspectAndHash).toHaveBeenCalledTimes(2);
    expect(f.storage.copyIfAbsent).toHaveBeenCalledTimes(2);
    expect(f.storage.deleteIfExists).toHaveBeenCalledOnce();
    expect(f.internals.audit.append).toHaveBeenCalledOnce();
    expect(f.internals.idempotency.complete).toHaveBeenCalledOnce();
    expect(f.internals.outbox.append).toHaveBeenCalledOnce();
  });

  it('signs only private READY downloads and directs public assets to their stable URL', async () => {
    const privateFixture = fixture();
    await expect(privateFixture.service.downloadUrl(request(), fileId)).resolves.toEqual({
      download_url: 'https://storage.test/private/file', expires_at: '2026-08-14T00:05:00.000Z', file_id: fileId,
    });
    expect(privateFixture.internals.assets.getAdminDownloadable)
      .toHaveBeenCalledWith({ actorId: accountId, fileId });
    expect(privateFixture.internals.assets.getOwned).not.toHaveBeenCalled();
    expect(privateFixture.storage.presignGet).toHaveBeenCalledWith(`private/${fileId}`, 300);
    expect(privateFixture.internals.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'READ_SENSITIVE',
      objectId: fileId,
      summaryPolicy: 'NONE',
    }));
    expect(JSON.stringify(privateFixture.internals.audit.append.mock.calls)).not.toContain('storage.test');

    const publicFixture = fixture();
    publicFixture.internals.assets.getAdminDownloadable.mockResolvedValue(asset({
      objectKey: `public/${fileId}`, status: 'READY', visibility: 'PUBLIC',
    }));
    await expect(publicFixture.service.downloadUrl(request(), fileId)).rejects.toMatchObject(
      { code: 'STATE_CONFLICT' } satisfies Partial<ApplicationError>,
    );
    expect(publicFixture.storage.presignGet).not.toHaveBeenCalled();
  });

  it('keeps CUSTOMER downloads owner-scoped and never uses the Admin evidence lookup', async () => {
    const f = fixture();
    f.internals.assets.getOwned.mockResolvedValue(asset({
      objectKey: `private/${fileId}`,
      purpose: 'AFTERSALE_EVIDENCE',
      status: 'READY',
      visibility: 'PRIVATE',
    }));
    await expect(f.service.downloadUrl(request('CUSTOMER'), fileId)).resolves.toMatchObject({ file_id: fileId });
    expect(f.internals.assets.getOwned).toHaveBeenCalledWith({ actorId: accountId, fileId });
    expect(f.internals.assets.getAdminDownloadable).not.toHaveBeenCalled();
  });

  it('allows an Agent to download only its bound private promotion QR', async () => {
    const f = fixture();
    f.internals.agentCommerce.getAgentPromotionQrDownloadable.mockResolvedValue(asset({
      objectKey: `private/${fileId}`,
      purpose: 'PROMOTION_QR',
      status: 'READY',
      visibility: 'PRIVATE',
    }));

    await expect(f.service.downloadUrl(agentRequest(), fileId)).resolves.toMatchObject({ file_id: fileId });
    expect(f.internals.agentCommerce.getAgentPromotionQrDownloadable).toHaveBeenCalledWith({
      accountId,
      agentId,
      fileId,
    });
    expect(f.internals.assets.getAdminDownloadable).not.toHaveBeenCalled();
    expect(f.internals.assets.getOwned).not.toHaveBeenCalled();
    expect(f.internals.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorRole: 'AGENT_ADMIN',
    }));
  });

  it('does not sign an Admin download when the file is neither owned nor bound as aftersale evidence', async () => {
    const f = fixture();
    f.internals.assets.getAdminDownloadable.mockRejectedValue(
      new ApplicationError('RESOURCE_NOT_FOUND', 'File asset is not authorized'),
    );
    await expect(f.service.downloadUrl(request(), fileId))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(f.internals.assets.getOwned).not.toHaveBeenCalled();
    expect(f.storage.presignGet).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
  });
});
