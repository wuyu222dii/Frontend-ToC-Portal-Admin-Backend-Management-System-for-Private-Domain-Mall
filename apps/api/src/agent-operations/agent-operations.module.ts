import { Module } from '@nestjs/common';

import { AgentOperationsController } from './agent-operations.controller';
import { AgentOperationsService } from './agent-operations.service';

@Module({ controllers: [AgentOperationsController], providers: [AgentOperationsService] })
export class AgentOperationsModule {}
