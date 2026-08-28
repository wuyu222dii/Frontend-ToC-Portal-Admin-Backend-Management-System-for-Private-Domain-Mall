import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
  type StoreCheckoutAddressFact,
  type StoreOrderCloseResult,
  type StoreOrderDetailSnapshot,
  type StoreOrderListItemSnapshot,
  StoreOrderRepository,
  type StoreOrderSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  createStoreOrderAddressSecurityMaterial,
  verifyStoreAddressSecurityMaterial,
  verifyStoreOrderAddressSecurityMaterial,
} from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import {
  storeCheckoutQuoteFactBinding,
  storeCheckoutQuoteRequestBinding,
} from '../store-checkout/store-checkout.service';
import { StoreCheckoutQuoteCredential } from '../store-checkout/store-checkout-quote-credential';
import type { StoreOrderListQuery, StoreOrderSubmitRequest } from './store-orders.dto';

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

export function storeOrderDisplayStatus(order: StoreOrderSnapshot):
  | '待付款'
  | '待发货'
  | '运输中'
  | '已完成'
  | '退款处理中'
  | '部分退款'
  | '退款完成'
  | '退款异常待处理'
  | '已关闭'
  | '支付异常处理中' {
  if (order.paymentResolution === 'MANUAL_REQUIRED') return '支付异常处理中';
  if (order.refundProcessingStatus === 'FAILED') return '退款异常待处理';
  if (order.paymentResolution === 'LATE_SUCCESS_REFUND_PENDING' ||
    order.refundProcessingStatus === 'REFUNDING') return '退款处理中';
  if (order.paymentResolution === 'LATE_SUCCESS_REFUNDED' || order.refundProgressStatus === 'FULL') {
    return '退款完成';
  }
  if (order.refundProgressStatus === 'PARTIAL') return '部分退款';
  if (order.orderStatus === 'CLOSED') return '已关闭';
  if (order.orderStatus === 'PENDING_PAYMENT') return '待付款';
  if (order.orderStatus === 'PENDING_SHIPMENT' || order.fulfillmentStatus === 'READY_TO_SHIP') {
    return '待发货';
  }
  if (order.orderStatus === 'SHIPPING' || order.fulfillmentStatus === 'SHIPPED' ||
    order.fulfillmentStatus === 'IN_TRANSIT') return '运输中';
  if (order.orderStatus === 'COMPLETED' || order.fulfillmentStatus === 'DELIVERED') return '已完成';
  throw internal('Stored order status axes cannot produce a display status');
}

@Injectable()
export class StoreOrdersService {
  private readonly orders!: StoreOrderRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly credentials!: StoreCheckoutQuoteCredential;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.orders = new StoreOrderRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.credentials = new StoreCheckoutQuoteCredential(config.encryption.idempotencyHashKeys);
    }
  }

  async listOrders(session: CurrentStoreSession, query: StoreOrderListQuery) {
    const result = await this.databaseRuntime().prisma.$transaction(
      (transaction: DatabaseTransaction) => this.repository().listOwnedOrdersInTransaction(transaction, {
        customerId: session.customerId,
        ...query,
      }),
      { isolationLevel: 'RepeatableRead' },
    );
    return {
      items: result.items.map((item) => this.listItemView(item)),
      pagination: { page: query.page, page_size: query.pageSize, total: result.total },
    };
  }

  async getOrder(session: CurrentStoreSession, orderId: string) {
    const detail = await this.databaseRuntime().prisma.$transaction(
      (transaction: DatabaseTransaction) => this.repository().getOwnedOrderDetailInTransaction(transaction, {
        customerId: session.customerId,
        orderId,
      }),
      { isolationLevel: 'RepeatableRead' },
    );
    return this.detailView(detail);
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

  cancelOrder(
    session: CurrentStoreSession,
    orderId: string,
    expectedVersion: number,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
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

  private availableActions(canCancel: boolean): Array<'CANCEL'> {
    return canCancel ? ['CANCEL'] : [];
  }

  private listItemView(resource: StoreOrderListItemSnapshot) {
    const imageByItem = new Map(resource.itemImages.map(({ objectKey, orderItemId }) => [orderItemId, objectKey]));
    return {
      aftersale_summary: {
        active_count: resource.aftersaleSummary.activeCount,
        latest_aftersale_id: resource.aftersaleSummary.latestAftersaleId,
        latest_status: resource.aftersaleSummary.latestStatus,
        refunded_amount: resource.aftersaleSummary.refundedAmount,
      },
      available_actions: this.availableActions(resource.canCancel),
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

  private detailView(resource: StoreOrderDetailSnapshot) {
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
      axis: 'ORDER';
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
    return {
      ...this.orderView(resource.order),
      aftersales: [],
      available_actions: this.availableActions(resource.canCancel),
      errors: [],
      packages: [],
      payment_attempts: [],
      refund_attempts: [],
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
