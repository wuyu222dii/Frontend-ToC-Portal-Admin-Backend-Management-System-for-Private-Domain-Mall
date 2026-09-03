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
import { signAccessToken, signAgentAccessToken, signStoreAccessToken } from '@qingxu/platform-core';
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
import { AdminCustomersController } from './admin-customers.controller';
import { AdminCustomersService } from './admin-customers.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const TARGET_AGENT_ID = '01J00000000000000000000002';
const ADMIN_SESSION_ID = '01J00000000000000000000003';
const AGENT_SESSION_ID = '01J00000000000000000000004';
const STORE_SESSION_ID = '01J00000000000000000000005';
const SESSION_FAMILY = '01J00000000000000000000006';
const MFA_FACTOR_ID = '01J00000000000000000000007';
const ACCESS_JTI = 'access:01J00000000000000000000008';
const PREVIEW_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const CONFIRM_IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000001';
const REQUEST_ID = 'trace_0123456789abcdef0123456789abcdef';
const CONFIRMATION_HASH = 'a'.repeat(64);
const PREVIEW_TOKEN = `pvw_${'b'.repeat(43)}`;

const signingKeys = {
  current: { id: 'admin-customer-routes-v1', key: Buffer.alloc(32, 81) },
  previous: [],
};
const runtimeConfig = {
  agent: { authTokenAudience: 'qingxu-agent-web' },
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-admin-customer-routes-test',
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

const list = vi.fn();
const detail = vi.fn();
const previewTransfer = vi.fn();
const transfer = vi.fn();
const service = { detail, list, previewTransfer, transfer };
const findUnique = vi.fn();
const database = { prisma: { authSession: { findUnique } } } as unknown as DatabaseRuntime;

function adminSessionRow() {
  const mfaVerifiedAt = new Date('2026-09-03T00:00:00.000Z');
  return {
    access_jti: ACCESS_JTI,
    account: { deleted_at: null, role: 'SUPER_ADMIN', status: 'ACTIVE', version: 7 },
    account_id: ACCOUNT_ID,
    assurance: 'MFA',
    expires_at: new Date('2099-01-01T00:00:00.000Z'),
    id: ADMIN_SESSION_ID,
    mfa_factor: {
      account_id: ACCOUNT_ID,
      encryption_key_id: signingKeys.current.id,
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

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoDispatch(): void {
  expect(list).not.toHaveBeenCalled();
  expect(detail).not.toHaveBeenCalled();
  expect(previewTransfer).not.toHaveBeenCalled();
  expect(transfer).not.toHaveBeenCalled();
}

@Module({
  controllers: [AdminCustomersController],
  providers: [
    { provide: AdminCustomersService, useValue: service },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class AdminCustomersRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B13.3 Admin customer HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AdminCustomersRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(adminSessionRow());
    list.mockResolvedValue({ items: [], pagination: { page: 2, page_size: 50, total: 0 } });
    detail.mockResolvedValue({ binding_history: [], customer: { customer_id: CUSTOMER_ID }, orders: [] });
    previewTransfer.mockResolvedValue({ preview_token: PREVIEW_TOKEN });
    transfer.mockResolvedValue({ customer_id: CUSTOMER_ID, version: 5 });
  });

  afterAll(async () => app.close());

  it('maps all four routes to canonical DTOs and command headers', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/v1/admin/customers')
      .set('Authorization', adminBearer)
      .query({
        agent_id: TARGET_AGENT_ID,
        binding_status: 'BOUND',
        date_from: '2026-09-01',
        date_to: '2026-09-02',
        keyword: 'Customer 1',
        max_consumption: '999.00',
        min_consumption: '1.00',
        page: '2',
        page_size: '50',
      })
      .expect(200);
    expect(list).toHaveBeenCalledWith({
      agentId: TARGET_AGENT_ID,
      bindingStatus: 'BOUND',
      createdAtFrom: new Date('2026-08-31T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-02T16:00:00.000Z'),
      keyword: 'Customer 1',
      maxConsumption: '999.00',
      minConsumption: '1.00',
      page: 2,
      pageSize: 50,
    });
    expectNoStore(listed);

    const detailed = await request(app.getHttpServer())
      .get(`/api/v1/admin/customers/${CUSTOMER_ID}`)
      .set('Authorization', adminBearer)
      .expect(200);
    expect(detail).toHaveBeenCalledWith(CUSTOMER_ID);
    expectNoStore(detailed);

    const preview = await request(app.getHttpServer())
      .post(`/api/v1/admin/customers/${CUSTOMER_ID}/attribution-transfer-preview`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', PREVIEW_IDEMPOTENCY_KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({ reason: '  Regional ownership correction  ', target_agent_id: TARGET_AGENT_ID })
      .expect(200);
    expect(previewTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        accessSession: expect.objectContaining({ sessionId: ADMIN_SESSION_ID }),
        principal: expect.objectContaining({ role: 'SUPER_ADMIN' }),
        requestId: REQUEST_ID,
      }),
      CUSTOMER_ID,
      { reason: 'Regional ownership correction', targetAgentId: TARGET_AGENT_ID },
      PREVIEW_IDEMPOTENCY_KEY,
    );
    expectNoStore(preview);

    const confirmed = await request(app.getHttpServer())
      .post(`/api/v1/admin/customers/${CUSTOMER_ID}/attribution-transfers`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', CONFIRM_IDEMPOTENCY_KEY)
      .set('If-Match', '"4"')
      .send({
        confirmation_hash: CONFIRMATION_HASH,
        preview_token: PREVIEW_TOKEN,
        reason: '  Move to direct operation  ',
        target_agent_id: null,
      })
      .expect(200);
    expect(transfer).toHaveBeenCalledWith(
      expect.objectContaining({ principal: expect.objectContaining({ accountId: ACCOUNT_ID }) }),
      CUSTOMER_ID,
      {
        confirmationHash: CONFIRMATION_HASH,
        previewToken: PREVIEW_TOKEN,
        reason: 'Move to direct operation',
        targetAgentId: null,
      },
      4,
      CONFIRM_IDEMPOTENCY_KEY,
    );
    expectNoStore(confirmed);
  });

  it('authenticates before parsing or dispatching every route', async () => {
    const probes = [
      () => request(app.getHttpServer()).get('/api/v1/admin/customers?unexpected=true'),
      () => request(app.getHttpServer()).get('/api/v1/admin/customers/not-a-customer?unexpected=true'),
      () => request(app.getHttpServer())
        .post('/api/v1/admin/customers/not-a-customer/attribution-transfer-preview').send({}),
      () => request(app.getHttpServer())
        .post('/api/v1/admin/customers/not-a-customer/attribution-transfers').send({}),
    ];
    for (const probe of probes) {
      const response = await probe().expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expectNoStore(response);
    }
    expectNoDispatch();
  });

  it.each([
    ['Agent', agentBearer],
    ['Store', storeBearer],
  ])('rejects a %s JWT at the Admin realm before session lookup', async (_realm, bearer) => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/customers')
      .set('Authorization', bearer)
      .expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findUnique).not.toHaveBeenCalled();
    expectNoDispatch();
    expectNoStore(response);
  });

  it('rejects missing command headers and non-contract input before dispatch', async () => {
    const previewWithoutKey = await request(app.getHttpServer())
      .post(`/api/v1/admin/customers/${CUSTOMER_ID}/attribution-transfer-preview`)
      .set('Authorization', adminBearer)
      .send({ reason: 'Ownership correction', target_agent_id: TARGET_AGENT_ID })
      .expect(400);
    expect(previewWithoutKey.body.code).toBe('INVALID_ARGUMENT');

    const confirmationWithoutVersion = await request(app.getHttpServer())
      .post(`/api/v1/admin/customers/${CUSTOMER_ID}/attribution-transfers`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', CONFIRM_IDEMPOTENCY_KEY)
      .send({
        confirmation_hash: CONFIRMATION_HASH,
        preview_token: PREVIEW_TOKEN,
        reason: 'Ownership correction',
      })
      .expect(400);
    expect(confirmationWithoutVersion.body.code).toBe('INVALID_ARGUMENT');

    const unknownQuery = await request(app.getHttpServer())
      .get('/api/v1/admin/customers?unexpected=true')
      .set('Authorization', adminBearer)
      .expect(400);
    expect(unknownQuery.body.code).toBe('INVALID_ARGUMENT');

    const unknownBody = await request(app.getHttpServer())
      .post(`/api/v1/admin/customers/${CUSTOMER_ID}/attribution-transfer-preview`)
      .set('Authorization', adminBearer)
      .set('Idempotency-Key', PREVIEW_IDEMPOTENCY_KEY)
      .send({ reason: 'Ownership correction', unexpected: true })
      .expect(400);
    expect(unknownBody.body.code).toBe('INVALID_ARGUMENT');

    expectNoDispatch();
  });
});
