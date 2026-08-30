/* global uni */
import { createIdempotencyKey } from '../api/store-identity';
import { createStorePaymentIntent } from '../api/store-payments';
import { StoreApiError } from '../api/store-client';
import type { PaymentIntent } from '../types/store-payments';

declare const process: {
  readonly env: Readonly<Record<string, string | undefined>>;
};

type PlainRecord = Record<string, unknown>;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY = 'qingxu:payment-submit:v1';

export type PaymentSubmitJournalErrorCode =
  | 'INVALID_JOURNAL'
  | 'PENDING_COMMAND'
  | 'STORAGE_UNAVAILABLE';

export class PaymentSubmitJournalError extends Error {
  readonly code: PaymentSubmitJournalErrorCode;

  constructor(code: PaymentSubmitJournalErrorCode, message: string) {
    super(message);
    this.name = 'PaymentSubmitJournalError';
    this.code = code;
  }
}

export interface PaymentSubmitJournal {
  readonly order_id: string;
  readonly order_version: number;
  readonly idempotency_key: string;
}

function fail(code: PaymentSubmitJournalErrorCode, message: string): never {
  throw new PaymentSubmitJournalError(code, message);
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
      return sessionStorage.getItem(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY);
    }
    return uni.getStorageSync(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY) as unknown;
  } catch {
    return fail('STORAGE_UNAVAILABLE', 'Unable to read the payment submit journal');
  }
}

function setStoredValue(value: PaymentSubmitJournal): void {
  try {
    if (process.env.UNI_PLATFORM !== 'mp-weixin' && typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY, JSON.stringify(value));
      return;
    }
    uni.setStorageSync(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY, value);
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to persist the payment submit journal');
  }
}

function removeStoredValue(): void {
  try {
    if (process.env.UNI_PLATFORM !== 'mp-weixin' && typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY);
      return;
    }
    uni.removeStorageSync(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY);
  } catch {
    fail('STORAGE_UNAVAILABLE', 'Unable to clear the payment submit journal');
  }
}

function decoded(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fail('INVALID_JOURNAL', 'Stored payment journal is not valid JSON');
  }
}

function requireOrder(orderId: string, orderVersion: number): void {
  if (!ulidPattern.test(orderId) || !Number.isInteger(orderVersion) || orderVersion < 1) {
    fail('INVALID_JOURNAL', 'Payment command order facts are invalid');
  }
}

function sameJournal(left: PaymentSubmitJournal, right: PaymentSubmitJournal): boolean {
  return left.order_id === right.order_id && left.order_version === right.order_version &&
    left.idempotency_key === right.idempotency_key;
}

export function parsePaymentSubmitJournal(value: unknown): PaymentSubmitJournal | null {
  if (value === undefined || value === null || value === '') return null;
  const current = decoded(value);
  if (!isPlainRecord(current) || !hasExactKeys(current, [
    'order_id', 'order_version', 'idempotency_key',
  ]) || typeof current.order_id !== 'string' || !ulidPattern.test(current.order_id) ||
    !Number.isInteger(current.order_version) || Number(current.order_version) < 1 ||
    typeof current.idempotency_key !== 'string' || !uuidV4Pattern.test(current.idempotency_key)) {
    return fail('INVALID_JOURNAL', 'Payment submit journal shape is invalid');
  }
  return {
    order_id: current.order_id,
    order_version: Number(current.order_version),
    idempotency_key: current.idempotency_key,
  };
}

export function loadPaymentSubmitJournal(): PaymentSubmitJournal | null {
  return parsePaymentSubmitJournal(storedValue());
}

export function preparePaymentSubmitJournal(
  orderId: string,
  orderVersion: number,
): PaymentSubmitJournal {
  requireOrder(orderId, orderVersion);
  const existing = loadPaymentSubmitJournal();
  if (existing !== null) {
    if (existing.order_id !== orderId || existing.order_version !== orderVersion) {
      return fail('PENDING_COMMAND', 'Another payment request is awaiting resolution');
    }
    return { ...existing };
  }
  const journal: PaymentSubmitJournal = {
    order_id: orderId,
    order_version: orderVersion,
    idempotency_key: createIdempotencyKey(),
  };
  setStoredValue(journal);
  return { ...journal };
}

export function clearPaymentSubmitJournal(expected?: PaymentSubmitJournal): void {
  if (expected !== undefined) {
    const current = loadPaymentSubmitJournal();
    if (current === null || !sameJournal(current, expected)) return;
  }
  removeStoredValue();
}

export function isCertainPaymentSubmitFailure(error: unknown): boolean {
  return error instanceof StoreApiError && [400, 401, 403, 404, 409, 422].includes(error.status);
}

export async function executePaymentSubmitJournal(
  candidate?: PaymentSubmitJournal,
): Promise<PaymentIntent> {
  const journal = candidate === undefined ? loadPaymentSubmitJournal() : { ...candidate };
  if (journal === null) return fail('INVALID_JOURNAL', 'No pending payment request exists');
  const stored = loadPaymentSubmitJournal();
  if (stored === null || !sameJournal(stored, journal)) {
    return fail('PENDING_COMMAND', 'Stored payment request changed before execution');
  }
  try {
    const intent = await createStorePaymentIntent(
      journal.order_id,
      journal.order_version,
      journal.idempotency_key,
    );
    clearPaymentSubmitJournal(journal);
    return intent;
  } catch (error) {
    if (isCertainPaymentSubmitFailure(error)) clearPaymentSubmitJournal(journal);
    throw error;
  }
}
