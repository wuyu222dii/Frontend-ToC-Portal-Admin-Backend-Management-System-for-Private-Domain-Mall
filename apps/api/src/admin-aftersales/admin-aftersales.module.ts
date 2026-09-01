import { Module } from '@nestjs/common';

import {
  AdminAftersalesController,
  AdminReturnAddressController,
} from './admin-aftersales.controller';
import { AdminAftersalesService } from './admin-aftersales.service';
import {
  AdminAftersaleRefundsController,
  AdminManualCompensationsController,
  AdminRefundsController,
} from './admin-refunds.controller';
import { AdminRefundsService } from './admin-refunds.service';

@Module({
  controllers: [
    AdminAftersalesController,
    AdminReturnAddressController,
    AdminAftersaleRefundsController,
    AdminRefundsController,
    AdminManualCompensationsController,
  ],
  providers: [AdminAftersalesService, AdminRefundsService],
})
export class AdminAftersalesModule {}
