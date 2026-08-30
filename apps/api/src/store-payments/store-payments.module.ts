import { type DynamicModule, Module } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  RedisMockPaymentProvider,
  type PaymentProviderPort,
} from '@qingxu/payment';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import {
  StoreMockPaymentsController,
  StorePaymentsController,
} from './store-payments.controller';
import { PAYMENT_PROVIDER, StorePaymentsService } from './store-payments.service';

function createPaymentProvider(config: PlatformRuntimeConfig, redis: ApiRedisClient): PaymentProviderPort {
  if (config.payment.provider !== 'MOCK' || config.payment.mockSigningKey === undefined ||
    (config.environment !== 'development' && config.environment !== 'test')) {
    return {
      close: async () => ({ outcome: 'UNKNOWN', providerIntentId: null, providerTransactionId: null,
        providerEventId: null, occurredAt: null, failureCode: 'PROVIDER_UNAVAILABLE', capability: null }),
      create: async () => ({ outcome: 'UNKNOWN', providerIntentId: null, providerTransactionId: null,
        providerEventId: null, occurredAt: null, failureCode: 'PROVIDER_UNAVAILABLE', capability: null }),
      query: async () => ({ outcome: 'UNKNOWN', providerIntentId: null, providerTransactionId: null,
        providerEventId: null, occurredAt: null, failureCode: 'PROVIDER_UNAVAILABLE', capability: null }),
      refund: async () => ({ outcome: 'UNKNOWN', providerRefundId: null, providerEventId: null,
        occurredAt: null, failureCode: 'PROVIDER_UNAVAILABLE' }),
    };
  }
  return new RedisMockPaymentProvider({
    environment: config.environment,
    signingKey: config.payment.mockSigningKey,
    timeoutMs: config.payment.providerTimeoutMs,
  }, redis);
}

@Module({})
export class StorePaymentsModule {
  static register(config: PlatformRuntimeConfig): DynamicModule {
    const exposeMockResult = config.environment === 'development' && config.payment.provider === 'MOCK';
    return {
      global: true,
      module: StorePaymentsModule,
      controllers: [StorePaymentsController, ...(exposeMockResult ? [StoreMockPaymentsController] : [])],
      providers: [
        StoreCustomerRateLimitGuard,
        StorePaymentsService,
        {
          provide: PAYMENT_PROVIDER,
          inject: [API_RUNTIME_CONFIG, API_REDIS_CLIENT],
          useFactory: createPaymentProvider,
        },
      ],
      exports: [StorePaymentsService, PAYMENT_PROVIDER],
    };
  }
}
