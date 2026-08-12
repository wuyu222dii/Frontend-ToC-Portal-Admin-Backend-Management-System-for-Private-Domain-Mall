import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports API readiness', () => {
    expect(new HealthController().check()).toEqual({
      service: 'api',
      status: 'ok',
    });
  });
});
