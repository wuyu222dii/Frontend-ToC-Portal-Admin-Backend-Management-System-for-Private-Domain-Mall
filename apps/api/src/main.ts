import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadPlatformConfig } from '@qingxu/config';

import { ApiRuntimeModule } from './api-runtime.module';
import { configureApi } from './platform/http/configure-api';

async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;
  try {
    const config = loadPlatformConfig(process.env, { service: 'api' });
    app = await NestFactory.create(ApiRuntimeModule.register(config));
    configureApi(app, config.http);
    app.enableShutdownHooks();
    await app.listen(config.port, '0.0.0.0');
  } catch (error) {
    await app?.close();
    process.stderr.write(`${JSON.stringify({ event: 'service_startup_failed', service: 'api', error_code: error instanceof Error ? error.message : 'UNKNOWN' })}\n`);
    throw new Error('API_STARTUP_FAILED');
  }
}

void bootstrap().catch(() => {
  process.stderr.write(`${JSON.stringify({ event: 'service_exit', service: 'api' })}\n`);
  process.exitCode = 1;
});
