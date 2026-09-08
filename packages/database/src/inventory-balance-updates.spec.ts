import { describe, expect, it, vi } from 'vitest';

import type { DatabaseTransaction } from './idempotency.repository';
import { applyInventoryBalanceUpdatesInTransaction } from './inventory-balance-updates';

const occurredAt = new Date('2026-08-29T10:00:00.000Z');
const balanceId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const skuId = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const update = {
  id: balanceId,
  lockedAfter: 0,
  lockedQty: 1,
  physicalAfter: 6,
  physicalQty: 7,
  skuId,
  version: 5,
};

describe('applyInventoryBalanceUpdatesInTransaction', () => {
  it('skips empty batches', async () => {
    const queryRaw = vi.fn();
    await applyInventoryBalanceUpdatesInTransaction(
      { $queryRaw: queryRaw } as unknown as DatabaseTransaction,
      [],
      occurredAt,
      () => {
        throw new Error('empty batches must not mismatch');
      },
    );
    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('issues one optimistic bulk update with lock predicates', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ id: balanceId }]);
    await applyInventoryBalanceUpdatesInTransaction(
      { $queryRaw: queryRaw } as unknown as DatabaseTransaction,
      [update],
      occurredAt,
      () => {
        throw new Error('unexpected mismatch');
      },
    );
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const sql = queryRaw.mock.calls[0]?.[0] as { strings?: readonly string[]; values?: unknown[] };
    expect(sql.strings?.join(' ')).toContain('UPDATE public.inventory_balance');
    expect(sql.strings?.join(' ')).toContain('RETURNING balance.id');
    expect(sql.values).toEqual([occurredAt, balanceId, skuId, 5, 1, 7, 0, 6]);
  });

  it('fails closed when the locked row count does not match', async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await expect(applyInventoryBalanceUpdatesInTransaction(
      { $queryRaw: queryRaw } as unknown as DatabaseTransaction,
      [update],
      occurredAt,
      () => {
        throw new Error('inventory mismatch');
      },
    )).rejects.toThrow('inventory mismatch');
  });
});
