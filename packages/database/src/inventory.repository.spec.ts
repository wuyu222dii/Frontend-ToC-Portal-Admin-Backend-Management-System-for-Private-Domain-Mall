import { generateUlid } from '@qingxu/platform-core';
import { describe, expect, it, vi } from 'vitest';

import type { PrismaClient } from '../.generated/prisma/client';
import type { InventoryLedgerType, SkuStatus } from '../.generated/prisma/enums';
import type { DatabaseTransaction } from './idempotency.repository';
import {
  type ApplyInventoryAdjustmentInput,
  InventoryRepository,
  type InventorySnapshot,
} from './inventory.repository';

const NOW = new Date('2026-08-25T08:00:00.000Z');
const FROM = new Date('2026-08-23T16:00:00.000Z');
const TO_EXCLUSIVE = new Date('2026-08-25T16:00:00.000Z');
const actorId = generateUlid(NOW.getTime() - 10_000);
const productId = generateUlid(NOW.getTime() - 9_000);
const categoryId = generateUlid(NOW.getTime() - 8_000);
const skuId = generateUlid(NOW.getTime() - 7_000);
const balanceId = generateUlid(NOW.getTime() - 6_000);
const reservationA = generateUlid(NOW.getTime() - 5_000);
const reservationB = generateUlid(NOW.getTime() - 4_000);
const ledgerId = generateUlid(NOW.getTime() - 3_000);
const earlierLedgerId = generateUlid(NOW.getTime() - 2_000);

interface TestBalanceRecord {
  id: string;
  locked_qty: number;
  physical_qty: number;
  sku_id: string;
  updated_at: Date;
  version: number;
}

interface TestSkuRecord {
  code: string;
  deleted_at: Date | null;
  id: string;
  inventory_balance: TestBalanceRecord | null;
  name: string;
  product: { name: string };
  product_id: string;
  reservation_items: { quantity: number }[];
  status: SkuStatus;
}

interface TestLedgerRecord {
  actor_account_id: string | null;
  business_id: string | null;
  id: string;
  ledger_type: InventoryLedgerType;
  locked_after: number;
  locked_change: number;
  occurred_at: Date;
  physical_after: number;
  physical_change: number;
  reason: string;
  sku_id: string;
}

function balanceRecord(overrides: Partial<TestBalanceRecord> = {}): TestBalanceRecord {
  return {
    id: balanceId,
    locked_qty: 3,
    physical_qty: 10,
    sku_id: skuId,
    updated_at: NOW,
    version: 1,
    ...overrides,
  };
}

function skuRecord(overrides: Partial<TestSkuRecord> = {}): TestSkuRecord {
  return {
    code: 'SKU-001',
    deleted_at: null,
    id: skuId,
    inventory_balance: balanceRecord(),
    name: '500 ml',
    product: { name: 'Daily shampoo' },
    product_id: productId,
    reservation_items: [{ quantity: 2 }, { quantity: 1 }],
    status: 'ACTIVE',
    ...overrides,
  };
}

function ledgerRecord(overrides: Partial<TestLedgerRecord> = {}): TestLedgerRecord {
  return {
    actor_account_id: actorId,
    business_id: null,
    id: ledgerId,
    ledger_type: 'MANUAL_INCREASE',
    locked_after: 3,
    locked_change: 0,
    occurred_at: NOW,
    physical_after: 15,
    physical_change: 5,
    reason: 'Cycle count correction',
    sku_id: skuId,
    ...overrides,
  };
}

const applyInput: ApplyInventoryAdjustmentInput = {
  actorId,
  expectedVersion: 1,
  ledgerId,
  physicalDelta: 5,
  reason: 'Cycle count correction',
  skuId,
};

function harness() {
  let currentSku: TestSkuRecord | null = skuRecord();
  let listed: TestSkuRecord[] = currentSku === null ? [] : [currentSku];
  let ledgerRows: TestLedgerRecord[] = [ledgerRecord()];
  let forcedUpdateCount: number | undefined;
  let activeReservations = [
    { id: reservationB, items: [{ quantity: 1 }] },
    { id: reservationA, items: [{ quantity: 2 }] },
  ];

  const sku = {
    count: vi.fn(async () => listed.length),
    findMany: vi.fn(async () => listed),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
      currentSku?.id === where.id ? currentSku : null),
  };
  const inventoryBalance = {
    updateMany: vi.fn(async ({ data, where }: {
      data: Record<string, unknown>;
      where: Record<string, unknown>;
    }) => {
      if (forcedUpdateCount !== undefined) return { count: forcedUpdateCount };
      const currentBalance = currentSku?.inventory_balance;
      if (!currentSku || !currentBalance ||
        where.id !== currentBalance.id ||
        where.sku_id !== currentSku.id ||
        where.version !== currentBalance.version ||
        where.physical_qty !== currentBalance.physical_qty ||
        where.locked_qty !== currentBalance.locked_qty) {
        return { count: 0 };
      }
      const increment = (data.version as { increment?: number } | undefined)?.increment ?? 0;
      currentSku = {
        ...currentSku,
        inventory_balance: {
          ...currentBalance,
          physical_qty: data.physical_qty as number,
          updated_at: data.updated_at as Date,
          version: currentBalance.version + increment,
        },
      };
      return { count: 1 };
    }),
  };
  const inventoryLedger = {
    count: vi.fn(async () => ledgerRows.length),
    create: vi.fn(async ({ data }: { data: TestLedgerRecord }) => {
      const created = { ...data };
      ledgerRows.push(created);
      return created;
    }),
    findMany: vi.fn(async () => ledgerRows),
  };
  const inventoryReservation = {
    findMany: vi.fn(async ({ select }: { select: Record<string, unknown> }) =>
      Object.hasOwn(select, 'items')
        ? activeReservations
        : activeReservations.map(({ id }) => ({ id }))),
  };
  const transactionStub = {
    $queryRaw: vi.fn(async () => [{ transaction_time: NOW }]),
    $queryRawUnsafe: vi.fn(async () => [{ acquired: 1 }]),
    inventoryBalance,
    inventoryLedger,
    inventoryReservation,
    sku,
  };
  const prisma = {
    ...transactionStub,
    $transaction: vi.fn(async (work: (transaction: DatabaseTransaction) => unknown) =>
      work(transactionStub as unknown as DatabaseTransaction)),
  };

  return {
    inventoryBalance,
    inventoryLedger,
    inventoryReservation,
    prisma,
    repository: new InventoryRepository(prisma as unknown as PrismaClient),
    setActiveReservations: (value: typeof activeReservations) => { activeReservations = value; },
    setForcedUpdateCount: (value: number | undefined) => { forcedUpdateCount = value; },
    setLedgerRows: (value: TestLedgerRecord[]) => { ledgerRows = value; },
    setListed: (value: TestSkuRecord[]) => { listed = value; },
    setSku: (value: TestSkuRecord | null) => { currentSku = value; },
    sku,
    transaction: transactionStub as unknown as DatabaseTransaction,
    transactionStub,
  };
}

describe('InventoryRepository', () => {
  it('rejects unsupported fields at all four repository method boundaries', async () => {
    const state = harness();
    await expect(state.repository.listInventory({ extra: true, page: 1, pageSize: 20 } as never))
      .rejects.toThrow('unsupported fields');
    await expect(state.repository.getAdjustmentImpactInTransaction(state.transaction, {
      extra: true,
      physicalDelta: 1,
      skuId,
    } as never)).rejects.toThrow('unsupported or missing fields');
    await expect(state.repository.applyAdjustmentInTransaction(state.transaction, {
      ...applyInput,
      extra: true,
    } as never)).rejects.toThrow('unsupported or missing fields');
    await expect(state.repository.listLedger({ extra: true, page: 1, pageSize: 20, skuId } as never))
      .rejects.toThrow('unsupported fields');
    expect(state.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lists inventory in one repeatable-read snapshot with stable product/id ordering', async () => {
    const state = harness();
    const archivedSkuId = generateUlid(NOW.getTime() - 1_000);
    state.setListed([
      skuRecord(),
      skuRecord({
        code: 'SKU-002',
        deleted_at: NOW,
        id: archivedSkuId,
        inventory_balance: balanceRecord({
          id: generateUlid(NOW.getTime() - 500),
          locked_qty: 1,
          physical_qty: 4,
          sku_id: archivedSkuId,
        }),
        reservation_items: [{ quantity: 4 }],
        status: 'ARCHIVED',
      }),
    ]);

    const result = await state.repository.listInventory({
      categoryId,
      keyword: 'shampoo',
      page: 2,
      pageSize: 10,
    });

    expect(result).toMatchObject({
      items: [
        {
          activeReservationQty: 3,
          availableQty: 7,
          balanceId,
          physicalQty: 10,
          skuId,
          version: 1,
        },
        {
          activeReservationQty: 4,
          availableQty: 3,
          skuId: archivedSkuId,
          skuStatus: 'ARCHIVED',
        },
      ] satisfies Partial<InventorySnapshot>[],
      total: 2,
    });
    expect(state.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(state.sku.findMany).toHaveBeenCalledWith({
      include: expect.objectContaining({
        reservation_items: expect.objectContaining({
          where: { reservation: { status: 'ACTIVE' } },
        }),
      }),
      orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
      skip: 10,
      take: 10,
      where: {
        OR: [
          { code: { contains: 'shampoo', mode: 'insensitive' } },
          { name: { contains: 'shampoo', mode: 'insensitive' } },
          { product: { name: { contains: 'shampoo', mode: 'insensitive' } } },
        ],
        product: { category_id: categoryId },
      },
    });
  });

  it('returns preview impact and a warning without rejecting physical inventory below locked inventory', async () => {
    const state = harness();
    await expect(state.repository.getAdjustmentImpactInTransaction(state.transaction, {
      physicalDelta: -8,
      skuId,
    })).resolves.toEqual({
      activeReservationQty: 3,
      availableAfter: -1,
      availableBefore: 7,
      balanceId,
      lockedAfter: 3,
      lockedBefore: 3,
      physicalAfter: 2,
      physicalBefore: 10,
      skuId,
      skuStatus: 'ACTIVE',
      version: 1,
      warnings: ['STOCK_INSUFFICIENT'],
    });
  });

  it('checks the resulting physical quantity with BigInt before the locked-stock warning', async () => {
    const state = harness();
    state.setSku(skuRecord({
      inventory_balance: balanceRecord({ locked_qty: 0, physical_qty: 2_147_483_647 }),
      reservation_items: [],
    }));
    await expect(state.repository.getAdjustmentImpactInTransaction(state.transaction, {
      physicalDelta: 1,
      skuId,
    })).rejects.toMatchObject({ code: 'INVENTORY_QUANTITY_OUT_OF_RANGE' });
  });

  it.each([
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(skuRecord({ status: 'ARCHIVED' })),
      expectedCode: 'STATE_CONFLICT',
      label: 'archived SKU',
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(skuRecord({ deleted_at: NOW })),
      expectedCode: 'STATE_CONFLICT',
      label: 'soft-deleted SKU',
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(skuRecord({ inventory_balance: null })),
      expectedCode: 'INTERNAL_ERROR',
      label: 'missing balance invariant',
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(null),
      expectedCode: 'RESOURCE_NOT_FOUND',
      label: 'missing SKU',
    },
  ])('fails preview for $label', async ({ configure, expectedCode }) => {
    const state = harness();
    configure(state);
    await expect(state.repository.getAdjustmentImpactInTransaction(state.transaction, {
      physicalDelta: 1,
      skuId,
    })).rejects.toMatchObject({ code: expectedCode });
  });

  it.each([
    { delta: 5, ledgerType: 'MANUAL_INCREASE' as const, physicalAfter: 15 },
    { delta: -5, ledgerType: 'MANUAL_DECREASE' as const, physicalAfter: 5 },
  ])('applies a $ledgerType adjustment with SKU/balance/reservation locks and one ledger', async ({
    delta,
    ledgerType,
    physicalAfter,
  }) => {
    const state = harness();
    const result = await state.repository.applyAdjustmentInTransaction(state.transaction, {
      ...applyInput,
      physicalDelta: delta,
    });

    expect(state.transactionStub.$queryRawUnsafe.mock.calls.map((call) => call[1])).toEqual([
      'product-catalog-sku',
      'inventory-balance',
      'inventory-reservation',
      'inventory-reservation',
    ]);
    expect(state.transactionStub.$queryRawUnsafe.mock.calls.map((call) => call[2])).toEqual([
      JSON.stringify([skuId]),
      JSON.stringify([balanceId]),
      JSON.stringify([reservationA]),
      JSON.stringify([reservationB]),
    ]);
    expect(state.sku.findUnique).toHaveBeenCalledTimes(2);
    expect(state.transactionStub.$queryRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      state.sku.findUnique.mock.invocationCallOrder[0] as number,
    );
    expect(state.transactionStub.$queryRawUnsafe.mock.invocationCallOrder[1]).toBeLessThan(
      state.sku.findUnique.mock.invocationCallOrder[1] as number,
    );
    expect(state.inventoryReservation.findMany).toHaveBeenCalledTimes(2);
    expect(state.inventoryBalance.updateMany).toHaveBeenCalledWith({
      data: {
        physical_qty: physicalAfter,
        updated_at: NOW,
        version: { increment: 1 },
      },
      where: {
        id: balanceId,
        locked_qty: 3,
        physical_qty: 10,
        sku_id: skuId,
        version: 1,
      },
    });
    expect(state.inventoryLedger.create).toHaveBeenCalledTimes(1);
    expect(state.inventoryLedger.create).toHaveBeenCalledWith({
      data: {
        actor_account_id: actorId,
        business_id: null,
        id: ledgerId,
        ledger_type: ledgerType,
        locked_after: 3,
        locked_change: 0,
        occurred_at: NOW,
        physical_after: physicalAfter,
        physical_change: delta,
        reason: applyInput.reason,
        sku_id: skuId,
      },
    });
    expect(result).toEqual({
      impact: {
        activeReservationQty: 3,
        availableAfter: physicalAfter - 3,
        availableBefore: 7,
        balanceId,
        lockedAfter: 3,
        lockedBefore: 3,
        physicalAfter,
        physicalBefore: 10,
        skuId,
        skuStatus: 'ACTIVE',
        version: 2,
        warnings: [],
      },
      ledger: {
        id: ledgerId,
        lockedAfter: 3,
        lockedBefore: 3,
        lockedChange: 0,
        occurredAt: NOW,
        physicalAfter,
        physicalBefore: 10,
        physicalChange: delta,
        reason: applyInput.reason,
        type: ledgerType,
      },
    });
  });

  it('accepts a two-character reason without imposing repository-only whitespace semantics', async () => {
    const state = harness();
    await expect(state.repository.applyAdjustmentInTransaction(state.transaction, {
      ...applyInput,
      reason: '  ',
    })).resolves.toMatchObject({ ledger: { reason: '  ' } });
  });

  it.each([
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(skuRecord({
        inventory_balance: balanceRecord({ version: 2 }),
      })),
      expectedCode: 'RESOURCE_VERSION_CONFLICT',
      input: applyInput,
      label: 'stale expected version',
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setForcedUpdateCount(0),
      expectedCode: 'RESOURCE_VERSION_CONFLICT',
      input: applyInput,
      label: 'failed physical/locked/version CAS',
    },
    {
      configure: () => undefined,
      expectedCode: 'STOCK_INSUFFICIENT',
      input: { ...applyInput, physicalDelta: -8 },
      label: 'physical quantity below locked quantity',
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(skuRecord({
        inventory_balance: balanceRecord({ locked_qty: 0, physical_qty: 2_147_483_647 }),
      })),
      expectedCode: 'INVENTORY_QUANTITY_OUT_OF_RANGE',
      input: applyInput,
      label: 'integer overflow',
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(skuRecord({ status: 'ARCHIVED' })),
      expectedCode: 'STATE_CONFLICT',
      input: applyInput,
      label: 'archived SKU',
    },
    {
      configure: (state: ReturnType<typeof harness>) => state.setSku(skuRecord({ inventory_balance: null })),
      expectedCode: 'INTERNAL_ERROR',
      input: applyInput,
      label: 'missing balance invariant',
    },
  ])('does not write a ledger when apply fails for $label', async ({ configure, expectedCode, input }) => {
    const state = harness();
    configure(state);
    await expect(state.repository.applyAdjustmentInTransaction(state.transaction, input))
      .rejects.toMatchObject({ code: expectedCode });
    expect(state.inventoryLedger.create).not.toHaveBeenCalled();
  });

  it('lists ledger rows in a repeatable-read snapshot with half-open filters and reconstructed before values', async () => {
    const state = harness();
    state.setSku(skuRecord({ deleted_at: NOW, status: 'ARCHIVED' }));
    state.setLedgerRows([
      ledgerRecord(),
      ledgerRecord({
        id: earlierLedgerId,
        ledger_type: 'ORDER_RESERVE',
        locked_after: 3,
        locked_change: 3,
        occurred_at: new Date(NOW.getTime() - 1_000),
        physical_after: 10,
        physical_change: 0,
      }),
    ]);

    const result = await state.repository.listLedger({
      ledgerType: 'MANUAL_INCREASE',
      occurredAtFrom: FROM,
      occurredAtToExclusive: TO_EXCLUSIVE,
      page: 2,
      pageSize: 10,
      skuId,
    });

    expect(result).toEqual({
      items: [
        {
          id: ledgerId,
          lockedAfter: 3,
          lockedBefore: 3,
          lockedChange: 0,
          occurredAt: NOW,
          physicalAfter: 15,
          physicalBefore: 10,
          physicalChange: 5,
          reason: 'Cycle count correction',
          type: 'MANUAL_INCREASE',
        },
        {
          id: earlierLedgerId,
          lockedAfter: 3,
          lockedBefore: 0,
          lockedChange: 3,
          occurredAt: new Date(NOW.getTime() - 1_000),
          physicalAfter: 10,
          physicalBefore: 10,
          physicalChange: 0,
          reason: 'Cycle count correction',
          type: 'ORDER_RESERVE',
        },
      ],
      total: 2,
    });
    expect(state.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(state.inventoryLedger.findMany).toHaveBeenCalledWith({
      orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
      skip: 10,
      take: 10,
      where: {
        ledger_type: 'MANUAL_INCREASE',
        occurred_at: { gte: FROM, lt: TO_EXCLUSIVE },
        sku_id: skuId,
      },
    });
  });

  it('rejects an invalid ledger date range and a missing ledger SKU', async () => {
    const state = harness();
    await expect(state.repository.listLedger({
      occurredAtFrom: TO_EXCLUSIVE,
      occurredAtToExclusive: FROM,
      page: 1,
      pageSize: 20,
      skuId,
    })).rejects.toThrow('later than its start time');
    state.setSku(null);
    await expect(state.repository.listLedger({ page: 1, pageSize: 20, skuId }))
      .rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});
