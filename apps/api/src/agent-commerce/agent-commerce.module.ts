import { Module } from '@nestjs/common';

import { FileObjectLeaseManager } from '../files/file-object-lease';
import { AgentCommerceController } from './agent-commerce.controller';
import { AgentCommerceService } from './agent-commerce.service';
import { WechatUrlLinkClient } from './wechat-url-link';

@Module({
  controllers: [AgentCommerceController],
  providers: [AgentCommerceService, FileObjectLeaseManager, WechatUrlLinkClient],
  exports: [AgentCommerceService, FileObjectLeaseManager, WechatUrlLinkClient],
})
export class AgentCommerceModule {}
