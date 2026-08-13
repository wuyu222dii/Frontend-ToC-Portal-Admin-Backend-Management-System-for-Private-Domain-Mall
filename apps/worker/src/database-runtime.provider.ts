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
