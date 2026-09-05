import { Controller, Get, Inject, Query } from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminAnalyticsDateListQuery,
  parseAdminAnalyticsEmptyQuery,
  parseAdminAnalyticsMonthListQuery,
} from './admin-analytics.dto';
import { AdminAnalyticsService } from './admin-analytics.service';

@Controller('admin')
@RequireRoles('SUPER_ADMIN')
export class AdminAnalyticsController {
  constructor(@Inject(AdminAnalyticsService) private readonly analytics: AdminAnalyticsService) {}

  @Get('dashboard')
  @NoStore()
  dashboard(@Query() query: unknown) {
    parseAdminAnalyticsEmptyQuery(query);
    return this.analytics.dashboard();
  }

  @Get('reports/daily-sales')
  @NoStore()
  dailySales(@Query() query: unknown) {
    return this.analytics.dailySales(parseAdminAnalyticsDateListQuery(query));
  }

  @Get('reports/monthly-sales')
  @NoStore()
  monthlySales(@Query() query: unknown) {
    return this.analytics.monthlySales(parseAdminAnalyticsMonthListQuery(query));
  }

  @Get('reports/product-ranking')
  @NoStore()
  productRanking(@Query() query: unknown) {
    return this.analytics.productRanking(parseAdminAnalyticsDateListQuery(query));
  }

  @Get('reports/customer-ranking')
  @NoStore()
  customerRanking(@Query() query: unknown) {
    return this.analytics.customerRanking(parseAdminAnalyticsDateListQuery(query));
  }
}
