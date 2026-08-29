import { randomUUID } from 'node:crypto';

import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  createDatabaseRuntime,
  type DatabaseRuntime,
  type DatabaseTransaction,
} from '@qingxu/database';
import { generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import type { BannerCreateInput } from './admin-banners.dto';
import { AdminBannersService } from './admin-banners.service';

type IntegrationMode = 'full' | 'rollback';

const mode = process.env.B5_BANNER_API_TEST_MODE as IntegrationMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B5_BANNER_API_TEST_MODE must be full or rollback');
}
const integrationDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackOptions = mode === 'rollback'
  ? { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 90_000 }
  : undefined;
const rollbackSentinel = Object.freeze({ code: 'B5_BANNER_API_ROLLBACK_SENTINEL' });
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

interface BannerFoundation {
  accountId: string;
  fileId: string;
  sessionId: string;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B5 Banner API integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B5 Banner API tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    let username: string;
    let databaseName: string;
    try {
      username = decodeURIComponent(url.username);
      databaseName = decodeURIComponent(url.pathname.slice(1));
    } catch {
      throw new TypeError('B5 Banner API DATABASE_URL contains invalid percent encoding');
    }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !LOOPBACK_HOSTS.has(url.hostname) ||
      username !== 'mall_runtime' || !url.password || url.search !== '' || url.hash !== '' ||
      !/(?:^|[-_])(?:b5|banner|api|test|ephemeral)(?:[-_]|$)/i.test(databaseName)) {
      throw new TypeError('Full B5 Banner API tests require a query-free loopback mall_runtime test DB');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b5-banner-api-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B5 Banner API tests cannot use the ephemeral PostgreSQL capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b5-banner-api-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function config(): PlatformRuntimeConfig {
  return {
    authentication: {} as PlatformRuntimeConfig['authentication'],
    store: {} as PlatformRuntimeConfig['store'],
    banner: { targetOrigins: ['https://allowed.example.test'] },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      fieldKeys: { current: { id: 'field', key: Buffer.alloc(32, 0x51) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'b5-banner-v1', key: Buffer.alloc(32, 0x52) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 0x53),
    },
    environment: 'test',
    payment: { provider: 'MOCK', mockSigningKey: Buffer.alloc(32, 0x54), providerTimeoutMs: 5_000 },
    port: 3000,
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

const storage = {
  publicUrl: (objectKey: string) => `https://assets.example.test/${objectKey}`,
} as ObjectStoragePort;

function requestContext(foundation: BannerFoundation): AdminCatalogRequestContext {
  return {
    accessSession: {
      accountId: foundation.accountId,
      accountVersion: 1,
      accessJti: `access:${foundation.sessionId}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
      factorEncryptionKeyId: 'b5-field',
      factorId: generateUlid(),
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(32),
      mfaVerifiedAt: new Date(),
      sessionFamily: foundation.sessionId,
      sessionId: foundation.sessionId,
    },
    principal: {
      accountId: foundation.accountId,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: foundation.sessionId,
    },
    requestId: `req_${randomUUID().replaceAll('-', '')}`,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

async function seedFoundation(transaction: DatabaseTransaction): Promise<BannerFoundation> {
  const accountId = generateUlid();
  const fileId = generateUlid();
  const sessionId = generateUlid();
  const now = new Date();
  await transaction.account.create({
    data: {
      created_at: now,
      id: accountId,
      login_name: `b5-banner-${accountId}`,
      password_hash: `integration:${accountId}`,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      updated_at: now,
    },
  });
  await transaction.fileAsset.create({
    data: {
      byte_size: 1_024n,
      created_at: now,
      created_by_id: accountId,
      id: fileId,
      mime_type: 'image/png',
      object_key: `public/${fileId}`,
      original_name: 'banner.png',
      purpose: 'BANNER',
      sha256: '5'.repeat(64),
      status: 'READY',
      visibility: 'PUBLIC',
    },
  });
  return { accountId, fileId, sessionId };
}

function createInput(foundation: BannerFoundation): BannerCreateInput {
  return {
    fileId: foundation.fileId,
    initialStatus: 'DRAFT',
    sortOrder: 10,
    target: { targetUrl: 'https://allowed.example.test/campaign', type: 'URL' },
    title: `B5 Banner ${generateUlid()}`,
  };
}

function transactionBoundRuntime(runtime: DatabaseRuntime, transaction: DatabaseTransaction): DatabaseRuntime {
  const prisma = {
    $transaction: async <T>(work: (current: DatabaseTransaction) => Promise<T>): Promise<T> => work(transaction),
  } as unknown as DatabaseRuntime['prisma'];
  return { ...runtime, prisma };
}

integrationDescribe('B5.1 Banner service and PostgreSQL integration', () => {
  let runtime: DatabaseRuntime;
  let service: AdminBannersService;

  beforeAll(async () => {
    runtime = runtimeForMode();
    await runtime.connect();
    service = new AdminBannersService(config(), runtime, storage);
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  fullIt('executes all Banner writes with exact replay, optimistic locking, audit and outbox atomicity', async () => {
    const foundation = await runtime.withPrismaTransaction(seedFoundation);
    const input = createInput(foundation);
    const createKey = randomUUID();
    const created = await service.createBanner(requestContext(foundation), input, createKey);
    const bannerId = created.envelope.data.banner_id;
    expect(created.envelope.data).toEqual({
      banner_id: bannerId,
      ends_at: null,
      file_id: foundation.fileId,
      image_url: `https://assets.example.test/public/${foundation.fileId}`,
      sort_order: 10,
      starts_at: null,
      status: 'DRAFT',
      target_id: null,
      target_type: 'URL',
      target_url: 'https://allowed.example.test/campaign',
      title: input.title,
      version: 1,
    });

    const createReplay = await service.createBanner(requestContext(foundation), input, createKey);
    expect(createReplay.envelope).toEqual(created.envelope);
    await expect(Promise.all([
      runtime.prisma.banner.count({ where: { id: bannerId } }),
      runtime.prisma.auditLog.count({ where: { idempotency_key: createKey } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: bannerId } }),
      runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: createKey } }),
    ])).resolves.toEqual([1, 1, 1, 1]);

    await expect(service.createBanner(requestContext(foundation), {
      ...input,
      title: `${input.title} changed`,
    }, createKey)).rejects.toMatchObject({ httpStatus: 409 });

    const updateKey = randomUUID();
    const updated = await service.patchBanner(
      requestContext(foundation), bannerId,
      { kind: 'UPDATE', patch: { sortOrder: 5, title: `${input.title} updated` } },
      1,
      updateKey,
    );
    expect(updated.envelope.data).toMatchObject({ sort_order: 5, status: 'DRAFT', version: 2 });
    const updateReplay = await service.patchBanner(
      requestContext(foundation), bannerId,
      { kind: 'UPDATE', patch: { sortOrder: 5, title: `${input.title} updated` } },
      1,
      updateKey,
    );
    expect(updateReplay.envelope).toEqual(updated.envelope);
    await expect(service.patchBanner(
      requestContext(foundation), bannerId,
      { kind: 'UPDATE', patch: { sortOrder: 5, title: `${input.title} updated` } },
      2,
      updateKey,
    )).rejects.toMatchObject({ httpStatus: 409 });

    const activateKey = randomUUID();
    const activated = await service.patchBanner(
      requestContext(foundation), bannerId, { action: 'ACTIVATE', kind: 'STATUS' }, 2, activateKey,
    );
    expect(activated.envelope.data).toMatchObject({ status: 'ACTIVE', version: 3 });
    const activateReplay = await service.patchBanner(
      requestContext(foundation), bannerId, { action: 'ACTIVATE', kind: 'STATUS' }, 2, activateKey,
    );
    expect(activateReplay.envelope).toEqual(activated.envelope);
    const blockedArchiveKey = randomUUID();
    await expect(service.archiveBanner(
      requestContext(foundation), bannerId, { reason: 'Cannot archive an active Banner' }, 3, blockedArchiveKey,
    )).rejects.toMatchObject({ httpStatus: 409 });
    await expect(runtime.prisma.banner.findUnique({ where: { id: bannerId } }))
      .resolves.toMatchObject({ deleted_at: null, status: 'ACTIVE', version: 3 });
    await expect(runtime.prisma.idempotencyRecord.count({ where: { idempotency_key: blockedArchiveKey } }))
      .resolves.toBe(0);

    const deactivateKey = randomUUID();
    const deactivated = await service.patchBanner(
      requestContext(foundation), bannerId, { action: 'DEACTIVATE', kind: 'STATUS' }, 3, deactivateKey,
    );
    expect(deactivated.envelope.data).toMatchObject({ status: 'INACTIVE', version: 4 });
    const deactivateReplay = await service.patchBanner(
      requestContext(foundation), bannerId, { action: 'DEACTIVATE', kind: 'STATUS' }, 3, deactivateKey,
    );
    expect(deactivateReplay.envelope).toEqual(deactivated.envelope);
    const archiveReason = 'Campaign has reached its planned end';
    const archiveKey = randomUUID();
    const archived = await service.archiveBanner(
      requestContext(foundation), bannerId, { reason: archiveReason }, 4, archiveKey,
    );
    expect(archived.envelope.data).toMatchObject({ status: 'ARCHIVED', version: 5 });
    const archiveReplay = await service.archiveBanner(
      requestContext(foundation), bannerId, { reason: archiveReason }, 4, archiveKey,
    );
    expect(archiveReplay.envelope).toEqual(archived.envelope);
    await expect(runtime.prisma.banner.findUnique({ where: { id: bannerId } }))
      .resolves.toMatchObject({ deleted_at: expect.any(Date), status: 'ARCHIVED', version: 5 });

    const defaultList = await service.listBanners({ page: 1, pageSize: 20 });
    expect(defaultList.items.some((item) => item.banner_id === bannerId)).toBe(false);
    const archivedList = await service.listBanners({ page: 1, pageSize: 20, status: 'ARCHIVED' });
    expect(archivedList.items.some((item) => item.banner_id === bannerId)).toBe(true);

    const restoreReason = 'Prepare this Banner for a revised campaign';
    const restoreKey = randomUUID();
    const restored = await service.restoreBanner(
      requestContext(foundation), bannerId, { reason: restoreReason }, 5, restoreKey,
    );
    expect(restored.envelope.data).toMatchObject({ status: 'DRAFT', version: 6 });
    const restoreReplay = await service.restoreBanner(
      requestContext(foundation), bannerId, { reason: restoreReason }, 5, restoreKey,
    );
    expect(restoreReplay.envelope).toEqual(restored.envelope);
    await expect(runtime.prisma.banner.findUnique({ where: { id: bannerId } }))
      .resolves.toMatchObject({ deleted_at: null, status: 'DRAFT', version: 6 });
    await expect(runtime.prisma.auditLog.findFirst({ where: { idempotency_key: restoreKey } }))
      .resolves.toMatchObject({ action: 'RESTORE', object_id: bannerId, reason: restoreReason });

    const outbox = await runtime.prisma.outboxEvent.findMany({
      where: { aggregate_id: bannerId, aggregate_type: 'banner' },
    });
    expect(outbox).toHaveLength(6);
    expect(Object.fromEntries(outbox.map(({ event_type: eventType, payload }) => [
      eventType,
      (payload as { resource_version: number }).resource_version,
    ]))).toEqual({
      'banner.activated': 3,
      'banner.archived': 5,
      'banner.created': 1,
      'banner.deactivated': 4,
      'banner.restored': 6,
      'banner.updated': 2,
    });
    await expect(runtime.prisma.auditLog.count({ where: { object_id: bannerId, object_type: 'banner' } }))
      .resolves.toBe(6);
    await expect(runtime.prisma.idempotencyRecord.count({
      where: { actor_id: foundation.accountId, resource_id: bannerId },
    })).resolves.toBe(6);
  }, 90_000);

  rollbackIt('leaves no Banner, audit, outbox or idempotency facts after rollback-only smoke', async () => {
    let foundation: BannerFoundation | undefined;
    let bannerId: string | undefined;
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      foundation = await seedFoundation(transaction);
      const rollbackService = new AdminBannersService(
        config(), transactionBoundRuntime(runtime, transaction), storage,
      );
      const created = await rollbackService.createBanner(
        requestContext(foundation), createInput(foundation), randomUUID(),
      );
      bannerId = created.envelope.data.banner_id;
      await rollbackService.patchBanner(
        requestContext(foundation), bannerId, { action: 'ACTIVATE', kind: 'STATUS' }, 1, randomUUID(),
      );
      await rollbackService.patchBanner(
        requestContext(foundation), bannerId, { action: 'DEACTIVATE', kind: 'STATUS' }, 2, randomUUID(),
      );
      await rollbackService.archiveBanner(
        requestContext(foundation), bannerId, { reason: 'Rollback-only Banner archive' }, 3, randomUUID(),
      );
      await rollbackService.restoreBanner(
        requestContext(foundation), bannerId, { reason: 'Rollback-only Banner restore' }, 4, randomUUID(),
      );
      throw rollbackSentinel;
    }, rollbackOptions)).rejects.toBe(rollbackSentinel);
    if (!foundation || !bannerId) throw new TypeError('Rollback-only B5 Banner fixture was not created');
    await expect(Promise.all([
      runtime.prisma.account.count({ where: { id: foundation.accountId } }),
      runtime.prisma.fileAsset.count({ where: { id: foundation.fileId } }),
      runtime.prisma.banner.count({ where: { id: bannerId } }),
      runtime.prisma.auditLog.count({ where: { actor_account_id: foundation.accountId } }),
      runtime.prisma.outboxEvent.count({ where: { aggregate_id: bannerId } }),
      runtime.prisma.idempotencyRecord.count({ where: { actor_id: foundation.accountId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0]);
  }, 120_000);
});
