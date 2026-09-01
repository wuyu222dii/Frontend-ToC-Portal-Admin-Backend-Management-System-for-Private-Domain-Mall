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
import { FilesCustomerRateLimitGuard } from './files-customer-rate-limit.guard';
import { FilesController } from './files.controller';
import { FileAssetsService } from './files.service';

const CUSTOMER_ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const CUSTOMER_SESSION_ID = '01J00000000000000000000002';
const CUSTOMER_SESSION_FAMILY = '01J00000000000000000000003';
const ADMIN_ACCOUNT_ID = '01J00000000000000000000004';
const ADMIN_SESSION_ID = '01J00000000000000000000005';
const ADMIN_SESSION_FAMILY = '01J00000000000000000000006';
const ADMIN_FACTOR_ID = '01J00000000000000000000007';
const FILE_ID = '01J00000000000000000000008';
const CUSTOMER_ACCESS_JTI = 'access:01J00000000000000000000009';
const ADMIN_ACCESS_JTI = 'access:01J0000000000000000000000A';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'trace_0123456789abcdef0123456789abcdef';
const SHA256 = 'a'.repeat(64);

const signingKeys = {
  current: { id: 'file-route-v1', key: Buffer.alloc(32, 71) },
  previous: [],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-files-test',
    signingKeys,
  },
  store: {
    authTokenAudience: 'qingxu-store',
    customerRateLimitMax: 120,
    customerRateLimitWindowSeconds: 60,
  },
  encryption: { ipHashKey: Buffer.alloc(32, 72) },
} as unknown as PlatformRuntimeConfig;

function storeToken(audience = runtimeConfig.store.authTokenAudience): string {
  return signStoreAccessToken({
    audience,
    issuer: runtimeConfig.authentication.issuer,
    keys: runtimeConfig.authentication.signingKeys,
  }, {
    accountId: CUSTOMER_ACCOUNT_ID,
    assurance: 'WECHAT',
    permissions: [],
    restriction: 'NONE',
    role: 'CUSTOMER',
    sessionId: CUSTOMER_SESSION_ID,
    tokenId: CUSTOMER_ACCESS_JTI,
  }, 3_600).token;
}

const adminToken = signAccessToken({
  audience: runtimeConfig.authentication.audience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId: ADMIN_ACCOUNT_ID,
  assurance: 'MFA',
  permissions: [],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId: ADMIN_SESSION_ID,
  tokenId: ADMIN_ACCESS_JTI,
}, 3_600).token;

function customerSessionRow() {
  return {
    access_jti: CUSTOMER_ACCESS_JTI,
    account: {
      customer_profile: { anonymized_at: null, id: CUSTOMER_ID, version: 2 },
      deleted_at: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      version: 3,
      wechat_open_id: 'mock_file_customer',
    },
    account_id: CUSTOMER_ACCOUNT_ID,
    assurance: 'WECHAT',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: CUSTOMER_SESSION_ID,
    mfa_factor_id: null,
    mfa_verified_at: null,
    restriction: 'NONE',
    revoked_at: null,
    session_family: CUSTOMER_SESSION_FAMILY,
  };
}

function adminSessionRow() {
  return {
    access_jti: ADMIN_ACCESS_JTI,
    account: {
      deleted_at: null,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      version: 4,
    },
    account_id: ADMIN_ACCOUNT_ID,
    assurance: 'MFA',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: ADMIN_SESSION_ID,
    mfa_factor: {
      account_id: ADMIN_ACCOUNT_ID,
      encryption_key_id: 'field-test-v1',
      id: ADMIN_FACTOR_ID,
      last_used_timestep: null,
      secret_ciphertext: new Uint8Array([1]),
      status: 'ACTIVE',
    },
    mfa_factor_id: ADMIN_FACTOR_ID,
    mfa_verified_at: new Date('2026-09-01T00:00:00.000Z'),
    restriction: 'NONE',
    revoked_at: null,
    session_family: ADMIN_SESSION_FAMILY,
  };
}

const findUnique = vi.fn();
const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;
const createUploadIntent = vi.fn();
const completeUpload = vi.fn();
const downloadUrl = vi.fn();
const redisEval = vi.fn();
const redis = {
  eval: redisEval,
  isReady: true,
} as unknown as ApiRedisClient;

@Module({
  controllers: [FilesController],
  providers: [
    { provide: FileAssetsService, useValue: { completeUpload, createUploadIntent, downloadUrl } },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: API_REDIS_CLIENT, useValue: redis },
    FilesCustomerRateLimitGuard,
    StoreCustomerRateLimitGuard,
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class FilesRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoServiceDispatch(): void {
  expect(createUploadIntent).not.toHaveBeenCalled();
  expect(completeUpload).not.toHaveBeenCalled();
  expect(downloadUrl).not.toHaveBeenCalled();
}

function uploadIntent(bearer: string) {
  return request(app.getHttpServer())
    .post('/api/v1/files/upload-intents')
    .set('Authorization', bearer)
    .set('Idempotency-Key', IDEMPOTENCY_KEY)
    .set('X-Request-Id', REQUEST_ID)
    .send({
      filename: 'evidence.png',
      mime_type: 'image/png',
      purpose: 'AFTERSALE_EVIDENCE',
      sha256: SHA256,
      size: 12,
    });
}

function uploadComplete(bearer: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/files/${FILE_ID}/complete`)
    .set('Authorization', bearer)
    .set('Idempotency-Key', IDEMPOTENCY_KEY)
    .set('X-Request-Id', REQUEST_ID)
    .send({ sha256: SHA256, size: 12 });
}

function privateDownload(bearer: string) {
  return request(app.getHttpServer())
    .get(`/api/v1/files/${FILE_ID}/download-url`)
    .set('Authorization', bearer)
    .set('X-Request-Id', REQUEST_ID);
}

let app: INestApplication;

describe('B12.1 file CUSTOMER and SUPER_ADMIN HTTP authentication boundary', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [FilesRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    (redis as unknown as { isReady: boolean }).isReady = true;
    redisEval.mockResolvedValue([1, 60]);
    findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === CUSTOMER_SESSION_ID) return customerSessionRow();
      if (where.id === ADMIN_SESSION_ID) return adminSessionRow();
      return null;
    });
    createUploadIntent.mockResolvedValue({
      expires_at: '2026-09-01T00:15:00.000Z',
      file_id: FILE_ID,
      purpose: 'AFTERSALE_EVIDENCE',
      status: 'PENDING',
      upload_headers: [],
      upload_url: 'https://storage.test/upload',
    });
    completeUpload.mockResolvedValue({
      completed_at: '2026-09-01T00:01:00.000Z',
      file_id: FILE_ID,
      public_url: null,
      purpose: 'AFTERSALE_EVIDENCE',
      status: 'READY',
    });
    downloadUrl.mockResolvedValue({
      download_url: 'https://storage.test/download',
      expires_at: '2026-09-01T00:05:00.000Z',
      file_id: FILE_ID,
    });
  });

  it.each([
    ['CUSTOMER', `Bearer ${storeToken()}`, CUSTOMER_ACCOUNT_ID, 'storeSession'],
    ['SUPER_ADMIN', `Bearer ${adminToken}`, ADMIN_ACCOUNT_ID, 'accessSession'],
  ] as const)('admits %s through real AuthenticationGuard and RbacGuard on all file routes', async (
    _role,
    bearer,
    accountId,
    sessionField,
  ) => {
    const intent = await uploadIntent(bearer).expect(200);
    const completed = await uploadComplete(bearer).expect(200);
    const download = await privateDownload(bearer).expect(200);

    for (const response of [intent, completed, download]) expectNoStore(response);
    const expectedRequest = expect.objectContaining({
      principal: expect.objectContaining({ accountId }),
      [sessionField]: expect.objectContaining({ accountId }),
    });
    expect(createUploadIntent).toHaveBeenCalledWith(expectedRequest, {
      filename: 'evidence.png',
      mimeType: 'image/png',
      purpose: 'AFTERSALE_EVIDENCE',
      sha256: SHA256,
      size: 12,
    }, IDEMPOTENCY_KEY);
    expect(completeUpload).toHaveBeenCalledWith(
      expectedRequest,
      FILE_ID,
      { sha256: SHA256, size: 12 },
      IDEMPOTENCY_KEY,
    );
    expect(downloadUrl).toHaveBeenCalledWith(expectedRequest, FILE_ID);
    expect(redisEval).toHaveBeenCalledTimes(_role === 'CUSTOMER' ? 3 : 0);
  });

  it('rate-limits CUSTOMER evidence routes before service dispatch with an accurate Retry-After', async () => {
    redisEval.mockResolvedValue([121, 17]);

    const response = await uploadIntent(`Bearer ${storeToken()}`).expect(429);

    expect(response.body.code).toBe('RATE_LIMITED');
    expect(response.headers['retry-after']).toBe('17');
    expect(redisEval).toHaveBeenCalledOnce();
    expectNoServiceDispatch();
    expectNoStore(response);
  });

  it('fails CUSTOMER evidence routes closed when Redis is unavailable', async () => {
    redisEval.mockRejectedValue(new Error('redis unavailable'));

    const response = await privateDownload(`Bearer ${storeToken()}`).expect(500);

    expect(response.body.code).toBe('INTERNAL_ERROR');
    expect(redisEval).toHaveBeenCalledOnce();
    expectNoServiceDispatch();
    expectNoStore(response);
  });

  it('keeps SUPER_ADMIN file access independent from the CUSTOMER limiter', async () => {
    (redis as unknown as { isReady: boolean }).isReady = false;
    redisEval.mockRejectedValue(new Error('must not execute'));

    const response = await privateDownload(`Bearer ${adminToken}`).expect(200);

    expect(redisEval).not.toHaveBeenCalled();
    expect(downloadUrl).toHaveBeenCalledOnce();
    expectNoStore(response);
  });

  it.each([
    ['missing bearer', undefined],
    ['wrong audience bearer', `Bearer ${storeToken('qingxu-wrong-realm')}`],
  ] as const)('rejects a %s before session lookup and service dispatch', async (_label, bearer) => {
    const probe = request(app.getHttpServer())
      .get(`/api/v1/files/${FILE_ID}/download-url`)
      .set('X-Request-Id', REQUEST_ID);
    if (bearer !== undefined) probe.set('Authorization', bearer);
    const response = await probe.expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findUnique).not.toHaveBeenCalled();
    expectNoServiceDispatch();
    expectNoStore(response);
  });

  it('rejects a valid realm token whose persisted session is absent', async () => {
    findUnique.mockResolvedValue(null);
    const response = await uploadIntent(`Bearer ${storeToken()}`).expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findUnique).toHaveBeenCalledOnce();
    expectNoServiceDispatch();
    expectNoStore(response);
  });
});
