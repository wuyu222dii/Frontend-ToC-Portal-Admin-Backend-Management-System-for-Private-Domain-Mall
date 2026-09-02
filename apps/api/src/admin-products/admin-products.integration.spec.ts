import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type ProductCatalogLifecycleAction,
} from '@qingxu/database';
import { generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { AdminProductsService } from './admin-products.service';

type IntegrationMode = 'full' | 'rollback';

const mode = process.env.B4_PRODUCT_CATALOG_API_TEST_MODE as IntegrationMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B4_PRODUCT_CATALOG_API_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackOptions = mode === 'rollback'
  ? { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 90_000 }
  : undefined;
const rollbackSentinel = Object.freeze({ code: 'B4_PRODUCT_CATALOG_API_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface FoundationFixture {
  accountId: string;
  brandId: string;
  categoryId: string;
  factorId: string;
  fileId: string;
  sessionId: string;
}

interface CatalogFixture extends FoundationFixture {
  productId: string;
  skuId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B4 product catalog API integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B4 product catalog API tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B4 product catalog API DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:b4|catalog|api|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B4 product catalog API tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b4-product-catalog-api-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B4 product catalog API tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b4-product-catalog-api-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
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
      bankAccountHashKeys: { current: { id: 'bank', key: Buffer.alloc(32, 0x44) }, previous: [] },
      fieldKeys: { current: { id: 'field', key: Buffer.alloc(32, 0x41) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'b4-api-v1', key: Buffer.alloc(32, 0x42) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 0x43),
    },
    environment: 'test',
    payment: { provider: 'MOCK', mockSigningKey: Buffer.alloc(32, 0x44), providerTimeoutMs: 5_000 },
    port: 3000,
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

const storage = {
  publicUrl: (objectKey: string) => `https://assets.test/${objectKey}`,
} as ObjectStoragePort;

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function requestContext(fixture: FoundationFixture): AdminCatalogRequestContext {
  const now = new Date();
  return {
    accessSession: {
      accountId: fixture.accountId,
      accountVersion: 1,
      accessJti: `access:${fixture.sessionId}`,
      expiresAt: new Date(now.getTime() + 60 * 60 * 1_000),
      factorEncryptionKeyId: 'b4-api-field',
      factorId: fixture.factorId,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(32),
      mfaVerifiedAt: now,
      sessionFamily: fixture.sessionId,
      sessionId: fixture.sessionId,
    },
    principal: {
      accountId: fixture.accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: fixture.sessionId,
    },
    requestId: requestId(),
    socket: { remoteAddress: '127.0.0.1' },
  };
}

async function seedFoundation(transaction: DatabaseTransaction): Promise<FoundationFixture> {
  const now = new Date();
  const fixture: FoundationFixture = {
    accountId: generateUlid(),
    brandId: generateUlid(),
    categoryId: generateUlid(),
    factorId: generateUlid(),
    fileId: generateUlid(),
    sessionId: generateUlid(),
  };
  await transaction.account.create({
    data: {
      created_at: now,
      id: fixture.accountId,
      login_name: `b4-api-${fixture.accountId}`,
      password_hash: `integration:${fixture.accountId}`,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.totpFactor.create({
    data: {
      account_id: fixture.accountId,
      created_at: now,
      encryption_key_id: 'b4-api-field',
      id: fixture.factorId,
      label: 'B4 product catalog API integration',
      secret_ciphertext: Buffer.alloc(32, 0x44),
      secret_fingerprint: '4'.repeat(64),
      status: 'ACTIVE',
      updated_at: now,
      verified_at: now,
    },
  });
  await transaction.authSession.create({
    data: {
      access_jti: `access:${fixture.sessionId}`,
      account_id: fixture.accountId,
      assurance: 'MFA',
      created_at: now,
      expires_at: new Date(now.getTime() + 60 * 60 * 1_000),
      id: fixture.sessionId,
      mfa_factor_id: fixture.factorId,
      mfa_verified_at: now,
      refresh_token_hash: `refresh:${fixture.sessionId}`,
      restriction: 'NONE',
      session_family: generateUlid(),
    },
  });
  await transaction.brand.create({
    data: {
      created_at: now,
      id: fixture.brandId,
      name: `B4 API brand ${fixture.brandId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.category.create({
    data: {
      created_at: now,
      id: fixture.categoryId,
      name: `B4 API category ${fixture.categoryId}`,
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.fileAsset.create({
    data: {
      byte_size: 1_024n,
      created_at: now,
      created_by_id: fixture.accountId,
      id: fixture.fileId,
      mime_type: 'image/png',
      object_key: `public/${fixture.fileId}`,
      original_name: 'product.png',
      purpose: 'PRODUCT_IMAGE',
      sha256: 'a'.repeat(64),
      status: 'READY',
      visibility: 'PUBLIC',
    },
  });
  return fixture;
}

async function createCatalog(
  service: AdminProductsService,
  foundation: FoundationFixture,
): Promise<CatalogFixture> {
  const createdProduct = await service.createProduct(requestContext(foundation), {
    brandId: foundation.brandId,
    categoryId: foundation.categoryId,
    images: [{ fileId: foundation.fileId, sortOrder: 0 }],
    initialStatus: 'DRAFT',
    name: `B4 API product ${generateUlid()}`,
    spuCode: `SPU-${generateUlid()}`,
  }, randomUUID());
  if (!('product_id' in createdProduct.envelope.data)) {
    throw new TypeError('B4 API Product creation returned the wrong resource type');
  }
  const productId = createdProduct.envelope.data.product_id;
  const createdSku = await service.createSku(requestContext(foundation), productId, {
    code: `SKU-${generateUlid()}`,
    initialStatus: 'INACTIVE',
    name: 'B4 API SKU',
    retailPrice: '19.90',
  }, randomUUID());
  if (!('sku_id' in createdSku.envelope.data)) {
    throw new TypeError('B4 API SKU creation returned the wrong resource type');
  }
  return { ...foundation, productId, skuId: createdSku.envelope.data.sku_id };
}

function transactionBoundRuntime(runtime: DatabaseRuntime, transaction: DatabaseTransaction): DatabaseRuntime {
  const prisma = {
    $transaction: async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction),
  } as unknown as DatabaseRuntime['prisma'];
  return { ...runtime, prisma };
}

integrationDescribe('B4.2 product catalog service and PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;
  let service: AdminProductsService;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
    service = new AdminProductsService(config(), runtime, storage);
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function confirmSku(
    fixture: CatalogFixture,
    action: ProductCatalogLifecycleAction,
    reason: string,
    expectedVersion: number,
  ) {
    const preview = await service.previewSkuLifecycle(
      requestContext(fixture), fixture.skuId, { action, reason }, randomUUID(),
    );
    const input = {
      action,
      confirmationHash: preview.confirmation_hash,
      previewToken: preview.preview_token,
      reason,
    };
    const confirmKey = randomUUID();
    const response = await service.confirmSkuLifecycle(
      requestContext(fixture), fixture.skuId, input, expectedVersion, confirmKey,
    );
    return { confirmKey, input, preview, response };
  }

  async function confirmProduct(
    fixture: CatalogFixture,
    action: ProductCatalogLifecycleAction,
    reason: string,
    expectedVersion: number,
  ) {
    const preview = await service.previewProductLifecycle(
      requestContext(fixture), fixture.productId, { action, reason }, randomUUID(),
    );
    const input = {
      action,
      confirmationHash: preview.confirmation_hash,
      previewToken: preview.preview_token,
      reason,
    };
    const confirmKey = randomUUID();
    const response = await service.confirmProductLifecycle(
      requestContext(fixture), fixture.productId, input, expectedVersion, confirmKey,
    );
    return { confirmKey, input, preview, response };
  }

  fullIt('persists lifecycle capabilities and commands atomically through restore without cascading', async () => {
    const foundation = await runtime.withPrismaTransaction(seedFoundation);
    const fixture = await createCatalog(service, foundation);

    const skuActivation = await confirmSku(fixture, 'ACTIVATE', 'Enable the sellable SKU', 1);
    expect(skuActivation.response.envelope.data).toMatchObject({
      resource_id: fixture.skuId, resource_type: 'sku', status: 'ACTIVE', version: 2,
    });
    await expect(runtime.prisma.highRiskOperationPreview.findFirst({
      where: { action: 'SKU.ACTIVATE', target_id: fixture.skuId },
    })).resolves.toMatchObject({ consumed_at: expect.any(Date), resource_version: 1 });

    await expect(runtime.prisma.product.findUnique({ where: { id: fixture.productId } }))
      .resolves.toMatchObject({ published_at: null, status: 'DRAFT', version: 1 });
    const activationReason = 'Publish product after catalog approval';
    const productActivation = await confirmProduct(fixture, 'ACTIVATE', activationReason, 1);
    expect(productActivation.response.envelope.data).toMatchObject({
      resource_id: fixture.productId, resource_type: 'product', status: 'ACTIVE', version: 2,
    });
    const firstPublication = await runtime.prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } });
    expect(firstPublication.published_at).toBeInstanceOf(Date);
    await expect(runtime.prisma.highRiskOperationPreview.findFirst({
      where: { action: 'PRODUCT.ACTIVATE', target_id: fixture.productId },
    })).resolves.toMatchObject({ consumed_at: expect.any(Date), resource_version: 1 });
    await expect(runtime.prisma.auditLog.findFirst({
      where: { idempotency_key: productActivation.confirmKey },
    })).resolves.toMatchObject({
      action: 'ENABLE', object_id: fixture.productId, object_type: 'product', reason: activationReason,
    });
    await expect(runtime.prisma.outboxEvent.findFirst({
      where: { aggregate_id: fixture.productId, event_type: 'product.lifecycle_changed' },
    })).resolves.toMatchObject({
      aggregate_type: 'product',
      payload: {
        event_version: 1,
        resource_id: fixture.productId,
        resource_type: 'product',
        resource_version: 2,
      },
      status: 'PENDING',
    });
    await expect(runtime.prisma.idempotencyRecord.findFirst({
      where: { actor_id: fixture.accountId, idempotency_key: productActivation.confirmKey },
    })).resolves.toMatchObject({
      resource_id: fixture.productId,
      response_body: productActivation.response.envelope,
      response_status: 200,
    });

    const replay = await service.confirmProductLifecycle(
      requestContext(fixture), fixture.productId, productActivation.input, 1, productActivation.confirmKey,
    );
    expect(replay.envelope).toEqual(productActivation.response.envelope);
    await expect(runtime.prisma.auditLog.count({
      where: { idempotency_key: productActivation.confirmKey },
    })).resolves.toBe(1);
    await expect(runtime.prisma.outboxEvent.count({
      where: { aggregate_id: fixture.productId, event_type: 'product.lifecycle_changed' },
    })).resolves.toBe(1);

    await confirmProduct(fixture, 'DEACTIVATE', 'Pause product sales', 2);
    const afterDeactivation = await runtime.prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } });
    expect(afterDeactivation).toMatchObject({ status: 'INACTIVE', version: 3 });
    expect(afterDeactivation.published_at?.toISOString()).toBe(firstPublication.published_at?.toISOString());

    const blockedReason = 'Retire product while an active SKU remains';
    const blockedPreview = await service.previewProductLifecycle(
      requestContext(fixture), fixture.productId,
      { action: 'SOFT_DELETE', reason: blockedReason }, randomUUID(),
    );
    expect(blockedPreview.impact.warnings).toContain('ACTIVE_SKU_DEPENDENCY');
    const blockedPreviewRecord = await runtime.prisma.highRiskOperationPreview.findFirstOrThrow({
      orderBy: { created_at: 'desc' },
      where: { action: 'PRODUCT.SOFT_DELETE', target_id: fixture.productId },
    });
    expect(blockedPreviewRecord.consumed_at).toBeNull();
    const blockedConfirmKey = randomUUID();
    const productOutboxCount = await runtime.prisma.outboxEvent.count({
      where: { aggregate_id: fixture.productId },
    });
    await expect(service.confirmProductLifecycle(requestContext(fixture), fixture.productId, {
      action: 'SOFT_DELETE',
      confirmationHash: blockedPreview.confirmation_hash,
      previewToken: blockedPreview.preview_token,
      reason: blockedReason,
    }, 3, blockedConfirmKey)).rejects.toMatchObject({
      code: 'ACTIVE_SKU_DEPENDENCY',
      httpStatus: 422,
    });
    await expect(runtime.prisma.product.findUnique({ where: { id: fixture.productId } }))
      .resolves.toMatchObject({ deleted_at: null, status: 'INACTIVE', version: 3 });
    await expect(runtime.prisma.highRiskOperationPreview.findUnique({
      where: { id: blockedPreviewRecord.id },
    })).resolves.toMatchObject({ consumed_at: null });
    await expect(runtime.prisma.idempotencyRecord.count({
      where: { actor_id: fixture.accountId, idempotency_key: blockedConfirmKey },
    })).resolves.toBe(0);
    await expect(runtime.prisma.auditLog.count({
      where: { idempotency_key: blockedConfirmKey },
    })).resolves.toBe(0);
    await expect(runtime.prisma.outboxEvent.count({
      where: { aggregate_id: fixture.productId },
    })).resolves.toBe(productOutboxCount);

    await confirmSku(fixture, 'DEACTIVATE', 'Pause SKU sales', 2);
    await confirmSku(fixture, 'SOFT_DELETE', 'Archive inactive SKU', 3);
    await confirmProduct(fixture, 'SOFT_DELETE', 'Archive inactive product', 3);
    await expect(runtime.prisma.product.findUnique({ where: { id: fixture.productId } }))
      .resolves.toMatchObject({ status: 'ARCHIVED', version: 4 });
    await expect(runtime.prisma.sku.findUnique({ where: { id: fixture.skuId } }))
      .resolves.toMatchObject({ status: 'ARCHIVED', version: 4 });

    const restoredProduct = await service.restoreProduct(
      requestContext(fixture), fixture.productId, { reason: 'Resume product preparation' }, 4, randomUUID(),
    );
    expect(restoredProduct.envelope.data).toMatchObject({ status: 'DRAFT', version: 5 });
    await expect(runtime.prisma.sku.findUnique({ where: { id: fixture.skuId } }))
      .resolves.toMatchObject({ status: 'ARCHIVED', version: 4 });

    const restoredSku = await service.restoreSku(
      requestContext(fixture), fixture.skuId, { reason: 'Resume SKU preparation' }, 4, randomUUID(),
    );
    expect(restoredSku.envelope.data).toMatchObject({ status: 'INACTIVE', version: 5 });
    const finalProduct = await runtime.prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } });
    expect(finalProduct).toMatchObject({ status: 'DRAFT', version: 5 });
    expect(finalProduct.published_at?.toISOString()).toBe(firstPublication.published_at?.toISOString());
  }, 90_000);

  fullIt('allows exactly one concurrent confirmation to consume a SKU lifecycle preview', async () => {
    const foundation = await runtime.withPrismaTransaction(seedFoundation);
    const fixture = await createCatalog(service, foundation);
    const reason = 'Activate SKU through one concurrent confirmation';
    const previewKey = randomUUID();
    const preview = await service.previewSkuLifecycle(
      requestContext(fixture), fixture.skuId, { action: 'ACTIVATE', reason }, previewKey,
    );
    const input = {
      action: 'ACTIVATE' as const,
      confirmationHash: preview.confirmation_hash,
      previewToken: preview.preview_token,
      reason,
    };
    const confirmKeys = [randomUUID(), randomUUID()] as const;
    const outcomes = await Promise.allSettled(confirmKeys.map((idempotencyKey) =>
      service.confirmSkuLifecycle(
        requestContext(fixture), fixture.skuId, input, 1, idempotencyKey,
      )));
    const successfulIndexes = outcomes.flatMap((outcome, index) =>
      outcome.status === 'fulfilled' ? [index] : []);
    const failedOutcomes = outcomes.filter((outcome) => outcome.status === 'rejected');
    expect(successfulIndexes).toHaveLength(1);
    expect(failedOutcomes).toHaveLength(1);
    expect(failedOutcomes[0]).toMatchObject({
      reason: { code: 'PREVIEW_EXPIRED', httpStatus: 409 },
      status: 'rejected',
    });
    const successfulIndex = successfulIndexes[0];
    if (successfulIndex === undefined) throw new TypeError('Concurrent SKU confirmation had no winner');
    const successfulKey = confirmKeys[successfulIndex];
    const failedKey = confirmKeys[successfulIndex === 0 ? 1 : 0];
    expect(outcomes[successfulIndex]).toMatchObject({
      status: 'fulfilled',
      value: { envelope: { data: { status: 'ACTIVE', version: 2 } } },
    });

    await expect(runtime.prisma.sku.findUnique({ where: { id: fixture.skuId } }))
      .resolves.toMatchObject({ status: 'ACTIVE', version: 2 });
    const previewRecords = await runtime.prisma.highRiskOperationPreview.findMany({
      where: { action: 'SKU.ACTIVATE', target_id: fixture.skuId },
    });
    expect(previewRecords).toHaveLength(1);
    expect(previewRecords[0]).toMatchObject({ consumed_at: expect.any(Date), resource_version: 1 });

    const commandRecords = await runtime.prisma.idempotencyRecord.findMany({
      where: {
        actor_id: fixture.accountId,
        idempotency_key: { in: [...confirmKeys] },
      },
    });
    expect(commandRecords).toHaveLength(1);
    expect(commandRecords[0]).toMatchObject({
      idempotency_key: successfulKey,
      resource_id: fixture.skuId,
      response_status: 200,
    });
    expect(commandRecords[0]?.response_body).not.toBeNull();
    expect(commandRecords.some(({ idempotency_key }) => idempotency_key === failedKey)).toBe(false);

    const commandAudits = await runtime.prisma.auditLog.findMany({
      where: { idempotency_key: { in: [...confirmKeys] }, object_id: fixture.skuId },
    });
    expect(commandAudits).toHaveLength(1);
    expect(commandAudits[0]).toMatchObject({
      action: 'ENABLE',
      idempotency_key: successfulKey,
      reason,
      result: 'SUCCESS',
    });
    await expect(runtime.prisma.outboxEvent.findMany({
      where: {
        aggregate_id: fixture.skuId,
        aggregate_type: 'sku',
        event_type: 'sku.lifecycle_changed',
      },
    })).resolves.toEqual([
      expect.objectContaining({
        payload: {
          event_version: 1,
          resource_id: fixture.skuId,
          resource_type: 'sku',
          resource_version: 2,
        },
        status: 'PENDING',
      }),
    ]);
  }, 90_000);

  rollbackIt('leaves no service lifecycle, audit, outbox or capability facts after rollback-only smoke', async () => {
    let fixture: CatalogFixture | undefined;
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      const foundation = await seedFoundation(transaction);
      const rollbackService = new AdminProductsService(
        config(), transactionBoundRuntime(runtime, transaction), storage,
      );
      fixture = await createCatalog(rollbackService, foundation);
      const skuPreview = await rollbackService.previewSkuLifecycle(
        requestContext(fixture), fixture.skuId,
        { action: 'ACTIVATE', reason: 'Rollback-only SKU activation' }, randomUUID(),
      );
      await rollbackService.confirmSkuLifecycle(requestContext(fixture), fixture.skuId, {
        action: 'ACTIVATE',
        confirmationHash: skuPreview.confirmation_hash,
        previewToken: skuPreview.preview_token,
        reason: 'Rollback-only SKU activation',
      }, 1, randomUUID());
      const productPreview = await rollbackService.previewProductLifecycle(
        requestContext(fixture), fixture.productId,
        { action: 'ACTIVATE', reason: 'Rollback-only Product activation' }, randomUUID(),
      );
      await rollbackService.confirmProductLifecycle(requestContext(fixture), fixture.productId, {
        action: 'ACTIVATE',
        confirmationHash: productPreview.confirmation_hash,
        previewToken: productPreview.preview_token,
        reason: 'Rollback-only Product activation',
      }, 1, randomUUID());
      throw rollbackSentinel;
    }, rollbackOptions)).rejects.toBe(rollbackSentinel);
    if (!fixture) throw new TypeError('Rollback-only B4 API fixture was not created');
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { id: fixture.accountId } }),
      runtime.prisma.product.count({ where: { id: fixture.productId } }),
      runtime.prisma.sku.count({ where: { id: fixture.skuId } }),
      runtime.prisma.highRiskOperationPreview.count({ where: { actor_account_id: fixture.accountId } }),
      runtime.prisma.idempotencyRecord.count({ where: { actor_id: fixture.accountId } }),
      runtime.prisma.auditLog.count({ where: { actor_account_id: fixture.accountId } }),
      runtime.prisma.outboxEvent.count({
        where: { aggregate_id: { in: [fixture.productId, fixture.skuId] } },
      }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0, 0]);
  }, 120_000);
});
