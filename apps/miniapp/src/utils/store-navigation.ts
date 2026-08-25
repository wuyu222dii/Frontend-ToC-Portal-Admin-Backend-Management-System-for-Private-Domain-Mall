export type StoreNavTarget = 'home' | 'category' | 'cart' | 'profile';

export interface StoreBannerTarget {
  target_id: string | null;
  target_type: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'URL';
  target_url: string | null;
}

function pageUrl(path: string, query: Record<string, string | undefined> = {}): string {
  const parameters = Object.entries(query)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join('&');
  return parameters.length === 0 ? path : `${path}?${parameters}`;
}

export function openHome(): void {
  void uni.reLaunch({ url: '/pages/index/index' });
}

export function openCategory(categoryId?: string): void {
  void uni.reLaunch({ url: pageUrl('/pages/category/index', { category_id: categoryId }) });
}

export function openSearch(keyword?: string): void {
  void uni.navigateTo({ url: pageUrl('/pages/search/index', { keyword }) });
}

export function openProduct(productId: string): void {
  void uni.navigateTo({ url: pageUrl('/pages/product/detail', { product_id: productId }) });
}

export function goBackOrHome(): void {
  void uni.navigateBack({
    fail: openHome,
  });
}

export function showLoginPrompt(): void {
  void uni.showModal({
    confirmText: '知道了',
    content: '登录后可继续此操作。',
    showCancel: false,
    title: '请先登录',
  });
}

export function showUnavailable(): void {
  void uni.showToast({ icon: 'none', title: '请稍后再试' });
}

export function handleBottomNavigation(target: StoreNavTarget): void {
  if (target === 'home') return openHome();
  if (target === 'category') return openCategory();
  if (target === 'profile') return showLoginPrompt();
  showUnavailable();
}

export function isSafeHttpsUrl(value: string): boolean {
  const match = /^https:\/\/(?:\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::([0-9]{1,5}))?(?:[/?#][^\s]*)?$/i
    .exec(value);
  if (!match) return false;
  const portValue = match[1];
  if (portValue === undefined) return true;
  const port = Number(portValue);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export function openBannerTarget(target: StoreBannerTarget): void {
  if (target.target_type === 'PRODUCT' && target.target_id !== null) {
    return openProduct(target.target_id);
  }
  if (target.target_type === 'CATEGORY' && target.target_id !== null) {
    return openCategory(target.target_id);
  }
  if (target.target_type !== 'URL' || target.target_url === null ||
    !isSafeHttpsUrl(target.target_url)) {
    return;
  }

  const targetUrl = target.target_url;
  // #ifdef H5
  window.location.assign(targetUrl);
  // #endif
  // #ifndef H5
  void uni.navigateTo({
    url: pageUrl('/pages/webview/index', { url: targetUrl }),
  });
  // #endif
}
