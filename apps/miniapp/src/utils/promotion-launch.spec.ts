import { describe, expect, it } from 'vitest';

import {
  parsePromotionLaunchQuery,
  rememberPromotionLaunch,
  resetPromotionLaunchForTests,
  resolvePublicStoreNavigation,
  takePromotionLaunchQuery,
} from './promotion-launch';

const PRODUCT_ID = '01J7Z3K4M5N6P7Q8R9S0T1V2W3';
const PROMOTION_ASSET_ID = '01HZXK3M4N5P6Q7R8S9T0V1W2Y';
const INVITE_CODE = 'AGT-abcdefghijklmnop';

describe('promotion launch query', () => {
  it('accepts a complete invite pair and ignores extra product id', () => {
    expect(parsePromotionLaunchQuery({
      invite_code: INVITE_CODE,
      product_id: PRODUCT_ID,
      promotion_asset_id: PROMOTION_ASSET_ID,
    })).toEqual({
      kind: 'ready',
      input: { invite_code: INVITE_CODE, promotion_asset_id: PROMOTION_ASSET_ID },
    });
  });

  it('returns none when both invite fields are absent', () => {
    expect(parsePromotionLaunchQuery({ product_id: PRODUCT_ID })).toEqual({ kind: 'none' });
    expect(parsePromotionLaunchQuery(undefined)).toEqual({ kind: 'none' });
  });

  it('rejects missing pairs and non-ULID promotion assets', () => {
    expect(parsePromotionLaunchQuery({ invite_code: INVITE_CODE })).toEqual({ kind: 'invalid' });
    expect(parsePromotionLaunchQuery({
      invite_code: INVITE_CODE,
      promotion_asset_id: 'not-a-ulid',
    })).toEqual({ kind: 'invalid' });
    expect(parsePromotionLaunchQuery({
      invite_code: '',
      promotion_asset_id: PROMOTION_ASSET_ID,
    })).toEqual({ kind: 'invalid' });
  });

  it('consumes a remembered launch query once', () => {
    resetPromotionLaunchForTests();
    rememberPromotionLaunch({
      invite_code: INVITE_CODE,
      promotion_asset_id: PROMOTION_ASSET_ID,
    });
    expect(takePromotionLaunchQuery({})).toEqual({
      kind: 'ready',
      input: { invite_code: INVITE_CODE, promotion_asset_id: PROMOTION_ASSET_ID },
    });
    expect(takePromotionLaunchQuery({
      invite_code: INVITE_CODE,
      promotion_asset_id: PROMOTION_ASSET_ID,
    })).toEqual({ kind: 'none' });
  });
});

describe('public store navigation', () => {
  it('opens native home and product pages from mini-program hash targets', () => {
    expect(resolvePublicStoreNavigation('https://mall.example.test/#/pages/index/index'))
      .toEqual({ kind: 'native', page: '/pages/index/index' });
    expect(resolvePublicStoreNavigation(
      `http://127.0.0.1:8080/#/pages/product/detail?product_id=${PRODUCT_ID}&invite_code=${INVITE_CODE}`,
    )).toEqual({
      kind: 'native',
      page: `/pages/product/detail?product_id=${PRODUCT_ID}`,
    });
  });

  it('keeps unknown HTTPS URLs as external targets and falls back home otherwise', () => {
    expect(resolvePublicStoreNavigation('https://example.invalid/legal')).toEqual({
      kind: 'https',
      url: 'https://example.invalid/legal',
    });
    expect(resolvePublicStoreNavigation(null)).toEqual({ kind: 'home' });
    expect(resolvePublicStoreNavigation('not a url')).toEqual({ kind: 'home' });
  });
});
