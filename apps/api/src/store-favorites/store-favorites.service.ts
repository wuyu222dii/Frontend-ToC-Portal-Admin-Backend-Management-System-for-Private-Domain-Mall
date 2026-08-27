import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  StoreFavoritesRepository,
  type StoreFavoriteSnapshot,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import type { StoreFavoriteListQuery } from './store-favorites.dto';

const FAVORITE_ROUTE = '/store/favorites/{product_id}';

@Injectable()
export class StoreFavoritesService {
  private readonly favorites!: StoreFavoritesRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.favorites = new StoreFavoritesRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
    }
  }

  async listFavorites(session: CurrentStoreSession, query: StoreFavoriteListQuery) {
    const result = await this.repository().listFavorites({
      ...this.identity(session),
      ...(query.keyword === undefined ? {} : { keyword: query.keyword }),
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      items: result.items.map((favorite) => this.favoriteView(favorite)),
      pagination: { page: query.page, page_size: query.pageSize, total: result.total },
    };
  }

  async getFavoriteState(session: CurrentStoreSession, productId: string) {
    const isFavorite = await this.repository().getFavoriteState({
      ...this.identity(session),
      productId,
    });
    return this.stateView(productId, isFavorite);
  }

  putFavorite(
    session: CurrentStoreSession,
    productId: string,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.mutateFavorite(session, productId, 'PUT', key, requestId, ipAddress);
  }

  deleteFavorite(
    session: CurrentStoreSession,
    productId: string,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.mutateFavorite(session, productId, 'DELETE', key, requestId, ipAddress);
  }

  private async mutateFavorite(
    session: CurrentStoreSession,
    productId: string,
    method: 'DELETE' | 'PUT',
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, productId, method, key);
    const input = { ...this.identity(session), productId };
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotency.claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const current = await this.repository().getFavoriteStateForMutationInTransaction(transaction, input);
        return this.stateView(productId, current);
      }

      let changed: boolean;
      let isFavorite: boolean;
      if (method === 'PUT') {
        const result = await this.repository().putFavoriteInTransaction(transaction, input);
        changed = result.created;
        isFavorite = true;
      } else {
        changed = await this.repository().deleteFavoriteInTransaction(transaction, input);
        isFavorite = false;
      }
      if (changed) {
        await this.appendPreferenceSafeAudit(transaction, session, key, requestId, ipAddress);
      }
      await this.idempotency.complete(transaction, claim, {
        responseForHash: { is_favorite: isFavorite },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return this.stateView(productId, isFavorite);
    });
  }

  private claim(
    actorId: string,
    productId: string,
    method: 'DELETE' | 'PUT',
    idempotencyKey: string,
  ): IdempotencyClaim {
    return {
      actorId,
      idempotencyKey,
      request: {
        body: {},
        method,
        pathParameters: { product_id: productId },
        route: FAVORITE_ROUTE,
      },
    };
  }

  private appendPreferenceSafeAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.audit.append(transaction, {
      action: 'UPDATE',
      actorAccountId: session.accountId,
      actorRole: 'CUSTOMER',
      idempotencyKey,
      ...(ipAddress ? { ipAddress } : {}),
      module: 'customer',
      objectId: session.customerId,
      objectType: 'customer',
      requestId,
      result: 'SUCCESS',
      resultCode: 'OK',
      summaryPolicy: 'NONE',
    });
  }

  private favoriteView(snapshot: StoreFavoriteSnapshot) {
    const product = snapshot.product;
    return {
      created_at: snapshot.createdAt.toISOString(),
      favorite_id: snapshot.id,
      product: {
        availability: product.availability,
        is_salable: product.isSalable,
        minimum_active_price: product.minimumActivePrice,
        name: product.name,
        primary_image_url: product.primaryImageObjectKey === null
          ? null
          : this.objectStorage().publicUrl(product.primaryImageObjectKey),
        product_id: product.id,
      },
    };
  }

  private stateView(productId: string, isFavorite: boolean) {
    return { is_favorite: isFavorite, product_id: productId };
  }

  private identity(session: CurrentStoreSession) {
    return { accountId: session.accountId, customerId: session.customerId };
  }

  private repository(): StoreFavoritesRepository {
    if (!this.favorites) throw new ApplicationError('INTERNAL_ERROR', 'Store favorites repository is unavailable');
    return this.favorites;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Store favorites database is unavailable');
    return this.database;
  }

  private objectStorage(): ObjectStoragePort {
    if (!this.storage) throw new ApplicationError('INTERNAL_ERROR', 'Store favorites storage is unavailable');
    return this.storage;
  }
}
