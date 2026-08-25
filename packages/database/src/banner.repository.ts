import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { PrismaClient } from '../.generated/prisma/client';
import type { BannerTargetType, EntityStatus } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';
import { acquireMasterDataHierarchyLocks } from './master-data.repository';

export type BannerTargetInput =
  | { targetType: 'NONE'; targetId: null; targetUrl: null }
  | { targetType: 'PRODUCT' | 'CATEGORY'; targetId: string; targetUrl: null }
  | { targetType: 'URL'; targetId: null; targetUrl: string };

export interface BannerSnapshot {
  id: string;
  fileId: string;
  fileObjectKey: string;
  title: string;
  targetType: BannerTargetType;
  targetId: string | null;
  targetUrl: string | null;
  status: EntityStatus;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface BannerListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  status?: EntityStatus;
}

export interface BannerListResult {
  items: BannerSnapshot[];
  total: number;
}

export interface CreateBannerInput {
  actorId: string;
  id: string;
  fileId: string;
  title: string;
  target: BannerTargetInput;
  sortOrder: number;
  startsAt: Date | null;
  endsAt: Date | null;
}

export interface UpdateBannerPatch {
  fileId?: string;
  title?: string;
  target?: BannerTargetInput;
  sortOrder?: number;
  startsAt?: Date | null;
  endsAt?: Date | null;
}

export interface UpdateBannerInput {
  actorId: string;
  id: string;
  expectedVersion: number;
  patch: UpdateBannerPatch;
}

export type BannerStatusAction = 'ACTIVATE' | 'DEACTIVATE';

export interface ChangeBannerStatusInput {
  id: string;
  expectedVersion: number;
  action: BannerStatusAction;
}

export interface VersionedBannerInput {
  id: string;
  expectedVersion: number;
}

type BannerFileRecord = {
  deleted_at: Date | null;
  id: string;
  object_key: string;
  purpose: string;
  status: string;
  visibility: string;
};

type BannerRecord = {
  created_at: Date;
  deleted_at: Date | null;
  ends_at: Date | null;
  file: BannerFileRecord;
  file_id: string;
  id: string;
  sort_order: number;
  starts_at: Date | null;
  status: EntityStatus;
  target_id: string | null;
  target_type: BannerTargetType;
  target_url: string | null;
  title: string;
  updated_at: Date;
  version: number;
};

const ENTITY_STATUS = new Set<EntityStatus>(['ACTIVE', 'ARCHIVED', 'DRAFT', 'INACTIVE']);
const STATUS_ACTION = new Set<BannerStatusAction>(['ACTIVATE', 'DEACTIVATE']);
const LIST_FIELDS = new Set(['keyword', 'page', 'pageSize', 'status']);
const CREATE_FIELDS = new Set([
  'actorId',
  'endsAt',
  'fileId',
  'id',
  'sortOrder',
  'startsAt',
  'target',
  'title',
]);
const UPDATE_FIELDS = new Set(['actorId', 'expectedVersion', 'id', 'patch']);
const PATCH_FIELDS = new Set(['endsAt', 'fileId', 'sortOrder', 'startsAt', 'target', 'title']);
const TARGET_FIELDS = new Set(['targetId', 'targetType', 'targetUrl']);
const STATUS_FIELDS = new Set(['action', 'expectedVersion', 'id']);
const VERSIONED_FIELDS = new Set(['expectedVersion', 'id']);
const FILE_SELECT = {
  deleted_at: true,
  id: true,
  object_key: true,
  purpose: true,
  status: true,
  visibility: true,
} as const;
const BANNER_INCLUDE = { file: { select: FILE_SELECT } } as const;

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
    throw new TypeError('Expected Banner version must be a positive PostgreSQL INTEGER');
  }
}

function requireSortOrder(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new TypeError('Banner sort order must be a non-negative PostgreSQL INTEGER');
  }
}

function requireTitle(value: string): void {
  const length = typeof value === 'string' ? Array.from(value).length : 0;
  if (typeof value !== 'string' || value.trim().length === 0 || length < 1 || length > 160) {
    throw new TypeError('Banner title must contain 1 to 160 characters');
  }
}

function requireNullableDate(value: Date | null, label: string): void {
  if (value !== null && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
    throw new TypeError(`${label} must be null or a valid Date`);
  }
}

function requireTimeWindow(startsAt: Date | null, endsAt: Date | null): void {
  requireNullableDate(startsAt, 'Banner start time');
  requireNullableDate(endsAt, 'Banner end time');
  if (startsAt !== null && endsAt !== null && endsAt.getTime() <= startsAt.getTime()) {
    throw new TypeError('Banner end time must be later than its start time');
  }
}

function parseHttpsUrl(value: string): URL | null {
  if (typeof value !== 'string' || Array.from(value).length < 1 || Array.from(value).length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url : null;
  } catch {
    return null;
  }
}

function normalizeAllowedOrigins(values: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(values)) throw new TypeError('Banner URL origin allowlist must be an array');
  const origins = new Set<string>();
  for (const value of values) {
    const url = parseHttpsUrl(value);
    if (!url || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new TypeError('Banner URL allowlist entries must be HTTPS origins');
    }
    origins.add(url.origin);
  }
  return origins;
}

function requireTarget(value: BannerTargetInput): void {
  requireExactFields(value, TARGET_FIELDS, 'Banner target');
  const target = value as unknown as Record<string, unknown>;
  if (target.targetType === 'NONE') {
    if (target.targetId !== null || target.targetUrl !== null) throw new TypeError('NONE Banner target is invalid');
    return;
  }
  if (target.targetType === 'PRODUCT' || target.targetType === 'CATEGORY') {
    if (target.targetUrl !== null || typeof target.targetId !== 'string') {
      throw new TypeError(`${target.targetType} Banner target is invalid`);
    }
    requireUlid(target.targetId, 'Banner target ID');
    return;
  }
  if (target.targetType !== 'URL' || target.targetId !== null ||
    typeof target.targetUrl !== 'string' || parseHttpsUrl(target.targetUrl) === null) {
    throw new TypeError('URL Banner target is invalid');
  }
}

function validateListInput(input: BannerListInput): void {
  if (!hasOnlyFields(input, LIST_FIELDS)) throw new TypeError('Banner list query contains unsupported fields');
  if (!Number.isSafeInteger(input.page) || input.page < 1) throw new TypeError('Page must be a positive integer');
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Page size must be between 1 and 100');
  }
  if (input.keyword !== undefined &&
    (typeof input.keyword !== 'string' || input.keyword.trim().length === 0)) {
    throw new TypeError('Banner keyword must not be blank');
  }
  if (input.status !== undefined && !ENTITY_STATUS.has(input.status)) {
    throw new TypeError('Banner status is invalid');
  }
}

function validateCreateInput(input: CreateBannerInput): void {
  requireExactFields(input, CREATE_FIELDS, 'Banner create input');
  requireUlid(input.actorId, 'Banner actor ID');
  requireUlid(input.id, 'Banner ID');
  requireUlid(input.fileId, 'Banner file ID');
  requireTitle(input.title);
  requireTarget(input.target);
  requireSortOrder(input.sortOrder);
  requireTimeWindow(input.startsAt, input.endsAt);
}

function validatePatch(patch: UpdateBannerPatch): void {
  if (!hasOnlyFields(patch, PATCH_FIELDS) || Object.keys(patch).length < 1) {
    throw new TypeError('Banner patch must contain at least one supported field');
  }
  if (patch.fileId !== undefined) requireUlid(patch.fileId, 'Banner file ID');
  if (patch.title !== undefined) requireTitle(patch.title);
  if (patch.target !== undefined) requireTarget(patch.target);
  if (patch.sortOrder !== undefined) requireSortOrder(patch.sortOrder);
  if ('startsAt' in patch) requireNullableDate(patch.startsAt as Date | null, 'Banner start time');
  if ('endsAt' in patch) requireNullableDate(patch.endsAt as Date | null, 'Banner end time');
}

function validateUpdateInput(input: UpdateBannerInput): void {
  requireExactFields(input, UPDATE_FIELDS, 'Banner update input');
  requireUlid(input.actorId, 'Banner actor ID');
  requireUlid(input.id, 'Banner ID');
  requireVersion(input.expectedVersion);
  validatePatch(input.patch);
}

function validateStatusInput(input: ChangeBannerStatusInput): void {
  requireExactFields(input, STATUS_FIELDS, 'Banner status input');
  requireUlid(input.id, 'Banner ID');
  requireVersion(input.expectedVersion);
  if (!STATUS_ACTION.has(input.action)) throw new TypeError('Banner status action is invalid');
}

function validateVersionedInput(input: VersionedBannerInput): void {
  requireExactFields(input, VERSIONED_FIELDS, 'Versioned Banner input');
  requireUlid(input.id, 'Banner ID');
  requireVersion(input.expectedVersion);
}

function listWhere(input: BannerListInput): Record<string, unknown> {
  const lifecycle = input.status === 'ARCHIVED'
    ? { deleted_at: { not: null }, status: 'ARCHIVED' }
    : input.status === undefined
      ? { deleted_at: null, status: { not: 'ARCHIVED' } }
      : { deleted_at: null, status: input.status };
  return {
    ...lifecycle,
    ...(input.keyword === undefined ? {} : { title: { contains: input.keyword, mode: 'insensitive' } }),
  };
}

function bannerSnapshot(record: BannerRecord): BannerSnapshot {
  return {
    id: record.id,
    fileId: record.file_id,
    fileObjectKey: record.file.object_key,
    title: record.title,
    targetType: record.target_type,
    targetId: record.target_id,
    targetUrl: record.target_url,
    status: record.status,
    sortOrder: record.sort_order,
    startsAt: record.starts_at,
    endsAt: record.ends_at,
    version: record.version,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    deletedAt: record.deleted_at,
  };
}

function targetFromSnapshot(snapshot: BannerSnapshot): BannerTargetInput {
  if (snapshot.targetType === 'NONE') return { targetId: null, targetType: 'NONE', targetUrl: null };
  if (snapshot.targetType === 'PRODUCT' || snapshot.targetType === 'CATEGORY') {
    if (snapshot.targetId === null || snapshot.targetUrl !== null) {
      throw new ApplicationError('INTERNAL_ERROR', 'Stored Banner target is invalid');
    }
    return { targetId: snapshot.targetId, targetType: snapshot.targetType, targetUrl: null };
  }
  if (snapshot.targetId !== null || snapshot.targetUrl === null) {
    throw new ApplicationError('INTERNAL_ERROR', 'Stored Banner target is invalid');
  }
  return { targetId: null, targetType: 'URL', targetUrl: snapshot.targetUrl };
}

function isPublishableFile(record: BannerRecord): boolean {
  return record.file.id === record.file_id && record.file.deleted_at === null &&
    record.file.object_key === `public/${record.file_id}` && record.file.purpose === 'BANNER' &&
    record.file.status === 'READY' && record.file.visibility === 'PUBLIC';
}

function isWithinWindow(record: BannerRecord, now: Date): boolean {
  return (record.starts_at === null || record.starts_at.getTime() <= now.getTime()) &&
    (record.ends_at === null || now.getTime() < record.ends_at.getTime());
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Banner does not exist');
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Banner version changed');
}

export class BannerRepository {
  private readonly allowedUrlOrigins: ReadonlySet<string>;

  constructor(
    private readonly prisma: PrismaClient,
    allowedUrlOrigins: readonly string[],
    private readonly now: () => Date = () => new Date(),
  ) {
    this.allowedUrlOrigins = normalizeAllowedOrigins(allowedUrlOrigins);
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Banner repository clock must return a valid Date');
    }
    return value;
  }

  private isAllowedTargetUrl(value: string): boolean {
    const url = parseHttpsUrl(value);
    return url !== null && this.allowedUrlOrigins.has(url.origin);
  }

  private async readBanner(transaction: DatabaseTransaction, id: string): Promise<BannerSnapshot> {
    const record = await transaction.banner.findUnique({ include: BANNER_INCLUDE, where: { id } });
    if (!record) throw notFound();
    return bannerSnapshot(record);
  }

  private async assertAttachableFile(
    transaction: DatabaseTransaction,
    actorId: string,
    fileId: string,
  ): Promise<void> {
    const file = await transaction.fileAsset.findFirst({
      select: { id: true },
      where: {
        created_by_id: actorId,
        deleted_at: null,
        id: fileId,
        object_key: `public/${fileId}`,
        purpose: 'BANNER',
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    if (!file) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Attachable Banner file does not exist');
  }

  private async assertPublishableFile(transaction: DatabaseTransaction, fileId: string): Promise<void> {
    const file = await transaction.fileAsset.findFirst({
      select: { id: true },
      where: {
        deleted_at: null,
        id: fileId,
        object_key: `public/${fileId}`,
        purpose: 'BANNER',
        status: 'READY',
        visibility: 'PUBLIC',
      },
    });
    if (!file) throw stateConflict('Banner publication requires a ready public Banner file');
  }

  private async acquireTargetLocks(
    transaction: DatabaseTransaction,
    targets: readonly BannerTargetInput[],
  ): Promise<void> {
    const categoryIds = targets.flatMap((target) =>
      target.targetType === 'CATEGORY' ? [target.targetId] : []);
    const productIds = targets.flatMap((target) =>
      target.targetType === 'PRODUCT' ? [target.targetId] : []);
    await acquireMasterDataHierarchyLocks(transaction, { categoryIds, productIds });
  }

  private async acquireFileLocks(transaction: DatabaseTransaction, fileIds: readonly string[]): Promise<void> {
    for (const fileId of [...new Set(fileIds)].sort()) {
      await acquireTransactionLock(transaction, 'file-asset', [fileId]);
    }
  }

  private async assertActiveTarget(transaction: DatabaseTransaction, target: BannerTargetInput): Promise<void> {
    if (target.targetType === 'NONE') return;
    if (target.targetType === 'URL') {
      if (!this.isAllowedTargetUrl(target.targetUrl)) {
        throw stateConflict('Banner URL origin is not allowed');
      }
      return;
    }
    if (target.targetType === 'PRODUCT') {
      const product = await transaction.product.findUnique({
        select: { deleted_at: true, id: true, status: true },
        where: { id: target.targetId },
      });
      if (!product) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Banner product target does not exist');
      if (product.deleted_at !== null || product.status !== 'ACTIVE') {
        throw stateConflict('Banner product target must be active');
      }
      return;
    }
    const category = await transaction.category.findUnique({
      select: { deleted_at: true, id: true, status: true },
      where: { id: target.targetId },
    });
    if (!category) throw new ApplicationError('RESOURCE_NOT_FOUND', 'Banner category target does not exist');
    if (category.deleted_at !== null || category.status !== 'ACTIVE') {
      throw stateConflict('Banner category target must be active');
    }
  }

  async listBanners(input: BannerListInput): Promise<BannerListResult> {
    validateListInput(input);
    const where = listWhere(input);
    const [records, total] = await Promise.all([
      this.prisma.banner.findMany({
        include: BANNER_INCLUDE,
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        where,
      }),
      this.prisma.banner.count({ where }),
    ]);
    return { items: records.map((record) => bannerSnapshot(record)), total };
  }

  private async listPublicEffectiveBannersInTransaction(
    transaction: DatabaseTransaction,
    now: Date,
  ): Promise<BannerSnapshot[]> {
    const records = await transaction.banner.findMany({
      include: BANNER_INCLUDE,
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      where: {
        AND: [
          { OR: [{ starts_at: null }, { starts_at: { lte: now } }] },
          { OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
        ],
        deleted_at: null,
        status: 'ACTIVE',
      },
    });
    const productIds = [...new Set(records
      .filter(({ target_type }) => target_type === 'PRODUCT')
      .map(({ target_id }) => target_id)
      .filter((id): id is string => id !== null))];
    const categoryIds = [...new Set(records
      .filter(({ target_type }) => target_type === 'CATEGORY')
      .map(({ target_id }) => target_id)
      .filter((id): id is string => id !== null))];
    const [products, categories] = await Promise.all([
      transaction.product.findMany({
        select: { id: true },
        where: { deleted_at: null, id: { in: productIds }, status: 'ACTIVE' },
      }),
      transaction.category.findMany({
        select: { id: true },
        where: { deleted_at: null, id: { in: categoryIds }, status: 'ACTIVE' },
      }),
    ]);
    const activeProductIds = new Set(products.map(({ id }) => id));
    const activeCategoryIds = new Set(categories.map(({ id }) => id));
    return records.filter((record) => {
      if (record.deleted_at !== null || record.status !== 'ACTIVE' || !isWithinWindow(record, now) ||
        !isPublishableFile(record)) return false;
      if (record.target_type === 'NONE') return record.target_id === null && record.target_url === null;
      if (record.target_type === 'PRODUCT') {
        return record.target_id !== null && record.target_url === null && activeProductIds.has(record.target_id);
      }
      if (record.target_type === 'CATEGORY') {
        return record.target_id !== null && record.target_url === null && activeCategoryIds.has(record.target_id);
      }
      return record.target_id === null && record.target_url !== null && this.isAllowedTargetUrl(record.target_url);
    }).map((record) => bannerSnapshot(record));
  }

  async listPublicEffectiveBanners(): Promise<BannerSnapshot[]> {
    const now = this.currentTime();
    return this.prisma.$transaction(
      (transaction) => this.listPublicEffectiveBannersInTransaction(transaction, now),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getBanner(id: string): Promise<BannerSnapshot> {
    requireUlid(id, 'Banner ID');
    const record = await this.prisma.banner.findUnique({ include: BANNER_INCLUDE, where: { id } });
    if (!record) throw notFound();
    return bannerSnapshot(record);
  }

  async createBannerInTransaction(
    transaction: DatabaseTransaction,
    input: CreateBannerInput,
  ): Promise<BannerSnapshot> {
    validateCreateInput(input);
    await acquireTransactionLock(transaction, 'banner', [input.id]);
    await this.acquireTargetLocks(transaction, [input.target]);
    await this.assertActiveTarget(transaction, input.target);
    await this.acquireFileLocks(transaction, [input.fileId]);
    await this.assertAttachableFile(transaction, input.actorId, input.fileId);
    const now = this.currentTime();
    await transaction.banner.create({
      data: {
        created_at: now,
        deleted_at: null,
        ends_at: input.endsAt,
        file_id: input.fileId,
        id: input.id,
        sort_order: input.sortOrder,
        starts_at: input.startsAt,
        status: 'DRAFT',
        target_id: input.target.targetId,
        target_type: input.target.targetType,
        target_url: input.target.targetUrl,
        title: input.title,
        updated_at: now,
        version: 1,
      },
    });
    return this.readBanner(transaction, input.id);
  }

  async updateBannerInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateBannerInput,
  ): Promise<BannerSnapshot> {
    validateUpdateInput(input);
    await acquireTransactionLock(transaction, 'banner', [input.id]);
    const initial = await this.readBanner(transaction, input.id);
    const initialTarget = targetFromSnapshot(initial);
    const target = input.patch.target ?? initialTarget;
    const fileId = input.patch.fileId ?? initial.fileId;
    await this.acquireTargetLocks(transaction, [initialTarget, target]);
    await this.acquireFileLocks(transaction, [initial.fileId, fileId]);
    const current = await this.readBanner(transaction, input.id);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.deletedAt !== null || current.status === 'ARCHIVED') {
      throw stateConflict('Archived Banner cannot be edited');
    }
    const startsAt = 'startsAt' in input.patch ? input.patch.startsAt as Date | null : current.startsAt;
    const endsAt = 'endsAt' in input.patch ? input.patch.endsAt as Date | null : current.endsAt;
    requireTimeWindow(startsAt, endsAt);
    if (input.patch.target !== undefined || current.status === 'ACTIVE') {
      await this.assertActiveTarget(transaction, target);
    }
    if (input.patch.fileId !== undefined) {
      await this.assertAttachableFile(transaction, input.actorId, input.patch.fileId);
    }
    if (current.status === 'ACTIVE') {
      await this.assertPublishableFile(transaction, fileId);
    }
    const result = await transaction.banner.updateMany({
      data: {
        ...(input.patch.fileId === undefined ? {} : { file_id: input.patch.fileId }),
        ...(input.patch.title === undefined ? {} : { title: input.patch.title }),
        ...(input.patch.sortOrder === undefined ? {} : { sort_order: input.patch.sortOrder }),
        ...(!('startsAt' in input.patch) ? {} : { starts_at: input.patch.startsAt }),
        ...(!('endsAt' in input.patch) ? {} : { ends_at: input.patch.endsAt }),
        ...(input.patch.target === undefined ? {} : {
          target_id: input.patch.target.targetId,
          target_type: input.patch.target.targetType,
          target_url: input.patch.target.targetUrl,
        }),
        updated_at: this.currentTime(),
        version: { increment: 1 },
      },
      where: { deleted_at: null, id: input.id, version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readBanner(transaction, input.id);
  }

  async changeBannerStatusInTransaction(
    transaction: DatabaseTransaction,
    input: ChangeBannerStatusInput,
  ): Promise<BannerSnapshot> {
    validateStatusInput(input);
    await acquireTransactionLock(transaction, 'banner', [input.id]);
    const initial = await this.readBanner(transaction, input.id);
    if (input.action === 'ACTIVATE') {
      await this.acquireTargetLocks(transaction, [targetFromSnapshot(initial)]);
      await this.acquireFileLocks(transaction, [initial.fileId]);
    }
    const current = await this.readBanner(transaction, input.id);
    if (current.version !== input.expectedVersion) throw versionConflict();
    const allowed = current.deletedAt === null && (
      (input.action === 'ACTIVATE' && (current.status === 'DRAFT' || current.status === 'INACTIVE')) ||
      (input.action === 'DEACTIVATE' && current.status === 'ACTIVE')
    );
    if (!allowed) throw stateConflict('Banner status transition is not allowed');
    if (input.action === 'ACTIVATE') {
      await this.assertPublishableFile(transaction, current.fileId);
      await this.assertActiveTarget(transaction, targetFromSnapshot(current));
    }
    const nextStatus = input.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE';
    const result = await transaction.banner.updateMany({
      data: { status: nextStatus, updated_at: this.currentTime(), version: { increment: 1 } },
      where: {
        deleted_at: null,
        id: input.id,
        status: current.status,
        version: input.expectedVersion,
      },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readBanner(transaction, input.id);
  }

  async archiveBannerInTransaction(
    transaction: DatabaseTransaction,
    input: VersionedBannerInput,
  ): Promise<BannerSnapshot> {
    validateVersionedInput(input);
    await acquireTransactionLock(transaction, 'banner', [input.id]);
    const current = await this.readBanner(transaction, input.id);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.deletedAt !== null || (current.status !== 'DRAFT' && current.status !== 'INACTIVE')) {
      throw stateConflict('Only a draft or inactive Banner can be archived');
    }
    const now = this.currentTime();
    const result = await transaction.banner.updateMany({
      data: { deleted_at: now, status: 'ARCHIVED', updated_at: now, version: { increment: 1 } },
      where: {
        deleted_at: null,
        id: input.id,
        status: current.status,
        version: input.expectedVersion,
      },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readBanner(transaction, input.id);
  }

  async restoreBannerInTransaction(
    transaction: DatabaseTransaction,
    input: VersionedBannerInput,
  ): Promise<BannerSnapshot> {
    validateVersionedInput(input);
    await acquireTransactionLock(transaction, 'banner', [input.id]);
    const current = await this.readBanner(transaction, input.id);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.status !== 'ARCHIVED' || current.deletedAt === null) {
      throw stateConflict('Only an archived Banner can be restored');
    }
    const result = await transaction.banner.updateMany({
      data: { deleted_at: null, status: 'DRAFT', updated_at: this.currentTime(), version: { increment: 1 } },
      where: { deleted_at: { not: null }, id: input.id, status: 'ARCHIVED', version: input.expectedVersion },
    });
    if (result.count !== 1) throw versionConflict();
    return this.readBanner(transaction, input.id);
  }
}
