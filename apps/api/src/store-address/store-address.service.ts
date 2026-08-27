import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  runSerializableTransaction,
  StoreAddressRepository,
  type StoreAddressAuditState,
  type StoreAddressSnapshot,
  type StoreAddressStateChange,
} from '@qingxu/database';
import {
  ApplicationError,
  createStoreAddressSecurityMaterial,
  generateUlid,
  isApplicationError,
  isValidUlid,
  maskStoreAddressRecipient,
  verifyStoreAddressSecurityMaterial,
} from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import type { StoreAddressWriteRequest } from './store-address.dto';

const ADDRESS_COLLECTION_ROUTE = '/store/addresses';
const ADDRESS_RESOURCE_ROUTE = '/store/addresses/{address_id}';

function unsafeReplay(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'The Store address command cannot be replayed safely');
}

@Injectable()
export class StoreAddressService {
  private readonly addresses!: StoreAddressRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
  ) {
    if (config && database) {
      this.addresses = new StoreAddressRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
    }
  }

  async listAddresses(session: CurrentStoreSession) {
    const addresses = await this.repository().getAddresses(this.identity(session));
    return addresses.map((address) => this.summaryView(address));
  }

  async getAddress(session: CurrentStoreSession, addressId: string) {
    const address = await this.repository().getAddress({ ...this.identity(session), addressId });
    return this.detailView(address);
  }

  createAddress(
    session: CurrentStoreSession,
    input: StoreAddressWriteRequest,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, {
      body: this.wireBody(input),
      method: 'POST',
      pathParameters: {},
      route: ADDRESS_COLLECTION_ROUTE,
    });
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.response_status !== 200) throw unsafeReplay();
        const address = await this.replayActiveAddress(transaction, session, claimed.record.resource_id);
        return this.detailView(address);
      }

      const addressId = generateUlid();
      const security = this.securityMaterial(addressId, input);
      const result = await this.repository().createAddressInTransaction(transaction, {
        ...this.identity(session),
        ...security,
        addressId,
        city: input.city,
        district: input.district,
        isDefault: input.isDefault,
        province: input.province,
        recipientName: input.recipientName,
      });
      await this.appendAudits(transaction, session, result.changes, requestId, key, ipAddress);
      await this.complete(transaction, claim, result.address);
      return this.detailView(result.address);
    });
  }

  updateAddress(
    session: CurrentStoreSession,
    addressId: string,
    input: StoreAddressWriteRequest,
    expectedVersion: number,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, {
      body: { ...this.wireBody(input), expected_version: expectedVersion },
      method: 'PATCH',
      pathParameters: { address_id: addressId },
      route: ADDRESS_RESOURCE_ROUTE,
    });
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.response_status !== 200 || claimed.record.resource_id !== addressId) {
          throw unsafeReplay();
        }
        const address = await this.replayActiveAddress(transaction, session, addressId);
        return this.detailView(address);
      }

      const security = this.securityMaterial(addressId, input);
      const result = await this.repository().updateAddressInTransaction(transaction, {
        ...this.identity(session),
        ...security,
        addressId,
        city: input.city,
        district: input.district,
        expectedVersion,
        isDefault: input.isDefault,
        province: input.province,
        recipientName: input.recipientName,
      });
      await this.appendAudits(transaction, session, result.changes, requestId, key, ipAddress);
      await this.complete(transaction, claim, result.address);
      return this.detailView(result.address);
    });
  }

  deleteAddress(
    session: CurrentStoreSession,
    addressId: string,
    expectedVersion: number,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, {
      body: { expected_version: expectedVersion },
      method: 'DELETE',
      pathParameters: { address_id: addressId },
      route: ADDRESS_RESOURCE_ROUTE,
    });
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        if (claimed.record.response_status !== 200 || claimed.record.resource_id !== addressId) {
          throw unsafeReplay();
        }
        const tombstone = await this.replayDeletedAddress(transaction, session, addressId);
        return this.deleteView(tombstone);
      }

      const result = await this.repository().deleteAddressInTransaction(transaction, {
        ...this.identity(session),
        addressId,
        expectedVersion,
      });
      await this.appendAudits(transaction, session, result.changes, requestId, key, ipAddress);
      if (result.address.deletedAt === null || result.address.isDefault) {
        throw new ApplicationError('INTERNAL_ERROR', 'Deleted address tombstone is invalid');
      }
      await this.complete(transaction, claim, result.address);
      return this.deleteView(result.address);
    });
  }

  private async replayActiveAddress(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    resourceId: string | null,
  ): Promise<StoreAddressSnapshot> {
    if (!isValidUlid(resourceId)) throw unsafeReplay();
    try {
      return await this.repository().getAddressForMutationInTransaction(
        transaction,
        { ...this.identity(session), addressId: resourceId },
        { includeDeleted: false },
      );
    } catch (error) {
      if (isApplicationError(error) && error.code === 'RESOURCE_NOT_FOUND') throw unsafeReplay();
      throw error;
    }
  }

  private async replayDeletedAddress(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    addressId: string,
  ): Promise<StoreAddressSnapshot> {
    try {
      const address = await this.repository().getAddressForMutationInTransaction(
        transaction,
        { ...this.identity(session), addressId },
        { includeDeleted: true, purpose: 'DELETE_REPLAY' },
      );
      if (address.deletedAt === null) throw unsafeReplay();
      if (address.isDefault) throw new ApplicationError('INTERNAL_ERROR', 'Deleted address tombstone is invalid');
      return address;
    } catch (error) {
      if (isApplicationError(error) && error.code === 'RESOURCE_NOT_FOUND') throw unsafeReplay();
      throw error;
    }
  }

  private securityMaterial(addressId: string, input: StoreAddressWriteRequest) {
    const runtime = this.runtime();
    const material = createStoreAddressSecurityMaterial(
      { addressId, detail: input.detail, phone: input.phone },
      runtime.encryption.fieldKeys.current,
      runtime.store.phoneHashKeys.current,
    );
    return {
      detailCiphertext: material.detailCiphertext,
      encryptionKeyId: material.encryptionKeyId,
      phoneCiphertext: material.phoneCiphertext,
      phoneHash: material.phoneHash,
      phoneLast4: material.phoneLast4,
    };
  }

  private protectedMaterial(address: StoreAddressSnapshot) {
    try {
      return verifyStoreAddressSecurityMaterial({
        addressId: address.addressId,
        detailCiphertext: address.detailCiphertext,
        encryptionKeyId: address.encryptionKeyId,
        phoneCiphertext: address.phoneCiphertext,
        phoneHash: address.phoneHash,
        phoneLast4: address.phoneLast4,
      }, this.runtime().encryption.fieldKeys, this.runtime().store.phoneHashKeys);
    } catch (cause) {
      throw new ApplicationError('INTERNAL_ERROR', 'Stored address material is unreadable', [], { cause });
    }
  }

  private summaryView(address: StoreAddressSnapshot) {
    const protectedMaterial = this.protectedMaterial(address);
    let recipientNameMasked: string;
    try {
      recipientNameMasked = maskStoreAddressRecipient(address.recipientName);
    } catch (cause) {
      throw new ApplicationError('INTERNAL_ERROR', 'Stored address recipient is unreadable', [], { cause });
    }
    return {
      address_id: address.addressId,
      city: address.city,
      detail_masked: protectedMaterial.detailMasked,
      district: address.district,
      is_default: address.isDefault,
      phone_masked: protectedMaterial.phoneMasked,
      province: address.province,
      recipient_name_masked: recipientNameMasked,
      version: address.version,
    };
  }

  private detailView(address: StoreAddressSnapshot) {
    const protectedMaterial = this.protectedMaterial(address);
    return {
      address_id: address.addressId,
      city: address.city,
      detail: protectedMaterial.detail,
      district: address.district,
      is_default: address.isDefault,
      phone: protectedMaterial.phone,
      province: address.province,
      recipient_name: address.recipientName,
      version: address.version,
    };
  }

  private deleteView(address: StoreAddressSnapshot) {
    if (address.deletedAt === null || address.isDefault) {
      throw new ApplicationError('INTERNAL_ERROR', 'Deleted address tombstone is invalid');
    }
    return {
      occurred_at: address.deletedAt.toISOString(),
      resource_id: address.addressId,
      resource_type: 'customer_address',
      status: 'DELETED',
      version: address.version,
    };
  }

  private async appendAudits(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    changes: readonly StoreAddressStateChange[],
    requestId: string,
    idempotencyKey: string,
    ipAddress?: string,
  ): Promise<void> {
    for (const change of changes) {
      await this.auditRepository().append(transaction, {
        action: change.before === null ? 'CREATE' : change.after.status === 'DELETED' ? 'DELETE' : 'UPDATE',
        actorAccountId: session.accountId,
        actorRole: 'CUSTOMER',
        after: this.auditState(change.after),
        ...(change.before === null ? {} : { before: this.auditState(change.before) }),
        idempotencyKey,
        ...(ipAddress ? { ipAddress } : {}),
        module: 'customer',
        objectId: change.addressId,
        objectType: 'address',
        requestId,
        result: 'SUCCESS',
        resultCode: 'OK',
        summaryPolicy: 'ADDRESS_STATE',
      });
    }
  }

  private auditState(state: StoreAddressAuditState) {
    return { is_default: state.isDefault, status: state.status, version: state.version };
  }

  private complete(
    transaction: DatabaseTransaction,
    claim: IdempotencyClaim,
    address: StoreAddressSnapshot,
  ) {
    return this.idempotencyRepository().complete(transaction, claim, {
      resourceId: address.addressId,
      responseForHash: {
        address_id: address.addressId,
        is_default: address.isDefault,
        status: address.deletedAt === null ? 'ACTIVE' : 'DELETED',
        version: address.version,
      },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  }

  private wireBody(input: StoreAddressWriteRequest) {
    return {
      city: input.city,
      detail: input.detail,
      district: input.district,
      is_default: input.isDefault,
      phone: input.phone,
      province: input.province,
      recipient_name: input.recipientName,
    };
  }

  private claim(
    actorId: string,
    idempotencyKey: string,
    request: IdempotencyClaim['request'],
  ): IdempotencyClaim {
    return { actorId, idempotencyKey, request };
  }

  private identity(session: CurrentStoreSession) {
    return { accountId: session.accountId, customerId: session.customerId };
  }

  private repository(): StoreAddressRepository {
    if (!this.addresses) throw new ApplicationError('INTERNAL_ERROR', 'Store address repository is unavailable');
    return this.addresses;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw new ApplicationError('INTERNAL_ERROR', 'Store address audit is unavailable');
    return this.audit;
  }

  private idempotencyRepository(): IdempotencyRepository {
    if (!this.idempotency) throw new ApplicationError('INTERNAL_ERROR', 'Store address idempotency is unavailable');
    return this.idempotency;
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store address runtime is unavailable');
    return this.config;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Store address database is unavailable');
    return this.database;
  }
}
