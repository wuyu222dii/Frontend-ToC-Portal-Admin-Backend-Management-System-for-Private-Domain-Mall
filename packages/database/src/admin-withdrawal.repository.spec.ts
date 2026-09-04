import { generateUlid } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { AdminWithdrawalRepository } from './admin-withdrawal.repository';

const mocks = vi.hoisted(() => ({
  acquireLock: vi.fn(async () => undefined),
  lockWallet: vi.fn(),
}));

vi.mock('./advisory-lock', () => ({ acquireTransactionLock: mocks.acquireLock }));
vi.mock('./agent-finance.repository', () => ({
  lockReconciledAgentWalletInTransaction: mocks.lockWallet,
}));

const NOW = new Date('2026-09-04T04:00:00.000Z');
const id = (offset: number) => generateUlid(NOW.getTime() + offset);
const adminId = id(-10_000);
const otherAdminId = id(-9_000);
const agentId = id(-8_000);
const walletId = id(-7_000);
const bankAccountId = id(-6_000);
const withdrawalId = id(-5_000);
const proofId = id(-4_000);
const grantId = id(-3_000);

function withdrawalRecord(status: 'APPROVED' | 'PENDING' = 'PENDING') {
  const approved = status === 'APPROVED';
  return {
    agent: { agent_no: 'AG000001', id: agentId, name: 'Fixture Agent' },
    agent_id: agentId,
    amount: new Prisma.Decimal('25.00'),
    available_before: new Prisma.Decimal('100.00'),
    bank_snapshot: {
      account_holder: 'Alice Example',
      account_no_last4: '4826',
      bank_name: 'Example Bank',
      created_at: new Date(NOW.getTime() - 20_000),
      source_bank_account_id: bankAccountId,
      withdrawal_id: withdrawalId,
    },
    created_at: new Date(NOW.getTime() - 20_000),
    frozen_after: new Prisma.Decimal('25.00'),
    id: withdrawalId,
    paid_at: null,
    paid_by_id: null,
    proofs: [] as Array<{ created_at?: Date; file_id: string; id?: string; withdrawal_id: string }>,
    review_reason: null,
    reviewed_at: approved ? new Date(NOW.getTime() - 10_000) : null,
    reviewed_by_id: approved ? adminId : null,
    status,
    version: approved ? 2 : 1,
    withdrawal_no: `WD${withdrawalId}`,
  };
}

function proofFile(overrides: Record<string, unknown> = {}) {
  return {
    _count: {
      aftersale_evidence: 0,
      banners: 0,
      brand_logos: 0,
      category_icons: 0,
      product_images: 0,
      promotion_qr_files: 0,
    },
    created_by_id: adminId,
    deleted_at: null,
    id: proofId,
    object_key: `private/${proofId}`,
    purpose: 'WITHDRAWAL_PROOF',
    status: 'READY',
    visibility: 'PRIVATE',
    withdrawal_proofs: [] as Array<{ withdrawal_id: string }>,
    ...overrides,
  };
}

function harness(
  status: 'APPROVED' | 'PENDING' = 'PENDING',
  mutationTime = NOW,
) {
  const record = withdrawalRecord(status);
  const wallet = {
    agent_id: agentId,
    available_balance: new Prisma.Decimal('75.00'),
    frozen_balance: new Prisma.Decimal('25.00'),
    id: walletId,
    updated_at: new Date(NOW.getTime() - 5_000),
    version: 4,
  };
  const file = proofFile();
  const queryRaw = vi.fn(async (query: { strings?: readonly string[] }) => {
    const text = query.strings?.join(' ') ?? '';
    if (text.includes('GREATEST')) return [{ id: withdrawalId, mutation_time: mutationTime }];
    if (text.includes('FROM public.account')) {
      return [{ deleted_at: null, has_password: true, id: adminId, role: 'SUPER_ADMIN', status: 'ACTIVE' }];
    }
    if (text.includes('FROM public.agent_profile')) return [{ id: agentId }];
    if (text.includes('FROM public.withdrawal')) return [{ id: withdrawalId }];
    if (text.includes('FROM public.file_asset')) return [{ id: proofId }];
    throw new Error(`Unexpected query: ${text}`);
  });
  const transaction = {
    $queryRaw: queryRaw,
    agentWallet: {
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    commissionLedger: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
    fileAsset: { findMany: vi.fn(async () => [file]) },
    withdrawal: {
      count: vi.fn(async () => 1),
      findMany: vi.fn(async () => [record]),
      findUnique: vi.fn(async (args: { select: Record<string, unknown> }) =>
        Object.keys(args.select).length === 2 && args.select.agent_id === true && args.select.id === true
          ? { agent_id: agentId, id: withdrawalId }
          : record),
      updateMany: vi.fn(async ({ data, where }: {
        data: Record<string, unknown>;
        where: { status?: string; version: number };
      }) => {
        if (record.version !== where.version || (where.status !== undefined && record.status !== where.status)) {
          return { count: 0 };
        }
        record.version += 1;
        if (data.status !== undefined) record.status = data.status as typeof record.status | 'PAID' | 'REJECTED';
        if (data.review_reason !== undefined) record.review_reason = data.review_reason as string;
        if (data.reviewed_by_id !== undefined) record.reviewed_by_id = data.reviewed_by_id as string;
        if (data.reviewed_at !== undefined) record.reviewed_at = data.reviewed_at as Date;
        if (data.paid_by_id !== undefined) record.paid_by_id = data.paid_by_id as string;
        if (data.paid_at !== undefined) record.paid_at = data.paid_at as Date;
        return { count: 1 };
      }),
    },
    withdrawalBankSnapshot: {
      findUnique: vi.fn(async () => ({
        account_holder: 'Alice Example',
        account_no_ciphertext: Buffer.from([1, 2, 3, 4]),
        account_no_last4: '4826',
        bank_name: 'Example Bank',
        created_at: new Date(NOW.getTime() - 20_000),
        encryption_key_id: 'field-key-v1',
        source_bank_account_id: bankAccountId,
        withdrawal_id: withdrawalId,
      })),
    },
    withdrawalProof: {
      createMany: vi.fn(async ({ data }: { data: Array<{ file_id: string; withdrawal_id: string }> }) => {
        for (const proof of data) {
          record.proofs.push({ file_id: proof.file_id, withdrawal_id: proof.withdrawal_id });
          file.withdrawal_proofs.push({ withdrawal_id: proof.withdrawal_id });
        }
        return { count: data.length };
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => Promise<unknown>) =>
      work(transaction as unknown as DatabaseTransaction)),
    withdrawal: transaction.withdrawal,
  } as unknown as PrismaClient;
  mocks.lockWallet.mockResolvedValue(wallet);
  return {
    file,
    prisma,
    record,
    repository: new AdminWithdrawalRepository(prisma),
    transaction: transaction as unknown as DatabaseTransaction,
    transactionMock: transaction,
    wallet,
  };
}

describe('AdminWithdrawalRepository', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns closed admin projections and applies list filters inside one repeatable-read transaction', async () => {
    const state = harness();
    const result = await state.repository.listWithdrawals({
      agentId,
      minAmount: '25.00',
      page: 2,
      pageSize: 10,
      status: 'PENDING',
      withdrawalNo: `WD${withdrawalId}`,
    });

    expect(result).toMatchObject({
      items: [{
        agentId,
        amount: '25.00',
        balanceSnapshot: {
          availableAfter: '75.00',
          availableBefore: '100.00',
          frozenAfter: '25.00',
          frozenBefore: '0.00',
        },
        payoutAccountSnapshot: { last4: '4826' },
        withdrawalId,
      }],
      total: 1,
    });
    expect(state.transactionMock.withdrawal.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10,
      take: 10,
      where: expect.objectContaining({
        agent_id: agentId,
        amount: { gte: '25.00' },
        status: 'PENDING',
        withdrawal_no: `WD${withdrawalId}`,
      }),
    }));
  });

  it('approves a pending withdrawal without changing its frozen wallet', async () => {
    const futureCreationTime = new Date(NOW.getTime() + 2_000);
    const state = harness('PENDING', futureCreationTime);
    state.record.created_at = futureCreationTime;
    const verifyPreview = vi.fn(async () => undefined);
    const result = await state.repository.approveInTransaction(state.transaction, {
      actorAccountId: adminId,
      expectedVersion: 1,
      withdrawalId,
    }, { verifyPreview });

    expect(result).toMatchObject({
      action: 'APPROVE',
      before: { status: 'PENDING', version: 1 },
      after: { status: 'APPROVED', version: 2 },
      wallet: {
        availableBefore: '75.00',
        availableAfter: '75.00',
        frozenBefore: '25.00',
        frozenAfter: '25.00',
        versionBefore: 4,
        versionAfter: 4,
      },
      occurredAt: futureCreationTime,
    });
    expect(verifyPreview).toHaveBeenCalledWith(expect.objectContaining({
      action: 'APPROVE',
      resourceVersion: 1,
      resultingStatus: 'APPROVED',
    }));
    expect(state.transactionMock.agentWallet.updateMany).not.toHaveBeenCalled();
    expect(state.transactionMock.commissionLedger.create).not.toHaveBeenCalled();
    expect(mocks.acquireLock).toHaveBeenNthCalledWith(1, state.transaction, 'admin-auth-account', [adminId]);
    expect(mocks.acquireLock).toHaveBeenNthCalledWith(2, state.transaction, 'admin-auth-account-sessions', [adminId]);
    expect(mocks.acquireLock).toHaveBeenNthCalledWith(3, state.transaction, 'store-attribution-agent', [agentId]);
    expect(mocks.acquireLock.mock.invocationCallOrder[2]).toBeLessThan(mocks.lockWallet.mock.invocationCallOrder[0]!);
    const mutationQuery = state.transactionMock.$queryRaw.mock.calls
      .map(([query]) => (query as { strings: readonly string[] }).strings.join(' '))
      .find((query) => query.includes('GREATEST'));
    expect(mutationQuery).toMatch(/GREATEST[\s\S]*transaction_timestamp\(\)[\s\S]*created_at[\s\S]*updated_at[\s\S]*COALESCE\(reviewed_at, created_at\)/);
  });

  it('rejects and unfreezes the exact amount with one release ledger fact', async () => {
    const state = harness();
    const result = await state.repository.rejectInTransaction(state.transaction, {
      actorAccountId: adminId,
      expectedVersion: 1,
      reason: 'Payout details could not be verified',
      withdrawalId,
    }, { verifyPreview: vi.fn(async () => undefined) });

    expect(result).toMatchObject({
      action: 'REJECT',
      before: { status: 'PENDING', version: 1 },
      after: { reviewReason: 'Payout details could not be verified', status: 'REJECTED', version: 2 },
      wallet: {
        availableBefore: '75.00',
        availableAfter: '100.00',
        frozenBefore: '25.00',
        frozenAfter: '0.00',
        versionBefore: 4,
        versionAfter: 5,
      },
    });
    expect(state.transactionMock.commissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        agent_id: agentId,
        available_change: new Prisma.Decimal('25.00'),
        expected_change: 0,
        frozen_change: new Prisma.Decimal('-25.00'),
        idempotency_key: `withdrawal:${withdrawalId}:release`,
        ledger_type: 'WITHDRAWAL_RELEASE',
        withdrawal_id: withdrawalId,
      }),
    });
    expect(state.transactionMock.agentWallet.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        available_balance: new Prisma.Decimal('100.00'),
        frozen_balance: new Prisma.Decimal('0.00'),
      }),
      where: expect.objectContaining({
        available_balance: new Prisma.Decimal('75.00'),
        frozen_balance: new Prisma.Decimal('25.00'),
        version: 4,
      }),
    });
  });

  it('binds an owned READY private proof once and increments only the withdrawal version', async () => {
    const state = harness('APPROVED');
    const first = await state.repository.bindProofsInTransaction(state.transaction, {
      actorAccountId: adminId,
      fileIds: [proofId],
      withdrawalId,
    });
    const replay = await state.repository.bindProofsInTransaction(state.transaction, {
      actorAccountId: adminId,
      fileIds: [proofId],
      withdrawalId,
    });

    expect(first).toMatchObject({ changed: true, before: { version: 2 }, after: { proofFileIds: [proofId], version: 3 } });
    expect(replay).toMatchObject({ changed: false, before: { version: 3 }, after: { version: 3 }, occurredAt: null });
    expect(state.transactionMock.withdrawalProof.createMany).toHaveBeenCalledTimes(1);
    expect(state.transactionMock.agentWallet.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a new proof owned by another administrator or attached to another business fact', async () => {
    const state = harness('APPROVED');
    Object.assign(state.file, { created_by_id: otherAdminId });
    state.file._count.aftersale_evidence = 1;

    await expect(state.repository.bindProofsInTransaction(state.transaction, {
      actorAccountId: adminId,
      fileIds: [proofId],
      withdrawalId,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(state.transactionMock.withdrawalProof.createMany).not.toHaveBeenCalled();
    expect(state.transactionMock.withdrawal.updateMany).not.toHaveBeenCalled();
  });

  it('binds proof and marks APPROVED as PAID with exact frozen deduction', async () => {
    const state = harness('APPROVED');
    const verifyPreview = vi.fn(async () => undefined);
    const result = await state.repository.markPaidInTransaction(state.transaction, {
      actorAccountId: adminId,
      expectedVersion: 2,
      proofFileIds: [proofId],
      withdrawalId,
    }, { verifyPreview });

    expect(verifyPreview).toHaveBeenCalledWith(expect.objectContaining({
      action: 'MARK_PAID',
      proofFileIds: [proofId],
      resourceVersion: 2,
      resultingStatus: 'PAID',
    }));
    expect(result).toMatchObject({
      action: 'MARK_PAID',
      after: { paidById: adminId, proofFileIds: [proofId], status: 'PAID', version: 3 },
      wallet: {
        availableBefore: '75.00',
        availableAfter: '75.00',
        frozenBefore: '25.00',
        frozenAfter: '0.00',
        versionBefore: 4,
        versionAfter: 5,
      },
    });
    expect(state.transactionMock.commissionLedger.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        available_change: 0,
        expected_change: 0,
        frozen_change: new Prisma.Decimal('-25.00'),
        idempotency_key: `withdrawal:${withdrawalId}:paid`,
        ledger_type: 'WITHDRAWAL_PAID',
      }),
    });
  });

  it('validates the locked APPROVED version before atomically consuming the reveal grant', async () => {
    const state = harness('APPROVED');
    const consumeGrant = vi.fn(async () => ({
      expiresAt: new Date(NOW.getTime() + 60_000),
      grantId,
    }));
    const result = await state.repository.consumePayoutAccountRevealInTransaction(state.transaction, {
      actorAccountId: adminId,
      expectedVersion: 2,
      withdrawalId,
    }, { consumeGrant });

    expect(result).toMatchObject({
      accountHolder: 'Alice Example',
      bankName: 'Example Bank',
      encryptionKeyId: 'field-key-v1',
      grantId,
      last4: '4826',
      sourceBankAccountId: bankAccountId,
      version: 2,
      withdrawalId,
    });
    expect(Buffer.from(result.ciphertext)).toEqual(Buffer.from([1, 2, 3, 4]));
    expect(mocks.lockWallet.mock.invocationCallOrder[0]).toBeLessThan(consumeGrant.mock.invocationCallOrder[0]!);

    const stale = harness('APPROVED');
    await expect(stale.repository.consumePayoutAccountRevealInTransaction(stale.transaction, {
      actorAccountId: adminId,
      expectedVersion: 1,
      withdrawalId,
    }, { consumeGrant })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(consumeGrant).toHaveBeenCalledTimes(1);
  });

  it('uses the locked reconciled wallet for preview impacts', async () => {
    const state = harness();
    await expect(state.repository.getActionImpactInTransaction(state.transaction, {
      action: 'REJECT',
      actorAccountId: adminId,
      reason: 'Rejected after review',
      withdrawalId,
    })).resolves.toMatchObject({
      resourceVersion: 1,
      walletAvailableAfter: '100.00',
      walletFrozenAfter: '0.00',
    });
    expect(mocks.lockWallet).toHaveBeenCalledWith(state.transaction, agentId);

    mocks.lockWallet.mockRejectedValueOnce(new Error('ledger does not reconcile'));
    await expect(state.repository.getActionImpactInTransaction(state.transaction, {
      action: 'APPROVE',
      actorAccountId: adminId,
      withdrawalId,
    })).rejects.toThrow('ledger does not reconcile');
  });
});
