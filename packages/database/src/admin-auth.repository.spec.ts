import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuthRepository, InvalidAdminLoginNameError } from './admin-auth.repository';
import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-08-13T00:00:00.000Z');

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function prismaStub(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    account: {
      findUnique: vi.fn(),
      ...overrides,
    },
    authSession: { findUnique: vi.fn() },
    mfaChallenge: { findUnique: vi.fn() },
    mfaRateLimit: { findUnique: vi.fn() },
  } as unknown as PrismaClient;
}

function transactionStub() {
  return {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    account: {
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockImplementation(({ data }) => Promise.resolve(data)),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    authSession: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    mfaChallenge: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    mfaRateLimit: {
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    totpFactor: {
      count: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    totpRecoveryCode: {
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
  } as unknown as DatabaseTransaction;
}

describe('AdminAuthRepository', () => {
  it('creates the only bootstrap administrator with caller-owned IDs and password hash', async () => {
    const transaction = transactionStub();
    const repository = new AdminAuthRepository(prismaStub(), () => NOW);
    const accountId = generateUlid(NOW.getTime());

    await repository.bootstrapSuperAdminInTransaction(transaction, {
      accountId,
      loginName: 'bootstrap-admin',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$hash-material',
    });

    expect(transaction.$queryRawUnsafe).toHaveBeenCalledOnce();
    expect(transaction.account.count).toHaveBeenCalledWith({ where: { role: 'SUPER_ADMIN' } });
    expect(transaction.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: accountId,
        login_name: 'bootstrap-admin',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
      }),
    });
  });

  it('refuses bootstrap when any super administrator already exists', async () => {
    const transaction = transactionStub();
    vi.mocked(transaction.account.count).mockResolvedValue(1);
    const repository = new AdminAuthRepository(prismaStub(), () => NOW);

    await expect(repository.bootstrapSuperAdminInTransaction(transaction, {
      accountId: generateUlid(NOW.getTime()),
      loginName: 'second-admin',
      passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$hash-material',
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(transaction.account.create).not.toHaveBeenCalled();
  });

  it('returns only the login subject and active factor identity', async () => {
    const accountId = generateUlid();
    const factorId = generateUlid();
    const findUnique = vi.fn().mockResolvedValue({
      id: accountId,
      login_name: 'admin',
      password_hash: 'stored-password-hash-material',
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      version: 4,
      mfa_rate_limits: [],
      totp_factors: [{ id: factorId }],
    });
    const repository = new AdminAuthRepository(prismaStub({ findUnique }), () => NOW);

    await expect(repository.findLoginSubject('admin')).resolves.toEqual({
      id: accountId,
      loginName: 'admin',
      passwordHash: 'stored-password-hash-material',
      status: 'ACTIVE',
      version: 4,
      activeFactorId: factorId,
    });
  });

  it('does not reveal whether a non-admin login name belongs to another role', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: generateUlid(),
      login_name: 'customer',
      password_hash: 'stored-password-hash-material',
      role: 'CUSTOMER',
      status: 'ACTIVE',
      version: 1,
      mfa_rate_limits: [],
      totp_factors: [],
    });
    const repository = new AdminAuthRepository(prismaStub({ findUnique }), () => NOW);
    await expect(repository.findLoginSubject('customer')).resolves.toBeNull();
  });

  it('uses a dedicated invalid-login-name error without conflating storage TypeErrors', async () => {
    const repository = new AdminAuthRepository(prismaStub(), () => NOW);
    await expect(repository.findLoginSubject(' admin ')).rejects.toBeInstanceOf(InvalidAdminLoginNameError);

    const storageError = new TypeError('database adapter failed');
    const findUnique = vi.fn().mockRejectedValue(storageError);
    const failingRepository = new AdminAuthRepository(prismaStub({ findUnique }), () => NOW);
    await expect(failingRepository.findLoginSubject('admin')).rejects.toBe(storageError);
  });

  it('rejects malformed hashes and caller-controlled expired session material before touching storage', async () => {
    const transaction = transactionStub();
    const repository = new AdminAuthRepository(prismaStub(), () => NOW);

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: ['not-a-hash'],
      session: {
        id: generateUlid(),
        accessJti: `access:${generateUlid()}`,
        refreshTokenHash: digest('new'),
        expiresAt: new Date(NOW.getTime() + 60_000),
      },
    })).rejects.toThrow('lowercase SHA-256');

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: [digest('old')],
      session: {
        id: generateUlid(),
        accessJti: `access:${generateUlid()}`,
        refreshTokenHash: digest('new'),
        expiresAt: new Date(NOW.getTime() - 1),
      },
    })).rejects.toThrow('future');
    expect(transaction.authSession.findUnique).not.toHaveBeenCalled();
  });

  it('accepts active secret hash key rings and rejects duplicate candidates', async () => {
    const transaction = transactionStub();
    vi.mocked(transaction.authSession.findMany).mockResolvedValue([]);
    const repository = new AdminAuthRepository(prismaStub(), () => NOW);
    const current = digest('refresh-current');
    const previous = digest('refresh-previous');
    const newSession = {
      id: generateUlid(),
      accessJti: `access:${generateUlid()}`,
      refreshTokenHash: digest('refresh-new'),
      expiresAt: new Date(NOW.getTime() + 60_000),
    };

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: [current, previous],
      session: newSession,
    })).resolves.toEqual({ kind: 'invalid' });
    expect(transaction.authSession.findMany).toHaveBeenCalledWith({
      where: { refresh_token_hash: { in: [current, previous] } },
      take: 2,
    });

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: [current, current],
      session: newSession,
    })).rejects.toThrow('duplicate');
  });

  it('fails closed when the repository clock is invalid', () => {
    expect(() => new AdminAuthRepository(prismaStub(), () => new Date(Number.NaN)))
      .toThrow('clock');
  });
});
