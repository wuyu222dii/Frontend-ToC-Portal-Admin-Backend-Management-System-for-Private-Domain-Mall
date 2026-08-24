import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const ENTITY_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
const LIFECYCLE_ACTIONS = ['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE'] as const;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;

export type ProductEntityStatus = (typeof ENTITY_STATUSES)[number];
export type ProductLifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export interface ProductImageInput {
  fileId: string;
  sortOrder: number;
}

export interface ProductListInput {
  brandId?: string;
  categoryId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  recommended?: boolean;
  status?: ProductEntityStatus;
}

export interface ProductCreateInput {
  brandId: string;
  categoryId: string;
  images: ProductImageInput[];
  ingredients?: string | null;
  initialStatus: 'DRAFT';
  introduction?: string | null;
  isHot?: boolean;
  isNew?: boolean;
  name: string;
  spuCode: string;
  subtitle?: string | null;
  usageMethod?: string | null;
}

export interface ProductUpdateInput {
  brandId?: string;
  categoryId?: string;
  images?: ProductImageInput[];
  ingredients?: string | null;
  introduction?: string | null;
  isHot?: boolean;
  isNew?: boolean;
  name?: string;
  subtitle?: string | null;
  usageMethod?: string | null;
}

export interface SkuSpec {
  attributes: Array<{ name: string; value: string }>;
}

export interface SkuCreateInput {
  code: string;
  initialStatus: 'INACTIVE';
  isRecommended?: boolean;
  name: string;
  retailPrice: string;
  specJson?: SkuSpec | null;
}

export interface SkuUpdateInput {
  isRecommended?: boolean;
  name?: string;
  retailPrice?: string;
  specJson?: SkuSpec | null;
}

export interface ProductLifecyclePreviewInput {
  action: ProductLifecycleAction;
  reason: string;
}

export interface ProductLifecycleConfirmationInput extends ProductLifecyclePreviewInput {
  confirmationHash: string;
  previewToken: string;
}

export interface ProductRestoreInput {
  reason: string;
}

export type SkuLifecyclePreviewInput = ProductLifecyclePreviewInput;
export type SkuLifecycleConfirmationInput = ProductLifecycleConfirmationInput;
export type SkuRestoreInput = ProductRestoreInput;

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

function closedBody(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): PlainRecord {
  const body = plainRecord(value, 'Request body');
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(body);
  if (required.some((field) => !Object.hasOwn(body, field)) ||
    keys.some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function boundedString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const length = Array.from(value).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return value;
}

function nonBlankString(value: unknown, field: string, maximum: number): string {
  const parsed = boundedString(value, field, 1, maximum);
  if (parsed.trim().length === 0) return invalid(`${field} is invalid`);
  return parsed;
}

function nullableString(value: unknown, field: string, maximum: number): string | null {
  return value === null ? null : boundedString(value, field, 0, maximum);
}

function booleanValue(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(`${field} is invalid`);
  return value;
}

function ulid(value: unknown, field: string): string {
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > POSTGRES_INTEGER_MAX) {
    return invalid(`${field} is invalid`);
  }
  return Number(value);
}

function optionalField<T>(
  body: PlainRecord,
  wireName: string,
  parse: (value: unknown) => T,
): { present: false } | { present: true; value: T } {
  if (!Object.hasOwn(body, wireName)) return { present: false };
  return { present: true, value: parse(body[wireName]) };
}

function productImages(value: unknown): ProductImageInput[] {
  if (!Array.isArray(value) || value.length > 8) return invalid('images is invalid');
  const fileIds = new Set<string>();
  const sortOrders = new Set<number>();
  return value.map((item) => {
    const image = plainRecord(item, 'images item');
    if (Object.keys(image).length !== 2 || !Object.hasOwn(image, 'file_id') ||
      !Object.hasOwn(image, 'sort_order')) return invalid('images item fields are invalid');
    const fileId = ulid(image.file_id, 'file_id');
    const sortOrder = nonNegativeInteger(image.sort_order, 'sort_order');
    if (fileIds.has(fileId) || sortOrders.has(sortOrder)) return invalid('images must be unique');
    fileIds.add(fileId);
    sortOrders.add(sortOrder);
    return { fileId, sortOrder };
  });
}

function skuSpec(value: unknown): SkuSpec | null {
  if (value === null) return null;
  const spec = plainRecord(value, 'spec_json');
  if (Object.keys(spec).length !== 1 || !Object.hasOwn(spec, 'attributes') ||
    !Array.isArray(spec.attributes) || spec.attributes.length === 0) {
    return invalid('spec_json is invalid');
  }
  const seen = new Set<string>();
  const attributes = spec.attributes.map((item) => {
    const attribute = plainRecord(item, 'spec_json attribute');
    if (Object.keys(attribute).length !== 2 || !Object.hasOwn(attribute, 'name') ||
      !Object.hasOwn(attribute, 'value')) return invalid('spec_json attribute fields are invalid');
    const name = nonBlankString(attribute.name, 'spec_json.attributes.name', 80);
    const parsedValue = nonBlankString(attribute.value, 'spec_json.attributes.value', 160);
    const identity = JSON.stringify([name, parsedValue]);
    if (seen.has(identity)) return invalid('spec_json attributes must be unique');
    seen.add(identity);
    return { name, value: parsedValue };
  });
  return { attributes };
}

function money(value: unknown): string {
  if (typeof value !== 'string' || !POSITIVE_MONEY.test(value)) {
    return invalid('retail_price is invalid');
  }
  return value;
}

function lifecycleAction(value: unknown): ProductLifecycleAction {
  if (typeof value !== 'string' || !(LIFECYCLE_ACTIONS as readonly string[]).includes(value)) {
    return invalid('action is invalid');
  }
  return value as ProductLifecycleAction;
}

function lifecycleReason(value: unknown): string {
  return boundedString(value, 'reason', 2, 500);
}

function parseLifecyclePreview(value: unknown): ProductLifecyclePreviewInput {
  const body = closedBody(value, ['action', 'reason']);
  return { action: lifecycleAction(body.action), reason: lifecycleReason(body.reason) };
}

function parseLifecycleConfirmation(value: unknown): ProductLifecycleConfirmationInput {
  const body = closedBody(value, ['action', 'reason', 'preview_token', 'confirmation_hash']);
  const confirmationHash = boundedString(body.confirmation_hash, 'confirmation_hash', 64, 64);
  if (!/^[a-f0-9]{64}$/.test(confirmationHash)) return invalid('confirmation_hash is invalid');
  return {
    action: lifecycleAction(body.action),
    confirmationHash,
    previewToken: boundedString(body.preview_token, 'preview_token', 16, 512),
    reason: lifecycleReason(body.reason),
  };
}

function parseRestore(value: unknown): ProductRestoreInput {
  const body = closedBody(value, ['reason']);
  return { reason: lifecycleReason(body.reason) };
}

function assignOptional<T extends object, K extends keyof T>(
  output: T,
  key: K,
  field: { present: false } | { present: true; value: T[K] },
): void {
  if (field.present) output[key] = field.value;
}

export function parseProductId(value: string, field = 'resource_id'): string {
  return ulid(value, field);
}

export function parseProductListQuery(value: unknown): ProductListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set([
    'brand_id', 'category_id', 'keyword', 'page', 'page_size', 'recommended', 'status',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const positiveInteger = (raw: unknown, fallback: number, maximum: number, field: string): number => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return invalid(`${field} is invalid`);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
    return parsed;
  };
  const output: ProductListInput = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if (query.brand_id !== undefined) output.brandId = ulid(query.brand_id, 'brand_id');
  if (query.category_id !== undefined) output.categoryId = ulid(query.category_id, 'category_id');
  if (query.keyword !== undefined) output.keyword = nonBlankString(query.keyword, 'keyword', 200);
  if (query.recommended !== undefined) {
    if (query.recommended !== 'true' && query.recommended !== 'false') return invalid('recommended is invalid');
    output.recommended = query.recommended === 'true';
  }
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !(ENTITY_STATUSES as readonly string[]).includes(query.status)) {
      return invalid('status is invalid');
    }
    output.status = query.status as ProductEntityStatus;
  }
  return output;
}

export function parseProductCreateBody(value: unknown): ProductCreateInput {
  const body = closedBody(
    value,
    ['spu_code', 'name', 'brand_id', 'category_id', 'initial_status', 'images'],
    ['subtitle', 'introduction', 'ingredients', 'usage_method', 'is_hot', 'is_new'],
  );
  if (body.initial_status !== 'DRAFT') return invalid('initial_status must be DRAFT');
  const output: ProductCreateInput = {
    brandId: ulid(body.brand_id, 'brand_id'),
    categoryId: ulid(body.category_id, 'category_id'),
    images: productImages(body.images),
    initialStatus: 'DRAFT',
    name: nonBlankString(body.name, 'name', 200),
    spuCode: nonBlankString(body.spu_code, 'spu_code', 80),
  };
  assignOptional(output, 'subtitle', optionalField(body, 'subtitle', (input) => nullableString(input, 'subtitle', 300)));
  assignOptional(output, 'introduction', optionalField(body, 'introduction', (input) => nullableString(input, 'introduction', 5_000)));
  assignOptional(output, 'ingredients', optionalField(body, 'ingredients', (input) => nullableString(input, 'ingredients', 10_000)));
  assignOptional(output, 'usageMethod', optionalField(body, 'usage_method', (input) => nullableString(input, 'usage_method', 5_000)));
  assignOptional(output, 'isHot', optionalField(body, 'is_hot', (input) => booleanValue(input, 'is_hot')));
  assignOptional(output, 'isNew', optionalField(body, 'is_new', (input) => booleanValue(input, 'is_new')));
  return output;
}

export function parseProductUpdateBody(value: unknown): ProductUpdateInput {
  const body = closedBody(value, [], [
    'name', 'brand_id', 'category_id', 'subtitle', 'introduction', 'ingredients', 'usage_method',
    'is_hot', 'is_new', 'images',
  ]);
  if (Object.keys(body).length === 0) return invalid('Product update must contain at least one field');
  const output: ProductUpdateInput = {};
  assignOptional(output, 'name', optionalField(body, 'name', (input) => nonBlankString(input, 'name', 200)));
  assignOptional(output, 'brandId', optionalField(body, 'brand_id', (input) => ulid(input, 'brand_id')));
  assignOptional(output, 'categoryId', optionalField(body, 'category_id', (input) => ulid(input, 'category_id')));
  assignOptional(output, 'subtitle', optionalField(body, 'subtitle', (input) => nullableString(input, 'subtitle', 300)));
  assignOptional(output, 'introduction', optionalField(body, 'introduction', (input) => nullableString(input, 'introduction', 5_000)));
  assignOptional(output, 'ingredients', optionalField(body, 'ingredients', (input) => nullableString(input, 'ingredients', 10_000)));
  assignOptional(output, 'usageMethod', optionalField(body, 'usage_method', (input) => nullableString(input, 'usage_method', 5_000)));
  assignOptional(output, 'isHot', optionalField(body, 'is_hot', (input) => booleanValue(input, 'is_hot')));
  assignOptional(output, 'isNew', optionalField(body, 'is_new', (input) => booleanValue(input, 'is_new')));
  assignOptional(output, 'images', optionalField(body, 'images', productImages));
  return output;
}

export function parseSkuCreateBody(value: unknown): SkuCreateInput {
  const body = closedBody(
    value,
    ['code', 'name', 'retail_price', 'initial_status'],
    ['spec_json', 'is_recommended'],
  );
  if (body.initial_status !== 'INACTIVE') return invalid('initial_status must be INACTIVE');
  const output: SkuCreateInput = {
    code: nonBlankString(body.code, 'code', 80),
    initialStatus: 'INACTIVE',
    name: nonBlankString(body.name, 'name', 160),
    retailPrice: money(body.retail_price),
  };
  assignOptional(output, 'specJson', optionalField(body, 'spec_json', skuSpec));
  assignOptional(output, 'isRecommended', optionalField(body, 'is_recommended', (input) => booleanValue(input, 'is_recommended')));
  return output;
}

export function parseSkuUpdateBody(value: unknown): SkuUpdateInput {
  const body = closedBody(value, [], ['name', 'spec_json', 'retail_price', 'is_recommended']);
  if (Object.keys(body).length === 0) return invalid('SKU update must contain at least one field');
  const output: SkuUpdateInput = {};
  assignOptional(output, 'name', optionalField(body, 'name', (input) => nonBlankString(input, 'name', 160)));
  assignOptional(output, 'specJson', optionalField(body, 'spec_json', skuSpec));
  assignOptional(output, 'retailPrice', optionalField(body, 'retail_price', money));
  assignOptional(output, 'isRecommended', optionalField(body, 'is_recommended', (input) => booleanValue(input, 'is_recommended')));
  return output;
}

export function parseProductLifecyclePreviewBody(value: unknown): ProductLifecyclePreviewInput {
  return parseLifecyclePreview(value);
}

export function parseProductLifecycleConfirmationBody(value: unknown): ProductLifecycleConfirmationInput {
  return parseLifecycleConfirmation(value);
}

export function parseProductRestoreBody(value: unknown): ProductRestoreInput {
  return parseRestore(value);
}

export function parseSkuLifecyclePreviewBody(value: unknown): SkuLifecyclePreviewInput {
  return parseLifecyclePreview(value);
}

export function parseSkuLifecycleConfirmationBody(value: unknown): SkuLifecycleConfirmationInput {
  return parseLifecycleConfirmation(value);
}

export function parseSkuRestoreBody(value: unknown): SkuRestoreInput {
  return parseRestore(value);
}
