import type { components } from '@qingxu/contracts';

export type FavoriteProduct = components['schemas']['FavoriteProductView'];
export type Favorite = components['schemas']['FavoriteView'];
export type FavoriteList = components['schemas']['FavoriteListResponse']['data'];
export type FavoriteState = components['schemas']['FavoriteStateResponse']['data'];

export type StoreCart = components['schemas']['CartResponse']['data'];
export type StoreCartItem = components['schemas']['CartItemView'];
export type CartItemWriteInput = components['schemas']['CartItemWriteRequest'];
export type CartMergeItemInput = components['schemas']['CartMergeItemInput'];
export type CartMergeInput = components['schemas']['CartMergeRequest'];

export type StoreAddressSummary = components['schemas']['StoreAddressSummaryView'];
export type StoreAddressDetail = components['schemas']['StoreAddressDetailView'];
export type AddressWriteInput = components['schemas']['AddressWriteRequest'];
