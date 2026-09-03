import { Controller, Get, Inject, Param, Query, Req } from '@nestjs/common';

import {
  requireUnrestrictedAgentSession,
  type AgentAuthRequestContext,
} from '../agent-auth/agent-auth.request';
import { AgentRealm } from '../platform/auth/agent-realm.metadata';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAgentCommissionListQuery,
  parseAgentCustomerListQuery,
  parseAgentOperationsEmptyQuery,
  parseAgentOperationsResourceId,
  parseAgentOrderListQuery,
} from './agent-operations.dto';
import { AgentOperationsService } from './agent-operations.service';

@Controller('agent')
@AgentRealm()
export class AgentOperationsController {
  constructor(@Inject(AgentOperationsService) private readonly operations: AgentOperationsService) {}

  @Get('dashboard')
  @NoStore()
  getDashboard(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    parseAgentOperationsEmptyQuery(query);
    return this.operations.getDashboard(requireUnrestrictedAgentSession(request));
  }

  @Get('customers')
  @NoStore()
  listCustomers(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    return this.operations.listCustomers(
      requireUnrestrictedAgentSession(request),
      parseAgentCustomerListQuery(query),
    );
  }

  @Get('customers/:customer_id')
  @NoStore()
  getCustomer(
    @Param('customer_id') customerId: string,
    @Query() query: unknown,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentOperationsEmptyQuery(query);
    return this.operations.getCustomer(
      requireUnrestrictedAgentSession(request),
      parseAgentOperationsResourceId(customerId, 'customer_id'),
    );
  }

  @Get('orders')
  @NoStore()
  listOrders(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    return this.operations.listOrders(
      requireUnrestrictedAgentSession(request),
      parseAgentOrderListQuery(query),
    );
  }

  @Get('orders/:order_id')
  @NoStore()
  getOrder(
    @Param('order_id') orderId: string,
    @Query() query: unknown,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentOperationsEmptyQuery(query);
    return this.operations.getOrder(
      requireUnrestrictedAgentSession(request),
      parseAgentOperationsResourceId(orderId, 'order_id'),
    );
  }

  @Get('commissions')
  @NoStore()
  listCommissions(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    return this.operations.listCommissions(
      requireUnrestrictedAgentSession(request),
      parseAgentCommissionListQuery(query),
    );
  }

  @Get('commissions/:commission_snapshot_id')
  @NoStore()
  getCommission(
    @Param('commission_snapshot_id') commissionSnapshotId: string,
    @Query() query: unknown,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentOperationsEmptyQuery(query);
    return this.operations.getCommission(
      requireUnrestrictedAgentSession(request),
      parseAgentOperationsResourceId(commissionSnapshotId, 'commission_snapshot_id'),
    );
  }

  @Get('wallet')
  @NoStore()
  getWallet(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    parseAgentOperationsEmptyQuery(query);
    return this.operations.getWallet(requireUnrestrictedAgentSession(request));
  }
}
