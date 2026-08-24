import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type BrandSnapshot,
  type CacheableBrandView,
  type CacheableCategoryView,
  type CacheableProductCatalogResponse,
  type CacheableProductDetailView,
  type CacheableSkuSpec,
  type CacheableSkuView,
  type CategorySnapshot,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  ProductCatalogRepository,
  type ProductCatalogProductSnapshot,
  type ProductCatalogSkuSnapshot,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError, generateUlid } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { catalogRequestIp, type AdminCatalogRequestContext } from '../admin-catalog/admin-catalog.request';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import type {
  ProductCreateInput,
  ProductListInput,
  ProductUpdateInput,
  SkuCreateInput,
  SkuSpec,
  SkuUpdateInput,
} from './admin-products.dto';

const ROUTES = {
  productCreate: '/admin/products',
  productUpdate: '/admin/products/{product_id}',
  skuCreate: '/admin/products/{product_id}/skus',
  skuUpdate: '/admin/skus/{sku_id}',
} as const;

type ProductCatalogResourceType = 'product' | 'sku';

function preEnvelopedProductCatalog(response: CacheableProductCatalogResponse) {
  return preEnvelopedResponse<CacheableProductDetailView | CacheableSkuView>(response);
}

@Injectable()
export class AdminProductsService {
  private readonly audit!: AuditRepository;
  private readonly catalog!: ProductCatalogRepository;
  private readonly idempotency!: IdempotencyRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.catalog = new ProductCatalogRepository(database.prisma);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
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
