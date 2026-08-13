import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';

import { withSessionAdvisoryLock } from './advisory-lock';

function poolWithClient(client: PoolClient): Pool {
  return { connect: vi.fn(async () => client) } as unknown as Pool;
}

function clientWithQuery(query: (sql: string) => Promise<unknown>): PoolClient {
  return {
    query: vi.fn(query),
    release: vi.fn(),
  } as unknown as PoolClient;
}

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
