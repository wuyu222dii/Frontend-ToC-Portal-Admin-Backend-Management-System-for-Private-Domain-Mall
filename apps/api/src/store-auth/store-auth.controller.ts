import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query, UseGuards } from '@nestjs/common';

import { RequireRoles, Public } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseStoreAuthEmptyQuery,
  parseStoreEmptyBody,
  parseStoreRefreshBody,
  parseStoreWechatLoginBody,
} from './store-auth.dto';
import { StoreAuthRateLimit, StoreAuthRateLimitGuard } from './store-auth-rate-limit.guard';
import {
  requireStoreRequestId,
  requireStoreSession,
  StoreAuthRequest,
  storeRequestIp,
  type StoreAuthRequestContext,
} from './store-auth.request';
import { StoreAuthService } from './store-auth.service';

@Controller('store')
export class StoreAuthController {
  constructor(@Inject(StoreAuthService) private readonly auth: StoreAuthService) {}

  @Get('legal-documents') @Public() @NoStore()
  @UseGuards(StoreAuthRateLimitGuard) @StoreAuthRateLimit('LEGAL')
  legalDocuments(@Query() query: unknown) {
    parseStoreAuthEmptyQuery(query);
    return this.auth.legalDocuments();
  }

  @Post('auth/wechat/login') @HttpCode(HttpStatus.OK) @Public() @NoStore()
  @UseGuards(StoreAuthRateLimitGuard) @StoreAuthRateLimit('LOGIN')
  login(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.auth.login(
      parseStoreWechatLoginBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Post('auth/refresh') @HttpCode(HttpStatus.OK) @Public() @NoStore()
  refresh(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.auth.refresh(
      parseStoreRefreshBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Post('auth/logout') @HttpCode(HttpStatus.OK) @RequireRoles('CUSTOMER') @NoStore()
  logout(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.auth.logout(
      requireStoreSession(request),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
