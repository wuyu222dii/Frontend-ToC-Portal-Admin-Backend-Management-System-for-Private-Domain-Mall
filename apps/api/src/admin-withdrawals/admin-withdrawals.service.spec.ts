import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  AdminWithdrawalActionImpact,
  AdminWithdrawalMutationResult,
  AdminWithdrawalSnapshot,
  DatabaseRuntime,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { AdminCustomerRequestContext } from '../admin-customers/admin-customers.request';
import { createAgentBankAccountMaterial } from '../platform/security/bank-account-security';
import { AdminWithdrawalsService } from './admin-withdrawals.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const AGENT_ID = '01J00000000000000000000001';
const BANK_ID = '01J00000000000000000000002';
const FACTOR_ID = '01J00000000000000000000003';
const FILE_ID = '01J00000000000000000000004';
const GRANT_ID = '01J00000000000000000000005';
const SESSION_ID = '01J00000000000000000000006';
const WITHDRAWAL_ID = '01J00000000000000000000007';
const KEY = '00000000-0000-4000-8000-000000000001';
const HASH = 'a'.repeat(64);
const PREVIEW_TOKEN = `pvw_${'b'.repeat(43)}`;
const REAUTH_GRANT = `rag_${'c'.repeat(43)}`;
const CREATED_AT = new Date('2026-09-04T01:00:00.000Z');
const REVIEWED_AT = new Date('2026-09-04T01:05:00.000Z');

function config(): PlatformRuntimeConfig {
  return {
    agent: {} as PlatformRuntimeConfig['agent'],
    authentication: {
      secretHashKeys: { current: { id: 'secret-v1', key: Buffer.alloc(32, 7) }, previous: [] },
    } as unknown as PlatformRuntimeConfig['authentication'],
    banner: { targetOrigins: [] },
    database: {} as PlatformRuntimeConfig['database'],
    encryption: {
      bankAccountHashKeys: { current: { id: 'bank-v1', key: Buffer.alloc(32, 4) }, previous: [] },
      fieldKeys: { current: { id: 'field-v1', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    payment: { mockSigningKey: Buffer.alloc(32, 4), provider: 'MOCK', providerTimeoutMs: 5_000 },
    port: 3000,
    promotion: { publicBaseUrl: 'https://mall.example.test' },
    redis: { url: 'redis://unused' },
    service: 'api',
    storage: {} as PlatformRuntimeConfig['storage'],
    store: {} as PlatformRuntimeConfig['store'],
    worker: {} as PlatformRuntimeConfig['worker'],
  };
}

function requestContext(): AdminCustomerRequestContext {
  return {
    accessSession: {
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      accessJti: 'access-jti',
      expiresAt: new Date('2026-09-04T02:00:00.000Z'),
      factorEncryptionKeyId: 'factor-v1',
      factorId: FACTOR_ID,
      factorLastUsedTimestep: null,
      factorSecretCiphertext: new Uint8Array(),
      mfaVerifiedAt: CREATED_AT,
      sessionFamily: '01J00000000000000000000008',
      sessionId: SESSION_ID,
    },
    principal: {
      accountId: ACCOUNT_ID,
      assurance: 'MFA',
      permissions: [],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: SESSION_ID,
    },
    requestId: `req_${'1'.repeat(32)}`,
    socket: { remoteAddress: '127.0.0.1' },
  };
}

function snapshot(overrides: Partial<AdminWithdrawalSnapshot> = {}): AdminWithdrawalSnapshot {
  return {
    agentId: AGENT_ID,
    agentName: 'Development Agent',
    agentNo: 'AGT-0001',
    amount: '100.00',
    balanceSnapshot: {
      availableAfter: '400.00',
      availableBefore: '500.00',
      capturedAt: CREATED_AT,
      frozenAfter: '100.00',
      frozenBefore: '0.00',
    },
    createdAt: CREATED_AT,
    paidAt: null,
    paidById: null,
    payoutAccountSnapshot: {
      accountHolder: 'Alice Example',
      bankName: 'Development Bank',
      last4: '3456',
      snapshotAt: CREATED_AT,
    },
    proofFileIds: [],
    reviewReason: null,
    reviewedAt: null,
    reviewedById: null,
    status: 'PENDING',
    version: 1,
    withdrawalId: WITHDRAWAL_ID,
    withdrawalNo: 'WD-20260904-0001',
    ...overrides,
  };
}

function impact(action: 'APPROVE' | 'MARK_PAID' | 'REJECT'): AdminWithdrawalActionImpact {
  const withdrawal = snapshot(action === 'MARK_PAID' ? {
    proofFileIds: [FILE_ID],
    reviewedAt: REVIEWED_AT,
    reviewedById: ACCOUNT_ID,
    status: 'APPROVED',
    version: 2,
  } : {});
  return {
    action,
    proofFileIds: action === 'MARK_PAID' ? [FILE_ID] : [],
    resourceVersion: withdrawal.version,
    resultingStatus: action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'PAID',
    walletAvailableAfter: action === 'REJECT' ? '500.00' : '400.00',
    walletAvailableBefore: '400.00',
    walletFrozenAfter: action === 'APPROVE' ? '100.00' : '0.00',
    walletFrozenBefore: '100.00',
    withdrawal,
  };
}

function mutation(action: 'APPROVE' | 'MARK_PAID' | 'REJECT'): AdminWithdrawalMutationResult {
  const before = impact(action).withdrawal;
  const after = snapshot({
    paidAt: action === 'MARK_PAID' ? REVIEWED_AT : null,
    paidById: action === 'MARK_PAID' ? ACCOUNT_ID : null,
    proofFileIds: action === 'MARK_PAID' ? [FILE_ID] : [],
    reviewReason: action === 'REJECT' ? 'Invalid payout account' : null,
    reviewedAt: REVIEWED_AT,
    reviewedById: ACCOUNT_ID,
    status: action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'PAID',
    version: before.version + 1,
  });
  return {
    action,
    after,
    before,
    occurredAt: REVIEWED_AT,
    wallet: {
      availableAfter: action === 'REJECT' ? '500.00' : '400.00',
      availableBefore: '400.00',
      frozenAfter: action === 'APPROVE' ? '100.00' : '0.00',
      frozenBefore: '100.00',
      versionAfter: action === 'APPROVE' ? 4 : 5,
      versionBefore: 4,
    },
  };
}

interface ServiceInternals {
  adminAuth: { consumePayoutReauthGrantInTransaction: ReturnType<typeof vi.fn> };
  audit: { append: ReturnType<typeof vi.fn> };
  idempotency: {
    assertHashOnlyReplay: ReturnType<typeof vi.fn>;
    assertKeyNotUsedForRequest: ReturnType<typeof vi.fn>;
    claim: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  outbox: { append: ReturnType<typeof vi.fn> };
  previews: { consumeInTransaction: ReturnType<typeof vi.fn>; issueInTransaction: ReturnType<typeof vi.fn> };
  withdrawals: {
    approveInTransaction: ReturnType<typeof vi.fn>;
    bindProofsInTransaction: ReturnType<typeof vi.fn>;
    consumePayoutAccountRevealInTransaction: ReturnType<typeof vi.fn>;
    getActionImpactInTransaction: ReturnType<typeof vi.fn>;
    getWithdrawal: ReturnType<typeof vi.fn>;
    getWithdrawalInTransaction: ReturnType<typeof vi.fn>;
    listWithdrawals: ReturnType<typeof vi.fn>;
    markPaidInTransaction: ReturnType<typeof vi.fn>;
    rejectInTransaction: ReturnType<typeof vi.fn>;
  };
}

function harness() {
  const sequence: string[] = [];
  const transaction = {};
  const database = {
    prisma: { $transaction: vi.fn(async (work: (value: unknown) => Promise<unknown>) => work(transaction)) },
  } as unknown as DatabaseRuntime;
  const service = new AdminWithdrawalsService(config(), database);
  const mocks: ServiceInternals = {
    adminAuth: {
      consumePayoutReauthGrantInTransaction: vi.fn(async () => {
        sequence.push('consume-grant');
        return { expiresAt: new Date('2026-09-04T01:06:00.000Z'), grantId: GRANT_ID };
      }),
    },
    audit: { append: vi.fn(async () => sequence.push('audit')) },
    idempotency: {
      assertHashOnlyReplay: vi.fn(() => sequence.push('assert-replay')),
      assertKeyNotUsedForRequest: vi.fn(async () => sequence.push('assert-distinct-key')),
      claim: vi.fn(async () => {
        sequence.push('claim');
        return { kind: 'execute' as const };
      }),
      complete: vi.fn(async () => sequence.push('complete')),
    },
    outbox: { append: vi.fn(async () => sequence.push('outbox')) },
    previews: {
      consumeInTransaction: vi.fn(async () => sequence.push('consume-preview')),
      issueInTransaction: vi.fn(async () => ({ confirmationHash: HASH, expiresAt: REVIEWED_AT })),
    },
    withdrawals: {
      approveInTransaction: vi.fn(),
      bindProofsInTransaction: vi.fn(),
      consumePayoutAccountRevealInTransaction: vi.fn(),
      getActionImpactInTransaction: vi.fn(),
      getWithdrawal: vi.fn(),
      getWithdrawalInTransaction: vi.fn(),
      listWithdrawals: vi.fn(),
      markPaidInTransaction: vi.fn(),
      rejectInTransaction: vi.fn(),
    },
  };
  Object.assign(service as unknown as ServiceInternals, mocks);
  return { mocks, sequence, service };
}

describe('B13.6 Admin withdrawal service boundary', () => {
  it('binds approve preview to the authoritative wallet impact without storing capabilities', async () => {
    const { mocks, service } = harness();
    mocks.withdrawals.getActionImpactInTransaction.mockResolvedValue(impact('APPROVE'));

    const response = await service.previewApprove(requestContext(), WITHDRAWAL_ID, KEY);

    expect(response).toMatchObject({
      confirmation_hash: HASH,
      preview_token: expect.stringMatching(/^pvw_/),
      resource_etag: '"1"',
    });
    const completion = mocks.idempotency.complete.mock.calls[0]?.[2];
    expect(completion).toMatchObject({ resourceId: WITHDRAWAL_ID, storage: 'HASH_ONLY' });
    expect(JSON.stringify(completion)).not.toContain(response.preview_token);
    expect(JSON.stringify(completion)).not.toContain(response.confirmation_hash);
  });

  it('rejects only after consuming the matching preview, then audits, emits and completes atomically', async () => {
    const { mocks, sequence, service } = harness();
    mocks.withdrawals.rejectInTransaction.mockImplementation(async (_transaction, _input, hooks) => {
      sequence.push('reject');
      await hooks.verifyPreview(impact('REJECT'));
      return mutation('REJECT');
    });

    const result = await service.reject(requestContext(), WITHDRAWAL_ID, {
      confirmationHash: HASH,
      previewToken: PREVIEW_TOKEN,
      reason: 'Invalid payout account',
    }, 1, KEY);

    expect(result).toMatchObject({ review_reason: 'Invalid payout account', status: 'REJECTED', version: 2 });
    expect(sequence).toEqual([
      'claim', 'assert-distinct-key', 'reject', 'consume-preview', 'audit', 'outbox', 'complete',
    ]);
    expect(mocks.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'REJECT',
      reason: 'Invalid payout account',
      summaryPolicy: 'STATUS_VERSION',
    }));
  });

  it('consumes a same-session grant, decrypts the immutable snapshot, and stores no secret response', async () => {
    const { mocks, sequence, service } = harness();
    const accountNumber = ['1234', '5678', '9012', '3456'].join('');
    const secured = createAgentBankAccountMaterial(
      BANK_ID,
      accountNumber,
      config().encryption.fieldKeys.current,
      config().encryption.bankAccountHashKeys.current,
    );
    mocks.withdrawals.consumePayoutAccountRevealInTransaction.mockImplementation(async (_transaction, _input, hooks) => {
      const grant = await hooks.consumeGrant();
      sequence.push('read-snapshot');
      return {
        accountHolder: 'Alice Example',
        bankName: 'Development Bank',
        ciphertext: secured.ciphertext,
        encryptionKeyId: secured.encryptionKeyId,
        grantExpiresAt: grant.expiresAt,
        grantId: grant.grantId,
        last4: secured.last4,
        snapshotAt: CREATED_AT,
        sourceBankAccountId: BANK_ID,
        version: 2,
        withdrawalId: WITHDRAWAL_ID,
      };
    });

    const response = await service.revealPayoutAccount(
      requestContext(),
      WITHDRAWAL_ID,
      { reauthGrant: REAUTH_GRANT },
      2,
      KEY,
    );

    expect(response).toEqual({
      account_holder: 'Alice Example',
      account_number: accountNumber,
      bank_name: 'Development Bank',
      expires_at: '2026-09-04T01:06:00.000Z',
    });
    expect(sequence).toEqual(['claim', 'consume-grant', 'read-snapshot', 'audit', 'complete']);
    const completion = mocks.idempotency.complete.mock.calls[0]?.[2];
    expect(JSON.stringify(completion)).not.toContain(accountNumber);
    expect(JSON.stringify(completion)).not.toContain(REAUTH_GRANT);
    expect(mocks.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'READ_SENSITIVE',
      summaryPolicy: 'NONE',
    }));
  });

  it('fails closed on reveal replay before grant consumption or snapshot decryption', async () => {
    const { mocks, service } = harness();
    mocks.idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });

    await expect(service.revealPayoutAccount(
      requestContext(),
      WITHDRAWAL_ID,
      { reauthGrant: REAUTH_GRANT },
      2,
      KEY,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' } satisfies Partial<ApplicationError>);
    expect(mocks.withdrawals.consumePayoutAccountRevealInTransaction).not.toHaveBeenCalled();
    expect(mocks.adminAuth.consumePayoutReauthGrantInTransaction).not.toHaveBeenCalled();
  });
});
