import { ApplicationError, generateUlid, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { acquireTransactionLock } from './advisory-lock';
import type { DatabaseTransaction } from './idempotency.repository';
import { acquireMasterDataHierarchyLocks } from './master-data.repository';

const POSTGRES_INTEGER_MAX = 2_147_483_647;

export type StoreFavoriteAvailability = 'SALEABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE';

export interface StoreFavoriteIdentityInput {
  accountId: string;
  customerId: string;
}

export interface StoreFavoriteListInput extends StoreFavoriteIdentityInput {
  keyword?: string;
  page: number;
  pageSize: number;
}

export interface StoreFavoriteProductSnapshot {
  availability: StoreFavoriteAvailability;
  id: string;
  isSalable: boolean;
  minimumActivePrice: string | null;
  name: string;
  primaryImageObjectKey: string | null;
}

export interface StoreFavoriteSnapshot {
  createdAt: Date;
  id: string;
  product: StoreFavoriteProductSnapshot;
}

export interface StoreFavoriteListResult {
  items: StoreFavoriteSnapshot[];
  total: number;
}

export interface StoreFavoriteMutationInput extends StoreFavoriteIdentityInput {
  productId: string;
}

interface CountRow { total: bigint }

interface FavoriteRow {
  created_at: Date;
  favorite_id: string;
  is_public: boolean;
  is_salable: boolean;
  minimum_active_price: Prisma.Decimal | null;
  name: string;
  primary_image_object_key: string | null;
  product_id: string;
}

interface PublicProductRow { is_public: boolean }

type FavoriteClient = Pick<DatabaseTransaction, 'account' | 'favorite'>;

function requirePlainObject(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`${label} must be a plain object`);
  }
}

function requireExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedKeys.has(key)) ||
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new TypeError(`${label} contains invalid fields`);
  }
}

function requireUlid(value: unknown, label: string): asserts value is string {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function validateIdentity(input: StoreFavoriteIdentityInput): void {
  requireUlid(input.accountId, 'Store favorite Account ID');
  requireUlid(input.customerId, 'Store favorite Customer ID');
}

function validateListInput(input: StoreFavoriteListInput): { keyword?: string; offset: number } {
  requirePlainObject(input, 'Store favorite list input');
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'keyword', 'page', 'pageSize'],
    ['accountId', 'customerId', 'page', 'pageSize'],
    'Store favorite list input',
  );
  validateIdentity(input);
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > POSTGRES_INTEGER_MAX) {
    throw new TypeError('Store favorite page must be a positive PostgreSQL integer');
  }
  if (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new TypeError('Store favorite page size must be between 1 and 100');
  }
  const offset = (input.page - 1) * input.pageSize;
  if (!Number.isSafeInteger(offset)) throw new TypeError('Store favorite list offset is too large');
  if (input.keyword === undefined) return { offset };
  if (typeof input.keyword !== 'string') throw new TypeError('Store favorite keyword must be a string');
  const keyword = input.keyword.trim();
  const length = Array.from(keyword).length;
  if (length < 1 || length > 200) {
    throw new TypeError('Store favorite keyword must contain 1 to 200 characters');
  }
  return { keyword, offset };
}

function validateMutationInput(input: StoreFavoriteMutationInput): void {
  requirePlainObject(input, 'Store favorite mutation input');
  requireExactKeys(
    input,
    ['accountId', 'customerId', 'productId'],
    ['accountId', 'customerId', 'productId'],
    'Store favorite mutation input',
  );
  validateIdentity(input);
  requireUlid(input.productId, 'Store favorite Product ID');
}

function safeTotal(value: bigint): number {
  const total = Number(value);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new ApplicationError('INTERNAL_ERROR', 'Store favorite result count is invalid');
  }
  return total;
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function favoriteFilters(customerId: string, keyword?: string): Prisma.Sql[] {
  const filters = [Prisma.sql`f.customer_id = ${customerId}`];
  if (keyword !== undefined) {
    filters.push(Prisma.sql`p.name ILIKE ${`%${escapeLikePattern(keyword)}%`} ESCAPE '\\'`);
  }
  return filters;
}

function favoriteSnapshot(row: FavoriteRow): StoreFavoriteSnapshot {
  const availability: StoreFavoriteAvailability = row.is_public
    ? row.is_salable ? 'SALEABLE' : 'OUT_OF_STOCK'
    : 'UNAVAILABLE';
  if (row.is_public && row.minimum_active_price === null) {
    throw new ApplicationError('INTERNAL_ERROR', 'Public favorite product has no active price');
  }
  return {
    createdAt: new Date(row.created_at),
    id: row.favorite_id,
    product: {
      availability,
      id: row.product_id,
      isSalable: row.is_public && row.is_salable,
      minimumActivePrice: row.is_public ? row.minimum_active_price?.toFixed(2) ?? null : null,
      name: row.name,
      primaryImageObjectKey: row.is_public ? row.primary_image_object_key : null,
    },
  };
}

function authenticationRequired(): ApplicationError {
  return new ApplicationError('AUTH_REQUIRED', 'Active customer profile is required');
}

export class StoreFavoritesRepository {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.currentTime();
  }

  private currentTime(): Date {
    const value = this.now();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw new TypeError('Store favorites clock must return a valid Date');
    }
    return value;
  }

  private async assertActiveCustomer(
    client: FavoriteClient,
    identity: StoreFavoriteIdentityInput,
  ): Promise<void> {
    const account = await client.account.findUnique({
      where: { id: identity.accountId },
      select: {
        deleted_at: true,
        login_name: true,
        password_hash: true,
        role: true,
        status: true,
        wechat_open_id: true,
        customer_profile: { select: { account_id: true, anonymized_at: true, id: true } },
      },
    });
    const customer = account?.customer_profile;
    if (!account || account.role !== 'CUSTOMER' || account.status !== 'ACTIVE' ||
      account.deleted_at !== null || account.login_name !== null || account.password_hash !== null ||
      account.wechat_open_id === null || !customer || customer.id !== identity.customerId ||
      customer.account_id !== identity.accountId || customer.anonymized_at !== null) {
      throw authenticationRequired();
    }
  }

  private async countFavorites(
    transaction: DatabaseTransaction,
    input: StoreFavoriteListInput,
    keyword?: string,
  ): Promise<number> {
    const rows = await transaction.$queryRaw<CountRow[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS total
      FROM "favorite" AS f
      INNER JOIN "product" AS p ON p.id = f.product_id
      WHERE ${Prisma.join(favoriteFilters(input.customerId, keyword), ' AND ')}
    `);
    const row = rows[0];
    if (!row) throw new ApplicationError('INTERNAL_ERROR', 'Store favorite count query returned no result');
    return safeTotal(row.total);
  }

  private async queryFavorites(
    transaction: DatabaseTransaction,
    input: StoreFavoriteListInput,
    offset: number,
    keyword?: string,
  ): Promise<FavoriteRow[]> {
    return transaction.$queryRaw<FavoriteRow[]>(Prisma.sql`
      WITH favorite_page AS (
        SELECT
          f.id AS favorite_id,
          f.created_at,
          p.id AS product_id,
          p.name,
          (
            p.status = 'ACTIVE'::"EntityStatus"
            AND p.deleted_at IS NULL
            AND b.status = 'ACTIVE'::"EntityStatus"
            AND b.deleted_at IS NULL
            AND c.status = 'ACTIVE'::"EntityStatus"
            AND c.deleted_at IS NULL
            AND EXISTS (
              SELECT 1
              FROM "sku" AS eligible_sku
              WHERE eligible_sku.product_id = p.id
                AND eligible_sku.status = 'ACTIVE'::"SkuStatus"
                AND eligible_sku.deleted_at IS NULL
            )
          ) AS is_public
        FROM "favorite" AS f
        INNER JOIN "product" AS p ON p.id = f.product_id
        INNER JOIN "brand" AS b ON b.id = p.brand_id
        INNER JOIN "category" AS c ON c.id = p.category_id
        WHERE ${Prisma.join(favoriteFilters(input.customerId, keyword), ' AND ')}
        ORDER BY f.created_at DESC, f.id DESC
        LIMIT ${input.pageSize}
        OFFSET ${offset}
      )
      SELECT
        fp.favorite_id,
        fp.created_at,
        fp.product_id,
        fp.name,
        fp.is_public,
        CASE WHEN fp.is_public THEN active_sku.minimum_active_price ELSE NULL END AS minimum_active_price,
        CASE WHEN fp.is_public THEN COALESCE(active_sku.is_salable, FALSE) ELSE FALSE END AS is_salable,
        CASE WHEN fp.is_public THEN public_image.object_key ELSE NULL END AS primary_image_object_key
      FROM favorite_page AS fp
      LEFT JOIN LATERAL (
        SELECT
          MIN(s.retail_price) AS minimum_active_price,
          COALESCE(BOOL_OR(
            GREATEST(COALESCE(ib.physical_qty, 0) - COALESCE(ib.locked_qty, 0), 0) > 0
          ), FALSE) AS is_salable
        FROM "sku" AS s
        LEFT JOIN "inventory_balance" AS ib ON ib.sku_id = s.id
        WHERE s.product_id = fp.product_id
          AND s.status = 'ACTIVE'::"SkuStatus"
          AND s.deleted_at IS NULL
      ) AS active_sku ON TRUE
      LEFT JOIN LATERAL (
        SELECT fa.object_key
        FROM "product_image" AS pi
        INNER JOIN "file_asset" AS fa ON fa.id = pi.file_id
        WHERE pi.product_id = fp.product_id
          AND pi.deleted_at IS NULL
          AND fa.deleted_at IS NULL
          AND fa.status = 'READY'::"FileStatus"
          AND fa.visibility = 'PUBLIC'::"FileVisibility"
          AND fa.purpose = 'PRODUCT_IMAGE'::"FilePurpose"
          AND fa.object_key = 'public/' || fa.id
        ORDER BY pi.sort_order ASC, pi.id ASC
        LIMIT 1
      ) AS public_image ON TRUE
      ORDER BY fp.created_at DESC, fp.favorite_id DESC
    `);
  }

  private async acquireMutationLocks(
    transaction: DatabaseTransaction,
    input: StoreFavoriteMutationInput,
  ): Promise<void> {
    await acquireTransactionLock(transaction, 'store-auth-account', [input.accountId]);
    await acquireTransactionLock(transaction, 'store-auth-customer', [input.customerId]);
    await acquireMasterDataHierarchyLocks(transaction, { productIds: [input.productId] });
    await acquireTransactionLock(transaction, 'store-favorite', [input.customerId, input.productId]);
  }

  private async isPublicProduct(
    transaction: DatabaseTransaction,
    productId: string,
  ): Promise<boolean> {
    const rows = await transaction.$queryRaw<PublicProductRow[]>(Prisma.sql`
      SELECT EXISTS (
        SELECT 1
        FROM "product" AS p
        INNER JOIN "brand" AS b ON b.id = p.brand_id
        INNER JOIN "category" AS c ON c.id = p.category_id
        INNER JOIN "sku" AS s ON s.product_id = p.id
        WHERE p.id = ${productId}
          AND p.status = 'ACTIVE'::"EntityStatus"
          AND p.deleted_at IS NULL
          AND b.status = 'ACTIVE'::"EntityStatus"
          AND b.deleted_at IS NULL
          AND c.status = 'ACTIVE'::"EntityStatus"
          AND c.deleted_at IS NULL
          AND s.status = 'ACTIVE'::"SkuStatus"
          AND s.deleted_at IS NULL
      ) AS is_public
    `);
    const row = rows[0];
    if (!row || typeof row.is_public !== 'boolean') {
      throw new ApplicationError('INTERNAL_ERROR', 'Store favorite product check returned invalid data');
    }
    return row.is_public;
  }

  async listFavorites(input: StoreFavoriteListInput): Promise<StoreFavoriteListResult> {
    const { keyword, offset } = validateListInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertActiveCustomer(transaction, input);
      const total = await this.countFavorites(transaction, input, keyword);
      const rows = await this.queryFavorites(transaction, input, offset, keyword);
      return { items: rows.map((row) => favoriteSnapshot(row)), total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getFavoriteState(input: StoreFavoriteMutationInput): Promise<boolean> {
    validateMutationInput(input);
    return this.prisma.$transaction(async (transaction) => {
      await this.assertActiveCustomer(transaction, input);
      return (await transaction.favorite.findUnique({
        where: {
          customer_id_product_id: {
            customer_id: input.customerId,
            product_id: input.productId,
          },
        },
        select: { id: true },
      })) !== null;
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getFavoriteStateForMutationInTransaction(
    transaction: DatabaseTransaction,
    input: StoreFavoriteMutationInput,
  ): Promise<boolean> {
    validateMutationInput(input);
    await this.acquireMutationLocks(transaction, input);
    await this.assertActiveCustomer(transaction, input);
    return (await transaction.favorite.findUnique({
      where: {
        customer_id_product_id: {
          customer_id: input.customerId,
          product_id: input.productId,
        },
      },
      select: { id: true },
    })) !== null;
  }

  async putFavoriteInTransaction(
    transaction: DatabaseTransaction,
    input: StoreFavoriteMutationInput,
  ): Promise<{ created: boolean; favoriteId: string }> {
    validateMutationInput(input);
    await this.acquireMutationLocks(transaction, input);
    await this.assertActiveCustomer(transaction, input);
    if (!(await this.isPublicProduct(transaction, input.productId))) {
      throw new ApplicationError('RESOURCE_NOT_FOUND', 'Product not found');
    }
    const existing = await transaction.favorite.findUnique({
      where: {
        customer_id_product_id: {
          customer_id: input.customerId,
          product_id: input.productId,
        },
      },
      select: { id: true },
    });
    if (existing) return { created: false, favoriteId: existing.id };
    const now = this.currentTime();
    const created = await transaction.favorite.create({
      data: {
        created_at: now,
        customer_id: input.customerId,
        id: generateUlid(now.getTime()),
        product_id: input.productId,
      },
      select: { id: true },
    });
    return { created: true, favoriteId: created.id };
  }

  async deleteFavoriteInTransaction(
    transaction: DatabaseTransaction,
    input: StoreFavoriteMutationInput,
  ): Promise<boolean> {
    validateMutationInput(input);
    await this.acquireMutationLocks(transaction, input);
    await this.assertActiveCustomer(transaction, input);
    const deleted = await transaction.favorite.deleteMany({
      where: { customer_id: input.customerId, product_id: input.productId },
    });
    return deleted.count > 0;
  }
}
