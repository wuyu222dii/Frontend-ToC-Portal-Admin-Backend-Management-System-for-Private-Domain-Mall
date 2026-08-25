import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CacheableCommandResponse,
  type DatabaseRuntime,
  type DatabaseTransaction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  type InventoryAdjustmentImpact,
  type InventoryAdjustmentResult,
  type InventoryLedgerSnapshot,
  InventoryRepository,
  type InventorySnapshot,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, formatVersionEtag, generateUlid } from '@qingxu/platform-core';

import { catalogRequestIp, type AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import type {
  InventoryAdjustmentConfirmationInput,
  InventoryAdjustmentInput,
  InventoryLedgerListInput,
  InventoryListInput,
} from './admin-inventory.dto';

const ROUTES = {
  adjustment: '/admin/inventory/{sku_id}/adjustments',
  preview: '/admin/inventory/{sku_id}/adjustment-preview',
} as const;

function normalizedAdjustment(input: InventoryAdjustmentInput) {
  return { physical_delta: input.physicalDelta, reason: input.reason };
}

function preEnvelopedCommand(response: CacheableCommandResponse) {
  return preEnvelopedResponse<CacheableCommandResponse['data']>(response);
}

@Injectable()
export class AdminInventoryService {
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly inventory!: InventoryRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.inventory = new InventoryRepository(database.prisma);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
    }
  }

  async listInventory(input: InventoryListInput) {
    this.runtime();
    const result = await this.inventory.listInventory(input);
    return {
      items: result.items.map((item) => this.inventoryView(item)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async listLedger(skuId: string, input: InventoryLedgerListInput) {
    this.runtime();
    const result = await this.inventory.listLedger({ ...input, skuId });
    return {
      items: result.items.map((item) => this.ledgerView(item)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async previewAdjustment(
    request: AdminCatalogRequestContext,
    skuId: string,
    input: InventoryAdjustmentInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const requestBody = normalizedAdjustment(input);
    const claim = this.claim(request, idempotencyKey, ROUTES.preview, skuId, requestBody);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Inventory preview must use a new idempotency key');
      }
      const impact = await this.inventory.getAdjustmentImpactInTransaction(transaction, {
        physicalDelta: input.physicalDelta,
        skuId,
      });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.previews.issueInTransaction(transaction, {
        action: 'INVENTORY.ADJUST',
        actorId: request.principal.accountId,
        previewToken,
        request: requestBody,
        resourceVersion: impact.version,
        sessionId: request.accessSession.sessionId,
        targetId: skuId,
        targetType: 'INVENTORY',
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: this.impactView(impact),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(impact.version),
      };
      await this.idempotency.complete(transaction, claim, {
        resourceId: skuId,
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

  async confirmAdjustment(
    request: AdminCatalogRequestContext,
    skuId: string,
    input: InventoryAdjustmentConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const requestBody = normalizedAdjustment(input);
    const claim = this.claim(
      request,
      idempotencyKey,
      ROUTES.adjustment,
      skuId,
      {
        ...requestBody,
        confirmation_hash: input.confirmationHash,
        expected_version: expectedVersion,
        preview_token: input.previewToken,
      },
    );
    const ledgerId = generateUlid();
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.commandReplay(
        await this.idempotency.claim(transaction, claim),
        skuId,
      );
      if (replay !== null) return preEnvelopedCommand(replay);
      await this.previews.consumeInTransaction(transaction, {
        action: 'INVENTORY.ADJUST',
        actorId: request.principal.accountId,
        confirmationHash: input.confirmationHash,
        previewToken: input.previewToken,
        request: requestBody,
        resourceVersion: expectedVersion,
        sessionId: request.accessSession.sessionId,
        targetId: skuId,
        targetType: 'INVENTORY',
      });
      const result = await this.inventory.applyAdjustmentInTransaction(transaction, {
        actorId: request.principal.accountId,
        expectedVersion,
        ledgerId,
        physicalDelta: input.physicalDelta,
        reason: input.reason,
        skuId,
      });
      const response = this.commandResponse(request.requestId, result);
      await this.appendAudit(transaction, request, idempotencyKey, expectedVersion, result, input.reason);
      await this.appendOutbox(transaction, result);
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedCommand(response);
    });
  }

  private runtime(): { config: PlatformRuntimeConfig; database: DatabaseRuntime } {
    if (!this.config || !this.database) {
      throw new ApplicationError('INTERNAL_ERROR', 'Admin inventory runtime is unavailable');
    }
    return { config: this.config, database: this.database };
  }

  private inventoryView(item: InventorySnapshot) {
    return {
      active_reservation_qty: item.activeReservationQty,
      available_qty: item.availableQty,
      locked_qty: item.lockedQty,
      physical_qty: item.physicalQty,
      product_name: item.productName,
      sku_code: item.skuCode,
      sku_id: item.skuId,
      sku_name: item.skuName,
      sku_status: item.skuStatus,
      version: item.version,
    };
  }

  private ledgerView(item: InventoryLedgerSnapshot) {
    return {
      ledger_id: item.id,
      ledger_type: item.type,
      locked_after: item.lockedAfter,
      locked_before: item.lockedBefore,
      locked_change: item.lockedChange,
      occurred_at: item.occurredAt.toISOString(),
      physical_after: item.physicalAfter,
      physical_before: item.physicalBefore,
      physical_change: item.physicalChange,
      reason: item.reason,
    };
  }

  private impactView(impact: InventoryAdjustmentImpact) {
    return {
      affected_count: 1 as const,
      available_after: impact.availableAfter,
      available_before: impact.availableBefore,
      locked_after: impact.lockedAfter,
      locked_before: impact.lockedBefore,
      physical_after: impact.physicalAfter,
      physical_before: impact.physicalBefore,
      warnings: [...impact.warnings],
    };
  }

  private claim(
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    route: string,
    skuId: string,
    body: unknown,
  ): IdempotencyClaim {
    return {
      actorId: request.principal.accountId,
      idempotencyKey,
      request: {
        body,
        method: 'POST',
        pathParameters: { sku_id: skuId },
        route,
      },
    };
  }

  private commandReplay(
    claimed: Awaited<ReturnType<IdempotencyRepository['claim']>>,
    skuId: string,
  ): CacheableCommandResponse | null {
    if (claimed.kind !== 'replay') return null;
    if (claimed.record.response_status !== 200) {
      throw new ApplicationError('INTERNAL_ERROR', 'Inventory command replay status is invalid');
    }
    const response = this.idempotency.commandReplay(claimed.record);
    if (response.data.resource_type !== 'inventory' || response.data.resource_id !== skuId ||
      response.data.status !== 'SUCCEEDED') {
      throw new ApplicationError('INTERNAL_ERROR', 'Inventory command replay target is invalid');
    }
    return response;
  }

  private commandResponse(
    requestId: string,
    result: InventoryAdjustmentResult,
  ): CacheableCommandResponse {
    return {
      code: 'OK',
      data: {
        occurred_at: result.ledger.occurredAt.toISOString(),
        resource_id: result.impact.skuId,
        resource_type: 'inventory',
        status: 'SUCCEEDED',
        version: result.impact.version,
      },
      message: 'success',
      request_id: requestId,
    };
  }

  private async appendAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    expectedVersion: number,
    result: InventoryAdjustmentResult,
    reason: string,
  ): Promise<void> {
    const ipAddress = catalogRequestIp(request);
    await this.audit.append(transaction, {
      action: 'ADJUST',
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: { version: result.impact.version },
      before: { version: expectedVersion },
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'inventory',
      objectId: result.impact.skuId,
      objectType: 'inventory',
      reason,
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendOutbox(
    transaction: DatabaseTransaction,
    result: InventoryAdjustmentResult,
  ) {
    return this.outbox.append(transaction, {
      aggregateId: result.impact.skuId,
      aggregateType: 'inventory',
      eventType: 'inventory.adjusted',
      payload: {
        event_version: 1,
        resource_id: result.impact.skuId,
        resource_type: 'inventory',
        resource_version: result.impact.version,
      },
    });
  }
}
