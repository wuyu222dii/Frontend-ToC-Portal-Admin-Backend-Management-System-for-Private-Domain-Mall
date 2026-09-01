import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AdminAftersaleRefundPreviewSnapshot,
  AdminManualCompensationPreviewSnapshot,
  AdminRefundRetryPreviewSnapshot,
  AdminRefundSnapshot,
  DatabaseRuntime,
} from '@qingxu/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import type {
  AdminAftersaleRefundConfirmation,
  AdminManualCompensationConfirmation,
  AdminRefundRetryConfirmation,
} from './admin-refunds.dto';
import { AdminRefundsService } from './admin-refunds.service';

vi.mock('@qingxu/database', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, AdminRefundRepository: class AdminRefundRepository {} };
});

const ACCOUNT_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const AFTERSALE_ID = '01J00000000000000000000003';
const AFTERSALE_ITEM_ID = '01J00000000000000000000004';
const ORDER_ID = '01J00000000000000000000005';
const ORDER_ITEM_ID = '01J00000000000000000000006';
const SKU_ID = '01J00000000000000000000007';
const REFUND_ID = '01J00000000000000000000008';
const ATTEMPT_ID = '01J00000000000000000000009';
const COMPENSATION_ID = '01J0000000000000000000000A';
const PREVIEW_KEY = '00000000-0000-4000-8000-000000000001';
const CONFIRM_KEY = '00000000-0000-4000-8000-000000000002';
const HASH = 'a'.repeat(64);
const TOKEN = 'preview-token-with-sufficient-length';
const NOW = new Date('2026-09-01T00:00:00.000Z');

const runtimeConfig = {
  encryption: {
    idempotencyHashKeys: {
      current: { id: 'idempotency-current', key: Buffer.alloc(32, 32) },
      previous: [],
    },
    ipHashKey: Buffer.alloc(32, 33),
  },
  environment: 'test',
  payment: { mockSigningKey: Buffer.alloc(32, 34), provider: 'MOCK' },
} as unknown as PlatformRuntimeConfig;

const request: AdminCatalogRequestContext = {
  accessSession: {
    accessJti: 'access-jti',
    accountId: ACCOUNT_ID,
    accountVersion: 1,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    factorEncryptionKeyId: 'field-v1',
    factorId: '01J0000000000000000000000B',
    factorLastUsedTimestep: null,
    factorSecretCiphertext: new Uint8Array(),
    mfaVerifiedAt: NOW,
    sessionFamily: '01J0000000000000000000000C',
    sessionId: SESSION_ID,
  },
  principal: {
    accountId: ACCOUNT_ID,
    assurance: 'MFA',
    permissions: [],
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    sessionId: SESSION_ID,
  },
  requestId: 'req_0123456789abcdef0123456789abcdef',
  socket: { remoteAddress: '127.0.0.1' },
};

const aftersaleInput: AdminAftersaleRefundConfirmation = {
  confirmationHash: HASH,
  items: [{ aftersaleItemId: AFTERSALE_ITEM_ID, quantity: 1 }],
  previewToken: TOKEN,
  reason: 'Approve the frozen refund',
};

const retryInput: AdminRefundRetryConfirmation = {
  confirmationHash: HASH,
  previewToken: TOKEN,
  reason: 'Retry the explicit provider failure',
};

const compensationInput: AdminManualCompensationConfirmation = {
  amount: '12.34',
  confirmationHash: HASH,
  orderItemId: ORDER_ITEM_ID,
  previewToken: TOKEN,
  reason: 'Service recovery credit',
};

function aftersaleImpact(): AdminAftersaleRefundPreviewSnapshot {
  return {
    affectedCount: 1,
    aftersaleId: AFTERSALE_ID,
    amount: '19.90',
    items: [{
      aftersaleItemId: AFTERSALE_ITEM_ID,
      amount: '19.90',
      autoRestock: true,
      commissionReversal: '1.99',
      inventoryRestockQuantity: 1,
      orderItemId: ORDER_ITEM_ID,
      quantity: 1,
      skuId: SKU_ID,
    }],
    orderId: ORDER_ID,
    originType: 'AFTERSALE',
    provider: 'MOCK',
    resourceVersion: 3,
    warnings: ['Provider execution occurs after commit'],
  };
}

function retryImpact(): AdminRefundRetryPreviewSnapshot {
  return {
    affectedCount: 1,
    amount: '12.34',
    attemptCount: 1,
    nextAttemptNo: 2,
    orderId: ORDER_ID,
    originType: 'MANUAL_COMPENSATION',
    refundId: REFUND_ID,
    refundNo: `RF${REFUND_ID}`,
    resourceVersion: 2,
    warnings: ['Frozen refund facts will be reused'],
  };
}

function compensationImpact(): AdminManualCompensationPreviewSnapshot {
  return {
    affectedCount: 1,
    amount: '12.34',
    commissionReversal: '1.23',
    orderId: ORDER_ID,
    orderItemId: ORDER_ITEM_ID,
    originType: 'MANUAL_COMPENSATION',
    provider: 'MOCK',
    remainingAmountBefore: '20.00',
    resourceVersion: 5,
    warnings: ['Amount compensation does not restore inventory'],
  };
}

function refund(originType: AdminRefundSnapshot['originType'] = 'AFTERSALE'): AdminRefundSnapshot {
  const manual = originType === 'MANUAL_COMPENSATION';
  return {
    aftersaleId: manual ? null : AFTERSALE_ID,
    amount: manual ? '12.34' : '19.90',
    attemptId: ATTEMPT_ID,
    attemptNo: manual ? 2 : 1,
    compensationId: manual ? COMPENSATION_ID : null,
    compensationNo: manual ? `MC${COMPENSATION_ID}` : null,
    items: [{
      aftersaleItemId: manual ? null : AFTERSALE_ITEM_ID,
      amount: manual ? '12.34' : '19.90',
      autoRestock: !manual,
      commissionReversal: manual ? '1.23' : '1.99',
      inventoryRestockQuantity: manual ? 0 : 1,
      orderItemId: ORDER_ITEM_ID,
      quantity: 1,
      skuId: SKU_ID,
    }],
    orderId: ORDER_ID,
    originType,
    refundId: REFUND_ID,
    refundNo: `RF${REFUND_ID}`,
    status: 'PENDING',
    version: manual ? 3 : 1,
  };
}

type ClaimResult =
  | { kind: 'execute' }
  | { kind: 'replay'; record: { resource_id: string | null } };

function harness() {
  const sequence: string[] = [];
  const transaction = {};
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
    },
  } as unknown as DatabaseRuntime;
  const audit = { append: vi.fn(async () => { sequence.push('audit'); }) };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(() => sequence.push('assertReplay')),
    assertKeyNotUsedForRequest: vi.fn(async () => { sequence.push('assertDifferentKey'); }),
    claim: vi.fn<(_transaction: unknown, _claim: unknown) => Promise<ClaimResult>>(async () => {
      sequence.push('claim');
      return { kind: 'execute' as const };
    }),
    complete: vi.fn(async (_transaction: unknown, _claim: unknown, _result: unknown) => {
      void [_transaction, _claim, _result];
      sequence.push('complete');
    }),
  };
  const outbox = { append: vi.fn(async () => { sequence.push('outbox'); }) };
  const previews = {
    consumeInTransaction: vi.fn(async () => { sequence.push('consumePreview'); }),
    issueInTransaction: vi.fn(async () => {
      sequence.push('issuePreview');
      return { confirmationHash: HASH, expiresAt: new Date('2026-09-01T00:01:00.000Z') };
    }),
  };
  const refunds = {
    createAftersaleRefundInTransaction: vi.fn(async (
      _transaction: unknown,
      _input: unknown,
      hooks: { verifyPreview(value: AdminAftersaleRefundPreviewSnapshot): Promise<void> | void },
    ) => {
      sequence.push('createAftersale');
      await hooks.verifyPreview(aftersaleImpact());
      return refund();
    }),
    createManualCompensationInTransaction: vi.fn(async (
      _transaction: unknown,
      _input: unknown,
      hooks: { verifyPreview(value: AdminManualCompensationPreviewSnapshot): Promise<void> | void },
    ) => {
      sequence.push('createCompensation');
      await hooks.verifyPreview(compensationImpact());
      return refund('MANUAL_COMPENSATION');
    }),
    getRefundInTransaction: vi.fn(async () => {
      sequence.push('getRefund');
      return refund();
    }),
    prepareRetryRefundInTransaction: vi.fn(async (
      _transaction: unknown,
      _input: unknown,
      hooks: { verifyPreview(value: AdminRefundRetryPreviewSnapshot): Promise<void> | void },
    ) => {
      sequence.push('prepareRetry');
      await hooks.verifyPreview(retryImpact());
      return refund('MANUAL_COMPENSATION');
    }),
    previewAftersaleRefundInTransaction: vi.fn(async () => {
      sequence.push('previewAftersale');
      return aftersaleImpact();
    }),
    previewManualCompensationInTransaction: vi.fn(async () => {
      sequence.push('previewCompensation');
      return compensationImpact();
    }),
    previewRetryRefundInTransaction: vi.fn(async () => {
      sequence.push('previewRetry');
      return retryImpact();
    }),
  };
  const service = new AdminRefundsService(runtimeConfig, database);
  Object.assign(service as unknown as Record<string, unknown>, {
    audit,
    idempotency,
    outbox,
    previews,
    refunds,
  });
  return { audit, database, idempotency, outbox, previews, refunds, sequence, service, transaction };
}

describe('B12.4 AdminRefundsService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds every server refund fact while keeping preview capabilities out of idempotency storage', async () => {
    const current = harness();
    const response = await current.service.previewAftersaleRefund(
      request,
      AFTERSALE_ID,
      aftersaleInput,
      PREVIEW_KEY,
    );

    expect(response).toMatchObject({
      confirmation_hash: HASH,
      impact: { affected_count: 1 },
      resource_etag: '"3"',
    });
    expect(response.preview_token).toMatch(/^pvw_[A-Za-z0-9_-]{43}$/);
    expect(current.sequence).toEqual(['claim', 'previewAftersale', 'issuePreview', 'complete']);
    expect(current.previews.issueInTransaction).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'AFTERSALE.REFUND',
      actorId: ACCOUNT_ID,
      request: expect.objectContaining({
        amount: '19.90',
        items: [expect.objectContaining({
          aftersale_item_id: AFTERSALE_ITEM_ID,
          server_allocated_amount: '19.90',
        })],
        provider: 'MOCK',
      }),
      resourceVersion: 3,
      sessionId: SESSION_ID,
      targetId: AFTERSALE_ID,
      targetType: 'AFTERSALE',
    }));
    const completion = current.idempotency.complete.mock.calls[0]?.[2];
    expect(completion).toEqual({
      resourceId: AFTERSALE_ID,
      responseForHash: { impact: response.impact, resource_etag: '"3"' },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(JSON.stringify(completion)).not.toContain(response.preview_token);
    expect(JSON.stringify(completion)).not.toContain(HASH);
  });

  it('consumes the exact refund preview before writing minimal audit, Outbox, and hash-only facts', async () => {
    const current = harness();
    const response = await current.service.createAftersaleRefund(
      request,
      AFTERSALE_ID,
      aftersaleInput,
      3,
      CONFIRM_KEY,
    );

    expect(response).toEqual({
      amount: '19.90',
      items: [{
        aftersale_item_id: AFTERSALE_ITEM_ID,
        order_item_id: ORDER_ITEM_ID,
        quantity: 1,
        server_allocated_amount: '19.90',
      }],
      origin_type: 'AFTERSALE',
      refund_id: REFUND_ID,
      refund_no: `RF${REFUND_ID}`,
      status: 'PENDING',
    });
    expect(current.sequence).toEqual([
      'claim', 'assertDifferentKey', 'createAftersale', 'consumePreview',
      'audit', 'outbox', 'complete',
    ]);
    expect(current.previews.consumeInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'AFTERSALE.REFUND',
        confirmationHash: HASH,
        previewToken: TOKEN,
        resourceVersion: 3,
        targetId: AFTERSALE_ID,
        targetType: 'AFTERSALE',
      }),
    );
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'REFUND',
      module: 'refund',
      objectId: REFUND_ID,
      reason: aftersaleInput.reason,
      summaryPolicy: 'STATUS_VERSION',
    }));
    expect(current.outbox.append).toHaveBeenCalledWith(current.transaction, {
      aggregateId: REFUND_ID,
      aggregateType: 'refund',
      eventType: 'refund.execution.requested',
      payload: {
        event_version: 1,
        resource_id: REFUND_ID,
        resource_type: 'refund',
        resource_version: 1,
      },
    });
    expect(JSON.stringify(current.audit.append.mock.calls)).not.toContain(TOKEN);
    expect(JSON.stringify(current.outbox.append.mock.calls)).not.toContain(TOKEN);
  });

  it('replays the current projection before creating another refund or consuming a preview', async () => {
    const current = harness();
    current.idempotency.claim.mockResolvedValueOnce({
      kind: 'replay' as const,
      record: { resource_id: REFUND_ID },
    });

    await expect(current.service.createAftersaleRefund(
      request,
      AFTERSALE_ID,
      aftersaleInput,
      3,
      CONFIRM_KEY,
    )).resolves.toMatchObject({ refund_id: REFUND_ID, status: 'PENDING' });
    expect(current.sequence).toEqual(['getRefund', 'assertReplay']);
    expect(current.refunds.createAftersaleRefundInTransaction).not.toHaveBeenCalled();
    expect(current.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.outbox.append).not.toHaveBeenCalled();
  });

  it('reuses the stable manual-compensation refund for a controlled retry', async () => {
    const current = harness();
    const preview = await current.service.previewRefundRetry(
      request,
      REFUND_ID,
      retryInput,
      PREVIEW_KEY,
    );
    expect(preview).toMatchObject({ impact: { affected_count: 1 }, resource_etag: '"2"' });
    expect(current.previews.issueInTransaction).toHaveBeenLastCalledWith(
      current.transaction,
      expect.objectContaining({ action: 'REFUND.RETRY', targetId: REFUND_ID, targetType: 'REFUND' }),
    );

    const response = await current.service.retryRefund(request, REFUND_ID, retryInput, 2, CONFIRM_KEY);
    expect(response).toMatchObject({
      compensation_id: COMPENSATION_ID,
      origin_type: 'MANUAL_COMPENSATION',
      refund_id: REFUND_ID,
      reserved_amount: '12.34',
      status: 'PENDING',
      version: 3,
    });
    expect(current.refunds.prepareRetryRefundInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        attemptIdempotencyKey: CONFIRM_KEY,
        expectedVersion: 2,
        refundId: REFUND_ID,
      }),
      expect.any(Object),
    );
    expect(current.audit.append).toHaveBeenLastCalledWith(
      current.transaction,
      expect.objectContaining({ action: 'RETRY', objectId: REFUND_ID }),
    );
  });

  it('creates an amount-only compensation projection without exposing provider capability', async () => {
    const current = harness();
    const preview = await current.service.previewManualCompensation(
      request,
      ORDER_ID,
      compensationInput,
      PREVIEW_KEY,
    );
    expect(preview).toMatchObject({
      impact: { affected_count: 1 },
      resource_etag: '"5"',
    });
    expect(JSON.stringify(preview)).not.toContain('MOCK');
    expect(current.previews.issueInTransaction).toHaveBeenLastCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'ORDER.MANUAL_COMPENSATION',
        targetId: ORDER_ID,
        targetType: 'ORDER',
      }),
    );

    const response = await current.service.createManualCompensation(
      request,
      ORDER_ID,
      compensationInput,
      5,
      CONFIRM_KEY,
    );
    expect(response).toEqual({
      amount: '12.34',
      commission_reversal: '1.23',
      compensation_id: COMPENSATION_ID,
      compensation_no: `MC${COMPENSATION_ID}`,
      order_id: ORDER_ID,
      order_item_id: ORDER_ITEM_ID,
      origin_type: 'MANUAL_COMPENSATION',
      refund_id: REFUND_ID,
      refund_no: `RF${REFUND_ID}`,
      refunded_amount: '0.00',
      reserved_amount: '12.34',
      status: 'PENDING',
      version: 3,
    });
    expect(current.refunds.createManualCompensationInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({ provider: 'MOCK' }),
      expect.any(Object),
    );
  });

  it('rejects refund previews and commands outside the approved Mock runtime', async () => {
    const current = harness();
    const production = {
      ...runtimeConfig,
      environment: 'production',
    } as PlatformRuntimeConfig;
    const service = new AdminRefundsService(production, current.database);

    expect(() => service.previewAftersaleRefund(
      request,
      AFTERSALE_ID,
      aftersaleInput,
      PREVIEW_KEY,
    )).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(() => service.previewRefundRetry(
      request,
      REFUND_ID,
      retryInput,
      PREVIEW_KEY,
    )).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(() => service.createAftersaleRefund(
      request,
      AFTERSALE_ID,
      aftersaleInput,
      3,
      CONFIRM_KEY,
    )).toThrowError(expect.objectContaining({ code: 'INTERNAL_ERROR' }));
    expect(current.database.prisma.$transaction).not.toHaveBeenCalled();
  });
});
