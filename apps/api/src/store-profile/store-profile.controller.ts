import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Patch, Post, Query } from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseStoreAuthEmptyQuery,
  parseStoreEmptyBody,
} from '../store-auth/store-auth.dto';
import {
  requireStoreRequestId,
  requireStoreSession,
  StoreAuthRequest,
  storeRequestIp,
  type StoreAuthRequestContext,
} from '../store-auth/store-auth.request';
import {
  parseStorePhoneAuthorizationBody,
  parseStoreProfileUpdateBody,
} from './store-profile.dto';
import { StoreProfileService } from './store-profile.service';

@Controller('store/profile')
@RequireRoles('CUSTOMER')
export class StoreProfileController {
  constructor(@Inject(StoreProfileService) private readonly profiles: StoreProfileService) {}

  @Get()
  @NoStore()
  get(@Query() query: unknown, @StoreAuthRequest() request: StoreAuthRequestContext) {
    parseStoreAuthEmptyQuery(query);
    return this.profiles.getProfile(requireStoreSession(request));
  }

  @Patch()
  @NoStore()
  update(
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.profiles.updateProfile(
      requireStoreSession(request),
      parseStoreProfileUpdateBody(body),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Post('phone-authorizations')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  authorizePhone(
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.profiles.authorizePhone(
      requireStoreSession(request),
      parseStorePhoneAuthorizationBody(body),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Delete('phone')
  @NoStore()
  revokePhone(
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.profiles.revokePhone(
      requireStoreSession(request),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
