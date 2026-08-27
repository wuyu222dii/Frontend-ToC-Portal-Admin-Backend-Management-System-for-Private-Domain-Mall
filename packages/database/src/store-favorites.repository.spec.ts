import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { StoreFavoritesRepository } from './store-favorites.repository';

const NOW = new Date('2026-08-27T08:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 8_000);
const customerId = generateUlid(NOW.getTime() - 7_000);
const otherCustomerId = generateUlid(NOW.getTime() - 6_000);
const productId = generateUlid(NOW.getTime() - 5_000);
const secondProductId = generateUlid(NOW.getTime() - 4_000);
const favoriteId = generateUlid(NOW.getTime() - 3_000);
const secondFavoriteId = generateUlid(NOW.getTime() - 2_000);
const thirdFavoriteId = generateUlid(NOW.getTime() - 1_000);

interface FavoriteTestRow {
  created_at: Date;
  favorite_id: string;
  is_public: boolean;
  is_salable: boolean;
  minimum_active_price: Prisma.Decimal | null;
  name: string;
  primary_image_object_key: string | null;
  product_id: string;
}

function favoriteRow(overrides: Partial<FavoriteTestRow> = {}): FavoriteTestRow {
  return {
    created_at: NOW,
    favorite_id: favoriteId,
    is_public: true,
    is_salable: true,
    minimum_active_price: new Prisma.Decimal('19.90'),
    name: '100%_\\Serum',
    primary_image_object_key: `public/${productId}`,
    product_id: productId,
    ...overrides,
  };
}

function sqlText(query: unknown): string {
  return (query as { strings: readonly string[] }).strings.join('?');
}

function sqlValues(query: unknown): readonly unknown[] {
  return (query as { values: readonly unknown[] }).values;
}

function activeAccount(profileCustomerId = customerId, profileAccountId = accountId) {
  return {
    customer_profile: {
      account_id: profileAccountId,
      anonymized_at: null,
      id: profileCustomerId,
    },
    deleted_at: null,
    login_name: null,
    password_hash: null,
    role: 'CUSTOMER',
    status: 'ACTIVE',
    wechat_open_id: 'openid-current-customer',
  };
}

function harness() {
  let accountRecord: ReturnType<typeof activeAccount> | null = activeAccount();
  let rows: FavoriteTestRow[] = [favoriteRow()];
  let total = 1n;
  let publicProduct = true;
  let storedFavoriteId: string | null = null;
  let forcedDeleteCount: number | undefined;

  const account = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === accountId ? accountRecord : null),
  };
  const favorite = {
    create: vi.fn(async ({ data }: { data: { id: string } }) => {
      storedFavoriteId = data.id;
      return { id: data.id };
    }),
    deleteMany: vi.fn(async ({ where }: {
      where: { customer_id: string; product_id: string };
    }) => {
      const count = forcedDeleteCount ?? (where.customer_id === customerId &&
        where.product_id === productId && storedFavoriteId !== null ? 1 : 0);
      if (count > 0) storedFavoriteId = null;
      return { count };
    }),
    findUnique: vi.fn(async ({ where }: {
      where: { customer_id_product_id: { customer_id: string; product_id: string } };
    }) => {
      const key = where.customer_id_product_id;
      return key.customer_id === customerId && key.product_id === productId && storedFavoriteId !== null
        ? { id: storedFavoriteId }
        : null;
    }),
  };
  const queryRaw = vi.fn(async (query: unknown) => {
    const text = sqlText(query);
    if (text.includes('COUNT(*)::bigint')) return [{ total }];
    if (text.includes('SELECT EXISTS')) return [{ is_public: publicProduct }];
    return rows;
  });
  const transactionStub = {
    $queryRaw: queryRaw,
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    account,
    favorite,
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => unknown) =>
      work(transactionStub as unknown as DatabaseTransaction)),
  };

  return {
    account,
    favorite,
    prisma,
    queryRaw,
    repository: new StoreFavoritesRepository(prisma as unknown as PrismaClient, () => NOW),
    setAccount: (value: ReturnType<typeof activeAccount> | null) => { accountRecord = value; },
    setDeleteCount: (value: number | undefined) => { forcedDeleteCount = value; },
    setExistingFavorite: (value: string | null) => { storedFavoriteId = value; },
    setPublicProduct: (value: boolean) => { publicProduct = value; },
    setRows: (value: FavoriteTestRow[]) => { rows = value; },
    setTotal: (value: bigint) => { total = value; },
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

describe('StoreFavoritesRepository', () => {
  it('strictly validates clocks, exact input shapes, ULIDs, pagination and keyword boundaries', async () => {
    expect(() => new StoreFavoritesRepository({} as PrismaClient, () => new Date(Number.NaN)))
      .toThrow('clock must return a valid Date');

    const { repository, transaction } = harness();
    await expect(repository.listFavorites({ accountId, customerId, page: 0, pageSize: 20 }))
      .rejects.toThrow('positive PostgreSQL integer');
    await expect(repository.listFavorites({ accountId, customerId, page: 1, pageSize: 101 }))
      .rejects.toThrow('between 1 and 100');
    await expect(repository.listFavorites({ accountId, customerId, keyword: '   ', page: 1, pageSize: 20 }))
      .rejects.toThrow('1 to 200');
    await expect(repository.listFavorites({
      accountId,
      customerId,
      keyword: 'x'.repeat(201),
      page: 1,
      pageSize: 20,
    })).rejects.toThrow('1 to 200');
    await expect(repository.listFavorites({ accountId, customerId, page: 1, pageSize: 20, status: 'ACTIVE' } as never))
      .rejects.toThrow('invalid fields');
    await expect(repository.getFavoriteState({ accountId, customerId, productId: 'not-a-ulid' }))
      .rejects.toThrow('must be a ULID');
    await expect(repository.putFavoriteInTransaction(transaction, {
      accountId,
      customerId,
      productId,
      selected: true,
    } as never)).rejects.toThrow('invalid fields');
  });

  it('uses literal parameterized name search, customer scope, stable order and one Repeatable Read snapshot', async () => {
    const { prisma, queryRaw, repository } = harness();

    await expect(repository.listFavorites({
      accountId,
      customerId,
      keyword: '  100%_\\SERUM  ',
      page: 2,
      pageSize: 20,
    })).resolves.toMatchObject({ total: 1 });

    expect(queryRaw).toHaveBeenCalledTimes(2);
    for (const [query] of queryRaw.mock.calls) {
      expect(sqlText(query)).toContain('f.customer_id =');
      expect(sqlText(query)).toContain('p.name ILIKE');
      expect(sqlText(query)).toContain("ESCAPE '\\'");
      expect(sqlValues(query)).toContain(customerId);
      expect(sqlValues(query)).toContain('%100\\%\\_\\\\SERUM%');
      expect(sqlText(query)).not.toContain(customerId);
    }
    const pageQuery = queryRaw.mock.calls[1]?.[0];
    expect(sqlText(pageQuery)).toContain('ORDER BY f.created_at DESC, f.id DESC');
    expect(sqlText(pageQuery)).toContain('ORDER BY fp.created_at DESC, fp.favorite_id DESC');
    expect(sqlValues(pageQuery)).toEqual(expect.arrayContaining([20, 20]));
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('projects SALEABLE, OUT_OF_STOCK and UNAVAILABLE without leaking unavailable media or price', async () => {
    const unavailableProductId = generateUlid(NOW.getTime() + 1_000);
    const { queryRaw, repository, setRows, setTotal } = harness();
    setRows([
      favoriteRow(),
      favoriteRow({
        favorite_id: secondFavoriteId,
        is_salable: false,
        minimum_active_price: new Prisma.Decimal('29.00'),
        primary_image_object_key: null,
        product_id: secondProductId,
      }),
      favoriteRow({
        favorite_id: thirdFavoriteId,
        is_public: false,
        is_salable: true,
        minimum_active_price: new Prisma.Decimal('9.00'),
        primary_image_object_key: `private/${unavailableProductId}`,
        product_id: unavailableProductId,
      }),
    ]);
    setTotal(3n);

    const result = await repository.listFavorites({ accountId, customerId, page: 1, pageSize: 20 });

    expect(result.items.map(({ product }) => product)).toEqual([
      {
        availability: 'SALEABLE',
        id: productId,
        isSalable: true,
        minimumActivePrice: '19.90',
        name: '100%_\\Serum',
        primaryImageObjectKey: `public/${productId}`,
      },
      expect.objectContaining({
        availability: 'OUT_OF_STOCK',
        id: secondProductId,
        isSalable: false,
        minimumActivePrice: '29.00',
        primaryImageObjectKey: null,
      }),
      expect.objectContaining({
        availability: 'UNAVAILABLE',
        id: unavailableProductId,
        isSalable: false,
        minimumActivePrice: null,
        primaryImageObjectKey: null,
      }),
    ]);
    const pageSql = sqlText(queryRaw.mock.calls[1]?.[0]);
    expect(pageSql).toContain("fa.status = 'READY'");
    expect(pageSql).toContain("fa.visibility = 'PUBLIC'");
    expect(pageSql).toContain("fa.purpose = 'PRODUCT_IMAGE'");
    expect(pageSql).toContain("fa.object_key = 'public/' || fa.id");
    expect(pageSql).toContain('GREATEST(COALESCE(ib.physical_qty, 0) - COALESCE(ib.locked_qty, 0), 0)');
  });

  it('fails closed when a row claims to be public without an ACTIVE SKU price', async () => {
    const { repository, setRows } = harness();
    setRows([favoriteRow({ minimum_active_price: null })]);
    await expect(repository.listFavorites({ accountId, customerId, page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('rejects crossed customer identities before reads and scopes state lookup to customer plus product', async () => {
    const crossed = harness();
    crossed.setAccount(activeAccount(otherCustomerId));
    await expect(crossed.repository.listFavorites({ accountId, customerId, page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(crossed.queryRaw).not.toHaveBeenCalled();

    const state = harness();
    state.setExistingFavorite(favoriteId);
    await expect(state.repository.getFavoriteState({ accountId, customerId, productId })).resolves.toBe(true);
    expect(state.favorite.findUnique).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        customer_id_product_id: { customer_id: customerId, product_id: productId },
      },
    });
    expect(state.prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('accepts only a public Product and creates the favorite under shared hierarchy locks', async () => {
    const state = harness();

    const result = await state.repository.putFavoriteInTransaction(state.transaction, {
      accountId,
      customerId,
      productId,
    });

    expect(result.created).toBe(true);
    expect(result.favoriteId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(state.favorite.create).toHaveBeenCalledWith({
      data: {
        created_at: NOW,
        customer_id: customerId,
        id: result.favoriteId,
        product_id: productId,
      },
      select: { id: true },
    });
    const productCheck = state.queryRaw.mock.calls[0]?.[0];
    expect(sqlText(productCheck)).toContain('SELECT EXISTS');
    expect(sqlText(productCheck)).toContain("p.status = 'ACTIVE'");
    expect(sqlText(productCheck)).toContain("b.status = 'ACTIVE'");
    expect(sqlText(productCheck)).toContain("c.status = 'ACTIVE'");
    expect(sqlText(productCheck)).toContain("s.status = 'ACTIVE'");
    expect(sqlValues(productCheck)).toContain(productId);
    expect(state.transactionStub.$queryRawUnsafe.mock.calls.map((call) => [call[1], call[2]])).toEqual([
      ['store-auth-account', JSON.stringify([accountId])],
      ['store-auth-customer', JSON.stringify([customerId])],
      ['master-data-product', JSON.stringify([productId])],
      ['store-favorite', JSON.stringify([customerId, productId])],
    ]);
  });

  it('rejects an unavailable Product atomically and treats duplicate PUT as an idempotent no-op', async () => {
    const unavailable = harness();
    unavailable.setPublicProduct(false);
    await expect(unavailable.repository.putFavoriteInTransaction(unavailable.transaction, {
      accountId,
      customerId,
      productId,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(unavailable.favorite.create).not.toHaveBeenCalled();

    const duplicate = harness();
    duplicate.setExistingFavorite(favoriteId);
    await expect(duplicate.repository.putFavoriteInTransaction(duplicate.transaction, {
      accountId,
      customerId,
      productId,
    })).resolves.toEqual({ created: false, favoriteId });
    expect(duplicate.favorite.create).not.toHaveBeenCalled();
  });

  it('deletes only the current customer-product tuple and succeeds when the favorite does not exist', async () => {
    const present = harness();
    present.setExistingFavorite(favoriteId);
    await expect(present.repository.deleteFavoriteInTransaction(present.transaction, {
      accountId,
      customerId,
      productId,
    })).resolves.toBe(true);
    expect(present.favorite.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: customerId, product_id: productId },
    });

    const absent = harness();
    absent.setDeleteCount(0);
    await expect(absent.repository.deleteFavoriteInTransaction(absent.transaction, {
      accountId,
      customerId,
      productId,
    })).resolves.toBe(false);
    expect(absent.favorite.deleteMany).toHaveBeenCalledWith({
      where: { customer_id: customerId, product_id: productId },
    });
  });
});
