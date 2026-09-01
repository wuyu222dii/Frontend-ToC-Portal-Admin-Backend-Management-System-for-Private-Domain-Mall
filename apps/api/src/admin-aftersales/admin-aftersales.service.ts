import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAftersaleRepository,
  type AdminAftersaleCommandSnapshot,
  type AdminAftersaleDetailSnapshot,
  type AdminAftersaleRejectAfterReturnImpactSnapshot,
  type AdminAftersaleRejectImpactSnapshot,
  AuditRepository,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  type IdempotencyClaimResult,
  type ReturnAddressPublishPreviewSnapshot,
  ReturnAddressRepository,
  type ReturnAddressVersionMaterial,
  runSerializableTransaction,
} from '@qingxu/database';
import {
  ApplicationError,
  formatVersionEtag,
  projectOrderDisplayStatus,
} from '@qingxu/platform-core';

import {
  catalogRequestIp,
  type AdminCatalogRequestContext,
} from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import {
  createReturnAddressSnapshotSecurityMaterial,
  createReturnAddressVersionSecurityMaterial,
  verifyReturnAddressSnapshotSecurityMaterial,
  verifyReturnAddressVersionSecurityMaterial,
} from '../platform/security/return-address-security';
import type {
  AdminAftersaleApproveRequest,
  AdminAftersaleListQuery,
  AdminAftersaleRejectConfirmationRequest,
  AdminAftersaleRejectRequest,
  AdminContinueRefundRequest,
  AdminRejectAfterReturnConfirmationRequest,
  AdminRejectAfterReturnRequest,
  AdminReturnAddressAction,
  AdminReturnAddressConfirmation,
  AdminReturnInspectionRequest,
} from './admin-aftersales.dto';

const RETURN_ADDRESS_SINGLETON_ID = '00000000000000000000000000';
const ROUTES = {
  approve: '/admin/aftersales/{aftersale_id}/approve',
  continueRefundAfterReturn: '/admin/aftersales/{aftersale_id}/return-resolution/continue-refund',
  reject: '/admin/aftersales/{aftersale_id}/reject',
  rejectAfterReturn: '/admin/aftersales/{aftersale_id}/return-resolution/reject',
  rejectAfterReturnPreview: '/admin/aftersales/{aftersale_id}/return-resolution/reject-preview',
  rejectPreview: '/admin/aftersales/{aftersale_id}/reject-preview',
  returnAddress: '/admin/settings/return-address',
  returnAddressPreview: '/admin/settings/return-address/preview',
  returnInspection: '/admin/aftersales/{aftersale_id}/return-inspections',
} as const;

type AftersaleCommand =
  | 'approve'
  | 'continue-refund-after-return'
  | 'record-return-inspection'
  | 'reject'
  | 'reject-after-return';

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

function rejectRequest(
  input: AdminAftersaleRejectRequest,
  impact: AdminAftersaleRejectImpactSnapshot,
) {
  return {
    items: impact.items.map((item) => ({
      aftersale_item_id: item.aftersaleItemId,
      order_item_id: item.orderItemId,
      release_amount: item.releaseAmount,
      release_quantity: item.releaseQuantity,
    })),
    order_id: impact.orderId,
    reason: input.reason,
    release_amount: impact.releaseAmount,
    release_quantity: impact.releaseQuantity,
  };
}

function addressAction(input: AdminReturnAddressAction) {
  return {
    city: input.city,
    detail: input.detail,
    district: input.district,
    phone: input.phone,
    province: input.province,
    reason: input.reason,
    recipient_name: input.recipientName,
  };
}

function addressPreviewRequest(
  input: AdminReturnAddressAction,
  snapshot: ReturnAddressPublishPreviewSnapshot,
) {
  return {
    ...addressAction(input),
    current_published_id: snapshot.currentPublishedId,
    max_version_no: snapshot.maxVersionNo,
  };
}

function inspectionRequest(input: AdminReturnInspectionRequest) {
  return {
    ...(input.abnormalReason === null ? {} : { abnormal_reason: input.abnormalReason }),
    evidence_file_ids: input.evidenceFileIds,
    items: input.items.map((item) => ({
      approved_refund_qty: item.approvedRefundQuantity,
      damaged_qty: item.damagedQuantity,
      note: item.note,
      order_item_id: item.orderItemId,
      received_qty: item.receivedQuantity,
      restock_qty: item.restockQuantity,
      return_to_customer_qty: item.returnToCustomerQuantity,
      scrap_qty: item.scrapQuantity,
    })),
    result: input.result,
  };
}

function rejectAfterReturnRequest(
  input: AdminRejectAfterReturnRequest,
  impact: AdminAftersaleRejectAfterReturnImpactSnapshot,
) {
  return {
    aftersale_id: impact.aftersaleId,
    evidence_file_ids: impact.inspectionEvidenceFileIds,
    inspection_id: impact.inspectionId,
    inspection_items: impact.inspectionItems.map((item) => ({
      approved_refund_qty: item.approvedRefundQuantity,
      damaged_qty: item.damagedQuantity,
      note: item.note,
      order_item_id: item.orderItemId,
      received_qty: item.receivedQuantity,
      restock_qty: item.restockQuantity,
      return_to_customer_qty: item.returnToCustomerQuantity,
      scrap_qty: item.scrapQuantity,
    })),
    inspection_version: impact.inspectionVersion,
    items: impact.items.map((item) => ({
      aftersale_item_id: item.aftersaleItemId,
      order_item_id: item.orderItemId,
      release_amount: item.releaseAmount,
      release_quantity: item.releaseQuantity,
    })),
    order_id: impact.orderId,
    reason: input.reason,
    release_amount: impact.releaseAmount,
    release_quantity: impact.releaseQuantity,
    resolution: input.resolution,
  };
}

@Injectable()
export class AdminAftersalesService {
  private readonly aftersales!: AdminAftersaleRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly previews!: HighRiskPreviewRepository;
  private readonly returnAddresses!: ReturnAddressRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.aftersales = new AdminAftersaleRepository(database.prisma, config.encryption.ipHashKey);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.previews = new HighRiskPreviewRepository(
        database.prisma,
        config.encryption.idempotencyHashKeys,
      );
      this.returnAddresses = new ReturnAddressRepository(database.prisma);
    }
  }

  async listAftersales(query: AdminAftersaleListQuery) {
    const result = await this.repositories().aftersales.list(query);
    return {
      items: result.items.map((item) => ({
        aftersale_id: item.aftersaleId,
        aftersale_no: item.aftersaleNo,
        agent_id: item.agentId,
        created_at: item.createdAt.toISOString(),
        customer_alias: item.customerAlias,
        customer_id: item.customerId,
        order_id: item.orderId,
        requested_amount: item.requestedAmount,
        status: item.status,
        type: item.type,
        version: item.version,
      })),
      pagination: { page: query.page, page_size: query.pageSize, total: result.total },
    };
  }

  async getAftersale(aftersaleId: string) {
    return this.detailView(await this.repositories().aftersales.getDetail({ aftersaleId }));
  }

  async approveAftersale(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminAftersaleApproveRequest,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.approve,
      { aftersale_id: aftersaleId },
      { expected_version: expectedVersion, note: input.note },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
        const claimed = await this.repositories().idempotency.claim(transaction, claim);
        if (claimed.kind === 'replay') {
          return this.aftersaleReplay(transaction, request, claimed.record, aftersaleId, 'approve');
        }
        const result = await this.repositories().aftersales.approveInTransaction(transaction, {
          actorAccountId: request.principal.accountId,
          aftersaleId,
          expectedVersion,
          note: input.note,
        }, {
          protectReturnAddress: ({ snapshotId, source }) => {
            let plaintext: ReturnType<typeof verifyReturnAddressVersionSecurityMaterial>;
            try {
              plaintext = verifyReturnAddressVersionSecurityMaterial({
                detailCiphertext: source.detailCiphertext,
                encryptionKeyId: source.encryptionKeyId,
                phoneCiphertext: source.phoneCiphertext,
                phoneLast4: source.phoneLast4,
                recordId: source.sourceVersionId,
              }, this.runtime().config.encryption.fieldKeys);
              return createReturnAddressSnapshotSecurityMaterial({
                detail: plaintext.detail,
                phone: plaintext.phone,
                snapshotId,
              }, this.runtime().config.encryption.fieldKeys.current);
            } catch (error) {
              throw internal('Published return address material could not be protected', error);
            }
          },
        });
        await this.appendAftersaleAudit(
          transaction,
          request,
          idempotencyKey,
          'APPROVE',
          result.audit,
          result.aftersale.aftersaleId,
          input.note !== null && Array.from(input.note).length >= 2 ? input.note : undefined,
        );
        await this.repositories().idempotency.complete(transaction, claim, {
          resourceId: result.aftersale.aftersaleId,
          responseForHash: this.aftersaleCommandHash(result.aftersale.aftersaleId, 'approve'),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return this.commandView(result.aftersale);
    });
  }

  previewReject(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminAftersaleRejectRequest,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.rejectPreview,
      { aftersale_id: aftersaleId },
      { reason: input.reason },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw sensitivePreviewReplay('Aftersale rejection');
      }
      const impact = await this.repositories().aftersales.previewRejectInTransaction(transaction, { aftersaleId });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'AFTERSALE.REJECT',
        actorId: request.principal.accountId,
        previewToken,
        request: rejectRequest(input, impact),
        resourceVersion: impact.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: aftersaleId,
        targetType: 'AFTERSALE',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: this.rejectImpactView(impact),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(impact.resourceVersion),
      };
      await this.repositories().idempotency.complete(transaction, claim, {
        resourceId: aftersaleId,
        responseForHash: { impact: response.impact, resource_etag: response.resource_etag },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  rejectAftersale(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminAftersaleRejectConfirmationRequest,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.reject,
      { aftersale_id: aftersaleId },
      {
        confirmation_hash: input.confirmationHash,
        expected_version: expectedVersion,
        preview_token: input.previewToken,
        reason: input.reason,
      },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        return this.aftersaleReplay(transaction, request, claimed.record, aftersaleId, 'reject');
      }
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST',
        route: ROUTES.rejectPreview,
      });
      const result = await this.repositories().aftersales.rejectInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        aftersaleId,
        expectedVersion,
        reason: input.reason,
      }, {
        verifyPreview: (impact) => this.repositories().previews.consumeInTransaction(transaction, {
          action: 'AFTERSALE.REJECT',
          actorId: request.principal.accountId,
          confirmationHash: input.confirmationHash,
          previewToken: input.previewToken,
          request: rejectRequest(input, impact),
          resourceVersion: impact.resourceVersion,
          sessionId: request.accessSession.sessionId,
          targetId: aftersaleId,
          targetType: 'AFTERSALE',
        }),
      });
      await this.appendAftersaleAudit(
        transaction,
        request,
        idempotencyKey,
        'REJECT',
        result.audit,
        result.aftersale.aftersaleId,
        input.reason,
      );
      await this.repositories().idempotency.complete(transaction, claim, {
        resourceId: result.aftersale.aftersaleId,
        responseForHash: this.aftersaleCommandHash(result.aftersale.aftersaleId, 'reject'),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return this.commandView(result.aftersale);
    });
  }

  recordReturnInspection(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminReturnInspectionRequest,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.returnInspection,
      { aftersale_id: aftersaleId },
      { ...inspectionRequest(input), expected_version: expectedVersion },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        return this.aftersaleReplay(
          transaction,
          request,
          claimed.record,
          aftersaleId,
          'record-return-inspection',
        );
      }
      const result = await this.repositories().aftersales.recordReturnInspectionInTransaction(
        transaction,
        {
          abnormalReason: input.abnormalReason,
          actorAccountId: request.principal.accountId,
          aftersaleId,
          evidenceFileIds: input.evidenceFileIds,
          expectedVersion,
          items: input.items,
          result: input.result,
        },
      );
      await this.appendAftersaleAudit(
        transaction,
        request,
        idempotencyKey,
        'RECORD_INSPECTION',
        result.audit,
        result.aftersale.aftersaleId,
        input.abnormalReason ?? undefined,
      );
      await this.completeAftersaleCommand(
        transaction,
        claim,
        result.aftersale.aftersaleId,
        'record-return-inspection',
      );
      return this.commandView(result.aftersale);
    });
  }

  continueRefundAfterReturn(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminContinueRefundRequest,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.continueRefundAfterReturn,
      { aftersale_id: aftersaleId },
      { expected_version: expectedVersion, reason: input.reason, resolution: input.resolution },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        return this.aftersaleReplay(
          transaction,
          request,
          claimed.record,
          aftersaleId,
          'continue-refund-after-return',
        );
      }
      const result = await this.repositories().aftersales.continueRefundAfterReturnInTransaction(
        transaction,
        {
          actorAccountId: request.principal.accountId,
          aftersaleId,
          expectedVersion,
          reason: input.reason,
        },
      );
      await this.appendAftersaleAudit(
        transaction,
        request,
        idempotencyKey,
        'CONTINUE_REFUND',
        result.audit,
        result.aftersale.aftersaleId,
        input.reason,
      );
      await this.completeAftersaleCommand(
        transaction,
        claim,
        result.aftersale.aftersaleId,
        'continue-refund-after-return',
      );
      return this.commandView(result.aftersale);
    });
  }

  previewRejectAfterReturn(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminRejectAfterReturnRequest,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.rejectAfterReturnPreview,
      { aftersale_id: aftersaleId },
      { reason: input.reason, resolution: input.resolution },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw sensitivePreviewReplay('Aftersale return rejection');
      }
      const impact = await this.repositories().aftersales.previewRejectAfterReturnInTransaction(
        transaction,
        { aftersaleId },
      );
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'AFTERSALE.REJECT_AFTER_RETURN',
        actorId: request.principal.accountId,
        previewToken,
        request: rejectAfterReturnRequest(input, impact),
        resourceVersion: impact.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: aftersaleId,
        targetType: 'AFTERSALE',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: this.rejectAfterReturnImpactView(impact),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(impact.resourceVersion),
      };
      await this.repositories().idempotency.complete(transaction, claim, {
        resourceId: aftersaleId,
        responseForHash: { impact: response.impact, resource_etag: response.resource_etag },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  rejectAfterReturn(
    request: AdminCatalogRequestContext,
    aftersaleId: string,
    input: AdminRejectAfterReturnConfirmationRequest,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.rejectAfterReturn,
      { aftersale_id: aftersaleId },
      {
        confirmation_hash: input.confirmationHash,
        expected_version: expectedVersion,
        preview_token: input.previewToken,
        reason: input.reason,
        resolution: input.resolution,
      },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        return this.aftersaleReplay(
          transaction,
          request,
          claimed.record,
          aftersaleId,
          'reject-after-return',
        );
      }
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST',
        route: ROUTES.rejectAfterReturnPreview,
      });
      const result = await this.repositories().aftersales.rejectAfterReturnInTransaction(
        transaction,
        {
          actorAccountId: request.principal.accountId,
          aftersaleId,
          expectedVersion,
          reason: input.reason,
        },
        {
          verifyPreview: (impact) => this.repositories().previews.consumeInTransaction(transaction, {
            action: 'AFTERSALE.REJECT_AFTER_RETURN',
            actorId: request.principal.accountId,
            confirmationHash: input.confirmationHash,
            previewToken: input.previewToken,
            request: rejectAfterReturnRequest(input, impact),
            resourceVersion: impact.resourceVersion,
            sessionId: request.accessSession.sessionId,
            targetId: aftersaleId,
            targetType: 'AFTERSALE',
          }),
        },
      );
      await this.appendAftersaleAudit(
        transaction,
        request,
        idempotencyKey,
        'REJECT_AFTER_RETURN',
        result.audit,
        result.aftersale.aftersaleId,
        input.reason,
      );
      await this.completeAftersaleCommand(
        transaction,
        claim,
        result.aftersale.aftersaleId,
        'reject-after-return',
      );
      return this.commandView(result.aftersale);
    });
  }

  async getReturnAddress() {
    return this.returnAddressView(await this.repositories().returnAddresses.readCurrent());
  }

  previewReturnAddress(
    request: AdminCatalogRequestContext,
    input: AdminReturnAddressAction,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.returnAddressPreview,
      {},
      addressAction(input),
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      if ((await this.repositories().idempotency.claim(transaction, claim)).kind === 'replay') {
        throw sensitivePreviewReplay('Return address');
      }
      const snapshot = await this.repositories().returnAddresses.previewPublishInTransaction(transaction);
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.repositories().previews.issueInTransaction(transaction, {
        action: 'RETURN_ADDRESS.PUBLISH',
        actorId: request.principal.accountId,
        previewToken,
        request: addressPreviewRequest(input, snapshot),
        resourceVersion: snapshot.resourceVersion,
        sessionId: request.accessSession.sessionId,
        targetId: RETURN_ADDRESS_SINGLETON_ID,
        targetType: 'RETURN_ADDRESS',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: this.returnAddressImpactView(snapshot),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(snapshot.resourceVersion),
      };
      await this.repositories().idempotency.complete(transaction, claim, {
        responseForHash: { impact: response.impact, resource_etag: response.resource_etag },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return response;
    });
  }

  publishReturnAddress(
    request: AdminCatalogRequestContext,
    input: AdminReturnAddressConfirmation,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const claim = this.claim(
      request,
      idempotencyKey,
      'PATCH',
      ROUTES.returnAddress,
      {},
      {
        ...addressAction(input),
        confirmation_hash: input.confirmationHash,
        expected_version: expectedVersion,
        preview_token: input.previewToken,
      },
    );
    return runSerializableTransaction(this.runtime().database.prisma, async (transaction) => {
      const claimed = await this.repositories().idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const resourceId = claimed.record.resource_id;
        if (resourceId === null) throw internal('Return address replay resource is missing');
        const current = await this.repositories().returnAddresses.getForReplayInTransaction(
          transaction,
          request.principal.accountId,
          resourceId,
        );
        this.repositories().idempotency.assertHashOnlyReplay(claimed.record, {
          resourceId,
          responseForHash: this.returnAddressCommandHash(resourceId),
          responseStatus: 200,
          storage: 'HASH_ONLY',
        });
        return this.returnAddressView(current);
      }
      await this.repositories().idempotency.assertKeyNotUsedForRequest(transaction, claim, {
        method: 'POST',
        route: ROUTES.returnAddressPreview,
      });
      const expectedFacts = await this.repositories().returnAddresses.previewPublishInTransaction(transaction);
      const result = await this.repositories().returnAddresses.publishInTransaction(transaction, {
        actorAccountId: request.principal.accountId,
        city: input.city,
        district: input.district,
        expectedCurrentPublishedId: expectedFacts.currentPublishedId,
        expectedMaxVersionNo: expectedFacts.maxVersionNo,
        expectedVersion,
        province: input.province,
        reason: input.reason,
        recipientName: input.recipientName,
      }, {
        protectVersion: ({ versionId }) => createReturnAddressVersionSecurityMaterial({
          detail: input.detail,
          phone: input.phone,
          versionId,
        }, this.runtime().config.encryption.fieldKeys.current),
        verifyPreview: (snapshot) => this.repositories().previews.consumeInTransaction(transaction, {
          action: 'RETURN_ADDRESS.PUBLISH',
          actorId: request.principal.accountId,
          confirmationHash: input.confirmationHash,
          previewToken: input.previewToken,
          request: addressPreviewRequest(input, snapshot),
          resourceVersion: snapshot.resourceVersion,
          sessionId: request.accessSession.sessionId,
          targetId: RETURN_ADDRESS_SINGLETON_ID,
          targetType: 'RETURN_ADDRESS',
        }),
      });
      await this.appendReturnAddressAudit(transaction, request, idempotencyKey, result, input.reason);
      await this.repositories().idempotency.complete(transaction, claim, {
        resourceId: result.address.versionId,
        responseForHash: this.returnAddressCommandHash(result.address.versionId),
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return this.returnAddressView(result.address);
    });
  }

  private repositories() {
    if (!this.aftersales || !this.audit || !this.idempotency || !this.previews || !this.returnAddresses) {
      throw internal('Admin aftersales repositories are unavailable');
    }
    return {
      aftersales: this.aftersales,
      audit: this.audit,
      idempotency: this.idempotency,
      previews: this.previews,
      returnAddresses: this.returnAddresses,
    };
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) throw internal('Admin aftersales runtime is unavailable');
    return { config: this.config, database: this.database };
  }

  private claim(
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    method: 'PATCH' | 'POST',
    route: string,
    pathParameters: Record<string, string>,
    body: unknown,
  ): IdempotencyClaim {
    return {
      actorId: request.principal.accountId,
      idempotencyKey,
      request: { body, method, pathParameters, route },
    };
  }

  private async aftersaleReplay(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    record: Extract<IdempotencyClaimResult, { kind: 'replay' }>['record'],
    aftersaleId: string,
    command: AftersaleCommand,
  ) {
    if (record.resource_id !== aftersaleId) throw internal('Admin aftersale replay resource is invalid');
    const current = await this.repositories().aftersales.getForReplayInTransaction(transaction, {
      actorAccountId: request.principal.accountId,
      aftersaleId,
    });
    this.repositories().idempotency.assertHashOnlyReplay(record, {
      resourceId: aftersaleId,
      responseForHash: this.aftersaleCommandHash(aftersaleId, command),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    return this.commandView(current);
  }

  private aftersaleCommandHash(aftersaleId: string, command: AftersaleCommand) {
    if (command === 'approve') return { aftersale_approved: { aftersale_id: aftersaleId } };
    if (command === 'reject') return { aftersale_rejected: { aftersale_id: aftersaleId } };
    if (command === 'record-return-inspection') {
      return { return_inspection_recorded: { aftersale_id: aftersaleId } };
    }
    return {
      aftersale_return_resolved: {
        aftersale_id: aftersaleId,
        resolution: command === 'continue-refund-after-return'
          ? 'CONTINUE_REFUND'
          : 'REJECT_AFTER_RETURN',
      },
    };
  }

  private completeAftersaleCommand(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    aftersaleId: string,
    command: AftersaleCommand,
  ) {
    return this.repositories().idempotency.complete(transaction, claim, {
      resourceId: aftersaleId,
      responseForHash: this.aftersaleCommandHash(aftersaleId, command),
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  }

  private returnAddressCommandHash(versionId: string) {
    return { return_address_published: { version_id: versionId } };
  }

  private rejectImpactView(impact: AdminAftersaleRejectImpactSnapshot) {
    return {
      affected_count: impact.affectedCount,
      metrics: [
        { after: 'REJECTED', before: 'PENDING_REVIEW', key: 'status', label: 'Status' },
        {
          after: '0',
          before: String(impact.releaseQuantity),
          key: 'reserved_quantity',
          label: 'Reserved quantity',
        },
        {
          after: '0.00',
          before: impact.releaseAmount,
          key: 'reserved_amount',
          label: 'Reserved amount',
        },
      ],
      warnings: ['Reserved aftersale quantity and amount will be released'],
    };
  }

  private rejectAfterReturnImpactView(impact: AdminAftersaleRejectAfterReturnImpactSnapshot) {
    return {
      affected_count: impact.affectedCount,
      metrics: [
        {
          after: 'REJECTED_AFTER_RETURN',
          before: 'RETURN_EXCEPTION',
          key: 'status',
          label: 'Status',
        },
        {
          after: '0',
          before: String(impact.releaseQuantity),
          key: 'reserved_quantity',
          label: 'Reserved quantity released',
        },
        {
          after: '0.00',
          before: impact.releaseAmount,
          key: 'reserved_amount',
          label: 'Reserved amount released',
        },
      ],
      warnings: [
        'The sealed return inspection remains immutable',
        'Remaining aftersale quantity and amount reservations will be released',
      ],
    };
  }

  private returnAddressImpactView(snapshot: ReturnAddressPublishPreviewSnapshot) {
    return {
      affected_count: 1,
      metrics: [
        {
          after: String(snapshot.maxVersionNo + 1),
          before: String(snapshot.maxVersionNo),
          key: 'version_no',
          label: 'Return address version',
        },
        {
          after: 'PUBLISHED',
          before: snapshot.current === null ? null : 'PUBLISHED',
          key: 'status',
          label: 'Published status',
        },
      ],
      warnings: ['Existing aftersale return-address snapshots will remain unchanged'],
    };
  }

  private commandView(resource: AdminAftersaleCommandSnapshot) {
    return {
      aftersale_id: resource.aftersaleId,
      aftersale_no: resource.aftersaleNo,
      inspection: this.inspectionView(resource.inspection),
      items: resource.items.map((item) => ({
        aftersale_item_id: item.aftersaleItemId,
        allocated_amount: item.allocatedAmount,
        approved_refund_qty: item.approvedRefundQuantity,
        order_item_id: item.orderItemId,
        quantity: item.quantity,
        reserved_amount: item.reservedAmount,
        reserved_quantity: item.reservedQuantity,
      })),
      order_id: resource.orderId,
      refund_id: resource.refundId,
      status: resource.status,
      type: resource.type,
      version: resource.version,
    };
  }

  private detailView(resource: AdminAftersaleDetailSnapshot) {
    const order = resource.orderDetail.order;
    const refundAttempts = resource.refundAttempts.map((attempt) => ({
      amount: attempt.amount,
      attempt_no: attempt.attemptNo,
      created_at: attempt.requestedAt.toISOString(),
      last_error: this.refundError(attempt.failureCode, attempt.finishedAt ?? attempt.requestedAt),
      origin_type: 'AFTERSALE' as const,
      refund_id: attempt.refundId,
      refund_no: attempt.refundNo,
      status: attempt.status,
      updated_at: (attempt.finishedAt ?? attempt.requestedAt).toISOString(),
    }));
    return {
      aftersale_id: resource.aftersaleId,
      aftersale_no: resource.aftersaleNo,
      application_evidence_file_ids: resource.applicationEvidenceFileIds,
      available_actions: resource.availableActions,
      commission_impact: resource.commissionImpact.map((impact) => ({
        commission_snapshot_id: impact.commissionSnapshotId,
        expected_remaining: impact.expectedRemaining,
        latest_state: impact.latestState,
        order_item_id: impact.orderItemId,
        original_commission: impact.originalCommission,
        reversed_total: impact.reversedTotal,
      })),
      created_at: resource.createdAt.toISOString(),
      customer: {
        customer_alias: resource.orderDetail.customer.customerAlias,
        customer_id: resource.orderDetail.customer.customerId,
        nickname_masked: resource.orderDetail.customer.nicknameMasked,
        phone_masked: resource.orderDetail.customer.phoneMasked,
      },
      errors: refundAttempts
        .map(({ last_error: error }) => error)
        .filter((error): error is NonNullable<typeof error> => error !== null),
      inspection: this.inspectionView(resource.inspection),
      inventory_impact: resource.inventoryImpact.map((impact) => ({
        available_change: impact.availableChange,
        on_hand_change: impact.onHandChange,
        reason: impact.reasons.join(',') || 'AFTERSALE',
        reserved_change: impact.reservedChange,
        sku_id: impact.skuId,
      })),
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
        order_id: order.orderId,
        order_no: order.orderNo,
        state: {
          close_reason: order.closeReason,
          completion_reason: order.completionReason,
          display_status: projectOrderDisplayStatus(order),
          fulfillment_status: order.fulfillmentStatus,
          order_status: order.orderStatus,
          payment_resolution: order.paymentResolution,
          payment_status: order.paymentStatus,
          refund_processing_status: order.refundProcessingStatus,
          refund_progress_status: order.refundProgressStatus,
        },
      },
      reason: resource.reasonText ?? resource.reasonCode,
      refund_attempts: refundAttempts,
      return_address_snapshot: this.snapshotView(resource.returnAddress),
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
        operator_role: this.timelineRole(event.actorRole),
        to_status: event.toStatus,
      })),
      type: resource.type,
      version: resource.version,
    };
  }

  private snapshotView(resource: AdminAftersaleDetailSnapshot['returnAddress']) {
    if (resource === null) return null;
    let plaintext: ReturnType<typeof verifyReturnAddressSnapshotSecurityMaterial>;
    try {
      plaintext = verifyReturnAddressSnapshotSecurityMaterial({
        detailCiphertext: resource.detailCiphertext,
        encryptionKeyId: resource.encryptionKeyId,
        phoneCiphertext: resource.phoneCiphertext,
        phoneLast4: resource.phoneLast4,
        recordId: resource.snapshotId,
      }, this.runtime().config.encryption.fieldKeys);
    } catch (error) {
      throw internal('Aftersale return address snapshot could not be verified', error);
    }
    return {
      city: resource.city,
      detail: plaintext.detail,
      district: resource.district,
      phone: plaintext.phone,
      province: resource.province,
      recipient_name: resource.recipientName,
    };
  }

  private returnAddressView(resource: ReturnAddressVersionMaterial) {
    let plaintext: ReturnType<typeof verifyReturnAddressVersionSecurityMaterial>;
    try {
      plaintext = verifyReturnAddressVersionSecurityMaterial({
        detailCiphertext: resource.detailCiphertext,
        encryptionKeyId: resource.encryptionKeyId,
        phoneCiphertext: resource.phoneCiphertext,
        phoneLast4: resource.phoneLast4,
        recordId: resource.versionId,
      }, this.runtime().config.encryption.fieldKeys);
    } catch (error) {
      throw internal('Published return address could not be verified', error);
    }
    return {
      city: resource.city,
      detail_masked: plaintext.detailMasked,
      district: resource.district,
      effective_at: resource.effectiveAt.toISOString(),
      phone_masked: plaintext.phoneMasked,
      province: resource.province,
      recipient_name: resource.recipientName,
      version: resource.version,
      version_id: resource.versionId,
      version_no: resource.versionNo,
    };
  }

  private inspectionView(inspection: AdminAftersaleDetailSnapshot['inspection']) {
    if (inspection === null) return null;
    return {
      abnormal_reason: inspection.abnormalReason,
      evidence_file_ids: inspection.evidenceFileIds,
      inspected_at: inspection.inspectedAt.toISOString(),
      inspected_by: {
        account_id: inspection.inspectedBy.accountId,
        display_name: inspection.inspectedBy.displayName,
      },
      inspection_id: inspection.inspectionId,
      items: inspection.items.map((item) => ({
        approved_refund_qty: item.approvedRefundQuantity,
        damaged_qty: item.damagedQuantity,
        note: item.note,
        order_item_id: item.orderItemId,
        received_qty: item.receivedQuantity,
        restock_qty: item.restockQuantity,
        return_to_customer_qty: item.returnToCustomerQuantity,
        scrap_qty: item.scrapQuantity,
      })),
      resolution: inspection.resolution,
      resolution_reason: inspection.resolutionReason,
      resolved_at: inspection.resolvedAt?.toISOString() ?? null,
      result: inspection.result,
    };
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

  private timelineRole(role: AdminAftersaleDetailSnapshot['timeline'][number]['actorRole']) {
    if (role === null) return 'SYSTEM' as const;
    if (role === 'CUSTOMER' || role === 'SUPER_ADMIN') return role;
    throw internal('Stored aftersale timeline actor role is not Admin-visible');
  }

  private appendAftersaleAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    action: 'APPROVE' | 'CONTINUE_REFUND' | 'RECORD_INSPECTION' | 'REJECT' | 'REJECT_AFTER_RETURN',
    audit: { after: { status: string; version: number }; before: { status: string; version: number } },
    aftersaleId: string,
    reason?: string,
  ) {
    const ipAddress = catalogRequestIp(request);
    return this.repositories().audit.append(transaction, {
      action,
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: audit.after,
      before: audit.before,
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'aftersale',
      objectId: aftersaleId,
      objectType: 'aftersale',
      ...(reason === undefined ? {} : { reason }),
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendReturnAddressAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    result: {
      address: ReturnAddressVersionMaterial;
      audit: { after: { status: 'PUBLISHED'; version: number }; before: null | {
        status: 'PUBLISHED'; version: number;
      } };
    },
    reason: string,
  ) {
    const ipAddress = catalogRequestIp(request);
    return this.repositories().audit.append(transaction, {
      action: 'PUBLISH',
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: result.audit.after,
      ...(result.audit.before === null ? {} : { before: result.audit.before }),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'config',
      objectId: result.address.versionId,
      objectType: 'return_address',
      reason,
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }
}
