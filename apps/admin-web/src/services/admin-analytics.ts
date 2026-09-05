import type { components, operations } from '@qingxu/contracts';

import { adminSessionRequest } from './admin-api';
import {
  decodeAdminDashboard,
  decodeCustomerRankingReport,
  decodeDailySalesReport,
  decodeMonthlySalesReport,
  decodeProductRankingReport,
} from './admin-analytics-decoders';

export type AdminDashboardData = components['schemas']['AdminDashboardResponse']['data'];
export type DailySalesReportData = components['schemas']['DailySalesReportResponse']['data'];
export type MonthlySalesReportData = components['schemas']['MonthlySalesReportResponse']['data'];
export type ProductRankingReportData = components['schemas']['ProductRankingResponse']['data'];
export type CustomerRankingReportData = components['schemas']['CustomerRankingResponse']['data'];
export type AdminDailySalesQuery = NonNullable<operations['getAdminReportsDailySales']['parameters']['query']>;
export type AdminMonthlySalesQuery = NonNullable<operations['getAdminReportsMonthlySales']['parameters']['query']>;
export type AdminProductRankingQuery = NonNullable<operations['getAdminReportsProductRanking']['parameters']['query']>;
export type AdminCustomerRankingQuery = NonNullable<operations['getAdminReportsCustomerRanking']['parameters']['query']>;
export type AnalyticsScope = NonNullable<AdminDailySalesQuery['scope']>;

type DateQuery = AdminDailySalesQuery | AdminProductRankingQuery | AdminCustomerRankingQuery;

function expectedScope(query: { scope?: AnalyticsScope; agent_id?: string }): [AnalyticsScope, string | null] {
  return [query.scope ?? 'GLOBAL', query.agent_id ?? null];
}

function addCommonQuery(search: URLSearchParams, query: DateQuery | AdminMonthlySalesQuery): void {
  if (query.page !== undefined) search.set('page', String(query.page));
  if (query.page_size !== undefined) search.set('page_size', String(query.page_size));
  if (query.timezone !== undefined) search.set('timezone', query.timezone);
  if (query.scope !== undefined) search.set('scope', query.scope);
  if (query.agent_id !== undefined) search.set('agent_id', query.agent_id);
}

function dateReportPath(path: string, query: DateQuery): string {
  const search = new URLSearchParams();
  addCommonQuery(search, query);
  if (query.date_from !== undefined) search.set('date_from', query.date_from);
  if (query.date_to !== undefined) search.set('date_to', query.date_to);
  return search.size === 0 ? path : `${path}?${search.toString()}`;
}

function monthlyReportPath(query: AdminMonthlySalesQuery): string {
  const path = '/admin/reports/monthly-sales';
  const search = new URLSearchParams();
  addCommonQuery(search, query);
  if (query.month_from !== undefined) search.set('month_from', query.month_from);
  if (query.month_to !== undefined) search.set('month_to', query.month_to);
  return search.size === 0 ? path : `${path}?${search.toString()}`;
}

export async function getAdminDashboard(signal?: AbortSignal): Promise<AdminDashboardData> {
  const response = await adminSessionRequest<unknown>('/admin/dashboard', { expectedStatus: 200, signal });
  return decodeAdminDashboard(response);
}

export async function listAdminDailySales(
  query: AdminDailySalesQuery = {},
  signal?: AbortSignal,
): Promise<DailySalesReportData> {
  const response = await adminSessionRequest<unknown>(dateReportPath('/admin/reports/daily-sales', query), {
    expectedStatus: 200,
    signal,
  });
  return decodeDailySalesReport(response, ...expectedScope(query));
}

export async function listAdminMonthlySales(
  query: AdminMonthlySalesQuery = {},
  signal?: AbortSignal,
): Promise<MonthlySalesReportData> {
  const response = await adminSessionRequest<unknown>(monthlyReportPath(query), { expectedStatus: 200, signal });
  return decodeMonthlySalesReport(response, ...expectedScope(query));
}

export async function listAdminProductRanking(
  query: AdminProductRankingQuery = {},
  signal?: AbortSignal,
): Promise<ProductRankingReportData> {
  const response = await adminSessionRequest<unknown>(dateReportPath('/admin/reports/product-ranking', query), {
    expectedStatus: 200,
    signal,
  });
  return decodeProductRankingReport(response, ...expectedScope(query));
}

export async function listAdminCustomerRanking(
  query: AdminCustomerRankingQuery = {},
  signal?: AbortSignal,
): Promise<CustomerRankingReportData> {
  const response = await adminSessionRequest<unknown>(dateReportPath('/admin/reports/customer-ranking', query), {
    expectedStatus: 200,
    signal,
  });
  return decodeCustomerRankingReport(response, ...expectedScope(query));
}
