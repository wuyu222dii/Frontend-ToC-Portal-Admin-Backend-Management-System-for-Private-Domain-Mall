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

import {
  requireUnrestrictedAgentSession,
  type AgentAuthRequestContext,
} from '../agent-auth/agent-auth.request';
import { AgentRealm } from '../platform/auth/agent-realm.metadata';
import { IdempotencyKey } from '../platform/http/idempotency-key.decorator';
import { NoStore } from '../platform/http/no-store.decorator';
import {
  parseAgentBankAccountWriteBody,
  parseAgentCommissionListQuery,
  parseAgentCreateWithdrawalBody,
  parseAgentCustomerListQuery,
  parseAgentDashboardQuery,
  parseAgentOperationsEmptyQuery,
  parseAgentOperationsResourceId,
  parseAgentOrderListQuery,
  parseAgentWithdrawalListQuery,
} from './agent-operations.dto';
import { AgentOperationsService } from './agent-operations.service';

@Controller('agent')
@AgentRealm()
export class AgentOperationsController {
  constructor(@Inject(AgentOperationsService) private readonly operations: AgentOperationsService) {}

  @Get('dashboard')
  @NoStore()
  getDashboard(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    return this.operations.getDashboard(
      requireUnrestrictedAgentSession(request),
      parseAgentDashboardQuery(query),
    );
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

  @Get('bank-accounts')
  @NoStore()
  listBankAccounts(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    parseAgentOperationsEmptyQuery(query);
    return this.operations.listBankAccounts(requireUnrestrictedAgentSession(request));
  }

  @Post('bank-accounts')
  @HttpCode(HttpStatus.OK)
  @NoStore()
  replaceBankAccount(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentOperationsEmptyQuery(query);
    requireUnrestrictedAgentSession(request);
    return this.operations.replaceBankAccount(request, parseAgentBankAccountWriteBody(body), key);
  }

  @Get('withdrawals')
  @NoStore()
  listWithdrawals(@Query() query: unknown, @Req() request: AgentAuthRequestContext) {
    return this.operations.listWithdrawals(
      requireUnrestrictedAgentSession(request),
      parseAgentWithdrawalListQuery(query),
    );
  }

  @Post('withdrawals')
  @HttpCode(HttpStatus.CREATED)
  @NoStore()
  createWithdrawal(
    @Body() body: unknown,
    @Query() query: unknown,
    @IdempotencyKey() key: string,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentOperationsEmptyQuery(query);
    requireUnrestrictedAgentSession(request);
    return this.operations.createWithdrawal(request, parseAgentCreateWithdrawalBody(body), key);
  }

  @Get('withdrawals/:withdrawal_id')
  @NoStore()
  getWithdrawal(
    @Param('withdrawal_id') withdrawalId: string,
    @Query() query: unknown,
    @Req() request: AgentAuthRequestContext,
  ) {
    parseAgentOperationsEmptyQuery(query);
    return this.operations.getWithdrawal(
      requireUnrestrictedAgentSession(request),
      parseAgentOperationsResourceId(withdrawalId, 'withdrawal_id'),
    );
  }
}
