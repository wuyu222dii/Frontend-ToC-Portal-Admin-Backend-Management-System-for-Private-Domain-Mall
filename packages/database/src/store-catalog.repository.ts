import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { BannerTargetType } from '../.generated/prisma/enums';
import type { DatabaseTransaction } from './idempotency.repository';

export type StoreCatalogSort =
  | 'COMPREHENSIVE'
  | 'HOT'
  | 'NEWEST'
  | 'PRICE_ASC'
  | 'PRICE_DESC';

export interface StoreCatalogProductListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  brandId?: string;
  categoryId?: string;
  sort?: StoreCatalogSort;
}

export interface StoreCatalogBrandSnapshot {
  id: string;
  name: string;
  description: string | null;
  logoObjectKey: string | null;
  sortOrder: number;
}

export interface StoreCatalogCategorySnapshot {
  id: string;
  name: string;
  iconObjectKey: string | null;
  sortOrder: number;
}

export interface StoreCatalogImageSnapshot {
  objectKey: string;
  sortOrder: number;
  isPrimary: boolean;
}

export interface StoreCatalogSkuSnapshot {
  id: string;
  code: string;
  name: string;
  specification: Prisma.JsonValue | null;
  retailPrice: string;
  isRecommended: boolean;
  availableStock: number;
  isSalable: boolean;
}

export interface StoreCatalogProductListItem {
  id: string;
  spuCode: string;
  name: string;
  subtitle: string | null;
  brand: StoreCatalogBrandSnapshot;
  category: StoreCatalogCategorySnapshot;
  primaryImage: StoreCatalogImageSnapshot | null;
  minimumActivePrice: string;
  netSalesCount: number;
  isHot: boolean;
  isNew: boolean;
  isSalable: boolean;
}

export interface StoreCatalogProductDetail {
  id: string;
  spuCode: string;
  name: string;
  subtitle: string | null;
  introduction: string | null;
  ingredients: string | null;
  usageMethod: string | null;
  brand: StoreCatalogBrandSnapshot;
  category: StoreCatalogCategorySnapshot;
  images: StoreCatalogImageSnapshot[];
  skus: StoreCatalogSkuSnapshot[];
  netSalesCount: number;
  isHot: boolean;
  isNew: boolean;
}

export interface StoreCatalogBannerSnapshot {
  id: string;
  title: string;
  imageObjectKey: string;
  sortOrder: number;
  targetType: 'NONE' | 'PRODUCT' | 'CATEGORY' | 'URL';
  targetId: string | null;
  targetUrl: string | null;
}

export interface StoreCatalogProductListResult {
  items: StoreCatalogProductListItem[];
  total: number;
}

type ProductQuery = {
  pageSize: number;
  offset: number;
  sort: StoreCatalogSort;
  keyword?: string;
  brandId?: string;
  categoryId?: string;
  productId?: string;
  onlyHot?: boolean;
  onlyNew?: boolean;
};

type ProductRow = {
  id: string;
  spu_code: string;
  brand_id: string;
  category_id: string;
  name: string;
  subtitle: string | null;
  introduction: string | null;
  ingredients: string | null;
  usage_method: string | null;
  is_hot: boolean;
  is_new: boolean;
  sales_count: number;
  published_at: Date | null;
  minimum_active_price: Prisma.Decimal;
  is_salable: boolean;
};

type CountRow = { total: bigint };
type PublicProductIdRow = { id: string };

const PUBLIC_FILE_SELECT = {
  deleted_at: true,
  id: true,
  object_key: true,
  purpose: true,
  status: true,
  visibility: true,
} as const;
const BRAND_SELECT = {
  description: true,
  id: true,
  logo: { select: PUBLIC_FILE_SELECT },
  name: true,
  sort_order: true,
} satisfies Prisma.BrandSelect;
const CATEGORY_SELECT = {
  icon: { select: PUBLIC_FILE_SELECT },
  id: true,
  name: true,
  sort_order: true,
} satisfies Prisma.CategorySelect;
const IMAGE_SELECT = {
  file: { select: PUBLIC_FILE_SELECT },
  file_id: true,
  id: true,
  product_id: true,
  sort_order: true,
} satisfies Prisma.ProductImageSelect;
const SKU_SELECT = {
  code: true,
  id: true,
  inventory_balance: { select: { locked_qty: true, physical_qty: true } },
  is_recommended: true,
  name: true,
  product_id: true,
  retail_price: true,
  spec_json: true,
} satisfies Prisma.SkuSelect;
const BANNER_SELECT = {
  file: { select: PUBLIC_FILE_SELECT },
  file_id: true,
  id: true,
  sort_order: true,
  target_id: true,
  target_type: true,
  target_url: true,
  title: true,
} satisfies Prisma.BannerSelect;

type BrandRecord = Prisma.BrandGetPayload<{ select: typeof BRAND_SELECT }>;
type CategoryRecord = Prisma.CategoryGetPayload<{ select: typeof CATEGORY_SELECT }>;
type SkuRecord = Prisma.SkuGetPayload<{ select: typeof SKU_SELECT }>;
type BannerRecord = Prisma.BannerGetPayload<{ select: typeof BANNER_SELECT }>;
type PublicFileRecord = NonNullable<BrandRecord['logo']>;

const PRODUCT_SORTS = new Set<StoreCatalogSort>([
  'COMPREHENSIVE',
  'HOT',
  'NEWEST',
  'PRICE_ASC',
  'PRICE_DESC',
]);
const PRODUCT_LIST_FIELDS = new Set([
  'brandId',
  'categoryId',
  'keyword',
  'page',
  'pageSize',
  'sort',
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value: unknown, fields: ReadonlySet<string>): boolean {
  return isPlainObject(value) && Object.keys(value).every((key) => fields.has(key));
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function validateProductListInput(input: StoreCatalogProductListInput): ProductQuery {
  if (!hasOnlyFields(input, PRODUCT_LIST_FIELDS)) {
    throw new TypeError('Store product list query contains unsupported fields');
  }
  if (!Number.isSafeInteger(input.page) || input.page < 1) {
    throw new TypeError('Page must be a positive integer');
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Page size must be between 1 and 100');
  }
  const offset = (input.page - 1) * input.pageSize;
  if (!Number.isSafeInteger(offset)) throw new TypeError('Store product list offset is too large');
  const sort = input.sort ?? 'COMPREHENSIVE';
  if (!PRODUCT_SORTS.has(sort)) throw new TypeError('Store product sort is invalid');
  const query: ProductQuery = { offset, pageSize: input.pageSize, sort };
  if (input.keyword !== undefined) {
    if (typeof input.keyword !== 'string') throw new TypeError('Store product keyword must be a string');
    const keyword = input.keyword.trim();
    const length = Array.from(keyword).length;
    if (length < 1 || length > 200) {
      throw new TypeError('Store product keyword must contain 1 to 200 characters');
    }
    query.keyword = keyword;
  }
  if (input.brandId !== undefined) {
    requireUlid(input.brandId, 'Store product Brand ID');
    query.brandId = input.brandId;
  }
  if (input.categoryId !== undefined) {
    requireUlid(input.categoryId, 'Store product Category ID');
    query.categoryId = input.categoryId;
  }
  return query;
}

function parseHttpsUrl(value: string): URL | null {
  if (typeof value !== 'string' || Array.from(value).length < 1 || Array.from(value).length > 500) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '' ? url : null;
  } catch {
    return null;
  }
}

function normalizeAllowedOrigins(values: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(values)) throw new TypeError('Banner URL origin allowlist must be an array');
  const origins = new Set<string>();
  for (const value of values) {
    const url = parseHttpsUrl(value);
    if (!url || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      throw new TypeError('Banner URL allowlist entries must be HTTPS origins');
    }
    origins.add(url.origin);
  }
  return origins;
}

function isPublicFile(
  file: PublicFileRecord | null,
  fileId: string | null,
  purpose: 'BANNER' | 'BRAND_LOGO' | 'CATEGORY_ICON' | 'PRODUCT_IMAGE',
): file is PublicFileRecord {
  return file !== null && fileId !== null && file.id === fileId && file.deleted_at === null &&
    file.object_key === `public/${fileId}` && file.purpose === purpose && file.status === 'READY' &&
    file.visibility === 'PUBLIC';
}

function decimalMoney(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function safeTotal(value: bigint): number {
  const total = Number(value);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store catalog result count is invalid');
  }
  return total;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function productFilters(query: ProductQuery): Prisma.Sql[] {
  const filters = [
    Prisma.sql`p.status = 'ACTIVE'::\"EntityStatus\"`,
    Prisma.sql`p.deleted_at IS NULL`,
    Prisma.sql`b.status = 'ACTIVE'::\"EntityStatus\"`,
    Prisma.sql`b.deleted_at IS NULL`,
    Prisma.sql`c.status = 'ACTIVE'::\"EntityStatus\"`,
    Prisma.sql`c.deleted_at IS NULL`,
    Prisma.sql`s.status = 'ACTIVE'::\"SkuStatus\"`,
    Prisma.sql`s.deleted_at IS NULL`,
  ];
  if (query.keyword !== undefined) {
    filters.push(Prisma.sql`p.name ILIKE ${`%${escapeLikePattern(query.keyword)}%`} ESCAPE '\\'`);
  }
  if (query.brandId !== undefined) filters.push(Prisma.sql`p.brand_id = ${query.brandId}`);
  if (query.categoryId !== undefined) filters.push(Prisma.sql`p.category_id = ${query.categoryId}`);
  if (query.productId !== undefined) filters.push(Prisma.sql`p.id = ${query.productId}`);
  if (query.onlyHot === true) filters.push(Prisma.sql`p.is_hot = TRUE`);
  if (query.onlyNew === true) filters.push(Prisma.sql`p.is_new = TRUE`);
  return filters;
}

function eligibleProducts(query: ProductQuery): Prisma.Sql {
  return Prisma.sql`
    SELECT
      p.id,
      p.spu_code,
      p.brand_id,
      p.category_id,
      p.name,
      p.subtitle,
      p.introduction,
      p.ingredients,
      p.usage_method,
      p.is_hot,
      p.is_new,
      p.sales_count,
      p.published_at,
      MIN(s.retail_price) AS minimum_active_price,
      COALESCE(BOOL_OR(
        GREATEST(COALESCE(ib.physical_qty, 0) - COALESCE(ib.locked_qty, 0), 0) > 0
      ), FALSE) AS is_salable
    FROM \"product\" AS p
    INNER JOIN \"brand\" AS b ON b.id = p.brand_id
    INNER JOIN \"category\" AS c ON c.id = p.category_id
    INNER JOIN \"sku\" AS s ON s.product_id = p.id
    LEFT JOIN \"inventory_balance\" AS ib ON ib.sku_id = s.id
    WHERE ${Prisma.join(productFilters(query), ' AND ')}
    GROUP BY p.id
  `;
}

function productOrder(sort: StoreCatalogSort): Prisma.Sql {
  if (sort === 'HOT') return Prisma.sql`e.sales_count DESC, e.id ASC`;
  if (sort === 'NEWEST') return Prisma.sql`e.published_at DESC NULLS LAST, e.id ASC`;
  if (sort === 'PRICE_ASC') return Prisma.sql`e.minimum_active_price ASC, e.id ASC`;
  if (sort === 'PRICE_DESC') return Prisma.sql`e.minimum_active_price DESC, e.id ASC`;
  return Prisma.sql`
    e.is_hot DESC,
    e.is_new DESC,
    e.sales_count DESC,
    e.published_at DESC NULLS LAST,
    e.id ASC
  `;
}

function brandSnapshot(record: BrandRecord): StoreCatalogBrandSnapshot {
  const logoObjectKey = isPublicFile(record.logo, record.logo?.id ?? null, 'BRAND_LOGO')
    ? record.logo.object_key
    : null;
  return {
    description: record.description,
    id: record.id,
    logoObjectKey,
    name: record.name,
    sortOrder: record.sort_order,
  };
}

function categorySnapshot(record: CategoryRecord): StoreCatalogCategorySnapshot {
  const iconObjectKey = isPublicFile(record.icon, record.icon?.id ?? null, 'CATEGORY_ICON')
    ? record.icon.object_key
    : null;
  return { iconObjectKey, id: record.id, name: record.name, sortOrder: record.sort_order };
}

function inventoryAvailability(record: SkuRecord): number {
  if (record.inventory_balance === null) return 0;
  return Math.max(0, record.inventory_balance.physical_qty - record.inventory_balance.locked_qty);
}

function skuSnapshot(record: SkuRecord): StoreCatalogSkuSnapshot {
  const availableStock = inventoryAvailability(record);
  return {
    availableStock,
    code: record.code,
    id: record.id,
    isRecommended: record.is_recommended,
    isSalable: availableStock > 0,
    name: record.name,
    retailPrice: decimalMoney(record.retail_price),
    specification: record.spec_json,
  };
}

function internalError(message: string): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message);
}

export class StoreCatalogRepository {
  private readonly allowedBannerOrigins: ReadonlySet<string>;

  constructor(
    private readonly prisma: PrismaClient,
    allowedBannerOrigins: readonly string[],
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.allowedBannerOrigins = normalizeAllowedOrigins(allowedBannerOrigins);
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Store catalog repository clock must return a valid Date');
    }
    return value;
  }

  private async queryProductRows(
    transaction: DatabaseTransaction,
    query: ProductQuery,
  ): Promise<ProductRow[]> {
    const eligible = eligibleProducts(query);
    return transaction.$queryRaw<ProductRow[]>(Prisma.sql`
      WITH eligible AS (${eligible})
      SELECT *
      FROM eligible AS e
      ORDER BY ${productOrder(query.sort)}
      LIMIT ${query.pageSize}
      OFFSET ${query.offset}
    `);
  }

  private async countProducts(transaction: DatabaseTransaction, query: ProductQuery): Promise<number> {
    const eligible = eligibleProducts(query);
    const rows = await transaction.$queryRaw<CountRow[]>(Prisma.sql`
      WITH eligible AS (${eligible})
      SELECT COUNT(*)::bigint AS total
      FROM eligible
    `);
    const row = rows[0];
    if (!row) throw internalError('Store catalog count query returned no result');
    return safeTotal(row.total);
  }

  private async assembleProducts(
    transaction: DatabaseTransaction,
    rows: readonly ProductRow[],
    includeSkus: boolean,
  ): Promise<Array<{ listItem: StoreCatalogProductListItem; detail: StoreCatalogProductDetail }>> {
    if (rows.length === 0) return [];
    const productIds = rows.map(({ id }) => id);
    const brandIds = [...new Set(rows.map(({ brand_id }) => brand_id))];
    const categoryIds = [...new Set(rows.map(({ category_id }) => category_id))];
    const [brands, categories, images, skus] = await Promise.all([
      transaction.brand.findMany({
        select: BRAND_SELECT,
        where: { deleted_at: null, id: { in: brandIds }, status: 'ACTIVE' },
      }),
      transaction.category.findMany({
        select: CATEGORY_SELECT,
        where: { deleted_at: null, id: { in: categoryIds }, status: 'ACTIVE' },
      }),
      transaction.productImage.findMany({
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        select: IMAGE_SELECT,
        where: { deleted_at: null, product_id: { in: productIds } },
      }),
      includeSkus
        ? transaction.sku.findMany({
            orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
            select: SKU_SELECT,
            where: { deleted_at: null, product_id: { in: productIds }, status: 'ACTIVE' },
          })
        : Promise.resolve([] as SkuRecord[]),
    ]);
    const brandById = new Map(brands.map((record) => [record.id, brandSnapshot(record)]));
    const categoryById = new Map(categories.map((record) => [record.id, categorySnapshot(record)]));
    const imagesByProduct = new Map<string, StoreCatalogImageSnapshot[]>();
    for (const record of images) {
      if (!isPublicFile(record.file, record.file_id, 'PRODUCT_IMAGE')) continue;
      const productImages = imagesByProduct.get(record.product_id) ?? [];
      productImages.push({
        isPrimary: productImages.length === 0,
        objectKey: record.file.object_key,
        sortOrder: record.sort_order,
      });
      imagesByProduct.set(record.product_id, productImages);
    }
    const skusByProduct = new Map<string, StoreCatalogSkuSnapshot[]>();
    for (const record of skus) {
      const productSkus = skusByProduct.get(record.product_id) ?? [];
      productSkus.push(skuSnapshot(record));
      skusByProduct.set(record.product_id, productSkus);
    }
    return rows.map((row) => {
      const brand = brandById.get(row.brand_id);
      const category = categoryById.get(row.category_id);
      if (!brand || !category) throw internalError('Store catalog master data changed within a snapshot');
      const productImages = imagesByProduct.get(row.id) ?? [];
      const productSkus = skusByProduct.get(row.id) ?? [];
      const listItem: StoreCatalogProductListItem = {
        brand,
        category,
        id: row.id,
        isHot: row.is_hot,
        isNew: row.is_new,
        isSalable: row.is_salable,
        minimumActivePrice: decimalMoney(row.minimum_active_price),
        name: row.name,
        netSalesCount: row.sales_count,
        primaryImage: productImages[0] ?? null,
        spuCode: row.spu_code,
        subtitle: row.subtitle,
      };
      return {
        detail: {
          brand,
          category,
          id: row.id,
          images: productImages,
          ingredients: row.ingredients,
          introduction: row.introduction,
          isHot: row.is_hot,
          isNew: row.is_new,
          name: row.name,
          netSalesCount: row.sales_count,
          skus: productSkus,
          spuCode: row.spu_code,
          subtitle: row.subtitle,
          usageMethod: row.usage_method,
        },
        listItem,
      };
    });
  }

  private async listProductsInTransaction(
    transaction: DatabaseTransaction,
    query: ProductQuery,
  ): Promise<StoreCatalogProductListResult> {
    const total = await this.countProducts(transaction, query);
    const rows = await this.queryProductRows(transaction, query);
    const assembled = await this.assembleProducts(transaction, rows, false);
    return { items: assembled.map(({ listItem }) => listItem), total };
  }

  private async listHomeProductsInTransaction(
    transaction: DatabaseTransaction,
    query: ProductQuery,
  ): Promise<StoreCatalogProductListItem[]> {
    const rows = await this.queryProductRows(transaction, query);
    const assembled = await this.assembleProducts(transaction, rows, false);
    return assembled.map(({ listItem }) => listItem);
  }

  private async listBrandsInTransaction(
    transaction: DatabaseTransaction,
  ): Promise<StoreCatalogBrandSnapshot[]> {
    const records = await transaction.brand.findMany({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      select: BRAND_SELECT,
      where: { deleted_at: null, status: 'ACTIVE' },
    });
    return records.map((record) => brandSnapshot(record));
  }

  private async listCategoriesInTransaction(
    transaction: DatabaseTransaction,
  ): Promise<StoreCatalogCategorySnapshot[]> {
    const records = await transaction.category.findMany({
      orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
      select: CATEGORY_SELECT,
      where: { deleted_at: null, status: 'ACTIVE' },
    });
    return records.map((record) => categorySnapshot(record));
  }

  async listBrands(): Promise<StoreCatalogBrandSnapshot[]> {
    return this.prisma.$transaction(
      (transaction) => this.listBrandsInTransaction(transaction),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async listCategories(): Promise<StoreCatalogCategorySnapshot[]> {
    return this.prisma.$transaction(
      (transaction) => this.listCategoriesInTransaction(transaction),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async listProducts(input: StoreCatalogProductListInput): Promise<StoreCatalogProductListResult> {
    const query = validateProductListInput(input);
    return this.prisma.$transaction(
      (transaction) => this.listProductsInTransaction(transaction, query),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async getProduct(productId: string): Promise<StoreCatalogProductDetail | null> {
    requireUlid(productId, 'Store product ID');
    return this.prisma.$transaction(async (transaction) => {
      const rows = await this.queryProductRows(transaction, {
        offset: 0,
        pageSize: 1,
        productId,
        sort: 'COMPREHENSIVE',
      });
      const row = rows[0];
      if (!row) return null;
      const assembled = await this.assembleProducts(transaction, [row], true);
      return assembled[0]?.detail ?? null;
    }, { isolationLevel: 'RepeatableRead' });
  }

  async listHomeCategories(): Promise<StoreCatalogCategorySnapshot[]> {
    return this.prisma.$transaction(async (transaction) =>
      (await this.listCategoriesInTransaction(transaction)).slice(0, 8),
    { isolationLevel: 'RepeatableRead' });
  }

  async listHomeHotProducts(): Promise<StoreCatalogProductListItem[]> {
    return this.prisma.$transaction(
      (transaction) => this.listHomeProductsInTransaction(transaction, {
        offset: 0,
        onlyHot: true,
        pageSize: 4,
        sort: 'HOT',
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  async listHomeNewProducts(): Promise<StoreCatalogProductListItem[]> {
    return this.prisma.$transaction(
      (transaction) => this.listHomeProductsInTransaction(transaction, {
        offset: 0,
        onlyNew: true,
        pageSize: 4,
        sort: 'NEWEST',
      }),
      { isolationLevel: 'RepeatableRead' },
    );
  }

  private async publicProductTargetIds(
    transaction: DatabaseTransaction,
    productIds: readonly string[],
  ): Promise<ReadonlySet<string>> {
    if (productIds.length === 0) return new Set();
    const rows = await transaction.$queryRaw<PublicProductIdRow[]>(Prisma.sql`
      SELECT DISTINCT p.id
      FROM \"product\" AS p
      INNER JOIN \"brand\" AS b ON b.id = p.brand_id
      INNER JOIN \"category\" AS c ON c.id = p.category_id
      INNER JOIN \"sku\" AS s ON s.product_id = p.id
      WHERE p.id IN (${Prisma.join(productIds)})
        AND p.status = 'ACTIVE'::\"EntityStatus\"
        AND p.deleted_at IS NULL
        AND b.status = 'ACTIVE'::\"EntityStatus\"
        AND b.deleted_at IS NULL
        AND c.status = 'ACTIVE'::\"EntityStatus\"
        AND c.deleted_at IS NULL
        AND s.status = 'ACTIVE'::\"SkuStatus\"
        AND s.deleted_at IS NULL
    `);
    return new Set(rows.map(({ id }) => id));
  }

  private isAllowedBannerUrl(value: string): boolean {
    const url = parseHttpsUrl(value);
    return url !== null && this.allowedBannerOrigins.has(url.origin);
  }

  private isValidBannerTarget(
    record: BannerRecord,
    publicProductIds: ReadonlySet<string>,
    activeCategoryIds: ReadonlySet<string>,
  ): boolean {
    if (record.target_type === 'NONE') return record.target_id === null && record.target_url === null;
    if (record.target_type === 'PRODUCT') {
      return record.target_id !== null && record.target_url === null && publicProductIds.has(record.target_id);
    }
    if (record.target_type === 'CATEGORY') {
      return record.target_id !== null && record.target_url === null && activeCategoryIds.has(record.target_id);
    }
    return record.target_id === null && record.target_url !== null && this.isAllowedBannerUrl(record.target_url);
  }

  async listHomeBanners(): Promise<StoreCatalogBannerSnapshot[]> {
    const now = this.currentTime();
    return this.prisma.$transaction(async (transaction) => {
      const records = await transaction.banner.findMany({
        orderBy: [{ sort_order: 'asc' }, { id: 'asc' }],
        select: BANNER_SELECT,
        where: {
          AND: [
            { OR: [{ starts_at: null }, { starts_at: { lte: now } }] },
            { OR: [{ ends_at: null }, { ends_at: { gt: now } }] },
          ],
          deleted_at: null,
          status: 'ACTIVE',
        },
      });
      const productIds = [...new Set(records.flatMap((record) =>
        record.target_type === 'PRODUCT' && record.target_id !== null ? [record.target_id] : []))];
      const categoryIds = [...new Set(records.flatMap((record) =>
        record.target_type === 'CATEGORY' && record.target_id !== null ? [record.target_id] : []))];
      const [publicProductIds, categories] = await Promise.all([
        this.publicProductTargetIds(transaction, productIds),
        categoryIds.length === 0
          ? Promise.resolve([])
          : transaction.category.findMany({
              select: { id: true },
              where: { deleted_at: null, id: { in: categoryIds }, status: 'ACTIVE' },
            }),
      ]);
      const activeCategoryIds = new Set(categories.map(({ id }) => id));
      return records.filter((record) =>
        isPublicFile(record.file, record.file_id, 'BANNER') &&
        this.isValidBannerTarget(record, publicProductIds, activeCategoryIds))
        .slice(0, 10)
        .map((record): StoreCatalogBannerSnapshot => ({
          id: record.id,
          imageObjectKey: record.file.object_key,
          sortOrder: record.sort_order,
          targetId: record.target_id,
          targetType: record.target_type as BannerTargetType,
          targetUrl: record.target_url,
          title: record.title,
        }));
    }, { isolationLevel: 'RepeatableRead' });
  }
}
