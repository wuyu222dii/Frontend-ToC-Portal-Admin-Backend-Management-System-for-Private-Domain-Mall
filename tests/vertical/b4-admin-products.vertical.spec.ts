import { createHmac } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B4 vertical test`);
  return value;
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
  const binary = digest.readUInt32BE(offset) & 0x7fff_ffff;
  return String(binary % 1_000_000).padStart(6, '0');
}

async function stableTotp(page: Page, secret: string): Promise<string> {
  const secondsIntoWindow = Math.floor(Date.now() / 1_000) % 30;
  if (secondsIntoWindow >= 26) await page.waitForTimeout((31 - secondsIntoWindow) * 1_000);
  return currentTotp(secret);
}

async function selectElementPlusOption(page: Page, label: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: label, exact: true }).click({ force: true });
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('browser reaches real Nest, PostgreSQL, Redis and MinIO for Product and SKU creation', async ({ page, request }) => {
  const loginName = required('B4_VERTICAL_LOGIN_NAME');
  const password = required('B4_VERTICAL_PASSWORD');
  const brandName = required('B4_VERTICAL_BRAND_NAME');
  const categoryName = required('B4_VERTICAL_CATEGORY_NAME');
  const productName = required('B4_VERTICAL_PRODUCT_NAME');
  const spuCode = required('B4_VERTICAL_SPU_CODE');
  const skuName = required('B4_VERTICAL_SKU_NAME');
  const skuCode = required('B4_VERTICAL_SKU_CODE');
  const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
  const apiResponses: Array<{ path: string; status: number }> = [];
  let minioPutSeen = false;
  let publicImageGetSeen = false;

  page.on('request', (outgoing) => {
    const url = new URL(outgoing.url());
    if (url.origin !== storageOrigin) return;
    if (outgoing.method() === 'PUT') minioPutSeen = true;
    if (outgoing.method() === 'GET' && url.pathname.includes('/public/')) publicImageGetSeen = true;
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/v1/')) {
      apiResponses.push({ path: url.pathname, status: response.status() });
    }
  });

  const health = await request.get('http://127.0.0.1:3000/internal/health');
  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ service: 'api', status: 'ok' });

  await page.goto('/login');
  await page.getByLabel('超级管理员账号').fill(loginName);
  await page.getByLabel('登录密码').fill(password);
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await expect(page).toHaveURL(/\/settings\/account\/security\/enroll$/);

  const otpAuthUri = await page.getByTestId('one-time-otpauth-uri').textContent();
  expect(otpAuthUri).toBeTruthy();
  const secret = new URL(otpAuthUri ?? '').searchParams.get('secret');
  expect(secret).toBeTruthy();
  await page.locator('input[name="totp-enroll-code"]').fill(await stableTotp(page, secret ?? ''));
  await page.getByRole('button', { name: '验证并完成绑定' }).click();
  await expect(page.getByTestId('one-time-recovery-codes')).toBeVisible();
  await page.getByRole('button', { name: '我已安全保存' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);

  await page.getByRole('link', { name: '商品管理' }).click();
  await expect(page.getByTestId('product-list-page')).toBeVisible();
  await page.getByRole('button', { name: '新增商品' }).click();
  const editor = page.getByTestId('product-editor-page');
  await expect(editor).toBeVisible();
  await editor.getByLabel('SPU 编码').fill(spuCode);
  await editor.getByLabel('商品名称').fill(productName);
  await selectElementPlusOption(page, '品牌', brandName);
  await selectElementPlusOption(page, '一级分类', categoryName);

  const images = editor.getByTestId('product-images-editor');
  await images.locator('input[type="file"]').setInputFiles({
    buffer: pngBytes,
    mimeType: 'image/png',
    name: 'b4-vertical-product.png',
  });
  await expect(images).toContainText('1 / 8');
  const uploadedImage = images.getByRole('img', { name: '商品图片 1' });
  await expect(uploadedImage).toBeVisible();
  await expect.poll(() => uploadedImage.evaluate((node: HTMLImageElement) =>
    node.complete && node.naturalWidth > 0)).toBe(true);
  await editor.getByRole('button', { name: '保存商品资料' }).click();
  await expect(page).toHaveURL(/\/catalog\/products$/);

  const productRow = page.locator('.product-row').filter({ hasText: productName });
  await expect(productRow).toContainText(spuCode);
  await expect(productRow).toContainText('草稿');
  await productRow.getByRole('button', { name: '编辑商品' }).click();
  await expect(editor.getByLabel('SPU 编码')).toHaveValue(spuCode);
  await editor.getByRole('tab', { name: /SKU 与价格/ }).click();
  await editor.getByRole('button', { name: '新增 SKU' }).click();

  const skuDialog = page.getByTestId('sku-editor-dialog');
  await expect(skuDialog).toBeVisible();
  await skuDialog.getByLabel('SKU 编码').fill(skuCode);
  await skuDialog.getByLabel('SKU 名称').fill(skuName);
  await skuDialog.getByLabel('零售价').fill('39.00');
  await skuDialog.getByLabel('推荐 SKU').check();
  await skuDialog.getByRole('button', { name: '保存 SKU' }).click();
  await expect(skuDialog).toBeHidden();
  await expect(editor.locator('.sku-row').filter({ hasText: skuName })).toContainText('已停用');
  await expect(editor.locator('.sku-row').filter({ hasText: skuName })).toContainText('可售 0');

  expect(minioPutSeen).toBe(true);
  expect(publicImageGetSeen).toBe(true);
  expect(apiResponses.some(({ path }) => path === '/api/v1/admin/auth/login')).toBe(true);
  expect(apiResponses.some(({ path }) => path === '/api/v1/files/upload-intents')).toBe(true);
  expect(apiResponses.some(({ path }) => /^\/api\/v1\/files\/[^/]+\/complete$/.test(path))).toBe(true);
  expect(apiResponses.some(({ path }) => path === '/api/v1/admin/products')).toBe(true);
  expect(apiResponses.some(({ path }) => /^\/api\/v1\/admin\/products\/[^/]+\/skus$/.test(path))).toBe(true);
  expect(apiResponses.filter(({ status }) => status >= 400)).toEqual([]);
});
