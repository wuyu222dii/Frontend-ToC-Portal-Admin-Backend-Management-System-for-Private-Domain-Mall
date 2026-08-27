import type { CurrentStoreSession, DatabaseRuntime, DatabaseTransaction } from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StoreFavoritesService } from './store-favorites.service';

const ACCOUNT_ID = '01J00000000000000000000000';
const CUSTOMER_ID = '01J00000000000000000000001';
const PRODUCT_ID = '01J00000000000000000000002';
const FAVORITE_ID = '01J00000000000000000000003';
const IDEMPOTENCY_KEY = '00000000-0000-4000-8000-000000000000';
const REQUEST_ID = 'req_0123456789abcdef0123456789abcdef';

const session: CurrentStoreSession = {
  accessJti: 'access:01J00000000000000000000004',
  accountId: ACCOUNT_ID,
  accountVersion: 1,
  customerId: CUSTOMER_ID,
  customerVersion: 1,
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
  sessionFamily: '01J00000000000000000000005',
  sessionId: '01J00000000000000000000006',
};

function favorite(availability: 'SALEABLE' | 'OUT_OF_STOCK' | 'UNAVAILABLE') {
  const publicProduct = availability !== 'UNAVAILABLE';
  return {
    createdAt: new Date('2026-08-27T01:02:03.000Z'),
    id: FAVORITE_ID,
    product: {
      availability,
      id: PRODUCT_ID,
      isSalable: availability === 'SALEABLE',
      minimumActivePrice: publicProduct ? '19.90' : null,
      name: 'Daily cleanser',
      primaryImageObjectKey: publicProduct ? `public/${PRODUCT_ID}` : null,
    },
  };
}

function harness() {
  const transaction = {} as DatabaseTransaction;
  const prisma = {
    $transaction: vi.fn(async (work: (current: DatabaseTransaction) => Promise<unknown>) => work(transaction)),
  };
  const favorites = {
    deleteFavoriteInTransaction: vi.fn().mockResolvedValue(true),
    getFavoriteState: vi.fn().mockResolvedValue(true),
    getFavoriteStateForMutationInTransaction: vi.fn().mockResolvedValue(true),
    listFavorites: vi.fn().mockResolvedValue({ items: [favorite('SALEABLE')], total: 1 }),
    putFavoriteInTransaction: vi.fn().mockResolvedValue({ created: true, favoriteId: FAVORITE_ID }),
  };
  const idempotency = {
    claim: vi.fn().mockResolvedValue({ kind: 'execute' }),
    complete: vi.fn().mockResolvedValue({}),
  };
  const audit = { append: vi.fn().mockResolvedValue({}) };
  const storage = { publicUrl: vi.fn((key: string) => `https://assets.example.test/${key}`) };
  const service = new StoreFavoritesService();
  Object.assign(service, {
    audit,
    database: { prisma } as unknown as DatabaseRuntime,
    favorites,
    idempotency,
    storage,
  });
  return { audit, favorites, idempotency, prisma, service, storage, transaction };
}

describe('StoreFavoritesService', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps the closed consumer projection and only turns safe object keys into public URLs', async () => {
    const { favorites, service, storage } = harness();
    favorites.listFavorites.mockResolvedValue({
      items: [favorite('SALEABLE'), favorite('OUT_OF_STOCK'), favorite('UNAVAILABLE')],
      total: 3,
    });

    await expect(service.listFavorites(session, { keyword: 'Cleanser', page: 2, pageSize: 10 }))
      .resolves.toEqual({
        items: [
          expect.objectContaining({
            favorite_id: FAVORITE_ID,
            product: expect.objectContaining({
              availability: 'SALEABLE',
              is_salable: true,
              minimum_active_price: '19.90',
              primary_image_url: `https://assets.example.test/public/${PRODUCT_ID}`,
              product_id: PRODUCT_ID,
            }),
          }),
          expect.objectContaining({
            product: expect.objectContaining({ availability: 'OUT_OF_STOCK', is_salable: false }),
          }),
          expect.objectContaining({
            product: expect.objectContaining({
              availability: 'UNAVAILABLE',
              is_salable: false,
              minimum_active_price: null,
              primary_image_url: null,
            }),
          }),
        ],
        pagination: { page: 2, page_size: 10, total: 3 },
      });
    expect(favorites.listFavorites).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      keyword: 'Cleanser',
      page: 2,
      pageSize: 10,
    });
    expect(storage.publicUrl).toHaveBeenCalledTimes(2);
  });

  it('reads state by the authenticated customer even when the product projection is unavailable', async () => {
    const { favorites, service } = harness();
    favorites.getFavoriteState.mockResolvedValue(true);
    await expect(service.getFavoriteState(session, PRODUCT_ID)).resolves.toEqual({
      is_favorite: true,
      product_id: PRODUCT_ID,
    });
    expect(favorites.getFavoriteState).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      customerId: CUSTOMER_ID,
      productId: PRODUCT_ID,
    });
  });

  it('executes PUT once, writes preference-safe audit metadata and completes HASH_ONLY', async () => {
    const { audit, favorites, idempotency, prisma, service, transaction } = harness();

    await expect(service.putFavorite(
      session,
      PRODUCT_ID,
      IDEMPOTENCY_KEY,
      REQUEST_ID,
      '127.0.0.1',
    )).resolves.toEqual({ is_favorite: true, product_id: PRODUCT_ID });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
      maxWait: 5_000,
      timeout: 15_000,
    });
    expect(idempotency.claim).toHaveBeenCalledWith(transaction, {
      actorId: ACCOUNT_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      request: {
        body: {},
        method: 'PUT',
        pathParameters: { product_id: PRODUCT_ID },
        route: '/store/favorites/{product_id}',
      },
    });
    expect(favorites.putFavoriteInTransaction).toHaveBeenCalledTimes(1);
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
    expect(JSON.stringify(audit.append.mock.calls)).not.toContain(PRODUCT_ID);
    expect(idempotency.complete).toHaveBeenCalledWith(transaction, expect.objectContaining({
      idempotencyKey: IDEMPOTENCY_KEY,
    }), {
      responseForHash: { is_favorite: true },
      responseStatus: 200,
      storage: 'HASH_ONLY',
    });
  });

  it('does not add audit facts for a new-key duplicate PUT or a missing DELETE', async () => {
    const duplicate = harness();
    duplicate.favorites.putFavoriteInTransaction.mockResolvedValue({ created: false, favoriteId: FAVORITE_ID });
    await duplicate.service.putFavorite(session, PRODUCT_ID, IDEMPOTENCY_KEY, REQUEST_ID);
    expect(duplicate.audit.append).not.toHaveBeenCalled();
    expect(duplicate.idempotency.complete).toHaveBeenCalledWith(
      duplicate.transaction,
      expect.any(Object),
      expect.objectContaining({ responseForHash: { is_favorite: true }, storage: 'HASH_ONLY' }),
    );

    const missing = harness();
    missing.favorites.deleteFavoriteInTransaction.mockResolvedValue(false);
    await expect(missing.service.deleteFavorite(session, PRODUCT_ID, IDEMPOTENCY_KEY, REQUEST_ID))
      .resolves.toEqual({ is_favorite: false, product_id: PRODUCT_ID });
    expect(missing.audit.append).not.toHaveBeenCalled();
    expect(missing.idempotency.complete).toHaveBeenCalledWith(
      missing.transaction,
      expect.objectContaining({ request: expect.objectContaining({ method: 'DELETE' }) }),
      expect.objectContaining({ responseForHash: { is_favorite: false }, storage: 'HASH_ONLY' }),
    );
  });

  it.each([true, false])('replays current state %s without applying or completing the command', async (state) => {
    const { audit, favorites, idempotency, service } = harness();
    idempotency.claim.mockResolvedValue({ kind: 'replay', record: {} });
    favorites.getFavoriteStateForMutationInTransaction.mockResolvedValue(state);

    await expect(service.putFavorite(session, PRODUCT_ID, IDEMPOTENCY_KEY, REQUEST_ID))
      .resolves.toEqual({ is_favorite: state, product_id: PRODUCT_ID });
    expect(favorites.putFavoriteInTransaction).not.toHaveBeenCalled();
    expect(favorites.deleteFavoriteInTransaction).not.toHaveBeenCalled();
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });

  it('lets an unavailable PUT abort before audit and idempotency completion', async () => {
    const { audit, favorites, idempotency, service } = harness();
    favorites.putFavoriteInTransaction.mockRejectedValue(
      new ApplicationError('RESOURCE_NOT_FOUND', 'Product not found'),
    );
    await expect(service.putFavorite(session, PRODUCT_ID, IDEMPOTENCY_KEY, REQUEST_ID))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(audit.append).not.toHaveBeenCalled();
    expect(idempotency.complete).not.toHaveBeenCalled();
  });
});
