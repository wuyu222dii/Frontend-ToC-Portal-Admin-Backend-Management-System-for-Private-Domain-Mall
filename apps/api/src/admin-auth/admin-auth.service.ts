import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AdminAuthRepository,
  AuditRepository,
  IdempotencyRepository,
  InvalidAdminLoginNameError,
  runSerializableTransaction,
  type CurrentAdminSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  type IdempotencyClaim,
  type InitialAdminSessionMaterial,
  type RecoveryCodeMaterial,
} from '@qingxu/database';
import {
  ApplicationError,
  createEncryptionContext,
  createTotpSecret,
  createTotpUri,
  decryptEnvelopeText,
  encryptEnvelope,
  generateOpaqueToken,
  generateRecoveryCodes,
  generateUlid,
  hashPassword,
  hmacAuthenticationSecret,
  signAccessToken,
  signPreAuthToken,
  verifyPasswordHash,
  verifyTotpCode,
  type EncryptedEnvelope,
  type VerifiedPreAuthClaims,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { preEnvelopedResponse } from '../platform/http/success-envelope.interceptor';
import { AdminLoginRateLimiter } from './admin-login-rate-limiter';

interface LoginInput { loginName: string; password: string }
interface RefreshInput { refreshToken: string }
interface ChangePasswordInput { currentPassword: string; newPassword: string }
interface EnrollInput { label?: string }
interface TotpVerifyInput { challengeId: string; totpCode: string }
interface RecoveryInput { challengeId: string; recoveryCode: string }
interface TotpInput { totpCode: string }
interface ReauthChallengeInput { purpose: 'REAUTH'; targetId?: string | null }
interface PayoutReauthInput { action: 'PAYOUT_ACCOUNT_REVEAL'; withdrawalId: string; totpCode: string }

interface SessionDraft {
  accessExpiresAt: Date;
  accessToken: string;
  material: InitialAdminSessionMaterial;
  refreshToken: string;
}

const ROUTES = {
  changePassword: '/admin/auth/change-password',
  enroll: '/admin/auth/mfa/totp/enroll',
  enrollVerify: '/admin/auth/mfa/totp/enroll/verify',
  login: '/admin/auth/login',
  logout: '/admin/auth/logout',
  logoutAll: '/admin/auth/logout-all',
  reauth: '/admin/auth/reauth',
  reauthChallenge: '/admin/auth/mfa/challenges',
  recovery: '/admin/auth/mfa/recovery',
  recoveryRotate: '/admin/auth/mfa/recovery-codes/rotate',
  refresh: '/admin/auth/refresh',
} as const;

const SUPER_ADMIN_PERMISSIONS = ['ORDER_FULFILLMENT_PII_READ'] as const;
const REAUTH_CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const REAUTH_GRANT_TTL_MS = 60 * 1_000;

// Login happens before an authenticated actor exists. A fixed non-account ULID
// keeps idempotency behavior identical for existing, disabled, and unknown names.
const ADMIN_LOGIN_IDEMPOTENCY_ACTOR = '00000000000000000000000000';

function invalidAuthentication(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Administrator credentials are invalid');
}

function reauthRequired(): ApplicationError {
  return new ApplicationError('REAUTH_REQUIRED', 'Administrator reauthentication is required');
}

function noReplay(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'A sensitive authentication response cannot be replayed');
}

function loginOutcome(status: number): ApplicationError {
  if (status === 401) return invalidAuthentication();
  if (status === 429) return new ApplicationError('RATE_LIMITED', 'Administrator login is locked');
  return noReplay();
}

function exactEnvelope(value: string): EncryptedEnvelope {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new ApplicationError('INTERNAL_ERROR', 'TOTP secret is unreadable'); }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApplicationError('INTERNAL_ERROR', 'TOTP secret is unreadable');
  }
  const item = parsed as Record<string, unknown>;
  const fields = ['algorithm', 'authTag', 'ciphertext', 'iv', 'keyId', 'version'];
  if (Object.keys(item).length !== fields.length || Object.keys(item).some((key) => !fields.includes(key)) ||
    item.version !== 1 || item.algorithm !== 'AES-256-GCM' ||
    !['authTag', 'ciphertext', 'iv', 'keyId'].every((key) => typeof item[key] === 'string')) {
    throw new ApplicationError('INTERNAL_ERROR', 'TOTP secret is unreadable');
  }
  return item as unknown as EncryptedEnvelope;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger('AdminAuthService');
  private readonly config: PlatformRuntimeConfig;
  private readonly database: DatabaseRuntime;
  private readonly auth!: AdminAuthRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;
  private readonly dummyPasswordHash = hashPassword(randomBytes(32).toString('base64url'));

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) database?: DatabaseRuntime,
    @Optional() @Inject(AdminLoginRateLimiter) private readonly loginRateLimiter?: AdminLoginRateLimiter,
  ) {
    if (!config || !database) {
      this.config = undefined as never;
      this.database = undefined as never;
      return;
    }
    this.config = config;
    this.database = database;
    this.auth = new AdminAuthRepository(database.prisma);
    this.audit = new AuditRepository(config.encryption.ipHashKey);
    this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
  }

  private get tokenConfig() {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Authentication runtime is unavailable');
    return {
      audience: this.config.authentication.audience,
      issuer: this.config.authentication.issuer,
      keys: this.config.authentication.signingKeys,
    };
  }

  async login(input: LoginInput, idempotencyKey: string, requestId: string, ipAddress?: string) {
    const claim = this.claim(ADMIN_LOGIN_IDEMPOTENCY_ACTOR, idempotencyKey, ROUTES.login, input);
    const replayStatus = await this.replayStatus(claim);
    if (replayStatus !== null) throw loginOutcome(replayStatus);
    const attemptLease = await this.loginLimiter().claimAttempt(idempotencyKey, input.loginName, ipAddress);
    try {
      return await this.loginAfterClaim(input, idempotencyKey, requestId, claim, ipAddress);
    } finally {
      try {
        await this.loginLimiter().releaseAttempt(attemptLease, idempotencyKey, input.loginName, ipAddress);
      } catch {
        this.logger.error({ error_code: 'ADMIN_LOGIN_LEASE_RELEASE_FAILED', service: 'api' });
      }
    }
  }

  private async loginAfterClaim(input: LoginInput, idempotencyKey: string, requestId: string,
    claim: IdempotencyClaim, ipAddress?: string) {
    try {
      await this.loginLimiter().assertAllowed(input.loginName, ipAddress);
    } catch (error) {
      if (!(error instanceof ApplicationError) || error.code !== 'RATE_LIMITED') throw error;
      const status = await this.completeOpaqueLoginFailure(claim, requestId, idempotencyKey, 429, ipAddress);
      throw loginOutcome(status);
    }
    let subject;
    try { subject = await this.auth.findLoginSubject(input.loginName); } catch (error) {
      if (error instanceof ApplicationError && error.code === 'RATE_LIMITED') {
        const status = await this.completeOpaqueLoginFailure(claim, requestId, idempotencyKey, 429, ipAddress);
        throw loginOutcome(status);
      }
      if (!(error instanceof InvalidAdminLoginNameError)) throw error;
      let locked = false;
      try {
        await this.loginLimiter().recordUnresolvedFailure(input.loginName, idempotencyKey, ipAddress);
      } catch (rateError) {
        if (!(rateError instanceof ApplicationError) || rateError.code !== 'RATE_LIMITED') throw rateError;
        locked = true;
      }
      await verifyPasswordHash(await this.dummyPasswordHash, input.password);
      const status = await this.completeOpaqueLoginFailure(
        claim,
        requestId,
        idempotencyKey,
        locked ? 429 : 401,
        ipAddress,
      );
      throw loginOutcome(status);
    }
    if (subject === null || subject.status !== 'ACTIVE') {
      let locked = false;
      try {
        await this.loginLimiter().recordUnresolvedFailure(input.loginName, idempotencyKey, ipAddress);
      } catch (error) {
        if (!(error instanceof ApplicationError) || error.code !== 'RATE_LIMITED') throw error;
        locked = true;
      }
      await verifyPasswordHash(subject?.passwordHash ?? await this.dummyPasswordHash, input.password);
      const status = await this.completeOpaqueLoginFailure(
        claim,
        requestId,
        idempotencyKey,
        locked ? 429 : 401,
        ipAddress,
      );
      throw loginOutcome(status);
    }
    const passwordValid = await verifyPasswordHash(subject.passwordHash, input.password);
    if (!passwordValid) {
      let sourceLocked = false;
      try {
        await this.loginLimiter().recordSourceFailure(input.loginName, idempotencyKey, ipAddress);
      } catch (error) {
        if (!(error instanceof ApplicationError) || error.code !== 'RATE_LIMITED') throw error;
        sourceLocked = true;
      }
      const status = await runSerializableTransaction(this.database.prisma, async (transaction) => {
        const claimed = await this.idempotency.claim(transaction, claim);
        if (claimed.kind === 'replay') return claimed.record.response_status;
        const result = await this.auth.recordAuthenticationFailureInTransaction(transaction, {
          accountId: subject.id,
          expectedAccountVersion: subject.version,
          purpose: 'LOGIN',
        });
        const locked = sourceLocked || result.kind === 'locked';
        await this.auditFailure(transaction, subject.id, 'LOGIN', requestId, idempotencyKey,
          locked ? 'RATE_LIMITED' : 'AUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: locked ? 'RATE_LIMITED' : 'AUTH_REQUIRED' },
          responseStatus: locked ? 429 : 401,
          storage: 'HASH_ONLY',
        });
        return locked ? 429 : 401;
      });
      throw loginOutcome(status);
    }

    const challengeId = subject.activeFactorId === null ? null : generateUlid();
    const nextAction = challengeId === null ? 'ENROLL_TOTP' : 'VERIFY_TOTP';
    const signed = signPreAuthToken(this.tokenConfig, {
      accountId: subject.id,
      accountVersion: subject.version,
      challengeId,
      nextAction,
      tokenId: generateUlid(),
    }, this.config.authentication.preAuthTokenTtlSeconds);
    await runSerializableTransaction(this.database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') throw loginOutcome(claimed.record.response_status);
      if (challengeId === null) {
        await this.auth.assertLoginAvailableInTransaction(transaction, subject.id, subject.version);
      } else {
        await this.auth.createLoginChallengeInTransaction(transaction, {
          accountId: subject.id,
          challengeId,
          challengeTokenHash: this.currentSecretHash(signed.token, 'challenge'),
          expiresAt: signed.expiresAt,
          expectedAccountVersion: subject.version,
        });
      }
      await this.auditSuccess(transaction, subject.id, 'LOGIN', requestId, idempotencyKey,
        'account', subject.id, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: challengeId ?? subject.id,
        responseForHash: { challenge_id: challengeId, next_action: nextAction },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
    });
    return {
      assurance: 'PASSWORD_ONLY',
      challenge_id: challengeId,
      expires_at: signed.expiresAt.toISOString(),
      mfa_required: true,
      next_action: nextAction,
      pre_auth_token: signed.token,
    };
  }

  private loginLimiter(): AdminLoginRateLimiter {
    if (!this.loginRateLimiter) {
      throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter is unavailable');
    }
    return this.loginRateLimiter;
  }

  private replayStatus(claim: IdempotencyClaim): Promise<number | null> {
    return runSerializableTransaction(this.database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      return claimed.kind === 'replay' ? claimed.record.response_status : null;
    });
  }

  private completeOpaqueLoginFailure(
    claim: IdempotencyClaim,
    requestId: string,
    idempotencyKey: string,
    status: 401 | 429,
    ipAddress?: string,
  ): Promise<number> {
    return runSerializableTransaction(this.database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') return claimed.record.response_status;
      await this.audit.append(transaction, {
        action: 'LOGIN',
        idempotencyKey,
        module: 'admin_auth',
        objectId: ADMIN_LOGIN_IDEMPOTENCY_ACTOR,
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

  async refresh(input: RefreshInput, idempotencyKey: string, requestId: string, ipAddress?: string) {
    const presentedHashes = this.secretHashes(input.refreshToken, 'refresh-token');
    const matches = await this.database.prisma.authSession.findMany({
      where: { refresh_token_hash: { in: [...presentedHashes] } }, select: { account_id: true }, take: 2,
    });
    if (matches.length !== 1 || !matches[0]) throw invalidAuthentication();
    const actorId = matches[0].account_id;
    const claim = this.claim(actorId, idempotencyKey, ROUTES.refresh, input);
    const draft = this.sessionDraft(actorId);
    const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      const rotated = await this.auth.rotateRefreshInTransaction(transaction, {
        presentedRefreshTokenHashCandidates: presentedHashes,
        session: draft.material,
      });
      if (rotated.kind !== 'rotated') {
        await this.auditFailure(transaction, actorId, 'REFRESH', requestId, idempotencyKey,
          'AUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: rotated.kind }, responseStatus: 401, storage: 'HASH_ONLY',
        });
        return rotated;
      }
      await this.auditSuccess(transaction, actorId, 'REFRESH', requestId, idempotencyKey,
        'session', rotated.sessionId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: rotated.sessionId,
        responseForHash: { session_id: rotated.sessionId }, responseStatus: 200, storage: 'HASH_ONLY',
      });
      return rotated;
    });
    if (result.kind !== 'rotated') throw invalidAuthentication();
    return this.sessionData(actorId, draft);
  }

  logout(session: CurrentAdminSession, key: string, requestId: string, ipAddress?: string) {
    return this.command(session.accountId, key, ROUTES.logout, {}, requestId, 'LOGOUT', 'session', session.sessionId,
      async (transaction) => {
        await this.auth.revokeSessionInTransaction(transaction, {
          accountId: session.accountId,
          sessionFamily: session.sessionFamily,
          sessionId: session.sessionId,
        });
        return { status: 'REVOKED', version: 1 };
      }, ipAddress);
  }

  logoutAll(session: CurrentAdminSession, key: string, requestId: string, ipAddress?: string) {
    return this.command(session.accountId, key, ROUTES.logoutAll, {}, requestId, 'LOGOUT', 'account', session.accountId,
      async (transaction) => {
        const revoked = await this.auth.revokeAllSessionsInTransaction(transaction, {
          accountId: session.accountId,
          expectedVersion: session.accountVersion,
        });
        return { status: 'ACTIVE', version: revoked.version };
      }, ipAddress);
  }

  current(session: CurrentAdminSession) {
    return {
      account_id: session.accountId,
      assurance: 'MFA',
      mfa_verified_at: session.mfaVerifiedAt.toISOString(),
      permissions: [...SUPER_ADMIN_PERMISSIONS],
      restriction: 'NONE',
      role: 'SUPER_ADMIN',
      session_id: session.sessionId,
      status: 'ACTIVE',
      version: session.accountVersion,
    };
  }

  async changePassword(session: CurrentAdminSession, input: ChangePasswordInput, key: string,
    requestId: string, ipAddress?: string) {
    const newHash = await hashPassword(input.newPassword);
    const claim = this.claim(session.accountId, key, ROUTES.changePassword, input);
    const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.response_status === 401) throw invalidAuthentication();
        const response = claimed.record.response_body;
        if (!response) throw new ApplicationError('INTERNAL_ERROR', 'Cached command response is invalid');
        return { kind: 'replay' as const, response: preEnvelopedResponse(response as never) };
      }
      const account = await transaction.account.findUnique({ where: { id: session.accountId } });
      if (!account?.password_hash || !(await verifyPasswordHash(account.password_hash, input.currentPassword))) {
        await this.auditFailure(transaction, session.accountId, 'UPDATE', requestId, key, 'AUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: 'AUTH_REQUIRED' }, responseStatus: 401, storage: 'HASH_ONLY',
        });
        return { kind: 'invalid' as const };
      }
      const changed = await this.auth.changePasswordInTransaction(transaction, {
        accountId: session.accountId,
        currentSessionId: session.sessionId,
        expectedPasswordHash: account.password_hash,
        expectedVersion: session.accountVersion,
        newPasswordHash: newHash,
      });
      const data = {
        occurred_at: new Date().toISOString(), resource_id: session.accountId, resource_type: 'account' as const,
        status: 'ACTIVE' as const, version: changed.version,
      };
      const response = { code: 'OK' as const, data, message: 'success' as const, request_id: requestId };
      await this.auditSuccess(transaction, session.accountId, 'UPDATE', requestId, key,
        'account', session.accountId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE', responseBody: response, responseStatus: 200, storage: 'CACHEABLE',
      });
      return { kind: 'changed' as const, response: preEnvelopedResponse(response) };
    });
    if (result.kind === 'invalid') throw invalidAuthentication();
    return result.response;
  }

  async enroll(preAuth: VerifiedPreAuthClaims, token: string, input: EnrollInput, key: string,
    requestId: string, ipAddress?: string) {
    const factorId = generateUlid();
    const challengeId = generateUlid();
    const secret = createTotpSecret();
    const expiresAt = preAuth.expiresAt;
    const label = input.label?.trim() || '总部管理员';
    const envelope = encryptEnvelope(secret, {
      keyId: this.config.encryption.fieldKeys.current.id,
      key: this.config.encryption.fieldKeys.current.key,
    },
      createEncryptionContext('totp_factor', factorId, 'secret_ciphertext'));
    const otpauthUri = createTotpUri(secret, label);
    const claim = this.claim(preAuth.accountId, key, ROUTES.enroll, input);
    await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      await this.auth.createEnrollmentInTransaction(transaction, {
        accountId: preAuth.accountId,
        challengeId,
        challengeTokenHash: this.currentSecretHash(token, 'challenge'),
        encryptionKeyId: this.config.encryption.fieldKeys.current.id,
        expiresAt,
        expectedAccountVersion: preAuth.accountVersion,
        factorId,
        label,
        secretCiphertext: Buffer.from(JSON.stringify(envelope)),
        secretFingerprint: this.currentSecretHash(secret, 'totp-secret'),
      });
      await this.auditSuccess(transaction, preAuth.accountId, 'ENROLL', requestId, key,
        'account', preAuth.accountId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: factorId,
        responseForHash: { challenge_id: challengeId, factor_id: factorId }, responseStatus: 200, storage: 'HASH_ONLY',
      });
    });
    return { challenge_id: challengeId, expires_at: expiresAt.toISOString(), factor_id: factorId, otpauth_uri: otpauthUri };
  }

  async verifyEnrollment(preAuth: VerifiedPreAuthClaims, token: string, input: TotpVerifyInput, key: string,
    requestId: string, ipAddress?: string) {
    const context = await this.challengeContext(preAuth.accountId, input.challengeId, token, 'ENROLL');
    const verification = await verifyTotpCode(this.decryptFactorSecret(context.factor.id,
      context.factor.secretCiphertext, context.factor.encryptionKeyId), input.totpCode);
    const claim = this.claim(preAuth.accountId, key, ROUTES.enrollVerify, input);
    if (!verification.valid) {
      await this.recordTotpFailure(claim, preAuth.accountId, preAuth.accountVersion, input.challengeId,
        'ENROLL', requestId, key, ipAddress);
      throw invalidAuthentication();
    }
    const recoveryCodes = generateRecoveryCodes();
    const recoveryMaterials = this.recoveryMaterials(recoveryCodes);
    const draft = this.sessionDraft(preAuth.accountId);
    const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      const completed = await this.auth.completeEnrollmentInTransaction(transaction, {
        acceptedTimestep: verification.timestep,
        accountId: preAuth.accountId,
        challengeId: input.challengeId,
        challengeTokenHashCandidates: this.secretHashes(token, 'challenge'),
        expectedAccountVersion: preAuth.accountVersion,
        factorId: context.factor.id,
        recoveryCodes: recoveryMaterials,
        session: draft.material,
      });
      await this.auditSuccess(transaction, preAuth.accountId, 'VERIFY', requestId, key,
        'session', completed.session.id, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: completed.session.id,
        responseForHash: { factor_id: completed.factorId, session_id: completed.session.id }, responseStatus: 200, storage: 'HASH_ONLY',
      });
      return completed;
    });
    return { factor_id: result.factorId, recovery_codes: recoveryCodes, session: this.sessionData(preAuth.accountId, draft) };
  }

  async verifyLogin(preAuth: VerifiedPreAuthClaims, token: string, pathId: string, input: TotpVerifyInput,
    key: string, requestId: string, ipAddress?: string) {
    if (pathId !== input.challengeId || preAuth.challengeId !== pathId) {
      throw new ApplicationError('INVALID_ARGUMENT', 'Challenge identifiers do not match');
    }
    const context = await this.challengeContext(preAuth.accountId, pathId, token, 'LOGIN');
    const verification = await verifyTotpCode(this.decryptFactorSecret(context.factor.id,
      context.factor.secretCiphertext, context.factor.encryptionKeyId), input.totpCode);
    const route = '/admin/auth/mfa/challenges/{challenge_id}/verify';
    const claim = this.claim(preAuth.accountId, key, route, input, { challenge_id: pathId });
    if (!verification.valid) {
      await this.recordTotpFailure(claim, preAuth.accountId, preAuth.accountVersion, pathId,
        'LOGIN', requestId, key, ipAddress);
      throw invalidAuthentication();
    }
    const draft = this.sessionDraft(preAuth.accountId);
    await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      await this.auth.completeLoginTotpInTransaction(transaction, {
        acceptedTimestep: verification.timestep,
        accountId: preAuth.accountId,
        challengeId: pathId,
        challengeTokenHashCandidates: this.secretHashes(token, 'challenge'),
        expectedAccountVersion: preAuth.accountVersion,
        session: draft.material,
      });
      await this.auditSuccess(transaction, preAuth.accountId, 'VERIFY', requestId, key,
        'session', draft.material.id, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: draft.material.id,
        responseForHash: { session_id: draft.material.id }, responseStatus: 200, storage: 'HASH_ONLY',
      });
    });
    return this.sessionData(preAuth.accountId, draft);
  }

  async createReauthChallenge(session: CurrentAdminSession, token: string, input: ReauthChallengeInput,
    key: string, requestId: string, ipAddress?: string) {
    const now = new Date();
    const expiresAt = new Date(Math.min(now.getTime() + REAUTH_CHALLENGE_TTL_MS, session.expiresAt.getTime()));
    if (expiresAt.getTime() <= now.getTime()) throw invalidAuthentication();
    const challengeId = generateUlid();
    const claim = this.claim(session.accountId, key, ROUTES.reauthChallenge, input);
    await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      await this.auth.createReauthChallengeInTransaction(transaction, {
        accountId: session.accountId,
        challengeId,
        challengeTokenHash: this.currentSecretHash(
          this.reauthChallengeSecret(challengeId, token),
          'reauth-challenge',
        ),
        currentSessionId: session.sessionId,
        expiresAt,
        expectedAccountVersion: session.accountVersion,
        factorId: session.factorId,
        ...(input.targetId === undefined ? {} : { targetId: input.targetId }),
      });
      await this.auditSuccess(transaction, session.accountId, 'CREATE', requestId, key,
        'session', session.sessionId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: challengeId,
        responseForHash: { challenge_id: challengeId, purpose: 'REAUTH' },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
    });
    return { challenge_id: challengeId, expires_at: expiresAt.toISOString(), purpose: 'REAUTH' };
  }

  async verifyReauthChallenge(session: CurrentAdminSession, token: string, pathId: string,
    input: TotpVerifyInput, key: string, requestId: string, ipAddress?: string) {
    if (pathId !== input.challengeId) {
      throw new ApplicationError('INVALID_ARGUMENT', 'Challenge identifiers do not match');
    }
    const context = await this.challengeContext(session.accountId, pathId, token, 'REAUTH', session.sessionId);
    const verification = await verifyTotpCode(this.decryptFactorSecret(context.factor.id,
      context.factor.secretCiphertext, context.factor.encryptionKeyId), input.totpCode);
    const route = '/admin/auth/mfa/challenges/{challenge_id}/verify';
    const claim = this.claim(session.accountId, key, route, input, { challenge_id: pathId });
    if (!verification.valid) {
      await this.recordTotpFailure(claim, session.accountId, session.accountVersion, pathId,
        'REAUTH', requestId, key, ipAddress, { factorId: session.factorId, sessionId: session.sessionId });
      throw reauthRequired();
    }
    const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      const completed = await this.auth.completeReauthChallengeInTransaction(transaction, {
        acceptedTimestep: verification.timestep,
        accountId: session.accountId,
        challengeId: pathId,
        challengeTokenHashCandidates: this.secretHashes(
          this.reauthChallengeSecret(pathId, token),
          'reauth-challenge',
        ),
        currentSessionId: session.sessionId,
        expectedAccountVersion: session.accountVersion,
        factorId: session.factorId,
      });
      await this.auditSuccess(transaction, session.accountId, 'VERIFY', requestId, key,
        'session', session.sessionId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: pathId,
        responseForHash: { challenge_id: pathId, purpose: 'REAUTH', verified_at: completed.verifiedAt.toISOString() },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return completed;
    });
    return { challenge_id: pathId, purpose: 'REAUTH', verified_at: result.verifiedAt.toISOString() };
  }

  async reauth(session: CurrentAdminSession, input: PayoutReauthInput, key: string,
    requestId: string, ipAddress?: string) {
    const claim = this.claim(session.accountId, key, ROUTES.reauth, input);
    const verification = await verifyTotpCode(this.decryptFactorSecret(session.factorId,
      session.factorSecretCiphertext, session.factorEncryptionKeyId), input.totpCode);
    if (!verification.valid) {
      const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
        if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
        const failure = await this.auth.recordPayoutReauthFailureInTransaction(transaction, {
          accountId: session.accountId,
          currentSessionId: session.sessionId,
          expectedAccountVersion: session.accountVersion,
          factorId: session.factorId,
          targetId: input.withdrawalId,
        });
        const locked = failure.kind === 'locked';
        await this.auditFailure(transaction, session.accountId, 'VERIFY', requestId, key,
          locked ? 'REAUTH_LOCKED' : 'REAUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: failure.kind },
          responseStatus: locked ? 429 : 403,
          storage: 'HASH_ONLY',
        });
        return failure;
      });
      if (result.kind === 'locked') {
        throw new ApplicationError('REAUTH_LOCKED', 'Administrator reauthentication is locked');
      }
      throw reauthRequired();
    }

    const now = new Date();
    const expiresAt = new Date(Math.min(now.getTime() + REAUTH_GRANT_TTL_MS, session.expiresAt.getTime()));
    if (expiresAt.getTime() <= now.getTime()) throw invalidAuthentication();
    const grantId = generateUlid();
    const grant = generateOpaqueToken('rag');
    await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      await this.auth.createPayoutReauthGrantInTransaction(transaction, {
        acceptedTimestep: verification.timestep,
        accountId: session.accountId,
        currentSessionId: session.sessionId,
        expectedAccountVersion: session.accountVersion,
        expiresAt,
        factorId: session.factorId,
        grantId,
        targetId: input.withdrawalId,
        tokenHash: this.currentSecretHash(grant, 'reauth-grant'),
      });
      await this.auditSuccess(transaction, session.accountId, 'VERIFY', requestId, key,
        'withdrawal', input.withdrawalId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: grantId,
        responseForHash: { expires_at: expiresAt.toISOString(), grant_id: grantId, withdrawal_id: input.withdrawalId },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
    });
    return { expires_at: expiresAt.toISOString(), reauth_grant: grant, single_use: true, withdrawal_id: input.withdrawalId };
  }

  async recover(preAuth: VerifiedPreAuthClaims, token: string, input: RecoveryInput, key: string,
    requestId: string, ipAddress?: string) {
    if (preAuth.challengeId !== input.challengeId) throw new ApplicationError('INVALID_ARGUMENT', 'Challenge identifiers do not match');
    const claim = this.claim(preAuth.accountId, key, ROUTES.recovery, input);
    const draft = this.sessionDraft(preAuth.accountId);
    const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      const completed = await this.auth.completeLoginRecoveryInTransaction(transaction, {
        accountId: preAuth.accountId,
        challengeId: input.challengeId,
        challengeTokenHashCandidates: this.secretHashes(token, 'challenge'),
        expectedAccountVersion: preAuth.accountVersion,
        recoveryCodeHashCandidates: this.secretHashes(input.recoveryCode, 'recovery-code'),
        session: draft.material,
      });
      if (completed.kind !== 'authenticated') {
        const locked = completed.kind === 'locked';
        await this.auditFailure(transaction, preAuth.accountId, 'RECOVER', requestId, key,
          locked ? 'RATE_LIMITED' : 'AUTH_REQUIRED', ipAddress);
        await this.idempotency.complete(transaction, claim, {
          responseForHash: { result: completed.kind }, responseStatus: locked ? 429 : 401, storage: 'HASH_ONLY',
        });
        return completed;
      }
      await this.auditSuccess(transaction, preAuth.accountId, 'RECOVER', requestId, key,
        'session', completed.session.id, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: completed.session.id,
        responseForHash: { session_id: completed.session.id }, responseStatus: 200, storage: 'HASH_ONLY',
      });
      return completed;
    });
    if (result.kind !== 'authenticated') {
      if (result.kind === 'locked') throw new ApplicationError('RATE_LIMITED', 'Administrator login is locked');
      throw invalidAuthentication();
    }
    return this.sessionData(preAuth.accountId, draft);
  }

  async rotateRecoveryCodes(session: CurrentAdminSession, input: TotpInput, key: string,
    requestId: string, ipAddress?: string) {
    const verification = await verifyTotpCode(this.decryptFactorSecret(session.factorId,
      session.factorSecretCiphertext, session.factorEncryptionKeyId), input.totpCode);
    const claim = this.claim(session.accountId, key, ROUTES.recoveryRotate, input);
    if (!verification.valid) {
      await this.recordTotpFailure(claim, session.accountId, session.accountVersion, undefined,
        'RECOVERY', requestId, key, ipAddress, {
          factorId: session.factorId,
          sessionId: session.sessionId,
        });
      throw invalidAuthentication();
    }
    const codes = generateRecoveryCodes();
    const materials = this.recoveryMaterials(codes);
    const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      const rotated = await this.auth.rotateRecoveryCodesInTransaction(transaction, {
        acceptedTimestep: verification.timestep,
        accountId: session.accountId,
        currentSessionId: session.sessionId,
        expectedAccountVersion: session.accountVersion,
        factorId: session.factorId,
        recoveryCodes: materials,
      });
      await this.auditSuccess(transaction, session.accountId, 'ROTATE', requestId, key,
        'account', session.accountId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        resourceId: session.factorId,
        responseForHash: { factor_id: session.factorId, rotated_at: rotated.rotatedAt.toISOString() },
        responseStatus: 200, storage: 'HASH_ONLY',
      });
      return rotated;
    });
    return { recovery_codes: codes, rotated_at: result.rotatedAt.toISOString() };
  }

  private claim(actorId: string, key: string, route: string, body: unknown,
    pathParameters: Record<string, string> = {}): IdempotencyClaim {
    return { actorId, idempotencyKey: key, request: { body, method: 'POST', pathParameters, route } };
  }

  private async command(actorId: string, key: string, route: string, body: unknown, requestId: string,
    action: 'LOGOUT' | 'UPDATE', objectType: 'account' | 'session', objectId: string,
    work: (transaction: DatabaseTransaction) => Promise<{ status: 'ACTIVE' | 'REVOKED'; version: number }>,
    ipAddress?: string) {
    const claim = this.claim(actorId, key, route, body);
    return runSerializableTransaction(this.database.prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const response = claimed.record.response_body;
        if (!response) throw new ApplicationError('INTERNAL_ERROR', 'Cached command response is invalid');
        return preEnvelopedResponse(response as never);
      }
      const result = await work(transaction);
      const data = {
        occurred_at: new Date().toISOString(), resource_id: objectId, resource_type: objectType,
        status: result.status, version: result.version,
      };
      const response = { code: 'OK' as const, data, message: 'success' as const, request_id: requestId };
      await this.auditSuccess(transaction, actorId, action, requestId, key, objectType, objectId, ipAddress);
      await this.idempotency.complete(transaction, claim, {
        policy: 'COMMAND_RESPONSE', responseBody: response, responseStatus: 200, storage: 'CACHEABLE',
      });
      return preEnvelopedResponse(response);
    });
  }

  private sessionDraft(accountId: string): SessionDraft {
    const now = new Date();
    const accessJti = generateUlid();
    const sessionId = generateUlid();
    const refreshToken = generateOpaqueToken('rfr');
    const signed = signAccessToken(this.tokenConfig, {
      accountId, assurance: 'MFA', permissions: SUPER_ADMIN_PERMISSIONS,
      restriction: 'NONE', role: 'SUPER_ADMIN',
      sessionId, tokenId: accessJti,
    }, this.config.authentication.accessTokenTtlSeconds, now);
    return {
      accessExpiresAt: signed.expiresAt,
      accessToken: signed.token,
      material: {
        accessJti,
        expiresAt: new Date(now.getTime() + this.config.authentication.sessionTtlSeconds * 1_000),
        id: sessionId,
        refreshTokenHash: this.currentSecretHash(refreshToken, 'refresh-token'),
        sessionFamily: generateUlid(),
      },
      refreshToken,
    };
  }

  private sessionData(accountId: string, draft: SessionDraft) {
    return {
      access_token: draft.accessToken, account_id: accountId, assurance: 'MFA',
      expires_at: draft.accessExpiresAt.toISOString(), mfa_required: false, refresh_token: draft.refreshToken,
      restriction: 'NONE', role: 'SUPER_ADMIN', session_id: draft.material.id,
    };
  }

  private secretHashes(value: string,
    domain: 'challenge' | 'reauth-challenge' | 'reauth-grant' | 'recovery-code' | 'refresh-token') {
    return [this.config.authentication.secretHashKeys.current,
      ...this.config.authentication.secretHashKeys.previous]
      .map(({ key }) => hmacAuthenticationSecret(value, key, domain));
  }

  private currentSecretHash(value: string,
    domain: 'challenge' | 'reauth-challenge' | 'reauth-grant' | 'recovery-code' | 'refresh-token' | 'totp-secret') {
    return hmacAuthenticationSecret(value, this.config.authentication.secretHashKeys.current.key, domain);
  }

  private recoveryMaterials(codes: readonly string[]): RecoveryCodeMaterial[] {
    return codes.map((code) => ({ id: generateUlid(), codeHash: this.currentSecretHash(code, 'recovery-code') }));
  }

  private reauthChallengeSecret(challengeId: string, token: string): string {
    return `${challengeId}:${token}`;
  }

  private decryptFactorSecret(factorId: string, ciphertext: Uint8Array, encryptionKeyId: string): string {
    const envelope = exactEnvelope(Buffer.from(ciphertext).toString('utf8'));
    if (envelope.keyId !== encryptionKeyId) throw new ApplicationError('INTERNAL_ERROR', 'TOTP encryption key mismatch');
    return decryptEnvelopeText(envelope, (keyId) => {
      const key = [this.config.encryption.fieldKeys.current, ...this.config.encryption.fieldKeys.previous]
        .find((candidate) => candidate.id === keyId);
      if (!key) throw new ApplicationError('INTERNAL_ERROR', 'TOTP encryption key is unavailable');
      return key.key;
    }, createEncryptionContext('totp_factor', factorId, 'secret_ciphertext'));
  }

  private async challengeContext(accountId: string, challengeId: string, token: string,
    purpose: 'ENROLL' | 'LOGIN' | 'REAUTH', currentSessionId?: string) {
    const secret = purpose === 'REAUTH' ? this.reauthChallengeSecret(challengeId, token) : token;
    const context = await this.auth.getChallengeVerificationContext({
      accountId,
      challengeId,
      challengeTokenHashCandidates: this.secretHashes(
        secret,
        purpose === 'REAUTH' ? 'reauth-challenge' : 'challenge',
      ),
      ...(currentSessionId === undefined ? {} : { currentSessionId }),
      purpose,
    });
    if (!context) throw new ApplicationError('STATE_CONFLICT', 'MFA challenge is not usable');
    if (context.lockedUntil && context.lockedUntil.getTime() > Date.now()) {
      throw new ApplicationError(purpose === 'REAUTH' ? 'REAUTH_LOCKED' : 'RATE_LIMITED', 'MFA is locked');
    }
    return context;
  }

  private async recordTotpFailure(claim: IdempotencyClaim, accountId: string, expectedAccountVersion: number,
    challengeId: string | undefined, purpose: 'ENROLL' | 'LOGIN' | 'REAUTH' | 'RECOVERY', requestId: string,
    key: string, ipAddress?: string, currentSession?: { factorId: string; sessionId: string }) {
    const result = await runSerializableTransaction(this.database.prisma, async (transaction) => {
      if ((await this.idempotency.claim(transaction, claim)).kind === 'replay') throw noReplay();
      const failure = await this.auth.recordAuthenticationFailureInTransaction(transaction, {
        accountId,
        expectedAccountVersion,
        ...(challengeId ? { challengeId } : {}),
        ...(currentSession ? {
          currentSessionId: currentSession.sessionId,
          factorId: currentSession.factorId,
        } : {}),
        purpose,
      });
      const locked = failure.kind === 'locked';
      await this.auditFailure(transaction, accountId, 'VERIFY', requestId, key,
        locked ? (purpose === 'REAUTH' ? 'REAUTH_LOCKED' : 'RATE_LIMITED') :
          (purpose === 'REAUTH' ? 'REAUTH_REQUIRED' : 'AUTH_REQUIRED'), ipAddress);
      await this.idempotency.complete(transaction, claim, {
        responseForHash: { result: failure.kind },
        responseStatus: locked ? 429 : purpose === 'REAUTH' ? 403 : 401,
        storage: 'HASH_ONLY',
      });
      return failure;
    });
    if (result.kind === 'locked') {
      throw new ApplicationError(purpose === 'REAUTH' ? 'REAUTH_LOCKED' : 'RATE_LIMITED', 'MFA is locked');
    }
  }

  private auditSuccess(transaction: DatabaseTransaction, actorId: string,
    action: 'CREATE' | 'ENROLL' | 'LOGIN' | 'LOGOUT' | 'RECOVER' | 'REFRESH' | 'ROTATE' | 'UPDATE' | 'VERIFY',
    requestId: string, idempotencyKey: string, objectType: 'account' | 'session' | 'withdrawal', objectId: string,
    ipAddress?: string) {
    return this.audit.append(transaction, {
      action, actorAccountId: actorId, actorRole: 'SUPER_ADMIN', idempotencyKey, module: 'admin_auth',
      objectId, objectType, requestId, result: 'SUCCESS', resultCode: 'OK', summaryPolicy: 'NONE',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }

  private auditFailure(transaction: DatabaseTransaction, actorId: string,
    action: 'LOGIN' | 'RECOVER' | 'REFRESH' | 'UPDATE' | 'VERIFY', requestId: string, idempotencyKey: string,
    resultCode: 'AUTH_REQUIRED' | 'RATE_LIMITED' | 'REAUTH_LOCKED' | 'REAUTH_REQUIRED', ipAddress?: string) {
    return this.audit.append(transaction, {
      action, actorAccountId: actorId, actorRole: 'SUPER_ADMIN', idempotencyKey, module: 'admin_auth',
      objectId: actorId, objectType: 'account', requestId, result: 'FAILURE', resultCode, summaryPolicy: 'NONE',
      ...(ipAddress ? { ipAddress } : {}),
    });
  }
}
