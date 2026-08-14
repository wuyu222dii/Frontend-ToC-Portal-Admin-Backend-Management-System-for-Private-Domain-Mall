import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { WorkerController } from './worker.controller';

describe('WorkerController', () => {
  it('reports worker readiness', () => {
    expect(new WorkerController().check()).toEqual({
      service: 'worker',
      status: 'ok',
    });
  });

  it('fails readiness while the injected Redis client is reconnecting', () => {
    expect(() => new WorkerController({ isReady: false }).check()).toThrow(ServiceUnavailableException);
    expect(new WorkerController({ isReady: true }).check()).toEqual({ service: 'worker', status: 'ok' });
  });
});
