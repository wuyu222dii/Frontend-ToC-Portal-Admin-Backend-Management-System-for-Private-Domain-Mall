import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import { BusinessRuleRepository, type BusinessRulePublishInput } from './business-rule.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-09-04T04:00:00.000Z');
const ACTOR_ID = generateUlid(NOW.getTime() - 20_000);
const CURRENT_ID = generateUlid(NOW.getTime() - 10_000);

function row() {
  return {
    aftersale_window_days: 7,
    created_at: new Date(NOW.getTime() - 10_000),
    created_by_id: ACTOR_ID,
    effective_at: new Date(NOW.getTime() - 9_000),
    id: CURRENT_ID,
    legal_record_retention_years: 10,
    minimum_withdrawal_amount: new Prisma.Decimal('100.00'),
    order_payment_timeout_minutes: 30,
    reason: 'Initial business rules',
    status: 'PUBLISHED',
    version_no: 3,
  };
}

function queryText(query: unknown): string {
  return (query as { strings?: string[] }).strings?.join(' ') ?? String(query);
}

function harness() {
  const rows = [row()];
  const events: string[] = [];
  const businessRuleVersion = {
    create: vi.fn(async ({ data }) => {
      events.push(data.status === 'PUBLISHED' ? 'create-published' : 'create-draft');
      const created = { ...data, minimum_withdrawal_amount: new Prisma.Decimal(data.minimum_withdrawal_amount) };
      rows.push(created);
      return created;
    }),
    findUnique: vi.fn(async ({ where }) => rows.find(({ id }) => id === where.id) ?? null),
    updateMany: vi.fn(async ({ data, where }) => {
      const current = rows.find(({ id }) => id === where.id);
      if (!current || current.status !== where.status ||
        (where.effective_at === null && current.effective_at !== null)) return { count: 0 };
      events.push(data.status === 'ARCHIVED' ? 'archive-current' : 'publish-new');
      Object.assign(current, data);
      return { count: 1 };
    }),
  };
  const transaction = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const sql = queryText(query);
      if (sql.includes('FROM public.account')) {
        events.push('lock-actor');
        return [{ deleted_at: null, has_password: true, id: ACTOR_ID, role: 'SUPER_ADMIN', status: 'ACTIVE' }];
      }
      if (sql.includes('transaction_timestamp()')) return [{ transaction_time: NOW }];
      if (sql.includes('FROM public.business_rule_version')) {
        events.push(sql.includes('FOR UPDATE') ? 'lock-history' : 'read-history');
        return rows;
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
    $queryRawUnsafe: vi.fn(async () => {
      events.push('lock-singleton');
      return [{ acquired: 1 }];
    }),
    businessRuleVersion,
  };
  return {
    events,
    repository: new BusinessRuleRepository({} as PrismaClient),
    rows,
    transaction: transaction as unknown as DatabaseTransaction,
  };
}

function input(overrides: Partial<BusinessRulePublishInput> = {}): BusinessRulePublishInput {
  return {
    actorAccountId: ACTOR_ID,
    changes: { aftersaleWindowDays: 14, minimumWithdrawalAmount: '200.00' },
    expectedCurrentPublishedId: CURRENT_ID,
    expectedMaxVersionNo: 3,
    expectedVersion: 3,
    reason: 'Update business rules',
    ...overrides,
  };
}

describe('BusinessRuleRepository', () => {
  it('creates the only initial published rules from controlled defaults', async () => {
    const state = harness();
    state.rows.splice(0);

    const result = await state.repository.bootstrapInitialInTransaction(state.transaction, {
      actorAccountId: ACTOR_ID,
      legalRecordRetentionYears: 10,
    });

    expect(result).toMatchObject({
      aftersaleWindowDays: 7,
      legalRecordRetentionYears: 10,
      minimumWithdrawalAmount: '100.00',
      orderPaymentTimeoutMinutes: 30,
      version: 1,
      versionNo: 1,
    });
    expect(state.events).toEqual(['lock-actor', 'lock-singleton', 'lock-history', 'create-published']);
  });

  it('refuses to bootstrap over any existing business-rule history', async () => {
    const state = harness();
    await expect(state.repository.bootstrapInitialInTransaction(state.transaction, {
      actorAccountId: ACTOR_ID,
      legalRecordRetentionYears: 10,
    })).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
    expect(state.events).toEqual(['lock-actor', 'lock-singleton', 'lock-history']);
  });

  it('locks, verifies, archives and publishes one immutable replacement', async () => {
    const state = harness();
    const verifyPreview = vi.fn(async () => state.events.push('verify-preview'));

    const result = await state.repository.publishInTransaction(state.transaction, input(), { verifyPreview });

    expect(result.rule).toMatchObject({
      aftersaleWindowDays: 14,
      legalRecordRetentionYears: 10,
      minimumWithdrawalAmount: '200.00',
      orderPaymentTimeoutMinutes: 30,
      version: 4,
      versionNo: 4,
    });
    expect(result.audit).toEqual({
      after: {
        aftersale_window_days: 14,
        minimum_withdrawal_amount: '200.00',
        status: 'PUBLISHED',
        version: 4,
      },
      before: {
        aftersale_window_days: 7,
        minimum_withdrawal_amount: '100.00',
        status: 'PUBLISHED',
        version: 3,
      },
    });
    expect(state.events).toEqual([
      'lock-actor', 'lock-singleton', 'lock-history', 'verify-preview',
      'create-draft', 'archive-current', 'publish-new',
    ]);
    expect(state.rows.find(({ id }) => id === CURRENT_ID)?.status).toBe('ARCHIVED');
  });

  it('rejects stale facts before consuming the preview', async () => {
    const state = harness();
    const verifyPreview = vi.fn();
    await expect(state.repository.publishInTransaction(
      state.transaction,
      input({ expectedVersion: 2 }),
      { verifyPreview },
    )).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(verifyPreview).not.toHaveBeenCalled();
  });

  it('rejects a no-op change', async () => {
    const state = harness();
    await expect(state.repository.previewPublishInTransaction(
      state.transaction,
      { minimumWithdrawalAmount: '100.00' },
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});
