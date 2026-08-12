import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(WorkerModule);
  await app.listen(process.env.WORKER_PORT ?? 3001, '0.0.0.0');
}

void bootstrap();
