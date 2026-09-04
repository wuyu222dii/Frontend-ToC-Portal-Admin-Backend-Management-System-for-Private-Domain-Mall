import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ApplicationError,
  hasAllPermissions,
  hasRole,
  type AccountRole,
  type Permission,
} from '@qingxu/platform-core';

import type { PrincipalRequest } from './principal';
import { ADMIN_MFA_CHALLENGE_AUTHENTICATION } from '../auth/pre-auth.metadata';
import { setRequestContextPrincipal } from '../http/request-context';
import { PUBLIC_ROUTE, REQUIRED_PERMISSIONS, REQUIRED_ROLES } from './rbac.metadata';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(@Inject(Reflector) private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const handler = context.getHandler();
    const controller = context.getClass();
    const handlerIsPublic = this.reflector.get<boolean>(PUBLIC_ROUTE, handler) === true;
    const handlerRoles = this.reflector.get<readonly AccountRole[]>(REQUIRED_ROLES, handler);
    const handlerPermissions = this.reflector.get<readonly Permission[]>(REQUIRED_PERMISSIONS, handler);
    const classIsPublic = this.reflector.get<boolean>(PUBLIC_ROUTE, controller) === true;
    const classRoles = this.reflector.get<readonly AccountRole[]>(REQUIRED_ROLES, controller);
    const classPermissions = this.reflector.get<readonly Permission[]>(REQUIRED_PERMISSIONS, controller);
    const adminMfaChallengeAuthentication = this.reflector.getAllAndOverride<boolean | undefined>(
      ADMIN_MFA_CHALLENGE_AUTHENTICATION,
      [handler, controller],
    ) === true;
    const hasHandlerPolicy = handlerRoles !== undefined || handlerPermissions !== undefined;

    if (handlerRoles?.length === 0 || handlerPermissions?.length === 0 ||
      classRoles?.length === 0 || classPermissions?.length === 0) {
      throw new ApplicationError('PERMISSION_DENIED', 'Empty access policy');
    }

    if (classIsPublic && (classRoles !== undefined || classPermissions !== undefined)) {
      throw new ApplicationError('PERMISSION_DENIED', 'Conflicting access policy');
    }
    if (handlerIsPublic && hasHandlerPolicy) {
      throw new ApplicationError('PERMISSION_DENIED', 'Conflicting access policy');
    }
    if (adminMfaChallengeAuthentication && (handlerIsPublic || classIsPublic || handlerRoles !== undefined ||
      handlerPermissions !== undefined || classRoles !== undefined || classPermissions !== undefined)) {
      throw new ApplicationError('PERMISSION_DENIED', 'Conflicting administrator MFA challenge policy');
    }
    if (handlerIsPublic) return true;

    const request = context.switchToHttp().getRequest<PrincipalRequest>();
    if (adminMfaChallengeAuthentication) {
      if (request.preAuth !== undefined) return true;
      if (request.principal === undefined) {
        throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
      }
      if (request.principal.role !== 'SUPER_ADMIN') {
        throw new ApplicationError('PERMISSION_DENIED', 'Permission denied');
      }
      setRequestContextPrincipal(request.principal);
      return true;
    }

    const roles = handlerRoles ?? classRoles;
    const permissions = handlerPermissions ?? classPermissions;
    const hasProtectedPolicy = roles !== undefined || permissions !== undefined;

    if (!hasProtectedPolicy && classIsPublic) {
      return true;
    }

    const principal = request.principal;
    if (principal === undefined) {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
    setRequestContextPrincipal(principal);
    if (!hasProtectedPolicy) {
      throw new ApplicationError('PERMISSION_DENIED', 'No access policy is defined for this route');
    }
    if (roles !== undefined && !hasRole(principal, roles)) {
      throw new ApplicationError('PERMISSION_DENIED', 'Permission denied');
    }
    if (permissions !== undefined && !hasAllPermissions(principal, permissions)) {
      throw new ApplicationError('PERMISSION_DENIED', 'Permission denied');
    }

    return true;
  }
}
