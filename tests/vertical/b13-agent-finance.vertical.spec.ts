import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import { expect, test, type BrowserContext, type Page, type Response } from '@playwright/test';

const FIXTURE_FIELDS = [
  'adminLogin',
  'adminPassword',
  'agentLogin',
  'agentName',
  'agentPassword',
  'bankAccountHolder',
  'bankAccountNumber',
  'bankName',
  'customerLoginCode',
  'marker',
  'productId',
  'productName',
  'rawAddress',
  'rawPhone',
  'rawRecipient',
] as const;
const RESULT_FIELDS = [
  'agentId',
  'candidateId',
  'promotionAssetId',
  'qrFileId',
  'addressId',
  'orderId',
  'paymentIntentId',
  'shipmentId',
  'bankAccountId',
  'withdrawalId',
  'withdrawalNo',
  'proofFileId',
] as const;
const PROOF_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);
const databaseRequire = createRequire(`${process.cwd()}/packages/database/package.json`);
const apiRequire = createRequire(`${process.cwd()}/apps/api/package.json`);

type Fixture = Record<(typeof FIXTURE_FIELDS)[number], string>;
type JourneyResult = Record<(typeof RESULT_FIELDS)[number], string>;
type QueryResult = { rows: Array<Record<string, unknown>> };
type SqlReader = { query: (text: string, values?: unknown[]) => Promise<QueryResult> };
type RedisReader = { scanIterator: (options: { COUNT: number; MATCH: string }) => AsyncIterable<string | string[]> };

const capturedSecrets = new Set<string>();

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B13 vertical browser test`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value as Record<string, unknown>;
}

function stringField(value: Record<string, unknown>, field: string, label: string): string {
  const result = value[field];
  if (typeof result !== 'string' || result.length === 0) throw new TypeError(`${label} is invalid`);
  return result;
}

function loadFixture(): Fixture {
  const parsed = object(JSON.parse(readFileSync(required('B13_VERTICAL_FIXTURE_PATH'), 'utf8')), 'B13 fixture');
  if (!FIXTURE_FIELDS.every((field) => typeof parsed[field] === 'string' && (parsed[field] as string).length > 0)) {
    throw new TypeError('B13 vertical fixture file is invalid');
  }
  return Object.fromEntries(FIXTURE_FIELDS.map((field) => [field, parsed[field]])) as Fixture;
}

function persistEphemeralSecrets(values: readonly unknown[]): void {
  const path = required('B13_VERTICAL_EPHEMERAL_SECRET_PATH');
  const current = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  if (!Array.isArray(current) || current.some((value) => typeof value !== 'string')) {
    throw new TypeError('B13 vertical ephemeral-secret manifest is invalid');
  }
  const next = values.filter((value): value is string => typeof value === 'string' && value.length >= 6);
  for (const secret of [...current, ...next]) capturedSecrets.add(secret);
  writeFileSync(path, JSON.stringify([...new Set([...current, ...next])]), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function persistResult(result: JourneyResult): void {
  if (!RESULT_FIELDS.every((field) => typeof result[field] === 'string' && result[field].length > 0)) {
    throw new TypeError('B13 vertical result is incomplete');
  }
  const path = required('B13_VERTICAL_RESULT_PATH');
  writeFileSync(path, JSON.stringify(result), { mode: 0o600 });
  chmodSync(path, 0o600);
}

function nestedStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(nestedStrings);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(nestedStrings);
  return [];
}

async function responseData(response: Response): Promise<Record<string, unknown>> {
  const method = response.request().method();
  const path = new URL(response.url()).pathname;
  if (!response.ok()) throw new Error(`${method} ${path} returned ${response.status()}`);
  const envelope = object(await response.json() as unknown, `${method} ${path} envelope`);
  if (envelope.code !== 'OK') throw new Error(`${method} ${path} returned a non-success envelope`);
  return object(envelope.data, `${method} ${path} data`);
}

function persistSessionSecrets(data: Record<string, unknown>): Record<string, unknown> {
  const session = typeof data.session === 'object' && data.session !== null
    ? object(data.session, 'session')
    : data;
  persistEphemeralSecrets([data.pre_auth_token, session.access_token, session.refresh_token]);
  return session;
}

function apiResponse(page: Page, path: string, method = 'POST'): Promise<Response> {
  return page.waitForResponse((response) =>
    response.request().method() === method && new URL(response.url()).pathname === path);
}

function matchingApiResponse(page: Page, path: RegExp, method: string): Promise<Response> {
  return page.waitForResponse((response) =>
    response.request().method() === method && path.test(new URL(response.url()).pathname));
}

function inputByLabel(page: Page, label: string) {
  return page.getByLabel(label).locator('input');
}

function uniButton(page: Page, label: string) {
  return page.locator('uni-button').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) });
}

async function miniappNavigate(page: Page, url: string): Promise<void> {
  await page.evaluate((target) => new Promise<void>((resolve, reject) => {
    const runtime = (globalThis as unknown as {
      uni: { reLaunch: (options: { fail: (error: unknown) => void; success: () => void; url: string }) => void };
    }).uni;
    runtime.reLaunch({ fail: reject, success: resolve, url: target });
  }), url);
}

function decodeBase32(value: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let accumulator = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const character of value.toUpperCase().replaceAll('=', '')) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new TypeError('TOTP enrollment secret is invalid');
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function totpCounter(at = Date.now()): number {
  return Math.floor(at / 30_000);
}

function totp(secret: string, at = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(totpCounter(at)));
  const digest = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

async function laterTotp(secret: string, priorCounter: number): Promise<string> {
  if (totpCounter() <= priorCounter) {
    const delay = ((priorCounter + 1) * 30_000) - Date.now() + 300;
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, delay)));
  }
  return totp(secret);
}

async function redisKeys(redis: RedisReader): Promise<string[]> {
  const keys: string[] = [];
  for await (const value of redis.scanIterator({ MATCH: '*', COUNT: 100 })) {
    if (Array.isArray(value)) keys.push(...value);
    else keys.push(value);
  }
  return keys.sort();
}

async function waitForPaymentSettlement(
  pool: SqlReader,
  orderId: string,
  agentId: string,
): Promise<void> {
  await expect.poll(async () => {
    const result = await pool.query(
      `SELECT so.order_status::text, so.payment_status::text, so.final_agent_id::text,
              pi.status::text AS intent_status,
              (SELECT COUNT(*)::int FROM public.order_item_commission_snapshot AS cs
               JOIN public.order_item AS oi ON oi.id = cs.order_item_id
               WHERE oi.order_id = so.id) AS commission_snapshots
       FROM public.sales_order AS so
       JOIN public.payment_intent AS pi ON pi.order_id = so.id
       WHERE so.id = $1 ORDER BY pi.created_at DESC LIMIT 1`,
      [orderId],
    );
    const row = result.rows[0];
    return row?.order_status === 'PENDING_SHIPMENT' && row.payment_status === 'PAID' &&
      row.final_agent_id === agentId && row.intent_status === 'SUCCEEDED' && row.commission_snapshots === 1;
  }, { message: 'Worker did not settle the B13 payment', timeout: 30_000 }).toBe(true);
}

async function waitForAvailableCommission(pool: SqlReader, orderId: string, agentId: string): Promise<void> {
  await expect.poll(async () => {
    const result = await pool.query(
      `SELECT so.order_status::text, so.completion_reason::text,
              aw.available_balance::text, aw.frozen_balance::text,
              cs.original_commission::text, cp.state::text AS commission_state,
              cp.expected_remaining::text
       FROM public.sales_order AS so
       JOIN public.order_item AS oi ON oi.order_id = so.id
       JOIN public.order_item_commission_snapshot AS cs ON cs.order_item_id = oi.id
       JOIN public.order_item_commission_position AS cp ON cp.snapshot_id = cs.id
       JOIN public.agent_wallet AS aw ON aw.agent_id = so.final_agent_id
       WHERE so.id = $1 AND so.final_agent_id = $2`,
      [orderId, agentId],
    );
    const row = result.rows[0];
    return row?.order_status === 'COMPLETED' && row.completion_reason === 'CUSTOMER_CONFIRMED' &&
      row.available_balance === '200.00' && row.frozen_balance === '0.00' &&
      row.original_commission === '200.00' && row.commission_state === 'AVAILABLE' &&
      row.expected_remaining === '0.00';
  }, { message: 'Worker did not release the B13 commission', timeout: 30_000 }).toBe(true);
}

async function expectNoPersistedSecrets(page: Page, extra: readonly string[]): Promise<void> {
  const storage = await page.evaluate(() => JSON.stringify({
    local: Object.fromEntries(Object.entries(localStorage)),
    session: Object.fromEntries(Object.entries(sessionStorage)),
  }));
  for (const secret of new Set([...capturedSecrets, ...extra])) {
    if (secret.length >= 6 && storage.includes(secret)) {
      throw new Error('B13 browser storage contains a protected value');
    }
  }
}

async function previewAndConfirm(
  page: Page,
  previewPath: string,
  confirmPath: string,
  confirmLabel: string,
): Promise<Record<string, unknown>> {
  const previewResponse = apiResponse(page, previewPath);
  await page.getByRole('button', { name: '生成操作预览', exact: true }).click();
  const preview = await responseData(await previewResponse);
  persistEphemeralSecrets([preview.preview_token, preview.confirmation_hash]);
  await expect(page.getByTestId('b13-command-preview')).toBeVisible();
  const confirmResponse = apiResponse(page, confirmPath);
  await page.getByRole('button', { name: confirmLabel, exact: true }).click();
  return responseData(await confirmResponse);
}

test('Admin, Agent and Store drive the complete B13 finance journey through the real API',
  async ({ browser, page }) => {
    test.setTimeout(180_000);
    capturedSecrets.clear();
    persistEphemeralSecrets([]);
    const fixture = loadFixture();
    const adminOrigin = required('B13_VERTICAL_ADMIN_ORIGIN');
    const agentOrigin = required('B13_VERTICAL_AGENT_ORIGIN');
    const miniappOrigin = required('B13_VERTICAL_MINIAPP_ORIGIN');
    const { Pool } = databaseRequire('pg');
    const pool = new Pool({
      application_name: 'qingxu-b13-playwright-reader',
      connectionString: required('DIRECT_URL'),
      connectionTimeoutMillis: 5_000,
      max: 1,
    });
    const { createClient } = apiRequire('redis');
    const redis = createClient({ url: required('REDIS_URL') });
    let agentContext: BrowserContext | undefined;
    let storeContext: BrowserContext | undefined;
    try {
      await redis.connect();

      await page.goto(`${adminOrigin}/login`);
      await page.getByLabel('超级管理员账号').fill(fixture.adminLogin);
      await page.getByLabel('登录密码').fill(fixture.adminPassword);
      const adminLoginResponse = apiResponse(page, '/api/v1/admin/auth/login');
      const enrollmentResponse = apiResponse(page, '/api/v1/admin/auth/mfa/totp/enroll');
      await page.getByRole('button', { name: '登录总部管理后台' }).click();
      persistSessionSecrets(await responseData(await adminLoginResponse));
      await expect(page).toHaveURL(/\/settings\/account\/security\/enroll$/);
      const enrollment = await responseData(await enrollmentResponse);
      const otpauthUri = stringField(enrollment, 'otpauth_uri', 'TOTP enrollment URI');
      const otpSecret = new URL(otpauthUri).searchParams.get('secret') ?? '';
      if (!otpSecret) throw new TypeError('TOTP enrollment secret is missing');
      const enrollmentAt = Date.now();
      const enrollmentCounter = totpCounter(enrollmentAt);
      const enrollmentCode = totp(otpSecret, enrollmentAt);
      persistEphemeralSecrets([otpauthUri, otpSecret, enrollmentCode]);
      const displayedEnrollment = await page.getByTestId('one-time-otpauth-uri').textContent();
      if (displayedEnrollment !== otpauthUri) throw new Error('Admin enrollment URI does not match its response');
      await page.getByLabel('验证动态码').fill(enrollmentCode);
      const verifyEnrollmentResponse = apiResponse(page, '/api/v1/admin/auth/mfa/totp/enroll/verify');
      await page.getByRole('button', { name: '验证并完成绑定' }).click();
      const enrollmentResult = await responseData(await verifyEnrollmentResponse);
      persistSessionSecrets(enrollmentResult);
      const recoveryCodes = enrollmentResult.recovery_codes;
      if (!Array.isArray(recoveryCodes) || recoveryCodes.some((code) => typeof code !== 'string')) {
        throw new TypeError('Admin recovery codes are invalid');
      }
      persistEphemeralSecrets(recoveryCodes);
      await expect(page.getByTestId('one-time-recovery-codes').locator('code')).toHaveCount(recoveryCodes.length);
      await page.getByRole('button', { name: '我已安全保存' }).click();
      await expect(page).toHaveURL(/\/catalog\/brands$/);

      await page.getByTitle('代理管理').click();
      await expect(page).toHaveURL(/\/agents$/);
      await page.getByTestId('agent-create-open').click();
      await page.getByLabel('代理名称').fill(fixture.agentName);
      await page.getByLabel('登录账号').fill(fixture.agentLogin);
      await page.getByLabel('联系人').fill(fixture.bankAccountHolder);
      const createAgentResponse = apiResponse(page, '/api/v1/admin/agents');
      await page.getByRole('button', { name: '创建并签发凭据' }).click();
      const createdAgent = await responseData(await createAgentResponse);
      const agent = object(createdAgent.agent, 'created Agent');
      const invite = object(createdAgent.initial_invite_code, 'initial invite code');
      const agentId = stringField(agent, 'agent_id', 'Agent ID');
      const temporaryPassword = stringField(createdAgent, 'temporary_password', 'temporary password');
      const initialInviteCode = stringField(invite, 'code', 'initial invite code');
      persistEphemeralSecrets([temporaryPassword, initialInviteCode]);
      const displayedPassword = await page.getByTestId('agent-temporary-password').textContent();
      const displayedInvite = await page.getByTestId('agent-initial-invite-code').textContent();
      if (displayedPassword !== temporaryPassword || displayedInvite !== initialInviteCode) {
        throw new Error('Admin one-time Agent disclosure does not match its response');
      }
      await page.getByRole('button', { name: '我已完成交接并清除' }).click();
      const agentRow = page.getByRole('row').filter({ hasText: fixture.agentName });
      await expect(agentRow).toContainText(fixture.agentLogin);

      agentContext = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const agentPage = await agentContext.newPage();
      await agentPage.goto(`${agentOrigin}/login`);
      await agentPage.getByTestId('agent-login-name').fill(fixture.agentLogin);
      await agentPage.getByTestId('agent-login-password').fill(temporaryPassword);
      const agentLoginResponse = apiResponse(agentPage, '/api/v1/agent/auth/login');
      await agentPage.getByTestId('agent-login-submit').click();
      persistSessionSecrets(await responseData(await agentLoginResponse));
      await expect(agentPage).toHaveURL(/\/change-password$/);
      await agentPage.getByTestId('agent-current-password').fill(temporaryPassword);
      await agentPage.getByTestId('agent-new-password').fill(fixture.agentPassword);
      await agentPage.getByTestId('agent-confirm-password').fill(fixture.agentPassword);
      const passwordChangeResponse = apiResponse(agentPage, '/api/v1/agent/auth/change-temporary-password');
      await agentPage.getByTestId('agent-forced-password-submit').click();
      persistSessionSecrets(await responseData(await passwordChangeResponse));
      await expect(agentPage).toHaveURL(/\/dashboard$/);
      await expect(agentPage.getByTestId('dashboard-metrics')).toBeVisible();

      await agentPage.getByTestId('agent-nav-products').click();
      await expect(agentPage).toHaveURL(/\/products$/);
      await expect(agentPage.getByText(fixture.productName, { exact: true })).toBeVisible();
      await agentPage.locator(`[data-testid="product-promote-${fixture.productId}"]:visible`).click();
      await expect(agentPage.getByTestId('promotion-dialog')).toBeVisible();
      const promotionResponse = apiResponse(agentPage, '/api/v1/agent/promotion-assets');
      const qrDownloadResponse = matchingApiResponse(
        agentPage,
        /^\/api\/v1\/files\/[0-9A-HJKMNP-TV-Z]{26}\/download-url$/,
        'GET',
      );
      await agentPage.getByTestId('promotion-create').click();
      const promotion = await responseData(await promotionResponse);
      const promotionAssetId = stringField(promotion, 'promotion_asset_id', 'promotion asset ID');
      const publicUrl = stringField(promotion, 'public_url', 'promotion URL');
      const qrFile = object(promotion.qr_file, 'promotion QR file');
      const qrFileId = stringField(qrFile, 'file_id', 'promotion QR file ID');
      const qrDownload = await responseData(await qrDownloadResponse);
      persistEphemeralSecrets([publicUrl, qrDownload.download_url]);
      await expect(agentPage.getByTestId('promotion-qr')).toBeVisible();
      const qrLoaded = await agentPage.getByTestId('promotion-qr').evaluate((element) =>
        (element as HTMLImageElement).complete && (element as HTMLImageElement).naturalWidth > 0);
      if (!qrLoaded) throw new Error('Promotion QR did not render');
      const promotionLink = new URL(publicUrl);
      const linkInvite = promotionLink.searchParams.get('invite_code') ?? '';
      const linkPromotionId = promotionLink.searchParams.get('promotion_asset_id') ?? '';
      if (linkInvite !== initialInviteCode || linkPromotionId !== promotionAssetId) {
        throw new Error('Promotion link does not bind the issued Agent credentials');
      }
      await agentPage.getByTestId('promotion-dialog')
        .getByRole('button', { name: '关闭', exact: true }).click();

      storeContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const storePage = await storeContext.newPage();
      const candidateResponse = apiResponse(storePage, '/api/v1/store/attribution/candidates');
      await storePage.goto(`${miniappOrigin}/#/pages/profile/agent?invite_code=${encodeURIComponent(linkInvite)}` +
        `&promotion_asset_id=${encodeURIComponent(promotionAssetId)}`);
      const candidateResult = await responseData(await candidateResponse);
      const candidate = object(candidateResult.candidate, 'attribution candidate');
      const candidateId = stringField(candidate, 'candidate_id', 'candidate ID');
      persistEphemeralSecrets([candidateResult.candidate_token]);
      await expect(storePage.getByText('待确认服务关系', { exact: true })).toBeVisible();
      await expect(storePage.getByText(fixture.agentName, { exact: true })).toBeVisible();
      await uniButton(storePage, '登录后确认').click();
      await expect(storePage).toHaveURL(/\/pages\/auth\/login/);
      await inputByLabel(storePage, 'Mock 微信 code').fill(fixture.customerLoginCode);
      await storePage.getByLabel('用户协议').click();
      await storePage.getByLabel('隐私政策').click();
      const storeLoginResponse = apiResponse(storePage, '/api/v1/store/auth/wechat/login');
      await uniButton(storePage, '微信授权登录').click();
      persistSessionSecrets(await responseData(await storeLoginResponse));
      await expect(storePage).toHaveURL(/\/pages\/profile\/agent/);
      const attributionConfirmResponse = apiResponse(storePage, '/api/v1/store/attribution/candidate/confirm');
      await uniButton(storePage, '确认服务关系').click();
      const serviceAgent = await responseData(await attributionConfirmResponse);
      if (serviceAgent.agent_id !== agentId) throw new Error('Store attribution bound the wrong Agent');
      await expect(storePage).toHaveURL(/\/pages\/profile\/agent\?invite_code=/);
      await expect(storePage.getByLabel('当前服务代理')).toContainText('服务关系已确认');
      await expect(uniButton(storePage, '确认服务关系')).toHaveCount(0);

      await miniappNavigate(storePage, '/pages/address/index');
      await expect(storePage.getByText('暂无收货地址', { exact: true })).toBeVisible();
      await uniButton(storePage, '新增地址').click();
      await expect(storePage).toHaveURL(/\/pages\/address\/edit/);
      await inputByLabel(storePage, '收货人').fill(fixture.rawRecipient);
      await inputByLabel(storePage, '收货手机号').fill(fixture.rawPhone);
      await inputByLabel(storePage, '省').fill('浙江省');
      await inputByLabel(storePage, '市').fill('杭州市');
      await inputByLabel(storePage, '区').fill('西湖区');
      await storePage.getByLabel('详细地址').locator('textarea').fill(fixture.rawAddress);
      const addressResponse = apiResponse(storePage, '/api/v1/store/addresses');
      await uniButton(storePage, '保存地址').click();
      const address = await responseData(await addressResponse);
      const addressId = stringField(address, 'address_id', 'address ID');
      await expect(storePage).toHaveURL(/\/pages\/address\/index/);

      await miniappNavigate(storePage, `/pages/product/detail?product_id=${fixture.productId}`);
      await expect(storePage.getByText(fixture.productName, { exact: true }).first()).toBeVisible();
      const quoteResponse = apiResponse(storePage, '/api/v1/store/checkout/quotes');
      await uniButton(storePage, '立即购买').click();
      await expect(storePage).toHaveURL(/\/pages\/checkout\/index/);
      const quote = await responseData(await quoteResponse);
      persistEphemeralSecrets([quote.quote_token, quote.confirmation_hash]);
      await expect(uniButton(storePage, '提交待付款订单')).toBeEnabled();
      const orderResponse = apiResponse(storePage, '/api/v1/store/orders');
      await uniButton(storePage, '提交待付款订单').click();
      await storePage.getByText('确认下单', { exact: true }).last().click();
      const order = await responseData(await orderResponse);
      const orderId = stringField(order, 'order_id', 'order ID');
      await expect(storePage).toHaveURL(new RegExp(`/pages/orders/detail\\?order_id=${orderId}$`));

      const redisBeforePayment = new Set(await redisKeys(redis));
      const paymentResponse = apiResponse(storePage, `/api/v1/store/orders/${orderId}/payment-intents`);
      await uniButton(storePage, '支付订单').click();
      const payment = await responseData(await paymentResponse);
      const paymentIntentId = stringField(payment, 'payment_intent_id', 'payment intent ID');
      persistEphemeralSecrets(nestedStrings(payment.provider_payload));
      await expect.poll(async () => (await redisKeys(redis)).some((key) => !redisBeforePayment.has(key)), {
        message: 'Payment intent did not create new Redis evidence',
        timeout: 10_000,
      }).toBe(true);
      await expect(storePage).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${orderId}$`));
      await expect(uniButton(storePage, '成功')).toBeVisible();
      const mockResultResponse = apiResponse(storePage, `/api/v1/store/mock-payments/${paymentIntentId}/result`);
      await uniButton(storePage, '成功').click();
      await responseData(await mockResultResponse);
      await waitForPaymentSettlement(pool, orderId, agentId);
      await expect(storePage.getByText('支付成功', { exact: true })).toBeVisible();

      await page.getByTitle('订单中心').click();
      await expect(page).toHaveURL(/\/orders$/);
      await expect(page.getByTestId(`admin-order-row-${orderId}`)).toBeVisible();
      await page.getByTestId(`admin-order-open-${orderId}`).click();
      await expect(page).toHaveURL(new RegExp(`/orders/${orderId}$`));
      await expect(page.getByTestId('admin-order-detail-content')).toBeVisible();
      await page.getByTestId('admin-order-ship').click();
      await page.getByTestId('order-shipment-carrier-code').fill('B13V');
      await page.getByTestId('order-shipment-carrier-name').fill(`B13 Carrier ${fixture.marker}`);
      await page.getByTestId('order-shipment-tracking-no').fill(`B13-${fixture.marker}`);
      const shipmentResponse = apiResponse(page, `/api/v1/admin/orders/${orderId}/shipments`);
      await page.getByTestId('order-ship-submit').click();
      const shipment = await responseData(await shipmentResponse);
      const shipmentId = stringField(shipment, 'shipment_id', 'shipment ID');
      await expect(page.getByTestId('admin-order-package')).toContainText(`B13-${fixture.marker}`);

      await miniappNavigate(storePage, `/pages/orders/detail?order_id=${orderId}`);
      await expect(storePage.getByTestId('confirm-receipt-button')).toBeEnabled();
      await storePage.getByTestId('confirm-receipt-button').click();
      await expect(storePage.getByTestId('confirm-receipt-dialog')).toBeVisible();
      const receiptResponse = apiResponse(storePage, `/api/v1/store/orders/${orderId}/confirm-receipt`);
      await storePage.getByTestId('confirm-receipt-dialog-submit').click();
      const receivedOrder = await responseData(await receiptResponse);
      if (receivedOrder.order_status !== 'COMPLETED') throw new Error('Store receipt did not complete the order');
      await waitForAvailableCommission(pool, orderId, agentId);
      await expect(storePage.getByTestId('order-detail-state-ready')).toContainText('已完成');

      const walletResponse = apiResponse(agentPage, '/api/v1/agent/wallet', 'GET');
      await agentPage.getByTestId('agent-nav-wallet').click();
      const fundedWallet = await responseData(await walletResponse);
      if (fundedWallet.available_balance !== '200.00') throw new Error('Agent wallet did not expose settled commission');
      await agentPage.getByTestId('bank-account-open').click();
      await agentPage.getByTestId('bank-account-holder').fill(fixture.bankAccountHolder);
      await agentPage.getByTestId('bank-account-bank').fill(fixture.bankName);
      await agentPage.getByTestId('bank-account-number').fill(fixture.bankAccountNumber);
      const bankResponse = apiResponse(agentPage, '/api/v1/agent/bank-accounts');
      await agentPage.getByTestId('bank-account-submit').click();
      const bank = await responseData(await bankResponse);
      const bankAccountId = stringField(bank, 'bank_account_id', 'bank account ID');
      await expect(agentPage.getByTestId('bank-account-dialog')).toBeHidden();
      const withdrawalOpen = agentPage.locator('[data-testid="agent-primary-action"]:visible');
      await expect(withdrawalOpen).toBeEnabled();
      await withdrawalOpen.click();
      await agentPage.getByTestId('withdrawal-amount').fill('100.00');
      await agentPage.getByTestId('withdrawal-continue').click();
      await expect(agentPage.getByTestId('withdrawal-confirmation')).toContainText('¥ 100.00');
      const withdrawalResponse = apiResponse(agentPage, '/api/v1/agent/withdrawals');
      await agentPage.getByTestId('withdrawal-confirm').click();
      const withdrawal = await responseData(await withdrawalResponse);
      const withdrawalId = stringField(withdrawal, 'withdrawal_id', 'withdrawal ID');
      const withdrawalNo = stringField(withdrawal, 'withdrawal_no', 'withdrawal number');
      await expect(agentPage.getByTestId('withdrawal-dialog')).toBeHidden();

      await page.getByTitle('提现审核').click();
      await expect(page).toHaveURL(/\/withdrawals$/);
      const withdrawalRow = page.getByRole('row').filter({ hasText: withdrawalNo });
      await expect(withdrawalRow).toContainText('待审核');
      await withdrawalRow.getByRole('button', { name: '处理' }).click();
      await expect(page).toHaveURL(new RegExp(`/withdrawals/${withdrawalId}$`));
      await page.getByTestId('withdrawal-approve-open').click();
      const approved = await previewAndConfirm(
        page,
        `/api/v1/admin/withdrawals/${withdrawalId}/approve-preview`,
        `/api/v1/admin/withdrawals/${withdrawalId}/approve`,
        '确认批准',
      );
      if (approved.status !== 'APPROVED') throw new Error('Admin approval did not advance the withdrawal');
      await expect(page.getByTestId('admin-withdrawal-detail-page')).toContainText('APPROVED');

      await page.getByRole('button', { name: 'TOTP 查看完整收款账号' }).click();
      const payoutCode = await laterTotp(otpSecret, enrollmentCounter);
      persistEphemeralSecrets([payoutCode]);
      await page.getByLabel('当前 TOTP 动态验证码').fill(payoutCode);
      const reauthResponse = apiResponse(page, '/api/v1/admin/auth/reauth');
      const payoutResponse = apiResponse(
        page,
        `/api/v1/admin/withdrawals/${withdrawalId}/payout-account-reveal`,
      );
      await page.getByRole('button', { name: '验证并单次查看' }).click();
      const reauth = await responseData(await reauthResponse);
      persistEphemeralSecrets([reauth.reauth_grant]);
      const payout = await responseData(await payoutResponse);
      const payoutNumber = stringField(payout, 'account_number', 'payout account number');
      if (payoutNumber !== fixture.bankAccountNumber) throw new Error('Payout reveal returned the wrong account');
      const displayedPayout = await page.getByTestId('payout-account-number').textContent();
      if (displayedPayout !== fixture.bankAccountNumber) throw new Error('Admin did not render the revealed account once');
      await page.getByRole('button', { name: '关闭并清除' }).click();
      await expect(page.getByTestId('payout-account-number')).toHaveCount(0);

      const uploadIntentResponse = apiResponse(page, '/api/v1/files/upload-intents');
      const uploadPutResponse = page.waitForResponse((response) => response.request().method() === 'PUT');
      const uploadCompleteResponse = matchingApiResponse(
        page,
        /^\/api\/v1\/files\/[0-9A-HJKMNP-TV-Z]{26}\/complete$/,
        'POST',
      );
      const attachProofResponse = apiResponse(page, `/api/v1/admin/withdrawals/${withdrawalId}/proofs`);
      await page.locator('input[type="file"][aria-label="选择付款凭证"]').setInputFiles({
        buffer: PROOF_BYTES,
        mimeType: 'image/png',
        name: `b13-${fixture.marker}.png`,
      });
      const uploadIntent = await responseData(await uploadIntentResponse);
      const proofFileId = stringField(uploadIntent, 'file_id', 'proof file ID');
      persistEphemeralSecrets([uploadIntent.upload_url]);
      const uploadPut = await uploadPutResponse;
      if (!uploadPut.ok()) throw new Error('Payment proof object upload failed');
      await responseData(await uploadCompleteResponse);
      const proofAttached = await responseData(await attachProofResponse);
      if (!Array.isArray(proofAttached.proof_file_ids) || !proofAttached.proof_file_ids.includes(proofFileId)) {
        throw new Error('Payment proof was not attached to the withdrawal');
      }
      await expect(page.getByText(proofFileId, { exact: true })).toBeVisible();
      await expect(page.getByTestId('withdrawal-paid-open')).toBeEnabled();
      await page.getByTestId('withdrawal-paid-open').click();
      const paid = await previewAndConfirm(
        page,
        `/api/v1/admin/withdrawals/${withdrawalId}/mark-paid-preview`,
        `/api/v1/admin/withdrawals/${withdrawalId}/mark-paid`,
        '确认已付款',
      );
      if (paid.status !== 'PAID') throw new Error('Admin paid command did not finalize the withdrawal');

      const finalAdminResponse = apiResponse(page, `/api/v1/admin/withdrawals/${withdrawalId}`, 'GET');
      await page.getByTestId('admin-withdrawal-detail-page').getByRole('button', { name: '刷新' }).click();
      const finalAdminWithdrawal = await responseData(await finalAdminResponse);
      if (finalAdminWithdrawal.status !== 'PAID') throw new Error('Admin final readback is not PAID');
      await expect(page.getByTestId('admin-withdrawal-detail-page')).toContainText(withdrawalNo);
      await expect(page.getByTestId('admin-withdrawal-detail-page')).toContainText('PAID');

      const finalWalletResponse = apiResponse(agentPage, '/api/v1/agent/wallet', 'GET');
      await agentPage.getByTestId('wallet-refresh').click();
      const finalWallet = await responseData(await finalWalletResponse);
      if (finalWallet.available_balance !== '100.00' || finalWallet.frozen_balance !== '0.00') {
        throw new Error('Agent final wallet balances are inconsistent');
      }
      const agentWithdrawalRow = agentPage.getByRole('row').filter({ hasText: withdrawalNo });
      await expect(agentWithdrawalRow).toContainText('已打款');

      const finalStoreResponse = apiResponse(storePage, `/api/v1/store/orders/${orderId}`, 'GET');
      await miniappNavigate(storePage, `/pages/orders/detail?order_id=${orderId}`);
      const finalStoreOrder = await responseData(await finalStoreResponse);
      if (finalStoreOrder.order_status !== 'COMPLETED') throw new Error('Store final order is not complete');
      await expect(storePage.getByTestId('order-detail-state-ready')).toContainText(fixture.productName);
      await expect(storePage.getByTestId('order-detail-state-ready')).toContainText('已完成');

      await expectNoPersistedSecrets(page, [
        fixture.adminPassword,
        fixture.bankAccountHolder,
        fixture.bankAccountNumber,
        fixture.bankName,
        otpSecret,
      ]);
      await expectNoPersistedSecrets(agentPage, [
        temporaryPassword,
        fixture.agentPassword,
        fixture.bankAccountHolder,
        fixture.bankAccountNumber,
        fixture.bankName,
      ]);
      await expectNoPersistedSecrets(storePage, [
        fixture.customerLoginCode,
        fixture.rawAddress,
        fixture.rawPhone,
        fixture.rawRecipient,
      ]);

      persistResult({
        addressId,
        agentId,
        bankAccountId,
        candidateId,
        orderId,
        paymentIntentId,
        promotionAssetId,
        proofFileId,
        qrFileId,
        shipmentId,
        withdrawalId,
        withdrawalNo,
      });
    } finally {
      await Promise.allSettled([
        agentContext?.close(),
        storeContext?.close(),
        redis.isOpen ? redis.quit() : Promise.resolve(),
        pool.end(),
      ]);
    }
  });
