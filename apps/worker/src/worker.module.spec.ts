import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { WorkerModule } from './worker.module';

describe('WorkerModule', () => {
  it('compiles without reading runtime environment or connecting to a database', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.NODE_ENV;
    delete process.env.DATABASE_URL;

    try {
      const context = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
      expect(context.get(WorkerModule)).toBeInstanceOf(WorkerModule);
      await context.close();
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabaseUrl;
    }
  });
});
