import type { components } from '@qingxu/contracts';

import type {
  AddressWriteInput,
  CartItemWriteInput,
  CartMergeInput,
  FavoriteList,
  FavoriteState,
  StoreAddressDetail,
  StoreAddressSummary,
  StoreCart,
} from '../types/store-shopping';
import { StoreEnvelopeFormatError } from './store-client';
import { authenticatedRequest, createIdempotencyKey } from './store-identity';
import { decodeCommandData } from './store-identity-decoders';
import {
  decodeFavoriteList,
  decodeFavoriteState,
  decodeStoreAddressDetail,
  decodeStoreAddressList,
  decodeStoreCart,
} from './store-shopping-decoders';

type CommandData = components['schemas']['CommandResponse']['data'];

function ulidPath(value: string, field: string): string {
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(value)) throw new Error(`${field} is invalid`);
  return encodeURIComponent(value);
}

function favoriteStateDecoder(productId: string): (value: unknown) => FavoriteState {
  return (value) => {
    const result = decodeFavoriteState(value);
    if (result.product_id !== productId) throw new StoreEnvelopeFormatError();
    return result;
  };
}

function versionHeader(version: number): string {
  if (!Number.isInteger(version) || version < 1) throw new Error('version is invalid');
  return `"${version}"`;
}

export function listFavorites(query: {
  readonly keyword?: string;
  readonly page?: number;
  readonly page_size?: number;
} = {}): Promise<FavoriteList> {
  return authenticatedRequest('/store/favorites', {
    decode: decodeFavoriteList,
    query,
  });
}

export function getFavoriteState(productId: string): Promise<FavoriteState> {
  return authenticatedRequest(`/store/favorites/${ulidPath(productId, 'product_id')}`, {
    decode: favoriteStateDecoder(productId),
  });
}

export function putFavorite(productId: string, idempotencyKey = createIdempotencyKey()): Promise<FavoriteState> {
  return authenticatedRequest(`/store/favorites/${ulidPath(productId, 'product_id')}`, {
    decode: favoriteStateDecoder(productId),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'PUT',
  });
}

export function deleteFavorite(productId: string, idempotencyKey = createIdempotencyKey()): Promise<FavoriteState> {
  return authenticatedRequest(`/store/favorites/${ulidPath(productId, 'product_id')}`, {
    decode: favoriteStateDecoder(productId),
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'DELETE',
  });
}

export function getStoreCart(): Promise<StoreCart> {
  return authenticatedRequest('/store/cart', { decode: decodeStoreCart });
}

export function putStoreCartItem(
  skuId: string,
  input: CartItemWriteInput,
  idempotencyKey = createIdempotencyKey(),
): Promise<StoreCart> {
  return authenticatedRequest(`/store/cart/items/${ulidPath(skuId, 'sku_id')}`, {
    data: input,
    decode: decodeStoreCart,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'PUT',
  });
}

export function deleteStoreCartItem(skuId: string, idempotencyKey = createIdempotencyKey()): Promise<StoreCart> {
  return authenticatedRequest(`/store/cart/items/${ulidPath(skuId, 'sku_id')}`, {
    decode: decodeStoreCart,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'DELETE',
  });
}

export function mergeStoreCart(
  input: CartMergeInput,
  idempotencyKey: string,
): Promise<StoreCart> {
  return authenticatedRequest('/store/cart/merge', {
    data: input,
    decode: decodeStoreCart,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export function listStoreAddresses(): Promise<StoreAddressSummary[]> {
  return authenticatedRequest('/store/addresses', { decode: decodeStoreAddressList });
}

export function createStoreAddress(
  input: AddressWriteInput,
  idempotencyKey = createIdempotencyKey(),
): Promise<StoreAddressDetail> {
  return authenticatedRequest('/store/addresses', {
    data: input,
    decode: decodeStoreAddressDetail,
    headers: { 'Idempotency-Key': idempotencyKey },
    method: 'POST',
  });
}

export function getStoreAddress(addressId: string): Promise<StoreAddressDetail> {
  return authenticatedRequest(`/store/addresses/${ulidPath(addressId, 'address_id')}`, {
    decode: decodeStoreAddressDetail,
  });
}

export function updateStoreAddress(
  addressId: string,
  input: AddressWriteInput,
  version: number,
  idempotencyKey = createIdempotencyKey(),
): Promise<StoreAddressDetail> {
  return authenticatedRequest(`/store/addresses/${ulidPath(addressId, 'address_id')}`, {
    data: input,
    decode: decodeStoreAddressDetail,
    headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': versionHeader(version) },
    method: 'PATCH',
  });
}

export function deleteStoreAddress(
  addressId: string,
  version: number,
  idempotencyKey = createIdempotencyKey(),
): Promise<CommandData> {
  return authenticatedRequest(`/store/addresses/${ulidPath(addressId, 'address_id')}`, {
    decode: decodeCommandData,
    headers: { 'Idempotency-Key': idempotencyKey, 'If-Match': versionHeader(version) },
    method: 'DELETE',
  });
}
