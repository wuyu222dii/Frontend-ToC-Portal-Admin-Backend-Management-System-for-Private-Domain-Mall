import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError, sha256Hex } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';

export interface StoreIdentity {
  openId: string;
  unionId: string | null;
}

const MOCK_CODE = /^mock:[A-Za-z0-9._-]{8,120}$/;

@Injectable()
export class StoreIdentityProvider {
  constructor(@Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig) {}

  async exchange(code: string): Promise<StoreIdentity> {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store identity provider is unavailable');
    if (this.config.store.identityProvider !== 'MOCK') {
      throw new ApplicationError('INTERNAL_ERROR', 'The WeChat identity adapter is not enabled in this build');
    }
    if (this.config.environment === 'production') {
      throw new ApplicationError('INTERNAL_ERROR', 'Mock Store identity is forbidden in production');
    }
    if (!MOCK_CODE.test(code)) throw new ApplicationError('AUTH_REQUIRED', 'Store identity code is invalid');
    return {
      openId: `mock_${sha256Hex(`${this.config.store.wechatAppId}\0${code}`)}`,
      unionId: null,
    };
  }
}
