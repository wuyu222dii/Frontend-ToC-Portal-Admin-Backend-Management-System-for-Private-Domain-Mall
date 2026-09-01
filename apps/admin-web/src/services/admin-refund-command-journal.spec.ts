import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authSession } from '../stores/auth-session';
import type { AdminAuthSession } from '../types/auth';
import { AdminApiError } from './admin-api';
import type { HighRiskPreview } from './admin-aftersales-types';

const mocks = vi.hoisted(() => ({
  confirmManual: vi.fn(),
  confirmRetry: vi.fn(),
  keySequence: 0,
  newIdempotencyKey: vi.fn(() => {
    mocks.keySequence += 1;
    return `00000000-0000-4000-8000-${String(mocks.keySequence).padStart(12, '0')}`;
  }),
}));

vi.mock('./admin-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('./admin-api')>(),
  newIdempotencyKey: mocks.newIdempotencyKey,
}));
vi.mock('./admin-aftersales', () => ({
  confirmAdminManualCompensation: mocks.confirmManual,
  confirmAdminRefundRetry: mocks.confirmRetry,
}));

import {
  ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY,
  executeAdminRefundCommandJournal,
  prepareAdminRefundCommandJournal,
  recoverAdminRefundCommandJournal,
} from './admin-refund-command-journal';

const ACCOUNT_A = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const ACCOUNT_B = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const ORDER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const OTHER_ORDER_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const ORDER_ITEM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const REFUND_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const REASON = 'Provider response needs manual compensation review';

const preview: HighRiskPreview = {
  preview_token: 'preview_admin_refund_command',
  confirmation_hash: 'a'.repeat(64),
  resource_etag: '"4"',
  expires_at: '2099-09-01T02:01:00.000Z',
  impact: {
    affected_count: 1,
    metrics: [{ key: 'amount', label: 'Amount', before: '0.00', after: '9.00' }],
    warnings: ['Funds will be submitted to the provider'],
  },
};

function session(accountId: string, suffix: string): AdminAuthSession {
  return {
    access_token: `admin-access-${suffix}`,
    refresh_token: `admin-refresh-${suffix}`,
    account_id: accountId,
    session_id: `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}`,
    role: 'SUPER_ADMIN',
    mfa_required: false,
    assurance: 'MFA',
    restriction: 'NONE',
    expires_at: '2099-09-01T03:00:00.000Z',
  };
}

function storageEnvironment() {
  const values = new Map<string, string>();
  const calls: string[] = [];
  vi.stubGlobal('sessionStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      calls.push(`set:${key}`);
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      calls.push(`remove:${key}`);
      values.delete(key);
    }),
  });
  return { calls, values };
}

function manualDraft(orderId = ORDER_ID) {
  return {
    mode: 'MANUAL_COMPENSATION' as const,
    order_id: orderId,
    input: { amount: '9.00', order_item_id: ORDER_ITEM_ID, reason: REASON },
    preview,
  };
}

describe('B12 admin refund command journal', () => {
  beforeEach(() => {
    mocks.confirmManual.mockReset();
    mocks.confirmRetry.mockReset();
    authSession.acceptSession(session(ACCOUNT_A, 'A1'));
  });

  afterEach(() => {
    authSession.clearSession();
    vi.unstubAllGlobals();
  });

  it('persists a redacted, salted full-request hash before sending and reuses the exact command after loss', async () => {
    const storage = storageEnvironment();
    const success = { compensation_id: '01ARZ3NDEKTSV4RRFFQ69G5FB1' };
    mocks.confirmManual.mockImplementationOnce(async () => {
      const serialized = storage.values.get(ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY) ?? '';
      expect(storage.calls[0]).toBe(`set:${ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY}`);
      expect(serialized).not.toContain(REASON);
      expect(JSON.parse(serialized)).toMatchObject({
        schema_version: 1,
        entries: [{ request_hash: expect.stringMatching(/^[a-f0-9]{64}$/), request_salt: expect.stringMatching(/^[a-f0-9]{32}$/) }],
      });
      throw new AdminApiError('response lost', { status: 0 });
    }).mockResolvedValueOnce(success);

    const journal = await prepareAdminRefundCommandJournal(manualDraft());
    await expect(executeAdminRefundCommandJournal(journal, REASON)).rejects.toMatchObject({ status: 0 });
    await expect(recoverAdminRefundCommandJournal()).resolves.toEqual(journal);
    await expect(executeAdminRefundCommandJournal(journal, REASON)).resolves.toBe(success);

    expect(mocks.confirmManual).toHaveBeenCalledTimes(2);
    expect(mocks.confirmManual.mock.calls[0]).toEqual(mocks.confirmManual.mock.calls[1]);
    expect(storage.values.has(ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('rejects a changed reason against the persisted full-request hash without a network call', async () => {
    storageEnvironment();
    const journal = await prepareAdminRefundCommandJournal(manualDraft());

    await expect(executeAdminRefundCommandJournal(journal, 'Different compensation reason'))
      .rejects.toMatchObject({ code: 'REQUEST_MISMATCH' });
    expect(mocks.confirmManual).not.toHaveBeenCalled();
    await expect(recoverAdminRefundCommandJournal()).resolves.toEqual(journal);
  });

  it.each([
    new AdminApiError('reauth required', { status: 401, code: 'AUTH_REQUIRED' }),
    new AdminApiError('session changed', { status: 409, code: 'SESSION_CHANGED' }),
    new AdminApiError('idempotency request mismatch', { status: 409, code: 'STATE_CONFLICT' }),
  ])('retains the journal for ambiguous auth or idempotency failure %#', async (failure) => {
    storageEnvironment();
    mocks.confirmManual.mockRejectedValue(failure);
    const journal = await prepareAdminRefundCommandJournal(manualDraft());

    await expect(executeAdminRefundCommandJournal(journal, REASON)).rejects.toBe(failure);
    await expect(recoverAdminRefundCommandJournal()).resolves.toEqual(journal);
  });

  it('clears a definitely rejected command', async () => {
    storageEnvironment();
    const failure = new AdminApiError('quota changed', { status: 422, code: 'AFTERSALE_QUOTA_EXCEEDED' });
    mocks.confirmManual.mockRejectedValue(failure);
    const journal = await prepareAdminRefundCommandJournal(manualDraft());

    await expect(executeAdminRefundCommandJournal(journal, REASON)).rejects.toBe(failure);
    await expect(recoverAdminRefundCommandJournal()).resolves.toBeNull();
  });

  it('keeps separate unresolved entries for different accounts and restores each after a new login session', async () => {
    const storage = storageEnvironment();
    const journalA = await prepareAdminRefundCommandJournal(manualDraft());

    authSession.acceptSession(session(ACCOUNT_B, 'B1'));
    const journalB = await prepareAdminRefundCommandJournal({
      mode: 'RETRY_REFUND',
      order_id: OTHER_ORDER_ID,
      refund_id: REFUND_ID,
      input: { reason: 'Retry the failed provider refund' },
      preview: { ...preview, confirmation_hash: 'b'.repeat(64), resource_etag: '"7"' },
    });
    expect(journalB.account_fingerprint).not.toBe(journalA.account_fingerprint);
    expect(JSON.parse(storage.values.get(ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY) ?? '').entries)
      .toHaveLength(2);

    authSession.acceptSession(session(ACCOUNT_A, 'A2'));
    await expect(recoverAdminRefundCommandJournal()).resolves.toEqual(journalA);
    authSession.acceptSession(session(ACCOUNT_B, 'B2'));
    await expect(recoverAdminRefundCommandJournal()).resolves.toEqual(journalB);
  });
});
