import { Module } from '@nestjs/common';

import { StorePrivacyController } from './store-privacy.controller';
import { StorePrivacyService } from './store-privacy.service';

@Module({
  controllers: [StorePrivacyController],
  providers: [StorePrivacyService],
})
export class StorePrivacyModule {}
