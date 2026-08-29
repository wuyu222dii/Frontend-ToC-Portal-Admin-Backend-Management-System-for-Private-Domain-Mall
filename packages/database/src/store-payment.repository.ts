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
  id: true,
  inventory_reservation: { select: { status: true } },
  order_status: true,
  paid_amount: true,
  pay_expires_at: true,
  payable_amount: true,
  payment_resolution: true,
  payment_status: true,
  refund_processing_status: true,
  refund_progress_status: true,
  version: true,
} satisfies Prisma.SalesOrderSelect;

type PaymentIntentRecord = Prisma.PaymentIntentGetPayload<{ select: typeof PAYMENT_INTENT_SELECT }>;
type PaymentOrderRecord = Prisma.SalesOrderGetPayload<{ select: typeof PAYMENT_ORDER_SELECT }>;

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

function orderPaymentBaseEligible(record: PaymentOrderRecord): boolean {
  return record.order_status === 'PENDING_PAYMENT' &&
    record.refund_progress_status === 'NONE' && record.refund_processing_status === 'IDLE' &&
    record.fulfillment_status === 'NOT_STARTED' && record.close_reason === null && record.closed_at === null &&
    record.completion_reason === null && record.completed_at === null && record.payment_resolution === 'NORMAL' &&
    record.inventory_reservation?.status === 'ACTIVE' &&
    new Prisma.Decimal(record.paid_amount).equals(0) && new Prisma.Decimal(record.payable_amount).greaterThan(0);
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
