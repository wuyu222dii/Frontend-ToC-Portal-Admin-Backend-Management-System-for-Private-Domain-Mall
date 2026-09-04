import { Module } from '@nestjs/common';

import { AdminWithdrawalsController } from './admin-withdrawals.controller';
import { AdminWithdrawalsService } from './admin-withdrawals.service';

@Module({ controllers: [AdminWithdrawalsController], providers: [AdminWithdrawalsService] })
export class AdminWithdrawalsModule {}
