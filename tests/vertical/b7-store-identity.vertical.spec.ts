import { expect, test, type Page } from '@playwright/test';

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

function visibleText(page: Page, label: string) {
  return page.getByText(label, { exact: true }).last();
}

function maskedPhoneCredential(credential: string): string {
  const phone = credential.replace(/^mock:phone:/, '');
  if (!/^1[3-9][0-9]{9}$/.test(phone)) {
    throw new TypeError('B7 vertical phone credential does not match the Mock Provider contract');
  }
  return `${phone.slice(0, 3)} **** ${phone.slice(-4)}`;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B7 vertical test`);
  return value;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectSecretsAbsentFromWebStorage(page: Page, secrets: readonly string[]): Promise<void> {
  const serialized = await page.evaluate(() => {
    const entries = (storage: Storage) => Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index);
      return [key, key === null ? null : storage.getItem(key)];
    });
    return JSON.stringify({ local: entries(localStorage), session: entries(sessionStorage) });
  });
  for (const secret of secrets) expect(serialized).not.toContain(secret);
}

test('browser completes B7 identity, phone, attribution and synchronous deletion through real infrastructure',
  async ({ page, request }) => {
    const agentName = required('B7_VERTICAL_AGENT_NAME');
    const city = required('B7_VERTICAL_CITY');
    const inviteCode = required('B7_VERTICAL_INVITE_CODE');
    const loginCode = required('B7_VERTICAL_LOGIN_CODE');
    const nickname = required('B7_VERTICAL_NICKNAME');
    const phoneCredential = required('B7_VERTICAL_PHONE_CREDENTIAL');
    const promotionAssetId = required('B7_VERTICAL_PROMOTION_ASSET_ID');
    const replacementPhoneCredential = required('B7_VERTICAL_REPLACEMENT_PHONE_CREDENTIAL');
    const apiResponses: Array<{ cacheControl: string | undefined; path: string; pragma: string | undefined; status: number }> = [];

    page.on('response', (response) => {
      const url = new URL(response.url());
      if (!url.pathname.startsWith('/api/v1/store/')) return;
      const headers = response.headers();
      apiResponses.push({
        cacheControl: headers['cache-control'],
        path: url.pathname,
        pragma: headers.pragma,
        status: response.status(),
      });
    });

    const health = await request.get('http://127.0.0.1:3000/internal/health');
    expect(health.status()).toBe(200);
    expect(await health.json()).toEqual({ service: 'api', status: 'ok' });

    await page.goto(`/#/pages/profile/agent?invite_code=${encodeURIComponent(inviteCode)}&promotion_asset_id=${encodeURIComponent(promotionAssetId)}`);
    await expect(page.getByText('待确认服务关系', { exact: true })).toBeVisible();
    await expect(page.getByText(agentName, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await uniButton(page, '登录后确认').click();
    await expect(page).toHaveURL(/\/pages\/auth\/login/);
    await expect(page.getByText('微信登录', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(new RegExp(`本次登录来自 ${escapeRegExp(agentName)} 的推广内容`))).toBeVisible();
    await inputByLabel(page, 'Mock 微信 code').fill(loginCode);
    await page.getByLabel('用户协议').click();
    await page.getByLabel('隐私政策').click();
    const loginResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/auth/wechat/login');
    await uniButton(page, '微信授权登录').click();
    const loginResponse = await loginResponsePromise;
    expect(loginResponse.status()).toBe(200);
    const loginPayload = await loginResponse.json() as {
      data: { session: { access_token: string; refresh_token: string } };
    };
    const accessToken = loginPayload.data.session.access_token;
    const refreshToken = loginPayload.data.session.refresh_token;
    await expect(page).toHaveURL(/\/pages\/profile\/agent/);
    await expect(page.getByText('服务代理', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(agentName, { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const confirmAgentResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/attribution/candidate/confirm');
    await uniButton(page, '确认服务关系').click();
    expect((await confirmAgentResponsePromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/pages\/profile\/agent\?invite_code=/);
    await expect(page.getByLabel('当前服务代理')).toBeVisible();
    await expect(page.getByLabel('当前服务代理').getByText('服务关系已确认', { exact: true })).toBeVisible();
    await expect(uniButton(page, '确认服务关系')).toHaveCount(0);
    await page.getByLabel('返回').click();
    await expect(page).toHaveURL(/\/#\/$/);
    await page.getByLabel('我的').click();
    await expect(page).toHaveURL(/\/pages\/profile\/index/);
    await expect(page.getByText('个人中心', { exact: true }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectSecretsAbsentFromWebStorage(page, [accessToken, refreshToken, loginCode]);

    await page.getByLabel('编辑资料').click();
    await expect(page.getByText('编辑资料', { exact: true }).first()).toBeVisible();
    await inputByLabel(page, '昵称').fill(nickname);
    await inputByLabel(page, '城市').fill(city);
    const profileResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/profile' && response.request().method() === 'PATCH');
    await uniButton(page, '保存资料').click();
    expect((await profileResponsePromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/pages\/profile\/index/);
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('账户手机号').click();
    await expect(page).toHaveURL(/\/pages\/profile\/phone/);
    await expect(page.getByText('手机号授权', { exact: true }).first()).toBeVisible();
    await inputByLabel(page, 'Mock 手机号凭证').fill(phoneCredential);
    await page.getByLabel('手机号授权说明').click();
    const phoneResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/profile/phone-authorizations');
    await uniButton(page, '授权账户手机号').click();
    expect((await phoneResponsePromise).status()).toBe(200);
    await expect(page.getByText(maskedPhoneCredential(phoneCredential), { exact: true })).toBeVisible();

    await inputByLabel(page, 'Mock 手机号凭证').fill(replacementPhoneCredential);
    await page.getByLabel('手机号授权说明').click();
    const replacementResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/profile/phone-authorizations' &&
        response.request().method() === 'POST');
    await uniButton(page, '重新授权账户手机号').click();
    expect((await replacementResponsePromise).status()).toBe(200);
    await expect(page.getByText(maskedPhoneCredential(replacementPhoneCredential), { exact: true })).toBeVisible();

    const revokeResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/profile/phone' &&
        response.request().method() === 'DELETE');
    await uniButton(page, '撤回授权').click();
    await expect(page.getByText('撤回账户手机号授权', { exact: true })).toBeVisible();
    await visibleText(page, '撤回授权').click();
    expect((await revokeResponsePromise).status()).toBe(200);
    await expect(page.getByText('账户手机号授权已撤回。')).toBeVisible();
    await expect(page.getByText('未授权', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('返回').click();
    await expect(page).toHaveURL(/\/pages\/profile\/index/);
    await page.getByLabel('服务代理').click();
    await expect(page).toHaveURL(/\/pages\/profile\/agent/);
    await expect(page.getByText('服务代理', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(agentName, { exact: true })).toBeVisible();
    await expect(page.getByLabel('当前服务代理')).toBeVisible();
    await expect(uniButton(page, '确认服务关系')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await page.getByLabel('返回').click();
    await expect(page).toHaveURL(/\/pages\/profile\/index/);
    await page.getByLabel('账号与隐私').click();
    await expect(page).toHaveURL(/\/pages\/profile\/privacy/);
    await expect(page.getByText('账号删除', { exact: true }).first()).toBeVisible();
    await page.getByLabel('知晓账号删除影响').click();
    const previewResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/privacy/deletion-requests/preview');
    await uniButton(page, '检查删除资格').click();
    const previewResponse = await previewResponsePromise;
    expect(previewResponse.status()).toBe(200);
    const previewPayload = await previewResponse.json() as {
      data: { confirmation_hash: string; eligible: boolean; preview_token: string };
    };
    expect(previewPayload.data.eligible).toBe(true);
    await expect(page.getByText('当前可以删除账号', { exact: true })).toBeVisible();
    await expectSecretsAbsentFromWebStorage(page, [
      accessToken,
      refreshToken,
      loginCode,
      phoneCredential,
      replacementPhoneCredential,
      previewPayload.data.preview_token,
      previewPayload.data.confirmation_hash,
    ]);
    const confirmDeletionResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/privacy/deletion-requests' &&
        response.request().method() === 'POST');
    await uniButton(page, '确认删除账号').click();
    await expect(page.getByText('确认删除账号', { exact: true }).last()).toBeVisible();
    await visibleText(page, '确认删除').click();
    const confirmDeletionResponse = await confirmDeletionResponsePromise;
    expect(confirmDeletionResponse.status()).toBe(200);
    await expect(page.getByText('账号已删除')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await expectSecretsAbsentFromWebStorage(page, [accessToken, refreshToken, previewPayload.data.preview_token]);

    const oldSessionResponse = await request.get('http://127.0.0.1:3000/api/v1/store/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    expect(oldSessionResponse.status()).toBe(401);
    expect((await oldSessionResponse.json()).code).toBe('AUTH_REQUIRED');
    expect(oldSessionResponse.headers()['cache-control']).toBe('no-store, private');
    expect(oldSessionResponse.headers().pragma).toBe('no-cache');

    const requiredPaths = [
      '/api/v1/store/attribution/candidates',
      '/api/v1/store/legal-documents',
      '/api/v1/store/auth/wechat/login',
      '/api/v1/store/profile',
      '/api/v1/store/profile/phone-authorizations',
      '/api/v1/store/profile/phone',
      '/api/v1/store/attribution/candidate',
      '/api/v1/store/attribution/candidate/confirm',
      '/api/v1/store/service-agent',
      '/api/v1/store/privacy/deletion-requests/preview',
      '/api/v1/store/privacy/deletion-requests',
    ];
    for (const path of requiredPaths) {
      expect(apiResponses.some((response) => response.path === path && response.status === 200)).toBe(true);
    }
    expect(apiResponses.filter(({ path }) => requiredPaths.includes(path)).every((response) =>
      response.cacheControl === 'no-store, private' && response.pragma === 'no-cache')).toBe(true);
    expect(apiResponses.filter(({ status }) => status >= 400)).toEqual([]);
  });
