import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import {
  AdminCustomerRepository,
  type AdminCustomerAttributionTransferInput,
} from './admin-customer.repository';
import type { DatabaseTransaction } from './idempotency.repository';

const NOW = new Date('2026-09-03T02:00:00.000Z');
const CUSTOMER_ID = generateUlid(NOW.getTime() - 10_000);
const ACCOUNT_ID = generateUlid(NOW.getTime() - 9_000);
const ACTOR_ID = generateUlid(NOW.getTime() - 8_000);
const OLD_AGENT_ID = generateUlid(NOW.getTime() - 7_000);
const TARGET_AGENT_ID = generateUlid(NOW.getTime() - 6_000);
const OLD_BINDING_ID = generateUlid(NOW.getTime() - 5_000);
const ORDER_ID = generateUlid(NOW.getTime() - 4_000);

function customerRow(overrides: Record<string, unknown> = {}) {
  return {
    account_deleted_at: null,
    account_status: 'ACTIVE',
    agent_id: OLD_AGENT_ID,
    agent_name: 'Original Agent',
    anonymized_at: null,
    binding_id: OLD_BINDING_ID,
    binding_started_at: new Date(NOW.getTime() - 86_400_000),
    city: 'Hangzhou',
    consumption_amount: new Prisma.Decimal('86.40'),
    consumption_count: 2n,
    customer_id: CUSTOMER_ID,
    deletion_request_status: null,
    has_binding_history: true,
    last_order_id: ORDER_ID,
    last_product_name: 'Shampoo',
    last_purchase_at: new Date(NOW.getTime() - 3_600_000),
    nickname_masked: 'A**',
    phone_last4: '6821',
    registered_at: new Date(NOW.getTime() - 172_800_000),
    version: 4,
    ...overrides,
  };
}

function repository(prisma: PrismaClient = {} as PrismaClient): AdminCustomerRepository {
  return new AdminCustomerRepository(prisma, Buffer.alloc(32, 19));
}

function sqlText(query: unknown): string {
  if (typeof query !== 'object' || query === null) return '';
  const strings = (query as { strings?: readonly string[] }).strings;
  return strings?.join(' ') ?? '';
}

function transactionPrisma(transaction: Record<string, unknown>): PrismaClient {
  return {
    $transaction: vi.fn(async (work: (value: DatabaseTransaction) => Promise<unknown>) =>
      work(transaction as unknown as DatabaseTransaction)),
  } as unknown as PrismaClient;
}

function transferInput(overrides: Partial<AdminCustomerAttributionTransferInput> = {}) {
  return {
    actorAccountId: ACTOR_ID,
    customerId: CUSTOMER_ID,
    expectedVersion: 4,
    reason: 'Move customer ownership',
    targetAgentId: TARGET_AGENT_ID,
    ...overrides,
  } satisfies AdminCustomerAttributionTransferInput;
}

describe('AdminCustomerRepository reads', () => {
  it('returns full-lifecycle aggregates while projecting only the current binding', async () => {
    const queries: string[] = [];
    const transaction = {
      $queryRaw: vi.fn(async (query: unknown) => {
        const sql = sqlText(query);
        queries.push(sql);
        return sql.includes('COUNT(*)::bigint AS total')
          ? [{ total: 1n }]
          : [customerRow({ account_status: 'DISABLED', deletion_request_status: 'PROCESSING' })];
      }),
      customerProfile: { findMany: vi.fn() },
      agentProfile: { findUnique: vi.fn(async () => ({ id: OLD_AGENT_ID })) },
    };
    const result = await repository(transactionPrisma(transaction)).listCustomers({
      agentId: OLD_AGENT_ID,
      bindingStatus: 'BOUND',
      maxConsumption: '100.00',
      minConsumption: '10.00',
      page: 2,
      pageSize: 25,
    });

    expect(result).toMatchObject({
      items: [{
        accountStatus: 'DELETION_PENDING',
        consumptionAmount: '86.40',
        consumptionCount: 2,
        currentBinding: {
          agentId: OLD_AGENT_ID,
          bindingId: OLD_BINDING_ID,
          customerVersion: 4,
        },
        customerId: CUSTOMER_ID,
        deletionRequestStatus: 'PROCESSING',
        lastOrderId: ORDER_ID,
        managementNotePresent: false,
        nicknameMasked: 'A**',
        phoneMasked: '*** **** 6821',
      }],
      total: 1,
    });
    expect(result.items[0]?.customerAlias).toMatch(/^customer_[a-f0-9]{26}$/);
    expect(queries).toHaveLength(2);
    expect(queries[0]).toContain('customer_data.agent_id');
    expect(queries[0]).toContain('customer_data.binding_id IS NOT NULL');
    expect(queries[0]).toContain('customer_data.consumption_amount');
    expect(queries[1]).toContain('LIMIT');
  });

  it('resolves alias keywords before database pagination', async () => {
    const first = customerRow({
      agent_id: null,
      agent_name: null,
      binding_id: null,
      binding_started_at: null,
      has_binding_history: false,
    });
    const alias = (await (() => {
      const transaction = {
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ total: 1n }])
          .mockResolvedValueOnce([first]),
        customerProfile: { findMany: vi.fn(async () => []) },
      };
      return repository(transactionPrisma(transaction)).listCustomers({ page: 1, pageSize: 10 })
        .then((result) => result.items[0]!.customerAlias);
    })());
    const queries: Array<{ strings?: readonly string[]; values?: readonly unknown[] }> = [];
    const transaction = {
      $queryRaw: vi.fn(async (query: { strings?: readonly string[]; values?: readonly unknown[] }) => {
        queries.push(query);
        return sqlText(query).includes('COUNT(*)::bigint AS total') ? [{ total: 1n }] : [first];
      }),
      customerProfile: { findMany: vi.fn(async () => [{ id: CUSTOMER_ID }]) },
    };
    await repository(transactionPrisma(transaction)).listCustomers({ keyword: alias, page: 1, pageSize: 10 });

    expect(transaction.customerProfile.findMany).toHaveBeenCalledOnce();
    expect(queries[0]?.values).toContain(CUSTOMER_ID);
    expect(sqlText(queries[0])).toContain('customer_data.nickname_masked ILIKE');
    expect(sqlText(queries[0])).not.toContain('customer_data.nickname ILIKE');
  });

  it('returns 404 for an unknown Agent drilldown before reading Customer rows', async () => {
    const transaction = {
      $queryRaw: vi.fn(),
      agentProfile: { findUnique: vi.fn(async () => null) },
      customerProfile: { findMany: vi.fn() },
    };
    await expect(repository(transactionPrisma(transaction)).listCustomers({
      agentId: TARGET_AGENT_ID,
      page: 1,
      pageSize: 20,
    })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    expect(transaction.$queryRaw).not.toHaveBeenCalled();
    expect(transaction.customerProfile.findMany).not.toHaveBeenCalled();
  });

  it('keeps current binding separate from immutable binding history and all historical orders', async () => {
    const endedBindingId = generateUlid(NOW.getTime() - 20_000);
    const transaction = {
      $queryRaw: vi.fn(async () => [customerRow()]),
      customerAgentBinding: {
        findMany: vi.fn(async () => [
          {
            agent: { id: OLD_AGENT_ID, name: 'Original Agent' },
            created_at: new Date(NOW.getTime() - 90_000),
            end_reason: null,
            ended_at: null,
            id: OLD_BINDING_ID,
            new_change_logs: [{
              created_at: new Date(NOW.getTime() - 89_000),
              reason: 'CUSTOMER_CONFIRMED_ATTRIBUTION',
            }],
            old_change_logs: [],
            started_at: new Date(NOW.getTime() - 90_000),
          },
          {
            agent: { id: TARGET_AGENT_ID, name: 'Historical Agent' },
            created_at: new Date(NOW.getTime() - 190_000),
            end_reason: 'TRANSFERRED',
            ended_at: new Date(NOW.getTime() - 100_000),
            id: endedBindingId,
            new_change_logs: [{ created_at: new Date(NOW.getTime() - 189_000), reason: 'CREATED' }],
            old_change_logs: [{ created_at: new Date(NOW.getTime() - 99_000), reason: 'TRANSFERRED BY ADMIN' }],
            started_at: new Date(NOW.getTime() - 190_000),
          },
        ]),
      },
      salesOrder: {
        findMany: vi.fn(async () => [{
          fulfillment_status: 'READY_TO_SHIP',
          id: ORDER_ID,
          order_no: `QX${ORDER_ID}`,
          order_status: 'PENDING_SHIPMENT',
          paid_at: NOW,
          payable_amount: new Prisma.Decimal('99.00'),
          payment_resolution: 'NORMAL',
          payment_status: 'PAID',
          refund_processing_status: 'IDLE',
          refund_progress_status: 'NONE',
        }]),
      },
    };
    const detail = await repository(transactionPrisma(transaction)).getCustomerDetail(CUSTOMER_ID);

    expect(detail.customer.currentBinding?.bindingId).toBe(OLD_BINDING_ID);
    expect(detail.orders).toEqual([expect.objectContaining({
      displayStatus: '待发货',
      orderId: ORDER_ID,
      payableAmount: '99.00',
    })]);
    expect(detail.bindingHistory).toEqual([
      expect.objectContaining({
        bindingId: OLD_BINDING_ID,
        changeReason: 'CUSTOMER_CONFIRMED_ATTRIBUTION',
        endedAt: null,
      }),
      expect.objectContaining({
        bindingId: endedBindingId,
        changeReason: expect.stringMatching(/^CUSTOMER_ATTRIBUTION_TRANSFER:[a-f0-9]{64}$/),
        endReason: 'TRANSFERRED',
      }),
    ]);
  });
});

describe('AdminCustomerRepository attribution transfer', () => {
  it('provides preview counts without mixing current binding and historical paid facts', async () => {
    const transaction = {
      $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
      $queryRaw: vi.fn(async () => [customerRow()]),
      agentProfile: {
        findFirst: vi.fn(async () => ({ id: TARGET_AGENT_ID, name: 'Target Agent', status: 'ACTIVE' })),
      },
      attributionCandidate: { count: vi.fn(async () => 3) },
      customerProfile: { findUnique: vi.fn(async () => ({ account_id: ACCOUNT_ID })) },
      salesOrder: { count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(7) },
    };
    const impact = await repository().getAttributionTransferImpactInTransaction(
      transaction as unknown as DatabaseTransaction,
      { customerId: CUSTOMER_ID, targetAgentId: TARGET_AGENT_ID },
    );

    expect(impact).toMatchObject({
      activeCandidateCount: 3,
      currentBinding: { agentId: OLD_AGENT_ID, bindingId: OLD_BINDING_ID },
      paidOrderCount: 7,
      pendingOrderCount: 2,
      targetAgent: { agentId: TARGET_AGENT_ID, agentName: 'Target Agent', status: 'ACTIVE' },
    });
    expect(transaction.salesOrder.count).toHaveBeenNthCalledWith(2, {
      where: { customer_id: CUSTOMER_ID, payment_status: 'PAID' },
    });
    expect(transaction.$queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([
      'store-auth-account',
      'store-auth-customer',
      'store-attribution-binding',
      'store-attribution-agent',
    ]);
  });

  function transferHarness(row = customerRow()) {
    const events: string[] = [];
    const forbiddenWrites = {
      agentCustomerPrivacyProjection: { updateMany: vi.fn() },
      commissionLedger: { updateMany: vi.fn() },
      orderAttributionCandidate: { updateMany: vi.fn() },
      orderAttributionSnapshot: { updateMany: vi.fn() },
      orderItemCommissionSnapshot: { updateMany: vi.fn() },
      salesOrder: { updateMany: vi.fn() },
    };
    const transaction = {
      $queryRawUnsafe: vi.fn(async (_query: string, namespace: string) => {
        events.push(`advisory:${namespace}`);
        return [{ acquired: 1 }];
      }),
      $queryRaw: vi.fn(async (query: unknown) => {
        const sql = sqlText(query);
        if (sql.includes('FROM public.customer_profile WHERE')) {
          events.push('row:customer');
          return [{ id: CUSTOMER_ID }];
        }
        if (sql.includes('FROM public.customer_agent_binding') && sql.includes('FOR UPDATE')) {
          events.push('row:binding');
          return row.binding_id === null ? [] : [{ id: row.binding_id }];
        }
        if (sql.includes('WITH customer_data')) return [row];
        if (sql.includes('transaction_timestamp')) return [{ transaction_time: NOW }];
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
      agentProfile: {
        findFirst: vi.fn(async ({ where }: { where: { id: string } }) => ({
          id: where.id,
          name: where.id === TARGET_AGENT_ID ? 'Target Agent' : 'Original Agent',
          status: 'ACTIVE',
        })),
      },
      attributionCandidate: {
        updateMany: vi.fn(async () => ({ count: 2 })),
      },
      bindingChangeLog: { create: vi.fn(async () => ({ id: 'change' })) },
      customerAgentBinding: {
        create: vi.fn(async ({ data }: { data: { id: string } }) => ({ id: data.id })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      customerProfile: {
        findUnique: vi.fn(async () => ({ account_id: ACCOUNT_ID })),
        updateMany: vi.fn(async () => ({ count: 1 })),
      },
      ...forbiddenWrites,
    };
    return { events, forbiddenWrites, transaction };
  }

  it('uses the order-compatible lock sequence and atomically transfers only current attribution facts', async () => {
    const { events, forbiddenWrites, transaction } = transferHarness();
    const result = await repository().transferAttributionInTransaction(
      transaction as unknown as DatabaseTransaction,
      transferInput(),
    );

    expect(events).toEqual([
      'advisory:store-auth-account',
      'advisory:store-auth-customer',
      'advisory:store-attribution-binding',
      'advisory:store-attribution-agent',
      'row:customer',
      'row:binding',
    ]);
    expect(transaction.customerProfile.updateMany).toHaveBeenCalledWith({
      data: { updated_at: NOW, version: { increment: 1 } },
      where: { id: CUSTOMER_ID, version: 4 },
    });
    expect(transaction.customerAgentBinding.updateMany).toHaveBeenCalledWith({
      data: { end_reason: 'TRANSFERRED', ended_at: NOW },
      where: { ended_at: null, id: OLD_BINDING_ID },
    });
    expect(transaction.customerAgentBinding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ agent_id: TARGET_AGENT_ID, customer_id: CUSTOMER_ID }),
    }));
    expect(transaction.attributionCandidate.updateMany).toHaveBeenCalledWith({
      data: {
        invalid_reason: 'ADMIN_ATTRIBUTION_TRANSFER',
        status: 'INVALIDATED',
        updated_at: NOW,
      },
      where: { customer_id: CUSTOMER_ID, status: 'ACTIVE' },
    });
    expect(transaction.bindingChangeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actor_account_id: ACTOR_ID,
        customer_id: CUSTOMER_ID,
        new_agent_id: TARGET_AGENT_ID,
        old_agent_id: OLD_AGENT_ID,
        old_binding_id: OLD_BINDING_ID,
        reason: expect.stringMatching(/^CUSTOMER_ATTRIBUTION_TRANSFER:[a-f0-9]{64}$/),
      }),
      select: { id: true },
    });
    expect(result).toMatchObject({
      afterBinding: { agentId: TARGET_AGENT_ID, customerVersion: 5 },
      beforeBinding: { agentId: OLD_AGENT_ID, bindingId: OLD_BINDING_ID },
      customer: { currentBinding: { agentId: TARGET_AGENT_ID }, version: 5 },
      invalidatedCandidateCount: 2,
      occurredAt: NOW,
    });
    for (const delegate of Object.values(forbiddenWrites)) {
      expect(delegate.updateMany).not.toHaveBeenCalled();
    }
  });

  it('ends the current binding without creating a replacement for direct ownership', async () => {
    const { transaction } = transferHarness();
    const result = await repository().transferAttributionInTransaction(
      transaction as unknown as DatabaseTransaction,
      transferInput({ targetAgentId: null }),
    );

    expect(transaction.customerAgentBinding.updateMany).toHaveBeenCalledWith({
      data: { end_reason: 'DIRECTED', ended_at: NOW },
      where: { ended_at: null, id: OLD_BINDING_ID },
    });
    expect(transaction.customerAgentBinding.create).not.toHaveBeenCalled();
    expect(result.afterBinding).toBeNull();
    expect(result.customer.currentBinding).toBeNull();
  });

  it('creates a current binding for a previously direct customer without rewriting history', async () => {
    const { transaction } = transferHarness(customerRow({
      agent_id: null,
      agent_name: null,
      binding_id: null,
      binding_started_at: null,
      has_binding_history: true,
    }));
    const result = await repository().transferAttributionInTransaction(
      transaction as unknown as DatabaseTransaction,
      transferInput(),
    );

    expect(transaction.customerAgentBinding.updateMany).not.toHaveBeenCalled();
    expect(transaction.customerAgentBinding.create).toHaveBeenCalledOnce();
    expect(transaction.bindingChangeLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        new_agent_id: TARGET_AGENT_ID,
        old_agent_id: null,
        old_binding_id: null,
      }),
      select: { id: true },
    });
    expect(result.beforeBinding).toBeNull();
    expect(result.afterBinding?.agentId).toBe(TARGET_AGENT_ID);
  });

  it('rejects same-target, inactive-target and stale-version changes', async () => {
    const sameTarget = transferHarness();
    await expect(repository().transferAttributionInTransaction(
      sameTarget.transaction as unknown as DatabaseTransaction,
      transferInput({ targetAgentId: OLD_AGENT_ID }),
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const inactive = transferHarness();
    inactive.transaction.agentProfile.findFirst.mockResolvedValueOnce(null);
    await expect(repository().transferAttributionInTransaction(
      inactive.transaction as unknown as DatabaseTransaction,
      transferInput(),
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });

    const stale = transferHarness(customerRow({ version: 5 }));
    await expect(repository().transferAttributionInTransaction(
      stale.transaction as unknown as DatabaseTransaction,
      transferInput(),
    )).rejects.toMatchObject({ code: 'RESOURCE_VERSION_CONFLICT' });
    expect(stale.transaction.customerProfile.updateMany).not.toHaveBeenCalled();
    expect(stale.transaction.customerAgentBinding.updateMany).not.toHaveBeenCalled();

    const directNoop = transferHarness(customerRow({
      agent_id: null,
      agent_name: null,
      binding_id: null,
      binding_started_at: null,
    }));
    await expect(repository().transferAttributionInTransaction(
      directNoop.transaction as unknown as DatabaseTransaction,
      transferInput({ targetAgentId: null }),
    )).rejects.toMatchObject({ code: 'STATE_CONFLICT' });
  });
});
