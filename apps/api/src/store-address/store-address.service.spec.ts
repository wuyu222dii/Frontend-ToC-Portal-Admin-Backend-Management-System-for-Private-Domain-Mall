import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentStoreSession,
  DatabaseRuntime,
  DatabaseTransaction,
  StoreAddressSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  createStoreAddressSecurityMaterial,
  type StoreAddressSecurityKey,
} from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StoreAddressWriteRequest } from './store-address.dto';
import { StoreAddressService } from './store-address.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const ADDRESS_ID = '01J00000000000000000000002';
const SECOND_ADDRESS_ID = '01J00000000000000000000003';
const SESSION_ID = '01J00000000000000000000004';
const SESSION_FAMILY = '01J00000000000000000000005';
const KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const NOW = new Date('2026-08-28T01:02:03.000Z');
const PHONE = '13800006821';
const DETAIL = '江南大道 100 号 1 单元';
const FIELD_CURRENT = { id: 'address-field-v2', key: Buffer.alloc(32, 31) };
const FIELD_PREVIOUS = { id: 'address-field-v1', key: Buffer.alloc(32, 32) };
const HASH_CURRENT = { id: 'address-phone-v2', key: Buffer.alloc(32, 33) };
const HASH_PREVIOUS = { id: 'address-phone-v1', key: Buffer.alloc(32, 34) };

const input: StoreAddressWriteRequest = {
  city: '杭州市',
  detail: DETAIL,
  district: '滨江区',
  isDefault: true,
  phone: PHONE,
  province: '浙江省',
  recipientName: '林晓月',
};

function config(): PlatformRuntimeConfig {
  return {
    encryption: {
      fieldKeys: { current: FIELD_CURRENT, previous: [FIELD_PREVIOUS] },
      idempotencyHashKeys: { current: { id: 'idem-v1', key: Buffer.alloc(32, 35) }, previous: [] },
      ipHashKey: Buffer.alloc(32, 36),
    },
    store: {
      phoneHashKeys: { current: HASH_CURRENT, previous: [HASH_PREVIOUS] },
    },
  } as unknown as PlatformRuntimeConfig;
}

const session: CurrentStoreSession = {
  accessJti: 'access:01J00000000000000000000006',
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  customerId: CUSTOMER_ID,
  customerVersion: 1,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  sessionFamily: SESSION_FAMILY,
  sessionId: SESSION_ID,
};

function snapshot(options: {
  addressId?: string;
  deletedAt?: Date | null;
  detail?: string;
  fieldKey?: StoreAddressSecurityKey;
  hashKey?: StoreAddressSecurityKey;
  isDefault?: boolean;
  phone?: string;
  version?: number;
} = {}): StoreAddressSnapshot {
  const addressId = options.addressId ?? ADDRESS_ID;
  const material = createStoreAddressSecurityMaterial({
    addressId,
    detail: options.detail ?? DETAIL,
    phone: options.phone ?? PHONE,
  }, options.fieldKey ?? FIELD_PREVIOUS, options.hashKey ?? HASH_PREVIOUS);
  return {
    addressId,
    city: '杭州市',
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    customerId: CUSTOMER_ID,
    deletedAt: options.deletedAt ?? null,
    detailCiphertext: material.detailCiphertext,
    district: '滨江区',
    encryptionKeyId: material.encryptionKeyId,
    isDefault: options.isDefault ?? true,
    phoneCiphertext: material.phoneCiphertext,
    phoneHash: material.phoneHash,
    phoneLast4: material.phoneLast4,
    province: '浙江省',
    recipientName: '林晓月',
    version: options.version ?? 3,
  };
}

function harness() {
  const transaction = {} as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (current: DatabaseTransaction) => Promise<unknown>) => work(transaction)),
  };
  const current = snapshot();
  const addresses = {
    createAddressInTransaction: vi.fn(async (_transaction, write) => {
      const address = {
        ...current,
        ...write,
        createdAt: NOW,
        customerId: CUSTOMER_ID,
        deletedAt: null,
        version: 1,
      } as StoreAddressSnapshot;
      return {
        address,
        changes: [{
          addressId: address.addressId,
          after: { isDefault: address.isDefault, status: 'ACTIVE', version: 1 },
          before: null,
        }],
      };
    }),
    deleteAddressInTransaction: vi.fn(async (_transaction, write) => {
      const address = snapshot({
        addressId: write.addressId,
        deletedAt: NOW,
        isDefault: false,
        version: write.expectedVersion + 1,
      });
      return {
        address,
        addressId: write.addressId,
        changes: [{
          addressId: write.addressId,
          after: { isDefault: false, status: 'DELETED', version: write.expectedVersion + 1 },
          before: { isDefault: true, status: 'ACTIVE', version: write.expectedVersion },
        }],
      };
    }),
    getAddress: vi.fn().mockResolvedValue(current),
    getAddressForMutationInTransaction: vi.fn().mockResolvedValue(current),
    getAddresses: vi.fn().mockResolvedValue([current]),
    updateAddressInTransaction: vi.fn(async (_transaction, write) => {
      const address = { ...current, ...write, version: write.expectedVersion + 1 } as StoreAddressSnapshot;
      return {
        address,
        changes: [{
          addressId: address.addressId,
          after: { isDefault: address.isDefault, status: 'ACTIVE', version: address.version },
          before: { isDefault: true, status: 'ACTIVE', version: write.expectedVersion },
        }],
      };
    }),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const service = new StoreAddressService(config(), database);
  Object.assign(service as unknown as Record<string, unknown>, { addresses, audit, idempotency });
  return { addresses, audit, idempotency, prisma, service, transaction };
}

describe('B8.3 Store address service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('verifies retained encryption/HMAC keys before returning a masked list', async () => {
    const { addresses, service } = harness();
    await expect(service.listAddresses(session)).resolves.toEqual([{
      address_id: ADDRESS_ID,
      city: '杭州市',
      detail_masked: '江南大道 ****',
      district: '滨江区',
      is_default: true,
      phone_masked: '138 **** 6821',
      province: '浙江省',
      recipient_name_masked: '林**',
      version: 3,
    }]);
    expect(addresses.getAddresses).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID });
  });

  it('returns complete plaintext only from an owned detail read', async () => {
    const { addresses, service } = harness();
    await expect(service.getAddress(session, ADDRESS_ID)).resolves.toEqual({
      address_id: ADDRESS_ID,
      city: '杭州市',
      detail: DETAIL,
      district: '滨江区',
      is_default: true,
      phone: PHONE,
      province: '浙江省',
      recipient_name: '林晓月',
      version: 3,
    });
    expect(addresses.getAddress).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      addressId: ADDRESS_ID,
      customerId: CUSTOMER_ID,
    });
  });

  it('claims before generating protected create material and never passes phone/detail plaintext to the repository', async () => {
    const { addresses, audit, idempotency, prisma, service, transaction } = harness();
    const response = await service.createAddress(session, input, KEY, REQUEST_ID, '127.0.0.1');

    expect(response).toMatchObject({ detail: DETAIL, phone: PHONE, version: 1 });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable', maxWait: 5_000, timeout: 15_000,
    });
    expect(idempotency.claim).toHaveBeenCalledWith(transaction, {
      actorId: ACCOUNT_ID,
      idempotencyKey: KEY,
      request: {
        body: {
          city: '杭州市', detail: DETAIL, district: '滨江区', is_default: true,
          phone: PHONE, province: '浙江省', recipient_name: '林晓月',
        },
        method: 'POST',
        pathParameters: {},
        route: '/store/addresses',
      },
    });
    expect(idempotency.claim.mock.invocationCallOrder[0]!).toBeLessThan(
      addresses.createAddressInTransaction.mock.invocationCallOrder[0]!,
    );
    const repositoryInput = addresses.createAddressInTransaction.mock.calls[0]![1];
    expect(repositoryInput).not.toHaveProperty('phone');
    expect(repositoryInput).not.toHaveProperty('detail');
    expect(repositoryInput.phoneCiphertext).toBeInstanceOf(Buffer);
    expect(repositoryInput.detailCiphertext).toBeInstanceOf(Buffer);
    expect(JSON.stringify(repositoryInput)).not.toContain(PHONE);
    expect(JSON.stringify(repositoryInput)).not.toContain(DETAIL);

    expect(audit.append).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'CREATE',
      actorAccountId: ACCOUNT_ID,
      actorRole: 'CUSTOMER',
      after: { is_default: true, status: 'ACTIVE', version: 1 },
      idempotencyKey: KEY,
      ipAddress: '127.0.0.1',
      module: 'customer',
      objectType: 'address',
      summaryPolicy: 'ADDRESS_STATE',
    }));
    expect(JSON.stringify(audit.append.mock.calls)).not.toContain(PHONE);
    expect(JSON.stringify(audit.append.mock.calls)).not.toContain(DETAIL);
    expect(idempotency.complete).toHaveBeenCalledWith(transaction, expect.any(Object), {
      resourceId: repositoryInput.addressId,
      responseForHash: {
        address_id: repositoryInput.addressId,
        is_default: true,
        status: 'ACTIVE',
        version: 1,
      },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  });

  it('binds If-Match into update idempotency and audits every default-address state change', async () => {
    const { addresses, audit, idempotency, service } = harness();
    const otherChange = {
      addressId: SECOND_ADDRESS_ID,
      after: { isDefault: false, status: 'ACTIVE' as const, version: 5 },
      before: { isDefault: true, status: 'ACTIVE' as const, version: 4 },
    };
    addresses.updateAddressInTransaction.mockImplementationOnce(async () => {
      const address = snapshot({ fieldKey: FIELD_CURRENT, hashKey: HASH_CURRENT, isDefault: true, version: 4 });
      return {
        address,
        changes: [otherChange, {
          addressId: ADDRESS_ID,
          after: { isDefault: true, status: 'ACTIVE' as const, version: 4 },
          before: { isDefault: false, status: 'ACTIVE' as const, version: 3 },
        }],
      };
    });

    await service.updateAddress(session, ADDRESS_ID, input, 3, KEY, REQUEST_ID);
    expect(idempotency.claim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      request: expect.objectContaining({
        body: expect.objectContaining({ expected_version: 3, phone: PHONE }),
        method: 'PATCH',
        pathParameters: { address_id: ADDRESS_ID },
        route: '/store/addresses/{address_id}',
      }),
    }));
    expect(addresses.updateAddressInTransaction.mock.calls[0]![1]).not.toHaveProperty('phone');
    expect(audit.append).toHaveBeenCalledTimes(2);
    expect(audit.append).toHaveBeenNthCalledWith(1, expect.anything(), expect.objectContaining({
      after: { is_default: false, status: 'ACTIVE', version: 5 },
      before: { is_default: true, status: 'ACTIVE', version: 4 },
      objectId: SECOND_ADDRESS_ID,
    }));
    expect(audit.append).toHaveBeenNthCalledWith(2, expect.anything(), expect.objectContaining({
      after: { is_default: true, status: 'ACTIVE', version: 4 },
      before: { is_default: false, status: 'ACTIVE', version: 3 },
      objectId: ADDRESS_ID,
    }));
  });

  it('returns an exact no-PII delete command and hashes only tombstone state', async () => {
    const { audit, idempotency, service, transaction } = harness();
    await expect(service.deleteAddress(session, ADDRESS_ID, 3, KEY, REQUEST_ID)).resolves.toEqual({
      occurred_at: NOW.toISOString(),
      resource_id: ADDRESS_ID,
      resource_type: 'customer_address',
      status: 'DELETED',
      version: 4,
    });
    expect(audit.append).toHaveBeenCalledWith(transaction, expect.objectContaining({
      action: 'DELETE',
      after: { is_default: false, status: 'DELETED', version: 4 },
      before: { is_default: true, status: 'ACTIVE', version: 3 },
      objectId: ADDRESS_ID,
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(transaction, expect.anything(), {
      resourceId: ADDRESS_ID,
      responseForHash: { address_id: ADDRESS_ID, is_default: false, status: 'DELETED', version: 4 },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  });

  it('replays create and update from the current owned active projection without reapplying or auditing', async () => {
    const { addresses, audit, idempotency, service, transaction } = harness();
    idempotency.claim.mockResolvedValue({
      kind: 'replay', record: { resource_id: ADDRESS_ID, response_status: 200 },
    });

    await expect(service.createAddress(session, input, KEY, REQUEST_ID)).resolves.toMatchObject({
      address_id: ADDRESS_ID,
      phone: PHONE,
      version: 3,
    });
    expect(addresses.getAddressForMutationInTransaction).toHaveBeenCalledWith(transaction, {
      accountId: ACCOUNT_ID, addressId: ADDRESS_ID, customerId: CUSTOMER_ID,
    }, { includeDeleted: false });
    await expect(service.updateAddress(session, ADDRESS_ID, input, 2, KEY, REQUEST_ID))
      .resolves.toMatchObject({ address_id: ADDRESS_ID, version: 3 });
    expect(addresses.createAddressInTransaction).not.toHaveBeenCalled();
    expect(addresses.updateAddressInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('replays delete only from the owned deleted tombstone and never decrypts its PII', async () => {
    const { addresses, audit, idempotency, service, transaction } = harness();
    idempotency.claim.mockResolvedValue({
      kind: 'replay', record: { resource_id: ADDRESS_ID, response_status: 200 },
    });
    const tombstone = snapshot({ deletedAt: NOW, isDefault: false, version: 4 });
    tombstone.phoneCiphertext = Buffer.from('unreadable-on-purpose');
    tombstone.detailCiphertext = Buffer.from('unreadable-on-purpose');
    addresses.getAddressForMutationInTransaction.mockResolvedValue(tombstone);

    await expect(service.deleteAddress(session, ADDRESS_ID, 3, KEY, REQUEST_ID)).resolves.toEqual({
      occurred_at: NOW.toISOString(), resource_id: ADDRESS_ID,
      resource_type: 'customer_address', status: 'DELETED', version: 4,
    });
    expect(addresses.getAddressForMutationInTransaction).toHaveBeenCalledWith(transaction, {
      accountId: ACCOUNT_ID, addressId: ADDRESS_ID, customerId: CUSTOMER_ID,
    }, { includeDeleted: true, purpose: 'DELETE_REPLAY' });
    expect(addresses.deleteAddressInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('refuses mismatched, failed, missing or state-incompatible replays', async () => {
    const cases = [
      { record: { resource_id: SECOND_ADDRESS_ID, response_status: 200 } },
      { record: { resource_id: ADDRESS_ID, response_status: 201 } },
      { record: { resource_id: null, response_status: 200 } },
    ];
    for (const item of cases) {
      const { idempotency, service } = harness();
      idempotency.claim.mockResolvedValue({ kind: 'replay', ...item });
      await expect(service.updateAddress(session, ADDRESS_ID, input, 3, KEY, REQUEST_ID))
        .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    }

    const deleted = harness();
    deleted.idempotency.claim.mockResolvedValue({
      kind: 'replay', record: { resource_id: ADDRESS_ID, response_status: 200 },
    });
    deleted.addresses.getAddressForMutationInTransaction.mockResolvedValue(snapshot());
    await expect(deleted.service.deleteAddress(session, ADDRESS_ID, 3, KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('fails closed on protected material corruption and rolls writes back before audit/complete', async () => {
    const corrupted = harness();
    const invalid = snapshot();
    invalid.phoneHash = '0'.repeat(64);
    corrupted.addresses.getAddresses.mockResolvedValue([invalid]);
    await expect(corrupted.service.listAddresses(session)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const failed = harness();
    failed.addresses.updateAddressInTransaction.mockRejectedValue(
      new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Address changed'),
    );
    await expect(failed.service.updateAddress(session, ADDRESS_ID, input, 3, KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(failed.audit.append).not.toHaveBeenCalled();
    expect(failed.idempotency.complete).not.toHaveBeenCalled();
  });
});
