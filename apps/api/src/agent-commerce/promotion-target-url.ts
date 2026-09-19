import { ApplicationError } from '@qingxu/platform-core';

export const STOREFRONT_MINI_PROGRAM_PATH = 'pages/index/index';
export const PRODUCT_MINI_PROGRAM_PATH = 'pages/product/detail';
const MAX_PROMOTION_URL_LENGTH = 500;

export interface PromotionTargetInput {
  targetId: string | null;
  targetType: 'PRODUCT' | 'STOREFRONT';
}

function tooLong(): never {
  throw new ApplicationError('INTERNAL_ERROR', 'Promotion target URL is too long');
}

function boundedUrl(value: string): string {
  if (value.length > MAX_PROMOTION_URL_LENGTH) return tooLong();
  return value;
}

function splitHash(hash: string): { path: string; query: string } {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const separator = raw.indexOf('?');
  if (separator < 0) return { path: raw, query: '' };
  return { path: raw.slice(0, separator), query: raw.slice(separator + 1) };
}

export function promotionMiniProgramPath(input: PromotionTargetInput): string {
  return input.targetType === 'PRODUCT' ? PRODUCT_MINI_PROGRAM_PATH : STOREFRONT_MINI_PROGRAM_PATH;
}

export function promotionMiniProgramQuery(
  input: PromotionTargetInput & { inviteCode: string; promotionAssetId: string },
): string {
  const params = new URLSearchParams();
  if (input.targetType === 'PRODUCT') {
    if (input.targetId === null) {
      throw new ApplicationError('INTERNAL_ERROR', 'Promotion product target is missing');
    }
    params.set('product_id', input.targetId);
  }
  params.set('invite_code', input.inviteCode);
  params.set('promotion_asset_id', input.promotionAssetId);
  return params.toString();
}

export function promotionTargetUrl(baseUrl: string, input: PromotionTargetInput): string {
  const url = new URL(baseUrl);
  if (input.targetType === 'PRODUCT') {
    if (input.targetId === null) {
      throw new ApplicationError('INTERNAL_ERROR', 'Promotion product target is missing');
    }
    url.hash = `/${PRODUCT_MINI_PROGRAM_PATH}?product_id=${encodeURIComponent(input.targetId)}`;
  } else {
    url.hash = `/${STOREFRONT_MINI_PROGRAM_PATH}`;
  }
  return boundedUrl(url.toString());
}

export function promotionShareUrl(
  publicTargetUrl: string,
  inviteCode: string,
  promotionAssetId: string,
): string {
  const url = new URL(publicTargetUrl);
  const hash = splitHash(url.hash);
  if (hash.path.startsWith('/pages/')) {
    const params = new URLSearchParams(hash.query);
    params.set('invite_code', inviteCode);
    params.set('promotion_asset_id', promotionAssetId);
    url.hash = `${hash.path}?${params.toString()}`;
    return boundedUrl(url.toString());
  }
  url.searchParams.set('invite_code', inviteCode);
  url.searchParams.set('promotion_asset_id', promotionAssetId);
  return boundedUrl(url.toString());
}
