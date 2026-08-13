import { Controller, Get } from '@nestjs/common';

import { Public } from '../platform/access/rbac.metadata';

export interface HealthResponse {
  service: 'api';
  status: 'ok';
}

@Controller('internal/health')
@Public()
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      service: 'api',
      status: 'ok',
    };
  }
}
