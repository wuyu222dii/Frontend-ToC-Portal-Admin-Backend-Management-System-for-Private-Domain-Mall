import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction, IdempotencyHashKeyRing } from './idempotency.repository';
import {
  STORE_DELETION_PREVIEW_TTL_MS,
  StorePrivacyRepository,
} from './store-privacy.repository';

const NOW = new Date('2026-08-27T09:00:00.000Z');
const ACCOUNT_ID = generateUlid(NOW.getTime() - 10_000);
const CUSTOMER_ID = generateUlid(NOW.getTime() - 9_000);
const SESSION_ID = generateUlid(NOW.getTime() - 8_000);
const DELETION_ID = generateUlid(NOW.getTime() - 7_000);
const CHANGE_ID = generateUlid(NOW.getTime() - 6_000);
const PREVIEW_TOKEN = `del_${'a'.repeat(40)}`;
const REQUEST = { acknowledged: true } as const;

function ring(byte = 0x71, id = 'store-privacy-v1'): IdempotencyHashKeyRing {
  return { current: { id, key: Buffer.alloc(32, byte) }, previous: [] };
}

function harness(keys = ring()) {
  let currentTime = NOW;
  let previewRecord: Record<string, unknown> | null = null;
  const counts = {
    aftersale: 0,
    financialOrders: 0,
    manualCompensation: 0,
    orders: 0,
    paymentIntent: 0,
    refund: 0,
  };
  const highRiskOperationPreview = {
    create: vi.fn(async ({ data, select }: { data: Record<string, unknown>; select?: Record<string, boolean> }) => {
      previewRecord = { ...data };
      if (!select) return previewRecord;
      return Object.fromEntries(Object.keys(select).map((key) => [key, previewRecord?.[key]]));
    }),
    findUnique: vi.fn(async ({ where, select }: {
      where: { id?: string; preview_token_hash?: string };
      select?: Record<string, boolean>;
    }) => {
      if (!previewRecord) return null;
      const matches = where.id !== undefined
        ? where.id === previewRecord.id
        : where.preview_token_hash === previewRecord.preview_token_hash;
      if (!matches) return null;
      if (!select) return { ...previewRecord };
      return Object.fromEntries(Object.keys(select).map((key) => [key, previewRecord?.[key]]));
    }),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      if (!previewRecord || previewRecord.consumed_at !== null) return { count: 0 };
      previewRecord = { ...previewRecord, ...data };
      return { count: 1 };
    }),
  };
  const transaction = {
    $executeRaw: vi.fn(async () => 2),
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    account: {
      findUnique: vi.fn(async () => ({
        customer_profile: {
          account_id: ACCOUNT_ID,
          anonymized_at: null,
          id: CUSTOMER_ID,
          version: 4,
        },
        deleted_at: null,
        id: ACCOUNT_ID,
        login_name: null,
        password_hash: null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        version: 3,
        wechat_open_id: 'mock-open-id',
      })),
      update: vi.fn(async () => ({ version: 4 })),
    },
    accountDeletionRequest: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      update: vi.fn(async ({ data, where }: {
        data: Record<string, unknown>;
        where: { id: string };
      }) => data.status === 'COMPLETED' ? {
        completed_at: data.completed_at,
        id: where.id,
        status: 'COMPLETED',
        submitted_at: NOW,
      } : { ...data, id: where.id }),
    },
    aftersale: { count: vi.fn(async () => counts.aftersale) },
    agentCustomerPrivacyProjection: { updateMany: vi.fn() },
    attributionCandidate: { updateMany: vi.fn() },
    authSession: {
      findUnique: vi.fn(async () => ({
        account_id: ACCOUNT_ID,
        assurance: 'WECHAT',
        expires_at: new Date(NOW.getTime() + 60_000),
        revoked_at: null,
      })),
    },
    bindingChangeLog: { create: vi.fn() },
    cartItem: { deleteMany: vi.fn() },
    customerAddress: { deleteMany: vi.fn() },
    customerAgentBinding: { findMany: vi.fn(async () => []), update: vi.fn() },
    customerPhoneVerification: { deleteMany: vi.fn() },
    customerProfile: { update: vi.fn() },
    favorite: { deleteMany: vi.fn() },
    highRiskOperationPreview,
    manualCompensation: { count: vi.fn(async () => counts.manualCompensation) },
    paymentIntent: { count: vi.fn(async () => counts.paymentIntent) },
    refund: { count: vi.fn(async () => counts.refund) },
    salesOrder: {
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        Object.prototype.hasOwnProperty.call(where, 'order_status') ? counts.orders : counts.financialOrders),
    },
  };
  return {
    counts,
    getPreviewRecord: () => previewRecord,
    repository: new StorePrivacyRepository({} as PrismaClient, keys, () => currentTime),
    setNow: (value: Date) => { currentTime = value; },
    transaction: transaction as unknown as DatabaseTransaction,
    transactionMock: transaction,
  };
}

function previewInput() {
  return {
    accountId: ACCOUNT_ID,
    customerId: CUSTOMER_ID,
    previewToken: PREVIEW_TOKEN,
    request: REQUEST,
    sessionId: SESSION_ID,
  };
}

describe('StorePrivacyRepository', () => {
  it('returns all blocker categories once, in contract order, without issuing a capability', async () => {
    const context = harness();
    Object.assign(context.counts, {
      aftersale: 2,
      financialOrders: 1,
      manualCompensation: 2,
      orders: 3,
      paymentIntent: 4,
      refund: 5,
    });

    await expect(context.repository.previewDeletionInTransaction(
      context.transaction,
      previewInput(),
    )).resolves.toEqual({
      accountVersion: 3,
      blockers: [
        { count: 3, resourceType: 'ORDER' },
        { count: 2, resourceType: 'AFTERSALE' },
        { count: 4, resourceType: 'PAYMENT' },
        { count: 5, resourceType: 'REFUND' },
        { count: 3, resourceType: 'FINANCIAL_ANOMALY' },
      ],
      preview: null,
    });
    expect(context.transactionMock.highRiskOperationPreview.create).not.toHaveBeenCalled();
    expect(context.transactionMock.salesOrder.count.mock.calls[1]?.[0]).toMatchObject({
      where: {
        OR: expect.arrayContaining([
          { payment_resolution: 'MANUAL_REQUIRED' },
          { payment_resolution: 'LATE_SUCCESS_REFUND_PENDING' },
          {
            payment_intents: { none: { status: { in: ['CREATING', 'OPEN', 'CLOSE_PENDING'] } } },
            payment_status: 'PROCESSING',
          },
          {
            refund_processing_status: { in: ['REFUNDING', 'FAILED'] },
            refunds: { none: { status: { in: ['PENDING', 'PROCESSING', 'FAILED'] } } },
          },
        ]),
      },
    });
  });

  it('stores only separated hashes and fixes eligible capability expiry to five minutes', async () => {
    const context = harness();
    const result = await context.repository.previewDeletionInTransaction(context.transaction, previewInput());

    expect(result.accountVersion).toBe(3);
    expect(result.blockers).toEqual([]);
    expect(result.preview).toMatchObject({
      confirmationHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: new Date(NOW.getTime() + STORE_DELETION_PREVIEW_TTL_MS),
    });
    expect(context.getPreviewRecord()).toMatchObject({
      action: 'ACCOUNT.ANONYMIZE',
      actor_account_id: ACCOUNT_ID,
      resource_version: 3,
      session_id: SESSION_ID,
      target_id: ACCOUNT_ID,
      target_type: 'ACCOUNT',
    });
    const stored = JSON.stringify(context.getPreviewRecord());
    expect(stored).not.toContain(PREVIEW_TOKEN);
    expect(stored).not.toContain('acknowledged');
  });

  it('rechecks blockers before starting deletion mutations for an otherwise valid preview', async () => {
    const context = harness();
    const issued = await context.repository.previewDeletionInTransaction(context.transaction, previewInput());
    context.counts.orders = 1;

    await expect(context.repository.confirmDeletionInTransaction(context.transaction, {
      ...previewInput(),
      anonymousAlias: `deleted_${DELETION_ID.toLowerCase()}`,
      bindingChangeLogId: CHANGE_ID,
      confirmationHash: issued.preview!.confirmationHash,
      deletionRequestId: DELETION_ID,
      expectedAccountVersion: 3,
    })).rejects.toMatchObject({ code: 'ACCOUNT_DELETION_BLOCKED' });
    expect(context.getPreviewRecord()).toMatchObject({ consumed_at: NOW });
    expect(context.transactionMock.accountDeletionRequest.create).not.toHaveBeenCalled();
  });

  it('completes every deletion surface and writes a CHECK-compatible revoked session tombstone', async () => {
    const context = harness();
    const issued = await context.repository.previewDeletionInTransaction(context.transaction, previewInput());
    await expect(context.repository.confirmDeletionInTransaction(context.transaction, {
      ...previewInput(),
      anonymousAlias: `deleted_${generateUlid().toLowerCase()}`,
      bindingChangeLogId: CHANGE_ID,
      confirmationHash: issued.preview!.confirmationHash,
      deletionRequestId: DELETION_ID,
      expectedAccountVersion: 3,
    })).resolves.toEqual({
      accountVersion: 4,
      completedAt: NOW,
      requestId: DELETION_ID,
      status: 'COMPLETED',
      submittedAt: NOW,
    });
    const sessionSql = (context.transactionMock.$executeRaw.mock.calls[0]?.[0] as TemplateStringsArray).join(' ');
    expect(sessionSql).toContain('"refresh_token_hash" = NULL');
    expect(sessionSql).toContain('"restriction" = \'CHANGE_PASSWORD_ONLY\'');
    expect(sessionSql).toContain('"assurance" = \'PASSWORD\'');
    expect(sessionSql).toContain('"mfa_factor_id" = NULL');
    expect(sessionSql).toContain('"mfa_verified_at" = NULL');
    expect(context.transactionMock.customerPhoneVerification.deleteMany).toHaveBeenCalledOnce();
    expect(context.transactionMock.customerAddress.deleteMany).toHaveBeenCalledOnce();
    expect(context.transactionMock.favorite.deleteMany).toHaveBeenCalledOnce();
    expect(context.transactionMock.cartItem.deleteMany).toHaveBeenCalledOnce();
    expect(context.transactionMock.account.update).toHaveBeenCalledOnce();
  });

  it('accepts a preview issued with a previous key and rejects tampering or expiry first', async () => {
    const shared = harness(ring(0x41, 'old-key-v1'));
    const issued = await shared.repository.previewDeletionInTransaction(shared.transaction, previewInput());
    shared.counts.refund = 1;
    const rotated = new StorePrivacyRepository({} as PrismaClient, {
      current: { id: 'new-key-v2', key: Buffer.alloc(32, 0x42) },
      previous: [{ id: 'old-key-v1', key: Buffer.alloc(32, 0x41) }],
    }, () => NOW);
    const confirmation = {
      ...previewInput(),
      anonymousAlias: `deleted_${DELETION_ID.toLowerCase()}`,
      bindingChangeLogId: CHANGE_ID,
      confirmationHash: issued.preview!.confirmationHash,
      deletionRequestId: DELETION_ID,
      expectedAccountVersion: 3,
    };
    await expect(rotated.confirmDeletionInTransaction(shared.transaction, confirmation)).rejects.toMatchObject({
      code: 'ACCOUNT_DELETION_BLOCKED',
    });

    const tamperedContext = harness(ring(0x41, 'old-key-v1'));
    await tamperedContext.repository.previewDeletionInTransaction(
      tamperedContext.transaction,
      previewInput(),
    );
    await expect(rotated.confirmDeletionInTransaction(tamperedContext.transaction, {
      ...confirmation,
      confirmationHash: '0'.repeat(64),
    })).rejects.toMatchObject({ code: 'CONFIRMATION_MISMATCH' });

    const expiredContext = harness(ring(0x41, 'old-key-v1'));
    const expiredIssued = await expiredContext.repository.previewDeletionInTransaction(
      expiredContext.transaction,
      previewInput(),
    );
    const expired = new StorePrivacyRepository({} as PrismaClient, {
      current: { id: 'new-key-v2', key: Buffer.alloc(32, 0x42) },
      previous: [{ id: 'old-key-v1', key: Buffer.alloc(32, 0x41) }],
    }, () => new Date(NOW.getTime() + STORE_DELETION_PREVIEW_TTL_MS));
    await expect(expired.confirmDeletionInTransaction(expiredContext.transaction, {
      ...confirmation,
      confirmationHash: expiredIssued.preview!.confirmationHash,
    })).rejects.toMatchObject({
      code: 'PREVIEW_EXPIRED',
    });
  });

  it('rejects malformed keys, clocks, request shapes and aliases before persistence', async () => {
    expect(() => new StorePrivacyRepository({} as PrismaClient, {
      current: { id: 'short', key: Buffer.alloc(8) },
      previous: [],
    })).toThrow('at least 32 bytes');
    expect(() => new StorePrivacyRepository({} as PrismaClient, ring(), () => new Date('invalid'))).toThrow(
      'clock must return a valid Date',
    );
    const context = harness();
    await expect(context.repository.previewDeletionInTransaction(context.transaction, {
      ...previewInput(),
      request: { acknowledged: false as true },
    })).rejects.toThrow('must be acknowledged');
    expect(context.transactionMock.account.findUnique).not.toHaveBeenCalled();
  });
});
