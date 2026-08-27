import { Module } from '@nestjs/common';

import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreCartController } from './store-cart.controller';
import { StoreCartService } from './store-cart.service';

@Module({
  controllers: [StoreCartController],
  providers: [StoreCustomerRateLimitGuard, StoreCartService],
})
export class StoreCartModule {}
