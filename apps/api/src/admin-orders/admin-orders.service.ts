import { createHmac } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type AdminFulfillmentOrderDetail,
  type AdminFulfillmentOrderListItem,
  type DatabaseRuntime,
  type DatabaseTransaction,
  FulfillmentRepository,
} from '@qingxu/database';
import {
  ApplicationError,
  hasPermission,
  isApplicationError,
  projectOrderDisplayStatus,
  verifyStoreOrderAddressSecurityMaterial,
} from '@qingxu/platform-core';

import {
  catalogRequestIp,
  type AdminCatalogRequestContext,
} from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import {
  parseAdminFulfillmentAddressAccessHeaders,
  type AdminOrderListQuery,
} from './admin-orders.dto';

const ADDRESS_ACCESS_PERMISSION = 'ORDER_FULFILLMENT_PII_READ';
const ADDRESS_ACCESS_TTL_MS = 5 * 60 * 1_000;
const ADDRESS_REASON_HMAC_DOMAIN = 'qingxu:fulfillment-address-access-reason:v1\0';

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError(
    'INTERNAL_ERROR',
    message,
    [],
    cause === undefined ? undefined : { cause },
  );
}

function listDisplayStatus(order: AdminFulfillmentOrderListItem): string {
  return projectOrderDisplayStatus(order);
}

function detailDisplayStatus(detail: AdminFulfillmentOrderDetail): string {
  return projectOrderDisplayStatus(detail.order);
}

@Injectable()
export class AdminOrdersService {
  private readonly audit!: AuditRepository;
  private readonly fulfillment!: FulfillmentRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.fulfillment = new FulfillmentRepository(database.prisma, config.encryption.ipHashKey);
    }
  }

  async listOrders(input: AdminOrderListQuery) {
    const result = await this.repository().listAdminOrders(input);
    return {
      items: result.items.map((item) => ({
        agent_id: item.agentId,
        agent_name: item.agentName,
        created_at: item.createdAt.toISOString(),
        customer_alias: item.customerAlias,
        customer_id: item.customerId,
        display_status: listDisplayStatus(item),
        fulfillment_status: item.fulfillmentStatus,
        order_id: item.orderId,
        order_no: item.orderNo,
        order_status: item.orderStatus,
        payable_amount: item.payableAmount,
        payment_status: item.paymentStatus,
        recipient_phone_masked: item.recipientPhoneMasked,
        refund_processing_status: item.refundProcessingStatus,
        refund_progress_status: item.refundProgressStatus,
        version: item.version,
      })),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getOrder(orderId: string) {
    return this.detailView(await this.repository().getAdminOrderDetail({ orderId }));
  }

  async getFulfillmentAddress(
    request: AdminCatalogRequestContext,
    orderId: string,
    purposeValue: unknown,
    reasonValue: unknown,
  ) {
    const reasonDigest = this.accessReasonDigest(reasonValue);
    try {
      if (request.principal.role !== 'SUPER_ADMIN' ||
        !hasPermission(request.principal, ADDRESS_ACCESS_PERMISSION)) {
        throw new ApplicationError('PERMISSION_DENIED', 'Fulfillment address permission is required');
      }
      const access = parseAdminFulfillmentAddressAccessHeaders(purposeValue, reasonValue);
      const { database } = this.runtime();
      return await database.prisma.$transaction(async (transaction) => {
        const material = await this.repository().getAdminFulfillmentAddressMaterialInTransaction(
          transaction,
          { orderId },
        );
        if (!material.eligibleForRead) {
          throw new ApplicationError('STATE_CONFLICT', 'The order no longer requires fulfillment address access');
        }
        let verified: { detail: string; phone: string };
        try {
          verified = verifyStoreOrderAddressSecurityMaterial({
            detailCiphertext: material.detailCiphertext,
            encryptionKeyId: material.encryptionKeyId,
            phoneCiphertext: material.phoneCiphertext,
            phoneLast4: material.phoneLast4,
            snapshotId: material.snapshotId,
          }, this.runtime().config.encryption.fieldKeys);
        } catch (cause) {
          throw internal('Stored order address snapshot is unreadable', cause);
        }
        await this.appendAddressAudit(
          transaction,
          request,
          orderId,
          reasonDigest,
          'SUCCESS',
          'OK',
        );
        const now = new Date();
        return {
          access_expires_at: new Date(now.getTime() + ADDRESS_ACCESS_TTL_MS).toISOString(),
          city: material.city,
          detail: verified.detail,
          district: material.district,
          order_id: material.orderId,
          order_no: material.orderNo,
          phone: verified.phone,
          province: material.province,
          purpose: access.purpose,
          recipient_name: material.recipientName,
          snapshot_at: material.snapshotAt.toISOString(),
          snapshot_id: material.snapshotId,
        };
      }, { isolationLevel: 'RepeatableRead' });
    } catch (cause) {
      const error = isApplicationError(cause)
        ? cause
        : internal('Fulfillment address access failed', cause);
      await this.appendAddressFailure(request, orderId, reasonDigest, error.code);
      throw error;
    }
  }

  private detailView(detail: AdminFulfillmentOrderDetail) {
    const order = detail.order;
    const paymentAttempts = detail.paymentAttempts.map((attempt) => ({
      amount: attempt.amount,
      created_at: attempt.createdAt.toISOString(),
      intent_no: attempt.intentNo,
      last_error: this.safeAttemptError(attempt.failureCode, attempt.updatedAt),
      payment_attempt_id: attempt.paymentAttemptId,
      provider_transaction_id_masked: attempt.providerTransactionIdMasked,
      status: attempt.status,
      updated_at: attempt.updatedAt.toISOString(),
    }));
    const refundAttempts = detail.refundAttempts.map((attempt) => ({
      amount: attempt.amount,
      attempt_no: attempt.attemptNo,
      created_at: attempt.createdAt.toISOString(),
      last_error: this.safeAttemptError(attempt.failureCode, attempt.updatedAt),
      origin_type: attempt.originType,
      refund_id: attempt.refundId,
      refund_no: attempt.refundNo,
      status: attempt.status,
      updated_at: attempt.updatedAt.toISOString(),
    }));
    const timeline = this.timeline(detail);
    const packages = detail.shipment === null ? [] : [{
      carrier_name: detail.shipment.carrierName,
      delivered_at: detail.shipment.deliveredAt?.toISOString() ?? null,
      events: detail.shipment.events.map((event) => ({
        carrier_code: event.carrierCode,
        carrier_name: event.carrierName,
        description: event.description,
        event_id: event.eventId,
        event_key: event.eventKey,
        event_type: event.eventType,
        location: event.location,
        occurred_at: event.occurredAt.toISOString(),
        reason: event.reason,
        status_code: event.statusCode,
        tracking_no: event.trackingNo,
      })),
      items: detail.shipment.items.map((item) => ({
        order_item_id: item.orderItemId,
        product_name: item.productName,
        quantity: item.quantity,
        sku_id: item.skuId,
        sku_name: item.skuName,
      })),
      shipment_id: detail.shipment.shipmentId,
      shipped_at: detail.shipment.shippedAt.toISOString(),
      status: detail.shipment.status,
      tracking_no: detail.shipment.trackingNo,
    }];
    return {
      aftersales: detail.aftersales.map((aftersale) => {
        if (aftersale.type === 'AMOUNT_COMPENSATION') {
          throw internal('Stored order aftersale type is not public');
        }
        return {
          aftersale_id: aftersale.aftersaleId,
          aftersale_no: aftersale.aftersaleNo,
          created_at: aftersale.createdAt.toISOString(),
          requested_amount: aftersale.requestedAmount,
          status: aftersale.status,
          type: aftersale.type,
        };
      }),
      amounts: order.amounts,
      attribution: {
        agent_id: detail.attribution.agentId,
        agent_name: detail.attribution.agentName,
        frozen_at: detail.attribution.frozenAt?.toISOString() ?? null,
        source: detail.attribution.source,
      },
      available_actions: this.availableActions(detail),
      close_reason: order.closeReason,
      commission_impact: detail.commissionImpact.map((impact) => ({
        commission_snapshot_id: impact.commissionSnapshotId,
        expected_remaining: impact.expectedRemaining,
        latest_state: impact.latestState,
        order_item_id: impact.orderItemId,
        original_commission: impact.originalCommission,
        reversed_total: impact.reversedTotal,
      })),
      completion_reason: order.completionReason,
      customer: {
        customer_alias: detail.customer.customerAlias,
        customer_id: detail.customer.customerId,
        nickname_masked: detail.customer.nicknameMasked,
        phone_masked: detail.customer.phoneMasked,
      },
      display_status: detailDisplayStatus(detail),
      errors: [
        ...paymentAttempts.map(({ last_error }) => last_error),
        ...refundAttempts.map(({ last_error }) => last_error),
      ].filter((error): error is NonNullable<typeof error> => error !== null),
      fulfillment_status: order.fulfillmentStatus,
      inventory_impact: detail.inventoryImpact.map((impact) => ({
        available_change: impact.availableChange,
        on_hand_change: impact.onHandChange,
        reason: impact.reasons.join(',') || 'ORDER_FULFILLMENT',
        reserved_change: impact.reservedChange,
        sku_id: impact.skuId,
      })),
      items: order.items.map((item) => ({
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
      })),
      order_id: order.orderId,
      order_no: order.orderNo,
      order_status: order.orderStatus,
      packages,
      pay_expires_at: order.payExpiresAt.toISOString(),
      payment_attempts: paymentAttempts,
      payment_resolution: order.paymentResolution,
      payment_status: order.paymentStatus,
      refund_attempts: refundAttempts,
      refund_processing_status: order.refundProcessingStatus,
      refund_progress_status: order.refundProgressStatus,
      shipping_address_masked: {
        detail_masked: detail.addressMasked.detailMasked,
        phone_masked: detail.addressMasked.phoneMasked,
        recipient_name_masked: detail.addressMasked.recipientNameMasked,
        region_summary: detail.addressMasked.regionSummary,
      },
      timeline,
      version: order.version,
    };
  }

  private availableActions(detail: AdminFulfillmentOrderDetail) {
    const actions: Array<
      | 'ADD_LOGISTICS_EVENT'
      | 'COMPLETE'
      | 'READ_FULFILLMENT_ADDRESS'
      | 'RECONCILE_PAYMENT'
      | 'RETRY_REFUND'
      | 'SHIP'
    > = [];
    if (detail.eligibility.canShip) actions.push('SHIP');
    if (detail.eligibility.canAddLogisticsEvent) actions.push('ADD_LOGISTICS_EVENT');
    if (detail.eligibility.canComplete) actions.push('COMPLETE');
    if (detail.eligibility.hasUnresolvedPayment || detail.order.paymentStatus === 'PROCESSING') {
      actions.push('RECONCILE_PAYMENT');
    }
    if (detail.refundAttempts.some(({ status }) => status === 'FAILED') ||
      detail.order.refundProcessingStatus === 'FAILED') actions.push('RETRY_REFUND');
    if (detail.eligibility.canReadFulfillmentAddress) actions.push('READ_FULFILLMENT_ADDRESS');
    return actions;
  }

  private timeline(detail: AdminFulfillmentOrderDetail) {
    const events: Array<{
      axis: 'AFTERSALE' | 'FULFILLMENT' | 'ORDER' | 'PAYMENT' | 'REFUND';
      event: string;
      event_id: string;
      from_status: string | null;
      occurred_at: string;
      to_status: string;
    }> = [{
      axis: 'ORDER',
      event: 'ORDER_CREATED',
      event_id: `${detail.order.orderId}:created`,
      from_status: null,
      occurred_at: detail.order.createdAt.toISOString(),
      to_status: 'PENDING_PAYMENT',
    }];
    for (const attempt of detail.paymentAttempts) {
      events.push({
        axis: 'PAYMENT',
        event: `PAYMENT_${attempt.status}`,
        event_id: attempt.paymentAttemptId,
        from_status: attempt.status === 'INITIATED' ? null : 'INITIATED',
        occurred_at: attempt.updatedAt.toISOString(),
        to_status: attempt.status,
      });
    }
    for (const attempt of detail.refundAttempts) {
      events.push({
        axis: 'REFUND',
        event: `REFUND_${attempt.status}`,
        event_id: `${attempt.refundId}:${attempt.attemptNo}`,
        from_status: attempt.status === 'INITIATED' ? null : 'INITIATED',
        occurred_at: attempt.updatedAt.toISOString(),
        to_status: attempt.status,
      });
    }
    for (const aftersale of detail.aftersales) {
      events.push({
        axis: 'AFTERSALE',
        event: `AFTERSALE_${aftersale.status}`,
        event_id: aftersale.aftersaleId,
        from_status: null,
        occurred_at: aftersale.createdAt.toISOString(),
        to_status: aftersale.status,
      });
    }
    if (detail.shipment !== null) {
      events.push({
        axis: 'FULFILLMENT',
        event: 'SHIPMENT_SHIPPED',
        event_id: `${detail.shipment.shipmentId}:shipped`,
        from_status: 'READY_TO_SHIP',
        occurred_at: detail.shipment.shippedAt.toISOString(),
        to_status: 'SHIPPED',
      });
      for (const event of detail.shipment.events) {
        events.push({
          axis: 'FULFILLMENT',
          event: event.eventType === 'STATUS' ? `SHIPMENT_${event.statusCode}` : 'TRACKING_CORRECTION',
          event_id: event.eventId,
          from_status: null,
          occurred_at: event.occurredAt.toISOString(),
          to_status: event.statusCode ?? detail.shipment.status,
        });
      }
    }
    if (detail.order.closedAt !== null) {
      events.push({
        axis: 'ORDER',
        event: detail.order.closeReason ?? 'ORDER_CLOSED',
        event_id: `${detail.order.orderId}:closed`,
        from_status: null,
        occurred_at: detail.order.closedAt.toISOString(),
        to_status: 'CLOSED',
      });
    }
    if (detail.order.completedAt !== null) {
      events.push({
        axis: 'ORDER',
        event: detail.order.completionReason ?? 'ORDER_COMPLETED',
        event_id: `${detail.order.orderId}:completed`,
        from_status: 'SHIPPING',
        occurred_at: detail.order.completedAt.toISOString(),
        to_status: 'COMPLETED',
      });
    }
    return events.sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) ||
      left.event_id.localeCompare(right.event_id));
  }

  private safeAttemptError(code: string | null, occurredAt: Date) {
    if (code === null) return null;
    const retryable = code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_UNKNOWN' ||
      code === 'INVALID_PROVIDER_STATE';
    return {
      error_code: code,
      message: retryable ? '支付服务暂未确认结果，请稍后刷新' : '支付或退款未能完成',
      occurred_at: occurredAt.toISOString(),
      retryable,
    };
  }

  private accessReasonDigest(value: unknown): string {
    const reason = typeof value === 'string' ? value.trim() : '[invalid]';
    return `ORDER_FULFILLMENT:${createHmac('sha256', Buffer.from(this.runtime().config.encryption.ipHashKey))
      .update(ADDRESS_REASON_HMAC_DOMAIN, 'utf8')
      .update(reason, 'utf8')
      .digest('hex')}`;
  }

  private appendAddressAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    orderId: string,
    reason: string,
    result: 'FAILURE' | 'SUCCESS',
    resultCode: Parameters<AuditRepository['append']>[1]['resultCode'],
  ) {
    const ipAddress = catalogRequestIp(request);
    return this.auditRepository().append(transaction, {
      action: 'READ_SENSITIVE',
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'fulfillment',
      objectId: orderId,
      objectType: 'order',
      reason,
      requestId: request.requestId,
      result,
      ...(resultCode === undefined ? {} : { resultCode }),
      summaryPolicy: 'NONE',
    });
  }

  async appendAddressFailure(
    request: AdminCatalogRequestContext,
    orderId: string,
    reason: string,
    resultCode: NonNullable<Parameters<AuditRepository['append']>[1]['resultCode']>,
  ): Promise<void> {
    const { database } = this.runtime();
    try {
      await database.prisma.$transaction((transaction) => this.appendAddressAudit(
        transaction,
        request,
        orderId,
        reason,
        'FAILURE',
        resultCode,
      ));
    } catch (cause) {
      throw internal('Fulfillment address failure audit could not be persisted', cause);
    }
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) throw internal('Admin order runtime is unavailable');
    return { config: this.config, database: this.database };
  }

  private repository(): FulfillmentRepository {
    if (!this.fulfillment) throw internal('Fulfillment repository is unavailable');
    return this.fulfillment;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw internal('Fulfillment audit repository is unavailable');
    return this.audit;
  }
}
