export type ProtectedAction =
  | { readonly type: 'CHECKOUT' }
  | { readonly type: 'FAVORITE'; readonly product_id: string }
  | { readonly type: 'PROFILE' }
  | { readonly type: 'SERVICE_AGENT' }
  | { readonly type: 'BUY_NOW'; readonly product_id: string };

let pendingAction: ProtectedAction | null = null;

function isUlid(value: string): boolean {
  return /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(value);
}

export function setProtectedAction(action: ProtectedAction): void {
  if ((action.type === 'FAVORITE' || action.type === 'BUY_NOW') && !isUlid(action.product_id)) {
    throw new Error('Protected action product ID is invalid');
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

export function resumeProtectedAction(): void {
  const action = consumeProtectedAction();
  if (action === null || action.type === 'PROFILE') {
    void uni.reLaunch({ url: '/pages/profile/index' });
    return;
  }
  if (action.type === 'SERVICE_AGENT') {
    returnToOrigin('/pages/profile/agent');
    return;
  }
  if (action.type === 'CHECKOUT') {
    returnToOrigin('/pages/cart/index', '结算尚未开放');
    return;
  }
  returnToOrigin(
    `/pages/product/detail?product_id=${encodeURIComponent(action.product_id)}`,
    action.type === 'FAVORITE' ? '收藏尚未开放' : '立即购买尚未开放',
  );
}

export function openLoginForAction(action: ProtectedAction): void {
  setProtectedAction(action);
  void uni.navigateTo({
    url: '/pages/auth/login',
    fail: clearProtectedAction,
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
