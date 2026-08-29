import { createIdempotencyKey, putFavorite } from '../api';
import { StoreApiError } from '../api/store-client';

export type ProtectedAction =
  | { readonly type: 'ADDRESS_EDIT'; readonly address_id?: string }
  | { readonly type: 'ADDRESS_LIST' }
  | { readonly type: 'CART' }
  | { readonly type: 'CART_ADD'; readonly product_id: string }
  | { readonly type: 'CHECKOUT' }
  | { readonly type: 'FAVORITE'; readonly product_id: string }
  | { readonly type: 'FAVORITES' }
  | { readonly type: 'ORDER_DETAIL'; readonly order_id: string }
  | { readonly type: 'ORDERS' }
  | { readonly type: 'PROFILE' }
  | { readonly type: 'SERVICE_AGENT' }
  | {
      readonly type: 'BUY_NOW';
      readonly product_id: string;
      readonly sku_id: string;
      readonly quantity: number;
    };

let pendingAction: ProtectedAction | null = null;

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value);
}

export function setProtectedAction(action: ProtectedAction): void {
  if ((action.type === 'CART_ADD' || action.type === 'FAVORITE' || action.type === 'BUY_NOW') &&
    !isUlid(action.product_id)) {
    throw new Error('Protected action product ID is invalid');
  }
  if (action.type === 'ADDRESS_EDIT' && action.address_id !== undefined &&
    !isUlid(action.address_id)) {
    throw new Error('Protected action address ID is invalid');
  }
  if (action.type === 'BUY_NOW' && (!isUlid(action.sku_id) ||
    !Number.isInteger(action.quantity) || action.quantity < 1 || action.quantity > 99)) {
    throw new Error('Protected buy-now action is invalid');
  }
  if (action.type === 'ORDER_DETAIL' && !isUlid(action.order_id)) {
    throw new Error('Protected action order ID is invalid');
  }
  pendingAction = action;
}

export function peekProtectedAction(): ProtectedAction | null {
  return pendingAction;
}

export function consumeProtectedAction(): ProtectedAction | null {
  const action = pendingAction;
  pendingAction = null;
  return action;
}

export function clearProtectedAction(): void {
  pendingAction = null;
}

export function openCandidateDecisionPage(handlers: {
  readonly onFailure?: () => void;
  readonly onSuccess?: () => void;
} = {}): void {
  const url = '/pages/profile/agent?source=login';
  void uni.redirectTo({
    url,
    ...(handlers.onSuccess ? { success: handlers.onSuccess } : {}),
    fail: () => {
      void uni.reLaunch({
        url,
        ...(handlers.onSuccess ? { success: handlers.onSuccess } : {}),
        ...(handlers.onFailure ? { fail: handlers.onFailure } : {}),
      });
    },
  });
}

function unavailableAfterNavigation(title: string): void {
  setTimeout(() => {
    void uni.showModal({
      confirmText: '知道了',
      content: '此功能将在后续阶段开放。',
      showCancel: false,
      title,
    });
  }, 0);
}

function returnToOrigin(fallbackUrl: string, unavailableTitle?: string): void {
  void uni.navigateBack({
    success: () => {
      if (unavailableTitle) unavailableAfterNavigation(unavailableTitle);
    },
    fail: () => {
      void uni.redirectTo({
        url: fallbackUrl,
        success: () => {
          if (unavailableTitle) unavailableAfterNavigation(unavailableTitle);
        },
      });
    },
  });
}

function replaceCurrentPage(url: string): void {
  void uni.redirectTo({
    url,
    fail: () => {
      void uni.reLaunch({ url });
    },
  });
}

function showResumeResult(title: string): void {
  setTimeout(() => {
    void uni.showToast({ icon: 'none', title });
  }, 0);
}

async function resumeFavorite(productId: string): Promise<void> {
  const idempotencyKey = createIdempotencyKey();
  try {
    const result = await putFavorite(productId, idempotencyKey);
    returnToOrigin(`/pages/product/detail?product_id=${encodeURIComponent(productId)}`);
    showResumeResult(result.is_favorite ? '已收藏' : '收藏状态已变化，请再次操作');
  } catch (error) {
    returnToOrigin(`/pages/product/detail?product_id=${encodeURIComponent(productId)}`);
    showResumeResult(error instanceof StoreApiError && error.status === 409
      ? '收藏状态已变化，请再次操作'
      : '收藏失败，请稍后重试');
  }
}

export async function resumeProtectedAction(): Promise<void> {
  const action = consumeProtectedAction();
  if (action === null || action.type === 'PROFILE') {
    void uni.reLaunch({ url: '/pages/profile/index' });
    return;
  }
  if (action.type === 'ADDRESS_LIST' || action.type === 'ADDRESS_EDIT') {
    const fallback = action.type === 'ADDRESS_LIST'
      ? '/pages/address/index'
      : `/pages/address/edit${action.address_id === undefined
        ? ''
        : `?address_id=${encodeURIComponent(action.address_id)}`}`;
    returnToOrigin(fallback);
    return;
  }
  if (action.type === 'CART' || action.type === 'FAVORITES') {
    returnToOrigin(action.type === 'CART' ? '/pages/cart/index' : '/pages/favorites/index');
    return;
  }
  if (action.type === 'SERVICE_AGENT') {
    returnToOrigin('/pages/profile/agent');
    return;
  }
  if (action.type === 'CHECKOUT') {
    replaceCurrentPage('/pages/checkout/index?source=CART');
    return;
  }
  if (action.type === 'ORDERS') {
    replaceCurrentPage('/pages/orders/index');
    return;
  }
  if (action.type === 'ORDER_DETAIL') {
    replaceCurrentPage(`/pages/orders/detail?order_id=${encodeURIComponent(action.order_id)}`);
    return;
  }
  if (action.type === 'FAVORITE') {
    await resumeFavorite(action.product_id);
    return;
  }
  if (action.type === 'CART_ADD') {
    returnToOrigin(`/pages/product/detail?product_id=${encodeURIComponent(action.product_id)}`);
    showResumeResult('请重新确认加入购物车');
    return;
  }
  replaceCurrentPage(`/pages/checkout/index?source=BUY_NOW&product_id=${encodeURIComponent(action.product_id)}&sku_id=${encodeURIComponent(action.sku_id)}&quantity=${action.quantity}`);
}

export function openLoginForAction(action: ProtectedAction): void {
  setProtectedAction(action);
  void uni.navigateTo({
    url: '/pages/auth/login',
    fail: clearProtectedAction,
  });
}

export function replaceWithLoginForAction(action: ProtectedAction): void {
  setProtectedAction(action);
  void uni.redirectTo({
    url: '/pages/auth/login',
    fail: () => {
      void uni.reLaunch({
        url: '/pages/auth/login',
        fail: clearProtectedAction,
      });
    },
  });
}

export function replaceWithLoginForCandidateDecision(
  handlers: {
    readonly onFailure?: () => void;
    readonly onSuccess?: () => void;
  } = {},
): void {
  if (pendingAction === null) {
    throw new Error('A protected action is required for candidate reauthentication');
  }
  void uni.redirectTo({
    url: '/pages/auth/login?resume_candidate=1',
    ...(handlers.onSuccess ? { success: handlers.onSuccess } : {}),
    ...(handlers.onFailure ? { fail: handlers.onFailure } : {}),
  });
}
