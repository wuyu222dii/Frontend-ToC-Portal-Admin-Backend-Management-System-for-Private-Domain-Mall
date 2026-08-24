import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type BrandSnapshot,
  type CacheableBrandView,
  type CacheableCategoryView,
  type CacheableCommandResponse,
  type CacheableProductCatalogResponse,
  type CacheableProductDetailView,
  type CacheableSkuSpec,
  type CacheableSkuView,
  type CategorySnapshot,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type HighRiskPreviewAction,
  HighRiskPreviewRepository,
  IdempotencyRepository,
  type IdempotencyClaim,
  OutboxRepository,
  ProductCatalogRepository,
  type ProductCatalogLifecycleAction,
  type ProductCatalogLifecycleImpact,
  type ProductCatalogLifecycleTargetType,
  type ProductCatalogProductSnapshot,
  type ProductCatalogSkuSnapshot,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, formatVersionEtag, generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { catalogRequestIp, type AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import type {
  ProductCreateInput,
  ProductLifecycleConfirmationInput,
  ProductLifecyclePreviewInput,
  ProductListInput,
  ProductRestoreInput,
  ProductUpdateInput,
  SkuCreateInput,
  SkuLifecycleConfirmationInput,
  SkuLifecyclePreviewInput,
  SkuRestoreInput,
  SkuSpec,
  SkuUpdateInput,
} from './admin-products.dto';

const ROUTES = {
  productCreate: '/admin/products',
  productLifecycle: '/admin/products/{product_id}/lifecycle-changes',
  productPreview: '/admin/products/{product_id}/lifecycle-preview',
  productRestore: '/admin/products/{product_id}/restore',
  productUpdate: '/admin/products/{product_id}',
  skuCreate: '/admin/products/{product_id}/skus',
  skuLifecycle: '/admin/skus/{sku_id}/lifecycle-changes',
  skuPreview: '/admin/skus/{sku_id}/lifecycle-preview',
  skuRestore: '/admin/skus/{sku_id}/restore',
  skuUpdate: '/admin/skus/{sku_id}',
} as const;

type ProductCatalogResourceType = 'product' | 'sku';
type ProductCatalogSnapshot = ProductCatalogProductSnapshot | ProductCatalogSkuSnapshot;

function preEnvelopedProductCatalog(response: CacheableProductCatalogResponse) {
  return preEnvelopedResponse<CacheableProductDetailView | CacheableSkuView>(response);
}

function lifecycleRoute(
  targetType: ProductCatalogLifecycleTargetType,
  operation: 'confirm' | 'preview' | 'restore',
): string {
  if (targetType === 'PRODUCT') {
    if (operation === 'confirm') return ROUTES.productLifecycle;
    if (operation === 'preview') return ROUTES.productPreview;
    return ROUTES.productRestore;
  }
  if (operation === 'confirm') return ROUTES.skuLifecycle;
  if (operation === 'preview') return ROUTES.skuPreview;
  return ROUTES.skuRestore;
}

function lifecyclePath(
  targetType: ProductCatalogLifecycleTargetType,
  targetId: string,
): Record<string, string> {
  return targetType === 'PRODUCT' ? { product_id: targetId } : { sku_id: targetId };
}

function lifecycleResourceType(targetType: ProductCatalogLifecycleTargetType): ProductCatalogResourceType {
  return targetType === 'PRODUCT' ? 'product' : 'sku';
}

function lifecyclePreviewAction(
  targetType: ProductCatalogLifecycleTargetType,
  action: ProductCatalogLifecycleAction,
): HighRiskPreviewAction {
  return `${targetType}.${action}`;
}

function lifecycleAuditAction(
  action: ProductCatalogLifecycleAction,
): 'ARCHIVE' | 'DISABLE' | 'ENABLE' {
  if (action === 'ACTIVATE') return 'ENABLE';
  if (action === 'DEACTIVATE') return 'DISABLE';
  return 'ARCHIVE';
}

function lifecycleNextStatus(action: ProductCatalogLifecycleAction): 'ACTIVE' | 'ARCHIVED' | 'INACTIVE' {
  if (action === 'ACTIVATE') return 'ACTIVE';
  if (action === 'DEACTIVATE') return 'INACTIVE';
  return 'ARCHIVED';
}

function preEnvelopedCommand(response: CacheableCommandResponse) {
  return preEnvelopedResponse<CacheableCommandResponse['data']>(response);
}

@Injectable()
export class AdminProductsService {
  private readonly audit!: AuditRepository;
  private readonly catalog!: ProductCatalogRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly outbox!: OutboxRepository;
  private readonly previews!: HighRiskPreviewRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.catalog = new ProductCatalogRepository(database.prisma);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
      this.outbox = new OutboxRepository(database);
      this.previews = new HighRiskPreviewRepository(database.prisma, config.encryption.idempotencyHashKeys);
    }
  }

  async listProducts(input: ProductListInput) {
    this.runtime();
    const result = await this.catalog.listProducts(input);
    return {
      items: result.items.map((item) => ({
        active_sku_count: item.activeSkuCount,
        available_stock: item.availableQty,
        locked_stock: item.lockedQty,
        physical_stock: item.physicalQty,
        product: this.productSummaryView(item.product),
        sku_count: item.skuCount,
        skus: item.skus.map((sku) => ({
          available_stock: sku.inventory.availableQty,
          code: sku.code,
          locked_stock: sku.inventory.lockedQty,
          name: sku.name,
          physical_stock: sku.inventory.physicalQty,
          sku_id: sku.id,
          status: sku.status,
        })),
      })),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getProduct(productId: string) {
    this.runtime();
    return this.productDetailView(await this.catalog.getProduct(productId));
  }

  async createProduct(
    request: AdminCatalogRequestContext,
    input: ProductCreateInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const productId = generateUlid();
    const claim = this.claim(request, idempotencyKey, 'POST', ROUTES.productCreate, {}, input);
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.productCatalogReplay(
        await this.idempotency.claim(transaction, claim),
        201,
        'product',
      );
      if (replay !== null) return preEnvelopedProductCatalog(replay);
      const created = await this.catalog.createProductInTransaction(transaction, {
        actorId: request.principal.accountId,
        brandId: input.brandId,
        categoryId: input.categoryId,
        id: productId,
        images: input.images,
        ingredients: input.ingredients ?? null,
        introduction: input.introduction ?? null,
        isHot: input.isHot ?? false,
        isNew: input.isNew ?? false,
        name: input.name,
        spuCode: input.spuCode,
        subtitle: input.subtitle ?? null,
        usageMethod: input.usageMethod ?? null,
      });
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        'CREATE',
        'product',
        created.id,
        undefined,
        created,
      );
      const response = this.productCatalogResponse(request.requestId, this.productDetailView(created));
      await this.completeProductCatalogResponse(transaction, claim, response, 201);
      return preEnvelopedProductCatalog(response);
    });
  }

  async updateProduct(
    request: AdminCatalogRequestContext,
    productId: string,
    input: ProductUpdateInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'PATCH',
      ROUTES.productUpdate,
      { product_id: productId },
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.productCatalogReplay(
        await this.idempotency.claim(transaction, claim),
        200,
        'product',
        productId,
      );
      if (replay !== null) return preEnvelopedProductCatalog(replay);
      const updated = await this.catalog.updateProductInTransaction(transaction, {
        actorId: request.principal.accountId,
        expectedVersion,
        id: productId,
        patch: input,
      });
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        'UPDATE',
        'product',
        productId,
        { status: updated.status, version: expectedVersion },
        updated,
      );
      const response = this.productCatalogResponse(request.requestId, this.productDetailView(updated));
      await this.completeProductCatalogResponse(transaction, claim, response, 200);
      return preEnvelopedProductCatalog(response);
    });
  }

  async createSku(
    request: AdminCatalogRequestContext,
    productId: string,
    input: SkuCreateInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const skuId = generateUlid();
    const inventoryBalanceId = generateUlid();
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      ROUTES.skuCreate,
      { product_id: productId },
      input,
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.productCatalogReplay(
        await this.idempotency.claim(transaction, claim),
        201,
        'sku',
      );
      if (replay !== null) return preEnvelopedProductCatalog(replay);
      const created = await this.catalog.createSkuInTransaction(transaction, {
        code: input.code,
        id: skuId,
        inventoryBalanceId,
        isRecommended: input.isRecommended ?? false,
        name: input.name,
        productId,
        retailPrice: input.retailPrice,
        specification: input.specJson ?? null,
      });
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        'CREATE',
        'sku',
        created.id,
        undefined,
        created,
      );
      const response = this.productCatalogResponse(request.requestId, this.skuView(created));
      await this.completeProductCatalogResponse(transaction, claim, response, 201);
      return preEnvelopedProductCatalog(response);
    });
  }

  async updateSku(
    request: AdminCatalogRequestContext,
    skuId: string,
    input: SkuUpdateInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'PATCH',
      ROUTES.skuUpdate,
      { sku_id: skuId },
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.productCatalogReplay(
        await this.idempotency.claim(transaction, claim),
        200,
        'sku',
        skuId,
      );
      if (replay !== null) return preEnvelopedProductCatalog(replay);
      const updated = await this.catalog.updateSkuInTransaction(transaction, {
        expectedVersion,
        id: skuId,
        patch: {
          ...(input.isRecommended === undefined ? {} : { isRecommended: input.isRecommended }),
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.retailPrice === undefined ? {} : { retailPrice: input.retailPrice }),
          ...(!Object.hasOwn(input, 'specJson') ? {} : { specification: input.specJson as SkuSpec | null }),
        },
      });
      await this.appendAudit(
        transaction,
        request,
        idempotencyKey,
        'UPDATE',
        'sku',
        skuId,
        { status: updated.status, version: expectedVersion },
        updated,
      );
      const response = this.productCatalogResponse(request.requestId, this.skuView(updated));
      await this.completeProductCatalogResponse(transaction, claim, response, 200);
      return preEnvelopedProductCatalog(response);
    });
  }

  previewProductLifecycle(
    request: AdminCatalogRequestContext,
    productId: string,
    input: ProductLifecyclePreviewInput,
    idempotencyKey: string,
  ) {
    return this.previewLifecycle(request, 'PRODUCT', productId, input, idempotencyKey);
  }

  previewSkuLifecycle(
    request: AdminCatalogRequestContext,
    skuId: string,
    input: SkuLifecyclePreviewInput,
    idempotencyKey: string,
  ) {
    return this.previewLifecycle(request, 'SKU', skuId, input, idempotencyKey);
  }

  confirmProductLifecycle(
    request: AdminCatalogRequestContext,
    productId: string,
    input: ProductLifecycleConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.confirmLifecycle(request, 'PRODUCT', productId, input, expectedVersion, idempotencyKey);
  }

  confirmSkuLifecycle(
    request: AdminCatalogRequestContext,
    skuId: string,
    input: SkuLifecycleConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.confirmLifecycle(request, 'SKU', skuId, input, expectedVersion, idempotencyKey);
  }

  restoreProduct(
    request: AdminCatalogRequestContext,
    productId: string,
    input: ProductRestoreInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.restoreLifecycle(request, 'PRODUCT', productId, input, expectedVersion, idempotencyKey);
  }

  restoreSku(
    request: AdminCatalogRequestContext,
    skuId: string,
    input: SkuRestoreInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    return this.restoreLifecycle(request, 'SKU', skuId, input, expectedVersion, idempotencyKey);
  }

  private async previewLifecycle(
    request: AdminCatalogRequestContext,
    targetType: ProductCatalogLifecycleTargetType,
    targetId: string,
    input: ProductLifecyclePreviewInput | SkuLifecyclePreviewInput,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      lifecycleRoute(targetType, 'preview'),
      lifecyclePath(targetType, targetId),
      input,
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        throw new ApplicationError('STATE_CONFLICT', 'Lifecycle preview must use a new idempotency key');
      }
      const impact = await this.catalog.getLifecyclePreviewImpactInTransaction(transaction, {
        action: input.action,
        targetId,
        targetType,
      });
      const previewToken = `pvw_${randomBytes(32).toString('base64url')}`;
      const issued = await this.previews.issueInTransaction(transaction, {
        action: lifecyclePreviewAction(targetType, input.action),
        actorId: request.principal.accountId,
        previewToken,
        request: { action: input.action, reason: input.reason },
        resourceVersion: impact.resource.version,
        sessionId: request.accessSession.sessionId,
        targetId,
        targetType,
      });
      const response = {
        confirmation_hash: issued.confirmationHash,
        expires_at: issued.expiresAt.toISOString(),
        impact: this.lifecycleImpactView(targetType, input.action, impact),
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

  private async confirmLifecycle(
    request: AdminCatalogRequestContext,
    targetType: ProductCatalogLifecycleTargetType,
    targetId: string,
    input: ProductLifecycleConfirmationInput | SkuLifecycleConfirmationInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      lifecycleRoute(targetType, 'confirm'),
      lifecyclePath(targetType, targetId),
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const replay = this.commandReplay(
        await this.idempotency.claim(transaction, claim),
        lifecycleResourceType(targetType),
        targetId,
      );
      if (replay !== null) return preEnvelopedCommand(replay);
      await this.previews.consumeInTransaction(transaction, {
        action: lifecyclePreviewAction(targetType, input.action),
        actorId: request.principal.accountId,
        confirmationHash: input.confirmationHash,
        previewToken: input.previewToken,
        request: { action: input.action, reason: input.reason },
        resourceVersion: expectedVersion,
        sessionId: request.accessSession.sessionId,
        targetId,
        targetType,
      });
      const changed = await this.catalog.applyLifecycleInTransaction(transaction, {
        action: input.action,
        expectedVersion,
        targetId,
        targetType,
      });
      const resourceType = lifecycleResourceType(targetType);
      const response = this.commandResponse(request.requestId, resourceType, changed.resource);
      await this.appendLifecycleAudit(
        transaction,
        request,
        idempotencyKey,
        lifecycleAuditAction(input.action),
        resourceType,
        targetId,
        changed.impact.resource,
        changed.resource,
        input.reason,
      );
      await this.appendLifecycleOutbox(transaction, resourceType, changed.resource, 'lifecycle_changed');
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedCommand(response);
    });
  }

  private async restoreLifecycle(
    request: AdminCatalogRequestContext,
    targetType: ProductCatalogLifecycleTargetType,
    targetId: string,
    input: ProductRestoreInput | SkuRestoreInput,
    expectedVersion: number,
    idempotencyKey: string,
  ) {
    const { database } = this.runtime();
    const claim = this.claim(
      request,
      idempotencyKey,
      'POST',
      lifecycleRoute(targetType, 'restore'),
      lifecyclePath(targetType, targetId),
      { ...input, expected_version: expectedVersion },
    );
    return runSerializableTransaction(database.prisma, async (transaction) => {
      const resourceType = lifecycleResourceType(targetType);
      const replay = this.commandReplay(
        await this.idempotency.claim(transaction, claim),
        resourceType,
        targetId,
      );
      if (replay !== null) return preEnvelopedCommand(replay);
      const restored = targetType === 'PRODUCT'
        ? await this.catalog.restoreProductInTransaction(transaction, { expectedVersion, id: targetId })
        : await this.catalog.restoreSkuInTransaction(transaction, { expectedVersion, id: targetId });
      const response = this.commandResponse(request.requestId, resourceType, restored);
      await this.appendLifecycleAudit(
        transaction,
        request,
        idempotencyKey,
        'RESTORE',
        resourceType,
        targetId,
        { status: 'ARCHIVED', version: expectedVersion },
        restored,
        input.reason,
      );
      await this.appendLifecycleOutbox(transaction, resourceType, restored, 'restored');
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedCommand(response);
    });
  }

  private runtime(): {
    config: PlatformRuntimeConfig;
    database: DatabaseRuntime;
    storage: ObjectStoragePort;
  } {
    if (!this.config || !this.database || !this.storage) {
      throw new ApplicationError('INTERNAL_ERROR', 'Admin products runtime is unavailable');
    }
    return { config: this.config, database: this.database, storage: this.storage };
  }

  private brandView(resource: BrandSnapshot): CacheableBrandView {
    const { storage } = this.runtime();
    const validLogo = resource.logoFileId !== null && resource.logoObjectKey !== null;
    return {
      brand_id: resource.id,
      description: resource.description,
      logo_file_id: validLogo ? resource.logoFileId : null,
      logo_url: validLogo ? storage.publicUrl(resource.logoObjectKey as string) : null,
      name: resource.name,
      sort_order: resource.sortOrder,
      status: resource.status,
      version: resource.version,
    };
  }

  private categoryView(resource: CategorySnapshot): CacheableCategoryView {
    const { storage } = this.runtime();
    const validIcon = resource.iconFileId !== null && resource.iconObjectKey !== null;
    return {
      category_id: resource.id,
      icon_file_id: validIcon ? resource.iconFileId : null,
      icon_url: validIcon ? storage.publicUrl(resource.iconObjectKey as string) : null,
      name: resource.name,
      sort_order: resource.sortOrder,
      status: resource.status,
      version: resource.version,
    };
  }

  private productImageView(resource: ProductCatalogProductSnapshot['images'][number]) {
    const { storage } = this.runtime();
    return {
      file_id: resource.fileId,
      is_primary: resource.isPrimary,
      sort_order: resource.sortOrder,
      url: storage.publicUrl(resource.objectKey),
    };
  }

  private skuSpecification(value: ProductCatalogSkuSnapshot['specification']): CacheableSkuSpec | null {
    if (value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'attributes') ||
      Object.keys(value).length !== 1 || !Array.isArray(value.attributes) || value.attributes.length === 0) {
      throw new ApplicationError('INTERNAL_ERROR', 'Stored SKU specification is invalid');
    }
    const seen = new Set<string>();
    const attributes = value.attributes.map((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item) ||
        Object.keys(item).length !== 2 || !Object.hasOwn(item, 'name') || !Object.hasOwn(item, 'value') ||
        typeof item.name !== 'string' || typeof item.value !== 'string' ||
        item.name.trim().length === 0 || item.value.trim().length === 0 ||
        Array.from(item.name).length > 80 || Array.from(item.value).length > 160) {
        throw new ApplicationError('INTERNAL_ERROR', 'Stored SKU specification is invalid');
      }
      const identity = JSON.stringify([item.name, item.value]);
      if (seen.has(identity)) {
        throw new ApplicationError('INTERNAL_ERROR', 'Stored SKU specification is invalid');
      }
      seen.add(identity);
      return { name: item.name, value: item.value };
    });
    return { attributes };
  }

  private skuView(resource: ProductCatalogSkuSnapshot): CacheableSkuView {
    return {
      available_stock: resource.inventory.availableQty,
      code: resource.code,
      is_recommended: resource.isRecommended,
      name: resource.name,
      retail_price: resource.retailPrice,
      sku_id: resource.id,
      spec_json: this.skuSpecification(resource.specification),
      status: resource.status,
      version: resource.version,
    };
  }

  private productSummaryView(resource: ProductCatalogProductSnapshot) {
    const primaryImage = resource.images[0];
    return {
      brand: this.brandView(resource.brand),
      category: this.categoryView(resource.category),
      is_hot: resource.isHot,
      is_new: resource.isNew,
      minimum_active_price: resource.minimumActivePrice,
      name: resource.name,
      net_sales_count: resource.salesCount,
      primary_image: primaryImage === undefined ? null : this.productImageView(primaryImage),
      product_id: resource.id,
      spu_code: resource.spuCode,
      status: resource.status,
      subtitle: resource.subtitle,
      version: resource.version,
    };
  }

  private productDetailView(resource: ProductCatalogProductSnapshot): CacheableProductDetailView {
    return {
      brand: this.brandView(resource.brand),
      category: this.categoryView(resource.category),
      images: resource.images.map((image) => this.productImageView(image)),
      ingredients: resource.ingredients,
      introduction: resource.introduction,
      is_hot: resource.isHot,
      is_new: resource.isNew,
      name: resource.name,
      net_sales_count: resource.salesCount,
      product_id: resource.id,
      skus: resource.skus.map((sku) => this.skuView(sku)),
      spu_code: resource.spuCode,
      status: resource.status,
      subtitle: resource.subtitle,
      usage_method: resource.usageMethod,
      version: resource.version,
    };
  }

  private lifecycleImpactView(
    targetType: ProductCatalogLifecycleTargetType,
    action: ProductCatalogLifecycleAction,
    impact: ProductCatalogLifecycleImpact,
  ) {
    const warnings: string[] = [];
    const metrics: Array<{ after: string; before: string; key: string; label: string }> = [{
      after: lifecycleNextStatus(action),
      before: impact.resource.status,
      key: 'status',
      label: 'Status',
    }];
    let affectedCount = 0;
    if (targetType === 'PRODUCT') {
      const imageCount = impact.validPublicImageCount ?? impact.activeImageCount ?? 0;
      const activeSkuCount = impact.activeSkuCount ?? 0;
      metrics.push(
        {
          after: action === 'ACTIVATE' ? 'ACTIVE_REQUIRED' : 'UNCHANGED',
          before: impact.brandStatus ?? 'UNKNOWN',
          key: 'brand_status',
          label: 'Brand status',
        },
        {
          after: action === 'ACTIVATE' ? 'ACTIVE_REQUIRED' : 'UNCHANGED',
          before: impact.categoryStatus ?? 'UNKNOWN',
          key: 'category_status',
          label: 'Category status',
        },
        {
          after: action === 'ACTIVATE' ? 'AT_LEAST_ONE_REQUIRED' : 'UNCHANGED',
          before: String(imageCount),
          key: 'public_images',
          label: 'Public images',
        },
        {
          after: action === 'ACTIVATE'
            ? 'AT_LEAST_ONE_REQUIRED'
            : action === 'SOFT_DELETE' ? 'ZERO_REQUIRED' : 'UNCHANGED',
          before: String(activeSkuCount),
          key: 'active_skus',
          label: 'Active SKUs',
        },
      );
      if (action === 'ACTIVATE') {
        if (impact.brandStatus !== 'ACTIVE' || impact.categoryStatus !== 'ACTIVE') warnings.push('STATE_CONFLICT');
        if (imageCount < 1) warnings.push('PRODUCT_PRIMARY_IMAGE_REQUIRED');
        if (activeSkuCount < 1) warnings.push('PRODUCT_ACTIVE_SKU_REQUIRED');
        affectedCount = warnings.length;
      } else if (action === 'SOFT_DELETE') {
        if (activeSkuCount > 0) warnings.push('ACTIVE_SKU_DEPENDENCY');
        if (impact.activeReservationCount > 0) warnings.push('ACTIVE_INVENTORY_RESERVATION');
        affectedCount = activeSkuCount + impact.activeReservationCount;
      }
    } else {
      metrics.push({
        after: action === 'ACTIVATE' ? 'NON_ARCHIVED_REQUIRED' : 'UNCHANGED',
        before: impact.parentProductStatus ?? 'UNKNOWN',
        key: 'parent_product_status',
        label: 'Parent product status',
      });
      if (action === 'ACTIVATE' && (
        (impact.parentProductDeletedAt !== undefined && impact.parentProductDeletedAt !== null) ||
        impact.parentProductStatus === 'ARCHIVED'
      )) {
        warnings.push('STATE_CONFLICT');
        affectedCount = 1;
      } else if (action === 'SOFT_DELETE' && impact.activeReservationCount > 0) {
        warnings.push('ACTIVE_INVENTORY_RESERVATION');
        affectedCount = impact.activeReservationCount;
      }
    }
    metrics.push({
      after: action === 'SOFT_DELETE' ? 'ZERO_REQUIRED' : 'UNCHANGED',
      before: String(impact.activeReservationCount),
      key: 'active_reservations',
      label: 'Active reservations',
    });
    return { affected_count: affectedCount, metrics, warnings };
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

  private productCatalogReplay(
    claimed: Awaited<ReturnType<IdempotencyRepository['claim']>>,
    expectedStatus: number,
    expectedType: ProductCatalogResourceType,
    expectedResourceId?: string,
  ): CacheableProductCatalogResponse | null {
    if (claimed.kind !== 'replay') return null;
    if (claimed.record.response_status !== expectedStatus) {
      throw new ApplicationError('INTERNAL_ERROR', 'Product catalog idempotency replay is invalid');
    }
    const response = this.idempotency.productCatalogReplay(claimed.record);
    const actualType: ProductCatalogResourceType = 'product_id' in response.data ? 'product' : 'sku';
    const actualResourceId = actualType === 'product'
      ? (response.data as CacheableProductDetailView).product_id
      : (response.data as CacheableSkuView).sku_id;
    if (actualType !== expectedType ||
      (expectedResourceId !== undefined && actualResourceId !== expectedResourceId)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Product catalog idempotency replay target is invalid');
    }
    return response;
  }

  private commandReplay(
    claimed: Awaited<ReturnType<IdempotencyRepository['claim']>>,
    expectedType: ProductCatalogResourceType,
    expectedResourceId: string,
  ): CacheableCommandResponse | null {
    if (claimed.kind !== 'replay') return null;
    if (claimed.record.response_status !== 200) {
      throw new ApplicationError('INTERNAL_ERROR', 'Product lifecycle command replay is invalid');
    }
    const response = this.idempotency.commandReplay(claimed.record);
    if (response.data.resource_type !== expectedType || response.data.resource_id !== expectedResourceId) {
      throw new ApplicationError('INTERNAL_ERROR', 'Product lifecycle command replay target is invalid');
    }
    return response;
  }

  private productCatalogResponse(
    requestId: string,
    data: CacheableProductDetailView | CacheableSkuView,
  ): CacheableProductCatalogResponse {
    return { code: 'OK', data, message: 'success', request_id: requestId } as CacheableProductCatalogResponse;
  }

  private async completeProductCatalogResponse(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    response: CacheableProductCatalogResponse,
    responseStatus: number,
  ): Promise<void> {
    await this.idempotency.complete(transaction, claim, {
      policy: 'PRODUCT_CATALOG_RESPONSE',
      responseBody: response,
      responseStatus,
      storage: 'CACHEABLE',
    });
  }

  private commandResponse(
    requestId: string,
    type: ProductCatalogResourceType,
    resource: ProductCatalogSnapshot,
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

  private async appendLifecycleAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    action: 'ARCHIVE' | 'DISABLE' | 'ENABLE' | 'RESTORE',
    type: ProductCatalogResourceType,
    objectId: string,
    before: Pick<ProductCatalogSnapshot, 'status' | 'version'>,
    after: Pick<ProductCatalogSnapshot, 'status' | 'version'>,
    reason: string,
  ): Promise<void> {
    const ipAddress = catalogRequestIp(request);
    await this.audit.append(transaction, {
      action,
      actorAccountId: request.principal.accountId,
      actorRole: request.principal.role,
      after: { status: after.status, version: after.version },
      before: { status: before.status, version: before.version },
      idempotencyKey,
      ...(ipAddress === undefined ? {} : { ipAddress }),
      module: 'catalog',
      objectId,
      objectType: type,
      reason,
      requestId: request.requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }

  private appendLifecycleOutbox(
    transaction: DatabaseTransaction,
    type: ProductCatalogResourceType,
    resource: ProductCatalogSnapshot,
    event: 'lifecycle_changed' | 'restored',
  ) {
    return this.outbox.append(transaction, {
      aggregateId: resource.id,
      aggregateType: type,
      eventType: `${type}.${event}`,
      payload: {
        event_version: 1,
        resource_id: resource.id,
        resource_type: type,
        resource_version: resource.version,
      },
    });
  }

  private async appendAudit(
    transaction: DatabaseTransaction,
    request: AdminCatalogRequestContext,
    idempotencyKey: string,
    action: 'CREATE' | 'UPDATE',
    type: ProductCatalogResourceType,
    objectId: string,
    before: Pick<ProductCatalogProductSnapshot | ProductCatalogSkuSnapshot, 'status' | 'version'> | undefined,
    after: Pick<ProductCatalogProductSnapshot | ProductCatalogSkuSnapshot, 'status' | 'version'>,
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
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'STATUS_VERSION',
    });
  }
}
