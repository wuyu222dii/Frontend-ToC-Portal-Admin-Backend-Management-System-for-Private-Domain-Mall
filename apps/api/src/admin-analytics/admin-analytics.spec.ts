import type { INestApplication } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAnalyticsRepository,
  type AdminAnalyticsReportResult,
  type AdminCustomerRankingSnapshot,
  type AdminDailySalesSnapshot,
  type AdminDashboardSnapshot,
  type AdminMonthlySalesSnapshot,
  type AdminProductRankingSnapshot,
  type DatabaseRuntime,
} from '@qingxu/database';
import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { REQUIRED_ROLES } from '../platform/access/rbac.metadata';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { configureApi } from '../platform/http/configure-api';
import { ErrorEnvelopeFilter } from '../platform/http/error-envelope.filter';
import { NO_STORE_RESPONSE } from '../platform/http/no-store.decorator';
import { RequestIdMiddleware } from '../platform/http/request-id.middleware';
import { SuccessEnvelopeInterceptor } from '../platform/http/success-envelope.interceptor';
import { AdminAnalyticsController } from './admin-analytics.controller';
import { AdminAnalyticsService } from './admin-analytics.service';

const AS_OF = new Date('2026-09-05T04:00:00.000Z');
const REQUEST_ID = `trace_${'a'.repeat(32)}`;

const product: AdminProductRankingSnapshot = {
  netSalesAmount: '42.00',
  netUnits: 2,
  paidAmount: '50.00',
  paidUnits: 3,
  productId: generateUlid(),
  productName: 'Test product',
  rank: 1,
  refundedAmount: '8.00',
  refundedUnits: 1,
  skuId: generateUlid(),
  skuName: 'Test SKU',
};

const customer: AdminCustomerRankingSnapshot = {
  customerAlias: 'customer_test',
  customerId: generateUlid(),
  netConsumptionAmount: '42.00',
  nicknameMasked: 'T***',
  paidAmount: '50.00',
  paidOrderCount: 2,
  rank: 1,
  refundedAmount: '8.00',
};

const metric = {
  activeAgentCount: 1,
  createdOrderCount: 3,
  customerTotalSnapshot: 7,
  netSalesAmount: '42.00',
  netUnits: 2,
  newBindingCount: 1,
  newRegistrationCount: 2,
  paidAmount: '50.00',
  paidOrderCount: 2,
  paidUnits: 3,
  refundedAmount: '8.00',
  refundedUnits: 1,
};

const daily: AdminDailySalesSnapshot = { ...metric, businessDate: '2026-09-05' };
const monthly: AdminMonthlySalesSnapshot = { ...metric, businessMonth: '2026-09' };

const dashboard: AdminDashboardSnapshot = {
  activeAgentCount: 1,
  asOf: AS_OF,
  customerTotalSnapshot: 7,
  monthAgentNetSalesAmount: '30.00',
  monthSalesAmount: '42.00',
  newBindingCount: 1,
  newRegistrationCount: 2,
  pendingWithdrawalCount: 1,
  productRanking: [product],
  todayCreatedOrderCount: 3,
  todayEffectivePaidOrderCount: 2,
  todaySalesAmount: '42.00',
  totalSalesAmount: '142.00',
};

function report<T>(rows: T[]): AdminAnalyticsReportResult<T> {
  return { agentId: null, asOf: AS_OF, rows, scope: 'GLOBAL', total: rows.length };
}

function expectNoStore(response: request.Response): void {
  expect(response.headers['cache-control']).toBe('no-store, private');
  expect(response.headers.pragma).toBe('no-cache');
}

function sortedKeys(value: object): string[] {
  return Object.keys(value).sort();
}

describe('B14.1 Admin analytics API', () => {
  let app: INestApplication;
  const dashboardQuery = vi.spyOn(AdminAnalyticsRepository.prototype, 'getDashboard');
  const dailyQuery = vi.spyOn(AdminAnalyticsRepository.prototype, 'listDailySales');
  const monthlyQuery = vi.spyOn(AdminAnalyticsRepository.prototype, 'listMonthlySales');
  const productQuery = vi.spyOn(AdminAnalyticsRepository.prototype, 'listProductRanking');
  const customerQuery = vi.spyOn(AdminAnalyticsRepository.prototype, 'listCustomerRanking');

  beforeAll(async () => {
    const config = {
      encryption: { ipHashKey: Buffer.alloc(32, 0x41) },
    } as unknown as PlatformRuntimeConfig;
    const database = { prisma: {} } as unknown as DatabaseRuntime;
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminAnalyticsController],
      providers: [
        AdminAnalyticsService,
        { provide: API_RUNTIME_CONFIG, useValue: config },
        { provide: API_DATABASE_RUNTIME, useValue: database },
        { provide: APP_FILTER, useClass: ErrorEnvelopeFilter },
        { provide: APP_INTERCEPTOR, useClass: SuccessEnvelopeInterceptor },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    const requestIds = new RequestIdMiddleware();
    app.use(requestIds.use.bind(requestIds));
    configureApi(app);
    await app.init();
  });

  beforeEach(() => {
    dashboardQuery.mockReset().mockResolvedValue(dashboard);
    dailyQuery.mockReset().mockResolvedValue(report([daily]));
    monthlyQuery.mockReset().mockResolvedValue(report([monthly]));
    productQuery.mockReset().mockResolvedValue(report([product]));
    customerQuery.mockReset().mockResolvedValue(report([customer]));
  });

  afterAll(async () => app?.close());

  it('exposes five strict no-store response envelopes with GLOBAL defaults', async () => {
    const reportKeys = ['agent_id', 'as_of', 'data_freshness', 'pagination', 'rows', 'scope', 'timezone'].sort();
    const metricKeys = [
      'active_agent_count', 'created_order_count', 'customer_total_snapshot', 'net_sales_amount', 'net_units',
      'new_binding_count', 'new_registration_count', 'paid_amount', 'paid_order_count', 'paid_units',
      'refunded_amount', 'refunded_units',
    ];
    const productKeys = [
      'net_sales_amount', 'net_units', 'paid_amount', 'paid_units', 'product_id', 'product_name', 'rank',
      'refunded_amount', 'refunded_units', 'sku_id', 'sku_name',
    ].sort();
    const cases = [
      {
        dataKeys: [
          'active_agent_count', 'as_of', 'customer_total_snapshot', 'month_agent_net_sales_amount',
          'month_sales_amount', 'new_binding_count', 'new_registration_count', 'pending_withdrawal_count',
          'product_ranking', 'timezone', 'today_created_order_count', 'today_effective_paid_order_count',
          'today_sales_amount', 'total_sales_amount',
        ].sort(),
        path: '/api/v1/admin/dashboard',
        rowKeys: productKeys,
        rows: 'product_ranking',
      },
      {
        dataKeys: reportKeys,
        path: '/api/v1/admin/reports/daily-sales',
        rowKeys: [...metricKeys, 'business_date'].sort(),
        rows: 'rows',
      },
      {
        dataKeys: reportKeys,
        path: '/api/v1/admin/reports/monthly-sales',
        rowKeys: [...metricKeys, 'business_month'].sort(),
        rows: 'rows',
      },
      {
        dataKeys: reportKeys,
        path: '/api/v1/admin/reports/product-ranking',
        rowKeys: productKeys,
        rows: 'rows',
      },
      {
        dataKeys: reportKeys,
        path: '/api/v1/admin/reports/customer-ranking',
        rowKeys: [
          'customer_alias', 'customer_id', 'net_consumption_amount', 'nickname_masked', 'paid_amount',
          'paid_order_count', 'rank', 'refunded_amount',
        ].sort(),
        rows: 'rows',
      },
    ];

    for (const testCase of cases) {
      const response = await request(app.getHttpServer())
        .get(testCase.path)
        .set('X-Request-Id', REQUEST_ID)
        .expect(200);
      expect(sortedKeys(response.body)).toStrictEqual(['code', 'data', 'message', 'request_id']);
      expect(response.body).toMatchObject({ code: 'OK', message: 'success', request_id: REQUEST_ID });
      expect(sortedKeys(response.body.data)).toStrictEqual(testCase.dataKeys);
      expect(sortedKeys(response.body.data[testCase.rows][0])).toStrictEqual(testCase.rowKeys);
      expectNoStore(response);
    }
    expect(dashboardQuery).toHaveReturned();
    expect(productQuery).toHaveReturned();
    expect(customerQuery).toHaveReturned();
    expect(dailyQuery).toHaveBeenCalledWith({ page: 1, pageSize: 20, scope: 'GLOBAL' });
    expect(monthlyQuery).toHaveBeenCalledWith({ page: 1, pageSize: 20, scope: 'GLOBAL' });
    expect(productQuery).toHaveBeenCalledWith({ page: 1, pageSize: 20, scope: 'GLOBAL' });
    expect(customerQuery).toHaveBeenCalledWith({ page: 1, pageSize: 20, scope: 'GLOBAL' });
  });

  it('distinguishes all-agent and specified-agent AGENT scopes', async () => {
    const agentId = generateUlid();
    dailyQuery.mockImplementation(async (input) => ({
      agentId: input.agentId ?? null,
      asOf: AS_OF,
      rows: [],
      scope: input.scope,
      total: 0,
    }));

    const allAgents = await request(app.getHttpServer())
      .get('/api/v1/admin/reports/daily-sales?scope=AGENT')
      .expect(200);
    expect(allAgents.body.data.agent_id).toBeNull();
    expect(allAgents.body.data.scope).toBe('AGENT');

    const specifiedAgent = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/daily-sales?scope=AGENT&agent_id=${agentId}`)
      .expect(200);
    expect(specifiedAgent.body.data.agent_id).toBe(agentId);
    expect(dailyQuery).toHaveBeenLastCalledWith({ agentId, page: 1, pageSize: 20, scope: 'AGENT' });
  });

  it.each([
    '/api/v1/admin/dashboard?scope=GLOBAL',
    `/api/v1/admin/reports/daily-sales?scope=GLOBAL&agent_id=${generateUlid()}`,
    '/api/v1/admin/reports/daily-sales?date_from=2026-09-01',
    '/api/v1/admin/reports/daily-sales?date_from=2024-01-01&date_to=2025-01-01',
    '/api/v1/admin/reports/monthly-sales?month_from=2020-01&month_to=2025-01',
    '/api/v1/admin/reports/product-ranking?timezone=UTC',
  ])('rejects invalid query combinations: %s', async (path) => {
    const response = await request(app.getHttpServer()).get(path).expect(400);
    expect(response.body.code).toBe('INVALID_ARGUMENT');
  });

  it('maps an unknown specified agent to 404', async () => {
    dailyQuery.mockRejectedValueOnce(new ApplicationError('RESOURCE_NOT_FOUND', 'Agent does not exist'));
    const response = await request(app.getHttpServer())
      .get(`/api/v1/admin/reports/daily-sales?scope=AGENT&agent_id=${generateUlid()}`)
      .expect(404);
    expect(response.body.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('declares SUPER_ADMIN and no-store policies on every handler', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, AdminAnalyticsController)).toStrictEqual(['SUPER_ADMIN']);
    for (const handler of [
      AdminAnalyticsController.prototype.dashboard,
      AdminAnalyticsController.prototype.dailySales,
      AdminAnalyticsController.prototype.monthlySales,
      AdminAnalyticsController.prototype.productRanking,
      AdminAnalyticsController.prototype.customerRanking,
    ]) {
      expect(Reflect.getMetadata(NO_STORE_RESPONSE, handler)).toBe(true);
    }
  });
});
