import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { StoreAttributionRepository } from './store-attribution.repository';

const NOW = new Date('2026-08-27T00:00:00.000Z');
const ACCOUNT_ID = '01K3P9T2P0A000000000000001';
const CUSTOMER_ID = '01K3P9T2P0A000000000000002';
const AGENT_ID = '01K3P9T2P0A000000000000003';
const INVITE_ID = '01K3P9T2P0A000000000000004';
const ASSET_ID = '01K3P9T2P0A000000000000005';
const CANDIDATE_ID = '01K3P9T2P0A000000000000006';
const BINDING_ID = '01K3P9T2P0A000000000000007';
const CHANGE_ID = '01K3P9T2P0A000000000000008';
const INVITE_HASH = '1'.repeat(64);
const TOKEN_HASH = '2'.repeat(64);
const OLD_TOKEN_HASH = '3'.repeat(64);

function activeAccount() {
  return {
    customer_profile: {
      account_id: ACCOUNT_ID,
      anonymized_at: null,
      id: CUSTOMER_ID,
      version: 4,
    },
    deleted_at: null,
    login_name: null,
    password_hash: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    wechat_open_id: 'openid-b73-unit',
  };
}

function activeStorefrontAsset() {
  return {
    agent: {
      account: { deleted_at: null, role: 'AGENT_ADMIN', status: 'ACTIVE' },
      deleted_at: null,
      id: AGENT_ID,
      name: 'B7.3 Service Agent',
      product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
      status: 'ACTIVE',
      version: 3,
    },
    agent_id: AGENT_ID,
    authorization_version: 3,
    expires_at: null,
    id: ASSET_ID,
    invite_code: {
      agent_id: AGENT_ID,
      code_hash: INVITE_HASH,
      effective_at: new Date(NOW.getTime() - 1_000),
      ended_at: null,
      expires_at: new Date(NOW.getTime() + 60_000),
      id: INVITE_ID,
      status: 'ACTIVE',
    },
    invite_code_id: INVITE_ID,
    public_url: 'https://store.example.test/',
    revoked_at: null,
    status: 'ACTIVE',
    target_product: null,
    target_product_id: null,
    target_type: 'STOREFRONT',
  };
}

function transaction(overrides: Record<string, unknown> = {}) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    account: { findUnique: vi.fn().mockResolvedValue(activeAccount()) },
    attributionCandidate: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        expires_at: data.expires_at,
        id: data.id,
      })),
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    bindingChangeLog: { create: vi.fn().mockResolvedValue({}) },
    customerAgentBinding: { findMany: vi.fn().mockResolvedValue([]) },
    customerProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    promotionAsset: {
      findUnique: vi.fn()
        .mockResolvedValueOnce({ agent_id: AGENT_ID, invite_code_id: INVITE_ID, target_product_id: null })
        .mockResolvedValueOnce(activeStorefrontAsset()),
    },
    ...overrides,
  };
}

function repository(prisma: Partial<PrismaClient> = {}) {
  return new StoreAttributionRepository(prisma as PrismaClient, () => new Date(NOW));
}

describe('StoreAttributionRepository', () => {
  it('creates an anonymous candidate with a repository-owned 30 minute TTL', async () => {
    const tx = transaction();
    const result = await repository().createAnonymousCandidateInTransaction(tx as never, {
      candidateId: CANDIDATE_ID,
      candidateTokenHash: TOKEN_HASH,
      inviteCodeHashCandidates: [INVITE_HASH],
      promotionAssetId: ASSET_ID,
    });

    expect(result).toEqual({
      candidate: {
        agentId: AGENT_ID,
        displayName: 'B7.3 Service Agent',
        expiresAt: new Date(NOW.getTime() + 30 * 60 * 1_000),
        id: CANDIDATE_ID,
        publicTargetUrl: 'https://store.example.test/',
      },
      kind: 'candidate',
    });
    expect(tx.attributionCandidate.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        candidate_token_hash: TOKEN_HASH,
        customer_id: null,
        status: 'ACTIVE',
      }),
    }));
  });

  it('maps a missing anonymous replacement credential to AUTH_REQUIRED and does not inspect the new target', async () => {
    const findPromotion = vi.fn();
    const tx = transaction({
      attributionCandidate: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      promotionAsset: { findUnique: findPromotion },
    });

    await expect(repository().createAnonymousCandidateInTransaction(tx as never, {
      candidateId: CANDIDATE_ID,
      candidateTokenHash: TOKEN_HASH,
      inviteCodeHashCandidates: [INVITE_HASH],
      promotionAssetId: ASSET_ID,
      replacementTokenHashCandidates: [OLD_TOKEN_HASH],
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });
    expect(findPromotion).not.toHaveBeenCalled();
    expect(tx.attributionCandidate.update).not.toHaveBeenCalled();
  });

  it('returns an existing binding before resolving a newly opened promotion link', async () => {
    const findPromotion = vi.fn(() => {
      throw new Error('promotion target must not be read for an already-bound customer');
    });
    const tx = transaction({
      customerAgentBinding: {
        findMany: vi.fn().mockResolvedValue([{
          agent: { id: AGENT_ID, name: 'Existing Agent' },
          started_at: new Date('2026-08-01T00:00:00.000Z'),
        }]),
      },
      promotionAsset: { findUnique: findPromotion },
    });

    await expect(repository().createCustomerCandidateInTransaction(tx as never, {
      accountId: ACCOUNT_ID,
      candidateId: CANDIDATE_ID,
      customerId: CUSTOMER_ID,
      inviteCodeHashCandidates: [INVITE_HASH],
      promotionAssetId: ASSET_ID,
    })).resolves.toEqual({
      kind: 'service_agent',
      serviceAgent: {
        agentId: AGENT_ID,
        boundAt: new Date('2026-08-01T00:00:00.000Z'),
        displayName: 'Existing Agent',
      },
    });
    expect(findPromotion).not.toHaveBeenCalled();
    expect(tx.customerProfile.updateMany).not.toHaveBeenCalled();
  });

  it('keeps an existing disabled agent visible through the minimal service-agent projection', async () => {
    const tx = transaction({
      customerAgentBinding: {
        findMany: vi.fn().mockResolvedValue([{
          agent: { id: AGENT_ID, name: 'Disabled But Bound' },
          started_at: new Date('2026-07-01T00:00:00.000Z'),
        }]),
      },
    });
    const prisma = {
      $transaction: vi.fn(async (work: (value: DatabaseTransaction) => Promise<unknown>) => work(tx as never)),
    } as unknown as PrismaClient;

    await expect(repository(prisma).getCurrentServiceAgent({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
    })).resolves.toEqual({
      agentId: AGENT_ID,
      boundAt: new Date('2026-07-01T00:00:00.000Z'),
      displayName: 'Disabled But Bound',
    });
  });

  it('returns the winning binding on a later confirm without consuming another candidate or version', async () => {
    const tx = transaction({
      attributionCandidate: {
        create: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      customerAgentBinding: {
        findMany: vi.fn().mockResolvedValue([{
          agent: { id: AGENT_ID, name: 'Winning Agent' },
          started_at: new Date('2026-08-10T00:00:00.000Z'),
        }]),
      },
    });

    await expect(repository().confirmCurrentCandidateInTransaction(tx as never, {
      accountId: ACCOUNT_ID,
      bindingChangeLogId: CHANGE_ID,
      bindingId: BINDING_ID,
      customerId: CUSTOMER_ID,
    })).resolves.toMatchObject({ agentId: AGENT_ID, displayName: 'Winning Agent' });
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(tx.bindingChangeLog.create).not.toHaveBeenCalled();
    expect(tx.customerProfile.updateMany).not.toHaveBeenCalled();
  });

  it('rejects malformed hash rings and invalid clocks before touching persistence', async () => {
    expect(() => new StoreAttributionRepository({} as PrismaClient, () => new Date('invalid'))).toThrow(
      'Store attribution clock must return a valid Date',
    );
    await expect(repository().getAnonymousCandidate([])).rejects.toThrow(
      'Candidate token hash candidates must contain between one and four digests',
    );
    await expect(repository().getAnonymousCandidate([TOKEN_HASH, TOKEN_HASH])).rejects.toThrow(
      'Candidate token hash candidates must not contain duplicate digests',
    );
  });
});
