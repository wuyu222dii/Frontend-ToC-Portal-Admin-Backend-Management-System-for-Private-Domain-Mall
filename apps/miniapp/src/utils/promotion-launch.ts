import { isUlid } from './ids';

export interface PromotionLaunchInput {
  invite_code: string;
  promotion_asset_id: string;
}

export type PromotionLaunchParse =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'none' }
  | { readonly kind: 'ready'; readonly input: PromotionLaunchInput };

export type PublicStoreNavigation =
  | { readonly kind: 'home' }
  | { readonly kind: 'https'; readonly url: string }
  | { readonly kind: 'native'; readonly page: string };

const NATIVE_HOME = '/pages/index/index';
const NATIVE_PRODUCT = '/pages/product/detail';

let pendingLaunch: PromotionLaunchInput | null = null;
let consumedLaunchKey: string | null = null;

function queryRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') record[key] = entry;
  }
  return record;
}

function launchKey(input: PromotionLaunchInput): string {
  return `${input.invite_code}\0${input.promotion_asset_id}`;
}

export function parsePromotionLaunchQuery(query: unknown): PromotionLaunchParse {
  const record = queryRecord(query);
  const inviteCode = record.invite_code ?? '';
  const promotionAssetId = record.promotion_asset_id ?? '';
  if (inviteCode.length === 0 && promotionAssetId.length === 0) return { kind: 'none' };
  if (inviteCode.length < 1 || inviteCode.length > 128 || !isUlid(promotionAssetId)) {
    return { kind: 'invalid' };
  }
  return {
    kind: 'ready',
    input: { invite_code: inviteCode, promotion_asset_id: promotionAssetId },
  };
}

export function rememberPromotionLaunch(query: unknown): PromotionLaunchParse {
  const parsed = parsePromotionLaunchQuery(query);
  if (parsed.kind === 'ready' && consumedLaunchKey !== launchKey(parsed.input)) {
    pendingLaunch = parsed.input;
  }
  return parsed;
}

export function takePromotionLaunchQuery(pageQuery: unknown): PromotionLaunchParse {
  const fromPage = parsePromotionLaunchQuery(pageQuery);
  if (fromPage.kind === 'invalid') {
    pendingLaunch = null;
    return fromPage;
  }
  const input = fromPage.kind === 'ready' ? fromPage.input : pendingLaunch;
  pendingLaunch = null;
  if (input === null) return { kind: 'none' };
  const key = launchKey(input);
  if (consumedLaunchKey === key) return { kind: 'none' };
  consumedLaunchKey = key;
  return { kind: 'ready', input };
}

export function resetPromotionLaunchForTests(): void {
  pendingLaunch = null;
  consumedLaunchKey = null;
}

function isLocalHttpHost(hostname: string): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]';
}

function nativePageFromUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocalHttpHost(url.hostname))) ||
    url.username !== '' || url.password !== '') {
    return null;
  }
  const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
  if (!hash.startsWith('/pages/')) return null;
  const separator = hash.indexOf('?');
  const path = separator < 0 ? hash : hash.slice(0, separator);
  const query = separator < 0 ? '' : hash.slice(separator + 1);
  if (path === NATIVE_HOME) return NATIVE_HOME;
  if (path !== NATIVE_PRODUCT) return null;
  const productId = new URLSearchParams(query).get('product_id');
  if (productId === null || !isUlid(productId)) return null;
  return `${NATIVE_PRODUCT}?product_id=${encodeURIComponent(productId)}`;
}

export function resolvePublicStoreNavigation(url: string | null): PublicStoreNavigation {
  if (url === null || url.length === 0) return { kind: 'home' };
  const nativePage = nativePageFromUrl(url);
  if (nativePage !== null) return { kind: 'native', page: nativePage };
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '') {
      return { kind: 'https', url };
    }
  } catch {
    return { kind: 'home' };
  }
  return { kind: 'home' };
}
