import type { DatabaseRuntime } from '@qingxu/database';
import { describe, expect, it, vi } from 'vitest';

import { WorkerDatabaseLifecycleService } from './database-runtime.provider';

describe('WorkerDatabaseLifecycleService', () => {
  it('connects and disconnects the shared database runtime exactly once', async () => {
    const runtime = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as DatabaseRuntime;
    const lifecycle = new WorkerDatabaseLifecycleService(runtime);

    await lifecycle.onModuleInit();
    await lifecycle.onApplicationShutdown();

    expect(runtime.connect).toHaveBeenCalledOnce();
    expect(runtime.disconnect).toHaveBeenCalledOnce();
  });
});
