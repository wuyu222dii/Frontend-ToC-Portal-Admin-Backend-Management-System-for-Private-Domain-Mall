import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ApplicationError, type RbacPrincipal } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrincipalRequest } from '../platform/access/principal';
import { RbacGuard } from '../platform/access/rbac.guard';
import { AuthenticationGuard } from '../platform/auth/authentication.guard';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { AdminInventoryController } from './admin-inventory.controller';
import { AdminInventoryService } from './admin-inventory.service';

const accountId = '01J00000000000000000000000';
const skuId = '01J00000000000000000000001';
const categoryId = '01J00000000000000000000002';
const factorId = '01J00000000000000000000003';
const sessionId = '01J00000000000000000000004';
const key = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const confirmationHash = 'a'.repeat(64);
const previewToken = `pvw_${'b'.repeat(43)}`;

const listInventory = vi.fn().mockResolvedValue({
  items: [], pagination: { page: 1, page_size: 20, total: 0 },
});
const previewAdjustment = vi.fn().mockResolvedValue({ operation: 'preview' });
const confirmAdjustment = vi.fn().mockResolvedValue({ operation: 'confirm' });
const listLedger = vi.fn().mockResolvedValue({
  items: [], pagination: { page: 1, page_size: 20, total: 0 },
});
const service = { confirmAdjustment, listInventory, listLedger, previewAdjustment };

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
  controllers: [AdminInventoryController],
  providers: [
    { provide: AdminInventoryService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: AuthenticationGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class UnauthenticatedInventoryTestModule {}

@Module({
  controllers: [AdminInventoryController],
  providers: [
    { provide: AdminInventoryService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class SuperAdminInventoryTestModule {}

@Module({
  controllers: [AdminInventoryController],
  providers: [
    { provide: AdminInventoryService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: CustomerGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class WrongRoleInventoryTestModule {}

describe('B5.2 admin Inventory protected HTTP surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [UnauthenticatedInventoryTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => app.close());

  it.each([
    ['list', () => request(app.getHttpServer()).get('/api/v1/admin/inventory?page=0'), false],
    ['preview', () => request(app.getHttpServer())
      .post('/api/v1/admin/inventory/not-a-sku/adjustment-preview').send({}), true],
    ['confirm', () => request(app.getHttpServer())
      .post('/api/v1/admin/inventory/not-a-sku/adjustments').send({}), true],
    ['ledger', () => request(app.getHttpServer())
      .get('/api/v1/admin/inventory/not-a-sku/ledger?date_from=not-a-date'), false],
  ] as const)(
    'returns 401 before %s request parsing or service dispatch',
    async (_operation, build, isNoStore) => {
      const response = await build().expect(401);
      expect(response.body.code).toBe('AUTH_REQUIRED');
      if (isNoStore) {
        expect(response.headers['cache-control']).toBe('no-store, private');
        expect(response.headers.pragma).toBe('no-cache');
      }
      expect(listInventory).not.toHaveBeenCalled();
      expect(previewAdjustment).not.toHaveBeenCalled();
      expect(confirmAdjustment).not.toHaveBeenCalled();
      expect(listLedger).not.toHaveBeenCalled();
    },
  );
});

describe('B5.2 admin Inventory SUPER_ADMIN HTTP mapping', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [SuperAdminInventoryTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listInventory.mockResolvedValue({
      items: [], pagination: { page: 1, page_size: 20, total: 0 },
    });
    previewAdjustment.mockResolvedValue({ operation: 'preview' });
    confirmAdjustment.mockResolvedValue({ operation: 'confirm' });
    listLedger.mockResolvedValue({
      items: [], pagination: { page: 1, page_size: 20, total: 0 },
    });
  });

  afterAll(async () => app.close());

  it('maps inventory list filters without imposing a keyword maximum', async () => {
    const keyword = 'W'.repeat(500);
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/inventory?page=2&page_size=50&category_id=${categoryId}&keyword=${keyword}`)
      .expect(200);
    expect(listInventory).toHaveBeenCalledWith({
      categoryId, keyword, page: 2, pageSize: 50,
    });
    expect(response.body).toEqual({
      code: 'OK',
      data: { items: [], pagination: { page: 1, page_size: 20, total: 0 } },
      message: 'success',
      request_id: requestId,
    });
  });

  it('maps adjustment preview with idempotency and no-store', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${skuId}/adjustment-preview`)
      .set('Idempotency-Key', key)
      .send({ physical_delta: 5, reason: 'Approved count correction' })
      .expect(200);
    expect(previewAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      skuId,
      { physicalDelta: 5, reason: 'Approved count correction' },
      key,
    );
    expect(response.body.data).toEqual({ operation: 'preview' });
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });

  it('maps adjustment confirmation with If-Match, capability fields and no-store', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${skuId}/adjustments`)
      .set('Idempotency-Key', key)
      .set('If-Match', '"3"')
      .send({
        confirmation_hash: confirmationHash,
        physical_delta: -2,
        preview_token: previewToken,
        reason: 'Approved count correction',
      })
      .expect(200);
    expect(confirmAdjustment).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      skuId,
      {
        confirmationHash,
        physicalDelta: -2,
        previewToken,
        reason: 'Approved count correction',
      },
      3,
      key,
    );
    expect(response.body.data).toEqual({ operation: 'confirm' });
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });

  it('maps ledger filters to an Asia/Shanghai UTC half-open interval', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/admin/inventory/${skuId}/ledger` +
        '?date_from=2026-08-25&date_to=2026-08-26&ledger_type=MANUAL_INCREASE&page=3&page_size=50')
      .expect(200);
    expect(listLedger).toHaveBeenCalledWith(skuId, {
      ledgerType: 'MANUAL_INCREASE',
      occurredAtFrom: new Date('2026-08-24T16:00:00.000Z'),
      occurredAtToExclusive: new Date('2026-08-26T16:00:00.000Z'),
      page: 3,
      pageSize: 50,
    });
  });

  it.each([
    ['missing preview Idempotency-Key', () => request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${skuId}/adjustment-preview`)
      .send({ physical_delta: 1, reason: 'Approved count' }), true],
    ['missing confirmation If-Match', () => request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${skuId}/adjustments`)
      .set('Idempotency-Key', key)
      .send({
        confirmation_hash: confirmationHash,
        physical_delta: 1,
        preview_token: previewToken,
        reason: 'Approved count',
      }), true],
    ['zero physical delta', () => request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${skuId}/adjustment-preview`)
      .set('Idempotency-Key', key)
      .send({ physical_delta: 0, reason: 'Approved count' }), true],
    ['open adjustment body', () => request(app.getHttpServer())
      .post(`/api/v1/admin/inventory/${skuId}/adjustment-preview`)
      .set('Idempotency-Key', key)
      .send({ physical_delta: 1, reason: 'Approved count', low_stock: true }), true],
    ['invalid ledger calendar date', () => request(app.getHttpServer())
      .get(`/api/v1/admin/inventory/${skuId}/ledger?date_from=2026-02-29`), false],
  ] as const)('returns frozen 400 before service dispatch for %s', async (_label, build, isNoStore) => {
    const response = await build().expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
    if (isNoStore) {
      expect(response.headers['cache-control']).toBe('no-store, private');
      expect(response.headers.pragma).toBe('no-cache');
    }
    expect(previewAdjustment).not.toHaveBeenCalled();
    expect(confirmAdjustment).not.toHaveBeenCalled();
    expect(listLedger).not.toHaveBeenCalled();
  });

  it.each([
    ['preview', 'STATE_CONFLICT', 409, previewAdjustment],
    ['confirm', 'RESOURCE_VERSION_CONFLICT', 409, confirmAdjustment],
    ['confirm', 'PREVIEW_EXPIRED', 409, confirmAdjustment],
    ['confirm', 'CONFIRMATION_MISMATCH', 409, confirmAdjustment],
    ['confirm', 'STOCK_INSUFFICIENT', 422, confirmAdjustment],
    ['confirm', 'INVENTORY_QUANTITY_OUT_OF_RANGE', 422, confirmAdjustment],
  ] as const)(
    'maps %s %s to the frozen HTTP %s envelope',
    async (operation, code, status, serviceMethod) => {
      serviceMethod.mockRejectedValueOnce(new ApplicationError(code, 'Inventory adjustment rejected'));
      const probe = operation === 'preview'
        ? request(app.getHttpServer())
          .post(`/api/v1/admin/inventory/${skuId}/adjustment-preview`)
          .set('Idempotency-Key', key)
          .send({ physical_delta: 1, reason: 'Approved count' })
        : request(app.getHttpServer())
          .post(`/api/v1/admin/inventory/${skuId}/adjustments`)
          .set('Idempotency-Key', key)
          .set('If-Match', '"3"')
          .send({
            confirmation_hash: confirmationHash,
            physical_delta: 1,
            preview_token: previewToken,
            reason: 'Approved count',
          });
      const response = await probe.expect(status);
      expect(response.body).toMatchObject({ code, request_id: requestId });
      expect(response.headers['cache-control']).toBe('no-store, private');
      expect(response.headers.pragma).toBe('no-cache');
    },
  );
});

describe('B5.2 admin Inventory wrong-role HTTP boundary', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [WrongRoleInventoryTestModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => vi.clearAllMocks());

  afterAll(async () => app.close());

  it.each([
    ['list', () => request(app.getHttpServer()).get('/api/v1/admin/inventory?page=0'), listInventory],
    ['preview', () => request(app.getHttpServer())
      .post('/api/v1/admin/inventory/not-a-sku/adjustment-preview').send({}), previewAdjustment],
    ['confirm', () => request(app.getHttpServer())
      .post('/api/v1/admin/inventory/not-a-sku/adjustments').send({}), confirmAdjustment],
    ['ledger', () => request(app.getHttpServer())
      .get('/api/v1/admin/inventory/not-a-sku/ledger?date_from=not-a-date'), listLedger],
  ] as const)(
    'returns 403 before %s request parsing or service dispatch for an authenticated CUSTOMER',
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
