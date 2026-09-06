import 'reflect-metadata';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { loadPlatformConfig } from '@qingxu/config';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  let app: INestApplication | undefined;
  try {
    const config = loadPlatformConfig(process.env, { service: 'worker' });
    app = await NestFactory.create(WorkerModule.register(config, { outbox: [], callbacks: [] }));
    app.enableShutdownHooks();
    await app.listen(config.port, '0.0.0.0');
  } catch (error) {
    await app?.close();
    process.stderr.write(`${JSON.stringify({ event: 'service_startup_failed', service: 'worker', error_code: error instanceof Error ? error.message : 'UNKNOWN' })}\n`);
    throw new Error('WORKER_STARTUP_FAILED');
  }
}

void bootstrap().catch(() => {
  process.stderr.write(`${JSON.stringify({ event: 'service_exit', service: 'worker' })}\n`);
  process.exitCode = 1;
});
