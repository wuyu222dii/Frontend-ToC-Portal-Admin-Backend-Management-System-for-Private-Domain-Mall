import { expect, test, type Page, type Route } from '@playwright/test';

const ACCESS_TOKEN = `access_${'a'.repeat(48)}`;
const REFRESH_TOKEN = `refresh_${'b'.repeat(48)}`;
const NEXT_ACCESS_TOKEN = `access_${'c'.repeat(48)}`;
const NEXT_REFRESH_TOKEN = `refresh_${'d'.repeat(48)}`;
const LOGIN_CODE = 'mock:b7_ui_customer';
const PRIMARY_PHONE = ['138', '0000', '0000'].join('');
const REPLACEMENT_PHONE = ['139', '0000', '0001'].join('');
const PHONE_CREDENTIAL = `mock:phone:${PRIMARY_PHONE}`;
const REPLACEMENT_PHONE_CREDENTIAL = `mock:phone:${REPLACEMENT_PHONE}`;
const PRIMARY_PHONE_MASK = `${PRIMARY_PHONE.slice(0, 3)} **** ${PRIMARY_PHONE.slice(-4)}`;
const REPLACEMENT_PHONE_MASK = `${REPLACEMENT_PHONE.slice(0, 3)} **** ${REPLACEMENT_PHONE.slice(-4)}`;
const PRODUCT_ID = '01J00000000000000000000000';
const CANDIDATE_ID = '01J10000000000000000000000';
const AGENT_ID = '01J20000000000000000000000';
const CUSTOMER_ID = '01J30000000000000000000000';
const SKU_TWO_ID = '01J50000000000000000000000';
const PROMOTION_ASSET_ID = '01J60000000000000000000000';
const CART_ID = '01J70000000000000000000000';
const FAVORITE_ID = '01J80000000000000000000000';
const PREVIEW_TOKEN = `pvw_${'e'.repeat(43)}`;
const CONFIRMATION_HASH = 'f'.repeat(64);
const CANDIDATE_TOKEN = `candidate_${'g'.repeat(48)}`;

const session = {
  access_token: ACCESS_TOKEN,
  refresh_token: REFRESH_TOKEN,
  role: 'CUSTOMER',
  assurance: 'WECHAT',
  access_expires_at: '2099-08-27T12:15:00.000Z',
  refresh_expires_at: '2099-09-03T12:00:00.000Z',
};

const impacts = [
  'REVOKE_ALL_SESSIONS',
  'END_SERVICE_AGENT_BINDING',
  'INVALIDATE_ATTRIBUTION_CANDIDATES',
  'ANONYMIZE_ACCOUNT_PROFILE',
  'DELETE_NON_TRANSACTIONAL_PII',
  'ANONYMIZE_AGENT_HISTORY',
  'RETAIN_REQUIRED_TRANSACTION_FACTS',
];

function candidateView(expiresInMs = 30 * 60 * 1_000) {
  return {
    candidate_id: CANDIDATE_ID,
    agent_id: AGENT_ID,
    display_name: '青序服务代理',
    confirmation_required: true,
    attribution_eligible: true,
    public_target_url: 'https://example.invalid/products/b7',
    expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    remaining_seconds: Math.max(0, Math.ceil(expiresInMs / 1_000)),
  };
}

function success(data: unknown) {
  return { code: 'OK', message: 'success', data, request_id: 'req_b7_ui' };
}

function failure(code: string, message: string) {
  return { code, message, request_id: 'req_b7_ui_error' };
}

async function fulfill(route: Route, status: number, payload: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    body: JSON.stringify(payload),
    contentType: 'application/json',
    headers: {
      'Cache-Control': 'no-store, private',
      Pragma: 'no-cache',
      ...headers,
    },
    status,
  });
}

interface ApiCall {
  body: Record<string, unknown> | null;
  method: string;
  path: string;
}

class MockB7Backend {
  readonly calls: ApiCall[] = [];
  profile = {
    avatar_url: null as string | null,
    city: '杭州' as string | null,
    customer_id: CUSTOMER_ID,
    nickname: '青序用户' as string | null,
    phone_masked: null as string | null,
    phone_source: null as string | null,
    phone_tail: null as string | null,
    phone_verified_at: null as string | null,
    version: 1,
  };
  candidate: Record<string, unknown> | null = null;
  serviceAgent: Record<string, unknown> | null = null;
  loginConflictOnce = false;
  loginCandidatePlan: Array<'current' | 'none'> = [];
  loginDelayMs = 0;
  loginFailurePlan: Array<401 | 500> = [];
  legalFailurePlan: Array<429 | 500> = [];
  profileConflictOnce = false;
  phoneConflictOnce = false;
  phoneFailureOnce = false;
  phoneRevokeConflictOnce = false;
  expireConcurrentProfileLoad = false;
  refreshFailureOnce = false;
  candidateConfirmConflictOnce = false;
  candidateConfirmUnauthorizedOnce = false;
  candidateRejectConflictOnce = false;
  deletionConfirmConflictOnce = false;
  deletionConfirmUnauthorizedOnce = false;
  deletionConfirmUnknownOnce = false;
  confirmDeletionBlockedOnce = false;
  deletionPlan: Array<'blocked' | 'eligible'> = ['eligible'];
  deletionExpiryMs: number | null = null;
  legalGeneration = 1;
  favorite = false;
  cartItems: Array<{ quantity: number; selected: boolean; sku_id: string }> = [];
  private expiredProtectedPaths = new Set<string>();

  install(page: Page): Promise<void> {
    return page.route('**/api/v1/store/**', (route) => this.handle(route));
  }

  count(path: string, method?: string): number {
    return this.calls.filter((call) => call.path === path && (!method || call.method === method)).length;
  }

  private documents() {
    const suffix = `v${this.legalGeneration}`;
    return {
      phone_authorization: {
        type: 'PHONE_AUTHORIZATION',
        title: `手机号授权说明 ${suffix}`,
        document_version: `phone-${suffix}`,
        content_url: 'https://example.invalid/legal/phone',
        required: true,
      },
      privacy_policy: {
        type: 'PRIVACY_POLICY',
        title: `隐私政策 ${suffix}`,
        document_version: `privacy-${suffix}`,
        content_url: 'https://example.invalid/legal/privacy',
        required: true,
      },
      user_agreement: {
        type: 'USER_AGREEMENT',
        title: `用户协议 ${suffix}`,
        document_version: `user-${suffix}`,
        content_url: 'https://example.invalid/legal/user',
        required: true,
      },
    };
  }

  private cartView() {
    const items = this.cartItems.map((item) => {
      const second = item.sku_id === SKU_TWO_ID;
      return {
        sku_id: item.sku_id,
        product_id: PRODUCT_ID,
        product_name: 'B7 测试商品',
        sku_name: second ? '旅行装' : '标准装',
        spec_json: { attributes: second ? [{ name: '容量', value: '100ml' }] : [] },
        primary_image_url: null,
        quantity: item.quantity,
        selected: item.selected,
        retail_price: second ? '49.00' : '39.00',
        available_stock: second ? 6 : 3,
        sale_status: 'SALEABLE',
      };
    });
    const cents = items.reduce((total, item) => item.selected
      ? total + Number(item.retail_price) * 100 * item.quantity
      : total, 0);
    return {
      cart_id: items.length === 0 ? null : CART_ID,
      items,
      total_amount: `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
    };
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    let body: Record<string, unknown> | null = null;
    if (request.postData()) body = request.postDataJSON() as Record<string, unknown>;
    this.calls.push({ body, method, path: url.pathname });

    if (url.pathname === '/api/v1/store/home' && method === 'GET') {
      await fulfill(route, 200, success({
        banners: [],
        categories: [],
        hot_products: [],
        new_products: [],
        section_status: {
          banners: 'READY', categories: 'READY', hot_products: 'READY', new_products: 'READY',
        },
      }));
      return;
    }
    if (url.pathname === `/api/v1/store/products/${PRODUCT_ID}` && method === 'GET') {
      await fulfill(route, 200, success({
        product_id: PRODUCT_ID,
        spu_code: 'B7-SPU',
        name: 'B7 测试商品',
        subtitle: '仅用于界面测试',
        introduction: '测试介绍',
        ingredients: null,
        usage_method: null,
        brand: { brand_id: AGENT_ID, name: '青序', description: null, logo_url: null, sort_order: 0 },
        category: { category_id: CANDIDATE_ID, name: '测试分类', icon_url: null, sort_order: 0 },
        images: [],
        skus: [{
          sku_id: CUSTOMER_ID,
          code: 'B7-SKU',
          name: '标准装',
          spec_json: { attributes: [] },
          retail_price: '39.00',
          is_recommended: true,
          available_stock: 3,
          is_salable: true,
        }, {
          sku_id: SKU_TWO_ID,
          code: 'B7-SKU-TRAVEL',
          name: '旅行装',
          spec_json: { attributes: [{ name: '容量', value: '100ml' }] },
          retail_price: '49.00',
          is_recommended: false,
          available_stock: 6,
          is_salable: true,
        }],
        net_sales_count: 0,
        is_hot: false,
        is_new: false,
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/favorites' && method === 'GET') {
      await fulfill(route, 200, success({
        items: this.favorite ? [{
          favorite_id: FAVORITE_ID,
          created_at: '2026-08-28T01:00:00.000Z',
          product: {
            product_id: PRODUCT_ID,
            name: 'B7 测试商品',
            primary_image_url: null,
            minimum_active_price: '39.00',
            is_salable: true,
            availability: 'SALEABLE',
          },
        }] : [],
        pagination: { page: 1, page_size: 20, total: this.favorite ? 1 : 0 },
      }));
      return;
    }
    if (url.pathname === `/api/v1/store/favorites/${PRODUCT_ID}` &&
      ['DELETE', 'GET', 'PUT'].includes(method)) {
      if (method === 'PUT') this.favorite = true;
      if (method === 'DELETE') this.favorite = false;
      await fulfill(route, 200, success({ product_id: PRODUCT_ID, is_favorite: this.favorite }));
      return;
    }
    if (url.pathname === '/api/v1/store/cart/merge' && method === 'POST') {
      const incoming = Array.isArray(body?.items)
        ? body.items as Array<{ quantity: number; selected: boolean; sku_id: string }>
        : [];
      for (const item of incoming) {
        const existing = this.cartItems.find((current) => current.sku_id === item.sku_id);
        if (existing) {
          existing.quantity = Math.min(99, existing.quantity + item.quantity);
          existing.selected ||= item.selected;
        } else {
          this.cartItems.push({ ...item });
        }
      }
      await fulfill(route, 200, success(this.cartView()));
      return;
    }
    if (url.pathname === '/api/v1/store/cart' && method === 'GET') {
      await fulfill(route, 200, success(this.cartView()));
      return;
    }
    if (url.pathname === '/api/v1/store/addresses' && method === 'GET') {
      await fulfill(route, 200, success([]));
      return;
    }
    if (url.pathname === '/api/v1/store/legal-documents' && method === 'GET') {
      const failureStatus = this.legalFailurePlan.shift();
      if (failureStatus === 429) {
        await fulfill(route, 429, failure('RATE_LIMITED', 'Too many requests'), { 'Retry-After': '1' });
        return;
      }
      if (failureStatus === 500) {
        await fulfill(route, 500, failure('INTERNAL_ERROR', 'Legal documents unavailable'));
        return;
      }
      await fulfill(route, 200, success(this.documents()));
      return;
    }
    if (url.pathname === '/api/v1/store/auth/wechat/login' && method === 'POST') {
      if (this.loginDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.loginDelayMs));
      }
      const failureStatus = this.loginFailurePlan.shift();
      if (failureStatus !== undefined) {
        await fulfill(route, failureStatus, failure(
          failureStatus === 401 ? 'WECHAT_CODE_INVALID' : 'INTERNAL_ERROR',
          failureStatus === 401 ? 'Wechat code rejected' : 'Login unavailable',
        ));
        return;
      }
      if (this.loginConflictOnce) {
        this.loginConflictOnce = false;
        this.legalGeneration += 1;
        await fulfill(route, 409, failure('CONSENT_VERSION_MISMATCH', 'Legal documents changed'));
        return;
      }
      const candidateMode = this.loginCandidatePlan.shift() ?? 'current';
      const currentCandidate = candidateMode === 'none' ? null : this.candidate;
      await fulfill(route, 200, success({
        candidate: currentCandidate === null ? null : {
          candidate_id: currentCandidate.candidate_id,
          agent_id: currentCandidate.agent_id,
          display_name: currentCandidate.display_name,
          expires_at: currentCandidate.expires_at,
          attribution_eligible: true,
          public_target_url: currentCandidate.public_target_url,
        },
        confirmation_required: currentCandidate !== null,
        session,
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/auth/refresh' && method === 'POST') {
      if (this.refreshFailureOnce) {
        this.refreshFailureOnce = false;
        await fulfill(route, 401, failure('SESSION_EXPIRED', 'Refresh expired'));
        return;
      }
      await fulfill(route, 200, success({
        ...session,
        access_token: NEXT_ACCESS_TOKEN,
        refresh_token: NEXT_REFRESH_TOKEN,
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/auth/logout' && method === 'POST') {
      await fulfill(route, 200, success({
        resource_type: 'CUSTOMER_SESSION',
        resource_id: CUSTOMER_ID,
        status: 'REVOKED',
        version: 2,
        occurred_at: '2026-08-27T12:00:00.000Z',
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/profile' && method === 'GET') {
      if (this.expireConcurrentProfileLoad && !this.expiredProtectedPaths.has(url.pathname)) {
        this.expiredProtectedPaths.add(url.pathname);
        await new Promise((resolve) => setTimeout(resolve, 25));
        await fulfill(route, 401, failure('AUTH_REQUIRED', 'Session expired'));
        return;
      }
      await fulfill(route, 200, success(this.profile));
      return;
    }
    if (url.pathname === '/api/v1/store/profile' && method === 'PATCH') {
      if (this.profileConflictOnce) {
        this.profileConflictOnce = false;
        this.profile = { ...this.profile, nickname: '服务端最新昵称', version: this.profile.version + 1 };
        await fulfill(route, 409, failure('RESOURCE_VERSION_CONFLICT', 'Profile changed'));
        return;
      }
      this.profile = {
        ...this.profile,
        avatar_url: body?.avatar_url as string | null,
        city: body?.city as string | null,
        nickname: body?.nickname as string | null,
        version: this.profile.version + 1,
      };
      await fulfill(route, 200, success(this.profile));
      return;
    }
    if (url.pathname === '/api/v1/store/profile/phone-authorizations' && method === 'POST') {
      if (this.phoneFailureOnce) {
        this.phoneFailureOnce = false;
        await fulfill(route, 500, failure('INTERNAL_ERROR', 'Phone provider unavailable'));
        return;
      }
      if (this.phoneConflictOnce) {
        this.phoneConflictOnce = false;
        this.profile = { ...this.profile, version: this.profile.version + 1 };
        await fulfill(route, 409, failure('RESOURCE_VERSION_CONFLICT', 'Phone state changed'));
        return;
      }
      const isReplacement = String(body?.provider_credential ?? '').includes('139');
      this.profile = {
        ...this.profile,
        phone_masked: isReplacement ? REPLACEMENT_PHONE_MASK : PRIMARY_PHONE_MASK,
        phone_source: 'MOCK',
        phone_tail: isReplacement ? '0001' : '0000',
        phone_verified_at: '2026-08-27T12:00:00.000Z',
        version: this.profile.version + 1,
      };
      await fulfill(route, 200, success(this.profile));
      return;
    }
    if (url.pathname === '/api/v1/store/profile/phone' && method === 'DELETE') {
      if (this.phoneRevokeConflictOnce) {
        this.phoneRevokeConflictOnce = false;
        this.profile = { ...this.profile, version: this.profile.version + 1 };
        await fulfill(route, 409, failure('RESOURCE_VERSION_CONFLICT', 'Phone state changed'));
        return;
      }
      this.profile = {
        ...this.profile,
        phone_masked: null,
        phone_source: null,
        phone_tail: null,
        phone_verified_at: null,
        version: this.profile.version + 1,
      };
      await fulfill(route, 200, success(this.profile));
      return;
    }
    if (url.pathname === '/api/v1/store/service-agent' && method === 'GET') {
      if (this.expireConcurrentProfileLoad && !this.expiredProtectedPaths.has(url.pathname)) {
        this.expiredProtectedPaths.add(url.pathname);
        await new Promise((resolve) => setTimeout(resolve, 25));
        await fulfill(route, 401, failure('AUTH_REQUIRED', 'Session expired'));
        return;
      }
      await fulfill(route, 200, success(this.serviceAgent));
      return;
    }
    if (url.pathname === '/api/v1/store/attribution/candidate' && method === 'GET') {
      await fulfill(route, 200, success(this.candidate));
      return;
    }
    if (url.pathname === '/api/v1/store/attribution/candidates' && method === 'POST') {
      if (request.headers().authorization && this.serviceAgent !== null) {
        this.candidate = null;
        await fulfill(route, 200, success({
          candidate: null,
          candidate_token: null,
          service_agent: this.serviceAgent,
          public_fallback: null,
        }));
        return;
      }
      this.candidate = candidateView();
      await fulfill(route, 200, success({
        candidate: this.candidate,
        candidate_token: request.headers().authorization ? null : CANDIDATE_TOKEN,
        service_agent: null,
        public_fallback: null,
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/attribution/candidate/confirm' && method === 'POST') {
      if (this.candidateConfirmUnauthorizedOnce) {
        this.candidateConfirmUnauthorizedOnce = false;
        await fulfill(route, 401, failure('SESSION_EXPIRED', 'Session expired'));
        return;
      }
      if (this.candidateConfirmConflictOnce) {
        this.candidateConfirmConflictOnce = false;
        this.candidate = null;
        this.serviceAgent = {
          agent_id: AGENT_ID,
          display_name: '青序服务代理',
          bound_at: '2026-08-27T12:00:00.000Z',
        };
        await fulfill(route, 409, failure('ATTRIBUTION_CANDIDATE_CONFLICT', 'Candidate resolved'));
        return;
      }
      this.serviceAgent = {
        agent_id: AGENT_ID,
        display_name: '青序服务代理',
        bound_at: '2026-08-27T12:00:00.000Z',
      };
      this.candidate = null;
      await fulfill(route, 200, success(this.serviceAgent));
      return;
    }
    if (url.pathname === '/api/v1/store/attribution/candidate/reject' && method === 'POST') {
      if (this.candidateRejectConflictOnce) {
        this.candidateRejectConflictOnce = false;
        this.candidate = null;
        await fulfill(route, 409, failure('ATTRIBUTION_CANDIDATE_CONFLICT', 'Candidate resolved'));
        return;
      }
      this.candidate = null;
      await fulfill(route, 200, success({
        candidate_id: CANDIDATE_ID,
        status: 'REJECTED',
        rejected_at: '2026-08-27T12:00:00.000Z',
      }));
      return;
    }
    if (url.pathname === '/api/v1/store/privacy/deletion-requests/preview' && method === 'POST') {
      const state = this.deletionPlan.shift() ?? 'eligible';
      await fulfill(route, 200, success(state === 'blocked'
        ? {
            account_version: 1,
            blockers: [{ count: 1, resource_type: 'ORDER' }],
            confirmation_hash: null,
            eligible: false,
            expires_at: null,
            impacts,
            preview_token: null,
          }
        : {
            account_version: 1,
            blockers: [],
            confirmation_hash: CONFIRMATION_HASH,
            eligible: true,
            expires_at: this.deletionExpiryMs === null
              ? '2099-08-27T12:05:00.000Z'
              : new Date(Date.now() + this.deletionExpiryMs).toISOString(),
            impacts,
            preview_token: PREVIEW_TOKEN,
          }));
      return;
    }
    if (url.pathname === '/api/v1/store/privacy/deletion-requests' && method === 'POST') {
      if (this.deletionConfirmUnknownOnce) {
        this.deletionConfirmUnknownOnce = false;
        await route.abort('failed');
        return;
      }
      if (this.deletionConfirmUnauthorizedOnce) {
        this.deletionConfirmUnauthorizedOnce = false;
        await fulfill(route, 401, failure('SESSION_EXPIRED', 'Session expired'));
        return;
      }
      if (this.deletionConfirmConflictOnce) {
        this.deletionConfirmConflictOnce = false;
        await fulfill(route, 409, failure('RESOURCE_VERSION_CONFLICT', 'Deletion capability changed'));
        return;
      }
      if (this.confirmDeletionBlockedOnce) {
        this.confirmDeletionBlockedOnce = false;
        await fulfill(route, 422, failure('ACCOUNT_DELETION_BLOCKED', 'Deletion is blocked'));
        return;
      }
      await fulfill(route, 200, success({
        completed_at: '2026-08-27T12:01:00.000Z',
        request_id: '01J40000000000000000000000',
        status: 'COMPLETED',
        submitted_at: '2026-08-27T12:01:00.000Z',
      }));
      return;
    }

    await fulfill(route, 500, failure('UNHANDLED_TEST_ROUTE', `${method} ${url.pathname}`));
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function inputByLabel(page: Page, label: string) {
  return page.getByLabel(label).locator('input');
}

function uniButton(page: Page, label: string) {
  return page.locator('uni-button').filter({
    hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`),
  });
}

function accountRow(page: Page, label: string) {
  return page.locator('uni-button.qx-account-row').filter({ hasText: label });
}

function visibleText(page: Page, label: string) {
  return page.getByText(label, { exact: true }).last();
}

async function webStorage(page: Page): Promise<string> {
  return page.evaluate(() => {
    const entries = (storage: Storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index);
      return [key, key === null ? null : storage.getItem(key)];
    });
    return JSON.stringify({ local: entries(localStorage), session: entries(sessionStorage) });
  });
}

async function submitLogin(page: Page): Promise<void> {
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();
}

async function loginToProfile(page: Page): Promise<void> {
  await page.goto('/#/pages/auth/login');
  await expect(page.getByText('微信登录', { exact: true }).first()).toBeVisible();
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
  await expect(page.getByText('个人中心', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('本人资料摘要')).toBeVisible();
}

async function configureSecondProductSku(page: Page): Promise<void> {
  await expect(page.getByText('B7 测试商品', { exact: true })).toBeVisible();
  await page.locator('uni-button.detail-choice__row').first().click();
  const secondSku = page.locator('uni-button.sku-option').filter({ hasText: '容量：100ml' });
  await secondSku.click();
  await page.locator('.sku-stepper').getByLabel('增加数量').click();
  await expect(page.locator('.sku-stepper')).toContainText('2');
  await page.locator('uni-button.sku-sheet__confirm').click();
  await expect(page.locator('.sku-sheet')).toBeHidden();
}

async function navigateWithinMiniapp(page: Page, url: string): Promise<void> {
  await page.evaluate((target) => new Promise<void>((resolve, reject) => {
    const runtime = (globalThis as unknown as {
      uni: {
        navigateTo: (options: {
          fail: (error: unknown) => void;
          success: () => void;
          url: string;
        }) => unknown;
      };
    }).uni;
    runtime.navigateTo({ fail: reject, success: resolve, url: target });
  }), url);
}

async function openSignedInConfiguredProduct(page: Page): Promise<void> {
  await loginToProfile(page);
  await navigateWithinMiniapp(page, `/pages/product/detail?product_id=${PRODUCT_ID}`);
  await configureSecondProductSku(page);
}

async function openPromotionAgentFromProduct(page: Page): Promise<void> {
  await navigateWithinMiniapp(
    page,
    `/pages/profile/agent?invite_code=b7-other-invite&promotion_asset_id=${PROMOTION_ASSET_ID}`,
  );
  await expect(page).toHaveURL(/\/pages\/profile\/agent\?invite_code=b7-other-invite/);
}

async function expectConfiguredProductState(page: Page): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));
  await page.locator('uni-button.detail-choice__row').first().click();
  const secondSku = page.locator('uni-button.sku-option').filter({ hasText: '容量：100ml' });
  await expect(secondSku).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.sku-stepper')).toContainText('2');
}

function forbiddenBusinessCalls(backend: MockB7Backend): ApiCall[] {
  return backend.calls.filter(({ path }) =>
    /^\/api\/v1\/(?:store\/)?(?:checkout|orders?)(?:\/|$)/.test(path));
}

test('restores the typed PROFILE action and exposes only the implemented shopping entries at every viewport',
  async ({ page }, testInfo) => {
    const backend = new MockB7Backend();
    await backend.install(page);

    await page.goto('/');
    await page.getByLabel('我的').click();
    await expect(page).toHaveURL(/\/pages\/auth\/login/);
    await expect(inputByLabel(page, 'Mock 微信 code')).toHaveAttribute('type', 'password');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('login.png') });
    await submitLogin(page);
    await expect(page).toHaveURL(/\/pages\/profile\/index/);
    await expect(page.getByText('个人中心', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/profile', 'GET')).toBe(1);

    await accountRow(page, '商品收藏').click();
    await expect(page.getByText('还没有收藏商品', { exact: true })).toBeVisible();
    await page.getByLabel('返回').click();
    await accountRow(page, '收货地址').click();
    await expect(page.getByText('暂无收货地址', { exact: true })).toBeVisible();
    await page.getByLabel('返回').click();
    await accountRow(page, '我的订单').click();
    await expect(page.getByText(/尚未开放/, { exact: false }).last()).toBeVisible();
    await visibleText(page, '知道了').click();
    expect(backend.count('/api/v1/store/favorites', 'GET')).toBe(1);
    expect(backend.count('/api/v1/store/addresses', 'GET')).toBe(1);
    expect(backend.calls.some(({ path }) => /\/orders(?:\/|$)/.test(path))).toBe(false);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('profile.png') });

    await page.getByLabel('编辑资料').click();
    await expect(page.getByText('编辑资料', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('profile-edit.png') });
    await page.getByLabel('返回').click();

    await page.getByLabel('账户手机号').click();
    await expect(page.getByText('手机号授权', { exact: true }).first()).toBeVisible();
    await expect(inputByLabel(page, 'Mock 手机号凭证')).toHaveAttribute('type', 'password');
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('phone.png') });
    await page.getByLabel('返回').click();

    await page.getByLabel('服务代理').click();
    await expect(page.getByText('服务代理', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('暂无服务代理', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('service-agent.png') });
    await page.getByLabel('返回').click();

    await page.getByLabel('账号与隐私').click();
    await expect(page.getByText('账号删除', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('privacy.png') });
    const stored = await webStorage(page);
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, LOGIN_CODE, PHONE_CREDENTIAL, PREVIEW_TOKEN]) {
      expect(stored).not.toContain(secret);
    }
  });

for (const action of [
  { control: '收藏商品', modal: null, type: 'favorite' },
  { control: '立即购买', modal: '立即购买尚未开放', type: 'buy-now' },
] as const) {
  test(`restores the existing product instance after ${action.type} login`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The protected product action matrix runs once.');
    const backend = new MockB7Backend();
    await backend.install(page);
    await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
    await configureSecondProductSku(page);

    if (action.type === 'favorite') await page.getByLabel(action.control).click();
    else await page.locator('uni-button.detail-actions__primary').click();
    await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
    await visibleText(page, '去登录').click();
    await expect(page).toHaveURL(/\/pages\/auth\/login/);
    await submitLogin(page);
    await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));
    if (action.modal === null) {
      await expect(page.getByLabel('取消收藏')).toBeVisible();
      expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'PUT')).toBe(1);
    } else {
      await expect(page.getByText(action.modal, { exact: true })).toBeVisible();
      await visibleText(page, '知道了').click();
    }

    await page.locator('uni-button.detail-choice__row').first().click();
    const secondSku = page.locator('uni-button.sku-option').filter({ hasText: '容量：100ml' });
    await expect(secondSku).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sku-stepper')).toContainText('2');
    expect(backend.count(`/api/v1/store/products/${PRODUCT_ID}`, 'GET')).toBe(1);
    expect(forbiddenBusinessCalls(backend)).toEqual([]);
    const stored = await webStorage(page);
    expect(stored).not.toContain(ACCESS_TOKEN);
    expect(stored).not.toContain(REFRESH_TOKEN);
    expect(stored).not.toContain(LOGIN_CODE);
    await expectNoHorizontalOverflow(page);
  });
}

test('keeps favorite inert while a product detail is unavailable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The unavailable product guard runs once.');
  const backend = new MockB7Backend();
  await backend.install(page);

  await page.goto('/#/pages/product/detail?product_id=invalid');
  await expect(page.getByText('商品不存在', { exact: true })).toBeVisible();
  const favorite = page.getByLabel('收藏');
  await expect(favorite).toHaveAttribute('disabled', 'true');
  await favorite.click({ force: true });
  await expect(page.getByText('请先登录', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/product_id=invalid$/);
});

test('restores the existing guest cart after checkout login', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The protected cart action matrix runs once.');
  const backend = new MockB7Backend();
  await backend.install(page);
  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText('B7 测试商品', { exact: true })).toBeVisible();
  await page.locator('uni-button.detail-actions__secondary').click();
  await page.locator('.sku-stepper').getByLabel('增加数量').click();
  await page.locator('uni-button.sku-sheet__confirm').click();
  await expect(page.locator('.sku-sheet')).toBeHidden();

  await page.goto('/#/pages/cart/index');
  const cartItem = page.locator('.cart-item').filter({ hasText: 'B7 测试商品' });
  await expect(cartItem).toBeVisible();
  await cartItem.getByLabel('增加数量').click();
  await expect(cartItem.locator('.cart-stepper')).toContainText('3');
  await page.locator('uni-button.cart-summary__checkout').click();
  await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
  await visibleText(page, '去登录').click();
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/cart\/index/);
  await expect(page.getByText('结算尚未开放', { exact: true })).toBeVisible();
  await visibleText(page, '知道了').click();
  await expect(cartItem.locator('.cart-stepper')).toContainText('3');
  expect(backend.count('/api/v1/store/cart/merge', 'POST')).toBe(1);
  expect(forbiddenBusinessCalls(backend)).toEqual([]);
  const stored = await webStorage(page);
  expect(stored).not.toContain(ACCESS_TOKEN);
  expect(stored).not.toContain(REFRESH_TOKEN);
  expect(stored).not.toContain(LOGIN_CODE);
  await expectNoHorizontalOverflow(page);
});

test('reloads current legal documents and clears consent after a 409', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The state matrix runs once.');
  const backend = new MockB7Backend();
  backend.loginConflictOnce = true;
  await backend.install(page);

  await page.goto('/#/pages/auth/login?redirect=https%3A%2F%2Fevil.invalid%2Fsteal');
  await submitLogin(page);
  await expect(page.getByRole('alert')).toContainText('协议版本已经更新');
  await expect(page.getByText('用户协议 v2', { exact: true })).toBeVisible();
  await expect(uniButton(page, '微信授权登录')).toHaveAttribute('disabled', 'true');
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
  expect(backend.count('/api/v1/store/legal-documents', 'GET')).toBe(2);

  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
  expect(page.url()).not.toContain('evil.invalid');
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(2);
});

test('refreshes profile and phone conflicts without replaying writes', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The conflict matrix runs once.');
  const backend = new MockB7Backend();
  backend.profileConflictOnce = true;
  backend.phoneConflictOnce = true;
  await backend.install(page);
  await loginToProfile(page);

  await page.getByLabel('编辑资料').click();
  await inputByLabel(page, '昵称').fill('客户端待保存昵称');
  await uniButton(page, '保存资料').click();
  await expect(page.getByRole('status')).toContainText('已刷新为最新内容');
  await expect(inputByLabel(page, '昵称')).toHaveValue('服务端最新昵称');
  expect(backend.count('/api/v1/store/profile', 'PATCH')).toBe(1);
  await inputByLabel(page, '昵称').fill('重新确认后的昵称');
  await uniButton(page, '保存资料').click();
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
  expect(backend.count('/api/v1/store/profile', 'PATCH')).toBe(2);

  await page.getByLabel('账户手机号').click();
  await inputByLabel(page, 'Mock 手机号凭证').fill(PHONE_CREDENTIAL);
  await page.getByLabel('手机号授权说明').click();
  await uniButton(page, '授权账户手机号').click();
  await expect(page.getByRole('status')).toContainText('已刷新最新内容');
  expect(backend.count('/api/v1/store/profile/phone-authorizations', 'POST')).toBe(1);
  await expect(uniButton(page, '授权账户手机号')).toHaveAttribute('disabled', 'true');
  await inputByLabel(page, 'Mock 手机号凭证').fill(PHONE_CREDENTIAL);
  await page.getByLabel('手机号授权说明').click();
  await uniButton(page, '授权账户手机号').click();
  await expect(page.getByText(PRIMARY_PHONE_MASK, { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/profile/phone-authorizations', 'POST')).toBe(2);
  await expectNoHorizontalOverflow(page);
});

test('coalesces concurrent protected 401 responses into one refresh', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The refresh matrix runs once.');
  const backend = new MockB7Backend();
  backend.expireConcurrentProfileLoad = true;
  await backend.install(page);
  await loginToProfile(page);

  await expect(page.getByText('个人中心', { exact: true }).first()).toBeVisible();
  expect(backend.count('/api/v1/store/auth/refresh', 'POST')).toBe(1);
  expect(backend.count('/api/v1/store/profile', 'GET')).toBe(2);
  expect(backend.count('/api/v1/store/service-agent', 'GET')).toBe(2);
  const stored = await webStorage(page);
  for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, NEXT_ACCESS_TOKEN, NEXT_REFRESH_TOKEN]) {
    expect(stored).not.toContain(secret);
  }
});

test('handles blocked, eligible, new-blocker and completed deletion states', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The deletion matrix runs once.');
  const backend = new MockB7Backend();
  backend.deletionPlan = ['blocked', 'eligible', 'blocked', 'eligible'];
  backend.confirmDeletionBlockedOnce = true;
  await backend.install(page);
  await loginToProfile(page);

  await page.getByLabel('账号与隐私').click();
  await page.getByLabel('知晓账号删除影响').click();
  await uniButton(page, '检查删除资格').click();
  await expect(page.getByText('当前暂不可删除账号', { exact: true })).toBeVisible();
  await expect(page.getByText('未完成订单：1 项', { exact: true })).toBeVisible();

  await uniButton(page, '检查删除资格').click();
  await expect(page.getByText('当前可以删除账号', { exact: true })).toBeVisible();
  await uniButton(page, '确认删除账号').click();
  await visibleText(page, '确认删除').click();
  await expect(page.getByRole('alert')).toContainText('删除资格已变化');
  await expect(page.getByText('当前暂不可删除账号', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/privacy/deletion-requests', 'POST')).toBe(1);

  await uniButton(page, '检查删除资格').click();
  await expect(page.getByText('当前可以删除账号', { exact: true })).toBeVisible();
  const storedBefore = await webStorage(page);
  expect(storedBefore).not.toContain(PREVIEW_TOKEN);
  expect(storedBefore).not.toContain(CONFIRMATION_HASH);
  await uniButton(page, '确认删除账号').click();
  await visibleText(page, '确认删除').click();
  await expect(page.getByText('账号已删除', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/privacy/deletion-requests', 'POST')).toBe(2);
  const storedAfter = await webStorage(page);
  for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, PREVIEW_TOKEN, CONFIRMATION_HASH]) {
    expect(storedAfter).not.toContain(secret);
  }
  await expectNoHorizontalOverflow(page);
});

test('recovers legal 429/500 and login 401/500 without duplicate submission', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The failure matrix runs once.');
  const backend = new MockB7Backend();
  backend.legalFailurePlan = [429, 500];
  backend.loginFailurePlan = [401, 500];
  await backend.install(page);

  await page.goto('/#/pages/auth/login');
  await expect(page.getByText('1秒后可重试', { exact: true })).toBeVisible();
  await expect(uniButton(page, '1秒后可重试')).toHaveAttribute('disabled', 'true');
  await expect(uniButton(page, '重新加载')).toBeVisible({ timeout: 3_000 });
  await uniButton(page, '重新加载').click();
  await expect(page.getByText('协议加载失败', { exact: true })).toBeVisible();
  await uniButton(page, '重新加载').click();
  await expect(inputByLabel(page, 'Mock 微信 code')).toBeVisible();
  expect(backend.count('/api/v1/store/legal-documents', 'GET')).toBe(3);

  await submitLogin(page);
  await expect(page.getByRole('alert')).toContainText('微信登录凭证无效');
  await expect(inputByLabel(page, 'Mock 微信 code')).toHaveValue('');
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);

  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await uniButton(page, '微信授权登录').click();
  await expect(page.getByRole('alert')).toContainText('暂时无法登录');
  await expect(inputByLabel(page, 'Mock 微信 code')).toHaveValue('');
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(2);

  backend.loginDelayMs = 150;
  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  const loginControl = page.locator('uni-button.qx-account-button').last();
  await loginControl.click();
  await loginControl.click({ force: true });
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
  await expect(page.getByLabel('本人资料摘要')).toBeVisible();
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(3);
  await expectNoHorizontalOverflow(page);
});

test('clears the session after refresh failure and after explicit logout', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The session failure matrix runs once.');
  const backend = new MockB7Backend();
  backend.expireConcurrentProfileLoad = true;
  backend.refreshFailureOnce = true;
  await backend.install(page);

  await page.goto('/#/pages/auth/login');
  await submitLogin(page);
  await expect.poll(() => backend.count('/api/v1/store/auth/refresh', 'POST')).toBe(1);
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await expect(inputByLabel(page, 'Mock 微信 code')).toBeVisible();
  expect(backend.count('/api/v1/store/auth/refresh', 'POST')).toBe(1);
  let stored = await webStorage(page);
  expect(stored).not.toContain(ACCESS_TOKEN);
  expect(stored).not.toContain(REFRESH_TOKEN);

  backend.expireConcurrentProfileLoad = false;
  await submitLogin(page);
  await expect(page.getByLabel('本人资料摘要')).toBeVisible();
  await uniButton(page, '退出登录').click();
  await expect(page.getByText('退出登录', { exact: true }).last()).toBeVisible();
  const logoutResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/store/auth/logout');
  await visibleText(page, '退出').click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/#\/$/);
  await page.getByLabel('我的').click();
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  expect(backend.count('/api/v1/store/auth/logout', 'POST')).toBe(1);
  stored = await webStorage(page);
  expect(stored).not.toContain(ACCESS_TOKEN);
  expect(stored).not.toContain(REFRESH_TOKEN);
});

test('rejects an attribution candidate once and resumes the protected profile action', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The candidate matrix runs once.');
  const backend = new MockB7Backend();
  backend.candidate = candidateView();
  await backend.install(page);

  await page.goto('/#/pages/auth/login');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/profile\/agent/);
  await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
  await uniButton(page, '暂不绑定').click();
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
  await expect(page.getByLabel('本人资料摘要')).toBeVisible();
  expect(backend.count('/api/v1/store/attribution/candidate/reject', 'POST')).toBe(1);
  expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(0);
});

test('converges a candidate confirmation conflict without replaying the command', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The candidate conflict matrix runs once.');
  const backend = new MockB7Backend();
  backend.candidate = candidateView();
  backend.candidateConfirmConflictOnce = true;
  await backend.install(page);

  await page.goto('/#/pages/auth/login');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/profile\/agent/);
  await uniButton(page, '确认服务关系').click();
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
  await expect(page.getByLabel('本人资料摘要')).toBeVisible();
  await expect(accountRow(page, '服务代理')).toContainText('青序服务代理');
  expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(1);
});

test('expires a candidate locally and removes its decision controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The candidate expiry matrix runs once.');
  const backend = new MockB7Backend();
  backend.candidate = candidateView(1_500);
  await backend.install(page);

  await page.goto('/#/pages/auth/login');
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/profile\/agent/);
  await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('推广候选已过期', { timeout: 4_000 });
  await expect(uniButton(page, '确认服务关系')).toHaveCount(0);
  await expect(uniButton(page, '暂不绑定')).toHaveCount(0);
});

test('migrates an anonymous promotion candidate and refreshes the original agent page', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The candidate migration matrix runs once.');
  const backend = new MockB7Backend();
  await backend.install(page);

  await page.goto(`/#/pages/profile/agent?invite_code=b7-invite&promotion_asset_id=${PRODUCT_ID}`);
  await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/attribution/candidates', 'POST')).toBe(1);
  const storageBeforeLogin = await webStorage(page);
  expect(storageBeforeLogin).not.toContain(CANDIDATE_TOKEN);

  await uniButton(page, '登录后确认').click();
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/profile\/agent/);
  const loginCall = backend.calls.find(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/auth/wechat/login');
  expect(loginCall?.body?.candidate_token).toBe(CANDIDATE_TOKEN);

  await uniButton(page, '确认服务关系').click();
  await expect(page.getByLabel('当前服务代理')).toBeVisible();
  await expect(page.getByLabel('当前服务代理').getByText('服务关系已确认', { exact: true })).toBeVisible();
  await expect(page.getByText('待确认服务关系', { exact: true })).toHaveCount(0);
  expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(1);
  expect(backend.count('/api/v1/store/attribution/candidate/reject', 'POST')).toBe(0);
  const storageAfterConfirm = await webStorage(page);
  expect(storageAfterConfirm).not.toContain(CANDIDATE_TOKEN);
  await expectNoHorizontalOverflow(page);
});

test('returns an authenticated promotion confirmation to the existing configured product',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The authenticated promotion return matrix runs once.');
    const backend = new MockB7Backend();
    await backend.install(page);
    await openSignedInConfiguredProduct(page);

    await openPromotionAgentFromProduct(page);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
    await uniButton(page, '确认服务关系').click();
    await expectConfiguredProductState(page);

    expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidates', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidate/reject', 'POST')).toBe(0);
    expect(backend.count(`/api/v1/store/products/${PRODUCT_ID}`, 'GET')).toBe(1);
    expect(forbiddenBusinessCalls(backend)).toEqual([]);
  });

test('returns an authenticated promotion rejection to the existing configured product',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The authenticated promotion rejection runs once.');
    const backend = new MockB7Backend();
    await backend.install(page);
    await openSignedInConfiguredProduct(page);

    await openPromotionAgentFromProduct(page);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
    await uniButton(page, '暂不绑定').click();
    await expectConfiguredProductState(page);

    expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidates', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(0);
    expect(backend.count('/api/v1/store/attribution/candidate/reject', 'POST')).toBe(1);
    expect(backend.count(`/api/v1/store/products/${PRODUCT_ID}`, 'GET')).toBe(1);
    expect(forbiddenBusinessCalls(backend)).toEqual([]);
  });

test('returns a converged promotion confirmation conflict to the existing configured product',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The authenticated promotion conflict runs once.');
    const backend = new MockB7Backend();
    backend.candidateConfirmConflictOnce = true;
    await backend.install(page);
    await openSignedInConfiguredProduct(page);

    await openPromotionAgentFromProduct(page);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
    await uniButton(page, '确认服务关系').click();
    await expectConfiguredProductState(page);

    expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidates', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidate/reject', 'POST')).toBe(0);
    expect(backend.count(`/api/v1/store/products/${PRODUCT_ID}`, 'GET')).toBe(1);
    expect(forbiddenBusinessCalls(backend)).toEqual([]);
  });

test('returns an already-bound promotion visitor to the existing configured product without a decision',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The existing service-agent promotion matrix runs once.');
    const backend = new MockB7Backend();
    backend.serviceAgent = {
      agent_id: AGENT_ID,
      display_name: '青序服务代理',
      bound_at: '2026-08-27T12:00:00.000Z',
    };
    await backend.install(page);
    await openSignedInConfiguredProduct(page);

    await openPromotionAgentFromProduct(page);
    await expectConfiguredProductState(page);

    expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidates', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(0);
    expect(backend.count('/api/v1/store/attribution/candidate/reject', 'POST')).toBe(0);
    expect(backend.count(`/api/v1/store/products/${PRODUCT_ID}`, 'GET')).toBe(1);
    expect(forbiddenBusinessCalls(backend)).toEqual([]);
  });

test('retains an anonymous promotion candidate after a provider login rejection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The candidate login retry matrix runs once.');
  const backend = new MockB7Backend();
  backend.loginFailurePlan = [401];
  await backend.install(page);

  await page.goto(`/#/pages/profile/agent?invite_code=b7-invite&promotion_asset_id=${PRODUCT_ID}`);
  await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
  await uniButton(page, '登录后确认').click();
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await expect(page.getByText(/本次登录来自 青序服务代理 的推广内容/)).toBeVisible();

  const rejectedCode = 'mock:b7_rejected_customer';
  await inputByLabel(page, 'Mock 微信 code').fill(rejectedCode);
  await page.getByLabel('用户协议').click();
  await page.getByLabel('隐私政策').click();
  await uniButton(page, '微信授权登录').click();
  await expect(page.getByRole('alert')).toContainText('微信登录凭证无效');
  await expect(inputByLabel(page, 'Mock 微信 code')).toHaveValue('');
  await expect(page.getByText(/本次登录来自 青序服务代理 的推广内容/)).toBeVisible();

  await inputByLabel(page, 'Mock 微信 code').fill(LOGIN_CODE);
  await uniButton(page, '微信授权登录').click();
  await expect(page).toHaveURL(/\/pages\/profile\/agent/);
  await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();

  const loginCalls = backend.calls.filter(({ method, path }) =>
    method === 'POST' && path === '/api/v1/store/auth/wechat/login');
  expect(loginCalls).toHaveLength(2);
  expect(loginCalls.map(({ body }) => body?.code)).toEqual([rejectedCode, LOGIN_CODE]);
  expect(loginCalls.map(({ body }) => body?.candidate_token)).toEqual([
    CANDIDATE_TOKEN,
    CANDIDATE_TOKEN,
  ]);
  expect(backend.count('/api/v1/store/attribution/candidates', 'POST')).toBe(1);
  expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(0);
  const stored = await webStorage(page);
  expect(stored).not.toContain(CANDIDATE_TOKEN);
  await expectNoHorizontalOverflow(page);
});

test('preserves a product handoff when candidate confirmation and refresh require a new login',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The candidate session recovery matrix runs once.');
    const backend = new MockB7Backend();
    backend.candidateConfirmUnauthorizedOnce = true;
    backend.loginCandidatePlan = ['current', 'none'];
    backend.refreshFailureOnce = true;
    await backend.install(page);

    await page.goto(`/#/pages/profile/agent?invite_code=b7-invite&promotion_asset_id=${PRODUCT_ID}`);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
    await page.evaluate((productId) => new Promise<void>((resolve, reject) => {
      const runtime = (globalThis as unknown as {
        uni: {
          navigateTo: (options: {
            fail: (error: unknown) => void;
            success: () => void;
            url: string;
          }) => unknown;
        };
      }).uni;
      runtime.navigateTo({
        fail: reject,
        success: resolve,
        url: `/pages/product/detail?product_id=${encodeURIComponent(productId)}`,
      });
    }), PRODUCT_ID);
    await configureSecondProductSku(page);

    await page.getByLabel('收藏商品').click();
    await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
    await visibleText(page, '去登录').click();
    await submitLogin(page);
    await expect(page).toHaveURL(/\/pages\/profile\/agent/);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();

    await uniButton(page, '确认服务关系').click();
    await expect(page).toHaveURL(/\/pages\/auth\/login/);
    await expect.poll(() => backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(1);
    expect(backend.count('/api/v1/store/auth/refresh', 'POST')).toBe(1);

    await submitLogin(page);
    await expect(page).toHaveURL(/\/pages\/profile\/agent/);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
    const loginCallsBeforeConfirmation = backend.calls.filter(({ method, path }) =>
      method === 'POST' && path === '/api/v1/store/auth/wechat/login');
    expect(loginCallsBeforeConfirmation).toHaveLength(2);
    expect(loginCallsBeforeConfirmation[0]?.body?.candidate_token).toBe(CANDIDATE_TOKEN);
    expect(loginCallsBeforeConfirmation[1]?.body?.candidate_token).toBeUndefined();
    await uniButton(page, '确认服务关系').click();
    await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));
    await expect(page.getByLabel('取消收藏')).toBeVisible();
    expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'PUT')).toBe(1);

    await page.locator('uni-button.detail-choice__row').first().click();
    const secondSku = page.locator('uni-button.sku-option').filter({ hasText: '容量：100ml' });
    await expect(secondSku).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sku-stepper')).toContainText('2');
    expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(2);
    expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(2);
    expect(backend.count(`/api/v1/store/products/${PRODUCT_ID}`, 'GET')).toBe(1);
    expect(forbiddenBusinessCalls(backend)).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });

test('resumes a product handoff when the candidate disappears during session recovery',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The missing candidate recovery matrix runs once.');
    const backend = new MockB7Backend();
    backend.candidateConfirmUnauthorizedOnce = true;
    backend.loginCandidatePlan = ['current', 'none'];
    backend.refreshFailureOnce = true;
    await backend.install(page);

    await page.goto(`/#/pages/profile/agent?invite_code=b7-invite&promotion_asset_id=${PRODUCT_ID}`);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
    await page.evaluate((productId) => new Promise<void>((resolve, reject) => {
      const runtime = (globalThis as unknown as {
        uni: {
          navigateTo: (options: {
            fail: (error: unknown) => void;
            success: () => void;
            url: string;
          }) => unknown;
        };
      }).uni;
      runtime.navigateTo({
        fail: reject,
        success: resolve,
        url: `/pages/product/detail?product_id=${encodeURIComponent(productId)}`,
      });
    }), PRODUCT_ID);
    await configureSecondProductSku(page);

    await page.getByLabel('收藏商品').click();
    await expect(page.getByText('请先登录', { exact: true })).toBeVisible();
    await visibleText(page, '去登录').click();
    await submitLogin(page);
    await expect(page).toHaveURL(/\/pages\/profile\/agent/);
    await uniButton(page, '确认服务关系').click();
    await expect(page).toHaveURL(/\/pages\/auth\/login/);
    await expect.poll(() => backend.count('/api/v1/store/auth/refresh', 'POST')).toBe(1);

    backend.candidate = null;
    await submitLogin(page);
    await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));
    await expect(page.getByLabel('取消收藏')).toBeVisible();
    expect(backend.count(`/api/v1/store/favorites/${PRODUCT_ID}`, 'PUT')).toBe(1);

    const loginCalls = backend.calls.filter(({ method, path }) =>
      method === 'POST' && path === '/api/v1/store/auth/wechat/login');
    expect(loginCalls).toHaveLength(2);
    expect(loginCalls[0]?.body?.candidate_token).toBe(CANDIDATE_TOKEN);
    expect(loginCalls[1]?.body?.candidate_token).toBeUndefined();
    expect(backend.count('/api/v1/store/attribution/candidate/confirm', 'POST')).toBe(1);
    await page.locator('uni-button.detail-choice__row').first().click();
    const secondSku = page.locator('uni-button.sku-option').filter({ hasText: '容量：100ml' });
    await expect(secondSku).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.sku-stepper')).toContainText('2');
    expect(backend.count(`/api/v1/store/products/${PRODUCT_ID}`, 'GET')).toBe(1);
    expect(forbiddenBusinessCalls(backend)).toEqual([]);
    await expectNoHorizontalOverflow(page);
  });

test('retries candidate-page navigation without repeating a completed login', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The candidate navigation matrix runs once.');
  const backend = new MockB7Backend();
  backend.candidate = candidateView();
  await backend.install(page);
  await page.goto('/#/pages/auth/login');
  await page.evaluate(() => {
    const runtime = (globalThis as unknown as {
      uni: {
        redirectTo: (options: Record<string, unknown>) => unknown;
        reLaunch: (options: Record<string, unknown>) => unknown;
      };
    }).uni;
    const originalRedirect = runtime.redirectTo.bind(runtime);
    const originalRelaunch = runtime.reLaunch.bind(runtime);
    let redirectFailures = 1;
    let relaunchFailures = 1;
    runtime.redirectTo = (options) => {
      if (redirectFailures > 0) {
        redirectFailures -= 1;
        (options.fail as ((error: { errMsg: string }) => void) | undefined)?.({
          errMsg: 'redirectTo:fail injected',
        });
        return undefined;
      }
      return originalRedirect(options);
    };
    runtime.reLaunch = (options) => {
      if (relaunchFailures > 0) {
        relaunchFailures -= 1;
        (options.fail as ((error: { errMsg: string }) => void) | undefined)?.({
          errMsg: 'reLaunch:fail injected',
        });
        return undefined;
      }
      return originalRelaunch(options);
    };
  });

  await submitLogin(page);
  await expect(page.getByRole('alert')).toContainText('登录已成功但确认页未打开');
  await expect(uniButton(page, '打开服务关系确认页')).toBeVisible();
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
  await uniButton(page, '打开服务关系确认页').click();
  await expect(page).toHaveURL(/\/pages\/profile\/agent/);
  await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(1);
});

test('clears a product handoff when the candidate decision page is dismissed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The candidate cancellation matrix runs once.');
  const backend = new MockB7Backend();
  backend.candidate = candidateView();
  await backend.install(page);
  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText('B7 测试商品', { exact: true })).toBeVisible();
  await page.getByLabel('收藏商品').click();
  await visibleText(page, '去登录').click();
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/profile\/agent/);
  await page.getByLabel('返回').click();
  await expect(page).toHaveURL(new RegExp(`/pages/product/detail\\?product_id=${PRODUCT_ID}$`));

  backend.candidate = null;
  await page.evaluate(() => {
    const runtime = (globalThis as unknown as {
      uni: { navigateTo: (options: { url: string }) => unknown };
    }).uni;
    runtime.navigateTo({ url: '/pages/auth/login' });
  });
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  await submitLogin(page);
  await expect(page).toHaveURL(/\/pages\/profile\/index/);
  await expect(page.getByLabel('本人资料摘要')).toBeVisible();
  await expect(page.getByText('收藏尚未开放', { exact: true })).toHaveCount(0);
  expect(backend.count('/api/v1/store/auth/wechat/login', 'POST')).toBe(2);
});

test('covers phone failure, reauthorization, revoke conflict and explicit retry', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The phone state matrix runs once.');
  const backend = new MockB7Backend();
  backend.phoneFailureOnce = true;
  backend.phoneRevokeConflictOnce = true;
  await backend.install(page);
  await loginToProfile(page);

  await page.getByLabel('账户手机号').click();
  await inputByLabel(page, 'Mock 手机号凭证').fill(PHONE_CREDENTIAL);
  await page.getByLabel('手机号授权说明').click();
  await uniButton(page, '授权账户手机号').click();
  await expect(page.getByRole('status')).toContainText('手机号授权失败');
  await expect(inputByLabel(page, 'Mock 手机号凭证')).toHaveValue('');
  expect(backend.count('/api/v1/store/profile/phone-authorizations', 'POST')).toBe(1);

  await inputByLabel(page, 'Mock 手机号凭证').fill(PHONE_CREDENTIAL);
  await uniButton(page, '授权账户手机号').click();
  await expect(page.getByText(PRIMARY_PHONE_MASK, { exact: true })).toBeVisible();
  await inputByLabel(page, 'Mock 手机号凭证').fill(REPLACEMENT_PHONE_CREDENTIAL);
  await expect(uniButton(page, '重新授权账户手机号')).toHaveAttribute('disabled', 'true');
  await page.getByLabel('手机号授权说明').click();
  await expect(uniButton(page, '重新授权账户手机号')).not.toHaveAttribute('disabled', 'true');
  await uniButton(page, '重新授权账户手机号').click();
  await expect(page.getByText(REPLACEMENT_PHONE_MASK, { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/profile/phone-authorizations', 'POST')).toBe(3);

  await uniButton(page, '撤回授权').click();
  await visibleText(page, '撤回授权').click();
  await expect(page.getByRole('status')).toContainText('已刷新最新内容');
  expect(backend.count('/api/v1/store/profile/phone', 'DELETE')).toBe(1);
  await expect(page.getByText(REPLACEMENT_PHONE_MASK, { exact: true })).toBeVisible();

  await uniButton(page, '撤回授权').click();
  await visibleText(page, '撤回授权').click();
  await expect(page.getByText('未授权', { exact: true })).toBeVisible();
  expect(backend.count('/api/v1/store/profile/phone', 'DELETE')).toBe(2);
  await expectNoHorizontalOverflow(page);
});

test('revokes deletion capability when acknowledgement is withdrawn and requires a new preview',
  async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-390', 'The deletion acknowledgement matrix runs once.');
    const backend = new MockB7Backend();
    backend.deletionPlan = ['eligible', 'eligible'];
    await backend.install(page);
    await loginToProfile(page);
    await page.getByLabel('账号与隐私').click();

    const acknowledgement = page.getByLabel('知晓账号删除影响');
    await acknowledgement.click();
    await uniButton(page, '检查删除资格').click();
    await expect(page.getByText('当前可以删除账号', { exact: true })).toBeVisible();
    const staleConfirmControl = await uniButton(page, '确认删除账号').elementHandle();
    expect(staleConfirmControl).not.toBeNull();
    expect(backend.count('/api/v1/store/privacy/deletion-requests/preview', 'POST')).toBe(1);

    await acknowledgement.click();
    await expect(page.getByText('当前可以删除账号', { exact: true })).toHaveCount(0);
    await expect(uniButton(page, '确认删除账号')).toHaveCount(0);
    await staleConfirmControl?.evaluate((element) => (element as HTMLElement).click());
    await expect(page.getByText('确认删除', { exact: true })).toHaveCount(0);
    expect(backend.count('/api/v1/store/privacy/deletion-requests', 'POST')).toBe(0);

    await acknowledgement.click();
    await expect(uniButton(page, '确认删除账号')).toHaveCount(0);
    await uniButton(page, '检查删除资格').click();
    await expect(page.getByText('当前可以删除账号', { exact: true })).toBeVisible();
    await expect(uniButton(page, '确认删除账号')).toBeVisible();
    expect(backend.count('/api/v1/store/privacy/deletion-requests/preview', 'POST')).toBe(2);
    expect(backend.count('/api/v1/store/privacy/deletion-requests', 'POST')).toBe(0);
  });

test('invalidates a deletion capability on 409 without automatic replay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The deletion conflict matrix runs once.');
  const backend = new MockB7Backend();
  backend.deletionConfirmConflictOnce = true;
  await backend.install(page);
  await loginToProfile(page);
  await page.getByLabel('账号与隐私').click();
  await page.getByLabel('知晓账号删除影响').click();
  await uniButton(page, '检查删除资格').click();
  await uniButton(page, '确认删除账号').click();
  await visibleText(page, '确认删除').click();
  await expect(page.getByRole('alert')).toContainText('删除资格或账户版本已经变化');
  await expect(uniButton(page, '确认删除账号')).toHaveCount(0);
  expect(backend.count('/api/v1/store/privacy/deletion-requests', 'POST')).toBe(1);
});

test('expires deletion preview locally before confirm', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The deletion expiry matrix runs once.');
  const backend = new MockB7Backend();
  backend.deletionExpiryMs = 1_200;
  await backend.install(page);
  await loginToProfile(page);
  await page.getByLabel('账号与隐私').click();
  await page.getByLabel('知晓账号删除影响').click();
  await uniButton(page, '检查删除资格').click();
  await expect(page.getByText('当前可以删除账号', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('删除资格已过期', { timeout: 4_000 });
  await expect(uniButton(page, '确认删除账号')).toHaveCount(0);
  expect(backend.count('/api/v1/store/privacy/deletion-requests', 'POST')).toBe(0);
});

test('requires a new login when deletion confirmation and refresh both return 401', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The deletion authentication matrix runs once.');
  const backend = new MockB7Backend();
  backend.deletionConfirmUnauthorizedOnce = true;
  backend.refreshFailureOnce = true;
  await backend.install(page);
  await loginToProfile(page);
  await page.getByLabel('账号与隐私').click();
  await page.getByLabel('知晓账号删除影响').click();
  await uniButton(page, '检查删除资格').click();
  await uniButton(page, '确认删除账号').click();
  await visibleText(page, '确认删除').click();
  await expect(page).toHaveURL(/\/pages\/auth\/login/);
  expect(backend.count('/api/v1/store/auth/refresh', 'POST')).toBe(1);
  const stored = await webStorage(page);
  expect(stored).not.toContain(ACCESS_TOKEN);
  expect(stored).not.toContain(REFRESH_TOKEN);
});

test('treats a network-lost deletion confirmation as unknown and clears the session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'The deletion unknown-result matrix runs once.');
  const backend = new MockB7Backend();
  backend.deletionConfirmUnknownOnce = true;
  await backend.install(page);
  await loginToProfile(page);
  await page.getByLabel('账号与隐私').click();
  await page.getByLabel('知晓账号删除影响').click();
  await uniButton(page, '检查删除资格').click();
  await uniButton(page, '确认删除账号').click();
  await visibleText(page, '确认删除').click();
  await expect(page.getByRole('alert')).toContainText('提交结果未知，请勿重复提交');
  await expect(uniButton(page, '返回首页')).toBeVisible();
  const stored = await webStorage(page);
  expect(stored).not.toContain(ACCESS_TOKEN);
  expect(stored).not.toContain(REFRESH_TOKEN);
  expect(stored).not.toContain(PREVIEW_TOKEN);
});
