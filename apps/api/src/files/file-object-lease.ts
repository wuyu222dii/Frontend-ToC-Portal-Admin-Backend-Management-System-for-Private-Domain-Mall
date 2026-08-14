import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ApplicationError } from '@qingxu/platform-core';
import { FILE_OBJECT_LEASE_TTL_MS, fileObjectLeaseKey } from '@qingxu/storage';

import { API_REDIS_CLIENT, type ApiRedisClient } from '../platform/redis/api-redis-runtime';

const CLAIM_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then return 1 end
return 0
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const HEARTBEAT_INTERVAL_MS = Math.floor(FILE_OBJECT_LEASE_TTL_MS / 3);

function booleanRedisResult(value: unknown, label: string): boolean {
  if (value === 1 || value === '1') return true;
  if (value === 0 || value === '0' || value === null) return false;
  throw new ApplicationError('INTERNAL_ERROR', `File object lease returned an invalid ${label} result`);
}

export interface FileObjectLease {
  assertOwned(): Promise<void>;
  release(): Promise<void>;
}

@Injectable()
export class FileObjectLeaseManager {
  private readonly logger = new Logger('FileObjectLease');

  constructor(@Optional() @Inject(API_REDIS_CLIENT) private readonly redis?: ApiRedisClient) {}

  async acquire(fileId: string): Promise<FileObjectLease> {
    const redis = this.client();
    const key = fileObjectLeaseKey(fileId);
    const owner = randomUUID();
    const acquired = booleanRedisResult(await redis.eval(CLAIM_SCRIPT, {
      arguments: [owner, String(FILE_OBJECT_LEASE_TTL_MS)],
      keys: [key],
    }), 'claim');
    if (!acquired) throw new ApplicationError('STATE_CONFLICT', 'File completion is already in progress');
    let released = false;
    let lost = false;
    let heartbeat: ReturnType<typeof setTimeout> | undefined;
    let renewal: Promise<boolean> | undefined;

    const renew = (): Promise<boolean> => {
      if (released || lost) return Promise.resolve(false);
      renewal ??= redis.eval(RENEW_SCRIPT, {
        arguments: [owner, String(FILE_OBJECT_LEASE_TTL_MS)],
        keys: [key],
      }).then((result) => booleanRedisResult(result, 'renewal')).catch(() => false).finally(() => {
        renewal = undefined;
      });
      return renewal;
    };
    const scheduleHeartbeat = (): void => {
      if (released || lost) return;
      heartbeat = setTimeout(() => {
        void renew().then((renewed) => {
          if (!renewed) {
            lost = true;
            this.logger.error({ error_code: 'FILE_OBJECT_LEASE_RENEW_FAILED', service: 'api' });
            return;
          }
          scheduleHeartbeat();
        });
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref();
    };
    scheduleHeartbeat();

    return {
      assertOwned: async () => {
        if (released) throw new ApplicationError('STATE_CONFLICT', 'File completion lease has been released');
        if (lost) throw new ApplicationError('STATE_CONFLICT', 'File completion lease was lost');
        const renewed = await renew();
        if (!renewed) {
          lost = true;
          if (heartbeat) clearTimeout(heartbeat);
          throw new ApplicationError('STATE_CONFLICT', 'File completion lease was lost');
        }
      },
      release: async () => {
        if (released) return;
        released = true;
        if (heartbeat) clearTimeout(heartbeat);
        try {
          booleanRedisResult(await redis.eval(RELEASE_SCRIPT, { arguments: [owner], keys: [key] }), 'release');
        } catch {
          this.logger.error({ error_code: 'FILE_OBJECT_LEASE_RELEASE_FAILED', service: 'api' });
        }
      },
    };
  }

  private client(): ApiRedisClient {
    if (!this.redis) throw new ApplicationError('INTERNAL_ERROR', 'File object lease runtime is unavailable');
    return this.redis;
  }
}
