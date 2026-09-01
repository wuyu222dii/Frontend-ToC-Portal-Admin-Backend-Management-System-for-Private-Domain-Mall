import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { PaymentProvider } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');

export interface AdminAftersaleRefundItemInput {
  aftersaleItemId: string;
  quantity: number;
}

export interface AdminAftersaleRefundPreviewInput {
  actorAccountId: string;
  aftersaleId: string;
  items: readonly AdminAftersaleRefundItemInput[];
  reason: string;
}

export interface AdminRefundImpactItem {
  aftersaleItemId: string | null;
  amount: string;
  autoRestock: boolean;
  commissionReversal: string;
  inventoryRestockQuantity: number;
  orderItemId: string;
  quantity: number;
  skuId: string;
}

export interface AdminAftersaleRefundPreviewSnapshot {
  affectedCount: number;
  aftersaleId: string;
  amount: string;
  items: AdminRefundImpactItem[];
  orderId: string;
  originType: 'AFTERSALE';
  provider: PaymentProvider;
  resourceVersion: number;
  warnings: string[];
}

export interface AdminAftersaleRefundCreateInput extends AdminAftersaleRefundPreviewInput {
  attemptIdempotencyKey: string;
  expectedVersion: number;
  provider: PaymentProvider;
}

export interface AdminManualCompensationPreviewInput {
  actorAccountId: string;
  amount: string;
  orderId: string;
  orderItemId: string;
  provider: PaymentProvider;
  reason: string;
}

export interface AdminManualCompensationPreviewSnapshot {
  affectedCount: 1;
  amount: string;
  commissionReversal: string;
  orderId: string;
  orderItemId: string;
  originType: 'MANUAL_COMPENSATION';
  provider: PaymentProvider;
  remainingAmountBefore: string;
  resourceVersion: number;
  warnings: string[];
}

export interface AdminManualCompensationCreateInput extends AdminManualCompensationPreviewInput {
  attemptIdempotencyKey: string;
  expectedVersion: number;
}

export interface AdminRefundPreviewHooks<T> {
  verifyPreview(snapshot: T): Promise<void> | void;
}

export interface AdminRefundSnapshot {
  aftersaleId: string | null;
  amount: string;
  attemptId: string;
  attemptNo: number;
  compensationId: string | null;
  compensationNo: string | null;
  items: AdminRefundImpactItem[];
  orderId: string;
  originType: 'AFTERSALE' | 'MANUAL_COMPENSATION';
  refundId: string;
  refundNo: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  version: number;
}

export interface AdminRefundRetryPreviewInput {
  actorAccountId: string;
  reason: string;
  refundId: string;
}

export interface AdminRefundRetryPreviewSnapshot {
  affectedCount: number;
  amount: string;
  attemptCount: number;
  nextAttemptNo: number;
  orderId: string;
  originType: 'AFTERSALE' | 'MANUAL_COMPENSATION';
  refundId: string;
  refundNo: string;
  resourceVersion: number;
  warnings: string[];
}

export interface AdminRefundRetryPrepareInput extends AdminRefundRetryPreviewInput {
  attemptIdempotencyKey: string;
  expectedVersion: number;
}

export interface AdminRefundAttemptClaimInput {
  refundAttemptId: string;
  refundId: string;
}

export interface AdminHistoricalRefundAttemptReplayInput {
  amount: string;
  attemptNo: number;
  outcome: 'FAILED' | 'SUCCEEDED';
  providerEventId: string;
  providerRefundId: string;
  refundAttemptId: string;
  refundId: string;
  refundNo: string;
}

export interface AdminRefundProviderOperation {
  amount: string;
  attemptId: string;
  attemptNo: number;
  orderId: string;
  originType: 'AFTERSALE' | 'MANUAL_COMPENSATION';
  provider: PaymentProvider;
  providerIntentId: string;
  providerRefundId: string | null;
  providerTransactionId: string;
  refundId: string;
  refundNo: string;
  refundVersion: number;
}

export type AdminRefundProviderResult =
  | {
      kind: 'SUCCEEDED';
      occurredAt: Date;
      providerEventId: string;
      providerRefundId: string;
    }
  | {
      failureCode: string;
      kind: 'FAILED';
      occurredAt: Date;
      providerEventId: string | null;
      providerRefundId: string | null;
    }
  | {
      kind: 'UNKNOWN';
    };

export interface AdminRefundFinalizeInput {
  operation: AdminRefundProviderOperation;
  result: AdminRefundProviderResult;
}

export interface AdminRefundFinalizeResult {
  afterOrderVersion: number;
  afterRefundStatus: 'FAILED' | 'PENDING' | 'PROCESSING' | 'SUCCEEDED';
  afterRefundVersion: number;
  beforeOrderVersion: number;
  beforeRefundStatus: 'FAILED' | 'PENDING' | 'PROCESSING' | 'SUCCEEDED';
  beforeRefundVersion: number;
  changed: boolean;
  commissionLedgerIds: string[];
  inventoryLedgerFacts: Array<{
    ledgerId: string;
    ledgerType: 'REFUND_RESTOCK' | 'RETURN_DAMAGED' | 'RETURN_RESTOCK';
  }>;
  kind: 'FAILED' | 'PROCESSING' | 'REPLAY' | 'SUCCEEDED';
  orderId: string;
  refundId: string;
}

interface ActorRow {
  deleted_at: Date | null;
  has_password: boolean;
  id: string;
  role: string;
  status: string;
}

interface OrderRow {
  close_reason: string | null;
  closed_at: Date | null;
  completed_at: Date | null;
  completion_reason: string | null;
  customer_id: string;
  fulfillment_status: string;
  id: string;
  order_status: string;
  paid_amount: Prisma.Decimal;
  payment_resolution: string;
  payment_status: string;
  refund_processing_status: string;
  refund_progress_status: string;
  refunded_amount: Prisma.Decimal;
  version: number;
}

interface RefundableLineRow {
  aftersale_item_id: string | null;
  aftersale_refunded_amount: Prisma.Decimal;
  aftersale_refunded_qty: number;
  aftersale_reserved_amount: Prisma.Decimal;
  aftersale_reserved_qty: number;
  approved_refund_qty: number | null;
  committed_commission_reversal: Prisma.Decimal;
  committed_refund_amount: Prisma.Decimal;
  commission_available_at: Date | null;
  commission_base: Prisma.Decimal | null;
  commission_effective_rate: Prisma.Decimal | null;
  commission_expected_remaining: Prisma.Decimal | null;
  commission_original: Prisma.Decimal | null;
  commission_position_id: string | null;
  commission_position_state: string | null;
  commission_position_version: number | null;
  commission_reversed_total: Prisma.Decimal | null;
  commission_snapshot_agent_id: string | null;
  commission_snapshot_id: string | null;
  inventory_balance_id: string | null;
  inventory_locked_qty: number | null;
  inventory_physical_qty: number | null;
  inventory_version: number | null;
  inspection_resolution: string | null;
  inspection_status: string | null;
  line_paid_amount: Prisma.Decimal;
  order_id: string;
  order_item_aftersale_reserved_amount: Prisma.Decimal;
  order_item_aftersale_reserved_qty: number;
  order_item_id: string;
  order_item_pre_shipment_refunded_qty: number;
  order_item_refunded_amount: Prisma.Decimal;
  order_item_refunded_qty: number;
  order_item_shipped_qty: number;
  order_item_version: number;
  product_id: string;
  product_sales_count: number;
  product_version: number;
  quantity: number;
  restock_qty: number | null;
  damaged_qty: number | null;
  scrap_qty: number | null;
  return_to_customer_qty: number | null;
  sku_id: string;
  unit_price: Prisma.Decimal;
  wallet_available_balance: Prisma.Decimal | null;
  wallet_frozen_balance: Prisma.Decimal | null;
  wallet_id: string | null;
  wallet_version: number | null;
}

interface AftersaleHeaderRow {
  customer_id: string;
  id: string;
  order_id: string;
  refund_id: string | null;
  status: string;
  type: string;
  version: number;
}

interface PaymentSourceRow {
  amount: Prisma.Decimal;
  payment_attempt_id: string;
  payment_intent_id: string;
  provider: PaymentProvider;
  provider_intent_id: string | null;
  provider_transaction_id: string | null;
}

interface RefundHeaderRow {
  aftersale_id: string | null;
  aftersale_status: string | null;
  aftersale_type: string | null;
  aftersale_version: number | null;
  amount: Prisma.Decimal;
  customer_id: string;
  failure_code: string | null;
  failed_at: Date | null;
  id: string;
  is_late_payment_refund: boolean;
  manual_compensation_id: string | null;
  manual_compensation_status: string | null;
  manual_compensation_version: number | null;
  order_id: string;
  origin_type: string;
  provider: PaymentProvider;
  provider_refund_id: string | null;
  refund_no: string;
  status: string;
  succeeded_at: Date | null;
  version: number;
}

interface RefundAttemptRow {
  attempt_no: number;
  failure_code: string | null;
  finished_at: Date | null;
  id: string;
  idempotency_key: string;
  provider: PaymentProvider;
  provider_request_id: string | null;
  refund_id: string;
  status: string;
}

interface FinalizationLineRow extends RefundableLineRow {
  refund_item_amount: Prisma.Decimal;
  refund_item_auto_restock: boolean;
  refund_item_commission_reversal: Prisma.Decimal;
  refund_item_id: string;
  refund_item_quantity: number;
}

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(message = 'Refund resource was not found'): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', message);
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function versionConflict(message: string): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', message);
}

function quotaExceeded(message: string): ApplicationError {
  return new ApplicationError('AFTERSALE_QUOTA_EXCEEDED', message);
}

function resultConflict(message: string): ApplicationError {
  return new ApplicationError('PAYMENT_RESULT_CONFLICT', message);
}

function assertUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function assertVersion(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} must be a positive PostgreSQL integer`);
  }
}

function normalizeReason(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Refund reason must be a string');
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 500 ||
    Array.from(normalized).some((character) => {
      const point = character.codePointAt(0);
      return point !== undefined && (point <= 0x1f || point === 0x7f);
    })) {
    throw new TypeError('Refund reason must contain 2 to 500 non-control characters');
  }
  return normalized;
}

function decimal(value: unknown, label: string, allowZero = false): Prisma.Decimal {
  let parsed: Prisma.Decimal;
  try {
    parsed = Prisma.Decimal.isDecimal(value) ? value : new Prisma.Decimal(String(value));
  } catch {
    throw new TypeError(`${label} must be money with at most two decimal places`);
  }
  if (!parsed.isFinite() || parsed.decimalPlaces() > 2 || parsed.isNegative() ||
    (!allowZero && parsed.isZero()) || parsed.greaterThan(MAX_MONEY)) {
    throw new TypeError(`${label} must be positive money with at most two decimal places`);
  }
  return parsed;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function storedMoney(value: unknown, label: string): Prisma.Decimal {
  if (!Prisma.Decimal.isDecimal(value) || !value.isFinite() || value.decimalPlaces() > 2 ||
    value.isNegative() || value.greaterThan(MAX_MONEY)) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function storedCount(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum ||
    (value as number) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return value as number;
}

function storedDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return value;
}

function assertReference(value: unknown, label: string, nullable = false): asserts value is string | null {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length < 1 || value.length > 128) {
    throw new TypeError(`${label} must contain 1 to 128 characters`);
  }
}

function assertProvider(value: unknown): asserts value is PaymentProvider {
  if (value !== 'MOCK' && value !== 'WECHAT') throw new TypeError('Refund Provider is invalid');
}

function assertAttemptKey(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 80) {
    throw new TypeError('Refund attempt idempotency key must contain 1 to 80 characters');
  }
}

export class AdminRefundRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async previewAftersaleRefundInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleRefundPreviewInput,
  ): Promise<AdminAftersaleRefundPreviewSnapshot> {
    const normalized = this.normalizeAftersaleInput(input);
    await this.assertActor(transaction, normalized.actorAccountId, false);
    return this.buildAftersalePreview(transaction, normalized);
  }

  previewAftersaleRefund(input: AdminAftersaleRefundPreviewInput): Promise<AdminAftersaleRefundPreviewSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.previewAftersaleRefundInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async createAftersaleRefundInTransaction(
    transaction: DatabaseTransaction,
    input: AdminAftersaleRefundCreateInput,
    hooks: AdminRefundPreviewHooks<AdminAftersaleRefundPreviewSnapshot>,
  ): Promise<AdminRefundSnapshot> {
    return this.createAftersaleRefundCore(transaction, input, hooks);
  }

  async previewManualCompensationInTransaction(
    transaction: DatabaseTransaction,
    input: AdminManualCompensationPreviewInput,
  ): Promise<AdminManualCompensationPreviewSnapshot> {
    const normalized = this.normalizeCompensationInput(input);
    await this.assertActor(transaction, normalized.actorAccountId, false);
    return this.buildCompensationPreview(transaction, normalized);
  }

  previewManualCompensation(
    input: AdminManualCompensationPreviewInput,
  ): Promise<AdminManualCompensationPreviewSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.previewManualCompensationInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async createManualCompensationInTransaction(
    transaction: DatabaseTransaction,
    input: AdminManualCompensationCreateInput,
    hooks: AdminRefundPreviewHooks<AdminManualCompensationPreviewSnapshot>,
  ): Promise<AdminRefundSnapshot> {
    return this.createManualCompensationCore(transaction, input, hooks);
  }

  async previewRetryRefundInTransaction(
    transaction: DatabaseTransaction,
    input: AdminRefundRetryPreviewInput,
  ): Promise<AdminRefundRetryPreviewSnapshot> {
    const normalized = this.normalizeRetryInput(input);
    await this.assertActor(transaction, normalized.actorAccountId, false);
    return this.buildRetryPreview(transaction, normalized);
  }

  previewRetryRefund(input: AdminRefundRetryPreviewInput): Promise<AdminRefundRetryPreviewSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.previewRetryRefundInTransaction(transaction, input),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async prepareRetryRefundInTransaction(
    transaction: DatabaseTransaction,
    input: AdminRefundRetryPrepareInput,
    hooks: AdminRefundPreviewHooks<AdminRefundRetryPreviewSnapshot>,
  ): Promise<AdminRefundSnapshot> {
    return this.prepareRetryCore(transaction, input, hooks);
  }

  async getRefundInTransaction(
    transaction: DatabaseTransaction,
    input: { refundId: string },
  ): Promise<AdminRefundSnapshot> {
    assertUlid(input.refundId, 'Refund ID');
    return this.readRefundSnapshot(transaction, input.refundId);
  }

  async claimRefundAttemptInTransaction(
    transaction: DatabaseTransaction,
    input: AdminRefundAttemptClaimInput,
  ): Promise<AdminRefundProviderOperation> {
    return this.claimRefundAttemptCore(transaction, input);
  }

  async isHistoricalRefundAttemptReplayInTransaction(
    transaction: DatabaseTransaction,
    input: AdminHistoricalRefundAttemptReplayInput,
  ): Promise<boolean> {
    return this.isHistoricalRefundAttemptReplayCore(transaction, input);
  }

  async finalizeRefundAttemptInTransaction(
    transaction: DatabaseTransaction,
    input: AdminRefundFinalizeInput,
  ): Promise<AdminRefundFinalizeResult> {
    return this.finalizeRefundAttemptCore(transaction, input);
  }

  // Implementations follow below; the public boundary intentionally keeps Provider I/O,
  // high-risk preview storage, audit, outbox and request idempotency in their owning layers.
  private normalizeAftersaleInput<T extends AdminAftersaleRefundPreviewInput>(input: T): T & { reason: string } {
    assertUlid(input.actorAccountId, 'Refund actor ID');
    assertUlid(input.aftersaleId, 'Aftersale ID');
    if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) {
      throw new TypeError('Refund must contain 1 to 100 items');
    }
    const seen = new Set<string>();
    for (const item of input.items) {
      assertUlid(item.aftersaleItemId, 'Aftersale Item ID');
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) {
        throw new TypeError('Refund quantity must be between 1 and 99');
      }
      if (seen.has(item.aftersaleItemId)) throw new TypeError('Refund items must be unique');
      seen.add(item.aftersaleItemId);
    }
    return { ...input, reason: normalizeReason(input.reason) };
  }

  private normalizeCompensationInput<T extends AdminManualCompensationPreviewInput>(
    input: T,
  ): T & { amount: string; reason: string } {
    assertUlid(input.actorAccountId, 'Compensation actor ID');
    assertUlid(input.orderId, 'Order ID');
    assertUlid(input.orderItemId, 'Order Item ID');
    assertProvider(input.provider);
    return { ...input, amount: money(decimal(input.amount, 'Compensation amount')), reason: normalizeReason(input.reason) };
  }

  private normalizeRetryInput<T extends AdminRefundRetryPreviewInput>(input: T): T & { reason: string } {
    assertUlid(input.actorAccountId, 'Refund retry actor ID');
    assertUlid(input.refundId, 'Refund ID');
    return { ...input, reason: normalizeReason(input.reason) };
  }

  private async assertActor(
    transaction: DatabaseTransaction,
    actorAccountId: string,
    lock: boolean,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<ActorRow[]>(lock ? Prisma.sql`
      SELECT id, role::text, status::text, deleted_at, password_hash IS NOT NULL AS has_password
      FROM public.account WHERE id = ${actorAccountId} FOR UPDATE
    ` : Prisma.sql`
      SELECT id, role::text, status::text, deleted_at, password_hash IS NOT NULL AS has_password
      FROM public.account WHERE id = ${actorAccountId}
    `);
    const actor = rows[0];
    if (rows.length !== 1 || actor?.id !== actorAccountId || actor.role !== 'SUPER_ADMIN' ||
      actor.status !== 'ACTIVE' || actor.deleted_at !== null || actor.has_password !== true) {
      throw new ApplicationError('AUTH_REQUIRED', 'Active SUPER_ADMIN account is required');
    }
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    return storedDate(rows[0]?.transaction_time, 'Database transaction time');
  }

  private async readOrder(transaction: DatabaseTransaction, orderId: string): Promise<OrderRow> {
    const rows = await transaction.$queryRaw<OrderRow[]>(Prisma.sql`
      SELECT id, customer_id, order_status::text, payment_status::text,
             refund_progress_status::text, refund_processing_status::text,
             fulfillment_status::text, close_reason::text, completion_reason::text,
             payment_resolution::text, paid_amount, refunded_amount, completed_at,
             closed_at, version
      FROM public.sales_order
      WHERE id = ${orderId}
    `);
    const order = rows[0];
    if (rows.length !== 1 || order?.id !== orderId) throw notFound('Order was not found');
    assertUlid(order.customer_id, 'Stored Customer ID');
    storedMoney(order.paid_amount, 'Stored paid amount');
    storedMoney(order.refunded_amount, 'Stored refunded amount');
    storedCount(order.version, 'Stored Order version', 1);
    return order;
  }

  private assertRefundableOrder(order: OrderRow): void {
    if (order.payment_status !== 'PAID' || order.payment_resolution !== 'NORMAL' ||
      order.order_status === 'CLOSED' || order.paid_amount.isZero() ||
      order.refunded_amount.greaterThan(order.paid_amount)) {
      throw stateConflict('Order is not eligible for an ordinary refund');
    }
  }

  private async readPaymentSource(
    transaction: DatabaseTransaction,
    orderId: string,
  ): Promise<PaymentSourceRow> {
    const rows = await transaction.$queryRaw<PaymentSourceRow[]>(Prisma.sql`
      SELECT intent.id AS payment_intent_id, intent.provider, intent.provider_intent_id,
             intent.amount, attempt.id AS payment_attempt_id, attempt.provider_transaction_id
      FROM public.payment_intent AS intent
      INNER JOIN public.payment_attempt AS attempt
        ON attempt.payment_intent_id = intent.id
       AND attempt.status = 'SUCCEEDED'
      WHERE intent.order_id = ${orderId}
        AND intent.status = 'SUCCEEDED'
      ORDER BY intent.id ASC, attempt.id ASC
    `);
    const source = rows[0];
    if (rows.length !== 1 || source === undefined || source.provider_intent_id === null ||
      source.provider_transaction_id === null) {
      throw new ApplicationError(
        'PAYMENT_CONFIGURATION_UNAVAILABLE',
        'A unique successful payment source is required for refund',
      );
    }
    assertProvider(source.provider);
    assertReference(source.provider_intent_id, 'Stored Provider intent ID');
    assertReference(source.provider_transaction_id, 'Stored Provider transaction ID');
    storedMoney(source.amount, 'Stored payment source amount');
    return source;
  }

  private async readAftersaleHeader(
    transaction: DatabaseTransaction,
    aftersaleId: string,
  ): Promise<AftersaleHeaderRow> {
    const rows = await transaction.$queryRaw<AftersaleHeaderRow[]>(Prisma.sql`
      SELECT a.id, a.order_id, a.customer_id, a.type::text, a.status::text,
             a.version, r.id AS refund_id
      FROM public.aftersale AS a
      LEFT JOIN public.refund AS r ON r.aftersale_id = a.id
      WHERE a.id = ${aftersaleId}
    `);
    const record = rows[0];
    if (rows.length !== 1 || record?.id !== aftersaleId ||
      (record.type !== 'REFUND_ONLY' && record.type !== 'RETURN_REFUND')) {
      throw notFound('Aftersale was not found');
    }
    assertUlid(record.order_id, 'Stored Order ID');
    assertUlid(record.customer_id, 'Stored Customer ID');
    storedCount(record.version, 'Stored aftersale version', 1);
    return record;
  }

  private async readAftersaleLines(
    transaction: DatabaseTransaction,
    aftersaleId: string,
  ): Promise<RefundableLineRow[]> {
    return transaction.$queryRaw<RefundableLineRow[]>(Prisma.sql`
      SELECT
        ai.id AS aftersale_item_id,
        ai.reserved_qty AS aftersale_reserved_qty,
        ai.reserved_amount AS aftersale_reserved_amount,
        ai.refunded_qty AS aftersale_refunded_qty,
        ai.refunded_amount AS aftersale_refunded_amount,
        oi.id AS order_item_id, oi.order_id, oi.product_id, oi.sku_id,
        oi.unit_price, oi.quantity, oi.line_paid_amount,
        oi.refunded_qty AS order_item_refunded_qty,
        oi.pre_shipment_refunded_qty AS order_item_pre_shipment_refunded_qty,
        oi.refunded_amount AS order_item_refunded_amount,
        oi.aftersale_reserved_qty AS order_item_aftersale_reserved_qty,
        oi.aftersale_reserved_amount AS order_item_aftersale_reserved_amount,
        oi.shipped_qty AS order_item_shipped_qty, oi.version AS order_item_version,
        product.sales_count AS product_sales_count, product.version AS product_version,
        balance.id AS inventory_balance_id, balance.physical_qty AS inventory_physical_qty,
        balance.locked_qty AS inventory_locked_qty, balance.version AS inventory_version,
        inspection.status::text AS inspection_status,
        inspection.resolution::text AS inspection_resolution,
        inspection_item.approved_refund_qty,
        inspection_item.restock_qty, inspection_item.damaged_qty,
        inspection_item.scrap_qty, inspection_item.return_to_customer_qty,
        snapshot.id AS commission_snapshot_id, snapshot.agent_id AS commission_snapshot_agent_id,
        snapshot.effective_rate AS commission_effective_rate,
        snapshot.commission_base, snapshot.original_commission AS commission_original,
        position.id AS commission_position_id, position.state::text AS commission_position_state,
        position.expected_remaining AS commission_expected_remaining,
        position.reversed_total AS commission_reversed_total,
        position.available_at AS commission_available_at,
        position.version AS commission_position_version,
        wallet.id AS wallet_id, wallet.available_balance AS wallet_available_balance,
        wallet.frozen_balance AS wallet_frozen_balance, wallet.version AS wallet_version,
        COALESCE(committed.amount, 0.00)::numeric(18,2) AS committed_refund_amount,
        COALESCE(committed.commission, 0.00)::numeric(18,2) AS committed_commission_reversal
      FROM public.aftersale_item AS ai
      INNER JOIN public.order_item AS oi ON oi.id = ai.order_item_id
      INNER JOIN public.product AS product ON product.id = oi.product_id
      INNER JOIN public.sku AS sku ON sku.id = oi.sku_id
      LEFT JOIN public.inventory_balance AS balance ON balance.sku_id = sku.id
      LEFT JOIN public.return_inspection AS inspection ON inspection.aftersale_id = ai.aftersale_id
      LEFT JOIN public.return_inspection_item AS inspection_item
        ON inspection_item.inspection_id = inspection.id
       AND inspection_item.order_item_id = oi.id
      LEFT JOIN public.order_item_commission_snapshot AS snapshot ON snapshot.order_item_id = oi.id
      LEFT JOIN public.order_item_commission_position AS position ON position.snapshot_id = snapshot.id
      LEFT JOIN public.agent_wallet AS wallet ON wallet.agent_id = snapshot.agent_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(ri.amount), 0.00) AS amount,
               COALESCE(sum(ri.commission_reversal), 0.00) AS commission
        FROM public.refund_item AS ri
        INNER JOIN public.refund AS r ON r.id = ri.refund_id
        WHERE ri.order_item_id = oi.id
          AND r.status IN ('PENDING', 'PROCESSING', 'FAILED')
      ) AS committed ON TRUE
      WHERE ai.aftersale_id = ${aftersaleId}
      ORDER BY ai.id ASC
    `);
  }

  private async readOrderLine(
    transaction: DatabaseTransaction,
    orderId: string,
    orderItemId: string,
  ): Promise<RefundableLineRow> {
    const rows = await transaction.$queryRaw<RefundableLineRow[]>(Prisma.sql`
      SELECT
        NULL::text AS aftersale_item_id,
        0::integer AS aftersale_reserved_qty, 0.00::numeric(18,2) AS aftersale_reserved_amount,
        0::integer AS aftersale_refunded_qty, 0.00::numeric(18,2) AS aftersale_refunded_amount,
        oi.id AS order_item_id, oi.order_id, oi.product_id, oi.sku_id,
        oi.unit_price, oi.quantity, oi.line_paid_amount,
        oi.refunded_qty AS order_item_refunded_qty,
        oi.pre_shipment_refunded_qty AS order_item_pre_shipment_refunded_qty,
        oi.refunded_amount AS order_item_refunded_amount,
        oi.aftersale_reserved_qty AS order_item_aftersale_reserved_qty,
        oi.aftersale_reserved_amount AS order_item_aftersale_reserved_amount,
        oi.shipped_qty AS order_item_shipped_qty, oi.version AS order_item_version,
        product.sales_count AS product_sales_count, product.version AS product_version,
        balance.id AS inventory_balance_id, balance.physical_qty AS inventory_physical_qty,
        balance.locked_qty AS inventory_locked_qty, balance.version AS inventory_version,
        NULL::text AS inspection_status, NULL::text AS inspection_resolution,
        NULL::integer AS approved_refund_qty, NULL::integer AS restock_qty,
        NULL::integer AS damaged_qty, NULL::integer AS scrap_qty,
        NULL::integer AS return_to_customer_qty,
        snapshot.id AS commission_snapshot_id, snapshot.agent_id AS commission_snapshot_agent_id,
        snapshot.effective_rate AS commission_effective_rate,
        snapshot.commission_base, snapshot.original_commission AS commission_original,
        position.id AS commission_position_id, position.state::text AS commission_position_state,
        position.expected_remaining AS commission_expected_remaining,
        position.reversed_total AS commission_reversed_total,
        position.available_at AS commission_available_at,
        position.version AS commission_position_version,
        wallet.id AS wallet_id, wallet.available_balance AS wallet_available_balance,
        wallet.frozen_balance AS wallet_frozen_balance, wallet.version AS wallet_version,
        COALESCE(committed.amount, 0.00)::numeric(18,2) AS committed_refund_amount,
        COALESCE(committed.commission, 0.00)::numeric(18,2) AS committed_commission_reversal
      FROM public.order_item AS oi
      INNER JOIN public.product AS product ON product.id = oi.product_id
      INNER JOIN public.sku AS sku ON sku.id = oi.sku_id
      LEFT JOIN public.inventory_balance AS balance ON balance.sku_id = sku.id
      LEFT JOIN public.order_item_commission_snapshot AS snapshot ON snapshot.order_item_id = oi.id
      LEFT JOIN public.order_item_commission_position AS position ON position.snapshot_id = snapshot.id
      LEFT JOIN public.agent_wallet AS wallet ON wallet.agent_id = snapshot.agent_id
      LEFT JOIN LATERAL (
        SELECT COALESCE(sum(ri.amount), 0.00) AS amount,
               COALESCE(sum(ri.commission_reversal), 0.00) AS commission
        FROM public.refund_item AS ri
        INNER JOIN public.refund AS r ON r.id = ri.refund_id
        WHERE ri.order_item_id = oi.id
          AND r.status IN ('PENDING', 'PROCESSING', 'FAILED')
      ) AS committed ON TRUE
      WHERE oi.id = ${orderItemId} AND oi.order_id = ${orderId}
    `);
    const line = rows[0];
    if (rows.length !== 1 || line?.order_item_id !== orderItemId) throw notFound('Order Item was not found');
    return line;
  }

  private commissionReversal(line: RefundableLineRow, refundAmount: Prisma.Decimal): Prisma.Decimal {
    const snapshotId = line.commission_snapshot_id;
    if (snapshotId === null) {
      if (line.commission_position_id !== null || line.commission_original !== null ||
        line.commission_effective_rate !== null) {
        throw internal('Commission snapshot envelope is incomplete');
      }
      return new Prisma.Decimal(0);
    }
    assertUlid(snapshotId, 'Stored commission snapshot ID');
    if (line.commission_position_id === null || line.commission_snapshot_agent_id === null ||
      line.commission_effective_rate === null || line.commission_base === null ||
      line.commission_original === null || line.commission_expected_remaining === null ||
      line.commission_reversed_total === null || line.commission_position_version === null) {
      throw internal('Commission position envelope is incomplete');
    }
    const original = storedMoney(line.commission_original, 'Stored original commission');
    const reversed = storedMoney(line.commission_reversed_total, 'Stored reversed commission');
    const committed = storedMoney(line.committed_commission_reversal, 'Stored committed commission reversal');
    const base = storedMoney(line.commission_base, 'Stored commission base');
    const rate = line.commission_effective_rate;
    if (rate.isNegative() || rate.greaterThan(100) || rate.decimalPlaces() > 4 ||
      reversed.add(committed).greaterThan(original)) {
      throw internal('Commission allocation facts are invalid');
    }
    const remaining = original.minus(reversed).minus(committed);
    if (remaining.isZero()) return remaining;
    const committedRefund = storedMoney(line.committed_refund_amount, 'Stored committed refund amount');
    const successfulRefund = storedMoney(line.order_item_refunded_amount, 'Stored successful refund amount');
    const reachesTail = successfulRefund.add(committedRefund).add(refundAmount).greaterThanOrEqualTo(base);
    if (reachesTail) return remaining;
    const candidate = refundAmount.mul(rate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    return Prisma.Decimal.min(candidate, remaining);
  }

  private validateLine(line: RefundableLineRow): void {
    assertUlid(line.order_item_id, 'Stored Order Item ID');
    assertUlid(line.order_id, 'Stored Order ID');
    assertUlid(line.product_id, 'Stored Product ID');
    assertUlid(line.sku_id, 'Stored SKU ID');
    storedCount(line.quantity, 'Stored Order Item quantity', 1);
    storedCount(line.order_item_refunded_qty, 'Stored refunded quantity');
    storedCount(line.order_item_pre_shipment_refunded_qty, 'Stored pre-shipment refunded quantity');
    storedCount(line.order_item_aftersale_reserved_qty, 'Stored aftersale reserved quantity');
    storedCount(line.order_item_shipped_qty, 'Stored shipped quantity');
    storedCount(line.order_item_version, 'Stored Order Item version', 1);
    storedCount(line.product_sales_count, 'Stored Product net sales');
    storedCount(line.product_version, 'Stored Product version', 1);
    storedMoney(line.unit_price, 'Stored unit price');
    storedMoney(line.line_paid_amount, 'Stored line paid amount');
    storedMoney(line.order_item_refunded_amount, 'Stored Order Item refunded amount');
    storedMoney(line.order_item_aftersale_reserved_amount, 'Stored Order Item reserved amount');
    storedMoney(line.committed_refund_amount, 'Stored committed refund amount');
    storedMoney(line.committed_commission_reversal, 'Stored committed commission reversal');
  }

  private impactItem(
    line: RefundableLineRow,
    amount: Prisma.Decimal,
    quantity: number,
    autoRestock: boolean,
    inventoryRestockQuantity: number,
  ): AdminRefundImpactItem {
    return {
      aftersaleItemId: line.aftersale_item_id,
      amount: money(amount),
      autoRestock,
      commissionReversal: money(this.commissionReversal(line, amount)),
      inventoryRestockQuantity,
      orderItemId: line.order_item_id,
      quantity,
      skuId: line.sku_id,
    };
  }

  private async buildAftersalePreview(
    transaction: DatabaseTransaction,
    input: AdminAftersaleRefundPreviewInput,
  ): Promise<AdminAftersaleRefundPreviewSnapshot> {
    const header = await this.readAftersaleHeader(transaction, input.aftersaleId);
    const order = await this.readOrder(transaction, header.order_id);
    this.assertRefundableOrder(order);
    if (header.customer_id !== order.customer_id || header.refund_id !== null) {
      throw stateConflict('Aftersale already has a stable refund or an invalid owner');
    }
    if ((header.type === 'REFUND_ONLY' && header.status !== 'REFUNDING') ||
      (header.type === 'RETURN_REFUND' && header.status !== 'REFUNDING_AFTER_RETURN')) {
      throw stateConflict('Aftersale is not ready to create a refund');
    }
    const payment = await this.readPaymentSource(transaction, order.id);
    const lines = await this.readAftersaleLines(transaction, header.id);
    if (lines.length < 1) throw quotaExceeded('Refund has no frozen aftersale items');
    const requested = new Map(input.items.map((item) => [item.aftersaleItemId, item.quantity]));
    const items: AdminRefundImpactItem[] = [];
    for (const line of lines) {
      this.validateLine(line);
      if (line.aftersale_item_id === null) throw internal('Stored aftersale item ID is missing');
      const requestedQuantity = requested.get(line.aftersale_item_id);
      const reservedQuantity = storedCount(line.aftersale_reserved_qty, 'Stored aftersale reserved quantity');
      const refundedQuantity = storedCount(line.aftersale_refunded_qty, 'Stored aftersale refunded quantity');
      const reservedAmount = storedMoney(line.aftersale_reserved_amount, 'Stored aftersale reserved amount');
      const refundedAmount = storedMoney(line.aftersale_refunded_amount, 'Stored aftersale refunded amount');
      if (refundedQuantity > reservedQuantity || refundedAmount.greaterThan(reservedAmount)) {
        throw internal('Stored aftersale refund allocation exceeds its frozen reservation');
      }
      if (header.type === 'REFUND_ONLY') {
        const remainingQuantity = reservedQuantity - refundedQuantity;
        const remainingAmount = reservedAmount.minus(refundedAmount);
        if (remainingQuantity < 1 || remainingAmount.lessThanOrEqualTo(0) ||
          requestedQuantity !== remainingQuantity) {
          throw quotaExceeded('Refund quantity must exactly equal the remaining frozen aftersale quantity');
        }
        if (line.order_item_shipped_qty !== 0) {
          throw stateConflict('A REFUND_ONLY item cannot have shipped quantity');
        }
        items.push(this.impactItem(line, remainingAmount, remainingQuantity, true, remainingQuantity));
        continue;
      }
      const approvedQuantity = line.approved_refund_qty;
      const inspectionIsEligible =
        (line.inspection_status === 'PASS' && line.inspection_resolution === null) ||
        (line.inspection_status === 'ABNORMAL' && line.inspection_resolution === 'CONTINUE_REFUND');
      if (approvedQuantity === null || !inspectionIsEligible) {
        throw stateConflict('Returned-goods refund requires a frozen eligible inspection result');
      }
      const approved = storedCount(approvedQuantity, 'Stored inspection approved refund quantity');
      if (approved > reservedQuantity || refundedQuantity > approved) {
        throw internal('Inspection approval is outside the frozen aftersale reservation');
      }
      const remainingQuantity = approved - refundedQuantity;
      const approvedAmount = approved === reservedQuantity
        ? reservedAmount
        : storedMoney(line.unit_price, 'Stored unit price').mul(approved);
      if (approvedAmount.greaterThan(reservedAmount) || approvedAmount.greaterThan(MAX_MONEY) ||
        refundedAmount.greaterThan(approvedAmount)) {
        throw internal('Inspection approved refund amount is outside the frozen aftersale reservation');
      }
      const remainingAmount = approvedAmount.minus(refundedAmount);
      if (remainingQuantity === 0) {
        if (requestedQuantity !== undefined) {
          throw quotaExceeded('Refund contains an aftersale item with no remaining approved quantity');
        }
        continue;
      }
      if (remainingAmount.lessThanOrEqualTo(0) || requestedQuantity !== remainingQuantity) {
        throw quotaExceeded('Returned-goods quantity must exactly equal the remaining frozen approval');
      }
      if (line.order_item_aftersale_reserved_qty < remainingQuantity ||
        line.order_item_aftersale_reserved_amount.lessThan(remainingAmount)) {
        throw internal('Approved return refund exceeds the current Order Item reservation');
      }
      const restockQuantity = storedCount(line.restock_qty, 'Stored return restock quantity');
      if (restockQuantity > remainingQuantity) throw internal('Return restock quantity exceeds refund quantity');
      items.push(this.impactItem(line, remainingAmount, remainingQuantity, false, restockQuantity));
    }
    if (items.length < 1 || items.length !== input.items.length ||
      [...requested.keys()].some((id) => !items.some((item) => item.aftersaleItemId === id))) {
      throw quotaExceeded('Refund contains an unknown aftersale item');
    }
    const amount = items.reduce((sum, item) => sum.add(item.amount), new Prisma.Decimal(0));
    if (amount.isZero() || amount.greaterThan(order.paid_amount.minus(order.refunded_amount))) {
      throw quotaExceeded('Refund amount exceeds the remaining paid amount');
    }
    return {
      affectedCount: items.length,
      aftersaleId: header.id,
      amount: money(amount),
      items,
      orderId: header.order_id,
      originType: 'AFTERSALE',
      provider: payment.provider,
      resourceVersion: header.version,
      warnings: [
        'Provider execution occurs after the database creation transaction',
        'Inventory and commission change only after an explicit successful result',
      ],
    };
  }

  private async buildCompensationPreview(
    transaction: DatabaseTransaction,
    input: AdminManualCompensationPreviewInput,
  ): Promise<AdminManualCompensationPreviewSnapshot> {
    const order = await this.readOrder(transaction, input.orderId);
    this.assertRefundableOrder(order);
    const payment = await this.readPaymentSource(transaction, order.id);
    if (payment.provider !== input.provider) {
      throw new ApplicationError('PAYMENT_CONFIGURATION_UNAVAILABLE', 'Refund Provider differs from the paid Provider');
    }
    const line = await this.readOrderLine(transaction, order.id, input.orderItemId);
    this.validateLine(line);
    const amount = decimal(input.amount, 'Compensation amount');
    const remaining = line.line_paid_amount
      .minus(line.order_item_refunded_amount)
      .minus(line.order_item_aftersale_reserved_amount);
    if (remaining.lessThanOrEqualTo(0) || amount.greaterThan(remaining)) {
      throw quotaExceeded('Compensation amount exceeds the remaining Order Item amount');
    }
    return {
      affectedCount: 1,
      amount: money(amount),
      commissionReversal: money(this.commissionReversal(line, amount)),
      orderId: order.id,
      orderItemId: line.order_item_id,
      originType: 'MANUAL_COMPENSATION',
      provider: payment.provider,
      remainingAmountBefore: money(remaining),
      resourceVersion: order.version,
      warnings: [
        'Amount compensation does not reserve quantity or restore inventory',
        'Commission changes only after an explicit successful result',
      ],
    };
  }

  private async lockOrderEnvelope(transaction: DatabaseTransaction, orderId: string): Promise<void> {
    const order = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.sales_order WHERE id = ${orderId} FOR UPDATE
    `);
    if (order.length !== 1 || order[0]?.id !== orderId) throw notFound('Order was not found');
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.order_item WHERE order_id = ${orderId} ORDER BY id ASC FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.aftersale WHERE order_id = ${orderId} ORDER BY id ASC FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT item.id FROM public.aftersale_item AS item
      INNER JOIN public.aftersale AS a ON a.id = item.aftersale_id
      WHERE a.order_id = ${orderId} ORDER BY item.id ASC FOR UPDATE OF item
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.manual_compensation WHERE order_id = ${orderId} ORDER BY id ASC FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.refund WHERE order_id = ${orderId} ORDER BY id ASC FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT attempt.id FROM public.refund_attempt AS attempt
      INNER JOIN public.refund AS refund ON refund.id = attempt.refund_id
      WHERE refund.order_id = ${orderId} ORDER BY attempt.id ASC FOR UPDATE OF attempt
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.payment_intent WHERE order_id = ${orderId} ORDER BY id ASC FOR UPDATE
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT attempt.id FROM public.payment_attempt AS attempt
      INNER JOIN public.payment_intent AS intent ON intent.id = attempt.payment_intent_id
      WHERE intent.order_id = ${orderId} ORDER BY attempt.id ASC FOR UPDATE OF attempt
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT product.id FROM public.product AS product
      INNER JOIN public.order_item AS item ON item.product_id = product.id
      WHERE item.order_id = ${orderId} ORDER BY product.id ASC FOR UPDATE OF product
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT sku.id FROM public.sku AS sku
      INNER JOIN public.order_item AS item ON item.sku_id = sku.id
      WHERE item.order_id = ${orderId} ORDER BY sku.id ASC FOR UPDATE OF sku
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT balance.id FROM public.inventory_balance AS balance
      INNER JOIN public.order_item AS item ON item.sku_id = balance.sku_id
      WHERE item.order_id = ${orderId} ORDER BY balance.id ASC FOR UPDATE OF balance
    `);
    await transaction.$queryRaw(Prisma.sql`
      SELECT position.id
      FROM public.order_item_commission_position AS position
      INNER JOIN public.order_item_commission_snapshot AS snapshot ON snapshot.id = position.snapshot_id
      INNER JOIN public.order_item AS item ON item.id = snapshot.order_item_id
      WHERE item.order_id = ${orderId}
      ORDER BY snapshot.id ASC, position.id ASC FOR UPDATE OF position
    `);
    const agents = await transaction.$queryRaw<Array<{ agent_id: string }>>(Prisma.sql`
      SELECT DISTINCT snapshot.agent_id
      FROM public.order_item_commission_snapshot AS snapshot
      INNER JOIN public.order_item AS item ON item.id = snapshot.order_item_id
      WHERE item.order_id = ${orderId}
      ORDER BY snapshot.agent_id ASC
    `);
    for (const { agent_id: agentId } of agents) {
      assertUlid(agentId, 'Stored commission Agent ID');
      await acquireTransactionLock(transaction, 'agent-wallet', [agentId]);
    }
    if (agents.length > 0) {
      await transaction.$queryRaw(Prisma.sql`
        SELECT wallet.id FROM public.agent_wallet AS wallet
        WHERE wallet.agent_id IN (${Prisma.join(agents.map(({ agent_id }) => agent_id))})
        ORDER BY wallet.agent_id ASC FOR UPDATE OF wallet
      `);
    }
  }

  private async createAftersaleRefundCore(
    transaction: DatabaseTransaction,
    input: AdminAftersaleRefundCreateInput,
    hooks: AdminRefundPreviewHooks<AdminAftersaleRefundPreviewSnapshot>,
  ): Promise<AdminRefundSnapshot> {
    const normalized = this.normalizeAftersaleInput(input);
    assertVersion(input.expectedVersion, 'Aftersale expected version');
    assertProvider(input.provider);
    assertAttemptKey(input.attemptIdempotencyKey);
    if (!hooks || typeof hooks.verifyPreview !== 'function') throw new TypeError('Refund preview verifier is required');
    const candidate = await this.readAftersaleHeader(transaction, input.aftersaleId);
    await this.assertActor(transaction, normalized.actorAccountId, true);
    await this.lockOrderEnvelope(transaction, candidate.order_id);
    const preview = await this.buildAftersalePreview(transaction, normalized);
    if (preview.resourceVersion !== input.expectedVersion) throw versionConflict('Aftersale version changed');
    if (preview.provider !== input.provider) {
      throw new ApplicationError('PAYMENT_CONFIGURATION_UNAVAILABLE', 'Refund Provider differs from the paid Provider');
    }
    await hooks.verifyPreview(preview);
    const occurredAt = await this.transactionTime(transaction);
    const refundId = generateUlid(occurredAt.getTime());
    const attemptId = generateUlid(occurredAt.getTime());
    const refundNo = `RF${refundId}`;
    await transaction.refund.create({
      data: {
        aftersale_id: preview.aftersaleId,
        amount: new Prisma.Decimal(preview.amount),
        id: refundId,
        is_late_payment_refund: false,
        order_id: preview.orderId,
        origin_type: 'AFTERSALE',
        provider: input.provider,
        reason: normalized.reason,
        refund_no: refundNo,
        requested_at: occurredAt,
        status: 'PENDING',
        updated_at: occurredAt,
      },
    });
    const inserted = await transaction.refundItem.createMany({
      data: preview.items.map((item) => ({
        aftersale_item_id: item.aftersaleItemId,
        amount: new Prisma.Decimal(item.amount),
        auto_restock: item.autoRestock,
        commission_reversal: new Prisma.Decimal(item.commissionReversal),
        created_at: occurredAt,
        id: generateUlid(occurredAt.getTime()),
        order_item_id: item.orderItemId,
        quantity: item.quantity,
        refund_id: refundId,
      })),
    });
    if (inserted.count !== preview.items.length) throw internal('Refund Item insert count is invalid');
    await transaction.refundAttempt.create({
      data: {
        attempt_no: 1,
        id: attemptId,
        idempotency_key: input.attemptIdempotencyKey,
        provider: input.provider,
        refund_id: refundId,
        requested_at: occurredAt,
        status: 'INITIATED',
      },
    });
    const aftersaleChanged = await transaction.aftersale.updateMany({
      data: { updated_at: occurredAt, version: { increment: 1 } },
      where: { id: preview.aftersaleId, status: candidate.status as never, version: input.expectedVersion },
    });
    const order = await this.readOrder(transaction, preview.orderId);
    const orderChanged = await transaction.salesOrder.updateMany({
      data: { refund_processing_status: 'REFUNDING', updated_at: occurredAt, version: { increment: 1 } },
      where: { id: order.id, payment_resolution: 'NORMAL', payment_status: 'PAID', version: order.version },
    });
    if (aftersaleChanged.count !== 1 || orderChanged.count !== 1) {
      throw versionConflict('Refund source changed during creation');
    }
    return {
      aftersaleId: preview.aftersaleId,
      amount: preview.amount,
      attemptId,
      attemptNo: 1,
      compensationId: null,
      compensationNo: null,
      items: preview.items,
      orderId: preview.orderId,
      originType: 'AFTERSALE',
      refundId,
      refundNo,
      status: 'PENDING',
      version: 1,
    };
  }

  private async createManualCompensationCore(
    transaction: DatabaseTransaction,
    input: AdminManualCompensationCreateInput,
    hooks: AdminRefundPreviewHooks<AdminManualCompensationPreviewSnapshot>,
  ): Promise<AdminRefundSnapshot> {
    const normalized = this.normalizeCompensationInput(input);
    assertVersion(input.expectedVersion, 'Order expected version');
    assertAttemptKey(input.attemptIdempotencyKey);
    if (!hooks || typeof hooks.verifyPreview !== 'function') {
      throw new TypeError('Manual compensation preview verifier is required');
    }
    await this.assertActor(transaction, normalized.actorAccountId, true);
    await this.lockOrderEnvelope(transaction, normalized.orderId);
    const preview = await this.buildCompensationPreview(transaction, normalized);
    if (preview.resourceVersion !== input.expectedVersion) throw versionConflict('Order version changed');
    await hooks.verifyPreview(preview);
    const line = await this.readOrderLine(transaction, preview.orderId, preview.orderItemId);
    const occurredAt = await this.transactionTime(transaction);
    const compensationId = generateUlid(occurredAt.getTime());
    const refundId = generateUlid(occurredAt.getTime());
    const attemptId = generateUlid(occurredAt.getTime());
    const compensationNo = `MC${compensationId}`;
    const refundNo = `RF${refundId}`;
    const amount = new Prisma.Decimal(preview.amount);
    const commissionReversal = new Prisma.Decimal(preview.commissionReversal);
    await transaction.manualCompensation.create({
      data: {
        amount,
        approved_by_id: normalized.actorAccountId,
        commission_reversal: commissionReversal,
        compensation_no: compensationNo,
        created_at: occurredAt,
        customer_id: (await this.readOrder(transaction, preview.orderId)).customer_id,
        id: compensationId,
        order_id: preview.orderId,
        order_item_id: preview.orderItemId,
        reason: normalized.reason,
        reserved_amount: amount,
        status: 'PENDING',
        type: 'AMOUNT_COMPENSATION',
        updated_at: occurredAt,
      },
    });
    await transaction.refund.create({
      data: {
        amount,
        id: refundId,
        is_late_payment_refund: false,
        manual_compensation_id: compensationId,
        order_id: preview.orderId,
        origin_type: 'MANUAL_COMPENSATION',
        provider: normalized.provider,
        reason: normalized.reason,
        refund_no: refundNo,
        requested_at: occurredAt,
        status: 'PENDING',
        updated_at: occurredAt,
      },
    });
    await transaction.refundItem.create({
      data: {
        amount,
        auto_restock: false,
        commission_reversal: commissionReversal,
        created_at: occurredAt,
        id: generateUlid(occurredAt.getTime()),
        order_item_id: preview.orderItemId,
        quantity: 1,
        refund_id: refundId,
      },
    });
    await transaction.refundAttempt.create({
      data: {
        attempt_no: 1,
        id: attemptId,
        idempotency_key: input.attemptIdempotencyKey,
        provider: normalized.provider,
        refund_id: refundId,
        requested_at: occurredAt,
        status: 'INITIATED',
      },
    });
    const itemChanged = await transaction.orderItem.updateMany({
      data: {
        aftersale_reserved_amount: { increment: amount },
        version: { increment: 1 },
      },
      where: {
        aftersale_reserved_amount: line.order_item_aftersale_reserved_amount,
        id: line.order_item_id,
        order_id: preview.orderId,
        version: line.order_item_version,
      },
    });
    const orderChanged = await transaction.salesOrder.updateMany({
      data: { refund_processing_status: 'REFUNDING', updated_at: occurredAt, version: { increment: 1 } },
      where: { id: preview.orderId, payment_resolution: 'NORMAL', payment_status: 'PAID', version: input.expectedVersion },
    });
    if (itemChanged.count !== 1 || orderChanged.count !== 1) {
      throw versionConflict('Manual compensation quota changed during creation');
    }
    return {
      aftersaleId: null,
      amount: preview.amount,
      attemptId,
      attemptNo: 1,
      compensationId,
      compensationNo,
      items: [{
        aftersaleItemId: null,
        amount: preview.amount,
        autoRestock: false,
        commissionReversal: preview.commissionReversal,
        inventoryRestockQuantity: 0,
        orderItemId: preview.orderItemId,
        quantity: 1,
        skuId: line.sku_id,
      }],
      orderId: preview.orderId,
      originType: 'MANUAL_COMPENSATION',
      refundId,
      refundNo,
      status: 'PENDING',
      version: 1,
    };
  }

  private async readRefundHeader(transaction: DatabaseTransaction, refundId: string): Promise<RefundHeaderRow> {
    const rows = await transaction.$queryRaw<RefundHeaderRow[]>(Prisma.sql`
      SELECT refund.id, refund.refund_no, refund.order_id, refund.aftersale_id,
             refund.manual_compensation_id, refund.origin_type::text, refund.provider,
             refund.provider_refund_id, refund.status::text, refund.amount,
             refund.failure_code, refund.succeeded_at, refund.failed_at,
             refund.is_late_payment_refund, refund.version,
             order_row.customer_id,
             aftersale.type::text AS aftersale_type,
             aftersale.status::text AS aftersale_status,
             aftersale.version AS aftersale_version,
             compensation.status::text AS manual_compensation_status,
             compensation.version AS manual_compensation_version
      FROM public.refund AS refund
      INNER JOIN public.sales_order AS order_row ON order_row.id = refund.order_id
      LEFT JOIN public.aftersale AS aftersale ON aftersale.id = refund.aftersale_id
      LEFT JOIN public.manual_compensation AS compensation
        ON compensation.id = refund.manual_compensation_id
      WHERE refund.id = ${refundId}
    `);
    const refund = rows[0];
    if (rows.length !== 1 || refund?.id !== refundId) throw notFound();
    if ((refund.origin_type !== 'AFTERSALE' && refund.origin_type !== 'MANUAL_COMPENSATION') ||
      refund.is_late_payment_refund) {
      throw notFound();
    }
    assertProvider(refund.provider);
    storedMoney(refund.amount, 'Stored Refund amount');
    storedCount(refund.version, 'Stored Refund version', 1);
    return refund;
  }

  private async readRefundAttempts(
    transaction: DatabaseTransaction,
    refundId: string,
  ): Promise<RefundAttemptRow[]> {
    return transaction.$queryRaw<RefundAttemptRow[]>(Prisma.sql`
      SELECT id, refund_id, attempt_no, idempotency_key, provider,
             provider_request_id, status::text, failure_code, finished_at
      FROM public.refund_attempt
      WHERE refund_id = ${refundId}
      ORDER BY attempt_no ASC, id ASC
    `);
  }

  private async readRefundImpactItems(
    transaction: DatabaseTransaction,
    refundId: string,
  ): Promise<AdminRefundImpactItem[]> {
    const rows = await transaction.$queryRaw<Array<{
      aftersale_item_id: string | null;
      amount: Prisma.Decimal;
      auto_restock: boolean;
      commission_reversal: Prisma.Decimal;
      order_item_id: string;
      quantity: number;
      restock_qty: number | null;
      sku_id: string;
    }>>(Prisma.sql`
      SELECT item.aftersale_item_id, item.amount, item.auto_restock,
             item.commission_reversal, item.order_item_id, item.quantity,
             order_item.sku_id, inspection_item.restock_qty
      FROM public.refund_item AS item
      INNER JOIN public.refund AS refund ON refund.id = item.refund_id
      INNER JOIN public.order_item AS order_item ON order_item.id = item.order_item_id
      LEFT JOIN public.return_inspection AS inspection ON inspection.aftersale_id = refund.aftersale_id
      LEFT JOIN public.return_inspection_item AS inspection_item
        ON inspection_item.inspection_id = inspection.id
       AND inspection_item.order_item_id = item.order_item_id
      WHERE item.refund_id = ${refundId}
      ORDER BY item.order_item_id ASC, item.id ASC
    `);
    return rows.map((row) => ({
      aftersaleItemId: row.aftersale_item_id,
      amount: money(storedMoney(row.amount, 'Stored Refund Item amount')),
      autoRestock: row.auto_restock,
      commissionReversal: money(storedMoney(row.commission_reversal, 'Stored commission reversal')),
      inventoryRestockQuantity: row.auto_restock
        ? storedCount(row.quantity, 'Stored Refund Item quantity', 1)
        : storedCount(row.restock_qty ?? 0, 'Stored return restock quantity'),
      orderItemId: row.order_item_id,
      quantity: storedCount(row.quantity, 'Stored Refund Item quantity', 1),
      skuId: row.sku_id,
    }));
  }

  private async readRefundSnapshot(
    transaction: DatabaseTransaction,
    refundId: string,
  ): Promise<AdminRefundSnapshot> {
    const refund = await this.readRefundHeader(transaction, refundId);
    const attempts = await this.readRefundAttempts(transaction, refundId);
    const latest = attempts.at(-1);
    if (!latest || latest.attempt_no !== attempts.length || latest.provider !== refund.provider) {
      throw internal('Stored Refund attempt sequence is invalid');
    }
    let compensationNo: string | null = null;
    if (refund.manual_compensation_id !== null) {
      const compensation = await transaction.manualCompensation.findUnique({
        select: { compensation_no: true },
        where: { id: refund.manual_compensation_id },
      });
      if (!compensation) throw internal('Stored compensation is missing');
      compensationNo = compensation.compensation_no;
    }
    return {
      aftersaleId: refund.aftersale_id,
      amount: money(refund.amount),
      attemptId: latest.id,
      attemptNo: latest.attempt_no,
      compensationId: refund.manual_compensation_id,
      compensationNo,
      items: await this.readRefundImpactItems(transaction, refundId),
      orderId: refund.order_id,
      originType: refund.origin_type as 'AFTERSALE' | 'MANUAL_COMPENSATION',
      refundId: refund.id,
      refundNo: refund.refund_no,
      status: refund.status as AdminRefundSnapshot['status'],
      version: refund.version,
    };
  }

  private async buildRetryPreview(
    transaction: DatabaseTransaction,
    input: AdminRefundRetryPreviewInput,
  ): Promise<AdminRefundRetryPreviewSnapshot> {
    const refund = await this.readRefundHeader(transaction, input.refundId);
    const attempts = await this.readRefundAttempts(transaction, refund.id);
    if (refund.status !== 'FAILED' || attempts.length < 1 || attempts.at(-1)?.status !== 'FAILED' ||
      refund.failure_code === null || refund.failed_at === null) {
      throw stateConflict('Only an explicitly failed ordinary refund can be retried');
    }
    if (refund.origin_type === 'AFTERSALE' && refund.aftersale_status !== 'REFUND_FAILED') {
      throw stateConflict('Aftersale is not in REFUND_FAILED');
    }
    if (refund.origin_type === 'MANUAL_COMPENSATION' && refund.manual_compensation_status !== 'FAILED') {
      throw stateConflict('Manual compensation is not FAILED');
    }
    return {
      affectedCount: (await this.readRefundImpactItems(transaction, refund.id)).length,
      amount: money(refund.amount),
      attemptCount: attempts.length,
      nextAttemptNo: attempts.length + 1,
      orderId: refund.order_id,
      originType: refund.origin_type as 'AFTERSALE' | 'MANUAL_COMPENSATION',
      refundId: refund.id,
      refundNo: refund.refund_no,
      resourceVersion: refund.version,
      warnings: ['The stable refund number and frozen refund items will be reused'],
    };
  }

  private async prepareRetryCore(
    transaction: DatabaseTransaction,
    input: AdminRefundRetryPrepareInput,
    hooks: AdminRefundPreviewHooks<AdminRefundRetryPreviewSnapshot>,
  ): Promise<AdminRefundSnapshot> {
    const normalized = this.normalizeRetryInput(input);
    assertVersion(input.expectedVersion, 'Refund expected version');
    assertAttemptKey(input.attemptIdempotencyKey);
    if (!hooks || typeof hooks.verifyPreview !== 'function') throw new TypeError('Refund retry preview verifier is required');
    const candidate = await this.readRefundHeader(transaction, input.refundId);
    await this.assertActor(transaction, normalized.actorAccountId, true);
    await this.lockOrderEnvelope(transaction, candidate.order_id);
    const preview = await this.buildRetryPreview(transaction, normalized);
    if (preview.resourceVersion !== input.expectedVersion) throw versionConflict('Refund version changed');
    await hooks.verifyPreview(preview);
    const attempts = await this.readRefundAttempts(transaction, candidate.id);
    if (attempts.some(({ idempotency_key: key }) => key === input.attemptIdempotencyKey)) {
      throw stateConflict('Refund retry attempt idempotency key was already used');
    }
    const occurredAt = await this.transactionTime(transaction);
    const attemptId = generateUlid(occurredAt.getTime());
    await transaction.refundAttempt.create({
      data: {
        attempt_no: preview.nextAttemptNo,
        id: attemptId,
        idempotency_key: input.attemptIdempotencyKey,
        provider: candidate.provider,
        refund_id: candidate.id,
        requested_at: occurredAt,
        status: 'INITIATED',
      },
    });
    const refundChanged = await transaction.refund.updateMany({
      data: {
        failed_at: null,
        failure_code: null,
        status: 'PENDING',
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: { id: candidate.id, status: 'FAILED', version: input.expectedVersion },
    });
    if (candidate.origin_type === 'MANUAL_COMPENSATION') {
      const compensationChanged = await transaction.manualCompensation.updateMany({
        data: { failure_code: null, status: 'PENDING', updated_at: occurredAt, version: { increment: 1 } },
        where: {
          id: candidate.manual_compensation_id!,
          status: 'FAILED',
          version: candidate.manual_compensation_version!,
        },
      });
      if (compensationChanged.count !== 1) throw versionConflict('Manual compensation changed during retry');
    }
    const order = await this.readOrder(transaction, candidate.order_id);
    const orderChanged = await transaction.salesOrder.updateMany({
      data: { refund_processing_status: 'REFUNDING', updated_at: occurredAt, version: { increment: 1 } },
      where: { id: order.id, version: order.version },
    });
    if (refundChanged.count !== 1 || orderChanged.count !== 1) throw versionConflict('Refund changed during retry');
    const snapshot = await this.readRefundSnapshot(transaction, candidate.id);
    if (snapshot.attemptId !== attemptId || snapshot.status !== 'PENDING') {
      throw internal('Prepared retry projection is inconsistent');
    }
    return snapshot;
  }

  private async isHistoricalRefundAttemptReplayCore(
    transaction: DatabaseTransaction,
    input: AdminHistoricalRefundAttemptReplayInput,
  ): Promise<boolean> {
    assertUlid(input.refundId, 'Refund ID');
    assertUlid(input.refundAttemptId, 'Refund Attempt ID');
    if (!Number.isSafeInteger(input.attemptNo) || input.attemptNo < 1 ||
      input.attemptNo > MAX_POSTGRES_INTEGER) {
      throw new TypeError('Refund attempt number is invalid');
    }
    decimal(input.amount, 'Refund amount');
    assertReference(input.refundNo, 'Refund number');
    assertReference(input.providerEventId, 'Provider event ID');
    assertReference(input.providerRefundId, 'Provider refund ID');
    if (input.outcome !== 'FAILED' && input.outcome !== 'SUCCEEDED') {
      throw new TypeError('Refund result outcome is invalid');
    }

    const candidate = await this.readRefundHeader(transaction, input.refundId);
    await this.lockOrderEnvelope(transaction, candidate.order_id);
    const refund = await this.readRefundHeader(transaction, input.refundId);
    const attempts = await this.readRefundAttempts(transaction, refund.id);
    const attempt = attempts.find(({ id }) => id === input.refundAttemptId);
    const latest = attempts.at(-1);
    if (!attempt || !latest || attempt.attempt_no > latest.attempt_no) {
      throw resultConflict('Refund callback attempt does not exist in the stable refund');
    }
    if (latest.id === attempt.id) return false;

    const expectedStatus = input.outcome;
    const terminalShapeMatches = attempt.status === expectedStatus && attempt.finished_at !== null &&
      attempt.provider === refund.provider && attempt.provider_request_id === input.providerEventId &&
      (expectedStatus !== 'FAILED' || attempt.failure_code === 'PROVIDER_FAILED') &&
      (expectedStatus !== 'SUCCEEDED' || attempt.failure_code === null);
    const stableFactsMatch = refund.refund_no === input.refundNo &&
      refund.amount.toFixed(2) === input.amount && refund.provider_refund_id === input.providerRefundId &&
      attempt.attempt_no === input.attemptNo;
    if (!terminalShapeMatches || !stableFactsMatch) {
      throw resultConflict('Historical Refund callback conflicts with its terminal attempt');
    }
    return true;
  }

  private async claimRefundAttemptCore(
    transaction: DatabaseTransaction,
    input: AdminRefundAttemptClaimInput,
  ): Promise<AdminRefundProviderOperation> {
    assertUlid(input.refundId, 'Refund ID');
    assertUlid(input.refundAttemptId, 'Refund Attempt ID');
    const candidate = await this.readRefundHeader(transaction, input.refundId);
    await this.lockOrderEnvelope(transaction, candidate.order_id);
    const refund = await this.readRefundHeader(transaction, input.refundId);
    const attempts = await this.readRefundAttempts(transaction, refund.id);
    const attempt = attempts.find(({ id }) => id === input.refundAttemptId);
    const latest = attempts.at(-1);
    if (!attempt || latest?.id !== attempt.id || attempt.attempt_no !== attempts.length ||
      attempt.provider !== refund.provider) {
      throw resultConflict('Refund attempt is not the current stable attempt');
    }
    const payment = await this.readPaymentSource(transaction, refund.order_id);
    if (payment.provider !== refund.provider) {
      throw new ApplicationError('PAYMENT_CONFIGURATION_UNAVAILABLE', 'Refund Provider differs from the paid Provider');
    }
    let refundVersion = refund.version;
    if (refund.status === 'PENDING' && attempt.status === 'INITIATED') {
      const occurredAt = await this.transactionTime(transaction);
      const attemptChanged = await transaction.refundAttempt.updateMany({
        data: { status: 'PROCESSING' },
        where: { id: attempt.id, refund_id: refund.id, status: 'INITIATED' },
      });
      const refundChanged = await transaction.refund.updateMany({
        data: { status: 'PROCESSING', updated_at: occurredAt, version: { increment: 1 } },
        where: { id: refund.id, status: 'PENDING', version: refund.version },
      });
      if (refund.origin_type === 'MANUAL_COMPENSATION') {
        const compensationChanged = await transaction.manualCompensation.updateMany({
          data: { status: 'PROCESSING', updated_at: occurredAt, version: { increment: 1 } },
          where: {
            id: refund.manual_compensation_id!,
            status: 'PENDING',
            version: refund.manual_compensation_version!,
          },
        });
        if (compensationChanged.count !== 1) throw resultConflict('Manual compensation claim changed');
      }
      if (attemptChanged.count !== 1 || refundChanged.count !== 1) {
        throw resultConflict('Refund claim lost its locked facts');
      }
      refundVersion += 1;
    } else {
      const terminalReplay =
        (refund.status === 'SUCCEEDED' && attempt.status === 'SUCCEEDED') ||
        (refund.status === 'FAILED' && attempt.status === 'FAILED');
      if (!terminalReplay && (refund.status !== 'PROCESSING' || attempt.status !== 'PROCESSING')) {
        throw resultConflict('Refund is not claimable');
      }
    }
    return {
      amount: money(refund.amount),
      attemptId: attempt.id,
      attemptNo: attempt.attempt_no,
      orderId: refund.order_id,
      originType: refund.origin_type as 'AFTERSALE' | 'MANUAL_COMPENSATION',
      provider: refund.provider,
      providerIntentId: payment.provider_intent_id!,
      providerRefundId: refund.provider_refund_id,
      providerTransactionId: payment.provider_transaction_id!,
      refundId: refund.id,
      refundNo: refund.refund_no,
      refundVersion,
    };
  }

  private async readFinalizationLines(
    transaction: DatabaseTransaction,
    refundId: string,
  ): Promise<FinalizationLineRow[]> {
    return transaction.$queryRaw<FinalizationLineRow[]>(Prisma.sql`
      SELECT
        refund_item.id AS refund_item_id,
        refund_item.quantity AS refund_item_quantity,
        refund_item.amount AS refund_item_amount,
        refund_item.auto_restock AS refund_item_auto_restock,
        refund_item.commission_reversal AS refund_item_commission_reversal,
        refund_item.aftersale_item_id,
        COALESCE(aftersale_item.reserved_qty, 0) AS aftersale_reserved_qty,
        COALESCE(aftersale_item.reserved_amount, 0.00)::numeric(18,2) AS aftersale_reserved_amount,
        COALESCE(aftersale_item.refunded_qty, 0) AS aftersale_refunded_qty,
        COALESCE(aftersale_item.refunded_amount, 0.00)::numeric(18,2) AS aftersale_refunded_amount,
        order_item.id AS order_item_id, order_item.order_id,
        order_item.product_id, order_item.sku_id, order_item.unit_price,
        order_item.quantity, order_item.line_paid_amount,
        order_item.refunded_qty AS order_item_refunded_qty,
        order_item.pre_shipment_refunded_qty AS order_item_pre_shipment_refunded_qty,
        order_item.refunded_amount AS order_item_refunded_amount,
        order_item.aftersale_reserved_qty AS order_item_aftersale_reserved_qty,
        order_item.aftersale_reserved_amount AS order_item_aftersale_reserved_amount,
        order_item.shipped_qty AS order_item_shipped_qty,
        order_item.version AS order_item_version,
        product.sales_count AS product_sales_count, product.version AS product_version,
        balance.id AS inventory_balance_id, balance.physical_qty AS inventory_physical_qty,
        balance.locked_qty AS inventory_locked_qty, balance.version AS inventory_version,
        inspection.status::text AS inspection_status,
        inspection.resolution::text AS inspection_resolution,
        inspection_item.approved_refund_qty, inspection_item.restock_qty,
        inspection_item.damaged_qty, inspection_item.scrap_qty,
        inspection_item.return_to_customer_qty,
        snapshot.id AS commission_snapshot_id,
        snapshot.agent_id AS commission_snapshot_agent_id,
        snapshot.effective_rate AS commission_effective_rate,
        snapshot.commission_base, snapshot.original_commission AS commission_original,
        position.id AS commission_position_id,
        position.state::text AS commission_position_state,
        position.expected_remaining AS commission_expected_remaining,
        position.reversed_total AS commission_reversed_total,
        position.available_at AS commission_available_at,
        position.version AS commission_position_version,
        wallet.id AS wallet_id, wallet.available_balance AS wallet_available_balance,
        wallet.frozen_balance AS wallet_frozen_balance, wallet.version AS wallet_version,
        0.00::numeric(18,2) AS committed_refund_amount,
        0.00::numeric(18,2) AS committed_commission_reversal
      FROM public.refund_item AS refund_item
      INNER JOIN public.refund AS refund ON refund.id = refund_item.refund_id
      INNER JOIN public.order_item AS order_item ON order_item.id = refund_item.order_item_id
      INNER JOIN public.product AS product ON product.id = order_item.product_id
      INNER JOIN public.sku AS sku ON sku.id = order_item.sku_id
      LEFT JOIN public.inventory_balance AS balance ON balance.sku_id = sku.id
      LEFT JOIN public.aftersale_item AS aftersale_item ON aftersale_item.id = refund_item.aftersale_item_id
      LEFT JOIN public.return_inspection AS inspection ON inspection.aftersale_id = refund.aftersale_id
      LEFT JOIN public.return_inspection_item AS inspection_item
        ON inspection_item.inspection_id = inspection.id
       AND inspection_item.order_item_id = order_item.id
      LEFT JOIN public.order_item_commission_snapshot AS snapshot
        ON snapshot.order_item_id = order_item.id
      LEFT JOIN public.order_item_commission_position AS position ON position.snapshot_id = snapshot.id
      LEFT JOIN public.agent_wallet AS wallet ON wallet.agent_id = snapshot.agent_id
      WHERE refund_item.refund_id = ${refundId}
      ORDER BY order_item.id ASC, refund_item.id ASC
    `);
  }

  private async readLedgerIds(
    transaction: DatabaseTransaction,
    refundId: string,
  ): Promise<{
    commissionLedgerIds: string[];
    inventoryLedgerFacts: AdminRefundFinalizeResult['inventoryLedgerFacts'];
  }> {
    const [inventory, commission] = await Promise.all([
      transaction.inventoryLedger.findMany({
        orderBy: [{ id: 'asc' }],
        select: { id: true, ledger_type: true },
        where: { business_id: refundId },
      }),
      transaction.commissionLedger.findMany({
        orderBy: [{ id: 'asc' }],
        select: { id: true },
        where: { refund_id: refundId },
      }),
    ]);
    const inventoryLedgerFacts = inventory.map(({ id, ledger_type: ledgerType }) => {
      if (ledgerType !== 'REFUND_RESTOCK' && ledgerType !== 'RETURN_RESTOCK' &&
        ledgerType !== 'RETURN_DAMAGED') {
        throw internal('Refund inventory ledger type is invalid');
      }
      return { ledgerId: id, ledgerType };
    });
    return {
      commissionLedgerIds: commission.map(({ id }) => id),
      inventoryLedgerFacts,
    };
  }

  private async aggregateRefundProcessingStatus(
    transaction: DatabaseTransaction,
    orderId: string,
  ): Promise<'FAILED' | 'IDLE' | 'REFUNDING'> {
    const rows = await transaction.$queryRaw<Array<{ active_count: bigint; failed_count: bigint }>>(Prisma.sql`
      SELECT
        count(*) FILTER (WHERE status IN ('PENDING', 'PROCESSING')) AS active_count,
        count(*) FILTER (WHERE status = 'FAILED') AS failed_count
      FROM public.refund
      WHERE order_id = ${orderId}
        AND origin_type IN ('AFTERSALE', 'MANUAL_COMPENSATION')
    `);
    const row = rows[0];
    if (!row) throw internal('Refund processing aggregation is unavailable');
    if (row.failed_count > 0n) return 'FAILED';
    if (row.active_count > 0n) return 'REFUNDING';
    return 'IDLE';
  }

  private validateFinalizeInput(input: AdminRefundFinalizeInput): void {
    const operation = input.operation;
    assertUlid(operation.refundId, 'Refund ID');
    assertUlid(operation.orderId, 'Refund Order ID');
    assertUlid(operation.attemptId, 'Refund Attempt ID');
    assertVersion(operation.refundVersion, 'Refund version');
    if (!Number.isSafeInteger(operation.attemptNo) || operation.attemptNo < 1 ||
      operation.attemptNo > MAX_POSTGRES_INTEGER) {
      throw new TypeError('Refund attempt number is invalid');
    }
    assertProvider(operation.provider);
    decimal(operation.amount, 'Refund amount');
    assertReference(operation.providerIntentId, 'Provider intent ID');
    assertReference(operation.providerTransactionId, 'Provider transaction ID');
    assertReference(operation.providerRefundId, 'Provider refund ID', true);
    if (input.result.kind === 'UNKNOWN') return;
    storedDate(input.result.occurredAt, 'Provider refund result time');
    assertReference(input.result.providerEventId, 'Provider event ID', input.result.kind === 'FAILED');
    assertReference(input.result.providerRefundId, 'Provider refund ID', input.result.kind === 'FAILED');
    if (input.result.kind === 'FAILED' &&
      (typeof input.result.failureCode !== 'string' || input.result.failureCode.length < 1 ||
        input.result.failureCode.length > 80)) {
      throw new TypeError('Provider refund failure code must contain 1 to 80 characters');
    }
  }

  private async replayFinalizeResult(
    transaction: DatabaseTransaction,
    refund: RefundHeaderRow,
    order: OrderRow,
    beforeRefundStatus: AdminRefundFinalizeResult['beforeRefundStatus'],
    beforeRefundVersion: number,
  ): Promise<AdminRefundFinalizeResult> {
    const ledgers = await this.readLedgerIds(transaction, refund.id);
    return {
      afterOrderVersion: order.version,
      afterRefundStatus: refund.status as AdminRefundFinalizeResult['afterRefundStatus'],
      afterRefundVersion: refund.version,
      beforeOrderVersion: order.version,
      beforeRefundStatus,
      beforeRefundVersion,
      changed: false,
      ...ledgers,
      kind: 'REPLAY',
      orderId: order.id,
      refundId: refund.id,
    };
  }

  private async finalizeFailure(
    transaction: DatabaseTransaction,
    refund: RefundHeaderRow,
    attempt: RefundAttemptRow,
    order: OrderRow,
    result: Extract<AdminRefundProviderResult, { kind: 'FAILED' }>,
  ): Promise<AdminRefundFinalizeResult> {
    const beforeRefundStatus = refund.status as 'PROCESSING';
    const beforeRefundVersion = refund.version;
    const attemptChanged = await transaction.refundAttempt.updateMany({
      data: {
        failure_code: result.failureCode,
        finished_at: result.occurredAt,
        provider_payload: Prisma.DbNull,
        provider_request_id: result.providerEventId,
        status: 'FAILED',
      },
      where: { id: attempt.id, refund_id: refund.id, status: 'PROCESSING' },
    });
    const refundChanged = await transaction.refund.updateMany({
      data: {
        failed_at: result.occurredAt,
        failure_code: result.failureCode,
        provider_refund_id: result.providerRefundId ?? refund.provider_refund_id,
        status: 'FAILED',
        updated_at: result.occurredAt,
        version: { increment: 1 },
      },
      where: { id: refund.id, status: 'PROCESSING', version: refund.version },
    });
    if (attemptChanged.count !== 1 || refundChanged.count !== 1) {
      throw resultConflict('Refund failure lost its locked facts');
    }
    if (refund.origin_type === 'AFTERSALE') {
      const sourceChanged = await transaction.aftersale.updateMany({
        data: { status: 'REFUND_FAILED', updated_at: result.occurredAt, version: { increment: 1 } },
        where: {
          id: refund.aftersale_id!,
          status: refund.aftersale_status as never,
          version: refund.aftersale_version!,
        },
      });
      if (sourceChanged.count !== 1) throw resultConflict('Aftersale changed during refund failure');
    } else {
      const sourceChanged = await transaction.manualCompensation.updateMany({
        data: {
          failure_code: result.failureCode,
          status: 'FAILED',
          updated_at: result.occurredAt,
          version: { increment: 1 },
        },
        where: {
          id: refund.manual_compensation_id!,
          status: 'PROCESSING',
          version: refund.manual_compensation_version!,
        },
      });
      if (sourceChanged.count !== 1) throw resultConflict('Manual compensation changed during refund failure');
    }
    const processingStatus = await this.aggregateRefundProcessingStatus(transaction, order.id);
    const orderChanged = await transaction.salesOrder.updateMany({
      data: {
        refund_processing_status: processingStatus,
        updated_at: result.occurredAt,
        version: { increment: 1 },
      },
      where: { id: order.id, version: order.version },
    });
    if (orderChanged.count !== 1) throw resultConflict('Order changed during refund failure');
    return {
      afterOrderVersion: order.version + 1,
      afterRefundStatus: 'FAILED',
      afterRefundVersion: refund.version + 1,
      beforeOrderVersion: order.version,
      beforeRefundStatus,
      beforeRefundVersion,
      changed: true,
      commissionLedgerIds: [],
      inventoryLedgerFacts: [],
      kind: 'FAILED',
      orderId: order.id,
      refundId: refund.id,
    };
  }

  private async applyInventoryAndSales(
    transaction: DatabaseTransaction,
    refund: RefundHeaderRow,
    lines: readonly FinalizationLineRow[],
    occurredAt: Date,
  ): Promise<AdminRefundFinalizeResult['inventoryLedgerFacts']> {
    if (refund.origin_type === 'MANUAL_COMPENSATION') return [];
    const ledgerFacts: AdminRefundFinalizeResult['inventoryLedgerFacts'] = [];
    const productChanges = new Map<string, { count: number; sales: number; version: number }>();
    for (const line of lines) {
      const quantity = storedCount(line.refund_item_quantity, 'Stored Refund Item quantity', 1);
      const product = productChanges.get(line.product_id);
      if (product && (product.sales !== line.product_sales_count || product.version !== line.product_version)) {
        throw internal('Refund Product facts are inconsistent');
      }
      productChanges.set(line.product_id, {
        count: (product?.count ?? 0) + quantity,
        sales: line.product_sales_count,
        version: line.product_version,
      });
      const restockQuantity = line.refund_item_auto_restock
        ? quantity
        : storedCount(line.restock_qty ?? 0, 'Stored return restock quantity');
      const nonRestockQuantity = line.refund_item_auto_restock ? 0 :
        storedCount(line.damaged_qty ?? 0, 'Stored damaged return quantity') +
        storedCount(line.scrap_qty ?? 0, 'Stored scrap return quantity') +
        storedCount(line.return_to_customer_qty ?? 0, 'Stored return-to-customer quantity');
      if (restockQuantity === 0 && nonRestockQuantity === 0) continue;
      if (line.inventory_balance_id === null || line.inventory_physical_qty === null ||
        line.inventory_locked_qty === null || line.inventory_version === null) {
        throw internal('Refund inventory balance is missing');
      }
      const physicalBefore = storedCount(line.inventory_physical_qty, 'Stored physical inventory');
      const locked = storedCount(line.inventory_locked_qty, 'Stored locked inventory');
      const physicalAfter = physicalBefore + restockQuantity;
      if (!Number.isSafeInteger(physicalAfter) || physicalAfter > MAX_POSTGRES_INTEGER || locked > physicalAfter) {
        throw internal('Refund inventory would exceed the supported range');
      }
      if (restockQuantity > 0) {
        const changed = await transaction.inventoryBalance.updateMany({
          data: { physical_qty: physicalAfter, updated_at: occurredAt, version: { increment: 1 } },
          where: {
            id: line.inventory_balance_id,
            locked_qty: locked,
            physical_qty: physicalBefore,
            version: line.inventory_version,
          },
        });
        if (changed.count !== 1) throw resultConflict('Inventory changed during refund finalization');
      }
      const restockLedgerId = restockQuantity > 0 ? generateUlid(occurredAt.getTime()) : null;
      if (restockLedgerId !== null) {
        await transaction.inventoryLedger.create({
          data: {
            business_id: refund.id,
            id: restockLedgerId,
            ledger_type: line.refund_item_auto_restock ? 'REFUND_RESTOCK' : 'RETURN_RESTOCK',
            locked_after: locked,
            locked_change: 0,
            occurred_at: occurredAt,
            physical_after: physicalAfter,
            physical_change: restockQuantity,
            reason: line.refund_item_auto_restock ? 'ORDINARY_REFUND_RESTOCK' : 'RETURN_INSPECTION_RESTOCK',
            sku_id: line.sku_id,
          },
        });
        ledgerFacts.push({
          ledgerId: restockLedgerId,
          ledgerType: line.refund_item_auto_restock ? 'REFUND_RESTOCK' : 'RETURN_RESTOCK',
        });
      }
      if (nonRestockQuantity > 0) {
        const dispositionLedgerId = generateUlid(occurredAt.getTime());
        await transaction.inventoryLedger.create({
          data: {
            business_id: refund.id,
            id: dispositionLedgerId,
            ledger_type: 'RETURN_DAMAGED',
            locked_after: locked,
            locked_change: 0,
            occurred_at: occurredAt,
            physical_after: physicalAfter,
            physical_change: 0,
            reason: 'RETURN_INSPECTION_NON_RESTOCK_DISPOSITION',
            sku_id: line.sku_id,
          },
        });
        ledgerFacts.push({ ledgerId: dispositionLedgerId, ledgerType: 'RETURN_DAMAGED' });
      }
    }
    for (const [productId, change] of [...productChanges.entries()].sort(([left], [right]) =>
      left.localeCompare(right))) {
      const after = Math.max(0, change.sales - change.count);
      const updated = await transaction.product.updateMany({
        data: { sales_count: after, updated_at: occurredAt, version: { increment: 1 } },
        where: { id: productId, sales_count: change.sales, version: change.version },
      });
      if (updated.count !== 1) throw resultConflict('Product net sales changed during refund finalization');
    }
    return ledgerFacts;
  }

  private async applyCommissionReversals(
    transaction: DatabaseTransaction,
    refund: RefundHeaderRow,
    lines: readonly FinalizationLineRow[],
    occurredAt: Date,
  ): Promise<string[]> {
    const ledgerIds: string[] = [];
    const walletDebits = new Map<string, {
      amount: Prisma.Decimal;
      available: Prisma.Decimal;
      id: string;
      version: number;
    }>();
    for (const line of lines) {
      const reversal = storedMoney(line.refund_item_commission_reversal, 'Stored frozen commission reversal');
      if (reversal.isZero()) continue;
      if (line.commission_snapshot_id === null || line.commission_snapshot_agent_id === null ||
        line.commission_position_id === null || line.commission_position_state === null ||
        line.commission_position_version === null || line.commission_expected_remaining === null ||
        line.commission_reversed_total === null || line.commission_original === null) {
        throw internal('Refund commission position is missing');
      }
      const original = storedMoney(line.commission_original, 'Stored original commission');
      const reversedBefore = storedMoney(line.commission_reversed_total, 'Stored reversed commission');
      const reversedAfter = reversedBefore.add(reversal);
      if (reversedAfter.greaterThan(original)) throw internal('Refund commission reversal exceeds original commission');
      let ledgerType: 'EXPECTED_CANCELLED' | 'EXPECTED_REDUCED' | 'REFUND_DEBIT';
      let expectedChange = new Prisma.Decimal(0);
      let availableChange = new Prisma.Decimal(0);
      if (line.commission_position_state === 'EXPECTED') {
        const expectedBefore = storedMoney(line.commission_expected_remaining, 'Stored expected commission');
        const expectedAfter = expectedBefore.minus(reversal);
        if (expectedAfter.isNegative()) throw internal('Refund commission reversal exceeds expected commission');
        ledgerType = expectedAfter.isZero() ? 'EXPECTED_CANCELLED' : 'EXPECTED_REDUCED';
        expectedChange = reversal.negated();
        const changed = await transaction.orderItemCommissionPosition.updateMany({
          data: {
            expected_remaining: expectedAfter,
            reversed_total: reversedAfter,
            state: expectedAfter.isZero() ? 'CANCELLED' : 'EXPECTED',
            updated_at: occurredAt,
            version: { increment: 1 },
          },
          where: {
            expected_remaining: expectedBefore,
            id: line.commission_position_id,
            reversed_total: reversedBefore,
            state: 'EXPECTED',
            version: line.commission_position_version,
          },
        });
        if (changed.count !== 1) throw resultConflict('Commission position changed during refund');
      } else if (line.commission_position_state === 'AVAILABLE') {
        if (line.wallet_id === null || line.wallet_available_balance === null || line.wallet_version === null ||
          line.commission_available_at === null || !line.commission_expected_remaining.isZero()) {
          throw internal('Available commission wallet facts are incomplete');
        }
        ledgerType = 'REFUND_DEBIT';
        availableChange = reversal.negated();
        const changed = await transaction.orderItemCommissionPosition.updateMany({
          data: { reversed_total: reversedAfter, updated_at: occurredAt, version: { increment: 1 } },
          where: {
            id: line.commission_position_id,
            reversed_total: reversedBefore,
            state: 'AVAILABLE',
            version: line.commission_position_version,
          },
        });
        if (changed.count !== 1) throw resultConflict('Available commission position changed during refund');
        const existing = walletDebits.get(line.commission_snapshot_agent_id);
        if (existing && (existing.id !== line.wallet_id || existing.version !== line.wallet_version ||
          !existing.available.equals(line.wallet_available_balance))) {
          throw internal('Refund commission wallet facts are inconsistent');
        }
        walletDebits.set(line.commission_snapshot_agent_id, {
          amount: (existing?.amount ?? new Prisma.Decimal(0)).add(reversal),
          available: line.wallet_available_balance,
          id: line.wallet_id,
          version: line.wallet_version,
        });
      } else {
        throw internal('Frozen commission reversal is incompatible with the current position state');
      }
      const ledgerId = generateUlid(occurredAt.getTime());
      await transaction.commissionLedger.create({
        data: {
          agent_id: line.commission_snapshot_agent_id,
          available_change: availableChange,
          expected_change: expectedChange,
          frozen_change: new Prisma.Decimal(0),
          id: ledgerId,
          idempotency_key: `refund:${refund.id}:${line.commission_snapshot_id}`,
          ledger_type: ledgerType,
          occurred_at: occurredAt,
          reason: 'ORDINARY_REFUND_COMMISSION_REVERSAL',
          refund_id: refund.id,
          snapshot_id: line.commission_snapshot_id,
        },
      });
      ledgerIds.push(ledgerId);
    }
    for (const [, wallet] of [...walletDebits.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const after = wallet.available.minus(wallet.amount);
      if (after.abs().greaterThan(MAX_MONEY)) throw internal('Commission wallet debit exceeds the supported range');
      const changed = await transaction.agentWallet.updateMany({
        data: { available_balance: after, updated_at: occurredAt, version: { increment: 1 } },
        where: { available_balance: wallet.available, id: wallet.id, version: wallet.version },
      });
      if (changed.count !== 1) throw resultConflict('Commission wallet changed during refund');
    }
    return ledgerIds;
  }

  private async finalizeSuccess(
    transaction: DatabaseTransaction,
    refund: RefundHeaderRow,
    attempt: RefundAttemptRow,
    order: OrderRow,
    lines: readonly FinalizationLineRow[],
    result: Extract<AdminRefundProviderResult, { kind: 'SUCCEEDED' }>,
  ): Promise<AdminRefundFinalizeResult> {
    const beforeRefundStatus = refund.status as 'PROCESSING';
    const beforeRefundVersion = refund.version;
    const attemptChanged = await transaction.refundAttempt.updateMany({
      data: {
        failure_code: null,
        finished_at: result.occurredAt,
        provider_payload: Prisma.DbNull,
        provider_request_id: result.providerEventId,
        status: 'SUCCEEDED',
      },
      where: { id: attempt.id, refund_id: refund.id, status: 'PROCESSING' },
    });
    const refundChanged = await transaction.refund.updateMany({
      data: {
        failed_at: null,
        failure_code: null,
        provider_refund_id: result.providerRefundId,
        status: 'SUCCEEDED',
        succeeded_at: result.occurredAt,
        updated_at: result.occurredAt,
        version: { increment: 1 },
      },
      where: { id: refund.id, status: 'PROCESSING', version: refund.version },
    });
    if (attemptChanged.count !== 1 || refundChanged.count !== 1) {
      throw resultConflict('Refund success lost its locked facts');
    }
    for (const line of lines) {
      this.validateLine(line);
      const quantity = storedCount(line.refund_item_quantity, 'Stored Refund Item quantity', 1);
      const amount = storedMoney(line.refund_item_amount, 'Stored Refund Item amount');
      if (refund.origin_type === 'AFTERSALE') {
        if (line.aftersale_item_id === null ||
          line.aftersale_refunded_qty + quantity > line.aftersale_reserved_qty ||
          line.aftersale_refunded_amount.add(amount).greaterThan(line.aftersale_reserved_amount)) {
          throw internal('Refund exceeds its frozen aftersale reservation');
        }
        const aftersaleItemChanged = await transaction.aftersaleItem.updateMany({
          data: { refunded_amount: { increment: amount }, refunded_qty: { increment: quantity } },
          where: {
            id: line.aftersale_item_id,
            refunded_amount: line.aftersale_refunded_amount,
            refunded_qty: line.aftersale_refunded_qty,
          },
        });
        const orderItemChanged = await transaction.orderItem.updateMany({
          data: {
            aftersale_reserved_amount: { decrement: amount },
            aftersale_reserved_qty: { decrement: quantity },
            ...(line.refund_item_auto_restock
              ? { pre_shipment_refunded_qty: { increment: quantity } }
              : {}),
            refunded_amount: { increment: amount },
            refunded_qty: { increment: quantity },
            version: { increment: 1 },
          },
          where: {
            aftersale_reserved_amount: line.order_item_aftersale_reserved_amount,
            aftersale_reserved_qty: line.order_item_aftersale_reserved_qty,
            id: line.order_item_id,
            refunded_amount: line.order_item_refunded_amount,
            refunded_qty: line.order_item_refunded_qty,
            version: line.order_item_version,
          },
        });
        if (aftersaleItemChanged.count !== 1 || orderItemChanged.count !== 1) {
          throw resultConflict('Aftersale quota changed during refund success');
        }
      } else {
        const orderItemChanged = await transaction.orderItem.updateMany({
          data: {
            aftersale_reserved_amount: { decrement: amount },
            refunded_amount: { increment: amount },
            version: { increment: 1 },
          },
          where: {
            aftersale_reserved_amount: line.order_item_aftersale_reserved_amount,
            id: line.order_item_id,
            refunded_amount: line.order_item_refunded_amount,
            version: line.order_item_version,
          },
        });
        if (orderItemChanged.count !== 1) throw resultConflict('Compensation quota changed during refund success');
      }
    }
    if (refund.origin_type === 'AFTERSALE') {
      const sourceChanged = await transaction.aftersale.updateMany({
        data: { completed_at: result.occurredAt, status: 'COMPLETED', updated_at: result.occurredAt,
          version: { increment: 1 } },
        where: {
          id: refund.aftersale_id!,
          status: refund.aftersale_status as never,
          version: refund.aftersale_version!,
        },
      });
      if (sourceChanged.count !== 1) throw resultConflict('Aftersale changed during refund success');
    } else {
      const reversal = lines.reduce(
        (sum, line) => sum.add(line.refund_item_commission_reversal),
        new Prisma.Decimal(0),
      );
      const sourceChanged = await transaction.manualCompensation.updateMany({
        data: {
          commission_reversal: reversal,
          completed_at: result.occurredAt,
          failure_code: null,
          refunded_amount: refund.amount,
          reserved_amount: new Prisma.Decimal(0),
          status: 'SUCCEEDED',
          updated_at: result.occurredAt,
          version: { increment: 1 },
        },
        where: {
          id: refund.manual_compensation_id!,
          status: 'PROCESSING',
          version: refund.manual_compensation_version!,
        },
      });
      if (sourceChanged.count !== 1) throw resultConflict('Manual compensation changed during refund success');
    }
    const inventoryLedgerFacts = await this.applyInventoryAndSales(transaction, refund, lines, result.occurredAt);
    const commissionLedgerIds = await this.applyCommissionReversals(transaction, refund, lines, result.occurredAt);
    const refundedAmount = order.refunded_amount.add(refund.amount);
    if (refundedAmount.greaterThan(order.paid_amount)) throw internal('Order refunded amount exceeds paid amount');
    const itemRows = await transaction.$queryRaw<Array<{
      pre_shipment_refunded_qty: number;
      quantity: number;
      refunded_qty: number;
      shipped_qty: number;
    }>>(Prisma.sql`
      SELECT quantity, refunded_qty, pre_shipment_refunded_qty, shipped_qty
      FROM public.order_item WHERE order_id = ${order.id} ORDER BY id ASC
    `);
    if (itemRows.length < 1) throw internal('Refund Order has no items');
    const quantitiesFull = itemRows.every((item) =>
      storedCount(item.refunded_qty, 'Stored refunded quantity') ===
      storedCount(item.quantity, 'Stored Order Item quantity', 1));
    const preShipmentFull = quantitiesFull && itemRows.every((item) =>
      item.shipped_qty === 0 && item.pre_shipment_refunded_qty === item.quantity);
    const monetaryFull = refundedAmount.equals(order.paid_amount);
    const closeBeforeShipment = monetaryFull && preShipmentFull;
    const completeAfterShipment = monetaryFull && quantitiesFull && !preShipmentFull;
    const processingStatus = await this.aggregateRefundProcessingStatus(transaction, order.id);
    const orderData: Prisma.SalesOrderUpdateManyMutationInput = {
      refund_processing_status: processingStatus,
      refund_progress_status: monetaryFull ? 'FULL' : 'PARTIAL',
      refunded_amount: refundedAmount,
      updated_at: result.occurredAt,
      version: { increment: 1 },
      ...(closeBeforeShipment ? {
        close_reason: 'FULL_REFUND_BEFORE_SHIPMENT',
        closed_at: result.occurredAt,
        fulfillment_status: 'CANCELLED',
        order_status: 'CLOSED',
      } : {}),
      ...(completeAfterShipment ? {
        completed_at: order.completed_at ?? result.occurredAt,
        completion_reason: 'FULL_REFUND_AFTER_SHIPMENT',
        order_status: 'COMPLETED',
      } : {}),
    };
    const orderChanged = await transaction.salesOrder.updateMany({
      data: orderData,
      where: { id: order.id, refunded_amount: order.refunded_amount, version: order.version },
    });
    if (orderChanged.count !== 1) throw resultConflict('Order changed during refund success');
    return {
      afterOrderVersion: order.version + 1,
      afterRefundStatus: 'SUCCEEDED',
      afterRefundVersion: refund.version + 1,
      beforeOrderVersion: order.version,
      beforeRefundStatus,
      beforeRefundVersion,
      changed: true,
      commissionLedgerIds,
      inventoryLedgerFacts,
      kind: 'SUCCEEDED',
      orderId: order.id,
      refundId: refund.id,
    };
  }

  private async finalizeRefundAttemptCore(
    transaction: DatabaseTransaction,
    input: AdminRefundFinalizeInput,
  ): Promise<AdminRefundFinalizeResult> {
    this.validateFinalizeInput(input);
    const candidate = await this.readRefundHeader(transaction, input.operation.refundId);
    await this.lockOrderEnvelope(transaction, candidate.order_id);
    const refund = await this.readRefundHeader(transaction, input.operation.refundId);
    const order = await this.readOrder(transaction, refund.order_id);
    const payment = await this.readPaymentSource(transaction, order.id);
    const attempts = await this.readRefundAttempts(transaction, refund.id);
    const attempt = attempts.find(({ id }) => id === input.operation.attemptId);
    const latest = attempts.at(-1);
    const staticFactsMatch = refund.order_id === input.operation.orderId &&
      refund.refund_no === input.operation.refundNo && refund.provider === input.operation.provider &&
      refund.amount.toFixed(2) === input.operation.amount && payment.provider === refund.provider &&
      payment.provider_intent_id === input.operation.providerIntentId &&
      payment.provider_transaction_id === input.operation.providerTransactionId &&
      attempt?.attempt_no === input.operation.attemptNo;
    if (!attempt || !staticFactsMatch) throw resultConflict('Refund result does not match the claimed operation');
    const beforeRefundStatus = refund.status as AdminRefundFinalizeResult['beforeRefundStatus'];
    const beforeRefundVersion = refund.version;
    if (attempt.status === 'SUCCEEDED') {
      if (input.result.kind === 'FAILED' || refund.status !== 'SUCCEEDED' ||
        (input.result.kind === 'SUCCEEDED' &&
          (attempt.provider_request_id !== input.result.providerEventId ||
           refund.provider_refund_id !== input.result.providerRefundId))) {
        throw resultConflict('Refund result conflicts with a successful attempt');
      }
      return this.replayFinalizeResult(transaction, refund, order, beforeRefundStatus, beforeRefundVersion);
    }
    if (attempt.status === 'FAILED') {
      if (input.result.kind === 'SUCCEEDED' ||
        (input.result.kind === 'FAILED' &&
          (attempt.failure_code !== input.result.failureCode ||
           attempt.provider_request_id !== input.result.providerEventId))) {
        throw resultConflict('Refund result conflicts with a failed attempt');
      }
      return this.replayFinalizeResult(transaction, refund, order, beforeRefundStatus, beforeRefundVersion);
    }
    if (latest?.id !== attempt.id || attempt.status !== 'PROCESSING' || refund.status !== 'PROCESSING' ||
      refund.version !== input.operation.refundVersion) {
      throw resultConflict('Refund result is stale or the attempt is no longer active');
    }
    if (input.result.kind === 'UNKNOWN') {
      return {
        afterOrderVersion: order.version,
        afterRefundStatus: 'PROCESSING',
        afterRefundVersion: refund.version,
        beforeOrderVersion: order.version,
        beforeRefundStatus,
        beforeRefundVersion,
        changed: false,
        commissionLedgerIds: [],
        inventoryLedgerFacts: [],
        kind: 'PROCESSING',
        orderId: order.id,
        refundId: refund.id,
      };
    }
    if (input.result.providerRefundId !== null && refund.provider_refund_id !== null &&
      input.result.providerRefundId !== refund.provider_refund_id) {
      throw resultConflict('Provider Refund ID conflicts with the stable refund');
    }
    if (input.result.kind === 'FAILED') {
      return this.finalizeFailure(transaction, refund, attempt, order, input.result);
    }
    const lines = await this.readFinalizationLines(transaction, refund.id);
    if (lines.length < 1 || lines.reduce(
      (sum, line) => sum.add(storedMoney(line.refund_item_amount, 'Stored Refund Item amount')),
      new Prisma.Decimal(0),
    ).toFixed(2) !== refund.amount.toFixed(2)) {
      throw internal('Refund Item total differs from the Refund amount');
    }
    return this.finalizeSuccess(transaction, refund, attempt, order, lines, input.result);
  }
}
