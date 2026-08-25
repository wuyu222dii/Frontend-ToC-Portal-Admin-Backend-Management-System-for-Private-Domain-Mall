import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const INVENTORY_LEDGER_TYPES = [
  'INITIAL',
  'MANUAL_INCREASE',
  'MANUAL_DECREASE',
  'ORDER_PAID_DEDUCT',
  'ORDER_RESERVE',
  'ORDER_RELEASE',
  'REFUND_RESTOCK',
  'RETURN_RESTOCK',
  'RETURN_DAMAGED',
  'COMPENSATION',
] as const;
const POSTGRES_INTEGER_MIN = -2_147_483_648;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const ONE_DAY_MS = 24 * 60 * 60 * 1_000;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export type InventoryLedgerType = (typeof INVENTORY_LEDGER_TYPES)[number];

export interface InventoryListInput {
  categoryId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface InventoryAdjustmentInput {
  physicalDelta: number;
  reason: string;
}

export interface InventoryAdjustmentConfirmationInput extends InventoryAdjustmentInput {
  confirmationHash: string;
  previewToken: string;
}

export interface InventoryLedgerListInput {
  ledgerType?: InventoryLedgerType;
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
  page: number;
  pageSize: number;
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

function closedBody(value: unknown, required: readonly string[]): PlainRecord {
  const body = plainRecord(value, 'Request body');
  const allowed = new Set(required);
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

function positiveQueryInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function physicalDelta(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) === 0 || Number(value) < POSTGRES_INTEGER_MIN ||
    Number(value) > POSTGRES_INTEGER_MAX) {
    return invalid('physical_delta is invalid');
  }
  return Number(value);
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

function pagination(query: PlainRecord): Pick<InventoryListInput, 'page' | 'pageSize'> {
  return {
    page: positiveQueryInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveQueryInteger(query.page_size, 20, 100, 'page_size'),
  };
}

export function parseInventorySkuId(value: string): string {
  return ulid(value, 'sku_id');
}

export function parseInventoryListQuery(value: unknown): InventoryListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['category_id', 'keyword', 'page', 'page_size']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: InventoryListInput = pagination(query);
  if (query.category_id !== undefined) output.categoryId = ulid(query.category_id, 'category_id');
  if (query.keyword !== undefined) output.keyword = keyword(query.keyword);
  return output;
}

export function parseInventoryAdjustmentBody(value: unknown): InventoryAdjustmentInput {
  const body = closedBody(value, ['physical_delta', 'reason']);
  return {
    physicalDelta: physicalDelta(body.physical_delta),
    reason: boundedString(body.reason, 'reason', 2, 500),
  };
}

export function parseInventoryAdjustmentConfirmationBody(
  value: unknown,
): InventoryAdjustmentConfirmationInput {
  const body = closedBody(value, ['physical_delta', 'reason', 'preview_token', 'confirmation_hash']);
  const confirmationHash = boundedString(body.confirmation_hash, 'confirmation_hash', 64, 64);
  if (!SHA256.test(confirmationHash)) return invalid('confirmation_hash is invalid');
  return {
    confirmationHash,
    physicalDelta: physicalDelta(body.physical_delta),
    previewToken: boundedString(body.preview_token, 'preview_token', 16, 512),
    reason: boundedString(body.reason, 'reason', 2, 500),
  };
}

export function parseInventoryLedgerQuery(value: unknown): InventoryLedgerListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['date_from', 'date_to', 'ledger_type', 'page', 'page_size']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: InventoryLedgerListInput = pagination(query);
  if (query.ledger_type !== undefined) {
    if (typeof query.ledger_type !== 'string' ||
      !(INVENTORY_LEDGER_TYPES as readonly string[]).includes(query.ledger_type)) {
      return invalid('ledger_type is invalid');
    }
    output.ledgerType = query.ledger_type as InventoryLedgerType;
  }
  if (query.date_from !== undefined) {
    output.occurredAtFrom = shanghaiStart(query.date_from, 'date_from', false);
  }
  if (query.date_to !== undefined) {
    output.occurredAtToExclusive = shanghaiStart(query.date_to, 'date_to', true);
  }
  if (output.occurredAtFrom !== undefined && output.occurredAtToExclusive !== undefined &&
    output.occurredAtFrom.getTime() >= output.occurredAtToExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  return output;
}
