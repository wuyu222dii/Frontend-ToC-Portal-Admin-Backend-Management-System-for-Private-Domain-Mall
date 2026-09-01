import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Patch,
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
  parseAdminAftersaleApproveBody,
  parseAdminAftersaleEmptyQuery,
  parseAdminAftersaleId,
  parseAdminAftersaleListQuery,
  parseAdminAftersaleRejectBody,
  parseAdminAftersaleRejectConfirmationBody,
  parseAdminReturnAddressAction,
  parseAdminReturnAddressConfirmation,
} from './admin-aftersales.dto';
import { AdminAftersalesService } from './admin-aftersales.service';

@Controller('admin/aftersales')
@RequireRoles('SUPER_ADMIN')
export class AdminAftersalesController {
  constructor(@Inject(AdminAftersalesService) private readonly aftersales: AdminAftersalesService) {}

  @Get()
  @NoStore()
  list(@Query() query: unknown) {
    return this.aftersales.listAftersales(parseAdminAftersaleListQuery(query));
  }

  @Get(':aftersale_id')
  @NoStore()
  get(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Query() query: unknown,
  ) {
    parseAdminAftersaleEmptyQuery(query);
    return this.aftersales.getAftersale(parseAdminAftersaleId(aftersaleIdValue));
  }

  @Post(':aftersale_id/approve')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  approve(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminAftersaleEmptyQuery(query);
    return this.aftersales.approveAftersale(
      requireAdminCatalogRequest(rawRequest),
      parseAdminAftersaleId(aftersaleIdValue),
      parseAdminAftersaleApproveBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Post(':aftersale_id/reject-preview')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  previewReject(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminAftersaleEmptyQuery(query);
    return this.aftersales.previewReject(
      requireAdminCatalogRequest(rawRequest),
      parseAdminAftersaleId(aftersaleIdValue),
      parseAdminAftersaleRejectBody(body),
      idempotencyKey,
    );
  }

  @Post(':aftersale_id/reject')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  reject(
    @Param('aftersale_id') aftersaleIdValue: string,
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminAftersaleEmptyQuery(query);
    return this.aftersales.rejectAftersale(
      requireAdminCatalogRequest(rawRequest),
      parseAdminAftersaleId(aftersaleIdValue),
      parseAdminAftersaleRejectConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}

@Controller('admin/settings/return-address')
@RequireRoles('SUPER_ADMIN')
export class AdminReturnAddressController {
  constructor(@Inject(AdminAftersalesService) private readonly aftersales: AdminAftersalesService) {}

  @Get()
  @NoStore()
  get(@Query() query: unknown) {
    parseAdminAftersaleEmptyQuery(query);
    return this.aftersales.getReturnAddress();
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  preview(
    @Query() query: unknown,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminAftersaleEmptyQuery(query);
    return this.aftersales.previewReturnAddress(
      requireAdminCatalogRequest(rawRequest),
      parseAdminReturnAddressAction(body),
      idempotencyKey,
    );
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @NoStore()
  publish(
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseAdminAftersaleEmptyQuery(query);
    return this.aftersales.publishReturnAddress(
      requireAdminCatalogRequest(rawRequest),
      parseAdminReturnAddressConfirmation(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
