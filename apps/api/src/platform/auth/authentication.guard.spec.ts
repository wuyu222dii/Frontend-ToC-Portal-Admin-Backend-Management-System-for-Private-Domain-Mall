import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { AgentAuthRepository, type DatabaseRuntime } from '@qingxu/database';
import {
  signAccessToken,
  signAgentAccessToken,
  signStoreAccessToken,
} from '@qingxu/platform-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrincipalRequest } from '../access/principal';
import { Public, RequireRoles } from '../access/rbac.metadata';
import { AgentRealm, AllowRestrictedAgentSession } from './agent-realm.metadata';
import { AuthenticationGuard } from './authentication.guard';
import { RequireCustomerOrSuperAdmin } from './customer-or-super-admin.metadata';
import { OptionalStoreAuthentication } from './optional-store-authentication.metadata';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const AGENT_ID = '01J00000000000000000000006';
const SESSION_ID = '01J00000000000000000000002';
const SESSION_FAMILY = '01J00000000000000000000003';
const ACCESS_JTI = 'access:01J00000000000000000000004';

const signingKeys = {
  current: { id: 'auth-test-v1', key: Buffer.alloc(32, 17) },
  previous: [],
};

const config = {
  authentication: {
    audience: 'qingxu-admin-web',
    issuer: 'qingxu-api-test',
    signingKeys,
  },
  store: {
    authTokenAudience: 'qingxu-store',
  },
  agent: {
    authTokenAudience: 'qingxu-agent-web',
  },
} as unknown as PlatformRuntimeConfig;

class RealmFixture {
  @RequireRoles('CUSTOMER')
  storeRoute(): void {}

  @RequireRoles('SUPER_ADMIN')
  adminRoute(): void {}

  @AgentRealm()
  agentRoute(): void {}

  @AgentRealm()
  @AllowRestrictedAgentSession()
  restrictedAgentRoute(): void {}

  @RequireRoles('AGENT_ADMIN')
  unmarkedAgentRoute(): void {}

  @AllowRestrictedAgentSession()
  invalidRestrictedPolicyRoute(): void {}

  @RequireRoles('SUPER_ADMIN', 'AGENT_ADMIN')
  adminBusinessRoleRoute(): void {}

  @RequireRoles('AGENT_ADMIN', 'SUPER_ADMIN')
  @AgentRealm()
  invalidMixedAgentRealmRoute(): void {}

  @RequireRoles('CUSTOMER', 'SUPER_ADMIN')
  mixedRealmRoute(): void {}

  @RequireCustomerOrSuperAdmin()
  customerOrSuperAdminRoute(): void {}

  @Public()
  @OptionalStoreAuthentication()
  optionalStoreRoute(): void {}

  @Public()
  publicRoute(): void {}
}

interface AuthenticationRequest extends PrincipalRequest {
  headers: Record<string, string | undefined>;
}

function storeSessionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: SESSION_ID,
    account_id: ACCOUNT_ID,
    access_jti: ACCESS_JTI,
    assurance: 'WECHAT',
    restriction: 'NONE',
    mfa_factor_id: null,
    mfa_verified_at: null,
    session_family: SESSION_FAMILY,
    expires_at: new Date(now.getTime() + 60 * 60 * 1_000),
    revoked_at: null,
    account: {
      role: 'CUSTOMER',
      status: 'ACTIVE',
      deleted_at: null,
      wechat_open_id: 'mock_open_id',
      version: 3,
      customer_profile: {
        id: CUSTOMER_ID,
        version: 5,
        anonymized_at: null,
      },
    },
    ...overrides,
  };
}

function adminSessionRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: SESSION_ID,
    account_id: ACCOUNT_ID,
    access_jti: ACCESS_JTI,
    assurance: 'MFA',
    restriction: 'NONE',
    mfa_factor_id: '01J00000000000000000000005',
    mfa_verified_at: now,
    session_family: SESSION_FAMILY,
    expires_at: new Date(now.getTime() + 60 * 60 * 1_000),
    revoked_at: null,
    account: {
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      deleted_at: null,
      version: 3,
    },
    mfa_factor: {
      id: '01J00000000000000000000005',
      account_id: ACCOUNT_ID,
      encryption_key_id: 'auth-test-v1',
      last_used_timestep: null,
      secret_ciphertext: new Uint8Array([1]),
      status: 'ACTIVE',
    },
    ...overrides,
  };
}

function runtimeWithSession(session: Record<string, unknown> | null) {
  const findUnique = vi.fn().mockResolvedValue(session);
  const database = {
    prisma: { authSession: { findUnique } },
  } as unknown as DatabaseRuntime;
  return {
    findUnique,
    guard: new AuthenticationGuard(new Reflector(), config, database),
  };
}

function runtimeWithAgentSession(session: Record<string, unknown> | null) {
  const getCurrentSession = vi.spyOn(AgentAuthRepository.prototype, 'getCurrentSession')
    .mockResolvedValue(session as never);
  const database = { prisma: {} } as unknown as DatabaseRuntime;
  return {
    getCurrentSession,
    guard: new AuthenticationGuard(new Reflector(), config, database),
  };
}

function contextFor(
  handlerName: keyof RealmFixture,
  token: string,
): { context: ExecutionContext; request: AuthenticationRequest } {
  return contextForHeaders(handlerName, { authorization: `Bearer ${token}` });
}

function contextForHeaders(
  handlerName: keyof RealmFixture,
  headers: Record<string, string | undefined>,
): { context: ExecutionContext; request: AuthenticationRequest } {
  const request: AuthenticationRequest = {
    headers,
  };
  const context = {
    getClass: () => RealmFixture,
    getHandler: () => RealmFixture.prototype[handlerName],
    switchToHttp: () => ({
      getNext: () => undefined,
      getRequest: () => request,
      getResponse: () => ({ setHeader: vi.fn() }),
    }),
  } as unknown as ExecutionContext;
  return { context, request };
}

function storeToken(): string {
  return signStoreAccessToken({
    audience: config.store.authTokenAudience,
    issuer: config.authentication.issuer,
    keys: config.authentication.signingKeys,
  }, {
    accountId: ACCOUNT_ID,
    assurance: 'WECHAT',
    permissions: [],
    restriction: 'NONE',
    role: 'CUSTOMER',
    sessionId: SESSION_ID,
    tokenId: ACCESS_JTI,
  }, 900).token;
}

function adminToken(): string {
  return signAccessToken({
    audience: config.authentication.audience,
    issuer: config.authentication.issuer,
    keys: config.authentication.signingKeys,
  }, {
    accountId: ACCOUNT_ID,
    assurance: 'MFA',
    permissions: [],
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    sessionId: SESSION_ID,
    tokenId: ACCESS_JTI,
  }, 900).token;
}

function agentToken(restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE' = 'NONE'): string {
  return signAgentAccessToken({
    audience: config.agent.authTokenAudience,
    issuer: config.authentication.issuer,
    keys: config.authentication.signingKeys,
  }, {
    accountId: ACCOUNT_ID,
    assurance: 'PASSWORD',
    permissions: [],
    restriction,
    role: 'AGENT_ADMIN',
    sessionId: SESSION_ID,
    tokenId: ACCESS_JTI,
  }, 900).token;
}

describe('AuthenticationGuard Store and Admin realm isolation', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts an active qingxu-store CUSTOMER/WECHAT session', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextFor('storeRoute', storeToken());

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: SESSION_ID },
      include: { account: { include: { customer_profile: true } } },
    });
    expect(request.storeSession).toMatchObject({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      sessionId: SESSION_ID,
    });
    expect(request.principal).toEqual({
      accountId: ACCOUNT_ID,
      assurance: 'WECHAT',
      permissions: [],
      restriction: 'NONE',
      role: 'CUSTOMER',
      sessionId: SESSION_ID,
    });
    expect(request.accessSession).toBeUndefined();
  });

  it('does not allow a Store token to enter the Admin realm', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextFor('adminRoute', storeToken());

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.principal).toBeUndefined();
  });

  it('does not allow an Admin token to enter the Store realm', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextFor('storeRoute', adminToken());

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.principal).toBeUndefined();
  });

  it('accepts an active Agent session only on an explicitly marked Agent realm', async () => {
    const session = {
      accountId: ACCOUNT_ID,
      agentId: AGENT_ID,
      restriction: 'NONE',
      sessionId: SESSION_ID,
    };
    const { getCurrentSession, guard } = runtimeWithAgentSession(session);
    const { context, request } = contextFor('agentRoute', agentToken());

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(getCurrentSession).toHaveBeenCalledWith({ sessionId: SESSION_ID, accessJti: ACCESS_JTI });
    expect(request.agentSession).toBe(session);
    expect(request.principal).toEqual({
      accountId: ACCOUNT_ID,
      assurance: 'PASSWORD',
      permissions: [],
      restriction: 'NONE',
      role: 'AGENT_ADMIN',
      sessionId: SESSION_ID,
    });
    expect(request.accessSession).toBeUndefined();
    expect(request.storeSession).toBeUndefined();
  });

  it('does not infer the Agent realm from AGENT_ADMIN in a business-role policy', async () => {
    const { findUnique, guard } = runtimeWithSession(adminSessionRow());
    const { context, request } = contextFor('adminBusinessRoleRoute', adminToken());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(request.principal?.role).toBe('SUPER_ADMIN');

    const unmarked = contextFor('unmarkedAgentRoute', agentToken());
    await expect(guard.canActivate(unmarked.context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it.each([
    ['Admin', adminToken()],
    ['Store', storeToken()],
  ])('rejects a %s token before Agent session lookup', async (_realm, token) => {
    const { getCurrentSession, guard } = runtimeWithAgentSession(null);
    const { context, request } = contextFor('agentRoute', token);

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(getCurrentSession).not.toHaveBeenCalled();
    expect(request.agentSession).toBeUndefined();
    expect(request.principal).toBeUndefined();
  });

  it('allows a restricted Agent session only on an explicitly permitted password-change action', async () => {
    const restrictedSession = {
      accountId: ACCOUNT_ID,
      agentId: AGENT_ID,
      restriction: 'CHANGE_PASSWORD_ONLY',
      sessionId: SESSION_ID,
    };
    const allowed = runtimeWithAgentSession(restrictedSession);
    const allowedRequest = contextFor('restrictedAgentRoute', agentToken('CHANGE_PASSWORD_ONLY'));
    await expect(allowed.guard.canActivate(allowedRequest.context)).resolves.toBe(true);
    expect(allowedRequest.request.principal?.restriction).toBe('CHANGE_PASSWORD_ONLY');

    vi.restoreAllMocks();
    const denied = runtimeWithAgentSession(restrictedSession);
    const deniedRequest = contextFor('agentRoute', agentToken('CHANGE_PASSWORD_ONLY'));
    await expect(denied.guard.canActivate(deniedRequest.context)).rejects.toMatchObject({
      code: 'PASSWORD_CHANGE_REQUIRED',
      httpStatus: 403,
    });
    expect(denied.getCurrentSession).toHaveBeenCalledOnce();
  });

  it('rejects a restriction mismatch between Agent token and persisted session', async () => {
    const { guard } = runtimeWithAgentSession({
      accountId: ACCOUNT_ID,
      restriction: 'CHANGE_PASSWORD_ONLY',
      sessionId: SESSION_ID,
    });
    const { context, request } = contextFor('agentRoute', agentToken('NONE'));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(request.agentSession).toBeUndefined();
    expect(request.principal).toBeUndefined();
  });

  it('fails closed when restricted-session metadata is used outside the Agent realm', async () => {
    const { findUnique, guard } = runtimeWithSession(adminSessionRow());
    const { context } = contextFor('invalidRestrictedPolicyRoute', adminToken());

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('fails closed when an explicit Agent realm mixes Agent and Admin roles', async () => {
    const { getCurrentSession, guard } = runtimeWithAgentSession(null);
    const { context } = contextFor('invalidMixedAgentRealmRoute', agentToken());

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(getCurrentSession).not.toHaveBeenCalled();
  });

  it('fails closed before token or session evaluation when required roles mix realms', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextFor('mixedRealmRoute', storeToken());

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.principal).toBeUndefined();
  });

  it('accepts a Store token on an explicit customer-or-super-admin route', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextFor('customerOrSuperAdminRoute', storeToken());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(request.principal?.role).toBe('CUSTOMER');
    expect(request.storeSession).toBeDefined();
    expect(request.accessSession).toBeUndefined();
  });

  it('accepts an Admin token on an explicit customer-or-super-admin route', async () => {
    const { findUnique, guard } = runtimeWithSession(adminSessionRow());
    const { context, request } = contextFor('customerOrSuperAdminRoute', adminToken());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(request.principal?.role).toBe('SUPER_ADMIN');
    expect(request.accessSession).toBeDefined();
    expect(request.storeSession).toBeUndefined();
  });

  it.each([
    ['revoked', { revoked_at: new Date() }],
    ['expired', { expires_at: new Date(Date.now() - 1_000) }],
  ])('rejects a %s Store session returned from persistence', async (_state, overrides) => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow(overrides));
    const { context, request } = contextFor('storeRoute', storeToken());

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(findUnique).toHaveBeenCalledOnce();
    expect(request.storeSession).toBeUndefined();
    expect(request.principal).toBeUndefined();
  });

  it('authenticates a Store bearer on an explicitly optional public route', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextFor('optionalStoreRoute', storeToken());

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(request.storeSession).toMatchObject({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID });
  });

  it('allows candidate-only and credential-free requests through the optional bearer layer', async () => {
    for (const headers of [{ 'x-candidate-token': 'c'.repeat(32) }, {}]) {
      const { findUnique, guard } = runtimeWithSession(storeSessionRow());
      const { context, request } = contextForHeaders('optionalStoreRoute', headers);

      await expect(guard.canActivate(context)).resolves.toBe(true);
      expect(findUnique).not.toHaveBeenCalled();
      expect(request.storeSession).toBeUndefined();
    }
  });

  it('rejects dual optional credentials before validating or falling back to either branch', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextForHeaders('optionalStoreRoute', {
      authorization: `Bearer ${storeToken()}`,
      'x-candidate-token': 'c'.repeat(32),
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.storeSession).toBeUndefined();
  });

  it('does not downgrade a malformed or wrong-realm optional bearer to anonymous', async () => {
    for (const authorization of ['Basic invalid', `Bearer ${adminToken()}`]) {
      const { findUnique, guard } = runtimeWithSession(storeSessionRow());
      const { context, request } = contextForHeaders('optionalStoreRoute', { authorization });

      await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
      expect(findUnique).not.toHaveBeenCalled();
      expect(request.storeSession).toBeUndefined();
    }
  });

  it('preserves the existing pass-through behavior of public routes without optional metadata', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextForHeaders('publicRoute', { authorization: 'malformed' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.storeSession).toBeUndefined();
  });
});
