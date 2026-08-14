import { ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('reports API readiness', () => {
    expect(new HealthController().check()).toEqual({
      service: 'api',
      status: 'ok',
    });
  });

  it('fails readiness while the injected Redis client is reconnecting', () => {
    expect(() => new HealthController({ isReady: false }).check()).toThrow(ServiceUnavailableException);
    expect(new HealthController({ isReady: true }).check()).toEqual({ service: 'api', status: 'ok' });
  });
});
