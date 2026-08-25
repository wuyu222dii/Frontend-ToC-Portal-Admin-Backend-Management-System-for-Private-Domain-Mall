import { createHmac } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';

const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new TypeError(`${name} is required for the B5 vertical test`);
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

async function expectDecodedImage(image: Locator): Promise<void> {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => ({
    complete: element.complete,
    naturalHeight: element.naturalHeight,
    naturalWidth: element.naturalWidth,
  }))).toMatchObject({ complete: true, naturalHeight: 1, naturalWidth: 1 });
}

test('browser reaches real Nest, PostgreSQL, Redis and MinIO for B5 Banner and Inventory', async ({ page, request }) => {
  const loginName = required('B5_VERTICAL_LOGIN_NAME');
  const password = required('B5_VERTICAL_PASSWORD');
  const brandName = required('B5_VERTICAL_BRAND_NAME');
  const categoryName = required('B5_VERTICAL_CATEGORY_NAME');
  const productName = required('B5_VERTICAL_PRODUCT_NAME');
  const spuCode = required('B5_VERTICAL_SPU_CODE');
  const skuName = required('B5_VERTICAL_SKU_NAME');
  const skuCode = required('B5_VERTICAL_SKU_CODE');
  const bannerTitle = required('B5_VERTICAL_BANNER_TITLE');
  const storageOrigin = new URL(required('S3_ENDPOINT')).origin;
  const apiResponses: Array<{ path: string; status: number }> = [];
  const storageResponses: Array<{ method: string; path: string; status: number }> = [];

  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === storageOrigin) {
      storageResponses.push({
        method: response.request().method(),
        path: url.pathname,
        status: response.status(),
      });
    }
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
  await page.getByRole('button', { name: '新增商品' }).click();
  const productEditor = page.getByTestId('product-editor-page');
  await productEditor.getByLabel('SPU 编码').fill(spuCode);
  await productEditor.getByLabel('商品名称').fill(productName);
  await selectElementPlusOption(page, '品牌', brandName);
  await selectElementPlusOption(page, '一级分类', categoryName);
  const productImages = productEditor.getByTestId('product-images-editor');
  await productImages.locator('input[type="file"]').setInputFiles({
    buffer: pngBytes,
    mimeType: 'image/png',
    name: 'b5-vertical-product.png',
  });
  await expect(productImages).toContainText('1 / 8');
  await productEditor.getByRole('button', { name: '保存商品资料' }).click();
  await expect(page).toHaveURL(/\/catalog\/products$/);

  const productRow = page.locator('.product-row').filter({ hasText: productName });
  await expectDecodedImage(productRow.getByRole('img', { name: `${productName}主图` }));
  await productRow.getByRole('button', { name: '编辑商品' }).click();
  await productEditor.getByRole('tab', { name: /SKU 与价格/ }).click();
  await productEditor.getByRole('button', { name: '新增 SKU' }).click();
  const skuDialog = page.getByTestId('sku-editor-dialog');
  await skuDialog.getByLabel('SKU 编码').fill(skuCode);
  await skuDialog.getByLabel('SKU 名称').fill(skuName);
  await skuDialog.getByLabel('零售价').fill('39.00');
  await skuDialog.getByLabel('推荐 SKU').check();
  await skuDialog.getByRole('button', { name: '保存 SKU' }).click();
  await expect(skuDialog).toBeHidden();

  await page.locator('a[href="/content/banners"]').click();
  await expect(page.getByTestId('banner-list-page')).toBeVisible();
  await page.getByRole('button', { name: '新建 Banner' }).click();
  const bannerEditor = page.getByTestId('banner-editor-dialog');
  await bannerEditor.getByLabel('Banner 标题').fill(bannerTitle);
  await bannerEditor.getByLabel('Banner 展示顺序').fill('5');
  await bannerEditor.getByLabel('选择 Banner 图片').setInputFiles({
    buffer: pngBytes,
    mimeType: 'image/png',
    name: 'b5-vertical-banner.png',
  });
  await expect(bannerEditor.getByRole('img', { name: 'Banner 图片预览' })).toBeVisible();
  await bannerEditor.getByTestId('banner-editor-submit').click();
  await expect(bannerEditor).toBeHidden();

  const bannerCard = page.locator('.banner-card').filter({ hasText: bannerTitle });
  await expect(bannerCard).toContainText('草稿');
  await expectDecodedImage(bannerCard.getByRole('img', { name: `${bannerTitle} Banner 图片` }));
  await bannerCard.getByRole('button', { name: '启用' }).click();
  const bannerCommand = page.getByTestId('banner-command-dialog');
  await bannerCommand.getByTestId('banner-command-submit').click();
  await expect(bannerCommand).toBeHidden();
  await expect(bannerCard).toContainText('已启用');

  await page.locator('a[href="/catalog/inventory"]').click();
  await expect(page.getByTestId('inventory-page')).toBeVisible();
  await page.getByLabel('库存关键词').fill(skuCode);
  await page.getByTestId('inventory-apply-filters').click();
  const inventoryRow = page.locator('.inventory-row').filter({ hasText: skuCode });
  await expect(inventoryRow).toContainText(skuName);
  await expect(inventoryRow).toContainText('已停用');
  await expect(inventoryRow).toContainText('0 - 0');
  await inventoryRow.getByRole('button', { name: '调整', exact: true }).click();
  const inventoryDialog = page.getByTestId('inventory-adjustment-dialog');
  await inventoryDialog.getByLabel('实物库存变化量').fill('7');
  await inventoryDialog.getByLabel('调整原因').fill('B5 vertical inventory verification');
  await inventoryDialog.getByTestId('inventory-preview-button').click();
  await expect(inventoryDialog.getByTestId('inventory-adjustment-preview')).toContainText('0 → 7');
  await inventoryDialog.getByTestId('inventory-confirm-button').click();
  await expect(inventoryDialog).toBeHidden();
  await expect(inventoryRow).toContainText('v2');
  await inventoryRow.getByRole('button', { name: '查看流水' }).click();
  const ledgerDialog = page.getByTestId('inventory-ledger-dialog');
  await expect(ledgerDialog).toContainText('人工增加');
  await expect(ledgerDialog).toContainText('B5 vertical inventory verification');
  await expect(ledgerDialog).toContainText('0 → 7');

  const successfulPutPaths = new Set(storageResponses
    .filter(({ method, status }) => method === 'PUT' && status >= 200 && status < 300)
    .map(({ path }) => path));
  const successfulPublicGetPaths = new Set(storageResponses
    .filter(({ method, path, status }) => method === 'GET' && path.includes('/public/') &&
      status >= 200 && status < 300)
    .map(({ path }) => path));
  expect(successfulPutPaths.size).toBeGreaterThanOrEqual(2);
  expect(successfulPublicGetPaths.size).toBeGreaterThanOrEqual(2);
  expect(apiResponses.some(({ path }) => path === '/api/v1/admin/auth/login')).toBe(true);
  expect(apiResponses.filter(({ path }) => path === '/api/v1/files/upload-intents')).toHaveLength(2);
  expect(apiResponses.filter(({ path }) => /^\/api\/v1\/files\/[^/]+\/complete$/.test(path))).toHaveLength(2);
  expect(apiResponses.some(({ path }) => path === '/api/v1/admin/banners')).toBe(true);
  expect(apiResponses.some(({ path }) => /\/api\/v1\/admin\/inventory\/[^/]+\/adjustment-preview$/.test(path)))
    .toBe(true);
  expect(apiResponses.some(({ path }) => /\/api\/v1\/admin\/inventory\/[^/]+\/adjustments$/.test(path)))
    .toBe(true);
  expect(apiResponses.some(({ path }) => /\/api\/v1\/admin\/inventory\/[^/]+\/ledger$/.test(path))).toBe(true);
  expect(apiResponses.filter(({ status }) => status >= 400)).toEqual([]);
});
