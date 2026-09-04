import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { WithdrawalStatus } from '../.generated/prisma/enums';
import { acquireTransactionLock } from './advisory-lock';
import { validateAgentCommissionLedgerClosureInTransaction } from './commission.repository';
import type { DatabaseTransaction } from './idempotency.repository';

export interface AgentFinanceIdentity {
  accountId: string;
  agentId: string;
}

export interface AgentBankAccountSnapshot {
  accountHolder: string;
  bankAccountId: string;
  bankName: string;
  isActive: boolean;
  last4: string;
  version: number;
}

export interface ReplaceAgentBankAccountInput extends AgentFinanceIdentity {
  accountHash: string;
  accountHashCandidates: readonly string[];
  accountHolder: string;
  bankAccountId: string;
  bankName: string;
  ciphertext: Uint8Array;
  encryptionKeyId: string;
  last4: string;
}

export interface ReplaceAgentBankAccountResult {
  bankAccount: AgentBankAccountSnapshot;
  changed: boolean;
}

export interface CreateAgentWithdrawalInput extends AgentFinanceIdentity {
  amount: string;
  bankAccountId: string;
  withdrawalId: string;
}

export interface AgentWithdrawalListInput extends AgentFinanceIdentity {
  createdAtFrom?: Date;
  createdAtToExclusive?: Date;
  maxAmount?: string;
  minAmount?: string;
  page: number;
  pageSize: number;
  status?: WithdrawalStatus;
  withdrawalNo?: string;
}

export interface AgentWithdrawalReadInput extends AgentFinanceIdentity {
  withdrawalId: string;
}

export interface AgentWithdrawalSnapshot {
  amount: string;
  bankAccountLast4: string;
  createdAt: Date;
  paidAt: Date | null;
  proofFileIds: string[];
  reviewReason: string | null;
  reviewedAt: Date | null;
  status: WithdrawalStatus;
  version: number;
  withdrawalId: string;
  withdrawalNo: string;
}

export interface AgentWithdrawalListResult {
  items: AgentWithdrawalSnapshot[];
  total: number;
}

const AGENT_SELECT = {
  account: { select: { deleted_at: true, id: true, role: true, status: true } },
  account_id: true,
  deleted_at: true,
  id: true,
  status: true,
  version: true,
} satisfies Prisma.AgentProfileSelect;

const BANK_SELECT = {
  account_holder: true,
  account_no_ciphertext: true,
  account_no_hash: true,
  account_no_last4: true,
  agent_id: true,
  bank_name: true,
  created_at: true,
  deleted_at: true,
  encryption_key_id: true,
  id: true,
  is_active: true,
  updated_at: true,
  version: true,
} satisfies Prisma.AgentBankAccountSelect;

const WITHDRAWAL_SELECT = {
  agent_id: true,
  amount: true,
  bank_snapshot: {
    select: {
      account_no_last4: true,
      source_bank_account_id: true,
      withdrawal_id: true,
    },
  },
  created_at: true,
  id: true,
  paid_at: true,
  proofs: {
    orderBy: [{ created_at: 'asc' as const }, { id: 'asc' as const }],
    select: { file_id: true, withdrawal_id: true },
  },
  review_reason: true,
  reviewed_at: true,
  status: true,
  version: true,
  withdrawal_no: true,
} satisfies Prisma.WithdrawalSelect;

type AgentRecord = Prisma.AgentProfileGetPayload<{ select: typeof AGENT_SELECT }>;
type BankRecord = Prisma.AgentBankAccountGetPayload<{ select: typeof BANK_SELECT }>;
type WithdrawalRecord = Prisma.WithdrawalGetPayload<{ select: typeof WITHDRAWAL_SELECT }>;

const HEX_64 = /^[a-f0-9]{64}$/;
const KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;
const MONEY = /^(?:0\.(?:0[1-9]|[1-9][0-9])|[1-9][0-9]{0,15}\.[0-9]{2})$/;
const NON_NEGATIVE_MONEY = /^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/;
const MAX_INTEGER = 2_147_483_647;
const MAX_MONEY = new Prisma.Decimal('9999999999999999.99');
const WITHDRAWAL_STATUS = new Set<WithdrawalStatus>(['APPROVED', 'PAID', 'PENDING', 'REJECTED']);

function internal(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

function notFound(message: string): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', message);
}

function validateIdentity(identity: AgentFinanceIdentity): void {
  if (!isValidUlid(identity.accountId) || !isValidUlid(identity.agentId) || identity.accountId === identity.agentId) {
    throw new TypeError('Agent finance identity is invalid');
  }
}

function boundedText(value: string, minimum: number, maximum: number, label: string): void {
  if (typeof value !== 'string' || value.trim() !== value || /\p{Cc}/u.test(value) ||
    Array.from(value).length < minimum || Array.from(value).length > maximum) {
    throw new TypeError(`${label} is invalid`);
  }
}

function positiveMoney(value: string, label: string): Prisma.Decimal {
  if (typeof value !== 'string' || !MONEY.test(value)) throw new TypeError(`${label} is invalid`);
  const amount = new Prisma.Decimal(value);
  if (!amount.isPositive() || amount.greaterThan(MAX_MONEY)) throw new TypeError(`${label} is invalid`);
  return amount;
}

function nonNegativeMoney(value: string, label: string): Prisma.Decimal {
  if (typeof value !== 'string' || !NON_NEGATIVE_MONEY.test(value)) throw new TypeError(`${label} is invalid`);
  const amount = new Prisma.Decimal(value);
  if (amount.greaterThan(MAX_MONEY)) throw new TypeError(`${label} is invalid`);
  return amount;
}

function validateBankInput(input: ReplaceAgentBankAccountInput): void {
  validateIdentity(input);
  if (!isValidUlid(input.bankAccountId)) throw new TypeError('Bank account ID is invalid');
  boundedText(input.accountHolder, 2, 120, 'Bank account holder');
  boundedText(input.bankName, 2, 160, 'Bank name');
  if (!(input.ciphertext instanceof Uint8Array) || input.ciphertext.byteLength < 1 || input.ciphertext.byteLength > 4_096 ||
    !HEX_64.test(input.accountHash) || !/^[0-9]{4}$/.test(input.last4) || !KEY_ID.test(input.encryptionKeyId) ||
    !Array.isArray(input.accountHashCandidates) || input.accountHashCandidates.length < 1 ||
    input.accountHashCandidates.length > 4 || !input.accountHashCandidates.includes(input.accountHash) ||
    new Set(input.accountHashCandidates).size !== input.accountHashCandidates.length ||
    input.accountHashCandidates.some((hash) => !HEX_64.test(hash))) {
    throw new TypeError('Bank account security material is invalid');
  }
}

function validateWithdrawalCreate(input: CreateAgentWithdrawalInput): Prisma.Decimal {
  validateIdentity(input);
  if (!isValidUlid(input.bankAccountId) || !isValidUlid(input.withdrawalId)) {
    throw new TypeError('Withdrawal resource ID is invalid');
  }
  return positiveMoney(input.amount, 'Withdrawal amount');
}

function validDate(value: Date | undefined, label: string): void {
  if (value !== undefined && (!(value instanceof Date) || !Number.isFinite(value.getTime()))) {
    throw new TypeError(`${label} is invalid`);
  }
}

function validateWithdrawalList(input: AgentWithdrawalListInput): void {
  validateIdentity(input);
  if (!Number.isSafeInteger(input.page) || input.page < 1 || !Number.isSafeInteger(input.pageSize) ||
    input.pageSize < 1 || input.pageSize > 100 || (input.page - 1) * input.pageSize > MAX_INTEGER) {
    throw new TypeError('Withdrawal pagination is invalid');
  }
  validDate(input.createdAtFrom, 'Withdrawal start date');
  validDate(input.createdAtToExclusive, 'Withdrawal end date');
  if (input.createdAtFrom && input.createdAtToExclusive &&
    input.createdAtFrom.getTime() >= input.createdAtToExclusive.getTime()) {
    throw new TypeError('Withdrawal date range is invalid');
  }
  if (input.withdrawalNo !== undefined) boundedText(input.withdrawalNo, 1, 32, 'Withdrawal number');
  if (input.status !== undefined && !WITHDRAWAL_STATUS.has(input.status)) {
    throw new TypeError('Withdrawal status is invalid');
  }
  const minimum = input.minAmount === undefined ? undefined : nonNegativeMoney(input.minAmount, 'Minimum withdrawal filter');
  const maximum = input.maxAmount === undefined ? undefined : nonNegativeMoney(input.maxAmount, 'Maximum withdrawal filter');
  if (minimum && maximum && minimum.greaterThan(maximum)) throw new TypeError('Withdrawal amount range is invalid');
}

function safeVersion(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_INTEGER) throw internal(`${label} is invalid`);
  return value;
}

function safeDate(value: Date | null, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw internal(`${label} is invalid`);
  return new Date(value);
}

function nullableDate(value: Date | null, label: string): Date | null {
  return value === null ? null : safeDate(value, label);
}

function bankSnapshot(record: BankRecord, expectedAgentId: string): AgentBankAccountSnapshot {
  if (!isValidUlid(record.id) || record.agent_id !== expectedAgentId || !HEX_64.test(record.account_no_hash) ||
    !/^[0-9]{4}$/.test(record.account_no_last4) || !KEY_ID.test(record.encryption_key_id) ||
    !(record.account_no_ciphertext instanceof Uint8Array) || record.account_no_ciphertext.byteLength < 1 ||
    (record.is_active && record.deleted_at !== null)) {
    throw internal('Stored Agent bank account is inconsistent');
  }
  boundedText(record.account_holder, 2, 120, 'Stored bank account holder');
  boundedText(record.bank_name, 2, 160, 'Stored bank name');
  safeDate(record.created_at, 'Stored bank account creation time');
  safeDate(record.updated_at, 'Stored bank account update time');
  return {
    accountHolder: record.account_holder,
    bankAccountId: record.id,
    bankName: record.bank_name,
    isActive: record.is_active && record.deleted_at === null,
    last4: record.account_no_last4,
    version: safeVersion(record.version, 'Stored bank account version'),
  };
}

function withdrawalSnapshot(record: WithdrawalRecord, expectedAgentId: string): AgentWithdrawalSnapshot {
  if (!isValidUlid(record.id) || record.agent_id !== expectedAgentId || !WITHDRAWAL_STATUS.has(record.status) ||
    record.bank_snapshot === null || record.bank_snapshot.withdrawal_id !== record.id ||
    record.bank_snapshot.source_bank_account_id === null || !isValidUlid(record.bank_snapshot.source_bank_account_id) ||
    !/^[0-9]{4}$/.test(record.bank_snapshot.account_no_last4) ||
    record.proofs.some((proof) => proof.withdrawal_id !== record.id || !isValidUlid(proof.file_id))) {
    throw internal('Stored Agent withdrawal is inconsistent');
  }
  boundedText(record.withdrawal_no, 1, 32, 'Stored withdrawal number');
  const amount = positiveMoney(record.amount.toFixed(2), 'Stored withdrawal amount');
  return {
    amount: amount.toFixed(2),
    bankAccountLast4: record.bank_snapshot.account_no_last4,
    createdAt: safeDate(record.created_at, 'Stored withdrawal creation time'),
    paidAt: nullableDate(record.paid_at, 'Stored withdrawal paid time'),
    proofFileIds: record.proofs.map(({ file_id: fileId }) => fileId),
    reviewReason: record.review_reason,
    reviewedAt: nullableDate(record.reviewed_at, 'Stored withdrawal reviewed time'),
    status: record.status,
    version: safeVersion(record.version, 'Stored withdrawal version'),
    withdrawalId: record.id,
    withdrawalNo: record.withdrawal_no,
  };
}

export async function lockReconciledAgentWalletInTransaction(
  transaction: DatabaseTransaction,
  agentId: string,
) {
  if (!isValidUlid(agentId)) throw new TypeError('Agent wallet owner ID is invalid');
  await acquireTransactionLock(transaction, 'agent-wallet', [agentId]);
  const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id FROM public.agent_wallet WHERE agent_id = ${agentId} FOR UPDATE
  `);
  const wallet = await transaction.agentWallet.findUnique({ where: { agent_id: agentId } });
  if (locked.length !== 1 || wallet === null || locked[0]?.id !== wallet.id || wallet.agent_id !== agentId ||
    !isValidUlid(wallet.id)) throw internal('Stored Agent wallet is missing or inconsistent');
  await validateAgentCommissionLedgerClosureInTransaction(transaction, agentId);
  const [ledger, positions] = await Promise.all([
    transaction.commissionLedger.aggregate({
      _sum: { available_change: true, expected_change: true, frozen_change: true },
      where: { agent_id: agentId },
    }),
    transaction.orderItemCommissionPosition.aggregate({
      _sum: { expected_remaining: true },
      where: { snapshot: { agent_id: agentId } },
    }),
  ]);
  const ledgerAvailable = ledger._sum.available_change ?? new Prisma.Decimal(0);
  const ledgerFrozen = ledger._sum.frozen_change ?? new Prisma.Decimal(0);
  const ledgerExpected = ledger._sum.expected_change ?? new Prisma.Decimal(0);
  const positionExpected = positions._sum.expected_remaining ?? new Prisma.Decimal(0);
  if (!wallet.available_balance.equals(ledgerAvailable) || !wallet.frozen_balance.equals(ledgerFrozen) ||
    !ledgerExpected.equals(positionExpected) || wallet.frozen_balance.isNegative() || ledgerExpected.isNegative()) {
    throw internal('Stored Agent wallet and commission ledger do not reconcile');
  }
  return wallet;
}

export class AgentFinanceRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Agent finance repository clock must return a valid Date');
    }
    return new Date(value);
  }

  private activeAgent(record: AgentRecord | null, identity: AgentFinanceIdentity): AgentRecord {
    if (!record || record.id !== identity.agentId || record.account_id !== identity.accountId ||
      record.deleted_at !== null || record.status !== 'ACTIVE' || record.version < 1 ||
      record.account.id !== identity.accountId || record.account.deleted_at !== null ||
      record.account.role !== 'AGENT_ADMIN' || record.account.status !== 'ACTIVE') {
      throw notFound('Active Agent does not exist');
    }
    return record;
  }

  private async readActiveAgent(
    transaction: DatabaseTransaction,
    identity: AgentFinanceIdentity,
  ): Promise<AgentRecord> {
    validateIdentity(identity);
    return this.activeAgent(await transaction.agentProfile.findUnique({
      select: AGENT_SELECT,
      where: { id: identity.agentId },
    }), identity);
  }

  private async lockActiveAgent(
    transaction: DatabaseTransaction,
    identity: AgentFinanceIdentity,
  ): Promise<AgentRecord> {
    validateIdentity(identity);
    await acquireTransactionLock(transaction, 'store-attribution-agent', [identity.agentId]);
    const profiles = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.agent_profile WHERE id = ${identity.agentId} FOR UPDATE
    `);
    if (profiles.length !== 1 || profiles[0]?.id !== identity.agentId) throw notFound('Active Agent does not exist');
    await this.readActiveAgent(transaction, identity);
    await acquireTransactionLock(transaction, 'agent-auth-account', [identity.accountId]);
    const accounts = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id FROM public.account WHERE id = ${identity.accountId} FOR UPDATE
    `);
    if (accounts.length !== 1 || accounts[0]?.id !== identity.accountId) throw notFound('Active Agent does not exist');
    return this.readActiveAgent(transaction, identity);
  }

  private async lockBankAccounts(transaction: DatabaseTransaction, agentId: string): Promise<void> {
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.agent_bank_account
      WHERE agent_id = ${agentId}
      ORDER BY id ASC FOR UPDATE
    `);
  }

  async listBankAccounts(identity: AgentFinanceIdentity): Promise<AgentBankAccountSnapshot[]> {
    validateIdentity(identity);
    return this.prisma.$transaction(async (transaction) => {
      await this.readActiveAgent(transaction, identity);
      const accounts = await transaction.agentBankAccount.findMany({
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        select: BANK_SELECT,
        where: { agent_id: identity.agentId, deleted_at: null, is_active: true },
      });
      return accounts.map((account) => bankSnapshot(account, identity.agentId));
    }, { isolationLevel: 'RepeatableRead' });
  }

  async replaceBankAccountInTransaction(
    transaction: DatabaseTransaction,
    input: ReplaceAgentBankAccountInput,
  ): Promise<ReplaceAgentBankAccountResult> {
    validateBankInput(input);
    await this.lockActiveAgent(transaction, input);
    await this.lockBankAccounts(transaction, input.agentId);
    const current = await transaction.agentBankAccount.findFirst({
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      select: BANK_SELECT,
      where: { agent_id: input.agentId, deleted_at: null, is_active: true },
    });
    if (current && input.accountHashCandidates.includes(current.account_no_hash) &&
      current.account_holder === input.accountHolder && current.bank_name === input.bankName) {
      return { bankAccount: bankSnapshot(current, input.agentId), changed: false };
    }
    const changedAt = this.currentTime();
    if (current) {
      const deactivated = await transaction.agentBankAccount.updateMany({
        data: { deleted_at: changedAt, is_active: false, updated_at: changedAt, version: { increment: 1 } },
        where: { deleted_at: null, id: current.id, is_active: true, version: current.version },
      });
      if (deactivated.count !== 1) throw new ApplicationError('STATE_CONFLICT', 'Active bank account changed');
    }
    let created: BankRecord;
    try {
      created = await transaction.agentBankAccount.create({
        data: {
          account_holder: input.accountHolder,
          account_no_ciphertext: Buffer.from(input.ciphertext),
          account_no_hash: input.accountHash,
          account_no_last4: input.last4,
          agent_id: input.agentId,
          bank_name: input.bankName,
          created_at: changedAt,
          deleted_at: null,
          encryption_key_id: input.encryptionKeyId,
          id: input.bankAccountId,
          is_active: true,
          updated_at: changedAt,
          version: 1,
        },
        select: BANK_SELECT,
      });
    } catch (cause) {
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw new ApplicationError('STATE_CONFLICT', 'Bank account changed concurrently');
      }
      throw cause;
    }
    return { bankAccount: bankSnapshot(created, input.agentId), changed: true };
  }

  async createWithdrawalInTransaction(
    transaction: DatabaseTransaction,
    input: CreateAgentWithdrawalInput,
  ): Promise<AgentWithdrawalSnapshot> {
    const amount = validateWithdrawalCreate(input);
    await this.lockActiveAgent(transaction, input);
    await acquireTransactionLock(transaction, 'business-rule-config', ['singleton']);
    const rules = await transaction.$queryRaw<Array<{ id: string; minimum_withdrawal_amount: Prisma.Decimal }>>(Prisma.sql`
      SELECT id, minimum_withdrawal_amount FROM public.business_rule_version
      WHERE status = 'PUBLISHED' AND effective_at IS NOT NULL
        AND effective_at <= transaction_timestamp()
      ORDER BY effective_at DESC, version_no DESC, id DESC
      LIMIT 2 FOR UPDATE
    `);
    if (rules.length !== 1 || !rules[0] || !isValidUlid(rules[0].id) ||
      !Prisma.Decimal.isDecimal(rules[0].minimum_withdrawal_amount) ||
      !rules[0].minimum_withdrawal_amount.isPositive()) {
      throw new ApplicationError('STATE_CONFLICT', 'Published withdrawal rule is unavailable');
    }
    const wallet = await lockReconciledAgentWalletInTransaction(transaction, input.agentId);
    await this.lockBankAccounts(transaction, input.agentId);
    await transaction.$queryRaw(Prisma.sql`
      SELECT id FROM public.withdrawal
      WHERE agent_id = ${input.agentId} AND status IN ('PENDING', 'APPROVED')
      ORDER BY id ASC FOR UPDATE
    `);
    const [bank, inflight] = await Promise.all([
      transaction.agentBankAccount.findUnique({ select: BANK_SELECT, where: { id: input.bankAccountId } }),
      transaction.withdrawal.findFirst({
        select: { id: true },
        where: { agent_id: input.agentId, status: { in: ['PENDING', 'APPROVED'] } },
      }),
    ]);
    if (!bank || bank.agent_id !== input.agentId || !bank.is_active || bank.deleted_at !== null) {
      throw notFound('Active Agent bank account does not exist');
    }
    bankSnapshot(bank, input.agentId);
    if (inflight) throw new ApplicationError('WITHDRAWAL_IN_PROGRESS', 'Agent already has an in-flight withdrawal');
    if (amount.lessThan(rules[0].minimum_withdrawal_amount)) {
      throw new ApplicationError('WITHDRAWAL_MINIMUM_NOT_MET', 'Withdrawal amount is below the published minimum');
    }
    if (wallet.available_balance.isNegative() || amount.greaterThan(wallet.available_balance)) {
      throw new ApplicationError('WITHDRAWAL_BALANCE_INSUFFICIENT', 'Available Agent balance is insufficient');
    }

    const occurredAt = this.currentTime();
    const frozenAfter = wallet.frozen_balance.add(amount);
    const availableAfter = wallet.available_balance.sub(amount);
    const withdrawalNo = `WD${input.withdrawalId}`;
    try {
      await transaction.withdrawal.create({
        data: {
          agent_id: input.agentId,
          amount,
          available_before: wallet.available_balance,
          created_at: occurredAt,
          frozen_after: frozenAfter,
          id: input.withdrawalId,
          status: 'PENDING',
          updated_at: occurredAt,
          version: 1,
          withdrawal_no: withdrawalNo,
        },
      });
      await transaction.withdrawalBankSnapshot.create({
        data: {
          account_holder: bank.account_holder,
          account_no_ciphertext: bank.account_no_ciphertext,
          account_no_last4: bank.account_no_last4,
          bank_name: bank.bank_name,
          created_at: occurredAt,
          encryption_key_id: bank.encryption_key_id,
          id: generateUlid(occurredAt.getTime()),
          source_bank_account_id: bank.id,
          withdrawal_id: input.withdrawalId,
        },
      });
      await transaction.commissionLedger.create({
        data: {
          agent_id: input.agentId,
          available_change: amount.negated(),
          expected_change: 0,
          frozen_change: amount,
          id: generateUlid(occurredAt.getTime()),
          idempotency_key: `withdrawal:${input.withdrawalId}:freeze`,
          ledger_type: 'WITHDRAWAL_FREEZE',
          occurred_at: occurredAt,
          reason: 'WITHDRAWAL_SUBMITTED',
          withdrawal_id: input.withdrawalId,
        },
      });
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
      if (changed.count !== 1) throw new ApplicationError('STATE_CONFLICT', 'Agent wallet changed concurrently');
    } catch (cause) {
      if (cause instanceof ApplicationError) throw cause;
      if (cause instanceof Prisma.PrismaClientKnownRequestError && cause.code === 'P2002') {
        throw new ApplicationError('WITHDRAWAL_IN_PROGRESS', 'Agent already has an in-flight withdrawal');
      }
      throw cause;
    }
    const created = await transaction.withdrawal.findUnique({ select: WITHDRAWAL_SELECT, where: { id: input.withdrawalId } });
    if (!created) throw internal('Created Agent withdrawal is unavailable');
    return withdrawalSnapshot(created, input.agentId);
  }

  async listWithdrawals(input: AgentWithdrawalListInput): Promise<AgentWithdrawalListResult> {
    validateWithdrawalList(input);
    const where: Prisma.WithdrawalWhereInput = {
      agent_id: input.agentId,
      ...(input.withdrawalNo === undefined ? {} : { withdrawal_no: input.withdrawalNo }),
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.createdAtFrom === undefined && input.createdAtToExclusive === undefined ? {} : {
        created_at: {
          ...(input.createdAtFrom === undefined ? {} : { gte: input.createdAtFrom }),
          ...(input.createdAtToExclusive === undefined ? {} : { lt: input.createdAtToExclusive }),
        },
      }),
      ...(input.minAmount === undefined && input.maxAmount === undefined ? {} : {
        amount: {
          ...(input.minAmount === undefined ? {} : { gte: input.minAmount }),
          ...(input.maxAmount === undefined ? {} : { lte: input.maxAmount }),
        },
      }),
    };
    return this.prisma.$transaction(async (transaction) => {
      await this.readActiveAgent(transaction, input);
      const [items, total] = await Promise.all([
        transaction.withdrawal.findMany({
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          select: WITHDRAWAL_SELECT,
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.withdrawal.count({ where }),
      ]);
      if (!Number.isSafeInteger(total) || total < 0 || total > MAX_INTEGER) {
        throw internal('Stored withdrawal count is invalid');
      }
      return { items: items.map((item) => withdrawalSnapshot(item, input.agentId)), total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getWithdrawal(input: AgentWithdrawalReadInput): Promise<AgentWithdrawalSnapshot> {
    validateIdentity(input);
    if (!isValidUlid(input.withdrawalId)) throw new TypeError('Withdrawal ID is invalid');
    return this.prisma.$transaction(async (transaction) => {
      await this.readActiveAgent(transaction, input);
      const withdrawal = await transaction.withdrawal.findFirst({
        select: WITHDRAWAL_SELECT,
        where: { agent_id: input.agentId, id: input.withdrawalId },
      });
      if (!withdrawal) throw notFound('Agent withdrawal does not exist');
      return withdrawalSnapshot(withdrawal, input.agentId);
    }, { isolationLevel: 'RepeatableRead' });
  }
}
