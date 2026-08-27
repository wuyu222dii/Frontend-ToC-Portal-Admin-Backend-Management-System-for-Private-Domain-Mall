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
import { ApplicationError, signAccessToken, signStoreAccessToken } from '@qingxu/platform-core';
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
import { StorePrivacyController } from './store-privacy.controller';
import { StorePrivacyService } from './store-privacy.service';

const accountId = '01J00000000000000000000000';
const customerId = '01J00000000000000000000001';
const sessionId = '01J00000000000000000000002';
const sessionFamily = '01J00000000000000000000003';
const accessJti = 'access:01J00000000000000000000004';
const deletionRequestId = '01J00000000000000000000005';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'trace_0123456789abcdef0123456789abcdef';
const previewToken = `pvw_${'a'.repeat(43)}`;
const confirmationHash = 'b'.repeat(64);

const signingKeys = {
  current: { id: 'store-privacy-route-v1', key: Buffer.alloc(32, 51) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-store-privacy-test',
    signingKeys,
  },
  store: { authTokenAudience: 'qingxu-store' },
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
const previewResponse = {
  account_version: 4,
  blockers: [],
  confirmation_hash: confirmationHash,
  eligible: true,
  expires_at: '2026-08-27T08:05:00.000Z',
  impacts: ['REVOKE_ALL_SESSIONS'],
  preview_token: previewToken,
} as const;
const confirmResponse = {
  completed_at: '2026-08-27T08:01:00.000Z',
  request_id: deletionRequestId,
  status: 'COMPLETED',
  submitted_at: '2026-08-27T08:01:00.000Z',
} as const;

const previewDeletion = vi.fn();
const confirmDeletion = vi.fn();
const privacyService = { confirmDeletion, previewDeletion };
const findUnique = vi.fn();
const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;

function sessionRow() {
  return {
    access_jti: accessJti,
    account: {
      customer_profile: { anonymized_at: null, id: customerId, version: 3 },
      deleted_at: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      version: 4,
      wechat_open_id: 'mock_privacy_customer',
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

function confirmBody() {
  return {
    acknowledged: true,
    confirmation_hash: confirmationHash,
    preview_token: previewToken,
  };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

@Module({
  controllers: [StorePrivacyController],
  providers: [
    { provide: StorePrivacyService, useValue: privacyService },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StorePrivacyRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B7.4 Store privacy HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StorePrivacyRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    previewDeletion.mockResolvedValue(previewResponse);
    confirmDeletion.mockResolvedValue(confirmResponse);
  });

  afterAll(async () => app.close());

  it('maps the closed preview request through a validated CUSTOMER session', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests/preview')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send({ acknowledged: true })
      .expect(200);

    expect(previewDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      { acknowledged: true },
      key,
      requestId,
      expect.any(String),
    );
    expect(response.body.data).toEqual(previewResponse);
    expectNoStore(response);
  });

  it('maps preview capability and strong If-Match to synchronous confirmation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"4"')
      .set('X-Request-Id', requestId)
      .send(confirmBody())
      .expect(200);

    expect(confirmDeletion).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId, sessionId }),
      { acknowledged: true, confirmationHash, previewToken },
      4,
      key,
      requestId,
      expect.any(String),
    );
    expect(response.body.data).toEqual(confirmResponse);
    expectNoStore(response);
  });

  it.each([
    ['missing Store bearer', undefined],
    ['Admin realm bearer', adminBearer],
  ] as const)('rejects %s on both endpoints before service dispatch', async (_label, bearer) => {
    for (const createProbe of [
      () => request(app.getHttpServer())
        .post('/api/v1/store/privacy/deletion-requests/preview')
        .set('Idempotency-Key', key)
        .send({ acknowledged: true }),
      () => request(app.getHttpServer())
        .post('/api/v1/store/privacy/deletion-requests')
        .set('Idempotency-Key', key)
        .set('If-Match', '"4"')
        .send(confirmBody()),
    ]) {
      const probe = createProbe();
      if (bearer !== undefined) probe.set('Authorization', bearer);
      const response = await probe.expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expectNoStore(response);
    }
    expect(previewDeletion).not.toHaveBeenCalled();
    expect(confirmDeletion).not.toHaveBeenCalled();
  });

  it('rejects open body or query input before service dispatch', async () => {
    for (const createProbe of [
      () => request(app.getHttpServer())
        .post('/api/v1/store/privacy/deletion-requests/preview?force=true')
        .send({ acknowledged: true }),
      () => request(app.getHttpServer())
        .post('/api/v1/store/privacy/deletion-requests/preview')
        .send({ acknowledged: true, reason: 'delete' }),
      () => request(app.getHttpServer())
        .post('/api/v1/store/privacy/deletion-requests')
        .set('If-Match', '"4"')
        .send({ ...confirmBody(), account_version: 4 }),
    ]) {
      const response = await createProbe()
        .set('Authorization', customerBearer)
        .set('Idempotency-Key', key)
        .expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expect(previewDeletion).not.toHaveBeenCalled();
    expect(confirmDeletion).not.toHaveBeenCalled();
  });

  it('requires a UUID idempotency key and confirm If-Match', async () => {
    const missingKey = await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests/preview')
      .set('Authorization', customerBearer)
      .send({ acknowledged: true })
      .expect(400);
    expect(missingKey.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(missingKey);

    const missingVersion = await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .send(confirmBody())
      .expect(400);
    expect(missingVersion.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(missingVersion);

    expect(previewDeletion).not.toHaveBeenCalled();
    expect(confirmDeletion).not.toHaveBeenCalled();
  });

  it('keeps malformed JSON no-store before service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests/preview')
      .set('Authorization', customerBearer)
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send('{"acknowledged":')
      .expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(previewDeletion).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it.each([
    ['CONFIRMATION_MISMATCH', 409],
    ['PREVIEW_EXPIRED', 409],
    ['RESOURCE_VERSION_CONFLICT', 409],
    ['ACCOUNT_DELETION_BLOCKED', 422],
  ] as const)('maps service %s to the frozen HTTP status', async (code, status) => {
    confirmDeletion.mockRejectedValue(new ApplicationError(code, 'rejected'));
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"4"')
      .send(confirmBody())
      .expect(status);
    expect(response.body.code).toBe(code);
    expectNoStore(response);
  });

  it('rejects the old bearer immediately after confirmation revokes its session', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('If-Match', '"4"')
      .send(confirmBody())
      .expect(200);

    confirmDeletion.mockClear();
    findUnique.mockResolvedValue(null);
    const stale = await request(app.getHttpServer())
      .post('/api/v1/store/privacy/deletion-requests/preview')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', '00000000-0000-4000-8000-000000000001')
      .send({ acknowledged: true })
      .expect(401);
    expect(stale.body.code).toBe('AUTH_REQUIRED');
    expect(previewDeletion).not.toHaveBeenCalled();
    expectNoStore(stale);
  });
});
