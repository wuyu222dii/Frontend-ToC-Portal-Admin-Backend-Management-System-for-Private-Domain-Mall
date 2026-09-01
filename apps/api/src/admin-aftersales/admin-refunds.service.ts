import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminRefundRepository,
  type AdminAftersaleRefundPreviewSnapshot,
  type AdminManualCompensationPreviewSnapshot,
  type AdminRefundRetryPreviewSnapshot,
  type AdminRefundSnapshot,
  AuditRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  type IdempotencyClaimResult,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, formatVersionEtag } from '@qingxu/platform-core';

import {
  catalogRequestIp,
  type AdminCatalogRequestContext,
} from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type {
  AdminAftersaleRefundAction,
  AdminAftersaleRefundConfirmation,
  AdminManualCompensationAction,
  AdminManualCompensationConfirmation,
  AdminRefundRetryAction,
  AdminRefundRetryConfirmation,
} from './admin-refunds.dto';

const ROUTES = {
  aftersaleConfirm: '/admin/aftersales/{aftersale_id}/refunds',
  aftersalePreview: '/admin/aftersales/{aftersale_id}/refund-preview',
  compensationConfirm: '/admin/orders/{order_id}/manual-compensations',
  compensationPreview: '/admin/orders/{order_id}/manual-compensations/preview',
  retryConfirm: '/admin/refunds/{refund_id}/retry',
  retryPreview: '/admin/refunds/{refund_id}/retry-preview',
} as const;

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError(
    'INTERNAL_ERROR',
    message,
    [],
    cause === undefined ? undefined : { cause },
  );
}

function sensitivePreviewReplay(label: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', `${label} preview must use a new idempotency key`);
}

function resourcePayload(refundId: string, version: number) {
  return {
    event_version: 1 as const,
    resource_id: refundId,
    resource_type: 'refund',
    resource_version: version,
  };
}

@Injectable()
export class AdminRefundsService {
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;
  private readonly refunds!: AdminRefundRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
      this.refunds = new AdminRefundRepository(database.prisma);
    }
  }

  previewAftersaleRefund(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminAftersaleRefundAction,
    idempotencyKey: string,
  ) {
    this.assertMockRuntime();
    const claim = this.claim(request, idempotencyKey, ROUTES.aftersalePreview,
      { aftersale_id: aftersaleId }, this.aftersaleAction(input));
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw sensitivePreviewReplay('Aftersale refund');
      }
      const impact = await this.repositories().refunds.previewAftersaleRefundInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        aftersaleId,
        items: input.items,
        reason: input.reason,
      });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'AFTERSALE.REFUND',
        actorId: request.principal.accountId,
        previewToken,
        request: this.aftersalePreviewRequest(input, impact),
        resourceVersion: impact.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: aftersaleId,
        targetType: 'AFTERSALE',
      });
      const response = this.previewView(previewToken, issued, impact.resourceVersion,
        this.aftersaleImpactView(impact));
      await this.completePreview(transaction, claim, aftersaleId, response);
      return response;
    });
  }

  createAftersaleRefund(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminAftersaleRefundConfirmation,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    this.assertMockRuntime();
    const claim = this.claim(request, idempotencyKey, ROUTES.aftersaleConfirm,
      { aftersale_id: aftersaleId }, {
        ...this.aftersaleAction(input),
        confirmation_hash: input.confirmationHash,
        expected_version: expectedVersion,
        preview_token: input.previewToken,
      });
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') return this.refundReplay(transaction, claimed.record, 'AFTERSALE', 200);
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST', route: ROUTES.aftersalePreview,
      });
      const refund = await this.repositories().refunds.createAftersaleRefundInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        aftersaleId,
        attemptIdempotencyKey: idempotencyKey,
        expectedVersion,
        items: input.items,
        provider: 'MOCK',
        reason: input.reason,
      }, {
        verifyPreview: (impact) => this.repositories().previews.consumeInTransaction(transaction, {
          action: 'AFTERSALE.REFUND',
          actorId: request.principal.accountId,
          confirmationHash: input.confirmationHash,
          previewToken: input.previewToken,
          request: this.aftersalePreviewRequest(input, impact),
          resourceVersion: impact.resourceVersion,
          sessionId: request.accessSession.sessionId,
          targetId: aftersaleId,
          targetType: 'AFTERSALE',
        }),
      });
      await this.recordRequested(transaction, request, idempotencyKey, claim, refund, input.reason, 200, 'REFUND');
      return this.refundView(refund);
    });
  }

  previewRefundRetry(
    request: AdminCatalogRequestContext,
    refundId: string,
    input: AdminRefundRetryAction,
    idempotencyKey: string,
  ) {
    this.assertMockRuntime();
    const claim = this.claim(request, idempotencyKey, ROUTES.retryPreview,
      { refund_id: refundId }, { reason: input.reason });
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw sensitivePreviewReplay('Refund retry');
      }
      const impact = await this.repositories().refunds.previewRetryRefundInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        reason: input.reason,
        refundId,
      });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'REFUND.RETRY',
        actorId: request.principal.accountId,
        previewToken,
        request: this.retryPreviewRequest(input, impact),
        resourceVersion: impact.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: refundId,
        targetType: 'REFUND',
      });
      const response = this.previewView(previewToken, issued, impact.resourceVersion,
        this.retryImpactView(impact));
      await this.completePreview(transaction, claim, refundId, response);
      return response;
    });
  }

  retryRefund(
    request: AdminCatalogRequestContext,
    refundId: string,
    input: AdminRefundRetryConfirmation,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    this.assertMockRuntime();
    const claim = this.claim(request, idempotencyKey, ROUTES.retryConfirm, { refund_id: refundId }, {
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
      reason: input.reason,
    });
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') return this.refundReplay(transaction, claimed.record, undefined, 200);
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST', route: ROUTES.retryPreview,
      });
      const refund = await this.repositories().refunds.prepareRetryRefundInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        attemptIdempotencyKey: idempotencyKey,
        expectedVersion,
        reason: input.reason,
        refundId,
      }, {
        verifyPreview: (impact) => this.repositories().previews.consumeInTransaction(transaction, {
          action: 'REFUND.RETRY',
          actorId: request.principal.accountId,
          confirmationHash: input.confirmationHash,
          previewToken: input.previewToken,
          request: this.retryPreviewRequest(input, impact),
          resourceVersion: impact.resourceVersion,
          sessionId: request.accessSession.sessionId,
          targetId: refundId,
          targetType: 'REFUND',
        }),
      });
      await this.recordRequested(transaction, request, idempotencyKey, claim, refund, input.reason, 200, 'RETRY');
      return this.refundView(refund);
    });
  }

  previewManualCompensation(
    request: AdminCatalogRequestContext,
    orderId: string,
    input: AdminManualCompensationAction,
    idempotencyKey: string,
  ) {
    this.assertMockRuntime();
    const claim = this.claim(request, idempotencyKey, ROUTES.compensationPreview,
      { order_id: orderId }, this.compensationAction(input));
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw sensitivePreviewReplay('Manual compensation');
      }
      const impact = await this.repositories().refunds.previewManualCompensationInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        amount: input.amount,
        orderId,
        orderItemId: input.orderItemId,
        provider: 'MOCK',
        reason: input.reason,
      });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'ORDER.MANUAL_COMPENSATION',
        actorId: request.principal.accountId,
        previewToken,
        request: this.compensationPreviewRequest(input, impact),
        resourceVersion: impact.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: orderId,
        targetType: 'ORDER',
      });
      const response = this.previewView(previewToken, issued, impact.resourceVersion,
        this.compensationImpactView(impact));
      await this.completePreview(transaction, claim, orderId, response);
      return response;
    });
  }

  createManualCompensation(
    request: AdminCatalogRequestContext,
    orderId: string,
    input: AdminManualCompensationConfirmation,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    this.assertMockRuntime();
    const claim = this.claim(request, idempotencyKey, ROUTES.compensationConfirm, { order_id: orderId }, {
      ...this.compensationAction(input),
      confirmation_hash: input.confirmationHash,
      expected_version: expectedVersion,
      preview_token: input.previewToken,
    });
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        return this.refundReplay(transaction, claimed.record, 'MANUAL_COMPENSATION', 201);
      }
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST', route: ROUTES.compensationPreview,
      });
      const refund = await this.repositories().refunds.createManualCompensationInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        amount: input.amount,
        attemptIdempotencyKey: idempotencyKey,
        expectedVersion,
        orderId,
        orderItemId: input.orderItemId,
        provider: 'MOCK',
        reason: input.reason,
      }, {
        verifyPreview: (impact) => this.repositories().previews.consumeInTransaction(transaction, {
          action: 'ORDER.MANUAL_COMPENSATION',
          actorId: request.principal.accountId,
          confirmationHash: input.confirmationHash,
          previewToken: input.previewToken,
          request: this.compensationPreviewRequest(input, impact),
          resourceVersion: impact.resourceVersion,
          sessionId: request.accessSession.sessionId,
          targetId: orderId,
          targetType: 'ORDER',
        }),
      });
      await this.recordRequested(transaction, request, idempotencyKey, claim, refund, input.reason, 201, 'REFUND');
      return this.refundView(refund);
    });
  }

  private repositories() {
    if (!this.audit || !this.idempotency || !this.outbox || !this.previews || !this.refunds) {
      throw internal('Admin refund repositories are unavailable');
    }
    return {
      audit: this.audit,
      idempotency: this.idempotency,
      outbox: this.outbox,
      previews: this.previews,
      refunds: this.refunds,
    };
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) throw internal('Admin refund runtime is unavailable');
    return { config: this.config, database: this.database };
  }

  private assertMockRuntime(): void {
    const { config } = this.runtime();
    if ((config.environment !== 'development' && config.environment !== 'test') ||
      config.payment.provider !== 'MOCK' || config.payment.mockSigningKey === undefined) {
      throw internal('Ordinary refunds are unavailable outside the approved Mock runtime');
    }
  }

  private claim(
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    route: string,
    pathParameters: Record<string, string>,
    body: unknown,
  ): IdempotencyClaim {
    return {
      actorId: request.principal.accountId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters, route },
    };
  }

  private aftersaleAction(input: AdminAftersaleRefundAction) {
    return {
      items: input.items.map((item) => ({
        aftersale_item_id: item.aftersaleItemId,
        quantity: item.quantity,
      })),
      reason: input.reason,
    };
  }

  private compensationAction(input: AdminManualCompensationAction) {
    return { amount: input.amount, order_item_id: input.orderItemId, reason: input.reason };
  }

  private aftersalePreviewRequest(
    input: AdminAftersaleRefundAction,
    impact: AdminAftersaleRefundPreviewSnapshot,
  ) {
    return {
      amount: impact.amount,
      items: impact.items.map((item) => ({
        aftersale_item_id: item.aftersaleItemId,
        commission_reversal: item.commissionReversal,
        order_item_id: item.orderItemId,
        quantity: item.quantity,
        server_allocated_amount: item.amount,
      })),
      order_id: impact.orderId,
      provider: impact.provider,
      reason: input.reason,
    };
  }

  private retryPreviewRequest(input: AdminRefundRetryAction, impact: AdminRefundRetryPreviewSnapshot) {
    return {
      amount: impact.amount,
      next_attempt_no: impact.nextAttemptNo,
      origin_type: impact.originType,
      order_id: impact.orderId,
      reason: input.reason,
      refund_no: impact.refundNo,
    };
  }

  private compensationPreviewRequest(
    input: AdminManualCompensationAction,
    impact: AdminManualCompensationPreviewSnapshot,
  ) {
    return {
      amount: impact.amount,
      commission_reversal: impact.commissionReversal,
      order_item_id: impact.orderItemId,
      provider: impact.provider,
      reason: input.reason,
      remaining_amount_before: impact.remainingAmountBefore,
    };
  }

  private previewView(
    previewToken: string,
    issued: { confirmationHash: string; expiresAt: Date },
    version: number,
    impact: unknown,
  ) {
    return {
      confirmation_hash: issued.confirmationHash,
      expires_at: issued.expiresAt.toISOString(),
      impact,
      preview_token: previewToken,
      resource_etag: formatVersionEtag(version),
    };
  }

  private aftersaleImpactView(impact: AdminAftersaleRefundPreviewSnapshot) {
    return {
      affected_count: impact.affectedCount,
      metrics: [
        { after: impact.amount, before: '0.00', key: 'refund_amount', label: 'Refund amount' },
        {
          after: String(impact.items.reduce((sum, item) => sum + item.inventoryRestockQuantity, 0)),
          before: '0',
          key: 'inventory_restock_quantity',
          label: 'Inventory restock quantity',
        },
      ],
      warnings: impact.warnings,
    };
  }

  private retryImpactView(impact: AdminRefundRetryPreviewSnapshot) {
    return {
      affected_count: impact.affectedCount,
      metrics: [
        { after: 'PENDING', before: 'FAILED', key: 'refund_status', label: 'Refund status' },
        {
          after: String(impact.nextAttemptNo),
          before: String(impact.attemptCount),
          key: 'attempt_count',
          label: 'Refund attempt count',
        },
      ],
      warnings: impact.warnings,
    };
  }

  private compensationImpactView(impact: AdminManualCompensationPreviewSnapshot) {
    return {
      affected_count: impact.affectedCount,
      metrics: [
        { after: impact.amount, before: '0.00', key: 'reserved_amount', label: 'Reserved amount' },
        {
          after: impact.commissionReversal,
          before: '0.00',
          key: 'commission_reversal',
          label: 'Commission reversal',
        },
      ],
      warnings: impact.warnings,
    };
  }

  private completePreview(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    resourceId: string,
    response: { impact: unknown; resource_etag: string },
  ) {
    return this.repositories().idempotency.complete(transaction, claim, {
      resourceId,
      responseForHash: { impact: response.impact, resource_etag: response.resource_etag },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  }

  private async recordRequested(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    claim: IdempotencyClaim,
    refund: AdminRefundSnapshot,
    reason: string,
    responseStatus: 200 | 201,
    action: 'REFUND' | 'RETRY',
  ): Promise<void> {
    const ipAddress = catalogRequestIp(request);
    await this.repositories().audit.append(transaction, {
      action,
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: { status: refund.status, version: refund.version },
      ...(action === 'RETRY'
        ? { before: { status: 'FAILED', version: refund.version - 1 } }
        : {}),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'refund',
      objectId: refund.refundId,
      objectType: 'refund',
      reason,
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
    await this.repositories().outbox.append(transaction, {
      aggregateId: refund.refundId,
      aggregateType: 'refund',
      eventType: 'refund.execution.requested',
      payload: resourcePayload(refund.refundId, refund.version),
    });
    await this.repositories().idempotency.complete(transaction, claim, {
      resourceId: refund.refundId,
      responseForHash: this.commandHash(refund.refundId, refund.originType),
      responseStatus,
      storage: 'HASH_ONLY',
    });
  }

  private async refundReplay(
    transaction: DatabaseTransaction,
    record: Extract<IdempotencyClaimResult, { kind: 'replay' }>['record'],
    expectedOrigin: AdminRefundSnapshot['originType'] | undefined,
    responseStatus: 200 | 201,
  ) {
    if (record.resource_id === null) throw internal('Admin refund replay resource is missing');
    const refund = await this.repositories().refunds.getRefundInTransaction(transaction, {
      refundId: record.resource_id,
    });
    if (expectedOrigin !== undefined && refund.originType !== expectedOrigin) {
      throw internal('Admin refund replay origin is invalid');
    }
    this.repositories().idempotency.assertHashOnlyReplay(record, {
      resourceId: refund.refundId,
      responseForHash: this.commandHash(refund.refundId, refund.originType),
      responseStatus,
      storage: 'HASH_ONLY',
    });
    return this.refundView(refund);
  }

  private commandHash(refundId: string, originType: AdminRefundSnapshot['originType']) {
    return { refund_requested: { origin_type: originType, refund_id: refundId } };
  }

  private refundView(refund: AdminRefundSnapshot) {
    if (refund.originType === 'AFTERSALE') {
      return {
        amount: refund.amount,
        items: refund.items.map((item) => ({
          aftersale_item_id: item.aftersaleItemId,
          order_item_id: item.orderItemId,
          quantity: item.quantity,
          server_allocated_amount: item.amount,
        })),
        origin_type: refund.originType,
        refund_id: refund.refundId,
        refund_no: refund.refundNo,
        status: refund.status,
      };
    }
    const commissionReversal = refund.items.reduce(
      (sum, item) => sum + BigInt(item.commissionReversal.replace('.', '')),
      0n,
    );
    const compensationId = refund.compensationId;
    const compensationNo = refund.compensationNo;
    const orderItemId = refund.items[0]?.orderItemId;
    if (compensationId === null || compensationNo === null || orderItemId === undefined ||
      refund.items.length !== 1) {
      throw internal('Manual compensation projection is incomplete');
    }
    const succeeded = refund.status === 'SUCCEEDED';
    return {
      amount: refund.amount,
      commission_reversal: `${commissionReversal / 100n}.${String(commissionReversal % 100n).padStart(2, '0')}`,
      compensation_id: compensationId,
      compensation_no: compensationNo,
      order_id: refund.orderId,
      order_item_id: orderItemId,
      origin_type: refund.originType,
      refund_id: refund.refundId,
      refund_no: refund.refundNo,
      refunded_amount: succeeded ? refund.amount : '0.00',
      reserved_amount: succeeded ? '0.00' : refund.amount,
      status: refund.status,
      version: refund.version,
    };
  }
}
