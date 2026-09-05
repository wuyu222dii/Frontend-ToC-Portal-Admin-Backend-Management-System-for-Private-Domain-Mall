import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAnalyticsRepository,
  type AdminAnalyticsDateListInput,
  type AdminAnalyticsMonthListInput,
  type AdminCustomerRankingSnapshot,
  type AdminDailySalesSnapshot,
  type AdminMonthlySalesSnapshot,
  type AdminProductRankingSnapshot,
  type DatabaseRuntime,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';

function dailySalesView(row: AdminDailySalesSnapshot) {
  return {
    active_agent_count: row.activeAgentCount,
    business_date: row.businessDate,
    created_order_count: row.createdOrderCount,
    customer_total_snapshot: row.customerTotalSnapshot,
    net_sales_amount: row.netSalesAmount,
    net_units: row.netUnits,
    new_binding_count: row.newBindingCount,
    new_registration_count: row.newRegistrationCount,
    paid_amount: row.paidAmount,
    paid_order_count: row.paidOrderCount,
    paid_units: row.paidUnits,
    refunded_amount: row.refundedAmount,
    refunded_units: row.refundedUnits,
  };
}

function monthlySalesView(row: AdminMonthlySalesSnapshot) {
  return {
    active_agent_count: row.activeAgentCount,
    business_month: row.businessMonth,
    created_order_count: row.createdOrderCount,
    customer_total_snapshot: row.customerTotalSnapshot,
    net_sales_amount: row.netSalesAmount,
    net_units: row.netUnits,
    new_binding_count: row.newBindingCount,
    new_registration_count: row.newRegistrationCount,
    paid_amount: row.paidAmount,
    paid_order_count: row.paidOrderCount,
    paid_units: row.paidUnits,
    refunded_amount: row.refundedAmount,
    refunded_units: row.refundedUnits,
  };
}

function productRankingView(row: AdminProductRankingSnapshot) {
  return {
    net_sales_amount: row.netSalesAmount,
    net_units: row.netUnits,
    paid_amount: row.paidAmount,
    paid_units: row.paidUnits,
    product_id: row.productId,
    product_name: row.productName,
    rank: row.rank,
    refunded_amount: row.refundedAmount,
    refunded_units: row.refundedUnits,
    sku_id: row.skuId,
    sku_name: row.skuName,
  };
}

function customerRankingView(row: AdminCustomerRankingSnapshot) {
  return {
    customer_alias: row.customerAlias,
    customer_id: row.customerId,
    net_consumption_amount: row.netConsumptionAmount,
    nickname_masked: row.nicknameMasked,
    paid_amount: row.paidAmount,
    paid_order_count: row.paidOrderCount,
    rank: row.rank,
    refunded_amount: row.refundedAmount,
  };
}

@Injectable()
export class AdminAnalyticsService {
  private readonly analytics?: AdminAnalyticsRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.analytics = new AdminAnalyticsRepository(database.prisma, config.encryption.ipHashKey);
    }
  }

  async dashboard() {
    const dashboard = await this.repository().getDashboard();
    return {
      active_agent_count: dashboard.activeAgentCount,
      as_of: dashboard.asOf.toISOString(),
      customer_total_snapshot: dashboard.customerTotalSnapshot,
      month_agent_net_sales_amount: dashboard.monthAgentNetSalesAmount,
      month_sales_amount: dashboard.monthSalesAmount,
      new_binding_count: dashboard.newBindingCount,
      new_registration_count: dashboard.newRegistrationCount,
      pending_withdrawal_count: dashboard.pendingWithdrawalCount,
      product_ranking: dashboard.productRanking.map(productRankingView),
      timezone: 'Asia/Shanghai' as const,
      today_created_order_count: dashboard.todayCreatedOrderCount,
      today_effective_paid_order_count: dashboard.todayEffectivePaidOrderCount,
      today_sales_amount: dashboard.todaySalesAmount,
      total_sales_amount: dashboard.totalSalesAmount,
    };
  }

  async dailySales(input: AdminAnalyticsDateListInput) {
    const report = await this.repository().listDailySales(input);
    return {
      agent_id: report.agentId,
      as_of: report.asOf.toISOString(),
      data_freshness: 'REALTIME' as const,
      pagination: { page: input.page, page_size: input.pageSize, total: report.total },
      rows: report.rows.map(dailySalesView),
      scope: report.scope,
      timezone: 'Asia/Shanghai' as const,
    };
  }

  async monthlySales(input: AdminAnalyticsMonthListInput) {
    const report = await this.repository().listMonthlySales(input);
    return {
      agent_id: report.agentId,
      as_of: report.asOf.toISOString(),
      data_freshness: 'REALTIME' as const,
      pagination: { page: input.page, page_size: input.pageSize, total: report.total },
      rows: report.rows.map(monthlySalesView),
      scope: report.scope,
      timezone: 'Asia/Shanghai' as const,
    };
  }

  async productRanking(input: AdminAnalyticsDateListInput) {
    const report = await this.repository().listProductRanking(input);
    return {
      agent_id: report.agentId,
      as_of: report.asOf.toISOString(),
      data_freshness: 'REALTIME' as const,
      pagination: { page: input.page, page_size: input.pageSize, total: report.total },
      rows: report.rows.map(productRankingView),
      scope: report.scope,
      timezone: 'Asia/Shanghai' as const,
    };
  }

  async customerRanking(input: AdminAnalyticsDateListInput) {
    const report = await this.repository().listCustomerRanking(input);
    return {
      agent_id: report.agentId,
      as_of: report.asOf.toISOString(),
      data_freshness: 'REALTIME' as const,
      pagination: { page: input.page, page_size: input.pageSize, total: report.total },
      rows: report.rows.map(customerRankingView),
      scope: report.scope,
      timezone: 'Asia/Shanghai' as const,
    };
  }

  private repository(): AdminAnalyticsRepository {
    if (!this.analytics) throw new ApplicationError('INTERNAL_ERROR', 'Admin analytics database is unavailable');
    return this.analytics;
  }
}
