import { Body, Controller, HttpCode, Inject, Post, Query, UseGuards } from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseStoreAuthEmptyQuery } from '../store-auth/store-auth.dto';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import {
  requireStoreSession,
  StoreAuthRequest,
  type StoreAuthRequestContext,
} from '../store-auth/store-auth.request';
import { parseStoreCheckoutQuoteBody } from './store-checkout.dto';
import { StoreCheckoutService } from './store-checkout.service';

@Controller('store/checkout')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreCheckoutController {
  constructor(@Inject(StoreCheckoutService) private readonly checkout: StoreCheckoutService) {}

  @Post('quotes')
  @HttpCode(200)
  @NoStore()
  quote(
    @Body() body: unknown,
    @Query() query: unknown,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.checkout.quote(requireStoreSession(request), parseStoreCheckoutQuoteBody(body));
  }
}
