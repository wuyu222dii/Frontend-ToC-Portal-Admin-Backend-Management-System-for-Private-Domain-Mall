import { ApplicationError } from '@qingxu/platform-core';
import { describe, expect, it } from 'vitest';

import {
  parseBannerCreateBody,
  parseBannerId,
  parseBannerListQuery,
  parseBannerPatchBody,
  parseBannerReasonBody,
} from './admin-banners.dto';

const bannerId = '01J00000000000000000000000';
const fileId = '01J00000000000000000000001';
const targetId = '01J00000000000000000000002';

describe('admin Banner request DTOs', () => {
  it('parses list defaults, explicit ARCHIVED and an unbounded nonblank keyword', () => {
    expect(parseBannerListQuery({})).toEqual({ page: 1, pageSize: 20 });
    const keyword = 'B'.repeat(500);
    expect(parseBannerListQuery({ keyword, page: '2', page_size: '100', status: 'ARCHIVED' }))
      .toEqual({ keyword, page: 2, pageSize: 100, status: 'ARCHIVED' });
  });

  it.each([
    [{ target_type: 'NONE' }, { type: 'NONE' }],
    [{ target_id: targetId, target_type: 'PRODUCT' }, { targetId, type: 'PRODUCT' }],
    [{ target_id: targetId, target_type: 'CATEGORY' }, { targetId, type: 'CATEGORY' }],
    [{ target_type: 'URL', target_url: 'https://mall.example.test/campaign?a=1' }, {
      targetUrl: 'https://mall.example.test/campaign?a=1', type: 'URL',
    }],
  ] as const)('parses the closed %s create target branch', (targetFields, target) => {
    expect(parseBannerCreateBody({
      ends_at: '2026-08-26T01:00:00+12:00',
      file_id: fileId,
      initial_status: 'DRAFT',
      sort_order: 0,
      starts_at: '2026-08-25T01:00:00+12:00',
      title: 'Homepage campaign',
      ...targetFields,
    })).toEqual({
      endsAt: '2026-08-26T01:00:00+12:00',
      fileId,
      initialStatus: 'DRAFT',
      sortOrder: 0,
      startsAt: '2026-08-25T01:00:00+12:00',
      target,
      title: 'Homepage campaign',
    });
  });

  it('keeps profile updates and status actions as disjoint PATCH branches', () => {
    expect(parseBannerPatchBody({
      ends_at: null,
      sort_order: 3,
      target_id: targetId,
      target_type: 'CATEGORY',
      title: 'Updated campaign',
    })).toEqual({
      kind: 'UPDATE',
      patch: {
        endsAt: null,
        sortOrder: 3,
        target: { targetId, type: 'CATEGORY' },
        title: 'Updated campaign',
      },
    });
    expect(parseBannerPatchBody({ action: 'ACTIVATE' }))
      .toEqual({ action: 'ACTIVATE', kind: 'STATUS' });
    expect(parseBannerPatchBody({ action: 'DEACTIVATE' }))
      .toEqual({ action: 'DEACTIVATE', kind: 'STATUS' });
  });

  it('parses DELETE and restore reason bodies independently', () => {
    expect(parseBannerReasonBody({ reason: 'Campaign has ended' }))
      .toEqual({ reason: 'Campaign has ended' });
    expect(parseBannerId(bannerId)).toBe(bannerId);
  });

  it.each([
    () => parseBannerListQuery({ keyword: '' }),
    () => parseBannerListQuery({ keyword: '   ' }),
    () => parseBannerListQuery({ page_size: '101' }),
    () => parseBannerListQuery({ state: 'DRAFT' }),
    () => parseBannerCreateBody({
      file_id: fileId, initial_status: 'ACTIVE', sort_order: 0, target_type: 'NONE', title: 'Campaign',
    }),
    () => parseBannerCreateBody({
      file_id: fileId, initial_status: 'DRAFT', sort_order: 0, target_id: targetId,
      target_type: 'NONE', title: 'Campaign',
    }),
    () => parseBannerCreateBody({
      file_id: fileId, initial_status: 'DRAFT', sort_order: 0,
      target_type: 'PRODUCT', title: 'Campaign',
    }),
    () => parseBannerCreateBody({
      file_id: fileId, initial_status: 'DRAFT', sort_order: 0, target_type: 'URL',
      target_url: 'http://mall.example.test/campaign', title: 'Campaign',
    }),
    () => parseBannerCreateBody({
      file_id: fileId, initial_status: 'DRAFT', sort_order: 0, target_type: 'URL',
      target_url: 'https://user:password@mall.example.test/campaign', title: 'Campaign',
    }),
    () => parseBannerCreateBody({
      ends_at: '2026-08-25T00:00:00Z', file_id: fileId, initial_status: 'DRAFT', sort_order: 0,
      starts_at: '2026-08-25T00:00:00Z', target_type: 'NONE', title: 'Campaign',
    }),
    () => parseBannerCreateBody({
      file_id: fileId, initial_status: 'DRAFT', sort_order: -1, target_type: 'NONE', title: 'Campaign',
    }),
    () => parseBannerPatchBody({}),
    () => parseBannerPatchBody({ action: 'ACTIVATE', title: 'Mixed branch' }),
    () => parseBannerPatchBody({ action: 'SOFT_DELETE' }),
    () => parseBannerPatchBody({ target_id: targetId }),
    () => parseBannerPatchBody({ starts_at: '2026-08-25' }),
    () => parseBannerReasonBody({ reason: 'x' }),
    () => parseBannerReasonBody({ action: 'DELETE', reason: 'Campaign has ended' }),
    () => parseBannerId('../banner'),
  ])('rejects open, ambiguous or contract-invalid input', (parse) => {
    expect(parse).toThrowError(ApplicationError);
  });
});
