import { afterEach, describe, expect, it, vi } from 'vitest';

import { StoreApiError } from '../api/store-client';
import type { StoreOrder } from '../types/store-orders';
import {
  ORDER_SUBMIT_JOURNAL_SCHEMA_VERSION,
  ORDER_SUBMIT_JOURNAL_STORAGE_KEY,
  ORDER_SUBMIT_JOURNAL_TTL_MS,
  OrderSubmitJournalError,
  executeOrderSubmitJournal,
  loadOrderSubmitJournal,
  parseOrderSubmitJournal,
  prepareOrderSubmitJournal,
} from './order-submit-journal';

const mocks = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
  createStoreOrder: vi.fn(),
}));

vi.mock('../api/store-identity', () => ({
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

vi.mock('../api/store-orders', () => ({
  createStoreOrder: mocks.createStoreOrder,
}));

const CUSTOMER_ID = '01J00000000000000000000000';
const OTHER_CUSTOMER_ID = '01J10000000000000000000000';
const ADDRESS_ID = '01J20000000000000000000000';
const SKU_ID = '01J30000000000000000000000';
const SECOND_SKU_ID = '01J40000000000000000000000';
const QUOTE_ID = '01J50000000000000000000000';
const ORDER_ID = '01J60000000000000000000000';
const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';
// Keep the fixture outside the one-day journal TTL as the calendar advances.
const NOW = Date.parse('2099-08-29T01:00:00.000Z');

const order = { order_id: ORDER_ID } as unknown as StoreOrder;

function request(items = [{ sku_id: SKU_ID, quantity: 2 }]) {
  return {
    source: 'CART' as const,
    address_id: ADDRESS_ID,
    items,
    quote_id: QUOTE_ID,
    quote_token: 'quote-token-at-least-twenty-characters',
    confirmation_hash: 'a'.repeat(64),
  };
}

function journal(items = [{ sku_id: SKU_ID, quantity: 2 }]) {
  return {
    schema_version: ORDER_SUBMIT_JOURNAL_SCHEMA_VERSION,
    customer_id: CUSTOMER_ID,
    created_at: new Date(NOW).toISOString(),
    idempotency_key: IDEMPOTENCY_KEY,
    request: request(items),
  };
}

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
    throw new Error('Expected order submit journal operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(OrderSubmitJournalError);
    expect(error).toMatchObject({ code });
  }
}

describe('B9 order submit journal schema', () => {
  afterEach(() => {
    mocks.createIdempotencyKey.mockClear();
    mocks.createStoreOrder.mockReset();
    vi.unstubAllGlobals();
  });

  it('accepts only exact current-version data and returns independent request rows', () => {
    const source = journal();
    const parsed = parseOrderSubmitJournal(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed?.request).not.toBe(source.request);
    expect(parsed?.request.items[0]).not.toBe(source.request.items[0]);
    expect(parseOrderSubmitJournal(null)).toBeNull();
    expect(parseOrderSubmitJournal('')).toBeNull();
    expect(parseOrderSubmitJournal(JSON.stringify(source))).toEqual(source);
  });

  it.each([
    { ...journal(), schema_version: 2 },
    { ...journal(), extra: true },
    { ...journal(), customer_id: 'not-a-customer' },
    { ...journal(), created_at: 'not-a-date' },
    { ...journal(), idempotency_key: 'not-a-uuid' },
    { ...journal(), request: { ...request(), extra: true } },
    { ...journal(), request: { ...request(), quote_token: 'x'.repeat(31) } },
    { ...journal(), request: { ...request(), quote_token: 'x'.repeat(513) } },
    { ...journal(), request: { ...request(), items: [] } },
    { ...journal(), request: { ...request(), items: [{ sku_id: SKU_ID, quantity: 2, extra: true }] } },
    { ...journal(), request: { ...request(), items: [{ sku_id: SKU_ID, quantity: 0 }] } },
    { ...journal(), request: request([{ sku_id: SKU_ID, quantity: 1 }, { sku_id: SKU_ID, quantity: 2 }]) },
    {
      ...journal(),
      request: {
        ...request([{ sku_id: SKU_ID, quantity: 1 }, { sku_id: SECOND_SKU_ID, quantity: 1 }]),
        source: 'BUY_NOW',
      },
    },
  ])('rejects polluted, malformed, duplicate, or source-inconsistent journal facts', (value) => {
    expectJournalError(() => parseOrderSubmitJournal(value), 'INVALID_JOURNAL');
  });

  it('expires and removes a journal at the exact TTL boundary', () => {
    const storage = storageEnvironment();
    storage.values.set(ORDER_SUBMIT_JOURNAL_STORAGE_KEY, journal());

    expect(loadOrderSubmitJournal(NOW + ORDER_SUBMIT_JOURNAL_TTL_MS - 1)).toEqual(journal());
    expect(loadOrderSubmitJournal(NOW + ORDER_SUBMIT_JOURNAL_TTL_MS)).toBeNull();
    expect(storage.removeStorageSync).toHaveBeenCalledWith(ORDER_SUBMIT_JOURNAL_STORAGE_KEY);
  });
});

describe('B9 order submit journal persistence and execution', () => {
  afterEach(() => {
    mocks.createIdempotencyKey.mockClear();
    mocks.createStoreOrder.mockReset();
    vi.unstubAllGlobals();
  });

  it('persists the exact customer-bound command before sending it', async () => {
    const storage = storageEnvironment();
    mocks.createStoreOrder.mockImplementation(async (body, key) => {
      expect(storage.values.get(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal());
      expect(storage.calls[0]).toBe(`set:${ORDER_SUBMIT_JOURNAL_STORAGE_KEY}`);
      expect(body).toEqual(request());
      expect(key).toBe(IDEMPOTENCY_KEY);
      return order;
    });

    const prepared = prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW);
    await expect(executeOrderSubmitJournal(CUSTOMER_ID, prepared)).resolves.toBe(order);
    expect(storage.values.has(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('retries an ambiguous network loss with the same body and idempotency key', async () => {
    const storage = storageEnvironment();
    mocks.createStoreOrder
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(order);

    const prepared = prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW);
    await expect(executeOrderSubmitJournal(CUSTOMER_ID, prepared)).rejects.toThrow('response lost');
    expect(storage.values.get(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal());

    await expect(executeOrderSubmitJournal(CUSTOMER_ID, prepared)).resolves.toBe(order);
    expect(mocks.createStoreOrder).toHaveBeenCalledTimes(2);
    expect(mocks.createStoreOrder.mock.calls[0]).toEqual(mocks.createStoreOrder.mock.calls[1]);
    expect(storage.values.has(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('keeps the command after a server failure because the result may be ambiguous', async () => {
    const storage = storageEnvironment();
    const failure = new StoreApiError('server failed', { status: 500, code: 'INTERNAL_ERROR' });
    mocks.createStoreOrder.mockRejectedValue(failure);
    const prepared = prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW);

    await expect(executeOrderSubmitJournal(CUSTOMER_ID, prepared)).rejects.toBe(failure);
    expect(storage.values.get(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal());
  });

  it.each([400, 401, 403, 404, 409, 422])(
    'clears the command after a definite HTTP %i rejection',
    async (status) => {
      const storage = storageEnvironment();
      const failure = new StoreApiError('definite rejection', { status, code: 'REJECTED' });
      mocks.createStoreOrder.mockRejectedValue(failure);
      const prepared = prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW);

      await expect(executeOrderSubmitJournal(CUSTOMER_ID, prepared)).rejects.toBe(failure);
      expect(storage.values.has(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toBe(false);
    },
  );

  it('keeps a throttled command so the same body and key can be retried later', async () => {
    const storage = storageEnvironment();
    const failure = new StoreApiError('rate limited', { status: 429, code: 'RATE_LIMITED' });
    mocks.createStoreOrder.mockRejectedValue(failure);
    const prepared = prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW);

    await expect(executeOrderSubmitJournal(CUSTOMER_ID, prepared)).rejects.toBe(failure);
    expect(storage.values.get(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal());
  });

  it('clears another customer journal and blocks execution before the network', async () => {
    const storage = storageEnvironment();
    const prepared = prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW);

    expectJournalError(
      () => prepareOrderSubmitJournal(OTHER_CUSTOMER_ID, request(), NOW),
      'CUSTOMER_MISMATCH',
    );
    expect(storage.values.has(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toBe(false);
    await expect(executeOrderSubmitJournal(OTHER_CUSTOMER_ID, prepared)).rejects.toMatchObject({
      code: 'CUSTOMER_MISMATCH',
    });
    expect(mocks.createStoreOrder).not.toHaveBeenCalled();
  });

  it('blocks a different command for the same customer without replacing stored facts', () => {
    const storage = storageEnvironment();
    prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW);

    expectJournalError(
      () => prepareOrderSubmitJournal(CUSTOMER_ID, {
        ...request(), items: [{ sku_id: SKU_ID, quantity: 3 }],
      }, NOW),
      'PENDING_COMMAND',
    );
    expect(mocks.createStoreOrder).not.toHaveBeenCalled();
    expect(storage.values.get(ORDER_SUBMIT_JOURNAL_STORAGE_KEY)).toEqual(journal());
  });

  it('does not send when storage cannot persist or read the journal', async () => {
    const storage = storageEnvironment();
    storage.setStorageSync.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    expectJournalError(
      () => prepareOrderSubmitJournal(CUSTOMER_ID, request(), NOW),
      'STORAGE_UNAVAILABLE',
    );
    expect(mocks.createStoreOrder).not.toHaveBeenCalled();

    storage.getStorageSync.mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    await expect(executeOrderSubmitJournal(CUSTOMER_ID)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(mocks.createStoreOrder).not.toHaveBeenCalled();
  });
});
