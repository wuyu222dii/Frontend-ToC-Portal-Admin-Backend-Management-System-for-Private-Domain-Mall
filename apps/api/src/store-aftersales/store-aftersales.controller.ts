import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseStoreAuthEmptyQuery, parseStoreEmptyBody } from '../store-auth/store-auth.dto';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import {
  requireStoreRequestId,
  requireStoreSession,
  StoreAuthRequest,
  storeRequestIp,
  type StoreAuthRequestContext,
} from '../store-auth/store-auth.request';
import {
  parseStoreAftersaleCancelBody,
  parseStoreAftersaleCreateBody,
  parseStoreAftersaleId,
  parseStoreAftersaleListQuery,
  parseStoreAftersaleReturnShipmentBody,
} from './store-aftersales.dto';
import {
  STORE_AFTERSALE_HTTP_STATUS,
  StoreAftersalesService,
} from './store-aftersales.service';

type HttpResponse = { status(code: number): HttpResponse };

@Controller('store/aftersales')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreAftersalesController {
  constructor(@Inject(StoreAftersalesService) private readonly aftersales: StoreAftersalesService) {}

  @Get()
  @NoStore()
  list(
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    return this.aftersales.listAftersales(
      requireStoreSession(request),
      parseStoreAftersaleListQuery(query),
    );
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @NoStore()
  async create(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
    @Res({ passthrough: true }) response: HttpResponse,
  ) {
    parseStoreAuthEmptyQuery(query);
    const result = await this.aftersales.createAftersale(
      requireStoreSession(request),
      parseStoreAftersaleCreateBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
    if ((result as Record<string | symbol, unknown>)[STORE_AFTERSALE_HTTP_STATUS] === HttpStatus.CREATED) {
      response.status(HttpStatus.CREATED);
    }
    return result;
  }

  @Get(':aftersale_id')
  @NoStore()
  get(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    parseStoreAuthEmptyQuery(query);
    return this.aftersales.getAftersale(
      requireStoreSession(request),
      parseStoreAftersaleId(aftersaleIdValue),
    );
  }

  @Post(':aftersale_id/cancel')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  cancel(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.aftersales.cancelAftersale(
      requireStoreSession(request),
      parseStoreAftersaleId(aftersaleIdValue),
      parseStoreAftersaleCancelBody(body),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Post(':aftersale_id/return-shipment')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  submitReturnShipment(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.aftersales.submitReturnShipment(
      requireStoreSession(request),
      parseStoreAftersaleId(aftersaleIdValue),
      parseStoreAftersaleReturnShipmentBody(body),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
