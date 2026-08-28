import { Module } from '@nestjs/common';

import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreOrdersController } from './store-orders.controller';
import { StoreOrdersService } from './store-orders.service';

@Module({
  controllers: [StoreOrdersController],
  providers: [StoreCustomerRateLimitGuard, StoreOrdersService],
})
export class StoreOrdersModule {}
