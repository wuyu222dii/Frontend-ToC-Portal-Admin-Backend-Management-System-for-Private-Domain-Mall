import { Inject, Injectable, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { createDatabaseRuntime, type DatabaseRuntime } from '@qingxu/database';

export const DATABASE_RUNTIME = Symbol('DATABASE_RUNTIME');

export function createWorkerDatabaseRuntime(config: PlatformRuntimeConfig): DatabaseRuntime {
  return createDatabaseRuntime({
    databaseUrl: config.database.url,
    poolMax: config.database.poolMax,
    connectionTimeoutMs: config.database.connectionTimeoutMs,
    applicationName: 'qingxu-worker',
    projectRef: config.database.projectRef,
    sslRootCertPath: config.database.sslRootCertPath,
    allowInsecureLocalhost: config.database.allowInsecureLocalhost,
  });
}

@Injectable()
export class WorkerDatabaseLifecycleService implements OnModuleInit, OnApplicationShutdown {
  constructor(@Inject(DATABASE_RUNTIME) private readonly runtime: DatabaseRuntime) {}

  async onModuleInit(): Promise<void> {
    await this.runtime.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.runtime.disconnect();
  }
}
