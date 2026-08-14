import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const ENTITY_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
const LIFECYCLE_ACTIONS = ['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE'] as const;
const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type CatalogEntityStatus = (typeof ENTITY_STATUSES)[number];
export type MasterDataLifecycleAction = (typeof LIFECYCLE_ACTIONS)[number];

export interface CatalogListInput {
  keyword?: string;
  page: number;
  pageSize: number;
  status?: CatalogEntityStatus;
}

export interface BrandCreateInput {
  description?: string | null;
  initialStatus: 'DRAFT';
  logoFileId?: string | null;
  name: string;
  sortOrder: number;
}

export interface BrandUpdateInput {
  description?: string | null;
  logoFileId?: string | null;
  name?: string;
  sortOrder?: number;
}

export interface CategoryCreateInput {
  iconFileId?: string | null;
  initialStatus: 'DRAFT';
  name: string;
  sortOrder: number;
}

export interface CategoryUpdateInput {
  iconFileId?: string | null;
  name?: string;
  sortOrder?: number;
}

export interface LifecyclePreviewInput {
  action: MasterDataLifecycleAction;
  reason: string;
}

export interface LifecycleConfirmationInput extends LifecyclePreviewInput {
  confirmationHash: string;
  previewToken: string;
}

export interface RestoreInput {
  reason: string;
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

function codePointLength(value: string): number {
  return Array.from(value).length;
}

function boundedString(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const length = codePointLength(value);
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return value;
}

function nonBlankBoundedString(value: unknown, field: string, maximum: number): string {
  const parsed = boundedString(value, field, 1, maximum);
  if (parsed.trim().length === 0) return invalid(`${field} is invalid`);
  return parsed;
}

function nullableBoundedString(value: unknown, field: string, maximum: number): string | null {
  if (value === null) return null;
  return boundedString(value, field, 0, maximum);
}

function fileId(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function sortOrder(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > POSTGRES_INTEGER_MAX) {
    return invalid('sort_order is invalid');
  }
  return Number(value);
}

function lifecycleAction(value: unknown): MasterDataLifecycleAction {
  if (typeof value !== 'string' || !(LIFECYCLE_ACTIONS as readonly string[]).includes(value)) {
    return invalid('action is invalid');
  }
  return value as MasterDataLifecycleAction;
}

function reason(value: unknown): string {
  return boundedString(value, 'reason', 2, 500);
}

function optionalField<T>(
  body: PlainRecord,
  wireName: string,
  parse: (value: unknown) => T,
): { present: false } | { present: true; value: T } {
  if (!Object.hasOwn(body, wireName)) return { present: false };
  return { present: true, value: parse(body[wireName]) };
}

export function parseCatalogId(value: string, field = 'resource_id'): string {
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

export function parseCatalogListQuery(value: unknown): CatalogListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['keyword', 'page', 'page_size', 'status']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');

  const positiveInteger = (raw: unknown, fallback: number, maximum: number, field: string): number => {
    if (raw === undefined) return fallback;
    if (typeof raw !== 'string' || !/^[1-9][0-9]*$/.test(raw)) return invalid(`${field} is invalid`);
    const parsed = Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
    return parsed;
  };

  const page = positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page');
  const pageSize = positiveInteger(query.page_size, 20, 100, 'page_size');
  const output: CatalogListInput = { page, pageSize };
  if (query.keyword !== undefined) {
    if (typeof query.keyword !== 'string' || query.keyword.length === 0 || query.keyword.trim().length === 0) {
      return invalid('keyword is invalid');
    }
    output.keyword = query.keyword;
  }
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !(ENTITY_STATUSES as readonly string[]).includes(query.status)) {
      return invalid('status is invalid');
    }
    output.status = query.status as CatalogEntityStatus;
  }
  return output;
}

export function parseBrandCreateBody(value: unknown): BrandCreateInput {
  const body = closedBody(value, ['name', 'sort_order', 'initial_status'], ['logo_file_id', 'description']);
  if (body.initial_status !== 'DRAFT') return invalid('initial_status must be DRAFT');
  const output: BrandCreateInput = {
    initialStatus: 'DRAFT',
    name: nonBlankBoundedString(body.name, 'name', 120),
    sortOrder: sortOrder(body.sort_order),
  };
  const logo = optionalField(body, 'logo_file_id', (input) => fileId(input, 'logo_file_id'));
  const description = optionalField(body, 'description', (input) => nullableBoundedString(input, 'description', 500));
  if (logo.present) output.logoFileId = logo.value;
  if (description.present) output.description = description.value;
  return output;
}

export function parseBrandUpdateBody(value: unknown): BrandUpdateInput {
  const body = closedBody(value, [], ['name', 'logo_file_id', 'description', 'sort_order']);
  if (Object.keys(body).length === 0) return invalid('Brand update must contain at least one field');
  const output: BrandUpdateInput = {};
  const name = optionalField(body, 'name', (input) => nonBlankBoundedString(input, 'name', 120));
  const logo = optionalField(body, 'logo_file_id', (input) => fileId(input, 'logo_file_id'));
  const description = optionalField(body, 'description', (input) => nullableBoundedString(input, 'description', 500));
  const order = optionalField(body, 'sort_order', sortOrder);
  if (name.present) output.name = name.value;
  if (logo.present) output.logoFileId = logo.value;
  if (description.present) output.description = description.value;
  if (order.present) output.sortOrder = order.value;
  return output;
}

export function parseCategoryCreateBody(value: unknown): CategoryCreateInput {
  const body = closedBody(value, ['name', 'sort_order', 'initial_status'], ['icon_file_id']);
  if (body.initial_status !== 'DRAFT') return invalid('initial_status must be DRAFT');
  const output: CategoryCreateInput = {
    initialStatus: 'DRAFT',
    name: nonBlankBoundedString(body.name, 'name', 120),
    sortOrder: sortOrder(body.sort_order),
  };
  const icon = optionalField(body, 'icon_file_id', (input) => fileId(input, 'icon_file_id'));
  if (icon.present) output.iconFileId = icon.value;
  return output;
}

export function parseCategoryUpdateBody(value: unknown): CategoryUpdateInput {
  const body = closedBody(value, [], ['name', 'icon_file_id', 'sort_order']);
  if (Object.keys(body).length === 0) return invalid('Category update must contain at least one field');
  const output: CategoryUpdateInput = {};
  const name = optionalField(body, 'name', (input) => nonBlankBoundedString(input, 'name', 120));
  const icon = optionalField(body, 'icon_file_id', (input) => fileId(input, 'icon_file_id'));
  const order = optionalField(body, 'sort_order', sortOrder);
  if (name.present) output.name = name.value;
  if (icon.present) output.iconFileId = icon.value;
  if (order.present) output.sortOrder = order.value;
  return output;
}

export function parseLifecyclePreviewBody(value: unknown): LifecyclePreviewInput {
  const body = closedBody(value, ['action', 'reason']);
  return { action: lifecycleAction(body.action), reason: reason(body.reason) };
}

export function parseLifecycleConfirmationBody(value: unknown): LifecycleConfirmationInput {
  const body = closedBody(value, ['action', 'reason', 'preview_token', 'confirmation_hash']);
  const previewToken = boundedString(body.preview_token, 'preview_token', 16, 512);
  if (typeof body.confirmation_hash !== 'string' || !/^[a-f0-9]{64}$/.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return {
    action: lifecycleAction(body.action),
    confirmationHash: body.confirmation_hash,
    previewToken,
    reason: reason(body.reason),
  };
}

export function parseRestoreBody(value: unknown): RestoreInput {
  const body = closedBody(value, ['reason']);
  return { reason: reason(body.reason) };
}
