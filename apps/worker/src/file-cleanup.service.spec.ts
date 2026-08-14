import { Logger } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  FILE_STAGING_CLEANUP_EVENT_TYPE,
  type DatabaseRuntime,
  type FileCleanupCandidate,
  type OutboxEventModel,
} from '@qingxu/database';
import { FILE_OBJECT_LEASE_TTL_MS, fileObjectLeaseKey, type ObjectStoragePort } from '@qingxu/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FileCleanupService,
  type FileCleanupAuditRepository,
  type FileCleanupOutboxRepository,
  type FileCleanupRepository,
  type WorkerRedisClient,
} from './file-cleanup.service';

const fileId = '01K00000000000000000000000';
const candidate: FileCleanupCandidate = {
  id: fileId,
  objectKey: `staging/${fileId}`,
  finalObjectKey: `public/${fileId}`,
  purpose: 'BRAND_LOGO',
  createdAt: new Date('2026-08-12T00:00:00.000Z'),
};
const stagingCleanupEvent = {
  aggregate_id: fileId,
  aggregate_type: 'file',
  created_at: new Date('2026-08-13T00:00:00.000Z'),
  error_message: null,
  event_type: FILE_STAGING_CLEANUP_EVENT_TYPE,
  id: '01K00000000000000000000001',
  next_retry_at: new Date('2026-08-14T00:00:00.000Z'),
  payload: {
    event_version: 1,
    resource_id: fileId,
    resource_type: 'file',
    resource_version: 1,
  },
  published_at: null,
  retry_count: 0,
  status: 'PENDING',
} as OutboxEventModel;

const config = {
  storage: { pendingCleanupAgeSeconds: 86_400, uploadTtlSeconds: 900 },
  worker: { pollIntervalMs: 1_000, batchSize: 20, maxRetries: 8, baseRetryDelayMs: 1_000 },
} as PlatformRuntimeConfig;

function createMocks(options: {
  candidates?: FileCleanupCandidate[];
  events?: OutboxEventModel[];
  lease?: string | null;
  rechecked?: FileCleanupCandidate | null;
  readyRechecked?: { fileId: string; stagingObjectKey: string } | null;
} = {}) {
  const transaction = {};
  const database = {
    withPrismaTransaction: vi.fn(async (work: (value: object) => Promise<unknown>) => work(transaction)),
  } as unknown as DatabaseRuntime;
  const files = {
    listCleanupCandidates: vi.fn(async () => options.candidates ?? [candidate]),
    recheckCleanupCandidateInTransaction: vi.fn(async () =>
      options.rechecked === undefined ? candidate : options.rechecked),
    markRejectedAfterCleanupInTransaction: vi.fn(async () => true),
    recheckReadyForStagingCleanupInTransaction: vi.fn(async () =>
      options.readyRechecked === undefined
        ? { fileId, stagingObjectKey: `staging/${fileId}` }
        : options.readyRechecked),
  } as unknown as FileCleanupRepository;
  const audit = {
    append: vi.fn(async () => ({})),
  } as unknown as FileCleanupAuditRepository;
  const storage = {
    deleteIfExists: vi.fn(async () => undefined),
  } as unknown as ObjectStoragePort;
  const redis = {
    isOpen: true,
    connect: vi.fn(),
    destroy: vi.fn(),
    eval: vi.fn(async () => 1),
    on: vi.fn(),
    quit: vi.fn(),
    set: vi.fn(async () => options.lease === undefined ? 'OK' : options.lease),
  } as unknown as WorkerRedisClient;
  const outbox = {
    findDue: vi.fn(async () => options.events ?? []),
    publishOne: vi.fn(async (_eventId, handler) => {
      try {
        await handler(stagingCleanupEvent);
        return 'published' as const;
      } catch {
        return 'retry_scheduled' as const;
      }
    }),
  } as unknown as FileCleanupOutboxRepository;
  return { audit, database, files, outbox, redis, storage };
}

function createService(mocks = createMocks()): FileCleanupService {
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

describe('FileCleanupService', () => {
  it('rechecks a candidate, deletes exact final and staging objects, then marks it rejected', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00.000Z'));
    const mocks = createMocks();
    const service = createService(mocks);

    await service.cleanupOnce();

    const olderThan = new Date('2026-08-12T23:45:00.000Z');
    expect(mocks.files.listCleanupCandidates).toHaveBeenCalledWith({ olderThan, limit: 20 });
    expect(mocks.redis.set).toHaveBeenCalledWith(
      fileObjectLeaseKey(fileId),
      expect.any(String),
      { NX: true, PX: FILE_OBJECT_LEASE_TTL_MS },
    );
    expect(mocks.files.recheckCleanupCandidateInTransaction).toHaveBeenCalledWith(expect.anything(), {
      fileId,
      expectedObjectKey: candidate.objectKey,
      olderThan,
    });
    expect(vi.mocked(mocks.storage.deleteIfExists).mock.calls).toEqual([
      [candidate.finalObjectKey],
      [candidate.objectKey],
    ]);
    expect(mocks.files.markRejectedAfterCleanupInTransaction).toHaveBeenCalledWith(expect.anything(), {
      fileId,
      expectedObjectKey: candidate.objectKey,
      olderThan,
    });
    const transaction = vi.mocked(mocks.database.withPrismaTransaction).mock.calls[1]?.[0];
    expect(mocks.audit.append).toHaveBeenCalledWith(expect.anything(), {
      action: 'REJECT',
      after: { status: 'REJECTED' },
      before: { status: 'PENDING' },
      module: 'file',
      objectId: fileId,
      objectType: 'file',
      requestId: expect.stringMatching(/^trace_[0-9a-f]{32}$/),
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
    expect(transaction).toBeDefined();
    expect(mocks.redis.eval).toHaveBeenCalledWith(expect.stringContaining("redis.call('GET'"), {
      arguments: [expect.any(String)],
      keys: [fileObjectLeaseKey(fileId)],
    });
  });

  it('skips work when the complete path owns the shared lease', async () => {
    const mocks = createMocks({ lease: null });

    await createService(mocks).cleanupOnce();

    expect(mocks.files.recheckCleanupCandidateInTransaction).not.toHaveBeenCalled();
    expect(mocks.storage.deleteIfExists).not.toHaveBeenCalled();
    expect(mocks.files.markRejectedAfterCleanupInTransaction).not.toHaveBeenCalled();
    expect(mocks.redis.eval).not.toHaveBeenCalled();
  });

  it('does not delete anything when the database recheck observes a state or reference change', async () => {
    const mocks = createMocks({ rechecked: null });

    await createService(mocks).cleanupOnce();

    expect(mocks.storage.deleteIfExists).not.toHaveBeenCalled();
    expect(mocks.files.markRejectedAfterCleanupInTransaction).not.toHaveBeenCalled();
    expect(mocks.redis.eval).toHaveBeenCalledOnce();
  });

  it('does not mark rejected when either exact object deletion fails', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.storage.deleteIfExists).mockRejectedValueOnce(new Error('private S3 detail'));
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await createService(mocks).cleanupOnce();

    expect(mocks.files.markRejectedAfterCleanupInTransaction).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith({ code: 'FILE_CLEANUP_CANDIDATE_FAILED', fileId });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private S3 detail');
    expect(mocks.redis.eval).toHaveBeenCalledTimes(2);
  });

  it('publishes one due event only after READY/final-key recheck and exact staging deletion', async () => {
    const mocks = createMocks({ candidates: [], events: [stagingCleanupEvent] });

    await createService(mocks).cleanupOnce();

    expect(mocks.outbox.findDue).toHaveBeenCalledWith({
      eventTypes: [FILE_STAGING_CLEANUP_EVENT_TYPE],
      limit: config.worker.batchSize,
    });
    expect(mocks.outbox.publishOne).toHaveBeenCalledWith(
      stagingCleanupEvent.id,
      expect.any(Function),
      {
        initialDelayMs: config.worker.baseRetryDelayMs,
        maximumDelayMs: 86_400_000,
        maxRetries: 20,
      },
    );
    expect(mocks.files.recheckReadyForStagingCleanupInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      { fileId },
    );
    expect(mocks.storage.deleteIfExists).toHaveBeenCalledExactlyOnceWith(`staging/${fileId}`);
  });

  it('publishes a safe no-op without deletion when READY/final-key recheck fails', async () => {
    const mocks = createMocks({
      candidates: [],
      events: [stagingCleanupEvent],
      readyRechecked: null,
    });

    await createService(mocks).cleanupOnce();

    expect(mocks.storage.deleteIfExists).not.toHaveBeenCalled();
    await expect(vi.mocked(mocks.outbox.publishOne).mock.results[0]?.value).resolves.toBe('published');
  });

  it('fails closed on a malformed resource-reference payload', async () => {
    const malformed = {
      ...stagingCleanupEvent,
      payload: {
        access_token: 'must-not-be-consumed',
        event_version: 1,
        resource_id: fileId,
        resource_type: 'file',
        resource_version: 1,
      },
    } as OutboxEventModel;
    const mocks = createMocks({ candidates: [], events: [malformed] });
    vi.mocked(mocks.outbox.publishOne).mockImplementation(async (_eventId, handler) => {
      try {
        await handler(malformed);
        return 'published';
      } catch {
        return 'retry_scheduled';
      }
    });

    await createService(mocks).cleanupOnce();

    expect(mocks.files.recheckReadyForStagingCleanupInTransaction).not.toHaveBeenCalled();
    expect(mocks.storage.deleteIfExists).not.toHaveBeenCalled();
  });

  it('logs only the event ID when delayed cleanup exhausts its 20 attempts', async () => {
    const mocks = createMocks({ candidates: [], events: [stagingCleanupEvent] });
    vi.mocked(mocks.outbox.publishOne).mockResolvedValue('terminal');
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await createService(mocks).cleanupOnce();

    expect(mocks.outbox.publishOne).toHaveBeenCalledWith(
      stagingCleanupEvent.id,
      expect.any(Function),
      expect.objectContaining({ maxRetries: 20, maximumDelayMs: 86_400_000 }),
    );
    expect(errorLog).toHaveBeenCalledWith({
      code: 'FILE_STAGING_CLEANUP_RETRY_EXHAUSTED',
      eventId: stagingCleanupEvent.id,
    });
  });

  it('rolls back the rejected state when appending its audit fact fails', async () => {
    let persistedState = 'PENDING';
    const mocks = createMocks();
    const transaction = { state: persistedState };
    vi.mocked(mocks.database.withPrismaTransaction).mockImplementation(async (work) => {
      transaction.state = persistedState;
      const result = await work(transaction as never);
      persistedState = transaction.state;
      return result as never;
    });
    vi.mocked(mocks.files.markRejectedAfterCleanupInTransaction).mockImplementation(async () => {
      transaction.state = 'REJECTED';
      return true;
    });
    vi.mocked(mocks.audit.append).mockRejectedValue(new Error('audit unavailable'));
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await createService(mocks).cleanupOnce();

    expect(persistedState).toBe('PENDING');
    expect(mocks.audit.append).toHaveBeenCalledOnce();
    expect(errorLog).toHaveBeenCalledWith({ code: 'FILE_CLEANUP_CANDIDATE_FAILED', fileId });
  });

  it.each([
    { lostAtRenewal: 1, deletedKeys: [] },
    { lostAtRenewal: 2, deletedKeys: [candidate.finalObjectKey] },
    { lostAtRenewal: 3, deletedKeys: [candidate.finalObjectKey, candidate.objectKey] },
  ])('aborts destructive work when the lease owner is lost at renewal $lostAtRenewal', async ({
    deletedKeys,
    lostAtRenewal,
  }) => {
    const mocks = createMocks();
    let renewalCount = 0;
    vi.mocked(mocks.redis.eval).mockImplementation(async (script) => {
      if (script.includes('PEXPIRE')) {
        renewalCount += 1;
        return renewalCount === lostAtRenewal ? 0 : 1;
      }
      return 0;
    });

    await createService(mocks).cleanupOnce();

    expect(vi.mocked(mocks.storage.deleteIfExists).mock.calls).toEqual(
      deletedKeys.map((key) => [key]),
    );
    expect(mocks.files.markRejectedAfterCleanupInTransaction).not.toHaveBeenCalled();
    expect(mocks.redis.eval).toHaveBeenCalledWith(expect.stringContaining('PEXPIRE'), {
      arguments: [expect.any(String), String(FILE_OBJECT_LEASE_TTL_MS)],
      keys: [fileObjectLeaseKey(fileId)],
    });
  });

  it('logs fixed metadata when the candidate query fails', async () => {
    const mocks = createMocks();
    vi.mocked(mocks.files.listCleanupCandidates).mockRejectedValue(new Error('private database detail'));
    const errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await createService(mocks).cleanupOnce();

    expect(errorLog).toHaveBeenCalledWith({ code: 'FILE_CLEANUP_POLL_FAILED' });
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('private database detail');
  });

  it('connects and gracefully closes its dedicated Redis client', async () => {
    const mocks = createMocks();
    const service = createService(mocks);

    await service.onModuleInit();
    await service.onApplicationShutdown();

    expect(mocks.redis.connect).toHaveBeenCalledOnce();
    expect(mocks.redis.quit).toHaveBeenCalledOnce();
  });
});
