import { timingSafeEqual } from 'node:crypto';

import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { AuthSession, PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const HEX_64 = /^[a-f0-9]{64}$/;
const ACCESS_JTI = /^[A-Za-z0-9._:-]{16,80}$/;
const SOURCE_TERMINAL = /^[A-Za-z0-9._:-]{1,30}$/;

export interface StoreSessionMaterial {
  id: string;
  accessJti: string;
  refreshTokenHash: string;
  expiresAt: Date;
}

export interface InitialStoreSessionMaterial extends StoreSessionMaterial {
  sessionFamily: string;
}

export interface StoreLoginConsentMaterial {
  id: string;
  type: 'USER_AGREEMENT' | 'PRIVACY_POLICY';
  documentVersion: string;
}

export interface StoreWechatIdentityInput {
  accountId: string;
  customerId: string;
  openId: string;
  unionId?: string | null;
}

export interface CreateStoreLoginSessionInput {
  accountId: string;
  customerId: string;
  sourceTerminal: string;
  consents: readonly [StoreLoginConsentMaterial, StoreLoginConsentMaterial];
  session: InitialStoreSessionMaterial;
}

export interface ResolvedStoreCustomer {
  accountId: string;
  accountVersion: number;
  customerId: string;
  customerVersion: number;
  created: boolean;
}

export interface StoreLoginSessionResult {
  accountId: string;
  accountVersion: number;
  customerId: string;
  customerVersion: number;
  session: AuthSession;
}

export type StoreSecretHashCandidates = readonly string[];

export type StoreRefreshRotationResult =
  | { kind: 'rotated'; sessionId: string; sessionFamily: string; rotationCounter: number }
  | { kind: 'replay_detected'; sessionFamily: string }
  | { kind: 'invalid' };

export interface CurrentStoreSession {
  accountId: string;
  accountVersion: number;
  accessJti: string;
  customerId: string;
  customerVersion: number;
  expiresAt: Date;
  sessionFamily: string;
  sessionId: string;
}

function currentDate(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Store auth clock must return a valid Date');
  }
  return value;
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireHash(value: string, label: string): void {
  if (!HEX_64.test(value)) throw new TypeError(`${label} must be a lowercase SHA-256 digest`);
}

function requireHashCandidates(values: StoreSecretHashCandidates, label: string): void {
  if (!Array.isArray(values) || values.length < 1 || values.length > 4) {
    throw new TypeError(`${label} must contain between one and four digests`);
  }
  for (const value of values) requireHash(value, label);
  if (new Set(values).size !== values.length) throw new TypeError(`${label} must not contain duplicate digests`);
}

function matchesAnyHash(stored: string, candidates: StoreSecretHashCandidates): boolean {
  if (!HEX_64.test(stored)) return false;
  const expected = Buffer.from(stored, 'hex');
  let matched = false;
  for (const candidate of candidates) {
    matched = timingSafeEqual(expected, Buffer.from(candidate, 'hex')) || matched;
  }
  return matched;
}

function requireOpaqueIdentity(value: string, label: string): void {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (value.length < 1 || value.length > 128 || hasControlCharacter) {
    throw new TypeError(`${label} must contain between 1 and 128 non-control characters`);
  }
}

function requireDocumentVersion(value: string): void {
  const hasControlCharacter = Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
  if (value.length < 1 || value.length > 80 || value.trim() !== value || hasControlCharacter) {
    throw new TypeError('Consent document version is invalid');
  }
}

function validateSessionMaterial(material: StoreSessionMaterial, now: Date): void {
  requireUlid(material.id, 'Session ID');
  if (!ACCESS_JTI.test(material.accessJti)) throw new TypeError('Access JTI is invalid');
  requireHash(material.refreshTokenHash, 'Refresh token hash');
  if (!(material.expiresAt instanceof Date) || !Number.isFinite(material.expiresAt.getTime()) ||
    material.expiresAt.getTime() <= now.getTime()) {
    throw new TypeError('Session expiry must be in the future');
  }
}

function validateInitialSessionMaterial(material: InitialStoreSessionMaterial, now: Date): void {
  validateSessionMaterial(material, now);
  requireUlid(material.sessionFamily, 'Session family');
}

function validateWechatIdentityInput(input: StoreWechatIdentityInput): void {
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
  requireOpaqueIdentity(input.openId, 'WeChat open ID');
  if (input.unionId !== undefined && input.unionId !== null) {
    requireOpaqueIdentity(input.unionId, 'WeChat union ID');
  }
}

function validateCreateLoginSessionInput(input: CreateStoreLoginSessionInput, now: Date): void {
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
  if (!SOURCE_TERMINAL.test(input.sourceTerminal)) throw new TypeError('Consent source terminal is invalid');
  if (!Array.isArray(input.consents) || input.consents.length !== 2 ||
    input.consents[0]?.type !== 'USER_AGREEMENT' || input.consents[1]?.type !== 'PRIVACY_POLICY') {
    throw new TypeError('Store login requires the ordered user-agreement and privacy-policy consent tuple');
  }
  for (const consent of input.consents) {
    requireUlid(consent.id, 'Consent ID');
    requireDocumentVersion(consent.documentVersion);
  }
  if (input.consents[0].id === input.consents[1].id) throw new TypeError('Consent IDs must be unique');
  validateInitialSessionMaterial(input.session, now);
}

function activeCustomerAccount(account: {
  role: string;
  status: string;
  deleted_at: Date | null;
  login_name: string | null;
  password_hash: string | null;
}): boolean {
  return account.role === 'CUSTOMER' && account.status === 'ACTIVE' && account.deleted_at === null &&
    account.login_name === null && account.password_hash === null;
}

export class StoreAuthRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    currentDate(this.now);
  }

  async resolveCustomerInTransaction(
    transaction: DatabaseTransaction,
    input: StoreWechatIdentityInput,
  ): Promise<ResolvedStoreCustomer> {
    const now = currentDate(this.now);
    validateWechatIdentityInput(input);
    await acquireTransactionLock(transaction, 'store-auth-identity', [input.openId]);

    const initial = await transaction.account.findUnique({
      where: { wechat_open_id: input.openId },
      select: { id: true },
    });
    const accountId = initial?.id ?? input.accountId;
    await acquireTransactionLock(transaction, 'store-auth-account', [accountId]);

    let account = await transaction.account.findUnique({
      where: { wechat_open_id: input.openId },
      include: { customer_profile: true },
    });
    let created = false;
    let customer;
    if (!account) {
      account = await transaction.account.create({
        data: {
          id: input.accountId,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          login_name: null,
          password_hash: null,
          wechat_open_id: input.openId,
          wechat_union_id: input.unionId ?? null,
          must_change_password: false,
          version: 1,
          created_at: now,
          updated_at: now,
        },
        include: { customer_profile: true },
      });
      customer = await transaction.customerProfile.create({
        data: {
          id: input.customerId,
          account_id: account.id,
          registered_at: now,
          version: 1,
          created_at: now,
          updated_at: now,
        },
      });
      created = true;
    } else {
      if (!activeCustomerAccount(account) || account.wechat_open_id !== input.openId) {
        throw new ApplicationError('AUTH_REQUIRED', 'Active customer account is required');
      }
      customer = account.customer_profile;
      if (!customer || customer.anonymized_at !== null) {
        throw new ApplicationError('INTERNAL_ERROR', 'Customer identity profile is inconsistent');
      }
    }

    await acquireTransactionLock(transaction, 'store-auth-customer', [customer.id]);
    if (account.wechat_union_id === null && input.unionId) {
      account = await transaction.account.update({
        where: { id: account.id },
        data: { wechat_union_id: input.unionId, updated_at: now },
        include: { customer_profile: true },
      });
    }
    return {
      accountId: account.id,
      accountVersion: account.version,
      customerId: customer.id,
      customerVersion: customer.version,
      created,
    };
  }

  async createLoginSessionInTransaction(
    transaction: DatabaseTransaction,
    input: CreateStoreLoginSessionInput,
  ): Promise<StoreLoginSessionResult> {
    const now = currentDate(this.now);
    validateCreateLoginSessionInput(input, now);
    await acquireTransactionLock(transaction, 'store-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [input.customerId]);
    const account = await transaction.account.findUnique({
      where: { id: input.accountId },
      include: { customer_profile: true },
    });
    const customer = account?.customer_profile;
    if (!account || !activeCustomerAccount(account) || account.wechat_open_id === null) {
      throw new ApplicationError('AUTH_REQUIRED', 'Active customer account is required');
    }
    if (!customer || customer.id !== input.customerId || customer.anonymized_at !== null) {
      throw new ApplicationError('INTERNAL_ERROR', 'Customer identity profile is inconsistent');
    }
    await transaction.consentRecord.createMany({
      data: input.consents.map((consent) => ({
        id: consent.id,
        account_id: input.accountId,
        consent_type: consent.type,
        document_version: consent.documentVersion,
        accepted: true,
        accepted_at: now,
        source_terminal: input.sourceTerminal,
        created_at: now,
      })),
    });
    await acquireTransactionLock(transaction, 'store-auth-account-sessions', [input.accountId]);
    const session = await transaction.authSession.create({
      data: {
        id: input.session.id,
        account_id: input.accountId,
        access_jti: input.session.accessJti,
        refresh_token_hash: input.session.refreshTokenHash,
        assurance: 'WECHAT',
        restriction: 'NONE',
        mfa_factor_id: null,
        mfa_verified_at: null,
        session_family: input.session.sessionFamily,
        rotation_counter: 0,
        expires_at: input.session.expiresAt,
        created_at: now,
      },
    });
    const updatedAccount = await transaction.account.update({
      where: { id: input.accountId },
      data: {
        last_login_at: now,
        updated_at: now,
      },
      include: { customer_profile: true },
    });

    return {
      accountId: updatedAccount.id,
      accountVersion: updatedAccount.version,
      customerId: customer.id,
      customerVersion: customer.version,
      session,
    };
  }

  async findRefreshActor(
    presentedRefreshTokenHashCandidates: StoreSecretHashCandidates,
  ): Promise<string | null> {
    requireHashCandidates(presentedRefreshTokenHashCandidates, 'Refresh token hash candidates');
    const matches = await this.prisma.authSession.findMany({
      where: { refresh_token_hash: { in: [...presentedRefreshTokenHashCandidates] } },
      include: { account: true },
      take: 2,
    });
    if (matches.length !== 1) return null;
    const session = matches[0];
    if (!session || session.assurance !== 'WECHAT' || session.account.role !== 'CUSTOMER') return null;
    return session.account_id;
  }

  async rotateRefreshInTransaction(
    transaction: DatabaseTransaction,
    input: {
      presentedRefreshTokenHashCandidates: StoreSecretHashCandidates;
      session: StoreSessionMaterial;
    },
  ): Promise<StoreRefreshRotationResult> {
    requireHashCandidates(input.presentedRefreshTokenHashCandidates, 'Refresh token hash candidates');
    const now = currentDate(this.now);
    validateSessionMaterial(input.session, now);
    const matches = await transaction.authSession.findMany({
      where: { refresh_token_hash: { in: [...input.presentedRefreshTokenHashCandidates] } },
      include: { account: { include: { customer_profile: true } } },
      take: 2,
    });
    if (matches.length !== 1) return { kind: 'invalid' };
    const initial = matches[0];
    if (!initial || initial.assurance !== 'WECHAT' || initial.account.role !== 'CUSTOMER') {
      return { kind: 'invalid' };
    }

    await acquireTransactionLock(transaction, 'store-auth-account-sessions', [initial.account_id]);
    await acquireTransactionLock(transaction, 'store-auth-session-family', [initial.session_family]);
    const session = await transaction.authSession.findUnique({
      where: { id: initial.id },
      include: { account: { include: { customer_profile: true } } },
    });
    if (!session || session.refresh_token_hash === null ||
      !matchesAnyHash(session.refresh_token_hash, input.presentedRefreshTokenHashCandidates) ||
      session.assurance !== 'WECHAT' || session.account.role !== 'CUSTOMER') {
      return { kind: 'invalid' };
    }
    if (session.revoked_at !== null) {
      await transaction.authSession.updateMany({
        where: {
          account_id: session.account_id,
          session_family: session.session_family,
          assurance: 'WECHAT',
          revoked_at: null,
        },
        data: { revoked_at: now, last_seen_at: now },
      });
      return { kind: 'replay_detected', sessionFamily: session.session_family };
    }

    const customer = session.account.customer_profile;
    if (session.expires_at.getTime() <= now.getTime() || session.restriction !== 'NONE' ||
      session.mfa_factor_id !== null || session.mfa_verified_at !== null ||
      session.account.status !== 'ACTIVE' || session.account.deleted_at !== null ||
      session.account.wechat_open_id === null || !customer || customer.anonymized_at !== null) {
      await transaction.authSession.updateMany({
        where: {
          account_id: session.account_id,
          session_family: session.session_family,
          assurance: 'WECHAT',
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
        assurance: 'WECHAT',
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

  async getCurrentSession(input: { sessionId: string; accessJti: string }): Promise<CurrentStoreSession | null> {
    requireUlid(input.sessionId, 'Session ID');
    if (!ACCESS_JTI.test(input.accessJti)) throw new TypeError('Access JTI is invalid');
    const now = currentDate(this.now);
    const session = await this.prisma.authSession.findUnique({
      where: { id: input.sessionId },
      include: { account: { include: { customer_profile: true } } },
    });
    const customer = session?.account.customer_profile;
    if (!session || session.access_jti !== input.accessJti || session.revoked_at !== null ||
      session.expires_at.getTime() <= now.getTime() || session.assurance !== 'WECHAT' ||
      session.restriction !== 'NONE' || session.mfa_factor_id !== null || session.mfa_verified_at !== null ||
      session.account.role !== 'CUSTOMER' || session.account.status !== 'ACTIVE' ||
      session.account.deleted_at !== null || session.account.wechat_open_id === null ||
      !customer || customer.anonymized_at !== null) {
      return null;
    }
    return {
      accountId: session.account_id,
      accountVersion: session.account.version,
      accessJti: session.access_jti,
      customerId: customer.id,
      customerVersion: customer.version,
      expiresAt: session.expires_at,
      sessionFamily: session.session_family,
      sessionId: session.id,
    };
  }

  async revokeCurrentSessionInTransaction(
    transaction: DatabaseTransaction,
    input: { accountId: string; sessionFamily: string; sessionId: string },
  ): Promise<{ revoked: boolean }> {
    requireUlid(input.accountId, 'Account ID');
    requireUlid(input.sessionFamily, 'Session family');
    requireUlid(input.sessionId, 'Session ID');
    const now = currentDate(this.now);
    await acquireTransactionLock(transaction, 'store-auth-account-sessions', [input.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-session-family', [input.sessionFamily]);
    const session = await transaction.authSession.findUnique({
      where: { id: input.sessionId },
      include: { account: true },
    });
    if (!session || session.account_id !== input.accountId || session.session_family !== input.sessionFamily ||
      session.assurance !== 'WECHAT' || session.account.role !== 'CUSTOMER') {
      return { revoked: false };
    }
    const result = await transaction.authSession.updateMany({
      where: {
        account_id: input.accountId,
        session_family: input.sessionFamily,
        assurance: 'WECHAT',
        revoked_at: null,
      },
      data: { revoked_at: now, last_seen_at: now },
    });
    return { revoked: result.count > 0 };
  }
}
