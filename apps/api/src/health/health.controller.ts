import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import type { DatabaseRuntime } from '@qingxu/database';

import { Public } from '../platform/access/rbac.metadata';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE, type ApiObjectStorage } from '../platform/storage/api-object-storage';

export interface HealthResponse {
  service: 'api';
  status: 'ok';
  checks: { database: 'ok'; redis: 'ok'; storage: 'ok' };
}

@Controller('internal/health')
@Public()
export class HealthController {
  constructor(
    @Inject(API_DATABASE_RUNTIME) private readonly database: Pick<DatabaseRuntime, 'ping'>,
    @Inject(API_OBJECT_STORAGE) private readonly storage: ApiObjectStorage,
    @Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: Pick<ApiRedisClient, 'isReady'>,
  ) {}

  @Get()
  async check(): Promise<HealthResponse> {
    if (this.redis && !this.redis.isReady) throw new ServiceUnavailableException('Service is not ready');
    try {
      await this.database.ping();
      await this.storage.ping();
    } catch {
      throw new ServiceUnavailableException('Service is not ready');
    }
    return {
      service: 'api',
      status: 'ok',
      checks: { database: 'ok', redis: 'ok', storage: 'ok' },
    };
  }
}
