import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentStoreSession,
  DatabaseRuntime,
  DatabaseTransaction,
  StoreAttributionCandidateSnapshot,
  StoreServiceAgentSnapshot,
} from '@qingxu/database';
import { hmacStoreInviteCode } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreAttributionService } from './store-attribution.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const CANDIDATE_ID = '01J00000000000000000000002';
const AGENT_ID = '01J00000000000000000000003';
const PROMOTION_ID = '01J00000000000000000000004';
const SESSION_ID = '01J00000000000000000000005';
const SESSION_FAMILY = '01J00000000000000000000006';
const KEY = '018f47a2-9f61-7c4f-8b6e-9a61b3470f2e';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-08-27T06:00:00.000Z');
const INVITE_CODE = 'QY8K2P';
const EXISTING_TOKEN_HASH = 'a'.repeat(64);

const AUTH_CURRENT = { id: 'auth-v2', key: Buffer.alloc(32, 11) };
const AUTH_PREVIOUS = { id: 'auth-v1', key: Buffer.alloc(32, 12) };

function config(): PlatformRuntimeConfig {
  return {
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-web',
      issuer: 'qingxu-api-attribution-test',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: { current: AUTH_CURRENT, previous: [AUTH_PREVIOUS] },
      sessionTtlSeconds: 604_800,
      signingKeys: { current: { id: 'sign-v1', key: Buffer.alloc(32, 13) }, previous: [] },
    },
    encryption: {
      fieldKeys: { current: { id: 'field-v1', key: Buffer.alloc(32, 14) }, previous: [] },
      idempotencyHashKeys: {
        current: { id: 'idem-v1', key: Buffer.alloc(32, 15) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 16),
    },
    environment: 'test',
    store: {
      authTokenAudience: 'qingxu-store',
      identityProvider: 'MOCK',
      legalDocuments: {
        phoneAuthorization: { title: 'Phone', url: 'https://example.test/phone', version: 'phone-v1' },
        privacyPolicy: { title: 'Privacy', url: 'https://example.test/privacy', version: 'privacy-v1' },
        userAgreement: { title: 'Terms', url: 'https://example.test/terms', version: 'terms-v1' },
      },
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
      phoneHashKeys: {
        current: { id: 'phone-v1', key: Buffer.alloc(32, 17) },
        previous: [],
      },
      phoneProvider: 'MOCK',
      wechatAppId: 'mock-store-app',
      wechatAppSecret: undefined,
    },
  } as unknown as PlatformRuntimeConfig;
}

function session(): CurrentStoreSession {
  return {
    accessJti: 'access-jti-attribution-test',
    accountId: ACCOUNT_ID,
    accountVersion: 1,
    customerId: CUSTOMER_ID,
    customerVersion: 1,
    expiresAt: new Date(NOW.getTime() + 3_600_000),
    sessionFamily: SESSION_FAMILY,
    sessionId: SESSION_ID,
  };
}

function candidate(): StoreAttributionCandidateSnapshot {
  return {
    agentId: AGENT_ID,
    displayName: 'Qingxu Agent',
    expiresAt: new Date(NOW.getTime() + 30 * 60_000),
    id: CANDIDATE_ID,
    publicTargetUrl: 'https://mall.example.test/products/cleanser',
  };
}

function serviceAgent(): StoreServiceAgentSnapshot {
  return {
    agentId: AGENT_ID,
    boundAt: new Date(NOW.getTime() - 60_000),
    displayName: 'Qingxu Agent',
  };
}

function harness() {
  const transaction = {} as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => unknown) => work(transaction)),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const attribution = {
    confirmCurrentCandidateInTransaction: vi.fn().mockResolvedValue(serviceAgent()),
    createAnonymousCandidateInTransaction: vi.fn().mockResolvedValue({
      candidate: candidate(), kind: 'candidate',
    }),
    createCustomerCandidateInTransaction: vi.fn().mockResolvedValue({
      candidate: candidate(), kind: 'candidate',
    }),
    getAnonymousCandidate: vi.fn().mockResolvedValue(candidate()),
    getCurrentCustomerCandidate: vi.fn().mockResolvedValue(candidate()),
    getCurrentServiceAgent: vi.fn().mockResolvedValue(serviceAgent()),
    rejectCurrentCandidateInTransaction: vi.fn().mockResolvedValue({
      candidateId: CANDIDATE_ID, rejectedAt: NOW,
    }),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  const service = new StoreAttributionService(config(), database);
  Object.assign(service as unknown as Record<string, unknown>, { attribution, audit, idempotency });
  return { attribution, audit, idempotency, prisma, service, transaction };
}

describe('B7.3 Store attribution service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(NOW.getTime());
  });

  it('creates an anonymous candidate with a one-time token, current hash and HASH_ONLY facts', async () => {
    const { attribution, audit, idempotency, service } = harness();
    const response = await service.createCandidate(
      { kind: 'ANONYMOUS' },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
      '127.0.0.1',
    );

    expect(response).toMatchObject({
      candidate: {
        agent_id: AGENT_ID,
        attribution_eligible: true,
        candidate_id: CANDIDATE_ID,
        confirmation_required: true,
        display_name: 'Qingxu Agent',
        public_target_url: 'https://mall.example.test/products/cleanser',
        remaining_seconds: 1_800,
      },
      candidate_token: expect.stringMatching(/^cnd_[A-Za-z0-9_-]{43}$/),
      public_fallback: null,
      service_agent: null,
    });
    const repositoryInput = attribution.createAnonymousCandidateInTransaction.mock.calls[0]?.[1];
    expect(repositoryInput).toMatchObject({
      candidateId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
      candidateTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      inviteCodeHashCandidates: [
        hmacStoreInviteCode(INVITE_CODE, AUTH_CURRENT.key),
        hmacStoreInviteCode(INVITE_CODE, AUTH_PREVIOUS.key),
      ],
      promotionAssetId: PROMOTION_ID,
    });
    expect(repositoryInput.candidateTokenHash).not.toBe(response.candidate_token);
    expect(JSON.stringify(repositoryInput)).not.toContain(INVITE_CODE);
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'CREATE',
      ipAddress: '127.0.0.1',
      module: 'attribution',
      objectId: PROMOTION_ID,
      objectType: 'promotion',
      summaryPolicy: 'NONE',
    }));
    expect(audit.append.mock.calls[0]?.[1]).not.toHaveProperty('actorAccountId');
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: CANDIDATE_ID,
      responseForHash: { candidate_id: CANDIDATE_ID, kind: 'candidate' },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(JSON.stringify(idempotency.complete.mock.calls)).not.toContain(response.candidate_token);
  });

  it('replaces only the candidate identified by validated hash candidates and returns a new token', async () => {
    const { attribution, service } = harness();
    const response = await service.createCandidate(
      { kind: 'CANDIDATE_TOKEN', tokenHashCandidates: [EXISTING_TOKEN_HASH] },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
    );
    expect(attribution.createAnonymousCandidateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ replacementTokenHashCandidates: [EXISTING_TOKEN_HASH] }),
    );
    expect(response.candidate_token).toMatch(/^cnd_/);
  });

  it('validates candidate credentials before idempotency and still revalidates inside the mutation', async () => {
    const invalid = harness();
    invalid.attribution.getAnonymousCandidate.mockResolvedValue(null);
    invalid.idempotency.claim.mockResolvedValue({ kind: 'replay', record: { response_status: 200 } });
    await expect(invalid.service.createCandidate(
      { kind: 'CANDIDATE_TOKEN', tokenHashCandidates: [EXISTING_TOKEN_HASH] },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
    )).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });
    expect(invalid.idempotency.claim).not.toHaveBeenCalled();
    expect(invalid.attribution.createAnonymousCandidateInTransaction).not.toHaveBeenCalled();
    expect(invalid.audit.append).not.toHaveBeenCalled();

    const raced = harness();
    const racedFailure = Object.assign(new Error('candidate expired after preflight'), {
      code: 'AUTH_REQUIRED',
      httpStatus: 401,
    });
    raced.attribution.createAnonymousCandidateInTransaction.mockRejectedValue(racedFailure);
    await expect(raced.service.createCandidate(
      { kind: 'CANDIDATE_TOKEN', tokenHashCandidates: [EXISTING_TOKEN_HASH] },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
    )).rejects.toBe(racedFailure);
    expect(raced.attribution.getAnonymousCandidate).toHaveBeenCalledWith([EXISTING_TOKEN_HASH]);
    expect(raced.attribution.createAnonymousCandidateInTransaction).toHaveBeenCalledOnce();
    expect(raced.idempotency.complete).not.toHaveBeenCalled();
    expect(raced.audit.append).not.toHaveBeenCalled();
  });

  it('returns a customer candidate without issuing a token', async () => {
    const { attribution, audit, service } = harness();
    const response = await service.createCandidate(
      { kind: 'CUSTOMER', session: session() },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
    );
    expect(response).toMatchObject({ candidate: { candidate_id: CANDIDATE_ID }, candidate_token: null });
    expect(attribution.createCustomerCandidateInTransaction).toHaveBeenCalledWith(expect.anything(),
      expect.objectContaining({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID }));
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actorAccountId: ACCOUNT_ID, actorRole: 'CUSTOMER',
    }));
  });

  it('returns the exact bound and public fallback branches without a candidate token', async () => {
    const bound = harness();
    bound.attribution.createCustomerCandidateInTransaction.mockResolvedValue({
      kind: 'service_agent', serviceAgent: serviceAgent(),
    });
    await expect(bound.service.createCandidate(
      { kind: 'CUSTOMER', session: session() },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
    )).resolves.toEqual({
      candidate: null,
      candidate_token: null,
      public_fallback: null,
      service_agent: {
        agent_id: AGENT_ID,
        bound_at: serviceAgent().boundAt.toISOString(),
        display_name: 'Qingxu Agent',
      },
    });

    const fallback = harness();
    fallback.attribution.createAnonymousCandidateInTransaction.mockResolvedValue({
      kind: 'public_fallback', publicTargetUrl: candidate().publicTargetUrl,
    });
    await expect(fallback.service.createCandidate(
      { kind: 'ANONYMOUS' },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
    )).resolves.toEqual({
      candidate: null,
      candidate_token: null,
      public_fallback: {
        attribution_eligible: false,
        public_target_url: candidate().publicTargetUrl,
      },
      service_agent: null,
    });
  });

  it('queries both subjects without consuming or returning a candidate token', async () => {
    const { attribution, service } = harness();
    await expect(service.getCurrentCandidate({
      kind: 'CANDIDATE_TOKEN', tokenHashCandidates: [EXISTING_TOKEN_HASH],
    })).resolves.toMatchObject({ candidate_id: CANDIDATE_ID, remaining_seconds: 1_800 });
    expect(attribution.getAnonymousCandidate).toHaveBeenCalledWith([EXISTING_TOKEN_HASH]);

    await expect(service.getCurrentCandidate({ kind: 'CUSTOMER', session: session() }))
      .resolves.toMatchObject({ candidate_id: CANDIDATE_ID });
    expect(attribution.getCurrentCustomerCandidate).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID, customerId: CUSTOMER_ID,
    });
  });

  it('treats a missing candidate-token subject as invalid credentials but allows customer null', async () => {
    const candidateCredential = harness();
    candidateCredential.attribution.getAnonymousCandidate.mockResolvedValue(null);
    await expect(candidateCredential.service.getCurrentCandidate({
      kind: 'CANDIDATE_TOKEN', tokenHashCandidates: [EXISTING_TOKEN_HASH],
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });

    const customer = harness();
    customer.attribution.getCurrentCustomerCandidate.mockResolvedValue(null);
    await expect(customer.service.getCurrentCandidate({ kind: 'CUSTOMER', session: session() }))
      .resolves.toBeNull();
    await expect(customer.service.getCurrentCandidate({ kind: 'ANONYMOUS' }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('confirms, rejects and reads only the minimum service-agent projection', async () => {
    const confirmed = harness();
    await expect(confirmed.service.confirmCandidate(session(), KEY, REQUEST_ID, '127.0.0.1'))
      .resolves.toEqual({
        agent_id: AGENT_ID,
        bound_at: serviceAgent().boundAt.toISOString(),
        display_name: 'Qingxu Agent',
      });
    expect(confirmed.attribution.confirmCurrentCandidateInTransaction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        bindingChangeLogId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        bindingId: expect.stringMatching(/^[0-9A-HJKMNP-TV-Z]{26}$/),
        customerId: CUSTOMER_ID,
      }),
    );
    expect(confirmed.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: AGENT_ID,
      responseForHash: { agent_id: AGENT_ID, bound_at: serviceAgent().boundAt.toISOString() },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });

    const rejected = harness();
    await expect(rejected.service.rejectCandidate(session(), KEY, REQUEST_ID)).resolves.toEqual({
      candidate_id: CANDIDATE_ID,
      rejected_at: NOW.toISOString(),
      status: 'REJECTED',
    });
    expect(rejected.audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'REJECT', objectId: CUSTOMER_ID,
    }));

    const current = harness();
    await expect(current.service.getServiceAgent(session())).resolves.toEqual({
      agent_id: AGENT_ID,
      bound_at: serviceAgent().boundAt.toISOString(),
      display_name: 'Qingxu Agent',
    });
    expect(JSON.stringify(await current.service.getServiceAgent(session())))
      .not.toMatch(/binding_id|customer_id|customer_version|agent_name/);
  });

  it('rejects a completed replay before repository, audit or token-bearing response work', async () => {
    const { attribution, audit, idempotency, service } = harness();
    idempotency.claim.mockResolvedValue({ kind: 'replay', record: { response_status: 200 } });
    await expect(service.createCandidate(
      { kind: 'ANONYMOUS' },
      { inviteCode: INVITE_CODE, promotionAssetId: PROMOTION_ID },
      KEY,
      REQUEST_ID,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT', httpStatus: 409 });
    expect(attribution.createAnonymousCandidateInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('does not complete idempotency when audit fails inside the mutation transaction', async () => {
    const { audit, idempotency, service } = harness();
    const failure = new Error('audit append failed');
    audit.append.mockRejectedValue(failure);
    await expect(service.confirmCandidate(session(), KEY, REQUEST_ID)).rejects.toBe(failure);
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
