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
import { AgentCommerceController } from './agent-commerce.controller';
import { AgentCommerceService } from './agent-commerce.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const AGENT_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const SESSION_FAMILY = '01J00000000000000000000003';
const PRODUCT_ID = '01J00000000000000000000004';
const BRAND_ID = '01J00000000000000000000005';
const CATEGORY_ID = '01J00000000000000000000006';
const PROMOTION_ASSET_ID = '01J00000000000000000000007';
const ADMIN_SESSION_ID = '01J00000000000000000000008';
const STORE_SESSION_ID = '01J00000000000000000000009';
const ACCESS_JTI = 'access:01J0000000000000000000000A';
const KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'trace_0123456789abcdef0123456789abcdef';

const signingKeys = {
  current: { id: 'agent-commerce-routes-v1', key: Buffer.alloc(32, 82) },
  previous: [],
};
const runtimeConfig = {
  agent: { authTokenAudience: 'qingxu-agent-web' },
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-agent-commerce-routes-test',
    signingKeys,
  },
  store: { authTokenAudience: 'qingxu-store' },
} as unknown as PlatformRuntimeConfig;

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
  sessionId: SESSION_ID,
  tokenId: ACCESS_JTI,
}, 3_600).token}`;
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
  tokenId: 'access:01J0000000000000000000000B',
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
  tokenId: 'access:01J0000000000000000000000C',
}, 3_600).token}`;

const listProducts = vi.fn();
const getProduct = vi.fn();
const createPromotionAsset = vi.fn();
const service = { createPromotionAsset, getProduct, listProducts };
const findUnique = vi.fn();
const database = {
  prisma: { authSession: { findUnique } },
} as unknown as DatabaseRuntime;

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

@Module({
  controllers: [AgentCommerceController],
  providers: [
    { provide: AgentCommerceService, useValue: service },
    { provide: API_RUNTIME_CONFIG, useValue: runtimeConfig },
    { provide: API_DATABASE_RUNTIME, useValue: database },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class AgentCommerceRoutesTestModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes({ method: RequestMethod.ALL, path: '{*path}' });
  }
}

describe('B13.2 Agent commerce HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AgentCommerceRoutesTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    findUnique.mockResolvedValue({
      access_jti: ACCESS_JTI,
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
        must_change_password: false,
        password_hash: 'argon2-agent-password-hash',
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        version: 4,
      },
      account_id: ACCOUNT_ID,
      assurance: 'PASSWORD',
      expires_at: new Date('2099-01-01T00:00:00.000Z'),
      id: SESSION_ID,
      mfa_factor_id: null,
      mfa_verified_at: null,
      refresh_token_hash: 'refresh-hash',
      restriction: 'NONE',
      revoked_at: null,
      rotation_counter: 2,
      session_family: SESSION_FAMILY,
    });
    listProducts.mockResolvedValue({ items: [], pagination: { page: 2, page_size: 50, total: 0 } });
    getProduct.mockResolvedValue({ product_id: PRODUCT_ID, status: 'ACTIVE' });
    createPromotionAsset.mockResolvedValue({
      promotion_asset_id: PROMOTION_ASSET_ID,
      target_id: PRODUCT_ID,
      target_type: 'PRODUCT',
    });
  });

  afterAll(async () => app.close());

  it('accepts an Agent token and maps all three routes to the service', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/agent/products')
      .set('Authorization', agentBearer)
      .query({
        brand_id: BRAND_ID,
        category_id: CATEGORY_ID,
        keyword: ' Daily ',
        page: '2',
        page_size: '50',
        recommended: 'false',
      })
      .expect(200);
    expect(listProducts).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        agentId: AGENT_ID,
        restriction: 'NONE',
        sessionId: SESSION_ID,
      }),
      {
        brandId: BRAND_ID,
        categoryId: CATEGORY_ID,
        keyword: 'Daily',
        page: 2,
        pageSize: 50,
        recommended: false,
      },
    );

    await request(app.getHttpServer())
      .get(`/api/v1/agent/products/${PRODUCT_ID}`)
      .set('Authorization', agentBearer)
      .expect(200);
    expect(getProduct).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID, sessionId: SESSION_ID }),
      PRODUCT_ID,
    );

    const promotion = await request(app.getHttpServer())
      .post('/api/v1/agent/promotion-assets')
      .set('Authorization', agentBearer)
      .set('Idempotency-Key', KEY)
      .set('X-Request-Id', REQUEST_ID)
      .send({ target_id: PRODUCT_ID, target_type: 'PRODUCT' })
      .expect(200);
    expect(createPromotionAsset).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: AGENT_ID, sessionId: SESSION_ID }),
      { targetId: PRODUCT_ID, targetType: 'PRODUCT' },
      KEY,
      REQUEST_ID,
      expect.any(String),
    );
    expect(promotion.body).toEqual(expect.objectContaining({ code: 'OK', request_id: REQUEST_ID }));
    expectNoStore(promotion);
  });

  it.each([
    ['Admin', adminBearer],
    ['Store', storeBearer],
  ])('rejects a %s token at the Agent realm before service dispatch', async (_realm, bearer) => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/agent/products')
      .set('Authorization', bearer)
      .expect(401);

    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(findUnique).not.toHaveBeenCalled();
    expect(listProducts).not.toHaveBeenCalled();
    expect(getProduct).not.toHaveBeenCalled();
    expect(createPromotionAsset).not.toHaveBeenCalled();
  });

  it('rejects unknown query fields and an invalid body before service dispatch', async () => {
    const probes = [
      () => request(app.getHttpServer())
        .get('/api/v1/agent/products?debug=true')
        .set('Authorization', agentBearer),
      () => request(app.getHttpServer())
        .get(`/api/v1/agent/products/${PRODUCT_ID}?debug=true`)
        .set('Authorization', agentBearer),
      () => request(app.getHttpServer())
        .post('/api/v1/agent/promotion-assets?debug=true')
        .set('Authorization', agentBearer)
        .set('Idempotency-Key', KEY)
        .send({ target_id: PRODUCT_ID, target_type: 'PRODUCT' }),
      () => request(app.getHttpServer())
        .post('/api/v1/agent/promotion-assets')
        .set('Authorization', agentBearer)
        .set('Idempotency-Key', KEY)
        .send({ extra: true, target_id: PRODUCT_ID, target_type: 'PRODUCT' }),
    ];

    for (const probe of probes) {
      const response = await probe().expect(400);
      expect(response.body.code).toBe('INVALID_ARGUMENT');
    }
    expect(listProducts).not.toHaveBeenCalled();
    expect(getProduct).not.toHaveBeenCalled();
    expect(createPromotionAsset).not.toHaveBeenCalled();
  });
});
