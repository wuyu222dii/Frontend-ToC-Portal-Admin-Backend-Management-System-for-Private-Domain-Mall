import type {
  Favorite,
  FavoriteList,
  FavoriteProduct,
  FavoriteState,
  StoreAddressDetail,
  StoreAddressSummary,
  StoreCart,
  StoreCartItem,
} from '../types/store-shopping';
import { StoreEnvelopeFormatError } from './store-client';

type RecordValue = Record<string, unknown>;

const ulidPattern = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const nonNegativeMoneyPattern = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const positiveMoneyPattern = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const phonePattern = /^[0-9]{11}$/;
const cartStatuses = new Set([
  'SALEABLE', 'INSUFFICIENT_STOCK', 'OUT_OF_STOCK', 'INACTIVE', 'DELETED',
]);
const favoriteStatuses = new Set(['SALEABLE', 'OUT_OF_STOCK', 'UNAVAILABLE']);

function invalid(): never {
  throw new StoreEnvelopeFormatError();
}

function record(value: unknown, required: readonly string[]): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) invalid();
  const current = value as RecordValue;
  const keys = Object.keys(current);
  if (keys.length !== required.length || !required.every((key) => Object.hasOwn(current, key))) {
    invalid();
  }
  return current;
}

function text(value: unknown, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) invalid();
  return value;
}

function ulid(value: unknown): string {
  const current = text(value, 26, 26);
  if (!ulidPattern.test(current)) invalid();
  return current;
}

function integer(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) invalid();
  return value as number;
}

function booleanValue(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function money(value: unknown, positive = false): string {
  const current = text(value);
  if (!(positive ? positiveMoneyPattern : nonNegativeMoneyPattern).test(current)) invalid();
  return current;
}

function absoluteUrl(value: unknown): string {
  const current = text(value, 1, 2_048);
  const match = /^https?:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#][^\s]*)?$/i
    .exec(current);
  if (!match) invalid();
  if (match[1] !== undefined) {
    const port = Number(match[1]);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) invalid();
  }
  return current;
}

function dateTime(value: unknown): string {
  const current = text(value);
  if (!Number.isFinite(Date.parse(current))) invalid();
  return current;
}

function nullable<T>(value: unknown, decoder: (input: unknown) => T): T | null {
  return value === null ? null : decoder(value);
}

function skuSpec(value: unknown): StoreCartItem['spec_json'] {
  if (value === null) return null;
  const current = record(value, ['attributes']);
  if (!Array.isArray(current.attributes)) invalid();
  const attributes = current.attributes.map((entry) => {
    const attribute = record(entry, ['name', 'value']);
    return { name: text(attribute.name), value: text(attribute.value) };
  });
  return { attributes };
}

export function decodeFavoriteProduct(value: unknown): FavoriteProduct {
  const current = record(value, [
    'product_id', 'name', 'primary_image_url', 'minimum_active_price', 'is_salable', 'availability',
  ]);
  const availability = text(current.availability);
  if (!favoriteStatuses.has(availability)) invalid();
  const result: FavoriteProduct = {
    product_id: ulid(current.product_id),
    name: text(current.name, 1, 200),
    primary_image_url: nullable(current.primary_image_url, absoluteUrl),
    minimum_active_price: nullable(current.minimum_active_price, (entry) => money(entry, true)),
    is_salable: booleanValue(current.is_salable),
    availability: availability as FavoriteProduct['availability'],
  };
  if (result.availability === 'UNAVAILABLE' && result.is_salable) invalid();
  if (result.availability === 'SALEABLE' && !result.is_salable) invalid();
  return result;
}

function decodeFavorite(value: unknown): Favorite {
  const current = record(value, ['favorite_id', 'created_at', 'product']);
  return {
    favorite_id: ulid(current.favorite_id),
    created_at: dateTime(current.created_at),
    product: decodeFavoriteProduct(current.product),
  };
}

export function decodeFavoriteList(value: unknown): FavoriteList {
  const current = record(value, ['items', 'pagination']);
  if (!Array.isArray(current.items)) invalid();
  const pagination = record(current.pagination, ['page', 'page_size', 'total']);
  return {
    items: current.items.map(decodeFavorite),
    pagination: {
      page: integer(pagination.page, 1),
      page_size: integer(pagination.page_size, 1, 100),
      total: integer(pagination.total, 0),
    },
  };
}

export function decodeFavoriteState(value: unknown): FavoriteState {
  const current = record(value, ['product_id', 'is_favorite']);
  return { product_id: ulid(current.product_id), is_favorite: booleanValue(current.is_favorite) };
}

export function decodeStoreCartItem(value: unknown): StoreCartItem {
  const current = record(value, [
    'sku_id', 'product_id', 'product_name', 'sku_name', 'spec_json', 'primary_image_url',
    'quantity', 'selected', 'retail_price', 'available_stock', 'sale_status',
  ]);
  const saleStatus = text(current.sale_status);
  if (!cartStatuses.has(saleStatus)) invalid();
  return {
    sku_id: ulid(current.sku_id),
    product_id: ulid(current.product_id),
    product_name: text(current.product_name),
    sku_name: text(current.sku_name),
    spec_json: skuSpec(current.spec_json),
    primary_image_url: nullable(current.primary_image_url, absoluteUrl),
    quantity: integer(current.quantity, 1, 99),
    selected: booleanValue(current.selected),
    retail_price: money(current.retail_price, true),
    available_stock: integer(current.available_stock, 0),
    sale_status: saleStatus as StoreCartItem['sale_status'],
  };
}

export function decodeStoreCart(value: unknown): StoreCart {
  const current = record(value, ['cart_id', 'items', 'total_amount']);
  if (!Array.isArray(current.items)) invalid();
  const items = current.items.map(decodeStoreCartItem);
  const cartId = nullable(current.cart_id, ulid);
  if (cartId === null && items.length > 0) invalid();
  return { cart_id: cartId, items, total_amount: money(current.total_amount) };
}

export function decodeStoreAddressSummary(value: unknown): StoreAddressSummary {
  const current = record(value, [
    'address_id', 'recipient_name_masked', 'phone_masked', 'province', 'city', 'district',
    'detail_masked', 'is_default', 'version',
  ]);
  return {
    address_id: ulid(current.address_id),
    recipient_name_masked: text(current.recipient_name_masked),
    phone_masked: text(current.phone_masked),
    province: text(current.province, 1, 80),
    city: text(current.city, 1, 80),
    district: text(current.district, 1, 80),
    detail_masked: text(current.detail_masked),
    is_default: booleanValue(current.is_default),
    version: integer(current.version, 1),
  };
}

export function decodeStoreAddressList(value: unknown): StoreAddressSummary[] {
  if (!Array.isArray(value)) invalid();
  return value.map(decodeStoreAddressSummary);
}

export function decodeStoreAddressDetail(value: unknown): StoreAddressDetail {
  const current = record(value, [
    'address_id', 'recipient_name', 'phone', 'province', 'city', 'district', 'detail',
    'is_default', 'version',
  ]);
  const phone = text(current.phone, 11, 11);
  if (!phonePattern.test(phone)) invalid();
  return {
    address_id: ulid(current.address_id),
    recipient_name: text(current.recipient_name, 1, 80),
    phone,
    province: text(current.province, 1, 80),
    city: text(current.city, 1, 80),
    district: text(current.district, 1, 80),
    detail: text(current.detail, 1, 300),
    is_default: booleanValue(current.is_default),
    version: integer(current.version, 1),
  };
}
