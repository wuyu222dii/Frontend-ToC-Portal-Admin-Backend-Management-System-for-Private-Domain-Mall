import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const CONFIRMATION_HASH = /^[a-f0-9]{64}$/;
const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

const AFTERSALE_TYPES = ['REFUND_ONLY', 'RETURN_REFUND'] as const;
const AFTERSALE_REASON_CODES = [
  'UNSHIPPED_NO_LONGER_NEEDED',
  'ITEM_DAMAGED',
  'ITEM_NOT_AS_DESCRIBED',
  'WRONG_ITEM',
  'MISSING_ITEM',
  'QUALITY_ISSUE',
  'OTHER',
] as const;
const AFTERSALE_STATUSES = [
  'PENDING_REVIEW',
  'REJECTED',
  'REFUNDING',
  'WAITING_RETURN',
  'WAITING_RECEIPT',
  'RETURN_EXCEPTION',
  'REFUNDING_AFTER_RETURN',
  'REJECTED_AFTER_RETURN',
  'REFUND_FAILED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type StoreAftersaleType = (typeof AFTERSALE_TYPES)[number];
export type StoreAftersaleReasonCode = (typeof AFTERSALE_REASON_CODES)[number];
export type StoreAftersaleStatusFilter = (typeof AFTERSALE_STATUSES)[number];

export interface StoreAftersaleLineRequest {
  orderItemId: string;
  quantity: number;
}

interface StoreAftersaleRequestBase {
  evidenceFileIds: string[];
  items: StoreAftersaleLineRequest[];
  orderId: string;
  reasonCode: StoreAftersaleReasonCode;
  reasonText: string | null;
  type: StoreAftersaleType;
}

export type StoreAftersaleCreateRequest =
  | (StoreAftersaleRequestBase & { action: 'PREVIEW' })
  | (StoreAftersaleRequestBase & {
      action: 'CONFIRM';
      confirmationHash: string;
      previewToken: string;
    });

export interface StoreAftersaleListQuery {
  aftersaleNo?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  orderId?: string;
  page: number;
  pageSize: number;
  status?: StoreAftersaleStatusFilter;
  type?: StoreAftersaleType;
}

export interface StoreAftersaleCancelRequest {
  reason?: string;
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid(`${label} must be a plain object`);
  }
  return value as PlainRecord;
}

function exactFields(
  record: PlainRecord,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedFields = new Set(allowed);
  if (Object.keys(record).some((field) => !allowedFields.has(field)) ||
    required.some((field) => !Object.prototype.hasOwnProperty.call(record, field))) {
    return invalid(`${label} fields are invalid`);
  }
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function normalizedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== 'string' || hasControlCharacter(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < 2 || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function closedEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
): T[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    return invalid(`${field} is invalid`);
  }
  return value as T[number];
}

function optionalClosedEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
): T[number] | undefined {
  return value === undefined ? undefined : closedEnum(value, values, field);
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function strictUtcCalendarDate(value: unknown, field: 'date_from' | 'date_to'): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return parsed;
}

function shanghaiStart(value: unknown, field: 'date_from' | 'date_to', nextDay: boolean): Date {
  const utcCalendarDate = strictUtcCalendarDate(value, field);
  return new Date(utcCalendarDate.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? ONE_DAY_MS : 0));
}

function parseLine(value: unknown): StoreAftersaleLineRequest {
  const item = plainRecord(value, 'items entry');
  exactFields(item, ['order_item_id', 'quantity'], ['order_item_id', 'quantity'], 'items entry');
  if (typeof item.order_item_id !== 'string' || !isValidUlid(item.order_item_id)) {
    return invalid('order_item_id is invalid');
  }
  if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) ||
    item.quantity < 1 || item.quantity > 99) {
    return invalid('quantity is invalid');
  }
  return { orderItemId: item.order_item_id, quantity: item.quantity };
}

function parseItems(value: unknown): StoreAftersaleLineRequest[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) return invalid('items is invalid');
  const items = value.map(parseLine);
  if (new Set(items.map(({ orderItemId }) => orderItemId)).size !== items.length) {
    return invalid('order_item_id values must be unique');
  }
  return items.sort((left, right) => left.orderItemId.localeCompare(right.orderItemId));
}

function parseEvidenceFileIds(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 9 ||
    value.some((fileId) => typeof fileId !== 'string' || !isValidUlid(fileId))) {
    return invalid('evidence_file_ids is invalid');
  }
  if (new Set(value).size !== value.length) return invalid('evidence_file_ids values must be unique');
  return [...value].sort((left, right) => left.localeCompare(right));
}

function parseReasonText(value: unknown, reasonCode: StoreAftersaleReasonCode): string | null {
  if (value === undefined || value === null) {
    if (reasonCode === 'OTHER') return invalid('reason_text is required for OTHER');
    return null;
  }
  return normalizedText(value, 'reason_text', 500);
}

export function parseStoreAftersaleCreateBody(value: unknown): StoreAftersaleCreateRequest {
  const body = plainRecord(value, 'Request body');
  if (body.action !== 'PREVIEW' && body.action !== 'CONFIRM') return invalid('action is invalid');
  const commonFields = ['action', 'order_id', 'type', 'reason_code', 'reason_text', 'items', 'evidence_file_ids'];
  const confirmFields = ['preview_token', 'confirmation_hash'];
  exactFields(
    body,
    body.action === 'CONFIRM' ? [...commonFields, ...confirmFields] : commonFields,
    body.action === 'CONFIRM'
      ? ['action', 'order_id', 'type', 'reason_code', 'items', ...confirmFields]
      : ['action', 'order_id', 'type', 'reason_code', 'items'],
    'Request body',
  );
  if (typeof body.order_id !== 'string' || !isValidUlid(body.order_id)) {
    return invalid('order_id is invalid');
  }
  const type = closedEnum(body.type, AFTERSALE_TYPES, 'type');
  const reasonCode = closedEnum(body.reason_code, AFTERSALE_REASON_CODES, 'reason_code');
  const base: StoreAftersaleRequestBase = {
    evidenceFileIds: parseEvidenceFileIds(body.evidence_file_ids),
    items: parseItems(body.items),
    orderId: body.order_id,
    reasonCode,
    reasonText: parseReasonText(body.reason_text, reasonCode),
    type,
  };
  if (body.action === 'PREVIEW') return { ...base, action: 'PREVIEW' };
  if (typeof body.preview_token !== 'string' ||
    body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !CONFIRMATION_HASH.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return {
    ...base,
    action: 'CONFIRM',
    confirmationHash: body.confirmation_hash,
    previewToken: body.preview_token,
  };
}

export function parseStoreAftersaleId(value: string): string {
  if (!isValidUlid(value)) return invalid('aftersale_id is invalid');
  return value;
}

export function parseStoreAftersaleListQuery(value: unknown): StoreAftersaleListQuery {
  const query = plainRecord(value, 'Query');
  const allowedFields = [
    'page',
    'page_size',
    'aftersale_no',
    'order_id',
    'status',
    'type',
    'date_from',
    'date_to',
  ];
  exactFields(query, allowedFields, [], 'Query');
  const result: StoreAftersaleListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if ((result.page - 1) * result.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  if (query.aftersale_no !== undefined) {
    if (typeof query.aftersale_no !== 'string' || hasControlCharacter(query.aftersale_no)) {
      return invalid('aftersale_no is invalid');
    }
    const aftersaleNo = query.aftersale_no.trim();
    const aftersaleNoLength = Array.from(aftersaleNo).length;
    if (aftersaleNoLength < 1 || aftersaleNoLength > 32) return invalid('aftersale_no is invalid');
    result.aftersaleNo = aftersaleNo;
  }
  if (query.order_id !== undefined) {
    if (typeof query.order_id !== 'string' || !isValidUlid(query.order_id)) {
      return invalid('order_id is invalid');
    }
    result.orderId = query.order_id;
  }
  const status = optionalClosedEnum(query.status, AFTERSALE_STATUSES, 'status');
  const type = optionalClosedEnum(query.type, AFTERSALE_TYPES, 'type');
  if (status !== undefined) result.status = status;
  if (type !== undefined) result.type = type;
  if (query.date_from !== undefined) result.createdAtFrom = shanghaiStart(query.date_from, 'date_from', false);
  if (query.date_to !== undefined) result.createdAtToExclusive = shanghaiStart(query.date_to, 'date_to', true);
  if (result.createdAtFrom !== undefined && result.createdAtToExclusive !== undefined &&
    result.createdAtFrom.getTime() >= result.createdAtToExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  return result;
}

export function parseStoreAftersaleCancelBody(value: unknown): StoreAftersaleCancelRequest {
  const body = plainRecord(value, 'Request body');
  exactFields(body, ['reason'], [], 'Request body');
  if (body.reason === undefined) return {};
  return { reason: normalizedText(body.reason, 'reason', 500) };
}
