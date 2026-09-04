import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import {
  AgentFinanceRepository,
  type CreateAgentWithdrawalInput,
  type ReplaceAgentBankAccountInput,
} from './agent-finance.repository';
import type { DatabaseTransaction } from './idempotency.repository';

vi.mock('./advisory-lock', () => ({ acquireTransactionLock: vi.fn(async () => undefined) }));
vi.mock('./commission.repository', () => ({
  validateAgentCommissionLedgerClosureInTransaction: vi.fn(async () => undefined),
}));

const NOW = new Date('2026-09-04T01:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const accountId = id(-10_000);
const agentId = id(-9_000);
const otherAgentId = id(-8_000);
const walletId = id(-7_000);
const bankAccountId = id(-6_000);
const withdrawalId = id(-5_000);
const replacementBankAccountId = id(-4_000);

function activeAgent() {
  return {
    account: { deleted_at: null, id: accountId, role: 'AGENT_ADMIN', status: 'ACTIVE' },
    account_id: accountId,
    deleted_at: null,
    id: agentId,
    status: 'ACTIVE',
    version: 2,
  };
}

function bankRecord(overrides: Record<string, unknown> = {}) {
  return {
    account_holder: 'Alice Example',
    account_no_ciphertext: Buffer.from([1, 2, 3, 4]),
    account_no_hash: 'a'.repeat(64),
    account_no_last4: '4826',
    agent_id: agentId,
    bank_name: 'Example Bank',
    created_at: new Date(NOW.getTime() - 10_000),
    deleted_at: null,
    encryption_key_id: 'field-key-2026-09',
    id: bankAccountId,
    is_active: true,
    updated_at: new Date(NOW.getTime() - 10_000),
    version: 1,
    ...overrides,
  };
}

function bankInput(overrides: Partial<ReplaceAgentBankAccountInput> = {}): ReplaceAgentBankAccountInput {
  return {
    accountHash: 'b'.repeat(64),
    accountHashCandidates: ['b'.repeat(64)],
    accountHolder: 'Alice Example',
    accountId,
    agentId,
    bankAccountId: replacementBankAccountId,
    bankName: 'Example Bank',
    ciphertext: Uint8Array.from([5, 6, 7, 8]),
    encryptionKeyId: 'field-key-2026-09',
    last4: '0042',
    ...overrides,
  };
}

function withdrawalInput(overrides: Partial<CreateAgentWithdrawalInput> = {}): CreateAgentWithdrawalInput {
  return { accountId, agentId, amount: '25.00', bankAccountId, withdrawalId, ...overrides };
}

function withdrawalRecord(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: agentId,
    amount: new Prisma.Decimal('25.00'),
    bank_snapshot: {
      account_no_last4: '4826',
      source_bank_account_id: bankAccountId,
      withdrawal_id: withdrawalId,
    },
    created_at: NOW,
    id: withdrawalId,
    paid_at: null,
    proofs: [],
    review_reason: null,
    reviewed_at: null,
    status: 'PENDING',
    version: 1,
    withdrawal_no: `WD${withdrawalId}`,
    ...overrides,
  };
}

function prismaWith(transaction: Record<string, unknown>): PrismaClient {
  return {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => Promise<unknown>) =>
      work(transaction as unknown as DatabaseTransaction)),
  } as unknown as PrismaClient;
}

function lockedRows(...rows: unknown[]) {
  const query = vi.fn();
  for (const row of rows) query.mockResolvedValueOnce(row);
  return query;
}

function withdrawalHarness(options: {
  bank?: ReturnType<typeof bankRecord>;
  inflight?: { id: string } | null;
  minimum?: string;
} = {}) {
  const bank = options.bank ?? bankRecord();
  const wallet = {
    agent_id: agentId,
    available_balance: new Prisma.Decimal('100.00'),
    frozen_balance: new Prisma.Decimal('0.00'),
    id: walletId,
    updated_at: new Date(NOW.getTime() - 20_000),
    version: 4,
  };
  const transaction = {
    $queryRaw: lockedRows(
      [{ id: agentId }],
      [{ id: accountId }],
      [{ id: id(-3_000), minimum_withdrawal_amount: new Prisma.Decimal(options.minimum ?? '25.00') }],
      [{ id: walletId }],
      [],
      [],
    ),
    agentBankAccount: {
      findUnique: vi.fn(async () => bank),
    },
    agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
    agentWallet: {
      findUnique: vi.fn(async () => wallet),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    commissionLedger: {
      aggregate: vi.fn(async () => ({
        _sum: {
          available_change: new Prisma.Decimal('100.00'),
          expected_change: new Prisma.Decimal('0.00'),
          frozen_change: new Prisma.Decimal('0.00'),
        },
      })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    orderItemCommissionPosition: {
      aggregate: vi.fn(async () => ({ _sum: { expected_remaining: new Prisma.Decimal('0.00') } })),
    },
    withdrawal: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      findFirst: vi.fn(async () => options.inflight ?? null),
      findUnique: vi.fn(async () => withdrawalRecord()),
    },
    withdrawalBankSnapshot: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };
  return { repository: new AgentFinanceRepository({} as PrismaClient, () => NOW), transaction, wallet };
}

describe('AgentFinanceRepository', () => {
  it('deactivates the current bank account and stores only the replacement security material', async () => {
    const created = bankRecord({
      account_no_ciphertext: Buffer.from([5, 6, 7, 8]),
      account_no_hash: 'b'.repeat(64),
      account_no_last4: '0042',
      id: replacementBankAccountId,
    });
    const transaction = {
      $queryRaw: lockedRows([{ id: agentId }], [{ id: accountId }], []),
      agentBankAccount: {
        create: vi.fn(async () => created),
        findFirst: vi.fn(async () => bankRecord()),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
    };
    const result = await new AgentFinanceRepository({} as PrismaClient, () => NOW)
      .replaceBankAccountInTransaction(transaction as unknown as DatabaseTransaction, bankInput());

    expect(result).toMatchObject({ changed: true, bankAccount: { bankAccountId: replacementBankAccountId, last4: '0042' } });
    expect(transaction.agentBankAccount.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ deleted_at: NOW, is_active: false }),
      where: expect.objectContaining({ id: bankAccountId, version: 1 }),
    }));
    const createData = transaction.agentBankAccount.create.mock.calls[0]?.[0].data;
    expect(createData).toMatchObject({
      account_no_hash: 'b'.repeat(64),
      account_no_last4: '0042',
      agent_id: agentId,
      encryption_key_id: 'field-key-2026-09',
    });
    expect(createData.account_no_ciphertext).toEqual(Buffer.from([5, 6, 7, 8]));
    expect(JSON.stringify(createData)).not.toContain('accountNumber');
  });

  it('treats a matching current or historical HMAC candidate as an idempotent replacement', async () => {
    const current = bankRecord({ account_no_hash: 'a'.repeat(64) });
    const transaction = {
      $queryRaw: lockedRows([{ id: agentId }], [{ id: accountId }], []),
      agentBankAccount: {
        create: vi.fn(),
        findFirst: vi.fn(async () => current),
        updateMany: vi.fn(),
      },
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
    };
    const result = await new AgentFinanceRepository({} as PrismaClient, () => NOW)
      .replaceBankAccountInTransaction(transaction as unknown as DatabaseTransaction, bankInput({
        accountHashCandidates: ['b'.repeat(64), 'a'.repeat(64)],
      }));

    expect(result).toMatchObject({ changed: false, bankAccount: { bankAccountId, last4: '4826' } });
    expect(transaction.agentBankAccount.updateMany).not.toHaveBeenCalled();
    expect(transaction.agentBankAccount.create).not.toHaveBeenCalled();
  });

  it('accepts the published minimum exactly and freezes the balance with the required ledger shape', async () => {
    const { repository, transaction, wallet } = withdrawalHarness();
    const result = await repository.createWithdrawalInTransaction(
      transaction as unknown as DatabaseTransaction,
      withdrawalInput(),
    );

    expect(result).toMatchObject({ amount: '25.00', status: 'PENDING', withdrawalId });
    expect(transaction.commissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agent_id: agentId,
        available_change: expect.any(Prisma.Decimal),
        expected_change: 0,
        frozen_change: expect.any(Prisma.Decimal),
        idempotency_key: `withdrawal:${withdrawalId}:freeze`,
        ledger_type: 'WITHDRAWAL_FREEZE',
        reason: 'WITHDRAWAL_SUBMITTED',
        withdrawal_id: withdrawalId,
      }),
    });
    const ledger = transaction.commissionLedger.create.mock.calls[0]?.[0].data;
    expect((ledger.available_change as Prisma.Decimal).toFixed(2)).toBe('-25.00');
    expect((ledger.frozen_change as Prisma.Decimal).toFixed(2)).toBe('25.00');
    expect(transaction.agentWallet.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        available_balance: expect.any(Prisma.Decimal),
        frozen_balance: expect.any(Prisma.Decimal),
      }),
      where: expect.objectContaining({
        available_balance: wallet.available_balance,
        frozen_balance: wallet.frozen_balance,
        id: walletId,
        version: 4,
      }),
    });
    const balances = transaction.agentWallet.updateMany.mock.calls[0]?.[0].data;
    expect((balances.available_balance as Prisma.Decimal).toFixed(2)).toBe('75.00');
    expect((balances.frozen_balance as Prisma.Decimal).toFixed(2)).toBe('25.00');
    expect(transaction.withdrawalBankSnapshot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        account_no_ciphertext: bankRecord().account_no_ciphertext,
        source_bank_account_id: bankAccountId,
        withdrawal_id: withdrawalId,
      }),
    });
  });

  it('rejects values below the published minimum before writing finance facts', async () => {
    const { repository, transaction } = withdrawalHarness({ minimum: '25.01' });
    await expect(repository.createWithdrawalInTransaction(
      transaction as unknown as DatabaseTransaction,
      withdrawalInput(),
    )).rejects.toMatchObject({ code: 'WITHDRAWAL_MINIMUM_NOT_MET' });

    expect(transaction.withdrawal.create).not.toHaveBeenCalled();
    expect(transaction.commissionLedger.create).not.toHaveBeenCalled();
    expect(transaction.agentWallet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a second in-flight withdrawal without writing another freeze', async () => {
    const { repository, transaction } = withdrawalHarness({ inflight: { id: id(-2_000) } });
    await expect(repository.createWithdrawalInTransaction(
      transaction as unknown as DatabaseTransaction,
      withdrawalInput(),
    )).rejects.toMatchObject({ code: 'WITHDRAWAL_IN_PROGRESS' });

    expect(transaction.withdrawal.create).not.toHaveBeenCalled();
    expect(transaction.commissionLedger.create).not.toHaveBeenCalled();
  });

  it('returns tenant-safe 404 for a bank account owned by another Agent', async () => {
    const { repository, transaction } = withdrawalHarness({ bank: bankRecord({ agent_id: otherAgentId }) });
    await expect(repository.createWithdrawalInTransaction(
      transaction as unknown as DatabaseTransaction,
      withdrawalInput(),
    )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(transaction.withdrawal.create).not.toHaveBeenCalled();
  });

  it('allows contract-valid 0.00 amount filters and sends them to the scoped query', async () => {
    const transaction = {
      agentProfile: { findUnique: vi.fn(async () => activeAgent()) },
      withdrawal: {
        count: vi.fn(async () => 0),
        findMany: vi.fn(async () => []),
      },
    };
    const result = await new AgentFinanceRepository(prismaWith(transaction), () => NOW).listWithdrawals({
      accountId,
      agentId,
      maxAmount: '0.00',
      minAmount: '0.00',
      page: 1,
      pageSize: 20,
    });

    expect(result).toEqual({ items: [], total: 0 });
    expect(transaction.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ agent_id: agentId, amount: { gte: '0.00', lte: '0.00' } }),
    }));
  });
});
