import type {
  AdminAnalyticsDateListInput,
  AdminAnalyticsMonthListInput,
  AdminAnalyticsScope,
} from '@qingxu/database';
import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const CALENDAR_DATE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const BUSINESS_MONTH = /^[0-9]{4}-(?:0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 60 * 60 * 1_000;
const POSTGRES_INTEGER_MAX = 2_147_483_647;
const SCOPES = ['GLOBAL', 'DIRECT', 'AGENT'] as const satisfies readonly AdminAnalyticsScope[];

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function plainRecord(value: unknown): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Query must be a plain object');
  }
  return value as PlainRecord;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function scopeValue(value: unknown): AdminAnalyticsScope {
  if (value === undefined) return 'GLOBAL';
  if (typeof value !== 'string' || !(SCOPES as readonly string[]).includes(value)) {
    return invalid('scope is invalid');
  }
  return value as AdminAnalyticsScope;
}

function pagination(query: PlainRecord): { page: number; pageSize: number } {
  const page = positiveInteger(query.page, 1, POSTGRES_INTEGER_MAX, 'page');
  const pageSize = positiveInteger(query.page_size, 20, 100, 'page_size');
  if (!Number.isSafeInteger((page - 1) * pageSize) || (page - 1) * pageSize > POSTGRES_INTEGER_MAX) {
    return invalid('pagination offset is invalid');
  }
  return { page, pageSize };
}

function filters(query: PlainRecord) {
  if (query.timezone !== undefined && query.timezone !== 'Asia/Shanghai') {
    return invalid('timezone is invalid');
  }
  const scope = scopeValue(query.scope);
  let agentId: string | undefined;
  if (query.agent_id !== undefined) {
    if (typeof query.agent_id !== 'string' || !isValidUlid(query.agent_id)) {
      return invalid('agent_id is invalid');
    }
    agentId = query.agent_id;
  }
  if (scope !== 'AGENT' && agentId !== undefined) {
    return invalid('agent_id is only allowed with AGENT scope');
  }
  return { ...pagination(query), ...(agentId === undefined ? {} : { agentId }), scope };
}

function calendarDay(value: unknown, field: 'date_from' | 'date_to'): { epoch: number; value: string } {
  if (typeof value !== 'string' || !CALENDAR_DATE.test(value)) return invalid(`${field} is invalid`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return { epoch: date.getTime(), value };
}

function dateRange(query: PlainRecord): Pick<AdminAnalyticsDateListInput, 'dateFrom' | 'dateTo'> {
  if ((query.date_from === undefined) !== (query.date_to === undefined)) {
    return invalid('date_from and date_to must be provided together');
  }
  if (query.date_from === undefined) return {};
  const from = calendarDay(query.date_from, 'date_from');
  const to = calendarDay(query.date_to, 'date_to');
  if (from.epoch > to.epoch) return invalid('date_from must not be later than date_to');
  if ((to.epoch - from.epoch) / DAY_MS + 1 > 366) return invalid('date range must not exceed 366 days');
  return { dateFrom: from.value, dateTo: to.value };
}

function month(value: unknown, field: 'month_from' | 'month_to'): { index: number; value: string } {
  if (typeof value !== 'string' || !BUSINESS_MONTH.test(value)) return invalid(`${field} is invalid`);
  const [year = 0, monthNumber = 0] = value.split('-').map(Number);
  return { index: year * 12 + monthNumber - 1, value };
}

function monthRange(query: PlainRecord): Pick<AdminAnalyticsMonthListInput, 'monthFrom' | 'monthTo'> {
  if ((query.month_from === undefined) !== (query.month_to === undefined)) {
    return invalid('month_from and month_to must be provided together');
  }
  if (query.month_from === undefined) return {};
  const from = month(query.month_from, 'month_from');
  const to = month(query.month_to, 'month_to');
  if (from.index > to.index) return invalid('month_from must not be later than month_to');
  if (to.index - from.index + 1 > 60) return invalid('month range must not exceed 60 months');
  return { monthFrom: from.value, monthTo: to.value };
}

export function parseAdminAnalyticsEmptyQuery(value: unknown): void {
  if (Object.keys(plainRecord(value)).length !== 0) return invalid('Query fields are invalid');
}

export function parseAdminAnalyticsDateListQuery(value: unknown): AdminAnalyticsDateListInput {
  const query = plainRecord(value);
  const allowed = new Set(['agent_id', 'date_from', 'date_to', 'page', 'page_size', 'scope', 'timezone']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  return { ...filters(query), ...dateRange(query) };
}

export function parseAdminAnalyticsMonthListQuery(value: unknown): AdminAnalyticsMonthListInput {
  const query = plainRecord(value);
  const allowed = new Set(['agent_id', 'month_from', 'month_to', 'page', 'page_size', 'scope', 'timezone']);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  return { ...filters(query), ...monthRange(query) };
}
