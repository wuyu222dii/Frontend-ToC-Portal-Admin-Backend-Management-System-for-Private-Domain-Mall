import { type DynamicModule, Module } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';

import { AppModule } from './app.module';
import {
  API_DATABASE_RUNTIME,
  ApiDatabaseLifecycleService,
  createApiDatabaseRuntime,
} from './platform/database/api-database-runtime';

export const API_RUNTIME_CONFIG = Symbol('API_RUNTIME_CONFIG');

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
      ],
      exports: [API_DATABASE_RUNTIME],
    };
  }
}
