import { createHash } from 'node:crypto';

import { expect, test, type Page, type Route } from '@playwright/test';

const adminBaseUrl = 'http://127.0.0.1:5175';
const accessToken = ['access', 'catalog', 'runtime'].join('-');
const refreshToken = ['refresh', 'catalog', 'runtime'].join('-');
const rotatedAccessToken = ['access', 'catalog', 'rotated'].join('-');
const rotatedRefreshToken = ['refresh', 'catalog', 'rotated'].join('-');
const preauthToken = ['preauth', 'catalog', 'runtime'].join('-');
const requestId = 'req_0123456789abcdef0123456789abcdef';
const pngBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nKsAAAAASUVORK5CYII=',
  'base64',
);

type CatalogStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
type LifecycleAction = 'ACTIVATE' | 'DEACTIVATE' | 'SOFT_DELETE';

interface Brand {
  brand_id: string;
  description: string | null;
  logo_file_id: string | null;
  logo_url: string | null;
  name: string;
  sort_order: number;
  status: CatalogStatus;
  version: number;
}

interface Category {
  category_id: string;
  icon_file_id: string | null;
  icon_url: string | null;
  name: string;
  sort_order: number;
  status: CatalogStatus;
  version: number;
}

type Entity = Brand | Category;
type Kind = 'brands' | 'categories';

interface RecordedRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  id: string | null;
  kind: Kind | 'files';
  method: string;
  path: string;
}

interface ListFailure {
  code?: string;
  message?: string;
  status: number;
}

interface MockBackendOptions {
  brands?: Brand[];
  categories?: Category[];
  dependencyIds?: string[];
  listDelayMs?: number;
}

function brand(overrides: Partial<Brand> = {}): Brand {
  return {
    brand_id: 'brand-draft',
    description: '清洁配方品牌',
    logo_file_id: null,
    logo_url: null,
    name: '白茶清润',
    sort_order: 10,
    status: 'DRAFT',
    version: 1,
    ...overrides,
  };
}

function category(overrides: Partial<Category> = {}): Category {
  return {
    category_id: 'category-active',
    icon_file_id: null,
    icon_url: null,
    name: '衣物清洁',
    sort_order: 20,
    status: 'ACTIVE',
    version: 3,
    ...overrides,
  };
}

function success(data: unknown) {
  return { code: 'OK', data, message: 'success', request_id: requestId };
}

function error(code: string, message: string) {
  return { code, message, request_id: requestId };
}

function entityId(entity: Entity): string {
  return 'brand_id' in entity ? entity.brand_id : entity.category_id;
}

async function json(route: Route, status: number, body: unknown, headers: Record<string, string> = {}) {
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
    expires_at: '2099-08-13T10:00:00.000Z',
    mfa_required: false,
    refresh_token: refreshToken,
    restriction: 'NONE',
    role: 'SUPER_ADMIN',
    session_id: '01J5ADMINSESSION000000000000',
  } as const;
}

class MockCatalogBackend {
  readonly brands: Brand[];
  readonly categories: Category[];
  readonly requests: RecordedRequest[] = [];
  readonly listQueries: Array<{ kind: Kind; search: string }> = [];
  readonly uploadedBodies: Buffer[] = [];
  readonly dependencyIds: Set<string>;
  listDelayMs: number;
  nextListFailure: Partial<Record<Kind, ListFailure>> = {};
  nextConfirmConflict = false;
  expireNextPath: string | null = null;
  refreshRequests = 0;

  private fileSequence = 0;
  private previewSequence = 0;
  private refreshed = false;
  private readonly uploadIntents = new Map<string, { mimeType: string; purpose: string; sha256: string; size: number }>();

  constructor(options: MockBackendOptions = {}) {
    this.brands = structuredClone(options.brands ?? [brand()]);
    this.categories = structuredClone(options.categories ?? [category()]);
    this.dependencyIds = new Set(options.dependencyIds ?? []);
    this.listDelayMs = options.listDelayMs ?? 0;
  }

  count(path: string, method?: string): number {
    return this.requests.filter((request) => request.path === path && (!method || request.method === method)).length;
  }

  matching(path: RegExp, method?: string): RecordedRequest[] {
    return this.requests.filter((request) => path.test(request.path) && (!method || request.method === method));
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
        expect(request.headers()['x-upload-contract']).toBe('catalog-v1');
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
          challenge_id: 'catalog-login-challenge',
          expires_at: '2099-08-13T09:05:00.000Z',
          mfa_required: true,
          next_action: 'VERIFY_TOTP',
          pre_auth_token: preauthToken,
        }));
        return;
      }
      if (path === '/api/v1/admin/auth/mfa/challenges/catalog-login-challenge/verify') {
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

      const listMatch = path.match(/^\/api\/v1\/admin\/(brands|categories)$/);
      if (listMatch) {
        const kind = listMatch[1] as Kind;
        if (request.method() === 'GET') await this.handleList(route, kind, url.search);
        else if (request.method() === 'POST') await this.handleCreate(route, kind);
        else await json(route, 405, error('METHOD_NOT_ALLOWED', 'method not allowed'));
        return;
      }

      const lifecycleMatch = path.match(/^\/api\/v1\/admin\/(brands|categories)\/([^/]+)\/lifecycle-(preview|changes)$/);
      if (lifecycleMatch && request.method() === 'POST') {
        const [, kindValue, id = '', operation] = lifecycleMatch;
        const kind = kindValue as Kind;
        if (operation === 'preview') await this.handlePreview(route, kind, id);
        else await this.handleConfirm(route, kind, id);
        return;
      }

      const restoreMatch = path.match(/^\/api\/v1\/admin\/(brands|categories)\/([^/]+)\/restore$/);
      if (restoreMatch && request.method() === 'POST') {
        await this.handleRestore(route, restoreMatch[1] as Kind, restoreMatch[2] ?? '');
        return;
      }

      const detailMatch = path.match(/^\/api\/v1\/admin\/(brands|categories)\/([^/]+)$/);
      if (detailMatch) {
        const kind = detailMatch[1] as Kind;
        const id = detailMatch[2] ?? '';
        if (request.method() === 'GET') await this.handleDetail(route, kind, id);
        else if (request.method() === 'PATCH') await this.handlePatch(route, kind, id);
        else await json(route, 405, error('METHOD_NOT_ALLOWED', 'method not allowed'));
        return;
      }

      await json(route, 404, error('NOT_FOUND', `No mock for ${request.method()} ${path}`));
    });
  }

  private entities(kind: Kind): Entity[] {
    return kind === 'brands' ? this.brands : this.categories;
  }

  private find(kind: Kind, id: string): Entity | undefined {
    return this.entities(kind).find((item) => entityId(item) === id);
  }

  private record(route: Route, kind: RecordedRequest['kind'], id: string | null, body: Record<string, unknown> = {}) {
    const request = route.request();
    this.requests.push({ body, headers: request.headers(), id, kind, method: request.method(), path: new URL(request.url()).pathname });
  }

  private assertWriteHeaders(route: Route, withVersion: boolean) {
    const headers = route.request().headers();
    expect(headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
    if (withVersion) expect(headers['if-match']).toMatch(/^"[1-9][0-9]*"$/);
  }

  private async handleList(route: Route, kind: Kind, search: string) {
    this.record(route, kind, null);
    this.listQueries.push({ kind, search });
    if (this.listDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, this.listDelayMs));
    const failure = this.nextListFailure[kind];
    if (failure) {
      delete this.nextListFailure[kind];
      await json(route, failure.status, error(failure.code ?? 'INTERNAL_ERROR', failure.message ?? 'internal catalog detail'));
      return;
    }
    const query = new URLSearchParams(search);
    const keyword = query.get('keyword')?.toLocaleLowerCase('zh-CN') ?? '';
    const status = query.get('status') as CatalogStatus | null;
    const items = this.entities(kind)
      .filter((item) => (status ? item.status === status : item.status !== 'ARCHIVED'))
      .filter((item) => !keyword || item.name.toLocaleLowerCase('zh-CN').includes(keyword))
      .sort((left, right) => left.sort_order - right.sort_order || entityId(left).localeCompare(entityId(right)));
    await json(route, 200, success({ items, pagination: { page: 1, page_size: 20, total: items.length } }));
  }

  private async handleCreate(route: Route, kind: Kind) {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, kind, null, body);
    const sequence = this.entities(kind).length + 1;
    const item: Entity = kind === 'brands'
      ? brand({
          brand_id: `brand-created-${sequence}`,
          description: body.description as string | null,
          logo_file_id: body.logo_file_id as string | null,
          logo_url: body.logo_file_id ? `https://assets.example.test/${String(body.logo_file_id)}.png` : null,
          name: String(body.name),
          sort_order: Number(body.sort_order),
        })
      : category({
          category_id: `category-created-${sequence}`,
          icon_file_id: body.icon_file_id as string | null,
          icon_url: body.icon_file_id ? `https://assets.example.test/${String(body.icon_file_id)}.png` : null,
          name: String(body.name),
          sort_order: Number(body.sort_order),
          status: 'DRAFT',
          version: 1,
        });
    this.entities(kind).push(item);
    await json(route, 201, success(item));
  }

  private async handleDetail(route: Route, kind: Kind, id: string) {
    this.record(route, kind, id);
    const item = this.find(kind, id);
    if (!item) await json(route, 404, error('NOT_FOUND', 'missing catalog entity'));
    else await json(route, 200, success(item));
  }

  private async handlePatch(route: Route, kind: Kind, id: string) {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, kind, id, body);
    const item = this.find(kind, id);
    if (!item) {
      await json(route, 404, error('NOT_FOUND', 'missing catalog entity'));
      return;
    }
    Object.assign(item, body, { version: item.version + 1 });
    await json(route, 200, success(item));
  }

  private async handlePreview(route: Route, kind: Kind, id: string) {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, kind, id, body);
    const item = this.find(kind, id);
    if (!item) {
      await json(route, 404, error('NOT_FOUND', 'missing catalog entity'));
      return;
    }
    this.previewSequence += 1;
    const hasDependency = this.dependencyIds.has(id);
    await json(route, 200, success({
      confirmation_hash: 'a'.repeat(64),
      expires_at: '2099-08-13T09:05:00.000Z',
      impact: {
        affected_count: hasDependency ? 2 : 0,
        metrics: [{ after: String(hasDependency ? 2 : 0), before: '0', key: 'active_products', label: '在售商品依赖' }],
        warnings: hasDependency ? ['存在 2 个在售商品依赖，确认时将阻断'] : [],
      },
      preview_token: `catalog-preview-token-${this.previewSequence}`,
      resource_etag: `"${item.version}"`,
    }), { pragma: 'no-cache' });
  }

  private async handleConfirm(route: Route, kind: Kind, id: string) {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, kind, id, body);
    const item = this.find(kind, id);
    if (!item) {
      await json(route, 404, error('NOT_FOUND', 'missing catalog entity'));
      return;
    }
    if (this.nextConfirmConflict) {
      this.nextConfirmConflict = false;
      item.version += 1;
      await json(route, 409, error('VERSION_CONFLICT', 'stale internal version detail'));
      return;
    }
    const action = body.action as LifecycleAction;
    if (this.dependencyIds.has(id) && action !== 'ACTIVATE') {
      await json(route, 422, error('ACTIVE_PRODUCT_DEPENDENCY', 'internal product ids: p-1,p-2'));
      return;
    }
    item.status = action === 'ACTIVATE' ? 'ACTIVE' : action === 'DEACTIVATE' ? 'INACTIVE' : 'ARCHIVED';
    item.version += 1;
    await json(route, 200, success({
      occurred_at: '2026-08-13T09:00:00.000Z',
      resource_id: id,
      resource_type: kind === 'brands' ? 'brand' : 'category',
      status: item.status,
      version: item.version,
    }));
  }

  private async handleRestore(route: Route, kind: Kind, id: string) {
    this.assertWriteHeaders(route, true);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, kind, id, body);
    const item = this.find(kind, id);
    if (!item) {
      await json(route, 404, error('NOT_FOUND', 'missing catalog entity'));
      return;
    }
    item.status = 'DRAFT';
    item.version += 1;
    await json(route, 200, success({
      occurred_at: '2026-08-13T09:00:00.000Z',
      resource_id: id,
      resource_type: kind === 'brands' ? 'brand' : 'category',
      status: item.status,
      version: item.version,
    }));
  }

  private async handleUploadIntent(route: Route) {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, 'files', null, body);
    this.fileSequence += 1;
    const fileId = `catalog-file-${this.fileSequence}`;
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
        { name: 'x-upload-contract', value: 'catalog-v1' },
      ],
      upload_url: `https://uploads.example.test/${fileId}`,
    }));
  }

  private async handleUploadComplete(route: Route, fileId: string) {
    this.assertWriteHeaders(route, false);
    const body = route.request().postDataJSON() as Record<string, unknown>;
    this.record(route, 'files', fileId, body);
    const intent = this.uploadIntents.get(fileId);
    expect(intent).toBeDefined();
    expect(body).toEqual({ sha256: intent?.sha256, size: intent?.size });
    await json(route, 200, success({
      completed_at: '2026-08-13T09:00:00.000Z',
      file_id: fileId,
      public_url: `https://assets.example.test/${fileId}.png`,
      purpose: intent?.purpose,
      status: 'READY',
    }));
  }
}

async function login(page: Page, backend: MockCatalogBackend): Promise<void> {
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

async function expectNoHorizontalOverflow(page: Page) {
  const layout = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(Math.max(layout.body, layout.document)).toBeLessThanOrEqual(layout.viewport + 1);
}

async function uploadImage(page: Page, name: string) {
  await page.getByTestId('asset-upload').locator('input[type="file"]').setInputFiles({
    buffer: pngBytes,
    mimeType: 'image/png',
    name,
  });
}

function expectIdempotencyKeys(requests: RecordedRequest[]) {
  for (const request of requests) expect(request.headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
}

async function selectElementPlusOption(page: Page, label: string, option: string) {
  await page.getByRole('combobox', { name: label, exact: true }).click({ force: true });
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function openLifecyclePreview(
  page: Page,
  rowId: string,
  action: '启用' | '停用' | '归档',
  reason: string,
) {
  const row = page.getByTestId(`catalog-row-${rowId}`);
  await row.getByRole('button', { name: '影响预览' }).click();
  const dialog = page.getByTestId('lifecycle-dialog');
  await expect(dialog).toBeVisible();
  await selectElementPlusOption(page, '生命周期动作', action);
  await dialog.getByLabel('操作原因').fill(reason);
  await page.getByRole('button', { name: '生成影响预览' }).click();
  return dialog;
}

test.describe('B3.3 admin brand and category management', () => {
  test('keeps the refreshed session when the retried catalog request returns a recoverable error', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'web-1024', '共享请求层回归只需一个桌面视口');
    const backend = new MockCatalogBackend();
    backend.expireNextPath = '/api/v1/admin/brands';
    backend.nextListFailure.brands = { message: 'retry internal database detail', status: 500 };

    await login(page, backend);
    await expect(page).toHaveURL(/\/catalog\/brands$/);
    await expect(page.getByTestId('catalog-error')).toBeVisible();
    await expect(page.getByText('retry internal database detail')).toHaveCount(0);
    await expect(page.getByRole('link', { name: '账户安全', exact: true })).toBeVisible();
    expect(backend.refreshRequests).toBe(1);

    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('catalog-row-brand-draft')).toBeVisible();
    await expect(page).toHaveURL(/\/catalog\/brands$/);
    expect(backend.refreshRequests).toBe(1);

    const dialog = await openLifecyclePreview(page, 'brand-draft', '启用', '刷新后验证写冲突');
    backend.expireNextPath = '/api/v1/admin/brands/brand-draft/lifecycle-changes';
    backend.nextConfirmConflict = true;
    await page.getByRole('button', { name: '确认启用' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('catalog-row-brand-draft')).toBeVisible();
    await expect(page).toHaveURL(/\/catalog\/brands$/);
    await expect(page.getByRole('link', { name: '账户安全', exact: true })).toBeVisible();
    expect(backend.refreshRequests).toBe(2);
  });

  test('loads both modules and keeps loading, empty, 500, and 403 states recoverable', async ({ page }, testInfo) => {
    const backend = new MockCatalogBackend({ categories: [], listDelayMs: 700 });
    backend.nextListFailure.brands = { status: 500 };
    await login(page, backend);

    await expect(page.getByTestId('catalog-loading')).toBeVisible();
    await expect(page.getByTestId('catalog-error')).toBeVisible();
    await expect(page.getByText('internal catalog detail')).toHaveCount(0);
    backend.listDelayMs = 0;
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('catalog-row-brand-draft')).toBeVisible();
    await expect(page.getByTestId('catalog-row-brand-draft')).toContainText('草稿');
    await expect(page.getByTestId('status-filter')).toContainText('默认（不含已归档）');
    await expect(page.getByText('编码')).toHaveCount(0);
    await expect(page.getByText('商品数量')).toHaveCount(0);
    if (testInfo.project.name === 'mobile-390' || testInfo.project.name === 'web-1440') {
      await page.screenshot({ fullPage: true, path: testInfo.outputPath('catalog-brands.png') });
    }

    backend.nextListFailure.categories = { code: 'FORBIDDEN', message: 'internal permission names', status: 403 };
    await page.getByRole('link', { name: '分类管理' }).click();
    await expect(page).toHaveURL(/\/catalog\/categories$/);
    await expect(page.getByTestId('catalog-error')).toBeVisible();
    await expect(page.getByText('internal permission names')).toHaveCount(0);
    await page.getByRole('button', { name: '重新加载' }).click();
    await expect(page.getByTestId('catalog-empty')).toBeVisible();
    await expect(page.getByText('分类说明')).toHaveCount(0);
    await expect(page.getByText('佣金')).toHaveCount(0);
    await expect(page.getByText('SKU 数量')).toHaveCount(0);

    await expect(page.getByRole('link', { name: '品牌管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: '分类管理' })).toBeVisible();
    await expect(page.getByRole('link', { name: '账户安全', exact: true })).toBeVisible();
    await expect(page.getByText('商品管理')).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
  });

  test('creates and edits drafts with Logo/Icon upload contracts and suppresses duplicate submits', async ({ page }) => {
    const backend = new MockCatalogBackend();
    await login(page, backend);

    await page.getByRole('button', { name: '新增品牌' }).click();
    let editor = page.getByTestId('catalog-editor');
    await expect(editor).toBeVisible();
    await expect(editor).toContainText('保存为草稿');
    await expect(editor.getByLabel('状态')).toHaveCount(0);
    await editor.getByLabel('品牌名称').fill('青柠净护');
    await editor.getByLabel('品牌描述').fill('低敏衣物清洁系列');
    await editor.getByLabel('排序值').fill('7');
    await uploadImage(page, 'brand-logo.png');
    await expect.poll(() => backend.matching(/^\/api\/v1\/files\/[^/]+\/complete$/, 'POST').length).toBe(1);
    await editor.getByRole('button', { name: '保存为草稿' }).dblclick();
    await expect(editor).toBeHidden();

    const brandCreates = backend.matching(/^\/api\/v1\/admin\/brands$/, 'POST');
    expect(brandCreates).toHaveLength(1);
    expect(brandCreates[0]?.body).toEqual({
      description: '低敏衣物清洁系列',
      initial_status: 'DRAFT',
      logo_file_id: 'catalog-file-1',
      name: '青柠净护',
      sort_order: 7,
    });
    expectIdempotencyKeys(brandCreates);

    const createdBrandRow = page.getByTestId('catalog-row-brand-created-2');
    await expect(createdBrandRow).toBeVisible();
    await createdBrandRow.getByRole('button', { name: '编辑' }).click();
    editor = page.getByTestId('catalog-editor');
    await editor.getByLabel('品牌名称').fill('青柠净护经典');
    await editor.getByLabel('排序值').fill('8');
    await editor.getByRole('button', { name: '保存修改' }).click();
    await expect(editor).toBeHidden();
    const brandPatches = backend.matching(/^\/api\/v1\/admin\/brands\/brand-created-2$/, 'PATCH');
    expect(brandPatches).toHaveLength(1);
    expect(brandPatches[0]?.headers['if-match']).toBe('"1"');
    expect(brandPatches[0]?.body).toMatchObject({ name: '青柠净护经典', sort_order: 8 });
    expect(brandPatches[0]?.body).not.toHaveProperty('status');
    expect(brandPatches[0]?.body).not.toHaveProperty('initial_status');

    await page.getByRole('link', { name: '分类管理' }).click();
    await page.getByRole('button', { name: '新增分类' }).click();
    editor = page.getByTestId('catalog-editor');
    await editor.getByLabel('分类名称').fill('厨房清洁');
    await editor.getByLabel('排序值').fill('4');
    await uploadImage(page, 'category-icon.png');
    await expect.poll(() => backend.matching(/^\/api\/v1\/files\/[^/]+\/complete$/, 'POST').length).toBe(2);
    await editor.getByRole('button', { name: '保存为草稿' }).click();
    await expect(editor).toBeHidden();

    const categoryCreates = backend.matching(/^\/api\/v1\/admin\/categories$/, 'POST');
    expect(categoryCreates).toHaveLength(1);
    expect(categoryCreates[0]?.body).toEqual({
      icon_file_id: 'catalog-file-2',
      initial_status: 'DRAFT',
      name: '厨房清洁',
      sort_order: 4,
    });

    const intents = backend.matching(/^\/api\/v1\/files\/upload-intents$/, 'POST');
    const completes = backend.matching(/^\/api\/v1\/files\/[^/]+\/complete$/, 'POST');
    expect(intents).toHaveLength(2);
    expect(intents.map((request) => request.body.purpose)).toEqual(['BRAND_LOGO', 'CATEGORY_ICON']);
    const expectedHash = createHash('sha256').update(pngBytes).digest('hex');
    for (const intent of intents) {
      expect(intent.body.mime_type).toBe('image/png');
      expect(intent.body.size).toBe(pngBytes.byteLength);
      expect(intent.body.sha256).toBe(expectedHash);
    }
    expectIdempotencyKeys([...intents, ...completes, ...categoryCreates, ...brandPatches]);
    expect(backend.uploadedBodies).toHaveLength(2);
    for (const uploaded of backend.uploadedBodies) expect(uploaded.equals(pngBytes)).toBe(true);

    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain('uploads.example.test');
    expect(storage).not.toContain('catalog-preview-token');
    await expectNoHorizontalOverflow(page);
  });

  test('requires preview-confirm, shows dependency impact, and blocks confirm with 422', async ({ page }) => {
    const backend = new MockCatalogBackend({ dependencyIds: ['category-active'] });
    await login(page, backend);

    let dialog = await openLifecyclePreview(page, 'brand-draft', '启用', '新品牌上线前已完成内容复核');
    await expect(dialog).toContainText('在售商品依赖');
    await page.getByRole('button', { name: '确认启用' }).dblclick();
    await expect(dialog).toBeHidden();

    const previews = backend.matching(/\/lifecycle-preview$/, 'POST');
    const confirms = backend.matching(/\/lifecycle-changes$/, 'POST');
    expect(previews).toHaveLength(1);
    expect(confirms).toHaveLength(1);
    expect(previews[0]?.body).toEqual({ action: 'ACTIVATE', reason: '新品牌上线前已完成内容复核' });
    expect(confirms[0]?.body).toEqual({
      action: 'ACTIVATE',
      confirmation_hash: 'a'.repeat(64),
      preview_token: 'catalog-preview-token-1',
      reason: '新品牌上线前已完成内容复核',
    });
    expect(confirms[0]?.headers['if-match']).toBe('"1"');

    await page.getByRole('link', { name: '分类管理' }).click();
    dialog = await openLifecyclePreview(page, 'category-active', '停用', '调整分类前先检查在售商品影响');
    await expect(dialog).toContainText('存在 2 个在售商品依赖');
    await page.getByRole('button', { name: '确认停用' }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('存在活动商品依赖，记录未变更');
    await expect(dialog.getByText('internal product ids: p-1,p-2')).toHaveCount(0);
    expect(backend.categories[0]?.status).toBe('ACTIVE');
    const dependencyConfirm = backend.matching(/\/categories\/category-active\/lifecycle-changes$/, 'POST');
    expect(dependencyConfirm).toHaveLength(1);
    expect(dependencyConfirm[0]?.body.action).toBe('DEACTIVATE');
    expect(dependencyConfirm[0]?.headers['if-match']).toBe('"3"');
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain('catalog-preview-token');
    expect(storage).not.toContain('a'.repeat(64));
    await expectNoHorizontalOverflow(page);
  });

  test('archives only through preview, queries ARCHIVED explicitly, and restores the same row to DRAFT', async ({ page }) => {
    const backend = new MockCatalogBackend();
    await login(page, backend);

    const lifecycleDialog = await openLifecyclePreview(page, 'brand-draft', '归档', '品牌已停止经营且确认无在售依赖');
    await page.getByRole('button', { name: '确认归档' }).click();
    await expect(lifecycleDialog).toBeHidden();
    await expect(page.getByTestId('catalog-row-brand-draft')).toHaveCount(0);

    await selectElementPlusOption(page, '状态筛选', '已归档');
    await expect(page.getByTestId('catalog-row-brand-draft')).toBeVisible();
    expect(backend.listQueries.some(({ kind, search }) => kind === 'brands' && new URLSearchParams(search).get('status') === 'ARCHIVED')).toBe(true);

    await page.getByTestId('catalog-row-brand-draft').getByRole('button', { name: '恢复为草稿' }).click();
    const restoreDialog = page.getByTestId('restore-dialog');
    await restoreDialog.getByLabel('恢复原因').fill('品牌资料已重新核对');
    await page.getByRole('button', { name: '确认恢复为草稿' }).click();
    await expect(restoreDialog).toBeHidden();

    const restores = backend.matching(/\/brands\/brand-draft\/restore$/, 'POST');
    expect(restores).toHaveLength(1);
    expect(restores[0]?.body).toEqual({ reason: '品牌资料已重新核对' });
    expect(restores[0]?.headers['if-match']).toBe('"2"');
    expect(backend.matching(/restore-preview/, 'POST')).toHaveLength(0);
    expect(backend.brands[0]?.status).toBe('DRAFT');
    await expectNoHorizontalOverflow(page);
  });

  test('on 409 discards the old preview, refreshes the resource, and requires a fresh confirmation', async ({ page }) => {
    const backend = new MockCatalogBackend();
    await login(page, backend);
    const listCountBefore = backend.count('/api/v1/admin/brands', 'GET');

    let dialog = await openLifecyclePreview(page, 'brand-draft', '启用', '首次启用前复核品牌资料');
    backend.nextConfirmConflict = true;
    await page.getByRole('button', { name: '确认启用' }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(() => backend.count('/api/v1/admin/brands', 'GET')).toBeGreaterThan(listCountBefore);
    await expect(page.getByText('stale internal version detail')).toHaveCount(0);

    const firstConfirm = backend.matching(/\/brands\/brand-draft\/lifecycle-changes$/, 'POST');
    expect(firstConfirm).toHaveLength(1);
    expect(firstConfirm[0]?.body.preview_token).toBe('catalog-preview-token-1');

    const row = page.getByTestId('catalog-row-brand-draft');
    await row.getByRole('button', { name: '影响预览' }).click();
    dialog = page.getByTestId('lifecycle-dialog');
    await expect(page.getByRole('button', { name: '确认启用' })).toHaveCount(0);
    await selectElementPlusOption(page, '生命周期动作', '启用');
    await dialog.getByLabel('操作原因').fill('版本冲突后已重新复核最新资料');
    await page.getByRole('button', { name: '生成影响预览' }).click();
    await page.getByRole('button', { name: '确认启用' }).click();
    await expect(dialog).toBeHidden();

    const confirms = backend.matching(/\/brands\/brand-draft\/lifecycle-changes$/, 'POST');
    expect(confirms).toHaveLength(2);
    expect(confirms[1]?.body.preview_token).toBe('catalog-preview-token-2');
    expect(confirms[1]?.headers['if-match']).toBe('"2"');
    expect(confirms[1]?.headers['idempotency-key']).not.toBe(confirms[0]?.headers['idempotency-key']);
    expect(backend.brands[0]?.status).toBe('ACTIVE');
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(storage).not.toContain('catalog-preview-token');
    expect(storage).not.toContain('a'.repeat(64));
    await expectNoHorizontalOverflow(page);
  });
});
