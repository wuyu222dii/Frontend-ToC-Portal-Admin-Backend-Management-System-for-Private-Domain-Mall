import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const PRODUCT_SORTS = [
  'COMPREHENSIVE',
  'HOT',
  'NEWEST',
  'PRICE_ASC',
  'PRICE_DESC',
] as const;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type StoreProductSort = (typeof PRODUCT_SORTS)[number];

export interface StoreProductListInput {
  brandId?: string;
  categoryId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  sort: StoreProductSort;
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(`${label} must be a plain object`);
  }
  return value as PlainRecord;
}

function positiveInteger(
  value: unknown,
  fallback: number,
  maximum: number,
  field: string,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) {
    return invalid(`${field} is invalid`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function optionalUlid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function productSort(value: unknown): StoreProductSort {
  if (value === undefined) return 'COMPREHENSIVE';
  if (typeof value !== 'string' || !(PRODUCT_SORTS as readonly string[]).includes(value)) {
    return invalid('sort is invalid');
  }
  return value as StoreProductSort;
}

function normalizedKeyword(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return invalid('keyword is invalid');
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 1 || length > 200) return invalid('keyword is invalid');
  return normalized;
}

export function parseStoreEmptyQuery(value: unknown): void {
  const query = plainRecord(value, 'Query');
  if (Object.keys(query).length !== 0) return invalid('Query fields are invalid');
}

export function parseStoreProductId(value: string): string {
  if (!isValidUlid(value)) return invalid('product_id is invalid');
  return value;
}

export function parseStoreProductListQuery(value: unknown): StoreProductListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['page', 'page_size', 'keyword', 'brand_id', 'category_id', 'sort']);
  if (Object.keys(query).some((field) => !allowed.has(field))) {
    return invalid('Query fields are invalid');
  }

  const input: StoreProductListInput = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
    sort: productSort(query.sort),
  };
  const keyword = normalizedKeyword(query.keyword);
  const brandId = optionalUlid(query.brand_id, 'brand_id');
  const categoryId = optionalUlid(query.category_id, 'category_id');
  if (keyword !== undefined) input.keyword = keyword;
  if (brandId !== undefined) input.brandId = brandId;
  if (categoryId !== undefined) input.categoryId = categoryId;
  return input;
}
