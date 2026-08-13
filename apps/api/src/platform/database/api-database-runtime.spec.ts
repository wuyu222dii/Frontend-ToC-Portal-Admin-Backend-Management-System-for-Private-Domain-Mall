import type { DatabaseRuntime } from '@qingxu/database';
import { describe, expect, it, vi } from 'vitest';

import { ApiDatabaseLifecycleService } from './api-database-runtime';

function fakeRuntime(overrides: Partial<DatabaseRuntime> = {}): DatabaseRuntime {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue(undefined),
    pool: {} as DatabaseRuntime['pool'],
    prisma: {} as DatabaseRuntime['prisma'],
    withPgTransaction: vi.fn(),
    withPrismaTransaction: vi.fn(),
    ...overrides,
  };
}

describe('ApiDatabaseLifecycleService', () => {
  it('connects before serving and closes the runtime once', async () => {
    const runtime = fakeRuntime();
    const lifecycle = new ApiDatabaseLifecycleService(runtime);

    await lifecycle.onModuleInit();
    await lifecycle.onApplicationShutdown();
    await lifecycle.onApplicationShutdown();

    expect(runtime.connect).toHaveBeenCalledOnce();
    expect(runtime.disconnect).toHaveBeenCalledOnce();
  });

  it('propagates startup connection failures', async () => {
    const failure = new Error('unavailable');
    const runtime = fakeRuntime({ connect: vi.fn().mockRejectedValue(failure) });

    await expect(new ApiDatabaseLifecycleService(runtime).onModuleInit()).rejects.toBe(failure);
  });
});
