import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApplicationError, type RbacPrincipal } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import type { PrincipalRequest } from './principal';
import { RbacGuard } from './rbac.guard';
import { Public, RequirePermissions, RequireRoles } from './rbac.metadata';
import { getRequestContext, requestContextStorage } from '../http/request-context';

const SUPER_ADMIN: RbacPrincipal = {
  accountId: 'account_1',
  assurance: 'MFA',
  permissions: ['ORDER_FULFILLMENT_PII_READ'],
  restriction: 'NONE',
  role: 'SUPER_ADMIN',
  sessionId: 'session_1',
};

class GuardFixture {
  @Public()
  publicRoute(): void {}

  unclassifiedRoute(): void {}

  @RequireRoles('SUPER_ADMIN')
  adminRoute(): void {}

  @RequirePermissions('ORDER_FULFILLMENT_PII_READ')
  piiRoute(): void {}
}

@Public()
class PublicControllerFixture {
  publicRoute(): void {}

  @RequireRoles('SUPER_ADMIN')
  protectedMethod(): void {}

  @Public()
  @RequireRoles('SUPER_ADMIN')
  conflictingMethod(): void {}
}

@RequireRoles('SUPER_ADMIN')
class ProtectedControllerFixture {
  @Public()
  publicMethod(): void {}
}

@Public()
@RequireRoles('SUPER_ADMIN')
class ConflictingControllerFixture {
  @Public()
  publicMethod(): void {}
}

function contextFor<T extends object>(
  fixture: new () => T,
  handlerName: keyof T,
  request: PrincipalRequest,
): ExecutionContext {
  return {
    getClass: () => fixture,
    getHandler: () => fixture.prototype[handlerName],
    switchToHttp: () => ({
      getNext: () => undefined,
      getRequest: () => request,
      getResponse: () => undefined,
    }),
  } as unknown as ExecutionContext;
}

describe('RbacGuard', () => {
  const guard = new RbacGuard(new Reflector());

  function expectApplicationError(action: () => unknown, expectedCode: ApplicationError['code']): void {
    try {
      action();
      throw new Error('expected authorization to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationError);
      expect((error as ApplicationError).code).toBe(expectedCode);
    }
  }

  it('allows an explicitly public route', () => {
    expect(guard.canActivate(contextFor(GuardFixture, 'publicRoute', {}))).toBe(true);
  });

  it('denies an unclassified route instead of failing open', () => {
    expectApplicationError(() => guard.canActivate(contextFor(GuardFixture, 'unclassifiedRoute', {})), 'AUTH_REQUIRED');
    expectApplicationError(
      () => guard.canActivate(contextFor(GuardFixture, 'unclassifiedRoute', { principal: SUPER_ADMIN })),
      'PERMISSION_DENIED',
    );
  });

  it('returns AUTH_REQUIRED when protected metadata has no principal', () => {
    expectApplicationError(() => guard.canActivate(contextFor(GuardFixture, 'adminRoute', {})), 'AUTH_REQUIRED');
  });

  it('returns PERMISSION_DENIED for the wrong role', () => {
    expectApplicationError(
      () =>
        guard.canActivate(
          contextFor(GuardFixture, 'adminRoute', {
            principal: { ...SUPER_ADMIN, role: 'CUSTOMER' },
          }),
        ),
      'PERMISSION_DENIED',
    );
  });

  it('returns PERMISSION_DENIED when a permission is missing', () => {
    expectApplicationError(
      () =>
        guard.canActivate(
          contextFor(GuardFixture, 'piiRoute', {
            principal: { ...SUPER_ADMIN, permissions: [] },
          }),
        ),
      'PERMISSION_DENIED',
    );
  });

  it('allows matching role and permission requirements', () => {
    expect(guard.canActivate(contextFor(GuardFixture, 'adminRoute', { principal: SUPER_ADMIN }))).toBe(true);
    expect(guard.canActivate(contextFor(GuardFixture, 'piiRoute', { principal: SUPER_ADMIN }))).toBe(true);
  });

  it('makes an authenticated principal available to downstream request context consumers', () => {
    requestContextStorage.run({ requestId: 'request_1' }, () => {
      expect(guard.canActivate(contextFor(GuardFixture, 'adminRoute', { principal: SUPER_ADMIN }))).toBe(true);
      expect(getRequestContext()).toEqual({ requestId: 'request_1', principal: SUPER_ADMIN });
    });
  });

  it('does not let a class-level public policy override a protected method', () => {
    expectApplicationError(
      () => guard.canActivate(contextFor(PublicControllerFixture, 'protectedMethod', {})),
      'AUTH_REQUIRED',
    );
    expect(
      guard.canActivate(
        contextFor(PublicControllerFixture, 'protectedMethod', { principal: SUPER_ADMIN }),
      ),
    ).toBe(true);
  });

  it('allows an explicitly public method to override a protected class', () => {
    expect(guard.canActivate(contextFor(ProtectedControllerFixture, 'publicMethod', {}))).toBe(true);
  });

  it('fails closed when the same method is both public and protected', () => {
    expectApplicationError(
      () => guard.canActivate(contextFor(PublicControllerFixture, 'conflictingMethod', {})),
      'PERMISSION_DENIED',
    );
  });

  it('fails closed when the class policy conflicts even if the method is public', () => {
    expectApplicationError(
      () => guard.canActivate(contextFor(ConflictingControllerFixture, 'publicMethod', {})),
      'PERMISSION_DENIED',
    );
  });

  it('rejects empty and malformed access decorators at definition time', () => {
    expect(() => RequireRoles()).toThrow('Required roles must not be empty');
    expect(() => RequirePermissions()).toThrow('Required permissions must not be empty');
    expect(() => RequireRoles('SUPER_ADMIN', 'SUPER_ADMIN')).toThrow('must not contain duplicates');
    expect(() => RequirePermissions('not a permission')).toThrow('invalid value');
  });
});
