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
import { StoreOrdersController } from './store-orders.controller';
import { STORE_ORDER_HTTP_STATUS, StoreOrdersService } from './store-orders.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const SESSION_ID = '01J00000000000000000000003';
const SESSION_FAMILY = '01J00000000000000000000004';
const ADDRESS_ID = '01J00000000000000000000005';
const SKU_ID = '01J00000000000000000000006';
const QUOTE_ID = '01J00000000000000000000007';
const ORDER_ID = '01J00000000000000000000008';
const ORDER_ITEM_ID = '01J00000000000000000000009';
const PRODUCT_ID = '01J0000000000000000000000A';
const ACCESS_JTI = 'access:01J0000000000000000000000B';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';

const signingKeys = {
  current: { id: 'store-orders-route-v1', key: Buffer.alloc(32, 71) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-orders-test',
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
  accountId: ACCOUNT_ID,
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId: SESSION_ID,
  tokenId: ACCESS_JTI,
}, 3_600).token;

const submitBody = {
  address_id: ADDRESS_ID,
  confirmation_hash: 'a'.repeat(64),
  items: [{ quantity: 1, sku_id: SKU_ID }],
  quote_id: QUOTE_ID,
  quote_token: 'q'.repeat(32),
  source: 'BUY_NOW',
};
const orderResponse = {
  amounts: {
    goods: '19.90',
    paid: '0.00',
    payable: '19.90',
    refunded: '0.00',
    shipping: '0.00',
  },
  close_reason: null,
  completion_reason: null,
  display_status: '待付款',
  fulfillment_status: 'NOT_STARTED',
  items: [{
    line_amount: '19.90',
    order_item_id: ORDER_ITEM_ID,
    product_id: PRODUCT_ID,
    product_name: 'Daily cleanser',
    quantity: 1,
    refunded_quantity: 0,
    reserved_aftersale_quantity: 0,
    shipped_quantity: 0,
    sku_id: SKU_ID,
    sku_name: '120 ml',
    unit_price: '19.90',
  }],
  order_id: ORDER_ID,
  order_no: `QX${ORDER_ID}`,
  order_status: 'PENDING_PAYMENT',
  pay_expires_at: '2026-08-28T00:30:00.000Z',
  payment_resolution: 'NORMAL',
  payment_status: 'UNPAID',
  refund_processing_status: 'IDLE',
  refund_progress_status: 'NONE',
  server_time: '2026-08-28T00:00:00.000Z',
};
const listResponse = {
  items: [],
  pagination: { page: 1, page_size: 20, total: 0 },
};
const detailResponse = {
  ...orderResponse,
  aftersales: [],
  available_actions: ['CANCEL'],
  errors: [],
  packages: [],
  payment_attempts: [],
  refund_attempts: [],
  shipping_address: {
    city: 'Hangzhou',
    detail: 'Development fixture detail',
    district: 'Binjiang',
    phone: '00000000000',
    province: 'Zhejiang',
    recipient_name: 'Development Fixture',
  },
  timeline: [],
  version: 3,
};

const createOrder = vi.fn();
const listOrders = vi.fn();
const getOrder = vi.fn();
const cancelOrder = vi.fn();
const orderService = { cancelOrder, createOrder, getOrder, listOrders };
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
      wechat_open_id: 'mock_order_customer',
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
  controllers: [StoreOrdersController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StoreOrdersService, useValue: orderService },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreOrdersRoutesTestModule implements NestModule {
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
  controllers: [StoreOrdersController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StoreOrdersService, useValue: orderService },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminTestGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreOrdersForbiddenTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B9.2-B9.3 Store order HTTP boundary', () => {
  let app: INestApplication;
  let forbiddenApp: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreOrdersRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();

    const forbiddenModule = await Test.createTestingModule({ imports: [StoreOrdersForbiddenTestModule] }).compile();
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
    createOrder.mockResolvedValue(orderResponse);
    listOrders.mockResolvedValue(listResponse);
    getOrder.mockResolvedValue(detailResponse);
    cancelOrder.mockResolvedValue(orderResponse);
  });

  it('returns 201 no-store and passes the authenticated command context', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/orders')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(submitBody)
      .expect(201);

    expect(response.body.data).toEqual(orderResponse);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, sessionId: SESSION_ID }),
      {
        addressId: ADDRESS_ID,
        confirmationHash: 'a'.repeat(64),
        items: [{ quantity: 1, skuId: SKU_ID }],
        quoteId: QUOTE_ID,
        quoteToken: 'q'.repeat(32),
        source: 'BUY_NOW',
      },
      IDEMPOTENCY_KEY,
      expect.stringMatching(/^req_[0-9a-f]{32}$/),
      expect.any(String),
    );
    expect(redisEval).toHaveBeenCalledOnce();
    expectNoStore(response);
  });

  it('maps B9.3 list, detail and cancel through CUSTOMER no-store boundaries', async () => {
    const bearer = `Bearer ${storeToken}`;
    const listed = await request(app.getHttpServer())
      .get('/api/v1/store/orders?page=3&page_size=50&display_group=REFUND_AFTERSALE' +
        '&order_no=%20QX01J00000000000000000000008%20&order_status=SHIPPING&payment_status=PAID' +
        '&refund_progress_status=PARTIAL&refund_processing_status=REFUNDING' +
        '&fulfillment_status=IN_TRANSIT&date_from=2026-08-25&date_to=2026-08-26' +
        '&min_amount=19.90&max_amount=99.90&sort=AMOUNT_DESC')
      .set('Authorization', bearer)
      .expect(200);
    expect(listed.body.data).toEqual(listResponse);
    expect(listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, sessionId: SESSION_ID }),
      {
        createdAtFrom: new Date('2026-08-24T16:00:00.000Z'),
        createdAtToExclusive: new Date('2026-08-26T16:00:00.000Z'),
        displayGroup: 'REFUND_AFTERSALE',
        fulfillmentStatus: 'IN_TRANSIT',
        maxAmount: '99.90',
        minAmount: '19.90',
        orderNo: `QX${ORDER_ID}`,
        orderStatus: 'SHIPPING',
        page: 3,
        pageSize: 50,
        paymentStatus: 'PAID',
        refundProcessingStatus: 'REFUNDING',
        refundProgressStatus: 'PARTIAL',
        sort: 'AMOUNT_DESC',
      },
    );
    expectNoStore(listed);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/store/orders/${ORDER_ID}`)
      .set('Authorization', bearer)
      .expect(200);
    expect(fetched.body.data).toEqual(detailResponse);
    expect(getOrder).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, sessionId: SESSION_ID }),
      ORDER_ID,
    );
    expectNoStore(fetched);

    const cancelled = await request(app.getHttpServer())
      .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
      .set('Authorization', bearer)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('If-Match', '"3"')
      .send({})
      .expect(200);
    expect(cancelled.body.data).toEqual(orderResponse);
    expect(cancelOrder).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, sessionId: SESSION_ID }),
      ORDER_ID,
      3,
      IDEMPOTENCY_KEY,
      expect.stringMatching(/^req_[0-9a-f]{32}$/),
      expect.any(String),
    );
    expectNoStore(cancelled);
  });

  it('returns 202 when cancellation remains CLOSE_PENDING', async () => {
    const pendingResponse = { ...orderResponse } as Record<string | symbol, unknown>;
    Object.defineProperty(pendingResponse, STORE_ORDER_HTTP_STATUS, {
      configurable: false,
      enumerable: false,
      value: 202,
      writable: false,
    });
    cancelOrder.mockResolvedValueOnce(pendingResponse);

    const response = await request(app.getHttpServer())
      .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('If-Match', '"3"')
      .send({})
      .expect(202);

    expect(response.body.data).toEqual(orderResponse);
    expectNoStore(response);
  });

  it('applies B9.3 list defaults at the HTTP boundary', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/store/orders')
      .set('Authorization', `Bearer ${storeToken}`)
      .expect(200);
    expect(listOrders).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: CUSTOMER_ID }),
      { displayGroup: 'ALL', page: 1, pageSize: 20, sort: 'CREATED_DESC' },
    );
  });

  it.each([
    ['missing Idempotency-Key', undefined, submitBody, ''],
    ['malformed Idempotency-Key', 'not-a-uuid', submitBody, ''],
    ['unknown query', IDEMPOTENCY_KEY, submitBody, '?expand=items'],
    ['unknown body field', IDEMPOTENCY_KEY, { ...submitBody, extra: true }, ''],
    ['invalid credential shape', IDEMPOTENCY_KEY, { ...submitBody, confirmation_hash: 'A'.repeat(64) }, ''],
  ])('rejects %s before service dispatch', async (_label, key, bodyValue, suffix) => {
    let probe = request(app.getHttpServer())
      .post(`/api/v1/store/orders${suffix}`)
      .set('Authorization', `Bearer ${storeToken}`);
    if (key !== undefined) probe = probe.set('Idempotency-Key', key);
    const response = await probe.send(bodyValue).expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(createOrder).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('rejects open B9.3 queries, bodies, path IDs and mutation headers before dispatch', async () => {
    const bearer = `Bearer ${storeToken}`;
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/orders?include_deleted=true'),
      () => request(app.getHttpServer()).get('/api/v1/store/orders?page=0'),
      () => request(app.getHttpServer()).get('/api/v1/store/orders?display_group=CLOSED'),
      () => request(app.getHttpServer()).get('/api/v1/store/orders?date_from=2026-08-27&date_to=2026-08-26'),
      () => request(app.getHttpServer()).get('/api/v1/store/orders?min_amount=100.00&max_amount=99.99'),
      () => request(app.getHttpServer()).get('/api/v1/store/orders').send({ include: 'items' }),
      () => request(app.getHttpServer()).get('/api/v1/store/orders/not-an-ulid'),
      () => request(app.getHttpServer()).get(`/api/v1/store/orders/${ORDER_ID}?expand=payment`),
      () => request(app.getHttpServer()).get(`/api/v1/store/orders/${ORDER_ID}`).send({ reveal: true }),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
        .set('If-Match', '"3"')
        .send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
        .set('Idempotency-Key', 'not-a-uuid')
        .set('If-Match', '"3"')
        .send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .set('If-Match', 'W/"3"')
        .send({}),
      () => request(app.getHttpServer())
        .post('/api/v1/store/orders/not-an-ulid/cancel')
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .set('If-Match', '"3"')
        .send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel?force=true`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .set('If-Match', '"3"')
        .send({}),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY)
        .set('If-Match', '"3"')
        .send({ reason: 'open body' }),
    ];

    for (const createProbe of probes) {
      const response = await createProbe().set('Authorization', bearer).expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expect(listOrders).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('keeps malformed JSON no-store before guards and service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/orders')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .set('Content-Type', 'application/json')
      .send('{"items":')
      .expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(redisEval).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('requires a valid CUSTOMER session before rate limiting or dispatch on all B9 routes', async () => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/orders'),
      () => request(app.getHttpServer())
        .post('/api/v1/store/orders').set('Idempotency-Key', IDEMPOTENCY_KEY).send(submitBody),
      () => request(app.getHttpServer()).get(`/api/v1/store/orders/${ORDER_ID}`),
      () => request(app.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY).set('If-Match', '"3"').send({}),
    ];
    for (const createProbe of probes) {
      const response = await createProbe().expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expectNoStore(response);
    }
    expect(redisEval).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
    expect(listOrders).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('rejects a non-CUSTOMER principal before controller guards or dispatch on all B9 routes', async () => {
    const probes = [
      () => request(forbiddenApp.getHttpServer()).get('/api/v1/store/orders'),
      () => request(forbiddenApp.getHttpServer())
        .post('/api/v1/store/orders').set('Idempotency-Key', IDEMPOTENCY_KEY).send(submitBody),
      () => request(forbiddenApp.getHttpServer()).get(`/api/v1/store/orders/${ORDER_ID}`),
      () => request(forbiddenApp.getHttpServer())
        .post(`/api/v1/store/orders/${ORDER_ID}/cancel`)
        .set('Idempotency-Key', IDEMPOTENCY_KEY).set('If-Match', '"3"').send({}),
    ];
    for (const createProbe of probes) {
      const response = await createProbe().expect(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
      expectNoStore(response);
    }
    expect(createOrder).not.toHaveBeenCalled();
    expect(listOrders).not.toHaveBeenCalled();
    expect(getOrder).not.toHaveBeenCalled();
    expect(cancelOrder).not.toHaveBeenCalled();
  });

  it('preserves exact Retry-After from the shared limiter', async () => {
    redisEval.mockResolvedValueOnce([121, 17]);
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/orders')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(submitBody)
      .expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('17');
    expect(createOrder).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('preserves exact Retry-After on the B9.3 read boundary', async () => {
    redisEval.mockResolvedValueOnce([121, 19]);
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/orders')
      .set('Authorization', `Bearer ${storeToken}`)
      .expect(429);
    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('19');
    expect(listOrders).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('fails closed with no-store when Redis is unavailable', async () => {
    redisEval.mockRejectedValueOnce(new Error('redis unavailable'));
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/orders')
      .set('Authorization', `Bearer ${storeToken}`)
      .set('Idempotency-Key', IDEMPOTENCY_KEY)
      .send(submitBody)
      .expect(500);
    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(createOrder).not.toHaveBeenCalled();
    expectNoStore(response);
  });
});
