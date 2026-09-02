import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AgentAuthRepository,
  AuditRepository,
  IdempotencyRepository,
  InvalidAgentLoginNameError,
  runSerializableTransaction,
  type CurrentAgentSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyClaim,
  type InitialAgentSessionMaterial,
} from '@qingxu/database';
import {
  ApplicationError,
  generateOpaqueToken,
  generateUlid,
  hashPassword,
  hmacAuthenticationSecret,
  signAgentAccessToken,
  verifyPasswordHash,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import type {
  AgentChangePasswordInput,
  AgentLoginInput,
  AgentRefreshInput,
} from './agent-auth.dto';
import { AgentLoginRateLimiter } from './agent-login-rate-limiter';

interface AgentSessionDraftBase {
  accessExpiresAt: Date;
  accessToken: string;
  material: InitialAgentSessionMaterial;
}

interface RegularAgentSessionDraft extends AgentSessionDraftBase {
  material: InitialAgentSessionMaterial & { refreshTokenHash: string; restriction: 'NONE' };
  refreshToken: string;
  restriction: 'NONE';
}

interface RestrictedAgentSessionDraft extends AgentSessionDraftBase {
  material: InitialAgentSessionMaterial & { refreshTokenHash: null; restriction: 'CHANGE_PASSWORD_ONLY' };
  restriction: 'CHANGE_PASSWORD_ONLY';
}

type AgentSessionDraft = RegularAgentSessionDraft | RestrictedAgentSessionDraft;

const AGENT_LOGIN_IDEMPOTENCY_ACTOR = '00000000000000000000000000';
const ROUTES = {
  changePassword: '/agent/auth/change-password',
  changeTemporaryPassword: '/agent/auth/change-temporary-password',
  login: '/agent/auth/login',
  logout: '/agent/auth/logout',
  logoutAll: '/agent/auth/logout-all',
  refresh: '/agent/auth/refresh',
} as const;

function invalidAuthentication(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Agent credentials are invalid');
}

function sensitiveReplay(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'A sensitive Agent authentication response cannot be replayed');
}

function loginOutcome(status: number): ApplicationError {
  if (status === 401) return invalidAuthentication();
  if (status === 429) return new ApplicationError('RATE_LIMITED', 'Agent login is locked');
  return sensitiveReplay();
}

@Injectable()
export class AgentAuthService {
  private readonly logger = new Logger('AgentAuthService');
  private readonly config: PlatformRuntimeConfig;
  private readonly database: DatabaseRuntime;
  private readonly auth: AgentAuthRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRepository;
  private readonly dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
    @Optional() @Inject(AgentLoginRateLimiter) private readonly loginRateLimiter?: AgentLoginRateLimiter,
  ) {
    this.config = config as PlatformRuntimeConfig;
    this.database = database as DatabaseRuntime;
    this.auth = database ? new AgentAuthRepository(database.prisma) : undefined as never;
    this.audit = config ? new AuditRepository(config.encryption.ipHashKey) : undefined as never;
    this.idempotency = config
      ? new IdempotencyRepository(config.encryption.idempotencyHashKeys)
      : undefined as never;
  }

  async login(input: AgentLoginInput, key: string, requestId: string, ipAddress?: string) {
    const claim = this.claim(AGENT_LOGIN_IDEMPOTENCY_ACTOR, key, ROUTES.login, input);
    const replayStatus = await this.replayStatus(claim);
    if (replayStatus !== null) throw loginOutcome(replayStatus);
    const lease = await this.loginLimiter().claimAttempt(key, input.loginName, ipAddress);
    try {
      return await this.loginAfterClaim(input, key, requestId, claim, ipAddress);
    } finally {
      try {
        await this.loginLimiter().releaseAttempt(lease, key, input.loginName, ipAddress);
      } catch {
        this.logger.error({ error_code: 'AGENT_LOGIN_LEASE_RELEASE_FAILED', service: 'api' });
      }
    }
  }

  private async loginAfterClaim(
    input: AgentLoginInput,
    key: string,
    requestId: string,
    claim: IdempotencyClaim,
    ipAddress?: string,
  ) {
    try {
      await this.loginLimiter().assertAllowed(input.loginName, ipAddress);
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.code !== 'RATE_LIMITED') throw error;
      const status = await this.completeOpaqueLoginFailure(claim, requestId, key, 429, ipAddress);
      throw loginOutcome(status);
    }

    let subject;
    try {
      subject = await this.authRuntime().findLoginSubject(input.loginName);
    } catch (error) {
      if (!(error instanceof InvalidAgentLoginNameError)) throw error;
      const locked = await this.recordLoginFailure(input.loginName, key, ipAddress);
      await verifyPasswordHash(await this.dummyPasswordHash, input.password);
      const status = await this.completeOpaqueLoginFailure(claim, requestId, key, locked ? 429 : 401, ipAddress);
      throw loginOutcome(status);
    }

    if (subject === null || subject.status !== 'ACTIVE') {
      const locked = await this.recordLoginFailure(input.loginName, key, ipAddress);
      await verifyPasswordHash(subject?.passwordHash ?? await this.dummyPasswordHash, input.password);
      const status = await this.completeOpaqueLoginFailure(claim, requestId, key, locked ? 429 : 401, ipAddress);
      throw loginOutcome(status);
    }

    if (!(await verifyPasswordHash(subject.passwordHash, input.password))) {
      const locked = await this.recordLoginFailure(input.loginName, key, ipAddress);
      const status = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
        const claimed = await this.idempotency.claim(transaction, claim);
        if (claimed.kind === 'replay') return claimed.record.response_status;
        await this.auditFailure(
          transaction,
          subject.id,
          'LOGIN',
          requestId,
          key,
          locked ? 'RATE_LIMITED' : 'AUTH_REQUIRED',
          ipAddress,
        );
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: locked ? 'RATE_LIMITED' : 'AUTH_REQUIRED' },
          responseStatus: locked ? 429 : 401,
          storage: 'HASH_ONLY',
        });
        return locked ? 429 : 401;
      });
      throw loginOutcome(status);
    }

    const draft = subject.mustChangePassword
      ? this.sessionDraft(subject.id, 'CHANGE_PASSWORD_ONLY')
      : this.sessionDraft(subject.id, 'NONE');
    const result = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') throw loginOutcome(claimed.record.response_status);
      const created = await this.authRuntime().createLoginSessionInTransaction(transaction, {
        accountId: subject.id,
        expectedMustChangePassword: subject.mustChangePassword,
        expectedPasswordHash: subject.passwordHash,
        expectedVersion: subject.version,
        session: draft.material,
      });
      await this.auditSuccess(transaction, subject.id, 'LOGIN', requestId, key, 'session', created.session.id, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: created.session.id,
        responseForHash: {
          account_id: subject.id,
          restriction: created.restriction,
          session_id: created.session.id,
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return created;
    });
    return this.sessionData(result.accountId, draft);
  }

  async refresh(input: AgentRefreshInput, key: string, requestId: string, ipAddress?: string) {
    const presentedHashes = this.refreshHashes(input.refreshToken);
    const actorId = await this.authRuntime().findRefreshActor(presentedHashes);
    if (actorId === null) throw invalidAuthentication();
    const claim = this.claim(actorId, key, ROUTES.refresh, input);
    const replayStatus = await this.replayStatus(claim);
    if (replayStatus !== null) {
      if (replayStatus === 401) throw invalidAuthentication();
      throw sensitiveReplay();
    }
    const draft = this.sessionDraft(actorId, 'NONE');
    const result = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const rotated = await this.authRuntime().rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: presentedHashes,
        session: draft.material,
      });
      if (rotated.kind !== 'rotated') {
        await this.auditFailure(transaction, actorId, 'REFRESH', requestId, key, 'AUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: rotated.kind },
          responseStatus: 401,
          storage: 'HASH_ONLY',
        });
        return rotated;
      }
      await this.auditSuccess(transaction, actorId, 'REFRESH', requestId, key,
        'session', rotated.sessionId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: rotated.sessionId,
        responseForHash: { session_id: rotated.sessionId },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return rotated;
    });
    if (result.kind !== 'rotated') throw invalidAuthentication();
    return this.sessionData(actorId, draft);
  }

  logout(session: CurrentAgentSession, key: string, requestId: string, ipAddress?: string) {
    return this.command(
      session.accountId,
      key,
      ROUTES.logout,
      {},
      requestId,
      'LOGOUT',
      'session',
      session.sessionId,
      async (transaction) => {
        await this.authRuntime().revokeSessionInTransaction(transaction, {
          accountId: session.accountId,
          sessionFamily: session.sessionFamily,
          sessionId: session.sessionId,
        });
        return { status: 'REVOKED' as const, version: session.rotationCounter + 1 };
      },
      ipAddress,
    );
  }

  logoutAll(session: CurrentAgentSession, key: string, requestId: string, ipAddress?: string) {
    this.requireUnrestricted(session);
    return this.command(
      session.accountId,
      key,
      ROUTES.logoutAll,
      {},
      requestId,
      'LOGOUT',
      'account',
      session.accountId,
      async (transaction) => {
        const revoked = await this.authRuntime().revokeAllSessionsInTransaction(transaction, {
          accountId: session.accountId,
          expectedVersion: session.accountVersion,
        });
        return { status: 'ACTIVE' as const, version: revoked.version };
      },
      ipAddress,
    );
  }

  current(session: CurrentAgentSession) {
    this.requireUnrestricted(session);
    return {
      agent_id: session.agentId,
      agent_no: session.agentNo,
      name: session.agentName,
      product_authorization_mode: session.productAuthorizationMode,
      status: session.agentStatus,
    };
  }

  async changePassword(
    session: CurrentAgentSession,
    input: AgentChangePasswordInput,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    this.requireUnrestricted(session);
    const newPasswordHash = await hashPassword(input.newPassword);
    const claim = this.claim(session.accountId, key, ROUTES.changePassword, input);
    const result = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.response_status === 401) return { kind: 'invalid' as const };
        return {
          kind: 'response' as const,
          response: preEnvelopedResponse(this.idempotency.commandReplay(claimed.record)),
        };
      }
      const account = await transaction.account.findUnique({ where: { id: session.accountId } });
      if (!account?.password_hash || !(await verifyPasswordHash(account.password_hash, input.currentPassword))) {
        await this.auditFailure(transaction, session.accountId, 'UPDATE', requestId, key, 'AUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: 'AUTH_REQUIRED' },
          responseStatus: 401,
          storage: 'HASH_ONLY',
        });
        return { kind: 'invalid' as const };
      }
      const changed = await this.authRuntime().changePasswordInTransaction(transaction, {
        accountId: session.accountId,
        currentSessionId: session.sessionId,
        expectedPasswordHash: account.password_hash,
        expectedVersion: session.accountVersion,
        newPasswordHash,
      });
      const response = this.commandResponse(
        requestId,
        session.accountId,
        'account',
        'ACTIVE',
        changed.version,
      );
      await this.auditSuccess(transaction, session.accountId, 'UPDATE', requestId, key,
        'account', session.accountId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return { kind: 'response' as const, response: preEnvelopedResponse(response) };
    });
    if (result.kind === 'invalid') throw invalidAuthentication();
    return result.response;
  }

  async changeTemporaryPassword(
    session: CurrentAgentSession,
    input: AgentChangePasswordInput,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    if (session.restriction !== 'CHANGE_PASSWORD_ONLY') {
      throw new ApplicationError('STATE_CONFLICT', 'Agent session is not awaiting a password change');
    }
    const claim = this.claim(session.accountId, key, ROUTES.changeTemporaryPassword, input);
    const replayStatus = await this.replayStatus(claim);
    if (replayStatus !== null) {
      if (replayStatus === 401) throw invalidAuthentication();
      throw sensitiveReplay();
    }
    const newPasswordHash = await hashPassword(input.newPassword);
    const result = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const account = await transaction.account.findUnique({ where: { id: session.accountId } });
      if (!account?.password_hash || !(await verifyPasswordHash(account.password_hash, input.currentPassword))) {
        await this.auditFailure(transaction, session.accountId, 'UPDATE', requestId, key, 'AUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: 'AUTH_REQUIRED' },
          responseStatus: 401,
          storage: 'HASH_ONLY',
        });
        return { kind: 'invalid' as const };
      }
      if (input.newPassword === input.currentPassword) {
        throw new ApplicationError('INVALID_ARGUMENT', 'New Agent password must differ from the temporary password');
      }
      const draft = this.sessionDraft(session.accountId, 'NONE');
      const changed = await this.authRuntime().changeTemporaryPasswordInTransaction(transaction, {
        accountId: session.accountId,
        currentSessionId: session.sessionId,
        expectedPasswordHash: account.password_hash,
        expectedVersion: session.accountVersion,
        newPasswordHash,
        session: draft.material,
      });
      await this.auditSuccess(transaction, session.accountId, 'UPDATE', requestId, key,
        'account', session.accountId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: changed.session.id,
        responseForHash: {
          account_id: session.accountId,
          account_version: changed.version,
          session_id: changed.session.id,
        },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return { draft, kind: 'changed' as const };
    });
    if (result.kind === 'invalid') throw invalidAuthentication();
    return this.sessionData(session.accountId, result.draft);
  }

  private async command(
    actorId: string,
    key: string,
    route: string,
    body: unknown,
    requestId: string,
    action: 'LOGOUT',
    objectType: 'account' | 'session',
    objectId: string,
    work: (transaction: DatabaseTransaction) => Promise<{
      status: 'ACTIVE' | 'REVOKED';
      version: number;
    }>,
    ipAddress?: string,
  ) {
    const claim = this.claim(actorId, key, route, body);
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        return preEnvelopedResponse(this.idempotency.commandReplay(claimed.record));
      }
      const result = await work(transaction);
      const response = this.commandResponse(requestId, objectId, objectType, result.status, result.version);
      await this.auditSuccess(transaction, actorId, action, requestId, key, objectType, objectId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE',
        responseBody: response,
        responseStatus: 200,
        storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  private commandResponse(
    requestId: string,
    resourceId: string,
    resourceType: 'account' | 'session',
    status: 'ACTIVE' | 'REVOKED',
    version: number,
  ) {
    return {
      code: 'OK' as const,
      data: {
        occurred_at: new Date().toISOString(),
        resource_id: resourceId,
        resource_type: resourceType,
        status,
        version,
      },
      message: 'success' as const,
      request_id: requestId,
    };
  }

  private sessionDraft(accountId: string, restriction: 'NONE'): RegularAgentSessionDraft;
  private sessionDraft(accountId: string, restriction: 'CHANGE_PASSWORD_ONLY'): RestrictedAgentSessionDraft;
  private sessionDraft(accountId: string, restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE'): AgentSessionDraft {
    const config = this.runtime();
    const now = new Date();
    const accessJti = generateUlid();
    const sessionId = generateUlid();
    const signed = signAgentAccessToken({
      audience: config.agent.authTokenAudience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, {
      accountId,
      assurance: 'PASSWORD',
      permissions: [],
      restriction,
      role: 'AGENT_ADMIN',
      sessionId,
      tokenId: accessJti,
    }, config.agent.accessTokenTtlSeconds, now);
    const base = {
      accessExpiresAt: signed.expiresAt,
      accessToken: signed.token,
      expiresAt: new Date(now.getTime() + config.agent.sessionTtlSeconds * 1_000),
      accessJti,
      id: sessionId,
      sessionFamily: generateUlid(),
    };
    if (restriction === 'CHANGE_PASSWORD_ONLY') {
      return {
        accessExpiresAt: base.accessExpiresAt,
        accessToken: base.accessToken,
        material: {
          accessJti: base.accessJti,
          expiresAt: base.expiresAt,
          id: base.id,
          refreshTokenHash: null,
          restriction,
          sessionFamily: base.sessionFamily,
        },
        restriction,
      };
    }
    const refreshToken = generateOpaqueToken('rfr');
    return {
      accessExpiresAt: base.accessExpiresAt,
      accessToken: base.accessToken,
      material: {
        accessJti: base.accessJti,
        expiresAt: base.expiresAt,
        id: base.id,
        refreshTokenHash: this.currentRefreshHash(refreshToken),
        restriction,
        sessionFamily: base.sessionFamily,
      },
      refreshToken,
      restriction,
    };
  }

  private sessionData(accountId: string, draft: AgentSessionDraft) {
    if (draft.restriction === 'CHANGE_PASSWORD_ONLY') {
      return {
        access_token: draft.accessToken,
        account_id: accountId,
        allowed_actions: ['CHANGE_TEMPORARY_PASSWORD', 'LOGOUT'] as const,
        assurance: 'PASSWORD' as const,
        expires_at: draft.accessExpiresAt.toISOString(),
        mfa_required: false as const,
        must_change_password: true as const,
        next_action: 'CHANGE_PASSWORD' as const,
        restriction: 'CHANGE_PASSWORD_ONLY' as const,
        role: 'AGENT_ADMIN' as const,
        session_id: draft.material.id,
      };
    }
    return {
      access_token: draft.accessToken,
      account_id: accountId,
      assurance: 'PASSWORD' as const,
      expires_at: draft.accessExpiresAt.toISOString(),
      mfa_required: false as const,
      refresh_token: draft.refreshToken,
      restriction: 'NONE' as const,
      role: 'AGENT_ADMIN' as const,
      session_id: draft.material.id,
    };
  }

  private requireUnrestricted(session: CurrentAgentSession): void {
    if (session.restriction !== 'NONE') {
      throw new ApplicationError('PASSWORD_CHANGE_REQUIRED', 'Agent password change is required');
    }
  }

  private claim(actorId: string, key: string, route: string, body: unknown): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey: key,
      request: { body, method: 'POST', pathParameters: {}, route },
    };
  }

  private replayStatus(claim: IdempotencyClaim): Promise<number | null> {
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      return claimed.kind === 'replay' ? claimed.record.response_status : null;
    });
  }

  private async recordLoginFailure(loginName: string, key: string, ipAddress?: string): Promise<boolean> {
    try {
      await this.loginLimiter().recordFailure(loginName, key, ipAddress);
      return false;
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.code !== 'RATE_LIMITED') throw error;
      return true;
    }
  }

  private completeOpaqueLoginFailure(
    claim: IdempotencyClaim,
    requestId: string,
    key: string,
    status: 401 | 429,
    ipAddress?: string,
  ): Promise<number> {
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') return claimed.record.response_status;
      await this.audit.append(transaction, {
        action: 'LOGIN',
        idempotencyKey: key,
        module: 'auth',
        objectId: AGENT_LOGIN_IDEMPOTENCY_ACTOR,
        objectType: 'account',
        requestId,
        result: 'FAILURE',
        resultCode: status === 429 ? 'RATE_LIMITED' : 'AUTH_REQUIRED',
        summaryPolicy: 'NONE',
        ...(ipAddress ? { ipAddress } : {}),
      });
      await this.idempotency.complete(transaction, claim, {
        responseForHash: { result: status === 429 ? 'RATE_LIMITED' : 'AUTH_REQUIRED' },
        responseStatus: status,
        storage: 'HASH_ONLY',
      });
      return status;
    });
  }

  private auditSuccess(
    transaction: DatabaseTransaction,
    actorId: string,
    action: 'LOGIN' | 'LOGOUT' | 'REFRESH' | 'UPDATE',
    requestId: string,
    idempotencyKey: string,
    objectType: 'account' | 'session',
    objectId: string,
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action,
      actorAccountId: actorId,
      actorRole: 'AGENT_ADMIN',
      idempotencyKey,
      module: 'auth',
      objectId,
      objectType,
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'NONE',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }

  private auditFailure(
    transaction: DatabaseTransaction,
    actorId: string,
    action: 'LOGIN' | 'REFRESH' | 'UPDATE',
    requestId: string,
    idempotencyKey: string,
    resultCode: 'AUTH_REQUIRED' | 'RATE_LIMITED',
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action,
      actorAccountId: actorId,
      actorRole: 'AGENT_ADMIN',
      idempotencyKey,
      module: 'auth',
      objectId: actorId,
      objectType: 'account',
      requestId,
      result: 'FAILURE',
      resultCode,
      summaryPolicy: 'NONE',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }

  private refreshHashes(value: string): readonly string[] {
    return [this.runtime().authentication.secretHashKeys.current,
      ...this.runtime().authentication.secretHashKeys.previous]
      .map(({ key }) => hmacAuthenticationSecret(value, key, 'agent-refresh-token'));
  }

  private currentRefreshHash(value: string): string {
    return hmacAuthenticationSecret(
      value,
      this.runtime().authentication.secretHashKeys.current.key,
      'agent-refresh-token',
    );
  }

  private loginLimiter(): AgentLoginRateLimiter {
    if (!this.loginRateLimiter) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent login rate limiter is unavailable');
    }
    return this.loginRateLimiter;
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Agent authentication runtime is unavailable');
    return this.config;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Agent authentication database is unavailable');
    return this.database;
  }

  private authRuntime(): AgentAuthRepository {
    if (!this.auth) throw new ApplicationError('INTERNAL_ERROR', 'Agent authentication repository is unavailable');
    return this.auth;
  }
}
