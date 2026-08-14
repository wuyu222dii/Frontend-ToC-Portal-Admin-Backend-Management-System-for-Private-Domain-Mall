import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';

import { NoStore } from '../admin-auth/no-store.decorator';
import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import type { PrincipalRequest } from '../platform/access/principal';
import { FileAssetsService } from './files.service';
import { parseFileId, parseUploadCompleteBody, parseUploadIntentBody } from './files.dto';
import { requireFilesRequest } from './files.request';

@Controller('files')
@RequireRoles('SUPER_ADMIN')
export class FilesController {
  constructor(private readonly files: FileAssetsService) {}

  @Post('upload-intents') @HttpCode(HttpStatus.OK) @NoStore()
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

  @Post(':file_id/complete') @HttpCode(HttpStatus.OK) @NoStore()
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

  @Get(':file_id/download-url') @NoStore()
  downloadUrl(@Param('file_id') fileIdValue: string, @Req() rawRequest: PrincipalRequest) {
    return this.files.downloadUrl(requireFilesRequest(rawRequest), parseFileId(fileIdValue));
  }
}
