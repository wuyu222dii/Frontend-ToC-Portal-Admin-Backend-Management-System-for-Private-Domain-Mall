import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { createDatabaseRuntime, type DatabaseRuntime } from '@qingxu/database';

export const API_DATABASE_RUNTIME = Symbol('API_DATABASE_RUNTIME');

export function createApiDatabaseRuntime(config: PlatformRuntimeConfig): DatabaseRuntime {
  return createDatabaseRuntime({
    applicationName: 'qingxu-api',
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    databaseUrl: config.database.url,
    poolMax: config.database.poolMax,
    projectRef: config.database.projectRef,
    sslRootCertPath: config.database.sslRootCertPath,
    allowInsecureLocalhost: config.database.allowInsecureLocalhost,
  });
}

@Injectable()
export class ApiDatabaseLifecycleService implements OnModuleInit, OnApplicationShutdown {
  private closed = false;

  constructor(@Inject(API_DATABASE_RUNTIME) private readonly database: DatabaseRuntime) {}

  async onModuleInit(): Promise<void> {
    await this.database.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.database.disconnect();
  }
}
