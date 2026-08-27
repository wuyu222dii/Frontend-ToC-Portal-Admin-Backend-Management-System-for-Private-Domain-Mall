import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentStoreSession,
  DatabaseRuntime,
  DatabaseTransaction,
} from '@qingxu/database';
import {
  ApplicationError,
  generateUlid,
  hmacAuthenticationSecret,
  hmacStoreCandidateToken,
  verifyStoreAccessToken,
} from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreIdentityProvider } from './store-identity-provider';
import type { StoreWechatLoginInput } from './store-auth.dto';
import { StoreAuthService } from './store-auth.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const KEY = '018f47a2-9f61-7c4f-8b6e-9a61b3470f2e';
const CANDIDATE_ID = '01J00000000000000000000004';
const CANDIDATE_TOKEN = 'c'.repeat(32);

function config(): PlatformRuntimeConfig {
  return {
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-web',
      issuer: 'qingxu-api-test',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: {
        current: { id: 'auth-secret-v2', key: Buffer.alloc(32, 5) },
        previous: [{ id: 'auth-secret-v1', key: Buffer.alloc(32, 6) }],
      },
      sessionTtlSeconds: 604_800,
      signingKeys: { current: { id: 'auth-sign-v1', key: Buffer.alloc(32, 7) }, previous: [] },
    },
    encryption: {
      fieldKeys: { current: { id: 'field-v1', key: Buffer.alloc(32, 1) }, previous: [] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
    environment: 'test',
    store: {
      authTokenAudience: 'qingxu-store',
      identityProvider: 'MOCK',
      phoneHashKeys: { current: { id: 'store-phone-v1', key: Buffer.alloc(32, 8) }, previous: [] },
      phoneProvider: 'MOCK',
      wechatAppId: 'mock-app',
      wechatAppSecret: undefined,
      legalDocuments: {
        userAgreement: { version: 'user-v1', title: 'User agreement', url: 'https://example.test/user' },
        privacyPolicy: { version: 'privacy-v1', title: 'Privacy policy', url: 'https://example.test/privacy' },
        phoneAuthorization: { version: 'phone-v1', title: 'Phone notice', url: 'https://example.test/phone' },
      },
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
    },
  } as unknown as PlatformRuntimeConfig;
}

function loginInput(candidateToken: string | null = null): StoreWechatLoginInput {
  return {
    candidateToken,
    code: 'mock:customer_0001',
    consents: [
      { accepted: true as const, documentVersion: 'user-v1', type: 'USER_AGREEMENT' as const },
      { accepted: true as const, documentVersion: 'privacy-v1', type: 'PRIVACY_POLICY' as const },
    ],
  };
}

function harness() {
  const transaction = {} as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => unknown) => work(transaction)),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const provider = { exchange: vi.fn().mockResolvedValue({ openId: 'mock_open_id', unionId: null }) };
  const auth = {
    resolveCustomerInTransaction: vi.fn().mockResolvedValue({
      accountId: ACCOUNT_ID, accountVersion: 1, customerId: CUSTOMER_ID, customerVersion: 1, created: true,
    }),
    createLoginSessionInTransaction: vi.fn(async (_transaction, input) => ({
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      customerId: CUSTOMER_ID,
      customerVersion: 1,
      session: { id: input.session.id },
    })),
    findRefreshActor: vi.fn().mockResolvedValue(ACCOUNT_ID),
    rotateRefreshInTransaction: vi.fn(async (_transaction, input) => ({
      kind: 'rotated',
      rotationCounter: 1,
      sessionFamily: generateUlid(),
      sessionId: input.session.id,
    })),
    revokeCurrentSessionInTransaction: vi.fn().mockResolvedValue({ revoked: true }),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const attribution = {
    migrateAnonymousCandidateInTransaction: vi.fn().mockResolvedValue({ kind: 'none' }),
  };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  const service = new StoreAuthService(config(), database, provider as unknown as StoreIdentityProvider);
  Object.assign(service as unknown as Record<string, unknown>, { attribution, auth, audit, idempotency });
  return { attribution, audit, auth, idempotency, provider, service, transaction };
}

describe('B7.1 Store auth service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns the three configured legal documents as the authoritative no-cache payload', () => {
    const { service } = harness();
    expect(service.legalDocuments()).toEqual({
      phone_authorization: {
        content_url: 'https://example.test/phone', document_version: 'phone-v1', required: true,
        title: 'Phone notice', type: 'PHONE_AUTHORIZATION',
      },
      privacy_policy: {
        content_url: 'https://example.test/privacy', document_version: 'privacy-v1', required: true,
        title: 'Privacy policy', type: 'PRIVACY_POLICY',
      },
      user_agreement: {
        content_url: 'https://example.test/user', document_version: 'user-v1', required: true,
        title: 'User agreement', type: 'USER_AGREEMENT',
      },
    });
  });

  it('creates a CUSTOMER/WECHAT session for the final locked account and stores only HASH_ONLY output', async () => {
    const { auth, idempotency, provider, service } = harness();
    const response = await service.login(loginInput(), KEY, REQUEST_ID, '127.0.0.1');

    expect(provider.exchange).toHaveBeenCalledWith('mock:customer_0001');
    expect(auth.createLoginSessionInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      sourceTerminal: 'MP_WEIXIN',
      consents: [
        expect.objectContaining({ type: 'USER_AGREEMENT', documentVersion: 'user-v1' }),
        expect.objectContaining({ type: 'PRIVACY_POLICY', documentVersion: 'privacy-v1' }),
      ],
    }));
    expect(response).toMatchObject({ candidate: null, confirmation_required: false });
    expect(verifyStoreAccessToken({
      audience: 'qingxu-store',
      issuer: 'qingxu-api-test',
      keys: config().authentication.signingKeys,
    }, response.session.access_token)).toMatchObject({ accountId: ACCOUNT_ID, role: 'CUSTOMER' });
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: expect.any(String),
      responseForHash: { account_id: ACCOUNT_ID, candidate_id: null, session_id: expect.any(String) },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    const completed = idempotency.complete.mock.calls.at(-1)?.[2];
    expect(JSON.stringify(completed)).not.toContain(response.session.access_token);
    expect(JSON.stringify(completed)).not.toContain(response.session.refresh_token);
    expect(JSON.stringify(completed)).not.toContain('mock:customer_0001');
  });

  it('rejects stale consent before Provider or database writes', async () => {
    const stale = harness();
    const input = loginInput();
    input.consents[0].documentVersion = 'user-old';
    await expect(stale.service.login(input, KEY, REQUEST_ID)).rejects.toMatchObject({
      code: 'CONSENT_VERSION_MISMATCH',
    });
    expect(stale.provider.exchange).not.toHaveBeenCalled();
    expect(stale.auth.resolveCustomerInTransaction).not.toHaveBeenCalled();

  });

  it('migrates a candidate with current and previous HMACs before session creation and returns its summary', async () => {
    const { attribution, audit, auth, idempotency, provider, service } = harness();
    attribution.migrateAnonymousCandidateInTransaction.mockResolvedValue({
      kind: 'candidate',
      candidate: {
        agentId: '01J00000000000000000000005',
        displayName: 'Development Agent',
        expiresAt: new Date('2026-08-27T04:30:00.000Z'),
        id: CANDIDATE_ID,
        publicTargetUrl: 'https://example.test/products/01J00000000000000000000006',
      },
    });

    const response = await service.login(loginInput(CANDIDATE_TOKEN), KEY, REQUEST_ID, '127.0.0.1');

    expect(provider.exchange).toHaveBeenCalledWith('mock:customer_0001');
    expect(attribution.migrateAnonymousCandidateInTransaction).toHaveBeenCalledWith(expect.anything(), {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      tokenHashCandidates: [
        hmacStoreCandidateToken(CANDIDATE_TOKEN, config().authentication.secretHashKeys.current.key),
        hmacStoreCandidateToken(CANDIDATE_TOKEN, config().authentication.secretHashKeys.previous[0]!.key),
      ],
    });
    expect(attribution.migrateAnonymousCandidateInTransaction.mock.invocationCallOrder[0])
      .toBeLessThan(auth.createLoginSessionInTransaction.mock.invocationCallOrder[0] as number);
    expect(response).toMatchObject({
      candidate: {
        agent_id: '01J00000000000000000000005',
        attribution_eligible: true,
        candidate_id: CANDIDATE_ID,
        display_name: 'Development Agent',
        expires_at: '2026-08-27T04:30:00.000Z',
        public_target_url: 'https://example.test/products/01J00000000000000000000006',
      },
      confirmation_required: true,
      session: { assurance: 'WECHAT', role: 'CUSTOMER' },
    });
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: expect.any(String),
      responseForHash: {
        account_id: ACCOUNT_ID,
        candidate_id: CANDIDATE_ID,
        session_id: expect.any(String),
      },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'TRANSFER',
      actorAccountId: ACCOUNT_ID,
      actorRole: 'CUSTOMER',
      idempotencyKey: KEY,
      module: 'attribution',
      objectId: CUSTOMER_ID,
      objectType: 'customer',
      requestId: REQUEST_ID,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'NONE',
    }));
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(JSON.stringify([
      audit.append.mock.calls,
      idempotency.complete.mock.calls.map((call) => call[2]),
    ])).not.toContain(CANDIDATE_TOKEN);
  });

  it('fails the login transaction when the candidate token no longer matches and never creates a session', async () => {
    const { attribution, auth, idempotency, provider, service } = harness();
    attribution.migrateAnonymousCandidateInTransaction.mockRejectedValue(new ApplicationError(
      'ATTRIBUTION_CANDIDATE_MISMATCH',
      'candidate detail',
    ));

    await expect(service.login(loginInput(CANDIDATE_TOKEN), KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'ATTRIBUTION_CANDIDATE_MISMATCH' });
    expect(provider.exchange).toHaveBeenCalledOnce();
    expect(auth.createLoginSessionInTransaction).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('records invalid Mock credentials as a HASH_ONLY failure without persisting the code', async () => {
    const { audit, idempotency, provider, service } = harness();
    provider.exchange.mockRejectedValue(new ApplicationError('AUTH_REQUIRED', 'invalid code'));
    await expect(service.login(loginInput(), KEY, REQUEST_ID, '127.0.0.1'))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      result: 'FAILURE', resultCode: 'AUTH_REQUIRED', summaryPolicy: 'NONE',
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      responseForHash: { result: 'AUTH_REQUIRED' }, responseStatus: 401, storage: 'HASH_ONLY',
    });
    expect(JSON.stringify(idempotency.complete.mock.calls.at(-1)?.[2])).not.toContain('mock:customer_0001');
    expect(JSON.stringify(audit.append.mock.calls)).not.toContain('mock:customer_0001');
  });

  it('rotates Store refresh tokens with an isolated hash domain and never replays token responses', async () => {
    const { auth, idempotency, service } = harness();
    const response = await service.refresh({ refreshToken: 'rfr_non-production-refresh-token' }, KEY, REQUEST_ID);
    const rotation = auth.rotateRefreshInTransaction.mock.calls[0]?.[1];
    expect(rotation.presentedRefreshTokenHashCandidates).toContain(hmacAuthenticationSecret(
      'rfr_non-production-refresh-token',
      config().authentication.secretHashKeys.current.key,
      'store-refresh-token',
    ));
    expect(rotation.presentedRefreshTokenHashCandidates).not.toContain(hmacAuthenticationSecret(
      'rfr_non-production-refresh-token',
      config().authentication.secretHashKeys.current.key,
      'refresh-token',
    ));
    expect(response).toMatchObject({ role: 'CUSTOMER', assurance: 'WECHAT' });
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({
      responseStatus: 200, storage: 'HASH_ONLY',
    }));

    const replay = harness();
    replay.idempotency.claim.mockResolvedValue({ kind: 'replay', record: { response_status: 200 } });
    await expect(replay.service.refresh(
      { refreshToken: 'rfr_non-production-refresh-token' }, KEY, REQUEST_ID,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(replay.auth.rotateRefreshInTransaction).not.toHaveBeenCalled();
  });

  it('revokes the family on old-token replay with a new key and revokes logout with HASH_ONLY', async () => {
    const oldToken = harness();
    oldToken.auth.rotateRefreshInTransaction.mockResolvedValue({
      kind: 'replay_detected', rotationCounter: 0, sessionFamily: generateUlid(), sessionId: generateUlid(),
    });
    await expect(oldToken.service.refresh(
      { refreshToken: 'rfr_non-production-refresh-token' }, KEY, REQUEST_ID,
    )).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(oldToken.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      responseForHash: { result: 'replay_detected' }, responseStatus: 401, storage: 'HASH_ONLY',
    });

    const logout = harness();
    const session: CurrentStoreSession = {
      accountId: ACCOUNT_ID,
      accountVersion: 1,
      accessJti: `access:${generateUlid()}`,
      customerId: CUSTOMER_ID,
      customerVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
      sessionFamily: generateUlid(),
      sessionId: generateUlid(),
    };
    await expect(logout.service.logout(session, KEY, REQUEST_ID)).resolves.toMatchObject({
      resource_id: session.sessionId, resource_type: 'session', status: 'REVOKED', version: 1,
    });
    expect(logout.auth.revokeCurrentSessionInTransaction).toHaveBeenCalledWith(expect.anything(), {
      accountId: ACCOUNT_ID, sessionFamily: session.sessionFamily, sessionId: session.sessionId,
    });
    expect(logout.idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ responseStatus: 200, storage: 'HASH_ONLY' }));
  });
});
