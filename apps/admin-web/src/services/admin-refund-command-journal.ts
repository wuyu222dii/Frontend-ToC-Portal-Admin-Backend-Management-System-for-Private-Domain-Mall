import { authSession } from '../stores/auth-session';
import { AdminApiError, newIdempotencyKey } from './admin-api';
import {
  confirmAdminManualCompensation,
  confirmAdminRefundRetry,
  type HighRiskPreview,
  type ManualCompensationInput,
  type ManualCompensationResult,
  type RefundRetryInput,
  type RefundRetryResult,
} from './admin-aftersales';

type PlainRecord = Record<string, unknown>;

export const ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY = 'qingxu:admin-refund-commands:v1';
export const ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION = 1;
export const ADMIN_REFUND_COMMAND_JOURNAL_TTL_MS = 24 * 60 * 60 * 1_000;
export const ADMIN_REFUND_COMMAND_JOURNAL_MAX_ENTRIES = 4;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const etagPattern = /^"[1-9][0-9]*"$/;
const moneyPattern = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;

export type AdminRefundCommandJournalErrorCode =
  | 'ACCOUNT_MISMATCH'
  | 'CRYPTO_UNAVAILABLE'
  | 'INVALID_JOURNAL'
  | 'JOURNAL_LIMIT'
  | 'PENDING_COMMAND'
  | 'REQUEST_MISMATCH'
  | 'SESSION_REQUIRED'
  | 'STORAGE_UNAVAILABLE';

export class AdminRefundCommandJournalError extends Error {
  readonly code: AdminRefundCommandJournalErrorCode;

  constructor(code: AdminRefundCommandJournalErrorCode, message: string) {
    super(message);
    this.name = 'AdminRefundCommandJournalError';
    this.code = code;
  }
}

interface StoredConfirmation {
  readonly preview_token: string;
  readonly confirmation_hash: string;
  readonly resource_etag: string;
  readonly expires_at: string;
}

export type AdminRefundCommandJournal =
  | {
      readonly schema_version: 1;
      readonly account_fingerprint: string;
      readonly created_at: string;
      readonly idempotency_key: string;
      readonly request_salt: string;
      readonly request_hash: string;
      readonly mode: 'MANUAL_COMPENSATION';
      readonly order_id: string;
      readonly order_item_id: string;
      readonly amount: string;
      readonly reason_present: true;
      readonly confirmation: StoredConfirmation;
    }
  | {
      readonly schema_version: 1;
      readonly account_fingerprint: string;
      readonly created_at: string;
      readonly idempotency_key: string;
      readonly request_salt: string;
      readonly request_hash: string;
      readonly mode: 'RETRY_REFUND';
      readonly order_id: string;
      readonly refund_id: string;
      readonly reason_present: true;
      readonly confirmation: StoredConfirmation;
    };

export type AdminRefundCommandDraft =
  | {
      readonly mode: 'MANUAL_COMPENSATION';
      readonly order_id: string;
      readonly input: ManualCompensationInput;
      readonly preview: HighRiskPreview;
    }
  | {
      readonly mode: 'RETRY_REFUND';
      readonly order_id: string;
      readonly refund_id: string;
      readonly input: RefundRetryInput;
      readonly preview: HighRiskPreview;
    };

type VolatileExecution =
  | { readonly mode: 'MANUAL_COMPENSATION'; readonly input: ManualCompensationInput; readonly preview: HighRiskPreview }
  | { readonly mode: 'RETRY_REFUND'; readonly input: RefundRetryInput; readonly preview: HighRiskPreview };

interface JournalCollection {
  readonly schema_version: 1;
  readonly entries: AdminRefundCommandJournal[];
}

const volatileExecutions = new Map<string, VolatileExecution>();

function fail(code: AdminRefundCommandJournalErrorCode, message: string): never {
  throw new AdminRefundCommandJournalError(code, message);
}

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: PlainRecord, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function decoded(value: string | null): unknown {
  if (value === null || value === '') return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail('INVALID_JOURNAL', 'Stored admin refund journal is not valid JSON');
  }
}

function storedValue(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY);
  } catch {
    return fail('STORAGE_UNAVAILABLE', 'Unable to read the admin refund journal');
  }
}

function setStoredValue(value: JournalCollection): void {
  try {
    sessionStorage.setItem(ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY, JSON.stringify(value));
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to persist the admin refund journal');
  }
}

function removeStoredValue(): void {
  try {
    sessionStorage.removeItem(ADMIN_REFUND_COMMAND_JOURNAL_STORAGE_KEY);
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to clear the admin refund journal');
  }
}

function text(value: unknown, minimum: number, maximum: number, field: string): string {
  if (typeof value !== 'string') return fail('INVALID_JOURNAL', `${field} is invalid`);
  const normalized = value.trim();
  if (Array.from(normalized).length < minimum || Array.from(normalized).length > maximum ||
    Array.from(normalized).some((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && (point <= 0x1f || point === 0x7f);
    })) return fail('INVALID_JOURNAL', `${field} is invalid`);
  return normalized;
}

function ulid(value: unknown, field: string): string {
  const current = text(value, 26, 26, field);
  if (!ulidPattern.test(current)) return fail('INVALID_JOURNAL', `${field} is invalid`);
  return current;
}

function confirmation(value: unknown): StoredConfirmation {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'preview_token', 'confirmation_hash', 'resource_etag', 'expires_at',
  ]) || typeof value.preview_token !== 'string' || value.preview_token.length < 1 ||
    value.preview_token.length > 512 || typeof value.confirmation_hash !== 'string' ||
    !hashPattern.test(value.confirmation_hash) || typeof value.resource_etag !== 'string' ||
    !etagPattern.test(value.resource_etag) || typeof value.expires_at !== 'string' ||
    !Number.isFinite(Date.parse(value.expires_at))) {
    return fail('INVALID_JOURNAL', 'Admin refund confirmation is invalid');
  }
  return {
    preview_token: value.preview_token,
    confirmation_hash: value.confirmation_hash,
    resource_etag: value.resource_etag,
    expires_at: value.expires_at,
  };
}

function cloneConfirmation(value: StoredConfirmation): StoredConfirmation {
  return { ...value };
}

function parseJournal(value: unknown): AdminRefundCommandJournal {
  if (!isPlainRecord(value)) return fail('INVALID_JOURNAL', 'Admin refund journal is invalid');
  const common = ['schema_version', 'account_fingerprint', 'created_at', 'idempotency_key',
    'request_salt', 'request_hash', 'mode', 'order_id', 'reason_present', 'confirmation'];
  const modeKeys = value.mode === 'MANUAL_COMPENSATION'
    ? [...common, 'order_item_id', 'amount']
    : [...common, 'refund_id'];
  if (!hasExactKeys(value, modeKeys) || value.schema_version !== ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION ||
    typeof value.account_fingerprint !== 'string' || !hashPattern.test(value.account_fingerprint) ||
    typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.idempotency_key !== 'string' || !uuidV4Pattern.test(value.idempotency_key) ||
    typeof value.request_salt !== 'string' || !/^[a-f0-9]{32}$/.test(value.request_salt) ||
    typeof value.request_hash !== 'string' || !hashPattern.test(value.request_hash) ||
    value.reason_present !== true) return fail('INVALID_JOURNAL', 'Admin refund journal shape is invalid');
  const shared = {
    schema_version: 1 as const,
    account_fingerprint: value.account_fingerprint,
    created_at: value.created_at,
    idempotency_key: value.idempotency_key,
    request_salt: value.request_salt,
    request_hash: value.request_hash,
    order_id: ulid(value.order_id, 'order_id'),
    reason_present: true as const,
    confirmation: confirmation(value.confirmation),
  };
  if (value.mode === 'MANUAL_COMPENSATION') {
    if (typeof value.amount !== 'string' || !moneyPattern.test(value.amount)) {
      return fail('INVALID_JOURNAL', 'Compensation amount is invalid');
    }
    return {
      ...shared,
      mode: 'MANUAL_COMPENSATION',
      order_item_id: ulid(value.order_item_id, 'order_item_id'),
      amount: value.amount,
    };
  }
  if (value.mode !== 'RETRY_REFUND') return fail('INVALID_JOURNAL', 'Admin refund mode is invalid');
  return { ...shared, mode: 'RETRY_REFUND', refund_id: ulid(value.refund_id, 'refund_id') };
}

function cloneJournal(journal: AdminRefundCommandJournal): AdminRefundCommandJournal {
  return { ...journal, confirmation: cloneConfirmation(journal.confirmation) };
}

function sameJournal(left: AdminRefundCommandJournal, right: AdminRefundCommandJournal): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseCollection(value: unknown): JournalCollection {
  if (value === null) return { schema_version: ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION, entries: [] };
  if (!isPlainRecord(value) || !hasExactKeys(value, ['schema_version', 'entries']) ||
    value.schema_version !== ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION || !Array.isArray(value.entries) ||
    value.entries.length > ADMIN_REFUND_COMMAND_JOURNAL_MAX_ENTRIES) {
    return fail('INVALID_JOURNAL', 'Admin refund journal collection is invalid');
  }
  const entries = value.entries.map(parseJournal);
  if (new Set(entries.map(({ account_fingerprint }) => account_fingerprint)).size !== entries.length ||
    new Set(entries.map(({ idempotency_key }) => idempotency_key)).size !== entries.length) {
    return fail('INVALID_JOURNAL', 'Admin refund journal collection contains duplicate entries');
  }
  return { schema_version: ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION, entries };
}

function loadCollection(now = Date.now()): JournalCollection {
  const collection = parseCollection(decoded(storedValue()));
  const entries = collection.entries.filter((journal) =>
    Date.parse(journal.created_at) + ADMIN_REFUND_COMMAND_JOURNAL_TTL_MS > now);
  if (entries.length !== collection.entries.length) {
    if (entries.length === 0) removeStoredValue();
    else setStoredValue({ schema_version: ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION, entries });
    for (const journal of collection.entries) {
      if (!entries.some(({ idempotency_key }) => idempotency_key === journal.idempotency_key)) {
        volatileExecutions.delete(journal.idempotency_key);
      }
    }
  }
  return { schema_version: ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION, entries: entries.map(cloneJournal) };
}

function storeEntries(entries: AdminRefundCommandJournal[]): void {
  if (entries.length === 0) removeStoredValue();
  else setStoredValue({ schema_version: ADMIN_REFUND_COMMAND_JOURNAL_SCHEMA_VERSION, entries: entries.map(cloneJournal) });
}

async function sha256Text(value: string): Promise<string> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    return fail('CRYPTO_UNAVAILABLE', 'Unable to bind the admin refund journal to this account');
  }
  const bytes = new TextEncoder().encode(value);
  const hashed = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...hashed].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function accountFingerprint(accountId: string): Promise<string> {
  if (!ulidPattern.test(accountId)) return fail('INVALID_JOURNAL', 'Administrator account ID is invalid');
  return sha256Text(`qingxu:admin-refund-command:account:v1:${accountId}`);
}

function requestSalt(): string {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    return fail('CRYPTO_UNAVAILABLE', 'Unable to protect the admin refund journal request');
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function currentAccountFingerprint(): Promise<string> {
  const session = authSession.state.session;
  if (session === null) return fail('SESSION_REQUIRED', 'An administrator session is required');
  return accountFingerprint(session.account_id);
}

function confirmationFromPreview(preview: HighRiskPreview): StoredConfirmation {
  return confirmation({
    preview_token: preview.preview_token,
    confirmation_hash: preview.confirmation_hash,
    resource_etag: preview.resource_etag,
    expires_at: preview.expires_at,
  });
}

function normalizedReason(value: string): string {
  return text(value, 2, 500, 'reason');
}

function executionFromDraft(draft: AdminRefundCommandDraft): VolatileExecution {
  const preview = previewFromAdminRefundCommand({ confirmation: confirmationFromPreview(draft.preview) });
  if (draft.mode === 'MANUAL_COMPENSATION') {
    const amount = draft.input.amount.trim();
    if (!moneyPattern.test(amount)) return fail('INVALID_JOURNAL', 'Compensation amount is invalid');
    return {
      mode: draft.mode,
      input: {
        amount,
        order_item_id: ulid(draft.input.order_item_id, 'order_item_id'),
        reason: normalizedReason(draft.input.reason),
      },
      preview,
    };
  }
  return { mode: draft.mode, input: { reason: normalizedReason(draft.input.reason) }, preview };
}

async function journalFromDraft(
  draft: AdminRefundCommandDraft,
  execution: VolatileExecution,
  account: string,
  now: number,
): Promise<AdminRefundCommandJournal> {
  const salt = requestSalt();
  const shared = {
    schema_version: 1 as const,
    account_fingerprint: account,
    created_at: new Date(now).toISOString(),
    idempotency_key: newIdempotencyKey(),
    request_salt: salt,
    request_hash: '',
    order_id: ulid(draft.order_id, 'order_id'),
    reason_present: true as const,
    confirmation: confirmationFromPreview(execution.preview),
  };
  let journal: AdminRefundCommandJournal;
  if (draft.mode === 'MANUAL_COMPENSATION' && execution.mode === 'MANUAL_COMPENSATION') {
    journal = {
      ...shared,
      mode: draft.mode,
      order_item_id: execution.input.order_item_id,
      amount: execution.input.amount,
    };
  } else {
    if (draft.mode !== 'RETRY_REFUND') return fail('INVALID_JOURNAL', 'Admin refund draft is invalid');
    journal = { ...shared, mode: draft.mode, refund_id: ulid(draft.refund_id, 'refund_id') };
  }
  return { ...journal, request_hash: await executionRequestHash(journal, execution) };
}

function sameDraft(
  journal: AdminRefundCommandJournal,
  draft: AdminRefundCommandDraft,
  execution: VolatileExecution,
): boolean {
  if (journal.mode !== draft.mode || journal.order_id !== draft.order_id ||
    JSON.stringify(journal.confirmation) !== JSON.stringify(confirmationFromPreview(execution.preview))) return false;
  if (journal.mode === 'MANUAL_COMPENSATION' && execution.mode === 'MANUAL_COMPENSATION') {
    return journal.order_item_id === execution.input.order_item_id && journal.amount === execution.input.amount;
  }
  return journal.mode === 'RETRY_REFUND' && draft.mode === 'RETRY_REFUND' &&
    execution.mode === 'RETRY_REFUND' && journal.refund_id === draft.refund_id;
}

function canonicalExecutionRequest(
  journal: AdminRefundCommandJournal,
  execution: VolatileExecution,
): string {
  const target = journal.mode === 'MANUAL_COMPENSATION'
    ? { order_id: journal.order_id, order_item_id: journal.order_item_id }
    : { order_id: journal.order_id, refund_id: journal.refund_id };
  return JSON.stringify({
    mode: journal.mode,
    target,
    body: {
      ...execution.input,
      confirmation_hash: journal.confirmation.confirmation_hash,
      preview_token: journal.confirmation.preview_token,
    },
    if_match: journal.confirmation.resource_etag,
  });
}

function executionRequestHash(
  journal: AdminRefundCommandJournal,
  execution: VolatileExecution,
): Promise<string> {
  return sha256Text(`${journal.request_salt}:${canonicalExecutionRequest(journal, execution)}`);
}

export async function recoverAdminRefundCommandJournal(
  now = Date.now(),
): Promise<AdminRefundCommandJournal | null> {
  const fingerprint = await currentAccountFingerprint();
  return loadCollection(now).entries.find(({ account_fingerprint }) =>
    account_fingerprint === fingerprint) ?? null;
}

export async function prepareAdminRefundCommandJournal(
  draft: AdminRefundCommandDraft,
  now = Date.now(),
): Promise<AdminRefundCommandJournal> {
  const fingerprint = await currentAccountFingerprint();
  const execution = executionFromDraft(draft);
  const collection = loadCollection(now);
  const existing = collection.entries.find(({ account_fingerprint }) =>
    account_fingerprint === fingerprint);
  if (existing !== undefined) {
    if (!sameDraft(existing, draft, execution)) {
      return fail('PENDING_COMMAND', 'Another refund command is awaiting resolution');
    }
    if (await executionRequestHash(existing, execution) !== existing.request_hash) {
      return fail('REQUEST_MISMATCH', 'The pending refund reason changed before execution');
    }
    volatileExecutions.set(existing.idempotency_key, execution);
    return cloneJournal(existing);
  }
  if (collection.entries.length >= ADMIN_REFUND_COMMAND_JOURNAL_MAX_ENTRIES) {
    return fail('JOURNAL_LIMIT', 'Too many refund commands are awaiting resolution in this browser');
  }
  const candidate = await journalFromDraft(draft, execution, fingerprint, now);
  storeEntries([...collection.entries, candidate]);
  volatileExecutions.set(candidate.idempotency_key, execution);
  return cloneJournal(candidate);
}

export function previewFromAdminRefundCommand(
  value: Pick<AdminRefundCommandJournal, 'confirmation'>,
): HighRiskPreview {
  return {
    ...cloneConfirmation(value.confirmation),
    impact: { affected_count: 0, metrics: [], warnings: [] },
  };
}

export function recoverVolatileAdminRefundCommand(
  journal: AdminRefundCommandJournal,
): VolatileExecution | null {
  const execution = volatileExecutions.get(journal.idempotency_key);
  if (execution === undefined) return null;
  return {
    ...execution,
    input: { ...execution.input },
    preview: {
      ...execution.preview,
      impact: {
        ...execution.preview.impact,
        metrics: execution.preview.impact.metrics.map((metric) => ({ ...metric })),
        warnings: [...execution.preview.impact.warnings],
      },
    },
  } as VolatileExecution;
}

async function materializeExecution(
  journal: AdminRefundCommandJournal,
  reason?: string,
): Promise<VolatileExecution> {
  const volatile = recoverVolatileAdminRefundCommand(journal);
  if (reason === undefined && volatile !== null) return volatile;
  if (reason === undefined) return fail('REQUEST_MISMATCH', 'The original refund reason must be re-entered');
  const normalized = normalizedReason(reason);
  const preview = previewFromAdminRefundCommand(journal);
  const execution: VolatileExecution = journal.mode === 'MANUAL_COMPENSATION'
    ? {
        mode: journal.mode,
        input: { amount: journal.amount, order_item_id: journal.order_item_id, reason: normalized },
        preview,
      }
    : { mode: journal.mode, input: { reason: normalized }, preview };
  if (await executionRequestHash(journal, execution) !== journal.request_hash) {
    return fail('REQUEST_MISMATCH', 'The refund reason does not match the pending command');
  }
  volatileExecutions.set(journal.idempotency_key, execution);
  return execution;
}

export function clearAdminRefundCommandJournal(expected: AdminRefundCommandJournal): void {
  const collection = loadCollection();
  const current = collection.entries.find(({ account_fingerprint }) =>
    account_fingerprint === expected.account_fingerprint);
  if (current === undefined || !sameJournal(current, expected)) return;
  storeEntries(collection.entries.filter(({ account_fingerprint }) =>
    account_fingerprint !== expected.account_fingerprint));
  volatileExecutions.delete(expected.idempotency_key);
}

export function isCertainAdminRefundCommandFailure(error: unknown): boolean {
  return error instanceof AdminApiError && error.code !== 'SESSION_CHANGED' && error.code !== 'STATE_CONFLICT' &&
    [400, 403, 404, 409, 422].includes(error.status);
}

export async function executeAdminRefundCommandJournal(
  candidate: AdminRefundCommandJournal,
  reason?: string,
): Promise<ManualCompensationResult | RefundRetryResult> {
  const fingerprint = await currentAccountFingerprint();
  if (candidate.account_fingerprint !== fingerprint) {
    return fail('ACCOUNT_MISMATCH', 'Pending refund command belongs to another administrator account');
  }
  const stored = loadCollection().entries.find(({ account_fingerprint }) =>
    account_fingerprint === fingerprint);
  if (stored === undefined || !sameJournal(stored, candidate)) {
    return fail('PENDING_COMMAND', 'Stored refund command changed before execution');
  }
  const execution = await materializeExecution(stored, reason);
  try {
    const result = execution.mode === 'MANUAL_COMPENSATION' && stored.mode === 'MANUAL_COMPENSATION'
      ? await confirmAdminManualCompensation(
          stored.order_id, execution.input, execution.preview, stored.idempotency_key,
        )
      : execution.mode === 'RETRY_REFUND' && stored.mode === 'RETRY_REFUND'
        ? await confirmAdminRefundRetry(
            stored.refund_id, execution.input, execution.preview, stored.idempotency_key,
          )
        : fail('INVALID_JOURNAL', 'Stored refund command mode changed before execution');
    clearAdminRefundCommandJournal(stored);
    return result;
  } catch (error) {
    if (isCertainAdminRefundCommandFailure(error)) clearAdminRefundCommandJournal(stored);
    throw error;
  }
}
