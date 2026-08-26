export const GUEST_CART_STORAGE_KEY = 'qingxu:store-guest-cart';
export const GUEST_CART_SCHEMA_VERSION = 1 as const;
export const GUEST_CART_QUANTITY_LIMIT = 99;

export interface GuestCartItemSnapshot {
  product_id: string;
  product_name: string;
  sku_id: string;
  sku_name: string;
  spec_label: string;
  image_url: string | null;
  retail_price: string;
  available_stock: number;
  is_salable: boolean;
}

export interface GuestCartItem {
  quantity: number;
  selected: boolean;
  snapshot: GuestCartItemSnapshot;
}

export interface GuestCart {
  version: typeof GUEST_CART_SCHEMA_VERSION;
  items: GuestCartItem[];
}

type PlainRecord = Record<string, unknown>;

const MONEY_PATTERN = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: PlainRecord, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseSnapshot(value: unknown): GuestCartItemSnapshot | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, [
    'product_id',
    'product_name',
    'sku_id',
    'sku_name',
    'spec_label',
    'image_url',
    'retail_price',
    'available_stock',
    'is_salable',
  ])) {
    return null;
  }

  if (!isNonEmptyString(value.product_id) ||
    !isNonEmptyString(value.product_name) ||
    !isNonEmptyString(value.sku_id) ||
    !isNonEmptyString(value.sku_name) ||
    !isNonEmptyString(value.spec_label) ||
    (value.image_url !== null && !isNonEmptyString(value.image_url)) ||
    typeof value.retail_price !== 'string' || !MONEY_PATTERN.test(value.retail_price) ||
    !Number.isInteger(value.available_stock) || Number(value.available_stock) < 0 ||
    typeof value.is_salable !== 'boolean') {
    return null;
  }

  return {
    product_id: value.product_id,
    product_name: value.product_name,
    sku_id: value.sku_id,
    sku_name: value.sku_name,
    spec_label: value.spec_label,
    image_url: value.image_url,
    retail_price: value.retail_price,
    available_stock: Number(value.available_stock),
    is_salable: value.is_salable,
  };
}

function parseItem(value: unknown): GuestCartItem | null {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['quantity', 'selected', 'snapshot']) ||
    !Number.isInteger(value.quantity) || Number(value.quantity) < 1 ||
    Number(value.quantity) > GUEST_CART_QUANTITY_LIMIT || typeof value.selected !== 'boolean') {
    return null;
  }
  const snapshot = parseSnapshot(value.snapshot);
  if (snapshot === null) return null;
  return {
    quantity: Number(value.quantity),
    selected: value.selected,
    snapshot,
  };
}

function decodedStorageValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function cloneSnapshot(snapshot: GuestCartItemSnapshot): GuestCartItemSnapshot {
  return { ...snapshot };
}

function mergeDuplicateItems(items: readonly GuestCartItem[]): GuestCartItem[] {
  const merged: GuestCartItem[] = [];
  const indexes = new Map<string, number>();
  for (const item of items) {
    const existingIndex = indexes.get(item.snapshot.sku_id);
    if (existingIndex === undefined) {
      indexes.set(item.snapshot.sku_id, merged.length);
      merged.push({ ...item, snapshot: cloneSnapshot(item.snapshot) });
      continue;
    }
    const existing = merged[existingIndex];
    if (existing === undefined) continue;
    merged[existingIndex] = {
      quantity: Math.min(GUEST_CART_QUANTITY_LIMIT, existing.quantity + item.quantity),
      selected: existing.selected || item.selected,
      snapshot: cloneSnapshot(item.snapshot),
    };
  }
  return merged;
}

export function createEmptyGuestCart(): GuestCart {
  return { version: GUEST_CART_SCHEMA_VERSION, items: [] };
}

export function parseGuestCart(value: unknown): GuestCart {
  const decoded = decodedStorageValue(value);
  if (!isPlainRecord(decoded) || !hasExactKeys(decoded, ['version', 'items']) ||
    decoded.version !== GUEST_CART_SCHEMA_VERSION || !Array.isArray(decoded.items)) {
    return createEmptyGuestCart();
  }

  const items = decoded.items.map(parseItem);
  if (items.some((item) => item === null)) return createEmptyGuestCart();
  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: mergeDuplicateItems(items as GuestCartItem[]),
  };
}

export function loadGuestCart(): GuestCart {
  try {
    return parseGuestCart(uni.getStorageSync(GUEST_CART_STORAGE_KEY));
  } catch {
    return createEmptyGuestCart();
  }
}

export function saveGuestCart(cart: GuestCart): GuestCart {
  const normalized = parseGuestCart(cart);
  uni.setStorageSync(GUEST_CART_STORAGE_KEY, normalized);
  return normalized;
}

function normalizedQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(GUEST_CART_QUANTITY_LIMIT, Math.max(1, Math.trunc(value)));
}

export function addOrMergeGuestCartItem(
  cart: GuestCart,
  snapshotValue: GuestCartItemSnapshot,
  quantityValue: number,
): GuestCart {
  const cartValue = parseGuestCart(cart);
  const snapshot = parseSnapshot(snapshotValue);
  if (snapshot === null) return cartValue;

  const quantity = normalizedQuantity(quantityValue);
  const index = cartValue.items.findIndex((item) => item.snapshot.sku_id === snapshot.sku_id);
  if (index === -1) {
    return {
      version: GUEST_CART_SCHEMA_VERSION,
      items: [...cartValue.items, { quantity, selected: true, snapshot }],
    };
  }

  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: cartValue.items.map((item, itemIndex) => itemIndex === index
      ? {
          quantity: Math.min(GUEST_CART_QUANTITY_LIMIT, item.quantity + quantity),
          selected: true,
          snapshot,
        }
      : item),
  };
}

export function setGuestCartQuantity(
  cart: GuestCart,
  skuId: string,
  quantityValue: number,
): GuestCart {
  const cartValue = parseGuestCart(cart);
  const quantity = normalizedQuantity(quantityValue);
  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: cartValue.items.map((item) => item.snapshot.sku_id === skuId
      ? { ...item, quantity }
      : item),
  };
}

export function setGuestCartItemSelected(
  cart: GuestCart,
  skuId: string,
  selected: boolean,
): GuestCart {
  const cartValue = parseGuestCart(cart);
  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: cartValue.items.map((item) => item.snapshot.sku_id === skuId
      ? { ...item, selected }
      : item),
  };
}

export function toggleGuestCartItemSelected(cart: GuestCart, skuId: string): GuestCart {
  const cartValue = parseGuestCart(cart);
  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: cartValue.items.map((item) => item.snapshot.sku_id === skuId
      ? { ...item, selected: !item.selected }
      : item),
  };
}

export function selectAllGuestCartItems(cart: GuestCart, selected: boolean): GuestCart {
  const cartValue = parseGuestCart(cart);
  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: cartValue.items.map((item) => ({ ...item, selected })),
  };
}

export function removeGuestCartItem(cart: GuestCart, skuId: string): GuestCart {
  const cartValue = parseGuestCart(cart);
  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: cartValue.items.filter((item) => item.snapshot.sku_id !== skuId),
  };
}
