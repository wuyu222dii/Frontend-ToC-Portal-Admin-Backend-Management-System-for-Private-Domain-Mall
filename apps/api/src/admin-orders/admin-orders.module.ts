import { Module } from '@nestjs/common';

import { AdminOrdersController, AdminShipmentsController } from './admin-orders.controller';
import { AdminOrdersService } from './admin-orders.service';

@Module({
  controllers: [AdminOrdersController, AdminShipmentsController],
  providers: [AdminOrdersService],
})
export class AdminOrdersModule {}
