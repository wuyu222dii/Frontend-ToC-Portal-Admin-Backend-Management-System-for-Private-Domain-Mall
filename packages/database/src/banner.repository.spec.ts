import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import {
  BannerRepository,
  type BannerSnapshot,
  type CreateBannerInput,
} from './banner.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-08-25T04:00:00.000Z');
const actorId = generateUlid(NOW.getTime() - 10_000);
const bannerId = generateUlid(NOW.getTime() - 9_000);
const fileId = generateUlid(NOW.getTime() - 8_000);
const productId = generateUlid(NOW.getTime() - 7_000);
const categoryId = generateUlid(NOW.getTime() - 6_000);

interface TestFileRecord {
  deleted_at: Date | null;
  id: string;
  object_key: string;
  purpose: string;
  status: string;
  visibility: string;
}

interface TestBannerRecord {
  created_at: Date;
  deleted_at: Date | null;
  ends_at: Date | null;
  file: TestFileRecord;
  file_id: string;
  id: string;
  sort_order: number;
  starts_at: Date | null;
  status: BannerSnapshot['status'];
  target_id: string | null;
  target_type: BannerSnapshot['targetType'];
  target_url: string | null;
  title: string;
  updated_at: Date;
  version: number;
}

function fileRecord(overrides: Partial<TestFileRecord> = {}): TestFileRecord {
  return {
    deleted_at: null,
    id: fileId,
    object_key: `public/${fileId}`,
    purpose: 'BANNER',
    status: 'READY',
    visibility: 'PUBLIC',
    ...overrides,
  };
}

function bannerRecord(overrides: Partial<TestBannerRecord> = {}): TestBannerRecord {
  const nextFileId = overrides.file_id ?? fileId;
  return {
    created_at: NOW,
    deleted_at: null,
    ends_at: null,
    file: overrides.file ?? fileRecord({ id: nextFileId, object_key: `public/${nextFileId}` }),
    file_id: nextFileId,
    id: bannerId,
    sort_order: 0,
    starts_at: null,
    status: 'DRAFT',
    target_id: null,
    target_type: 'NONE',
    target_url: null,
    title: 'Home banner',
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

const createInput: CreateBannerInput = {
  actorId,
  endsAt: null,
  fileId,
  id: bannerId,
  sortOrder: 0,
  startsAt: null,
  target: { targetId: null, targetType: 'NONE', targetUrl: null },
  title: 'Home banner',
};

function harness(allowedOrigins: readonly string[] = ['https://shop.example.test']) {
  let current = bannerRecord();
  let listed: TestBannerRecord[] = [current];
  let attachableFile = true;
  let publishableFile = true;
  let forcedUpdateCount: number | undefined;
  let product: { deleted_at: Date | null; id: string; status: BannerSnapshot['status'] } | null = {
    deleted_at: null,
    id: productId,
    status: 'ACTIVE',
  };
  let category: { deleted_at: Date | null; id: string; status: BannerSnapshot['status'] } | null = {
    deleted_at: null,
    id: categoryId,
    status: 'ACTIVE',
  };
  let activeProductIds = [productId];
  let activeCategoryIds = [categoryId];

  const banner = {
    count: vi.fn(async () => listed.length),
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      current = bannerRecord({
        created_at: data.created_at as Date,
        deleted_at: data.deleted_at as Date | null,
        ends_at: data.ends_at as Date | null,
        file_id: data.file_id as string,
        id: data.id as string,
        sort_order: data.sort_order as number,
        starts_at: data.starts_at as Date | null,
        status: data.status as BannerSnapshot['status'],
        target_id: data.target_id as string | null,
        target_type: data.target_type as BannerSnapshot['targetType'],
        target_url: data.target_url as string | null,
        title: data.title as string,
        updated_at: data.updated_at as Date,
        version: data.version as number,
      });
      return current;
    }),
    findMany: vi.fn(async () => listed),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => where.id === current.id ? current : null),
    updateMany: vi.fn(async ({ data, where }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      if (forcedUpdateCount !== undefined) return { count: forcedUpdateCount };
      if (where.id !== current.id ||
        (typeof where.version === 'number' && where.version !== current.version) ||
        (typeof where.status === 'string' && where.status !== current.status) ||
        (where.deleted_at === null && current.deleted_at !== null) ||
        (typeof where.deleted_at === 'object' && where.deleted_at !== null && current.deleted_at === null)) {
        return { count: 0 };
      }
      const version = typeof data.version === 'object' && data.version !== null &&
        'increment' in data.version ? current.version + Number(data.version.increment) : current.version;
      const nextFileId = typeof data.file_id === 'string' ? data.file_id : current.file_id;
      current = {
        ...current,
        ...data,
        file: nextFileId === current.file_id
          ? current.file
          : fileRecord({ id: nextFileId, object_key: `public/${nextFileId}` }),
        file_id: nextFileId,
        version,
      } as TestBannerRecord;
      return { count: 1 };
    }),
  };
  const fileAsset = {
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      ('created_by_id' in where ? attachableFile : publishableFile) ? { id: where.id } : null),
  };
  const productDelegate = {
    findMany: vi.fn(async () => activeProductIds.map((id) => ({ id }))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      product?.id === where.id ? product : null),
  };
  const categoryDelegate = {
    findMany: vi.fn(async () => activeCategoryIds.map((id) => ({ id }))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      category?.id === where.id ? category : null),
  };
  const transactionStub = {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    banner,
    category: categoryDelegate,
    fileAsset,
    product: productDelegate,
  };
  const prisma = {
    ...transactionStub,
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => unknown) =>
      work(transactionStub as unknown as DatabaseTransaction)),
  };
  return {
    banner,
    category: categoryDelegate,
    fileAsset,
    prisma,
    product: productDelegate,
    repository: new BannerRepository(prisma as unknown as PrismaClient, allowedOrigins, () => NOW),
    setActiveCategoryIds: (ids: string[]) => { activeCategoryIds = ids; },
    setActiveProductIds: (ids: string[]) => { activeProductIds = ids; },
    setAttachableFile: (value: boolean) => { attachableFile = value; },
    setBanner: (value: TestBannerRecord) => { current = value; },
    setCategory: (value: typeof category) => { category = value; },
    setForcedUpdateCount: (value: number | undefined) => { forcedUpdateCount = value; },
    setListed: (values: TestBannerRecord[]) => { listed = values; },
    setProduct: (value: typeof product) => { product = value; },
    setPublishableFile: (value: boolean) => { publishableFile = value; },
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

describe('BannerRepository', () => {
  it('requires an HTTPS origin-only allowlist and a valid clock', () => {
    const prisma = {} as PrismaClient;
    expect(() => new BannerRepository(prisma, ['http://shop.example.test']))
      .toThrow('must be HTTPS origins');
    expect(() => new BannerRepository(prisma, ['https://user:secret@shop.example.test']))
      .toThrow('must be HTTPS origins');
    expect(() => new BannerRepository(prisma, [], () => new Date(Number.NaN)))
      .toThrow('clock must return a valid Date');
  });

  it('defaults to non-archived rows and uses stable sort_order/id ordering', async () => {
    const { banner, repository } = harness();
    await repository.listBanners({ page: 2, pageSize: 20 });
    expect(banner.findMany).toHaveBeenCalledWith({
      include: expect.any(Object),
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      skip: 20,
      take: 20,
      where: { deleted_at: null, status: { not: 'ARCHIVED' } },
    });
  });

  it('returns archived rows only for an explicit ARCHIVED filter', async () => {
    const { banner, repository } = harness();
    await repository.listBanners({ keyword: 'home', page: 1, pageSize: 10, status: 'ARCHIVED' });
    expect(banner.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      where: {
        deleted_at: { not: null },
        status: 'ARCHIVED',
        title: { contains: 'home', mode: 'insensitive' },
      },
    }));
  });

  it('uses one repeatable-read snapshot and excludes invalid public file, target, allowlist and time facts', async () => {
    const validNone = bannerRecord({ id: generateUlid(NOW.getTime() - 1_000), sort_order: 0, status: 'ACTIVE' });
    const invalidFile = bannerRecord({
      file: fileRecord({ status: 'PENDING' }),
      id: generateUlid(NOW.getTime() - 900),
      sort_order: 1,
      status: 'ACTIVE',
    });
    const inactiveProduct = bannerRecord({
      id: generateUlid(NOW.getTime() - 800),
      sort_order: 2,
      status: 'ACTIVE',
      target_id: productId,
      target_type: 'PRODUCT',
    });
    const validCategory = bannerRecord({
      id: generateUlid(NOW.getTime() - 700),
      sort_order: 3,
      status: 'ACTIVE',
      target_id: categoryId,
      target_type: 'CATEGORY',
    });
    const disallowedUrl = bannerRecord({
      id: generateUlid(NOW.getTime() - 600),
      sort_order: 4,
      status: 'ACTIVE',
      target_type: 'URL',
      target_url: 'https://other.example.test/promo',
    });
    const future = bannerRecord({
      id: generateUlid(NOW.getTime() - 500),
      sort_order: 5,
      starts_at: new Date(NOW.getTime() + 1),
      status: 'ACTIVE',
    });
    const startsNow = bannerRecord({
      id: generateUlid(NOW.getTime() - 450),
      sort_order: 6,
      starts_at: NOW,
      status: 'ACTIVE',
    });
    const endsNow = bannerRecord({
      ends_at: NOW,
      id: generateUlid(NOW.getTime() - 425),
      sort_order: 7,
      status: 'ACTIVE',
    });
    const validUrl = bannerRecord({
      id: generateUlid(NOW.getTime() - 400),
      sort_order: 8,
      status: 'ACTIVE',
      target_type: 'URL',
      target_url: 'https://shop.example.test/promo?source=home',
    });
    const state = harness();
    state.setListed([
      validNone,
      invalidFile,
      inactiveProduct,
      validCategory,
      disallowedUrl,
      future,
      startsNow,
      endsNow,
      validUrl,
    ]);
    state.setActiveProductIds([]);

    const result = await state.repository.listPublicEffectiveBanners();

    expect(result.map(({ id }) => id)).toEqual([validNone.id, validCategory.id, startsNow.id, validUrl.id]);
    expect(state.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(state.banner.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      where: {
        AND: [
          { OR: [{ starts_at: null }, { starts_at: { lte: NOW } }] },
          { OR: [{ ends_at: null }, { ends_at: { gt: NOW } }] },
        ],
        deleted_at: null,
        status: 'ACTIVE',
      },
    }));
  });

  it('creates a DRAFT with an actor-owned READY/PUBLIC/BANNER file', async () => {
    const state = harness();
    const created = await state.repository.createBannerInTransaction(state.transaction, createInput);
    expect(state.fileAsset.findFirst).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        created_by_id: actorId,
        deleted_at: null,
        id: fileId,
        object_key: `public/${fileId}`,
        purpose: 'BANNER',
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    expect(state.banner.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ deleted_at: null, status: 'DRAFT', version: 1 }),
    });
    expect(created).toMatchObject({ id: bannerId, status: 'DRAFT', version: 1 });
  });

  it.each([
    { endsAt: new Date(NOW.getTime() + 1_000), startsAt: null },
    { endsAt: null, startsAt: new Date(NOW.getTime() - 1_000) },
    { endsAt: new Date(NOW.getTime() + 1_000), startsAt: new Date(NOW.getTime() - 1_000) },
  ])('accepts the valid Banner time window %j', async ({ endsAt, startsAt }) => {
    const state = harness();
    await expect(state.repository.createBannerInTransaction(state.transaction, {
      ...createInput,
      endsAt,
      startsAt,
    })).resolves.toMatchObject({ endsAt, startsAt });
  });

  it('fails closed when the selected file is not attachable by the actor', async () => {
    const state = harness();
    state.setAttachableFile(false);
    await expect(state.repository.createBannerInTransaction(state.transaction, createInput))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(state.banner.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      configure: (state: ReturnType<typeof harness>) => state.setProduct({
        deleted_at: null, id: productId, status: 'INACTIVE',
      }),
      expectedCode: 'STATE_CONFLICT',
      target: { targetId: productId, targetType: 'PRODUCT', targetUrl: null } as const,
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setCategory(null),
      expectedCode: 'RESOURCE_NOT_FOUND',
      target: { targetId: categoryId, targetType: 'CATEGORY', targetUrl: null } as const,
    },
    {
      configure: () => undefined,
      expectedCode: 'STATE_CONFLICT',
      target: { targetId: null, targetType: 'URL', targetUrl: 'https://other.example.test/promo' } as const,
    },
  ])('rejects an unavailable or unapproved $target.targetType target', async ({
    configure,
    expectedCode,
    target,
  }) => {
    const state = harness();
    configure(state);
    await expect(state.repository.createBannerInTransaction(state.transaction, { ...createInput, target }))
      .rejects.toMatchObject({ code: expectedCode });
    expect(state.banner.create).not.toHaveBeenCalled();
  });

  it('accepts an allowlisted HTTPS URL target including its public query string', async () => {
    const state = harness();
    await expect(state.repository.createBannerInTransaction(state.transaction, {
      ...createInput,
      target: {
        targetId: null,
        targetType: 'URL',
        targetUrl: 'https://shop.example.test/promo?source=home',
      },
    })).resolves.toMatchObject({ targetType: 'URL' });
  });

  it.each([
    { target: { targetId: productId, targetType: 'PRODUCT', targetUrl: null } as const },
    { target: { targetId: categoryId, targetType: 'CATEGORY', targetUrl: null } as const },
  ])('creates a draft with an ACTIVE $target.targetType target', async ({ target }) => {
    const state = harness();
    await expect(state.repository.createBannerInTransaction(state.transaction, { ...createInput, target }))
      .resolves.toMatchObject({ status: 'DRAFT', targetId: target.targetId, targetType: target.targetType });
  });

  it.each([
    {
      input: { ...createInput, endsAt: NOW, startsAt: NOW },
      message: 'end time must be later',
    },
    {
      input: {
        ...createInput,
        endsAt: new Date(NOW.getTime() - 1),
        startsAt: NOW,
      },
      message: 'end time must be later',
    },
    {
      input: { ...createInput, initialStatus: 'ACTIVE' } as never,
      message: 'unsupported or missing fields',
    },
    {
      input: {
        ...createInput,
        target: { targetId: productId, targetType: 'NONE', targetUrl: null },
      } as never,
      message: 'NONE Banner target is invalid',
    },
    {
      input: {
        ...createInput,
        target: { targetId: null, targetType: 'URL', targetUrl: 'https://user:secret@shop.example.test' },
      } as never,
      message: 'URL Banner target is invalid',
    },
  ])('rejects malformed create input before writes', async ({ input, message }) => {
    const state = harness();
    await expect(state.repository.createBannerInTransaction(state.transaction, input)).rejects.toThrow(message);
    expect(state.transactionStub.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(state.banner.create).not.toHaveBeenCalled();
  });

  it('updates mutable fields with a version CAS and validates a new file and target', async () => {
    const newFileId = generateUlid(NOW.getTime() - 2_000);
    const state = harness();
    const updated = await state.repository.updateBannerInTransaction(state.transaction, {
      actorId,
      expectedVersion: 1,
      id: bannerId,
      patch: {
        fileId: newFileId,
        target: { targetId: categoryId, targetType: 'CATEGORY', targetUrl: null },
        title: 'Updated banner',
      },
    });
    expect(state.banner.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        file_id: newFileId,
        target_id: categoryId,
        target_type: 'CATEGORY',
        title: 'Updated banner',
        version: { increment: 1 },
      }),
      where: { deleted_at: null, id: bannerId, version: 1 },
    }));
    expect(updated).toMatchObject({ fileId: newFileId, status: 'DRAFT', targetType: 'CATEGORY', version: 2 });
  });

  it('locks Banner, old/new target and old/new file in the frozen namespace order', async () => {
    const newFileId = generateUlid(NOW.getTime() - 2_000);
    const state = harness();
    state.setBanner(bannerRecord({ target_id: productId, target_type: 'PRODUCT' }));
    await state.repository.updateBannerInTransaction(state.transaction, {
      actorId,
      expectedVersion: 1,
      id: bannerId,
      patch: {
        fileId: newFileId,
        target: { targetId: categoryId, targetType: 'CATEGORY', targetUrl: null },
      },
    });
    expect(state.transactionStub.$queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([
      'banner',
      'master-data-category',
      'master-data-product',
      'file-asset',
      'file-asset',
    ]);
    expect(state.transactionStub.$queryRawUnsafe.mock.calls.slice(3).map((call) => call[2])).toEqual(
      [fileId, newFileId].sort().map((id) => JSON.stringify([id])),
    );
  });

  it('rejects a stale update and an invalid merged time window', async () => {
    const stale = harness();
    stale.setBanner(bannerRecord({ version: 2 }));
    await expect(stale.repository.updateBannerInTransaction(stale.transaction, {
      actorId, expectedVersion: 1, id: bannerId, patch: { title: 'Stale' },
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(stale.banner.updateMany).not.toHaveBeenCalled();

    const invalidWindow = harness();
    invalidWindow.setBanner(bannerRecord({ starts_at: NOW }));
    await expect(invalidWindow.repository.updateBannerInTransaction(invalidWindow.transaction, {
      actorId,
      expectedVersion: 1,
      id: bannerId,
      patch: { endsAt: new Date(NOW.getTime() - 1) },
    })).rejects.toThrow('end time must be later');
  });

  it.each([
    ['DRAFT', 'ACTIVATE', 'ACTIVE'],
    ['INACTIVE', 'ACTIVATE', 'ACTIVE'],
    ['ACTIVE', 'DEACTIVATE', 'INACTIVE'],
  ] as const)('applies the Banner %s -> %s -> %s status transition', async (
    status,
    action,
    expectedStatus,
  ) => {
    const state = harness();
    state.setBanner(bannerRecord({ status }));
    await expect(state.repository.changeBannerStatusInTransaction(state.transaction, {
      action,
      expectedVersion: 1,
      id: bannerId,
    })).resolves.toMatchObject({ status: expectedStatus, version: 2 });
  });

  it.each([
    ['DRAFT', 'DEACTIVATE', null],
    ['ACTIVE', 'ACTIVATE', null],
    ['ARCHIVED', 'ACTIVATE', NOW],
    ['ARCHIVED', 'DEACTIVATE', NOW],
    ['INACTIVE', 'DEACTIVATE', null],
  ] as const)('rejects the illegal Banner %s -> %s transition', async (status, action, deletedAt) => {
    const state = harness();
    state.setBanner(bannerRecord({ deleted_at: deletedAt, status }));
    await expect(state.repository.changeBannerStatusInTransaction(state.transaction, {
      action,
      expectedVersion: 1,
      id: bannerId,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('revalidates file and target before activation and every ACTIVE metadata update', async () => {
    const activation = harness();
    activation.setBanner(bannerRecord({ status: 'DRAFT' }));
    activation.setPublishableFile(false);
    await expect(activation.repository.changeBannerStatusInTransaction(activation.transaction, {
      action: 'ACTIVATE', expectedVersion: 1, id: bannerId,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const activeUpdate = harness();
    activeUpdate.setBanner(bannerRecord({ status: 'ACTIVE', target_id: productId, target_type: 'PRODUCT' }));
    activeUpdate.setProduct({ deleted_at: null, id: productId, status: 'INACTIVE' });
    await expect(activeUpdate.repository.updateBannerInTransaction(activeUpdate.transaction, {
      actorId, expectedVersion: 1, id: bannerId, patch: { title: 'Still active' },
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(activeUpdate.banner.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ['DRAFT', null],
    ['INACTIVE', null],
  ] as const)('archives a %s Banner without cascading', async (status, deletedAt) => {
    const state = harness();
    state.setBanner(bannerRecord({ deleted_at: deletedAt, status }));
    await expect(state.repository.archiveBannerInTransaction(state.transaction, {
      expectedVersion: 1,
      id: bannerId,
    })).resolves.toMatchObject({ deletedAt: NOW, status: 'ARCHIVED', version: 2 });
  });

  it.each([
    ['ACTIVE', null],
    ['ARCHIVED', NOW],
  ] as const)('does not archive a %s Banner', async (status, deletedAt) => {
    const state = harness();
    state.setBanner(bannerRecord({ deleted_at: deletedAt, status }));
    await expect(state.repository.archiveBannerInTransaction(state.transaction, {
      expectedVersion: 1,
      id: bannerId,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('restores an archived Banner to DRAFT and preserves its content', async () => {
    const state = harness();
    state.setBanner(bannerRecord({ deleted_at: NOW, status: 'ARCHIVED', title: 'Archived banner', version: 3 }));
    await expect(state.repository.restoreBannerInTransaction(state.transaction, {
      expectedVersion: 3,
      id: bannerId,
    })).resolves.toMatchObject({ deletedAt: null, status: 'DRAFT', title: 'Archived banner', version: 4 });

  });

  it.each([
    ['DRAFT', null],
    ['INACTIVE', null],
    ['ACTIVE', null],
    ['ARCHIVED', null],
  ] as const)('does not restore a non-archived lifecycle fact: %s/%s', async (status, deletedAt) => {
    const state = harness();
    state.setBanner(bannerRecord({ deleted_at: deletedAt, status }));
    await expect(state.repository.restoreBannerInTransaction(state.transaction, {
      expectedVersion: 1,
      id: bannerId,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('maps a lost update race to RESOURCE_VERSION_CONFLICT', async () => {
    const state = harness();
    state.setForcedUpdateCount(0);
    await expect(state.repository.changeBannerStatusInTransaction(state.transaction, {
      action: 'ACTIVATE',
      expectedVersion: 1,
      id: bannerId,
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
  });

  it('allows archived details to be read for restore workflows', async () => {
    const state = harness();
    state.setBanner(bannerRecord({ deleted_at: NOW, status: 'ARCHIVED' }));
    await expect(state.repository.getBanner(bannerId)).resolves.toMatchObject({
      deletedAt: NOW,
      status: 'ARCHIVED',
    });
  });
});
