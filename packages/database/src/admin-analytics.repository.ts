import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { adminCustomerAlias } from './admin-customer.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const TIMEZONE = 'Asia/Shanghai';
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const MAX_PAGE_SIZE = 100;

export type AdminAnalyticsScope = 'GLOBAL' | 'DIRECT' | 'AGENT';

export interface AdminAnalyticsDateListInput {
  agentId?: string;
  dateFrom?: string;
  dateTo?: string;
  page: number;
  pageSize: number;
  scope: AdminAnalyticsScope;
}

export interface AdminAnalyticsMonthListInput {
  agentId?: string;
  monthFrom?: string;
  monthTo?: string;
  page: number;
  pageSize: number;
  scope: AdminAnalyticsScope;
}

export interface AdminAnalyticsReportResult<T> {
  agentId: string | null;
  asOf: Date;
  rows: T[];
  scope: AdminAnalyticsScope;
  total: number;
}

interface AdminSalesMetricsSnapshot {
  activeAgentCount: number;
  createdOrderCount: number;
  customerTotalSnapshot: number;
  netSalesAmount: string;
  netUnits: number;
  newBindingCount: number;
  newRegistrationCount: number;
  paidAmount: string;
  paidOrderCount: number;
  paidUnits: number;
  refundedAmount: string;
  refundedUnits: number;
}

export interface AdminDailySalesSnapshot extends AdminSalesMetricsSnapshot {
  businessDate: string;
}

export interface AdminMonthlySalesSnapshot extends AdminSalesMetricsSnapshot {
  businessMonth: string;
}

export interface AdminProductRankingSnapshot {
  netSalesAmount: string;
  netUnits: number;
  paidAmount: string;
  paidUnits: number;
  productId: string;
  productName: string;
  rank: number;
  refundedAmount: string;
  refundedUnits: number;
  skuId: string;
  skuName: string;
}

export interface AdminCustomerRankingSnapshot {
  customerAlias: string;
  customerId: string;
  netConsumptionAmount: string;
  nicknameMasked: string | null;
  paidAmount: string;
  paidOrderCount: number;
  rank: number;
  refundedAmount: string;
}

export interface AdminDashboardSnapshot {
  activeAgentCount: number;
  asOf: Date;
  customerTotalSnapshot: number;
  monthAgentNetSalesAmount: string;
  monthSalesAmount: string;
  newBindingCount: number;
  newRegistrationCount: number;
  pendingWithdrawalCount: number;
  productRanking: AdminProductRankingSnapshot[];
  todayCreatedOrderCount: number;
  todayEffectivePaidOrderCount: number;
  todaySalesAmount: string;
  totalSalesAmount: string;
}

interface TransactionTimeRow {
  as_of: Date;
  current_month: string;
  today: string;
}

interface PeriodMetricRow {
  active_agent_count: bigint | number;
  business_period: string;
  created_order_count: bigint | number;
  customer_total_snapshot: bigint | number;
  net_sales_amount: Prisma.Decimal;
  net_units: bigint | number;
  new_binding_count: bigint | number;
  new_registration_count: bigint | number;
  paid_amount: Prisma.Decimal;
  paid_order_count: bigint | number;
  paid_units: bigint | number;
  refunded_amount: Prisma.Decimal;
  refunded_units: bigint | number;
}

interface ProductRankingRow {
  net_sales_amount: Prisma.Decimal | null;
  net_units: bigint | number | null;
  paid_amount: Prisma.Decimal | null;
  paid_units: bigint | number | null;
  product_id: string | null;
  product_name: string | null;
  rank: bigint | number | null;
  refunded_amount: Prisma.Decimal | null;
  refunded_units: bigint | number | null;
  sku_id: string | null;
  sku_name: string | null;
  total: bigint | number;
}

interface CustomerRankingRow {
  customer_id: string | null;
  net_consumption_amount: Prisma.Decimal | null;
  nickname_masked: string | null;
  paid_amount: Prisma.Decimal | null;
  paid_order_count: bigint | number | null;
  rank: bigint | number | null;
  refunded_amount: Prisma.Decimal | null;
  total: bigint | number;
}

interface DashboardRow {
  active_agent_count: bigint | number;
  customer_total_snapshot: bigint | number;
  month_agent_net_sales_amount: Prisma.Decimal;
  month_sales_amount: Prisma.Decimal;
  new_binding_count: bigint | number;
  new_registration_count: bigint | number;
  pending_withdrawal_count: bigint | number;
  today_created_order_count: bigint | number;
  today_effective_paid_order_count: bigint | number;
  today_sales_amount: Prisma.Decimal;
  total_sales_amount: Prisma.Decimal;
}

type ReportGrain = 'day' | 'month';

interface NormalizedScope {
  agentId: string | null;
  scope: AdminAnalyticsScope;
}

interface ResolvedDateRange {
  dateFrom: string;
  dateTo: string;
}

interface ResolvedMonthRange {
  monthFrom: string;
  monthTo: string;
}

function invalid(message: string): ApplicationError {
  return new ApplicationError('INVALID_ARGUMENT', message);
}

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function normalizeScope(input: {
  agentId?: string;
  page: number;
  pageSize: number;
  scope: AdminAnalyticsScope;
}): NormalizedScope {
  if (!['GLOBAL', 'DIRECT', 'AGENT'].includes(input.scope)) throw invalid('Analytics scope is invalid');
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw invalid('Analytics page must be positive');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > MAX_PAGE_SIZE) {
    throw invalid('Analytics page size must be between 1 and 100');
  }
  if (input.agentId !== undefined && !isValidUlid(input.agentId)) {
    throw invalid('Analytics Agent ID must be a ULID');
  }
  if (input.scope !== 'AGENT' && input.agentId !== undefined) {
    throw invalid('Analytics Agent ID is only valid for AGENT scope');
  }
  return { agentId: input.agentId ?? null, scope: input.scope };
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function dateOrdinal(value: string, label: string): number {
  const match = DATE_PATTERN.exec(value);
  if (!match) throw invalid(`${label} must use YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw invalid(`${label} is not a calendar date`);
  }
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime() / 86_400_000;
}

function monthOrdinal(value: string, label: string): number {
  const match = MONTH_PATTERN.exec(value);
  if (!match) throw invalid(`${label} must use YYYY-MM`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1 || month < 1 || month > 12) throw invalid(`${label} is not a calendar month`);
  return year * 12 + month - 1;
}

function resolveDateRange(
  input: Pick<AdminAnalyticsDateListInput, 'dateFrom' | 'dateTo'>,
  time: TransactionTimeRow,
  defaultMode: 'today' | 'month-to-date',
): ResolvedDateRange {
  if ((input.dateFrom === undefined) !== (input.dateTo === undefined)) {
    throw invalid('Analytics date boundaries must be supplied together');
  }
  const dateFrom = input.dateFrom ?? (defaultMode === 'today' ? time.today : `${time.current_month}-01`);
  const dateTo = input.dateTo ?? time.today;
  const fromOrdinal = dateOrdinal(dateFrom, 'Analytics start date');
  const toOrdinal = dateOrdinal(dateTo, 'Analytics end date');
  if (fromOrdinal > toOrdinal) throw invalid('Analytics date range must be increasing');
  if (toOrdinal > dateOrdinal(time.today, 'Database business date')) {
    throw invalid('Analytics date range cannot include a future date');
  }
  if (toOrdinal - fromOrdinal + 1 > 366) throw invalid('Analytics date range cannot exceed 366 days');
  return { dateFrom, dateTo };
}

function resolveMonthRange(
  input: Pick<AdminAnalyticsMonthListInput, 'monthFrom' | 'monthTo'>,
  time: TransactionTimeRow,
): ResolvedMonthRange {
  if ((input.monthFrom === undefined) !== (input.monthTo === undefined)) {
    throw invalid('Analytics month boundaries must be supplied together');
  }
  const monthFrom = input.monthFrom ?? time.current_month;
  const monthTo = input.monthTo ?? time.current_month;
  const fromOrdinal = monthOrdinal(monthFrom, 'Analytics start month');
  const toOrdinal = monthOrdinal(monthTo, 'Analytics end month');
  if (fromOrdinal > toOrdinal) throw invalid('Analytics month range must be increasing');
  if (toOrdinal > monthOrdinal(time.current_month, 'Database business month')) {
    throw invalid('Analytics month range cannot include a future month');
  }
  if (toOrdinal - fromOrdinal + 1 > 60) throw invalid('Analytics month range cannot exceed 60 months');
  return { monthFrom, monthTo };
}

function safeDate(value: Date, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function safeCount(value: bigint | number, label: string): number {
  const count = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(count) || count < 0) throw internal(`${label} is invalid`);
  return count;
}

function safeSignedCount(value: bigint | number, label: string): number {
  const count = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isSafeInteger(count)) throw internal(`${label} is invalid`);
  return count;
}

function safeMoney(value: Prisma.Decimal, label: string, signed = false): string {
  if (!Prisma.Decimal.isDecimal(value) || !value.isFinite() || value.decimalPlaces() > 2 ||
    (!signed && value.isNegative())) {
    throw internal(`${label} is invalid`);
  }
  return value.toFixed(2);
}

function safeText(value: string, maximum: number, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || Array.from(value).length > maximum) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function safeBusinessPeriod(value: string, grain: ReportGrain): string {
  if (grain === 'day') dateOrdinal(value, 'Stored Analytics business date');
  else monthOrdinal(value, 'Stored Analytics business month');
  return value;
}

function safeNickname(value: string | null): string | null {
  if (value === null) return null;
  const characters = Array.from(value);
  if (characters.length !== 3 || characters[1] !== '*' || characters[2] !== '*') {
    throw internal('Stored masked Customer nickname is invalid');
  }
  return value;
}

function scopePredicate(
  scope: NormalizedScope,
  channelColumn: Prisma.Sql,
  agentColumn: Prisma.Sql,
): Prisma.Sql {
  if (scope.scope === 'GLOBAL') return Prisma.sql`TRUE`;
  if (scope.scope === 'DIRECT') {
    return Prisma.sql`${channelColumn} = 'DIRECT'::public."AttributionChannel"`;
  }
  return scope.agentId === null
    ? Prisma.sql`${channelColumn} = 'AGENT'::public."AttributionChannel"`
    : Prisma.sql`${channelColumn} = 'AGENT'::public."AttributionChannel" AND ${agentColumn} = ${scope.agentId}`;
}

function bindingScopePredicate(scope: NormalizedScope): Prisma.Sql {
  if (scope.scope === 'DIRECT') return Prisma.sql`FALSE`;
  if (scope.scope === 'GLOBAL' || scope.agentId === null) return Prisma.sql`TRUE`;
  return Prisma.sql`first_binding.agent_id = ${scope.agentId}`;
}

function timestampRange(column: Prisma.Sql, dateFrom: string, dateTo: string): Prisma.Sql {
  return Prisma.sql`
    ${column} >= (${dateFrom}::date::timestamp AT TIME ZONE ${TIMEZONE})
    AND ${column} < (((${dateTo}::date + 1)::timestamp) AT TIME ZONE ${TIMEZONE})
  `;
}

function monthTimestampRange(column: Prisma.Sql, monthFrom: string, monthTo: string): Prisma.Sql {
  const firstDate = `${monthFrom}-01`;
  const lastMonthFirstDate = `${monthTo}-01`;
  return Prisma.sql`
    ${column} >= (${firstDate}::date::timestamp AT TIME ZONE ${TIMEZONE})
    AND ${column} < (((${lastMonthFirstDate}::date + INTERVAL '1 month')::timestamp) AT TIME ZONE ${TIMEZONE})
  `;
}

function bucket(column: Prisma.Sql, grain: ReportGrain): Prisma.Sql {
  return Prisma.sql`date_trunc(${grain}, ${column} AT TIME ZONE ${TIMEZONE})::date`;
}

function periodEnd(grain: ReportGrain): Prisma.Sql {
  return grain === 'day'
    ? Prisma.sql`((period.bucket + 1)::timestamp AT TIME ZONE ${TIMEZONE})`
    : Prisma.sql`((period.bucket + INTERVAL '1 month')::timestamp AT TIME ZONE ${TIMEZONE})`;
}

function periodLabel(grain: ReportGrain): Prisma.Sql {
  return grain === 'day'
    ? Prisma.sql`to_char(period.bucket, 'YYYY-MM-DD')`
    : Prisma.sql`to_char(period.bucket, 'YYYY-MM')`;
}

function pageClause(page: number | null, pageSize: number | null): Prisma.Sql {
  if (page === null || pageSize === null) return Prisma.empty;
  return Prisma.sql`LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
}

function periodSnapshot(row: PeriodMetricRow): AdminSalesMetricsSnapshot {
  return {
    activeAgentCount: safeCount(row.active_agent_count, 'Stored Analytics active Agent count'),
    createdOrderCount: safeCount(row.created_order_count, 'Stored Analytics created Order count'),
    customerTotalSnapshot: safeCount(row.customer_total_snapshot, 'Stored Analytics Customer total'),
    netSalesAmount: safeMoney(row.net_sales_amount, 'Stored Analytics net sales amount', true),
    netUnits: safeSignedCount(row.net_units, 'Stored Analytics net units'),
    newBindingCount: safeCount(row.new_binding_count, 'Stored Analytics new binding count'),
    newRegistrationCount: safeCount(row.new_registration_count, 'Stored Analytics registration count'),
    paidAmount: safeMoney(row.paid_amount, 'Stored Analytics paid amount'),
    paidOrderCount: safeCount(row.paid_order_count, 'Stored Analytics paid Order count'),
    paidUnits: safeCount(row.paid_units, 'Stored Analytics paid units'),
    refundedAmount: safeMoney(row.refunded_amount, 'Stored Analytics refunded amount'),
    refundedUnits: safeCount(row.refunded_units, 'Stored Analytics refunded units'),
  };
}

export class AdminAnalyticsRepository {
  private readonly aliasHmacKey: Buffer;

  constructor(
    private readonly prisma: PrismaClient,
    aliasHmacKey: Uint8Array,
  ) {
    if (!(aliasHmacKey instanceof Uint8Array) || aliasHmacKey.byteLength < 32) {
      throw new TypeError('Admin Analytics alias HMAC key must contain at least 32 bytes');
    }
    this.aliasHmacKey = Buffer.from(aliasHmacKey);
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<TransactionTimeRow> {
    const rows = await transaction.$queryRaw<TransactionTimeRow[]>(Prisma.sql`
      SELECT
        transaction_timestamp() AS as_of,
        to_char(transaction_timestamp() AT TIME ZONE ${TIMEZONE}, 'YYYY-MM-DD') AS today,
        to_char(transaction_timestamp() AT TIME ZONE ${TIMEZONE}, 'YYYY-MM') AS current_month
    `);
    if (rows.length !== 1) throw internal('Database transaction time is unavailable');
    const row = rows[0]!;
    safeDate(row.as_of, 'Database transaction time');
    dateOrdinal(row.today, 'Database business date');
    monthOrdinal(row.current_month, 'Database business month');
    return row;
  }

  private async requireAgent(transaction: DatabaseTransaction, agentId: string | null): Promise<void> {
    if (agentId === null) return;
    const agent = await transaction.agentProfile.findFirst({
      select: { id: true },
      where: { deleted_at: null, id: agentId },
    });
    if (!agent) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Agent does not exist');
  }

  private async periodRows(
    transaction: DatabaseTransaction,
    scope: NormalizedScope,
    grain: ReportGrain,
    range: ResolvedDateRange | ResolvedMonthRange,
  ): Promise<PeriodMetricRow[]> {
    const isDaily = grain === 'day';
    const rangeSql = (column: Prisma.Sql) => isDaily
      ? timestampRange(column, (range as ResolvedDateRange).dateFrom, (range as ResolvedDateRange).dateTo)
      : monthTimestampRange(column, (range as ResolvedMonthRange).monthFrom, (range as ResolvedMonthRange).monthTo);
    const createdBucket = bucket(Prisma.sql`sales_order.created_at`, grain);
    const paidBucket = bucket(Prisma.sql`sales_order.paid_at`, grain);
    const refundBucket = bucket(Prisma.sql`refund.succeeded_at`, grain);
    const registrationBucket = bucket(Prisma.sql`customer.registered_at`, grain);
    const bindingBucket = bucket(Prisma.sql`first_binding.started_at`, grain);
    const cutoff = Prisma.sql`LEAST(transaction_timestamp(), ${periodEnd(grain)})`;
    const activeAgentExpression = scope.scope === 'GLOBAL'
      ? Prisma.sql`COUNT(DISTINCT attribution.agent_id_snapshot) FILTER (
          WHERE attribution.final_channel = 'AGENT'::public."AttributionChannel"
            AND agent.status = 'ACTIVE'::public."AgentStatus" AND agent.deleted_at IS NULL
        )::bigint`
      : Prisma.sql`0::bigint`;
    const registrationPredicate = scope.scope === 'GLOBAL' ? Prisma.sql`TRUE` : Prisma.sql`FALSE`;
    const customerTotal = scope.scope === 'GLOBAL' ? Prisma.sql`(
      SELECT COUNT(*)::bigint
      FROM public.customer_profile AS snapshot_customer
      INNER JOIN public.account AS snapshot_account ON snapshot_account.id = snapshot_customer.account_id
      WHERE snapshot_account.role = 'CUSTOMER'::public."AccountRole"
        AND snapshot_customer.registered_at < ${cutoff}
        AND (snapshot_account.deleted_at IS NULL OR snapshot_account.deleted_at >= ${cutoff})
    )` : Prisma.sql`0::bigint`;

    return transaction.$queryRaw<PeriodMetricRow[]>(Prisma.sql`
      WITH first_bindings AS (
        SELECT DISTINCT ON (binding.customer_id)
          binding.customer_id, binding.agent_id, binding.started_at
        FROM public.customer_agent_binding AS binding
        ORDER BY binding.customer_id, binding.started_at ASC, binding.id ASC
      ),
      created AS (
        SELECT ${createdBucket} AS bucket, COUNT(*)::bigint AS created_order_count
        FROM public.sales_order AS sales_order
        LEFT JOIN public.order_attribution_candidate AS candidate ON candidate.order_id = sales_order.id
        WHERE ${rangeSql(Prisma.sql`sales_order.created_at`)}
          AND sales_order.created_at < transaction_timestamp()
          AND ${scopePredicate(scope, Prisma.sql`candidate.submit_channel`, Prisma.sql`candidate.candidate_agent_id`)}
        GROUP BY 1
      ),
      payments AS (
        SELECT
          ${paidBucket} AS bucket,
          COUNT(*) FILTER (WHERE sales_order.paid_amount - sales_order.refunded_amount > 0)::bigint
            AS paid_order_count,
          COALESCE(SUM(sales_order.paid_amount), 0::numeric) AS paid_amount,
          COALESCE(SUM(item_units.paid_units), 0::numeric)::bigint AS paid_units,
          ${activeAgentExpression} AS active_agent_count
        FROM public.sales_order AS sales_order
        LEFT JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id
        LEFT JOIN public.agent_profile AS agent ON agent.id = attribution.agent_id_snapshot
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(item.quantity), 0::bigint) AS paid_units
          FROM public.order_item AS item
          WHERE item.order_id = sales_order.id
        ) AS item_units ON TRUE
        WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus" AND sales_order.paid_at IS NOT NULL
          AND ${rangeSql(Prisma.sql`sales_order.paid_at`)}
          AND sales_order.paid_at < transaction_timestamp()
          AND ${scopePredicate(scope, Prisma.sql`attribution.final_channel`, Prisma.sql`attribution.agent_id_snapshot`)}
        GROUP BY 1
      ),
      refunds AS (
        SELECT
          ${refundBucket} AS bucket,
          COALESCE(SUM(refund.amount), 0::numeric) AS refunded_amount,
          COALESCE(SUM(item_units.refunded_units), 0::numeric)::bigint AS refunded_units
        FROM public.refund AS refund
        INNER JOIN public.sales_order AS sales_order ON sales_order.id = refund.order_id
        LEFT JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(
            CASE WHEN refund.origin_type = 'MANUAL_COMPENSATION'::public."RefundOriginType"
              THEN 0 ELSE item.quantity END
          ), 0::bigint) AS refunded_units
          FROM public.refund_item AS item
          WHERE item.refund_id = refund.id
        ) AS item_units ON TRUE
        WHERE refund.status = 'SUCCEEDED'::public."RefundStatus" AND refund.succeeded_at IS NOT NULL
          AND ${rangeSql(Prisma.sql`refund.succeeded_at`)}
          AND refund.succeeded_at < transaction_timestamp()
          AND ${scopePredicate(scope, Prisma.sql`attribution.final_channel`, Prisma.sql`attribution.agent_id_snapshot`)}
        GROUP BY 1
      ),
      registrations AS (
        SELECT ${registrationBucket} AS bucket, COUNT(*)::bigint AS new_registration_count
        FROM public.customer_profile AS customer
        WHERE ${registrationPredicate} AND ${rangeSql(Prisma.sql`customer.registered_at`)}
          AND customer.registered_at < transaction_timestamp()
        GROUP BY 1
      ),
      bindings AS (
        SELECT ${bindingBucket} AS bucket, COUNT(*)::bigint AS new_binding_count
        FROM first_bindings AS first_binding
        WHERE ${bindingScopePredicate(scope)} AND ${rangeSql(Prisma.sql`first_binding.started_at`)}
          AND first_binding.started_at < transaction_timestamp()
        GROUP BY 1
      ),
      periods AS (
        SELECT bucket FROM created
        UNION SELECT bucket FROM payments
        UNION SELECT bucket FROM refunds
        UNION SELECT bucket FROM registrations
        UNION SELECT bucket FROM bindings
      )
      SELECT
        ${periodLabel(grain)} AS business_period,
        COALESCE(created.created_order_count, 0::bigint)::bigint AS created_order_count,
        COALESCE(payments.paid_order_count, 0::bigint)::bigint AS paid_order_count,
        COALESCE(payments.paid_amount, 0::numeric) AS paid_amount,
        COALESCE(refunds.refunded_amount, 0::numeric) AS refunded_amount,
        COALESCE(payments.paid_amount, 0::numeric) - COALESCE(refunds.refunded_amount, 0::numeric)
          AS net_sales_amount,
        COALESCE(payments.paid_units, 0::bigint)::bigint AS paid_units,
        COALESCE(refunds.refunded_units, 0::bigint)::bigint AS refunded_units,
        COALESCE(payments.paid_units, 0::bigint)::bigint - COALESCE(refunds.refunded_units, 0::bigint)::bigint
          AS net_units,
        COALESCE(registrations.new_registration_count, 0::bigint)::bigint AS new_registration_count,
        COALESCE(bindings.new_binding_count, 0::bigint)::bigint AS new_binding_count,
        COALESCE(payments.active_agent_count, 0::bigint)::bigint AS active_agent_count,
        ${customerTotal} AS customer_total_snapshot
      FROM periods AS period
      LEFT JOIN created ON created.bucket = period.bucket
      LEFT JOIN payments ON payments.bucket = period.bucket
      LEFT JOIN refunds ON refunds.bucket = period.bucket
      LEFT JOIN registrations ON registrations.bucket = period.bucket
      LEFT JOIN bindings ON bindings.bucket = period.bucket
      ORDER BY period.bucket DESC
    `);
  }

  private async productRankingRows(
    transaction: DatabaseTransaction,
    scope: NormalizedScope,
    range: ResolvedDateRange,
    page: number | null,
    pageSize: number | null,
  ): Promise<{ rows: AdminProductRankingSnapshot[]; total: number }> {
    const paging = pageClause(page, pageSize);
    const rows = await transaction.$queryRaw<ProductRankingRow[]>(Prisma.sql`
      WITH events AS (
        SELECT
          item.product_id, item.product_name_snapshot, item.sku_id, item.sku_name_snapshot,
          sales_order.paid_at AS event_at, item.id AS order_item_id,
          item.quantity::bigint AS paid_units, 0::bigint AS refunded_units,
          item.line_paid_amount AS paid_amount, 0::numeric AS refunded_amount
        FROM public.sales_order AS sales_order
        INNER JOIN public.order_item AS item ON item.order_id = sales_order.id
        LEFT JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id
        WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus" AND sales_order.paid_at IS NOT NULL
          AND ${timestampRange(Prisma.sql`sales_order.paid_at`, range.dateFrom, range.dateTo)}
          AND sales_order.paid_at < transaction_timestamp()
          AND ${scopePredicate(scope, Prisma.sql`attribution.final_channel`, Prisma.sql`attribution.agent_id_snapshot`)}
        UNION ALL
        SELECT
          item.product_id, item.product_name_snapshot, item.sku_id, item.sku_name_snapshot,
          refund.succeeded_at AS event_at, item.id AS order_item_id,
          0::bigint AS paid_units,
          CASE WHEN refund.origin_type = 'MANUAL_COMPENSATION'::public."RefundOriginType"
            THEN 0::bigint ELSE refund_item.quantity::bigint END AS refunded_units,
          0::numeric AS paid_amount, refund_item.amount AS refunded_amount
        FROM public.refund AS refund
        INNER JOIN public.sales_order AS sales_order ON sales_order.id = refund.order_id
        INNER JOIN public.refund_item AS refund_item ON refund_item.refund_id = refund.id
        INNER JOIN public.order_item AS item ON item.id = refund_item.order_item_id
        LEFT JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id
        WHERE refund.status = 'SUCCEEDED'::public."RefundStatus" AND refund.succeeded_at IS NOT NULL
          AND ${timestampRange(Prisma.sql`refund.succeeded_at`, range.dateFrom, range.dateTo)}
          AND refund.succeeded_at < transaction_timestamp()
          AND ${scopePredicate(scope, Prisma.sql`attribution.final_channel`, Prisma.sql`attribution.agent_id_snapshot`)}
      ),
      aggregated AS (
        SELECT
          product_id, sku_id,
          (array_agg(product_name_snapshot ORDER BY event_at DESC, order_item_id DESC))[1] AS product_name,
          (array_agg(sku_name_snapshot ORDER BY event_at DESC, order_item_id DESC))[1] AS sku_name,
          SUM(paid_units)::bigint AS paid_units, SUM(refunded_units)::bigint AS refunded_units,
          SUM(paid_amount) AS paid_amount, SUM(refunded_amount) AS refunded_amount
        FROM events
        GROUP BY product_id, sku_id
      ),
      ranked AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY paid_units - refunded_units DESC, sku_id ASC)::bigint AS rank,
          product_id, product_name, sku_id, sku_name, paid_units, refunded_units,
          paid_units - refunded_units AS net_units,
          paid_amount, refunded_amount, paid_amount - refunded_amount AS net_sales_amount
        FROM aggregated
      ),
      total AS (SELECT COUNT(*)::bigint AS total FROM ranked),
      paged AS (SELECT * FROM ranked ORDER BY rank ASC ${paging})
      SELECT total.total, paged.*
      FROM total LEFT JOIN paged ON TRUE
      ORDER BY paged.rank ASC NULLS LAST
    `);
    const total = rows[0] ? safeCount(rows[0].total, 'Stored Product ranking total') : 0;
    return {
      total,
      rows: rows.flatMap((row) => {
        if (row.rank === null) return [];
        if (row.product_id === null || row.product_name === null || row.sku_id === null || row.sku_name === null ||
          row.paid_units === null || row.refunded_units === null || row.net_units === null ||
          row.paid_amount === null || row.refunded_amount === null || row.net_sales_amount === null) {
          throw internal('Stored Product ranking row is incomplete');
        }
        return [{
          netSalesAmount: safeMoney(row.net_sales_amount, 'Stored Product ranking net amount', true),
          netUnits: safeSignedCount(row.net_units, 'Stored Product ranking net units'),
          paidAmount: safeMoney(row.paid_amount, 'Stored Product ranking paid amount'),
          paidUnits: safeCount(row.paid_units, 'Stored Product ranking paid units'),
          productId: safeText(row.product_id, 26, 'Stored Product ranking Product ID'),
          productName: safeText(row.product_name, 200, 'Stored Product ranking Product name'),
          rank: safeCount(row.rank, 'Stored Product ranking rank'),
          refundedAmount: safeMoney(row.refunded_amount, 'Stored Product ranking refunded amount'),
          refundedUnits: safeCount(row.refunded_units, 'Stored Product ranking refunded units'),
          skuId: safeText(row.sku_id, 26, 'Stored Product ranking SKU ID'),
          skuName: safeText(row.sku_name, 160, 'Stored Product ranking SKU name'),
        }];
      }),
    };
  }

  private async customerRankingRows(
    transaction: DatabaseTransaction,
    scope: NormalizedScope,
    range: ResolvedDateRange,
    page: number,
    pageSize: number,
  ): Promise<{ rows: AdminCustomerRankingSnapshot[]; total: number }> {
    const rows = await transaction.$queryRaw<CustomerRankingRow[]>(Prisma.sql`
      WITH events AS (
        SELECT
          sales_order.customer_id,
          CASE WHEN sales_order.paid_amount - sales_order.refunded_amount > 0 THEN 1 ELSE 0 END::bigint
            AS paid_order_count,
          sales_order.paid_amount AS paid_amount, 0::numeric AS refunded_amount
        FROM public.sales_order AS sales_order
        LEFT JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id
        WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus" AND sales_order.paid_at IS NOT NULL
          AND ${timestampRange(Prisma.sql`sales_order.paid_at`, range.dateFrom, range.dateTo)}
          AND sales_order.paid_at < transaction_timestamp()
          AND ${scopePredicate(scope, Prisma.sql`attribution.final_channel`, Prisma.sql`attribution.agent_id_snapshot`)}
        UNION ALL
        SELECT sales_order.customer_id, 0::bigint, 0::numeric, refund.amount
        FROM public.refund AS refund
        INNER JOIN public.sales_order AS sales_order ON sales_order.id = refund.order_id
        LEFT JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id
        WHERE refund.status = 'SUCCEEDED'::public."RefundStatus" AND refund.succeeded_at IS NOT NULL
          AND ${timestampRange(Prisma.sql`refund.succeeded_at`, range.dateFrom, range.dateTo)}
          AND refund.succeeded_at < transaction_timestamp()
          AND ${scopePredicate(scope, Prisma.sql`attribution.final_channel`, Prisma.sql`attribution.agent_id_snapshot`)}
      ),
      aggregated AS (
        SELECT customer_id, SUM(paid_order_count)::bigint AS paid_order_count,
          SUM(paid_amount) AS paid_amount, SUM(refunded_amount) AS refunded_amount
        FROM events GROUP BY customer_id
      ),
      ranked AS (
        SELECT
          ROW_NUMBER() OVER (ORDER BY paid_amount - refunded_amount DESC, aggregated.customer_id ASC)::bigint AS rank,
          aggregated.customer_id,
          CASE WHEN NULLIF(BTRIM(customer.nickname), '') IS NULL THEN NULL
            ELSE LEFT(BTRIM(customer.nickname), 1) || '**' END AS nickname_masked,
          paid_order_count, paid_amount, refunded_amount,
          paid_amount - refunded_amount AS net_consumption_amount
        FROM aggregated
        INNER JOIN public.customer_profile AS customer ON customer.id = aggregated.customer_id
      ),
      total AS (SELECT COUNT(*)::bigint AS total FROM ranked),
      paged AS (
        SELECT * FROM ranked ORDER BY rank ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      )
      SELECT total.total, paged.*
      FROM total LEFT JOIN paged ON TRUE
      ORDER BY paged.rank ASC NULLS LAST
    `);
    const total = rows[0] ? safeCount(rows[0].total, 'Stored Customer ranking total') : 0;
    return {
      total,
      rows: rows.flatMap((row) => {
        if (row.rank === null) return [];
        if (row.customer_id === null || row.paid_order_count === null || row.paid_amount === null ||
          row.refunded_amount === null || row.net_consumption_amount === null) {
          throw internal('Stored Customer ranking row is incomplete');
        }
        if (!isValidUlid(row.customer_id)) throw internal('Stored Customer ranking Customer ID is invalid');
        return [{
          customerAlias: adminCustomerAlias(row.customer_id, this.aliasHmacKey),
          customerId: row.customer_id,
          netConsumptionAmount: safeMoney(
            row.net_consumption_amount,
            'Stored Customer ranking net consumption',
            true,
          ),
          nicknameMasked: safeNickname(row.nickname_masked),
          paidAmount: safeMoney(row.paid_amount, 'Stored Customer ranking paid amount'),
          paidOrderCount: safeCount(row.paid_order_count, 'Stored Customer ranking paid Order count'),
          rank: safeCount(row.rank, 'Stored Customer ranking rank'),
          refundedAmount: safeMoney(row.refunded_amount, 'Stored Customer ranking refunded amount'),
        }];
      }),
    };
  }

  async getDashboard(): Promise<AdminDashboardSnapshot> {
    return this.prisma.$transaction(async (transaction) => {
      const time = await this.transactionTime(transaction);
      const rows = await transaction.$queryRaw<DashboardRow[]>(Prisma.sql`
        WITH bounds AS (
          SELECT
            transaction_timestamp() AS as_of,
            (date_trunc('day', transaction_timestamp() AT TIME ZONE ${TIMEZONE}) AT TIME ZONE ${TIMEZONE})
              AS today_from,
            (date_trunc('month', transaction_timestamp() AT TIME ZONE ${TIMEZONE}) AT TIME ZONE ${TIMEZONE})
              AS month_from
        ),
        first_bindings AS (
          SELECT DISTINCT ON (binding.customer_id) binding.customer_id, binding.started_at
          FROM public.customer_agent_binding AS binding
          ORDER BY binding.customer_id, binding.started_at ASC, binding.id ASC
        )
        SELECT
          (SELECT COALESCE(SUM(sales_order.paid_amount), 0::numeric)
            FROM public.sales_order AS sales_order, bounds
            WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus"
              AND sales_order.paid_at >= bounds.today_from AND sales_order.paid_at < bounds.as_of)
          - (SELECT COALESCE(SUM(refund.amount), 0::numeric)
            FROM public.refund AS refund, bounds
            WHERE refund.status = 'SUCCEEDED'::public."RefundStatus"
              AND refund.succeeded_at >= bounds.today_from AND refund.succeeded_at < bounds.as_of)
            AS today_sales_amount,
          (SELECT COALESCE(SUM(sales_order.paid_amount), 0::numeric)
            FROM public.sales_order AS sales_order, bounds
            WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus"
              AND sales_order.paid_at >= bounds.month_from AND sales_order.paid_at < bounds.as_of)
          - (SELECT COALESCE(SUM(refund.amount), 0::numeric)
            FROM public.refund AS refund, bounds
            WHERE refund.status = 'SUCCEEDED'::public."RefundStatus"
              AND refund.succeeded_at >= bounds.month_from AND refund.succeeded_at < bounds.as_of)
            AS month_sales_amount,
          (SELECT COALESCE(SUM(sales_order.paid_amount), 0::numeric)
            FROM public.sales_order AS sales_order
            INNER JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id,
              bounds
            WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus"
              AND attribution.final_channel = 'AGENT'::public."AttributionChannel"
              AND sales_order.paid_at >= bounds.month_from AND sales_order.paid_at < bounds.as_of)
          - (SELECT COALESCE(SUM(refund.amount), 0::numeric)
            FROM public.refund AS refund
            INNER JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = refund.order_id,
              bounds
            WHERE refund.status = 'SUCCEEDED'::public."RefundStatus"
              AND attribution.final_channel = 'AGENT'::public."AttributionChannel"
              AND refund.succeeded_at >= bounds.month_from AND refund.succeeded_at < bounds.as_of)
            AS month_agent_net_sales_amount,
          (SELECT COALESCE(SUM(sales_order.paid_amount), 0::numeric)
            FROM public.sales_order AS sales_order, bounds
            WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus" AND sales_order.paid_at < bounds.as_of)
          - (SELECT COALESCE(SUM(refund.amount), 0::numeric)
            FROM public.refund AS refund, bounds
            WHERE refund.status = 'SUCCEEDED'::public."RefundStatus" AND refund.succeeded_at < bounds.as_of)
            AS total_sales_amount,
          (SELECT COUNT(*)::bigint FROM public.sales_order AS sales_order, bounds
            WHERE sales_order.created_at >= bounds.today_from AND sales_order.created_at < bounds.as_of)
            AS today_created_order_count,
          (SELECT COUNT(*)::bigint FROM public.sales_order AS sales_order, bounds
            WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus"
              AND sales_order.paid_amount - sales_order.refunded_amount > 0
              AND sales_order.paid_at >= bounds.today_from AND sales_order.paid_at < bounds.as_of)
            AS today_effective_paid_order_count,
          (SELECT COUNT(*)::bigint FROM public.customer_profile AS customer
            INNER JOIN public.account AS account ON account.id = customer.account_id, bounds
            WHERE account.role = 'CUSTOMER'::public."AccountRole" AND account.deleted_at IS NULL
              AND customer.registered_at < bounds.as_of)
            AS customer_total_snapshot,
          (SELECT COUNT(*)::bigint FROM public.customer_profile AS customer, bounds
            WHERE customer.registered_at >= bounds.today_from AND customer.registered_at < bounds.as_of)
            AS new_registration_count,
          (SELECT COUNT(*)::bigint FROM first_bindings, bounds
            WHERE first_bindings.started_at >= bounds.month_from AND first_bindings.started_at < bounds.as_of)
            AS new_binding_count,
          (SELECT COUNT(DISTINCT attribution.agent_id_snapshot)::bigint
            FROM public.sales_order AS sales_order
            INNER JOIN public.order_attribution_snapshot AS attribution ON attribution.order_id = sales_order.id
            INNER JOIN public.agent_profile AS agent ON agent.id = attribution.agent_id_snapshot,
              bounds
            WHERE sales_order.payment_status = 'PAID'::public."PaymentStatus"
              AND attribution.final_channel = 'AGENT'::public."AttributionChannel"
              AND agent.status = 'ACTIVE'::public."AgentStatus" AND agent.deleted_at IS NULL
              AND sales_order.paid_at >= bounds.month_from AND sales_order.paid_at < bounds.as_of)
            AS active_agent_count,
          (SELECT COUNT(*)::bigint FROM public.withdrawal AS withdrawal
            WHERE withdrawal.status = 'PENDING'::public."WithdrawalStatus") AS pending_withdrawal_count
      `);
      if (rows.length !== 1) throw internal('Stored Dashboard projection is unavailable');
      const row = rows[0]!;
      const ranking = await this.productRankingRows(
        transaction,
        { agentId: null, scope: 'GLOBAL' },
        { dateFrom: `${time.current_month}-01`, dateTo: time.today },
        null,
        null,
      );
      return {
        activeAgentCount: safeCount(row.active_agent_count, 'Stored Dashboard active Agent count'),
        asOf: safeDate(time.as_of, 'Stored Dashboard snapshot time'),
        customerTotalSnapshot: safeCount(row.customer_total_snapshot, 'Stored Dashboard Customer total'),
        monthAgentNetSalesAmount: safeMoney(
          row.month_agent_net_sales_amount,
          'Stored Dashboard Agent net sales',
          true,
        ),
        monthSalesAmount: safeMoney(row.month_sales_amount, 'Stored Dashboard month sales', true),
        newBindingCount: safeCount(row.new_binding_count, 'Stored Dashboard binding count'),
        newRegistrationCount: safeCount(row.new_registration_count, 'Stored Dashboard registration count'),
        pendingWithdrawalCount: safeCount(row.pending_withdrawal_count, 'Stored Dashboard pending withdrawal count'),
        productRanking: ranking.rows,
        todayCreatedOrderCount: safeCount(row.today_created_order_count, 'Stored Dashboard created Order count'),
        todayEffectivePaidOrderCount: safeCount(
          row.today_effective_paid_order_count,
          'Stored Dashboard effective paid Order count',
        ),
        todaySalesAmount: safeMoney(row.today_sales_amount, 'Stored Dashboard today sales', true),
        totalSalesAmount: safeMoney(row.total_sales_amount, 'Stored Dashboard total sales', true),
      };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listDailySales(
    input: AdminAnalyticsDateListInput,
  ): Promise<AdminAnalyticsReportResult<AdminDailySalesSnapshot>> {
    const normalized = normalizeScope(input);
    return this.prisma.$transaction(async (transaction) => {
      const time = await this.transactionTime(transaction);
      const range = resolveDateRange(input, time, 'today');
      await this.requireAgent(transaction, normalized.agentId);
      const allRows = await this.periodRows(transaction, normalized, 'day', range);
      const rows = allRows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map((row) => ({
        businessDate: safeBusinessPeriod(row.business_period, 'day'),
        ...periodSnapshot(row),
      }));
      return { agentId: normalized.agentId, asOf: safeDate(time.as_of, 'Stored report time'), rows,
        scope: normalized.scope, total: allRows.length };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listMonthlySales(
    input: AdminAnalyticsMonthListInput,
  ): Promise<AdminAnalyticsReportResult<AdminMonthlySalesSnapshot>> {
    const normalized = normalizeScope(input);
    return this.prisma.$transaction(async (transaction) => {
      const time = await this.transactionTime(transaction);
      const range = resolveMonthRange(input, time);
      await this.requireAgent(transaction, normalized.agentId);
      const allRows = await this.periodRows(transaction, normalized, 'month', range);
      const rows = allRows.slice((input.page - 1) * input.pageSize, input.page * input.pageSize).map((row) => ({
        businessMonth: safeBusinessPeriod(row.business_period, 'month'),
        ...periodSnapshot(row),
      }));
      return { agentId: normalized.agentId, asOf: safeDate(time.as_of, 'Stored report time'), rows,
        scope: normalized.scope, total: allRows.length };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listProductRanking(
    input: AdminAnalyticsDateListInput,
  ): Promise<AdminAnalyticsReportResult<AdminProductRankingSnapshot>> {
    const normalized = normalizeScope(input);
    return this.prisma.$transaction(async (transaction) => {
      const time = await this.transactionTime(transaction);
      const range = resolveDateRange(input, time, 'month-to-date');
      await this.requireAgent(transaction, normalized.agentId);
      const ranking = await this.productRankingRows(
        transaction,
        normalized,
        range,
        input.page,
        input.pageSize,
      );
      return { agentId: normalized.agentId, asOf: safeDate(time.as_of, 'Stored report time'),
        rows: ranking.rows, scope: normalized.scope, total: ranking.total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listCustomerRanking(
    input: AdminAnalyticsDateListInput,
  ): Promise<AdminAnalyticsReportResult<AdminCustomerRankingSnapshot>> {
    const normalized = normalizeScope(input);
    return this.prisma.$transaction(async (transaction) => {
      const time = await this.transactionTime(transaction);
      const range = resolveDateRange(input, time, 'month-to-date');
      await this.requireAgent(transaction, normalized.agentId);
      const ranking = await this.customerRankingRows(
        transaction,
        normalized,
        range,
        input.page,
        input.pageSize,
      );
      return { agentId: normalized.agentId, asOf: safeDate(time.as_of, 'Stored report time'),
        rows: ranking.rows, scope: normalized.scope, total: ranking.total };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
