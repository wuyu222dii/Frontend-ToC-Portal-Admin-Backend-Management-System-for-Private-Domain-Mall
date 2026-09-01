import {
  confirmStoreAftersale,
  normalizeStoreAftersaleConfirmInput,
} from '../api/store-aftersales';
import { StoreApiError } from '../api/store-client';
import { sha256HexBytes } from '../api/store-files';
import { createIdempotencyKey, getCustomerProfile } from '../api/store-identity';
import type { StoreAftersale, StoreAftersaleConfirmInput } from '../types/store-aftersales';

declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

type PlainRecord = Record<string, unknown>;
type ReasonCode = StoreAftersaleConfirmInput['reason_code'];

export const AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY = 'qingxu:aftersale-confirms:v1';
export const AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION = 1;
export const AFTERSALE_CONFIRM_JOURNAL_TTL_MS = 24 * 60 * 60 * 1_000;
export const AFTERSALE_CONFIRM_JOURNAL_MAX_ENTRIES = 4;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;
const aftersaleTypes = new Set(['REFUND_ONLY', 'RETURN_REFUND']);
const reasonCodes = new Set([
  'UNSHIPPED_NO_LONGER_NEEDED', 'ITEM_DAMAGED', 'ITEM_NOT_AS_DESCRIBED', 'WRONG_ITEM',
  'MISSING_ITEM', 'QUALITY_ISSUE', 'OTHER',
]);

export type AftersaleConfirmJournalErrorCode =
  | 'CUSTOMER_MISMATCH'
  | 'INVALID_JOURNAL'
  | 'JOURNAL_LIMIT'
  | 'PENDING_COMMAND'
  | 'REQUEST_MISMATCH'
  | 'STORAGE_UNAVAILABLE';

export class AftersaleConfirmJournalError extends Error {
  readonly code: AftersaleConfirmJournalErrorCode;

  constructor(code: AftersaleConfirmJournalErrorCode, message: string) {
    super(message);
    this.name = 'AftersaleConfirmJournalError';
    this.code = code;
  }
}

export interface AftersaleConfirmJournalCommand {
  readonly action: 'CONFIRM';
  readonly order_id: string;
  readonly type: StoreAftersaleConfirmInput['type'];
  readonly reason_code: ReasonCode;
  readonly reason_text_present: boolean;
  readonly items: Array<{ order_item_id: string; quantity: number }>;
  readonly evidence_file_ids: string[];
  readonly preview_token: string;
  readonly confirmation_hash: string;
}

export interface AftersaleConfirmJournal {
  readonly schema_version: 1;
  readonly customer_fingerprint: string;
  readonly created_at: string;
  readonly idempotency_key: string;
  readonly command_hash: string;
  readonly request_salt: string;
  readonly request_hash: string;
  readonly command: AftersaleConfirmJournalCommand;
}

interface AftersaleConfirmJournalCollection {
  readonly schema_version: 1;
  readonly entries: AftersaleConfirmJournal[];
}

const volatileRequests = new Map<string, StoreAftersaleConfirmInput>();

function fail(code: AftersaleConfirmJournalErrorCode, message: string): never {
  throw new AftersaleConfirmJournalError(code, message);
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

function storedValue(): unknown {
  try {
    if (process.env.UNI_PLATFORM !== 'mp-weixin' && typeof sessionStorage !== 'undefined') {
      return sessionStorage.getItem(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY);
    }
    return uni.getStorageSync(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY) as unknown;
  } catch {
    return fail('STORAGE_UNAVAILABLE', 'Unable to read the aftersale confirm journal');
  }
}

function setStoredValue(value: AftersaleConfirmJournalCollection): void {
  try {
    if (process.env.UNI_PLATFORM !== 'mp-weixin' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY, JSON.stringify(value));
      return;
    }
    uni.setStorageSync(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY, value);
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to persist the aftersale confirm journal');
  }
}

function removeStoredValue(): void {
  try {
    if (process.env.UNI_PLATFORM !== 'mp-weixin' && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY);
      return;
    }
    uni.removeStorageSync(AFTERSALE_CONFIRM_JOURNAL_STORAGE_KEY);
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to clear the aftersale confirm journal');
  }
}

function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail('INVALID_JOURNAL', 'Stored aftersale journal is not valid JSON');
  }
}

function utf8Bytes(value: string): Uint8Array {
  const bytes: number[] = [];
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x7f) bytes.push(codePoint);
    else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >>> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >>> 12), 0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
    } else {
      bytes.push(
        0xf0 | (codePoint >>> 18), 0x80 | ((codePoint >>> 12) & 0x3f),
        0x80 | ((codePoint >>> 6) & 0x3f), 0x80 | (codePoint & 0x3f),
      );
    }
  }
  return new Uint8Array(bytes);
}

function digest(value: string): string {
  return sha256HexBytes(utf8Bytes(value));
}

export function aftersaleConfirmCustomerFingerprint(customerId: string): string {
  if (!ulidPattern.test(customerId)) return fail('INVALID_JOURNAL', 'Customer ID is invalid');
  return digest(`qingxu:aftersale-confirm:customer:v1:${customerId}`);
}

function cloneRequest(request: StoreAftersaleConfirmInput): StoreAftersaleConfirmInput {
  return {
    ...request,
    items: request.items.map((item) => ({ ...item })),
    ...(request.evidence_file_ids === undefined ? {} : { evidence_file_ids: [...request.evidence_file_ids] }),
  };
}

function commandFromRequest(request: StoreAftersaleConfirmInput): AftersaleConfirmJournalCommand {
  return {
    action: 'CONFIRM',
    order_id: request.order_id,
    type: request.type,
    reason_code: request.reason_code,
    reason_text_present: typeof request.reason_text === 'string',
    items: request.items.map((item) => ({ ...item })),
    evidence_file_ids: [...(request.evidence_file_ids ?? [])],
    preview_token: request.preview_token,
    confirmation_hash: request.confirmation_hash,
  };
}

function commandHash(command: AftersaleConfirmJournalCommand): string {
  return digest(JSON.stringify(command));
}

function requestSalt(): string {
  const salt = createIdempotencyKey().replaceAll('-', '');
  if (!/^[a-f0-9]{32}$/i.test(salt)) return fail('INVALID_JOURNAL', 'Aftersale request salt is invalid');
  return salt.toLowerCase();
}

function requestHash(request: StoreAftersaleConfirmInput, salt: string): string {
  return digest(`${salt}:${JSON.stringify(request)}`);
}

function cloneCommand(command: AftersaleConfirmJournalCommand): AftersaleConfirmJournalCommand {
  return { ...command, items: command.items.map((item) => ({ ...item })), evidence_file_ids: [...command.evidence_file_ids] };
}

function cloneJournal(journal: AftersaleConfirmJournal): AftersaleConfirmJournal {
  return { ...journal, command: cloneCommand(journal.command) };
}

function sameJournal(left: AftersaleConfirmJournal, right: AftersaleConfirmJournal): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function parseCommand(value: unknown): AftersaleConfirmJournalCommand {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'action', 'order_id', 'type', 'reason_code', 'reason_text_present', 'items',
    'evidence_file_ids', 'preview_token', 'confirmation_hash',
  ]) || value.action !== 'CONFIRM' || typeof value.order_id !== 'string' ||
    !ulidPattern.test(value.order_id) || typeof value.type !== 'string' || !aftersaleTypes.has(value.type) ||
    typeof value.reason_code !== 'string' || !reasonCodes.has(value.reason_code) ||
    typeof value.reason_text_present !== 'boolean' || !Array.isArray(value.items) ||
    !Array.isArray(value.evidence_file_ids) || typeof value.preview_token !== 'string' ||
    typeof value.confirmation_hash !== 'string') {
    return fail('INVALID_JOURNAL', 'Aftersale journal command shape is invalid');
  }
  try {
    const normalized = normalizeStoreAftersaleConfirmInput({
      action: 'CONFIRM', order_id: value.order_id, type: value.type, reason_code: value.reason_code,
      ...(value.reason_text_present ? { reason_text: '恢复校验' } : {}),
      items: value.items, evidence_file_ids: value.evidence_file_ids,
      preview_token: value.preview_token, confirmation_hash: value.confirmation_hash,
    });
    return { ...commandFromRequest(normalized), reason_text_present: value.reason_text_present };
  } catch {
    return fail('INVALID_JOURNAL', 'Aftersale journal command facts are invalid');
  }
}

export function parseAftersaleConfirmJournal(value: unknown): AftersaleConfirmJournal {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'schema_version', 'customer_fingerprint', 'created_at', 'idempotency_key', 'command_hash',
    'request_salt', 'request_hash', 'command',
  ]) || value.schema_version !== AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION ||
    typeof value.customer_fingerprint !== 'string' || !hashPattern.test(value.customer_fingerprint) ||
    typeof value.created_at !== 'string' || !Number.isFinite(Date.parse(value.created_at)) ||
    typeof value.idempotency_key !== 'string' || !uuidV4Pattern.test(value.idempotency_key) ||
    typeof value.command_hash !== 'string' || !hashPattern.test(value.command_hash) ||
    typeof value.request_salt !== 'string' || !/^[a-f0-9]{32}$/.test(value.request_salt) ||
    typeof value.request_hash !== 'string' || !hashPattern.test(value.request_hash)) {
    return fail('INVALID_JOURNAL', 'Aftersale confirm journal shape is invalid');
  }
  const journal: AftersaleConfirmJournal = {
    schema_version: AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION,
    customer_fingerprint: value.customer_fingerprint,
    created_at: value.created_at,
    idempotency_key: value.idempotency_key,
    command_hash: value.command_hash,
    request_salt: value.request_salt,
    request_hash: value.request_hash,
    command: parseCommand(value.command),
  };
  if (commandHash(journal.command) !== journal.command_hash) {
    return fail('INVALID_JOURNAL', 'Aftersale journal command integrity check failed');
  }
  return journal;
}

function parseCollection(value: unknown): AftersaleConfirmJournalCollection {
  if (value === undefined || value === null || value === '') {
    return { schema_version: AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION, entries: [] };
  }
  const current = decoded(value);
  if (!isPlainRecord(current) || !hasExactKeys(current, ['schema_version', 'entries']) ||
    current.schema_version !== AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION || !Array.isArray(current.entries) ||
    current.entries.length > AFTERSALE_CONFIRM_JOURNAL_MAX_ENTRIES) {
    return fail('INVALID_JOURNAL', 'Aftersale journal collection is invalid');
  }
  const entries = current.entries.map(parseAftersaleConfirmJournal);
  if (new Set(entries.map(({ customer_fingerprint }) => customer_fingerprint)).size !== entries.length ||
    new Set(entries.map(({ idempotency_key }) => idempotency_key)).size !== entries.length) {
    return fail('INVALID_JOURNAL', 'Aftersale journal collection contains duplicate entries');
  }
  return { schema_version: AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION, entries };
}

function loadCollection(now = Date.now()): AftersaleConfirmJournalCollection {
  const collection = parseCollection(storedValue());
  const entries = collection.entries.filter((journal) =>
    Date.parse(journal.created_at) + AFTERSALE_CONFIRM_JOURNAL_TTL_MS > now);
  if (entries.length !== collection.entries.length) {
    if (entries.length === 0) removeStoredValue();
    else setStoredValue({ schema_version: AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION, entries });
    for (const journal of collection.entries) {
      if (!entries.some(({ idempotency_key }) => idempotency_key === journal.idempotency_key)) {
        volatileRequests.delete(journal.idempotency_key);
      }
    }
  }
  return { schema_version: AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION, entries: entries.map(cloneJournal) };
}

function storeEntries(entries: AftersaleConfirmJournal[]): void {
  if (entries.length === 0) removeStoredValue();
  else setStoredValue({ schema_version: AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION, entries: entries.map(cloneJournal) });
}

function journalForFingerprint(customerFingerprint: string, now = Date.now()): AftersaleConfirmJournal | null {
  return loadCollection(now).entries.find(({ customer_fingerprint }) =>
    customer_fingerprint === customerFingerprint) ?? null;
}

async function currentCustomerFingerprint(): Promise<string> {
  return aftersaleConfirmCustomerFingerprint((await getCustomerProfile()).customer_id);
}

export async function recoverAftersaleConfirmJournal(now = Date.now()): Promise<AftersaleConfirmJournal | null> {
  return journalForFingerprint(await currentCustomerFingerprint(), now);
}

export async function prepareAftersaleConfirmJournal(
  request: StoreAftersaleConfirmInput,
  now = Date.now(),
): Promise<AftersaleConfirmJournal> {
  const normalized = normalizeStoreAftersaleConfirmInput(request);
  const command = commandFromRequest(normalized);
  const normalizedCommandHash = commandHash(command);
  const customerFingerprint = await currentCustomerFingerprint();
  const collection = loadCollection(now);
  const existing = collection.entries.find(({ customer_fingerprint }) =>
    customer_fingerprint === customerFingerprint);
  if (existing !== undefined) {
    if (existing.command_hash !== normalizedCommandHash ||
      existing.request_hash !== requestHash(normalized, existing.request_salt)) {
      return fail('PENDING_COMMAND', 'Another aftersale command is awaiting resolution');
    }
    volatileRequests.set(existing.idempotency_key, cloneRequest(normalized));
    return cloneJournal(existing);
  }
  if (collection.entries.length >= AFTERSALE_CONFIRM_JOURNAL_MAX_ENTRIES) {
    return fail('JOURNAL_LIMIT', 'Too many aftersale commands are awaiting resolution on this device');
  }
  const salt = requestSalt();
  const journal: AftersaleConfirmJournal = {
    schema_version: AFTERSALE_CONFIRM_JOURNAL_SCHEMA_VERSION,
    customer_fingerprint: customerFingerprint,
    created_at: new Date(now).toISOString(),
    idempotency_key: createIdempotencyKey(),
    command_hash: normalizedCommandHash,
    request_salt: salt,
    request_hash: requestHash(normalized, salt),
    command,
  };
  storeEntries([...collection.entries, journal]);
  volatileRequests.set(journal.idempotency_key, cloneRequest(normalized));
  return cloneJournal(journal);
}

export function recoverVolatileAftersaleConfirmRequest(
  journal: AftersaleConfirmJournal,
): StoreAftersaleConfirmInput | null {
  const request = volatileRequests.get(journal.idempotency_key);
  return request === undefined ? null : cloneRequest(request);
}

function materializeRequest(journal: AftersaleConfirmJournal, reasonText?: string): StoreAftersaleConfirmInput {
  const volatile = recoverVolatileAftersaleConfirmRequest(journal);
  if (volatile !== null && reasonText === undefined) return volatile;
  if (journal.command.reason_text_present && reasonText === undefined) {
    return fail('REQUEST_MISMATCH', 'The original aftersale reason must be re-entered');
  }
  try {
    const request = normalizeStoreAftersaleConfirmInput({
      action: 'CONFIRM', order_id: journal.command.order_id, type: journal.command.type,
      reason_code: journal.command.reason_code,
      ...(journal.command.reason_text_present ? { reason_text: reasonText } : {}),
      items: journal.command.items, evidence_file_ids: journal.command.evidence_file_ids,
      preview_token: journal.command.preview_token, confirmation_hash: journal.command.confirmation_hash,
    });
    if (commandHash(commandFromRequest(request)) !== journal.command_hash ||
      requestHash(request, journal.request_salt) !== journal.request_hash) {
      return fail('REQUEST_MISMATCH', 'Recovered aftersale command facts do not match the journal');
    }
    volatileRequests.set(journal.idempotency_key, cloneRequest(request));
    return request;
  } catch (error) {
    if (error instanceof AftersaleConfirmJournalError) throw error;
    return fail('REQUEST_MISMATCH', 'The recovered aftersale request is invalid');
  }
}

function clearJournal(expected: AftersaleConfirmJournal): void {
  const collection = loadCollection();
  const current = collection.entries.find(({ customer_fingerprint }) =>
    customer_fingerprint === expected.customer_fingerprint);
  if (current === undefined || !sameJournal(current, expected)) return;
  storeEntries(collection.entries.filter(({ customer_fingerprint }) =>
    customer_fingerprint !== expected.customer_fingerprint));
  volatileRequests.delete(expected.idempotency_key);
}

export function clearAftersaleConfirmJournalForCustomer(customerId: string): void {
  const customerFingerprint = aftersaleConfirmCustomerFingerprint(customerId);
  const collection = loadCollection();
  const current = collection.entries.find(({ customer_fingerprint }) =>
    customer_fingerprint === customerFingerprint);
  if (current === undefined) return;
  storeEntries(collection.entries.filter(({ customer_fingerprint }) =>
    customer_fingerprint !== customerFingerprint));
  volatileRequests.delete(current.idempotency_key);
}

export function isCertainAftersaleConfirmFailure(error: unknown): boolean {
  return error instanceof StoreApiError && error.code !== 'SESSION_CHANGED' && error.code !== 'STATE_CONFLICT' &&
    [400, 403, 404, 409, 422].includes(error.status);
}

export async function executeAftersaleConfirmJournal(
  candidate: AftersaleConfirmJournal,
  reasonText?: string,
): Promise<StoreAftersale> {
  const customerFingerprint = await currentCustomerFingerprint();
  if (candidate.customer_fingerprint !== customerFingerprint) {
    return fail('CUSTOMER_MISMATCH', 'Pending aftersale command belongs to another customer');
  }
  const stored = journalForFingerprint(customerFingerprint);
  if (stored === null || !sameJournal(stored, candidate)) {
    return fail('PENDING_COMMAND', 'Stored aftersale command changed before execution');
  }
  const request = materializeRequest(stored, reasonText);
  try {
    const result = await confirmStoreAftersale(request, stored.idempotency_key);
    clearJournal(stored);
    return result;
  } catch (error) {
    if (isCertainAftersaleConfirmFailure(error)) clearJournal(stored);
    throw error;
  }
}
