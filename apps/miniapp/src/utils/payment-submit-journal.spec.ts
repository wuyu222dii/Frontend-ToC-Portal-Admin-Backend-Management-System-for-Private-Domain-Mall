import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreApiError } from '../api/store-client';
import type { PaymentIntent } from '../types/store-payments';
import {
  PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY,
  PaymentSubmitJournalError,
  executePaymentSubmitJournal,
  loadPaymentSubmitJournal,
  parsePaymentSubmitJournal,
  preparePaymentSubmitJournal,
} from './payment-submit-journal';

const mocks = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
  createStorePaymentIntent: vi.fn(),
}));

vi.mock('../api/store-identity', () => ({ createIdempotencyKey: mocks.createIdempotencyKey }));
vi.mock('../api/store-payments', () => ({
  createStorePaymentIntent: mocks.createStorePaymentIntent,
}));

const ORDER_ID = '01J00000000000000000000000';
const OTHER_ORDER_ID = '01J10000000000000000000000';
const PAYMENT_INTENT_ID = '01J20000000000000000000000';

const intent = { payment_intent_id: PAYMENT_INTENT_ID } as unknown as PaymentIntent;
const journal = {
  order_id: ORDER_ID,
  order_version: 4,
  idempotency_key: '123e4567-e89b-42d3-a456-426614174000',
};

function storageEnvironment() {
  const values = new Map<string, unknown>();
  const calls: string[] = [];
  const getStorageSync = vi.fn((key: string) => values.get(key));
  const setStorageSync = vi.fn((key: string, value: unknown) => {
    calls.push(`set:${key}`);
    values.set(key, value);
  });
  const removeStorageSync = vi.fn((key: string) => {
    calls.push(`remove:${key}`);
    values.delete(key);
  });
  vi.stubGlobal('uni', { getStorageSync, removeStorageSync, setStorageSync });
  return { calls, getStorageSync, removeStorageSync, setStorageSync, values };
}

function expectJournalError(action: () => unknown, code: string): void {
  try {
    action();
    throw new Error('Expected payment submit journal operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(PaymentSubmitJournalError);
    expect(error).toMatchObject({ code });
  }
}

describe('B10 payment submit journal', () => {
  afterEach(() => {
    mocks.createIdempotencyKey.mockClear();
    mocks.createStorePaymentIntent.mockReset();
    vi.unstubAllGlobals();
  });

  it('accepts and persists exactly three non-sensitive command facts', () => {
    const storage = storageEnvironment();
    expect(parsePaymentSubmitJournal(journal)).toEqual(journal);
    expect(parsePaymentSubmitJournal(JSON.stringify(journal))).toEqual(journal);
    expect(parsePaymentSubmitJournal(null)).toBeNull();

    expect(preparePaymentSubmitJournal(ORDER_ID, 4)).toEqual(journal);
    expect(storage.values.get(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal);
    expect(Object.keys(journal)).toEqual(['order_id', 'order_version', 'idempotency_key']);
  });

  it.each([
    { ...journal, provider_payload: { pay_sign: 'must-not-persist' } },
    { ...journal, payment_intent_id: PAYMENT_INTENT_ID },
    { ...journal, order_id: ORDER_ID.toLowerCase() },
    { ...journal, order_version: 0 },
    { ...journal, idempotency_key: 'not-a-uuid' },
  ])('rejects malformed or capability-polluted stored data', (value) => {
    expectJournalError(() => parsePaymentSubmitJournal(value), 'INVALID_JOURNAL');
  });

  it('persists before sending and removes the journal only after a response', async () => {
    const storage = storageEnvironment();
    mocks.createStorePaymentIntent.mockImplementation(async (...args) => {
      expect(storage.values.get(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal);
      expect(storage.calls[0]).toBe(`set:${PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY}`);
      expect(args).toEqual([ORDER_ID, 4, journal.idempotency_key]);
      return intent;
    });

    const prepared = preparePaymentSubmitJournal(ORDER_ID, 4);
    await expect(executePaymentSubmitJournal(prepared)).resolves.toBe(intent);
    expect(storage.values.has(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('retries a lost response with the exact same order version and key', async () => {
    const storage = storageEnvironment();
    mocks.createStorePaymentIntent
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(intent);

    const prepared = preparePaymentSubmitJournal(ORDER_ID, 4);
    await expect(executePaymentSubmitJournal(prepared)).rejects.toThrow('response lost');
    expect(loadPaymentSubmitJournal()).toEqual(journal);
    await expect(executePaymentSubmitJournal(prepared)).resolves.toBe(intent);
    expect(mocks.createStorePaymentIntent.mock.calls[0]).toEqual(
      mocks.createStorePaymentIntent.mock.calls[1],
    );
    expect(storage.values.has(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it.each([0, 429, 500, 503])('retains an ambiguous HTTP %i result', async (status) => {
    storageEnvironment();
    const failure = new StoreApiError('ambiguous', { status, code: 'AMBIGUOUS' });
    mocks.createStorePaymentIntent.mockRejectedValue(failure);
    const prepared = preparePaymentSubmitJournal(ORDER_ID, 4);
    await expect(executePaymentSubmitJournal(prepared)).rejects.toBe(failure);
    expect(loadPaymentSubmitJournal()).toEqual(journal);
  });

  it.each([400, 401, 403, 404, 409, 422])('clears a definite HTTP %i rejection', async (status) => {
    const storage = storageEnvironment();
    const failure = new StoreApiError('definite', { status, code: 'DEFINITE' });
    mocks.createStorePaymentIntent.mockRejectedValue(failure);
    const prepared = preparePaymentSubmitJournal(ORDER_ID, 4);
    await expect(executePaymentSubmitJournal(prepared)).rejects.toBe(failure);
    expect(storage.values.has(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('blocks a different pending order or version without replacing it', () => {
    const storage = storageEnvironment();
    preparePaymentSubmitJournal(ORDER_ID, 4);
    expectJournalError(() => preparePaymentSubmitJournal(OTHER_ORDER_ID, 4), 'PENDING_COMMAND');
    expectJournalError(() => preparePaymentSubmitJournal(ORDER_ID, 5), 'PENDING_COMMAND');
    expect(storage.values.get(PAYMENT_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal);
  });

  it('does not send when journal storage cannot persist or read', async () => {
    const storage = storageEnvironment();
    storage.setStorageSync.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    expectJournalError(() => preparePaymentSubmitJournal(ORDER_ID, 4), 'STORAGE_UNAVAILABLE');
    storage.getStorageSync.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    await expect(executePaymentSubmitJournal()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(mocks.createStorePaymentIntent).not.toHaveBeenCalled();
  });
});
