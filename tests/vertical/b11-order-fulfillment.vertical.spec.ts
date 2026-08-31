import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, test, type Page } from '@playwright/test';

const databaseRequire = createRequire(`${process.cwd()}/packages/database/package.json`);
const FIXTURE_FIELDS = [
  'adminLogin',
  'adminPassword',
  'carrierName',
  'customerLoginCode',
  'expiredOrderId',
  'orderId',
  'productName',
  'rawAddressDetail',
  'rawPhone',
  'rawRecipient',
  'trackingNo',
] as const;
type FixtureField = (typeof FIXTURE_FIELDS)[number];
type VerticalFixture = Record<FixtureField, string>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B11 vertical test`);
  return value;
}

function loadFixture(): VerticalFixture {
  const parsed = JSON.parse(readFileSync(required('B11_VERTICAL_FIXTURE_PATH'), 'utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    Object.keys(parsed).length !== FIXTURE_FIELDS.length ||
    !FIXTURE_FIELDS.every((field) => typeof (parsed as Record<string, unknown>)[field] === 'string' &&
      ((parsed as Record<string, string>)[field]?.length ?? 0) > 0)) {
    throw new TypeError('B11 vertical fixture file is invalid');
  }
  return Object.fromEntries(
    FIXTURE_FIELDS.map((field) => [field, (parsed as Record<string, string>)[field]]),
  ) as VerticalFixture;
}

function persistEphemeralSecrets(values: readonly string[]): void {
  writeFileSync(
    required('B11_VERTICAL_EPHEMERAL_SECRET_PATH'),
    JSON.stringify([...new Set(values)]),
    { mode: 0o600 },
  );
}

function stableDiagnosticSerialization(value: unknown): string {
  const seen = new WeakSet<object>();
  const normalize = (candidate: unknown): unknown => {
    if (candidate === null || typeof candidate === 'string' || typeof candidate === 'boolean' ||
      typeof candidate === 'number') return candidate;
    if (typeof candidate === 'bigint') return candidate.toString();
    if (Array.isArray(candidate)) return candidate.map((item) => normalize(item));
    if (typeof candidate === 'object') {
      if (seen.has(candidate)) return '[Circular]';
      seen.add(candidate);
      return Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, item]) => [key, normalize(item)]));
    }
    return String(candidate);
  };
  return JSON.stringify(normalize(value)) ?? '';
}

function captureBrowserDiagnostics(
  page: Page,
  source: string,
  diagnostics: string[],
  pendingReads: Array<Promise<void>>,
): void {
  page.on('console', (message) => {
    pendingReads.push(Promise.all(message.args().map(async (argument) => {
      try {
        return stableDiagnosticSerialization(await argument.jsonValue());
      } catch {
        return '';
      }
    })).then((values) => {
      diagnostics.push(`${source}:console:${message.type()}:${[message.text(), ...values].join('\n')}`);
    }).catch(() => {
      diagnostics.push(`${source}:console:${message.type()}:${message.text()}`);
    }));
  });
  page.on('pageerror', (error) => diagnostics.push(`${source}:pageerror:${error.stack ?? error.message}`));
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const output: number[] = [];
  for (const character of value.replaceAll('=', '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new TypeError('TOTP enrollment returned an invalid Base32 secret');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

function currentTotp(secret: string): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (digest.at(-1) ?? 0) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fff_ffff) % 1_000_000).padStart(6, '0');
}

async function stableTotp(page: Page, secret: string): Promise<string> {
  const secondsIntoWindow = Math.floor(Date.now() / 1_000) % 30;
  if (secondsIntoWindow >= 26) await page.waitForTimeout((31 - secondsIntoWindow) * 1_000);
  return currentTotp(secret);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function uniButton(page: Page, label: string) {
  return page.locator('uni-button').filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`) });
}

function inputByLabel(page: Page, label: string) {
  return page.getByLabel(label).locator('input');
}

async function navigate(page: Page, url: string, method: 'navigateTo' | 'reLaunch' = 'navigateTo') {
  await page.evaluate(({ runtimeMethod, target }) => new Promise<void>((resolve, reject) => {
    const runtime = (globalThis as unknown as {
      uni: Record<string, (options: Record<string, unknown>) => unknown>;
    }).uni;
    runtime[runtimeMethod]?.({ fail: reject, success: resolve, url: target });
  }), { runtimeMethod: method, target: url });
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function awaitWorkerExpiration(orderId: string): Promise<void> {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b11-vertical-worker-proof',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await expect.poll(async () => {
      const result = await pool.query(
        `SELECT so.order_status::text, so.close_reason::text,
                ir.status::text AS reservation_status, ib.locked_qty,
                COUNT(il.id)::int AS release_ledgers
         FROM public.sales_order AS so
         JOIN public.inventory_reservation AS ir ON ir.order_id = so.id
         JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
         JOIN public.inventory_balance AS ib ON ib.sku_id = iri.sku_id
         LEFT JOIN public.inventory_ledger AS il
           ON il.business_id = ir.id AND il.sku_id = iri.sku_id
          AND il.ledger_type = 'ORDER_RELEASE'
         WHERE so.id = $1
         GROUP BY so.order_status, so.close_reason, ir.status, ib.locked_qty`,
        [orderId],
      );
      return result.rows[0] ?? null;
    }, { timeout: 30_000 }).toEqual({
      close_reason: 'PAYMENT_TIMEOUT',
      locked_qty: 0,
      order_status: 'CLOSED',
      release_ledgers: 1,
      reservation_status: 'EXPIRED',
    });
  } finally {
    await pool.end();
  }
}

async function signInAdmin(page: Page, origin: string, loginName: string, password: string): Promise<string[]> {
  await page.goto(`${origin}/login`);
  await page.getByLabel('超级管理员账号').fill(loginName);
  await page.getByLabel('登录密码').fill(password);
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await expect(page).toHaveURL(/\/settings\/account\/security\/enroll$/);
  const otpAuthUri = await page.getByTestId('one-time-otpauth-uri').textContent();
  const secret = otpAuthUri ? new URL(otpAuthUri).searchParams.get('secret') : null;
  expect({ hasEnrollmentSecret: typeof secret === 'string' && secret.length >= 16 })
    .toEqual({ hasEnrollmentSecret: true });
  if (!secret) throw new TypeError('B11 vertical TOTP enrollment secret is unavailable');
  const otp = await stableTotp(page, secret);
  persistEphemeralSecrets([secret, otp]);
  await page.locator('input[name="totp-enroll-code"]').fill(otp);
  await page.getByRole('button', { name: '验证并完成绑定' }).click();
  await expect(page.getByTestId('one-time-recovery-codes')).toBeVisible();
  const recoveryCodes = await page.getByTestId('one-time-recovery-codes').locator('code').allTextContents();
  persistEphemeralSecrets([secret, otp, ...recoveryCodes]);
  await page.getByRole('button', { name: '我已安全保存' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
  return [secret, otp, ...recoveryCodes];
}

test('browser completes controlled B11 fulfillment through Nest, PostgreSQL, Redis, MinIO and Worker',
  async ({ browser, page, request }) => {
    const apiOrigin = required('B11_VERTICAL_API_ORIGIN');
    const workerOrigin = required('B11_VERTICAL_WORKER_ORIGIN');
    const adminOrigin = required('B11_VERTICAL_ADMIN_ORIGIN');
    const miniappOrigin = required('B11_VERTICAL_MINIAPP_ORIGIN');
    const fixture = loadFixture();
    const adminLogin = fixture.adminLogin;
    const adminPassword = fixture.adminPassword;
    const customerLoginCode = fixture.customerLoginCode;
    const orderId = fixture.orderId;
    const expiredOrderId = fixture.expiredOrderId;
    const productName = fixture.productName;
    const rawPhone = fixture.rawPhone;
    const rawDetail = fixture.rawAddressDetail;
    const rawRecipient = fixture.rawRecipient;
    const trackingNo = fixture.trackingNo;
    const carrierName = fixture.carrierName;
    const addressReason = '核对本次纵向验收订单的受控发货信息';
    const logisticsDescription = '包裹已进入受控开发运输环节';
    const logisticsLocation = 'Development sorting centre';
    const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
    const apiResponses: Array<{ cacheControl?: string; method: string; path: string; pragma?: string; status: number }> = [];
    const browserDiagnostics: string[] = [];
    const browserDiagnosticReads: Array<Promise<void>> = [];
    const storageResponses: Array<{ method: string; path: string; status: number }> = [];

    const recordResponse = (response: import('@playwright/test').Response) => {
      const url = new URL(response.url());
      if (url.origin === storageOrigin) {
        storageResponses.push({ method: response.request().method(), path: url.pathname, status: response.status() });
      }
      if (!url.pathname.startsWith('/api/v1/')) return;
      const headers = response.headers();
      apiResponses.push({
        cacheControl: headers['cache-control'],
        method: response.request().method(),
        path: url.pathname,
        pragma: headers.pragma,
        status: response.status(),
      });
    };
    page.on('response', recordResponse);
    captureBrowserDiagnostics(page, 'admin', browserDiagnostics, browserDiagnosticReads);
    await page.evaluate(() => console.debug({ nested: { value: 'B11_NESTED_CONSOLE_CAPTURE' } }));

    const [apiHealth, workerHealth] = await Promise.all([
      request.get(`${apiOrigin}/internal/health`),
      request.get(`${workerOrigin}/internal/health`),
    ]);
    expect(apiHealth.status()).toBe(200);
    expect(await apiHealth.json()).toEqual({ service: 'api', status: 'ok' });
    expect(workerHealth.status()).toBe(200);
    expect(await workerHealth.json()).toEqual({ service: 'worker', status: 'ok' });
    await awaitWorkerExpiration(expiredOrderId);

    const miniappContext = await browser.newContext({
      permissions: [],
      viewport: { height: 844, width: 390 },
    });
    const miniappPage = await miniappContext.newPage();
    miniappPage.on('response', recordResponse);
    captureBrowserDiagnostics(miniappPage, 'miniapp', browserDiagnostics, browserDiagnosticReads);
    await miniappPage.goto(`${miniappOrigin}/#/pages/auth/login`);
    await miniappContext.clearPermissions();
    const permissionState = await miniappPage.evaluate(async () => {
      try {
        return (await navigator.permissions.query({ name: 'clipboard-write' as PermissionName })).state;
      } catch {
        return 'unsupported';
      }
    });
    expect(['denied', 'prompt']).toContain(permissionState);
    await inputByLabel(miniappPage, 'Mock 微信 code').fill(customerLoginCode);
    await miniappPage.getByLabel('用户协议').click();
    await miniappPage.getByLabel('隐私政策').click();
    const loginResponsePromise = miniappPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/auth/wechat/login');
    await uniButton(miniappPage, '微信授权登录').click();
    expect((await loginResponsePromise).status()).toBe(200);
    await expect(miniappPage).toHaveURL(/\/pages\/profile\/index/);

    const adminEphemeralSecrets = await signInAdmin(page, adminOrigin, adminLogin, adminPassword);
    await page.getByRole('link', { name: '订单中心', exact: true }).click();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(page.getByTestId('admin-orders-list')).toBeVisible();
    await expect(page.getByTestId(`admin-order-row-${orderId}`)).toBeVisible();
    await page.getByTestId(`admin-order-open-${orderId}`).click();
    await expect(page.getByTestId('admin-order-detail-content')).toBeVisible();
    await expect(page.getByTestId('admin-order-ship')).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const maskedAddress = await page.getByTestId('admin-order-masked-address').textContent() ?? '';
    expect({
      rawAddressAbsent: !maskedAddress.includes(rawDetail),
      rawPhoneAbsent: !maskedAddress.includes(rawPhone),
      rawRecipientAbsent: !maskedAddress.includes(rawRecipient),
    }).toEqual({ rawAddressAbsent: true, rawPhoneAbsent: true, rawRecipientAbsent: true });

    await page.getByTestId('admin-order-read-address').click();
    await expect(page.getByTestId('fulfillment-address-dialog')).toBeVisible();
    await page.getByTestId('fulfillment-address-reason').fill(addressReason);
    const addressResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1/admin/orders/${orderId}/fulfillment-address` &&
      response.request().method() === 'GET');
    const addressRequestedAt = Date.now();
    await page.getByTestId('fulfillment-address-read').click();
    const addressResponse = await addressResponsePromise;
    expect(addressResponse.status()).toBe(200);
    const addressEnvelope = await addressResponse.json() as {
      data?: {
        access_expires_at?: unknown;
        detail?: unknown;
        order_id?: unknown;
        phone?: unknown;
        recipient_name?: unknown;
      };
    };
    const address = addressEnvelope.data;
    const expiresAt = typeof address?.access_expires_at === 'string'
      ? Date.parse(address.access_expires_at)
      : Number.NaN;
    expect({
      addressMatched: address?.detail === rawDetail,
      expiryIsFiveMinutes: Number.isFinite(expiresAt) &&
        expiresAt - addressRequestedAt >= 295_000 && expiresAt - addressRequestedAt <= 305_000,
      orderMatched: address?.order_id === orderId,
      phoneMatched: address?.phone === rawPhone,
      recipientMatched: address?.recipient_name === rawRecipient,
    }).toEqual({
      addressMatched: true,
      expiryIsFiveMinutes: true,
      orderMatched: true,
      phoneMatched: true,
      recipientMatched: true,
    });
    await expect(page.getByTestId('fulfillment-address-plaintext')).toBeVisible();

    const realWaitStartedAt = Date.now();
    await page.waitForTimeout(Math.max(0, expiresAt - Date.now() + 750));
    expect(Date.now() - realWaitStartedAt).toBeGreaterThanOrEqual(294_000);
    await expect(page.getByTestId('fulfillment-address-plaintext')).toHaveCount(0);
    await expect(page.getByTestId('fulfillment-address-error')).toContainText('内容已清除');
    await page.getByTestId('fulfillment-address-close').click();

    await page.getByTestId('admin-order-ship').click();
    const shipDialog = page.getByTestId('order-ship-dialog');
    await expect(shipDialog).toBeVisible();
    await page.getByTestId('order-shipment-carrier-code').fill('B11V');
    await page.getByTestId('order-shipment-carrier-name').fill(carrierName);
    await page.getByTestId('order-shipment-tracking-no').fill(trackingNo);
    const shipResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1/admin/orders/${orderId}/shipments` &&
      response.request().method() === 'POST');
    await page.getByTestId('order-ship-submit').click();
    expect((await shipResponsePromise).status()).toBe(201);
    await expect(page.getByTestId('admin-order-package')).toBeVisible();
    await expect(page.getByTestId('admin-order-logistics')).toBeVisible();

    await page.getByTestId('admin-order-logistics').click();
    await expect(page.getByTestId('order-logistics-dialog')).toBeVisible();
    await page.getByTestId('order-logistics-description').fill(logisticsDescription);
    await page.getByTestId('order-logistics-location').fill(logisticsLocation);
    const logisticsResponsePromise = page.waitForResponse((response) =>
      /\/api\/v1\/admin\/shipments\/[0-9A-HJKMNP-TV-Z]{26}\/events$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'POST');
    await page.getByTestId('order-logistics-submit').click();
    expect((await logisticsResponsePromise).status()).toBe(200);
    await expect(page.getByTestId('admin-order-logistics-timeline')).toContainText(logisticsDescription);

    try {
      await navigate(miniappPage, '/pages/orders/index', 'reLaunch');
      const orderCard = miniappPage.getByTestId(`order-card-${orderId}`);
      await expect(orderCard).toBeVisible();
      await expect(orderCard).toContainText(productName);
      const orderImage = orderCard.locator('img').first();
      await expect(orderImage).toBeVisible();
      await expect.poll(() => orderImage.evaluate((image: HTMLImageElement) => ({
        complete: image.complete,
        height: image.naturalHeight,
        width: image.naturalWidth,
      }))).toEqual({ complete: true, height: 1, width: 1 });
      await expectNoHorizontalOverflow(miniappPage);

      await orderCard.getByTestId(`order-logistics-${orderId}`).click();
      await expect(miniappPage.getByTestId('logistics-state-ready')).toBeVisible();
      await expect(miniappPage.getByText(trackingNo, { exact: true })).toBeVisible();
      await expect(miniappPage.getByTestId('logistics-timeline')).toContainText(logisticsDescription);
      await miniappPage.getByTestId('logistics-copy-tracking').click();
      await expect(miniappPage.getByText('复制失败，请稍后重试', { exact: true })).toBeVisible();
      await expect(miniappPage.getByText('运单号已复制', { exact: true })).toHaveCount(0);
      await expect(miniappPage.getByText(trackingNo, { exact: true })).toBeVisible();

      await navigate(miniappPage, `/pages/orders/detail?order_id=${orderId}`, 'reLaunch');
      await expect(miniappPage.getByTestId('order-detail-state-ready')).toBeVisible();
      await expect(miniappPage.getByTestId('order-logistics-open')).toBeVisible();
      await expect(miniappPage.getByTestId('confirm-receipt-button')).toBeVisible();
      await miniappPage.getByTestId('confirm-receipt-button').click();
      await expect(miniappPage.getByTestId('confirm-receipt-dialog')).toBeVisible();
      const receiptResponsePromise = miniappPage.waitForResponse((response) =>
        new URL(response.url()).pathname === `/api/v1/store/orders/${orderId}/confirm-receipt` &&
        response.request().method() === 'POST');
      await miniappPage.getByTestId('confirm-receipt-dialog-submit').click();
      const receiptResponse = await receiptResponsePromise;
      expect(receiptResponse.status()).toBe(200);
      await expect(miniappPage.getByTestId('confirm-receipt-button')).toHaveCount(0);
      await expect(miniappPage.getByText('已完成', { exact: true }).first()).toBeVisible();
      await expectNoHorizontalOverflow(miniappPage);

      const storageSafety = await miniappPage.evaluate(({ detail, phone, recipient, tracking }) => {
        const serialized = `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`;
        return {
          containsDetail: serialized.includes(detail),
          containsPhone: serialized.includes(phone),
          containsRecipient: serialized.includes(recipient),
          containsTracking: serialized.includes(tracking),
        };
      }, { detail: rawDetail, phone: rawPhone, recipient: rawRecipient, tracking: trackingNo });
      expect(storageSafety).toEqual({
        containsDetail: false,
        containsPhone: false,
        containsRecipient: false,
        containsTracking: false,
      });
    } finally {
      await miniappContext.close();
    }

    const adminStorageSafety = await page.evaluate(({ detail, phone, recipient, tracking }) => {
      const serialized = `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`;
      return {
        containsDetail: serialized.includes(detail),
        containsPhone: serialized.includes(phone),
        containsRecipient: serialized.includes(recipient),
        containsTracking: serialized.includes(tracking),
      };
    }, { detail: rawDetail, phone: rawPhone, recipient: rawRecipient, tracking: trackingNo });
    expect(adminStorageSafety).toEqual({
      containsDetail: false,
      containsPhone: false,
      containsRecipient: false,
      containsTracking: false,
    });
    await Promise.all(browserDiagnosticReads);
    const browserDiagnosticText = browserDiagnostics.join('\n');
    const browserProtectedValues = [
      adminLogin,
      adminPassword,
      customerLoginCode,
      rawDetail,
      rawPhone,
      rawRecipient,
      trackingNo,
      ...adminEphemeralSecrets,
    ];
    expect({
      containsNestedCanary: browserDiagnosticText.includes('B11_NESTED_CONSOLE_CAPTURE'),
      containsGeneratedSecret: browserDiagnosticText.includes('otpauth://') ||
        /\b[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}\b/u.test(browserDiagnosticText),
      containsProtectedValue: browserProtectedValues.some((value) => browserDiagnosticText.includes(value)),
    }).toEqual({ containsNestedCanary: true, containsGeneratedSecret: false, containsProtectedValue: false });
    expect(storageResponses.some(({ method, path, status }) =>
      method === 'GET' && path.includes('/public/') && status === 200)).toBe(true);
    const personalized = apiResponses.filter(({ path }) =>
      path.startsWith('/api/v1/admin/orders') || path.startsWith('/api/v1/admin/shipments') ||
      path.startsWith('/api/v1/store/orders'));
    expect(personalized.some(({ method, path, status }) =>
      method === 'GET' && path === '/api/v1/admin/orders' && status === 200)).toBe(true);
    expect(personalized.some(({ method, path, status }) =>
      method === 'POST' && path === `/api/v1/store/orders/${orderId}/confirm-receipt` && status === 200)).toBe(true);
    expect(personalized.every(({ cacheControl, pragma }) =>
      cacheControl === 'no-store, private' && pragma === 'no-cache')).toBe(true);
  });
