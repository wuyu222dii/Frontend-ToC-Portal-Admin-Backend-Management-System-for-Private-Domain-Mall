import { Controller, Get } from '@nestjs/common';

export interface WorkerHealthResponse {
  service: 'worker';
  status: 'ok';
}

@Controller('internal/health')
export class WorkerController {
  @Get()
  check(): WorkerHealthResponse {
    return {
      service: 'worker',
      status: 'ok',
    };
  }
}
