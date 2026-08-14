import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';

import { WORKER_REDIS_CLIENT, type WorkerRedisClient } from './file-cleanup.service';

export interface WorkerHealthResponse {
  service: 'worker';
  status: 'ok';
}

@Controller('internal/health')
export class WorkerController {
  constructor(
    @Optional() @Inject(WORKER_REDIS_CLIENT) private readonly redis?: Pick<WorkerRedisClient, 'isReady'>,
  ) {}

  @Get()
  check(): WorkerHealthResponse {
    if (this.redis && !this.redis.isReady) throw new ServiceUnavailableException('Service is not ready');
    return {
      service: 'worker',
      status: 'ok',
    };
  }
}
