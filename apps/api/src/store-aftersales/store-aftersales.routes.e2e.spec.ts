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
import { StoreAftersalesController } from './store-aftersales.controller';
import {
  STORE_AFTERSALE_HTTP_STATUS,
  StoreAftersalesService,
} from './store-aftersales.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const SESSION_ID = '01J00000000000000000000003';
const SESSION_FAMILY = '01J00000000000000000000004';
const ORDER_ID = '01J00000000000000000000005';
const ORDER_ITEM_ID = '01J00000000000000000000006';
const AFTERSALE_ID = '01J00000000000000000000007';
const AFTERSALE_ITEM_ID = '01J00000000000000000000008';
const ACCESS_JTI = 'access:01J00000000000000000000009';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const PREVIEW_TOKEN = 'signed-aftersale-preview-token'.padEnd(64, 'x');
const CONFIRMATION_HASH = 'a'.repeat(64);

const signingKeys = {
  current: { id: 'store-aftersales-route-v1', key: Buffer.alloc(32, 61) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-aftersales-test',
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
  accountId: ACCOUNT_ID,
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId: SESSION_ID,
  tokenId: ACCESS_JTI,
}, 3_600).token;

const previewResponse = {
  blockers: [],
  can_submit: true,
  confirmation_hash: CONFIRMATION_HASH,
  expires_at: '2026-09-01T00:05:00.000Z',
  items: [{
    allocated_amount: '19.90',
    order_item_id: ORDER_ITEM_ID,
    remaining_refundable_amount: '39.80',
    remaining_refundable_quantity: 2,
    requested_quantity: 1,
  }],
  preview_token: PREVIEW_TOKEN,
  requested_amount: '19.90',
};
const summaryResponse = {
  aftersale_id: AFTERSALE_ID,
  aftersale_no: `AS${AFTERSALE_ID}`,
  items: [{
    aftersale_item_id: AFTERSALE_ITEM_ID,
    allocated_amount: '19.90',
    approved_refund_qty: null,
    order_item_id: ORDER_ITEM_ID,
    quantity: 1,
  }],
  status: 'PENDING_REVIEW',
  type: 'REFUND_ONLY',
};
const listResponse = {
  items: [{
    aftersale_id: AFTERSALE_ID,
    aftersale_no: `AS${AFTERSALE_ID}`,
    available_actions: ['CANCEL', 'VIEW_ORDER'],
    created_at: '2026-09-01T00:00:00.000Z',
    order_id: ORDER_ID,
    refund_processing_status: 'IDLE',
    refund_progress_status: 'NONE',
    requested_amount: '19.90',
    status: 'PENDING_REVIEW',
    type: 'REFUND_ONLY',
  }],
  pagination: { page: 1, page_size: 20, total: 1 },
};
const detailResponse = {
  ...summaryResponse,
  available_actions: ['CANCEL', 'VIEW_ORDER'],
  created_at: '2026-09-01T00:00:00.000Z',
  errors: [],
  inspection: null,
  order: {
    display_status: 'Pending shipment',
    order_id: ORDER_ID,
    order_no: `QX${ORDER_ID}`,
    paid_at: '2026-09-01T00:00:00.000Z',
    payable_amount: '39.80',
  },
  reason: 'ITEM_DAMAGED',
  refund_attempts: [],
  return_address: null,
  return_shipment: null,
  timeline: [],
  version: 1,
};

const createAftersale = vi.fn();
const listAftersales = vi.fn();
const getAftersale = vi.fn();
const cancelAftersale = vi.fn();
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
      wechat_open_id: 'mock_aftersale_customer',
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
  controllers: [StoreAftersalesController],
  providers: [
    StoreCustomerRateLimitGuard,
    {
      provide: StoreAftersalesService,
      useValue: { cancelAftersale, createAftersale, getAftersale, listAftersales },
    },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreAftersalesRoutesTestModule implements NestModule {
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
    http.getRequest<{ principal?: unknown }>().principal = {
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
  controllers: [StoreAftersalesController],
  providers: [
    StoreCustomerRateLimitGuard,
    {
      provide: StoreAftersalesService,
      useValue: { cancelAftersale, createAftersale, getAftersale, listAftersales },
    },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminTestGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreAftersalesForbiddenTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

function createBody(action: 'CONFIRM' | 'PREVIEW') {
  return {
    action,
    evidence_file_ids: [],
    items: [{ order_item_id: ORDER_ITEM_ID, quantity: 1 }],
    order_id: ORDER_ID,
    reason_code: 'ITEM_DAMAGED',
    reason_text: 'Outer packaging was damaged',
    type: 'REFUND_ONLY',
    ...(action === 'CONFIRM' ? {
      confirmation_hash: CONFIRMATION_HASH,
      preview_token: PREVIEW_TOKEN,
    } : {}),
  };
}

describe('B12.1 Store aftersales HTTP boundary', () => {
  let app: INestApplication;
  let forbiddenApp: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreAftersalesRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();

    const forbiddenRef = await Test.createTestingModule({
      imports: [StoreAftersalesForbiddenTestModule],
    }).compile();
    forbiddenApp = forbiddenRef.createNestApplication({ logger: false });
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
    createAftersale.mockImplementation(async (_session, input) => {
      if (input.action === 'PREVIEW') return previewResponse;
      const result = { ...summaryResponse } as Record<string | symbol, unknown>;
      Object.defineProperty(result, STORE_AFTERSALE_HTTP_STATUS, { enumerable: false, value: 201 });
      return result;
    });
    listAftersales.mockResolvedValue(listResponse);
    getAftersale.mockResolvedValue(detailResponse);
    cancelAftersale.mockResolvedValue({ ...summaryResponse, status: 'CANCELLED' });
  });

  it('returns PREVIEW as 200 and CONFIRM as 201 with no-store headers', async () => {
    const preview = await request(app.getHttpServer())
      .post('/api/v1/store/aftersales')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(createBody('PREVIEW'))
      .expect(200);
    expect(preview.body.data).toEqual(previewResponse);
    expectNoStore(preview);

    const confirmed = await request(app.getHttpServer())
      .post('/api/v1/store/aftersales')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(createBody('CONFIRM'))
      .expect(201);
    expect(confirmed.body.data).toEqual(summaryResponse);
    expectNoStore(confirmed);
    expect(createAftersale).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, sessionId: SESSION_ID }),
      expect.objectContaining({ action: 'CONFIRM', orderId: ORDER_ID }),
      IDEMPOTENCY_KEY,
      expect.any(String),
      expect.any(String),
    );
  });

  it('serves only list, detail, and cancel beyond the collection route', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/v1/store/aftersales?page=1&page_size=20')
      .set('Authorization', `Bearer ${storeToken}`)
      .expect(200);
    expect(listed.body.data).toEqual(listResponse);
    expectNoStore(listed);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/store/aftersales/${AFTERSALE_ID}`)
      .set('Authorization', `Bearer ${storeToken}`)
      .expect(200);
    expect(detail.body.data).toEqual(detailResponse);
    expectNoStore(detail);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/store/aftersales/${AFTERSALE_ID}/cancel`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('If-Match', '"1"')
      .send({ reason: 'No longer needed' })
      .expect(200);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    expect(cancelAftersale).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUSTOMER_ID }),
      AFTERSALE_ID,
      { reason: 'No longer needed' },
      1,
      IDEMPOTENCY_KEY,
      expect.any(String),
      expect.any(String),
    );
    expectNoStore(cancelled);

    await request(app.getHttpServer())
      .post(`/api/v1/store/aftersales/${AFTERSALE_ID}/return-shipment`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('If-Match', '"1"')
      .send({})
      .expect(404);
  });

  it.each([
    ['unknown collection query', '/api/v1/store/aftersales?sort=CREATED_DESC', 'GET', undefined],
    ['overlong aftersale number', `/api/v1/store/aftersales?aftersale_no=${'A'.repeat(33)}`, 'GET', undefined],
    ['invalid detail ULID', '/api/v1/store/aftersales/not-an-ulid', 'GET', undefined],
    ['unknown create field', '/api/v1/store/aftersales', 'POST', { ...createBody('PREVIEW'), extra: true }],
    ['duplicate items', '/api/v1/store/aftersales', 'POST', {
      ...createBody('PREVIEW'),
      items: [
        { order_item_id: ORDER_ITEM_ID, quantity: 1 },
        { order_item_id: ORDER_ITEM_ID, quantity: 1 },
      ],
    }],
  ])('rejects %s before service dispatch', async (_label, path, method, body) => {
    const call = method === 'GET'
      ? request(app.getHttpServer()).get(path)
      : request(app.getHttpServer()).post(path).set('Idempotency-Key', IDEMPOTENCY_KEY).send(body);
    const response = await call.set('Authorization', `Bearer ${storeToken}`).expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(response);
  });

  it('requires strong mutation headers before dispatch', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/store/aftersales')
      .set('Authorization', `Bearer ${storeToken}`)
      .send(createBody('PREVIEW'))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/store/aftersales/${AFTERSALE_ID}/cancel`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('If-Match', 'W/"1"')
      .send({})
      .expect(400);
    expect(createAftersale).not.toHaveBeenCalled();
    expect(cancelAftersale).not.toHaveBeenCalled();
  });

  it('requires CUSTOMER authentication and authorization', async () => {
    const unauthenticated = await request(app.getHttpServer())
      .get('/api/v1/store/aftersales')
      .expect(401);
    expect(unauthenticated.body.code).toBe('AUTH_REQUIRED');
    expectNoStore(unauthenticated);

    const forbidden = await request(forbiddenApp.getHttpServer())
      .get('/api/v1/store/aftersales')
      .expect(403);
    expect(forbidden.body.code).toBe('PERMISSION_DENIED');
    expectNoStore(forbidden);
  });

  it('uses the shared fail-closed rate limiter and exact Retry-After', async () => {
    redisEval.mockResolvedValueOnce([121, 17]);
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/aftersales')
      .set('Authorization', `Bearer ${storeToken}`)
      .expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('17');
    expect(listAftersales).not.toHaveBeenCalled();
    expectNoStore(response);
  });
});
