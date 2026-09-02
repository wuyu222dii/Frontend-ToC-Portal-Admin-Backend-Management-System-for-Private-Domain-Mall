import { createHash } from 'node:crypto';

import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  AgentAuthRepository,
  type InitialAgentSessionMaterial,
} from './agent-auth.repository';

const NOW = new Date('2026-09-02T12:00:00.000Z');

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function profile(accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: generateUlid(NOW.getTime()),
    account_id: accountId,
    agent_no: 'AGT-000001',
    name: 'Development Agent',
    contact_name: null,
    contact_phone_ciphertext: null,
    contact_phone_last4: null,
    contact_phone_encryption_key_id: null,
    status: 'ACTIVE',
    product_authorization_mode: 'ALL_ACTIVE_PRODUCTS',
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    ...overrides,
  };
}

function account(accountId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: accountId,
    role: 'AGENT_ADMIN',
    status: 'ACTIVE',
    login_name: 'agent.operator',
    password_hash: '$argon2id$development-password-hash',
    wechat_open_id: null,
    wechat_union_id: null,
    must_change_password: false,
    last_login_at: null,
    version: 3,
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    agent_profile: profile(accountId),
    ...overrides,
  };
}

function material(restriction: 'CHANGE_PASSWORD_ONLY' | 'NONE'): InitialAgentSessionMaterial {
  return {
    id: generateUlid(NOW.getTime()),
    accessJti: `access:${generateUlid(NOW.getTime())}`,
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
    refreshTokenHash: restriction === 'NONE' ? digest('refresh') : null,
    restriction,
    sessionFamily: generateUlid(NOW.getTime()),
  } as InitialAgentSessionMaterial;
}

function sessionRecord(
  owner: ReturnType<typeof account>,
  session: InitialAgentSessionMaterial,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: session.id,
    account_id: owner.id,
    access_jti: session.accessJti,
    refresh_token_hash: session.refreshTokenHash,
    assurance: 'PASSWORD',
    restriction: session.restriction,
    mfa_factor_id: null,
    mfa_verified_at: null,
    session_family: session.sessionFamily,
    rotation_counter: 0,
    expires_at: session.expiresAt,
    revoked_at: null,
    last_seen_at: null,
    created_at: NOW,
    account: owner,
    ...overrides,
  };
}

describe('AgentAuthRepository', () => {
  it('resolves only an active AGENT_ADMIN account/profile login subject', async () => {
    const accountId = generateUlid(NOW.getTime());
    const findUnique = vi.fn().mockResolvedValue(account(accountId));
    const repository = new AgentAuthRepository({ account: { findUnique } } as unknown as PrismaClient, () => NOW);

    await expect(repository.findLoginSubject('agent.operator')).resolves.toMatchObject({
      agentId: expect.any(String),
      id: accountId,
      status: 'ACTIVE',
      version: 3,
    });
    findUnique.mockResolvedValueOnce(account(accountId, { role: 'SUPER_ADMIN' }));
    await expect(repository.findLoginSubject('agent.operator')).resolves.toBeNull();
    findUnique.mockResolvedValueOnce(account(accountId, {
      agent_profile: profile(accountId, { status: 'DISABLED' }),
    }));
    await expect(repository.findLoginSubject('agent.operator')).resolves.toMatchObject({ status: 'DISABLED' });
  });

  it('creates a temporary-password session without any refresh hash', async () => {
    const accountId = generateUlid(NOW.getTime());
    const owner = account(accountId, { must_change_password: true });
    const restricted = material('CHANGE_PASSWORD_ONLY');
    const stored = sessionRecord(owner, restricted);
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      account: {
        findUnique: vi.fn().mockResolvedValue(owner),
        update: vi.fn().mockResolvedValue(owner),
      },
      authSession: { create: vi.fn().mockResolvedValue(stored) },
    } as unknown as DatabaseTransaction;
    const repository = new AgentAuthRepository({} as PrismaClient, () => NOW);

    await expect(repository.createLoginSessionInTransaction(transaction, {
      accountId,
      expectedMustChangePassword: true,
      expectedPasswordHash: owner.password_hash,
      expectedVersion: owner.version,
      session: restricted,
    })).resolves.toMatchObject({ restriction: 'CHANGE_PASSWORD_ONLY', session: stored });
    expect(transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assurance: 'PASSWORD',
        refresh_token_hash: null,
        restriction: 'CHANGE_PASSWORD_ONLY',
      }),
    });
  });

  it('rotates a regular refresh token in-family and revokes the prior session', async () => {
    const accountId = generateUlid(NOW.getTime());
    const owner = account(accountId);
    const sourceMaterial = material('NONE');
    const source = sessionRecord(owner, sourceMaterial, { rotation_counter: 4 });
    const nextMaterial = material('NONE');
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      authSession: {
        findMany: vi.fn().mockResolvedValue([source]),
        findUnique: vi.fn().mockResolvedValue(source),
        update: vi.fn().mockResolvedValue(source),
        updateMany: vi.fn(),
        create: vi.fn().mockResolvedValue({}),
      },
    } as unknown as DatabaseTransaction;
    const repository = new AgentAuthRepository({} as PrismaClient, () => NOW);

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: [sourceMaterial.refreshTokenHash as string],
      session: {
        id: nextMaterial.id,
        accessJti: nextMaterial.accessJti,
        expiresAt: nextMaterial.expiresAt,
        refreshTokenHash: nextMaterial.refreshTokenHash as string,
      },
    })).resolves.toEqual({
      kind: 'rotated',
      rotationCounter: 5,
      sessionFamily: sourceMaterial.sessionFamily,
      sessionId: nextMaterial.id,
    });
    expect(transaction.authSession.update).toHaveBeenCalledWith({
      where: { id: source.id },
      data: { last_seen_at: NOW, revoked_at: NOW },
    });
    expect(transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        assurance: 'PASSWORD',
        restriction: 'NONE',
        rotation_counter: 5,
        session_family: sourceMaterial.sessionFamily,
      }),
    });
  });

  it('treats a revoked refresh token as replay and revokes the entire live family', async () => {
    const accountId = generateUlid(NOW.getTime());
    const owner = account(accountId);
    const sourceMaterial = material('NONE');
    const source = sessionRecord(owner, sourceMaterial, { revoked_at: new Date(NOW.getTime() - 1_000) });
    const nextMaterial = material('NONE');
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      authSession: {
        findMany: vi.fn().mockResolvedValue([source]),
        findUnique: vi.fn().mockResolvedValue(source),
        updateMany,
      },
    } as unknown as DatabaseTransaction;
    const repository = new AgentAuthRepository({} as PrismaClient, () => NOW);

    await expect(repository.rotateRefreshInTransaction(transaction, {
      presentedRefreshTokenHashCandidates: [sourceMaterial.refreshTokenHash as string],
      session: {
        id: nextMaterial.id,
        accessJti: nextMaterial.accessJti,
        expiresAt: nextMaterial.expiresAt,
        refreshTokenHash: nextMaterial.refreshTokenHash as string,
      },
    })).resolves.toEqual({ kind: 'replay_detected', sessionFamily: sourceMaterial.sessionFamily });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        account_id: accountId,
        assurance: 'PASSWORD',
        revoked_at: null,
        session_family: sourceMaterial.sessionFamily,
      },
      data: { last_seen_at: NOW, revoked_at: NOW },
    });
  });

  it('accepts only a live PASSWORD session whose restriction matches must_change_password', async () => {
    const accountId = generateUlid(NOW.getTime());
    const owner = account(accountId);
    const regular = material('NONE');
    const findUnique = vi.fn().mockResolvedValue(sessionRecord(owner, regular));
    const repository = new AgentAuthRepository({
      authSession: { findUnique },
    } as unknown as PrismaClient, () => NOW);

    await expect(repository.getCurrentSession({
      sessionId: regular.id,
      accessJti: regular.accessJti,
    })).resolves.toMatchObject({
      accountId,
      agentId: owner.agent_profile.id,
      restriction: 'NONE',
      sessionId: regular.id,
    });
    findUnique.mockResolvedValueOnce(sessionRecord(
      account(accountId, { must_change_password: true }),
      regular,
    ));
    await expect(repository.getCurrentSession({
      sessionId: regular.id,
      accessJti: regular.accessJti,
    })).resolves.toBeNull();
  });

  it('atomically consumes a restricted session and creates the first regular session', async () => {
    const accountId = generateUlid(NOW.getTime());
    const owner = account(accountId, { must_change_password: true });
    const restricted = material('CHANGE_PASSWORD_ONLY');
    const current = sessionRecord(owner, restricted);
    const next = material('NONE') as InitialAgentSessionMaterial & {
      refreshTokenHash: string;
      restriction: 'NONE';
    };
    const transaction = {
      $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
      account: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      authSession: {
        findUnique: vi.fn().mockResolvedValue(current),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue(sessionRecord(
          account(accountId, { must_change_password: false, version: 4 }),
          next,
        )),
      },
    } as unknown as DatabaseTransaction;
    const repository = new AgentAuthRepository({} as PrismaClient, () => NOW);

    await expect(repository.changeTemporaryPasswordInTransaction(transaction, {
      accountId,
      currentSessionId: restricted.id,
      expectedPasswordHash: owner.password_hash,
      expectedVersion: owner.version,
      newPasswordHash: '$argon2id$new-development-password',
      session: next,
    })).resolves.toMatchObject({ version: 4 });
    expect(transaction.account.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ must_change_password: true, version: 3 }),
      data: expect.objectContaining({ must_change_password: false, version: { increment: 1 } }),
    });
    expect(transaction.authSession.updateMany).toHaveBeenCalledWith({
      where: { account_id: accountId, assurance: 'PASSWORD', revoked_at: null },
      data: { last_seen_at: NOW, revoked_at: NOW },
    });
    expect(transaction.authSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ refresh_token_hash: next.refreshTokenHash, restriction: 'NONE' }),
    });
  });
});
