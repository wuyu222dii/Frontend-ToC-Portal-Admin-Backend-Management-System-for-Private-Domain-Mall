import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseStoreAuthEmptyQuery } from '../store-auth/store-auth.dto';
import {
  requireStoreRequestId,
  requireStoreSession,
  StoreAuthRequest,
  storeRequestIp,
  type StoreAuthRequestContext,
} from '../store-auth/store-auth.request';
import {
  parseStoreDeletionConfirmBody,
  parseStoreDeletionPreviewBody,
} from './store-privacy.dto';
import { StorePrivacyService } from './store-privacy.service';

@Controller('store/privacy/deletion-requests')
@RequireRoles('CUSTOMER')
export class StorePrivacyController {
  constructor(@Inject(StorePrivacyService) private readonly privacy: StorePrivacyService) {}

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  preview(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.privacy.previewDeletion(
      requireStoreSession(request),
      parseStoreDeletionPreviewBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @NoStore()
  confirm(
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.privacy.confirmDeletion(
      requireStoreSession(request),
      parseStoreDeletionConfirmBody(body),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
