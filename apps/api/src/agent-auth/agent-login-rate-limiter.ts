import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, hmacAuthenticationIdentity } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

const INFLIGHT_ATTEMPT_TTL_MILLISECONDS = 5 * 60 * 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CLAIM_SCRIPT = `
for _, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then return 0 end
end
for _, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[1], 'PX', ARGV[2], 'NX')
end
return 1
`;

const RELEASE_CLAIM_SCRIPT = `
local released = 0
for _, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then
    released = released + redis.call('DEL', key)
  end
end
return released
`;

const CHECK_SCRIPT = `
local maximum = tonumber(ARGV[1])
for _, key in ipairs(KEYS) do
  local attempts = tonumber(redis.call('GET', key) or '0')
  if attempts >= maximum then return 1 end
end
return 0
`;

const RECORD_SCRIPT = `
local maximum = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local marker_ttl_ms = tonumber(ARGV[3])
local marker_created = redis.call('SET', KEYS[1], '1', 'PX', marker_ttl_ms, 'NX')
local blocked = 0
for index = 2, #KEYS do
  local key = KEYS[index]
  local attempts
  if marker_created then
    attempts = redis.call('INCR', key)
    if attempts == 1 then redis.call('PEXPIRE', key, window_ms) end
  else
    attempts = tonumber(redis.call('GET', key) or '0')
  end
  if attempts >= maximum then blocked = 1 end
end
return blocked
`;

function binaryResult(value: unknown, label: string): 0 | 1 {
  if (value === 0 || value === '0') return 0;
  if (value === 1 || value === '1') return 1;
  throw new ApplicationError('INTERNAL_ERROR', `Agent login rate limiter returned an invalid ${label} result`);
}

@Injectable()
export class AgentLoginRateLimiter {
  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: ApiRedisClient,
  ) {}

  async claimAttempt(idempotencyKey: string, loginName: string, ipAddress?: string): Promise<string> {
    const owner = randomUUID();
    const result = binaryResult(await this.client().eval(CLAIM_SCRIPT, {
      arguments: [owner, String(INFLIGHT_ATTEMPT_TTL_MILLISECONDS)],
      keys: this.inflightKeys(idempotencyKey, loginName, ipAddress),
    }), 'claim');
    if (result === 1) return owner;
    throw new ApplicationError('STATE_CONFLICT', 'Agent login is already being processed');
  }

  async releaseAttempt(owner: string, idempotencyKey: string, loginName: string, ipAddress?: string): Promise<void> {
    const result = Number(await this.client().eval(RELEASE_CLAIM_SCRIPT, {
      arguments: [owner],
      keys: this.inflightKeys(idempotencyKey, loginName, ipAddress),
    }));
    if (!Number.isSafeInteger(result) || result < 0 || result > 3) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent login rate limiter returned an invalid release result');
    }
  }

  async assertAllowed(loginName: string, ipAddress?: string): Promise<void> {
    const config = this.runtime();
    const blocked = binaryResult(await this.client().eval(CHECK_SCRIPT, {
      arguments: [String(config.agent.loginRateLimitMax)],
      keys: this.keys(loginName, ipAddress),
    }), 'check');
    if (blocked === 1) throw new ApplicationError('RATE_LIMITED', 'Agent login is locked');
  }

  async recordFailure(loginName: string, idempotencyKey: string, ipAddress?: string): Promise<void> {
    const config = this.runtime();
    const windowMilliseconds = config.agent.loginRateLimitWindowSeconds * 1_000;
    const blocked = binaryResult(await this.client().eval(RECORD_SCRIPT, {
      arguments: [
        String(config.agent.loginRateLimitMax),
        String(windowMilliseconds),
        String(Math.max(windowMilliseconds, 24 * 60 * 60 * 1_000)),
      ],
      keys: [this.attemptMarker(idempotencyKey), ...this.keys(loginName, ipAddress)],
    }), 'record');
    if (blocked === 1) throw new ApplicationError('RATE_LIMITED', 'Agent login is locked');
  }

  private client(): ApiRedisClient {
    if (!this.redis || !this.config) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent login rate limiter is unavailable');
    }
    return this.redis;
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Agent login rate limiter is unavailable');
    return this.config;
  }

  private attemptMarker(idempotencyKey: string): string {
    if (!UUID.test(idempotencyKey)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent login rate limiter received an invalid attempt identity');
    }
    return `qingxu:agent-login:attempt:${idempotencyKey.toLowerCase()}`;
  }

  private inflightAttempt(idempotencyKey: string): string {
    if (!UUID.test(idempotencyKey)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Agent login rate limiter received an invalid attempt identity');
    }
    return `qingxu:agent-login:inflight:${idempotencyKey.toLowerCase()}`;
  }

  private inflightKeys(idempotencyKey: string, loginName: string, ipAddress?: string): [string, string, string] {
    const [subject, source] = this.keys(loginName, ipAddress);
    return [
      this.inflightAttempt(idempotencyKey),
      subject.replace(':agent-login:subject:', ':agent-login:inflight:subject:'),
      source.replace(':agent-login:source:', ':agent-login:inflight:source:'),
    ];
  }

  private keys(loginName: string, ipAddress?: string): [string, string] {
    const config = this.runtime();
    const normalizedLogin = loginName.normalize('NFKC').toLocaleLowerCase('en-US');
    const subject = hmacAuthenticationIdentity(
      { login_name: normalizedLogin },
      config.encryption.ipHashKey,
      'agent-login-subject',
    );
    const source = hmacAuthenticationIdentity(
      ipAddress ? { ip_address: ipAddress } : { source: 'unavailable' },
      config.encryption.ipHashKey,
      'agent-login-source',
    );
    return [`qingxu:agent-login:subject:${subject}`, `qingxu:agent-login:source:${source}`];
  }
}
