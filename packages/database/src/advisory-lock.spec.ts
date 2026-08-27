import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';

import {
  acquireTransactionLock,
  acquireTransactionLocks,
  withSessionAdvisoryLock,
} from './advisory-lock';

function poolWithClient(client: PoolClient): Pool {
  return { connect: vi.fn(async () => client) } as unknown as Pool;
}

function clientWithQuery(query: (sql: string) => Promise<unknown>): PoolClient {
  return {
    query: vi.fn(query),
    release: vi.fn(),
  } as unknown as PoolClient;
}

describe('transaction advisory locks', () => {
  it('keeps the single-lock hash contract unchanged', async () => {
    const transaction = { $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]) };

    await acquireTransactionLock(transaction, 'store-cart-item', ['cart-1', 'sku-1']);

    expect(transaction.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [query, namespace, parts] = transaction.$queryRawUnsafe.mock.calls[0] ?? [];
    expect(query).toContain('jsonb_build_array($1::text, $2::text)::text');
    expect(query).toContain('781930482013421::bigint');
    expect(namespace).toBe('store-cart-item');
    expect(parts).toBe(JSON.stringify(['cart-1', 'sku-1']));
  });

  it('acquires a caller-ordered batch in one query with the identical namespace-parts hash', async () => {
    const transaction = { $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 3 }]) };
    const locks = [
      { namespace: 'product-catalog-sku', parts: ['sku-2'] },
      { namespace: 'product-catalog-sku', parts: ['sku-1'] },
      { namespace: 'store-cart-item', parts: ['cart-1', 'sku-1'] },
    ] as const;

    await acquireTransactionLocks(transaction, locks);

    expect(transaction.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [query, payload] = transaction.$queryRawUnsafe.mock.calls[0] ?? [];
    expect(query).toContain('WITH RECURSIVE requested_locks AS MATERIALIZED');
    expect(query).toContain('requested.position = previous.position + 1');
    expect(query).toContain('jsonb_build_array(requested.namespace, requested.parts)::text');
    expect(query).toContain('781930482013421::bigint');
    expect(JSON.parse(payload as string)).toEqual(locks.map(({ namespace, parts }) => ({
      namespace,
      parts: JSON.stringify(parts),
    })));
  });

  it('does not query PostgreSQL for an empty batch', async () => {
    const transaction = { $queryRawUnsafe: vi.fn() };

    await acquireTransactionLocks(transaction, []);

    expect(transaction.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

describe('withSessionAdvisoryLock', () => {
  it('returns a busy result without executing work when another session owns the lock', async () => {
    const client = clientWithQuery(async () => ({ rows: [{ acquired: false }] }));
    const work = vi.fn(async () => 'unused');

    await expect(withSessionAdvisoryLock(poolWithClient(client), 'outbox', 'event-1', work))
      .resolves.toEqual({ acquired: false });
    expect(work).not.toHaveBeenCalled();
    expect(client.release).toHaveBeenCalledWith(false);
  });

  it('destroys a connection when lock acquisition fails', async () => {
    const failure = new Error('lock query failed');
    const client = clientWithQuery(async () => { throw failure; });

    await expect(withSessionAdvisoryLock(poolWithClient(client), 'outbox', 'event-1', async () => undefined))
      .rejects.toBe(failure);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('preserves a work error and destroys the connection when unlock also fails', async () => {
    const workError = new Error('handler failed');
    let queryCount = 0;
    const client = clientWithQuery(async () => {
      queryCount += 1;
      if (queryCount === 1) return { rows: [{ acquired: true }] };
      throw new Error('unlock failed');
    });

    await expect(withSessionAdvisoryLock(poolWithClient(client), 'outbox', 'event-1', async () => {
      throw workError;
    })).rejects.toBe(workError);
    expect(client.release).toHaveBeenCalledWith(true);
  });

  it('returns the unlock failure and destroys the connection after successful work', async () => {
    const unlockError = new Error('unlock failed');
    let queryCount = 0;
    const client = clientWithQuery(async () => {
      queryCount += 1;
      if (queryCount === 1) return { rows: [{ acquired: true }] };
      throw unlockError;
    });

    await expect(withSessionAdvisoryLock(poolWithClient(client), 'outbox', 'event-1', async () => 'done'))
      .rejects.toBe(unlockError);
    expect(client.release).toHaveBeenCalledWith(true);
  });
});
