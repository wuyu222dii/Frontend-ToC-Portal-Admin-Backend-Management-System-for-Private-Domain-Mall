import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseStoreAuthEmptyQuery } from '../store-auth/store-auth.dto';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import {
  requireStoreRequestId,
  requireStoreSession,
  StoreAuthRequest,
  storeRequestIp,
  type StoreAuthRequestContext,
} from '../store-auth/store-auth.request';
import { parseStoreOrderSubmitBody } from './store-orders.dto';
import { StoreOrdersService } from './store-orders.service';

@Controller('store/orders')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreOrdersController {
  constructor(@Inject(StoreOrdersService) private readonly orders: StoreOrdersService) {}

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
}
