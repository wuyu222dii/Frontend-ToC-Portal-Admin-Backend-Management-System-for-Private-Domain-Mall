import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { AdminAuditService } from './admin-audit.service';

const NOW = new Date('2026-09-04T07:00:00.000Z');
const AUDIT_ID = generateUlid(NOW.getTime() - 20_000);
const ACTOR_ID = generateUlid(NOW.getTime() - 10_000);
const TARGET_ID = generateUlid(NOW.getTime());

describe('AdminAuditService', () => {
  it('maps only repository-vetted summaries and pagination', async () => {
    const audits = {
      list: vi.fn(async () => ({
        items: [{
          action: 'PUBLISH',
          actorAccountId: ACTOR_ID,
          actorRole: 'SUPER_ADMIN',
          afterSummary: [
            { displayValue: 'PUBLISHED', field: 'status', sensitive: false },
            { displayValue: '2', field: 'version', sensitive: false },
          ],
          afterVersion: 2,
          auditId: AUDIT_ID,
          beforeSummary: [{ displayValue: '1', field: 'version', sensitive: false }],
          beforeVersion: 1,
          createdAt: NOW,
          idempotencyKey: 'confirm-key',
          ipHash: 'a'.repeat(64),
          module: 'config',
          reason: 'Update rules',
          requestId: `req_${'1'.repeat(32)}`,
          result: 'SUCCESS' as const,
          resultCode: 'OK',
          targetId: TARGET_ID,
          targetType: 'business_rule',
        }],
        total: 1,
      })),
    };
    const service = new AdminAuditService();
    Object.assign(service as unknown as Record<string, unknown>, { audits });

    const result = await service.list({ page: 2, pageSize: 20, targetType: 'business_rule' });

    expect(audits.list).toHaveBeenCalledWith({ page: 2, pageSize: 20, targetType: 'business_rule' });
    expect(result).toEqual({
      items: [{
        action: 'PUBLISH',
        actor_account_id: ACTOR_ID,
        actor_role: 'SUPER_ADMIN',
        after_summary: [
          { display_value: 'PUBLISHED', field: 'status', sensitive: false },
          { display_value: '2', field: 'version', sensitive: false },
        ],
        after_version: 2,
        audit_id: AUDIT_ID,
        before_summary: [{ display_value: '1', field: 'version', sensitive: false }],
        before_version: 1,
        created_at: NOW.toISOString(),
        idempotency_key: 'confirm-key',
        ip_hash: 'a'.repeat(64),
        module: 'config',
        reason: 'Update rules',
        request_id: `req_${'1'.repeat(32)}`,
        result: 'SUCCESS',
        result_code: 'OK',
        target_id: TARGET_ID,
        target_type: 'business_rule',
      }],
      pagination: { page: 2, page_size: 20, total: 1 },
    });
  });
});
