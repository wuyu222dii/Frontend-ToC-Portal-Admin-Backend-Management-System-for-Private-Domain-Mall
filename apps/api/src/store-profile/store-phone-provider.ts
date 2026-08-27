import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import { ApplicationError } from '@qingxu/platform-core';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';

export interface StorePhoneVerification {
  phone: string;
  source: 'MOCK' | 'WECHAT';
}

const MOCK_PHONE_CREDENTIAL = /^mock:phone:(1[3-9][0-9]{9})$/;

@Injectable()
export class StorePhoneProvider {
  constructor(@Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig) {}

  async verify(providerCredential: string): Promise<StorePhoneVerification> {
    if (!this.config) throw new ApplicationError('INTERNAL_ERROR', 'Store phone provider is unavailable');
    if (this.config.store.phoneProvider !== 'MOCK') {
      throw new ApplicationError('INTERNAL_ERROR', 'The WeChat phone adapter is not enabled in this build');
    }
    if (this.config.environment !== 'development' && this.config.environment !== 'test') {
      throw new ApplicationError('INTERNAL_ERROR', 'Mock Store phone authorization is forbidden in this environment');
    }
    const match = MOCK_PHONE_CREDENTIAL.exec(providerCredential);
    if (!match) throw new ApplicationError('AUTH_REQUIRED', 'Store phone credential is invalid');
    return { phone: match[1]!, source: 'MOCK' };
  }
}
