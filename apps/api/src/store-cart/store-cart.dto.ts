import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

export interface StoreCartItemWriteRequest {
  quantity: number;
  selected: boolean;
}

export interface StoreCartMergeItemRequest extends StoreCartItemWriteRequest {
  skuId: string;
}

export interface StoreCartMergeRequest {
  items: StoreCartMergeItemRequest[];
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function exactObject(value: unknown, required: readonly string[]): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Request body must be an object');
  }
  const body = value as PlainRecord;
  const allowed = new Set(required);
  if (required.some((field) => !Object.prototype.hasOwnProperty.call(body, field)) ||
    Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function quantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 99) {
    return invalid('quantity is invalid');
  }
  return value;
}

function selected(value: unknown): boolean {
  if (typeof value !== 'boolean') return invalid('selected is invalid');
  return value;
}

export function parseStoreCartSkuId(value: string): string {
  if (!isValidUlid(value)) return invalid('sku_id is invalid');
  return value;
}

export function parseStoreCartItemWriteBody(value: unknown): StoreCartItemWriteRequest {
  const body = exactObject(value, ['quantity', 'selected']);
  return {
    quantity: quantity(body.quantity),
    selected: selected(body.selected),
  };
}

function mergeItem(value: unknown): StoreCartMergeItemRequest {
  const body = exactObject(value, ['sku_id', 'quantity', 'selected']);
  if (typeof body.sku_id !== 'string') return invalid('sku_id is invalid');
  return {
    quantity: quantity(body.quantity),
    selected: selected(body.selected),
    skuId: parseStoreCartSkuId(body.sku_id),
  };
}

export function parseStoreCartMergeBody(value: unknown): StoreCartMergeRequest {
  const body = exactObject(value, ['items']);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    return invalid('items is invalid');
  }

  const items = Array.from(body.items, mergeItem);
  if (new Set(items.map(({ skuId }) => skuId)).size !== items.length) {
    return invalid('sku_id values must be unique');
  }
  return { items };
}
