import { isIP } from 'node:net';

import { CanActivate, ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, hashIpAddress } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

const REQUEST_LIMIT = 120;
const WINDOW_SECONDS = 60;

const FIXED_WINDOW_SCRIPT = `
local redis_time = redis.call('TIME')
local now_seconds = tonumber(redis_time[1])
local window_seconds = tonumber(ARGV[1])
local window_end = (math.floor(now_seconds / window_seconds) + 1) * window_seconds
local request_count = redis.call('INCR', KEYS[1])
redis.call('EXPIREAT', KEYS[1], window_end)
return { request_count, window_end - now_seconds }
`;

interface StoreCatalogRequest {
  ip?: string;
}

interface StoreCatalogResponse {
  setHeader(name: string, value: string): void;
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

function rateLimitResult(value: unknown): RateLimitResult {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store catalog rate limiter returned an invalid result');
  }
  const count = integer(value[0]);
  const retryAfterSeconds = integer(value[1]);
  if (count === undefined || count < 1 || retryAfterSeconds === undefined ||
    retryAfterSeconds < 1 || retryAfterSeconds > WINDOW_SECONDS) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store catalog rate limiter returned an invalid result');
  }
  return { count, retryAfterSeconds };
}

function sourceIp(request: StoreCatalogRequest): string {
  const value = request.ip?.trim().toLowerCase();
  const family = typeof value === 'string' ? isIP(value) : 0;
  if (typeof value !== 'string' || family === 0) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store catalog request source is unavailable');
  }
  if (family === 4) return value;

  let canonical: string;
  try {
    const hostname = new URL(`http://[${value}]`).hostname;
    canonical = hostname.slice(1, -1);
  } catch {
    throw new ApplicationError('INTERNAL_ERROR', 'Store catalog request source is unavailable');
  }
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped === null) return canonical;
  const high = Number.parseInt(mapped[1] ?? '', 16);
  const low = Number.parseInt(mapped[2] ?? '', 16);
  return `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`;
}

@Injectable()
export class StoreCatalogRateLimitGuard implements CanActivate {
  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: ApiRedisClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const redis = this.client();
    const request = context.switchToHttp().getRequest<StoreCatalogRequest>();
    const key = this.rateLimitKey(sourceIp(request));

    let evaluated: unknown;
    try {
      evaluated = await redis.eval(FIXED_WINDOW_SCRIPT, {
        arguments: [String(WINDOW_SECONDS)],
        keys: [key],
      });
    } catch (cause) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store catalog rate limiter failed', [], { cause });
    }

    const result = rateLimitResult(evaluated);
    if (result.count <= REQUEST_LIMIT) return true;

    const response = context.switchToHttp().getResponse<StoreCatalogResponse>();
    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    throw new ApplicationError('RATE_LIMITED', 'Store catalog request rate limit exceeded');
  }

  private client(): ApiRedisClient {
    if (!this.config || !this.redis || !this.redis.isReady) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store catalog rate limiter is unavailable');
    }
    return this.redis;
  }

  private rateLimitKey(ipAddress: string): string {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store catalog rate limiter is unavailable');
    try {
      return `qingxu:store-catalog:rate-limit:source:${hashIpAddress(
        ipAddress,
        this.config.encryption.ipHashKey,
      )}`;
    } catch (cause) {
      throw new ApplicationError('INTERNAL_ERROR', 'Store catalog request source cannot be protected', [], { cause });
    }
  }
}
