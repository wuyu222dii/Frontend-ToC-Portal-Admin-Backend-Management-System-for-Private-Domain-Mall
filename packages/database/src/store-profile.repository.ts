import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const HEX_64 = /^[a-f0-9]{64}$/;
const PHONE_LAST4 = /^[0-9]{4}$/;
const MAX_POSTGRES_INCREMENTABLE_INTEGER = 2_147_483_646;
const MAX_PHONE_CIPHERTEXT_BYTES = 4_096;

type StorePhoneSource = 'MOCK' | 'WECHAT';
type StoreProfileClient = Pick<PrismaClient, 'account'>;

export interface StoreProfileIdentityInput {
  accountId: string;
  customerId: string;
}

export interface StoreProfilePatch {
  avatarUrl?: string | null;
  city?: string | null;
  nickname?: string | null;
}

export interface UpdateStoreProfileInput extends StoreProfileIdentityInput {
  expectedVersion: number;
  patch: StoreProfilePatch;
}

export interface StorePhoneVerificationMaterial {
  consentVersion: string;
  encryptionKeyId: string;
  id: string;
  phoneCiphertext: Uint8Array;
  phoneHash: string;
  phoneLast4: string;
  source: StorePhoneSource;
  verifiedAt: Date;
}

export interface ReplaceStorePhoneInput extends StoreProfileIdentityInput {
  consentId: string;
  expectedVersion: number;
  verification: StorePhoneVerificationMaterial;
}

export interface RevokeStorePhoneInput extends StoreProfileIdentityInput {
  expectedVersion: number;
}

export interface StoreProfilePhoneSnapshot {
  consentVersion: string;
  encryptionKeyId: string;
  id: string;
  phoneCiphertext: Uint8Array;
  phoneHash: string;
  phoneLast4: string;
  source: StorePhoneSource;
  verifiedAt: Date;
}

export interface StoreProfileSnapshot {
  accountId: string;
  avatarUrl: string | null;
  city: string | null;
  customerId: string;
  nickname: string | null;
  phone: StoreProfilePhoneSnapshot | null;
  version: number;
}

function currentDate(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError('Store profile clock must return a valid Date');
  }
  return value;
}

function requirePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requireExpectedVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_POSTGRES_INCREMENTABLE_INTEGER) {
    throw new TypeError('Expected profile version is invalid');
  }
}

function requireBoundedString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length < 1 ||
    Array.from(value).length > maximumLength || Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function normalizeProfileText(value: unknown, label: string, maximumLength: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string or null`);
  const normalized = value.trim();
  const characters = Array.from(normalized);
  if (characters.length < 1 || characters.length > maximumLength || characters.some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  })) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function normalizeAvatarUrl(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new TypeError('Avatar URL must be a string or null');
  const normalized = value.trim();
  const characters = Array.from(normalized);
  if (characters.length < 1 || characters.length > 500 || characters.some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  })) throw new TypeError('Avatar URL is invalid');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new TypeError('Avatar URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.hostname.length < 1 || parsed.username !== '' || parsed.password !== '') {
    throw new TypeError('Avatar URL must be an HTTPS URL without credentials');
  }
  return normalized;
}

function validateIdentityInput(input: StoreProfileIdentityInput): void {
  requirePlainObject(input, 'Store profile identity');
  requireExactKeys(input, ['accountId', 'customerId'], ['accountId', 'customerId'], 'Store profile identity');
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
}

function validateUpdateInput(input: UpdateStoreProfileInput): StoreProfilePatch {
  requirePlainObject(input, 'Store profile update');
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'expectedVersion', 'patch'],
    ['accountId', 'customerId', 'expectedVersion', 'patch'],
    'Store profile update',
  );
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
  requireExpectedVersion(input.expectedVersion);
  requirePlainObject(input.patch, 'Store profile patch');
  requireExactKeys(input.patch, ['avatarUrl', 'city', 'nickname'], [], 'Store profile patch');
  if (Object.keys(input.patch).length < 1) throw new TypeError('Store profile patch must not be empty');
  return {
    ...(Object.prototype.hasOwnProperty.call(input.patch, 'avatarUrl')
      ? { avatarUrl: normalizeAvatarUrl(input.patch.avatarUrl) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input.patch, 'city')
      ? { city: normalizeProfileText(input.patch.city, 'City', 120) }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(input.patch, 'nickname')
      ? { nickname: normalizeProfileText(input.patch.nickname, 'Nickname', 80) }
      : {}),
  };
}

function validateVerificationMaterial(
  value: StorePhoneVerificationMaterial,
  now: Date,
): StorePhoneVerificationMaterial {
  requirePlainObject(value, 'Phone verification material');
  requireExactKeys(
    value,
    [
      'consentVersion',
      'encryptionKeyId',
      'id',
      'phoneCiphertext',
      'phoneHash',
      'phoneLast4',
      'source',
      'verifiedAt',
    ],
    [
      'consentVersion',
      'encryptionKeyId',
      'id',
      'phoneCiphertext',
      'phoneHash',
      'phoneLast4',
      'source',
      'verifiedAt',
    ],
    'Phone verification material',
  );
  requireUlid(value.id, 'Phone verification ID');
  if (!(value.phoneCiphertext instanceof Uint8Array) || value.phoneCiphertext.byteLength < 1 ||
    value.phoneCiphertext.byteLength > MAX_PHONE_CIPHERTEXT_BYTES) {
    throw new TypeError('Phone ciphertext is invalid');
  }
  if (typeof value.phoneHash !== 'string' || !HEX_64.test(value.phoneHash)) {
    throw new TypeError('Phone hash must be a lowercase HMAC-SHA-256 digest');
  }
  if (typeof value.phoneLast4 !== 'string' || !PHONE_LAST4.test(value.phoneLast4)) {
    throw new TypeError('Phone tail must contain four digits');
  }
  const encryptionKeyId = requireBoundedString(value.encryptionKeyId, 'Encryption key ID', 80);
  const consentVersion = requireBoundedString(value.consentVersion, 'Consent document version', 80);
  if (value.source !== 'MOCK' && value.source !== 'WECHAT') throw new TypeError('Phone source is invalid');
  if (!(value.verifiedAt instanceof Date) || !Number.isFinite(value.verifiedAt.getTime()) ||
    value.verifiedAt.getTime() > now.getTime()) {
    throw new TypeError('Phone verification time is invalid');
  }
  return {
    ...value,
    consentVersion,
    encryptionKeyId,
    phoneCiphertext: Buffer.from(value.phoneCiphertext),
    verifiedAt: new Date(value.verifiedAt),
  };
}

function validateReplacePhoneInput(
  input: ReplaceStorePhoneInput,
  now: Date,
): StorePhoneVerificationMaterial {
  requirePlainObject(input, 'Store phone replacement');
  requireExactKeys(
    input,
    ['accountId', 'consentId', 'customerId', 'expectedVersion', 'verification'],
    ['accountId', 'consentId', 'customerId', 'expectedVersion', 'verification'],
    'Store phone replacement',
  );
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
  requireUlid(input.consentId, 'Consent ID');
  requireExpectedVersion(input.expectedVersion);
  if (input.consentId === input.verification?.id) {
    throw new TypeError('Consent ID and phone verification ID must be different');
  }
  return validateVerificationMaterial(input.verification, now);
}

function validateRevokePhoneInput(input: RevokeStorePhoneInput): void {
  requirePlainObject(input, 'Store phone revocation');
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'expectedVersion'],
    ['accountId', 'customerId', 'expectedVersion'],
    'Store phone revocation',
  );
  requireUlid(input.accountId, 'Account ID');
  requireUlid(input.customerId, 'Customer ID');
  requireExpectedVersion(input.expectedVersion);
}

function activeCustomerAccount(account: {
  deleted_at: Date | null;
  login_name: string | null;
  password_hash: string | null;
  role: string;
  status: string;
  wechat_open_id: string | null;
}): boolean {
  return account.role === 'CUSTOMER' && account.status === 'ACTIVE' && account.deleted_at === null &&
    account.login_name === null && account.password_hash === null && account.wechat_open_id !== null;
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Customer profile version changed');
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function storePhoneSource(value: string): StorePhoneSource {
  if (value !== 'MOCK' && value !== 'WECHAT') {
    throw new ApplicationError('INTERNAL_ERROR', 'Current phone verification source is invalid');
  }
  return value;
}

export class StoreProfileRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    currentDate(this.now);
  }

  private async acquireMutationLocks(
    transaction: DatabaseTransaction,
    identity: StoreProfileIdentityInput,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'store-auth-account', [identity.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [identity.customerId]);
    await acquireTransactionLock(transaction, 'store-profile-phone', [identity.customerId]);
  }

  private async readCurrentProfile(
    client: StoreProfileClient,
    identity: StoreProfileIdentityInput,
  ): Promise<StoreProfileSnapshot> {
    const account = await client.account.findUnique({
      where: { id: identity.accountId },
      select: {
        deleted_at: true,
        id: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
        customer_profile: {
          select: {
            account_id: true,
            anonymized_at: true,
            avatar_url: true,
            city: true,
            id: true,
            nickname: true,
            version: true,
            phone_verifications: {
              orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
              take: 2,
              where: { revoked_at: null },
              select: {
                consent_version: true,
                encryption_key_id: true,
                id: true,
                phone_ciphertext: true,
                phone_hash: true,
                phone_last4: true,
                source: true,
                verified_at: true,
              },
            },
          },
        },
      },
    });
    const profile = account?.customer_profile;
    if (!account || !activeCustomerAccount(account) || !profile || profile.id !== identity.customerId ||
      profile.account_id !== identity.accountId || profile.anonymized_at !== null) {
      throw authenticationRequired();
    }
    if (profile.phone_verifications.length > 1) {
      throw new ApplicationError('INTERNAL_ERROR', 'Customer has multiple current phone verifications');
    }
    const phone = profile.phone_verifications[0];
    const phoneSnapshot: StoreProfilePhoneSnapshot | null = phone ? {
      consentVersion: phone.consent_version,
      encryptionKeyId: phone.encryption_key_id,
      id: phone.id,
      phoneCiphertext: Buffer.from(phone.phone_ciphertext),
      phoneHash: phone.phone_hash,
      phoneLast4: phone.phone_last4,
      source: storePhoneSource(phone.source),
      verifiedAt: new Date(phone.verified_at),
    } : null;
    return {
      accountId: account.id,
      avatarUrl: profile.avatar_url,
      city: profile.city,
      customerId: profile.id,
      nickname: profile.nickname,
      phone: phoneSnapshot,
      version: profile.version,
    };
  }

  private async compareAndSwapProfile(
    transaction: DatabaseTransaction,
    identity: StoreProfileIdentityInput,
    expectedVersion: number,
    data: { avatar_url?: string | null; city?: string | null; nickname?: string | null },
    now: Date,
  ): Promise<void> {
    const updated = await transaction.customerProfile.updateMany({
      data: { ...data, updated_at: now, version: { increment: 1 } },
      where: {
        account_id: identity.accountId,
        anonymized_at: null,
        id: identity.customerId,
        version: expectedVersion,
      },
    });
    if (updated.count !== 1) throw versionConflict();
  }

  async getCurrentProfile(input: StoreProfileIdentityInput): Promise<StoreProfileSnapshot> {
    validateIdentityInput(input);
    return this.readCurrentProfile(this.prisma, input);
  }

  async updateCurrentProfileInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateStoreProfileInput,
  ): Promise<StoreProfileSnapshot> {
    const patch = validateUpdateInput(input);
    await this.acquireMutationLocks(transaction, input);
    const current = await this.readCurrentProfile(transaction, input);
    if (current.version !== input.expectedVersion) throw versionConflict();
    const now = currentDate(this.now);
    await this.compareAndSwapProfile(transaction, input, input.expectedVersion, {
      ...(Object.prototype.hasOwnProperty.call(patch, 'avatarUrl') ? { avatar_url: patch.avatarUrl } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'city') ? { city: patch.city } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, 'nickname') ? { nickname: patch.nickname } : {}),
    }, now);
    return this.readCurrentProfile(transaction, input);
  }

  async replaceCurrentPhoneInTransaction(
    transaction: DatabaseTransaction,
    input: ReplaceStorePhoneInput,
  ): Promise<StoreProfileSnapshot> {
    const now = currentDate(this.now);
    const verification = validateReplacePhoneInput(input, now);
    await this.acquireMutationLocks(transaction, input);
    const current = await this.readCurrentProfile(transaction, input);
    if (current.version !== input.expectedVersion) throw versionConflict();
    await this.compareAndSwapProfile(transaction, input, input.expectedVersion, {}, now);
    await transaction.customerPhoneVerification.updateMany({
      data: { revoked_at: now },
      where: { customer_id: input.customerId, revoked_at: null },
    });
    await transaction.customerPhoneVerification.create({
      data: {
        consent_version: verification.consentVersion,
        created_at: now,
        customer_id: input.customerId,
        encryption_key_id: verification.encryptionKeyId,
        id: verification.id,
        phone_ciphertext: new Uint8Array(verification.phoneCiphertext),
        phone_hash: verification.phoneHash,
        phone_last4: verification.phoneLast4,
        revoked_at: null,
        source: verification.source,
        verified_at: verification.verifiedAt,
      },
    });
    await transaction.consentRecord.create({
      data: {
        accepted: true,
        accepted_at: now,
        account_id: input.accountId,
        consent_type: 'PHONE_AUTHORIZATION',
        created_at: now,
        document_version: verification.consentVersion,
        id: input.consentId,
        source_terminal: 'MP_WEIXIN',
      },
    });
    return this.readCurrentProfile(transaction, input);
  }

  async revokeCurrentPhoneInTransaction(
    transaction: DatabaseTransaction,
    input: RevokeStorePhoneInput,
  ): Promise<StoreProfileSnapshot> {
    validateRevokePhoneInput(input);
    await this.acquireMutationLocks(transaction, input);
    const current = await this.readCurrentProfile(transaction, input);
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (!current.phone) throw new ApplicationError('STATE_CONFLICT', 'Customer has no current phone');
    const now = currentDate(this.now);
    await this.compareAndSwapProfile(transaction, input, input.expectedVersion, {}, now);
    const revoked = await transaction.customerPhoneVerification.updateMany({
      data: { revoked_at: now },
      where: { customer_id: input.customerId, id: current.phone.id, revoked_at: null },
    });
    if (revoked.count !== 1) throw new ApplicationError('STATE_CONFLICT', 'Current phone changed');
    return this.readCurrentProfile(transaction, input);
  }
}
