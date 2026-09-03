import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAuthRepository,
  AgentAuthRepository,
  StoreAuthRepository,
  type DatabaseRuntime,
} from '@qingxu/database';
import {
  ApplicationError,
  verifyAccessToken,
  verifyAgentAccessToken,
  verifyPreAuthToken,
  verifyStoreAccessToken,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../config/api-runtime-config';
import type { PrincipalRequest } from '../access/principal';
import { PUBLIC_ROUTE, REQUIRED_ROLES } from '../access/rbac.metadata';
import { API_DATABASE_RUNTIME } from '../database/api-database-runtime';
import { REQUIRED_PRE_AUTH_ACTION, type PreAuthAction } from './pre-auth.metadata';
import { OPTIONAL_STORE_AUTHENTICATION } from './optional-store-authentication.metadata';
import { NO_STORE_RESPONSE } from '../http/no-store.decorator';
import {
  AGENT_AUTHENTICATION_REALM,
  ALLOW_RESTRICTED_AGENT_SESSION,
} from './agent-realm.metadata';
import { CUSTOMER_OR_SUPER_ADMIN } from './customer-or-super-admin.metadata';
import { FILE_DOWNLOAD_AUTHENTICATION } from './file-download-realm.metadata';

interface AuthenticationRequest extends PrincipalRequest {
  headers: Record<string, string | string[] | undefined>;
}

function headerPresent(request: AuthenticationRequest, name: string): boolean {
  return request.headers[name] !== undefined;
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
  private readonly agentRepository: AgentAuthRepository;
  private readonly storeRepository: StoreAuthRepository;

  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    this.repository = database ? new AdminAuthRepository(database.prisma) : undefined as never;
    this.agentRepository = database ? new AgentAuthRepository(database.prisma) : undefined as never;
    this.storeRepository = database ? new StoreAuthRepository(database.prisma) : undefined as never;
  }

  private get agentTokenConfig() {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Authentication runtime is unavailable');
    return {
      audience: this.config.agent.authTokenAudience,
      issuer: this.config.authentication.issuer,
      keys: this.config.authentication.signingKeys,
    };
  }

  private get storeTokenConfig() {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Authentication runtime is unavailable');
    return {
      audience: this.config.store.authTokenAudience,
      issuer: this.config.authentication.issuer,
      keys: this.config.authentication.signingKeys,
    };
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
    const requiredRoles = this.reflector.getAllAndOverride<readonly string[] | undefined>(
      REQUIRED_ROLES,
      [handler, controller],
    );
    const optionalStoreAuthentication = this.reflector.getAllAndOverride<boolean | undefined>(
      OPTIONAL_STORE_AUTHENTICATION,
      [handler, controller],
    ) === true;
    const customerOrSuperAdmin = this.reflector.getAllAndOverride<boolean | undefined>(
      CUSTOMER_OR_SUPER_ADMIN,
      [handler, controller],
    ) === true;
    const agentRealm = this.reflector.getAllAndOverride<boolean | undefined>(
      AGENT_AUTHENTICATION_REALM,
      [handler, controller],
    ) === true;
    const fileDownloadAuthentication = this.reflector.getAllAndOverride<boolean | undefined>(
      FILE_DOWNLOAD_AUTHENTICATION,
      [handler, controller],
    ) === true;
    const allowRestrictedAgentSession = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_RESTRICTED_AGENT_SESSION,
      [handler, controller],
    ) === true;
    if (this.reflector.getAllAndOverride<boolean | undefined>(NO_STORE_RESPONSE, [handler, controller]) === true) {
      const response = context.switchToHttp().getResponse<{ setHeader(name: string, value: string): void }>();
      response.setHeader('Cache-Control', 'no-store, private');
      response.setHeader('Pragma', 'no-cache');
    }
    if (optionalStoreAuthentication && (!isPublic || requiredPreAuth !== undefined || requiredRoles !== undefined)) {
      throw new ApplicationError('PERMISSION_DENIED', 'Optional Store authentication policy is invalid');
    }
    if (customerOrSuperAdmin && (isPublic || requiredPreAuth !== undefined || optionalStoreAuthentication ||
      fileDownloadAuthentication || requiredRoles?.length !== 2 || !requiredRoles.includes('CUSTOMER') ||
      !requiredRoles.includes('SUPER_ADMIN'))) {
      throw new ApplicationError('PERMISSION_DENIED', 'Customer or administrator authentication policy is invalid');
    }
    if (agentRealm && (isPublic || requiredPreAuth !== undefined || optionalStoreAuthentication ||
      customerOrSuperAdmin || requiredRoles?.length !== 1 || requiredRoles[0] !== 'AGENT_ADMIN')) {
      throw new ApplicationError('PERMISSION_DENIED', 'Agent authentication policy is invalid');
    }
    if (fileDownloadAuthentication && (isPublic || requiredPreAuth !== undefined || optionalStoreAuthentication ||
      customerOrSuperAdmin || agentRealm || requiredRoles?.length !== 3 ||
      !requiredRoles.includes('CUSTOMER') || !requiredRoles.includes('SUPER_ADMIN') ||
      !requiredRoles.includes('AGENT_ADMIN'))) {
      throw new ApplicationError('PERMISSION_DENIED', 'File download authentication policy is invalid');
    }
    if (allowRestrictedAgentSession && !agentRealm) {
      throw new ApplicationError('PERMISSION_DENIED', 'Restricted Agent session policy is invalid');
    }

    const request = context.switchToHttp().getRequest<AuthenticationRequest>();
    if (optionalStoreAuthentication) {
      const authorizationPresent = headerPresent(request, 'authorization');
      const candidateTokenPresent = headerPresent(request, 'x-candidate-token');
      if (authorizationPresent && candidateTokenPresent) {
        throw new ApplicationError('INVALID_ARGUMENT', 'Authorization and X-Candidate-Token cannot be combined');
      }
      if (!authorizationPresent) return true;
      return this.authenticateStoreBearer(request);
    }
    if (isPublic && requiredPreAuth === undefined) return true;

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


    if (customerOrSuperAdmin) {
      return this.authenticateCustomerOrSuperAdmin(request, token);
    }

    if (fileDownloadAuthentication) {
      return this.authenticateFileDownload(request, token);
    }

    if (requiredRoles?.includes('CUSTOMER')) {
      if (requiredRoles.some((role) => role !== 'CUSTOMER')) {
        throw new ApplicationError('PERMISSION_DENIED', 'Mixed authentication realms are forbidden');
      }
      return this.authenticateStoreBearer(request, token);
    }

    if (agentRealm) {
      return this.authenticateAgentBearer(request, token, allowRestrictedAgentSession);
    }

    return this.authenticateAdminBearer(request, token);
  }

  private async authenticateAgentBearer(
    request: AuthenticationRequest,
    token: string,
    allowRestrictedSession: boolean,
  ): Promise<true> {
    if (!this.config || !this.database || !this.agentRepository) {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
    request.authorizationToken = token;
    const claims = this.verifyAgentAccess(token);
    const session = await this.agentRepository.getCurrentSession({
      sessionId: claims.sessionId,
      accessJti: claims.tokenId,
    });
    if (session === null || session.accountId !== claims.accountId || session.restriction !== claims.restriction) {
      throw new ApplicationError('AUTH_REQUIRED', 'Agent session is not active');
    }
    request.agentSession = session;
    request.principal = {
      accountId: session.accountId,
      assurance: 'PASSWORD',
      permissions: [],
      restriction: session.restriction,
      role: 'AGENT_ADMIN',
      sessionId: session.sessionId,
    };
    if (session.restriction === 'CHANGE_PASSWORD_ONLY' && !allowRestrictedSession) {
      throw new ApplicationError('PASSWORD_CHANGE_REQUIRED', 'Agent must change the temporary password');
    }
    return true;
  }

  private async authenticateAdminBearer(request: AuthenticationRequest, token = bearerToken(request)): Promise<true> {
    if (!this.config || !this.database || !this.repository) {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
    request.authorizationToken = token;
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

  private async authenticateCustomerOrSuperAdmin(
    request: AuthenticationRequest,
    token: string,
  ): Promise<true> {
    try {
      verifyStoreAccessToken(this.storeTokenConfig, token);
    } catch {
      return this.authenticateAdminBearer(request, token);
    }
    return this.authenticateStoreBearer(request, token);
  }

  private async authenticateFileDownload(request: AuthenticationRequest, token: string): Promise<true> {
    try {
      verifyStoreAccessToken(this.storeTokenConfig, token);
    } catch {
      try {
        verifyAgentAccessToken(this.agentTokenConfig, token);
      } catch {
        return this.authenticateAdminBearer(request, token);
      }
      return this.authenticateAgentBearer(request, token, false);
    }
    return this.authenticateStoreBearer(request, token);
  }

  private async authenticateStoreBearer(request: AuthenticationRequest, token = bearerToken(request)): Promise<true> {
    if (!this.config || !this.database || !this.storeRepository) {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
    request.authorizationToken = token;
    const claims = this.verifyStoreAccess(token);
    const session = await this.storeRepository.getCurrentSession({
      sessionId: claims.sessionId,
      accessJti: claims.tokenId,
    });
    if (session === null || session.accountId !== claims.accountId) {
      throw new ApplicationError('AUTH_REQUIRED', 'Store session is not active');
    }
    request.storeSession = session;
    request.principal = {
      accountId: session.accountId,
      assurance: 'WECHAT',
      permissions: [],
      restriction: 'NONE',
      role: 'CUSTOMER',
      sessionId: session.sessionId,
    };
    return true;
  }

  private verifyStoreAccess(token: string) {
    try {
      return verifyStoreAccessToken(this.storeTokenConfig, token);
    } catch {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
  }

  private verifyAgentAccess(token: string) {
    try {
      return verifyAgentAccessToken(this.agentTokenConfig, token);
    } catch {
      throw new ApplicationError('AUTH_REQUIRED', 'Authentication is required');
    }
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
