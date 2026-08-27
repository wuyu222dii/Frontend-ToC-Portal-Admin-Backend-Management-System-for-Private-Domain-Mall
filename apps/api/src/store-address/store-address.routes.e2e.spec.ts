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
import { ApplicationError, signAccessToken, signStoreAccessToken } from '@qingxu/platform-core';
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
import { StoreAddressController } from './store-address.controller';
import { StoreAddressService } from './store-address.service';

const accountId = '01J00000000000000000000000';
const customerId = '01J00000000000000000000001';
const sessionId = '01J00000000000000000000002';
const sessionFamily = '01J00000000000000000000003';
const addressId = '01J00000000000000000000004';
const accessJti = 'access:01J00000000000000000000005';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'trace_0123456789abcdef0123456789abcdef';
const sensitivePhone = '13800000000';
const sensitiveDetail = '江南大道 100 号 1 单元 101 室';

const signingKeys = {
  current: { id: 'store-address-route-v1', key: Buffer.alloc(32, 81) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-address-test',
    signingKeys,
  },
  encryption: { ipHashKey: Buffer.alloc(32, 82) },
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
const summary = {
  address_id: addressId,
  city: '杭州市',
  detail_masked: '江南大道 ****',
  district: '滨江区',
  is_default: true,
  phone_masked: '138 **** 0000',
  province: '浙江省',
  recipient_name_masked: '林**',
  version: 3,
};
const detail = {
  address_id: addressId,
  city: '杭州市',
  detail: sensitiveDetail,
  district: '滨江区',
  is_default: true,
  phone: sensitivePhone,
  province: '浙江省',
  recipient_name: '林晓月',
  version: 3,
};
const deleted = {
  occurred_at: '2026-08-28T01:02:03.000Z',
  resource_id: addressId,
  resource_type: 'customer_address',
  status: 'DELETED',
  version: 4,
};

const listAddresses = vi.fn();
const createAddress = vi.fn();
const getAddress = vi.fn();
const updateAddress = vi.fn();
const deleteAddress = vi.fn();
const addressService = { createAddress, deleteAddress, getAddress, listAddresses, updateAddress };
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
      wechat_open_id: 'mock_address_customer',
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

function addressBody(overrides: Record<string, unknown> = {}) {
  return {
    city: ' 杭州市 ',
    detail: ` ${sensitiveDetail} `,
    district: ' 滨江区 ',
    is_default: true,
    phone: sensitivePhone,
    province: ' 浙江省 ',
    recipient_name: ' 林晓月 ',
    ...overrides,
  };
}

const parsedBody = {
  city: '杭州市',
  detail: sensitiveDetail,
  district: '滨江区',
  isDefault: true,
  phone: sensitivePhone,
  province: '浙江省',
  recipientName: '林晓月',
};

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoServiceDispatch(): void {
  expect(listAddresses).not.toHaveBeenCalled();
  expect(createAddress).not.toHaveBeenCalled();
  expect(getAddress).not.toHaveBeenCalled();
  expect(updateAddress).not.toHaveBeenCalled();
  expect(deleteAddress).not.toHaveBeenCalled();
}

@Module({
  controllers: [StoreAddressController],
  providers: [
    StoreCustomerRateLimitGuard,
    { provide: StoreAddressService, useValue: addressService },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreAddressRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B8.3 Store address HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreAddressRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    redisEval.mockResolvedValue([1, 60]);
    listAddresses.mockResolvedValue([summary]);
    createAddress.mockResolvedValue(detail);
    getAddress.mockResolvedValue(detail);
    updateAddress.mockResolvedValue(detail);
    deleteAddress.mockResolvedValue(deleted);
  });

  afterAll(async () => app.close());

  it('maps all five CUSTOMER endpoints through the frozen 200 envelopes', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/v1/store/addresses')
      .set('Authorization', customerBearer)
      .set('X-Request-Id', requestId)
      .expect(200);
    expect(listAddresses).toHaveBeenCalledWith(expect.objectContaining({ accountId, customerId, sessionId }));
    expect(listed.body).toEqual({ code: 'OK', data: [summary], message: 'success', request_id: requestId });
    expectNoStore(listed);

    const created = await request(app.getHttpServer())
      .post('/api/v1/store/addresses')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send(addressBody())
      .expect(200);
    expect(createAddress).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      parsedBody,
      key,
      requestId,
      expect.any(String),
    );
    expect(created.body.data).toEqual(detail);
    expectNoStore(created);

    const fetched = await request(app.getHttpServer())
      .get(`/api/v1/store/addresses/${addressId}`)
      .set('Authorization', customerBearer)
      .expect(200);
    expect(getAddress).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      addressId,
    );
    expect(fetched.body.data).toEqual(detail);
    expectNoStore(fetched);

    const updated = await request(app.getHttpServer())
      .patch(`/api/v1/store/addresses/${addressId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"3"')
      .send(addressBody({ is_default: false }))
      .expect(200);
    expect(updateAddress).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      addressId,
      { ...parsedBody, isDefault: false },
      3,
      key,
      expect.stringMatching(/^(?:req|trace)_[0-9a-f]{32}$/),
      expect.any(String),
    );
    expect(updated.body.data).toEqual(detail);
    expectNoStore(updated);

    const removed = await request(app.getHttpServer())
      .delete(`/api/v1/store/addresses/${addressId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"3"')
      .send({})
      .expect(200);
    expect(deleteAddress).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      addressId,
      3,
      key,
      expect.stringMatching(/^(?:req|trace)_[0-9a-f]{32}$/),
      expect.any(String),
    );
    expect(removed.body.data).toEqual(deleted);
    expectNoStore(removed);

    expect(redisEval).toHaveBeenCalledTimes(5);
    const keys = redisEval.mock.calls.map((call) => (call[1] as { keys: string[] }).keys[0]);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toMatch(/^qingxu:store-customer:rate-limit:subject:[a-f0-9]{64}$/);
    expect(JSON.stringify(redisEval.mock.calls)).not.toContain(customerId);
  });

  it('rejects unknown query/body fields, invalid ULIDs and open writes before service dispatch', async () => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/addresses?include_deleted=true'),
      () => request(app.getHttpServer()).get('/api/v1/store/addresses').send({ page: 1 }),
      () => request(app.getHttpServer()).get('/api/v1/store/addresses/not-an-ulid'),
      () => request(app.getHttpServer()).get(`/api/v1/store/addresses/${addressId}`).send({ reveal: true }),
      () => request(app.getHttpServer())
        .post('/api/v1/store/addresses')
        .set('Idempotency-Key', key)
        .send(addressBody({ account_id: accountId })),
      () => request(app.getHttpServer())
        .patch(`/api/v1/store/addresses/${addressId}`)
        .set('Idempotency-Key', key)
        .set('If-Match', '"3"')
        .send({ phone: sensitivePhone }),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/addresses/${addressId}`)
        .set('Idempotency-Key', key)
        .set('If-Match', '"3"')
        .send({ force: true }),
    ];

    for (const createProbe of probes) {
      const response = await createProbe().set('Authorization', customerBearer).expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoServiceDispatch();
  });

  it('requires UUID Idempotency-Key and strong If-Match on the frozen mutations', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/store/addresses').send(addressBody()),
      () => request(app.getHttpServer())
        .patch(`/api/v1/store/addresses/${addressId}`)
        .set('Idempotency-Key', key)
        .send(addressBody()),
      () => request(app.getHttpServer())
        .patch(`/api/v1/store/addresses/${addressId}`)
        .set('Idempotency-Key', 'not-a-uuid')
        .set('If-Match', '"3"')
        .send(addressBody()),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/addresses/${addressId}`)
        .set('Idempotency-Key', key)
        .set('If-Match', 'W/"3"')
        .send({}),
    ];

    for (const createProbe of probes) {
      const response = await createProbe().set('Authorization', customerBearer).expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoServiceDispatch();
  });

  it('keeps malformed address JSON no-store before rate or service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/addresses')
      .set('Authorization', customerBearer)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send('{"recipient_name":')
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
      () => request(app.getHttpServer()).get('/api/v1/store/addresses'),
      () => request(app.getHttpServer())
        .post('/api/v1/store/addresses').set('Idempotency-Key', key).send(addressBody()),
      () => request(app.getHttpServer()).get(`/api/v1/store/addresses/${addressId}`),
      () => request(app.getHttpServer())
        .patch(`/api/v1/store/addresses/${addressId}`)
        .set('Idempotency-Key', key).set('If-Match', '"3"').send(addressBody()),
      () => request(app.getHttpServer())
        .delete(`/api/v1/store/addresses/${addressId}`)
        .set('Idempotency-Key', key).set('If-Match', '"3"').send({}),
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

  it('uses the shared guard exact Retry-After on the address collection', async () => {
    redisEval.mockResolvedValueOnce([121, 19]);
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/addresses')
      .set('Authorization', customerBearer)
      .expect(429);

    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('19');
    expectNoStore(response);
    expectNoServiceDispatch();
  });

  it('maps address conflicts and failures without exposing PII on exact or prefix paths', async () => {
    updateAddress.mockRejectedValueOnce(new ApplicationError(
      'DEFAULT_ADDRESS_REQUIRED',
      `Cannot remove default for ${sensitivePhone} at ${sensitiveDetail}`,
      [{ field: 'phone', reason: 'private reason', rejected_value: sensitivePhone }],
    ));
    const businessError = await request(app.getHttpServer())
      .patch(`/api/v1/store/addresses/${addressId}`)
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"3"')
      .send(addressBody({ is_default: false }))
      .expect(422);
    expect(businessError.body).toMatchObject({ code: 'DEFAULT_ADDRESS_REQUIRED' });
    expect(businessError.body.details).toEqual([
      { field: null, reason: 'The value was rejected', rejected_value: null },
    ]);
    expectNoStore(businessError);

    listAddresses.mockRejectedValueOnce(new Error(`${sensitivePhone} ${sensitiveDetail}`));
    const internalError = await request(app.getHttpServer())
      .get('/api/v1/store/addresses')
      .set('Authorization', customerBearer)
      .expect(500);
    expect(internalError.body.code).toBe('INTERNAL_ERROR');
    expectNoStore(internalError);

    for (const response of [businessError, internalError]) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain(sensitivePhone);
      expect(serialized).not.toContain(sensitiveDetail);
    }
  });
});
