import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  AgentOperationsRepository,
  type AgentOrderDisplayAxes,
  type AgentOrderItemSnapshot,
  type CurrentAgentSession,
  type DatabaseRuntime,
} from '@qingxu/database';
import { ApplicationError, projectOrderDisplayStatus } from '@qingxu/platform-core';

import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { AgentCustomerListQuery, AgentOrderListQuery } from './agent-operations.dto';

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

@Injectable()
export class AgentOperationsService {
  private readonly operations!: AgentOperationsRepository;

  constructor(@Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime) {
    if (database) this.operations = new AgentOperationsRepository(database.prisma);
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

  private repository(): AgentOperationsRepository {
    if (!this.operations) throw new ApplicationError('INTERNAL_ERROR', 'Agent operations database is unavailable');
    return this.operations;
  }
}
