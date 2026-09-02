import { Module } from '@nestjs/common';

import { AgentAuthController } from './agent-auth.controller';
import { AgentAuthService } from './agent-auth.service';
import { AgentLoginRateLimiter } from './agent-login-rate-limiter';

@Module({
  controllers: [AgentAuthController],
  providers: [AgentAuthService, AgentLoginRateLimiter],
})
export class AgentAuthModule {}
