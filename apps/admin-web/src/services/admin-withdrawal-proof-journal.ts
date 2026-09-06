import { authSession } from '../stores/auth-session';
import type { AdminWithdrawal } from '../types/admin-b13';
import { AdminApiError, newIdempotencyKey } from './admin-api';
import { attachAdminWithdrawalProofs } from './admin-withdrawals';

export const ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY = 'qingxu:admin-withdrawal-proof:v1';
export const ADMIN_WITHDRAWAL_PROOF_JOURNAL_TTL_MS = 24 * 60 * 60 * 1_000;

export class AdminWithdrawalProofJournalError extends Error {}

export interface AdminWithdrawalProofJournal {
  readonly account_fingerprint: string;
  readonly created_at: string;
  readonly file_id: string;
  readonly idempotency_key: string;
  readonly schema_version: 1;
  readonly withdrawal_id: string;
}

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const FIELDS = [
  'account_fingerprint', 'created_at', 'file_id', 'idempotency_key', 'schema_version', 'withdrawal_id',
] as const;

function clearStored(): void {
  try {
    sessionStorage.removeItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY);
  } catch {
    throw new AdminWithdrawalProofJournalError('Unable to clear the withdrawal proof journal');
  }
}

function readStored(now = Date.now()): AdminWithdrawalProofJournal | null {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY);
  } catch {
    throw new AdminWithdrawalProofJournalError('Unable to read the withdrawal proof journal');
  }
  if (raw === null) return null;
  if (raw === '') {
    clearStored();
    return null;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    clearStored();
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    clearStored();
    return null;
  }
  const journal = value as Record<string, unknown>;
  const createdAt = typeof journal.created_at === 'string' ? Date.parse(journal.created_at) : NaN;
  if (Object.keys(journal).length !== FIELDS.length || FIELDS.some((field) => !Object.hasOwn(journal, field)) ||
    journal.schema_version !== 1 || typeof journal.account_fingerprint !== 'string' ||
    !HASH.test(journal.account_fingerprint) || typeof journal.file_id !== 'string' || !ULID.test(journal.file_id) ||
    typeof journal.withdrawal_id !== 'string' || !ULID.test(journal.withdrawal_id) ||
    typeof journal.idempotency_key !== 'string' || !UUID_V4.test(journal.idempotency_key) ||
    !Number.isFinite(createdAt) || createdAt > now || createdAt + ADMIN_WITHDRAWAL_PROOF_JOURNAL_TTL_MS <= now) {
    clearStored();
    return null;
  }
  return journal as unknown as AdminWithdrawalProofJournal;
}

async function accountFingerprint(): Promise<string> {
  const accountId = authSession.state.session?.account_id;
  if (!accountId || !ULID.test(accountId)) {
    throw new AdminWithdrawalProofJournalError('An administrator session is required');
  }
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`qingxu:admin-withdrawal-proof:account:v1:${accountId}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sameJournal(left: AdminWithdrawalProofJournal, right: AdminWithdrawalProofJournal): boolean {
  return FIELDS.every((field) => left[field] === right[field]);
}

export async function recoverAdminWithdrawalProofJournal(
  now = Date.now(),
): Promise<AdminWithdrawalProofJournal | null> {
  const stored = readStored(now);
  if (!stored) return null;
  if (stored.account_fingerprint !== await accountFingerprint()) {
    clearStored();
    return null;
  }
  return { ...stored };
}

export async function prepareAdminWithdrawalProofJournal(
  withdrawalId: string,
  fileId: string,
  now = Date.now(),
): Promise<AdminWithdrawalProofJournal> {
  if (!ULID.test(withdrawalId) || !ULID.test(fileId) || !Number.isFinite(now)) {
    throw new TypeError('Withdrawal proof journal input is invalid');
  }
  const fingerprint = await accountFingerprint();
  const stored = readStored(now);
  if (stored) {
    if (stored.account_fingerprint !== fingerprint) clearStored();
    else if (stored.withdrawal_id === withdrawalId && stored.file_id === fileId) return { ...stored };
    else {
      throw new AdminWithdrawalProofJournalError('Another withdrawal proof is awaiting confirmation');
    }
  }
  const journal: AdminWithdrawalProofJournal = {
    account_fingerprint: fingerprint,
    created_at: new Date(now).toISOString(),
    file_id: fileId,
    idempotency_key: newIdempotencyKey(),
    schema_version: 1,
    withdrawal_id: withdrawalId,
  };
  try {
    sessionStorage.setItem(ADMIN_WITHDRAWAL_PROOF_JOURNAL_KEY, JSON.stringify(journal));
  } catch {
    throw new AdminWithdrawalProofJournalError('Unable to persist the withdrawal proof journal');
  }
  return { ...journal };
}

export function clearAdminWithdrawalProofJournal(expected: AdminWithdrawalProofJournal): void {
  const stored = readStored();
  if (stored && sameJournal(stored, expected)) clearStored();
}

export function isCertainAdminWithdrawalProofFailure(error: unknown): boolean {
  return error instanceof AdminApiError && error.code !== 'SESSION_CHANGED' &&
    [400, 403, 404, 409, 422].includes(error.status);
}

export async function executeAdminWithdrawalProofJournal(
  candidate: AdminWithdrawalProofJournal,
  signal?: AbortSignal,
): Promise<AdminWithdrawal> {
  const stored = await recoverAdminWithdrawalProofJournal();
  if (!stored || !sameJournal(stored, candidate)) {
    throw new AdminWithdrawalProofJournalError('Withdrawal proof journal changed before execution');
  }
  try {
    const result = await attachAdminWithdrawalProofs(
      stored.withdrawal_id,
      { file_ids: [stored.file_id] },
      stored.idempotency_key,
      signal,
    );
    if (!result.proof_file_ids.includes(stored.file_id)) {
      throw new AdminApiError('The proof binding response is incomplete', { status: 502, code: 'INVALID_RESPONSE' });
    }
    clearAdminWithdrawalProofJournal(stored);
    return result;
  } catch (error) {
    if (isCertainAdminWithdrawalProofFailure(error)) clearAdminWithdrawalProofJournal(stored);
    throw error;
  }
}
