import { Module } from '@nestjs/common';

import { FileObjectLeaseManager } from './file-object-lease';
import { FilesController } from './files.controller';
import { FileAssetsService } from './files.service';

@Module({
  controllers: [FilesController],
  providers: [FileAssetsService, FileObjectLeaseManager],
})
export class FilesModule {}
