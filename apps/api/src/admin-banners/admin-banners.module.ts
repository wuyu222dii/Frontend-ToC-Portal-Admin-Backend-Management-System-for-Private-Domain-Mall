import { Module } from '@nestjs/common';

import { AdminBannersController } from './admin-banners.controller';
import { AdminBannersService } from './admin-banners.service';

@Module({
  controllers: [AdminBannersController],
  providers: [AdminBannersService],
})
export class AdminBannersModule {}
