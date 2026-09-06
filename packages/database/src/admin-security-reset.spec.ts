import { describe, expect, it, vi } from 'vitest';

import { AdminAuthRepository } from './admin-auth.repository';

const TARGET = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const REQUESTER = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

function transaction() {
  const accounts = new Map([
    [TARGET, { id: TARGET, role: 'SUPER_ADMIN', status: 'ACTIVE', deleted_at: null, password_hash: 'hash', login_name: 'target', version: 7 }],
    [REQUESTER, { id: REQUESTER, role: 'SUPER_ADMIN', status: 'ACTIVE', deleted_at: null, password_hash: 'hash', login_name: 'requester', version: 3 }],
  ]);
  return {
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    account: { findUnique: vi.fn(async ({ where: { id } }: { where: { id: string } }) => accounts.get(id) ?? null) },
    adminOfflineRecovery: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data) },
  } as never;
}

describe('HR-15 offline recovery guard', () => {
  it('freezes the target account version when creating a request', async () => {
    const tx = transaction();
    const result = await new AdminAuthRepository({} as never).createOfflineRecoveryInTransaction(tx, {
      recoveryId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', targetAccountId: TARGET, requestedById: REQUESTER,
      reason: 'lost credentials', expiresAt: new Date(Date.now() + 60_000),
    });
    expect(result).toMatchObject({ targetAccountId: TARGET, requestedById: REQUESTER, targetAccountVersion: 7, status: 'PENDING_APPROVAL' });
  });

  it('rejects a self-request before writing a recovery record', async () => {
    const tx = transaction();
    await expect(new AdminAuthRepository({} as never).createOfflineRecoveryInTransaction(tx, {
      recoveryId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', targetAccountId: TARGET, requestedById: TARGET,
      reason: 'lost credentials', expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
