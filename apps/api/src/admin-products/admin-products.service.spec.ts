import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CacheableCommandResponse,
  CacheableProductCatalogResponse,
  CacheableSkuView,
  DatabaseRuntime,
  ProductCatalogProductSnapshot,
  ProductCatalogSkuSnapshot,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { AdminProductsService } from './admin-products.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const productId = '01J00000000000000000000002';
const skuId = '01J00000000000000000000003';
const inventoryBalanceId = '01J00000000000000000000004';
const brandId = '01J00000000000000000000005';
const categoryId = '01J00000000000000000000006';
const imageId = '01J00000000000000000000007';
const imageLinkId = '01J00000000000000000000008';
const factorId = '01J00000000000000000000009';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';

function config(): PlatformRuntimeConfig {
  return {
    banner: { targetOrigins: [] },
    authentication: {} as PlatformRuntimeConfig['authentication'],
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      fieldKeys: { current: { id: 'field', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
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
      expiresAt: new Date('2026-08-24T01:00:00.000Z'),
      factorEncryptionKeyId: 'key',
      factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: new Date('2026-08-24T00:00:00.000Z'),
      sessionFamily: '01J0000000000000000000000A',
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

function sku(overrides: Partial<ProductCatalogSkuSnapshot> = {}): ProductCatalogSkuSnapshot {
  return {
    code: 'SKU-001',
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    deletedAt: null,
    id: skuId,
    inventory: {
      availableQty: 7,
      id: inventoryBalanceId,
      lockedQty: 2,
      physicalQty: 9,
      updatedAt: new Date('2026-08-24T00:00:00.000Z'),
      version: 1,
    },
    isRecommended: true,
    name: '500 ml',
    productId,
    retailPrice: '19.90',
    specification: { attributes: [{ name: 'Volume', value: '500 ml' }] },
    status: 'INACTIVE',
    updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    version: 1,
    ...overrides,
  };
}

function product(overrides: Partial<ProductCatalogProductSnapshot> = {}): ProductCatalogProductSnapshot {
  return {
    brand: {
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      deletedAt: null,
      description: 'Daily care',
      id: brandId,
      logoFileId: null,
      logoObjectKey: null,
      name: 'Qingxu',
      sortOrder: 0,
      status: 'ACTIVE',
      updatedAt: new Date('2026-08-24T00:00:00.000Z'),
      version: 1,
    },
    brandId,
    category: {
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      deletedAt: null,
      iconFileId: null,
      iconObjectKey: null,
      id: categoryId,
      name: 'Wash',
      sortOrder: 0,
      status: 'ACTIVE',
      updatedAt: new Date('2026-08-24T00:00:00.000Z'),
      version: 1,
    },
    categoryId,
    createdAt: new Date('2026-08-24T00:00:00.000Z'),
    deletedAt: null,
    id: productId,
    images: [{
      createdAt: new Date('2026-08-24T00:00:00.000Z'),
      fileId: imageId,
      id: imageLinkId,
      isPrimary: true,
      objectKey: `public/${imageId}`,
      sortOrder: 0,
    }],
    ingredients: null,
    introduction: null,
    isHot: false,
    isNew: true,
    minimumActivePrice: null,
    name: 'Daily wash',
    publishedAt: null,
    salesCount: 0,
    skus: [sku()],
    spuCode: 'SPU-001',
    status: 'DRAFT',
    subtitle: 'Gentle care',
    updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    usageMethod: null,
    version: 1,
    ...overrides,
  };
}

function productLifecycleImpact() {
  return {
    activeImageCount: 1,
    activeReservationCount: 0,
    activeReservationIds: [],
    activeReservationQuantity: 0,
    activeSkuCount: 1,
    activeSkuIds: [skuId],
    brandStatus: 'ACTIVE' as const,
    categoryStatus: 'ACTIVE' as const,
    resource: { deletedAt: null, id: productId, status: 'DRAFT' as const, version: 1 },
  };
}

function skuLifecycleImpact() {
  return {
    activeReservationCount: 0,
    activeReservationIds: [],
    activeReservationQuantity: 0,
    parentProductStatus: 'DRAFT' as const,
    resource: { deletedAt: null, id: skuId, status: 'INACTIVE' as const, version: 1 },
  };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  catalog: {
    applyLifecycleInTransaction: ReturnType<typeof vi.fn>;
    createProductInTransaction: ReturnType<typeof vi.fn>;
    createSkuInTransaction: ReturnType<typeof vi.fn>;
    getProduct: ReturnType<typeof vi.fn>;
    getLifecyclePreviewImpactInTransaction: ReturnType<typeof vi.fn>;
    listProducts: ReturnType<typeof vi.fn>;
    restoreProductInTransaction: ReturnType<typeof vi.fn>;
    restoreSkuInTransaction: ReturnType<typeof vi.fn>;
    updateProductInTransaction: ReturnType<typeof vi.fn>;
    updateSkuInTransaction: ReturnType<typeof vi.fn>;
  };
  config: PlatformRuntimeConfig;
  database: DatabaseRuntime;
  idempotency: {
    claim: ReturnType<typeof vi.fn>;
    commandReplay: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    productCatalogReplay: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  previews: {
    consumeInTransaction: ReturnType<typeof vi.fn>;
    issueInTransaction: ReturnType<typeof vi.fn>;
  };
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
  const service = new AdminProductsService();
  const internals = service as unknown as ServiceInternals;
  internals.config = config();
  internals.database = database;
  internals.storage = storage;
  const claim = vi.fn();
  for (const result of claims) claim.mockResolvedValueOnce(result);
  internals.audit = { append: vi.fn().mockResolvedValue({}) };
  internals.idempotency = {
    claim,
    commandReplay: vi.fn(),
    complete: vi.fn().mockResolvedValue({}),
    productCatalogReplay: vi.fn(),
  };
  internals.outbox = { append: vi.fn().mockResolvedValue({}) };
  internals.previews = {
    consumeInTransaction: vi.fn().mockResolvedValue(undefined),
    issueInTransaction: vi.fn().mockResolvedValue({
      confirmationHash: 'a'.repeat(64),
      expiresAt: new Date('2026-08-24T00:01:00.000Z'),
    }),
  };
  internals.catalog = {
    applyLifecycleInTransaction: vi.fn().mockResolvedValue({
      impact: productLifecycleImpact(),
      resource: product({
        status: 'ACTIVE',
        updatedAt: new Date('2026-08-24T00:02:00.000Z'),
        version: 2,
      }),
      targetType: 'PRODUCT',
    }),
    createProductInTransaction: vi.fn().mockResolvedValue(product()),
    createSkuInTransaction: vi.fn().mockResolvedValue(sku()),
    getProduct: vi.fn().mockResolvedValue(product()),
    getLifecyclePreviewImpactInTransaction: vi.fn().mockImplementation(
      (_transaction: unknown, input: { targetType: 'PRODUCT' | 'SKU' }) => Promise.resolve(
        input.targetType === 'PRODUCT' ? productLifecycleImpact() : skuLifecycleImpact(),
      ),
    ),
    listProducts: vi.fn().mockResolvedValue({
      items: [{
        activeSkuCount: 0,
        availableQty: 7,
        lockedQty: 2,
        minimumActivePrice: null,
        physicalQty: 9,
        product: product(),
        skuCount: 1,
        skus: [sku()],
      }],
      total: 1,
    }),
    restoreProductInTransaction: vi.fn().mockResolvedValue(product({ status: 'DRAFT', version: 5 })),
    restoreSkuInTransaction: vi.fn().mockResolvedValue(sku({ status: 'INACTIVE', version: 5 })),
    updateProductInTransaction: vi.fn().mockResolvedValue(product({ version: 2 })),
    updateSkuInTransaction: vi.fn().mockResolvedValue(sku({ version: 2 })),
  };
  return { internals, service, transaction };
}

describe('AdminProductsService orchestration', () => {
  it('creates a DRAFT product as an exact 201 fact after claim, write and audit', async () => {
    const f = fixture();
    const result = await f.service.createProduct(requestContext(), {
      brandId,
      categoryId,
      images: [{ fileId: imageId, sortOrder: 0 }],
      initialStatus: 'DRAFT',
      isNew: true,
      name: 'Daily wash',
      spuCode: 'SPU-001',
      subtitle: 'Gentle care',
    }, idempotencyKey);

    expect(f.internals.idempotency.claim).toHaveBeenCalledBefore(f.internals.catalog.createProductInTransaction);
    expect(f.internals.catalog.createProductInTransaction).toHaveBeenCalledBefore(f.internals.audit.append);
    expect(f.internals.audit.append).toHaveBeenCalledBefore(f.internals.idempotency.complete);
    expect(f.internals.catalog.createProductInTransaction).toHaveBeenCalledWith(f.transaction, {
      actorId: accountId,
      brandId,
      categoryId,
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      images: [{ fileId: imageId, sortOrder: 0 }],
      ingredients: null,
      introduction: null,
      isHot: false,
      isNew: true,
      name: 'Daily wash',
      spuCode: 'SPU-001',
      subtitle: 'Gentle care',
      usageMethod: null,
    });
    expect(result.envelope.data).toMatchObject({ product_id: productId, status: 'DRAFT', version: 1 });
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'PRODUCT_CATALOG_RESPONSE', responseStatus: 201, storage: 'CACHEABLE' }));
  });

  it('replays the exact product create body without repository, audit or completion side effects', async () => {
    const response = productResponse();
    const f = fixture([{
      kind: 'replay',
      record: { resource_id: productId, response_body: response, response_status: 201 },
    }]);
    f.internals.idempotency.productCatalogReplay.mockReturnValue(response);

    const result = await f.service.createProduct(requestContext(), {
      brandId, categoryId, images: [], initialStatus: 'DRAFT', name: 'Daily wash', spuCode: 'SPU-001',
    }, idempotencyKey);

    expect(result.envelope).toEqual(response);
    expect(f.internals.catalog.createProductInTransaction).not.toHaveBeenCalled();
    expect(f.internals.catalog.getProduct).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('includes expected_version in the product update claim and completes with 200', async () => {
    const f = fixture();
    const result = await f.service.updateProduct(
      requestContext(), productId, { name: 'Updated wash' }, 1, idempotencyKey,
    );

    const claim = f.internals.idempotency.claim.mock.calls[0]?.[1] as {
      request: { body: Record<string, unknown>; pathParameters: Record<string, string> };
    };
    expect(claim.request.body).toEqual({ expected_version: 1, name: 'Updated wash' });
    expect(claim.request.pathParameters).toEqual({ product_id: productId });
    expect(result.envelope.data).toMatchObject({ product_id: productId, version: 2 });
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'PRODUCT_CATALOG_RESPONSE', responseStatus: 200 }));
  });

  it('creates an INACTIVE SKU with a zero-balance identity and an exact 201 fact', async () => {
    const f = fixture();
    const result = await f.service.createSku(requestContext(), productId, {
      code: 'SKU-001',
      initialStatus: 'INACTIVE',
      isRecommended: true,
      name: '500 ml',
      retailPrice: '19.90',
      specJson: { attributes: [{ name: 'Volume', value: '500 ml' }] },
    }, idempotencyKey);

    expect(f.internals.idempotency.claim).toHaveBeenCalledBefore(f.internals.catalog.createSkuInTransaction);
    expect(f.internals.catalog.createSkuInTransaction).toHaveBeenCalledWith(f.transaction, {
      code: 'SKU-001',
      id: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      inventoryBalanceId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      isRecommended: true,
      name: '500 ml',
      productId,
      retailPrice: '19.90',
      specification: { attributes: [{ name: 'Volume', value: '500 ml' }] },
    });
    expect(result.envelope.data).toMatchObject({ sku_id: skuId, status: 'INACTIVE', version: 1 });
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'PRODUCT_CATALOG_RESPONSE', responseStatus: 201 }));
  });

  it('includes expected_version in the SKU update claim and completes with 200', async () => {
    const f = fixture();
    const result = await f.service.updateSku(
      requestContext(), skuId, { isRecommended: false, name: 'Updated 500 ml' }, 1, idempotencyKey,
    );

    const claim = f.internals.idempotency.claim.mock.calls[0]?.[1] as {
      request: { body: Record<string, unknown>; pathParameters: Record<string, string> };
    };
    expect(claim.request.body).toEqual({ expected_version: 1, isRecommended: false, name: 'Updated 500 ml' });
    expect(claim.request.pathParameters).toEqual({ sku_id: skuId });
    expect(result.envelope.data).toMatchObject({ sku_id: skuId, version: 2 });
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'PRODUCT_CATALOG_RESPONSE', responseStatus: 200 }));
  });

  it('replays the exact SKU update body without repository, audit or completion side effects', async () => {
    const response = skuResponse(2);
    const f = fixture([{
      kind: 'replay',
      record: { resource_id: skuId, response_body: response, response_status: 200 },
    }]);
    f.internals.idempotency.productCatalogReplay.mockReturnValue(response);

    const result = await f.service.updateSku(
      requestContext(), skuId, { name: 'Updated 500 ml' }, 1, idempotencyKey,
    );

    expect(result.envelope).toEqual(response);
    expect(f.internals.catalog.updateSkuInTransaction).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('rejects a changed If-Match under the same update key before a second write', async () => {
    const f = fixture([{ kind: 'execute' }]);
    f.internals.idempotency.claim.mockRejectedValueOnce(
      new ApplicationError('STATE_CONFLICT', 'Idempotency key request changed'),
    );

    await f.service.updateProduct(requestContext(), productId, { name: 'Updated wash' }, 1, idempotencyKey);
    await expect(f.service.updateProduct(
      requestContext(), productId, { name: 'Updated wash' }, 2, idempotencyKey,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    expect(f.internals.catalog.updateProductInTransaction).toHaveBeenCalledOnce();
    const firstClaim = f.internals.idempotency.claim.mock.calls[0]?.[1] as {
      request: { body: Record<string, unknown> };
    };
    const secondClaim = f.internals.idempotency.claim.mock.calls[1]?.[1] as {
      request: { body: Record<string, unknown> };
    };
    expect(firstClaim.request.body.expected_version).toBe(1);
    expect(secondClaim.request.body.expected_version).toBe(2);
  });

  it('issues a bound Product preview and stores only a HASH_ONLY fact without the capability token', async () => {
    const f = fixture();
    const result = await f.service.previewProductLifecycle(
      requestContext(), productId, { action: 'ACTIVATE', reason: 'Publish product' }, idempotencyKey,
    );

    expect(result).toMatchObject({
      confirmation_hash: 'a'.repeat(64),
      resource_etag: '"1"',
    });
    expect(result.preview_token).toMatch(/^pvw_[A-Za-z0-9_-]{43}$/);
    expect(f.internals.previews.issueInTransaction).toHaveBeenCalledWith(f.transaction,
      expect.objectContaining({
        action: 'PRODUCT.ACTIVATE',
        actorId: accountId,
        request: { action: 'ACTIVATE', reason: 'Publish product' },
        resourceVersion: 1,
        sessionId,
        targetId: productId,
        targetType: 'PRODUCT',
      }));
    const completion = f.internals.idempotency.complete.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(completion).toMatchObject({ resourceId: productId, responseStatus: 200, storage: 'HASH_ONLY' });
    expect(completion).not.toHaveProperty('responseBody');
    expect(JSON.stringify(completion)).not.toContain(result.preview_token);
  });

  it('binds SKU previews to the SKU action and target domain', async () => {
    const f = fixture();
    await f.service.previewSkuLifecycle(
      requestContext(), skuId, { action: 'SOFT_DELETE', reason: 'Retire SKU' }, idempotencyKey,
    );
    expect(f.internals.catalog.getLifecyclePreviewImpactInTransaction).toHaveBeenCalledWith(f.transaction, {
      action: 'SOFT_DELETE', targetId: skuId, targetType: 'SKU',
    });
    expect(f.internals.previews.issueInTransaction).toHaveBeenCalledWith(f.transaction,
      expect.objectContaining({ action: 'SKU.SOFT_DELETE', targetId: skuId, targetType: 'SKU' }));
  });

  it('does not require zero active SKUs when previewing Product deactivation', async () => {
    const f = fixture();
    f.internals.catalog.getLifecyclePreviewImpactInTransaction.mockResolvedValue({
      ...productLifecycleImpact(),
      resource: { deletedAt: null, id: productId, status: 'ACTIVE', version: 1 },
    });

    const result = await f.service.previewProductLifecycle(
      requestContext(), productId, { action: 'DEACTIVATE', reason: 'Pause product sales' }, idempotencyKey,
    );

    expect(result.impact.metrics).toContainEqual({
      after: 'UNCHANGED', before: '1', key: 'active_skus', label: 'Active SKUs',
    });
  });

  it('never replays a preview capability from a repeated idempotency key', async () => {
    const f = fixture([{ kind: 'replay', record: { response_body: null, response_status: 200 } }]);
    await expect(f.service.previewProductLifecycle(
      requestContext(), productId, { action: 'ACTIVATE', reason: 'Publish product' }, idempotencyKey,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(f.internals.catalog.getLifecyclePreviewImpactInTransaction).not.toHaveBeenCalled();
    expect(f.internals.previews.issueInTransaction).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('consumes the bound preview before Product locks, then writes raw-reason audit, outbox and command fact', async () => {
    const f = fixture();
    const confirmation = {
      action: 'ACTIVATE' as const,
      confirmationHash: 'a'.repeat(64),
      previewToken: `pvw_${'b'.repeat(43)}`,
      reason: 'Publish product after review',
    };
    const result = await f.service.confirmProductLifecycle(
      requestContext(), productId, confirmation, 1, idempotencyKey,
    );

    expect(f.internals.idempotency.claim).toHaveBeenCalledBefore(f.internals.previews.consumeInTransaction);
    expect(f.internals.previews.consumeInTransaction)
      .toHaveBeenCalledBefore(f.internals.catalog.applyLifecycleInTransaction);
    expect(f.internals.catalog.applyLifecycleInTransaction).toHaveBeenCalledWith(f.transaction, {
      action: 'ACTIVATE', expectedVersion: 1, targetId: productId, targetType: 'PRODUCT',
    });
    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledWith(f.transaction, {
      action: 'PRODUCT.ACTIVATE',
      actorId: accountId,
      confirmationHash: confirmation.confirmationHash,
      previewToken: confirmation.previewToken,
      request: { action: 'ACTIVATE', reason: confirmation.reason },
      resourceVersion: 1,
      sessionId,
      targetId: productId,
      targetType: 'PRODUCT',
    });
    expect(f.internals.audit.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      action: 'ENABLE', objectId: productId, objectType: 'product', reason: confirmation.reason,
    }));
    expect(f.internals.outbox.append).toHaveBeenCalledWith(f.transaction, expect.objectContaining({
      aggregateId: productId,
      aggregateType: 'product',
      eventType: expect.any(String),
      payload: {
        event_version: 1,
        resource_id: productId,
        resource_type: 'product',
        resource_version: 2,
      },
    }));
    expect(f.internals.catalog.applyLifecycleInTransaction).toHaveBeenCalledBefore(f.internals.audit.append);
    expect(f.internals.outbox.append).toHaveBeenCalledBefore(f.internals.idempotency.complete);
    expect(f.internals.idempotency.complete).toHaveBeenCalledWith(f.transaction, expect.anything(),
      expect.objectContaining({ policy: 'COMMAND_RESPONSE', responseStatus: 200, storage: 'CACHEABLE' }));
    expect(result.envelope.data).toMatchObject({
      resource_id: productId, resource_type: 'product', status: 'ACTIVE', version: 2,
    });
    const claim = f.internals.idempotency.claim.mock.calls[0]?.[1] as {
      request: { body: Record<string, unknown>; pathParameters: Record<string, string>; route: string };
    };
    expect(claim.request).toMatchObject({
      body: { ...confirmation, expected_version: 1 },
      pathParameters: { product_id: productId },
      route: '/admin/products/{product_id}/lifecycle-changes',
    });
  });

  it('replays an exact SKU command without touching preview, catalog, audit or outbox state', async () => {
    const response = commandResponse('sku', skuId, 'ACTIVE', 2);
    const f = fixture([{
      kind: 'replay',
      record: { resource_id: skuId, response_body: response, response_status: 200 },
    }]);
    f.internals.idempotency.commandReplay.mockReturnValue(response);

    const result = await f.service.confirmSkuLifecycle(requestContext(), skuId, {
      action: 'ACTIVATE', confirmationHash: 'a'.repeat(64),
      previewToken: `pvw_${'b'.repeat(43)}`, reason: 'Enable SKU',
    }, 1, idempotencyKey);

    expect(result.envelope).toEqual(response);
    expect(f.internals.idempotency.commandReplay).toHaveBeenCalledOnce();
    expect(f.internals.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(f.internals.catalog.applyLifecycleInTransaction).not.toHaveBeenCalled();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.outbox.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('restores Product to DRAFT and SKU to INACTIVE without consuming a lifecycle preview', async () => {
    const productFixture = fixture();
    const restoredProduct = await productFixture.service.restoreProduct(
      requestContext(), productId, { reason: 'Resume product preparation' }, 4, idempotencyKey,
    );
    expect(productFixture.internals.catalog.restoreProductInTransaction).toHaveBeenCalledWith(
      productFixture.transaction, { expectedVersion: 4, id: productId },
    );
    expect(productFixture.internals.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(productFixture.internals.audit.append).toHaveBeenCalledWith(
      productFixture.transaction,
      expect.objectContaining({ action: 'RESTORE', objectType: 'product', reason: 'Resume product preparation' }),
    );
    expect(restoredProduct.envelope.data).toMatchObject({ status: 'DRAFT', version: 5 });

    const skuFixture = fixture();
    const restoredSku = await skuFixture.service.restoreSku(
      requestContext(), skuId, { reason: 'Resume SKU preparation' }, 4, idempotencyKey,
    );
    expect(skuFixture.internals.catalog.restoreSkuInTransaction).toHaveBeenCalledWith(
      skuFixture.transaction, { expectedVersion: 4, id: skuId },
    );
    expect(skuFixture.internals.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(skuFixture.internals.audit.append).toHaveBeenCalledWith(
      skuFixture.transaction,
      expect.objectContaining({ action: 'RESTORE', objectType: 'sku', reason: 'Resume SKU preparation' }),
    );
    expect(restoredSku.envelope.data).toMatchObject({ status: 'INACTIVE', version: 5 });
    const skuClaim = skuFixture.internals.idempotency.claim.mock.calls[0]?.[1] as {
      request: { body: Record<string, unknown>; pathParameters: Record<string, string> };
    };
    expect(skuClaim.request.body).toEqual({ expected_version: 4, reason: 'Resume SKU preparation' });
    expect(skuClaim.request.pathParameters).toEqual({ sku_id: skuId });
  });

  it('does not audit, enqueue or complete a command after a confirm dependency failure', async () => {
    const f = fixture();
    f.internals.catalog.applyLifecycleInTransaction.mockRejectedValue(
      new ApplicationError('ACTIVE_SKU_DEPENDENCY', 'Active SKUs must be deactivated first'),
    );

    await expect(f.service.confirmProductLifecycle(requestContext(), productId, {
      action: 'SOFT_DELETE', confirmationHash: 'a'.repeat(64),
      previewToken: `pvw_${'b'.repeat(43)}`, reason: 'Retire product',
    }, 1, idempotencyKey)).rejects.toMatchObject({ code: 'ACTIVE_SKU_DEPENDENCY' });

    expect(f.internals.previews.consumeInTransaction).toHaveBeenCalledOnce();
    expect(f.internals.audit.append).not.toHaveBeenCalled();
    expect(f.internals.outbox.append).not.toHaveBeenCalled();
    expect(f.internals.idempotency.complete).not.toHaveBeenCalled();
  });
});

function productResponse(): CacheableProductCatalogResponse {
  return {
    code: 'OK',
    data: {
      brand: {
        brand_id: brandId,
        description: 'Daily care',
        logo_file_id: null,
        logo_url: null,
        name: 'Qingxu',
        sort_order: 0,
        status: 'ACTIVE',
        version: 1,
      },
      category: {
        category_id: categoryId,
        icon_file_id: null,
        icon_url: null,
        name: 'Wash',
        sort_order: 0,
        status: 'ACTIVE',
        version: 1,
      },
      images: [{
        file_id: imageId,
        is_primary: true,
        sort_order: 0,
        url: `https://cdn.test/public/${imageId}`,
      }],
      ingredients: null,
      introduction: null,
      is_hot: false,
      is_new: true,
      name: 'Daily wash',
      net_sales_count: 0,
      product_id: productId,
      skus: [skuView()],
      spu_code: 'SPU-001',
      status: 'DRAFT',
      subtitle: 'Gentle care',
      usage_method: null,
      version: 1,
    },
    message: 'success',
    request_id: requestId,
  };
}

function skuView(version = 1): CacheableSkuView {
  return {
    available_stock: 7,
    code: 'SKU-001',
    is_recommended: true,
    name: '500 ml',
    retail_price: '19.90',
    sku_id: skuId,
    spec_json: { attributes: [{ name: 'Volume', value: '500 ml' }] },
    status: 'INACTIVE',
    version,
  };
}

function skuResponse(version = 1): CacheableProductCatalogResponse {
  return {
    code: 'OK',
    data: skuView(version),
    message: 'success',
    request_id: requestId,
  };
}

function commandResponse(
  resourceType: 'product' | 'sku',
  resourceId: string,
  status: 'ACTIVE' | 'ARCHIVED' | 'DRAFT' | 'INACTIVE',
  version: number,
): CacheableCommandResponse {
  return {
    code: 'OK',
    data: {
      occurred_at: '2026-08-24T00:02:00.000Z',
      resource_id: resourceId,
      resource_type: resourceType,
      status,
      version,
    },
    message: 'success',
    request_id: requestId,
  };
}
