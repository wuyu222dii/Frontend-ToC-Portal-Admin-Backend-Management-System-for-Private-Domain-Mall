import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

export interface AdminAuditListQuery {
  action?: string;
  actorId?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  module?: string;
  page: number;
  pageSize: number;
  resultCode?: string;
  targetId?: string;
  targetType?: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1_000;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return invalid('Query must be an object');
  }
  return value as Record<string, unknown>;
}

function page(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function text(value: unknown, maximum: number, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || /\p{Cc}/u.test(value)) {
    return invalid(`${field} is invalid`);
  }
  return value;
}

function boundary(value: unknown, field: string, nextDay: boolean): Date {
  if (typeof value !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
    return invalid(`${field} is invalid`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    return invalid(`${field} is invalid`);
  }
  return new Date(date.getTime() - SHANGHAI_OFFSET_MS + (nextDay ? DAY_MS : 0));
}

export function parseAdminAuditListQuery(value: unknown): AdminAuditListQuery {
  const query = record(value);
  const allowed = new Set([
    'action', 'actor_id', 'date_from', 'date_to', 'module', 'page', 'page_size', 'result_code', 'target_id',
    'target_type',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: AdminAuditListQuery = {
    page: page(query.page, 1, 2_147_483_647, 'page'),
    pageSize: page(query.page_size, 20, 100, 'page_size'),
  };
  if (!Number.isSafeInteger((output.page - 1) * output.pageSize) ||
    (output.page - 1) * output.pageSize > 2_147_483_647) return invalid('pagination offset is invalid');
  if (query.actor_id !== undefined) {
    if (typeof query.actor_id !== 'string' || !isValidUlid(query.actor_id)) return invalid('actor_id is invalid');
    output.actorId = query.actor_id;
  }
  const mappings = [
    ['action', 'action', 120],
    ['module', 'module', 80],
    ['result_code', 'resultCode', 120],
    ['target_id', 'targetId', 80],
    ['target_type', 'targetType', 80],
  ] as const;
  for (const [source, target, maximum] of mappings) {
    const parsed = text(query[source], maximum, source);
    if (parsed !== undefined) output[target] = parsed;
  }
  if (output.targetId !== undefined && output.targetType === undefined) {
    return invalid('target_type is required with target_id');
  }
  if (query.date_from !== undefined) output.createdAtFrom = boundary(query.date_from, 'date_from', false);
  if (query.date_to !== undefined) output.createdAtToExclusive = boundary(query.date_to, 'date_to', true);
  if (output.createdAtFrom !== undefined && output.createdAtToExclusive !== undefined &&
    output.createdAtFrom >= output.createdAtToExclusive) return invalid('date_from must not be later than date_to');
  return output;
}
