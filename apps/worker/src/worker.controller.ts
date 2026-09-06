import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseRuntime } from '@qingxu/database';
import type { ObjectStoragePort } from '@qingxu/storage';

import { DATABASE_RUNTIME } from './database-runtime.provider';
import { FILE_OBJECT_STORAGE } from './file-cleanup.service';
import { WORKER_REDIS_CLIENT, type WorkerRedisClient } from './file-cleanup.service';

export interface WorkerHealthResponse {
  service: 'worker';
  status: 'ok';
  checks: { database: 'ok'; redis: 'ok'; storage: 'ok' };
}

@Controller('internal/health')
export class WorkerController {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: Pick<DatabaseRuntime, 'ping'>,
    @Inject(FILE_OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    @Optional() @Inject(WORKER_REDIS_CLIENT) private readonly redis?: Pick<WorkerRedisClient, 'isReady'>,
  ) {}

  @Get()
  async check(): Promise<WorkerHealthResponse> {
    if (!this.redis || !this.redis.isReady) throw new ServiceUnavailableException('Service is not ready');
    try {
      await this.database.ping();
      await this.storage.ping();
    } catch {
      throw new ServiceUnavailableException('Service is not ready');
    }
    return {
      service: 'worker',
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', storage: 'ok' },
    };
  }
}
