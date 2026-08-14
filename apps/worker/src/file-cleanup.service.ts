import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  FILE_STAGING_CLEANUP_EVENT_TYPE,
  type AuditRepository,
  type DatabaseRuntime,
  type FileAssetRepository,
  type OutboxEventModel,
  type OutboxRepository,
} from '@qingxu/database';
import {
  FILE_OBJECT_LEASE_TTL_MS,
  fileObjectLeaseKey,
  type ObjectStoragePort,
} from '@qingxu/storage';

import { DATABASE_RUNTIME } from './database-runtime.provider';
import { OUTBOX_REPOSITORY, WORKER_CONFIG } from './outbox-dispatcher.service';

export const FILE_CLEANUP_REPOSITORY = Symbol('FILE_CLEANUP_REPOSITORY');
export const FILE_CLEANUP_AUDIT_REPOSITORY = Symbol('FILE_CLEANUP_AUDIT_REPOSITORY');
export const FILE_OBJECT_STORAGE = Symbol('FILE_OBJECT_STORAGE');
export const WORKER_REDIS_CLIENT = Symbol('WORKER_REDIS_CLIENT');

export type FileCleanupRepository = Pick<FileAssetRepository,
  | 'listCleanupCandidates'
  | 'markRejectedAfterCleanupInTransaction'
  | 'recheckCleanupCandidateInTransaction'
  | 'recheckReadyForStagingCleanupInTransaction'
>;
export type FileCleanupAuditRepository = Pick<AuditRepository, 'append'>;
export type FileCleanupOutboxRepository = Pick<OutboxRepository, 'findDue' | 'publishOne'>;

export interface WorkerRedisClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  destroy(): void;
  eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown>;
  on(event: 'error', listener: () => void): unknown;
  quit(): Promise<unknown>;
  set(key: string, value: string, options: { NX: true; PX: number }): Promise<string | null>;
}

const RELEASE_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const RENEW_LEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const MAXIMUM_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;
const STAGING_CLEANUP_MAX_RETRIES = 20;
const FILE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const RESOURCE_PAYLOAD_FIELDS = new Set([
  'event_version',
  'resource_id',
  'resource_type',
  'resource_version',
]);

function stagingCleanupFileId(event: OutboxEventModel): string {
  const payload = event.payload;
  if (
    event.event_type !== FILE_STAGING_CLEANUP_EVENT_TYPE ||
    event.aggregate_type !== 'file' ||
    !FILE_ID_PATTERN.test(event.aggregate_id) ||
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload) ||
    Object.getPrototypeOf(payload) !== Object.prototype ||
    Object.keys(payload).length !== RESOURCE_PAYLOAD_FIELDS.size ||
    Object.keys(payload).some((key) => !RESOURCE_PAYLOAD_FIELDS.has(key)) ||
    payload.event_version !== 1 ||
    payload.resource_type !== 'file' ||
    payload.resource_id !== event.aggregate_id ||
    payload.resource_version !== 1
  ) {
    throw new Error('Invalid file staging cleanup event');
  }
  return event.aggregate_id;
}

interface FileObjectLease {
  leaseKey: string;
  owner: string;
}

@Injectable()
export class FileCleanupService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(FileCleanupService.name);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private stopping = false;

  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: DatabaseRuntime,
    @Inject(WORKER_CONFIG) private readonly config: PlatformRuntimeConfig,
    @Inject(FILE_CLEANUP_REPOSITORY) private readonly files: FileCleanupRepository,
    @Inject(FILE_CLEANUP_AUDIT_REPOSITORY) private readonly audit: FileCleanupAuditRepository,
    @Inject(FILE_OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Inject(WORKER_REDIS_CLIENT) private readonly redis: WorkerRedisClient,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: FileCleanupOutboxRepository,
  ) {
    this.redis.on('error', () => {
      this.logger.error({ code: 'FILE_CLEANUP_REDIS_ERROR' });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.redis.connect();
    this.schedule(0);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!this.redis.isOpen) return;
    try {
      await this.redis.quit();
    } catch {
      this.redis.destroy();
    }
  }

  async cleanupOnce(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    // The upload can occur at the end of the signed PUT window. Include that
    // window so every staging object is at least the configured cleanup age.
    const olderThan = new Date(Date.now() - (
      this.config.storage.uploadTtlSeconds + this.config.storage.pendingCleanupAgeSeconds
    ) * 1_000);
    try {
      const candidates = await this.files.listCleanupCandidates({
        olderThan,
        limit: this.config.worker.batchSize,
      });
      for (const candidate of candidates) {
        await this.cleanupCandidate(candidate.id, candidate.objectKey, olderThan);
      }
    } catch {
      this.logger.error({ code: 'FILE_CLEANUP_POLL_FAILED' });
    }
    try {
      await this.cleanupReadyStagingEvents();
    } catch {
      this.logger.error({ code: 'FILE_STAGING_CLEANUP_POLL_FAILED' });
    } finally {
      this.running = false;
    }
  }

  private async cleanupCandidate(fileId: string, expectedObjectKey: string, olderThan: Date): Promise<void> {
    let lease: FileObjectLease | undefined;
    try {
      lease = await this.acquireLease(fileId);
      if (!lease) return;

      const candidate = await this.database.withPrismaTransaction(
        (transaction) => this.files.recheckCleanupCandidateInTransaction(transaction, {
          fileId,
          expectedObjectKey,
          olderThan,
        }),
        { isolationLevel: 'Serializable' },
      );
      if (!candidate) return;

      // Delete exact opaque keys only. The final key covers copy-before-DB-commit failures.
      if (!await this.renewLease(lease)) return;
      await this.storage.deleteIfExists(candidate.finalObjectKey);
      if (!await this.renewLease(lease)) return;
      await this.storage.deleteIfExists(candidate.objectKey);
      if (!await this.renewLease(lease)) return;

      const requestId = `trace_${randomUUID().replaceAll('-', '')}`;
      const rejected = await this.database.withPrismaTransaction(
        async (transaction) => {
          const transitioned = await this.files.markRejectedAfterCleanupInTransaction(transaction, {
            fileId,
            expectedObjectKey,
            olderThan,
          });
          if (!transitioned) return false;
          await this.audit.append(transaction, {
            action: 'REJECT',
            after: { status: 'REJECTED' },
            before: { status: 'PENDING' },
            module: 'file',
            objectId: fileId,
            objectType: 'file',
            requestId,
            result: 'SUCCESS',
            resultCode: 'OK',
            summaryPolicy: 'STATUS_VERSION',
          });
          return true;
        },
        { isolationLevel: 'Serializable' },
      );
      if (!rejected) this.logger.error({ code: 'FILE_CLEANUP_STATE_CHANGED', fileId });
    } catch {
      this.logger.error({ code: 'FILE_CLEANUP_CANDIDATE_FAILED', fileId });
    } finally {
      if (lease) await this.releaseLease(fileId, lease);
    }
  }

  private async cleanupReadyStagingEvents(): Promise<void> {
    const events = await this.outbox.findDue({
      eventTypes: [FILE_STAGING_CLEANUP_EVENT_TYPE],
      limit: this.config.worker.batchSize,
    });
    for (const event of events) {
      const result = await this.outbox.publishOne(
        event.id,
        (current) => this.cleanupReadyStagingEvent(current),
        {
          initialDelayMs: this.config.worker.baseRetryDelayMs,
          maximumDelayMs: MAXIMUM_RETRY_DELAY_MS,
          maxRetries: STAGING_CLEANUP_MAX_RETRIES,
        },
      );
      if (result === 'terminal') {
        this.logger.error({
          code: 'FILE_STAGING_CLEANUP_RETRY_EXHAUSTED',
          eventId: event.id,
        });
      }
    }
  }

  private async cleanupReadyStagingEvent(event: OutboxEventModel): Promise<void> {
    const fileId = stagingCleanupFileId(event);
    const lease = await this.acquireLease(fileId);
    if (!lease) throw new Error('File object lease is busy');
    try {
      const cleanup = await this.database.withPrismaTransaction(
        (transaction) => this.files.recheckReadyForStagingCleanupInTransaction(transaction, { fileId }),
        { isolationLevel: 'Serializable' },
      );
      if (!cleanup) return;
      if (!await this.renewLease(lease)) throw new Error('File object lease was lost');
      await this.storage.deleteIfExists(cleanup.stagingObjectKey);
      if (!await this.renewLease(lease)) throw new Error('File object lease was lost');
    } finally {
      await this.releaseLease(fileId, lease);
    }
  }

  private async acquireLease(fileId: string): Promise<FileObjectLease | undefined> {
    const leaseKey = fileObjectLeaseKey(fileId);
    const owner = randomUUID();
    const acquired = await this.redis.set(leaseKey, owner, {
      NX: true,
      PX: FILE_OBJECT_LEASE_TTL_MS,
    }) === 'OK';
    return acquired ? { leaseKey, owner } : undefined;
  }

  private async renewLease(lease: FileObjectLease): Promise<boolean> {
    const renewed = await this.redis.eval(RENEW_LEASE_SCRIPT, {
      arguments: [lease.owner, String(FILE_OBJECT_LEASE_TTL_MS)],
      keys: [lease.leaseKey],
    });
    return renewed === 1;
  }

  private async releaseLease(fileId: string, lease: FileObjectLease): Promise<void> {
    try {
      await this.redis.eval(RELEASE_LEASE_SCRIPT, {
        arguments: [lease.owner],
        keys: [lease.leaseKey],
      });
    } catch {
      this.logger.error({ code: 'FILE_CLEANUP_LEASE_RELEASE_FAILED', fileId });
    }
  }

  private schedule(delayMs: number): void {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      void this.cleanupOnce().finally(() => this.schedule(this.config.worker.pollIntervalMs));
    }, delayMs);
    this.timer.unref();
  }
}
