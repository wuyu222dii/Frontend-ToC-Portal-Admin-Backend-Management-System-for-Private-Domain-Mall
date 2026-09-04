import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import {
  CommissionRepository,
  type CommissionRuleActionInput,
  type CommissionRulePublishInput,
} from './commission.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-09-03T03:00:00.000Z');
const actorId = generateUlid(NOW.getTime() - 30_000);
const agentId = generateUlid(NOW.getTime() - 29_000);
const walletId = generateUlid(NOW.getTime() - 28_000);
const firstVersionId = generateUlid(NOW.getTime() - 27_000);
const secondVersionId = generateUlid(NOW.getTime() - 26_000);
const categoryId = generateUlid(NOW.getTime() - 25_000);
const emptyCategoryId = generateUlid(NOW.getTime() - 24_000);
const productId = generateUlid(NOW.getTime() - 23_000);
const skuId = generateUlid(NOW.getTime() - 22_000);
const snapshotId = generateUlid(NOW.getTime() - 21_000);
const positionId = generateUlid(NOW.getTime() - 20_000);
const ledgerId = generateUlid(NOW.getTime() - 19_000);
const orderId = generateUlid(NOW.getTime() - 18_000);
const orderItemId = generateUlid(NOW.getTime() - 17_000);

interface TestEntry {
  configured_rate: Prisma.Decimal;
  created_at: Date;
  id: string;
  rule_version_id: string;
  target_id: string | null;
  target_key: string;
  target_type: 'CATEGORY' | 'PLATFORM' | 'SKU';
}

interface TestVersion {
  base_version_id: string | null;
  created_at: Date;
  created_by_id: string;
  effective_at: Date | null;
  entries: TestEntry[];
  id: string;
  reason: string;
  status: 'ARCHIVED' | 'DRAFT' | 'PUBLISHED';
  version_no: number;
}

function queryText(query: unknown): string {
  return (query as { strings?: readonly string[] }).strings?.join(' ') ?? String(query);
}

function entry(
  versionId: string,
  targetType: TestEntry['target_type'],
  targetId: string | null,
  configuredRate: string,
): TestEntry {
  return {
    configured_rate: new Prisma.Decimal(configuredRate),
    created_at: new Date(NOW.getTime() - 10_000),
    id: generateUlid(NOW.getTime() - 9_000),
    rule_version_id: versionId,
    target_id: targetId,
    target_key: targetType === 'PLATFORM' ? 'PLATFORM' : `${targetType}:${targetId}`,
    target_type: targetType,
  };
}

function version(overrides: Partial<TestVersion> = {}): TestVersion {
  const id = overrides.id ?? firstVersionId;
  return {
    base_version_id: null,
    created_at: new Date(NOW.getTime() - 12_000),
    created_by_id: actorId,
    effective_at: new Date(NOW.getTime() - 11_000),
    entries: [entry(id, 'PLATFORM', null, '5.0000')],
    id,
    reason: 'Initial commission rule',
    status: 'PUBLISHED',
    version_no: 1,
    ...overrides,
  };
}

function catalog() {
  return {
    categories: [
      { id: categoryId, name: 'Wash care' },
      { id: emptyCategoryId, name: 'Home care' },
    ],
    skus: [{
      code: 'SKU-001',
      id: skuId,
      product: {
        category: { name: 'Wash care' },
        category_id: categoryId,
        id: productId,
        name: 'Laundry liquid',
      },
    }],
  };
}

function action(overrides: Partial<CommissionRuleActionInput> = {}): CommissionRuleActionInput {
  return {
    baseVersionId: null,
    changes: [{ configuredRate: '5.0000', targetId: null, targetType: 'PLATFORM' }],
    reason: ' Publish commission rules ',
    ...overrides,
  };
}

function publishInput(overrides: Partial<CommissionRulePublishInput> = {}): CommissionRulePublishInput {
  return {
    actorAccountId: actorId,
    baseVersionId: null,
    changes: [{ configuredRate: '5.0000', targetId: null, targetType: 'PLATFORM' }],
    expectedCurrentPublishedId: null,
    expectedMaxVersionNo: 0,
    expectedVersion: 0,
    reason: ' Publish commission rules ',
    ...overrides,
  };
}

function ruleHarness(initialVersions: TestVersion[] = []) {
  const versions = initialVersions.map((record) => ({
    ...record,
    entries: record.entries.map((value) => ({ ...value })),
  }));
  const currentCatalog = catalog();
  const events: string[] = [];
  const targetQueries: Array<{ text: string; values: readonly unknown[] }> = [];
  const commissionRuleVersion = {
    create: vi.fn(async ({ data }: { data: Omit<TestVersion, 'entries'> }) => {
      events.push('create-draft');
      versions.push({ ...data, entries: [] });
      return { id: data.id };
    }),
    findMany: vi.fn(async () => [...versions].sort((left, right) =>
      left.version_no - right.version_no || left.id.localeCompare(right.id))),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      versions.find(({ id }) => id === where.id) ?? null),
    updateMany: vi.fn(async ({ data, where }: {
      data: Partial<TestVersion>;
      where: { effective_at?: null; id: string; status: TestVersion['status'] };
    }) => {
      const record = versions.find(({ id }) => id === where.id);
      if (record === undefined || record.status !== where.status ||
        (where.effective_at === null && record.effective_at !== null)) return { count: 0 };
      events.push(data.status === 'ARCHIVED' ? 'archive-current' : 'publish-new');
      Object.assign(record, data);
      return { count: 1 };
    }),
  };
  const transaction = {
    $queryRaw: vi.fn(async (query: unknown) => {
      const sql = queryText(query);
      if (sql.includes('FROM public.account')) {
        events.push('lock-actor');
        return [{ deleted_at: null, has_password: true, id: actorId, role: 'SUPER_ADMIN', status: 'ACTIVE' }];
      }
      if (sql.includes('FROM public.category')) {
        events.push(sql.includes('FOR SHARE') ? 'lock-category' : 'read-category');
        const targetQuery = query as { text?: string; values?: readonly unknown[] };
        targetQueries.push({ text: targetQuery.text ?? sql, values: targetQuery.values ?? [] });
        return (targetQuery.values ?? []).map((id) => ({ deleted_at: null, id }));
      }
      if (sql.includes('FROM public.sku')) {
        events.push(sql.includes('FOR SHARE') ? 'lock-sku' : 'read-sku');
        const targetQuery = query as { text?: string; values?: readonly unknown[] };
        targetQueries.push({ text: targetQuery.text ?? sql, values: targetQuery.values ?? [] });
        return (targetQuery.values ?? []).map((id) => ({ deleted_at: null, id }));
      }
      if (sql.includes('FROM public.commission_rule_version')) {
        events.push('lock-history');
        return [...versions].sort((left, right) => left.version_no - right.version_no)
          .map(({ id }) => ({ id }));
      }
      if (sql.includes('transaction_timestamp()')) {
        events.push('read-time');
        return [{ transaction_time: NOW }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    }),
    $queryRawUnsafe: vi.fn(async (_query: string, namespace: string) => {
      events.push(`lock:${namespace}`);
      return [{ acquired: 1 }];
    }),
    category: { findMany: vi.fn(async () => currentCatalog.categories) },
    commissionRuleEntry: {
      createMany: vi.fn(async ({ data }: { data: TestEntry[] }) => {
        events.push('create-entries');
        for (const value of data) {
          versions.find(({ id }) => id === value.rule_version_id)?.entries.push({ ...value });
        }
        return { count: data.length };
      }),
    },
    commissionRuleVersion,
    sku: { findMany: vi.fn(async () => currentCatalog.skus) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (tx: DatabaseTransaction) => unknown) =>
      work(transaction as unknown as DatabaseTransaction)),
  };
  return {
    commissionRuleVersion,
    events,
    prisma: prisma as unknown as PrismaClient,
    repository: new CommissionRepository(prisma as unknown as PrismaClient),
    targetQueries,
    transaction: transaction as unknown as DatabaseTransaction,
    versions,
  };
}

describe('CommissionRepository rules', () => {
  it('publishes the first complete version from base null and resource version zero', async () => {
    const state = ruleHarness();
    const verifyPreview = vi.fn(async () => undefined);

    const result = await state.repository.publishRuleVersionInTransaction(
      state.transaction,
      publishInput({
        changes: [
          { configuredRate: '5.0000', targetId: null, targetType: 'PLATFORM' },
          { configuredRate: '0.0000', targetId: categoryId, targetType: 'CATEGORY' },
        ],
      }),
      { verifyPreview },
    );

    expect(verifyPreview).toHaveBeenCalledWith(expect.objectContaining({
      currentPublishedId: null,
      maxVersionNo: 0,
      resourceVersion: 0,
    }));
    expect(result).toMatchObject({
      after: { status: 'PUBLISHED', version: 1 },
      before: null,
      impact: { affectedSkuCount: 1, changedTargetCount: 2 },
      version: { baseVersionId: null, reason: 'Publish commission rules', versionNo: 1 },
    });
    expect(state.versions[0]?.entries.map(({ configured_rate, target_key }) =>
      [target_key, configured_rate.toFixed(4)])).toEqual([
      [`CATEGORY:${categoryId}`, '0.0000'],
      ['PLATFORM', '5.0000'],
    ]);
    expect(state.events).toEqual([
      'lock-actor',
      'lock-category',
      'lock:commission-rule-config',
      'lock-history',
      'read-time',
      'create-draft',
      'create-entries',
      'publish-new',
    ]);
  });

  it('parameterizes and separates every target ID in a multi-target read', async () => {
    const state = ruleHarness();

    await state.repository.previewRulePublishInTransaction(state.transaction, action({
      changes: [
        { configuredRate: '5.0000', targetId: null, targetType: 'PLATFORM' },
        { configuredRate: '6.0000', targetId: categoryId, targetType: 'CATEGORY' },
        { configuredRate: '7.0000', targetId: emptyCategoryId, targetType: 'CATEGORY' },
      ],
    }));

    expect(state.targetQueries).toEqual([{
      text: expect.stringContaining('IN ($1, $2)'),
      values: [categoryId, emptyCategoryId].sort(),
    }]);
  });

  it('copies a complete version while null removes an override and 0.0000 remains explicit', async () => {
    const current = version({
      entries: [
        entry(firstVersionId, 'PLATFORM', null, '5.0000'),
        entry(firstVersionId, 'CATEGORY', categoryId, '7.5000'),
        entry(firstVersionId, 'SKU', skuId, '9.0000'),
      ],
    });
    const state = ruleHarness([current]);

    const result = await state.repository.publishRuleVersionInTransaction(state.transaction, publishInput({
      baseVersionId: firstVersionId,
      changes: [
        { configuredRate: null, targetId: categoryId, targetType: 'CATEGORY' },
        { configuredRate: '0.0000', targetId: skuId, targetType: 'SKU' },
      ],
      expectedCurrentPublishedId: firstVersionId,
      expectedMaxVersionNo: 1,
      expectedVersion: 1,
    }), { verifyPreview: vi.fn(async () => undefined) });

    const replacement = state.versions.find(({ version_no }) => version_no === 2)!;
    expect(replacement.base_version_id).toBe(firstVersionId);
    expect(replacement.entries.map(({ configured_rate, target_key }) =>
      [target_key, configured_rate.toFixed(4)])).toEqual([
      ['PLATFORM', '5.0000'],
      [`SKU:${skuId}`, '0.0000'],
    ]);
    expect(state.versions.find(({ id }) => id === firstVersionId)?.status).toBe('ARCHIVED');
    expect(result.version.changes).toEqual([
      { configuredRate: null, targetId: categoryId, targetType: 'CATEGORY' },
      { configuredRate: '0.0000', targetId: skuId, targetType: 'SKU' },
    ]);
    expect(state.events.indexOf('archive-current')).toBeLessThan(state.events.indexOf('publish-new'));
  });

  it('returns exact existing platform, category and SKU facts for the publish impact', async () => {
    const current = version({
      entries: [
        entry(firstVersionId, 'PLATFORM', null, '5.0000'),
        entry(firstVersionId, 'CATEGORY', categoryId, '7.5000'),
        entry(firstVersionId, 'SKU', skuId, '9.0000'),
      ],
    });
    const state = ruleHarness([current]);

    const result = await state.repository.previewRulePublishInTransaction(state.transaction, action({
      baseVersionId: firstVersionId,
      changes: [
        { configuredRate: '0.0000', targetId: null, targetType: 'PLATFORM' },
        { configuredRate: null, targetId: categoryId, targetType: 'CATEGORY' },
        { configuredRate: '0.0000', targetId: skuId, targetType: 'SKU' },
      ],
    }));

    expect(result.impact.changedTargets).toEqual([
      {
        beforeConfiguredRate: '7.5000',
        configuredRate: null,
        targetId: categoryId,
        targetType: 'CATEGORY',
      },
      {
        beforeConfiguredRate: '5.0000',
        configuredRate: '0.0000',
        targetId: null,
        targetType: 'PLATFORM',
      },
      {
        beforeConfiguredRate: '9.0000',
        configuredRate: '0.0000',
        targetId: skuId,
        targetType: 'SKU',
      },
    ]);
    expect(result.impact.affectedSkus).toEqual([
      expect.objectContaining({ beforeEffectiveRate: '9.0000', effectiveRate: '0.0000', skuId }),
    ]);
  });

  it('rejects an incomplete first version and history without one published version', async () => {
    const empty = ruleHarness();
    await expect(empty.repository.previewRulePublishInTransaction(empty.transaction, action({
      changes: [{ configuredRate: '2.0000', targetId: categoryId, targetType: 'CATEGORY' }],
    }))).rejects.toThrow('Commission rule requires a platform default');

    const orphan = ruleHarness([version({ status: 'ARCHIVED' })]);
    await expect(orphan.repository.previewRulePublishInTransaction(orphan.transaction, action({
      baseVersionId: firstVersionId,
    }))).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });

  it('returns all undeleted categories and preserves explicit category/SKU zero rates', async () => {
    const current = version({
      entries: [
        entry(firstVersionId, 'PLATFORM', null, '5.0000'),
        entry(firstVersionId, 'CATEGORY', categoryId, '0.0000'),
        entry(firstVersionId, 'SKU', skuId, '0.0000'),
      ],
    });
    const state = ruleHarness([current]);

    const result = await state.repository.getCurrentRules();

    expect(result.categories).toEqual([
      {
        categoryId,
        categoryName: 'Wash care',
        configuredRate: '0.0000',
        effectiveRate: '0.0000',
        source: 'CATEGORY',
      },
      {
        categoryId: emptyCategoryId,
        categoryName: 'Home care',
        configuredRate: null,
        effectiveRate: '5.0000',
        source: 'PLATFORM',
      },
    ]);
    expect(result.items[0]).toMatchObject({
      categoryName: 'Wash care',
      configuredRate: '0.0000',
      effectiveRate: '0.0000',
      source: 'SKU',
    });
  });

  it('replays the current archived version under the shared config lock', async () => {
    const archived = version({ status: 'ARCHIVED' });
    const current = version({
      base_version_id: firstVersionId,
      id: secondVersionId,
      entries: [entry(secondVersionId, 'PLATFORM', null, '6.0000')],
      version_no: 2,
    });
    const state = ruleHarness([archived, current]);

    await expect(state.repository.getRuleVersionForReplayInTransaction(
      state.transaction,
      actorId,
      firstVersionId,
    )).resolves.toMatchObject({ status: 'ARCHIVED', versionId: firstVersionId, versionNo: 1 });
    expect(state.events).toEqual(['lock-actor', 'lock:commission-rule-config', 'lock-history']);
  });
});

function repositoryWithTransaction(transaction: Record<string, unknown>): CommissionRepository {
  const current = {
    orderItemCommissionSnapshot: { findMany: vi.fn(async () => []) },
    ...transaction,
  };
  const prisma = {
    $transaction: vi.fn(async (work: (tx: DatabaseTransaction) => unknown) =>
      work(current as unknown as DatabaseTransaction)),
  };
  return new CommissionRepository(prisma as unknown as PrismaClient);
}

describe('CommissionRepository Admin projections', () => {
  it('passes the requested position state into the scoped commission query', async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const repository = repositoryWithTransaction({
      agentProfile: { findUnique: vi.fn(async () => ({ id: agentId })) },
      commissionLedger: { count, findMany },
    });

    await expect(repository.listAdminAgentCommissions({
      agentId,
      page: 1,
      pageSize: 20,
      positionState: 'EXPECTED',
    })).resolves.toEqual({ items: [], total: 0 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        agent_id: agentId,
        snapshot: { is: { position: { is: { state: 'EXPECTED' } } } },
      }),
    }));
    expect(count).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ snapshot: { is: { position: { is: { state: 'EXPECTED' } } } } }),
    }));
  });

  it('windows the complete wallet history before outer filtering and reconciles immutable totals', async () => {
    const windowQuery = vi.fn(async (query: unknown) => {
      const sql = queryText(query);
      expect(sql).toContain('WITH ledger_window AS MATERIALIZED');
      expect(sql.indexOf('FROM ledger_window')).toBeLessThan(sql.indexOf('AND ledger_type'));
      expect((query as { values: readonly unknown[] }).values.slice(-2)).toEqual([20, 20]);
      return [{
        agent_id: agentId,
        available_balance_after: new Prisma.Decimal('0.00'),
        available_change: new Prisma.Decimal('0.00'),
        expected_balance_after: new Prisma.Decimal('5.00'),
        expected_change: new Prisma.Decimal('5.00'),
        frozen_balance_after: new Prisma.Decimal('0.00'),
        frozen_change: new Prisma.Decimal('0.00'),
        id: ledgerId,
        ledger_type: 'EXPECTED_CREATED',
        occurred_at: NOW,
        refund_id: null,
        snapshot_id: snapshotId,
        withdrawal_id: null,
      }];
    });
    const repository = repositoryWithTransaction({
      $queryRaw: windowQuery,
      agentProfile: {
        findUnique: vi.fn(async () => ({
          id: agentId,
          wallet: {
            agent_id: agentId,
            available_balance: new Prisma.Decimal('0.00'),
            frozen_balance: new Prisma.Decimal('0.00'),
            id: walletId,
            version: 1,
          },
        })),
      },
      commissionLedger: {
        aggregate: vi.fn(async () => ({
          _sum: {
            available_change: new Prisma.Decimal('0.00'),
            expected_change: new Prisma.Decimal('5.00'),
            frozen_change: new Prisma.Decimal('0.00'),
          },
        })),
        count: vi.fn(async () => 21),
      },
      orderItemCommissionPosition: {
        aggregate: vi.fn(async () => ({ _sum: { expected_remaining: new Prisma.Decimal('5.00') } })),
      },
    });

    const result = await repository.listAdminAgentWalletLedger({
      agentId,
      ledgerType: 'EXPECTED_CREATED',
      occurredAtFrom: new Date(NOW.getTime() - 1_000),
      occurredAtToExclusive: new Date(NOW.getTime() + 1_000),
      page: 2,
      pageSize: 20,
    });

    expect(result).toEqual({
      items: [expect.objectContaining({
        expectedBalanceAfter: '5.00',
        ledgerType: 'EXPECTED_CREATED',
        referenceId: ledgerId,
        referenceType: 'COMMISSION_LEDGER',
      })],
      total: 21,
    });
    expect(windowQuery).toHaveBeenCalledOnce();
  });

  it('fails closed before projection when wallet cache and immutable ledger totals diverge', async () => {
    const windowQuery = vi.fn();
    const repository = repositoryWithTransaction({
      $queryRaw: windowQuery,
      agentProfile: {
        findUnique: vi.fn(async () => ({
          id: agentId,
          wallet: {
            agent_id: agentId,
            available_balance: new Prisma.Decimal('1.00'),
            frozen_balance: new Prisma.Decimal('0.00'),
            id: walletId,
            version: 1,
          },
        })),
      },
      commissionLedger: {
        aggregate: vi.fn(async () => ({
          _sum: {
            available_change: new Prisma.Decimal('0.00'),
            expected_change: new Prisma.Decimal('0.00'),
            frozen_change: new Prisma.Decimal('0.00'),
          },
        })),
        count: vi.fn(async () => 0),
      },
      orderItemCommissionPosition: {
        aggregate: vi.fn(async () => ({ _sum: { expected_remaining: new Prisma.Decimal('0.00') } })),
      },
    });

    await expect(repository.listAdminAgentWalletLedger({ agentId, page: 1, pageSize: 20 }))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(windowQuery).not.toHaveBeenCalled();
  });

  it('explains an immutable explicit-zero SKU hit without inventing a ledger row', async () => {
    const paidAt = new Date(NOW.getTime() - 5_000);
    const rule = version({
      entries: [
        entry(firstVersionId, 'PLATFORM', null, '5.0000'),
        entry(firstVersionId, 'CATEGORY', categoryId, '7.5000'),
        entry(firstVersionId, 'SKU', skuId, '0.0000'),
      ],
    });
    const snapshot = {
      agent_id: agentId,
      category_id_snapshot: categoryId,
      category_name_snapshot: 'Wash care at payment',
      commission_base: new Prisma.Decimal('19.99'),
      created_at: NOW,
      effective_rate: new Prisma.Decimal('0.0000'),
      id: snapshotId,
      ledger: [],
      order_item_id: orderItemId,
      original_commission: new Prisma.Decimal('0.00'),
      position: {
        expected_remaining: new Prisma.Decimal('0.00'),
        id: positionId,
        original_commission: new Prisma.Decimal('0.00'),
        reversed_total: new Prisma.Decimal('0.00'),
        snapshot_id: snapshotId,
        state: 'NONE',
        version: 1,
      },
      product_id_snapshot: productId,
      rule_version: rule,
      rule_version_id: firstVersionId,
      sku_id_snapshot: skuId,
      source_type: 'SKU',
    };
    const repository = repositoryWithTransaction({
      salesOrder: {
        findUnique: vi.fn(async () => ({
          final_agent_id: agentId,
          final_channel: 'AGENT',
          id: orderId,
          items: [{
            category_id: categoryId,
            commission_snapshot: snapshot,
            id: orderItemId,
            order_id: orderId,
            product_id: productId,
            product_name_snapshot: 'Laundry liquid at order',
            sku_code_snapshot: 'SKU-001',
            sku_id: skuId,
            sku_name_snapshot: 'Bottle 1L',
          }],
          order_no: 'ORD-20260903-001',
          paid_at: paidAt,
          payment_status: 'PAID',
        })),
      },
    });

    const result = await repository.getOrderExplanation(orderId);

    expect(result.items[0]).toMatchObject({
      categoryName: 'Wash care at payment',
      effectiveRate: '0.0000',
      ledger: [],
      originalCommission: '0.00',
      positionState: 'NONE',
      ruleSource: 'SKU',
    });
    expect(result.items[0]?.hitPath).toEqual([
      'VERSION:1',
      'PLATFORM:5.0000',
      `CATEGORY:${categoryId}:7.5000`,
      `SKU:${skuId}:0.0000`,
      'HIT:SKU:0.0000',
    ]);

    snapshot.rule_version.status = 'DRAFT';
    snapshot.rule_version.effective_at = null;
    await expect(repository.getOrderExplanation(orderId))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    snapshot.rule_version.status = 'PUBLISHED';
    snapshot.rule_version.effective_at = new Date(paidAt.getTime() + 1);
    await expect(repository.getOrderExplanation(orderId))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });

    snapshot.rule_version.effective_at = new Date(NOW.getTime() - 11_000);
    snapshot.source_type = 'CATEGORY';
    await expect(repository.getOrderExplanation(orderId))
      .rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
  });
});
