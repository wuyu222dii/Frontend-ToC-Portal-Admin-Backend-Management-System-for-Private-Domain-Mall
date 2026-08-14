import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseBrandCreateBody,
  parseBrandUpdateBody,
  parseCatalogId,
  parseCatalogListQuery,
  parseCategoryCreateBody,
  parseCategoryUpdateBody,
  parseLifecycleConfirmationBody,
  parseLifecyclePreviewBody,
  parseRestoreBody,
} from './admin-catalog.dto';

const fileId = '01J00000000000000000000000';

describe('admin catalog request DTOs', () => {
  it('parses closed brand and category create/update bodies', () => {
    expect(parseBrandCreateBody({
      description: null,
      initial_status: 'DRAFT',
      logo_file_id: fileId,
      name: 'Qingxu',
      sort_order: 0,
    })).toEqual({
      description: null,
      initialStatus: 'DRAFT',
      logoFileId: fileId,
      name: 'Qingxu',
      sortOrder: 0,
    });
    expect(parseBrandUpdateBody({ description: '', logo_file_id: null, sort_order: 12 }))
      .toEqual({ description: '', logoFileId: null, sortOrder: 12 });
    expect(parseCategoryCreateBody({
      icon_file_id: fileId,
      initial_status: 'DRAFT',
      name: 'Care',
      sort_order: 1,
    })).toEqual({ iconFileId: fileId, initialStatus: 'DRAFT', name: 'Care', sortOrder: 1 });
    expect(parseCategoryUpdateBody({ icon_file_id: null })).toEqual({ iconFileId: null });
  });

  it('parses list defaults and the explicit archived filter', () => {
    expect(parseCatalogListQuery({})).toEqual({ page: 1, pageSize: 20 });
    expect(parseCatalogListQuery({ keyword: 'care', page: '2', page_size: '100', status: 'ARCHIVED' }))
      .toEqual({ keyword: 'care', page: 2, pageSize: 100, status: 'ARCHIVED' });
  });

  it('parses lifecycle preview, confirmation and restore as separate closed shapes', () => {
    expect(parseLifecyclePreviewBody({ action: 'DEACTIVATE', reason: 'Brand strategy change' }))
      .toEqual({ action: 'DEACTIVATE', reason: 'Brand strategy change' });
    expect(parseLifecycleConfirmationBody({
      action: 'SOFT_DELETE',
      confirmation_hash: 'a'.repeat(64),
      preview_token: `pvw_${'b'.repeat(32)}`,
      reason: 'Retired',
    })).toEqual({
      action: 'SOFT_DELETE',
      confirmationHash: 'a'.repeat(64),
      previewToken: `pvw_${'b'.repeat(32)}`,
      reason: 'Retired',
    });
    expect(parseRestoreBody({ reason: 'Resume business' })).toEqual({ reason: 'Resume business' });
  });

  it.each([
    () => parseBrandCreateBody({ initial_status: 'ACTIVE', name: 'Brand', sort_order: 0 }),
    () => parseBrandCreateBody({ initial_status: 'DRAFT', name: ' ', sort_order: 0 }),
    () => parseBrandCreateBody({ initial_status: 'DRAFT', name: 'Brand', sort_order: -1 }),
    () => parseBrandCreateBody({ initial_status: 'DRAFT', name: 'Brand', sort_order: 0, status: 'ACTIVE' }),
    () => parseBrandUpdateBody({}),
    () => parseCategoryCreateBody({ initial_status: 'DRAFT', name: 'Category', sort_order: 0, description: 'x' }),
    () => parseCategoryUpdateBody({ status: 'ACTIVE' }),
    () => parseCatalogListQuery({ page: '0' }),
    () => parseCatalogListQuery({ page_size: '101' }),
    () => parseCatalogListQuery({ status: 'DELETED' }),
    () => parseLifecyclePreviewBody({ action: 'DELETE', reason: 'Invalid action' }),
    () => parseLifecycleConfirmationBody({
      action: 'ACTIVATE', confirmation_hash: 'A'.repeat(64), preview_token: '1234567890123456', reason: 'Activate',
    }),
    () => parseLifecycleConfirmationBody({
      action: 'ACTIVATE', confirmation_hash: 'a'.repeat(64), preview_token: 'p'.repeat(513), reason: 'Activate',
    }),
    () => parseRestoreBody({ reason: 'x' }),
  ])('rejects open, out-of-range or invalid input', (parse) => {
    expect(parse).toThrowError(ApplicationError);
  });

  it('rejects non-ULID resource and attachment identifiers', () => {
    expect(() => parseCatalogId('../brand', 'brand_id')).toThrowError(ApplicationError);
    expect(() => parseCategoryUpdateBody({ icon_file_id: '../object' })).toThrowError(ApplicationError);
  });
});
