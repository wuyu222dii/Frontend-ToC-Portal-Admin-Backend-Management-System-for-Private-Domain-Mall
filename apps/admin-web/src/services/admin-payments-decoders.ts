import type { components } from '@qingxu/contracts';

import type {
  PaymentReconciliationActionResult,
  PaymentReconciliationListResult,
  PaymentReconciliationTask,
} from '../types/payments';

type UnknownRecord = Record<string, unknown>;

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const taskKeys = [
  'task_type',
  'payment_intent_id',
  'refund_id',
  'order_id',
  'reference_no',
  'status',
  'payment_resolution',
  'last_error_code',
  'reconciliation_attempt_count',
  'next_reconcile_at',
  'version',
] as const;

function invalid(path: string): never {
  throw new TypeError(`Invalid payment reconciliation response at ${path}`);
}

function readRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(path);
  return value as UnknownRecord;
}

function assertExactKeys(value: UnknownRecord, keys: readonly string[], path: string): void {
  const expected = new Set(keys);
  if (Object.keys(value).length !== expected.size || Object.keys(value).some((key) => !expected.has(key))) {
    invalid(path);
  }
}

function readString(value: unknown, path: string, minimumLength = 0): string {
  if (typeof value !== 'string' || value.length < minimumLength) return invalid(path);
  return value;
}

function readUlid(value: unknown, path: string): string {
  const candidate = readString(value, path);
  if (!ULID_PATTERN.test(candidate)) return invalid(path);
  return candidate;
}

function readInteger(value: unknown, path: string, minimum: number, maximum?: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) return invalid(path);
  if (maximum !== undefined && (value as number) > maximum) return invalid(path);
  return value as number;
}

function readEnum<const T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) return invalid(path);
  return value as T;
}

function readNull(value: unknown, path: string): null {
  if (value !== null) return invalid(path);
  return null;
}

function readNullableString(value: unknown, path: string): string | null {
  return value === null ? null : readString(value, path);
}

function readDateTime(value: unknown, path: string): string {
  const candidate = readString(value, path, 1);
  if (!Number.isFinite(Date.parse(candidate))) return invalid(path);
  return candidate;
}

function readNullableDateTime(value: unknown, path: string): string | null {
  return value === null ? null : readDateTime(value, path);
}

function readTask(value: unknown, path: string): PaymentReconciliationTask {
  const task = readRecord(value, path);
  assertExactKeys(task, taskKeys, path);

  const taskType = readEnum(
    task.task_type,
    ['PAYMENT_INTENT', 'PAYMENT_SETTLEMENT', 'LATE_PAYMENT_REFUND'] as const,
    `${path}.task_type`,
  );
  const paymentIntentId = readUlid(task.payment_intent_id, `${path}.payment_intent_id`);
  const orderId = readUlid(task.order_id, `${path}.order_id`);
  const referenceNo = readString(task.reference_no, `${path}.reference_no`);
  const reconciliationAttemptCount = readInteger(
    task.reconciliation_attempt_count,
    `${path}.reconciliation_attempt_count`,
    0,
  );
  const version = readInteger(task.version, `${path}.version`, 1);

  if (taskType === 'PAYMENT_INTENT') {
    return {
      last_error_code: readNullableString(task.last_error_code, `${path}.last_error_code`),
      next_reconcile_at: readNullableDateTime(task.next_reconcile_at, `${path}.next_reconcile_at`),
      order_id: orderId,
      payment_intent_id: paymentIntentId,
      payment_resolution: readNull(task.payment_resolution, `${path}.payment_resolution`),
      reconciliation_attempt_count: reconciliationAttemptCount,
      reference_no: referenceNo,
      refund_id: readNull(task.refund_id, `${path}.refund_id`),
      status: readEnum(
        task.status,
        ['CREATING', 'OPEN', 'CLOSE_PENDING'] as const,
        `${path}.status`,
      ),
      task_type: taskType,
      version,
    };
  }

  if (taskType === 'PAYMENT_SETTLEMENT') {
    return {
      last_error_code: readString(task.last_error_code, `${path}.last_error_code`, 1),
      next_reconcile_at: readNull(task.next_reconcile_at, `${path}.next_reconcile_at`),
      order_id: orderId,
      payment_intent_id: paymentIntentId,
      payment_resolution: readEnum(
        task.payment_resolution,
        ['MANUAL_REQUIRED'] as const,
        `${path}.payment_resolution`,
      ),
      reconciliation_attempt_count: reconciliationAttemptCount,
      reference_no: referenceNo,
      refund_id: readNull(task.refund_id, `${path}.refund_id`),
      status: readEnum(task.status, ['SUCCEEDED'] as const, `${path}.status`),
      task_type: taskType,
      version,
    };
  }

  return {
    last_error_code: readNullableString(task.last_error_code, `${path}.last_error_code`),
    next_reconcile_at: readNullableDateTime(task.next_reconcile_at, `${path}.next_reconcile_at`),
    order_id: orderId,
    payment_intent_id: paymentIntentId,
    payment_resolution: readEnum(
      task.payment_resolution,
      ['LATE_SUCCESS_REFUND_PENDING', 'MANUAL_REQUIRED'] as const,
      `${path}.payment_resolution`,
    ),
    reconciliation_attempt_count: reconciliationAttemptCount,
    reference_no: referenceNo,
    refund_id: readUlid(task.refund_id, `${path}.refund_id`),
    status: readEnum(task.status, ['PENDING', 'PROCESSING', 'FAILED'] as const, `${path}.status`),
    task_type: taskType,
    version,
  };
}

export function decodePaymentReconciliationListResponse(value: unknown): PaymentReconciliationListResult {
  const envelope = readRecord(value, 'response');
  assertExactKeys(envelope, ['code', 'message', 'data', 'request_id'], 'response');
  readEnum(envelope.code, ['OK'] as const, 'response.code');
  readEnum(envelope.message, ['success'] as const, 'response.message');
  readString(envelope.request_id, 'response.request_id', 1);

  const data = readRecord(envelope.data, 'response.data');
  assertExactKeys(data, ['items', 'pagination'], 'response.data');
  if (!Array.isArray(data.items)) return invalid('response.data.items');
  const pagination = readRecord(data.pagination, 'response.data.pagination');
  assertExactKeys(pagination, ['page', 'page_size', 'total'], 'response.data.pagination');

  return {
    items: data.items.map((item, index) => readTask(item, `response.data.items[${index}]`)),
    pagination: {
      page: readInteger(pagination.page, 'response.data.pagination.page', 1),
      pageSize: readInteger(pagination.page_size, 'response.data.pagination.page_size', 1, 100),
      total: readInteger(pagination.total, 'response.data.pagination.total', 0),
    },
  };
}

function readConverged(value: unknown): components['schemas']['PaymentReconciliationConvergedResponse']['data'] {
  const data = readRecord(value, 'response.data');
  assertExactKeys(
    data,
    [
      'outcome',
      'payment_intent_id',
      'refund_id',
      'order_id',
      'payment_intent_status',
      'refund_status',
      'payment_resolution',
      'last_error_code',
      'version',
    ],
    'response.data',
  );
  readEnum(data.outcome, ['CONVERGED'] as const, 'response.data.outcome');
  const paymentIntentId = readUlid(data.payment_intent_id, 'response.data.payment_intent_id');
  const orderId = readUlid(data.order_id, 'response.data.order_id');
  const version = readInteger(data.version, 'response.data.version', 1);
  readNull(data.last_error_code, 'response.data.last_error_code');

  if (data.refund_id === null) {
    return {
      last_error_code: null,
      order_id: orderId,
      outcome: 'CONVERGED',
      payment_intent_id: paymentIntentId,
      payment_intent_status: readEnum(
        data.payment_intent_status,
        ['CLOSED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const,
        'response.data.payment_intent_status',
      ),
      payment_resolution: readEnum(data.payment_resolution, ['NORMAL'] as const, 'response.data.payment_resolution'),
      refund_id: null,
      refund_status: readNull(data.refund_status, 'response.data.refund_status'),
      version,
    };
  }

  return {
    last_error_code: null,
    order_id: orderId,
    outcome: 'CONVERGED',
    payment_intent_id: paymentIntentId,
    payment_intent_status: readEnum(
      data.payment_intent_status,
      ['CLOSED', 'EXPIRED', 'SUCCEEDED'] as const,
      'response.data.payment_intent_status',
    ),
    payment_resolution: readEnum(
      data.payment_resolution,
      ['LATE_SUCCESS_REFUNDED'] as const,
      'response.data.payment_resolution',
    ),
    refund_id: readUlid(data.refund_id, 'response.data.refund_id'),
    refund_status: readEnum(data.refund_status, ['SUCCEEDED'] as const, 'response.data.refund_status'),
    version,
  };
}

export function decodePaymentReconciliationActionResponse(value: unknown): PaymentReconciliationActionResult {
  const envelope = readRecord(value, 'response');
  assertExactKeys(envelope, ['code', 'message', 'data', 'request_id'], 'response');
  const requestId = readString(envelope.request_id, 'response.request_id', 1);

  if (envelope.code === 'OK') {
    readEnum(envelope.message, ['success'] as const, 'response.message');
    return { data: readConverged(envelope.data), kind: 'CONVERGED', requestId };
  }
  if (envelope.code === 'ACCEPTED') {
    readEnum(envelope.message, ['accepted'] as const, 'response.message');
    return { data: readTask(envelope.data, 'response.data'), kind: 'PENDING', requestId };
  }
  return invalid('response.code');
}
