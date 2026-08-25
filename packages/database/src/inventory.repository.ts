import { ApplicationError, isValidUlid } from '@qingxu/platform-core';

import { Prisma, type PrismaClient } from '../.generated/prisma/client';
import type { InventoryLedgerType, SkuStatus } from '../.generated/prisma/enums';
import type { DatabaseTransaction } from './idempotency.repository';
import { acquireMasterDataHierarchyLocks } from './master-data.repository';

export interface InventoryListInput {
  page: number;
  pageSize: number;
  keyword?: string;
  categoryId?: string;
}

export interface InventorySnapshot {
  balanceId: string;
  skuId: string;
  skuCode: string;
  skuName: string;
  skuStatus: SkuStatus;
  productName: string;
  physicalQty: number;
  lockedQty: number;
  availableQty: number;
  activeReservationQty: number;
  version: number;
}

export interface InventoryListResult {
  items: InventorySnapshot[];
  total: number;
}

export interface InventoryAdjustmentImpact {
  balanceId: string;
  skuId: string;
  skuStatus: SkuStatus;
  version: number;
  physicalBefore: number;
  physicalAfter: number;
  lockedBefore: number;
  lockedAfter: number;
  availableBefore: number;
  availableAfter: number;
  activeReservationQty: number;
  warnings: string[];
}

export interface InventoryLedgerSnapshot {
  id: string;
  type: InventoryLedgerType;
  physicalChange: number;
  lockedChange: number;
  physicalBefore: number;
  physicalAfter: number;
  lockedBefore: number;
  lockedAfter: number;
  reason: string;
  occurredAt: Date;
}

export interface InventoryAdjustmentResult {
  impact: InventoryAdjustmentImpact;
  ledger: InventoryLedgerSnapshot;
}

export interface GetInventoryAdjustmentImpactInput {
  skuId: string;
  physicalDelta: number;
}

export interface ApplyInventoryAdjustmentInput extends GetInventoryAdjustmentImpactInput {
  actorId: string;
  expectedVersion: number;
  ledgerId: string;
  reason: string;
}

export interface InventoryLedgerListInput {
  skuId: string;
  page: number;
  pageSize: number;
  ledgerType?: InventoryLedgerType;
  occurredAtFrom?: Date;
  occurredAtToExclusive?: Date;
}

export interface InventoryLedgerListResult {
  items: InventoryLedgerSnapshot[];
  total: number;
}

const INVENTORY_LIST_FIELDS = new Set(['categoryId', 'keyword', 'page', 'pageSize']);
const IMPACT_FIELDS = new Set(['physicalDelta', 'skuId']);
const APPLY_FIELDS = new Set([
  'actorId',
  'expectedVersion',
  'ledgerId',
  'physicalDelta',
  'reason',
  'skuId',
]);
const LEDGER_LIST_FIELDS = new Set([
  'ledgerType',
  'occurredAtFrom',
  'occurredAtToExclusive',
  'page',
  'pageSize',
  'skuId',
]);
const INVENTORY_LEDGER_TYPES = new Set<InventoryLedgerType>([
  'INITIAL',
  'MANUAL_INCREASE',
  'MANUAL_DECREASE',
  'ORDER_PAID_DEDUCT',
  'ORDER_RESERVE',
  'ORDER_RELEASE',
  'REFUND_RESTOCK',
  'RETURN_RESTOCK',
  'RETURN_DAMAGED',
  'COMPENSATION',
]);
const POSTGRES_INTEGER_MIN = -2_147_483_648n;
const POSTGRES_INTEGER_MAX = 2_147_483_647n;

const ACTIVE_RESERVATION_ITEMS = {
  select: { quantity: true },
  where: { reservation: { status: 'ACTIVE' as const } },
} as const;
const INVENTORY_INCLUDE = {
  inventory_balance: true,
  product: { select: { name: true } },
  reservation_items: ACTIVE_RESERVATION_ITEMS,
} as const;
const ADJUSTMENT_INCLUDE = {
  inventory_balance: true,
  reservation_items: ACTIVE_RESERVATION_ITEMS,
} as const;
const BALANCE_INCLUDE = { inventory_balance: true } as const;

type InventoryRecord = Prisma.SkuGetPayload<{ include: typeof INVENTORY_INCLUDE }>;
type BalanceRecord = Prisma.SkuGetPayload<{ include: typeof BALANCE_INCLUDE }>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyFields(value: unknown, fields: ReadonlySet<string>): value is Record<string, unknown> {
  return isPlainObject(value) && Object.keys(value).every((key) => fields.has(key));
}

function requireExactFields(value: unknown, fields: ReadonlySet<string>, label: string): void {
  if (!hasOnlyFields(value, fields) || Object.keys(value).length !== fields.size) {
    throw new TypeError(`${label} contains unsupported or missing fields`);
  }
}

function requireUlid(value: string, label: string): void {
  if (!isValidUlid(value)) throw new TypeError(`${label} must be a ULID`);
}

function requirePage(page: number, pageSize: number): void {
  if (!Number.isSafeInteger(page) || page < 1) throw new TypeError('Page must be a positive integer');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TypeError('Page size must be between 1 and 100');
  }
  if (!Number.isSafeInteger((page - 1) * pageSize)) throw new TypeError('Page offset is outside the supported range');
}

function requirePhysicalDelta(value: number): void {
  if (!Number.isInteger(value) || value === 0 || value < Number(POSTGRES_INTEGER_MIN) ||
    value > Number(POSTGRES_INTEGER_MAX)) {
    throw new TypeError('Physical inventory delta must be a non-zero PostgreSQL INTEGER');
  }
}

function requireVersion(value: number): void {
  if (!Number.isInteger(value) || value < 1 || value > Number(POSTGRES_INTEGER_MAX)) {
    throw new TypeError('Expected inventory version must be a positive PostgreSQL INTEGER');
  }
}

function requireReason(value: string): void {
  const length = typeof value === 'string' ? Array.from(value).length : 0;
  if (typeof value !== 'string' || length < 2 || length > 500) {
    throw new TypeError('Inventory adjustment reason must contain 2 to 500 characters');
  }
}

function requireDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new TypeError(`${label} must be a valid Date`);
}

function validateListInput(input: InventoryListInput): void {
  if (!hasOnlyFields(input, INVENTORY_LIST_FIELDS)) {
    throw new TypeError('Inventory list query contains unsupported fields');
  }
  requirePage(input.page, input.pageSize);
  if (input.keyword !== undefined && (typeof input.keyword !== 'string' || input.keyword.trim().length === 0)) {
    throw new TypeError('Inventory keyword must not be blank');
  }
  if (input.categoryId !== undefined) requireUlid(input.categoryId, 'Inventory category ID');
}

function validateImpactInput(input: GetInventoryAdjustmentImpactInput): void {
  requireExactFields(input, IMPACT_FIELDS, 'Inventory adjustment impact input');
  requireUlid(input.skuId, 'Inventory SKU ID');
  requirePhysicalDelta(input.physicalDelta);
}

function validateApplyInput(input: ApplyInventoryAdjustmentInput): void {
  requireExactFields(input, APPLY_FIELDS, 'Inventory adjustment input');
  requireUlid(input.actorId, 'Inventory actor ID');
  requireUlid(input.ledgerId, 'Inventory ledger ID');
  requireUlid(input.skuId, 'Inventory SKU ID');
  requirePhysicalDelta(input.physicalDelta);
  requireVersion(input.expectedVersion);
  requireReason(input.reason);
}

function validateLedgerListInput(input: InventoryLedgerListInput): void {
  if (!hasOnlyFields(input, LEDGER_LIST_FIELDS)) {
    throw new TypeError('Inventory ledger query contains unsupported fields');
  }
  requireUlid(input.skuId, 'Inventory ledger SKU ID');
  requirePage(input.page, input.pageSize);
  if (input.ledgerType !== undefined && !INVENTORY_LEDGER_TYPES.has(input.ledgerType)) {
    throw new TypeError('Inventory ledger type is invalid');
  }
  if (input.occurredAtFrom !== undefined) requireDate(input.occurredAtFrom, 'Inventory ledger start time');
  if (input.occurredAtToExclusive !== undefined) {
    requireDate(input.occurredAtToExclusive, 'Inventory ledger end time');
  }
  if (input.occurredAtFrom !== undefined && input.occurredAtToExclusive !== undefined &&
    input.occurredAtFrom.getTime() >= input.occurredAtToExclusive.getTime()) {
    throw new TypeError('Inventory ledger end time must be later than its start time');
  }
}

function notFound(): ApplicationError {
  return new ApplicationError('RESOURCE_NOT_FOUND', 'SKU inventory does not exist');
}

function archivedConflict(): ApplicationError {
  return new ApplicationError('STATE_CONFLICT', 'Archived SKU inventory cannot be adjusted');
}

function versionConflict(): ApplicationError {
  return new ApplicationError('RESOURCE_VERSION_CONFLICT', 'Inventory balance version changed');
}

function missingBalance(): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', 'SKU inventory balance invariant is missing');
}

function invalidStoredInventory(): ApplicationError {
  return new ApplicationError('INTERNAL_ERROR', 'Stored inventory facts are invalid');
}

function requireStoredBalance(balance: BalanceRecord['inventory_balance']): asserts balance is NonNullable<
  BalanceRecord['inventory_balance']
> {
  if (!balance) throw missingBalance();
  if (!isValidUlid(balance.id) || !isValidUlid(balance.sku_id) ||
    !Number.isInteger(balance.physical_qty) || balance.physical_qty < 0 ||
    balance.physical_qty > Number(POSTGRES_INTEGER_MAX) ||
    !Number.isInteger(balance.locked_qty) || balance.locked_qty < 0 ||
    balance.locked_qty > balance.physical_qty ||
    !Number.isInteger(balance.version) || balance.version < 1 ||
    balance.version > Number(POSTGRES_INTEGER_MAX) ||
    !(balance.updated_at instanceof Date) || !Number.isFinite(balance.updated_at.getTime())) {
    throw invalidStoredInventory();
  }
}

function activeReservationQuantity(items: readonly { quantity: number }[]): number {
  let total = 0n;
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > Number(POSTGRES_INTEGER_MAX)) {
      throw invalidStoredInventory();
    }
    total += BigInt(item.quantity);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw invalidStoredInventory();
  return Number(total);
}

function calculateAdjustment(
  balance: NonNullable<BalanceRecord['inventory_balance']>,
  physicalDelta: number,
): Pick<InventoryAdjustmentImpact,
  'availableAfter' | 'availableBefore' | 'lockedAfter' | 'lockedBefore' |
  'physicalAfter' | 'physicalBefore' | 'warnings'> {
  const physicalAfterValue = BigInt(balance.physical_qty) + BigInt(physicalDelta);
  if (physicalAfterValue < POSTGRES_INTEGER_MIN || physicalAfterValue > POSTGRES_INTEGER_MAX) {
    throw new ApplicationError(
      'INVENTORY_QUANTITY_OUT_OF_RANGE',
      'The resulting inventory quantity is outside the supported range',
    );
  }
  const physicalAfter = Number(physicalAfterValue);
  return {
    availableAfter: physicalAfter - balance.locked_qty,
    availableBefore: balance.physical_qty - balance.locked_qty,
    lockedAfter: balance.locked_qty,
    lockedBefore: balance.locked_qty,
    physicalAfter,
    physicalBefore: balance.physical_qty,
    warnings: physicalAfter < balance.locked_qty ? ['STOCK_INSUFFICIENT'] : [],
  };
}

function adjustmentImpact(
  record: BalanceRecord,
  physicalDelta: number,
  activeReservationQty: number,
  version = record.inventory_balance?.version,
): InventoryAdjustmentImpact {
  requireStoredBalance(record.inventory_balance);
  if (record.inventory_balance.sku_id !== record.id || version === undefined) throw invalidStoredInventory();
  requireVersion(version);
  return {
    activeReservationQty,
    balanceId: record.inventory_balance.id,
    skuId: record.id,
    skuStatus: record.status,
    version,
    ...calculateAdjustment(record.inventory_balance, physicalDelta),
  };
}

function inventorySnapshot(record: InventoryRecord): InventorySnapshot {
  requireStoredBalance(record.inventory_balance);
  if (record.inventory_balance.sku_id !== record.id) throw invalidStoredInventory();
  return {
    activeReservationQty: activeReservationQuantity(record.reservation_items),
    availableQty: record.inventory_balance.physical_qty - record.inventory_balance.locked_qty,
    balanceId: record.inventory_balance.id,
    lockedQty: record.inventory_balance.locked_qty,
    physicalQty: record.inventory_balance.physical_qty,
    productName: record.product.name,
    skuCode: record.code,
    skuId: record.id,
    skuName: record.name,
    skuStatus: record.status,
    version: record.inventory_balance.version,
  };
}

function safeBefore(after: number, change: number): number {
  if (!Number.isInteger(after) || !Number.isInteger(change)) throw invalidStoredInventory();
  const before = BigInt(after) - BigInt(change);
  if (before < 0n || before > POSTGRES_INTEGER_MAX) throw invalidStoredInventory();
  return Number(before);
}

function ledgerSnapshot(record: {
  id: string;
  ledger_type: InventoryLedgerType;
  physical_change: number;
  locked_change: number;
  physical_after: number;
  locked_after: number;
  reason: string;
  occurred_at: Date;
}): InventoryLedgerSnapshot {
  const physicalBefore = safeBefore(record.physical_after, record.physical_change);
  const lockedBefore = safeBefore(record.locked_after, record.locked_change);
  if (!isValidUlid(record.id) ||
    !Number.isInteger(record.physical_after) || record.physical_after < 0 ||
    record.physical_after > Number(POSTGRES_INTEGER_MAX) ||
    !Number.isInteger(record.locked_after) || record.locked_after < 0 ||
    record.locked_after > record.physical_after || lockedBefore > physicalBefore ||
    typeof record.reason !== 'string' || Array.from(record.reason).length > 500 ||
    !(record.occurred_at instanceof Date) || !Number.isFinite(record.occurred_at.getTime())) {
    throw invalidStoredInventory();
  }
  return {
    id: record.id,
    lockedAfter: record.locked_after,
    lockedBefore,
    lockedChange: record.locked_change,
    occurredAt: record.occurred_at,
    physicalAfter: record.physical_after,
    physicalBefore,
    physicalChange: record.physical_change,
    reason: record.reason,
    type: record.ledger_type,
  };
}

function inventoryWhere(input: InventoryListInput): Prisma.SkuWhereInput {
  return {
    ...(input.categoryId === undefined ? {} : { product: { category_id: input.categoryId } }),
    ...(input.keyword === undefined ? {} : {
      OR: [
        { code: { contains: input.keyword, mode: 'insensitive' } },
        { name: { contains: input.keyword, mode: 'insensitive' } },
        { product: { name: { contains: input.keyword, mode: 'insensitive' } } },
      ],
    }),
  };
}

function ledgerWhere(input: InventoryLedgerListInput): Prisma.InventoryLedgerWhereInput {
  const occurredAt = input.occurredAtFrom === undefined && input.occurredAtToExclusive === undefined
    ? undefined
    : {
        ...(input.occurredAtFrom === undefined ? {} : { gte: input.occurredAtFrom }),
        ...(input.occurredAtToExclusive === undefined ? {} : { lt: input.occurredAtToExclusive }),
      };
  return {
    sku_id: input.skuId,
    ...(input.ledgerType === undefined ? {} : { ledger_type: input.ledgerType }),
    ...(occurredAt === undefined ? {} : { occurred_at: occurredAt }),
  };
}

export class InventoryRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listInventory(input: InventoryListInput): Promise<InventoryListResult> {
    validateListInput(input);
    const where = inventoryWhere(input);
    return this.prisma.$transaction(async (transaction) => {
      const [records, total] = await Promise.all([
        transaction.sku.findMany({
          include: INVENTORY_INCLUDE,
          orderBy: [{ product: { name: 'asc' } }, { id: 'asc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.sku.count({ where }),
      ]);
      return { items: records.map((record) => inventorySnapshot(record)), total };
    }, { isolationLevel: 'RepeatableRead' });
  }

  async getAdjustmentImpactInTransaction(
    transaction: DatabaseTransaction,
    input: GetInventoryAdjustmentImpactInput,
  ): Promise<InventoryAdjustmentImpact> {
    validateImpactInput(input);
    const record = await transaction.sku.findUnique({ include: ADJUSTMENT_INCLUDE, where: { id: input.skuId } });
    if (!record) throw notFound();
    if (record.deleted_at !== null || record.status === 'ARCHIVED') throw archivedConflict();
    requireStoredBalance(record.inventory_balance);
    return adjustmentImpact(
      record,
      input.physicalDelta,
      activeReservationQuantity(record.reservation_items),
    );
  }

  private async lockAndReadActiveReservations(
    transaction: DatabaseTransaction,
    skuId: string,
  ): Promise<number> {
    const candidates = await transaction.inventoryReservation.findMany({
      orderBy: [{ id: 'asc' }],
      select: { id: true },
      where: { items: { some: { sku_id: skuId } }, status: 'ACTIVE' },
    });
    const reservationIds = candidates.map(({ id }) => id);
    await acquireMasterDataHierarchyLocks(transaction, { reservationIds });
    if (reservationIds.length === 0) return 0;
    const active = await transaction.inventoryReservation.findMany({
      orderBy: [{ id: 'asc' }],
      select: {
        id: true,
        items: {
          orderBy: [{ sku_id: 'asc' }],
          select: { quantity: true },
          where: { sku_id: skuId },
        },
      },
      where: { id: { in: reservationIds }, status: 'ACTIVE' },
    });
    return activeReservationQuantity(active.flatMap(({ items }) => items));
  }

  private async transactionTime(transaction: DatabaseTransaction): Promise<Date> {
    const rows = await transaction.$queryRaw<Array<{ transaction_time: Date }>>(
      Prisma.sql`SELECT transaction_timestamp() AS transaction_time`,
    );
    const occurredAt = rows[0]?.transaction_time;
    if (!(occurredAt instanceof Date) || !Number.isFinite(occurredAt.getTime())) {
      throw new ApplicationError('INTERNAL_ERROR', 'Database transaction clock is unavailable');
    }
    return occurredAt;
  }

  async applyAdjustmentInTransaction(
    transaction: DatabaseTransaction,
    input: ApplyInventoryAdjustmentInput,
  ): Promise<InventoryAdjustmentResult> {
    validateApplyInput(input);
    await acquireMasterDataHierarchyLocks(transaction, { skuIds: [input.skuId] });
    const initial = await transaction.sku.findUnique({
      select: { id: true, inventory_balance: { select: { id: true } } },
      where: { id: input.skuId },
    });
    if (!initial) throw notFound();
    if (!initial.inventory_balance) throw missingBalance();
    await acquireMasterDataHierarchyLocks(transaction, { inventoryBalanceIds: [initial.inventory_balance.id] });
    const current = await transaction.sku.findUnique({ include: BALANCE_INCLUDE, where: { id: input.skuId } });
    if (!current) throw notFound();
    requireStoredBalance(current.inventory_balance);
    if (current.inventory_balance.id !== initial.inventory_balance.id ||
      current.inventory_balance.sku_id !== current.id) throw invalidStoredInventory();
    if (current.deleted_at !== null || current.status === 'ARCHIVED') throw archivedConflict();
    if (current.inventory_balance.version !== input.expectedVersion) throw versionConflict();

    const activeReservationQty = await this.lockAndReadActiveReservations(transaction, input.skuId);
    const currentImpact = adjustmentImpact(current, input.physicalDelta, activeReservationQty);
    if (currentImpact.warnings.includes('STOCK_INSUFFICIENT')) {
      throw new ApplicationError('STOCK_INSUFFICIENT', 'Stock is insufficient');
    }
    if (input.expectedVersion >= Number(POSTGRES_INTEGER_MAX)) {
      throw new ApplicationError('INTERNAL_ERROR', 'Inventory version cannot be incremented');
    }
    const occurredAt = await this.transactionTime(transaction);
    const updated = await transaction.inventoryBalance.updateMany({
      data: {
        physical_qty: currentImpact.physicalAfter,
        updated_at: occurredAt,
        version: { increment: 1 },
      },
      where: {
        id: currentImpact.balanceId,
        locked_qty: currentImpact.lockedBefore,
        physical_qty: currentImpact.physicalBefore,
        sku_id: input.skuId,
        version: input.expectedVersion,
      },
    });
    if (updated.count !== 1) throw versionConflict();

    const ledgerRecord = await transaction.inventoryLedger.create({
      data: {
        actor_account_id: input.actorId,
        business_id: null,
        id: input.ledgerId,
        ledger_type: input.physicalDelta > 0 ? 'MANUAL_INCREASE' : 'MANUAL_DECREASE',
        locked_after: currentImpact.lockedAfter,
        locked_change: 0,
        occurred_at: occurredAt,
        physical_after: currentImpact.physicalAfter,
        physical_change: input.physicalDelta,
        reason: input.reason,
        sku_id: input.skuId,
      },
    });
    return {
      impact: { ...currentImpact, version: input.expectedVersion + 1 },
      ledger: ledgerSnapshot(ledgerRecord),
    };
  }

  async listLedger(input: InventoryLedgerListInput): Promise<InventoryLedgerListResult> {
    validateLedgerListInput(input);
    const where = ledgerWhere(input);
    return this.prisma.$transaction(async (transaction) => {
      const sku = await transaction.sku.findUnique({ select: { id: true }, where: { id: input.skuId } });
      if (!sku) throw notFound();
      const [records, total] = await Promise.all([
        transaction.inventoryLedger.findMany({
          orderBy: [{ occurred_at: 'desc' }, { id: 'desc' }],
          skip: (input.page - 1) * input.pageSize,
          take: input.pageSize,
          where,
        }),
        transaction.inventoryLedger.count({ where }),
      ]);
      return { items: records.map((record) => ledgerSnapshot(record)), total };
    }, { isolationLevel: 'RepeatableRead' });
  }
}
