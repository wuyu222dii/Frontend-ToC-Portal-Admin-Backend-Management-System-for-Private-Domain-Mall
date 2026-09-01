import { type DynamicModule, Module } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminRefundRepository,
  AuditRepository,
  CallbackInboxRepository,
  FILE_STAGING_CLEANUP_EVENT_TYPE,
  FileAssetRepository,
  OutboxRepository,
  StoreOrderRepository,
  StorePaymentRepository,
} from '@qingxu/database';
import {
  RedisMockPaymentProvider,
  type PaymentProviderPort,
  type PaymentRefundQueryPort,
} from '@qingxu/payment';
import { createS3ObjectStorage } from '@qingxu/storage';
import { createClient } from 'redis';

import {
  DATABASE_RUNTIME,
  WorkerDatabaseLifecycleService,
  createWorkerDatabaseRuntime,
} from './database-runtime.provider';
import {
  FILE_CLEANUP_REPOSITORY,
  FILE_CLEANUP_AUDIT_REPOSITORY,
  FILE_OBJECT_STORAGE,
  FileCleanupService,
  WORKER_REDIS_CLIENT,
  type WorkerRedisClient,
} from './file-cleanup.service';
import {
  CALLBACK_INBOX_REPOSITORY,
  OUTBOX_REPOSITORY,
  OutboxDispatcherService,
  WORKER_CONFIG,
  WORKER_HANDLER_REGISTRY,
  type WorkerHandlerRegistry,
} from './outbox-dispatcher.service';
import {
  PAYMENT_CALLBACK_AUDIT_REPOSITORY,
  PAYMENT_CALLBACK_PAYMENT_PROVIDER,
  PAYMENT_CALLBACK_REPOSITORY,
  PaymentCallbackService,
} from './payment-callback.service';
import {
  REFUND_PROCESSING_AUDIT_REPOSITORY,
  REFUND_PROCESSING_PAYMENT_PROVIDER,
  REFUND_PROCESSING_REPOSITORY,
  RefundProcessingService,
} from './refund-processing.service';
import {
  ORDER_TIMEOUT_AUDIT_REPOSITORY,
  ORDER_TIMEOUT_PAYMENT_PROVIDER,
  ORDER_TIMEOUT_REPOSITORY,
  OrderTimeoutService,
} from './order-timeout.service';
import { WorkerController } from './worker.controller';

export function workerRedisReconnectDelay(retries: number): number {
  return Math.min(100 * 2 ** Math.min(retries, 5), 5_000);
}

function unavailablePaymentProvider(): PaymentProviderPort & PaymentRefundQueryPort {
  return {
    close: async () => ({
      capability: null,
      failureCode: 'PROVIDER_UNAVAILABLE' as const,
      occurredAt: null,
      outcome: 'UNKNOWN' as const,
      providerEventId: null,
      providerIntentId: null,
      providerTransactionId: null,
    }),
    create: async () => ({
      capability: null,
      failureCode: 'PROVIDER_UNAVAILABLE' as const,
      occurredAt: null,
      outcome: 'UNKNOWN' as const,
      providerEventId: null,
      providerIntentId: null,
      providerTransactionId: null,
    }),
    query: async () => ({
      capability: null,
      failureCode: 'PROVIDER_UNAVAILABLE' as const,
      occurredAt: null,
      outcome: 'UNKNOWN' as const,
      providerEventId: null,
      providerIntentId: null,
      providerTransactionId: null,
    }),
    queryRefund: async () => ({
      failureCode: 'PROVIDER_UNAVAILABLE' as const,
      occurredAt: null,
      outcome: 'UNKNOWN' as const,
      providerEventId: null,
      providerRefundId: null,
    }),
    refund: async () => ({
      failureCode: 'PROVIDER_UNAVAILABLE' as const,
      occurredAt: null,
      outcome: 'UNKNOWN' as const,
      providerEventId: null,
      providerRefundId: null,
    }),
  };
}

export function createWorkerPaymentProvider(
  config: PlatformRuntimeConfig,
  redis: WorkerRedisClient,
): PaymentProviderPort & PaymentRefundQueryPort {
  if ((config.environment === 'development' || config.environment === 'test') &&
    config.payment.provider === 'MOCK' && config.payment.mockSigningKey !== undefined) {
    return new RedisMockPaymentProvider({
      environment: config.environment,
      signingKey: config.payment.mockSigningKey,
      timeoutMs: config.payment.providerTimeoutMs,
    }, redis);
  }
  // Production/WECHAT is deliberately fail-closed until the dedicated
  // provider implementation and credentials are introduced in staging.
  return unavailablePaymentProvider();
}

export function mergeRefundProcessingHandlers(
  config: PlatformRuntimeConfig,
  registry: WorkerHandlerRegistry,
  refunds: RefundProcessingService,
): WorkerHandlerRegistry {
  const enabled = (config.environment === 'development' || config.environment === 'test') &&
    config.payment.provider === 'MOCK' && config.payment.mockSigningKey !== undefined;
  if (!enabled) return registry;
  const registrations = refunds.registrations();
  return {
    callbacks: [...registry.callbacks, ...registrations.callbacks],
    outbox: [...registry.outbox, ...registrations.outbox],
  };
}

export function mergePaymentCallbackHandlers(
  config: PlatformRuntimeConfig,
  registry: WorkerHandlerRegistry,
  paymentCallbacks: PaymentCallbackService,
): WorkerHandlerRegistry {
  const enabled = (config.environment === 'development' || config.environment === 'test') &&
    config.payment.provider === 'MOCK' && config.payment.mockSigningKey !== undefined;
  return {
    callbacks: [
      ...registry.callbacks,
      ...(enabled ? paymentCallbacks.registrations() : []),
    ],
    outbox: [...registry.outbox],
  };
}

@Module({
  controllers: [WorkerController],
})
export class WorkerModule {
  static register(
    config: PlatformRuntimeConfig,
    registry: WorkerHandlerRegistry,
  ): DynamicModule {
    if (registry.outbox.some(({ eventType }) => eventType === FILE_STAGING_CLEANUP_EVENT_TYPE)) {
      throw new Error(`${FILE_STAGING_CLEANUP_EVENT_TYPE} is owned by FileCleanupService`);
    }
    return {
      module: WorkerModule,
      providers: [
        { provide: WORKER_CONFIG, useValue: config },
        {
          provide: DATABASE_RUNTIME,
          inject: [WORKER_CONFIG],
          useFactory: createWorkerDatabaseRuntime,
        },
        {
          provide: WorkerDatabaseLifecycleService,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) =>
            new WorkerDatabaseLifecycleService(database),
        },
        {
          provide: OUTBOX_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) => new OutboxRepository(database),
        },
        {
          provide: CALLBACK_INBOX_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) => new CallbackInboxRepository(database),
        },
        {
          provide: PAYMENT_CALLBACK_REPOSITORY,
          useFactory: () => new StorePaymentRepository(),
        },
        {
          provide: PAYMENT_CALLBACK_AUDIT_REPOSITORY,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) =>
            new AuditRepository(runtimeConfig.encryption.ipHashKey),
        },
        {
          provide: PAYMENT_CALLBACK_PAYMENT_PROVIDER,
          useExisting: ORDER_TIMEOUT_PAYMENT_PROVIDER,
        },
        PaymentCallbackService,
        {
          provide: REFUND_PROCESSING_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) =>
            new AdminRefundRepository(database.prisma),
        },
        {
          provide: REFUND_PROCESSING_AUDIT_REPOSITORY,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) =>
            new AuditRepository(runtimeConfig.encryption.ipHashKey),
        },
        {
          provide: REFUND_PROCESSING_PAYMENT_PROVIDER,
          useExisting: ORDER_TIMEOUT_PAYMENT_PROVIDER,
        },
        RefundProcessingService,
        {
          provide: WORKER_HANDLER_REGISTRY,
          inject: [WORKER_CONFIG, PaymentCallbackService, RefundProcessingService],
          useFactory: (
            runtimeConfig: PlatformRuntimeConfig,
            paymentCallbacks: PaymentCallbackService,
            refundProcessing: RefundProcessingService,
          ) => mergeRefundProcessingHandlers(
            runtimeConfig,
            mergePaymentCallbackHandlers(runtimeConfig, registry, paymentCallbacks),
            refundProcessing,
          ),
        },
        {
          provide: ORDER_TIMEOUT_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) =>
            new StoreOrderRepository(database.prisma),
        },
        {
          provide: ORDER_TIMEOUT_AUDIT_REPOSITORY,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) =>
            new AuditRepository(runtimeConfig.encryption.ipHashKey),
        },
        {
          provide: FILE_CLEANUP_REPOSITORY,
          inject: [DATABASE_RUNTIME],
          useFactory: (database: ReturnType<typeof createWorkerDatabaseRuntime>) =>
            new FileAssetRepository(database.prisma),
        },
        {
          provide: FILE_CLEANUP_AUDIT_REPOSITORY,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) =>
            new AuditRepository(runtimeConfig.encryption.ipHashKey),
        },
        {
          provide: FILE_OBJECT_STORAGE,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) => createS3ObjectStorage(runtimeConfig.storage),
        },
        {
          provide: WORKER_REDIS_CLIENT,
          inject: [WORKER_CONFIG],
          useFactory: (runtimeConfig: PlatformRuntimeConfig) => createClient({
            url: runtimeConfig.redis.url,
            socket: {
              connectTimeout: runtimeConfig.database.connectionTimeoutMs,
              reconnectStrategy: workerRedisReconnectDelay,
            },
          }),
        },
        {
          provide: ORDER_TIMEOUT_PAYMENT_PROVIDER,
          inject: [WORKER_CONFIG, WORKER_REDIS_CLIENT],
          useFactory: createWorkerPaymentProvider,
        },
        OutboxDispatcherService,
        FileCleanupService,
        OrderTimeoutService,
      ],
    };
  }
}
