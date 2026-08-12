import { Controller, Get } from '@nestjs/common';

export interface HealthResponse {
  service: 'api';
  status: 'ok';
}

@Controller('internal/health')
export class HealthController {
  @Get()
  check(): HealthResponse {
    return {
      service: 'api',
      status: 'ok',
    };
  }
}
