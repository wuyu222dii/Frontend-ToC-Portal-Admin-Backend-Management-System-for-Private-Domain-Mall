import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { WithdrawalStatus } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import { lockReconciledAgentWalletInTransaction } from './agent-finance.repository';
import { buildFinalObjectKey } from './file-asset.repository';
import type { DatabaseTransaction } from './idempotency.repository';

export interface AdminWithdrawalListInput {
  agentId?: string;
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  maxAmount?: string;
  minAmount?: string;
  page: number;
  pageSize: number;
  status?: WithdrawalStatus;
  withdrawalNo?: string;
}

export interface AdminWithdrawalBalanceSnapshot {
  availableBefore: string;
  availableAfter: string;
  frozenBefore: string;
  frozenAfter: string;
  capturedAt: Date;
}

export interface AdminWithdrawalPayoutAccountSnapshot {
  accountHolder: string;
  bankName: string;
  last4: string;
  snapshotAt: Date;
}

export interface AdminWithdrawalSnapshot {
  withdrawalId: string;
  withdrawalNo: string;
  agentId: string;
  agentNo: string;
  agentName: string;
  status: WithdrawalStatus;
  amount: string;
  balanceSnapshot: AdminWithdrawalBalanceSnapshot;
  payoutAccountSnapshot: AdminWithdrawalPayoutAccountSnapshot;
  reviewReason: string | null;
  reviewedById: string | null;
  reviewedAt: Date | null;
  paidById: string | null;
  paidAt: Date | null;
  proofFileIds: string[];
  version: number;
  createdAt: Date;
}

export interface AdminWithdrawalListResult {
  items: AdminWithdrawalSnapshot[];
  total: number;
}

export type AdminWithdrawalAction = 'APPROVE' | 'MARK_PAID' | 'REJECT';

interface AdminWithdrawalActionBaseInput {
  actorAccountId: string;
  withdrawalId: string;
}

export type AdminWithdrawalActionImpactInput =
  | (AdminWithdrawalActionBaseInput & { action: 'APPROVE' })
  | (AdminWithdrawalActionBaseInput & { action: 'MARK_PAID'; proofFileIds: readonly string[] })
  | (AdminWithdrawalActionBaseInput & { action: 'REJECT'; reason: string });

export interface AdminWithdrawalActionImpact {
  action: AdminWithdrawalAction;
  withdrawal: AdminWithdrawalSnapshot;
  resourceVersion: number;
  resultingStatus: WithdrawalStatus;
  proofFileIds: string[];
  walletAvailableBefore: string;
  walletAvailableAfter: string;
  walletFrozenBefore: string;
  walletFrozenAfter: string;
}

export interface AdminWithdrawalCommandInput extends AdminWithdrawalActionBaseInput {
  expectedVersion: number;
}

export interface RejectAdminWithdrawalInput extends AdminWithdrawalCommandInput {
  reason: string;
}

export interface MarkAdminWithdrawalPaidInput extends AdminWithdrawalCommandInput {
  proofFileIds: readonly string[];
}

export interface BindAdminWithdrawalProofsInput extends AdminWithdrawalActionBaseInput {
  fileIds: readonly string[];
}

export interface AdminWithdrawalWalletMutation {
  availableBefore: string;
  availableAfter: string;
  frozenBefore: string;
  frozenAfter: string;
  versionBefore: number;
  versionAfter: number;
}

export interface AdminWithdrawalMutationResult {
  action: AdminWithdrawalAction;
  before: AdminWithdrawalSnapshot;
  after: AdminWithdrawalSnapshot;
  wallet: AdminWithdrawalWalletMutation;
  occurredAt: Date;
}

export interface BindAdminWithdrawalProofsResult {
  before: AdminWithdrawalSnapshot;
  after: AdminWithdrawalSnapshot;
  changed: boolean;
  occurredAt: Date | null;
}

export interface AdminWithdrawalPreviewHooks {
  verifyPreview(impact: AdminWithdrawalActionImpact): Promise<void> | void;
}

export type ConsumePayoutAccountRevealInput = AdminWithdrawalCommandInput;

export interface AdminWithdrawalPayoutAccountMaterial {
  withdrawalId: string;
  version: number;
  accountHolder: string;
  bankName: string;
  last4: string;
  ciphertext: Uint8Array;
  encryptionKeyId: string;
  sourceBankAccountId: string;
  snapshotAt: Date;
  grantId: string;
  grantExpiresAt: Date;
}

export interface AdminWithdrawalRevealHooks {
  consumeGrant(): Promise<{ expiresAt: Date; grantId: string }>;
}

const WITHDRAWAL_SELECT = {
  agent: { select: { agent_no: true, id: true, name: true } },
  agent_id: true,
  amount: true,
  available_before: true,
  bank_snapshot: {
    select: {
      account_holder: true,
      account_no_last4: true,
      bank_name: true,
      created_at: true,
      source_bank_account_id: true,
      withdrawal_id: true,
    },
  },
  created_at: true,
  frozen_after: true,
  id: true,
  paid_at: true,
  paid_by_id: true,
  proofs: {
    orderBy: [{ created_at: 'asc' as const }, { id: 'asc' as const }],
    select: { file_id: true, withdrawal_id: true },
  },
  review_reason: true,
  reviewed_at: true,
  reviewed_by_id: true,
  status: true,
  version: true,
  withdrawal_no: true,
} satisfies Prisma.WithdrawalSelect;

const PAYOUT_ACCOUNT_SELECT = {
  account_holder: true,
  account_no_ciphertext: true,
  account_no_last4: true,
  bank_name: true,
  created_at: true,
  encryption_key_id: true,
  source_bank_account_id: true,
  withdrawal_id: true,
} satisfies Prisma.WithdrawalBankSnapshotSelect;

const PROOF_FILE_SELECT = {
  _count: {
    select: {
      aftersale_evidence: true,
      banners: true,
      brand_logos: true,
      category_icons: true,
      product_images: true,
      promotion_qr_files: true,
    },
  },
  created_by_id: true,
  deleted_at: true,
  id: true,
  object_key: true,
  purpose: true,
  status: true,
  visibility: true,
  withdrawal_proofs: { select: { withdrawal_id: true } },
} satisfies Prisma.FileAssetSelect;

type WithdrawalRecord = Prisma.WithdrawalGetPayload<{ select: typeof WITHDRAWAL_SELECT }>;
type ProofFileRecord = Prisma.FileAssetGetPayload<{ select: typeof PROOF_FILE_SELECT }>;

const MAX_POSTGRES_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const WITHDRAWAL_STATUS = new Set<WithdrawalStatus>(['APPROVED', 'PAID', 'PENDING', 'REJECTED']);

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(message = 'Withdrawal was not found'): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', message);
}

function stateConflict(message: string): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', message);
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Withdrawal version changed');
}

function assertUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function assertVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Withdrawal expected version must be a positive PostgreSQL integer');
  }
}

function safeVersion(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_POSTGRES_INTEGER) {
    throw internal(`${label} is invalid`);
  }
  return value as number;
}

function safeDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function nullableDate(value: Date | null, label: string): Date | null {
  return value === null ? null : safeDate(value, label);
}

function boundedText(value: unknown, minimum: number, maximum: number, label: string): string {
  if (typeof value !== 'string') throw new TypeError(`${label} is invalid`);
  const normalized = value.trim();
  if (/\p{Cc}/u.test(normalized) || Array.from(normalized).length < minimum ||
    Array.from(normalized).length > maximum) throw new TypeError(`${label} is invalid`);
  return normalized;
}

function storedText(value: string, minimum: number, maximum: number, label: string): string {
  try {
    return boundedText(value, minimum, maximum, label);
  } catch {
    throw internal(`${label} is invalid`);
  }
}

function money(value: unknown, label: string, positive = false): Prisma.Decimal {
  if (!Prisma.Decimal.isDecimal(value) || !value.isFinite() || value.decimalPlaces() > 2 ||
    value.abs().greaterThan(MAX_MONEY) || (positive && !value.isPositive())) {
    throw internal(`${label} is invalid`);
  }
  return value;
}

function inputMoney(value: string, label: string): Prisma.Decimal {
  if (typeof value !== 'string' || !MONEY.test(value)) throw new TypeError(`${label} is invalid`);
  const result = new Prisma.Decimal(value);
  if (result.greaterThan(MAX_MONEY)) throw new TypeError(`${label} is invalid`);
  return result;
}

function validateList(input: AdminWithdrawalListInput): void {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || !Number.isSafeInteger(input.pageSize) ||
    input.pageSize < 1 || input.pageSize > 100 || (input.page - 1) * input.pageSize > MAX_POSTGRES_INTEGER) {
    throw new TypeError('Withdrawal pagination is invalid');
  }
  if (input.agentId !== undefined) assertUlid(input.agentId, 'Agent ID');
  for (const [value, label] of [
    [input.createdAtFrom, 'Withdrawal start date'],
    [input.createdAtToExclusive, 'Withdrawal end date'],
  ] as const) {
    if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
      throw new TypeError(`${label} is invalid`);
    }
  }
  if (input.createdAtFrom && input.createdAtToExclusive &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Withdrawal date range is invalid');
  }
  if (input.withdrawalNo !== undefined) boundedText(input.withdrawalNo, 1, 32, 'Withdrawal number');
  if (input.status !== undefined && !WITHDRAWAL_STATUS.has(input.status)) {
    throw new TypeError('Withdrawal status is invalid');
  }
  const minimum = input.minAmount === undefined ? undefined : inputMoney(input.minAmount, 'Minimum withdrawal filter');
  const maximum = input.maxAmount === undefined ? undefined : inputMoney(input.maxAmount, 'Maximum withdrawal filter');
  if (minimum && maximum && minimum.greaterThan(maximum)) throw new TypeError('Withdrawal amount range is invalid');
}

function validateCommand(input: AdminWithdrawalCommandInput): void {
  assertUlid(input.actorAccountId, 'Withdrawal actor ID');
  assertUlid(input.withdrawalId, 'Withdrawal ID');
  assertVersion(input.expectedVersion);
}

function normalizeFileIds(fileIds: readonly string[]): string[] {
  if (!Array.isArray(fileIds) || fileIds.length < 1 ||
    fileIds.some((fileId) => !isValidUlid(fileId)) || new Set(fileIds).size !== fileIds.length) {
    throw new TypeError('Withdrawal proof file IDs are invalid');
  }
  return [...fileIds].sort();
}

function withdrawalSnapshot(record: WithdrawalRecord): AdminWithdrawalSnapshot {
  if (!isValidUlid(record.id) || record.agent_id !== record.agent.id || !isValidUlid(record.agent_id) ||
    !WITHDRAWAL_STATUS.has(record.status) || record.bank_snapshot === null ||
    record.bank_snapshot.withdrawal_id !== record.id ||
    record.bank_snapshot.source_bank_account_id === null ||
    !isValidUlid(record.bank_snapshot.source_bank_account_id) ||
    !/^[0-9]{4}$/.test(record.bank_snapshot.account_no_last4) ||
    record.proofs.some((proof) => proof.withdrawal_id !== record.id || !isValidUlid(proof.file_id)) ||
    new Set(record.proofs.map(({ file_id: fileId }) => fileId)).size !== record.proofs.length) {
    throw internal('Stored withdrawal is inconsistent');
  }
  const amount = money(record.amount, 'Stored withdrawal amount', true);
  const availableBefore = money(record.available_before, 'Stored available balance snapshot');
  const frozenAfter = money(record.frozen_after, 'Stored frozen balance snapshot');
  const availableAfter = availableBefore.minus(amount);
  const frozenBefore = frozenAfter.minus(amount);
  if (amount.greaterThan(availableBefore) || frozenBefore.isNegative()) {
    throw internal('Stored withdrawal balance snapshot is inconsistent');
  }
  const createdAt = safeDate(record.created_at, 'Stored withdrawal creation time');
  const reviewedAt = nullableDate(record.reviewed_at, 'Stored withdrawal review time');
  const paidAt = nullableDate(record.paid_at, 'Stored withdrawal payment time');
  const hasReviewer = record.reviewed_by_id !== null && isValidUlid(record.reviewed_by_id) && reviewedAt !== null;
  const hasPayer = record.paid_by_id !== null && isValidUlid(record.paid_by_id) && paidAt !== null;
  const validLifecycle =
    (record.status === 'PENDING' && record.review_reason === null && !hasReviewer && record.reviewed_by_id === null &&
      reviewedAt === null && !hasPayer && record.paid_by_id === null && paidAt === null && record.proofs.length === 0) ||
    (record.status === 'APPROVED' && record.review_reason === null && hasReviewer && !hasPayer &&
      record.paid_by_id === null && paidAt === null) ||
    (record.status === 'REJECTED' && record.review_reason !== null && hasReviewer && !hasPayer &&
      record.paid_by_id === null && paidAt === null && record.proofs.length === 0) ||
    (record.status === 'PAID' && record.review_reason === null && hasReviewer && hasPayer &&
      record.proofs.length > 0 && paidAt!.getTime() >= reviewedAt!.getTime());
  if (!validLifecycle) throw internal('Stored withdrawal lifecycle is inconsistent');
  const reviewReason = record.review_reason === null
    ? null
    : storedText(record.review_reason, 2, 500, 'Stored withdrawal review reason');
  return {
    withdrawalId: record.id,
    withdrawalNo: storedText(record.withdrawal_no, 1, 32, 'Stored withdrawal number'),
    agentId: record.agent_id,
    agentNo: storedText(record.agent.agent_no, 1, 32, 'Stored Agent number'),
    agentName: storedText(record.agent.name, 1, 120, 'Stored Agent name'),
    status: record.status,
    amount: amount.toFixed(2),
    balanceSnapshot: {
      availableBefore: availableBefore.toFixed(2),
      availableAfter: availableAfter.toFixed(2),
      frozenBefore: frozenBefore.toFixed(2),
      frozenAfter: frozenAfter.toFixed(2),
      capturedAt: createdAt,
    },
    payoutAccountSnapshot: {
      accountHolder: storedText(record.bank_snapshot.account_holder, 2, 120, 'Stored account holder'),
      bankName: storedText(record.bank_snapshot.bank_name, 2, 160, 'Stored bank name'),
      last4: record.bank_snapshot.account_no_last4,
      snapshotAt: safeDate(record.bank_snapshot.created_at, 'Stored bank snapshot time'),
    },
    reviewReason,
    reviewedById: record.reviewed_by_id,
    reviewedAt,
    paidById: record.paid_by_id,
    paidAt,
    proofFileIds: record.proofs.map(({ file_id: fileId }) => fileId),
    version: safeVersion(record.version, 'Stored withdrawal version'),
    createdAt,
  };
}

function walletMoney(value: unknown, label: string): Prisma.Decimal {
  return money(value, label);
}

function walletMutation(
  wallet: { available_balance: Prisma.Decimal; frozen_balance: Prisma.Decimal; version: number },
  availableAfter: Prisma.Decimal,
  frozenAfter: Prisma.Decimal,
  changed: boolean,
): AdminWithdrawalWalletMutation {
  return {
    availableBefore: wallet.available_balance.toFixed(2),
    availableAfter: availableAfter.toFixed(2),
    frozenBefore: wallet.frozen_balance.toFixed(2),
    frozenAfter: frozenAfter.toFixed(2),
    versionBefore: safeVersion(wallet.version, 'Stored Agent wallet version'),
    versionAfter: safeVersion(wallet.version + (changed ? 1 : 0), 'Resulting Agent wallet version'),
  };
}

export class AdminWithdrawalRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listWithdrawals(input: AdminWithdrawalListInput): Promise<AdminWithdrawalListResult> {
    validateList(input);
    const where: Prisma.WithdrawalWhereInput = {
      ...(input.agentId === undefined ? {} : { agent_id: input.agentId }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.withdrawalNo === undefined ? {} : { withdrawal_no: input.withdrawalNo }),
      ...(input.minAmount === undefined && input.maxAmount === undefined
        ? {}
        : {
            amount: {
              ...(input.minAmount === undefined ? {} : { gte: input.minAmount }),
              ...(input.maxAmount === undefined ? {} : { lte: input.maxAmount }),
            },
          }),
      ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined
        ? {}
        : {
            created_at: {
              ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
              ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
            },
          }),
    };
    return this.prisma.$transaction(async (transaction) => {
      const [records, total] = await Promise.all([
        transaction.withdrawal.findMany({
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          select: WITHDRAWAL_SELECT,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.withdrawal.count({ where }),
      ]);
      return { items: records.map(withdrawalSnapshot), total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getWithdrawal(input: { withdrawalId: string }): Promise<AdminWithdrawalSnapshot> {
    assertUlid(input.withdrawalId, 'Withdrawal ID');
    const record = await this.prisma.withdrawal.findUnique({
      select: WITHDRAWAL_SELECT,
      where: { id: input.withdrawalId },
    });
    if (!record) throw notFound();
    return withdrawalSnapshot(record);
  }

  async getWithdrawalInTransaction(
    transaction: DatabaseTransaction,
    input: { withdrawalId: string },
  ): Promise<AdminWithdrawalSnapshot> {
    assertUlid(input.withdrawalId, 'Withdrawal ID');
    return withdrawalSnapshot(await this.readWithdrawal(transaction, input.withdrawalId));
  }

  async getActionImpactInTransaction(
    transaction: DatabaseTransaction,
    input: AdminWithdrawalActionImpactInput,
  ): Promise<AdminWithdrawalActionImpact> {
    assertUlid(input.actorAccountId, 'Withdrawal actor ID');
    assertUlid(input.withdrawalId, 'Withdrawal ID');
    if (input.action === 'REJECT') boundedText(input.reason, 2, 500, 'Withdrawal rejection reason');
    const proofFileIds = input.action === 'MARK_PAID' ? normalizeFileIds(input.proofFileIds) : [];
    await this.assertActor(transaction, input.actorAccountId, false);
    const locked = await this.lockEnvelope(transaction, input.withdrawalId);
    const snapshot = withdrawalSnapshot(locked.record);
    if (input.action === 'MARK_PAID') {
      await this.prepareProofBindings(transaction, input.actorAccountId, input.withdrawalId, proofFileIds, false);
    }
    return this.buildImpact(input.action, snapshot, locked.wallet, proofFileIds);
  }

  async approveInTransaction(
    transaction: DatabaseTransaction,
    input: AdminWithdrawalCommandInput,
    hooks: AdminWithdrawalPreviewHooks,
  ): Promise<AdminWithdrawalMutationResult> {
    validateCommand(input);
    this.assertPreviewHooks(hooks);
    await this.assertActor(transaction, input.actorAccountId, true);
    const locked = await this.lockEnvelope(transaction, input.withdrawalId);
    const before = withdrawalSnapshot(locked.record);
    this.assertVersionAndState(before, input.expectedVersion, 'PENDING');
    const impact = this.buildImpact('APPROVE', before, locked.wallet, []);
    await hooks.verifyPreview(impact);
    const occurredAt = await this.mutationTime(transaction, input.withdrawalId);
    const changed = await transaction.withdrawal.updateMany({
      data: {
        reviewed_at: occurredAt,
        reviewed_by_id: input.actorAccountId,
        status: 'APPROVED',
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: { id: input.withdrawalId, status: 'PENDING', version: input.expectedVersion },
    });
    if (changed.count !== 1) throw versionConflict();
    return this.mutationResult(transaction, 'APPROVE', before, locked.wallet, occurredAt, false);
  }

  async rejectInTransaction(
    transaction: DatabaseTransaction,
    input: RejectAdminWithdrawalInput,
    hooks: AdminWithdrawalPreviewHooks,
  ): Promise<AdminWithdrawalMutationResult> {
    validateCommand(input);
    const reason = boundedText(input.reason, 2, 500, 'Withdrawal rejection reason');
    this.assertPreviewHooks(hooks);
    await this.assertActor(transaction, input.actorAccountId, true);
    const locked = await this.lockEnvelope(transaction, input.withdrawalId);
    const before = withdrawalSnapshot(locked.record);
    this.assertVersionAndState(before, input.expectedVersion, 'PENDING');
    const impact = this.buildImpact('REJECT', before, locked.wallet, []);
    await hooks.verifyPreview(impact);
    const occurredAt = await this.mutationTime(transaction, before.withdrawalId);
    const amount = new Prisma.Decimal(before.amount);
    const availableAfter = locked.wallet.available_balance.add(amount);
    const frozenAfter = locked.wallet.frozen_balance.sub(amount);
    if (frozenAfter.isNegative()) throw internal('Stored Agent frozen balance is insufficient');
    const changed = await transaction.withdrawal.updateMany({
      data: {
        review_reason: reason,
        reviewed_at: occurredAt,
        reviewed_by_id: input.actorAccountId,
        status: 'REJECTED',
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: { id: input.withdrawalId, status: 'PENDING', version: input.expectedVersion },
    });
    if (changed.count !== 1) throw versionConflict();
    await transaction.commissionLedger.create({
      data: {
        agent_id: before.agentId,
        available_change: amount,
        expected_change: 0,
        frozen_change: amount.negated(),
        id: generateUlid(occurredAt.getTime()),
        idempotency_key: `withdrawal:${before.withdrawalId}:release`,
        ledger_type: 'WITHDRAWAL_RELEASE',
        occurred_at: occurredAt,
        reason: 'WITHDRAWAL_REJECTED',
        withdrawal_id: before.withdrawalId,
      },
    });
    await this.updateWallet(transaction, locked.wallet, availableAfter, frozenAfter, occurredAt);
    return this.mutationResult(transaction, 'REJECT', before, locked.wallet, occurredAt, true);
  }

  async bindProofsInTransaction(
    transaction: DatabaseTransaction,
    input: BindAdminWithdrawalProofsInput,
  ): Promise<BindAdminWithdrawalProofsResult> {
    assertUlid(input.actorAccountId, 'Withdrawal actor ID');
    assertUlid(input.withdrawalId, 'Withdrawal ID');
    const fileIds = normalizeFileIds(input.fileIds);
    await this.assertActor(transaction, input.actorAccountId, true);
    const locked = await this.lockEnvelope(transaction, input.withdrawalId);
    const before = withdrawalSnapshot(locked.record);
    if (before.status !== 'APPROVED') throw stateConflict('Payment proofs require an approved withdrawal');
    const missing = await this.prepareProofBindings(
      transaction,
      input.actorAccountId,
      input.withdrawalId,
      fileIds,
      true,
    );
    if (missing.length === 0) return { before, after: before, changed: false, occurredAt: null };
    const occurredAt = await this.mutationTime(transaction, before.withdrawalId);
    await transaction.withdrawalProof.createMany({
      data: missing.map((fileId) => ({
        created_at: occurredAt,
        file_id: fileId,
        id: generateUlid(occurredAt.getTime()),
        withdrawal_id: input.withdrawalId,
      })),
    });
    const changed = await transaction.withdrawal.updateMany({
      data: { updated_at: occurredAt, version: { increment: 1 } },
      where: { id: input.withdrawalId, status: 'APPROVED', version: before.version },
    });
    if (changed.count !== 1) throw versionConflict();
    return {
      before,
      after: await this.reloadSnapshot(transaction, input.withdrawalId),
      changed: true,
      occurredAt,
    };
  }

  async markPaidInTransaction(
    transaction: DatabaseTransaction,
    input: MarkAdminWithdrawalPaidInput,
    hooks: AdminWithdrawalPreviewHooks,
  ): Promise<AdminWithdrawalMutationResult> {
    validateCommand(input);
    const proofFileIds = normalizeFileIds(input.proofFileIds);
    this.assertPreviewHooks(hooks);
    await this.assertActor(transaction, input.actorAccountId, true);
    const locked = await this.lockEnvelope(transaction, input.withdrawalId);
    const before = withdrawalSnapshot(locked.record);
    this.assertVersionAndState(before, input.expectedVersion, 'APPROVED');
    const missing = await this.prepareProofBindings(
      transaction,
      input.actorAccountId,
      input.withdrawalId,
      proofFileIds,
      true,
    );
    const impact = this.buildImpact('MARK_PAID', before, locked.wallet, proofFileIds);
    await hooks.verifyPreview(impact);
    const occurredAt = await this.mutationTime(transaction, before.withdrawalId);
    if (missing.length > 0) {
      await transaction.withdrawalProof.createMany({
        data: missing.map((fileId) => ({
          created_at: occurredAt,
          file_id: fileId,
          id: generateUlid(occurredAt.getTime()),
          withdrawal_id: input.withdrawalId,
        })),
      });
    }
    const amount = new Prisma.Decimal(before.amount);
    const frozenAfter = locked.wallet.frozen_balance.sub(amount);
    if (frozenAfter.isNegative()) throw internal('Stored Agent frozen balance is insufficient');
    const changed = await transaction.withdrawal.updateMany({
      data: {
        paid_at: occurredAt,
        paid_by_id: input.actorAccountId,
        status: 'PAID',
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: { id: input.withdrawalId, status: 'APPROVED', version: input.expectedVersion },
    });
    if (changed.count !== 1) throw versionConflict();
    await transaction.commissionLedger.create({
      data: {
        agent_id: before.agentId,
        available_change: 0,
        expected_change: 0,
        frozen_change: amount.negated(),
        id: generateUlid(occurredAt.getTime()),
        idempotency_key: `withdrawal:${before.withdrawalId}:paid`,
        ledger_type: 'WITHDRAWAL_PAID',
        occurred_at: occurredAt,
        reason: 'WITHDRAWAL_PAID',
        withdrawal_id: before.withdrawalId,
      },
    });
    await this.updateWallet(
      transaction,
      locked.wallet,
      locked.wallet.available_balance,
      frozenAfter,
      occurredAt,
    );
    return this.mutationResult(transaction, 'MARK_PAID', before, locked.wallet, occurredAt, true);
  }

  async consumePayoutAccountRevealInTransaction(
    transaction: DatabaseTransaction,
    input: ConsumePayoutAccountRevealInput,
    hooks: AdminWithdrawalRevealHooks,
  ): Promise<AdminWithdrawalPayoutAccountMaterial> {
    validateCommand(input);
    if (!hooks || typeof hooks.consumeGrant !== 'function') {
      throw new TypeError('Payout account reveal grant consumer is required');
    }
    await this.assertActor(transaction, input.actorAccountId, true);
    const locked = await this.lockEnvelope(transaction, input.withdrawalId);
    const withdrawal = withdrawalSnapshot(locked.record);
    this.assertVersionAndState(withdrawal, input.expectedVersion, 'APPROVED');
    const grant = await hooks.consumeGrant();
    assertUlid(grant.grantId, 'Consumed payout reveal grant ID');
    const grantExpiresAt = safeDate(grant.expiresAt, 'Consumed payout reveal grant expiry');
    const snapshot = await transaction.withdrawalBankSnapshot.findUnique({
      select: PAYOUT_ACCOUNT_SELECT,
      where: { withdrawal_id: input.withdrawalId },
    });
    if (!snapshot || snapshot.withdrawal_id !== input.withdrawalId ||
      snapshot.source_bank_account_id === null || !isValidUlid(snapshot.source_bank_account_id) ||
      !(snapshot.account_no_ciphertext instanceof Uint8Array) || snapshot.account_no_ciphertext.byteLength < 1 ||
      !KEY_ID.test(snapshot.encryption_key_id) || !/^[0-9]{4}$/.test(snapshot.account_no_last4)) {
      throw internal('Stored withdrawal payout account snapshot is inconsistent');
    }
    return {
      withdrawalId: input.withdrawalId,
      version: withdrawal.version,
      accountHolder: storedText(snapshot.account_holder, 2, 120, 'Stored account holder'),
      bankName: storedText(snapshot.bank_name, 2, 160, 'Stored bank name'),
      last4: snapshot.account_no_last4,
      ciphertext: Uint8Array.from(snapshot.account_no_ciphertext),
      encryptionKeyId: snapshot.encryption_key_id,
      sourceBankAccountId: snapshot.source_bank_account_id,
      snapshotAt: safeDate(snapshot.created_at, 'Stored bank snapshot time'),
      grantId: grant.grantId,
      grantExpiresAt,
    };
  }

  private async assertActor(
    transaction: DatabaseTransaction,
    actorAccountId: string,
    lock: boolean,
  ): Promise<void> {
    if (lock) {
      await acquireTransactionLock(transaction, 'admin-auth-account', [actorAccountId]);
      await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [actorAccountId]);
    }
    const rows = await transaction.$queryRaw<Array<{
      deleted_at: Date | null;
      has_password: boolean;
      id: string;
      role: string;
      status: string;
    }>>(lock ? Prisma.sql`
      SELECT id, role::text, status::text, deleted_at, password_hash IS NOT NULL AS has_password
      FROM public.account WHERE id = ${actorAccountId} FOR UPDATE
    ` : Prisma.sql`
      SELECT id, role::text, status::text, deleted_at, password_hash IS NOT NULL AS has_password
      FROM public.account WHERE id = ${actorAccountId}
    `);
    const actor = rows[0];
    if (rows.length !== 1 || actor?.id !== actorAccountId || actor.role !== 'SUPER_ADMIN' ||
      actor.status !== 'ACTIVE' || actor.deleted_at !== null || actor.has_password !== true) {
      throw new ApplicationError('AUTH_REQUIRED', 'Active SUPER_ADMIN account is required');
    }
  }

  private async mutationTime(transaction: DatabaseTransaction, withdrawalId: string): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ id: string; mutation_time: Date }>>(Prisma.sql`
      SELECT id, GREATEST(
        transaction_timestamp(), created_at, updated_at, COALESCE(reviewed_at, created_at)
      ) AS mutation_time
      FROM public.withdrawal
      WHERE id = ${withdrawalId}
    `);
    if (rows.length !== 1 || rows[0]?.id !== withdrawalId) throw notFound();
    return safeDate(rows[0].mutation_time, 'Database withdrawal mutation time');
  }

  private async readWithdrawal(transaction: DatabaseTransaction, withdrawalId: string): Promise<WithdrawalRecord> {
    const record = await transaction.withdrawal.findUnique({
      select: WITHDRAWAL_SELECT,
      where: { id: withdrawalId },
    });
    if (!record) throw notFound();
    return record;
  }

  private async reloadSnapshot(
    transaction: DatabaseTransaction,
    withdrawalId: string,
  ): Promise<AdminWithdrawalSnapshot> {
    return withdrawalSnapshot(await this.readWithdrawal(transaction, withdrawalId));
  }

  private async lockEnvelope(transaction: DatabaseTransaction, withdrawalId: string) {
    const identity = await transaction.withdrawal.findUnique({
      select: { agent_id: true, id: true },
      where: { id: withdrawalId },
    });
    if (!identity || identity.id !== withdrawalId || !isValidUlid(identity.agent_id)) throw notFound();
    await acquireTransactionLock(transaction, 'store-attribution-agent', [identity.agent_id]);
    const agents = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.agent_profile WHERE id = ${identity.agent_id} FOR UPDATE
    `);
    if (agents.length !== 1 || agents[0]?.id !== identity.agent_id) throw notFound();
    const wallet = await lockReconciledAgentWalletInTransaction(transaction, identity.agent_id);
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.withdrawal WHERE id = ${withdrawalId} FOR UPDATE
    `);
    if (rows.length !== 1 || rows[0]?.id !== withdrawalId) throw notFound();
    const record = await this.readWithdrawal(transaction, withdrawalId);
    if (record.agent_id !== identity.agent_id) throw internal('Stored withdrawal Agent changed while locking');
    return { record, wallet };
  }

  private assertVersionAndState(
    withdrawal: AdminWithdrawalSnapshot,
    expectedVersion: number,
    expectedStatus: 'APPROVED' | 'PENDING',
  ): void {
    if (withdrawal.version !== expectedVersion) throw versionConflict();
    if (withdrawal.status !== expectedStatus) {
      throw stateConflict(`Withdrawal must be ${expectedStatus} for this operation`);
    }
  }

  private assertPreviewHooks(hooks: AdminWithdrawalPreviewHooks): void {
    if (!hooks || typeof hooks.verifyPreview !== 'function') {
      throw new TypeError('Withdrawal high-risk preview verifier is required');
    }
  }

  private buildImpact(
    action: AdminWithdrawalAction,
    withdrawal: AdminWithdrawalSnapshot,
    wallet: { available_balance: Prisma.Decimal; frozen_balance: Prisma.Decimal },
    requestedProofFileIds: readonly string[],
  ): AdminWithdrawalActionImpact {
    const amount = new Prisma.Decimal(withdrawal.amount);
    const availableBefore = walletMoney(wallet.available_balance, 'Stored Agent available balance');
    const frozenBefore = walletMoney(wallet.frozen_balance, 'Stored Agent frozen balance');
    let availableAfter = availableBefore;
    let frozenAfter = frozenBefore;
    let resultingStatus: WithdrawalStatus;
    if (action === 'APPROVE') {
      if (withdrawal.status !== 'PENDING') throw stateConflict('Only a pending withdrawal can be approved');
      resultingStatus = 'APPROVED';
    } else if (action === 'REJECT') {
      if (withdrawal.status !== 'PENDING') throw stateConflict('Only a pending withdrawal can be rejected');
      availableAfter = availableBefore.add(amount);
      frozenAfter = frozenBefore.sub(amount);
      resultingStatus = 'REJECTED';
    } else {
      if (withdrawal.status !== 'APPROVED') throw stateConflict('Only an approved withdrawal can be paid');
      frozenAfter = frozenBefore.sub(amount);
      resultingStatus = 'PAID';
    }
    if (frozenAfter.isNegative()) throw internal('Stored Agent frozen balance is insufficient');
    return {
      action,
      withdrawal,
      resourceVersion: withdrawal.version,
      resultingStatus,
      proofFileIds: action === 'MARK_PAID'
        ? [...new Set([...withdrawal.proofFileIds, ...requestedProofFileIds])].sort()
        : [],
      walletAvailableBefore: availableBefore.toFixed(2),
      walletAvailableAfter: availableAfter.toFixed(2),
      walletFrozenBefore: frozenBefore.toFixed(2),
      walletFrozenAfter: frozenAfter.toFixed(2),
    };
  }

  private async prepareProofBindings(
    transaction: DatabaseTransaction,
    actorAccountId: string,
    withdrawalId: string,
    fileIds: readonly string[],
    lock: boolean,
  ): Promise<string[]> {
    if (lock) {
      for (const fileId of fileIds) await acquireTransactionLock(transaction, 'file-asset', [fileId]);
      await transaction.$queryRaw(Prisma.sql`
        SELECT id FROM public.file_asset
        WHERE id IN (${Prisma.join(fileIds)})
        ORDER BY id ASC FOR UPDATE
      `);
    }
    const files = await transaction.fileAsset.findMany({
      orderBy: { id: 'asc' },
      select: PROOF_FILE_SELECT,
      where: { id: { in: [...fileIds] } },
    });
    if (files.length !== fileIds.length) throw notFound('Withdrawal proof file was not found');
    const missing: string[] = [];
    for (const file of files) {
      const existingHere = file.withdrawal_proofs.some((proof) => proof.withdrawal_id === withdrawalId);
      this.assertProofFile(file, actorAccountId, withdrawalId, existingHere);
      if (!existingHere) missing.push(file.id);
    }
    return missing;
  }

  private assertProofFile(
    file: ProofFileRecord,
    actorAccountId: string,
    withdrawalId: string,
    existingHere: boolean,
  ): void {
    const otherAttachmentCount = Object.values(file._count).reduce((sum, count) => sum + count, 0);
    if (file.status !== 'READY' || file.visibility !== 'PRIVATE' || file.purpose !== 'WITHDRAWAL_PROOF' ||
      file.deleted_at !== null || file.object_key !== buildFinalObjectKey(file.id, 'WITHDRAWAL_PROOF') ||
      file.withdrawal_proofs.some((proof) => proof.withdrawal_id !== withdrawalId) || otherAttachmentCount !== 0 ||
      (!existingHere && file.created_by_id !== actorAccountId)) {
      throw stateConflict('Withdrawal proof file is unavailable for this operation');
    }
  }

  private async updateWallet(
    transaction: DatabaseTransaction,
    wallet: { available_balance: Prisma.Decimal; frozen_balance: Prisma.Decimal; id: string; version: number },
    availableAfter: Prisma.Decimal,
    frozenAfter: Prisma.Decimal,
    occurredAt: Date,
  ): Promise<void> {
    const changed = await transaction.agentWallet.updateMany({
      data: {
        available_balance: availableAfter,
        frozen_balance: frozenAfter,
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: {
        available_balance: wallet.available_balance,
        frozen_balance: wallet.frozen_balance,
        id: wallet.id,
        version: wallet.version,
      },
    });
    if (changed.count !== 1) throw stateConflict('Agent wallet changed concurrently');
  }

  private async mutationResult(
    transaction: DatabaseTransaction,
    action: AdminWithdrawalAction,
    before: AdminWithdrawalSnapshot,
    wallet: { available_balance: Prisma.Decimal; frozen_balance: Prisma.Decimal; version: number },
    occurredAt: Date,
    walletChanged: boolean,
  ): Promise<AdminWithdrawalMutationResult> {
    const after = await this.reloadSnapshot(transaction, before.withdrawalId);
    const amount = new Prisma.Decimal(before.amount);
    const availableAfter = action === 'REJECT' ? wallet.available_balance.add(amount) : wallet.available_balance;
    const frozenAfter = action === 'APPROVE' ? wallet.frozen_balance : wallet.frozen_balance.sub(amount);
    return {
      action,
      before,
      after,
      wallet: walletMutation(wallet, availableAfter, frozenAfter, walletChanged),
      occurredAt,
    };
  }
}
