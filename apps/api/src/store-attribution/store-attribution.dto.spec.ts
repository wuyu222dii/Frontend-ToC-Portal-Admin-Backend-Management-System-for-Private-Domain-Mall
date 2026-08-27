import { describe, expect, it } from 'vitest';

import { parseStoreAttributionCandidateBody } from './store-attribution.dto';

const ASSET_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

describe('B7.3 Store attribution DTOs', () => {
  it('parses the exact candidate input and maps wire names without retaining the secret field name', () => {
    expect(parseStoreAttributionCandidateBody({
      invite_code: 'QY8K2P',
      promotion_asset_id: ASSET_ID,
    })).toEqual({ inviteCode: 'QY8K2P', promotionAssetId: ASSET_ID });
  });

  it('accepts the frozen invite-code boundaries', () => {
    expect(parseStoreAttributionCandidateBody({
      invite_code: 'A',
      promotion_asset_id: ASSET_ID,
    }).inviteCode).toBe('A');
    expect(parseStoreAttributionCandidateBody({
      invite_code: 'A'.repeat(128),
      promotion_asset_id: ASSET_ID,
    }).inviteCode).toHaveLength(128);
    for (const exactValue of [' QY8K2P', 'QY8K2P ', 'QY8\nK2P']) {
      expect(parseStoreAttributionCandidateBody({
        invite_code: exactValue,
        promotion_asset_id: ASSET_ID,
      }).inviteCode).toBe(exactValue);
    }
  });

  it.each([
    undefined,
    null,
    [],
    {},
    { invite_code: 'QY8K2P' },
    { promotion_asset_id: ASSET_ID },
    { invite_code: 'QY8K2P', promotion_asset_id: ASSET_ID, target_type: 'PRODUCT' },
    { invite_code: 'QY8K2P', promotion_asset_id: ASSET_ID, target_id: ASSET_ID },
    { invite_code: '', promotion_asset_id: ASSET_ID },
    { invite_code: 'A'.repeat(129), promotion_asset_id: ASSET_ID },
    { invite_code: 1, promotion_asset_id: ASSET_ID },
    { invite_code: 'QY8K2P', promotion_asset_id: '01ARZ3NDEKTSV4RRFFQ69G5FA' },
    { invite_code: 'QY8K2P', promotion_asset_id: `${ASSET_ID}0` },
    { invite_code: 'QY8K2P', promotion_asset_id: ASSET_ID.toLowerCase() },
    { invite_code: 'QY8K2P', promotion_asset_id: '01ARZ3NDEKTSV4RRFFQ69G5FAI' },
    { invite_code: 'QY8K2P', promotion_asset_id: 1 },
  ])('rejects an open or malformed candidate body %#', (body) => {
    expect(() => parseStoreAttributionCandidateBody(body))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
