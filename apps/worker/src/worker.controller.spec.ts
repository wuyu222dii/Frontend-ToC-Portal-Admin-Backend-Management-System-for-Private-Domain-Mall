import { describe, expect, it } from 'vitest';

import { WorkerController } from './worker.controller';

describe('WorkerController', () => {
  it('reports worker readiness', () => {
    expect(new WorkerController().check()).toEqual({
      service: 'worker',
      status: 'ok',
    });
  });
});
