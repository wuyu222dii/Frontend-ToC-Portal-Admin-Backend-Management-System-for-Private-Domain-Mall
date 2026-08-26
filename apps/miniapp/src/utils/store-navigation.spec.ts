import { afterEach, describe, expect, it, vi } from 'vitest';

import { handleBottomNavigation, isSafeHttpsUrl } from './store-navigation';

describe('store navigation URL safety', () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    'https://mall.example.com',
    'https://mall.example.com/campaign?id=1#detail',
    'https://127.0.0.1:443/path',
    'https://[2001:db8::1]/path',
  ])('accepts an absolute HTTPS target without credentials: %s', (value) => {
    expect(isSafeHttpsUrl(value)).toBe(true);
  });

  it.each([
    'http://mall.example.com',
    'https://user:secret@mall.example.com',
    'https://mall.example.com:0/path',
    'https://mall.example.com:65536/path',
    '//mall.example.com/path',
    'javascript:alert(1)',
    'https://mall.example.com/path\nnext',
  ])('rejects an unsafe or malformed target: %s', (value) => {
    expect(isSafeHttpsUrl(value)).toBe(false);
  });

  it('opens the implemented guest cart from the shared bottom navigation', () => {
    const reLaunch = vi.fn(() => Promise.resolve());
    vi.stubGlobal('uni', { reLaunch });
    handleBottomNavigation('cart');
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/cart/index' });
  });
});
