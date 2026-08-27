import { Module } from '@nestjs/common';

import { StorePhoneProvider } from './store-phone-provider';
import { StoreProfileController } from './store-profile.controller';
import { StoreProfileService } from './store-profile.service';

@Module({
  controllers: [StoreProfileController],
  providers: [StorePhoneProvider, StoreProfileService],
})
export class StoreProfileModule {}
