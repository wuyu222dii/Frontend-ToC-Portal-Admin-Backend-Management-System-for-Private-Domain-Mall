import { Module } from '@nestjs/common';

import { StoreCatalogController } from './store-catalog.controller';
import { StoreCatalogRateLimitGuard } from './store-catalog-rate-limit.guard';
import { StoreCatalogService } from './store-catalog.service';

@Module({
  controllers: [StoreCatalogController],
  providers: [StoreCatalogRateLimitGuard, StoreCatalogService],
})
export class StoreCatalogModule {}
