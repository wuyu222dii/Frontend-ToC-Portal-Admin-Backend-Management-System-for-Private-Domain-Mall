import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

export type StoreCheckoutSource = 'CART' | 'BUY_NOW';

export interface StoreCheckoutLineRequest {
  quantity: number;
  skuId: string;
}

export interface StoreCheckoutQuoteRequest {
  addressId: string;
  items: StoreCheckoutLineRequest[];
  source: StoreCheckoutSource;
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function exactObject(value: unknown, fields: readonly string[], label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid(`${label} must be an object`);
  }
  const record = value as PlainRecord;
  const expected = new Set(fields);
  if (fields.some((field) => !Object.prototype.hasOwnProperty.call(record, field)) ||
    Object.keys(record).some((field) => !expected.has(field))) {
    return invalid(`${label} fields are invalid`);
  }
  return record;
}

function line(value: unknown): StoreCheckoutLineRequest {
  const item = exactObject(value, ['sku_id', 'quantity'], 'items entry');
  if (typeof item.sku_id !== 'string' || !isValidUlid(item.sku_id)) {
    return invalid('sku_id is invalid');
  }
  if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) ||
    item.quantity < 1 || item.quantity > 99) {
    return invalid('quantity is invalid');
  }
  return { quantity: item.quantity, skuId: item.sku_id };
}

export function parseStoreCheckoutQuoteBody(value: unknown): StoreCheckoutQuoteRequest {
  const body = exactObject(value, ['source', 'address_id', 'items'], 'Request body');
  if (body.source !== 'CART' && body.source !== 'BUY_NOW') return invalid('source is invalid');
  if (typeof body.address_id !== 'string' || !isValidUlid(body.address_id)) {
    return invalid('address_id is invalid');
  }
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    return invalid('items is invalid');
  }
  const items = body.items.map(line);
  if (new Set(items.map(({ skuId }) => skuId)).size !== items.length) {
    return invalid('sku_id values must be unique');
  }
  if (body.source === 'BUY_NOW' && items.length !== 1) {
    return invalid('BUY_NOW requires exactly one item');
  }
  return { addressId: body.address_id, items, source: body.source };
}
