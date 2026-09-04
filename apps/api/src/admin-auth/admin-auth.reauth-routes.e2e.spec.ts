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
import { signAccessToken, signPreAuthToken } from '@qingxu/platform-core';
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
import { AdminAuthController } from './admin-auth.controller';
import { AdminAuthService } from './admin-auth.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CHALLENGE_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const FACTOR_ID = '01J00000000000000000000003';
const SESSION_FAMILY = '01J00000000000000000000004';
const ACCESS_JTI = 'access:01J00000000000000000000005';
const PREAUTH_JTI = '01J00000000000000000000006';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'trace_0123456789abcdef0123456789abcdef';

const signingKeys = {
  current: { id: 'b136-route-v1', key: Buffer.alloc(32, 31) },
  previous: [],
};
const runtimeConfig = {
  agent: { authTokenAudience: 'qingxu-agent-web' },
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-b136-test',
    signingKeys,
  },
  store: { authTokenAudience: 'qingxu-store' },
} as unknown as PlatformRuntimeConfig;

const loginPreauth = signPreAuthToken({
  audience: runtimeConfig.authentication.audience,
  issuer: runtimeConfig.authentication.issuer,
  keys: signingKeys,
}, {
  accountId: ACCOUNT_ID,
  accountVersion: 3,
  challengeId: CHALLENGE_ID,
  nextAction: 'VERIFY_TOTP',
  tokenId: PREAUTH_JTI,
}, 300).token;

const reauthBearer = signAccessToken({
  audience: runtimeConfig.authentication.audience,
  issuer: runtimeConfig.authentication.issuer,
  keys: signingKeys,
}, {
  accountId: ACCOUNT_ID,
  assurance: 'MFA',
  permissions: [],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId: SESSION_ID,
  tokenId: ACCESS_JTI,
}, 900).token;

const accountFindUnique = vi.fn();
const sessionFindUnique = vi.fn();
const verifyLogin = vi.fn();
const verifyReauthChallenge = vi.fn();
const database = {
  prisma: {
    account: { findUnique: accountFindUnique },
    authSession: { findUnique: sessionFindUnique },
  },
} as unknown as DatabaseRuntime;

@Module({
  controllers: [AdminAuthController],
  providers: [
    { provide: AdminAuthService, useValue: { verifyLogin, verifyReauthChallenge } },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class AdminReauthRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

function verification(bearer: string) {
  return request(app.getHttpServer())
    .post(`/api/v1/admin/auth/mfa/challenges/${CHALLENGE_ID}/verify`)
    .set('Authorization', `Bearer ${bearer}`)
    .set('Idempotency-Key', IDEMPOTENCY_KEY)
    .set('X-Request-Id', REQUEST_ID)
    .send({ challenge_id: CHALLENGE_ID, totp_code: '123456' });
}

let app: INestApplication;

describe('B13.6 shared Admin MFA verify HTTP authentication chain', () => {
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AdminReauthRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    vi.clearAllMocks();
    accountFindUnique.mockResolvedValue({
      deleted_at: null,
      password_hash: 'stored-password-hash-material',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      version: 3,
    });
    sessionFindUnique.mockResolvedValue({
      access_jti: ACCESS_JTI,
      account: { deleted_at: null, role: 'SUPER_ADMIN', status: 'ACTIVE', version: 3 },
      account_id: ACCOUNT_ID,
      assurance: 'MFA',
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      id: SESSION_ID,
      mfa_factor: {
        account_id: ACCOUNT_ID,
        encryption_key_id: 'field-v1',
        id: FACTOR_ID,
        last_used_timestep: null,
        secret_ciphertext: new Uint8Array([1]),
        status: 'ACTIVE',
      },
      mfa_factor_id: FACTOR_ID,
      mfa_verified_at: new Date('2026-09-04T00:00:00.000Z'),
      restriction: 'NONE',
      revoked_at: null,
      session_family: SESSION_FAMILY,
    });
    verifyLogin.mockResolvedValue({ challenge_id: CHALLENGE_ID, realm: 'LOGIN' });
    verifyReauthChallenge.mockResolvedValue({ challenge_id: CHALLENGE_ID, realm: 'REAUTH' });
  });

  it('admits LOGIN pre-auth through AuthenticationGuard and RbacGuard', async () => {
    const response = await verification(loginPreauth).expect(200);

    expect(response.body.data).toMatchObject({ challenge_id: CHALLENGE_ID, realm: 'LOGIN' });
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(verifyLogin).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, nextAction: 'VERIFY_TOTP' }),
      loginPreauth,
      CHALLENGE_ID,
      { challengeId: CHALLENGE_ID, totpCode: '123456' },
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expect(verifyReauthChallenge).not.toHaveBeenCalled();
  });

  it('admits a live SUPER_ADMIN bearer through AuthenticationGuard and RbacGuard for REAUTH', async () => {
    const response = await verification(reauthBearer).expect(200);

    expect(response.body.data).toMatchObject({ challenge_id: CHALLENGE_ID, realm: 'REAUTH' });
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(verifyReauthChallenge).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, sessionId: SESSION_ID }),
      reauthBearer,
      CHALLENGE_ID,
      { challengeId: CHALLENGE_ID, totpCode: '123456' },
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expect(verifyLogin).not.toHaveBeenCalled();
  });
});
