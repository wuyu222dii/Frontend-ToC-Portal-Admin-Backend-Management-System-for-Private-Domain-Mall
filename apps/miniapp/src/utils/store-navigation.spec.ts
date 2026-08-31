import { afterEach, describe, expect, it, vi } from 'vitest';

import { clearCustomerSession, saveCustomerSession } from './customer-session';
import { clearProtectedAction, peekProtectedAction } from './protected-action';
import {
  goBackOrHome,
  handleBottomNavigation,
  isSafeHttpsUrl,
  openOrderLogistics,
  openPaymentResult,
  showLoginPrompt,
} from './store-navigation';

describe('store navigation URL safety', () => {
  afterEach(() => {
    clearCustomerSession();
    clearProtectedAction();
    vi.unstubAllGlobals();
  });

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

  it('relaunches home when a directly opened page is the stack root', () => {
    const navigateBack = vi.fn();
    const reLaunch = vi.fn(() => Promise.resolve());
    vi.stubGlobal('getCurrentPages', () => [{}]);
    vi.stubGlobal('uni', { navigateBack, reLaunch });

    goBackOrHome();

    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/index/index' });
    expect(navigateBack).not.toHaveBeenCalled();
  });

  it('uses normal back navigation when the page stack has an origin', () => {
    const navigateBack = vi.fn();
    const reLaunch = vi.fn(() => Promise.resolve());
    vi.stubGlobal('getCurrentPages', () => [{}, {}]);
    vi.stubGlobal('uni', { navigateBack, reLaunch });

    goBackOrHome();

    expect(navigateBack).toHaveBeenCalledWith({ fail: expect.any(Function) });
    expect(reLaunch).not.toHaveBeenCalled();
  });

  it('opens checkout directly for an authenticated customer', () => {
    const showModal = vi.fn();
    const navigateTo = vi.fn();
    vi.stubGlobal('uni', {
      navigateTo,
      removeStorageSync: vi.fn(),
      showModal,
    });
    saveCustomerSession({
      access_token: 'a'.repeat(20),
      refresh_token: 'r'.repeat(20),
      role: 'CUSTOMER',
      assurance: 'WECHAT',
      access_expires_at: '2030-01-01T00:00:00.000Z',
      refresh_expires_at: '2030-02-01T00:00:00.000Z',
    });

    showLoginPrompt({ type: 'CHECKOUT' });

    expect(showModal).not.toHaveBeenCalled();
    expect(navigateTo).toHaveBeenCalledWith({ url: '/pages/checkout/index?source=CART' });
    expect(peekProtectedAction()).toBeNull();
  });

  it('opens payment result with only the encoded order ID', () => {
    const navigateTo = vi.fn();
    vi.stubGlobal('uni', { navigateTo });
    openPaymentResult('01J00000000000000000000000');
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/pages/payment/result?order_id=01J00000000000000000000000',
    });
  });

  it('opens the established MP-12 logistics page with only the encoded order ID', () => {
    const navigateTo = vi.fn();
    vi.stubGlobal('uni', { navigateTo });
    openOrderLogistics('01J00000000000000000000000');
    expect(navigateTo).toHaveBeenCalledWith({
      url: '/pages/orders/logistics?order_id=01J00000000000000000000000',
    });
  });
});
