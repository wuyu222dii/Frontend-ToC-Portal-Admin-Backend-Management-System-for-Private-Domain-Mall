import { Controller, Get, Headers, Inject, Param, Query, Req } from '@nestjs/common';

import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { NoStore } from '../platform/http/no-store.decorator';
import { parseAdminOrderId, parseAdminOrderListQuery } from './admin-orders.dto';
import { AdminOrdersService } from './admin-orders.service';

@Controller('admin/orders')
export class AdminOrdersController {
  constructor(@Inject(AdminOrdersService) private readonly orders: AdminOrdersService) {}

  @Get()
  @NoStore()
  @RequireRoles('SUPER_ADMIN')
  list(@Query() query: unknown) {
    return this.orders.listOrders(parseAdminOrderListQuery(query));
  }

  @Get(':order_id')
  @NoStore()
  @RequireRoles('SUPER_ADMIN')
  get(@Param('order_id') orderIdValue: string) {
    return this.orders.getOrder(parseAdminOrderId(orderIdValue));
  }

  @Get(':order_id/fulfillment-address')
  @NoStore()
  @RequireRoles('SUPER_ADMIN', 'AGENT_ADMIN')
  fulfillmentAddress(
    @Param('order_id') orderIdValue: string,
    @Headers('x-access-purpose') purpose: unknown,
    @Headers('x-access-reason') reason: unknown,
    @Req() rawRequest: PrincipalRequest,
  ) {
    // Both Admin-realm roles reach the service so an AGENT_ADMIN denial can be
    // durably audited before returning a safe error.
    return this.orders.getFulfillmentAddress(
      requireAdminCatalogRequest(rawRequest),
      parseAdminOrderId(orderIdValue),
      purpose,
      reason,
    );
  }
}
