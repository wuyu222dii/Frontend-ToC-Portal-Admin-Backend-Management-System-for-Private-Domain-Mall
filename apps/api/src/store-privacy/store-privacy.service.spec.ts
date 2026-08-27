import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { CurrentStoreSession, DatabaseRuntime, DatabaseTransaction } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StorePrivacyService } from './store-privacy.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const SESSION_FAMILY = '01J00000000000000000000003';
const KEY = '018f47a2-9f61-7c4f-8b6e-9a61b3470f2e';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-08-27T08:00:00.000Z');
const TOKEN = `pvw_${'a'.repeat(43)}`;
const HASH = 'b'.repeat(64);

function config(): PlatformRuntimeConfig {
  return {
    encryption: {
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 41) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 42),
    },
  } as unknown as PlatformRuntimeConfig;
}

function session(): CurrentStoreSession {
  return {
    accessJti: 'store-access-jti-00000001',
    accountId: ACCOUNT_ID,
    accountVersion: 4,
    customerId: CUSTOMER_ID,
    customerVersion: 3,
    expiresAt: new Date(NOW.getTime() + 60_000),
    sessionFamily: SESSION_FAMILY,
    sessionId: SESSION_ID,
  };
}

function harness() {
  const transaction = {} as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => unknown) => work(transaction)),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const privacy = {
    previewDeletionInTransaction: vi.fn().mockResolvedValue({
      accountVersion: 4,
      blockers: [],
      preview: { confirmationHash: HASH, expiresAt: new Date(NOW.getTime() + 300_000) },
    }),
    confirmDeletionInTransaction: vi.fn().mockResolvedValue({
      accountVersion: 5,
      completedAt: NOW,
      requestId: '01J00000000000000000000004',
      status: 'COMPLETED',
      submittedAt: NOW,
    }),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  const outbox = { append: vi.fn().mockResolvedValue({}) };
  const service = new StorePrivacyService(config(), database);
  Object.assign(service as unknown as Record<string, unknown>, { audit, idempotency, outbox, privacy });
  return { audit, idempotency, outbox, privacy, prisma, service, transaction };
}

describe('B7.4 Store privacy service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });

  it('issues an eligible five-minute HASH_ONLY preview without retaining the token', async () => {
    const { audit, idempotency, privacy, service } = harness();
    const response = await service.previewDeletion(session(), { acknowledged: true }, KEY, REQUEST_ID, '127.0.0.1');

    expect(response).toMatchObject({
      account_version: 4,
      blockers: [],
      confirmation_hash: HASH,
      eligible: true,
      expires_at: new Date(NOW.getTime() + 300_000).toISOString(),
      preview_token: expect.stringMatching(/^pvw_[A-Za-z0-9_-]{43}$/),
    });
    expect(privacy.previewDeletionInTransaction).toHaveBeenCalledWith(expect.anything(), {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      previewToken: response.preview_token,
      request: { acknowledged: true },
      sessionId: SESSION_ID,
    });
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'READ_SENSITIVE', actorAccountId: ACCOUNT_ID, module: 'privacy', objectType: 'account',
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: ACCOUNT_ID,
      responseForHash: expect.not.objectContaining({
        confirmation_hash: expect.anything(),
        preview_token: expect.anything(),
      }),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(JSON.stringify(idempotency.complete.mock.calls)).not.toContain(response.preview_token);
  });

  it('returns the same closed shape without a capability when deletion is blocked', async () => {
    const { privacy, service } = harness();
    privacy.previewDeletionInTransaction.mockResolvedValue({
      accountVersion: 4,
      blockers: [{ count: 2, resourceType: 'ORDER' }, { count: 1, resourceType: 'REFUND' }],
      preview: null,
    });
    await expect(service.previewDeletion(session(), { acknowledged: true }, KEY, REQUEST_ID)).resolves.toMatchObject({
      account_version: 4,
      blockers: [{ count: 2, resource_type: 'ORDER' }, { count: 1, resource_type: 'REFUND' }],
      confirmation_hash: null,
      eligible: false,
      expires_at: null,
      preview_token: null,
    });
  });

  it('rejects HASH_ONLY preview and confirm replay before privacy mutation', async () => {
    for (const operation of ['preview', 'confirm'] as const) {
      const { audit, idempotency, outbox, privacy, service } = harness();
      idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });
      const result = operation === 'preview'
        ? service.previewDeletion(session(), { acknowledged: true }, KEY, REQUEST_ID)
        : service.confirmDeletion(session(), {
            acknowledged: true, confirmationHash: HASH, previewToken: TOKEN,
          }, 4, KEY, REQUEST_ID);
      await expect(result).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
      expect(privacy.previewDeletionInTransaction).not.toHaveBeenCalled();
      expect(privacy.confirmDeletionInTransaction).not.toHaveBeenCalled();
      expect(audit.append).not.toHaveBeenCalled();
      expect(outbox.append).not.toHaveBeenCalled();
      expect(idempotency.complete).not.toHaveBeenCalled();
    }
  });

  it('confirms deletion with a bound preview, audit, outbox and HASH_ONLY completion', async () => {
    const { audit, idempotency, outbox, privacy, service } = harness();
    const response = await service.confirmDeletion(session(), {
      acknowledged: true,
      confirmationHash: HASH,
      previewToken: TOKEN,
    }, 4, KEY, REQUEST_ID, '127.0.0.1');

    expect(response).toEqual({
      completed_at: NOW.toISOString(),
      request_id: '01J00000000000000000000004',
      status: 'COMPLETED',
      submitted_at: NOW.toISOString(),
    });
    expect(privacy.confirmDeletionInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accountId: ACCOUNT_ID,
      anonymousAlias: expect.stringMatching(/^deleted_[0-9a-hjkmnp-tv-z]{26}$/),
      bindingChangeLogId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      confirmationHash: HASH,
      customerId: CUSTOMER_ID,
      deletionRequestId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      expectedAccountVersion: 4,
      previewToken: TOKEN,
      request: { acknowledged: true },
      sessionId: SESSION_ID,
    }));
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'ANONYMIZE', after: { status: 'ANONYMIZED', version: 5 }, before: { status: 'ACTIVE', version: 4 },
    }));
    expect(outbox.append).toHaveBeenCalledWith(expect.anything(), {
      aggregateId: ACCOUNT_ID,
      aggregateType: 'account',
      eventType: 'account.anonymized',
      payload: {
        event_version: 1,
        resource_id: ACCOUNT_ID,
        resource_type: 'account',
        resource_version: 5,
      },
    });
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: '01J00000000000000000000004',
      responseForHash: { account_version: 5, request_id: '01J00000000000000000000004', status: 'COMPLETED' },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    const storedResult = idempotency.complete.mock.calls[0]?.[2];
    expect(JSON.stringify(storedResult)).not.toContain(TOKEN);
    expect(JSON.stringify(storedResult)).not.toContain(HASH);
    expect(idempotency.claim.mock.invocationCallOrder[0]).toBeLessThan(
      privacy.confirmDeletionInTransaction.mock.invocationCallOrder[0] as number,
    );
    expect(privacy.confirmDeletionInTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      audit.append.mock.invocationCallOrder[0] as number,
    );
    expect(audit.append.mock.invocationCallOrder[0]).toBeLessThan(
      outbox.append.mock.invocationCallOrder[0] as number,
    );
    expect(outbox.append.mock.invocationCallOrder[0]).toBeLessThan(
      idempotency.complete.mock.invocationCallOrder[0] as number,
    );
  });

  it.each([
    ['CONFIRMATION_MISMATCH', 409],
    ['PREVIEW_EXPIRED', 409],
    ['RESOURCE_VERSION_CONFLICT', 409],
    ['ACCOUNT_DELETION_BLOCKED', 422],
  ] as const)('propagates %s without audit, outbox or completion', async (code, httpStatus) => {
    const { audit, idempotency, outbox, privacy, service } = harness();
    privacy.confirmDeletionInTransaction.mockRejectedValue(new ApplicationError(code, 'rejected'));
    await expect(service.confirmDeletion(session(), {
      acknowledged: true, confirmationHash: HASH, previewToken: TOKEN,
    }, 4, KEY, REQUEST_ID)).rejects.toMatchObject({ code, httpStatus });
    expect(audit.append).not.toHaveBeenCalled();
    expect(outbox.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['audit', 'append'],
    ['outbox', 'append'],
    ['idempotency', 'complete'],
  ] as const)('propagates a $label failure from the single transaction', async (label, method) => {
    const harnessed = harness();
    const dependency = harnessed[label] as Record<string, ReturnType<typeof vi.fn>>;
    dependency[method]?.mockRejectedValue(new Error(`${label} failed`));
    await expect(harnessed.service.confirmDeletion(session(), {
      acknowledged: true, confirmationHash: HASH, previewToken: TOKEN,
    }, 4, KEY, REQUEST_ID)).rejects.toThrow(`${label} failed`);
  });
});
