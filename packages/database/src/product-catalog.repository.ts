import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { EntityStatus, SkuStatus } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  acquireMasterDataHierarchyLocks,
  type BrandSnapshot,
  type CategorySnapshot,
} from './master-data.repository';

export interface ProductCatalogListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  brandId?: string;
  categoryId?: string;
  status?: EntityStatus;
  recommended?: boolean;
}

export interface ProductCatalogImageInput {
  fileId: string;
  sortOrder: number;
}

export interface ProductCatalogImageSnapshot {
  id: string;
  fileId: string;
  objectKey: string;
  sortOrder: number;
  isPrimary: boolean;
  createdAt: Date;
}

export interface ProductCatalogInventorySnapshot {
  id: string;
  physicalQty: number;
  lockedQty: number;
  availableQty: number;
  version: number;
  updatedAt: Date;
}

export interface ProductCatalogSkuSnapshot {
  id: string;
  productId: string;
  code: string;
  name: string;
  specification: Prisma.JsonValue | null;
  retailPrice: string;
  isRecommended: boolean;
  status: SkuStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  inventory: ProductCatalogInventorySnapshot;
}

export interface ProductCatalogProductSnapshot {
  id: string;
  spuCode: string;
  brandId: string;
  categoryId: string;
  name: string;
  subtitle: string | null;
  introduction: string | null;
  ingredients: string | null;
  usageMethod: string | null;
  status: EntityStatus;
  isHot: boolean;
  isNew: boolean;
  salesCount: number;
  publishedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  brand: BrandSnapshot;
  category: CategorySnapshot;
  images: ProductCatalogImageSnapshot[];
  skus: ProductCatalogSkuSnapshot[];
  minimumActivePrice: string | null;
}

export interface ProductCatalogListItem {
  product: ProductCatalogProductSnapshot;
  skuCount: number;
  activeSkuCount: number;
  physicalQty: number;
  lockedQty: number;
  availableQty: number;
  minimumActivePrice: string | null;
  skus: ProductCatalogSkuSnapshot[];
}

export interface ProductCatalogListResult {
  items: ProductCatalogListItem[];
  total: number;
}

export interface CreateProductInput {
  actorId: string;
  id: string;
  spuCode: string;
  name: string;
  brandId: string;
  categoryId: string;
  subtitle: string | null;
  introduction: string | null;
  ingredients: string | null;
  usageMethod: string | null;
  isHot: boolean;
  isNew: boolean;
  images: readonly ProductCatalogImageInput[];
}

export interface UpdateProductPatch {
  name?: string;
  brandId?: string;
  categoryId?: string;
  subtitle?: string | null;
  introduction?: string | null;
  ingredients?: string | null;
  usageMethod?: string | null;
  isHot?: boolean;
  isNew?: boolean;
  images?: readonly ProductCatalogImageInput[];
}

export interface UpdateProductInput {
  actorId: string;
  id: string;
  expectedVersion: number;
  patch: UpdateProductPatch;
}

export interface SkuSpecAttribute {
  name: string;
  value: string;
}

export interface SkuSpecification {
  attributes: readonly SkuSpecAttribute[];
}

export interface CreateSkuInput {
  id: string;
  inventoryBalanceId: string;
  productId: string;
  code: string;
  name: string;
  specification: SkuSpecification | null;
  retailPrice: string;
  isRecommended: boolean;
}

export interface UpdateSkuPatch {
  name?: string;
  specification?: SkuSpecification | null;
  retailPrice?: string;
  isRecommended?: boolean;
}

export interface UpdateSkuInput {
  id: string;
  expectedVersion: number;
  patch: UpdateSkuPatch;
}

const FILE_SELECT = {
  deleted_at: true,
  id: true,
  object_key: true,
  purpose: true,
  status: true,
  visibility: true,
} as const;
const PRODUCT_INCLUDE = {
  brand: { include: { logo: { select: FILE_SELECT } } },
  category: { include: { icon: { select: FILE_SELECT } } },
  images: {
    include: { file: { select: FILE_SELECT } },
    orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
    where: { deleted_at: null },
  },
  skus: {
    include: { inventory_balance: true },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.ProductInclude;
const SKU_INCLUDE = {
  inventory_balance: true,
  product: { select: { deleted_at: true, id: true, status: true } },
} satisfies Prisma.SkuInclude;

type ProductRecord = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;
type SkuRecord = Prisma.SkuGetPayload<{ include: typeof SKU_INCLUDE }>;
type ProductSkuRecord = ProductRecord['skus'][number];
type ProductImageRecord = ProductRecord['images'][number];
type FileLink = ProductImageRecord['file'] | ProductRecord['brand']['logo'] | ProductRecord['category']['icon'];

const ENTITY_STATUS = new Set<EntityStatus>(['ACTIVE', 'ARCHIVED', 'DRAFT', 'INACTIVE']);
const LIST_FIELDS = new Set(['brandId', 'categoryId', 'keyword', 'page', 'pageSize', 'recommended', 'status']);
const CREATE_PRODUCT_FIELDS = new Set([
  'actorId',
  'brandId',
  'categoryId',
  'id',
  'images',
  'ingredients',
  'introduction',
  'isHot',
  'isNew',
  'name',
  'spuCode',
  'subtitle',
  'usageMethod',
]);
const UPDATE_PRODUCT_FIELDS = new Set(['actorId', 'expectedVersion', 'id', 'patch']);
const PRODUCT_PATCH_FIELDS = new Set([
  'brandId',
  'categoryId',
  'images',
  'ingredients',
  'introduction',
  'isHot',
  'isNew',
  'name',
  'subtitle',
  'usageMethod',
]);
const IMAGE_FIELDS = new Set(['fileId', 'sortOrder']);
const CREATE_SKU_FIELDS = new Set([
  'code',
  'id',
  'inventoryBalanceId',
  'isRecommended',
  'name',
  'productId',
  'retailPrice',
  'specification',
]);
const UPDATE_SKU_FIELDS = new Set(['expectedVersion', 'id', 'patch']);
const SKU_PATCH_FIELDS = new Set(['isRecommended', 'name', 'retailPrice', 'specification']);
const SPECIFICATION_FIELDS = new Set(['attributes']);
const ATTRIBUTE_FIELDS = new Set(['name', 'value']);
const POSITIVE_MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value: unknown, fields: ReadonlySet<string>): boolean {
  return isPlainObject(value) && Object.keys(value).every((key) => fields.has(key));
}

function requireExactFields(value: unknown, fields: ReadonlySet<string>, label: string): void {
  if (!isPlainObject(value) || !hasOnlyFields(value, fields) || Object.keys(value).length !== fields.size) {
    throw new TypeError(`${label} contains unsupported or missing fields`);
  }
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new TypeError('Expected version must be a positive PostgreSQL INTEGER');
  }
}

function requireString(value: string, label: string, minimum: number, maximum: number): void {
  const length = typeof value === 'string' ? Array.from(value).length : 0;
  if (typeof value !== 'string' || length < minimum || length > maximum || value.trim().length === 0) {
    throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters`);
  }
}

function requireNullableString(value: string | null, label: string, maximum: number): void {
  if (value !== null && (typeof value !== 'string' || Array.from(value).length > maximum)) {
    throw new TypeError(`${label} must be null or contain at most ${maximum} characters`);
  }
}

function requireBoolean(value: boolean, label: string): void {
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be a boolean`);
}

function requireSortOrder(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new TypeError('Product image sort order must be a non-negative PostgreSQL INTEGER');
  }
}

function validateImages(images: readonly ProductCatalogImageInput[]): void {
  if (!Array.isArray(images) || images.length > 8) throw new TypeError('Product images must contain at most 8 items');
  const fileIds = new Set<string>();
  const sortOrders = new Set<number>();
  for (const image of images) {
    requireExactFields(image, IMAGE_FIELDS, 'Product image');
    requireUlid(image.fileId, 'Product image file ID');
    requireSortOrder(image.sortOrder);
    if (fileIds.has(image.fileId)) throw new TypeError('Product image file ID must be unique');
    if (sortOrders.has(image.sortOrder)) throw new TypeError('Product image sort order must be unique');
    fileIds.add(image.fileId);
    sortOrders.add(image.sortOrder);
  }
}

function validateSpecification(value: SkuSpecification | null): void {
  if (value === null) return;
  requireExactFields(value, SPECIFICATION_FIELDS, 'SKU specification');
  if (!Array.isArray(value.attributes) || value.attributes.length < 1) {
    throw new TypeError('SKU specification attributes must not be empty');
  }
  const attributes = new Set<string>();
  for (const attribute of value.attributes) {
    requireExactFields(attribute, ATTRIBUTE_FIELDS, 'SKU specification attribute');
    requireString(attribute.name, 'SKU specification attribute name', 1, 80);
    requireString(attribute.value, 'SKU specification attribute value', 1, 160);
    const key = `${attribute.name}\u0000${attribute.value}`;
    if (attributes.has(key)) throw new TypeError('SKU specification attributes must be unique');
    attributes.add(key);
  }
}

function requireMoney(value: string): void {
  if (typeof value !== 'string' || !POSITIVE_MONEY.test(value)) {
    throw new TypeError('SKU retail price must be a positive money string with two decimals');
  }
}

function validateListInput(input: ProductCatalogListInput): void {
  if (!hasOnlyFields(input, LIST_FIELDS)) throw new TypeError('Product list query contains unsupported fields');
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw new TypeError('Page must be a positive integer');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Page size must be between 1 and 100');
  }
  if (input.keyword !== undefined &&
    (typeof input.keyword !== 'string' || input.keyword.trim().length === 0)) {
    throw new TypeError('Product keyword must not be blank');
  }
  if (input.brandId !== undefined) requireUlid(input.brandId, 'Product brand ID');
  if (input.categoryId !== undefined) requireUlid(input.categoryId, 'Product category ID');
  if (input.status !== undefined && !ENTITY_STATUS.has(input.status)) throw new TypeError('Product status is invalid');
  if (input.recommended !== undefined) requireBoolean(input.recommended, 'Product recommended filter');
}

function validateCreateProduct(input: CreateProductInput): void {
  requireExactFields(input, CREATE_PRODUCT_FIELDS, 'Product create input');
  requireUlid(input.actorId, 'Product actor ID');
  requireUlid(input.id, 'Product ID');
  requireString(input.spuCode, 'Product SPU code', 1, 80);
  requireString(input.name, 'Product name', 1, 200);
  requireUlid(input.brandId, 'Product brand ID');
  requireUlid(input.categoryId, 'Product category ID');
  requireNullableString(input.subtitle, 'Product subtitle', 300);
  requireNullableString(input.introduction, 'Product introduction', 5_000);
  requireNullableString(input.ingredients, 'Product ingredients', 10_000);
  requireNullableString(input.usageMethod, 'Product usage method', 5_000);
  requireBoolean(input.isHot, 'Product hot flag');
  requireBoolean(input.isNew, 'Product new flag');
  validateImages(input.images);
}

function validateProductPatch(patch: UpdateProductPatch): void {
  if (!hasOnlyFields(patch, PRODUCT_PATCH_FIELDS) || Object.keys(patch).length < 1) {
    throw new TypeError('Product patch must contain at least one supported field');
  }
  if (patch.name !== undefined) requireString(patch.name, 'Product name', 1, 200);
  if (patch.brandId !== undefined) requireUlid(patch.brandId, 'Product brand ID');
  if (patch.categoryId !== undefined) requireUlid(patch.categoryId, 'Product category ID');
  if ('subtitle' in patch) requireNullableString(patch.subtitle as string | null, 'Product subtitle', 300);
  if ('introduction' in patch) {
    requireNullableString(patch.introduction as string | null, 'Product introduction', 5_000);
  }
  if ('ingredients' in patch) requireNullableString(patch.ingredients as string | null, 'Product ingredients', 10_000);
  if ('usageMethod' in patch) requireNullableString(patch.usageMethod as string | null, 'Product usage method', 5_000);
  if (patch.isHot !== undefined) requireBoolean(patch.isHot, 'Product hot flag');
  if (patch.isNew !== undefined) requireBoolean(patch.isNew, 'Product new flag');
  if (patch.images !== undefined) validateImages(patch.images);
}

function validateUpdateProduct(input: UpdateProductInput): void {
  requireExactFields(input, UPDATE_PRODUCT_FIELDS, 'Product update input');
  requireUlid(input.actorId, 'Product actor ID');
  requireUlid(input.id, 'Product ID');
  requireVersion(input.expectedVersion);
  validateProductPatch(input.patch);
}

function validateCreateSku(input: CreateSkuInput): void {
  requireExactFields(input, CREATE_SKU_FIELDS, 'SKU create input');
  requireUlid(input.id, 'SKU ID');
  requireUlid(input.inventoryBalanceId, 'SKU inventory balance ID');
  requireUlid(input.productId, 'SKU product ID');
  requireString(input.code, 'SKU code', 1, 80);
  requireString(input.name, 'SKU name', 1, 160);
  validateSpecification(input.specification);
  requireMoney(input.retailPrice);
  requireBoolean(input.isRecommended, 'SKU recommended flag');
}

function validateSkuPatch(patch: UpdateSkuPatch): void {
  if (!hasOnlyFields(patch, SKU_PATCH_FIELDS) || Object.keys(patch).length < 1) {
    throw new TypeError('SKU patch must contain at least one supported field');
  }
  if (patch.name !== undefined) requireString(patch.name, 'SKU name', 1, 160);
  if ('specification' in patch) validateSpecification(patch.specification as SkuSpecification | null);
  if (patch.retailPrice !== undefined) requireMoney(patch.retailPrice);
  if (patch.isRecommended !== undefined) requireBoolean(patch.isRecommended, 'SKU recommended flag');
}

function validateUpdateSku(input: UpdateSkuInput): void {
  requireExactFields(input, UPDATE_SKU_FIELDS, 'SKU update input');
  requireUlid(input.id, 'SKU ID');
  requireVersion(input.expectedVersion);
  validateSkuPatch(input.patch);
}

function listWhere(input: ProductCatalogListInput): Prisma.ProductWhereInput {
  const lifecycle: Prisma.ProductWhereInput = input.status === 'ARCHIVED'
    ? { deleted_at: { not: null }, status: 'ARCHIVED' }
    : input.status === undefined
      ? { deleted_at: null, status: { not: 'ARCHIVED' } }
      : { deleted_at: null, status: input.status };
  return {
    ...lifecycle,
    ...(input.brandId === undefined ? {} : { brand_id: input.brandId }),
    ...(input.categoryId === undefined ? {} : { category_id: input.categoryId }),
    ...(input.keyword === undefined ? {} : {
      OR: [
        { name: { contains: input.keyword, mode: 'insensitive' } },
        { spu_code: { contains: input.keyword, mode: 'insensitive' } },
        { skus: { some: { code: { contains: input.keyword, mode: 'insensitive' } } } },
      ],
    }),
    ...(input.recommended === undefined ? {} : {
      skus: input.recommended
        ? { some: { deleted_at: null, is_recommended: true } }
        : { none: { deleted_at: null, is_recommended: true } },
    }),
  };
}

function validPublicObjectKey(file: FileLink, purpose: 'BRAND_LOGO' | 'CATEGORY_ICON' | 'PRODUCT_IMAGE'): string | null {
  if (!file || file.deleted_at !== null || file.object_key !== `public/${file.id}` || file.purpose !== purpose ||
    file.status !== 'READY' || file.visibility !== 'PUBLIC') return null;
  return file.object_key;
}

function brandSnapshot(record: ProductRecord['brand']): BrandSnapshot {
  return {
    createdAt: record.created_at,
    deletedAt: record.deleted_at,
    description: record.description,
    id: record.id,
    logoFileId: record.logo_file_id,
    logoObjectKey: validPublicObjectKey(record.logo, 'BRAND_LOGO'),
    name: record.name,
    sortOrder: record.sort_order,
    status: record.status,
    updatedAt: record.updated_at,
    version: record.version,
  };
}

function categorySnapshot(record: ProductRecord['category']): CategorySnapshot {
  return {
    createdAt: record.created_at,
    deletedAt: record.deleted_at,
    iconFileId: record.icon_file_id,
    iconObjectKey: validPublicObjectKey(record.icon, 'CATEGORY_ICON'),
    id: record.id,
    name: record.name,
    sortOrder: record.sort_order,
    status: record.status,
    updatedAt: record.updated_at,
    version: record.version,
  };
}

function moneyString(value: Prisma.Decimal | string | number): string {
  if (typeof value === 'string') return new Prisma.Decimal(value).toFixed(2);
  if (typeof value === 'number') return new Prisma.Decimal(value).toFixed(2);
  return value.toFixed(2);
}

function inventorySnapshot(
  record: ProductSkuRecord['inventory_balance'] | SkuRecord['inventory_balance'],
): ProductCatalogInventorySnapshot {
  if (!record) {
    throw new ApplicationError('INTERNAL_ERROR', 'SKU inventory balance invariant is missing');
  }
  return {
    availableQty: record.physical_qty - record.locked_qty,
    id: record.id,
    lockedQty: record.locked_qty,
    physicalQty: record.physical_qty,
    updatedAt: record.updated_at,
    version: record.version,
  };
}

function skuSnapshot(record: ProductSkuRecord | SkuRecord): ProductCatalogSkuSnapshot {
  return {
    code: record.code,
    createdAt: record.created_at,
    deletedAt: record.deleted_at,
    id: record.id,
    inventory: inventorySnapshot(record.inventory_balance),
    isRecommended: record.is_recommended,
    name: record.name,
    productId: record.product_id,
    retailPrice: moneyString(record.retail_price),
    specification: record.spec_json,
    status: record.status,
    updatedAt: record.updated_at,
    version: record.version,
  };
}

function compareMoney(left: string, right: string): number {
  const [leftWhole = '', leftFraction = ''] = left.split('.');
  const [rightWhole = '', rightFraction = ''] = right.split('.');
  if (leftWhole.length !== rightWhole.length) return leftWhole.length - rightWhole.length;
  if (leftWhole !== rightWhole) return leftWhole < rightWhole ? -1 : 1;
  if (leftFraction === rightFraction) return 0;
  return leftFraction < rightFraction ? -1 : 1;
}

function minimumActivePrice(skus: readonly ProductCatalogSkuSnapshot[]): string | null {
  const prices = skus
    .filter((sku) => sku.status === 'ACTIVE' && sku.deletedAt === null)
    .map((sku) => sku.retailPrice)
    .sort(compareMoney);
  return prices[0] ?? null;
}

function productSnapshot(record: ProductRecord): ProductCatalogProductSnapshot {
  const images = record.images.flatMap((image, index) => {
    const objectKey = validPublicObjectKey(image.file, 'PRODUCT_IMAGE');
    return objectKey === null ? [] : [{
      createdAt: image.created_at,
      fileId: image.file_id,
      id: image.id,
      isPrimary: index === 0,
      objectKey,
      sortOrder: image.sort_order,
    }];
  });
  if (images.length > 0 && !images[0]?.isPrimary) images[0]!.isPrimary = true;
  const skus = record.skus.map((sku) => skuSnapshot(sku));
  return {
    brand: brandSnapshot(record.brand),
    brandId: record.brand_id,
    category: categorySnapshot(record.category),
    categoryId: record.category_id,
    createdAt: record.created_at,
    deletedAt: record.deleted_at,
    id: record.id,
    images,
    ingredients: record.ingredients,
    introduction: record.introduction,
    isHot: record.is_hot,
    isNew: record.is_new,
    minimumActivePrice: minimumActivePrice(skus),
    name: record.name,
    publishedAt: record.published_at,
    salesCount: record.sales_count,
    skus,
    spuCode: record.spu_code,
    status: record.status,
    subtitle: record.subtitle,
    updatedAt: record.updated_at,
    usageMethod: record.usage_method,
    version: record.version,
  };
}

function listItem(snapshot: ProductCatalogProductSnapshot): ProductCatalogListItem {
  const inventory = snapshot.skus.reduce((sum, sku) => ({
    availableQty: sum.availableQty + sku.inventory.availableQty,
    lockedQty: sum.lockedQty + sku.inventory.lockedQty,
    physicalQty: sum.physicalQty + sku.inventory.physicalQty,
  }), { availableQty: 0, lockedQty: 0, physicalQty: 0 });
  return {
    activeSkuCount: snapshot.skus.filter((sku) => sku.status === 'ACTIVE' && sku.deletedAt === null).length,
    availableQty: inventory.availableQty,
    lockedQty: inventory.lockedQty,
    minimumActivePrice: snapshot.minimumActivePrice,
    physicalQty: inventory.physicalQty,
    product: snapshot,
    skuCount: snapshot.skus.length,
    skus: snapshot.skus,
  };
}

function productNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Product does not exist');
}

function skuNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'SKU does not exist');
}

function versionConflict(resource: 'Product' | 'SKU'): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', `${resource} version changed`);
}

function archivedConflict(resource: 'Product' | 'SKU'): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', `Archived ${resource} cannot be edited`);
}

function specificationData(value: SkuSpecification | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === null ? Prisma.DbNull : value as unknown as Prisma.InputJsonValue;
}

export class ProductCatalogRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Product catalog repository clock must return a valid Date');
    }
    return value;
  }

  async listProducts(input: ProductCatalogListInput): Promise<ProductCatalogListResult> {
    validateListInput(input);
    const where = listWhere(input);
    const [records, total] = await Promise.all([
      this.prisma.product.findMany({
        include: PRODUCT_INCLUDE,
        orderBy: [{ published_at: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.product.count({ where }),
    ]);
    return { items: records.map((record) => listItem(productSnapshot(record))), total };
  }

  async getProduct(id: string): Promise<ProductCatalogProductSnapshot> {
    requireUlid(id, 'Product ID');
    const record = await this.prisma.product.findUnique({ include: PRODUCT_INCLUDE, where: { id } });
    if (!record) throw productNotFound();
    return productSnapshot(record);
  }

  private async readProduct(
    transaction: DatabaseTransaction,
    id: string,
  ): Promise<ProductCatalogProductSnapshot> {
    const record = await transaction.product.findUnique({ include: PRODUCT_INCLUDE, where: { id } });
    if (!record) throw productNotFound();
    return productSnapshot(record);
  }

  private async readSku(transaction: DatabaseTransaction, id: string): Promise<ProductCatalogSkuSnapshot> {
    const record = await transaction.sku.findUnique({ include: SKU_INCLUDE, where: { id } });
    if (!record) throw skuNotFound();
    return skuSnapshot(record);
  }

  private async assertReferences(
    transaction: DatabaseTransaction,
    brandId: string,
    categoryId: string,
  ): Promise<{ brandStatus: EntityStatus; categoryStatus: EntityStatus }> {
    const [brand, category] = await Promise.all([
      transaction.brand.findUnique({ select: { deleted_at: true, id: true, status: true }, where: { id: brandId } }),
      transaction.category.findUnique({
        select: { deleted_at: true, id: true, status: true },
        where: { id: categoryId },
      }),
    ]);
    if (!brand || brand.deleted_at !== null || brand.status === 'ARCHIVED') {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Product brand does not exist');
    }
    if (!category || category.deleted_at !== null || category.status === 'ARCHIVED') {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Product category does not exist');
    }
    return { brandStatus: brand.status, categoryStatus: category.status };
  }

  private async assertAttachableImages(
    transaction: DatabaseTransaction,
    actorId: string,
    images: readonly ProductCatalogImageInput[],
  ): Promise<void> {
    if (images.length === 0) return;
    const ids = images.map(({ fileId }) => fileId).sort();
    const records = await transaction.fileAsset.findMany({
      select: { id: true, object_key: true },
      where: {
        created_by_id: actorId,
        deleted_at: null,
        id: { in: ids },
        purpose: 'PRODUCT_IMAGE',
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    const valid = new Set(records
      .filter((record) => record.object_key === `public/${record.id}`)
      .map((record) => record.id));
    if (ids.some((id) => !valid.has(id))) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Attachable product image does not exist');
    }
  }

  private async assertProductCodeAvailable(
    transaction: DatabaseTransaction,
    spuCode: string,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'product-catalog-spu-code', [spuCode]);
    const record = await transaction.product.findUnique({
      select: { deleted_at: true, id: true, status: true },
      where: { spu_code: spuCode },
    });
    if (!record) return;
    if (record.deleted_at !== null || record.status === 'ARCHIVED') {
      throw new ApplicationError('SOFT_DELETED_KEY_RESERVED', 'Archived SPU code is reserved');
    }
    throw new ApplicationError('STATE_CONFLICT', 'SPU code already exists');
  }

  private async assertSkuCodeAvailable(transaction: DatabaseTransaction, code: string): Promise<void> {
    await acquireTransactionLock(transaction, 'product-catalog-sku-code', [code]);
    const record = await transaction.sku.findUnique({
      select: { deleted_at: true, id: true, status: true },
      where: { code },
    });
    if (!record) return;
    if (record.deleted_at !== null || record.status === 'ARCHIVED') {
      throw new ApplicationError('SOFT_DELETED_KEY_RESERVED', 'Archived SKU code is reserved');
    }
    throw new ApplicationError('STATE_CONFLICT', 'SKU code already exists');
  }

  private async insertImages(
    transaction: DatabaseTransaction,
    productId: string,
    images: readonly ProductCatalogImageInput[],
    now: Date,
  ): Promise<void> {
    if (images.length === 0) return;
    await transaction.productImage.createMany({
      data: images.map((image) => ({
        created_at: now,
        deleted_at: null,
        file_id: image.fileId,
        id: generateUlid(now.getTime()),
        product_id: productId,
        sort_order: image.sortOrder,
      })),
    });
  }

  async createProductInTransaction(
    transaction: DatabaseTransaction,
    input: CreateProductInput,
  ): Promise<ProductCatalogProductSnapshot> {
    validateCreateProduct(input);
    await acquireMasterDataHierarchyLocks(transaction, {
      brandIds: [input.brandId],
      categoryIds: [input.categoryId],
      productIds: [input.id],
    });
    await this.assertReferences(transaction, input.brandId, input.categoryId);
    await this.assertProductCodeAvailable(transaction, input.spuCode);
    await this.assertAttachableImages(transaction, input.actorId, input.images);
    const now = this.currentTime();
    await transaction.product.create({
      data: {
        brand_id: input.brandId,
        category_id: input.categoryId,
        created_at: now,
        deleted_at: null,
        id: input.id,
        ingredients: input.ingredients,
        introduction: input.introduction,
        is_hot: input.isHot,
        is_new: input.isNew,
        name: input.name,
        published_at: null,
        sales_count: 0,
        spu_code: input.spuCode,
        status: 'DRAFT',
        subtitle: input.subtitle,
        updated_at: now,
        usage_method: input.usageMethod,
        version: 1,
      },
    });
    await this.insertImages(transaction, input.id, input.images, now);
    return this.readProduct(transaction, input.id);
  }

  async updateProductInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateProductInput,
  ): Promise<ProductCatalogProductSnapshot> {
    validateUpdateProduct(input);
    const initial = await transaction.product.findUnique({
      select: { brand_id: true, category_id: true, id: true },
      where: { id: input.id },
    });
    if (!initial) throw productNotFound();
    const brandId = input.patch.brandId ?? initial.brand_id;
    const categoryId = input.patch.categoryId ?? initial.category_id;
    await acquireMasterDataHierarchyLocks(transaction, {
      brandIds: [initial.brand_id, brandId],
      categoryIds: [initial.category_id, categoryId],
      productIds: [input.id],
    });
    const current = await this.readProduct(transaction, input.id);
    if (current.deletedAt !== null || current.status === 'ARCHIVED') throw archivedConflict('Product');
    if (current.version !== input.expectedVersion) throw versionConflict('Product');
    const references = await this.assertReferences(transaction, brandId, categoryId);
    if (current.status === 'ACTIVE' &&
      ((input.patch.brandId !== undefined && references.brandStatus !== 'ACTIVE') ||
        (input.patch.categoryId !== undefined && references.categoryStatus !== 'ACTIVE'))) {
      throw new ApplicationError('STATE_CONFLICT', 'Active products require active brand and category references');
    }
    if (current.status === 'ACTIVE' && input.patch.images?.length === 0) {
      throw new ApplicationError('PRODUCT_PRIMARY_IMAGE_REQUIRED', 'Active product gallery cannot be empty');
    }
    if (input.patch.images !== undefined) {
      await this.assertAttachableImages(transaction, input.actorId, input.patch.images);
    }
    const now = this.currentTime();
    const result = await transaction.product.updateMany({
      data: {
        ...(input.patch.brandId === undefined ? {} : { brand_id: input.patch.brandId }),
        ...(input.patch.categoryId === undefined ? {} : { category_id: input.patch.categoryId }),
        ...(input.patch.ingredients === undefined ? {} : { ingredients: input.patch.ingredients }),
        ...(input.patch.introduction === undefined ? {} : { introduction: input.patch.introduction }),
        ...(input.patch.isHot === undefined ? {} : { is_hot: input.patch.isHot }),
        ...(input.patch.isNew === undefined ? {} : { is_new: input.patch.isNew }),
        ...(input.patch.name === undefined ? {} : { name: input.patch.name }),
        ...(input.patch.subtitle === undefined ? {} : { subtitle: input.patch.subtitle }),
        ...(input.patch.usageMethod === undefined ? {} : { usage_method: input.patch.usageMethod }),
        updated_at: now,
        version: { increment: 1 },
      },
      where: { deleted_at: null, id: input.id, version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict('Product');
    if (input.patch.images !== undefined) {
      await transaction.productImage.updateMany({
        data: { deleted_at: now },
        where: { deleted_at: null, product_id: input.id },
      });
      await this.insertImages(transaction, input.id, input.patch.images, now);
    }
    return this.readProduct(transaction, input.id);
  }

  async createSkuInTransaction(
    transaction: DatabaseTransaction,
    input: CreateSkuInput,
  ): Promise<ProductCatalogSkuSnapshot> {
    validateCreateSku(input);
    await acquireMasterDataHierarchyLocks(transaction, { productIds: [input.productId] });
    const product = await transaction.product.findUnique({
      select: { deleted_at: true, id: true, status: true },
      where: { id: input.productId },
    });
    if (!product) throw productNotFound();
    if (product.deleted_at !== null || product.status === 'ARCHIVED') throw archivedConflict('Product');
    await acquireTransactionLock(transaction, 'product-catalog-sku', [input.id]);
    await this.assertSkuCodeAvailable(transaction, input.code);
    const now = this.currentTime();
    await transaction.sku.create({
      data: {
        code: input.code,
        created_at: now,
        deleted_at: null,
        id: input.id,
        is_recommended: input.isRecommended,
        name: input.name,
        product_id: input.productId,
        retail_price: input.retailPrice,
        spec_json: specificationData(input.specification),
        status: 'INACTIVE',
        updated_at: now,
        version: 1,
      },
    });
    await transaction.inventoryBalance.create({
      data: {
        id: input.inventoryBalanceId,
        locked_qty: 0,
        physical_qty: 0,
        sku_id: input.id,
        updated_at: now,
        version: 1,
      },
    });
    return this.readSku(transaction, input.id);
  }

  async updateSkuInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateSkuInput,
  ): Promise<ProductCatalogSkuSnapshot> {
    validateUpdateSku(input);
    const initial = await transaction.sku.findUnique({
      select: { id: true, product_id: true },
      where: { id: input.id },
    });
    if (!initial) throw skuNotFound();
    await acquireMasterDataHierarchyLocks(transaction, { productIds: [initial.product_id] });
    await acquireTransactionLock(transaction, 'product-catalog-sku', [input.id]);
    const current = await transaction.sku.findUnique({ include: SKU_INCLUDE, where: { id: input.id } });
    if (!current) throw skuNotFound();
    if (current.product.deleted_at !== null || current.product.status === 'ARCHIVED') throw archivedConflict('Product');
    if (current.deleted_at !== null || current.status === 'ARCHIVED') throw archivedConflict('SKU');
    if (current.version !== input.expectedVersion) throw versionConflict('SKU');
    const result = await transaction.sku.updateMany({
      data: {
        ...(input.patch.isRecommended === undefined ? {} : { is_recommended: input.patch.isRecommended }),
        ...(input.patch.name === undefined ? {} : { name: input.patch.name }),
        ...(input.patch.retailPrice === undefined ? {} : { retail_price: input.patch.retailPrice }),
        ...(!('specification' in input.patch) ? {} : {
          spec_json: specificationData(input.patch.specification as SkuSpecification | null),
        }),
        updated_at: this.currentTime(),
        version: { increment: 1 },
      },
      where: { deleted_at: null, id: input.id, version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict('SKU');
    return this.readSku(transaction, input.id);
  }
}
