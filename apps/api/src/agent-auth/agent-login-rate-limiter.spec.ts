import type { PlatformRuntimeConfig } from '@qingxu/config';
import { describe, expect, it, vi } from 'vitest';

import type { ApiRedisClient } from '../platform/redis/api-redis-runtime';
import { AgentLoginRateLimiter } from './agent-login-rate-limiter';

const KEY = '00000000-0000-4000-8000-000000000000';

function fixture(...results: unknown[]) {
  const evaluate = vi.fn();
  for (const result of results) evaluate.mockResolvedValueOnce(result);
  const config = {
    agent: { loginRateLimitMax: 10, loginRateLimitWindowSeconds: 900 },
    encryption: { ipHashKey: Buffer.alloc(32, 7) },
  } as PlatformRuntimeConfig;
  const redis = { eval: evaluate } as unknown as ApiRedisClient;
  return { evaluate, limiter: new AgentLoginRateLimiter(config, redis) };
}

describe('AgentLoginRateLimiter', () => {
  it('serializes one login across request, subject and source dimensions', async () => {
    const { evaluate, limiter } = fixture(1);
    const owner = await limiter.claimAttempt(KEY, 'Agent.Operator', '127.0.0.1');
    const options = evaluate.mock.calls[0]?.[1] as { arguments: string[]; keys: string[] };
    expect(owner).toMatch(/^[0-9a-f-]{36}$/);
    expect(options.arguments).toEqual([owner, '300000']);
    expect(options.keys[0]).toBe(`qingxu:agent-login:inflight:${KEY}`);
    expect(options.keys[1]).toMatch(/^qingxu:agent-login:inflight:subject:[a-f0-9]{64}$/);
    expect(options.keys[2]).toMatch(/^qingxu:agent-login:inflight:source:[a-f0-9]{64}$/);
  });

  it('rejects a concurrent login before password verification', async () => {
    const { limiter } = fixture(0);
    await expect(limiter.claimAttempt(KEY, 'agent.operator', '127.0.0.1'))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });

  it('checks both the normalized subject and source counters', async () => {
    const { evaluate, limiter } = fixture(0);
    await expect(limiter.assertAllowed('Agent.Operator', '127.0.0.1')).resolves.toBeUndefined();
    const options = evaluate.mock.calls[0]?.[1] as { arguments: string[]; keys: string[] };
    expect(options.arguments).toEqual(['10']);
    expect(options.keys[0]).toMatch(/^qingxu:agent-login:subject:[a-f0-9]{64}$/);
    expect(options.keys[1]).toMatch(/^qingxu:agent-login:source:[a-f0-9]{64}$/);
  });

  it('records one idempotent failure in both dimensions using the configured window', async () => {
    const { evaluate, limiter } = fixture(0);
    await expect(limiter.recordFailure('agent.operator', KEY, '127.0.0.1')).resolves.toBeUndefined();
    const options = evaluate.mock.calls[0]?.[1] as { arguments: string[]; keys: string[] };
    expect(options.arguments).toEqual(['10', '900000', '86400000']);
    expect(options.keys[0]).toBe(`qingxu:agent-login:attempt:${KEY}`);
    expect(options.keys).toHaveLength(3);
  });

  it('fails closed for blocked and malformed Redis results', async () => {
    const blocked = fixture(1);
    await expect(blocked.limiter.assertAllowed('agent.operator', '127.0.0.1'))
      .rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const malformed = fixture('unexpected');
    await expect(malformed.limiter.assertAllowed('agent.operator', '127.0.0.1'))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
