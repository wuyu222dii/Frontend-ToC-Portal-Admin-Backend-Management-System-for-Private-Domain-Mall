import { describe, expect, it } from 'vitest';

import { parseAdminAuditListQuery } from './admin-audit.dto';

describe('admin audit DTO', () => {
  it('parses pagination, target and inclusive Shanghai dates', () => {
    expect(parseAdminAuditListQuery({
      date_from: '2026-09-04',
      date_to: '2026-09-04',
      page: '2',
      page_size: '50',
      target_id: '01J00000000000000000000001',
      target_type: 'AGENT',
    })).toEqual({
      createdAtFrom: new Date('2026-09-03T16:00:00.000Z'),
      createdAtToExclusive: new Date('2026-09-04T16:00:00.000Z'),
      page: 2,
      pageSize: 50,
      targetId: '01J00000000000000000000001',
      targetType: 'AGENT',
    });
  });

  it.each([
    { unexpected: '1' },
    { target_id: '01J00000000000000000000001' },
    { date_from: '2026-02-30' },
    { page_size: '101' },
  ])('rejects an invalid query: %j', (query) => {
    expect(() => parseAdminAuditListQuery(query)).toThrow();
  });
});
