import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearProtectedAction,
  consumeProtectedAction,
  openCandidateDecisionPage,
  openLoginForAction,
  replaceWithLoginForCandidateDecision,
  resumeProtectedAction,
  setProtectedAction,
} from './protected-action';
import { clearCustomerSession, saveCustomerSession } from './customer-session';

describe('closed protected action handoff', () => {
  afterEach(() => {
    clearProtectedAction();
    clearCustomerSession();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stores only a closed descriptor and consumes it once', () => {
    setProtectedAction({ type: 'PROFILE' });
    expect(consumeProtectedAction()).toEqual({ type: 'PROFILE' });
    expect(consumeProtectedAction()).toBeNull();
    expect(() => setProtectedAction({
      type: 'FAVORITE',
      product_id: 'https://attacker.example',
    })).toThrow('Protected action product ID is invalid');
  });

  it('opens login without serializing the action into a URL', () => {
    const navigateTo = vi.fn();
    vi.stubGlobal('uni', { navigateTo });
    openLoginForAction({ type: 'CHECKOUT' });
    expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/auth/login',
    }));
    expect(consumeProtectedAction()).toEqual({ type: 'CHECKOUT' });
  });

  it('clears the descriptor when opening the login page fails', () => {
    const navigateTo = vi.fn((options: UniNamespace.NavigateToOptions) => options.fail?.({
      errMsg: 'navigateTo:fail',
    }));
    vi.stubGlobal('uni', { navigateTo });
    openLoginForAction({ type: 'CHECKOUT' });
    expect(consumeProtectedAction()).toBeNull();
  });

  it('replaces a candidate page with a fixed reauthentication route and preserves the action', () => {
    const redirectTo = vi.fn();
    vi.stubGlobal('uni', { redirectTo });
    setProtectedAction({ type: 'CHECKOUT' });
    replaceWithLoginForCandidateDecision();
    expect(redirectTo).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/auth/login?resume_candidate=1',
    }));
    expect(consumeProtectedAction()).toEqual({ type: 'CHECKOUT' });
  });

  it('refuses candidate reauthentication without an existing protected action', () => {
    expect(() => replaceWithLoginForCandidateDecision()).toThrow(
      'A protected action is required for candidate reauthentication',
    );
  });

  it('returns to the existing protected page instance and consumes the action once', () => {
    vi.useFakeTimers();
    const showModal = vi.fn();
    const navigateBack = vi.fn((options: UniNamespace.NavigateBackOptions) => options.success?.({
      errMsg: 'navigateBack:ok',
    }));
    vi.stubGlobal('uni', { navigateBack, showModal });
    setProtectedAction({ type: 'CHECKOUT' });
    resumeProtectedAction();
    expect(navigateBack).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(showModal).toHaveBeenCalledWith(expect.objectContaining({ title: '结算尚未开放' }));
    expect(consumeProtectedAction()).toBeNull();
  });

  it('resumes the profile action once', () => {
    const reLaunch = vi.fn(() => Promise.resolve());
    vi.stubGlobal('uni', { reLaunch });
    setProtectedAction({ type: 'PROFILE' });
    resumeProtectedAction();
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/profile/index' });
    expect(consumeProtectedAction()).toBeNull();
  });

  it('executes a favorite handoff once with one idempotent PUT', async () => {
    vi.useFakeTimers();
    let request: UniNamespace.RequestOptions | undefined;
    const navigateBack = vi.fn((options: UniNamespace.NavigateBackOptions) => options.success?.({
      errMsg: 'navigateBack:ok',
    }));
    const showToast = vi.fn();
    vi.stubGlobal('uni', {
      navigateBack,
      removeStorageSync: vi.fn(),
      request: (options: UniNamespace.RequestOptions) => {
        request = options;
        return { abort() {} } as UniNamespace.RequestTask;
      },
      showToast,
    });
    saveCustomerSession({
      access_token: 'favorite-access-token-1',
      refresh_token: 'favorite-refresh-token-1',
      role: 'CUSTOMER',
      assurance: 'WECHAT',
      access_expires_at: '2030-01-01T00:00:00.000Z',
      refresh_expires_at: '2030-02-01T00:00:00.000Z',
    });
    const productId = '01J00000000000000000000000';
    setProtectedAction({ type: 'FAVORITE', product_id: productId });
    const pending = resumeProtectedAction();
    expect(request).toMatchObject({ method: 'PUT', url: `/api/v1/store/favorites/${productId}` });
    request?.success?.({
      data: {
        code: 'OK', message: 'success',
        data: { product_id: productId, is_favorite: true }, request_id: 'req_favorite',
      },
      statusCode: 200,
      header: {},
      cookies: [],
    });
    await pending;
    expect(navigateBack).toHaveBeenCalledOnce();
    expect(consumeProtectedAction()).toBeNull();
    vi.runAllTimers();
    expect(showToast).toHaveBeenCalledWith({ icon: 'none', title: '已收藏' });
  });

  it('returns an address handoff without carrying address PII', async () => {
    const navigateBack = vi.fn((options: UniNamespace.NavigateBackOptions) => options.success?.({
      errMsg: 'navigateBack:ok',
    }));
    vi.stubGlobal('uni', { navigateBack });
    setProtectedAction({ type: 'ADDRESS_EDIT', address_id: '01J70000000000000000000000' });
    await resumeProtectedAction();
    expect(navigateBack).toHaveBeenCalledOnce();
    expect(consumeProtectedAction()).toBeNull();
  });

  it('returns an authenticated cart-add handoff without applying the command', async () => {
    vi.useFakeTimers();
    const navigateBack = vi.fn((options: UniNamespace.NavigateBackOptions) => options.success?.({
      errMsg: 'navigateBack:ok',
    }));
    const showToast = vi.fn();
    vi.stubGlobal('uni', { navigateBack, showToast });
    setProtectedAction({ type: 'CART_ADD', product_id: '01J00000000000000000000000' });
    await resumeProtectedAction();
    expect(navigateBack).toHaveBeenCalledOnce();
    expect(consumeProtectedAction()).toBeNull();
    vi.runAllTimers();
    expect(showToast).toHaveBeenCalledWith({ icon: 'none', title: '请重新确认加入购物车' });
  });

  it('falls back to a page reset when opening candidate confirmation fails', () => {
    const onFailure = vi.fn();
    const onSuccess = vi.fn();
    const redirectTo = vi.fn((options: UniNamespace.RedirectToOptions) => options.fail?.({
      errMsg: 'redirectTo:fail',
    }));
    const reLaunch = vi.fn((options: UniNamespace.ReLaunchOptions) => options.success?.({
      errMsg: 'reLaunch:ok',
    }));
    vi.stubGlobal('uni', { reLaunch, redirectTo });
    setProtectedAction({ type: 'SERVICE_AGENT' });
    openCandidateDecisionPage({ onFailure, onSuccess });
    expect(reLaunch).toHaveBeenCalledWith(expect.objectContaining({
      url: '/pages/profile/agent?source=login',
    }));
    expect(onSuccess).toHaveBeenCalledOnce();
    expect(onFailure).not.toHaveBeenCalled();
    expect(consumeProtectedAction()).toEqual({ type: 'SERVICE_AGENT' });
  });

  it('reports a candidate navigation failure without consuming the pending action', () => {
    const onFailure = vi.fn();
    const redirectTo = vi.fn((options: UniNamespace.RedirectToOptions) => options.fail?.({
      errMsg: 'redirectTo:fail',
    }));
    const reLaunch = vi.fn((options: UniNamespace.ReLaunchOptions) => options.fail?.({
      errMsg: 'reLaunch:fail',
    }));
    vi.stubGlobal('uni', { reLaunch, redirectTo });
    setProtectedAction({ type: 'SERVICE_AGENT' });
    openCandidateDecisionPage({ onFailure });
    expect(onFailure).toHaveBeenCalledOnce();
    expect(consumeProtectedAction()).toEqual({ type: 'SERVICE_AGENT' });
  });

  it('does not resume an old operation after the candidate decision page is abandoned', () => {
    const navigateBack = vi.fn();
    const reLaunch = vi.fn();
    vi.stubGlobal('uni', { navigateBack, reLaunch });
    setProtectedAction({ type: 'CHECKOUT' });
    clearProtectedAction();
    resumeProtectedAction();
    expect(reLaunch).toHaveBeenCalledWith({ url: '/pages/profile/index' });
    expect(navigateBack).not.toHaveBeenCalled();
  });
});
