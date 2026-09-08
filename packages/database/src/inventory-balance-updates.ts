import { Prisma } from '../.generated/prisma/client';
import type { DatabaseTransaction } from './idempotency.repository';

export interface InventoryBalanceOptimisticUpdate {
  id: string;
  skuId: string;
  version: number;
  lockedQty: number;
  physicalQty: number;
  lockedAfter: number;
  physicalAfter: number;
}

export async function applyInventoryBalanceUpdatesInTransaction(
  transaction: DatabaseTransaction,
  updates: readonly InventoryBalanceOptimisticUpdate[],
  occurredAt: Date,
  onMismatch: () => never,
): Promise<void> {
  if (updates.length === 0) return;
  const rows = [...updates]
    .sort((left, right) => left.skuId.localeCompare(right.skuId) || left.id.localeCompare(right.id))
    .map((update) => Prisma.sql`(
      ${update.id}::char(26),
      ${update.skuId}::char(26),
      ${update.version}::integer,
      ${update.lockedQty}::integer,
      ${update.physicalQty}::integer,
      ${update.lockedAfter}::integer,
      ${update.physicalAfter}::integer
    )`);
  const updated = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    UPDATE public.inventory_balance AS balance
    SET
      locked_qty = source.locked_after,
      physical_qty = source.physical_after,
      updated_at = ${occurredAt},
      version = balance.version + 1
    FROM (
      VALUES ${Prisma.join(rows)}
    ) AS source(id, sku_id, version, locked_qty, physical_qty, locked_after, physical_after)
    WHERE balance.id = source.id
      AND balance.sku_id = source.sku_id
      AND balance.version = source.version
      AND balance.locked_qty = source.locked_qty
      AND balance.physical_qty = source.physical_qty
    RETURNING balance.id
  `);
  if (updated.length !== updates.length) onMismatch();
}
