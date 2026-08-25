import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';

import { NoStore } from '../admin-auth/no-store.decorator';
import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import {
  parseInventoryAdjustmentBody,
  parseInventoryAdjustmentConfirmationBody,
  parseInventoryLedgerQuery,
  parseInventoryListQuery,
  parseInventorySkuId,
} from './admin-inventory.dto';
import { AdminInventoryService } from './admin-inventory.service';

@Controller('admin/inventory')
@RequireRoles('SUPER_ADMIN')
export class AdminInventoryController {
  constructor(@Inject(AdminInventoryService) private readonly inventory: AdminInventoryService) {}

  @Get()
  listInventory(@Query() query: unknown) {
    return this.inventory.listInventory(parseInventoryListQuery(query));
  }

  @Post(':sku_id/adjustment-preview') @HttpCode(HttpStatus.OK) @NoStore()
  previewAdjustment(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.inventory.previewAdjustment(
      requireAdminCatalogRequest(rawRequest),
      parseInventorySkuId(skuIdValue),
      parseInventoryAdjustmentBody(body),
      idempotencyKey,
    );
  }

  @Post(':sku_id/adjustments') @HttpCode(HttpStatus.OK) @NoStore()
  confirmAdjustment(
    @Param('sku_id') skuIdValue: string,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    return this.inventory.confirmAdjustment(
      requireAdminCatalogRequest(rawRequest),
      parseInventorySkuId(skuIdValue),
      parseInventoryAdjustmentConfirmationBody(body),
      expectedVersion,
      idempotencyKey,
    );
  }

  @Get(':sku_id/ledger')
  listLedger(
    @Param('sku_id') skuIdValue: string,
    @Query() query: unknown,
  ) {
    return this.inventory.listLedger(
      parseInventorySkuId(skuIdValue),
      parseInventoryLedgerQuery(query),
    );
  }
}
