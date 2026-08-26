import { Module } from '@nestjs/common';

import { StoreAuthController } from './store-auth.controller';
import { StoreAuthRateLimitGuard } from './store-auth-rate-limit.guard';
import { StoreAuthService } from './store-auth.service';
import { StoreIdentityProvider } from './store-identity-provider';

@Module({
  controllers: [StoreAuthController],
  providers: [StoreAuthRateLimitGuard, StoreAuthService, StoreIdentityProvider],
})
export class StoreAuthModule {}
