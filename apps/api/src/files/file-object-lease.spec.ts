import { ApplicationError } from '@qingxu/platform-core';
import { FILE_OBJECT_LEASE_TTL_MS, fileObjectLeaseKey } from '@qingxu/storage';
import { describe, expect, it, vi } from 'vitest';

import { FileObjectLeaseManager } from './file-object-lease';
import type { ApiRedisClient } from '../platform/redis/api-redis-runtime';

const fileId = '01J00000000000000000000000';

function manager(...results: unknown[]) {
  const evaluate = vi.fn();
  for (const result of results) evaluate.mockResolvedValueOnce(result);
  return { evaluate, leases: new FileObjectLeaseManager({ eval: evaluate } as unknown as ApiRedisClient) };
}

describe('FileObjectLeaseManager', () => {
  it('uses one owner token for claim, renewal and compare-delete release', async () => {
    const fixture = manager(1, 1, 1);
    const lease = await fixture.leases.acquire(fileId);
    await lease.assertOwned();
    await lease.release();
    const claim = fixture.evaluate.mock.calls[0]?.[1] as { arguments: string[]; keys: string[] };
    const renewal = fixture.evaluate.mock.calls[1]?.[1] as { arguments: string[]; keys: string[] };
    const release = fixture.evaluate.mock.calls[2]?.[1] as { arguments: string[]; keys: string[] };
    expect(claim.keys).toEqual([fileObjectLeaseKey(fileId)]);
    expect(claim.arguments[1]).toBe(String(FILE_OBJECT_LEASE_TTL_MS));
    expect(renewal.arguments).toEqual([claim.arguments[0], String(FILE_OBJECT_LEASE_TTL_MS)]);
    expect(release.arguments).toEqual([claim.arguments[0]]);
  });

  it('rejects concurrent work and a lease lost during object I/O', async () => {
    await expect(manager(0).leases.acquire(fileId)).rejects.toMatchObject(
      { code: 'STATE_CONFLICT' } satisfies Partial<ApplicationError>,
    );
    const fixture = manager(1, 0, 1);
    const lease = await fixture.leases.acquire(fileId);
    await expect(lease.assertOwned()).rejects.toMatchObject(
      { code: 'STATE_CONFLICT' } satisfies Partial<ApplicationError>,
    );
    await lease.release();
  });

  it('renews ownership in the background while a multi-request storage operation is running', async () => {
    vi.useFakeTimers();
    try {
      const fixture = manager(1, 1, 1);
      const lease = await fixture.leases.acquire(fileId);
      await vi.advanceTimersByTimeAsync(Math.floor(FILE_OBJECT_LEASE_TTL_MS / 3));
      expect(fixture.evaluate).toHaveBeenCalledTimes(2);
      const claim = fixture.evaluate.mock.calls[0]?.[1] as { arguments: string[] };
      const heartbeat = fixture.evaluate.mock.calls[1]?.[1] as { arguments: string[] };
      expect(heartbeat.arguments).toEqual([claim.arguments[0], String(FILE_OBJECT_LEASE_TTL_MS)]);
      await lease.release();
    } finally {
      vi.useRealTimers();
    }
  });
});
