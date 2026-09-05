import type { components } from '@qingxu/contracts';

export type AdminDashboardData = components['schemas']['AdminDashboardResponse']['data'];
export type DailySalesReportData = components['schemas']['DailySalesReportResponse']['data'];
export type MonthlySalesReportData = components['schemas']['MonthlySalesReportResponse']['data'];
export type ProductRankingReportData = components['schemas']['ProductRankingResponse']['data'];
export type CustomerRankingReportData = components['schemas']['CustomerRankingResponse']['data'];

type ObjectValue = Record<string, unknown>;
type SalesMetricFields = components['schemas']['SalesMetricFields'];
type AnalyticsScope = 'GLOBAL' | 'DIRECT' | 'AGENT';

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const NON_NEGATIVE_MONEY = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const SIGNED_MONEY = /^-?(?:0|[1-9][0-9]*)\.[0-9]{2}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH = /^\d{4}-(?:0[1-9]|1[0-2])$/;
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/;
const SCOPES = ['GLOBAL', 'DIRECT', 'AGENT'] as const;
const SALES_METRIC_KEYS = [
  'created_order_count',
  'paid_order_count',
  'paid_amount',
  'refunded_amount',
  'net_sales_amount',
  'paid_units',
  'refunded_units',
  'net_units',
  'new_registration_count',
  'new_binding_count',
  'active_agent_count',
  'customer_total_snapshot',
] as const;

function invalid(path: string): never {
  throw new TypeError(`Invalid B14 admin analytics response at ${path}`);
}

function object(value: unknown, required: readonly string[], path: string): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid(path);
  const result = value as ObjectValue;
  const allowed = new Set(required);
  if (required.some((key) => !Object.hasOwn(result, key)) ||
    Object.keys(result).some((key) => !allowed.has(key))) return invalid(path);
  return result;
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) return invalid(path);
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : text(value, path);
}

function match(value: unknown, pattern: RegExp, path: string): string {
  const result = text(value, path);
  return pattern.test(result) ? result : invalid(path);
}

function integer(
  value: unknown,
  path: string,
  minimum = Number.MIN_SAFE_INTEGER,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) return invalid(path);
  return Number(value);
}

function enumeration<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  path: string,
): Values[number] {
  if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) return invalid(path);
  return value as Values[number];
}

function list<T>(value: unknown, path: string, read: (item: unknown, itemPath: string) => T): T[] {
  if (!Array.isArray(value)) return invalid(path);
  return value.map((item, index) => read(item, `${path}[${index}]`));
}

function ulid(value: unknown, path: string): string {
  return match(value, ULID, path);
}

function nullableUlid(value: unknown, path: string): string | null {
  return value === null ? null : ulid(value, path);
}

function calendarDate(value: unknown, path: string): string {
  const result = text(value, path);
  const parts = DATE.exec(result);
  if (parts === null) return invalid(path);
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0)
    ? result
    : invalid(path);
}

function month(value: unknown, path: string): string {
  return match(value, MONTH, path);
}

function dateTime(value: unknown, path: string): string {
  const result = text(value, path);
  const parts = RFC3339.exec(result);
  if (parts === null) return invalid(path);
  const year = Number(parts[1]);
  const monthValue = Number(parts[2]);
  const day = Number(parts[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (monthValue < 1 || monthValue > 12 || day < 1 || day > (days[monthValue - 1] ?? 0) ||
    Number(parts[4]) > 23 || Number(parts[5]) > 59 || Number(parts[6]) > 59 ||
    Number(parts[7] ?? 0) > 23 || Number(parts[8] ?? 0) > 59 ||
    !Number.isFinite(Date.parse(result))) return invalid(path);
  return result;
}

function envelope(value: unknown): unknown {
  const response = object(value, ['code', 'message', 'data', 'request_id'], 'response');
  if (response.code !== 'OK' || response.message !== 'success') invalid('response');
  text(response.request_id, 'response.request_id');
  return response.data;
}

function pagination(value: unknown, path: string): { page: number; page_size: number; total: number } {
  const result = object(value, ['page', 'page_size', 'total'], path);
  return {
    page: integer(result.page, `${path}.page`, 1),
    page_size: integer(result.page_size, `${path}.page_size`, 1, 100),
    total: integer(result.total, `${path}.total`, 0),
  };
}

function salesMetrics(value: ObjectValue, path: string): SalesMetricFields {
  return {
    active_agent_count: integer(value.active_agent_count, `${path}.active_agent_count`, 0),
    created_order_count: integer(value.created_order_count, `${path}.created_order_count`, 0),
    customer_total_snapshot: integer(value.customer_total_snapshot, `${path}.customer_total_snapshot`, 0),
    net_sales_amount: match(value.net_sales_amount, SIGNED_MONEY, `${path}.net_sales_amount`),
    net_units: integer(value.net_units, `${path}.net_units`),
    new_binding_count: integer(value.new_binding_count, `${path}.new_binding_count`, 0),
    new_registration_count: integer(value.new_registration_count, `${path}.new_registration_count`, 0),
    paid_amount: match(value.paid_amount, NON_NEGATIVE_MONEY, `${path}.paid_amount`),
    paid_order_count: integer(value.paid_order_count, `${path}.paid_order_count`, 0),
    paid_units: integer(value.paid_units, `${path}.paid_units`, 0),
    refunded_amount: match(value.refunded_amount, NON_NEGATIVE_MONEY, `${path}.refunded_amount`),
    refunded_units: integer(value.refunded_units, `${path}.refunded_units`, 0),
  };
}

function dailySalesRow(value: unknown, path: string): components['schemas']['DailySalesRow'] {
  const result = object(value, [...SALES_METRIC_KEYS, 'business_date'], path);
  return { ...salesMetrics(result, path), business_date: calendarDate(result.business_date, `${path}.business_date`) };
}

function monthlySalesRow(value: unknown, path: string): components['schemas']['MonthlySalesRow'] {
  const result = object(value, [...SALES_METRIC_KEYS, 'business_month'], path);
  return { ...salesMetrics(result, path), business_month: month(result.business_month, `${path}.business_month`) };
}

function productRankingRow(value: unknown, path: string): components['schemas']['ProductRankingRow'] {
  const result = object(value, [
    'rank', 'product_id', 'product_name', 'sku_id', 'sku_name', 'paid_units', 'refunded_units',
    'net_units', 'paid_amount', 'refunded_amount', 'net_sales_amount',
  ], path);
  return {
    net_sales_amount: match(result.net_sales_amount, SIGNED_MONEY, `${path}.net_sales_amount`),
    net_units: integer(result.net_units, `${path}.net_units`),
    paid_amount: match(result.paid_amount, NON_NEGATIVE_MONEY, `${path}.paid_amount`),
    paid_units: integer(result.paid_units, `${path}.paid_units`, 0),
    product_id: ulid(result.product_id, `${path}.product_id`),
    product_name: text(result.product_name, `${path}.product_name`),
    rank: integer(result.rank, `${path}.rank`, 1),
    refunded_amount: match(result.refunded_amount, NON_NEGATIVE_MONEY, `${path}.refunded_amount`),
    refunded_units: integer(result.refunded_units, `${path}.refunded_units`, 0),
    sku_id: ulid(result.sku_id, `${path}.sku_id`),
    sku_name: text(result.sku_name, `${path}.sku_name`),
  };
}

function customerRankingRow(value: unknown, path: string): components['schemas']['CustomerRankingRow'] {
  const result = object(value, [
    'rank', 'customer_id', 'customer_alias', 'nickname_masked', 'paid_order_count', 'paid_amount',
    'refunded_amount', 'net_consumption_amount',
  ], path);
  return {
    customer_alias: text(result.customer_alias, `${path}.customer_alias`),
    customer_id: ulid(result.customer_id, `${path}.customer_id`),
    net_consumption_amount: match(
      result.net_consumption_amount,
      SIGNED_MONEY,
      `${path}.net_consumption_amount`,
    ),
    nickname_masked: nullableText(result.nickname_masked, `${path}.nickname_masked`),
    paid_amount: match(result.paid_amount, NON_NEGATIVE_MONEY, `${path}.paid_amount`),
    paid_order_count: integer(result.paid_order_count, `${path}.paid_order_count`, 0),
    rank: integer(result.rank, `${path}.rank`, 1),
    refunded_amount: match(result.refunded_amount, NON_NEGATIVE_MONEY, `${path}.refunded_amount`),
  };
}

function report<Row>(
  value: unknown,
  readRow: (item: unknown, path: string) => Row,
  expectedScope: AnalyticsScope,
  expectedAgentId: string | null,
): {
  timezone: 'Asia/Shanghai';
  as_of: string;
  data_freshness: 'REALTIME';
  scope: 'GLOBAL' | 'DIRECT' | 'AGENT';
  agent_id: string | null;
  rows: Row[];
  pagination: { page: number; page_size: number; total: number };
} {
  const data = object(
    envelope(value),
    ['timezone', 'as_of', 'data_freshness', 'scope', 'agent_id', 'rows', 'pagination'],
    'response.data',
  );
  if (data.timezone !== 'Asia/Shanghai') invalid('response.data.timezone');
  if (data.data_freshness !== 'REALTIME') invalid('response.data.data_freshness');
  const scope = enumeration(data.scope, SCOPES, 'response.data.scope');
  const agentId = nullableUlid(data.agent_id, 'response.data.agent_id');
  if (scope !== 'AGENT' && agentId !== null) invalid('response.data.agent_id');
  if (scope !== expectedScope || agentId !== expectedAgentId) invalid('response.data.scope');
  return {
    agent_id: agentId,
    as_of: dateTime(data.as_of, 'response.data.as_of'),
    data_freshness: 'REALTIME',
    pagination: pagination(data.pagination, 'response.data.pagination'),
    rows: list(data.rows, 'response.data.rows', readRow),
    scope,
    timezone: 'Asia/Shanghai',
  };
}

export function decodeAdminDashboard(value: unknown): AdminDashboardData {
  const data = object(envelope(value), [
    'timezone', 'as_of', 'today_sales_amount', 'month_sales_amount', 'month_agent_net_sales_amount',
    'total_sales_amount', 'today_created_order_count', 'today_effective_paid_order_count',
    'customer_total_snapshot', 'new_registration_count', 'new_binding_count', 'active_agent_count',
    'pending_withdrawal_count', 'product_ranking',
  ], 'response.data');
  if (data.timezone !== 'Asia/Shanghai') invalid('response.data.timezone');
  return {
    active_agent_count: integer(data.active_agent_count, 'response.data.active_agent_count', 0),
    as_of: dateTime(data.as_of, 'response.data.as_of'),
    customer_total_snapshot: integer(data.customer_total_snapshot, 'response.data.customer_total_snapshot', 0),
    month_agent_net_sales_amount: match(
      data.month_agent_net_sales_amount,
      SIGNED_MONEY,
      'response.data.month_agent_net_sales_amount',
    ),
    month_sales_amount: match(data.month_sales_amount, SIGNED_MONEY, 'response.data.month_sales_amount'),
    new_binding_count: integer(data.new_binding_count, 'response.data.new_binding_count', 0),
    new_registration_count: integer(data.new_registration_count, 'response.data.new_registration_count', 0),
    pending_withdrawal_count: integer(data.pending_withdrawal_count, 'response.data.pending_withdrawal_count', 0),
    product_ranking: list(data.product_ranking, 'response.data.product_ranking', productRankingRow),
    timezone: 'Asia/Shanghai',
    today_created_order_count: integer(data.today_created_order_count, 'response.data.today_created_order_count', 0),
    today_effective_paid_order_count: integer(
      data.today_effective_paid_order_count,
      'response.data.today_effective_paid_order_count',
      0,
    ),
    today_sales_amount: match(data.today_sales_amount, SIGNED_MONEY, 'response.data.today_sales_amount'),
    total_sales_amount: match(data.total_sales_amount, SIGNED_MONEY, 'response.data.total_sales_amount'),
  };
}

export function decodeDailySalesReport(
  value: unknown,
  expectedScope: AnalyticsScope,
  expectedAgentId: string | null,
): DailySalesReportData {
  return report(value, dailySalesRow, expectedScope, expectedAgentId);
}

export function decodeMonthlySalesReport(
  value: unknown,
  expectedScope: AnalyticsScope,
  expectedAgentId: string | null,
): MonthlySalesReportData {
  return report(value, monthlySalesRow, expectedScope, expectedAgentId);
}

export function decodeProductRankingReport(
  value: unknown,
  expectedScope: AnalyticsScope,
  expectedAgentId: string | null,
): ProductRankingReportData {
  return report(value, productRankingRow, expectedScope, expectedAgentId);
}

export function decodeCustomerRankingReport(
  value: unknown,
  expectedScope: AnalyticsScope,
  expectedAgentId: string | null,
): CustomerRankingReportData {
  return report(value, customerRankingRow, expectedScope, expectedAgentId);
}
