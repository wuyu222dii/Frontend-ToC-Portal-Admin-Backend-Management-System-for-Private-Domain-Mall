import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { Prisma, PrismaClient } from '../.generated/prisma/client';

export interface AuditLogListInput {
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

export interface AuditChangeSummary {
  displayValue: string;
  field: string;
  sensitive: false;
}

export interface AuditLogListItem {
  action: string;
  actorAccountId: string;
  actorRole: string;
  afterSummary: AuditChangeSummary[];
  afterVersion: number | null;
  auditId: string;
  beforeSummary: AuditChangeSummary[];
  beforeVersion: number | null;
  createdAt: Date;
  idempotencyKey: string | null;
  ipHash: string | null;
  module: string;
  reason: string | null;
  requestId: string;
  result: 'FAILURE' | 'SUCCESS';
  resultCode: string;
  targetId: string;
  targetType: string;
}

export interface AuditLogListResult {
  items: AuditLogListItem[];
  total: number;
}

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const SAFE_SUMMARY_FIELDS = new Set([
  'aftersale_window_days',
  'is_default',
  'minimum_withdrawal_amount',
  'mode',
  'product_count',
  'status',
  'version',
]);
const CONTROL = /\p{Cc}/u;
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function validateText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || CONTROL.test(value)) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function validateInput(input: AuditLogListInput): void {
  if (typeof input !== 'object' || input === null || Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype) throw new TypeError('Audit list input must be a plain object');
  const allowed = new Set([
    'action', 'actorId', 'createdAtFrom', 'createdAtToExclusive', 'module', 'page', 'pageSize', 'resultCode',
    'targetId', 'targetType',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key)) || !Number.isSafeInteger(input.page) || input.page < 1 ||
    !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100 ||
    !Number.isSafeInteger((input.page - 1) * input.pageSize) || (input.page - 1) * input.pageSize > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Audit list input is invalid');
  }
  if (input.actorId !== undefined && !isValidUlid(input.actorId)) throw new TypeError('Audit actor ID is invalid');
  if (input.targetId !== undefined && input.targetType === undefined) {
    throw new TypeError('Audit target type is required with target ID');
  }
  for (const [value, maximum, label] of [
    [input.action, 120, 'Audit action'],
    [input.module, 80, 'Audit module'],
    [input.resultCode, 120, 'Audit result code'],
    [input.targetId, 80, 'Audit target ID'],
    [input.targetType, 80, 'Audit target type'],
  ] as const) {
    if (value !== undefined && (typeof value !== 'string' || value.length < 1 || value.length > maximum ||
      CONTROL.test(value))) throw new TypeError(`${label} is invalid`);
  }
  if (input.createdAtFrom !== undefined && (!(input.createdAtFrom instanceof Date) ||
    !Number.isFinite(input.createdAtFrom.getTime()))) throw new TypeError('Audit date_from is invalid');
  if (input.createdAtToExclusive !== undefined && (!(input.createdAtToExclusive instanceof Date) ||
    !Number.isFinite(input.createdAtToExclusive.getTime()))) throw new TypeError('Audit date_to is invalid');
  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom >= input.createdAtToExclusive) throw new TypeError('Audit date range is invalid');
}

function summary(value: Prisma.JsonValue, label: string): AuditChangeSummary[] {
  if (value === null) return [];
  if (typeof value !== 'object' || Array.isArray(value)) throw internal(`${label} is not a safe summary`);
  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([field, nested]) => {
    if (!SAFE_SUMMARY_FIELDS.has(field)) throw internal(`${label} contains a non-display field`);
    const valid = field === 'version'
      ? Number.isSafeInteger(nested) && Number(nested) >= 1
      : field === 'aftersale_window_days'
        ? Number.isSafeInteger(nested) && Number(nested) >= 1 && Number(nested) <= 365
        : field === 'minimum_withdrawal_amount'
          ? typeof nested === 'string' && POSITIVE_MONEY.test(nested)
          : field === 'product_count'
            ? Number.isSafeInteger(nested) && Number(nested) >= 0
            : field === 'is_default'
              ? typeof nested === 'boolean'
              : typeof nested === 'string' && nested.length >= 1 && nested.length <= 80 && !CONTROL.test(nested);
    if (!valid) throw internal(`${label} contains an invalid value`);
    return { displayValue: String(nested), field, sensitive: false };
  });
}

export class AuditLogRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(input: AuditLogListInput): Promise<AuditLogListResult> {
    validateInput(input);
    const where: Prisma.AuditLogWhereInput = {
      ...(input.action === undefined ? {} : { action: input.action }),
      ...(input.actorId === undefined ? {} : { actor_account_id: input.actorId }),
      ...(input.module === undefined ? {} : { module: input.module }),
      ...(input.resultCode === undefined ? {} : { result_code: input.resultCode }),
      ...(input.targetId === undefined ? {} : { object_id: input.targetId }),
      ...(input.targetType === undefined ? {} : { object_type: input.targetType }),
      ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined ? {} : {
        occurred_at: {
          ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
          ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
        },
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
        select: {
          action: true,
          actor_account_id: true,
          actor_role: true,
          after_json: true,
          before_json: true,
          id: true,
          idempotency_key: true,
          ip_hash: true,
          module: true,
          object_id: true,
          object_type: true,
          occurred_at: true,
          reason: true,
          request_id: true,
          result: true,
          result_code: true,
        },
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map((row) => {
        if (!isValidUlid(row.id) || (row.actor_account_id !== null && !isValidUlid(row.actor_account_id)) ||
          (row.ip_hash !== null && !/^[A-Za-z0-9_-]{16,128}$/.test(row.ip_hash)) ||
          !(row.occurred_at instanceof Date) || !Number.isFinite(row.occurred_at.getTime())) {
          throw internal('Stored audit metadata is invalid');
        }
        const beforeSummary = summary(row.before_json, 'Stored audit before summary');
        const afterSummary = summary(row.after_json, 'Stored audit after summary');
        return {
          action: validateText(row.action, 120, 'Stored audit action'),
          actorAccountId: row.actor_account_id ?? 'SYSTEM',
          actorRole: row.actor_role ?? 'SYSTEM',
          afterSummary,
          afterVersion: Number(afterSummary.find(({ field }) => field === 'version')?.displayValue) || null,
          auditId: row.id,
          beforeSummary,
          beforeVersion: Number(beforeSummary.find(({ field }) => field === 'version')?.displayValue) || null,
          createdAt: new Date(row.occurred_at),
          idempotencyKey: row.idempotency_key,
          ipHash: row.ip_hash,
          module: validateText(row.module, 80, 'Stored audit module'),
          reason: row.reason,
          requestId: validateText(row.request_id, 80, 'Stored audit request ID'),
          result: row.result,
          resultCode: row.result_code ?? 'UNSPECIFIED',
          targetId: validateText(row.object_id, 80, 'Stored audit target ID'),
          targetType: validateText(row.object_type, 80, 'Stored audit target type'),
        };
      }),
      total,
    };
  }
}
