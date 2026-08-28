import {
  type CanActivate,
  type ExecutionContext,
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
import { signStoreAccessToken } from '@qingxu/platform-core';
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
import { StoreCheckoutController } from './store-checkout.controller';
import { StoreCheckoutService } from './store-checkout.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const SESSION_ID = '01J00000000000000000000003';
const SESSION_FAMILY = '01J00000000000000000000004';
const ADDRESS_ID = '01J00000000000000000000005';
const SKU_ID = '01J00000000000000000000006';
const QUOTE_ID = '01J00000000000000000000007';
const ACCESS_JTI = 'access:01J00000000000000000000008';
const signingKeys = {
  current: { id: 'store-checkout-route-v1', key: Buffer.alloc(32, 51) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-checkout-test',
    signingKeys,
  },
  encryption: { ipHashKey: Buffer.alloc(32, 52) },
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

const quoteResponse = {
  address: {
    address_id: ADDRESS_ID,
    city: 'Auckland',
    detail_masked: '23 ****',
    district: 'Central',
    is_default: true,
    phone_masked: '139 **** 6821',
    province: 'Auckland',
    recipient_name_masked: 'L**',
    version: 3,
  },
  blockers: [],
  can_submit: true,
  confirmation_hash: 'a'.repeat(64),
  expires_at: '2026-08-28T00:05:00.000Z',
  goods_amount: '19.90',
  items: [{
    available_stock: 8,
    line_amount: '19.90',
    primary_image_url: null,
    product_id: '01J00000000000000000000009',
    product_name: 'Daily cleanser',
    quantity: 1,
    saleable: true,
    sku_id: SKU_ID,
    sku_name: '120 ml',
    spec_json: null,
    unit_price: '19.90',
  }],
  payable_amount: '19.90',
  quote_id: QUOTE_ID,
  quote_token: 'signed.checkout.quote.token',
  server_time: '2026-08-28T00:00:00.000Z',
  shipping_amount: '0.00',
  source: 'BUY_NOW',
};
const quote = vi.fn();
const findUnique = vi.fn();
const redisEval = vi.fn();
const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;
const redis = { eval: redisEval, isReady: true } as unknown as ApiRedisClient;

function sessionRow() {
  return {
    access_jti: ACCESS_JTI,
    account: {
      customer_profile: { anonymized_at: null, id: CUSTOMER_ID, version: 3 },
      deleted_at: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      version: 4,
      wechat_open_id: 'mock_checkout_customer',
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
  controllers: [StoreCheckoutController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StoreCheckoutService, useValue: { quote } },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreCheckoutRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

class SuperAdminTestGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    http.getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Cache-Control', 'no-store, private');
    http.getResponse<{ setHeader(name: string, value: string): void }>()
      .setHeader('Pragma', 'no-cache');
    const incoming = http.getRequest<{ principal?: unknown }>();
    incoming.principal = {
      accountId: ACCOUNT_ID,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: SESSION_ID,
    };
    return true;
  }
}

@Module({
  controllers: [StoreCheckoutController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StoreCheckoutService, useValue: { quote } },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminTestGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreCheckoutForbiddenTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B9.1 Store checkout quote HTTP boundary', () => {
  let app: INestApplication;
  let forbiddenApp: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreCheckoutRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();

    const forbiddenModule = await Test.createTestingModule({ imports: [StoreCheckoutForbiddenTestModule] }).compile();
    forbiddenApp = forbiddenModule.createNestApplication({ logger: false });
    configureApi(forbiddenApp);
    await forbiddenApp.init();
  });

  afterAll(async () => {
    await app.close();
    await forbiddenApp.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    redisEval.mockResolvedValue([1, 60]);
    quote.mockResolvedValue(quoteResponse);
  });

  it('accepts an authenticated quote without Idempotency-Key and returns 200 no-store', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/checkout/quotes')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({
        address_id: ADDRESS_ID,
        items: [{ quantity: 1, sku_id: SKU_ID }],
        source: 'BUY_NOW',
      })
      .expect(200);

    expect(response.body.data).toEqual(quoteResponse);
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, sessionId: SESSION_ID }),
      { addressId: ADDRESS_ID, items: [{ quantity: 1, skuId: SKU_ID }], source: 'BUY_NOW' },
    );
    expect(redisEval).toHaveBeenCalledOnce();
    expectNoStore(response);
  });

  it('returns a blocked quote as 200 with null credentials', async () => {
    quote.mockResolvedValue({
      ...quoteResponse,
      blockers: ['INSUFFICIENT_STOCK'],
      can_submit: false,
      confirmation_hash: null,
      expires_at: null,
      quote_token: null,
    });
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/checkout/quotes')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ address_id: ADDRESS_ID, items: [{ quantity: 9, sku_id: SKU_ID }], source: 'BUY_NOW' })
      .expect(200);

    expect(response.body.data).toMatchObject({
      blockers: ['INSUFFICIENT_STOCK'],
      can_submit: false,
      confirmation_hash: null,
      expires_at: null,
      quote_token: null,
    });
    expectNoStore(response);
  });

  it.each([
    ['unknown query', '/api/v1/store/checkout/quotes?expand=address', {
      address_id: ADDRESS_ID, items: [{ quantity: 1, sku_id: SKU_ID }], source: 'BUY_NOW',
    }],
    ['unknown body', '/api/v1/store/checkout/quotes', {
      address_id: ADDRESS_ID, items: [{ quantity: 1, sku_id: SKU_ID }], source: 'BUY_NOW', version: 1,
    }],
    ['invalid shape', '/api/v1/store/checkout/quotes', {
      address_id: ADDRESS_ID, items: [], source: 'BUY_NOW',
    }],
  ])('rejects %s before service dispatch', async (_label, path, body) => {
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${storeToken}`)
      .send(body)
      .expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(quote).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('keeps malformed JSON no-store before guards and service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/checkout/quotes')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Content-Type', 'application/json')
      .send('{"items":')
      .expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(redisEval).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('requires a valid CUSTOMER session before rate limiting or dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/checkout/quotes')
      .send({ address_id: ADDRESS_ID, items: [{ quantity: 1, sku_id: SKU_ID }], source: 'BUY_NOW' })
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(redisEval).not.toHaveBeenCalled();
    expect(quote).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('rejects a non-CUSTOMER principal with 403 before controller guards or dispatch', async () => {
    const response = await request(forbiddenApp.getHttpServer())
      .post('/api/v1/store/checkout/quotes')
      .send({ address_id: ADDRESS_ID, items: [{ quantity: 1, sku_id: SKU_ID }], source: 'BUY_NOW' })
      .expect(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
    expect(quote).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('uses the shared fail-closed limiter and preserves exact Retry-After', async () => {
    redisEval.mockResolvedValueOnce([121, 17]);
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/checkout/quotes')
      .set('Authorization', `Bearer ${storeToken}`)
      .send({ address_id: ADDRESS_ID, items: [{ quantity: 1, sku_id: SKU_ID }], source: 'BUY_NOW' })
      .expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('17');
    expect(quote).not.toHaveBeenCalled();
    expectNoStore(response);
  });
});
