import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
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
  parseStoreCartItemWriteBody,
  parseStoreCartMergeBody,
  parseStoreCartSkuId,
} from './store-cart.dto';
import { StoreCartService } from './store-cart.service';

@Controller('store/cart')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreCartController {
  constructor(@Inject(StoreCartService) private readonly cart: StoreCartService) {}

  @Get()
  @NoStore()
  get(
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    parseStoreAuthEmptyQuery(query);
    return this.cart.getCart(requireStoreSession(request));
  }

  @Put('items/:sku_id')
  @NoStore()
  putItem(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.cart.putItem(
      requireStoreSession(request),
      parseStoreCartSkuId(skuIdValue),
      parseStoreCartItemWriteBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Delete('items/:sku_id')
  @NoStore()
  deleteItem(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.cart.deleteItem(
      requireStoreSession(request),
      parseStoreCartSkuId(skuIdValue),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Post('merge')
  @HttpCode(200)
  @NoStore()
  merge(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.cart.mergeCart(
      requireStoreSession(request),
      parseStoreCartMergeBody(body),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
