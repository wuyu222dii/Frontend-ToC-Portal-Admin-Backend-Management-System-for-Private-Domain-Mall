import {
  type INestApplication,
  Logger,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import { signStoreAccessToken } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RbacGuard } from '../platform/access/rbac.guard';
import { AuthenticationGuard } from '../platform/auth/authentication.guard';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { AccessLogMiddleware } from '../platform/http/access-log.middleware';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { RequestIdMiddleware } from '../platform/http/request-id.middleware';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import {
  StoreMockPaymentsController,
  StorePaymentsController,
} from './store-payments.controller';
import { StorePaymentsModule } from './store-payments.module';
import { StorePaymentsService } from './store-payments.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const SESSION_ID = '01J00000000000000000000003';
const SESSION_FAMILY = '01J00000000000000000000004';
const ORDER_ID = '01J00000000000000000000005';
const PAYMENT_INTENT_ID = '01J00000000000000000000006';
const ACCESS_JTI = 'access:01J00000000000000000000007';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';

const signingKeys = {
  current: { id: 'store-payment-routes-v1', key: Buffer.alloc(32, 101) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-payment-test',
    signingKeys,
  },
  encryption: { ipHashKey: Buffer.alloc(32, 102) },
  environment: 'development',
  payment: { mockSigningKey: Buffer.alloc(32, 103), provider: 'MOCK', providerTimeoutMs: 1_000 },
  store: {
    authTokenAudience: 'qingxu-store',
    customerRateLimitMax: 120,
    customerRateLimitWindowSeconds: 60,
  },
} as unknown as PlatformRuntimeConfig;

const storeToken = signStoreAccessToken({
  audience: runtimeConfig.store.authTokenAudience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId: ACCOUNT_ID,
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId: SESSION_ID,
  tokenId: ACCESS_JTI,
}, 3_600).token;

const responseView = {
  expires_at: '2099-08-29T00:30:00.000Z',
  intent_no: `PI${PAYMENT_INTENT_ID}`,
  intent_status: 'OPEN',
  last_error_code: null,
  next_reconcile_at: '2099-08-29T00:01:00.000Z',
  payment_intent_id: PAYMENT_INTENT_ID,
  provider_payload: null,
};

const createOrReuseIntent = vi.fn();
const submitMockResult = vi.fn();
const paymentService = { createOrReuseIntent, submitMockResult };
const findUnique = vi.fn();
const redisEval = vi.fn();
const database = { prisma: { authSession: { findUnique } } } as unknown as DatabaseRuntime;
const redis = { eval: redisEval, isReady: true } as unknown as ApiRedisClient;

function sessionRow() {
  return {
    access_jti: ACCESS_JTI,
    account: {
      customer_profile: { anonymized_at: null, id: CUSTOMER_ID, version: 1 },
      deleted_at: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      version: 1,
      wechat_open_id: 'mock_payment_customer',
    },
    account_id: ACCOUNT_ID,
    assurance: 'WECHAT',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: SESSION_ID,
    mfa_factor_id: null,
    mfa_verified_at: null,
    restriction: 'NONE',
    revoked_at: null,
    session_family: SESSION_FAMILY,
  };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

@Module({
  controllers: [StorePaymentsController, StoreMockPaymentsController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StorePaymentsService, useValue: paymentService },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StorePaymentsRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, AccessLogMiddleware)
      .forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B10.1 Store payment HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StorePaymentsRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    redisEval.mockResolvedValue([1, 60]);
    createOrReuseIntent.mockResolvedValue(responseView);
    submitMockResult.mockResolvedValue(responseView);
  });

  it('returns 200 no-store and passes the authenticated payment command context', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/store/orders/${ORDER_ID}/payment-intents`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('If-Match', '"3"')
      .send({})
      .expect(200);

    expect(response.body.data).toEqual(responseView);
    expect(createOrReuseIntent).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, sessionId: SESSION_ID }),
      ORDER_ID,
      3,
      IDEMPOTENCY_KEY,
      expect.stringMatching(/^req_[0-9a-f]{32}$/),
      expect.any(String),
    );
    expect(redisEval).toHaveBeenCalledOnce();
    expectNoStore(response);
  });

  it('accepts only the closed Mock result body and returns 202 no-store', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ result: 'SUCCEEDED' })
      .expect(202);
    expect(response.body.data).toEqual(responseView);
    expect(submitMockResult).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUSTOMER_ID }),
      PAYMENT_INTENT_ID,
      { result: 'SUCCEEDED' },
      IDEMPOTENCY_KEY,
      expect.stringMatching(/^req_[0-9a-f]{32}$/),
      expect.any(String),
    );
    expectNoStore(response);
  });

  it('omits customer account, profile and session identifiers from the HTTP access log', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    try {
      await request(app.getHttpServer())
        .post(`/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result`)
        .set('Authorization', `Bearer ${storeToken}`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send({ result: 'SUCCEEDED' })
        .expect(202);

      const serialized = JSON.stringify(log.mock.calls);
      expect(log.mock.calls.some(([entry]) =>
        typeof entry === 'object' && entry !== null &&
        (entry as Record<string, unknown>).actor_role === 'CUSTOMER' &&
        (entry as Record<string, unknown>).status_code === 202)).toBe(true);
      expect(serialized).not.toContain(ACCOUNT_ID);
      expect(serialized).not.toContain(CUSTOMER_ID);
      expect(serialized).not.toContain(SESSION_ID);
    } finally {
      log.mockRestore();
    }
  });

  it('rejects missing headers, open inputs and unknown fields before dispatch', async () => {
    const bearer = `Bearer ${storeToken}`;
    const probes = [
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/payment-intents`)
        .set('Authorization', bearer).set('If-Match', '"3"').send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/payment-intents`)
        .set('Authorization', bearer).set('Idempotency-Key', IDEMPOTENCY_KEY).send({}),
      () => request(app.getHttpServer())
        .post('/api/v1/store/orders/not-an-ulid/payment-intents')
        .set('Authorization', bearer).set('Idempotency-Key', IDEMPOTENCY_KEY)
        .set('If-Match', '"3"').send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/payment-intents?provider=MOCK`)
        .set('Authorization', bearer).set('Idempotency-Key', IDEMPOTENCY_KEY)
        .set('If-Match', '"3"').send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/payment-intents`)
        .set('Authorization', bearer).set('Idempotency-Key', IDEMPOTENCY_KEY)
        .set('If-Match', '"3"').send({ provider: 'MOCK' }),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result`)
        .set('Authorization', bearer).set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send({ result: 'SUCCEEDED_LATE' }),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result`)
        .set('Authorization', bearer).set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send({ result: 'SUCCEEDED', transaction_id: 'client-controlled' }),
    ];
    for (const createProbe of probes) {
      const response = await createProbe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expect(createOrReuseIntent).not.toHaveBeenCalled();
    expect(submitMockResult).not.toHaveBeenCalled();
  });

  it('keeps malformed Mock JSON no-store before guards and dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('Content-Type', 'application/json')
      .send('{"result":')
      .expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(redisEval).not.toHaveBeenCalled();
    expect(submitMockResult).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('requires authentication and fails closed with the shared limiter', async () => {
    const unauthenticated = await request(app.getHttpServer())
      .post(`/api/v1/store/orders/${ORDER_ID}/payment-intents`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('If-Match', '"3"')
      .send({})
      .expect(401);
    expect(unauthenticated.body.code).toBe('AUTH_REQUIRED');
    expectNoStore(unauthenticated);

    redisEval.mockResolvedValueOnce([121, 17]);
    const limited = await request(app.getHttpServer())
      .post(`/api/v1/store/mock-payments/${PAYMENT_INTENT_ID}/result`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send({ result: 'FAILED' })
      .expect(429);
    expect(limited.headers['retry-after']).toBe('17');
    expectNoStore(limited);
  });

  it('registers the Mock result controller only for development or test with the Mock Provider', () => {
    const development = StorePaymentsModule.register(runtimeConfig);
    const test = StorePaymentsModule.register({ ...runtimeConfig, environment: 'test' });
    const production = StorePaymentsModule.register({ ...runtimeConfig, environment: 'production' });
    const wechat = StorePaymentsModule.register({
      ...runtimeConfig,
      payment: { ...runtimeConfig.payment, provider: 'WECHAT' },
    });
    expect(development.controllers).toContain(StoreMockPaymentsController);
    expect(test.controllers).toContain(StoreMockPaymentsController);
    expect(production.controllers).not.toContain(StoreMockPaymentsController);
    expect(wechat.controllers).not.toContain(StoreMockPaymentsController);
  });
});
