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
  generateStoreCandidateToken,
  signAccessToken,
  signStoreAccessToken,
  storeCandidateTokenHashCandidates,
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
import { StoreAttributionCredentialGuard } from './store-attribution-credential.guard';
import { StoreAttributionController } from './store-attribution.controller';
import { StoreAttributionService } from './store-attribution.service';

const accountId = '01J00000000000000000000000';
const customerId = '01J00000000000000000000001';
const sessionId = '01J00000000000000000000002';
const sessionFamily = '01J00000000000000000000003';
const accessJti = 'access:01J00000000000000000000004';
const candidateId = '01J00000000000000000000005';
const agentId = '01J00000000000000000000006';
const promotionAssetId = '01J00000000000000000000007';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'trace_0123456789abcdef0123456789abcdef';
const candidateToken = generateStoreCandidateToken();

const signingKeys = {
  current: { id: 'store-attribution-route-v1', key: Buffer.alloc(32, 21) },
  previous: [],
};
const secretHashKeys = {
  current: { id: 'store-attribution-secret-v2', key: Buffer.alloc(32, 22) },
  previous: [{ id: 'store-attribution-secret-v1', key: Buffer.alloc(32, 23) }],
};
const runtimeConfig = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-attribution-route-test',
    secretHashKeys,
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
  tokenId: 'access:01J00000000000000000000008',
}, 3_600).token;

const customerBearer = `Bearer ${storeToken}`;
const adminBearer = `Bearer ${adminToken}`;
const candidate = {
  agent_id: agentId,
  attribution_eligible: true,
  candidate_id: candidateId,
  confirmation_required: true,
  display_name: 'Qingxu Agent',
  expires_at: '2026-08-27T07:00:00.000Z',
  public_target_url: 'https://mall.example.test/products/cleanser',
  remaining_seconds: 1_800,
} as const;
const serviceAgent = {
  agent_id: agentId,
  bound_at: '2026-08-27T06:30:00.000Z',
  display_name: 'Qingxu Agent',
} as const;

const createCandidate = vi.fn();
const getCurrentCandidate = vi.fn();
const confirmCandidate = vi.fn();
const rejectCandidate = vi.fn();
const getServiceAgent = vi.fn();
const attributionService = {
  confirmCandidate,
  createCandidate,
  getCurrentCandidate,
  getServiceAgent,
  rejectCandidate,
};
const findUnique = vi.fn();
const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;

function sessionRow() {
  return {
    access_jti: accessJti,
    account: {
      customer_profile: { anonymized_at: null, id: customerId, version: 2 },
      deleted_at: null,
      role: 'CUSTOMER',
      status: 'ACTIVE',
      version: 3,
      wechat_open_id: 'mock_attribution_customer',
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

function candidateBody() {
  return { invite_code: 'QY8K2P', promotion_asset_id: promotionAssetId };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function expectNoDispatch(): void {
  expect(createCandidate).not.toHaveBeenCalled();
  expect(getCurrentCandidate).not.toHaveBeenCalled();
  expect(confirmCandidate).not.toHaveBeenCalled();
  expect(rejectCandidate).not.toHaveBeenCalled();
  expect(getServiceAgent).not.toHaveBeenCalled();
}

@Module({
  controllers: [StoreAttributionController],
  providers: [
    { provide: StoreAttributionService, useValue: attributionService },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    StoreAttributionCredentialGuard,
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class StoreAttributionRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B7.3 Store attribution HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [StoreAttributionRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue(sessionRow());
    createCandidate.mockResolvedValue({
      candidate,
      candidate_token: candidateToken,
      public_fallback: null,
      service_agent: null,
    });
    getCurrentCandidate.mockResolvedValue(candidate);
    confirmCandidate.mockResolvedValue(serviceAgent);
    rejectCandidate.mockResolvedValue({
      candidate_id: candidateId,
      rejected_at: '2026-08-27T06:40:00.000Z',
      status: 'REJECTED',
    });
    getServiceAgent.mockResolvedValue(serviceAgent);
  });

  afterAll(async () => app.close());

  it('creates anonymously and passes only the closed DTO to service', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidates')
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send(candidateBody())
      .expect(200);

    expect(createCandidate).toHaveBeenCalledWith(
      { kind: 'ANONYMOUS' },
      { inviteCode: 'QY8K2P', promotionAssetId },
      key,
      requestId,
      expect.any(String),
    );
    expect(response.body.data).toEqual({
      candidate,
      candidate_token: candidateToken,
      public_fallback: null,
      service_agent: null,
    });
    expectNoStore(response);
  });

  it('hashes a candidate header with current and previous keys without forwarding the token', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidates')
      .set('Idempotency-Key', key)
      .set('X-Candidate-Token', candidateToken)
      .send(candidateBody())
      .expect(200);

    expect(createCandidate).toHaveBeenCalledWith({
      kind: 'CANDIDATE_TOKEN',
      tokenHashCandidates: storeCandidateTokenHashCandidates(candidateToken, secretHashKeys),
    }, { inviteCode: 'QY8K2P', promotionAssetId }, key, expect.any(String), expect.any(String));
    expect(JSON.stringify(createCandidate.mock.calls)).not.toContain(candidateToken);
    expectNoStore(response);
  });

  it('uses a validated Store bearer for create and candidate query', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidates')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .send(candidateBody())
      .expect(200);
    expect(createCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'CUSTOMER', session: expect.objectContaining({ accountId, customerId }) }),
      { inviteCode: 'QY8K2P', promotionAssetId },
      key,
      expect.any(String),
      expect.any(String),
    );
    expectNoStore(created);

    getCurrentCandidate.mockClear();
    const queried = await request(app.getHttpServer())
      .get('/api/v1/store/attribution/candidate')
      .set('Authorization', customerBearer)
      .expect(200);
    expect(getCurrentCandidate).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'CUSTOMER', session: expect.objectContaining({ accountId, customerId }),
    }));
    expect(queried.body.data).toEqual(candidate);
    expectNoStore(queried);
  });

  it('queries by a candidate HMAC and rejects an absent, malformed or dual credential', async () => {
    const valid = await request(app.getHttpServer())
      .get('/api/v1/store/attribution/candidate')
      .set('X-Candidate-Token', candidateToken)
      .expect(200);
    expect(getCurrentCandidate).toHaveBeenCalledWith({
      kind: 'CANDIDATE_TOKEN',
      tokenHashCandidates: storeCandidateTokenHashCandidates(candidateToken, secretHashKeys),
    });
    expectNoStore(valid);

    getCurrentCandidate.mockClear();
    for (const createProbe of [
      () => request(app.getHttpServer()).get('/api/v1/store/attribution/candidate'),
      () => request(app.getHttpServer()).get('/api/v1/store/attribution/candidate')
        .set('X-Candidate-Token', 'short'),
    ]) {
      const response = await createProbe().expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expectNoStore(response);
    }
    const dual = await request(app.getHttpServer())
      .get('/api/v1/store/attribution/candidate')
      .set('Authorization', customerBearer)
      .set('X-Candidate-Token', candidateToken)
      .expect(400);
    expect(dual.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(dual);
    expect(getCurrentCandidate).not.toHaveBeenCalled();
  });

  it('never falls back to candidate authentication when Authorization is present but invalid', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/store/attribution/candidate')
      .set('Authorization', 'Bearer invalid-store-token')
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(getCurrentCandidate).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('maps confirm, reject and service-agent through CUSTOMER auth with exact empty inputs', async () => {
    const confirmed = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidate/confirm')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .set('X-Request-Id', requestId)
      .send({})
      .expect(200);
    expect(confirmCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId }), key, requestId, expect.any(String),
    );
    expect(confirmed.body.data).toEqual(serviceAgent);
    expectNoStore(confirmed);

    const rejected = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidate/reject')
      .set('Authorization', customerBearer)
      .set('Idempotency-Key', key)
      .send({})
      .expect(200);
    expect(rejectCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ accountId, customerId }), key, expect.any(String), expect.any(String),
    );
    expect(rejected.body.data).toMatchObject({ candidate_id: candidateId, status: 'REJECTED' });
    expectNoStore(rejected);

    const current = await request(app.getHttpServer())
      .get('/api/v1/store/service-agent')
      .set('Authorization', customerBearer)
      .expect(200);
    expect(getServiceAgent).toHaveBeenCalledWith(expect.objectContaining({ accountId, customerId }));
    expect(current.body.data).toEqual(serviceAgent);
    expectNoStore(current);
  });

  it('rejects non-customer access to customer-only operations before dispatch', async () => {
    for (const createProbe of [
      () => request(app.getHttpServer()).post('/api/v1/store/attribution/candidate/confirm')
        .set('Idempotency-Key', key).send({}),
      () => request(app.getHttpServer()).post('/api/v1/store/attribution/candidate/reject')
        .set('Authorization', adminBearer).set('Idempotency-Key', key).send({}),
      () => request(app.getHttpServer()).get('/api/v1/store/service-agent'),
    ]) {
      const response = await createProbe().expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      expectNoStore(response);
    }
    expectNoDispatch();
  });

  it('rejects unknown query/body fields and missing or malformed idempotency keys', async () => {
    const probes = [
      () => request(app.getHttpServer()).post('/api/v1/store/attribution/candidates')
        .set('Idempotency-Key', key).send({ ...candidateBody(), extra: true }),
      () => request(app.getHttpServer()).post('/api/v1/store/attribution/candidates?source=qr')
        .set('Idempotency-Key', key).send(candidateBody()),
      () => request(app.getHttpServer()).post('/api/v1/store/attribution/candidates').send(candidateBody()),
      () => request(app.getHttpServer()).post('/api/v1/store/attribution/candidates')
        .set('Idempotency-Key', 'not-a-uuid').send(candidateBody()),
      () => request(app.getHttpServer()).post('/api/v1/store/attribution/candidate/confirm')
        .set('Authorization', customerBearer).set('Idempotency-Key', key).send({ acknowledged: true }),
      () => request(app.getHttpServer()).get('/api/v1/store/service-agent?expand=binding')
        .set('Authorization', customerBearer),
    ];
    for (const createProbe of probes) {
      const response = await createProbe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
      expectNoStore(response);
    }
    expectNoDispatch();
  });

  it('keeps malformed and oversized JSON failures no-store before service dispatch', async () => {
    const malformed = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidates')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send('{"invite_code":')
      .expect(400);
    expect(malformed.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(malformed);

    const oversized = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidates')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', key)
      .send(JSON.stringify({ ...candidateBody(), invite_code: 'x'.repeat(110_000) }))
      .expect(413);
    expect(oversized.body.code).toBe('INVALID_ARGUMENT');
    expectNoStore(oversized);
    expectNoDispatch();
  });

  it('maps closed conflict and invalid candidate-token subject errors with no-store', async () => {
    createCandidate.mockRejectedValueOnce(new ApplicationError('STATE_CONFLICT', 'private detail'));
    const conflict = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidates')
      .set('Idempotency-Key', key)
      .send(candidateBody())
      .expect(409);
    expect(conflict.body.code).toBe('STATE_CONFLICT');
    expect(JSON.stringify(conflict.body)).not.toContain('private detail');
    expectNoStore(conflict);

    createCandidate.mockRejectedValueOnce(new ApplicationError('AUTH_REQUIRED', 'expired replacement credential'));
    const invalidReplacement = await request(app.getHttpServer())
      .post('/api/v1/store/attribution/candidates')
      .set('X-Candidate-Token', candidateToken)
      .set('Idempotency-Key', key)
      .send(candidateBody())
      .expect(401);
    expect(invalidReplacement.body.code).toBe('AUTH_REQUIRED');
    expect(JSON.stringify(invalidReplacement.body)).not.toContain('expired replacement credential');
    expectNoStore(invalidReplacement);

    getCurrentCandidate.mockRejectedValueOnce(new ApplicationError('AUTH_REQUIRED', 'expired candidate'));
    const expired = await request(app.getHttpServer())
      .get('/api/v1/store/attribution/candidate')
      .set('X-Candidate-Token', candidateToken)
      .expect(401);
    expect(expired.body.code).toBe('AUTH_REQUIRED');
    expect(JSON.stringify(expired.body)).not.toContain('expired candidate');
    expectNoStore(expired);
  });
});
