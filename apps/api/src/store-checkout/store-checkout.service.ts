import { Inject, Injectable, Optional } from '@nestjs/common';
import type { PlatformRuntimeConfig } from '@qingxu/config';
import {
  type CurrentStoreSession,
  type DatabaseRuntime,
  StoreCheckoutRepository,
  type StoreCheckoutQuoteSnapshot,
} from '@qingxu/database';
import {
  ApplicationError,
  generateUlid,
  maskStoreAddressRecipient,
  verifyStoreAddressSecurityMaterial,
} from '@qingxu/platform-core';
import type { ObjectStoragePort } from '@qingxu/storage';

import { API_RUNTIME_CONFIG } from '../platform/config/api-runtime-config';
import { API_DATABASE_RUNTIME } from '../platform/database/api-database-runtime';
import { API_OBJECT_STORAGE } from '../platform/storage/api-object-storage';
import { storeSkuSpecification } from '../store-catalog/store-sku-specification';
import { StoreCheckoutQuoteCredential } from './store-checkout-quote-credential';
import type { StoreCheckoutQuoteRequest } from './store-checkout.dto';

function internal(message: string, cause?: unknown): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', message, [], cause === undefined ? undefined : { cause });
}

export function storeCheckoutQuoteRequestBinding(input: StoreCheckoutQuoteRequest) {
  return {
    address_id: input.addressId,
    items: input.items
      .map((item) => ({ quantity: item.quantity, sku_id: item.skuId }))
      .sort((left, right) => left.sku_id < right.sku_id ? -1 : left.sku_id > right.sku_id ? 1 : 0),
    source: input.source,
  };
}

export function storeCheckoutQuoteFactBinding(snapshot: StoreCheckoutQuoteSnapshot) {
  return {
    address: {
      address_id: snapshot.address.addressId,
      version: snapshot.address.version,
    },
    cart: snapshot.source === 'CART' ? {
      cart_id: snapshot.cart.cartId,
      selected_items: snapshot.cart.selectedItems.map((item) => ({
        quantity: item.quantity,
        sku_id: item.skuId,
      })),
    } : null,
    goods_amount: snapshot.goodsAmount,
    items: snapshot.items.map((item) => ({
      available_stock: item.availableStock,
      brand_id: item.brandId,
      brand_version: item.brandVersion,
      category_id: item.categoryId,
      category_version: item.categoryVersion,
      inventory_balance_id: item.inventoryBalanceId,
      inventory_version: item.inventoryVersion,
      line_amount: item.lineAmount,
      primary_image_file_id: item.primaryImageFileId,
      primary_image_id: item.primaryImageId,
      primary_image_object_key: item.primaryImageObjectKey,
      product_id: item.productId,
      product_version: item.productVersion,
      quantity: item.quantity,
      sku_id: item.skuId,
      sku_version: item.skuVersion,
      unit_price: item.unitPrice,
    })).sort((left, right) => left.sku_id < right.sku_id ? -1 : left.sku_id > right.sku_id ? 1 : 0),
    payable_amount: snapshot.payableAmount,
    shipping_amount: snapshot.shippingAmount,
    source: snapshot.source,
  };
}

@Injectable()
export class StoreCheckoutService {
  private readonly checkout!: StoreCheckoutRepository;
  private readonly credentials!: StoreCheckoutQuoteCredential;
  private readonly clock = () => new Date();

  constructor(
    @Optional() @Inject(API_RUNTIME_CONFIG) private readonly config?: PlatformRuntimeConfig,
    @Optional() @Inject(API_DATABASE_RUNTIME) private readonly database?: DatabaseRuntime,
    @Optional() @Inject(API_OBJECT_STORAGE) private readonly storage?: ObjectStoragePort,
  ) {
    if (config && database) {
      this.checkout = new StoreCheckoutRepository(database.prisma);
      this.credentials = new StoreCheckoutQuoteCredential(
        config.encryption.idempotencyHashKeys,
        { clock: () => this.currentDate() },
      );
    }
  }

  async quote(session: CurrentStoreSession, input: StoreCheckoutQuoteRequest) {
    const snapshot = await this.repository().quote({
      accountId: session.accountId,
      addressId: input.addressId,
      customerId: session.customerId,
      items: input.items,
      source: input.source,
    });
    this.assertSnapshot(snapshot, session, input);

    const address = this.addressView(snapshot);
    const items = snapshot.items.map((item) => ({
      available_stock: item.availableStock,
      line_amount: item.lineAmount,
      primary_image_url: item.primaryImageObjectKey === null
        ? null
        : this.objectStorage().publicUrl(item.primaryImageObjectKey),
      product_id: item.productId,
      product_name: item.productName,
      quantity: item.quantity,
      saleable: item.saleable,
      sku_id: item.skuId,
      sku_name: item.skuName,
      spec_json: storeSkuSpecification(item.specification),
      unit_price: item.unitPrice,
    }));
    const quoteId = generateUlid();
    const request = storeCheckoutQuoteRequestBinding(input);
    const facts = storeCheckoutQuoteFactBinding(snapshot);
    const issued = snapshot.canSubmit
      ? this.credential().issue({
          customerId: session.customerId,
          facts,
          quoteId,
          request,
          sessionId: session.sessionId,
        })
      : null;

    return {
      address,
      blockers: snapshot.blockers,
      can_submit: snapshot.canSubmit,
      confirmation_hash: issued?.confirmationHash ?? null,
      expires_at: issued?.expiresAt.toISOString() ?? null,
      goods_amount: snapshot.goodsAmount,
      items,
      payable_amount: snapshot.payableAmount,
      quote_id: quoteId,
      quote_token: issued?.quoteToken ?? null,
      server_time: (issued?.issuedAt ?? this.currentDate()).toISOString(),
      shipping_amount: snapshot.shippingAmount,
      source: snapshot.source,
    };
  }

  private assertSnapshot(
    snapshot: StoreCheckoutQuoteSnapshot,
    session: CurrentStoreSession,
    input: StoreCheckoutQuoteRequest,
  ): void {
    if (snapshot.source !== input.source || snapshot.address.addressId !== input.addressId ||
      snapshot.address.customerId !== session.customerId || snapshot.shippingAmount !== '0.00' ||
      snapshot.items.length !== input.items.length ||
      snapshot.canSubmit !== (snapshot.blockers.length === 0) ||
      (snapshot.source === 'CART' && snapshot.cart.selectionMatches === snapshot.blockers.includes('CART_SELECTION_CHANGED'))) {
      throw internal('Store checkout quote snapshot is inconsistent');
    }
    const requested = input.items
      .map(({ quantity, skuId }) => ({ quantity, skuId }))
      .sort((left, right) => left.skuId < right.skuId ? -1 : left.skuId > right.skuId ? 1 : 0);
    const quoted = snapshot.items
      .map(({ quantity, skuId }) => ({ quantity, skuId }))
      .sort((left, right) => left.skuId < right.skuId ? -1 : left.skuId > right.skuId ? 1 : 0);
    if (requested.some((item, index) => item.skuId !== quoted[index]?.skuId ||
      item.quantity !== quoted[index]?.quantity)) {
      throw internal('Store checkout quote line projection is inconsistent');
    }
  }

  private addressView(snapshot: StoreCheckoutQuoteSnapshot) {
    const address = snapshot.address;
    try {
      const protectedMaterial = verifyStoreAddressSecurityMaterial({
        addressId: address.addressId,
        detailCiphertext: address.detailCiphertext,
        encryptionKeyId: address.encryptionKeyId,
        phoneCiphertext: address.phoneCiphertext,
        phoneHash: address.phoneHash,
        phoneLast4: address.phoneLast4,
      }, this.runtime().encryption.fieldKeys, this.runtime().store.phoneHashKeys);
      return {
        address_id: address.addressId,
        city: address.city,
        detail_masked: protectedMaterial.detailMasked,
        district: address.district,
        is_default: address.isDefault,
        phone_masked: protectedMaterial.phoneMasked,
        province: address.province,
        recipient_name_masked: maskStoreAddressRecipient(address.recipientName),
        version: address.version,
      };
    } catch (cause) {
      throw internal('Stored checkout address material is unreadable', cause);
    }
  }

  private repository(): StoreCheckoutRepository {
    if (!this.checkout) throw internal('Store checkout repository is unavailable');
    return this.checkout;
  }

  private credential(): StoreCheckoutQuoteCredential {
    if (!this.credentials) throw internal('Store checkout quote credential is unavailable');
    return this.credentials;
  }

  private runtime(): PlatformRuntimeConfig {
    if (!this.config) throw internal('Store checkout runtime is unavailable');
    return this.config;
  }

  private objectStorage(): ObjectStoragePort {
    if (!this.storage) throw internal('Store checkout storage is unavailable');
    return this.storage;
  }

  private currentDate(): Date {
    const value = this.clock();
    if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
      throw internal('Store checkout clock is unavailable');
    }
    return new Date(Math.floor(value.getTime() / 1_000) * 1_000);
  }
}
