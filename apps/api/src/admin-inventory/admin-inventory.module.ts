import { Module } from '@nestjs/common';

import { AdminInventoryController } from './admin-inventory.controller';
import { AdminInventoryService } from './admin-inventory.service';

@Module({
  controllers: [AdminInventoryController],
  providers: [AdminInventoryService],
})
export class AdminInventoryModule {}
