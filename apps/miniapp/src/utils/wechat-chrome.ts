export interface WechatMenuButtonRect {
  readonly top: number;
  readonly height: number;
  readonly left: number;
  readonly right: number;
}

export interface WechatChromeMetrics {
  readonly statusBarHeight: number;
  readonly navBarHeight: number;
  readonly capsuleRight: number;
  readonly capsuleGap: number;
  readonly safeAreaBottom: number;
  readonly windowWidth: number;
}

const FALLBACK_NAV_CONTENT_PX = 44;

function nonNegative(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function isUsableMenuButton(
  menuButton: WechatMenuButtonRect | null,
  windowWidth: number,
): menuButton is WechatMenuButtonRect {
  if (menuButton === null) return false;
  if (menuButton.height <= 0 || menuButton.top < 0) return false;
  if (menuButton.right <= menuButton.left) return false;
  if (windowWidth > 0 && menuButton.right > windowWidth + 1) return false;
  return true;
}

export function computeWechatChrome(input: {
  readonly statusBarHeight: number;
  readonly windowWidth: number;
  readonly safeAreaBottom: number;
  readonly menuButton: WechatMenuButtonRect | null;
}): WechatChromeMetrics {
  const statusBarHeight = nonNegative(input.statusBarHeight);
  const windowWidth = nonNegative(input.windowWidth);
  const safeAreaBottom = nonNegative(input.safeAreaBottom);
  const menuButton = isUsableMenuButton(input.menuButton, windowWidth) ? input.menuButton : null;

  if (menuButton === null) {
    return {
      statusBarHeight,
      navBarHeight: statusBarHeight > 0 ? statusBarHeight + FALLBACK_NAV_CONTENT_PX : 0,
      capsuleRight: 0,
      capsuleGap: 0,
      safeAreaBottom,
      windowWidth,
    };
  }

  const gapAboveCapsule = Math.max(0, menuButton.top - statusBarHeight);
  return {
    statusBarHeight,
    navBarHeight: statusBarHeight + gapAboveCapsule * 2 + menuButton.height,
    capsuleRight: windowWidth > 0 ? Math.max(0, windowWidth - menuButton.left) : 0,
    capsuleGap: windowWidth > 0 ? Math.max(0, windowWidth - menuButton.right) : 0,
    safeAreaBottom,
    windowWidth,
  };
}

function readWindowMetrics(): Pick<WechatChromeMetrics, 'statusBarHeight' | 'windowWidth' | 'safeAreaBottom'> {
  try {
    if (typeof uni.getWindowInfo === 'function') {
      const info = uni.getWindowInfo();
      const insetBottom = info.safeAreaInsets?.bottom;
      const derivedBottom = info.safeArea && info.windowHeight > 0
        ? Math.max(0, info.windowHeight - info.safeArea.bottom)
        : 0;
      return {
        statusBarHeight: nonNegative(info.statusBarHeight),
        windowWidth: nonNegative(info.windowWidth),
        safeAreaBottom: nonNegative(insetBottom) || derivedBottom,
      };
    }
  } catch {
    // Fall through to getSystemInfoSync.
  }

  try {
    const info = uni.getSystemInfoSync();
    const insetBottom = info.safeAreaInsets?.bottom;
    const windowHeight = info.windowHeight ?? info.screenHeight ?? 0;
    const derivedBottom = info.safeArea && windowHeight > 0
      ? Math.max(0, windowHeight - info.safeArea.bottom)
      : 0;
    return {
      statusBarHeight: nonNegative(info.statusBarHeight),
      windowWidth: nonNegative(info.windowWidth),
      safeAreaBottom: nonNegative(insetBottom) || derivedBottom,
    };
  } catch {
    return { statusBarHeight: 0, windowWidth: 0, safeAreaBottom: 0 };
  }
}

function readMenuButton(): WechatMenuButtonRect | null {
  if (process.env.UNI_PLATFORM !== 'mp-weixin') return null;
  try {
    const rect = uni.getMenuButtonBoundingClientRect();
    if (!rect) return null;
    return {
      top: rect.top,
      height: rect.height,
      left: rect.left,
      right: rect.right,
    };
  } catch {
    return null;
  }
}

export function readWechatChrome(): WechatChromeMetrics {
  const windowMetrics = readWindowMetrics();
  return computeWechatChrome({
    ...windowMetrics,
    menuButton: readMenuButton(),
  });
}

export function wechatChromeCssVars(): Record<string, string> {
  const chrome = readWechatChrome();
  const vars: Record<string, string> = {};
  if (chrome.statusBarHeight > 0) vars['--qx-status-bar'] = `${chrome.statusBarHeight}px`;
  if (chrome.navBarHeight > 0) vars['--qx-nav-bar'] = `${chrome.navBarHeight}px`;
  if (chrome.capsuleRight > 0) vars['--qx-capsule-right'] = `${chrome.capsuleRight}px`;
  if (chrome.capsuleGap > 0) vars['--qx-capsule-gap'] = `${chrome.capsuleGap}px`;
  if (chrome.safeAreaBottom > 0) vars['--qx-safe-bottom'] = `${chrome.safeAreaBottom}px`;
  return vars;
}
