import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, test, type Page } from '@playwright/test';

const databaseRequire = createRequire(`${process.cwd()}/packages/database/package.json`);
const EVIDENCE_PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);
const FIXTURE_FIELDS = [
  'adminLogin',
  'adminPassword',
  'customerLoginCode',
  'orderId',
  'orderItemId',
  'productName',
  'publicImageUrl',
  'returnAddressVersionId',
  'returnAddressRecipient',
  'returnAddressPhone',
  'returnAddressProvince',
  'returnAddressCity',
  'returnAddressDistrict',
  'returnAddressDetail',
  'returnCarrierCode',
  'returnCarrierName',
  'returnTrackingNo',
] as const;
type FixtureField = (typeof FIXTURE_FIELDS)[number];
type VerticalFixture = Record<FixtureField, string>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B12 vertical test`);
  return value;
}

function loadFixture(): VerticalFixture {
  const parsed = JSON.parse(readFileSync(required('B12_VERTICAL_FIXTURE_PATH'), 'utf8')) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) ||
    Object.keys(parsed).length !== FIXTURE_FIELDS.length ||
    !FIXTURE_FIELDS.every((field) => typeof (parsed as Record<string, unknown>)[field] === 'string' &&
      ((parsed as Record<string, string>)[field]?.length ?? 0) > 0)) {
    throw new TypeError('B12 vertical fixture file is invalid');
  }
  return Object.fromEntries(FIXTURE_FIELDS.map((field) => [field,
    (parsed as Record<string, string>)[field]])) as VerticalFixture;
}

function persistEphemeralSecrets(values: readonly string[]): void {
  const path = required('B12_VERTICAL_EPHEMERAL_SECRET_PATH');
  const current = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(current) || current.some((value) => typeof value !== 'string')) {
    throw new TypeError('B12 vertical ephemeral-secret manifest is invalid');
  }
  writeFileSync(
    path,
    JSON.stringify([...new Set([...current, ...values])]),
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
        .sort(([left], [right]) => left.localeCompare(right))
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

async function signInAdmin(page: Page, origin: string, loginName: string, password: string): Promise<string[]> {
  await page.goto(`${origin}/login`);
  await page.getByLabel('超级管理员账号').fill(loginName);
  await page.getByLabel('登录密码').fill(password);
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await expect(page).toHaveURL(/\/settings\/account\/security\/enroll$/);
  const otpAuthUri = await page.getByTestId('one-time-otpauth-uri').textContent();
  const secret = otpAuthUri ? new URL(otpAuthUri).searchParams.get('secret') : null;
  if (!secret) throw new TypeError('B12 vertical TOTP enrollment secret is unavailable');
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

async function awaitRefundConvergence(orderId: string, aftersaleId: string) {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b12-vertical-worker-proof',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await expect.poll(async () => {
      const result = await pool.query(
        `SELECT a.status::text AS aftersale_status, r.status::text AS refund_status,
                so.order_status::text, so.completion_reason::text, so.close_reason::text,
                so.fulfillment_status::text, so.refund_progress_status::text,
                so.refund_processing_status::text, so.refunded_amount::text,
                (SELECT COUNT(*)::int FROM public.aftersale AS order_aftersale
                  WHERE order_aftersale.order_id = $1) AS aftersale_count,
                COUNT(DISTINCT ra.id)::int AS attempts,
                COUNT(DISTINCT il.id)::int AS inventory_ledgers,
                COUNT(DISTINCT ci.id)::int AS callback_count,
                BOOL_AND(ci.signature_valid) AS callback_signature_valid,
                BOOL_AND(ci.retry_count = 0) AS callback_retry_count_zero,
                BOOL_AND(ci.status = 'PROCESSED'::public."CallbackStatus") AS callback_processed,
                BOOL_AND(ci.processed_at IS NOT NULL) AS callback_processed_at
         FROM public.sales_order AS so
         JOIN public.aftersale AS a ON a.order_id = so.id
         JOIN public.refund AS r ON r.aftersale_id = a.id
         LEFT JOIN public.refund_attempt AS ra ON ra.refund_id = r.id
         LEFT JOIN public.inventory_ledger AS il
           ON il.business_id = r.id AND il.ledger_type = 'RETURN_RESTOCK'
         LEFT JOIN public.callback_inbox AS ci
           ON ci.provider = 'MOCK'
          AND ci.event_type = 'refund.succeeded'
          AND ci.provider_event_id = ra.provider_request_id
          AND ci.payload->>'refund_attempt_id' = ra.id::text
         WHERE so.id = $1 AND a.id = $2
         GROUP BY a.status, r.status, so.order_status, so.completion_reason, so.close_reason,
                  so.fulfillment_status, so.refund_progress_status, so.refund_processing_status,
                  so.refunded_amount`,
        [orderId, aftersaleId],
      );
      return result.rows[0] ?? null;
    }, { timeout: 30_000 }).toEqual({
      aftersale_status: 'COMPLETED',
      aftersale_count: 1,
      attempts: 1,
      inventory_ledgers: 1,
      callback_count: 1,
      callback_processed: true,
      callback_processed_at: true,
      callback_retry_count_zero: true,
      callback_signature_valid: true,
      close_reason: null,
      completion_reason: 'FULL_REFUND_AFTER_SHIPMENT',
      fulfillment_status: 'DELIVERED',
      order_status: 'COMPLETED',
      refund_processing_status: 'IDLE',
      refund_progress_status: 'FULL',
      refund_status: 'SUCCEEDED',
      refunded_amount: '20.00',
    });
  } finally {
    await pool.end();
  }
}

test('browser completes B12 aftersale and refund through real infrastructure', async ({ browser, page, request }) => {
  const fixture = loadFixture();
  const apiOrigin = required('B12_VERTICAL_API_ORIGIN');
  const workerOrigin = required('B12_VERTICAL_WORKER_ORIGIN');
  const adminOrigin = required('B12_VERTICAL_ADMIN_ORIGIN');
  const miniappOrigin = required('B12_VERTICAL_MINIAPP_ORIGIN');
  const apiResponses: Array<{ cacheControl?: string; path: string; pragma?: string; status: number }> = [];
  const browserDiagnostics: string[] = [];
  const browserDiagnosticReads: Array<Promise<void>> = [];
  let privateCapabilityValues: string[] = [];
  const storageResponses: Array<{ path: string; status: number }> = [];
  const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
  const recordResponse = (response: import('@playwright/test').Response) => {
    const url = new URL(response.url());
    if (url.origin === storageOrigin) storageResponses.push({ path: url.pathname, status: response.status() });
    if (!url.pathname.startsWith('/api/v1/')) return;
    const headers = response.headers();
    apiResponses.push({
      cacheControl: headers['cache-control'],
      path: url.pathname,
      pragma: headers.pragma,
      status: response.status(),
    });
  };
  page.context().on('response', recordResponse);
  captureBrowserDiagnostics(page, 'admin', browserDiagnostics, browserDiagnosticReads);
  await page.evaluate(() => console.debug({ nested: { value: 'B12_NESTED_CONSOLE_CAPTURE' } }));

  const [apiHealth, workerHealth] = await Promise.all([
    request.get(`${apiOrigin}/internal/health`),
    request.get(`${workerOrigin}/internal/health`),
  ]);
  expect(await apiHealth.json()).toEqual({ service: 'api', status: 'ok' });
  expect(await workerHealth.json()).toEqual({ service: 'worker', status: 'ok' });

  const miniappContext = await browser.newContext({ permissions: [], viewport: { width: 390, height: 844 } });
  const miniappPage = await miniappContext.newPage();
  miniappPage.on('response', recordResponse);
  captureBrowserDiagnostics(miniappPage, 'miniapp', browserDiagnostics, browserDiagnosticReads);
  let aftersaleId = '';
  try {
    await miniappPage.goto(`${miniappOrigin}/#/pages/auth/login`);
    await inputByLabel(miniappPage, 'Mock 微信 code').fill(fixture.customerLoginCode);
    await miniappPage.getByLabel('用户协议').click();
    await miniappPage.getByLabel('隐私政策').click();
    await uniButton(miniappPage, '微信授权登录').click();
    await expect(miniappPage).toHaveURL(/\/pages\/profile\/index/);

    const imageResult = await miniappPage.evaluate((url) => new Promise<{ height: number; width: number }>(
      (resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ height: image.naturalHeight, width: image.naturalWidth });
        image.onerror = () => reject(new Error('public product image could not be decoded'));
        image.src = url;
      },
    ), fixture.publicImageUrl);
    expect(imageResult).toEqual({ height: 1, width: 1 });

    await navigate(miniappPage, `/pages/aftersales/apply?order_id=${fixture.orderId}`);
    await expect(miniappPage.getByTestId('aftersale-apply-ready')).toBeVisible();
    await expect(miniappPage.getByText(fixture.productName, { exact: true })).toBeVisible();
    await uniButton(miniappPage, '退货退款').click();
    const uploadIntentResponse = miniappPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/files/upload-intents' &&
      response.request().method() === 'POST' && response.status() === 200, { timeout: 30_000 });
    const uploadCompleteResponse = miniappPage.waitForResponse((response) =>
      /^\/api\/v1\/files\/[0-9A-HJKMNP-TV-Z]{26}\/complete$/.test(new URL(response.url()).pathname) &&
      response.request().method() === 'POST' && response.status() === 200, { timeout: 30_000 });
    const fileChooserPromise = miniappPage.waitForEvent('filechooser', { timeout: 10_000 });
    await miniappPage.getByTestId('aftersale-evidence-upload').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      buffer: EVIDENCE_PNG_BYTES,
      mimeType: 'image/png',
      name: 'b12-vertical-evidence.png',
    });
    const intentBody = await (await uploadIntentResponse).json() as {
      data?: { file_id?: unknown; purpose?: unknown; status?: unknown };
    };
    const evidenceFileId = intentBody.data?.file_id;
    if (typeof evidenceFileId !== 'string' || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(evidenceFileId) ||
      intentBody.data?.purpose !== 'AFTERSALE_EVIDENCE' || intentBody.data.status !== 'PENDING') {
      throw new TypeError('B12 private evidence intent did not return its closed contract');
    }
    persistEphemeralSecrets([evidenceFileId]);
    const completeBody = await (await uploadCompleteResponse).json() as {
      data?: { file_id?: unknown; purpose?: unknown; public_url?: unknown; status?: unknown };
    };
    if (completeBody.data?.file_id !== evidenceFileId ||
      completeBody.data.purpose !== 'AFTERSALE_EVIDENCE' || completeBody.data.status !== 'READY' ||
      completeBody.data.public_url !== null) {
      throw new TypeError('B12 private evidence completion did not return its closed contract');
    }
    await expect(miniappPage.getByText('b12-vertical-evidence.png', { exact: true })).toBeVisible();
    await miniappPage.getByLabel('增加数量').click();
    await miniappPage.getByLabel('增加数量').click();
    await miniappPage.getByTestId('aftersale-preview-submit').click();
    await expect(miniappPage.getByTestId('aftersale-preview')).toContainText('¥20.00');
    const createResponsePromise = miniappPage.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/aftersales' &&
      response.request().method() === 'POST' && response.status() === 201);
    await miniappPage.getByTestId('aftersale-confirm-submit').click();
    const createBody = await (await createResponsePromise).json() as {
      data?: { aftersale_id?: unknown };
    };
    if (typeof createBody.data?.aftersale_id !== 'string' ||
      !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(createBody.data.aftersale_id)) {
      throw new TypeError('B12 aftersale creation returned an invalid identifier');
    }
    aftersaleId = createBody.data.aftersale_id;
    await expect(miniappPage.getByTestId('aftersale-detail-ready')).toBeVisible();
  } finally {
    await miniappContext.close();
  }

  await signInAdmin(page, adminOrigin, fixture.adminLogin, fixture.adminPassword);
  await page.getByTitle('售后管理').click();
  await expect(page.getByTestId(`open-aftersale-${aftersaleId}`)).toBeVisible();
  await page.getByTestId(`open-aftersale-${aftersaleId}`).click();
  await expect(page.getByTestId('admin-aftersale-detail-content')).toBeVisible();
  const evidenceButton = page.getByTestId('admin-aftersale-application-evidence-0');
  await expect(evidenceButton).toBeVisible();
  const downloadResponsePromise = page.waitForResponse((response) =>
    /^\/api\/v1\/files\/[0-9A-HJKMNP-TV-Z]{26}\/download-url$/.test(new URL(response.url()).pathname) &&
    response.request().method() === 'GET' && response.status() === 200, { timeout: 20_000 });
  const evidencePopupPromise = page.waitForEvent('popup', { timeout: 20_000 });
  await evidenceButton.click();
  const [downloadResponse, evidencePopup] = await Promise.all([downloadResponsePromise, evidencePopupPromise]);
  const downloadBody = await downloadResponse.json() as {
    data?: { download_url?: unknown; file_id?: unknown };
  };
  if (typeof downloadBody.data?.download_url !== 'string' ||
    typeof downloadBody.data.file_id !== 'string' ||
    !downloadBody.data.download_url.includes(`/private/${downloadBody.data.file_id}`)) {
    throw new TypeError('B12 private evidence download capability is invalid');
  }
  const signedDownloadUrl = new URL(downloadBody.data.download_url);
  privateCapabilityValues = [
    signedDownloadUrl.href,
    signedDownloadUrl.search,
    ...Array.from(signedDownloadUrl.searchParams.values()),
  ].filter((value) => value.length >= 6);
  persistEphemeralSecrets(privateCapabilityValues);
  expect(downloadResponse.headers()['cache-control']).toBe('no-store, private');
  expect(downloadResponse.headers().pragma).toBe('no-cache');
  await evidencePopup.waitForLoadState('load');
  const popupUrl = new URL(evidencePopup.url());
  expect({
    capabilityMatches: popupUrl.search === signedDownloadUrl.search,
    hasSignature: popupUrl.searchParams.has('X-Amz-Signature'),
    originMatches: popupUrl.origin === signedDownloadUrl.origin,
    pathMatches: popupUrl.pathname === signedDownloadUrl.pathname,
  }).toEqual({ capabilityMatches: true, hasSignature: true, originMatches: true, pathMatches: true });
  await expect.poll(async () => await evidencePopup.locator('img').evaluate((image: HTMLImageElement) => ({
    complete: image.complete,
    height: image.naturalHeight,
    width: image.naturalWidth,
  }))).toEqual({ complete: true, height: 1, width: 1 });
  await evidencePopup.close();
  const anonymousPrivateUrl = new URL(signedDownloadUrl);
  anonymousPrivateUrl.search = '';
  expect((await request.get(anonymousPrivateUrl.href)).status()).toBe(403);
  await page.getByTestId('admin-aftersale-approve').click();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('售后初审已通过', { exact: true })).toBeVisible();

  const returnContext = await browser.newContext({ permissions: [], viewport: { width: 390, height: 844 } });
  const returnPage = await returnContext.newPage();
  returnPage.on('response', recordResponse);
  captureBrowserDiagnostics(returnPage, 'miniapp-return', browserDiagnostics, browserDiagnosticReads);
  try {
    await returnPage.goto(`${miniappOrigin}/#/pages/auth/login`);
    await inputByLabel(returnPage, 'Mock 微信 code').fill(fixture.customerLoginCode);
    await returnPage.getByLabel('用户协议').click();
    await returnPage.getByLabel('隐私政策').click();
    await uniButton(returnPage, '微信授权登录').click();
    await expect(returnPage).toHaveURL(/\/pages\/profile\/index/);
    await returnPage.goto(`${miniappOrigin}/#/pages/aftersales/detail?aftersale_id=${aftersaleId}`);
    await expect(returnPage.getByTestId('aftersale-return-address')).toBeVisible();
    await expect(returnPage.getByTestId('aftersale-return-address')).toContainText(fixture.returnAddressRecipient);
    await expect(returnPage.getByTestId('aftersale-return-address')).toContainText(fixture.returnAddressPhone);
    await expect(returnPage.getByTestId('aftersale-return-address')).toContainText(fixture.returnAddressProvince);
    await expect(returnPage.getByTestId('aftersale-return-address')).toContainText(fixture.returnAddressCity);
    await expect(returnPage.getByTestId('aftersale-return-address')).toContainText(fixture.returnAddressDistrict);
    await expect(returnPage.getByTestId('aftersale-return-address')).toContainText(fixture.returnAddressDetail);
    await expect(returnPage.getByTestId('aftersale-submit-shipment')).toBeVisible();
    await returnPage.getByTestId('aftersale-submit-shipment').click();
    const shipmentDialog = returnPage.getByRole('dialog');
    await expect(shipmentDialog).toBeVisible();
    const shipmentResponsePromise = returnPage.waitForResponse((response) =>
      new URL(response.url()).pathname === `/api/v1/store/aftersales/${aftersaleId}/return-shipment` &&
      response.request().method() === 'POST' && response.status() === 200, { timeout: 30_000 });
    const shipmentInputs = shipmentDialog.locator('input');
    await shipmentInputs.nth(0).fill(fixture.returnCarrierCode);
    await shipmentInputs.nth(1).fill(fixture.returnCarrierName);
    await shipmentInputs.nth(2).fill(fixture.returnTrackingNo);
    await shipmentDialog.getByTestId('aftersale-command-submit').click();
    await shipmentResponsePromise;
    await expect(returnPage.getByText('退货物流已提交，请保留寄件凭证。', { exact: true })).toBeVisible();
    await expect(returnPage.getByText(fixture.returnTrackingNo, { exact: true })).toBeVisible();
  } finally {
    await returnContext.close();
  }

  await page.getByTestId('admin-aftersale-refresh').click();
  await expect(page.getByTestId('admin-aftersale-record_inspection')).toBeVisible();
  await page.getByTestId('admin-aftersale-record_inspection').click();
  await expect(page.getByTestId('aftersale-command-record_inspection')).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('退货验收已封存', { exact: true })).toBeVisible();

  await page.getByTestId('admin-aftersale-create_refund').click();
  await page.getByLabel('操作原因').fill('纵向验收通过后创建受控退款');
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByTestId('aftersale-command-preview')).toBeVisible();
  await page.getByTestId('aftersale-command-submit').click();
  await expect(page.getByText('退款已创建并进入处理', { exact: true })).toBeVisible();
  await awaitRefundConvergence(fixture.orderId, aftersaleId);
  await page.getByTestId('admin-aftersale-refresh').click();
  await expect(page.getByTestId('admin-aftersale-actions')).toContainText('已完成');

  await Promise.all(browserDiagnosticReads);
  const browserDiagnosticText = browserDiagnostics.join('\n');
  expect({
    containsGeneratedSecret: browserDiagnosticText.includes('otpauth://') ||
      /\b[A-HJ-NP-Z2-9]{5}(?:-[A-HJ-NP-Z2-9]{5}){3}\b/u.test(browserDiagnosticText) ||
      /pvw_[A-Za-z0-9_-]{20,}/u.test(browserDiagnosticText),
    containsNestedCanary: browserDiagnosticText.includes('B12_NESTED_CONSOLE_CAPTURE'),
    containsProtectedValue: [fixture.adminLogin, fixture.adminPassword, fixture.customerLoginCode]
      .some((value) => browserDiagnosticText.includes(value)),
    containsSignedCapability: privateCapabilityValues.some((value) => browserDiagnosticText.includes(value)) ||
      /[?&]X-Amz-(?:Credential|Signature)=/iu.test(browserDiagnosticText),
  }).toEqual({
    containsGeneratedSecret: false,
    containsNestedCanary: true,
    containsProtectedValue: false,
    containsSignedCapability: false,
  });

  expect(storageResponses.some(({ path, status }) => path.includes('/public/') && status === 200)).toBe(true);
  expect(storageResponses.some(({ path, status }) => path.includes('/private/') && status === 200)).toBe(true);
  const personalized = apiResponses.filter(({ path }) =>
    path.startsWith('/api/v1/store/aftersales') || path.startsWith('/api/v1/admin/aftersales'));
  expect(personalized.some(({ path, status }) => path === '/api/v1/store/aftersales' && status === 201)).toBe(true);
  expect(personalized.every(({ cacheControl, pragma }) =>
    cacheControl === 'no-store, private' && pragma === 'no-cache')).toBe(true);
});
