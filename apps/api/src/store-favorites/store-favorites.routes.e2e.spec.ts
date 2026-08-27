import {
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import { signAccessToken, signStoreAccessToken } from '@qingxu/platform-core';
import { Test } from '@nestjs/testing';
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
import {
  API_REDIS_CLIENT,
  type ApiRedisClient,
} from '../platform/redis/api-redis-runtime';
import { StoreCustomerRateLimitGuard } from '../store-auth/store-customer-rate-limit.guard';
import { StoreFavoritesController } from './store-favorites.controller';
import { StoreFavoritesService } from './store-favorites.service';

const accountId = '01J00000000000000000000000';
const customerId = '01J00000000000000000000001';
const sessionId = '01J00000000000000000000002';
const sessionFamily = '01J00000000000000000000003';
const productId = '01J00000000000000000000004';
const accessJti = 'access:01J00000000000000000000005';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'trace_0123456789abcdef0123456789abcdef';

const signingKeys = {
  current: { id: 'store-favorites-route-v1', key: Buffer.alloc(32, 61) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-favorites-test',
    signingKeys,
  },
  encryption: { ipHashKey: Buffer.alloc(32, 62) },
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
  tokenId: 'access:01J00000000000000000000006',
}, 3_600).token;

const customerBearer = `Bearer ${storeToken}`;
const adminBearer = `Bearer ${adminToken}`;
const favoriteList = {
  items: [],
  pagination: { page: 2, page_size: 100, total: 0 },
};
const favoriteState = { is_favorite: true, product_id: productId };
const removedState = { is_favorite: false, product_id: productId };

const listFavorites = vi.fn();
const getFavoriteState = vi.fn();
const putFavorite = vi.fn();
const deleteFavorite = vi.fn();
const favoritesService = { deleteFavorite, getFavoriteState, listFavorites, putFavorite };
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
      wechat_open_id: 'mock_favorites_customer',
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
  expect(listFavorites).not.toHaveBeenCalled();
  expect(getFavoriteState).not.toHaveBeenCalled();
  expect(putFavorite).not.toHaveBeenCalled();
  expect(deleteFavorite).not.toHaveBeenCalled();
}

@Module({
  controllers: [StoreFavoritesController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StoreFavoritesService, useValue: favoritesService },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreFavoritesRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B8.1 Store favorites HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreFavoritesRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    redisEval.mockResolvedValue([1, 60]);
    listFavorites.mockResolvedValue(favoriteList);
    getFavoriteState.mockResolvedValue(favoriteState);
    putFavorite.mockResolvedValue(favoriteState);
    deleteFavorite.mockResolvedValue(removedState);
  });

  afterAll(async () => app.close());

  it('maps all four CUSTOMER endpoints through the real guards and common envelope', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/v1/store/favorites?keyword=%20Daily%20&page=2&page_size=100')
      .set('Authorization', customerBearer)
      .set('X-Request-Id', requestId)
      .expect(200);
    expect(listFavorites).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      { keyword: 'Daily', page: 2, pageSize: 100 },
    );
    expect(list.body).toEqual({
      code: 'OK', data: favoriteList, message: 'success', request_id: requestId,
    });
    expectNoStore(list);

    const state = await request(app.getHttpServer())
      .get(`/api/v1/store/favorites/${productId}`)
      .set('Authorization', customerBearer)
      .expect(200);
    expect(getFavoriteState).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      productId,
    );
    expect(state.body.data).toEqual(favoriteState);
    expectNoStore(state);

    const created = await request(app.getHttpServer())
      .put(`/api/v1/store/favorites/${productId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send({})
      .expect(200);
    expect(putFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      productId,
      key,
      requestId,
      expect.any(String),
    );
    expect(created.body.data).toEqual(favoriteState);
    expectNoStore(created);

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/store/favorites/${productId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send({})
      .expect(200);
    expect(deleteFavorite).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      productId,
      key,
      requestId,
      expect.any(String),
    );
    expect(removed.body.data).toEqual(removedState);
    expectNoStore(removed);

    expect(redisEval).toHaveBeenCalledTimes(4);
    const keys = redisEval.mock.calls.map((call) => (call[1] as { keys: string[] }).keys[0]);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^qingxu:store-customer:rate-limit:subject:[a-f0-9]{64}$/);
    expect(redisEval).toHaveBeenCalledWith(expect.stringContaining("redis.call('TIME')"), {
      arguments: ['60'],
      keys: [keys[0]],
    });
    expect(JSON.stringify(redisEval.mock.calls)).not.toContain(customerId);
  });

  it('rejects invalid query, ULID and body input before service dispatch', async () => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/favorites?status=ACTIVE'),
      () => request(app.getHttpServer()).get(`/api/v1/store/favorites/${productId}?page=1`),
      () => request(app.getHttpServer()).get('/api/v1/store/favorites/not-an-ulid'),
      () => request(app.getHttpServer())
        .put(`/api/v1/store/favorites/${productId}`)
        .set('Idempotency-Key', key)
        .send({ selected: true }),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/favorites/${productId}`)
        .set('Idempotency-Key', key)
        .send({ force: true }),
    ];

    for (const createProbe of probes) {
      const response = await createProbe().set('Authorization', customerBearer).expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoServiceDispatch();
  });

  it('requires a valid UUID Idempotency-Key on both mutations', async () => {
    const missing = await request(app.getHttpServer())
      .put(`/api/v1/store/favorites/${productId}`)
      .set('Authorization', customerBearer)
      .send({})
      .expect(400);
    expect(missing.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(missing);

    const invalid = await request(app.getHttpServer())
      .delete(`/api/v1/store/favorites/${productId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', 'not-a-uuid')
      .send({})
      .expect(400);
    expect(invalid.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(invalid);
    expect(putFavorite).not.toHaveBeenCalled();
    expect(deleteFavorite).not.toHaveBeenCalled();
  });

  it('keeps malformed JSON no-store before guard or service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/store/favorites/${productId}`)
      .set('Authorization', customerBearer)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send('{"selected":')
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(redisEval).not.toHaveBeenCalled();
    expectNoServiceDispatch();
    expectNoStore(response);
  });

  it.each([
    ['missing Store bearer', undefined],
    ['Admin realm bearer', adminBearer],
  ] as const)('rejects %s on all four endpoints before rate or service dispatch', async (_label, bearer) => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/favorites'),
      () => request(app.getHttpServer()).get(`/api/v1/store/favorites/${productId}`),
      () => request(app.getHttpServer())
        .put(`/api/v1/store/favorites/${productId}`)
        .set('Idempotency-Key', key)
        .send({}),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/favorites/${productId}`)
        .set('Idempotency-Key', key)
        .send({}),
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

  it('uses the real shared guard Retry-After and rejects before service dispatch', async () => {
    redisEval.mockResolvedValueOnce([121, 17]);
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/favorites')
      .set('Authorization', customerBearer)
      .expect(429);

    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('17');
    expectNoStore(response);
    expectNoServiceDispatch();
  });
});
