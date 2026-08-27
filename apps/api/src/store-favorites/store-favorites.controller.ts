import { Body, Controller, Delete, Get, Inject, Param, Put, Query, UseGuards } from '@nestjs/common';

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
import { parseStoreFavoriteListQuery, parseStoreFavoriteProductId } from './store-favorites.dto';
import { StoreFavoritesService } from './store-favorites.service';

@Controller('store/favorites')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreFavoritesController {
  constructor(@Inject(StoreFavoritesService) private readonly favorites: StoreFavoritesService) {}

  @Get()
  @NoStore()
  list(
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    return this.favorites.listFavorites(
      requireStoreSession(request),
      parseStoreFavoriteListQuery(query),
    );
  }

  @Get(':product_id')
  @NoStore()
  getState(
    @Param('product_id') productIdValue: string,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.favorites.getFavoriteState(
      requireStoreSession(request),
      parseStoreFavoriteProductId(productIdValue),
    );
  }

  @Put(':product_id')
  @NoStore()
  put(
    @Param('product_id') productIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.favorites.putFavorite(
      requireStoreSession(request),
      parseStoreFavoriteProductId(productIdValue),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }

  @Delete(':product_id')
  @NoStore()
  delete(
    @Param('product_id') productIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    parseStoreEmptyBody(body);
    return this.favorites.deleteFavorite(
      requireStoreSession(request),
      parseStoreFavoriteProductId(productIdValue),
      key,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
