import { describe, expect, it } from 'vitest';

import {
  parseAgentProductListQuery,
  parseCreatePromotionAssetBody,
} from './agent-commerce.dto';

describe('Agent commerce DTO', () => {
  it('strictly parses product filters and promotion targets', () => {
    expect(parseAgentProductListQuery({ recommended: 'false' })).toEqual({
      page: 1,
      pageSize: 20,
      recommended: false,
    });
    expect(parseCreatePromotionAssetBody({ target_type: 'STOREFRONT', target_id: null })).toEqual({
      targetId: null,
      targetType: 'STOREFRONT',
    });
    expect(() => parseAgentProductListQuery({ status: 'DISABLED' })).toThrow();
    expect(() => parseCreatePromotionAssetBody({ target_type: 'STOREFRONT', target_id: 'product' }))
      .toThrow();
  });
});
