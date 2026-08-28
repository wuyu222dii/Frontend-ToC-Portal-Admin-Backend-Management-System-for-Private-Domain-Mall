import { afterEach, describe, expect, it, vi } from 'vitest';

import type { StoreCart } from '../types/store-shopping';
import {
  GUEST_CART_SCHEMA_VERSION,
  GUEST_CART_STORAGE_KEY,
  type GuestCart,
  type GuestCartItem,
} from './guest-cart';
import {
  GUEST_CART_MERGE_JOURNAL_SCHEMA_VERSION,
  GUEST_CART_MERGE_JOURNAL_STORAGE_KEY,
  GuestCartMergeJournalError,
  consumeConfirmedGuestCartMergeSnapshots,
  executeGuestCartMergeJournal,
  guestCartMergeCommand,
  loadGuestCartMergeJournal,
  parseGuestCartMergeJournal,
  prepareAndExecuteGuestCartMerge,
  prepareGuestCartMergeJournal,
  resumeGuestCartMergeJournal,
  synchronizeGuestCartAfterAuthentication,
} from './guest-cart-merge-journal';

const mocks = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(() => '123e4567-e89b-42d3-a456-426614174000'),
  getCustomerProfile: vi.fn(),
  mergeStoreCart: vi.fn(),
}));

vi.mock('../api/store-identity', () => ({
  createIdempotencyKey: mocks.createIdempotencyKey,
  getCustomerProfile: mocks.getCustomerProfile,
}));

vi.mock('../api/store-shopping', () => ({
  mergeStoreCart: mocks.mergeStoreCart,
}));

const CUSTOMER_ID = '01J00000000000000000000000';
const OTHER_CUSTOMER_ID = '01J00000000000000000000001';
const PRODUCT_ID = '01J00000000000000000000002';
const SKU_ID = '01J00000000000000000000003';
const SECOND_SKU_ID = '01J00000000000000000000004';
const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';

const serverCart: StoreCart = { cart_id: null, items: [], total_amount: '0.00' };

function item(skuId = SKU_ID, quantity = 2): GuestCartItem {
  return {
    quantity,
    selected: true,
    snapshot: {
      product_id: PRODUCT_ID,
      product_name: '青序洁面乳',
      sku_id: skuId,
      sku_name: '标准装',
      spec_label: '规格：120g',
      image_url: 'https://assets.example.test/product.png',
      retail_price: '69.00',
      available_stock: 8,
      is_salable: true,
    },
  };
}

function guestCart(items: GuestCartItem[] = [item()]): GuestCart {
  return { version: GUEST_CART_SCHEMA_VERSION, items };
}

function journal(items: GuestCartItem[] = [item()]) {
  return {
    schema_version: GUEST_CART_MERGE_JOURNAL_SCHEMA_VERSION,
    customer_id: CUSTOMER_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    items,
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
    throw new Error('Expected journal operation to fail');
  } catch (error) {
    expect(error).toBeInstanceOf(GuestCartMergeJournalError);
    expect(error).toMatchObject({ code });
  }
}

describe('guest cart merge journal schema', () => {
  afterEach(() => {
    mocks.createIdempotencyKey.mockClear();
    mocks.getCustomerProfile.mockReset();
    mocks.mergeStoreCart.mockReset();
    vi.unstubAllGlobals();
  });

  it('accepts only the exact current version and returns independent item snapshots', () => {
    const source = journal();
    const parsed = parseGuestCartMergeJournal(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed?.items[0]?.snapshot).not.toBe(source.items[0]?.snapshot);
    expect(parseGuestCartMergeJournal(null)).toBeNull();
    expect(parseGuestCartMergeJournal('')).toBeNull();
  });

  it.each([
    [{ ...journal(), schema_version: 2 }, 'INVALID_JOURNAL'],
    [{ ...journal(), extra: true }, 'INVALID_JOURNAL'],
    [{ ...journal(), customer_id: 'not-an-ulid' }, 'INVALID_JOURNAL'],
    [{ ...journal(), idempotency_key: 'not-a-uuid' }, 'INVALID_JOURNAL'],
    [{ ...journal(), items: [] }, 'INVALID_JOURNAL'],
    [{ ...journal(), items: [{ ...item(), quantity: 0 }] }, 'INVALID_JOURNAL'],
    [{ ...journal(), items: [{ ...item(), quantity: 100 }] }, 'INVALID_JOURNAL'],
    [{ ...journal(), items: [item(), item()] }, 'INVALID_JOURNAL'],
    [{ ...journal(), items: [{ ...item(), snapshot: { ...item().snapshot, sku_id: 'bad' } }] },
      'INVALID_JOURNAL'],
  ])('rejects malformed, unbounded, duplicate, or non-ULID journal data', (value, code) => {
    expectJournalError(() => parseGuestCartMergeJournal(value), code);
  });

  it('rejects more than 100 unique items', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const items = Array.from({ length: 101 }, (_, index) => {
      const suffix = `${alphabet[Math.floor(index / alphabet.length)]}${alphabet[index % alphabet.length]}`;
      return item(`01J0000000000000000000${suffix}`, 1);
    });
    expectJournalError(
      () => parseGuestCartMergeJournal({ ...journal(), items }),
      'INVALID_JOURNAL',
    );
  });

  it('derives the request body and fixed idempotency key only from journal facts', () => {
    expect(guestCartMergeCommand(journal([item(SKU_ID, 3), {
      ...item(SECOND_SKU_ID, 1),
      selected: false,
    }]))).toEqual({
      idempotencyKey: IDEMPOTENCY_KEY,
      input: {
        items: [
          { sku_id: SKU_ID, quantity: 3, selected: true },
          { sku_id: SECOND_SKU_ID, quantity: 1, selected: false },
        ],
      },
    });
  });
});

describe('guest cart merge journal persistence and execution', () => {
  afterEach(async () => {
    mocks.getCustomerProfile.mockResolvedValue({ customer_id: CUSTOMER_ID });
    await consumeConfirmedGuestCartMergeSnapshots();
    mocks.createIdempotencyKey.mockClear();
    mocks.getCustomerProfile.mockReset();
    mocks.mergeStoreCart.mockReset();
    vi.unstubAllGlobals();
  });

  it('persists an exact customer-bound journal before sending the merge request', async () => {
    const storage = storageEnvironment();
    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart());
    mocks.mergeStoreCart.mockImplementation(async () => {
      expect(storage.values.get(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY)).toEqual(journal());
      expect(storage.calls[0]).toBe(`set:${GUEST_CART_MERGE_JOURNAL_STORAGE_KEY}`);
      return serverCart;
    });

    await expect(prepareAndExecuteGuestCartMerge(CUSTOMER_ID)).resolves.toEqual(serverCart);

    expect(mocks.mergeStoreCart).toHaveBeenCalledWith({
      items: [{ sku_id: SKU_ID, quantity: 2, selected: true }],
    }, IDEMPOTENCY_KEY);
    expect(storage.values.get(GUEST_CART_STORAGE_KEY)).toEqual(guestCart([]));
    expect(storage.values.has(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('does not send a request when preparing the journal cannot write storage', async () => {
    const storage = storageEnvironment();
    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart());
    storage.setStorageSync.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });

    await expect(prepareAndExecuteGuestCartMerge(CUSTOMER_ID)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(mocks.mergeStoreCart).not.toHaveBeenCalled();
  });

  it('keeps the same body, key, journal, and guest items after an ambiguous failure', async () => {
    const storage = storageEnvironment();
    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart());
    mocks.mergeStoreCart
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce(serverCart);

    const prepared = prepareGuestCartMergeJournal(CUSTOMER_ID);
    await expect(executeGuestCartMergeJournal(CUSTOMER_ID, prepared ?? undefined))
      .rejects.toThrow('response lost');
    expect(storage.values.get(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY)).toEqual(journal());
    expect(storage.values.get(GUEST_CART_STORAGE_KEY)).toEqual(guestCart());

    await expect(resumeGuestCartMergeJournal(CUSTOMER_ID)).resolves.toEqual(serverCart);
    expect(mocks.mergeStoreCart).toHaveBeenCalledTimes(2);
    expect(mocks.mergeStoreCart.mock.calls[0]).toEqual(mocks.mergeStoreCart.mock.calls[1]);
    expect(storage.values.has(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('removes only current local rows that still exactly match confirmed journal rows', async () => {
    const storage = storageEnvironment();
    const first = item();
    const second = { ...item(SECOND_SKU_ID), selected: false };
    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart([first, second]));
    const prepared = prepareGuestCartMergeJournal(CUSTOMER_ID);
    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart([
      first,
      { ...second, quantity: second.quantity + 1 },
    ]));
    mocks.mergeStoreCart.mockResolvedValue(serverCart);

    await executeGuestCartMergeJournal(CUSTOMER_ID, prepared ?? undefined);

    expect(storage.values.get(GUEST_CART_STORAGE_KEY)).toEqual(guestCart([
      { ...second, quantity: second.quantity + 1 },
    ]));
    expect(storage.values.has(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY)).toBe(false);
  });

  it('blocks another customer before network execution and preserves all facts', async () => {
    const storage = storageEnvironment();
    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart());
    const prepared = prepareGuestCartMergeJournal(CUSTOMER_ID);

    expectJournalError(
      () => prepareGuestCartMergeJournal(OTHER_CUSTOMER_ID),
      'CUSTOMER_MISMATCH',
    );
    await expect(executeGuestCartMergeJournal(OTHER_CUSTOMER_ID, prepared ?? undefined))
      .rejects.toMatchObject({ code: 'CUSTOMER_MISMATCH' });
    expect(mocks.mergeStoreCart).not.toHaveBeenCalled();
    expect(storage.values.get(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY)).toEqual(journal());
    expect(storage.values.get(GUEST_CART_STORAGE_KEY)).toEqual(guestCart());
  });

  it('does not send when journal storage cannot be read', async () => {
    const storage = storageEnvironment();
    storage.getStorageSync.mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    await expect(resumeGuestCartMergeJournal(CUSTOMER_ID)).rejects.toMatchObject({
      code: 'STORAGE_UNAVAILABLE',
    });
    expect(mocks.mergeStoreCart).not.toHaveBeenCalled();
  });

  it('returns null without a request for an empty cart or absent journal', async () => {
    storageEnvironment();
    expect(prepareGuestCartMergeJournal(CUSTOMER_ID)).toBeNull();
    await expect(resumeGuestCartMergeJournal(CUSTOMER_ID)).resolves.toBeNull();
    expect(loadGuestCartMergeJournal()).toBeNull();
    expect(mocks.createIdempotencyKey).not.toHaveBeenCalled();
    expect(mocks.mergeStoreCart).not.toHaveBeenCalled();
  });

  it('refuses malformed guest storage instead of silently skipping the login merge', async () => {
    const storage = storageEnvironment();
    storage.values.set(GUEST_CART_STORAGE_KEY, '{not-json');

    await expect(synchronizeGuestCartAfterAuthentication()).rejects.toMatchObject({
      code: 'INVALID_GUEST_CART',
    });
    expect(mocks.getCustomerProfile).not.toHaveBeenCalled();
    expect(mocks.mergeStoreCart).not.toHaveBeenCalled();
  });

  it('publishes confirmed snapshots only after cleanup and only to the bound customer', async () => {
    const storage = storageEnvironment();
    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart());
    mocks.getCustomerProfile.mockResolvedValue({ customer_id: CUSTOMER_ID });
    mocks.mergeStoreCart.mockResolvedValue(serverCart);

    await expect(synchronizeGuestCartAfterAuthentication()).resolves.toEqual(serverCart);
    expect(storage.values.has(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY)).toBe(false);
    await expect(consumeConfirmedGuestCartMergeSnapshots()).resolves.toEqual([item()]);
    await expect(consumeConfirmedGuestCartMergeSnapshots()).resolves.toEqual([]);

    storage.values.set(GUEST_CART_STORAGE_KEY, guestCart());
    await synchronizeGuestCartAfterAuthentication();
    mocks.getCustomerProfile.mockResolvedValue({ customer_id: OTHER_CUSTOMER_ID });
    await expect(consumeConfirmedGuestCartMergeSnapshots()).resolves.toEqual([]);
  });
});
