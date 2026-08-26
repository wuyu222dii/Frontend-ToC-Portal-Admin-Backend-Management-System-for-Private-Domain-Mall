import type { StoreProductDetail, StoreSku } from '../types/store-catalog';
import type { GuestCartItem, GuestCartItemSnapshot } from './guest-cart';

export type GuestCartAvailability = 'ready' | 'sold-out' | 'invalid' | 'unverified';

export interface GuestCartViewItem {
  availability: GuestCartAvailability;
  available_stock: number | null;
  item: GuestCartItem;
  price_changed: boolean;
  refresh_error: boolean;
  stock_changed: boolean;
}

export interface RefreshedGuestCartItem {
  item: GuestCartItem;
  view: GuestCartViewItem;
}

function skuSpecLabel(sku: StoreSku): string {
  const attributes = sku.spec_json?.attributes ?? [];
  return attributes.length > 0
    ? attributes.map((attribute) => `${attribute.name}：${attribute.value}`).join(' · ')
    : sku.name;
}

export function guestCartSnapshot(
  product: StoreProductDetail,
  sku: StoreSku,
): GuestCartItemSnapshot {
  const primaryImage = product.images.find((image) => image.is_primary) ?? product.images[0];
  return {
    product_id: product.product_id,
    product_name: product.name,
    sku_id: sku.sku_id,
    sku_name: sku.name,
    spec_label: skuSpecLabel(sku),
    image_url: primaryImage?.url ?? null,
    retail_price: sku.retail_price,
    available_stock: sku.available_stock,
    is_salable: sku.is_salable,
  };
}

export function unverifiedGuestCartView(
  item: GuestCartItem,
  refreshError = false,
): GuestCartViewItem {
  return {
    availability: 'unverified',
    available_stock: null,
    item,
    price_changed: false,
    refresh_error: refreshError,
    stock_changed: false,
  };
}

export function invalidGuestCartView(item: GuestCartItem): GuestCartViewItem {
  return {
    availability: 'invalid',
    available_stock: null,
    item,
    price_changed: false,
    refresh_error: false,
    stock_changed: false,
  };
}

export function refreshGuestCartItem(
  item: GuestCartItem,
  product: StoreProductDetail,
): RefreshedGuestCartItem | null {
  const sku = product.skus.find((candidate) => candidate.sku_id === item.snapshot.sku_id);
  if (sku === undefined) return null;

  const nextSnapshot = guestCartSnapshot(product, sku);
  const maximum = sku.is_salable ? Math.min(99, sku.available_stock) : 0;
  const nextItem: GuestCartItem = {
    ...item,
    quantity: maximum > 0 ? Math.min(item.quantity, maximum) : item.quantity,
    snapshot: nextSnapshot,
  };
  return {
    item: nextItem,
    view: {
      availability: maximum > 0 ? 'ready' : 'sold-out',
      available_stock: sku.available_stock,
      item: nextItem,
      price_changed: item.snapshot.retail_price !== nextSnapshot.retail_price,
      refresh_error: false,
      stock_changed: item.snapshot.available_stock !== nextSnapshot.available_stock ||
        item.snapshot.is_salable !== nextSnapshot.is_salable,
    },
  };
}

function priceInCents(value: string): number | null {
  const match = /^(0|[1-9][0-9]{0,15})\.([0-9]{2})$/.exec(value);
  if (!match) return null;
  const integer = Number(match[1]);
  const fraction = Number(match[2]);
  const cents = integer * 100 + fraction;
  return Number.isSafeInteger(cents) ? cents : null;
}

export function guestCartTotalAmount(items: readonly GuestCartViewItem[]): string {
  const cents = items.reduce((total, view) => {
    if (view.availability !== 'ready' || !view.item.selected) return total;
    const unitPrice = priceInCents(view.item.snapshot.retail_price);
    if (unitPrice === null) return total;
    const lineTotal = unitPrice * view.item.quantity;
    return Number.isSafeInteger(lineTotal) && Number.isSafeInteger(total + lineTotal)
      ? total + lineTotal
      : total;
  }, 0);
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
