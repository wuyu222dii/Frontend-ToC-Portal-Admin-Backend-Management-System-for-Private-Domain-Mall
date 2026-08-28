import { createIdempotencyKey, getCustomerProfile } from '../api/store-identity';
import { mergeStoreCart } from '../api/store-shopping';
import type { CartMergeInput, StoreCart } from '../types/store-shopping';
import { customerSessionRevision } from './customer-session';
import {
  GUEST_CART_SCHEMA_VERSION,
  GUEST_CART_STORAGE_KEY,
  saveGuestCart,
  type GuestCart,
  type GuestCartItem,
  type GuestCartItemSnapshot,
} from './guest-cart';

export const GUEST_CART_MERGE_JOURNAL_STORAGE_KEY = 'qingxu:store-cart-merge-journal';
export const GUEST_CART_MERGE_JOURNAL_SCHEMA_VERSION = 1 as const;
export const GUEST_CART_MERGE_ITEM_LIMIT = 100;

export interface GuestCartMergeJournal {
  readonly schema_version: typeof GUEST_CART_MERGE_JOURNAL_SCHEMA_VERSION;
  readonly customer_id: string;
  readonly idempotency_key: string;
  readonly items: readonly GuestCartItem[];
}

export interface GuestCartMergeCommand {
  readonly idempotencyKey: string;
  readonly input: CartMergeInput;
}

export type GuestCartMergeJournalErrorCode =
  | 'CUSTOMER_MISMATCH'
  | 'INVALID_CUSTOMER_ID'
  | 'INVALID_GUEST_CART'
  | 'INVALID_JOURNAL'
  | 'JOURNAL_CHANGED'
  | 'JOURNAL_NOT_FOUND'
  | 'STORAGE_UNAVAILABLE';

export class GuestCartMergeJournalError extends Error {
  constructor(readonly code: GuestCartMergeJournalErrorCode, message: string) {
    super(message);
    this.name = 'GuestCartMergeJournalError';
  }
}

type PlainRecord = Record<string, unknown>;

const MONEY_PATTERN = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let confirmedSnapshots: {
  customer_id: string;
  idempotency_key: string;
  items: GuestCartItem[];
  session_revision: number;
} | null = null;

function invalid(code: GuestCartMergeJournalErrorCode, message: string): never {
  throw new GuestCartMergeJournalError(code, message);
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

function decodedStorageValue(
  value: unknown,
  code: 'INVALID_GUEST_CART' | 'INVALID_JOURNAL',
): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return invalid(code, 'Stored cart merge data is not valid JSON');
  }
}

function storageValue(key: string): unknown {
  try {
    return uni.getStorageSync(key) as unknown;
  } catch {
    return invalid('STORAGE_UNAVAILABLE', `Unable to read local storage key ${key}`);
  }
}

function setStorageValue(key: string, value: unknown): void {
  try {
    uni.setStorageSync(key, value);
  } catch {
    invalid('STORAGE_UNAVAILABLE', `Unable to write local storage key ${key}`);
  }
}

function removeStorageValue(key: string): void {
  try {
    uni.removeStorageSync(key);
  } catch {
    invalid('STORAGE_UNAVAILABLE', `Unable to remove local storage key ${key}`);
  }
}

function isMissingStorageValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function validUlid(value: unknown): value is string {
  return typeof value === 'string' && ULID_PATTERN.test(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseSnapshot(
  value: unknown,
  code: 'INVALID_GUEST_CART' | 'INVALID_JOURNAL',
): GuestCartItemSnapshot {
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
    return invalid(code, 'Cart item snapshot shape is invalid');
  }
  if (!validUlid(value.product_id) || !validUlid(value.sku_id) ||
    !nonEmptyString(value.product_name) || !nonEmptyString(value.sku_name) ||
    !nonEmptyString(value.spec_label) ||
    (value.image_url !== null && !nonEmptyString(value.image_url)) ||
    typeof value.retail_price !== 'string' || !MONEY_PATTERN.test(value.retail_price) ||
    !Number.isInteger(value.available_stock) || Number(value.available_stock) < 0 ||
    typeof value.is_salable !== 'boolean') {
    return invalid(code, 'Cart item snapshot values are invalid');
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

function parseItem(
  value: unknown,
  code: 'INVALID_GUEST_CART' | 'INVALID_JOURNAL',
): GuestCartItem {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['quantity', 'selected', 'snapshot']) ||
    !Number.isInteger(value.quantity) || Number(value.quantity) < 1 ||
    Number(value.quantity) > 99 || typeof value.selected !== 'boolean') {
    return invalid(code, 'Cart item values are invalid');
  }
  return {
    quantity: Number(value.quantity),
    selected: value.selected,
    snapshot: parseSnapshot(value.snapshot, code),
  };
}

function parseItems(
  value: unknown,
  code: 'INVALID_GUEST_CART' | 'INVALID_JOURNAL',
): GuestCartItem[] {
  if (!Array.isArray(value) || value.length > GUEST_CART_MERGE_ITEM_LIMIT) {
    return invalid(code, 'Cart merge items must contain at most 100 rows');
  }
  const items = value.map((item) => parseItem(item, code));
  const skuIds = items.map((item) => item.snapshot.sku_id);
  if (new Set(skuIds).size !== skuIds.length) {
    return invalid(code, 'Cart merge SKU IDs must be unique');
  }
  return items;
}

function parseGuestCartForMerge(value: unknown): GuestCart {
  if (isMissingStorageValue(value)) {
    return { version: GUEST_CART_SCHEMA_VERSION, items: [] };
  }
  const decoded = decodedStorageValue(value, 'INVALID_GUEST_CART');
  if (!isPlainRecord(decoded) || !hasExactKeys(decoded, ['version', 'items']) ||
    decoded.version !== GUEST_CART_SCHEMA_VERSION) {
    return invalid('INVALID_GUEST_CART', 'Guest cart storage shape is invalid');
  }
  return {
    version: GUEST_CART_SCHEMA_VERSION,
    items: parseItems(decoded.items, 'INVALID_GUEST_CART'),
  };
}

function cloneItem(item: GuestCartItem): GuestCartItem {
  return { quantity: item.quantity, selected: item.selected, snapshot: { ...item.snapshot } };
}

function sameSnapshot(left: GuestCartItemSnapshot, right: GuestCartItemSnapshot): boolean {
  return left.product_id === right.product_id && left.product_name === right.product_name &&
    left.sku_id === right.sku_id && left.sku_name === right.sku_name &&
    left.spec_label === right.spec_label && left.image_url === right.image_url &&
    left.retail_price === right.retail_price && left.available_stock === right.available_stock &&
    left.is_salable === right.is_salable;
}

function sameItem(left: GuestCartItem, right: GuestCartItem): boolean {
  return left.quantity === right.quantity && left.selected === right.selected &&
    sameSnapshot(left.snapshot, right.snapshot);
}

function sameJournal(left: GuestCartMergeJournal, right: GuestCartMergeJournal): boolean {
  return left.schema_version === right.schema_version && left.customer_id === right.customer_id &&
    left.idempotency_key === right.idempotency_key && left.items.length === right.items.length &&
    left.items.every((item, index) => {
      const other = right.items[index];
      return other !== undefined && sameItem(item, other);
    });
}

function requireCustomerId(customerId: string): void {
  if (!validUlid(customerId)) invalid('INVALID_CUSTOMER_ID', 'Customer ID must be a ULID');
}

function requireCustomer(
  journal: GuestCartMergeJournal,
  customerId: string,
): void {
  if (journal.customer_id !== customerId) {
    invalid('CUSTOMER_MISMATCH', 'Cart merge journal belongs to another customer');
  }
}

export function parseGuestCartMergeJournal(value: unknown): GuestCartMergeJournal | null {
  if (isMissingStorageValue(value)) return null;
  const decoded = decodedStorageValue(value, 'INVALID_JOURNAL');
  if (!isPlainRecord(decoded) || !hasExactKeys(decoded, [
    'schema_version',
    'customer_id',
    'idempotency_key',
    'items',
  ]) || decoded.schema_version !== GUEST_CART_MERGE_JOURNAL_SCHEMA_VERSION ||
    !validUlid(decoded.customer_id) || typeof decoded.idempotency_key !== 'string' ||
    !UUID_V4_PATTERN.test(decoded.idempotency_key)) {
    return invalid('INVALID_JOURNAL', 'Cart merge journal shape is invalid');
  }
  const items = parseItems(decoded.items, 'INVALID_JOURNAL');
  if (items.length === 0) invalid('INVALID_JOURNAL', 'Cart merge journal cannot be empty');
  return {
    schema_version: GUEST_CART_MERGE_JOURNAL_SCHEMA_VERSION,
    customer_id: decoded.customer_id,
    idempotency_key: decoded.idempotency_key,
    items,
  };
}

export function loadGuestCartMergeJournal(): GuestCartMergeJournal | null {
  return parseGuestCartMergeJournal(storageValue(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY));
}

export function prepareGuestCartMergeJournal(
  customerId: string,
  guestCart?: GuestCart,
  idempotencyKey?: string,
): GuestCartMergeJournal | null {
  requireCustomerId(customerId);
  const existing = loadGuestCartMergeJournal();
  if (existing !== null) {
    requireCustomer(existing, customerId);
    return existing;
  }

  const cart = guestCart === undefined
    ? parseGuestCartForMerge(storageValue(GUEST_CART_STORAGE_KEY))
    : parseGuestCartForMerge(guestCart);
  if (cart.items.length === 0) return null;

  const key = idempotencyKey ?? createIdempotencyKey();
  if (!UUID_V4_PATTERN.test(key)) {
    invalid('INVALID_JOURNAL', 'Cart merge idempotency key must be a UUID v4');
  }
  const journal: GuestCartMergeJournal = {
    schema_version: GUEST_CART_MERGE_JOURNAL_SCHEMA_VERSION,
    customer_id: customerId,
    idempotency_key: key,
    items: cart.items.map(cloneItem),
  };
  setStorageValue(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY, journal);
  return journal;
}

export function guestCartMergeCommand(journalValue: GuestCartMergeJournal): GuestCartMergeCommand {
  const journal = parseGuestCartMergeJournal(journalValue);
  if (journal === null) invalid('INVALID_JOURNAL', 'Cart merge journal is missing');
  return {
    idempotencyKey: journal.idempotency_key,
    input: {
      items: journal.items.map((item) => ({
        sku_id: item.snapshot.sku_id,
        quantity: item.quantity,
        selected: item.selected,
      })),
    },
  };
}

function removeConfirmedItems(journal: GuestCartMergeJournal): void {
  const current = parseGuestCartForMerge(storageValue(GUEST_CART_STORAGE_KEY));
  const confirmedBySku = new Map(journal.items.map((item) => [item.snapshot.sku_id, item]));
  const remaining = current.items.filter((item) => {
    const confirmed = confirmedBySku.get(item.snapshot.sku_id);
    return confirmed === undefined || !sameItem(item, confirmed);
  });
  if (remaining.length !== current.items.length) {
    try {
      saveGuestCart({ version: GUEST_CART_SCHEMA_VERSION, items: remaining });
    } catch {
      invalid('STORAGE_UNAVAILABLE', 'Unable to remove confirmed guest cart items');
    }
  }
  removeStorageValue(GUEST_CART_MERGE_JOURNAL_STORAGE_KEY);
}

export async function executeGuestCartMergeJournal(
  customerId: string,
  expectedJournal?: GuestCartMergeJournal,
): Promise<StoreCart> {
  requireCustomerId(customerId);
  const journal = loadGuestCartMergeJournal();
  if (journal === null) invalid('JOURNAL_NOT_FOUND', 'Cart merge journal is missing');
  requireCustomer(journal, customerId);
  if (expectedJournal !== undefined && !sameJournal(journal, expectedJournal)) {
    invalid('JOURNAL_CHANGED', 'Cart merge journal changed before execution');
  }
  const command = guestCartMergeCommand(journal);
  const cart = await mergeStoreCart(command.input, command.idempotencyKey);
  removeConfirmedItems(journal);
  confirmedSnapshots = {
    customer_id: journal.customer_id,
    idempotency_key: journal.idempotency_key,
    items: journal.items.map(cloneItem),
    session_revision: customerSessionRevision(),
  };
  return cart;
}

export async function consumeConfirmedGuestCartMergeSnapshots(): Promise<GuestCartItem[]> {
  const batch = confirmedSnapshots;
  if (batch === null) return [];
  if (batch.session_revision !== customerSessionRevision()) {
    confirmedSnapshots = null;
    return [];
  }
  const profile = await getCustomerProfile();
  confirmedSnapshots = null;
  if (batch.customer_id !== profile.customer_id) return [];
  const snapshots = batch.items.map(cloneItem);
  return snapshots;
}

export async function resumeGuestCartMergeJournal(customerId: string): Promise<StoreCart | null> {
  requireCustomerId(customerId);
  const journal = loadGuestCartMergeJournal();
  if (journal === null) return null;
  requireCustomer(journal, customerId);
  return executeGuestCartMergeJournal(customerId, journal);
}

export async function prepareAndExecuteGuestCartMerge(
  customerId: string,
  guestCart?: GuestCart,
): Promise<StoreCart | null> {
  const journal = prepareGuestCartMergeJournal(customerId, guestCart);
  if (journal === null) return null;
  return executeGuestCartMergeJournal(customerId, journal);
}

export async function synchronizeGuestCartAfterAuthentication(): Promise<StoreCart | null> {
  const existingJournal = loadGuestCartMergeJournal();
  const guestCart = existingJournal === null
    ? parseGuestCartForMerge(storageValue(GUEST_CART_STORAGE_KEY))
    : null;
  if (existingJournal === null && guestCart?.items.length === 0) return null;
  const profile = await getCustomerProfile();
  return existingJournal === null
    ? prepareAndExecuteGuestCartMerge(profile.customer_id, guestCart ?? undefined)
    : resumeGuestCartMergeJournal(profile.customer_id);
}
