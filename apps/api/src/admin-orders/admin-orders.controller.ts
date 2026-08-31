import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminCreateShipmentBody,
  parseAdminLogisticsEventBody,
  parseAdminOrderEmptyQuery,
  parseAdminOrderId,
  parseAdminOrderListQuery,
  parseAdminShipmentId,
} from './admin-orders.dto';
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

  @Post(':order_id/shipments')
  @HttpCode(HttpStatus.CREATED)
  @NoStore()
  @RequireRoles('SUPER_ADMIN')
  createShipment(
    @Param('order_id') orderIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminOrderEmptyQuery(query);
    return this.orders.createShipment(
      requireAdminCatalogRequest(rawRequest),
      parseAdminOrderId(orderIdValue),
      parseAdminCreateShipmentBody(body),
      expectedVersion,
      idempotencyKey,
    );
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

@Controller('admin/shipments')
@RequireRoles('SUPER_ADMIN')
export class AdminShipmentsController {
  constructor(@Inject(AdminOrdersService) private readonly orders: AdminOrdersService) {}

  @Post(':shipment_id/events')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  appendEvent(
    @Param('shipment_id') shipmentIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminOrderEmptyQuery(query);
    return this.orders.appendLogisticsEvent(
      requireAdminCatalogRequest(rawRequest),
      parseAdminShipmentId(shipmentIdValue),
      parseAdminLogisticsEventBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
