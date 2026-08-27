import {
  type INestApplication,
  MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
  UnprocessableEntityException,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import {
  ApplicationError,
  signAccessToken,
  signStoreAccessToken,
} from '@qingxu/platform-core';
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
import { StoreProfileController } from './store-profile.controller';
import { StoreProfileService } from './store-profile.service';

const accountId = '01J00000000000000000000000';
const customerId = '01J00000000000000000000001';
const sessionId = '01J00000000000000000000002';
const sessionFamily = '01J00000000000000000000003';
const accessJti = 'access:01J00000000000000000000004';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'trace_0123456789abcdef0123456789abcdef';
const sensitiveCredential = 'mock:phone:13800000000';

const signingKeys = {
  current: { id: 'store-profile-test-v1', key: Buffer.alloc(32, 23) },
  previous: [],
};

const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-profile-test',
    signingKeys,
  },
  store: {
    authTokenAudience: 'qingxu-store',
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
  tokenId: 'access:01J00000000000000000000005',
}, 3_600).token;

const customerBearer = `Bearer ${storeToken}`;
const adminBearer = `Bearer ${adminToken}`;

const profile = {
  avatar_url: null,
  city: 'Hangzhou',
  customer_id: customerId,
  nickname: 'Qing Xu',
  phone_masked: null,
  phone_source: null,
  phone_tail: null,
  phone_verified_at: null,
  version: 5,
} as const;

const profileWithPhone = {
  ...profile,
  phone_masked: '138 **** 0000',
  phone_source: 'MOCK',
  phone_tail: '0000',
  phone_verified_at: '2026-08-27T02:00:00.000Z',
  version: 6,
} as const;

const getProfile = vi.fn();
const updateProfile = vi.fn();
const authorizePhone = vi.fn();
const revokePhone = vi.fn();
const service = { authorizePhone, getProfile, revokePhone, updateProfile };
const findUnique = vi.fn();

const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;

function sessionRow() {
  return {
    id: sessionId,
    account_id: accountId,
    access_jti: accessJti,
    assurance: 'WECHAT',
    restriction: 'NONE',
    mfa_factor_id: null,
    mfa_verified_at: null,
    session_family: sessionFamily,
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    revoked_at: null,
    account: {
      role: 'CUSTOMER',
      status: 'ACTIVE',
      deleted_at: null,
      wechat_open_id: 'mock_customer_open_id',
      version: 3,
      customer_profile: {
        id: customerId,
        version: 5,
        anonymized_at: null,
      },
    },
  };
}

function phoneAuthorizationBody() {
  return {
    provider_credential: sensitiveCredential,
    consent: {
      accepted: true,
      document_version: 'phone-v1',
      type: 'PHONE_AUTHORIZATION',
    },
  };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoServiceDispatch(): void {
  expect(getProfile).not.toHaveBeenCalled();
  expect(updateProfile).not.toHaveBeenCalled();
  expect(authorizePhone).not.toHaveBeenCalled();
  expect(revokePhone).not.toHaveBeenCalled();
}

@Module({
  controllers: [StoreProfileController],
  providers: [
    { provide: StoreProfileService, useValue: service },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreProfileRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({
      method: RequestMethod.ALL,
      path: '{*path}',
    });
  }
}

describe('B7.2 Store profile HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreProfileRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    getProfile.mockResolvedValue(profile);
    updateProfile.mockResolvedValue({ ...profile, nickname: 'Updated', version: 6 });
    authorizePhone.mockResolvedValue(profileWithPhone);
    revokePhone.mockResolvedValue({ ...profile, version: 6 });
  });

  afterAll(async () => app.close());

  it('maps GET /store/profile through the real CUSTOMER guard and rejects query fields', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/profile')
      .set('Authorization', customerBearer)
      .set('X-Request-Id', requestId)
      .expect(200);

    expect(response.body).toEqual({
      code: 'OK',
      data: profile,
      message: 'success',
      request_id: requestId,
    });
    expect(getProfile).toHaveBeenCalledWith(expect.objectContaining({
      accountId,
      accessJti,
      customerId,
      sessionFamily,
      sessionId,
    }));
    expectNoStore(response);

    getProfile.mockClear();
    const invalid = await request(app.getHttpServer())
      .get('/api/v1/store/profile?page=1')
      .set('Authorization', customerBearer)
      .expect(400);
    expect(invalid.body.code).toBe('INVALID_ARGUMENT');
    expect(getProfile).not.toHaveBeenCalled();
    expectNoStore(invalid);
  });

  it('maps closed PATCH input, If-Match and Idempotency-Key to updateProfile', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/v1/store/profile')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .set('X-Request-Id', requestId)
      .send({ nickname: '  Updated  ', avatar_url: null })
      .expect(200);

    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      { avatarUrl: null, nickname: 'Updated' },
      5,
      key,
      requestId,
      expect.any(String),
    );
    expect(response.body.data).toMatchObject({ nickname: 'Updated', version: 6 });
    expectNoStore(response);
  });

  it('maps fixed phone consent to POST, preserving the frozen 200 response', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/profile/phone-authorizations')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .set('X-Request-Id', requestId)
      .send(phoneAuthorizationBody())
      .expect(200);

    expect(authorizePhone).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      {
        consent: {
          accepted: true,
          documentVersion: 'phone-v1',
          type: 'PHONE_AUTHORIZATION',
        },
        providerCredential: sensitiveCredential,
      },
      5,
      key,
      requestId,
      expect.any(String),
    );
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(profileWithPhone);
    expectNoStore(response);
  });

  it('maps DELETE headers and an empty body to revokePhone', async () => {
    const response = await request(app.getHttpServer())
      .delete('/api/v1/store/profile/phone')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .set('X-Request-Id', requestId)
      .send({})
      .expect(200);

    expect(revokePhone).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      5,
      key,
      requestId,
      expect.any(String),
    );
    expect(response.body.data).toMatchObject({ phone_masked: null, version: 6 });
    expectNoStore(response);
  });

  it.each([
    ['missing Store bearer', undefined],
    ['Admin realm bearer', adminBearer],
  ] as const)('rejects %s on all four endpoints before service dispatch', async (_case, bearer) => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/store/profile'),
      () => request(app.getHttpServer())
        .patch('/api/v1/store/profile')
        .set('Idempotency-Key', key)
        .set('If-Match', '"5"')
        .send({ nickname: 'Updated' }),
      () => request(app.getHttpServer())
        .post('/api/v1/store/profile/phone-authorizations')
        .set('Idempotency-Key', key)
        .set('If-Match', '"5"')
        .send(phoneAuthorizationBody()),
      () => request(app.getHttpServer())
        .delete('/api/v1/store/profile/phone')
        .set('Idempotency-Key', key)
        .set('If-Match', '"5"')
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
    expectNoServiceDispatch();
  });

  it('requires strong If-Match and UUID Idempotency-Key before mutation dispatch', async () => {
    const invalidIfMatch = await request(app.getHttpServer())
      .patch('/api/v1/store/profile')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"13800000000"')
      .send({ nickname: 'Updated' })
      .expect(400);
    expect(invalidIfMatch.body.details).toEqual([
      { field: 'If-Match', reason: 'The value was rejected', rejected_value: null },
    ]);
    expect(JSON.stringify(invalidIfMatch.body)).not.toContain('13800000000');
    expectNoStore(invalidIfMatch);

    const invalidKey = await request(app.getHttpServer())
      .post('/api/v1/store/profile/phone-authorizations')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', sensitiveCredential)
      .set('If-Match', '"5"')
      .send(phoneAuthorizationBody())
      .expect(400);
    expect(invalidKey.body.details).toEqual([
      { field: 'Idempotency-Key', reason: 'The value was rejected', rejected_value: null },
    ]);
    expect(JSON.stringify(invalidKey.body)).not.toContain(sensitiveCredential);
    expectNoStore(invalidKey);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(authorizePhone).not.toHaveBeenCalled();
  });

  it('wires each mutation to its closed DTO before service dispatch', async () => {
    const openPatch = await request(app.getHttpServer())
      .patch('/api/v1/store/profile')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .send({ nickname: 'Updated', phone: '13800000000' })
      .expect(400);
    expectNoStore(openPatch);

    const openPhone = await request(app.getHttpServer())
      .post('/api/v1/store/profile/phone-authorizations')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .send({ ...phoneAuthorizationBody(), provider: 'MOCK' })
      .expect(400);
    expectNoStore(openPhone);

    const openDelete = await request(app.getHttpServer())
      .delete('/api/v1/store/profile/phone')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .send({ acknowledged: true })
      .expect(400);
    expectNoStore(openDelete);

    expect(updateProfile).not.toHaveBeenCalled();
    expect(authorizePhone).not.toHaveBeenCalled();
    expect(revokePhone).not.toHaveBeenCalled();
  });

  it('keeps malformed and oversized JSON failures no-store before service dispatch', async () => {
    const malformed = await request(app.getHttpServer())
      .post('/api/v1/store/profile/phone-authorizations')
      .set('Authorization', customerBearer)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .send('{"provider_credential":')
      .expect(400);
    expect(malformed.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(malformed);

    const oversized = await request(app.getHttpServer())
      .patch('/api/v1/store/profile')
      .set('Authorization', customerBearer)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .send(JSON.stringify({ nickname: 'x'.repeat(110_000) }))
      .expect(413);
    expect(oversized.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(oversized);
    expectNoServiceDispatch();
  });

  it('keeps every documented error status no-store and hides internal details', async () => {
    const cases = [
      { error: new ApplicationError('AUTH_REQUIRED', 'private-service-detail'), status: 401 },
      { error: new ApplicationError('PERMISSION_DENIED', 'private-service-detail'), status: 403 },
      { error: new ApplicationError('RESOURCE_NOT_FOUND', 'private-service-detail'), status: 404 },
      { error: new ApplicationError('RESOURCE_VERSION_CONFLICT', 'private-service-detail'), status: 409 },
      { error: new UnprocessableEntityException('private-service-detail'), status: 422 },
      { error: new ApplicationError('RATE_LIMITED', 'private-service-detail'), status: 429 },
      { error: new Error('private-service-detail'), status: 500 },
    ];

    for (const item of cases) {
      getProfile.mockRejectedValueOnce(item.error);
      const response = await request(app.getHttpServer())
        .get('/api/v1/store/profile')
        .set('Authorization', customerBearer)
        .expect(item.status);
      expectNoStore(response);
      expect(JSON.stringify(response.body)).not.toContain('private-service-detail');
      if (item.status === 429) expect(response.headers['retry-after']).toBe('900');
    }
  });

  it('nulls sensitive provider rejected_value details from a trusted service error', async () => {
    authorizePhone.mockRejectedValueOnce(new ApplicationError(
      'INVALID_ARGUMENT',
      'phone provider rejected a private credential',
      [{
        field: 'provider_credential',
        reason: 'provider private reason',
        rejected_value: sensitiveCredential,
      }],
    ));
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/profile/phone-authorizations')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"5"')
      .send(phoneAuthorizationBody())
      .expect(400);

    expect(response.body.details).toEqual([
      { field: null, reason: 'The value was rejected', rejected_value: null },
    ]);
    expect(JSON.stringify(response.body)).not.toContain(sensitiveCredential);
    expectNoStore(response);
  });
});
