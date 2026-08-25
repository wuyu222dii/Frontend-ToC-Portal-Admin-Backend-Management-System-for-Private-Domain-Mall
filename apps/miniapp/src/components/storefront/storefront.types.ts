export type StoreNavTarget = 'home' | 'category' | 'cart' | 'profile';

export interface StoreProductCardData {
  product_id: string;
  name: string;
  subtitle?: string | null;
  brand?: {
    name: string;
  } | null;
  primary_image?: {
    url: string;
  } | null;
  minimum_active_price: string | number;
  net_sales_count: number;
  is_hot?: boolean;
  is_new?: boolean;
  is_salable: boolean;
}

