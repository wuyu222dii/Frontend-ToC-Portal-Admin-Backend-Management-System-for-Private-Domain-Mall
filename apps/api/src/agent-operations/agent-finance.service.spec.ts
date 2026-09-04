import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AgentBankAccountSnapshot,
  AgentWithdrawalSnapshot,
  CurrentAgentSession,
  DatabaseRuntime,
  DatabaseTransaction,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { AgentAuthRequestContext } from '../agent-auth/agent-auth.request';
import { AgentOperationsService } from './agent-operations.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const AGENT_ID = '01J00000000000000000000001';
const BANK_ACCOUNT_ID = '01J00000000000000000000002';
const WITHDRAWAL_ID = '01J00000000000000000000003';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const ACCOUNT_NUMBER = '1234-5678 9012-3456';

const session: CurrentAgentSession = {
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  accessJti: 'access:01J00000000000000000000004',
  agentId: AGENT_ID,
  agentName: 'North Agent',
  agentNo: 'AGT-000001',
  agentStatus: 'ACTIVE',
  expiresAt: new Date('2026-09-05T00:00:00.000Z'),
  productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
  profileVersion: 1,
  restriction: 'NONE',
  rotationCounter: 0,
  sessionFamily: '01J00000000000000000000005',
  sessionId: '01J00000000000000000000006',
};

const bankAccount: AgentBankAccountSnapshot = {
  accountHolder: 'Alice Example',
  bankAccountId: BANK_ACCOUNT_ID,
  bankName: 'Development Bank',
  isActive: true,
  last4: '3456',
  version: 1,
};

const withdrawal: AgentWithdrawalSnapshot = {
  amount: '100.00',
  bankAccountLast4: '3456',
  createdAt: new Date('2026-09-04T00:00:00.000Z'),
  paidAt: null,
  proofFileIds: [],
  reviewReason: null,
  reviewedAt: null,
  status: 'PENDING',
  version: 1,
  withdrawalId: WITHDRAWAL_ID,
  withdrawalNo: `WD${WITHDRAWAL_ID}`,
};

function config(): PlatformRuntimeConfig {
  return {
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      fieldKeys: { current: { id: 'field-v1', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 3) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 4),
    },
  } as unknown as PlatformRuntimeConfig;
}

function request(): AgentAuthRequestContext {
  return { agentSession: session, ip: '127.0.0.1', requestId: REQUEST_ID };
}

interface ServiceInternals {
  audit: { append: ReturnType<typeof vi.fn> };
  config: PlatformRuntimeConfig;
  database: DatabaseRuntime;
  finance: {
    createWithdrawalInTransaction: ReturnType<typeof vi.fn>;
    replaceBankAccountInTransaction: ReturnType<typeof vi.fn>;
  };
  idempotency: {
    agentFinanceReplay: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
}

function harness(claimResult: unknown = { kind: 'execute' }) {
  const transaction = { marker: 'agent-finance-transaction' } as unknown as DatabaseTransaction;
  const database = {
    prisma: {
      $transaction: vi.fn(async (work: (value: DatabaseTransaction) => Promise<unknown>) => work(transaction)),
    },
  } as unknown as DatabaseRuntime;
  const service = new AgentOperationsService();
  const internals = service as unknown as ServiceInternals;
  internals.config = config();
  internals.database = database;
  internals.audit = { append: vi.fn().mockResolvedValue({}) };
  internals.finance = {
    createWithdrawalInTransaction: vi.fn().mockResolvedValue(withdrawal),
    replaceBankAccountInTransaction: vi.fn().mockResolvedValue({ bankAccount, changed: true }),
  };
  internals.idempotency = {
    agentFinanceReplay: vi.fn(),
    claim: vi.fn().mockResolvedValue(claimResult),
    complete: vi.fn().mockResolvedValue({}),
  };
  internals.outbox = { append: vi.fn().mockResolvedValue({}) };
  return { internals, service, transaction };
}

describe('AgentOperationsService B13.5 finance orchestration', () => {
  it('persists only bank security material and commits business, audit, Outbox and idempotency facts together', async () => {
    const current = harness();

    const result = await current.service.replaceBankAccount(request(), {
      accountHolder: bankAccount.accountHolder,
      accountNumber: ACCOUNT_NUMBER,
      bankName: bankAccount.bankName,
    }, IDEMPOTENCY_KEY);

    const repositoryInput = current.internals.finance.replaceBankAccountInTransaction.mock.calls[0]?.[1] as
      Record<string, unknown>;
    expect(repositoryInput).toMatchObject({
      accountHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      accountHolder: bankAccount.accountHolder,
      accountId: ACCOUNT_ID,
      agentId: AGENT_ID,
      bankName: bankAccount.bankName,
      encryptionKeyId: 'field-v1',
      last4: '3456',
    });
    expect(repositoryInput).not.toHaveProperty('accountNumber');
    expect(Buffer.from(repositoryInput.ciphertext as Uint8Array).toString('utf8')).not.toContain('1234567890123456');
    expect(JSON.stringify(result.envelope)).not.toContain(ACCOUNT_NUMBER);
    expect(result.envelope.data).toEqual({
      account_holder_masked: 'A************',
      account_no_last4: '3456',
      account_number_masked: '**** 3456',
      bank_account_id: BANK_ACCOUNT_ID,
      bank_name: bankAccount.bankName,
      is_active: true,
      version: 1,
    });

    expect(current.internals.idempotency.claim).toHaveBeenCalledBefore(
      current.internals.finance.replaceBankAccountInTransaction,
    );
    expect(current.internals.finance.replaceBankAccountInTransaction).toHaveBeenCalledWith(
      current.transaction,
      repositoryInput,
    );
    expect(current.internals.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'CREATE', objectId: BANK_ACCOUNT_ID, objectType: 'bank_account', result: 'SUCCESS',
    }));
    expect(current.internals.outbox.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      aggregateId: AGENT_ID, eventType: 'agent.bank_account.updated',
    }));
    expect(current.internals.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.anything(),
      expect.objectContaining({ policy: 'AGENT_FINANCE_RESPONSE', responseStatus: 200, storage: 'CACHEABLE' }),
    );
    expect(JSON.stringify([
      current.internals.audit.append.mock.calls,
      current.internals.outbox.append.mock.calls,
      current.internals.idempotency.complete.mock.calls[0]?.[2],
    ])).not.toContain(ACCOUNT_NUMBER);
  });

  it('returns the cached masked bank response without repeating business or action facts', async () => {
    const cached = {
      code: 'OK' as const,
      data: {
        account_holder_masked: 'A************',
        account_no_last4: '3456',
        account_number_masked: '**** 3456',
        bank_account_id: BANK_ACCOUNT_ID,
        bank_name: bankAccount.bankName,
        is_active: true,
        version: 1,
      },
      message: 'success' as const,
      request_id: REQUEST_ID,
    };
    const current = harness({ kind: 'replay', record: { response_status: 200 } });
    current.internals.idempotency.agentFinanceReplay.mockReturnValue(cached);

    const result = await current.service.replaceBankAccount(request(), {
      accountHolder: bankAccount.accountHolder,
      accountNumber: ACCOUNT_NUMBER,
      bankName: bankAccount.bankName,
    }, IDEMPOTENCY_KEY);

    expect(result.envelope).toEqual(cached);
    expect(JSON.stringify(result.envelope)).not.toContain(ACCOUNT_NUMBER);
    expect(current.internals.finance.replaceBankAccountInTransaction).not.toHaveBeenCalled();
    expect(current.internals.audit.append).not.toHaveBeenCalled();
    expect(current.internals.outbox.append).not.toHaveBeenCalled();
    expect(current.internals.idempotency.complete).not.toHaveBeenCalled();
  });

  it('submits a withdrawal and records its action facts in the same transaction', async () => {
    const current = harness();

    const result = await current.service.createWithdrawal(request(), {
      amount: withdrawal.amount,
      bankAccountId: BANK_ACCOUNT_ID,
    }, IDEMPOTENCY_KEY);

    expect(current.internals.finance.createWithdrawalInTransaction).toHaveBeenCalledWith(current.transaction, {
      accountId: ACCOUNT_ID,
      agentId: AGENT_ID,
      amount: withdrawal.amount,
      bankAccountId: BANK_ACCOUNT_ID,
      withdrawalId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
    });
    expect(result.envelope).toMatchObject({
      code: 'OK',
      data: {
        amount: '100.00',
        bank_account_masked: '**** 3456',
        proof_file_ids: [],
        status: 'PENDING',
        withdrawal_id: WITHDRAWAL_ID,
      },
      request_id: REQUEST_ID,
    });
    expect(current.internals.audit.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      action: 'CREATE', objectId: WITHDRAWAL_ID, objectType: 'withdrawal', result: 'SUCCESS',
    }));
    expect(current.internals.outbox.append).toHaveBeenCalledWith(current.transaction, expect.objectContaining({
      aggregateId: WITHDRAWAL_ID, eventType: 'withdrawal.submitted',
    }));
    expect(current.internals.idempotency.complete).toHaveBeenCalledWith(
      current.transaction,
      expect.anything(),
      expect.objectContaining({ policy: 'AGENT_FINANCE_RESPONSE', responseStatus: 201, storage: 'CACHEABLE' }),
    );
  });

  it('propagates withdrawal business errors without appending success facts', async () => {
    const current = harness();
    const error = new ApplicationError('WITHDRAWAL_MINIMUM_NOT_MET', 'Withdrawal is below the current minimum');
    current.internals.finance.createWithdrawalInTransaction.mockRejectedValueOnce(error);

    await expect(current.service.createWithdrawal(request(), {
      amount: '1.00',
      bankAccountId: BANK_ACCOUNT_ID,
    }, IDEMPOTENCY_KEY)).rejects.toBe(error);

    expect(current.internals.audit.append).not.toHaveBeenCalled();
    expect(current.internals.outbox.append).not.toHaveBeenCalled();
    expect(current.internals.idempotency.complete).not.toHaveBeenCalled();
  });
});
