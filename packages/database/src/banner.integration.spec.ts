import { generateUlid } from '@qingxu/platform-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  BannerRepository,
  type BannerTargetInput,
  type CreateBannerInput,
} from './banner.repository';
import type { DatabaseTransaction } from './idempotency.repository';
import { createDatabaseRuntime, type DatabaseRuntime } from './runtime';
import { runSerializableTransaction } from './transaction';

type DatabaseTestMode = 'full' | 'rollback';
const mode = process.env.B5_BANNER_DATABASE_TEST_MODE as DatabaseTestMode | undefined;
if (mode !== undefined && mode !== 'full' && mode !== 'rollback') {
  throw new TypeError('B5_BANNER_DATABASE_TEST_MODE must be full or rollback');
}
const databaseDescribe = mode === undefined ? describe.skip : describe;
const fullIt = mode === 'full' ? it : it.skip;
const rollbackIt = mode === 'rollback' ? it : it.skip;
const rollbackOptions = mode === 'rollback'
  ? { isolationLevel: 'Serializable' as const, maxWait: 15_000, timeout: 60_000 }
  : undefined;
const rollbackSentinel = Object.freeze({ code: 'B5_BANNER_ROLLBACK_SENTINEL' });
const NOW = new Date('2026-08-25T12:00:00.000Z');
const ALLOWED_ORIGIN = 'https://mall.example.test';

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for B5 Banner database integration tests`);
  return value;
}

function runtimeForMode(): DatabaseRuntime {
  const databaseUrl = requiredEnvironment('DATABASE_URL');
  if (mode === 'full') {
    if (process.env.CI !== 'true' || process.env.NODE_ENV !== 'test' ||
      process.env.ALLOW_CI_EPHEMERAL_POSTGRES !== '1') {
      throw new TypeError('Full B5 Banner tests require the explicit ephemeral CI capability');
    }
    const url = new URL(databaseUrl);
    if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(url.hostname)) {
      throw new TypeError('Full B5 Banner tests require a loopback PostgreSQL endpoint');
    }
    return createDatabaseRuntime({
      allowInsecureLocalhost: true,
      applicationName: 'qingxu-b5-banner-integration',
      connectionTimeoutMs: 5_000,
      databaseUrl,
      poolMax: 10,
    });
  }
  if (process.env.ALLOW_CI_EPHEMERAL_POSTGRES === '1') {
    throw new TypeError('Rollback B5 Banner tests cannot use the ephemeral CI capability');
  }
  return createDatabaseRuntime({
    applicationName: 'qingxu-b5-banner-rollback',
    connectionTimeoutMs: 15_000,
    databaseUrl,
    poolMax: 4,
    projectRef: requiredEnvironment('SUPABASE_PROJECT_REF'),
    sslRootCertPath: requiredEnvironment('PGSSLROOTCERT'),
  });
}

function noneTarget(): BannerTargetInput {
  return { targetId: null, targetType: 'NONE', targetUrl: null };
}

function bannerInput(options: {
  actorId: string;
  bannerId: string;
  fileId: string;
  title: string;
  target?: BannerTargetInput;
  sortOrder?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
}): CreateBannerInput {
  return {
    actorId: options.actorId,
    endsAt: options.endsAt ?? null,
    fileId: options.fileId,
    id: options.bannerId,
    sortOrder: options.sortOrder ?? 0,
    startsAt: options.startsAt ?? null,
    target: options.target ?? noneTarget(),
    title: options.title,
  };
}

databaseDescribe('B5 Banner database integration', () => {
  let runtime: DatabaseRuntime;
  let repository: BannerRepository;

  beforeAll(async () => {
    runtime = runtimeForMode();
    repository = new BannerRepository(runtime.prisma, [ALLOWED_ORIGIN], () => NOW);
    await runtime.connect();
  }, 30_000);

  afterAll(async () => runtime?.disconnect(), 30_000);

  async function createActor(transaction: DatabaseTransaction, actorId: string): Promise<void> {
    await transaction.account.create({
      data: {
        created_at: NOW,
        id: actorId,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        updated_at: NOW,
      },
    });
  }

  async function createFile(
    transaction: DatabaseTransaction,
    actorId: string,
    fileId: string,
    options: {
      purpose?: 'BANNER' | 'PRODUCT_IMAGE';
      status?: 'PENDING' | 'READY';
      visibility?: 'PRIVATE' | 'PUBLIC';
    } = {},
  ): Promise<void> {
    await transaction.fileAsset.create({
      data: {
        byte_size: 1_024n,
        created_at: NOW,
        created_by_id: actorId,
        id: fileId,
        mime_type: 'image/png',
        object_key: options.visibility === 'PRIVATE' ? `private/${fileId}` : `public/${fileId}`,
        original_name: 'banner.png',
        purpose: options.purpose ?? 'BANNER',
        sha256: 'a'.repeat(64),
        status: options.status ?? 'READY',
        visibility: options.visibility ?? 'PUBLIC',
      },
    });
  }

  async function createCatalogTargets(
    transaction: DatabaseTransaction,
    options: {
      activeCategoryId: string;
      activeProductId: string;
      brandId: string;
      inactiveCategoryId?: string;
      inactiveProductId?: string;
    },
  ): Promise<void> {
    await transaction.brand.create({
      data: {
        created_at: NOW,
        id: options.brandId,
        name: `B5 brand ${options.brandId}`,
        status: 'ACTIVE',
        updated_at: NOW,
      },
    });
    await transaction.category.create({
      data: {
        created_at: NOW,
        id: options.activeCategoryId,
        name: `B5 category ${options.activeCategoryId}`,
        status: 'ACTIVE',
        updated_at: NOW,
      },
    });
    if (options.inactiveCategoryId !== undefined) {
      await transaction.category.create({
        data: {
          created_at: NOW,
          id: options.inactiveCategoryId,
          name: `B5 inactive category ${options.inactiveCategoryId}`,
          status: 'INACTIVE',
          updated_at: NOW,
        },
      });
    }
    await transaction.product.create({
      data: {
        brand_id: options.brandId,
        category_id: options.activeCategoryId,
        created_at: NOW,
        id: options.activeProductId,
        name: `B5 product ${options.activeProductId}`,
        spu_code: `B5-SPU-${options.activeProductId}`,
        status: 'ACTIVE',
        updated_at: NOW,
      },
    });
    if (options.inactiveProductId !== undefined) {
      await transaction.product.create({
        data: {
          brand_id: options.brandId,
          category_id: options.activeCategoryId,
          created_at: NOW,
          id: options.inactiveProductId,
          name: `B5 inactive product ${options.inactiveProductId}`,
          spu_code: `B5-SPU-${options.inactiveProductId}`,
          status: 'INACTIVE',
          updated_at: NOW,
        },
      });
    }
  }

  async function createDraftFixture(options: {
    target?: BannerTargetInput;
    startsAt?: Date | null;
    endsAt?: Date | null;
  } = {}) {
    const actorId = generateUlid();
    const bannerId = generateUlid();
    const fileId = generateUlid();
    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createActor(transaction, actorId);
      await createFile(transaction, actorId, fileId);
      await repository.createBannerInTransaction(transaction, bannerInput({
        actorId,
        bannerId,
        endsAt: options.endsAt,
        fileId,
        startsAt: options.startsAt,
        target: options.target,
        title: `B5 lifecycle ${bannerId}`,
      }));
    });
    return { actorId, bannerId, fileId };
  }

  fullIt('creates explicit DRAFT rows and lists non-archived and archived rows with stable ordering', async () => {
    const actorId = generateUlid();
    const marker = generateUlid();
    const firstTieId = generateUlid(NOW.getTime() - 4);
    const secondTieId = generateUlid(NOW.getTime() - 3);
    const laterId = generateUlid(NOW.getTime() - 2);
    const archivedId = generateUlid(NOW.getTime() - 1);
    const ids = [firstTieId, secondTieId, laterId, archivedId];
    const fileIds = ids.map(() => generateUlid());

    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createActor(transaction, actorId);
      for (const fileId of fileIds) await createFile(transaction, actorId, fileId);
      for (const [index, bannerId] of ids.entries()) {
        const created = await repository.createBannerInTransaction(transaction, bannerInput({
          actorId,
          bannerId,
          fileId: fileIds[index]!,
          sortOrder: index < 2 ? 0 : index,
          title: `${marker} Banner ${index}`,
        }));
        expect(created).toMatchObject({ deletedAt: null, status: 'DRAFT', version: 1 });
      }
      await repository.archiveBannerInTransaction(transaction, { expectedVersion: 1, id: archivedId });
    });

    const listed = await repository.listBanners({ keyword: marker, page: 1, pageSize: 20 });
    expect(listed.total).toBe(3);
    expect(listed.items.map(({ id }) => id)).toEqual([
      ...[firstTieId, secondTieId].sort(),
      laterId,
    ]);
    expect(listed.items.every(({ status }) => status === 'DRAFT')).toBe(true);

    await expect(repository.listBanners({
      keyword: marker,
      page: 1,
      pageSize: 20,
      status: 'ARCHIVED',
    })).resolves.toMatchObject({
      items: [expect.objectContaining({ deletedAt: expect.any(Date), id: archivedId, status: 'ARCHIVED' })],
      total: 1,
    });
  });

  fullIt('enforces the full Banner status matrix and restores archived content to DRAFT', async () => {
    const { bannerId } = await createDraftFixture();

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'DEACTIVATE', expectedVersion: 1, id: bannerId,
      }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.restoreBannerInTransaction(transaction, { expectedVersion: 1, id: bannerId })))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, id: bannerId,
      }))).resolves.toMatchObject({ status: 'ACTIVE', version: 2 });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 2, id: bannerId,
      }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.archiveBannerInTransaction(transaction, { expectedVersion: 2, id: bannerId })))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'DEACTIVATE', expectedVersion: 2, id: bannerId,
      }))).resolves.toMatchObject({ status: 'INACTIVE', version: 3 });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'DEACTIVATE', expectedVersion: 3, id: bannerId,
      }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 3, id: bannerId,
      }))).resolves.toMatchObject({ status: 'ACTIVE', version: 4 });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'DEACTIVATE', expectedVersion: 4, id: bannerId,
      }))).resolves.toMatchObject({ status: 'INACTIVE', version: 5 });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.archiveBannerInTransaction(transaction, { expectedVersion: 5, id: bannerId })))
      .resolves.toMatchObject({ deletedAt: expect.any(Date), status: 'ARCHIVED', version: 6 });
    for (const action of ['ACTIVATE', 'DEACTIVATE'] as const) {
      await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.changeBannerStatusInTransaction(transaction, {
          action, expectedVersion: 6, id: bannerId,
        }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    }
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.restoreBannerInTransaction(transaction, { expectedVersion: 6, id: bannerId })))
      .resolves.toMatchObject({ deletedAt: null, status: 'DRAFT', version: 7 });

    await expect(repository.getBanner(bannerId)).resolves.toMatchObject({
      deletedAt: null,
      status: 'DRAFT',
      title: `B5 lifecycle ${bannerId}`,
      version: 7,
    });
  });

  fullIt('rejects unavailable files and targets and revalidates both facts at activation', async () => {
    const actorId = generateUlid();
    const otherActorId = generateUlid();
    const validFileId = generateUlid();
    const otherActorFileId = generateUlid();
    const wrongPurposeFileId = generateUlid();
    const brandId = generateUlid();
    const activeCategoryId = generateUlid();
    const inactiveCategoryId = generateUlid();
    const activeProductId = generateUlid();
    const inactiveProductId = generateUlid();

    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createActor(transaction, actorId);
      await createActor(transaction, otherActorId);
      await createFile(transaction, actorId, validFileId);
      await createFile(transaction, otherActorId, otherActorFileId);
      await createFile(transaction, actorId, wrongPurposeFileId, { purpose: 'PRODUCT_IMAGE' });
      await createCatalogTargets(transaction, {
        activeCategoryId,
        activeProductId,
        brandId,
        inactiveCategoryId,
        inactiveProductId,
      });
    });

    for (const fileId of [otherActorFileId, wrongPurposeFileId]) {
      await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.createBannerInTransaction(transaction, bannerInput({
          actorId,
          bannerId: generateUlid(),
          fileId,
          title: `Invalid file ${fileId}`,
        })))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    }

    for (const target of [
      { targetId: inactiveCategoryId, targetType: 'CATEGORY', targetUrl: null },
      { targetId: inactiveProductId, targetType: 'PRODUCT', targetUrl: null },
      { targetId: null, targetType: 'URL', targetUrl: 'https://other.example.test/promo' },
    ] as const) {
      await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
        repository.createBannerInTransaction(transaction, bannerInput({
          actorId,
          bannerId: generateUlid(),
          fileId: validFileId,
          target,
          title: `Invalid target ${target.targetType}`,
        })))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    }

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createBannerInTransaction(transaction, bannerInput({
        actorId,
        bannerId: generateUlid(),
        fileId: validFileId,
        target: { targetId: generateUlid(), targetType: 'PRODUCT', targetUrl: null },
        title: 'Missing product target',
      })))).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    const productBannerId = generateUlid();
    await runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createBannerInTransaction(transaction, bannerInput({
        actorId,
        bannerId: productBannerId,
        fileId: validFileId,
        target: { targetId: activeProductId, targetType: 'PRODUCT', targetUrl: null },
        title: 'Product target',
      })));
    await runtime.prisma.product.update({ data: { status: 'INACTIVE' }, where: { id: activeProductId } });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, id: productBannerId,
      }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    await runtime.prisma.product.update({ data: { status: 'ACTIVE' }, where: { id: activeProductId } });
    await runtime.prisma.fileAsset.update({ data: { visibility: 'PRIVATE' }, where: { id: validFileId } });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, id: productBannerId,
      }))).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await runtime.prisma.fileAsset.update({ data: { visibility: 'PUBLIC' }, where: { id: validFileId } });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.changeBannerStatusInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, id: productBannerId,
      }))).resolves.toMatchObject({ status: 'ACTIVE', version: 2 });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.createBannerInTransaction(transaction, bannerInput({
        actorId,
        bannerId: generateUlid(),
        fileId: validFileId,
        target: {
          targetId: null,
          targetType: 'URL',
          targetUrl: `${ALLOWED_ORIGIN}/campaign?source=home`,
        },
        title: 'Allowlisted URL target',
      })))).resolves.toMatchObject({ status: 'DRAFT', targetType: 'URL' });
  });

  fullIt('merges partial time updates atomically and rejects stale or invalid merged windows', async () => {
    const startsAt = new Date(NOW.getTime() - 1_000);
    const firstEndsAt = new Date(NOW.getTime() + 10_000);
    const secondEndsAt = new Date(NOW.getTime() + 20_000);
    const { actorId, bannerId } = await createDraftFixture({ endsAt: firstEndsAt, startsAt });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.updateBannerInTransaction(transaction, {
        actorId,
        expectedVersion: 1,
        id: bannerId,
        patch: { startsAt: NOW },
      }))).resolves.toMatchObject({ endsAt: firstEndsAt, startsAt: NOW, version: 2 });
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.updateBannerInTransaction(transaction, {
        actorId,
        expectedVersion: 2,
        id: bannerId,
        patch: { endsAt: secondEndsAt },
      }))).resolves.toMatchObject({ endsAt: secondEndsAt, startsAt: NOW, version: 3 });

    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.updateBannerInTransaction(transaction, {
        actorId,
        expectedVersion: 3,
        id: bannerId,
        patch: { endsAt: NOW },
      }))).rejects.toThrow('end time must be later');
    await expect(runSerializableTransaction(runtime.prisma, (transaction) =>
      repository.updateBannerInTransaction(transaction, {
        actorId,
        expectedVersion: 2,
        id: bannerId,
        patch: { title: 'Stale title' },
      }))).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    await expect(repository.getBanner(bannerId)).resolves.toMatchObject({
      endsAt: secondEndsAt,
      startsAt: NOW,
      version: 3,
    });

    const attempts = await Promise.allSettled(['First winner', 'Second winner'].map((title) =>
      runSerializableTransaction(runtime.prisma, (transaction) => repository.updateBannerInTransaction(
        transaction,
        { actorId, expectedVersion: 3, id: bannerId, patch: { title } },
      ))));
    expect(attempts.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect(attempts.find(({ status }) => status === 'rejected'))
      .toMatchObject({ reason: { code: 'RESOURCE_VERSION_CONFLICT' } });
    await expect(repository.getBanner(bannerId)).resolves.toMatchObject({ version: 4 });
  });

  fullIt('uses inclusive start and exclusive end boundaries and excludes invalid public dependencies', async () => {
    const actorId = generateUlid();
    const brandId = generateUlid();
    const activeCategoryId = generateUlid();
    const activeProductId = generateUlid();
    const fileIds = Array.from({ length: 7 }, () => generateUlid());
    const startsNowId = generateUlid(NOW.getTime() - 7);
    const endsNowId = generateUlid(NOW.getTime() - 6);
    const invalidFileId = generateUlid(NOW.getTime() - 5);
    const invalidProductId = generateUlid(NOW.getTime() - 4);
    const invalidCategoryId = generateUlid(NOW.getTime() - 3);
    const validUrlId = generateUlid(NOW.getTime() - 2);
    const disallowedUrlId = generateUlid(NOW.getTime() - 1);

    await runSerializableTransaction(runtime.prisma, async (transaction) => {
      await createActor(transaction, actorId);
      for (const fileId of fileIds) await createFile(transaction, actorId, fileId);
      await createCatalogTargets(transaction, { activeCategoryId, activeProductId, brandId });
      const inputs = [
        bannerInput({
          actorId,
          bannerId: startsNowId,
          fileId: fileIds[0]!,
          sortOrder: 0,
          startsAt: NOW,
          title: 'Starts exactly now',
        }),
        bannerInput({
          actorId,
          bannerId: endsNowId,
          endsAt: NOW,
          fileId: fileIds[1]!,
          sortOrder: 1,
          startsAt: new Date(NOW.getTime() - 1_000),
          title: 'Ends exactly now',
        }),
        bannerInput({
          actorId,
          bannerId: invalidFileId,
          fileId: fileIds[2]!,
          sortOrder: 2,
          title: 'Invalid file after activation',
        }),
        bannerInput({
          actorId,
          bannerId: invalidProductId,
          fileId: fileIds[3]!,
          sortOrder: 3,
          target: { targetId: activeProductId, targetType: 'PRODUCT', targetUrl: null },
          title: 'Invalid product after activation',
        }),
        bannerInput({
          actorId,
          bannerId: invalidCategoryId,
          fileId: fileIds[4]!,
          sortOrder: 4,
          target: { targetId: activeCategoryId, targetType: 'CATEGORY', targetUrl: null },
          title: 'Invalid category after activation',
        }),
        bannerInput({
          actorId,
          bannerId: validUrlId,
          fileId: fileIds[5]!,
          sortOrder: 5,
          target: { targetId: null, targetType: 'URL', targetUrl: `${ALLOWED_ORIGIN}/campaign` },
          title: 'Valid URL',
        }),
      ];
      for (const input of inputs) {
        await repository.createBannerInTransaction(transaction, input);
        await repository.changeBannerStatusInTransaction(transaction, {
          action: 'ACTIVATE', expectedVersion: 1, id: input.id,
        });
      }
      await transaction.banner.create({
        data: {
          created_at: NOW,
          ends_at: null,
          file_id: fileIds[6]!,
          id: disallowedUrlId,
          sort_order: 6,
          starts_at: null,
          status: 'ACTIVE',
          target_id: null,
          target_type: 'URL',
          target_url: 'https://other.example.test/campaign',
          title: 'Disallowed stored URL',
          updated_at: NOW,
          version: 1,
        },
      });
    });

    await Promise.all([
      runtime.prisma.fileAsset.update({ data: { visibility: 'PRIVATE' }, where: { id: fileIds[2]! } }),
      runtime.prisma.product.update({ data: { status: 'INACTIVE' }, where: { id: activeProductId } }),
      runtime.prisma.category.update({ data: { status: 'INACTIVE' }, where: { id: activeCategoryId } }),
    ]);

    const publicBanners = await repository.listPublicEffectiveBanners();
    const fixtureIds = new Set([
      startsNowId,
      endsNowId,
      invalidFileId,
      invalidProductId,
      invalidCategoryId,
      validUrlId,
      disallowedUrlId,
    ]);
    const fixtureProjection = publicBanners
      .map(({ id }) => id)
      .filter((id) => fixtureIds.has(id));
    expect(fixtureProjection).toEqual([startsNowId, validUrlId]);
    expect(fixtureProjection).not.toContain(endsNowId);
  });

  rollbackIt('leaves no Banner, file, catalog, or account facts after rollback-only smoke', async () => {
    const actorId = generateUlid();
    const bannerId = generateUlid();
    const fileId = generateUlid();
    const brandId = generateUlid();
    const categoryId = generateUlid();
    const productId = generateUlid();
    await expect(runtime.withPrismaTransaction(async (transaction) => {
      await createActor(transaction, actorId);
      await createFile(transaction, actorId, fileId);
      await createCatalogTargets(transaction, {
        activeCategoryId: categoryId,
        activeProductId: productId,
        brandId,
      });
      await repository.createBannerInTransaction(transaction, bannerInput({
        actorId,
        bannerId,
        fileId,
        target: { targetId: productId, targetType: 'PRODUCT', targetUrl: null },
        title: `B5 rollback ${bannerId}`,
      }));
      await repository.changeBannerStatusInTransaction(transaction, {
        action: 'ACTIVATE', expectedVersion: 1, id: bannerId,
      });
      await repository.changeBannerStatusInTransaction(transaction, {
        action: 'DEACTIVATE', expectedVersion: 2, id: bannerId,
      });
      await repository.archiveBannerInTransaction(transaction, { expectedVersion: 3, id: bannerId });
      await repository.restoreBannerInTransaction(transaction, { expectedVersion: 4, id: bannerId });
      throw rollbackSentinel;
    }, rollbackOptions)).rejects.toBe(rollbackSentinel);

    await expect(Promise.all([
      runtime.prisma.banner.count({ where: { id: bannerId } }),
      runtime.prisma.fileAsset.count({ where: { id: fileId } }),
      runtime.prisma.product.count({ where: { id: productId } }),
      runtime.prisma.category.count({ where: { id: categoryId } }),
      runtime.prisma.brand.count({ where: { id: brandId } }),
      runtime.prisma.account.count({ where: { id: actorId } }),
    ])).resolves.toEqual([0, 0, 0, 0, 0, 0]);
  }, 90_000);
});
