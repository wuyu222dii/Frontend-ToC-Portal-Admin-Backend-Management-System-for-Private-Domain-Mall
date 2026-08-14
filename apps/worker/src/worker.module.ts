import { type DynamicModule, Module } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  CallbackInboxRepository,
  FILE_STAGING_CLEANUP_EVENT_TYPE,
  FileAssetRepository,
  OutboxRepository,
} from '@qingxu/database';
import { createS3ObjectStorage } from '@qingxu/storage';
import { createClient } from 'redis';

import {
  DATABASE_RUNTIME,
  WorkerDatabaseLifecycleService,
  createWorkerDatabaseRuntime,
} from './database-runtime.provider';
import {
  FILE_CLEANUP_REPOSITORY,
  FILE_CLEANUP_AUDIT_REPOSITORY,
  FILE_OBJECT_STORAGE,
  FileCleanupService,
  WORKER_REDIS_CLIENT,
} from './file-cleanup.service';
import {
  CALLBACK_INBOX_REPOSITORY,
  OUTBOX_REPOSITORY,
  OutboxDispatcherService,
  WORKER_CONFIG,
  WORKER_HANDLER_REGISTRY,
  type WorkerHandlerRegistry,
} from './outbox-dispatcher.service';
import { WorkerController } from './worker.controller';

export function workerRedisReconnectDelay(retries: number): number {
  return Math.min(100 * 2 ** Math.min(retries, 5), 5_000);
}

@Module({
  controllers: [WorkerController],
})
export class WorkerModule {
  static register(
    config: PlatformRuntimeConfig,
    registry: WorkerHandlerRegistry,
  ): DynamicModule {
    if (registry.outbox.some(({ eventType }) => eventType === FILE_STAGING_CLEANUP_EVENT_TYPE)) {
      throw new Error(`${FILE_STAGING_CLEANUP_EVENT_TYPE} is owned by FileCleanupService`);
    }
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        { provide: WORKER_HANDLER_REGISTRY, useValue: registry },
        {
          provide: DATABASE_RUNTIME,
          inject: [WORKER_CONFIG],
          useFactory: createWorkerDatabaseRuntime,
        },
        {
          provide: WorkerDatabaseLifecycleService,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) =>
            new WorkerDatabaseLifecycleService(database),
        },
        {
          provide: OUTBOX_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) => new OutboxRepository(database),
        },
        {
          provide: CALLBACK_INBOX_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) => new CallbackInboxRepository(database),
        },
        {
          provide: FILE_CLEANUP_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) =>
            new FileAssetRepository(database.prisma),
        },
        {
          provide: FILE_CLEANUP_AUDIT_REPOSITORY,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) =>
            new AuditRepository(runtimeConfig.encryption.ipHashKey),
        },
        {
          provide: FILE_OBJECT_STORAGE,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) => createS3ObjectStorage(runtimeConfig.storage),
        },
        {
          provide: WORKER_REDIS_CLIENT,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) => createClient({
            url: runtimeConfig.redis.url,
            socket: {
              connectTimeout: runtimeConfig.database.connectionTimeoutMs,
              reconnectStrategy: workerRedisReconnectDelay,
            },
          }),
        },
        OutboxDispatcherService,
        FileCleanupService,
      ],
    };
  }
}
