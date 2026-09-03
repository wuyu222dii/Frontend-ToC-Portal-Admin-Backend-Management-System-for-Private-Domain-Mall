import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseCommissionRuleActionBody,
  parseCommissionRuleConfirmationBody,
  parseCommissionRuleIfMatch,
  parseCommissionSkuListQuery,
} from './admin-commissions.dto';

const categoryId = generateUlid();
const skuId = generateUlid();

describe('Admin commission DTOs', () => {
  it('preserves explicit 0% and null inheritance while allowing a first publication', () => {
    expect(parseCommissionRuleActionBody({
      base_version_id: null,
      changes: [
        { configured_rate: '8.0000', target_id: null, target_type: 'PLATFORM' },
        { configured_rate: '0.0000', target_id: categoryId, target_type: 'CATEGORY' },
        { configured_rate: null, target_id: skuId, target_type: 'SKU' },
      ],
      reason: 'Initial commission configuration',
    })).toMatchObject({
      baseVersionId: null,
      changes: [
        { configuredRate: '8.0000', targetId: null, targetType: 'PLATFORM' },
        { configuredRate: '0.0000', targetId: categoryId, targetType: 'CATEGORY' },
        { configuredRate: null, targetId: skuId, targetType: 'SKU' },
      ],
    });
  });

  it('rejects duplicate targets and a nullable PLATFORM rate', () => {
    expect(() => parseCommissionRuleActionBody({
      base_version_id: null,
      changes: [
        { configured_rate: '1.0000', target_id: skuId, target_type: 'SKU' },
        { configured_rate: null, target_id: skuId, target_type: 'SKU' },
      ],
      reason: 'Duplicate target',
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
    expect(() => parseCommissionRuleActionBody({
      base_version_id: null,
      changes: [{ configured_rate: null, target_id: null, target_type: 'PLATFORM' }],
      reason: 'Invalid platform rule',
    })).toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('accepts zero only in the commission-specific If-Match parser', () => {
    expect(parseCommissionRuleIfMatch('"0"')).toBe(0);
    expect(parseCommissionRuleIfMatch('"12"')).toBe(12);
    expect(() => parseCommissionRuleIfMatch('0'))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });

  it('strictly decodes confirmation and SKU list inputs', () => {
    expect(parseCommissionRuleConfirmationBody({
      base_version_id: null,
      changes: [{ configured_rate: '5.0000', target_id: null, target_type: 'PLATFORM' }],
      confirmation_hash: 'a'.repeat(64),
      preview_token: 'pvw_0123456789abcdefghijklmnop',
      reason: 'Publish initial rules',
    })).toMatchObject({ confirmationHash: 'a'.repeat(64) });
    expect(parseCommissionSkuListQuery({ category_id: categoryId, page: '2', source: 'CATEGORY' }))
      .toEqual({ categoryId, page: 2, pageSize: 20, source: 'CATEGORY' });
    expect(() => parseCommissionSkuListQuery({ agent_id: generateUlid() }))
      .toThrow(expect.objectContaining({ code: 'INVALID_ARGUMENT' }));
  });
});
