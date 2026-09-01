import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  FulfillmentRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
  type StoreCheckoutAddressFact,
  type StoreOrderCloseResult,
  type StoreOrderDetailSnapshot,
  type StoreOrderListItemSnapshot,
  type OwnedFulfillmentProjection,
  StoreOrderRepository,
  type StoreOrderSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  createStoreOrderAddressSecurityMaterial,
  projectOrderDisplayStatus,
  type OrderDisplayStatus,
  verifyStoreAddressSecurityMaterial,
  verifyStoreOrderAddressSecurityMaterial,
} from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import { FulfillmentCompletionService } from '../fulfillment/fulfillment-completion.service';
import {
  storeCheckoutQuoteFactBinding,
  storeCheckoutQuoteRequestBinding,
} from '../store-checkout/store-checkout.service';
import { StoreCheckoutQuoteCredential } from '../store-checkout/store-checkout-quote-credential';
import { StorePaymentsService } from '../store-payments/store-payments.service';
import type { StoreOrderListQuery, StoreOrderSubmitRequest } from './store-orders.dto';

/** Internal, non-serialized marker consumed only by StoreOrdersController. */
export const STORE_ORDER_HTTP_STATUS = Symbol('STORE_ORDER_HTTP_STATUS');

const ORDER_COLLECTION_ROUTE = '/store/orders';
const ORDER_CANCEL_ROUTE = '/store/orders/{order_id}/cancel';

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError(
    'INTERNAL_ERROR',
    message,
    [],
    cause === undefined ? undefined : { cause },
  );
}

export function storeOrderDisplayStatus(order: StoreOrderSnapshot): OrderDisplayStatus {
  return projectOrderDisplayStatus(order);
}

@Injectable()
export class StoreOrdersService {
  private readonly fulfillment!: FulfillmentRepository;
  private readonly completion!: FulfillmentCompletionService;
  private readonly orders!: StoreOrderRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly credentials!: StoreCheckoutQuoteCredential;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
    @Optional() @Inject(StorePaymentsService) private readonly payments?: StorePaymentsService,
  ) {
    if (config && database) {
      this.fulfillment = new FulfillmentRepository(database.prisma);
      this.completion = new FulfillmentCompletionService(config, database);
      this.orders = new StoreOrderRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.credentials = new StoreCheckoutQuoteCredential(config.encryption.idempotencyHashKeys);
    }
  }

  async listOrders(session: CurrentStoreSession, query: StoreOrderListQuery) {
    const resource = await this.databaseRuntime().prisma.$transaction(
      async (transaction: DatabaseTransaction) => {
        const result = await this.repository().listOwnedOrdersInTransaction(transaction, {
          customerId: session.customerId,
          ...query,
        });
        const fulfillment = await this.fulfillmentRepository()
          .listOwnedFulfillmentProjectionsInTransaction(transaction, {
            customerId: session.customerId,
            orderIds: result.items.map(({ order }) => order.orderId),
          });
        return { fulfillment, result };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: resource.result.items.map((item) => {
        const fulfillment = resource.fulfillment.get(item.order.orderId);
        if (fulfillment === undefined) {
          throw internal('Owned order fulfillment projection is unavailable');
        }
        return this.listItemView(item, fulfillment);
      }),
      pagination: { page: query.page, page_size: query.pageSize, total: resource.result.total },
    };
  }

  async getOrder(session: CurrentStoreSession, orderId: string) {
    const resource = await this.databaseRuntime().prisma.$transaction(
      async (transaction: DatabaseTransaction) => {
        const [detail, fulfillment] = await Promise.all([
          this.repository().getOwnedOrderDetailInTransaction(transaction, {
            customerId: session.customerId,
            orderId,
          }),
          this.fulfillmentRepository().getOwnedFulfillmentProjectionInTransaction(transaction, {
            customerId: session.customerId,
            orderId,
          }),
        ]);
        return { detail, fulfillment };
      },
      { isolationLevel: 'RepeatableRead' },
    );
    return this.detailView(resource.detail, resource.fulfillment);
  }

  async getLogistics(session: CurrentStoreSession, orderId: string) {
    const fulfillment = await this.fulfillmentRepository().getOwnedFulfillmentProjection({
      customerId: session.customerId,
      orderId,
    });
    return this.logisticsView(fulfillment);
  }

  async confirmReceipt(
    session: CurrentStoreSession,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    await this.completionService().confirmCustomer({
      accountId: session.accountId,
      customerId: session.customerId,
      expectedOrderVersion: expectedVersion,
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      orderId,
      requestId,
    });
    return this.getOrder(session, orderId);
  }

  createOrder(
    session: CurrentStoreSession,
    input: StoreOrderSubmitRequest,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.createClaim(session.accountId, input, idempotencyKey);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Store order idempotency record has no resource');
        const order = await this.repository().getOwnedOrderForReplayInTransaction(transaction, {
          accountId: session.accountId,
          customerId: session.customerId,
          orderId: resourceId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: order.orderId,
          responseForHash: this.idempotencyResponse(order),
          responseStatus: 201,
          storage: 'HASH_ONLY',
        });
        return this.orderView(order);
      }

      this.credential().authenticate({
        confirmationHash: input.confirmationHash,
        customerId: session.customerId,
        quoteId: input.quoteId,
        quoteToken: input.quoteToken,
        request: storeCheckoutQuoteRequestBinding(input),
        sessionId: session.sessionId,
      });
      const result = await this.repository().createOrderInTransaction(
        transaction,
        {
          accountId: session.accountId,
          addressId: input.addressId,
          customerId: session.customerId,
          items: input.items,
          source: input.source,
        },
        {
          protectAddress: (snapshotId, address) => this.protectAddress(snapshotId, address),
          verifyQuote: (snapshot) => {
            this.credential().verify({
              confirmationHash: input.confirmationHash,
              customerId: session.customerId,
              facts: storeCheckoutQuoteFactBinding(snapshot),
              quoteId: input.quoteId,
              quoteToken: input.quoteToken,
              request: storeCheckoutQuoteRequestBinding(input),
              sessionId: session.sessionId,
            });
          },
        },
      );
      await this.appendAudit(
        transaction,
        session,
        result.order,
        idempotencyKey,
        requestId,
        ipAddress,
      );
      await this.appendOutbox(transaction, result.order);
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: result.order.orderId,
        responseForHash: this.idempotencyResponse(result.order),
        responseStatus: 201,
        storage: 'HASH_ONLY',
      });
      return this.orderView(result.order);
    });
  }

  async cancelOrder(
    session: CurrentStoreSession,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    // B10.3 uses the shared claim -> Provider -> finalize protocol when the
    // payment module is available. Unit-level callers without that module
    // retain the B9 local close path.
    if (this.payments) {
      const result = await this.payments.requestOrderCancellation(
        session,
        orderId,
        expectedVersion,
        idempotencyKey,
        requestId,
        ipAddress,
      );
      const view = this.orderView(result.order) as Record<string | symbol, unknown>;
      if (result.statusCode !== 200) {
        Object.defineProperty(view, STORE_ORDER_HTTP_STATUS, {
          configurable: false,
          enumerable: false,
          value: result.statusCode,
          writable: false,
        });
      }
      return view;
    }
    const claim = this.cancelClaim(session.accountId, orderId, expectedVersion, idempotencyKey);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId !== orderId) throw internal('Store order cancellation replay resource is invalid');
        const order = await this.repository().getOwnedOrderForReplayInTransaction(transaction, {
          accountId: session.accountId,
          customerId: session.customerId,
          orderId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: orderId,
          responseForHash: this.cancelIdempotencyResponse(orderId),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return this.orderView(order);
      }

      const result = await this.repository().cancelOwnedOrderInTransaction(transaction, {
        accountId: session.accountId,
        customerId: session.customerId,
        expectedVersion,
        orderId,
      });
      if (result.changed) {
        await this.appendCloseAudit(transaction, session, result, idempotencyKey, requestId, ipAddress);
        await this.appendClosedOutbox(transaction, result.order);
      }
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: orderId,
        responseForHash: this.cancelIdempotencyResponse(orderId),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return this.orderView(result.order);
    });
  }

  private protectAddress(
    snapshotId: string,
    address: StoreCheckoutAddressFact,
  ) {
    try {
      const verified = verifyStoreAddressSecurityMaterial({
        addressId: address.addressId,
        detailCiphertext: address.detailCiphertext,
        encryptionKeyId: address.encryptionKeyId,
        phoneCiphertext: address.phoneCiphertext,
        phoneHash: address.phoneHash,
        phoneLast4: address.phoneLast4,
      }, this.runtime().encryption.fieldKeys, this.runtime().store.phoneHashKeys);
      const protectedMaterial = createStoreOrderAddressSecurityMaterial({
        detail: verified.detail,
        phone: verified.phone,
        snapshotId,
      }, this.runtime().encryption.fieldKeys.current);
      return {
        detailCiphertext: protectedMaterial.detailCiphertext,
        encryptionKeyId: protectedMaterial.encryptionKeyId,
        phoneCiphertext: protectedMaterial.phoneCiphertext,
        phoneLast4: protectedMaterial.phoneLast4,
      };
    } catch (cause) {
      throw internal('Stored checkout address material is unreadable', cause);
    }
  }

  private appendAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    order: StoreOrderSnapshot,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.auditRepository().append(transaction, {
      action: 'CREATE',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: { status: order.orderStatus, version: order.version },
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'order',
      objectId: order.orderId,
      objectType: 'order',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendOutbox(transaction: DatabaseTransaction, order: StoreOrderSnapshot) {
    return this.outboxRepository().append(transaction, {
      aggregateId: order.orderId,
      aggregateType: 'order',
      eventType: 'order.created',
      payload: {
        event_version: 1,
        resource_id: order.orderId,
        resource_type: 'order',
        resource_version: order.version,
      },
    });
  }

  private appendCloseAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    result: StoreOrderCloseResult,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.auditRepository().append(transaction, {
      action: 'CANCEL',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: { status: result.order.orderStatus, version: result.order.version },
      before: { status: result.before.orderStatus, version: result.before.version },
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'order',
      objectId: result.order.orderId,
      objectType: 'order',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendClosedOutbox(transaction: DatabaseTransaction, order: StoreOrderSnapshot) {
    return this.outboxRepository().append(transaction, {
      aggregateId: order.orderId,
      aggregateType: 'order',
      eventType: 'order.closed',
      payload: {
        event_version: 1,
        resource_id: order.orderId,
        resource_type: 'order',
        resource_version: order.version,
      },
    });
  }

  private idempotencyResponse(order: Pick<StoreOrderSnapshot, 'orderId' | 'orderNo'>) {
    return { order_created: { order_id: order.orderId, order_no: order.orderNo } };
  }

  private cancelIdempotencyResponse(orderId: string) {
    return { order_closed: { order_id: orderId } };
  }

  private availableActions(
    canPay: boolean,
    canCancel: boolean,
    canApplyAftersale: boolean,
    fulfillment?: OwnedFulfillmentProjection,
  ): Array<'PAY' | 'CANCEL' | 'VIEW_LOGISTICS' | 'CONFIRM_RECEIPT' | 'APPLY_AFTERSALE'> {
    return [
      ...(canPay ? ['PAY' as const] : []),
      ...(canCancel ? ['CANCEL' as const] : []),
      ...(fulfillment?.canViewLogistics === true ? ['VIEW_LOGISTICS' as const] : []),
      ...(fulfillment?.canConfirmReceipt === true ? ['CONFIRM_RECEIPT' as const] : []),
      ...(canApplyAftersale ? ['APPLY_AFTERSALE' as const] : []),
    ];
  }

  private listItemView(
    resource: StoreOrderListItemSnapshot,
    fulfillment: OwnedFulfillmentProjection,
  ) {
    const imageByItem = new Map(resource.itemImages.map(({ objectKey, orderItemId }) => [orderItemId, objectKey]));
    return {
      aftersale_summary: {
        active_count: resource.aftersaleSummary.activeCount,
        latest_aftersale_id: resource.aftersaleSummary.latestAftersaleId,
        latest_status: resource.aftersaleSummary.latestStatus,
        refunded_amount: resource.aftersaleSummary.refundedAmount,
      },
      available_actions: this.availableActions(
        resource.canPay,
        resource.canCancel,
        resource.canApplyAftersale,
        fulfillment,
      ),
      close_reason: resource.order.closeReason,
      completion_reason: resource.order.completionReason,
      created_at: resource.order.createdAt.toISOString(),
      display_status: storeOrderDisplayStatus(resource.order),
      fulfillment_status: resource.order.fulfillmentStatus,
      items: resource.order.items.map((item) => {
        const objectKey = imageByItem.get(item.orderItemId) ?? null;
        return {
          line_amount: item.lineAmount,
          order_item_id: item.orderItemId,
          primary_image_url: objectKey === null ? null : this.objectStorage().publicUrl(objectKey),
          product_id: item.productId,
          product_name: item.productName,
          quantity: item.quantity,
          sku_id: item.skuId,
          sku_name: item.skuName,
        };
      }),
      order_id: resource.order.orderId,
      order_no: resource.order.orderNo,
      order_status: resource.order.orderStatus,
      pay_expires_at: resource.order.payExpiresAt.toISOString(),
      payable_amount: resource.order.amounts.payable,
      payment_resolution: resource.order.paymentResolution,
      payment_status: resource.order.paymentStatus,
      refund_processing_status: resource.order.refundProcessingStatus,
      refund_progress_status: resource.order.refundProgressStatus,
    };
  }

  private detailView(resource: StoreOrderDetailSnapshot, fulfillment: OwnedFulfillmentProjection) {
    let address: { detail: string; phone: string };
    try {
      address = verifyStoreOrderAddressSecurityMaterial({
        detailCiphertext: resource.address.detailCiphertext,
        encryptionKeyId: resource.address.encryptionKeyId,
        phoneCiphertext: resource.address.phoneCiphertext,
        phoneLast4: resource.address.phoneLast4,
        snapshotId: resource.address.snapshotId,
      }, this.runtime().encryption.fieldKeys);
    } catch (cause) {
      throw internal('Stored order address snapshot is unreadable', cause);
    }
    const timeline: Array<{
      axis: 'FULFILLMENT' | 'ORDER' | 'PAYMENT' | 'REFUND';
      event: string;
      event_id: string;
      from_status: string | null;
      occurred_at: string;
      to_status: string;
    }> = [{
      axis: 'ORDER' as const,
      event: 'ORDER_CREATED',
      event_id: `${resource.order.orderId}:created`,
      from_status: null,
      occurred_at: resource.order.createdAt.toISOString(),
      to_status: 'PENDING_PAYMENT',
    }];
    if (resource.closedAt !== null) {
      timeline.push({
        axis: 'ORDER',
        event: resource.order.closeReason ?? 'ORDER_CLOSED',
        event_id: `${resource.order.orderId}:closed`,
        from_status: 'PENDING_PAYMENT',
        occurred_at: resource.closedAt.toISOString(),
        to_status: 'CLOSED',
      });
    }
    const paymentAttempts = resource.paymentAttempts.map((attempt) => ({
      amount: attempt.amount,
      created_at: attempt.createdAt.toISOString(),
      intent_no: attempt.intentNo,
      last_error: this.safeAttemptError(attempt.failureCode, attempt.updatedAt),
      payment_attempt_id: attempt.paymentAttemptId,
      provider_transaction_id_masked: this.maskProviderReference(attempt.providerTransactionId),
      status: attempt.status,
      updated_at: attempt.updatedAt.toISOString(),
    }));
    const refundAttempts = resource.refundAttempts.map((attempt) => ({
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
    for (const attempt of resource.paymentAttempts) {
      timeline.push({
        axis: 'PAYMENT',
        event: `PAYMENT_${attempt.status}`,
        event_id: attempt.paymentAttemptId,
        from_status: attempt.status === 'INITIATED' ? null : 'INITIATED',
        occurred_at: attempt.updatedAt.toISOString(),
        to_status: attempt.status,
      });
    }
    for (const attempt of resource.refundAttempts) {
      timeline.push({
        axis: 'REFUND',
        event: `REFUND_${attempt.status}`,
        event_id: `${attempt.refundId}:${attempt.attemptNo}`,
        from_status: attempt.status === 'INITIATED' ? null : 'INITIATED',
        occurred_at: attempt.updatedAt.toISOString(),
        to_status: attempt.status,
      });
    }
    if (fulfillment.shipment !== null) {
      timeline.push({
        axis: 'FULFILLMENT',
        event: 'SHIPMENT_SHIPPED',
        event_id: `${fulfillment.shipment.shipmentId}:shipped`,
        from_status: 'READY_TO_SHIP',
        occurred_at: fulfillment.shipment.shippedAt.toISOString(),
        to_status: 'SHIPPED',
      });
      for (const event of fulfillment.shipment.events) {
        timeline.push({
          axis: 'FULFILLMENT',
          event: event.eventType === 'STATUS' ? `SHIPMENT_${event.statusCode}` : 'TRACKING_CORRECTION',
          event_id: event.eventId,
          from_status: null,
          occurred_at: event.occurredAt.toISOString(),
          to_status: event.statusCode ?? fulfillment.shipment.status,
        });
      }
    }
    timeline.sort((left, right) => left.occurred_at.localeCompare(right.occurred_at) ||
      left.event_id.localeCompare(right.event_id));
    const errors = [
      ...paymentAttempts.map(({ last_error }) => last_error),
      ...refundAttempts.map(({ last_error }) => last_error),
    ].filter((error): error is NonNullable<typeof error> => error !== null);
    return {
      ...this.orderView(resource.order),
      aftersales: resource.aftersales.map((aftersale) => ({
        aftersale_id: aftersale.aftersaleId,
        aftersale_no: aftersale.aftersaleNo,
        created_at: aftersale.createdAt.toISOString(),
        requested_amount: aftersale.requestedAmount,
        status: aftersale.status,
        type: aftersale.type,
      })),
      available_actions: this.availableActions(
        resource.canPay,
        resource.canCancel,
        resource.canApplyAftersale,
        fulfillment,
      ),
      errors,
      packages: fulfillment.shipment === null ? [] : [{
        carrier_name: fulfillment.shipment.carrierName,
        delivered_at: fulfillment.shipment.deliveredAt?.toISOString() ?? null,
        events: fulfillment.shipment.events.map((event) => ({
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
        items: fulfillment.shipment.items.map((item) => ({
          order_item_id: item.orderItemId,
          product_name: item.productName,
          quantity: item.quantity,
          sku_id: item.skuId,
          sku_name: item.skuName,
        })),
        shipment_id: fulfillment.shipment.shipmentId,
        shipped_at: fulfillment.shipment.shippedAt.toISOString(),
        status: fulfillment.shipment.status,
        tracking_no: fulfillment.shipment.trackingNo,
        version: fulfillment.shipment.version,
      }],
      payment_attempts: paymentAttempts,
      refund_attempts: refundAttempts,
      shipping_address: {
        city: resource.address.city,
        detail: address.detail,
        district: resource.address.district,
        phone: address.phone,
        province: resource.address.province,
        recipient_name: resource.address.recipientName,
      },
      timeline,
      version: resource.order.version,
    };
  }

  private logisticsView(fulfillment: OwnedFulfillmentProjection) {
    const shipment = fulfillment.shipment;
    if (shipment === null) return { events: [], shipment: null };
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
      shipment: {
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
      },
    };
  }

  private maskProviderReference(value: string | null): string | null {
    if (value === null) return null;
    const suffix = Array.from(value).slice(-4).join('');
    return `****${suffix}`;
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

  private orderView(order: StoreOrderSnapshot) {
    return {
      amounts: order.amounts,
      close_reason: order.closeReason,
      completion_reason: order.completionReason,
      display_status: storeOrderDisplayStatus(order),
      fulfillment_status: order.fulfillmentStatus,
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
      pay_expires_at: order.payExpiresAt.toISOString(),
      payment_resolution: order.paymentResolution,
      payment_status: order.paymentStatus,
      refund_processing_status: order.refundProcessingStatus,
      refund_progress_status: order.refundProgressStatus,
      server_time: order.serverTime.toISOString(),
    };
  }

  private createClaim(
    actorId: string,
    input: StoreOrderSubmitRequest,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: {
          address_id: input.addressId,
          confirmation_hash: input.confirmationHash,
          items: input.items.map(({ quantity, skuId }) => ({ quantity, sku_id: skuId })),
          quote_id: input.quoteId,
          quote_token: input.quoteToken,
          source: input.source,
        },
        method: 'POST',
        pathParameters: {},
        route: ORDER_COLLECTION_ROUTE,
      },
    };
  }

  private cancelClaim(
    actorId: string,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: { expected_version: expectedVersion },
        method: 'POST',
        pathParameters: { order_id: orderId },
        route: ORDER_CANCEL_ROUTE,
      },
    };
  }

  private repository(): StoreOrderRepository {
    if (!this.orders) throw internal('Store order repository is unavailable');
    return this.orders;
  }

  private fulfillmentRepository(): FulfillmentRepository {
    if (!this.fulfillment) throw internal('Fulfillment repository is unavailable');
    return this.fulfillment;
  }

  private completionService(): FulfillmentCompletionService {
    if (!this.completion) throw internal('Store order completion service is unavailable');
    return this.completion;
  }

  private idempotencyRepository(): IdempotencyRepository {
    if (!this.idempotency) throw internal('Store order idempotency is unavailable');
    return this.idempotency;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw internal('Store order audit is unavailable');
    return this.audit;
  }

  private outboxRepository(): OutboxRepository {
    if (!this.outbox) throw internal('Store order outbox is unavailable');
    return this.outbox;
  }

  private credential(): StoreCheckoutQuoteCredential {
    if (!this.credentials) throw internal('Store order quote credential is unavailable');
    return this.credentials;
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw internal('Store order runtime is unavailable');
    return this.config;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw internal('Store order database is unavailable');
    return this.database;
  }

  private objectStorage(): ObjectStoragePort {
    if (!this.storage) throw internal('Store order object storage is unavailable');
    return this.storage;
  }
}
