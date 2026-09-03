import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import { NoStore } from '../admin-auth/no-store.decorator';
import { RequireCustomerOrSuperAdmin } from '../platform/auth/customer-or-super-admin.metadata';
import { RequireFileDownloadAuthentication } from '../platform/auth/file-download-realm.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import type { PrincipalRequest } from '../platform/access/principal';
import { FilesCustomerRateLimitGuard } from './files-customer-rate-limit.guard';
import { FileAssetsService } from './files.service';
import { parseFileId, parseUploadCompleteBody, parseUploadIntentBody } from './files.dto';
import { requireFilesRequest } from './files.request';

@Controller('files')
@UseGuards(FilesCustomerRateLimitGuard)
export class FilesController {
  constructor(@Inject(FileAssetsService) private readonly files: FileAssetsService) {}

  @Post('upload-intents') @HttpCode(HttpStatus.OK) @NoStore() @RequireCustomerOrSuperAdmin()
  createUploadIntent(
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.files.createUploadIntent(
      requireFilesRequest(rawRequest),
      parseUploadIntentBody(body),
      idempotencyKey,
    );
  }

  @Post(':file_id/complete') @HttpCode(HttpStatus.OK) @NoStore() @RequireCustomerOrSuperAdmin()
  completeUpload(
    @Param('file_id') fileIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.files.completeUpload(
      requireFilesRequest(rawRequest),
      parseFileId(fileIdValue),
      parseUploadCompleteBody(body),
      idempotencyKey,
    );
  }

  @Get(':file_id/download-url') @NoStore() @RequireFileDownloadAuthentication()
  downloadUrl(@Param('file_id') fileIdValue: string, @Req() rawRequest: PrincipalRequest) {
    return this.files.downloadUrl(requireFilesRequest(rawRequest), parseFileId(fileIdValue));
  }
}
