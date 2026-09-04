import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Patch, Post, Query, Req } from '@nestjs/common';

import { requireAdminCatalogRequest } from '../admin-catalog/admin-catalog.request';
import { RequireRoles } from '../platform/access/rbac.metadata';
import type { PrincipalRequest } from '../platform/access/principal';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { IfMatchVersion } from '../platform/http/if-match.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminBusinessRuleAction,
  parseAdminBusinessRuleConfirmation,
  parseAdminSettingsEmptyQuery,
} from './admin-settings.dto';
import { AdminSettingsService } from './admin-settings.service';

@Controller('admin/settings/business-rules')
@RequireRoles('SUPER_ADMIN')
export class AdminSettingsController {
  constructor(@Inject(AdminSettingsService) private readonly settings: AdminSettingsService) {}

  @Get() @NoStore()
  get(@Query() query: unknown) {
    parseAdminSettingsEmptyQuery(query);
    return this.settings.getBusinessRules();
  }

  @Post('preview') @HttpCode(HttpStatus.OK) @NoStore()
  preview(
    @Query() query: unknown,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminSettingsEmptyQuery(query);
    return this.settings.previewBusinessRules(
      requireAdminCatalogRequest(request),
      parseAdminBusinessRuleAction(body),
      idempotencyKey,
    );
  }

  @Patch() @HttpCode(HttpStatus.OK) @NoStore()
  publish(
    @Query() query: unknown,
    @Body() body: unknown,
    @IfMatchVersion() expectedVersion: number,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: PrincipalRequest,
  ) {
    parseAdminSettingsEmptyQuery(query);
    return this.settings.publishBusinessRules(
      requireAdminCatalogRequest(request),
      parseAdminBusinessRuleConfirmation(body),
      expectedVersion,
      idempotencyKey,
    );
  }
}
