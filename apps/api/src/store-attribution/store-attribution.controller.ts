import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Post, Query } from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseStoreAuthEmptyQuery, parseStoreEmptyBody } from '../store-auth/store-auth.dto';
import {
  requireStoreRequestId,
  requireStoreSession,
  StoreAuthRequest,
  storeRequestIp,
  type StoreAuthRequestContext,
} from '../store-auth/store-auth.request';
import { StoreAttributionCredentialRoute } from './store-attribution-credential.guard';
import { parseStoreAttributionCandidateBody } from './store-attribution.dto';
import {
  StoreAttributionCredential,
  type StoreAttributionCredentialContext,
} from './store-attribution.request';
import { StoreAttributionService } from './store-attribution.service';

@Controller('store')
export class StoreAttributionController {
  constructor(@Inject(StoreAttributionService) private readonly attribution: StoreAttributionService) {}

  @Post('attribution/candidates')
  @HttpCode(HttpStatus.OK)
  @StoreAttributionCredentialRoute('CREATE')
  @NoStore()
  createCandidate(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAttributionCredential() credential: StoreAttributionCredentialContext,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.attribution.createCandidate(
      credential,
      parseStoreAttributionCandidateBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Get('attribution/candidate')
  @StoreAttributionCredentialRoute('QUERY')
  @NoStore()
  getCandidate(
    @Query() query: unknown,
    @StoreAttributionCredential() credential: StoreAttributionCredentialContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.attribution.getCurrentCandidate(credential);
  }

  @Post('attribution/candidate/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('CUSTOMER')
  @NoStore()
  confirmCandidate(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.attribution.confirmCandidate(
      requireStoreSession(request),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Post('attribution/candidate/reject')
  @HttpCode(HttpStatus.OK)
  @RequireRoles('CUSTOMER')
  @NoStore()
  rejectCandidate(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.attribution.rejectCandidate(
      requireStoreSession(request),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Get('service-agent')
  @RequireRoles('CUSTOMER')
  @NoStore()
  getServiceAgent(
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.attribution.getServiceAgent(requireStoreSession(request));
  }
}
