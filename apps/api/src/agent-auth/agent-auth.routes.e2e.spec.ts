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
import {
  ApplicationError,
  signAccessToken,
  signAgentAccessToken,
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
import { StoreAuthRateLimitGuard } from '../store-auth/store-auth-rate-limit.guard';
import { StoreAuthController } from '../store-auth/store-auth.controller';
import { StoreAuthService } from '../store-auth/store-auth.service';
import { AgentAuthController } from './agent-auth.controller';
import { AgentAuthService } from './agent-auth.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const AGENT_ID = '01J00000000000000000000001';
const NORMAL_SESSION_ID = '01J00000000000000000000002';
const RESTRICTED_SESSION_ID = '01J00000000000000000000003';
const SESSION_FAMILY = '01J00000000000000000000004';
const ADMIN_SESSION_ID = '01J00000000000000000000005';
const STORE_SESSION_ID = '01J00000000000000000000006';
const NORMAL_ACCESS_JTI = 'access:01J00000000000000000000007';
const RESTRICTED_ACCESS_JTI = 'access:01J00000000000000000000008';
const KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'trace_0123456789abcdef0123456789abcdef';

const signingKeys = {
  current: { id: 'agent-auth-routes-v1', key: Buffer.alloc(32, 81) },
  previous: [],
};
const runtimeConfig = {
  agent: { authTokenAudience: 'qingxu-agent-web' },
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-agent-auth-routes-test',
    signingKeys,
  },
  store: { authTokenAudience: 'qingxu-store' },
} as unknown as PlatformRuntimeConfig;

function agentToken(
  sessionId: string,
  tokenId: string,
  restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE',
): string {
  return signAgentAccessToken({
    audience: runtimeConfig.agent.authTokenAudience,
    issuer: runtimeConfig.authentication.issuer,
    keys: runtimeConfig.authentication.signingKeys,
  }, {
    accountId: ACCOUNT_ID,
    assurance: 'PASSWORD',
    permissions: [],
    restriction,
    role: 'AGENT_ADMIN',
    sessionId,
    tokenId,
  }, 3_600).token;
}

const normalBearer = `Bearer ${agentToken(NORMAL_SESSION_ID, NORMAL_ACCESS_JTI, 'NONE')}`;
const restrictedBearer = `Bearer ${agentToken(
  RESTRICTED_SESSION_ID,
  RESTRICTED_ACCESS_JTI,
  'CHANGE_PASSWORD_ONLY',
)}`;
const adminBearer = `Bearer ${signAccessToken({
  audience: runtimeConfig.authentication.audience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId: ACCOUNT_ID,
  assurance: 'MFA',
  permissions: [],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId: ADMIN_SESSION_ID,
  tokenId: 'access:01J00000000000000000000009',
}, 3_600).token}`;
const storeBearer = `Bearer ${signStoreAccessToken({
  audience: runtimeConfig.store.authTokenAudience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId: ACCOUNT_ID,
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId: STORE_SESSION_ID,
  tokenId: 'access:01J0000000000000000000000A',
}, 3_600).token}`;

const login = vi.fn();
const refresh = vi.fn();
const logout = vi.fn();
const changeTemporaryPassword = vi.fn();
const changePassword = vi.fn();
const logoutAll = vi.fn();
const current = vi.fn();
const storeLogout = vi.fn();
const service = {
  changePassword,
  changeTemporaryPassword,
  current,
  login,
  logout,
  logoutAll,
  refresh,
};
const findUnique = vi.fn();
const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;

function agentSessionRow(
  sessionId: string,
  accessJti: string,
  restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE',
) {
  return {
    access_jti: accessJti,
    account: {
      agent_profile: {
        agent_no: `AGT-${AGENT_ID}`,
        deleted_at: null,
        id: AGENT_ID,
        name: 'North Agent',
        product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
        status: 'ACTIVE',
        version: 3,
      },
      deleted_at: null,
      must_change_password: restriction === 'CHANGE_PASSWORD_ONLY',
      password_hash: 'argon2-agent-password-hash',
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      version: 4,
    },
    account_id: ACCOUNT_ID,
    assurance: 'PASSWORD',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: sessionId,
    mfa_factor_id: null,
    mfa_verified_at: null,
    refresh_token_hash: restriction === 'NONE' ? 'refresh-hash' : null,
    restriction,
    revoked_at: null,
    rotation_counter: 2,
    session_family: SESSION_FAMILY,
  };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoDispatch(): void {
  expect(login).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(logout).not.toHaveBeenCalled();
  expect(changeTemporaryPassword).not.toHaveBeenCalled();
  expect(changePassword).not.toHaveBeenCalled();
  expect(logoutAll).not.toHaveBeenCalled();
  expect(current).not.toHaveBeenCalled();
  expect(storeLogout).not.toHaveBeenCalled();
}

@Module({
  controllers: [AgentAuthController, StoreAuthController],
  providers: [
    { provide: AgentAuthService, useValue: service },
    {
      provide: StoreAuthService,
      useValue: { legalDocuments: vi.fn(), login: vi.fn(), logout: storeLogout, refresh: vi.fn() },
    },
    { provide: StoreAuthRateLimitGuard, useValue: { canActivate: vi.fn().mockReturnValue(true) } },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class AgentAuthRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B13.1 Agent authentication HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AgentAuthRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockImplementation(({ where }: { where: { id: string } }) => {
      if (where.id === NORMAL_SESSION_ID) {
        return agentSessionRow(NORMAL_SESSION_ID, NORMAL_ACCESS_JTI, 'NONE');
      }
      if (where.id === RESTRICTED_SESSION_ID) {
        return agentSessionRow(RESTRICTED_SESSION_ID, RESTRICTED_ACCESS_JTI, 'CHANGE_PASSWORD_ONLY');
      }
      return null;
    });
    login.mockResolvedValue({ access_token: 'agent-access-token', restriction: 'NONE' });
    refresh.mockResolvedValue({ access_token: 'rotated-agent-access-token', restriction: 'NONE' });
    logout.mockResolvedValue({ resource_id: NORMAL_SESSION_ID, status: 'REVOKED', version: 3 });
    changeTemporaryPassword.mockResolvedValue({ access_token: 'new-agent-access-token', restriction: 'NONE' });
    changePassword.mockResolvedValue({ resource_id: ACCOUNT_ID, status: 'ACTIVE', version: 5 });
    logoutAll.mockResolvedValue({ resource_id: ACCOUNT_ID, status: 'ACTIVE', version: 5 });
    current.mockResolvedValue({
      agent_id: AGENT_ID,
      agent_no: `AGT-${AGENT_ID}`,
      name: 'North Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
    });
  });

  afterAll(async () => app.close());

  it('maps all seven routes through closed DTOs and returns no-store responses', async () => {
    const loginResponse = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/login')
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({ login_name: 'North.Agent', password: 'temporary-password-1' })
      .expect(200);
    expect(login).toHaveBeenCalledWith(
      { loginName: 'north.agent', password: 'temporary-password-1' },
      KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expectNoStore(loginResponse);

    const refreshResponse = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/refresh')
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({ refresh_token: 'r'.repeat(20) })
      .expect(200);
    expect(refresh).toHaveBeenCalledWith({ refreshToken: 'r'.repeat(20) }, KEY, REQUEST_ID, expect.any(String));
    expectNoStore(refreshResponse);

    const logoutResponse = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/logout')
      .set('Authorization', normalBearer)
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({})
      .expect(200);
    expect(logout).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT_ID, restriction: 'NONE', sessionId: NORMAL_SESSION_ID }),
      KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expectNoStore(logoutResponse);

    const temporaryResponse = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-temporary-password')
      .set('Authorization', restrictedBearer)
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({ current_password: 'temporary-password-1', new_password: 'new-password-123' })
      .expect(200);
    expect(changeTemporaryPassword).toHaveBeenCalledWith(
      expect.objectContaining({ restriction: 'CHANGE_PASSWORD_ONLY', sessionId: RESTRICTED_SESSION_ID }),
      { currentPassword: 'temporary-password-1', newPassword: 'new-password-123' },
      KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expectNoStore(temporaryResponse);

    const changeResponse = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-password')
      .set('Authorization', normalBearer)
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({ current_password: 'current-password-1', new_password: 'new-password-123' })
      .expect(200);
    expect(changePassword).toHaveBeenCalledWith(
      expect.objectContaining({ restriction: 'NONE', sessionId: NORMAL_SESSION_ID }),
      { currentPassword: 'current-password-1', newPassword: 'new-password-123' },
      KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expectNoStore(changeResponse);

    const logoutAllResponse = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/logout-all')
      .set('Authorization', normalBearer)
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({})
      .expect(200);
    expect(logoutAll).toHaveBeenCalledWith(
      expect.objectContaining({ restriction: 'NONE', sessionId: NORMAL_SESSION_ID }),
      KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expectNoStore(logoutAllResponse);

    const currentResponse = await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', normalBearer)
      .set('X-Request-Id', REQUEST_ID)
      .expect(200);
    expect(current).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID, restriction: 'NONE', sessionId: NORMAL_SESSION_ID }),
    );
    expectNoStore(currentResponse);
  });

  it('requires Idempotency-Key on every Agent auth command before service dispatch', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/login')
        .send({ login_name: 'north.agent', password: 'temporary-password-1' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/refresh')
        .send({ refresh_token: 'r'.repeat(20) }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/logout')
        .set('Authorization', normalBearer).send({}),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/change-temporary-password')
        .set('Authorization', restrictedBearer)
        .send({ current_password: 'temporary-password-1', new_password: 'new-password-123' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/change-password')
        .set('Authorization', normalBearer)
        .send({ current_password: 'current-password-1', new_password: 'new-password-123' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/logout-all')
        .set('Authorization', normalBearer).send({}),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoDispatch();
  });

  it('rejects unknown body fields and non-empty bodies on bodyless routes', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/login')
        .set('Idempotency-Key', KEY)
        .send({ extra: true, login_name: 'north.agent', password: 'temporary-password-1' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/refresh')
        .set('Idempotency-Key', KEY).send({ extra: true, refresh_token: 'r'.repeat(20) }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/logout')
        .set('Authorization', normalBearer).set('Idempotency-Key', KEY).send({ extra: true }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/change-temporary-password')
        .set('Authorization', restrictedBearer).set('Idempotency-Key', KEY)
        .send({ current_password: 'temporary-password-1', extra: true, new_password: 'new-password-123' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/change-password')
        .set('Authorization', normalBearer).set('Idempotency-Key', KEY)
        .send({ current_password: 'current-password-1', extra: true, new_password: 'new-password-123' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/logout-all')
        .set('Authorization', normalBearer).set('Idempotency-Key', KEY).send({ extra: true }),
      () => request(app.getHttpServer()).get('/api/v1/agent/auth/current')
        .set('Authorization', normalBearer).send({ extra: true }),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoDispatch();
  });

  it('rejects query parameters on all seven Agent auth routes', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/login?debug=true')
        .set('Idempotency-Key', KEY)
        .send({ login_name: 'north.agent', password: 'temporary-password-1' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/refresh?debug=true')
        .set('Idempotency-Key', KEY).send({ refresh_token: 'r'.repeat(20) }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/logout?debug=true')
        .set('Authorization', normalBearer).set('Idempotency-Key', KEY).send({}),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/change-temporary-password?debug=true')
        .set('Authorization', restrictedBearer).set('Idempotency-Key', KEY)
        .send({ current_password: 'temporary-password-1', new_password: 'new-password-123' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/change-password?debug=true')
        .set('Authorization', normalBearer).set('Idempotency-Key', KEY)
        .send({ current_password: 'current-password-1', new_password: 'new-password-123' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/logout-all?debug=true')
        .set('Authorization', normalBearer).set('Idempotency-Key', KEY).send({}),
      () => request(app.getHttpServer()).get('/api/v1/agent/auth/current?debug=true')
        .set('Authorization', normalBearer),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoDispatch();
  });

  it('allows a restricted session only to change its temporary password or logout', async () => {
    const changed = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-temporary-password')
      .set('Authorization', restrictedBearer)
      .set('Idempotency-Key', KEY)
      .send({ current_password: 'temporary-password-1', new_password: 'new-password-123' })
      .expect(200);
    expect(changeTemporaryPassword).toHaveBeenCalledOnce();
    expectNoStore(changed);

    const loggedOut = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/logout')
      .set('Authorization', restrictedBearer)
      .set('Idempotency-Key', KEY)
      .send({})
      .expect(200);
    expect(logout).toHaveBeenCalledWith(
      expect.objectContaining({ restriction: 'CHANGE_PASSWORD_ONLY', sessionId: RESTRICTED_SESSION_ID }),
      KEY,
      expect.any(String),
      expect.any(String),
    );
    expectNoStore(loggedOut);

    changeTemporaryPassword.mockClear();
    logout.mockClear();
    const denied = [
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/change-password')
        .set('Authorization', restrictedBearer).set('Idempotency-Key', KEY)
        .send({ current_password: 'temporary-password-1', new_password: 'new-password-123' }),
      () => request(app.getHttpServer()).post('/api/v1/agent/auth/logout-all')
        .set('Authorization', restrictedBearer).set('Idempotency-Key', KEY).send({}),
      () => request(app.getHttpServer()).get('/api/v1/agent/auth/current')
        .set('Authorization', restrictedBearer),
    ];
    for (const probe of denied) {
      const response = await probe().expect(403);
      expect(response.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
      expectNoStore(response);
    }
    expect(changePassword).not.toHaveBeenCalled();
    expect(logoutAll).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
  });

  it('keeps a same-temporary-password rejection private and non-cacheable', async () => {
    changeTemporaryPassword.mockRejectedValueOnce(new ApplicationError(
      'INVALID_ARGUMENT',
      'New Agent password must differ from the temporary password',
    ));

    const response = await request(app.getHttpServer())
      .post('/api/v1/agent/auth/change-temporary-password')
      .set('Authorization', restrictedBearer)
      .set('Idempotency-Key', KEY)
      .send({ current_password: 'temporary-password-1', new_password: 'temporary-password-1' })
      .expect(400);

    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(response);
  });

  it.each([
    ['Admin', adminBearer],
    ['Store', storeBearer],
  ])('rejects a %s JWT at the Agent realm before service dispatch', async (_realm, bearer) => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/agent/auth/current')
      .set('Authorization', bearer)
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findUnique).not.toHaveBeenCalled();
    expect(current).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it.each([
    ['Admin', adminBearer],
    ['Agent', normalBearer],
  ])('rejects a %s JWT at the Store realm before service dispatch', async (_realm, bearer) => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/auth/logout')
      .set('Authorization', bearer)
      .set('Idempotency-Key', KEY)
      .send({})
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findUnique).not.toHaveBeenCalled();
    expect(storeLogout).not.toHaveBeenCalled();
    expectNoStore(response);
  });
});
