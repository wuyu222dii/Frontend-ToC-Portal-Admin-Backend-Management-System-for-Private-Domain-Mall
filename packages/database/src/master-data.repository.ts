import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { PrismaClient } from '../.generated/prisma/client';
import type { EntityStatus } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

export type MasterDataTargetType = 'BRAND' | 'CATEGORY';
export type MasterDataLifecycleAction = 'ACTIVATE' | 'DEACTIVATE' | 'SOFT_DELETE';

export interface BrandSnapshot {
  id: string;
  name: string;
  logoFileId: string | null;
  logoObjectKey: string | null;
  description: string | null;
  status: EntityStatus;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface CategorySnapshot {
  id: string;
  name: string;
  iconFileId: string | null;
  iconObjectKey: string | null;
  status: EntityStatus;
  sortOrder: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface MasterDataListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: EntityStatus;
}

export interface MasterDataListResult<T> {
  items: T[];
  total: number;
}

export interface CreateBrandInput {
  actorId: string;
  id: string;
  name: string;
  logoFileId: string | null;
  description: string | null;
  sortOrder: number;
}

export interface CreateCategoryInput {
  actorId: string;
  id: string;
  name: string;
  iconFileId: string | null;
  sortOrder: number;
}

export interface UpdateBrandPatch {
  name?: string;
  logoFileId?: string | null;
  description?: string | null;
  sortOrder?: number;
}

export interface UpdateCategoryPatch {
  name?: string;
  iconFileId?: string | null;
  sortOrder?: number;
}

export interface UpdateBrandInput {
  actorId: string;
  id: string;
  expectedVersion: number;
  patch: UpdateBrandPatch;
}

export interface UpdateCategoryInput {
  actorId: string;
  id: string;
  expectedVersion: number;
  patch: UpdateCategoryPatch;
}

export interface MasterDataLifecycleInput {
  targetType: MasterDataTargetType;
  targetId: string;
  expectedVersion: number;
  action: MasterDataLifecycleAction;
}

export interface MasterDataLifecyclePreviewInput {
  targetType: MasterDataTargetType;
  targetId: string;
  action: MasterDataLifecycleAction;
}

export interface MasterDataLifecycleImpact {
  activeProductCount: number;
  activeProductIds: string[];
  resource: {
    id: string;
    status: EntityStatus;
    version: number;
    deletedAt: Date | null;
  };
}

export type MasterDataLifecycleResult =
  | { targetType: 'BRAND'; resource: BrandSnapshot; impact: MasterDataLifecycleImpact }
  | { targetType: 'CATEGORY'; resource: CategorySnapshot; impact: MasterDataLifecycleImpact };

export interface RestoreMasterDataInput {
  id: string;
  expectedVersion: number;
}

export interface MasterDataHierarchyLockInput {
  brandIds?: readonly string[];
  categoryIds?: readonly string[];
  inventoryBalanceIds?: readonly string[];
  productIds?: readonly string[];
  skuIds?: readonly string[];
  reservationIds?: readonly string[];
}

type FileLink = {
  deleted_at: Date | null;
  id: string;
  object_key: string;
  purpose: string;
  status: string;
  visibility: string;
} | null;

type BrandRecord = {
  created_at: Date;
  deleted_at: Date | null;
  description: string | null;
  id: string;
  logo: FileLink;
  logo_file_id: string | null;
  name: string;
  sort_order: number;
  status: EntityStatus;
  updated_at: Date;
  version: number;
};

type CategoryRecord = {
  created_at: Date;
  deleted_at: Date | null;
  icon: FileLink;
  icon_file_id: string | null;
  id: string;
  name: string;
  sort_order: number;
  status: EntityStatus;
  updated_at: Date;
  version: number;
};

const ENTITY_STATUS = new Set<EntityStatus>(['ACTIVE', 'ARCHIVED', 'DRAFT', 'INACTIVE']);
const TARGET_TYPE = new Set<MasterDataTargetType>(['BRAND', 'CATEGORY']);
const LIFECYCLE_ACTION = new Set<MasterDataLifecycleAction>(['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE']);
const LIST_FIELDS = new Set(['keyword', 'page', 'pageSize', 'status']);
const CREATE_BRAND_FIELDS = new Set(['actorId', 'description', 'id', 'logoFileId', 'name', 'sortOrder']);
const CREATE_CATEGORY_FIELDS = new Set(['actorId', 'iconFileId', 'id', 'name', 'sortOrder']);
const UPDATE_INPUT_FIELDS = new Set(['actorId', 'expectedVersion', 'id', 'patch']);
const BRAND_PATCH_FIELDS = new Set(['description', 'logoFileId', 'name', 'sortOrder']);
const CATEGORY_PATCH_FIELDS = new Set(['iconFileId', 'name', 'sortOrder']);
const LIFECYCLE_FIELDS = new Set(['action', 'expectedVersion', 'targetId', 'targetType']);
const LIFECYCLE_PREVIEW_FIELDS = new Set(['action', 'targetId', 'targetType']);
const RESTORE_FIELDS = new Set(['expectedVersion', 'id']);
const HIERARCHY_FIELDS = new Set([
  'brandIds',
  'categoryIds',
  'inventoryBalanceIds',
  'productIds',
  'reservationIds',
  'skuIds',
]);
const FILE_SELECT = {
  deleted_at: true,
  id: true,
  object_key: true,
  purpose: true,
  status: true,
  visibility: true,
} as const;
const BRAND_INCLUDE = { logo: { select: FILE_SELECT } } as const;
const CATEGORY_INCLUDE = { icon: { select: FILE_SELECT } } as const;

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

function requireName(value: string): void {
  const length = typeof value === 'string' ? Array.from(value).length : 0;
  if (typeof value !== 'string' || length < 1 || length > 120 || value.trim().length === 0) {
    throw new TypeError('Master data name must contain 1 to 120 characters');
  }
}

function requireSortOrder(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new TypeError('Master data sort order must be a non-negative PostgreSQL INTEGER');
  }
}

function requireDescription(value: string | null): void {
  if (value !== null && (typeof value !== 'string' || Array.from(value).length > 500)) {
    throw new TypeError('Brand description must be null or contain at most 500 characters');
  }
}

function requireNullableFileId(value: string | null, label: string): void {
  if (value !== null) requireUlid(value, label);
}

function requireTargetType(value: string): asserts value is MasterDataTargetType {
  if (!TARGET_TYPE.has(value as MasterDataTargetType)) throw new TypeError('Master data target type is invalid');
}

function requireLifecycleAction(value: string): asserts value is MasterDataLifecycleAction {
  if (!LIFECYCLE_ACTION.has(value as MasterDataLifecycleAction)) {
    throw new TypeError('Master data lifecycle action is invalid');
  }
}

function fileObjectKey(file: FileLink, purpose: 'BRAND_LOGO' | 'CATEGORY_ICON'): string | null {
  if (!file || file.deleted_at !== null || file.status !== 'READY' || file.visibility !== 'PUBLIC' ||
    file.purpose !== purpose || file.object_key !== `public/${file.id}`) return null;
  return file.object_key;
}

function brandSnapshot(record: BrandRecord): BrandSnapshot {
  return {
    id: record.id,
    name: record.name,
    logoFileId: record.logo_file_id,
    logoObjectKey: fileObjectKey(record.logo, 'BRAND_LOGO'),
    description: record.description,
    status: record.status,
    sortOrder: record.sort_order,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    deletedAt: record.deleted_at,
  };
}

function categorySnapshot(record: CategoryRecord): CategorySnapshot {
  return {
    id: record.id,
    name: record.name,
    iconFileId: record.icon_file_id,
    iconObjectKey: fileObjectKey(record.icon, 'CATEGORY_ICON'),
    status: record.status,
    sortOrder: record.sort_order,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    deletedAt: record.deleted_at,
  };
}

function notFound(targetType: MasterDataTargetType): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', `${targetType} master data does not exist`);
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Master data version changed');
}

function validateListInput(input: MasterDataListInput): void {
  if (!hasOnlyFields(input, LIST_FIELDS)) throw new TypeError('Master data list query contains unsupported fields');
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw new TypeError('Page must be a positive integer');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Page size must be between 1 and 100');
  }
  if (input.keyword !== undefined &&
    (typeof input.keyword !== 'string' || Array.from(input.keyword).length < 1 || input.keyword.trim().length === 0)) {
    throw new TypeError('Master data keyword must not be blank');
  }
  if (input.status !== undefined && !ENTITY_STATUS.has(input.status)) {
    throw new TypeError('Master data status is invalid');
  }
}

function listWhere(input: MasterDataListInput): Record<string, unknown> {
  const lifecycle = input.status === 'ARCHIVED'
    ? { deleted_at: { not: null }, status: 'ARCHIVED' }
    : input.status === undefined
      ? { deleted_at: null, status: { not: 'ARCHIVED' } }
      : { deleted_at: null, status: input.status };
  return {
    ...lifecycle,
    ...(input.keyword === undefined ? {} : { name: { contains: input.keyword, mode: 'insensitive' } }),
  };
}

function validateCreateBrand(input: CreateBrandInput): void {
  requireExactFields(input, CREATE_BRAND_FIELDS, 'Brand create input');
  requireUlid(input.actorId, 'Brand actor ID');
  requireUlid(input.id, 'Brand ID');
  requireName(input.name);
  requireNullableFileId(input.logoFileId, 'Brand logo file ID');
  requireDescription(input.description);
  requireSortOrder(input.sortOrder);
}

function validateCreateCategory(input: CreateCategoryInput): void {
  requireExactFields(input, CREATE_CATEGORY_FIELDS, 'Category create input');
  requireUlid(input.actorId, 'Category actor ID');
  requireUlid(input.id, 'Category ID');
  requireName(input.name);
  requireNullableFileId(input.iconFileId, 'Category icon file ID');
  requireSortOrder(input.sortOrder);
}

function validateBrandPatch(patch: UpdateBrandPatch): void {
  if (!hasOnlyFields(patch, BRAND_PATCH_FIELDS) || Object.keys(patch).length < 1) {
    throw new TypeError('Brand patch must contain at least one supported field');
  }
  if (patch.name !== undefined) requireName(patch.name);
  if ('logoFileId' in patch) requireNullableFileId(patch.logoFileId as string | null, 'Brand logo file ID');
  if ('description' in patch) requireDescription(patch.description as string | null);
  if (patch.sortOrder !== undefined) requireSortOrder(patch.sortOrder);
}

function validateCategoryPatch(patch: UpdateCategoryPatch): void {
  if (!hasOnlyFields(patch, CATEGORY_PATCH_FIELDS) || Object.keys(patch).length < 1) {
    throw new TypeError('Category patch must contain at least one supported field');
  }
  if (patch.name !== undefined) requireName(patch.name);
  if ('iconFileId' in patch) requireNullableFileId(patch.iconFileId as string | null, 'Category icon file ID');
  if (patch.sortOrder !== undefined) requireSortOrder(patch.sortOrder);
}

function validateUpdateInput(input: UpdateBrandInput | UpdateCategoryInput): void {
  requireExactFields(input, UPDATE_INPUT_FIELDS, 'Master data update input');
  requireUlid(input.actorId, 'Master data actor ID');
  requireUlid(input.id, 'Master data ID');
  requireVersion(input.expectedVersion);
}

function validateLifecycleInput(input: MasterDataLifecycleInput): void {
  requireExactFields(input, LIFECYCLE_FIELDS, 'Master data lifecycle input');
  requireTargetType(input.targetType);
  requireUlid(input.targetId, 'Master data target ID');
  requireVersion(input.expectedVersion);
  requireLifecycleAction(input.action);
}

function validateLifecyclePreviewInput(input: MasterDataLifecyclePreviewInput): void {
  requireExactFields(input, LIFECYCLE_PREVIEW_FIELDS, 'Master data lifecycle preview input');
  requireTargetType(input.targetType);
  requireUlid(input.targetId, 'Master data target ID');
  requireLifecycleAction(input.action);
}

function validateRestoreInput(input: RestoreMasterDataInput): void {
  requireExactFields(input, RESTORE_FIELDS, 'Master data restore input');
  requireUlid(input.id, 'Master data ID');
  requireVersion(input.expectedVersion);
}

function assertTransition(
  status: EntityStatus,
  deletedAt: Date | null,
  action: MasterDataLifecycleAction,
): void {
  const allowed = deletedAt === null && (
    (action === 'ACTIVATE' && (status === 'DRAFT' || status === 'INACTIVE')) ||
    (action === 'DEACTIVATE' && status === 'ACTIVE') ||
    (action === 'SOFT_DELETE' && (status === 'DRAFT' || status === 'INACTIVE'))
  );
  if (!allowed) throw stateConflict('Master data lifecycle transition is not allowed');
}

function nextStatus(action: MasterDataLifecycleAction): EntityStatus {
  if (action === 'ACTIVATE') return 'ACTIVE';
  if (action === 'DEACTIVATE') return 'INACTIVE';
  return 'ARCHIVED';
}

function uniqueSortedIds(values: readonly string[] | undefined, label: string): string[] {
  if (values === undefined) return [];
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array`);
  values.forEach((value) => requireUlid(value, label));
  return [...new Set(values)].sort();
}

export async function acquireMasterDataHierarchyLocks(
  transaction: DatabaseTransaction,
  input: MasterDataHierarchyLockInput,
): Promise<void> {
  if (!hasOnlyFields(input, HIERARCHY_FIELDS)) {
    throw new TypeError('Master data hierarchy lock input contains unsupported fields');
  }
  const ordered = [
    ['master-data-brand', uniqueSortedIds(input.brandIds, 'Brand lock ID')],
    ['master-data-category', uniqueSortedIds(input.categoryIds, 'Category lock ID')],
    ['master-data-product', uniqueSortedIds(input.productIds, 'Product lock ID')],
    ['product-catalog-sku', uniqueSortedIds(input.skuIds, 'SKU lock ID')],
    ['inventory-balance', uniqueSortedIds(input.inventoryBalanceIds, 'Inventory balance lock ID')],
    ['inventory-reservation', uniqueSortedIds(input.reservationIds, 'Reservation lock ID')],
  ] as const;
  for (const [namespace, ids] of ordered) {
    for (const id of ids) await acquireTransactionLock(transaction, namespace, [id]);
  }
}

export class MasterDataRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Master data repository clock must return a valid Date');
    }
    return value;
  }

  async listBrands(input: MasterDataListInput): Promise<MasterDataListResult<BrandSnapshot>> {
    validateListInput(input);
    const where = listWhere(input);
    const [records, total] = await Promise.all([
      this.prisma.brand.findMany({
        include: BRAND_INCLUDE,
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.brand.count({ where }),
    ]);
    return { items: records.map((record) => brandSnapshot(record)), total };
  }

  async listCategories(input: MasterDataListInput): Promise<MasterDataListResult<CategorySnapshot>> {
    validateListInput(input);
    const where = listWhere(input);
    const [records, total] = await Promise.all([
      this.prisma.category.findMany({
        include: CATEGORY_INCLUDE,
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.category.count({ where }),
    ]);
    return { items: records.map((record) => categorySnapshot(record)), total };
  }

  async getBrand(id: string): Promise<BrandSnapshot> {
    requireUlid(id, 'Brand ID');
    const record = await this.prisma.brand.findUnique({ include: BRAND_INCLUDE, where: { id } });
    if (!record) throw notFound('BRAND');
    return brandSnapshot(record);
  }

  async getCategory(id: string): Promise<CategorySnapshot> {
    requireUlid(id, 'Category ID');
    const record = await this.prisma.category.findUnique({ include: CATEGORY_INCLUDE, where: { id } });
    if (!record) throw notFound('CATEGORY');
    return categorySnapshot(record);
  }

  private async assertAttachableFile(
    transaction: DatabaseTransaction,
    actorId: string,
    fileId: string,
    purpose: 'BRAND_LOGO' | 'CATEGORY_ICON',
  ): Promise<void> {
    const file = await transaction.fileAsset.findFirst({
      select: { id: true },
      where: {
        deleted_at: null,
        created_by_id: actorId,
        id: fileId,
        object_key: `public/${fileId}`,
        purpose,
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    if (!file) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Attachable file does not exist');
  }

  private async assertNameAvailable(
    transaction: DatabaseTransaction,
    targetType: MasterDataTargetType,
    name: string,
    currentId?: string,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'master-data-name', [targetType, name]);
    const record = targetType === 'BRAND'
      ? await transaction.brand.findUnique({ select: { deleted_at: true, id: true, status: true }, where: { name } })
      : await transaction.category.findUnique({ select: { deleted_at: true, id: true, status: true }, where: { name } });
    if (!record || record.id === currentId) return;
    if (record.deleted_at !== null || record.status === 'ARCHIVED') {
      throw new ApplicationError('SOFT_DELETED_KEY_RESERVED', 'Archived master data name is reserved');
    }
    throw stateConflict('Master data name already exists');
  }

  private async readBrand(transaction: DatabaseTransaction, id: string): Promise<BrandSnapshot> {
    const record = await transaction.brand.findUnique({ include: BRAND_INCLUDE, where: { id } });
    if (!record) throw notFound('BRAND');
    return brandSnapshot(record);
  }

  private async readCategory(transaction: DatabaseTransaction, id: string): Promise<CategorySnapshot> {
    const record = await transaction.category.findUnique({ include: CATEGORY_INCLUDE, where: { id } });
    if (!record) throw notFound('CATEGORY');
    return categorySnapshot(record);
  }

  async createBrandInTransaction(
    transaction: DatabaseTransaction,
    input: CreateBrandInput,
  ): Promise<BrandSnapshot> {
    validateCreateBrand(input);
    await this.assertNameAvailable(transaction, 'BRAND', input.name);
    if (input.logoFileId !== null) {
      await this.assertAttachableFile(transaction, input.actorId, input.logoFileId, 'BRAND_LOGO');
    }
    const now = this.currentTime();
    await transaction.brand.create({
      data: {
        created_at: now,
        deleted_at: null,
        description: input.description,
        id: input.id,
        logo_file_id: input.logoFileId,
        name: input.name,
        sort_order: input.sortOrder,
        status: 'DRAFT',
        updated_at: now,
        version: 1,
      },
    });
    return this.readBrand(transaction, input.id);
  }

  async createCategoryInTransaction(
    transaction: DatabaseTransaction,
    input: CreateCategoryInput,
  ): Promise<CategorySnapshot> {
    validateCreateCategory(input);
    await this.assertNameAvailable(transaction, 'CATEGORY', input.name);
    if (input.iconFileId !== null) {
      await this.assertAttachableFile(transaction, input.actorId, input.iconFileId, 'CATEGORY_ICON');
    }
    const now = this.currentTime();
    await transaction.category.create({
      data: {
        created_at: now,
        deleted_at: null,
        icon_file_id: input.iconFileId,
        id: input.id,
        name: input.name,
        sort_order: input.sortOrder,
        status: 'DRAFT',
        updated_at: now,
        version: 1,
      },
    });
    return this.readCategory(transaction, input.id);
  }

  async updateBrandInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateBrandInput,
  ): Promise<BrandSnapshot> {
    validateUpdateInput(input);
    validateBrandPatch(input.patch);
    await acquireMasterDataHierarchyLocks(transaction, { brandIds: [input.id] });
    const current = await this.readBrand(transaction, input.id);
    if (current.deletedAt !== null || current.status === 'ARCHIVED') throw stateConflict('Archived brand cannot be edited');
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (input.patch.name !== undefined) {
      await this.assertNameAvailable(transaction, 'BRAND', input.patch.name, input.id);
    }
    if (input.patch.logoFileId !== undefined && input.patch.logoFileId !== null) {
      await this.assertAttachableFile(transaction, input.actorId, input.patch.logoFileId, 'BRAND_LOGO');
    }
    const result = await transaction.brand.updateMany({
      data: {
        ...(input.patch.description === undefined ? {} : { description: input.patch.description }),
        ...(input.patch.logoFileId === undefined ? {} : { logo_file_id: input.patch.logoFileId }),
        ...(input.patch.name === undefined ? {} : { name: input.patch.name }),
        ...(input.patch.sortOrder === undefined ? {} : { sort_order: input.patch.sortOrder }),
        updated_at: this.currentTime(),
        version: { increment: 1 },
      },
      where: { deleted_at: null, id: input.id, version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readBrand(transaction, input.id);
  }

  async updateCategoryInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateCategoryInput,
  ): Promise<CategorySnapshot> {
    validateUpdateInput(input);
    validateCategoryPatch(input.patch);
    await acquireMasterDataHierarchyLocks(transaction, { categoryIds: [input.id] });
    const current = await this.readCategory(transaction, input.id);
    if (current.deletedAt !== null || current.status === 'ARCHIVED') {
      throw stateConflict('Archived category cannot be edited');
    }
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (input.patch.name !== undefined) {
      await this.assertNameAvailable(transaction, 'CATEGORY', input.patch.name, input.id);
    }
    if (input.patch.iconFileId !== undefined && input.patch.iconFileId !== null) {
      await this.assertAttachableFile(transaction, input.actorId, input.patch.iconFileId, 'CATEGORY_ICON');
    }
    const result = await transaction.category.updateMany({
      data: {
        ...(input.patch.iconFileId === undefined ? {} : { icon_file_id: input.patch.iconFileId }),
        ...(input.patch.name === undefined ? {} : { name: input.patch.name }),
        ...(input.patch.sortOrder === undefined ? {} : { sort_order: input.patch.sortOrder }),
        updated_at: this.currentTime(),
        version: { increment: 1 },
      },
      where: { deleted_at: null, id: input.id, version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readCategory(transaction, input.id);
  }

  private async lifecycleResource(
    transaction: DatabaseTransaction,
    targetType: MasterDataTargetType,
    targetId: string,
  ): Promise<MasterDataLifecycleImpact['resource']> {
    const record = targetType === 'BRAND'
      ? await transaction.brand.findUnique({
          select: { deleted_at: true, id: true, status: true, version: true },
          where: { id: targetId },
        })
      : await transaction.category.findUnique({
          select: { deleted_at: true, id: true, status: true, version: true },
          where: { id: targetId },
        });
    if (!record) throw notFound(targetType);
    return { id: record.id, status: record.status, version: record.version, deletedAt: record.deleted_at };
  }

  private async lifecycleImpactLocked(
    transaction: DatabaseTransaction,
    input: MasterDataLifecycleInput,
  ): Promise<MasterDataLifecycleImpact> {
    const resource = await this.lifecycleResource(transaction, input.targetType, input.targetId);
    if (resource.version !== input.expectedVersion) throw versionConflict();
    assertTransition(resource.status, resource.deletedAt, input.action);
    const products = await transaction.product.findMany({
      orderBy: { id: 'asc' },
      select: { id: true },
      where: {
        deleted_at: null,
        status: 'ACTIVE',
        ...(input.targetType === 'BRAND' ? { brand_id: input.targetId } : { category_id: input.targetId }),
      },
    });
    const activeProductIds = products.map(({ id }) => id);
    await acquireMasterDataHierarchyLocks(transaction, { productIds: activeProductIds });
    return { activeProductCount: activeProductIds.length, activeProductIds, resource };
  }

  async getLifecyclePreviewImpactInTransaction(
    transaction: DatabaseTransaction,
    input: MasterDataLifecyclePreviewInput,
  ): Promise<MasterDataLifecycleImpact> {
    validateLifecyclePreviewInput(input);
    await acquireMasterDataHierarchyLocks(transaction, input.targetType === 'BRAND'
      ? { brandIds: [input.targetId] }
      : { categoryIds: [input.targetId] });
    const resource = await this.lifecycleResource(transaction, input.targetType, input.targetId);
    return this.lifecycleImpactLocked(transaction, { ...input, expectedVersion: resource.version });
  }

  async getLifecycleImpactInTransaction(
    transaction: DatabaseTransaction,
    input: MasterDataLifecycleInput,
  ): Promise<MasterDataLifecycleImpact> {
    validateLifecycleInput(input);
    await acquireMasterDataHierarchyLocks(transaction, input.targetType === 'BRAND'
      ? { brandIds: [input.targetId] }
      : { categoryIds: [input.targetId] });
    return this.lifecycleImpactLocked(transaction, input);
  }

  async applyLifecycleInTransaction(
    transaction: DatabaseTransaction,
    input: MasterDataLifecycleInput,
  ): Promise<MasterDataLifecycleResult> {
    const impact = await this.getLifecycleImpactInTransaction(transaction, input);
    if (input.action !== 'ACTIVATE' && impact.activeProductCount > 0) {
      throw new ApplicationError('ACTIVE_PRODUCT_DEPENDENCY', 'Active product dependency blocks lifecycle change');
    }
    const now = this.currentTime();
    const data = {
      deleted_at: input.action === 'SOFT_DELETE' ? now : null,
      status: nextStatus(input.action),
      updated_at: now,
      version: { increment: 1 as const },
    };
    const where = { deleted_at: null, id: input.targetId, version: input.expectedVersion };
    const result = input.targetType === 'BRAND'
      ? await transaction.brand.updateMany({ data, where })
      : await transaction.category.updateMany({ data, where });
    if (result.count !== 1) throw versionConflict();
    if (input.targetType === 'BRAND') {
      return { impact, resource: await this.readBrand(transaction, input.targetId), targetType: 'BRAND' };
    }
    return { impact, resource: await this.readCategory(transaction, input.targetId), targetType: 'CATEGORY' };
  }

  async restoreBrandInTransaction(
    transaction: DatabaseTransaction,
    input: RestoreMasterDataInput,
  ): Promise<BrandSnapshot> {
    validateRestoreInput(input);
    await acquireMasterDataHierarchyLocks(transaction, { brandIds: [input.id] });
    const current = await this.readBrand(transaction, input.id);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.status !== 'ARCHIVED' || current.deletedAt === null) {
      throw stateConflict('Only a soft-deleted brand can be restored');
    }
    const result = await transaction.brand.updateMany({
      data: { deleted_at: null, status: 'DRAFT', updated_at: this.currentTime(), version: { increment: 1 } },
      where: { deleted_at: { not: null }, id: input.id, status: 'ARCHIVED', version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readBrand(transaction, input.id);
  }

  async restoreCategoryInTransaction(
    transaction: DatabaseTransaction,
    input: RestoreMasterDataInput,
  ): Promise<CategorySnapshot> {
    validateRestoreInput(input);
    await acquireMasterDataHierarchyLocks(transaction, { categoryIds: [input.id] });
    const current = await this.readCategory(transaction, input.id);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.status !== 'ARCHIVED' || current.deletedAt === null) {
      throw stateConflict('Only a soft-deleted category can be restored');
    }
    const result = await transaction.category.updateMany({
      data: { deleted_at: null, status: 'DRAFT', updated_at: this.currentTime(), version: { increment: 1 } },
      where: { deleted_at: { not: null }, id: input.id, status: 'ARCHIVED', version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readCategory(transaction, input.id);
  }
}
