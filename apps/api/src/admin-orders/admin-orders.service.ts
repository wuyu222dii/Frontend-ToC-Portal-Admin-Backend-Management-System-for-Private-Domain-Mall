import { createHmac } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type AppendFulfillmentLogisticsEventInput,
  type AdminFulfillmentOrderDetail,
  type AdminFulfillmentOrderListItem,
  type CreateFulfillmentShipmentInput,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type FulfillmentShipmentProjection,
  FulfillmentRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import {
  ApplicationError,
  generateUlid,
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
import { FulfillmentCompletionService } from '../fulfillment/fulfillment-completion.service';
import {
  parseAdminFulfillmentAddressAccessHeaders,
  type AdminCompleteOrderInput,
  type AdminCreateShipmentInput,
  type AdminLogisticsEventInput,
  type AdminOrderListQuery,
} from './admin-orders.dto';

const ADDRESS_ACCESS_PERMISSION = 'ORDER_FULFILLMENT_PII_READ';
const ADDRESS_ACCESS_TTL_MS = 5 * 60 * 1_000;
const ADDRESS_REASON_HMAC_DOMAIN = 'qingxu:fulfillment-address-access-reason:v1\0';
const LOGISTICS_EVENT_KEY_HMAC_DOMAIN = 'qingxu:fulfillment-logistics-event:v1\0';
const LOGISTICS_REASON_HMAC_DOMAIN = 'qingxu:fulfillment-logistics-reason:v1\0';
const ROUTES = {
  logisticsEvent: '/admin/shipments/{shipment_id}/events',
  shipment: '/admin/orders/{order_id}/shipments',
} as const;

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
  private readonly completion!: FulfillmentCompletionService;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.fulfillment = new FulfillmentRepository(database.prisma, config.encryption.ipHashKey);
      this.completion = new FulfillmentCompletionService(config, database);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
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

  async completeOrder(
    request: AdminCatalogRequestContext,
    orderId: string,
    input: AdminCompleteOrderInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const ipAddress = catalogRequestIp(request);
    await this.completionService().completeAdmin({
      actorAccountId: request.principal.accountId,
      expectedOrderVersion: expectedVersion,
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      orderId,
      reason: input.reason,
      requestId: request.requestId,
    });
    return this.getOrder(orderId);
  }

  createShipment(
    request: AdminCatalogRequestContext,
    orderId: string,
    input: AdminCreateShipmentInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const shipmentId = generateUlid();
    const command: CreateFulfillmentShipmentInput = {
      actorAccountId: request.principal.accountId,
      carrierCode: input.carrierCode,
      carrierName: input.carrierName,
      expectedOrderVersion: expectedVersion,
      items: input.items.map((item) => ({
        ...item,
        shipmentItemId: generateUlid(),
      })),
      orderId,
      shipmentId,
      trackingNo: input.trackingNo,
    };
    const claim = this.claim(request, idempotencyKey, ROUTES.shipment, {
      carrier_code: input.carrierCode,
      carrier_name: input.carrierName,
      expected_version: expectedVersion,
      items: input.items.map(({ orderItemId, quantity }) => ({
        order_item_id: orderItemId,
        quantity,
      })),
      tracking_no: input.trackingNo,
    }, { order_id: orderId });
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Shipment replay resource is missing');
        const shipment = await this.repository().getAdminShipmentInTransaction(transaction, {
          orderId,
          shipmentId: resourceId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId,
          responseForHash: this.shipmentIdempotencyResponse(orderId, resourceId),
          responseStatus: 201,
          storage: 'HASH_ONLY',
        });
        return this.shipmentView(shipment);
      }

      const result = await this.repository().createShipmentInTransaction(transaction, command);
      if (result.kind === 'created') {
        await this.appendShipmentAudit(
          transaction,
          request,
          idempotencyKey,
          result.shipment.shipmentId,
          'CREATE',
          undefined,
          { status: result.shipment.status, version: result.shipment.version },
        );
        await this.appendShipmentOutbox(transaction, result.shipment, 'shipment.created');
      }
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: result.shipment.shipmentId,
        responseForHash: this.shipmentIdempotencyResponse(orderId, result.shipment.shipmentId),
        responseStatus: 201,
        storage: 'HASH_ONLY',
      });
      return this.shipmentView(result.shipment);
    });
  }

  appendLogisticsEvent(
    request: AdminCatalogRequestContext,
    shipmentId: string,
    input: AdminLogisticsEventInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const eventKey = this.logisticsEventKey(request.principal.accountId, shipmentId, idempotencyKey);
    const claim = this.claim(request, idempotencyKey, ROUTES.logisticsEvent, {
      ...this.logisticsEventRequest(input),
      expected_version: expectedVersion,
    }, { shipment_id: shipmentId });
    const command: AppendFulfillmentLogisticsEventInput = {
      actorAccountId: request.principal.accountId,
      event: this.logisticsEventCommand(input),
      eventId: generateUlid(),
      eventKey,
      expectedShipmentVersion: expectedVersion,
      shipmentId,
    };
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.resource_id !== shipmentId) {
          throw internal('Logistics event replay resource is invalid');
        }
        const shipment = await this.repository().getAdminShipmentInTransaction(transaction, { shipmentId });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: shipmentId,
          responseForHash: this.logisticsIdempotencyResponse(shipmentId),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return this.logisticsView(shipment);
      }

      const result = await this.repository().appendLogisticsEventInTransaction(transaction, command);
      if (result.kind === 'applied') {
        await this.appendShipmentAudit(
          transaction,
          request,
          idempotencyKey,
          result.shipment.shipmentId,
          'UPDATE',
          { status: input.eventType === 'STATUS' ? this.previousShipmentStatus(input.statusCode) : result.shipment.status,
            version: expectedVersion },
          { status: result.shipment.status, version: result.shipment.version },
          input.eventType === 'TRACKING_CORRECTION'
            ? this.logisticsReasonDigest(input.reason)
            : undefined,
        );
        await this.appendShipmentOutbox(transaction, result.shipment, 'shipment.updated');
      }
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: shipmentId,
        responseForHash: this.logisticsIdempotencyResponse(shipmentId),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return this.logisticsView(result.shipment);
    });
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

  private shipmentView(shipment: FulfillmentShipmentProjection) {
    return {
      carrier_code: shipment.carrierCode,
      carrier_name: shipment.carrierName,
      delivered_at: shipment.deliveredAt?.toISOString() ?? null,
      items: shipment.items.map((item) => ({
        order_item_id: item.orderItemId,
        quantity: item.quantity,
      })),
      order_id: shipment.orderId,
      shipment_id: shipment.shipmentId,
      shipped_at: shipment.shippedAt.toISOString(),
      status: shipment.status,
      tracking_no: shipment.trackingNo,
      version: shipment.version,
    };
  }

  private logisticsView(shipment: FulfillmentShipmentProjection) {
    return {
      events: shipment.events.map((event) => ({
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
      shipment: this.shipmentView(shipment),
    };
  }

  private claim(
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    route: string,
    body: unknown,
    pathParameters: Record<string, string>,
  ): IdempotencyClaim {
    return {
      actorId: request.principal.accountId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters, route },
    };
  }

  private logisticsEventRequest(input: AdminLogisticsEventInput) {
    const base = {
      description: input.description,
      event_type: input.eventType,
      location: input.location,
      occurred_at: input.occurredAt,
    };
    return input.eventType === 'STATUS'
      ? { ...base, status_code: input.statusCode }
      : {
          ...base,
          carrier_code: input.carrierCode,
          carrier_name: input.carrierName,
          reason: input.reason,
          tracking_no: input.trackingNo,
        };
  }

  private logisticsEventCommand(
    input: AdminLogisticsEventInput,
  ): AppendFulfillmentLogisticsEventInput['event'] {
    const base = {
      description: input.description,
      location: input.location,
      occurredAt: new Date(input.occurredAt),
    };
    return input.eventType === 'STATUS'
      ? { ...base, eventType: 'STATUS', statusCode: input.statusCode }
      : {
          ...base,
          carrierCode: input.carrierCode,
          carrierName: input.carrierName,
          eventType: 'TRACKING_CORRECTION',
          reason: input.reason,
          trackingNo: input.trackingNo,
        };
  }

  private logisticsEventKey(accountId: string, shipmentId: string, idempotencyKey: string): string {
    const key = this.runtime().config.encryption.idempotencyHashKeys.current.key;
    return `evt_${createHmac('sha256', Buffer.from(key))
      .update(LOGISTICS_EVENT_KEY_HMAC_DOMAIN, 'utf8')
      .update(JSON.stringify([accountId, shipmentId, idempotencyKey]), 'utf8')
      .digest('hex')}`;
  }

  private logisticsReasonDigest(reason: string): string {
    return `TRACKING_CORRECTION:${createHmac(
      'sha256',
      Buffer.from(this.runtime().config.encryption.ipHashKey),
    )
      .update(LOGISTICS_REASON_HMAC_DOMAIN, 'utf8')
      .update(reason, 'utf8')
      .digest('hex')}`;
  }

  private previousShipmentStatus(status: 'DELIVERED' | 'IN_TRANSIT'): 'IN_TRANSIT' | 'SHIPPED' {
    return status === 'DELIVERED' ? 'IN_TRANSIT' : 'SHIPPED';
  }

  private shipmentIdempotencyResponse(orderId: string, shipmentId: string) {
    return { shipment_created: { order_id: orderId, shipment_id: shipmentId } };
  }

  private logisticsIdempotencyResponse(shipmentId: string) {
    return { logistics_event_appended: { shipment_id: shipmentId } };
  }

  private appendShipmentAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    shipmentId: string,
    action: 'CREATE' | 'UPDATE',
    before: { status: string; version: number } | undefined,
    after: { status: string; version: number },
    reason?: string,
  ) {
    const ipAddress = catalogRequestIp(request);
    return this.auditRepository().append(transaction, {
      action,
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after,
      ...(before === undefined ? {} : { before }),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'fulfillment',
      objectId: shipmentId,
      objectType: 'shipment',
      ...(reason === undefined ? {} : { reason }),
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendShipmentOutbox(
    transaction: DatabaseTransaction,
    shipment: FulfillmentShipmentProjection,
    eventType: 'shipment.created' | 'shipment.updated',
  ) {
    return this.outboxRepository().append(transaction, {
      aggregateId: shipment.shipmentId,
      aggregateType: 'shipment',
      eventType,
      payload: {
        event_version: 1,
        resource_id: shipment.shipmentId,
        resource_type: 'shipment',
        resource_version: shipment.version,
      },
    });
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

  private completionService(): FulfillmentCompletionService {
    if (!this.completion) throw internal('Fulfillment completion service is unavailable');
    return this.completion;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw internal('Fulfillment audit repository is unavailable');
    return this.audit;
  }

  private idempotencyRepository(): IdempotencyRepository {
    if (!this.idempotency) throw internal('Fulfillment idempotency repository is unavailable');
    return this.idempotency;
  }

  private outboxRepository(): OutboxRepository {
    if (!this.outbox) throw internal('Fulfillment outbox repository is unavailable');
    return this.outbox;
  }
}
