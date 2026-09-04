import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AgentFinanceRepository,
  AgentOperationsRepository,
  type AgentBankAccountSnapshot,
  type AgentCommissionDetailSnapshot,
  type AgentOrderDisplayAxes,
  type AgentOrderItemSnapshot,
  type AgentWithdrawalSnapshot,
  AuditRepository,
  type CacheableAgentFinanceResponse,
  type CurrentAgentSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, generateUlid, projectOrderDisplayStatus } from '@qingxu/platform-core';

import {
  agentRequestIp,
  requireAgentRequestId,
  requireUnrestrictedAgentSession,
  type AgentAuthRequestContext,
} from '../agent-auth/agent-auth.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import {
  agentBankAccountHashCandidates,
  createAgentBankAccountMaterial,
  maskAgentBankAccountHolder,
} from '../platform/security/bank-account-security';
import type {
  AgentBankAccountWriteInput,
  AgentCommissionListQuery,
  AgentCreateWithdrawalInput,
  AgentCustomerListQuery,
  AgentOrderListQuery,
  AgentWithdrawalListQuery,
} from './agent-operations.dto';

const ROUTES = {
  bankAccounts: '/agent/bank-accounts',
  withdrawals: '/agent/withdrawals',
} as const;

function displayStatus(axes: AgentOrderDisplayAxes): string {
  return projectOrderDisplayStatus(axes);
}

function itemView(item: AgentOrderItemSnapshot) {
  return {
    line_amount: item.lineAmount,
    order_item_id: item.orderItemId,
    product_id: item.productId,
    product_name: item.productName,
    quantity: item.quantity,
    refunded_quantity: item.refundedQuantity,
    reserved_aftersale_quantity: item.reservedAftersaleQuantity,
    shipped_quantity: item.shippedQuantity,
    sku_id: item.skuId,
    sku_name: item.skuName,
    unit_price: item.unitPrice,
  };
}

function commissionDetailView(commission: AgentCommissionDetailSnapshot) {
  return {
    commission_snapshot_id: commission.commissionSnapshotId,
    order_item_id: commission.orderItemId,
    product_id: commission.productId,
    product_name: commission.productName,
    sku_id: commission.skuId,
    sku_name: commission.skuName,
    category_id: commission.categoryId,
    category_name: commission.categoryName,
    rule_version_id: commission.ruleVersionId,
    rule_version_no: commission.ruleVersionNo,
    rule_source: commission.ruleSource,
    hit_path: commission.hitPath,
    effective_rate: commission.effectiveRate,
    commission_base: commission.commissionBase,
    original_commission: commission.originalCommission,
    expected_remaining: commission.expectedRemaining,
    reversal_total: commission.reversalTotal,
    rounding_mode: 'HALF_UP' as const,
    rounding_scale: 2 as const,
    position_state: commission.positionState,
    ledger: commission.ledger.map((ledger) => ({
      ledger_id: ledger.ledgerId,
      ledger_type: ledger.ledgerType,
      expected_change: ledger.expectedChange,
      available_change: ledger.availableChange,
      frozen_change: ledger.frozenChange,
      refund_id: ledger.refundId,
      reason: ledger.reason,
      occurred_at: ledger.occurredAt.toISOString(),
    })),
  };
}

function bankAccountView(account: AgentBankAccountSnapshot) {
  return {
    account_holder_masked: maskAgentBankAccountHolder(account.accountHolder),
    account_no_last4: account.last4,
    account_number_masked: `**** ${account.last4}`,
    bank_account_id: account.bankAccountId,
    bank_name: account.bankName,
    is_active: account.isActive,
    version: account.version,
  };
}

function withdrawalView(withdrawal: AgentWithdrawalSnapshot) {
  return {
    amount: withdrawal.amount,
    bank_account_masked: `**** ${withdrawal.bankAccountLast4}`,
    created_at: withdrawal.createdAt.toISOString(),
    paid_at: withdrawal.paidAt?.toISOString() ?? null,
    proof_file_ids: withdrawal.proofFileIds,
    review_reason: withdrawal.reviewReason,
    reviewed_at: withdrawal.reviewedAt?.toISOString() ?? null,
    status: withdrawal.status,
    version: withdrawal.version,
    withdrawal_id: withdrawal.withdrawalId,
    withdrawal_no: withdrawal.withdrawalNo,
  };
}

@Injectable()
export class AgentOperationsService {
  private readonly audit!: AuditRepository;
  private readonly finance!: AgentFinanceRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly operations!: AgentOperationsRepository;
  private readonly outbox!: OutboxRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (database) {
      this.finance = new AgentFinanceRepository(database.prisma);
      this.operations = new AgentOperationsRepository(database.prisma);
    }
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
    }
  }

  async getDashboard(session: CurrentAgentSession) {
    const dashboard = await this.repository().getDashboard({
      accountId: session.accountId,
      agentId: session.agentId,
    });
    return {
      timezone: 'Asia/Shanghai' as const,
      as_of: dashboard.asOf.toISOString(),
      agent_id: dashboard.agentId,
      today_net_sales_amount: dashboard.todayNetSalesAmount,
      month_net_sales_amount: dashboard.monthNetSalesAmount,
      today_paid_order_count: dashboard.todayPaidOrderCount,
      attributed_customer_count: dashboard.attributedCustomerCount,
      expected_commission: dashboard.expectedCommission,
      available_balance: dashboard.availableBalance,
      frozen_balance: dashboard.frozenBalance,
      negative_balance: dashboard.negativeBalance,
      pending_withdrawal_count: dashboard.pendingWithdrawalCount,
      todo: {
        commission_exception_count: dashboard.commissionExceptionCount,
        withdrawal_action_count: dashboard.withdrawalActionCount,
      },
      trend: dashboard.trend.map((point) => ({
        business_date: point.businessDate,
        net_sales_amount: point.netSalesAmount,
        paid_order_count: point.paidOrderCount,
        commission_change: point.commissionChange,
      })),
    };
  }

  async listCustomers(session: CurrentAgentSession, input: AgentCustomerListQuery) {
    const result = await this.repository().listCustomers({
      accountId: session.accountId,
      agentId: session.agentId,
      ...(input.boundAtFrom === undefined ? {} : { boundAtFrom: input.boundAtFrom }),
      ...(input.boundAtToExclusive === undefined ? {} : { boundAtToExclusive: input.boundAtToExclusive }),
      ...(input.keyword === undefined ? {} : { keyword: input.keyword }),
      page: input.page,
      pageSize: input.pageSize,
    });
    return {
      items: result.items.map((customer) => ({
        account_status: 'ACTIVE' as const,
        binding_id: customer.bindingId,
        binding_started_at: customer.bindingStartedAt.toISOString(),
        binding_status: 'BOUND' as const,
        city: customer.city,
        consumption_amount: customer.consumptionAmount,
        consumption_count: customer.consumptionCount,
        customer_alias: customer.customerAlias,
        customer_id: customer.customerId,
        last_product_name: customer.lastProductName,
        nickname_masked: customer.nicknameMasked,
        phone_tail: customer.phoneTail,
        registered_at: customer.registeredAt.toISOString(),
      })),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getCustomer(session: CurrentAgentSession, customerId: string) {
    const result = await this.repository().getCustomer({
      accountId: session.accountId,
      agentId: session.agentId,
      customerId,
    });
    const customer = result.customer;
    return {
      binding_period: {
        binding_id: customer.bindingId,
        ended_at: null,
        started_at: customer.bindingStartedAt.toISOString(),
      },
      customer: {
        binding: {
          agent_id: session.agentId,
          agent_name: session.agentName,
          binding_id: customer.bindingId,
          customer_id: customer.customerId,
          customer_version: customer.customerVersion,
          started_at: customer.bindingStartedAt.toISOString(),
        },
        city: customer.city,
        consumption_amount: customer.consumptionAmount,
        consumption_count: customer.consumptionCount,
        customer_alias: customer.customerAlias,
        customer_id: customer.customerId,
        last_product_name: customer.lastProductName,
        nickname_masked: customer.nicknameMasked,
        phone_tail: customer.phoneTail,
        registered_at: customer.registeredAt.toISOString(),
        version: customer.customerVersion,
      },
      orders: result.orders.map((order) => ({
        display_status: displayStatus(order.displayAxes),
        order_id: order.orderId,
        order_no: order.orderNo,
        paid_at: order.paidAt.toISOString(),
        payable_amount: order.payableAmount,
      })),
      recent_products: result.recentProducts.map((product) => ({
        last_purchased_at: product.lastPurchasedAt.toISOString(),
        product_id: product.productId,
        product_name: product.productName,
        sku_id: product.skuId,
        sku_name: product.skuName,
      })),
    };
  }

  async listOrders(session: CurrentAgentSession, input: AgentOrderListQuery) {
    const result = await this.repository().listOrders({
      accountId: session.accountId,
      agentId: session.agentId,
      ...(input.createdAtFrom === undefined ? {} : { createdAtFrom: input.createdAtFrom }),
      ...(input.createdAtToExclusive === undefined ? {} : { createdAtToExclusive: input.createdAtToExclusive }),
      ...(input.customerId === undefined ? {} : { customerId: input.customerId }),
      ...(input.fulfillmentStatus === undefined ? {} : { fulfillmentStatus: input.fulfillmentStatus }),
      ...(input.hasAftersale === undefined ? {} : { hasAftersale: input.hasAftersale }),
      ...(input.maxAmount === undefined ? {} : { maxAmount: input.maxAmount }),
      ...(input.minAmount === undefined ? {} : { minAmount: input.minAmount }),
      ...(input.orderNo === undefined ? {} : { orderNo: input.orderNo }),
      ...(input.orderStatus === undefined ? {} : { orderStatus: input.orderStatus }),
      page: input.page,
      pageSize: input.pageSize,
      ...(input.refundProcessingStatus === undefined
        ? {}
        : { refundProcessingStatus: input.refundProcessingStatus }),
      ...(input.refundProgressStatus === undefined
        ? {}
        : { refundProgressStatus: input.refundProgressStatus }),
      sort: input.sort,
    });
    return {
      items: result.items.map((order) => ({
        aftersale_summary: {
          active_count: order.aftersaleSummary.activeCount,
          latest_aftersale_id: order.aftersaleSummary.latestAftersaleId,
          latest_status: order.aftersaleSummary.latestStatus,
          refunded_amount: order.aftersaleSummary.refundedAmount,
        },
        available_actions: ['VIEW_DETAIL', 'VIEW_COMMISSION'] as const,
        close_reason: order.closeReason,
        completion_reason: order.completionReason,
        created_at: order.createdAt.toISOString(),
        customer_alias: order.customerAlias,
        customer_city: order.customerCity,
        display_status: displayStatus(order),
        final_agent_id: order.finalAgentId,
        fulfillment_status: order.fulfillmentStatus,
        items: order.items.map((item) => ({
          line_amount: item.lineAmount,
          order_item_id: item.orderItemId,
          product_id: item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          sku_id: item.skuId,
          sku_name: item.skuName,
        })),
        order_id: order.orderId,
        order_no: order.orderNo,
        order_status: order.orderStatus,
        paid_at: order.paidAt.toISOString(),
        payable_amount: order.payableAmount,
        payment_resolution: order.paymentResolution,
        payment_status: 'PAID' as const,
        refund_processing_status: order.refundProcessingStatus,
        refund_progress_status: order.refundProgressStatus,
      })),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getOrder(session: CurrentAgentSession, orderId: string) {
    const order = await this.repository().getOrder({
      accountId: session.accountId,
      agentId: session.agentId,
      orderId,
    });
    return {
      aftersales: order.aftersales.map((aftersale) => ({
        aftersale_id: aftersale.aftersaleId,
        aftersale_no: aftersale.aftersaleNo,
        created_at: aftersale.createdAt.toISOString(),
        requested_amount: aftersale.requestedAmount,
        status: aftersale.status,
        type: aftersale.type,
      })),
      available_actions: ['VIEW_DETAIL', 'VIEW_COMMISSION'] as const,
      close_reason: order.closeReason,
      commission_items: order.commissionItems.map((commission) => ({
        commission_snapshot_id: commission.commissionSnapshotId,
        effective_rate: commission.effectiveRate,
        order_item_id: commission.orderItemId,
        original_commission: commission.originalCommission,
        rule_source: commission.ruleSource,
        state: commission.state,
      })),
      completion_reason: order.completionReason,
      created_at: order.createdAt.toISOString(),
      customer_snapshot: {
        address_summary_masked: order.addressSummaryMasked,
        city: order.customerCity,
        customer_alias: order.customerAlias,
        nickname_masked: order.customerNicknameMasked,
        phone_tail: order.customerPhoneTail,
      },
      display_status: displayStatus(order),
      final_agent_id: order.finalAgentId,
      fulfillment_status: order.fulfillmentStatus,
      items: order.items.map(itemView),
      order_id: order.orderId,
      order_no: order.orderNo,
      order_status: order.orderStatus,
      paid_at: order.paidAt.toISOString(),
      payable_amount: order.payableAmount,
      payment_resolution: order.paymentResolution,
      payment_status: 'PAID' as const,
      refund_processing_status: order.refundProcessingStatus,
      refund_progress_status: order.refundProgressStatus,
      timeline: order.timeline.map((event) => ({
        axis: event.axis,
        event_code: event.eventCode,
        event_id: event.eventId,
        from_status: event.fromStatus,
        occurred_at: event.occurredAt.toISOString(),
        to_status: event.toStatus,
      })),
    };
  }

  async listCommissions(session: CurrentAgentSession, input: AgentCommissionListQuery) {
    const result = await this.repository().listCommissions({
      accountId: session.accountId,
      agentId: session.agentId,
      ...(input.ledgerType === undefined ? {} : { ledgerType: input.ledgerType }),
      ...(input.occurredAtFrom === undefined ? {} : { occurredAtFrom: input.occurredAtFrom }),
      ...(input.occurredAtToExclusive === undefined ? {} : { occurredAtToExclusive: input.occurredAtToExclusive }),
      ...(input.orderNo === undefined ? {} : { orderNo: input.orderNo }),
      page: input.page,
      pageSize: input.pageSize,
      ...(input.state === undefined ? {} : { state: input.state }),
    });
    return {
      items: result.items.map((commission) => ({
        ledger_id: commission.ledgerId,
        commission_snapshot_id: commission.commissionSnapshotId,
        order_id: commission.orderId,
        order_no: commission.orderNo,
        order_item_id: commission.orderItemId,
        product_id: commission.productId,
        product_name: commission.productName,
        sku_id: commission.skuId,
        sku_name: commission.skuName,
        effective_rate: commission.effectiveRate,
        commission_base: commission.commissionBase,
        original_commission: commission.originalCommission,
        refund_id: commission.refundId,
        ledger_type: commission.ledgerType,
        position_state: commission.positionState,
        expected_change: commission.expectedChange,
        available_change: commission.availableChange,
        reason: commission.reason,
        occurred_at: commission.occurredAt.toISOString(),
      })),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getCommission(session: CurrentAgentSession, commissionSnapshotId: string) {
    const result = await this.repository().getCommission({
      accountId: session.accountId,
      agentId: session.agentId,
      commissionSnapshotId,
    });
    return {
      order_id: result.orderId,
      order_no: result.orderNo,
      item: commissionDetailView(result),
    };
  }

  async getWallet(session: CurrentAgentSession) {
    const wallet = await this.repository().getWallet({
      accountId: session.accountId,
      agentId: session.agentId,
    });
    return {
      available_balance: wallet.availableBalance,
      frozen_balance: wallet.frozenBalance,
      is_negative: wallet.isNegative,
      withdrawal_allowed: wallet.withdrawalAllowed,
      blocked_reason: wallet.blockedReason,
      version: wallet.version,
    };
  }

  async listBankAccounts(session: CurrentAgentSession) {
    const accounts = await this.financeRepository().listBankAccounts({
      accountId: session.accountId,
      agentId: session.agentId,
    });
    return accounts.map(bankAccountView);
  }

  async replaceBankAccount(
    request: AgentAuthRequestContext,
    input: AgentBankAccountWriteInput,
    idempotencyKey: string,
  ) {
    const session = requireUnrestrictedAgentSession(request);
    const requestId = requireAgentRequestId(request);
    const { config, database } = this.runtime();
    const bankAccountId = generateUlid();
    const material = createAgentBankAccountMaterial(
      bankAccountId,
      input.accountNumber,
      config.encryption.fieldKeys.current,
      config.encryption.bankAccountHashKeys.current,
    );
    const claim = this.claim(session.accountId, idempotencyKey, ROUTES.bankAccounts, {
      account_holder: input.accountHolder,
      account_number: input.accountNumber,
      bank_name: input.bankName,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const replay = this.idempotency.agentFinanceReplay(claimed.record);
        if (!('bank_account_id' in replay.data)) {
          throw new ApplicationError('INTERNAL_ERROR', 'Bank-account replay type is invalid');
        }
        return preEnvelopedResponse({ ...replay, data: replay.data });
      }
      const result = await this.finance.replaceBankAccountInTransaction(transaction, {
        accountHash: material.accountHash,
        accountHashCandidates: agentBankAccountHashCandidates(
          input.accountNumber,
          config.encryption.bankAccountHashKeys,
        ),
        accountHolder: input.accountHolder,
        accountId: session.accountId,
        agentId: session.agentId,
        bankAccountId,
        bankName: input.bankName,
        ciphertext: material.ciphertext,
        encryptionKeyId: material.encryptionKeyId,
        last4: material.last4,
      });
      const response: CacheableAgentFinanceResponse = {
        code: 'OK',
        data: bankAccountView(result.bankAccount),
        message: 'success',
        request_id: requestId,
      };
      if (result.changed) {
        await this.appendBankAccountFacts(
          transaction,
          request,
          idempotencyKey,
          session,
          result.bankAccount,
        );
      }
      await this.idempotency.complete(transaction, claim, {
        policy: 'AGENT_FINANCE_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  async createWithdrawal(
    request: AgentAuthRequestContext,
    input: AgentCreateWithdrawalInput,
    idempotencyKey: string,
  ) {
    const session = requireUnrestrictedAgentSession(request);
    const requestId = requireAgentRequestId(request);
    const { database } = this.runtime();
    const withdrawalId = generateUlid();
    const claim = this.claim(session.accountId, idempotencyKey, ROUTES.withdrawals, {
      amount: input.amount,
      bank_account_id: input.bankAccountId,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const replay = this.idempotency.agentFinanceReplay(claimed.record);
        if (!('withdrawal_id' in replay.data)) {
          throw new ApplicationError('INTERNAL_ERROR', 'Withdrawal replay type is invalid');
        }
        return preEnvelopedResponse({ ...replay, data: replay.data });
      }
      const withdrawal = await this.finance.createWithdrawalInTransaction(transaction, {
        accountId: session.accountId,
        agentId: session.agentId,
        amount: input.amount,
        bankAccountId: input.bankAccountId,
        withdrawalId,
      });
      const response: CacheableAgentFinanceResponse = {
        code: 'OK',
        data: withdrawalView(withdrawal),
        message: 'success',
        request_id: requestId,
      };
      await this.appendWithdrawalFacts(transaction, request, idempotencyKey, session, withdrawal);
      await this.idempotency.complete(transaction, claim, {
        policy: 'AGENT_FINANCE_RESPONSE',
        responseBody: response,
        responseStatus: 201,
        storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  async listWithdrawals(session: CurrentAgentSession, input: AgentWithdrawalListQuery) {
    const result = await this.financeRepository().listWithdrawals({
      accountId: session.accountId,
      agentId: session.agentId,
      ...(input.createdAtFrom === undefined ? {} : { createdAtFrom: input.createdAtFrom }),
      ...(input.createdAtToExclusive === undefined ? {} : { createdAtToExclusive: input.createdAtToExclusive }),
      ...(input.maxAmount === undefined ? {} : { maxAmount: input.maxAmount }),
      ...(input.minAmount === undefined ? {} : { minAmount: input.minAmount }),
      page: input.page,
      pageSize: input.pageSize,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.withdrawalNo === undefined ? {} : { withdrawalNo: input.withdrawalNo }),
    });
    return {
      items: result.items.map(withdrawalView),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getWithdrawal(session: CurrentAgentSession, withdrawalId: string) {
    return withdrawalView(await this.financeRepository().getWithdrawal({
      accountId: session.accountId,
      agentId: session.agentId,
      withdrawalId,
    }));
  }

  private claim(actorId: string, idempotencyKey: string, route: string, body: unknown): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters: {}, route },
    };
  }

  private appendBankAccountFacts(
    transaction: DatabaseTransaction,
    request: AgentAuthRequestContext,
    idempotencyKey: string,
    session: CurrentAgentSession,
    account: AgentBankAccountSnapshot,
  ) {
    const ipAddress = agentRequestIp(request);
    return Promise.all([
      this.audit.append(transaction, {
        action: 'CREATE',
        actorAccountId: session.accountId,
        actorRole: 'AGENT_ADMIN',
        after: { status: 'ACTIVE', version: account.version },
        idempotencyKey,
        ...(ipAddress === undefined ? {} : { ipAddress }),
        module: 'agent',
        objectId: account.bankAccountId,
        objectType: 'bank_account',
        requestId: requireAgentRequestId(request),
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'STATUS_VERSION',
      }),
      this.outbox.append(transaction, {
        aggregateId: session.agentId,
        aggregateType: 'agent',
        eventType: 'agent.bank_account.updated',
        payload: {
          event_version: 1,
          resource_id: session.agentId,
          resource_type: 'agent',
          resource_version: account.version,
        },
      }),
    ]);
  }

  private appendWithdrawalFacts(
    transaction: DatabaseTransaction,
    request: AgentAuthRequestContext,
    idempotencyKey: string,
    session: CurrentAgentSession,
    withdrawal: AgentWithdrawalSnapshot,
  ) {
    const ipAddress = agentRequestIp(request);
    return Promise.all([
      this.audit.append(transaction, {
        action: 'CREATE',
        actorAccountId: session.accountId,
        actorRole: 'AGENT_ADMIN',
        after: { status: withdrawal.status, version: withdrawal.version },
        idempotencyKey,
        ...(ipAddress === undefined ? {} : { ipAddress }),
        module: 'withdrawal',
        objectId: withdrawal.withdrawalId,
        objectType: 'withdrawal',
        requestId: requireAgentRequestId(request),
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'STATUS_VERSION',
      }),
      this.outbox.append(transaction, {
        aggregateId: withdrawal.withdrawalId,
        aggregateType: 'withdrawal',
        eventType: 'withdrawal.submitted',
        payload: {
          event_version: 1,
          resource_id: withdrawal.withdrawalId,
          resource_type: 'withdrawal',
          resource_version: withdrawal.version,
        },
      }),
    ]);
  }

  private financeRepository(): AgentFinanceRepository {
    if (!this.finance) throw new ApplicationError('INTERNAL_ERROR', 'Agent finance database is unavailable');
    return this.finance;
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database || !this.finance || !this.audit || !this.idempotency || !this.outbox) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent finance runtime is unavailable');
    }
    return { config: this.config, database: this.database };
  }

  private repository(): AgentOperationsRepository {
    if (!this.operations) throw new ApplicationError('INTERNAL_ERROR', 'Agent operations database is unavailable');
    return this.operations;
  }
}
