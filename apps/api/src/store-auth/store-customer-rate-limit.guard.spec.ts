import { createHmac } from 'node:crypto';

import type { ExecutionContext } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import type { CurrentStoreSession } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { StoreCustomerRateLimitGuard } from './store-customer-rate-limit.guard';

const CUSTOMER_ID = '01J00000000000000000000001';
const OTHER_CUSTOMER_ID = '01J00000000000000000000002';
const IP_ADDRESS = '203.0.113.42';
const IP_HASH_KEY = Buffer.alloc(32, 0x61);
const HMAC_DOMAIN = 'qingxu:store-customer-rate-limit:v1';

function config(overrides: {
  ipHashKey?: Buffer;
  limit?: number;
  windowSeconds?: number;
} = {}): PlatformRuntimeConfig {
  return {
    encryption: { ipHashKey: overrides.ipHashKey ?? IP_HASH_KEY },
    store: {
      customerRateLimitMax: overrides.limit ?? 120,
      customerRateLimitWindowSeconds: overrides.windowSeconds ?? 60,
    },
  } as PlatformRuntimeConfig;
}

function session(customerId = CUSTOMER_ID): CurrentStoreSession {
  return { customerId } as CurrentStoreSession;
}

function redis(results: readonly unknown[] = [[1, 60]], ready = true): ApiRedisClient {
  const evaluate = vi.fn();
  for (const result of results) evaluate.mockResolvedValueOnce(result);
  return { eval: evaluate, isReady: ready } as unknown as ApiRedisClient;
}

function fixture(options: {
  config?: PlatformRuntimeConfig;
  customerId?: string;
  ip?: string | undefined;
  redis?: ApiRedisClient;
  session?: CurrentStoreSession | undefined;
  url?: string;
} = {}) {
  const client = options.redis ?? redis();
  const setHeader = vi.fn();
  const request = {
    ip: options.ip ?? IP_ADDRESS,
    storeSession: options.session ?? session(options.customerId),
    url: options.url ?? '/api/v1/store/favorites',
  };
  const response = { setHeader };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return {
    client,
    context,
    guard: new StoreCustomerRateLimitGuard(options.config ?? config(), client),
    request,
    setHeader,
  };
}

function evaluatedKeys(client: ApiRedisClient): string[] {
  return vi.mocked(client.eval).mock.calls.map((call) => {
    return (call[1] as { keys: string[] }).keys[0] as string;
  });
}

function expectedKey(customerId: string, ipAddress: string): string {
  const digest = createHmac('sha256', IP_HASH_KEY)
    .update(HMAC_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(customerId, 'utf8')
    .update('\0', 'utf8')
    .update(ipAddress, 'utf8')
    .digest('hex');
  return `qingxu:store-customer:rate-limit:subject:${digest}`;
}

describe('B8 Store customer fixed-window rate limiter', () => {
  it('shares one domain-separated HMAC quota across protected Store routes', async () => {
    const current = fixture({ redis: redis([[1, 60], [2, 60], [3, 60], [4, 60]]) });
    for (const url of [
      '/api/v1/store/favorites',
      `/api/v1/store/favorites/${CUSTOMER_ID}`,
      '/api/v1/store/cart',
      '/api/v1/store/addresses',
    ]) {
      current.request.url = url;
      await expect(current.guard.canActivate(current.context)).resolves.toBe(true);
    }

    expect(new Set(evaluatedKeys(current.client))).toEqual(new Set([expectedKey(CUSTOMER_ID, IP_ADDRESS)]));
    expect(vi.mocked(current.client.eval)).toHaveBeenCalledWith(expect.stringContaining("redis.call('TIME')"), {
      arguments: ['60'],
      keys: [expectedKey(CUSTOMER_ID, IP_ADDRESS)],
    });
    const serialized = JSON.stringify(vi.mocked(current.client.eval).mock.calls);
    expect(serialized).not.toContain(CUSTOMER_ID);
    expect(serialized).not.toContain(IP_ADDRESS);
  });

  it('isolates the quota when either CUSTOMER or source IP changes', async () => {
    const current = fixture({ redis: redis([[1, 60], [1, 60], [1, 60]]) });
    await current.guard.canActivate(current.context);
    current.request.storeSession = session(OTHER_CUSTOMER_ID);
    await current.guard.canActivate(current.context);
    current.request.ip = '198.51.100.23';
    await current.guard.canActivate(current.context);

    expect(new Set(evaluatedKeys(current.client)).size).toBe(3);
  });

  it.each([
    ['2001:0DB8:0:0:0:0:0:42', '2001:db8::42'],
    ['::ffff:203.0.113.42', '203.0.113.42'],
  ])('canonicalizes %s to the same quota as %s', async (source, canonical) => {
    const current = fixture({ ip: source, redis: redis([[1, 60], [2, 60]]) });
    await current.guard.canActivate(current.context);
    current.request.ip = canonical;
    await current.guard.canActivate(current.context);
    expect(new Set(evaluatedKeys(current.client)).size).toBe(1);
  });

  it('uses configured limits and returns the Redis window remainder as Retry-After', async () => {
    const current = fixture({
      config: config({ limit: 2, windowSeconds: 30 }),
      redis: redis([[2, 17], [3, 17]]),
    });
    await expect(current.guard.canActivate(current.context)).resolves.toBe(true);
    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    } satisfies Partial<ApplicationError>);
    expect(current.setHeader).toHaveBeenCalledOnce();
    expect(current.setHeader).toHaveBeenCalledWith('Retry-After', '17');
    expect(vi.mocked(current.client.eval)).toHaveBeenCalledWith(expect.any(String), {
      arguments: ['30'],
      keys: [expect.stringMatching(/^qingxu:store-customer:rate-limit:subject:[a-f0-9]{64}$/)],
    });
  });

  it.each([1, 31, 60])('returns accurate Retry-After=%i', async (seconds) => {
    const current = fixture({ redis: redis([[121, seconds]]) });
    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(current.setHeader).toHaveBeenCalledWith('Retry-After', String(seconds));
  });

  it.each([
    ['missing session', { session: undefined }],
    ['invalid CUSTOMER', { customerId: 'not-a-customer' }],
    ['missing IP', { ip: undefined }],
    ['invalid IP', { ip: 'not-an-ip' }],
  ] as const)('fails closed for %s', async (_label, options) => {
    const current = fixture(options);
    if ('session' in options && options.session === undefined) delete (current.request as { storeSession?: unknown }).storeSession;
    if ('ip' in options && options.ip === undefined) delete (current.request as { ip?: unknown }).ip;
    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(current.client.eval).not.toHaveBeenCalled();
  });

  it.each([
    ['missing config', undefined, redis()],
    ['short HMAC key', config({ ipHashKey: Buffer.alloc(8) }), redis()],
    ['invalid limit', config({ limit: 0 }), redis()],
    ['invalid window', config({ windowSeconds: 0 }), redis()],
    ['missing Redis', config(), undefined],
    ['Redis not ready', config(), redis([[1, 60]], false)],
  ] as const)('fails closed for %s', async (_label, runtimeConfig, client) => {
    const current = fixture();
    const guard = new StoreCustomerRateLimitGuard(runtimeConfig, client);
    await expect(guard.canActivate(current.context)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    if (client) expect(client.eval).not.toHaveBeenCalled();
  });

  it('fails closed when Redis evaluation throws', async () => {
    const client = redis([]);
    vi.mocked(client.eval).mockRejectedValueOnce(new Error('redis unavailable'));
    const current = fixture({ redis: client });
    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it.each([
    null,
    [],
    [1, 60, 3],
    [0, 60],
    [1, 0],
    [1, 61],
    [1.5, 60],
    [true, 60],
    ['not-a-count', 60],
  ])('fails closed for an invalid Redis result: %j', async (result) => {
    const current = fixture({ redis: redis([result]) });
    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
