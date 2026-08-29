import {
  Body,
  Controller,
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
  parseStoreMockPaymentResultBody,
  parseStorePaymentIntentId,
} from './store-payments.dto';
import { StorePaymentsService } from './store-payments.service';
import { parseStoreOrderId } from '../store-orders/store-orders.dto';

@Controller('store/orders')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StorePaymentsController {
  constructor(@Inject(StorePaymentsService) private readonly payments: StorePaymentsService) {}

  @Post(':order_id/payment-intents')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  createOrReuseIntent(
    @Param('order_id') orderIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreEmptyBody(body);
    parseStoreAuthEmptyQuery(query);
    return this.payments.createOrReuseIntent(
      requireStoreSession(request),
      parseStoreOrderId(orderIdValue),
      expectedVersion,
      idempotencyKey,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}

@Controller('store/mock-payments')
@RequireRoles('CUSTOMER')
@UseGuards(StoreCustomerRateLimitGuard)
export class StoreMockPaymentsController {
  constructor(@Inject(StorePaymentsService) private readonly payments: StorePaymentsService) {}

  @Post(':payment_intent_id/result')
  @HttpCode(HttpStatus.ACCEPTED)
  @NoStore()
  submitResult(
    @Param('payment_intent_id') paymentIntentIdValue: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @StoreAuthRequest() request: StoreAuthRequestContext,
  ) {
    parseStoreAuthEmptyQuery(query);
    return this.payments.submitMockResult(
      requireStoreSession(request),
      parseStorePaymentIntentId(paymentIntentIdValue),
      parseStoreMockPaymentResultBody(body),
      idempotencyKey,
      requireStoreRequestId(request),
      storeRequestIp(request),
    );
  }
}
