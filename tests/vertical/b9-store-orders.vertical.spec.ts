import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { expect, test, type Page } from '@playwright/test';

const databaseRequire = createRequire(`${process.cwd()}/packages/database/package.json`);
const CAPABILITY_FINGERPRINT_DOMAIN = 'qingxu:b9-vertical-capability:v1\0';

interface StoreRequest {
  body: unknown;
  headers: Record<string, string>;
  method: string;
  path: string;
}

interface StoreResponse {
  cacheControl: string | undefined;
  method: string;
  path: string;
  pragma: string | undefined;
  status: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B9 vertical test`);
  return value;
}

function fingerprintCapability(value: string, key: Buffer): { digest: string; length: number } {
  return {
    digest: createHmac('sha256', key)
      .update(CAPABILITY_FINGERPRINT_DOMAIN, 'utf8')
      .update(value, 'utf8')
      .digest('hex'),
    length: value.length,
  };
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
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(layout.body, layout.document)).toBeLessThanOrEqual(layout.viewport + 1);
}

function orderIdFromPage(page: Page): string {
  const match = /[?&]order_id=([0-9A-HJKMNP-TV-Z]{26})(?:&|$)/.exec(page.url());
  if (!match?.[1]) throw new TypeError('B9 vertical order detail URL does not contain an order ULID');
  return match[1];
}

async function awaitWorkerExpiration(orderId: string): Promise<void> {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b9-vertical-clock',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await expect.poll(async () => {
      const facts = await pool.query(
        `SELECT so.order_status::text, so.close_reason::text,
                ir.status::text AS reservation_status,
                ib.locked_qty,
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
      return facts.rows[0] ?? null;
    }, { timeout: 20_000 }).toEqual({
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

async function createBuyNowOrder(page: Page, productId: string, productName: string): Promise<{
  orderId: string;
  responseStatus: number;
}> {
  await navigate(page, `/pages/product/detail?product_id=${productId}`, 'reLaunch');
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
  await uniButton(page, '立即购买').click();
  await expect(page).toHaveURL(/\/pages\/checkout\/index\?source=BUY_NOW/);
  await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
  await expect(uniButton(page, '提交待付款订单')).toBeEnabled();
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/v1/store/orders' && response.request().method() === 'POST';
  });
  await uniButton(page, '提交待付款订单').click();
  await page.getByText('确认下单', { exact: true }).last().click();
  const response = await responsePromise;
  await expect(page).toHaveURL(/\/pages\/orders\/detail\?order_id=[0-9A-HJKMNP-TV-Z]{26}$/);
  return { orderId: orderIdFromPage(page), responseStatus: response.status() };
}

test('browser creates, queries and closes B9 reservations through real API, data stores and Worker',
  async ({ page, request }) => {
    const apiOrigin = required('B9_VERTICAL_API_ORIGIN');
    const workerOrigin = required('B9_VERTICAL_WORKER_ORIGIN');
    const loginCode = required('B9_VERTICAL_LOGIN_CODE');
    const expiredOrderId = required('B9_VERTICAL_EXPIRED_ORDER_ID');
    const productId = required('B9_VERTICAL_PRODUCT_ID');
    const productName = required('B9_VERTICAL_PRODUCT_NAME');
    const skuId = required('B9_VERTICAL_SKU_ID');
    const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
    const phone = ['137', '0000', '0009'].join('');
    const addressDetail = '文一路 99 号 B9 纵向测试';
    const storeRequests: StoreRequest[] = [];
    const storeResponses: StoreResponse[] = [];
    const storageResponses: Array<{ method: string; path: string; status: number }> = [];
    const checkoutCapabilities: string[] = [];
    const browserDiagnosticMessages: string[] = [];
    const browserDiagnosticReads: Array<Promise<void>> = [];
    let capabilityArtifactWriteFailed = false;
    let capabilityArtifactWrite: Promise<void> | undefined;

    page.on('console', (message) => {
      browserDiagnosticReads.push(Promise.all(message.args().map(async (argument) => {
        try {
          return stableDiagnosticSerialization(await argument.jsonValue());
        } catch {
          return '';
        }
      })).then((values) => {
        browserDiagnosticMessages.push([message.text(), ...values].join('\n'));
      }).catch(() => {
        browserDiagnosticMessages.push(message.text());
      }));
    });
    page.on('pageerror', (error) => browserDiagnosticMessages.push(error.stack ?? error.message));

    page.on('request', (current) => {
      const url = new URL(current.url());
      if (!url.pathname.startsWith('/api/v1/store/orders')) return;
      const rawBody = current.postData() === null ? null : current.postDataJSON() as Record<string, unknown>;
      const body = url.pathname === '/api/v1/store/orders' && current.method() === 'POST' && rawBody !== null
        ? {
            has_confirmation_hash: typeof rawBody.confirmation_hash === 'string',
            has_quote_token: typeof rawBody.quote_token === 'string',
            items: rawBody.items,
            source: rawBody.source,
          }
        : null;
      if (body !== null && capabilityArtifactWrite === undefined) {
        const quoteToken = rawBody?.quote_token;
        const confirmationHash = rawBody?.confirmation_hash;
        if (typeof quoteToken === 'string' && typeof confirmationHash === 'string') {
          checkoutCapabilities.push(quoteToken, confirmationHash);
          const key = Buffer.from(required('B9_VERTICAL_CAPABILITY_HMAC_KEY_BASE64'), 'base64');
          const fingerprints = checkoutCapabilities.map((value) => fingerprintCapability(value, key));
          capabilityArtifactWrite = writeFile(
            required('B9_VERTICAL_CAPABILITY_ARTIFACT_PATH'),
            JSON.stringify(fingerprints),
            { encoding: 'utf8', flag: 'wx' },
          ).catch(() => {
            capabilityArtifactWriteFailed = true;
          });
        }
      }
      const headers = current.headers();
      storeRequests.push({
        body,
        headers: {
          'idempotency-key': headers['idempotency-key'] ?? '',
          'if-match': headers['if-match'] ?? '',
        },
        method: current.method(),
        path: url.pathname,
      });
    });
    page.on('response', (response) => {
      const url = new URL(response.url());
      if (url.origin === storageOrigin) {
        storageResponses.push({
          method: response.request().method(),
          path: url.pathname,
          status: response.status(),
        });
      }
      if (!url.pathname.startsWith('/api/v1/store/')) return;
      const headers = response.headers();
      storeResponses.push({
        cacheControl: headers['cache-control'],
        method: response.request().method(),
        path: url.pathname,
        pragma: headers.pragma,
        status: response.status(),
      });
    });

    const [apiHealth, workerHealth] = await Promise.all([
      request.get(`${apiOrigin}/internal/health`),
      request.get(`${workerOrigin}/internal/health`),
    ]);
    expect(apiHealth.status()).toBe(200);
    expect(await apiHealth.json()).toEqual({ service: 'api', status: 'ok' });
    expect(workerHealth.status()).toBe(200);
    expect(await workerHealth.json()).toEqual({ service: 'worker', status: 'ok' });
    await awaitWorkerExpiration(expiredOrderId);

    await page.goto('/#/pages/auth/login');
    await inputByLabel(page, 'Mock 微信 code').fill(loginCode);
    await page.getByLabel('用户协议').click();
    await page.getByLabel('隐私政策').click();
    const loginPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/auth/wechat/login');
    await uniButton(page, '微信授权登录').click();
    expect((await loginPromise).status()).toBe(200);
    await expect(page).toHaveURL(/\/pages\/profile\/index/);

    await navigate(page, '/pages/address/index');
    await expect(page.getByText('暂无收货地址', { exact: true })).toBeVisible();
    await uniButton(page, '新增地址').click();
    await inputByLabel(page, '收货人').fill('纵向用户');
    await inputByLabel(page, '收货手机号').fill(phone);
    await inputByLabel(page, '省').fill('浙江省');
    await inputByLabel(page, '市').fill('杭州市');
    await inputByLabel(page, '区').fill('西湖区');
    await page.getByLabel('详细地址').locator('textarea').fill(addressDetail);
    const addressPromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/store/addresses' &&
        response.request().method() === 'POST');
    await uniButton(page, '保存地址').click();
    expect((await addressPromise).status()).toBe(200);
    await expect(page.getByText('137 **** 0009', { exact: true })).toBeVisible();

    await navigate(page, `/pages/product/detail?product_id=${productId}`, 'reLaunch');
    await expect(page.getByText(productName, { exact: true }).first()).toBeVisible();
    const image = page.locator('.detail-gallery .qx-product-image__asset img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({
      complete: element.complete,
      naturalHeight: element.naturalHeight,
      naturalWidth: element.naturalWidth,
    }))).toMatchObject({ complete: true, naturalHeight: 1, naturalWidth: 1 });

    const first = await createBuyNowOrder(page, productId, productName);
    expect(first.responseStatus).toBe(201);
    await expect(page.getByText(`QX${first.orderId}`, { exact: true })).toBeVisible();
    const cancelPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/v1/store/orders/${first.orderId}/cancel` &&
        response.request().method() === 'POST';
    });
    await uniButton(page, '取消订单').click();
    await page.getByText('确认取消', { exact: true }).last().click();
    expect((await cancelPromise).status()).toBe(200);
    await expect(page.getByText('订单已取消，服务端已确认关闭。', { exact: true })).toBeVisible();
    await expect(page.getByText('用户取消订单', { exact: true })).toBeVisible();

    await navigate(page, `/pages/orders/detail?order_id=${expiredOrderId}`, 'reLaunch');
    await expect(page.getByText('付款超时关闭', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('已关闭', { exact: true }).first()).toBeVisible();

    await navigate(page, '/pages/orders/index');
    await page.getByRole('tab', { name: '已关闭' }).click();
    await expect(page.getByText(productName, { exact: true })).toHaveCount(2);
    await expect(page.getByText('用户已取消', { exact: true })).toBeVisible();
    await expect(page.getByText('付款超时关闭', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    expect(storageResponses.some(({ method, path, status }) =>
      method === 'GET' && path.includes('/public/') && status === 200)).toBe(true);
    const creates = storeRequests.filter(({ method, path }) =>
      method === 'POST' && path === '/api/v1/store/orders');
    expect(creates).toHaveLength(1);
    const createKeys = creates.map(({ headers }) => headers['idempotency-key']);
    expect(createKeys.every((key) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(key ?? '')))
      .toBe(true);
    for (const { body } of creates) {
      expect(body).toMatchObject({
        has_confirmation_hash: true,
        has_quote_token: true,
        items: [{ quantity: 1, sku_id: skuId }],
        source: 'BUY_NOW',
      });
    }
    const cancellation = storeRequests.find(({ method, path }) =>
      method === 'POST' && path === `/api/v1/store/orders/${first.orderId}/cancel`);
    expect(cancellation?.body).toBeNull();
    expect(cancellation?.headers['if-match']).toBe('"1"');
    expect(cancellation?.headers['idempotency-key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const orderResponses = storeResponses.filter(({ path }) =>
      path === '/api/v1/store/checkout/quotes' || path.startsWith('/api/v1/store/orders'));
    expect(orderResponses.some(({ method, path, status }) =>
      method === 'POST' && path === '/api/v1/store/orders' && status === 201)).toBe(true);
    expect(orderResponses.every(({ cacheControl, pragma }) =>
      cacheControl === 'no-store, private' && pragma === 'no-cache')).toBe(true);

    await capabilityArtifactWrite;
    await Promise.all(browserDiagnosticReads);
    expect({
      artifactWritten: capabilityArtifactWrite !== undefined,
      artifactWriteSucceeded: !capabilityArtifactWriteFailed,
      capabilityCount: checkoutCapabilities.length,
      capabilitiesDistinct: new Set(checkoutCapabilities).size === checkoutCapabilities.length,
    }).toEqual({
      artifactWritten: true,
      artifactWriteSucceeded: true,
      capabilityCount: 2,
      capabilitiesDistinct: true,
    });

    const storageSafety = await page.evaluate(({ capabilities, detail, syntheticPhone }) => {
      const serialized = `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`;
      return {
        containsAddress: serialized.includes(detail),
        containsCheckoutCapability: capabilities.some((capability) => serialized.includes(capability)),
        containsPhone: serialized.includes(syntheticPhone),
        hasSubmitJournal: sessionStorage.getItem('qingxu:order-submit:v1') !== null,
      };
    }, { capabilities: checkoutCapabilities, detail: addressDetail, syntheticPhone: phone });
    expect(storageSafety).toEqual({
      containsAddress: false,
      containsCheckoutCapability: false,
      containsPhone: false,
      hasSubmitJournal: false,
    });
    expect({
      browserDiagnosticsContainCheckoutCapability: checkoutCapabilities.some((capability) =>
        browserDiagnosticMessages.some((message) => message.includes(capability))),
    }).toEqual({ browserDiagnosticsContainCheckoutCapability: false });
  });
