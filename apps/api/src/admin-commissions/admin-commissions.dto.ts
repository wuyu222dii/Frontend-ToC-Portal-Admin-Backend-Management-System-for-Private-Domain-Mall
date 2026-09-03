import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

type PlainRecord = Record<string, unknown>;

export type CommissionTargetType = 'CATEGORY' | 'PLATFORM' | 'SKU';
export type CommissionSource = CommissionTargetType;
export type CommissionPositionState = 'AVAILABLE' | 'CANCELLED' | 'EXPECTED' | 'NONE';
export type CommissionLedgerType =
  | 'AVAILABLE_CREDIT'
  | 'EXPECTED_CANCELLED'
  | 'EXPECTED_CREATED'
  | 'EXPECTED_REDUCED'
  | 'REFUND_DEBIT';
export type WalletLedgerType = CommissionLedgerType
  | 'WITHDRAWAL_FREEZE'
  | 'WITHDRAWAL_PAID'
  | 'WITHDRAWAL_RELEASE';

export interface CommissionRuleChangeInput {
  configuredRate: string | null;
  targetId: string | null;
  targetType: CommissionTargetType;
}

export interface CommissionRuleActionInput {
  baseVersionId: string | null;
  changes: CommissionRuleChangeInput[];
  reason: string;
}

export interface CommissionRuleConfirmationInput extends CommissionRuleActionInput {
  confirmationHash: string;
  previewToken: string;
}

export interface CommissionSkuListQuery {
  categoryId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  source?: CommissionSource;
}

export interface CommissionVersionListQuery {
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  page: number;
  pageSize: number;
  status?: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
}

export interface AdminCommissionListQuery {
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
  ledgerType?: CommissionLedgerType;
  page: number;
  pageSize: number;
  positionState?: CommissionPositionState;
}

export interface AdminWalletLedgerListQuery {
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
  ledgerType?: WalletLedgerType;
  page: number;
  pageSize: number;
}

const RATE = /^(?:100\.0000|(?:0|[1-9][0-9]?)\.[0-9]{4})$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;
const COMMISSION_TARGETS = new Set<CommissionTargetType>(['CATEGORY', 'PLATFORM', 'SKU']);
const COMMISSION_SOURCES = new Set<CommissionSource>(['CATEGORY', 'PLATFORM', 'SKU']);
const POSITION_STATES = new Set<CommissionPositionState>(['AVAILABLE', 'CANCELLED', 'EXPECTED', 'NONE']);
const COMMISSION_LEDGER_TYPES = new Set<CommissionLedgerType>([
  'AVAILABLE_CREDIT',
  'EXPECTED_CANCELLED',
  'EXPECTED_CREATED',
  'EXPECTED_REDUCED',
  'REFUND_DEBIT',
]);
const WALLET_LEDGER_TYPES = new Set<WalletLedgerType>([
  ...COMMISSION_LEDGER_TYPES,
  'WITHDRAWAL_FREEZE',
  'WITHDRAWAL_PAID',
  'WITHDRAWAL_RELEASE',
]);

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(`${label} must be an object`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return invalid(`${label} must be a plain object`);
  return value as PlainRecord;
}

function closedRecord(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): PlainRecord {
  const record = plainRecord(value, label);
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !Object.hasOwn(record, field)) ||
    Object.keys(record).some((field) => !allowed.has(field))) {
    return invalid(`${label} fields are invalid`);
  }
  return record;
}

function boundedText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function pageInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function pagination(query: PlainRecord): { page: number; pageSize: number } {
  const page = pageInteger(query.page, 1, 2_147_483_647, 'page');
  const pageSize = pageInteger(query.page_size, 20, 100, 'page_size');
  if (!Number.isSafeInteger((page - 1) * pageSize) || (page - 1) * pageSize > 2_147_483_647) {
    return invalid('pagination offset is invalid');
  }
  return { page, pageSize };
}

function shanghaiBoundary(value: unknown, field: string, nextDay: boolean): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return new Date(date.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? DAY_MS : 0));
}

function dateRange(query: PlainRecord): { from?: Date; toExclusive?: Date } {
  const from = query.date_from === undefined ? undefined : shanghaiBoundary(query.date_from, 'date_from', false);
  const toExclusive = query.date_to === undefined
    ? undefined
    : shanghaiBoundary(query.date_to, 'date_to', true);
  if (from !== undefined && toExclusive !== undefined && from.getTime() >= toExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  return {
    ...(from === undefined ? {} : { from }),
    ...(toExclusive === undefined ? {} : { toExclusive }),
  };
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, field: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.has(value as T)) return invalid(`${field} is invalid`);
  return value as T;
}

function parseChange(value: unknown): CommissionRuleChangeInput {
  const change = closedRecord(value, 'Commission rule change', ['target_type', 'target_id', 'configured_rate']);
  const targetType = enumValue(change.target_type, COMMISSION_TARGETS, 'target_type');
  if (targetType === undefined) return invalid('target_type is invalid');
  const targetId = change.target_id;
  if (targetType === 'PLATFORM') {
    if (targetId !== null || typeof change.configured_rate !== 'string' || !RATE.test(change.configured_rate)) {
      return invalid('PLATFORM rule must have a null target_id and a configured_rate');
    }
  } else if (typeof targetId !== 'string' || !isValidUlid(targetId)) {
    return invalid(`${targetType} target_id is invalid`);
  }
  const configuredRate = change.configured_rate;
  if (configuredRate !== null && (typeof configuredRate !== 'string' || !RATE.test(configuredRate))) {
    return invalid('configured_rate is invalid');
  }
  return {
    configuredRate: configuredRate as string | null,
    targetId: targetId as string | null,
    targetType,
  };
}

function action(value: unknown, confirmation: boolean): CommissionRuleActionInput | CommissionRuleConfirmationInput {
  const confirmationFields = confirmation ? ['preview_token', 'confirmation_hash'] : [];
  const body = closedRecord(
    value,
    'Request body',
    ['base_version_id', 'reason', 'changes', ...confirmationFields],
  );
  if (body.base_version_id !== null &&
    (typeof body.base_version_id !== 'string' || !isValidUlid(body.base_version_id))) {
    return invalid('base_version_id is invalid');
  }
  if (!Array.isArray(body.changes) || body.changes.length === 0) return invalid('changes is invalid');
  const changes = body.changes.map(parseChange);
  const keys = changes.map(({ targetId, targetType }) => `${targetType}:${targetId ?? ''}`);
  if (new Set(keys).size !== keys.length) return invalid('changes contains duplicate targets');
  const result: CommissionRuleActionInput = {
    baseVersionId: body.base_version_id as string | null,
    changes,
    reason: boundedText(body.reason, 'reason', 2, 500),
  };
  if (!confirmation) return result;
  if (typeof body.preview_token !== 'string' || body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !SHA256.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  return {
    ...result,
    confirmationHash: body.confirmation_hash,
    previewToken: body.preview_token,
  };
}

export function parseCommissionRuleActionBody(value: unknown): CommissionRuleActionInput {
  return action(value, false) as CommissionRuleActionInput;
}

export function parseCommissionRuleConfirmationBody(value: unknown): CommissionRuleConfirmationInput {
  return action(value, true) as CommissionRuleConfirmationInput;
}

export function parseCommissionRuleIfMatch(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^"(?:0|[1-9][0-9]*)"$/.test(value)) {
    return invalid('If-Match must contain a quoted commission rule version');
  }
  const parsed = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(parsed) || parsed > 2_147_483_647) return invalid('If-Match version is invalid');
  return parsed;
}

export function parseCommissionResourceId(value: string, field: string): string {
  if (!isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

export function parseEmptyQuery(value: unknown): void {
  if (Object.keys(plainRecord(value, 'Query')).length > 0) return invalid('Query fields are invalid');
}

export function parseCommissionSkuListQuery(value: unknown): CommissionSkuListQuery {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['category_id', 'keyword', 'page', 'page_size', 'source']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: CommissionSkuListQuery = { ...pagination(query) };
  if (query.category_id !== undefined) {
    if (typeof query.category_id !== 'string' || !isValidUlid(query.category_id)) {
      return invalid('category_id is invalid');
    }
    output.categoryId = query.category_id;
  }
  if (query.keyword !== undefined) output.keyword = boundedText(query.keyword, 'keyword', 1, 200);
  const source = enumValue(query.source, COMMISSION_SOURCES, 'source');
  if (source !== undefined) output.source = source;
  return output;
}

export function parseCommissionVersionListQuery(value: unknown): CommissionVersionListQuery {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['date_from', 'date_to', 'page', 'page_size', 'status']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: CommissionVersionListQuery = { ...pagination(query) };
  const status = enumValue(query.status, new Set(['ARCHIVED', 'DRAFT', 'PUBLISHED'] as const), 'status');
  if (status !== undefined) output.status = status;
  const range = dateRange(query);
  if (range.from !== undefined) output.createdAtFrom = range.from;
  if (range.toExclusive !== undefined) output.createdAtToExclusive = range.toExclusive;
  return output;
}

export function parseAdminCommissionListQuery(value: unknown): AdminCommissionListQuery {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['date_from', 'date_to', 'ledger_type', 'page', 'page_size', 'position_state']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AdminCommissionListQuery = { ...pagination(query) };
  const ledgerType = enumValue(query.ledger_type, COMMISSION_LEDGER_TYPES, 'ledger_type');
  const positionState = enumValue(query.position_state, POSITION_STATES, 'position_state');
  if (ledgerType !== undefined) output.ledgerType = ledgerType;
  if (positionState !== undefined) output.positionState = positionState;
  const range = dateRange(query);
  if (range.from !== undefined) output.occurredAtFrom = range.from;
  if (range.toExclusive !== undefined) output.occurredAtToExclusive = range.toExclusive;
  return output;
}

export function parseAdminWalletLedgerListQuery(value: unknown): AdminWalletLedgerListQuery {
  const query = plainRecord(value, 'Query');
  const allowed = new Set(['date_from', 'date_to', 'ledger_type', 'page', 'page_size']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AdminWalletLedgerListQuery = { ...pagination(query) };
  const ledgerType = enumValue(query.ledger_type, WALLET_LEDGER_TYPES, 'ledger_type');
  if (ledgerType !== undefined) output.ledgerType = ledgerType;
  const range = dateRange(query);
  if (range.from !== undefined) output.occurredAtFrom = range.from;
  if (range.toExclusive !== undefined) output.occurredAtToExclusive = range.toExclusive;
  return output;
}
