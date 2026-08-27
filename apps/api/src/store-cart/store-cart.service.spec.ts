import type { CurrentStoreSession, DatabaseRuntime, DatabaseTransaction } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreCartService } from './store-cart.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const CART_ID = '01J00000000000000000000002';
const SKU_ID = '01J00000000000000000000003';
const PRODUCT_ID = '01J00000000000000000000004';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';

const session: CurrentStoreSession = {
  accessJti: 'access:01J00000000000000000000005',
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  customerId: CUSTOMER_ID,
  customerVersion: 1,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  sessionFamily: '01J00000000000000000000006',
  sessionId: '01J00000000000000000000007',
};

function cartSnapshot() {
  return {
    cartId: CART_ID,
    items: [{
      availableStock: 8,
      primaryImageObjectKey: `public/${PRODUCT_ID}`,
      productId: PRODUCT_ID,
      productName: 'Daily cleanser',
      quantity: 2,
      retailPrice: '19.90',
      saleStatus: 'SALEABLE' as const,
      selected: true,
      skuId: SKU_ID,
      skuName: '120 ml',
      specification: { volume: '120 ml' },
    }],
    totalAmount: '39.80',
  };
}

function harness() {
  const transaction = {} as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (current: DatabaseTransaction) => Promise<unknown>) => work(transaction)),
  };
  const carts = {
    deleteItemInTransaction: vi.fn().mockResolvedValue({ changed: true, cart: cartSnapshot() }),
    getCart: vi.fn().mockResolvedValue(cartSnapshot()),
    getCartForMutationInTransaction: vi.fn().mockResolvedValue(cartSnapshot()),
    mergeCartInTransaction: vi.fn().mockResolvedValue({ changed: true, cart: cartSnapshot() }),
    putItemInTransaction: vi.fn().mockResolvedValue({ changed: true, cart: cartSnapshot() }),
  };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const storage = { publicUrl: vi.fn((key: string) => `https://assets.example.test/${key}`) };
  const service = new StoreCartService();
  Object.assign(service, {
    audit,
    carts,
    database: { prisma } as unknown as DatabaseRuntime,
    idempotency,
    storage,
  });
  return { audit, carts, idempotency, prisma, service, storage, transaction };
}

describe('StoreCartService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the current cart projection and only resolves validated public object keys', async () => {
    const { carts, service, storage } = harness();

    await expect(service.getCart(session)).resolves.toEqual({
      cart_id: CART_ID,
      items: [{
        available_stock: 8,
        primary_image_url: `https://assets.example.test/public/${PRODUCT_ID}`,
        product_id: PRODUCT_ID,
        product_name: 'Daily cleanser',
        quantity: 2,
        retail_price: '19.90',
        sale_status: 'SALEABLE',
        selected: true,
        sku_id: SKU_ID,
        sku_name: '120 ml',
        spec_json: { volume: '120 ml' },
      }],
      total_amount: '39.80',
    });
    expect(carts.getCart).toHaveBeenCalledWith({ accountId: ACCOUNT_ID, customerId: CUSTOMER_ID });
    expect(storage.publicUrl).toHaveBeenCalledWith(`public/${PRODUCT_ID}`);
  });

  it('returns the empty zero-write projection without requiring object storage', async () => {
    const { carts, service, storage } = harness();
    carts.getCart.mockResolvedValue({ cartId: null, items: [], totalAmount: '0.00' });

    await expect(service.getCart(session)).resolves.toEqual({
      cart_id: null,
      items: [],
      total_amount: '0.00',
    });
    expect(storage.publicUrl).not.toHaveBeenCalled();
  });

  it('sets one item once, writes preference-safe audit and completes HASH_ONLY', async () => {
    const { audit, carts, idempotency, prisma, service, transaction } = harness();

    await service.putItem(
      session,
      SKU_ID,
      { quantity: 2, selected: true },
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      '127.0.0.1',
    );

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 15_000,
    });
    expect(idempotency.claim).toHaveBeenCalledWith(transaction, {
      actorId: ACCOUNT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      request: {
        body: { quantity: 2, selected: true },
        method: 'PUT',
        pathParameters: { sku_id: SKU_ID },
        route: '/store/cart/items/{sku_id}',
      },
    });
    expect(carts.putItemInTransaction).toHaveBeenCalledWith(transaction, {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      quantity: 2,
      selected: true,
      skuId: SKU_ID,
    });
    expect(audit.append).toHaveBeenCalledWith(transaction, {
      action: 'UPDATE',
      actorAccountId: ACCOUNT_ID,
      actorRole: 'CUSTOMER',
      idempotencyKey: IDEMPOTENCY_KEY,
      ipAddress: '127.0.0.1',
      module: 'customer',
      objectId: CUSTOMER_ID,
      objectType: 'customer',
      requestId: REQUEST_ID,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'NONE',
    });
    expect(JSON.stringify(audit.append.mock.calls)).not.toContain(SKU_ID);
    expect(idempotency.complete).toHaveBeenCalledWith(transaction, expect.any(Object), {
      responseForHash: { cart_command_completed: true },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  });

  it('hashes the exact wire merge body while passing normalized items to the repository', async () => {
    const { carts, idempotency, service, transaction } = harness();
    const input = { items: [{ quantity: 3, selected: false, skuId: SKU_ID }] };

    await service.mergeCart(session, input, IDEMPOTENCY_KEY, REQUEST_ID);

    expect(idempotency.claim).toHaveBeenCalledWith(transaction, expect.objectContaining({
      request: {
        body: { items: [{ quantity: 3, selected: false, sku_id: SKU_ID }] },
        method: 'POST',
        pathParameters: {},
        route: '/store/cart/merge',
      },
    }));
    expect(carts.mergeCartInTransaction).toHaveBeenCalledWith(transaction, {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      items: input.items,
    });
  });

  it('completes a new-key no-op without creating duplicate audit facts', async () => {
    const { audit, carts, idempotency, service } = harness();
    carts.deleteItemInTransaction.mockResolvedValue({ changed: false, cart: cartSnapshot() });

    await service.deleteItem(session, SKU_ID, IDEMPOTENCY_KEY, REQUEST_ID);

    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ request: expect.objectContaining({ body: {}, method: 'DELETE' }) }),
      expect.objectContaining({ storage: 'HASH_ONLY' }),
    );
  });

  it('replays the current projection without reapplying, auditing or completing the command', async () => {
    const { audit, carts, idempotency, service, transaction } = harness();
    idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });
    carts.getCartForMutationInTransaction.mockResolvedValue({ cartId: null, items: [], totalAmount: '0.00' });

    await expect(service.mergeCart(
      session,
      { items: [{ quantity: 1, selected: true, skuId: SKU_ID }] },
      IDEMPOTENCY_KEY,
      REQUEST_ID,
    )).resolves.toEqual({ cart_id: null, items: [], total_amount: '0.00' });
    expect(carts.getCartForMutationInTransaction).toHaveBeenCalledWith(transaction, {
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
    });
    expect(carts.mergeCartInTransaction).not.toHaveBeenCalled();
    expect(carts.putItemInTransaction).not.toHaveBeenCalled();
    expect(carts.deleteItemInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('rolls command failures back before audit and idempotency completion', async () => {
    const { audit, carts, idempotency, service } = harness();
    carts.putItemInTransaction.mockRejectedValue(
      new ApplicationError('RESOURCE_NOT_FOUND', 'SKU not found'),
    );

    await expect(service.putItem(
      session,
      SKU_ID,
      { quantity: 1, selected: true },
      IDEMPOTENCY_KEY,
      REQUEST_ID,
    )).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('propagates an idempotency conflict before acquiring cart mutation state', async () => {
    const { audit, carts, idempotency, service } = harness();
    idempotency.claim.mockRejectedValue(
      new ApplicationError('STATE_CONFLICT', 'Idempotency key was already used for another request'),
    );

    await expect(service.deleteItem(session, SKU_ID, IDEMPOTENCY_KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(carts.deleteItemInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
