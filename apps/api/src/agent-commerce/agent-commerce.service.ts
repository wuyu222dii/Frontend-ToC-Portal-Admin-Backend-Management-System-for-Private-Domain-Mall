import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AgentCommerceRepository,
  type AgentProductImageSnapshot,
  type AgentProductSnapshot,
  type AgentPromotionAssetSnapshot,
  AuditRepository,
  buildFinalObjectKey,
  buildStagingObjectKey,
  type CurrentAgentSession,
  type DatabaseRuntime,
  FILE_STAGING_CLEANUP_EVENT_TYPE,
  FileAssetRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  type IdempotencyClaimResult,
  OutboxRepository,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import { ObjectStorageError, type ObjectStoragePort } from '@qingxu/storage';
import QRCode from 'qrcode';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import { decryptAgentInviteCode } from '../platform/security/agent-security';
import { storeSkuSpecification } from '../store-catalog/store-sku-specification';
import { FileObjectLeaseManager } from '../files/file-object-lease';
import type { AgentProductListInput, CreatePromotionAssetInput } from './agent-commerce.dto';

const ROUTE = '/agent/promotion-assets';
type ReplayRecord = Extract<IdempotencyClaimResult, { kind: 'replay' }>['record'];

function storageFailure(): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', 'Promotion QR storage operation failed');
}

function fallbackUrl(baseUrl: string, input: CreatePromotionAssetInput): string {
  const url = new URL(baseUrl);
  if (input.targetType === 'PRODUCT') {
    url.pathname = `${url.pathname.replace(/\/$/, '')}/products/${input.targetId}`;
  }
  const value = url.toString();
  if (value.length > 500) throw new ApplicationError('INTERNAL_ERROR', 'Promotion target URL is too long');
  return value;
}

function shareUrl(publicTargetUrl: string, inviteCode: string, promotionAssetId: string): string {
  const url = new URL(publicTargetUrl);
  url.searchParams.set('invite_code', inviteCode);
  url.searchParams.set('promotion_asset_id', promotionAssetId);
  return url.toString();
}

@Injectable()
export class AgentCommerceService {
  private readonly logger = new Logger('AgentCommerceService');
  private readonly commerce!: AgentCommerceRepository;
  private readonly files!: FileAssetRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
    @Optional() @Inject(FileObjectLeaseManager) private readonly leases?: FileObjectLeaseManager,
  ) {
    if (config && database) {
      this.commerce = new AgentCommerceRepository(database.prisma);
      this.files = new FileAssetRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
    }
  }

  async listProducts(session: CurrentAgentSession, input: AgentProductListInput) {
    const { commerce } = this.runtime();
    const result = await commerce.listAuthorizedProducts({
      accountId: session.accountId,
      agentId: session.agentId,
      ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.keyword === undefined ? {} : { keyword: input.keyword }),
      page: input.page,
      pageSize: input.pageSize,
      ...(input.recommended === undefined ? {} : { recommended: input.recommended }),
    });
    return {
      items: result.items.map((product) => this.productView(product)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getProduct(session: CurrentAgentSession, productId: string) {
    const { commerce } = this.runtime();
    return this.productView(await commerce.getAuthorizedProduct({
      accountId: session.accountId,
      agentId: session.agentId,
      productId,
    }));
  }

  async createPromotionAsset(
    session: CurrentAgentSession,
    input: CreatePromotionAssetInput,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const { commerce, config, database, storage } = this.runtime();
    const claim = this.claim(session.accountId, idempotencyKey, input);
    const prior = await runSerializableTransaction(database.prisma, async (transaction) => {
      const result = await this.idempotency.claim(transaction, claim);
      return result.kind === 'replay' ? result.record : null;
    });
    if (prior) return this.replay(session, prior);

    const promotionAssetId = generateUlid();
    const fileId = generateUlid();
    const context = await commerce.getPromotionCreationContext({
      accountId: session.accountId,
      agentId: session.agentId,
      targetProductId: input.targetId,
      targetType: input.targetType,
    });
    const inviteCode = decryptAgentInviteCode(
      context.inviteCode.id,
      Buffer.from(context.inviteCode.ciphertext),
      context.inviteCode.encryptionKeyId,
      config.encryption.fieldKeys,
    );
    const publicTargetUrl = fallbackUrl(config.promotion.publicBaseUrl, input);
    const promotionUrl = shareUrl(publicTargetUrl, inviteCode, promotionAssetId);
    let qr: Buffer;
    try {
      qr = await QRCode.toBuffer(promotionUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        type: 'png',
        width: 512,
      });
    } catch {
      throw new ApplicationError('INTERNAL_ERROR', 'Promotion QR generation failed');
    }
    if (qr.length < 1 || qr.length > config.storage.maxUploadBytes) {
      throw new ApplicationError('INTERNAL_ERROR', 'Promotion QR size is invalid');
    }
    const sha256 = createHash('sha256').update(qr).digest('hex');
    const stagingKey = buildStagingObjectKey(fileId);
    const finalKey = buildFinalObjectKey(fileId, 'PROMOTION_QR');
    await runSerializableTransaction(database.prisma, (transaction) =>
      this.files.createPendingInTransaction(transaction, {
        actorId: session.accountId,
        byteSize: BigInt(qr.length),
        id: fileId,
        mimeType: 'image/png',
        originalName: 'promotion-qr.png',
        purpose: 'PROMOTION_QR',
        sha256,
      }));
    const lease = await this.leaseManager().acquire(fileId);
    try {
      const signed = await storage.presignPut({
        byteSize: qr.length,
        expiresInSeconds: config.storage.uploadTtlSeconds,
        key: stagingKey,
        mimeType: 'image/png',
        sha256Hex: sha256,
      });
      let uploaded: Response;
      try {
        uploaded = await fetch(signed.url, {
          body: new Uint8Array(qr),
          headers: Object.fromEntries(signed.headers.map(({ name, value }) => [name, value])),
          method: 'PUT',
        });
      } catch {
        throw storageFailure();
      }
      if (!uploaded.ok) {
        await uploaded.body?.cancel();
        throw storageFailure();
      }
      const measured = await storage.inspectAndHash({ key: stagingKey, maxBytes: config.storage.maxUploadBytes });
      if (measured.byteSize !== qr.length || measured.mimeType !== 'image/png' || measured.sha256Hex !== sha256) {
        throw storageFailure();
      }
      await lease.assertOwned();
      const copied = await storage.copyIfAbsent({
        ...measured,
        destinationKey: finalKey,
        sourceKey: stagingKey,
      });
      if (copied.verified.byteSize !== qr.length || copied.verified.mimeType !== 'image/png' ||
        copied.verified.sha256Hex !== sha256) {
        throw storageFailure();
      }
      await lease.assertOwned();
      const outcome = await runSerializableTransaction(database.prisma, async (transaction) => {
        const result = await this.idempotency.claim(transaction, claim);
        if (result.kind === 'replay') return result;
        const asset = await commerce.createPromotionAssetInTransaction(transaction, {
          accountId: session.accountId,
          agentId: session.agentId,
          inviteCodeId: context.inviteCode.id,
          promotionAssetId,
          publicUrl: publicTargetUrl,
          qrFile: { byteSize: BigInt(qr.length), fileId, sha256 },
          targetProductId: input.targetId,
          targetType: input.targetType,
        });
        await this.audit.append(transaction, {
          action: 'CREATE',
          actorAccountId: session.accountId,
          actorRole: 'AGENT_ADMIN',
          idempotencyKey,
          ...(ipAddress === undefined ? {} : { ipAddress }),
          module: 'promotion',
          objectId: asset.id,
          objectType: 'promotion',
          requestId,
          result: 'SUCCESS',
          resultCode: 'OK',
          summaryPolicy: 'NONE',
        });
        await this.outbox.append(transaction, {
          aggregateId: asset.id,
          aggregateType: 'promotion',
          eventType: 'promotion.asset.created',
          payload: {
            event_version: 1,
            resource_id: asset.id,
            resource_type: 'promotion',
            resource_version: asset.authorizationVersion,
          },
        });
        await this.outbox.append(transaction, {
          aggregateId: fileId,
          aggregateType: 'file',
          availableAt: new Date(
            asset.createdAt.getTime() +
            (config.storage.uploadTtlSeconds + config.storage.pendingCleanupAgeSeconds) * 1_000 + 60_000,
          ),
          eventType: FILE_STAGING_CLEANUP_EVENT_TYPE,
          payload: { event_version: 1, resource_id: fileId, resource_type: 'file', resource_version: 1 },
        });
        await this.idempotency.complete(transaction, claim, this.hashOnlyResult(asset));
        return { kind: 'created' as const, asset };
      });
      if (outcome.kind === 'replay') {
        await this.cleanup(storage, stagingKey, copied.copied ? finalKey : undefined);
        return this.replay(session, outcome.record);
      }
      await this.cleanup(storage, stagingKey);
      return this.promotionView(outcome.asset, config);
    } catch (error) {
      if (error instanceof ObjectStorageError) throw storageFailure();
      throw error;
    } finally {
      await lease.release();
    }
  }

  private async replay(session: CurrentAgentSession, record: ReplayRecord) {
    const { commerce, config } = this.runtime();
    if (record.resource_id === null) {
      throw new ApplicationError('INTERNAL_ERROR', 'Promotion idempotency record is incomplete');
    }
    const asset = await commerce.getPromotionAsset({
      accountId: session.accountId,
      agentId: session.agentId,
      promotionAssetId: record.resource_id,
    });
    this.idempotency.assertHashOnlyReplay(record, this.hashOnlyResult(asset));
    return this.promotionView(asset, config);
  }

  private productView(product: AgentProductSnapshot) {
    return {
      brand: {
        brand_id: product.brand.id,
        description: product.brand.description,
        logo_url: product.brand.logoObjectKey === null ? null : this.runtime().storage.publicUrl(product.brand.logoObjectKey),
        name: product.brand.name,
        sort_order: product.brand.sortOrder,
      },
      category: {
        category_id: product.category.id,
        icon_url: product.category.iconObjectKey === null
          ? null
          : this.runtime().storage.publicUrl(product.category.iconObjectKey),
        name: product.category.name,
        sort_order: product.category.sortOrder,
      },
      images: product.images.map((image) => this.imageView(image)),
      name: product.name,
      primary_image: product.primaryImage === null ? null : this.imageView(product.primaryImage),
      product_id: product.id,
      skus: product.skus.map((sku) => ({
        code: sku.code,
        commission_label: sku.currentEstimatedRate === '0.0000'
          ? '无佣金'
          : '预计佣金，以支付时规则为准',
        current_estimated_rate: sku.currentEstimatedRate,
        estimated_commission_per_unit: sku.estimatedCommissionPerUnit,
        name: sku.name,
        retail_price: sku.retailPrice,
        rule_source: sku.ruleSource,
        rule_version_id: sku.ruleVersionId,
        sku_id: sku.id,
        spec_json: storeSkuSpecification(sku.specification),
      })),
      spu_code: product.spuCode,
      subtitle: product.subtitle,
    };
  }

  private imageView(image: AgentProductImageSnapshot) {
    return {
      is_primary: image.isPrimary,
      sort_order: image.sortOrder,
      url: this.runtime().storage.publicUrl(image.objectKey),
    };
  }

  private promotionView(asset: AgentPromotionAssetSnapshot, config: PlatformRuntimeConfig) {
    const inviteCode = decryptAgentInviteCode(
      asset.inviteCode.id,
      Buffer.from(asset.inviteCode.ciphertext),
      asset.inviteCode.encryptionKeyId,
      config.encryption.fieldKeys,
    );
    return {
      attribution_eligible: asset.attributionEligible,
      expires_at: asset.expiresAt?.toISOString() ?? null,
      promotion_asset_id: asset.id,
      public_url: shareUrl(asset.publicUrl, inviteCode, asset.id),
      qr_file: {
        file_id: asset.qrFile.id,
        purpose: 'PROMOTION_QR' as const,
        status: 'READY' as const,
        visibility: 'PRIVATE' as const,
      },
      target_id: asset.targetProductId,
      target_type: asset.targetType,
    };
  }

  private hashOnlyResult(asset: AgentPromotionAssetSnapshot) {
    return {
      resourceId: asset.id,
      responseForHash: {
        agent_id: asset.agentId,
        authorization_version: asset.authorizationVersion,
        expires_at: asset.expiresAt?.toISOString() ?? null,
        promotion_asset_id: asset.id,
        public_target_url: asset.publicUrl,
        qr_file_id: asset.qrFile.id,
        target_id: asset.targetProductId,
        target_type: asset.targetType,
      },
      responseStatus: 200,
      storage: 'HASH_ONLY' as const,
    };
  }

  private claim(actorId: string, idempotencyKey: string, input: CreatePromotionAssetInput): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: { target_id: input.targetId, target_type: input.targetType },
        method: 'POST',
        pathParameters: {},
        route: ROUTE,
      },
    };
  }

  private async cleanup(storage: ObjectStoragePort, ...keys: Array<string | undefined>): Promise<void> {
    const failures = (await Promise.allSettled(keys.filter((key): key is string => key !== undefined)
      .map((key) => storage.deleteIfExists(key)))).filter(({ status }) => status === 'rejected');
    if (failures.length > 0) this.logger.error({ error_code: 'PROMOTION_QR_CLEANUP_FAILED', service: 'api' });
  }

  private leaseManager(): FileObjectLeaseManager {
    if (!this.leases) throw new ApplicationError('INTERNAL_ERROR', 'File completion lease is unavailable');
    return this.leases;
  }

  private runtime(): {
    commerce: AgentCommerceRepository;
    config: PlatformRuntimeConfig;
    database: DatabaseRuntime;
    storage: ObjectStoragePort;
  } {
    if (!this.commerce || !this.files || !this.config || !this.database || !this.storage || !this.audit ||
      !this.idempotency ||
      !this.outbox) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent commerce runtime is unavailable');
    }
    return { commerce: this.commerce, config: this.config, database: this.database, storage: this.storage };
  }
}
