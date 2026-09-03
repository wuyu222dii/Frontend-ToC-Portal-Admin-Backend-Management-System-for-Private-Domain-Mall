import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export interface AgentProductListInput {
  brandId?: string;
  categoryId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  recommended?: boolean;
}

export interface CreatePromotionAssetInput {
  targetId: string | null;
  targetType: 'PRODUCT' | 'STOREFRONT';
}

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function record(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid(`${label} must be a plain object`);
  return value as PlainRecord;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function optionalUlid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

export function parseAgentProductId(value: string): string {
  if (!isValidUlid(value)) return invalid('product_id is invalid');
  return value;
}

export function parseAgentEmptyQuery(value: unknown): void {
  if (Object.keys(record(value, 'Query')).length !== 0) return invalid('Query fields are invalid');
}

export function parseAgentProductListQuery(value: unknown): AgentProductListInput {
  const query = record(value, 'Query');
  const allowed = new Set(['page', 'page_size', 'keyword', 'brand_id', 'category_id', 'recommended']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const input: AgentProductListInput = {
    page: positiveInteger(query.page, 1, 2_147_483_647, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if (query.keyword !== undefined) {
    if (typeof query.keyword !== 'string') return invalid('keyword is invalid');
    const keyword = query.keyword.trim();
    if (Array.from(keyword).length < 1 || Array.from(keyword).length > 200) return invalid('keyword is invalid');
    input.keyword = keyword;
  }
  const brandId = optionalUlid(query.brand_id, 'brand_id');
  const categoryId = optionalUlid(query.category_id, 'category_id');
  if (brandId !== undefined) input.brandId = brandId;
  if (categoryId !== undefined) input.categoryId = categoryId;
  if (query.recommended !== undefined) {
    if (query.recommended !== 'true' && query.recommended !== 'false') return invalid('recommended is invalid');
    input.recommended = query.recommended === 'true';
  }
  return input;
}

export function parseCreatePromotionAssetBody(value: unknown): CreatePromotionAssetInput {
  const body = record(value, 'Request body');
  const keys = Object.keys(body);
  if (!Object.hasOwn(body, 'target_type') || keys.some((key) => key !== 'target_type' && key !== 'target_id')) {
    return invalid('Request body fields are invalid');
  }
  if (body.target_type === 'STOREFRONT') {
    if (body.target_id !== undefined && body.target_id !== null) return invalid('target_id is invalid');
    return { targetId: null, targetType: 'STOREFRONT' };
  }
  if (body.target_type === 'PRODUCT') {
    if (typeof body.target_id !== 'string' || !isValidUlid(body.target_id)) return invalid('target_id is invalid');
    return { targetId: body.target_id, targetType: 'PRODUCT' };
  }
  return invalid('target_type is invalid');
}
