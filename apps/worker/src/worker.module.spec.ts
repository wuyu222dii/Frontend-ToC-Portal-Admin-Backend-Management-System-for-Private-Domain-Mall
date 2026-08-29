import { NestFactory } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { FILE_STAGING_CLEANUP_EVENT_TYPE } from '@qingxu/database';
import { describe, expect, it, vi } from 'vitest';

import type { WorkerHandlerRegistry } from './outbox-dispatcher.service';
import type { PaymentCallbackService } from './payment-callback.service';
import {
  WorkerModule,
  mergePaymentCallbackHandlers,
  workerRedisReconnectDelay,
} from './worker.module';

describe('WorkerModule', () => {
  it('uses bounded reconnect delays for transient Redis outages', () => {
    expect([0, 1, 2, 3, 10, Number.MAX_SAFE_INTEGER].map(workerRedisReconnectDelay))
      .toEqual([100, 200, 400, 800, 3_200, 3_200]);
  });

  it('reserves delayed file staging cleanup for the dedicated service', () => {
    expect(() => WorkerModule.register({} as PlatformRuntimeConfig, {
      callbacks: [],
      outbox: [{ eventType: FILE_STAGING_CLEANUP_EVENT_TYPE, handle: vi.fn() }],
    })).toThrow('owned by FileCleanupService');
  });

  it('registers payment callbacks only for the non-production MOCK runtime', () => {
    const registry: WorkerHandlerRegistry = { callbacks: [], outbox: [] };
    const registrations = [{ provider: 'MOCK', eventType: 'payment.succeeded', handle: vi.fn() }] as const;
    const payments = { registrations: vi.fn(() => registrations) } as unknown as PaymentCallbackService;
    const development = {
      environment: 'development',
      payment: { mockSigningKey: Buffer.alloc(32), provider: 'MOCK' },
    } as PlatformRuntimeConfig;
    const production = {
      environment: 'production',
      payment: { mockSigningKey: undefined, provider: 'WECHAT' },
    } as PlatformRuntimeConfig;

    expect(mergePaymentCallbackHandlers(development, registry, payments).callbacks).toEqual(registrations);
    expect(mergePaymentCallbackHandlers(production, registry, payments).callbacks).toEqual([]);
    expect(payments.registrations).toHaveBeenCalledOnce();
  });

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
