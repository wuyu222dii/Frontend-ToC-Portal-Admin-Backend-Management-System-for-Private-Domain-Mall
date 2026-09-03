import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  adminCustomerTransferReasonDigest,
  AdminCustomerRepository,
  type AdminCustomerAttributionTransferImpact,
  type AdminCustomerAttributionTransferResult,
  type AdminCustomerBindingHistory,
  type AdminCustomerBindingSnapshot,
  type AdminCustomerDetail,
  type AdminCustomerOrderSummary,
  type AdminCustomerSnapshot,
  AuditRepository,
  type CacheableAdminCustomerResponse,
  type CacheableAdminCustomerView,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, formatVersionEtag } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import type {
  AdminCustomerListInput,
  CustomerTransferConfirmationInput,
  CustomerTransferInput,
} from './admin-customers.dto';
import { adminCustomerRequestIp, type AdminCustomerRequestContext } from './admin-customers.request';

const ROUTES = {
  previewTransfer: '/admin/customers/{customer_id}/attribution-transfer-preview',
  transfer: '/admin/customers/{customer_id}/attribution-transfers',
} as const;

@Injectable()
export class AdminCustomersService {
  private readonly audit!: AuditRepository;
  private readonly customers!: AdminCustomerRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.customers = new AdminCustomerRepository(database.prisma, config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
    }
  }

  async list(input: AdminCustomerListInput) {
    this.runtime();
    const result = await this.customers.listCustomers(input);
    return {
      items: result.items.map((customer) => this.customerView(customer)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async detail(customerId: string) {
    this.runtime();
    return this.detailView(await this.customers.getCustomerDetail(customerId));
  }

  async previewTransfer(
    request: AdminCustomerRequestContext,
    customerId: string,
    input: CustomerTransferInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const requestBody = this.transferRequestBody(input);
    const claim = this.claim(request, customerId, idempotencyKey, ROUTES.previewTransfer, requestBody);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Customer attribution preview must use a new idempotency key');
      }
      const impact = await this.customers.getAttributionTransferImpactInTransaction(transaction, {
        customerId,
        targetAgentId: input.targetAgentId,
      });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.previews.issueInTransaction(transaction, {
        action: 'CUSTOMER.ATTRIBUTION_TRANSFER',
        actorId: request.principal.accountId,
        previewToken,
        request: this.transferPreviewRequest(requestBody, impact),
        resourceVersion: impact.customer.version,
        sessionId: request.accessSession.sessionId,
        targetId: customerId,
        targetType: 'CUSTOMER',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: this.impactView(impact),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(impact.customer.version),
      };
      await this.idempotency.complete(transaction, claim, {
        resourceId: customerId,
        responseForHash: {
          confirmation_hash: response.confirmation_hash,
          expires_at: response.expires_at,
          impact: response.impact,
          resource_etag: response.resource_etag,
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  async transfer(
    request: AdminCustomerRequestContext,
    customerId: string,
    input: CustomerTransferConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const requestBody = this.transferRequestBody(input);
    const claim = this.claim(request, customerId, idempotencyKey, ROUTES.transfer, {
      ...requestBody,
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
    });
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const replay = this.idempotency.adminCustomerReplay(claimed.record);
        if (replay.data.customer_id !== customerId) {
          throw new ApplicationError('INTERNAL_ERROR', 'Admin customer replay target is invalid');
        }
        return preEnvelopedResponse(replay);
      }
      await this.idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST',
        route: ROUTES.previewTransfer,
      });
      const impact = await this.customers.getAttributionTransferImpactInTransaction(transaction, {
        customerId,
        targetAgentId: input.targetAgentId,
      });
      await this.previews.consumeInTransaction(transaction, {
        action: 'CUSTOMER.ATTRIBUTION_TRANSFER',
        actorId: request.principal.accountId,
        confirmationHash: input.confirmationHash,
        previewToken: input.previewToken,
        request: this.transferPreviewRequest(requestBody, impact),
        resourceVersion: expectedVersion,
        sessionId: request.accessSession.sessionId,
        targetId: customerId,
        targetType: 'CUSTOMER',
      });
      const result = await this.customers.transferAttributionInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        customerId,
        expectedVersion,
        reason: input.reason,
        targetAgentId: input.targetAgentId,
      });
      const response = this.customerResponse(request.requestId, result.customer);
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        expectedVersion,
        result,
        adminCustomerTransferReasonDigest(input.reason, this.runtime().config.encryption.ipHashKey),
      );
      await this.appendOutbox(transaction, result);
      await this.idempotency.complete(transaction, claim, {
        policy: 'ADMIN_CUSTOMER_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) {
      throw new ApplicationError('INTERNAL_ERROR', 'Admin customer runtime is unavailable');
    }
    return { config: this.config, database: this.database };
  }

  private customerView(customer: AdminCustomerSnapshot): CacheableAdminCustomerView {
    return {
      account_status: customer.accountStatus,
      binding: customer.currentBinding === null ? null : this.bindingView(customer.currentBinding),
      city: customer.city,
      consumption_amount: customer.consumptionAmount,
      consumption_count: customer.consumptionCount,
      customer_alias: customer.customerAlias,
      customer_id: customer.customerId,
      deletion_request_status: customer.deletionRequestStatus,
      last_order_id: customer.lastOrderId,
      last_product_name: customer.lastProductName,
      last_purchase_at: customer.lastPurchaseAt?.toISOString() ?? null,
      management_note_present: customer.managementNotePresent,
      nickname_masked: customer.nicknameMasked,
      phone_masked: customer.phoneMasked,
      registered_at: customer.registeredAt.toISOString(),
      version: customer.version,
    };
  }

  private bindingView(binding: AdminCustomerBindingSnapshot) {
    return {
      agent_id: binding.agentId,
      agent_name: binding.agentName,
      binding_id: binding.bindingId,
      customer_id: binding.customerId,
      customer_version: binding.customerVersion,
      started_at: binding.startedAt.toISOString(),
    };
  }

  private detailView(detail: AdminCustomerDetail) {
    return {
      binding_history: detail.bindingHistory.map((binding) => this.bindingHistoryView(binding)),
      customer: this.customerView(detail.customer),
      orders: detail.orders.map((order) => this.orderView(order)),
    };
  }

  private bindingHistoryView(binding: AdminCustomerBindingHistory) {
    return {
      agent_id: binding.agentId,
      agent_name: binding.agentName,
      binding_id: binding.bindingId,
      change_reason: binding.changeReason,
      ended_at: binding.endedAt?.toISOString() ?? null,
      end_reason: binding.endReason,
      recorded_at: binding.recordedAt.toISOString(),
      started_at: binding.startedAt.toISOString(),
    };
  }

  private orderView(order: AdminCustomerOrderSummary) {
    return {
      display_status: order.displayStatus,
      order_id: order.orderId,
      order_no: order.orderNo,
      paid_at: order.paidAt?.toISOString() ?? null,
      payable_amount: order.payableAmount,
    };
  }

  private impactView(impact: AdminCustomerAttributionTransferImpact) {
    const currentAttribution = impact.currentBinding?.agentName ?? '直营';
    const targetAttribution = impact.targetAgent?.agentName ?? '直营';
    return {
      affected_count: 1 + impact.activeCandidateCount,
      metrics: [
        this.metric('current_attribution', '当前归属', currentAttribution, targetAttribution),
        this.metric('eligible_candidates', '可归因候选', impact.activeCandidateCount, 0),
        this.metric('pending_payment_orders', '既有待付款订单', impact.pendingOrderCount, impact.pendingOrderCount),
        this.metric('historical_paid_orders', '历史已支付订单', impact.paidOrderCount, impact.paidOrderCount),
      ],
      warnings: [
        '与订单提交按绑定版本串行；先提交的既有订单保留候选，转移后新订单使用新归属。',
        '支付归属快照、历史订单和历史佣金保持不变。',
      ],
    };
  }

  private metric(key: string, label: string, before: number | string, after: number | string) {
    return { after: String(after), before: String(before), key, label };
  }

  private customerResponse(requestId: string, customer: AdminCustomerSnapshot): CacheableAdminCustomerResponse {
    return {
      code: 'OK',
      data: this.customerView(customer),
      message: 'success',
      request_id: requestId,
    };
  }

  private transferRequestBody(input: CustomerTransferInput) {
    return { reason: input.reason, target_agent_id: input.targetAgentId };
  }

  private transferPreviewRequest(
    request: ReturnType<AdminCustomersService['transferRequestBody']>,
    impact: AdminCustomerAttributionTransferImpact,
  ) {
    return {
      ...request,
      impact: {
        active_candidate_count: impact.activeCandidateCount,
        paid_order_count: impact.paidOrderCount,
        pending_order_count: impact.pendingOrderCount,
      },
    };
  }

  private claim(
    request: AdminCustomerRequestContext,
    customerId: string,
    idempotencyKey: string,
    route: string,
    body: unknown,
  ): IdempotencyClaim {
    return {
      actorId: request.principal.accountId,
      idempotencyKey,
      request: {
        body,
        method: 'POST',
        pathParameters: { customer_id: customerId },
        route,
      },
    };
  }

  private appendAudit(
    transaction: DatabaseTransaction,
    request: AdminCustomerRequestContext,
    idempotencyKey: string,
    expectedVersion: number,
    result: AdminCustomerAttributionTransferResult,
    reason: string,
  ) {
    const ipAddress = adminCustomerRequestIp(request);
    return this.audit.append(transaction, {
      action: 'TRANSFER',
      actorAccountId: request.principal.accountId,
      actorRole: 'SUPER_ADMIN',
      after: { version: result.customer.version },
      before: { version: expectedVersion },
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'attribution',
      objectId: result.customer.customerId,
      objectType: 'customer',
      reason,
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendOutbox(
    transaction: DatabaseTransaction,
    result: AdminCustomerAttributionTransferResult,
  ) {
    return this.outbox.append(transaction, {
      aggregateId: result.customer.customerId,
      aggregateType: 'customer',
      eventType: 'customer.attribution_changed',
      payload: {
        event_version: 1,
        resource_id: result.customer.customerId,
        resource_type: 'customer',
        resource_version: result.customer.version,
      },
    });
  }
}
