import { Module } from '@nestjs/common';

import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreAddressController } from './store-address.controller';
import { StoreAddressService } from './store-address.service';

@Module({
  controllers: [StoreAddressController],
  providers: [StoreCustomerRateLimitGuard, StoreAddressService],
})
export class StoreAddressModule {}
