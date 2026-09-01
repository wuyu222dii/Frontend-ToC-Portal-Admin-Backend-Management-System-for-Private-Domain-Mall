import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PrincipalRequest } from '../platform/access/principal';
import { RbacGuard } from '../platform/access/rbac.guard';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import {
  AdminAftersaleRefundsController,
  AdminManualCompensationsController,
  AdminRefundsController,
} from './admin-refunds.controller';
import { AdminRefundsService } from './admin-refunds.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const FACTOR_ID = '01J00000000000000000000003';
const AFTERSALE_ID = '01J00000000000000000000004';
const AFTERSALE_ITEM_ID = '01J00000000000000000000005';
const REFUND_ID = '01J00000000000000000000006';
const ORDER_ID = '01J00000000000000000000007';
const ORDER_ITEM_ID = '01J00000000000000000000008';
const PREVIEW_KEY = '00000000-0000-4000-8000-000000000001';
const CONFIRM_KEY = '00000000-0000-4000-8000-000000000002';
const HASH = 'a'.repeat(64);
const TOKEN = 'preview-token-with-sufficient-length';

const service = {
  createAftersaleRefund: vi.fn(),
  createManualCompensation: vi.fn(),
  previewAftersaleRefund: vi.fn(),
  previewManualCompensation: vi.fn(),
  previewRefundRetry: vi.fn(),
  retryRefund: vi.fn(),
};

@Injectable()
class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const value = context.switchToHttp().getRequest<PrincipalRequest>();
    value.requestId = 'req_0123456789abcdef0123456789abcdef';
    value.principal = {
      accountId: ACCOUNT_ID,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: SESSION_ID,
    };
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
      sessionFamily: '01J00000000000000000000009',
      sessionId: SESSION_ID,
    };
    return true;
  }
}

@Injectable()
class CustomerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const value = context.switchToHttp().getRequest<PrincipalRequest>();
    value.requestId = 'req_0123456789abcdef0123456789abcdef';
    value.principal = {
      accountId: ACCOUNT_ID,
      assurance: 'WECHAT',
      permissions: [],
      restriction: 'NONE',
      role: 'CUSTOMER',
      sessionId: SESSION_ID,
    };
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
      sessionFamily: '01J00000000000000000000009',
      sessionId: SESSION_ID,
    };
    return true;
  }
}

@Module({
  controllers: [
    AdminAftersaleRefundsController,
    AdminRefundsController,
    AdminManualCompensationsController,
  ],
  providers: [
    { provide: AdminRefundsService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class RoutesModule {}

@Module({
  controllers: [
    AdminAftersaleRefundsController,
    AdminRefundsController,
    AdminManualCompensationsController,
  ],
  providers: [
    { provide: AdminRefundsService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: CustomerGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
})
class CustomerRoutesModule {}

function noStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function refundBody() {
  return {
    items: [{ aftersale_item_id: AFTERSALE_ITEM_ID, quantity: 1 }],
    reason: 'Approve the frozen refund',
  };
}

function confirmation<T extends Record<string, unknown>>(body: T) {
  return { ...body, confirmation_hash: HASH, preview_token: TOKEN };
}

describe('B12.4 Admin refund protected HTTP surface', () => {
  let app: INestApplication;
  let customerApp: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [RoutesModule] }).compile();
    app = module.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
    const customerModule = await Test.createTestingModule({ imports: [CustomerRoutesModule] }).compile();
    customerApp = customerModule.createNestApplication({ logger: false });
    configureApi(customerApp);
    await customerApp.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    service.previewAftersaleRefund.mockResolvedValue({ preview_token: TOKEN });
    service.createAftersaleRefund.mockResolvedValue({ refund_id: REFUND_ID });
    service.previewRefundRetry.mockResolvedValue({ preview_token: TOKEN });
    service.retryRefund.mockResolvedValue({ refund_id: REFUND_ID });
    service.previewManualCompensation.mockResolvedValue({ preview_token: TOKEN });
    service.createManualCompensation.mockResolvedValue({ refund_id: REFUND_ID });
  });

  afterAll(async () => {
    await app.close();
    await customerApp.close();
  });

  it('rejects CUSTOMER callers before invoking any refund operation', async () => {
    const denied = await request(customerApp.getHttpServer())
      .post(`/api/v1/admin/refunds/${REFUND_ID}/retry-preview`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send({ reason: 'Retry the explicit provider failure' })
      .expect(403);

    noStore(denied);
    expect(denied.body.code).toBe('PERMISSION_DENIED');
    expect(service.previewRefundRetry).not.toHaveBeenCalled();
  });

  it('maps aftersale refund preview and confirm with exact status and no-store', async () => {
    const preview = await request(app.getHttpServer())
      .post(`/api/v1/admin/aftersales/${AFTERSALE_ID}/refund-preview`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send(refundBody())
      .expect(200);
    noStore(preview);
    expect(service.previewAftersaleRefund).toHaveBeenCalledWith(
      expect.any(Object), AFTERSALE_ID, {
        items: [{ aftersaleItemId: AFTERSALE_ITEM_ID, quantity: 1 }],
        reason: 'Approve the frozen refund',
      }, PREVIEW_KEY,
    );

    const created = await request(app.getHttpServer())
      .post(`/api/v1/admin/aftersales/${AFTERSALE_ID}/refunds`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .set('If-Match', '"3"')
      .send(confirmation(refundBody()))
      .expect(200);
    noStore(created);
    expect(service.createAftersaleRefund).toHaveBeenCalledWith(
      expect.any(Object), AFTERSALE_ID, expect.objectContaining({
        confirmationHash: HASH,
        previewToken: TOKEN,
      }), 3, CONFIRM_KEY,
    );
  });

  it('maps stable refund retry preview and confirm', async () => {
    const preview = await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${REFUND_ID}/retry-preview`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send({ reason: 'Retry the explicit provider failure' })
      .expect(200);
    noStore(preview);

    const retried = await request(app.getHttpServer())
      .post(`/api/v1/admin/refunds/${REFUND_ID}/retry`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .set('If-Match', '"4"')
      .send(confirmation({ reason: 'Retry the explicit provider failure' }))
      .expect(200);
    noStore(retried);
    expect(service.previewRefundRetry).toHaveBeenCalledWith(
      expect.any(Object), REFUND_ID, { reason: 'Retry the explicit provider failure' }, PREVIEW_KEY,
    );
    expect(service.retryRefund).toHaveBeenCalledWith(
      expect.any(Object), REFUND_ID, expect.objectContaining({ previewToken: TOKEN }), 4, CONFIRM_KEY,
    );
  });

  it('maps manual compensation preview and 201 confirm', async () => {
    const body = { amount: '12.34', order_item_id: ORDER_ITEM_ID, reason: 'Service recovery credit' };
    const preview = await request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${ORDER_ID}/manual-compensations/preview`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send(body)
      .expect(200);
    noStore(preview);

    const created = await request(app.getHttpServer())
      .post(`/api/v1/admin/orders/${ORDER_ID}/manual-compensations`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .set('If-Match', '"5"')
      .send(confirmation(body))
      .expect(201);
    noStore(created);
    expect(service.previewManualCompensation).toHaveBeenCalledWith(
      expect.any(Object), ORDER_ID, {
        amount: '12.34', orderItemId: ORDER_ITEM_ID, reason: 'Service recovery credit',
      }, PREVIEW_KEY,
    );
    expect(service.createManualCompensation).toHaveBeenCalledWith(
      expect.any(Object), ORDER_ID, expect.objectContaining({ confirmationHash: HASH }), 5, CONFIRM_KEY,
    );
  });
});
