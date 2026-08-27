import type { PlatformRuntimeConfig } from '@qingxu/config';
import { describe, expect, it } from 'vitest';

import { StorePhoneProvider } from './store-phone-provider';

function config(overrides: Partial<PlatformRuntimeConfig['store']> = {}): PlatformRuntimeConfig {
  return {
    environment: 'test',
    store: {
      phoneProvider: 'MOCK',
      ...overrides,
    } as PlatformRuntimeConfig['store'],
  } as PlatformRuntimeConfig;
}

describe('B7.2 Store phone provider', () => {
  it.each(['test', 'development'] as const)('accepts only the explicit synthetic credential in %s', async (environment) => {
    const runtimeConfig = config();
    runtimeConfig.environment = environment;
    await expect(new StorePhoneProvider(runtimeConfig).verify('mock:phone:13800000000')).resolves.toEqual({
      phone: '13800000000',
      source: 'MOCK',
    });
  });

  it.each([
    '13800000000',
    'mock:13800000000',
    'mock:phone:+8613800000000',
    'mock:phone:12800000000',
    'mock:phone:1380000000',
    'mock:phone:138000000000',
  ])('rejects a credential outside the synthetic format: %s', async (credential) => {
    await expect(new StorePhoneProvider(config()).verify(credential))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('fails closed when runtime configuration is unavailable', async () => {
    await expect(new StorePhoneProvider().verify('mock:phone:13800000000'))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('fails closed for production Mock and the unavailable WeChat adapter', async () => {
    const production = config();
    production.environment = 'production';
    await expect(new StorePhoneProvider(production).verify('mock:phone:13800000000'))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(new StorePhoneProvider(config({ phoneProvider: 'WECHAT' })).verify('mock:phone:13800000000'))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
