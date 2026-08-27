import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export interface StoreFavoriteListQuery {
  keyword?: string;
  page: number;
  pageSize: number;
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid('Query must be an object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid('Query must be a plain object');
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

function normalizedKeyword(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') return invalid('keyword is invalid');
  const keyword = value.trim();
  const length = Array.from(keyword).length;
  if (length < 1 || length > 200) return invalid('keyword is invalid');
  return keyword;
}

export function parseStoreFavoriteListQuery(value: unknown): StoreFavoriteListQuery {
  const query = plainRecord(value);
  const allowed = new Set(['page', 'page_size', 'keyword']);
  if (Object.keys(query).some((field) => !allowed.has(field))) {
    return invalid('Query fields are invalid');
  }

  const input: StoreFavoriteListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  const keyword = normalizedKeyword(query.keyword);
  if (keyword !== undefined) input.keyword = keyword;
  return input;
}

export function parseStoreFavoriteProductId(value: string): string {
  if (!isValidUlid(value)) return invalid('product_id is invalid');
  return value;
}
