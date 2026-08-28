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
  parseStoreOrderId,
  parseStoreOrderListQuery,
  parseStoreOrderSubmitBody,
} from './store-orders.dto';
import { StoreOrdersService } from './store-orders.service';

@Controller('store/orders')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreOrdersController {
  constructor(@Inject(StoreOrdersService) private readonly orders: StoreOrdersService) {}

  @Get()
  @NoStore()
  list(
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    return this.orders.listOrders(
      requireStoreSession(request),
      parseStoreOrderListQuery(query),
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @NoStore()
  create(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.orders.createOrder(
      requireStoreSession(request),
      parseStoreOrderSubmitBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Get(':order_id')
  @NoStore()
  get(
    @Param('order_id') orderIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    parseStoreAuthEmptyQuery(query);
    return this.orders.getOrder(
      requireStoreSession(request),
      parseStoreOrderId(orderIdValue),
    );
  }

  @Post(':order_id/cancel')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  cancel(
    @Param('order_id') orderIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    parseStoreAuthEmptyQuery(query);
    return this.orders.cancelOrder(
      requireStoreSession(request),
      parseStoreOrderId(orderIdValue),
      expectedVersion,
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
