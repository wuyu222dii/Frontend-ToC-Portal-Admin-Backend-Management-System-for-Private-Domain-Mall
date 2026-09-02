import { Module } from '@nestjs/common';

import { AdminAgentsController } from './admin-agents.controller';
import { AdminAgentsService } from './admin-agents.service';

@Module({
  controllers: [AdminAgentsController],
  providers: [AdminAgentsService],
})
export class AdminAgentsModule {}
