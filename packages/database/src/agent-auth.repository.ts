import { timingSafeEqual } from 'node:crypto';

import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { AuthSession, PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const HEX_64 = /^[a-f0-9]{64}$/;
const ACCESS_JTI = /^[A-Za-z0-9._:-]{16,80}$/;
const AGENT_LOGIN_NAME = /^[a-z0-9][a-z0-9._-]{2,79}$/;

export type AgentSessionRestriction = 'CHANGE_PASSWORD_ONLY' | 'NONE';
export type AgentProductAuthorizationMode = 'ALL_ACTIVE_PRODUCTS' | 'CUSTOM_WHITELIST';

interface AgentSessionMaterialBase {
  id: string;
  accessJti: string;
  expiresAt: Date;
}

export interface AgentSessionMaterial extends AgentSessionMaterialBase {
  refreshTokenHash: string;
}

export type InitialAgentSessionMaterial = AgentSessionMaterialBase & {
  sessionFamily: string;
} & (
  | { refreshTokenHash: string; restriction: 'NONE' }
  | { refreshTokenHash: null; restriction: 'CHANGE_PASSWORD_ONLY' }
);

export interface AgentLoginSubject {
  id: string;
  agentId: string;
  loginName: string;
  mustChangePassword: boolean;
  passwordHash: string;
  status: 'ACTIVE' | 'DISABLED';
  version: number;
}

export interface AgentLoginSessionResult {
  accountId: string;
  accountVersion: number;
  agentId: string;
  profileVersion: number;
  restriction: AgentSessionRestriction;
  session: AuthSession;
}

export interface CurrentAgentSession {
  accountId: string;
  accountVersion: number;
  accessJti: string;
  agentId: string;
  agentName: string;
  agentNo: string;
  agentStatus: 'ACTIVE' | 'DISABLED';
  expiresAt: Date;
  productAuthorizationMode: AgentProductAuthorizationMode;
  profileVersion: number;
  restriction: AgentSessionRestriction;
  rotationCounter: number;
  sessionFamily: string;
  sessionId: string;
}

export type AgentSecretHashCandidates = readonly string[];

export type AgentRefreshRotationResult =
  | { kind: 'rotated'; sessionId: string; sessionFamily: string; rotationCounter: number }
  | { kind: 'replay_detected'; sessionFamily: string }
  | { kind: 'invalid' };

export class InvalidAgentLoginNameError extends Error {
  constructor() {
    super('Agent login name is invalid');
    this.name = 'InvalidAgentLoginNameError';
  }
}

function currentDate(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Agent auth clock must return a valid Date');
  }
  return value;
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requirePositiveVersion(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${label} is invalid`);
}

function requireHash(value: string, label: string): void {
  if (!HEX_64.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
}

function requireHashCandidates(values: AgentSecretHashCandidates, label: string): void {
  if (!Array.isArray(values) || values.length < 1 || values.length > 4) {
    throw new TypeError(`${label} must contain between one and four digests`);
  }
  for (const value of values) requireHash(value, label);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must not contain duplicate digests`);
}

function matchesAnyHash(stored: string, candidates: AgentSecretHashCandidates): boolean {
  if (!HEX_64.test(stored)) return false;
  const expected = Buffer.from(stored, 'hex');
  let matched = false;
  for (const candidate of candidates) {
    matched = timingSafeEqual(expected, Buffer.from(candidate, 'hex')) || matched;
  }
  return matched;
}

function validateLoginName(value: string): void {
  if (!AGENT_LOGIN_NAME.test(value)) {
    throw new InvalidAgentLoginNameError();
  }
}

function validatePasswordHash(value: string): void {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (value.length < 20 || value.length > 255 || value.trim() !== value || hasControlCharacter) {
    throw new TypeError('Agent password hash is invalid');
  }
}

function validateSessionBase(material: AgentSessionMaterialBase, now: Date): void {
  requireUlid(material.id, 'Session ID');
  if (!ACCESS_JTI.test(material.accessJti)) throw new TypeError('Access JTI is invalid');
  if (!(material.expiresAt instanceof Date) || !Number.isFinite(material.expiresAt.getTime()) ||
    material.expiresAt.getTime() <= now.getTime()) {
    throw new TypeError('Session expiry must be in the future');
  }
}

function validateRegularSessionMaterial(material: AgentSessionMaterial, now: Date): void {
  validateSessionBase(material, now);
  requireHash(material.refreshTokenHash, 'Refresh token hash');
}

function validateInitialSessionMaterial(material: InitialAgentSessionMaterial, now: Date): void {
  validateSessionBase(material, now);
  requireUlid(material.sessionFamily, 'Session family');
  if (material.restriction === 'NONE') {
    requireHash(material.refreshTokenHash, 'Refresh token hash');
  } else if (material.refreshTokenHash !== null) {
    throw new TypeError('Restricted Agent sessions cannot contain a refresh token hash');
  }
}

function activeAgent(account: {
  deleted_at: Date | null;
  must_change_password: boolean;
  password_hash: string | null;
  role: string;
  status: string;
  agent_profile: {
    deleted_at: Date | null;
    status: string;
  } | null;
}): boolean {
  return account.role === 'AGENT_ADMIN' && account.status === 'ACTIVE' && account.deleted_at === null &&
    account.password_hash !== null && account.agent_profile !== null &&
    account.agent_profile.status === 'ACTIVE' && account.agent_profile.deleted_at === null;
}

function exactSessionRestriction(value: string): AgentSessionRestriction | null {
  return value === 'NONE' || value === 'CHANGE_PASSWORD_ONLY' ? value : null;
}

export class AgentAuthRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    currentDate(this.now);
  }

  async findLoginSubject(loginName: string): Promise<AgentLoginSubject | null> {
    validateLoginName(loginName);
    const account = await this.prisma.account.findUnique({
      where: { login_name: loginName },
      include: { agent_profile: true },
    });
    if (!account || account.role !== 'AGENT_ADMIN' || account.password_hash === null ||
      account.login_name === null || !account.agent_profile) {
      return null;
    }
    const isActive = activeAgent(account);
    return {
      id: account.id,
      agentId: account.agent_profile.id,
      loginName: account.login_name,
      mustChangePassword: account.must_change_password,
      passwordHash: account.password_hash,
      status: isActive ? 'ACTIVE' : 'DISABLED',
      version: account.version,
    };
  }

  async createLoginSessionInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      expectedMustChangePassword: boolean;
      expectedPasswordHash: string;
      expectedVersion: number;
      session: InitialAgentSessionMaterial;
    },
  ): Promise<AgentLoginSessionResult> {
    requireUlid(input.accountId, 'Account ID');
    requirePositiveVersion(input.expectedVersion, 'Expected account version');
    validatePasswordHash(input.expectedPasswordHash);
    const now = currentDate(this.now);
    validateInitialSessionMaterial(input.session, now);
    const expectedRestriction = input.expectedMustChangePassword ? 'CHANGE_PASSWORD_ONLY' : 'NONE';
    if (input.session.restriction !== expectedRestriction) {
      throw new TypeError('Agent session restriction does not match the login state');
    }

    await acquireTransactionLock(transaction, 'agent-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'agent-auth-account-sessions', [input.accountId]);
    const account = await transaction.account.findUnique({
      where: { id: input.accountId },
      include: { agent_profile: true },
    });
    if (!account || !activeAgent(account) || account.password_hash !== input.expectedPasswordHash ||
      account.version !== input.expectedVersion ||
      account.must_change_password !== input.expectedMustChangePassword) {
      throw new ApplicationError('AUTH_REQUIRED', 'Agent login state changed');
    }
    const profile = account.agent_profile;
    if (!profile) throw new ApplicationError('AUTH_REQUIRED', 'Agent profile is unavailable');

    const session = await transaction.authSession.create({
      data: {
        id: input.session.id,
        account_id: input.accountId,
        access_jti: input.session.accessJti,
        refresh_token_hash: input.session.refreshTokenHash,
        assurance: 'PASSWORD',
        restriction: input.session.restriction,
        mfa_factor_id: null,
        mfa_verified_at: null,
        session_family: input.session.sessionFamily,
        rotation_counter: 0,
        expires_at: input.session.expiresAt,
        created_at: now,
      },
    });
    await transaction.account.update({
      where: { id: input.accountId },
      data: { last_login_at: now, updated_at: now },
    });
    return {
      accountId: account.id,
      accountVersion: account.version,
      agentId: profile.id,
      profileVersion: profile.version,
      restriction: input.session.restriction,
      session,
    };
  }

  async findRefreshActor(
    presentedRefreshTokenHashCandidates: AgentSecretHashCandidates,
  ): Promise<string | null> {
    requireHashCandidates(presentedRefreshTokenHashCandidates, 'Refresh token hash candidates');
    const matches = await this.prisma.authSession.findMany({
      where: { refresh_token_hash: { in: [...presentedRefreshTokenHashCandidates] } },
      include: { account: true },
      take: 2,
    });
    if (matches.length !== 1) return null;
    const session = matches[0];
    if (!session || session.assurance !== 'PASSWORD' || session.restriction !== 'NONE' ||
      session.account.role !== 'AGENT_ADMIN') {
      return null;
    }
    return session.account_id;
  }

  async rotateRefreshInTransaction(
    transaction: DatabaseTransaction,
    input: {
      presentedRefreshTokenHashCandidates: AgentSecretHashCandidates;
      session: AgentSessionMaterial;
    },
  ): Promise<AgentRefreshRotationResult> {
    requireHashCandidates(input.presentedRefreshTokenHashCandidates, 'Refresh token hash candidates');
    const now = currentDate(this.now);
    validateRegularSessionMaterial(input.session, now);
    const matches = await transaction.authSession.findMany({
      where: { refresh_token_hash: { in: [...input.presentedRefreshTokenHashCandidates] } },
      include: { account: true },
      take: 2,
    });
    if (matches.length !== 1) return { kind: 'invalid' };
    const initial = matches[0];
    if (!initial || initial.assurance !== 'PASSWORD' || initial.restriction !== 'NONE' ||
      initial.account.role !== 'AGENT_ADMIN') {
      return { kind: 'invalid' };
    }

    await acquireTransactionLock(transaction, 'agent-auth-account-sessions', [initial.account_id]);
    await acquireTransactionLock(transaction, 'agent-auth-session-family', [initial.session_family]);
    const session = await transaction.authSession.findUnique({
      where: { id: initial.id },
      include: { account: { include: { agent_profile: true } } },
    });
    if (!session || session.refresh_token_hash === null ||
      !matchesAnyHash(session.refresh_token_hash, input.presentedRefreshTokenHashCandidates) ||
      session.assurance !== 'PASSWORD' || session.restriction !== 'NONE' ||
      session.account.role !== 'AGENT_ADMIN') {
      return { kind: 'invalid' };
    }
    if (session.revoked_at !== null) {
      await transaction.authSession.updateMany({
        where: {
          account_id: session.account_id,
          session_family: session.session_family,
          assurance: 'PASSWORD',
          revoked_at: null,
        },
        data: { revoked_at: now, last_seen_at: now },
      });
      return { kind: 'replay_detected', sessionFamily: session.session_family };
    }
    if (session.expires_at.getTime() <= now.getTime() || !activeAgent(session.account) ||
      session.account.must_change_password || session.mfa_factor_id !== null ||
      session.mfa_verified_at !== null) {
      await transaction.authSession.updateMany({
        where: {
          account_id: session.account_id,
          session_family: session.session_family,
          assurance: 'PASSWORD',
          revoked_at: null,
        },
        data: { revoked_at: now, last_seen_at: now },
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
        assurance: 'PASSWORD',
        restriction: 'NONE',
        mfa_factor_id: null,
        mfa_verified_at: null,
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

  async getCurrentSession(input: { sessionId: string; accessJti: string }): Promise<CurrentAgentSession | null> {
    requireUlid(input.sessionId, 'Session ID');
    if (!ACCESS_JTI.test(input.accessJti)) throw new TypeError('Access JTI is invalid');
    const now = currentDate(this.now);
    const session = await this.prisma.authSession.findUnique({
      where: { id: input.sessionId },
      include: { account: { include: { agent_profile: true } } },
    });
    const restriction = session ? exactSessionRestriction(session.restriction) : null;
    const profile = session?.account.agent_profile;
    if (!session || restriction === null || !profile || session.access_jti !== input.accessJti ||
      session.revoked_at !== null || session.expires_at.getTime() <= now.getTime() ||
      session.assurance !== 'PASSWORD' || session.mfa_factor_id !== null || session.mfa_verified_at !== null ||
      !activeAgent(session.account) ||
      (restriction === 'NONE' && (session.refresh_token_hash === null || session.account.must_change_password)) ||
      (restriction === 'CHANGE_PASSWORD_ONLY' &&
        (session.refresh_token_hash !== null || !session.account.must_change_password))) {
      return null;
    }
    return {
      accountId: session.account_id,
      accountVersion: session.account.version,
      accessJti: session.access_jti,
      agentId: profile.id,
      agentName: profile.name,
      agentNo: profile.agent_no,
      agentStatus: profile.status,
      expiresAt: session.expires_at,
      productAuthorizationMode: profile.product_authorization_mode,
      profileVersion: profile.version,
      restriction,
      rotationCounter: session.rotation_counter,
      sessionFamily: session.session_family,
      sessionId: session.id,
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
    await acquireTransactionLock(transaction, 'agent-auth-account-sessions', [input.accountId]);
    await acquireTransactionLock(transaction, 'agent-auth-session-family', [input.sessionFamily]);
    const session = await transaction.authSession.findUnique({
      where: { id: input.sessionId },
      include: { account: true },
    });
    if (!session || session.account_id !== input.accountId || session.session_family !== input.sessionFamily ||
      session.assurance !== 'PASSWORD' || session.account.role !== 'AGENT_ADMIN') {
      return { revoked: false };
    }
    const result = await transaction.authSession.updateMany({
      where: {
        account_id: input.accountId,
        session_family: input.sessionFamily,
        assurance: 'PASSWORD',
        revoked_at: null,
      },
      data: { revoked_at: now, last_seen_at: now },
    });
    return { revoked: result.count > 0 };
  }

  async revokeAllSessionsInTransaction(
    transaction: DatabaseTransaction,
    input: { accountId: string; expectedVersion: number },
  ): Promise<{ revokedCount: number; version: number }> {
    requireUlid(input.accountId, 'Account ID');
    requirePositiveVersion(input.expectedVersion, 'Expected account version');
    const now = currentDate(this.now);
    await acquireTransactionLock(transaction, 'agent-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'agent-auth-account-sessions', [input.accountId]);
    const account = await transaction.account.findUnique({
      where: { id: input.accountId },
      include: { agent_profile: true },
    });
    if (!account || !activeAgent(account) || account.version !== input.expectedVersion) {
      throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Agent account changed');
    }
    const revoked = await transaction.authSession.updateMany({
      where: { account_id: input.accountId, assurance: 'PASSWORD', revoked_at: null },
      data: { revoked_at: now, last_seen_at: now },
    });
    const updated = await transaction.account.updateMany({
      where: { id: input.accountId, role: 'AGENT_ADMIN', status: 'ACTIVE', version: input.expectedVersion },
      data: { updated_at: now, version: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Agent account changed');
    return { revokedCount: revoked.count, version: input.expectedVersion + 1 };
  }

  async changePasswordInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      currentSessionId: string;
      expectedPasswordHash: string;
      expectedVersion: number;
      newPasswordHash: string;
    },
  ): Promise<{ revokedOtherSessions: number; version: number }> {
    this.validatePasswordChangeInput(input);
    const now = currentDate(this.now);
    await acquireTransactionLock(transaction, 'agent-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'agent-auth-account-sessions', [input.accountId]);
    const session = await transaction.authSession.findUnique({
      where: { id: input.currentSessionId },
      include: { account: { include: { agent_profile: true } } },
    });
    if (!session || session.account_id !== input.accountId || session.revoked_at !== null ||
      session.expires_at.getTime() <= now.getTime() || session.assurance !== 'PASSWORD' ||
      session.restriction !== 'NONE' || session.refresh_token_hash === null ||
      session.mfa_factor_id !== null || session.mfa_verified_at !== null ||
      !activeAgent(session.account) || session.account.must_change_password ||
      session.account.password_hash !== input.expectedPasswordHash ||
      session.account.version !== input.expectedVersion) {
      throw new ApplicationError('AUTH_REQUIRED', 'Current Agent session is invalid');
    }
    const updated = await transaction.account.updateMany({
      where: {
        id: input.accountId,
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        password_hash: input.expectedPasswordHash,
        must_change_password: false,
        version: input.expectedVersion,
      },
      data: {
        password_hash: input.newPasswordHash,
        updated_at: now,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Agent account changed');
    const revoked = await transaction.authSession.updateMany({
      where: {
        account_id: input.accountId,
        assurance: 'PASSWORD',
        revoked_at: null,
      },
      data: { revoked_at: now, last_seen_at: now },
    });
    return { revokedOtherSessions: revoked.count, version: input.expectedVersion + 1 };
  }

  async changeTemporaryPasswordInTransaction(
    transaction: DatabaseTransaction,
    input: {
      accountId: string;
      currentSessionId: string;
      expectedPasswordHash: string;
      expectedVersion: number;
      newPasswordHash: string;
      session: InitialAgentSessionMaterial & { restriction: 'NONE'; refreshTokenHash: string };
    },
  ): Promise<{ session: AuthSession; version: number }> {
    this.validatePasswordChangeInput(input);
    const now = currentDate(this.now);
    validateInitialSessionMaterial(input.session, now);
    if (input.session.restriction !== 'NONE') {
      throw new TypeError('Temporary password change must create an unrestricted session');
    }
    await acquireTransactionLock(transaction, 'agent-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'agent-auth-account-sessions', [input.accountId]);
    const current = await transaction.authSession.findUnique({
      where: { id: input.currentSessionId },
      include: { account: { include: { agent_profile: true } } },
    });
    if (!current || current.account_id !== input.accountId || current.revoked_at !== null ||
      current.expires_at.getTime() <= now.getTime() || current.assurance !== 'PASSWORD' ||
      current.restriction !== 'CHANGE_PASSWORD_ONLY' || current.refresh_token_hash !== null ||
      current.mfa_factor_id !== null || current.mfa_verified_at !== null ||
      !activeAgent(current.account) || !current.account.must_change_password ||
      current.account.password_hash !== input.expectedPasswordHash ||
      current.account.version !== input.expectedVersion) {
      throw new ApplicationError('AUTH_REQUIRED', 'Temporary Agent session is invalid');
    }
    const updated = await transaction.account.updateMany({
      where: {
        id: input.accountId,
        role: 'AGENT_ADMIN',
        status: 'ACTIVE',
        password_hash: input.expectedPasswordHash,
        must_change_password: true,
        version: input.expectedVersion,
      },
      data: {
        must_change_password: false,
        password_hash: input.newPasswordHash,
        updated_at: now,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Agent account changed');
    await transaction.authSession.updateMany({
      where: { account_id: input.accountId, assurance: 'PASSWORD', revoked_at: null },
      data: { revoked_at: now, last_seen_at: now },
    });
    const session = await transaction.authSession.create({
      data: {
        id: input.session.id,
        account_id: input.accountId,
        access_jti: input.session.accessJti,
        refresh_token_hash: input.session.refreshTokenHash,
        assurance: 'PASSWORD',
        restriction: 'NONE',
        mfa_factor_id: null,
        mfa_verified_at: null,
        session_family: input.session.sessionFamily,
        rotation_counter: 0,
        expires_at: input.session.expiresAt,
        created_at: now,
      },
    });
    return { session, version: input.expectedVersion + 1 };
  }

  private validatePasswordChangeInput(input: {
    accountId: string;
    currentSessionId: string;
    expectedPasswordHash: string;
    expectedVersion: number;
    newPasswordHash: string;
  }): void {
    requireUlid(input.accountId, 'Account ID');
    requireUlid(input.currentSessionId, 'Session ID');
    requirePositiveVersion(input.expectedVersion, 'Expected account version');
    validatePasswordHash(input.expectedPasswordHash);
    validatePasswordHash(input.newPasswordHash);
  }
}
