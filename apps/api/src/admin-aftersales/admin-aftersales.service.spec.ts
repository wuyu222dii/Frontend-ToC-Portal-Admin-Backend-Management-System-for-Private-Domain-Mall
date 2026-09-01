import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AdminAftersaleCommandSnapshot,
  AdminAftersaleDetailSnapshot,
  AdminAftersaleRejectImpactSnapshot,
  DatabaseRuntime,
  ReturnAddressPublishPreviewSnapshot,
  ReturnAddressVersionMaterial,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import {
  createReturnAddressSnapshotSecurityMaterial,
  createReturnAddressVersionSecurityMaterial,
  type ReturnAddressSecurityMaterial,
  verifyReturnAddressSnapshotSecurityMaterial,
} from '../platform/security/return-address-security';
import type {
  AdminAftersaleRejectConfirmationRequest,
  AdminReturnAddressAction,
  AdminReturnAddressConfirmation,
} from './admin-aftersales.dto';
import { AdminAftersalesService } from './admin-aftersales.service';

const ACCOUNT_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const AFTERSALE_ID = '01J00000000000000000000003';
const ORDER_ID = '01J00000000000000000000004';
const ORDER_ITEM_ID = '01J00000000000000000000005';
const AFTERSALE_ITEM_ID = '01J00000000000000000000006';
const VERSION_ID = '01J00000000000000000000007';
const EVIDENCE_ID = '01J00000000000000000000008';
const SNAPSHOT_ID = '01J0000000000000000000000B';
const PREVIEW_KEY = '00000000-0000-4000-8000-000000000001';
const CONFIRM_KEY = '00000000-0000-4000-8000-000000000002';
const CONFIRMATION_HASH = 'a'.repeat(64);
const PREVIEW_TOKEN = 'preview-token-with-sufficient-length';
const REQUEST_ID = 'req_00000000000000000000000000000001';
const RETURN_ADDRESS_SINGLETON_ID = '00000000000000000000000000';
const NOW = new Date('2026-09-01T00:00:00.000Z');
const FIELD_KEY = { id: 'field-current', key: Buffer.alloc(32, 31) };

const runtimeConfig = {
  encryption: {
    fieldKeys: { current: FIELD_KEY, previous: [] },
    idempotencyHashKeys: {
      current: { id: 'idempotency-current', key: Buffer.alloc(32, 32) },
      previous: [],
    },
    ipHashKey: Buffer.alloc(32, 33),
  },
} as unknown as PlatformRuntimeConfig;

const request: AdminCatalogRequestContext = {
  accessSession: {
    accessJti: 'access-jti',
    accountId: ACCOUNT_ID,
    accountVersion: 1,
    expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    factorEncryptionKeyId: FIELD_KEY.id,
    factorId: '01J00000000000000000000009',
    factorLastUsedTimestep: null,
    factorSecretCiphertext: new Uint8Array(),
    mfaVerifiedAt: NOW,
    sessionFamily: '01J0000000000000000000000A',
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
  requestId: REQUEST_ID,
  socket: { remoteAddress: '127.0.0.1' },
};

const addressInput: AdminReturnAddressAction = {
  city: 'Central',
  detail: 'Development returns desk',
  district: 'Harbour',
  phone: '+1 2-3',
  province: 'Auckland',
  reason: 'Publish the development returns desk',
  recipientName: 'Returns team',
};

function impact(): AdminAftersaleRejectImpactSnapshot {
  return {
    affectedCount: 1,
    aftersaleId: AFTERSALE_ID,
    items: [{
      aftersaleItemId: AFTERSALE_ITEM_ID,
      orderItemId: ORDER_ITEM_ID,
      releaseAmount: '19.90',
      releaseQuantity: 1,
    }],
    orderId: ORDER_ID,
    releaseAmount: '19.90',
    releaseQuantity: 1,
    resourceVersion: 3,
  };
}

function inspection(): NonNullable<AdminAftersaleDetailSnapshot['inspection']> {
  return {
    abnormalReason: null,
    evidenceFileIds: [EVIDENCE_ID],
    inspectedAt: NOW,
    inspectedBy: { accountId: ACCOUNT_ID, displayName: '总部管理员' },
    inspectionId: SNAPSHOT_ID,
    items: [{
      approvedRefundQuantity: 1,
      damagedQuantity: 1,
      note: null,
      orderItemId: ORDER_ITEM_ID,
      receivedQuantity: 1,
      restockQuantity: 0,
      returnToCustomerQuantity: 0,
      scrapQuantity: 1,
    }],
    resolution: null,
    resolutionReason: null,
    resolvedAt: null,
    result: 'PASS',
  };
}

function command(
  status: 'PENDING_REVIEW' | 'REFUNDING' | 'REJECTED' = 'REJECTED',
  currentInspection: AdminAftersaleDetailSnapshot['inspection'] = null,
): AdminAftersaleCommandSnapshot {
  return {
    aftersaleId: AFTERSALE_ID,
    aftersaleNo: `AS${AFTERSALE_ID}`,
    inspection: currentInspection,
    items: [{
      aftersaleItemId: AFTERSALE_ITEM_ID,
      allocatedAmount: '19.90',
      approvedRefundQuantity: null,
      orderItemId: ORDER_ITEM_ID,
      quantity: 1,
      reservedAmount: status === 'REJECTED' ? '0.00' : '19.90',
      reservedQuantity: status === 'REJECTED' ? 0 : 1,
    }],
    orderId: ORDER_ID,
    refundId: null,
    status,
    type: 'REFUND_ONLY',
    version: status === 'PENDING_REVIEW' ? 3 : 4,
  };
}

function addressMaterial(versionId = VERSION_ID): ReturnAddressVersionMaterial {
  const secured = createReturnAddressVersionSecurityMaterial({
    detail: addressInput.detail,
    phone: addressInput.phone,
    versionId,
  }, FIELD_KEY);
  return {
    city: addressInput.city,
    createdAt: NOW,
    detailCiphertext: secured.detailCiphertext,
    district: addressInput.district,
    effectiveAt: NOW,
    encryptionKeyId: secured.encryptionKeyId,
    phoneCiphertext: secured.phoneCiphertext,
    phoneLast4: secured.phoneLast4,
    province: addressInput.province,
    recipientName: addressInput.recipientName,
    version: 1,
    versionId,
    versionNo: 1,
  };
}

type ClaimResult =
  | { kind: 'execute' }
  | { kind: 'replay'; record: {
      resource_id: string | null;
      response_body: null;
      response_status: number;
    } };

function harness() {
  const sequence: string[] = [];
  let protectedSnapshot: ReturnAddressSecurityMaterial | undefined;
  const transaction = {};
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)),
    },
  } as unknown as DatabaseRuntime;
  const aftersales = {
    approveInTransaction: vi.fn(async (_transaction, _input, hooks) => {
      sequence.push('approve');
      const source = addressMaterial();
      protectedSnapshot = await hooks.protectReturnAddress({
        snapshotId: SNAPSHOT_ID,
        source: {
          city: source.city,
          detailCiphertext: source.detailCiphertext,
          district: source.district,
          encryptionKeyId: source.encryptionKeyId,
          phoneCiphertext: source.phoneCiphertext,
          phoneLast4: source.phoneLast4,
          province: source.province,
          recipientName: source.recipientName,
          sourceVersionId: source.versionId,
          sourceVersionNo: source.versionNo,
        },
      });
      return {
        aftersale: command('REFUNDING'),
        audit: {
          after: { status: 'REFUNDING' as const, version: 4 },
          before: { status: 'PENDING_REVIEW' as const, version: 3 },
        },
      };
    }),
    getDetail: vi.fn(),
    getForReplayInTransaction: vi.fn(async () => {
      sequence.push('getAftersaleReplay');
      return command();
    }),
    list: vi.fn(),
    previewRejectInTransaction: vi.fn(async () => {
      sequence.push('previewReject');
      return impact();
    }),
    rejectInTransaction: vi.fn(async (_transaction, _input, hooks) => {
      sequence.push('reject');
      await hooks.verifyPreview(impact());
      return {
        aftersale: command(),
        audit: {
          after: { status: 'REJECTED' as const, version: 4 },
          before: { status: 'PENDING_REVIEW' as const, version: 3 },
        },
      };
    }),
  };
  const audit = {
    append: vi.fn(async () => {
      sequence.push('audit');
    }),
  };
  const idempotency = {
    assertHashOnlyReplay: vi.fn(() => sequence.push('assertReplay')),
    assertKeyNotUsedForRequest: vi.fn(async () => {
      sequence.push('assertDifferentKey');
    }),
    claim: vi.fn<(_transaction: unknown, _claim: unknown) => Promise<ClaimResult>>(async () => {
      sequence.push('claim');
      return { kind: 'execute' };
    }),
    complete: vi.fn(async (_transaction: unknown, _claim: unknown, _result: unknown) => {
      void [_transaction, _claim, _result];
      sequence.push('complete');
    }),
  };
  const previews = {
    consumeInTransaction: vi.fn(async () => {
      sequence.push('consumePreview');
    }),
    issueInTransaction: vi.fn(async () => {
      sequence.push('issuePreview');
      return {
        confirmationHash: CONFIRMATION_HASH,
        expiresAt: new Date('2026-09-01T00:05:00.000Z'),
      };
    }),
  };
  const firstPreview: ReturnAddressPublishPreviewSnapshot = {
    current: null,
    currentPublishedId: null,
    maxVersionNo: 0,
    resourceVersion: 1,
  };
  const returnAddresses = {
    getForReplayInTransaction: vi.fn(async () => addressMaterial()),
    previewPublishInTransaction: vi.fn(async () => {
      sequence.push('previewAddress');
      return firstPreview;
    }),
    publishInTransaction: vi.fn(async (_transaction, _input, hooks) => {
      sequence.push('publishAddress');
      await hooks.verifyPreview(firstPreview);
      hooks.protectVersion({ versionId: VERSION_ID });
      return {
        address: addressMaterial(),
        audit: { after: { status: 'PUBLISHED' as const, version: 1 }, before: null },
      };
    }),
    readCurrent: vi.fn(async () => addressMaterial()),
  };
  const service = new AdminAftersalesService(runtimeConfig, database);
  Object.assign(service as unknown as Record<string, unknown>, {
    aftersales,
    audit,
    idempotency,
    previews,
    returnAddresses,
  });
  return {
    aftersales,
    audit,
    database,
    firstPreview,
    idempotency,
    previews,
    returnAddresses,
    sequence,
    service,
    transaction,
    protectedSnapshot: () => protectedSnapshot,
  };
}

describe('B12.2 AdminAftersalesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('persists a safe reject-preview hash projection and binds all current impact facts', async () => {
    const current = harness();

    await current.service.previewReject(
      request,
      AFTERSALE_ID,
      { reason: 'The request lacks sufficient evidence' },
      PREVIEW_KEY,
    );

    expect(current.sequence).toEqual(['claim', 'previewReject', 'issuePreview', 'complete']);
    expect(current.previews.issueInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'AFTERSALE.REJECT',
        actorId: ACCOUNT_ID,
        request: expect.objectContaining({
          order_id: ORDER_ID,
          reason: 'The request lacks sufficient evidence',
          release_amount: '19.90',
          release_quantity: 1,
        }),
        resourceVersion: 3,
        sessionId: SESSION_ID,
        targetId: AFTERSALE_ID,
        targetType: 'AFTERSALE',
      }),
    );
    const completed = current.idempotency.complete.mock.calls[0]?.[2];
    expect(completed).toMatchObject({ responseStatus: 200, storage: 'HASH_ONLY' });
    expect(JSON.stringify(completed)).not.toContain(PREVIEW_TOKEN);
    expect(JSON.stringify(completed)).not.toContain(CONFIRMATION_HASH);
  });

  it('checks confirm-key separation before consuming rejection preview and audits only the reason/state', async () => {
    const current = harness();
    const input: AdminAftersaleRejectConfirmationRequest = {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'The request lacks sufficient evidence',
    };

    await current.service.rejectAftersale(request, AFTERSALE_ID, input, 3, CONFIRM_KEY);

    expect(current.sequence).toEqual([
      'claim',
      'assertDifferentKey',
      'reject',
      'consumePreview',
      'audit',
      'complete',
    ]);
    expect(current.idempotency.assertKeyNotUsedForRequest).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({ idempotencyKey: CONFIRM_KEY }),
      { method: 'POST', route: '/admin/aftersales/{aftersale_id}/reject-preview' },
    );
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      after: { status: 'REJECTED', version: 4 },
      before: { status: 'PENDING_REVIEW', version: 3 },
      reason: input.reason,
      summaryPolicy: 'STATUS_VERSION',
    }));
    const persisted = JSON.stringify([
      current.audit.append.mock.calls,
      current.idempotency.complete.mock.calls.map((call) => call[2]),
    ]);
    expect(persisted).not.toContain(PREVIEW_TOKEN);
    expect(persisted).not.toContain(CONFIRMATION_HASH);
    expect(persisted).not.toContain('19.90');
  });

  it('rejects a confirm key already used by preview before touching the aftersale state', async () => {
    const current = harness();
    current.idempotency.assertKeyNotUsedForRequest.mockRejectedValueOnce(
      new ApplicationError('STATE_CONFLICT', 'The confirm key was used by preview'),
    );

    await expect(current.service.rejectAftersale(request, AFTERSALE_ID, {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'The request lacks sufficient evidence',
    }, 3, PREVIEW_KEY)).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    expect(current.aftersales.rejectInTransaction).not.toHaveBeenCalled();
    expect(current.previews.consumeInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
    expect(current.idempotency.complete).not.toHaveBeenCalled();
  });

  it('replays rejection before preview checks and verifies the current owned projection hash', async () => {
    const current = harness();
    const record = { resource_id: AFTERSALE_ID, response_body: null, response_status: 200 };
    current.idempotency.claim.mockResolvedValueOnce({ kind: 'replay', record });

    await current.service.rejectAftersale(request, AFTERSALE_ID, {
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'The request lacks sufficient evidence',
    }, 999, CONFIRM_KEY);

    expect(current.sequence).toEqual(['getAftersaleReplay', 'assertReplay']);
    expect(current.idempotency.assertHashOnlyReplay).toHaveBeenCalledWith(record, {
      resourceId: AFTERSALE_ID,
      responseForHash: { aftersale_rejected: { aftersale_id: AFTERSALE_ID } },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(current.idempotency.assertKeyNotUsedForRequest).not.toHaveBeenCalled();
    expect(current.previews.consumeInTransaction).not.toHaveBeenCalled();
  });

  it('re-encrypts the approved return address under snapshot AAD and propagates missing-address 422', async () => {
    const current = harness();
    const note = 'Approve the valid return request';

    await current.service.approveAftersale(request, AFTERSALE_ID, { note }, 3, CONFIRM_KEY);

    const protectedSnapshot = current.protectedSnapshot();
    expect(protectedSnapshot).toBeDefined();
    expect(verifyReturnAddressSnapshotSecurityMaterial(
      protectedSnapshot!,
      runtimeConfig.encryption.fieldKeys,
    )).toMatchObject({ detail: addressInput.detail, phone: addressInput.phone });
    expect(() => verifyReturnAddressSnapshotSecurityMaterial(
      createReturnAddressSnapshotSecurityMaterial({
        detail: addressInput.detail,
        phone: addressInput.phone,
        snapshotId: SNAPSHOT_ID,
      }, FIELD_KEY),
      runtimeConfig.encryption.fieldKeys,
    )).not.toThrow();
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      reason: note,
      summaryPolicy: 'STATUS_VERSION',
    }));

    const missing = harness();
    missing.aftersales.approveInTransaction.mockRejectedValueOnce(new ApplicationError(
      'RETURN_ADDRESS_NOT_CONFIGURED',
      'A published return address is required',
    ));
    await expect(missing.service.approveAftersale(
      request,
      AFTERSALE_ID,
      { note: null },
      3,
      CONFIRM_KEY,
    )).rejects.toMatchObject({ code: 'RETURN_ADDRESS_NOT_CONFIGURED', httpStatus: 422 });
    expect(missing.audit.append).not.toHaveBeenCalled();
    expect(missing.idempotency.complete).not.toHaveBeenCalled();
  });

  it('replays approve with a later current inspection instead of returning a stale null projection', async () => {
    const current = harness();
    const record = { resource_id: AFTERSALE_ID, response_body: null, response_status: 200 };
    current.idempotency.claim.mockResolvedValueOnce({ kind: 'replay', record });
    current.aftersales.getForReplayInTransaction.mockImplementationOnce(async () => {
      current.sequence.push('getAftersaleReplay');
      return command('REFUNDING', inspection());
    });

    await expect(current.service.approveAftersale(
      request,
      AFTERSALE_ID,
      { note: 'Approve the valid return request' },
      999,
      CONFIRM_KEY,
    )).resolves.toMatchObject({
      aftersale_id: AFTERSALE_ID,
      inspection: {
        inspected_by: { account_id: ACCOUNT_ID, display_name: '总部管理员' },
        items: [{ order_item_id: ORDER_ITEM_ID, scrap_qty: 1 }],
      },
    });

    expect(current.sequence).toEqual(['getAftersaleReplay', 'assertReplay']);
    expect(current.aftersales.approveInTransaction).not.toHaveBeenCalled();
    expect(current.audit.append).not.toHaveBeenCalled();
  });

  it('keeps a contract-valid one-character approve note out of the two-character audit reason field', async () => {
    const current = harness();

    await current.service.approveAftersale(request, AFTERSALE_ID, { note: 'A' }, 3, CONFIRM_KEY);

    expect(current.audit.append).toHaveBeenCalledWith(
      current.transaction,
      expect.not.objectContaining({ reason: expect.anything() }),
    );
  });

  it('binds the initial return-address preview to null/zero/one singleton facts', async () => {
    const current = harness();

    await current.service.previewReturnAddress(request, addressInput, PREVIEW_KEY);

    expect(current.previews.issueInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        action: 'RETURN_ADDRESS.PUBLISH',
        actorId: ACCOUNT_ID,
        request: expect.objectContaining({
          current_published_id: null,
          max_version_no: 0,
        }),
        resourceVersion: 1,
        sessionId: SESSION_ID,
        targetId: RETURN_ADDRESS_SINGLETON_ID,
        targetType: 'RETURN_ADDRESS',
      }),
    );
    const completed = current.idempotency.complete.mock.calls[0]?.[2];
    expect(completed).toMatchObject({ responseStatus: 200, storage: 'HASH_ONLY' });
    expect(JSON.stringify(completed)).not.toContain(addressInput.phone);
    expect(JSON.stringify(completed)).not.toContain(addressInput.detail);
    expect(JSON.stringify(completed)).not.toContain(CONFIRMATION_HASH);
  });

  it('replays the exact historical return-address version before If-Match and preview checks', async () => {
    const current = harness();
    const record = { resource_id: VERSION_ID, response_body: null, response_status: 200 };
    current.idempotency.claim.mockResolvedValueOnce({ kind: 'replay', record });
    const input: AdminReturnAddressConfirmation = {
      ...addressInput,
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
    };

    await expect(current.service.publishReturnAddress(
      request,
      input,
      999,
      CONFIRM_KEY,
    )).resolves.toMatchObject({ version_id: VERSION_ID, version_no: 1 });

    expect(current.returnAddresses.getForReplayInTransaction).toHaveBeenCalledWith(
      current.transaction,
      ACCOUNT_ID,
      VERSION_ID,
    );
    expect(current.sequence).toEqual(['assertReplay']);
    expect(current.returnAddresses.previewPublishInTransaction).not.toHaveBeenCalled();
    expect(current.returnAddresses.publishInTransaction).not.toHaveBeenCalled();
    expect(current.previews.consumeInTransaction).not.toHaveBeenCalled();
  });

  it('publishes with current facts, separated key scope, and an address-free status/version audit', async () => {
    const current = harness();
    const input: AdminReturnAddressConfirmation = {
      ...addressInput,
      confirmationHash: CONFIRMATION_HASH,
      previewToken: PREVIEW_TOKEN,
    };

    await current.service.publishReturnAddress(request, input, 1, CONFIRM_KEY);

    expect(current.sequence).toEqual([
      'claim',
      'assertDifferentKey',
      'previewAddress',
      'publishAddress',
      'consumePreview',
      'audit',
      'complete',
    ]);
    expect(current.returnAddresses.publishInTransaction).toHaveBeenCalledWith(
      current.transaction,
      expect.objectContaining({
        expectedCurrentPublishedId: null,
        expectedMaxVersionNo: 0,
        expectedVersion: 1,
        reason: addressInput.reason,
      }),
      expect.any(Object),
    );
    expect(current.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'PUBLISH',
      after: { status: 'PUBLISHED', version: 1 },
      module: 'config',
      objectType: 'return_address',
      reason: addressInput.reason,
      summaryPolicy: 'STATUS_VERSION',
    }));
    const persisted = JSON.stringify([
      current.audit.append.mock.calls,
      current.idempotency.complete.mock.calls.map((call) => call[2]),
    ]);
    expect(persisted).not.toContain(addressInput.phone);
    expect(persisted).not.toContain(addressInput.detail);
    expect(persisted).not.toContain(PREVIEW_TOKEN);
    expect(persisted).not.toContain(CONFIRMATION_HASH);
  });

  it('serializes evidence, inspection, and decrypted return-address snapshot in Admin detail', async () => {
    const current = harness();
    const secured = createReturnAddressSnapshotSecurityMaterial({
      detail: addressInput.detail,
      phone: addressInput.phone,
      snapshotId: SNAPSHOT_ID,
    }, FIELD_KEY);
    current.aftersales.getDetail.mockResolvedValueOnce({
      aftersaleId: AFTERSALE_ID,
      aftersaleNo: `AS${AFTERSALE_ID}`,
      applicationEvidenceFileIds: [EVIDENCE_ID],
      availableActions: ['APPROVE', 'REJECT', 'VIEW_ORDER'],
      commissionImpact: [],
      createdAt: NOW,
      inspection: inspection(),
      inventoryImpact: [],
      items: [],
      orderDetail: {
        customer: {
          customerAlias: 'development-customer',
          customerId: ACCOUNT_ID,
          nicknameMasked: null,
          phoneMasked: null,
        },
        order: {
          closeReason: null,
          completionReason: null,
          fulfillmentStatus: 'READY_TO_SHIP',
          orderId: ORDER_ID,
          orderNo: `QX${ORDER_ID}`,
          orderStatus: 'PENDING_SHIPMENT',
          paymentResolution: 'NORMAL',
          paymentStatus: 'PAID',
          refundProcessingStatus: 'IDLE',
          refundProgressStatus: 'NONE',
        },
      },
      orderId: ORDER_ID,
      reasonCode: 'ITEM_DAMAGED',
      reasonText: null,
      refundAttempts: [],
      returnAddress: {
        city: addressInput.city,
        detailCiphertext: secured.detailCiphertext,
        district: addressInput.district,
        encryptionKeyId: secured.encryptionKeyId,
        phoneCiphertext: secured.phoneCiphertext,
        phoneLast4: secured.phoneLast4,
        province: addressInput.province,
        recipientName: addressInput.recipientName,
        snapshotId: SNAPSHOT_ID,
        sourceVersionId: VERSION_ID,
        sourceVersionNo: 1,
      },
      returnShipment: null,
      status: 'PENDING_REVIEW',
      timeline: [],
      type: 'REFUND_ONLY',
      version: 1,
    } as unknown as AdminAftersaleDetailSnapshot);

    await expect(current.service.getAftersale(AFTERSALE_ID)).resolves.toMatchObject({
      aftersale_id: AFTERSALE_ID,
      application_evidence_file_ids: [EVIDENCE_ID],
      inspection: {
        inspected_by: { account_id: ACCOUNT_ID, display_name: '总部管理员' },
        items: [{ order_item_id: ORDER_ITEM_ID, scrap_qty: 1 }],
      },
      return_address_snapshot: {
        detail: addressInput.detail,
        phone: addressInput.phone,
      },
    });
  });
});
