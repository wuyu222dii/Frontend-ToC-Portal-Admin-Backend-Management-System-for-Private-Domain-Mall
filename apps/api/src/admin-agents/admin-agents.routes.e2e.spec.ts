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
import { AdminAgentsController } from './admin-agents.controller';
import { AdminAgentsService } from './admin-agents.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const AGENT_ID = '01J00000000000000000000001';
const ADMIN_SESSION_ID = '01J00000000000000000000002';
const AGENT_SESSION_ID = '01J00000000000000000000003';
const STORE_SESSION_ID = '01J00000000000000000000004';
const SESSION_FAMILY = '01J00000000000000000000005';
const MFA_FACTOR_ID = '01J00000000000000000000006';
const ACCESS_JTI = 'access:01J00000000000000000000007';
const KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'trace_0123456789abcdef0123456789abcdef';
const HASH = 'a'.repeat(64);
const PREVIEW_TOKEN = `pvw_${'b'.repeat(43)}`;

const signingKeys = {
  current: { id: 'admin-agent-routes-v1', key: Buffer.alloc(32, 91) },
  previous: [],
};
const runtimeConfig = {
  agent: { authTokenAudience: 'qingxu-agent-web' },
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-admin-agent-routes-test',
    signingKeys,
  },
  store: { authTokenAudience: 'qingxu-store' },
} as unknown as PlatformRuntimeConfig;

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
  tokenId: ACCESS_JTI,
}, 3_600).token}`;
const agentBearer = `Bearer ${signAgentAccessToken({
  audience: runtimeConfig.agent.authTokenAudience,
  issuer: runtimeConfig.authentication.issuer,
  keys: runtimeConfig.authentication.signingKeys,
}, {
  accountId: ACCOUNT_ID,
  assurance: 'PASSWORD',
  permissions: [],
  restriction: 'NONE',
  role: 'AGENT_ADMIN',
  sessionId: AGENT_SESSION_ID,
  tokenId: 'access:01J00000000000000000000008',
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
  tokenId: 'access:01J00000000000000000000009',
}, 3_600).token}`;

const list = vi.fn();
const create = vi.fn();
const detail = vi.fn();
const update = vi.fn();
const previewDisable = vi.fn();
const disable = vi.fn();
const reactivate = vi.fn();
const previewPasswordReset = vi.fn();
const resetPassword = vi.fn();
const service = {
  create,
  detail,
  disable,
  list,
  previewDisable,
  previewPasswordReset,
  reactivate,
  resetPassword,
  update,
};
const findUnique = vi.fn();
const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;

function adminSessionRow() {
  const mfaVerifiedAt = new Date('2026-09-02T10:00:00.000Z');
  return {
    access_jti: ACCESS_JTI,
    account: {
      deleted_at: null,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      version: 7,
    },
    account_id: ACCOUNT_ID,
    assurance: 'MFA',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: ADMIN_SESSION_ID,
    mfa_factor: {
      account_id: ACCOUNT_ID,
      encryption_key_id: 'admin-agent-routes-v1',
      id: MFA_FACTOR_ID,
      last_used_timestep: null,
      secret_ciphertext: new Uint8Array([1, 2, 3]),
      status: 'ACTIVE',
    },
    mfa_factor_id: MFA_FACTOR_ID,
    mfa_verified_at: mfaVerifiedAt,
    restriction: 'NONE',
    revoked_at: null,
    session_family: SESSION_FAMILY,
  };
}

function createBody() {
  return {
    contact_name: '  Alice Operator  ',
    contact_phone: '13812345678',
    login_name: 'North.Agent',
    name: '  North Agent  ',
    product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
  };
}

function statusPreviewBody() {
  return { reason: '  Business suspension  ', target_status: 'DISABLED' };
}

function statusConfirmationBody() {
  return {
    confirmation_hash: HASH,
    preview_token: PREVIEW_TOKEN,
    reason: '  Business suspension  ',
    target_status: 'DISABLED',
  };
}

function resetConfirmationBody() {
  return {
    confirmation_hash: HASH,
    preview_token: PREVIEW_TOKEN,
    reason: '  Credential rotation  ',
  };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoDispatch(): void {
  expect(list).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
  expect(detail).not.toHaveBeenCalled();
  expect(update).not.toHaveBeenCalled();
  expect(previewDisable).not.toHaveBeenCalled();
  expect(disable).not.toHaveBeenCalled();
  expect(reactivate).not.toHaveBeenCalled();
  expect(previewPasswordReset).not.toHaveBeenCalled();
  expect(resetPassword).not.toHaveBeenCalled();
}

@Module({
  controllers: [AdminAgentsController],
  providers: [
    { provide: AdminAgentsService, useValue: service },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class AdminAgentsRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B13.1 Admin Agent management HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AdminAgentsRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(adminSessionRow());
    list.mockResolvedValue({ items: [], pagination: { page: 2, page_size: 50, total: 0 } });
    create.mockResolvedValue({ agent: { agent_id: AGENT_ID }, disclosure_state: 'FIRST_ISSUE' });
    detail.mockResolvedValue({ agent: { agent_id: AGENT_ID } });
    update.mockResolvedValue({ agent: { agent_id: AGENT_ID, version: 4 } });
    previewDisable.mockResolvedValue({ preview_token: PREVIEW_TOKEN });
    disable.mockResolvedValue({ resource_id: AGENT_ID, status: 'DISABLED', version: 4 });
    reactivate.mockResolvedValue({ resource_id: AGENT_ID, status: 'ACTIVE', version: 5 });
    previewPasswordReset.mockResolvedValue({ preview_token: PREVIEW_TOKEN });
    resetPassword.mockResolvedValue({ agent: { agent_id: AGENT_ID }, disclosure_state: 'FIRST_ISSUE' });
  });

  afterAll(async () => app.close());

  it('maps all nine admitted routes and dispatches exact DTO, version and confirmation values', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/admin/agents')
      .set('Authorization', adminBearer)
      .query({
        authorization_mode: 'ALL_ACTIVE_PRODUCTS',
        date_from: '2026-09-01',
        date_to: '2026-09-02',
        keyword: 'North',
        page: '2',
        page_size: '50',
        status: 'ACTIVE',
      })
      .expect(200);
    expect(list).toHaveBeenCalledWith({
      authorizationMode: 'ALL_ACTIVE_PRODUCTS',
      createdAtFrom: new Date('2026-08-31T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-02T16:00:00.000Z'),
      keyword: 'North',
      page: 2,
      pageSize: 50,
      status: 'ACTIVE',
    });

    const created = await request(app.getHttpServer())
      .post('/api/v1/admin/agents')
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send(createBody())
      .expect(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        accessSession: expect.objectContaining({ accountId: ACCOUNT_ID, sessionId: ADMIN_SESSION_ID }),
        principal: expect.objectContaining({ role: 'SUPER_ADMIN' }),
        requestId: REQUEST_ID,
      }),
      {
        contactName: 'Alice Operator',
        contactPhone: '13812345678',
        loginName: 'north.agent',
        name: 'North Agent',
        productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
      },
      KEY,
    );
    expectNoStore(created);

    await request(app.getHttpServer())
      .get(`/api/v1/admin/agents/${AGENT_ID}`)
      .set('Authorization', adminBearer)
      .expect(200);
    expect(detail).toHaveBeenCalledWith(AGENT_ID);

    await request(app.getHttpServer())
      .patch(`/api/v1/admin/agents/${AGENT_ID}`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', KEY)
      .set('If-Match', '"3"')
      .send({ contact_name: null, contact_phone: null, name: '  Updated Agent  ' })
      .expect(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
      AGENT_ID,
      { contactName: null, contactPhone: null, name: 'Updated Agent' },
      3,
      KEY,
    );

    const disablePreview = await request(app.getHttpServer())
      .post(`/api/v1/admin/agents/${AGENT_ID}/status-change-preview`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', KEY)
      .send(statusPreviewBody())
      .expect(200);
    expect(previewDisable).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
      AGENT_ID,
      { reason: 'Business suspension', targetStatus: 'DISABLED' },
      KEY,
    );
    expectNoStore(disablePreview);

    const disabled = await request(app.getHttpServer())
      .post(`/api/v1/admin/agents/${AGENT_ID}/status-changes`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', KEY)
      .set('If-Match', '"3"')
      .send(statusConfirmationBody())
      .expect(200);
    expect(disable).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
      AGENT_ID,
      {
        confirmationHash: HASH,
        previewToken: PREVIEW_TOKEN,
        reason: 'Business suspension',
        targetStatus: 'DISABLED',
      },
      3,
      KEY,
    );
    expectNoStore(disabled);

    await request(app.getHttpServer())
      .post(`/api/v1/admin/agents/${AGENT_ID}/reactivate`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', KEY)
      .set('If-Match', '"4"')
      .send({})
      .expect(200);
    expect(reactivate).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
      AGENT_ID,
      4,
      KEY,
    );

    const resetPreview = await request(app.getHttpServer())
      .post(`/api/v1/admin/agents/${AGENT_ID}/password-reset-preview`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', KEY)
      .send({ reason: '  Credential rotation  ' })
      .expect(200);
    expect(previewPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
      AGENT_ID,
      { reason: 'Credential rotation' },
      KEY,
    );
    expectNoStore(resetPreview);

    const reset = await request(app.getHttpServer())
      .post(`/api/v1/admin/agents/${AGENT_ID}/password-resets`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', KEY)
      .set('If-Match', '"4"')
      .send(resetConfirmationBody())
      .expect(200);
    expect(resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ role: 'SUPER_ADMIN' }) }),
      AGENT_ID,
      { confirmationHash: HASH, previewToken: PREVIEW_TOKEN, reason: 'Credential rotation' },
      4,
      KEY,
    );
    expectNoStore(reset);
  });

  it('requires a SUPER_ADMIN bearer on all nine admitted routes', async () => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/admin/agents'),
      () => request(app.getHttpServer()).post('/api/v1/admin/agents')
        .set('Idempotency-Key', KEY).send(createBody()),
      () => request(app.getHttpServer()).get(`/api/v1/admin/agents/${AGENT_ID}`),
      () => request(app.getHttpServer()).patch(`/api/v1/admin/agents/${AGENT_ID}`)
        .set('Idempotency-Key', KEY).set('If-Match', '"3"').send({ name: 'Updated Agent' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-change-preview`)
        .set('Idempotency-Key', KEY).send(statusPreviewBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-changes`)
        .set('Idempotency-Key', KEY).set('If-Match', '"3"').send(statusConfirmationBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/reactivate`)
        .set('Idempotency-Key', KEY).set('If-Match', '"4"').send({}),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-reset-preview`)
        .set('Idempotency-Key', KEY).send({ reason: 'Credential rotation' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-resets`)
        .set('Idempotency-Key', KEY).set('If-Match', '"4"').send(resetConfirmationBody()),
    ];

    for (const probe of probes) {
      const response = await probe().expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
    }
    expectNoDispatch();
  });

  it.each([
    ['Agent', agentBearer],
    ['Store', storeBearer],
  ])('rejects a %s JWT at the Admin realm before session lookup', async (_realm, bearer) => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/agents')
      .set('Authorization', bearer)
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findUnique).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });

  it('requires Idempotency-Key on every Agent management command', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/admin/agents')
        .set('Authorization', adminBearer).send(createBody()),
      () => request(app.getHttpServer()).patch(`/api/v1/admin/agents/${AGENT_ID}`)
        .set('Authorization', adminBearer).set('If-Match', '"3"').send({ name: 'Updated Agent' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-change-preview`)
        .set('Authorization', adminBearer).send(statusPreviewBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-changes`)
        .set('Authorization', adminBearer).set('If-Match', '"3"').send(statusConfirmationBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/reactivate`)
        .set('Authorization', adminBearer).set('If-Match', '"4"').send({}),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-reset-preview`)
        .set('Authorization', adminBearer).send({ reason: 'Credential rotation' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-resets`)
        .set('Authorization', adminBearer).set('If-Match', '"4"').send(resetConfirmationBody()),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
    }
    expectNoDispatch();
  });

  it('requires If-Match on all four versioned Agent management commands', async () => {
    const probes = [
      () => request(app.getHttpServer()).patch(`/api/v1/admin/agents/${AGENT_ID}`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).send({ name: 'Updated Agent' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-changes`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).send(statusConfirmationBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/reactivate`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).send({}),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-resets`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).send(resetConfirmationBody()),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
    }
    expectNoDispatch();
  });

  it('rejects open command bodies, including the bodyless reactivate operation', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/admin/agents')
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).send({ ...createBody(), extra: true }),
      () => request(app.getHttpServer()).patch(`/api/v1/admin/agents/${AGENT_ID}`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"3"')
        .send({ extra: true, name: 'Updated Agent' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-change-preview`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY)
        .send({ ...statusPreviewBody(), extra: true }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-changes`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"3"')
        .send({ ...statusConfirmationBody(), extra: true }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/reactivate`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"4"')
        .send({ force: true }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-reset-preview`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY)
        .send({ extra: true, reason: 'Credential rotation' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-resets`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"4"')
        .send({ ...resetConfirmationBody(), extra: true }),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
    }
    expectNoDispatch();
  });

  it('rejects unknown query parameters before service dispatch on every route shape', async () => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/admin/agents?debug=true')
        .set('Authorization', adminBearer),
      () => request(app.getHttpServer()).post('/api/v1/admin/agents?debug=true')
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).send(createBody()),
      () => request(app.getHttpServer()).get(`/api/v1/admin/agents/${AGENT_ID}?debug=true`)
        .set('Authorization', adminBearer),
      () => request(app.getHttpServer()).patch(`/api/v1/admin/agents/${AGENT_ID}?debug=true`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"3"')
        .send({ name: 'Updated Agent' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-change-preview?debug=true`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).send(statusPreviewBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-changes?debug=true`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"3"')
        .send(statusConfirmationBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/reactivate?debug=true`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"4"').send({}),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-reset-preview?debug=true`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY)
        .send({ reason: 'Credential rotation' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-resets?debug=true`)
        .set('Authorization', adminBearer).set('Idempotency-Key', KEY).set('If-Match', '"4"')
        .send(resetConfirmationBody()),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
    }
    expectNoDispatch();
  });

  it('keeps sensitive create, preview and confirmation failures private and non-cacheable', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/admin/agents')
        .set('Idempotency-Key', KEY).send(createBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-change-preview`)
        .set('Idempotency-Key', KEY).send(statusPreviewBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/status-changes`)
        .set('Idempotency-Key', KEY).set('If-Match', '"3"').send(statusConfirmationBody()),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-reset-preview`)
        .set('Idempotency-Key', KEY).send({ reason: 'Credential rotation' }),
      () => request(app.getHttpServer()).post(`/api/v1/admin/agents/${AGENT_ID}/password-resets`)
        .set('Idempotency-Key', KEY).set('If-Match', '"4"').send(resetConfirmationBody()),
    ];

    for (const probe of probes) {
      expectNoStore(await probe().expect(401));
    }
    expectNoDispatch();
  });
});
