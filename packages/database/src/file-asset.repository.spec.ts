import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  buildFinalObjectKey,
  buildStagingObjectKey,
  FILE_ASSET_PENDING_TTL_MS,
  FileAssetRepository,
  visibilityForPurpose,
} from './file-asset.repository';

const NOW = new Date('2026-08-14T12:00:00.000Z');
const CLEANUP_THRESHOLD = new Date(NOW.getTime() - FILE_ASSET_PENDING_TTL_MS);
const actorId = generateUlid(NOW.getTime() - 2_000);
const fileId = generateUlid(NOW.getTime() - 1_000);
const sha256 = 'a'.repeat(64);

function asset(overrides: Record<string, unknown> = {}) {
  return {
    byte_size: 1_024n,
    created_at: CLEANUP_THRESHOLD,
    created_by_id: actorId,
    deleted_at: null,
    id: fileId,
    mime_type: 'image/png',
    object_key: buildStagingObjectKey(fileId),
    original_name: 'logo.png',
    purpose: 'BRAND_LOGO',
    sha256,
    status: 'PENDING',
    visibility: 'PRIVATE',
    ...overrides,
  };
}

function harness() {
  const fileAsset = {
    count: vi.fn(async () => 0),
    create: vi.fn(async () => asset()),
    findFirst: vi.fn(async () => asset()),
    findMany: vi.fn(async () => [asset()]),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => asset(data)),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const attachment = () => ({ count: vi.fn(async () => 0) });
  const transaction = {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    aftersaleEvidence: attachment(),
    banner: attachment(),
    brand: attachment(),
    category: attachment(),
    fileAsset,
    productImage: attachment(),
    promotionAsset: attachment(),
    withdrawalProof: attachment(),
  };
  const prisma = {
    fileAsset: {
      findFirst: vi.fn(async () => asset()),
      findMany: fileAsset.findMany,
    },
  };
  return {
    fileAsset,
    prisma,
    repository: new FileAssetRepository(prisma as unknown as PrismaClient, () => NOW),
    transaction: transaction as unknown as DatabaseTransaction,
    transactionStub: transaction,
  };
}

describe('FileAssetRepository', () => {
  it('builds opaque partitioned keys without the original file name', () => {
    expect(buildStagingObjectKey(fileId)).toBe(`staging/${fileId}`);
    expect(buildFinalObjectKey(fileId, 'PRODUCT_IMAGE')).toBe(`public/${fileId}`);
    expect(buildFinalObjectKey(fileId, 'AFTERSALE_EVIDENCE')).toBe(`private/${fileId}`);
    expect(visibilityForPurpose('BANNER')).toBe('PUBLIC');
    expect(visibilityForPurpose('WITHDRAWAL_PROOF')).toBe('PRIVATE');
  });

  it('creates a private PENDING intent with immutable expected content facts', async () => {
    const { fileAsset, repository, transaction } = harness();
    await repository.createPendingInTransaction(transaction, {
      actorId,
      byteSize: 1_024n,
      id: fileId,
      mimeType: 'image/png',
      originalName: 'customer-logo.png',
      purpose: 'BRAND_LOGO',
      sha256,
    });

    expect(fileAsset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        byte_size: 1_024n,
        created_by_id: actorId,
        id: fileId,
        mime_type: 'image/png',
        object_key: `staging/${fileId}`,
        original_name: 'customer-logo.png',
        purpose: 'BRAND_LOGO',
        sha256,
        status: 'PENDING',
        visibility: 'PRIVATE',
      }),
    });
    expect(fileAsset.create.mock.calls[0]?.[0].data.object_key).not.toContain('customer-logo.png');
  });

  it('scopes reads to the owner and hides non-owned files as not found', async () => {
    const { prisma, repository } = harness();
    await repository.getOwned({ actorId, fileId });
    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith({
      where: { created_by_id: actorId, deleted_at: null, id: fileId },
    });

    prisma.fileAsset.findFirst.mockResolvedValueOnce(null);
    await expect(repository.getOwned({ actorId, fileId })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('allows the Admin lookup for an owned file or exact bound READY private aftersale evidence', async () => {
    const { prisma, repository } = harness();
    prisma.fileAsset.findFirst.mockResolvedValueOnce(asset({
      object_key: `private/${fileId}`,
      purpose: 'AFTERSALE_EVIDENCE',
      status: 'READY',
      visibility: 'PRIVATE',
    }));
    await expect(repository.getAdminDownloadable({ actorId, fileId }))
      .resolves.toMatchObject({ id: fileId, purpose: 'AFTERSALE_EVIDENCE' });
    expect(prisma.fileAsset.findFirst).toHaveBeenCalledWith({
      where: {
        deleted_at: null,
        id: fileId,
        OR: [
          { created_by_id: actorId },
          {
            aftersale_evidence: { some: {} },
            object_key: `private/${fileId}`,
            purpose: 'AFTERSALE_EVIDENCE',
            status: 'READY',
            visibility: 'PRIVATE',
          },
        ],
      },
    });
  });

  it('hides unbound or otherwise ineligible evidence from the Admin lookup', async () => {
    const { prisma, repository } = harness();
    prisma.fileAsset.findFirst.mockResolvedValueOnce(null);
    await expect(repository.getAdminDownloadable({ actorId, fileId }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('locks a pending asset and rejects a second completion using a new key', async () => {
    const { fileAsset, repository, transaction, transactionStub } = harness();
    await repository.getOwnedPendingInTransaction(transaction, { actorId, fileId });
    expect(transactionStub.$queryRawUnsafe).toHaveBeenCalledOnce();

    fileAsset.findFirst.mockResolvedValueOnce(asset({ status: 'READY', object_key: `public/${fileId}` }));
    await expect(repository.getOwnedPendingInTransaction(transaction, { actorId, fileId }))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it.each([
    { measuredSha256: 'b'.repeat(64) },
    { measuredByteSize: 1_023n },
    { measuredMimeType: 'image/jpeg' as const },
    { expectedSha256: 'b'.repeat(64) },
    { expectedByteSize: 1_023n },
  ])('rejects mismatched declared or measured content without updating', async (override) => {
    const { fileAsset, repository, transaction } = harness();
    await expect(repository.markReadyInTransaction(transaction, {
      actorId,
      expectedByteSize: 1_024n,
      expectedSha256: sha256,
      fileId,
      measuredByteSize: 1_024n,
      measuredMimeType: 'image/png',
      measuredSha256: sha256,
      ...override,
    })).rejects.toMatchObject({ code: 'FILE_CONTENT_MISMATCH' });
    expect(fileAsset.update).not.toHaveBeenCalled();
  });

  it('moves a verified public asset to READY and returns a non-persisted completion time', async () => {
    const { fileAsset, repository, transaction } = harness();
    const result = await repository.markReadyInTransaction(transaction, {
      actorId,
      expectedByteSize: 1_024n,
      expectedSha256: sha256,
      fileId,
      measuredByteSize: 1_024n,
      measuredMimeType: 'image/png',
      measuredSha256: sha256,
    });

    expect(fileAsset.update).toHaveBeenCalledWith({
      data: {
        byte_size: 1_024n,
        mime_type: 'image/png',
        object_key: `public/${fileId}`,
        sha256,
        status: 'READY',
        visibility: 'PUBLIC',
      },
      where: { id: fileId },
    });
    expect(result.asset).toMatchObject({ objectKey: `public/${fileId}`, status: 'READY', visibility: 'PUBLIC' });
    expect(result.completedAt).toEqual(NOW);
  });

  it('lists only exact staging candidates at the 24-hour boundary', async () => {
    const { fileAsset, repository } = harness();
    const candidates = await repository.listCleanupCandidates({ limit: 25, olderThan: CLEANUP_THRESHOLD });
    expect(candidates).toEqual([{
      createdAt: CLEANUP_THRESHOLD,
      finalObjectKey: `public/${fileId}`,
      id: fileId,
      objectKey: `staging/${fileId}`,
      purpose: 'BRAND_LOGO',
    }]);
    expect(fileAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      take: 25,
      where: expect.objectContaining({ status: 'PENDING' }),
    }));

    fileAsset.findMany.mockResolvedValueOnce([asset({ object_key: `staging/${fileId}/unexpected` })]);
    await expect(repository.listCleanupCandidates({ limit: 1, olderThan: CLEANUP_THRESHOLD }))
      .resolves.toEqual([]);
    await expect(repository.listCleanupCandidates({
      limit: 1,
      olderThan: new Date(CLEANUP_THRESHOLD.getTime() + 1),
    })).rejects.toThrow('at least 24 hours old');
  });

  it('rechecks attachment and final READY references before allowing object cleanup', async () => {
    const { fileAsset, repository, transaction, transactionStub } = harness();
    const input = { expectedObjectKey: `staging/${fileId}`, fileId, olderThan: CLEANUP_THRESHOLD };
    await expect(repository.recheckCleanupCandidateInTransaction(transaction, input)).resolves.toMatchObject({
      finalObjectKey: `public/${fileId}`,
      objectKey: `staging/${fileId}`,
    });

    transactionStub.brand.count.mockResolvedValueOnce(1);
    await expect(repository.recheckCleanupCandidateInTransaction(transaction, input)).resolves.toBeNull();

    fileAsset.count.mockResolvedValueOnce(1);
    await expect(repository.recheckCleanupCandidateInTransaction(transaction, input)).resolves.toBeNull();
  });

  it('marks an exact, unreferenced stale candidate REJECTED after object cleanup', async () => {
    const { fileAsset, repository, transaction } = harness();
    await expect(repository.markRejectedAfterCleanupInTransaction(transaction, {
      expectedObjectKey: `staging/${fileId}`,
      fileId,
      olderThan: CLEANUP_THRESHOLD,
    })).resolves.toBe(true);
    expect(fileAsset.updateMany).toHaveBeenCalledWith({
      data: { status: 'REJECTED' },
      where: {
        created_at: { lte: CLEANUP_THRESHOLD },
        deleted_at: null,
        id: fileId,
        object_key: `staging/${fileId}`,
        status: 'PENDING',
      },
    });
  });

  it('allows delayed staging cleanup only for a READY asset at its derived final key', async () => {
    const { fileAsset, repository, transaction } = harness();
    fileAsset.findFirst.mockResolvedValueOnce(asset({
      object_key: `public/${fileId}`,
      status: 'READY',
      visibility: 'PUBLIC',
    }));

    await expect(repository.recheckReadyForStagingCleanupInTransaction(transaction, { fileId }))
      .resolves.toEqual({ fileId, stagingObjectKey: `staging/${fileId}` });
    expect(fileAsset.findFirst).toHaveBeenCalledWith({
      select: { id: true, object_key: true, purpose: true, status: true },
      where: { id: fileId },
    });

    fileAsset.findFirst.mockResolvedValueOnce(asset());
    await expect(repository.recheckReadyForStagingCleanupInTransaction(transaction, { fileId }))
      .resolves.toBeNull();

    fileAsset.findFirst.mockResolvedValueOnce(asset({ object_key: `private/${fileId}`, status: 'READY' }));
    await expect(repository.recheckReadyForStagingCleanupInTransaction(transaction, { fileId }))
      .resolves.toBeNull();
  });
});
