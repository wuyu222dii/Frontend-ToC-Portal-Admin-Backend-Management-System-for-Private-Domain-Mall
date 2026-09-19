import { Module } from '@nestjs/common';

import { AgentCommerceModule } from '../agent-commerce/agent-commerce.module';
import { AdminAgentsController } from './admin-agents.controller';
import { AdminAgentsService } from './admin-agents.service';

@Module({
  imports: [AgentCommerceModule],
  controllers: [AdminAgentsController],
  providers: [AdminAgentsService],
})
export class AdminAgentsModule {}
