import { Module } from '@nestjs/common';

import { AdminCommissionsController } from './admin-commissions.controller';
import { AdminCommissionsService } from './admin-commissions.service';

@Module({ controllers: [AdminCommissionsController], providers: [AdminCommissionsService] })
export class AdminCommissionsModule {}
