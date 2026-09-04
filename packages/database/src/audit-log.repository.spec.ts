import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import { AuditLogRepository } from './audit-log.repository';

const AUDIT_ID = generateUlid();
const ACTOR_ID = generateUlid();
const TARGET_ID = generateUlid();
const NOW = new Date('2026-09-04T05:00:00.000Z');

function harness(
  after: unknown = { status: 'PUBLISHED', version: 2 },
  before: unknown = { status: 'PUBLISHED', version: 1 },
) {
  const findMany = vi.fn(async () => [{
    action: 'PUBLISH',
    actor_account_id: ACTOR_ID,
    actor_role: 'SUPER_ADMIN',
    after_json: after,
    before_json: before,
    id: AUDIT_ID,
    idempotency_key: null,
    ip_hash: 'a'.repeat(64),
    module: 'config',
    object_id: TARGET_ID,
    object_type: 'business_rule',
    occurred_at: NOW,
    reason: 'Update rules',
    request_id: `req_${'1'.repeat(32)}`,
    result: 'SUCCESS',
    result_code: 'OK',
  }]);
  const count = vi.fn(async () => 1);
  const repository = new AuditLogRepository({ auditLog: { count, findMany } } as unknown as PrismaClient);
  return { count, findMany, repository };
}

describe('AuditLogRepository', () => {
  it('filters and maps only safe summary fields', async () => {
    const state = harness();
    const result = await state.repository.list({
      page: 2,
      pageSize: 20,
      targetId: TARGET_ID,
      targetType: 'business_rule',
    });

    expect(state.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 20,
      take: 20,
      where: { object_id: TARGET_ID, object_type: 'business_rule' },
    }));
    expect(result.items[0]).toMatchObject({
      afterSummary: [
        { displayValue: 'PUBLISHED', field: 'status', sensitive: false },
        { displayValue: '2', field: 'version', sensitive: false },
      ],
      afterVersion: 2,
      beforeVersion: 1,
      ipHash: 'a'.repeat(64),
    });
  });

  it('fails closed instead of exposing an unknown stored field', async () => {
    await expect(harness({ unexpected_field: 'not displayable' }).repository.list({ page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('maps the approved business rule values into field-level summaries', async () => {
    const result = await harness({
      aftersale_window_days: 14,
      minimum_withdrawal_amount: '200.00',
      status: 'PUBLISHED',
      version: 4,
    }, {
      aftersale_window_days: 7,
      minimum_withdrawal_amount: '100.00',
      status: 'PUBLISHED',
      version: 3,
    }).repository.list({ page: 1, pageSize: 20 });

    expect(result.items[0]?.beforeSummary).toEqual([
      { displayValue: '7', field: 'aftersale_window_days', sensitive: false },
      { displayValue: '100.00', field: 'minimum_withdrawal_amount', sensitive: false },
      { displayValue: 'PUBLISHED', field: 'status', sensitive: false },
      { displayValue: '3', field: 'version', sensitive: false },
    ]);
    expect(result.items[0]?.afterSummary).toEqual([
      { displayValue: '14', field: 'aftersale_window_days', sensitive: false },
      { displayValue: '200.00', field: 'minimum_withdrawal_amount', sensitive: false },
      { displayValue: 'PUBLISHED', field: 'status', sensitive: false },
      { displayValue: '4', field: 'version', sensitive: false },
    ]);
  });

  it('fails closed on an invalid stored business rule value', async () => {
    await expect(harness({
      aftersale_window_days: 14,
      minimum_withdrawal_amount: '0.00',
      status: 'PUBLISHED',
      version: 4,
    }).repository.list({ page: 1, pageSize: 20 })).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('requires target_type when target_id is supplied', async () => {
    await expect(harness().repository.list({ page: 1, pageSize: 20, targetId: TARGET_ID }))
      .rejects.toThrow('target type');
  });
});
