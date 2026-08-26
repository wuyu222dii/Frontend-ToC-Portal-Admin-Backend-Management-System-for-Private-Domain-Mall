import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GUEST_CART_QUANTITY_LIMIT,
  GUEST_CART_SCHEMA_VERSION,
  GUEST_CART_STORAGE_KEY,
  addOrMergeGuestCartItem,
  createEmptyGuestCart,
  loadGuestCart,
  parseGuestCart,
  removeGuestCartItem,
  saveGuestCart,
  selectAllGuestCartItems,
  setGuestCartItemSelected,
  setGuestCartQuantity,
  toggleGuestCartItemSelected,
  type GuestCart,
  type GuestCartItemSnapshot,
} from './guest-cart';

function snapshot(
  skuId: string,
  overrides: Partial<GuestCartItemSnapshot> = {},
): GuestCartItemSnapshot {
  return {
    product_id: '01JPRODUCT00000000000000000',
    product_name: '青序柔润洁面乳',
    sku_id: skuId,
    sku_name: '120g 单支',
    spec_label: '规格：120g',
    image_url: 'https://assets.example.test/products/cleanser.png',
    retail_price: '69.00',
    available_stock: 8,
    is_salable: true,
    ...overrides,
  };
}

function cartWithTwoItems(): GuestCart {
  let cart = addOrMergeGuestCartItem(createEmptyGuestCart(), snapshot('SKU-1'), 2);
  cart = addOrMergeGuestCartItem(cart, snapshot('SKU-2', { sku_name: '240g 双支' }), 1);
  return setGuestCartItemSelected(cart, 'SKU-2', false);
}

describe('guest cart schema', () => {
  it('creates and parses the current version without sharing nested references', () => {
    const source = cartWithTwoItems();
    const parsed = parseGuestCart(source);

    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    expect(parsed.items[0]?.snapshot).not.toBe(source.items[0]?.snapshot);
    expect(createEmptyGuestCart()).toEqual({ version: GUEST_CART_SCHEMA_VERSION, items: [] });
  });

  it('accepts a JSON encoded current document', () => {
    const cart = cartWithTwoItems();
    expect(parseGuestCart(JSON.stringify(cart))).toEqual(cart);
  });

  it.each([
    null,
    '',
    '{',
    [],
    { items: [] },
    { version: 0, items: [] },
    { version: 2, items: [] },
    { version: 1, items: [], unexpected: true },
    { version: 1, items: {} },
  ])('fails safe to an empty current cart for malformed, legacy, or future storage', (value) => {
    expect(parseGuestCart(value)).toEqual(createEmptyGuestCart());
  });

  it('fails the whole document closed when any item or snapshot field is invalid', () => {
    const cart = cartWithTwoItems();
    const invalidQuantity = structuredClone(cart) as unknown as {
      version: number;
      items: Array<{ quantity: number }>;
    };
    invalidQuantity.items[1]!.quantity = 0;
    expect(parseGuestCart(invalidQuantity)).toEqual(createEmptyGuestCart());

    const invalidPrice = structuredClone(cart) as unknown as {
      version: number;
      items: Array<{ snapshot: { retail_price: string } }>;
    };
    invalidPrice.items[0]!.snapshot.retail_price = '69.0';
    expect(parseGuestCart(invalidPrice)).toEqual(createEmptyGuestCart());

    const extraSnapshotField = structuredClone(cart) as unknown as {
      version: number;
      items: Array<{ snapshot: Record<string, unknown> }>;
    };
    extraSnapshotField.items[0]!.snapshot.internal_status = 'ACTIVE';
    expect(parseGuestCart(extraSnapshotField)).toEqual(createEmptyGuestCart());

    const invalidStock = structuredClone(cart) as unknown as {
      version: number;
      items: Array<{ snapshot: { available_stock: number } }>;
    };
    invalidStock.items[0]!.snapshot.available_stock = -1;
    expect(parseGuestCart(invalidStock)).toEqual(createEmptyGuestCart());

    const invalidSalable = structuredClone(cart) as unknown as {
      version: number;
      items: Array<{ snapshot: { is_salable: unknown } }>;
    };
    invalidSalable.items[0]!.snapshot.is_salable = 'true';
    expect(parseGuestCart(invalidSalable)).toEqual(createEmptyGuestCart());
  });

  it('keeps a zero-stock unsalable snapshot for later refresh comparison', () => {
    const cart = addOrMergeGuestCartItem(
      createEmptyGuestCart(),
      snapshot('SKU-SOLD-OUT', { available_stock: 0, is_salable: false }),
      1,
    );
    expect(parseGuestCart(cart).items[0]?.snapshot).toMatchObject({
      available_stock: 0,
      is_salable: false,
    });
  });

  it('normalizes duplicate SKU rows into one bounded item with the latest snapshot', () => {
    const first = addOrMergeGuestCartItem(createEmptyGuestCart(), snapshot('SKU-1'), 80);
    const duplicateDocument = {
      version: 1,
      items: [
        { ...first.items[0], selected: false },
        {
          quantity: 30,
          selected: true,
          snapshot: snapshot('SKU-1', { retail_price: '59.00' }),
        },
      ],
    };

    expect(parseGuestCart(duplicateDocument)).toEqual({
      version: 1,
      items: [{
        quantity: GUEST_CART_QUANTITY_LIMIT,
        selected: true,
        snapshot: snapshot('SKU-1', { retail_price: '59.00' }),
      }],
    });
  });
});

describe('guest cart operations', () => {
  it('adds different SKUs independently and merges the same SKU by its global key', () => {
    const original = addOrMergeGuestCartItem(createEmptyGuestCart(), snapshot('SKU-1'), 2);
    const merged = addOrMergeGuestCartItem(
      original,
      snapshot('SKU-1', { retail_price: '71.00' }),
      3,
    );
    const withSecondSku = addOrMergeGuestCartItem(
      merged,
      snapshot('SKU-2', { product_id: original.items[0]!.snapshot.product_id }),
      1,
    );

    expect(original.items[0]).toMatchObject({ quantity: 2, selected: true });
    expect(merged.items).toHaveLength(1);
    expect(merged.items[0]).toMatchObject({
      quantity: 5,
      selected: true,
      snapshot: { sku_id: 'SKU-1', retail_price: '71.00' },
    });
    expect(withSecondSku.items.map((item) => item.snapshot.sku_id)).toEqual(['SKU-1', 'SKU-2']);
  });

  it('clamps added and merged quantities to 1 through 99', () => {
    const minimum = addOrMergeGuestCartItem(createEmptyGuestCart(), snapshot('SKU-1'), -4);
    const maximum = addOrMergeGuestCartItem(minimum, snapshot('SKU-1'), 200);
    expect(minimum.items[0]?.quantity).toBe(1);
    expect(maximum.items[0]?.quantity).toBe(99);
  });

  it('sets a bounded integer quantity without removing a zero request', () => {
    const cart = cartWithTwoItems();
    expect(setGuestCartQuantity(cart, 'SKU-1', 0).items[0]?.quantity).toBe(1);
    expect(setGuestCartQuantity(cart, 'SKU-1', 12.9).items[0]?.quantity).toBe(12);
    expect(setGuestCartQuantity(cart, 'SKU-1', 999).items[0]?.quantity).toBe(99);
    expect(setGuestCartQuantity(cart, 'SKU-1', Number.NaN).items[0]?.quantity).toBe(1);
  });

  it('supports explicit selection, toggle, select all, and removal', () => {
    const cart = cartWithTwoItems();
    const selected = setGuestCartItemSelected(cart, 'SKU-2', true);
    const toggled = toggleGuestCartItemSelected(selected, 'SKU-1');
    const cleared = selectAllGuestCartItems(toggled, false);
    const restored = selectAllGuestCartItems(cleared, true);
    const removed = removeGuestCartItem(restored, 'SKU-1');

    expect(selected.items.map((item) => item.selected)).toEqual([true, true]);
    expect(toggled.items.map((item) => item.selected)).toEqual([false, true]);
    expect(cleared.items.every((item) => !item.selected)).toBe(true);
    expect(restored.items.every((item) => item.selected)).toBe(true);
    expect(removed.items.map((item) => item.snapshot.sku_id)).toEqual(['SKU-2']);
    expect(cart.items.map((item) => item.snapshot.sku_id)).toEqual(['SKU-1', 'SKU-2']);
  });

  it('leaves other items unchanged when a target SKU does not exist', () => {
    const cart = cartWithTwoItems();
    expect(setGuestCartQuantity(cart, 'UNKNOWN', 7)).toEqual(cart);
    expect(setGuestCartItemSelected(cart, 'UNKNOWN', false)).toEqual(cart);
    expect(toggleGuestCartItemSelected(cart, 'UNKNOWN')).toEqual(cart);
    expect(removeGuestCartItem(cart, 'UNKNOWN')).toEqual(cart);
  });
});

describe('guest cart persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads a validated cart and saves only the normalized current schema', () => {
    const stored = cartWithTwoItems();
    const setStorageSync = vi.fn();
    vi.stubGlobal('uni', {
      getStorageSync: vi.fn(() => stored),
      setStorageSync,
    });

    expect(loadGuestCart()).toEqual(stored);
    const saved = saveGuestCart(stored);
    expect(saved).toEqual(stored);
    expect(setStorageSync).toHaveBeenCalledWith(GUEST_CART_STORAGE_KEY, saved);
  });

  it('returns an empty cart when reading local storage throws', () => {
    vi.stubGlobal('uni', {
      getStorageSync: vi.fn(() => {
        throw new Error('storage unavailable');
      }),
    });
    expect(loadGuestCart()).toEqual(createEmptyGuestCart());
  });

  it('does not hide a storage write failure from the caller', () => {
    vi.stubGlobal('uni', {
      setStorageSync: vi.fn(() => {
        throw new Error('quota exceeded');
      }),
    });
    expect(() => saveGuestCart(cartWithTwoItems())).toThrow('quota exceeded');
  });
});
