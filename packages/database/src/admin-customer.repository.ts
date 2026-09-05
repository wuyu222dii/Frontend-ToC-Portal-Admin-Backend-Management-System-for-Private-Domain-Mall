import { createHmac } from 'node:crypto';

import {
  ApplicationError,
  generateUlid,
  isValidUlid,
  projectOrderDisplayStatus,
} from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { AccountDeletionStatus } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const CUSTOMER_ALIAS_DOMAIN = 'qingxu:admin-customer-alias:v1\0';
const CUSTOMER_TRANSFER_REASON_DOMAIN = 'qingxu:admin-customer-transfer-reason:v1\0';
const CUSTOMER_TRANSFER_REASON = /^CUSTOMER_ATTRIBUTION_TRANSFER:[a-f0-9]{64}$/;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const ALIAS_KEY_MIN_BYTES = 32;
const DELETION_STATUSES = new Set<AccountDeletionStatus>(['COMPLETED', 'PROCESSING', 'REJECTED', 'SUBMITTED']);
const SAFE_BINDING_CHANGE_REASONS = new Set(['ACCOUNT_DELETED', 'CUSTOMER_CONFIRMED_ATTRIBUTION']);

export type AdminCustomerAccountStatus = 'ACTIVE' | 'ANONYMIZED' | 'DELETION_PENDING' | 'DISABLED';
export type AdminCustomerBindingStatus = 'BOUND' | 'ENDED' | 'UNBOUND';

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

export interface AdminCustomerBindingSnapshot {
  agentId: string;
  agentName: string;
  bindingId: string;
  customerId: string;
  customerVersion: number;
  startedAt: Date;
}

export interface AdminCustomerSnapshot {
  accountStatus: AdminCustomerAccountStatus;
  city: string | null;
  consumptionAmount: string;
  consumptionCount: number;
  currentBinding: AdminCustomerBindingSnapshot | null;
  customerAlias: string;
  customerId: string;
  deletionRequestStatus: AccountDeletionStatus | null;
  lastOrderId: string | null;
  lastProductName: string | null;
  lastPurchaseAt: Date | null;
  managementNotePresent: boolean;
  nicknameMasked: string | null;
  phoneMasked: string | null;
  registeredAt: Date;
  version: number;
}

export interface AdminCustomerListResult {
  items: AdminCustomerSnapshot[];
  total: number;
}

export interface AdminCustomerOrderSummary {
  displayStatus: string;
  orderId: string;
  orderNo: string;
  paidAt: Date | null;
  payableAmount: string;
}

export interface AdminCustomerBindingHistory {
  agentId: string;
  agentName: string;
  bindingId: string;
  changeReason: string | null;
  endedAt: Date | null;
  endReason: 'ACCOUNT_DELETED' | 'DIRECTED' | 'TRANSFERRED' | null;
  recordedAt: Date;
  startedAt: Date;
}

export interface AdminCustomerDetail {
  bindingHistory: AdminCustomerBindingHistory[];
  customer: AdminCustomerSnapshot;
  orders: AdminCustomerOrderSummary[];
}

export interface AdminCustomerAttributionTransferInput {
  actorAccountId: string;
  customerId: string;
  expectedVersion: number;
  reason: string;
  targetAgentId: string | null;
}

export interface AdminCustomerAttributionTransferImpactInput {
  customerId: string;
  targetAgentId: string | null;
}

export interface AdminCustomerTransferTarget {
  agentId: string;
  agentName: string;
  status: 'ACTIVE';
}

export interface AdminCustomerAttributionTransferImpact {
  activeCandidateCount: number;
  currentBinding: AdminCustomerBindingSnapshot | null;
  customer: AdminCustomerSnapshot;
  paidOrderCount: number;
  pendingOrderCount: number;
  targetAgent: AdminCustomerTransferTarget | null;
}

export interface AdminCustomerAttributionTransferResult {
  afterBinding: AdminCustomerBindingSnapshot | null;
  beforeBinding: AdminCustomerBindingSnapshot | null;
  customer: AdminCustomerSnapshot;
  invalidatedCandidateCount: number;
  occurredAt: Date;
}

interface CustomerRow {
  account_deleted_at: Date | null;
  account_status: string;
  agent_id: string | null;
  agent_name: string | null;
  anonymized_at: Date | null;
  binding_id: string | null;
  binding_started_at: Date | null;
  city: string | null;
  consumption_amount: Prisma.Decimal;
  consumption_count: bigint | number;
  customer_id: string;
  deletion_request_status: AccountDeletionStatus | null;
  has_binding_history: boolean;
  last_order_id: string | null;
  last_product_name: string | null;
  last_purchase_at: Date | null;
  nickname_masked: string | null;
  phone_last4: string | null;
  registered_at: Date;
  version: number;
}

interface CountRow {
  total: bigint | number;
}

const CUSTOMER_DATA = Prisma.sql`
  SELECT
    customer.id AS customer_id,
    account.status::text AS account_status,
    account.deleted_at AS account_deleted_at,
    CASE
      WHEN NULLIF(BTRIM(customer.nickname), '') IS NULL THEN NULL
      ELSE LEFT(BTRIM(customer.nickname), 1) || '**'
    END AS nickname_masked,
    customer.city,
    customer.registered_at,
    customer.anonymized_at,
    customer.version,
    phone.phone_last4,
    deletion.status AS deletion_request_status,
    current_binding.id AS binding_id,
    current_binding.agent_id,
    current_binding.agent_name,
    current_binding.started_at AS binding_started_at,
    EXISTS (
      SELECT 1 FROM public.customer_agent_binding AS historical_binding
      WHERE historical_binding.customer_id = customer.id
    ) AS has_binding_history,
    COALESCE(consumption.amount, 0::numeric) AS consumption_amount,
    COALESCE(consumption.order_count, 0::bigint) AS consumption_count,
    last_order.order_id AS last_order_id,
    last_order.paid_at AS last_purchase_at,
    last_order.last_product_name
  FROM public.customer_profile AS customer
  INNER JOIN public.account AS account ON account.id = customer.account_id
  LEFT JOIN LATERAL (
    SELECT verification.phone_last4
    FROM public.customer_phone_verification AS verification
    WHERE verification.customer_id = customer.id AND verification.revoked_at IS NULL
    ORDER BY verification.verified_at DESC, verification.id DESC
    LIMIT 1
  ) AS phone ON TRUE
  LEFT JOIN LATERAL (
    SELECT request.status
    FROM public.account_deletion_request AS request
    WHERE request.account_id = account.id
    ORDER BY request.submitted_at DESC, request.id DESC
    LIMIT 1
  ) AS deletion ON TRUE
  LEFT JOIN LATERAL (
    SELECT binding.id, binding.agent_id, binding.started_at, agent.name AS agent_name
    FROM public.customer_agent_binding AS binding
    INNER JOIN public.agent_profile AS agent ON agent.id = binding.agent_id
    WHERE binding.customer_id = customer.id AND binding.ended_at IS NULL
    ORDER BY binding.started_at DESC, binding.id DESC
    LIMIT 1
  ) AS current_binding ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      SUM(paid_order.paid_amount - paid_order.refunded_amount) AS amount,
      COUNT(*) AS order_count
    FROM public.sales_order AS paid_order
    WHERE paid_order.customer_id = customer.id AND paid_order.payment_status = 'PAID'::public."PaymentStatus"
  ) AS consumption ON TRUE
  LEFT JOIN LATERAL (
    SELECT
      paid_order.id AS order_id,
      paid_order.paid_at,
      (
        SELECT item.product_name_snapshot
        FROM public.order_item AS item
        WHERE item.order_id = paid_order.id
        ORDER BY item.created_at ASC, item.id ASC
        LIMIT 1
      ) AS last_product_name
    FROM public.sales_order AS paid_order
    WHERE paid_order.customer_id = customer.id AND paid_order.payment_status = 'PAID'::public."PaymentStatus"
    ORDER BY paid_order.paid_at DESC NULLS LAST, paid_order.id DESC
    LIMIT 1
  ) AS last_order ON TRUE
  WHERE account.role = 'CUSTOMER'::public."AccountRole"
`;

function exactObject(
  value: object,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  if (Object.getPrototypeOf(value) !== Object.prototype ||
    Object.keys(value).some((key) => !allowed.includes(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains unsupported or missing fields`);
  }
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value >= MAX_POSTGRES_INTEGER) {
    throw new TypeError('Customer version must be a positive incrementable integer');
  }
}

function requireDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${label} must be valid`);
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint < 0x20 || codePoint === 0x7f);
  });
}

function normalizeKeyword(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new TypeError('Admin Customer keyword must be a string');
  const normalized = value.trim();
  if (normalized.length < 1 || Array.from(normalized).length > 120 || hasControlCharacter(normalized)) {
    throw new TypeError('Admin Customer keyword must contain 1 to 120 characters without controls');
  }
  return normalized;
}

function moneyInput(value: string | undefined, label: string): Prisma.Decimal | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)\.[0-9]{2}$/.test(value)) {
    throw new TypeError(`${label} must be a non-negative two-decimal string`);
  }
  const decimal = new Prisma.Decimal(value);
  if (decimal.greaterThan(MAX_MONEY)) throw new TypeError(`${label} exceeds the supported range`);
  return decimal;
}

function validateList(input: AdminCustomerListInput): {
  keyword?: string;
  maximum?: Prisma.Decimal;
  minimum?: Prisma.Decimal;
} {
  exactObject(
    input,
    ['agentId', 'bindingStatus', 'createdAtFrom', 'createdAtToExclusive', 'keyword',
      'maxConsumption', 'minConsumption', 'page', 'pageSize'],
    ['page', 'pageSize'],
    'Admin Customer list input',
  );
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw new TypeError('Admin Customer page must be positive');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Admin Customer page size must be between 1 and 100');
  }
  if (input.agentId !== undefined) requireUlid(input.agentId, 'Admin Customer Agent ID');
  if (input.bindingStatus !== undefined && !['BOUND', 'ENDED', 'UNBOUND'].includes(input.bindingStatus)) {
    throw new TypeError('Admin Customer binding status is invalid');
  }
  if (input.createdAtFrom !== undefined) requireDate(input.createdAtFrom, 'Admin Customer start time');
  if (input.createdAtToExclusive !== undefined) requireDate(input.createdAtToExclusive, 'Admin Customer end time');
  if (input.createdAtFrom !== undefined && input.createdAtToExclusive !== undefined &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Admin Customer date range must be increasing');
  }
  const minimum = moneyInput(input.minConsumption, 'Admin Customer minimum consumption');
  const maximum = moneyInput(input.maxConsumption, 'Admin Customer maximum consumption');
  if (minimum !== undefined && maximum !== undefined && minimum.greaterThan(maximum)) {
    throw new TypeError('Admin Customer consumption range must be increasing');
  }
  const keyword = normalizeKeyword(input.keyword);
  return {
    ...(keyword === undefined ? {} : { keyword }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(minimum === undefined ? {} : { minimum }),
  };
}

function normalizeReason(value: string): string {
  if (typeof value !== 'string') throw new TypeError('Attribution transfer reason must be a string');
  const normalized = value.trim();
  if (Array.from(normalized).length < 2 || Array.from(normalized).length > 500 ||
    hasControlCharacter(normalized)) {
    throw new TypeError('Attribution transfer reason must contain 2 to 500 characters without controls');
  }
  return normalized;
}

function reasonDigest(value: string, key: Uint8Array): string {
  return `CUSTOMER_ATTRIBUTION_TRANSFER:${createHmac('sha256', Buffer.from(key))
    .update(CUSTOMER_TRANSFER_REASON_DOMAIN, 'utf8')
    .update(value, 'utf8')
    .digest('hex')}`;
}

export function adminCustomerTransferReasonDigest(value: string, key: Uint8Array): string {
  if (!(key instanceof Uint8Array) || key.byteLength < ALIAS_KEY_MIN_BYTES) {
    throw new TypeError('Admin Customer transfer reason HMAC key must contain at least 32 bytes');
  }
  return reasonDigest(normalizeReason(value), key);
}

export function adminCustomerAlias(customerId: string, key: Uint8Array): string {
  requireUlid(customerId, 'Customer ID');
  if (!(key instanceof Uint8Array) || key.byteLength < ALIAS_KEY_MIN_BYTES) {
    throw new TypeError('Admin Customer alias HMAC key must contain at least 32 bytes');
  }
  const digest = createHmac('sha256', Buffer.from(key))
    .update(CUSTOMER_ALIAS_DOMAIN, 'utf8')
    .update(customerId, 'utf8')
    .digest('hex');
  return `customer_${digest.slice(0, 26)}`;
}

function validateImpact(input: AdminCustomerAttributionTransferImpactInput): void {
  exactObject(input, ['customerId', 'targetAgentId'], ['customerId', 'targetAgentId'],
    'Customer attribution-transfer impact input');
  requireUlid(input.customerId, 'Customer ID');
  if (input.targetAgentId !== null) requireUlid(input.targetAgentId, 'Target Agent ID');
}

function validateTransfer(input: AdminCustomerAttributionTransferInput): string {
  exactObject(input, ['actorAccountId', 'customerId', 'expectedVersion', 'reason', 'targetAgentId'],
    ['actorAccountId', 'customerId', 'expectedVersion', 'reason', 'targetAgentId'],
    'Customer attribution-transfer input');
  requireUlid(input.actorAccountId, 'Attribution transfer actor Account ID');
  requireUlid(input.customerId, 'Customer ID');
  if (input.targetAgentId !== null) requireUlid(input.targetAgentId, 'Target Agent ID');
  requireVersion(input.expectedVersion);
  return normalizeReason(input.reason);
}

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(message = 'Customer does not exist'): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', message);
}

function conflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Customer version changed');
}

function safeCount(value: bigint | number, label: string): number {
  const result = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return result;
}

function safeDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function nullableDate(value: Date | null, label: string): Date | null {
  return value === null ? null : safeDate(value, label);
}

function safeMoney(value: Prisma.Decimal, label: string): string {
  if (!Prisma.Decimal.isDecimal(value) || !value.isFinite() || value.isNegative() ||
    value.decimalPlaces() > 2 || value.greaterThan(MAX_MONEY)) {
    throw internal(`${label} is invalid`);
  }
  return value.toFixed(2);
}

function safeText(value: string, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || Array.from(value).length > maximum ||
    hasControlCharacter(value)) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function safeVersion(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_POSTGRES_INTEGER) {
    throw internal('Stored Customer version is invalid');
  }
  return value;
}

function safeUlid(value: string, label: string): string {
  if (!isValidUlid(value)) throw internal(`${label} is invalid`);
  return value;
}

function maskedNickname(value: string | null): string | null {
  if (value === null) return null;
  const characters = Array.from(value);
  if (characters.length !== 3 || characters[1] !== '*' || characters[2] !== '*' ||
    hasControlCharacter(characters[0]!)) {
    throw internal('Stored masked Customer nickname is invalid');
  }
  return value;
}

function maskedPhone(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[0-9]{4}$/.test(value)) throw internal('Stored Customer phone tail is invalid');
  return `*** **** ${value}`;
}

function accountStatus(row: CustomerRow): AdminCustomerAccountStatus {
  if (row.anonymized_at !== null || row.account_deleted_at !== null) return 'ANONYMIZED';
  if (row.deletion_request_status === 'SUBMITTED' || row.deletion_request_status === 'PROCESSING') {
    return 'DELETION_PENDING';
  }
  if (row.account_status !== 'ACTIVE' && row.account_status !== 'DISABLED') {
    throw internal('Stored Customer account status is invalid');
  }
  return row.account_status;
}

function currentBinding(row: CustomerRow, version: number): AdminCustomerBindingSnapshot | null {
  const fields = [row.binding_id, row.agent_id, row.agent_name, row.binding_started_at];
  if (fields.every((value) => value === null)) return null;
  if (row.binding_id === null || row.agent_id === null || row.agent_name === null || row.binding_started_at === null) {
    throw internal('Stored current Customer binding is incomplete');
  }
  return {
    agentId: safeUlid(row.agent_id, 'Stored current binding Agent ID'),
    agentName: safeText(row.agent_name, 120, 'Stored Agent name'),
    bindingId: safeUlid(row.binding_id, 'Stored current binding ID'),
    customerId: row.customer_id,
    customerVersion: version,
    startedAt: safeDate(row.binding_started_at, 'Stored binding start time'),
  };
}

function rowSnapshot(row: CustomerRow, alias: string): AdminCustomerSnapshot {
  safeUlid(row.customer_id, 'Stored Customer ID');
  const version = safeVersion(row.version);
  if (typeof row.has_binding_history !== 'boolean') throw internal('Stored Customer binding history flag is invalid');
  if (row.deletion_request_status !== null && !DELETION_STATUSES.has(row.deletion_request_status)) {
    throw internal('Stored Customer deletion-request status is invalid');
  }
  return {
    accountStatus: accountStatus(row),
    city: row.city === null ? null : safeText(row.city, 120, 'Stored Customer city'),
    consumptionAmount: safeMoney(row.consumption_amount, 'Stored Customer consumption amount'),
    consumptionCount: safeCount(row.consumption_count, 'Stored Customer consumption count'),
    currentBinding: currentBinding(row, version),
    customerAlias: alias,
    customerId: row.customer_id,
    deletionRequestStatus: row.deletion_request_status,
    lastOrderId: row.last_order_id === null ? null : safeUlid(row.last_order_id, 'Stored last Order ID'),
    lastProductName: row.last_product_name === null
      ? null
      : safeText(row.last_product_name, 200, 'Stored last product name'),
    lastPurchaseAt: nullableDate(row.last_purchase_at, 'Stored last purchase time'),
    managementNotePresent: false,
    nicknameMasked: maskedNickname(row.nickname_masked),
    phoneMasked: maskedPhone(row.phone_last4),
    registeredAt: safeDate(row.registered_at, 'Stored Customer registration time'),
    version,
  };
}

function customerFilters(
  input: AdminCustomerListInput,
  normalized: ReturnType<typeof validateList>,
  aliasMatches: readonly string[],
): Prisma.Sql[] {
  const filters: Prisma.Sql[] = [];
  if (normalized.keyword !== undefined) {
    const pattern = `%${normalized.keyword.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    filters.push(Prisma.sql`(
      customer_data.customer_id::text ILIKE ${pattern} ESCAPE '\\'
      OR customer_data.nickname_masked ILIKE ${pattern} ESCAPE '\\'
      ${aliasMatches.length === 0 ? Prisma.empty : Prisma.sql`OR customer_data.customer_id IN (${Prisma.join(aliasMatches)})`}
    )`);
  }
  if (input.agentId !== undefined) filters.push(Prisma.sql`customer_data.agent_id = ${input.agentId}`);
  if (input.bindingStatus === 'BOUND') filters.push(Prisma.sql`customer_data.binding_id IS NOT NULL`);
  if (input.bindingStatus === 'ENDED') {
    filters.push(Prisma.sql`customer_data.binding_id IS NULL AND customer_data.has_binding_history`);
  }
  if (input.bindingStatus === 'UNBOUND') {
    filters.push(Prisma.sql`customer_data.binding_id IS NULL AND NOT customer_data.has_binding_history`);
  }
  if (input.createdAtFrom !== undefined) filters.push(Prisma.sql`customer_data.registered_at >= ${input.createdAtFrom}`);
  if (input.createdAtToExclusive !== undefined) {
    filters.push(Prisma.sql`customer_data.registered_at < ${input.createdAtToExclusive}`);
  }
  if (normalized.minimum !== undefined) {
    filters.push(Prisma.sql`customer_data.consumption_amount >= ${normalized.minimum}`);
  }
  if (normalized.maximum !== undefined) {
    filters.push(Prisma.sql`customer_data.consumption_amount <= ${normalized.maximum}`);
  }
  return filters;
}

function whereSql(filters: readonly Prisma.Sql[]): Prisma.Sql {
  return filters.length === 0 ? Prisma.empty : Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}`;
}

export class AdminCustomerRepository {
  private readonly aliasHmacKey: Buffer;

  constructor(
    private readonly prisma: PrismaClient,
    aliasHmacKey: Uint8Array,
  ) {
    if (!(aliasHmacKey instanceof Uint8Array) || aliasHmacKey.byteLength < ALIAS_KEY_MIN_BYTES) {
      throw new TypeError('Admin Customer alias HMAC key must contain at least 32 bytes');
    }
    this.aliasHmacKey = Buffer.from(aliasHmacKey);
  }

  private alias(customerId: string): string {
    return adminCustomerAlias(customerId, this.aliasHmacKey);
  }

  private async aliasMatches(
    transaction: DatabaseTransaction,
    keyword: string | undefined,
  ): Promise<string[]> {
    if (keyword === undefined) return [];
    const customers = await transaction.customerProfile.findMany({
      orderBy: [{ id: 'asc' }],
      select: { id: true },
      where: { account: { is: { role: 'CUSTOMER' } } },
    });
    const normalized = keyword.toLocaleLowerCase('en-US');
    return customers.flatMap(({ id }) => this.alias(id).toLocaleLowerCase('en-US').includes(normalized) ? [id] : []);
  }

  private async queryCustomers(
    transaction: DatabaseTransaction,
    input: AdminCustomerListInput,
    normalized: ReturnType<typeof validateList>,
    aliasMatches: readonly string[],
  ): Promise<AdminCustomerListResult> {
    const filters = customerFilters(input, normalized, aliasMatches);
    const where = whereSql(filters);
    const countRows = await transaction.$queryRaw<CountRow[]>(Prisma.sql`
      WITH customer_data AS (${CUSTOMER_DATA})
      SELECT COUNT(*)::bigint AS total FROM customer_data ${where}
    `);
    const total = countRows[0] ? safeCount(countRows[0].total, 'Stored Admin Customer total') : 0;
    const rows = await transaction.$queryRaw<CustomerRow[]>(Prisma.sql`
      WITH customer_data AS (${CUSTOMER_DATA})
      SELECT * FROM customer_data ${where}
      ORDER BY registered_at DESC, customer_id DESC
      LIMIT ${input.pageSize} OFFSET ${(input.page - 1) * input.pageSize}
    `);
    return { items: rows.map((row) => rowSnapshot(row, this.alias(row.customer_id))), total };
  }

  async listCustomers(input: AdminCustomerListInput): Promise<AdminCustomerListResult> {
    const normalized = validateList(input);
    return this.prisma.$transaction(async (transaction) => {
      if (input.agentId !== undefined && !await transaction.agentProfile.findUnique({
        select: { id: true },
        where: { id: input.agentId },
      })) {
        throw notFound('Agent does not exist');
      }
      const matches = await this.aliasMatches(transaction, normalized.keyword);
      return this.queryCustomers(transaction, input, normalized, matches);
    }, { isolationLevel: 'RepeatableRead' });
  }

  private bindingChangeReason(value: string | null): string | null {
    if (value === null) return null;
    const stored = safeText(value, 500, 'Stored binding change reason');
    if (SAFE_BINDING_CHANGE_REASONS.has(stored) || CUSTOMER_TRANSFER_REASON.test(stored)) return stored;
    return reasonDigest(stored, this.aliasHmacKey);
  }

  private async readCustomerInTransaction(
    transaction: DatabaseTransaction,
    customerId: string,
  ): Promise<AdminCustomerSnapshot> {
    requireUlid(customerId, 'Customer ID');
    const rows = await transaction.$queryRaw<CustomerRow[]>(Prisma.sql`
      WITH customer_data AS (${CUSTOMER_DATA})
      SELECT * FROM customer_data WHERE customer_id = ${customerId}
    `);
    if (rows.length === 0) throw notFound();
    if (rows.length !== 1) throw internal('Stored Customer identity is not unique');
    return rowSnapshot(rows[0]!, this.alias(customerId));
  }

  async getCustomerDetail(customerId: string): Promise<AdminCustomerDetail> {
    requireUlid(customerId, 'Customer ID');
    return this.prisma.$transaction(async (transaction) => {
      const customer = await this.readCustomerInTransaction(transaction, customerId);
      const [orders, bindings] = await Promise.all([
        transaction.salesOrder.findMany({
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          select: {
            fulfillment_status: true,
            id: true,
            order_no: true,
            order_status: true,
            paid_at: true,
            payable_amount: true,
            payment_resolution: true,
            payment_status: true,
            refund_processing_status: true,
            refund_progress_status: true,
          },
          where: { customer_id: customerId },
        }),
        transaction.customerAgentBinding.findMany({
          include: {
            agent: { select: { id: true, name: true } },
            new_change_logs: {
              orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
              select: { created_at: true, reason: true },
              take: 1,
            },
            old_change_logs: {
              orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
              select: { created_at: true, reason: true },
              take: 1,
            },
          },
          orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
          where: { customer_id: customerId },
        }),
      ]);
      return {
        bindingHistory: bindings.map((binding) => {
          const log = binding.old_change_logs[0] ?? binding.new_change_logs[0];
          return {
            agentId: binding.agent.id,
            agentName: safeText(binding.agent.name, 120, 'Stored binding Agent name'),
            bindingId: binding.id,
            changeReason: this.bindingChangeReason(log?.reason ?? null),
            endedAt: nullableDate(binding.ended_at, 'Stored binding end time'),
            endReason: binding.end_reason,
            recordedAt: log === undefined
              ? safeDate(binding.created_at, 'Stored binding creation time')
              : safeDate(log.created_at, 'Stored binding change-log time'),
            startedAt: safeDate(binding.started_at, 'Stored binding start time'),
          };
        }),
        customer,
        orders: orders.map((order) => ({
          displayStatus: projectOrderDisplayStatus({
            fulfillmentStatus: order.fulfillment_status,
            orderStatus: order.order_status,
            paymentResolution: order.payment_resolution,
            paymentStatus: order.payment_status,
            refundProcessingStatus: order.refund_processing_status,
            refundProgressStatus: order.refund_progress_status,
          }),
          orderId: order.id,
          orderNo: safeText(order.order_no, 32, 'Stored order number'),
          paidAt: nullableDate(order.paid_at, 'Stored order payment time'),
          payableAmount: safeMoney(order.payable_amount, 'Stored order payable amount'),
        })),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  private async activeTarget(
    transaction: DatabaseTransaction,
    targetAgentId: string | null,
  ): Promise<AdminCustomerTransferTarget | null> {
    if (targetAgentId === null) return null;
    const target = await transaction.agentProfile.findFirst({
      select: { id: true, name: true, status: true },
      where: {
        account: { is: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' } },
        deleted_at: null,
        id: targetAgentId,
        status: 'ACTIVE',
      },
    });
    if (!target) throw conflict('Target Agent is not active');
    if (target.status !== 'ACTIVE' || target.id !== targetAgentId) throw internal('Stored target Agent is invalid');
    return {
      agentId: safeUlid(target.id, 'Stored target Agent ID'),
      agentName: safeText(target.name, 120, 'Stored target Agent name'),
      status: 'ACTIVE',
    };
  }

  private assertChange(
    current: AdminCustomerBindingSnapshot | null,
    targetAgentId: string | null,
  ): void {
    if (current?.agentId === targetAgentId || (current === null && targetAgentId === null)) {
      throw conflict('Customer attribution already matches the requested target');
    }
  }

  private async lockAttributionTransfer(
    transaction: DatabaseTransaction,
    customerId: string,
    targetAgentId: string | null,
  ): Promise<void> {
    const identity = await transaction.customerProfile.findUnique({
      select: { account_id: true },
      where: { id: customerId },
    });
    if (!identity) throw notFound();
    safeUlid(identity.account_id, 'Stored Customer Account ID');
    await acquireTransactionLock(transaction, 'store-auth-account', [identity.account_id]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [customerId]);
    await acquireTransactionLock(transaction, 'store-attribution-binding', [customerId]);
    if (targetAgentId !== null) {
      await acquireTransactionLock(transaction, 'store-attribution-agent', [targetAgentId]);
    }
  }

  async getAttributionTransferImpactInTransaction(
    transaction: DatabaseTransaction,
    input: AdminCustomerAttributionTransferImpactInput,
  ): Promise<AdminCustomerAttributionTransferImpact> {
    validateImpact(input);
    await this.lockAttributionTransfer(transaction, input.customerId, input.targetAgentId);
    const customer = await this.readCustomerInTransaction(transaction, input.customerId);
    this.assertChange(customer.currentBinding, input.targetAgentId);
    const targetAgent = await this.activeTarget(transaction, input.targetAgentId);
    const [activeCandidateCount, pendingOrderCount, paidOrderCount] = await Promise.all([
      transaction.attributionCandidate.count({ where: { customer_id: input.customerId, status: 'ACTIVE' } }),
      transaction.salesOrder.count({
        where: {
          customer_id: input.customerId,
          order_status: 'PENDING_PAYMENT',
          payment_status: { in: ['PROCESSING', 'UNPAID'] },
        },
      }),
      transaction.salesOrder.count({ where: { customer_id: input.customerId, payment_status: 'PAID' } }),
    ]);
    return {
      activeCandidateCount: safeCount(activeCandidateCount, 'Active attribution candidate count'),
      currentBinding: customer.currentBinding,
      customer,
      paidOrderCount: safeCount(paidOrderCount, 'Paid Customer order count'),
      pendingOrderCount: safeCount(pendingOrderCount, 'Pending Customer order count'),
      targetAgent,
    };
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const value = rows[0]?.transaction_time;
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw internal('Database transaction clock is unavailable');
    }
    return new Date(value);
  }

  async transferAttributionInTransaction(
    transaction: DatabaseTransaction,
    input: AdminCustomerAttributionTransferInput,
  ): Promise<AdminCustomerAttributionTransferResult> {
    const reason = reasonDigest(validateTransfer(input), this.aliasHmacKey);
    await this.lockAttributionTransfer(transaction, input.customerId, input.targetAgentId);
    const targetAgent = await this.activeTarget(transaction, input.targetAgentId);

    const customerRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.customer_profile WHERE id = ${input.customerId} FOR UPDATE
    `);
    if (customerRows.length !== 1 || customerRows[0]?.id !== input.customerId) throw notFound();
    const bindingRows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.customer_agent_binding
      WHERE customer_id = ${input.customerId} AND ended_at IS NULL
      ORDER BY started_at ASC, id ASC FOR UPDATE
    `);
    if (bindingRows.length > 1) throw internal('Customer has multiple current service-agent bindings');
    const currentCustomer = await this.readCustomerInTransaction(transaction, input.customerId);
    const lockedBindingId = bindingRows[0]?.id ?? null;
    if (lockedBindingId !== currentCustomer.currentBinding?.bindingId &&
      !(lockedBindingId === null && currentCustomer.currentBinding === null)) {
      throw conflict('Current Customer attribution changed');
    }
    if (currentCustomer.accountStatus === 'ANONYMIZED') throw conflict('Anonymized Customer attribution cannot change');
    if (currentCustomer.version !== input.expectedVersion) throw versionConflict();
    this.assertChange(currentCustomer.currentBinding, input.targetAgentId);

    const occurredAt = await this.transactionTime(transaction);
    const nextVersion = input.expectedVersion + 1;
    const customerUpdate = await transaction.customerProfile.updateMany({
      data: { updated_at: occurredAt, version: { increment: 1 } },
      where: { id: input.customerId, version: input.expectedVersion },
    });
    if (customerUpdate.count !== 1) throw versionConflict();

    const beforeBinding = currentCustomer.currentBinding;
    if (beforeBinding !== null) {
      const ended = await transaction.customerAgentBinding.updateMany({
        data: {
          end_reason: targetAgent === null ? 'DIRECTED' : 'TRANSFERRED',
          ended_at: occurredAt,
        },
        where: { ended_at: null, id: beforeBinding.bindingId },
      });
      if (ended.count !== 1) throw conflict('Current Customer attribution changed');
    }

    let afterBinding: AdminCustomerBindingSnapshot | null = null;
    if (targetAgent !== null) {
      const bindingId = generateUlid(occurredAt.getTime());
      await transaction.customerAgentBinding.create({
        data: {
          agent_id: targetAgent.agentId,
          created_at: occurredAt,
          customer_id: input.customerId,
          end_reason: null,
          ended_at: null,
          id: bindingId,
          started_at: occurredAt,
        },
        select: { id: true },
      });
      afterBinding = {
        agentId: targetAgent.agentId,
        agentName: targetAgent.agentName,
        bindingId,
        customerId: input.customerId,
        customerVersion: nextVersion,
        startedAt: occurredAt,
      };
    }

    const invalidated = await transaction.attributionCandidate.updateMany({
      data: {
        invalid_reason: 'ADMIN_ATTRIBUTION_TRANSFER',
        status: 'INVALIDATED',
        updated_at: occurredAt,
      },
      where: { customer_id: input.customerId, status: 'ACTIVE' },
    });
    await transaction.bindingChangeLog.create({
      data: {
        actor_account_id: input.actorAccountId,
        created_at: occurredAt,
        customer_id: input.customerId,
        id: generateUlid(occurredAt.getTime()),
        new_agent_id: afterBinding?.agentId ?? null,
        new_binding_id: afterBinding?.bindingId ?? null,
        old_agent_id: beforeBinding?.agentId ?? null,
        old_binding_id: beforeBinding?.bindingId ?? null,
        reason,
      },
      select: { id: true },
    });
    const customer: AdminCustomerSnapshot = {
      ...currentCustomer,
      currentBinding: afterBinding,
      version: nextVersion,
    };
    return {
      afterBinding,
      beforeBinding,
      customer,
      invalidatedCandidateCount: safeCount(invalidated.count, 'Invalidated attribution candidate count'),
      occurredAt,
    };
  }
}
