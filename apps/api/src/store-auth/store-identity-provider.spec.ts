import type { PlatformRuntimeConfig } from '@qingxu/config';
import { describe, expect, it } from 'vitest';

import { StoreIdentityProvider } from './store-identity-provider';

function config(overrides: Partial<PlatformRuntimeConfig['store']> = {}): PlatformRuntimeConfig {
  return {
    environment: 'test',
    store: {
      identityProvider: 'MOCK',
      wechatAppId: 'mock-app-one',
      ...overrides,
    } as PlatformRuntimeConfig['store'],
  } as PlatformRuntimeConfig;
}

describe('B7.1 Store identity provider', () => {
  it('derives a stable opaque openid from the fixed AppID and Mock code', async () => {
    const provider = new StoreIdentityProvider(config());
    const first = await provider.exchange('mock:customer_0001');
    const second = await provider.exchange('mock:customer_0001');

    expect(first).toEqual(second);
    expect(first.openId).toMatch(/^mock_[a-f0-9]{64}$/);
    expect(first.openId).not.toContain('customer_0001');
    expect(first.unionId).toBeNull();
    await expect(new StoreIdentityProvider(config({ wechatAppId: 'mock-app-two' }))
      .exchange('mock:customer_0001')).resolves.not.toEqual(first);
  });

  it.each(['code', 'mock:short', `mock:${'x'.repeat(121)}`])('rejects invalid Mock code %s', async (code) => {
    await expect(new StoreIdentityProvider(config()).exchange(code))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
  });

  it('fails closed for production Mock and the unavailable real adapter', async () => {
    const production = config();
    production.environment = 'production';
    await expect(new StoreIdentityProvider(production).exchange('mock:customer_0001'))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    await expect(new StoreIdentityProvider(config({ identityProvider: 'WECHAT' }))
      .exchange('mock:customer_0001')).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
