import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  BrandSnapshot,
  CacheableCommandResponse,
  CategorySnapshot,
  DatabaseRuntime,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from './admin-catalog.request';
import { AdminCatalogService } from './admin-catalog.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const brandId = '01J00000000000000000000002';
const categoryId = '01J00000000000000000000003';
const fileId = '01J00000000000000000000004';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';

function config(): PlatformRuntimeConfig {
  return {
    banner: { targetOrigins: [] },
    authentication: {} as PlatformRuntimeConfig['authentication'],
    store: {} as PlatformRuntimeConfig['store'],
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
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
      expiresAt: new Date('2026-08-14T01:00:00.000Z'),
      factorEncryptionKeyId: 'key',
      factorId: fileId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-08-14T00:00:00.000Z'),
      sessionFamily: '01J00000000000000000000005',
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

function brand(overrides: Partial<BrandSnapshot> = {}): BrandSnapshot {
  return {
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    deletedAt: null,
    description: 'Daily care',
    id: brandId,
    logoFileId: fileId,
    logoObjectKey: `public/${fileId}`,
    name: 'Qingxu',
    sortOrder: 1,
    status: 'DRAFT',
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function category(overrides: Partial<CategorySnapshot> = {}): CategorySnapshot {
  return {
    createdAt: new Date('2026-08-14T00:00:00.000Z'),
    deletedAt: null,
    iconFileId: fileId,
    iconObjectKey: `public/${fileId}`,
    id: categoryId,
    name: 'Care',
    sortOrder: 2,
    status: 'DRAFT',
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  config: PlatformRuntimeConfig;
  database: DatabaseRuntime;
  idempotency: {
    catalogResourceReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    commandReplay: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  master: {
    applyLifecycleInTransaction: ReturnType<typeof vi.fn>;
    createBrandInTransaction: ReturnType<typeof vi.fn>;
    createCategoryInTransaction: ReturnType<typeof vi.fn>;
    getBrand: ReturnType<typeof vi.fn>;
    getCategory: ReturnType<typeof vi.fn>;
    getLifecyclePreviewImpactInTransaction: ReturnType<typeof vi.fn>;
    listBrands: ReturnType<typeof vi.fn>;
    listCategories: ReturnType<typeof vi.fn>;
    restoreBrandInTransaction: ReturnType<typeof vi.fn>;
    restoreCategoryInTransaction: ReturnType<typeof vi.fn>;
    updateBrandInTransaction: ReturnType<typeof vi.fn>;
    updateCategoryInTransaction: ReturnType<typeof vi.fn>;
  };
  previews: { consumeInTransaction: ReturnType<typeof vi.fn>; issueInTransaction: ReturnType<typeof vi.fn> };
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
  const service = new AdminCatalogService();
  const internals = service as unknown as ServiceInternals;
  internals.config = config();
  internals.database = database;
  internals.storage = storage;
  const claim = vi.fn();
  for (const result of claims) claim.mockResolvedValueOnce(result);
  internals.audit = { append: vi.fn().mockResolvedValue({}) };
  internals.idempotency = {
    catalogResourceReplay: vi.fn(),
    claim,
    commandReplay: vi.fn((record: { response_body: CacheableCommandResponse }) => record.response_body),
    complete: vi.fn().mockResolvedValue({}),
  };
  internals.master = {
    applyLifecycleInTransaction: vi.fn(),
    createBrandInTransaction: vi.fn().mockResolvedValue(brand()),
    createCategoryInTransaction: vi.fn().mockResolvedValue(category()),
    getBrand: vi.fn().mockResolvedValue(brand()),
    getCategory: vi.fn().mockResolvedValue(category()),
    getLifecyclePreviewImpactInTransaction: vi.fn().mockResolvedValue({
      activeProductCount: 2,
      activeProductIds: ['01J00000000000000000000006', '01J00000000000000000000007'],
      resource: { deletedAt: null, id: brandId, status: 'ACTIVE', version: 3 },
    }),
    listBrands: vi.fn().mockResolvedValue({ items: [brand()], total: 1 }),
    listCategories: vi.fn().mockResolvedValue({ items: [category()], total: 1 }),
    restoreBrandInTransaction: vi.fn(),
    restoreCategoryInTransaction: vi.fn(),
    updateBrandInTransaction: vi.fn(),
    updateCategoryInTransaction: vi.fn(),
  };
  internals.previews = {
    consumeInTransaction: vi.fn().mockResolvedValue(undefined),
    issueInTransaction: vi.fn().mockResolvedValue({
      confirmationHash: 'a'.repeat(64),
      expiresAt: new Date('2026-08-14T00:01:00.000Z'),
    }),
  };
  return { internals, service, storage, transaction };
}

describe('AdminCatalogService orchestration', () => {
  it('returns stable admin views and public attachment URLs', async () => {
    const f = fixture();
    await expect(f.service.listBrands({ page: 1, pageSize: 20 })).resolves.toEqual({
      items: [{
        brand_id: brandId,
        description: 'Daily care',
        logo_file_id: fileId,
        logo_url: `https://cdn.test/public/${fileId}`,
        name: 'Qingxu',
        sort_order: 1,
        status: 'DRAFT',
        version: 1,
      }],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
    expect(f.internals.master.listBrands).toHaveBeenCalledWith({ page: 1, pageSize: 20 });
  });

  it('creates DRAFT data with actor-owned file validation and an exact catalog response fact', async () => {
    const f = fixture();
    await expect(f.service.createBrand(requestContext(), {
      initialStatus: 'DRAFT',
      logoFileId: fileId,
      name: 'Qingxu',
      sortOrder: 1,
    }, idempotencyKey)).resolves.toMatchObject({
      envelope: { data: { brand_id: brandId, status: 'DRAFT', version: 1 } },
    });
    expect(f.internals.master.createBrandInTransaction).toHaveBeenCalledWith(f.transaction, {
      actorId: accountId,
      description: null,
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      logoFileId: fileId,
      name: 'Qingxu',
      sortOrder: 1,
    });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'CREATE', module: 'catalog', objectType: 'brand', summaryPolicy: 'STATUS_VERSION',
    }));
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({
        policy: 'CATALOG_RESOURCE_RESPONSE', responseStatus: 201, storage: 'CACHEABLE',
      }));
  });

  it('replays the exact cached create body without reading a subsequently changed resource', async () => {
    const original = {
      code: 'OK' as const,
      data: {
        brand_id: brandId,
        description: 'Daily care',
        logo_file_id: fileId,
        logo_url: `https://cdn.test/public/${fileId}`,
        name: 'Qingxu',
        sort_order: 1,
        status: 'DRAFT' as const,
        version: 1,
      },
      message: 'success' as const,
      request_id: requestId,
    };
    const f = fixture([{
      kind: 'replay',
      record: { resource_id: brandId, response_body: original, response_status: 201 },
    }]);
    f.internals.idempotency.catalogResourceReplay.mockReturnValue(original);
    f.internals.master.getBrand.mockResolvedValue(brand({ name: 'Changed later', version: 8 }));
    const result = await f.service.createBrand(requestContext(), {
      initialStatus: 'DRAFT', name: 'Qingxu', sortOrder: 1,
    }, idempotencyKey);
    expect(result.envelope).toEqual(original);
    expect(f.internals.master.createBrandInTransaction).not.toHaveBeenCalled();
    expect(f.internals.master.getBrand).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
  });

  it('hashes expected_version so the same update key with another If-Match conflicts before a second write', async () => {
    const f = fixture([{ kind: 'execute' }]);
    f.internals.idempotency.claim.mockRejectedValueOnce(
      new ApplicationError('STATE_CONFLICT', 'Idempotency key request changed'),
    );
    f.internals.master.updateBrandInTransaction.mockResolvedValue(brand({ version: 2 }));
    await f.service.updateBrand(
      requestContext(), brandId, { name: 'Updated' }, 1, idempotencyKey,
    );
    await expect(f.service.updateBrand(
      requestContext(), brandId, { name: 'Updated' }, 2, idempotencyKey,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(f.internals.master.updateBrandInTransaction).toHaveBeenCalledOnce();
    const firstClaim = f.internals.idempotency.claim.mock.calls[0]?.[1] as {
      request: { body: Record<string, unknown> };
    };
    const secondClaim = f.internals.idempotency.claim.mock.calls[1]?.[1] as {
      request: { body: Record<string, unknown> };
    };
    expect(firstClaim.request.body.expected_version).toBe(1);
    expect(secondClaim.request.body.expected_version).toBe(2);
  });

  it('returns dependency impact as a no-store preview while persisting no token response body', async () => {
    const f = fixture();
    const result = await f.service.previewLifecycle(
      requestContext(),
      'BRAND',
      brandId,
      { action: 'DEACTIVATE', reason: 'Portfolio change' },
      idempotencyKey,
    );
    expect(result).toMatchObject({
      confirmation_hash: 'a'.repeat(64),
      impact: { affected_count: 2, warnings: ['ACTIVE_PRODUCT_DEPENDENCY'] },
      resource_etag: '"3"',
    });
    expect(result.preview_token).toMatch(/^pvw_[A-Za-z0-9_-]{43}$/);
    expect(f.internals.previews.issueInTransaction).toHaveBeenCalledWith(f.transaction,
      expect.objectContaining({
        action: 'BRAND.DEACTIVATE',
        actorId: accountId,
        request: { action: 'DEACTIVATE', reason: 'Portfolio change' },
        resourceVersion: 3,
        sessionId,
        targetId: brandId,
        targetType: 'BRAND',
      }));
    const completed = f.internals.idempotency.complete.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(completed.storage).toBe('HASH_ONLY');
    expect(JSON.stringify(completed)).not.toContain(result.preview_token);
  });

  it('consumes the bound preview before catalog locks and caches a closed command response', async () => {
    const f = fixture();
    const changed = brand({ status: 'INACTIVE', updatedAt: new Date('2026-08-14T00:02:00.000Z'), version: 4 });
    f.internals.master.applyLifecycleInTransaction.mockResolvedValue({
      impact: {
        activeProductCount: 0,
        activeProductIds: [],
        resource: { deletedAt: null, id: brandId, status: 'ACTIVE', version: 3 },
      },
      resource: changed,
      targetType: 'BRAND',
    });
    const result = await f.service.confirmLifecycle(requestContext(), 'BRAND', brandId, {
      action: 'DEACTIVATE',
      confirmationHash: 'a'.repeat(64),
      previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Portfolio change',
    }, 3, idempotencyKey);
    expect(f.internals.previews.consumeInTransaction)
      .toHaveBeenCalledBefore(f.internals.master.applyLifecycleInTransaction);
    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledWith(f.transaction, {
      action: 'BRAND.DEACTIVATE',
      actorId: accountId,
      confirmationHash: 'a'.repeat(64),
      previewToken: `pvw_${'b'.repeat(43)}`,
      request: { action: 'DEACTIVATE', reason: 'Portfolio change' },
      resourceVersion: 3,
      sessionId,
      targetId: brandId,
      targetType: 'BRAND',
    });
    expect(result.envelope.data).toMatchObject({
      resource_id: brandId, resource_type: 'brand', status: 'INACTIVE', version: 4,
    });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'DISABLE', reason: 'Portfolio change',
    }));
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'COMMAND_RESPONSE', storage: 'CACHEABLE' }));
  });

  it('checks the preview before dependency blocking and leaves no later command facts', async () => {
    const f = fixture();
    f.internals.master.applyLifecycleInTransaction.mockRejectedValue(
      new ApplicationError('ACTIVE_PRODUCT_DEPENDENCY', 'Active product dependency'),
    );
    await expect(f.service.confirmLifecycle(requestContext(), 'CATEGORY', categoryId, {
      action: 'SOFT_DELETE',
      confirmationHash: 'a'.repeat(64),
      previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Retired',
    }, 2, idempotencyKey)).rejects.toMatchObject({ code: 'ACTIVE_PRODUCT_DEPENDENCY' });
    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledOnce();
    expect(f.internals.previews.consumeInTransaction)
      .toHaveBeenCalledBefore(f.internals.master.applyLifecycleInTransaction);
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('restores archived data to DRAFT without a preview and records the supplied reason', async () => {
    const f = fixture();
    f.internals.master.restoreCategoryInTransaction.mockResolvedValue(category({
      status: 'DRAFT', updatedAt: new Date('2026-08-14T00:03:00.000Z'), version: 5,
    }));
    const result = await f.service.restore(
      requestContext(), 'CATEGORY', categoryId, { reason: 'Resume' }, 4, idempotencyKey,
    );
    expect(f.internals.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(result.envelope.data).toMatchObject({ status: 'DRAFT', version: 5 });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'RESTORE', reason: 'Resume',
    }));
  });

  it('replays an exact lifecycle command without touching master data or preview state', async () => {
    const response: CacheableCommandResponse = {
      code: 'OK',
      data: {
        occurred_at: '2026-08-14T00:02:00.000Z',
        resource_id: brandId,
        resource_type: 'brand',
        status: 'INACTIVE',
        version: 4,
      },
      message: 'success',
      request_id: requestId,
    };
    const f = fixture([{
      kind: 'replay',
      record: { resource_id: brandId, response_body: response, response_status: 200 },
    }]);
    const result = await f.service.confirmLifecycle(requestContext(), 'BRAND', brandId, {
      action: 'DEACTIVATE', confirmationHash: 'a'.repeat(64), previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Portfolio change',
    }, 3, idempotencyKey);
    expect(result.envelope).toEqual(response);
    expect(f.internals.master.applyLifecycleInTransaction).not.toHaveBeenCalled();
    expect(f.internals.previews.consumeInTransaction).not.toHaveBeenCalled();
  });

  it('fails closed when a valid command envelope is associated with another catalog target', async () => {
    const response: CacheableCommandResponse = {
      code: 'OK',
      data: {
        occurred_at: '2026-08-14T00:02:00.000Z',
        resource_id: categoryId,
        resource_type: 'category',
        status: 'INACTIVE',
        version: 4,
      },
      message: 'success',
      request_id: requestId,
    };
    const f = fixture([{
      kind: 'replay',
      record: { resource_id: categoryId, response_body: response, response_status: 200 },
    }]);
    await expect(f.service.confirmLifecycle(requestContext(), 'BRAND', brandId, {
      action: 'DEACTIVATE', confirmationHash: 'a'.repeat(64), previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Portfolio change',
    }, 3, idempotencyKey)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(f.internals.master.applyLifecycleInTransaction).not.toHaveBeenCalled();
    expect(f.internals.previews.consumeInTransaction).not.toHaveBeenCalled();
  });

  it('also rejects a wrong-target restore replay before touching archived state', async () => {
    const response: CacheableCommandResponse = {
      code: 'OK',
      data: {
        occurred_at: '2026-08-14T00:03:00.000Z',
        resource_id: brandId,
        resource_type: 'brand',
        status: 'DRAFT',
        version: 5,
      },
      message: 'success',
      request_id: requestId,
    };
    const f = fixture([{
      kind: 'replay',
      record: { resource_id: brandId, response_body: response, response_status: 200 },
    }]);
    await expect(f.service.restore(
      requestContext(), 'CATEGORY', categoryId, { reason: 'Resume' }, 4, idempotencyKey,
    )).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(f.internals.master.restoreCategoryInTransaction).not.toHaveBeenCalled();
  });
});
