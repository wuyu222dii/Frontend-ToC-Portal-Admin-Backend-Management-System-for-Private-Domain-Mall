import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import type {
  StoreLatePaymentRefundOperation,
  StorePaymentIntentStatus,
  StorePaymentProvider,
} from './store-payment.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const SAFE_REFERENCE = /^[\x20-\x7e]+$/;
const SAFE_ERROR_CODE = /^[A-Z0-9][A-Z0-9_.:-]{0,119}$/;
const INTENT_TASK_STATUSES = new Set(['CREATING', 'OPEN', 'CLOSE_PENDING'] as const);
const REFUND_TASK_STATUSES = new Set(['PENDING', 'PROCESSING', 'FAILED'] as const);
const PAYMENT_RESOLUTIONS = new Set(['LATE_SUCCESS_REFUND_PENDING', 'MANUAL_REQUIRED'] as const);
const PAYMENT_PROVIDERS = new Set(['MOCK', 'WECHAT'] as const);
const TERMINAL_INTENT_STATUSES = new Set(['CLOSED', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const);
const TERMINAL_CLOSE_REPAIR_STATUSES = new Set(['CLOSED', 'FAILED', 'CANCELLED', 'EXPIRED'] as const);
const ORDER_STATUSES = new Set(['PENDING_PAYMENT', 'PENDING_SHIPMENT', 'SHIPPING', 'COMPLETED', 'CLOSED'] as const);

export type PaymentReconciliationTaskType =
  | 'LATE_PAYMENT_REFUND'
  | 'PAYMENT_INTENT'
  | 'PAYMENT_SETTLEMENT';

export interface PaymentReconciliationListInput {
  dueBefore?: Date;
  intentStatus?: 'CLOSE_PENDING' | 'CREATING' | 'OPEN';
  lastErrorCode?: string;
  page: number;
  pageSize: number;
  paymentResolution?: 'LATE_SUCCESS_REFUND_PENDING' | 'MANUAL_REQUIRED';
  refundStatus?: 'FAILED' | 'PENDING' | 'PROCESSING';
  taskType?: PaymentReconciliationTaskType;
}

interface PaymentReconciliationTaskBase {
  lastErrorCode: string | null;
  nextReconcileAt: Date | null;
  orderId: string;
  paymentIntentId: string;
  reconciliationAttemptCount: number;
  referenceNo: string;
  version: number;
}

export interface PaymentIntentReconciliationTask extends PaymentReconciliationTaskBase {
  paymentResolution: null;
  refundId: null;
  status: 'CLOSE_PENDING' | 'CREATING' | 'OPEN';
  taskType: 'PAYMENT_INTENT';
}

export interface PaymentSettlementReconciliationTask extends PaymentReconciliationTaskBase {
  lastErrorCode: string;
  nextReconcileAt: null;
  paymentResolution: 'MANUAL_REQUIRED';
  refundId: null;
  status: 'SUCCEEDED';
  taskType: 'PAYMENT_SETTLEMENT';
}

export interface LatePaymentRefundReconciliationTask extends PaymentReconciliationTaskBase {
  paymentResolution: 'LATE_SUCCESS_REFUND_PENDING' | 'MANUAL_REQUIRED';
  refundId: string;
  status: 'FAILED' | 'PENDING' | 'PROCESSING';
  taskType: 'LATE_PAYMENT_REFUND';
}

export type PaymentReconciliationTask =
  | LatePaymentRefundReconciliationTask
  | PaymentIntentReconciliationTask
  | PaymentSettlementReconciliationTask;

export interface PaymentReconciliationListResult {
  items: PaymentReconciliationTask[];
  total: number;
}

export type PaymentReconciliationConvergedProjection =
  | {
      lastErrorCode: null;
      orderId: string;
      outcome: 'CONVERGED';
      paymentIntentId: string;
      paymentIntentStatus: 'CANCELLED' | 'CLOSED' | 'EXPIRED' | 'FAILED' | 'SUCCEEDED';
      paymentResolution: 'NORMAL';
      refundId: null;
      refundStatus: null;
      version: number;
    }
  | {
      lastErrorCode: null;
      orderId: string;
      outcome: 'CONVERGED';
      paymentIntentId: string;
      paymentIntentStatus: 'CLOSED' | 'EXPIRED' | 'SUCCEEDED';
      paymentResolution: 'LATE_SUCCESS_REFUNDED';
      refundId: string;
      refundStatus: 'SUCCEEDED';
      version: number;
    };

export type PaymentReconciliationCurrentProjection =
  | { kind: 'CONVERGED'; projection: PaymentReconciliationConvergedProjection }
  | { kind: 'PENDING'; task: PaymentReconciliationTask };

interface PaymentReconciliationActionBase {
  amount: string;
  intentNo: string;
  orderId: string;
  paymentIntentId: string;
  provider: StorePaymentProvider;
  providerIntentId: string | null;
  status: StorePaymentIntentStatus;
  version: number;
}

export interface PaymentIntentReconciliationActionFacts extends PaymentReconciliationActionBase {
  kind: 'PAYMENT_INTENT';
  status: 'CLOSE_PENDING' | 'CREATING' | 'OPEN';
}

export interface PaymentSettlementReconciliationActionFacts extends PaymentReconciliationActionBase {
  kind: 'PAYMENT_SETTLEMENT';
  providerIntentId: string;
  status: 'SUCCEEDED';
}

export interface PaymentTerminalCloseRepairActionFacts extends PaymentReconciliationActionBase {
  kind: 'TERMINAL_CLOSE_REPAIR';
  status: 'CANCELLED' | 'CLOSED' | 'EXPIRED' | 'FAILED';
}

export interface LatePaymentRefundReconciliationActionFacts extends PaymentReconciliationActionBase {
  kind: 'LATE_PAYMENT_REFUND';
  lateRefundOperation: StoreLatePaymentRefundOperation | null;
  providerIntentId: string;
  refundId: string;
  refundStatus: 'FAILED' | 'PENDING' | 'PROCESSING';
  status: 'SUCCEEDED';
}

/** Internal-only facts. Provider locators from this union must never be serialized to ADM-10. */
export type PaymentReconciliationActionFacts =
  | LatePaymentRefundReconciliationActionFacts
  | PaymentIntentReconciliationActionFacts
  | PaymentSettlementReconciliationActionFacts
  | PaymentTerminalCloseRepairActionFacts;

export interface PaymentReconciliationRetryInput {
  paymentIntentId: string;
}

export interface PaymentReconciliationLateRefundRetryResult {
  afterOrderStatus: 'CLOSED';
  afterOrderVersion: number;
  afterRefundStatus: 'PENDING';
  afterRefundVersion: number;
  beforeOrderStatus: 'CLOSED';
  beforeOrderVersion: number;
  beforeRefundStatus: 'FAILED';
  beforeRefundVersion: number;
  operation: StoreLatePaymentRefundOperation;
}

interface CountRow { total: bigint }

interface TaskRow {
  last_error_code: string | null;
  next_reconcile_at: Date | null;
  order_id: string;
  payment_intent_id: string;
  payment_resolution: string | null;
  reconciliation_attempt_count: number;
  reference_no: string;
  refund_id: string | null;
  status: string;
  task_type: string;
  version: number;
}

interface ConvergedRow {
  close_requested_at: Date | null;
  has_active_reservation: boolean;
  intent_last_error_code: string | null;
  intent_status: string;
  intent_version: number;
  order_id: string;
  order_status: string;
  payment_intent_id: string;
  payment_resolution: string;
  refund_failure_code: string | null;
  refund_id: string | null;
  refund_status: string | null;
  refund_version: number | null;
}

interface ActionRow {
  amount: Prisma.Decimal;
  close_requested_at: Date | null;
  has_active_reservation: boolean;
  intent_no: string;
  intent_status: string;
  intent_version: number;
  order_id: string;
  order_status: string;
  payment_intent_id: string;
  payment_resolution: string;
  provider: string;
  provider_intent_id: string | null;
  provider_transaction_id: string | null;
  refund_attempt_id: string | null;
  refund_attempt_provider: string | null;
  refund_attempt_status: string | null;
  refund_amount: Prisma.Decimal | null;
  refund_id: string | null;
  refund_no: string | null;
  refund_provider: string | null;
  refund_status: string | null;
  refund_version: number | null;
}

function internalError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function requirePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function safeUlid(value: unknown, label: string): string {
  if (!isValidUlid(value)) throw internalError(`${label} is invalid`);
  return value;
}

function safeDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internalError(`${label} is invalid`);
  return new Date(value);
}

function safeNullableDate(value: unknown, label: string): Date | null {
  if (value === null) return null;
  return safeDate(value, label);
}

function safePositiveVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw internalError(`${label} is invalid`);
  }
  return value as number;
}

function safeAttemptCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw internalError('Stored reconciliation attempt count is invalid');
  }
  return value as number;
}

function safeReference(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 32 || !SAFE_REFERENCE.test(value)) {
    throw internalError(`${label} is invalid`);
  }
  return value;
}

function safeProviderLocator(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum || !SAFE_REFERENCE.test(value)) {
    throw internalError(`${label} is invalid`);
  }
  return value;
}

function safeNullableErrorCode(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !SAFE_ERROR_CODE.test(value)) {
    throw internalError('Stored reconciliation error code is invalid');
  }
  return value;
}

function safeMoney(value: unknown, label: string): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || !value.greaterThan(0) ||
    value.decimalPlaces() > 2 || value.greaterThan('9999999999999999.99')) {
    throw internalError(`${label} is invalid`);
  }
  return value.toFixed(2);
}

function safeTotal(value: bigint): number {
  const total = Number(value);
  if (!Number.isSafeInteger(total) || total < 0) throw internalError('Reconciliation task count is invalid');
  return total;
}

function validateListInput(input: PaymentReconciliationListInput): void {
  requirePlainObject(input, 'Payment reconciliation list input');
  requireExactKeys(
    input,
    ['dueBefore', 'intentStatus', 'lastErrorCode', 'page', 'pageSize', 'paymentResolution', 'refundStatus', 'taskType'],
    ['page', 'pageSize'],
    'Payment reconciliation list input',
  );
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Payment reconciliation page must be a positive PostgreSQL integer');
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Payment reconciliation page size must be between 1 and 100');
  }
  const offset = (input.page - 1) * input.pageSize;
  if (!Number.isSafeInteger(offset)) throw new TypeError('Payment reconciliation offset is too large');
  if (input.taskType !== undefined &&
    !new Set<PaymentReconciliationTaskType>(['PAYMENT_INTENT', 'PAYMENT_SETTLEMENT', 'LATE_PAYMENT_REFUND'])
      .has(input.taskType)) {
    throw new TypeError('Payment reconciliation task type is invalid');
  }
  if (input.intentStatus !== undefined && !INTENT_TASK_STATUSES.has(input.intentStatus)) {
    throw new TypeError('Payment reconciliation intent status is invalid');
  }
  if (input.refundStatus !== undefined && !REFUND_TASK_STATUSES.has(input.refundStatus)) {
    throw new TypeError('Payment reconciliation refund status is invalid');
  }
  if (input.paymentResolution !== undefined && !PAYMENT_RESOLUTIONS.has(input.paymentResolution)) {
    throw new TypeError('Payment reconciliation payment resolution is invalid');
  }
  if (input.lastErrorCode !== undefined && !SAFE_ERROR_CODE.test(input.lastErrorCode)) {
    throw new TypeError('Payment reconciliation error code is invalid');
  }
  if (input.dueBefore !== undefined &&
    (!(input.dueBefore instanceof Date) || !Number.isFinite(input.dueBefore.getTime()))) {
    throw new TypeError('Payment reconciliation due-before time is invalid');
  }
}

function validatePaymentIntentId(value: string): void {
  requireUlid(value, 'Payment reconciliation intent ID');
}

function validateRetryInput(input: PaymentReconciliationRetryInput): void {
  requirePlainObject(input, 'Late payment refund retry input');
  requireExactKeys(input, ['paymentIntentId'], ['paymentIntentId'], 'Late payment refund retry input');
  validatePaymentIntentId(input.paymentIntentId);
}

function reconciliationTaskCte(): Prisma.Sql {
  return Prisma.sql`
    WITH late_payment_links AS (
      SELECT DISTINCT ON (r.id)
        r.id AS refund_id,
        pi.id AS payment_intent_id
      FROM public.refund AS r
      INNER JOIN public.payment_intent AS pi ON pi.order_id = r.order_id
      INNER JOIN public.payment_attempt AS pa ON pa.payment_intent_id = pi.id
        AND pa.status = 'SUCCEEDED_LATE'::"PaymentAttemptStatus"
        AND pa.provider = pi.provider
        AND pa.amount = pi.amount
      WHERE r.origin_type = 'LATE_PAYMENT'::"RefundOriginType"
        AND r.is_late_payment_refund = TRUE
        AND r.provider = pi.provider
        AND r.amount = pi.amount
      ORDER BY r.id ASC, pa.finished_at DESC NULLS LAST, pa.id DESC
    ), reconciliation_tasks AS (
      SELECT
        'PAYMENT_INTENT'::text AS task_type,
        pi.id AS payment_intent_id,
        NULL::char(26) AS refund_id,
        pi.order_id,
        pi.intent_no AS reference_no,
        pi.status::text AS status,
        NULL::text AS payment_resolution,
        pi.last_error_code,
        pi.reconciliation_attempt_count,
        pi.next_reconcile_at,
        pi.version
      FROM public.payment_intent AS pi
      WHERE pi.status IN (
        'CREATING'::"PaymentIntentStatus",
        'OPEN'::"PaymentIntentStatus",
        'CLOSE_PENDING'::"PaymentIntentStatus"
      )

      UNION ALL

      SELECT
        'PAYMENT_INTENT'::text AS task_type,
        pi.id AS payment_intent_id,
        NULL::char(26) AS refund_id,
        pi.order_id,
        pi.intent_no AS reference_no,
        'CLOSE_PENDING'::text AS status,
        NULL::text AS payment_resolution,
        'ORDER_CLOSE_INCOMPLETE'::text AS last_error_code,
        pi.reconciliation_attempt_count,
        pi.updated_at AS next_reconcile_at,
        pi.version
      FROM public.payment_intent AS pi
      INNER JOIN public.sales_order AS so ON so.id = pi.order_id
      WHERE pi.status IN (
        'CANCELLED'::"PaymentIntentStatus",
        'CLOSED'::"PaymentIntentStatus",
        'EXPIRED'::"PaymentIntentStatus",
        'FAILED'::"PaymentIntentStatus"
      )
        AND pi.close_requested_at IS NOT NULL
        AND so.payment_resolution = 'NORMAL'::"PaymentResolution"
        AND (
          so.order_status <> 'CLOSED'::"OrderStatus"
          OR EXISTS (
            SELECT 1
            FROM public.inventory_reservation AS orphan_reservation
            WHERE orphan_reservation.order_id = so.id
              AND orphan_reservation.status = 'ACTIVE'::"InventoryReservationStatus"
          )
        )

      UNION ALL

      SELECT
        'PAYMENT_SETTLEMENT'::text AS task_type,
        pi.id AS payment_intent_id,
        NULL::char(26) AS refund_id,
        pi.order_id,
        pi.intent_no AS reference_no,
        pi.status::text AS status,
        so.payment_resolution::text AS payment_resolution,
        COALESCE(pi.last_error_code, 'PAYMENT_CONFIGURATION_UNAVAILABLE') AS last_error_code,
        pi.reconciliation_attempt_count,
        NULL::timestamptz AS next_reconcile_at,
        pi.version
      FROM public.payment_intent AS pi
      INNER JOIN public.sales_order AS so ON so.id = pi.order_id
      WHERE pi.status = 'SUCCEEDED'::"PaymentIntentStatus"
        AND so.payment_resolution = 'MANUAL_REQUIRED'::"PaymentResolution"
        AND NOT EXISTS (
          SELECT 1
          FROM public.refund AS settlement_refund
          WHERE settlement_refund.order_id = so.id
            AND settlement_refund.origin_type = 'LATE_PAYMENT'::"RefundOriginType"
            AND settlement_refund.is_late_payment_refund = TRUE
        )

      UNION ALL

      SELECT
        'LATE_PAYMENT_REFUND'::text AS task_type,
        link.payment_intent_id,
        r.id AS refund_id,
        r.order_id,
        r.refund_no AS reference_no,
        r.status::text AS status,
        so.payment_resolution::text AS payment_resolution,
        r.failure_code AS last_error_code,
        attempt_count.total AS reconciliation_attempt_count,
        CASE
          WHEN r.status IN ('PENDING'::"RefundStatus", 'FAILED'::"RefundStatus") THEN r.updated_at
          ELSE NULL
        END AS next_reconcile_at,
        r.version
      FROM public.refund AS r
      INNER JOIN late_payment_links AS link ON link.refund_id = r.id
      INNER JOIN public.sales_order AS so ON so.id = r.order_id
      CROSS JOIN LATERAL (
        SELECT COUNT(*)::integer AS total
        FROM public.refund_attempt AS ra
        WHERE ra.refund_id = r.id
      ) AS attempt_count
      WHERE r.origin_type = 'LATE_PAYMENT'::"RefundOriginType"
        AND r.is_late_payment_refund = TRUE
        AND r.status IN (
          'PENDING'::"RefundStatus",
          'PROCESSING'::"RefundStatus",
          'FAILED'::"RefundStatus"
        )
        AND so.payment_resolution IN (
          'LATE_SUCCESS_REFUND_PENDING'::"PaymentResolution",
          'MANUAL_REQUIRED'::"PaymentResolution"
        )
    )
  `;
}

function taskFilters(input: PaymentReconciliationListInput): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [];
  if (input.taskType !== undefined) filters.push(Prisma.sql`task_type = ${input.taskType}`);
  if (input.intentStatus !== undefined) {
    filters.push(Prisma.sql`task_type = 'PAYMENT_INTENT' AND status = ${input.intentStatus}`);
  }
  if (input.refundStatus !== undefined) {
    filters.push(Prisma.sql`task_type = 'LATE_PAYMENT_REFUND' AND status = ${input.refundStatus}`);
  }
  if (input.paymentResolution !== undefined) {
    filters.push(Prisma.sql`payment_resolution = ${input.paymentResolution}`);
  }
  if (input.lastErrorCode !== undefined) filters.push(Prisma.sql`last_error_code = ${input.lastErrorCode}`);
  if (input.dueBefore !== undefined) filters.push(Prisma.sql`next_reconcile_at <= ${input.dueBefore}`);
  return filters;
}

function whereClause(filters: Prisma.Sql[]): Prisma.Sql {
  return filters.length === 0 ? Prisma.sql`` : Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
}

function taskFromRow(row: TaskRow): PaymentReconciliationTask {
  const base = {
    lastErrorCode: safeNullableErrorCode(row.last_error_code),
    nextReconcileAt: safeNullableDate(row.next_reconcile_at, 'Stored reconciliation due time'),
    orderId: safeUlid(row.order_id, 'Stored reconciliation Order ID'),
    paymentIntentId: safeUlid(row.payment_intent_id, 'Stored reconciliation intent ID'),
    reconciliationAttemptCount: safeAttemptCount(row.reconciliation_attempt_count),
    referenceNo: safeReference(row.reference_no, 'Stored reconciliation reference'),
    version: safePositiveVersion(row.version, 'Stored reconciliation version'),
  };
  if (row.task_type === 'PAYMENT_INTENT') {
    if (!INTENT_TASK_STATUSES.has(row.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING') ||
      row.refund_id !== null || row.payment_resolution !== null) {
      throw internalError('Stored payment-intent reconciliation task is invalid');
    }
    return {
      ...base,
      paymentResolution: null,
      refundId: null,
      status: row.status as PaymentIntentReconciliationTask['status'],
      taskType: 'PAYMENT_INTENT',
    };
  }
  if (row.task_type === 'PAYMENT_SETTLEMENT') {
    if (row.status !== 'SUCCEEDED' || row.refund_id !== null || row.payment_resolution !== 'MANUAL_REQUIRED' ||
      base.lastErrorCode === null || base.nextReconcileAt !== null) {
      throw internalError('Stored payment-settlement reconciliation task is invalid');
    }
    return {
      ...base,
      lastErrorCode: base.lastErrorCode,
      nextReconcileAt: null,
      paymentResolution: 'MANUAL_REQUIRED',
      refundId: null,
      status: 'SUCCEEDED',
      taskType: 'PAYMENT_SETTLEMENT',
    };
  }
  if (row.task_type === 'LATE_PAYMENT_REFUND') {
    if (!REFUND_TASK_STATUSES.has(row.status as 'PENDING' | 'PROCESSING' | 'FAILED') ||
      !PAYMENT_RESOLUTIONS.has(row.payment_resolution as 'LATE_SUCCESS_REFUND_PENDING' | 'MANUAL_REQUIRED') ||
      row.refund_id === null) {
      throw internalError('Stored late-refund reconciliation task is invalid');
    }
    if ((row.status === 'FAILED') !== (row.payment_resolution === 'MANUAL_REQUIRED')) {
      throw internalError('Stored late-refund reconciliation state is invalid');
    }
    return {
      ...base,
      paymentResolution: row.payment_resolution as LatePaymentRefundReconciliationTask['paymentResolution'],
      refundId: safeUlid(row.refund_id, 'Stored reconciliation Refund ID'),
      status: row.status as LatePaymentRefundReconciliationTask['status'],
      taskType: 'LATE_PAYMENT_REFUND',
    };
  }
  throw internalError('Stored reconciliation task type is invalid');
}

function convergedFromRow(row: ConvergedRow): PaymentReconciliationConvergedProjection | null {
  const paymentIntentId = safeUlid(row.payment_intent_id, 'Stored reconciliation intent ID');
  const orderId = safeUlid(row.order_id, 'Stored reconciliation Order ID');
  const lastErrorCode = safeNullableErrorCode(row.intent_last_error_code);
  const closeRequestedAt = safeNullableDate(row.close_requested_at, 'Stored payment close-request time');
  if (typeof row.has_active_reservation !== 'boolean' ||
    !ORDER_STATUSES.has(row.order_status as 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'SHIPPING' | 'COMPLETED' | 'CLOSED')) {
    throw internalError('Stored reconciliation order state is invalid');
  }
  if (row.refund_id === null) {
    if (!TERMINAL_INTENT_STATUSES.has(row.intent_status as PaymentReconciliationConvergedProjection['paymentIntentStatus']) ||
      row.payment_resolution !== 'NORMAL' || row.refund_status !== null ||
      row.refund_failure_code !== null || row.refund_version !== null) {
      return null;
    }
    if (row.intent_status !== 'SUCCEEDED' && closeRequestedAt !== null &&
      (row.order_status !== 'CLOSED' || row.has_active_reservation)) {
      return null;
    }
    return {
      lastErrorCode: null,
      orderId,
      outcome: 'CONVERGED',
      paymentIntentId,
      paymentIntentStatus: row.intent_status as 'CANCELLED' | 'CLOSED' | 'EXPIRED' | 'FAILED' | 'SUCCEEDED',
      paymentResolution: 'NORMAL',
      refundId: null,
      refundStatus: null,
      version: safePositiveVersion(row.intent_version, 'Stored reconciliation intent version'),
    };
  }
  if ((row.intent_status !== 'CLOSED' && row.intent_status !== 'EXPIRED' && row.intent_status !== 'SUCCEEDED') ||
    row.payment_resolution !== 'LATE_SUCCESS_REFUNDED' || row.refund_status !== 'SUCCEEDED' ||
    lastErrorCode !== null || row.refund_failure_code !== null || row.refund_version === null) {
    return null;
  }
  return {
    lastErrorCode: null,
    orderId,
    outcome: 'CONVERGED',
    paymentIntentId,
    paymentIntentStatus: row.intent_status,
    paymentResolution: 'LATE_SUCCESS_REFUNDED',
    refundId: safeUlid(row.refund_id, 'Stored reconciliation Refund ID'),
    refundStatus: 'SUCCEEDED',
    version: safePositiveVersion(row.refund_version, 'Stored reconciliation refund version'),
  };
}

function baseActionFromRow(row: ActionRow): PaymentReconciliationActionBase {
  if (!PAYMENT_PROVIDERS.has(row.provider as StorePaymentProvider) ||
    !TERMINAL_INTENT_STATUSES.has(
      row.intent_status as 'CANCELLED' | 'CLOSED' | 'EXPIRED' | 'FAILED' | 'SUCCEEDED',
    ) &&
    !INTENT_TASK_STATUSES.has(row.intent_status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING')) {
    throw internalError('Stored reconciliation Provider action is invalid');
  }
  return {
    amount: safeMoney(row.amount, 'Stored reconciliation amount'),
    intentNo: safeReference(row.intent_no, 'Stored reconciliation intent number'),
    orderId: safeUlid(row.order_id, 'Stored reconciliation Order ID'),
    paymentIntentId: safeUlid(row.payment_intent_id, 'Stored reconciliation intent ID'),
    provider: row.provider as StorePaymentProvider,
    providerIntentId: row.provider_intent_id === null
      ? null
      : safeProviderLocator(row.provider_intent_id, 128, 'Stored Provider intent ID'),
    status: row.intent_status as StorePaymentIntentStatus,
    version: safePositiveVersion(row.intent_version, 'Stored reconciliation intent version'),
  };
}

function actionFromRow(row: ActionRow): PaymentReconciliationActionFacts | null {
  const base = baseActionFromRow(row);
  if (row.refund_id !== null) {
    if (row.refund_status === 'SUCCEEDED' && row.payment_resolution === 'LATE_SUCCESS_REFUNDED') return null;
    if (base.status !== 'SUCCEEDED' || base.providerIntentId === null ||
      !REFUND_TASK_STATUSES.has(row.refund_status as 'FAILED' | 'PENDING' | 'PROCESSING') ||
      row.refund_no === null || row.refund_version === null || row.refund_amount === null ||
      row.refund_provider !== base.provider || row.refund_attempt_provider !== base.provider ||
      (row.refund_status === 'PENDING' && row.refund_attempt_status !== 'INITIATED') ||
      (row.refund_status === 'PROCESSING' && row.refund_attempt_status !== 'PROCESSING') ||
      (row.refund_status === 'FAILED' && row.refund_attempt_status !== 'FAILED')) {
      throw internalError('Stored late-refund reconciliation action is invalid');
    }
    const refundId = safeUlid(row.refund_id, 'Stored reconciliation Refund ID');
    const refundStatus = row.refund_status as LatePaymentRefundReconciliationActionFacts['refundStatus'];
    let operation: StoreLatePaymentRefundOperation | null = null;
    if (refundStatus !== 'FAILED') {
      if (row.refund_attempt_id === null || row.provider_transaction_id === null ||
        safeMoney(row.refund_amount, 'Stored reconciliation refund amount') !== base.amount) {
        throw internalError('Stored late-refund Provider action is incomplete');
      }
      operation = {
        amount: base.amount,
        orderId: base.orderId,
        paymentIntentId: base.paymentIntentId,
        provider: base.provider,
        providerIntentId: base.providerIntentId,
        providerTransactionId: safeProviderLocator(
          row.provider_transaction_id,
          128,
          'Stored Provider transaction ID',
        ),
        refundAttemptId: safeUlid(row.refund_attempt_id, 'Stored reconciliation Refund attempt ID'),
        refundId,
        refundNo: safeReference(row.refund_no, 'Stored reconciliation refund number'),
        refundVersion: safePositiveVersion(row.refund_version, 'Stored reconciliation refund version'),
      };
    }
    return {
      ...base,
      kind: 'LATE_PAYMENT_REFUND',
      lateRefundOperation: operation,
      providerIntentId: base.providerIntentId,
      refundId,
      refundStatus,
      status: 'SUCCEEDED',
    };
  }
  if (INTENT_TASK_STATUSES.has(base.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING')) {
    return { ...base, kind: 'PAYMENT_INTENT', status: base.status as PaymentIntentReconciliationActionFacts['status'] };
  }
  if (TERMINAL_CLOSE_REPAIR_STATUSES.has(
    base.status as PaymentTerminalCloseRepairActionFacts['status'],
  ) && row.close_requested_at !== null && row.payment_resolution === 'NORMAL') {
    safeDate(row.close_requested_at, 'Stored payment close-request time');
    if (typeof row.has_active_reservation !== 'boolean' ||
      !ORDER_STATUSES.has(row.order_status as 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'SHIPPING' | 'COMPLETED' | 'CLOSED')) {
      throw internalError('Stored terminal close-repair order state is invalid');
    }
    if (row.order_status !== 'CLOSED' || row.has_active_reservation) {
      return {
        ...base,
        kind: 'TERMINAL_CLOSE_REPAIR',
        status: base.status as PaymentTerminalCloseRepairActionFacts['status'],
      };
    }
  }
  if (base.status === 'SUCCEEDED' && row.payment_resolution === 'MANUAL_REQUIRED' &&
    base.providerIntentId !== null) {
    return { ...base, kind: 'PAYMENT_SETTLEMENT', providerIntentId: base.providerIntentId, status: 'SUCCEEDED' };
  }
  return null;
}

export class PaymentReconciliationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listTasks(input: PaymentReconciliationListInput): Promise<PaymentReconciliationListResult> {
    validateListInput(input);
    const filters = taskFilters(input);
    const offset = (input.page - 1) * input.pageSize;
    return this.prisma.$transaction(async (transaction) => {
      const counts = await transaction.$queryRaw<CountRow[]>(Prisma.sql`
        ${reconciliationTaskCte()}
        SELECT COUNT(*)::bigint AS total
        FROM reconciliation_tasks
        ${whereClause(filters)}
      `);
      if (counts.length !== 1 || counts[0] === undefined) throw internalError('Reconciliation count is unavailable');
      const rows = await transaction.$queryRaw<TaskRow[]>(Prisma.sql`
        ${reconciliationTaskCte()}
        SELECT
          task_type,
          payment_intent_id,
          refund_id,
          order_id,
          reference_no,
          status,
          payment_resolution,
          last_error_code,
          reconciliation_attempt_count,
          next_reconcile_at,
          version
        FROM reconciliation_tasks
        ${whereClause(filters)}
        ORDER BY next_reconcile_at ASC NULLS LAST, task_type ASC, payment_intent_id ASC, refund_id ASC NULLS FIRST
        LIMIT ${input.pageSize}
        OFFSET ${offset}
      `);
      return { items: rows.map(taskFromRow), total: safeTotal(counts[0].total) };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async findCurrentByPaymentIntentId(
    paymentIntentId: string,
  ): Promise<PaymentReconciliationCurrentProjection | null> {
    validatePaymentIntentId(paymentIntentId);
    return this.prisma.$transaction(async (transaction) => {
      const tasks = await transaction.$queryRaw<TaskRow[]>(Prisma.sql`
        ${reconciliationTaskCte()}
        SELECT
          task_type,
          payment_intent_id,
          refund_id,
          order_id,
          reference_no,
          status,
          payment_resolution,
          last_error_code,
          reconciliation_attempt_count,
          next_reconcile_at,
          version
        FROM reconciliation_tasks
        WHERE payment_intent_id = ${paymentIntentId}
        ORDER BY task_type ASC, refund_id ASC NULLS FIRST
        LIMIT 2
      `);
      if (tasks.length > 1) throw internalError('Payment intent has multiple reconciliation tasks');
      if (tasks[0] !== undefined) return { kind: 'PENDING', task: taskFromRow(tasks[0]) };
      const rows = await transaction.$queryRaw<ConvergedRow[]>(Prisma.sql`
        SELECT
          pi.id AS payment_intent_id,
          pi.order_id,
          pi.status::text AS intent_status,
          pi.close_requested_at,
          pi.last_error_code AS intent_last_error_code,
          pi.version AS intent_version,
          so.order_status::text AS order_status,
          so.payment_resolution::text AS payment_resolution,
          EXISTS (
            SELECT 1
            FROM public.inventory_reservation AS active_reservation
            WHERE active_reservation.order_id = so.id
              AND active_reservation.status = 'ACTIVE'::"InventoryReservationStatus"
          ) AS has_active_reservation,
          r.id AS refund_id,
          r.status::text AS refund_status,
          r.failure_code AS refund_failure_code,
          r.version AS refund_version
        FROM public.payment_intent AS pi
        INNER JOIN public.sales_order AS so ON so.id = pi.order_id
        LEFT JOIN public.refund AS r ON r.order_id = so.id
          AND r.origin_type = 'LATE_PAYMENT'::"RefundOriginType"
          AND r.is_late_payment_refund = TRUE
          AND r.provider = pi.provider
          AND r.amount = pi.amount
          AND EXISTS (
            SELECT 1
            FROM public.payment_attempt AS linked_late_attempt
            WHERE linked_late_attempt.payment_intent_id = pi.id
              AND linked_late_attempt.status = 'SUCCEEDED_LATE'::"PaymentAttemptStatus"
              AND linked_late_attempt.provider = pi.provider
              AND linked_late_attempt.amount = pi.amount
          )
        WHERE pi.id = ${paymentIntentId}
        LIMIT 2
      `);
      if (rows.length === 0) return null;
      if (rows.length > 1) throw internalError('Payment intent has duplicate late-refund facts');
      const projection = convergedFromRow(rows[0]!);
      return projection === null ? null : { kind: 'CONVERGED', projection };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async readActionFacts(paymentIntentId: string): Promise<PaymentReconciliationActionFacts | null> {
    validatePaymentIntentId(paymentIntentId);
    return this.prisma.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<ActionRow[]>(Prisma.sql`
        SELECT
          pi.id AS payment_intent_id,
          pi.order_id,
          pi.intent_no,
          pi.provider::text AS provider,
          pi.provider_intent_id,
          pi.status::text AS intent_status,
          pi.close_requested_at,
          pi.amount,
          pi.version AS intent_version,
          so.order_status::text AS order_status,
          so.payment_resolution::text AS payment_resolution,
          EXISTS (
            SELECT 1
            FROM public.inventory_reservation AS active_reservation
            WHERE active_reservation.order_id = so.id
              AND active_reservation.status = 'ACTIVE'::"InventoryReservationStatus"
          ) AS has_active_reservation,
          r.id AS refund_id,
          r.refund_no,
          r.provider::text AS refund_provider,
          r.status::text AS refund_status,
          r.amount AS refund_amount,
          r.version AS refund_version,
          latest_refund_attempt.id AS refund_attempt_id,
          latest_refund_attempt.provider AS refund_attempt_provider,
          latest_refund_attempt.status AS refund_attempt_status,
          late_payment_attempt.provider_transaction_id
        FROM public.payment_intent AS pi
        INNER JOIN public.sales_order AS so ON so.id = pi.order_id
        LEFT JOIN LATERAL (
          SELECT late_refund.*
          FROM public.refund AS late_refund
          WHERE late_refund.order_id = so.id
            AND late_refund.origin_type = 'LATE_PAYMENT'::"RefundOriginType"
            AND late_refund.is_late_payment_refund = TRUE
            AND late_refund.provider = pi.provider
            AND late_refund.amount = pi.amount
            AND EXISTS (
              SELECT 1
              FROM public.payment_attempt AS linked_late_attempt
              WHERE linked_late_attempt.payment_intent_id = pi.id
                AND linked_late_attempt.status = 'SUCCEEDED_LATE'::"PaymentAttemptStatus"
                AND linked_late_attempt.provider = pi.provider
                AND linked_late_attempt.amount = pi.amount
            )
          ORDER BY late_refund.id ASC
          LIMIT 1
        ) AS r ON TRUE
        LEFT JOIN LATERAL (
          SELECT ra.id, ra.provider::text AS provider, ra.status::text AS status
          FROM public.refund_attempt AS ra
          WHERE ra.refund_id = r.id
          ORDER BY ra.attempt_no DESC, ra.id DESC
          LIMIT 1
        ) AS latest_refund_attempt ON TRUE
        LEFT JOIN LATERAL (
          SELECT pa.provider_transaction_id
          FROM public.payment_attempt AS pa
          WHERE pa.payment_intent_id = pi.id
            AND pa.status = 'SUCCEEDED_LATE'::"PaymentAttemptStatus"
            AND pa.provider = pi.provider
            AND pa.amount = pi.amount
          ORDER BY pa.finished_at DESC NULLS LAST, pa.id DESC
          LIMIT 1
        ) AS late_payment_attempt ON TRUE
        WHERE pi.id = ${paymentIntentId}
        LIMIT 1
      `);
      return rows[0] === undefined ? null : actionFromRow(rows[0]);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async prepareLatePaymentRefundRetryInTransaction(
    transaction: DatabaseTransaction,
    input: PaymentReconciliationRetryInput,
  ): Promise<PaymentReconciliationLateRefundRetryResult> {
    validateRetryInput(input);
    const locator = await transaction.paymentIntent.findUnique({
      select: { order_id: true },
      where: { id: input.paymentIntentId },
    });
    if (!locator) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Payment reconciliation task not found');
    const orderId = safeUlid(locator.order_id, 'Stored reconciliation Order ID');
    const orderLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.sales_order WHERE id = ${orderId} FOR UPDATE
    `);
    if (orderLocks.length !== 1 || orderLocks[0]?.id !== orderId) {
      throw internalError('Late payment refund Order lock is unavailable');
    }
    const refundLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.refund
      WHERE order_id = ${orderId}
        AND origin_type = 'LATE_PAYMENT'::"RefundOriginType"
        AND is_late_payment_refund = TRUE
      ORDER BY id ASC
      FOR UPDATE
    `);
    if (refundLocks.length !== 1 || refundLocks[0] === undefined) {
      throw internalError('Late payment refund lock is unavailable');
    }
    const refundId = safeUlid(refundLocks[0].id, 'Stored reconciliation Refund ID');
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.refund_attempt
      WHERE refund_id = ${refundId}
      ORDER BY attempt_no ASC, id ASC
      FOR UPDATE
    `);
    const intentLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.payment_intent
      WHERE id = ${input.paymentIntentId} AND order_id = ${orderId}
      FOR UPDATE
    `);
    if (intentLocks.length !== 1 || intentLocks[0]?.id !== input.paymentIntentId) {
      throw internalError('Late payment refund intent lock is unavailable');
    }
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.payment_attempt
      WHERE payment_intent_id = ${input.paymentIntentId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    const timeRows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const serverTime = safeDate(timeRows[0]?.transaction_time, 'Database transaction clock');

    const intent = await transaction.paymentIntent.findUnique({
      select: {
        amount: true,
        id: true,
        intent_no: true,
        order_id: true,
        provider: true,
        provider_intent_id: true,
        provider_state: true,
        status: true,
        succeeded_at: true,
        version: true,
        attempts: {
          orderBy: [{ initiated_at: 'asc' }, { id: 'asc' }],
          select: {
            amount: true,
            failure_code: true,
            finished_at: true,
            id: true,
            provider: true,
            provider_transaction_id: true,
            status: true,
          },
        },
      },
      where: { id: input.paymentIntentId },
    });
    const order = await transaction.salesOrder.findUnique({
      select: {
        final_agent_id: true,
        final_channel: true,
        fulfillment_status: true,
        goods_amount: true,
        id: true,
        order_status: true,
        paid_amount: true,
        payable_amount: true,
        payment_resolution: true,
        payment_status: true,
        refunded_amount: true,
        refund_processing_status: true,
        refund_progress_status: true,
        shipping_amount: true,
        version: true,
        items: {
          orderBy: [{ id: 'asc' }],
          select: {
            aftersale_reserved_amount: true,
            aftersale_reserved_qty: true,
            id: true,
            line_paid_amount: true,
            pre_shipment_refunded_qty: true,
            quantity: true,
            refunded_amount: true,
            refunded_qty: true,
            shipped_qty: true,
          },
        },
      },
      where: { id: orderId },
    });
    const refund = await transaction.refund.findUnique({
      select: {
        aftersale_id: true,
        amount: true,
        failed_at: true,
        failure_code: true,
        id: true,
        is_late_payment_refund: true,
        manual_compensation_id: true,
        order_id: true,
        origin_type: true,
        provider: true,
        provider_refund_id: true,
        reason: true,
        refund_no: true,
        status: true,
        version: true,
        attempts: {
          orderBy: [{ attempt_no: 'asc' }, { id: 'asc' }],
          select: {
            attempt_no: true,
            failure_code: true,
            finished_at: true,
            id: true,
            idempotency_key: true,
            provider: true,
            provider_payload: true,
            provider_request_id: true,
            status: true,
          },
        },
        items: {
          orderBy: [{ order_item_id: 'asc' }, { id: 'asc' }],
          select: {
            aftersale_item_id: true,
            amount: true,
            auto_restock: true,
            commission_reversal: true,
            order_item_id: true,
            quantity: true,
          },
        },
      },
      where: { id: refundId },
    });
    const lateAttempts = intent?.attempts.filter(({ status }) => status === 'SUCCEEDED_LATE') ?? [];
    const lateAttempt = lateAttempts[0];
    if (!intent || !order || !refund || intent.id !== input.paymentIntentId || intent.order_id !== orderId ||
      intent.status !== 'SUCCEEDED' || intent.provider_state !== 'SUCCEEDED' || intent.succeeded_at === null ||
      intent.provider_intent_id === null || lateAttempts.length !== 1 || !lateAttempt ||
      lateAttempt.provider_transaction_id === null || lateAttempt.provider !== intent.provider ||
      lateAttempt.failure_code !== null || lateAttempt.finished_at === null ||
      !lateAttempt.amount.equals(intent.amount) || refund.id !== refundId || refund.order_id !== orderId ||
      refund.origin_type !== 'LATE_PAYMENT' || refund.is_late_payment_refund !== true ||
      refund.provider !== intent.provider || !refund.amount.equals(intent.amount) ||
      refund.refund_no !== `RF${refund.id}` || refund.reason !== 'LATE_PAYMENT_AUTOMATIC_FULL_REFUND' ||
      refund.aftersale_id !== null || refund.manual_compensation_id !== null ||
      refund.provider_refund_id !== null || refund.status !== 'FAILED' || refund.failure_code === null ||
      refund.failed_at === null || order.id !== orderId || order.order_status !== 'CLOSED' ||
      order.fulfillment_status !== 'NOT_STARTED' || order.payment_status !== 'PAID' ||
      order.payment_resolution !== 'MANUAL_REQUIRED' || order.refund_progress_status !== 'NONE' ||
      order.refund_processing_status !== 'FAILED' || !order.refunded_amount.equals(0) ||
      !order.paid_amount.equals(order.payable_amount) || !order.payable_amount.equals(refund.amount) ||
      !order.shipping_amount.equals(0) || order.final_agent_id !== null || order.final_channel !== null ||
      refund.attempts.length < 1 || refund.attempts.some((attempt, index) =>
        attempt.attempt_no !== index + 1 || attempt.provider !== refund.provider || attempt.status !== 'FAILED' ||
        attempt.failure_code === null || attempt.finished_at === null || attempt.provider_request_id !== null ||
        attempt.provider_payload !== null ||
        attempt.idempotency_key !== `late-payment:${refund.id}:${index + 1}`)) {
      throw internalError('Failed late payment refund retry facts are inconsistent');
    }
    const refundItems = new Map(refund.items.map((item) => [item.order_item_id, item]));
    const orderLineTotal = order.items.reduce(
      (total, item) => total.plus(item.line_paid_amount),
      new Prisma.Decimal(0),
    );
    const itemFactsExact = order.items.length > 0 && refund.items.length === order.items.length &&
      order.goods_amount.equals(order.payable_amount) && orderLineTotal.equals(order.goods_amount) &&
      order.items.every((item) => {
        const refundItem = refundItems.get(item.id);
        return refundItem !== undefined && Number.isSafeInteger(item.quantity) && item.quantity > 0 &&
          refundItem.quantity === item.quantity &&
          refundItem.amount.equals(item.line_paid_amount) && refundItem.auto_restock === false &&
          refundItem.commission_reversal.equals(0) && refundItem.aftersale_item_id === null &&
          item.refunded_qty === 0 && item.pre_shipment_refunded_qty === 0 && item.refunded_amount.equals(0) &&
          item.aftersale_reserved_qty === 0 && item.aftersale_reserved_amount.equals(0) && item.shipped_qty === 0;
      });
    if (!itemFactsExact) throw internalError('Failed late payment refund retry item facts are inconsistent');

    const attemptNo = refund.attempts.length + 1;
    if (attemptNo > MAX_POSTGRES_INTEGER) throw internalError('Late payment refund attempt limit is exhausted');
    const beforeOrderVersion = safePositiveVersion(order.version, 'Stored reconciliation Order version');
    const beforeRefundVersion = safePositiveVersion(refund.version, 'Stored reconciliation Refund version');
    if (beforeOrderVersion >= MAX_POSTGRES_INTEGER || beforeRefundVersion >= MAX_POSTGRES_INTEGER) {
      throw internalError('Late payment refund retry version limit is exhausted');
    }
    const afterOrderVersion = beforeOrderVersion + 1;
    const afterRefundVersion = beforeRefundVersion + 1;
    const refundAttemptId = generateUlid(serverTime.getTime());
    const refundChanged = await transaction.refund.updateMany({
      data: {
        failed_at: null,
        failure_code: null,
        status: 'PENDING',
        updated_at: serverTime,
        version: { increment: 1 },
      },
      where: { id: refund.id, status: 'FAILED', version: beforeRefundVersion },
    });
    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        payment_resolution: 'LATE_SUCCESS_REFUND_PENDING',
        refund_processing_status: 'REFUNDING',
        updated_at: serverTime,
        version: { increment: 1 },
      },
      where: { id: order.id, payment_resolution: 'MANUAL_REQUIRED', version: beforeOrderVersion },
    });
    if (refundChanged.count !== 1 || orderChanged.count !== 1) {
      throw internalError('Late payment refund retry lost its locked facts');
    }
    await transaction.refundAttempt.create({
      data: {
        attempt_no: attemptNo,
        failure_code: null,
        id: refundAttemptId,
        idempotency_key: `late-payment:${refund.id}:${attemptNo}`,
        provider: refund.provider,
        provider_payload: Prisma.DbNull,
        provider_request_id: null,
        refund_id: refund.id,
        requested_at: serverTime,
        status: 'INITIATED',
      },
    });
    return {
      afterOrderStatus: 'CLOSED',
      afterOrderVersion,
      afterRefundStatus: 'PENDING',
      afterRefundVersion,
      beforeOrderStatus: 'CLOSED',
      beforeOrderVersion,
      beforeRefundStatus: 'FAILED',
      beforeRefundVersion,
      operation: {
        amount: safeMoney(refund.amount, 'Stored reconciliation refund amount'),
        orderId,
        paymentIntentId: intent.id,
        provider: intent.provider,
        providerIntentId: safeProviderLocator(intent.provider_intent_id, 128, 'Stored Provider intent ID'),
        providerTransactionId: safeProviderLocator(
          lateAttempt.provider_transaction_id,
          128,
          'Stored Provider transaction ID',
        ),
        refundAttemptId,
        refundId: refund.id,
        refundNo: refund.refund_no,
        refundVersion: afterRefundVersion,
      },
    };
  }
}
