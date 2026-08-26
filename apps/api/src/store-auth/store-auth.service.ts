import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  IdempotencyRepository,
  runSerializableTransaction,
  StoreAuthRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyClaim,
  type InitialStoreSessionMaterial,
} from '@qingxu/database';
import {
  ApplicationError,
  generateOpaqueToken,
  generateUlid,
  hmacAuthenticationSecret,
  signStoreAccessToken,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { StoreRefreshInput, StoreWechatLoginInput } from './store-auth.dto';
import { StoreIdentityProvider } from './store-identity-provider';

const STORE_LOGIN_IDEMPOTENCY_ACTOR = '00000000000000000000000000';
const ROUTES = {
  login: '/store/auth/wechat/login',
  logout: '/store/auth/logout',
  refresh: '/store/auth/refresh',
} as const;

interface StoreSessionDraft {
  accessExpiresAt: Date;
  accessToken: string;
  material: InitialStoreSessionMaterial;
  refreshToken: string;
}

function invalidAuthentication(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Store authentication credentials are invalid');
}

function sensitiveReplay(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'A sensitive Store authentication response cannot be replayed');
}

@Injectable()
export class StoreAuthService {
  private readonly config: PlatformRuntimeConfig;
  private readonly database: DatabaseRuntime;
  private readonly auth: StoreAuthRepository;
  private readonly audit: AuditRepository;
  private readonly idempotency: IdempotencyRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
    @Optional() @Inject(StoreIdentityProvider) private readonly identityProvider?: StoreIdentityProvider,
  ) {
    this.config = config as PlatformRuntimeConfig;
    this.database = database as DatabaseRuntime;
    this.auth = database ? new StoreAuthRepository(database.prisma) : undefined as never;
    this.audit = config ? new AuditRepository(config.encryption.ipHashKey) : undefined as never;
    this.idempotency = config
      ? new IdempotencyRepository(config.encryption.idempotencyHashKeys)
      : undefined as never;
  }

  legalDocuments() {
    const store = this.runtime().store;
    return {
      phone_authorization: this.legalDocument('PHONE_AUTHORIZATION', store.legalDocuments.phoneAuthorization),
      privacy_policy: this.legalDocument('PRIVACY_POLICY', store.legalDocuments.privacyPolicy),
      user_agreement: this.legalDocument('USER_AGREEMENT', store.legalDocuments.userAgreement),
    };
  }

  async login(input: StoreWechatLoginInput, key: string, requestId: string, ipAddress?: string) {
    this.assertCurrentLoginConsents(input);
    if (input.candidateToken !== null) {
      throw new ApplicationError('ATTRIBUTION_CANDIDATE_MISMATCH', 'Candidate migration starts in B7.3');
    }
    const claim = this.claim(STORE_LOGIN_IDEMPOTENCY_ACTOR, key, ROUTES.login, input);
    const loginReplay = await this.replayStatus(claim);
    if (loginReplay !== null) {
      if (loginReplay === 401) throw invalidAuthentication();
      throw sensitiveReplay();
    }

    let identity;
    try {
      identity = await this.provider().exchange(input.code);
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.code !== 'AUTH_REQUIRED') throw error;
      await this.completeAnonymousLoginFailure(claim, requestId, key, ipAddress);
      throw invalidAuthentication();
    }

    const result = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const customer = await this.auth.resolveCustomerInTransaction(transaction, {
        accountId: generateUlid(),
        customerId: generateUlid(),
        openId: identity.openId,
        unionId: identity.unionId,
      });
      const draft = this.sessionDraft(customer.accountId);
      const session = await this.auth.createLoginSessionInTransaction(transaction, {
        accountId: customer.accountId,
        customerId: customer.customerId,
        sourceTerminal: 'MP_WEIXIN',
        consents: [
          { id: generateUlid(), type: 'USER_AGREEMENT', documentVersion: input.consents[0].documentVersion },
          { id: generateUlid(), type: 'PRIVACY_POLICY', documentVersion: input.consents[1].documentVersion },
        ],
        session: draft.material,
      });
      await this.auditSuccess(transaction, session.accountId, 'LOGIN', requestId, key,
        'session', session.session.id, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: session.session.id,
        responseForHash: { account_id: session.accountId, session_id: session.session.id },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return { accountId: session.accountId, draft };
    });

    return {
      candidate: null,
      confirmation_required: false,
      session: this.sessionData(result.draft),
    };
  }

  async refresh(input: StoreRefreshInput, key: string, requestId: string, ipAddress?: string) {
    const presentedHashes = this.storeRefreshHashes(input.refreshToken);
    const actorId = await this.authRuntime().findRefreshActor(presentedHashes);
    if (actorId === null) throw invalidAuthentication();
    const claim = this.claim(actorId, key, ROUTES.refresh, input);
    const refreshReplay = await this.replayStatus(claim);
    if (refreshReplay !== null) {
      if (refreshReplay === 401) throw invalidAuthentication();
      throw sensitiveReplay();
    }

    const result = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      const draft = this.sessionDraft(actorId);
      const rotated = await this.auth.rotateRefreshInTransaction(transaction, {
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
        return { draft: null, rotated };
      }
      await this.auditSuccess(transaction, actorId, 'REFRESH', requestId, key,
        'session', rotated.sessionId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: rotated.sessionId,
        responseForHash: { session_id: rotated.sessionId },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return { draft, rotated };
    });
    if (result.rotated.kind !== 'rotated' || result.draft === null) throw invalidAuthentication();
    return this.sessionData(result.draft);
  }

  async logout(session: CurrentStoreSession, key: string, requestId: string, ipAddress?: string) {
    const claim = this.claim(session.accountId, key, ROUTES.logout, {});
    const result = await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw sensitiveReplay();
      await this.auth.revokeCurrentSessionInTransaction(transaction, {
        accountId: session.accountId,
        sessionFamily: session.sessionFamily,
        sessionId: session.sessionId,
      });
      const occurredAt = new Date().toISOString();
      const data = {
        occurred_at: occurredAt,
        resource_id: session.sessionId,
        resource_type: 'session',
        status: 'REVOKED',
        version: 1,
      };
      await this.auditSuccess(transaction, session.accountId, 'LOGOUT', requestId, key,
        'session', session.sessionId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: session.sessionId,
        responseForHash: data,
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return data;
    });
    return result;
  }

  private assertCurrentLoginConsents(input: StoreWechatLoginInput): void {
    const documents = this.runtime().store.legalDocuments;
    if (input.consents[0].type !== 'USER_AGREEMENT' || input.consents[0].accepted !== true ||
      input.consents[0].documentVersion !== documents.userAgreement.version ||
      input.consents[1].type !== 'PRIVACY_POLICY' || input.consents[1].accepted !== true ||
      input.consents[1].documentVersion !== documents.privacyPolicy.version) {
      throw new ApplicationError('CONSENT_VERSION_MISMATCH', 'Store login consents are not current');
    }
  }

  private sessionDraft(accountId: string): StoreSessionDraft {
    const config = this.runtime();
    const now = new Date();
    const accessJti = generateUlid();
    const sessionId = generateUlid();
    const refreshToken = generateOpaqueToken('rfr');
    const signed = signStoreAccessToken({
      audience: config.store.authTokenAudience,
      issuer: config.authentication.issuer,
      keys: config.authentication.signingKeys,
    }, {
      accountId,
      assurance: 'WECHAT',
      permissions: [],
      restriction: 'NONE',
      role: 'CUSTOMER',
      sessionId,
      tokenId: accessJti,
    }, config.authentication.accessTokenTtlSeconds, now);
    return {
      accessExpiresAt: signed.expiresAt,
      accessToken: signed.token,
      material: {
        accessJti,
        expiresAt: new Date(now.getTime() + config.authentication.sessionTtlSeconds * 1_000),
        id: sessionId,
        refreshTokenHash: this.currentStoreRefreshHash(refreshToken),
        sessionFamily: generateUlid(),
      },
      refreshToken,
    };
  }

  private sessionData(draft: StoreSessionDraft) {
    return {
      access_expires_at: draft.accessExpiresAt.toISOString(),
      access_token: draft.accessToken,
      assurance: 'WECHAT',
      refresh_expires_at: draft.material.expiresAt.toISOString(),
      refresh_token: draft.refreshToken,
      role: 'CUSTOMER',
    } as const;
  }

  private legalDocument(
    type: 'PHONE_AUTHORIZATION' | 'PRIVACY_POLICY' | 'USER_AGREEMENT',
    document: { title: string; url: string; version: string },
  ) {
    return {
      content_url: document.url,
      document_version: document.version,
      required: true,
      title: document.title,
      type,
    } as const;
  }

  private claim(actorId: string, idempotencyKey: string, route: string, body: unknown): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: { body, method: 'POST', pathParameters: {}, route },
    };
  }

  private replayStatus(claim: IdempotencyClaim): Promise<number | null> {
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      return claimed.kind === 'replay' ? claimed.record.response_status : null;
    });
  }

  private async completeAnonymousLoginFailure(
    claim: IdempotencyClaim,
    requestId: string,
    idempotencyKey: string,
    ipAddress?: string,
  ): Promise<void> {
    await runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') return;
      await this.audit.append(transaction, {
        action: 'LOGIN',
        idempotencyKey,
        module: 'auth',
        objectId: STORE_LOGIN_IDEMPOTENCY_ACTOR,
        objectType: 'account',
        requestId,
        result: 'FAILURE',
        resultCode: 'AUTH_REQUIRED',
        summaryPolicy: 'NONE',
        ...(ipAddress ? { ipAddress } : {}),
      });
      await this.idempotency.complete(transaction, claim, {
        responseForHash: { result: 'AUTH_REQUIRED' },
        responseStatus: 401,
        storage: 'HASH_ONLY',
      });
    });
  }

  private auditSuccess(
    transaction: DatabaseTransaction,
    accountId: string,
    action: 'LOGIN' | 'LOGOUT' | 'REFRESH',
    requestId: string,
    idempotencyKey: string,
    objectType: 'session',
    objectId: string,
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action,
      actorAccountId: accountId,
      actorRole: 'CUSTOMER',
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
    accountId: string,
    action: 'REFRESH',
    requestId: string,
    idempotencyKey: string,
    resultCode: 'AUTH_REQUIRED',
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action,
      actorAccountId: accountId,
      actorRole: 'CUSTOMER',
      idempotencyKey,
      module: 'auth',
      objectId: accountId,
      objectType: 'account',
      requestId,
      result: 'FAILURE',
      resultCode,
      summaryPolicy: 'NONE',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }

  private storeRefreshHashes(value: string) {
    return [this.runtime().authentication.secretHashKeys.current,
      ...this.runtime().authentication.secretHashKeys.previous]
      .map(({ key }) => hmacAuthenticationSecret(value, key, 'store-refresh-token'));
  }

  private currentStoreRefreshHash(value: string) {
    return hmacAuthenticationSecret(
      value,
      this.runtime().authentication.secretHashKeys.current.key,
      'store-refresh-token',
    );
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store authentication runtime is unavailable');
    return this.config;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Store authentication database is unavailable');
    return this.database;
  }

  private authRuntime(): StoreAuthRepository {
    if (!this.auth) throw new ApplicationError('INTERNAL_ERROR', 'Store authentication repository is unavailable');
    return this.auth;
  }

  private provider(): StoreIdentityProvider {
    if (!this.identityProvider) throw new ApplicationError('INTERNAL_ERROR', 'Store identity provider is unavailable');
    return this.identityProvider;
  }
}
