import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { RbacPrincipal } from '@qingxu/platform-core';
import { ApplicationError } from '@qingxu/platform-core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../app.module';
import type { PrincipalRequest } from '../platform/access/principal';
import { RbacGuard } from '../platform/access/rbac.guard';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { AdminBannersController } from './admin-banners.controller';
import { AdminBannersService } from './admin-banners.service';

const accountId = '01J00000000000000000000000';
const bannerId = '01J00000000000000000000001';
const fileId = '01J00000000000000000000002';
const factorId = '01J00000000000000000000003';
const sessionId = '01J00000000000000000000004';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';

const listBanners = vi.fn().mockResolvedValue({ items: [], pagination: { page: 1, page_size: 20, total: 0 } });
const createBanner = vi.fn().mockResolvedValue({ operation: 'create' });
const patchBanner = vi.fn().mockResolvedValue({ operation: 'patch' });
const archiveBanner = vi.fn().mockResolvedValue({ operation: 'archive' });
const restoreBanner = vi.fn().mockResolvedValue({ operation: 'restore' });
const service = { archiveBanner, createBanner, listBanners, patchBanner, restoreBanner };

const superAdmin: RbacPrincipal = {
  accountId,
  assurance: 'MFA',
  permissions: [],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId,
};

const customer: RbacPrincipal = {
  accountId,
  assurance: 'WECHAT',
  permissions: [],
  restriction: 'NONE',
  role: 'CUSTOMER',
  sessionId,
};

function setAuthenticatedRequest(requestValue: PrincipalRequest, principal: RbacPrincipal): void {
  requestValue.principal = principal;
  requestValue.requestId = requestId;
  requestValue.accessSession = {
    accountId,
    accountVersion: 1,
    accessJti: 'access-jti',
    expiresAt: new Date('2026-08-25T01:00:00.000Z'),
    factorEncryptionKeyId: 'key',
    factorId,
    factorLastUsedTimestep: null,
    factorSecretCiphertext: new Uint8Array(),
    mfaVerifiedAt: new Date('2026-08-25T00:00:00.000Z'),
    sessionFamily: '01J00000000000000000000005',
    sessionId,
  };
}

@Injectable()
class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setAuthenticatedRequest(context.switchToHttp().getRequest<PrincipalRequest>(), superAdmin);
    return true;
  }
}

@Injectable()
class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setAuthenticatedRequest(context.switchToHttp().getRequest<PrincipalRequest>(), customer);
    return true;
  }
}

@Module({
  controllers: [AdminBannersController],
  providers: [
    { provide: AdminBannersService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class SuperAdminBannersTestModule {}

@Module({
  controllers: [AdminBannersController],
  providers: [
    { provide: AdminBannersService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: CustomerGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class WrongRoleBannersTestModule {}

describe('B5.1 admin Banner protected HTTP surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it('protects Banner list with the SUPER_ADMIN bearer boundary', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/admin/banners').expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
  });

  it.each([
    ['post', '/api/v1/admin/banners', null, {
      file_id: fileId, initial_status: 'DRAFT', sort_order: 0, target_type: 'NONE', title: 'Campaign',
    }],
    ['patch', `/api/v1/admin/banners/${bannerId}`, '"1"', { action: 'ACTIVATE' }],
    ['delete', `/api/v1/admin/banners/${bannerId}`, '"1"', { reason: 'Campaign has ended' }],
    ['post', `/api/v1/admin/banners/${bannerId}/restore`, '"2"', { reason: 'Resume campaign' }],
  ] as const)('protects and disables caching for %s %s', async (method, path, ifMatch, body) => {
    let probe = request(app.getHttpServer())[method](path).set('Idempotency-Key', key);
    if (ifMatch !== null) probe = probe.set('If-Match', ifMatch);
    const response = await probe.send(body).expect(401);
    expect(response.body.code).toBe('AUTH_REQUIRED');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });
});

describe('B5.1 admin Banner SUPER_ADMIN HTTP mapping', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SuperAdminBannersTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listBanners.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 20, total: 0 } });
    createBanner.mockResolvedValue({ operation: 'create' });
    patchBanner.mockResolvedValue({ operation: 'patch' });
    archiveBanner.mockResolvedValue({ operation: 'archive' });
    restoreBanner.mockResolvedValue({ operation: 'restore' });
  });

  afterAll(async () => app.close());

  it('maps list query and wraps the response', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/banners?page=2&page_size=50&status=ARCHIVED&keyword=Campaign')
      .expect(200);
    expect(listBanners).toHaveBeenCalledWith({
      keyword: 'Campaign', page: 2, pageSize: 50, status: 'ARCHIVED',
    });
    expect(response.body).toEqual({
      code: 'OK',
      data: { items: [], pagination: { page: 1, page_size: 20, total: 0 } },
      message: 'success',
      request_id: requestId,
    });
  });

  it('maps DRAFT create to HTTP 201 with idempotency and no-store', async () => {
    const response = await request(app.getHttpServer()).post('/api/v1/admin/banners')
      .set('Idempotency-Key', key)
      .send({
        file_id: fileId,
        initial_status: 'DRAFT',
        sort_order: 0,
        target_type: 'NONE',
        title: 'Campaign',
      })
      .expect(201);
    expect(createBanner).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      { fileId, initialStatus: 'DRAFT', sortOrder: 0, target: { type: 'NONE' }, title: 'Campaign' },
      key,
    );
    expect(response.body.data).toEqual({ operation: 'create' });
    expect(response.headers['cache-control']).toBe('no-store, private');
  });

  it('maps the status PATCH branch with If-Match and no reason', async () => {
    const response = await request(app.getHttpServer()).patch(`/api/v1/admin/banners/${bannerId}`)
      .set('Idempotency-Key', key)
      .set('If-Match', '"3"')
      .send({ action: 'DEACTIVATE' })
      .expect(200);
    expect(patchBanner).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      bannerId,
      { action: 'DEACTIVATE', kind: 'STATUS' },
      3,
      key,
    );
    expect(response.headers['cache-control']).toBe('no-store, private');
  });

  it('maps DELETE and restore as distinct reason-bearing operations', async () => {
    await request(app.getHttpServer()).delete(`/api/v1/admin/banners/${bannerId}`)
      .set('Idempotency-Key', key).set('If-Match', '"4"')
      .send({ reason: 'Campaign has ended' }).expect(200);
    expect(archiveBanner).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin }),
      bannerId,
      { reason: 'Campaign has ended' },
      4,
      key,
    );
    await request(app.getHttpServer()).post(`/api/v1/admin/banners/${bannerId}/restore`)
      .set('Idempotency-Key', key).set('If-Match', '"5"')
      .send({ reason: 'Resume campaign' }).expect(200);
    expect(restoreBanner).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin }),
      bannerId,
      { reason: 'Resume campaign' },
      5,
      key,
    );
  });

  it.each([
    ['missing Idempotency-Key', () => request(app.getHttpServer()).post('/api/v1/admin/banners').send({
      file_id: fileId, initial_status: 'DRAFT', sort_order: 0, target_type: 'NONE', title: 'Campaign',
    })],
    ['missing If-Match', () => request(app.getHttpServer()).patch(`/api/v1/admin/banners/${bannerId}`)
      .set('Idempotency-Key', key).send({ action: 'ACTIVATE' })],
    ['mixed PATCH branches', () => request(app.getHttpServer()).patch(`/api/v1/admin/banners/${bannerId}`)
      .set('Idempotency-Key', key).set('If-Match', '"1"')
      .send({ action: 'ACTIVATE', title: 'Mixed' })],
    ['URL userinfo', () => request(app.getHttpServer()).post('/api/v1/admin/banners')
      .set('Idempotency-Key', key).send({
        file_id: fileId, initial_status: 'DRAFT', sort_order: 0, target_type: 'URL',
        target_url: 'https://user:password@mall.example.test/path', title: 'Campaign',
      })],
  ] as const)('returns frozen 400 before service dispatch for %s', async (_label, build) => {
    const response = await build().expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(createBanner).not.toHaveBeenCalled();
    expect(patchBanner).not.toHaveBeenCalled();
  });

  it.each([
    ['STATE_CONFLICT', 'Banner target is inactive'],
    ['RESOURCE_VERSION_CONFLICT', 'Banner version changed'],
  ] as const)('maps repository %s to the frozen HTTP 409 envelope', async (code, message) => {
    patchBanner.mockRejectedValueOnce(new ApplicationError(code, message));
    const response = await request(app.getHttpServer()).patch(`/api/v1/admin/banners/${bannerId}`)
      .set('Idempotency-Key', key).set('If-Match', '"1"')
      .send({ action: 'ACTIVATE' }).expect(409);
    expect(response.body).toMatchObject({ code, request_id: requestId });
    expect(response.headers['cache-control']).toBe('no-store, private');
  });
});

describe('B5.1 admin Banner wrong-role HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WrongRoleBannersTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => app.close());

  it.each([
    ['list', () => request(app.getHttpServer()).get('/api/v1/admin/banners?page=0'), listBanners],
    ['create', () => request(app.getHttpServer()).post('/api/v1/admin/banners').send({}), createBanner],
    ['patch', () => request(app.getHttpServer()).patch('/api/v1/admin/banners/not-a-banner')
      .send({ action: 'SOFT_DELETE', title: 'Mixed' }), patchBanner],
    ['delete', () => request(app.getHttpServer()).delete('/api/v1/admin/banners/not-a-banner')
      .send({}), archiveBanner],
    ['restore', () => request(app.getHttpServer()).post('/api/v1/admin/banners/not-a-banner/restore')
      .send({ reason: '' }), restoreBanner],
  ] as const)(
    'returns 403 before %s parsing or service dispatch for an authenticated CUSTOMER',
    async (_operation, build, serviceMethod) => {
      const response = await build().expect(403);
      expect(response.body).toEqual({
        code: 'PERMISSION_DENIED',
        message: 'Permission denied',
        request_id: requestId,
      });
      expect(serviceMethod).not.toHaveBeenCalled();
    },
  );
});
