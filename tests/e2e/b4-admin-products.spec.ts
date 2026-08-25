import { createHash } from 'node:crypto';

import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

const adminBaseUrl = 'http://127.0.0.1:5175';
const accessToken = ['access', 'products', 'runtime'].join('-');
const refreshToken = ['refresh', 'products', 'runtime'].join('-');
const rotatedAccessToken = ['access', 'products', 'rotated'].join('-');
const rotatedRefreshToken = ['refresh', 'products', 'rotated'].join('-');
const preauthToken = ['preauth', 'products', 'runtime'].join('-');
const requestId = 'req_0123456789abcdef0123456789abcdef';
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);

type ProductStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type SkuStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type LifecycleAction = 'ACTIVATE' | 'DEACTIVATE' | 'SOFT_DELETE';
type TargetType = 'product' | 'sku';

interface Brand {
  brand_id: string;
  description: string | null;
  logo_file_id: string | null;
  logo_url: string | null;
  name: string;
  sort_order: number;
  status: ProductStatus;
  version: number;
}

interface Category {
  category_id: string;
  icon_file_id: string | null;
  icon_url: string | null;
  name: string;
  sort_order: number;
  status: ProductStatus;
  version: number;
}

interface ProductImage {
  file_id: string;
  url: string;
  sort_order: number;
  is_primary: boolean;
}

interface Sku {
  sku_id: string;
  code: string;
  name: string;
  spec_json: { attributes: Array<{ name: string; value: string }> } | null;
  retail_price: string;
  is_recommended: boolean;
  status: SkuStatus;
  available_stock: number;
  version: number;
}

interface ProductDetail {
  product_id: string;
  spu_code: string;
  name: string;
  subtitle: string | null;
  introduction: string | null;
  ingredients: string | null;
  usage_method: string | null;
  brand: Brand;
  category: Category;
  images: ProductImage[];
  skus: Sku[];
  net_sales_count: number;
  is_hot: boolean;
  is_new: boolean;
  status: ProductStatus;
  version: number;
}

interface InventorySnapshot {
  physical_stock: number;
  locked_stock: number;
  available_stock: number;
}

interface ProductRecord {
  detail: ProductDetail;
  inventory: Record<string, InventorySnapshot>;
}

interface RecordedRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  method: string;
  path: string;
}

interface ListFailure {
  code?: string;
  message?: string;
  status: number;
}

interface ConfirmFailure extends ListFailure {
  warning: string;
}

interface IssuedPreview {
  action: LifecycleAction;
  confirmationHash: string;
  id: string;
  reason: string;
  resourceEtag: string;
  token: string;
  type: TargetType;
}

interface MockBackendOptions {
  listDelayMs?: number;
  records?: ProductRecord[];
}

const activeBrand: Brand = {
  brand_id: 'brand-active',
  description: '公开品牌',
  logo_file_id: null,
  logo_url: null,
  name: '青柠净护',
  sort_order: 1,
  status: 'ACTIVE',
  version: 2,
};

const activeCategory: Category = {
  category_id: 'category-active',
  icon_file_id: null,
  icon_url: null,
  name: '衣物清洁',
  sort_order: 1,
  status: 'ACTIVE',
  version: 3,
};

function image(index = 1): ProductImage {
  return {
    file_id: `existing-product-file-${index}`,
    is_primary: index === 1,
    sort_order: index - 1,
    url: `https://assets.example.test/existing-product-file-${index}.png`,
  };
}

function sku(overrides: Partial<Sku> = {}): Sku {
  return {
    available_stock: 14,
    code: 'QX-CLEAN-001',
    is_recommended: true,
    name: '标准装',
    retail_price: '59.00',
    sku_id: 'sku-active',
    spec_json: { attributes: [{ name: '规格', value: '500ml' }] },
    status: 'ACTIVE',
    version: 1,
    ...overrides,
  };
}

function product(overrides: Partial<ProductDetail> = {}): ProductDetail {
  return {
    brand: structuredClone(activeBrand),
    category: structuredClone(activeCategory),
    images: [image()],
    ingredients: '植物清洁成分',
    introduction: '清洁日用商品',
    is_hot: false,
    is_new: true,
    name: '青柠净护洗衣液',
    net_sales_count: 18,
    product_id: 'product-active',
    skus: [sku()],
    spu_code: 'QX-PRODUCT-001',
    status: 'ACTIVE',
    subtitle: '低敏清洁配方',
    usage_method: '按建议用量使用',
    version: 4,
    ...overrides,
  };
}

function record(
  detail: ProductDetail,
  inventory: Record<string, InventorySnapshot> = {},
): ProductRecord {
  return { detail, inventory };
}

function inventory(physical = 18, locked = 4): InventorySnapshot {
  return {
    available_stock: physical - locked,
    locked_stock: locked,
    physical_stock: physical,
  };
}

function defaultRecords(): ProductRecord[] {
  const draftSku = sku({
    available_stock: 0,
    code: 'QX-DRAFT-001',
    is_recommended: false,
    name: '草稿规格',
    sku_id: 'sku-draft',
    status: 'INACTIVE',
  });
  const archivedSku = sku({
    available_stock: 0,
    code: 'QX-ARCHIVED-001',
    is_recommended: false,
    name: '归档规格',
    sku_id: 'sku-archived',
    status: 'ARCHIVED',
  });
  return [
    record(product({
      images: [],
      name: '待完善商品',
      product_id: 'product-draft',
      skus: [draftSku],
      spu_code: 'QX-DRAFT-PRODUCT',
      status: 'DRAFT',
      version: 1,
    }), { [draftSku.sku_id]: inventory(0, 0) }),
    record(product(), { 'sku-active': inventory(18, 4) }),
    record(product({
      images: [image(2)],
      name: '已归档商品',
      product_id: 'product-archived',
      skus: [archivedSku],
      spu_code: 'QX-ARCHIVED-PRODUCT',
      status: 'ARCHIVED',
      version: 6,
    }), { [archivedSku.sku_id]: inventory(0, 0) }),
  ];
}

function readyDraftRecord(id = 'product-ready'): ProductRecord {
  const activeSku = sku({ code: `${id.toUpperCase()}-SKU`, sku_id: `${id}-sku` });
  return record(product({
    name: '已就绪草稿商品',
    product_id: id,
    skus: [activeSku],
    spu_code: `${id.toUpperCase()}-SPU`,
    status: 'DRAFT',
    version: 1,
  }), { [activeSku.sku_id]: inventory(8, 0) });
}

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: requestId };
}

function error(code: string, message: string) {
  return { code, message, request_id: requestId };
}

async function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store, private', ...headers },
    status,
  });
}

function session(rotated = false) {
  return {
    access_token: rotated ? rotatedAccessToken : accessToken,
    account_id: '01J5ADMINACCOUNT000000000000',
    assurance: 'MFA',
    expires_at: '2099-08-13T10:00:00.000Z',
    mfa_required: false,
    refresh_token: rotated ? rotatedRefreshToken : refreshToken,
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    session_id: '01J5ADMINSESSION000000000000',
  } as const;
}

class MockProductsBackend {
  readonly records: ProductRecord[];
  readonly requests: RecordedRequest[] = [];
  readonly listQueries: URLSearchParams[] = [];
  readonly uploadedBodies: Buffer[] = [];
  listDelayMs: number;
  nextListFailure: ListFailure | null = null;
  nextProductCreateFailure: ListFailure | null = null;
  nextSkuCreateFailure: ListFailure | null = null;
  nextSkuUpdateFailure: ListFailure | null = null;
  expireNextPath: string | null = null;
  refreshRequests = 0;
  uploadCompleteDelayMs = 0;

  private fileSequence = 0;
  private previewSequence = 0;
  private refreshed = false;
  private readonly uploadIntents = new Map<string, { mimeType: string; purpose: string; sha256: string; size: number }>();
  private readonly confirmFailures = new Map<string, ConfirmFailure>();
  private readonly confirmConflicts = new Set<string>();
  private readonly issuedPreviews = new Map<string, IssuedPreview>();

  constructor(options: MockBackendOptions = {}) {
    this.records = structuredClone(options.records ?? defaultRecords());
    this.listDelayMs = options.listDelayMs ?? 0;
  }

  count(path: string | RegExp, method?: string): number {
    return this.requests.filter((request) => {
      const matches = typeof path === 'string' ? request.path === path : path.test(request.path);
      return matches && (!method || request.method === method);
    }).length;
  }

  matching(path: RegExp, method?: string): RecordedRequest[] {
    return this.requests.filter((request) => path.test(request.path) && (!method || request.method === method));
  }

  findProduct(id: string): ProductRecord | undefined {
    return this.records.find(({ detail }) => detail.product_id === id);
  }

  setConfirmFailure(type: TargetType, id: string, action: LifecycleAction, failure: ConfirmFailure): void {
    this.confirmFailures.set(`${type}:${id}:${action}`, failure);
  }

  conflictNextConfirm(type: TargetType, id: string): void {
    this.confirmConflicts.add(`${type}:${id}`);
  }

  async install(page: Page): Promise<void> {
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;

      if (url.hostname === 'uploads.example.test') {
        if (request.method() === 'OPTIONS') {
          await route.fulfill({
            headers: {
              'access-control-allow-headers': 'content-type,x-upload-contract',
              'access-control-allow-methods': 'PUT,OPTIONS',
              'access-control-allow-origin': adminBaseUrl,
            },
            status: 204,
          });
          return;
        }
        expect(request.method()).toBe('PUT');
        expect(request.headers()['content-type']).toBe('image/png');
        expect(request.headers()['x-upload-contract']).toBe('product-v1');
        this.uploadedBodies.push(request.postDataBuffer() ?? Buffer.alloc(0));
        await route.fulfill({
          body: '',
          headers: { 'access-control-allow-origin': adminBaseUrl },
          status: 200,
        });
        return;
      }
      if (url.hostname === 'assets.example.test') {
        await route.fulfill({ body: pngBytes, contentType: 'image/png', status: 200 });
        return;
      }
      if (!path.startsWith('/api/v1/')) {
        await route.fallback();
        return;
      }

      if (path === '/api/v1/admin/auth/login') {
        this.recordRequest(route);
        await json(route, 200, success({
          assurance: 'PASSWORD_ONLY',
          challenge_id: 'products-login-challenge',
          expires_at: '2099-08-13T09:05:00.000Z',
          mfa_required: true,
          next_action: 'VERIFY_TOTP',
          pre_auth_token: preauthToken,
        }));
        return;
      }
      if (path === '/api/v1/admin/auth/mfa/challenges/products-login-challenge/verify') {
        expect(request.headers().authorization).toBe(`Bearer ${preauthToken}`);
        this.recordRequest(route);
        await json(route, 200, success(session()));
        return;
      }
      if (path === '/api/v1/admin/auth/refresh') {
        this.refreshRequests += 1;
        this.recordRequest(route);
        expect(request.postDataJSON()).toEqual({ refresh_token: this.refreshed ? rotatedRefreshToken : refreshToken });
        this.refreshed = true;
        await json(route, 200, success(session(true)));
        return;
      }

      const expectedAccessToken = this.refreshed ? rotatedAccessToken : accessToken;
      expect(request.headers().authorization).toBe(`Bearer ${expectedAccessToken}`);
      if (this.expireNextPath === path) {
        this.expireNextPath = null;
        await json(route, 401, error('AUTH_EXPIRED', 'expired access token'));
        return;
      }

      if (path === '/api/v1/files/upload-intents' && request.method() === 'POST') {
        await this.handleUploadIntent(route);
        return;
      }
      const completeMatch = path.match(/^\/api\/v1\/files\/([^/]+)\/complete$/);
      if (completeMatch && request.method() === 'POST') {
        await this.handleUploadComplete(route, completeMatch[1] ?? 'missing');
        return;
      }

      if (path === '/api/v1/admin/brands' && request.method() === 'GET') {
        this.recordRequest(route);
        await json(route, 200, success({ items: [activeBrand], pagination: { page: 1, page_size: 100, total: 1 } }));
        return;
      }
      if (path === '/api/v1/admin/categories' && request.method() === 'GET') {
        this.recordRequest(route);
        await json(route, 200, success({ items: [activeCategory], pagination: { page: 1, page_size: 100, total: 1 } }));
        return;
      }
      if (path === `/api/v1/admin/brands/${activeBrand.brand_id}` && request.method() === 'GET') {
        this.recordRequest(route);
        await json(route, 200, success(activeBrand));
        return;
      }
      if (path === `/api/v1/admin/categories/${activeCategory.category_id}` && request.method() === 'GET') {
        this.recordRequest(route);
        await json(route, 200, success(activeCategory));
        return;
      }

      if (path === '/api/v1/admin/products') {
        if (request.method() === 'GET') await this.handleProductList(route, url.search);
        else if (request.method() === 'POST') await this.handleProductCreate(route);
        else await json(route, 405, error('METHOD_NOT_ALLOWED', 'method not allowed'));
        return;
      }

      const skuCreateMatch = path.match(/^\/api\/v1\/admin\/products\/([^/]+)\/skus$/);
      if (skuCreateMatch && request.method() === 'POST') {
        await this.handleSkuCreate(route, skuCreateMatch[1] ?? 'missing');
        return;
      }
      const productLifecycleMatch = path.match(/^\/api\/v1\/admin\/products\/([^/]+)\/lifecycle-(preview|changes)$/);
      if (productLifecycleMatch && request.method() === 'POST') {
        await this.handleLifecycle(route, 'product', productLifecycleMatch[1] ?? '', productLifecycleMatch[2] as 'preview' | 'changes');
        return;
      }
      const productRestoreMatch = path.match(/^\/api\/v1\/admin\/products\/([^/]+)\/restore$/);
      if (productRestoreMatch && request.method() === 'POST') {
        await this.handleRestore(route, 'product', productRestoreMatch[1] ?? '');
        return;
      }
      const productDetailMatch = path.match(/^\/api\/v1\/admin\/products\/([^/]+)$/);
      if (productDetailMatch) {
        const id = productDetailMatch[1] ?? '';
        if (request.method() === 'GET') await this.handleProductDetail(route, id);
        else if (request.method() === 'PATCH') await this.handleProductUpdate(route, id);
        else await json(route, 405, error('METHOD_NOT_ALLOWED', 'method not allowed'));
        return;
      }

      const skuLifecycleMatch = path.match(/^\/api\/v1\/admin\/skus\/([^/]+)\/lifecycle-(preview|changes)$/);
      if (skuLifecycleMatch && request.method() === 'POST') {
        await this.handleLifecycle(route, 'sku', skuLifecycleMatch[1] ?? '', skuLifecycleMatch[2] as 'preview' | 'changes');
        return;
      }
      const skuRestoreMatch = path.match(/^\/api\/v1\/admin\/skus\/([^/]+)\/restore$/);
      if (skuRestoreMatch && request.method() === 'POST') {
        await this.handleRestore(route, 'sku', skuRestoreMatch[1] ?? '');
        return;
      }
      const skuDetailMatch = path.match(/^\/api\/v1\/admin\/skus\/([^/]+)$/);
      if (skuDetailMatch && request.method() === 'PATCH') {
        await this.handleSkuUpdate(route, skuDetailMatch[1] ?? '');
        return;
      }

      const body = request.postData() ? request.postDataJSON() as Record<string, unknown> : {};
      this.recordRequest(route, body);
      await json(route, 404, error('NOT_FOUND', `No mock for ${request.method()} ${path}`));
    });
  }

  private recordRequest(route: Route, body: Record<string, unknown> = {}): void {
    const request = route.request();
    this.requests.push({
      body,
      headers: request.headers(),
      method: request.method(),
      path: new URL(request.url()).pathname,
    });
  }

  private assertWriteHeaders(route: Route, withVersion: boolean): void {
    const headers = route.request().headers();
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    if (withVersion) expect(headers['if-match']).toMatch(/^"[1-9][0-9]*"$/);
  }

  private productSummary(detail: ProductDetail) {
    const activePrices = detail.skus
      .filter((item) => item.status === 'ACTIVE')
      .map((item) => Number(item.retail_price));
    return {
      brand: detail.brand,
      category: detail.category,
      is_hot: detail.is_hot,
      is_new: detail.is_new,
      minimum_active_price: activePrices.length ? Math.min(...activePrices).toFixed(2) : null,
      name: detail.name,
      net_sales_count: detail.net_sales_count,
      primary_image: detail.images[0] ?? null,
      product_id: detail.product_id,
      spu_code: detail.spu_code,
      status: detail.status,
      subtitle: detail.subtitle,
      version: detail.version,
    };
  }

  private listItem(item: ProductRecord) {
    const stock = item.detail.skus.map((current) => ({
      current,
      inventory: item.inventory[current.sku_id] ?? inventory(current.available_stock, 0),
    }));
    return {
      active_sku_count: item.detail.skus.filter((current) => current.status === 'ACTIVE').length,
      available_stock: stock.reduce((sum, current) => sum + current.inventory.available_stock, 0),
      locked_stock: stock.reduce((sum, current) => sum + current.inventory.locked_stock, 0),
      physical_stock: stock.reduce((sum, current) => sum + current.inventory.physical_stock, 0),
      product: this.productSummary(item.detail),
      sku_count: item.detail.skus.length,
      skus: stock.map(({ current, inventory: currentInventory }) => ({
        available_stock: currentInventory.available_stock,
        code: current.code,
        locked_stock: currentInventory.locked_stock,
        name: current.name,
        physical_stock: currentInventory.physical_stock,
        sku_id: current.sku_id,
        status: current.status,
      })),
    };
  }

  private async handleProductList(route: Route, search: string): Promise<void> {
    this.recordRequest(route);
    const query = new URLSearchParams(search);
    this.listQueries.push(query);
    if (this.listDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.listDelayMs));
    if (this.nextListFailure) {
      const failure = this.nextListFailure;
      this.nextListFailure = null;
      await json(route, failure.status, error(failure.code ?? 'INTERNAL_ERROR', failure.message ?? 'internal product list detail'));
      return;
    }
    const keyword = query.get('keyword')?.toLocaleLowerCase('zh-CN') ?? '';
    const status = query.get('status') as ProductStatus | null;
    const brandId = query.get('brand_id');
    const categoryId = query.get('category_id');
    const recommended = query.get('recommended');
    const page = Number(query.get('page') ?? '1');
    const pageSize = Number(query.get('page_size') ?? '20');
    const filtered = this.records
      .filter(({ detail }) => status ? detail.status === status : detail.status !== 'ARCHIVED')
      .filter(({ detail }) => !brandId || detail.brand.brand_id === brandId)
      .filter(({ detail }) => !categoryId || detail.category.category_id === categoryId)
      .filter(({ detail }) => recommended === null || detail.skus.some((item) => item.is_recommended) === (recommended === 'true'))
      .filter(({ detail }) => !keyword || [detail.name, detail.spu_code, ...detail.skus.map((item) => item.code)]
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword)));
    const offset = (page - 1) * pageSize;
    await json(route, 200, success({
      items: filtered.slice(offset, offset + pageSize).map((item) => this.listItem(item)),
      pagination: { page, page_size: pageSize, total: filtered.length },
    }));
  }

  private async handleProductDetail(route: Route, id: string): Promise<void> {
    this.recordRequest(route);
    const item = this.findProduct(id);
    if (!item) await json(route, 404, error('NOT_FOUND', 'missing product'));
    else await json(route, 200, success(item.detail));
  }

  private async handleProductCreate(route: Route): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    expect(body.initial_status).toBe('DRAFT');
    if (this.nextProductCreateFailure) {
      const failure = this.nextProductCreateFailure;
      this.nextProductCreateFailure = null;
      await json(route, failure.status, error(failure.code ?? 'STATE_CONFLICT', failure.message ?? 'product create conflict'));
      return;
    }
    const productId = `product-created-${this.records.length + 1}`;
    const images = (body.images as Array<{ file_id: string; sort_order: number }>).map((item, index) => ({
      file_id: item.file_id,
      is_primary: index === 0,
      sort_order: item.sort_order,
      url: `https://assets.example.test/${item.file_id}.png`,
    }));
    const detail = product({
      brand: structuredClone(activeBrand),
      category: structuredClone(activeCategory),
      images,
      ingredients: (body.ingredients as string | null | undefined) ?? null,
      introduction: (body.introduction as string | null | undefined) ?? null,
      is_hot: Boolean(body.is_hot),
      is_new: Boolean(body.is_new),
      name: String(body.name),
      net_sales_count: 0,
      product_id: productId,
      skus: [],
      spu_code: String(body.spu_code),
      status: 'DRAFT',
      subtitle: (body.subtitle as string | null | undefined) ?? null,
      usage_method: (body.usage_method as string | null | undefined) ?? null,
      version: 1,
    });
    this.records.unshift(record(detail));
    await json(route, 201, success(detail));
  }

  private async handleProductUpdate(route: Route, id: string): Promise<void> {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    const item = this.findProduct(id);
    if (!item) {
      await json(route, 404, error('NOT_FOUND', 'missing product'));
      return;
    }
    expect(body).not.toHaveProperty('spu_code');
    expect(body).not.toHaveProperty('status');
    if (body.name !== undefined) item.detail.name = String(body.name);
    if (body.subtitle !== undefined) item.detail.subtitle = body.subtitle as string | null;
    if (body.images !== undefined) {
      item.detail.images = (body.images as Array<{ file_id: string; sort_order: number }>).map((current, index) => ({
        file_id: current.file_id,
        is_primary: index === 0,
        sort_order: current.sort_order,
        url: `https://assets.example.test/${current.file_id}.png`,
      }));
    }
    item.detail.version += 1;
    await json(route, 200, success(item.detail));
  }

  private async handleSkuCreate(route: Route, productId: string): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    if (this.nextSkuCreateFailure) {
      const failure = this.nextSkuCreateFailure;
      this.nextSkuCreateFailure = null;
      await json(route, failure.status, error(failure.code ?? 'STATE_CONFLICT', failure.message ?? 'SKU create conflict'));
      return;
    }
    expect(body.initial_status).toBe('INACTIVE');
    const item = this.findProduct(productId);
    if (!item) {
      await json(route, 404, error('NOT_FOUND', 'missing product'));
      return;
    }
    const created = sku({
      available_stock: 0,
      code: String(body.code),
      is_recommended: Boolean(body.is_recommended),
      name: String(body.name),
      retail_price: String(body.retail_price),
      sku_id: `sku-created-${item.detail.skus.length + 1}`,
      spec_json: (body.spec_json as Sku['spec_json'] | undefined) ?? null,
      status: 'INACTIVE',
      version: 1,
    });
    item.detail.skus.push(created);
    item.inventory[created.sku_id] = inventory(0, 0);
    await json(route, 201, success(created));
  }

  private findSku(id: string): { product: ProductRecord; sku: Sku } | null {
    for (const productItem of this.records) {
      const current = productItem.detail.skus.find((item) => item.sku_id === id);
      if (current) return { product: productItem, sku: current };
    }
    return null;
  }

  private async handleSkuUpdate(route: Route, id: string): Promise<void> {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    if (this.nextSkuUpdateFailure) {
      const failure = this.nextSkuUpdateFailure;
      this.nextSkuUpdateFailure = null;
      await json(route, failure.status, error(failure.code ?? 'STATE_CONFLICT', failure.message ?? 'SKU update conflict'));
      return;
    }
    expect(body).not.toHaveProperty('code');
    expect(body).not.toHaveProperty('status');
    const found = this.findSku(id);
    if (!found) {
      await json(route, 404, error('NOT_FOUND', 'missing SKU'));
      return;
    }
    if (body.name !== undefined) found.sku.name = String(body.name);
    if (body.retail_price !== undefined) found.sku.retail_price = String(body.retail_price);
    if (body.spec_json !== undefined) found.sku.spec_json = body.spec_json as Sku['spec_json'];
    if (body.is_recommended !== undefined) found.sku.is_recommended = Boolean(body.is_recommended);
    found.sku.version += 1;
    await json(route, 200, success(found.sku));
  }

  private lifecycleTarget(type: TargetType, id: string): { status: ProductStatus | SkuStatus; version: number } | null {
    if (type === 'product') return this.findProduct(id)?.detail ?? null;
    return this.findSku(id)?.sku ?? null;
  }

  private async handleLifecycle(
    route: Route,
    type: TargetType,
    id: string,
    operation: 'preview' | 'changes',
  ): Promise<void> {
    this.assertWriteHeaders(route, operation === 'changes');
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    const target = this.lifecycleTarget(type, id);
    if (!target) {
      await json(route, 404, error('NOT_FOUND', `missing ${type}`));
      return;
    }
    const action = body.action as LifecycleAction;
    const failureKey = `${type}:${id}:${action}`;
    const failure = this.confirmFailures.get(failureKey);
    if (operation === 'preview') {
      this.previewSequence += 1;
      const token = `product-preview-token-${this.previewSequence}`;
      const confirmationHash = createHash('sha256')
        .update(`${type}:${id}:${action}:${String(body.reason)}:${this.previewSequence}`)
        .digest('hex');
      const resourceEtag = `"${target.version}"`;
      this.issuedPreviews.set(token, {
        action,
        confirmationHash,
        id,
        reason: String(body.reason),
        resourceEtag,
        token,
        type,
      });
      await json(route, 200, success({
        confirmation_hash: confirmationHash,
        expires_at: '2099-08-13T09:05:00.000Z',
        impact: {
          affected_count: failure ? 1 : 0,
          metrics: [{ after: action, before: target.status, key: 'status', label: '状态' }],
          warnings: failure ? [failure.warning] : [],
        },
        preview_token: token,
        resource_etag: resourceEtag,
      }), { pragma: 'no-cache' });
      return;
    }
    const token = String(body.preview_token ?? '');
    const issuedPreview = this.issuedPreviews.get(token);
    expect(issuedPreview).toMatchObject({ action, id, reason: String(body.reason), token, type });
    expect(body.confirmation_hash).toBe(issuedPreview?.confirmationHash);
    expect(route.request().headers()['if-match']).toBe(issuedPreview?.resourceEtag);
    const conflictKey = `${type}:${id}`;
    if (this.confirmConflicts.delete(conflictKey)) {
      target.version += 1;
      await json(route, 409, error('RESOURCE_VERSION_CONFLICT', 'internal stale product fields'));
      return;
    }
    if (failure) {
      await json(route, failure.status, error(failure.code ?? 'STATE_CONFLICT', failure.message ?? 'internal dependency ids'));
      return;
    }
    target.status = action === 'ACTIVATE' ? 'ACTIVE' : action === 'DEACTIVATE' ? 'INACTIVE' : 'ARCHIVED';
    target.version += 1;
    this.issuedPreviews.delete(token);
    await json(route, 200, success({
      occurred_at: '2026-08-24T09:00:00.000Z',
      resource_id: id,
      resource_type: type,
      status: target.status,
      version: target.version,
    }));
  }

  private async handleRestore(route: Route, type: TargetType, id: string): Promise<void> {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    const target = this.lifecycleTarget(type, id);
    if (!target) {
      await json(route, 404, error('NOT_FOUND', `missing ${type}`));
      return;
    }
    target.status = type === 'product' ? 'DRAFT' : 'INACTIVE';
    target.version += 1;
    await json(route, 200, success({
      occurred_at: '2026-08-24T09:00:00.000Z',
      resource_id: id,
      resource_type: type,
      status: target.status,
      version: target.version,
    }));
  }

  private async handleUploadIntent(route: Route): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    this.fileSequence += 1;
    const fileId = `product-file-${this.fileSequence}`;
    this.uploadIntents.set(fileId, {
      mimeType: String(body.mime_type),
      purpose: String(body.purpose),
      sha256: String(body.sha256),
      size: Number(body.size),
    });
    await json(route, 200, success({
      expires_at: '2099-08-13T09:15:00.000Z',
      file_id: fileId,
      purpose: body.purpose,
      status: 'PENDING',
      upload_headers: [
        { name: 'Content-Type', value: String(body.mime_type) },
        { name: 'x-upload-contract', value: 'product-v1' },
      ],
      upload_url: `https://uploads.example.test/${fileId}`,
    }));
  }

  private async handleUploadComplete(route: Route, fileId: string): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.recordRequest(route, body);
    const intent = this.uploadIntents.get(fileId);
    expect(intent).toBeDefined();
    expect(body).toEqual({ sha256: intent?.sha256, size: intent?.size });
    if (this.uploadCompleteDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.uploadCompleteDelayMs));
    }
    await json(route, 200, success({
      completed_at: '2026-08-24T09:00:00.000Z',
      file_id: fileId,
      public_url: `https://assets.example.test/${fileId}.png`,
      purpose: intent?.purpose,
      status: 'READY',
    }));
  }
}

async function login(page: Page, backend: MockProductsBackend): Promise<void> {
  await backend.install(page);
  await page.goto(`${adminBaseUrl}/login`);
  await page.getByLabel('超级管理员账号').fill('admin.operator');
  await page.getByLabel('登录密码').fill('RuntimePassword');
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await page.getByLabel('动态验证码').fill('123456');
  await page.getByRole('button', { name: '完成验证' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
  await expect(page.getByTestId('catalog-page')).toBeVisible();
}

async function openProducts(page: Page, backend: MockProductsBackend): Promise<void> {
  await login(page, backend);
  await page.getByRole('link', { name: '商品管理', exact: true }).click();
  await expect(page).toHaveURL(/\/catalog\/products$/);
  await expect(page.getByTestId('product-list-page')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function expectWithinViewport(page: Page, locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y).toBeGreaterThanOrEqual(-1);
  expect(box.y + Math.min(box.height, viewport.height)).toBeLessThanOrEqual(viewport.height + 1);
}

async function selectElementPlusOption(page: Page, label: string, option: string): Promise<void> {
  const combobox = page.getByRole('combobox', { name: label, exact: true });
  await combobox.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await combobox.click({ force: true });
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function uploadProductImage(page: Page, name: string): Promise<void> {
  await page.getByTestId('product-images-editor').locator('input[type="file"]').setInputFiles({
    buffer: pngBytes,
    mimeType: 'image/png',
    name,
  });
}

const lifecycleLabels: Record<LifecycleAction, string> = {
  ACTIVATE: '启用',
  DEACTIVATE: '停用',
  SOFT_DELETE: '归档',
};

async function openLifecycle(
  page: Page,
  row: Locator,
  action: LifecycleAction,
  reason: string,
): Promise<Locator> {
  const directAction = row.getByRole('button', { name: lifecycleLabels[action], exact: true });
  if (await directAction.count()) await directAction.first().click();
  else await row.getByRole('button', { name: '影响预览', exact: true }).click();
  const dialog = page.getByTestId('product-lifecycle-dialog');
  await expect(dialog).toBeVisible();
  const actionSelect = dialog.getByRole('combobox', { name: '生命周期动作', exact: true });
  if (await actionSelect.count()) await selectElementPlusOption(page, '生命周期动作', lifecycleLabels[action]);
  await dialog.getByLabel('操作原因').fill(reason);
  const previewButton = dialog.getByRole('button', { name: '生成影响预览', exact: true });
  await expect(previewButton).toBeVisible();
  await previewButton.click();
  await expect(dialog.getByRole('button', { name: `确认${lifecycleLabels[action]}`, exact: true })).toBeVisible();
  await expectWithinViewport(page, dialog);
  return dialog;
}

function expectIdempotencyKeys(requests: RecordedRequest[]): void {
  for (const request of requests) expect(request.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
}

function expectUniqueIdempotencyKeys(requests: RecordedRequest[]): void {
  expectIdempotencyKeys(requests);
  const keys = requests.map((request) => request.headers['idempotency-key']);
  expect(new Set(keys).size).toBe(keys.length);
}

test.describe('B4.3 admin Product and SKU management', () => {
  test('loads product navigation and keeps loading, 500, empty, and 403 states recoverable', async ({ page }, testInfo) => {
    const backend = new MockProductsBackend({ listDelayMs: 600 });
    backend.nextListFailure = { message: 'internal relation and SQL details', status: 500 };

    await openProducts(page, backend);
    await expect(page.getByTestId('product-list-loading')).toBeVisible();
    await expect(page.getByTestId('product-list-error')).toBeVisible();
    await expect(page.getByText('internal relation and SQL details')).toHaveCount(0);

    backend.listDelayMs = 0;
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('product-row-product-active')).toBeVisible();
    await expect(page.getByRole('link', { name: '商品管理', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '品牌管理', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '分类管理', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '库存管理', exact: true })).toBeVisible();
    await expect(page.locator('a[href="/content/banners"]')).toBeVisible();
    await expect(page.getByRole('link', { name: '账户安全', exact: true })).toBeVisible();
    await expect(page.getByText('库存调整', { exact: true })).toHaveCount(0);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('products-list.png') });

    backend.nextListFailure = { code: 'FORBIDDEN', message: 'internal permission names', status: 403 };
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('product-list-error')).toContainText('无权');
    await expect(page.getByText('internal permission names')).toHaveCount(0);

    backend.records.splice(0);
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('product-list-empty')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('applies Product filters and pagination while projecting nullable price and one inventory snapshot', async ({ page }) => {
    const manyRecords = defaultRecords();
    for (let index = 1; index <= 21; index += 1) {
      const currentSku = sku({
        code: `FILTER-SKU-${index}`,
        is_recommended: index === 1,
        sku_id: `filter-sku-${index}`,
      });
      manyRecords.push(record(product({
        name: index === 1 ? '筛选命中商品' : `分页商品 ${index}`,
        product_id: `filter-product-${index}`,
        skus: [currentSku],
        spu_code: `FILTER-SPU-${index}`,
      }), { [currentSku.sku_id]: inventory(18, 4) }));
    }
    const backend = new MockProductsBackend({ records: manyRecords });
    await openProducts(page, backend);

    const draftRow = page.getByTestId('product-row-product-draft');
    await expect(draftRow).toContainText('暂无活动价');
    const activeRow = page.getByTestId('product-row-product-active');
    await expect(activeRow).toContainText('1 SKU');
    await expect(activeRow).toContainText('实物 18');
    await expect(activeRow).toContainText('锁定 4');
    await expect(activeRow).toContainText('可售 14');
    await expect(activeRow.getByRole('button', { name: /调整库存/ })).toHaveCount(0);

    await page.getByLabel('商品关键词').fill('筛选命中');
    await selectElementPlusOption(page, '品牌筛选', activeBrand.name);
    await selectElementPlusOption(page, '分类筛选', activeCategory.name);
    await selectElementPlusOption(page, '状态筛选', '已启用');
    await page.getByLabel('仅含推荐 SKU').check();
    await page.getByRole('button', { name: '查询商品' }).click();
    await expect(page.getByTestId('product-row-filter-product-1')).toBeVisible();

    const filteredQuery = backend.listQueries.at(-1);
    expect(filteredQuery?.get('keyword')).toBe('筛选命中');
    expect(filteredQuery?.get('brand_id')).toBe(activeBrand.brand_id);
    expect(filteredQuery?.get('category_id')).toBe(activeCategory.category_id);
    expect(filteredQuery?.get('status')).toBe('ACTIVE');
    expect(filteredQuery?.get('recommended')).toBe('true');

    await page.getByRole('button', { name: '重置筛选' }).click();
    await expect(page.getByTestId('product-row-product-active')).toBeVisible();
    await page.getByLabel('下一页').click();
    await expect.poll(() => backend.listQueries.at(-1)?.get('page')).toBe('2');
    await expect(page.getByTestId('product-row-filter-product-19')).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test('creates and edits a DRAFT Product with ordered PRODUCT_IMAGE uploads and duplicate-submit suppression', async ({ page }, testInfo) => {
    const backend = new MockProductsBackend();
    await openProducts(page, backend);

    await page.getByRole('button', { name: '新增商品' }).click();
    await expect(page).toHaveURL(/\/catalog\/products\/new$/);
    const editor = page.getByTestId('product-editor-page');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('固定保存为草稿');
    await expect(editor.getByRole('combobox', { name: '商品状态' })).toHaveCount(0);
    await expect(editor.getByRole('button', { name: /保存并发布/ })).toHaveCount(0);
    await editor.getByLabel('SPU 编码').fill('QX-NEW-PRODUCT');
    await editor.getByLabel('商品名称').fill('白茶清润洗衣液');
    await editor.getByLabel('副标题').fill('低敏洁净配方');
    await selectElementPlusOption(page, '品牌', activeBrand.name);
    await selectElementPlusOption(page, '一级分类', activeCategory.name);

    for (let index = 1; index <= 8; index += 1) {
      await uploadProductImage(page, `product-${index}.png`);
      await expect.poll(() => backend.matching(/^\/api\/v1\/files\/[^/]+\/complete$/, 'POST').length).toBe(index);
    }
    const imagesEditor = page.getByTestId('product-images-editor');
    await expect(imagesEditor).toContainText('8 / 8');
    await expect(imagesEditor.getByRole('button', { name: /上传|选择/ })).toBeDisabled();
    await imagesEditor.locator('[data-file-id="product-file-2"]').getByRole('button', { name: '上移' }).click();
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('product-editor.png') });

    backend.nextProductCreateFailure = {
      code: 'STATE_CONFLICT',
      message: 'internal duplicate SPU details',
      status: 409,
    };
    await editor.getByRole('button', { name: '保存商品资料' }).click();
    await expect(page).toHaveURL(/\/catalog\/products\/new$/);
    await expect(editor.getByLabel('SPU 编码')).toHaveValue('QX-NEW-PRODUCT');
    await expect(editor.getByLabel('商品名称')).toHaveValue('白茶清润洗衣液');
    await expect(editor.locator('p.form-error[role="alert"]')).toContainText(/SPU 编码已存在/);
    await expect(editor.getByText('internal duplicate SPU details')).toHaveCount(0);

    await editor.getByRole('button', { name: '保存商品资料' }).dblclick();
    await expect(page).toHaveURL(/\/catalog\/products$/);
    const creates = backend.matching(/^\/api\/v1\/admin\/products$/, 'POST');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.body).toMatchObject({
      brand_id: activeBrand.brand_id,
      category_id: activeCategory.category_id,
      initial_status: 'DRAFT',
      name: '白茶清润洗衣液',
      spu_code: 'QX-NEW-PRODUCT',
    });
    const imageInputs = creates[1]?.body.images as Array<{ file_id: string; sort_order: number }>;
    expect(imageInputs).toHaveLength(8);
    expect(imageInputs.map((item) => item.sort_order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(imageInputs[0]?.file_id).toBe('product-file-2');
    expectUniqueIdempotencyKeys(creates);

    const intents = backend.matching(/^\/api\/v1\/files\/upload-intents$/, 'POST');
    expect(intents).toHaveLength(8);
    const expectedHash = createHash('sha256').update(pngBytes).digest('hex');
    for (const intentRequest of intents) {
      expect(intentRequest.body).toMatchObject({
        mime_type: 'image/png',
        purpose: 'PRODUCT_IMAGE',
        sha256: expectedHash,
        size: pngBytes.byteLength,
      });
    }
    expect(backend.uploadedBodies).toHaveLength(8);

    const createdRow = page.getByTestId('product-row-product-created-4');
    await expect(createdRow).toContainText('草稿');
    await createdRow.getByRole('button', { name: '编辑商品' }).click();
    await expect(page).toHaveURL(/\/catalog\/products\/product-created-4$/);
    const updateEditor = page.getByTestId('product-editor-page');
    await expect(updateEditor.getByLabel('SPU 编码')).toBeDisabled();
    await updateEditor.getByLabel('商品名称').fill('白茶清润洗衣液经典版');
    await updateEditor.getByRole('button', { name: '影响预览' }).click();
    await expect(page.getByTestId('product-lifecycle-dialog')).toHaveCount(0);
    await expect(page.getByText(/未保存修改.*先保存/).first()).toBeVisible();
    await updateEditor.getByRole('tab', { name: /SKU 与价格/ }).click();
    await expect(updateEditor.getByRole('tab', { name: '基本资料' })).toHaveAttribute('aria-selected', 'true');
    await expect(updateEditor.getByLabel('商品名称')).toHaveValue('白茶清润洗衣液经典版');
    await updateEditor.getByRole('button', { name: '保存商品资料' }).click();
    await expect(updateEditor.getByLabel('商品名称')).toHaveValue('白茶清润洗衣液经典版');
    await updateEditor.getByRole('tab', { name: /SKU 与价格/ }).click();
    await expect(updateEditor.getByRole('tab', { name: /SKU 与价格/ })).toHaveAttribute('aria-selected', 'true');
    const updates = backend.matching(/^\/api\/v1\/admin\/products\/product-created-4$/, 'PATCH');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.headers['if-match']).toBe('"1"');
    expect(updates[0]?.body).not.toHaveProperty('spu_code');
    expect(updates[0]?.body).not.toHaveProperty('status');

    await updateEditor.getByRole('button', { name: '返回商品列表' }).click();
    await page.getByTestId('product-row-product-active').getByRole('button', { name: '编辑商品' }).click();
    const activeEditor = page.getByTestId('product-editor-page');
    backend.uploadCompleteDelayMs = 600;
    const uploadInProgress = uploadProductImage(page, 'in-progress.png');
    await expect(activeEditor.getByText('正在上传')).toBeVisible();
    await activeEditor.getByRole('button', { name: '停用', exact: true }).click();
    await expect(page.getByTestId('product-lifecycle-dialog')).toHaveCount(0);
    await expect(page.getByText(/商品图片仍在上传.*等待上传完成/)).toBeVisible();
    await activeEditor.getByRole('tab', { name: /SKU 与价格/ }).click();
    await expect(activeEditor.getByRole('tab', { name: '基本资料' })).toHaveAttribute('aria-selected', 'true');
    await uploadInProgress;
    await expect(activeEditor.getByTestId('product-images-editor')).toContainText('2 / 8');
    await expectNoHorizontalOverflow(page);
  });

  test('creates, edits, archives, and restores an independently versioned INACTIVE SKU', async ({ page }, testInfo) => {
    const backend = new MockProductsBackend();
    await openProducts(page, backend);
    await page.getByTestId('product-row-product-active').getByRole('button', { name: '编辑商品' }).click();
    const editor = page.getByTestId('product-editor-page');
    await editor.getByRole('tab', { name: /SKU 与价格/ }).click();
    await expect(editor.getByText(/佣金|规则来源/)).toHaveCount(0);
    await expect(editor.getByRole('button', { name: /调整库存/ })).toHaveCount(0);
    await editor.getByRole('button', { name: '新增 SKU' }).click();

    let skuDialog = page.getByTestId('sku-editor-dialog');
    await expectWithinViewport(page, skuDialog);
    await expect(skuDialog).toContainText('新 SKU 固定为已停用');
    await expect(skuDialog).toContainText('实物 0');
    await skuDialog.getByLabel('SKU 编码').fill('QX-NEW-SKU');
    await skuDialog.getByLabel('SKU 名称').fill('补充装');
    await skuDialog.getByLabel('零售价').fill('39.00');
    await skuDialog.getByLabel('推荐 SKU').check();
    backend.nextSkuCreateFailure = {
      code: 'SOFT_DELETED_KEY_RESERVED',
      message: 'internal archived SKU id',
      status: 409,
    };
    await skuDialog.getByRole('button', { name: '保存 SKU' }).click();
    await expect(skuDialog).toBeVisible();
    await expect(skuDialog.getByLabel('SKU 编码')).toHaveValue('QX-NEW-SKU');
    await expect(skuDialog.getByLabel('SKU 名称')).toHaveValue('补充装');
    await expect(skuDialog.locator('p.form-error[role="alert"]')).toContainText(/归档记录保留/);
    await expect(skuDialog.getByText('internal archived SKU id')).toHaveCount(0);
    await skuDialog.getByRole('button', { name: '保存 SKU' }).dblclick();
    await expect(skuDialog).toBeHidden();

    const creates = backend.matching(/\/admin\/products\/product-active\/skus$/, 'POST');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.body).toMatchObject({
      code: 'QX-NEW-SKU',
      initial_status: 'INACTIVE',
      is_recommended: true,
      name: '补充装',
      retail_price: '39.00',
    });
    expectUniqueIdempotencyKeys(creates);
    const skuRow = page.getByTestId('sku-row-sku-created-2');
    await expect(skuRow).toContainText('已停用');
    await expect(skuRow).toContainText('实物 0');
    await expect(skuRow).toContainText('锁定 0');
    await expect(skuRow).toContainText('可售 0');

    await skuRow.getByRole('button', { name: '编辑 SKU' }).click();
    skuDialog = page.getByTestId('sku-editor-dialog');
    await expect(skuDialog.getByLabel('SKU 编码')).toBeDisabled();
    await skuDialog.getByLabel('SKU 名称').fill('补充装经典版');
    await skuDialog.getByLabel('零售价').fill('42.00');
    backend.nextSkuUpdateFailure = {
      code: 'STATE_CONFLICT',
      message: 'internal parent product state',
      status: 409,
    };
    await skuDialog.getByRole('button', { name: '保存 SKU' }).click();
    await expect(skuDialog).toBeHidden();
    await expect(page.getByText(/SKU 或所属商品状态已变化.*刷新最新详情/)).toBeVisible();
    await expect(page.getByText('internal parent product state')).toHaveCount(0);
    await expect(page.getByTestId('sku-row-sku-created-2')).toContainText('补充装');

    await page.getByTestId('sku-row-sku-created-2').getByRole('button', { name: '编辑 SKU' }).click();
    skuDialog = page.getByTestId('sku-editor-dialog');
    await skuDialog.getByLabel('SKU 名称').fill('补充装经典版');
    await skuDialog.getByLabel('零售价').fill('42.00');
    await skuDialog.getByRole('button', { name: '保存 SKU' }).click();
    await expect(page.getByTestId('sku-row-sku-created-2')).toContainText('补充装经典版');
    await expect(page.getByTestId('sku-row-sku-created-2')).toContainText('42.00');
    const updates = backend.matching(/\/admin\/skus\/sku-created-2$/, 'PATCH');
    expect(updates).toHaveLength(2);
    expect(updates[0]?.headers['if-match']).toBe('"1"');
    expect(updates[0]?.body).not.toHaveProperty('code');
    expect(updates[0]?.body).not.toHaveProperty('status');
    expectUniqueIdempotencyKeys(updates);

    let lifecycleDialog = await openLifecycle(page, page.getByTestId('sku-row-sku-created-2'), 'ACTIVATE', 'SKU 资料已完成检查');
    await lifecycleDialog.getByRole('button', { name: '确认启用' }).click();
    await expect(page.getByTestId('sku-row-sku-created-2')).toContainText('已启用');

    lifecycleDialog = await openLifecycle(page, page.getByTestId('sku-row-sku-created-2'), 'DEACTIVATE', '暂停销售该 SKU');
    await lifecycleDialog.getByRole('button', { name: '确认停用' }).click();
    await expect(page.getByTestId('sku-row-sku-created-2')).toContainText('已停用');

    lifecycleDialog = await openLifecycle(page, page.getByTestId('sku-row-sku-created-2'), 'SOFT_DELETE', '停止维护该 SKU');
    await lifecycleDialog.getByRole('button', { name: '确认归档' }).click();
    await expect(page.getByTestId('sku-row-sku-created-2')).toContainText('已归档');
    const lifecyclePreviews = backend.matching(/\/admin\/skus\/sku-created-2\/lifecycle-preview$/, 'POST');
    const lifecycleChanges = backend.matching(/\/admin\/skus\/sku-created-2\/lifecycle-changes$/, 'POST');
    expect(lifecyclePreviews.map((request) => request.body.action)).toEqual(['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE']);
    expect(lifecycleChanges.map((request) => request.body.action)).toEqual(['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE']);
    expectUniqueIdempotencyKeys([...lifecyclePreviews, ...lifecycleChanges]);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('sku-panel.png') });

    await page.getByTestId('sku-row-sku-created-2').getByRole('button', { name: '恢复 SKU' }).click();
    const restoreDialog = page.getByRole('dialog').filter({ hasText: '恢复 SKU' });
    await restoreDialog.getByLabel('恢复原因').fill('重新维护该 SKU');
    await restoreDialog.getByRole('button', { name: '确认恢复为已停用' }).click();
    await expect(page.getByTestId('sku-row-sku-created-2')).toContainText('已停用');
    const restores = backend.matching(/\/admin\/skus\/sku-created-2\/restore$/, 'POST');
    expect(restores).toHaveLength(1);
    expect(restores[0]?.body).toEqual({ reason: '重新维护该 SKU' });
    expect(backend.matching(/restore-preview/, 'POST')).toHaveLength(0);
    await expectNoHorizontalOverflow(page);
  });

  test('keeps ARCHIVED Product detail read-only, includes archived SKUs, and restores only the Product to DRAFT', async ({ page }, testInfo) => {
    const backend = new MockProductsBackend();
    await openProducts(page, backend);
    await selectElementPlusOption(page, '状态筛选', '已归档');
    await page.getByRole('button', { name: '查询商品' }).click();
    const archivedRow = page.getByTestId('product-row-product-archived');
    await expect(archivedRow).toBeVisible();
    expect(backend.listQueries.some((query) => query.get('status') === 'ARCHIVED')).toBe(true);
    await archivedRow.getByRole('button', { name: '查看商品' }).click();

    const editor = page.getByTestId('product-editor-page');
    await expect(editor).toContainText('归档商品只读');
    await expect(editor.getByLabel('商品名称')).toBeDisabled();
    await expect(editor.getByLabel('SPU 编码')).toBeDisabled();
    await expect(editor.getByRole('button', { name: '保存商品资料' })).toHaveCount(0);
    await expect(editor.getByTestId('product-images-editor').locator('input[type="file"]')).toHaveCount(0);
    await editor.getByRole('tab', { name: /SKU 与价格/ }).click();
    await expect(page.getByTestId('sku-row-sku-archived')).toContainText('已归档');
    await expect(editor.getByRole('button', { name: '新增 SKU' })).toHaveCount(0);
    await page.screenshot({ fullPage: true, path: testInfo.outputPath('archived-product-detail.png') });

    await editor.getByRole('button', { name: '恢复商品' }).click();
    const restoreDialog = page.getByRole('dialog').filter({ hasText: '恢复商品' });
    await restoreDialog.getByLabel('恢复原因').fill('重新检查商品资料');
    await restoreDialog.getByRole('button', { name: '确认恢复为草稿' }).click();
    await expect(editor.locator('.status-badge').first()).toHaveText('草稿');
    expect(backend.findProduct('product-archived')?.detail.status).toBe('DRAFT');
    expect(backend.findProduct('product-archived')?.detail.skus[0]?.status).toBe('ARCHIVED');
    const restores = backend.matching(/\/admin\/products\/product-archived\/restore$/, 'POST');
    expect(restores).toHaveLength(1);
    expect(restores[0]?.headers['if-match']).toBe('"6"');
    expect(backend.matching(/restore-preview/, 'POST')).toHaveLength(0);
    await expectNoHorizontalOverflow(page);
  });

  test('maps all four Product and SKU dependency failures to actionable Chinese 422 messages', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', '四类依赖错误矩阵只需一个桌面视口');
    const missingImage = readyDraftRecord('missing-image');
    missingImage.detail.images = [];
    const missingActiveSku = readyDraftRecord('missing-active-sku');
    missingActiveSku.detail.skus[0]!.status = 'INACTIVE';
    const activeSkuDependency = readyDraftRecord('active-sku-dependency');
    activeSkuDependency.detail.status = 'INACTIVE';
    const reservedSku = sku({
      available_stock: 0,
      code: 'RESERVED-SKU',
      is_recommended: false,
      sku_id: 'reserved-sku',
      status: 'INACTIVE',
    });
    const reservationDependency = record(product({
      name: '有活动预占商品',
      product_id: 'reservation-dependency',
      skus: [reservedSku],
      spu_code: 'RESERVATION-DEPENDENCY',
      status: 'INACTIVE',
    }), { [reservedSku.sku_id]: inventory(3, 3) });
    const backend = new MockProductsBackend({
      records: [missingImage, missingActiveSku, activeSkuDependency, reservationDependency],
    });
    backend.setConfirmFailure('product', 'missing-image', 'ACTIVATE', {
      code: 'PRODUCT_PRIMARY_IMAGE_REQUIRED',
      message: 'internal file ids and object keys',
      status: 422,
      warning: '启用商品前至少需要一张可公开展示的商品图片',
    });
    backend.setConfirmFailure('product', 'missing-active-sku', 'ACTIVATE', {
      code: 'PRODUCT_ACTIVE_SKU_REQUIRED',
      message: 'internal sku ids',
      status: 422,
      warning: '启用商品前至少需要一个已启用 SKU',
    });
    backend.setConfirmFailure('product', 'active-sku-dependency', 'SOFT_DELETE', {
      code: 'ACTIVE_SKU_DEPENDENCY',
      message: 'internal active sku ids',
      status: 422,
      warning: '仍有 1 个已启用 SKU，请先停用',
    });
    backend.setConfirmFailure('sku', 'reserved-sku', 'SOFT_DELETE', {
      code: 'ACTIVE_INVENTORY_RESERVATION',
      message: 'internal reservation and order ids',
      status: 422,
      warning: '当前 SKU 仍有 3 件活动库存预占',
    });

    await openProducts(page, backend);
    const productCases = [
      ['missing-image', 'ACTIVATE', /至少.*商品图片/, '去补充商品图片', 'details'],
      ['missing-active-sku', 'ACTIVATE', /至少.*已启用 SKU/, '去维护 SKU', 'skus'],
      ['active-sku-dependency', 'SOFT_DELETE', /先停用.*SKU|SKU.*先停用/, '去停用相关 SKU', 'skus'],
    ] as const;
    for (const [id, action, expectedText, repairLabel, tab] of productCases) {
      const dialog = await openLifecycle(page, page.getByTestId(`product-row-${id}`), action, `验证 ${id} 依赖阻断`);
      await expect(dialog).toContainText(expectedText);
      const changesBefore = backend.count(new RegExp(`/admin/products/${id}/lifecycle-changes$`), 'POST');
      await dialog.getByRole('button', { name: `确认${lifecycleLabels[action]}` }).click();
      await expect.poll(() => backend.count(new RegExp(`/admin/products/${id}/lifecycle-changes$`), 'POST'))
        .toBe(changesBefore + 1);
      await expect(dialog.locator('p.form-error[role="alert"]')).toContainText(expectedText);
      await expect(dialog.getByText(/internal|object keys|sku ids/i)).toHaveCount(0);
      await dialog.getByRole('button', { name: repairLabel, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/catalog/products/${id}\\?tab=${tab}$`));
      const editor = page.getByTestId('product-editor-page');
      await expect(editor).toBeVisible();
      if (tab === 'details') await expect(editor.getByTestId('product-images-editor')).toBeVisible();
      else await expect(editor.getByRole('tab', { name: /SKU 与价格/ })).toHaveAttribute('aria-selected', 'true');
      await editor.getByRole('button', { name: '返回商品列表' }).click();
      await expect(page.getByTestId(`product-row-${id}`)).toBeVisible();
    }

    await page.getByTestId('product-row-reservation-dependency').getByRole('button', { name: '编辑商品' }).click();
    await page.getByTestId('product-editor-page').getByRole('tab', { name: /SKU 与价格/ }).click();
    const skuDialog = await openLifecycle(page, page.getByTestId('sku-row-reserved-sku'), 'SOFT_DELETE', '验证库存预占阻断');
    await expect(skuDialog).toContainText(/库存预占/);
    const skuChangesBefore = backend.count(/\/admin\/skus\/reserved-sku\/lifecycle-changes$/, 'POST');
    await skuDialog.getByRole('button', { name: '确认归档' }).click();
    await expect.poll(() => backend.count(/\/admin\/skus\/reserved-sku\/lifecycle-changes$/, 'POST'))
      .toBe(skuChangesBefore + 1);
    await expect(skuDialog.locator('p.form-error[role="alert"]')).toContainText(/库存预占/);
    await expect(skuDialog.getByText(/internal reservation/i)).toHaveCount(0);
    await skuDialog.getByRole('button', { name: '查看 SKU 库存摘要', exact: true }).click();
    await expect(page.getByTestId('product-editor-page').getByRole('tab', { name: /SKU 与价格/ }))
      .toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('sku-row-reserved-sku')).toContainText('可售 0');
  });

  test('refreshes once on 401 and discards a conflicted Product preview before a fresh confirmation', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', '共享请求层与 409 回归只需一个桌面视口');
    const backend = new MockProductsBackend({ records: [readyDraftRecord()] });
    backend.expireNextPath = '/api/v1/admin/products';
    await openProducts(page, backend);
    await expect(page.getByTestId('product-row-product-ready')).toBeVisible();
    expect(backend.refreshRequests).toBe(1);

    let dialog = await openLifecycle(page, page.getByTestId('product-row-product-ready'), 'ACTIVATE', '首次启用前已完成检查');
    await expectWithinViewport(page, dialog);
    await page.screenshot({ fullPage: false, path: testInfo.outputPath('product-lifecycle.png') });
    backend.conflictNextConfirm('product', 'product-ready');
    const listRequestsBeforeConflict = backend.count(/^\/api\/v1\/admin\/products$/, 'GET');
    await dialog.getByRole('button', { name: '确认启用' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/已刷新最新数据.*重新预览并确认/)).toBeVisible();
    await expect.poll(() => backend.count(/^\/api\/v1\/admin\/products$/, 'GET'))
      .toBe(listRequestsBeforeConflict + 1);
    await expect(page.getByText('internal stale product fields')).toHaveCount(0);

    const firstConfirm = backend.matching(/\/admin\/products\/product-ready\/lifecycle-changes$/, 'POST');
    expect(firstConfirm).toHaveLength(1);
    expect(firstConfirm[0]?.headers['if-match']).toBe('"1"');
    expect(firstConfirm[0]?.body.preview_token).toBe('product-preview-token-1');

    dialog = await openLifecycle(page, page.getByTestId('product-row-product-ready'), 'ACTIVATE', '版本冲突后已重新检查');
    await dialog.getByRole('button', { name: '确认启用' }).click();
    await expect(dialog).toBeHidden();
    const confirms = backend.matching(/\/admin\/products\/product-ready\/lifecycle-changes$/, 'POST');
    expect(confirms).toHaveLength(2);
    expect(confirms[1]?.headers['if-match']).toBe('"2"');
    expect(confirms[1]?.headers['idempotency-key']).not.toBe(confirms[0]?.headers['idempotency-key']);
    expect(confirms[1]?.body.preview_token).toBe('product-preview-token-2');
    expect(backend.findProduct('product-ready')?.detail.status).toBe('ACTIVE');

    dialog = await openLifecycle(page, page.getByTestId('product-row-product-ready'), 'DEACTIVATE', '暂时停止销售该商品');
    await dialog.getByRole('button', { name: '确认停用' }).click();
    await expect(page.getByTestId('product-row-product-ready')).toContainText('已停用');

    await page.getByTestId('product-row-product-ready').getByRole('button', { name: '编辑商品' }).click();
    await page.getByTestId('product-editor-page').getByRole('tab', { name: /SKU 与价格/ }).click();
    dialog = await openLifecycle(page, page.getByTestId('sku-row-product-ready-sku'), 'DEACTIVATE', '父商品归档前停用 SKU');
    await dialog.getByRole('button', { name: '确认停用' }).click();
    await page.getByRole('button', { name: '返回商品列表' }).click();
    await expect(page.getByTestId('product-row-product-ready')).toBeVisible();

    dialog = await openLifecycle(page, page.getByTestId('product-row-product-ready'), 'SOFT_DELETE', '商品停止维护并归档');
    await dialog.getByRole('button', { name: '确认归档' }).click();
    await expect(page.getByTestId('product-row-product-ready')).toHaveCount(0);
    expect(backend.findProduct('product-ready')?.detail.status).toBe('ARCHIVED');

    const productPreviews = backend.matching(/\/admin\/products\/product-ready\/lifecycle-preview$/, 'POST');
    const productChanges = backend.matching(/\/admin\/products\/product-ready\/lifecycle-changes$/, 'POST');
    const productActions = productChanges.map((request) => request.body.action);
    expect(productActions).toEqual(['ACTIVATE', 'ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE']);
    expectUniqueIdempotencyKeys([...productPreviews, ...productChanges]);

    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    const lifecycleChanges = backend.matching(/\/lifecycle-changes$/, 'POST');
    for (const request of lifecycleChanges) {
      expect(storage).not.toContain(String(request.body.preview_token));
      expect(storage).not.toContain(String(request.body.confirmation_hash));
    }
    await expectNoHorizontalOverflow(page);
  });
});
