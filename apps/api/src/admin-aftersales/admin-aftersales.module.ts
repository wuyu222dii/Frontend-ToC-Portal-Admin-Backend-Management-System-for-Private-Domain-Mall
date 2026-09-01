import { Module } from '@nestjs/common';

import {
  AdminAftersalesController,
  AdminReturnAddressController,
} from './admin-aftersales.controller';
import { AdminAftersalesService } from './admin-aftersales.service';

@Module({
  controllers: [AdminAftersalesController, AdminReturnAddressController],
  providers: [AdminAftersalesService],
})
export class AdminAftersalesModule {}
