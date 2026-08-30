import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

const TASK_TYPES = ['PAYMENT_INTENT', 'PAYMENT_SETTLEMENT', 'LATE_PAYMENT_REFUND'] as const;
const INTENT_STATUSES = ['CREATING', 'OPEN', 'CLOSE_PENDING'] as const;
const REFUND_STATUSES = ['PENDING', 'PROCESSING', 'FAILED'] as const;
const PAYMENT_RESOLUTIONS = ['LATE_SUCCESS_REFUND_PENDING', 'MANUAL_REQUIRED'] as const;
const MAX_POSTGRES_INTEGER = 2_147_483_647;

export type PaymentReconciliationTaskType = (typeof TASK_TYPES)[number];
export type PaymentReconciliationIntentStatus = (typeof INTENT_STATUSES)[number];
export type PaymentReconciliationRefundStatus = (typeof REFUND_STATUSES)[number];
export type PaymentReconciliationResolution = (typeof PAYMENT_RESOLUTIONS)[number];

export interface PaymentReconciliationListInput {
  dueBefore?: Date;
  intentStatus?: PaymentReconciliationIntentStatus;
  lastErrorCode?: string;
  page: number;
  pageSize: number;
  paymentResolution?: PaymentReconciliationResolution;
  refundStatus?: PaymentReconciliationRefundStatus;
  taskType?: PaymentReconciliationTaskType;
}

export interface PaymentReconciliationRequest {
  reason?: string;
}

type PlainRecord = Record<string, unknown>;

function invalid(message: string): never {
  throw new ApplicationError('INVALID_ARGUMENT', message);
}

function record(value: unknown, label: string): PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalid(`${label} must be a plain object`);
  }
  return value as PlainRecord;
}

function optionalEnum<T extends string>(value: unknown, values: readonly T[], field: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !values.includes(value as T)) return invalid(`${field} is invalid`);
  return value as T;
}

function positiveInteger(value: unknown, fallback: number, maximum: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value)) return invalid(`${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) return invalid(`${field} is invalid`);
  return parsed;
}

function boundedSafeString(value: unknown, minimum: number, maximum: number, field: string): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const characters = Array.from(value);
  if (characters.length < minimum || characters.length > maximum || characters.some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  })) return invalid(`${field} is invalid`);
  return value;
}

function utcDateTime(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !value.endsWith('Z')) return invalid(`${field} is invalid`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return invalid(`${field} is invalid`);
  return parsed;
}

export function parsePaymentIntentId(value: string): string {
  if (!isValidUlid(value)) return invalid('payment_intent_id is invalid');
  return value;
}

export function parsePaymentReconciliationListQuery(value: unknown): PaymentReconciliationListInput {
  const query = record(value, 'Query');
  const allowed = new Set([
    'due_before', 'intent_status', 'last_error_code', 'page', 'page_size',
    'payment_resolution', 'refund_status', 'task_type',
  ]);
  if (Object.keys(query).some((field) => !allowed.has(field))) return invalid('Query fields are invalid');
  const output: PaymentReconciliationListInput = {
    page: positiveInteger(query.page, 1, MAX_POSTGRES_INTEGER, 'page'),
    pageSize: positiveInteger(query.page_size, 20, 100, 'page_size'),
  };
  const taskType = optionalEnum(query.task_type, TASK_TYPES, 'task_type');
  const intentStatus = optionalEnum(query.intent_status, INTENT_STATUSES, 'intent_status');
  const refundStatus = optionalEnum(query.refund_status, REFUND_STATUSES, 'refund_status');
  const paymentResolution = optionalEnum(
    query.payment_resolution,
    PAYMENT_RESOLUTIONS,
    'payment_resolution',
  );
  if (taskType !== undefined) output.taskType = taskType;
  if (intentStatus !== undefined) output.intentStatus = intentStatus;
  if (refundStatus !== undefined) output.refundStatus = refundStatus;
  if (paymentResolution !== undefined) output.paymentResolution = paymentResolution;
  if (query.last_error_code !== undefined) {
    output.lastErrorCode = boundedSafeString(query.last_error_code, 1, 120, 'last_error_code');
  }
  if (query.due_before !== undefined) output.dueBefore = utcDateTime(query.due_before, 'due_before');
  return output;
}

export function parsePaymentReconciliationBody(value: unknown): PaymentReconciliationRequest {
  const body = record(value, 'Request body');
  if (Object.keys(body).some((field) => field !== 'reason')) return invalid('Request body fields are invalid');
  if (body.reason === undefined) return {};
  return { reason: boundedSafeString(body.reason, 0, 500, 'reason') };
}
