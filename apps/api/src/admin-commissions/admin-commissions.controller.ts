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
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAdminCommissionListQuery,
  parseAdminWalletLedgerListQuery,
  parseCommissionResourceId,
  parseCommissionRuleActionBody,
  parseCommissionRuleConfirmationBody,
  parseCommissionRuleIfMatch,
  parseCommissionSkuListQuery,
  parseCommissionVersionListQuery,
  parseEmptyQuery,
} from './admin-commissions.dto';
import { AdminCommissionsService } from './admin-commissions.service';

@Controller('admin')
@RequireRoles('SUPER_ADMIN')
export class AdminCommissionsController {
  constructor(@Inject(AdminCommissionsService) private readonly commissions: AdminCommissionsService) {}

  @Get('commission-rules/current')
  @NoStore()
  getCurrentRules(@Query() query: unknown) {
    parseEmptyQuery(query);
    return this.commissions.getCurrentRules();
  }

  @Get('commission-rules/skus')
  @NoStore()
  listRuleSkus(@Query() query: unknown) {
    return this.commissions.listRuleSkus(parseCommissionSkuListQuery(query));
  }

  @Post('commission-rule-versions/preview')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  previewRulePublish(
    @Query() query: unknown,
    @Body() body: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseEmptyQuery(query);
    return this.commissions.previewRulePublish(
      requireAdminCatalogRequest(rawRequest),
      parseCommissionRuleActionBody(body),
      idempotencyKey,
    );
  }

  @Post('commission-rule-versions')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  publishRuleVersion(
    @Query() query: unknown,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: string | string[] | undefined,
    @IdempotencyKey() idempotencyKey: string,
    @Req() rawRequest: PrincipalRequest,
  ) {
    parseEmptyQuery(query);
    return this.commissions.publishRuleVersion(
      requireAdminCatalogRequest(rawRequest),
      parseCommissionRuleConfirmationBody(body),
      parseCommissionRuleIfMatch(ifMatch),
      idempotencyKey,
    );
  }

  @Get('commission-rule-versions')
  @NoStore()
  listRuleVersions(@Query() query: unknown) {
    return this.commissions.listRuleVersions(parseCommissionVersionListQuery(query));
  }

  @Get('commission-rule-versions/:version_id')
  @NoStore()
  getRuleVersion(
    @Param('version_id') versionId: string,
    @Query() query: unknown,
  ) {
    parseEmptyQuery(query);
    return this.commissions.getRuleVersion(parseCommissionResourceId(versionId, 'version_id'));
  }

  @Get('agents/:agent_id/commissions')
  @NoStore()
  listAgentCommissions(
    @Param('agent_id') agentId: string,
    @Query() query: unknown,
  ) {
    return this.commissions.listAgentCommissions(
      parseCommissionResourceId(agentId, 'agent_id'),
      parseAdminCommissionListQuery(query),
    );
  }

  @Get('agents/:agent_id/wallet-ledger')
  @NoStore()
  listAgentWalletLedger(
    @Param('agent_id') agentId: string,
    @Query() query: unknown,
  ) {
    return this.commissions.listAgentWalletLedger(
      parseCommissionResourceId(agentId, 'agent_id'),
      parseAdminWalletLedgerListQuery(query),
    );
  }

  @Get('orders/:order_id/commission-explanation')
  @NoStore()
  getOrderExplanation(
    @Param('order_id') orderId: string,
    @Query() query: unknown,
  ) {
    parseEmptyQuery(query);
    return this.commissions.getOrderExplanation(parseCommissionResourceId(orderId, 'order_id'));
  }
}
