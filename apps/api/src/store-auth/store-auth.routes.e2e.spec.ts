import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ApplicationError } from '@qingxu/platform-core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrincipalRequest } from '../platform/access/principal';
import { RbacGuard } from '../platform/access/rbac.guard';
import { AuthenticationGuard } from '../platform/auth/authentication.guard';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { StoreAuthRateLimitGuard } from './store-auth-rate-limit.guard';
import { StoreAuthController } from './store-auth.controller';
import { StoreAuthService } from './store-auth.service';

const accountId = '01J00000000000000000000000';
const customerId = '01J00000000000000000000001';
const sessionId = '01J00000000000000000000002';
const sessionFamily = '01J00000000000000000000003';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const customerBearer = 'Bearer store-customer-token';

const legalDocuments = vi.fn();
const login = vi.fn();
const refresh = vi.fn();
const logout = vi.fn();
const rateLimitCanActivate = vi.fn().mockReturnValue(true);
const service = { legalDocuments, login, logout, refresh };

const session = {
  access_expires_at: '2026-08-27T01:15:00.000Z',
  access_token: 'access-token-material-with-at-least-twenty-characters',
  assurance: 'WECHAT',
  refresh_expires_at: '2026-09-03T01:00:00.000Z',
  refresh_token: 'refresh-token-material-with-at-least-twenty-characters',
  role: 'CUSTOMER',
} as const;

const legalSnapshot = {
  phone_authorization: {
    content_url: 'https://legal.example.test/phone',
    document_version: 'phone-v1',
    required: true,
    title: 'Phone authorization',
    type: 'PHONE_AUTHORIZATION',
  },
  privacy_policy: {
    content_url: 'https://legal.example.test/privacy',
    document_version: 'privacy-v1',
    required: true,
    title: 'Privacy policy',
    type: 'PRIVACY_POLICY',
  },
  user_agreement: {
    content_url: 'https://legal.example.test/user',
    document_version: 'user-v1',
    required: true,
    title: 'User agreement',
    type: 'USER_AGREEMENT',
  },
} as const;

function loginBody() {
  return {
    code: 'mock:customer_0001',
    consents: [
      { accepted: true, document_version: 'user-v1', type: 'USER_AGREEMENT' },
      { accepted: true, document_version: 'privacy-v1', type: 'PRIVACY_POLICY' },
    ],
  };
}

function setNoStore(context: ExecutionContext): void {
  const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
  response.setHeader('Cache-Control', 'no-store, private');
  response.setHeader('Pragma', 'no-cache');
}

@Injectable()
class StoreCustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setNoStore(context);
    const http = context.switchToHttp();
    const requestValue = http.getRequest<PrincipalRequest & {
      headers: Record<string, string | string[] | undefined>;
      originalUrl?: string;
    }>();
    requestValue.requestId = requestId;
    if (!requestValue.originalUrl?.startsWith('/api/v1/store/auth/logout')) return true;
    if (requestValue.headers.authorization !== customerBearer) {
      throw new ApplicationError('AUTH_REQUIRED', 'Store authentication is required');
    }
    requestValue.storeSession = {
      accountId,
      accountVersion: 1,
      accessJti: 'store-access-jti-0001',
      customerId,
      customerVersion: 1,
      expiresAt: new Date('2026-09-03T01:00:00.000Z'),
      sessionFamily,
      sessionId,
    };
    requestValue.principal = {
      accountId,
      assurance: 'WECHAT',
      permissions: [],
      restriction: 'NONE',
      role: 'CUSTOMER',
      sessionId,
    };
    return true;
  }
}

@Module({
  controllers: [StoreAuthController],
  providers: [
    { provide: StoreAuthService, useValue: service },
    { provide: StoreAuthRateLimitGuard, useValue: { canActivate: rateLimitCanActivate } },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class UnauthenticatedStoreAuthTestModule {}

@Module({
  controllers: [StoreAuthController],
  providers: [
    { provide: StoreAuthService, useValue: service },
    { provide: StoreAuthRateLimitGuard, useValue: { canActivate: rateLimitCanActivate } },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: StoreCustomerGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreAuthMappingTestModule {}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('B7.1 Store authentication protected HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [UnauthenticatedStoreAuthTestModule] })
      .overrideGuard(StoreAuthRateLimitGuard)
      .useValue({ canActivate: rateLimitCanActivate })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => app.close());

  it('applies public no-store metadata through the real authentication guard', async () => {
    legalDocuments.mockResolvedValueOnce(legalSnapshot);
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/legal-documents')
      .expect(200);

    expect(response.body).toEqual(legalSnapshot);
    expectNoStore(response);
  });

  it('keeps no-store headers when a public request fails before service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/auth/wechat/login')
      .send(loginBody())
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(login).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('keeps no-store headers when malformed JSON is rejected before guards and controller dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/auth/wechat/login')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send('{"code":')
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(login).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('keeps no-store headers when an oversized JSON body is rejected before guards and controller dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/auth/wechat/login')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send(JSON.stringify({ code: `mock:${'x'.repeat(110_000)}` }))
      .expect(413);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(login).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('rejects logout without a Store CUSTOMER session before service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/auth/logout')
      .set('Idempotency-Key', key)
      .send({})
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(logout).not.toHaveBeenCalled();
    expectNoStore(response);
  });
});

describe('B7.1 Store authentication HTTP mapping', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreAuthMappingTestModule] })
      .overrideGuard(StoreAuthRateLimitGuard)
      .useValue({ canActivate: rateLimitCanActivate })
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    rateLimitCanActivate.mockReturnValue(true);
    legalDocuments.mockResolvedValue(legalSnapshot);
    login.mockResolvedValue({ candidate: null, confirmation_required: false, session });
    refresh.mockResolvedValue(session);
    logout.mockResolvedValue({
      occurred_at: '2026-08-27T01:00:00.000Z',
      resource_id: sessionId,
      resource_type: 'session',
      status: 'REVOKED',
      version: 1,
    });
  });

  afterAll(async () => app.close());

  it('serves the closed legal-document snapshot anonymously with no-store', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/store/legal-documents').expect(200);

    expect(response.body).toEqual({
      code: 'OK',
      data: legalSnapshot,
      message: 'success',
      request_id: requestId,
    });
    expect(legalDocuments).toHaveBeenCalledOnce();
    expect(rateLimitCanActivate).toHaveBeenCalledOnce();
    expectNoStore(response);
  });

  it('rejects query fields on the legal-document endpoint before service dispatch', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/legal-documents?page=1')
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(legalDocuments).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it.each([
    ['login', '/api/v1/store/auth/wechat/login', loginBody(), undefined],
    ['refresh', '/api/v1/store/auth/refresh', { refresh_token: 'r'.repeat(20) }, undefined],
    ['logout', '/api/v1/store/auth/logout', {}, customerBearer],
  ] as const)('requires Idempotency-Key for %s before service dispatch', async (operation, path, body, bearer) => {
    let probe = request(app.getHttpServer()).post(path);
    if (bearer !== undefined) probe = probe.set('Authorization', bearer);
    const response = await probe.send(body).expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(service[operation as 'login' | 'logout' | 'refresh']).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('rejects a malformed Idempotency-Key before login dispatch', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/auth/wechat/login')
      .set('Idempotency-Key', 'not-a-uuid')
      .send(loginBody())
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(login).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it.each([
    ['open login body', '/api/v1/store/auth/wechat/login', { ...loginBody(), extra: true }, undefined, 'login'],
    ['unordered consent tuple', '/api/v1/store/auth/wechat/login', {
      ...loginBody(), consents: [...loginBody().consents].reverse(),
    }, undefined, 'login'],
    ['open refresh body', '/api/v1/store/auth/refresh', {
      refresh_token: 'r'.repeat(20), extra: true,
    }, undefined, 'refresh'],
    ['non-empty logout body', '/api/v1/store/auth/logout', { acknowledged: true }, customerBearer, 'logout'],
  ] as const)('rejects %s before service dispatch', async (_name, path, body, bearer, operation) => {
    let probe = request(app.getHttpServer()).post(path).set('Idempotency-Key', key);
    if (bearer !== undefined) probe = probe.set('Authorization', bearer);
    const response = await probe.send(body).expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(service[operation]).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('maps an ordered login tuple and returns the strict Store session union', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/auth/wechat/login')
      .set('Idempotency-Key', key)
      .send(loginBody())
      .expect(200);

    expect(login).toHaveBeenCalledWith({
      candidateToken: null,
      code: 'mock:customer_0001',
      consents: [
        { accepted: true, documentVersion: 'user-v1', type: 'USER_AGREEMENT' },
        { accepted: true, documentVersion: 'privacy-v1', type: 'PRIVACY_POLICY' },
      ],
    }, key, requestId, expect.any(String));
    expect(response.body.data).toEqual({ candidate: null, confirmation_required: false, session });
    expect(response.body.request_id).toBe(requestId);
    expectNoStore(response);
  });

  it('maps refresh and logout without widening their request bodies', async () => {
    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/store/auth/refresh')
      .set('Idempotency-Key', key)
      .send({ refresh_token: 'r'.repeat(20) })
      .expect(200);
    expect(refresh).toHaveBeenCalledWith({ refreshToken: 'r'.repeat(20) }, key, requestId, expect.any(String));
    expect(refreshResponse.body.data).toEqual(session);
    expectNoStore(refreshResponse);

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/v1/store/auth/logout')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .send({})
      .expect(200);
    expect(logout).toHaveBeenCalledWith(expect.objectContaining({
      accountId, customerId, sessionFamily, sessionId,
    }), key, requestId, expect.any(String));
    expect(logoutResponse.body.data).toMatchObject({
      resource_id: sessionId,
      resource_type: 'session',
      status: 'REVOKED',
      version: 1,
    });
    expectNoStore(logoutResponse);
  });

  it.each([
    ['login', '/api/v1/store/auth/wechat/login', loginBody()],
    ['refresh', '/api/v1/store/auth/refresh', { refresh_token: 'r'.repeat(20) }],
  ] as const)('maps opaque %s credential failure to 401 with no-store', async (operation, path, body) => {
    service[operation].mockRejectedValueOnce(new ApplicationError('AUTH_REQUIRED', 'secret provider detail'));
    const response = await request(app.getHttpServer())
      .post(path)
      .set('Idempotency-Key', key)
      .send(body)
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(JSON.stringify(response.body)).not.toContain('secret provider detail');
    expectNoStore(response);
  });

  it('maps consent and HASH_ONLY replay conflicts to closed 409 responses', async () => {
    login.mockRejectedValueOnce(new ApplicationError(
      'CONSENT_VERSION_MISMATCH',
      'client supplied old document versions',
    ));
    const consent = await request(app.getHttpServer())
      .post('/api/v1/store/auth/wechat/login')
      .set('Idempotency-Key', key)
      .send(loginBody())
      .expect(409);
    expect(consent.body.code).toBe('CONSENT_VERSION_MISMATCH');
    expectNoStore(consent);

    refresh.mockRejectedValueOnce(new ApplicationError('STATE_CONFLICT', 'sensitive response cannot replay'));
    const replay = await request(app.getHttpServer())
      .post('/api/v1/store/auth/refresh')
      .set('Idempotency-Key', key)
      .send({ refresh_token: 'r'.repeat(20) })
      .expect(409);
    expect(replay.body.code).toBe('STATE_CONFLICT');
    expectNoStore(replay);
  });

  it.each([
    ['legal', '/api/v1/store/legal-documents', '17'],
    ['login', '/api/v1/store/auth/wechat/login', '899'],
  ] as const)('preserves the exact %s fixed-window Retry-After on 429', async (_operation, path, retryAfter) => {
    rateLimitCanActivate.mockImplementationOnce((context: ExecutionContext) => {
      context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>()
        .setHeader('Retry-After', retryAfter);
      throw new ApplicationError('RATE_LIMITED', 'internal fixed-window detail');
    });
    const probe = path.endsWith('legal-documents')
      ? request(app.getHttpServer()).get(path)
      : request(app.getHttpServer()).post(path).set('Idempotency-Key', key).send(loginBody());
    const response = await probe.expect(429);

    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe(retryAfter);
    expectNoStore(response);
    expect(legalDocuments).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
});
