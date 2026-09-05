import { Logger } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime, ReadyFileOrphanCleanupCandidate } from '@qingxu/database';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FileCleanupService,
  type FileCleanupAuditRepository,
  type FileCleanupOutboxRepository,
  type FileCleanupRepository,
  type WorkerRedisClient,
} from './file-cleanup.service';

const FILE_ID = '01K00000000000000000000000';
const TRANSACTION = { marker: 'transaction' };
const candidate: ReadyFileOrphanCleanupCandidate = {
  id: FILE_ID,
  objectKey: `private/${FILE_ID}`,
  purpose: 'WITHDRAWAL_PROOF',
  readyAt: new Date('2026-08-01T00:00:00.000Z'),
  stagingObjectKey: `staging/${FILE_ID}`,
  status: 'READY',
};
const config = {
  storage: { pendingCleanupAgeSeconds: 86_400, uploadTtlSeconds: 900 },
  worker: { baseRetryDelayMs: 100, batchSize: 20, pollIntervalMs: 1_000 },
} as PlatformRuntimeConfig;

function createMocks(failDelete = false) {
  const withPrismaTransaction = vi.fn(async (work: (transaction: object) => Promise<unknown>) => work(TRANSACTION));
  const database = { withPrismaTransaction } as unknown as DatabaseRuntime;
  const files = {
    listCleanupCandidates: vi.fn(async () => []),
    listReadyOrphanCleanupCandidates: vi.fn(async () => [candidate]),
    markReadyOrphanDeletedInTransaction: vi.fn(async () => true),
    prepareReadyOrphanCleanupInTransaction: vi.fn(async () => 'TRANSITIONED' as const),
  } as unknown as FileCleanupRepository;
  const audit = { append: vi.fn(async () => ({})) } as unknown as FileCleanupAuditRepository;
  const storage = {
    deleteIfExists: failDelete
      ? vi.fn(async () => { throw new Error('storage unavailable'); })
      : vi.fn(async () => undefined),
  };
  const redis = {
    eval: vi.fn(async () => 1),
    on: vi.fn(),
    set: vi.fn(async () => 'OK'),
  } as unknown as WorkerRedisClient;
  const outbox = {
    findDue: vi.fn(async () => []),
    publishOne: vi.fn(),
  } as unknown as FileCleanupOutboxRepository;
  return { audit, database, files, outbox, redis, storage, withPrismaTransaction };
}

function service(mocks: ReturnType<typeof createMocks>): FileCleanupService {
  return new FileCleanupService(
    mocks.database,
    config,
    mocks.files,
    mocks.audit,
    mocks.storage,
    mocks.redis,
    mocks.outbox,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('B15 READY file orphan cleanup', () => {
  it('moves an aged unreferenced file through REJECTED, exact object deletion and DELETED', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-06T00:00:00.000Z'));
    const mocks = createMocks();

    await service(mocks).cleanupOnce();

    expect(mocks.files.prepareReadyOrphanCleanupInTransaction).toHaveBeenCalledOnce();
    expect(mocks.storage.deleteIfExists).toHaveBeenNthCalledWith(1, candidate.objectKey);
    expect(mocks.storage.deleteIfExists).toHaveBeenNthCalledWith(2, candidate.stagingObjectKey);
    expect(mocks.files.markReadyOrphanDeletedInTransaction).toHaveBeenCalledOnce();
    expect(mocks.audit.append).toHaveBeenNthCalledWith(1, TRANSACTION, expect.objectContaining({
      action: 'REJECT',
      after: { status: 'REJECTED' },
      before: { status: 'READY' },
      objectId: FILE_ID,
    }));
    expect(mocks.audit.append).toHaveBeenNthCalledWith(2, TRANSACTION, expect.objectContaining({
      action: 'DELETE',
      after: { status: 'DELETED' },
      before: { status: 'REJECTED' },
      objectId: FILE_ID,
    }));
  });

  it('keeps the database in REJECTED when exact object deletion fails so the next poll can resume', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const mocks = createMocks(true);

    await service(mocks).cleanupOnce();

    expect(mocks.files.prepareReadyOrphanCleanupInTransaction).toHaveBeenCalledOnce();
    expect(mocks.files.markReadyOrphanDeletedInTransaction).not.toHaveBeenCalled();
    expect(mocks.audit.append).toHaveBeenCalledOnce();
  });
});
