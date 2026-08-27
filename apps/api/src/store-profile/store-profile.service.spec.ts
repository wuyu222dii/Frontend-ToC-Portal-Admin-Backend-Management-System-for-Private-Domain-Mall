import type { PlatformRuntimeConfig } from '@qingxu/config';
import type {
  CurrentStoreSession,
  DatabaseRuntime,
  DatabaseTransaction,
  StoreProfileSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  createEncryptionContext,
  encryptEnvelope,
  hmacStoreAccountPhone,
  type EncryptedEnvelope,
} from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StorePhoneAuthorizationInput } from './store-profile.dto';
import type { StorePhoneProvider } from './store-phone-provider';
import { StoreProfileService } from './store-profile.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const SESSION_ID = '01J00000000000000000000002';
const SESSION_FAMILY = '01J00000000000000000000003';
const PHONE_ID = '01J00000000000000000000004';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';
const KEY = '018f47a2-9f61-7c4f-8b6e-9a61b3470f2e';
const NOW = new Date('2026-08-27T04:30:00.000Z');
const PHONE = '13812345678';

const FIELD_CURRENT = { id: 'field-v2', key: Buffer.alloc(32, 11) };
const FIELD_PREVIOUS = { id: 'field-v1', key: Buffer.alloc(32, 12) };
const PHONE_HASH_CURRENT = { id: 'phone-hash-v2', key: Buffer.alloc(32, 13) };
const PHONE_HASH_PREVIOUS = { id: 'phone-hash-v1', key: Buffer.alloc(32, 14) };

function config(): PlatformRuntimeConfig {
  return {
    authentication: {
      accessTokenTtlSeconds: 900,
      audience: 'qingxu-admin-web',
      issuer: 'qingxu-api-test',
      preAuthTokenTtlSeconds: 300,
      secretHashKeys: { current: { id: 'auth-secret', key: Buffer.alloc(32, 21) }, previous: [] },
      sessionTtlSeconds: 604_800,
      signingKeys: { current: { id: 'auth-sign', key: Buffer.alloc(32, 22) }, previous: [] },
    },
    encryption: {
      fieldKeys: { current: FIELD_CURRENT, previous: [FIELD_PREVIOUS] },
      idempotencyHashKeys: {
        current: { id: 'idem-v1', key: Buffer.alloc(32, 23) },
        previous: [],
      },
      ipHashKey: Buffer.alloc(32, 24),
    },
    environment: 'test',
    store: {
      authTokenAudience: 'qingxu-store',
      identityProvider: 'MOCK',
      legalDocuments: {
        phoneAuthorization: {
          title: 'Phone authorization',
          url: 'https://example.test/legal/phone',
          version: 'phone-v2',
        },
        privacyPolicy: {
          title: 'Privacy policy',
          url: 'https://example.test/legal/privacy',
          version: 'privacy-v1',
        },
        userAgreement: {
          title: 'User agreement',
          url: 'https://example.test/legal/user',
          version: 'user-v1',
        },
      },
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
      customerRateLimitMax: 120,
      customerRateLimitWindowSeconds: 60,
      phoneHashKeys: { current: PHONE_HASH_CURRENT, previous: [PHONE_HASH_PREVIOUS] },
      phoneProvider: 'WECHAT',
      wechatAppId: 'wechat-app',
      wechatAppSecret: 'non-production-wechat-secret',
    },
  } as unknown as PlatformRuntimeConfig;
}

function session(): CurrentStoreSession {
  return {
    accessJti: 'store-access-jti-00000001',
    accountId: ACCOUNT_ID,
    accountVersion: 1,
    customerId: CUSTOMER_ID,
    customerVersion: 1,
    expiresAt: new Date(NOW.getTime() + 60_000),
    sessionFamily: SESSION_FAMILY,
    sessionId: SESSION_ID,
  };
}

function snapshot(overrides: Partial<StoreProfileSnapshot> = {}): StoreProfileSnapshot {
  return {
    accountId: ACCOUNT_ID,
    avatarUrl: 'https://cdn.example.test/avatar.png',
    city: 'Auckland',
    customerId: CUSTOMER_ID,
    nickname: 'Harry',
    phone: null,
    version: 1,
    ...overrides,
  };
}

function encryptedPhone(
  fieldKey = FIELD_CURRENT,
  hashKey = PHONE_HASH_CURRENT,
): NonNullable<StoreProfileSnapshot['phone']> {
  const envelope = encryptEnvelope(PHONE, {
    key: fieldKey.key,
    keyId: fieldKey.id,
  }, createEncryptionContext('customer_phone_verification', PHONE_ID, 'phone_ciphertext'));
  return {
    consentVersion: 'phone-v2',
    encryptionKeyId: fieldKey.id,
    id: PHONE_ID,
    phoneCiphertext: Buffer.from(JSON.stringify(envelope)),
    phoneHash: hmacStoreAccountPhone(PHONE, hashKey.key),
    phoneLast4: PHONE.slice(-4),
    source: 'WECHAT',
    verifiedAt: NOW,
  };
}

function authorizationInput(
  documentVersion = 'phone-v2',
): StorePhoneAuthorizationInput {
  return {
    consent: { accepted: true, documentVersion, type: 'PHONE_AUTHORIZATION' },
    providerCredential: 'wechat-one-time-phone-code',
  };
}

function harness() {
  const transaction = {} as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => unknown) => work(transaction)),
  };
  const database = { prisma } as unknown as DatabaseRuntime;
  const provider = { verify: vi.fn().mockResolvedValue({ phone: PHONE, source: 'WECHAT' }) };
  const profiles = {
    getCurrentProfile: vi.fn().mockResolvedValue(snapshot()),
    replaceCurrentPhoneInTransaction: vi.fn(async (_transaction, input) => snapshot({
      phone: {
        ...input.verification,
        phoneCiphertext: Buffer.from(input.verification.phoneCiphertext),
      },
      version: input.expectedVersion + 1,
    })),
    revokeCurrentPhoneInTransaction: vi.fn(async (_transaction, input) => snapshot({
      phone: null,
      version: input.expectedVersion + 1,
    })),
    updateCurrentProfileInTransaction: vi.fn(async (_transaction, input) => snapshot({
      ...input.patch,
      version: input.expectedVersion + 1,
    })),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  const service = new StoreProfileService(config(), database, provider as unknown as StorePhoneProvider);
  Object.assign(service as unknown as Record<string, unknown>, { audit, idempotency, profiles });
  return { audit, idempotency, prisma, profiles, provider, service, transaction };
}

function mutateCiphertext(phone: NonNullable<StoreProfileSnapshot['phone']>) {
  const envelope = JSON.parse(Buffer.from(phone.phoneCiphertext).toString('utf8')) as EncryptedEnvelope;
  envelope.ciphertext = `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`;
  return { ...phone, phoneCiphertext: Buffer.from(JSON.stringify(envelope)) };
}

describe('B7.2 Store profile service', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns a profile without a phone and binds the read to both session identities', async () => {
    const { profiles, service } = harness();
    await expect(service.getProfile(session())).resolves.toEqual({
      avatar_url: 'https://cdn.example.test/avatar.png',
      city: 'Auckland',
      customer_id: CUSTOMER_ID,
      nickname: 'Harry',
      phone_masked: null,
      phone_source: null,
      phone_tail: null,
      phone_verified_at: null,
      version: 1,
    });
    expect(profiles.getCurrentProfile).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID });
  });

  it('decrypts and verifies a current phone with retained field and HMAC keys', async () => {
    const { profiles, service } = harness();
    profiles.getCurrentProfile.mockResolvedValue(snapshot({
      phone: encryptedPhone(FIELD_PREVIOUS, PHONE_HASH_PREVIOUS),
    }));
    await expect(service.getProfile(session())).resolves.toMatchObject({
      phone_masked: '138 **** 5678',
      phone_source: 'WECHAT',
      phone_tail: '5678',
      phone_verified_at: NOW.toISOString(),
    });
  });

  it('updates with expected_version, audit, and a HASH_ONLY idempotency result', async () => {
    const { audit, idempotency, profiles, service } = harness();
    await expect(service.updateProfile(
      session(), { city: 'Wellington', nickname: null }, 1, KEY, REQUEST_ID, '127.0.0.1',
    )).resolves.toMatchObject({ city: 'Wellington', nickname: null, version: 2 });

    expect(profiles.updateCurrentProfileInTransaction).toHaveBeenCalledWith(expect.anything(), {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedVersion: 1,
      patch: { city: 'Wellington', nickname: null },
    });
    expect(idempotency.claim).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      request: {
        body: { city: 'Wellington', expected_version: 1, nickname: null },
        method: 'PATCH',
        pathParameters: {},
        route: '/store/profile',
      },
    }));
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'UPDATE',
      actorAccountId: ACCOUNT_ID,
      actorRole: 'CUSTOMER',
      after: { version: 2 },
      before: { version: 1 },
      ipAddress: '127.0.0.1',
      objectId: CUSTOMER_ID,
      summaryPolicy: 'STATUS_VERSION',
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: CUSTOMER_ID,
      responseForHash: { customer_id: CUSTOMER_ID, version: 2 },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  });

  it('rejects stale consent before Provider selection or database access', async () => {
    const { prisma, profiles, provider, service } = harness();
    await expect(service.authorizePhone(
      session(), authorizationInput('phone-v1'), 1, KEY, REQUEST_ID,
    )).rejects.toMatchObject({ code: 'CONSENT_VERSION_MISMATCH' });
    expect(provider.verify).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(profiles.replaceCurrentPhoneInTransaction).not.toHaveBeenCalled();
  });

  it('uses the server-selected Provider result and stores only encrypted and HMAC phone material', async () => {
    const { idempotency, profiles, provider, service } = harness();
    const response = await service.authorizePhone(
      session(), authorizationInput(), 1, KEY, REQUEST_ID,
    );
    expect(provider.verify).toHaveBeenCalledWith('wechat-one-time-phone-code');
    const replacement = profiles.replaceCurrentPhoneInTransaction.mock.calls[0]?.[1];
    expect(replacement).toMatchObject({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      expectedVersion: 1,
      verification: {
        consentVersion: 'phone-v2',
        encryptionKeyId: FIELD_CURRENT.id,
        phoneHash: hmacStoreAccountPhone(PHONE, PHONE_HASH_CURRENT.key),
        phoneLast4: '5678',
        source: 'WECHAT',
        verifiedAt: expect.any(Date),
      },
    });
    const persistedMaterial = JSON.stringify(replacement);
    expect(persistedMaterial).not.toContain(PHONE);
    expect(persistedMaterial).not.toContain('wechat-one-time-phone-code');
    expect(response).toMatchObject({ phone_masked: '138 **** 5678', phone_source: 'WECHAT', version: 2 });
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      resourceId: CUSTOMER_ID,
      responseForHash: { customer_id: CUSTOMER_ID, version: 2 },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  });

  it('revokes the current phone with CAS, audit, and HASH_ONLY completion', async () => {
    const { audit, idempotency, profiles, service } = harness();
    await expect(service.revokePhone(session(), 3, KEY, REQUEST_ID))
      .resolves.toMatchObject({ phone_masked: null, phone_tail: null, version: 4 });
    expect(profiles.revokeCurrentPhoneInTransaction).toHaveBeenCalledWith(expect.anything(), {
      accountId: ACCOUNT_ID, customerId: CUSTOMER_ID, expectedVersion: 3,
    });
    expect(audit.append).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'REVOKE', after: { version: 4 }, before: { version: 3 },
    }));
    expect(idempotency.complete).toHaveBeenCalledWith(expect.anything(), expect.anything(),
      expect.objectContaining({ responseStatus: 200, storage: 'HASH_ONLY' }));
  });

  it('rejects a completed same-key replay before Provider or profile mutation', async () => {
    const { audit, idempotency, profiles, provider, service } = harness();
    idempotency.claim.mockResolvedValue({ kind: 'replay', record: { response_status: 200 } });
    await expect(service.authorizePhone(session(), authorizationInput(), 1, KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(provider.verify).not.toHaveBeenCalled();
    expect(profiles.replaceCurrentPhoneInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();

    const raced = harness();
    raced.idempotency.claim
      .mockResolvedValueOnce({ kind: 'execute' })
      .mockResolvedValueOnce({ kind: 'replay', record: { response_status: 200 } });
    await expect(raced.service.updateProfile(
      session(), { nickname: 'Must not persist' }, 1, KEY, REQUEST_ID,
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(raced.profiles.updateCurrentProfileInTransaction).not.toHaveBeenCalled();
    expect(raced.audit.append).not.toHaveBeenCalled();
    expect(raced.idempotency.complete).not.toHaveBeenCalled();
  });

  it('does not open a mutation transaction when Provider verification fails', async () => {
    const { audit, idempotency, prisma, profiles, provider, service } = harness();
    provider.verify.mockRejectedValue(new ApplicationError('AUTH_REQUIRED', 'invalid phone credential'));
    await expect(service.authorizePhone(session(), authorizationInput(), 1, KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(idempotency.claim).toHaveBeenCalledTimes(1);
    expect(profiles.replaceCurrentPhoneInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('propagates an audit failure and does not complete idempotency in the failed transaction', async () => {
    const { audit, idempotency, profiles, service } = harness();
    const auditFailure = new Error('audit append failed');
    audit.append.mockRejectedValue(auditFailure);
    await expect(service.updateProfile(
      session(), { nickname: 'Updated' }, 1, KEY, REQUEST_ID,
    )).rejects.toBe(auditFailure);
    expect(profiles.updateCurrentProfileInTransaction).toHaveBeenCalledOnce();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it.each([
    ['ciphertext', (phone: NonNullable<StoreProfileSnapshot['phone']>) => mutateCiphertext(phone)],
    ['key ID', (phone: NonNullable<StoreProfileSnapshot['phone']>) => ({
      ...phone, encryptionKeyId: 'tampered-field-key',
    })],
    ['phone hash', (phone: NonNullable<StoreProfileSnapshot['phone']>) => ({
      ...phone, phoneHash: '0'.repeat(64),
    })],
  ])('fails closed when the persisted phone %s is tampered', async (_label, tamper) => {
    const { profiles, service } = harness();
    profiles.getCurrentProfile.mockResolvedValue(snapshot({ phone: tamper(encryptedPhone()) }));
    await expect(service.getProfile(session())).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
