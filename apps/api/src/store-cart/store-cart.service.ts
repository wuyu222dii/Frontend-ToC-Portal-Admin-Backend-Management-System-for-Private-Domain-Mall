import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  AuditRepository,
  type CurrentStoreSession,
  type DatabaseRuntime,
  type DatabaseTransaction,
  IdempotencyRepository,
  type IdempotencyClaim,
  StoreCartRepository,
  type StoreCartSnapshot,
  runSerializableTransaction,
} from '@qingxu/database';
import { ApplicationError } from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import type { StoreCartItemWriteRequest, StoreCartMergeRequest } from './store-cart.dto';

const CART_ITEM_ROUTE = '/store/cart/items/{sku_id}';
const CART_MERGE_ROUTE = '/store/cart/merge';

@Injectable()
export class StoreCartService {
  private readonly carts!: StoreCartRepository;
  private readonly audit!: AuditRepository;
  private readonly idempotency!: IdempotencyRepository;

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.carts = new StoreCartRepository(database.prisma);
      this.audit = new AuditRepository(config.encryption.ipHashKey);
      this.idempotency = new IdempotencyRepository(config.encryption.idempotencyHashKeys);
    }
  }

  async getCart(session: CurrentStoreSession) {
    return this.cartView(await this.repository().getCart(this.identity(session)));
  }

  putItem(
    session: CurrentStoreSession,
    skuId: string,
    input: StoreCartItemWriteRequest,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, {
      body: { quantity: input.quantity, selected: input.selected },
      method: 'PUT',
      pathParameters: { sku_id: skuId },
      route: CART_ITEM_ROUTE,
    });
    return this.executeCommand(
      session,
      claim,
      (transaction) => this.repository().putItemInTransaction(transaction, {
        ...this.identity(session),
        quantity: input.quantity,
        selected: input.selected,
        skuId,
      }),
      requestId,
      ipAddress,
    );
  }

  deleteItem(
    session: CurrentStoreSession,
    skuId: string,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, {
      body: {},
      method: 'DELETE',
      pathParameters: { sku_id: skuId },
      route: CART_ITEM_ROUTE,
    });
    return this.executeCommand(
      session,
      claim,
      (transaction) => this.repository().deleteItemInTransaction(transaction, {
        ...this.identity(session),
        skuId,
      }),
      requestId,
      ipAddress,
    );
  }

  mergeCart(
    session: CurrentStoreSession,
    input: StoreCartMergeRequest,
    key: string,
    requestId: string,
    ipAddress?: string,
  ) {
    const claim = this.claim(session.accountId, key, {
      body: {
        items: input.items.map((item) => ({
          quantity: item.quantity,
          selected: item.selected,
          sku_id: item.skuId,
        })),
      },
      method: 'POST',
      pathParameters: {},
      route: CART_MERGE_ROUTE,
    });
    return this.executeCommand(
      session,
      claim,
      (transaction) => this.repository().mergeCartInTransaction(transaction, {
        ...this.identity(session),
        items: input.items,
      }),
      requestId,
      ipAddress,
    );
  }

  private async executeCommand(
    session: CurrentStoreSession,
    claim: IdempotencyClaim,
    command: (transaction: DatabaseTransaction) => Promise<{ changed: boolean; cart: StoreCartSnapshot }>,
    requestId: string,
    ipAddress?: string,
  ) {
    return runSerializableTransaction(this.databaseRuntime().prisma, async (transaction) => {
      const claimed = await this.idempotencyRepository().claim(transaction, claim);
      if (claimed.kind === 'replay') {
        const current = await this.repository().getCartForMutationInTransaction(
          transaction,
          this.identity(session),
        );
        return this.cartView(current);
      }

      const result = await command(transaction);
      if (result.changed) {
        await this.appendPreferenceSafeAudit(transaction, session, claim.idempotencyKey, requestId, ipAddress);
      }
      await this.idempotencyRepository().complete(transaction, claim, {
        responseForHash: { cart_command_completed: true },
        responseStatus: 200,
        storage: 'HASH_ONLY',
      });
      return this.cartView(result.cart);
    });
  }

  private claim(
    actorId: string,
    idempotencyKey: string,
    request: IdempotencyClaim['request'],
  ): IdempotencyClaim {
    return { actorId, idempotencyKey, request };
  }

  private appendPreferenceSafeAudit(
    transaction: DatabaseTransaction,
    session: CurrentStoreSession,
    idempotencyKey: string,
    requestId: string,
    ipAddress?: string,
  ) {
    return this.auditRepository().append(transaction, {
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

  private cartView(snapshot: StoreCartSnapshot) {
    return {
      cart_id: snapshot.cartId,
      items: snapshot.items.map((item) => ({
        available_stock: item.availableStock,
        primary_image_url: item.primaryImageObjectKey === null
          ? null
          : this.objectStorage().publicUrl(item.primaryImageObjectKey),
        product_id: item.productId,
        product_name: item.productName,
        quantity: item.quantity,
        retail_price: item.retailPrice,
        sale_status: item.saleStatus,
        selected: item.selected,
        sku_id: item.skuId,
        sku_name: item.skuName,
        spec_json: item.specification,
      })),
      total_amount: snapshot.totalAmount,
    };
  }

  private identity(session: CurrentStoreSession) {
    return { accountId: session.accountId, customerId: session.customerId };
  }

  private repository(): StoreCartRepository {
    if (!this.carts) throw new ApplicationError('INTERNAL_ERROR', 'Store cart repository is unavailable');
    return this.carts;
  }

  private idempotencyRepository(): IdempotencyRepository {
    if (!this.idempotency) throw new ApplicationError('INTERNAL_ERROR', 'Idempotency repository is unavailable');
    return this.idempotency;
  }

  private auditRepository(): AuditRepository {
    if (!this.audit) throw new ApplicationError('INTERNAL_ERROR', 'Audit repository is unavailable');
    return this.audit;
  }

  private databaseRuntime(): DatabaseRuntime {
    if (!this.database) throw new ApplicationError('INTERNAL_ERROR', 'Store cart database is unavailable');
    return this.database;
  }

  private objectStorage(): ObjectStoragePort {
    if (!this.storage) throw new ApplicationError('INTERNAL_ERROR', 'Store cart storage is unavailable');
    return this.storage;
  }
}
