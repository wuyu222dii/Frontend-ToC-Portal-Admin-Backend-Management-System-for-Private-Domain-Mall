import { beforeEach, describe, expect, it, vi } from 'vitest';

import { authSession } from '../stores/auth-session';
import { AdminApiError } from './admin-api';

const { attachProofs } = vi.hoisted(() => ({ attachProofs: vi.fn() }));
vi.mock('./admin-withdrawals', () => ({ attachAdminWithdrawalProofs: attachProofs }));

import {
  ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY,
  AdminWithdrawalProofJournalError,
  executeAdminWithdrawalProofJournal,
  prepareAdminWithdrawalProofJournal,
  recoverAdminWithdrawalProofJournal,
} from './admin-withdrawal-proof-journal';

const ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const OTHER_ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const WITHDRAWAL = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const FILE = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

function signIn(accountId = ACCOUNT): void {
  authSession.state.session = { account_id: accountId } as never;
}

describe('admin withdrawal proof journal', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: new MemoryStorage() });
    attachProofs.mockReset();
    signIn();
  });

  it('stores only the approved fields and removes invalid or expired state', async () => {
    const now = Date.now();
    await prepareAdminWithdrawalProofJournal(WITHDRAWAL, FILE, now);
    expect(Object.keys(JSON.parse(sessionStorage.getItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY)!)).sort()).toEqual([
      'account_fingerprint', 'created_at', 'file_id', 'idempotency_key', 'schema_version', 'withdrawal_id',
    ]);
    expect(await recoverAdminWithdrawalProofJournal(now + 24 * 60 * 60 * 1_000)).toBeNull();
    sessionStorage.setItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY, '{bad json');
    expect(await recoverAdminWithdrawalProofJournal()).toBeNull();
    expect(sessionStorage.getItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY)).toBeNull();
  });

  it('replays the same file and idempotency key after an unknown result and same-account login', async () => {
    const journal = await prepareAdminWithdrawalProofJournal(WITHDRAWAL, FILE);
    attachProofs.mockRejectedValueOnce(new AdminApiError('network', { status: 0 }));
    await expect(executeAdminWithdrawalProofJournal(journal)).rejects.toMatchObject({ status: 0 });
    authSession.clearSession();
    signIn();
    attachProofs.mockResolvedValueOnce({ proof_file_ids: [FILE] });
    await executeAdminWithdrawalProofJournal(journal);
    expect(attachProofs.mock.calls.map((call) => [call[0], call[1], call[2]])).toEqual([
      [WITHDRAWAL, { file_ids: [FILE] }, journal.idempotency_key],
      [WITHDRAWAL, { file_ids: [FILE] }, journal.idempotency_key],
    ]);
    expect(sessionStorage.getItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY)).toBeNull();
  });

  it('makes no request for another account and clears only deterministic failures', async () => {
    const foreign = await prepareAdminWithdrawalProofJournal(WITHDRAWAL, FILE);
    signIn(OTHER_ACCOUNT);
    await expect(executeAdminWithdrawalProofJournal(foreign)).rejects.toBeInstanceOf(
      AdminWithdrawalProofJournalError,
    );
    expect(attachProofs).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY)).toBeNull();

    const current = await prepareAdminWithdrawalProofJournal(WITHDRAWAL, FILE);
    attachProofs.mockRejectedValueOnce(new AdminApiError('changed session', {
      code: 'SESSION_CHANGED',
      status: 409,
    }));
    await expect(executeAdminWithdrawalProofJournal(current)).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(await recoverAdminWithdrawalProofJournal()).toEqual(current);

    attachProofs.mockRejectedValueOnce(new AdminApiError('state conflict', { status: 409 }));
    await expect(executeAdminWithdrawalProofJournal(current)).rejects.toMatchObject({ status: 409 });
    expect(sessionStorage.getItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY)).toBeNull();
  });
});
