import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

import { expect, test, type Page } from '@playwright/test';
import type { DatabaseTransaction } from '@qingxu/database';

const databaseRequire = createRequire(`${process.cwd()}/packages/database/package.json`);
const apiRequire = createRequire(`${process.cwd()}/apps/api/package.json`);
const paymentRequire = createRequire(`${process.cwd()}/packages/payment/package.json`);
const CAPABILITY_FINGERPRINT_DOMAIN = 'qingxu:b10-vertical-capability:v1\0';

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
  if (!value) throw new TypeError(`${name} is required for the B10 vertical test`);
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

function secretRepresentations(base64Value: string): string[] {
  const bytes = Buffer.from(base64Value, 'base64');
  const decimalBytes = [...bytes];
  const spacedHex = decimalBytes.map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
  return [...new Set([
    base64Value,
    bytes.toString('hex'),
    spacedHex,
    `<Buffer ${spacedHex}>`,
    JSON.stringify(bytes),
    JSON.stringify(decimalBytes),
    decimalBytes.join(','),
  ])];
}

function diagnosticsContainProtectedValue(messages: readonly string[], values: readonly string[], key: Buffer): boolean {
  const diagnosticText = messages.join('\n');
  return values.some((value) => {
    if (value.length === 0) return false;
    const fingerprint = fingerprintCapability(value, key).digest;
    return diagnosticText.includes(value) || diagnosticText.includes(fingerprint);
  });
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
  if (!match?.[1]) throw new TypeError('B10 vertical order detail URL does not contain an order ULID');
  return match[1];
}

async function awaitWorkerExpiration(orderId: string): Promise<void> {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b10-vertical-clock',
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

async function awaitWorkerSettlement(orderId: string, paymentIntentId: string): Promise<void> {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b10-vertical-payment-settlement',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await expect.poll(async () => {
      const facts = await pool.query(
        `SELECT so.order_status::text, so.payment_status::text, so.fulfillment_status::text,
                so.payment_resolution::text, so.final_channel::text, so.paid_amount::text,
                ir.status::text AS reservation_status, ib.physical_qty, ib.locked_qty,
                pi.status::text AS intent_status,
                (SELECT COUNT(*)::int FROM public.payment_attempt AS pa
                 WHERE pa.payment_intent_id = pi.id AND pa.status = 'SUCCEEDED') AS success_attempts,
                (SELECT COUNT(*)::int FROM public.inventory_ledger AS il
                 WHERE il.business_id = ir.id AND il.sku_id = iri.sku_id
                   AND il.ledger_type = 'ORDER_PAID_DEDUCT') AS deduct_ledgers,
                (SELECT COUNT(*)::int FROM public.callback_inbox AS ci
                 WHERE ci.provider = 'MOCK' AND ci.status = 'PROCESSED'
                   AND ci.payload->>'provider_intent_id' = pi.provider_intent_id) AS processed_callbacks
         FROM public.sales_order AS so
         JOIN public.inventory_reservation AS ir ON ir.order_id = so.id
         JOIN public.inventory_reservation_item AS iri ON iri.reservation_id = ir.id
         JOIN public.inventory_balance AS ib ON ib.sku_id = iri.sku_id
         JOIN public.payment_intent AS pi ON pi.order_id = so.id
         WHERE so.id = $1 AND pi.id = $2`,
        [orderId, paymentIntentId],
      );
      return facts.rows[0] ?? null;
    }, { timeout: 30_000 }).toEqual({
      deduct_ledgers: 1,
      final_channel: 'DIRECT',
      fulfillment_status: 'READY_TO_SHIP',
      intent_status: 'SUCCEEDED',
      locked_qty: 0,
      order_status: 'PENDING_SHIPMENT',
      paid_amount: '49.00',
      payment_resolution: 'NORMAL',
      payment_status: 'PAID',
      physical_qty: 7,
      processed_callbacks: 1,
      reservation_status: 'CONSUMED',
      success_attempts: 1,
    });
  } finally {
    await pool.end();
  }
}

async function submitMockProviderResult(
  paymentIntentId: string,
  intentNo: string,
  result: 'SUCCEEDED',
): Promise<{ providerEventId: string; providerIntentId: string }> {
  const { createClient } = apiRequire('redis');
  const { RedisMockPaymentProvider } = paymentRequire('@qingxu/payment');
  const { CallbackInboxRepository, createDatabaseRuntime } =
    databaseRequire('./dist/src/index.js');
  const redis = createClient({ url: required('REDIS_URL') });
  const database = createDatabaseRuntime({
    allowInsecureLocalhost: true,
    applicationName: 'qingxu-b10-vertical-provider-callback',
    connectionTimeoutMs: 5_000,
    databaseUrl: required('DATABASE_URL'),
    poolMax: 2,
  });
  try {
    await Promise.all([redis.connect(), database.connect()]);
    const provider = new RedisMockPaymentProvider({
      environment: 'test',
      signingKey: Buffer.from(required('PAYMENT_MOCK_SIGNING_KEY_BASE64'), 'base64'),
      timeoutMs: Number(required('PAYMENT_PROVIDER_TIMEOUT_MS')),
    }, redis);
    const storedIntent = await database.prisma.paymentIntent.findUnique({
      select: { intent_no: true, provider_intent_id: true, status: true },
      where: { id: paymentIntentId },
    });
    if (storedIntent?.intent_no !== intentNo || storedIntent.provider_intent_id === null ||
      !['OPEN', 'CANCELLED', 'CLOSED', 'EXPIRED'].includes(storedIntent.status)) {
      throw new Error('Stored payment intent is not ready for the Mock Provider result');
    }
    const submission = await provider.submitResult({
      intentNo,
      providerIntentId: storedIntent.provider_intent_id,
      result,
    });
    const callback = submission.callback;
    if (submission.submission !== 'ACCEPTED' || callback === null) {
      throw new Error('Mock Provider did not accept the B10 vertical result');
    }
    await database.withPrismaTransaction((transaction: DatabaseTransaction) =>
      new CallbackInboxRepository(database).receive(transaction, {
        eventType: callback.eventType,
        headers: callback.headers,
        payload: callback.payload,
        provider: 'MOCK',
        providerEventId: callback.providerEventId,
        rawBody: callback.rawBody,
        signatureValid: true,
      }));
    if (typeof callback.payload.provider_intent_id !== 'string') {
      throw new Error('Mock Provider callback is missing its intent reference');
    }
    return {
      providerEventId: callback.providerEventId,
      providerIntentId: callback.payload.provider_intent_id,
    };
  } finally {
    if (redis.isOpen) await redis.quit();
    await database.disconnect();
  }
}

async function awaitWorkerLateRefund(orderId: string, paymentIntentId: string): Promise<void> {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b10-vertical-late-refund',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    await expect.poll(async () => {
      const facts = await pool.query(
        `SELECT so.order_status::text, so.close_reason::text, so.payment_status::text,
                so.payment_resolution::text, so.refund_progress_status::text,
                so.refund_processing_status::text, so.paid_amount::text, so.refunded_amount::text,
                ir.status::text AS reservation_status, pi.status::text AS intent_status,
                r.status::text AS refund_status,
                (SELECT COUNT(*)::int FROM public.payment_attempt AS pa
                 WHERE pa.payment_intent_id = pi.id AND pa.status = 'SUCCEEDED_LATE') AS late_attempts,
                (SELECT COUNT(*)::int FROM public.refund_attempt AS ra
                 WHERE ra.refund_id = r.id AND ra.status = 'SUCCEEDED') AS refund_attempts,
                (SELECT COUNT(*)::int FROM public.callback_inbox AS ci
                 WHERE ci.provider = 'MOCK' AND ci.status = 'PROCESSED'
                   AND ci.payload->>'provider_intent_id' = pi.provider_intent_id) AS processed_callbacks
         FROM public.sales_order AS so
         JOIN public.inventory_reservation AS ir ON ir.order_id = so.id
         JOIN public.payment_intent AS pi ON pi.order_id = so.id
         JOIN public.refund AS r ON r.order_id = so.id AND r.origin_type = 'LATE_PAYMENT'
         WHERE so.id = $1 AND pi.id = $2`,
        [orderId, paymentIntentId],
      );
      return facts.rows[0] ?? null;
    }, { timeout: 30_000 }).toEqual({
      close_reason: 'PAYMENT_TIMEOUT',
      intent_status: 'SUCCEEDED',
      late_attempts: 1,
      order_status: 'CLOSED',
      paid_amount: '49.00',
      payment_resolution: 'LATE_SUCCESS_REFUNDED',
      payment_status: 'PAID',
      processed_callbacks: 1,
      refund_attempts: 1,
      refund_processing_status: 'IDLE',
      refund_progress_status: 'FULL',
      refund_status: 'SUCCEEDED',
      refunded_amount: '49.00',
      reservation_status: 'EXPIRED',
    });
  } finally {
    await pool.end();
  }
}

async function readProviderProtectedValues(orderIds: readonly string[]): Promise<string[]> {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b10-vertical-sensitive-scan',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  const values = new Set<string>();
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) values.add(value);
    else if (value !== null && value !== undefined) values.add(stableDiagnosticSerialization(value));
  };
  try {
    const intents = await pool.query(
      `SELECT pi.id::text, pi.intent_no, pi.provider_intent_id, pi.provider_state,
              pa.provider_transaction_id, pa.provider_payload
       FROM public.payment_intent AS pi
       LEFT JOIN public.payment_attempt AS pa ON pa.payment_intent_id = pi.id
       WHERE pi.order_id::text = ANY($1::text[])`,
      [orderIds],
    );
    const providerIntentIds: string[] = [];
    for (const row of intents.rows as Array<Record<string, unknown>>) {
      add(row.provider_intent_id);
      add(row.provider_transaction_id);
      add(row.provider_payload);
      if (typeof row.provider_intent_id === 'string') providerIntentIds.push(row.provider_intent_id);
    }
    const callbacks = await pool.query(
      `SELECT provider_event_id, raw_body, headers, payload
       FROM public.callback_inbox
       WHERE provider = 'MOCK' AND payload->>'provider_intent_id' = ANY($1::text[])`,
      [providerIntentIds],
    );
    for (const row of callbacks.rows as Array<Record<string, unknown>>) {
      add(row.provider_event_id);
      add(Buffer.isBuffer(row.raw_body) ? row.raw_body.toString('utf8') : row.raw_body);
      add(row.headers);
      add(row.payload);
    }
    const refunds = await pool.query(
      `SELECT r.refund_no, r.provider_refund_id,
              ra.provider_request_id, ra.provider_payload
       FROM public.refund AS r
       LEFT JOIN public.refund_attempt AS ra ON ra.refund_id = r.id
       WHERE r.order_id::text = ANY($1::text[])`,
      [orderIds],
    );
    for (const row of refunds.rows as Array<Record<string, unknown>>) {
      add(row.provider_refund_id);
      add(row.provider_request_id);
      add(row.provider_payload);
    }
    return [...values].filter((value) => value.length >= 8);
  } finally {
    await pool.end();
  }
}

async function readAuthSessionProtectedValues(accountId: string): Promise<string[]> {
  const { Pool } = databaseRequire('pg');
  const pool = new Pool({
    application_name: 'qingxu-b10-vertical-session-sensitive-scan',
    connectionString: required('DIRECT_URL'),
    connectionTimeoutMillis: 5_000,
    max: 1,
  });
  try {
    const sessions = await pool.query(
      `SELECT id::text, session_family::text
       FROM public.auth_session WHERE account_id = $1`,
      [accountId],
    );
    return sessions.rows.flatMap(({ id, session_family: sessionFamily }) => [id, sessionFamily]);
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

test('browser settles a Mock payment through real Nest, PostgreSQL, Redis, MinIO and Worker',
  async ({ page, request }) => {
    const apiOrigin = required('B10_VERTICAL_API_ORIGIN');
    const workerOrigin = required('B10_VERTICAL_WORKER_ORIGIN');
    const accountId = required('B10_VERTICAL_ACCOUNT_ID');
    const customerId = required('B10_VERTICAL_CUSTOMER_ID');
    const loginCode = required('B10_VERTICAL_LOGIN_CODE');
    const wechatOpenId = required('B10_VERTICAL_WECHAT_OPEN_ID');
    const expiredOrderId = required('B10_VERTICAL_EXPIRED_ORDER_ID');
    const expiredPaymentIntentId = required('B10_VERTICAL_EXPIRED_PAYMENT_INTENT_ID');
    const expiredPaymentIntentNo = required('B10_VERTICAL_EXPIRED_PAYMENT_INTENT_NO');
    const productId = required('B10_VERTICAL_PRODUCT_ID');
    const productName = required('B10_VERTICAL_PRODUCT_NAME');
    const skuId = required('B10_VERTICAL_SKU_ID');
    const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
    const phone = ['137', '0000', '0009'].join('');
    const addressDetail = '文一路 99 号 B10 纵向测试';
    const paymentSigningKey = required('PAYMENT_MOCK_SIGNING_KEY_BASE64');
    const diagnosticKey = Buffer.from(required('B10_VERTICAL_CAPABILITY_HMAC_KEY_BASE64'), 'base64');
    const storeRequests: StoreRequest[] = [];
    const storeResponses: StoreResponse[] = [];
    const storageResponses: Array<{ method: string; path: string; status: number }> = [];
    const checkoutCapabilities: string[] = [];
    const browserDiagnosticMessages: string[] = [];
    const browserDiagnosticReads: Array<Promise<void>> = [];
    let capabilityArtifactWriteFailed = false;
    let capabilityArtifactWrite: Promise<void> | undefined;

    await page.addInitScript(() => {
      const writes: Array<{ key: string; storage: string; value: string }> = [];
      Object.defineProperty(globalThis, '__b10StorageWrites', {
        configurable: false,
        enumerable: false,
        value: writes,
        writable: false,
      });
      const originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItem(key: string, value: string): void {
        const storage = this === globalThis.localStorage
          ? 'localStorage'
          : this === globalThis.sessionStorage ? 'sessionStorage' : 'unknown';
        writes.push({ key: String(key), storage, value: String(value) });
        originalSetItem.call(this, key, value);
      };
    });

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
      if (!url.pathname.startsWith('/api/v1/store/orders') &&
        !url.pathname.startsWith('/api/v1/store/mock-payments')) return;
      const rawBody = current.postData() === null ? null : current.postDataJSON() as Record<string, unknown>;
      const body = url.pathname === '/api/v1/store/orders' && current.method() === 'POST' && rawBody !== null
        ? {
            has_confirmation_hash: typeof rawBody.confirmation_hash === 'string',
            has_quote_token: typeof rawBody.quote_token === 'string',
            items: rawBody.items,
            source: rawBody.source,
          }
        : url.pathname.startsWith('/api/v1/store/mock-payments/') && rawBody !== null
          ? { result: rawBody.result }
          : null;
      if (url.pathname === '/api/v1/store/orders' && body !== null &&
        capabilityArtifactWrite === undefined) {
        const quoteToken = rawBody?.quote_token;
        const confirmationHash = rawBody?.confirmation_hash;
        if (typeof quoteToken === 'string' && typeof confirmationHash === 'string') {
          checkoutCapabilities.push(quoteToken, confirmationHash);
          const fingerprints = checkoutCapabilities.map((value) =>
            fingerprintCapability(value, diagnosticKey));
          capabilityArtifactWrite = writeFile(
            required('B10_VERTICAL_CAPABILITY_ARTIFACT_PATH'),
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
    await submitMockProviderResult(expiredPaymentIntentId, expiredPaymentIntentNo, 'SUCCEEDED');
    await awaitWorkerLateRefund(expiredOrderId, expiredPaymentIntentId);

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
    const paymentIntentPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/v1/store/orders/${first.orderId}/payment-intents` &&
        response.request().method() === 'POST';
    });
    await expect(uniButton(page, '支付订单')).toBeEnabled();
    await uniButton(page, '支付订单').click();
    const paymentIntentResponse = await paymentIntentPromise;
    expect(paymentIntentResponse.status()).toBe(200);
    const paymentIntentEnvelope = await paymentIntentResponse.json() as {
      data?: { intent_no?: unknown; payment_intent_id?: unknown };
    };
    const intentNo = paymentIntentEnvelope.data?.intent_no;
    const paymentIntentId = paymentIntentEnvelope.data?.payment_intent_id;
    expect({
      validIntentId: typeof paymentIntentId === 'string' && /^[0-9A-HJKMNP-TV-Z]{26}$/.test(paymentIntentId),
      validIntentNo: typeof intentNo === 'string' && /^PI[0-9A-HJKMNP-TV-Z]{26}$/.test(intentNo),
    }).toEqual({ validIntentId: true, validIntentNo: true });
    if (typeof intentNo !== 'string' || typeof paymentIntentId !== 'string') {
      throw new TypeError('Payment intent response is invalid');
    }
    await expect(page).toHaveURL(new RegExp(`/pages/payment/result\\?order_id=${first.orderId}$`));
    await expect(page.getByText('正在确认支付结果', { exact: true })).toBeVisible();
    await expect(uniButton(page, '成功')).toBeVisible();
    const mockResultPromise = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === `/api/v1/store/mock-payments/${paymentIntentId}/result` &&
        response.request().method() === 'POST';
    });
    await uniButton(page, '成功').click();
    expect((await mockResultPromise).status()).toBe(202);
    await awaitWorkerSettlement(first.orderId, paymentIntentId);
    await expect(page.getByText('支付成功', { exact: true })).toBeVisible();
    await expect(page.getByText('订单已进入待发货阶段。', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await navigate(page, `/pages/orders/detail?order_id=${expiredOrderId}`, 'reLaunch');
    await expect(page.getByText('付款超时关闭', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('退款完成', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('迟到支付已全额退款', { exact: true })).toBeVisible();

    await navigate(page, '/pages/orders/index');
    await expect(page.getByText(productName, { exact: true })).toHaveCount(2);
    await expect(page.getByText('待发货', { exact: true })).toBeVisible();
    await expect(page.getByText('付款超时关闭', { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const providerProtectedValues = await readProviderProtectedValues([first.orderId, expiredOrderId]);
    const authSessionProtectedValues = await readAuthSessionProtectedValues(accountId);

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
    const paymentIntentRequest = storeRequests.find(({ method, path }) =>
      method === 'POST' && path === `/api/v1/store/orders/${first.orderId}/payment-intents`);
    expect(paymentIntentRequest?.body).toBeNull();
    expect(paymentIntentRequest?.headers['if-match']).toBe('"1"');
    expect(paymentIntentRequest?.headers['idempotency-key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const mockResultRequest = storeRequests.find(({ method, path }) =>
      method === 'POST' && path === `/api/v1/store/mock-payments/${paymentIntentId}/result`);
    expect(mockResultRequest?.body).toEqual({ result: 'SUCCEEDED' });
    expect(mockResultRequest?.headers['idempotency-key']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    const orderResponses = storeResponses.filter(({ path }) =>
      path === '/api/v1/store/checkout/quotes' || path.startsWith('/api/v1/store/orders'));
    expect(orderResponses.some(({ method, path, status }) =>
      method === 'POST' && path === '/api/v1/store/orders' && status === 201)).toBe(true);
    expect(orderResponses.some(({ method, path, status }) =>
      method === 'POST' && path.endsWith('/payment-intents') && status === 200)).toBe(true);
    expect(storeResponses.some(({ method, path, status }) =>
      method === 'POST' && path === `/api/v1/store/mock-payments/${paymentIntentId}/result` &&
      status === 202)).toBe(true);
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

    const storageSafety = await page.evaluate(({
      capabilities,
      detail,
      paymentIntentId: currentPaymentIntentId,
      paymentIntentNo,
      providerReferences,
      syntheticPhone,
    }) => {
      const serialized = `${JSON.stringify(localStorage)}${JSON.stringify(sessionStorage)}`;
      const writes = (globalThis as unknown as {
        __b10StorageWrites?: Array<{ key: string; storage: string; value: string }>;
      }).__b10StorageWrites ?? [];
      const paymentJournalWrites = writes.filter(({ key }) => key === 'qingxu:payment-submit:v1');
      const paymentJournalPolluted = paymentJournalWrites.some(({ storage, value }) => {
        if (storage !== 'sessionStorage') return true;
        try {
          const parsed = JSON.parse(value) as Record<string, unknown>;
          return Object.keys(parsed).sort().join(',') !== 'idempotency_key,order_id,order_version' ||
            capabilities.some((capability) => value.includes(capability)) ||
            providerReferences.some((reference) => value.includes(reference)) ||
            value.includes(currentPaymentIntentId) || value.includes(paymentIntentNo);
        } catch {
          return true;
        }
      });
      const historicalStorage = writes.map(({ value }) => value).join('\n');
      return {
        containsAddress: serialized.includes(detail),
        containsCheckoutCapability: capabilities.some((capability) => serialized.includes(capability)),
        containsPaymentReference: providerReferences.some((reference) => serialized.includes(reference)),
        containsPhone: serialized.includes(syntheticPhone),
        historicalPaymentJournalPolluted: paymentJournalPolluted,
        historicalPaymentReference: providerReferences.some((reference) =>
          historicalStorage.includes(reference)) || historicalStorage.includes(currentPaymentIntentId) ||
          historicalStorage.includes(paymentIntentNo),
        hasPaymentJournal: sessionStorage.getItem('qingxu:payment-submit:v1') !== null,
        hasSubmitJournal: sessionStorage.getItem('qingxu:order-submit:v1') !== null,
      };
    }, {
      capabilities: checkoutCapabilities,
      detail: addressDetail,
      paymentIntentId,
      paymentIntentNo: intentNo,
      providerReferences: providerProtectedValues,
      syntheticPhone: phone,
    });
    expect(storageSafety).toEqual({
      containsAddress: false,
      containsCheckoutCapability: false,
      containsPaymentReference: false,
      containsPhone: false,
      historicalPaymentJournalPolluted: false,
      historicalPaymentReference: false,
      hasPaymentJournal: false,
      hasSubmitJournal: false,
    });
    const diagnosticProtectedValues = [
      ...checkoutCapabilities,
      ...providerProtectedValues,
      ...authSessionProtectedValues,
      accountId,
      addressDetail,
      customerId,
      loginCode,
      ...secretRepresentations(paymentSigningKey),
      phone,
      wechatOpenId,
      '纵向用户',
    ];
    expect({
      browserDiagnosticsContainProtectedOriginalOrFingerprint:
        diagnosticsContainProtectedValue(browserDiagnosticMessages, diagnosticProtectedValues, diagnosticKey),
    }).toEqual({ browserDiagnosticsContainProtectedOriginalOrFingerprint: false });
  });
