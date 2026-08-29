import { createIdempotencyKey } from '../api/store-identity';
import { createStoreOrder } from '../api/store-orders';
import { StoreApiError } from '../api/store-client';
import type { OrderSubmitInput, StoreOrder } from '../types/store-orders';

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
};

type PlainRecord = Record<string, unknown>;

export const ORDER_SUBMIT_JOURNAL_STORAGE_KEY = 'qingxu:order-submit:v1';
export const ORDER_SUBMIT_JOURNAL_SCHEMA_VERSION = 1;
export const ORDER_SUBMIT_JOURNAL_TTL_MS = 24 * 60 * 60 * 1_000;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hashPattern = /^[a-f0-9]{64}$/;

export type OrderSubmitJournalErrorCode =
  | 'CUSTOMER_MISMATCH'
  | 'INVALID_CUSTOMER_ID'
  | 'INVALID_JOURNAL'
  | 'PENDING_COMMAND'
  | 'STORAGE_UNAVAILABLE';

export class OrderSubmitJournalError extends Error {
  readonly code: OrderSubmitJournalErrorCode;

  constructor(code: OrderSubmitJournalErrorCode, message: string) {
    super(message);
    this.name = 'OrderSubmitJournalError';
    this.code = code;
  }
}

export interface OrderSubmitJournal {
  readonly schema_version: 1;
  readonly customer_id: string;
  readonly created_at: string;
  readonly idempotency_key: string;
  readonly request: OrderSubmitInput;
}

function fail(code: OrderSubmitJournalErrorCode, message: string): never {
  throw new OrderSubmitJournalError(code, message);
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
      return sessionStorage.getItem(ORDER_SUBMIT_JOURNAL_STORAGE_KEY);
    }
    return uni.getStorageSync(ORDER_SUBMIT_JOURNAL_STORAGE_KEY) as unknown;
  } catch {
    return fail('STORAGE_UNAVAILABLE', 'Unable to read the order submit journal');
  }
}

function setStoredValue(value: OrderSubmitJournal): void {
  try {
    if (process.env.UNI_PLATFORM !== 'mp-weixin' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(ORDER_SUBMIT_JOURNAL_STORAGE_KEY, JSON.stringify(value));
      return;
    }
    uni.setStorageSync(ORDER_SUBMIT_JOURNAL_STORAGE_KEY, value);
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to persist the order submit journal');
  }
}

function removeStoredValue(): void {
  try {
    if (process.env.UNI_PLATFORM !== 'mp-weixin' && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(ORDER_SUBMIT_JOURNAL_STORAGE_KEY);
      return;
    }
    uni.removeStorageSync(ORDER_SUBMIT_JOURNAL_STORAGE_KEY);
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to clear the order submit journal');
  }
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail('INVALID_JOURNAL', 'Stored order journal is not valid JSON');
  }
}

function parseLine(value: unknown): { quantity: number; sku_id: string } {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['sku_id', 'quantity']) ||
    typeof value.sku_id !== 'string' || !ulidPattern.test(value.sku_id) ||
    !Number.isInteger(value.quantity) || Number(value.quantity) < 1 || Number(value.quantity) > 99) {
    return fail('INVALID_JOURNAL', 'Order journal line is invalid');
  }
  return { sku_id: value.sku_id, quantity: Number(value.quantity) };
}

function parseRequest(value: unknown): OrderSubmitInput {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'source', 'address_id', 'items', 'quote_id', 'quote_token', 'confirmation_hash',
  ]) || (value.source !== 'CART' && value.source !== 'BUY_NOW') ||
    typeof value.address_id !== 'string' || !ulidPattern.test(value.address_id) ||
    typeof value.quote_id !== 'string' || !ulidPattern.test(value.quote_id) ||
    typeof value.quote_token !== 'string' || value.quote_token.length < 32 || value.quote_token.length > 512 ||
    typeof value.confirmation_hash !== 'string' || !hashPattern.test(value.confirmation_hash) ||
    !Array.isArray(value.items) || value.items.length < 1 || value.items.length > 100) {
    return fail('INVALID_JOURNAL', 'Order journal request is invalid');
  }
  const items = value.items.map(parseLine);
  if (new Set(items.map(({ sku_id }) => sku_id)).size !== items.length ||
    (value.source === 'BUY_NOW' && items.length !== 1)) {
    return fail('INVALID_JOURNAL', 'Order journal item set is invalid');
  }
  return {
    source: value.source,
    address_id: value.address_id,
    items,
    quote_id: value.quote_id,
    quote_token: value.quote_token,
    confirmation_hash: value.confirmation_hash,
  } as OrderSubmitInput;
}

function cloneRequest(request: OrderSubmitInput): OrderSubmitInput {
  return { ...request, items: request.items.map((item) => ({ ...item })) };
}

function cloneJournal(journal: OrderSubmitJournal): OrderSubmitJournal {
  return { ...journal, request: cloneRequest(journal.request) };
}

function sameRequest(left: OrderSubmitInput, right: OrderSubmitInput): boolean {
  return left.source === right.source && left.address_id === right.address_id &&
    left.quote_id === right.quote_id && left.quote_token === right.quote_token &&
    left.confirmation_hash === right.confirmation_hash && left.items.length === right.items.length &&
    left.items.every((item, index) => item.sku_id === right.items[index]?.sku_id &&
      item.quantity === right.items[index]?.quantity);
}

function sameJournal(left: OrderSubmitJournal, right: OrderSubmitJournal): boolean {
  return left.schema_version === right.schema_version && left.customer_id === right.customer_id &&
    left.created_at === right.created_at && left.idempotency_key === right.idempotency_key &&
    sameRequest(left.request, right.request);
}

function requireCustomerId(customerId: string): void {
  if (!ulidPattern.test(customerId)) fail('INVALID_CUSTOMER_ID', 'Customer ID must be a ULID');
}

export function parseOrderSubmitJournal(value: unknown): OrderSubmitJournal | null {
  if (isMissing(value)) return null;
  const current = decoded(value);
  if (!isPlainRecord(current) || !hasExactKeys(current, [
    'schema_version', 'customer_id', 'created_at', 'idempotency_key', 'request',
  ]) || current.schema_version !== ORDER_SUBMIT_JOURNAL_SCHEMA_VERSION ||
    typeof current.customer_id !== 'string' || !ulidPattern.test(current.customer_id) ||
    typeof current.created_at !== 'string' || !Number.isFinite(Date.parse(current.created_at)) ||
    typeof current.idempotency_key !== 'string' || !uuidV4Pattern.test(current.idempotency_key)) {
    return fail('INVALID_JOURNAL', 'Order submit journal shape is invalid');
  }
  return {
    schema_version: ORDER_SUBMIT_JOURNAL_SCHEMA_VERSION,
    customer_id: current.customer_id,
    created_at: current.created_at,
    idempotency_key: current.idempotency_key,
    request: parseRequest(current.request),
  };
}

export function loadOrderSubmitJournal(
  now = Date.now(),
): OrderSubmitJournal | null {
  const journal = parseOrderSubmitJournal(storedValue());
  if (journal === null) return null;
  if (Date.parse(journal.created_at) + ORDER_SUBMIT_JOURNAL_TTL_MS <= now) {
    removeStoredValue();
    return null;
  }
  return cloneJournal(journal);
}

export function prepareOrderSubmitJournal(
  customerId: string,
  request: OrderSubmitInput,
  now = Date.now(),
): OrderSubmitJournal {
  requireCustomerId(customerId);
  const normalizedRequest = parseRequest(request);
  const existing = loadOrderSubmitJournal(now);
  if (existing !== null) {
    if (existing.customer_id !== customerId) {
      removeStoredValue();
      return fail('CUSTOMER_MISMATCH', 'Pending order belongs to another customer');
    }
    if (!sameRequest(existing.request, normalizedRequest)) {
      return fail('PENDING_COMMAND', 'Another order submission is awaiting resolution');
    }
    return existing;
  }
  const journal: OrderSubmitJournal = {
    schema_version: ORDER_SUBMIT_JOURNAL_SCHEMA_VERSION,
    customer_id: customerId,
    created_at: new Date(now).toISOString(),
    idempotency_key: createIdempotencyKey(),
    request: cloneRequest(normalizedRequest),
  };
  setStoredValue(journal);
  return cloneJournal(journal);
}

export function clearOrderSubmitJournal(expected?: OrderSubmitJournal): void {
  if (expected !== undefined) {
    const current = loadOrderSubmitJournal();
    if (current === null || !sameJournal(current, expected)) return;
  }
  removeStoredValue();
}

export function isCertainOrderSubmitFailure(error: unknown): boolean {
  return error instanceof StoreApiError && [400, 401, 403, 404, 409, 422].includes(error.status);
}

export async function executeOrderSubmitJournal(
  customerId: string,
  candidate?: OrderSubmitJournal,
): Promise<StoreOrder> {
  requireCustomerId(customerId);
  const journal = candidate === undefined ? loadOrderSubmitJournal() : cloneJournal(candidate);
  if (journal === null) return fail('INVALID_JOURNAL', 'No pending order submission exists');
  if (journal.customer_id !== customerId) {
    removeStoredValue();
    return fail('CUSTOMER_MISMATCH', 'Pending order belongs to another customer');
  }
  const stored = loadOrderSubmitJournal();
  if (stored === null || !sameJournal(stored, journal)) {
    return fail('PENDING_COMMAND', 'Stored order submission changed before execution');
  }
  try {
    const order = await createStoreOrder(journal.request, journal.idempotency_key);
    clearOrderSubmitJournal(journal);
    return order;
  } catch (error) {
    if (isCertainOrderSubmitFailure(error)) clearOrderSubmitJournal(journal);
    throw error;
  }
}
