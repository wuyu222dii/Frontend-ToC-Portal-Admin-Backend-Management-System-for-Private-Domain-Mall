import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req } from '@nestjs/common';

import { AgentRealm } from '../platform/auth/agent-realm.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  agentRequestIp,
  requireAgentRequestId,
  requireUnrestrictedAgentSession,
  type AgentAuthRequestContext,
} from '../agent-auth/agent-auth.request';
import { AgentCommerceService } from './agent-commerce.service';
import {
  parseAgentEmptyQuery,
  parseAgentProductId,
  parseAgentProductListQuery,
  parseCreatePromotionAssetBody,
} from './agent-commerce.dto';

@Controller('agent')
@AgentRealm()
export class AgentCommerceController {
  constructor(@Inject(AgentCommerceService) private readonly commerce: AgentCommerceService) {}

  @Get('products')
  listProducts(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    return this.commerce.listProducts(requireUnrestrictedAgentSession(request), parseAgentProductListQuery(query));
  }

  @Get('products/:product_id')
  getProduct(
    @Param('product_id') productId: string,
    @Query() query: unknown,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentEmptyQuery(query);
    return this.commerce.getProduct(requireUnrestrictedAgentSession(request), parseAgentProductId(productId));
  }

  @Post('promotion-assets') @HttpCode(HttpStatus.OK) @NoStore()
  createPromotionAsset(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() idempotencyKey: string,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentEmptyQuery(query);
    return this.commerce.createPromotionAsset(
      requireUnrestrictedAgentSession(request),
      parseCreatePromotionAssetBody(body),
      idempotencyKey,
      requireAgentRequestId(request),
      agentRequestIp(request),
    );
  }
}
