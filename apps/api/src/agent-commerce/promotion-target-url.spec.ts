import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  PRODUCT_MINI_PROGRAM_PATH,
  STOREFRONT_MINI_PROGRAM_PATH,
  promotionMiniProgramPath,
  promotionMiniProgramQuery,
  promotionShareUrl,
  promotionTargetUrl,
} from './promotion-target-url';

const PRODUCT_ID = '01J7Z3K4M5N6P7Q8R9S0T1V2W3';
const PROMOTION_ASSET_ID = '01HZXK3M4N5P6Q7R8S9T0V1W2Y';
const INVITE_CODE = 'AGT-abcdefghijklmnop';

describe('promotion target URLs', () => {
  it('builds storefront and product mini-program hash targets', () => {
    expect(promotionTargetUrl('http://127.0.0.1:8080', {
      targetId: null,
      targetType: 'STOREFRONT',
    })).toBe('http://127.0.0.1:8080/#/pages/index/index');
    expect(promotionTargetUrl('https://mall.example.test', {
      targetId: PRODUCT_ID,
      targetType: 'PRODUCT',
    })).toBe(`https://mall.example.test/#/pages/product/detail?product_id=${PRODUCT_ID}`);
  });

  it('puts invite parameters into the hash query', () => {
    const target = promotionTargetUrl('https://mall.example.test', {
      targetId: PRODUCT_ID,
      targetType: 'PRODUCT',
    });
    const shared = promotionShareUrl(target, INVITE_CODE, PROMOTION_ASSET_ID);
    expect(shared).toBe(
      `https://mall.example.test/#/pages/product/detail?product_id=${PRODUCT_ID}` +
      `&invite_code=${INVITE_CODE}&promotion_asset_id=${PROMOTION_ASSET_ID}`,
    );
    expect(shared.length).toBeLessThanOrEqual(500);
    expect(new URL(shared).search).toBe('');
  });

  it('keeps legacy search-parameter shares when the stored URL has no mini-program hash', () => {
    expect(promotionShareUrl(
      `https://mall.example.test/products/${PRODUCT_ID}`,
      INVITE_CODE,
      PROMOTION_ASSET_ID,
    )).toBe(
      `https://mall.example.test/products/${PRODUCT_ID}` +
      `?invite_code=${INVITE_CODE}&promotion_asset_id=${PROMOTION_ASSET_ID}`,
    );
  });

  it('builds WeChat URL Link path and query without a leading slash or question mark', () => {
    expect(promotionMiniProgramPath({ targetId: null, targetType: 'STOREFRONT' }))
      .toBe(STOREFRONT_MINI_PROGRAM_PATH);
    expect(promotionMiniProgramPath({ targetId: PRODUCT_ID, targetType: 'PRODUCT' }))
      .toBe(PRODUCT_MINI_PROGRAM_PATH);
    expect(promotionMiniProgramQuery({
      inviteCode: INVITE_CODE,
      promotionAssetId: PROMOTION_ASSET_ID,
      targetId: null,
      targetType: 'STOREFRONT',
    })).toBe(`invite_code=${INVITE_CODE}&promotion_asset_id=${PROMOTION_ASSET_ID}`);
    expect(promotionMiniProgramQuery({
      inviteCode: INVITE_CODE,
      promotionAssetId: PROMOTION_ASSET_ID,
      targetId: PRODUCT_ID,
      targetType: 'PRODUCT',
    })).toBe(
      `product_id=${PRODUCT_ID}&invite_code=${INVITE_CODE}&promotion_asset_id=${PROMOTION_ASSET_ID}`,
    );
  });

  it('rejects product targets without an id and URLs longer than 500 characters', () => {
    expect(() => promotionTargetUrl('https://mall.example.test', {
      targetId: null,
      targetType: 'PRODUCT',
    })).toThrow(ApplicationError);
    const longBase = `https://mall.example.test/${'a'.repeat(480)}`;
    expect(() => promotionTargetUrl(longBase, {
      targetId: null,
      targetType: 'STOREFRONT',
    })).toThrow(ApplicationError);
  });
});
