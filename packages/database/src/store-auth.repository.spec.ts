import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  StoreAuthRepository,
  type InitialStoreSessionMaterial,
} from './store-auth.repository';

const NOW = new Date('2026-08-27T02:00:00.000Z');

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sessionMaterial(label: string, family = generateUlid(NOW.getTime())): InitialStoreSessionMaterial {
  return {
    id: generateUlid(NOW.getTime()),
    accessJti: `access:${generateUlid(NOW.getTime())}`,
    refreshTokenHash: digest(`refresh:${label}`),
    sessionFamily: family,
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
  };
}

function customerRecord(id: string, accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    account_id: accountId,
    nickname: null,
    avatar_url: null,
    city: null,
    registered_at: NOW,
    anonymized_at: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function accountRecord(
  id: string,
  openId: string,
  customer: ReturnType<typeof customerRecord> | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    login_name: null,
    password_hash: null,
    wechat_open_id: openId,
    wechat_union_id: null,
    must_change_password: false,
    last_login_at: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    customer_profile: customer,
    ...overrides,
  };
}

function sessionRecord(
  account: ReturnType<typeof accountRecord>,
  material: InitialStoreSessionMaterial,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: material.id,
    account_id: account.id,
    access_jti: material.accessJti,
    refresh_token_hash: material.refreshTokenHash,
    assurance: 'WECHAT',
    restriction: 'NONE',
    mfa_factor_id: null,
    mfa_verified_at: null,
    session_family: material.sessionFamily,
    rotation_counter: 0,
    expires_at: material.expiresAt,
    revoked_at: null,
    last_seen_at: null,
    created_at: NOW,
    account,
    ...overrides,
  };
}

function loginInput() {
  return {
    accountId: generateUlid(NOW.getTime()),
    customerId: generateUlid(NOW.getTime()),
    openId: `openid-${generateUlid(NOW.getTime())}`,
    unionId: `union-${generateUlid(NOW.getTime())}`,
    sourceTerminal: 'MP_WEIXIN',
    consents: [
      { id: generateUlid(NOW.getTime()), type: 'USER_AGREEMENT' as const, documentVersion: 'agreement-v1' },
      { id: generateUlid(NOW.getTime()), type: 'PRIVACY_POLICY' as const, documentVersion: 'privacy-v1' },
    ] as const,
    session: sessionMaterial('login'),
  };
}

describe('StoreAuthRepository', () => {
  it('atomically creates a CUSTOMER identity, profile, ordered consents and WECHAT session', async () => {
    const input = loginInput();
    let storedAccount: ReturnType<typeof accountRecord> | null = null;
    let storedCustomer: ReturnType<typeof customerRecord> | null = null;
    const createdSession = sessionRecord(
      accountRecord(input.accountId, input.openId, null),
      input.session,
    );
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      account: {
        findUnique: vi.fn(async () => storedAccount === null
          ? null
          : { ...storedAccount, customer_profile: storedCustomer }),
        create: vi.fn(async ({ data }) => {
          storedAccount = accountRecord(data.id, data.wechat_open_id, null, data);
          return storedAccount;
        }),
        update: vi.fn(async ({ data }) => {
          storedAccount = {
            ...(storedAccount as ReturnType<typeof accountRecord>),
            ...data,
            customer_profile: storedCustomer,
          };
          return storedAccount;
        }),
      },
      customerProfile: {
        create: vi.fn(async ({ data }) => {
          storedCustomer = customerRecord(data.id, data.account_id, data);
          return storedCustomer;
        }),
      },
      consentRecord: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      authSession: { create: vi.fn().mockResolvedValue(createdSession) },
    } as unknown as DatabaseTransaction;
    const repository = new StoreAuthRepository({} as PrismaClient, () => NOW);

    const resolved = await repository.resolveCustomerInTransaction(transaction, input);
    expect(resolved).toMatchObject({
      accountId: input.accountId,
      customerId: input.customerId,
      created: true,
    });
    await expect(repository.createLoginSessionInTransaction(transaction, {
      accountId: resolved.accountId,
      customerId: resolved.customerId,
      sourceTerminal: input.sourceTerminal,
      consents: input.consents,
      session: input.session,
    })).resolves.toMatchObject({ session: createdSession });
    expect(transaction.$queryRawUnsafe).toHaveBeenCalledTimes(6);
    expect(transaction.account.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        role: 'CUSTOMER',
        status: 'ACTIVE',
        wechat_open_id: input.openId,
      }),
    }));
    expect(transaction.consentRecord.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ accepted: true, consent_type: 'USER_AGREEMENT' }),
        expect.objectContaining({ accepted: true, consent_type: 'PRIVACY_POLICY' }),
      ],
    });
    expect(transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assurance: 'WECHAT',
        restriction: 'NONE',
        mfa_factor_id: null,
        mfa_verified_at: null,
      }),
    });
  });

  it('reuses one active CUSTOMER profile and refuses a cross-role identity', async () => {
    const input = loginInput();
    const existingCustomer = customerRecord(generateUlid(NOW.getTime()), generateUlid(NOW.getTime()));
    const existingAccount = accountRecord(existingCustomer.account_id, input.openId, existingCustomer);
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      account: {
        findUnique: vi.fn()
          .mockResolvedValueOnce({ id: existingAccount.id })
          .mockResolvedValueOnce(existingAccount)
          .mockResolvedValue(existingAccount),
        create: vi.fn(),
        update: vi.fn().mockResolvedValue(existingAccount),
      },
      customerProfile: { create: vi.fn() },
      consentRecord: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
      authSession: {
        create: vi.fn().mockResolvedValue(sessionRecord(existingAccount, input.session)),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreAuthRepository({} as PrismaClient, () => NOW);

    const resolved = await repository.resolveCustomerInTransaction(transaction, input);
    expect(resolved).toMatchObject({
      accountId: existingAccount.id,
      customerId: existingCustomer.id,
      created: false,
    });
    await expect(repository.createLoginSessionInTransaction(transaction, {
      accountId: resolved.accountId,
      customerId: resolved.customerId,
      sourceTerminal: input.sourceTerminal,
      consents: input.consents,
      session: input.session,
    })).resolves.toMatchObject({ accountId: existingAccount.id });
    expect(transaction.account.create).not.toHaveBeenCalled();
    expect(transaction.customerProfile.create).not.toHaveBeenCalled();

    const admin = accountRecord(existingAccount.id, input.openId, existingCustomer, { role: 'SUPER_ADMIN' });
    vi.mocked(transaction.account.findUnique)
      .mockReset()
      .mockResolvedValueOnce({ id: admin.id } as never)
      .mockResolvedValueOnce(admin as never);
    await expect(repository.resolveCustomerInTransaction(transaction, input))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('locates refresh actors only for CUSTOMER WECHAT sessions', async () => {
    const accountId = generateUlid(NOW.getTime());
    const customer = customerRecord(generateUlid(NOW.getTime()), accountId);
    const account = accountRecord(accountId, 'openid', customer);
    const material = sessionMaterial('actor');
    const findMany = vi.fn().mockResolvedValue([sessionRecord(account, material)]);
    const repository = new StoreAuthRepository({ authSession: { findMany } } as unknown as PrismaClient, () => NOW);

    await expect(repository.findRefreshActor([material.refreshTokenHash])).resolves.toBe(accountId);
    findMany.mockResolvedValueOnce([sessionRecord(
      accountRecord(accountId, 'openid', customer, { role: 'SUPER_ADMIN' }),
      material,
      { assurance: 'MFA' },
    )]);
    await expect(repository.findRefreshActor([material.refreshTokenHash])).resolves.toBeNull();
  });

  it('rotates a live refresh session in the same family', async () => {
    const accountId = generateUlid(NOW.getTime());
    const customer = customerRecord(generateUlid(NOW.getTime()), accountId);
    const account = accountRecord(accountId, 'openid', customer);
    const sourceMaterial = sessionMaterial('source');
    const source = sessionRecord(account, sourceMaterial, { rotation_counter: 3 });
    const next = sessionMaterial('next', sourceMaterial.sessionFamily);
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      authSession: {
        findMany: vi.fn().mockResolvedValue([source]),
        findUnique: vi.fn().mockResolvedValue(source),
        update: vi.fn().mockResolvedValue({ ...source, revoked_at: NOW }),
        updateMany: vi.fn(),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreAuthRepository({} as PrismaClient, () => NOW);

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: [sourceMaterial.refreshTokenHash],
      session: next,
    })).resolves.toEqual({
      kind: 'rotated',
      rotationCounter: 4,
      sessionFamily: sourceMaterial.sessionFamily,
      sessionId: next.id,
    });
    expect(transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assurance: 'WECHAT',
        rotation_counter: 4,
        session_family: sourceMaterial.sessionFamily,
      }),
    });
  });

  it('revokes the entire Store family when a revoked refresh token is replayed', async () => {
    const accountId = generateUlid(NOW.getTime());
    const customer = customerRecord(generateUlid(NOW.getTime()), accountId);
    const account = accountRecord(accountId, 'openid', customer);
    const sourceMaterial = sessionMaterial('replayed');
    const source = sessionRecord(account, sourceMaterial, { revoked_at: new Date(NOW.getTime() - 1_000) });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      authSession: {
        findMany: vi.fn().mockResolvedValue([source]),
        findUnique: vi.fn().mockResolvedValue(source),
        updateMany,
        update: vi.fn(),
        create: vi.fn(),
      },
    } as unknown as DatabaseTransaction;
    const repository = new StoreAuthRepository({} as PrismaClient, () => NOW);

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: [sourceMaterial.refreshTokenHash],
      session: sessionMaterial('must-not-exist', sourceMaterial.sessionFamily),
    })).resolves.toEqual({ kind: 'replay_detected', sessionFamily: sourceMaterial.sessionFamily });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ assurance: 'WECHAT', session_family: sourceMaterial.sessionFamily }),
    }));
    expect(transaction.authSession.create).not.toHaveBeenCalled();
  });

  it('validates the current Store session and revokes only its session family', async () => {
    const accountId = generateUlid(NOW.getTime());
    const customer = customerRecord(generateUlid(NOW.getTime()), accountId, { version: 4 });
    const account = accountRecord(accountId, 'openid', customer, { version: 3 });
    const material = sessionMaterial('current');
    const stored = sessionRecord(account, material);
    const findUnique = vi.fn().mockResolvedValue(stored);
    const repository = new StoreAuthRepository({
      authSession: { findUnique },
    } as unknown as PrismaClient, () => NOW);

    await expect(repository.getCurrentSession({
      sessionId: material.id,
      accessJti: material.accessJti,
    })).resolves.toMatchObject({
      accountId,
      accountVersion: 3,
      customerId: customer.id,
      customerVersion: 4,
      sessionFamily: material.sessionFamily,
    });

    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      authSession: { findUnique: vi.fn().mockResolvedValue(stored), updateMany },
    } as unknown as DatabaseTransaction;
    await expect(repository.revokeCurrentSessionInTransaction(transaction, {
      accountId,
      sessionFamily: material.sessionFamily,
      sessionId: material.id,
    })).resolves.toEqual({ revoked: true });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        account_id: accountId,
        assurance: 'WECHAT',
        revoked_at: null,
        session_family: material.sessionFamily,
      },
    }));
  });
});
