import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;

export interface BusinessRuleChanges {
  aftersaleWindowDays?: number;
  minimumWithdrawalAmount?: string;
}

export interface InitialBusinessRuleBootstrapInput {
  actorAccountId: string;
  legalRecordRetentionYears: number;
}

export interface BusinessRuleVersionSnapshot {
  aftersaleWindowDays: number;
  effectiveAt: Date;
  legalRecordRetentionYears: number;
  minimumWithdrawalAmount: string;
  orderPaymentTimeoutMinutes: 30;
  version: number;
  versionId: string;
  versionNo: number;
}

export interface BusinessRulePublishPreviewSnapshot {
  changedFields: Array<'aftersale_window_days' | 'minimum_withdrawal_amount'>;
  current: BusinessRuleVersionSnapshot;
  currentPublishedId: string;
  maxVersionNo: number;
  next: BusinessRuleVersionSnapshot;
  resourceVersion: number;
}

export interface BusinessRulePublishInput {
  actorAccountId: string;
  changes: BusinessRuleChanges;
  expectedCurrentPublishedId: string;
  expectedMaxVersionNo: number;
  expectedVersion: number;
  reason: string;
}

export interface BusinessRulePublishHooks {
  verifyPreview(snapshot: BusinessRulePublishPreviewSnapshot): Promise<void> | void;
}

export interface BusinessRulePublishResult {
  audit: {
    after: BusinessRuleAuditSnapshot;
    before: BusinessRuleAuditSnapshot;
  };
  rule: BusinessRuleVersionSnapshot;
}

interface BusinessRuleAuditSnapshot {
  aftersale_window_days: number;
  minimum_withdrawal_amount: string;
  status: 'PUBLISHED';
  version: number;
}

type RuleRow = {
  aftersale_window_days: number;
  created_at: Date;
  created_by_id: string;
  effective_at: Date | null;
  id: string;
  legal_record_retention_years: number;
  minimum_withdrawal_amount: Prisma.Decimal;
  order_payment_timeout_minutes: number;
  reason: string;
  status: string;
  version_no: number;
};

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Published business rules were not found');
}

function conflict(message: string): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', message);
}

function exactObject(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be a plain object`);
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_POSTGRES_INTEGER) {
    throw new TypeError(`${label} is invalid`);
  }
  return Number(value);
}

function storedVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return Number(value);
}

function storedDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function normalizeReason(value: unknown): string {
  if (typeof value !== 'string' || /\p{Cc}/u.test(value)) throw new TypeError('Business rule reason is invalid');
  const normalized = value.trim();
  if (Array.from(normalized).length < 2 || Array.from(normalized).length > 500) {
    throw new TypeError('Business rule reason is invalid');
  }
  return normalized;
}

function validateChanges(value: BusinessRuleChanges): BusinessRuleChanges {
  exactObject(value, ['aftersaleWindowDays', 'minimumWithdrawalAmount'], [], 'Business rule changes');
  if (Object.keys(value).length === 0) throw new TypeError('Business rule changes must not be empty');
  const result: BusinessRuleChanges = {};
  const aftersaleWindowDays = value.aftersaleWindowDays;
  if (aftersaleWindowDays !== undefined) {
    if (typeof aftersaleWindowDays !== 'number' || !Number.isSafeInteger(aftersaleWindowDays) ||
      aftersaleWindowDays < 1 || aftersaleWindowDays > 365) {
      throw new TypeError('Aftersale window days are invalid');
    }
    result.aftersaleWindowDays = aftersaleWindowDays;
  }
  const minimumWithdrawalAmount = value.minimumWithdrawalAmount;
  if (minimumWithdrawalAmount !== undefined) {
    if (typeof minimumWithdrawalAmount !== 'string' || !MONEY.test(minimumWithdrawalAmount)) {
      throw new TypeError('Minimum withdrawal amount is invalid');
    }
    result.minimumWithdrawalAmount = minimumWithdrawalAmount;
  }
  return result;
}

function validatePublishInput(input: BusinessRulePublishInput): BusinessRulePublishInput {
  exactObject(input, [
    'actorAccountId', 'changes', 'expectedCurrentPublishedId', 'expectedMaxVersionNo', 'expectedVersion', 'reason',
  ], [
    'actorAccountId', 'changes', 'expectedCurrentPublishedId', 'expectedMaxVersionNo', 'expectedVersion', 'reason',
  ], 'Business rule publish input');
  if (!isValidUlid(input.actorAccountId)) throw new TypeError('Business rule actor ID is invalid');
  if (!isValidUlid(input.expectedCurrentPublishedId)) throw new TypeError('Business rule current ID is invalid');
  return {
    ...input,
    changes: validateChanges(input.changes),
    expectedMaxVersionNo: requireVersion(input.expectedMaxVersionNo, 'Business rule maximum version'),
    expectedVersion: requireVersion(input.expectedVersion, 'Business rule expected version'),
    reason: normalizeReason(input.reason),
  };
}

function snapshot(row: RuleRow, allowArchived = false): BusinessRuleVersionSnapshot {
  if ((row.status !== 'PUBLISHED' && (!allowArchived || row.status !== 'ARCHIVED')) || row.effective_at === null ||
    !isValidUlid(row.id) || !isValidUlid(row.created_by_id) || !Prisma.Decimal.isDecimal(row.minimum_withdrawal_amount) ||
    !MONEY.test(row.minimum_withdrawal_amount.toFixed(2)) || !Number.isSafeInteger(row.aftersale_window_days) ||
    row.aftersale_window_days < 1 || row.aftersale_window_days > 365 ||
    !Number.isSafeInteger(row.legal_record_retention_years) || row.legal_record_retention_years < 1 ||
    row.legal_record_retention_years > 100 || row.order_payment_timeout_minutes !== 30 ||
    typeof row.reason !== 'string' || Array.from(row.reason).length < 2 || Array.from(row.reason).length > 500) {
    throw internal('Stored business rule version is invalid');
  }
  storedDate(row.created_at, 'Stored business rule creation time');
  const versionNo = storedVersion(row.version_no, 'Stored business rule version');
  return {
    aftersaleWindowDays: row.aftersale_window_days,
    effectiveAt: storedDate(row.effective_at, 'Stored business rule effective time'),
    legalRecordRetentionYears: row.legal_record_retention_years,
    minimumWithdrawalAmount: row.minimum_withdrawal_amount.toFixed(2),
    orderPaymentTimeoutMinutes: 30,
    version: versionNo,
    versionId: row.id,
    versionNo,
  };
}

export class BusinessRuleRepository {
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
      throw new ApplicationError('AUTH_REQUIRED', 'Active SUPER_ADMIN account is required');
    }
  }

  private async readRows(transaction: DatabaseTransaction, lock: boolean): Promise<RuleRow[]> {
    return transaction.$queryRaw<RuleRow[]>(lock ? Prisma.sql`
      SELECT id, version_no, status::text, minimum_withdrawal_amount, aftersale_window_days,
        legal_record_retention_years, order_payment_timeout_minutes, reason, created_by_id, effective_at, created_at
      FROM public.business_rule_version
      ORDER BY version_no ASC, id ASC
      FOR UPDATE
    ` : Prisma.sql`
      SELECT id, version_no, status::text, minimum_withdrawal_amount, aftersale_window_days,
        legal_record_retention_years, order_payment_timeout_minutes, reason, created_by_id, effective_at, created_at
      FROM public.business_rule_version
      ORDER BY version_no ASC, id ASC
    `);
  }

  private facts(rows: RuleRow[]): { current: BusinessRuleVersionSnapshot; maxVersionNo: number } {
    const maxVersionNo = rows.reduce(
      (maximum, row) => Math.max(maximum, storedVersion(row.version_no, 'Stored business rule version')),
      0,
    );
    const published = rows.filter(({ status }) => status === 'PUBLISHED');
    if (published.length > 1) throw internal('Published business rule cardinality is invalid');
    if (published.length === 0) {
      if (rows.length > 0) throw internal('Business rule history exists without a published version');
      throw notFound();
    }
    return { current: snapshot(published[0]!), maxVersionNo };
  }

  private previewFromRows(rows: RuleRow[], changesInput: BusinessRuleChanges): BusinessRulePublishPreviewSnapshot {
    const changes = validateChanges(changesInput);
    const facts = this.facts(rows);
    const next: BusinessRuleVersionSnapshot = {
      ...facts.current,
      ...(changes.aftersaleWindowDays === undefined ? {} : { aftersaleWindowDays: changes.aftersaleWindowDays }),
      ...(changes.minimumWithdrawalAmount === undefined
        ? {}
        : { minimumWithdrawalAmount: changes.minimumWithdrawalAmount }),
    };
    const changedFields: BusinessRulePublishPreviewSnapshot['changedFields'] = [];
    if (next.minimumWithdrawalAmount !== facts.current.minimumWithdrawalAmount) {
      changedFields.push('minimum_withdrawal_amount');
    }
    if (next.aftersaleWindowDays !== facts.current.aftersaleWindowDays) changedFields.push('aftersale_window_days');
    if (changedFields.length === 0) throw new ApplicationError('STATE_CONFLICT', 'Business rule changes have no effect');
    return {
      changedFields,
      current: facts.current,
      currentPublishedId: facts.current.versionId,
      maxVersionNo: facts.maxVersionNo,
      next,
      resourceVersion: facts.current.version,
    };
  }

  previewPublishInTransaction(
    transaction: DatabaseTransaction,
    changes: BusinessRuleChanges,
  ): Promise<BusinessRulePublishPreviewSnapshot> {
    return this.readRows(transaction, false).then((rows) => this.previewFromRows(rows, changes));
  }

  readCurrent(): Promise<BusinessRuleVersionSnapshot> {
    return this.prisma.$transaction(
      async (transaction) => this.facts(await this.readRows(transaction, false)).current,
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async bootstrapInitialInTransaction(
    transaction: DatabaseTransaction,
    input: InitialBusinessRuleBootstrapInput,
  ): Promise<BusinessRuleVersionSnapshot> {
    exactObject(input, ['actorAccountId', 'legalRecordRetentionYears'], [
      'actorAccountId', 'legalRecordRetentionYears',
    ], 'Initial business rule bootstrap input');
    if (!isValidUlid(input.actorAccountId) || !Number.isSafeInteger(input.legalRecordRetentionYears) ||
      input.legalRecordRetentionYears < 1 || input.legalRecordRetentionYears > 100) {
      throw new TypeError('Initial business rule bootstrap input is invalid');
    }
    await this.lockActor(transaction, input.actorAccountId);
    await acquireTransactionLock(transaction, 'business-rule-config', ['singleton']);
    if ((await this.readRows(transaction, true)).length !== 0) {
      throw new ApplicationError('STATE_CONFLICT', 'Business rule history already exists');
    }
    const times = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const occurredAt = storedDate(times[0]?.transaction_time, 'Database transaction time');
    const row = await transaction.businessRuleVersion.create({
      data: {
        aftersale_window_days: 7,
        created_at: occurredAt,
        created_by_id: input.actorAccountId,
        effective_at: occurredAt,
        id: generateUlid(occurredAt.getTime()),
        legal_record_retention_years: input.legalRecordRetentionYears,
        minimum_withdrawal_amount: '100.00',
        order_payment_timeout_minutes: 30,
        reason: 'Controlled initial business-rule bootstrap',
        status: 'PUBLISHED',
        version_no: 1,
      },
    });
    return snapshot({ ...row, status: row.status });
  }

  async getForReplayInTransaction(
    transaction: DatabaseTransaction,
    actorAccountId: string,
    versionId: string,
  ): Promise<BusinessRuleVersionSnapshot> {
    if (!isValidUlid(actorAccountId) || !isValidUlid(versionId)) throw new TypeError('Business rule replay IDs are invalid');
    await this.lockActor(transaction, actorAccountId);
    await acquireTransactionLock(transaction, 'business-rule-config', ['singleton']);
    const row = (await this.readRows(transaction, true)).find(({ id }) => id === versionId);
    if (row === undefined || (row.status !== 'PUBLISHED' && row.status !== 'ARCHIVED')) throw notFound();
    return snapshot(row, true);
  }

  async publishInTransaction(
    transaction: DatabaseTransaction,
    input: BusinessRulePublishInput,
    hooks: BusinessRulePublishHooks,
  ): Promise<BusinessRulePublishResult> {
    const normalized = validatePublishInput(input);
    if (typeof hooks !== 'object' || hooks === null || typeof hooks.verifyPreview !== 'function') {
      throw new TypeError('Business rule publish hooks are invalid');
    }
    await this.lockActor(transaction, normalized.actorAccountId);
    await acquireTransactionLock(transaction, 'business-rule-config', ['singleton']);
    const preview = this.previewFromRows(await this.readRows(transaction, true), normalized.changes);
    if (preview.currentPublishedId !== normalized.expectedCurrentPublishedId ||
      preview.maxVersionNo !== normalized.expectedMaxVersionNo || preview.resourceVersion !== normalized.expectedVersion) {
      throw conflict('Business rule preview facts changed');
    }
    await hooks.verifyPreview(preview);
    const times = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const occurredAt = storedDate(times[0]?.transaction_time, 'Database transaction time');
    const nextVersionNo = preview.maxVersionNo + 1;
    if (nextVersionNo > MAX_POSTGRES_INTEGER) throw internal('Business rule version is exhausted');
    const versionId = generateUlid(occurredAt.getTime());
    await transaction.businessRuleVersion.create({
      data: {
        aftersale_window_days: preview.next.aftersaleWindowDays,
        created_at: occurredAt,
        created_by_id: normalized.actorAccountId,
        effective_at: null,
        id: versionId,
        legal_record_retention_years: preview.current.legalRecordRetentionYears,
        minimum_withdrawal_amount: preview.next.minimumWithdrawalAmount,
        order_payment_timeout_minutes: 30,
        reason: normalized.reason,
        status: 'DRAFT',
        version_no: nextVersionNo,
      },
      select: { id: true },
    });
    const archived = await transaction.businessRuleVersion.updateMany({
      data: { status: 'ARCHIVED' },
      where: { id: preview.currentPublishedId, status: 'PUBLISHED' },
    });
    if (archived.count !== 1) throw conflict('Published business rules changed during archive');
    const published = await transaction.businessRuleVersion.updateMany({
      data: { effective_at: occurredAt, status: 'PUBLISHED' },
      where: { effective_at: null, id: versionId, status: 'DRAFT' },
    });
    if (published.count !== 1) throw conflict('New business rules could not be published');
    const row = await transaction.businessRuleVersion.findUnique({ where: { id: versionId } });
    if (row === null) throw internal('Published business rules disappeared');
    const rule = snapshot({ ...row, status: row.status });
    return {
      audit: {
        after: {
          aftersale_window_days: rule.aftersaleWindowDays,
          minimum_withdrawal_amount: rule.minimumWithdrawalAmount,
          status: 'PUBLISHED',
          version: rule.version,
        },
        before: {
          aftersale_window_days: preview.current.aftersaleWindowDays,
          minimum_withdrawal_amount: preview.current.minimumWithdrawalAmount,
          status: 'PUBLISHED',
          version: preview.current.version,
        },
      },
      rule,
    };
  }
}
