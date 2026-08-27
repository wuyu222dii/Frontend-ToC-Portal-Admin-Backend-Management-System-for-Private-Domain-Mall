import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock, acquireTransactionLocks } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';

const CIPHERTEXT_MAX_BYTES = 8_192;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_INCREMENTABLE_VERSION = 2_147_483_646;
const MAX_STORED_VERSION = MAX_INCREMENTABLE_VERSION + 1;
const PHONE_LAST4_PATTERN = /^[0-9]{4}$/;

type AddressClient = Pick<DatabaseTransaction, 'account' | 'customerAddress'>;

export interface StoreAddressIdentityInput {
  accountId: string;
  customerId: string;
}

export interface StoreAddressReadInput extends StoreAddressIdentityInput {
  addressId: string;
}

interface StoreAddressWriteFields {
  city: string;
  detailCiphertext: Uint8Array;
  district: string;
  encryptionKeyId: string;
  isDefault: boolean;
  phoneCiphertext: Uint8Array;
  phoneHash: string;
  phoneLast4: string;
  province: string;
  recipientName: string;
}

export interface CreateStoreAddressInput extends StoreAddressReadInput, StoreAddressWriteFields {}

export interface UpdateStoreAddressInput extends CreateStoreAddressInput {
  expectedVersion: number;
}

export interface DeleteStoreAddressInput extends StoreAddressReadInput {
  expectedVersion: number;
}

export interface StoreAddressSnapshot extends StoreAddressWriteFields {
  addressId: string;
  createdAt: Date;
  customerId: string;
  deletedAt: Date | null;
  version: number;
}

export interface StoreAddressAuditState {
  isDefault: boolean;
  status: 'ACTIVE' | 'DELETED';
  version: number;
}

export interface StoreAddressStateChange {
  addressId: string;
  after: StoreAddressAuditState;
  before: StoreAddressAuditState | null;
}

export interface StoreAddressMutationResult {
  address: StoreAddressSnapshot;
  changes: StoreAddressStateChange[];
}

export interface StoreAddressDeleteResult {
  address: StoreAddressSnapshot;
  addressId: string;
  changes: StoreAddressStateChange[];
}

export type StoreAddressMutationReadOptions =
  | { includeDeleted: false }
  | { includeDeleted: true; purpose: 'DELETE_REPLAY' };

interface AddressRow {
  city: string;
  created_at: Date;
  customer_id: string;
  deleted_at: Date | null;
  detail_ciphertext: Uint8Array;
  district: string;
  encryption_key_id: string;
  id: string;
  is_default: boolean;
  phone_ciphertext: Uint8Array;
  phone_hash: string;
  phone_last4: string;
  province: string;
  recipient_name: string;
  version: number;
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

function hasControlCharacter(value: string): boolean {
  return /\p{Cc}/u.test(value);
}

function normalizeText(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string`);
  const normalized = value.trim();
  if (normalized.length < 1 || Array.from(normalized).length > maximumLength || hasControlCharacter(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return normalized;
}

function requireStoredText(value: unknown, label: string, maximumLength: number): string {
  const normalized = normalizeText(value, label, maximumLength);
  if (normalized !== value) throw new TypeError(`${label} is not normalized`);
  return normalized;
}

function requireCiphertext(value: unknown, label: string): Buffer {
  if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > CIPHERTEXT_MAX_BYTES) {
    throw new TypeError(`${label} is invalid`);
  }
  return Buffer.from(value);
}

function validateIdentity(input: StoreAddressIdentityInput): void {
  requirePlainObject(input, 'Store address identity');
  requireExactKeys(input, ['accountId', 'customerId'], ['accountId', 'customerId'], 'Store address identity');
  requireUlid(input.accountId, 'Store address Account ID');
  requireUlid(input.customerId, 'Store address Customer ID');
}

function validateReadInput(input: StoreAddressReadInput): void {
  requirePlainObject(input, 'Store address read input');
  requireExactKeys(
    input,
    ['accountId', 'addressId', 'customerId'],
    ['accountId', 'addressId', 'customerId'],
    'Store address read input',
  );
  requireUlid(input.accountId, 'Store address Account ID');
  requireUlid(input.customerId, 'Store address Customer ID');
  requireUlid(input.addressId, 'Store address ID');
}

function validateExpectedVersion(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > MAX_STORED_VERSION) {
    throw new TypeError('Expected Store address version is invalid');
  }
}

function validateWriteFields(input: StoreAddressWriteFields): StoreAddressWriteFields {
  if (typeof input.isDefault !== 'boolean') throw new TypeError('Store address default flag must be a boolean');
  if (typeof input.phoneHash !== 'string' || !HASH_PATTERN.test(input.phoneHash)) {
    throw new TypeError('Store address phone hash must be a lowercase HMAC-SHA-256 digest');
  }
  if (typeof input.phoneLast4 !== 'string' || !PHONE_LAST4_PATTERN.test(input.phoneLast4)) {
    throw new TypeError('Store address phone tail must contain four ASCII digits');
  }
  return {
    city: normalizeText(input.city, 'Store address city', 80),
    detailCiphertext: requireCiphertext(input.detailCiphertext, 'Store address detail ciphertext'),
    district: normalizeText(input.district, 'Store address district', 80),
    encryptionKeyId: normalizeText(input.encryptionKeyId, 'Store address encryption key ID', 80),
    isDefault: input.isDefault,
    phoneCiphertext: requireCiphertext(input.phoneCiphertext, 'Store address phone ciphertext'),
    phoneHash: input.phoneHash,
    phoneLast4: input.phoneLast4,
    province: normalizeText(input.province, 'Store address province', 80),
    recipientName: normalizeText(input.recipientName, 'Store address recipient', 80),
  };
}

const WRITE_KEYS = [
  'accountId',
  'addressId',
  'city',
  'customerId',
  'detailCiphertext',
  'district',
  'encryptionKeyId',
  'isDefault',
  'phoneCiphertext',
  'phoneHash',
  'phoneLast4',
  'province',
  'recipientName',
] as const;

function validateCreateInput(input: CreateStoreAddressInput): StoreAddressWriteFields {
  requirePlainObject(input, 'Store address create input');
  requireExactKeys(input, WRITE_KEYS, WRITE_KEYS, 'Store address create input');
  requireUlid(input.accountId, 'Store address Account ID');
  requireUlid(input.customerId, 'Store address Customer ID');
  requireUlid(input.addressId, 'Store address ID');
  return validateWriteFields(input);
}

function validateUpdateInput(input: UpdateStoreAddressInput): StoreAddressWriteFields {
  requirePlainObject(input, 'Store address update input');
  const keys = [...WRITE_KEYS, 'expectedVersion'];
  requireExactKeys(input, keys, keys, 'Store address update input');
  requireUlid(input.accountId, 'Store address Account ID');
  requireUlid(input.customerId, 'Store address Customer ID');
  requireUlid(input.addressId, 'Store address ID');
  validateExpectedVersion(input.expectedVersion);
  return validateWriteFields(input);
}

function validateDeleteInput(input: DeleteStoreAddressInput): void {
  requirePlainObject(input, 'Store address delete input');
  requireExactKeys(
    input,
    ['accountId', 'addressId', 'customerId', 'expectedVersion'],
    ['accountId', 'addressId', 'customerId', 'expectedVersion'],
    'Store address delete input',
  );
  requireUlid(input.accountId, 'Store address Account ID');
  requireUlid(input.customerId, 'Store address Customer ID');
  requireUlid(input.addressId, 'Store address ID');
  validateExpectedVersion(input.expectedVersion);
}

function validateMutationReadOptions(value: StoreAddressMutationReadOptions): void {
  requirePlainObject(value, 'Store address mutation read options');
  if (value.includeDeleted === false) {
    requireExactKeys(value, ['includeDeleted'], ['includeDeleted'], 'Store address mutation read options');
    return;
  }
  requireExactKeys(
    value,
    ['includeDeleted', 'purpose'],
    ['includeDeleted', 'purpose'],
    'Store address mutation read options',
  );
  if (value.includeDeleted !== true || value.purpose !== 'DELETE_REPLAY') {
    throw new TypeError('Deleted Store addresses are available only for DELETE replay');
  }
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

function addressNotFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'Store address not found');
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Store address version changed');
}

function defaultAddressRequired(): ApplicationError {
  return new ApplicationError('DEFAULT_ADDRESS_REQUIRED', 'Another active address requires a default address');
}

function validDate(value: unknown, label: string): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new ApplicationError('INTERNAL_ERROR', `${label} is invalid`);
  }
  return new Date(value);
}

function snapshot(row: AddressRow): StoreAddressSnapshot {
  try {
    requireUlid(row.id, 'Stored address ID');
    requireUlid(row.customer_id, 'Stored address Customer ID');
    if (!Number.isSafeInteger(row.version) || row.version < 1 || row.version > MAX_STORED_VERSION ||
      typeof row.is_default !== 'boolean' || typeof row.phone_hash !== 'string' ||
      !HASH_PATTERN.test(row.phone_hash) || typeof row.phone_last4 !== 'string' ||
      !PHONE_LAST4_PATTERN.test(row.phone_last4)) {
      throw new TypeError('Stored address metadata is invalid');
    }
    return {
      addressId: row.id,
      city: requireStoredText(row.city, 'Stored address city', 80),
      createdAt: validDate(row.created_at, 'Stored address creation time'),
      customerId: row.customer_id,
      deletedAt: row.deleted_at === null ? null : validDate(row.deleted_at, 'Stored address deletion time'),
      detailCiphertext: requireCiphertext(row.detail_ciphertext, 'Stored address detail ciphertext'),
      district: requireStoredText(row.district, 'Stored address district', 80),
      encryptionKeyId: requireStoredText(row.encryption_key_id, 'Stored address encryption key ID', 80),
      isDefault: row.is_default,
      phoneCiphertext: requireCiphertext(row.phone_ciphertext, 'Stored address phone ciphertext'),
      phoneHash: row.phone_hash,
      phoneLast4: row.phone_last4,
      province: requireStoredText(row.province, 'Stored address province', 80),
      recipientName: requireStoredText(row.recipient_name, 'Stored address recipient', 80),
      version: row.version,
    };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError('INTERNAL_ERROR', 'Stored address projection is invalid', [], { cause: error });
  }
}

function auditState(value: Pick<StoreAddressSnapshot, 'deletedAt' | 'isDefault' | 'version'>): StoreAddressAuditState {
  return {
    isDefault: value.isDefault,
    status: value.deletedAt === null ? 'ACTIVE' : 'DELETED',
    version: value.version,
  };
}

function assertDefaultAddressShape(addresses: readonly StoreAddressSnapshot[]): void {
  const defaultCount = addresses.filter(({ isDefault }) => isDefault).length;
  if (defaultCount > 1 || (addresses.length > 1 && defaultCount === 0)) {
    throw new ApplicationError('INTERNAL_ERROR', 'Customer default address set is invalid');
  }
}

function writeData(fields: StoreAddressWriteFields) {
  return {
    city: fields.city,
    detail_ciphertext: new Uint8Array(fields.detailCiphertext),
    district: fields.district,
    encryption_key_id: fields.encryptionKeyId,
    is_default: fields.isDefault,
    phone_ciphertext: new Uint8Array(fields.phoneCiphertext),
    phone_hash: fields.phoneHash,
    phone_last4: fields.phoneLast4,
    province: fields.province,
    recipient_name: fields.recipientName,
  };
}

export class StoreAddressRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Store address clock must return a valid Date');
    }
    return new Date(value);
  }

  private async assertActiveCustomer(client: AddressClient, identity: StoreAddressIdentityInput): Promise<void> {
    const account = await client.account.findUnique({
      where: { id: identity.accountId },
      select: {
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
        customer_profile: { select: { account_id: true, anonymized_at: true, id: true } },
      },
    });
    const customer = account?.customer_profile;
    if (!account || account.role !== 'CUSTOMER' || account.status !== 'ACTIVE' || account.deleted_at !== null ||
      account.login_name !== null || account.password_hash !== null || account.wechat_open_id === null ||
      !customer || customer.id !== identity.customerId || customer.account_id !== identity.accountId ||
      customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
  }

  private async acquireAddressSetLocks(
    transaction: DatabaseTransaction,
    identity: StoreAddressIdentityInput,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'store-auth-account', [identity.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [identity.customerId]);
    await acquireTransactionLock(transaction, 'store-address-set', [identity.customerId]);
    await this.assertActiveCustomer(transaction, identity);
  }

  private acquireAddressLocks(transaction: DatabaseTransaction, addressIds: readonly string[]): Promise<void> {
    return acquireTransactionLocks(transaction, [...new Set(addressIds)].sort().map((addressId) => ({
      namespace: 'store-address',
      parts: [addressId],
    })));
  }

  private async readOwnedAddress(
    client: AddressClient,
    input: StoreAddressReadInput,
    includeDeleted: boolean,
  ): Promise<StoreAddressSnapshot> {
    const row = await client.customerAddress.findFirst({
      where: {
        customer_id: input.customerId,
        id: input.addressId,
        ...(includeDeleted ? {} : { deleted_at: null }),
      },
    });
    if (!row) throw addressNotFound();
    return snapshot(row);
  }

  private async activeAddresses(client: AddressClient, customerId: string): Promise<StoreAddressSnapshot[]> {
    const rows = await client.customerAddress.findMany({
      where: { customer_id: customerId, deleted_at: null },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
    const addresses = rows.map(snapshot);
    assertDefaultAddressShape(addresses);
    return addresses;
  }

  private async clearDefaultAddress(
    transaction: DatabaseTransaction,
    current: StoreAddressSnapshot,
    now: Date,
  ): Promise<StoreAddressStateChange> {
    if (current.version > MAX_INCREMENTABLE_VERSION) {
      throw new ApplicationError('STATE_CONFLICT', 'Store address version cannot be incremented');
    }
    const changed = await transaction.customerAddress.updateMany({
      data: { is_default: false, updated_at: now, version: { increment: 1 } },
      where: {
        customer_id: current.customerId,
        deleted_at: null,
        id: current.addressId,
        is_default: true,
        version: current.version,
      },
    });
    if (changed.count !== 1) throw versionConflict();
    return {
      addressId: current.addressId,
      after: { isDefault: false, status: 'ACTIVE', version: current.version + 1 },
      before: auditState(current),
    };
  }

  async getAddresses(input: StoreAddressIdentityInput): Promise<StoreAddressSnapshot[]> {
    validateIdentity(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertActiveCustomer(transaction, input);
      const rows = await transaction.customerAddress.findMany({
        where: { customer_id: input.customerId, deleted_at: null },
        orderBy: [{ is_default: 'desc' }, { created_at: 'asc' }, { id: 'asc' }],
      });
      const addresses = rows.map(snapshot);
      assertDefaultAddressShape(addresses);
      return addresses;
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getAddress(input: StoreAddressReadInput): Promise<StoreAddressSnapshot> {
    validateReadInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertActiveCustomer(transaction, input);
      return this.readOwnedAddress(transaction, input, false);
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getAddressForMutationInTransaction(
    transaction: DatabaseTransaction,
    input: StoreAddressReadInput,
    options: StoreAddressMutationReadOptions,
  ): Promise<StoreAddressSnapshot> {
    validateReadInput(input);
    validateMutationReadOptions(options);
    await this.acquireAddressSetLocks(transaction, input);
    await this.acquireAddressLocks(transaction, [input.addressId]);
    return this.readOwnedAddress(transaction, input, options.includeDeleted);
  }

  async createAddressInTransaction(
    transaction: DatabaseTransaction,
    input: CreateStoreAddressInput,
  ): Promise<StoreAddressMutationResult> {
    const fields = validateCreateInput(input);
    await this.acquireAddressSetLocks(transaction, input);
    const addresses = await this.activeAddresses(transaction, input.customerId);
    const currentDefault = addresses.find(({ isDefault }) => isDefault);
    const isDefault = addresses.length === 0 || currentDefault === undefined || fields.isDefault;
    await this.acquireAddressLocks(transaction, [
      input.addressId,
      ...(isDefault && currentDefault ? [currentDefault.addressId] : []),
    ]);
    if (await transaction.customerAddress.findUnique({ where: { id: input.addressId }, select: { id: true } })) {
      throw new ApplicationError('STATE_CONFLICT', 'Store address ID already exists');
    }
    const now = this.currentTime();
    const changes: StoreAddressStateChange[] = [];
    if (isDefault && currentDefault) {
      changes.push(await this.clearDefaultAddress(transaction, currentDefault, now));
    }
    await transaction.customerAddress.create({
      data: {
        ...writeData({ ...fields, isDefault }),
        created_at: now,
        customer_id: input.customerId,
        deleted_at: null,
        id: input.addressId,
        updated_at: now,
        version: 1,
      },
    });
    const address = await this.readOwnedAddress(transaction, input, false);
    changes.push({ addressId: address.addressId, after: auditState(address), before: null });
    return { address, changes };
  }

  async updateAddressInTransaction(
    transaction: DatabaseTransaction,
    input: UpdateStoreAddressInput,
  ): Promise<StoreAddressMutationResult> {
    const fields = validateUpdateInput(input);
    await this.acquireAddressSetLocks(transaction, input);
    const addresses = await this.activeAddresses(transaction, input.customerId);
    const current = addresses.find(({ addressId }) => addressId === input.addressId);
    if (!current) throw addressNotFound();
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.version > MAX_INCREMENTABLE_VERSION) {
      throw new ApplicationError('STATE_CONFLICT', 'Store address version cannot be incremented');
    }
    const otherAddresses = addresses.filter(({ addressId }) => addressId !== input.addressId);
    if (current.isDefault && !fields.isDefault && otherAddresses.length > 0) throw defaultAddressRequired();
    const currentDefault = addresses.find(({ isDefault }) => isDefault);
    const defaultToClear = fields.isDefault && currentDefault?.addressId !== input.addressId
      ? currentDefault
      : undefined;
    await this.acquireAddressLocks(transaction, [
      input.addressId,
      ...(defaultToClear ? [defaultToClear.addressId] : []),
    ]);
    const now = this.currentTime();
    const changes: StoreAddressStateChange[] = [];
    if (defaultToClear) changes.push(await this.clearDefaultAddress(transaction, defaultToClear, now));
    const changed = await transaction.customerAddress.updateMany({
      data: {
        ...writeData(fields),
        updated_at: now,
        version: { increment: 1 },
      },
      where: {
        customer_id: input.customerId,
        deleted_at: null,
        id: input.addressId,
        version: input.expectedVersion,
      },
    });
    if (changed.count !== 1) throw versionConflict();
    const address = await this.readOwnedAddress(transaction, input, false);
    changes.push({ addressId: address.addressId, after: auditState(address), before: auditState(current) });
    return { address, changes };
  }

  async deleteAddressInTransaction(
    transaction: DatabaseTransaction,
    input: DeleteStoreAddressInput,
  ): Promise<StoreAddressDeleteResult> {
    validateDeleteInput(input);
    await this.acquireAddressSetLocks(transaction, input);
    const addresses = await this.activeAddresses(transaction, input.customerId);
    const current = addresses.find(({ addressId }) => addressId === input.addressId);
    if (!current) throw addressNotFound();
    if (current.version !== input.expectedVersion) throw versionConflict();
    if (current.version > MAX_INCREMENTABLE_VERSION) {
      throw new ApplicationError('STATE_CONFLICT', 'Store address version cannot be incremented');
    }
    const promotion = current.isDefault
      ? addresses.find(({ addressId }) => addressId !== current.addressId)
      : undefined;
    await this.acquireAddressLocks(transaction, [
      input.addressId,
      ...(promotion ? [promotion.addressId] : []),
    ]);
    const now = this.currentTime();
    const deleted = await transaction.customerAddress.updateMany({
      data: {
        deleted_at: now,
        is_default: false,
        updated_at: now,
        version: { increment: 1 },
      },
      where: {
        customer_id: input.customerId,
        deleted_at: null,
        id: input.addressId,
        version: input.expectedVersion,
      },
    });
    if (deleted.count !== 1) throw versionConflict();
    const changes: StoreAddressStateChange[] = [{
      addressId: current.addressId,
      after: { isDefault: false, status: 'DELETED', version: current.version + 1 },
      before: auditState(current),
    }];
    if (promotion) {
      if (promotion.version > MAX_INCREMENTABLE_VERSION) {
        throw new ApplicationError('STATE_CONFLICT', 'Store address version cannot be incremented');
      }
      const promoted = await transaction.customerAddress.updateMany({
        data: { is_default: true, updated_at: now, version: { increment: 1 } },
        where: {
          customer_id: input.customerId,
          deleted_at: null,
          id: promotion.addressId,
          is_default: false,
          version: promotion.version,
        },
      });
      if (promoted.count !== 1) throw versionConflict();
      changes.push({
        addressId: promotion.addressId,
        after: { isDefault: true, status: 'ACTIVE', version: promotion.version + 1 },
        before: auditState(promotion),
      });
    }
    const address: StoreAddressSnapshot = {
      ...current,
      deletedAt: now,
      isDefault: false,
      version: current.version + 1,
    };
    return { address, addressId: input.addressId, changes };
  }
}
