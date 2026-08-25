import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  BannerRepository,
  type BannerSnapshot,
  type BannerTargetInput as RepositoryBannerTargetInput,
  type CacheableBannerResourceResponse,
  type CacheableBannerView,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  runSerializableTransaction,
  type UpdateBannerPatch,
} from '@qingxu/database';
import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { catalogRequestIp, type AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import type {
  BannerCreateInput,
  BannerListInput,
  BannerPatchInput,
  BannerReasonInput,
  BannerTargetInput,
  BannerUpdateInput,
} from './admin-banners.dto';

const ROUTES = {
  collection: '/admin/banners',
  resource: '/admin/banners/{banner_id}',
  restore: '/admin/banners/{banner_id}/restore',
} as const;

function repositoryTarget(target: BannerTargetInput): RepositoryBannerTargetInput {
  if (target.type === 'NONE') return { targetId: null, targetType: 'NONE', targetUrl: null };
  if (target.type === 'URL') return { targetId: null, targetType: 'URL', targetUrl: target.targetUrl };
  return { targetId: target.targetId, targetType: target.type, targetUrl: null };
}

function repositoryPatch(input: BannerUpdateInput): UpdateBannerPatch {
  return {
    ...(input.fileId === undefined ? {} : { fileId: input.fileId }),
    ...(input.title === undefined ? {} : { title: input.title }),
    ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
    ...(input.target === undefined ? {} : { target: repositoryTarget(input.target) }),
    ...(!Object.hasOwn(input, 'startsAt') ? {} : {
      startsAt: input.startsAt === null ? null : new Date(input.startsAt as string),
    }),
    ...(!Object.hasOwn(input, 'endsAt') ? {} : {
      endsAt: input.endsAt === null ? null : new Date(input.endsAt as string),
    }),
  };
}

function preEnvelopedBanner(response: CacheableBannerResourceResponse) {
  return preEnvelopedResponse<CacheableBannerView>(response);
}

@Injectable()
export class AdminBannersService {
  private readonly audit!: AuditRepository;
  private readonly banners!: BannerRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.banners = new BannerRepository(database.prisma, config.banner.targetOrigins);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
    }
  }

  async listBanners(input: BannerListInput) {
    this.runtime();
    const result = await this.banners.listBanners(input);
    return {
      items: result.items.map((banner) => this.bannerView(banner)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async createBanner(
    request: AdminCatalogRequestContext,
    input: BannerCreateInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const bannerId = generateUlid();
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.collection, {}, input);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.bannerReplay(await this.idempotency.claim(transaction, claim), 201);
      if (replay !== null) return preEnvelopedBanner(replay);
      const created = await this.banners.createBannerInTransaction(transaction, {
        actorId: request.principal.accountId,
        endsAt: input.endsAt === undefined || input.endsAt === null ? null : new Date(input.endsAt),
        fileId: input.fileId,
        id: bannerId,
        sortOrder: input.sortOrder,
        startsAt: input.startsAt === undefined || input.startsAt === null ? null : new Date(input.startsAt),
        target: repositoryTarget(input.target),
        title: input.title,
      });
      await this.appendAudit(transaction, request, idempotencyKey, 'CREATE', created, undefined);
      await this.appendOutbox(transaction, created, 'created');
      return this.completeResponse(transaction, claim, request.requestId, created, 201);
    });
  }

  async patchBanner(
    request: AdminCatalogRequestContext,
    bannerId: string,
    input: BannerPatchInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'PATCH',
      ROUTES.resource,
      { banner_id: bannerId },
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.bannerReplay(
        await this.idempotency.claim(transaction, claim),
        200,
        bannerId,
      );
      if (replay !== null) return preEnvelopedBanner(replay);
      const changed = input.kind === 'STATUS'
        ? await this.banners.changeBannerStatusInTransaction(transaction, {
            action: input.action,
            expectedVersion,
            id: bannerId,
          })
        : await this.banners.updateBannerInTransaction(transaction, {
            actorId: request.principal.accountId,
            expectedVersion,
            id: bannerId,
            patch: repositoryPatch(input.patch),
          });
      const action = input.kind === 'UPDATE'
        ? 'UPDATE'
        : input.action === 'ACTIVATE' ? 'ENABLE' : 'DISABLE';
      const before = input.kind === 'UPDATE' || input.action === 'DEACTIVATE'
        ? { status: input.kind === 'UPDATE' ? changed.status : 'ACTIVE', version: expectedVersion }
        : { version: expectedVersion };
      await this.appendAudit(transaction, request, idempotencyKey, action, changed, before);
      await this.appendOutbox(
        transaction,
        changed,
        input.kind === 'UPDATE' ? 'updated' : input.action === 'ACTIVATE' ? 'activated' : 'deactivated',
      );
      return this.completeResponse(transaction, claim, request.requestId, changed, 200);
    });
  }

  async archiveBanner(
    request: AdminCatalogRequestContext,
    bannerId: string,
    input: BannerReasonInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.versionedTransition(
      request,
      bannerId,
      input,
      expectedVersion,
      idempotencyKey,
      'DELETE',
      ROUTES.resource,
      'ARCHIVE',
      'archived',
      (transaction) => this.banners.archiveBannerInTransaction(transaction, {
        expectedVersion,
        id: bannerId,
      }),
      { version: expectedVersion },
    );
  }

  async restoreBanner(
    request: AdminCatalogRequestContext,
    bannerId: string,
    input: BannerReasonInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.versionedTransition(
      request,
      bannerId,
      input,
      expectedVersion,
      idempotencyKey,
      'POST',
      ROUTES.restore,
      'RESTORE',
      'restored',
      (transaction) => this.banners.restoreBannerInTransaction(transaction, {
        expectedVersion,
        id: bannerId,
      }),
      { status: 'ARCHIVED', version: expectedVersion },
    );
  }

  private async versionedTransition(
    request: AdminCatalogRequestContext,
    bannerId: string,
    input: BannerReasonInput,
    expectedVersion: number,
    idempotencyKey: string,
    method: 'DELETE' | 'POST',
    route: string,
    auditAction: 'ARCHIVE' | 'RESTORE',
    outboxEvent: 'archived' | 'restored',
    transition: (transaction: DatabaseTransaction) => Promise<BannerSnapshot>,
    before: { status?: 'ARCHIVED'; version: number },
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      method,
      route,
      { banner_id: bannerId },
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.bannerReplay(
        await this.idempotency.claim(transaction, claim),
        200,
        bannerId,
      );
      if (replay !== null) return preEnvelopedBanner(replay);
      const changed = await transition(transaction);
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        auditAction,
        changed,
        before,
        input.reason,
      );
      await this.appendOutbox(transaction, changed, outboxEvent);
      return this.completeResponse(transaction, claim, request.requestId, changed, 200);
    });
  }

  private runtime(): {
    config: PlatformRuntimeConfig;
    database: DatabaseRuntime;
    storage: ObjectStoragePort;
  } {
    if (!this.config || !this.database || !this.storage) {
      throw new ApplicationError('INTERNAL_ERROR', 'Admin Banner runtime is unavailable');
    }
    return { config: this.config, database: this.database, storage: this.storage };
  }

  private bannerView(resource: BannerSnapshot): CacheableBannerView {
    const base = {
      banner_id: resource.id,
      ends_at: resource.endsAt?.toISOString() ?? null,
      file_id: resource.fileId,
      image_url: this.runtime().storage.publicUrl(resource.fileObjectKey),
      sort_order: resource.sortOrder,
      starts_at: resource.startsAt?.toISOString() ?? null,
      status: resource.status,
      title: resource.title,
      version: resource.version,
    };
    if (resource.targetType === 'NONE') {
      if (resource.targetId !== null || resource.targetUrl !== null) return this.invalidStoredTarget();
      return { ...base, target_id: null, target_type: 'NONE', target_url: null };
    }
    if (resource.targetType === 'PRODUCT' || resource.targetType === 'CATEGORY') {
      if (resource.targetId === null || resource.targetUrl !== null) return this.invalidStoredTarget();
      return { ...base, target_id: resource.targetId, target_type: resource.targetType, target_url: null };
    }
    if (resource.targetId !== null || resource.targetUrl === null) return this.invalidStoredTarget();
    return { ...base, target_id: null, target_type: 'URL', target_url: resource.targetUrl };
  }

  private invalidStoredTarget(): never {
    throw new ApplicationError('INTERNAL_ERROR', 'Stored Banner target is invalid');
  }

  private claim(
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    method: 'DELETE' | 'PATCH' | 'POST',
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

  private bannerReplay(
    claimed: Awaited<ReturnType<IdempotencyRepository['claim']>>,
    expectedStatus: 200 | 201,
    expectedBannerId?: string,
  ): CacheableBannerResourceResponse | null {
    if (claimed.kind !== 'replay') return null;
    if (claimed.record.response_status !== expectedStatus) {
      throw new ApplicationError('INTERNAL_ERROR', 'Banner idempotency replay status is invalid');
    }
    const response = this.idempotency.bannerResourceReplay(claimed.record);
    if (expectedBannerId !== undefined && response.data.banner_id !== expectedBannerId) {
      throw new ApplicationError('INTERNAL_ERROR', 'Banner idempotency replay target is invalid');
    }
    return response;
  }

  private async completeResponse(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    requestId: string,
    resource: BannerSnapshot,
    responseStatus: 200 | 201,
  ) {
    const response: CacheableBannerResourceResponse = {
      code: 'OK',
      data: this.bannerView(resource),
      message: 'success',
      request_id: requestId,
    };
    await this.idempotency.complete(transaction, claim, {
      policy: 'BANNER_RESOURCE_RESPONSE',
      responseBody: response,
      responseStatus,
      storage: 'CACHEABLE',
    });
    return preEnvelopedBanner(response);
  }

  private async appendAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    action: 'ARCHIVE' | 'CREATE' | 'DISABLE' | 'ENABLE' | 'RESTORE' | 'UPDATE',
    after: BannerSnapshot,
    before?: { status?: BannerSnapshot['status']; version: number },
    reason?: string,
  ): Promise<void> {
    const ipAddress = catalogRequestIp(request);
    await this.audit.append(transaction, {
      action,
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: { status: after.status, version: after.version },
      ...(before === undefined ? {} : { before }),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'banner',
      objectId: after.id,
      objectType: 'banner',
      ...(reason === undefined ? {} : { reason }),
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendOutbox(
    transaction: DatabaseTransaction,
    resource: BannerSnapshot,
    event: 'activated' | 'archived' | 'created' | 'deactivated' | 'restored' | 'updated',
  ) {
    return this.outbox.append(transaction, {
      aggregateId: resource.id,
      aggregateType: 'banner',
      eventType: `banner.${event}`,
      payload: {
        event_version: 1,
        resource_id: resource.id,
        resource_type: 'banner',
        resource_version: resource.version,
      },
    });
  }
}
