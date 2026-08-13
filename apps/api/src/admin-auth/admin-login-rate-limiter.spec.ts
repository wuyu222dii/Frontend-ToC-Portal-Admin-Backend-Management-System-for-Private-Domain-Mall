import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { AdminLoginRateLimiter } from './admin-login-rate-limiter';
import type { ApiRedisClient } from '../platform/redis/api-redis-runtime';

const idempotencyKey = '00000000-0000-4000-8000-000000000000';

function fixture(...results: unknown[]) {
  const evaluate = vi.fn();
  for (const result of results) evaluate.mockResolvedValueOnce(result);
  const config = {
    encryption: { ipHashKey: Buffer.alloc(32, 1) },
  } as PlatformRuntimeConfig;
  const redis = { eval: evaluate } as unknown as ApiRedisClient;
  return { evaluate, limiter: new AdminLoginRateLimiter(config, redis) };
}

describe('AdminLoginRateLimiter in-flight claims', () => {
  it('allows only the first request to perform password verification', async () => {
    const first = fixture(1);
    const owner = await first.limiter.claimAttempt(idempotencyKey, 'admin.operator', '127.0.0.1');
    expect(owner).toMatch(/^[0-9a-f-]{36}$/);
    expect(first.evaluate).toHaveBeenCalledOnce();
    const options = first.evaluate.mock.calls[0]?.[1] as { arguments: string[]; keys: string[] };
    expect(options.arguments).toEqual([owner, '300000']);
    expect(options.keys).toHaveLength(3);
    expect(options.keys[0]).toBe(`qingxu:admin-login:inflight:${idempotencyKey}`);
    expect(options.keys[1]).toMatch(/^qingxu:admin-login:inflight:subject:[a-f0-9]{64}$/);
    expect(options.keys[2]).toMatch(/^qingxu:admin-login:inflight:source:[a-f0-9]{64}$/);
  });

  it('rejects a concurrent reuse before account lookup or Argon2 work', async () => {
    const concurrent = fixture(0);
    await expect(concurrent.limiter.claimAttempt(idempotencyKey, 'admin.operator', '127.0.0.1')).rejects.toMatchObject({
      code: 'STATE_CONFLICT',
    } satisfies Partial<ApplicationError>);
  });

  it('fails closed when Redis returns an unsupported claim result', async () => {
    const invalid = fixture('unexpected');
    await expect(invalid.limiter.claimAttempt(idempotencyKey, 'admin.operator', '127.0.0.1')).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ApplicationError>);
  });

  it('releases only leases owned by the completed request', async () => {
    const completed = fixture(3);
    const owner = '10000000-0000-4000-8000-000000000000';
    await expect(completed.limiter.releaseAttempt(owner, idempotencyKey, 'admin.operator', '127.0.0.1'))
      .resolves.toBeUndefined();
    const options = completed.evaluate.mock.calls[0]?.[1] as { arguments: string[]; keys: string[] };
    expect(options.arguments).toEqual([owner]);
    expect(options.keys).toHaveLength(3);
  });

  it('serializes unique request keys for the same account and source', async () => {
    const sequential = fixture(1, 0);
    await sequential.limiter.claimAttempt(idempotencyKey, 'admin.operator', '127.0.0.1');
    await expect(sequential.limiter.claimAttempt(
      '10000000-0000-4000-8000-000000000001',
      'admin.operator',
      '127.0.0.1',
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' } satisfies Partial<ApplicationError>);
    const firstKeys = (sequential.evaluate.mock.calls[0]?.[1] as { keys: string[] }).keys;
    const secondKeys = (sequential.evaluate.mock.calls[1]?.[1] as { keys: string[] }).keys;
    expect(firstKeys[0]).not.toBe(secondKeys[0]);
    expect(firstKeys.slice(1)).toEqual(secondKeys.slice(1));
  });
});
