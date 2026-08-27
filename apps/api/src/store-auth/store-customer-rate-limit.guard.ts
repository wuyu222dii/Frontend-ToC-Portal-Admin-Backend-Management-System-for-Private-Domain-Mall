import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import type { PrincipalRequest } from '../platform/access/principal';
import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

const RATE_LIMIT_HMAC_DOMAIN = 'qingxu:store-customer-rate-limit:v1';

const FIXED_WINDOW_SCRIPT = `
local redis_time = redis.call('TIME')
local now_seconds = tonumber(redis_time[1])
local window_seconds = tonumber(ARGV[1])
local window_end = (math.floor(now_seconds / window_seconds) + 1) * window_seconds
local request_count = redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], window_end)
return { request_count, window_end - now_seconds }
`;

interface StoreCustomerRequest extends PrincipalRequest {
  ip?: string;
}

interface StoreCustomerResponse {
  setHeader(name: string, value: string): void;
}

interface RateLimitPolicy {
  limit: number;
  windowSeconds: number;
}

interface RateLimitResult {
  count: number;
  retryAfterSeconds: number;
}

function integer(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function rateLimitResult(value: unknown, windowSeconds: number): RateLimitResult {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store customer rate limiter returned invalid data');
  }
  const count = integer(value[0]);
  const retryAfterSeconds = integer(value[1]);
  if (count === undefined || count < 1 || retryAfterSeconds === undefined ||
    retryAfterSeconds < 1 || retryAfterSeconds > windowSeconds) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store customer rate limiter returned invalid data');
  }
  return { count, retryAfterSeconds };
}

function sourceIp(request: StoreCustomerRequest): string {
  const value = request.ip?.trim().toLowerCase();
  const family = typeof value === 'string' ? isIP(value) : 0;
  if (typeof value !== 'string' || family === 0) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store customer request source is unavailable');
  }
  if (family === 4) return value;

  let canonical: string;
  try {
    canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  } catch {
    throw new ApplicationError('INTERNAL_ERROR', 'Store customer request source is unavailable');
  }
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1] ?? '', 16);
  const low = Number.parseInt(mapped[2] ?? '', 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

@Injectable()
export class StoreCustomerRateLimitGuard implements CanActivate {
  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: ApiRedisClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<StoreCustomerRequest>();
    const customerId = request.storeSession?.customerId;
    if (!isValidUlid(customerId)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store customer session is unavailable');
    }
    const policy = this.policy();
    const key = this.rateLimitKey(customerId, sourceIp(request));

    let evaluated: unknown;
    try {
      evaluated = await this.client().eval(FIXED_WINDOW_SCRIPT, {
        arguments: [String(policy.windowSeconds)],
        keys: [key],
      });
    } catch (cause) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store customer rate limiter failed', [], { cause });
    }

    const result = rateLimitResult(evaluated, policy.windowSeconds);
    if (result.count <= policy.limit) return true;

    context.switchToHttp().getResponse<StoreCustomerResponse>()
      .setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new ApplicationError('RATE_LIMITED', 'Store customer rate limit exceeded');
  }

  private client(): ApiRedisClient {
    if (!this.redis || !this.redis.isReady) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store customer rate limiter is unavailable');
    }
    return this.redis;
  }

  private policy(): RateLimitPolicy {
    const limit = this.config?.store.customerRateLimitMax;
    const windowSeconds = this.config?.store.customerRateLimitWindowSeconds;
    if (!Number.isSafeInteger(limit) || Number(limit) < 1 ||
      !Number.isSafeInteger(windowSeconds) || Number(windowSeconds) < 1) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store customer rate-limit policy is unavailable');
    }
    return { limit: Number(limit), windowSeconds: Number(windowSeconds) };
  }

  private rateLimitKey(customerId: string, ipAddress: string): string {
    const key = this.config?.encryption.ipHashKey;
    if (!Buffer.isBuffer(key) || key.length < 32) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store customer rate-limit identity cannot be protected');
    }
    try {
      const digest = createHmac('sha256', key)
        .update(RATE_LIMIT_HMAC_DOMAIN, 'utf8')
        .update('\0', 'utf8')
        .update(customerId, 'utf8')
        .update('\0', 'utf8')
        .update(ipAddress, 'utf8')
        .digest('hex');
      return `qingxu:store-customer:rate-limit:subject:${digest}`;
    } catch (cause) {
      throw new ApplicationError(
        'INTERNAL_ERROR',
        'Store customer rate-limit identity cannot be protected',
        [],
        { cause },
      );
    }
  }
}
