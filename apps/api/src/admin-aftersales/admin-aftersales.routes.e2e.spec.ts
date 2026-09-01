import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { RbacPrincipal } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrincipalRequest } from '../platform/access/principal';
import { RbacGuard } from '../platform/access/rbac.guard';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import {
  AdminAftersalesController,
  AdminReturnAddressController,
} from './admin-aftersales.controller';
import { AdminAftersalesService } from './admin-aftersales.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const FACTOR_ID = '01J00000000000000000000003';
const AFTERSALE_ID = '01J00000000000000000000004';
const KEY = '00000000-0000-4000-8000-000000000001';
const HASH = 'a'.repeat(64);
const TOKEN = 'p'.repeat(16);
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';

const listAftersales = vi.fn();
const getAftersale = vi.fn();
const approveAftersale = vi.fn();
const previewReject = vi.fn();
const rejectAftersale = vi.fn();
const getReturnAddress = vi.fn();
const previewReturnAddress = vi.fn();
const publishReturnAddress = vi.fn();
const service = {
  approveAftersale,
  getAftersale,
  getReturnAddress,
  listAftersales,
  previewReject,
  previewReturnAddress,
  publishReturnAddress,
  rejectAftersale,
};

const superAdmin: RbacPrincipal = {
  accountId: ACCOUNT_ID,
  assurance: 'MFA',
  permissions: [],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId: SESSION_ID,
};
const customer: RbacPrincipal = { ...superAdmin, assurance: 'WECHAT', role: 'CUSTOMER' };

function setRequest(value: PrincipalRequest, principal: RbacPrincipal): void {
  value.principal = principal;
  value.requestId = REQUEST_ID;
  value.accessSession = {
    accessJti: 'access-jti',
    accountId: ACCOUNT_ID,
    accountVersion: 1,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    factorEncryptionKeyId: 'field-v1',
    factorId: FACTOR_ID,
    factorLastUsedTimestep: null,
    factorSecretCiphertext: new Uint8Array(),
    mfaVerifiedAt: new Date('2026-09-01T00:00:00.000Z'),
    sessionFamily: '01J00000000000000000000005',
    sessionId: SESSION_ID,
  };
}

@Injectable()
class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setRequest(context.switchToHttp().getRequest<PrincipalRequest>(), superAdmin);
    return true;
  }
}

@Injectable()
class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setRequest(context.switchToHttp().getRequest<PrincipalRequest>(), customer);
    return true;
  }
}

@Module({
  controllers: [AdminAftersalesController, AdminReturnAddressController],
  providers: [
    { provide: AdminAftersalesService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class SuperAdminRoutesModule {}

@Module({
  controllers: [AdminAftersalesController, AdminReturnAddressController],
  providers: [
    { provide: AdminAftersalesService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: CustomerGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class CustomerRoutesModule {}

function addressBody() {
  return {
    city: 'Central',
    detail: 'Development return desk',
    district: 'Harbour',
    phone: '+1 2-3',
    province: 'Auckland',
    reason: 'Update return desk',
    recipient_name: 'Returns team',
  };
}

function expectNoStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

describe('B12.2 Admin aftersales protected HTTP surface', () => {
  let app: INestApplication;
  let customerApp: INestApplication;

  beforeAll(async () => {
    const adminRef = await Test.createTestingModule({ imports: [SuperAdminRoutesModule] }).compile();
    app = adminRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
    const customerRef = await Test.createTestingModule({ imports: [CustomerRoutesModule] }).compile();
    customerApp = customerRef.createNestApplication({ logger: false });
    configureApi(customerApp);
    await customerApp.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listAftersales.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 20, total: 0 } });
    getAftersale.mockResolvedValue({ aftersale_id: AFTERSALE_ID });
    approveAftersale.mockResolvedValue({ aftersale_id: AFTERSALE_ID, status: 'REFUNDING' });
    previewReject.mockResolvedValue({ preview_token: TOKEN });
    rejectAftersale.mockResolvedValue({ aftersale_id: AFTERSALE_ID, status: 'REJECTED' });
    getReturnAddress.mockResolvedValue({ version_id: AFTERSALE_ID });
    previewReturnAddress.mockResolvedValue({ preview_token: TOKEN });
    publishReturnAddress.mockResolvedValue({ version_id: AFTERSALE_ID });
  });

  afterAll(async () => {
    await app.close();
    await customerApp.close();
  });

  it('maps list, detail, approve, and reject preview/confirm with no-store headers', async () => {
    const listed = await request(app.getHttpServer())
      .get('/api/v1/admin/aftersales?page=2&page_size=50&status=PENDING_REVIEW')
      .expect(200);
    expect(listAftersales).toHaveBeenCalledWith({ page: 2, pageSize: 50, status: 'PENDING_REVIEW' });
    expectNoStore(listed);

    const detail = await request(app.getHttpServer())
      .get(`/api/v1/admin/aftersales/${AFTERSALE_ID}`)
      .expect(200);
    expect(getAftersale).toHaveBeenCalledWith(AFTERSALE_ID);
    expectNoStore(detail);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/admin/aftersales/${AFTERSALE_ID}/approve`)
      .set('Idempotency-Key', KEY)
      .set('If-Match', '"1"')
      .send({ note: '  Accepted  ' })
      .expect(200);
    expect(approveAftersale).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId: REQUEST_ID }),
      AFTERSALE_ID,
      { note: 'Accepted' },
      1,
      KEY,
    );
    expectNoStore(approved);

    const preview = await request(app.getHttpServer())
      .post(`/api/v1/admin/aftersales/${AFTERSALE_ID}/reject-preview`)
      .set('Idempotency-Key', KEY)
      .send({ reason: '  Missing evidence  ' })
      .expect(200);
    expect(previewReject).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin }),
      AFTERSALE_ID,
      { reason: 'Missing evidence' },
      KEY,
    );
    expectNoStore(preview);

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/admin/aftersales/${AFTERSALE_ID}/reject`)
      .set('Idempotency-Key', KEY)
      .set('If-Match', '"1"')
      .send({ confirmation_hash: HASH, preview_token: TOKEN, reason: 'Missing evidence' })
      .expect(200);
    expect(rejectAftersale).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin }),
      AFTERSALE_ID,
      { confirmationHash: HASH, previewToken: TOKEN, reason: 'Missing evidence' },
      1,
      KEY,
    );
    expectNoStore(rejected);
  });

  it('maps GET, preview, and PATCH return-address routes with first-version If-Match=1', async () => {
    const current = await request(app.getHttpServer())
      .get('/api/v1/admin/settings/return-address')
      .expect(200);
    expect(getReturnAddress).toHaveBeenCalledOnce();
    expectNoStore(current);

    const preview = await request(app.getHttpServer())
      .post('/api/v1/admin/settings/return-address/preview')
      .set('Idempotency-Key', KEY)
      .send(addressBody())
      .expect(200);
    expect(previewReturnAddress).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin }),
      expect.objectContaining({ phone: '+1 2-3', recipientName: 'Returns team' }),
      KEY,
    );
    expectNoStore(preview);

    const published = await request(app.getHttpServer())
      .patch('/api/v1/admin/settings/return-address')
      .set('Idempotency-Key', KEY)
      .set('If-Match', '"1"')
      .send({ ...addressBody(), confirmation_hash: HASH, preview_token: TOKEN })
      .expect(200);
    expect(publishReturnAddress).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin }),
      expect.objectContaining({ confirmationHash: HASH, previewToken: TOKEN }),
      1,
      KEY,
    );
    expectNoStore(published);
  });

  it('rejects CUSTOMER access before parsing and dispatch, while retaining no-store', async () => {
    const response = await request(customerApp.getHttpServer())
      .post('/api/v1/admin/settings/return-address/preview')
      .send({ invalid: true })
      .expect(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
    expect(previewReturnAddress).not.toHaveBeenCalled();
    expectNoStore(response);
  });

  it('rejects missing strong headers and open bodies before service dispatch', async () => {
    const missingHeaders = await request(app.getHttpServer())
      .post(`/api/v1/admin/aftersales/${AFTERSALE_ID}/approve`)
      .send({ note: null })
      .expect(400);
    const openBody = await request(app.getHttpServer())
      .post('/api/v1/admin/settings/return-address/preview')
      .set('Idempotency-Key', KEY)
      .send({ ...addressBody(), extra: true })
      .expect(400);
    expectNoStore(missingHeaders);
    expectNoStore(openBody);
    expect(approveAftersale).not.toHaveBeenCalled();
    expect(previewReturnAddress).not.toHaveBeenCalled();
  });
});
