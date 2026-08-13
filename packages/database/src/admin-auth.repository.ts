import { timingSafeEqual } from 'node:crypto';

import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import type { AuthSession, PrismaClient } from '../.generated/prisma/client';
import type { MfaChallengePurpose } from '../.generated/prisma/enums';
import type { DatabaseTransaction } from './idempotency.repository';
import { acquireTransactionLock } from './advisory-lock';

const CHALLENGE_TTL_MS = 5 * 60 * 1_000;
const MFA_LOCK_MS = 15 * 60 * 1_000;
const MAX_FAILED_ATTEMPTS = 5;
const HEX_64 = /^[a-f0-9]{64}$/;
const ACCESS_JTI = /^[A-Za-z0-9._:-]{16,80}$/;
const KEY_ID = /^[A-Za-z0-9._:-]{3,80}$/;

export interface AdminSessionMaterial {
  id: string;
  accessJti: string;
  refreshTokenHash: string;
  expiresAt: Date;
}

export interface InitialAdminSessionMaterial extends AdminSessionMaterial {
  sessionFamily: string;
}

export interface RecoveryCodeMaterial {
  id: string;
  codeHash: string;
}

export interface AdminLoginSubject {
  id: string;
  loginName: string;
  passwordHash: string;
  status: 'ACTIVE' | 'DISABLED' | 'DELETION_PENDING' | 'ANONYMIZED';
  version: number;
  activeFactorId: string | null;
}

export interface ChallengeVerificationContext {
  accountId: string;
  challengeId: string;
  challengeTokenHash: string;
  expiresAt: Date;
  factor: {
    id: string;
    secretCiphertext: Uint8Array;
    encryptionKeyId: string;
    status: 'PENDING' | 'ACTIVE' | 'REVOKED';
    lastUsedTimestep: bigint | null;
  };
  lockedUntil: Date | null;
  purpose: MfaChallengePurpose;
}

export type SecretHashCandidates = readonly string[];

export type AuthenticationFailureResult =
  | { kind: 'recorded'; failedAttempts: number }
  | { kind: 'locked'; failedAttempts: number; lockedUntil: Date }
  | { kind: 'invalid' };

export type RefreshRotationResult =
  | { kind: 'rotated'; sessionId: string; sessionFamily: string; rotationCounter: number }
  | { kind: 'replay_detected'; sessionFamily: string }
  | { kind: 'invalid' };

export type LoginRecoveryResult =
  | { kind: 'authenticated'; session: AuthSession }
  | AuthenticationFailureResult;

export interface CurrentAdminSession {
  accountId: string;
  accountVersion: number;
  accessJti: string;
  expiresAt: Date;
  factorId: string;
  factorSecretCiphertext: Uint8Array;
  factorEncryptionKeyId: string;
  factorLastUsedTimestep: bigint | null;
  mfaVerifiedAt: Date;
  sessionFamily: string;
  sessionId: string;
}

function currentDate(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Admin auth clock must return a valid Date');
  }
  return value;
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireHash(value: string, label: string): void {
  if (!HEX_64.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
}

function requireHashCandidates(values: SecretHashCandidates, label: string): void {
  if (!Array.isArray(values) || values.length < 1 || values.length > 4) {
    throw new TypeError(`${label} must contain between one and four digests`);
  }
  for (const value of values) requireHash(value, label);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must not contain duplicate digests`);
}

function equalHash(first: string, second: string): boolean {
  if (!HEX_64.test(first) || !HEX_64.test(second)) return false;
  return timingSafeEqual(Buffer.from(first, 'hex'), Buffer.from(second, 'hex'));
}

function matchesAnyHash(stored: string, candidates: SecretHashCandidates): boolean {
  if (!HEX_64.test(stored)) return false;
  let matched = false;
  for (const candidate of candidates) matched = equalHash(stored, candidate) || matched;
  return matched;
}

function validateLoginName(value: string): void {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (value.length < 1 || value.length > 80 || value.trim() !== value || hasControlCharacter) {
    throw new InvalidAdminLoginNameError();
  }
}

export class InvalidAdminLoginNameError extends Error {
  constructor() {
    super('Admin login name is invalid');
    this.name = 'InvalidAdminLoginNameError';
  }
}

function validatePasswordHash(value: string): void {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (value.length < 20 || value.length > 255 || value.trim() !== value || hasControlCharacter) {
    throw new TypeError('Admin password hash is invalid');
  }
}

function validateChallengeExpiry(expiresAt: Date, now: Date): void {
  if (!(expiresAt instanceof Date) || !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= now.getTime() ||
    expiresAt.getTime() > now.getTime() + CHALLENGE_TTL_MS) {
    throw new TypeError('MFA challenge expiry must be within five minutes');
  }
}

function validateSessionMaterial(material: AdminSessionMaterial, now: Date): void {
  requireUlid(material.id, 'Session ID');
  if (!ACCESS_JTI.test(material.accessJti)) throw new TypeError('Access JTI is invalid');
  requireHash(material.refreshTokenHash, 'Refresh token hash');
  if (!(material.expiresAt instanceof Date) || !Number.isFinite(material.expiresAt.getTime()) ||
    material.expiresAt.getTime() <= now.getTime()) {
    throw new TypeError('Session expiry must be in the future');
  }
}

function validateInitialSessionMaterial(material: InitialAdminSessionMaterial, now: Date): void {
  validateSessionMaterial(material, now);
  requireUlid(material.sessionFamily, 'Session family');
}

function validateRecoveryCodes(codes: readonly RecoveryCodeMaterial[]): void {
  if (codes.length < 8 || codes.length > 20) {
    throw new TypeError('Between 8 and 20 recovery codes are required');
  }
  for (const code of codes) {
    requireUlid(code.id, 'Recovery code ID');
    requireHash(code.codeHash, 'Recovery code hash');
  }
  if (new Set(codes.map(({ id }) => id)).size !== codes.length ||
    new Set(codes.map(({ codeHash }) => codeHash)).size !== codes.length) {
    throw new TypeError('Recovery code IDs and hashes must be unique');
  }
}

function lockError(purpose: MfaChallengePurpose): ApplicationError {
  return new ApplicationError(purpose === 'REAUTH' ? 'REAUTH_LOCKED' : 'RATE_LIMITED', 'MFA is locked');
}

export class AdminAuthRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    currentDate(this.now);
  }

  private async lockRateLimit(
    transaction: DatabaseTransaction,
    accountId: string,
    purpose: MfaChallengePurpose,
    now: Date,
  ) {
    await acquireTransactionLock(transaction, 'admin-auth-rate-limit', [accountId, purpose]);
    let rateLimit = await transaction.mfaRateLimit.findUnique({
      where: { account_id_purpose: { account_id: accountId, purpose } },
    });
    if (!rateLimit) {
      rateLimit = await transaction.mfaRateLimit.create({
        data: {
          id: generateUlid(now.getTime()),
          account_id: accountId,
          purpose,
          failed_attempts: 0,
          created_at: now,
          updated_at: now,
        },
      });
    } else if (rateLimit.locked_until && rateLimit.locked_until.getTime() <= now.getTime()) {
      rateLimit = await transaction.mfaRateLimit.update({
        where: { id: rateLimit.id },
        data: {
          failed_attempts: 0,
          locked_until: null,
          updated_at: now,
          version: { increment: 1 },
        },
      });
    }
    return rateLimit;
  }

  private async requireAvailableRateLimit(
    transaction: DatabaseTransaction,
    accountId: string,
    purpose: MfaChallengePurpose,
    now: Date,
  ) {
    const rateLimit = await this.lockRateLimit(transaction, accountId, purpose, now);
    if (rateLimit.locked_until && rateLimit.locked_until.getTime() > now.getTime()) {
      throw lockError(purpose);
    }
    return rateLimit;
  }

  private async resetRateLimit(
    transaction: DatabaseTransaction,
    accountId: string,
    purpose: MfaChallengePurpose,
    now: Date,
  ): Promise<void> {
    await transaction.mfaRateLimit.updateMany({
      where: { account_id: accountId, purpose },
      data: {
        failed_attempts: 0,
        locked_until: null,
        updated_at: now,
        version: { increment: 1 },
      },
    });
  }

  private async requireActiveAdmin(transaction: DatabaseTransaction, accountId: string) {
    requireUlid(accountId, 'Account ID');
    const account = await transaction.account.findUnique({ where: { id: accountId } });
    if (!account || account.role !== 'SUPER_ADMIN' || account.status !== 'ACTIVE' ||
      account.deleted_at !== null || account.password_hash === null || account.login_name === null) {
      throw new ApplicationError('AUTH_REQUIRED', 'Active administrator account is required');
    }
    return account;
  }

  private async requireAdminVersion(
    transaction: DatabaseTransaction,
    accountId: string,
    expectedVersion: number,
  ) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      throw new TypeError('Expected account version is invalid');
    }
    await acquireTransactionLock(transaction, 'admin-auth-account', [accountId]);
    const account = await this.requireActiveAdmin(transaction, accountId);
    if (account.version !== expectedVersion) {
      throw new ApplicationError('AUTH_REQUIRED', 'Administrator authentication state is stale');
    }
    return account;
  }

  private async requireCurrentMfaSession(
    transaction: DatabaseTransaction,
    input: { accountId: string; factorId: string; sessionId: string },
    now: Date,
  ) {
    requireUlid(input.factorId, 'Factor ID');
    requireUlid(input.sessionId, 'Session ID');
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [input.accountId]);
    const session = await transaction.authSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.account_id !== input.accountId || session.revoked_at !== null ||
      session.expires_at.getTime() <= now.getTime() || session.assurance !== 'MFA' ||
      session.restriction !== 'NONE' || session.mfa_verified_at === null ||
      session.mfa_factor_id !== input.factorId) {
      throw new ApplicationError('AUTH_REQUIRED', 'Current administrator session is invalid');
    }
    return session;
  }

  private async requireChallenge(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      challengeId: string;
      challengeTokenHashCandidates: SecretHashCandidates;
      purpose: MfaChallengePurpose;
    },
    now: Date,
  ) {
    requireUlid(input.challengeId, 'Challenge ID');
    requireHashCandidates(input.challengeTokenHashCandidates, 'Challenge token hash candidates');
    await acquireTransactionLock(transaction, 'admin-auth-challenge', [input.challengeId]);
    const challenge = await transaction.mfaChallenge.findUnique({ where: { id: input.challengeId } });
    if (!challenge || challenge.account_id !== input.accountId || challenge.purpose !== input.purpose ||
      challenge.status !== 'PENDING' || challenge.expires_at.getTime() <= now.getTime() ||
      !matchesAnyHash(challenge.challenge_token_hash, input.challengeTokenHashCandidates)) {
      throw new ApplicationError('STATE_CONFLICT', 'MFA challenge is not usable');
    }
    return challenge;
  }

  private async createInitialSession(
    transaction: DatabaseTransaction,
    accountId: string,
    factorId: string,
    material: InitialAdminSessionMaterial,
    now: Date,
  ) {
    validateInitialSessionMaterial(material, now);
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [accountId]);
    return transaction.authSession.create({
      data: {
        id: material.id,
        account_id: accountId,
        access_jti: material.accessJti,
        refresh_token_hash: material.refreshTokenHash,
        assurance: 'MFA',
        restriction: 'NONE',
        mfa_factor_id: factorId,
        mfa_verified_at: now,
        session_family: material.sessionFamily,
        rotation_counter: 0,
        expires_at: material.expiresAt,
        created_at: now,
      },
    });
  }

  async bootstrapSuperAdminInTransaction(
    transaction: DatabaseTransaction,
    input: { accountId: string; loginName: string; passwordHash: string },
  ) {
    requireUlid(input.accountId, 'Account ID');
    validateLoginName(input.loginName);
    validatePasswordHash(input.passwordHash);
    const now = currentDate(this.now);
    await acquireTransactionLock(transaction, 'admin-auth-bootstrap', ['SUPER_ADMIN']);
    if (await transaction.account.count({ where: { role: 'SUPER_ADMIN' } }) !== 0) {
      throw new ApplicationError('STATE_CONFLICT', 'A super administrator already exists');
    }
    return transaction.account.create({
      data: {
        id: input.accountId,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        login_name: input.loginName,
        password_hash: input.passwordHash,
        must_change_password: false,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async findLoginSubject(loginName: string): Promise<AdminLoginSubject | null> {
    validateLoginName(loginName);
    const now = currentDate(this.now);
    const account = await this.prisma.account.findUnique({
      where: { login_name: loginName },
      include: {
        mfa_rate_limits: { where: { purpose: 'LOGIN' }, select: { locked_until: true }, take: 1 },
        totp_factors: { where: { status: 'ACTIVE' }, select: { id: true }, take: 1 },
      },
    });
    if (!account || account.role !== 'SUPER_ADMIN' || account.password_hash === null || account.login_name === null) {
      return null;
    }
    const lockedUntil = account.mfa_rate_limits[0]?.locked_until;
    if (lockedUntil && lockedUntil.getTime() > now.getTime()) throw lockError('LOGIN');
    return {
      id: account.id,
      loginName: account.login_name,
      passwordHash: account.password_hash,
      status: account.status,
      version: account.version,
      activeFactorId: account.totp_factors[0]?.id ?? null,
    };
  }

  async assertLoginAvailableInTransaction(
    transaction: DatabaseTransaction,
    accountId: string,
    expectedAccountVersion: number,
  ): Promise<void> {
    const now = currentDate(this.now);
    await this.requireAdminVersion(transaction, accountId, expectedAccountVersion);
    await this.requireAvailableRateLimit(transaction, accountId, 'LOGIN', now);
  }

  async createLoginChallengeInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      challengeId: string;
      challengeTokenHash: string;
      expiresAt: Date;
      expectedAccountVersion: number;
    },
  ) {
    const now = currentDate(this.now);
    requireUlid(input.challengeId, 'Challenge ID');
    requireHash(input.challengeTokenHash, 'Challenge token hash');
    validateChallengeExpiry(input.expiresAt, now);
    await this.requireAdminVersion(transaction, input.accountId, input.expectedAccountVersion);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'LOGIN', now);
    const factor = await transaction.totpFactor.findFirst({
      where: { account_id: input.accountId, status: 'ACTIVE' },
      orderBy: { created_at: 'desc' },
    });
    if (!factor) throw new ApplicationError('STATE_CONFLICT', 'TOTP enrollment is required');
    await transaction.mfaChallenge.updateMany({
      where: { account_id: input.accountId, purpose: 'LOGIN', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    return transaction.mfaChallenge.create({
      data: {
        id: input.challengeId,
        account_id: input.accountId,
        factor_id: factor.id,
        purpose: 'LOGIN',
        challenge_token_hash: input.challengeTokenHash,
        status: 'PENDING',
        failed_attempts: 0,
        expires_at: input.expiresAt,
        created_at: now,
      },
    });
  }

  async createEnrollmentInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      factorId: string;
      challengeId: string;
      challengeTokenHash: string;
      label: string;
      secretCiphertext: Uint8Array;
      secretFingerprint: string;
      encryptionKeyId: string;
      expiresAt: Date;
      expectedAccountVersion: number;
    },
  ) {
    const now = currentDate(this.now);
    requireUlid(input.factorId, 'Factor ID');
    requireUlid(input.challengeId, 'Challenge ID');
    requireHash(input.challengeTokenHash, 'Challenge token hash');
    requireHash(input.secretFingerprint, 'TOTP secret fingerprint');
    validateChallengeExpiry(input.expiresAt, now);
    if (input.label.length > 80 || input.label.trim() !== input.label ||
      !(input.secretCiphertext instanceof Uint8Array) || input.secretCiphertext.byteLength === 0 ||
      !KEY_ID.test(input.encryptionKeyId)) {
      throw new TypeError('TOTP enrollment material is invalid');
    }
    await this.requireAdminVersion(transaction, input.accountId, input.expectedAccountVersion);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'ENROLL', now);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'LOGIN', now);
    if (await transaction.totpFactor.count({ where: { account_id: input.accountId, status: 'ACTIVE' } }) !== 0) {
      throw new ApplicationError('STATE_CONFLICT', 'An active TOTP factor already exists');
    }
    const staleFactors = await transaction.totpFactor.findMany({
      where: { account_id: input.accountId, status: 'PENDING' },
      select: { id: true },
    });
    if (staleFactors.length > 0) {
      const staleIds = staleFactors.map(({ id }) => id);
      await transaction.mfaChallenge.updateMany({
        where: { factor_id: { in: staleIds }, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
      await transaction.totpFactor.updateMany({
        where: { id: { in: staleIds }, status: 'PENDING' },
        data: { status: 'REVOKED', revoked_at: now, updated_at: now },
      });
    }
    await transaction.totpFactor.create({
      data: {
        id: input.factorId,
        account_id: input.accountId,
        label: input.label,
        secret_ciphertext: Buffer.from(input.secretCiphertext),
        secret_fingerprint: input.secretFingerprint,
        encryption_key_id: input.encryptionKeyId,
        status: 'PENDING',
        created_at: now,
        updated_at: now,
      },
    });
    return transaction.mfaChallenge.create({
      data: {
        id: input.challengeId,
        account_id: input.accountId,
        factor_id: input.factorId,
        purpose: 'ENROLL',
        challenge_token_hash: input.challengeTokenHash,
        status: 'PENDING',
        failed_attempts: 0,
        expires_at: input.expiresAt,
        created_at: now,
      },
    });
  }

  async getChallengeVerificationContext(input: {
    accountId: string;
    challengeId: string;
    challengeTokenHashCandidates: SecretHashCandidates;
    purpose: 'ENROLL' | 'LOGIN';
  }): Promise<ChallengeVerificationContext | null> {
    requireUlid(input.accountId, 'Account ID');
    requireUlid(input.challengeId, 'Challenge ID');
    requireHashCandidates(input.challengeTokenHashCandidates, 'Challenge token hash candidates');
    const now = currentDate(this.now);
    const challenge = await this.prisma.mfaChallenge.findUnique({
      where: { id: input.challengeId },
      include: {
        account: { select: { role: true, status: true, deleted_at: true } },
        factor: true,
      },
    });
    if (!challenge || !challenge.factor || challenge.account_id !== input.accountId ||
      challenge.purpose !== input.purpose || challenge.status !== 'PENDING' ||
      challenge.expires_at.getTime() <= now.getTime() ||
      challenge.account.role !== 'SUPER_ADMIN' || challenge.account.status !== 'ACTIVE' ||
      challenge.account.deleted_at !== null ||
      challenge.factor.status !== (input.purpose === 'ENROLL' ? 'PENDING' : 'ACTIVE') ||
      challenge.factor.account_id !== input.accountId ||
      !matchesAnyHash(challenge.challenge_token_hash, input.challengeTokenHashCandidates)) {
      return null;
    }
    const rateLimit = await this.prisma.mfaRateLimit.findUnique({
      where: { account_id_purpose: { account_id: input.accountId, purpose: input.purpose } },
    });
    return {
      accountId: challenge.account_id,
      challengeId: challenge.id,
      challengeTokenHash: challenge.challenge_token_hash,
      expiresAt: challenge.expires_at,
      factor: {
        id: challenge.factor.id,
        secretCiphertext: Buffer.from(challenge.factor.secret_ciphertext),
        encryptionKeyId: challenge.factor.encryption_key_id,
        status: challenge.factor.status,
        lastUsedTimestep: challenge.factor.last_used_timestep,
      },
      lockedUntil: rateLimit?.locked_until ?? null,
      purpose: challenge.purpose,
    };
  }

  async recordAuthenticationFailureInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      purpose: 'ENROLL' | 'LOGIN' | 'RECOVERY';
      challengeId?: string;
      currentSessionId?: string;
      expectedAccountVersion?: number;
      factorId?: string;
    },
  ): Promise<AuthenticationFailureResult> {
    const now = currentDate(this.now);
    if (input.expectedAccountVersion === undefined) {
      await this.requireActiveAdmin(transaction, input.accountId);
    } else {
      await this.requireAdminVersion(transaction, input.accountId, input.expectedAccountVersion);
    }
    if ((input.currentSessionId === undefined) !== (input.factorId === undefined)) {
      throw new TypeError('Current session and factor IDs must be provided together');
    }
    if (input.purpose === 'RECOVERY' && input.currentSessionId === undefined) {
      throw new TypeError('Recovery-code failure tracking requires the current MFA session');
    }
    if (input.currentSessionId !== undefined && input.factorId !== undefined) {
      await this.requireCurrentMfaSession(transaction, {
        accountId: input.accountId,
        factorId: input.factorId,
        sessionId: input.currentSessionId,
      }, now);
    }
    const rateLimit = await this.lockRateLimit(transaction, input.accountId, input.purpose, now);
    if (rateLimit.locked_until && rateLimit.locked_until.getTime() > now.getTime()) {
      return { kind: 'locked', failedAttempts: rateLimit.failed_attempts, lockedUntil: rateLimit.locked_until };
    }
    let challenge: Awaited<ReturnType<DatabaseTransaction['mfaChallenge']['findUnique']>> | null = null;
    if (input.challengeId !== undefined) {
      requireUlid(input.challengeId, 'Challenge ID');
      await acquireTransactionLock(transaction, 'admin-auth-challenge', [input.challengeId]);
      challenge = await transaction.mfaChallenge.findUnique({ where: { id: input.challengeId } });
      if (!challenge || challenge.account_id !== input.accountId || challenge.purpose !== input.purpose ||
        challenge.status !== 'PENDING' || challenge.expires_at.getTime() <= now.getTime()) {
        return { kind: 'invalid' };
      }
    }
    const failedAttempts = rateLimit.failed_attempts + 1;
    const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS
      ? new Date(now.getTime() + MFA_LOCK_MS)
      : null;
    await transaction.mfaRateLimit.update({
      where: { id: rateLimit.id },
      data: {
        failed_attempts: failedAttempts,
        locked_until: lockedUntil,
        updated_at: now,
        version: { increment: 1 },
      },
    });
    if (challenge) {
      await transaction.mfaChallenge.update({
        where: { id: challenge.id },
        data: {
          failed_attempts: { increment: 1 },
          status: lockedUntil ? 'LOCKED' : 'PENDING',
          locked_until: lockedUntil,
        },
      });
    }
    if (lockedUntil) {
      await transaction.mfaChallenge.updateMany({
        where: { account_id: input.accountId, purpose: input.purpose, status: 'PENDING' },
        data: { status: 'LOCKED', locked_until: lockedUntil },
      });
      return { kind: 'locked', failedAttempts, lockedUntil };
    }
    return { kind: 'recorded', failedAttempts };
  }

  async completeEnrollmentInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      challengeId: string;
      challengeTokenHashCandidates: SecretHashCandidates;
      factorId: string;
      acceptedTimestep: bigint;
      recoveryCodes: readonly RecoveryCodeMaterial[];
      session: InitialAdminSessionMaterial;
      expectedAccountVersion: number;
    },
  ) {
    const now = currentDate(this.now);
    requireUlid(input.factorId, 'Factor ID');
    if (input.acceptedTimestep < 0n) throw new TypeError('Accepted TOTP timestep must be nonnegative');
    validateRecoveryCodes(input.recoveryCodes);
    await this.requireAdminVersion(transaction, input.accountId, input.expectedAccountVersion);
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [input.accountId]);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'ENROLL', now);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'LOGIN', now);
    const challenge = await this.requireChallenge(transaction, { ...input, purpose: 'ENROLL' }, now);
    if (challenge.factor_id !== input.factorId) throw new ApplicationError('STATE_CONFLICT', 'Factor mismatch');
    await acquireTransactionLock(transaction, 'admin-auth-factor', [input.factorId]);
    const factor = await transaction.totpFactor.findUnique({ where: { id: input.factorId } });
    if (!factor || factor.account_id !== input.accountId || factor.status !== 'PENDING' ||
      (factor.last_used_timestep !== null && factor.last_used_timestep >= input.acceptedTimestep)) {
      throw new ApplicationError('STATE_CONFLICT', 'TOTP factor cannot be activated');
    }
    await transaction.totpFactor.update({
      where: { id: factor.id },
      data: {
        status: 'ACTIVE',
        verified_at: now,
        last_used_timestep: input.acceptedTimestep,
        updated_at: now,
      },
    });
    await transaction.totpRecoveryCode.createMany({
      data: input.recoveryCodes.map(({ id, codeHash }) => ({
        id,
        factor_id: factor.id,
        code_hash: codeHash,
        created_at: now,
      })),
    });
    const session = await this.createInitialSession(transaction, input.accountId, factor.id, input.session, now);
    await transaction.mfaChallenge.update({
      where: { id: challenge.id },
      data: { status: 'CONSUMED', verified_at: now, consumed_at: now },
    });
    await this.resetRateLimit(transaction, input.accountId, 'ENROLL', now);
    await this.resetRateLimit(transaction, input.accountId, 'LOGIN', now);
    await transaction.account.update({
      where: { id: input.accountId },
      data: { last_login_at: now, updated_at: now },
    });
    return { factorId: factor.id, session };
  }

  async completeLoginTotpInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      challengeId: string;
      challengeTokenHashCandidates: SecretHashCandidates;
      acceptedTimestep: bigint;
      session: InitialAdminSessionMaterial;
      expectedAccountVersion: number;
    },
  ) {
    const now = currentDate(this.now);
    if (input.acceptedTimestep < 0n) throw new TypeError('Accepted TOTP timestep must be nonnegative');
    await this.requireAdminVersion(transaction, input.accountId, input.expectedAccountVersion);
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [input.accountId]);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'LOGIN', now);
    const challenge = await this.requireChallenge(transaction, { ...input, purpose: 'LOGIN' }, now);
    if (!challenge.factor_id) throw new ApplicationError('STATE_CONFLICT', 'LOGIN challenge has no factor');
    await acquireTransactionLock(transaction, 'admin-auth-factor', [challenge.factor_id]);
    const updated = await transaction.totpFactor.updateMany({
      where: {
        id: challenge.factor_id,
        account_id: input.accountId,
        status: 'ACTIVE',
        OR: [
          { last_used_timestep: null },
          { last_used_timestep: { lt: input.acceptedTimestep } },
        ],
      },
      data: { last_used_timestep: input.acceptedTimestep, updated_at: now },
    });
    if (updated.count !== 1) throw new ApplicationError('STATE_CONFLICT', 'TOTP timestep was already used');
    const session = await this.createInitialSession(
      transaction,
      input.accountId,
      challenge.factor_id,
      input.session,
      now,
    );
    await transaction.mfaChallenge.update({
      where: { id: challenge.id },
      data: { status: 'CONSUMED', verified_at: now, consumed_at: now },
    });
    await this.resetRateLimit(transaction, input.accountId, 'LOGIN', now);
    await transaction.account.update({
      where: { id: input.accountId },
      data: { last_login_at: now, updated_at: now },
    });
    return session;
  }

  async completeLoginRecoveryInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      challengeId: string;
      challengeTokenHashCandidates: SecretHashCandidates;
      recoveryCodeHashCandidates: SecretHashCandidates;
      session: InitialAdminSessionMaterial;
      expectedAccountVersion: number;
    },
  ): Promise<LoginRecoveryResult> {
    const now = currentDate(this.now);
    requireHashCandidates(input.recoveryCodeHashCandidates, 'Recovery code hash candidates');
    await this.requireAdminVersion(transaction, input.accountId, input.expectedAccountVersion);
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [input.accountId]);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'LOGIN', now);
    const challenge = await this.requireChallenge(transaction, { ...input, purpose: 'LOGIN' }, now);
    if (!challenge.factor_id) throw new ApplicationError('STATE_CONFLICT', 'LOGIN challenge has no factor');
    const matches = await transaction.totpRecoveryCode.findMany({
      where: { code_hash: { in: [...input.recoveryCodeHashCandidates] } },
      take: 2,
    });
    if (matches.length !== 1) {
      return this.recordAuthenticationFailureInTransaction(transaction, {
        accountId: input.accountId,
        challengeId: input.challengeId,
        expectedAccountVersion: input.expectedAccountVersion,
        purpose: 'LOGIN',
      });
    }
    const matchedCode = matches[0];
    if (!matchedCode) {
      return this.recordAuthenticationFailureInTransaction(transaction, {
        accountId: input.accountId,
        challengeId: input.challengeId,
        expectedAccountVersion: input.expectedAccountVersion,
        purpose: 'LOGIN',
      });
    }
    await acquireTransactionLock(transaction, 'admin-auth-recovery-code', [matchedCode.id]);
    const code = await transaction.totpRecoveryCode.findUnique({ where: { id: matchedCode.id } });
    if (!code || code.factor_id !== challenge.factor_id || code.consumed_at !== null) {
      return this.recordAuthenticationFailureInTransaction(transaction, {
        accountId: input.accountId,
        challengeId: input.challengeId,
        expectedAccountVersion: input.expectedAccountVersion,
        purpose: 'LOGIN',
      });
    }
    const factor = await transaction.totpFactor.findUnique({ where: { id: challenge.factor_id } });
    if (!factor || factor.account_id !== input.accountId || factor.status !== 'ACTIVE') {
      throw new ApplicationError('STATE_CONFLICT', 'TOTP factor is not active');
    }
    const consumed = await transaction.totpRecoveryCode.updateMany({
      where: { id: code.id, consumed_at: null },
      data: { consumed_at: now },
    });
    if (consumed.count !== 1) {
      return this.recordAuthenticationFailureInTransaction(transaction, {
        accountId: input.accountId,
        challengeId: input.challengeId,
        expectedAccountVersion: input.expectedAccountVersion,
        purpose: 'LOGIN',
      });
    }
    const session = await this.createInitialSession(transaction, input.accountId, factor.id, input.session, now);
    await transaction.mfaChallenge.update({
      where: { id: challenge.id },
      data: { status: 'CONSUMED', verified_at: now, consumed_at: now },
    });
    await this.resetRateLimit(transaction, input.accountId, 'LOGIN', now);
    await transaction.account.update({
      where: { id: input.accountId },
      data: { last_login_at: now, updated_at: now },
    });
    return { kind: 'authenticated', session };
  }

  async rotateRecoveryCodesInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      factorId: string;
      acceptedTimestep: bigint;
      currentSessionId: string;
      expectedAccountVersion: number;
      recoveryCodes: readonly RecoveryCodeMaterial[];
    },
  ): Promise<{ rotatedAt: Date }> {
    const now = currentDate(this.now);
    requireUlid(input.factorId, 'Factor ID');
    if (input.acceptedTimestep < 0n) throw new TypeError('Accepted TOTP timestep must be nonnegative');
    validateRecoveryCodes(input.recoveryCodes);
    await this.requireAdminVersion(transaction, input.accountId, input.expectedAccountVersion);
    await this.requireCurrentMfaSession(transaction, {
      accountId: input.accountId,
      factorId: input.factorId,
      sessionId: input.currentSessionId,
    }, now);
    await this.requireAvailableRateLimit(transaction, input.accountId, 'RECOVERY', now);
    await acquireTransactionLock(transaction, 'admin-auth-factor', [input.factorId]);
    const updated = await transaction.totpFactor.updateMany({
      where: {
        id: input.factorId,
        account_id: input.accountId,
        status: 'ACTIVE',
        OR: [
          { last_used_timestep: null },
          { last_used_timestep: { lt: input.acceptedTimestep } },
        ],
      },
      data: { last_used_timestep: input.acceptedTimestep, updated_at: now },
    });
    if (updated.count !== 1) throw new ApplicationError('STATE_CONFLICT', 'TOTP timestep was already used');
    await transaction.totpRecoveryCode.updateMany({
      where: { factor_id: input.factorId, consumed_at: null },
      data: { consumed_at: now },
    });
    await transaction.totpRecoveryCode.createMany({
      data: input.recoveryCodes.map(({ id, codeHash }) => ({
        id,
        factor_id: input.factorId,
        code_hash: codeHash,
        created_at: now,
      })),
    });
    await this.resetRateLimit(transaction, input.accountId, 'RECOVERY', now);
    return { rotatedAt: now };
  }

  async rotateRefreshInTransaction(
    transaction: DatabaseTransaction,
    input: { presentedRefreshTokenHashCandidates: SecretHashCandidates; session: AdminSessionMaterial },
  ): Promise<RefreshRotationResult> {
    requireHashCandidates(input.presentedRefreshTokenHashCandidates, 'Refresh token hash candidates');
    const now = currentDate(this.now);
    validateSessionMaterial(input.session, now);
    const initialMatches = await transaction.authSession.findMany({
      where: { refresh_token_hash: { in: [...input.presentedRefreshTokenHashCandidates] } },
      take: 2,
    });
    if (initialMatches.length !== 1) return { kind: 'invalid' };
    const initial = initialMatches[0];
    if (!initial) return { kind: 'invalid' };
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [initial.account_id]);
    await acquireTransactionLock(transaction, 'admin-auth-session-family', [initial.session_family]);
    const session = await transaction.authSession.findUnique({
      where: { id: initial.id },
      include: { account: true, mfa_factor: true },
    });
    if (!session || session.refresh_token_hash === null ||
      !matchesAnyHash(session.refresh_token_hash, input.presentedRefreshTokenHashCandidates)) {
      return { kind: 'invalid' };
    }
    if (session.revoked_at !== null) {
      await transaction.authSession.updateMany({
        where: { session_family: session.session_family, revoked_at: null },
        data: { revoked_at: now },
      });
      return { kind: 'replay_detected', sessionFamily: session.session_family };
    }
    if (session.expires_at.getTime() <= now.getTime() || session.account.role !== 'SUPER_ADMIN' ||
      session.account.status !== 'ACTIVE' || session.account.deleted_at !== null ||
      session.assurance !== 'MFA' || session.restriction !== 'NONE' || !session.mfa_factor ||
      session.mfa_factor.status !== 'ACTIVE' || session.mfa_factor.account_id !== session.account_id) {
      await transaction.authSession.updateMany({
        where: { session_family: session.session_family, revoked_at: null },
        data: { revoked_at: now },
      });
      return { kind: 'invalid' };
    }
    await transaction.authSession.update({
      where: { id: session.id },
      data: { revoked_at: now, last_seen_at: now },
    });
    const rotationCounter = session.rotation_counter + 1;
    await transaction.authSession.create({
      data: {
        id: input.session.id,
        account_id: session.account_id,
        access_jti: input.session.accessJti,
        refresh_token_hash: input.session.refreshTokenHash,
        assurance: 'MFA',
        restriction: 'NONE',
        mfa_factor_id: session.mfa_factor_id,
        mfa_verified_at: session.mfa_verified_at,
        session_family: session.session_family,
        rotation_counter: rotationCounter,
        expires_at: input.session.expiresAt,
        created_at: now,
      },
    });
    return {
      kind: 'rotated',
      sessionId: input.session.id,
      sessionFamily: session.session_family,
      rotationCounter,
    };
  }

  async revokeSessionInTransaction(
    transaction: DatabaseTransaction,
    input: { accountId: string; sessionFamily: string; sessionId: string },
  ): Promise<{ revoked: boolean }> {
    requireUlid(input.accountId, 'Account ID');
    requireUlid(input.sessionFamily, 'Session family');
    requireUlid(input.sessionId, 'Session ID');
    const now = currentDate(this.now);
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [input.accountId]);
    await acquireTransactionLock(transaction, 'admin-auth-session-family', [input.sessionFamily]);
    const session = await transaction.authSession.findUnique({ where: { id: input.sessionId } });
    if (!session || session.account_id !== input.accountId || session.session_family !== input.sessionFamily) {
      return { revoked: false };
    }
    const result = await transaction.authSession.updateMany({
      where: { account_id: input.accountId, session_family: input.sessionFamily, revoked_at: null },
      data: { revoked_at: now, last_seen_at: now },
    });
    return { revoked: result.count > 0 };
  }

  async revokeAllSessionsInTransaction(
    transaction: DatabaseTransaction,
    input: { accountId: string; expectedVersion: number },
  ): Promise<{ revokedCount: number; version: number }> {
    const { accountId, expectedVersion } = input;
    requireUlid(accountId, 'Account ID');
    const now = currentDate(this.now);
    await this.requireAdminVersion(transaction, accountId, expectedVersion);
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [accountId]);
    const result = await transaction.authSession.updateMany({
      where: { account_id: accountId, revoked_at: null },
      data: { revoked_at: now, last_seen_at: now },
    });
    const updated = await transaction.account.updateMany({
      where: { id: accountId, version: expectedVersion },
      data: { updated_at: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Account changed');
    return { revokedCount: result.count, version: expectedVersion + 1 };
  }

  async getCurrentSession(input: { sessionId: string; accessJti: string }): Promise<CurrentAdminSession | null> {
    requireUlid(input.sessionId, 'Session ID');
    if (!ACCESS_JTI.test(input.accessJti)) throw new TypeError('Access JTI is invalid');
    const now = currentDate(this.now);
    const session = await this.prisma.authSession.findUnique({
      where: { id: input.sessionId },
      include: { account: true, mfa_factor: true },
    });
    if (!session || session.access_jti !== input.accessJti || session.revoked_at !== null ||
      session.expires_at.getTime() <= now.getTime() || session.assurance !== 'MFA' ||
      session.restriction !== 'NONE' || session.mfa_verified_at === null || !session.mfa_factor ||
      session.mfa_factor.status !== 'ACTIVE' || session.mfa_factor.account_id !== session.account_id ||
      session.account.role !== 'SUPER_ADMIN' || session.account.status !== 'ACTIVE' ||
      session.account.deleted_at !== null) {
      return null;
    }
    return {
      accountId: session.account_id,
      accountVersion: session.account.version,
      accessJti: session.access_jti,
      expiresAt: session.expires_at,
      factorId: session.mfa_factor.id,
      factorSecretCiphertext: Buffer.from(session.mfa_factor.secret_ciphertext),
      factorEncryptionKeyId: session.mfa_factor.encryption_key_id,
      factorLastUsedTimestep: session.mfa_factor.last_used_timestep,
      mfaVerifiedAt: session.mfa_verified_at,
      sessionFamily: session.session_family,
      sessionId: session.id,
    };
  }

  async changePasswordInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      currentSessionId: string;
      expectedPasswordHash: string;
      newPasswordHash: string;
      expectedVersion: number;
    },
  ): Promise<{ version: number; revokedOtherSessions: number }> {
    requireUlid(input.accountId, 'Account ID');
    requireUlid(input.currentSessionId, 'Session ID');
    validatePasswordHash(input.expectedPasswordHash);
    validatePasswordHash(input.newPasswordHash);
    if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1) {
      throw new TypeError('Expected account version is invalid');
    }
    const now = currentDate(this.now);
    await acquireTransactionLock(transaction, 'admin-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'admin-auth-account-sessions', [input.accountId]);
    const currentSession = await transaction.authSession.findUnique({
      where: { id: input.currentSessionId },
      include: { account: true, mfa_factor: true },
    });
    if (!currentSession || currentSession.account_id !== input.accountId || currentSession.revoked_at !== null ||
      currentSession.expires_at.getTime() <= now.getTime() || currentSession.assurance !== 'MFA' ||
      currentSession.restriction !== 'NONE' || currentSession.mfa_verified_at === null ||
      !currentSession.mfa_factor || currentSession.mfa_factor.status !== 'ACTIVE' ||
      currentSession.mfa_factor.account_id !== input.accountId ||
      currentSession.account.role !== 'SUPER_ADMIN' || currentSession.account.status !== 'ACTIVE' ||
      currentSession.account.deleted_at !== null) {
      throw new ApplicationError('AUTH_REQUIRED', 'Current administrator session is invalid');
    }
    const updated = await transaction.account.updateMany({
      where: {
        id: input.accountId,
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        password_hash: input.expectedPasswordHash,
        version: input.expectedVersion,
      },
      data: {
        password_hash: input.newPasswordHash,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    if (updated.count !== 1) throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Account changed');
    const revoked = await transaction.authSession.updateMany({
      where: { account_id: input.accountId, id: { not: input.currentSessionId }, revoked_at: null },
      data: { revoked_at: now },
    });
    return { version: input.expectedVersion + 1, revokedOtherSessions: revoked.count };
  }
}
