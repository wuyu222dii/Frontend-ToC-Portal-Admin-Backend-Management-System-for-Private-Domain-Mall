import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentAgentSession,
  DatabaseRuntime,
  DatabaseTransaction,
} from '@qingxu/database';
import {
  hashPassword,
  verifyAgentAccessToken,
} from '@qingxu/platform-core';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { AgentAuthService } from './agent-auth.service';
import type { AgentLoginRateLimiter } from './agent-login-rate-limiter';

const ACCOUNT_ID = '01J00000000000000000000000';
const AGENT_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const KEY = '018f47a2-9f61-7c4f-8b6e-9a61b3470f2e';
const OLD_PASSWORD = 'old-secure-password';
const NEW_PASSWORD = 'new-secure-password';
let oldPasswordHash: string;

beforeAll(async () => {
  oldPasswordHash = await hashPassword(OLD_PASSWORD);
});

function config(): PlatformRuntimeConfig {
  return {
    agent: {
      accessTokenTtlSeconds: 900,
      authTokenAudience: 'qingxu-agent-web',
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
      sessionTtlSeconds: 604_800,
    },
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
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 2) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 3),
    },
  } as unknown as PlatformRuntimeConfig;
}

function currentSession(restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE'): CurrentAgentSession {
  return {
    accountId: ACCOUNT_ID,
    accountVersion: 3,
    accessJti: 'access:01J00000000000000000000003',
    agentId: AGENT_ID,
    agentName: 'Development Agent',
    agentNo: 'AGT-000001',
    agentStatus: 'ACTIVE',
    expiresAt: new Date(Date.now() + 60_000),
    productAuthorizationMode: 'ALL_ACTIVE_PRODUCTS',
    profileVersion: 2,
    restriction,
    rotationCounter: 0,
    sessionFamily: '01J00000000000000000000004',
    sessionId: SESSION_ID,
  };
}

function harness(mustChangePassword = false) {
  const transaction = {
    account: { findUnique: vi.fn().mockResolvedValue({ password_hash: oldPasswordHash }) },
  } as unknown as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => unknown) => work(transaction)),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const auth = {
    findLoginSubject: vi.fn().mockResolvedValue({
      agentId: AGENT_ID,
      id: ACCOUNT_ID,
      loginName: 'agent.operator',
      mustChangePassword,
      passwordHash: oldPasswordHash,
      status: 'ACTIVE',
      version: 3,
    }),
    createLoginSessionInTransaction: vi.fn(async (_transaction, input) => ({
      accountId: ACCOUNT_ID,
      accountVersion: 3,
      agentId: AGENT_ID,
      profileVersion: 2,
      restriction: input.session.restriction,
      session: { id: input.session.id },
    })),
    findRefreshActor: vi.fn().mockResolvedValue(ACCOUNT_ID),
    rotateRefreshInTransaction: vi.fn(async (_transaction, input) => ({
      kind: 'rotated' as const,
      rotationCounter: 1,
      sessionFamily: '01J00000000000000000000004',
      sessionId: input.session.id,
    })),
    revokeSessionInTransaction: vi.fn().mockResolvedValue({ revoked: true }),
    revokeAllSessionsInTransaction: vi.fn().mockResolvedValue({ revokedCount: 2, version: 4 }),
    changePasswordInTransaction: vi.fn().mockResolvedValue({ revokedOtherSessions: 2, version: 4 }),
    changeTemporaryPasswordInTransaction: vi.fn(async (_transaction, input) => ({
      session: { id: input.session.id },
      version: 4,
    })),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    commandReplay: vi.fn(),
    complete: vi.fn().mockResolvedValue({}),
  };
  const limiter = {
    assertAllowed: vi.fn().mockResolvedValue(undefined),
    claimAttempt: vi.fn().mockResolvedValue('10000000-0000-4000-8000-000000000000'),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    releaseAttempt: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AgentAuthService(config(), database, limiter as unknown as AgentLoginRateLimiter);
  Object.assign(service as unknown as Record<string, unknown>, { audit, auth, idempotency });
  return { audit, auth, idempotency, limiter, service, transaction };
}

describe('AgentAuthService', () => {
  it('creates an isolated Agent session and never caches password or tokens', async () => {
    const { auth, idempotency, service } = harness();
    const response = await service.login({ loginName: 'agent.operator', password: OLD_PASSWORD }, KEY, REQUEST_ID);

    expect(response).toMatchObject({
      account_id: ACCOUNT_ID,
      assurance: 'PASSWORD',
      restriction: 'NONE',
      role: 'AGENT_ADMIN',
    });
    expect('refresh_token' in response).toBe(true);
    expect(verifyAgentAccessToken({
      audience: config().agent.authTokenAudience,
      issuer: config().authentication.issuer,
      keys: config().authentication.signingKeys,
    }, response.access_token)).toMatchObject({
      accountId: ACCOUNT_ID,
      assurance: 'PASSWORD',
      restriction: 'NONE',
      role: 'AGENT_ADMIN',
    });
    expect(auth.createLoginSessionInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      expectedMustChangePassword: false,
      expectedPasswordHash: oldPasswordHash,
      expectedVersion: 3,
      session: expect.objectContaining({ restriction: 'NONE' }),
    }));
    const completion = idempotency.complete.mock.calls.at(-1)?.[2];
    expect(completion).toMatchObject({ storage: 'HASH_ONLY' });
    expect(JSON.stringify(completion)).not.toContain(OLD_PASSWORD);
    expect(JSON.stringify(completion)).not.toContain(response.access_token);
    expect(JSON.stringify(completion)).not.toContain('refresh_token' in response ? response.refresh_token : '');
  });

  it('returns only a restricted access token for a temporary password', async () => {
    const { auth, idempotency, service } = harness(true);
    const response = await service.login({ loginName: 'agent.operator', password: OLD_PASSWORD }, KEY, REQUEST_ID);

    expect(response).toMatchObject({
      account_id: ACCOUNT_ID,
      allowed_actions: ['CHANGE_TEMPORARY_PASSWORD', 'LOGOUT'],
      assurance: 'PASSWORD',
      must_change_password: true,
      next_action: 'CHANGE_PASSWORD',
      restriction: 'CHANGE_PASSWORD_ONLY',
      role: 'AGENT_ADMIN',
    });
    expect('refresh_token' in response).toBe(false);
    expect(auth.createLoginSessionInTransaction.mock.calls[0]?.[1].session).toMatchObject({
      refreshTokenHash: null,
      restriction: 'CHANGE_PASSWORD_ONLY',
    });
    expect(JSON.stringify(idempotency.complete.mock.calls.at(-1)?.[2])).not.toContain(response.access_token);
  });

  it('upgrades a restricted session atomically and returns a full fresh session', async () => {
    const { auth, idempotency, service } = harness(true);
    const response = await service.changeTemporaryPassword(
      currentSession('CHANGE_PASSWORD_ONLY'),
      { currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD },
      KEY,
      REQUEST_ID,
    );

    expect(response).toMatchObject({ restriction: 'NONE', role: 'AGENT_ADMIN' });
    expect('refresh_token' in response).toBe(true);
    expect(auth.changeTemporaryPasswordInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      accountId: ACCOUNT_ID,
      currentSessionId: SESSION_ID,
      expectedPasswordHash: oldPasswordHash,
      expectedVersion: 3,
      session: expect.objectContaining({ restriction: 'NONE' }),
    }));
    const completion = idempotency.complete.mock.calls.at(-1)?.[2];
    expect(completion).toMatchObject({ storage: 'HASH_ONLY' });
    expect(JSON.stringify(completion)).not.toContain(OLD_PASSWORD);
    expect(JSON.stringify(completion)).not.toContain(NEW_PASSWORD);
    expect(JSON.stringify(completion)).not.toContain(response.access_token);
  });

  it('keeps the temporary-password restriction when the replacement matches the current password', async () => {
    const { audit, auth, idempotency, service } = harness(true);
    const sessionDraft = vi.spyOn(
      service as unknown as {
        sessionDraft: (accountId: string, restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE') => unknown;
      },
      'sessionDraft',
    );

    await expect(service.changeTemporaryPassword(
      currentSession('CHANGE_PASSWORD_ONLY'),
      { currentPassword: OLD_PASSWORD, newPassword: OLD_PASSWORD },
      KEY,
      REQUEST_ID,
    )).rejects.toMatchObject({ code: 'INVALID_ARGUMENT', httpStatus: 400 });

    expect(auth.changeTemporaryPasswordInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
    expect(sessionDraft).not.toHaveBeenCalled();
  });

  it('keeps matching non-current password fields behind the opaque authentication failure', async () => {
    const { auth, idempotency, service } = harness(true);
    const wrongPassword = 'wrong-secure-password';

    await expect(service.changeTemporaryPassword(
      currentSession('CHANGE_PASSWORD_ONLY'),
      { currentPassword: wrongPassword, newPassword: wrongPassword },
      KEY,
      REQUEST_ID,
    )).rejects.toMatchObject({ code: 'AUTH_REQUIRED', httpStatus: 401 });

    expect(auth.changeTemporaryPasswordInTransaction).not.toHaveBeenCalled();
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      responseForHash: { result: 'AUTH_REQUIRED' },
      responseStatus: 401,
      storage: 'HASH_ONLY',
    });
  });

  it('maps refresh replay detection to an opaque 401 after the repository revokes the family', async () => {
    const { auth, idempotency, service } = harness();
    auth.rotateRefreshInTransaction.mockResolvedValueOnce({
      kind: 'replay_detected',
      sessionFamily: '01J00000000000000000000004',
    } as never);

    await expect(service.refresh({ refreshToken: 'r'.repeat(32) }, KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      responseForHash: { result: 'replay_detected' },
      responseStatus: 401,
      storage: 'HASH_ONLY',
    });
  });

  it('blocks unrestricted operations for a temporary-password session', () => {
    const { service } = harness(true);
    expect(() => service.current(currentSession('CHANGE_PASSWORD_ONLY')))
      .toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
    expect(() => service.logoutAll(currentSession('CHANGE_PASSWORD_ONLY'), KEY, REQUEST_ID))
      .toThrow(expect.objectContaining({ code: 'PASSWORD_CHANGE_REQUIRED' }));
  });
});
