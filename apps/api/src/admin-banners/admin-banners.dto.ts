import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const BANNER_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
const BANNER_STATUS_ACTIONS = ['ACTIVATE', 'DEACTIVATE'] as const;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export type BannerStatus = (typeof BANNER_STATUSES)[number];
export type BannerStatusAction = (typeof BANNER_STATUS_ACTIONS)[number];

export type BannerTargetInput =
  | { type: 'NONE' }
  | { type: 'PRODUCT' | 'CATEGORY'; targetId: string }
  | { type: 'URL'; targetUrl: string };

export interface BannerListInput {
  keyword?: string;
  page: number;
  pageSize: number;
  status?: BannerStatus;
}

export interface BannerCreateInput {
  endsAt?: string | null;
  fileId: string;
  initialStatus: 'DRAFT';
  sortOrder: number;
  startsAt?: string | null;
  target: BannerTargetInput;
  title: string;
}

export interface BannerUpdateInput {
  endsAt?: string | null;
  fileId?: string;
  sortOrder?: number;
  startsAt?: string | null;
  target?: BannerTargetInput;
  title?: string;
}

export type BannerPatchInput =
  | { kind: 'STATUS'; action: BannerStatusAction }
  | { kind: 'UPDATE'; patch: BannerUpdateInput };

export interface BannerReasonInput {
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

function keyword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return invalid('keyword is invalid');
  }
  return value;
}

function ulid(value: unknown, field: string): string {
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function sortOrder(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > POSTGRES_INTEGER_MAX) {
    return invalid('sort_order is invalid');
  }
  return Number(value);
}

function timestamp(value: unknown, field: 'starts_at' | 'ends_at'): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !RFC3339.test(value) || !Number.isFinite(Date.parse(value))) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function validateTimeRange(startsAt: string | null | undefined, endsAt: string | null | undefined): void {
  if (startsAt !== null && startsAt !== undefined && endsAt !== null && endsAt !== undefined &&
    Date.parse(endsAt) <= Date.parse(startsAt)) {
    invalid('ends_at must be later than starts_at');
  }
}

function optionalField<T>(
  body: PlainRecord,
  wireName: string,
  parse: (value: unknown) => T,
): { present: false } | { present: true; value: T } {
  if (!Object.hasOwn(body, wireName)) return { present: false };
  return { present: true, value: parse(body[wireName]) };
}

function assignOptional<T extends object, K extends keyof T>(
  output: T,
  key: K,
  field: { present: false } | { present: true; value: T[K] },
): void {
  if (field.present) output[key] = field.value;
}

function target(body: PlainRecord): BannerTargetInput {
  if (body.target_type === 'NONE') {
    if (Object.hasOwn(body, 'target_id') || Object.hasOwn(body, 'target_url')) {
      return invalid('NONE target fields are invalid');
    }
    return { type: 'NONE' };
  }
  if (body.target_type === 'PRODUCT' || body.target_type === 'CATEGORY') {
    if (!Object.hasOwn(body, 'target_id') || Object.hasOwn(body, 'target_url')) {
      return invalid(`${body.target_type} target fields are invalid`);
    }
    return { targetId: ulid(body.target_id, 'target_id'), type: body.target_type };
  }
  if (body.target_type === 'URL') {
    if (!Object.hasOwn(body, 'target_url') || Object.hasOwn(body, 'target_id')) {
      return invalid('URL target fields are invalid');
    }
    const targetUrl = boundedString(body.target_url, 'target_url', 1, 500);
    if (!targetUrl.startsWith('https://')) return invalid('target_url is invalid');
    try {
      const parsed = new URL(targetUrl);
      if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
        return invalid('target_url is invalid');
      }
    } catch {
      return invalid('target_url is invalid');
    }
    return { targetUrl, type: 'URL' };
  }
  return invalid('target_type is invalid');
}

function positiveQueryInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function updateFields(body: PlainRecord): BannerUpdateInput {
  const output: BannerUpdateInput = {};
  assignOptional(output, 'title', optionalField(body, 'title', (value) => nonBlankString(value, 'title', 160)));
  assignOptional(output, 'fileId', optionalField(body, 'file_id', (value) => ulid(value, 'file_id')));
  assignOptional(output, 'startsAt', optionalField(body, 'starts_at', (value) => timestamp(value, 'starts_at')));
  assignOptional(output, 'endsAt', optionalField(body, 'ends_at', (value) => timestamp(value, 'ends_at')));
  assignOptional(output, 'sortOrder', optionalField(body, 'sort_order', sortOrder));
  validateTimeRange(output.startsAt, output.endsAt);
  return output;
}

export function parseBannerId(value: string): string {
  return ulid(value, 'banner_id');
}

export function parseBannerListQuery(value: unknown): BannerListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['keyword', 'page', 'page_size', 'status']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: BannerListInput = {
    page: positiveQueryInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveQueryInteger(query.page_size, 20, 100, 'page_size'),
  };
  if (query.keyword !== undefined) output.keyword = keyword(query.keyword);
  if (query.status !== undefined) {
    if (typeof query.status !== 'string' || !(BANNER_STATUSES as readonly string[]).includes(query.status)) {
      return invalid('status is invalid');
    }
    output.status = query.status as BannerStatus;
  }
  return output;
}

export function parseBannerCreateBody(value: unknown): BannerCreateInput {
  const body = closedBody(
    value,
    ['title', 'file_id', 'sort_order', 'initial_status', 'target_type'],
    ['starts_at', 'ends_at', 'target_id', 'target_url'],
  );
  if (body.initial_status !== 'DRAFT') return invalid('initial_status must be DRAFT');
  const output: BannerCreateInput = {
    fileId: ulid(body.file_id, 'file_id'),
    initialStatus: 'DRAFT',
    sortOrder: sortOrder(body.sort_order),
    target: target(body),
    title: nonBlankString(body.title, 'title', 160),
  };
  assignOptional(output, 'startsAt', optionalField(body, 'starts_at', (input) => timestamp(input, 'starts_at')));
  assignOptional(output, 'endsAt', optionalField(body, 'ends_at', (input) => timestamp(input, 'ends_at')));
  validateTimeRange(output.startsAt, output.endsAt);
  return output;
}

export function parseBannerPatchBody(value: unknown): BannerPatchInput {
  const raw = plainRecord(value, 'Request body');
  if (Object.hasOwn(raw, 'action')) {
    const body = closedBody(value, ['action']);
    if (typeof body.action !== 'string' || !(BANNER_STATUS_ACTIONS as readonly string[]).includes(body.action)) {
      return invalid('action is invalid');
    }
    return { action: body.action as BannerStatusAction, kind: 'STATUS' };
  }
  const body = closedBody(value, [], [
    'title', 'file_id', 'starts_at', 'ends_at', 'sort_order', 'target_type', 'target_id', 'target_url',
  ]);
  if (Object.keys(body).length === 0) return invalid('Banner update must contain at least one field');
  const patch = updateFields(body);
  if (Object.hasOwn(body, 'target_type')) patch.target = target(body);
  else if (Object.hasOwn(body, 'target_id') || Object.hasOwn(body, 'target_url')) {
    return invalid('target_type is required when target changes');
  }
  return { kind: 'UPDATE', patch };
}

export function parseBannerReasonBody(value: unknown): BannerReasonInput {
  const body = closedBody(value, ['reason']);
  return { reason: boundedString(body.reason, 'reason', 2, 500) };
}
