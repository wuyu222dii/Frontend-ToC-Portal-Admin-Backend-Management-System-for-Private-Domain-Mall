import { describe, expect, it } from 'vitest';

import { computeWechatChrome } from './wechat-chrome';

describe('computeWechatChrome', () => {
  it('uses WeChat custom-nav height that includes the status bar and capsule padding', () => {
    const chrome = computeWechatChrome({
      statusBarHeight: 54,
      windowWidth: 393,
      safeAreaBottom: 34,
      menuButton: { top: 54 + 8, height: 32, left: 393 - 7 - 87, right: 393 - 7 },
    });

    expect(chrome.navBarHeight).toBe(54 + 8 * 2 + 32);
    expect(chrome.capsuleGap).toBe(7);
    expect(chrome.capsuleRight).toBe(7 + 87);
    expect(chrome.safeAreaBottom).toBe(34);
  });

  it('falls back without a capsule on H5-like metrics', () => {
    const chrome = computeWechatChrome({
      statusBarHeight: 0,
      windowWidth: 375,
      safeAreaBottom: 0,
      menuButton: null,
    });

    expect(chrome.navBarHeight).toBe(0);
    expect(chrome.capsuleRight).toBe(0);
    expect(chrome.capsuleGap).toBe(0);
  });

  it('keeps a status-bar fallback nav when the menu button rect is invalid', () => {
    const chrome = computeWechatChrome({
      statusBarHeight: 20,
      windowWidth: 375,
      safeAreaBottom: 0,
      menuButton: { top: 0, height: 0, left: 0, right: 0 },
    });

    expect(chrome.navBarHeight).toBe(64);
    expect(chrome.capsuleRight).toBe(0);
  });
});
