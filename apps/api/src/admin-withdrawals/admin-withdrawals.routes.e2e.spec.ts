import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type INestApplication,
  Module,
} from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { generateUlid } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { REQUIRED_ROLES } from '../platform/access/rbac.metadata';
import { RbacGuard } from '../platform/access/rbac.guard';
import type { PrincipalRequest } from '../platform/access/principal';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { NO_STORE_RESPONSE } from '../platform/http/no-store.decorator';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { AdminWithdrawalsController } from './admin-withdrawals.controller';
import { AdminWithdrawalsService } from './admin-withdrawals.service';

const ACCOUNT_ID = generateUlid();
const AGENT_ID = generateUlid();
const FILE_ID = generateUlid();
const SESSION_ID = generateUlid();
const WITHDRAWAL_ID = generateUlid();
const PREVIEW_KEY = '00000000-0000-4000-8000-000000000001';
const CONFIRM_KEY = '00000000-0000-4000-8000-000000000002';
const HASH = 'a'.repeat(64);
const TOKEN = 'preview-token-with-sufficient-length';

const service = {
  approve: vi.fn(),
  attachProofs: vi.fn(),
  detail: vi.fn(),
  list: vi.fn(),
  markPaid: vi.fn(),
  previewApprove: vi.fn(),
  previewMarkPaid: vi.fn(),
  previewReject: vi.fn(),
  reject: vi.fn(),
  revealPayoutAccount: vi.fn(),
};

@Injectable()
class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const target = context.switchToHttp().getRequest<PrincipalRequest>();
    target.requestId = 'req_0123456789abcdef0123456789abcdef';
    target.principal = {
      accountId: ACCOUNT_ID,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: SESSION_ID,
    };
    target.accessSession = { accountId: ACCOUNT_ID, sessionId: SESSION_ID } as NonNullable<PrincipalRequest['accessSession']>;
    return true;
  }
}

@Module({
  controllers: [AdminWithdrawalsController],
  providers: [
    { provide: AdminWithdrawalsService, useValue: service },
    { provide: APP_GUARD, useClass: SuperAdminGuard },
    { provide: APP_GUARD, useClass: RbacGuard },
    { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
    { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
  ],
})
class RoutesModule {}

function noStore(response: { headers: Record<string, string | string[] | undefined> }): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function confirmation(body: Record<string, unknown> = {}) {
  return { ...body, confirmation_hash: HASH, preview_token: TOKEN };
}

describe('B13.6 Admin withdrawal protected HTTP surface', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [RoutesModule] }).compile();
    app = module.createNestApplication({ logger: false });
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of Object.values(service)) method.mockResolvedValue({ withdrawal_id: WITHDRAWAL_ID });
  });

  afterAll(async () => app.close());

  it('requires SUPER_ADMIN and marks all ten operations no-store', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, AdminWithdrawalsController)).toEqual(['SUPER_ADMIN']);
    for (const handler of [
      AdminWithdrawalsController.prototype.list,
      AdminWithdrawalsController.prototype.detail,
      AdminWithdrawalsController.prototype.previewApprove,
      AdminWithdrawalsController.prototype.approve,
      AdminWithdrawalsController.prototype.previewReject,
      AdminWithdrawalsController.prototype.reject,
      AdminWithdrawalsController.prototype.revealPayoutAccount,
      AdminWithdrawalsController.prototype.attachProofs,
      AdminWithdrawalsController.prototype.previewMarkPaid,
      AdminWithdrawalsController.prototype.markPaid,
    ]) expect(Reflect.getMetadata(NO_STORE_RESPONSE, handler)).toBe(true);
  });

  it('maps list and masked detail reads through strict query decoding', async () => {
    const list = await request(app.getHttpServer())
      .get(`/api/v1/admin/withdrawals?agent_id=${AGENT_ID}&status=APPROVED&page=2&page_size=50`)
      .expect(200);
    noStore(list);
    expect(service.list).toHaveBeenCalledWith({ agentId: AGENT_ID, page: 2, pageSize: 50, status: 'APPROVED' });

    const detail = await request(app.getHttpServer()).get(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}`).expect(200);
    noStore(detail);
    expect(service.detail).toHaveBeenCalledWith(WITHDRAWAL_ID);

    await request(app.getHttpServer()).get('/api/v1/admin/withdrawals?debug=1').expect(400);
    await request(app.getHttpServer()).get(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}?debug=1`).expect(400);
  });

  it('maps approve and reject preview-confirm commands with distinct headers', async () => {
    const approvePreview = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/approve-preview`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send({})
      .expect(200);
    noStore(approvePreview);
    expect(service.previewApprove).toHaveBeenCalledWith(expect.any(Object), WITHDRAWAL_ID, PREVIEW_KEY);

    const approved = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/approve`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .set('If-Match', '"3"')
      .send(confirmation())
      .expect(200);
    noStore(approved);
    expect(service.approve).toHaveBeenCalledWith(
      expect.any(Object), WITHDRAWAL_ID, { confirmationHash: HASH, previewToken: TOKEN }, 3, CONFIRM_KEY,
    );

    const rejectPreview = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/reject-preview`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send({ reason: '  Account holder mismatch  ' })
      .expect(200);
    noStore(rejectPreview);
    expect(service.previewReject).toHaveBeenCalledWith(
      expect.any(Object), WITHDRAWAL_ID, { reason: 'Account holder mismatch' }, PREVIEW_KEY,
    );

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/reject`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .set('If-Match', '"4"')
      .send(confirmation({ reason: 'Account holder mismatch' }))
      .expect(200);
    noStore(rejected);
    expect(service.reject).toHaveBeenCalledWith(
      expect.any(Object), WITHDRAWAL_ID,
      { confirmationHash: HASH, previewToken: TOKEN, reason: 'Account holder mismatch' }, 4, CONFIRM_KEY,
    );
  });

  it('maps one-time reveal and proof attachment without accepting loose input', async () => {
    const grant = 'rag_0123456789abcdefghijklmnop';
    const reveal = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/payout-account-reveal`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .set('If-Match', '"2"')
      .send({ reauth_grant: grant })
      .expect(200);
    noStore(reveal);
    expect(service.revealPayoutAccount).toHaveBeenCalledWith(
      expect.any(Object), WITHDRAWAL_ID, { reauthGrant: grant }, 2, CONFIRM_KEY,
    );

    const proofs = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/proofs`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send({ file_ids: [FILE_ID] })
      .expect(200);
    noStore(proofs);
    expect(service.attachProofs).toHaveBeenCalledWith(
      expect.any(Object), WITHDRAWAL_ID, { fileIds: [FILE_ID] }, PREVIEW_KEY,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/proofs`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send({ file_ids: [FILE_ID], extra: true })
      .expect(400);
  });

  it('maps mark-paid preview-confirm and requires Idempotency-Key plus If-Match', async () => {
    const preview = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/mark-paid-preview`)
      .set('Idempotency-Key', PREVIEW_KEY)
      .send({ proof_file_ids: [FILE_ID] })
      .expect(200);
    noStore(preview);
    expect(service.previewMarkPaid).toHaveBeenCalledWith(
      expect.any(Object), WITHDRAWAL_ID, { proofFileIds: [FILE_ID] }, PREVIEW_KEY,
    );

    const paid = await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/mark-paid`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .set('If-Match', '"5"')
      .send(confirmation({ proof_file_ids: [FILE_ID] }))
      .expect(200);
    noStore(paid);
    expect(service.markPaid).toHaveBeenCalledWith(
      expect.any(Object), WITHDRAWAL_ID,
      { confirmationHash: HASH, previewToken: TOKEN, proofFileIds: [FILE_ID] }, 5, CONFIRM_KEY,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/mark-paid`)
      .set('Idempotency-Key', CONFIRM_KEY)
      .send(confirmation({ proof_file_ids: [FILE_ID] }))
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/admin/withdrawals/${WITHDRAWAL_ID}/mark-paid-preview`)
      .send({ proof_file_ids: [FILE_ID] })
      .expect(400);
  });
});
