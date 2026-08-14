import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';

import { Public } from '../platform/access/rbac.metadata';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

export interface HealthResponse {
  service: 'api';
  status: 'ok';
}

@Controller('internal/health')
@Public()
export class HealthController {
  constructor(
    @Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: Pick<ApiRedisClient, 'isReady'>,
  ) {}

  @Get()
  check(): HealthResponse {
    if (this.redis && !this.redis.isReady) throw new ServiceUnavailableException('Service is not ready');
    return {
      service: 'api',
      status: 'ok',
    };
  }
}
