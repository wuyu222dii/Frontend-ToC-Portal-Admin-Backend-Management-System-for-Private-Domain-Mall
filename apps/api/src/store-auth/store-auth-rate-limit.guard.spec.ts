import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { describe, expect, it, vi } from 'vitest';

import type { ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { StoreAuthRateLimitGuard } from './store-auth-rate-limit.guard';

function config(): PlatformRuntimeConfig {
  return {
    encryption: { ipHashKey: Buffer.alloc(32, 7) },
    store: {
      legalRateLimitMax: 120,
      legalRateLimitWindowSeconds: 60,
      loginRateLimitMax: 10,
      loginRateLimitWindowSeconds: 900,
      customerRateLimitMax: 120,
      customerRateLimitWindowSeconds: 60,
    },
  } as PlatformRuntimeConfig;
}

function context(ip = '127.0.0.1') {
  const setHeader = vi.fn();
  const value = {
    getClass: vi.fn(),
    getHandler: vi.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ ip }),
      getResponse: () => ({ setHeader }),
    }),
  } as unknown as ExecutionContext;
  return { context: value, setHeader };
}

function reflector(policy: 'LEGAL' | 'LOGIN'): Reflector {
  return { getAllAndOverride: vi.fn().mockReturnValue(policy) } as unknown as Reflector;
}

function redis(result: unknown): ApiRedisClient {
  return {
    eval: vi.fn().mockResolvedValue(result),
    isReady: true,
  } as unknown as ApiRedisClient;
}

describe('B7.1 Store auth fixed-window rate limiter', () => {
  it('allows the legal limit and rejects the next request with exact Retry-After', async () => {
    const allowedRedis = redis([120, 17]);
    await expect(new StoreAuthRateLimitGuard(reflector('LEGAL'), config(), allowedRedis)
      .canActivate(context().context)).resolves.toBe(true);
    expect(allowedRedis.eval).toHaveBeenCalledWith(expect.any(String), {
      arguments: ['60'],
      keys: [expect.stringMatching(/^qingxu:store-auth:legal:rate-limit:source:[a-f0-9]{64}$/)],
    });

    const blocked = context();
    await expect(new StoreAuthRateLimitGuard(reflector('LEGAL'), config(), redis([121, 17]))
      .canActivate(blocked.context)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(blocked.setHeader).toHaveBeenCalledWith('Retry-After', '17');
  });

  it('uses an independent login namespace and normalizes IPv4-mapped IPv6', async () => {
    const client = redis([10, 899]);
    await new StoreAuthRateLimitGuard(reflector('LOGIN'), config(), client)
      .canActivate(context('::ffff:127.0.0.1').context);
    expect(client.eval).toHaveBeenCalledWith(expect.any(String), {
      arguments: ['900'],
      keys: [expect.stringMatching(/^qingxu:store-auth:login:rate-limit:source:[a-f0-9]{64}$/)],
    });
    expect(JSON.stringify(vi.mocked(client.eval).mock.calls)).not.toContain('127.0.0.1');
  });

  it.each([
    { ready: false, result: [1, 60] },
    { ready: true, result: null },
    { ready: true, result: [1, 0] },
    { ready: true, result: [1, 61] },
  ])('fails closed for unavailable or malformed Redis state %#', async ({ ready, result }) => {
    const client = redis(result);
    Object.defineProperty(client, 'isReady', { value: ready });
    await expect(new StoreAuthRateLimitGuard(reflector('LEGAL'), config(), client)
      .canActivate(context().context)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('fails closed when Redis evaluation throws', async () => {
    const client = redis([1, 60]);
    vi.mocked(client.eval).mockRejectedValue(new Error('redis unavailable'));
    await expect(new StoreAuthRateLimitGuard(reflector('LEGAL'), config(), client)
      .canActivate(context().context)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
