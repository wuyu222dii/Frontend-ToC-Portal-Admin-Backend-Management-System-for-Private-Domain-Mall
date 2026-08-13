import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { AdminAuthRepository, type DatabaseRuntime } from '@qingxu/database';
import {
  ApplicationError,
  verifyAccessToken,
  verifyPreAuthToken,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../config/api-runtime-config';
import type { PrincipalRequest } from '../access/principal';
import { PUBLIC_ROUTE } from '../access/rbac.metadata';
import { API_DATABASE_RUNTIME } from '../database/api-database-runtime';
import { REQUIRED_PRE_AUTH_ACTION, type PreAuthAction } from './pre-auth.metadata';
import { NO_STORE_RESPONSE } from '../../admin-auth/no-store.decorator';

interface AuthenticationRequest extends PrincipalRequest {
  headers: Record<string, string | string[] | undefined>;
}

function bearerToken(request: AuthenticationRequest): string {
  const authorization = request.headers.authorization;
  if (typeof authorization !== 'string' || !authorization.startsWith('Bearer ') ||
    authorization.length <= 7 || authorization.includes(',')) {
    throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
  }
  return authorization.slice(7);
}

@Injectable()
export class AuthenticationGuard implements CanActivate {
  private readonly repository: AdminAuthRepository;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    this.repository = database ? new AdminAuthRepository(database.prisma) : undefined as never;
  }

  private get tokenConfig() {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Authentication runtime is unavailable');
    return {
      audience: this.config.authentication.audience,
      issuer: this.config.authentication.issuer,
      keys: this.config.authentication.signingKeys,
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();
    const requiredPreAuth = this.reflector.getAllAndOverride<PreAuthAction | undefined>(
      REQUIRED_PRE_AUTH_ACTION,
      [handler, controller],
    );
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(PUBLIC_ROUTE, [handler, controller]) === true;
    if (this.reflector.getAllAndOverride<boolean | undefined>(NO_STORE_RESPONSE, [handler, controller]) === true) {
      const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
      response.setHeader('Cache-Control', 'no-store, private');
      response.setHeader('Pragma', 'no-cache');
    }
    if (isPublic && requiredPreAuth === undefined) return true;

    const request = context.switchToHttp().getRequest<AuthenticationRequest>();
    if (!this.config || !this.database) {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
    const token = bearerToken(request);
    request.authorizationToken = token;

    if (requiredPreAuth !== undefined) {
      const claims = this.verifyPreAuth(token);
      if (claims.nextAction !== requiredPreAuth) {
        throw new ApplicationError('AUTH_REQUIRED', 'Pre-authentication token is not valid for this action');
      }
      const account = await this.configuredAdminAccount(claims.accountId);
      if (account === null || account.version !== claims.accountVersion) {
        throw new ApplicationError('AUTH_REQUIRED', 'Pre-authentication token is stale');
      }
      request.preAuth = claims;
      return true;
    }

    const claims = this.verifyAccess(token);
    const session = await this.repository.getCurrentSession({
      sessionId: claims.sessionId,
      accessJti: claims.tokenId,
    });
    if (session === null || session.accountId !== claims.accountId) {
      throw new ApplicationError('AUTH_REQUIRED', 'Administrator session is not active');
    }
    request.accessSession = session;
    request.principal = {
      accountId: session.accountId,
      assurance: 'MFA',
      permissions: claims.permissions,
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      sessionId: session.sessionId,
    };
    return true;
  }

  private verifyPreAuth(token: string) {
    try {
      return verifyPreAuthToken(this.tokenConfig, token);
    } catch {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
  }

  private verifyAccess(token: string) {
    try {
      return verifyAccessToken(this.tokenConfig, token);
    } catch {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
  }

  private async configuredAdminAccount(accountId: string): Promise<{ version: number } | null> {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Authentication runtime is unavailable');
    const account = await this.database.prisma.account.findUnique({ where: { id: accountId } });
    if (!account || account.role !== 'SUPER_ADMIN' || account.status !== 'ACTIVE' ||
      account.deleted_at !== null || account.password_hash === null) {
      return null;
    }
    return { version: account.version };
  }
}
