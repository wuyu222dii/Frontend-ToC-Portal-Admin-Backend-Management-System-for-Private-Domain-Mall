import type { components } from '@qingxu/contracts';

export type InventoryItem = components['schemas']['InventoryView'];
export type InventoryLedgerItem = components['schemas']['InventoryLedgerView'];
export type InventoryAdjustmentInput = components['schemas']['InventoryAdjustmentAction'];
export type InventoryAdjustmentPreview = components['schemas']['InventoryAdjustmentPreviewResponse']['data'];
export type InventoryAdjustmentCommand = components['schemas']['InventoryAdjustmentCommandResponse']['data'];
export type InventoryLedgerType = components['schemas']['InventoryLedgerType'];

export interface InventoryListQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  categoryId?: string;
}

export interface InventoryLedgerQuery {
  page?: number;
  pageSize?: number;
  ledgerType?: InventoryLedgerType;
  dateFrom?: string;
  dateTo?: string;
}

export interface InventoryListResult {
  items: InventoryItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}

export interface InventoryLedgerResult {
  items: InventoryLedgerItem[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
  };
}
