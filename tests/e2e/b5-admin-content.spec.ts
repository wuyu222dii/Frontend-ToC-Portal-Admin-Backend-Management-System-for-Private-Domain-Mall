import { createHash } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

const adminBaseUrl = 'http://127.0.0.1:5175';
const accessToken = 'access-b5-runtime';
const refreshToken = 'refresh-b5-runtime';
const rotatedAccessToken = 'access-b5-rotated';
const rotatedRefreshToken = 'refresh-b5-rotated';
const preauthToken = 'preauth-b5-runtime';
const requestId = 'req_0123456789abcdef0123456789abcdef';
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);

type BannerStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type BannerTargetType = 'NONE' | 'PRODUCT' | 'CATEGORY' | 'URL';
type InventoryStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type LedgerType =
  | 'INITIAL'
  | 'MANUAL_INCREASE'
  | 'MANUAL_DECREASE'
  | 'ORDER_PAID_DEDUCT'
  | 'ORDER_RESERVE'
  | 'ORDER_RELEASE'
  | 'REFUND_RESTOCK'
  | 'RETURN_RESTOCK'
  | 'RETURN_DAMAGED'
  | 'COMPENSATION';

interface Banner {
  banner_id: string;
  ends_at: string | null;
  file_id: string;
  image_url: string;
  sort_order: number;
  starts_at: string | null;
  status: BannerStatus;
  target_id: string | null;
  target_type: BannerTargetType;
  target_url: string | null;
  title: string;
  version: number;
}

interface InventoryItem {
  active_reservation_qty: number;
  available_qty: number;
  locked_qty: number;
  physical_qty: number;
  product_name: string;
  sku_code: string;
  sku_id: string;
  sku_name: string;
  sku_status: InventoryStatus;
  version: number;
}

interface LedgerItem {
  ledger_id: string;
  ledger_type: LedgerType;
  locked_after: number;
  locked_before: number;
  locked_change: number;
  occurred_at: string;
  physical_after: number;
  physical_before: number;
  physical_change: number;
  reason: string;
}

interface RecordedRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  method: string;
  path: string;
  search: string;
}

interface ListFailure {
  code?: string;
  message?: string;
  status: number;
}

interface PreviewFact {
  confirmationHash: string;
  input: { physical_delta: number; reason: string };
  skuId: string;
  token: string;
  version: number;
}

interface UploadIntentFact {
  mimeType: string;
  purpose: string;
  sha256: string;
  size: number;
}

function banner(overrides: Partial<Banner> = {}): Banner {
  return {
    banner_id: 'banner-draft',
    ends_at: '2099-09-30T15:59:59.000Z',
    file_id: 'banner-file-draft',
    image_url: 'https://assets.example.test/banner-file-draft.png',
    sort_order: 20,
    starts_at: '2026-08-24T16:00:00.000Z',
    status: 'DRAFT',
    target_id: 'product-active',
    target_type: 'PRODUCT',
    target_url: null,
    title: '晨间清洁上新',
    version: 1,
    ...overrides,
  };
}

function inventory(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    active_reservation_qty: 10,
    available_qty: 276,
    locked_qty: 10,
    physical_qty: 286,
    product_name: '白茶洗衣液',
    sku_code: 'CLEAN-120',
    sku_id: 'inventory-active',
    sku_name: '500ml 标准装',
    sku_status: 'ACTIVE',
    version: 4,
    ...overrides,
  };
}

function defaultBanners(): Banner[] {
  return [
    banner(),
    banner({
      banner_id: 'banner-active',
      ends_at: null,
      file_id: 'banner-file-active',
      image_url: 'https://assets.example.test/banner-file-active.png',
      sort_order: 10,
      starts_at: null,
      status: 'ACTIVE',
      target_id: 'category-active',
      target_type: 'CATEGORY',
      title: '家庭清洁专区',
      version: 3,
    }),
    banner({
      banner_id: 'banner-archived',
      ends_at: null,
      file_id: 'banner-file-archived',
      image_url: 'https://assets.example.test/banner-file-archived.png',
      sort_order: 30,
      starts_at: null,
      status: 'ARCHIVED',
      target_id: null,
      target_type: 'NONE',
      title: '历史活动',
      version: 2,
    }),
  ];
}

function defaultInventory(): InventoryItem[] {
  const items = [
    inventory(),
    inventory({
      active_reservation_qty: 1,
      available_qty: 0,
      locked_qty: 1,
      physical_qty: 1,
      product_name: '清透防晒乳',
      sku_code: 'SUN-050',
      sku_id: 'inventory-insufficient',
      sku_name: '50ml',
      sku_status: 'INACTIVE',
      version: 2,
    }),
    inventory({
      active_reservation_qty: 0,
      available_qty: 7,
      locked_qty: 0,
      physical_qty: 7,
      product_name: '旧版家清套装',
      sku_code: 'HOME-OLD',
      sku_id: 'inventory-archived',
      sku_name: '归档规格',
      sku_status: 'ARCHIVED',
      version: 3,
    }),
  ];
  for (let index = 1; index <= 21; index += 1) {
    items.push(inventory({
      active_reservation_qty: 0,
      available_qty: index,
      locked_qty: 0,
      physical_qty: index,
      product_name: `分页库存商品 ${String(index).padStart(2, '0')}`,
      sku_code: `PAGE-SKU-${String(index).padStart(2, '0')}`,
      sku_id: `inventory-page-${String(index).padStart(2, '0')}`,
      sku_name: `分页规格 ${index}`,
      sku_status: index % 2 ? 'ACTIVE' : 'INACTIVE',
      version: 1,
    }));
  }
  return items;
}

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: requestId };
}

function failure(code: string, message: string) {
  return { code, message, request_id: requestId };
}

async function json(
  route: Route,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store, private', ...headers },
    status,
  });
}

function session() {
  return {
    access_token: accessToken,
    account_id: '01J5ADMINACCOUNT000000000000',
    assurance: 'MFA',
    expires_at: '2099-08-25T10:00:00.000Z',
    mfa_required: false,
    refresh_token: refreshToken,
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    session_id: '01J5ADMINSESSION000000000000',
  } as const;
}

class MockB5Backend {
  readonly banners: Banner[];
  readonly inventory: InventoryItem[];
  readonly ledgers = new Map<string, LedgerItem[]>();
  readonly requests: RecordedRequest[] = [];
  readonly uploadedBodies: Buffer[] = [];
  bannerListDelayMs = 0;
  inventoryListDelayMs = 0;
  nextBannerCommandFailure: ListFailure | null = null;
  nextBannerListFailure: ListFailure | null = null;
  nextBannerCreateFailure: ListFailure | null = null;
  nextInventoryListFailure: ListFailure | null = null;
  nextBannerEditorFailure: ListFailure | null = null;
  nextBannerConflictId: string | null = null;
  nextInventoryConfirmFailure: ListFailure | null = null;
  nextInventoryPreviewFailure: ListFailure | null = null;
  expireNextPath: string | null = null;
  refreshRequests = 0;

  private fileSequence = 0;
  private previewSequence = 0;
  private ledgerSequence = 0;
  private refreshed = false;
  private readonly uploadIntents = new Map<string, UploadIntentFact>();
  private readonly previews = new Map<string, PreviewFact>();

  constructor(options: { banners?: Banner[]; inventory?: InventoryItem[] } = {}) {
    this.banners = structuredClone(options.banners ?? defaultBanners());
    this.inventory = structuredClone(options.inventory ?? defaultInventory());
    for (const item of this.inventory) this.ledgers.set(item.sku_id, []);
    this.ledgers.set('inventory-archived', [{
      ledger_id: 'inventory-ledger-archived',
      ledger_type: 'ORDER_RELEASE',
      locked_after: 0,
      locked_before: 2,
      locked_change: -2,
      occurred_at: '2026-08-20T08:00:00.000Z',
      physical_after: 7,
      physical_before: 7,
      physical_change: 0,
      reason: '历史订单预占释放',
    }]);
  }

  count(path: RegExp | string, method?: string): number {
    return this.requests.filter((request) =>
      (typeof path === 'string' ? request.path === path : path.test(request.path)) &&
      (!method || request.method === method)).length;
  }

  matching(path: RegExp | string, method?: string): RecordedRequest[] {
    return this.requests.filter((request) =>
      (typeof path === 'string' ? request.path === path : path.test(request.path)) &&
      (!method || request.method === method));
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
        expect(request.headers()['x-upload-contract']).toBe('banner-v1');
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
        await json(route, 200, success({
          assurance: 'PASSWORD_ONLY',
          challenge_id: 'b5-login-challenge',
          expires_at: '2099-08-25T09:05:00.000Z',
          mfa_required: true,
          next_action: 'VERIFY_TOTP',
          pre_auth_token: preauthToken,
        }));
        return;
      }
      if (path === '/api/v1/admin/auth/mfa/challenges/b5-login-challenge/verify') {
        expect(request.headers().authorization).toBe(`Bearer ${preauthToken}`);
        await json(route, 200, success(session()));
        return;
      }
      if (path === '/api/v1/admin/auth/refresh') {
        this.refreshRequests += 1;
        expect(request.postDataJSON()).toEqual({
          refresh_token: this.refreshed ? rotatedRefreshToken : refreshToken,
        });
        expect(request.headers()['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
        this.refreshed = true;
        await json(route, 200, success({
          ...session(),
          access_token: rotatedAccessToken,
          refresh_token: rotatedRefreshToken,
        }));
        return;
      }

      const expectedToken = this.refreshed ? rotatedAccessToken : accessToken;
      expect(request.headers().authorization).toBe(`Bearer ${expectedToken}`);
      if (this.expireNextPath === path) {
        this.expireNextPath = null;
        await json(route, 401, failure('AUTH_EXPIRED', 'expired internal access token'));
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
      if (path === '/api/v1/admin/products' && request.method() === 'GET') {
        await this.handleProductOptions(route, url.searchParams);
        return;
      }
      if (path === '/api/v1/admin/categories' && request.method() === 'GET') {
        await this.handleCategoryOptions(route);
        return;
      }
      if (path === '/api/v1/admin/brands' && request.method() === 'GET') {
        await this.handleBrandOptions(route);
        return;
      }
      if (path === '/api/v1/admin/banners') {
        if (request.method() === 'GET') await this.handleBannerList(route, url.searchParams);
        else if (request.method() === 'POST') await this.handleBannerCreate(route);
        else await json(route, 405, failure('METHOD_NOT_ALLOWED', 'method not allowed'));
        return;
      }
      const restoreMatch = path.match(/^\/api\/v1\/admin\/banners\/([^/]+)\/restore$/);
      if (restoreMatch && request.method() === 'POST') {
        await this.handleBannerRestore(route, restoreMatch[1] ?? 'missing');
        return;
      }
      const bannerMatch = path.match(/^\/api\/v1\/admin\/banners\/([^/]+)$/);
      if (bannerMatch) {
        await this.handleBannerWrite(route, bannerMatch[1] ?? 'missing');
        return;
      }
      if (path === '/api/v1/admin/inventory' && request.method() === 'GET') {
        await this.handleInventoryList(route, url.searchParams);
        return;
      }
      const previewMatch = path.match(/^\/api\/v1\/admin\/inventory\/([^/]+)\/adjustment-preview$/);
      if (previewMatch && request.method() === 'POST') {
        await this.handleInventoryPreview(route, previewMatch[1] ?? 'missing');
        return;
      }
      const adjustmentMatch = path.match(/^\/api\/v1\/admin\/inventory\/([^/]+)\/adjustments$/);
      if (adjustmentMatch && request.method() === 'POST') {
        await this.handleInventoryConfirm(route, adjustmentMatch[1] ?? 'missing');
        return;
      }
      const ledgerMatch = path.match(/^\/api\/v1\/admin\/inventory\/([^/]+)\/ledger$/);
      if (ledgerMatch && request.method() === 'GET') {
        await this.handleLedger(route, ledgerMatch[1] ?? 'missing', url.searchParams);
        return;
      }
      await json(route, 404, failure('NOT_FOUND', `No mock for ${request.method()} ${path}`));
    });
  }

  private record(route: Route, body: Record<string, unknown> = {}): RecordedRequest {
    const request = route.request();
    const url = new URL(request.url());
    const recorded = {
      body,
      headers: request.headers(),
      method: request.method(),
      path: url.pathname,
      search: url.search,
    };
    this.requests.push(recorded);
    return recorded;
  }

  private assertWriteHeaders(route: Route, withVersion: boolean): void {
    const headers = route.request().headers();
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    if (withVersion) expect(headers['if-match']).toMatch(/^"[1-9][0-9]*"$/);
  }

  private async handleUploadIntent(route: Route): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, body);
    expect(body.purpose).toBe('BANNER');
    expect(body.mime_type).toBe('image/png');
    expect(body.size).toBe(pngBytes.byteLength);
    expect(body.sha256).toBe(createHash('sha256').update(pngBytes).digest('hex'));
    const fileId = `banner-upload-${++this.fileSequence}`;
    this.uploadIntents.set(fileId, {
      mimeType: String(body.mime_type),
      purpose: String(body.purpose),
      sha256: String(body.sha256),
      size: Number(body.size),
    });
    await json(route, 201, success({
      expires_at: '2099-08-25T09:15:00.000Z',
      file_id: fileId,
      object_key: `staging/${fileId}`,
      purpose: 'BANNER',
      status: 'PENDING',
      upload_headers: [
        { name: 'Content-Type', value: 'image/png' },
        { name: 'x-upload-contract', value: 'banner-v1' },
      ],
      upload_url: `https://uploads.example.test/${fileId}`,
    }));
  }

  private async handleUploadComplete(route: Route, fileId: string): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, body);
    const intent = this.uploadIntents.get(fileId);
    expect(intent).toBeDefined();
    expect(body).toEqual({ sha256: intent?.sha256, size: intent?.size });
    await json(route, 200, success({
      completed_at: '2026-08-25T09:00:00.000Z',
      file_id: fileId,
      public_url: `https://assets.example.test/${fileId}.png`,
      purpose: intent?.purpose,
      status: 'READY',
    }));
  }

  private async handleProductOptions(route: Route, query: URLSearchParams): Promise<void> {
    this.record(route);
    expect(query.get('status')).toBe('ACTIVE');
    await json(route, 200, success({
      items: [{
        inventory: { active_sku_count: 1, available_qty: 14, locked_qty: 4, physical_qty: 18, sku_count: 1 },
        minimum_active_price: '39.90',
        primary_image_url: 'https://assets.example.test/product-active.png',
        product: {
          brand_id: 'brand-active',
          category_id: 'category-active',
          description: null,
          name: '白茶洗衣液',
          product_id: 'product-active',
          published_at: '2026-08-20T09:00:00.000Z',
          spu_code: 'SPU-CLEAN-001',
          status: 'ACTIVE',
          version: 3,
        },
      }],
      pagination: { page: 1, page_size: 100, total: 1 },
    }));
  }

  private async handleCategoryOptions(route: Route): Promise<void> {
    this.record(route);
    await json(route, 200, success({
      items: [{
        category_id: 'category-active',
        icon_file_id: null,
        icon_url: null,
        name: '家庭清洁',
        sort_order: 10,
        status: 'ACTIVE',
        version: 2,
      }],
      pagination: { page: 1, page_size: 100, total: 1 },
    }));
  }

  private async handleBrandOptions(route: Route): Promise<void> {
    this.record(route);
    await json(route, 200, success({
      items: [{
        brand_id: 'brand-active',
        description: null,
        logo_file_id: null,
        logo_url: null,
        name: '青序生活',
        sort_order: 10,
        status: 'ACTIVE',
        version: 2,
      }],
      pagination: { page: 1, page_size: 100, total: 1 },
    }));
  }

  private async handleBannerList(route: Route, query: URLSearchParams): Promise<void> {
    this.record(route);
    if (this.bannerListDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.bannerListDelayMs));
    }
    if (this.nextBannerListFailure) {
      const current = this.nextBannerListFailure;
      this.nextBannerListFailure = null;
      await json(route, current.status, failure(
        current.code ?? 'INTERNAL_ERROR',
        current.message ?? 'internal Banner database detail',
      ));
      return;
    }
    const status = query.get('status') as BannerStatus | null;
    const keyword = query.get('keyword')?.toLocaleLowerCase('zh-CN') ?? '';
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('page_size') ?? 20);
    const filtered = this.banners
      .filter((item) => status ? item.status === status : item.status !== 'ARCHIVED')
      .filter((item) => !keyword || item.title.toLocaleLowerCase('zh-CN').includes(keyword))
      .sort((left, right) => left.sort_order - right.sort_order || left.banner_id.localeCompare(right.banner_id));
    const start = (page - 1) * pageSize;
    await json(route, 200, success({
      items: filtered.slice(start, start + pageSize),
      pagination: { page, page_size: pageSize, total: filtered.length },
    }));
  }

  private async handleBannerCreate(route: Route): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, body);
    expect(body.initial_status).toBe('DRAFT');
    if (this.nextBannerCreateFailure) {
      const current = this.nextBannerCreateFailure;
      this.nextBannerCreateFailure = null;
      await json(route, current.status, failure(
        current.code ?? 'INTERNAL_ERROR',
        current.message ?? 'internal Banner create transaction detail',
      ));
      return;
    }
    const item = this.bannerFromBody(body, {
      banner_id: `banner-created-${this.banners.length + 1}`,
      status: 'DRAFT',
      version: 1,
    });
    this.banners.push(item);
    await json(route, 201, success(item));
  }

  private async handleBannerWrite(route: Route, bannerId: string): Promise<void> {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, body);
    const item = this.banners.find((candidate) => candidate.banner_id === bannerId);
    if (!item) {
      await json(route, 404, failure('RESOURCE_NOT_FOUND', 'internal missing Banner id'));
      return;
    }
    expect(route.request().headers()['if-match']).toBe(`"${item.version}"`);
    if (this.nextBannerConflictId === bannerId) {
      this.nextBannerConflictId = null;
      item.version += 1;
      await json(route, 409, failure('RESOURCE_VERSION_CONFLICT', 'internal stale Banner fields'));
      return;
    }

    const editorWrite = route.request().method() === 'PATCH' && typeof body.action !== 'string';
    const nextFailure = editorWrite ? this.nextBannerEditorFailure : this.nextBannerCommandFailure;
    if (nextFailure) {
      if (editorWrite) this.nextBannerEditorFailure = null;
      else this.nextBannerCommandFailure = null;
      await json(route, nextFailure.status, failure(
        nextFailure.code ?? 'INTERNAL_ERROR',
        nextFailure.message ?? 'internal Banner write transaction detail',
      ));
      return;
    }

    if (route.request().method() === 'DELETE') {
      expect(Object.keys(body)).toEqual(['reason']);
      expect(String(body.reason).length).toBeGreaterThanOrEqual(2);
      if (item.status === 'ACTIVE') {
        await json(route, 409, failure('STATE_CONFLICT', 'active Banner cannot be archived'));
        return;
      }
      item.status = 'ARCHIVED';
      item.version += 1;
      await json(route, 200, success(item));
      return;
    }
    expect(route.request().method()).toBe('PATCH');
    if (typeof body.action === 'string') {
      expect(Object.keys(body)).toEqual(['action']);
      item.status = body.action === 'ACTIVATE' ? 'ACTIVE' : 'INACTIVE';
      item.version += 1;
      await json(route, 200, success(item));
      return;
    }
    Object.assign(item, this.bannerFromBody(body, item), { version: item.version + 1 });
    await json(route, 200, success(item));
  }

  private async handleBannerRestore(route: Route, bannerId: string): Promise<void> {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, body);
    const item = this.banners.find((candidate) => candidate.banner_id === bannerId);
    if (!item) {
      await json(route, 404, failure('RESOURCE_NOT_FOUND', 'internal missing Banner id'));
      return;
    }
    expect(route.request().headers()['if-match']).toBe(`"${item.version}"`);
    expect(body).toEqual({ reason: String(body.reason) });
    item.status = 'DRAFT';
    item.version += 1;
    await json(route, 200, success(item));
  }

  private bannerFromBody(
    body: Record<string, unknown>,
    base: Pick<Banner, 'banner_id' | 'status' | 'version'> & Partial<Banner>,
  ): Banner {
    const targetType = String(body.target_type) as BannerTargetType;
    return {
      banner_id: base.banner_id,
      ends_at: body.ends_at as string | null,
      file_id: String(body.file_id),
      image_url: `https://assets.example.test/${String(body.file_id)}.png`,
      sort_order: Number(body.sort_order),
      starts_at: body.starts_at as string | null,
      status: base.status,
      target_id: targetType === 'PRODUCT' || targetType === 'CATEGORY' ? String(body.target_id) : null,
      target_type: targetType,
      target_url: targetType === 'URL' ? String(body.target_url) : null,
      title: String(body.title),
      version: base.version,
    };
  }

  private async handleInventoryList(route: Route, query: URLSearchParams): Promise<void> {
    this.record(route);
    if (this.inventoryListDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.inventoryListDelayMs));
    }
    if (this.nextInventoryListFailure) {
      const current = this.nextInventoryListFailure;
      this.nextInventoryListFailure = null;
      await json(route, current.status, failure(
        current.code ?? 'INTERNAL_ERROR',
        current.message ?? 'internal inventory SQL detail',
      ));
      return;
    }
    const keyword = query.get('keyword')?.toLocaleLowerCase('zh-CN') ?? '';
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('page_size') ?? 20);
    const filtered = this.inventory
      .filter((item) => !keyword || [item.product_name, item.sku_name, item.sku_code]
        .some((value) => value.toLocaleLowerCase('zh-CN').includes(keyword)))
      .sort((left, right) => left.product_name.localeCompare(right.product_name, 'zh-CN') ||
        left.sku_id.localeCompare(right.sku_id));
    const start = (page - 1) * pageSize;
    await json(route, 200, success({
      items: filtered.slice(start, start + pageSize),
      pagination: { page, page_size: pageSize, total: filtered.length },
    }));
  }

  private async handleInventoryPreview(route: Route, skuId: string): Promise<void> {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, body);
    if (this.nextInventoryPreviewFailure) {
      const current = this.nextInventoryPreviewFailure;
      this.nextInventoryPreviewFailure = null;
      await json(route, current.status, failure(
        current.code ?? 'INTERNAL_ERROR',
        current.message ?? 'internal preview database detail',
      ));
      return;
    }
    const item = this.inventory.find((candidate) => candidate.sku_id === skuId);
    if (!item) {
      await json(route, 404, failure('RESOURCE_NOT_FOUND', 'internal missing SKU'));
      return;
    }
    const physicalDelta = Number(body.physical_delta);
    const physicalAfter = BigInt(item.physical_qty) + BigInt(physicalDelta);
    if (physicalAfter < -2_147_483_648n || physicalAfter > 2_147_483_647n) {
      await json(route, 422, failure('INVENTORY_QUANTITY_OUT_OF_RANGE', 'internal integer overflow'));
      return;
    }
    const token = `inventory-preview-token-${++this.previewSequence}`;
    const confirmationHash = String(this.previewSequence).padStart(64, 'a').slice(-64);
    this.previews.set(token, {
      confirmationHash,
      input: { physical_delta: physicalDelta, reason: String(body.reason) },
      skuId,
      token,
      version: item.version,
    });
    const nextPhysical = Number(physicalAfter);
    await json(route, 200, success({
      confirmation_hash: confirmationHash,
      expires_at: '2099-08-25T10:01:00.000Z',
      impact: {
        affected_count: 1,
        available_after: nextPhysical - item.locked_qty,
        available_before: item.available_qty,
        locked_after: item.locked_qty,
        locked_before: item.locked_qty,
        physical_after: nextPhysical,
        physical_before: item.physical_qty,
        warnings: nextPhysical < item.locked_qty ? ['STOCK_INSUFFICIENT'] : [],
      },
      preview_token: token,
      resource_etag: `"${item.version}"`,
    }));
  }

  private async handleInventoryConfirm(route: Route, skuId: string): Promise<void> {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, body);
    const item = this.inventory.find((candidate) => candidate.sku_id === skuId);
    const preview = this.previews.get(String(body.preview_token));
    expect(item).toBeDefined();
    expect(preview).toBeDefined();
    if (!item || !preview) return;
    expect(route.request().headers()['if-match']).toBe(`"${preview.version}"`);
    expect(body).toEqual({
      confirmation_hash: preview.confirmationHash,
      physical_delta: preview.input.physical_delta,
      preview_token: preview.token,
      reason: preview.input.reason,
    });
    if (this.nextInventoryConfirmFailure) {
      const current = this.nextInventoryConfirmFailure;
      this.nextInventoryConfirmFailure = null;
      if (current.status === 409) item.version += 1;
      await json(route, current.status, failure(
        current.code ?? 'INTERNAL_ERROR',
        current.message ?? 'internal inventory command detail',
      ));
      return;
    }
    const physicalAfter = item.physical_qty + preview.input.physical_delta;
    if (physicalAfter < item.locked_qty) {
      await json(route, 422, failure('STOCK_INSUFFICIENT', 'internal locked reservation ids'));
      return;
    }
    const physicalBefore = item.physical_qty;
    item.physical_qty = physicalAfter;
    item.available_qty = physicalAfter - item.locked_qty;
    item.version += 1;
    const ledger: LedgerItem = {
      ledger_id: `inventory-ledger-${++this.ledgerSequence}`,
      ledger_type: preview.input.physical_delta > 0 ? 'MANUAL_INCREASE' : 'MANUAL_DECREASE',
      locked_after: item.locked_qty,
      locked_before: item.locked_qty,
      locked_change: 0,
      occurred_at: '2026-08-25T10:00:00.000Z',
      physical_after: physicalAfter,
      physical_before: physicalBefore,
      physical_change: preview.input.physical_delta,
      reason: preview.input.reason,
    };
    this.ledgers.get(skuId)?.unshift(ledger);
    await json(route, 200, success({
      occurred_at: ledger.occurred_at,
      resource_id: skuId,
      resource_type: 'inventory',
      status: 'SUCCEEDED',
      version: item.version,
    }));
  }

  private async handleLedger(route: Route, skuId: string, query: URLSearchParams): Promise<void> {
    this.record(route);
    const page = Number(query.get('page') ?? 1);
    const pageSize = Number(query.get('page_size') ?? 20);
    const type = query.get('ledger_type');
    const filtered = (this.ledgers.get(skuId) ?? [])
      .filter((item) => !type || item.ledger_type === type)
      .sort((left, right) => right.occurred_at.localeCompare(left.occurred_at) ||
        right.ledger_id.localeCompare(left.ledger_id));
    const start = (page - 1) * pageSize;
    await json(route, 200, success({
      items: filtered.slice(start, start + pageSize),
      pagination: { page, page_size: pageSize, total: filtered.length },
    }));
  }
}

async function login(page: Page, backend: MockB5Backend): Promise<void> {
  await backend.install(page);
  await page.goto(`${adminBaseUrl}/login`);
  await page.getByLabel('超级管理员账号').fill('admin.operator');
  await page.getByLabel('登录密码').fill('RuntimePassword');
  await page.getByRole('button', { name: '登录总部管理后台' }).click();
  await page.getByLabel('动态验证码').fill('123456');
  await page.getByRole('button', { name: '完成验证' }).click();
  await expect(page).toHaveURL(/\/catalog\/brands$/);
}

async function openBanners(page: Page, backend: MockB5Backend): Promise<void> {
  await login(page, backend);
  await page.locator('a[href="/content/banners"]').click();
  await expect(page).toHaveURL(/\/content\/banners$/);
  await expect(page.getByTestId('banner-list-page')).toBeVisible();
}

async function openInventory(page: Page, backend: MockB5Backend): Promise<void> {
  await login(page, backend);
  await page.locator('a[href="/catalog/inventory"]').click();
  await expect(page).toHaveURL(/\/catalog\/inventory$/);
  await expect(page.getByTestId('inventory-page')).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewportWidth: window.innerWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
}

async function selectElementPlusOption(page: Page, label: string, option: string): Promise<void> {
  const combobox = page.getByRole('combobox', { name: label, exact: true });
  const select = combobox.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " el-select ")][1]',
  );
  await expect(combobox).toBeVisible();
  await select.click();
  const choice = page.getByRole('option', { name: option, exact: true });
  await expect(choice).toBeVisible();
  await choice.click();
}

async function setBannerDate(page: Page, label: string, value: string): Promise<void> {
  const input = page.getByLabel(label, { exact: true });
  await input.fill(value);
  await input.press('Tab');
}

async function uploadBannerImage(page: Page): Promise<void> {
  await page.getByTestId('banner-asset-upload').locator('input[type="file"]').setInputFiles({
    buffer: pngBytes,
    mimeType: 'image/png',
    name: 'campaign-banner.png',
  });
}

async function filterInventory(page: Page, keyword: string): Promise<void> {
  await page.getByLabel('库存关键词').fill(keyword);
  await page.getByTestId('inventory-apply-filters').click();
}

async function fillAdjustment(page: Page, delta: string, reason: string): Promise<void> {
  await page.getByLabel('实物库存变化量').fill(delta);
  await page.getByLabel('调整原因').fill(reason);
}

function expectUuidKeys(requests: RecordedRequest[]): void {
  for (const request of requests) {
    expect(request.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  }
}

async function expectNoCapabilityStorage(page: Page, values: string[]): Promise<void> {
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const value of values) expect(storage).not.toContain(value);
  expect(storage).not.toContain('uploads.example.test');
}

test.describe('B5.3 admin Banner and Inventory management', () => {
  test('loads both navigation entries and keeps loading, 500, 403, and empty states recoverable', async ({ page }, testInfo) => {
    const backend = new MockB5Backend();
    backend.bannerListDelayMs = 600;
    backend.nextBannerListFailure = { message: 'internal Banner relation detail', status: 500 };
    await openBanners(page, backend);

    await expect(page.getByTestId('banner-list-loading')).toBeVisible();
    await expect(page.getByTestId('banner-list-error')).toBeVisible();
    await expect(page.getByText('internal Banner relation detail')).toHaveCount(0);
    backend.bannerListDelayMs = 0;
    await page.getByTestId('banner-list-error').getByRole('button', { name: '重试' }).click();
    await expect(page.getByTestId('banner-card-banner-active')).toBeVisible();
    await page.getByLabel('Banner 关键词').fill('不存在的 Banner');
    await page.getByRole('button', { name: '查询 Banner' }).click();
    await expect(page.getByTestId('banner-list-empty')).toBeVisible();

    backend.inventoryListDelayMs = 600;
    backend.nextInventoryListFailure = {
      code: 'FORBIDDEN',
      message: 'internal inventory permission names',
      status: 403,
    };
    await page.evaluate(() => {
      document.body.style.minHeight = '3000px';
      window.scrollTo(0, 2000);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    await page.locator('a[href="/catalog/inventory"]').click();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.evaluate(() => {
      document.body.style.minHeight = '';
    });
    await expect(page.getByTestId('inventory-loading')).toBeVisible();
    await expect(page.getByTestId('inventory-error')).toContainText('无权');
    await expect(page.getByText('internal inventory permission names')).toHaveCount(0);
    backend.inventory.splice(0);
    backend.inventoryListDelayMs = 0;
    await page.getByTestId('inventory-error').getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('inventory-empty')).toBeVisible();

    await expect(page.locator('a[href="/content/banners"]')).toBeVisible();
    await expect(page.locator('a[href="/catalog/inventory"]')).toBeVisible();
    await expect(page.getByRole('link', { name: '商品管理', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: '账户安全', exact: true })).toBeVisible();
    if (testInfo.project.name === 'mobile-390' || testInfo.project.name === 'web-1440') {
      await page.screenshot({ fullPage: true, path: testInfo.outputPath('b5-inventory-empty.png') });
    }
    await expectNoHorizontalOverflow(page);
  });

  test('creates and edits a sorted DRAFT Banner with BANNER upload, typed target, and Shanghai times', async ({ page }) => {
    const backend = new MockB5Backend();
    await openBanners(page, backend);
    const cards = page.getByTestId('banner-list').locator('.banner-card');
    await expect(cards.first()).toContainText('家庭清洁专区');

    await page.getByRole('button', { name: '新建 Banner' }).click();
    const editor = page.getByTestId('banner-editor-dialog');
    await expect(editor).toContainText('创建后固定为草稿');
    await editor.getByLabel('Banner 标题').fill('九月清洁焕新');
    await editor.getByLabel('Banner 展示顺序').fill('5');
    await uploadBannerImage(page);
    await expect.poll(() => backend.count(/\/api\/v1\/files\/[^/]+\/complete$/, 'POST')).toBe(1);
    await selectElementPlusOption(page, 'Banner 跳转类型', '商品');
    await selectElementPlusOption(page, 'Banner 跳转商品', '白茶洗衣液 · SPU-CLEAN-001');
    await setBannerDate(page, 'Banner 开始时间', '2026-09-01 08:00:00');
    await setBannerDate(page, 'Banner 结束时间', '2026-09-30 20:30:00');
    await editor.getByTestId('banner-editor-submit').dblclick();
    await expect(editor).toBeHidden();

    const creates = backend.matching('/api/v1/admin/banners', 'POST');
    expect(creates).toHaveLength(1);
    expect(creates[0]?.body).toEqual({
      ends_at: '2026-09-30T12:30:00.000Z',
      file_id: 'banner-upload-1',
      initial_status: 'DRAFT',
      sort_order: 5,
      starts_at: '2026-09-01T00:00:00.000Z',
      target_id: 'product-active',
      target_type: 'PRODUCT',
      title: '九月清洁焕新',
    });
    expectUuidKeys(creates);
    const createdCard = page.getByTestId('banner-card-banner-created-4');
    await expect(createdCard).toContainText('草稿');
    await expect(createdCard).toContainText('商品 · product-active');

    await createdCard.getByRole('button', { name: '编辑资料' }).click();
    const updateEditor = page.getByTestId('banner-editor-dialog');
    await updateEditor.getByLabel('Banner 标题').fill('九月家清焕新');
    await selectElementPlusOption(page, 'Banner 跳转类型', '一级分类');
    await selectElementPlusOption(page, 'Banner 跳转分类', '家庭清洁');
    await updateEditor.getByTestId('banner-editor-submit').click();
    await expect(updateEditor).toBeHidden();

    const patches = backend.matching('/api/v1/admin/banners/banner-created-4', 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0]?.headers['if-match']).toBe('"1"');
    expect(patches[0]?.body).toEqual({
      ends_at: '2026-09-30T12:30:00.000Z',
      file_id: 'banner-upload-1',
      sort_order: 5,
      starts_at: '2026-09-01T00:00:00.000Z',
      target_id: 'category-active',
      target_type: 'CATEGORY',
      title: '九月家清焕新',
    });
    expectUuidKeys(patches);
    await expect(page.getByTestId('banner-list').locator('.banner-card').first()).toContainText('九月家清焕新');

    const intents = backend.matching('/api/v1/files/upload-intents', 'POST');
    const completes = backend.matching(/\/api\/v1\/files\/[^/]+\/complete$/, 'POST');
    expect(intents).toHaveLength(1);
    expect(intents[0]?.body.purpose).toBe('BANNER');
    expect(backend.uploadedBodies).toHaveLength(1);
    expect(backend.uploadedBodies[0]?.equals(pngBytes)).toBe(true);
    expectUuidKeys([...intents, ...completes]);
    await expectNoCapabilityStorage(page, []);
    await expectNoHorizontalOverflow(page);
  });

  test('separates Banner status changes from DELETE archive and restores archived data to DRAFT', async ({ page }) => {
    const backend = new MockB5Backend();
    await openBanners(page, backend);
    const draftCard = page.getByTestId('banner-card-banner-draft');
    const activeCard = page.getByTestId('banner-card-banner-active');
    await expect(activeCard.getByRole('button', { name: '归档' })).toHaveCount(0);

    await draftCard.getByRole('button', { name: '启用' }).click();
    let commandDialog = page.getByTestId('banner-command-dialog');
    await expect(commandDialog.getByLabel('归档原因')).toHaveCount(0);
    await commandDialog.getByTestId('banner-command-submit').dblclick();
    await expect(draftCard).toContainText('已启用');
    await expect(draftCard.getByRole('button', { name: '归档' })).toHaveCount(0);

    await draftCard.getByRole('button', { name: '停用' }).click();
    commandDialog = page.getByTestId('banner-command-dialog');
    await commandDialog.getByTestId('banner-command-submit').click();
    await expect(draftCard).toContainText('已停用');
    await draftCard.getByRole('button', { name: '归档' }).click();
    commandDialog = page.getByTestId('banner-command-dialog');
    await commandDialog.getByLabel('归档原因').fill('本轮投放已经结束');
    await commandDialog.getByTestId('banner-command-submit').click();
    await expect(draftCard).toHaveCount(0);

    await selectElementPlusOption(page, 'Banner 状态筛选', '已归档');
    await page.getByRole('button', { name: '查询 Banner' }).click();
    await expect(page.getByTestId('banner-card-banner-draft')).toBeVisible();
    await page.getByTestId('banner-card-banner-draft').getByRole('button', { name: '恢复为草稿' }).click();
    commandDialog = page.getByTestId('banner-command-dialog');
    await commandDialog.getByLabel('恢复原因').fill('资料已重新核对');
    await commandDialog.getByTestId('banner-command-submit').click();
    await expect(page.getByTestId('banner-card-banner-draft')).toHaveCount(0);
    await selectElementPlusOption(page, 'Banner 状态筛选', '草稿');
    await page.getByRole('button', { name: '查询 Banner' }).click();
    await expect(page.getByTestId('banner-card-banner-draft')).toContainText('草稿');

    const writes = backend.matching('/api/v1/admin/banners/banner-draft');
    expect(writes.map((request) => request.method)).toEqual(['PATCH', 'PATCH', 'DELETE']);
    expect(writes.map((request) => request.body)).toEqual([
      { action: 'ACTIVATE' },
      { action: 'DEACTIVATE' },
      { reason: '本轮投放已经结束' },
    ]);
    expect(writes.map((request) => request.headers['if-match'])).toEqual(['"1"', '"2"', '"3"']);
    const restores = backend.matching('/api/v1/admin/banners/banner-draft/restore', 'POST');
    expect(restores).toHaveLength(1);
    expect(restores[0]?.body).toEqual({ reason: '资料已重新核对' });
    expect(restores[0]?.headers['if-match']).toBe('"4"');
    expectUuidKeys([...writes, ...restores]);
    await expectNoHorizontalOverflow(page);
  });

  test('refreshes Banner auth once and discards a conflicted command before a fresh confirmation', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', '共享请求层与 Banner 409 回归只需一个桌面视口');
    const backend = new MockB5Backend();
    backend.expireNextPath = '/api/v1/admin/banners';
    await openBanners(page, backend);
    await expect(page.getByTestId('banner-card-banner-draft')).toBeVisible();
    expect(backend.refreshRequests).toBe(1);

    backend.nextBannerConflictId = 'banner-draft';
    await page.getByTestId('banner-card-banner-draft').getByRole('button', { name: '启用' }).click();
    await page.getByTestId('banner-command-submit').click();
    await expect(page.getByTestId('banner-command-dialog')).toBeHidden();
    await expect(page.getByText(/已刷新最新数据.*重新检查后确认/)).toBeVisible();
    const first = backend.matching('/api/v1/admin/banners/banner-draft', 'PATCH');
    expect(first).toHaveLength(1);
    expect(first[0]?.headers['if-match']).toBe('"1"');

    await page.getByTestId('banner-card-banner-draft').getByRole('button', { name: '启用' }).click();
    await page.getByTestId('banner-command-submit').click();
    await expect(page.getByTestId('banner-card-banner-draft')).toContainText('已启用');
    const writes = backend.matching('/api/v1/admin/banners/banner-draft', 'PATCH');
    expect(writes).toHaveLength(2);
    expect(writes[1]?.headers['if-match']).toBe('"2"');
    expect(writes[1]?.headers['idempotency-key']).not.toBe(writes[0]?.headers['idempotency-key']);
    expect(backend.refreshRequests).toBe(1);
    await expect(page.getByText('internal stale Banner fields')).toHaveCount(0);
    await expectNoCapabilityStorage(page, []);
  });

  test('replays an unknown Banner create with the same idempotency key while the editor stays locked', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', 'Banner 未知结果精确重放只需一个桌面视口');
    const backend = new MockB5Backend();
    await openBanners(page, backend);
    await page.getByRole('button', { name: '新建 Banner' }).click();
    const editor = page.getByTestId('banner-editor-dialog');
    const title = editor.getByLabel('Banner 标题');
    await title.fill('未知结果精确重放');
    await uploadBannerImage(page);
    await expect.poll(() => backend.count(/\/api\/v1\/files\/[^/]+\/complete$/, 'POST')).toBe(1);

    backend.nextBannerCreateFailure = {
      message: 'internal committed Banner id and transaction detail',
      status: 500,
    };
    await editor.getByTestId('banner-editor-submit').click();
    await expect(editor).toBeVisible();
    await expect(editor.getByText('保存结果尚未确认', { exact: true })).toBeVisible();
    await expect(editor.getByText(/服务暂时不可用，保存结果尚未确认/)).toBeVisible();
    await expect(page.getByText('internal committed Banner id and transaction detail')).toHaveCount(0);
    await expect(title).toHaveValue('未知结果精确重放');
    await expect(title).toBeDisabled();
    await expect(editor.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await expect(editor.getByRole('button', { name: 'Close this dialog' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('banner-editor-submit')).toContainText('重试确认保存');

    await editor.getByTestId('banner-editor-submit').click();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId('banner-card-banner-created-4')).toContainText('未知结果精确重放');
    const creates = backend.matching('/api/v1/admin/banners', 'POST');
    expect(creates).toHaveLength(2);
    expect(creates[1]?.body).toEqual(creates[0]?.body);
    expect(creates[1]?.headers['idempotency-key']).toBe(creates[0]?.headers['idempotency-key']);
    expect(backend.banners.filter((item) => item.title === '未知结果精确重放')).toHaveLength(1);
  });

  test('keeps an editable Banner STATE_CONFLICT in place without triggering version refresh', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', 'Banner 可修正状态冲突只需一个桌面视口');
    const backend = new MockB5Backend();
    await openBanners(page, backend);
    const listRequestsBefore = backend.count('/api/v1/admin/banners', 'GET');
    await page.getByTestId('banner-card-banner-draft').getByRole('button', { name: '编辑资料' }).click();
    const editor = page.getByTestId('banner-editor-dialog');
    const title = editor.getByLabel('Banner 标题');
    await title.fill('跳转目标已失效待修正');
    backend.nextBannerEditorFailure = {
      code: 'STATE_CONFLICT',
      message: 'internal inactive target and file relation detail',
      status: 409,
    };
    await editor.getByTestId('banner-editor-submit').click();

    await expect(editor).toBeVisible();
    await expect(title).toHaveValue('跳转目标已失效待修正');
    await expect(title).toBeEnabled();
    await expect(editor.getByRole('alert')).toContainText('Banner 图片、跳转目标或当前状态已不可用，请修正资料后重试');
    await expect(page.getByText('internal inactive target and file relation detail')).toHaveCount(0);
    await expect(page.getByText(/已刷新最新数据.*重新检查后确认/)).toHaveCount(0);
    expect(backend.count('/api/v1/admin/banners', 'GET')).toBe(listRequestsBefore);

    await title.fill('跳转目标已修正');
    await editor.getByTestId('banner-editor-submit').click();
    await expect(editor).toBeHidden();
    await expect(page.getByTestId('banner-card-banner-draft')).toContainText('跳转目标已修正');
    const updates = backend.matching('/api/v1/admin/banners/banner-draft', 'PATCH');
    expect(updates).toHaveLength(2);
    expect(updates.map((request) => request.headers['if-match'])).toEqual(['"1"', '"1"']);
    expect(updates[1]?.headers['idempotency-key']).not.toBe(updates[0]?.headers['idempotency-key']);
  });

  test('replays an unknown Banner archive with its reason and command locked to the original key', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', 'Banner 生命周期未知结果精确重放只需一个桌面视口');
    const backend = new MockB5Backend();
    await openBanners(page, backend);
    await page.getByTestId('banner-card-banner-draft').getByRole('button', { name: '归档' }).click();
    const dialog = page.getByTestId('banner-command-dialog');
    const reason = dialog.getByLabel('归档原因');
    await reason.fill('未知结果期间保留原始命令');
    backend.nextBannerCommandFailure = {
      message: 'internal archive audit and transaction detail',
      status: 500,
    };
    await dialog.getByTestId('banner-command-submit').click();

    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('操作结果尚未确认', { exact: true })).toBeVisible();
    await expect(dialog.getByText(/服务暂时不可用，操作结果尚未确认/)).toBeVisible();
    await expect(page.getByText('internal archive audit and transaction detail')).toHaveCount(0);
    await expect(reason).toHaveValue('未知结果期间保留原始命令');
    await expect(reason).toBeDisabled();
    await expect(dialog.getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Close this dialog' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('banner-command-submit')).toContainText('重试确认归档');
    expect(backend.banners.find((item) => item.banner_id === 'banner-draft')?.status).toBe('DRAFT');

    await dialog.getByTestId('banner-command-submit').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('banner-card-banner-draft')).toHaveCount(0);
    const archives = backend.matching('/api/v1/admin/banners/banner-draft', 'DELETE');
    expect(archives).toHaveLength(2);
    expect(archives[1]?.body).toEqual(archives[0]?.body);
    expect(archives.map((request) => request.headers['if-match'])).toEqual(['"1"', '"1"']);
    expect(archives[1]?.headers['idempotency-key']).toBe(archives[0]?.headers['idempotency-key']);
    expect(backend.banners.find((item) => item.banner_id === 'banner-draft')?.status).toBe('ARCHIVED');
  });

  test('filters and paginates inventory without subtracting reservations twice and keeps archived ledger readable', async ({ page }) => {
    const backend = new MockB5Backend();
    await openInventory(page, backend);
    await expect(page.getByTestId('inventory-table')).toBeVisible();
    const activeRow = page.getByTestId('inventory-row-inventory-active');
    await expect(activeRow).toContainText('286');
    await expect(activeRow).toContainText('10');
    await expect(activeRow).toContainText('276');
    await expect(activeRow).toContainText('286 - 10');
    await expect(page.getByText('可售库存 = 实物库存 - 锁定库存')).toBeVisible();

    await page.getByLabel('库存关键词').fill('CLEAN-120');
    await selectElementPlusOption(page, '库存分类筛选', '家庭清洁');
    await page.getByTestId('inventory-apply-filters').click();
    await expect(activeRow).toBeVisible();
    const filtered = backend.matching('/api/v1/admin/inventory', 'GET').at(-1);
    const filteredQuery = new URLSearchParams(filtered?.search);
    expect(filteredQuery.get('keyword')).toBe('CLEAN-120');
    expect(filteredQuery.get('category_id')).toBe('category-active');
    expect(filteredQuery.has('status')).toBe(false);

    await page.getByTestId('inventory-reset-filters').click();
    await page.locator('.inventory-pagination .el-pager li').filter({ hasText: '2' }).click();
    await expect.poll(() => new URLSearchParams(
      backend.matching('/api/v1/admin/inventory', 'GET').at(-1)?.search,
    ).get('page')).toBe('2');

    await filterInventory(page, 'HOME-OLD');
    const archivedRow = page.getByTestId('inventory-row-inventory-archived');
    await expect(archivedRow).toContainText('已归档');
    await expect(archivedRow).toContainText('只读');
    await expect(archivedRow.getByTestId('inventory-adjust-inventory-archived')).toHaveCount(0);
    await archivedRow.getByTestId('inventory-ledger-inventory-archived').click();
    const ledgerDialog = page.getByTestId('inventory-ledger-dialog');
    await expect(ledgerDialog).toContainText('订单释放');
    await expect(ledgerDialog).toContainText('历史订单预占释放');
    await selectElementPlusOption(page, '库存流水类型', '订单释放');
    await ledgerDialog.getByRole('button', { name: '查询', exact: true }).click();
    const ledgerQuery = new URLSearchParams(
      backend.matching(/\/inventory\/inventory-archived\/ledger$/, 'GET').at(-1)?.search,
    );
    expect(ledgerQuery.get('ledger_type')).toBe('ORDER_RELEASE');
    await expectNoHorizontalOverflow(page);
  });

  test('confirms one inventory adjustment with exact capability headers and appends one ledger row', async ({ page }) => {
    const backend = new MockB5Backend();
    await openInventory(page, backend);
    await filterInventory(page, 'CLEAN-120');
    await page.getByTestId('inventory-adjust-inventory-active').click();
    const dialog = page.getByTestId('inventory-adjustment-dialog');
    await fillAdjustment(page, '5', '盘点后补充实物库存');
    await dialog.getByTestId('inventory-preview-button').click();
    await expect(dialog.getByTestId('inventory-adjustment-preview')).toContainText('286 → 291');
    await expect(dialog.getByTestId('inventory-adjustment-preview')).toContainText('276 → 281');
    await dialog.getByTestId('inventory-confirm-button').dblclick();
    await expect(dialog).toBeHidden();

    const previews = backend.matching(/\/inventory\/inventory-active\/adjustment-preview$/, 'POST');
    const confirms = backend.matching(/\/inventory\/inventory-active\/adjustments$/, 'POST');
    expect(previews).toHaveLength(1);
    expect(previews[0]?.body).toEqual({ physical_delta: 5, reason: '盘点后补充实物库存' });
    expect(confirms).toHaveLength(1);
    expect(confirms[0]?.headers['if-match']).toBe('"4"');
    expect(confirms[0]?.body).toEqual({
      confirmation_hash: 'a'.repeat(63) + '1',
      physical_delta: 5,
      preview_token: 'inventory-preview-token-1',
      reason: '盘点后补充实物库存',
    });
    expectUuidKeys([...previews, ...confirms]);

    const changedRow = page.getByTestId('inventory-row-inventory-active');
    await expect(changedRow).toContainText('291');
    await expect(changedRow).toContainText('281');
    await expect(changedRow).toContainText('v5');
    await changedRow.getByTestId('inventory-ledger-inventory-active').click();
    const ledgerDialog = page.getByTestId('inventory-ledger-dialog');
    await expect(ledgerDialog).toContainText('人工增加');
    await expect(ledgerDialog).toContainText('盘点后补充实物库存');
    await expect(ledgerDialog).toContainText('286 → 291');
    expect(backend.ledgers.get('inventory-active')).toHaveLength(1);
    await expectNoCapabilityStorage(page, ['inventory-preview-token-1', 'a'.repeat(63) + '1']);
    await expectNoHorizontalOverflow(page);
  });

  test('handles warning 422, range 422, 409 invalidation, and opaque 500 retry without leaking capabilities', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', 'Inventory 错误与幂等重试矩阵只需一个桌面视口');
    const backend = new MockB5Backend();
    await openInventory(page, backend);
    await filterInventory(page, 'SUN-050');
    await page.getByTestId('inventory-adjust-inventory-insufficient').click();
    let dialog = page.getByTestId('inventory-adjustment-dialog');
    await fillAdjustment(page, '-1', '验证锁定库存阻断');
    await dialog.getByTestId('inventory-preview-button').click();
    await expect(dialog.getByTestId('inventory-adjustment-preview')).toContainText('确认将被阻断');
    await dialog.getByTestId('inventory-confirm-button').click();
    await expect(dialog.getByTestId('inventory-adjustment-error')).toHaveAttribute('data-error-code', 'STOCK_INSUFFICIENT');
    await expect(dialog.getByTestId('inventory-preview-button')).toBeVisible();
    expect(backend.inventory.find((item) => item.sku_id === 'inventory-insufficient')?.physical_qty).toBe(1);

    await fillAdjustment(page, '2147483647', '验证库存整数范围');
    await dialog.getByTestId('inventory-preview-button').click();
    await expect(dialog.getByTestId('inventory-adjustment-error')).toHaveAttribute(
      'data-error-code',
      'INVENTORY_QUANTITY_OUT_OF_RANGE',
    );
    await expect(page.getByText('internal integer overflow')).toHaveCount(0);
    await dialog.getByRole('button', { name: '取消' }).click();

    await filterInventory(page, 'CLEAN-120');
    await page.getByTestId('inventory-adjust-inventory-active').click();
    dialog = page.getByTestId('inventory-adjustment-dialog');
    await fillAdjustment(page, '1', '并发版本变化验证');
    await dialog.getByTestId('inventory-preview-button').click();
    backend.nextInventoryConfirmFailure = {
      code: 'RESOURCE_VERSION_CONFLICT',
      message: 'internal stale balance fields',
      status: 409,
    };
    await dialog.getByTestId('inventory-confirm-button').click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText(/已刷新最新库存.*重新预览后确认/)).toBeVisible();
    await expect(page.getByText('internal stale balance fields')).toHaveCount(0);
    expect(backend.inventory.find((item) => item.sku_id === 'inventory-active')?.physical_qty).toBe(286);

    await page.getByTestId('inventory-adjust-inventory-active').click();
    dialog = page.getByTestId('inventory-adjustment-dialog');
    await expect(dialog.getByTestId('inventory-confirm-button')).toHaveCount(0);
    await fillAdjustment(page, '1', '未知结果使用原键重试');
    backend.nextInventoryPreviewFailure = {
      message: 'internal preview query and balance detail',
      status: 500,
    };
    await dialog.getByTestId('inventory-preview-button').click();
    await expect(dialog.getByTestId('inventory-adjustment-error')).toContainText('影响预览未生成');
    await expect(page.getByText('internal preview query and balance detail')).toHaveCount(0);
    await expect(dialog.getByTestId('inventory-confirm-button')).toHaveCount(0);
    await dialog.getByTestId('inventory-preview-button').click();
    backend.nextInventoryConfirmFailure = {
      message: 'internal transaction and reservation ids',
      status: 500,
    };
    await dialog.getByTestId('inventory-confirm-button').click();
    await expect(dialog.getByTestId('inventory-adjustment-error')).toContainText('结果尚未确认');
    await expect(page.getByText('internal transaction and reservation ids')).toHaveCount(0);
    await expect(dialog.getByTestId('inventory-confirm-button')).toContainText('重试确认调整');
    await dialog.getByTestId('inventory-confirm-button').click();
    await expect(dialog).toBeHidden();

    const confirms = backend.matching(/\/inventory\/inventory-active\/adjustments$/, 'POST');
    expect(confirms).toHaveLength(3);
    expect(confirms[0]?.headers['if-match']).toBe('"4"');
    expect(confirms[1]?.headers['if-match']).toBe('"5"');
    expect(confirms[2]?.headers['idempotency-key']).toBe(confirms[1]?.headers['idempotency-key']);
    expect(confirms[2]?.headers['idempotency-key']).not.toBe(confirms[0]?.headers['idempotency-key']);
    expect(backend.ledgers.get('inventory-active')).toHaveLength(1);
    const capabilityValues = confirms.flatMap((request) => [
      String(request.body.preview_token),
      String(request.body.confirmation_hash),
    ]);
    await expectNoCapabilityStorage(page, capabilityValues);
  });
});
