import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseProductCreateBody,
  parseProductId,
  parseProductLifecycleConfirmationBody,
  parseProductLifecyclePreviewBody,
  parseProductListQuery,
  parseProductRestoreBody,
  parseProductUpdateBody,
  parseSkuCreateBody,
  parseSkuLifecycleConfirmationBody,
  parseSkuLifecyclePreviewBody,
  parseSkuRestoreBody,
  parseSkuUpdateBody,
} from './admin-products.dto';

const brandId = '01J00000000000000000000000';
const categoryId = '01J00000000000000000000001';
const fileId = '01J00000000000000000000002';

describe('admin products request DTOs', () => {
  it('parses the closed product create and complete-gallery update shapes', () => {
    expect(parseProductCreateBody({
      brand_id: brandId,
      category_id: categoryId,
      images: [{ file_id: fileId, sort_order: 0 }],
      initial_status: 'DRAFT',
      introduction: null,
      is_hot: true,
      name: 'Daily wash',
      spu_code: 'SPU-001',
      subtitle: 'Gentle care',
    })).toEqual({
      brandId,
      categoryId,
      images: [{ fileId, sortOrder: 0 }],
      initialStatus: 'DRAFT',
      introduction: null,
      isHot: true,
      name: 'Daily wash',
      spuCode: 'SPU-001',
      subtitle: 'Gentle care',
    });
    expect(parseProductUpdateBody({ images: [], is_new: false, subtitle: null }))
      .toEqual({ images: [], isNew: false, subtitle: null });
  });

  it('parses list defaults and all explicit filters', () => {
    expect(parseProductListQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseProductListQuery({
      brand_id: brandId,
      category_id: categoryId,
      keyword: 'SPU-001',
      page: '2',
      page_size: '100',
      recommended: 'false',
      status: 'ARCHIVED',
    })).toEqual({
      brandId,
      categoryId,
      keyword: 'SPU-001',
      page: 2,
      pageSize: 100,
      recommended: false,
      status: 'ARCHIVED',
    });
  });

  it('parses SKU create/update and preserves the closed spec shape', () => {
    expect(parseSkuCreateBody({
      code: 'SKU-001',
      initial_status: 'INACTIVE',
      is_recommended: true,
      name: '500 ml',
      retail_price: '19.90',
      spec_json: { attributes: [{ name: 'Volume', value: '500 ml' }] },
    })).toEqual({
      code: 'SKU-001',
      initialStatus: 'INACTIVE',
      isRecommended: true,
      name: '500 ml',
      retailPrice: '19.90',
      specJson: { attributes: [{ name: 'Volume', value: '500 ml' }] },
    });
    expect(parseSkuUpdateBody({ is_recommended: false, spec_json: null }))
      .toEqual({ isRecommended: false, specJson: null });
  });

  it.each([
    ['Product', parseProductLifecyclePreviewBody],
    ['SKU', parseSkuLifecyclePreviewBody],
  ] as const)('parses every closed %s lifecycle preview action', (_target, parse) => {
    for (const action of ['ACTIVATE', 'DEACTIVATE', 'SOFT_DELETE'] as const) {
      expect(parse({ action, reason: 'Approved catalog transition' }))
        .toEqual({ action, reason: 'Approved catalog transition' });
    }
  });

  it.each([
    ['Product', parseProductLifecycleConfirmationBody, parseProductRestoreBody],
    ['SKU', parseSkuLifecycleConfirmationBody, parseSkuRestoreBody],
  ] as const)('parses %s lifecycle confirmation and restore as separate closed shapes',
    (_target, parseConfirmation, parseRestore) => {
      expect(parseConfirmation({
        action: 'SOFT_DELETE',
        confirmation_hash: 'a'.repeat(64),
        preview_token: `pvw_${'b'.repeat(43)}`,
        reason: 'Retire this catalog item',
      })).toEqual({
        action: 'SOFT_DELETE',
        confirmationHash: 'a'.repeat(64),
        previewToken: `pvw_${'b'.repeat(43)}`,
        reason: 'Retire this catalog item',
      });
      expect(parseRestore({ reason: 'Resume catalog preparation' }))
        .toEqual({ reason: 'Resume catalog preparation' });
    });

  it.each([
    () => parseProductCreateBody({
      brand_id: brandId, category_id: categoryId, images: [], initial_status: 'ACTIVE',
      name: 'Product', spu_code: 'SPU-1',
    }),
    () => parseProductCreateBody({
      brand_id: brandId, category_id: categoryId,
      images: [{ file_id: fileId, sort_order: 0 }, { file_id: fileId, sort_order: 1 }],
      initial_status: 'DRAFT', name: 'Product', spu_code: 'SPU-1',
    }),
    () => parseProductCreateBody({
      brand_id: brandId, category_id: categoryId,
      images: [{ file_id: fileId, sort_order: 0 }, { file_id: '01J00000000000000000000003', sort_order: 0 }],
      initial_status: 'DRAFT', name: 'Product', spu_code: 'SPU-1',
    }),
    () => parseProductUpdateBody({}),
    () => parseProductUpdateBody({ spu_code: 'NEW' }),
    () => parseProductListQuery({ recommended: '1' }),
    () => parseSkuCreateBody({ code: 'SKU-1', initial_status: 'ACTIVE', name: 'SKU', retail_price: '1.00' }),
    () => parseSkuCreateBody({ code: 'SKU-1', initial_status: 'INACTIVE', name: 'SKU', retail_price: '0.00' }),
    () => parseSkuCreateBody({ code: 'SKU-1', initial_status: 'INACTIVE', name: 'SKU', retail_price: 19.9 }),
    () => parseSkuCreateBody({
      code: 'SKU-1', initial_status: 'INACTIVE', name: 'SKU', retail_price: '12345678901234567.00',
    }),
    () => parseSkuCreateBody({
      code: 'SKU-1', initial_status: 'INACTIVE', name: 'SKU', retail_price: '1.00',
      spec_json: { attributes: [{ name: 'Size', value: 'L' }, { name: 'Size', value: 'L' }] },
    }),
    () => parseSkuUpdateBody({ code: 'NEW' }),
    () => parseProductLifecyclePreviewBody({ action: 'DELETE', reason: 'Invalid action' }),
    () => parseSkuLifecyclePreviewBody({ action: 'ACTIVATE', reason: 'x' }),
    () => parseProductLifecyclePreviewBody({ action: 'ACTIVATE', reason: 'x'.repeat(501) }),
    () => parseSkuLifecyclePreviewBody({ action: 'ACTIVATE', extra: true, reason: 'Publish product' }),
    () => parseProductLifecycleConfirmationBody({
      action: 'ACTIVATE', confirmation_hash: 'A'.repeat(64),
      preview_token: `pvw_${'b'.repeat(43)}`, reason: 'Publish product',
    }),
    () => parseSkuLifecycleConfirmationBody({
      action: 'ACTIVATE', confirmation_hash: 'a'.repeat(64),
      preview_token: 'p'.repeat(15), reason: 'Publish product',
    }),
    () => parseProductLifecycleConfirmationBody({
      action: 'ACTIVATE', confirmation_hash: 'a'.repeat(64),
      preview_token: 'p'.repeat(513), reason: 'Publish product',
    }),
    () => parseSkuLifecycleConfirmationBody({
      action: 'ACTIVATE', confirmation_hash: 'a'.repeat(64),
      preview_token: `pvw_${'b'.repeat(43)}`, reason: 'Publish product', unexpected: 'field',
    }),
    () => parseProductRestoreBody({ reason: 'x' }),
    () => parseSkuRestoreBody({ reason: 'Resume catalog item', status: 'INACTIVE' }),
  ])('rejects open, duplicate or contract-invalid input', (parse) => {
    expect(parse).toThrowError(ApplicationError);
  });

  it('rejects non-ULID path and relation identifiers', () => {
    expect(() => parseProductId('../product', 'product_id')).toThrowError(ApplicationError);
    expect(() => parseProductUpdateBody({ brand_id: '../brand' })).toThrowError(ApplicationError);
  });
});
