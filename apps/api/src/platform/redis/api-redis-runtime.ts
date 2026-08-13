import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { createClient } from 'redis';

import { API_RUNTIME_CONFIG } from '../config/api-runtime-config';

export const API_REDIS_CLIENT = Symbol('API_REDIS_CLIENT');

export interface ApiRedisClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  destroy(): void;
  eval(script: string, options: { arguments: string[]; keys: string[] }): Promise<unknown>;
  on(event: 'error', listener: () => void): unknown;
  quit(): Promise<unknown>;
}

export function createApiRedisClient(config: PlatformRuntimeConfig): ApiRedisClient {
  return createClient({
    url: config.redis.url,
    socket: {
      connectTimeout: config.database.connectionTimeoutMs,
      reconnectStrategy: false,
    },
  }) as unknown as ApiRedisClient;
}

@Injectable()
export class ApiRedisLifecycleService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('RedisRuntime');
  private closed = false;

  constructor(
    @Inject(API_REDIS_CLIENT) private readonly client: ApiRedisClient,
    @Inject(API_RUNTIME_CONFIG) private readonly config: PlatformRuntimeConfig,
  ) {
    this.client.on('error', () => {
      this.logger.error({ error_code: 'REDIS_CLIENT_ERROR', service: this.config.service });
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.client.isOpen) return;
    try {
      await this.client.quit();
    } catch {
      this.client.destroy();
    }
  }
}
