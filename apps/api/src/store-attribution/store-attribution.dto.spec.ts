import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import { parseStoreAttributionCandidateBody } from './store-attribution.dto';

const INVITE_CODE = 'AGT-ABCDEFGHJKLMNPQR';
const PROMOTION_ASSET_ID = '01J7Z3K4M5N6P7Q8R9S0T1V2W3';

describe('parseStoreAttributionCandidateBody', () => {
  it('accepts invite_code only for storefront fallback binding', () => {
    expect(parseStoreAttributionCandidateBody({ invite_code: INVITE_CODE })).toEqual({
      inviteCode: INVITE_CODE,
    });
  });

  it('accepts the existing invite_code and promotion_asset_id pair', () => {
    expect(parseStoreAttributionCandidateBody({
      invite_code: INVITE_CODE,
      promotion_asset_id: PROMOTION_ASSET_ID,
    })).toEqual({
      inviteCode: INVITE_CODE,
      promotionAssetId: PROMOTION_ASSET_ID,
    });
  });

  it('rejects an invalid promotion_asset_id even when invite_code is present', () => {
    expect(() => parseStoreAttributionCandidateBody({
      invite_code: INVITE_CODE,
      promotion_asset_id: 'not-a-ulid',
    })).toThrow(ApplicationError);
  });

  it('rejects extra fields', () => {
    expect(() => parseStoreAttributionCandidateBody({
      invite_code: INVITE_CODE,
      target_type: 'STOREFRONT',
    })).toThrow(ApplicationError);
  });

  it('rejects a missing invite_code', () => {
    expect(() => parseStoreAttributionCandidateBody({
      promotion_asset_id: PROMOTION_ASSET_ID,
    })).toThrow(ApplicationError);
  });

  it('rejects a null promotion_asset_id', () => {
    expect(() => parseStoreAttributionCandidateBody({
      invite_code: INVITE_CODE,
      promotion_asset_id: null,
    })).toThrow(ApplicationError);
  });
});
