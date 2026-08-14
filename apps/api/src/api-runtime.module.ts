import { type DynamicModule, Module } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { createS3ObjectStorage } from '@qingxu/storage';

import { AppModule } from './app.module';
import {
  API_DATABASE_RUNTIME,
  ApiDatabaseLifecycleService,
  createApiDatabaseRuntime,
} from './platform/database/api-database-runtime';
import { API_RUNTIME_CONFIG } from './platform/config/api-runtime-config';
import {
  API_REDIS_CLIENT,
  ApiRedisLifecycleService,
  createApiRedisClient,
} from './platform/redis/api-redis-runtime';
import { API_OBJECT_STORAGE } from './platform/storage/api-object-storage';

export { API_RUNTIME_CONFIG } from './platform/config/api-runtime-config';

@Module({})
export class ApiRuntimeModule {
  static register(config: PlatformRuntimeConfig): DynamicModule {
    return {
      global: true,
      module: ApiRuntimeModule,
      imports: [AppModule],
      providers: [
        { provide: API_RUNTIME_CONFIG, useValue: config },
        {
          provide: API_DATABASE_RUNTIME,
          inject: [API_RUNTIME_CONFIG],
          useFactory: createApiDatabaseRuntime,
        },
        ApiDatabaseLifecycleService,
        {
          provide: API_REDIS_CLIENT,
          inject: [API_RUNTIME_CONFIG],
          useFactory: createApiRedisClient,
        },
        ApiRedisLifecycleService,
        {
          provide: API_OBJECT_STORAGE,
          inject: [API_RUNTIME_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) => createS3ObjectStorage(runtimeConfig.storage),
        },
      ],
      exports: [API_DATABASE_RUNTIME, API_OBJECT_STORAGE, API_REDIS_CLIENT, API_RUNTIME_CONFIG],
    };
  }
}
