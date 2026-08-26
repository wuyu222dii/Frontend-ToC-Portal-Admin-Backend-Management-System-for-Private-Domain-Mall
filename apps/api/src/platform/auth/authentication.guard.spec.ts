import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { DatabaseRuntime } from '@qingxu/database';
import {
  signAccessToken,
  signStoreAccessToken,
} from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrincipalRequest } from '../access/principal';
import { RequireRoles } from '../access/rbac.metadata';
import { AuthenticationGuard } from './authentication.guard';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
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
} as unknown as PlatformRuntimeConfig;

class RealmFixture {
  @RequireRoles('CUSTOMER')
  storeRoute(): void {}

  @RequireRoles('SUPER_ADMIN')
  adminRoute(): void {}

  @RequireRoles('CUSTOMER', 'SUPER_ADMIN')
  mixedRealmRoute(): void {}
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

function runtimeWithSession(session: ReturnType<typeof storeSessionRow> | null) {
  const findUnique = vi.fn().mockResolvedValue(session);
  const database = {
    prisma: { authSession: { findUnique } },
  } as unknown as DatabaseRuntime;
  return {
    findUnique,
    guard: new AuthenticationGuard(new Reflector(), config, database),
  };
}

function contextFor(
  handlerName: keyof RealmFixture,
  token: string,
): { context: ExecutionContext; request: AuthenticationRequest } {
  const request: AuthenticationRequest = {
    headers: { authorization: `Bearer ${token}` },
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

describe('AuthenticationGuard Store and Admin realm isolation', () => {
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

  it('fails closed before token or session evaluation when required roles mix realms', async () => {
    const { findUnique, guard } = runtimeWithSession(storeSessionRow());
    const { context, request } = contextFor('mixedRealmRoute', storeToken());

    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(findUnique).not.toHaveBeenCalled();
    expect(request.principal).toBeUndefined();
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
});
