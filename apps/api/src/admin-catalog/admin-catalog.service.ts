import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type BrandSnapshot,
  type CacheableBrandView,
  type CacheableCatalogResourceResponse,
  type CacheableCommandResponse,
  type CacheableCategoryView,
  type CategorySnapshot,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type HighRiskPreviewAction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  MasterDataRepository,
  type MasterDataTargetType,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, formatVersionEtag, generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import type {
  BrandCreateInput,
  BrandUpdateInput,
  CatalogListInput,
  CategoryCreateInput,
  CategoryUpdateInput,
  LifecycleConfirmationInput,
  LifecyclePreviewInput,
  MasterDataLifecycleAction,
  RestoreInput,
} from './admin-catalog.dto';
import { catalogRequestIp, type AdminCatalogRequestContext } from './admin-catalog.request';

const ROUTES = {
  brandCreate: '/admin/brands',
  brandLifecycle: '/admin/brands/{brand_id}/lifecycle-changes',
  brandPreview: '/admin/brands/{brand_id}/lifecycle-preview',
  brandRestore: '/admin/brands/{brand_id}/restore',
  brandUpdate: '/admin/brands/{brand_id}',
  categoryCreate: '/admin/categories',
  categoryLifecycle: '/admin/categories/{category_id}/lifecycle-changes',
  categoryPreview: '/admin/categories/{category_id}/lifecycle-preview',
  categoryRestore: '/admin/categories/{category_id}/restore',
  categoryUpdate: '/admin/categories/{category_id}',
} as const;

type CatalogSnapshot = BrandSnapshot | CategorySnapshot;
type CatalogResourceType = 'brand' | 'category';
type CatalogReasonCode =
  | 'CATALOG.BRAND_ACTIVATE'
  | 'CATALOG.BRAND_DEACTIVATE'
  | 'CATALOG.BRAND_SOFT_DELETE'
  | 'CATALOG.BRAND_RESTORE'
  | 'CATALOG.CATEGORY_ACTIVATE'
  | 'CATALOG.CATEGORY_DEACTIVATE'
  | 'CATALOG.CATEGORY_SOFT_DELETE'
  | 'CATALOG.CATEGORY_RESTORE';

function routeFor(
  targetType: MasterDataTargetType,
  operation: 'lifecycle' | 'preview' | 'restore',
): string {
  if (targetType === 'BRAND') {
    if (operation === 'lifecycle') return ROUTES.brandLifecycle;
    if (operation === 'preview') return ROUTES.brandPreview;
    return ROUTES.brandRestore;
  }
  if (operation === 'lifecycle') return ROUTES.categoryLifecycle;
  if (operation === 'preview') return ROUTES.categoryPreview;
  return ROUTES.categoryRestore;
}

function pathFor(targetType: MasterDataTargetType, targetId: string): Record<string, string> {
  return targetType === 'BRAND' ? { brand_id: targetId } : { category_id: targetId };
}

function resourceType(targetType: MasterDataTargetType): CatalogResourceType {
  return targetType === 'BRAND' ? 'brand' : 'category';
}

function nextStatus(action: MasterDataLifecycleAction): 'ACTIVE' | 'INACTIVE' | 'ARCHIVED' {
  if (action === 'ACTIVATE') return 'ACTIVE';
  if (action === 'DEACTIVATE') return 'INACTIVE';
  return 'ARCHIVED';
}

function auditAction(action: MasterDataLifecycleAction): 'ENABLE' | 'DISABLE' | 'ARCHIVE' {
  if (action === 'ACTIVATE') return 'ENABLE';
  if (action === 'DEACTIVATE') return 'DISABLE';
  return 'ARCHIVE';
}

function previewAction(
  targetType: MasterDataTargetType,
  action: MasterDataLifecycleAction,
): HighRiskPreviewAction {
  return `${targetType}.${action}`;
}

function catalogReasonCode(
  targetType: MasterDataTargetType,
  action: MasterDataLifecycleAction | 'RESTORE',
): CatalogReasonCode {
  return `CATALOG.${targetType}_${action}`;
}

function preEnvelopedCatalog(response: CacheableCatalogResourceResponse) {
  return preEnvelopedResponse<CacheableBrandView | CacheableCategoryView>(response);
}

@Injectable()
export class AdminCatalogService {
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly master!: MasterDataRepository;
  private readonly previews!: HighRiskPreviewRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.master = new MasterDataRepository(database.prisma);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
    }
  }

  async listBrands(input: CatalogListInput) {
    this.runtime();
    const result = await this.master.listBrands(input);
    return {
      items: result.items.map((item) => this.brandView(item)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getBrand(brandId: string) {
    this.runtime();
    return this.brandView(await this.master.getBrand(brandId));
  }

  async listCategories(input: CatalogListInput) {
    this.runtime();
    const result = await this.master.listCategories(input);
    return {
      items: result.items.map((item) => this.categoryView(item)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getCategory(categoryId: string) {
    this.runtime();
    return this.categoryView(await this.master.getCategory(categoryId));
  }

  async createBrand(
    request: AdminCatalogRequestContext,
    input: BrandCreateInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const brandId = generateUlid();
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.brandCreate, {}, input);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.catalogReplay(await this.idempotency.claim(transaction, claim), 201, 'brand');
      if (replay !== null) return preEnvelopedCatalog(replay);
      const created = await this.master.createBrandInTransaction(transaction, {
        actorId: request.principal.accountId,
        description: input.description ?? null,
        id: brandId,
        logoFileId: input.logoFileId ?? null,
        name: input.name,
        sortOrder: input.sortOrder,
      });
      await this.appendAudit(transaction, request, idempotencyKey, 'CREATE', 'brand', created.id, undefined, created);
      const response = this.catalogResponse(request.requestId, this.brandView(created));
      await this.completeCatalogResponse(transaction, claim, response, 201);
      return preEnvelopedCatalog(response);
    });
  }

  async updateBrand(
    request: AdminCatalogRequestContext,
    brandId: string,
    input: BrandUpdateInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'PATCH',
      ROUTES.brandUpdate,
      { brand_id: brandId },
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.catalogReplay(await this.idempotency.claim(transaction, claim), 200, 'brand', brandId);
      if (replay !== null) return preEnvelopedCatalog(replay);
      const updated = await this.master.updateBrandInTransaction(transaction, {
        actorId: request.principal.accountId,
        expectedVersion,
        id: brandId,
        patch: input,
      });
      await this.appendAudit(transaction, request, idempotencyKey, 'UPDATE', 'brand', brandId,
        { status: updated.status, version: expectedVersion }, updated);
      const response = this.catalogResponse(request.requestId, this.brandView(updated));
      await this.completeCatalogResponse(transaction, claim, response, 200);
      return preEnvelopedCatalog(response);
    });
  }

  async createCategory(
    request: AdminCatalogRequestContext,
    input: CategoryCreateInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const categoryId = generateUlid();
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.categoryCreate, {}, input);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.catalogReplay(await this.idempotency.claim(transaction, claim), 201, 'category');
      if (replay !== null) return preEnvelopedCatalog(replay);
      const created = await this.master.createCategoryInTransaction(transaction, {
        actorId: request.principal.accountId,
        iconFileId: input.iconFileId ?? null,
        id: categoryId,
        name: input.name,
        sortOrder: input.sortOrder,
      });
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        'CREATE',
        'category',
        created.id,
        undefined,
        created,
      );
      const response = this.catalogResponse(request.requestId, this.categoryView(created));
      await this.completeCatalogResponse(transaction, claim, response, 201);
      return preEnvelopedCatalog(response);
    });
  }

  async updateCategory(
    request: AdminCatalogRequestContext,
    categoryId: string,
    input: CategoryUpdateInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'PATCH',
      ROUTES.categoryUpdate,
      { category_id: categoryId },
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.catalogReplay(
        await this.idempotency.claim(transaction, claim),
        200,
        'category',
        categoryId,
      );
      if (replay !== null) return preEnvelopedCatalog(replay);
      const updated = await this.master.updateCategoryInTransaction(transaction, {
        actorId: request.principal.accountId,
        expectedVersion,
        id: categoryId,
        patch: input,
      });
      await this.appendAudit(transaction, request, idempotencyKey, 'UPDATE', 'category', categoryId,
        { status: updated.status, version: expectedVersion }, updated);
      const response = this.catalogResponse(request.requestId, this.categoryView(updated));
      await this.completeCatalogResponse(transaction, claim, response, 200);
      return preEnvelopedCatalog(response);
    });
  }

  async previewLifecycle(
    request: AdminCatalogRequestContext,
    targetType: MasterDataTargetType,
    targetId: string,
    input: LifecyclePreviewInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      routeFor(targetType, 'preview'),
      pathFor(targetType, targetId),
      input,
    );
    const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
    return runSerializableTransaction(database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Lifecycle preview capability cannot be replayed');
      }
      const impact = await this.master.getLifecyclePreviewImpactInTransaction(transaction, {
        action: input.action,
        targetId,
        targetType,
      });
      const issued = await this.previews.issueInTransaction(transaction, {
        action: previewAction(targetType, input.action),
        actorId: request.principal.accountId,
        previewToken,
        request: input,
        resourceVersion: impact.resource.version,
        sessionId: request.accessSession.sessionId,
        targetId,
        targetType,
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: this.impactView(input.action, impact),
        preview_token: previewToken,
        resource_etag: formatVersionEtag(impact.resource.version),
      };
      await this.idempotency.complete(transaction, claim, {
        resourceId: targetId,
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

  async confirmLifecycle(
    request: AdminCatalogRequestContext,
    targetType: MasterDataTargetType,
    targetId: string,
    input: LifecycleConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      routeFor(targetType, 'lifecycle'),
      pathFor(targetType, targetId),
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.commandReplay(
        await this.idempotency.claim(transaction, claim),
        resourceType(targetType),
        targetId,
      );
      if (replay !== null) return preEnvelopedResponse(replay);
      const changed = await this.master.applyLifecycleInTransaction(transaction, {
        action: input.action,
        expectedVersion,
        targetId,
        targetType,
      });
      await this.previews.consumeInTransaction(transaction, {
        action: previewAction(targetType, input.action),
        actorId: request.principal.accountId,
        confirmationHash: input.confirmationHash,
        previewToken: input.previewToken,
        request: { action: input.action, reason: input.reason },
        resourceVersion: expectedVersion,
        sessionId: request.accessSession.sessionId,
        targetId,
        targetType,
      });
      const response = this.commandResponse(
        request.requestId,
        resourceType(targetType),
        changed.resource,
      );
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        auditAction(input.action),
        resourceType(targetType),
        targetId,
        changed.impact.resource,
        changed.resource,
        catalogReasonCode(targetType, input.action),
      );
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  async restore(
    request: AdminCatalogRequestContext,
    targetType: MasterDataTargetType,
    targetId: string,
    input: RestoreInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      routeFor(targetType, 'restore'),
      pathFor(targetType, targetId),
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.commandReplay(
        await this.idempotency.claim(transaction, claim),
        resourceType(targetType),
        targetId,
      );
      if (replay !== null) return preEnvelopedResponse(replay);
      const restored = targetType === 'BRAND'
        ? await this.master.restoreBrandInTransaction(transaction, { expectedVersion, id: targetId })
        : await this.master.restoreCategoryInTransaction(transaction, { expectedVersion, id: targetId });
      const response = this.commandResponse(request.requestId, resourceType(targetType), restored);
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        'RESTORE',
        resourceType(targetType),
        targetId,
        { status: 'ARCHIVED', version: expectedVersion },
        restored,
        catalogReasonCode(targetType, 'RESTORE'),
      );
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  private runtime(): {
    config: PlatformRuntimeConfig;
    database: DatabaseRuntime;
    storage: ObjectStoragePort;
  } {
    if (!this.config || !this.database || !this.storage) {
      throw new ApplicationError('INTERNAL_ERROR', 'Admin catalog runtime is unavailable');
    }
    return { config: this.config, database: this.database, storage: this.storage };
  }

  private brandView(resource: BrandSnapshot): CacheableBrandView {
    const { storage } = this.runtime();
    return {
      brand_id: resource.id,
      description: resource.description,
      logo_file_id: resource.logoFileId,
      logo_url: resource.logoObjectKey === null ? null : storage.publicUrl(resource.logoObjectKey),
      name: resource.name,
      sort_order: resource.sortOrder,
      status: resource.status,
      version: resource.version,
    };
  }

  private categoryView(resource: CategorySnapshot): CacheableCategoryView {
    const { storage } = this.runtime();
    return {
      category_id: resource.id,
      icon_file_id: resource.iconFileId,
      icon_url: resource.iconObjectKey === null ? null : storage.publicUrl(resource.iconObjectKey),
      name: resource.name,
      sort_order: resource.sortOrder,
      status: resource.status,
      version: resource.version,
    };
  }

  private impactView(
    action: MasterDataLifecycleAction,
    impact: Awaited<ReturnType<MasterDataRepository['getLifecyclePreviewImpactInTransaction']>>,
  ) {
    const blocked = action !== 'ACTIVATE' && impact.activeProductCount > 0;
    return {
      affected_count: impact.activeProductCount,
      metrics: [
        { after: nextStatus(action), before: impact.resource.status, key: 'status', label: 'Status' },
        {
          after: blocked ? 'BLOCKED' : 'UNCHANGED',
          before: String(impact.activeProductCount),
          key: 'active_products',
          label: 'Active products',
        },
      ],
      warnings: blocked ? ['ACTIVE_PRODUCT_DEPENDENCY'] : [],
    };
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

  private catalogReplay(
    claimed: Awaited<ReturnType<IdempotencyRepository['claim']>>,
    expectedStatus: number,
    expectedType: CatalogResourceType,
    expectedResourceId?: string,
  ): CacheableCatalogResourceResponse | null {
    if (claimed.kind !== 'replay') return null;
    if (claimed.record.response_status !== expectedStatus) {
      throw new ApplicationError('INTERNAL_ERROR', 'Catalog idempotency replay is invalid');
    }
    const response = this.idempotency.catalogResourceReplay(claimed.record);
    const actualType = 'brand_id' in response.data ? 'brand' : 'category';
    const actualResourceId = actualType === 'brand'
      ? (response.data as CacheableBrandView).brand_id
      : (response.data as CacheableCategoryView).category_id;
    if (actualType !== expectedType ||
      (expectedResourceId !== undefined && actualResourceId !== expectedResourceId)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Catalog idempotency replay target is invalid');
    }
    return response;
  }

  private commandReplay(
    claimed: Awaited<ReturnType<IdempotencyRepository['claim']>>,
    expectedType: CatalogResourceType,
    expectedResourceId: string,
  ): CacheableCommandResponse | null {
    if (claimed.kind !== 'replay') return null;
    if (claimed.record.response_status !== 200 || claimed.record.response_body === null) {
      throw new ApplicationError('INTERNAL_ERROR', 'Catalog command replay is invalid');
    }
    const response = claimed.record.response_body as unknown as CacheableCommandResponse;
    if (response.data.resource_type !== expectedType || response.data.resource_id !== expectedResourceId) {
      throw new ApplicationError('INTERNAL_ERROR', 'Catalog command replay target is invalid');
    }
    return response;
  }

  private catalogResponse(
    requestId: string,
    data: CacheableBrandView | CacheableCategoryView,
  ): CacheableCatalogResourceResponse {
    return { code: 'OK', data, message: 'success', request_id: requestId } as CacheableCatalogResourceResponse;
  }

  private async completeCatalogResponse(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    response: CacheableCatalogResourceResponse,
    responseStatus: number,
  ): Promise<void> {
    await this.idempotency.complete(transaction, claim, {
      policy: 'CATALOG_RESOURCE_RESPONSE',
      responseBody: response,
      responseStatus,
      storage: 'CACHEABLE',
    });
  }

  private commandResponse(
    requestId: string,
    type: CatalogResourceType,
    resource: CatalogSnapshot,
  ): CacheableCommandResponse {
    return {
      code: 'OK',
      data: {
        occurred_at: resource.updatedAt.toISOString(),
        resource_id: resource.id,
        resource_type: type,
        status: resource.status,
        version: resource.version,
      },
      message: 'success',
      request_id: requestId,
    };
  }

  private async appendAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    action: 'ARCHIVE' | 'CREATE' | 'DISABLE' | 'ENABLE' | 'RESTORE' | 'UPDATE',
    type: CatalogResourceType,
    objectId: string,
    before: Pick<CatalogSnapshot, 'status' | 'version'> | undefined,
    after: Pick<CatalogSnapshot, 'status' | 'version'>,
    reasonCode?: CatalogReasonCode,
  ): Promise<void> {
    const ipAddress = catalogRequestIp(request);
    await this.audit.append(transaction, {
      action,
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: { status: after.status, version: after.version },
      ...(before === undefined ? {} : { before: { status: before.status, version: before.version } }),
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'catalog',
      objectId,
      objectType: type,
      requestId: request.requestId,
      ...(reasonCode === undefined ? {} : { reasonCode }),
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }
}
