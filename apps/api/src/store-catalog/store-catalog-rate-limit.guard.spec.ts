import {
  Controller,
  type ExecutionContext,
  Get,
  type INestApplication,
  UseGuards,
} from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, hashIpAddress } from '@qingxu/platform-core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { configureApi } from '../platform/http/configure-api';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { StoreCatalogRateLimitGuard } from './store-catalog-rate-limit.guard';

const IP_ADDRESS = '203.0.113.42';
const IP_HASH_KEY = Buffer.alloc(32, 0x61);

interface FixtureOptions {
  ipAddress?: string;
  ready?: boolean;
  results?: readonly unknown[];
}

@Controller('store-rate-limit-probe')
@UseGuards(StoreCatalogRateLimitGuard)
class StoreRateLimitProbeController {
  @Get()
  probe(): { accepted: true } {
    return { accepted: true };
  }
}

function fixture(options: FixtureOptions = {}) {
  const evaluate = vi.fn();
  for (const result of options.results ?? [[1, 60]]) evaluate.mockResolvedValueOnce(result);
  const config = { encryption: { ipHashKey: IP_HASH_KEY } } as PlatformRuntimeConfig;
  const redis = {
    eval: evaluate,
    isReady: options.ready ?? true,
  } as unknown as ApiRedisClient;
  const setHeader = vi.fn();
  const request = { ip: options.ipAddress ?? IP_ADDRESS, url: '/api/v1/store/home' };
  const response = { setHeader };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return {
    context,
    evaluate,
    guard: new StoreCatalogRateLimitGuard(config, redis),
    request,
    setHeader,
  };
}

describe('StoreCatalogRateLimitGuard', () => {
  it('shares one HMAC source key across all five public catalog routes', async () => {
    const current = fixture({ results: [[1, 60], [2, 60], [3, 60], [4, 60], [5, 60]] });

    for (const url of [
      '/api/v1/store/home',
      '/api/v1/store/categories',
      '/api/v1/store/brands',
      '/api/v1/store/products',
      '/api/v1/store/products/01ARZ3NDEKTSV4RRFFQ69G5FAV',
    ]) {
      current.request.url = url;
      await expect(current.guard.canActivate(current.context)).resolves.toBe(true);
    }

    const keys = current.evaluate.mock.calls.map((call) => (call[1] as { keys: string[] }).keys[0]);
    const expectedKey = `qingxu:store-catalog:rate-limit:source:${hashIpAddress(IP_ADDRESS, IP_HASH_KEY)}`;
    expect(new Set(keys)).toEqual(new Set([expectedKey]));
    expect(expectedKey).not.toContain(IP_ADDRESS);
    expect((current.evaluate.mock.calls[0]?.[1] as { arguments: string[] }).arguments).toEqual(['60']);
    const script = current.evaluate.mock.calls[0]?.[0] as string;
    expect(script).toContain("redis.call('TIME')");
    expect(script).toContain("redis.call('EXPIREAT'");
  });

  it('allows the 120th request and rejects the next request', async () => {
    const current = fixture({ results: [[120, 8], [121, 8]] });

    await expect(current.guard.canActivate(current.context)).resolves.toBe(true);
    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    } satisfies Partial<ApplicationError>);
    expect(current.setHeader).toHaveBeenCalledOnce();
    expect(current.setHeader).toHaveBeenCalledWith('Retry-After', '8');
  });

  it('shares one quota between native and IPv4-mapped forms of the same address', async () => {
    const current = fixture({ ipAddress: IP_ADDRESS, results: [[1, 60], [2, 60]] });

    await expect(current.guard.canActivate(current.context)).resolves.toBe(true);
    current.request.ip = `::ffff:${IP_ADDRESS}`;
    await expect(current.guard.canActivate(current.context)).resolves.toBe(true);

    const keys = current.evaluate.mock.calls.map((call) => (call[1] as { keys: string[] }).keys[0]);
    expect(new Set(keys)).toEqual(new Set([
      `qingxu:store-catalog:rate-limit:source:${hashIpAddress(IP_ADDRESS, IP_HASH_KEY)}`,
    ]));
  });

  it.each([1, 31, 60])('returns the Redis window remainder as Retry-After=%i', async (seconds) => {
    const current = fixture({ results: [[121, seconds]] });

    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    expect(current.setHeader).toHaveBeenCalledWith('Retry-After', String(seconds));
  });

  it('fails closed before evaluation when Redis is not ready', async () => {
    const current = fixture({ ready: false });

    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ApplicationError>);
    expect(current.evaluate).not.toHaveBeenCalled();
  });

  it('fails closed when Redis evaluation fails', async () => {
    const current = fixture({ results: [] });
    current.evaluate.mockRejectedValueOnce(new Error('redis connection detail'));

    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ApplicationError>);
  });

  it.each([
    null,
    [],
    [0, 60],
    [1, 0],
    [1, 61],
    [true, 60],
    ['not-a-count', 60],
  ])('fails closed for an invalid Redis result: %j', async (result) => {
    const current = fixture({ results: [result] });

    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ApplicationError>);
  });

  it('fails closed when no valid source IP is available', async () => {
    const current = fixture({ ipAddress: 'not-an-ip' });

    await expect(current.guard.canActivate(current.context)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
    } satisfies Partial<ApplicationError>);
    expect(current.evaluate).not.toHaveBeenCalled();
  });
});

async function httpFixture(trustedProxyCidrs: readonly string[]) {
  const evaluate = vi.fn().mockResolvedValue([1, 60]);
  const config = { encryption: { ipHashKey: IP_HASH_KEY } } as PlatformRuntimeConfig;
  const redis = { eval: evaluate, isReady: true } as unknown as ApiRedisClient;
  const moduleRef = await Test.createTestingModule({
    controllers: [StoreRateLimitProbeController],
    providers: [
      StoreCatalogRateLimitGuard,
      { provide: API_RUNTIME_CONFIG, useValue: config },
      { provide: API_REDIS_CLIENT, useValue: redis },
    ],
  }).compile();
  const app: INestApplication = moduleRef.createNestApplication({ logger: false });
  configureApi(app, { trustedProxyCidrs });
  await app.init();
  return { app, evaluate };
}

function evaluatedKey(evaluate: ReturnType<typeof vi.fn>, call: number): string {
  const options = evaluate.mock.calls[call]?.[1] as { keys?: unknown } | undefined;
  if (!options || !Array.isArray(options.keys) || typeof options.keys[0] !== 'string') {
    throw new TypeError('Expected a Store rate-limit Redis key');
  }
  return options.keys[0];
}

describe('Store Catalog trusted proxy HTTP boundary', () => {
  it('uses the direct peer and ignores a spoofed forwarding header when no proxy is trusted', async () => {
    const current = await httpFixture([]);
    try {
      await request(current.app.getHttpServer()).get('/api/v1/store-rate-limit-probe').expect(200);
      await request(current.app.getHttpServer())
        .get('/api/v1/store-rate-limit-probe')
        .set('X-Forwarded-For', '203.0.113.42')
        .expect(200);

      expect(evaluatedKey(current.evaluate, 1)).toBe(evaluatedKey(current.evaluate, 0));
      expect(evaluatedKey(current.evaluate, 1))
        .not.toContain(hashIpAddress('203.0.113.42', IP_HASH_KEY));
    } finally {
      await current.app.close();
    }
  });

  it('uses one client address only when the immediate peer is explicitly trusted', async () => {
    const current = await httpFixture(['127.0.0.0/8']);
    try {
      await request(current.app.getHttpServer())
        .get('/api/v1/store-rate-limit-probe')
        .set('X-Forwarded-For', '203.0.113.42')
        .expect(200);

      expect(evaluatedKey(current.evaluate, 0)).toBe(
        `qingxu:store-catalog:rate-limit:source:${hashIpAddress('203.0.113.42', IP_HASH_KEY)}`,
      );
    } finally {
      await current.app.close();
    }
  });

  it('walks a multi-hop chain only across explicitly trusted proxy networks', async () => {
    const current = await httpFixture(['127.0.0.0/8', '10.0.0.0/8']);
    try {
      await request(current.app.getHttpServer())
        .get('/api/v1/store-rate-limit-probe')
        .set('X-Forwarded-For', '198.51.100.23, 10.0.0.7')
        .expect(200);

      expect(evaluatedKey(current.evaluate, 0)).toBe(
        `qingxu:store-catalog:rate-limit:source:${hashIpAddress('198.51.100.23', IP_HASH_KEY)}`,
      );
    } finally {
      await current.app.close();
    }
  });

  it('stops at the nearest untrusted proxy instead of accepting its claimed client', async () => {
    const current = await httpFixture(['127.0.0.0/8']);
    try {
      await request(current.app.getHttpServer())
        .get('/api/v1/store-rate-limit-probe')
        .set('X-Forwarded-For', '203.0.113.42, 10.0.0.7')
        .expect(200);

      expect(evaluatedKey(current.evaluate, 0)).toBe(
        `qingxu:store-catalog:rate-limit:source:${hashIpAddress('10.0.0.7', IP_HASH_KEY)}`,
      );
    } finally {
      await current.app.close();
    }
  });

  it.each([
    ['2001:0DB8:0:0:0:0:0:42', '2001:db8::42'],
    ['::ffff:203.0.113.42', '203.0.113.42'],
  ])(
    'normalizes a trusted-chain numeric IPv6 source %s',
    async (sourceAddress, normalizedAddress) => {
      const current = await httpFixture(['127.0.0.0/8']);
      try {
        await request(current.app.getHttpServer())
          .get('/api/v1/store-rate-limit-probe')
          .set('X-Forwarded-For', sourceAddress)
          .expect(200);

        expect(evaluatedKey(current.evaluate, 0)).toBe(
          `qingxu:store-catalog:rate-limit:source:${hashIpAddress(normalizedAddress, IP_HASH_KEY)}`,
        );
      } finally {
        await current.app.close();
      }
    },
  );
});
