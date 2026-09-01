import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

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
const AFTERSALE_TYPES = ['REFUND_ONLY', 'RETURN_REFUND'] as const;
const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const CONFIRMATION_HASH = /^[a-f0-9]{64}$/;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const PHONE = /^[0-9+ -]{6,30}$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export type AdminAftersaleStatus = (typeof AFTERSALE_STATUSES)[number];
export type AdminAftersaleType = (typeof AFTERSALE_TYPES)[number];

export interface AdminAftersaleListQuery {
  aftersaleNo?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  customerId?: string;
  orderId?: string;
  page: number;
  pageSize: number;
  status?: AdminAftersaleStatus;
  type?: AdminAftersaleType;
}

export interface AdminAftersaleApproveRequest {
  note: string | null;
}

export interface AdminAftersaleRejectRequest {
  reason: string;
}

export interface AdminAftersaleRejectConfirmationRequest extends AdminAftersaleRejectRequest {
  confirmationHash: string;
  previewToken: string;
}

export interface AdminReturnAddressAction {
  city: string;
  detail: string;
  district: string;
  phone: string;
  province: string;
  reason: string;
  recipientName: string;
}

export interface AdminReturnAddressConfirmation extends AdminReturnAddressAction {
  confirmationHash: string;
  previewToken: string;
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
  value: PlainRecord,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const accepted = new Set(allowed);
  if (Object.keys(value).some((field) => !accepted.has(field)) ||
    required.some((field) => !Object.hasOwn(value, field))) {
    return invalid(`${label} fields are invalid`);
  }
}

function text(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function optionalEnum<const T extends readonly string[]>(
  value: unknown,
  values: T,
  field: string,
): T[number] | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) {
    return invalid(`${field} is invalid`);
  }
  return value as T[number];
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function shanghaiStart(value: unknown, field: 'date_from' | 'date_to', nextDay: boolean): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return new Date(date.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? ONE_DAY_MS : 0));
}

function confirmationFields(body: PlainRecord): { confirmationHash: string; previewToken: string } {
  if (typeof body.preview_token !== 'string' ||
    body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !CONFIRMATION_HASH.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return { confirmationHash: body.confirmation_hash, previewToken: body.preview_token };
}

function returnAddressAction(body: PlainRecord): AdminReturnAddressAction {
  if (typeof body.phone !== 'string') return invalid('phone is invalid');
  const phone = body.phone.trim();
  if (!PHONE.test(phone)) return invalid('phone is invalid');
  return {
    city: text(body.city, 'city', 1, 80),
    detail: text(body.detail, 'detail', 1, 300),
    district: text(body.district, 'district', 1, 80),
    phone,
    province: text(body.province, 'province', 1, 80),
    reason: text(body.reason, 'reason', 2, 500),
    recipientName: text(body.recipient_name, 'recipient_name', 1, 80),
  };
}

export function parseAdminAftersaleId(value: string): string {
  if (!isValidUlid(value)) return invalid('aftersale_id is invalid');
  return value;
}

export function parseAdminAftersaleListQuery(value: unknown): AdminAftersaleListQuery {
  const query = plainRecord(value, 'Query');
  exactFields(query, [
    'page',
    'page_size',
    'aftersale_no',
    'order_id',
    'status',
    'type',
    'date_from',
    'date_to',
    'customer_id',
  ], [], 'Query');
  const result: AdminAftersaleListQuery = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if ((result.page - 1) * result.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  if (query.aftersale_no !== undefined) {
    result.aftersaleNo = text(query.aftersale_no, 'aftersale_no', 1, 32);
  }
  for (const [field, property] of [
    ['order_id', 'orderId'],
    ['customer_id', 'customerId'],
  ] as const) {
    const raw = query[field];
    if (raw !== undefined) {
      if (typeof raw !== 'string' || !isValidUlid(raw)) return invalid(`${field} is invalid`);
      result[property] = raw;
    }
  }
  const status = optionalEnum(query.status, AFTERSALE_STATUSES, 'status');
  const type = optionalEnum(query.type, AFTERSALE_TYPES, 'type');
  if (status !== undefined) result.status = status;
  if (type !== undefined) result.type = type;
  if (query.date_from !== undefined) result.createdAtFrom = shanghaiStart(query.date_from, 'date_from', false);
  if (query.date_to !== undefined) result.createdAtToExclusive = shanghaiStart(query.date_to, 'date_to', true);
  if (result.createdAtFrom && result.createdAtToExclusive &&
    result.createdAtFrom.getTime() >= result.createdAtToExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  return result;
}

export function parseAdminAftersaleApproveBody(value: unknown): AdminAftersaleApproveRequest {
  const body = plainRecord(value, 'Request body');
  exactFields(body, ['note'], [], 'Request body');
  if (body.note === undefined || body.note === null) return { note: null };
  return { note: text(body.note, 'note', 1, 500) };
}

export function parseAdminAftersaleRejectBody(value: unknown): AdminAftersaleRejectRequest {
  const body = plainRecord(value, 'Request body');
  exactFields(body, ['reason'], ['reason'], 'Request body');
  return { reason: text(body.reason, 'reason', 2, 500) };
}

export function parseAdminAftersaleRejectConfirmationBody(
  value: unknown,
): AdminAftersaleRejectConfirmationRequest {
  const body = plainRecord(value, 'Request body');
  exactFields(
    body,
    ['reason', 'preview_token', 'confirmation_hash'],
    ['reason', 'preview_token', 'confirmation_hash'],
    'Request body',
  );
  return {
    reason: text(body.reason, 'reason', 2, 500),
    ...confirmationFields(body),
  };
}

export function parseAdminReturnAddressAction(value: unknown): AdminReturnAddressAction {
  const body = plainRecord(value, 'Request body');
  const fields = ['recipient_name', 'phone', 'province', 'city', 'district', 'detail', 'reason'];
  exactFields(body, fields, fields, 'Request body');
  return returnAddressAction(body);
}

export function parseAdminReturnAddressConfirmation(value: unknown): AdminReturnAddressConfirmation {
  const body = plainRecord(value, 'Request body');
  const fields = [
    'recipient_name',
    'phone',
    'province',
    'city',
    'district',
    'detail',
    'reason',
    'preview_token',
    'confirmation_hash',
  ];
  exactFields(body, fields, fields, 'Request body');
  return { ...returnAddressAction(body), ...confirmationFields(body) };
}

export function parseAdminAftersaleEmptyQuery(value: unknown): void {
  const query = plainRecord(value, 'Query');
  if (Object.keys(query).length > 0) return invalid('Query fields are invalid');
}
