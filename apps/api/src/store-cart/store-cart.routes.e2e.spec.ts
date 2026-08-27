import {
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import { signAccessToken, signStoreAccessToken } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { RbacGuard } from '../platform/access/rbac.guard';
import { AuthenticationGuard } from '../platform/auth/authentication.guard';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { RequestIdMiddleware } from '../platform/http/request-id.middleware';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreCartController } from './store-cart.controller';
import { StoreCartService } from './store-cart.service';

const accountId = '01J00000000000000000000000';
const customerId = '01J00000000000000000000001';
const sessionId = '01J00000000000000000000002';
const sessionFamily = '01J00000000000000000000003';
const skuId = '01J00000000000000000000004';
const secondSkuId = '01J00000000000000000000005';
const productId = '01J00000000000000000000006';
const cartId = '01J00000000000000000000007';
const accessJti = 'access:01J00000000000000000000008';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'trace_0123456789abcdef0123456789abcdef';

const signingKeys = {
  current: { id: 'store-cart-route-v1', key: Buffer.alloc(32, 71) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-cart-test',
    signingKeys,
  },
  encryption: { ipHashKey: Buffer.alloc(32, 72) },
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
  accountId,
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId,
  tokenId: accessJti,
}, 3_600).token;

const adminToken = signAccessToken({
  audience: runtimeConfig.authentication.audience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId,
  assurance: 'MFA',
  permissions: [],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId,
  tokenId: 'access:01J00000000000000000000009',
}, 3_600).token;

const customerBearer = `Bearer ${storeToken}`;
const adminBearer = `Bearer ${adminToken}`;
const cart = {
  cart_id: cartId,
  items: [{
    available_stock: 8,
    primary_image_url: null,
    product_id: productId,
    product_name: 'Daily Cleanser',
    quantity: 2,
    retail_price: '12.50',
    sale_status: 'SALEABLE',
    selected: true,
    sku_id: skuId,
    sku_name: 'Standard',
    spec_json: null,
  }],
  total_amount: '25.00',
};

const getCart = vi.fn();
const putItem = vi.fn();
const deleteItem = vi.fn();
const mergeCart = vi.fn();
const cartService = { deleteItem, getCart, mergeCart, putItem };
const findUnique = vi.fn();
const redisEval = vi.fn();

const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;
const redis = {
  eval: redisEval,
  isReady: true,
} as unknown as ApiRedisClient;

function sessionRow() {
  return {
    access_jti: accessJti,
    account: {
      customer_profile: { anonymized_at: null, id: customerId, version: 3 },
      deleted_at: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      version: 4,
      wechat_open_id: 'mock_cart_customer',
    },
    account_id: accountId,
    assurance: 'WECHAT',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: sessionId,
    mfa_factor_id: null,
    mfa_verified_at: null,
    restriction: 'NONE',
    revoked_at: null,
    session_family: sessionFamily,
  };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoServiceDispatch(): void {
  expect(getCart).not.toHaveBeenCalled();
  expect(putItem).not.toHaveBeenCalled();
  expect(deleteItem).not.toHaveBeenCalled();
  expect(mergeCart).not.toHaveBeenCalled();
}

@Module({
  controllers: [StoreCartController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StoreCartService, useValue: cartService },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreCartRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B8.2 Store cart HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreCartRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    redisEval.mockResolvedValue([1, 60]);
    getCart.mockResolvedValue(cart);
    putItem.mockResolvedValue(cart);
    deleteItem.mockResolvedValue(cart);
    mergeCart.mockResolvedValue(cart);
  });

  afterAll(async () => app.close());

  it('maps all four CUSTOMER endpoints through the real guards and common envelope', async () => {
    const fetched = await request(app.getHttpServer())
      .get('/api/v1/store/cart')
      .set('Authorization', customerBearer)
      .set('X-Request-Id', requestId)
      .expect(200);
    expect(getCart).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
    );
    expect(fetched.body).toEqual({ code: 'OK', data: cart, message: 'success', request_id: requestId });
    expectNoStore(fetched);

    const written = await request(app.getHttpServer())
      .put(`/api/v1/store/cart/items/${skuId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send({ quantity: 2, selected: false })
      .expect(200);
    expect(putItem).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      skuId,
      { quantity: 2, selected: false },
      key,
      requestId,
      expect.any(String),
    );
    expect(written.body.data).toEqual(cart);
    expectNoStore(written);

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/store/cart/items/${skuId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send({})
      .expect(200);
    expect(deleteItem).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      skuId,
      key,
      requestId,
      expect.any(String),
    );
    expect(removed.body.data).toEqual(cart);
    expectNoStore(removed);

    const merged = await request(app.getHttpServer())
      .post('/api/v1/store/cart/merge')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send({ items: [{ quantity: 1, selected: true, sku_id: secondSkuId }] })
      .expect(200);
    expect(mergeCart).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      { items: [{ quantity: 1, selected: true, skuId: secondSkuId }] },
      key,
      requestId,
      expect.any(String),
    );
    expect(merged.body.data).toEqual(cart);
    expectNoStore(merged);

    expect(redisEval).toHaveBeenCalledTimes(4);
    const keys = redisEval.mock.calls.map((call) => (call[1] as { keys: string[] }).keys[0]);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^qingxu:store-customer:rate-limit:subject:[a-f0-9]{64}$/);
    expect(JSON.stringify(redisEval.mock.calls)).not.toContain(customerId);
  });

  it('rejects unknown query/body fields, invalid SKU values and duplicate merge items', async () => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/cart?expand=items'),
      () => request(app.getHttpServer()).get('/api/v1/store/cart').send({ expand: true }),
      () => request(app.getHttpServer())
        .put(`/api/v1/store/cart/items/${skuId}?force=true`)
        .set('Idempotency-Key', key)
        .send({ quantity: 1, selected: true }),
      () => request(app.getHttpServer())
        .put('/api/v1/store/cart/items/not-an-ulid')
        .set('Idempotency-Key', key)
        .send({ quantity: 1, selected: true }),
      () => request(app.getHttpServer())
        .put(`/api/v1/store/cart/items/${skuId}`)
        .set('Idempotency-Key', key)
        .send({ quantity: 0, selected: true }),
      () => request(app.getHttpServer())
        .put(`/api/v1/store/cart/items/${skuId}`)
        .set('Idempotency-Key', key)
        .send({ quantity: 1, selected: true, version: 1 }),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/cart/items/${skuId}`)
        .set('Idempotency-Key', key)
        .send({ force: true }),
      () => request(app.getHttpServer())
        .post('/api/v1/store/cart/merge')
        .set('Idempotency-Key', key)
        .send({ items: [
          { quantity: 1, selected: true, sku_id: skuId },
          { quantity: 2, selected: false, sku_id: skuId },
        ] }),
    ];

    for (const createProbe of probes) {
      const response = await createProbe().set('Authorization', customerBearer).expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoServiceDispatch();
  });

  it('requires a valid UUID Idempotency-Key on every mutation', async () => {
    const probes = [
      () => request(app.getHttpServer())
        .put(`/api/v1/store/cart/items/${skuId}`)
        .send({ quantity: 1, selected: true }),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/cart/items/${skuId}`)
        .set('Idempotency-Key', 'not-a-uuid')
        .send({}),
      () => request(app.getHttpServer())
        .post('/api/v1/store/cart/merge')
        .send({ items: [{ quantity: 1, selected: true, sku_id: skuId }] }),
    ];

    for (const createProbe of probes) {
      const response = await createProbe().set('Authorization', customerBearer).expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expect(putItem).not.toHaveBeenCalled();
    expect(deleteItem).not.toHaveBeenCalled();
    expect(mergeCart).not.toHaveBeenCalled();
  });

  it('keeps malformed JSON no-store before guard or service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/cart/merge')
      .set('Authorization', customerBearer)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send('{"items":')
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(redisEval).not.toHaveBeenCalled();
    expectNoServiceDispatch();
    expectNoStore(response);
  });

  it.each([
    ['missing Store bearer', undefined],
    ['Admin realm bearer', adminBearer],
  ] as const)('rejects %s on all endpoints before rate or service dispatch', async (_label, bearer) => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/cart'),
      () => request(app.getHttpServer())
        .put(`/api/v1/store/cart/items/${skuId}`)
        .set('Idempotency-Key', key)
        .send({ quantity: 1, selected: true }),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/cart/items/${skuId}`)
        .set('Idempotency-Key', key)
        .send({}),
      () => request(app.getHttpServer())
        .post('/api/v1/store/cart/merge')
        .set('Idempotency-Key', key)
        .send({ items: [{ quantity: 1, selected: true, sku_id: skuId }] }),
    ];

    for (const createProbe of probes) {
      const probe = createProbe();
      if (bearer !== undefined) probe.set('Authorization', bearer);
      const response = await probe.expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expectNoStore(response);
    }
    expect(findUnique).not.toHaveBeenCalled();
    expect(redisEval).not.toHaveBeenCalled();
    expectNoServiceDispatch();
  });

  it('uses the shared guard exact Retry-After and rejects before service dispatch', async () => {
    redisEval.mockResolvedValueOnce([121, 17]);
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/cart')
      .set('Authorization', customerBearer)
      .expect(429);

    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('17');
    expectNoStore(response);
    expectNoServiceDispatch();
  });
});
