import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, hashIpAddress, hmacAuthenticationIdentity } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

const LOGIN_FAILURE_LIMIT = 5;
const SOURCE_FAILURE_LIMIT = 20;
const LOCK_MILLISECONDS = 15 * 60 * 1_000;
const INFLIGHT_ATTEMPT_TTL_MILLISECONDS = 5 * 60 * 1_000;
const SUBJECT_PARTIAL_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;
const SOURCE_PARTIAL_TTL_MILLISECONDS = 15 * 60 * 1_000;
const ATTEMPT_MARKER_TTL_MILLISECONDS = 24 * 60 * 60 * 1_000;
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
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local remaining = 0
for _, key in ipairs(KEYS) do
  local locked_until = tonumber(redis.call('HGET', key, 'locked_until') or '0')
  if locked_until > now then
    remaining = math.max(remaining, locked_until - now)
  elseif locked_until > 0 then
    redis.call('DEL', key)
  end
end
return remaining
`;

const RECORD_SCRIPT = `
local time = redis.call('TIME')
local now = (tonumber(time[1]) * 1000) + math.floor(tonumber(time[2]) / 1000)
local lock_ms = tonumber(ARGV[1])
local marker_ttl = tonumber(ARGV[2])
local remaining = 0
local marker_created = redis.call('SET', KEYS[1], '1', 'PX', marker_ttl, 'NX')
for index = 2, #KEYS do
  local key = KEYS[index]
  local locked_until = tonumber(redis.call('HGET', key, 'locked_until') or '0')
  if locked_until > now then
    remaining = math.max(remaining, locked_until - now)
  elseif marker_created then
    if locked_until > 0 then redis.call('DEL', key) end
    local counter_index = index - 1
    local threshold = tonumber(ARGV[(counter_index * 2) + 1])
    local partial_ttl = tonumber(ARGV[(counter_index * 2) + 2])
    local failures = redis.call('HINCRBY', key, 'failures', 1)
    if failures >= threshold then
      local next_locked_until = now + lock_ms
      redis.call('HSET', key, 'locked_until', next_locked_until)
      redis.call('HDEL', key, 'failures')
      redis.call('PEXPIRE', key, lock_ms)
      remaining = math.max(remaining, lock_ms)
    else
      redis.call('PEXPIRE', key, partial_ttl)
    end
  end
end
return remaining
`;

function milliseconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter returned an invalid result');
  }
  return parsed;
}

@Injectable()
export class AdminLoginRateLimiter {
  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: ApiRedisClient,
  ) {}

  async claimAttempt(idempotencyKey: string, loginName: string, ipAddress?: string): Promise<string> {
    const owner = randomUUID();
    const result = await this.client().eval(CLAIM_SCRIPT, {
      arguments: [owner, String(INFLIGHT_ATTEMPT_TTL_MILLISECONDS)],
      keys: this.inflightKeys(idempotencyKey, loginName, ipAddress),
    });
    if (result === 1 || result === '1') return owner;
    if (result === 0 || result === '0' || result === null) {
      throw new ApplicationError('STATE_CONFLICT', 'Administrator login is already being processed');
    }
    throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter returned an invalid claim result');
  }

  async releaseAttempt(owner: string, idempotencyKey: string, loginName: string, ipAddress?: string): Promise<void> {
    const result = await this.client().eval(RELEASE_CLAIM_SCRIPT, {
      arguments: [owner],
      keys: this.inflightKeys(idempotencyKey, loginName, ipAddress),
    });
    const released = Number(result);
    if (!Number.isSafeInteger(released) || released < 0 || released > 3) {
      throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter returned an invalid release result');
    }
  }

  async assertAllowed(loginName: string, ipAddress?: string): Promise<void> {
    const remaining = milliseconds(await this.client().eval(CHECK_SCRIPT, {
      arguments: [],
      keys: this.keys(loginName, ipAddress),
    }));
    if (remaining > 0) throw new ApplicationError('RATE_LIMITED', 'Administrator login is locked');
  }

  async recordUnresolvedFailure(loginName: string, idempotencyKey: string, ipAddress?: string): Promise<void> {
    const remaining = milliseconds(await this.client().eval(RECORD_SCRIPT, {
      arguments: [
        String(LOCK_MILLISECONDS),
        String(ATTEMPT_MARKER_TTL_MILLISECONDS),
        String(LOGIN_FAILURE_LIMIT),
        String(SUBJECT_PARTIAL_TTL_MILLISECONDS),
        String(SOURCE_FAILURE_LIMIT),
        String(SOURCE_PARTIAL_TTL_MILLISECONDS),
      ],
      keys: [this.attemptMarker(idempotencyKey), ...this.keys(loginName, ipAddress)],
    }));
    if (remaining > 0) throw new ApplicationError('RATE_LIMITED', 'Administrator login is locked');
  }

  async recordSourceFailure(loginName: string, idempotencyKey: string, ipAddress?: string): Promise<void> {
    const remaining = milliseconds(await this.client().eval(RECORD_SCRIPT, {
      arguments: [
        String(LOCK_MILLISECONDS),
        String(ATTEMPT_MARKER_TTL_MILLISECONDS),
        String(SOURCE_FAILURE_LIMIT),
        String(SOURCE_PARTIAL_TTL_MILLISECONDS),
      ],
      keys: [this.attemptMarker(idempotencyKey), this.keys(loginName, ipAddress)[1]],
    }));
    if (remaining > 0) throw new ApplicationError('RATE_LIMITED', 'Administrator login is locked');
  }

  private client(): ApiRedisClient {
    if (!this.redis || !this.config) {
      throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter is unavailable');
    }
    return this.redis;
  }

  private attemptMarker(idempotencyKey: string): string {
    if (!UUID.test(idempotencyKey)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter received an invalid attempt identity');
    }
    return `qingxu:admin-login:attempt:${idempotencyKey.toLowerCase()}`;
  }

  private inflightAttempt(idempotencyKey: string): string {
    if (!UUID.test(idempotencyKey)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter received an invalid attempt identity');
    }
    return `qingxu:admin-login:inflight:${idempotencyKey.toLowerCase()}`;
  }

  private inflightKeys(idempotencyKey: string, loginName: string, ipAddress?: string): [string, string, string] {
    const [subject, source] = this.keys(loginName, ipAddress);
    return [
      this.inflightAttempt(idempotencyKey),
      subject.replace(':admin-login:subject:', ':admin-login:inflight:subject:'),
      source.replace(':admin-login:source:', ':admin-login:inflight:source:'),
    ];
  }

  private keys(loginName: string, ipAddress?: string): [string, string] {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Login rate limiter is unavailable');
    const normalizedLogin = loginName.normalize('NFKC').toLocaleLowerCase('en-US');
    const subject = hmacAuthenticationIdentity(
      { login_name: normalizedLogin },
      this.config.encryption.ipHashKey,
      'admin-login-subject',
    );
    const source = ipAddress
      ? hashIpAddress(ipAddress, this.config.encryption.ipHashKey)
      : hmacAuthenticationIdentity({ source: 'unavailable' }, this.config.encryption.ipHashKey, 'admin-login-source');
    return [`qingxu:admin-login:subject:${subject}`, `qingxu:admin-login:source:${source}`];
  }
}
