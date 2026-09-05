import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { FilePurpose, FileStatus, FileVisibility } from '../.generated/prisma/enums';
import type { DatabaseTransaction } from './idempotency.repository';
import { acquireTransactionLock } from './advisory-lock';

export const FILE_ASSET_MAX_BYTES = 5n * 1_024n * 1_024n;
export const FILE_ASSET_PENDING_TTL_MS = 24 * 60 * 60 * 1_000;
export const FILE_ASSET_READY_ORPHAN_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const FILE_STAGING_CLEANUP_EVENT_TYPE = 'file.staging_cleanup_requested';

export type FileAssetMimeType = 'image/jpeg' | 'image/png';
export type SupportedFilePurpose = FilePurpose;

export interface FileAssetSnapshot {
  id: string;
  objectKey: string;
  originalName: string;
  mimeType: FileAssetMimeType;
  byteSize: bigint;
  sha256: string;
  visibility: FileVisibility;
  status: FileStatus;
  purpose: SupportedFilePurpose;
  createdById: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface CreatePendingFileAssetInput {
  id: string;
  actorId: string;
  originalName: string;
  mimeType: FileAssetMimeType;
  byteSize: bigint;
  sha256: string;
  purpose: SupportedFilePurpose;
}

export interface OwnedFileAssetInput {
  fileId: string;
  actorId: string;
}

export interface AdminDownloadableFileInput {
  actorId: string;
  fileId: string;
}

export interface MarkFileAssetReadyInput extends OwnedFileAssetInput {
  expectedSha256: string;
  expectedByteSize: bigint;
  measuredSha256: string;
  measuredByteSize: bigint;
  measuredMimeType: FileAssetMimeType;
}

export interface MarkFileAssetReadyResult {
  asset: FileAssetSnapshot;
  completedAt: Date;
}

export interface FileCleanupCandidate {
  id: string;
  objectKey: string;
  finalObjectKey: string;
  purpose: SupportedFilePurpose;
  createdAt: Date;
}

export interface ListFileCleanupCandidatesInput {
  olderThan: Date;
  limit: number;
}

export interface RecheckFileCleanupCandidateInput {
  fileId: string;
  expectedObjectKey: string;
  olderThan: Date;
}

export interface RecheckReadyFileStagingCleanupInput {
  fileId: string;
}

export interface ReadyFileStagingCleanup {
  fileId: string;
  stagingObjectKey: string;
}

export interface ReadyFileOrphanCleanupCandidate {
  id: string;
  objectKey: string;
  purpose: SupportedFilePurpose;
  readyAt: Date;
  stagingObjectKey: string;
  status: 'READY' | 'REJECTED';
}

export interface ReadyFileOrphanCleanupInput {
  fileId: string;
  expectedObjectKey: string;
  olderThan: Date;
}

export type ReadyFileOrphanCleanupPreparation = 'RESUME' | 'TRANSITIONED';

const FILE_PURPOSE = new Set<SupportedFilePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
  'AFTERSALE_EVIDENCE',
  'WITHDRAWAL_PROOF',
  'PROMOTION_QR',
]);
const PUBLIC_PURPOSE = new Set<SupportedFilePurpose>([
  'PRODUCT_IMAGE',
  'BRAND_LOGO',
  'CATEGORY_ICON',
  'BANNER',
]);
const MIME_TYPE = new Set<FileAssetMimeType>(['image/jpeg', 'image/png']);
const CREATE_FIELDS = new Set([
  'actorId',
  'byteSize',
  'id',
  'mimeType',
  'originalName',
  'purpose',
  'sha256',
]);
const OWNED_FIELDS = new Set(['actorId', 'fileId']);
const ADMIN_DOWNLOADABLE_FIELDS = new Set(['actorId', 'fileId']);
const MARK_READY_FIELDS = new Set([
  'actorId',
  'expectedByteSize',
  'expectedSha256',
  'fileId',
  'measuredByteSize',
  'measuredMimeType',
  'measuredSha256',
]);
const LIST_CANDIDATE_FIELDS = new Set(['limit', 'olderThan']);
const RECHECK_CANDIDATE_FIELDS = new Set(['expectedObjectKey', 'fileId', 'olderThan']);
const RECHECK_READY_STAGING_FIELDS = new Set(['fileId']);
const READY_ORPHAN_INPUT_FIELDS = new Set(['expectedObjectKey', 'fileId', 'olderThan']);
const SHA256 = /^[a-f0-9]{64}$/;

function isExactPlainObject(value: unknown, fields: ReadonlySet<string>): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  if (Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  return keys.length === fields.size && keys.every((key) => fields.has(key));
}

function requireDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${label} must be a valid Date`);
  }
}

function requireFileId(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireHash(value: string, label: string): void {
  if (!SHA256.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
}

function requireByteSize(value: bigint, label: string): void {
  if (typeof value !== 'bigint' || value < 1n || value > FILE_ASSET_MAX_BYTES) {
    throw new TypeError(`${label} must be between 1 and ${FILE_ASSET_MAX_BYTES.toString()} bytes`);
  }
}

function requireMimeType(value: string): asserts value is FileAssetMimeType {
  if (!MIME_TYPE.has(value as FileAssetMimeType)) throw new TypeError('File MIME type is not supported');
}

function requirePurpose(value: string): asserts value is SupportedFilePurpose {
  if (!FILE_PURPOSE.has(value as SupportedFilePurpose)) throw new TypeError('File purpose is not supported');
}

function hasControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

function validateCreateInput(input: CreatePendingFileAssetInput): void {
  if (!isExactPlainObject(input, CREATE_FIELDS)) throw new TypeError('File intent input contains unsupported fields');
  requireFileId(input.id, 'File ID');
  requireFileId(input.actorId, 'File actor ID');
  if (typeof input.originalName !== 'string' || input.originalName.length < 1 || input.originalName.length > 255 ||
    input.originalName.trim().length === 0 || hasControlCharacter(input.originalName)) {
    throw new TypeError('Original file name is invalid');
  }
  requireMimeType(input.mimeType);
  requireByteSize(input.byteSize, 'File byte size');
  requireHash(input.sha256, 'File SHA-256');
  requirePurpose(input.purpose);
}

function validateOwnedInput(input: OwnedFileAssetInput): void {
  if (!isExactPlainObject(input, OWNED_FIELDS)) throw new TypeError('Owned file input contains unsupported fields');
  requireFileId(input.fileId, 'File ID');
  requireFileId(input.actorId, 'File actor ID');
}

function validateMarkReadyInput(input: MarkFileAssetReadyInput): void {
  if (!isExactPlainObject(input, MARK_READY_FIELDS)) {
    throw new TypeError('File completion input contains unsupported fields');
  }
  requireFileId(input.fileId, 'File ID');
  requireFileId(input.actorId, 'File actor ID');
  requireHash(input.expectedSha256, 'Expected file SHA-256');
  requireHash(input.measuredSha256, 'Measured file SHA-256');
  requireByteSize(input.expectedByteSize, 'Expected file byte size');
  requireByteSize(input.measuredByteSize, 'Measured file byte size');
  requireMimeType(input.measuredMimeType);
}

function snapshot(asset: {
  id: string;
  object_key: string;
  original_name: string;
  mime_type: string;
  byte_size: bigint;
  sha256: string;
  visibility: FileVisibility;
  status: FileStatus;
  purpose: FilePurpose;
  created_by_id: string | null;
  created_at: Date;
  deleted_at: Date | null;
}): FileAssetSnapshot {
  requireMimeType(asset.mime_type);
  return {
    id: asset.id,
    objectKey: asset.object_key,
    originalName: asset.original_name,
    mimeType: asset.mime_type,
    byteSize: asset.byte_size,
    sha256: asset.sha256,
    visibility: asset.visibility,
    status: asset.status,
    purpose: asset.purpose,
    createdById: asset.created_by_id,
    createdAt: asset.created_at,
    deletedAt: asset.deleted_at,
  };
}

export function buildStagingObjectKey(fileId: string): string {
  requireFileId(fileId, 'File ID');
  return `staging/${fileId}`;
}

export function visibilityForPurpose(purpose: SupportedFilePurpose): FileVisibility {
  requirePurpose(purpose);
  return PUBLIC_PURPOSE.has(purpose) ? 'PUBLIC' : 'PRIVATE';
}

export function buildFinalObjectKey(fileId: string, purpose: SupportedFilePurpose): string {
  requireFileId(fileId, 'File ID');
  return `${visibilityForPurpose(purpose) === 'PUBLIC' ? 'public' : 'private'}/${fileId}`;
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'File asset does not exist or is not owned by the actor');
}

function stateConflict(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'File asset is not pending');
}

export class FileAssetRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    requireDate(value, 'File repository clock');
    return value;
  }

  private validateCleanupThreshold(olderThan: Date): void {
    requireDate(olderThan, 'File cleanup threshold');
    if (olderThan.getTime() > this.currentTime().getTime() - FILE_ASSET_PENDING_TTL_MS) {
      throw new TypeError('File cleanup threshold must be at least 24 hours old');
    }
  }

  private validateReadyOrphanThreshold(olderThan: Date): void {
    requireDate(olderThan, 'Ready file orphan cleanup threshold');
    if (olderThan.getTime() > this.currentTime().getTime() - FILE_ASSET_READY_ORPHAN_TTL_MS) {
      throw new TypeError('Ready file orphan cleanup threshold must be at least 7 days old');
    }
  }

  private async ownedInTransaction(
    transaction: DatabaseTransaction,
    input: OwnedFileAssetInput,
  ): Promise<FileAssetSnapshot> {
    const asset = await transaction.fileAsset.findFirst({
      where: {
        created_by_id: input.actorId,
        deleted_at: null,
        id: input.fileId,
      },
    });
    if (!asset) throw notFound();
    return snapshot(asset);
  }

  async createPendingInTransaction(
    transaction: DatabaseTransaction,
    input: CreatePendingFileAssetInput,
  ): Promise<FileAssetSnapshot> {
    validateCreateInput(input);
    const createdAt = this.currentTime();
    const asset = await transaction.fileAsset.create({
      data: {
        byte_size: input.byteSize,
        created_at: createdAt,
        created_by_id: input.actorId,
        id: input.id,
        mime_type: input.mimeType,
        object_key: buildStagingObjectKey(input.id),
        original_name: input.originalName,
        purpose: input.purpose,
        sha256: input.sha256,
        status: 'PENDING',
        visibility: 'PRIVATE',
      },
    });
    return snapshot(asset);
  }

  async getOwned(input: OwnedFileAssetInput): Promise<FileAssetSnapshot> {
    validateOwnedInput(input);
    const asset = await this.prisma.fileAsset.findFirst({
      where: {
        created_by_id: input.actorId,
        deleted_at: null,
        id: input.fileId,
      },
    });
    if (!asset) throw notFound();
    return snapshot(asset);
  }

  async getAdminDownloadable(
    input: AdminDownloadableFileInput,
  ): Promise<FileAssetSnapshot> {
    if (!isExactPlainObject(input, ADMIN_DOWNLOADABLE_FIELDS)) {
      throw new TypeError('Admin downloadable file input contains unsupported fields');
    }
    requireFileId(input.actorId, 'Admin actor ID');
    requireFileId(input.fileId, 'File ID');
    const asset = await this.prisma.fileAsset.findFirst({
      where: {
        deleted_at: null,
        id: input.fileId,
        OR: [
          { created_by_id: input.actorId },
          {
            aftersale_evidence: { some: {} },
            object_key: buildFinalObjectKey(input.fileId, 'AFTERSALE_EVIDENCE'),
            purpose: 'AFTERSALE_EVIDENCE',
            status: 'READY',
            visibility: 'PRIVATE',
          },
        ],
      },
    });
    if (!asset) throw notFound();
    return snapshot(asset);
  }

  async getOwnedPendingInTransaction(
    transaction: DatabaseTransaction,
    input: OwnedFileAssetInput,
  ): Promise<FileAssetSnapshot> {
    validateOwnedInput(input);
    await acquireTransactionLock(transaction, 'file-asset', [input.fileId]);
    const asset = await this.ownedInTransaction(transaction, input);
    if (asset.status !== 'PENDING') throw stateConflict();
    if (asset.objectKey !== buildStagingObjectKey(asset.id)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Pending file asset object key is invalid');
    }
    return asset;
  }

  async markReadyInTransaction(
    transaction: DatabaseTransaction,
    input: MarkFileAssetReadyInput,
  ): Promise<MarkFileAssetReadyResult> {
    validateMarkReadyInput(input);
    await acquireTransactionLock(transaction, 'file-asset', [input.fileId]);
    const asset = await this.ownedInTransaction(transaction, input);
    if (asset.status !== 'PENDING') throw stateConflict();
    if (asset.objectKey !== buildStagingObjectKey(asset.id)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Pending file asset object key is invalid');
    }
    if (asset.sha256 !== input.expectedSha256 || asset.sha256 !== input.measuredSha256 ||
      asset.byteSize !== input.expectedByteSize || asset.byteSize !== input.measuredByteSize ||
      asset.mimeType !== input.measuredMimeType) {
      throw new ApplicationError('FILE_CONTENT_MISMATCH', 'Uploaded object does not match the file intent');
    }
    const completedAt = this.currentTime();
    const updated = await transaction.fileAsset.update({
      data: {
        byte_size: input.measuredByteSize,
        mime_type: input.measuredMimeType,
        object_key: buildFinalObjectKey(asset.id, asset.purpose),
        sha256: input.measuredSha256,
        status: 'READY',
        visibility: visibilityForPurpose(asset.purpose),
      },
      where: { id: asset.id },
    });
    return { asset: snapshot(updated), completedAt };
  }

  async listCleanupCandidates(input: ListFileCleanupCandidatesInput): Promise<FileCleanupCandidate[]> {
    if (!isExactPlainObject(input, LIST_CANDIDATE_FIELDS)) {
      throw new TypeError('File cleanup query contains unsupported fields');
    }
    this.validateCleanupThreshold(input.olderThan);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new TypeError('File cleanup limit must be between 1 and 100');
    }
    const assets = await this.prisma.fileAsset.findMany({
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { created_at: true, id: true, object_key: true, purpose: true },
      take: input.limit,
      where: {
        created_at: { lte: input.olderThan },
        deleted_at: null,
        object_key: { startsWith: 'staging/' },
        status: 'PENDING',
      },
    });
    return assets.flatMap((asset) => asset.object_key === buildStagingObjectKey(asset.id)
      ? [{
          id: asset.id,
          objectKey: asset.object_key,
          finalObjectKey: buildFinalObjectKey(asset.id, asset.purpose),
          purpose: asset.purpose,
          createdAt: asset.created_at,
        }]
      : []);
  }

  private async hasAttachment(transaction: DatabaseTransaction, fileId: string): Promise<boolean> {
    const counts = await Promise.all([
      transaction.productImage.count({ where: { file_id: fileId } }),
      transaction.brand.count({ where: { logo_file_id: fileId } }),
      transaction.category.count({ where: { icon_file_id: fileId } }),
      transaction.banner.count({ where: { file_id: fileId } }),
      transaction.promotionAsset.count({ where: { qr_file_id: fileId } }),
      transaction.aftersaleEvidence.count({ where: { file_id: fileId } }),
      transaction.withdrawalProof.count({ where: { file_id: fileId } }),
    ]);
    return counts.some((count) => count > 0);
  }

  async listReadyOrphanCleanupCandidates(
    input: ListFileCleanupCandidatesInput,
  ): Promise<ReadyFileOrphanCleanupCandidate[]> {
    if (!isExactPlainObject(input, LIST_CANDIDATE_FIELDS)) {
      throw new TypeError('Ready file orphan cleanup query contains unsupported fields');
    }
    this.validateReadyOrphanThreshold(input.olderThan);
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new TypeError('Ready file orphan cleanup limit must be between 1 and 100');
    }
    const rows = await this.prisma.$queryRaw<Array<{
      id: string;
      object_key: string;
      purpose: FilePurpose;
      ready_at: Date;
      status: string;
    }>>(Prisma.sql`
      SELECT f.id, f.object_key, f.purpose, e.created_at AS ready_at, f.status::text AS status
      FROM public.file_asset f
      JOIN public.outbox_event e
        ON e.aggregate_type = 'file'
       AND e.aggregate_id = f.id
       AND e.event_type = ${FILE_STAGING_CLEANUP_EVENT_TYPE}
      WHERE f.deleted_at IS NULL
        AND f.status IN ('READY', 'REJECTED')
        AND e.created_at <= ${input.olderThan}
        AND e.payload = jsonb_build_object(
          'event_version', 1,
          'resource_type', 'file',
          'resource_id', f.id,
          'resource_version', 1
        )
        AND (
          SELECT count(*)
          FROM public.outbox_event duplicate
          WHERE duplicate.aggregate_type = 'file'
            AND duplicate.aggregate_id = f.id
            AND duplicate.event_type = ${FILE_STAGING_CLEANUP_EVENT_TYPE}
        ) = 1
      ORDER BY e.created_at ASC, f.id ASC
      LIMIT ${input.limit}
    `);
    return rows.flatMap((row): ReadyFileOrphanCleanupCandidate[] => {
      requirePurpose(row.purpose);
      requireDate(row.ready_at, 'Ready file orphan completion time');
      if ((row.status !== 'READY' && row.status !== 'REJECTED') ||
        row.object_key !== buildFinalObjectKey(row.id, row.purpose)) return [];
      return [{
        id: row.id,
        objectKey: row.object_key,
        purpose: row.purpose,
        readyAt: row.ready_at,
        stagingObjectKey: buildStagingObjectKey(row.id),
        status: row.status,
      }];
    });
  }

  private validateReadyOrphanInput(input: ReadyFileOrphanCleanupInput): void {
    if (!isExactPlainObject(input, READY_ORPHAN_INPUT_FIELDS)) {
      throw new TypeError('Ready file orphan cleanup recheck contains unsupported fields');
    }
    requireFileId(input.fileId, 'File ID');
    if (input.expectedObjectKey !== `public/${input.fileId}` &&
      input.expectedObjectKey !== `private/${input.fileId}`) {
      throw new TypeError('Ready file orphan object key is invalid');
    }
    this.validateReadyOrphanThreshold(input.olderThan);
  }

  private async recheckReadyOrphanLocked(
    transaction: DatabaseTransaction,
    input: ReadyFileOrphanCleanupInput,
  ): Promise<'READY' | 'REJECTED' | null> {
    const rows = await transaction.$queryRaw<Array<{
      deleted_at: Date | null;
      id: string;
      object_key: string;
      purpose: FilePurpose;
      status: string;
    }>>(Prisma.sql`
      SELECT id, object_key, purpose, status::text AS status, deleted_at
      FROM public.file_asset
      WHERE id = ${input.fileId}
      FOR UPDATE
    `);
    const asset = rows[0];
    if (rows.length !== 1 || asset === undefined || asset.deleted_at !== null ||
      (asset.status !== 'READY' && asset.status !== 'REJECTED')) return null;
    requirePurpose(asset.purpose);
    if (asset.object_key !== input.expectedObjectKey ||
      asset.object_key !== buildFinalObjectKey(asset.id, asset.purpose)) return null;
    const eventCounts = await transaction.$queryRaw<Array<{ total: number; valid: number }>>(Prisma.sql`
      SELECT
        count(*)::integer AS total,
        count(*) FILTER (WHERE
          created_at <= ${input.olderThan}
          AND payload = jsonb_build_object(
            'event_version', 1,
            'resource_type', 'file',
            'resource_id', ${input.fileId},
            'resource_version', 1
          )
        )::integer AS valid
      FROM public.outbox_event
      WHERE aggregate_type = 'file'
        AND aggregate_id = ${input.fileId}
        AND event_type = ${FILE_STAGING_CLEANUP_EVENT_TYPE}
    `);
    if (eventCounts[0]?.total !== 1 || eventCounts[0]?.valid !== 1 ||
      await this.hasAttachment(transaction, input.fileId)) return null;
    return asset.status;
  }

  async prepareReadyOrphanCleanupInTransaction(
    transaction: DatabaseTransaction,
    input: ReadyFileOrphanCleanupInput,
  ): Promise<ReadyFileOrphanCleanupPreparation | null> {
    this.validateReadyOrphanInput(input);
    const status = await this.recheckReadyOrphanLocked(transaction, input);
    if (status === null) return null;
    if (status === 'REJECTED') return 'RESUME';
    const result = await transaction.fileAsset.updateMany({
      data: { status: 'REJECTED' },
      where: { deleted_at: null, id: input.fileId, object_key: input.expectedObjectKey, status: 'READY' },
    });
    return result.count === 1 ? 'TRANSITIONED' : null;
  }

  async markReadyOrphanDeletedInTransaction(
    transaction: DatabaseTransaction,
    input: ReadyFileOrphanCleanupInput,
  ): Promise<boolean> {
    this.validateReadyOrphanInput(input);
    if (await this.recheckReadyOrphanLocked(transaction, input) !== 'REJECTED') return false;
    const result = await transaction.fileAsset.updateMany({
      data: { deleted_at: this.currentTime(), status: 'DELETED' },
      where: { deleted_at: null, id: input.fileId, object_key: input.expectedObjectKey, status: 'REJECTED' },
    });
    return result.count === 1;
  }

  private async recheckCleanupCandidateLocked(
    transaction: DatabaseTransaction,
    input: RecheckFileCleanupCandidateInput,
  ): Promise<FileCleanupCandidate | null> {
    const asset = await transaction.fileAsset.findFirst({
      select: { created_at: true, id: true, object_key: true, purpose: true },
      where: {
        created_at: { lte: input.olderThan },
        deleted_at: null,
        id: input.fileId,
        object_key: input.expectedObjectKey,
        status: 'PENDING',
      },
    });
    if (!asset || asset.object_key !== buildStagingObjectKey(asset.id)) return null;
    const finalObjectKey = buildFinalObjectKey(asset.id, asset.purpose);
    const [attached, readyReference] = await Promise.all([
      this.hasAttachment(transaction, asset.id),
      transaction.fileAsset.count({
        where: { object_key: finalObjectKey, status: 'READY' },
      }),
    ]);
    if (attached || readyReference > 0) return null;
    return {
      id: asset.id,
      objectKey: asset.object_key,
      finalObjectKey,
      purpose: asset.purpose,
      createdAt: asset.created_at,
    };
  }

  async recheckCleanupCandidateInTransaction(
    transaction: DatabaseTransaction,
    input: RecheckFileCleanupCandidateInput,
  ): Promise<FileCleanupCandidate | null> {
    this.validateRecheckInput(input);
    await acquireTransactionLock(transaction, 'file-asset', [input.fileId]);
    return this.recheckCleanupCandidateLocked(transaction, input);
  }

  async markRejectedAfterCleanupInTransaction(
    transaction: DatabaseTransaction,
    input: RecheckFileCleanupCandidateInput,
  ): Promise<boolean> {
    this.validateRecheckInput(input);
    await acquireTransactionLock(transaction, 'file-asset', [input.fileId]);
    const candidate = await this.recheckCleanupCandidateLocked(transaction, input);
    if (!candidate) return false;
    const result = await transaction.fileAsset.updateMany({
      data: { status: 'REJECTED' },
      where: {
        created_at: { lte: input.olderThan },
        deleted_at: null,
        id: candidate.id,
        object_key: candidate.objectKey,
        status: 'PENDING',
      },
    });
    return result.count === 1;
  }

  async recheckReadyForStagingCleanupInTransaction(
    transaction: DatabaseTransaction,
    input: RecheckReadyFileStagingCleanupInput,
  ): Promise<ReadyFileStagingCleanup | null> {
    if (!isExactPlainObject(input, RECHECK_READY_STAGING_FIELDS)) {
      throw new TypeError('Ready file staging cleanup recheck contains unsupported fields');
    }
    requireFileId(input.fileId, 'File ID');
    await acquireTransactionLock(transaction, 'file-asset', [input.fileId]);
    const asset = await transaction.fileAsset.findFirst({
      select: { id: true, object_key: true, purpose: true, status: true },
      where: { id: input.fileId },
    });
    if (!asset || asset.status !== 'READY' || asset.object_key !== buildFinalObjectKey(asset.id, asset.purpose)) {
      return null;
    }
    return {
      fileId: asset.id,
      stagingObjectKey: buildStagingObjectKey(asset.id),
    };
  }

  private validateRecheckInput(input: RecheckFileCleanupCandidateInput): void {
    if (!isExactPlainObject(input, RECHECK_CANDIDATE_FIELDS)) {
      throw new TypeError('File cleanup recheck contains unsupported fields');
    }
    requireFileId(input.fileId, 'File ID');
    if (input.expectedObjectKey !== buildStagingObjectKey(input.fileId)) {
      throw new TypeError('File cleanup object key is invalid');
    }
    this.validateCleanupThreshold(input.olderThan);
  }
}
