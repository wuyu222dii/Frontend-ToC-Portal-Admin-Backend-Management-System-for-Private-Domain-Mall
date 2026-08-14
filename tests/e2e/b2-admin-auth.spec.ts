import { expect, test, type Page, type Route } from '@playwright/test';

const adminBaseUrl = 'http://127.0.0.1:5175';
const accessToken = ['access', 'runtime', 'value'].join('-');
const refreshToken = ['refresh', 'runtime', 'value'].join('-');
const preauthToken = ['preauth', 'runtime', 'value'].join('-');
const rotatedAccessToken = ['access', 'rotated', 'value'].join('-');
const rotatedRefreshToken = ['refresh', 'rotated', 'value'].join('-');
const recoveryCodes = Array.from({ length: 8 }, (_, index) => `RC-${String(index + 1).padStart(2, '0')}-RUNTIME`);

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: 'req_0123456789abcdef0123456789abcdef' };
}

function error(code: string, message: string) {
  return { code, message, request_id: 'req_0123456789abcdef0123456789abcdef' };
}

function session() {
  return {
    access_token: accessToken,
    account_id: '01J5ADMINACCOUNT000000000000',
    assurance: 'MFA',
    expires_at: '2099-08-13T10:00:00.000Z',
    mfa_required: false,
    refresh_token: refreshToken,
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    session_id: '01J5ADMINSESSION000000000000',
  } as const;
}

async function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store, private', ...headers },
    status,
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function mockTotpLogin(page: Page, options: { verifyDelayMs?: number } = {}) {
  let loginRequests = 0;
  let verifyRequests = 0;
  await page.route('**/api/v1/admin/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/v1/admin/auth/login') {
      loginRequests += 1;
      expect(route.request().headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
      await json(route, 200, success({
        assurance: 'PASSWORD_ONLY',
        challenge_id: 'login-challenge',
        expires_at: '2099-08-13T09:05:00.000Z',
        mfa_required: true,
        next_action: 'VERIFY_TOTP',
        pre_auth_token: preauthToken,
      }));
      return;
    }
    if (url.pathname === '/api/v1/admin/auth/mfa/challenges/login-challenge/verify') {
      verifyRequests += 1;
      expect(route.request().headers().authorization).toBe(`Bearer ${preauthToken}`);
      if (options.verifyDelayMs) await new Promise((resolve) => setTimeout(resolve, options.verifyDelayMs));
      await json(route, 200, success(session()));
      return;
    }
    if (url.pathname === '/api/v1/admin/brands' && route.request().method() === 'GET') {
      expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`);
      await json(route, 200, success({
        items: [],
        pagination: { page: 1, page_size: 20, total: 0 },
      }));
      return;
    }
    await route.fallback();
  });
  return {
    get loginRequests() { return loginRequests; },
    get verifyRequests() { return verifyRequests; },
  };
}

async function completeTotpLogin(page: Page) {
  await page.goto(`${adminBaseUrl}/login`);
  await page.getByLabel('超级管理员账号').fill('admin.operator');
  await page.getByLabel('登录密码').fill('RuntimePassword');
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await expect(page).toHaveURL(/\/login\/totp$/);
  await page.getByLabel('动态验证码').fill('123456');
  await page.getByRole('button', { name: '完成验证' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
}

test.describe('B2 admin authentication', () => {
  test('routes password pre-auth through TOTP before creating a session', async ({ page }) => {
    const calls = await mockTotpLogin(page, { verifyDelayMs: 120 });
    await page.goto(`${adminBaseUrl}/workspace`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: '总部管理后台' })).toBeVisible();
    await expect(page.getByLabel('超级管理员账号')).toHaveValue('');
    await expect(page.getByLabel('登录密码')).toHaveValue('');

    await page.getByLabel('超级管理员账号').fill('admin.operator');
    await page.getByLabel('登录密码').fill('RuntimePassword');
    await page.getByText('记住账号', { exact: true }).click();
    await page.getByRole('button', { name: '登录总部管理后台' }).click();
    await expect(page).toHaveURL(/\/login\/totp$/);
    await expect(page.getByText('验证登录身份')).toBeVisible();
    await expect(page.getByText('当前没有可用的业务模块')).toHaveCount(0);

    await page.getByLabel('动态验证码').fill('123456');
    await page.getByRole('button', { name: '完成验证' }).click();
    await expect(page.getByRole('button', { name: '完成验证' })).toBeDisabled();
    await expect(page).toHaveURL(/\/catalog\/brands$/);
    await expect(page.getByTestId('catalog-page')).toBeVisible();
    await expect(page.getByText('商品管理')).toHaveCount(0);
    expect(calls.loginRequests).toBe(1);
    expect(calls.verifyRequests).toBe(1);

    const storage = await page.evaluate(() => ({
      local: { ...localStorage },
      session: { ...sessionStorage },
    }));
    expect(storage.local).toEqual({ 'qingxu.admin.remembered_login': 'admin.operator' });
    expect(storage.session).toEqual({});
    expect(JSON.stringify(storage)).not.toContain(accessToken);
    expect(JSON.stringify(storage)).not.toContain(refreshToken);
    expect(JSON.stringify(storage)).not.toContain(preauthToken);
  });

  test('remembers only the login name and keeps credential errors non-enumerating', async ({ page }) => {
    let attempts = 0;
    await page.route('**/api/v1/admin/auth/login', async (route) => {
      attempts += 1;
      if (attempts === 1) {
        await json(route, 401, error('AUTH_INVALID', 'account does not exist'));
      } else if (attempts === 2) {
        await json(route, 403, error('ACCOUNT_DISABLED', 'internal disabled reason'));
      } else {
        await json(route, 429, error('RATE_LIMITED', 'internal lock detail'), { 'retry-after': '60' });
      }
    });
    await page.goto(`${adminBaseUrl}/login`);
    await page.getByLabel('超级管理员账号').fill('unknown.operator');
    await page.getByLabel('登录密码').fill('RuntimePassword');
    await page.getByRole('button', { name: '登录总部管理后台' }).click();
    await expect(page.getByRole('alert')).toHaveText('账号或密码错误，请重试');
    await expect(page.getByText('account does not exist')).toHaveCount(0);

    await page.getByLabel('登录密码').fill('RuntimePassword');
    await page.getByRole('button', { name: '登录总部管理后台' }).click();
    await expect(page.getByRole('alert')).toHaveText('账号或密码错误，请重试');
    await expect(page.getByText('internal disabled reason')).toHaveCount(0);

    await page.getByLabel('登录密码').fill('RuntimePassword');
    await page.getByRole('button', { name: '登录总部管理后台' }).click();
    await expect(page.getByRole('alert')).toContainText('请 1 分钟后重试');
    await expect(page.getByRole('button', { name: '登录总部管理后台' })).toBeDisabled();

    const storage = await page.evaluate(() => ({ ...localStorage }));
    expect(Object.keys(storage)).toEqual([]);
  });

  test('supports the one-use recovery-code login branch', async ({ page }) => {
    await mockTotpLogin(page);
    await page.route('**/api/v1/admin/auth/mfa/recovery', async (route) => {
      expect(route.request().headers().authorization).toBe(`Bearer ${preauthToken}`);
      const body = route.request().postDataJSON() as { recovery_code: string };
      expect(body.recovery_code).toBe('RECOVERY-RUNTIME');
      await json(route, 200, success(session()));
    });
    await page.goto(`${adminBaseUrl}/login`);
    await page.getByLabel('超级管理员账号').fill('admin.operator');
    await page.getByLabel('登录密码').fill('RuntimePassword');
    await page.getByRole('button', { name: '登录总部管理后台' }).click();
    await page.getByRole('button', { name: '使用恢复码' }).click();
    await page.getByLabel('单次恢复码').fill('RECOVERY-RUNTIME');
    await page.getByRole('button', { name: '验证并登录' }).click();
    await expect(page).toHaveURL(/\/catalog\/brands$/);
  });

  test('forces first-login enrollment and clears one-time URI and recovery codes', async ({ page }) => {
    const consoleText: string[] = [];
    page.on('console', (message) => consoleText.push(message.text()));
    await page.route('**/api/v1/admin/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/login')) {
        await json(route, 200, success({
          assurance: 'PASSWORD_ONLY',
          challenge_id: null,
          expires_at: '2099-08-13T09:05:00.000Z',
          mfa_required: true,
          next_action: 'ENROLL_TOTP',
          pre_auth_token: preauthToken,
        }));
      } else if (path.endsWith('/mfa/totp/enroll')) {
        await json(route, 200, success({
          challenge_id: 'enroll-challenge',
          expires_at: '2099-08-13T09:05:00.000Z',
          factor_id: 'factor-runtime',
          otpauth_uri: 'otpauth://totp/Qingxu:admin.operator?secret=RUNTIMEONLY&issuer=Qingxu',
        }));
      } else if (path.endsWith('/mfa/totp/enroll/verify')) {
        await json(route, 200, success({
          factor_id: 'factor-runtime',
          recovery_codes: recoveryCodes,
          session: session(),
        }));
      } else await route.fallback();
    });
    await page.goto(`${adminBaseUrl}/login`);
    await page.getByLabel('超级管理员账号').fill('bootstrap.admin');
    await page.getByLabel('登录密码').fill('RuntimePassword');
    await page.getByRole('button', { name: '登录总部管理后台' }).click();
    await expect(page).toHaveURL(/\/settings\/account\/security\/enroll$/);
    await expect(page.getByAltText('身份验证器绑定二维码')).toBeVisible();
    await page.getByText('显示一次性手工绑定地址').click();
    await expect(page.getByTestId('one-time-otpauth-uri')).toContainText('otpauth://totp/');
    await page.getByLabel('验证动态码').fill('123456');
    await page.getByRole('button', { name: '验证并完成绑定' }).click();
    await expect(page.getByTestId('one-time-recovery-codes')).toBeVisible();
    await expect(page.getByTestId('one-time-recovery-codes').locator('code')).toHaveCount(8);
    const storageBeforeAcknowledge = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storageBeforeAcknowledge).not.toContain('RUNTIMEONLY');
    expect(storageBeforeAcknowledge).not.toContain(recoveryCodes[0] ?? 'missing');
    expect(consoleText.join('\n')).not.toContain('RUNTIMEONLY');
    expect(consoleText.join('\n')).not.toContain(recoveryCodes[0] ?? 'missing');

    await page.getByRole('button', { name: '我已安全保存' }).click();
    await expect(page).toHaveURL(/\/catalog\/brands$/);
    await expect(page.getByText(recoveryCodes[0] ?? 'missing')).toHaveCount(0);
    await expect(page.getByText('otpauth://totp/', { exact: false })).toHaveCount(0);
  });

  test('loads account security and performs password, recovery-code, and logout-all actions', async ({ page }) => {
    await mockTotpLogin(page);
    const actions: string[] = [];
    await page.route('**/api/v1/admin/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/current')) {
        expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`);
        await json(route, 200, success({
          account_id: '01J5ADMINACCOUNT000000000000',
          assurance: 'MFA',
          mfa_verified_at: '2026-08-13T08:30:00.000Z',
          permissions: ['admin:security:read'],
          restriction: 'NONE',
          role: 'SUPER_ADMIN',
          session_id: '01J5ADMINSESSION000000000000',
          status: 'ACTIVE',
          version: 3,
        }));
      } else if (path.endsWith('/auth/change-password')) {
        actions.push('change-password');
        const body = route.request().postDataJSON() as { current_password: string; new_password: string };
        expect(body.current_password).toBe('CurrentRuntime');
        expect(body.new_password).toBe('NextRuntimePassword');
        await json(route, 200, success({ occurred_at: '2026-08-13T09:00:00.000Z', resource_id: '01J5ADMINACCOUNT000000000000', resource_type: 'account', status: 'ACTIVE', version: 4 }));
      } else if (path.endsWith('/mfa/recovery-codes/rotate')) {
        actions.push('rotate-codes');
        await json(route, 200, success({ recovery_codes: recoveryCodes, rotated_at: '2026-08-13T09:00:00.000Z' }));
      } else if (path.endsWith('/auth/logout-all')) {
        actions.push('logout-all');
        await json(route, 200, success({ occurred_at: '2026-08-13T09:01:00.000Z', resource_id: '01J5ADMINACCOUNT000000000000', resource_type: 'session', status: 'REVOKED', version: 5 }));
      } else await route.fallback();
    });
    await completeTotpLogin(page);
    await page.getByRole('link', { name: '账户安全', exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/account\/security$/);
    await expect(page.getByText('动态验证与恢复码')).toBeVisible();

    await page.getByRole('button', { name: '修改密码' }).click();
    const passwordDialog = page.getByRole('dialog', { name: '修改登录密码' });
    await passwordDialog.getByLabel('当前密码').fill('CurrentRuntime');
    await passwordDialog.getByLabel('新密码', { exact: true }).fill('NextRuntimePassword');
    await passwordDialog.getByLabel('确认新密码').fill('NextRuntimePassword');
    await passwordDialog.getByRole('button', { name: '确认修改' }).click();
    await expect(passwordDialog).toBeHidden();

    await page.getByRole('button', { name: '轮换恢复码' }).click();
    const rotateDialog = page.getByRole('dialog', { name: '轮换全部恢复码' });
    await rotateDialog.getByLabel('当前动态验证码').fill('123456');
    await rotateDialog.getByRole('button', { name: '确认轮换' }).click();
    await expect(page.getByTestId('one-time-recovery-codes')).toBeVisible();
    await page.getByRole('button', { name: '我已安全保存' }).click();
    await expect(page.getByTestId('one-time-recovery-codes')).toBeHidden();

    await page.getByRole('button', { name: '退出全部会话' }).click();
    await page.getByRole('button', { name: '确认退出全部' }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect(actions).toEqual(['change-password', 'rotate-codes', 'logout-all']);
  });

  test('rotates an in-memory refresh token once and retries the protected request', async ({ page }) => {
    await mockTotpLogin(page);
    let currentRequests = 0;
    let refreshRequests = 0;
    const currentRequestKeys: Array<string | undefined> = [];
    await page.route('**/api/v1/admin/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/current')) {
        currentRequests += 1;
        currentRequestKeys.push(route.request().headers()['idempotency-key']);
        const expectedToken = currentRequests === 1 ? accessToken : rotatedAccessToken;
        expect(route.request().headers().authorization).toBe(`Bearer ${expectedToken}`);
        if (currentRequests === 1) {
          await json(route, 401, error('AUTH_EXPIRED', 'access expired'));
        } else {
          await json(route, 200, success({
            account_id: '01J5ADMINACCOUNT000000000000',
            assurance: 'MFA',
            mfa_verified_at: '2026-08-13T08:30:00.000Z',
            permissions: ['admin:security:read'],
            restriction: 'NONE',
            role: 'SUPER_ADMIN',
            session_id: '01J5ADMINSESSION000000000000',
            status: 'ACTIVE',
            version: 3,
          }));
        }
      } else if (path.endsWith('/auth/refresh')) {
        refreshRequests += 1;
        expect(route.request().postDataJSON()).toEqual({ refresh_token: refreshToken });
        await json(route, 200, success({
          ...session(),
          access_token: rotatedAccessToken,
          refresh_token: rotatedRefreshToken,
        }));
      } else await route.fallback();
    });

    await completeTotpLogin(page);
    await page.getByRole('link', { name: '账户安全', exact: true }).click();
    await expect(page.getByText('动态验证与恢复码')).toBeVisible();
    expect(currentRequests).toBe(2);
    expect(refreshRequests).toBe(1);
    expect(currentRequestKeys).toEqual([undefined, undefined]);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain(rotatedAccessToken);
    expect(storage).not.toContain(rotatedRefreshToken);
  });

  test('reuses the idempotency key when a protected write is retried after refresh', async ({ page }) => {
    await mockTotpLogin(page);
    const writeKeys: string[] = [];
    let writeRequests = 0;
    await page.route('**/api/v1/admin/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/auth/current')) {
        await json(route, 200, success({
          account_id: '01J5ADMINACCOUNT000000000000',
          assurance: 'MFA',
          mfa_verified_at: '2026-08-13T08:30:00.000Z',
          permissions: ['admin:security:read'],
          restriction: 'NONE',
          role: 'SUPER_ADMIN',
          session_id: '01J5ADMINSESSION000000000000',
          status: 'ACTIVE',
          version: 3,
        }));
      } else if (path.endsWith('/auth/change-password')) {
        writeRequests += 1;
        writeKeys.push(route.request().headers()['idempotency-key'] ?? 'missing');
        const expectedToken = writeRequests === 1 ? accessToken : rotatedAccessToken;
        expect(route.request().headers().authorization).toBe(`Bearer ${expectedToken}`);
        if (writeRequests === 1) {
          await json(route, 401, error('AUTH_EXPIRED', 'access expired'));
        } else {
          await json(route, 200, success({
            occurred_at: '2026-08-13T09:00:00.000Z',
            resource_id: '01J5ADMINACCOUNT000000000000',
            resource_type: 'account',
            status: 'ACTIVE',
            version: 4,
          }));
        }
      } else if (path.endsWith('/auth/refresh')) {
        await json(route, 200, success({
          ...session(),
          access_token: rotatedAccessToken,
          refresh_token: rotatedRefreshToken,
        }));
      } else await route.fallback();
    });

    await completeTotpLogin(page);
    await page.getByRole('link', { name: '账户安全', exact: true }).click();
    await page.getByRole('button', { name: '修改密码' }).click();
    const passwordDialog = page.getByRole('dialog', { name: '修改登录密码' });
    await passwordDialog.getByLabel('当前密码').fill('CurrentRuntime');
    await passwordDialog.getByLabel('新密码', { exact: true }).fill('NextRuntimePassword');
    await passwordDialog.getByLabel('确认新密码').fill('NextRuntimePassword');
    await passwordDialog.getByRole('button', { name: '确认修改' }).click();
    await expect(passwordDialog).toBeHidden();
    expect(writeRequests).toBe(2);
    expect(writeKeys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(writeKeys[1]).toBe(writeKeys[0]);
  });

  test('revokes the current session from the shell and clears browser memory', async ({ page }) => {
    await mockTotpLogin(page);
    let logoutRequests = 0;
    await page.route('**/api/v1/admin/auth/logout', async (route) => {
      logoutRequests += 1;
      expect(route.request().headers().authorization).toBe(`Bearer ${accessToken}`);
      await json(route, 200, success({
        occurred_at: '2026-08-13T09:01:00.000Z',
        resource_id: '01J5ADMINSESSION000000000000',
        resource_type: 'session',
        status: 'REVOKED',
        version: 4,
      }));
    });

    await completeTotpLogin(page);
    await page.getByRole('button', { name: '退出登录' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto(`${adminBaseUrl}/workspace`);
    await expect(page).toHaveURL(/\/login$/);
    expect(logoutRequests).toBe(1);
  });
});

test('ADM-01 remains usable without page-level overflow at every configured viewport', async ({ page }) => {
  await page.goto(`${adminBaseUrl}/login`);
  await expect(page.getByRole('heading', { name: '总部管理后台' })).toBeVisible();
  await expect(page.getByRole('button', { name: '登录总部管理后台' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
