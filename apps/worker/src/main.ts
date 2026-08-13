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
  } catch {
    await app?.close();
    throw new Error('WORKER_STARTUP_FAILED');
  }
}

void bootstrap().catch(() => {
  process.stderr.write('Worker startup failed\n');
  process.exitCode = 1;
});
