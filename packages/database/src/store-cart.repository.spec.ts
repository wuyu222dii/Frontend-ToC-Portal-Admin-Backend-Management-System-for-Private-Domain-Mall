import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';
import { StoreCartRepository } from './store-cart.repository';

const NOW = new Date('2026-08-27T10:00:00.000Z');
const accountId = generateUlid(NOW.getTime() - 20_000);
const customerId = generateUlid(NOW.getTime() - 19_000);
const otherCustomerId = generateUlid(NOW.getTime() - 18_000);
const cartId = generateUlid(NOW.getTime() - 17_000);
const skuId = generateUlid(NOW.getTime() - 16_000);
const secondSkuId = generateUlid(NOW.getTime() - 15_000);
const thirdSkuId = generateUlid(NOW.getTime() - 14_000);
const productId = generateUlid(NOW.getTime() - 13_000);

interface StoredItem {
  created_at: Date;
  id: string;
  quantity: number;
  selected: boolean;
  sku_id: string;
  updated_at: Date;
}

interface ProjectionRow {
  available_stock: bigint;
  cart_item_id: string;
  is_active: boolean;
  is_deleted: boolean;
  primary_image_object_key: string | null;
  product_id: string;
  product_name: string;
  quantity: number;
  retail_price: Prisma.Decimal;
  selected: boolean;
  sku_id: string;
  sku_name: string;
  spec_json: Prisma.JsonValue | null;
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
    wechat_open_id: 'openid-cart-customer',
  };
}

function projectionRow(overrides: Partial<ProjectionRow> = {}): ProjectionRow {
  return {
    available_stock: 10n,
    cart_item_id: generateUlid(NOW.getTime() - 12_000),
    is_active: true,
    is_deleted: false,
    primary_image_object_key: `public/${productId}`,
    product_id: productId,
    product_name: 'Cart Product',
    quantity: 2,
    retail_price: new Prisma.Decimal('10.00'),
    selected: true,
    sku_id: skuId,
    sku_name: 'Cart SKU',
    spec_json: { size: '500ml' },
    ...overrides,
  };
}

function sqlText(query: unknown): string {
  return (query as { strings: readonly string[] }).strings.join('?');
}

function sqlValues(query: unknown): readonly unknown[] {
  return (query as { values: readonly unknown[] }).values;
}

function lockRequests(calls: readonly unknown[][]): { namespace: string; parts: string[] }[] {
  return calls.flatMap((call) => {
    if (typeof call[2] === 'string') {
      return [{ namespace: call[1] as string, parts: JSON.parse(call[2]) as string[] }];
    }
    const encoded = JSON.parse(call[1] as string) as { namespace: string; parts: string }[];
    return encoded.map(({ namespace, parts }) => ({
      namespace,
      parts: JSON.parse(parts) as string[],
    }));
  });
}

function harness(options: { hasCart?: boolean; items?: StoredItem[] } = {}) {
  let accountRecord: ReturnType<typeof activeAccount> | null = activeAccount();
  let currentCart: { id: string } | null = options.hasCart === false ? null : { id: cartId };
  let forcedCount: number | undefined;
  let projectionRows: ProjectionRow[] | undefined;
  const knownSkuIds = new Set([skuId, secondSkuId, thirdSkuId]);
  const items = new Map<string, StoredItem>((options.items ?? []).map((item) => [item.sku_id, item]));

  const account = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      where.id === accountId ? accountRecord : null),
  };
  const cart = {
    create: vi.fn(async ({ data }: { data: { id: string } }) => {
      currentCart = { id: data.id };
      return { id: data.id };
    }),
    findUnique: vi.fn(async ({ where }: { where: { customer_id: string } }) =>
      where.customer_id === customerId ? currentCart : null),
    update: vi.fn().mockResolvedValue({}),
  };
  const cartItem = {
    count: vi.fn(async () => forcedCount ?? items.size),
    create: vi.fn(async ({ data }: { data: StoredItem & { cart_id: string } }) => {
      items.set(data.sku_id, data);
      return data;
    }),
    createMany: vi.fn(async ({ data }: { data: (StoredItem & { cart_id: string })[] }) => {
      for (const item of data) items.set(item.sku_id, item);
      return { count: data.length };
    }),
    deleteMany: vi.fn(async ({ where }: { where: { cart_id: string; sku_id: string } }) => {
      if (where.cart_id !== currentCart?.id) return { count: 0 };
      const existed = items.delete(where.sku_id);
      return { count: existed ? 1 : 0 };
    }),
    findMany: vi.fn(async ({ where }: {
      where: { cart_id: string; sku_id?: { in: string[] } };
    }) => [...items.values()].filter((item) => where.sku_id === undefined || where.sku_id.in.includes(item.sku_id))),
    findUnique: vi.fn(async ({ where }: {
      where: { cart_id_sku_id: { cart_id: string; sku_id: string } };
    }) => {
      const key = where.cart_id_sku_id;
      return key.cart_id === currentCart?.id ? items.get(key.sku_id) ?? null : null;
    }),
    update: vi.fn(async ({ data, where }: {
      data: Partial<StoredItem>;
      where: { id: string };
    }) => {
      const current = [...items.values()].find(({ id }) => id === where.id);
      if (current) Object.assign(current, data);
      return current;
    }),
  };
  const sku = {
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
      where.id.in.filter((id) => knownSkuIds.has(id)).map((id) => ({ id }))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      knownSkuIds.has(where.id) ? { id: where.id } : null),
  };
  const queryRaw = vi.fn(async () => projectionRows ?? [...items.values()].map((item) => projectionRow({
    cart_item_id: item.id,
    quantity: item.quantity,
    selected: item.selected,
    sku_id: item.sku_id,
  })));
  const executeRaw = vi.fn(async (query: unknown) => {
    const payload = sqlValues(query).find((value) => typeof value === 'string' && value.startsWith('['));
    const updates = JSON.parse(payload as string) as {
      id: string;
      quantity: number;
      selected: boolean;
    }[];
    for (const update of updates) {
      const item = [...items.values()].find(({ id }) => id === update.id);
      if (item) Object.assign(item, update, { updated_at: NOW });
    }
    return updates.length;
  });
  const transactionStub = {
    $executeRaw: executeRaw,
    $queryRaw: queryRaw,
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ acquired: 1 }]),
    account,
    cart,
    cartItem,
    executeRaw,
    sku,
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => unknown) =>
      work(transactionStub as unknown as DatabaseTransaction)),
  };

  return {
    cart,
    cartItem,
    items,
    knownSkuIds,
    prisma,
    queryRaw,
    repository: new StoreCartRepository(prisma as unknown as PrismaClient, () => NOW),
    setAccount: (value: ReturnType<typeof activeAccount> | null) => { accountRecord = value; },
    setCount: (value: number | undefined) => { forcedCount = value; },
    setProjectionRows: (value: ProjectionRow[] | undefined) => { projectionRows = value; },
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

function storedItem(id: string, idSku = skuId, quantity = 2, selected = true): StoredItem {
  return { created_at: NOW, id, quantity, selected, sku_id: idSku, updated_at: NOW };
}

describe('StoreCartRepository', () => {
  it('strictly validates clocks, exact input shapes, ULIDs, item bounds and unique merge SKUs', async () => {
    expect(() => new StoreCartRepository({} as PrismaClient, () => new Date(Number.NaN)))
      .toThrow('clock must return a valid Date');
    const state = harness();
    await expect(state.repository.getCart({ accountId, customerId, extra: true } as never))
      .rejects.toThrow('invalid fields');
    await expect(state.repository.getCart({ accountId: 'bad', customerId }))
      .rejects.toThrow('must be a ULID');
    await expect(state.repository.putItemInTransaction(state.transaction, {
      accountId, customerId, quantity: 0, selected: true, skuId,
    })).rejects.toThrow('between 1 and 99');
    await expect(state.repository.putItemInTransaction(state.transaction, {
      accountId, customerId, quantity: 1, selected: 1, skuId,
    } as never)).rejects.toThrow('must be a boolean');
    await expect(state.repository.mergeCartInTransaction(state.transaction, {
      accountId, customerId, items: [],
    })).rejects.toThrow('1 to 100');
    await expect(state.repository.mergeCartInTransaction(state.transaction, {
      accountId,
      customerId,
      items: [
        { quantity: 1, selected: true, skuId },
        { quantity: 2, selected: false, skuId },
      ],
    })).rejects.toThrow('must be unique');
  });

  it('returns an empty cart in one Repeatable Read snapshot without creating any facts', async () => {
    const state = harness({ hasCart: false });

    await expect(state.repository.getCart({ accountId, customerId })).resolves.toEqual({
      cartId: null,
      items: [],
      totalAmount: '0.00',
    });

    expect(state.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(state.cart.create).not.toHaveBeenCalled();
    expect(state.cartItem.create).not.toHaveBeenCalled();
    expect(state.queryRaw).not.toHaveBeenCalled();
  });

  it('projects all five statuses, public media, fail-safe stock and selected SALEABLE totals', async () => {
    const state = harness();
    state.setProjectionRows([
      projectionRow(),
      projectionRow({
        available_stock: 1n,
        cart_item_id: generateUlid(NOW.getTime() - 11_000),
        quantity: 2,
        retail_price: new Prisma.Decimal('11.00'),
        sku_id: secondSkuId,
      }),
      projectionRow({
        available_stock: 0n,
        cart_item_id: generateUlid(NOW.getTime() - 10_000),
        retail_price: new Prisma.Decimal('12.00'),
        sku_id: thirdSkuId,
      }),
      projectionRow({
        cart_item_id: generateUlid(NOW.getTime() - 9_000),
        is_active: false,
        retail_price: new Prisma.Decimal('13.00'),
        sku_id: generateUlid(NOW.getTime() - 8_000),
      }),
      projectionRow({
        cart_item_id: generateUlid(NOW.getTime() - 7_000),
        is_active: false,
        is_deleted: true,
        primary_image_object_key: null,
        retail_price: new Prisma.Decimal('14.00'),
        sku_id: generateUlid(NOW.getTime() - 6_000),
      }),
      projectionRow({
        cart_item_id: generateUlid(NOW.getTime() - 5_000),
        retail_price: new Prisma.Decimal('15.00'),
        selected: false,
        sku_id: generateUlid(NOW.getTime() - 4_000),
      }),
    ]);

    const result = await state.repository.getCart({ accountId, customerId });

    expect(result.totalAmount).toBe('20.00');
    expect(result.items.map(({ saleStatus }) => saleStatus)).toEqual([
      'SALEABLE',
      'INSUFFICIENT_STOCK',
      'OUT_OF_STOCK',
      'INACTIVE',
      'DELETED',
      'SALEABLE',
    ]);
    const text = sqlText(state.queryRaw.mock.calls[0]?.[0]);
    expect(text).toContain('ORDER BY ci.created_at ASC, ci.id ASC');
    expect(text).toContain('COALESCE(ib.physical_qty, 0)::bigint');
    expect(text).toContain("fa.status = 'READY'");
    expect(text).toContain("fa.visibility = 'PUBLIC'");
    expect(text).toContain("fa.purpose = 'PRODUCT_IMAGE'");
    expect(text).toContain("fa.object_key = 'public/' || fa.id");
    expect(text).toContain("s.status = 'ARCHIVED'");
    expect(text).toContain("p.status = 'ARCHIVED'");
    expect(text).toContain("s.status = 'ACTIVE'");
    expect(text).toContain("p.status = 'ACTIVE'");
    expect(text).toContain("b.status = 'ACTIVE'");
    expect(text).toContain("c.status = 'ACTIVE'");
  });

  it('rejects crossed or inactive CUSTOMER identities before reading cart facts', async () => {
    const state = harness();
    state.setAccount(activeAccount(otherCustomerId));

    await expect(state.repository.getCart({ accountId, customerId }))
      .rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    expect(state.cart.findUnique).not.toHaveBeenCalled();
    expect(state.queryRaw).not.toHaveBeenCalled();
  });

  it('rejects an unknown SKU before lazy creation and locks account, customer, cart then SKU', async () => {
    const state = harness({ hasCart: false });
    const unknownSkuId = generateUlid(NOW.getTime() - 3_000);

    await expect(state.repository.putItemInTransaction(state.transaction, {
      accountId, customerId, quantity: 1, selected: true, skuId: unknownSkuId,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(state.cart.create).not.toHaveBeenCalled();
    expect(lockRequests(state.transactionStub.$queryRawUnsafe.mock.calls)).toEqual([
      { namespace: 'store-auth-account', parts: [accountId] },
      { namespace: 'store-auth-customer', parts: [customerId] },
      { namespace: 'store-cart', parts: [customerId] },
      { namespace: 'product-catalog-sku', parts: [unknownSkuId] },
    ]);
  });

  it('lazily creates a cart and item under the real cart-item lock, including inactive existing SKUs', async () => {
    const state = harness({ hasCart: false });

    const result = await state.repository.putItemInTransaction(state.transaction, {
      accountId, customerId, quantity: 3, selected: false, skuId,
    });

    const createdCartId = state.cart.create.mock.calls[0]?.[0].data.id as string;
    expect(result.changed).toBe(true);
    expect(result.cart.cartId).toBe(createdCartId);
    expect(state.cartItem.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        cart_id: createdCartId,
        quantity: 3,
        selected: false,
        sku_id: skuId,
      }),
    });
    expect(lockRequests(state.transactionStub.$queryRawUnsafe.mock.calls)).toEqual([
      { namespace: 'store-auth-account', parts: [accountId] },
      { namespace: 'store-auth-customer', parts: [customerId] },
      { namespace: 'store-cart', parts: [customerId] },
      { namespace: 'product-catalog-sku', parts: [skuId] },
      { namespace: 'store-cart-item', parts: [createdCartId, skuId] },
    ]);
  });

  it('returns changed=false for an exact PUT and rejects a 101st distinct item', async () => {
    const itemId = generateUlid(NOW.getTime() - 2_000);
    const exact = harness({ items: [storedItem(itemId)] });
    await expect(exact.repository.putItemInTransaction(exact.transaction, {
      accountId, customerId, quantity: 2, selected: true, skuId,
    })).resolves.toMatchObject({ changed: false });
    expect(exact.cartItem.update).not.toHaveBeenCalled();
    expect(exact.cart.update).not.toHaveBeenCalled();

    const full = harness();
    full.setCount(100);
    await expect(full.repository.putItemInTransaction(full.transaction, {
      accountId, customerId, quantity: 1, selected: true, skuId,
    })).rejects.toMatchObject({ code: 'CART_ITEM_LIMIT_EXCEEDED' });
    expect(full.cartItem.create).not.toHaveBeenCalled();
  });

  it('deletes idempotently and never creates an empty cart', async () => {
    const absentCart = harness({ hasCart: false });
    await expect(absentCart.repository.deleteItemInTransaction(absentCart.transaction, {
      accountId, customerId, skuId,
    })).resolves.toEqual({
      changed: false,
      cart: { cartId: null, items: [], totalAmount: '0.00' },
    });
    expect(absentCart.cart.create).not.toHaveBeenCalled();
    expect(absentCart.cartItem.deleteMany).not.toHaveBeenCalled();

    const itemId = generateUlid(NOW.getTime() - 1_000);
    const present = harness({ items: [storedItem(itemId)] });
    await expect(present.repository.deleteItemInTransaction(present.transaction, {
      accountId, customerId, skuId,
    })).resolves.toMatchObject({ changed: true });
    expect(present.cartItem.deleteMany).toHaveBeenCalledWith({
      where: { cart_id: cartId, sku_id: skuId },
    });
    expect(present.cart.update).toHaveBeenCalledTimes(1);
  });

  it('validates every merge SKU before creating a cart so an unknown SKU is all-or-nothing', async () => {
    const state = harness({ hasCart: false });
    const unknownSkuId = generateUlid(NOW.getTime() + 1_000);

    await expect(state.repository.mergeCartInTransaction(state.transaction, {
      accountId,
      customerId,
      items: [
        { quantity: 1, selected: true, skuId },
        { quantity: 1, selected: true, skuId: unknownSkuId },
      ],
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    expect(state.cart.create).not.toHaveBeenCalled();
    expect(state.cartItem.create).not.toHaveBeenCalled();
    expect(state.cartItem.createMany).not.toHaveBeenCalled();
    expect(state.cartItem.update).not.toHaveBeenCalled();
    expect(state.transactionStub.$executeRaw).not.toHaveBeenCalled();
  });

  it('merges in sorted lock order with quantity cap, selected OR and one atomic projection', async () => {
    const existingId = generateUlid(NOW.getTime() + 2_000);
    const state = harness({ items: [storedItem(existingId, secondSkuId, 95, false)] });

    const result = await state.repository.mergeCartInTransaction(state.transaction, {
      accountId,
      customerId,
      items: [
        { quantity: 4, selected: false, skuId },
        { quantity: 10, selected: true, skuId: secondSkuId },
      ],
    });

    expect(result.changed).toBe(true);
    expect(state.transactionStub.$executeRaw).toHaveBeenCalledTimes(1);
    const updateQuery = state.transactionStub.$executeRaw.mock.calls[0]?.[0];
    expect(sqlText(updateQuery)).toContain('FROM jsonb_to_recordset');
    expect(sqlText(updateQuery)).toContain('AND item.cart_id =');
    expect(sqlValues(updateQuery)).toContain(cartId);
    expect(sqlValues(updateQuery)).toContain(JSON.stringify([{
      id: existingId,
      quantity: 99,
      selected: true,
    }]));
    expect(state.cartItem.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ quantity: 4, selected: false, sku_id: skuId })],
    });
    const sortedSkuIds = [skuId, secondSkuId].sort();
    expect(lockRequests(state.transactionStub.$queryRawUnsafe.mock.calls).slice(3)).toEqual([
      { namespace: 'product-catalog-sku', parts: [sortedSkuIds[0] as string] },
      { namespace: 'product-catalog-sku', parts: [sortedSkuIds[1] as string] },
      { namespace: 'store-cart-item', parts: [cartId, sortedSkuIds[0] as string] },
      { namespace: 'store-cart-item', parts: [cartId, sortedSkuIds[1] as string] },
    ]);
    expect(state.transactionStub.$queryRawUnsafe).toHaveBeenCalledTimes(5);
    expect(state.cartItem.update).not.toHaveBeenCalled();
    expect(state.cartItem.create).not.toHaveBeenCalled();
    expect(state.cart.update).toHaveBeenCalledTimes(1);
    expect(state.queryRaw).toHaveBeenCalledTimes(1);
  });

  it('rejects merge unions over 100 distinct SKUs without partial item writes', async () => {
    const state = harness();
    state.setCount(100);

    await expect(state.repository.mergeCartInTransaction(state.transaction, {
      accountId,
      customerId,
      items: [{ quantity: 1, selected: true, skuId }],
    })).rejects.toMatchObject({ code: 'CART_ITEM_LIMIT_EXCEEDED' });

    expect(state.cartItem.create).not.toHaveBeenCalled();
    expect(state.cartItem.createMany).not.toHaveBeenCalled();
    expect(state.cartItem.update).not.toHaveBeenCalled();
    expect(state.transactionStub.$executeRaw).not.toHaveBeenCalled();
  });

  it('locks every existing item in sorted SKU order before mutation replay projection', async () => {
    const state = harness({
      items: [
        storedItem(generateUlid(NOW.getTime() + 3_000), secondSkuId),
        storedItem(generateUlid(NOW.getTime() + 4_000), skuId),
      ],
    });

    await expect(state.repository.getCartForMutationInTransaction(state.transaction, { accountId, customerId }))
      .resolves.toMatchObject({ cartId });

    const sortedSkuIds = [skuId, secondSkuId].sort();
    expect(lockRequests(state.transactionStub.$queryRawUnsafe.mock.calls)).toEqual([
      { namespace: 'store-auth-account', parts: [accountId] },
      { namespace: 'store-auth-customer', parts: [customerId] },
      { namespace: 'store-cart', parts: [customerId] },
      { namespace: 'product-catalog-sku', parts: [sortedSkuIds[0] as string] },
      { namespace: 'product-catalog-sku', parts: [sortedSkuIds[1] as string] },
      { namespace: 'store-cart-item', parts: [cartId, sortedSkuIds[0] as string] },
      { namespace: 'store-cart-item', parts: [cartId, sortedSkuIds[1] as string] },
    ]);
    expect(state.transactionStub.$queryRawUnsafe).toHaveBeenCalledTimes(5);
  });

  it('merges 100 items with two batch locks and at most two set-based item writes', async () => {
    const skuIds = Array.from({ length: 100 }, (_, index) => generateUlid(NOW.getTime() + 10_000 + index));
    const existingItems = skuIds.slice(0, 50).map((idSku, index) =>
      storedItem(generateUlid(NOW.getTime() + 20_000 + index), idSku, 95, false));
    const state = harness({ items: existingItems });
    skuIds.forEach((id) => state.knownSkuIds.add(id));
    const incoming = [...skuIds].reverse().map((id, index) => ({
      quantity: index % 2 === 0 ? 10 : 4,
      selected: true,
      skuId: id,
    }));
    const originalRequestOrder = incoming.map(({ skuId: id }) => id);

    const result = await state.repository.mergeCartInTransaction(state.transaction, {
      accountId,
      customerId,
      items: incoming,
    });

    expect(result.changed).toBe(true);
    expect(result.cart.items).toHaveLength(100);
    expect(incoming.map(({ skuId: id }) => id)).toEqual(originalRequestOrder);
    expect(state.transactionStub.$queryRawUnsafe).toHaveBeenCalledTimes(5);
    const skuBatch = JSON.parse(state.transactionStub.$queryRawUnsafe.mock.calls[3]?.[1] as string) as {
      namespace: string;
      parts: string;
    }[];
    const itemBatch = JSON.parse(state.transactionStub.$queryRawUnsafe.mock.calls[4]?.[1] as string) as {
      namespace: string;
      parts: string;
    }[];
    const sortedSkuIds = [...skuIds].sort();
    expect(skuBatch).toEqual(sortedSkuIds.map((id) => ({
      namespace: 'product-catalog-sku',
      parts: JSON.stringify([id]),
    })));
    expect(itemBatch).toEqual(sortedSkuIds.map((id) => ({
      namespace: 'store-cart-item',
      parts: JSON.stringify([cartId, id]),
    })));
    expect(state.transactionStub.$executeRaw).toHaveBeenCalledTimes(1);
    expect(state.cartItem.createMany).toHaveBeenCalledTimes(1);
    const created = state.cartItem.createMany.mock.calls[0]?.[0].data as StoredItem[];
    expect(created).toHaveLength(50);
    expect(new Set(created.map(({ id }) => id)).size).toBe(50);
    expect(created.every(({ id }) => /^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))).toBe(true);
    expect(state.cartItem.update).not.toHaveBeenCalled();
    expect(state.cartItem.create).not.toHaveBeenCalled();
    expect(state.cart.update).toHaveBeenCalledTimes(1);
    expect(state.queryRaw).toHaveBeenCalledTimes(1);
    for (const initial of existingItems) {
      const stored = state.items.get(initial.sku_id);
      expect(stored?.id).toBe(initial.id);
      expect(stored?.created_at).toBe(initial.created_at);
    }
  });

  it('locks 100 replay items in two batch queries and keeps a saturated merge as an exact no-op', async () => {
    const skuIds = Array.from({ length: 100 }, (_, index) => generateUlid(NOW.getTime() + 30_000 + index));
    const existingItems = skuIds.map((idSku, index) =>
      storedItem(generateUlid(NOW.getTime() + 40_000 + index), idSku, 99, true));
    const replay = harness({ items: existingItems });
    skuIds.forEach((id) => replay.knownSkuIds.add(id));

    await expect(replay.repository.getCartForMutationInTransaction(replay.transaction, { accountId, customerId }))
      .resolves.toMatchObject({ cartId });

    expect(replay.transactionStub.$queryRawUnsafe).toHaveBeenCalledTimes(5);
    expect(lockRequests(replay.transactionStub.$queryRawUnsafe.mock.calls)).toHaveLength(203);
    expect(replay.transactionStub.$executeRaw).not.toHaveBeenCalled();
    expect(replay.cartItem.createMany).not.toHaveBeenCalled();
    expect(replay.cart.update).not.toHaveBeenCalled();

    const noOp = harness({ items: existingItems });
    skuIds.forEach((id) => noOp.knownSkuIds.add(id));
    await expect(noOp.repository.mergeCartInTransaction(noOp.transaction, {
      accountId,
      customerId,
      items: skuIds.map((id) => ({ quantity: 1, selected: false, skuId: id })),
    })).resolves.toMatchObject({ changed: false });
    expect(noOp.transactionStub.$queryRawUnsafe).toHaveBeenCalledTimes(5);
    expect(noOp.transactionStub.$executeRaw).not.toHaveBeenCalled();
    expect(noOp.cartItem.createMany).not.toHaveBeenCalled();
    expect(noOp.cart.update).not.toHaveBeenCalled();
  });

  it('fails closed on corrupt quantities, stock or prices', async () => {
    const quantity = harness();
    quantity.setProjectionRows([projectionRow({ quantity: 100 })]);
    await expect(quantity.repository.getCart({ accountId, customerId }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const stock = harness();
    stock.setProjectionRows([projectionRow({ available_stock: -1n })]);
    await expect(stock.repository.getCart({ accountId, customerId }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const price = harness();
    price.setProjectionRows([projectionRow({ retail_price: new Prisma.Decimal('0') })]);
    await expect(price.repository.getCart({ accountId, customerId }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    const stored = harness({
      items: [storedItem(generateUlid(NOW.getTime() + 5_000), skuId, 100)],
    });
    await expect(stored.repository.mergeCartInTransaction(stored.transaction, {
      accountId,
      customerId,
      items: [{ quantity: 1, selected: true, skuId }],
    })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(stored.cartItem.update).not.toHaveBeenCalled();
  });
});
