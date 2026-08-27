import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StoreProfileRepository,
  type StorePhoneVerificationMaterial,
} from './store-profile.repository';

const NOW = new Date('2026-08-27T04:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 5_000);
const customerId = generateUlid(NOW.getTime() - 4_000);
const phoneId = generateUlid(NOW.getTime() - 3_000);
const replacementPhoneId = generateUlid(NOW.getTime() - 2_000);
const consentId = generateUlid(NOW.getTime() - 1_000);

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

interface TestPhoneRecord {
  consent_version: string;
  created_at: Date;
  customer_id: string;
  encryption_key_id: string;
  id: string;
  phone_ciphertext: Uint8Array;
  phone_hash: string;
  phone_last4: string;
  revoked_at: Date | null;
  source: string;
  verified_at: Date;
}

interface TestProfileRecord {
  account_id: string;
  anonymized_at: Date | null;
  avatar_url: string | null;
  city: string | null;
  id: string;
  nickname: string | null;
  version: number;
}

function phoneRecord(overrides: Partial<TestPhoneRecord> = {}): TestPhoneRecord {
  return {
    consent_version: 'phone-v1',
    created_at: NOW,
    customer_id: customerId,
    encryption_key_id: 'field-key-v1',
    id: phoneId,
    phone_ciphertext: Buffer.from('encrypted-phone'),
    phone_hash: hash('13800138000'),
    phone_last4: '8000',
    revoked_at: null,
    source: 'WECHAT',
    verified_at: new Date(NOW.getTime() - 10_000),
    ...overrides,
  };
}

function profileRecord(overrides: Partial<TestProfileRecord> = {}): TestProfileRecord {
  return {
    account_id: accountId,
    anonymized_at: null,
    avatar_url: null,
    city: null,
    id: customerId,
    nickname: null,
    version: 1,
    ...overrides,
  };
}

function verificationMaterial(overrides: Partial<StorePhoneVerificationMaterial> = {}): StorePhoneVerificationMaterial {
  return {
    consentVersion: 'phone-v2',
    encryptionKeyId: 'field-key-v2',
    id: replacementPhoneId,
    phoneCiphertext: Buffer.from('replacement-encrypted-phone'),
    phoneHash: hash('13900139000'),
    phoneLast4: '9000',
    source: 'MOCK',
    verifiedAt: new Date(NOW.getTime() - 5_000),
    ...overrides,
  };
}

function harness(options: { phone?: TestPhoneRecord | null; profile?: TestProfileRecord } = {}) {
  let profile = options.profile ?? profileRecord();
  let currentPhone = options.phone === undefined ? phoneRecord() : options.phone;
  let forcedProfileUpdateCount: number | undefined;
  let forcedPhoneUpdateCount: number | undefined;

  const account = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      if (where.id !== accountId) return null;
      return {
        customer_profile: {
          ...profile,
          phone_verifications: currentPhone?.revoked_at === null ? [{ ...currentPhone }] : [],
        },
        deleted_at: null,
        id: accountId,
        login_name: null,
        password_hash: null,
        role: 'CUSTOMER',
        status: 'ACTIVE',
        wechat_open_id: 'openid-current-customer',
      };
    }),
  };
  const customerProfile = {
    updateMany: vi.fn(async ({ data, where }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      if (forcedProfileUpdateCount !== undefined) return { count: forcedProfileUpdateCount };
      if (where.id !== profile.id || where.account_id !== profile.account_id ||
        where.version !== profile.version || (where.anonymized_at === null && profile.anonymized_at !== null)) {
        return { count: 0 };
      }
      const version = typeof data.version === 'object' && data.version !== null && 'increment' in data.version
        ? profile.version + Number(data.version.increment)
        : profile.version;
      profile = {
        ...profile,
        ...(Object.prototype.hasOwnProperty.call(data, 'avatar_url') ? { avatar_url: data.avatar_url as string | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'city') ? { city: data.city as string | null } : {}),
        ...(Object.prototype.hasOwnProperty.call(data, 'nickname') ? { nickname: data.nickname as string | null } : {}),
        version,
      };
      return { count: 1 };
    }),
  };
  const customerPhoneVerification = {
    create: vi.fn(async ({ data }: { data: TestPhoneRecord }) => {
      currentPhone = { ...data };
      return currentPhone;
    }),
    updateMany: vi.fn(async ({ data, where }: {
      data: { revoked_at: Date };
      where: { customer_id: string; id?: string; revoked_at: null };
    }) => {
      if (forcedPhoneUpdateCount !== undefined) return { count: forcedPhoneUpdateCount };
      if (!currentPhone || currentPhone.revoked_at !== null || currentPhone.customer_id !== where.customer_id ||
        (where.id !== undefined && currentPhone.id !== where.id)) return { count: 0 };
      currentPhone = { ...currentPhone, revoked_at: data.revoked_at };
      return { count: 1 };
    }),
  };
  const consentRecord = { create: vi.fn().mockResolvedValue({}) };
  const transactionStub = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    account,
    consentRecord,
    customerPhoneVerification,
    customerProfile,
  };
  const prisma = { account };
  return {
    account,
    consentRecord,
    customerPhoneVerification,
    customerProfile,
    repository: new StoreProfileRepository(prisma as unknown as PrismaClient, () => NOW),
    setForcedPhoneUpdateCount: (value: number | undefined) => { forcedPhoneUpdateCount = value; },
    setForcedProfileUpdateCount: (value: number | undefined) => { forcedProfileUpdateCount = value; },
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

describe('StoreProfileRepository', () => {
  it('reads only an active CUSTOMER profile bound to both account and customer IDs', async () => {
    const state = harness();
    await expect(state.repository.getCurrentProfile({ accountId, customerId })).resolves.toMatchObject({
      accountId,
      customerId,
      phone: {
        phoneHash: hash('13800138000'),
        phoneLast4: '8000',
        source: 'WECHAT',
      },
      version: 1,
    });

    const crossed = harness({ profile: profileRecord({ account_id: generateUlid(NOW.getTime() - 20_000) }) });
    await expect(crossed.repository.getCurrentProfile({ accountId, customerId }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('normalizes profile text and applies a double-bound version CAS under the fixed lock order', async () => {
    const state = harness();
    await expect(state.repository.updateCurrentProfileInTransaction(state.transaction, {
      accountId,
      customerId,
      expectedVersion: 1,
      patch: { avatarUrl: ' https://cdn.example.test/avatar.png ', city: ' Auckland ', nickname: ' Harry ' },
    })).resolves.toMatchObject({
      avatarUrl: 'https://cdn.example.test/avatar.png',
      city: 'Auckland',
      nickname: 'Harry',
      version: 2,
    });
    expect(state.transactionStub.$queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([
      'store-auth-account',
      'store-auth-customer',
      'store-profile-phone',
    ]);
    expect(state.customerProfile.updateMany).toHaveBeenCalledWith({
      data: expect.objectContaining({
        avatar_url: 'https://cdn.example.test/avatar.png',
        city: 'Auckland',
        nickname: 'Harry',
        version: { increment: 1 },
      }),
      where: { account_id: accountId, anonymized_at: null, id: customerId, version: 1 },
    });
  });

  it('rejects stale and lost-race updates as RESOURCE_VERSION_CONFLICT', async () => {
    const stale = harness({ profile: profileRecord({ version: 2 }) });
    await expect(stale.repository.updateCurrentProfileInTransaction(stale.transaction, {
      accountId, customerId, expectedVersion: 1, patch: { nickname: 'Stale' },
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(stale.customerProfile.updateMany).not.toHaveBeenCalled();

    const raced = harness();
    raced.setForcedProfileUpdateCount(0);
    await expect(raced.repository.updateCurrentProfileInTransaction(raced.transaction, {
      accountId, customerId, expectedVersion: 1, patch: { nickname: 'Raced' },
    })).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
  });

  it('replaces the current phone and appends PHONE_AUTHORIZATION consent in one transaction', async () => {
    const state = harness();
    const verification = verificationMaterial();
    await expect(state.repository.replaceCurrentPhoneInTransaction(state.transaction, {
      accountId,
      consentId,
      customerId,
      expectedVersion: 1,
      verification,
    })).resolves.toMatchObject({
      phone: { id: replacementPhoneId, phoneLast4: '9000', source: 'MOCK' },
      version: 2,
    });
    expect(state.customerPhoneVerification.updateMany).toHaveBeenCalledWith({
      data: { revoked_at: NOW },
      where: { customer_id: customerId, revoked_at: null },
    });
    expect(state.customerPhoneVerification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        customer_id: customerId,
        id: replacementPhoneId,
        phone_hash: verification.phoneHash,
        revoked_at: null,
      }),
    });
    expect(state.consentRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        accepted: true,
        account_id: accountId,
        consent_type: 'PHONE_AUTHORIZATION',
        document_version: 'phone-v2',
        id: consentId,
        source_terminal: 'MP_WEIXIN',
      }),
    });
  });

  it('revokes a current phone with CAS and rejects absence or a lost phone race', async () => {
    const state = harness();
    await expect(state.repository.revokeCurrentPhoneInTransaction(state.transaction, {
      accountId, customerId, expectedVersion: 1,
    })).resolves.toMatchObject({ phone: null, version: 2 });
    expect(state.customerPhoneVerification.updateMany).toHaveBeenCalledWith({
      data: { revoked_at: NOW },
      where: { customer_id: customerId, id: phoneId, revoked_at: null },
    });

    const absent = harness({ phone: null });
    await expect(absent.repository.revokeCurrentPhoneInTransaction(absent.transaction, {
      accountId, customerId, expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(absent.customerProfile.updateMany).not.toHaveBeenCalled();

    const raced = harness();
    raced.setForcedPhoneUpdateCount(0);
    await expect(raced.repository.revokeCurrentPhoneInTransaction(raced.transaction, {
      accountId, customerId, expectedVersion: 1,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it.each([
    ['unknown top-level field', { accountId, customerId, expectedVersion: 1, patch: { nickname: 'Valid' }, extra: true }],
    ['empty patch', { accountId, customerId, expectedVersion: 1, patch: {} }],
    ['blank nickname', { accountId, customerId, expectedVersion: 1, patch: { nickname: '  ' } }],
    ['control character in nickname', { accountId, customerId, expectedVersion: 1, patch: { nickname: 'Har\nry' } }],
    ['control character in city', { accountId, customerId, expectedVersion: 1, patch: { city: 'Auck\u0000land' } }],
    ['insecure avatar', { accountId, customerId, expectedVersion: 1, patch: { avatarUrl: 'http://example.test/a' } }],
    ['control character in avatar', { accountId, customerId, expectedVersion: 1, patch: { avatarUrl: 'https://example.test/a\n.png' } }],
    ['overflowing version', { accountId, customerId, expectedVersion: 2_147_483_647, patch: { city: 'Auckland' } }],
  ])('rejects %s before acquiring a transaction lock', async (_label, input) => {
    const state = harness();
    await expect(state.repository.updateCurrentProfileInTransaction(state.transaction, input as never))
      .rejects.toBeInstanceOf(TypeError);
    expect(state.transactionStub.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it.each([
    ['uppercase hash', verificationMaterial({ phoneHash: 'A'.repeat(64) })],
    ['invalid last four', verificationMaterial({ phoneLast4: '12x4' })],
    ['empty ciphertext', verificationMaterial({ phoneCiphertext: new Uint8Array() })],
    ['unknown source', { ...verificationMaterial(), source: 'SMS' }],
    ['future verification', verificationMaterial({ verifiedAt: new Date(NOW.getTime() + 1) })],
  ])('rejects phone material with %s before acquiring a transaction lock', async (_label, verification) => {
    const state = harness();
    await expect(state.repository.replaceCurrentPhoneInTransaction(state.transaction, {
      accountId, consentId, customerId, expectedVersion: 1, verification,
    } as never)).rejects.toBeInstanceOf(TypeError);
    expect(state.transactionStub.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});
