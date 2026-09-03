import { Module } from '@nestjs/common';

import { FileObjectLeaseManager } from '../files/file-object-lease';
import { AgentCommerceController } from './agent-commerce.controller';
import { AgentCommerceService } from './agent-commerce.service';

@Module({ controllers: [AgentCommerceController], providers: [AgentCommerceService, FileObjectLeaseManager] })
export class AgentCommerceModule {}
