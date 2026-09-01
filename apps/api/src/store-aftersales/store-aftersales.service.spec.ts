import type {
  CurrentStoreSession,
  StoreAftersaleDetailSnapshot,
  StoreAftersalePreviewSnapshot,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreAftersaleCreateRequest } from './store-aftersales.dto';
import {
  STORE_AFTERSALE_HTTP_STATUS,
  StoreAftersalesService,
  storeAftersalePreviewFactBinding,
  storeAftersalePreviewRequestBinding,
} from './store-aftersales.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const CUSTOMER_ID = '01J00000000000000000000002';
const SESSION_ID = '01J00000000000000000000003';
const ORDER_ID = '01J00000000000000000000004';
const ORDER_ITEM_ID = '01J00000000000000000000005';
const AFTERSALE_ID = '01J00000000000000000000006';
const AFTERSALE_ITEM_ID = '01J00000000000000000000007';
const FILE_ID = '01J00000000000000000000008';
const AUDIT_ID = '01J00000000000000000000009';
const REFUND_ID = '01J0000000000000000000000A';
const PREVIEW_KEY = '00000000-0000-4000-8000-000000000001';
const CONFIRM_KEY = '00000000-0000-4000-8000-000000000002';
const CANCEL_KEY = '00000000-0000-4000-8000-000000000003';
const REQUEST_ID = 'req_00000000000000000000000000000001';
const IP_ADDRESS = '127.0.0.1';
const PREVIEW_TOKEN = 'signed-aftersale-preview-token'.padEnd(64, 'x');
const CONFIRMATION_HASH = 'a'.repeat(64);
const NOW = new Date('2026-09-01T00:00:00.000Z');

const session: CurrentStoreSession = {
  accessJti: 'access:01J0000000000000000000000B',
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  customerId: CUSTOMER_ID,
  customerVersion: 1,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  sessionFamily: '01J0000000000000000000000C',
  sessionId: SESSION_ID,
};

const previewInput: Extract<StoreAftersaleCreateRequest, { action: 'PREVIEW' }> = {
  action: 'PREVIEW',
  evidenceFileIds: [FILE_ID],
  items: [{ orderItemId: ORDER_ITEM_ID, quantity: 1 }],
  orderId: ORDER_ID,
  reasonCode: 'ITEM_DAMAGED',
  reasonText: 'Outer packaging was damaged',
  type: 'REFUND_ONLY',
};

const confirmInput: Extract<StoreAftersaleCreateRequest, { action: 'CONFIRM' }> = {
  ...previewInput,
  action: 'CONFIRM',
  confirmationHash: CONFIRMATION_HASH,
  previewToken: PREVIEW_TOKEN,
};

function previewSnapshot(overrides: Partial<StoreAftersalePreviewSnapshot> = {}): StoreAftersalePreviewSnapshot {
  return {
    blockers: [],
    canSubmit: true,
    customerId: CUSTOMER_ID,
    evidence: [{
      attachedAftersaleIds: [],
      createdByAccountId: ACCOUNT_ID,
      fileId: FILE_ID,
      objectKey: `private/${FILE_ID}`,
      purpose: 'AFTERSALE_EVIDENCE',
      status: 'READY',
      valid: true,
      visibility: 'PRIVATE',
    }],
    items: [{
      allocatedAmount: '19.90',
      linePaidAmount: '39.80',
      orderItemId: ORDER_ITEM_ID,
      orderItemVersion: 2,
      refundedAmount: '0.00',
      refundedQuantity: 0,
      remainingRefundableAmount: '39.80',
      remainingRefundableQuantity: 2,
      requestedQuantity: 1,
      reservedAmount: '0.00',
      reservedQuantity: 0,
      unitPrice: '19.90',
    }],
    order: {
      aftersaleExpiresAt: new Date('2026-09-08T00:00:00.000Z'),
      fulfillmentStatus: 'READY_TO_SHIP',
      orderId: ORDER_ID,
      orderStatus: 'PENDING_SHIPMENT',
      orderVersion: 3,
      paymentResolution: 'NORMAL',
      paymentStatus: 'PAID',
    },
    reasonCode: previewInput.reasonCode,
    reasonText: previewInput.reasonText,
    requestedAmount: '19.90',
    serverTime: NOW,
    type: previewInput.type,
    ...overrides,
  };
}

function detailSnapshot(overrides: Partial<StoreAftersaleDetailSnapshot> = {}): StoreAftersaleDetailSnapshot {
  return {
    aftersaleId: AFTERSALE_ID,
    aftersaleNo: `AS${AFTERSALE_ID}`,
    availableActions: ['CANCEL', 'SUBMIT_RETURN_SHIPMENT', 'VIEW_ORDER'],
    cancelledAt: null,
    completedAt: null,
    createdAt: NOW,
    evidenceFileIds: [FILE_ID],
    inspection: null,
    items: [{
      aftersaleItemId: AFTERSALE_ITEM_ID,
      allocatedAmount: '19.90',
      approvedRefundQuantity: null,
      orderItemId: ORDER_ITEM_ID,
      productName: 'Development cleanser',
      refundedQuantity: 0,
      requestedQuantity: 1,
      reservedAmount: '19.90',
      reservedQuantity: 1,
      skuName: '120 ml',
    }],
    order: {
      fulfillmentStatus: 'READY_TO_SHIP',
      orderId: ORDER_ID,
      orderNo: `QX${ORDER_ID}`,
      orderStatus: 'PENDING_SHIPMENT',
      paidAt: NOW,
      payableAmount: '39.80',
      paymentResolution: 'NORMAL',
      paymentStatus: 'PAID',
      refundProcessingStatus: 'IDLE',
      refundProgressStatus: 'NONE',
      version: 3,
    },
    orderId: ORDER_ID,
    reasonCode: 'ITEM_DAMAGED',
    reasonText: previewInput.reasonText,
    refundAttempts: [],
    refundProcessingStatus: 'IDLE',
    refundProgressStatus: 'NONE',
    requestedAmount: '19.90',
    returnAddress: null,
    returnShipment: null,
    reviewedAt: null,
    status: 'PENDING_REVIEW',
    timeline: [{
      action: 'CREATE',
      actorRole: 'CUSTOMER',
      auditId: AUDIT_ID,
      fromStatus: null,
      occurredAt: NOW,
      toStatus: 'PENDING_REVIEW',
    }],
    type: 'REFUND_ONLY',
    updatedAt: NOW,
    version: 1,
    ...overrides,
  };
}

type ClaimResult =
  | { kind: 'execute' }
  | { kind: 'replay'; record: { resource_id: string | null; response_body: null; response_status: number } };

function harness() {
  const sequence: string[] = [];
  const snapshot = previewSnapshot();
  const detail = detailSnapshot();
  const transaction = {};
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
    },
  };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(() => sequence.push('assertHashOnlyReplay')),
    claim: vi.fn<(_transaction: unknown, _claim: unknown) => Promise<ClaimResult>>(async () => {
      sequence.push('claim');
      return { kind: 'execute' };
    }),
    complete: vi.fn(async (_transaction: unknown, _claim: unknown, _result: unknown) => {
      void [_transaction, _claim, _result];
      sequence.push('complete');
    }),
  };
  const credentials = {
    authenticate: vi.fn(() => {
      sequence.push('authenticate');
      return { expiresAt: new Date('2026-09-01T00:05:00.000Z'), keyId: 'idem-v1' };
    }),
    issue: vi.fn(() => {
      sequence.push('issue');
      return {
        confirmationHash: CONFIRMATION_HASH,
        expiresAt: new Date('2026-09-01T00:05:00.000Z'),
        issuedAt: NOW,
        previewToken: PREVIEW_TOKEN,
      };
    }),
    verify: vi.fn(() => {
      sequence.push('verify');
      return { expiresAt: new Date('2026-09-01T00:05:00.000Z'), keyId: 'idem-v1' };
    }),
  };
  const aftersales = {
    cancelOwnedAftersaleInTransaction: vi.fn(async () => {
      sequence.push('cancel');
      return {
        aftersale: detailSnapshot({ cancelledAt: NOW, status: 'CANCELLED', version: 2 }),
        audit: {
          after: { status: 'CANCELLED' as const, version: 2 },
          before: { status: 'PENDING_REVIEW' as const, version: 1 },
        },
        changed: true as const,
      };
    }),
    confirmAftersaleInTransaction: vi.fn(async (_transaction, _input, hooks) => {
      sequence.push('confirm');
      hooks.verifyPreview(snapshot);
      return {
        aftersale: detail,
        audit: { after: { status: 'PENDING_REVIEW' as const, version: 1 }, before: null },
      };
    }),
    getOwnedAftersaleDetail: vi.fn(async () => detail),
    getOwnedAftersaleForReplayInTransaction: vi.fn(async () => {
      sequence.push('getReplay');
      return detail;
    }),
    listOwnedAftersales: vi.fn(async () => ({ items: [detail], total: 1 })),
    previewInTransaction: vi.fn(async () => {
      sequence.push('preview');
      return snapshot;
    }),
  };
  const audit = {
    append: vi.fn(async () => {
      sequence.push('audit');
    }),
  };
  const service = new StoreAftersalesService();
  Object.assign(service, {
    aftersales,
    audit,
    database,
    idempotency,
    previewCredential: credentials,
  });
  return {
    aftersales,
    audit,
    credentials,
    database,
    detail,
    idempotency,
    sequence,
    service,
    snapshot,
    transaction,
  };
}

describe('B12.1 StoreAftersalesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('issues a fresh preview credential and stores only a safe HASH_ONLY projection', async () => {
    const current = harness();

    await expect(current.service.createAftersale(
      session,
      previewInput,
      PREVIEW_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toEqual({
      blockers: [],
      can_submit: true,
      confirmation_hash: CONFIRMATION_HASH,
      expires_at: '2026-09-01T00:05:00.000Z',
      items: [{
        allocated_amount: '19.90',
        order_item_id: ORDER_ITEM_ID,
        remaining_refundable_amount: '39.80',
        remaining_refundable_quantity: 2,
        requested_quantity: 1,
      }],
      preview_token: PREVIEW_TOKEN,
      requested_amount: '19.90',
    });

    expect(current.sequence).toEqual(['claim', 'preview', 'issue', 'complete']);
    expect(current.database.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(current.credentials.issue).toHaveBeenCalledWith({
      customerId: CUSTOMER_ID,
      facts: storeAftersalePreviewFactBinding(current.snapshot),
      previewIdempotencyKey: PREVIEW_KEY,
      request: storeAftersalePreviewRequestBinding(previewInput),
      sessionId: SESSION_ID,
    });
    const completed = current.idempotency.complete.mock.calls[0]?.[2];
    expect(completed).toEqual({
      responseForHash: {
        blockers: [],
        can_submit: true,
        items: expect.any(Array),
        requested_amount: '19.90',
      },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(JSON.stringify(completed)).not.toContain(PREVIEW_TOKEN);
    expect(JSON.stringify(completed)).not.toContain(CONFIRMATION_HASH);
    expect(current.audit.append).not.toHaveBeenCalled();
  });

  it('refuses an exact preview replay without returning the old credential', async () => {
    const current = harness();
    current.idempotency.claim.mockResolvedValueOnce({
      kind: 'replay',
      record: { resource_id: null, response_body: null, response_status: 200 },
    });

    await expect(current.service.createAftersale(
      session,
      previewInput,
      PREVIEW_KEY,
      REQUEST_ID,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    expect(current.aftersales.previewInTransaction).not.toHaveBeenCalled();
    expect(current.credentials.issue).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('authenticates then rechecks current facts, creates with 201, and audits no sensitive fields', async () => {
    const current = harness();
    const result = await current.service.createAftersale(
      session,
      confirmInput,
      CONFIRM_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    );

    expect((result as Record<string | symbol, unknown>)[STORE_AFTERSALE_HTTP_STATUS]).toBe(201);
    expect(result).toMatchObject({
      aftersale_id: AFTERSALE_ID,
      aftersale_no: `AS${AFTERSALE_ID}`,
      status: 'PENDING_REVIEW',
    });
    expect(current.sequence).toEqual([
      'claim',
      'authenticate',
      'confirm',
      'verify',
      'audit',
      'complete',
    ]);
    expect(current.credentials.authenticate).toHaveBeenCalledWith(expect.objectContaining({
      confirmIdempotencyKey: CONFIRM_KEY,
      previewToken: PREVIEW_TOKEN,
    }));
    expect(current.credentials.verify).toHaveBeenCalledWith(expect.objectContaining({
      confirmIdempotencyKey: CONFIRM_KEY,
      facts: storeAftersalePreviewFactBinding(current.snapshot),
    }));
    expect(current.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({ idempotencyKey: CONFIRM_KEY }),
      {
        resourceId: AFTERSALE_ID,
        responseForHash: { aftersale_created: { aftersale_id: AFTERSALE_ID } },
        responseStatus: 201,
        storage: 'HASH_ONLY',
      },
    );
    const persistedMetadata = JSON.stringify([
      current.audit.append.mock.calls,
      current.idempotency.complete.mock.calls.map((call) => call[2]),
    ]);
    for (const forbidden of [
      previewInput.reasonText!,
      FILE_ID,
      PREVIEW_TOKEN,
      CONFIRMATION_HASH,
      '19.90',
    ]) {
      expect(persistedMetadata).not.toContain(forbidden);
    }
  });

  it('replays CONFIRM from the current owned projection before credential expiry checks', async () => {
    const current = harness();
    const record = { resource_id: AFTERSALE_ID, response_body: null, response_status: 201 };
    current.idempotency.claim.mockResolvedValueOnce({ kind: 'replay', record });
    current.credentials.authenticate.mockImplementationOnce(() => {
      throw new ApplicationError('AFTERSALE_PREVIEW_EXPIRED', 'expired');
    });

    const result = await current.service.createAftersale(
      session,
      confirmInput,
      CONFIRM_KEY,
      REQUEST_ID,
    );

    expect((result as Record<string | symbol, unknown>)[STORE_AFTERSALE_HTTP_STATUS]).toBe(201);
    expect(current.sequence).toEqual(['getReplay', 'assertHashOnlyReplay']);
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: AFTERSALE_ID,
      responseForHash: { aftersale_created: { aftersale_id: AFTERSALE_ID } },
      responseStatus: 201,
      storage: 'HASH_ONLY',
    });
    expect(current.credentials.authenticate).not.toHaveBeenCalled();
    expect(current.aftersales.confirmAftersaleInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
  });

  it('cancels with optimistic locking, audits its reason, and supports exact HASH_ONLY replay', async () => {
    const current = harness();
    const reason = 'Customer no longer needs this item';
    await expect(current.service.cancelAftersale(
      session,
      AFTERSALE_ID,
      { reason },
      1,
      CANCEL_KEY,
      REQUEST_ID,
      IP_ADDRESS,
    )).resolves.toMatchObject({ aftersale_id: AFTERSALE_ID, status: 'CANCELLED' });

    expect(current.sequence).toEqual(['claim', 'cancel', 'audit', 'complete']);
    expect(current.aftersales.cancelOwnedAftersaleInTransaction).toHaveBeenCalledWith(
      current.transaction,
      {
        accountId: ACCOUNT_ID,
        aftersaleId: AFTERSALE_ID,
        customerId: CUSTOMER_ID,
        expectedVersion: 1,
      },
    );
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({ reason }));

    current.sequence.length = 0;
    current.idempotency.claim.mockResolvedValueOnce({
      kind: 'replay',
      record: { resource_id: AFTERSALE_ID, response_body: null, response_status: 200 },
    });
    await current.service.cancelAftersale(
      session,
      AFTERSALE_ID,
      { reason },
      1,
      CANCEL_KEY,
      REQUEST_ID,
    );
    expect(current.sequence).toEqual(['getReplay', 'assertHashOnlyReplay']);
    expect(current.aftersales.cancelOwnedAftersaleInTransaction).toHaveBeenCalledOnce();
  });

  it('maps stable list/detail projections, real audit IDs, and hides the unavailable shipment command', async () => {
    const current = harness();
    current.aftersales.getOwnedAftersaleDetail.mockResolvedValueOnce(detailSnapshot({
      refundAttempts: [{
        amount: '19.90',
        attemptNo: 1,
        createdAt: NOW,
        failureCode: 'PROVIDER_UNAVAILABLE',
        refundId: REFUND_ID,
        refundNo: `RF${REFUND_ID}`,
        status: 'FAILED',
        updatedAt: NOW,
      }],
    }));

    await expect(current.service.listAftersales(session, { page: 1, pageSize: 20 })).resolves.toEqual({
      items: [expect.objectContaining({
        aftersale_id: AFTERSALE_ID,
        available_actions: ['CANCEL', 'VIEW_ORDER'],
        created_at: NOW.toISOString(),
      })],
      pagination: { page: 1, page_size: 20, total: 1 },
    });
    await expect(current.service.getAftersale(session, AFTERSALE_ID)).resolves.toMatchObject({
      aftersale_id: AFTERSALE_ID,
      available_actions: ['CANCEL', 'VIEW_ORDER'],
      errors: [{ error_code: 'PROVIDER_UNAVAILABLE', retryable: true }],
      order: { display_status: '待发货', order_id: ORDER_ID },
      timeline: [{
        event: 'CREATE',
        event_id: AUDIT_ID,
        from_status: null,
        operator_role: 'CUSTOMER',
        to_status: 'PENDING_REVIEW',
      }],
    });
  });

  it('fails closed instead of exposing an undecryptable return address snapshot', async () => {
    const current = harness();
    current.aftersales.getOwnedAftersaleDetail.mockResolvedValueOnce(detailSnapshot({
      returnAddress: {
        city: 'Auckland',
        detailCiphertext: Buffer.from('ciphertext'),
        district: 'Central',
        encryptionKeyId: 'field-v1',
        phoneCiphertext: Buffer.from('ciphertext'),
        phoneLast4: '1234',
        province: 'Auckland',
        recipientName: 'Returns',
        snapshotId: '01J0000000000000000000000D',
      },
    }));

    await expect(current.service.getAftersale(session, AFTERSALE_ID)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    });
  });
});
