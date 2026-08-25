import { expect, test, type Page, type Route } from '@playwright/test';

const PRODUCT_ID = '01J00000000000000000000000';
const CATEGORY_ID = '01J10000000000000000000000';
const BRAND_ID = '01J20000000000000000000000';
const SKU_READY_ID = '01J30000000000000000000000';
const SKU_SOLD_ID = '01J40000000000000000000000';
const IMAGE_URL = 'https://assets.example.test/product.png';

const category = {
  category_id: CATEGORY_ID,
  name: '清洁护理',
  icon_url: IMAGE_URL,
  sort_order: 0,
};
const brand = {
  brand_id: BRAND_ID,
  name: '青序',
  description: '日常洗护品牌',
  logo_url: IMAGE_URL,
  sort_order: 0,
};
const product = {
  product_id: PRODUCT_ID,
  spu_code: 'SPU-001',
  name: '温和净澈洗发露',
  subtitle: '清爽洁净，不添加虚构功效',
  brand,
  category,
  primary_image: { url: IMAGE_URL, sort_order: 0, is_primary: true },
  minimum_active_price: '49.90',
  net_sales_count: 128,
  is_hot: true,
  is_new: true,
  is_salable: true,
};

const homeData = {
  banners: [{
    banner_id: '01J50000000000000000000000',
    title: '今日洗护精选',
    image_url: IMAGE_URL,
    sort_order: 0,
    target_type: 'PRODUCT',
    target_id: PRODUCT_ID,
    target_url: null,
  }],
  categories: [category],
  hot_products: [product],
  new_products: [product],
  section_status: {
    banners: 'READY',
    categories: 'READY',
    hot_products: 'READY',
    new_products: 'READY',
  },
};

const detailData = {
  product_id: PRODUCT_ID,
  spu_code: 'SPU-001',
  name: product.name,
  subtitle: product.subtitle,
  introduction: '适合日常清洁使用。',
  ingredients: '配方信息以商品包装标示为准。',
  usage_method: '取适量清洁后冲洗。',
  brand,
  category,
  images: [{ url: IMAGE_URL, sort_order: 0, is_primary: true }],
  skus: [
    {
      sku_id: SKU_READY_ID,
      code: 'SKU-READY',
      name: '标准装',
      spec_json: { attributes: [{ name: '容量', value: '500ml' }] },
      retail_price: '49.90',
      is_recommended: true,
      available_stock: 3,
      is_salable: true,
    },
    {
      sku_id: SKU_SOLD_ID,
      code: 'SKU-SOLD',
      name: '旅行装',
      spec_json: { attributes: [{ name: '容量', value: '100ml' }] },
      retail_price: '19.90',
      is_recommended: false,
      available_stock: 0,
      is_salable: false,
    },
  ],
  net_sales_count: 128,
  is_hot: true,
  is_new: true,
};

function ok(data: unknown) {
  return {
    code: 'OK',
    message: 'success',
    data,
    request_id: 'req_b6_ui',
  };
}

async function fulfillJson(route: Route, data: unknown, status = 200, headers = {}) {
  await route.fulfill({
    body: JSON.stringify(data),
    contentType: 'application/json',
    headers,
    status,
  });
}

async function mockImage(page: Page, fail = false) {
  await page.route('https://assets.example.test/**', async (route) => {
    if (fail) {
      await route.abort('failed');
      return;
    }
    await route.fulfill({
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
      contentType: 'image/png',
      status: 200,
    });
  });
}

async function mockCommonCatalog(page: Page) {
  await mockImage(page);
  await page.route('**/api/v1/store/categories', (route) => fulfillJson(route, ok({ items: [category] })));
  await page.route('**/api/v1/store/brands', (route) => fulfillJson(route, ok({ items: [brand] })));
  await page.route(/\/api\/v1\/store\/products(?:\?.*)?$/, (route) => fulfillJson(route, ok({
    items: [product],
    pagination: { page: 1, page_size: 20, total: 1 },
  })));
  await page.route(`**/api/v1/store/products/${PRODUCT_ID}`, (route) => fulfillJson(route, ok(detailData)));
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('MP-01 renders the public home safely at every acceptance viewport', async ({ page }, testInfo) => {
  await mockImage(page);
  await page.route('**/api/v1/store/home', (route) => fulfillJson(route, ok(homeData)));

  await page.goto('/');
  await expect(page.getByText('青序生活', { exact: true })).toBeVisible();
  await expect(page.getByText('今日洗护精选')).toBeVisible();
  await expect(page.getByText('温和净澈洗发露').first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: '商城主导航' })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('home.png') });
});

test('MP-02 to MP-05 remain usable at every acceptance viewport', async ({ page }) => {
  await mockCommonCatalog(page);

  await page.goto('/#/pages/category/index');
  await expect(page.getByText('商品分类')).toBeVisible();
  await expect(page.locator('.category-rail')).toBeVisible();
  await expect(page.getByText(product.name)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto('/#/pages/search/index?keyword=洗发露');
  await expect(page.locator('.search-field__input input')).toBeVisible();
  await expect(page.locator('.search-header__submit')).toBeVisible();
  await expect(page.getByText(product.name)).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText(product.name)).toBeVisible();
  await expect(page.locator('.detail-actions__secondary')).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.locator('.detail-actions__secondary').click();
  await expect(page.locator('.sku-sheet')).toBeVisible();
  await expect(page.locator('.sku-sheet__confirm')).toBeVisible();
  await expect(page.locator('.sku-sheet__confirm')).toBeInViewport();
  await expectNoHorizontalOverflow(page);
});

test('MP-01 keeps ready sections usable during a partial home failure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'State matrix runs once; viewport matrix is above.');
  await mockImage(page, true);
  await page.route('**/api/v1/store/home', (route) => fulfillJson(route, ok({
    ...homeData,
    banners: [],
    section_status: { ...homeData.section_status, banners: 'UNAVAILABLE' },
  })));

  await page.goto('/');
  await expect(page.getByText('推荐活动暂不可用')).toBeVisible();
  await expect(page.getByText('按分类选购')).toBeVisible();
  await expect(page.getByText('温和净澈洗发露').first()).toBeVisible();
});

test('MP-01 renders a retryable full-page 500 state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'State matrix runs once; viewport matrix is above.');
  await page.route('**/api/v1/store/home', (route) => fulfillJson(route, {
    code: 'INTERNAL_ERROR',
    message: '服务暂不可用',
    request_id: 'req_internal',
  }, 500));

  await page.goto('/');
  await expect(page.getByText('商城首页加载失败')).toBeVisible();
  await expect(page.locator('.qx-catalog-state__action')).toHaveText('重新加载');
});

test('MP-01 exposes slow and rate-limited states without inventing success', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'State matrix runs once; viewport matrix is above.');
  let attempt = 0;
  await page.route('**/api/v1/store/home', async (route) => {
    attempt += 1;
    if (attempt === 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_600));
      await fulfillJson(route, ok(homeData));
      return;
    }
    await fulfillJson(route, {
      code: 'RATE_LIMITED',
      message: '请稍后重试',
      request_id: 'req_limited',
    }, 429, { 'Retry-After': '2' });
  });

  await page.goto('/');
  await expect(page.getByText('网络响应较慢，正在继续加载。')).toBeVisible();
  await expect(page.getByText('今日洗护精选')).toBeVisible();
  await page.reload();
  await expect(page.getByText('浏览得有些快')).toBeVisible();
  await expect(page.locator('.qx-catalog-state__action')).toHaveAttribute('disabled', 'true');
});

test('MP-02 uses complete filters and the five server sort values', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Interaction matrix runs once.');
  const productRequests: string[] = [];
  await mockCommonCatalog(page);
  await page.route(/\/api\/v1\/store\/products(?:\?.*)?$/, async (route) => {
    productRequests.push(route.request().url());
    await fulfillJson(route, ok({
      items: [product],
      pagination: { page: 1, page_size: 20, total: 1 },
    }));
  });

  await page.goto('/#/pages/category/index');
  await expect(page.getByText('商品分类')).toBeVisible();
  await expect(page.locator('.filter-chip').filter({ hasText: /^青序$/ })).toBeVisible();
  await page.locator('.filter-chip').filter({ hasText: /^价格高到低$/ }).click();
  await expect.poll(() => productRequests.some((url) => url.includes('sort=PRICE_DESC'))).toBe(true);
  await page.locator('.category-rail__item').filter({ hasText: /^清洁护理$/ }).click();
  await expect.poll(() => productRequests.some((url) => url.includes(`category_id=${CATEGORY_ID}`))).toBe(true);
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('category.png') });
});

test('MP-02 keeps loaded products when the next page is rate-limited', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'State matrix runs once.');
  await mockImage(page);
  await page.route('**/api/v1/store/categories', (route) => fulfillJson(route, ok({ items: [category] })));
  await page.route('**/api/v1/store/brands', (route) => fulfillJson(route, ok({ items: [brand] })));
  await page.route(/\/api\/v1\/store\/products(?:\?.*)?$/, async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.searchParams.get('page') === '2') {
      await fulfillJson(route, {
        code: 'RATE_LIMITED',
        message: '请稍后重试',
        request_id: 'req_page_limited',
      }, 429, { 'Retry-After': '3' });
      return;
    }
    await fulfillJson(route, ok({
      items: [product],
      pagination: { page: 1, page_size: 20, total: 2 },
    }));
  });

  await page.goto('/#/pages/category/index');
  await expect(page.getByText(product.name)).toBeVisible();
  await page.locator('.load-more').click();
  await expect(page.getByText('下一页加载失败')).toBeVisible();
  await expect(page.getByText(product.name)).toBeVisible();
  await expect(page.locator('.qx-catalog-state__action')).toHaveAttribute('disabled', 'true');
});

test('MP-03 keeps an empty input on history and searches product names', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Interaction matrix runs once.');
  const productRequests: string[] = [];
  await mockCommonCatalog(page);
  await page.route(/\/api\/v1\/store\/products(?:\?.*)?$/, async (route) => {
    productRequests.push(route.request().url());
    await fulfillJson(route, ok({
      items: [product],
      pagination: { page: 1, page_size: 20, total: 1 },
    }));
  });

  await page.goto('/#/pages/search/index');
  await expect(page.getByText('最近搜索')).toBeVisible();
  await page.locator('.search-field__input input').fill('  洗发露  ');
  await page.locator('.search-header__submit').click();
  await expect(page.getByText('温和净澈洗发露')).toBeVisible();
  await expect.poll(() => productRequests.some((url) => url.includes('keyword=%E6%B4%97%E5%8F%91%E9%9C%B2')))
    .toBe(true);
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('search.png') });
  await page.reload();
  await expect(page.locator('.history-chip').filter({ hasText: /^洗发露$/ })).toBeVisible();
});

test('MP-03 shows a real empty result without changing the query', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'State matrix runs once.');
  await mockImage(page);
  await page.route('**/api/v1/store/categories', (route) => fulfillJson(route, ok({ items: [category] })));
  await page.route('**/api/v1/store/brands', (route) => fulfillJson(route, ok({ items: [brand] })));
  await page.route(/\/api\/v1\/store\/products(?:\?.*)?$/, (route) => fulfillJson(route, ok({
    items: [],
    pagination: { page: 1, page_size: 20, total: 0 },
  })));

  await page.goto('/#/pages/search/index?keyword=不存在的商品');
  await expect(page.getByText('没有找到相关商品')).toBeVisible();
  await expect(page.getByText('“不存在的商品”')).toBeVisible();
});

test('MP-04 and MP-05 keep sold-out SKUs visible and gate authenticated actions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'Interaction matrix runs once.');
  await mockCommonCatalog(page);

  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText(product.name)).toBeVisible();
  await page.locator('.detail-actions__secondary').click();
  await expect(page.locator('.sku-sheet')).toBeVisible();
  await page.locator('.sku-option').filter({ hasText: '容量：100ml' }).click();
  await expect(page.locator('.sku-sheet__confirm')).toHaveAttribute('disabled', 'true');
  await page.locator('.sku-option').filter({ hasText: '容量：500ml' }).click();
  await page.locator('[aria-label="增加数量"]').click();
  await expect(page.locator('.sku-stepper').getByText('2', { exact: true })).toBeVisible();
  await page.screenshot({ fullPage: true, path: testInfo.outputPath('sku-sheet.png') });
  await page.locator('.sku-sheet__confirm').click();
  await expect(page.locator('.sku-sheet')).toBeHidden();
  await page.locator('.detail-actions__primary').click();
  await expect(page.getByText('请先登录')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('MP-04 distinguishes a missing product and survives image decode failure', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-390', 'State matrix runs once.');
  await mockImage(page, true);
  await page.route(`**/api/v1/store/products/${PRODUCT_ID}`, (route) => fulfillJson(route, ok(detailData)));
  await page.goto(`/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  await expect(page.getByText(product.name)).toBeVisible();
  await expect(page.locator('.qx-product-image__pack').first()).toBeVisible();

  await page.route('**/api/v1/store/products/01J99999999999999999999999', (route) => fulfillJson(route, {
    code: 'NOT_FOUND',
    message: '商品不存在',
    request_id: 'req_missing',
  }, 404));
  await page.goto('/#/pages/product/detail?product_id=01J99999999999999999999999');
  await page.reload();
  await expect(page.getByText('商品不存在')).toBeVisible();
});
