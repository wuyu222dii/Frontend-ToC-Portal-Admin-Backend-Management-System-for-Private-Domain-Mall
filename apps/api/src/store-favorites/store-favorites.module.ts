import { Module } from '@nestjs/common';

import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreFavoritesController } from './store-favorites.controller';
import { StoreFavoritesService } from './store-favorites.service';

@Module({
  controllers: [StoreFavoritesController],
  providers: [StoreCustomerRateLimitGuard, StoreFavoritesService],
})
export class StoreFavoritesModule {}
