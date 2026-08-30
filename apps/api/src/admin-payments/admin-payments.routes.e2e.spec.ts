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
import { AdminPaymentsController } from './admin-payments.controller';
import { AdminPaymentsService } from './admin-payments.service';

const accountId = '01J00000000000000000000000';
const sessionId = '01J00000000000000000000001';
const factorId = '01J00000000000000000000002';
const paymentIntentId = '01J00000000000000000000003';
const idempotencyKey = '00000000-0000-4000-8000-000000000000';
const requestId = 'req_0123456789abcdef0123456789abcdef';

const listTasks = vi.fn();
const reconcile = vi.fn();
const service = { listTasks, reconcile };

const superAdmin: RbacPrincipal = {
  accountId,
  assurance: 'MFA',
  permissions: [],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId,
};

function setAuthenticatedRequest(requestValue: PrincipalRequest): void {
  requestValue.principal = superAdmin;
  requestValue.requestId = requestId;
  requestValue.accessSession = {
    accountId,
    accountVersion: 1,
    accessJti: 'access-jti',
    expiresAt: new Date('2026-08-30T02:00:00.000Z'),
    factorEncryptionKeyId: 'field-v1',
    factorId,
    factorLastUsedTimestep: null,
    factorSecretCiphertext: new Uint8Array(),
    mfaVerifiedAt: new Date('2026-08-30T00:00:00.000Z'),
    sessionFamily: '01J00000000000000000000004',
    sessionId,
  };
}

@Injectable()
class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    setAuthenticatedRequest(context.switchToHttp().getRequest<PrincipalRequest>());
    return true;
  }
}

@Module({
  controllers: [AdminPaymentsController],
  providers: [
    { provide: AdminPaymentsService, useValue: service },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class AdminPaymentsTestModule {}

describe('B10.5 admin payment reconciliation HTTP mapping', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AdminPaymentsTestModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    listTasks.mockResolvedValue({ items: [], pagination: { page: 1, page_size: 20, total: 0 } });
    reconcile.mockResolvedValue({ data: { outcome: 'CONVERGED' }, statusCode: 200 });
  });

  afterAll(async () => app.close());

  it('maps closed list filters and wraps the response once as 200', async () => {
    const data = {
      items: [{ payment_intent_id: paymentIntentId, task_type: 'PAYMENT_INTENT' }],
      pagination: { page: 2, page_size: 50, total: 1 },
    };
    listTasks.mockResolvedValue(data);

    const response = await request(app.getHttpServer())
      .get('/api/v1/admin/payment-intents/reconciliation-tasks')
      .query({
        due_before: '2026-08-30T01:02:03.000Z',
        intent_status: 'OPEN',
        last_error_code: 'PROVIDER_UNKNOWN',
        page: '2',
        page_size: '50',
        task_type: 'PAYMENT_INTENT',
      })
      .expect(200);

    expect(listTasks).toHaveBeenCalledWith({
      dueBefore: new Date('2026-08-30T01:02:03.000Z'),
      intentStatus: 'OPEN',
      lastErrorCode: 'PROVIDER_UNKNOWN',
      page: 2,
      pageSize: 50,
      taskType: 'PAYMENT_INTENT',
    });
    expect(response.body).toEqual({
      code: 'OK',
      data,
      message: 'success',
      request_id: requestId,
    });
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });

  it('returns a converged reconciliation as an exact 200 success envelope', async () => {
    const data = {
      outcome: 'CONVERGED',
      payment_intent_id: paymentIntentId,
      payment_intent_status: 'CLOSED',
      payment_resolution: 'NORMAL',
    };
    reconcile.mockResolvedValue({ data, statusCode: 200 });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/payment-intents/${paymentIntentId}/reconcile`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ reason: 'Retry provider status' })
      .expect(200);

    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      paymentIntentId,
      { reason: 'Retry provider status' },
      idempotencyKey,
    );
    expect(response.body).toEqual({ code: 'OK', data, message: 'success', request_id: requestId });
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });

  it('returns a pending reconciliation as one exact 202 accepted envelope', async () => {
    const data = {
      next_reconcile_at: '2026-08-30T01:02:03.000Z',
      payment_intent_id: paymentIntentId,
      status: 'OPEN',
      task_type: 'PAYMENT_INTENT',
    };
    reconcile.mockResolvedValue({ data, statusCode: 202 });

    const response = await request(app.getHttpServer())
      .post(`/api/v1/admin/payment-intents/${paymentIntentId}/reconcile`)
      .set('Idempotency-Key', idempotencyKey)
      .send({})
      .expect(202);

    expect(reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ principal: superAdmin, requestId }),
      paymentIntentId,
      {},
      idempotencyKey,
    );
    expect(response.body).toEqual({
      code: 'ACCEPTED',
      data,
      message: 'accepted',
      request_id: requestId,
    });
    expect(response.body.data.code).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store, private');
    expect(response.headers.pragma).toBe('no-cache');
  });
});
