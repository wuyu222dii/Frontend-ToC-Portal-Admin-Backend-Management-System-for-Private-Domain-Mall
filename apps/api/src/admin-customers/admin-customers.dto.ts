import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const BINDING_STATUSES = ['BOUND', 'UNBOUND', 'ENDED'] as const;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONFIRMATION_HASH = /^[a-f0-9]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAX_MONEY = '9999999999999999.99';
const MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

export type AdminCustomerBindingStatus = (typeof BINDING_STATUSES)[number];

export interface AdminCustomerListInput {
  agentId?: string;
  bindingStatus?: AdminCustomerBindingStatus;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  keyword?: string;
  maxConsumption?: string;
  minConsumption?: string;
  page: number;
  pageSize: number;
}

export interface CustomerTransferInput {
  reason: string;
  targetAgentId: string | null;
}

export interface CustomerTransferConfirmationInput extends CustomerTransferInput {
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

function closedBody(value: unknown, required: readonly string[], optional: readonly string[]): PlainRecord {
  const body = plainRecord(value, 'Request body');
  const allowed = new Set([...required, ...optional]);
  if (required.some((field) => !Object.hasOwn(body, field)) ||
    Object.keys(body).some((field) => !allowed.has(field))) {
    return invalid('Request body fields are invalid');
  }
  return body;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function boundedText(value: unknown, field: string, minimum: number, maximum: number): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) return invalid(`${field} is invalid`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum) return invalid(`${field} is invalid`);
  return normalized;
}

function optionalUlid(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isValidUlid(value)) return invalid(`${field} is invalid`);
  return value;
}

function strictCalendarDate(value: unknown, field: 'date_from' | 'date_to'): Date {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return parsed;
}

function shanghaiBoundary(value: unknown, field: 'date_from' | 'date_to', nextDay: boolean): Date {
  return new Date(strictCalendarDate(value, field).getTime() - SHANGHAI_OFFSET_MS + (nextDay ? DAY_MS : 0));
}

function compareMoney(left: string, right: string): number {
  const [leftInteger = '', leftFraction = ''] = left.split('.');
  const [rightInteger = '', rightFraction = ''] = right.split('.');
  if (leftInteger.length !== rightInteger.length) return leftInteger.length < rightInteger.length ? -1 : 1;
  if (leftInteger !== rightInteger) return leftInteger < rightInteger ? -1 : 1;
  return leftFraction === rightFraction ? 0 : leftFraction < rightFraction ? -1 : 1;
}

function money(value: unknown, field: 'min_consumption' | 'max_consumption'): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !MONEY.test(value) || compareMoney(value, MAX_MONEY) > 0) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function transferBody(value: unknown, confirmation: boolean): CustomerTransferInput & Partial<{
  confirmationHash: string;
  previewToken: string;
}> {
  const body = closedBody(
    value,
    confirmation ? ['reason', 'preview_token', 'confirmation_hash'] : ['reason'],
    ['target_agent_id'],
  );
  const targetAgentId = body.target_agent_id === undefined || body.target_agent_id === null
    ? null
    : optionalUlid(body.target_agent_id, 'target_agent_id')!;
  const result: CustomerTransferInput & Partial<{ confirmationHash: string; previewToken: string }> = {
    reason: boundedText(body.reason, 'reason', 2, 500),
    targetAgentId,
  };
  if (!confirmation) return result;
  if (typeof body.preview_token !== 'string' || body.preview_token.length < 16 || body.preview_token.length > 512) {
    return invalid('preview_token is invalid');
  }
  if (typeof body.confirmation_hash !== 'string' || !CONFIRMATION_HASH.test(body.confirmation_hash)) {
    return invalid('confirmation_hash is invalid');
  }
  result.previewToken = body.preview_token;
  result.confirmationHash = body.confirmation_hash;
  return result;
}

export function parseAdminCustomerId(value: string): string {
  if (!isValidUlid(value)) return invalid('customer_id is invalid');
  return value;
}

export function parseAdminCustomerListQuery(value: unknown): AdminCustomerListInput {
  const query = plainRecord(value, 'Query');
  const allowed = new Set([
    'agent_id', 'binding_status', 'date_from', 'date_to', 'keyword', 'max_consumption',
    'min_consumption', 'page', 'page_size',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AdminCustomerListInput = {
    page: positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  if ((output.page - 1) * output.pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  if (query.keyword !== undefined) output.keyword = boundedText(query.keyword, 'keyword', 1, 120);
  if (query.binding_status !== undefined) {
    if (typeof query.binding_status !== 'string' ||
      !(BINDING_STATUSES as readonly string[]).includes(query.binding_status)) {
      return invalid('binding_status is invalid');
    }
    output.bindingStatus = query.binding_status as AdminCustomerBindingStatus;
  }
  const agentId = optionalUlid(query.agent_id, 'agent_id');
  const minConsumption = money(query.min_consumption, 'min_consumption');
  const maxConsumption = money(query.max_consumption, 'max_consumption');
  if (agentId !== undefined) output.agentId = agentId;
  if (minConsumption !== undefined) output.minConsumption = minConsumption;
  if (maxConsumption !== undefined) output.maxConsumption = maxConsumption;
  if (query.date_from !== undefined) output.createdAtFrom = shanghaiBoundary(query.date_from, 'date_from', false);
  if (query.date_to !== undefined) output.createdAtToExclusive = shanghaiBoundary(query.date_to, 'date_to', true);
  if (output.createdAtFrom !== undefined && output.createdAtToExclusive !== undefined &&
    output.createdAtFrom.getTime() >= output.createdAtToExclusive.getTime()) {
    return invalid('date_from must not be later than date_to');
  }
  if (minConsumption !== undefined && maxConsumption !== undefined &&
    compareMoney(minConsumption, maxConsumption) > 0) {
    return invalid('min_consumption must not be greater than max_consumption');
  }
  return output;
}

export function parseAdminCustomerEmptyQuery(value: unknown): void {
  if (Object.keys(plainRecord(value, 'Query')).length !== 0) return invalid('Query fields are invalid');
}

export function parseCustomerTransferBody(value: unknown): CustomerTransferInput {
  return transferBody(value, false);
}

export function parseCustomerTransferConfirmationBody(value: unknown): CustomerTransferConfirmationInput {
  const parsed = transferBody(value, true);
  return {
    confirmationHash: parsed.confirmationHash!,
    previewToken: parsed.previewToken!,
    reason: parsed.reason,
    targetAgentId: parsed.targetAgentId,
  };
}
