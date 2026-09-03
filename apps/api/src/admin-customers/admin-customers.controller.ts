import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminCustomerEmptyQuery,
  parseAdminCustomerId,
  parseAdminCustomerListQuery,
  parseCustomerTransferBody,
  parseCustomerTransferConfirmationBody,
} from './admin-customers.dto';
import { requireAdminCustomerRequest } from './admin-customers.request';
import { AdminCustomersService } from './admin-customers.service';

@Controller('admin/customers')
@RequireRoles('SUPER_ADMIN')
export class AdminCustomersController {
  constructor(@Inject(AdminCustomersService) private readonly customers: AdminCustomersService) {}

  @Get() @NoStore()
  list(@Query() query: unknown) {
    return this.customers.list(parseAdminCustomerListQuery(query));
  }

  @Get(':customer_id') @NoStore()
  detail(@Param('customer_id') customerId: string, @Query() query: unknown) {
    parseAdminCustomerEmptyQuery(query);
    return this.customers.detail(parseAdminCustomerId(customerId));
  }

  @Post(':customer_id/attribution-transfer-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewTransfer(
    @Param('customer_id') customerId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminCustomerEmptyQuery(query);
    return this.customers.previewTransfer(
      requireAdminCustomerRequest(request),
      parseAdminCustomerId(customerId),
      parseCustomerTransferBody(body),
      idempotencyKey,
    );
  }

  @Post(':customer_id/attribution-transfers') @HttpCode(HttpStatus.OK) @NoStore()
  transfer(
    @Param('customer_id') customerId: string,
    @Body() body: unknown,
    @Query() query: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminCustomerEmptyQuery(query);
    return this.customers.transfer(
      requireAdminCustomerRequest(request),
      parseAdminCustomerId(customerId),
      parseCustomerTransferConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
