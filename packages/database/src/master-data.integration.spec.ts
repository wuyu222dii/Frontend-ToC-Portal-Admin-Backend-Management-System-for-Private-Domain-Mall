import { randomUUID } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditRepository } from './audit.repository';
import { HighRiskPreviewRepository } from './high-risk-preview.repository';
import {
  IdempotencyRepository,
  type DatabaseTransaction,
  type IdempotencyClaim,
  type IdempotencyHashKeyRing,
} from './idempotency.repository';
import { MasterDataRepository } from './master-data.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B3_MASTER_DATA_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B3_MASTER_DATA_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const atomicRollbackTransactionOptions = mode === 'rollback'
  ? {
      isolationLevel: 'Serializable' as const,
      maxWait: 15_000,
      timeout: 60_000,
    }
  : { isolationLevel: 'Serializable' as const };
const remoteRollbackTestTimeoutMs = 90_000;
const rollbackSentinel = Object.freeze({ code: 'B3_MASTER_DATA_ROLLBACK_SENTINEL' });
const auditKey = Buffer.alloc(32, 0x71);
const hashKeys: IdempotencyHashKeyRing = {
  current: { id: 'b3-master-data-v1', key: Buffer.alloc(32, 0x72) },
  previous: [],
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B3 master-data database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B3 master-data tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B3 master-data tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b3-master-data-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B3 master-data tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b3-master-data-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function requestId(): string {
  return `req_${randomUUID().replaceAll('-', '')}`;
}

function previewToken(): string {
  return `pv_${randomUUID().replaceAll('-', '')}`;
}

function claim(
  actorId: string,
  idempotencyKey: string,
  route: string,
  pathParameters: Record<string, string>,
  body: unknown,
): IdempotencyClaim {
  return { actorId, idempotencyKey, request: { body, method: 'POST', pathParameters, route } };
}

databaseDescribe('B3 master-data database integration', () => {
  let runtime: DatabaseRuntime;
  let master: MasterDataRepository;
  let previews: HighRiskPreviewRepository;
  let idempotency: IdempotencyRepository;
  let audit: AuditRepository;
  let repositoryNow: Date;

  beforeAll(async () => {
    runtime = runtimeForMode();
    repositoryNow = new Date();
    master = new MasterDataRepository(runtime.prisma, () => repositoryNow);
    previews = new HighRiskPreviewRepository(runtime.prisma, hashKeys, () => repositoryNow);
    idempotency = new IdempotencyRepository(hashKeys, () => repositoryNow);
    audit = new AuditRepository(auditKey, () => repositoryNow);
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function createIdentity(
    transaction: DatabaseTransaction,
    actorId: string,
    sessionId: string,
  ): Promise<void> {
    const factorId = generateUlid();
    await transaction.account.create({
      data: {
        created_at: repositoryNow,
        id: actorId,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: repositoryNow,
      },
    });
    await transaction.totpFactor.create({
      data: {
        account_id: actorId,
        encryption_key_id: 'b3-integration-v1',
        id: factorId,
        label: 'B3 integration',
        secret_ciphertext: Buffer.alloc(32, 0x73),
        secret_fingerprint: 'b'.repeat(64),
        status: 'ACTIVE',
        verified_at: repositoryNow,
      },
    });
    await transaction.authSession.create({
      data: {
        access_jti: randomUUID(),
        account_id: actorId,
        assurance: 'MFA',
        created_at: repositoryNow,
        expires_at: new Date(repositoryNow.getTime() + 3_600_000),
        id: sessionId,
        mfa_factor_id: factorId,
        mfa_verified_at: repositoryNow,
        refresh_token_hash: randomUUID().replaceAll('-', '').repeat(2),
        restriction: 'NONE',
        rotation_counter: 0,
        session_family: generateUlid(),
      },
    });
  }

  async function createPublicFile(
    transaction: DatabaseTransaction,
    actorId: string,
    fileId: string,
    purpose: 'BRAND_LOGO' | 'CATEGORY_ICON',
  ): Promise<void> {
    await transaction.fileAsset.create({
      data: {
        byte_size: 1_024n,
        created_at: repositoryNow,
        created_by_id: actorId,
        id: fileId,
        mime_type: 'image/png',
        object_key: `public/${fileId}`,
        original_name: 'catalog.png',
        purpose,
        sha256: 'a'.repeat(64),
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
  }

  async function verifyAtomicRollback(): Promise<void> {
    const actorId = generateUlid();
    const sessionId = generateUlid();
    const brandId = generateUlid();
    const fileId = generateUlid();
    const previewKey = randomUUID();
    const confirmKey = randomUUID();
    const token = previewToken();
    const request = { action: 'ACTIVATE' as const, reason: 'Approve the development catalog' };
    const auditRequestId = requestId();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await createIdentity(transaction, actorId, sessionId);
      await createPublicFile(transaction, actorId, fileId, 'BRAND_LOGO');
      await master.createBrandInTransaction(transaction, {
        actorId,
        description: null,
        id: brandId,
        logoFileId: fileId,
        name: `Rollback brand ${brandId}`,
        sortOrder: 0,
      });

      const previewClaim = claim(
        actorId,
        previewKey,
        '/admin/brands/{brand_id}/lifecycle-preview',
        { brand_id: brandId },
        request,
      );
      expect(await idempotency.claim(transaction, previewClaim)).toEqual({ kind: 'execute' });
      const impact = await master.getLifecyclePreviewImpactInTransaction(transaction, {
        action: 'ACTIVATE',
        targetId: brandId,
        targetType: 'BRAND',
      });
      const issued = await previews.issueInTransaction(transaction, {
        action: 'BRAND.ACTIVATE',
        actorId,
        previewToken: token,
        request,
        resourceVersion: impact.resource.version,
        sessionId,
        targetId: brandId,
        targetType: 'BRAND',
      });
      await idempotency.complete(transaction, previewClaim, {
        resourceId: brandId,
        responseForHash: { status: impact.resource.status, version: impact.resource.version },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });

      const confirmBody = {
        ...request,
        confirmation_hash: issued.confirmationHash,
        expected_version: 1,
        preview_token: token,
      };
      const confirmClaim = claim(
        actorId,
        confirmKey,
        '/admin/brands/{brand_id}/lifecycle-changes',
        { brand_id: brandId },
        confirmBody,
      );
      expect(await idempotency.claim(transaction, confirmClaim)).toEqual({ kind: 'execute' });
      const changed = await master.applyLifecycleInTransaction(transaction, {
        action: 'ACTIVATE',
        expectedVersion: 1,
        targetId: brandId,
        targetType: 'BRAND',
      });
      await previews.consumeInTransaction(transaction, {
        action: 'BRAND.ACTIVATE',
        actorId,
        confirmationHash: issued.confirmationHash,
        previewToken: token,
        request,
        resourceVersion: 1,
        sessionId,
        targetId: brandId,
        targetType: 'BRAND',
      });
      await audit.append(transaction, {
        action: 'ENABLE',
        actorAccountId: actorId,
        actorRole: 'SUPER_ADMIN',
        after: { status: changed.resource.status, version: changed.resource.version },
        before: { status: 'DRAFT', version: 1 },
        idempotencyKey: confirmKey,
        module: 'catalog',
        objectId: brandId,
        objectType: 'brand',
        reasonCode: 'CATALOG.BRAND_ACTIVATE',
        requestId: auditRequestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'STATUS_VERSION',
      });
      await idempotency.complete(transaction, confirmClaim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: {
          code: 'OK',
          data: {
            occurred_at: repositoryNow.toISOString(),
            resource_id: brandId,
            resource_type: 'brand',
            status: 'ACTIVE',
            version: 2,
          },
          message: 'success',
          request_id: auditRequestId,
        },
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      throw rollbackSentinel;
    }, atomicRollbackTransactionOptions)).rejects.toBe(rollbackSentinel);
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { id: actorId } }),
      runtime.prisma.brand.count({ where: { id: brandId } }),
      runtime.prisma.fileAsset.count({ where: { id: fileId } }),
      runtime.prisma.highRiskOperationPreview.count({ where: { actor_account_id: actorId } }),
      runtime.prisma.idempotencyRecord.count({ where: { actor_id: actorId } }),
      runtime.prisma.auditLog.count({ where: { request_id: auditRequestId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0]);
  }

  rollbackIt(
    'rolls back master data, preview, audit and idempotency facts without residue',
    verifyAtomicRollback,
    remoteRollbackTestTimeoutMs,
  );
  fullIt('rolls back master data, preview, audit and idempotency facts without residue', verifyAtomicRollback);

  fullIt('enforces file ownership, stable lists, optimistic locks, reserved names and restore-to-DRAFT', async () => {
    const actorId = generateUlid();
    const otherActorId = generateUlid();
    const sessionId = generateUlid();
    const otherSessionId = generateUlid();
    const brandId = generateUlid();
    const otherBrandId = generateUlid();
    const fileId = generateUlid();
    await runtime.withPrismaTransaction(async (transaction) => {
      await createIdentity(transaction, actorId, sessionId);
      await createIdentity(transaction, otherActorId, otherSessionId);
      await createPublicFile(transaction, actorId, fileId, 'BRAND_LOGO');
      await expect(master.createBrandInTransaction(transaction, {
        actorId: otherActorId,
        description: null,
        id: otherBrandId,
        logoFileId: fileId,
        name: `Cross-owner ${otherBrandId}`,
        sortOrder: 0,
      })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
      await master.createBrandInTransaction(transaction, {
        actorId,
        description: 'Integration brand',
        id: brandId,
        logoFileId: fileId,
        name: `Reserved ${brandId}`,
        sortOrder: 2,
      });
    });

    await expect(runtime.withPrismaTransaction((transaction) => master.updateBrandInTransaction(transaction, {
      actorId,
      expectedVersion: 2,
      id: brandId,
      patch: { sortOrder: 0 },
    }))).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

    await runSerializableTransaction(runtime.prisma, (transaction) => master.applyLifecycleInTransaction(transaction, {
      action: 'SOFT_DELETE',
      expectedVersion: 1,
      targetId: brandId,
      targetType: 'BRAND',
    }));
    await expect(runtime.withPrismaTransaction((transaction) => master.createBrandInTransaction(transaction, {
      actorId,
      description: null,
      id: generateUlid(),
      logoFileId: null,
      name: `Reserved ${brandId}`,
      sortOrder: 0,
    }))).rejects.toMatchObject({ code: 'SOFT_DELETED_KEY_RESERVED' });
    await expect(master.listBrands({ page: 1, pageSize: 100 })).resolves.toMatchObject({
      items: expect.not.arrayContaining([expect.objectContaining({ id: brandId })]),
    });
    await expect(master.listBrands({ page: 1, pageSize: 100, status: 'ARCHIVED' })).resolves.toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ id: brandId })]),
    });
    await expect(runtime.withPrismaTransaction((transaction) => master.restoreBrandInTransaction(transaction, {
      expectedVersion: 2,
      id: brandId,
    }))).resolves.toMatchObject({ deletedAt: null, status: 'DRAFT', version: 3 });
  });

  fullIt('returns ACTIVE product impact in preview and blocks confirmation without changing state', async () => {
    const actorId = generateUlid();
    const sessionId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    await runtime.withPrismaTransaction(async (transaction) => {
      await createIdentity(transaction, actorId, sessionId);
      await master.createBrandInTransaction(transaction, {
        actorId,
        description: null,
        id: brandId,
        logoFileId: null,
        name: `Dependency brand ${brandId}`,
        sortOrder: 0,
      });
      await master.createCategoryInTransaction(transaction, {
        actorId,
        iconFileId: null,
        id: categoryId,
        name: `Dependency category ${categoryId}`,
        sortOrder: 0,
      });
      await transaction.product.create({
        data: {
          brand_id: brandId,
          category_id: categoryId,
          created_at: repositoryNow,
          id: productId,
          name: 'Active dependency',
          spu_code: `SPU-${productId}`,
          status: 'ACTIVE',
          updated_at: repositoryNow,
        },
      });
    });
    const impact = await runSerializableTransaction(runtime.prisma, (transaction) =>
      master.getLifecyclePreviewImpactInTransaction(transaction, {
        action: 'SOFT_DELETE',
        targetId: categoryId,
        targetType: 'CATEGORY',
      }));
    expect(impact).toMatchObject({ activeProductCount: 1, activeProductIds: [productId] });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) => master.applyLifecycleInTransaction(
      transaction,
      { action: 'SOFT_DELETE', expectedVersion: 1, targetId: categoryId, targetType: 'CATEGORY' },
    ))).rejects.toMatchObject({ code: 'ACTIVE_PRODUCT_DEPENDENCY' });
    await expect(master.getCategory(categoryId)).resolves.toMatchObject({ status: 'DRAFT', version: 1 });
  });

  fullIt('binds previews to actor/session/action/target/request/version and rejects expiry and replay', async () => {
    const actorId = generateUlid();
    const sessionId = generateUlid();
    const brandId = generateUlid();
    await runtime.withPrismaTransaction(async (transaction) => {
      await createIdentity(transaction, actorId, sessionId);
      await master.createBrandInTransaction(transaction, {
        actorId,
        description: null,
        id: brandId,
        logoFileId: null,
        name: `Preview brand ${brandId}`,
        sortOrder: 0,
      });
    });
    const request = { action: 'ACTIVATE' as const, reason: 'Approve the integration brand' };
    const token = previewToken();
    const issued = await runtime.withPrismaTransaction((transaction) => previews.issueInTransaction(transaction, {
      action: 'BRAND.ACTIVATE',
      actorId,
      previewToken: token,
      request,
      resourceVersion: 1,
      sessionId,
      targetId: brandId,
      targetType: 'BRAND',
    }));
    await expect(runtime.withPrismaTransaction((transaction) => previews.consumeInTransaction(transaction, {
      action: 'BRAND.ACTIVATE',
      actorId,
      confirmationHash: issued.confirmationHash,
      previewToken: token,
      request: { ...request, reason: 'Tampered reason' },
      resourceVersion: 1,
      sessionId,
      targetId: brandId,
      targetType: 'BRAND',
    }))).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });
    await expect(runtime.withPrismaTransaction((transaction) => previews.consumeInTransaction(transaction, {
      action: 'BRAND.ACTIVATE',
      actorId,
      confirmationHash: issued.confirmationHash,
      previewToken: token,
      request,
      resourceVersion: 1,
      sessionId,
      targetId: brandId,
      targetType: 'BRAND',
    }))).resolves.toBeUndefined();
    await expect(runtime.withPrismaTransaction((transaction) => previews.consumeInTransaction(transaction, {
      action: 'BRAND.ACTIVATE',
      actorId,
      confirmationHash: issued.confirmationHash,
      previewToken: token,
      request,
      resourceVersion: 1,
      sessionId,
      targetId: brandId,
      targetType: 'BRAND',
    }))).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });

    const expiryToken = previewToken();
    const expiring = await runtime.withPrismaTransaction((transaction) => previews.issueInTransaction(transaction, {
      action: 'BRAND.ACTIVATE',
      actorId,
      previewToken: expiryToken,
      request,
      resourceVersion: 1,
      sessionId,
      targetId: brandId,
      targetType: 'BRAND',
    }));
    repositoryNow = new Date(expiring.expiresAt);
    await expect(runtime.withPrismaTransaction((transaction) => previews.consumeInTransaction(transaction, {
      action: 'BRAND.ACTIVATE',
      actorId,
      confirmationHash: expiring.confirmationHash,
      previewToken: expiryToken,
      request,
      resourceVersion: 1,
      sessionId,
      targetId: brandId,
      targetType: 'BRAND',
    }))).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
    repositoryNow = new Date();
  });

  fullIt('serializes concurrent confirmation so one transition and one preview consumption win', async () => {
    const actorId = generateUlid();
    const sessionId = generateUlid();
    const brandId = generateUlid();
    await runtime.withPrismaTransaction(async (transaction) => {
      await createIdentity(transaction, actorId, sessionId);
      await master.createBrandInTransaction(transaction, {
        actorId,
        description: null,
        id: brandId,
        logoFileId: null,
        name: `Concurrent brand ${brandId}`,
        sortOrder: 0,
      });
    });
    const request = { action: 'ACTIVATE' as const, reason: 'Concurrent confirmation' };
    const issued = await Promise.all([previewToken(), previewToken()].map((token) =>
      runtime.withPrismaTransaction(async (transaction) => ({
        preview: await previews.issueInTransaction(transaction, {
          action: 'BRAND.ACTIVATE',
          actorId,
          previewToken: token,
          request,
          resourceVersion: 1,
          sessionId,
          targetId: brandId,
          targetType: 'BRAND',
        }),
        token,
      }))));
    const outcomes = await Promise.allSettled(issued.map(({ preview, token }) =>
      runSerializableTransaction(runtime.prisma, async (transaction) => {
        const changed = await master.applyLifecycleInTransaction(transaction, {
          action: 'ACTIVATE',
          expectedVersion: 1,
          targetId: brandId,
          targetType: 'BRAND',
        });
        await previews.consumeInTransaction(transaction, {
          action: 'BRAND.ACTIVATE',
          actorId,
          confirmationHash: preview.confirmationHash,
          previewToken: token,
          request,
          resourceVersion: 1,
          sessionId,
          targetId: brandId,
          targetType: 'BRAND',
        });
        return changed;
      })));
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    const rejection = outcomes.find(({ status }) => status === 'rejected');
    expect(rejection).toMatchObject({ reason: { code: 'RESOURCE_VERSION_CONFLICT' } });
    await expect(master.getBrand(brandId)).resolves.toMatchObject({ status: 'ACTIVE', version: 2 });
    await expect(runtime.prisma.highRiskOperationPreview.count({
      where: { actor_account_id: actorId, consumed_at: { not: null }, target_id: brandId },
    })).resolves.toBe(1);
  });
});
