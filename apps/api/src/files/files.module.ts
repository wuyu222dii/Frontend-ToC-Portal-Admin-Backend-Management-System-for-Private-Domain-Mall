import { Module } from '@nestjs/common';

import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { FileObjectLeaseManager } from './file-object-lease';
import { FilesCustomerRateLimitGuard } from './files-customer-rate-limit.guard';
import { FilesController } from './files.controller';
import { FileAssetsService } from './files.service';

@Module({
  controllers: [FilesController],
  providers: [
    FileAssetsService,
    FileObjectLeaseManager,
    FilesCustomerRateLimitGuard,
    StoreCustomerRateLimitGuard,
  ],
})
export class FilesModule {}
