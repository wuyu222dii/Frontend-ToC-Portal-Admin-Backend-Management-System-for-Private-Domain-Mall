import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StoreAddressRepository,
  type CreateStoreAddressInput,
} from './store-address.repository';

const NOW = new Date('2026-08-28T06:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 20_000);
const customerId = generateUlid(NOW.getTime() - 19_000);
const defaultAddressId = generateUlid(NOW.getTime() - 18_000);
const secondAddressId = generateUlid(NOW.getTime() - 17_000);
const thirdAddressId = generateUlid(NOW.getTime() - 16_000);

interface TestAddressRow {
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
  updated_at: Date;
  version: number;
}

function addressRow(overrides: Partial<TestAddressRow> = {}): TestAddressRow {
  return {
    city: 'Hangzhou',
    created_at: new Date(NOW.getTime() - 10_000),
    customer_id: customerId,
    deleted_at: null,
    detail_ciphertext: Buffer.from('detail-envelope'),
    district: 'Xihu',
    encryption_key_id: 'field-key-v1',
    id: defaultAddressId,
    is_default: true,
    phone_ciphertext: Buffer.from('phone-envelope'),
    phone_hash: 'a'.repeat(64),
    phone_last4: '6821',
    province: 'Zhejiang',
    recipient_name: 'Zhang San',
    updated_at: new Date(NOW.getTime() - 10_000),
    version: 1,
    ...overrides,
  };
}

function writeInput(overrides: Partial<CreateStoreAddressInput> = {}): CreateStoreAddressInput {
  return {
    accountId,
    addressId: thirdAddressId,
    city: ' Hangzhou ',
    customerId,
    detailCiphertext: Buffer.from('new-detail-envelope'),
    district: ' Xihu ',
    encryptionKeyId: 'field-key-v2',
    isDefault: false,
    phoneCiphertext: Buffer.from('new-phone-envelope'),
    phoneHash: 'b'.repeat(64),
    phoneLast4: '1234',
    province: ' Zhejiang ',
    recipientName: ' Li Si ',
    ...overrides,
  };
}

function harness(initialRows: TestAddressRow[] = []) {
  const rows = initialRows.map((row) => ({ ...row }));
  const events: string[] = [];
  const account = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id !== accountId) return null;
      return {
        customer_profile: { account_id: accountId, anonymized_at: null, id: customerId },
        deleted_at: null,
        login_name: null,
        password_hash: null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        wechat_open_id: 'openid-address-owner',
      };
    }),
  };
  const customerAddress = {
    create: vi.fn(async ({ data }: { data: TestAddressRow }) => {
      rows.push({ ...data });
      events.push(`create:${data.id}`);
      return data;
    }),
    findFirst: vi.fn(async ({ where }: {
      where: { customer_id: string; deleted_at?: null; id: string };
    }) => rows.find((row) => row.id === where.id && row.customer_id === where.customer_id &&
      (where.deleted_at === undefined || row.deleted_at === null)) ?? null),
    findMany: vi.fn(async ({ orderBy, where }: {
      orderBy: Array<Record<string, 'asc' | 'desc'>>;
      where: { customer_id: string; deleted_at: null };
    }) => rows.filter((row) => row.customer_id === where.customer_id && row.deleted_at === null)
      .sort((left, right) => {
        for (const item of orderBy) {
          const [field, direction] = Object.entries(item)[0]!;
          const leftValue = left[field as keyof TestAddressRow];
          const rightValue = right[field as keyof TestAddressRow];
          const difference = leftValue instanceof Date && rightValue instanceof Date
            ? leftValue.getTime() - rightValue.getTime()
            : leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
          if (difference !== 0) return direction === 'asc' ? difference : -difference;
        }
        return 0;
      })),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      events.push(`findUnique:${where.id}`);
      return rows.find((row) => row.id === where.id) ?? null;
    }),
    updateMany: vi.fn(async ({ data, where }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      const row = rows.find((candidate) =>
        (where.id === undefined || candidate.id === where.id) &&
        (where.customer_id === undefined || candidate.customer_id === where.customer_id) &&
        (where.deleted_at === undefined || candidate.deleted_at === where.deleted_at) &&
        (where.is_default === undefined || candidate.is_default === where.is_default) &&
        (where.version === undefined || candidate.version === where.version));
      if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
        if (key === 'version' && typeof value === 'object' && value !== null && 'increment' in value) {
          row.version += Number(value.increment);
        } else {
          (row as unknown as Record<string, unknown>)[key] = value;
        }
      }
      return { count: 1 };
    }),
  };
  const transactionStub = {
    $queryRawUnsafe: vi.fn(async (_query: string, namespaceOrLocks: string) => {
      if (namespaceOrLocks.startsWith('[')) {
        const locks = JSON.parse(namespaceOrLocks) as Array<{ namespace: string; parts: string }>;
        events.push(`locks:${locks.map(({ namespace, parts }) => `${namespace}:${parts}`).join('|')}`);
      } else {
        events.push(`lock:${namespaceOrLocks}`);
      }
      return [{ acquired: 1 }];
    }),
    account,
    customerAddress,
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => Promise<unknown>) =>
      work(transactionStub as unknown as DatabaseTransaction)),
    account,
    customerAddress,
  };
  return {
    customerAddress,
    events,
    repository: new StoreAddressRepository(prisma as unknown as PrismaClient, () => NOW),
    rows,
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

describe('StoreAddressRepository', () => {
  it('lists active owned addresses in stable default order and hides deleted or cross-customer rows', async () => {
    const deleted = addressRow({ deleted_at: NOW, id: thirdAddressId, is_default: false });
    const second = addressRow({
      created_at: new Date(NOW.getTime() - 12_000),
      id: secondAddressId,
      is_default: false,
      recipient_name: 'Second',
    });
    const currentDefault = addressRow({ created_at: new Date(NOW.getTime() - 8_000) });
    const state = harness([second, currentDefault, deleted]);

    await expect(state.repository.getAddresses({ accountId, customerId })).resolves.toMatchObject([
      { addressId: defaultAddressId, isDefault: true },
      { addressId: secondAddressId, isDefault: false },
    ]);
    await expect(state.repository.getAddress({ accountId, customerId, addressId: deleted.id }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    const foreignAddress = generateUlid();
    state.rows.push(addressRow({ customer_id: generateUlid(), id: foreignAddress, is_default: false }));
    await expect(state.repository.getAddress({ accountId, customerId, addressId: foreignAddress }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(state.repository.getAddress({
      accountId,
      customerId: generateUlid(),
      addressId: defaultAddressId,
    })).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });

    const missingDefault = harness([
      addressRow({ is_default: false }),
      addressRow({ id: secondAddressId, is_default: false }),
    ]);
    await expect(missingDefault.repository.getAddresses({ accountId, customerId }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('forces the first address to default and locks a new global ID before collision lookup', async () => {
    const state = harness();
    const result = await state.repository.createAddressInTransaction(state.transaction, writeInput());

    expect(result.address).toMatchObject({
      addressId: thirdAddressId,
      city: 'Hangzhou',
      isDefault: true,
      recipientName: 'Li Si',
      version: 1,
    });
    expect(result.changes).toEqual([{
      addressId: thirdAddressId,
      after: { isDefault: true, status: 'ACTIVE', version: 1 },
      before: null,
    }]);
    const addressLock = state.events.findIndex((event) => event.includes(`store-address:["${thirdAddressId}"]`));
    const collisionRead = state.events.indexOf(`findUnique:${thirdAddressId}`);
    expect(addressLock).toBeGreaterThan(-1);
    expect(collisionRead).toBeGreaterThan(addressLock);
    expect(state.events.slice(0, 3)).toEqual([
      'lock:store-auth-account',
      'lock:store-auth-customer',
      'lock:store-address-set',
    ]);
  });

  it('atomically switches the default and increments both affected address versions', async () => {
    const state = harness([
      addressRow(),
      addressRow({ id: secondAddressId, is_default: false, version: 4 }),
    ]);
    const result = await state.repository.updateAddressInTransaction(state.transaction, {
      ...writeInput({ addressId: secondAddressId, isDefault: true }),
      expectedVersion: 4,
    });

    expect(result.address).toMatchObject({ addressId: secondAddressId, isDefault: true, version: 5 });
    expect(result.changes).toEqual([
      {
        addressId: defaultAddressId,
        after: { isDefault: false, status: 'ACTIVE', version: 2 },
        before: { isDefault: true, status: 'ACTIVE', version: 1 },
      },
      {
        addressId: secondAddressId,
        after: { isDefault: true, status: 'ACTIVE', version: 5 },
        before: { isDefault: false, status: 'ACTIVE', version: 4 },
      },
    ]);
    const addressLocks = state.events.find((event) => event.startsWith('locks:store-address'))!;
    expect(addressLocks.indexOf(defaultAddressId)).toBeLessThan(addressLocks.indexOf(secondAddressId));
  });

  it('rejects stale updates and refuses to unset a default while other active addresses exist', async () => {
    const stale = harness([addressRow({ version: 2 })]);
    await expect(stale.repository.updateAddressInTransaction(stale.transaction, {
      ...writeInput({ addressId: defaultAddressId, isDefault: true }),
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(stale.customerAddress.updateMany).not.toHaveBeenCalled();

    const required = harness([addressRow(), addressRow({ id: secondAddressId, is_default: false })]);
    await expect(required.repository.updateAddressInTransaction(required.transaction, {
      ...writeInput({ addressId: defaultAddressId, isDefault: false }),
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'DEFAULT_ADDRESS_REQUIRED' });
    expect(required.customerAddress.updateMany).not.toHaveBeenCalled();
  });

  it('allows a sole default to be unset and restores the invariant when another address is created', async () => {
    const state = harness([addressRow()]);
    const unset = await state.repository.updateAddressInTransaction(state.transaction, {
      ...writeInput({ addressId: defaultAddressId, isDefault: false }),
      expectedVersion: 1,
    });
    expect(unset.address).toMatchObject({ addressId: defaultAddressId, isDefault: false, version: 2 });

    const created = await state.repository.createAddressInTransaction(state.transaction, writeInput({
      addressId: secondAddressId,
      isDefault: false,
    }));
    expect(created.address).toMatchObject({ addressId: secondAddressId, isDefault: true, version: 1 });
    expect(state.rows.filter(({ deleted_at, is_default }) => deleted_at === null && is_default)).toHaveLength(1);
  });

  it('soft-deletes the default, returns its exact tombstone and stably promotes the oldest address', async () => {
    const older = addressRow({
      created_at: new Date(NOW.getTime() - 15_000),
      id: secondAddressId,
      is_default: false,
      version: 6,
    });
    const newer = addressRow({ id: thirdAddressId, is_default: false, version: 8 });
    const state = harness([addressRow(), newer, older]);
    const result = await state.repository.deleteAddressInTransaction(state.transaction, {
      accountId,
      addressId: defaultAddressId,
      customerId,
      expectedVersion: 1,
    });

    expect(result.address).toMatchObject({
      addressId: defaultAddressId,
      deletedAt: NOW,
      isDefault: false,
      version: 2,
    });
    expect(result.changes).toEqual([
      {
        addressId: defaultAddressId,
        after: { isDefault: false, status: 'DELETED', version: 2 },
        before: { isDefault: true, status: 'ACTIVE', version: 1 },
      },
      {
        addressId: secondAddressId,
        after: { isDefault: true, status: 'ACTIVE', version: 7 },
        before: { isDefault: false, status: 'ACTIVE', version: 6 },
      },
    ]);
    expect(state.rows.find(({ id }) => id === secondAddressId)).toMatchObject({ is_default: true, version: 7 });
    await expect(state.repository.getAddressForMutationInTransaction(state.transaction, {
      accountId,
      addressId: defaultAddressId,
      customerId,
    }, { includeDeleted: true, purpose: 'DELETE_REPLAY' })).resolves.toMatchObject({ deletedAt: NOW, version: 2 });
  });

  it('fails closed before locking malformed writes and exhausted secondary versions', async () => {
    const invalidControl = harness();
    await expect(invalidControl.repository.createAddressInTransaction(invalidControl.transaction, {
      ...writeInput(),
      city: 'Hang\u0085zhou',
    })).rejects.toBeInstanceOf(TypeError);
    expect(invalidControl.transactionStub.$queryRawUnsafe).not.toHaveBeenCalled();

    const invalid = harness();
    await expect(invalid.repository.createAddressInTransaction(invalid.transaction, {
      ...writeInput(),
      phoneHash: 'A'.repeat(64),
    })).rejects.toBeInstanceOf(TypeError);
    expect(invalid.transactionStub.$queryRawUnsafe).not.toHaveBeenCalled();

    const staleMaximum = harness([addressRow()]);
    await expect(staleMaximum.repository.updateAddressInTransaction(staleMaximum.transaction, {
      ...writeInput({ addressId: defaultAddressId, isDefault: true }),
      expectedVersion: 2_147_483_647,
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });

    const exhaustedTarget = harness([addressRow({ version: 2_147_483_647 })]);
    await expect(exhaustedTarget.repository.updateAddressInTransaction(exhaustedTarget.transaction, {
      ...writeInput({ addressId: defaultAddressId, isDefault: true }),
      expectedVersion: 2_147_483_647,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    await expect(exhaustedTarget.repository.deleteAddressInTransaction(exhaustedTarget.transaction, {
      accountId,
      addressId: defaultAddressId,
      customerId,
      expectedVersion: 2_147_483_647,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(exhaustedTarget.customerAddress.updateMany).not.toHaveBeenCalled();

    const exhausted = harness([
      addressRow({ version: 2_147_483_647 }),
      addressRow({ id: secondAddressId, is_default: false, version: 1 }),
    ]);
    await expect(exhausted.repository.updateAddressInTransaction(exhausted.transaction, {
      ...writeInput({ addressId: secondAddressId, isDefault: true }),
      expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(exhausted.customerAddress.updateMany).not.toHaveBeenCalled();

    const invalidReplay = harness([addressRow({ deleted_at: NOW, is_default: false })]);
    await expect(invalidReplay.repository.getAddressForMutationInTransaction(invalidReplay.transaction, {
      accountId,
      addressId: defaultAddressId,
      customerId,
    }, { includeDeleted: true } as never)).rejects.toBeInstanceOf(TypeError);
    expect(invalidReplay.transactionStub.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
