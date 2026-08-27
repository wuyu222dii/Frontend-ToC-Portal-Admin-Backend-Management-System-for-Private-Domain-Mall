import { Module } from '@nestjs/common';

import { StoreAttributionCredentialGuard } from './store-attribution-credential.guard';
import { StoreAttributionController } from './store-attribution.controller';
import { StoreAttributionService } from './store-attribution.service';

@Module({
  controllers: [StoreAttributionController],
  providers: [StoreAttributionCredentialGuard, StoreAttributionService],
})
export class StoreAttributionModule {}
