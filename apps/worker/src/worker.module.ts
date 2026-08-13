import { type DynamicModule, Module } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { CallbackInboxRepository, OutboxRepository } from '@qingxu/database';

import { DATABASE_RUNTIME, createWorkerDatabaseRuntime } from './database-runtime.provider';
import {
  CALLBACK_INBOX_REPOSITORY,
  OUTBOX_REPOSITORY,
  OutboxDispatcherService,
  WORKER_CONFIG,
  WORKER_HANDLER_REGISTRY,
  type WorkerHandlerRegistry,
} from './outbox-dispatcher.service';
import { WorkerController } from './worker.controller';

@Module({
  controllers: [WorkerController],
})
export class WorkerModule {
  static register(
    config: PlatformRuntimeConfig,
    registry: WorkerHandlerRegistry,
  ): DynamicModule {
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
          provide: OUTBOX_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) => new OutboxRepository(database),
        },
        {
          provide: CALLBACK_INBOX_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) => new CallbackInboxRepository(database),
        },
        OutboxDispatcherService,
      ],
    };
  }
}
