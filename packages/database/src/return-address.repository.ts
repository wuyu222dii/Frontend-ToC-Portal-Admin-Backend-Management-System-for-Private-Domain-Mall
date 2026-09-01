import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const PHONE_LAST4 = /^[0-9+ -]{4}$/;

export interface ReturnAddressVersionMaterial {
  city: string;
  createdAt: Date;
  detailCiphertext: Uint8Array;
  district: string;
  effectiveAt: Date;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
  province: string;
  recipientName: string;
  version: number;
  versionId: string;
  versionNo: number;
}

export interface ReturnAddressPublishPreviewSnapshot {
  current: ReturnAddressVersionMaterial | null;
  currentPublishedId: string | null;
  maxVersionNo: number;
  resourceVersion: number;
}

export interface ReturnAddressProtectedMaterial {
  detailCiphertext: Uint8Array;
  encryptionKeyId: string;
  phoneCiphertext: Uint8Array;
  phoneLast4: string;
}

export interface ReturnAddressPublishInput {
  actorAccountId: string;
  city: string;
  district: string;
  expectedCurrentPublishedId: string | null;
  expectedMaxVersionNo: number;
  expectedVersion: number;
  province: string;
  reason: string;
  recipientName: string;
}

export interface ReturnAddressPublishHooks {
  protectVersion(input: { versionId: string }): ReturnAddressProtectedMaterial | Promise<ReturnAddressProtectedMaterial>;
  verifyPreview(snapshot: ReturnAddressPublishPreviewSnapshot): Promise<void> | void;
}

export interface ReturnAddressAuditState {
  status: 'PUBLISHED';
  version: number;
}

export interface ReturnAddressPublishResult {
  address: ReturnAddressVersionMaterial;
  audit: { after: ReturnAddressAuditState; before: ReturnAddressAuditState | null };
}

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Published return address was not found');
}

function versionConflict(message = 'Published return address version changed'): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', message);
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active SUPER_ADMIN account is required');
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function exactObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!plainObject(value)) throw new TypeError(`${label} must be a plain object`);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function safeUlid(value: unknown, label: string): string {
  if (!isValidUlid(value)) throw internal(`${label} is invalid`);
  return value;
}

function requireVersion(value: unknown, label: string, allowZero = false): asserts value is number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} is invalid`);
  }
}

function safeVersion(value: unknown, label: string, allowZero = false): number {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return value as number;
}

function safeDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const point = character.codePointAt(0);
    return point !== undefined && (point <= 0x1f || point === 0x7f);
  });
}

function normalizeText(value: unknown, maximum: number, label: string, minimum = 1): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  const length = Array.from(normalized).length;
  if (length < minimum || length > maximum || hasControlCharacters(normalized)) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function storedText(value: unknown, maximum: number, label: string): string {
  if (typeof value !== 'string' || Array.from(value).length < 1 || Array.from(value).length > maximum ||
    hasControlCharacters(value)) throw internal(`${label} is invalid`);
  return value;
}

function validateInput(input: ReturnAddressPublishInput): ReturnAddressPublishInput {
  exactObject(input, [
    'actorAccountId', 'city', 'district', 'expectedCurrentPublishedId', 'expectedMaxVersionNo',
    'expectedVersion', 'province', 'reason', 'recipientName',
  ], [
    'actorAccountId', 'city', 'district', 'expectedCurrentPublishedId', 'expectedMaxVersionNo',
    'expectedVersion', 'province', 'reason', 'recipientName',
  ], 'Return address publish input');
  requireUlid(input.actorAccountId, 'Return address actor ID');
  if (input.expectedCurrentPublishedId !== null) {
    requireUlid(input.expectedCurrentPublishedId, 'Current published return address ID');
  }
  requireVersion(input.expectedMaxVersionNo, 'Return address maximum version', true);
  requireVersion(input.expectedVersion, 'Return address expected version');
  return {
    ...input,
    city: normalizeText(input.city, 80, 'Return address city'),
    district: normalizeText(input.district, 80, 'Return address district'),
    province: normalizeText(input.province, 80, 'Return address province'),
    reason: normalizeText(input.reason, 500, 'Return address reason', 2),
    recipientName: normalizeText(input.recipientName, 80, 'Return address recipient'),
  };
}

type AddressRow = {
  city: string;
  created_at: Date;
  detail_ciphertext: Uint8Array;
  district: string;
  effective_at: Date | null;
  encryption_key_id: string;
  id: string;
  phone_ciphertext: Uint8Array;
  phone_last4: string;
  province: string;
  recipient_name: string;
  status: string;
  version_no: number;
};

function material(row: AddressRow, allowArchived = false): ReturnAddressVersionMaterial {
  if ((row.status !== 'PUBLISHED' && (!allowArchived || row.status !== 'ARCHIVED')) || row.effective_at === null ||
    !(row.phone_ciphertext instanceof Uint8Array) || !(row.detail_ciphertext instanceof Uint8Array) ||
    row.phone_ciphertext.byteLength < 1 || row.detail_ciphertext.byteLength < 1 ||
    !PHONE_LAST4.test(row.phone_last4)) {
    throw internal('Stored published return address material is invalid');
  }
  const versionNo = safeVersion(row.version_no, 'Stored return address version');
  return {
    city: storedText(row.city, 80, 'Stored return address city'),
    createdAt: safeDate(row.created_at, 'Stored return address creation time'),
    detailCiphertext: Buffer.from(row.detail_ciphertext),
    district: storedText(row.district, 80, 'Stored return address district'),
    effectiveAt: safeDate(row.effective_at, 'Stored return address effective time'),
    encryptionKeyId: storedText(row.encryption_key_id, 80, 'Stored return address encryption key'),
    phoneCiphertext: Buffer.from(row.phone_ciphertext),
    phoneLast4: row.phone_last4,
    province: storedText(row.province, 80, 'Stored return address province'),
    recipientName: storedText(row.recipient_name, 80, 'Stored return address recipient'),
    version: versionNo,
    versionId: safeUlid(row.id, 'Stored return address ID'),
    versionNo,
  };
}

function protectedMaterial(value: ReturnAddressProtectedMaterial): ReturnAddressProtectedMaterial {
  if (!plainObject(value) || !(value.phoneCiphertext instanceof Uint8Array) ||
    !(value.detailCiphertext instanceof Uint8Array) || value.phoneCiphertext.byteLength < 1 ||
    value.detailCiphertext.byteLength < 1 || typeof value.encryptionKeyId !== 'string' ||
    value.encryptionKeyId.length < 1 || value.encryptionKeyId.length > 80 ||
    typeof value.phoneLast4 !== 'string' || !PHONE_LAST4.test(value.phoneLast4)) {
    throw internal('Protected return address material is invalid');
  }
  return {
    detailCiphertext: Buffer.from(value.detailCiphertext),
    encryptionKeyId: value.encryptionKeyId,
    phoneCiphertext: Buffer.from(value.phoneCiphertext),
    phoneLast4: value.phoneLast4,
  };
}

export class ReturnAddressRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private async lockActor(transaction: DatabaseTransaction, actorAccountId: string): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{
      deleted_at: Date | null;
      has_password: boolean;
      id: string;
      role: string;
      status: string;
    }>>(Prisma.sql`
      SELECT id, role::text, status::text, deleted_at, password_hash IS NOT NULL AS has_password
      FROM public.account
      WHERE id = ${actorAccountId}
      FOR UPDATE
    `);
    const actor = rows[0];
    if (rows.length !== 1 || actor?.id !== actorAccountId || actor.role !== 'SUPER_ADMIN' ||
      actor.status !== 'ACTIVE' || actor.deleted_at !== null || actor.has_password !== true) {
      throw authenticationRequired();
    }
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    return safeDate(rows[0]?.transaction_time, 'Database transaction time');
  }

  private async readRows(transaction: DatabaseTransaction, lock: boolean): Promise<AddressRow[]> {
    return transaction.$queryRaw<AddressRow[]>(lock ? Prisma.sql`
      SELECT id, version_no, status::text, recipient_name, phone_ciphertext, phone_last4,
        encryption_key_id, province, city, district, detail_ciphertext, effective_at, created_at
      FROM public.return_address_version
      ORDER BY version_no ASC, id ASC
      FOR UPDATE
    ` : Prisma.sql`
      SELECT id, version_no, status::text, recipient_name, phone_ciphertext, phone_last4,
        encryption_key_id, province, city, district, detail_ciphertext, effective_at, created_at
      FROM public.return_address_version
      ORDER BY version_no ASC, id ASC
    `);
  }

  private previewFromRows(rows: AddressRow[]): ReturnAddressPublishPreviewSnapshot {
    const maxVersionNo = rows.reduce(
      (maximum, row) => Math.max(maximum, safeVersion(row.version_no, 'Stored return address version')),
      0,
    );
    const published = rows.filter(({ status }) => status === 'PUBLISHED');
    if (published.length > 1) throw internal('Published return address cardinality is invalid');
    if (published.length === 0 && maxVersionNo !== 0) {
      throw internal('Return address history exists without a published version');
    }
    const current = published[0] === undefined ? null : material(published[0]);
    return {
      current,
      currentPublishedId: current?.versionId ?? null,
      maxVersionNo,
      resourceVersion: current?.versionNo ?? 1,
    };
  }

  async previewPublishInTransaction(
    transaction: DatabaseTransaction,
  ): Promise<ReturnAddressPublishPreviewSnapshot> {
    return this.previewFromRows(await this.readRows(transaction, false));
  }

  previewPublish(): Promise<ReturnAddressPublishPreviewSnapshot> {
    return this.prisma.$transaction(
      (transaction) => this.previewPublishInTransaction(transaction),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async readCurrentInTransaction(transaction: DatabaseTransaction): Promise<ReturnAddressVersionMaterial> {
    const preview = await this.previewPublishInTransaction(transaction);
    if (preview.current === null) throw notFound();
    return preview.current;
  }

  readCurrent(): Promise<ReturnAddressVersionMaterial> {
    return this.prisma.$transaction(
      (transaction) => this.readCurrentInTransaction(transaction),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getForReplayInTransaction(
    transaction: DatabaseTransaction,
    actorAccountId: string,
    versionId: string,
  ): Promise<ReturnAddressVersionMaterial> {
    requireUlid(actorAccountId, 'Return address actor ID');
    requireUlid(versionId, 'Return address version ID');
    await this.lockActor(transaction, actorAccountId);
    await acquireTransactionLock(transaction, 'return-address-config', ['singleton']);
    const rows = await this.readRows(transaction, true);
    const exact = rows.find(({ id }) => id === versionId);
    if (exact === undefined || (exact.status !== 'PUBLISHED' && exact.status !== 'ARCHIVED')) throw notFound();
    return material(exact, true);
  }

  async publishInTransaction(
    transaction: DatabaseTransaction,
    input: ReturnAddressPublishInput,
    hooks: ReturnAddressPublishHooks,
  ): Promise<ReturnAddressPublishResult> {
    const normalized = validateInput(input);
    await this.lockActor(transaction, normalized.actorAccountId);
    await acquireTransactionLock(transaction, 'return-address-config', ['singleton']);
    const beforeFacts = this.previewFromRows(await this.readRows(transaction, true));
    if (beforeFacts.resourceVersion !== normalized.expectedVersion ||
      beforeFacts.currentPublishedId !== normalized.expectedCurrentPublishedId ||
      beforeFacts.maxVersionNo !== normalized.expectedMaxVersionNo) {
      throw versionConflict('Return address preview facts changed');
    }
    await hooks.verifyPreview(beforeFacts);
    const occurredAt = await this.transactionTime(transaction);
    const versionId = generateUlid(occurredAt.getTime());
    const nextVersionNo = beforeFacts.maxVersionNo + 1;
    if (nextVersionNo > MAX_POSTGRES_INTEGER) throw internal('Return address version is exhausted');
    const secured = protectedMaterial(await hooks.protectVersion({ versionId }));
    await transaction.returnAddressVersion.create({
      data: {
        city: normalized.city,
        created_at: occurredAt,
        created_by_id: normalized.actorAccountId,
        detail_ciphertext: new Uint8Array(secured.detailCiphertext),
        district: normalized.district,
        effective_at: null,
        encryption_key_id: secured.encryptionKeyId,
        id: versionId,
        phone_ciphertext: new Uint8Array(secured.phoneCiphertext),
        phone_last4: secured.phoneLast4,
        province: normalized.province,
        reason: normalized.reason,
        recipient_name: normalized.recipientName,
        status: 'DRAFT',
        version_no: nextVersionNo,
      },
      select: { id: true },
    });
    if (beforeFacts.currentPublishedId !== null) {
      const archived = await transaction.returnAddressVersion.updateMany({
        data: { status: 'ARCHIVED' },
        where: { id: beforeFacts.currentPublishedId, status: 'PUBLISHED' },
      });
      if (archived.count !== 1) throw versionConflict('Published return address changed during archive');
    }
    const published = await transaction.returnAddressVersion.updateMany({
      data: { effective_at: occurredAt, status: 'PUBLISHED' },
      where: { effective_at: null, id: versionId, status: 'DRAFT' },
    });
    if (published.count !== 1) throw versionConflict('New return address could not be published');
    const row = await transaction.returnAddressVersion.findUnique({ where: { id: versionId } });
    if (!row) throw internal('Published return address disappeared');
    const address = material({ ...row, status: row.status });
    return {
      address,
      audit: {
        after: { status: 'PUBLISHED', version: address.version },
        before: beforeFacts.current === null
          ? null
          : { status: 'PUBLISHED', version: beforeFacts.current.version },
      },
    };
  }
}
