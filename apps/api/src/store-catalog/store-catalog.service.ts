import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type DatabaseRuntime,
  StoreCatalogRepository,
  type StoreCatalogBannerSnapshot,
  type StoreCatalogBrandSnapshot,
  type StoreCatalogCategorySnapshot,
  type StoreCatalogImageSnapshot,
  type StoreCatalogProductDetail,
  type StoreCatalogProductListItem,
  type StoreCatalogSkuSnapshot,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import type { StoreProductListInput } from './store-catalog.dto';

type SectionStatus = 'READY' | 'UNAVAILABLE';

@Injectable()
export class StoreCatalogService {
  private readonly catalog!: StoreCatalogRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.catalog = new StoreCatalogRepository(database.prisma, config.banner.targetOrigins);
    }
  }

  async getHome() {
    this.runtime();
    const [banners, categories, hotProducts, newProducts] = await Promise.allSettled([
      this.homeBanners(),
      this.homeCategories(),
      this.homeHotProducts(),
      this.homeNewProducts(),
    ] as const);
    const sections = [banners, categories, hotProducts, newProducts] as const;
    if (sections.every((section) => section.status === 'rejected')) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store catalog home is unavailable');
    }
    return {
      banners: banners.status === 'fulfilled' ? banners.value : [],
      categories: categories.status === 'fulfilled' ? categories.value : [],
      hot_products: hotProducts.status === 'fulfilled' ? hotProducts.value : [],
      new_products: newProducts.status === 'fulfilled' ? newProducts.value : [],
      section_status: {
        banners: this.sectionStatus(banners),
        categories: this.sectionStatus(categories),
        hot_products: this.sectionStatus(hotProducts),
        new_products: this.sectionStatus(newProducts),
      },
    };
  }

  async listCategories() {
    const { catalog } = this.runtime();
    return { items: (await catalog.listCategories()).map((category) => this.categoryView(category)) };
  }

  async listBrands() {
    const { catalog } = this.runtime();
    return { items: (await catalog.listBrands()).map((brand) => this.brandView(brand)) };
  }

  async listProducts(input: StoreProductListInput) {
    const { catalog } = this.runtime();
    const result = await catalog.listProducts({
      ...(input.brandId === undefined ? {} : { brandId: input.brandId }),
      ...(input.categoryId === undefined ? {} : { categoryId: input.categoryId }),
      ...(input.keyword === undefined ? {} : { keyword: input.keyword }),
      page: input.page,
      pageSize: input.pageSize,
      sort: input.sort,
    });
    return {
      items: result.items.map((product) => this.productListItemView(product)),
      pagination: { page: input.page, page_size: input.pageSize, total: result.total },
    };
  }

  async getProduct(productId: string) {
    const { catalog } = this.runtime();
    const product = await catalog.getProduct(productId);
    if (product === null) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Product not found');
    return this.productDetailView(product);
  }

  private runtime(): { catalog: StoreCatalogRepository; storage: ObjectStoragePort } {
    if (!this.catalog || !this.storage) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store catalog runtime is unavailable');
    }
    return { catalog: this.catalog, storage: this.storage };
  }

  private async homeBanners() {
    const { catalog } = this.runtime();
    return (await catalog.listHomeBanners()).map((banner) => this.bannerView(banner));
  }

  private async homeCategories() {
    const { catalog } = this.runtime();
    return (await catalog.listHomeCategories()).map((category) => this.categoryView(category));
  }

  private async homeHotProducts() {
    const { catalog } = this.runtime();
    return (await catalog.listHomeHotProducts()).map((product) => this.productListItemView(product));
  }

  private async homeNewProducts() {
    const { catalog } = this.runtime();
    return (await catalog.listHomeNewProducts()).map((product) => this.productListItemView(product));
  }

  private sectionStatus(result: PromiseSettledResult<unknown>): SectionStatus {
    return result.status === 'fulfilled' ? 'READY' : 'UNAVAILABLE';
  }

  private brandView(resource: StoreCatalogBrandSnapshot) {
    const { storage } = this.runtime();
    return {
      brand_id: resource.id,
      description: resource.description,
      logo_url: resource.logoObjectKey === null ? null : storage.publicUrl(resource.logoObjectKey),
      name: resource.name,
      sort_order: resource.sortOrder,
    };
  }

  private categoryView(resource: StoreCatalogCategorySnapshot) {
    const { storage } = this.runtime();
    return {
      category_id: resource.id,
      icon_url: resource.iconObjectKey === null ? null : storage.publicUrl(resource.iconObjectKey),
      name: resource.name,
      sort_order: resource.sortOrder,
    };
  }

  private imageView(resource: StoreCatalogImageSnapshot) {
    const { storage } = this.runtime();
    return {
      is_primary: resource.isPrimary,
      sort_order: resource.sortOrder,
      url: storage.publicUrl(resource.objectKey),
    };
  }

  private skuView(resource: StoreCatalogSkuSnapshot) {
    return {
      available_stock: resource.availableStock,
      code: resource.code,
      is_recommended: resource.isRecommended,
      is_salable: resource.isSalable,
      name: resource.name,
      retail_price: resource.retailPrice,
      sku_id: resource.id,
      spec_json: this.skuSpecification(resource.specification),
    };
  }

  private skuSpecification(value: StoreCatalogSkuSnapshot['specification']) {
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

  private productListItemView(resource: StoreCatalogProductListItem) {
    return {
      brand: this.brandView(resource.brand),
      category: this.categoryView(resource.category),
      is_hot: resource.isHot,
      is_new: resource.isNew,
      is_salable: resource.isSalable,
      minimum_active_price: resource.minimumActivePrice,
      name: resource.name,
      net_sales_count: resource.netSalesCount,
      primary_image: resource.primaryImage === null ? null : this.imageView(resource.primaryImage),
      product_id: resource.id,
      spu_code: resource.spuCode,
      subtitle: resource.subtitle,
    };
  }

  private productDetailView(resource: StoreCatalogProductDetail) {
    return {
      brand: this.brandView(resource.brand),
      category: this.categoryView(resource.category),
      images: resource.images.map((image) => this.imageView(image)),
      ingredients: resource.ingredients,
      introduction: resource.introduction,
      is_hot: resource.isHot,
      is_new: resource.isNew,
      name: resource.name,
      net_sales_count: resource.netSalesCount,
      product_id: resource.id,
      skus: resource.skus.map((sku) => this.skuView(sku)),
      spu_code: resource.spuCode,
      subtitle: resource.subtitle,
      usage_method: resource.usageMethod,
    };
  }

  private bannerView(resource: StoreCatalogBannerSnapshot) {
    const base = {
      banner_id: resource.id,
      image_url: this.runtime().storage.publicUrl(resource.imageObjectKey),
      sort_order: resource.sortOrder,
      title: resource.title,
    };
    if (resource.targetType === 'NONE' && resource.targetId === null && resource.targetUrl === null) {
      return { ...base, target_id: null, target_type: 'NONE' as const, target_url: null };
    }
    if ((resource.targetType === 'PRODUCT' || resource.targetType === 'CATEGORY') &&
      resource.targetId !== null && resource.targetUrl === null) {
      return {
        ...base,
        target_id: resource.targetId,
        target_type: resource.targetType,
        target_url: null,
      };
    }
    if (resource.targetType === 'URL' && resource.targetId === null && resource.targetUrl !== null) {
      return { ...base, target_id: null, target_type: 'URL' as const, target_url: resource.targetUrl };
    }
    throw new ApplicationError('INTERNAL_ERROR', 'Stored public Banner target is invalid');
  }
}
