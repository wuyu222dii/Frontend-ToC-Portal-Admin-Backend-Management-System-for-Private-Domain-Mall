import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_RECONCILE_DELAY_MS = 24 * 60 * 60 * 1_000;
const ACTIVE_INTENT_STATUSES = new Set(['CREATING', 'OPEN', 'CLOSE_PENDING'] as const);
const PAYMENT_PROVIDERS = new Set(['MOCK', 'WECHAT'] as const);
const SAFE_PROVIDER_VALUE = /^[\x20-\x7e]+$/;
const SAFE_ERROR_CODE = /^[A-Z0-9][A-Z0-9_.:-]{0,119}$/;
const PAYMENT_CALLBACK_EVENT_TYPES = new Map([
  ['SUCCEEDED', 'payment.succeeded'],
  ['FAILED', 'payment.failed'],
  ['CANCELLED', 'payment.cancelled'],
] as const);
const PAYMENT_CALLBACK_OUTCOMES = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED'] as const);
const MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;

const PAYMENT_INTENT_SELECT = {
  amount: true,
  close_attempt_count: true,
  close_requested_at: true,
  closed_at: true,
  create_requested_at: true,
  created_at: true,
  expires_at: true,
  id: true,
  intent_no: true,
  last_error_code: true,
  last_reconciled_at: true,
  next_reconcile_at: true,
  opened_at: true,
  order_id: true,
  provider: true,
  provider_intent_id: true,
  provider_state: true,
  reconciliation_attempt_count: true,
  status: true,
  succeeded_at: true,
  updated_at: true,
  version: true,
} satisfies Prisma.PaymentIntentSelect;

const PAYMENT_ORDER_SELECT = {
  close_reason: true,
  closed_at: true,
  completed_at: true,
  completion_reason: true,
  customer_id: true,
  fulfillment_status: true,
  goods_amount: true,
  id: true,
  inventory_reservation: { select: { expires_at: true, status: true } },
  order_status: true,
  paid_amount: true,
  pay_expires_at: true,
  payable_amount: true,
  payment_resolution: true,
  payment_status: true,
  refunded_amount: true,
  refund_processing_status: true,
  refund_progress_status: true,
  shipping_amount: true,
  version: true,
} satisfies Prisma.SalesOrderSelect;

type PaymentIntentRecord = Prisma.PaymentIntentGetPayload<{ select: typeof PAYMENT_INTENT_SELECT }>;
type PaymentOrderRecord = Prisma.SalesOrderGetPayload<{ select: typeof PAYMENT_ORDER_SELECT }>;
type SettlementCommissionRuleVersion = Prisma.CommissionRuleVersionGetPayload<{ include: { entries: true } }>;

export type StorePaymentProvider = 'MOCK' | 'WECHAT';
export type StorePaymentIntentStatus =
  | 'CANCELLED'
  | 'CLOSED'
  | 'CLOSE_PENDING'
  | 'CREATING'
  | 'EXPIRED'
  | 'FAILED'
  | 'OPEN'
  | 'SUCCEEDED';

export interface StorePaymentIntentSnapshot {
  amount: string;
  createRequestedAt: Date;
  expiresAt: Date;
  intentNo: string;
  lastErrorCode: string | null;
  nextReconcileAt: Date | null;
  openedAt: Date | null;
  orderId: string;
  paymentIntentId: string;
  provider: StorePaymentProvider;
  providerIntentId: string | null;
  providerState: string | null;
  serverTime: Date;
  status: StorePaymentIntentStatus;
  updatedAt: Date;
  version: number;
}

export interface StorePaymentPrepareInput {
  accountId: string;
  customerId: string;
  expectedVersion: number;
  orderId: string;
  provider: StorePaymentProvider;
  reconcileAfterMs: number;
}

export interface StorePaymentProviderCreateRevalidationInput {
  accountId: string;
  customerId: string;
  expectedIntentVersion: number;
  orderId: string;
  paymentIntentId: string;
  provider: StorePaymentProvider;
}

export type StorePaymentPrepareResult = {
  created: boolean;
  intent: StorePaymentIntentSnapshot;
  providerOperation: 'CREATE' | 'QUERY';
};

export type StorePaymentProviderFinalization =
  | {
      kind: 'OPEN';
      nextReconcileAt: Date;
      providerIntentId: string;
      providerState: string;
    }
  | {
      errorCode: string | null;
      kind: 'TERMINAL';
      providerIntentId: string | null;
      providerState: string;
      status: 'CANCELLED' | 'CLOSED' | 'EXPIRED' | 'FAILED';
    }
  | {
      errorCode: string;
      kind: 'UNKNOWN';
      nextReconcileAt: Date;
      providerState: string | null;
    };

export interface StorePaymentFinalizeInput {
  expectedVersion: number;
  orderId: string;
  paymentIntentId: string;
  provider: StorePaymentProvider;
  result: StorePaymentProviderFinalization;
}

export interface StorePaymentFinalizeResult {
  changed: boolean;
  intent: StorePaymentIntentSnapshot;
}

export interface StorePaymentOwnedReadInput {
  customerId: string;
  paymentIntentId: string;
}

export interface StorePaymentCallbackInput {
  amount: string;
  eventType: 'payment.cancelled' | 'payment.failed' | 'payment.succeeded';
  occurredAt: Date;
  outcome: 'CANCELLED' | 'FAILED' | 'SUCCEEDED';
  provider: StorePaymentProvider;
  providerEventId: string;
  providerIntentId: string;
  providerTransactionId: string | null;
}

export interface StorePaymentCallbackState {
  intentStatus: StorePaymentIntentStatus;
  intentVersion: number;
  orderPaymentResolution: 'LATE_SUCCESS_REFUND_PENDING' | 'LATE_SUCCESS_REFUNDED' | 'MANUAL_REQUIRED' | 'NORMAL';
  orderPaymentStatus: 'PAID' | 'PROCESSING' | 'UNPAID';
  orderStatus: 'CLOSED' | 'COMPLETED' | 'PENDING_PAYMENT' | 'PENDING_SHIPMENT' | 'SHIPPING';
  orderVersion: number;
}

export interface StoreLatePaymentRefundOperation {
  amount: string;
  orderId: string;
  paymentIntentId: string;
  provider: StorePaymentProvider;
  providerIntentId: string;
  providerTransactionId: string;
  refundAttemptId: string;
  refundId: string;
  refundNo: string;
  refundVersion: number;
}

export interface StorePaymentCallbackResult {
  after: StorePaymentCallbackState;
  before: StorePaymentCallbackState;
  changed: boolean;
  commissionLedgerIds: string[];
  commissionSnapshotIds: string[];
  finalAgentId: string | null;
  finalChannel: 'AGENT' | 'DIRECT' | null;
  inventoryLedgerIds: string[];
  kind:
    | 'ATTEMPT_RECORDED'
    | 'LATE_REFUND_REQUIRED'
    | 'MANUAL_REQUIRED'
    | 'REPLAY'
    | 'SETTLED'
    | 'TERMINAL';
  lateRefund: StoreLatePaymentRefundOperation | null;
  orderId: string;
  outcome: StorePaymentCallbackInput['outcome'];
  paymentAttemptId: string;
  paymentIntentId: string;
  providerEventId: string;
  reservationId: string | null;
}

export type StoreLatePaymentRefundClaimResult =
  | { kind: 'CLAIMED'; operation: StoreLatePaymentRefundOperation }
  | { kind: 'TERMINAL' };

export type StoreLatePaymentRefundFinalization =
  | {
      kind: 'SUCCEEDED';
      occurredAt: Date;
      providerEventId: string;
      providerRefundId: string;
    }
  | {
      failureCode: string;
      kind: 'FAILED';
      occurredAt: Date | null;
    };

export interface StoreLatePaymentRefundFinalizeInput {
  operation: StoreLatePaymentRefundOperation;
  result: StoreLatePaymentRefundFinalization;
}

export interface StoreLatePaymentRefundFinalizeResult {
  afterOrderVersion: number;
  afterRefundStatus: 'FAILED' | 'SUCCEEDED';
  afterRefundVersion: number;
  beforeOrderVersion: number;
  beforeRefundStatus: 'FAILED' | 'PROCESSING' | 'SUCCEEDED';
  beforeRefundVersion: number;
  changed: boolean;
  kind: 'MANUAL_REQUIRED' | 'REFUNDED' | 'REPLAY';
  orderId: string;
  refundId: string;
}

function requireExactKeys(value: object, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new TypeError(`${label} has unknown or missing fields`);
  }
}

function requireUlid(value: string, label: string): void {
  if (typeof value !== 'string' || !isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function internalError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function paymentNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Payment intent not found');
}

function orderNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Order not found');
}

function orderVersionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Order version changed');
}

function paymentResultConflict(): ApplicationError {
  return new ApplicationError('PAYMENT_RESULT_CONFLICT', 'Payment result conflicts with current state');
}

function paymentNotAllowed(): ApplicationError {
  return new ApplicationError('PAYMENT_NOT_ALLOWED', 'Order cannot be paid');
}

function paymentExpired(): ApplicationError {
  return new ApplicationError('ORDER_PAYMENT_EXPIRED', 'Order payment window expired');
}

function configurationUnavailable(): ApplicationError {
  return new ApplicationError('PAYMENT_CONFIGURATION_UNAVAILABLE', 'Payment configuration is unavailable');
}

function safeDate(value: Date | null, label: string): Date | null {
  if (value === null) return null;
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internalError(`${label} is invalid`);
  return new Date(value);
}

function safeVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POSTGRES_INTEGER) {
    throw internalError(`${label} version is invalid`);
  }
  return value;
}

function safeMoney(value: Prisma.Decimal, label: string, positive = false): string {
  if (!Prisma.Decimal.isDecimal(value) || value.isNegative() || (positive && !value.greaterThan(0)) ||
    value.decimalPlaces() > 2 || value.greaterThan('9999999999999999.99')) {
    throw internalError(`${label} is invalid`);
  }
  return value.toFixed(2);
}

function safeNullableText(value: string | null, maximum: number, label: string): string | null {
  if (value === null) return null;
  if (value.length < 1 || value.length > maximum || !SAFE_PROVIDER_VALUE.test(value)) {
    throw internalError(`${label} is invalid`);
  }
  return value;
}

function paymentIntentSnapshot(record: PaymentIntentRecord, serverTime: Date): StorePaymentIntentSnapshot {
  requireUlid(record.id, 'Stored payment intent ID');
  requireUlid(record.order_id, 'Stored payment order ID');
  if (record.intent_no.length < 1 || record.intent_no.length > 32 ||
    !SAFE_PROVIDER_VALUE.test(record.intent_no) || !PAYMENT_PROVIDERS.has(record.provider)) {
    throw internalError('Stored payment intent identity is invalid');
  }
  return {
    amount: safeMoney(record.amount, 'Stored payment amount', true),
    createRequestedAt: safeDate(record.create_requested_at, 'Stored payment creation time')!,
    expiresAt: safeDate(record.expires_at, 'Stored payment expiry')!,
    intentNo: record.intent_no,
    lastErrorCode: safeNullableText(record.last_error_code, 120, 'Stored payment error code'),
    nextReconcileAt: safeDate(record.next_reconcile_at, 'Stored payment reconciliation time'),
    openedAt: safeDate(record.opened_at, 'Stored payment opened time'),
    orderId: record.order_id,
    paymentIntentId: record.id,
    provider: record.provider,
    providerIntentId: safeNullableText(record.provider_intent_id, 128, 'Stored provider intent ID'),
    providerState: safeNullableText(record.provider_state, 80, 'Stored provider state'),
    serverTime: safeDate(serverTime, 'Payment server time')!,
    status: record.status,
    updatedAt: safeDate(record.updated_at, 'Stored payment update time')!,
    version: safeVersion(record.version, 'Stored payment intent'),
  };
}

function validatePrepareInput(input: StorePaymentPrepareInput): void {
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'expectedVersion', 'orderId', 'provider', 'reconcileAfterMs'],
    'Store payment prepare input',
  );
  requireUlid(input.accountId, 'Store payment Account ID');
  requireUlid(input.customerId, 'Store payment Customer ID');
  requireUlid(input.orderId, 'Store payment Order ID');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
    input.expectedVersion > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Store payment expected version is invalid');
  }
  if (!PAYMENT_PROVIDERS.has(input.provider)) throw new TypeError('Store payment provider is invalid');
  if (!Number.isSafeInteger(input.reconcileAfterMs) || input.reconcileAfterMs < 1 ||
    input.reconcileAfterMs > MAX_RECONCILE_DELAY_MS) {
    throw new TypeError('Store payment reconciliation delay is invalid');
  }
}

function validateProviderCreateRevalidationInput(input: StorePaymentProviderCreateRevalidationInput): void {
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'expectedIntentVersion', 'orderId', 'paymentIntentId', 'provider'],
    'Store payment Provider create revalidation input',
  );
  requireUlid(input.accountId, 'Store payment Account ID');
  requireUlid(input.customerId, 'Store payment Customer ID');
  requireUlid(input.orderId, 'Store payment Order ID');
  requireUlid(input.paymentIntentId, 'Store payment intent ID');
  if (!Number.isSafeInteger(input.expectedIntentVersion) || input.expectedIntentVersion < 1 ||
    input.expectedIntentVersion > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Store payment intent expected version is invalid');
  }
  if (!PAYMENT_PROVIDERS.has(input.provider)) throw new TypeError('Store payment provider is invalid');
}

function validateProviderText(value: string, maximum: number, label: string): void {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximum ||
    !SAFE_PROVIDER_VALUE.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
}

function validateFinalizeInput(input: StorePaymentFinalizeInput): void {
  requireExactKeys(
    input,
    ['expectedVersion', 'orderId', 'paymentIntentId', 'provider', 'result'],
    'Store payment finalize input',
  );
  requireUlid(input.orderId, 'Store payment Order ID');
  requireUlid(input.paymentIntentId, 'Store payment intent ID');
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 ||
    input.expectedVersion > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Store payment intent expected version is invalid');
  }
  if (!PAYMENT_PROVIDERS.has(input.provider)) throw new TypeError('Store payment provider is invalid');
  if (typeof input.result !== 'object' || input.result === null || Array.isArray(input.result)) {
    throw new TypeError('Store payment Provider result is invalid');
  }
  if (input.result.kind === 'OPEN') {
    requireExactKeys(
      input.result,
      ['kind', 'nextReconcileAt', 'providerIntentId', 'providerState'],
      'Store payment OPEN result',
    );
    validateProviderText(input.result.providerIntentId, 128, 'Provider intent ID');
    validateProviderText(input.result.providerState, 80, 'Provider state');
  } else if (input.result.kind === 'TERMINAL') {
    requireExactKeys(
      input.result,
      ['errorCode', 'kind', 'providerIntentId', 'providerState', 'status'],
      'Store payment terminal result',
    );
    if (!new Set(['CANCELLED', 'CLOSED', 'EXPIRED', 'FAILED']).has(input.result.status)) {
      throw new TypeError('Store payment terminal status is invalid');
    }
    if (input.result.providerIntentId !== null) {
      validateProviderText(input.result.providerIntentId, 128, 'Provider intent ID');
    }
    validateProviderText(input.result.providerState, 80, 'Provider state');
    if (input.result.errorCode !== null && !SAFE_ERROR_CODE.test(input.result.errorCode)) {
      throw new TypeError('Store payment error code is invalid');
    }
  } else if (input.result.kind === 'UNKNOWN') {
    requireExactKeys(
      input.result,
      ['errorCode', 'kind', 'nextReconcileAt', 'providerState'],
      'Store payment UNKNOWN result',
    );
    if (!SAFE_ERROR_CODE.test(input.result.errorCode)) throw new TypeError('Store payment error code is invalid');
    if (input.result.providerState !== null) {
      validateProviderText(input.result.providerState, 80, 'Provider state');
    }
  } else {
    throw new TypeError('Store payment Provider result is invalid');
  }
  if ('nextReconcileAt' in input.result &&
    (!(input.result.nextReconcileAt instanceof Date) || !Number.isFinite(input.result.nextReconcileAt.getTime()))) {
    throw new TypeError('Store payment reconciliation time is invalid');
  }
}

function validateOwnedReadInput(input: StorePaymentOwnedReadInput): void {
  requireExactKeys(input, ['customerId', 'paymentIntentId'], 'Store payment read input');
  requireUlid(input.customerId, 'Store payment Customer ID');
  requireUlid(input.paymentIntentId, 'Store payment intent ID');
}

function validateCallbackInput(input: StorePaymentCallbackInput): void {
  requireExactKeys(
    input,
    [
      'amount',
      'eventType',
      'occurredAt',
      'outcome',
      'provider',
      'providerEventId',
      'providerIntentId',
      'providerTransactionId',
    ],
    'Store payment callback input',
  );
  if (!PAYMENT_PROVIDERS.has(input.provider)) throw new TypeError('Store payment callback provider is invalid');
  if (!PAYMENT_CALLBACK_OUTCOMES.has(input.outcome) ||
    PAYMENT_CALLBACK_EVENT_TYPES.get(input.outcome) !== input.eventType) {
    throw new TypeError('Store payment callback event type does not match its outcome');
  }
  validateProviderText(input.providerEventId, 128, 'Provider event ID');
  validateProviderText(input.providerIntentId, 128, 'Provider intent ID');
  if (!MONEY.test(input.amount) || !new Prisma.Decimal(input.amount).greaterThan(0)) {
    throw new TypeError('Store payment callback amount is invalid');
  }
  if (input.outcome === 'SUCCEEDED') {
    if (input.providerTransactionId === null) {
      throw new TypeError('Successful payment callback requires a Provider transaction ID');
    }
    validateProviderText(input.providerTransactionId, 128, 'Provider transaction ID');
  } else if (input.providerTransactionId !== null) {
    throw new TypeError('Terminal payment callback must not contain a Provider transaction ID');
  }
  if (!(input.occurredAt instanceof Date) || !Number.isFinite(input.occurredAt.getTime())) {
    throw new TypeError('Store payment callback occurrence time is invalid');
  }
}

function validateLateRefundOperation(input: StoreLatePaymentRefundOperation): void {
  requireExactKeys(input, [
    'amount',
    'orderId',
    'paymentIntentId',
    'provider',
    'providerIntentId',
    'providerTransactionId',
    'refundAttemptId',
    'refundId',
    'refundNo',
    'refundVersion',
  ], 'Late payment refund operation');
  requireUlid(input.orderId, 'Late payment refund Order ID');
  requireUlid(input.paymentIntentId, 'Late payment refund Payment Intent ID');
  requireUlid(input.refundAttemptId, 'Late payment refund Attempt ID');
  requireUlid(input.refundId, 'Late payment refund ID');
  if (!PAYMENT_PROVIDERS.has(input.provider)) throw new TypeError('Late payment refund provider is invalid');
  validateProviderText(input.providerIntentId, 128, 'Late payment refund Provider Intent ID');
  validateProviderText(input.providerTransactionId, 128, 'Late payment refund Provider Transaction ID');
  validateProviderText(input.refundNo, 32, 'Late payment refund number');
  if (!MONEY.test(input.amount) || !new Prisma.Decimal(input.amount).greaterThan(0)) {
    throw new TypeError('Late payment refund amount is invalid');
  }
  if (!Number.isSafeInteger(input.refundVersion) || input.refundVersion < 1 ||
    input.refundVersion > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Late payment refund version is invalid');
  }
}

function validateLateRefundFinalization(input: StoreLatePaymentRefundFinalizeInput): void {
  requireExactKeys(input, ['operation', 'result'], 'Late payment refund finalization');
  validateLateRefundOperation(input.operation);
  if (input.result.kind === 'SUCCEEDED') {
    requireExactKeys(
      input.result,
      ['kind', 'occurredAt', 'providerEventId', 'providerRefundId'],
      'Successful late payment refund result',
    );
    validateProviderText(input.result.providerEventId, 128, 'Late payment refund Provider Event ID');
    validateProviderText(input.result.providerRefundId, 128, 'Late payment refund Provider Refund ID');
    if (!(input.result.occurredAt instanceof Date) || !Number.isFinite(input.result.occurredAt.getTime())) {
      throw new TypeError('Late payment refund occurrence time is invalid');
    }
    return;
  }
  requireExactKeys(input.result, ['failureCode', 'kind', 'occurredAt'], 'Failed late payment refund result');
  if (!SAFE_ERROR_CODE.test(input.result.failureCode)) {
    throw new TypeError('Late payment refund failure code is invalid');
  }
  if (input.result.occurredAt !== null &&
    (!(input.result.occurredAt instanceof Date) || !Number.isFinite(input.result.occurredAt.getTime()))) {
    throw new TypeError('Late payment refund failure time is invalid');
  }
}

function callbackState(record: {
  order_status: StorePaymentCallbackState['orderStatus'];
  payment_resolution: StorePaymentCallbackState['orderPaymentResolution'];
  payment_status: StorePaymentCallbackState['orderPaymentStatus'];
  version: number;
}, intent: { status: StorePaymentIntentStatus; version: number }): StorePaymentCallbackState {
  return {
    intentStatus: intent.status,
    intentVersion: safeVersion(intent.version, 'Stored payment intent'),
    orderPaymentResolution: record.payment_resolution,
    orderPaymentStatus: record.payment_status,
    orderStatus: record.order_status,
    orderVersion: safeVersion(record.version, 'Stored payment order'),
  };
}

function maskedNickname(value: string | null): string | null {
  if (value === null) return null;
  const characters = Array.from(value.trim());
  if (characters.length === 0) return null;
  return `${characters[0]}**`;
}

function settlementCity(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined || codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) return null;
  }
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  return length >= 1 && length <= 80 ? normalized : null;
}

function orderPaymentBaseEligible(record: PaymentOrderRecord): boolean {
  return record.order_status === 'PENDING_PAYMENT' &&
    record.refund_progress_status === 'NONE' && record.refund_processing_status === 'IDLE' &&
    record.fulfillment_status === 'NOT_STARTED' && record.close_reason === null && record.closed_at === null &&
    record.completion_reason === null && record.completed_at === null && record.payment_resolution === 'NORMAL' &&
    record.inventory_reservation?.status === 'ACTIVE' &&
    new Prisma.Decimal(record.paid_amount).equals(0) && new Prisma.Decimal(record.refunded_amount).equals(0) &&
    new Prisma.Decimal(record.payable_amount).greaterThan(0);
}

function paymentAmountsClose(
  goodsAmount: Prisma.Decimal,
  shippingAmount: Prisma.Decimal,
  payableAmount: Prisma.Decimal,
  itemAmounts: Prisma.Decimal[],
): boolean {
  if (itemAmounts.length === 0 || !shippingAmount.equals(0) || !goodsAmount.greaterThan(0)) return false;
  const itemTotal = itemAmounts.reduce(
    (total, amount) => total.add(amount),
    new Prisma.Decimal(0),
  );
  return itemTotal.equals(goodsAmount) && goodsAmount.add(shippingAmount).equals(payableAmount);
}

function orderEligibleForActiveIntent(
  record: PaymentOrderRecord,
  intentStatus: 'CREATING' | 'OPEN' | 'CLOSE_PENDING',
): boolean {
  if (!orderPaymentBaseEligible(record)) return false;
  return intentStatus === 'CREATING'
    ? record.payment_status === 'UNPAID' || record.payment_status === 'PROCESSING'
    : record.payment_status === 'PROCESSING';
}

function finalizationAlreadyApplied(
  record: PaymentIntentRecord,
  order: PaymentOrderRecord,
  result: StorePaymentProviderFinalization,
): boolean {
  if (result.kind === 'OPEN') {
    return record.status === 'OPEN' && record.provider_intent_id === result.providerIntentId &&
      order.payment_status === 'PROCESSING';
  }
  if (result.kind === 'TERMINAL') {
    return record.status === result.status &&
      (result.providerIntentId === null || record.provider_intent_id === result.providerIntentId) &&
      order.payment_status === 'UNPAID';
  }
  return ACTIVE_INTENT_STATUSES.has(record.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING') &&
    record.last_error_code === result.errorCode &&
    record.next_reconcile_at?.getTime() === result.nextReconcileAt.getTime();
}

export class StorePaymentRepository {
  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const value = rows[0]?.transaction_time;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw internalError('Database transaction clock is unavailable');
    }
    return new Date(value);
  }

  private async authenticateCustomer(
    transaction: DatabaseTransaction,
    accountId: string,
    customerId: string,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'store-auth-account', [accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [customerId]);
    const account = await transaction.account.findUnique({
      where: { id: accountId },
      select: {
        customer_profile: { select: { account_id: true, anonymized_at: true, id: true } },
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
      },
    });
    const customer = account?.customer_profile;
    if (!account || account.role !== 'CUSTOMER' || account.status !== 'ACTIVE' ||
      account.deleted_at !== null || account.login_name !== null || account.password_hash !== null ||
      account.wechat_open_id === null || !customer || customer.id !== customerId ||
      customer.account_id !== accountId || customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
  }

  private async lockOrder(
    transaction: DatabaseTransaction,
    orderId: string,
    customerId?: string,
  ): Promise<void> {
    const rows = customerId === undefined
      ? await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM sales_order WHERE id = ${orderId} FOR UPDATE`,
        )
      : await transaction.$queryRaw<Array<{ id: string }>>(
          Prisma.sql`SELECT id FROM sales_order WHERE id = ${orderId} AND customer_id = ${customerId} FOR UPDATE`,
        );
    if (rows.length !== 1 || rows[0]?.id !== orderId) throw orderNotFound();
  }

  private async ensurePaymentAmountClosure(
    transaction: DatabaseTransaction,
    orderId: string,
    order: Pick<PaymentOrderRecord, 'goods_amount' | 'payable_amount' | 'shipping_amount'>,
  ): Promise<void> {
    const items = await transaction.orderItem.findMany({
      orderBy: [{ id: 'asc' }],
      select: { line_paid_amount: true },
      where: { order_id: orderId },
    });
    if (!paymentAmountsClose(
      order.goods_amount,
      order.shipping_amount,
      order.payable_amount,
      items.map(({ line_paid_amount }) => line_paid_amount),
    )) {
      throw paymentNotAllowed();
    }
  }

  private async ensureCommissionConfiguration(
    transaction: DatabaseTransaction,
    orderId: string,
    serverTime: Date,
  ): Promise<void> {
    const attribution = await transaction.orderAttributionCandidate.findUnique({
      select: {
        candidate_agent: {
          select: {
            account: { select: { deleted_at: true, role: true, status: true } },
            deleted_at: true,
            status: true,
          },
        },
        candidate_agent_id: true,
        submit_channel: true,
      },
      where: { order_id: orderId },
    });
    const agent = attribution?.candidate_agent;
    if (attribution?.submit_channel !== 'AGENT' || attribution.candidate_agent_id === null || !agent ||
      agent.status !== 'ACTIVE' || agent.deleted_at !== null || agent.account.role !== 'AGENT_ADMIN' ||
      agent.account.status !== 'ACTIVE' || agent.account.deleted_at !== null) {
      return;
    }

    const [versions, items] = await Promise.all([
      transaction.commissionRuleVersion.findMany({
        orderBy: [{ effective_at: 'desc' }, { id: 'desc' }],
        select: {
          effective_at: true,
          entries: {
            select: { configured_rate: true, target_id: true, target_key: true, target_type: true },
          },
          id: true,
        },
        take: 2,
        where: { effective_at: { lte: serverTime }, status: 'PUBLISHED' },
      }),
      transaction.orderItem.findMany({
        orderBy: [{ id: 'asc' }],
        select: {
          sku: { select: { product: { select: { category_id: true } } } },
          sku_id: true,
        },
        where: { order_id: orderId },
      }),
    ]);
    if (versions.length !== 1 || items.length === 0) throw configurationUnavailable();
    const version = versions[0]!;
    const entries = new Map<string, (typeof version.entries)[number]>();
    for (const entry of version.entries) {
      const validTarget = entry.target_type === 'PLATFORM'
        ? entry.target_id === null && entry.target_key === 'PLATFORM'
        : entry.target_id !== null && entry.target_key === `${entry.target_type}:${entry.target_id}`;
      if (!validTarget || entry.configured_rate.isNegative() || entry.configured_rate.greaterThan(100) ||
        entries.has(entry.target_key)) {
        throw configurationUnavailable();
      }
      entries.set(entry.target_key, entry);
    }
    if (!entries.has('PLATFORM')) throw configurationUnavailable();
    for (const item of items) {
      if (!entries.has(`SKU:${item.sku_id}`) &&
        !entries.has(`CATEGORY:${item.sku.product.category_id}`) && !entries.has('PLATFORM')) {
        throw configurationUnavailable();
      }
    }
  }


  async prepareOwnedPaymentIntentInTransaction(
    transaction: DatabaseTransaction,
    input: StorePaymentPrepareInput,
  ): Promise<StorePaymentPrepareResult> {
    validatePrepareInput(input);
    await this.authenticateCustomer(transaction, input.accountId, input.customerId);
    await this.lockOrder(transaction, input.orderId, input.customerId);
    const serverTime = await this.transactionTime(transaction);
    const order = await transaction.salesOrder.findUnique({
      where: { id: input.orderId },
      select: PAYMENT_ORDER_SELECT,
    });
    if (!order || order.customer_id !== input.customerId) throw orderNotFound();
    if (order.version !== input.expectedVersion) throw orderVersionConflict();
    if (order.pay_expires_at.getTime() <= serverTime.getTime()) throw paymentExpired();

    const intents = await transaction.paymentIntent.findMany({
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: PAYMENT_INTENT_SELECT,
      where: { order_id: input.orderId },
    });
    const active = intents.filter(({ status }) => ACTIVE_INTENT_STATUSES.has(
      status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING',
    ));
    if (active.length > 1) throw internalError('Order has multiple active payment intents');
    const existing = active[0];
    if (existing) {
      if (!orderEligibleForActiveIntent(order, existing.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING') ||
        existing.provider !== input.provider ||
        !existing.amount.equals(order.payable_amount) ||
        existing.expires_at.getTime() !== order.pay_expires_at.getTime()) {
        if (existing.provider !== input.provider) throw configurationUnavailable();
        throw paymentNotAllowed();
      }
      return {
        created: false,
        intent: paymentIntentSnapshot(existing, serverTime),
        providerOperation: 'QUERY',
      };
    }

    if (!orderPaymentBaseEligible(order) || order.payment_status !== 'UNPAID') throw paymentNotAllowed();
    if (intents.some(({ status }) => status === 'SUCCEEDED')) throw paymentNotAllowed();
    await this.ensurePaymentAmountClosure(transaction, input.orderId, order);
    await this.ensureCommissionConfiguration(transaction, input.orderId, serverTime);

    const paymentIntentId = generateUlid(serverTime.getTime());
    const requestedReconcileAt = new Date(serverTime.getTime() + input.reconcileAfterMs);
    const nextReconcileAt = requestedReconcileAt.getTime() < order.pay_expires_at.getTime()
      ? requestedReconcileAt
      : new Date(order.pay_expires_at);
    const created = await transaction.paymentIntent.create({
      data: {
        amount: order.payable_amount,
        close_attempt_count: 0,
        close_requested_at: null,
        closed_at: null,
        create_requested_at: serverTime,
        created_at: serverTime,
        expires_at: order.pay_expires_at,
        id: paymentIntentId,
        intent_no: `PI${paymentIntentId}`,
        last_error_code: null,
        last_reconciled_at: null,
        next_reconcile_at: nextReconcileAt,
        opened_at: null,
        order_id: input.orderId,
        provider: input.provider,
        provider_intent_id: null,
        provider_state: 'CREATE_REQUESTED',
        reconciliation_attempt_count: 0,
        status: 'CREATING',
        succeeded_at: null,
        updated_at: serverTime,
        version: 1,
      },
      select: PAYMENT_INTENT_SELECT,
    });
    return {
      created: true,
      intent: paymentIntentSnapshot(created, serverTime),
      providerOperation: 'CREATE',
    };
  }

  async revalidateProviderCreateInTransaction(
    transaction: DatabaseTransaction,
    input: StorePaymentProviderCreateRevalidationInput,
  ): Promise<StorePaymentIntentSnapshot> {
    validateProviderCreateRevalidationInput(input);
    await this.authenticateCustomer(transaction, input.accountId, input.customerId);
    await this.lockOrder(transaction, input.orderId, input.customerId);
    const intentLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.payment_intent
      WHERE id = ${input.paymentIntentId} AND order_id = ${input.orderId}
      FOR UPDATE
    `);
    if (intentLocks.length !== 1 || intentLocks[0]?.id !== input.paymentIntentId) throw paymentNotFound();
    const serverTime = await this.transactionTime(transaction);
    const [order, intent] = await Promise.all([
      transaction.salesOrder.findUnique({ where: { id: input.orderId }, select: PAYMENT_ORDER_SELECT }),
      transaction.paymentIntent.findUnique({ where: { id: input.paymentIntentId }, select: PAYMENT_INTENT_SELECT }),
    ]);
    if (!order || order.customer_id !== input.customerId || !intent || intent.order_id !== order.id) {
      throw paymentNotFound();
    }
    if (intent.version !== input.expectedIntentVersion || intent.provider !== input.provider ||
      intent.status !== 'CREATING' || intent.provider_intent_id !== null ||
      !intent.amount.equals(order.payable_amount) ||
      intent.expires_at.getTime() !== order.pay_expires_at.getTime()) {
      throw paymentResultConflict();
    }
    if (order.pay_expires_at.getTime() <= serverTime.getTime()) throw paymentExpired();
    if (!orderPaymentBaseEligible(order) || order.payment_status !== 'UNPAID') throw paymentNotAllowed();
    await this.ensurePaymentAmountClosure(transaction, order.id, order);
    await this.ensureCommissionConfiguration(transaction, order.id, serverTime);
    return paymentIntentSnapshot(intent, serverTime);
  }

  async finalizeProviderOutcomeInTransaction(
    transaction: DatabaseTransaction,
    input: StorePaymentFinalizeInput,
  ): Promise<StorePaymentFinalizeResult> {
    validateFinalizeInput(input);
    await this.lockOrder(transaction, input.orderId);
    const locked = await transaction.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM payment_intent
        WHERE id = ${input.paymentIntentId} AND order_id = ${input.orderId}
        FOR UPDATE`,
    );
    if (locked.length !== 1 || locked[0]?.id !== input.paymentIntentId) throw paymentNotFound();
    const serverTime = await this.transactionTime(transaction);
    const record = await transaction.paymentIntent.findUnique({
      where: { id: input.paymentIntentId },
      select: PAYMENT_INTENT_SELECT,
    });
    if (!record || record.order_id !== input.orderId) throw paymentNotFound();
    const order = await transaction.salesOrder.findUnique({
      where: { id: input.orderId },
      select: PAYMENT_ORDER_SELECT,
    });
    if (!order) throw orderNotFound();
    if (record.provider !== input.provider) throw paymentResultConflict();
    if (finalizationAlreadyApplied(record, order, input.result)) {
      return { changed: false, intent: paymentIntentSnapshot(record, serverTime) };
    }
    if (record.version !== input.expectedVersion) {
      throw paymentResultConflict();
    }
    if (record.status === 'SUCCEEDED') throw paymentResultConflict();

    let data: Prisma.PaymentIntentUpdateManyMutationInput;
    if (input.result.kind === 'OPEN') {
      if (!ACTIVE_INTENT_STATUSES.has(record.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING')) {
        throw paymentResultConflict();
      }
      if (!orderPaymentBaseEligible(order) ||
        (order.payment_status !== 'UNPAID' && order.payment_status !== 'PROCESSING')) {
        throw paymentResultConflict();
      }
      if (input.result.nextReconcileAt.getTime() <= serverTime.getTime() ||
        input.result.nextReconcileAt.getTime() > serverTime.getTime() + MAX_RECONCILE_DELAY_MS) {
        throw new TypeError('Store payment reconciliation time is invalid');
      }
      data = {
        last_error_code: null,
        next_reconcile_at: input.result.nextReconcileAt,
        opened_at: record.opened_at ?? serverTime,
        provider_intent_id: input.result.providerIntentId,
        provider_state: input.result.providerState,
        status: record.status === 'CLOSE_PENDING' ? 'CLOSE_PENDING' : 'OPEN',
        updated_at: serverTime,
        version: { increment: 1 },
      };
    } else if (input.result.kind === 'TERMINAL') {
      if (!ACTIVE_INTENT_STATUSES.has(record.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING')) {
        throw paymentResultConflict();
      }
      if (!orderPaymentBaseEligible(order) ||
        (order.payment_status !== 'UNPAID' && order.payment_status !== 'PROCESSING')) {
        throw paymentResultConflict();
      }
      data = {
        closed_at: serverTime,
        last_error_code: input.result.errorCode,
        last_reconciled_at: serverTime,
        next_reconcile_at: null,
        provider_intent_id: input.result.providerIntentId ?? record.provider_intent_id,
        provider_state: input.result.providerState,
        status: input.result.status,
        updated_at: serverTime,
        version: { increment: 1 },
      };
    } else {
      if (!ACTIVE_INTENT_STATUSES.has(record.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING')) {
        return { changed: false, intent: paymentIntentSnapshot(record, serverTime) };
      }
      if (!orderPaymentBaseEligible(order) ||
        (order.payment_status !== 'UNPAID' && order.payment_status !== 'PROCESSING')) {
        throw paymentResultConflict();
      }
      if (input.result.nextReconcileAt.getTime() <= serverTime.getTime() ||
        input.result.nextReconcileAt.getTime() > serverTime.getTime() + MAX_RECONCILE_DELAY_MS) {
        throw new TypeError('Store payment reconciliation time is invalid');
      }
      data = {
        last_error_code: input.result.errorCode,
        last_reconciled_at: serverTime,
        next_reconcile_at: input.result.nextReconcileAt,
        provider_state: input.result.providerState ?? record.provider_state,
        reconciliation_attempt_count: { increment: 1 },
        updated_at: serverTime,
        version: { increment: 1 },
      };
    }

    const nextOrderPaymentStatus = input.result.kind === 'OPEN'
      ? 'PROCESSING'
      : input.result.kind === 'TERMINAL' ? 'UNPAID' : order.payment_status;
    if (nextOrderPaymentStatus !== order.payment_status) {
      const orderChanged = await transaction.salesOrder.updateMany({
        data: {
          payment_status: nextOrderPaymentStatus,
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: {
          id: input.orderId,
          payment_status: order.payment_status,
          version: order.version,
        },
      });
      if (orderChanged.count !== 1) throw paymentResultConflict();
    }

    try {
      const changed = await transaction.paymentIntent.updateMany({
        data,
        where: { id: input.paymentIntentId, order_id: input.orderId, version: input.expectedVersion },
      });
      if (changed.count !== 1) throw paymentResultConflict();
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw paymentResultConflict();
      }
      throw cause;
    }
    const updated = await transaction.paymentIntent.findUnique({
      where: { id: input.paymentIntentId },
      select: PAYMENT_INTENT_SELECT,
    });
    if (!updated) throw internalError('Updated payment intent is unavailable');
    return { changed: true, intent: paymentIntentSnapshot(updated, serverTime) };
  }

  async applyPaymentCallbackInTransaction(
    transaction: DatabaseTransaction,
    input: StorePaymentCallbackInput,
  ): Promise<StorePaymentCallbackResult> {
    validateCallbackInput(input);
    const located = await transaction.paymentIntent.findUnique({
      select: { id: true, order_id: true },
      where: {
        provider_provider_intent_id: {
          provider: input.provider,
          provider_intent_id: input.providerIntentId,
        },
      },
    });
    if (!located) throw paymentNotFound();
    const candidateBeforeLock = await transaction.orderAttributionCandidate.findUnique({
      select: { binding_id: true, candidate_agent_id: true },
      where: { order_id: located.order_id },
    });
    const candidateAgentId = candidateBeforeLock?.candidate_agent_id ?? null;
    let lockedAgentVersion: number | null = null;
    if (candidateAgentId !== null) {
      await acquireTransactionLock(transaction, 'store-attribution-agent', [candidateAgentId]);
      const agents = await transaction.$queryRaw<Array<{ id: string; version: number }>>(Prisma.sql`
        SELECT id, version FROM public.agent_profile
        WHERE id = ${candidateAgentId}
        FOR UPDATE
      `);
      if (agents.length === 1 && agents[0]?.id === candidateAgentId) {
        lockedAgentVersion = agents[0].version;
      }
    }
    await this.lockOrder(transaction, located.order_id);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.order_item
      WHERE order_id = ${located.order_id}
      ORDER BY id ASC
      FOR UPDATE
    `);
    const intentLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.payment_intent
      WHERE id = ${located.id} AND order_id = ${located.order_id}
      FOR UPDATE
    `);
    if (intentLocks.length !== 1 || intentLocks[0]?.id !== located.id) throw paymentNotFound();
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.payment_attempt
      WHERE payment_intent_id = ${located.id}
      ORDER BY id ASC
      FOR UPDATE
    `);
    let lockedBindingId: string | null = null;
    if (candidateAgentId !== null && candidateBeforeLock?.binding_id !== null &&
      candidateBeforeLock?.binding_id !== undefined) {
      const bindings = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM public.customer_agent_binding
        WHERE id = ${candidateBeforeLock.binding_id}
        FOR UPDATE
      `);
      if (bindings.length === 1 && bindings[0]?.id === candidateBeforeLock.binding_id) {
        lockedBindingId = bindings[0].id;
      }
    }
    const serverTime = await this.transactionTime(transaction);
    const intent = await transaction.paymentIntent.findUnique({
      include: { attempts: { orderBy: [{ initiated_at: 'asc' }, { id: 'asc' }] } },
      where: { id: located.id },
    });
    const order = await transaction.salesOrder.findUnique({
      include: {
        address_snapshot: { select: { city: true } },
        attribution_candidate: true,
        attribution_snapshot: true,
        customer: {
          select: {
            id: true,
            nickname: true,
            phone_verifications: {
              orderBy: [{ verified_at: 'desc' }, { id: 'desc' }],
              select: { phone_last4: true },
              take: 2,
              where: { revoked_at: null },
            },
          },
        },
        inventory_reservation: {
          include: { items: { orderBy: [{ sku_id: 'asc' }, { id: 'asc' }] } },
        },
        items: { orderBy: [{ id: 'asc' }] },
      },
      where: { id: located.order_id },
    });
    if (!intent || !order || intent.order_id !== order.id || intent.provider !== input.provider ||
      intent.provider_intent_id !== input.providerIntentId || !intent.amount.equals(input.amount) ||
      !order.payable_amount.equals(input.amount)) {
      throw paymentResultConflict();
    }
    const before = callbackState(order, intent);
    const matchingAttempts = intent.attempts.filter(({ status }) => input.outcome === 'SUCCEEDED'
      ? status === 'SUCCEEDED' || status === 'SUCCEEDED_LATE'
      : status === input.outcome);
    if (matchingAttempts.length > 1) throw internalError('Payment intent has duplicate callback attempts');
    const matchingAttempt = matchingAttempts[0] ?? null;
    if (matchingAttempt && (!matchingAttempt.amount.equals(input.amount) ||
      matchingAttempt.provider !== input.provider ||
      matchingAttempt.provider_transaction_id !== input.providerTransactionId)) {
      throw paymentResultConflict();
    }
    const successfulAttempts = intent.attempts.filter(({ status }) =>
      status === 'SUCCEEDED' || status === 'SUCCEEDED_LATE');
    if (successfulAttempts.length > 1) throw internalError('Payment intent has duplicate successful attempts');
    const otherSuccess = successfulAttempts[0] ?? null;
    if (otherSuccess !== null) {
      const initiatedAt = otherSuccess.initiated_at;
      const finishedAt = otherSuccess.finished_at;
      const succeededAt = intent.succeeded_at;
      const successfulFactsExact = otherSuccess.amount.equals(intent.amount) &&
        otherSuccess.provider === intent.provider && otherSuccess.failure_code === null &&
        otherSuccess.provider_payload === null && typeof otherSuccess.provider_transaction_id === 'string' &&
        otherSuccess.provider_transaction_id.length > 0 && initiatedAt instanceof Date &&
        Number.isFinite(initiatedAt.getTime()) && finishedAt instanceof Date &&
        Number.isFinite(finishedAt.getTime()) && initiatedAt.getTime() === finishedAt.getTime() &&
        intent.status === 'SUCCEEDED' && intent.provider_state === 'SUCCEEDED' &&
        succeededAt instanceof Date && Number.isFinite(succeededAt.getTime()) &&
        succeededAt.getTime() === finishedAt.getTime() && intent.last_error_code === null &&
        intent.next_reconcile_at === null;
      if (!successfulFactsExact) throw internalError('Payment success facts are inconsistent');
    }
    if (otherSuccess && input.outcome !== 'SUCCEEDED') {
      return {
        after: before,
        before,
        changed: false,
        commissionLedgerIds: [],
        commissionSnapshotIds: [],
        finalAgentId: order.final_agent_id,
        finalChannel: order.final_channel,
        inventoryLedgerIds: [],
        kind: 'REPLAY',
        lateRefund: null,
        orderId: order.id,
        outcome: input.outcome,
        paymentAttemptId: matchingAttempt?.id ?? otherSuccess.id,
        paymentIntentId: intent.id,
        providerEventId: input.providerEventId,
        reservationId: order.inventory_reservation?.id ?? null,
      };
    }
    if (matchingAttempt === null && input.occurredAt.getTime() < intent.create_requested_at.getTime()) {
      throw paymentResultConflict();
    }
    if (matchingAttempt === null && input.outcome === 'SUCCEEDED' && order.order_status !== 'CLOSED' &&
      input.occurredAt.getTime() >= order.pay_expires_at.getTime()) {
      throw paymentResultConflict();
    }
    if (otherSuccess && matchingAttempt?.id !== otherSuccess.id) throw paymentResultConflict();

    if (input.outcome !== 'SUCCEEDED') {
      const targetStatus = input.outcome;
      if (matchingAttempt !== null) {
        if (intent.status !== targetStatus) throw paymentResultConflict();
        return {
          after: before,
          before,
          changed: false,
          commissionLedgerIds: [],
          commissionSnapshotIds: [],
          finalAgentId: order.final_agent_id,
          finalChannel: order.final_channel,
          inventoryLedgerIds: [],
          kind: 'REPLAY',
          lateRefund: null,
          orderId: order.id,
          outcome: input.outcome,
          paymentAttemptId: matchingAttempt.id,
          paymentIntentId: intent.id,
          providerEventId: input.providerEventId,
          reservationId: order.inventory_reservation?.id ?? null,
        };
      }
      if (intent.status === targetStatus) {
        const paymentAttemptId = generateUlid(serverTime.getTime());
        await transaction.paymentAttempt.create({
          data: {
            amount: intent.amount,
            failure_code: input.outcome === 'FAILED' ? 'PAYMENT_FAILED' : 'PAYMENT_CANCELLED',
            finished_at: input.occurredAt,
            id: paymentAttemptId,
            initiated_at: input.occurredAt,
            payment_intent_id: intent.id,
            provider: input.provider,
            provider_payload: Prisma.DbNull,
            provider_transaction_id: null,
            status: input.outcome,
          },
        });
        return {
          after: before,
          before,
          changed: true,
          commissionLedgerIds: [],
          commissionSnapshotIds: [],
          finalAgentId: order.final_agent_id,
          finalChannel: order.final_channel,
          inventoryLedgerIds: [],
          kind: 'ATTEMPT_RECORDED',
          lateRefund: null,
          orderId: order.id,
          outcome: input.outcome,
          paymentAttemptId,
          paymentIntentId: intent.id,
          providerEventId: input.providerEventId,
          reservationId: order.inventory_reservation?.id ?? null,
        };
      }
      if (!ACTIVE_INTENT_STATUSES.has(intent.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING') ||
        order.order_status !== 'PENDING_PAYMENT' ||
        (order.payment_status !== 'PROCESSING' && order.payment_status !== 'UNPAID') ||
        order.payment_resolution !== 'NORMAL') {
        throw paymentResultConflict();
      }
      const paymentAttemptId = generateUlid(serverTime.getTime());
      await transaction.paymentAttempt.create({
        data: {
          amount: intent.amount,
          failure_code: input.outcome === 'FAILED' ? 'PAYMENT_FAILED' : 'PAYMENT_CANCELLED',
          finished_at: input.occurredAt,
          id: paymentAttemptId,
          initiated_at: input.occurredAt,
          payment_intent_id: intent.id,
          provider: input.provider,
          provider_payload: Prisma.DbNull,
          provider_transaction_id: null,
          status: input.outcome,
        },
      });
      const intentChanged = await transaction.paymentIntent.updateMany({
        data: {
          closed_at: input.occurredAt,
          last_error_code: input.outcome === 'FAILED' ? 'PAYMENT_FAILED' : 'PAYMENT_CANCELLED',
          last_reconciled_at: serverTime,
          next_reconcile_at: null,
          provider_state: input.outcome,
          status: targetStatus,
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: intent.id, order_id: order.id, version: intent.version },
      });
      if (intentChanged.count !== 1) throw paymentResultConflict();
      let orderVersion = order.version;
      if (order.payment_status !== 'UNPAID') {
        const orderChanged = await transaction.salesOrder.updateMany({
          data: { payment_status: 'UNPAID', updated_at: serverTime, version: { increment: 1 } },
          where: { id: order.id, payment_status: order.payment_status, version: order.version },
        });
        if (orderChanged.count !== 1) throw paymentResultConflict();
        orderVersion += 1;
      }
      const after: StorePaymentCallbackState = {
        intentStatus: targetStatus,
        intentVersion: intent.version + 1,
        orderPaymentResolution: order.payment_resolution,
        orderPaymentStatus: 'UNPAID',
        orderStatus: order.order_status,
        orderVersion,
      };
      return {
        after,
        before,
        changed: true,
        commissionLedgerIds: [],
        commissionSnapshotIds: [],
        finalAgentId: null,
        finalChannel: null,
        inventoryLedgerIds: [],
        kind: 'TERMINAL',
        lateRefund: null,
        orderId: order.id,
        outcome: input.outcome,
        paymentAttemptId,
        paymentIntentId: intent.id,
        providerEventId: input.providerEventId,
        reservationId: order.inventory_reservation?.id ?? null,
      };
    }

    if (order.order_status === 'CLOSED') {
      const lateRefunds = await transaction.refund.findMany({
        include: {
          attempts: { orderBy: [{ attempt_no: 'asc' }, { id: 'asc' }] },
          items: { orderBy: [{ order_item_id: 'asc' }, { id: 'asc' }] },
        },
        orderBy: [{ id: 'asc' }],
        where: { order_id: order.id, origin_type: 'LATE_PAYMENT' },
      });
      if (lateRefunds.length > 1) throw internalError('Order has duplicate late payment refunds');
      const existingRefund = lateRefunds[0] ?? null;
      if (matchingAttempt?.status === 'SUCCEEDED') {
        return {
          after: before,
          before,
          changed: false,
          commissionLedgerIds: [],
          commissionSnapshotIds: [],
          finalAgentId: order.final_agent_id,
          finalChannel: order.final_channel,
          inventoryLedgerIds: [],
          kind: 'REPLAY',
          lateRefund: null,
          orderId: order.id,
          outcome: input.outcome,
          paymentAttemptId: matchingAttempt.id,
          paymentIntentId: intent.id,
          providerEventId: input.providerEventId,
          reservationId: order.inventory_reservation?.id ?? null,
        };
      }
      if (matchingAttempt?.status === 'SUCCEEDED_LATE') {
        const latestRefundAttempt = existingRefund?.attempts.at(-1);
        const attemptSequenceValid = existingRefund?.attempts.every((attempt, index) =>
          attempt.attempt_no === index + 1 &&
          attempt.idempotency_key === `late-payment:${existingRefund.id}:${index + 1}`) ?? false;
        if (!existingRefund || existingRefund.attempts.length < 1 || !latestRefundAttempt ||
          !attemptSequenceValid ||
          existingRefund.items.length !== order.items.length ||
          existingRefund.amount.toFixed(2) !== input.amount || existingRefund.provider !== input.provider ||
          existingRefund.is_late_payment_refund !== true || existingRefund.refund_no !== `RF${existingRefund.id}` ||
          latestRefundAttempt.provider !== input.provider) {
          throw internalError('Late payment refund facts are incomplete');
        }
        const operation: StoreLatePaymentRefundOperation = {
          amount: input.amount,
          orderId: order.id,
          paymentIntentId: intent.id,
          provider: input.provider,
          providerIntentId: input.providerIntentId,
          providerTransactionId: input.providerTransactionId!,
          refundAttemptId: latestRefundAttempt.id,
          refundId: existingRefund.id,
          refundNo: existingRefund.refund_no,
          refundVersion: existingRefund.version,
        };
        const pending = order.payment_status === 'PAID' &&
          order.payment_resolution === 'LATE_SUCCESS_REFUND_PENDING' &&
          order.refund_progress_status === 'NONE' && order.refund_processing_status === 'REFUNDING' &&
          order.paid_amount.equals(order.payable_amount) && order.refunded_amount.equals(0) &&
          (existingRefund.status === 'PENDING' || existingRefund.status === 'PROCESSING') &&
          (latestRefundAttempt.status === 'INITIATED' || latestRefundAttempt.status === 'PROCESSING');
        if (pending) {
          return {
            after: before,
            before,
            changed: false,
            commissionLedgerIds: [],
            commissionSnapshotIds: [],
            finalAgentId: null,
            finalChannel: null,
            inventoryLedgerIds: [],
            kind: 'LATE_REFUND_REQUIRED',
            lateRefund: operation,
            orderId: order.id,
            outcome: input.outcome,
            paymentAttemptId: matchingAttempt.id,
            paymentIntentId: intent.id,
            providerEventId: input.providerEventId,
            reservationId: order.inventory_reservation?.id ?? null,
          };
        }
        const refunded = existingRefund.status === 'SUCCEEDED' &&
          latestRefundAttempt.status === 'SUCCEEDED' && order.payment_status === 'PAID' &&
          order.payment_resolution === 'LATE_SUCCESS_REFUNDED' && order.refund_progress_status === 'FULL' &&
          order.refund_processing_status === 'IDLE' && order.refunded_amount.equals(order.paid_amount);
        const manual = existingRefund.status === 'FAILED' &&
          latestRefundAttempt.status === 'FAILED' && order.payment_status === 'PAID' &&
          order.payment_resolution === 'MANUAL_REQUIRED' && order.refund_progress_status === 'NONE' &&
          order.refund_processing_status === 'FAILED' && order.refunded_amount.equals(0);
        if (!refunded && !manual) throw internalError('Late payment refund state is inconsistent');
        return {
          after: before,
          before,
          changed: false,
          commissionLedgerIds: [],
          commissionSnapshotIds: [],
          finalAgentId: null,
          finalChannel: null,
          inventoryLedgerIds: [],
          kind: 'REPLAY',
          lateRefund: null,
          orderId: order.id,
          outcome: input.outcome,
          paymentAttemptId: matchingAttempt.id,
          paymentIntentId: intent.id,
          providerEventId: input.providerEventId,
          reservationId: order.inventory_reservation?.id ?? null,
        };
      }

      const reservation = order.inventory_reservation;
      const expectedReservationStatus = order.close_reason === 'PAYMENT_TIMEOUT' ? 'EXPIRED' : 'RELEASED';
      const itemAmountsClose = paymentAmountsClose(
        order.goods_amount,
        order.shipping_amount,
        order.payable_amount,
        order.items.map(({ line_paid_amount }) => line_paid_amount),
      );
      const itemsClosed = order.items.length > 0 &&
        new Set(order.items.map(({ sku_id }) => sku_id)).size === order.items.length &&
        order.items.every((item) => item.refunded_qty === 0 && item.pre_shipment_refunded_qty === 0 &&
          item.refunded_amount.equals(0) && item.aftersale_reserved_qty === 0 &&
          item.aftersale_reserved_amount.equals(0) && item.shipped_qty === 0);
      const closedOrderEligible = (order.close_reason === 'USER_CANCELLED' ||
        order.close_reason === 'PAYMENT_TIMEOUT') && order.closed_at !== null && order.completed_at === null &&
        order.completion_reason === null && order.fulfillment_status === 'NOT_STARTED' &&
        order.payment_status === 'UNPAID' && order.payment_resolution === 'NORMAL' &&
        order.refund_progress_status === 'NONE' && order.refund_processing_status === 'IDLE' &&
        order.paid_amount.equals(0) && order.refunded_amount.equals(0) && order.final_agent_id === null &&
        order.final_channel === null && order.attribution_snapshot === null && itemAmountsClose && itemsClosed &&
        reservation !== null && reservation.status === expectedReservationStatus &&
        reservation.consumed_at === null && reservation.released_at !== null;
      if (!closedOrderEligible || existingRefund !== null ||
        !['CANCELLED', 'CLOSED', 'EXPIRED', 'FAILED'].includes(intent.status)) {
        throw paymentResultConflict();
      }
      const paidInventoryLedgers = await transaction.inventoryLedger.count({
        where: { business_id: reservation.id, ledger_type: 'ORDER_PAID_DEDUCT' },
      });
      const commissionSnapshots = await transaction.orderItemCommissionSnapshot.count({
        where: { order_item_id: { in: order.items.map(({ id }) => id) } },
      });
      if (paidInventoryLedgers !== 0 || commissionSnapshots !== 0) {
        throw internalError('Closed order already contains payment settlement facts');
      }

      const paymentAttemptId = generateUlid(serverTime.getTime());
      const refundId = generateUlid(serverTime.getTime());
      const refundAttemptId = generateUlid(serverTime.getTime());
      const refundNo = `RF${refundId}`;
      await transaction.paymentAttempt.create({
        data: {
          amount: intent.amount,
          failure_code: null,
          finished_at: input.occurredAt,
          id: paymentAttemptId,
          initiated_at: input.occurredAt,
          payment_intent_id: intent.id,
          provider: input.provider,
          provider_payload: Prisma.DbNull,
          provider_transaction_id: input.providerTransactionId,
          status: 'SUCCEEDED_LATE',
        },
      });
      const intentChanged = await transaction.paymentIntent.updateMany({
        data: {
          last_error_code: null,
          last_reconciled_at: serverTime,
          next_reconcile_at: null,
          provider_state: 'SUCCEEDED',
          status: 'SUCCEEDED',
          succeeded_at: input.occurredAt,
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: intent.id, order_id: order.id, version: intent.version },
      });
      if (intentChanged.count !== 1) throw paymentResultConflict();
      const orderChanged = await transaction.salesOrder.updateMany({
        data: {
          paid_amount: order.payable_amount,
          paid_at: input.occurredAt,
          payment_resolution: 'LATE_SUCCESS_REFUND_PENDING',
          payment_status: 'PAID',
          refund_processing_status: 'REFUNDING',
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: order.id, order_status: 'CLOSED', version: order.version },
      });
      if (orderChanged.count !== 1) throw paymentResultConflict();
      await transaction.refund.create({
        data: {
          aftersale_id: null,
          amount: order.payable_amount,
          failure_code: null,
          id: refundId,
          is_late_payment_refund: true,
          manual_compensation_id: null,
          order_id: order.id,
          origin_type: 'LATE_PAYMENT',
          provider: input.provider,
          provider_refund_id: null,
          reason: 'LATE_PAYMENT_AUTOMATIC_FULL_REFUND',
          refund_no: refundNo,
          requested_at: serverTime,
          status: 'PENDING',
          updated_at: serverTime,
          version: 1,
        },
      });
      for (const item of order.items) {
        await transaction.refundItem.create({
          data: {
            aftersale_item_id: null,
            amount: item.line_paid_amount,
            auto_restock: false,
            commission_reversal: new Prisma.Decimal(0),
            created_at: serverTime,
            id: generateUlid(serverTime.getTime()),
            order_item_id: item.id,
            quantity: item.quantity,
            refund_id: refundId,
          },
        });
      }
      await transaction.refundAttempt.create({
        data: {
          attempt_no: 1,
          failure_code: null,
          id: refundAttemptId,
          idempotency_key: `late-payment:${refundId}:1`,
          provider: input.provider,
          provider_payload: Prisma.DbNull,
          provider_request_id: null,
          refund_id: refundId,
          requested_at: serverTime,
          status: 'INITIATED',
        },
      });
      const operation: StoreLatePaymentRefundOperation = {
        amount: input.amount,
        orderId: order.id,
        paymentIntentId: intent.id,
        provider: input.provider,
        providerIntentId: input.providerIntentId,
        providerTransactionId: input.providerTransactionId!,
        refundAttemptId,
        refundId,
        refundNo,
        refundVersion: 1,
      };
      return {
        after: {
          intentStatus: 'SUCCEEDED',
          intentVersion: intent.version + 1,
          orderPaymentResolution: 'LATE_SUCCESS_REFUND_PENDING',
          orderPaymentStatus: 'PAID',
          orderStatus: 'CLOSED',
          orderVersion: order.version + 1,
        },
        before,
        changed: true,
        commissionLedgerIds: [],
        commissionSnapshotIds: [],
        finalAgentId: null,
        finalChannel: null,
        inventoryLedgerIds: [],
        kind: 'LATE_REFUND_REQUIRED',
        lateRefund: operation,
        orderId: order.id,
        outcome: input.outcome,
        paymentAttemptId,
        paymentIntentId: intent.id,
        providerEventId: input.providerEventId,
        reservationId: reservation.id,
      };
    }

    const compensating = matchingAttempt !== null;
    if (compensating) {
      if (intent.status !== 'SUCCEEDED') throw paymentResultConflict();
      const canCompensate = order.payment_status === 'PAID' &&
        order.payment_resolution === 'MANUAL_REQUIRED' && order.order_status === 'PENDING_PAYMENT' &&
        order.fulfillment_status === 'NOT_STARTED' && order.refund_progress_status === 'NONE' &&
        order.refund_processing_status === 'IDLE' && order.refunded_amount.equals(0) &&
        order.paid_amount.equals(order.payable_amount);
      if (!canCompensate) {
        return {
          after: before,
          before,
          changed: false,
          commissionLedgerIds: [],
          commissionSnapshotIds: [],
          finalAgentId: order.final_agent_id,
          finalChannel: order.final_channel,
          inventoryLedgerIds: [],
          kind: 'REPLAY',
          lateRefund: null,
          orderId: order.id,
          outcome: input.outcome,
          paymentAttemptId: matchingAttempt.id,
          paymentIntentId: intent.id,
          providerEventId: input.providerEventId,
          reservationId: order.inventory_reservation?.id ?? null,
        };
      }
    } else if (!ACTIVE_INTENT_STATUSES.has(intent.status as 'CREATING' | 'OPEN' | 'CLOSE_PENDING') ||
      order.order_status !== 'PENDING_PAYMENT' ||
      (order.payment_status !== 'PROCESSING' && order.payment_status !== 'UNPAID') ||
      order.payment_resolution !== 'NORMAL' || order.fulfillment_status !== 'NOT_STARTED' ||
      !order.paid_amount.equals(0)) {
      throw paymentResultConflict();
    }

    const productIds = [...new Set(order.items.map(({ product_id }) => product_id))].sort();
    const skuIds = [...new Set(order.items.map(({ sku_id }) => sku_id))].sort();
    const structurallyValidItems = order.items.length > 0 && productIds.length > 0 &&
      skuIds.length === order.items.length;
    if (productIds.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM public.product
        WHERE id IN (${Prisma.join(productIds)})
        ORDER BY id ASC
        FOR UPDATE
      `);
    }
    if (skuIds.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM public.sku
        WHERE id IN (${Prisma.join(skuIds)})
        ORDER BY id ASC
        FOR UPDATE
      `);
    }
    const catalog = skuIds.length === 0
      ? []
      : await transaction.sku.findMany({
          orderBy: [{ id: 'asc' }],
          select: {
            id: true,
            product: {
              select: { category: { select: { id: true, name: true } }, id: true, sales_count: true },
            },
          },
          where: { id: { in: skuIds } },
        });
    const balancesBeforeLock = await transaction.inventoryBalance.findMany({
      orderBy: [{ id: 'asc' }],
      select: { id: true, sku_id: true },
      where: { sku_id: { in: skuIds } },
    });
    const balanceIds = balancesBeforeLock.map(({ id }) => id).sort();
    if (balanceIds.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM public.inventory_balance
        WHERE id IN (${Prisma.join(balanceIds)})
        ORDER BY id ASC
        FOR UPDATE
      `);
    }
    if (order.inventory_reservation !== null) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM public.inventory_reservation
        WHERE id = ${order.inventory_reservation.id}
        FOR UPDATE
      `);
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM public.inventory_reservation_item
        WHERE reservation_id = ${order.inventory_reservation.id}
        ORDER BY sku_id ASC, id ASC
        FOR UPDATE
      `);
    }
    const balances = await transaction.inventoryBalance.findMany({
      orderBy: [{ sku_id: 'asc' }, { id: 'asc' }],
      where: { sku_id: { in: skuIds } },
    });
    const reservation = await transaction.inventoryReservation.findUnique({
      include: { items: { orderBy: [{ sku_id: 'asc' }, { id: 'asc' }] } },
      where: { order_id: order.id },
    });
    const activeTotals = skuIds.length === 0
      ? []
      : await transaction.$queryRaw<Array<{ sku_id: string; total_quantity: bigint }>>(Prisma.sql`
          SELECT iri.sku_id, SUM(iri.quantity)::bigint AS total_quantity
          FROM public.inventory_reservation AS ir
          INNER JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
          WHERE ir.status = 'ACTIVE' AND iri.sku_id IN (${Prisma.join(skuIds)})
          GROUP BY iri.sku_id
          ORDER BY iri.sku_id ASC
        `);

    const agent = candidateAgentId === null ? null : await transaction.agentProfile.findUnique({
      select: {
        account: { select: { deleted_at: true, role: true, status: true } },
        deleted_at: true,
        id: true,
        status: true,
        version: true,
      },
      where: { id: candidateAgentId },
    });
    const finalAgentId = order.attribution_candidate?.submit_channel === 'AGENT' &&
      order.attribution_candidate.candidate_agent_id === candidateAgentId && candidateAgentId !== null &&
      lockedAgentVersion !== null && agent?.id === candidateAgentId && agent.version === lockedAgentVersion &&
      agent.status === 'ACTIVE' && agent.deleted_at === null && agent.account.role === 'AGENT_ADMIN' &&
      agent.account.status === 'ACTIVE' && agent.account.deleted_at === null
      ? candidateAgentId
      : null;
    const candidateBinding = finalAgentId === null || lockedBindingId === null
      ? null
      : await transaction.customerAgentBinding.findUnique({
          select: { agent_id: true, customer_id: true, ended_at: true, id: true, started_at: true },
          where: { id: lockedBindingId },
        });

    const paymentAt = matchingAttempt?.finished_at ?? input.occurredAt;
    let ruleVersion: SettlementCommissionRuleVersion | null = null;
    let commissionWalletAvailable = true;
    if (finalAgentId !== null) {
      await acquireTransactionLock(transaction, 'commission-rule-config', ['singleton']);
      const ruleLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM public.commission_rule_version
        WHERE status IN ('PUBLISHED', 'ARCHIVED')
          AND effective_at <= ${paymentAt}
          AND effective_at <= ${serverTime}
        ORDER BY effective_at DESC, version_no DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `);
      if (ruleLocks.length === 1 && ruleLocks[0]) {
        ruleVersion = await transaction.commissionRuleVersion.findUnique({
          include: { entries: { orderBy: [{ target_key: 'asc' }, { id: 'asc' }] } },
          where: { id: ruleLocks[0].id },
        });
      }
      await acquireTransactionLock(transaction, 'agent-wallet', [finalAgentId]);
      const walletLocks = await transaction.$queryRaw<Array<{ agent_id: string; id: string }>>(Prisma.sql`
        SELECT id, agent_id FROM public.agent_wallet
        WHERE agent_id = ${finalAgentId}
        FOR UPDATE
      `);
      if (walletLocks.length !== 1 || walletLocks[0]?.agent_id !== finalAgentId ||
        !isValidUlid(walletLocks[0].id)) {
        commissionWalletAvailable = false;
      }
    }

    const balanceBySku = new Map(balances.map((balance) => [balance.sku_id, balance]));
    const totalBySku = new Map(activeTotals.map(({ sku_id, total_quantity }) => [sku_id, total_quantity]));
    const reservationBySku = new Map((reservation?.items ?? []).map((item) => [item.sku_id, item]));
    const attributionCandidate = order.attribution_candidate;
    const frozenCity = settlementCity(order.address_snapshot?.city);
    const bindingValidAtSubmission = finalAgentId === null || (
      attributionCandidate?.binding_id !== null && attributionCandidate?.binding_id === lockedBindingId &&
      candidateBinding?.id === lockedBindingId && candidateBinding.agent_id === finalAgentId &&
      candidateBinding.customer_id === order.customer_id &&
      candidateBinding.started_at.getTime() <= attributionCandidate.submitted_at.getTime() &&
      (candidateBinding.ended_at === null ||
        candidateBinding.ended_at.getTime() >= attributionCandidate.submitted_at.getTime())
    );
    const financialsClose = paymentAmountsClose(
      order.goods_amount,
      order.shipping_amount,
      order.payable_amount,
      order.items.map(({ line_paid_amount }) => line_paid_amount),
    );
    const reservationExpiry = reservation?.expires_at;
    const paymentTimestampClosed = compensating
      ? order.paid_at?.getTime() === matchingAttempt.finished_at?.getTime()
      : order.paid_at === null;
    const paymentStateClosed = reservationExpiry instanceof Date &&
      Number.isFinite(reservationExpiry.getTime()) && order.refund_progress_status === 'NONE' &&
      order.refund_processing_status === 'IDLE' && order.refunded_amount.equals(0) &&
      paymentTimestampClosed &&
      intent.expires_at.getTime() === order.pay_expires_at.getTime() &&
      reservationExpiry.getTime() === order.pay_expires_at.getTime() &&
      paymentAt.getTime() < intent.expires_at.getTime() &&
      paymentAt.getTime() < reservationExpiry.getTime();
    let settlementAvailable = attributionCandidate !== null && order.attribution_snapshot === null &&
      attributionCandidate.finalization_result === null && attributionCandidate.finalized_at === null &&
      order.final_agent_id === null && order.final_channel === null && frozenCity !== null && bindingValidAtSubmission &&
      financialsClose && paymentStateClosed && structurallyValidItems &&
      commissionWalletAvailable &&
      reservation !== null && reservation.status === 'ACTIVE' && reservation.consumed_at === null &&
      reservation.released_at === null &&
      reservation.order_id === order.id && reservation.items.length === order.items.length &&
      balances.length === order.items.length && catalog.length === order.items.length &&
      productIds.every((productId) => order.items.some((item) => item.product_id === productId));
    for (const item of order.items) {
      const balance = balanceBySku.get(item.sku_id);
      const reserved = reservationBySku.get(item.sku_id);
      const total = totalBySku.get(item.sku_id);
      const currentCatalog = catalog.find(({ id }) => id === item.sku_id);
      const itemStateClosed = item.refunded_qty === 0 && item.pre_shipment_refunded_qty === 0 &&
        item.refunded_amount.equals(0) && item.aftersale_reserved_qty === 0 &&
        item.aftersale_reserved_amount.equals(0) && item.shipped_qty === 0;
      if (!itemStateClosed || !balance || !reserved || !currentCatalog ||
        currentCatalog.product.id !== item.product_id ||
        reserved.quantity !== item.quantity || typeof total !== 'bigint' ||
        total !== BigInt(balance.locked_qty) || balance.physical_qty < balance.locked_qty ||
        balance.locked_qty < item.quantity || balance.physical_qty < item.quantity || balance.version < 1) {
        settlementAvailable = false;
      }
    }

    type RuleResolution = {
      categoryId: string;
      categoryName: string;
      rate: Prisma.Decimal;
      source: 'CATEGORY' | 'PLATFORM' | 'SKU';
    };
    const ruleBySku = new Map<string, RuleResolution>();
    if (finalAgentId !== null) {
      if (order.customer.phone_verifications.length > 1) settlementAvailable = false;
      if (!ruleVersion || (ruleVersion.status !== 'PUBLISHED' && ruleVersion.status !== 'ARCHIVED') ||
        ruleVersion.effective_at === null || ruleVersion.effective_at.getTime() > paymentAt.getTime() ||
        ruleVersion.effective_at.getTime() > serverTime.getTime()) {
        settlementAvailable = false;
      } else {
        const entries = new Map<string, SettlementCommissionRuleVersion['entries'][number]>();
        for (const entry of ruleVersion.entries) {
          const validTarget = entry.target_type === 'PLATFORM'
            ? entry.target_id === null && entry.target_key === 'PLATFORM'
            : entry.target_id !== null && entry.target_key === `${entry.target_type}:${entry.target_id}`;
          if (!validTarget || entry.configured_rate.isNegative() || entry.configured_rate.greaterThan(100) ||
            entries.has(entry.target_key)) {
            settlementAvailable = false;
            continue;
          }
          entries.set(entry.target_key, entry);
        }
        const platform = entries.get('PLATFORM');
        if (!platform || platform.target_type !== 'PLATFORM' || platform.target_id !== null) {
          settlementAvailable = false;
        }
        for (const item of order.items) {
          const currentCatalog = catalog.find(({ id }) => id === item.sku_id);
          const category = currentCatalog?.product.category;
          const entry = entries.get(`SKU:${item.sku_id}`) ??
            (category ? entries.get(`CATEGORY:${category.id}`) : undefined) ?? platform;
          if (!category || !entry || entry.configured_rate.isNegative() || entry.configured_rate.greaterThan(100)) {
            settlementAvailable = false;
            continue;
          }
          ruleBySku.set(item.sku_id, {
            categoryId: category.id,
            categoryName: category.name,
            rate: entry.configured_rate,
            source: entry.target_type,
          });
        }
        if (ruleBySku.size !== order.items.length) settlementAvailable = false;
      }
    }

    const paymentAttemptId = matchingAttempt?.id ?? generateUlid(serverTime.getTime());
    let intentVersion = intent.version;
    const baseOrderVersion = order.version;
    const catalogComplete = structurallyValidItems && catalog.length === skuIds.length &&
      productIds.every((productId) => catalog.some(({ product }) => product.id === productId));
    const salesUpdates: Array<{ productId: string; quantity: number; salesCount: number }> = [];
    if (catalogComplete) {
      const quantities = new Map<string, number>();
      for (const item of order.items) {
        quantities.set(item.product_id, (quantities.get(item.product_id) ?? 0) + item.quantity);
      }
      for (const productId of productIds) {
        const quantity = quantities.get(productId);
        const productRows = catalog.filter(({ product }) => product.id === productId);
        const salesCount = productRows[0]?.product.sales_count;
        if (!Number.isSafeInteger(quantity) || quantity === undefined || quantity < 1 ||
          !Number.isSafeInteger(salesCount) || salesCount === undefined || salesCount < 0 ||
          productRows.some(({ product }) => product.sales_count !== salesCount)) {
          settlementAvailable = false;
          break;
        }
        salesUpdates.push({ productId, quantity, salesCount });
      }
    } else {
      settlementAvailable = false;
    }

    if (settlementAvailable) {
      for (const { productId, quantity, salesCount } of salesUpdates) {
        const updated = await transaction.product.updateMany({
          data: {
            sales_count: Math.min(MAX_POSTGRES_INTEGER, salesCount + quantity),
            updated_at: serverTime,
          },
          where: { id: productId, sales_count: salesCount },
        });
        if (updated.count !== 1) throw internalError('Payment product sales counter lost its locked row');
      }
    }

    if (!compensating) {
      await transaction.paymentAttempt.create({
        data: {
          amount: intent.amount,
          failure_code: null,
          finished_at: input.occurredAt,
          id: paymentAttemptId,
          initiated_at: input.occurredAt,
          payment_intent_id: intent.id,
          provider: input.provider,
          provider_payload: Prisma.DbNull,
          provider_transaction_id: input.providerTransactionId,
          status: 'SUCCEEDED',
        },
      });
      const intentChanged = await transaction.paymentIntent.updateMany({
        data: {
          last_error_code: null,
          last_reconciled_at: serverTime,
          next_reconcile_at: null,
          provider_state: 'SUCCEEDED',
          status: 'SUCCEEDED',
          succeeded_at: input.occurredAt,
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: intent.id, order_id: order.id, version: intent.version },
      });
      if (intentChanged.count !== 1) throw paymentResultConflict();
      intentVersion += 1;
    }

    if (!settlementAvailable) {
      if (compensating) {
        return {
          after: before,
          before,
          changed: false,
          commissionLedgerIds: [],
          commissionSnapshotIds: [],
          finalAgentId: null,
          finalChannel: null,
          inventoryLedgerIds: [],
          kind: 'REPLAY',
          lateRefund: null,
          orderId: order.id,
          outcome: input.outcome,
          paymentAttemptId,
          paymentIntentId: intent.id,
          providerEventId: input.providerEventId,
          reservationId: reservation?.id ?? null,
        };
      }
      const orderChanged = await transaction.salesOrder.updateMany({
        data: {
          paid_amount: order.payable_amount,
          paid_at: input.occurredAt,
          payment_resolution: 'MANUAL_REQUIRED',
          payment_status: 'PAID',
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: order.id, payment_status: order.payment_status, version: order.version },
      });
      if (orderChanged.count !== 1) throw paymentResultConflict();
      const after: StorePaymentCallbackState = {
        intentStatus: 'SUCCEEDED',
        intentVersion,
        orderPaymentResolution: 'MANUAL_REQUIRED',
        orderPaymentStatus: 'PAID',
        orderStatus: 'PENDING_PAYMENT',
        orderVersion: order.version + 1,
      };
      return {
        after,
        before,
        changed: true,
        commissionLedgerIds: [],
        commissionSnapshotIds: [],
        finalAgentId: null,
        finalChannel: null,
        inventoryLedgerIds: [],
        kind: 'MANUAL_REQUIRED',
        lateRefund: null,
        orderId: order.id,
        outcome: input.outcome,
        paymentAttemptId,
        paymentIntentId: intent.id,
        providerEventId: input.providerEventId,
        reservationId: reservation?.id ?? null,
      };
    }

    const activeReservation = reservation!;
    const inventoryLedgerIds: string[] = [];
    for (const item of [...order.items].sort((left, right) => left.sku_id.localeCompare(right.sku_id))) {
      const balance = balanceBySku.get(item.sku_id)!;
      const physicalAfter = balance.physical_qty - item.quantity;
      const lockedAfter = balance.locked_qty - item.quantity;
      const updated = await transaction.inventoryBalance.updateMany({
        data: {
          locked_qty: lockedAfter,
          physical_qty: physicalAfter,
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: {
          id: balance.id,
          locked_qty: balance.locked_qty,
          physical_qty: balance.physical_qty,
          sku_id: item.sku_id,
          version: balance.version,
        },
      });
      if (updated.count !== 1) throw internalError('Payment inventory update lost its locked row');
      const ledgerId = generateUlid(serverTime.getTime());
      await transaction.inventoryLedger.create({
        data: {
          actor_account_id: null,
          business_id: activeReservation.id,
          id: ledgerId,
          ledger_type: 'ORDER_PAID_DEDUCT',
          locked_after: lockedAfter,
          locked_change: -item.quantity,
          occurred_at: serverTime,
          physical_after: physicalAfter,
          physical_change: -item.quantity,
          reason: 'PAYMENT_SETTLED',
          sku_id: item.sku_id,
        },
      });
      inventoryLedgerIds.push(ledgerId);
    }
    const reservationChanged = await transaction.inventoryReservation.updateMany({
      data: { consumed_at: paymentAt, status: 'CONSUMED' },
      where: { id: activeReservation.id, order_id: order.id, status: 'ACTIVE' },
    });
    if (reservationChanged.count !== 1) throw internalError('Payment reservation update lost its locked row');

    const finalChannel = finalAgentId === null ? 'DIRECT' as const : 'AGENT' as const;
    const finalizedCandidate = attributionCandidate!;
    const attributionSnapshotId = generateUlid(serverTime.getTime());
    await transaction.orderAttributionCandidate.update({
      data: {
        finalization_result: finalAgentId === null
          ? finalizedCandidate.submit_channel === 'DIRECT' ? 'DIRECT_SUBMITTED' : 'DIRECT_AGENT_UNAVAILABLE'
          : 'AGENT_CONFIRMED',
        finalized_at: serverTime,
      },
      where: { id: finalizedCandidate.id },
    });
    await transaction.orderAttributionSnapshot.create({
      data: {
        agent_id_snapshot: finalAgentId,
        binding_id_snapshot: finalAgentId === null ? null : finalizedCandidate.binding_id,
        captured_at: serverTime,
        final_channel: finalChannel,
        id: attributionSnapshotId,
        order_id: order.id,
      },
    });
    if (finalAgentId !== null) {
      const previousProjection = await transaction.agentCustomerPrivacyProjection.findFirst({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        select: { customer_alias: true },
        where: { agent_id: finalAgentId, customer_id: order.customer_id },
      });
      await transaction.agentCustomerPrivacyProjection.create({
        data: {
          agent_id: finalAgentId,
          anonymized_at: null,
          attribution_snapshot_id: attributionSnapshotId,
          city: frozenCity!,
          created_at: serverTime,
          customer_alias: previousProjection?.customer_alias ?? `customer_${generateUlid(serverTime.getTime()).toLowerCase()}`,
          customer_id: order.customer_id,
          id: generateUlid(serverTime.getTime()),
          nickname_masked: maskedNickname(order.customer.nickname),
          phone_tail: order.customer.phone_verifications[0]?.phone_last4 ?? null,
          updated_at: serverTime,
        },
      });
    }

    const commissionSnapshotIds: string[] = [];
    const commissionLedgerIds: string[] = [];
    if (finalAgentId !== null) {
      const frozenRuleVersion = ruleVersion!;
      for (const item of order.items) {
        const resolution = ruleBySku.get(item.sku_id)!;
        const commission = item.line_paid_amount.mul(resolution.rate).div(100)
          .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        const snapshotId = generateUlid(serverTime.getTime());
        await transaction.orderItemCommissionSnapshot.create({
          data: {
            agent_id: finalAgentId,
            category_id_snapshot: resolution.categoryId,
            category_name_snapshot: resolution.categoryName,
            commission_base: item.line_paid_amount,
            created_at: serverTime,
            effective_rate: resolution.rate,
            id: snapshotId,
            order_item_id: item.id,
            original_commission: commission,
            product_id_snapshot: item.product_id,
            rule_version_id: frozenRuleVersion.id,
            sku_id_snapshot: item.sku_id,
            source_type: resolution.source,
          },
        });
        await transaction.orderItemCommissionPosition.create({
          data: {
            available_at: null,
            expected_remaining: commission,
            id: generateUlid(serverTime.getTime()),
            original_commission: commission,
            reversed_total: new Prisma.Decimal(0),
            snapshot_id: snapshotId,
            state: commission.isZero() ? 'NONE' : 'EXPECTED',
            updated_at: serverTime,
            version: 1,
          },
        });
        commissionSnapshotIds.push(snapshotId);
        if (!commission.isZero()) {
          const ledgerId = generateUlid(serverTime.getTime());
          await transaction.commissionLedger.create({
            data: {
              agent_id: finalAgentId,
              available_change: new Prisma.Decimal(0),
              expected_change: commission,
              frozen_change: new Prisma.Decimal(0),
              id: ledgerId,
              idempotency_key: `payment:${intent.id}:${item.id}:expected`,
              ledger_type: 'EXPECTED_CREATED',
              occurred_at: serverTime,
              reason: 'ORDER_PAID',
              snapshot_id: snapshotId,
            },
          });
          commissionLedgerIds.push(ledgerId);
        }
      }
    }

    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        final_agent_id: finalAgentId,
        final_channel: finalChannel,
        fulfillment_status: 'READY_TO_SHIP',
        order_status: 'PENDING_SHIPMENT',
        paid_amount: order.payable_amount,
        paid_at: order.paid_at ?? input.occurredAt,
        payment_resolution: 'NORMAL',
        payment_status: 'PAID',
        updated_at: serverTime,
        version: { increment: 1 },
      },
      where: { id: order.id, payment_status: order.payment_status, version: baseOrderVersion },
    });
    if (orderChanged.count !== 1) throw paymentResultConflict();
    const after: StorePaymentCallbackState = {
      intentStatus: 'SUCCEEDED',
      intentVersion,
      orderPaymentResolution: 'NORMAL',
      orderPaymentStatus: 'PAID',
      orderStatus: 'PENDING_SHIPMENT',
      orderVersion: baseOrderVersion + 1,
    };
    return {
      after,
      before,
      changed: true,
      commissionLedgerIds,
      commissionSnapshotIds,
      finalAgentId,
      finalChannel,
      inventoryLedgerIds,
      kind: 'SETTLED',
      lateRefund: null,
      orderId: order.id,
      outcome: input.outcome,
      paymentAttemptId,
      paymentIntentId: intent.id,
      providerEventId: input.providerEventId,
      reservationId: activeReservation.id,
    };
  }

  async claimLatePaymentRefundInTransaction(
    transaction: DatabaseTransaction,
    input: StoreLatePaymentRefundOperation,
  ): Promise<StoreLatePaymentRefundClaimResult> {
    validateLateRefundOperation(input);
    await this.lockOrder(transaction, input.orderId);
    const refundLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.refund
      WHERE id = ${input.refundId} AND order_id = ${input.orderId}
      FOR UPDATE
    `);
    if (refundLocks.length !== 1 || refundLocks[0]?.id !== input.refundId) {
      throw internalError('Late payment refund is unavailable');
    }
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.refund_attempt
      WHERE refund_id = ${input.refundId}
      ORDER BY attempt_no ASC, id ASC
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.payment_intent
      WHERE id = ${input.paymentIntentId} AND order_id = ${input.orderId}
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.payment_attempt
      WHERE payment_intent_id = ${input.paymentIntentId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    const serverTime = await this.transactionTime(transaction);
    const refund = await transaction.refund.findUnique({
      include: {
        attempts: { orderBy: [{ attempt_no: 'asc' }, { id: 'asc' }] },
        items: { orderBy: [{ order_item_id: 'asc' }, { id: 'asc' }] },
      },
      where: { id: input.refundId },
    });
    const intent = await transaction.paymentIntent.findUnique({
      include: { attempts: { orderBy: [{ initiated_at: 'asc' }, { id: 'asc' }] } },
      where: { id: input.paymentIntentId },
    });
    const order = await transaction.salesOrder.findUnique({
      include: { items: { orderBy: [{ id: 'asc' }] } },
      where: { id: input.orderId },
    });
    const refundAttempt = refund?.attempts.find(({ id }) => id === input.refundAttemptId);
    const latestRefundAttempt = refund?.attempts.at(-1);
    const latePaymentAttempts = intent?.attempts.filter(({ status }) => status === 'SUCCEEDED_LATE') ?? [];
    const paymentAttempt = latePaymentAttempts[0];
    if (!refund || !intent || !order || refund.order_id !== input.orderId ||
      refund.origin_type !== 'LATE_PAYMENT' || refund.is_late_payment_refund !== true ||
      refund.provider !== input.provider || refund.amount.toFixed(2) !== input.amount ||
      refund.refund_no !== input.refundNo || refund.reason !== 'LATE_PAYMENT_AUTOMATIC_FULL_REFUND' ||
      refund.aftersale_id !== null || refund.manual_compensation_id !== null ||
      refund.attempts.length < 1 || !refundAttempt || latestRefundAttempt?.id !== refundAttempt.id ||
      refundAttempt.attempt_no !== refund.attempts.length || refundAttempt.provider !== input.provider ||
      refundAttempt.idempotency_key !== `late-payment:${input.refundId}:${refundAttempt.attempt_no}` ||
      intent.order_id !== input.orderId || intent.provider !== input.provider ||
      intent.provider_intent_id !== input.providerIntentId || intent.status !== 'SUCCEEDED' ||
      intent.provider_state !== 'SUCCEEDED' || intent.succeeded_at === null ||
      intent.amount.toFixed(2) !== input.amount || latePaymentAttempts.length !== 1 || !paymentAttempt ||
      paymentAttempt.provider !== input.provider || paymentAttempt.failure_code !== null ||
      paymentAttempt.finished_at === null ||
      paymentAttempt.provider_transaction_id !== input.providerTransactionId ||
      paymentAttempt.amount.toFixed(2) !== input.amount || order.order_status !== 'CLOSED' ||
      order.fulfillment_status !== 'NOT_STARTED' || order.payment_status !== 'PAID' ||
      order.final_agent_id !== null || order.final_channel !== null ||
      !order.paid_amount.equals(order.payable_amount)) {
      throw internalError('Late payment refund claim facts are inconsistent');
    }
    const refundItemByOrderItem = new Map(refund.items.map((item) => [item.order_item_id, item]));
    const refundDefinitionExact = refund.items.length === order.items.length && order.items.length > 0 &&
      order.shipping_amount.equals(0) && paymentAmountsClose(
        order.goods_amount,
        order.shipping_amount,
        order.payable_amount,
        order.items.map(({ line_paid_amount }) => line_paid_amount),
      ) && order.items.every((item) => {
        const refundItem = refundItemByOrderItem.get(item.id);
        return refundItem !== undefined && refundItem.quantity === item.quantity &&
          refundItem.amount.equals(item.line_paid_amount) && refundItem.auto_restock === false &&
          refundItem.commission_reversal.equals(0) && refundItem.aftersale_item_id === null;
      });
    if (!refundDefinitionExact) throw internalError('Late payment refund item facts are inconsistent');
    const itemsUnrefunded = order.items.every((item) => item.refunded_qty === 0 &&
      item.pre_shipment_refunded_qty === 0 && item.refunded_amount.equals(0) &&
      item.aftersale_reserved_qty === 0 && item.aftersale_reserved_amount.equals(0) && item.shipped_qty === 0);
    const itemsFullyRefunded = order.items.every((item) => item.refunded_qty === item.quantity &&
      item.pre_shipment_refunded_qty === item.quantity && item.refunded_amount.equals(item.line_paid_amount) &&
      item.aftersale_reserved_qty === 0 && item.aftersale_reserved_amount.equals(0) && item.shipped_qty === 0);
    if (refund.status === 'SUCCEEDED') {
      if (refundAttempt.status !== 'SUCCEEDED' || refundAttempt.failure_code !== null ||
        refundAttempt.finished_at === null || refundAttempt.provider_request_id === null ||
        refund.provider_refund_id === null || refund.succeeded_at === null || refund.failure_code !== null ||
        refund.failed_at !== null || order.payment_resolution !== 'LATE_SUCCESS_REFUNDED' ||
        order.refund_progress_status !== 'FULL' || order.refund_processing_status !== 'IDLE' ||
        !order.refunded_amount.equals(order.paid_amount) || !itemsFullyRefunded) {
        throw internalError('Completed late payment refund facts are inconsistent');
      }
      return { kind: 'TERMINAL' };
    }
    if (refund.status === 'FAILED') {
      if (refundAttempt.status !== 'FAILED' || refundAttempt.failure_code === null ||
        refundAttempt.finished_at === null || refund.provider_refund_id !== null ||
        refund.failure_code === null || refund.failed_at === null ||
        order.payment_resolution !== 'MANUAL_REQUIRED' || order.refund_progress_status !== 'NONE' ||
        order.refund_processing_status !== 'FAILED' || !order.refunded_amount.equals(0) || !itemsUnrefunded) {
        throw internalError('Failed late payment refund facts are inconsistent');
      }
      return { kind: 'TERMINAL' };
    }
    if (refund.version !== input.refundVersion || order.payment_resolution !== 'LATE_SUCCESS_REFUND_PENDING' ||
      order.refund_progress_status !== 'NONE' || order.refund_processing_status !== 'REFUNDING' ||
      !order.refunded_amount.equals(0) || !itemsUnrefunded) {
      throw internalError('Late payment refund claim state is inconsistent');
    }
    let refundVersion = refund.version;
    if (refund.status === 'PENDING' && refundAttempt.status === 'INITIATED') {
      const refundChanged = await transaction.refund.updateMany({
        data: { status: 'PROCESSING', updated_at: serverTime, version: { increment: 1 } },
        where: { id: refund.id, status: 'PENDING', version: refund.version },
      });
      const attemptChanged = await transaction.refundAttempt.updateMany({
        data: { status: 'PROCESSING' },
        where: { id: refundAttempt.id, refund_id: refund.id, status: 'INITIATED' },
      });
      if (refundChanged.count !== 1 || attemptChanged.count !== 1) {
        throw internalError('Late payment refund claim lost its locked facts');
      }
      refundVersion += 1;
    } else if (refund.status !== 'PROCESSING' || refundAttempt.status !== 'PROCESSING') {
      throw internalError('Late payment refund claim state is invalid');
    }
    return {
      kind: 'CLAIMED',
      operation: { ...input, refundVersion },
    };
  }

  async finalizeLatePaymentRefundInTransaction(
    transaction: DatabaseTransaction,
    input: StoreLatePaymentRefundFinalizeInput,
  ): Promise<StoreLatePaymentRefundFinalizeResult> {
    validateLateRefundFinalization(input);
    const operation = input.operation;
    await this.lockOrder(transaction, operation.orderId);
    const refundLocks = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.refund
      WHERE id = ${operation.refundId} AND order_id = ${operation.orderId}
      FOR UPDATE
    `);
    if (refundLocks.length !== 1 || refundLocks[0]?.id !== operation.refundId) {
      throw internalError('Late payment refund is unavailable');
    }
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.refund_attempt
      WHERE refund_id = ${operation.refundId}
      ORDER BY attempt_no ASC, id ASC
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.payment_intent
      WHERE id = ${operation.paymentIntentId} AND order_id = ${operation.orderId}
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.payment_attempt
      WHERE payment_intent_id = ${operation.paymentIntentId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.order_item
      WHERE order_id = ${operation.orderId}
      ORDER BY id ASC
      FOR UPDATE
    `);
    const serverTime = await this.transactionTime(transaction);
    const refund = await transaction.refund.findUnique({
      include: {
        attempts: { orderBy: [{ attempt_no: 'asc' }, { id: 'asc' }] },
        items: { orderBy: [{ order_item_id: 'asc' }, { id: 'asc' }] },
      },
      where: { id: operation.refundId },
    });
    const intent = await transaction.paymentIntent.findUnique({
      include: { attempts: { orderBy: [{ initiated_at: 'asc' }, { id: 'asc' }] } },
      where: { id: operation.paymentIntentId },
    });
    const order = await transaction.salesOrder.findUnique({
      include: { items: { orderBy: [{ id: 'asc' }] } },
      where: { id: operation.orderId },
    });
    const refundAttempt = refund?.attempts.find(({ id }) => id === operation.refundAttemptId);
    const latestRefundAttempt = refund?.attempts.at(-1);
    const latePaymentAttempts = intent?.attempts.filter(({ status }) => status === 'SUCCEEDED_LATE') ?? [];
    const paymentAttempt = latePaymentAttempts[0];
    if (!refund || !intent || !order || refund.order_id !== operation.orderId ||
      refund.origin_type !== 'LATE_PAYMENT' || refund.is_late_payment_refund !== true ||
      refund.provider !== operation.provider || refund.amount.toFixed(2) !== operation.amount ||
      refund.refund_no !== operation.refundNo || refund.reason !== 'LATE_PAYMENT_AUTOMATIC_FULL_REFUND' ||
      refund.aftersale_id !== null || refund.manual_compensation_id !== null ||
      refund.attempts.length < 1 || !refundAttempt || latestRefundAttempt?.id !== refundAttempt.id ||
      refundAttempt.attempt_no !== refund.attempts.length || refundAttempt.provider !== operation.provider ||
      refundAttempt.idempotency_key !== `late-payment:${operation.refundId}:${refundAttempt.attempt_no}` ||
      intent.order_id !== operation.orderId || intent.provider !== operation.provider ||
      intent.provider_intent_id !== operation.providerIntentId || intent.status !== 'SUCCEEDED' ||
      intent.provider_state !== 'SUCCEEDED' || intent.succeeded_at === null ||
      intent.amount.toFixed(2) !== operation.amount || latePaymentAttempts.length !== 1 || !paymentAttempt ||
      paymentAttempt.provider !== operation.provider || paymentAttempt.failure_code !== null ||
      paymentAttempt.finished_at === null ||
      paymentAttempt.provider_transaction_id !== operation.providerTransactionId ||
      paymentAttempt.amount.toFixed(2) !== operation.amount || order.order_status !== 'CLOSED' ||
      order.fulfillment_status !== 'NOT_STARTED' || order.payment_status !== 'PAID' ||
      order.final_agent_id !== null || order.final_channel !== null ||
      !order.paid_amount.equals(order.payable_amount)) {
      throw internalError('Late payment refund finalization facts are inconsistent');
    }
    if (refund.status !== 'PROCESSING' && refund.status !== 'SUCCEEDED' && refund.status !== 'FAILED') {
      throw internalError('Late payment refund finalization status is invalid');
    }
    const beforeRefundStatus = refund.status;
    const beforeRefundVersion = refund.version;
    const beforeOrderVersion = order.version;
    const refundItemByOrderItem = new Map(refund.items.map((item) => [item.order_item_id, item]));
    const refundDefinitionExact = refund.items.length === order.items.length && order.items.length > 0 &&
      order.shipping_amount.equals(0) && paymentAmountsClose(
        order.goods_amount,
        order.shipping_amount,
        order.payable_amount,
        order.items.map(({ line_paid_amount }) => line_paid_amount),
      ) && order.items.every((item) => {
        const refundItem = refundItemByOrderItem.get(item.id);
        return refundItem !== undefined && refundItem.quantity === item.quantity &&
          refundItem.amount.equals(item.line_paid_amount) && refundItem.auto_restock === false &&
          refundItem.commission_reversal.equals(0) && refundItem.aftersale_item_id === null;
      });
    if (!refundDefinitionExact) throw internalError('Late payment refund item facts are inconsistent');
    const itemsUnrefunded = order.items.every((item) => item.refunded_qty === 0 &&
      item.pre_shipment_refunded_qty === 0 && item.refunded_amount.equals(0) &&
      item.aftersale_reserved_qty === 0 && item.aftersale_reserved_amount.equals(0) && item.shipped_qty === 0);
    const itemsFullyRefunded = order.items.every((item) => item.refunded_qty === item.quantity &&
      item.pre_shipment_refunded_qty === item.quantity && item.refunded_amount.equals(item.line_paid_amount) &&
      item.aftersale_reserved_qty === 0 && item.aftersale_reserved_amount.equals(0) && item.shipped_qty === 0);
    if (refund.status === 'SUCCEEDED' && refundAttempt.status === 'SUCCEEDED' &&
      order.payment_resolution === 'LATE_SUCCESS_REFUNDED' && order.refund_progress_status === 'FULL' &&
      order.refund_processing_status === 'IDLE' && order.refunded_amount.equals(order.paid_amount) &&
      refundAttempt.failure_code === null && refundAttempt.finished_at !== null &&
      refundAttempt.provider_request_id !== null && refund.provider_refund_id !== null &&
      refund.succeeded_at !== null && refund.failure_code === null && refund.failed_at === null && itemsFullyRefunded) {
      return {
        afterOrderVersion: order.version,
        afterRefundStatus: 'SUCCEEDED',
        afterRefundVersion: refund.version,
        beforeOrderVersion,
        beforeRefundStatus: 'SUCCEEDED',
        beforeRefundVersion,
        changed: false,
        kind: 'REPLAY',
        orderId: order.id,
        refundId: refund.id,
      };
    }
    if (refund.status === 'FAILED' && refundAttempt.status === 'FAILED' &&
      order.payment_resolution === 'MANUAL_REQUIRED' && order.refund_progress_status === 'NONE' &&
      order.refund_processing_status === 'FAILED' && order.refunded_amount.equals(0) &&
      refundAttempt.failure_code !== null && refundAttempt.finished_at !== null &&
      refund.provider_refund_id === null && refund.failure_code !== null && refund.failed_at !== null &&
      itemsUnrefunded) {
      return {
        afterOrderVersion: order.version,
        afterRefundStatus: 'FAILED',
        afterRefundVersion: refund.version,
        beforeOrderVersion,
        beforeRefundStatus: 'FAILED',
        beforeRefundVersion,
        changed: false,
        kind: 'REPLAY',
        orderId: order.id,
        refundId: refund.id,
      };
    }
    if (refund.version !== operation.refundVersion || refund.status !== 'PROCESSING' ||
      refundAttempt.status !== 'PROCESSING' ||
      order.payment_resolution !== 'LATE_SUCCESS_REFUND_PENDING' ||
      order.refund_progress_status !== 'NONE' || order.refund_processing_status !== 'REFUNDING' ||
      !order.refunded_amount.equals(0) || !itemsUnrefunded) {
      throw internalError('Late payment refund finalization state is invalid');
    }

    if (input.result.kind === 'FAILED') {
      const finishedAt = input.result.occurredAt ?? serverTime;
      const attemptChanged = await transaction.refundAttempt.updateMany({
        data: {
          failure_code: input.result.failureCode,
          finished_at: finishedAt,
          provider_payload: Prisma.DbNull,
          status: 'FAILED',
        },
        where: { id: refundAttempt.id, refund_id: refund.id, status: 'PROCESSING' },
      });
      const refundChanged = await transaction.refund.updateMany({
        data: {
          failed_at: finishedAt,
          failure_code: input.result.failureCode,
          status: 'FAILED',
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: refund.id, status: 'PROCESSING', version: refund.version },
      });
      const orderChanged = await transaction.salesOrder.updateMany({
        data: {
          payment_resolution: 'MANUAL_REQUIRED',
          refund_processing_status: 'FAILED',
          updated_at: serverTime,
          version: { increment: 1 },
        },
        where: { id: order.id, order_status: 'CLOSED', version: order.version },
      });
      if (attemptChanged.count !== 1 || refundChanged.count !== 1 || orderChanged.count !== 1) {
        throw internalError('Late payment refund failure finalization lost its locked facts');
      }
      return {
        afterOrderVersion: order.version + 1,
        afterRefundStatus: 'FAILED',
        afterRefundVersion: refund.version + 1,
        beforeOrderVersion,
        beforeRefundStatus,
        beforeRefundVersion,
        changed: true,
        kind: 'MANUAL_REQUIRED',
        orderId: order.id,
        refundId: refund.id,
      };
    }

    const attemptChanged = await transaction.refundAttempt.updateMany({
      data: {
        failure_code: null,
        finished_at: input.result.occurredAt,
        provider_payload: Prisma.DbNull,
        provider_request_id: input.result.providerEventId,
        status: 'SUCCEEDED',
      },
      where: { id: refundAttempt.id, refund_id: refund.id, status: 'PROCESSING' },
    });
    const refundChanged = await transaction.refund.updateMany({
      data: {
        failed_at: null,
        failure_code: null,
        provider_refund_id: input.result.providerRefundId,
        status: 'SUCCEEDED',
        succeeded_at: input.result.occurredAt,
        updated_at: serverTime,
        version: { increment: 1 },
      },
      where: { id: refund.id, status: 'PROCESSING', version: refund.version },
    });
    if (attemptChanged.count !== 1 || refundChanged.count !== 1) {
      throw internalError('Late payment refund success finalization lost its locked facts');
    }
    for (const item of order.items) {
      const itemChanged = await transaction.orderItem.updateMany({
        data: {
          pre_shipment_refunded_qty: item.quantity,
          refunded_amount: item.line_paid_amount,
          refunded_qty: item.quantity,
          version: { increment: 1 },
        },
        where: { id: item.id, order_id: order.id, version: item.version },
      });
      if (itemChanged.count !== 1) throw internalError('Late payment refund Order Item update lost its locked row');
    }
    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        payment_resolution: 'LATE_SUCCESS_REFUNDED',
        refund_processing_status: 'IDLE',
        refund_progress_status: 'FULL',
        refunded_amount: order.paid_amount,
        updated_at: serverTime,
        version: { increment: 1 },
      },
      where: { id: order.id, order_status: 'CLOSED', version: order.version },
    });
    if (orderChanged.count !== 1) throw internalError('Late payment refund Order update lost its locked row');
    return {
      afterOrderVersion: order.version + 1,
      afterRefundStatus: 'SUCCEEDED',
      afterRefundVersion: refund.version + 1,
      beforeOrderVersion,
      beforeRefundStatus,
      beforeRefundVersion,
      changed: true,
      kind: 'REFUNDED',
      orderId: order.id,
      refundId: refund.id,
    };
  }

  async getOwnedPaymentIntentInTransaction(
    transaction: DatabaseTransaction,
    input: StorePaymentOwnedReadInput,
  ): Promise<StorePaymentIntentSnapshot> {
    validateOwnedReadInput(input);
    const serverTime = await this.transactionTime(transaction);
    const record = await transaction.paymentIntent.findFirst({
      select: PAYMENT_INTENT_SELECT,
      where: {
        id: input.paymentIntentId,
        order: { customer_id: input.customerId },
      },
    });
    if (!record) throw paymentNotFound();
    return paymentIntentSnapshot(record, serverTime);
  }
}
