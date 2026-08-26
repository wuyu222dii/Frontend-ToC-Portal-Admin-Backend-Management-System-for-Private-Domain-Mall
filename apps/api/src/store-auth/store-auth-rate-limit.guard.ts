import { isIP } from 'node:net';

import { CanActivate, ExecutionContext, Inject, Injectable, Optional, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, hashIpAddress } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

const STORE_AUTH_RATE_LIMIT = Symbol('store-auth-rate-limit');
type StoreAuthRateLimitPolicy = 'LEGAL' | 'LOGIN';

export const StoreAuthRateLimit = (policy: StoreAuthRateLimitPolicy) =>
  SetMetadata(STORE_AUTH_RATE_LIMIT, policy);

const FIXED_WINDOW_SCRIPT = `
local redis_time = redis.call('TIME')
local now_seconds = tonumber(redis_time[1])
local window_seconds = tonumber(ARGV[1])
local window_end = (math.floor(now_seconds / window_seconds) + 1) * window_seconds
local request_count = redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], window_end)
return { request_count, window_end - now_seconds }
`;

interface RateLimitRequest { ip?: string }
interface RateLimitResponse { setHeader(name: string, value: string): void }

function integer(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string' && typeof value !== 'bigint') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function sourceIp(request: RateLimitRequest): string {
  const value = request.ip?.trim().toLowerCase();
  const family = typeof value === 'string' ? isIP(value) : 0;
  if (typeof value !== 'string' || family === 0) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store authentication request source is unavailable');
  }
  if (family === 4) return value;
  let canonical: string;
  try {
    canonical = new URL(`http://[${value}]`).hostname.slice(1, -1);
  } catch {
    throw new ApplicationError('INTERNAL_ERROR', 'Store authentication request source is unavailable');
  }
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1] ?? '', 16);
  const low = Number.parseInt(mapped[2] ?? '', 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

@Injectable()
export class StoreAuthRateLimitGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: ApiRedisClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const policy = this.reflector.getAllAndOverride<StoreAuthRateLimitPolicy | undefined>(
      STORE_AUTH_RATE_LIMIT,
      [context.getHandler(), context.getClass()],
    );
    if (!policy) throw new ApplicationError('INTERNAL_ERROR', 'Store authentication rate-limit policy is missing');
    const { limit, windowSeconds } = this.policy(policy);
    const request = context.switchToHttp().getRequest<RateLimitRequest>();
    const key = this.key(policy, sourceIp(request));
    let evaluated: unknown;
    try {
      evaluated = await this.client().eval(FIXED_WINDOW_SCRIPT, {
        arguments: [String(windowSeconds)],
        keys: [key],
      });
    } catch (cause) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store authentication rate limiter failed', [], { cause });
    }
    if (!Array.isArray(evaluated) || evaluated.length !== 2) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store authentication rate limiter returned invalid data');
    }
    const count = integer(evaluated[0]);
    const retryAfter = integer(evaluated[1]);
    if (count === undefined || count < 1 || retryAfter === undefined ||
      retryAfter < 1 || retryAfter > windowSeconds) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store authentication rate limiter returned invalid data');
    }
    if (count <= limit) return true;
    context.switchToHttp().getResponse<RateLimitResponse>().setHeader('Retry-After', String(retryAfter));
    throw new ApplicationError('RATE_LIMITED', 'Store authentication rate limit exceeded');
  }

  private client(): ApiRedisClient {
    if (!this.redis || !this.redis.isReady) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store authentication rate limiter is unavailable');
    }
    return this.redis;
  }

  private key(policy: StoreAuthRateLimitPolicy, ipAddress: string): string {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store authentication runtime is unavailable');
    return `qingxu:store-auth:${policy.toLowerCase()}:rate-limit:source:${hashIpAddress(
      ipAddress,
      this.config.encryption.ipHashKey,
    )}`;
  }

  private policy(policy: StoreAuthRateLimitPolicy): { limit: number; windowSeconds: number } {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store authentication runtime is unavailable');
    return policy === 'LEGAL'
      ? { limit: this.config.store.legalRateLimitMax, windowSeconds: this.config.store.legalRateLimitWindowSeconds }
      : { limit: this.config.store.loginRateLimitMax, windowSeconds: this.config.store.loginRateLimitWindowSeconds };
  }
}
