import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  BannerSnapshot,
  CacheableBannerResourceResponse,
  DatabaseRuntime,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { AdminBannersService } from './admin-banners.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const factorId = '01J00000000000000000000002';
const bannerId = '01J00000000000000000000003';
const fileId = '01J00000000000000000000004';
const targetId = '01J00000000000000000000005';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';

function config(): PlatformRuntimeConfig {
  return {
    authentication: {} as PlatformRuntimeConfig['authentication'],
    agent: {} as PlatformRuntimeConfig['agent'],
    store: {} as PlatformRuntimeConfig['store'],
    banner: { targetOrigins: ['https://mall.example.test'] },
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank', key: Buffer.alloc(32, 4) }, previous: [] },
      fieldKeys: { current: { id: 'field', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { provider: 'MOCK', mockSigningKey: Buffer.alloc(32, 4), providerTimeoutMs: 5_000 },
    port: 3000,
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

function requestContext(): AdminCatalogRequestContext {
  return {
    accessSession: {
      accountId,
      accountVersion: 1,
      accessJti: 'access-jti',
      expiresAt: new Date('2026-08-25T01:00:00.000Z'),
      factorEncryptionKeyId: 'key',
      factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-08-25T00:00:00.000Z'),
      sessionFamily: '01J00000000000000000000006',
      sessionId,
    },
    principal: {
      accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId,
    },
    requestId,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function banner(overrides: Partial<BannerSnapshot> = {}): BannerSnapshot {
  return {
    createdAt: new Date('2026-08-25T00:00:00.000Z'),
    deletedAt: null,
    endsAt: new Date('2026-09-01T00:00:00.000Z'),
    fileId,
    fileObjectKey: `public/${fileId}`,
    id: bannerId,
    sortOrder: 0,
    startsAt: new Date('2026-08-25T00:00:00.000Z'),
    status: 'DRAFT',
    targetId: null,
    targetType: 'NONE',
    targetUrl: null,
    title: 'Homepage campaign',
    updatedAt: new Date('2026-08-25T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function cachedResponse(overrides: Partial<CacheableBannerResourceResponse> = {}): CacheableBannerResourceResponse {
  return {
    code: 'OK',
    data: {
      banner_id: bannerId,
      ends_at: '2026-09-01T00:00:00.000Z',
      file_id: fileId,
      image_url: `https://cdn.test/public/${fileId}`,
      sort_order: 0,
      starts_at: '2026-08-25T00:00:00.000Z',
      status: 'DRAFT',
      target_id: null,
      target_type: 'NONE',
      target_url: null,
      title: 'Homepage campaign',
      version: 1,
    },
    message: 'success',
    request_id: requestId,
    ...overrides,
  };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  banners: {
    archiveBannerInTransaction: ReturnType<typeof vi.fn>;
    changeBannerStatusInTransaction: ReturnType<typeof vi.fn>;
    createBannerInTransaction: ReturnType<typeof vi.fn>;
    listBanners: ReturnType<typeof vi.fn>;
    restoreBannerInTransaction: ReturnType<typeof vi.fn>;
    updateBannerInTransaction: ReturnType<typeof vi.fn>;
  };
  config: PlatformRuntimeConfig;
  database: DatabaseRuntime;
  idempotency: {
    bannerResourceReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  storage: ObjectStoragePort;
}

function fixture(claims: unknown[] = [{ kind: 'execute' }]) {
  const transaction = {};
  const database = {
    prisma: { $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)) },
  } as unknown as DatabaseRuntime;
  const storage = {
    publicUrl: vi.fn((key: string) => `https://cdn.test/${key}`),
  } as unknown as ObjectStoragePort;
  const service = new AdminBannersService();
  const internals = service as unknown as ServiceInternals;
  internals.config = config();
  internals.database = database;
  internals.storage = storage;
  const claim = vi.fn();
  for (const result of claims) claim.mockResolvedValueOnce(result);
  internals.audit = { append: vi.fn().mockResolvedValue({}) };
  internals.banners = {
    archiveBannerInTransaction: vi.fn().mockResolvedValue(banner({
      deletedAt: new Date('2026-08-25T00:01:00.000Z'), status: 'ARCHIVED', version: 2,
    })),
    changeBannerStatusInTransaction: vi.fn().mockResolvedValue(banner({ status: 'ACTIVE', version: 2 })),
    createBannerInTransaction: vi.fn().mockResolvedValue(banner()),
    listBanners: vi.fn().mockResolvedValue({ items: [banner()], total: 1 }),
    restoreBannerInTransaction: vi.fn().mockResolvedValue(banner({ status: 'DRAFT', version: 2 })),
    updateBannerInTransaction: vi.fn().mockResolvedValue(banner({ title: 'Updated campaign', version: 2 })),
  };
  internals.idempotency = {
    bannerResourceReplay: vi.fn(),
    claim,
    complete: vi.fn().mockResolvedValue({}),
  };
  internals.outbox = { append: vi.fn().mockResolvedValue({}) };
  return { internals, service, storage, transaction };
}

describe('AdminBannersService orchestration', () => {
  it('returns stable admin views and public attachment URLs', async () => {
    const f = fixture();
    await expect(f.service.listBanners({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [{
        banner_id: bannerId,
        ends_at: '2026-09-01T00:00:00.000Z',
        file_id: fileId,
        image_url: `https://cdn.test/public/${fileId}`,
        sort_order: 0,
        starts_at: '2026-08-25T00:00:00.000Z',
        status: 'DRAFT',
        target_id: null,
        target_type: 'NONE',
        target_url: null,
        title: 'Homepage campaign',
        version: 1,
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
    expect(f.internals.banners.listBanners).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('creates DRAFT Banner, audit, outbox and an exact cacheable response in one transaction', async () => {
    const f = fixture();
    await expect(f.service.createBanner(requestContext(), {
      endsAt: '2026-09-01T00:00:00Z',
      fileId,
      initialStatus: 'DRAFT',
      sortOrder: 0,
      startsAt: '2026-08-25T00:00:00Z',
      target: { targetId, type: 'PRODUCT' },
      title: 'Homepage campaign',
    }, idempotencyKey)).resolves.toMatchObject({
      envelope: { data: { banner_id: bannerId, status: 'DRAFT', version: 1 } },
    });
    expect(f.internals.banners.createBannerInTransaction).toHaveBeenCalledWith(f.transaction, {
      actorId: accountId,
      endsAt: new Date('2026-09-01T00:00:00Z'),
      fileId,
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      sortOrder: 0,
      startsAt: new Date('2026-08-25T00:00:00Z'),
      target: { targetId, targetType: 'PRODUCT', targetUrl: null },
      title: 'Homepage campaign',
    });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'CREATE', module: 'banner', objectId: bannerId, objectType: 'banner',
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      aggregateId: bannerId, eventType: 'banner.created',
    }));
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(), {
      policy: 'BANNER_RESOURCE_RESPONSE',
      responseBody: expect.objectContaining({ data: expect.objectContaining({ banner_id: bannerId }) }),
      responseStatus: 201,
      storage: 'CACHEABLE',
    });
  });

  it('replays the exact original create response without repository, audit or outbox writes', async () => {
    const replay = cachedResponse();
    const f = fixture([{ kind: 'replay', record: { response_status: 201 } }]);
    f.internals.idempotency.bannerResourceReplay.mockReturnValue(replay);
    await expect(f.service.createBanner(requestContext(), {
      fileId, initialStatus: 'DRAFT', sortOrder: 0, target: { type: 'NONE' }, title: 'Homepage campaign',
    }, idempotencyKey)).resolves.toMatchObject({ envelope: replay });
    expect(f.internals.banners.createBannerInTransaction).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.outbox.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('updates profile data with If-Match in the claim and emits banner.updated', async () => {
    const f = fixture();
    await f.service.patchBanner(requestContext(), bannerId, {
      kind: 'UPDATE',
      patch: {
        endsAt: null,
        target: { targetUrl: 'https://mall.example.test/campaign', type: 'URL' },
        title: 'Updated campaign',
      },
    }, 1, idempotencyKey);
    expect(f.internals.idempotency.claim).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      request: expect.objectContaining({
        body: expect.objectContaining({ expected_version: 1, kind: 'UPDATE' }),
        method: 'PATCH',
        pathParameters: { banner_id: bannerId },
        route: '/admin/banners/{banner_id}',
      }),
    }));
    expect(f.internals.banners.updateBannerInTransaction).toHaveBeenCalledWith(f.transaction, {
      actorId: accountId,
      expectedVersion: 1,
      id: bannerId,
      patch: {
        endsAt: null,
        target: {
          targetId: null,
          targetType: 'URL',
          targetUrl: 'https://mall.example.test/campaign',
        },
        title: 'Updated campaign',
      },
    });
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'banner.updated',
    }));
  });

  it.each([
    ['ACTIVATE', 'ENABLE', 'banner.activated', 'ACTIVE'],
    ['DEACTIVATE', 'DISABLE', 'banner.deactivated', 'INACTIVE'],
  ] as const)('maps %s to repository, audit and outbox without a reason', async (
    action, auditAction, eventType, status,
  ) => {
    const f = fixture();
    f.internals.banners.changeBannerStatusInTransaction.mockResolvedValue(banner({ status, version: 2 }));
    await f.service.patchBanner(
      requestContext(), bannerId, { action, kind: 'STATUS' }, 1, idempotencyKey,
    );
    expect(f.internals.banners.changeBannerStatusInTransaction).toHaveBeenCalledWith(f.transaction, {
      action, expectedVersion: 1, id: bannerId,
    });
    const audit = f.internals.audit.append.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(audit).toMatchObject({ action: auditAction, module: 'banner', objectId: bannerId });
    expect(audit).not.toHaveProperty('reason');
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({ eventType }));
  });

  it('archives only through DELETE and persists the reason in audit', async () => {
    const f = fixture();
    await f.service.archiveBanner(
      requestContext(), bannerId, { reason: 'Campaign has ended' }, 1, idempotencyKey,
    );
    expect(f.internals.idempotency.claim).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      request: expect.objectContaining({
        body: { expected_version: 1, reason: 'Campaign has ended' },
        method: 'DELETE',
        route: '/admin/banners/{banner_id}',
      }),
    }));
    expect(f.internals.banners.archiveBannerInTransaction)
      .toHaveBeenCalledWith(f.transaction, { expectedVersion: 1, id: bannerId });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'ARCHIVE', reason: 'Campaign has ended',
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'banner.archived',
    }));
  });

  it('restores ARCHIVED to DRAFT with reason, version and banner.restored', async () => {
    const f = fixture();
    await f.service.restoreBanner(
      requestContext(), bannerId, { reason: 'Resume campaign preparation' }, 4, idempotencyKey,
    );
    expect(f.internals.banners.restoreBannerInTransaction)
      .toHaveBeenCalledWith(f.transaction, { expectedVersion: 4, id: bannerId });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'RESTORE', before: { status: 'ARCHIVED', version: 4 },
      reason: 'Resume campaign preparation',
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      eventType: 'banner.restored',
    }));
  });

  it('propagates repository STATE_CONFLICT without completing idempotency, audit or outbox', async () => {
    const f = fixture();
    const error = new ApplicationError('STATE_CONFLICT', 'Banner URL origin is not allowed');
    f.internals.banners.changeBannerStatusInTransaction.mockRejectedValue(error);
    await expect(f.service.patchBanner(
      requestContext(), bannerId, { action: 'ACTIVATE', kind: 'STATUS' }, 1, idempotencyKey,
    )).rejects.toBe(error);
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.outbox.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('rejects a replay bound to another Banner before returning cached data', async () => {
    const otherId = '01J00000000000000000000007';
    const f = fixture([{ kind: 'replay', record: { response_status: 200 } }]);
    f.internals.idempotency.bannerResourceReplay.mockReturnValue(cachedResponse({
      data: { ...cachedResponse().data, banner_id: otherId },
    }));
    await expect(f.service.patchBanner(
      requestContext(), bannerId, { action: 'ACTIVATE', kind: 'STATUS' }, 1, idempotencyKey,
    )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(f.internals.banners.changeBannerStatusInTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when runtime dependencies are absent', async () => {
    await expect(new AdminBannersService().listBanners({ page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
