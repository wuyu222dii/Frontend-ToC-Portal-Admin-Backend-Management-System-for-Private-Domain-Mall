import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  runSerializableTransaction,
  type StoreAftersaleDetailSnapshot,
  type StoreAftersaleListItemSnapshot,
  type StoreAftersalePreviewSnapshot,
  StoreAftersaleRepository,
} from '@qingxu/database';
import {
  ApplicationError,
  type OrderDisplayStatusAxes,
  projectOrderDisplayStatus,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { StoreAftersalePreviewCredential } from './store-aftersale-preview-credential';
import type {
  StoreAftersaleCancelRequest,
  StoreAftersaleCreateRequest,
  StoreAftersaleListQuery,
} from './store-aftersales.dto';

/** Internal, non-serialized marker consumed only by StoreAftersalesController. */
export const STORE_AFTERSALE_HTTP_STATUS = Symbol('STORE_AFTERSALE_HTTP_STATUS');

const AFTERSALE_COLLECTION_ROUTE = '/store/aftersales';
const AFTERSALE_CANCEL_ROUTE = '/store/aftersales/{aftersale_id}/cancel';

const FULFILLMENT_STATUSES = new Set<OrderDisplayStatusAxes['fulfillmentStatus']>([
  'CANCELLED',
  'DELIVERED',
  'IN_TRANSIT',
  'NOT_STARTED',
  'READY_TO_SHIP',
  'SHIPPED',
]);
const ORDER_STATUSES = new Set<OrderDisplayStatusAxes['orderStatus']>([
  'CLOSED',
  'COMPLETED',
  'PENDING_PAYMENT',
  'PENDING_SHIPMENT',
  'SHIPPING',
]);
const PAYMENT_RESOLUTIONS = new Set<OrderDisplayStatusAxes['paymentResolution']>([
  'LATE_SUCCESS_REFUND_PENDING',
  'LATE_SUCCESS_REFUNDED',
  'MANUAL_REQUIRED',
  'NORMAL',
]);
const PAYMENT_STATUSES = new Set<OrderDisplayStatusAxes['paymentStatus']>([
  'PAID',
  'PROCESSING',
  'UNPAID',
]);
const REFUND_PROCESSING_STATUSES = new Set<OrderDisplayStatusAxes['refundProcessingStatus']>([
  'FAILED',
  'IDLE',
  'REFUNDING',
]);
const REFUND_PROGRESS_STATUSES = new Set<OrderDisplayStatusAxes['refundProgressStatus']>([
  'FULL',
  'NONE',
  'PARTIAL',
]);

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError(
    'INTERNAL_ERROR',
    message,
    [],
    cause === undefined ? undefined : { cause },
  );
}

function sensitivePreviewReplay(): ApplicationError {
  return new ApplicationError(
    'STATE_CONFLICT',
    'Aftersale preview credentials cannot be replayed; request a new preview',
  );
}

export function storeAftersalePreviewRequestBinding(input: StoreAftersaleCreateRequest) {
  return {
    evidence_file_ids: [...input.evidenceFileIds],
    items: input.items.map(({ orderItemId, quantity }) => ({
      order_item_id: orderItemId,
      quantity,
    })),
    order_id: input.orderId,
    reason_code: input.reasonCode,
    reason_text: input.reasonText,
    type: input.type,
  };
}

export function storeAftersalePreviewFactBinding(snapshot: StoreAftersalePreviewSnapshot) {
  return {
    blockers: snapshot.blockers,
    can_submit: snapshot.canSubmit,
    customer_id: snapshot.customerId,
    evidence: snapshot.evidence.map((file) => ({
      attached_aftersale_ids: file.attachedAftersaleIds,
      created_by_account_id: file.createdByAccountId,
      file_id: file.fileId,
      object_key: file.objectKey,
      purpose: file.purpose,
      status: file.status,
      valid: file.valid,
      visibility: file.visibility,
    })),
    items: snapshot.items.map((item) => ({
      allocated_amount: item.allocatedAmount,
      line_paid_amount: item.linePaidAmount,
      order_item_id: item.orderItemId,
      order_item_version: item.orderItemVersion,
      refunded_amount: item.refundedAmount,
      refunded_quantity: item.refundedQuantity,
      remaining_refundable_amount: item.remainingRefundableAmount,
      remaining_refundable_quantity: item.remainingRefundableQuantity,
      requested_quantity: item.requestedQuantity,
      reserved_amount: item.reservedAmount,
      reserved_quantity: item.reservedQuantity,
      unit_price: item.unitPrice,
    })),
    order: {
      aftersale_expires_at: snapshot.order.aftersaleExpiresAt?.toISOString() ?? null,
      fulfillment_status: snapshot.order.fulfillmentStatus,
      order_id: snapshot.order.orderId,
      order_status: snapshot.order.orderStatus,
      order_version: snapshot.order.orderVersion,
      payment_resolution: snapshot.order.paymentResolution,
      payment_status: snapshot.order.paymentStatus,
    },
    reason_code: snapshot.reasonCode,
    reason_text: snapshot.reasonText,
    requested_amount: snapshot.requestedAmount,
    type: snapshot.type,
  };
}

@Injectable()
export class StoreAftersalesService {
  private readonly aftersales!: StoreAftersaleRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly previewCredential!: StoreAftersalePreviewCredential;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.aftersales = new StoreAftersaleRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.previewCredential = new StoreAftersalePreviewCredential(
        config.encryption.idempotencyHashKeys,
      );
    }
  }

  async createAftersale(
    session: CurrentStoreSession,
    input: StoreAftersaleCreateRequest,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return input.action === 'PREVIEW'
      ? this.preview(session, input, idempotencyKey)
      : this.confirm(session, input, idempotencyKey, requestId, ipAddress);
  }

  async listAftersales(session: CurrentStoreSession, query: StoreAftersaleListQuery) {
    const result = await this.repository().listOwnedAftersales({
      accountId: session.accountId,
      customerId: session.customerId,
      ...query,
    });
    return {
      items: result.items.map((item) => this.listItemView(item)),
      pagination: { page: query.page, page_size: query.pageSize, total: result.total },
    };
  }

  async getAftersale(session: CurrentStoreSession, aftersaleId: string) {
    const aftersale = await this.repository().getOwnedAftersaleDetail({
      accountId: session.accountId,
      aftersaleId,
      customerId: session.customerId,
    });
    return this.detailView(aftersale);
  }

  cancelAftersale(
    session: CurrentStoreSession,
    aftersaleId: string,
    input: StoreAftersaleCancelRequest,
    expectedVersion: number,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.cancelClaim(
      session.accountId,
      aftersaleId,
      input,
      expectedVersion,
      idempotencyKey,
    );
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.resource_id !== aftersaleId) {
          throw internal('Store aftersale cancellation replay resource is invalid');
        }
        const current = await this.repository().getOwnedAftersaleForReplayInTransaction(transaction, {
          accountId: session.accountId,
          aftersaleId,
          customerId: session.customerId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId: aftersaleId,
          responseForHash: this.cancelIdempotencyResponse(aftersaleId),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return this.summaryView(current);
      }

      const result = await this.repository().cancelOwnedAftersaleInTransaction(transaction, {
        accountId: session.accountId,
        aftersaleId,
        customerId: session.customerId,
        expectedVersion,
      });
      await this.appendCancelAudit(
        transaction,
        session,
        aftersaleId,
        result.audit,
        input.reason,
        idempotencyKey,
        requestId,
        ipAddress,
      );
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: aftersaleId,
        responseForHash: this.cancelIdempotencyResponse(aftersaleId),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return this.summaryView(result.aftersale);
    });
  }

  private preview(
    session: CurrentStoreSession,
    input: Extract<StoreAftersaleCreateRequest, { action: 'PREVIEW' }>,
    idempotencyKey: string,
  ) {
    const claim = this.createClaim(session.accountId, input, idempotencyKey);
    return this.databaseRuntime().prisma.$transaction(async (transaction) => {
      if ((await this.idempotencyRepository().claim(transaction, claim)).kind === 'replay') {
        throw sensitivePreviewReplay();
      }
      const snapshot = await this.repository().previewInTransaction(
        transaction,
        this.previewInput(session, input),
      );
      this.assertPreviewSnapshot(snapshot, session, input);
      const credential = snapshot.canSubmit
        ? this.credential().issue({
            customerId: session.customerId,
            facts: storeAftersalePreviewFactBinding(snapshot),
            previewIdempotencyKey: idempotencyKey,
            request: storeAftersalePreviewRequestBinding(input),
            sessionId: session.sessionId,
          })
        : null;
      const response = this.previewView(snapshot, credential);
      await this.idempotencyRepository().complete(transaction, claim, {
        responseForHash: {
          blockers: response.blockers,
          can_submit: response.can_submit,
          items: response.items,
          requested_amount: response.requested_amount,
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    }, { isolationLevel: 'RepeatableRead' });
  }

  private confirm(
    session: CurrentStoreSession,
    input: Extract<StoreAftersaleCreateRequest, { action: 'CONFIRM' }>,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.createClaim(session.accountId, input, idempotencyKey);
    const request = storeAftersalePreviewRequestBinding(input);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Store aftersale idempotency record has no resource');
        const current = await this.repository().getOwnedAftersaleForReplayInTransaction(transaction, {
          accountId: session.accountId,
          aftersaleId: resourceId,
          customerId: session.customerId,
        });
        this.idempotencyRepository().assertHashOnlyReplay(claimed.record, {
          resourceId,
          responseForHash: this.confirmIdempotencyResponse(resourceId),
          responseStatus: 201,
          storage: 'HASH_ONLY',
        });
        return this.createdSummaryView(current);
      }

      this.credential().authenticate({
        confirmationHash: input.confirmationHash,
        confirmIdempotencyKey: idempotencyKey,
        customerId: session.customerId,
        previewToken: input.previewToken,
        request,
        sessionId: session.sessionId,
      });
      const result = await this.repository().confirmAftersaleInTransaction(
        transaction,
        this.previewInput(session, input),
        {
          verifyPreview: (snapshot) => {
            this.assertPreviewSnapshot(snapshot, session, input);
            this.credential().verify({
              confirmationHash: input.confirmationHash,
              confirmIdempotencyKey: idempotencyKey,
              customerId: session.customerId,
              facts: storeAftersalePreviewFactBinding(snapshot),
              previewToken: input.previewToken,
              request,
              sessionId: session.sessionId,
            });
          },
        },
      );
      await this.appendCreateAudit(
        transaction,
        session,
        result.aftersale.aftersaleId,
        result.audit.after,
        idempotencyKey,
        requestId,
        ipAddress,
      );
      await this.idempotencyRepository().complete(transaction, claim, {
        resourceId: result.aftersale.aftersaleId,
        responseForHash: this.confirmIdempotencyResponse(result.aftersale.aftersaleId),
        responseStatus: 201,
        storage: 'HASH_ONLY',
      });
      return this.createdSummaryView(result.aftersale);
    });
  }

  private previewInput(session: CurrentStoreSession, input: StoreAftersaleCreateRequest) {
    return {
      accountId: session.accountId,
      customerId: session.customerId,
      evidenceFileIds: input.evidenceFileIds,
      items: input.items,
      orderId: input.orderId,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText,
      type: input.type,
    };
  }

  private assertPreviewSnapshot(
    snapshot: StoreAftersalePreviewSnapshot,
    session: CurrentStoreSession,
    input: StoreAftersaleCreateRequest,
  ): void {
    const expectedItems = input.items.map(({ orderItemId, quantity }) => ({ orderItemId, quantity }));
    const actualItems = snapshot.items.map(({ orderItemId, requestedQuantity }) => ({
      orderItemId,
      quantity: requestedQuantity,
    }));
    const expectedEvidence = input.evidenceFileIds;
    const actualEvidence = snapshot.evidence.map(({ fileId }) => fileId);
    if (snapshot.customerId !== session.customerId || snapshot.order.orderId !== input.orderId ||
      snapshot.reasonCode !== input.reasonCode || snapshot.reasonText !== input.reasonText ||
      snapshot.type !== input.type || snapshot.canSubmit !== (snapshot.blockers.length === 0) ||
      expectedItems.length !== actualItems.length || expectedEvidence.length !== actualEvidence.length ||
      expectedItems.some((item, index) => item.orderItemId !== actualItems[index]?.orderItemId ||
        item.quantity !== actualItems[index]?.quantity) ||
      expectedEvidence.some((fileId, index) => fileId !== actualEvidence[index])) {
      throw internal('Store aftersale preview snapshot is inconsistent');
    }
  }

  private previewView(
    snapshot: StoreAftersalePreviewSnapshot,
    credential: ReturnType<StoreAftersalePreviewCredential['issue']> | null,
  ) {
    return {
      blockers: snapshot.blockers,
      can_submit: snapshot.canSubmit,
      confirmation_hash: credential?.confirmationHash ?? null,
      expires_at: credential?.expiresAt.toISOString() ?? null,
      items: snapshot.items.map((item) => ({
        allocated_amount: item.allocatedAmount,
        order_item_id: item.orderItemId,
        remaining_refundable_amount: item.remainingRefundableAmount,
        remaining_refundable_quantity: item.remainingRefundableQuantity,
        requested_quantity: item.requestedQuantity,
      })),
      preview_token: credential?.previewToken ?? null,
      requested_amount: snapshot.requestedAmount,
    };
  }

  private listItemView(item: StoreAftersaleListItemSnapshot) {
    return {
      aftersale_id: item.aftersaleId,
      aftersale_no: item.aftersaleNo,
      available_actions: this.availableActions(item.availableActions),
      created_at: item.createdAt.toISOString(),
      order_id: item.orderId,
      refund_processing_status: item.refundProcessingStatus,
      refund_progress_status: item.refundProgressStatus,
      requested_amount: item.requestedAmount,
      status: item.status,
      type: item.type,
    };
  }

  private summaryView(resource: StoreAftersaleDetailSnapshot) {
    return {
      aftersale_id: resource.aftersaleId,
      aftersale_no: resource.aftersaleNo,
      items: resource.items.map((item) => ({
        aftersale_item_id: item.aftersaleItemId,
        allocated_amount: item.allocatedAmount,
        approved_refund_qty: item.approvedRefundQuantity,
        order_item_id: item.orderItemId,
        quantity: item.requestedQuantity,
      })),
      status: resource.status,
      type: resource.type,
    };
  }

  private createdSummaryView(resource: StoreAftersaleDetailSnapshot) {
    const view = this.summaryView(resource) as Record<string | symbol, unknown>;
    Object.defineProperty(view, STORE_AFTERSALE_HTTP_STATUS, {
      configurable: false,
      enumerable: false,
      value: 201,
      writable: false,
    });
    return view;
  }

  private detailView(resource: StoreAftersaleDetailSnapshot) {
    const refundAttempts = resource.refundAttempts.map((attempt) => ({
      amount: attempt.amount,
      attempt_no: attempt.attemptNo,
      created_at: attempt.createdAt.toISOString(),
      last_error: this.refundError(attempt.failureCode, attempt.updatedAt),
      origin_type: 'AFTERSALE' as const,
      refund_id: attempt.refundId,
      refund_no: attempt.refundNo,
      status: attempt.status,
      updated_at: attempt.updatedAt.toISOString(),
    }));
    return {
      aftersale_id: resource.aftersaleId,
      aftersale_no: resource.aftersaleNo,
      available_actions: this.availableActions(resource.availableActions),
      created_at: resource.createdAt.toISOString(),
      errors: refundAttempts
        .map(({ last_error: error }) => error)
        .filter((error): error is NonNullable<typeof error> => error !== null),
      inspection: resource.inspection === null ? null : {
        abnormal_reason: resource.inspection.abnormalReason,
        evidence_file_ids: resource.inspection.evidenceFileIds,
        inspected_at: resource.inspection.inspectedAt.toISOString(),
        inspection_id: resource.inspection.inspectionId,
        items: resource.inspection.items.map((item) => ({
          approved_refund_qty: item.approvedRefundQuantity,
          damaged_qty: item.damagedQuantity,
          order_item_id: item.orderItemId,
          received_qty: item.receivedQuantity,
          restock_qty: item.restockQuantity,
          return_to_customer_qty: item.returnToCustomerQuantity,
          scrap_qty: item.scrapQuantity,
        })),
        resolution: resource.inspection.resolution,
        resolution_reason: resource.inspection.resolutionReason,
        resolved_at: resource.inspection.resolvedAt?.toISOString() ?? null,
        result: resource.inspection.result,
      },
      items: resource.items.map((item) => ({
        aftersale_item_id: item.aftersaleItemId,
        allocated_amount: item.allocatedAmount,
        approved_refund_quantity: item.approvedRefundQuantity,
        order_item_id: item.orderItemId,
        product_name: item.productName,
        refunded_quantity: item.refundedQuantity,
        requested_quantity: item.requestedQuantity,
        reserved_amount: item.reservedAmount,
        reserved_quantity: item.reservedQuantity,
        sku_name: item.skuName,
      })),
      order: {
        display_status: this.orderDisplayStatus(resource),
        order_id: resource.order.orderId,
        order_no: resource.order.orderNo,
        paid_at: resource.order.paidAt?.toISOString() ?? null,
        payable_amount: resource.order.payableAmount,
      },
      reason: resource.reasonText ?? resource.reasonCode,
      refund_attempts: refundAttempts,
      return_address: this.returnAddressView(resource),
      return_shipment: resource.returnShipment === null ? null : {
        carrier_code: resource.returnShipment.carrierCode,
        carrier_name: resource.returnShipment.carrierName,
        submitted_at: resource.returnShipment.submittedAt.toISOString(),
        tracking_no: resource.returnShipment.trackingNo,
      },
      status: resource.status,
      timeline: resource.timeline.map((event) => ({
        event: event.action,
        event_id: event.auditId,
        from_status: event.fromStatus,
        occurred_at: event.occurredAt.toISOString(),
        operator_role: this.timelineActorRole(event.actorRole),
        to_status: event.toStatus,
      })),
      type: resource.type,
      version: resource.version,
    };
  }

  private orderDisplayStatus(resource: StoreAftersaleDetailSnapshot) {
    const order = resource.order;
    if (!FULFILLMENT_STATUSES.has(order.fulfillmentStatus as OrderDisplayStatusAxes['fulfillmentStatus']) ||
      !ORDER_STATUSES.has(order.orderStatus as OrderDisplayStatusAxes['orderStatus']) ||
      !PAYMENT_RESOLUTIONS.has(order.paymentResolution as OrderDisplayStatusAxes['paymentResolution']) ||
      !PAYMENT_STATUSES.has(order.paymentStatus as OrderDisplayStatusAxes['paymentStatus']) ||
      !REFUND_PROCESSING_STATUSES.has(
        order.refundProcessingStatus as OrderDisplayStatusAxes['refundProcessingStatus'],
      ) ||
      !REFUND_PROGRESS_STATUSES.has(
        order.refundProgressStatus as OrderDisplayStatusAxes['refundProgressStatus'],
      )) {
      throw internal('Stored aftersale Order status axes are invalid');
    }
    return projectOrderDisplayStatus(order as OrderDisplayStatusAxes);
  }

  private returnAddressView(resource: StoreAftersaleDetailSnapshot): null {
    if (resource.returnAddress !== null) {
      throw internal('Store aftersale return address security adapter is unavailable');
    }
    return null;
  }

  private timelineActorRole(actorRole: StoreAftersaleDetailSnapshot['timeline'][number]['actorRole']) {
    if (actorRole === null) return 'SYSTEM' as const;
    if (actorRole === 'CUSTOMER' || actorRole === 'SUPER_ADMIN') return actorRole;
    throw internal('Stored aftersale timeline actor role is not customer-visible');
  }

  private refundError(code: string | null, occurredAt: Date) {
    if (code === null) return null;
    return {
      error_code: code,
      message: 'The refund has not completed; refresh or contact support',
      occurred_at: occurredAt.toISOString(),
      retryable: true,
    };
  }

  private availableActions(actions: StoreAftersaleListItemSnapshot['availableActions']) {
    return actions.filter((action): action is 'CANCEL' | 'VIEW_ORDER' =>
      action === 'CANCEL' || action === 'VIEW_ORDER');
  }

  private createClaim(
    actorId: string,
    input: StoreAftersaleCreateRequest,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: {
          action: input.action,
          ...storeAftersalePreviewRequestBinding(input),
          ...(input.action === 'CONFIRM' ? {
            confirmation_hash: input.confirmationHash,
            preview_token: input.previewToken,
          } : {}),
        },
        method: 'POST',
        pathParameters: {},
        route: AFTERSALE_COLLECTION_ROUTE,
      },
    };
  }

  private cancelClaim(
    actorId: string,
    aftersaleId: string,
    input: StoreAftersaleCancelRequest,
    expectedVersion: number,
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: {
          expected_version: expectedVersion,
          ...(input.reason === undefined ? {} : { reason: input.reason }),
        },
        method: 'POST',
        pathParameters: { aftersale_id: aftersaleId },
        route: AFTERSALE_CANCEL_ROUTE,
      },
    };
  }

  private confirmIdempotencyResponse(aftersaleId: string) {
    return { aftersale_created: { aftersale_id: aftersaleId } };
  }

  private cancelIdempotencyResponse(aftersaleId: string) {
    return { aftersale_cancelled: { aftersale_id: aftersaleId } };
  }

  private appendCreateAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    aftersaleId: string,
    after: { status: string; version: number },
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.auditRepository().append(transaction, {
      action: 'CREATE',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after,
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'aftersale',
      objectId: aftersaleId,
      objectType: 'aftersale',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendCancelAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    aftersaleId: string,
    audit: { after: { status: string; version: number }; before: { status: string; version: number } },
    reason: string | undefined,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.auditRepository().append(transaction, {
      action: 'CANCEL',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      after: audit.after,
      before: audit.before,
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'aftersale',
      objectId: aftersaleId,
      objectType: 'aftersale',
      ...(reason === undefined ? {} : { reason }),
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private repository(): StoreAftersaleRepository {
    if (!this.aftersales) throw internal('Store aftersale repository is unavailable');
    return this.aftersales;
  }

  private credential(): StoreAftersalePreviewCredential {
    if (!this.previewCredential) throw internal('Store aftersale preview credential is unavailable');
    return this.previewCredential;
  }

  private idempotencyRepository(): IdempotencyRepository {
    if (!this.idempotency) throw internal('Store aftersale idempotency is unavailable');
    return this.idempotency;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw internal('Store aftersale audit is unavailable');
    return this.audit;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw internal('Store aftersale database is unavailable');
    return this.database;
  }
}
