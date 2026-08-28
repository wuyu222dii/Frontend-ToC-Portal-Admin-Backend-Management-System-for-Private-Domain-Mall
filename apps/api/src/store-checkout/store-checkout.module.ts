import { Module } from '@nestjs/common';

import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreCheckoutController } from './store-checkout.controller';
import { StoreCheckoutService } from './store-checkout.service';

@Module({
  controllers: [StoreCheckoutController],
  providers: [StoreCustomerRateLimitGuard, StoreCheckoutService],
})
export class StoreCheckoutModule {}
