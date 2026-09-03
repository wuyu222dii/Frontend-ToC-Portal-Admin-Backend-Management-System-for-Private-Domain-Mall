import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import {
  AdminAgentRepository,
  type CreateAdminAgentInput,
} from './admin-agent.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-09-02T01:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 4_000);
const agentId = generateUlid(NOW.getTime() - 3_000);
const walletId = generateUlid(NOW.getTime() - 2_000);
const inviteCodeId = generateUlid(NOW.getTime() - 1_000);
const firstProductId = generateUlid(NOW.getTime() - 8_000);
const secondProductId = generateUlid(NOW.getTime() - 7_000);
const thirdProductId = generateUlid(NOW.getTime() - 6_000);
const rotatedInviteCodeId = generateUlid(NOW.getTime() + 1_000);

function accountRecord(overrides: Record<string, unknown> = {}) {
  return {
    deleted_at: null,
    id: accountId,
    login_name: 'agent.one',
    role: 'AGENT_ADMIN',
    status: 'ACTIVE',
    version: 7,
    ...overrides,
  };
}

function walletRecord(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: agentId,
    available_balance: new Prisma.Decimal('33.10'),
    frozen_balance: new Prisma.Decimal('4.25'),
    id: walletId,
    updated_at: NOW,
    version: 3,
    ...overrides,
  };
}

function agentRecord(overrides: Record<string, unknown> = {}) {
  return {
    account: accountRecord(),
    account_id: accountId,
    agent_no: 'AGT-000001',
    contact_name: 'Alice',
    contact_phone_ciphertext: Buffer.from('encrypted-contact'),
    contact_phone_encryption_key_id: 'field-key-2026-09',
    contact_phone_last4: '5678',
    created_at: new Date(NOW.getTime() - 86_400_000),
    deleted_at: null,
    id: agentId,
    name: 'Agent One',
    product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
    status: 'ACTIVE',
    updated_at: NOW,
    version: 1,
    wallet: walletRecord(),
    ...overrides,
  };
}

function repository(prisma: PrismaClient = {} as PrismaClient): AdminAgentRepository {
  return new AdminAgentRepository(prisma, () => NOW);
}

function createInput(): CreateAdminAgentInput {
  return {
    accountId,
    agentId,
    walletId,
    inviteCodeId,
    agentNo: 'AGT-000001',
    loginName: 'agent.one',
    passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$temporary-password-hash',
    name: 'Agent One',
    contactName: 'Alice',
    contactPhone: {
      ciphertext: Uint8Array.from([1, 2, 3, 4]),
      encryptionKeyId: 'field-key-2026-09',
      last4: '5678',
    },
    productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
    inviteCode: {
      ciphertext: Uint8Array.from([5, 6, 7, 8]),
      codeHash: 'a'.repeat(64),
      encryptionKeyId: 'field-key-2026-09',
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      last4: 'WXYZ',
    },
  };
}

function createHarness() {
  let account: Record<string, unknown> | null = null;
  let profile: Record<string, unknown> | null = null;
  let wallet: Record<string, unknown> | null = null;
  const accountDelegate = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      account = { ...data, deleted_at: null };
      return account;
    }),
    findUnique: vi.fn(async () => null),
  };
  const profileDelegate = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      profile = { ...data, deleted_at: null };
      return profile;
    }),
    findUnique: vi.fn(async ({ where }: { where: { agent_no?: string; id?: string } }) => {
      if (where.agent_no !== undefined) return null;
      if (!profile || !account || !wallet || where.id !== agentId) return null;
      return { ...profile, account, wallet };
    }),
  };
  const walletDelegate = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      wallet = data;
      return data;
    }),
  };
  const inviteDelegate = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    findUnique: vi.fn(async () => null),
  };
  const transactionStub = {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    account: accountDelegate,
    agentInviteCode: inviteDelegate,
    agentProfile: profileDelegate,
    agentWallet: walletDelegate,
  };
  return {
    accountDelegate,
    inviteDelegate,
    profileDelegate,
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
    walletDelegate,
  };
}

function lifecycleHarness(initialStatus: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  let account = accountRecord({ status: initialStatus });
  let profile = agentRecord({ account, status: initialStatus });
  const events: string[] = [];
  const hydrate = () => ({ ...profile, account: { ...account }, wallet: profile.wallet });
  const applyUpdate = (
    current: Record<string, unknown>,
    data: Record<string, unknown>,
  ): Record<string, unknown> => {
    const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
    return { ...current, ...data, version: Number(current.version) + increment };
  };
  const accountDelegate = {
    updateMany: vi.fn(async ({ data, where }: {
      data: Record<string, unknown>;
      where: { id: string; version: number };
    }) => {
      if (where.id !== accountId || where.version !== account.version) return { count: 0 };
      account = applyUpdate(account, data);
      return { count: 1 };
    }),
  };
  const profileDelegate = {
    findFirst: vi.fn(async () => hydrate()),
    findUnique: vi.fn(async () => hydrate()),
    updateMany: vi.fn(async ({ data, where }: {
      data: Record<string, unknown>;
      where: { id: string; version: number };
    }) => {
      if (where.id !== agentId || where.version !== profile.version) return { count: 0 };
      profile = applyUpdate(profile, data);
      return { count: 1 };
    }),
  };
  const authSession = {
    count: vi.fn(async () => 3),
    updateMany: vi.fn(async () => ({ count: 3 })),
  };
  const preservedFacts = {
    agentInviteCode: { count: vi.fn(async () => 1), updateMany: vi.fn() },
    attributionCandidate: { count: vi.fn(async () => 4), updateMany: vi.fn(async () => ({ count: 4 })) },
    customerAgentBinding: { updateMany: vi.fn() },
    orderAttributionCandidate: { count: vi.fn(async () => 2), updateMany: vi.fn() },
  };
  const transactionStub = {
    $queryRawUnsafe: vi.fn(async (_query: string, namespace: string) => {
      events.push(namespace);
      return [{ acquired: 1 }];
    }),
    $queryRaw: vi.fn(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(' ') ?? '';
      if (sql.includes('agent_profile')) {
        events.push('row:agent-profile');
        return [{ id: agentId }];
      }
      if (sql.includes('auth_session')) {
        events.push('row:password-sessions');
        return [{ id: generateUlid(NOW.getTime() + 1_000) }];
      }
      events.push('row:account');
      return [{ id: accountId }];
    }),
    account: accountDelegate,
    agentProfile: profileDelegate,
    authSession,
    ...preservedFacts,
  };
  return {
    accountDelegate,
    authSession,
    events,
    preservedFacts,
    profileDelegate,
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

function inviteRecord(overrides: Record<string, unknown> = {}) {
  return {
    agent_id: agentId,
    code_ciphertext: Buffer.from('encrypted-invite'),
    code_hash: 'a'.repeat(64),
    code_last4: 'ABCD',
    created_at: new Date(NOW.getTime() - 20_000),
    effective_at: new Date(NOW.getTime() - 20_000),
    encryption_key_id: 'field-key-2026-09',
    ended_at: null,
    end_reason: null,
    expires_at: new Date(NOW.getTime() + 86_400_000),
    id: inviteCodeId,
    status: 'ACTIVE',
    ...overrides,
  };
}

function b132Harness() {
  let profile = agentRecord();
  let invite = inviteRecord();
  let whitelist: Record<string, unknown>[] = [];
  const events: string[] = [];
  const hydrate = () => ({ ...profile, account: { ...(profile.account as Record<string, unknown>) } });
  const profileDelegate = {
    findFirst: vi.fn(async () => hydrate()),
    findUnique: vi.fn(async () => hydrate()),
    updateMany: vi.fn(async ({ data, where }: {
      data: Record<string, unknown>;
      where: { id: string; version: number };
    }) => {
      if (where.id !== agentId || where.version !== profile.version) return { count: 0 };
      const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
      profile = { ...profile, ...data, version: Number(profile.version) + increment };
      return { count: 1 };
    }),
  };
  const whitelistDelegate = {
    createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => ({ count: data.length })),
    findMany: vi.fn(async () => whitelist),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const inviteDelegate = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    findFirst: vi.fn(async () => null),
    findMany: vi.fn(async () => [invite]),
    findUnique: vi.fn(async () => invite),
    updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      invite = { ...invite, ...data };
      return { count: 1 };
    }),
  };
  const preservedFacts = {
    commissionLedger: { updateMany: vi.fn() },
    customerAgentBinding: { count: vi.fn(async () => 4), updateMany: vi.fn() },
    orderItemCommissionSnapshot: { updateMany: vi.fn() },
    promotionAsset: { count: vi.fn(async () => 2), updateMany: vi.fn() },
    salesOrder: { updateMany: vi.fn() },
  };
  const transactionStub = {
    $queryRaw: vi.fn(async (query: { strings?: readonly string[] }) => {
      const sql = query.strings?.join(' ') ?? '';
      if (sql.includes('public.product')) {
        return [secondProductId, thirdProductId].map((id) => ({ id }));
      }
      if (sql.includes('agent_profile')) return [{ id: agentId }];
      if (sql.includes('agent_invite_code')) return [{ id: inviteCodeId }];
      if (sql.includes('account')) return [{ id: accountId }];
      return [];
    }),
    $queryRawUnsafe: vi.fn(async (_query: string, namespace: string) => {
      events.push(namespace);
      return [{ acquired: 1 }];
    }),
    agentInviteCode: inviteDelegate,
    agentProductWhitelist: whitelistDelegate,
    agentProfile: profileDelegate,
    attributionCandidate: {
      count: vi.fn(async () => 3),
      updateMany: vi.fn(async () => ({ count: 3 })),
    },
    ...preservedFacts,
  };
  return {
    events,
    inviteDelegate,
    preservedFacts,
    profileDelegate,
    setWhitelist: (records: Record<string, unknown>[]) => { whitelist = records; },
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
    whitelistDelegate,
  };
}

describe('AdminAgentRepository', () => {
  it('creates Account, AgentProfile, AgentWallet, and the initial invite atomically from opaque material', async () => {
    const harness = createHarness();
    const input = createInput();

    const result = await repository().createAgentInTransaction(harness.transaction, input);

    expect(harness.transactionStub.$queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([
      'admin-agent-login',
      'admin-agent-number',
      'admin-agent-invite',
    ]);
    expect(harness.accountDelegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      id: accountId,
      login_name: 'agent.one',
      must_change_password: true,
      password_hash: input.passwordHash,
      role: 'AGENT_ADMIN',
      status: 'ACTIVE',
      version: 1,
    }) });
    expect(harness.profileDelegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      account_id: accountId,
      contact_phone_ciphertext: Buffer.from(input.contactPhone!.ciphertext),
      contact_phone_last4: '5678',
      id: agentId,
      status: 'ACTIVE',
    }) });
    expect(harness.walletDelegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      agent_id: agentId,
      available_balance: new Prisma.Decimal(0),
      frozen_balance: new Prisma.Decimal(0),
      id: walletId,
    }) });
    expect(harness.inviteDelegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      agent_id: agentId,
      code_ciphertext: Buffer.from(input.inviteCode.ciphertext),
      code_hash: input.inviteCode.codeHash,
      code_last4: 'WXYZ',
      status: 'ACTIVE',
    }) });
    expect(result).toMatchObject({
      agent: { id: agentId, status: 'ACTIVE', version: 1 },
      initialInviteCode: { codeMasked: '****WXYZ', id: inviteCodeId, status: 'ACTIVE', version: 1 },
    });
  });

  it('rejects unsupported plaintext-bearing create fields before taking a lock', async () => {
    const harness = createHarness();
    const unsafeInput = { ...createInput(), temporaryPassword: 'PlaintextMustNotCrossRepository' };

    await expect(repository().createAgentInTransaction(
      harness.transaction,
      unsafeInput as unknown as CreateAdminAgentInput,
    )).rejects.toThrow('unsupported or missing fields');
    expect(harness.transactionStub.$queryRawUnsafe).not.toHaveBeenCalled();
    expect(harness.accountDelegate.create).not.toHaveBeenCalled();
  });

  it('returns stable list aggregates without exposing encrypted contact material', async () => {
    const record = agentRecord();
    const prismaStub = {
      agentProfile: {
        count: vi.fn(async () => 1),
        findMany: vi.fn(async () => [record]),
      },
      customerAgentBinding: {
        groupBy: vi.fn(async () => [{ _count: { _all: 2 }, agent_id: agentId }]),
      },
      salesOrder: {
        groupBy: vi.fn(async () => [{
          _sum: { paid_amount: new Prisma.Decimal('100.00'), refunded_amount: new Prisma.Decimal('12.34') },
          final_agent_id: agentId,
        }]),
      },
    };

    const result = await repository(prismaStub as unknown as PrismaClient).listAgents({ page: 1, pageSize: 20 });

    expect(prismaStub.agentProfile.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 20,
    }));
    expect(result).toEqual({
      items: [expect.objectContaining({
        activeCustomerCount: 2,
        availableBalance: '33.10',
        accountAlias: 'AGT-000001',
        contactPhoneTail: '5678',
        id: agentId,
        netSalesAmount: '87.66',
      })],
      total: 1,
    });
    expect(result.items[0]).not.toHaveProperty('contactPhoneCiphertext');
    expect(result.items[0]).not.toHaveProperty('passwordHash');
  });

  it.each([
    ['a missing login name', agentRecord({ account: accountRecord({ login_name: null }) })],
    ['a non-manageable account status', agentRecord({
      account: accountRecord({ status: 'DELETION_PENDING' }),
    })],
    ['an account/profile status mismatch', agentRecord({
      account: accountRecord({ status: 'DISABLED' }),
    })],
  ])('fails closed with a state conflict for historical envelope drift: %s', async (_label, record) => {
    const prismaStub = {
      agentProfile: { findFirst: vi.fn(async () => record) },
    };

    await expect(repository(prismaStub as unknown as PrismaClient).getAgentDetail(agentId))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('returns real detail aggregates and derives an expired masked invite', async () => {
    const latestWithdrawalAt = new Date(NOW.getTime() - 5_000);
    const record = agentRecord({
      invite_codes: [{
        agent_id: agentId,
        code_ciphertext: Buffer.from('encrypted-invite'),
        code_hash: 'b'.repeat(64),
        code_last4: 'ABCD',
        created_at: new Date(NOW.getTime() - 10_000),
        effective_at: new Date(NOW.getTime() - 20_000),
        encryption_key_id: 'field-key-2026-09',
        ended_at: null,
        end_reason: null,
        expires_at: new Date(NOW.getTime() - 1),
        id: inviteCodeId,
        status: 'ACTIVE',
      }],
    });
    const prismaStub = {
      agentProfile: { findFirst: vi.fn(async () => record) },
      salesOrder: { aggregate: vi.fn(async () => ({
        _count: { _all: 4 },
        _sum: { paid_amount: new Prisma.Decimal('150.00'), refunded_amount: new Prisma.Decimal('9.25') },
      })) },
      customerAgentBinding: { count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(5) },
      commissionLedger: { aggregate: vi.fn(async () => ({ _sum: { expected_change: new Prisma.Decimal('18.50') } })) },
      withdrawal: {
        aggregate: vi.fn(async () => ({ _max: { created_at: latestWithdrawalAt } })),
        groupBy: vi.fn(async () => [
          { _count: { _all: 2 }, _sum: { amount: new Prisma.Decimal('20.00') }, status: 'PENDING' },
          { _count: { _all: 1 }, _sum: { amount: new Prisma.Decimal('10.00') }, status: 'APPROVED' },
          { _count: { _all: 3 }, _sum: { amount: new Prisma.Decimal('45.00') }, status: 'PAID' },
        ]),
      },
    };

    const result = await repository(prismaStub as unknown as PrismaClient).getAgentDetail(agentId);

    expect(result).toMatchObject({
      inviteCode: { codeMasked: '****ABCD', status: 'EXPIRED', version: 1 },
      operatingSummary: {
        activeCustomerCount: 2,
        netSalesAmount: '140.75',
        newBindingCount: 5,
        paidOrderCount: 4,
      },
      walletSummary: {
        availableBalance: '33.10',
        expectedCommission: '18.50',
        frozenBalance: '4.25',
        negativeBalance: '0.00',
        version: 3,
      },
      withdrawalSummary: {
        approvedCount: 1,
        latestWithdrawalAt,
        paidCount: 3,
        pendingCount: 2,
        totalPaidAmount: '45.00',
      },
    });
  });

  it('updates only mutable profile fields under Agent and Account locks with CAS', async () => {
    const harness = lifecycleHarness();

    const result = await repository().updateAgentInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
      patch: { contactName: null, contactPhone: null, name: 'Renamed Agent' },
    });

    expect(harness.events).toEqual([
      'store-attribution-agent',
      'row:agent-profile',
      'agent-auth-account',
      'row:account',
    ]);
    expect(harness.profileDelegate.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        contact_name: null,
        contact_phone_ciphertext: null,
        contact_phone_encryption_key_id: null,
        contact_phone_last4: null,
        name: 'Renamed Agent',
        version: { increment: 1 },
      }),
      where: { deleted_at: null, id: agentId, version: 1 },
    });
    expect(result).toMatchObject({ contactName: null, contactPhoneTail: null, name: 'Renamed Agent', version: 2 });
  });

  it('previews the full disable and password-reset session impact without mutating state', async () => {
    const record = agentRecord();
    const transactionStub = {
      agentProfile: { findFirst: vi.fn(async () => record) },
      authSession: { count: vi.fn(async () => 3) },
      agentInviteCode: { count: vi.fn(async () => 1) },
      attributionCandidate: { count: vi.fn(async () => 4) },
      orderAttributionCandidate: { count: vi.fn(async () => 2) },
    };
    const transaction = transactionStub as unknown as DatabaseTransaction;

    await expect(repository().getDisableImpactInTransaction(transaction, agentId)).resolves.toMatchObject({
      activeCandidateCount: 4,
      activeInviteCount: 1,
      activeSessionCount: 3,
      pendingPaymentOrderCount: 2,
    });
    await expect(repository().getPasswordResetImpactInTransaction(transaction, agentId)).resolves.toMatchObject({
      activeSessionCount: 3,
      agent: { id: agentId },
    });
    expect(transactionStub.authSession.count).toHaveBeenCalledWith({ where: expect.objectContaining({
      account_id: accountId,
      assurance: 'PASSWORD',
      revoked_at: null,
    }) });
  });

  it('disables under the shared attribution-to-session lock order and invalidates live candidates atomically', async () => {
    const harness = lifecycleHarness('ACTIVE');

    const result = await repository().disableAgentInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
    });

    expect(harness.events).toEqual([
      'store-attribution-agent',
      'row:agent-profile',
      'agent-auth-account',
      'row:account',
      'agent-auth-account-sessions',
      'row:password-sessions',
    ]);
    expect(harness.authSession.updateMany).toHaveBeenCalledWith({
      data: { last_seen_at: NOW, revoked_at: NOW },
      where: { account_id: accountId, assurance: 'PASSWORD', revoked_at: null },
    });
    expect(harness.preservedFacts.attributionCandidate.updateMany).toHaveBeenCalledWith({
      data: { invalid_reason: 'AGENT_DISABLED', status: 'INVALIDATED', updated_at: NOW },
      where: { agent_id: agentId, expires_at: { gt: NOW }, status: 'ACTIVE' },
    });
    expect(result).toMatchObject({
      accountVersion: 8,
      agent: { accountStatus: 'DISABLED', status: 'DISABLED', version: 2 },
      occurredAt: NOW,
      revokedSessionCount: 3,
    });
    for (const delegate of [
      harness.preservedFacts.agentInviteCode,
      harness.preservedFacts.customerAgentBinding,
      harness.preservedFacts.orderAttributionCandidate,
    ]) {
      expect(delegate.updateMany).not.toHaveBeenCalled();
    }
  });

  it('reactivates the account and profile without reviving or rewriting old sessions and attribution facts', async () => {
    const harness = lifecycleHarness('DISABLED');

    const result = await repository().reactivateAgentInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
    });

    expect(harness.events).toEqual([
      'store-attribution-agent',
      'row:agent-profile',
      'agent-auth-account',
      'row:account',
    ]);
    expect(harness.authSession.updateMany).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accountVersion: 8,
      agent: { accountStatus: 'ACTIVE', status: 'ACTIVE', version: 2 },
      revokedSessionCount: 0,
    });
    for (const delegate of Object.values(harness.preservedFacts)) {
      expect(delegate.updateMany).not.toHaveBeenCalled();
    }
  });

  it('resets the password after profile/account/session locks and revokes every PASSWORD session', async () => {
    const harness = lifecycleHarness('ACTIVE');
    const passwordHash = '$argon2id$v=19$m=65536,t=3,p=1$new-temporary-password-hash';

    const result = await repository().resetAgentPasswordInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
      passwordHash,
    });

    expect(harness.events).toEqual([
      'store-attribution-agent',
      'row:agent-profile',
      'agent-auth-account',
      'row:account',
      'agent-auth-account-sessions',
      'row:password-sessions',
    ]);
    expect(harness.accountDelegate.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        must_change_password: true,
        password_hash: passwordHash,
        version: { increment: 1 },
      }),
      where: { id: accountId, role: 'AGENT_ADMIN', version: 7 },
    });
    expect(harness.authSession.updateMany).toHaveBeenCalledWith({
      data: { last_seen_at: NOW, revoked_at: NOW },
      where: { account_id: accountId, assurance: 'PASSWORD', revoked_at: null },
    });
    expect(result).toMatchObject({
      accountVersion: 8,
      agent: { status: 'ACTIVE', version: 2 },
      revokedSessionCount: 3,
    });
  });

  it('updates the canonical whitelist under Agent/Product locks by soft-deleting, reviving, and inserting rows', async () => {
    const harness = b132Harness();
    harness.setWhitelist([
      { deleted_at: null, id: generateUlid(NOW.getTime() - 5_000), product_id: firstProductId },
      { deleted_at: new Date(NOW.getTime() - 1_000), id: generateUlid(NOW.getTime() - 4_000),
        product_id: secondProductId },
    ]);

    const result = await repository().updateProductAuthorizationInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
      mode: 'CUSTOM_WHITELIST',
      productIds: [thirdProductId, secondProductId],
    });

    expect(harness.events).toEqual([
      'store-attribution-agent',
      'agent-auth-account',
      'store-attribution-product',
      'store-attribution-product',
    ]);
    expect(harness.whitelistDelegate.updateMany).toHaveBeenNthCalledWith(1, {
      data: { deleted_at: NOW },
      where: {
        agent_id: agentId,
        deleted_at: null,
        product_id: { notIn: [secondProductId, thirdProductId] },
      },
    });
    expect(harness.whitelistDelegate.updateMany).toHaveBeenNthCalledWith(2, {
      data: { deleted_at: null },
      where: {
        agent_id: agentId,
        deleted_at: { not: null },
        product_id: { in: [secondProductId, thirdProductId] },
      },
    });
    expect(harness.whitelistDelegate.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        agent_id: agentId,
        deleted_at: null,
        product_id: thirdProductId,
      })],
    });
    expect(result).toEqual({
      after: {
        agentId,
        mode: 'CUSTOM_WHITELIST',
        productIds: [secondProductId, thirdProductId],
        version: 2,
      },
      before: {
        agentId,
        mode: 'ALL_ACTIVE_PRODUCTS',
        productIds: [],
        version: 1,
      },
      occurredAt: NOW,
    });
    for (const delegate of Object.values(harness.preservedFacts)) expect(delegate.updateMany).not.toHaveBeenCalled();
  });

  it('reads only live whitelist rows into the canonical product authorization snapshot', async () => {
    const prismaStub = {
      agentProfile: {
        findFirst: vi.fn(async () => agentRecord({
          product_authorization_mode: 'CUSTOM_WHITELIST',
          product_whitelist: [
            { deleted_at: NOW, id: generateUlid(), product_id: firstProductId },
            { deleted_at: null, id: generateUlid(), product_id: thirdProductId },
            { deleted_at: null, id: generateUlid(), product_id: secondProductId },
          ],
        })),
      },
    };

    await expect(repository(prismaStub as unknown as PrismaClient).getProductAuthorization(agentId)).resolves.toEqual({
      agentId,
      mode: 'CUSTOM_WHITELIST',
      productIds: [secondProductId, thirdProductId],
      version: 1,
    });
  });

  it('rotates the invite and invalidates only live candidates without rewriting promotion or historical finance facts', async () => {
    const harness = b132Harness();
    const result = await repository().rotateInviteCodeInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
      inviteCode: {
        ciphertext: Uint8Array.from([9, 8, 7]),
        codeHash: 'b'.repeat(64),
        encryptionKeyId: 'field-key-2026-09',
        expiresAt: new Date(NOW.getTime() + 172_800_000),
        last4: 'WXYZ',
      },
      inviteCodeId: rotatedInviteCodeId,
    });

    expect(harness.events).toEqual([
      'store-attribution-agent',
      'agent-auth-account',
      'store-attribution-invite',
      'admin-agent-invite',
    ]);
    expect(harness.inviteDelegate.updateMany).toHaveBeenCalledWith({
      data: { ended_at: NOW, end_reason: 'ADMIN_ROTATED', status: 'ROTATED' },
      where: { agent_id: agentId, id: inviteCodeId, status: 'ACTIVE' },
    });
    expect(harness.transactionStub.attributionCandidate.updateMany).toHaveBeenCalledWith({
      data: { invalid_reason: 'INVITE_CODE_ROTATED', status: 'INVALIDATED', updated_at: NOW },
      where: { expires_at: { gt: NOW }, invite_code_id: inviteCodeId, status: 'ACTIVE' },
    });
    expect(harness.inviteDelegate.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      agent_id: agentId,
      code_ciphertext: Buffer.from([9, 8, 7]),
      code_hash: 'b'.repeat(64),
      id: rotatedInviteCodeId,
      status: 'ACTIVE',
    }) });
    expect(result).toMatchObject({
      agent: { id: agentId, version: 2 },
      inviteCode: { codeMasked: '****WXYZ', id: rotatedInviteCodeId, status: 'ACTIVE', version: 2 },
      invalidatedCandidateCount: 3,
      previousInviteCode: { codeMasked: '****ABCD', id: inviteCodeId, version: 1 },
    });
    for (const delegate of Object.values(harness.preservedFacts)) expect(delegate.updateMany).not.toHaveBeenCalled();
  });

  it('previews invite impact from live candidates/assets and current bindings without mutating them', async () => {
    const harness = b132Harness();

    await expect(repository().getInviteRotationImpactInTransaction(harness.transaction, {
      agentId,
      expiresAt: null,
    })).resolves.toMatchObject({
      activeCandidateCount: 3,
      activePromotionAssetCount: 2,
      agent: { id: agentId, version: 1 },
      existingBindingCount: 4,
      inviteCode: { id: inviteCodeId, status: 'ACTIVE', version: 1 },
    });
    expect(harness.transactionStub.attributionCandidate.count).toHaveBeenCalledWith({
      where: { expires_at: { gt: NOW }, invite_code_id: inviteCodeId, status: 'ACTIVE' },
    });
    expect(harness.preservedFacts.promotionAsset.count).toHaveBeenCalledWith({ where: {
      invite_code_id: inviteCodeId,
      revoked_at: null,
      status: 'ACTIVE',
      OR: [{ expires_at: null }, { expires_at: { gt: NOW } }],
    } });
    for (const delegate of Object.values(harness.preservedFacts)) expect(delegate.updateMany).not.toHaveBeenCalled();
  });

  it('maps expired invite administration inputs to a client error', async () => {
    const harness = b132Harness();
    const expired = new Date(NOW.getTime() - 1);

    await expect(repository().getInviteRotationImpactInTransaction(harness.transaction, {
      agentId,
      expiresAt: expired,
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(repository().rotateInviteCodeInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
      inviteCode: { ...createInput().inviteCode, expiresAt: expired },
      inviteCodeId: rotatedInviteCodeId,
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(repository().updateInviteCodeStatusInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
      expiresAt: expired,
      status: 'ACTIVE',
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it('preserves an omitted invite expiry and distinguishes an explicit null when changing status', async () => {
    const harness = b132Harness();
    const disabled = await repository().updateInviteCodeStatusInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 1,
      status: 'DISABLED',
    });

    expect(harness.inviteDelegate.updateMany).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        ended_at: NOW,
        end_reason: 'ADMIN_DISABLED',
        expires_at: inviteRecord().expires_at,
        status: 'DISABLED',
      }),
      where: { agent_id: agentId, id: inviteCodeId, status: 'ACTIVE' },
    });
    expect(disabled.after.expiresAt).toEqual(inviteRecord().expires_at);

    const enabled = await repository().updateInviteCodeStatusInTransaction(harness.transaction, {
      agentId,
      expectedVersion: 2,
      expiresAt: null,
      status: 'ACTIVE',
    });
    expect(harness.inviteDelegate.updateMany).toHaveBeenNthCalledWith(2, {
      data: { ended_at: null, end_reason: null, expires_at: null, status: 'ACTIVE' },
      where: { agent_id: agentId, id: inviteCodeId, status: 'DISABLED' },
    });
    expect(enabled.after).toMatchObject({ expiresAt: null, status: 'ACTIVE', version: 3 });
  });
});
