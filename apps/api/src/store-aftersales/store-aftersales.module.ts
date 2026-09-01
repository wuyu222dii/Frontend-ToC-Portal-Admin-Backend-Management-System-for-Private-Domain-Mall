import { Module } from '@nestjs/common';

import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreAftersalesController } from './store-aftersales.controller';
import { StoreAftersalesService } from './store-aftersales.service';

@Module({
  controllers: [StoreAftersalesController],
  providers: [StoreCustomerRateLimitGuard, StoreAftersalesService],
})
export class StoreAftersalesModule {}
